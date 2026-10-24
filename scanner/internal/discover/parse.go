package discover

import (
	"encoding/json"
	"fmt"
	"sort"
	"strings"
)

// Server is one MCP server found in a config file.
//
// Env and Headers keep their values in memory so rules can check them, but
// those values are never written to a report. Only the key names are.
type Server struct {
	Name       string   `json:"name"`
	App        string   `json:"app"`
	ConfigPath string   `json:"configPath"`
	Scope      string   `json:"scope,omitempty"` // e.g. project path for Claude Code project servers
	Transport  string   `json:"transport"`       // "stdio" or "remote"
	Command    string   `json:"command,omitempty"`
	Args       []string `json:"args,omitempty"`
	URL        string   `json:"url,omitempty"`
	EnvKeys    []string `json:"envKeys,omitempty"`
	HeaderKeys []string `json:"headerKeys,omitempty"`
	Disabled   bool     `json:"disabled,omitempty"`
	// Protected lists env vars that Agent Guard's launcher fills from the
	// secure password store. Command and Args then describe the real server.
	Protected []ProtectedSecret `json:"protectedSecrets,omitempty"`
	Format    Format            `json:"-"` // layout of the file it came from
	Env       map[string]string `json:"-"`
	Headers   map[string]string `json:"-"`
}

type rawServer struct {
	Command   string            `json:"command"`
	Args      []string          `json:"args"`
	Env       map[string]string `json:"env"`
	URL       string            `json:"url"`
	ServerURL string            `json:"serverUrl"`
	Type      string            `json:"type"`
	Headers   map[string]string `json:"headers"`
	Disabled  bool              `json:"disabled"`
}

// Parse reads the servers out of one config file's contents.
func Parse(loc Location, data []byte) ([]Server, error) {
	clean := StripJSONC(data)
	if len(strings.TrimSpace(string(clean))) == 0 {
		return nil, nil
	}
	switch loc.Format {
	case FormatMCPServers:
		var doc struct {
			MCPServers map[string]json.RawMessage `json:"mcpServers"`
		}
		if err := json.Unmarshal(clean, &doc); err != nil {
			return nil, fmt.Errorf("parse %s: %w", loc.Path, err)
		}
		out, bad := toServers(loc, "", doc.MCPServers)
		return out, badEntriesError(bad)

	case FormatClaudeCode:
		var doc struct {
			MCPServers map[string]json.RawMessage `json:"mcpServers"`
			Projects   map[string]struct {
				MCPServers map[string]json.RawMessage `json:"mcpServers"`
			} `json:"projects"`
		}
		if err := json.Unmarshal(clean, &doc); err != nil {
			return nil, fmt.Errorf("parse %s: %w", loc.Path, err)
		}
		out, bad := toServers(loc, "", doc.MCPServers)
		projects := make([]string, 0, len(doc.Projects))
		for p := range doc.Projects {
			projects = append(projects, p)
		}
		sort.Strings(projects)
		for _, p := range projects {
			more, moreBad := toServers(loc, p, doc.Projects[p].MCPServers)
			out = append(out, more...)
			bad = append(bad, moreBad...)
		}
		return out, badEntriesError(bad)

	case FormatVSCodeServers:
		var doc struct {
			Servers map[string]json.RawMessage `json:"servers"`
		}
		if err := json.Unmarshal(clean, &doc); err != nil {
			return nil, fmt.Errorf("parse %s: %w", loc.Path, err)
		}
		out, bad := toServers(loc, "", doc.Servers)
		return out, badEntriesError(bad)

	case FormatVSCodeSettings:
		var doc struct {
			MCP struct {
				Servers map[string]json.RawMessage `json:"servers"`
			} `json:"mcp"`
		}
		if err := json.Unmarshal(clean, &doc); err != nil {
			return nil, fmt.Errorf("parse %s: %w", loc.Path, err)
		}
		out, bad := toServers(loc, "", doc.MCP.Servers)
		return out, badEntriesError(bad)
	}
	return nil, fmt.Errorf("unknown format %q", loc.Format)
}

