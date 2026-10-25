package paxel

import (
	"os"
	"path/filepath"
	"strings"
	"testing"
)

const sessionWithPlan = `
{"type":"user","timestamp":"2026-10-20T10:00:00Z","message":{"role":"user","content":"Here's the plan: step 1, read the config file. step 2, add a new field. step 3, write tests for it. step 4, run gofmt. We should do this cleanly without regressions, starting with the config loader in internal/config and then the matching test in internal/config_test.go. I'll also want to run go test ./... after."}}
{"type":"assistant","timestamp":"2026-10-20T10:00:05Z","message":{"role":"assistant","content":[{"type":"text","text":"ok"},{"type":"tool_use","name":"Read","input":{"file_path":"/home/x/src/internal/config/config.go"}}]}}
{"type":"user","timestamp":"2026-10-20T10:00:10Z","message":{"role":"user","content":[{"type":"tool_result","content":"..."}]}}
{"type":"assistant","timestamp":"2026-10-20T10:00:15Z","message":{"role":"assistant","content":[{"type":"tool_use","name":"Edit","input":{"file_path":"/home/x/src/internal/config/config.go"}}]}}
{"type":"assistant","timestamp":"2026-10-20T10:00:20Z","message":{"role":"assistant","content":[{"type":"tool_use","name":"Write","input":{"file_path":"/home/x/src/internal/config/config_test.go"}}]}}
{"type":"assistant","timestamp":"2026-10-20T10:00:25Z","message":{"role":"assistant","content":[{"type":"tool_use","name":"Bash","input":{"command":"go test ./..."}}]}}
{"type":"assistant","timestamp":"2026-10-20T10:00:30Z","message":{"role":"assistant","content":[{"type":"tool_use","name":"Bash","input":{"command":"gofmt -l ."}}]}}
{"type":"user","timestamp":"2026-10-20T10:00:35Z","message":{"role":"user","content":"- [ ] add README\n- [ ] docs for the new flag"}}
{"type":"assistant","timestamp":"2026-10-20T10:00:40Z","message":{"role":"assistant","content":[{"type":"tool_use","name":"Write","input":{"file_path":"/home/x/src/README.md"}}]}}
`

const sessionDrift = `
{"type":"user","timestamp":"2026-10-20T10:00:00Z","message":{"role":"user","content":"fix it"}}
{"type":"assistant","timestamp":"2026-10-20T10:00:05Z","message":{"role":"assistant","content":[{"type":"tool_use","name":"Edit","input":{"file_path":"/home/x/src/app.go"}}]}}
{"type":"user","timestamp":"2026-10-20T10:00:10Z","message":{"role":"user","content":"no, undo that"}}
{"type":"assistant","timestamp":"2026-10-20T10:00:15Z","message":{"role":"assistant","content":[{"type":"tool_use","name":"Edit","input":{"file_path":"/home/x/src/app.go"}}]}}
{"type":"user","timestamp":"2026-10-20T10:00:20Z","message":{"role":"user","content":"wrong, try again"}}
`

func writeSession(t *testing.T, content string) string {
	t.Helper()
	home := t.TempDir()
	proj := filepath.Join(home, ".claude", "projects", "-src-example-foo")
	if err := os.MkdirAll(proj, 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(proj, "s1.jsonl"), []byte(strings.TrimSpace(content)), 0o600); err != nil {
		t.Fatal(err)
	}
	return home
}

func TestScoreClaudeCodeJSONL_Planning(t *testing.T) {
	home := writeSession(t, sessionWithPlan)
	path := filepath.Join(home, ".claude", "projects", "-src-example-foo", "s1.jsonl")
	p, err := ScoreClaudeCodeJSONL(path, 0)
	if err != nil {
		t.Fatal(err)
	}
	if !p.HasData {
		t.Fatal("want HasData=true")
	}
	if p.Scores[DimPlanning] < 50 {
		t.Errorf("planning score should be high for a long first-turn + TODO: got %d", p.Scores[DimPlanning])
	}
	if p.Scores[DimEngineering] < 50 {
		t.Errorf("engineering score should be high for test+gofmt runs: got %d", p.Scores[DimEngineering])
	}
	if p.Scores[DimExecution] == 0 {
		t.Errorf("execution should be non-zero with tool uses: got %d", p.Scores[DimExecution])
	}
	if p.Metrics["tool_tests"] == 0 {
		t.Errorf("tool_tests counter should be >0 for config_test.go: got %d", p.Metrics["tool_tests"])
	}
	if p.Metrics["bash_test"] == 0 {
		t.Errorf("bash_test counter should be >0 for `go test`: got %d", p.Metrics["bash_test"])
	}
	if p.Metrics["tool_docs_ui"] == 0 {
		t.Errorf("docs_ui counter should be >0 for README.md: got %d", p.Metrics["tool_docs_ui"])
	}
}

func TestScoreClaudeCodeJSONL_Drift(t *testing.T) {
	home := writeSession(t, sessionDrift)
	path := filepath.Join(home, ".claude", "projects", "-src-example-foo", "s1.jsonl")
	p, err := ScoreClaudeCodeJSONL(path, 0)
	if err != nil {
		t.Fatal(err)
	}
	if !p.HasData {
		t.Fatal("want HasData=true")
	}
	// Short prompts and many corrections → steering should not be high.
	if p.Scores[DimSteering] > 50 {
		t.Errorf("short+corrective session steering should be low: got %d", p.Scores[DimSteering])
	}
	if p.Metrics["corrections"] < 2 {
		t.Errorf("expected corrections>=2 got %d", p.Metrics["corrections"])
	}
	if p.Metrics["first_user_chars"] >= 300 {
		t.Errorf("first user chars should be short: got %d", p.Metrics["first_user_chars"])
	}
}

func TestScoreCountsEmpty(t *testing.T) {
	p := scoreCounts(sessionCounts{})
	if p.HasData {
		t.Error("empty counts should not have data")
	}
}

func TestClampAndPct(t *testing.T) {
	if got := pct(-1); got != 0 {
		t.Errorf("pct(-1) = %d", got)
	}
	if got := pct(2); got != 100 {
		t.Errorf("pct(2) = %d", got)
	}
	if got := pct(0.5); got != 50 {
		t.Errorf("pct(0.5) = %d", got)
	}
}

func TestCollectProfilesAggregates(t *testing.T) {
	home := writeSession(t, sessionWithPlan)
	// Add a second session to the same project so sessions > 1.
	proj := filepath.Join(home, ".claude", "projects", "-src-example-foo")
	if err := os.WriteFile(filepath.Join(proj, "s2.jsonl"), []byte(strings.TrimSpace(sessionDrift)), 0o600); err != nil {
		t.Fatal(err)
	}
	rows, _ := CollectProfiles(Env{Home: home, Username: "alice", Hostname: "laptop1"})
	if len(rows) == 0 {
		t.Fatal("want some rows")
	}
	seen := map[string]int{}
	for _, r := range rows {
		seen[r.Dimension]++
		if r.Sessions < 1 {
			t.Errorf("row has sessions=%d, want >=1", r.Sessions)
		}
		if r.UserHash == "" {
			t.Errorf("row has empty user hash")
		}
		if r.ProjectLabel != "foo" {
			t.Errorf("project label: want foo got %q", r.ProjectLabel)
		}
	}
	for _, d := range AllDimensions {
		if seen[d] == 0 {
			t.Errorf("dimension %q missing", d)
		}
	}
}
