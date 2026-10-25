package skillscan

import (
	"os"
	"path/filepath"
	"testing"

	"github.com/atulpokharel-gp/claude/scanner/internal/discover"
)

func writeSkill(t *testing.T, root, name, body string) {
	t.Helper()
	dir := filepath.Join(root, name)
	if err := os.MkdirAll(dir, 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(dir, "SKILL.md"), []byte(body), 0o644); err != nil {
		t.Fatal(err)
	}
}

func TestScanUserAndPluginAndProject(t *testing.T) {
	home := t.TempDir()
	userSkills := filepath.Join(home, ".claude", "skills")
	writeSkill(t, userSkills, "greeting", "---\nname: greeting\ndescription: say hi\n---\n\nSay hello politely.\n")
	writeSkill(t, userSkills, "nameless", "no frontmatter here, just body text.")
	// A plugin skill under ~/.claude/plugins/<plugin>/skills/.
	writeSkill(t, filepath.Join(home, ".claude", "plugins", "awesome", "skills"), "deploy", "---\nname: deploy\n---\n")
	// A project skill under <project>/.claude/skills/.
	project := t.TempDir()
	writeSkill(t, filepath.Join(project, ".claude", "skills"), "linter", "---\nname: linter\n---\n")

	env := discover.Env{Home: home, ProjectDirs: []string{project}}
	skills, dirs := Scan(env)

	gotSources := map[string]string{}
	for _, s := range skills {
		gotSources[s.Name] = s.Source
	}
	for name, want := range map[string]string{
		"greeting": "user",
		"nameless": "user",
		"deploy":   "plugin:awesome",
		"linter":   "project",
	} {
		if gotSources[name] != want {
			t.Errorf("skill %q: source=%q, want %q", name, gotSources[name], want)
		}
	}
	// Each walked directory should appear in dirs with found=true.
	found := 0
	for _, d := range dirs {
		if d.Found {
			found++
		}
	}
	if found != 3 {
		t.Errorf("expected 3 found skill directories, got %d (%+v)", found, dirs)
	}
}

func TestParseFrontmatter(t *testing.T) {
	s := parse("---\nname: tester\ndescription: \"says hi\"\nallowed-tools: [Read, Bash(ls:*), Write]\n---\n\nHello world body.\n")
	if s.Name != "tester" {
		t.Errorf("name: got %q", s.Name)
	}
	if s.Description != "says hi" {
		t.Errorf("description: got %q", s.Description)
	}
	if len(s.AllowedTools) != 3 || s.AllowedTools[1] != "Bash(ls:*)" {
		t.Errorf("allowed-tools: got %+v", s.AllowedTools)
	}
	if s.Body == "" || s.Body[0] == '-' {
		t.Errorf("body still contains frontmatter: %q", s.Body)
	}
}

func TestParseFrontmatterBareList(t *testing.T) {
	s := parse("---\nallowed-tools: Read, Write\n---\nbody\n")
	if len(s.AllowedTools) != 2 {
		t.Errorf("bare-list allowed-tools: got %+v", s.AllowedTools)
	}
}

func TestParseNoFrontmatter(t *testing.T) {
	s := parse("just a markdown body.\n")
	if s.Name != "" || s.Description != "" {
		t.Errorf("expected empty fields, got %+v", s)
	}
	if s.Body == "" {
		t.Errorf("expected body preserved")
	}
}

func TestWalkSkipsOversizeAndNonFile(t *testing.T) {
	home := t.TempDir()
	userSkills := filepath.Join(home, ".claude", "skills")
	// A huge skill is skipped.
	big := make([]byte, maxSkillSize+1)
	for i := range big {
		big[i] = 'x'
	}
	dir := filepath.Join(userSkills, "huge")
	if err := os.MkdirAll(dir, 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(dir, "SKILL.md"), big, 0o644); err != nil {
		t.Fatal(err)
	}
	// A normal skill in the same tree still shows up.
	writeSkill(t, userSkills, "small", "ok")

	skills, _ := Scan(discover.Env{Home: home})
	if len(skills) != 1 || skills[0].Name != "small" {
		t.Errorf("expected only the small skill, got %+v", skills)
	}
}
