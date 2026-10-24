package discover

import (
	"encoding/json"
	"path/filepath"
	"strings"
	"testing"
)

func TestStripJSONC(t *testing.T) {
	in := `// top
{
  "a": "keep // this", /* gone */
  "b": [1, 2,],
  "c": "quote \" and /* not a comment */",
}`
	var v map[string]any
	if err := json.Unmarshal(StripJSONC([]byte(in)), &v); err != nil {
		t.Fatalf("stripped JSON did not parse: %v\n%s", err, StripJSONC([]byte(in)))
	}
	if v["a"] != "keep // this" {
		t.Errorf("string content changed: %q", v["a"])
	}
	if v["c"] != `quote " and /* not a comment */` {
		t.Errorf("string with comment markers changed: %q", v["c"])
	}
}

func TestLocationsPerOS(t *testing.T) {
	cases := map[string]string{
		"darwin":  filepath.Join("/Users/a", "Library", "Application Support", "Claude", "claude_desktop_config.json"),
		"linux":   filepath.Join("/home/a", ".config", "Claude", "claude_desktop_config.json"),
		"windows": filepath.Join(`C:\Users\a\AppData\Roaming`, "Claude", "claude_desktop_config.json"),
	}
	homes := map[string]string{"darwin": "/Users/a", "linux": "/home/a", "windows": `C:\Users\a`}
	for goos, want := range cases {
		env := Env{GOOS: goos, Home: homes[goos]}
		if goos == "windows" {
			env.AppData = `C:\Users\a\AppData\Roaming`
		}
		got := Locations(env)[0]
		if got.App != "Claude Desktop" || got.Path != want {
			t.Errorf("%s: got %+v, want path %s", goos, got, want)
		}
	}
}

func TestScanFixtures(t *testing.T) {
	home, _ := filepath.Abs("../../testdata/home")
	project, _ := filepath.Abs("../../testdata/project")
	servers, results := Scan(Env{GOOS: "linux", Home: home, ProjectDirs: []string{project}})

	byName := map[string]Server{}
	for _, s := range servers {
		byName[s.Name] = s
	}
	want := []string{"github", "files", "commander", "pinned-time", "internal-wiki", "postgres", "linear", "playwright", "sentry", "stripe", "local-notes"}
	for _, n := range want {
		if _, ok := byName[n]; !ok {
			t.Errorf("missing server %q", n)
		}
	}
	if len(servers) != len(want) {
		t.Errorf("got %d servers, want %d", len(servers), len(want))
	}
	if _, ok := byName["broken"]; ok {
		t.Error("malformed entry should be skipped")
	}

	if s := byName["stripe"]; s.Scope != "/home/demo/app" || s.App != "Claude Code" {
		t.Errorf("stripe: got scope %q app %q", s.Scope, s.App)
	}
	if s := byName["sentry"]; s.Transport != "remote" {
		t.Errorf("sentry transport = %q, want remote", s.Transport)
	}
	if s := byName["github"]; strings.Join(s.EnvKeys, ",") != "GITHUB_PERSONAL_ACCESS_TOKEN" {
		t.Errorf("github env keys = %v", s.EnvKeys)
	}

	// The fixture's "broken" entry is skipped, but the scan must say so
	// instead of looking clean.
	for _, r := range results {
		isBroken := strings.HasSuffix(filepath.ToSlash(r.Path), "project/.vscode/mcp.json")
		switch {
		case isBroken && !strings.Contains(r.Error, "broken"):
			t.Errorf("%s: want error naming the broken entry, got %q", r.Path, r.Error)
		case isBroken && r.Servers == 0:
			t.Errorf("%s: valid entries in the same file should still be read", r.Path)
		case !isBroken && r.Error != "":
			t.Errorf("unexpected error for %s: %s", r.Path, r.Error)
		}
	}
}

func TestEnvValuesNeverSerialized(t *testing.T) {
	s := Server{Name: "x", Env: map[string]string{"TOKEN": "supersecretvalue"}, Headers: map[string]string{"Authorization": "Bearer abc"}}
	b, _ := json.Marshal(s)
	if strings.Contains(string(b), "supersecretvalue") || strings.Contains(string(b), "Bearer abc") {
		t.Fatalf("secret value leaked into JSON: %s", b)
	}
}

func TestParseLauncherRoundTrip(t *testing.T) {
	secrets := []ProtectedSecret{{Env: "A_TOKEN", Ref: "app/srv/A_TOKEN"}, {Env: "B", Ref: "app/srv/B"}}
	args := LauncherArgs(secrets, "npx", []string{"-y", "pkg@1.0.0", "--", "x"})
	got, cmd, rest, ok := ParseLauncher(`C:\Tools\agentscan.exe`, args)
	if !ok || cmd != "npx" || strings.Join(rest, " ") != "-y pkg@1.0.0 -- x" || len(got) != 2 || got[1].Ref != "app/srv/B" {
		t.Fatalf("round trip failed: %v %q %q %v", got, cmd, rest, ok)
	}
	for _, bad := range [][]string{
		{"exec"},
		{"exec", "--secret", "A=b"},
		{"exec", "--secret", "noequals", "--", "x"},
		{"exec", "--other", "--", "x"},
		{"scan", "--", "x"},
	} {
		if _, _, _, ok := ParseLauncher("/usr/local/bin/agentscan", bad); ok {
			t.Errorf("%v should not parse", bad)
		}
	}
	if _, _, _, ok := ParseLauncher("npx", args); ok {
		t.Error("only agentscan is a launcher")
	}
}
