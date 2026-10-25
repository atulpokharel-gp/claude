//go:build windows

package main

import (
	"fmt"
	"io"
	"os"
	"os/exec"
)

// taskName is the Scheduled Task registered to run the long-running service
// as SYSTEM at boot. A scheduled task is used in place of a proper Windows
// service so the scanner stays dependency-free (no x/sys/windows/svc) while
// still auto-starting on reboot and restarting after transient failures.
const taskName = "Zinloop"

// oldTask is the oneshot daily-scan task PR #26's RMM installer created.
// Removed so the new always-on task doesn't double-scan with it.
const oldTask = "ZinloopDailyScan"

func installService(stdout, stderr io.Writer) error {
	// Delete the oneshot daily-scan task from PR #26 if present; its daily
	// cadence is replaced by the long-running service's internal loop.
	_ = exec.Command("schtasks", "/Delete", "/TN", oldTask, "/F").Run()

	// /SC ONSTART runs the task when the computer boots; /RU SYSTEM runs it
	// without a signed-in user, same as a service; /RL HIGHEST gives it
	// the privileges a scan of all user profiles needs; /F overwrites any
	// existing task.
	args := []string{
		"/Create", "/TN", taskName, "/F",
		"/SC", "ONSTART",
		"/RU", "SYSTEM",
		"/RL", "HIGHEST",
		"/TR", fmt.Sprintf(`"%s" service run`, installedBinary()),
	}
	return execCmd(stdout, stderr, "schtasks", args...)
}

func uninstallService(stdout, stderr io.Writer) error {
	return execCmd(stdout, stderr, "schtasks", "/Delete", "/TN", taskName, "/F")
}

func startService(stdout, stderr io.Writer) error {
	return execCmd(stdout, stderr, "schtasks", "/Run", "/TN", taskName)
}

func stopService(stdout, stderr io.Writer) error {
	return execCmd(stdout, stderr, "schtasks", "/End", "/TN", taskName)
}

func printServiceStatus(stdout, stderr io.Writer) error {
	cmd := exec.Command("schtasks", "/Query", "/TN", taskName, "/V", "/FO", "LIST")
	cmd.Stdout = stdout
	cmd.Stderr = stderr
	_ = cmd.Run()
	return nil
}

func printServiceLogs(lines int, follow bool, stdout, stderr io.Writer) error {
	path := logPath()
	f, err := os.Open(path)
	if err != nil {
		return fmt.Errorf("no log file at %s yet", path)
	}
	defer f.Close()
	if _, err := io.Copy(stdout, f); err != nil {
		return err
	}
	// Windows has no built-in tail -F, so --follow is advisory for now and
	// the install docs point reviewers at the Event Viewer for streaming.
	return nil
}

func execCmd(stdout, stderr io.Writer, name string, args ...string) error {
	cmd := exec.Command(name, args...)
	cmd.Stdout = stdout
	cmd.Stderr = stderr
	return cmd.Run()
}
