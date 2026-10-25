package main

import (
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"runtime"
	"strings"
	"time"
)

// serviceConfig is the on-disk config the long-running service reads on each
// scan. The token is kept in a separate file so this one can be world-readable
// without leaking the upload secret.
type serviceConfig struct {
	URL           string `json:"url"`
	TokenFile     string `json:"tokenFile"`
	IntervalHours int    `json:"intervalHours"`
	JitterSeconds int    `json:"jitterSeconds"`
	AllUsers      bool   `json:"allUsers"`
}

// defaultInterval is 24h with a 2h jitter window, matching the daily-scan
// behaviour PR #26 shipped for RMM installs so a fleet doesn't synchronise.
const (
	defaultIntervalHours = 24
	defaultJitterSeconds = 7200
)

// configDir returns the OS-conventional directory for the service's config
// and token. Tests set ZINLOOP_CONFIG_DIR to redirect it to a tmp dir.
func configDir() string {
	if d := os.Getenv("ZINLOOP_CONFIG_DIR"); d != "" {
		return d
	}
	switch runtime.GOOS {
	case "windows":
		if d := os.Getenv("ProgramData"); d != "" {
			return filepath.Join(d, "Zinloop")
		}
		return `C:\ProgramData\Zinloop`
	default:
		return "/etc/zinloop"
	}
}

// installDir returns the OS-conventional directory the service's binary is
// copied into so the service's unit file can reference an absolute path.
func installDir() string {
	switch runtime.GOOS {
	case "windows":
		if d := os.Getenv("ProgramFiles"); d != "" {
			return filepath.Join(d, "Zinloop")
		}
		return `C:\Program Files\Zinloop`
	default:
		return "/usr/local/bin"
	}
}

// installedBinary is where the installer copies the running binary to so the
// service unit can reference a stable path independent of how the user
// invoked `zinloop install`.
func installedBinary() string {
	name := "zinloop"
	if runtime.GOOS == "windows" {
		name = "zinloop.exe"
	}
	return filepath.Join(installDir(), name)
}

func configPath() string  { return filepath.Join(configDir(), "config.json") }
func tokenPath() string   { return filepath.Join(configDir(), "token") }
func logPath() string     { return filepath.Join(configDir(), "zinloop.log") }
func statePath() string   { return filepath.Join(configDir(), "state.json") }

// serviceState records when the service last scanned, so `zinloop status` can
// show it without pulling the whole upload log.
type serviceState struct {
	LastScanAt    time.Time `json:"lastScanAt"`
	LastUploadAt  time.Time `json:"lastUploadAt"`
	LastError     string    `json:"lastError,omitempty"`
	ScansOK       int       `json:"scansOK"`
	ScansFailed   int       `json:"scansFailed"`
}

func readConfig() (serviceConfig, error) {
	var c serviceConfig
	b, err := os.ReadFile(configPath())
	if err != nil {
		return c, err
	}
	if err := json.Unmarshal(b, &c); err != nil {
		return c, fmt.Errorf("config at %s is not valid JSON: %w", configPath(), err)
	}
	if c.URL == "" {
		return c, errors.New("config is missing the console URL")
	}
	if c.TokenFile == "" {
		c.TokenFile = tokenPath()
	}
	if c.IntervalHours <= 0 {
		c.IntervalHours = defaultIntervalHours
	}
	if c.JitterSeconds < 0 {
		c.JitterSeconds = 0
	}
	return c, nil
}

func writeConfig(c serviceConfig) error {
	if err := os.MkdirAll(configDir(), 0o755); err != nil {
		return err
	}
	b, err := json.MarshalIndent(c, "", "  ")
	if err != nil {
		return err
	}
	// Config is non-secret but we still write it root-owned 0644.
	return os.WriteFile(configPath(), append(b, '\n'), 0o644)
}

// writeToken stores the upload token with 0600 so only root (or Administrator)
// on Windows can read it.
func writeToken(token string) error {
	if err := os.MkdirAll(configDir(), 0o755); err != nil {
		return err
	}
	tmp := tokenPath() + ".new"
	if err := os.WriteFile(tmp, []byte(strings.TrimSpace(token)), 0o600); err != nil {
		return err
	}
	return os.Rename(tmp, tokenPath())
}

func readState() serviceState {
	var s serviceState
	b, err := os.ReadFile(statePath())
	if err != nil {
		return s
	}
	_ = json.Unmarshal(b, &s)
	return s
}

func writeState(s serviceState) error {
	if err := os.MkdirAll(configDir(), 0o755); err != nil {
		return err
	}
	b, err := json.MarshalIndent(s, "", "  ")
	if err != nil {
		return err
	}
	return os.WriteFile(statePath(), append(b, '\n'), 0o644)
}
