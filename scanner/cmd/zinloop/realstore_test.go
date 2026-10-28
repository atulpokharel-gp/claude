package main

import (
	"bytes"
	"crypto/sha256"
	"encoding/hex"
	"os"
	"runtime"
	"testing"

	"github.com/atulpokharel-gp/zinloop-zipax/scanner/internal/discover"
	"github.com/atulpokharel-gp/zinloop-zipax/scanner/internal/vault"
)

// TestRealPasswordStore runs the key fix against the operating system's own
// password store (Windows Credential Manager, macOS Keychain). It only runs
// when ZINLOOP_REAL_STORE=1, which CI sets on Windows and macOS. It never
// prints key values; it compares them in memory or by hash.
func TestRealPasswordStore(t *testing.T) {
	if os.Getenv("ZINLOOP_REAL_STORE") != "1" {
		t.Skip("set ZINLOOP_REAL_STORE=1 to test the real password store")
	}
	home := fixtureHome(t)
	env := discover.Env{GOOS: goos, Home: home}

	// Plain-text values before the fix, by server and env name.
	before := map[string]string{}
	beforeServers, _ := discover.Scan(env)
	for _, s := range beforeServers {
		for k, v := range s.Env {
			before[s.ConfigPath+"|"+s.Scope+"|"+s.Name+"|"+k] = v
		}
	}

	t.Cleanup(func() {
		st, err := vault.LoadState(home)
		if err != nil {
			return
		}
		for ref := range st.Entries {
			_ = vault.Keyring{}.Delete(ref)
		}
	})

	var out, errOut bytes.Buffer
	if code := run([]string{"fix-secrets", "--home", home, "--apply", "--launcher", fakeLauncher(t, home)}, &out, &errOut); code != 0 {
		t.Fatalf("fix-secrets --apply exit %d:\n%s\n%s", code, out.String(), errOut.String())
	}

	after, _ := discover.Scan(env)
	checked := 0
	for _, s := range after {
		if len(s.Protected) == 0 {
			continue
		}
		cfg, _ := os.ReadFile(s.ConfigPath)
		got, err := secretEnv(s.Protected, vault.Keyring{}, nil)
		if err != nil {
			t.Fatalf("%s: reading from the real password store: %v", s.Name, err)
		}
		for i, p := range s.Protected {
			want := before[s.ConfigPath+"|"+s.Scope+"|"+s.Name+"|"+p.Env]
			if got[i] != p.Env+"="+want {
				t.Errorf("%s.%s: value from the password store doesn't match the original", s.Name, p.Env)
			}
			if want != "" && bytes.Contains(cfg, []byte(want)) {
				t.Errorf("%s.%s: plain-text value still in %s", s.Name, p.Env, s.ConfigPath)
			}
			checked++

			// On Windows the launcher starts the server as a child process.
			// Check the child really gets the key, using this test binary as
			// a stand-in server.
			if runtime.GOOS == "windows" {
				sum := sha256.Sum256([]byte(want))
				t.Setenv("ZINLOOP_HELPER", "1")
				t.Setenv("ZINLOOP_CHECK_VAR", p.Env)
				t.Setenv("ZINLOOP_EXPECT_SHA", hex.EncodeToString(sum[:]))
				exe, _ := os.Executable()
				var execErr bytes.Buffer
				code := runExec([]string{"--secret", p.Env + "=" + p.Ref, "--", exe, "-test.run=^TestHelperEnvCheck$"}, &execErr)
				if code != 0 {
					t.Errorf("%s.%s: exec launcher exit %d (3 means the server didn't get the right key): %s", s.Name, p.Env, code, execErr.String())
				}
			}
		}
	}
	if checked == 0 {
		t.Fatalf("no keys were moved; fix-secrets output:\n%s", out.String())
	}
	t.Logf("checked %d keys in the real password store", checked)
}

// TestHelperEnvCheck is the stand-in server for TestRealPasswordStore. It
// exits 0 when the expected variable holds the expected value, 3 otherwise.
func TestHelperEnvCheck(t *testing.T) {
	if os.Getenv("ZINLOOP_HELPER") != "1" {
		return
	}
	sum := sha256.Sum256([]byte(os.Getenv(os.Getenv("ZINLOOP_CHECK_VAR"))))
	if hex.EncodeToString(sum[:]) == os.Getenv("ZINLOOP_EXPECT_SHA") {
		os.Exit(0)
	}
	os.Exit(3)
}
