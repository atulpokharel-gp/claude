package zipax

import (
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"
)

func TestCollectClaudeCode(t *testing.T) {
	home := t.TempDir()
	proj := filepath.Join(home, ".claude", "projects", "-Users-alice-code-foo")
	if err := os.MkdirAll(proj, 0o755); err != nil {
		t.Fatal(err)
	}
	// Two assistant messages on 2026-10-20, one on 2026-10-21, both sonnet.
	lines := []string{
		`{"type":"user","message":{"role":"user","content":"hi"},"timestamp":"2026-10-20T10:00:00Z"}`,
		`{"type":"assistant","timestamp":"2026-10-20T10:00:05Z","message":{"model":"claude-sonnet-4-5-20250929","usage":{"input_tokens":100,"output_tokens":50,"cache_creation_input_tokens":10,"cache_read_input_tokens":20}}}`,
		`{"type":"assistant","timestamp":"2026-10-20T10:05:00Z","message":{"model":"claude-sonnet-4-5-20250929","usage":{"input_tokens":200,"output_tokens":60}}}`,
		`{"type":"assistant","timestamp":"2026-10-21T09:00:00Z","message":{"model":"claude-sonnet-4-5-20250929","usage":{"input_tokens":300,"output_tokens":80}}}`,
		// Garbage line to prove tolerance.
		`not json {`,
	}
	if err := os.WriteFile(filepath.Join(proj, "sess-aaa.jsonl"), []byte(strings.Join(lines, "\n")), 0o600); err != nil {
		t.Fatal(err)
	}
	rep, err := Collect(Env{Home: home, Username: "alice", Hostname: "laptop1", Now: func() time.Time { return time.Date(2026, 10, 22, 0, 0, 0, 0, time.UTC) }})
	if err != nil {
		t.Fatal(err)
	}
	if len(rep.Buckets) != 2 {
		t.Fatalf("want 2 buckets, got %d: %+v", len(rep.Buckets), rep.Buckets)
	}
	byDay := map[string]Bucket{}
	for _, b := range rep.Buckets {
		byDay[b.Day] = b
	}
	day20 := byDay["2026-10-20"]
	if day20.InputTokens != 300 || day20.OutputTokens != 110 {
		t.Errorf("day 20 tokens wrong: in=%d out=%d", day20.InputTokens, day20.OutputTokens)
	}
	if day20.CacheReadTokens != 20 || day20.CacheWriteTokens != 10 {
		t.Errorf("day 20 cache wrong: r=%d w=%d", day20.CacheReadTokens, day20.CacheWriteTokens)
	}
	if day20.Messages != 2 {
		t.Errorf("day 20 messages: want 2 got %d", day20.Messages)
	}
	if day20.ProjectLabel != "foo" {
		t.Errorf("project label: want foo got %q", day20.ProjectLabel)
	}
	if day20.Tool != ToolClaudeCode {
		t.Errorf("tool: want claude-code got %q", day20.Tool)
	}
	if day20.SessionID != "sess-aaa" {
		t.Errorf("session id: want sess-aaa got %q", day20.SessionID)
	}
	if day20.UserHash == "" || len(day20.UserHash) != 32 {
		t.Errorf("user hash wrong len: %q", day20.UserHash)
	}
	if day20.ProjectHash == "" || day20.ProjectHash == day20.UserHash {
		t.Errorf("project hash looks wrong: %q", day20.ProjectHash)
	}
	// Sonnet pricing kicks in — cost should be computed (may round to 0 at
	// these small counts, but must never be negative).
	if day20.CostUsdCents < 0 {
		t.Errorf("negative cost: %d", day20.CostUsdCents)
	}
}

func TestCollectIgnoresEmptyUsage(t *testing.T) {
	home := t.TempDir()
	proj := filepath.Join(home, ".claude", "projects", "-tmp-x")
	if err := os.MkdirAll(proj, 0o755); err != nil {
		t.Fatal(err)
	}
	line := `{"type":"assistant","timestamp":"2026-10-20T10:00:05Z","message":{"model":"claude-sonnet-4-5","usage":{"input_tokens":0,"output_tokens":0}}}`
	if err := os.WriteFile(filepath.Join(proj, "s.jsonl"), []byte(line), 0o600); err != nil {
		t.Fatal(err)
	}
	rep, err := Collect(Env{Home: home, Username: "a", Hostname: "h"})
	if err != nil {
		t.Fatal(err)
	}
	if len(rep.Buckets) != 0 {
		t.Fatalf("want 0 buckets, got %d", len(rep.Buckets))
	}
}

