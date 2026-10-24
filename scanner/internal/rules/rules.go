// Package rules checks MCP servers for risky settings.
package rules

import (
	"net"
	"net/url"
	"regexp"
	"sort"
	"strconv"
	"strings"

	"github.com/atulpokharel-gp/claude/scanner/internal/discover"
)

// Severity ranks how urgent a finding is.
type Severity string

const (
	High   Severity = "high"
	Medium Severity = "medium"
	Low    Severity = "low"
	None   Severity = "none"
)

// Rank orders severities so the worst can be picked.
func (s Severity) Rank() int {
	switch s {
	case High:
		return 3
	case Medium:
		return 2
	case Low:
		return 1
	}
	return 0
}

// Finding is one problem with one server.
type Finding struct {
	RuleID   string   `json:"ruleId"`
	Severity Severity `json:"severity"`
	Title    string   `json:"title"`
	Detail   string   `json:"detail"`
	Fix      string   `json:"fix"`
}

// Context carries facts about the computer that some rules need.
type Context struct {
	Home string
}

var (
	secretKeyName = regexp.MustCompile(`(?i)(token|secret|passw|api[_-]?key|access[_-]?key|private[_-]?key|credential|\bpat\b|_pat$)`)
	// Value shapes of common credentials. Kept narrow to avoid false alarms.
	secretValue = regexp.MustCompile(`(ghp_[A-Za-z0-9]{20,}|github_pat_[A-Za-z0-9_]{20,}|gho_[A-Za-z0-9]{20,}|sk-[A-Za-z0-9_\-]{20,}|sk-ant-[A-Za-z0-9_\-]{20,}|xox[abprs]-[A-Za-z0-9\-]{10,}|AKIA[0-9A-Z]{16}|AIza[0-9A-Za-z_\-]{30,}|glpat-[A-Za-z0-9_\-]{20,}|(?i:bearer)\s+[A-Za-z0-9._\-]{16,})`)
	// References to variables or secret stores rather than literal values.
	reference   = regexp.MustCompile(`^\$\{[^}]+\}$|^\$[A-Za-z_][A-Za-z0-9_]*$|^\$\{(env|input):[^}]+\}$|^op://|^keychain:`)
	pkgVersion  = regexp.MustCompile(`^(@[^/]+/)?[^@]+@(.+)$`)
	shellServer = regexp.MustCompile(`(?i)(desktop-commander|mcp-shell|shell-server|server-shell|mcp-server-commands|terminal-mcp|mcp-terminal|run-command|code-runner)`)
	fsServer    = regexp.MustCompile(`(?i)filesystem`)
)

// Check runs every rule against one server.
func Check(s discover.Server, ctx Context) []Finding {
	var out []Finding
	out = append(out, secretsInConfig(s)...)
	out = append(out, insecureTransport(s)...)
	out = append(out, unpinnedPackage(s)...)
	out = append(out, broadFilesystem(s, ctx)...)
	out = append(out, shellAccess(s)...)
	out = append(out, riskyContainer(s)...)
	out = append(out, remoteServer(s)...)
	return out
}

// Worst returns the highest severity in a list, or None.
func Worst(fs []Finding) Severity {
	worst := None
	for _, f := range fs {
		if f.Severity.Rank() > worst.Rank() {
			worst = f.Severity
		}
	}
	return worst
}

// RedactTokens replaces every token-shaped substring (GitHub, OpenAI,
// Anthropic, Slack, AWS, Google, GitLab keys and bearer tokens) with repl.
func RedactTokens(v, repl string) string {
	return secretValue.ReplaceAllString(v, repl)
}

// SecretArgs returns the positions of command-line arguments that hold a
// credential: token-shaped values, the value given to a credential flag
// (--password x, --api-key=x), or a URL carrying a password or secret
// query parameter. The report uses it to redact arguments.
func SecretArgs(args []string) []int {
	var idx []int
	for i := 0; i < len(args); i++ {
		a := args[i]
		switch {
		case secretValue.MatchString(a), URLHasCredential(a):
			idx = append(idx, i)
		case strings.HasPrefix(a, "-") && strings.Contains(a, "="):
			name, val, _ := strings.Cut(strings.TrimLeft(a, "-"), "=")
			if secretKeyName.MatchString(name) && isLiteral(val) {
				idx = append(idx, i)
			}
		case strings.HasPrefix(a, "-") && secretKeyName.MatchString(strings.TrimLeft(a, "-")):
			if i+1 < len(args) && !strings.HasPrefix(args[i+1], "-") && isLiteral(args[i+1]) {
				idx = append(idx, i+1)
				i++
			}
		}
	}
	return idx
}

