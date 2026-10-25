//go:build linux

package main

import (
	"fmt"
	"io"
	"os"
	"os/exec"
	"path/filepath"
)

// unitPath is the systemd unit file for the long-running service.
const unitPath = "/etc/systemd/system/zinloop.service"

// oldTimer and oldService are the oneshot daily-scan units PR #26's RMM
// script installed. The new long-running service supersedes them, so install
// removes them to avoid double scans.
const (
	oldTimer   = "/etc/systemd/system/zinloop-scan.timer"
	oldService = "/etc/systemd/system/zinloop-scan.service"
	oldCron    = "/etc/cron.d/zinloop"
)

func installService(stdout, stderr io.Writer) error {
	unit := fmt.Sprintf(`[Unit]
Description=Zinloop scanner service
Documentation=https://zinloop.com
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
ExecStart=%s service run
Restart=on-failure
RestartSec=30
User=root
Nice=10
IOSchedulingClass=idle
StandardOutput=journal
StandardError=journal

[Install]
WantedBy=multi-user.target
`, installedBinary())
	if err := os.WriteFile(unitPath, []byte(unit), 0o644); err != nil {
		return err
	}

	// Remove the old oneshot timer/cron so the new long-running service
	// doesn't double-scan with the RMM install's leftover schedule.
	for _, p := range []string{oldTimer, oldService, oldCron} {
		_ = os.Remove(p)
	}
	// Also disable the old timer if systemd still has it loaded.
	_ = exec.Command("systemctl", "disable", "--now", filepath.Base(oldTimer)).Run()

	if err := execCmd(stdout, stderr, "systemctl", "daemon-reload"); err != nil {
		return err
	}
	if err := execCmd(stdout, stderr, "systemctl", "enable", serviceLabel+".service"); err != nil {
		return err
	}
	return nil
}

func uninstallService(stdout, stderr io.Writer) error {
	_ = execCmd(stdout, stderr, "systemctl", "disable", "--now", serviceLabel+".service")
	if err := os.Remove(unitPath); err != nil && !os.IsNotExist(err) {
		return err
	}
	_ = execCmd(stdout, stderr, "systemctl", "daemon-reload")
	// Leave the binary at installedBinary(): it's harmless and lets a later
	// `zinloop install` be a one-liner. --purge takes care of the config.
	return nil
}

func startService(stdout, stderr io.Writer) error {
	return execCmd(stdout, stderr, "systemctl", "start", serviceLabel+".service")
}

func stopService(stdout, stderr io.Writer) error {
	return execCmd(stdout, stderr, "systemctl", "stop", serviceLabel+".service")
}

func printServiceStatus(stdout, stderr io.Writer) error {
	cmd := exec.Command("systemctl", "status", serviceLabel+".service", "--no-pager")
	cmd.Stdout = stdout
	cmd.Stderr = stderr
	// systemctl status returns non-zero when the service is inactive; that's
	// legitimate output, not an error we should surface to the caller.
	_ = cmd.Run()
	return nil
}

func printServiceLogs(lines int, follow bool, stdout, stderr io.Writer) error {
	args := []string{"-u", serviceLabel + ".service", "-n", fmt.Sprintf("%d", lines), "--no-pager"}
	if follow {
		args = append(args, "-f")
	}
	cmd := exec.Command("journalctl", args...)
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