// toServers decodes each server entry. Entries that can't be decoded are
// skipped so the rest of the file is still checked, and their names are
// returned so the scan can say it is incomplete.
func toServers(loc Location, scope string, raw map[string]json.RawMessage) ([]Server, []string) {
	names := make([]string, 0, len(raw))
	for n := range raw {
		names = append(names, n)
	}
	sort.Strings(names)

	var out []Server
	var bad []string
	for _, name := range names {
		var r rawServer
		if err := json.Unmarshal(raw[name], &r); err != nil {
			label := name
			if scope != "" {
				label = scope + ": " + name
			}
			bad = append(bad, label)
			continue
		}
		s := Server{
			Name:       name,
			App:        loc.App,
			ConfigPath: loc.Path,
			Format:     loc.Format,
			Scope:      scope,
			Command:    r.Command,
			Args:       r.Args,
			URL:        r.URL,
			Env:        r.Env,
			Headers:    r.Headers,
			Disabled:   r.Disabled,
		}
		if s.URL == "" {
			s.URL = r.ServerURL
		}
		if sec, cmd, args, ok := ParseLauncher(s.Command, s.Args); ok {
			s.Protected, s.Command, s.Args = sec, cmd, args
		}
		if s.URL != "" || r.Type == "http" || r.Type == "sse" || r.Type == "streamable-http" {
			s.Transport = "remote"
		} else {
			s.Transport = "stdio"
		}
		s.EnvKeys = sortedKeys(r.Env)
		s.HeaderKeys = sortedKeys(r.Headers)
		out = append(out, s)
	}
	return out, bad
}

func badEntriesError(bad []string) error {
	if len(bad) == 0 {
		return nil
	}
	return fmt.Errorf("couldn't read %d server entr%s (%s); they were not checked", len(bad), map[bool]string{true: "y", false: "ies"}[len(bad) == 1], strings.Join(bad, ", "))
}

func sortedKeys(m map[string]string) []string {
	if len(m) == 0 {
		return nil
	}
	keys := make([]string, 0, len(m))
	for k := range m {
		keys = append(keys, k)
	}
	sort.Strings(keys)
	return keys
}

// StripJSONC removes // and /* */ comments and trailing commas so that
// JSON-with-comments files (like VS Code settings) parse as plain JSON.
func StripJSONC(in []byte) []byte {
	out := make([]byte, 0, len(in))
	inStr, esc := false, false
	for i := 0; i < len(in); i++ {
		c := in[i]
		if inStr {
			out = append(out, c)
			switch {
			case esc:
				esc = false
			case c == '\\':
				esc = true
			case c == '"':
				inStr = false
			}
			continue
		}
		if c == '"' {
			inStr = true
			out = append(out, c)
			continue
		}
		if c == '/' && i+1 < len(in) && in[i+1] == '/' {
			for i < len(in) && in[i] != '\n' {
				i++
			}
			if i < len(in) {
				out = append(out, '\n')
			}
			continue
		}
		if c == '/' && i+1 < len(in) && in[i+1] == '*' {
			i += 2
			for i+1 < len(in) && !(in[i] == '*' && in[i+1] == '/') {
				i++
			}
			i++ // skip the closing '/'
			continue
		}
		out = append(out, c)
	}
	return stripTrailingCommas(out)
}

func stripTrailingCommas(in []byte) []byte {
	out := make([]byte, 0, len(in))
	inStr, esc := false, false
	for i := 0; i < len(in); i++ {
		c := in[i]
		if inStr {
			out = append(out, c)
			switch {
			case esc:
				esc = false
			case c == '\\':
				esc = true
			case c == '"':
				inStr = false
			}
			continue
		}
		if c == '"' {
			inStr = true
		}
		if c == ',' {
			j := i + 1
			for j < len(in) && (in[j] == ' ' || in[j] == '\t' || in[j] == '\n' || in[j] == '\r') {
				j++
			}
			if j < len(in) && (in[j] == '}' || in[j] == ']') {
				continue
			}
		}
		out = append(out, c)
	}
	return out
}
