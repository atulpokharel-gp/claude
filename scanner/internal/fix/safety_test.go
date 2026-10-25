package fix

import (
	"encoding/json"
	"errors"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"github.com/atulpokharel-gp/claude/scanner/internal/vault"
)

// countingStore fails the Nth Set call. It records every Set and Delete so
// the test can prove the fix cleans every key it stored before returning.
type countingStore struct {
	vault.Memory
	failOn int // 1-based index of the Set call that returns an error
	sets   int
	setLog []string
	delLog []string
}

func (s *countingStore) Set(ref, secret string) error {
	s.sets++
	s.setLog = append(s.setLog, ref)
	if s.sets == s.failOn {
		return errors.New("keychain refused")
	}
	return s.Memory.Set(ref, secret)
}

func (s *countingStore) Delete(ref string) error {
	s.delLog = append(s.delLog, ref)
	return s.Memory.Delete(ref)
}

// TestApplyRollsBackStoreWhenLaterKeyFails covers a two-key config where the
// first key is Set successfully but the second one fails. The first key must
// not survive in the password store or in the state file, since the config
// file is still carrying it in plain text and only the keychain would know
// anything had happened.
func TestApplyRollsBackStoreWhenLaterKeyFails(t *testing.T) {
	home := t.TempDir()
	cfg := filepath.Join(home, ".cursor", "mcp.json")
	if err := os.MkdirAll(filepath.Dir(cfg), 0o755); err != nil {
		t.Fatal(err)
	}
	payload := `{"mcpServers":{
      "a":{"command":"a-mcp","env":{"A_TOKEN":"fake-aaa-not-real"}},
      "b":{"command":"b-mcp","env":{"B_TOKEN":"fake-bbb-not-real"}}
    }}`
	if err := os.WriteFile(cfg, []byte(payload), 0o600); err != nil {
		t.Fatal(err)
	}
	before, _ := os.ReadFile(cfg)
	store := &countingStore{Memory: vault.Memory{}, failOn: 2}

	plan, err := Apply(MakePlan(scan(home)), Options{
		Home: home, Launcher: "/opt/zinloop/zinloop", Store: store,
		Now: func() time.Time { return time.Date(2026, 10, 25, 10, 0, 0, 0, time.UTC) },
	})
	if err != nil {
		t.Fatal(err)
	}

	// The failed file surfaces an error and keeps no backup.
	if len(plan.Files) != 1 || plan.Files[0].Error == "" {
		t.Fatalf("plan should carry an error: %+v", plan)
	}
	if plan.Files[0].Backup != "" {
		t.Errorf("no backup should be kept when a file wasn't rewritten: %s", plan.Files[0].Backup)
	}

	// The config file is byte-identical to what it was before.
	after, _ := os.ReadFile(cfg)
	if string(after) != string(before) {
		t.Error("config changed although the store failed")
	}

	// No plain-text key stayed in the password store.
	if len(store.Memory) != 0 {
		t.Errorf("password store still holds entries: %v", store.Memory)
	}

	// The state file knows nothing about either key.
	st, err := vault.LoadState(home)
	if err != nil {
		t.Fatal(err)
	}
	if len(st.Entries) != 0 {
		t.Errorf("state should be empty, got %v", st.Entries)
	}

	// Delete was called for the key that was actually Set.
	if len(store.delLog) != 1 || store.delLog[0] != store.setLog[0] {
		t.Errorf("want Delete called once for %q, got %v", store.setLog[0], store.delLog)
	}

	// No stray backup folder was left behind.
	entries, _ := os.ReadDir(vault.BackupsDir(home))
	if len(entries) != 0 {
		t.Errorf("backup folder should be empty: %v", entries)
	}
}

