package report

import (
	"strings"
	"testing"

	"github.com/atulpokharel-gp/claude/scanner/internal/discover"
	"github.com/atulpokharel-gp/claude/scanner/internal/rules"
)

func TestBuildRedactsAndCounts(t *testing.T) {
	token := "ghp_" + strings.Repeat("Z9y8", 9)
	servers := []discover.Server{
		{Name: "ok", Command: "/bin/ok"},
		{Name: "leaky", Command: "/bin/x", Args: []string{"--token", token}},
		{Name: "url", URL: "https://user:pw@api.example.com/mcp?key=abc"},
	}
	r := Build(servers, nil, rules.Context{}, Report{Hostname: "h"})

	if r.Summary.Servers != 3 || r.Summary.High != 2 || r.Summary.Clean != 1 {
		t.Errorf("summary = %+v", r.Summary)
	}
	if r.Servers[0].Risk != rules.High {
		t.Errorf("worst server should come first, got %s", r.Servers[0].Risk)
	}
	for _, s := range r.Servers {
		joined := strings.Join(s.Args, " ") + s.URL
		if strings.Contains(joined, token) || strings.Contains(joined, "pw@") || strings.Contains(joined, "key=abc") {
			t.Errorf("%s not redacted: %q", s.Name, joined)
		}
		if s.Findings == nil {
			t.Errorf("%s: findings should be an empty list, not null", s.Name)
		}
	}
}

func TestRedactsCredentialFlagsAndConnectionStrings(t *testing.T) {
	pw := "example-private-password"
	servers := []discover.Server{{
		Name:    "db",
		Command: "/bin/db-mcp",
		Args:    []string{"--password", pw, "--api-key=" + pw, "postgresql://user:" + pw + "@db.example.com/app", "--port", "5432"},
	}}
	r := Build(servers, nil, rules.Context{}, Report{})
	got := r.Servers[0]
	joined := strings.Join(got.Args, " ")
	if strings.Contains(joined, pw) {
		t.Fatalf("password not redacted: %q", joined)
	}
	want := []string{"--password", Redacted, "--api-key=" + Redacted, "postgresql://" + Redacted + "@db.example.com/app", "--port", "5432"}
	if strings.Join(got.Args, "|") != strings.Join(want, "|") {
		t.Errorf("args = %q, want %q", got.Args, want)
	}
	if got.Risk != rules.High {
		t.Errorf("risk = %s, want high", got.Risk)
	}
	var text strings.Builder
	WriteText(&text, r)
	if strings.Contains(text.String(), pw) {
		t.Error("password leaked into text output")
	}
}
