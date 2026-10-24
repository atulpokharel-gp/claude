package main

import (
	"bytes"
	"encoding/json"
	"io"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func TestCheckUploadURL(t *testing.T) {
	ok := []string{"https://console.example.com/api/scans", "http://localhost:3000/api/scans", "http://127.0.0.1:3000/api/scans", "http://[::1]:3000/x"}
	bad := []string{"http://console.example.com/api/scans", "ftp://x/y", "not a url", "https://user:pw@console.example.com/api/scans", "/api/scans"}
	for _, u := range ok {
		if _, err := checkUploadURL(u); err != nil {
			t.Errorf("%s: unexpected error %v", u, err)
		}
	}
	for _, u := range bad {
		if _, err := checkUploadURL(u); err == nil {
			t.Errorf("%s: should be refused", u)
		}
	}
}

func TestScanUploadsReport(t *testing.T) {
	const token = "agu_test-token-value"
	var gotAuth string
	var got map[string]any
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		gotAuth = r.Header.Get("Authorization")
		b, _ := io.ReadAll(r.Body)
		_ = json.Unmarshal(b, &got)
		w.WriteHeader(http.StatusCreated)
		_, _ = w.Write([]byte(`{"ok":true}`))
	}))
	defer srv.Close()
	t.Setenv(TokenEnv, token)

	home, _ := filepath.Abs("../../testdata/home")
	var out, errOut bytes.Buffer
	if code := run([]string{"--home", home, "--upload", srv.URL + "/api/scans"}, &out, &errOut); code != 0 {
		t.Fatalf("exit %d: %s", code, errOut.String())
	}
	if gotAuth != "Bearer "+token {
		t.Errorf("Authorization = %q", gotAuth)
	}
	if got["schemaVersion"] != float64(1) || got["servers"] == nil {
		t.Errorf("console didn't get a report: %v", got)
	}
	if strings.Contains(out.String()+errOut.String(), token) {
		t.Error("the token was printed")
	}
	if !strings.Contains(errOut.String(), "Scan sent") {
		t.Errorf("stderr: %s", errOut.String())
	}
}

func TestScanUploadErrors(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusUnauthorized)
		_, _ = w.Write([]byte(`{"error":"Upload token not recognized or revoked."}`))
	}))
	defer srv.Close()
	home, _ := filepath.Abs("../../testdata/home")

	var out, errOut bytes.Buffer
	t.Setenv(TokenEnv, "")
	if code := run([]string{"--home", home, "--upload", srv.URL}, &out, &errOut); code != 1 || !strings.Contains(errOut.String(), TokenEnv) {
		t.Errorf("missing token: exit %d, %s", code, errOut.String())
	}

	tokenFile := filepath.Join(t.TempDir(), "token")
	_ = os.WriteFile(tokenFile, []byte("agu_revoked\n"), 0o600)
	errOut.Reset()
	if code := run([]string{"--home", home, "--upload", srv.URL, "--token-file", tokenFile}, &out, &errOut); code != 3 || !strings.Contains(errOut.String(), "revoked") {
		t.Errorf("refused upload: exit %d, %s", code, errOut.String())
	}

	errOut.Reset()
	if code := run([]string{"--home", home, "--upload", "http://console.example.com/api/scans", "--token-file", tokenFile}, &out, &errOut); code != 1 || !strings.Contains(errOut.String(), "https") {
		t.Errorf("plain http: exit %d, %s", code, errOut.String())
	}
}

func TestUploadRefusesRedirects(t *testing.T) {
	plain := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Header.Get("Authorization") != "" {
			t.Error("the token followed the redirect")
		}
		w.WriteHeader(http.StatusCreated)
	}))
	defer plain.Close()
	redirector := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		http.Redirect(w, r, plain.URL, http.StatusTemporaryRedirect)
	}))
	defer redirector.Close()
	err := upload(redirector.URL, "agu_x", map[string]int{"schemaVersion": 1})
	if err == nil || !strings.Contains(err.Error(), "redirect") {
		t.Errorf("want a redirect error, got %v", err)
	}
}
