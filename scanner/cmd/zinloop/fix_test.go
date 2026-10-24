package main

import (
	"bytes"
	"encoding/json"
	"os"
	"path/filepath"
	"runtime"
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

// fakeLauncher creates an executable file named zinloop in dir.
func fakeLauncher(t *testing.T, dir string) string {
	t.Helper()
	p := filepath.Join(dir, "zinloop")
	if err := os.WriteFile(p, []byte("#!/bin/sh\n"), 0o755); err != nil {
		t.Fatal(err)
	}
	return p
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
	if code := run([]string{"fix-secrets", "--home", home, "--apply", "--launcher", fakeLauncher(t, home)}, &out, &errOut); code != 0 {
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
	launcherPath = func() (string, error) { return filepath.Join(os.TempDir(), "go-build123", "zinloop"), nil }
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
	code := run([]string{"fix-secrets", "--home", home, "--apply", "--launcher", filepath.Join(home, "bin", "other-tool")}, &out, &errOut)
	if code == 0 || !strings.Contains(errOut.String(), "named zinloop") {
		t.Errorf("exit %d, stderr %q; want a refusal naming the rule", code, errOut.String())
	}
	if after, _ := os.ReadFile(cfg); !bytes.Equal(before, after) {
		t.Error("config changed even though the launcher was refused")
	}
}

func TestFixWritesAbsoluteLauncherPath(t *testing.T) {
	home := fixtureHome(t)
	useMemoryStore(t)
	fakeLauncher(t, home)
	t.Chdir(home)
	var out, errOut bytes.Buffer
	if code := run([]string{"fix-secrets", "--home", home, "--apply", "--launcher", "zinloop"}, &out, &errOut); code != 0 {
		t.Fatalf("exit %d: %s", code, errOut.String())
	}
	data, _ := os.ReadFile(filepath.Join(home, ".config", "Claude", "claude_desktop_config.json"))
	want, _ := json.Marshal(filepath.Join(home, "zinloop"))
	if !bytes.Contains(data, want) {
		t.Errorf("config should name the launcher by absolute path %s:\n%s", want, data)
	}
}

func TestFixRefusesMissingOrNonExecutableLauncher(t *testing.T) {
	home := fixtureHome(t)
	useMemoryStore(t)
	cfg := filepath.Join(home, ".config", "Claude", "claude_desktop_config.json")
	before, _ := os.ReadFile(cfg)
	missing := filepath.Join(home, "nowhere", "zinloop")
	notExec := filepath.Join(home, "zinloop")
	_ = os.WriteFile(notExec, []byte("x"), 0o644)
	cases := []string{missing}
	if runtime.GOOS != "windows" {
		cases = append(cases, notExec)
	}
	for _, lp := range cases {
		var out, errOut bytes.Buffer
		if code := run([]string{"fix-secrets", "--home", home, "--apply", "--launcher", lp}, &out, &errOut); code == 0 {
			t.Errorf("%s: should be refused", lp)
		}
	}
	if after, _ := os.ReadFile(cfg); !bytes.Equal(before, after) {
		t.Error("config changed even though the launcher was refused")
	}
}

func TestRotateKeepsStoreWhenRecordCantBeSaved(t *testing.T) {
	if runtime.GOOS == "windows" {
		t.Skip("relies on Unix directory permissions")
	}
	home := fixtureHome(t)
	store := useMemoryStore(t)
	var out, errOut bytes.Buffer
	if code := run([]string{"fix-secrets", "--home", home, "--apply", "--launcher", fakeLauncher(t, home)}, &out, &errOut); code != 0 {
		t.Fatalf("apply exit %d: %s", code, errOut.String())
	}
	var ref string
	for r := range store {
		ref = r
		break
	}
	old := store[ref]
	stateDir := filepath.Dir(vault.StatePath(home))
	_ = os.Chmod(stateDir, 0o500)
	t.Cleanup(func() { _ = os.Chmod(stateDir, 0o700) })
	if os.WriteFile(filepath.Join(stateDir, "probe"), nil, 0o600) == nil {
		t.Skip("running with permissions that ignore read-only folders")
	}
	if code := runRotate([]string{"--home", home, ref}, strings.NewReader("new-key\n"), &out, &errOut); code == 0 {
		t.Fatal("rotate should fail when the record can't be saved")
	}
	if store[ref] != old {
		t.Fatal("the store changed even though the record wasn't saved")
	}
	_ = os.Chmod(stateDir, 0o700)
	if code := runRotate([]string{"--home", home, ref}, strings.NewReader("new-key\n"), &out, &errOut); code != 0 {
		t.Fatalf("retry with the same new key should work: %s", errOut.String())
	}
	if store[ref] != "new-key" {
		t.Error("retry didn't store the new key")
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
	if _, err := secretEnv([]discover.ProtectedSecret{{Env: "X", Ref: "missing"}}, store, nil); err == nil || !strings.Contains(err.Error(), "zinloop rotate") {
		t.Errorf("missing key error = %v", err)
	}
}

func TestExecUsage(t *testing.T) {
	var errOut bytes.Buffer
	if code := run([]string{"exec", "--secret", "A=b"}, &bytes.Buffer{}, &errOut); code != 1 || !strings.Contains(errOut.String(), "usage") {
		t.Errorf("code %d, stderr %q", code, errOut.String())
	}
}
