package main

import (
	"bytes"
	"context"
	"errors"
	"flag"
	"fmt"
	"io"
	"math/rand"
	"os"
	"os/signal"
	"path/filepath"
	"runtime"
	"strings"
	"syscall"
	"time"
)

// serviceLabel is the system name used by the OS service manager: the systemd
// unit, the launchd Label, and the Windows scheduled task.
const serviceLabel = "zinloop"

// runService dispatches `zinloop install|uninstall|status|logs|service ...`.
// It is wired into main.go's top-level switch.
func runService(sub string, args []string, stdout, stderr io.Writer) int {
	switch sub {
	case "install":
		return runInstall(args, stdout, stderr)
	case "uninstall":
		return runUninstall(args, stdout, stderr)
	case "status":
		return runStatus(args, stdout, stderr)
	case "logs":
		return runLogs(args, stdout, stderr)
	case "service":
		return runServiceSub(args, stdout, stderr)
	}
	fmt.Fprintf(stderr, "zinloop: unknown command %q\n", sub)
	return 2
}

func runServiceSub(args []string, stdout, stderr io.Writer) int {
	if len(args) == 0 {
		fmt.Fprintln(stderr, "usage: zinloop service run")
		return 2
	}
	switch args[0] {
	case "run":
		return runDaemon(args[1:], stdout, stderr)
	}
	fmt.Fprintf(stderr, "zinloop: unknown service command %q\n", args[0])
	return 2
}

// runInstall sets up the service: validates the token, copies the running
// binary to a stable install path, writes config + token, installs the OS
// service unit, and starts it (unless --no-start).
func runInstall(args []string, stdout, stderr io.Writer) int {
	fs := flag.NewFlagSet("install", flag.ContinueOnError)
	fs.SetOutput(stderr)
	url := fs.String("url", "", "console URL (https://zinloop.com)")
	token := fs.String("token", "", "upload token (zlu_...) — prefer --token-file in automation")
	tokenFile := fs.String("token-file", "", "file holding the upload token")
	interval := fs.Int("interval-hours", defaultIntervalHours, "hours between scheduled scans")
	jitter := fs.Int("jitter-seconds", defaultJitterSeconds, "random extra delay added to each scan, in seconds")
	allUsers := fs.Bool("all-users", true, "scan every user profile on this computer (needs root/Administrator)")
	noStart := fs.Bool("no-start", false, "don't start the service after installing")
	force := fs.Bool("force", false, "overwrite an existing install")
	if err := fs.Parse(args); err != nil {
		return 2
	}
	if *url == "" {
		fmt.Fprintln(stderr, "install needs --url, e.g. https://zinloop.com")
		return 2
	}
	if _, err := checkUploadURL(*url); err != nil {
		fmt.Fprintln(stderr, err)
		return 2
	}

	// Read the token from --token or --token-file. --token is accepted but
	// discouraged because command-line args can leak via /proc.
	tok := strings.TrimSpace(*token)
	if tok == "" && *tokenFile != "" {
		b, err := os.ReadFile(*tokenFile)
		if err != nil {
			fmt.Fprintln(stderr, "cannot read --token-file:", err)
			return 1
		}
		tok = strings.TrimSpace(string(b))
	}
	if tok == "" {
		fmt.Fprintln(stderr, "install needs --token zlu_... or --token-file")
		return 2
	}
	if !strings.HasPrefix(tok, "zlu_") && !strings.HasPrefix(tok, "agu_") {
		fmt.Fprintln(stderr, "that doesn't look like an upload token (it should start with zlu_)")
		return 2
	}

	// Need root on Unix, Administrator on Windows — writing to /etc, /Library,
	// or C:\Program Files, and talking to the OS service manager, both fail
	// otherwise.
	if err := requireAdmin(); err != nil {
		fmt.Fprintln(stderr, err)
		return 1
	}

	// Guard an existing install so a user who re-runs `install` without
	// --force doesn't accidentally stomp a working config.
	if _, err := os.Stat(configPath()); err == nil && !*force {
		fmt.Fprintf(stderr, "zinloop is already installed (config at %s); pass --force to overwrite\n", configPath())
		return 1
	}

	if err := copySelf(installedBinary()); err != nil {
		fmt.Fprintln(stderr, "cannot copy the binary:", err)
		return 1
	}
	if err := writeToken(tok); err != nil {
		fmt.Fprintln(stderr, "cannot write the token file:", err)
		return 1
	}
	cfg := serviceConfig{
		URL:           strings.TrimRight(*url, "/"),
		TokenFile:     tokenPath(),
		IntervalHours: *interval,
		JitterSeconds: *jitter,
		AllUsers:      *allUsers,
	}
	if err := writeConfig(cfg); err != nil {
		fmt.Fprintln(stderr, "cannot write the config file:", err)
		return 1
	}

	if err := installService(stdout, stderr); err != nil {
		fmt.Fprintln(stderr, "service install failed:", err)
		return 1
	}

	if !*noStart {
		if err := startService(stdout, stderr); err != nil {
			fmt.Fprintln(stderr, "could not start the service:", err)
			return 1
		}
	}

	fmt.Fprintf(stdout, "Zinloop installed.\n")
	fmt.Fprintf(stdout, "  binary:   %s\n", installedBinary())
	fmt.Fprintf(stdout, "  config:   %s\n", configPath())
	fmt.Fprintf(stdout, "  token:    %s\n", tokenPath())
	fmt.Fprintf(stdout, "  schedule: every %dh +/- %ds jitter\n", cfg.IntervalHours, cfg.JitterSeconds)
	fmt.Fprintf(stdout, "Watch it with: zinloop status  |  zinloop logs\n")
	return 0
}