// URLHasCredential reports whether v is a URL with a password in it
// (postgres://user:pw@host) or a secret-named query parameter (?api_key=...).
func URLHasCredential(v string) bool {
	if !strings.Contains(v, "://") {
		return false
	}
	u, err := url.Parse(v)
	if err != nil || u.Host == "" {
		return false
	}
	// A known token shape anywhere in the URL (path, query, user) counts.
	if RedactTokens(v, "") != v {
		return true
	}
	if u.User != nil {
		if pw, ok := u.User.Password(); ok && isLiteral(pw) {
			return true
		}
	}
	for k, vals := range u.Query() {
		for _, val := range vals {
			if secretKeyName.MatchString(k) && isLiteral(val) {
				return true
			}
		}
	}
	return false
}

func isLiteral(v string) bool {
	v = strings.TrimSpace(v)
	return v != "" && !reference.MatchString(v)
}

func secretsInConfig(s discover.Server) []Finding {
	var names []string
	for k, v := range s.Env {
		if !isLiteral(v) {
			continue
		}
		if secretKeyName.MatchString(k) || secretValue.MatchString(v) || URLHasCredential(v) {
			names = append(names, "env "+k)
		}
	}
	for k, v := range s.Headers {
		if !isLiteral(v) {
			continue
		}
		if strings.EqualFold(k, "authorization") || secretKeyName.MatchString(k) || secretValue.MatchString(v) {
			names = append(names, "header "+k)
		}
	}
	for _, i := range SecretArgs(s.Args) {
		names = append(names, "argument "+strconv.Itoa(i+1))
	}
	if URLHasCredential(s.URL) {
		names = append(names, "server URL")
	}
	if len(names) == 0 {
		return nil
	}
	sort.Strings(names)
	return []Finding{{
		RuleID:   "SECRET_IN_CONFIG",
		Severity: High,
		Title:    "Credential stored in plain text",
		Detail:   "A long-lived key or token is written directly in the config file (" + strings.Join(names, ", ") + "). Anyone or anything that can read this file, including other AI tools and malware, can reuse it.",
		Fix:      "Move the value to the operating system's keychain or an environment variable, rotate the key, and give the replacement the smallest permissions it needs.",
	}}
}

func insecureTransport(s discover.Server) []Finding {
	if s.URL == "" {
		return nil
	}
	u, err := url.Parse(s.URL)
	if err != nil || u.Scheme != "http" || isLocalHost(u.Hostname()) {
		return nil
	}
	return []Finding{{
		RuleID:   "INSECURE_TRANSPORT",
		Severity: High,
		Title:    "Unencrypted connection to a remote server",
		Detail:   "This server is reached over plain http at " + u.Host + ". Requests, responses and any tokens can be read or changed on the network.",
		Fix:      "Switch the URL to https, or remove the server if the provider does not support it.",
	}}
}

func unpinnedPackage(s discover.Server) []Finding {
	runner := baseName(strings.ToLower(s.Command))
	runner = strings.TrimSuffix(runner, ".cmd")
	runner = strings.TrimSuffix(runner, ".exe")
	args := s.Args
	switch runner {
	case "npx", "bunx", "uvx":
	case "pnpm", "yarn", "bun":
		if len(args) == 0 || (args[0] != "dlx" && args[0] != "x") {
			return nil
		}
		args = args[1:]
	default:
		return nil
	}
	pkg := firstPackageArg(runner, args)
	if pkg == "" {
		return nil
	}
	if isPinned(runner, pkg) {
		return nil
	}
	return []Finding{{
		RuleID:   "UNPINNED_PACKAGE",
		Severity: Medium,
		Title:    "Downloads the newest code on every start",
		Detail:   "This server runs " + pkg + " through " + runner + " without a fixed version. If the package is taken over or a bad update is published, it runs on this computer automatically.",
		Fix:      "Pin an exact, reviewed version (for example " + stripVersion(pkg) + "@1.2.3) and update it on purpose.",
	}}
}

func broadFilesystem(s discover.Server, ctx Context) []Finding {
	if !fsServer.MatchString(s.Command + " " + strings.Join(s.Args, " ")) {
		return nil
	}
	for _, a := range s.Args {
		if isBroadPath(a, ctx.Home) {
			return []Finding{{
				RuleID:   "BROAD_FILESYSTEM",
				Severity: High,
				Title:    "Can read and write far more files than it needs",
				Detail:   "The filesystem server is allowed into " + a + ". That covers documents, SSH keys, browser data and other apps' secrets.",
				Fix:      "Limit it to the one project folder the agent needs, and use a read-only server where writing isn't required.",
			}}
		}
	}
	return nil
}