// TestNoSecretValueInErrors ensures that every error path returned by Apply
// carries no plain-text key value. If a value ever appears in an error, a
// caller that prints the error to stderr or sends it to the console leaks
// the secret.
func TestNoSecretValueInErrors(t *testing.T) {
	home := t.TempDir()
	cfg := filepath.Join(home, ".cursor", "mcp.json")
	if err := os.MkdirAll(filepath.Dir(cfg), 0o755); err != nil {
		t.Fatal(err)
	}
	secret := "fake-super-sensitive-not-real-0001"
	if err := os.WriteFile(cfg, []byte(`{"mcpServers":{"x":{"command":"x","env":{"X_TOKEN":"`+secret+`"}}}}`), 0o600); err != nil {
		t.Fatal(err)
	}

	cases := []struct {
		name  string
		store vault.Store
		save  func(vault.State, string) error
	}{
		{"store set fails", failingStore{vault.Memory{}}, nil},
		{"state save fails", vault.Memory{}, func(vault.State, string) error { return errors.New("disk full") }},
	}
	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			if c.save != nil {
				old := saveState
				saveState = c.save
				t.Cleanup(func() { saveState = old })
			}
			plan, err := Apply(MakePlan(scan(home)), Options{Home: home, Launcher: "/opt/zinloop", Store: c.store})
			if err != nil && strings.Contains(err.Error(), secret) {
				t.Fatalf("Apply error leaks the secret value: %v", err)
			}
			for _, f := range plan.Files {
				if strings.Contains(f.Error, secret) {
					t.Errorf("file-level error leaks the secret value: %s", f.Error)
				}
			}
		})
	}
}

// TestRevertRestoresConfigAndClearsStore builds a config, applies the fix,
// then reverts and checks that the file is byte-identical, no key is left
// in the password store, no entry is left in the state file, and the backup
// folder is gone.
func TestRevertRestoresConfigAndClearsStore(t *testing.T) {
	home := t.TempDir()
	cfg := filepath.Join(home, ".cursor", "mcp.json")
	if err := os.MkdirAll(filepath.Dir(cfg), 0o755); err != nil {
		t.Fatal(err)
	}
	before := []byte(`{"mcpServers":{"gh":{"command":"gh-mcp","env":{"GITHUB_TOKEN":"fake-gh-not-real"}}}}`)
	if err := os.WriteFile(cfg, before, 0o600); err != nil {
		t.Fatal(err)
	}
	store := vault.Memory{}
	plan, err := Apply(MakePlan(scan(home)), Options{
		Home: home, Launcher: "/opt/zinloop", Store: store,
		Now: func() time.Time { return time.Date(2026, 10, 25, 12, 0, 0, 0, time.UTC) },
	})
	if err != nil {
		t.Fatal(err)
	}
	if len(plan.Files) != 1 || plan.Files[0].Backup == "" {
		t.Fatalf("fix should produce one backup: %+v", plan)
	}

	backups, err := Revertable(home)
	if err != nil {
		t.Fatal(err)
	}
	if len(backups) != 1 {
		t.Fatalf("want 1 revertable backup, got %d", len(backups))
	}
	if err := Revert(backups[0], RevertOptions{Home: home, Store: store}); err != nil {
		t.Fatal(err)
	}
	after, _ := os.ReadFile(cfg)
	if string(after) != string(before) {
		t.Errorf("revert should restore the file byte-for-byte, got:\n%s", after)
	}
	if len(store) != 0 {
		t.Errorf("revert should clear the password store, got %v", store)
	}
	st, _ := vault.LoadState(home)
	if len(st.Entries) != 0 {
		t.Errorf("revert should clear the state entries, got %v", st.Entries)
	}
	if _, err := os.Stat(backups[0].Dir); !os.IsNotExist(err) {
		t.Errorf("revert should drop the backup folder, got err=%v", err)
	}
}

