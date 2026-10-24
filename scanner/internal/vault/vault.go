// Package vault stores secrets in the computer's own password store
// (macOS Keychain, Windows Credential Manager, or the Linux Secret Service)
// and keeps a small record of which keys were moved and replaced.
// The record never contains secret values.
package vault

import (
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"sort"
	"strings"
	"time"

	"github.com/zalando/go-keyring"
)

// Service is the name every Zinloop entry is filed under in the password store.
const Service = "zinloop"

// legacyService is where versions before the rename (agentscan) filed keys.
// They are still read, so keys protected before upgrading keep working.
const legacyService = "agent-guard"

// ErrNotFound means the password store has no entry for a ref.
var ErrNotFound = errors.New("not found in the password store")

// Store reads and writes secrets by ref.
type Store interface {
	Set(ref, secret string) error
	Get(ref string) (string, error)
	Delete(ref string) error
}

// Keyring is the Store backed by the operating system's password store.
type Keyring struct{}

func (Keyring) Set(ref, secret string) error { return keyring.Set(Service, ref, secret) }

func (Keyring) Get(ref string) (string, error) {
	v, err := keyring.Get(Service, ref)
	if errors.Is(err, keyring.ErrNotFound) {
		v, err = keyring.Get(legacyService, ref)
	}
	if errors.Is(err, keyring.ErrNotFound) {
		return "", ErrNotFound
	}
	return v, err
}

func (Keyring) Delete(ref string) error {
	err := keyring.Delete(Service, ref)
	if errors.Is(err, keyring.ErrNotFound) {
		err = nil
	}
	if lerr := keyring.Delete(legacyService, ref); lerr != nil && !errors.Is(lerr, keyring.ErrNotFound) && err == nil {
		err = lerr
	}
	return err
}

// Memory is an in-memory Store for tests.
type Memory map[string]string

func (m Memory) Set(ref, secret string) error { m[ref] = secret; return nil }
func (m Memory) Get(ref string) (string, error) {
	v, ok := m[ref]
	if !ok {
		return "", ErrNotFound
	}
	return v, nil
}
func (m Memory) Delete(ref string) error { delete(m, ref); return nil }

// Ref builds a readable, stable, unique name for one secret, e.g.
// "claude-desktop/github/GITHUB_PERSONAL_ACCESS_TOKEN@3f9a1c2e". The suffix
// is a short hash of the config file's full path and scope, so the same
// server name in two projects never shares an entry.
func Ref(app, configPath, scope, server, envKey string) string {
	parts := []string{slug(app)}
	if scope != "" {
		parts = append(parts, slug(filepath.Base(scope)))
	}
	parts = append(parts, slug(server), envKey)
	sum := sha256.Sum256([]byte(configPath + "\x00" + scope + "\x00" + server))
	return strings.Join(parts, "/") + "@" + hex.EncodeToString(sum[:4])
}

func slug(s string) string {
	s = strings.ToLower(strings.TrimSpace(s))
	var b strings.Builder
	dash := false
	for _, r := range s {
		ok := (r >= 'a' && r <= 'z') || (r >= '0' && r <= '9') || r == '.' || r == '_'
		if ok {
			b.WriteRune(r)
			dash = false
		} else if !dash && b.Len() > 0 {
			b.WriteByte('-')
			dash = true
		}
	}
	return strings.TrimSuffix(b.String(), "-")
}

// Entry records one moved secret. It holds names and dates only.
type Entry struct {
	Ref        string     `json:"ref"`
	EnvKey     string     `json:"envKey"`
	Server     string     `json:"server"`
	App        string     `json:"app"`
	ConfigPath string     `json:"configPath"`
	MovedAt    time.Time  `json:"movedAt"`
	RotatedAt  *time.Time `json:"rotatedAt,omitempty"`
}

// State is the record of moved secrets, kept at ~/.zinloop/secrets.json.
type State struct {
	Entries map[string]Entry `json:"entries"`
}

// StatePath returns where the record lives for a home directory.
func StatePath(home string) string {
	return filepath.Join(home, ".zinloop", "secrets.json")
}

// legacyStatePath is where versions before the rename kept the record.
func legacyStatePath(home string) string {
	return filepath.Join(home, ".agentguard", "secrets.json")
}

// LoadState reads the record. A missing file is an empty record. If only the
// pre-rename record exists, it is read instead; the next Save writes the new path.
func LoadState(home string) (State, error) {
	st := State{Entries: map[string]Entry{}}
	data, err := os.ReadFile(StatePath(home))
	if errors.Is(err, os.ErrNotExist) {
		data, err = os.ReadFile(legacyStatePath(home))
	}
	if errors.Is(err, os.ErrNotExist) {
		return st, nil
	}
	if err != nil {
		return st, err
	}
	if err := json.Unmarshal(data, &st); err != nil {
		return st, fmt.Errorf("read %s: %w", StatePath(home), err)
	}
	if st.Entries == nil {
		st.Entries = map[string]Entry{}
	}
	return st, nil
}

// Save writes the record with owner-only permissions.
func (st State) Save(home string) error {
	p := StatePath(home)
	if err := os.MkdirAll(filepath.Dir(p), 0o700); err != nil {
		return err
	}
	data, err := json.MarshalIndent(st, "", "  ")
	if err != nil {
		return err
	}
	return WriteFileAtomic(p, append(data, '\n'), 0o600)
}

// NeedsRotation lists refs that were moved but not yet replaced, sorted.
func (st State) NeedsRotation() []string {
	var out []string
	for ref, e := range st.Entries {
		if e.RotatedAt == nil {
			out = append(out, ref)
		}
	}
	sort.Strings(out)
	return out
}

// WriteFileAtomic writes to a temp file in the same folder, then renames it
// over the target, so a crash never leaves a half-written config.
func WriteFileAtomic(path string, data []byte, perm os.FileMode) error {
	dir := filepath.Dir(path)
	tmp, err := os.CreateTemp(dir, "."+filepath.Base(path)+".tmp-*")
	if err != nil {
		return err
	}
	tmpName := tmp.Name()
	defer os.Remove(tmpName) // no-op after a successful rename
	if _, err := tmp.Write(data); err != nil {
		tmp.Close()
		return err
	}
	if err := tmp.Chmod(perm); err != nil {
		tmp.Close()
		return err
	}
	if err := tmp.Close(); err != nil {
		return err
	}
	return os.Rename(tmpName, path)
}
