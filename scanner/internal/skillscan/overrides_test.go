package skillscan

import (
	"os"
	"path/filepath"
	"runtime"
	"testing"

	"github.com/atulpokharel-gp/zinloop-zipax/scanner/internal/discover"
)

// TestClaudeConfigDirRedirectsSkills checks that $CLAUDE_CONFIG_DIR moves the
// user skills folder, and that the move is annotated on the LocationResult
// and emitted as a path_redirected warning.
func TestClaudeConfigDirRedirectsSkills(t *testing.T) {
	dir := t.TempDir()
	home := filepath.Join(dir, "home")
	custom := filepath.Join(dir, "custom")
	skills := filepath.Join(custom, ".claude", "skills", "hello")
	if err := os.MkdirAll(skills, 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(skills, "SKILL.md"), []byte("---\nname: hello\n---\nhi\n"), 0o600); err != nil {
		t.Fatal(err)
	}
	// Create the (empty) default location too, so we are sure the override
	// wins over the default rather than coexisting.
	if err := os.MkdirAll(filepath.Join(home, ".claude", "skills"), 0o755); err != nil {
		t.Fatal(err)
	}

	env := discover.Env{GOOS: "linux", Home: home, ClaudeConfigDir: custom}
	found, locs, warnings := ScanWithWarnings(env)
	if len(found) != 1 || found[0].Name != "hello" {
		t.Errorf("found skills = %+v, want one named hello", found)
	}
	var user *LocationResult
	for i := range locs {
		if locs[i].Source == "user" {
			user = &locs[i]
		}
	}
	if user == nil {
		t.Fatal("no user skills location result")
	}
	wantPath := filepath.Join(custom, ".claude", "skills")
	if user.Path != wantPath {
		t.Errorf("user path = %q, want %q", user.Path, wantPath)
	}
	if user.Override != "env:CLAUDE_CONFIG_DIR" {
		t.Errorf("user override = %q", user.Override)
	}
	var w *discover.PathWarning
	for i := range warnings {
		if warnings[i].Reason == "path_redirected" {
			w = &warnings[i]
		}
	}
	if w == nil {
		t.Fatalf("expected path_redirected warning, got %+v", warnings)
	}
}

// TestExtraSkillsDirAccepted checks that --extra-skills-dir adds an "extra"
// skill location, even when it is outside the user's home.
func TestExtraSkillsDirAccepted(t *testing.T) {
	dir := t.TempDir()
	home := filepath.Join(dir, "home")
	ext := filepath.Join(dir, "outside", "myskills", "mine")
	if err := os.MkdirAll(ext, 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(ext, "SKILL.md"), []byte("---\nname: mine\n---\nhi\n"), 0o600); err != nil {
		t.Fatal(err)
	}
	env := discover.Env{
		GOOS:           "linux",
		Home:           home,
		ExtraSkillDirs: []string{filepath.Join(dir, "outside", "myskills")},
	}
	found, locs, _ := ScanWithWarnings(env)
	if len(found) != 1 || found[0].Name != "mine" {
		t.Errorf("found skills = %+v, want one named mine", found)
	}
	var extra *LocationResult
	for i := range locs {
		if locs[i].Source == "extra" {
			extra = &locs[i]
		}
	}
	if extra == nil || extra.Override != "flag:--extra-skills-dir" {
		t.Errorf("extra location = %+v", extra)
	}
}

// TestWorldWritableSkillDirFlagged flags a skills folder with mode 0777.
func TestWorldWritableSkillDirFlagged(t *testing.T) {
	if runtime.GOOS == "windows" {
		t.Skip("Unix mode bits only")
	}
	dir := t.TempDir()
	home := filepath.Join(dir, "home")
	skills := filepath.Join(home, ".claude", "skills")
	if err := os.MkdirAll(skills, 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.Chmod(skills, 0o777); err != nil {
		t.Fatal(err)
	}
	_, _, warnings := ScanWithWarnings(discover.Env{GOOS: "linux", Home: home})
	var w *discover.PathWarning
	for i := range warnings {
		if warnings[i].Reason == "world_writable" {
			w = &warnings[i]
		}
	}
	if w == nil {
		t.Fatalf("expected world_writable warning, got %+v", warnings)
	}
	if w.Severity != "high" {
		t.Errorf("severity = %q, want high", w.Severity)
	}
}
