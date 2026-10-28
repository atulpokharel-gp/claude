package main

import (
	"errors"
	"fmt"
	"io"
	"os"
	"os/exec"
	"strings"

	"github.com/atulpokharel-gp/zinloop-zipax/scanner/internal/discover"
	"github.com/atulpokharel-gp/zinloop-zipax/scanner/internal/vault"
)

// runExec is the launcher an AI app calls instead of the MCP server itself:
//
//	zinloop exec --secret KEY=ref [...] -- command args...
//
// It reads each key from the password store, adds it to the environment and
// starts the real server. Stdout belongs to the MCP protocol, so this writes
// only to stderr and never prints a key.
func runExec(args []string, stderr io.Writer) int {
	secrets, command, cmdArgs, ok := discover.ParseLauncher("zinloop", append([]string{discover.LauncherSubcommand}, args...))
	if !ok {
		fmt.Fprintln(stderr, "usage: zinloop exec --secret NAME=ref [--secret ...] -- command [args...]")
		return 1
	}
	env, err := secretEnv(secrets, newStore(), os.Environ())
	if err != nil {
		fmt.Fprintln(stderr, "zinloop:", err)
		return 1
	}
	path, err := exec.LookPath(command)
	if err != nil {
		fmt.Fprintf(stderr, "zinloop: can't find %q: %v\n", command, err)
		return 127
	}
	return startProgram(path, append([]string{command}, cmdArgs...), env, stderr)
}

// secretEnv returns base plus each secret, replacing any variable of the same name.
func secretEnv(secrets []discover.ProtectedSecret, store vault.Store, base []string) ([]string, error) {
	values := map[string]string{}
	for _, s := range secrets {
		v, err := store.Get(s.Ref)
		if errors.Is(err, vault.ErrNotFound) {
			return nil, fmt.Errorf("key %q is missing from the password store; run zinloop rotate %s to add it", s.Ref, s.Ref)
		}
		if err != nil {
			return nil, fmt.Errorf("couldn't read %q from the password store: %w", s.Ref, err)
		}
		values[s.Env] = v
	}
	env := make([]string, 0, len(base)+len(values))
	for _, kv := range base {
		name, _, _ := strings.Cut(kv, "=")
		if _, replaced := values[name]; !replaced {
			env = append(env, kv)
		}
	}
	for _, s := range secrets {
		env = append(env, s.Env+"="+values[s.Env])
	}
	return env, nil
}