// TestRevertRefusesRotatedKey covers the scenario where a user has already
// rotated the key (so the provider no longer accepts the old value). Reverting
// would silently point the AI app at a revoked key, which looks fine until
// the app tries to use it, so the fix refuses without --force.
func TestRevertRefusesRotatedKey(t *testing.T) {
	home := t.TempDir()
	cfg := filepath.Join(home, ".cursor", "mcp.json")
	if err := os.MkdirAll(filepath.Dir(cfg), 0o755); err != nil {
		t.Fatal(err)
	}
	before := []byte(`{"mcpServers":{"gh":{"command":"gh-mcp","env":{"GITHUB_TOKEN":"fake-gh-old"}}}}`)
	if err := os.WriteFile(cfg, before, 0o600); err != nil {
		t.Fatal(err)
	}
	store := vault.Memory{}
	if _, err := Apply(MakePlan(scan(home)), Options{
		Home: home, Launcher: "/opt/zinloop", Store: store,
		Now: func() time.Time { return time.Date(2026, 10, 25, 13, 0, 0, 0, time.UTC) },
	}); err != nil {
		t.Fatal(err)
	}
	// Simulate a rotation.
	st, _ := vault.LoadState(home)
	var ref string
	for r := range st.Entries {
		ref = r
	}
	now := time.Now().UTC()
	e := st.Entries[ref]
	e.RotatedAt = &now
	st.Entries[ref] = e
	if err := st.Save(home); err != nil {
		t.Fatal(err)
	}

	backups, _ := Revertable(home)
	if len(backups) != 1 {
		t.Fatalf("want 1 backup, got %d", len(backups))
	}
	// Without --force, revert refuses.
	err := Revert(backups[0], RevertOptions{Home: home, Store: store})
	if err == nil || !strings.Contains(err.Error(), "rotated") {
		t.Fatalf("expected rotation refusal, got %v", err)
	}
	// With --force, revert goes through.
	if err := Revert(backups[0], RevertOptions{Home: home, Store: store, Force: true}); err != nil {
		t.Fatalf("--force revert should succeed, got %v", err)
	}
	after, _ := os.ReadFile(cfg)
	if string(after) != string(before) {
		t.Error("force revert didn't restore the file")
	}
}

// TestBackupPermissionsAndContents verifies the directory is private, the
// backup file has owner-only permissions, the meta.json records the original
// path, and the content is the exact original — including the plain-text key,
// since revert needs it to put the file back.
func TestBackupPermissionsAndContents(t *testing.T) {
	home := t.TempDir()
	cfg := filepath.Join(home, ".cursor", "mcp.json")
	if err := os.MkdirAll(filepath.Dir(cfg), 0o755); err != nil {
		t.Fatal(err)
	}
	before := []byte(`{"mcpServers":{"gh":{"command":"gh-mcp","env":{"GITHUB_TOKEN":"fake-gh"}}}}`)
	if err := os.WriteFile(cfg, before, 0o600); err != nil {
		t.Fatal(err)
	}
	plan, err := Apply(MakePlan(scan(home)), Options{
		Home: home, Launcher: "/opt/zinloop", Store: vault.Memory{},
		Now: func() time.Time { return time.Date(2026, 10, 25, 14, 0, 0, 0, time.UTC) },
	})
	if err != nil {
		t.Fatal(err)
	}
	backup := plan.Files[0].Backup
	data, _ := os.ReadFile(backup)
	if string(data) != string(before) {
		t.Error("backup should be byte-identical to the original")
	}
	meta, err := os.ReadFile(filepath.Join(filepath.Dir(backup), BackupMetaFile))
	if err != nil {
		t.Fatal(err)
	}
	var m BackupMeta
	if err := json.Unmarshal(meta, &m); err != nil {
		t.Fatal(err)
	}
	// OriginalPath is the config path after symlinks were resolved. macOS
	// temp dirs sit behind /var -> /private/var, so compare against the
	// resolved form rather than whatever path t.TempDir happened to return.
	wantOriginal, _ := filepath.EvalSymlinks(cfg)
	if wantOriginal == "" {
		wantOriginal = cfg
	}
	if m.OriginalPath != wantOriginal {
		t.Errorf("meta.OriginalPath = %q, want %q", m.OriginalPath, wantOriginal)
	}
	if len(m.Refs) != 1 {
		t.Errorf("meta.Refs = %v, want 1 entry", m.Refs)
	}
}
