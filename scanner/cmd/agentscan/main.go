// Command agentscan finds AI agent (MCP server) configurations on this
// computer and reports risky settings. It only reads files; it changes nothing
// and sends nothing over the network.
package main

import (
	"encoding/json"
	"flag"
	"fmt"
	"io"
	"os"
	"runtime"
	"strings"
	"time"

	"github.com/atulpokharel-gp/claude/scanner/internal/discover"
	"github.com/atulpokharel-gp/claude/scanner/internal/report"
	"github.com/atulpokharel-gp/claude/scanner/internal/rules"
	"github.com/atulpokharel-gp/claude/scanner/internal/vault"
)

// version is set at build time with -ldflags "-X main.version=..."
var version = "dev"

type multiFlag []string

func (m *multiFlag) String() string     { return strings.Join(*m, ",") }
func (m *multiFlag) Set(v string) error { *m = append(*m, v); return nil }

func main() {
	os.Exit(run(os.Args[1:], os.Stdout, os.Stderr))
}

// newStore opens the password store. Tests replace it with an in-memory one.
var newStore = func() vault.Store { return vault.Keyring{} }

func run(args []string, stdout, stderr io.Writer) int {
	if len(args) > 0 {
		switch args[0] {
		case "fix-secrets":
			return runFix(args[1:], stdout, stderr)
		case discover.LauncherSubcommand:
			return runExec(args[1:], stderr)
		case "rotate":
			return runRotate(args[1:], os.Stdin, stdout, stderr)
		}
	}
	return runScan(args, stdout, stderr)
}

// buildEnv works out which folders to scan.
func buildEnv(home string, projects []string) (discover.Env, error) {
	env := discover.Env{GOOS: runtime.GOOS, Home: home, AppData: os.Getenv("APPDATA"), ProjectDirs: projects}
	if home != "" {
		env.AppData = "" // keep a custom home self-contained
		return env, nil
	}
	h, err := os.UserHomeDir()
	if err != nil {
		return env, fmt.Errorf("cannot find home directory: %w", err)
	}
	env.Home = h
	return env, nil
}

func runScan(args []string, stdout, stderr io.Writer) int {
	fs := flag.NewFlagSet("agentscan", flag.ContinueOnError)
	fs.SetOutput(stderr)
	asJSON := fs.Bool("json", false, "print the report as JSON")
	out := fs.String("out", "", "also write the JSON report to this file")
	home := fs.String("home", "", "home directory to scan (default: current user's)")
	failOn := fs.String("fail-on", "", "exit with code 2 if any server is at or above this risk: high, medium or low")
	showVersion := fs.Bool("version", false, "print the version and exit")
	var projects multiFlag
	fs.Var(&projects, "project", "project folder to check for project-level configs (repeatable)")
	if err := fs.Parse(args); err != nil {
		return 1
	}
	if *showVersion {
		fmt.Fprintln(stdout, version)
		return 0
	}

	env, err := buildEnv(*home, projects)
	if err != nil {
		fmt.Fprintln(stderr, err)
		return 1
	}
	ctx := rules.Context{Home: env.Home, NeedsRotation: map[string]bool{}}
	if st, err := vault.LoadState(env.Home); err != nil {
		fmt.Fprintln(stderr, "warning: couldn't read the record of protected keys:", err)
	} else {
		for _, ref := range st.NeedsRotation() {
			ctx.NeedsRotation[ref] = true
		}
	}

	host, _ := os.Hostname()
	servers, configs := discover.Scan(env)
	rep := report.Build(servers, configs, ctx, report.Report{
		ScannerVersion: version,
		Hostname:       host,
		OS:             runtime.GOOS,
		ScannedAt:      time.Now().UTC().Truncate(time.Second),
	})

	if *out != "" {
		if err := writeJSONFile(*out, rep); err != nil {
			fmt.Fprintln(stderr, "cannot write report:", err)
			return 1
		}
	}
	if *asJSON {
		enc := json.NewEncoder(stdout)
		enc.SetIndent("", "  ")
		if err := enc.Encode(rep); err != nil {
			fmt.Fprintln(stderr, err)
			return 1
		}
	} else {
		report.WriteText(stdout, rep)
	}

	if *failOn != "" {
		threshold := rules.Severity(strings.ToLower(*failOn))
		if threshold.Rank() == 0 {
			fmt.Fprintln(stderr, "--fail-on must be high, medium or low")
			return 1
		}
		for _, s := range rep.Servers {
			if s.Risk.Rank() >= threshold.Rank() {
				return 2
			}
		}
	}
	return 0
}

func writeJSONFile(path string, rep report.Report) error {
	data, err := json.MarshalIndent(rep, "", "  ")
	if err != nil {
		return err
	}
	// The report has no secrets, but it does list tools in use; keep it private.
	return os.WriteFile(path, append(data, '\n'), 0o600)
}
