package main

import (
	"bytes"
	"io"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"sync/atomic"
	"testing"
	"time"
)

// withConfigDir re-points configDir() to a per-test tmp directory and
// restores afterwards, so tests never touch /etc/zinloop or ProgramData.
func withConfigDir(t *testing.T) string {
	t.Helper()
	dir := t.TempDir()
	t.Setenv("ZINLOOP_CONFIG_DIR", dir)
	return dir
}

func TestRunInstall_RejectsBadToken(t *testing.T) {
	withConfigDir(t)
	var out, errb bytes.Buffer
	code := runInstall([]string{"--url", "https://example.com", "--token", "nope"}, &out, &errb)
	if code != 2 {
		t.Fatalf("code = %d, want 2; stderr: %s", code, errb.String())
	}
	if !strings.Contains(errb.String(), "upload token") {
		t.Fatalf("stderr = %q, want message about upload token", errb.String())
	}
}

func TestRunInstall_RejectsHTTPUrl(t *testing.T) {
	withConfigDir(t)
	var out, errb bytes.Buffer
	// Plain http to a non-loopback host is refused, same as `--upload`.
	code := runInstall([]string{"--url", "http://evil.example", "--token", "zlu_" + strings.Repeat("a", 32)}, &out, &errb)
	if code != 2 {
		t.Fatalf("code = %d, want 2; stderr: %s", code, errb.String())
	}
}

func TestWriteReadConfig_RoundTrip(t *testing.T) {
	withConfigDir(t)
	cfg := serviceConfig{URL: "https://zinloop.com", TokenFile: tokenPath(), IntervalHours: 6, JitterSeconds: 300}
	if err := writeConfig(cfg); err != nil {
		t.Fatal(err)
	}
	got, err := readConfig()
	if err != nil {
		t.Fatal(err)
	}
	if got.URL != cfg.URL || got.IntervalHours != 6 || got.JitterSeconds != 300 {
		t.Fatalf("got %+v, want %+v", got, cfg)
	}
}

func TestReadConfig_DefaultsIntervalAndTokenFile(t *testing.T) {
	withConfigDir(t)
	// A caller-written config might omit IntervalHours/TokenFile; defaults
	// kick in on read so the daemon never divides by zero or scans forever.
	if err := os.WriteFile(configPath(), []byte(`{"url":"https://zinloop.com"}`), 0o644); err != nil {
		t.Fatal(err)
	}
	got, err := readConfig()
	if err != nil {
		t.Fatal(err)
	}
	if got.IntervalHours != defaultIntervalHours {
		t.Errorf("IntervalHours = %d, want %d", got.IntervalHours, defaultIntervalHours)
	}
	if got.TokenFile != tokenPath() {
		t.Errorf("TokenFile = %q, want %q", got.TokenFile, tokenPath())
	}
}

func TestWriteToken_IsPrivate(t *testing.T) {
	withConfigDir(t)
	if err := writeToken("  zlu_abc  "); err != nil {
		t.Fatal(err)
	}
	b, err := os.ReadFile(tokenPath())
	if err != nil {
		t.Fatal(err)
	}
	if string(b) != "zlu_abc" {
		t.Errorf("token = %q, want trimmed %q", string(b), "zlu_abc")
	}
	st, err := os.Stat(tokenPath())
	if err != nil {
		t.Fatal(err)
	}
	// On Windows file mode bits don't map 1:1 to Unix perms; only check Unix.
	if st.Mode().Perm()&0o077 != 0 && !isWindows() {
		t.Errorf("token file is group/world-readable: %v", st.Mode())
	}
}

