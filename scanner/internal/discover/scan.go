package discover

import (
	"errors"
	"io/fs"
	"os"
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
		info, err := os.Stat(loc.Path)
		if err != nil {
			if !errors.Is(err, fs.ErrNotExist) {
				r.Error = err.Error()
			}
			results = append(results, r)
			continue
		}
		r.Found = true
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
