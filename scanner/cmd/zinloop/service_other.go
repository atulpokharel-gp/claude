//go:build !linux && !darwin && !windows

package main

import (
	"errors"
	"io"
)

// Stubs so the package still builds on OSes without a service backend (eg.
// FreeBSD in CI); `install` on such a host prints a clear error instead of a
// link-time failure.
var errUnsupported = errors.New("zinloop service install is only supported on Linux, macOS, and Windows")

func installService(_, _ io.Writer) error   { return errUnsupported }
func uninstallService(_, _ io.Writer) error { return errUnsupported }
func startService(_, _ io.Writer) error     { return errUnsupported }
func stopService(_, _ io.Writer) error      { return errUnsupported }

func printServiceStatus(_, _ io.Writer) error                { return errUnsupported }
func printServiceLogs(int, bool, io.Writer, io.Writer) error { return errUnsupported }
