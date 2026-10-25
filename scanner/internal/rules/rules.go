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
	"github.com/atulpokharel-gp/claude/scanner/internal/skillscan"
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
	// NeedsRotation holds refs of keys that were moved into the password
	// store but not yet replaced with new ones.
	NeedsRotation map[string]bool
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
	// Zero-width and bidirectional-override characters that can hide text or
	// reverse the display order of what the user sees. Rendering engines
	// honour them, so a tool description that looks safe can run hidden text.
	hiddenChars = regexp.MustCompile(`[\x{200B}-\x{200F}\x{202A}-\x{202E}\x{2060}-\x{2064}\x{2066}-\x{2069}\x{FEFF}]`)
	// Known prompt-injection phrases used to override earlier instructions.
	// A match in a config value is a tool-poisoning signal.
	injectionPhrase = regexp.MustCompile(`(?i)(ignore\s+(all\s+|the\s+|any\s+)?(previous|prior|above|earlier)\s+(instructions|rules|prompts?)|disregard\s+(the\s+|all\s+)?(above|previous|system|prior)\s+(instructions|prompts?)|forget\s+(all\s+|your\s+|the\s+)?(previous|prior|earlier)\s+(instructions|prompts?|rules)|override\s+(your|the|all)\s+(instructions|rules|prompts?)|reveal\s+(your|the)\s+(system\s+)?(prompt|instructions)|print\s+(your|the)\s+(system\s+)?prompt|you\s+are\s+(now\s+)?dan\b|do\s+anything\s+now)`)
	// OAuth scopes that grant broad or administrative access.
	broadOAuthScope = regexp.MustCompile(`(?i)(^|[,\s])(\*|admin(:[^,\s]+)?|admin[._-](all|org|user|repo)|write:all|write[._-]all|write:org|full[_-]?access|full[_-]?control|offline_access|read:all|read[._-]all|read:org|user:all|repo$|repo:[^,\s]+|workspace:all|all:all|owner|superuser|root|dangerously[_-]skip[_-]permissions)(?:$|[,\s])`)
	// Hosts trusted for package provenance. A --registry or --index-url that
	// points elsewhere pulls code from a source users rarely review.
	trustedNpmHost = regexp.MustCompile(`^(registry\.npmjs\.org|npm\.pkg\.github\.com)$`)
	trustedPyHost  = regexp.MustCompile(`^(pypi\.org|files\.pythonhosted\.org)$`)
	// Package specs that bypass registry provenance entirely.
	untrustedSourcePrefix = regexp.MustCompile(`^(git\+|git://|git@|https?://|file:|\./|\.\\|/|~|[A-Za-z]:[\\/])`)
)

// Check runs every rule against one server.
func Check(s discover.Server, ctx Context) []Finding {
	var out []Finding
	out = append(out, secretsInConfig(s)...)
	out = append(out, hiddenInstructions(s)...)
	out = append(out, insecureTransport(s)...)
	out = append(out, unpinnedPackage(s)...)
	out = append(out, untrustedSource(s)...)
	out = append(out, untrustedRegistry(s)...)
	out = append(out, broadFilesystem(s, ctx)...)
	out = append(out, shellAccess(s)...)
	out = append(out, riskyContainer(s)...)
	out = append(out, oauthBroadScope(s)...)
	out = append(out, remoteServer(s)...)
	out = append(out, keyNotRotated(s, ctx)...)
	return out
}

// CheckSkill runs the skill-specific rules against one on-disk skill.
// Skill findings use the same Finding shape as MCP findings so the report
// can list them side by side.
func CheckSkill(s skillscan.Skill) []Finding {
	var out []Finding
	out = append(out, skillHiddenInstructions(s)...)
	out = append(out, skillBroadToolAccess(s)...)
	return out
}

