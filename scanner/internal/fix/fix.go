// Package fix moves plain-text keys out of AI agent configs and into the
// computer's password store, and rewrites each config so the server starts
// through agentscan's launcher, which hands the key back at run time.
package fix

import (
	"bytes"
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"sort"
	"strconv"
	"time"

	"github.com/atulpokharel-gp/claude/scanner/internal/discover"
	"github.com/atulpokharel-gp/claude/scanner/internal/rules"
	"github.com/atulpokharel-gp/claude/scanner/internal/vault"
)

// ServerFix is one server whose env keys will be moved.
type ServerFix struct {
	Server  string   `json:"server"`
	Scope   string   `json:"scope,omitempty"`
	EnvKeys []string `json:"envKeys"`
	Refs    []string `json:"refs"`
}

// FileFix groups the changes for one config file.
type FileFix struct {
	Path    string          `json:"path"`
	App     string          `json:"app"`
	Format  discover.Format `json:"format"`
	Servers []ServerFix     `json:"servers"`
	// Blocked explains why this file must be fixed by hand. Empty means it can be fixed.
	Blocked string `json:"blocked,omitempty"`
	// Backup is where the original file was copied. Set after Apply.
	Backup string `json:"backup,omitempty"`
	// Error is set if Apply failed for this file. The file is left unchanged.
	Error string `json:"error,omitempty"`
}

// Manual is a credential the fix command can't move automatically.
type Manual struct {
	Path   string `json:"path"`
	App    string `json:"app"`
	Server string `json:"server"`
	Where  string `json:"where"`
}

// Plan lists everything the fix would change.
type Plan struct {
	Files  []FileFix `json:"files"`
	Manual []Manual  `json:"manual"`
}

// Keys counts the env keys the plan would move.
func (p Plan) Keys() int {
	n := 0
	for _, f := range p.Files {
		if f.Blocked != "" {
			continue
		}
		for _, s := range f.Servers {
			n += len(s.EnvKeys)
		}
	}
	return n
}

// MakePlan works out what to move. It reads nothing and changes nothing.
func MakePlan(servers []discover.Server) Plan {
	var plan Plan
	byPath := map[string]int{}
	for _, s := range servers {
		for _, h := range rules.SecretHeaderKeys(s.Headers) {
			plan.Manual = append(plan.Manual, Manual{s.ConfigPath, s.App, s.Name, "header " + h})
		}
		for _, i := range rules.SecretArgs(s.Args) {
			plan.Manual = append(plan.Manual, Manual{s.ConfigPath, s.App, s.Name, "command-line argument " + strconv.Itoa(i+1)})
		}
		if rules.URLHasCredential(s.URL) {
			plan.Manual = append(plan.Manual, Manual{s.ConfigPath, s.App, s.Name, "server URL"})
		}

		keys := rules.SecretEnvKeys(s.Env)
		if len(keys) == 0 {
			continue
		}
		if s.Transport != "stdio" || s.Command == "" {
			for _, k := range keys {
				plan.Manual = append(plan.Manual, Manual{s.ConfigPath, s.App, s.Name, "env " + k + " (remote server)"})
			}
			continue
		}
		i, ok := byPath[s.ConfigPath]
		if !ok {
			ff := FileFix{Path: s.ConfigPath, App: s.App, Format: s.Format}
			if ff.Format == discover.FormatVSCodeSettings {
				ff.Blocked = "VS Code settings.json can hold comments that rewriting would remove. Move the MCP servers to VS Code's mcp.json, then run the fix again."
			}
			plan.Files = append(plan.Files, ff)
			i = len(plan.Files) - 1
			byPath[s.ConfigPath] = i
		}
		sf := ServerFix{Server: s.Name, Scope: s.Scope, EnvKeys: keys}
		for _, k := range keys {
			sf.Refs = append(sf.Refs, vault.Ref(s.App, s.ConfigPath, s.Scope, s.Name, k))
		}
		plan.Files[i].Servers = append(plan.Files[i].Servers, sf)
	}
	return plan
}

// saveState writes the record of moved keys. Tests replace it to simulate failures.
var saveState = func(st vault.State, home string) error { return st.Save(home) }

// Options controls Apply.
type Options struct {
	Home     string // where the moved-secrets record lives
	Launcher string // absolute path to the agentscan binary written into configs
	Store    vault.Store
	Now      func() time.Time
}

// Apply carries out the plan, one file at a time. For each file it stores and
// verifies every key first, then backs up the file, then writes the new
// version. If anything fails, that file is left as it was.
func Apply(plan Plan, opts Options) (Plan, error) {
	if opts.Launcher == "" {
		return plan, errors.New("launcher path is empty")
	}
	if opts.Now == nil {
		opts.Now = time.Now
	}
	state, err := vault.LoadState(opts.Home)
	if err != nil {
		return plan, err
	}
	for i := range plan.Files {
		f := &plan.Files[i]
		if f.Blocked != "" {
			continue
		}
		backup, err := applyFile(*f, opts, &state)
		if err != nil {
			f.Error = err.Error()
			continue
		}
		f.Backup = backup
	}
	return plan, nil
}