func runUninstall(args []string, stdout, stderr io.Writer) int {
	fs := flag.NewFlagSet("uninstall", flag.ContinueOnError)
	fs.SetOutput(stderr)
	purge := fs.Bool("purge", false, "also remove the config, token and state files")
	if err := fs.Parse(args); err != nil {
		return 2
	}
	if err := requireAdmin(); err != nil {
		fmt.Fprintln(stderr, err)
		return 1
	}
	// Stopping first keeps the OS service manager from clinging to the unit
	// file while we try to remove it. Errors are logged but not fatal — a
	// unit that's already gone shouldn't block removal.
	if err := stopService(stdout, stderr); err != nil {
		fmt.Fprintln(stderr, "stop:", err)
	}
	if err := uninstallService(stdout, stderr); err != nil {
		fmt.Fprintln(stderr, "uninstall:", err)
		return 1
	}
	if *purge {
		for _, p := range []string{configPath(), tokenPath(), statePath()} {
			if err := os.Remove(p); err != nil && !errors.Is(err, os.ErrNotExist) {
				fmt.Fprintf(stderr, "could not remove %s: %v\n", p, err)
			}
		}
		// configDir may legitimately be shared (e.g. /etc) elsewhere, so only
		// remove it when it's now empty.
		if entries, err := os.ReadDir(configDir()); err == nil && len(entries) == 0 {
			_ = os.Remove(configDir())
		}
	}
	fmt.Fprintln(stdout, "Zinloop uninstalled.")
	return 0
}

func runStatus(args []string, stdout, stderr io.Writer) int {
	fs := flag.NewFlagSet("status", flag.ContinueOnError)
	fs.SetOutput(stderr)
	if err := fs.Parse(args); err != nil {
		return 2
	}
	cfg, cfgErr := readConfig()
	if cfgErr != nil {
		fmt.Fprintf(stdout, "Zinloop isn't installed (no config at %s).\n", configPath())
		return 1
	}
	st := readState()
	fmt.Fprintf(stdout, "Zinloop service\n")
	fmt.Fprintf(stdout, "  console:  %s\n", cfg.URL)
	fmt.Fprintf(stdout, "  interval: every %dh +/- %ds jitter\n", cfg.IntervalHours, cfg.JitterSeconds)
	if st.LastScanAt.IsZero() {
		fmt.Fprintf(stdout, "  scans:    none yet\n")
	} else {
		fmt.Fprintf(stdout, "  scans:    %d ok / %d failed, last %s ago\n",
			st.ScansOK, st.ScansFailed, time.Since(st.LastScanAt).Round(time.Second))
	}
	if st.LastError != "" {
		fmt.Fprintf(stdout, "  warning:  %s\n", st.LastError)
	}
	fmt.Fprintln(stdout)
	if err := printServiceStatus(stdout, stderr); err != nil {
		fmt.Fprintln(stderr, "could not read service status:", err)
		return 1
	}
	return 0
}

func runLogs(args []string, stdout, stderr io.Writer) int {
	fs := flag.NewFlagSet("logs", flag.ContinueOnError)
	fs.SetOutput(stderr)
	follow := fs.Bool("follow", false, "keep streaming new log lines")
	lines := fs.Int("lines", 200, "show this many trailing lines")
	if err := fs.Parse(args); err != nil {
		return 2
	}
	if err := printServiceLogs(*lines, *follow, stdout, stderr); err != nil {
		fmt.Fprintln(stderr, "could not read logs:", err)
		return 1
	}
	return 0
}

