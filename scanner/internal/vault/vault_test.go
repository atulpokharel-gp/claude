package vault

import (
	"os"
	"path/filepath"
	"testing"
)

func TestLoadStateReadsPreRenameRecord(t *testing.T) {
	home := t.TempDir()
	old := filepath.Join(home, ".agentguard", "secrets.json")
	if err := os.MkdirAll(filepath.Dir(old), 0o700); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(old, []byte(`{"entries":{"ref-1":{"app":"Cursor","configPath":"/x","movedAt":"2026-10-01T00:00:00Z"}}}`), 0o600); err != nil {
		t.Fatal(err)
	}
	st, err := LoadState(home)
	if err != nil {
		t.Fatal(err)
	}
	if _, ok := st.Entries["ref-1"]; !ok {
		t.Fatalf("old record not read: %+v", st)
	}
	if got := st.NeedsRotation(); len(got) != 1 {
		t.Fatalf("NeedsRotation = %v, want the old entry", got)
	}
	if err := st.Save(home); err != nil {
		t.Fatal(err)
	}
	if _, err := os.Stat(StatePath(home)); err != nil {
		t.Fatalf("new record not written: %v", err)
	}
}
