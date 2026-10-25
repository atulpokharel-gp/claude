// Command zinloop finds AI agent (MCP server) configurations on this
// computer and reports risky settings. It only reads files; it changes nothing
// and sends nothing over the network.
package main

import (
	"context"
	"encoding/json"
	"flag"
	"fmt"
	"io"
	"os"
	"path/filepath"
	"runtime"
	"strings"
	"time"

	"github.com/atulpokharel-gp/claude/scanner/internal/discover"
	"github.com/atulpokharel-gp/claude/scanner/internal/report"
	"github.com/atulpokharel-gp/claude/scanner/internal/rules"
	"github.com/atulpokharel-gp/claude/scanner/internal/skillscan"
	"github.com/atulpokharel-gp/claude/scanner/internal/toolprobe"
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
		case "revert":
			return runRevert(args[1:], stdout, stderr)
		case "paxel":
			return runPaxel(args[1:], stdout, stderr)
		case "install", "uninstall", "status", "logs", "service":
			return runService(args[0], args[1:], stdout, stderr)
		}
	}
	return runScan(args, stdout, stderr)
}

// buildEnv works out which folders to scan.
// goos picks which OS's config folders to look in. Tests pin it to linux so
// the fixture layout under testdata/home works on every OS.
var goos = runtime.GOOS

