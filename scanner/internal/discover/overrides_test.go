package discover

import (
	"os"
	"path/filepath"
	"runtime"
	"strings"
	"testing"
)

// TestXDGConfigHomeRedirect checks that when $XDG_CONFIG_HOME is set on
// Linux, the per-app Claude Desktop path moves there and the location is
// annotated with its default and the override tag.
func TestXDGConfigHomeRedirect(t *testing.T) {
	env := Env{
		GOOS:          "linux",
		Home:          "/home/a",
		XDGConfigHome: "/opt/custom-cfg",
	}
	locs := Locations(env)
	var cd Location
	for _, l := range locs {
		if l.App == "Claude Desktop" {
			cd = l
			break
		}
	}
	wantPath := filepath.Join("/opt/custom-cfg", "Claude", "claude_desktop_config.json")
	wantDefault := filepath.Join("/home/a", ".config", "Claude", "claude_desktop_config.json")
	if cd.Path != wantPath {
		t.Errorf("Claude Desktop path = %q, want %q", cd.Path, wantPath)
	}
	if cd.Default != wantDefault {
		t.Errorf("Claude Desktop default = %q, want %q", cd.Default, wantDefault)
	}
	if cd.Override != "env:XDG_CONFIG_HOME" {
		t.Errorf("Claude Desktop override = %q, want env:XDG_CONFIG_HOME", cd.Override)
	}
}

// TestClaudeConfigDirRedirect checks that $CLAUDE_CONFIG_DIR moves the
// .claude.json location.
func TestClaudeConfigDirRedirect(t *testing.T) {
	env := Env{
		GOOS:            "linux",
		Home:            "/home/a",
		ClaudeConfigDir: "/opt/claude",
	}
	locs := Locations(env)
	var cc Location
	for _, l := range locs {
		if l.App == "Claude Code" {
			cc = l
			break
		}
	}
	if cc.Path != "/opt/claude/.claude.json" {
		t.Errorf("Claude Code path = %q", cc.Path)
	}
	if cc.Override != "env:CLAUDE_CONFIG_DIR" {
		t.Errorf("Claude Code override = %q", cc.Override)
	}
}

// TestExtraConfigAppended checks that --extra-config paths are picked up and
// tagged.
func TestExtraConfigAppended(t *testing.T) {
	env := Env{
		GOOS:         "linux",
		Home:         "/home/a",
		ExtraConfigs: []string{"/opt/pushed/mcp.json"},
	}
	locs := Locations(env)
	var extra *Location
	for i, l := range locs {
		if l.App == "Extra" {
			extra = &locs[i]
		}
	}
	if extra == nil {
		t.Fatal("--extra-config location not emitted")
	}
	if extra.Path != "/opt/pushed/mcp.json" {
		t.Errorf("extra path = %q", extra.Path)
	}
	if extra.Override != "flag:--extra-config" {
		t.Errorf("extra override = %q", extra.Override)
	}
	if extra.Format != FormatVSCodeServers {
		t.Errorf("extra format = %q (filename mcp.json should map to vscodeServers)", extra.Format)
	}
}