func skillHiddenInstructions(s skillscan.Skill) []Finding {
	var where []string
	check := func(label, v string) {
		if v == "" {
			return
		}
		if hiddenChars.MatchString(v) {
			where = append(where, label+" (hidden characters)")
			return
		}
		if injectionPhrase.MatchString(v) {
			where = append(where, label+" (injection phrase)")
		}
	}
	check("name", s.Name)
	check("description", s.Description)
	// The body can be long; a per-line scan localises the hit for the report.
	for i, line := range strings.Split(s.Body, "\n") {
		trimmed := strings.TrimSpace(line)
		if trimmed == "" {
			continue
		}
		if hiddenChars.MatchString(trimmed) {
			where = append(where, "body line "+strconv.Itoa(i+1)+" (hidden characters)")
			continue
		}
		if injectionPhrase.MatchString(trimmed) {
			where = append(where, "body line "+strconv.Itoa(i+1)+" (injection phrase)")
		}
	}
	if len(where) == 0 {
		return nil
	}
	if len(where) > 10 {
		// Keep the report readable: name the first few and total count.
		where = append(where[:10], "and "+strconv.Itoa(len(where)-10)+" more")
	}
	return []Finding{{
		RuleID:   "SKILL_HIDDEN_INSTRUCTIONS",
		Severity: High,
		Title:    "Skill carries hidden text or override phrases",
		Detail:   "This skill's instructions include text an agent will read but a human reviewer may miss (" + strings.Join(where, ", ") + "). A SKILL.md is loaded verbatim when the skill triggers, so hidden overrides take effect on every invocation.",
		Fix:      "Review the SKILL.md by hand, remove the hidden or override text, and only enable skills from authors the company trusts.",
	}}
}

// Shell-equivalent or write-wide tools that a skill grants itself. A
// narrower Bash form like Bash(git status:*) names one command and is not
// flagged; Bash alone or Bash(*) is a shell.
var broadSkillTool = regexp.MustCompile(`^(\*|Bash|Shell|Terminal|Write|Edit|NotebookEdit|WebFetch|Agent)$`)

