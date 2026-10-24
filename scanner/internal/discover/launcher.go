package discover

import "strings"

// The fix command protects a server by rewriting its config to start through
// agentscan's launcher:
//
//	agentscan exec --secret GITHUB_TOKEN=<ref> [--secret ...] -- npx -y @scope/server
//
// The launcher reads each ref from the computer's secure password store and
// passes it to the real server as an environment variable.

// LauncherSubcommand is the agentscan subcommand that starts a protected server.
const LauncherSubcommand = "exec"

// ProtectedSecret is one environment variable the launcher fills from the
// secure store at start-up.
type ProtectedSecret struct {
	Env string `json:"env"`
	Ref string `json:"ref"`
}

// LauncherArgs builds the args for a protected server's config entry.
func LauncherArgs(secrets []ProtectedSecret, command string, args []string) []string {
	out := []string{LauncherSubcommand}
	for _, s := range secrets {
		out = append(out, "--secret", s.Env+"="+s.Ref)
	}
	out = append(out, "--", command)
	return append(out, args...)
}

// ParseLauncher reports whether command/args start a server through the
// launcher, and if so returns the protected secrets and the real command.
// IsLauncherName reports whether a command path names agentscan, so that a
// config rewritten to start it is recognized on the next scan.
func IsLauncherName(command string) bool {
	base := strings.ToLower(command)
	if i := strings.LastIndexAny(base, `/\`); i >= 0 {
		base = base[i+1:]
	}
	return strings.TrimSuffix(base, ".exe") == "agentscan"
}

func ParseLauncher(command string, args []string) (secrets []ProtectedSecret, inner string, innerArgs []string, ok bool) {
	if !IsLauncherName(command) || len(args) == 0 || args[0] != LauncherSubcommand {
		return nil, "", nil, false
	}
	rest := args[1:]
	for len(rest) > 0 {
		switch {
		case rest[0] == "--":
			if len(rest) < 2 {
				return nil, "", nil, false
			}
			return secrets, rest[1], rest[2:], true
		case rest[0] == "--secret" && len(rest) > 1:
			env, ref, found := strings.Cut(rest[1], "=")
			if !found || env == "" || ref == "" {
				return nil, "", nil, false
			}
			secrets = append(secrets, ProtectedSecret{Env: env, Ref: ref})
			rest = rest[2:]
		default:
			return nil, "", nil, false
		}
	}
	return nil, "", nil, false
}