// applyFile edits one config. The record of moved keys is saved before the
// config is rewritten, so a crash or failure can never leave a protected key
// that rotate and scans don't know about. If the rewrite then fails, the
// new record entries are removed again.
func applyFile(f FileFix, opts Options, state *vault.State) (string, error) {
	info, err := os.Stat(f.Path)
	if err != nil {
		return "", err
	}
	orig, err := os.ReadFile(f.Path)
	if err != nil {
		return "", err
	}
	if !json.Valid(orig) {
		return "", errors.New("file has comments or isn't plain JSON; fix it by hand so nothing is lost")
	}
	var doc map[string]any
	dec := json.NewDecoder(bytes.NewReader(orig))
	dec.UseNumber() // keep numbers exactly as written
	if err := dec.Decode(&doc); err != nil {
		return "", err
	}

	now := opts.Now().UTC()
	var entries []vault.Entry
	for _, sf := range f.Servers {
		entry, err := findServer(doc, f.Format, sf.Scope, sf.Server)
		if err != nil {
			return "", err
		}
		env, _ := entry["env"].(map[string]any)
		cmd, _ := entry["command"].(string)
		args := toStrings(entry["args"])
		protected, inner, innerArgs, wrapped := discover.ParseLauncher(cmd, args)
		if !wrapped {
			inner, innerArgs = cmd, args
		}
		for k, key := range sf.EnvKeys {
			val, ok := env[key].(string)
			if !ok {
				return "", fmt.Errorf("%s: env %s changed since the scan; run the fix again", sf.Server, key)
			}
			ref := sf.Refs[k]
			if err := opts.Store.Set(ref, val); err != nil {
				return "", fmt.Errorf("save %s to the password store: %w", ref, err)
			}
			got, err := opts.Store.Get(ref)
			if err != nil || got != val {
				return "", fmt.Errorf("password store didn't return %s correctly; nothing was changed in %s", ref, f.Path)
			}
			delete(env, key)
			protected = append(protected, discover.ProtectedSecret{Env: key, Ref: ref})
			entries = append(entries, vault.Entry{Ref: ref, EnvKey: key, Server: sf.Server, App: f.App, ConfigPath: f.Path, MovedAt: now})
		}
		sort.SliceStable(protected, func(a, b int) bool { return protected[a].Env < protected[b].Env })
		if len(env) == 0 {
			delete(entry, "env")
		}
		entry["command"] = opts.Launcher
		entry["args"] = discover.LauncherArgs(protected, inner, innerArgs)
	}

	var buf bytes.Buffer
	enc := json.NewEncoder(&buf)
	enc.SetEscapeHTML(false)
	enc.SetIndent("", "  ")
	if err := enc.Encode(doc); err != nil {
		return "", err
	}

	previous := map[string]*vault.Entry{}
	for _, e := range entries {
		if old, ok := state.Entries[e.Ref]; ok {
			previous[e.Ref] = &old
		} else {
			previous[e.Ref] = nil
		}
		state.Entries[e.Ref] = e
	}
	undoRecord := func() {
		for ref, old := range previous {
			if old == nil {
				delete(state.Entries, ref)
			} else {
				state.Entries[ref] = *old
			}
		}
	}
	if err := saveState(*state, opts.Home); err != nil {
		undoRecord()
		return "", fmt.Errorf("couldn't save the record of moved keys, nothing changed: %w", err)
	}
	backup := f.Path + ".agentguard-backup-" + now.Format("20060102-150405")
	writeErr := os.WriteFile(backup, orig, 0o600)
	if writeErr == nil {
		writeErr = vault.WriteFileAtomic(f.Path, buf.Bytes(), info.Mode().Perm())
	}
	if err := writeErr; err != nil {
		undoRecord()
		if saveErr := saveState(*state, opts.Home); saveErr != nil {
			return "", fmt.Errorf("couldn't write %s (original kept), and couldn't clean up the record: %v; %w", f.Path, saveErr, err)
		}
		return "", fmt.Errorf("couldn't write %s, original kept: %w", f.Path, err)
	}
	return backup, nil
}

func findServer(doc map[string]any, format discover.Format, scope, name string) (map[string]any, error) {
	var servers map[string]any
	switch format {
	case discover.FormatMCPServers:
		servers, _ = doc["mcpServers"].(map[string]any)
	case discover.FormatClaudeCode:
		if scope == "" {
			servers, _ = doc["mcpServers"].(map[string]any)
		} else {
			projects, _ := doc["projects"].(map[string]any)
			project, _ := projects[scope].(map[string]any)
			servers, _ = project["mcpServers"].(map[string]any)
		}
	case discover.FormatVSCodeServers:
		servers, _ = doc["servers"].(map[string]any)
	default:
		return nil, fmt.Errorf("can't edit %q files automatically", format)
	}
	entry, ok := servers[name].(map[string]any)
	if !ok {
		return nil, fmt.Errorf("server %q not found; the file changed since the scan", name)
	}
	return entry, nil
}

func toStrings(v any) []string {
	list, _ := v.([]any)
	out := make([]string, 0, len(list))
	for _, x := range list {
		if s, ok := x.(string); ok {
			out = append(out, s)
		}
	}
	return out
}
