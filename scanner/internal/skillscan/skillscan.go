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

	"github.com/atulpokharel-gp/zinloop-zipax/scanner/internal/discover"
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
	// Default is the path this directory would have had with no overrides.
	// Empty when Path is the default.
	Default string `json:"default,omitempty"`
	// Override says why Path differs from Default (e.g. "env:CLAUDE_CONFIG_DIR",
	// "flag:--extra-skills-dir"). Empty when no override is in play.
	Override string `json:"override,omitempty"`
	// Note is a one-line informational hint about the path, such as
	// "resolved through symlink to <target>".
	Note string `json:"note,omitempty"`
}

// locations returns every directory to walk for skills, in the order the
// report should list them. "User" skills live under ~/.claude/skills,
// plugin skills under ~/.claude/plugins/<plugin>/skills, and project
// skills under <project>/.claude/skills. $CLAUDE_CONFIG_DIR, when set,
// replaces ~/.claude in all three places.
func locations(e discover.Env) []LocationResult {
	var locs []LocationResult
	if e.Home != "" {
		userDefault := filepath.Join(e.Home, ".claude", "skills")
		userPath := userDefault
		override := ""
		if e.ClaudeConfigDir != "" {
			userPath = filepath.Join(e.ClaudeConfigDir, ".claude", "skills")
			override = "env:CLAUDE_CONFIG_DIR"
		}
		lr := LocationResult{Source: "user", Path: userPath}
		if userPath != userDefault {
			lr.Default = userDefault
			lr.Override = override
		}
		locs = append(locs, lr)
	}
	if e.Home != "" {
		pluginsBase := filepath.Join(e.Home, ".claude", "plugins")
		if e.ClaudeConfigDir != "" {
			pluginsBase = filepath.Join(e.ClaudeConfigDir, ".claude", "plugins")
		}
		if entries, err := os.ReadDir(pluginsBase); err == nil {
			names := make([]string, 0, len(entries))
			for _, en := range entries {
				if en.IsDir() {
					names = append(names, en.Name())
				}
			}
			sort.Strings(names)
			for _, n := range names {
				lr := LocationResult{
					Source: "plugin:" + n,
					Path:   filepath.Join(pluginsBase, n, "skills"),
				}
				if e.ClaudeConfigDir != "" {
					lr.Default = filepath.Join(e.Home, ".claude", "plugins", n, "skills")
					lr.Override = "env:CLAUDE_CONFIG_DIR"
				}
				locs = append(locs, lr)
			}
		}
	}
	for _, dir := range e.ProjectDirs {
		locs = append(locs, LocationResult{Source: "project", Path: filepath.Join(dir, ".claude", "skills")})
	}
	for _, dir := range e.ExtraSkillDirs {
		locs = append(locs, LocationResult{
			Source:   "extra",
			Path:     dir,
			Override: "flag:--extra-skills-dir",
		})
	}
	return locs
}

// Scan walks every known skill directory for env and returns the skills
// found alongside a record of each directory walked.
func Scan(e discover.Env) ([]Skill, []LocationResult) {
	skills, locs, _ := ScanWithWarnings(e)
	return skills, locs
}

// ScanWithWarnings is Scan with the extra discover.PathWarning slice that
// flags redirected or tampered skill directories.
func ScanWithWarnings(e discover.Env) ([]Skill, []LocationResult, []discover.PathWarning) {
	locs := locations(e)
	var out []Skill
	var warnings []discover.PathWarning
	for i := range locs {
		r := &locs[i]
		if r.Override != "" {
			warnings = append(warnings, discover.PathWarning{
				App:      "Skills (" + r.Source + ")",
				Path:     r.Path,
				Default:  r.Default,
				Reason:   "path_redirected",
				Detail:   describeOverride(r.Override, r.Default),
				Severity: "medium",
			})
		}
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
			// --extra-skills-dir paths are, by definition, outside home;
			// the operator asked for them, so we don't flag them.
			if r.Source != "extra" && !pathWithin(target, e.Home) {
				r.Error = "symlink points outside the user's folder; refusing to walk it"
				warnings = append(warnings, discover.PathWarning{
					App:      "Skills (" + r.Source + ")",
					Path:     r.Path,
					Reason:   "symlink_outside_home",
					Detail:   "skill directory symlinks to " + target + " outside the user's home",
					Severity: "high",
				})
				continue
			}
			r.Note = "resolved through symlink to " + target
		}
		if !info.IsDir() && info.Mode()&os.ModeSymlink == 0 {
			r.Error = "not a directory"
			continue
		}
		if w := worldWritableDirWarning(r.Source, r.Path, info); w != nil {
			warnings = append(warnings, *w)
		}
		found, err := walk(r.Source, r.Path)
		if err != nil {
			r.Error = err.Error()
		}
		r.Skills = len(found)
		out = append(out, found...)
	}
	return out, locs, warnings
}

func describeOverride(override, def string) string {
	switch override {
	case "env:CLAUDE_CONFIG_DIR":
		if def != "" {
			return "$CLAUDE_CONFIG_DIR redirects Claude's skills away from " + def
		}
		return "$CLAUDE_CONFIG_DIR redirects Claude's skills"
	case "flag:--extra-skills-dir":
		return "operator pointed the scanner at this directory with --extra-skills-dir"
	}
	return override
}

func worldWritableDirWarning(source, path string, info os.FileInfo) *discover.PathWarning {
	if info.Mode()&0o002 == 0 {
		return nil
	}
	return &discover.PathWarning{
		App:      "Skills (" + source + ")",
		Path:     path,
		Reason:   "world_writable",
		Detail:   "skill directory is world-writable; anyone on this computer can plant a skill here",
		Severity: "high",
	}
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
