package zipax

import (
	"os"
	"path/filepath"
	"runtime"
	"testing"
)

func TestLoadOrCreateClaimTokenCreatesAndReuses(t *testing.T) {
	home := t.TempDir()
	a, err := loadOrCreateClaimToken(home)
	if err != nil {
		t.Fatal(err)
	}
	if !validClaimTokenShape(a) {
		t.Fatalf("new token not valid shape: %q", a)
	}
	b, err := loadOrCreateClaimToken(home)
	if err != nil {
		t.Fatal(err)
	}
	if a != b {
		t.Errorf("expected the same token on second call, got %q then %q", a, b)
	}
	// File perms must be 0600 on Unix. Windows does not honor Unix perms —
	// os.Stat always reports 0666 there regardless of what Chmod did.
	st, err := os.Stat(filepath.Join(home, ".zinloop", "zipax-claim-token"))
	if err != nil {
		t.Fatal(err)
	}
	if runtime.GOOS != "windows" {
		if perm := st.Mode().Perm(); perm != 0o600 {
			t.Errorf("token file perm = %o, want 0600", perm)
		}
	}
}

func TestLoadOrCreateClaimTokenReplacesMalformed(t *testing.T) {
	home := t.TempDir()
	dir := filepath.Join(home, ".zinloop")
	if err := os.MkdirAll(dir, 0o700); err != nil {
		t.Fatal(err)
	}
	path := filepath.Join(dir, "zipax-claim-token")
	if err := os.WriteFile(path, []byte("short"), 0o600); err != nil {
		t.Fatal(err)
	}
	tok, err := loadOrCreateClaimToken(home)
	if err != nil {
		t.Fatal(err)
	}
	if !validClaimTokenShape(tok) {
		t.Fatalf("want valid replacement, got %q", tok)
	}
	if tok == "short" {
		t.Error("malformed token should have been replaced")
	}
}

func TestLoadClaimEmptyHome(t *testing.T) {
	claim, url, err := LoadClaim(Env{Home: "", Username: "a", Hostname: "h"}, "https://x")
	if err != nil {
		t.Fatal(err)
	}
	if claim != nil || url != "" {
		t.Errorf("empty home should produce no claim: got %v, %q", claim, url)
	}
}

func TestLoadClaimURLStripsUploadSuffix(t *testing.T) {
	home := t.TempDir()
	claim, url, err := LoadClaim(
		Env{Home: home, Username: "alice", Hostname: "laptop1"},
		"https://zinloop.com/api/zipax/usage",
	)
	if err != nil {
		t.Fatal(err)
	}
	if claim == nil {
		t.Fatal("want a claim block")
	}
	if claim.UserHash == "" {
		t.Error("want a user hash")
	}
	want := "https://zinloop.com/zipax/claim?token=" + claim.ClaimToken
	if url != want {
		t.Errorf("claim URL = %q, want %q", url, want)
	}
}

func TestValidClaimTokenShape(t *testing.T) {
	cases := map[string]bool{
		"short": false,
		"aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa":   true,  // 43 chars
		"aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa=": false, // '='
		"aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa+":  false, // '+'
		"-_abcdefghijklmnopqrstuvwxyz0123456789ABCDEFG": true,
	}
	for in, want := range cases {
		if got := validClaimTokenShape(in); got != want {
			t.Errorf("validClaimTokenShape(%q) = %v, want %v", in, got, want)
		}
	}
}
