//go:build !windows

package main

import (
	"fmt"
	"io"
	"syscall"
)

// startProgram replaces this process with the server, so the AI app talks to
// it directly over the same stdin and stdout.
func startProgram(path string, argv, env []string, stderr io.Writer) int {
	err := syscall.Exec(path, argv, env)
	fmt.Fprintf(stderr, "zinloop: couldn't start %s: %v\n", path, err)
	return 126
}