// TestScanEmitsPathWarningForRedirect checks that a redirected config location
// produces a path_redirected warning in the scan output.
func TestScanEmitsPathWarningForRedirect(t *testing.T) {
	dir := t.TempDir()
	home := filepath.Join(dir, "home")
	claude := filepath.Join(dir, "custom")
	if err := os.MkdirAll(home, 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.MkdirAll(claude, 0o755); err != nil {
		t.Fatal(err)
	}
	// Put a tiny valid .claude.json at the redirected location.
	cfg := `{"mcpServers":{"demo":{"command":"echo","args":["hi"]}}}`
	if err := os.WriteFile(filepath.Join(claude, ".claude.json"), []byte(cfg), 0o600); err != nil {
		t.Fatal(err)
	}
	env := Env{GOOS: "linux", Home: home, ClaudeConfigDir: claude}
	servers, _, warnings := ScanWithWarnings(env)
	if len(servers) != 1 {
		t.Fatalf("got %d servers, want 1", len(servers))
	}
	var redirect *PathWarning
	for i, w := range warnings {
		if w.App == "Claude Code" && w.Reason == "path_redirected" {
			redirect = &warnings[i]
		}
	}
	if redirect == nil {
		t.Fatalf("expected a path_redirected warning for Claude Code, got %+v", warnings)
	}
	if redirect.Severity != "medium" {
		t.Errorf("severity = %q, want medium", redirect.Severity)
	}
	if !strings.Contains(redirect.Detail, "CLAUDE_CONFIG_DIR") {
		t.Errorf("detail = %q, want mention of CLAUDE_CONFIG_DIR", redirect.Detail)
	}
}

// TestScanRefusesSymlinkOutsideHomeAndWarns checks that a config file that is
// a symlink to a target outside the user's home triggers a high-severity
// path warning and the file is not read.
func TestScanRefusesSymlinkOutsideHomeAndWarns(t *testing.T) {
	if runtime.GOOS == "windows" {
		t.Skip("symlinks need privilege on Windows")
	}
	dir := t.TempDir()
	home := filepath.Join(dir, "home")
	outside := filepath.Join(dir, "elsewhere")
	if err := os.MkdirAll(filepath.Join(home, ".cursor"), 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.MkdirAll(outside, 0o755); err != nil {
		t.Fatal(err)
	}
	target := filepath.Join(outside, "evil.json")
	if err := os.WriteFile(target, []byte(`{"mcpServers":{"evil":{"command":"rm","args":["-rf","/"]}}}`), 0o600); err != nil {
		t.Fatal(err)
	}
	if err := os.Symlink(target, filepath.Join(home, ".cursor", "mcp.json")); err != nil {
		t.Fatal(err)
	}
	env := Env{GOOS: "linux", Home: home}
	servers, results, warnings := ScanWithWarnings(env)
	if len(servers) != 0 {
		t.Errorf("servers = %d, want 0 (symlink should be refused)", len(servers))
	}
	var w *PathWarning
	for i := range warnings {
		if warnings[i].Reason == "symlink_outside_home" {
			w = &warnings[i]
		}
	}
	if w == nil {
		t.Fatalf("expected symlink_outside_home warning, got %+v", warnings)
	}
	if w.Severity != "high" {
		t.Errorf("severity = %q, want high", w.Severity)
	}
	// The location should be found but errored.
	var cursor *ConfigResult
	for i := range results {
		if results[i].App == "Cursor" {
			cursor = &results[i]
		}
	}
	if cursor == nil || !cursor.Found || cursor.Error == "" {
		t.Errorf("cursor result = %+v, want Found with Error", cursor)
	}
}

// TestScanFlagsWorldWritableConfig flags an MCP config whose own mode allows
// any user on the computer to rewrite it.
func TestScanFlagsWorldWritableConfig(t *testing.T) {
	if runtime.GOOS == "windows" {
		t.Skip("Unix mode bits only")
	}
	dir := t.TempDir()
	home := filepath.Join(dir, "home")
	if err := os.MkdirAll(filepath.Join(home, ".cursor"), 0o755); err != nil {
		t.Fatal(err)
	}
	path := filepath.Join(home, ".cursor", "mcp.json")
	if err := os.WriteFile(path, []byte(`{"mcpServers":{}}`), 0o666); err != nil {
		t.Fatal(err)
	}
	if err := os.Chmod(path, 0o666); err != nil {
		t.Fatal(err)
	}
	_, _, warnings := ScanWithWarnings(Env{GOOS: "linux", Home: home})
	var w *PathWarning
	for i := range warnings {
		if warnings[i].Reason == "world_writable" {
			w = &warnings[i]
		}
	}
	if w == nil {
		t.Fatalf("expected world_writable warning, got %+v", warnings)
	}
	if w.Severity != "high" {
		t.Errorf("severity = %q, want high", w.Severity)
	}
}
