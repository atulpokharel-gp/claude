// Package skillscan finds Claude Code "skill" packages on a computer and
// extracts the fields that matter to the risk rules.
//
// A skill is a folder with a SKILL.md file: optional YAML frontmatter at the
// top (name, description, allowed-tools) followed by Markdown instructions
// that the agent reads at skill-trigger time. Hidden text or prompt-injection
// phrases inside that Markdown are tool-poisoning payloads with the same
// shape as the ones in MCP tool descriptions, so they share rule logic with
// the MCP scanner.
package skillscan

import (
	"errors"
	"io/fs"
	"os"
	"path/filepath"
	"sort"
	"strings"

	"github.com/atulpokharel-gp/claude/scanner/internal/discover"
)

// maxSkillSize caps SKILL.md reads so one huge file can't stall a scan.
const maxSkillSize = 1 << 20 // 1 MiB

// Skill is one on-disk skill with the parts needed by the rules.
type Skill struct {
	Name         string   `json:"name"`
	Source       string   `json:"source"` // "user", "project" or "plugin:<plugin>"
	Path         string   `json:"path"`   // the SKILL.md path on disk
	Description  string   `json:"description,omitempty"`
	AllowedTools []string `json:"allowedTools,omitempty"`
	// Body is the Markdown body (frontmatter stripped). Kept in memory for the
	// rules; the report writes a short excerpt, never the whole thing.
	Body string `json:"-"`
}

// LocationResult records that one skill directory was walked.
type LocationResult struct {
	Source string `json:"source"`
	Path   string `json:"path"`
	Found  bool   `json:"found"`
	Skills int    `json:"skills"`
	Error  string `json:"error,omitempty"`
}

// locations returns every directory to walk for skills, in the order the
// report should list them. "User" skills live under ~/.claude/skills,
// plugin skills under ~/.claude/plugins/<plugin>/skills, and project
// skills under <project>/.claude/skills.
func locations(e discover.Env) []LocationResult {
	var locs []LocationResult
	if e.Home != "" {
		locs = append(locs, LocationResult{Source: "user", Path: filepath.Join(e.Home, ".claude", "skills")})
	}
	if e.Home != "" {
		plugins := filepath.Join(e.Home, ".claude", "plugins")
		if entries, err := os.ReadDir(plugins); err == nil {
			names := make([]string, 0, len(entries))
			for _, en := range entries {
				if en.IsDir() {
					names = append(names, en.Name())
				}
			}
			sort.Strings(names)
			for _, n := range names {
				locs = append(locs, LocationResult{
					Source: "plugin:" + n,
					Path:   filepath.Join(plugins, n, "skills"),
				})
			}
		}
	}
	for _, dir := range e.ProjectDirs {
		locs = append(locs, LocationResult{Source: "project", Path: filepath.Join(dir, ".claude", "skills")})
	}
	return locs
}

// Scan walks every known skill directory for env and returns the skills
// found alongside a record of each directory walked.
func Scan(e discover.Env) ([]Skill, []LocationResult) {
	locs := locations(e)
	var out []Skill
	for i := range locs {
		r := &locs[i]
		info, err := os.Lstat(r.Path)
		if err != nil {
			if !errors.Is(err, fs.ErrNotExist) {
				r.Error = err.Error()
			}
			continue
		}
		r.Found = true
		if info.Mode()&os.ModeSymlink != 0 {
			target, err := filepath.EvalSymlinks(r.Path)
			if err != nil {
				r.Error = "symlink couldn't be resolved: " + err.Error()
				continue
			}
			if !pathWithin(target, e.Home) {
				r.Error = "symlink points outside the user's folder; refusing to walk it"
				continue
			}
		}
		if !info.IsDir() && info.Mode()&os.ModeSymlink == 0 {
			r.Error = "not a directory"
			continue
		}
		found, err := walk(r.Source, r.Path)
		if err != nil {
			r.Error = err.Error()
		}
		r.Skills = len(found)
		out = append(out, found...)
	}
	return out, locs
}

