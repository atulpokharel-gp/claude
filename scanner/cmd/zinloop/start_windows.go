//go:build windows

package main

import (
	"errors"
	"fmt"
	"io"
	"os"
	"os/exec"
)

// startProgram runs the server as a child with the same stdin, stdout and
// stderr (Windows has no exec that replaces the process) and passes its exit code on.
func startProgram(path string, argv, env []string, stderr io.Writer) int {
	cmd := exec.Command(path, argv[1:]...)
	cmd.Env = env
	cmd.Stdin, cmd.Stdout, cmd.Stderr = os.Stdin, os.Stdout, os.Stderr
	err := cmd.Run()
	var exit *exec.ExitError
	if errors.As(err, &exit) {
		return exit.ExitCode()
	}
	if err != nil {
		fmt.Fprintf(stderr, "zinloop: couldn't start %s: %v\n", path, err)
		return 126
	}
	return 0
}
