package fix

import (
	"encoding/json"
	"errors"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"github.com/atulpokharel-gp/claude/scanner/internal/discover"
	"github.com/atulpokharel-gp/claude/scanner/internal/rules"
	"github.com/atulpokharel-gp/claude/scanner/internal/vault"
)

// copyFixtures copies testdata/home into a temp dir so tests can change files.
func copyFixtures(t *testing.T) string {
	t.Helper()
	src, _ := filepath.Abs("../../testdata/home")
	dst := t.TempDir()
	err := filepath.Walk(src, func(p string, info os.FileInfo, err error) error {
		if err != nil {
			return err
		}
		rel, _ := filepath.Rel(src, p)
		target := filepath.Join(dst, rel)
		if info.IsDir() {
			return os.MkdirAll(target, 0o755)
		}
		data, err := os.ReadFile(p)
		if err != nil {
			return err
		}
		return os.WriteFile(target, data, 0o644)
	})
	if err != nil {
		t.Fatal(err)
	}
	return dst
}

func scan(home string) []discover.Server {
	s, _ := discover.Scan(discover.Env{GOOS: "linux", Home: home})
	return s
}

func TestPlan(t *testing.T) {
	home := copyFixtures(t)
	plan := MakePlan(scan(home))
	if plan.Keys() != 2 {
		t.Fatalf("plan moves %d keys, want 2 (github token, stripe key): %+v", plan.Keys(), plan)
	}
	refs := map[string]bool{}
	for _, f := range plan.Files {
		for _, s := range f.Servers {
			for _, r := range s.Refs {
				refs[r] = true
			}
		}
	}
	for _, want := range []string{"claude-desktop/github/GITHUB_PERSONAL_ACCESS_TOKEN", "claude-code/app/stripe/STRIPE_SECRET_KEY"} {
		if !refs[want] {
			t.Errorf("missing ref %s in %v", want, refs)
		}
	}
}

func TestApplyMovesKeysAndKeepsServerWorking(t *testing.T) {
	home := copyFixtures(t)
	store := vault.Memory{}
	desktopCfg := filepath.Join(home, ".config", "Claude", "claude_desktop_config.json")
	before, _ := os.ReadFile(desktopCfg)

	plan, err := Apply(MakePlan(scan(home)), Options{
		Home: home, Launcher: "/opt/agentguard/agentscan", Store: store,
		Now: func() time.Time { return time.Date(2026, 10, 24, 15, 0, 0, 0, time.UTC) },
	})
	if err != nil {
		t.Fatal(err)
	}
	for _, f := range plan.Files {
		if f.Error != "" {
			t.Fatalf("%s: %s", f.Path, f.Error)
		}
	}

	// Keys are in the store with their original values.
	if store["claude-desktop/github/GITHUB_PERSONAL_ACCESS_TOKEN"] != "fake-demo-token-not-real-0001" {
		t.Errorf("github token not stored: %v", store)
	}
	if store["claude-code/app/stripe/STRIPE_SECRET_KEY"] != "fake-stripe-value-not-real" {
		t.Errorf("stripe key not stored: %v", store)
	}

	// No config file still contains a key.
	for _, p := range []string{desktopCfg, filepath.Join(home, ".claude.json")} {
		data, _ := os.ReadFile(p)
		if strings.Contains(string(data), "fake-demo-token") || strings.Contains(string(data), "fake-stripe-value") {
			t.Errorf("%s still holds a key", p)
		}
	}

	// The backup is the exact original and private.
	backup := desktopCfg + ".agentguard-backup-20261024-150000"
	got, err := os.ReadFile(backup)
	if err != nil || string(got) != string(before) {
		t.Fatalf("backup missing or different: %v", err)
	}
	if info, _ := os.Stat(backup); info.Mode().Perm() != 0o600 {
		t.Errorf("backup mode %v, want 0600", info.Mode().Perm())
	}

	// A rescan sees the same servers, now protected, with the real command intact
	// and no plain-text secret finding.
	byName := map[string]discover.Server{}
	for _, s := range scan(home) {
		byName[s.Name] = s
	}
	gh := byName["github"]
	if gh.Command != "npx" || strings.Join(gh.Args, " ") != "-y @modelcontextprotocol/server-github" {
		t.Errorf("github real command lost: %q %q", gh.Command, gh.Args)
	}
	if len(gh.Protected) != 1 || gh.Protected[0].Env != "GITHUB_PERSONAL_ACCESS_TOKEN" {
		t.Errorf("github protected = %+v", gh.Protected)
	}
	for _, f := range rules.Check(gh, rules.Context{}) {
		if f.RuleID == "SECRET_IN_CONFIG" {
			t.Error("github still flagged for a plain-text secret")
		}
	}
	if byName["stripe"].Scope != "/home/demo/app" || len(byName["stripe"].Protected) != 1 {
		t.Errorf("stripe project server not protected: %+v", byName["stripe"])
	}
	// Other servers and settings in the same files are untouched.
	if byName["files"].Command != "npx" || len(byName["files"].Protected) != 0 {
		t.Errorf("unrelated server changed: %+v", byName["files"])
	}
	var claudeJSON map[string]any
	data, _ := os.ReadFile(filepath.Join(home, ".claude.json"))
	_ = json.Unmarshal(data, &claudeJSON)
	if claudeJSON["numStartups"] != float64(12) {
		t.Errorf("unrelated setting changed: %v", claudeJSON["numStartups"])
	}

	// The record lists both keys as needing replacement, with no values.
	st, err := vault.LoadState(home)
	if err != nil {
		t.Fatal(err)
	}
	if len(st.NeedsRotation()) != 2 {
		t.Errorf("needs rotation = %v", st.NeedsRotation())
	}
	raw, _ := os.ReadFile(vault.StatePath(home))
	if strings.Contains(string(raw), "fake-") {
		t.Error("state file contains a secret value")
	}

	// Running the fix again finds nothing left to move.
	if again := MakePlan(scan(home)); again.Keys() != 0 {
		t.Errorf("second run would move %d keys", again.Keys())
	}
}

