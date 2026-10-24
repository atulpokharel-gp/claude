package main

import (
	"bytes"
	"encoding/json"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"github.com/atulpokharel-gp/claude/scanner/internal/discover"
	"github.com/atulpokharel-gp/claude/scanner/internal/report"
	"github.com/atulpokharel-gp/claude/scanner/internal/vault"
)

func fixtureHome(t *testing.T) string {
	t.Helper()
	src, _ := filepath.Abs("../../testdata/home")
	dst := t.TempDir()
	err := filepath.Walk(src, func(p string, info os.FileInfo, err error) error {
		if err != nil {
			return err
		}
		rel, _ := filepath.Rel(src, p)
		if info.IsDir() {
			return os.MkdirAll(filepath.Join(dst, rel), 0o755)
		}
		data, err := os.ReadFile(p)
		if err != nil {
			return err
		}
		return os.WriteFile(filepath.Join(dst, rel), data, 0o644)
	})
	if err != nil {
		t.Fatal(err)
	}
	return dst
}

func useMemoryStore(t *testing.T) vault.Memory {
	t.Helper()
	store := vault.Memory{}
	old := newStore
	newStore = func() vault.Store { return store }
	t.Cleanup(func() { newStore = old })
	return store
}

func TestFixSecretsEndToEnd(t *testing.T) {
	home := fixtureHome(t)
	store := useMemoryStore(t)
	cfg := filepath.Join(home, ".config", "Claude", "claude_desktop_config.json")
	before, _ := os.ReadFile(cfg)

	// Dry run changes nothing.
	var out, errOut bytes.Buffer
	if code := run([]string{"fix-secrets", "--home", home}, &out, &errOut); code != 0 {
		t.Fatalf("dry run exit %d: %s", code, errOut.String())
	}
	if !strings.Contains(out.String(), "Would move github.GITHUB_PERSONAL_ACCESS_TOKEN") || !strings.Contains(out.String(), "--apply") {
		t.Errorf("dry run output:\n%s", out.String())
	}
	if after, _ := os.ReadFile(cfg); string(after) != string(before) || len(store) != 0 {
		t.Fatal("dry run changed something")
	}

	// Apply.
	out.Reset()
	if code := run([]string{"fix-secrets", "--home", home, "--apply", "--launcher", "/opt/agentguard/agentscan"}, &out, &errOut); code != 0 {
		t.Fatalf("apply exit %d: %s\n%s", code, errOut.String(), out.String())
	}
	if strings.Contains(out.String(), "fake-demo-token") {
		t.Error("output printed a key")
	}
	if len(store) != 2 {
		t.Errorf("store has %d keys, want 2", len(store))
	}

	// Rescan: no plain-text secrets, two keys waiting to be replaced.
	out.Reset()
	if code := run([]string{"--home", home, "--json"}, &out, &errOut); code != 0 {
		t.Fatalf("scan exit %d", code)
	}
	var rep report.Report
	if err := json.Unmarshal(out.Bytes(), &rep); err != nil {
		t.Fatal(err)
	}
	rules := map[string]int{}
	for _, s := range rep.Servers {
		for _, f := range s.Findings {
			rules[f.RuleID]++
		}
	}
	if rules["SECRET_IN_CONFIG"] != 0 || rules["KEY_NOT_ROTATED"] != 2 {
		t.Errorf("after fix, findings by rule = %v", rules)
	}

	// Rotate one key.
	var ghRef string
	for ref := range store {
		if strings.HasPrefix(ref, "claude-desktop/github/") {
			ghRef = ref
		}
	}
	out.Reset()
	in := strings.NewReader("brand-new-value\n")
	if code := runRotate([]string{"--home", home, ghRef}, in, &out, &errOut); code != 0 {
		t.Fatalf("rotate exit %d: %s", code, errOut.String())
	}
	if store[ghRef] != "brand-new-value" {
		t.Error("rotate didn't store the new value")
	}
	// Same value again is refused.
	errOut.Reset()
	if code := runRotate([]string{"--home", home, ghRef}, strings.NewReader("brand-new-value\n"), &out, &errOut); code == 0 {
		t.Error("rotating to the same value should fail")
	}

	out.Reset()
	run([]string{"rotate", "--home", home, "--list"}, &out, &errOut)
	if strings.Contains(out.String(), "github") || !strings.Contains(out.String(), "stripe") {
		t.Errorf("rotate --list after one rotation:\n%s", out.String())
	}
}