func TestRunScanOnce_RecordsSuccess(t *testing.T) {
	withConfigDir(t)
	var hits int32
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		atomic.AddInt32(&hits, 1)
		if !strings.HasPrefix(r.Header.Get("Authorization"), "Bearer zlu_") {
			t.Errorf("bad auth header: %q", r.Header.Get("Authorization"))
		}
		w.WriteHeader(201)
		_, _ = io.WriteString(w, `{"ok":true,"deviceId":"dev_test"}`)
	}))
	defer srv.Close()

	if err := writeToken("zlu_" + strings.Repeat("x", 40)); err != nil {
		t.Fatal(err)
	}
	cfg := serviceConfig{URL: srv.URL, TokenFile: tokenPath(), AllUsers: false}

	var out, errb bytes.Buffer
	runScanOnce(cfg, &out, &errb)

	if hits != 1 {
		t.Fatalf("mock server got %d requests, want 1 (stderr: %s)", hits, errb.String())
	}
	st := readState()
	if st.ScansOK != 1 || st.ScansFailed != 0 {
		t.Errorf("state = %+v, want 1 ok / 0 failed", st)
	}
	if st.LastError != "" {
		t.Errorf("LastError = %q, want empty", st.LastError)
	}
	if time.Since(st.LastScanAt) > time.Minute {
		t.Errorf("LastScanAt = %v, want ~now", st.LastScanAt)
	}
}

func TestRunScanOnce_RecordsFailure(t *testing.T) {
	withConfigDir(t)
	// An HTTP server that always 500s makes upload() exhaust retries and
	// return an error; we check the daemon's state file reflects that.
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(500)
		_, _ = io.WriteString(w, `{"error":"boom"}`)
	}))
	defer srv.Close()

	// Collapse upload retry delays so this test stays fast; otherwise upload
	// sleeps 2+5+15s before the final failure propagates.
	saved := uploadBackoff
	uploadBackoff = func(int) time.Duration { return 0 }
	savedAttempts := uploadAttempts
	uploadAttempts = 2
	t.Cleanup(func() { uploadBackoff = saved; uploadAttempts = savedAttempts })

	if err := writeToken("zlu_" + strings.Repeat("y", 40)); err != nil {
		t.Fatal(err)
	}
	cfg := serviceConfig{URL: srv.URL, TokenFile: tokenPath(), AllUsers: false}

	var out, errb bytes.Buffer
	runScanOnce(cfg, &out, &errb)

	st := readState()
	if st.ScansOK != 0 || st.ScansFailed != 1 {
		t.Fatalf("state = %+v, want 0 ok / 1 failed", st)
	}
	if !strings.Contains(st.LastError, "console refused") {
		t.Errorf("LastError = %q, want message about console refusing", st.LastError)
	}
}

func TestCopySelf_WritesExecutable(t *testing.T) {
	dir := t.TempDir()
	dst := filepath.Join(dir, "zinloop-copy")
	if err := copySelf(dst); err != nil {
		t.Fatal(err)
	}
	st, err := os.Stat(dst)
	if err != nil {
		t.Fatal(err)
	}
	if st.Mode()&0o111 == 0 && !isWindows() {
		t.Errorf("copy is not executable: %v", st.Mode())
	}
}

func TestStateFile_RoundTrip(t *testing.T) {
	withConfigDir(t)
	in := serviceState{ScansOK: 7, ScansFailed: 1, LastError: "x", LastScanAt: time.Now().UTC().Truncate(time.Second)}
	if err := writeState(in); err != nil {
		t.Fatal(err)
	}
	out := readState()
	if out.ScansOK != 7 || out.ScansFailed != 1 || out.LastError != "x" {
		t.Fatalf("roundtrip = %+v, want %+v", out, in)
	}
}

func TestRunStatus_NotInstalled(t *testing.T) {
	withConfigDir(t)
	var out, errb bytes.Buffer
	code := runStatus(nil, &out, &errb)
	if code != 1 {
		t.Fatalf("code = %d, want 1", code)
	}
	if !strings.Contains(out.String(), "isn't installed") {
		t.Errorf("out = %q, want 'isn't installed' message", out.String())
	}
}

func isWindows() bool { return filepath.Separator == '\\' }
