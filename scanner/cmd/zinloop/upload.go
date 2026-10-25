package main

import (
	"bytes"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net"
	"net/http"
	"net/url"
	"os"
	"strings"
	"time"
)

// TokenEnv holds the console upload token. An environment variable (or a
// file) keeps the token out of the process list, unlike a command-line flag.
const TokenEnv = "ZINLOOP_TOKEN"

// legacyTokenEnv is the variable versions before the rename read. Still honored.
const legacyTokenEnv = "AGENTGUARD_TOKEN"

// uploadClient never follows redirects: a redirect could send the token and
// report to another host or over plain http.
var uploadClient = &http.Client{
	Timeout: 30 * time.Second,
	CheckRedirect: func(*http.Request, []*http.Request) error {
		return http.ErrUseLastResponse
	},
}

// uploadToken reads the token from --token-file or ZINLOOP_TOKEN.
func uploadToken(tokenFile string) (string, error) {
	if tokenFile != "" {
		b, err := os.ReadFile(tokenFile)
		if err != nil {
			return "", fmt.Errorf("cannot read the token file: %w", err)
		}
		return strings.TrimSpace(string(b)), nil
	}
	for _, name := range []string{TokenEnv, legacyTokenEnv} {
		if t := strings.TrimSpace(os.Getenv(name)); t != "" {
			return t, nil
		}
	}
	return "", fmt.Errorf("no upload token: set %s or pass --token-file", TokenEnv)
}

// checkUploadURL allows https anywhere and plain http only to this computer,
// so the token and report never cross a network unencrypted.
func checkUploadURL(raw string) (*url.URL, error) {
	u, err := url.Parse(raw)
	if err != nil || u.Host == "" {
		return nil, fmt.Errorf("%q isn't a valid URL", raw)
	}
	if u.User != nil {
		return nil, errors.New("the upload URL must not contain a user name or password")
	}
	switch u.Scheme {
	case "https":
		return u, nil
	case "http":
		h := u.Hostname()
		if ip := net.ParseIP(h); h == "localhost" || (ip != nil && ip.IsLoopback()) {
			return u, nil
		}
	}
	return nil, errors.New("the upload URL must use https")
}

// uploadAttempts is how many times upload tries before giving up. The first
// try is immediate; later tries wait a backoff. Overridable for tests.
var uploadAttempts = 4

// uploadBackoff is how long to wait before retry n (counted from 1).
// Overridable for tests.
var uploadBackoff = func(n int) time.Duration {
	switch n {
	case 1:
		return 2 * time.Second
	case 2:
		return 5 * time.Second
	default:
		return 15 * time.Second
	}
}

// upload sends the report to the console. The response body is read only for
// an error message and never echoed in full.
//
// Retries: network failures and 5xx responses are retried with backoff.
// Everything else (4xx, redirect, bad URL, missing token) is returned on the
// first try because retrying won't change the result. 429 is treated as
// retryable so a brief burst from --all-users on many laptops is tolerated.
func upload(rawURL, token string, rep any) error {
	u, err := checkUploadURL(rawURL)
	if err != nil {
		return err
	}
	// agu_ tokens were issued before the rename and are still valid.
	if !strings.HasPrefix(token, "zlu_") && !strings.HasPrefix(token, "agu_") {
		return errors.New("that doesn't look like an upload token (it should start with zlu_)")
	}
	body, err := json.Marshal(rep)
	if err != nil {
		return err
	}
	var lastErr error
	for attempt := 1; attempt <= uploadAttempts; attempt++ {
		retry, err := uploadOnce(u.String(), token, body)
		if err == nil {
			return nil
		}
		lastErr = err
		if !retry || attempt == uploadAttempts {
			return err
		}
		time.Sleep(uploadBackoff(attempt))
	}
	return lastErr
}

// uploadOnce sends one POST. retry is true for a transient failure (network,
// 5xx, 429) and false for anything else.
func uploadOnce(uStr, token string, body []byte) (retry bool, err error) {
	req, err := http.NewRequest(http.MethodPost, uStr, bytes.NewReader(body))
	if err != nil {
		return false, err
	}
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Authorization", "Bearer "+token)
	req.Header.Set("User-Agent", "zinloop/"+version)
	resp, err := uploadClient.Do(req)
	if err != nil {
		return true, fmt.Errorf("couldn't reach the console: %w", err)
	}
	defer resp.Body.Close()
	if resp.StatusCode == http.StatusCreated || resp.StatusCode == http.StatusOK {
		return false, nil
	}
	if resp.StatusCode >= 300 && resp.StatusCode < 400 {
		return false, fmt.Errorf("the console answered with a redirect (%d); use the final upload URL, starting with https", resp.StatusCode)
	}
	var msg struct {
		Error string `json:"error"`
	}
	_ = json.NewDecoder(io.LimitReader(resp.Body, 4096)).Decode(&msg)
	if msg.Error == "" {
		msg.Error = resp.Status
	}
	if len(msg.Error) > 300 {
		msg.Error = msg.Error[:300]
	}
	// 5xx and 429 are the console's fault or load; try again.
	transient := resp.StatusCode >= 500 || resp.StatusCode == http.StatusTooManyRequests
	return transient, fmt.Errorf("the console refused the scan (%d): %s", resp.StatusCode, msg.Error)
}