func skillBroadToolAccess(s skillscan.Skill) []Finding {
	var risky []string
	for _, t := range s.AllowedTools {
		trimmed := strings.TrimSpace(t)
		if trimmed == "" {
			continue
		}
		if broadSkillTool.MatchString(trimmed) {
			risky = append(risky, trimmed)
			continue
		}
		// Any Bash(...) that opens the whole shell or routes through sudo.
		if strings.HasPrefix(trimmed, "Bash(") && strings.HasSuffix(trimmed, ")") {
			inner := trimmed[len("Bash(") : len(trimmed)-1]
			if inner == "*" || inner == ".*" || strings.HasPrefix(inner, "sudo") {
				risky = append(risky, trimmed)
			}
		}
	}
	if len(risky) == 0 {
		return nil
	}
	sort.Strings(risky)
	return []Finding{{
		RuleID:   "SKILL_BROAD_TOOL_ACCESS",
		Severity: Medium,
		Title:    "Skill asks for broad or shell-equivalent tools",
		Detail:   "This skill's allowed-tools includes " + strings.Join(risky, ", ") + ". A skill that can shell out or write anywhere turns a prompt-injection hit into a full compromise.",
		Fix:      "Narrow allowed-tools to the specific commands and files the skill needs (e.g. Bash(git status:*) rather than Bash) and remove shell-equivalent tools you don't use.",
	}}
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

// SecretEnvKeys returns, sorted, the env var names whose values are
// credentials written in plain text. The fix command moves exactly these.
func SecretEnvKeys(env map[string]string) []string {
	var keys []string
	for k, v := range env {
		if !isLiteral(v) {
			continue
		}
		if secretKeyName.MatchString(k) || secretValue.MatchString(v) || URLHasCredential(v) {
			keys = append(keys, k)
		}
	}
	sort.Strings(keys)
	return keys
}

// SecretHeaderKeys returns, sorted, the header names whose values are
// credentials written in plain text.
func SecretHeaderKeys(h map[string]string) []string {
	var keys []string
	for k, v := range h {
		if !isLiteral(v) {
			continue
		}
		if strings.EqualFold(k, "authorization") || secretKeyName.MatchString(k) || secretValue.MatchString(v) {
			keys = append(keys, k)
		}
	}
	sort.Strings(keys)
	return keys
}

func secretsInConfig(s discover.Server) []Finding {
	var names []string
	for _, k := range SecretEnvKeys(s.Env) {
		names = append(names, "env "+k)
	}
	for _, k := range SecretHeaderKeys(s.Headers) {
		names = append(names, "header "+k)
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
	// A git URL, direct URL or local path is already called out by
	// UNTRUSTED_SOURCE; "pin a version" doesn't apply there.
	if untrustedSourcePrefix.MatchString(pkg) {
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

func keyNotRotated(s discover.Server, ctx Context) []Finding {
	var pending, refs []string
	for _, p := range s.Protected {
		if ctx.NeedsRotation[p.Ref] {
			pending = append(pending, p.Env)
			refs = append(refs, p.Ref)
		}
	}
	if len(pending) == 0 {
		return nil
	}
	sort.Strings(pending)
	sort.Strings(refs)
	cmds := make([]string, len(refs))
	for i, r := range refs {
		cmds[i] = "zinloop rotate " + r
	}
	return []Finding{{
		RuleID:   "KEY_NOT_ROTATED",
		Severity: Medium,
		Title:    "Protected now, but the old key was exposed",
		Detail:   "Zinloop moved " + strings.Join(pending, ", ") + " into the password store, but the same key sat in plain text before. Anyone who copied the file still has it.",
		Fix:      "Create a new key with the provider, revoke the old one, then run one command per key: " + strings.Join(cmds, "; "),
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

// hiddenInstructions flags zero-width or bidi-override characters, or
// prompt-injection phrases, hiding in config values. This is the
// config-level flavour of "tool poisoning": a server name, env value, URL
// or arg that looks ordinary but carries hidden text an agent will read.
func hiddenInstructions(s discover.Server) []Finding {
	var where []string
	check := func(label, v string) {
		if v == "" {
			return
		}
		if hiddenChars.MatchString(v) {
			where = append(where, label+" (hidden characters)")
			return
		}
		if injectionPhrase.MatchString(v) {
			where = append(where, label+" (injection phrase)")
		}
	}
	check("server name", s.Name)
	check("command", s.Command)
	for i, a := range s.Args {
		check("argument "+strconv.Itoa(i+1), a)
	}
	for _, k := range sortedMapKeys(s.Env) {
		check("env "+k, s.Env[k])
	}
	for _, k := range sortedMapKeys(s.Headers) {
		check("header "+k, s.Headers[k])
	}
	check("server URL", s.URL)
	if len(where) == 0 {
		return nil
	}
	sort.Strings(where)
	return []Finding{{
		RuleID:   "HIDDEN_INSTRUCTIONS",
		Severity: High,
		Title:    "Hidden text or injection phrases in the config",
		Detail:   "This server has text that an agent will read but a human reviewer may miss (" + strings.Join(where, ", ") + "). That is how tool-poisoning and prompt-injection attacks on MCP servers hide payloads.",
		Fix:      "Remove the hidden characters or override phrases, and only trust tool descriptions from servers you fully control.",
	}}
}

// untrustedSource flags package specs that bypass the normal registry: git
// URLs, http(s) URLs or local paths. These don't go through npm/PyPI
// provenance signing and can swap under you without a version bump.
func untrustedSource(s discover.Server) []Finding {
	runner, args, ok := packageRunner(s)
	if !ok {
		return nil
	}
	pkg := firstPackageArg(runner, args)
	if pkg == "" || !untrustedSourcePrefix.MatchString(pkg) {
		return nil
	}
	kind := "a URL or local path"
	switch {
	case strings.HasPrefix(pkg, "git+"), strings.HasPrefix(pkg, "git://"), strings.HasPrefix(pkg, "git@"):
		kind = "a git source"
	case strings.HasPrefix(pkg, "http://"), strings.HasPrefix(pkg, "https://"):
		kind = "a direct URL"
	case strings.HasPrefix(pkg, "file:"), strings.HasPrefix(pkg, "./"), strings.HasPrefix(pkg, `.\`), strings.HasPrefix(pkg, "/"), strings.HasPrefix(pkg, "~"):
		kind = "a local path"
	}
	return []Finding{{
		RuleID:   "UNTRUSTED_SOURCE",
		Severity: High,
		Title:    "Installed from outside the package registry",
		Detail:   "This server is pulled from " + kind + " (" + pkg + ") instead of npm or PyPI. It skips registry provenance and can change silently between runs.",
		Fix:      "Publish the server to a registry and pin an exact version, or vendor the code and run it from a reviewed, read-only location.",
	}}
}

// untrustedRegistry flags --registry / --index-url pointing to a non-standard
// host. Pulling packages from an unexpected registry is a known supply-chain
// vector; the risk doesn't require the package itself to look wrong.
func untrustedRegistry(s discover.Server) []Finding {
	runner, args, ok := packageRunner(s)
	if !ok {
		return nil
	}
	var hosts []string
	for i := 0; i < len(args); i++ {
		a := args[i]
		name, val, hasVal := strings.Cut(a, "=")
		var flag, raw string
		switch name {
		case "--registry", "--index", "--index-url", "-i", "--extra-index-url", "--default-index":
			flag = name
			if hasVal {
				raw = val
			} else if i+1 < len(args) {
				raw = args[i+1]
				i++
			}
		default:
			continue
		}
		if raw == "" {
			continue
		}
		u, err := url.Parse(raw)
		if err != nil || u.Host == "" {
			continue
		}
		host := strings.ToLower(u.Hostname())
		switch runner {
		case "uvx":
			if trustedPyHost.MatchString(host) {
				continue
			}
		default:
			if trustedNpmHost.MatchString(host) {
				continue
			}
		}
		hosts = append(hosts, flag+" "+host)
	}
	if len(hosts) == 0 {
		return nil
	}
	sort.Strings(hosts)
	return []Finding{{
		RuleID:   "UNTRUSTED_REGISTRY",
		Severity: Medium,
		Title:    "Package comes from a non-standard registry",
		Detail:   "This server fetches its code through " + strings.Join(hosts, ", ") + " instead of the default registry. If that registry is taken over or replaced, every start installs code it serves.",
		Fix:      "Remove the registry override, or confirm the host is on the company's approved list and pin the exact version.",
	}}
}

// oauthBroadScope flags admin/*/write:all/offline_access-style scopes in
// scope-related config, which turn a leaked token into a full account
// takeover. Narrower scopes make the same leak much less dangerous.
func oauthBroadScope(s discover.Server) []Finding {
	isScopeKey := func(k string) bool {
		lk := strings.ToLower(k)
		return strings.Contains(lk, "scope") || strings.Contains(lk, "scopes") || strings.Contains(lk, "permission")
	}
	var where []string
	for _, k := range sortedMapKeys(s.Env) {
		if isScopeKey(k) && hasBroadScope(s.Env[k]) {
			where = append(where, "env "+k)
		}
	}
	for _, k := range sortedMapKeys(s.Headers) {
		if isScopeKey(k) && hasBroadScope(s.Headers[k]) {
			where = append(where, "header "+k)
		}
	}
	for i := 0; i < len(s.Args); i++ {
		a := s.Args[i]
		name, val, hasVal := strings.Cut(a, "=")
		flagName := strings.TrimLeft(name, "-")
		if strings.HasPrefix(name, "-") && isScopeKey(flagName) {
			switch {
			case hasVal && hasBroadScope(val):
				where = append(where, "argument "+strconv.Itoa(i+1))
			case !hasVal && i+1 < len(s.Args) && hasBroadScope(s.Args[i+1]):
				where = append(where, "argument "+strconv.Itoa(i+2))
				i++
			}
		}
	}
	if s.URL != "" {
		if u, err := url.Parse(s.URL); err == nil {
			for k, vals := range u.Query() {
				if isScopeKey(k) {
					for _, v := range vals {
						if hasBroadScope(v) {
							where = append(where, "URL query "+k)
							break
						}
					}
				}
			}
		}
	}
	if len(where) == 0 {
		return nil
	}
	sort.Strings(where)
	return []Finding{{
		RuleID:   "OAUTH_BROAD_SCOPE",
		Severity: Medium,
		Title:    "OAuth scope is wider than the server needs",
		Detail:   "This server asks for admin-level or write-all OAuth scopes (" + strings.Join(where, ", ") + "). If the token leaks, the attacker gets the same wide access.",
		Fix:      "Issue a token with only the scopes the server actually calls, and prefer read-only or resource-scoped tokens.",
	}}
}

func hasBroadScope(v string) bool {
	v = strings.TrimSpace(v)
	if v == "" || !isLiteral(v) {
		return false
	}
	// Normalise separators so "admin,write:all repo:write" is tokenisable.
	norm := " " + strings.ReplaceAll(v, ",", " ") + " "
	return broadOAuthScope.MatchString(norm)
}

// packageRunner reports the runner name (npx, uvx, …) and the args after any
// subcommand (pnpm/yarn/bun need "dlx"/"x") when a server is launched through
// one. Rules that look at the installed package share this detection with
// unpinnedPackage so they stay consistent.
func packageRunner(s discover.Server) (string, []string, bool) {
	runner := baseName(strings.ToLower(s.Command))
	runner = strings.TrimSuffix(runner, ".cmd")
	runner = strings.TrimSuffix(runner, ".exe")
	args := s.Args
	switch runner {
	case "npx", "bunx", "uvx":
		return runner, args, true
	case "pnpm", "yarn", "bun":
		if len(args) == 0 || (args[0] != "dlx" && args[0] != "x") {
			return "", nil, false
		}
		return runner, args[1:], true
	}
	return "", nil, false
}

func sortedMapKeys(m map[string]string) []string {
	if len(m) == 0 {
		return nil
	}
	keys := make([]string, 0, len(m))
	for k := range m {
		keys = append(keys, k)
	}
	sort.Strings(keys)
	return keys
}
