package report

import (
	"strings"
	"testing"

	"github.com/atulpokharel-gp/zinloop-zipax/scanner/internal/discover"
	"github.com/atulpokharel-gp/zinloop-zipax/scanner/internal/rules"
)

func TestBuildRedactsAndCounts(t *testing.T) {
	token := "ghp_" + strings.Repeat("Z9y8", 9)
	servers := []discover.Server{
		{Name: "ok", Command: "/bin/ok"},
		{Name: "leaky", Command: "/bin/x", Args: []string{"--token", token}},
		{Name: "url", URL: "https://user:pw@api.example.com/mcp?key=abc"},
	}
	r := Build(servers, nil, nil, nil, rules.Context{}, Report{Hostname: "h"})

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
	r := Build(servers, nil, nil, nil, rules.Context{}, Report{})
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

func TestFindingTextDoesNotRepeatRedactedArgs(t *testing.T) {
	tok := "example-private-token"
	servers := []discover.Server{{
		Name:    "wheel",
		Command: "uvx",
		Args:    []string{"--from", "https://packages.example.org/server.whl?token=" + tok, "server"},
	}}
	r := Build(servers, nil, nil, nil, rules.Context{}, Report{})
	for _, f := range r.Servers[0].Findings {
		if strings.Contains(f.Title+f.Detail+f.Fix, tok) {
			t.Errorf("%s finding text leaks the token: %q / %q", f.RuleID, f.Detail, f.Fix)
		}
	}
	if len(r.Servers[0].Findings) < 2 {
		t.Errorf("expected secret and unpinned findings, got %+v", r.Servers[0].Findings)
	}
}

func TestRedactsTokenInURLPath(t *testing.T) {
	tok := "ghp_" + strings.Repeat("Q7w8", 9)
	servers := []discover.Server{
		{Name: "arg", Command: "/bin/x", Args: []string{"https://api.example.org/" + tok}},
		{Name: "url", URL: "https://api.example.org/" + tok + "/mcp"},
	}
	r := Build(servers, nil, nil, nil, rules.Context{}, Report{})
	var text strings.Builder
	WriteText(&text, r)
	if strings.Contains(text.String(), tok) {
		t.Fatalf("token in URL path leaked:\n%s", text.String())
	}
	for _, s := range r.Servers {
		all := strings.Join(s.Args, " ") + s.URL
		for _, f := range s.Findings {
			all += f.Title + f.Detail + f.Fix
		}
		if strings.Contains(all, tok) {
			t.Errorf("%s leaks token: %q", s.Name, all)
		}
	}
}

func TestRedactURLHidesWholeUserInfo(t *testing.T) {
	cases := map[string]string{
		"https://alice:private@password@api.example.com/mcp": "https://[REDACTED]@api.example.com/mcp",
		"https://alice:pw@api.example.com/a@b":               "https://[REDACTED]@api.example.com/a@b",
		"https://api.example.com/mcp?key=x#frag":             "https://api.example.com/mcp?[REDACTED]",
		"https://api.example.com/mcp":                        "https://api.example.com/mcp",
	}
	for in, want := range cases {
		if got := redactURL(in); got != want {
			t.Errorf("redactURL(%q) = %q, want %q", in, got, want)
		}
	}
}