// runDaemon is the body of the long-running service. It scans once at
// startup, then loops with jittered sleeps and reacts to SIGTERM.
func runDaemon(args []string, stdout, stderr io.Writer) int {
	fs := flag.NewFlagSet("service run", flag.ContinueOnError)
	fs.SetOutput(stderr)
	oneShot := fs.Bool("once", false, "scan once and exit (for `zinloop service run --once` smoke tests)")
	if err := fs.Parse(args); err != nil {
		return 2
	}

	cfg, err := readConfig()
	if err != nil {
		fmt.Fprintln(stderr, "service cannot start:", err)
		return 1
	}

	ctx, cancel := signal.NotifyContext(context.Background(), syscall.SIGINT, syscall.SIGTERM)
	defer cancel()

	fmt.Fprintf(stdout, "zinloop service %s started; interval %dh +/- %ds\n",
		version, cfg.IntervalHours, cfg.JitterSeconds)

	for {
		runScanOnce(cfg, stdout, stderr)
		if *oneShot {
			return 0
		}
		d := nextDelay(cfg)
		fmt.Fprintf(stdout, "next scan in %s\n", d.Round(time.Second))
		select {
		case <-time.After(d):
		case <-ctx.Done():
			fmt.Fprintln(stdout, "zinloop service shutting down")
			return 0
		}
	}
}

// nextDelay returns intervalHours plus a uniform random extra in
// [0, jitterSeconds). Separated out so a test can stub it.
var nextDelay = func(cfg serviceConfig) time.Duration {
	base := time.Duration(cfg.IntervalHours) * time.Hour
	if cfg.JitterSeconds <= 0 {
		return base
	}
	return base + time.Duration(rand.Int63n(int64(cfg.JitterSeconds)))*time.Second
}

// runScanOnce invokes runScan with the service's config via its CLI args, so
// we reuse the exact same code path as a manual `zinloop --upload --token-file`.
// Returning via writeState keeps `status` honest about what the daemon did.
func runScanOnce(cfg serviceConfig, stdout, stderr io.Writer) {
	args := []string{"--upload", cfg.URL + "/api/scans", "--token-file", cfg.TokenFile}
	if cfg.AllUsers {
		args = append(args, "--all-users")
	}
	st := readState()
	st.LastScanAt = time.Now().UTC()

	// Buffer stderr so we can both show it and capture any failure message
	// into the state file.
	var errBuf bytes.Buffer
	code := runScan(args, stdout, io.MultiWriter(stderr, &errBuf))
	if code == 0 {
		st.ScansOK++
		st.LastUploadAt = st.LastScanAt
		st.LastError = ""
	} else {
		st.ScansFailed++
		msg := strings.TrimSpace(errBuf.String())
		if len(msg) > 500 {
			msg = msg[:500]
		}
		if msg == "" {
			msg = fmt.Sprintf("scan exited %d", code)
		}
		st.LastError = msg
	}
	if err := writeState(st); err != nil {
		fmt.Fprintln(stderr, "could not write service state:", err)
	}
}

// copySelf copies the running binary (os.Executable) to dst, 0755. If dst
// already resolves to the same file we skip the copy — this is the usual case
// after the first install, since the installer tells the service manager to
// run installedBinary() directly.
func copySelf(dst string) error {
	src, err := os.Executable()
	if err != nil {
		return err
	}
	if same, _ := sameFile(src, dst); same {
		return nil
	}
	if err := os.MkdirAll(filepath.Dir(dst), 0o755); err != nil {
		return err
	}
	in, err := os.Open(src)
	if err != nil {
		return err
	}
	defer in.Close()
	// Write to a sidecar then rename so a crashed install never leaves a
	// half-written binary at the final path.
	tmp := dst + ".new"
	out, err := os.OpenFile(tmp, os.O_WRONLY|os.O_CREATE|os.O_TRUNC, 0o755)
	if err != nil {
		return err
	}
	if _, err := io.Copy(out, in); err != nil {
		out.Close()
		return err
	}
	if err := out.Close(); err != nil {
		return err
	}
	return os.Rename(tmp, dst)
}

func sameFile(a, b string) (bool, error) {
	ai, err := os.Stat(a)
	if err != nil {
		return false, err
	}
	bi, err := os.Stat(b)
	if err != nil {
		return false, nil
	}
	return os.SameFile(ai, bi), nil
}

// requireAdmin fails fast on Unix when run as non-root, before we try to
// write /etc or call systemctl and produce a less-helpful error.
func requireAdmin() error {
	if runtime.GOOS == "windows" {
		// Windows service create / schtasks /create failure messages are
		// clear enough; skipping the pre-check avoids a Windows-only
		// token-impersonation probe here.
		return nil
	}
	if os.Geteuid() != 0 {
		return errors.New("install needs root (try: sudo zinloop install --url ... --token ...)")
	}
	return nil
}
