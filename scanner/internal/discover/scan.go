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
}

// maxConfigSize guards against reading huge files by mistake.
// ~/.claude.json can hold chat history, so the limit is generous.
const maxConfigSize = 64 << 20

// Scan checks every location and returns the servers found plus a record
// of each location checked.
func Scan(e Env) ([]Server, []ConfigResult) {
	var servers []Server
	var results []ConfigResult
	for _, loc := range Locations(e) {
		r := ConfigResult{Location: loc}
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
				results = append(results, r)
				continue
			}
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
	return servers, results
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
