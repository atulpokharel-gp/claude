package rules

import (
	"strings"
	"testing"

	"github.com/atulpokharel-gp/claude/scanner/internal/discover"
)

// fakeGitHubToken is built at runtime so no token-shaped string sits in the repo.
var fakeGitHubToken = "ghp_" + strings.Repeat("A1b2", 9)

func ids(fs []Finding) string {
	var out []string
	for _, f := range fs {
		out = append(out, f.RuleID)
	}
	return strings.Join(out, ",")
}

func TestRules(t *testing.T) {
	ctx := Context{Home: "/home/demo"}
	cases := []struct {
		name string
		s    discover.Server
		want string // comma-separated rule IDs, in Check order
	}{
		{"clean pinned stdio", discover.Server{Command: "npx", Args: []string{"-y", "@scope/pkg@1.2.3"}}, ""},
		{"unpinned npx", discover.Server{Command: "npx", Args: []string{"-y", "@scope/pkg"}}, "UNPINNED_PACKAGE"},
		{"npx latest", discover.Server{Command: "npx", Args: []string{"pkg@latest"}}, "UNPINNED_PACKAGE"},
		{"npx caret range", discover.Server{Command: "npx", Args: []string{"pkg@^1.0.0"}}, "UNPINNED_PACKAGE"},
		{"npx dist-tag", discover.Server{Command: "npx", Args: []string{"mcp-server@beta"}}, "UNPINNED_PACKAGE"},
		{"npx major only", discover.Server{Command: "npx", Args: []string{"mcp-server@1"}}, "UNPINNED_PACKAGE"},
		{"npx x-range", discover.Server{Command: "npx", Args: []string{"mcp-server@1.2.x"}}, "UNPINNED_PACKAGE"},
		{"npx prerelease pinned", discover.Server{Command: "npx", Args: []string{"@scope/pkg@2.0.0-rc.1"}}, ""},
		{"uvx at version", discover.Server{Command: "uvx", Args: []string{"mcp-server-git@2025.1.14"}}, ""},
		{"uvx range", discover.Server{Command: "uvx", Args: []string{"mcp-server-git>=1.0"}}, "UNPINNED_PACKAGE"},
		{"uvx unpinned", discover.Server{Command: "uvx", Args: []string{"mcp-server-git"}}, "UNPINNED_PACKAGE"},
		{"npx -p package", discover.Server{Command: "npx", Args: []string{"-p", "pkg@2.0.0", "pkg-bin"}}, ""},
		{"windows npx.cmd", discover.Server{Command: `C:\nodejs\npx.cmd`, Args: []string{"pkg"}}, "UNPINNED_PACKAGE"},
		{"uvx pinned", discover.Server{Command: "uvx", Args: []string{"mcp-server-time==0.6.2"}}, ""},
		{"pnpm dlx unpinned", discover.Server{Command: "pnpm", Args: []string{"dlx", "pkg"}}, "UNPINNED_PACKAGE"},
		{"secret by env name", discover.Server{Command: "/bin/x", Env: map[string]string{"API_KEY": "abc123"}}, "SECRET_IN_CONFIG"},
		{"env reference is fine", discover.Server{Command: "/bin/x", Env: map[string]string{"API_KEY": "${env:API_KEY}"}}, ""},
		{"non-secret env is fine", discover.Server{Command: "/bin/x", Env: map[string]string{"LOG_LEVEL": "debug"}}, ""},
		{"secret by value shape", discover.Server{Command: "/bin/x", Env: map[string]string{"GH": fakeGitHubToken}}, "SECRET_IN_CONFIG"},
		{"secret in args", discover.Server{Command: "/bin/x", Args: []string{"--token", fakeGitHubToken}}, "SECRET_IN_CONFIG"},
		{"literal auth header", discover.Server{URL: "https://api.example.com/mcp", Headers: map[string]string{"Authorization": "Bearer abcdefghijklmnopqrstuvwxyz"}}, "SECRET_IN_CONFIG,REMOTE_SERVER"},
		{"key in URL query", discover.Server{URL: "https://api.example.com/mcp?api_key=abc"}, "SECRET_IN_CONFIG,REMOTE_SERVER"},
		{"password flag", discover.Server{Command: "/bin/db-mcp", Args: []string{"--password", "example-private-password"}}, "SECRET_IN_CONFIG"},
		{"api key flag with equals", discover.Server{Command: "/bin/x", Args: []string{"--api-key=abc123"}}, "SECRET_IN_CONFIG"},
		{"password flag from env var", discover.Server{Command: "/bin/x", Args: []string{"--password", "${DB_PASSWORD}"}}, ""},
		{"connection string arg", discover.Server{Command: "/bin/x", Args: []string{"postgresql://user:example-private-password@db.example.com/app"}}, "SECRET_IN_CONFIG"},
		{"connection string without password", discover.Server{Command: "/bin/x", Args: []string{"postgresql://user@db.example.com/app"}}, ""},
		{"connection string in env", discover.Server{Command: "/bin/x", Env: map[string]string{"DATABASE_URL": "postgres://app:pw123@db.example.com/app"}}, "SECRET_IN_CONFIG"},
		{"plain http remote", discover.Server{URL: "http://wiki.example.com/mcp"}, "INSECURE_TRANSPORT,REMOTE_SERVER"},
		{"plain http localhost", discover.Server{URL: "http://127.0.0.1:3000/mcp"}, ""},
		{"filesystem root", discover.Server{Command: "npx", Args: []string{"@modelcontextprotocol/server-filesystem@1.0.0", "/"}}, "BROAD_FILESYSTEM"},
		{"filesystem home", discover.Server{Command: "npx", Args: []string{"@modelcontextprotocol/server-filesystem@1.0.0", "/home/demo/"}}, "BROAD_FILESYSTEM"},
		{"filesystem project", discover.Server{Command: "npx", Args: []string{"@modelcontextprotocol/server-filesystem@1.0.0", "/home/demo/app"}}, ""},
		{"shell server", discover.Server{Command: "npx", Args: []string{"@wonderwhy-er/desktop-commander@0.2.3"}}, "SHELL_ACCESS"},
		{"shell launcher", discover.Server{Command: "bash", Args: []string{"-c", "/opt/tool/run"}}, "SHELL_LAUNCHER"},
		{"docker privileged", discover.Server{Command: "docker", Args: []string{"run", "--privileged", "img:1"}}, "RISKY_CONTAINER"},
		{"docker sock", discover.Server{Command: "docker", Args: []string{"run", "-v", "/var/run/docker.sock:/var/run/docker.sock", "img:1"}}, "RISKY_CONTAINER"},
		{"docker plain", discover.Server{Command: "docker", Args: []string{"run", "-i", "--rm", "img:1"}}, ""},
	}
	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			if got := ids(Check(c.s, ctx)); got != c.want {
				t.Errorf("got %q, want %q", got, c.want)
			}
		})
	}
}

func TestWorst(t *testing.T) {
	if Worst(nil) != None {
		t.Error("empty list should be None")
	}
	if Worst([]Finding{{Severity: Low}, {Severity: High}, {Severity: Medium}}) != High {
		t.Error("should pick High")
	}
}

func TestFindingTextHasNoSecret(t *testing.T) {
	s := discover.Server{Command: "/bin/x", Env: map[string]string{"TOKEN": "my-real-secret-value"}}
	for _, f := range Check(s, Context{}) {
		if strings.Contains(f.Detail+f.Title+f.Fix, "my-real-secret-value") {
			t.Fatalf("finding text includes the secret: %+v", f)
		}
	}
}