func shellAccess(s discover.Server) []Finding {
	all := s.Command + " " + strings.Join(s.Args, " ")
	base := strings.ToLower(baseName(s.Command))
	isShell := base == "bash" || base == "sh" || base == "zsh" || base == "cmd" || base == "cmd.exe" || base == "powershell" || base == "powershell.exe" || base == "pwsh"
	if !shellServer.MatchString(all) && !isShell {
		return nil
	}
	if isShell && !shellServer.MatchString(all) {
		// A shell used only to launch another server is common; flag it lower.
		return []Finding{{
			RuleID:   "SHELL_LAUNCHER",
			Severity: Low,
			Title:    "Started through a shell command",
			Detail:   "This server is launched with " + base + ", which makes it harder to see what actually runs.",
			Fix:      "Call the server's program directly instead of wrapping it in a shell.",
		}}
	}
	return []Finding{{
		RuleID:   "SHELL_ACCESS",
		Severity: High,
		Title:    "Agent can run any command on this computer",
		Detail:   "This server gives the AI a terminal. A single malicious instruction hidden in an email, web page or file the agent reads could run commands with the user's full rights.",
		Fix:      "Remove it, or replace it with a server that only allows a short list of approved commands and asks before each run.",
	}}
}

func riskyContainer(s discover.Server) []Finding {
	base := strings.ToLower(baseName(s.Command))
	if base != "docker" && base != "docker.exe" && base != "podman" {
		return nil
	}
	var reasons []string
	for i, a := range s.Args {
		next := ""
		if i+1 < len(s.Args) {
			next = s.Args[i+1]
		}
		switch {
		case a == "--privileged":
			reasons = append(reasons, "runs privileged")
		case (a == "--network" || a == "--net") && next == "host", a == "--network=host", a == "--net=host":
			reasons = append(reasons, "shares the host network")
		case (a == "-v" || a == "--volume" || a == "--mount") && mountsSensitive(next):
			reasons = append(reasons, "mounts "+strings.SplitN(next, ":", 2)[0])
		case strings.HasPrefix(a, "--volume=") && mountsSensitive(strings.TrimPrefix(a, "--volume=")):
			reasons = append(reasons, "mounts "+strings.SplitN(strings.TrimPrefix(a, "--volume="), ":", 2)[0])
		}
	}
	if len(reasons) == 0 {
		return nil
	}
	return []Finding{{
		RuleID:   "RISKY_CONTAINER",
		Severity: High,
		Title:    "Container can escape to the host",
		Detail:   "This server's container " + strings.Join(reasons, ", ") + ", so the container gives little protection.",
		Fix:      "Drop --privileged and host networking, and mount only the folder the server needs, read-only if possible.",
	}}
}

func remoteServer(s discover.Server) []Finding {
	if s.URL == "" {
		return nil
	}
	u, err := url.Parse(s.URL)
	if err != nil || isLocalHost(u.Hostname()) {
		return nil
	}
	return []Finding{{
		RuleID:   "REMOTE_SERVER",
		Severity: Low,
		Title:    "Sends data to an outside service",
		Detail:   "Whatever the agent passes to this server goes to " + u.Hostname() + ".",
		Fix:      "Confirm the company approves this provider and that a data agreement is in place.",
	}}
}

func mountsSensitive(spec string) bool {
	src := strings.SplitN(spec, ":", 2)[0]
	if strings.HasPrefix(spec, "type=bind") || strings.Contains(spec, "source=") {
		for _, part := range strings.Split(spec, ",") {
			if strings.HasPrefix(part, "source=") || strings.HasPrefix(part, "src=") {
				src = strings.SplitN(part, "=", 2)[1]
			}
		}
	}
	return src == "/" || strings.Contains(src, "docker.sock") || src == "~" || src == "$HOME" || src == "${HOME}" || src == "/etc" || src == "/root"
}