type failingStore struct{ vault.Memory }

func (failingStore) Set(string, string) error { return errors.New("keychain locked") }

func TestApplyLeavesFileAloneWhenStoreFails(t *testing.T) {
	home := copyFixtures(t)
	cfg := filepath.Join(home, ".config", "Claude", "claude_desktop_config.json")
	before, _ := os.ReadFile(cfg)

	plan, err := Apply(MakePlan(scan(home)), Options{Home: home, Launcher: "/x/agentscan", Store: failingStore{vault.Memory{}}})
	if err != nil {
		t.Fatal(err)
	}
	for _, f := range plan.Files {
		if f.Error == "" {
			t.Errorf("%s: expected an error", f.Path)
		}
		if f.Backup != "" {
			t.Errorf("%s: no backup should be made when nothing changes", f.Path)
		}
	}
	after, _ := os.ReadFile(cfg)
	if string(after) != string(before) {
		t.Error("config changed even though the store failed")
	}
}

func TestVSCodeSettingsIsBlocked(t *testing.T) {
	home := t.TempDir()
	dir := filepath.Join(home, ".config", "Code", "User")
	_ = os.MkdirAll(dir, 0o755)
	_ = os.WriteFile(filepath.Join(dir, "settings.json"), []byte(`{
  // comment
  "mcp": {"servers": {"gh": {"command": "npx", "args": ["gh-mcp@1.0.0"], "env": {"GITHUB_TOKEN": "abc"}}}}
}`), 0o644)
	plan := MakePlan(scan(home))
	if len(plan.Files) != 1 || plan.Files[0].Blocked == "" || plan.Keys() != 0 {
		t.Fatalf("settings.json should be blocked: %+v", plan)
	}
}

func TestManualItemsForHeadersArgsAndRemote(t *testing.T) {
	servers := []discover.Server{
		{Name: "h", Transport: "remote", URL: "https://x.example/mcp", Headers: map[string]string{"Authorization": "Bearer abcdefghijklmnopqrstu"}},
		{Name: "a", Transport: "stdio", Command: "/bin/x", Args: []string{"--password", "hunter2hunter2"}},
	}
	plan := MakePlan(servers)
	if len(plan.Manual) != 2 || plan.Keys() != 0 {
		t.Errorf("manual = %+v", plan.Manual)
	}
}

func TestApplyMergesWithAlreadyProtectedServer(t *testing.T) {
	home := t.TempDir()
	cfg := filepath.Join(home, ".cursor", "mcp.json")
	_ = os.MkdirAll(filepath.Dir(cfg), 0o755)
	_ = os.WriteFile(cfg, []byte(`{"mcpServers":{"db":{"command":"/opt/agentscan","args":["exec","--secret","A_TOKEN=cursor/db/A_TOKEN","--","db-mcp","--ro"],"env":{"B_PASSWORD":"pw"}}}}`), 0o600)
	store := vault.Memory{}
	if _, err := Apply(MakePlan(scan(home)), Options{Home: home, Launcher: "/opt/agentscan", Store: store}); err != nil {
		t.Fatal(err)
	}
	s := scan(home)[0]
	if s.Command != "db-mcp" || strings.Join(s.Args, " ") != "--ro" || len(s.Protected) != 2 {
		t.Errorf("merge failed: %+v", s)
	}
	if info, _ := os.Stat(cfg); info.Mode().Perm() != 0o600 {
		t.Errorf("file mode changed to %v", info.Mode().Perm())
	}
}