func TestFixRefusesTempLauncher(t *testing.T) {
	home := fixtureHome(t)
	useMemoryStore(t)
	old := launcherPath
	launcherPath = func() (string, error) { return filepath.Join(os.TempDir(), "go-build123", "agentscan"), nil }
	t.Cleanup(func() { launcherPath = old })
	var out, errOut bytes.Buffer
	if code := run([]string{"fix-secrets", "--home", home, "--apply"}, &out, &errOut); code == 0 {
		t.Error("should refuse to write a temporary path into configs")
	}
}

func TestFixRefusesUnrecognizedLauncherName(t *testing.T) {
	home := fixtureHome(t)
	useMemoryStore(t)
	cfg := filepath.Join(home, ".config", "Claude", "claude_desktop_config.json")
	before, _ := os.ReadFile(cfg)
	var out, errOut bytes.Buffer
	code := run([]string{"fix-secrets", "--home", home, "--apply", "--launcher", filepath.Join(home, "bin", "agent-guard")}, &out, &errOut)
	if code == 0 || !strings.Contains(errOut.String(), "named agentscan") {
		t.Errorf("exit %d, stderr %q; want a refusal naming the rule", code, errOut.String())
	}
	if after, _ := os.ReadFile(cfg); !bytes.Equal(before, after) {
		t.Error("config changed even though the launcher was refused")
	}
}

func TestFixWritesAbsoluteLauncherPath(t *testing.T) {
	home := fixtureHome(t)
	useMemoryStore(t)
	t.Chdir(home)
	var out, errOut bytes.Buffer
	if code := run([]string{"fix-secrets", "--home", home, "--apply", "--launcher", "agentscan"}, &out, &errOut); code != 0 {
		t.Fatalf("exit %d: %s", code, errOut.String())
	}
	data, _ := os.ReadFile(filepath.Join(home, ".config", "Claude", "claude_desktop_config.json"))
	want, _ := json.Marshal(filepath.Join(home, "agentscan"))
	if !bytes.Contains(data, want) {
		t.Errorf("config should name the launcher by absolute path %s:\n%s", want, data)
	}
}

func TestFixReportsUnreadableConfigs(t *testing.T) {
	home := fixtureHome(t)
	useMemoryStore(t)
	bad := filepath.Join(home, ".cursor", "mcp.json")
	if err := os.MkdirAll(filepath.Dir(bad), 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(bad, []byte("{not json"), 0o644); err != nil {
		t.Fatal(err)
	}
	var out, errOut bytes.Buffer
	code := run([]string{"fix-secrets", "--home", home}, &out, &errOut)
	if code == 0 {
		t.Error("should exit nonzero when a config couldn't be checked")
	}
	if !strings.Contains(errOut.String(), "couldn't be checked") || !strings.Contains(errOut.String(), "mcp.json") {
		t.Errorf("stderr should name the unreadable config:\n%s", errOut.String())
	}
}

func TestSecretEnv(t *testing.T) {
	store := vault.Memory{"r1": "v1"}
	env, err := secretEnv([]discover.ProtectedSecret{{Env: "TOKEN", Ref: "r1"}}, store, []string{"PATH=/bin", "TOKEN=old"})
	if err != nil {
		t.Fatal(err)
	}
	if strings.Join(env, ",") != "PATH=/bin,TOKEN=v1" {
		t.Errorf("env = %v", env)
	}
	if _, err := secretEnv([]discover.ProtectedSecret{{Env: "X", Ref: "missing"}}, store, nil); err == nil || !strings.Contains(err.Error(), "agentscan rotate") {
		t.Errorf("missing key error = %v", err)
	}
}

func TestExecUsage(t *testing.T) {
	var errOut bytes.Buffer
	if code := run([]string{"exec", "--secret", "A=b"}, &bytes.Buffer{}, &errOut); code != 1 || !strings.Contains(errOut.String(), "usage") {
		t.Errorf("code %d, stderr %q", code, errOut.String())
	}
}
