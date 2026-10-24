package main

import (
	"bytes"
	"encoding/json"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"github.com/atulpokharel-gp/claude/scanner/internal/report"
)

func copyTree(t *testing.T, src, dst string) {
	t.Helper()
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
}

func TestAllUsersScansEveryProfile(t *testing.T) {
	users := t.TempDir()
	copyTree(t, filepath.Join("..", "..", "testdata", "home"), filepath.Join(users, "alice"))
	copyTree(t, filepath.Join("..", "..", "testdata", "home"), filepath.Join(users, "bob"))
	if err := os.MkdirAll(filepath.Join(users, "Public"), 0o755); err != nil {
		t.Fatal(err)
	}

	var one, all bytes.Buffer
	if code := run([]string{"--json", "--home", filepath.Join(users, "alice")}, &one, &all); code != 0 {
		t.Fatalf("single scan exit %d: %s", code, all.String())
	}
	var single report.Report
	if err := json.Unmarshal(one.Bytes(), &single); err != nil {
		t.Fatal(err)
	}
	all.Reset()
	var errOut bytes.Buffer
	if code := run([]string{"--json", "--all-users", "--users-dir", users}, &all, &errOut); code != 0 {
		t.Fatalf("all-users exit %d: %s", code, errOut.String())
	}
	var merged report.Report
	if err := json.Unmarshal(all.Bytes(), &merged); err != nil {
		t.Fatal(err)
	}
	if single.Summary.Servers == 0 || merged.Summary.Servers != 2*single.Summary.Servers {
		t.Fatalf("want twice %d servers, got %d", single.Summary.Servers, merged.Summary.Servers)
	}
	if merged.Summary.High != 2*single.Summary.High {
		t.Fatalf("summary not merged: %+v vs %+v", merged.Summary, single.Summary)
	}
	byUser := map[string]int{}
	for _, srv := range merged.Servers {
		byUser[srv.User]++
	}
	if byUser["alice"] != single.Summary.Servers || byUser["bob"] != single.Summary.Servers {
		t.Fatalf("servers not tagged with their profile: %v", byUser)
	}
	for _, c := range merged.Configs {
		if strings.Contains(c.Path, "Public") {
			t.Fatalf("Public profile should be skipped: %s", c.Path)
		}
	}
}

func TestAllUsersRejectsHome(t *testing.T) {
	var out, errOut bytes.Buffer
	if code := run([]string{"--all-users", "--home", t.TempDir()}, &out, &errOut); code != 1 {
		t.Fatalf("exit %d, want 1", code)
	}
}

func TestAllUsersScansProjectOnce(t *testing.T) {
	users := t.TempDir()
	copyTree(t, filepath.Join("..", "..", "testdata", "home"), filepath.Join(users, "alice"))
	copyTree(t, filepath.Join("..", "..", "testdata", "home"), filepath.Join(users, "bob"))
	project := t.TempDir()
	if err := os.MkdirAll(filepath.Join(project, ".vscode"), 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(project, ".vscode", "mcp.json"), []byte(`{"servers":{"crm":{"command":"npx","args":["-y","crm-mcp"]}}}`), 0o644); err != nil {
		t.Fatal(err)
	}
	var out, errOut bytes.Buffer
	if code := run([]string{"--json", "--all-users", "--users-dir", users, "--project", project}, &out, &errOut); code != 0 {
		t.Fatalf("exit %d: %s", code, errOut.String())
	}
	var rep report.Report
	if err := json.Unmarshal(out.Bytes(), &rep); err != nil {
		t.Fatal(err)
	}
	n := 0
	for _, c := range rep.Configs {
		if c.Found && strings.HasPrefix(c.Path, project) {
			n++
		}
	}
	if n != 1 {
		t.Fatalf("project config reported %d times, want 1", n)
	}
	// The project is outside every profile, so nobody owns its servers.
	for _, srv := range rep.Servers {
		if strings.HasPrefix(srv.ConfigPath, project) && srv.User != "" {
			t.Fatalf("shared project server %q attributed to %q", srv.Name, srv.User)
		}
	}
}

func TestProjectInsideAProfileBelongsToThatProfile(t *testing.T) {
	users := t.TempDir()
	copyTree(t, filepath.Join("..", "..", "testdata", "home"), filepath.Join(users, "alice"))
	copyTree(t, filepath.Join("..", "..", "testdata", "home"), filepath.Join(users, "bob"))
	project := filepath.Join(users, "bob", "code", "app")
	if err := os.MkdirAll(filepath.Join(project, ".vscode"), 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(project, ".vscode", "mcp.json"), []byte(`{"servers":{"crm":{"command":"npx","args":["-y","crm-mcp"]}}}`), 0o644); err != nil {
		t.Fatal(err)
	}
	var out, errOut bytes.Buffer
	// alice is listed first and scans the --project folder, but it's bob's.
	if code := run([]string{"--json", "--all-users", "--users-dir", users, "--project", project}, &out, &errOut); code != 0 {
		t.Fatalf("exit %d: %s", code, errOut.String())
	}
	var rep report.Report
	if err := json.Unmarshal(out.Bytes(), &rep); err != nil {
		t.Fatal(err)
	}
	found := false
	for _, srv := range rep.Servers {
		if srv.Name == "crm" {
			found = true
			if srv.User != "bob" {
				t.Fatalf("crm attributed to %q, want bob", srv.User)
			}
		}
	}
	if !found {
		t.Fatal("crm server not found")
	}
}

func TestWithin(t *testing.T) {
	home := filepath.Join(string(filepath.Separator)+"home", "alice")
	cases := map[string]bool{
		filepath.Join(home, ".cursor", "mcp.json"): true,
		home: true,
		filepath.Join(string(filepath.Separator)+"home", "alice2", "x"): false,
		filepath.Join(string(filepath.Separator)+"srv", "app"):          false,
	}
	for p, want := range cases {
		if got := within(p, home); got != want {
			t.Errorf("within(%q, %q) = %v, want %v", p, home, got, want)
		}
	}
}