func isBroadPath(p, home string) bool {
	p = strings.TrimSpace(p)
	if p == "" || strings.HasPrefix(p, "-") || strings.HasPrefix(p, "@") {
		return false
	}
	switch p {
	case "/", "~", "~/", "$HOME", "${HOME}", "/Users", "/home", "C:\\", "C:/", "C:\\Users", "%USERPROFILE%":
		return true
	}
	if home != "" {
		clean := strings.TrimRight(p, "/\\")
		if clean == strings.TrimRight(home, "/\\") {
			return true
		}
	}
	// Drive roots like D:\ or E:/
	if len(p) <= 3 && len(p) >= 2 && p[1] == ':' {
		return true
	}
	return false
}

func isLocalHost(h string) bool {
	if h == "localhost" || strings.HasSuffix(h, ".localhost") {
		return true
	}
	if ip := net.ParseIP(h); ip != nil {
		return ip.IsLoopback()
	}
	return false
}

// Options that name the server package, and options that take a value that
// is not the server package, per runner. Values of the second kind (such as
// uvx --with helper==1.0) must be skipped, or a pinned helper would hide an
// unpinned server.
var (
	packageFlags = map[string][]string{
		"npx":  {"-p", "--package"},
		"bunx": {"-p", "--package"},
		"pnpm": {"--package"},
		"yarn": {"-p", "--package"},
		"bun":  {"-p", "--package"},
		"uvx":  {"--from"},
	}
	valueFlags = map[string][]string{
		"npx":  {"-c", "--call", "--registry", "--cache", "--userconfig", "-w", "--workspace"},
		"bunx": {"--registry", "--cwd"},
		"pnpm": {"--registry", "-C", "--dir"},
		"yarn": {"--registry", "--cwd"},
		"bun":  {"--registry", "--cwd"},
		"uvx": {
			"--with", "-w", "--with-editable", "--with-requirements", "-p", "--python",
			"--index", "--index-url", "-i", "--extra-index-url", "--default-index", "-f", "--find-links",
			"-c", "--constraints", "--overrides", "-b", "--build-constraints", "--cache-dir",
			"--directory", "--project", "--config-file", "--env-file", "--color", "--resolution",
			"--prerelease", "--exclude-newer", "-P", "--upgrade-package", "--reinstall-package",
			"--refresh-package", "--no-binary-package", "--no-build-package", "--index-strategy",
			"--keyring-provider", "--link-mode", "-C", "--config-setting", "--allow-insecure-host",
		},
	}
)

func firstPackageArg(runner string, args []string) string {
	isOne := func(list []string, a string) bool {
		for _, f := range list {
			if a == f {
				return true
			}
		}
		return false
	}
	for i := 0; i < len(args); i++ {
		a := args[i]
		if a == "--" {
			if i+1 < len(args) {
				return args[i+1]
			}
			return ""
		}
		if !strings.HasPrefix(a, "-") {
			return a
		}
		name, val, hasVal := strings.Cut(a, "=")
		switch {
		case isOne(packageFlags[runner], name):
			if hasVal {
				return val
			}
			if i+1 < len(args) {
				return args[i+1]
			}
			return ""
		case isOne(valueFlags[runner], name) && !hasVal:
			i++ // skip the option's value
		}
	}
	return ""
}

// isPinned reports whether a package spec names one exact version.
// npm-style runners need a full x.y.z version: tags (@beta) and ranges
// (@1, @^1.2) float. uvx pins with name==version or name@version.
func isPinned(runner, pkg string) bool {
	if runner == "uvx" {
		if name, v, ok := strings.Cut(pkg, "=="); ok && name != "" {
			return pyExactVersion.MatchString(v)
		}
		if m := pkgVersion.FindStringSubmatch(pkg); m != nil {
			return pyExactVersion.MatchString(m[2])
		}
		return false
	}
	m := pkgVersion.FindStringSubmatch(pkg)
	return m != nil && npmExactVersion.MatchString(m[2])
}

var (
	npmExactVersion = regexp.MustCompile(`^v?\d+\.\d+\.\d+(-[0-9A-Za-z.-]+)?(\+[0-9A-Za-z.-]+)?$`)
	pyExactVersion  = regexp.MustCompile(`^\d+(\.\d+)*([a-zA-Z0-9.+-]*)$`)
)

func stripVersion(pkg string) string {
	if m := pkgVersion.FindStringSubmatch(pkg); m != nil {
		return strings.TrimSuffix(pkg, "@"+m[2])
	}
	return pkg
}

// baseName returns the program name from a path written with either / or \,
// so Windows paths are handled the same on every OS the scanner is built for.
func baseName(p string) string {
	if i := strings.LastIndexAny(p, `/\`); i >= 0 {
		return p[i+1:]
	}
	return p
}
