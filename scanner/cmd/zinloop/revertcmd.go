package main

import (
	"encoding/json"
	"flag"
	"fmt"
	"io"

	"github.com/atulpokharel-gp/claude/scanner/internal/fix"
)

// runRevert restores a config from its ~/.zinloop/backups/ copy, deletes the
// corresponding keys from the password store, and drops the backup directory.
// It refuses by default when any of the keys has already been rotated,
// because the restored config would then point at a value the provider has
// revoked.
func runRevert(args []string, stdout, stderr io.Writer) int {
	fs := flag.NewFlagSet("zinloop revert", flag.ContinueOnError)
	fs.SetOutput(stderr)
	home := fs.String("home", "", "home directory (default: current user's)")
	list := fs.Bool("list", false, "list restorable backups")
	asJSON := fs.Bool("json", false, "with --list, print as JSON")
	force := fs.Bool("force", false, "revert even if some keys were already rotated")
	if err := fs.Parse(args); err != nil {
		return 1
	}
	env, err := buildEnv(*home, nil, nil, nil)
	if err != nil {
		fmt.Fprintln(stderr, err)
		return 1
	}
	backups, err := fix.Revertable(env.Home)
	if err != nil {
		fmt.Fprintln(stderr, err)
		return 1
	}

	if *list || fs.NArg() == 0 {
		if *asJSON {
			enc := json.NewEncoder(stdout)
			enc.SetIndent("", "  ")
			_ = enc.Encode(backups)
			return 0
		}
		if len(backups) == 0 {
			fmt.Fprintln(stdout, "No restorable backups. Run zinloop fix-secrets --apply to create one.")
			return 0
		}
		fmt.Fprintln(stdout, "Restorable backups (newest first):")
		for _, b := range backups {
			fmt.Fprintf(stdout, "  %s  %s  (%s, %d key%s)\n",
				b.ID, b.Meta.ConfigPath, b.Meta.App, len(b.Meta.Refs), plural(len(b.Meta.Refs)))
		}
		fmt.Fprintln(stdout, "\nRun: zinloop revert <id>")
		return 0
	}

	id := fs.Arg(0)
	var target *fix.Backup
	for i := range backups {
		if backups[i].ID == id {
			target = &backups[i]
			break
		}
	}
	if target == nil {
		fmt.Fprintf(stderr, "no backup with id %q; run zinloop revert --list\n", id)
		return 1
	}

	if err := fix.Revert(*target, fix.RevertOptions{Home: env.Home, Store: newStore(), Force: *force}); err != nil {
		fmt.Fprintln(stderr, err)
		return 1
	}
	fmt.Fprintf(stdout, "Restored %s and removed %d key%s from the password store.\n",
		target.Meta.OriginalPath, len(target.Meta.Refs), plural(len(target.Meta.Refs)))
	fmt.Fprintln(stdout, "Restart the AI app so it picks up the restored config.")
	return 0
}

func plural(n int) string {
	if n == 1 {
		return ""
	}
	return "s"
}
