package main

import (
	"bytes"
	"encoding/json"
	"os"
	"path/filepath"
	"runtime"
	"strings"
	"testing"

	"github.com/atulpokharel-gp/claude/scanner/internal/report"
)

func TestRunOnFixtures(t *testing.T) {
	home, _ := filepath.Abs("../../testdata/home")
	project, _ := filepath.Abs("../../testdata/project")
	outFile := filepath.Join(t.TempDir(), "scan.json")

	var stdout, stderr bytes.Buffer
	code := run([]string{"--home", home, "--project", project, "--json", "--out", outFile, "--fail-on", "high"}, &stdout, &stderr)
	if code != 2 {
		t.Fatalf("exit code = %d, want 2 (high findings present); stderr: %s", code, stderr.String())
	}

	var rep report.Report
	if err := json.Unmarshal(stdout.Bytes(), &rep); err != nil {
		t.Fatalf("output is not valid JSON: %v", err)
	}
	if rep.Summary.Servers != 11 {
		t.Errorf("servers = %d, want 11", rep.Summary.Servers)
	}
	if rep.Summary.High < 5 {
		t.Errorf("high = %d, want at least 5", rep.Summary.High)
	}
	if rep.Servers[0].Risk != "high" {
		t.Errorf("servers should be sorted worst first, got %s first", rep.Servers[0].Risk)
	}

	// Secret values from the fixtures must never appear in any output.
	file, err := os.ReadFile(outFile)
	if err != nil {
		t.Fatal(err)
	}
	for _, secret := range []string{"fake-demo-token-not-real-0001", "fake-stripe-value-not-real"} {
		if strings.Contains(stdout.String(), secret) || strings.Contains(string(file), secret) {
			t.Errorf("secret %q leaked into the report", secret)
		}
	}
	if info, _ := os.Stat(outFile); runtime.GOOS != "windows" && info.Mode().Perm() != 0o600 { // Windows uses ACLs, not mode bits
		t.Errorf("report file mode = %v, want 0600", info.Mode().Perm())
	}
}

func TestTextOutput(t *testing.T) {
	home, _ := filepath.Abs("../../testdata/home")
	var stdout, stderr bytes.Buffer
	if code := run([]string{"--home", home}, &stdout, &stderr); code != 0 {
		t.Fatalf("exit code = %d; stderr: %s", code, stderr.String())
	}
	for _, want := range []string{"[HIGH] commander", "Agent can run any command", "Fix:"} {
		if !strings.Contains(stdout.String(), want) {
			t.Errorf("text output missing %q", want)
		}
	}
}

func TestEmptyHome(t *testing.T) {
	var stdout, stderr bytes.Buffer
	if code := run([]string{"--home", t.TempDir(), "--fail-on", "low"}, &stdout, &stderr); code != 0 {
		t.Fatalf("exit code = %d, want 0 for a computer with no agents", code)
	}
	if !strings.Contains(stdout.String(), "0 MCP servers") {
		t.Errorf("unexpected output: %s", stdout.String())
	}
}

func TestMain(m *testing.M) {
	// testdata/home uses the Linux folder layout; the per-OS locations are
	// covered by the discover package's own tests.
	goos = "linux"
	os.Exit(m.Run())
}