func buildEnv(home string, projects, extraConfigs, extraSkillDirs []string) (discover.Env, error) {
	env := discover.Env{
		GOOS:            goos,
		Home:            home,
		AppData:         os.Getenv("APPDATA"),
		ProjectDirs:     projects,
		ExtraConfigs:    extraConfigs,
		ExtraSkillDirs:  extraSkillDirs,
		ClaudeConfigDir: os.Getenv("CLAUDE_CONFIG_DIR"),
		XDGConfigHome:   os.Getenv("XDG_CONFIG_HOME"),
	}
	if home != "" {
		// A custom home must stay self-contained: ignore environment overrides
		// that could point the scanner outside it.
		env.AppData = ""
		env.ClaudeConfigDir = ""
		env.XDGConfigHome = ""
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
	fs := flag.NewFlagSet("zinloop", flag.ContinueOnError)
	fs.SetOutput(stderr)
	asJSON := fs.Bool("json", false, "print the report as JSON")
	out := fs.String("out", "", "also write the JSON report to this file")
	home := fs.String("home", "", "home directory to scan (default: current user's)")
	failOn := fs.String("fail-on", "", "exit with code 2 if any server is at or above this risk: high, medium or low")
	showVersion := fs.Bool("version", false, "print the version and exit")
	uploadURL := fs.String("upload", "", "send the report to the console at this URL (token from "+TokenEnv+" or --token-file)")
	tokenFile := fs.String("token-file", "", "file holding the console upload token")
	allUsers := fs.Bool("all-users", false, "scan every user profile on this computer (run as administrator or root, for example from an RMM tool)")
	usersDir := fs.String("users-dir", "", "with --all-users, the folder holding user profiles (default: C:\\Users, /Users or /home)")
	probeTools := fs.Bool("probe-tools", false, "start each stdio MCP server and scan its live tool list for hidden instructions (opt-in: this executes the configured servers)")
	probeTimeout := fs.Duration("probe-timeout", toolprobe.DefaultTimeout, "per-server timeout for --probe-tools")
	var projects, extraConfigs, extraSkillDirs multiFlag
	fs.Var(&projects, "project", "project folder to check for project-level configs (repeatable)")
	fs.Var(&extraConfigs, "extra-config", "extra config file to scan at a non-default path (repeatable; e.g. a container volume or RMM-pushed config)")
	fs.Var(&extraSkillDirs, "extra-skills-dir", "extra skill directory to scan at a non-default path (repeatable)")
	if err := fs.Parse(args); err != nil {
		return 1
	}
	if *showVersion {
		fmt.Fprintln(stdout, version)
		return 0
	}

	if *allUsers && *home != "" {
		fmt.Fprintln(stderr, "use either --all-users or --home, not both")
		return 1
	}
	var envs []discover.Env
	if *allUsers {
		dirs := defaultUsersDirs(goos)
		if *usersDir != "" {
			dirs = []string{*usersDir}
		}
		for i, h := range listProfiles(dirs) {
			e := discover.Env{GOOS: goos, Home: h}
			if i == 0 {
				// Scan shared bits (projects, extras) once rather than once per
				// profile. --all-users deliberately ignores the invoker's env
				// overrides, since the scanner typically runs as SYSTEM/root
				// against profiles that are not the invoker's.
				e.ProjectDirs = projects
				e.ExtraConfigs = extraConfigs
				e.ExtraSkillDirs = extraSkillDirs
			}
			if goos == "windows" {
				e.AppData = filepath.Join(h, "AppData", "Roaming")
			}
			envs = append(envs, e)
		}
		if len(envs) == 0 {
			fmt.Fprintln(stderr, "no user profiles found in", strings.Join(dirs, ", "))
			return 1
		}
	} else {
		env, err := buildEnv(*home, projects, extraConfigs, extraSkillDirs)
		if err != nil {
			fmt.Fprintln(stderr, err)
			return 1
		}
		envs = []discover.Env{env}
	}
	var token string
	var err error
	if *uploadURL != "" {
		// Check these before scanning so a bad setup fails fast.
		if _, err := checkUploadURL(*uploadURL); err != nil {
			fmt.Fprintln(stderr, err)
			return 1
		}
		if token, err = uploadToken(*tokenFile); err != nil {
			fmt.Fprintln(stderr, err)
			return 1
		}
	}
	host, _ := os.Hostname()
	meta := report.Report{
		ScannerVersion: version,
		Hostname:       host,
		OS:             runtime.GOOS,
		ScannedAt:      time.Now().UTC().Truncate(time.Second),
	}
	homes := make([]string, 0, len(envs))
	for _, env := range envs {
		homes = append(homes, env.Home)
	}
	parts := make([]report.Report, 0, len(envs))
	for _, env := range envs {
		ctx := rules.Context{Home: env.Home, NeedsRotation: map[string]bool{}}
		var stateErr error
		if st, err := vault.LoadState(env.Home); err != nil {
			stateErr = err
			fmt.Fprintf(stderr, "warning: couldn't read the record of protected keys in %s: %v\n", env.Home, err)
		} else {
			for _, ref := range st.NeedsRotation() {
				ctx.NeedsRotation[ref] = true
			}
		}
		servers, configs, cfgWarnings := discover.ScanWithWarnings(env)
		if stateErr != nil {
			// Without the record we can't tell which protected keys still need
			// rotating, so put the failure in the report. The console then
			// shows a warning and won't count this scan as complete.
			configs = append(configs, discover.ConfigResult{
				Location: discover.Location{App: "Zinloop key record", Path: vault.StatePath(env.Home)},
				Found:    true,
				Error:    "couldn't read the record of protected keys: " + stateErr.Error(),
			})
		}
		skills, skillDirs, skillWarnings := skillscan.ScanWithWarnings(env)
		warnings := append(cfgWarnings, skillWarnings...)
		part := report.BuildWithWarnings(servers, configs, skills, skillDirs, warnings, ctx, meta)
		if *probeTools {
			fmt.Fprintln(stderr, "warning: --probe-tools starts each stdio MCP server to list its tools; disable it if you don't trust the configured servers.")
			tools, probes := probeAllAsRules(servers, *probeTimeout)
			part = report.WithTools(part, tools, probes)
		}
		for i := range part.Servers {
			part.Servers[i].User = ownerOf(part.Servers[i].ConfigPath, homes)
		}
		for i := range part.Skills {
			part.Skills[i].User = ownerOf(part.Skills[i].Path, homes)
		}
		parts = append(parts, part)
	}
	rep := report.Merge(meta, parts)

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

	if *uploadURL != "" {
		if err := upload(*uploadURL, token, rep); err != nil {
			fmt.Fprintln(stderr, "upload failed:", err)
			return 3
		}
		fmt.Fprintln(stderr, "Scan sent to the console.")
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
		for _, s := range rep.Skills {
			if s.Risk.Rank() >= threshold.Rank() {
				return 2
			}
		}
		for _, pw := range rep.PathWarnings {
			if rules.Severity(pw.Severity).Rank() >= threshold.Rank() {
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

// ownerOf returns the profile name (home folder name) whose home holds path, or
// "" when no scanned home does, as for a shared --project folder. It is never
// guessed from which profile happened to scan the file.
func ownerOf(path string, homes []string) string {
	best := ""
	for _, h := range homes {
		if within(path, h) && len(h) > len(best) {
			best = h
		}
	}
	if best == "" {
		return ""
	}
	return filepath.Base(best)
}

// probeAllAsRules runs the stdio tool probe on every discovered server and
// converts the output into the rules.Tool / report.ToolProbeResult types the
// report layer expects.
func probeAllAsRules(servers []discover.Server, timeout time.Duration) ([]rules.Tool, []report.ToolProbeResult) {
	results := toolprobe.ProbeAll(context.Background(), servers, toolprobe.Options{Timeout: timeout})
	var tools []rules.Tool
	probes := make([]report.ToolProbeResult, 0, len(results))
	for _, r := range results {
		probes = append(probes, report.ToolProbeResult{Server: r.Server, Tools: len(r.Tools), Error: r.Error})
		for _, t := range r.Tools {
			tools = append(tools, rules.Tool{Server: r.Server, Name: t.Name, Description: t.Description})
		}
	}
	return tools, probes
}

// within reports whether path is dir or inside it. On Windows the comparison
// ignores case, as filepath.Rel does there.
func within(path, dir string) bool {
	rel, err := filepath.Rel(dir, path)
	if err != nil || filepath.IsAbs(rel) {
		return false
	}
	return rel != ".." && !strings.HasPrefix(rel, ".."+string(filepath.Separator))
}