func walk(source, root string) ([]Skill, error) {
	entries, err := os.ReadDir(root)
	if err != nil {
		return nil, err
	}
	names := make([]string, 0, len(entries))
	for _, e := range entries {
		if e.IsDir() {
			names = append(names, e.Name())
		}
	}
	sort.Strings(names)
	var out []Skill
	for _, name := range names {
		md := filepath.Join(root, name, "SKILL.md")
		info, err := os.Lstat(md)
		if err != nil {
			continue
		}
		if info.Mode()&os.ModeSymlink != 0 {
			// A skill's own SKILL.md should not reach outside its folder.
			target, err := filepath.EvalSymlinks(md)
			if err != nil || !pathWithin(target, root) {
				continue
			}
			info, err = os.Stat(target)
			if err != nil {
				continue
			}
		}
		if !info.Mode().IsRegular() || info.Size() > maxSkillSize {
			continue
		}
		data, err := os.ReadFile(md)
		if err != nil {
			continue
		}
		s := parse(string(data))
		s.Source = source
		s.Path = md
		if s.Name == "" {
			s.Name = name
		}
		out = append(out, s)
	}
	return out, nil
}

// parse pulls the fields the rules look at out of a SKILL.md file.
func parse(text string) Skill {
	var s Skill
	body := text
	if fm, rest, ok := splitFrontmatter(text); ok {
		body = rest
		readFrontmatter(fm, &s)
	}
	s.Body = body
	return s
}

func splitFrontmatter(text string) (fm, rest string, ok bool) {
	// A UTF-8 BOM at the start is harmless; strip it before the fence check.
	t := strings.TrimPrefix(text, "\xef\xbb\xbf")
	t = strings.TrimLeft(t, " ")
	if !strings.HasPrefix(t, "---\n") && !strings.HasPrefix(t, "---\r\n") {
		return "", "", false
	}
	// Advance past the opening fence.
	nl := strings.Index(t, "\n")
	after := t[nl+1:]
	// Find the closing fence on a line of its own.
	end := -1
	for i := 0; i < len(after); {
		line, rest := after[i:], ""
		if j := strings.Index(line, "\n"); j >= 0 {
			line, rest = line[:j], line[j+1:]
			if strings.TrimRight(line, "\r") == "---" {
				end = i + j + 1
				_ = rest
				break
			}
			i += j + 1
		} else {
			if strings.TrimRight(line, "\r") == "---" {
				end = len(after)
			}
			break
		}
	}
	if end < 0 {
		return "", "", false
	}
	return after[:end], after[end:], true
}

// readFrontmatter is a tiny YAML reader that only knows the three fields the
// rules care about (name, description, allowed-tools). An unknown field is
// skipped; a parse failure leaves the field empty rather than refusing the
// whole skill, so a broken frontmatter still gets the body rules.
func readFrontmatter(fm string, s *Skill) {
	for _, raw := range strings.Split(fm, "\n") {
		line := strings.TrimRight(raw, "\r")
		if line == "" || strings.HasPrefix(strings.TrimSpace(line), "#") {
			continue
		}
		// Only top-level keys (no leading whitespace) are read.
		if line != strings.TrimLeft(line, " \t") {
			continue
		}
		key, val, ok := strings.Cut(line, ":")
		if !ok {
			continue
		}
		key = strings.ToLower(strings.TrimSpace(key))
		val = strings.TrimSpace(val)
		val = strings.Trim(val, "\"'")
		switch key {
		case "name":
			s.Name = val
		case "description":
			s.Description = val
		case "allowed-tools", "allowed_tools", "allowedtools":
			s.AllowedTools = splitList(val)
		}
	}
}

// splitList accepts both the inline [a, b] and bare "a, b" forms.
func splitList(v string) []string {
	v = strings.TrimSpace(v)
	v = strings.TrimPrefix(v, "[")
	v = strings.TrimSuffix(v, "]")
	if v == "" {
		return nil
	}
	parts := strings.Split(v, ",")
	out := make([]string, 0, len(parts))
	for _, p := range parts {
		p = strings.TrimSpace(p)
		p = strings.Trim(p, "\"'")
		if p != "" {
			out = append(out, p)
		}
	}
	return out
}

// pathWithin reports whether p sits inside dir after making both absolute
// and resolving symlinks on dir. Empty dir never contains anything.
func pathWithin(p, dir string) bool {
	if dir == "" {
		return false
	}
	absP, err := filepath.Abs(p)
	if err != nil {
		return false
	}
	absDir, err := filepath.Abs(dir)
	if err != nil {
		return false
	}
	if r, err := filepath.EvalSymlinks(absDir); err == nil {
		absDir = r
	}
	if r, err := filepath.EvalSymlinks(absP); err == nil {
		absP = r
	}
	rel, err := filepath.Rel(absDir, absP)
	if err != nil {
		return false
	}
	return rel != ".." && !strings.HasPrefix(rel, ".."+string(filepath.Separator))
}
