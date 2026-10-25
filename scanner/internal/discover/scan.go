package discover

import (
	"errors"
	"io/fs"
	"os"
	"path/filepath"
	"strings"
)

// ConfigResult records what happened when one location was checked.
type ConfigResult struct {
	Location
	Found   bool   `json:"found"`
	Servers int    `json:"servers"`
	Error   string `json:"error,omitempty"`
	// Note carries informational facts about the path, such as "resolved
	// through a symlink to <target>". It is not an error on its own, but
	// a reviewer should check it. One line, no secrets.
	Note string `json:"note,omitempty"`
}

// PathWarning flags something unexpected about where a config or skill folder
// is being read from: an env var redirected it, a symlink points outside the
// user's home, or the folder is writable by other users on the computer.
// Warnings surface in the report alongside configs so an operator sees them
// even when the servers themselves look clean.
type PathWarning struct {
	App      string `json:"app"`
	Path     string `json:"path"`
	Default  string `json:"default,omitempty"`
	Reason   string `json:"reason"`             // short machine-readable tag
	Detail   string `json:"detail,omitempty"`   // one-line human explanation
	Severity string `json:"severity,omitempty"` // "high" or "medium"
}

// maxConfigSize guards against reading huge files by mistake.
// ~/.claude.json can hold chat history, so the limit is generous.
const maxConfigSize = 64 << 20

// Scan checks every location and returns the servers found plus a record
// of each location checked.
func Scan(e Env) ([]Server, []ConfigResult) {
	servers, results, _ := ScanWithWarnings(e)
	return servers, results
}

// ScanWithWarnings is Scan with the extra PathWarning slice that flags
// redirected or tampered config paths. Older callers use Scan.
func ScanWithWarnings(e Env) ([]Server, []ConfigResult, []PathWarning) {
	var servers []Server
	var results []ConfigResult
	var warnings []PathWarning
	for _, loc := range Locations(e) {
		r := ConfigResult{Location: loc}
		if loc.Override != "" {
			warnings = append(warnings, PathWarning{
				App:      loc.App,
				Path:     loc.Path,
				Default:  loc.Default,
				Reason:   "path_redirected",
				Detail:   describeOverride(loc.Override, loc.Default),
				Severity: "medium",
			})
		}
		// Lstat so a symlink is seen as a symlink. A planted symlink from
		// ~/.cursor/mcp.json to /etc/shadow or /etc/passwd would otherwise
		// be read as a config and leak into the uploaded report. Users do
		// legitimately keep configs behind a symlink into their dotfiles,
		// so a symlink is allowed only when its target still sits inside
		// the home being scanned (or inside AppData on Windows).
		info, err := os.Lstat(loc.Path)
		if err != nil {
			if !errors.Is(err, fs.ErrNotExist) {
				r.Error = err.Error()
			}
			results = append(results, r)
			continue
		}
		r.Found = true
		if info.Mode()&os.ModeSymlink != 0 {
			target, err := filepath.EvalSymlinks(loc.Path)
			if err != nil {
				r.Error = "symlink couldn't be resolved: " + err.Error()
				results = append(results, r)
				continue
			}
			if !pathWithin(target, e.Home) && !pathWithin(target, e.AppData) {
				r.Error = "symlink points outside the user's folder; refusing to read it"
				warnings = append(warnings, PathWarning{
					App:      loc.App,
					Path:     loc.Path,
					Reason:   "symlink_outside_home",
					Detail:   "symlink points to " + target + " outside the user's home",
					Severity: "high",
				})
				results = append(results, r)
				continue
			}
			r.Note = "resolved through symlink to " + target
			info, err = os.Stat(target)
			if err != nil {
				r.Error = err.Error()
				results = append(results, r)
				continue
			}
		}
		if !info.Mode().IsRegular() {
			r.Error = "not a regular file; refusing to read it"
			results = append(results, r)
			continue
		}
		if info.Size() > maxConfigSize {
			r.Error = "file too large to scan"
			results = append(results, r)
			continue
		}
		if w := worldWritableWarning(loc, info); w != nil {
			warnings = append(warnings, *w)
		}
		data, err := os.ReadFile(loc.Path)
		if err != nil {
			r.Error = err.Error()
			results = append(results, r)
			continue
		}
		found, err := Parse(loc, data)
		if err != nil {
			r.Error = err.Error()
		}
		r.Servers = len(found)
		servers = append(servers, found...)
		results = append(results, r)
	}
	return servers, results, warnings
}

func describeOverride(override, def string) string {
	switch override {
	case "env:CLAUDE_CONFIG_DIR":
		return "$CLAUDE_CONFIG_DIR redirects Claude Code's config away from " + def
	case "env:XDG_CONFIG_HOME":
		return "$XDG_CONFIG_HOME redirects per-app config away from " + def
	case "flag:--extra-config":
		return "operator pointed the scanner at this file with --extra-config"
	}
	return override
}

// worldWritableWarning flags a config file whose own mode lets any user on the
// computer rewrite it. Only applies on Unix; Windows ACLs are not read here.
func worldWritableWarning(loc Location, info os.FileInfo) *PathWarning {
	mode := info.Mode()
	if mode&0o002 == 0 {
		return nil
	}
	return &PathWarning{
		App:      loc.App,
		Path:     loc.Path,
		Reason:   "world_writable",
		Detail:   "config file is world-writable; anyone on this computer can rewrite it",
		Severity: "high",
	}
}

// pathWithin reports whether p sits inside dir. Both are made absolute and
// symlink-resolved before the comparison. An empty dir never contains anything.
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
	// Resolve the parent of dir so /var vs /private/var on macOS compares equal.
	if resolved, err := filepath.EvalSymlinks(absDir); err == nil {
		absDir = resolved
	}
	if resolved, err := filepath.EvalSymlinks(absP); err == nil {
		absP = resolved
	}
	rel, err := filepath.Rel(absDir, absP)
	if err != nil {
		return false
	}
	return rel != ".." && !strings.HasPrefix(rel, ".."+string(filepath.Separator))
}
