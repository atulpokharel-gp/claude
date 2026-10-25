// Package fix moves plain-text keys out of AI agent configs and into the
// computer's password store, and rewrites each config so the server starts
// through zinloop's launcher, which hands the key back at run time.
package fix

import (
	"bytes"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"path/filepath"
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
	Launcher string // absolute path to the zinloop binary written into configs
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

// BackupMetaFile is the name of the metadata JSON kept alongside every backup
// copy. It records the file's original path so a revert can put it back
// without having to guess, even if the backup directory is moved.
const BackupMetaFile = "meta.json"

// BackupMeta is what BackupMetaFile holds. It never contains secret values.
type BackupMeta struct {
	// OriginalPath is the config path the backup was copied from, after symlinks
	// were resolved. Revert writes the restored bytes back here.
	OriginalPath string `json:"originalPath"`
	// ConfigPath is the pre-symlink path the scan found. Kept for display.
	ConfigPath string    `json:"configPath"`
	App        string    `json:"app"`
	Refs       []string  `json:"refs"`
	BackedUpAt time.Time `json:"backedUpAt"`
}

// applyFile edits one config. It stores every key in the password store first
// and verifies each one; if any step fails, every key already stored for this
// file is removed from the password store before returning, so a crash or a
// failed verify never leaves orphan keys that `rotate` and scans don't know
// about. The record of moved keys is saved before the config is rewritten,
// so a crash between saving the record and writing the config means the next
// scan sees "waiting for rotation" rather than "plain-text key in config".
func applyFile(f FileFix, opts Options, state *vault.State) (string, error) {
	// Write to the real file when the config is a symlink (dotfiles setups),
	// so the link stays and the plain-text copy doesn't survive at the target.
	target, err := filepath.EvalSymlinks(f.Path)
	if err != nil {
		return "", err
	}
	info, err := os.Stat(target)
	if err != nil {
		return "", err
	}
	orig, err := os.ReadFile(target)
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
	// stored holds the refs this call has saved to the password store, so a
	// failure midway can clean every one of them up before returning. Without
	// this, an error after the first key is Set would leave that key readable
	// from the keychain but invisible to the state file, so `rotate` and the
	// next scan would never see it.
	var stored []string
	cleanupStore := func() {
		for _, ref := range stored {
			_ = opts.Store.Delete(ref)
		}
	}

	for _, sf := range f.Servers {
		entry, err := findServer(doc, f.Format, sf.Scope, sf.Server)
		if err != nil {
			cleanupStore()
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
				cleanupStore()
				return "", fmt.Errorf("%s: env %s changed since the scan; run the fix again", sf.Server, key)
			}
			ref := sf.Refs[k]
			if err := opts.Store.Set(ref, val); err != nil {
				cleanupStore()
				return "", fmt.Errorf("save %s to the password store: %w", ref, err)
			}
			stored = append(stored, ref)
			got, err := opts.Store.Get(ref)
			if err != nil || got != val {
				cleanupStore()
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
		cleanupStore()
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
		cleanupStore()
		return "", fmt.Errorf("couldn't save the record of moved keys, nothing changed: %w", err)
	}

	backup, backupErr := writeBackup(target, f, orig, entries, now, opts.Home)
	writeErr := backupErr
	if writeErr == nil {
		writeErr = vault.WriteFileAtomic(target, buf.Bytes(), info.Mode().Perm())
	}
	if err := writeErr; err != nil {
		undoRecord()
		cleanupStore()
		if backup != "" {
			_ = os.RemoveAll(filepath.Dir(backup))
		}
		if saveErr := saveState(*state, opts.Home); saveErr != nil {
			return "", fmt.Errorf("couldn't write %s (original kept), and couldn't clean up the record: %v; %w", f.Path, saveErr, err)
		}
		return "", fmt.Errorf("couldn't write %s, original kept: %w", f.Path, err)
	}
	return backup, nil
}

// writeBackup copies the original file bytes to a private per-run folder under
// ~/.zinloop/backups/ and writes a meta.json beside it describing what to put
// back where. Keeping backups out of the AI app's config folder means a
// dotfiles backup, a stray `git add .cursor`, or a sync tool watching the
// config directory can never pick up the plain-text copy.
func writeBackup(target string, f FileFix, orig []byte, entries []vault.Entry, now time.Time, home string) (string, error) {
	dir := vault.BackupsDir(home)
	if err := os.MkdirAll(dir, 0o700); err != nil {
		return "", err
	}
	id := now.Format("20060102-150405") + "-" + shortHash(target)
	runDir := filepath.Join(dir, id)
	if err := os.MkdirAll(runDir, 0o700); err != nil {
		return "", err
	}
	// Narrow the dir perms in case umask or an older run widened them.
	_ = os.Chmod(runDir, 0o700)

	backup := filepath.Join(runDir, filepath.Base(target))
	if err := vault.WriteFileAtomic(backup, orig, 0o600); err != nil {
		_ = os.RemoveAll(runDir)
		return "", err
	}

	refs := make([]string, 0, len(entries))
	for _, e := range entries {
		refs = append(refs, e.Ref)
	}
	meta := BackupMeta{
		OriginalPath: target,
		ConfigPath:   f.Path,
		App:          f.App,
		Refs:         refs,
		BackedUpAt:   now,
	}
	data, err := json.MarshalIndent(meta, "", "  ")
	if err != nil {
		_ = os.RemoveAll(runDir)
		return "", err
	}
	if err := vault.WriteFileAtomic(filepath.Join(runDir, BackupMetaFile), append(data, '\n'), 0o600); err != nil {
		_ = os.RemoveAll(runDir)
		return "", err
	}
	return backup, nil
}

func shortHash(s string) string {
	sum := sha256.Sum256([]byte(s))
	return hex.EncodeToString(sum[:4])
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
