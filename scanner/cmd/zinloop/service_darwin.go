//go:build darwin

package main

import (
	"fmt"
	"io"
	"os"
	"os/exec"
)

// plistPath is the launchd daemon the long-running service runs under.
// Per Apple convention, system-wide daemons live in /Library/LaunchDaemons/.
const plistPath = "/Library/LaunchDaemons/com.zinloop.service.plist"

// oldPlist is the oneshot daily-scan daemon PR #26's RMM install created.
// The new service supersedes it, so install removes it to avoid double scans.
const oldPlist = "/Library/LaunchDaemons/com.zinloop.scan.plist"

func installService(stdout, stderr io.Writer) error {
	plist := fmt.Sprintf(`<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
  <key>Label</key><string>com.zinloop.service</string>
  <key>ProgramArguments</key><array>
    <string>%s</string><string>service</string><string>run</string>
  </array>
  <key>RunAtLoad</key><true/>
  <key>KeepAlive</key><true/>
  <key>LowPriorityIO</key><true/>
  <key>StandardOutPath</key><string>%s</string>
  <key>StandardErrorPath</key><string>%s</string>
</dict></plist>
`, installedBinary(), logPath(), logPath())
	if err := os.WriteFile(plistPath, []byte(plist), 0o644); err != nil {
		return err
	}
	// Older install's oneshot daemon is unloaded and removed so it stops
	// firing alongside the new long-running one.
	if _, err := os.Stat(oldPlist); err == nil {
		_ = exec.Command("launchctl", "unload", oldPlist).Run()
		_ = os.Remove(oldPlist)
	}
	// chown root:wheel for the LaunchDaemon's expected ownership. Failures
	// here are not fatal because the install may already be running as root.
	_ = exec.Command("chown", "root:wheel", plistPath).Run()
	return nil
}

func uninstallService(stdout, stderr io.Writer) error {
	_ = execCmd(stdout, stderr, "launchctl", "unload", plistPath)
	if err := os.Remove(plistPath); err != nil && !os.IsNotExist(err) {
		return err
	}
	return nil
}

func startService(stdout, stderr io.Writer) error {
	return execCmd(stdout, stderr, "launchctl", "load", "-w", plistPath)
}

func stopService(stdout, stderr io.Writer) error {
	return execCmd(stdout, stderr, "launchctl", "unload", plistPath)
}

func printServiceStatus(stdout, stderr io.Writer) error {
	// launchctl print exposes a richer view than `list` does on modern macOS.
	cmd := exec.Command("launchctl", "print", "system/com.zinloop.service")
	cmd.Stdout = stdout
	cmd.Stderr = stderr
	_ = cmd.Run()
	return nil
}

func printServiceLogs(lines int, follow bool, stdout, stderr io.Writer) error {
	path := logPath()
	if _, err := os.Stat(path); err != nil {
		return fmt.Errorf("no log file at %s yet", path)
	}
	args := []string{"-n", fmt.Sprintf("%d", lines)}
	if follow {
		args = append(args, "-F")
	}
	args = append(args, path)
	cmd := exec.Command("tail", args...)
	cmd.Stdout = stdout
	cmd.Stderr = stderr
	return cmd.Run()
}

func execCmd(stdout, stderr io.Writer, name string, args ...string) error {
	cmd := exec.Command(name, args...)
	cmd.Stdout = stdout
	cmd.Stderr = stderr
	return cmd.Run()
}
