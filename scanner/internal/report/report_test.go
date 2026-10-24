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