func TestCollectMissingHome(t *testing.T) {
	// No .claude or .codex folder — should return empty, not error.
	home := t.TempDir()
	rep, err := Collect(Env{Home: home, Username: "a", Hostname: "h"})
	if err != nil {
		t.Fatal(err)
	}
	if len(rep.Buckets) != 0 {
		t.Errorf("want 0 buckets, got %d", len(rep.Buckets))
	}
}

func TestProjectLabelHash(t *testing.T) {
	label, hash := projectLabelHash("-Users-alice-code-my-project")
	if label != "project" {
		t.Errorf("want label=project got %q", label)
	}
	if len(hash) != 32 {
		t.Errorf("want 32-char hash got %d", len(hash))
	}
	// Same slug twice yields same hash.
	_, h2 := projectLabelHash("-Users-alice-code-my-project")
	if h2 != hash {
		t.Errorf("hash not deterministic: %s vs %s", hash, h2)
	}
	_, h3 := projectLabelHash("-Users-alice-code-other-project")
	if h3 == hash {
		t.Errorf("different slugs hashed to same value")
	}
}

func TestUserHashDependsOnHost(t *testing.T) {
	a := hashUser("alice", "laptop1")
	b := hashUser("alice", "laptop2")
	if a == b {
		t.Errorf("expected different hashes for different hosts")
	}
	if hashUser("alice", "laptop1") != a {
		t.Errorf("hashUser not deterministic")
	}
}

func TestCostCents(t *testing.T) {
	// 1M input tokens on sonnet = 300 cents = $3.
	if got := costCents("claude-sonnet-4-5", 1_000_000, 0, 0, 0); got != 300 {
		t.Errorf("sonnet 1M input: want 300 got %d", got)
	}
	// 1M output tokens on opus = 7500 cents = $75.
	if got := costCents("claude-opus-4-7", 0, 1_000_000, 0, 0); got != 7500 {
		t.Errorf("opus 1M output: want 7500 got %d", got)
	}
	// Unknown model: 0.
	if got := costCents("random-model", 1_000_000, 1_000_000, 0, 0); got != 0 {
		t.Errorf("unknown: want 0 got %d", got)
	}
}

func TestCollectCodex(t *testing.T) {
	home := t.TempDir()
	dir := filepath.Join(home, ".codex", "sessions", "2026-10-20")
	if err := os.MkdirAll(dir, 0o755); err != nil {
		t.Fatal(err)
	}
	lines := []string{
		`{"timestamp":"2026-10-20T10:00:00Z","type":"response.completed","session_id":"abc123","payload":{"model":"gpt-5-codex","cwd":"/Users/alice/code/bar","usage":{"input_tokens":500,"output_tokens":200}}}`,
		`{"timestamp":"2026-10-20T11:00:00Z","type":"response.completed","session_id":"abc123","payload":{"model":"gpt-5-codex","cwd":"/Users/alice/code/bar","usage":{"input_tokens":100,"output_tokens":50}}}`,
	}
	if err := os.WriteFile(filepath.Join(dir, "abc123.jsonl"), []byte(strings.Join(lines, "\n")), 0o600); err != nil {
		t.Fatal(err)
	}
	rep, err := Collect(Env{Home: home, Username: "alice", Hostname: "laptop1"})
	if err != nil {
		t.Fatal(err)
	}
	if len(rep.Buckets) != 1 {
		t.Fatalf("want 1 bucket got %d: %+v", len(rep.Buckets), rep.Buckets)
	}
	b := rep.Buckets[0]
	if b.Tool != ToolCodex {
		t.Errorf("tool: want codex got %s", b.Tool)
	}
	if b.InputTokens != 600 || b.OutputTokens != 250 {
		t.Errorf("codex tokens: in=%d out=%d", b.InputTokens, b.OutputTokens)
	}
	if b.ProjectLabel != "bar" {
		t.Errorf("project label: want bar got %q", b.ProjectLabel)
	}
	if b.SessionID != "abc123" {
		t.Errorf("session id: want abc123 got %q", b.SessionID)
	}
}
