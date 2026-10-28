package main

import (
	"bytes"
	"encoding/json"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"github.com/atulpokharel-gp/zinloop-zipax/scanner/internal/fix"
)

func TestRevertListAndRun(t *testing.T) {
	home := fixtureHome(t)
	store := useMemoryStore(t)

	// Apply the fix so there is something to revert.
	var out, errOut bytes.Buffer
	if code := run([]string{"fix-secrets", "--home", home, "--apply", "--launcher", fakeLauncher(t, home)}, &out, &errOut); code != 0 {
		t.Fatalf("fix-secrets --apply exit %d: %s", code, errOut.String())
	}
	before := len(store)
	if before == 0 {
		t.Fatal("fixture should produce store entries")
	}

	// --list --json surfaces every backup with its original path.
	out.Reset()
	errOut.Reset()
	if code := run([]string{"revert", "--home", home, "--list", "--json"}, &out, &errOut); code != 0 {
		t.Fatalf("revert --list exit %d: %s", code, errOut.String())
	}
	var listed []fix.Backup
	if err := json.Unmarshal(out.Bytes(), &listed); err != nil {
		t.Fatalf("revert --list output isn't valid JSON: %v\n%s", err, out.String())
	}
	if len(listed) == 0 {
		t.Fatal("revert --list showed no backups")
	}
	target := listed[0]

	// Make sure no secret value ever appears in the listing.
	src, _ := filepath.Abs("../../testdata/home")
	for _, secret := range []string{"fake-demo-token-not-real-0001", "fake-stripe-value-not-real"} {
		if strings.Contains(out.String(), secret) || strings.Contains(errOut.String(), secret) {
			t.Errorf("revert --list leaked secret %q", secret)
		}
	}
	_ = src

	// Revert the first backup.
	out.Reset()
	errOut.Reset()
	if code := run([]string{"revert", "--home", home, target.ID}, &out, &errOut); code != 0 {
		t.Fatalf("revert exit %d: %s", code, errOut.String())
	}
	if !strings.Contains(out.String(), target.Meta.OriginalPath) {
		t.Errorf("revert output should name the restored file: %s", out.String())
	}

	// The restored file no longer runs through the launcher.
	data, err := os.ReadFile(target.Meta.OriginalPath)
	if err != nil {
		t.Fatal(err)
	}
	if bytes.Contains(data, []byte("zinloop")) {
		t.Errorf("restored file still looks like a wrapped launcher config: %s", data)
	}
	// Keys that belonged to that file are gone from the store.
	for _, ref := range target.Meta.Refs {
		if _, ok := store[ref]; ok {
			t.Errorf("store still has %q after revert", ref)
		}
	}
	if _, err := os.Stat(target.Dir); !os.IsNotExist(err) {
		t.Errorf("revert should remove the backup folder, stat err = %v", err)
	}
}

func TestRevertUnknownID(t *testing.T) {
	home := t.TempDir()
	useMemoryStore(t)
	var out, errOut bytes.Buffer
	if code := run([]string{"revert", "--home", home, "no-such-id"}, &out, &errOut); code == 0 {
		t.Error("unknown id should exit non-zero")
	}
	if !strings.Contains(errOut.String(), "no backup with id") {
		t.Errorf("stderr should name the problem: %s", errOut.String())
	}
}

func TestRevertListWhenEmpty(t *testing.T) {
	home := t.TempDir()
	useMemoryStore(t)
	var out, errOut bytes.Buffer
	if code := run([]string{"revert", "--home", home, "--list"}, &out, &errOut); code != 0 {
		t.Fatalf("revert --list on empty home exit %d: %s", code, errOut.String())
	}
	if !strings.Contains(out.String(), "No restorable backups") {
		t.Errorf("expected a friendly empty message, got: %s", out.String())
	}
}
