package main

import (
	"bufio"
	"encoding/json"
	"flag"
	"fmt"
	"io"
	"os"
	"path/filepath"
	"strings"
	"time"

	"github.com/atulpokharel-gp/claude/scanner/internal/discover"
	"github.com/atulpokharel-gp/claude/scanner/internal/fix"
	"github.com/atulpokharel-gp/claude/scanner/internal/vault"
)

// launcherPath is the agentscan binary written into fixed configs. Tests override it.
var launcherPath = func() (string, error) {
	p, err := os.Executable()
	if err != nil {
		return "", err
	}
	return filepath.EvalSymlinks(p)
}

func runFix(args []string, stdout, stderr io.Writer) int {
	fs := flag.NewFlagSet("agentscan fix-secrets", flag.ContinueOnError)
	fs.SetOutput(stderr)
	apply := fs.Bool("apply", false, "make the changes (without this, only shows what would change)")
	home := fs.String("home", "", "home directory to fix (default: current user's)")
	launcher := fs.String("launcher", "", "path to agentscan to write into configs (default: this program)")
	asJSON := fs.Bool("json", false, "print the plan or result as JSON")
	var projects multiFlag
	fs.Var(&projects, "project", "project folder to also fix (repeatable)")
	if err := fs.Parse(args); err != nil {
		return 1
	}
	env, err := buildEnv(*home, projects)
	if err != nil {
		fmt.Fprintln(stderr, err)
		return 1
	}

	servers, _ := discover.Scan(env)
	plan := fix.MakePlan(servers)

	if *apply {
		lp := *launcher
		if lp == "" {
			if lp, err = launcherPath(); err != nil {
				fmt.Fprintln(stderr, "cannot find agentscan's own path; pass --launcher:", err)
				return 1
			}
		}
		if strings.Contains(lp, os.TempDir()) && *launcher == "" {
			fmt.Fprintln(stderr, "agentscan is running from a temporary folder (go run?). Build it, put it somewhere permanent, and run it from there, or pass --launcher.")
			return 1
		}
		plan, err = fix.Apply(plan, fix.Options{Home: env.Home, Launcher: lp, Store: newStore(), Now: time.Now})
		if err != nil {
			fmt.Fprintln(stderr, err)
			return 1
		}
	}

	if *asJSON {
		enc := json.NewEncoder(stdout)
		enc.SetIndent("", "  ")
		_ = enc.Encode(plan)
	} else {
		writePlan(stdout, plan, *apply)
	}
	for _, f := range plan.Files {
		if f.Error != "" {
			return 1
		}
	}
	return 0
}

func writePlan(w io.Writer, plan fix.Plan, applied bool) {
	if plan.Keys() == 0 && len(plan.Manual) == 0 && len(plan.Files) == 0 {
		fmt.Fprintln(w, "No plain-text keys found in AI agent configs. Nothing to fix.")
		return
	}
	verb := "Would move"
	if applied {
		verb = "Moved"
	}
	for _, f := range plan.Files {
		fmt.Fprintf(w, "\n%s  (%s)\n", f.Path, f.App)
		if f.Blocked != "" {
			fmt.Fprintf(w, "  Skipped: %s\n", f.Blocked)
		}
		for _, s := range f.Servers {
			if f.Blocked != "" {
				fmt.Fprintf(w, "  - %s: %s\n", s.Server, strings.Join(s.EnvKeys, ", "))
				continue
			}
			for i, k := range s.EnvKeys {
				fmt.Fprintf(w, "  %s %s.%s to the password store as %q\n", verb, s.Server, k, s.Refs[i])
			}
		}
		if f.Error != "" {
			fmt.Fprintf(w, "  Not changed: %s\n", f.Error)
		}
		if f.Backup != "" {
			fmt.Fprintf(w, "  Backup of the original: %s\n", f.Backup)
		}
	}
	if len(plan.Manual) > 0 {
		fmt.Fprintln(w, "\nFix these by hand (they can't be moved automatically yet):")
		for _, m := range plan.Manual {
			fmt.Fprintf(w, "  - %s in %s (%s, %s)\n", m.Where, m.Server, m.App, m.Path)
		}
	}
	switch {
	case !applied && plan.Keys() > 0:
		fmt.Fprintln(w, "\nNothing has changed yet. Close the AI apps listed above, then run again with --apply.")
	case applied && plan.Keys() > 0:
		fmt.Fprintln(w, "\nDone. Restart the AI apps so they pick up the change.")
		fmt.Fprintln(w, "Next: the old keys were readable before, so replace each one with the provider and run")
		fmt.Fprintln(w, "  agentscan rotate <name>")
		fmt.Fprintln(w, "Each backup still holds the old keys. Delete it once the app works.")
	}
}

func runRotate(args []string, stdin io.Reader, stdout, stderr io.Writer) int {
	fs := flag.NewFlagSet("agentscan rotate", flag.ContinueOnError)
	fs.SetOutput(stderr)
	home := fs.String("home", "", "home directory (default: current user's)")
	list := fs.Bool("list", false, "list keys that still need replacing")
	if err := fs.Parse(args); err != nil {
		return 1
	}
	env, err := buildEnv(*home, nil)
	if err != nil {
		fmt.Fprintln(stderr, err)
		return 1
	}
	st, err := vault.LoadState(env.Home)
	if err != nil {
		fmt.Fprintln(stderr, err)
		return 1
	}
	if *list || fs.NArg() == 0 {
		pending := st.NeedsRotation()
		if len(pending) == 0 {
			fmt.Fprintln(stdout, "No keys waiting to be replaced.")
			return 0
		}
		fmt.Fprintln(stdout, "Keys moved to the password store that still need replacing:")
		for _, ref := range pending {
			e := st.Entries[ref]
			fmt.Fprintf(stdout, "  %s  (moved %s)\n", ref, e.MovedAt.Format("2006-01-02"))
		}
		fmt.Fprintln(stdout, "\nCreate a new key with the provider, then run: agentscan rotate <name>")
		return 0
	}

	ref := fs.Arg(0)
	e, ok := st.Entries[ref]
	if !ok {
		fmt.Fprintf(stderr, "%q isn't a key Agent Guard moved. Run agentscan rotate --list to see them.\n", ref)
		return 1
	}
	fmt.Fprintf(stderr, "Paste the new value for %s and press Enter: ", ref)
	line, err := bufio.NewReader(stdin).ReadString('\n')
	if err != nil && line == "" {
		fmt.Fprintln(stderr, "\nno value entered; nothing changed")
		return 1
	}
	val := strings.TrimRight(line, "\r\n")
	if val == "" {
		fmt.Fprintln(stderr, "no value entered; nothing changed")
		return 1
	}
	store := newStore()
	if old, err := store.Get(ref); err == nil && old == val {
		fmt.Fprintln(stderr, "That's the same key as before. Create a new one with the provider first.")
		return 1
	}
	if err := store.Set(ref, val); err != nil {
		fmt.Fprintln(stderr, "couldn't save to the password store:", err)
		return 1
	}
	now := time.Now().UTC()
	e.RotatedAt = &now
	st.Entries[ref] = e
	if err := st.Save(env.Home); err != nil {
		fmt.Fprintln(stderr, "key saved, but the record couldn't be updated:", err)
		return 1
	}
	fmt.Fprintf(stdout, "Saved the new key for %s. Restart %s, and revoke the old key with the provider if you haven't.\n", ref, e.App)
	return 0
}
