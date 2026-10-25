// Package discover finds MCP server configuration files on a computer and
// parses the servers defined in them.
package discover

import (
	"path/filepath"
)

// Format says how servers are laid out inside a config file.
type Format string

const (
	// FormatMCPServers is the common {"mcpServers": {...}} layout used by
	// Claude Desktop, Cursor, Windsurf and project .mcp.json files.
	FormatMCPServers Format = "mcpServers"
	// FormatClaudeCode is ~/.claude.json: top-level mcpServers plus
	// per-project mcpServers under "projects".
	FormatClaudeCode Format = "claudeCode"
	// FormatVSCodeServers is VS Code's mcp.json: {"servers": {...}}.
	FormatVSCodeServers Format = "vscodeServers"
	// FormatVSCodeSettings is VS Code's settings.json: {"mcp": {"servers": {...}}}.
	FormatVSCodeSettings Format = "vscodeSettings"
)

// Location is one place an AI app may keep MCP server settings.
type Location struct {
	App    string `json:"app"`
	Path   string `json:"path"`
	Format Format `json:"format"`
	// Default is the path this location would have had with no overrides.
	// Empty when Path is the default already.
	Default string `json:"default,omitempty"`
	// Override says why Path differs from Default: "env:CLAUDE_CONFIG_DIR",
	// "env:XDG_CONFIG_HOME", "flag:--extra-config", … Empty when no override.
	Override string `json:"override,omitempty"`
}

// Env holds the directories that decide where config files live.
type Env struct {
	GOOS        string   // "darwin", "linux" or "windows"
	Home        string   // user's home directory
	AppData     string   // %APPDATA% on Windows (Roaming)
	ProjectDirs []string // extra project folders to check for project-level configs
	// ExtraConfigs are explicit config file paths the operator pointed us at.
	// They scan with FormatMCPServers unless the filename hints otherwise.
	ExtraConfigs []string
	// ExtraSkillDirs are explicit skill-directory paths the operator pointed
	// at (e.g. a non-standard install, a packaged container image).
	ExtraSkillDirs []string
	// ClaudeConfigDir, when non-empty, replaces the default ~/.claude.json
	// location (Claude Code honours $CLAUDE_CONFIG_DIR this way).
	ClaudeConfigDir string
	// XDGConfigHome, when non-empty, replaces ~/.config on Linux.
	XDGConfigHome string
}

// Locations returns every known config file location for the given environment.
// Files may or may not exist; the caller checks.
func Locations(e Env) []Location {
	var locs []Location
	add := func(app string, f Format, path, def, override string) {
		l := Location{App: app, Path: path, Format: f}
		if override != "" && path != def {
			l.Default = def
			l.Override = override
		}
		locs = append(locs, l)
	}

	// Per-user application config directory. Linux honours $XDG_CONFIG_HOME.
	var appCfg, appCfgDefault, appCfgOverride string
	switch e.GOOS {
	case "darwin":
		appCfg = filepath.Join(e.Home, "Library", "Application Support")
		appCfgDefault = appCfg
	case "windows":
		appCfg = e.AppData
		if appCfg == "" {
			appCfg = filepath.Join(e.Home, "AppData", "Roaming")
		}
		appCfgDefault = filepath.Join(e.Home, "AppData", "Roaming")
	default:
		appCfgDefault = filepath.Join(e.Home, ".config")
		if e.XDGConfigHome != "" {
			appCfg = e.XDGConfigHome
			appCfgOverride = "env:XDG_CONFIG_HOME"
		} else {
			appCfg = appCfgDefault
		}
	}

	add("Claude Desktop", FormatMCPServers,
		filepath.Join(appCfg, "Claude", "claude_desktop_config.json"),
		filepath.Join(appCfgDefault, "Claude", "claude_desktop_config.json"),
		appCfgOverride)

	// Claude Code: $CLAUDE_CONFIG_DIR, when set, replaces ~ as the folder
	// holding .claude.json and the .claude subfolder.
	claudeCodeDefault := filepath.Join(e.Home, ".claude.json")
	claudeCodePath := claudeCodeDefault
	claudeCodeOverride := ""
	if e.ClaudeConfigDir != "" {
		claudeCodePath = filepath.Join(e.ClaudeConfigDir, ".claude.json")
		claudeCodeOverride = "env:CLAUDE_CONFIG_DIR"
	}
	add("Claude Code", FormatClaudeCode, claudeCodePath, claudeCodeDefault, claudeCodeOverride)

	add("Cursor", FormatMCPServers,
		filepath.Join(e.Home, ".cursor", "mcp.json"),
		filepath.Join(e.Home, ".cursor", "mcp.json"), "")
	add("Windsurf", FormatMCPServers,
		filepath.Join(e.Home, ".codeium", "windsurf", "mcp_config.json"),
		filepath.Join(e.Home, ".codeium", "windsurf", "mcp_config.json"), "")
	for _, edition := range []string{"Code", "Code - Insiders"} {
		add("VS Code", FormatVSCodeServers,
			filepath.Join(appCfg, edition, "User", "mcp.json"),
			filepath.Join(appCfgDefault, edition, "User", "mcp.json"),
			appCfgOverride)
		add("VS Code", FormatVSCodeSettings,
			filepath.Join(appCfg, edition, "User", "settings.json"),
			filepath.Join(appCfgDefault, edition, "User", "settings.json"),
			appCfgOverride)
	}

	for _, dir := range e.ProjectDirs {
		add("Project (.mcp.json)", FormatMCPServers, filepath.Join(dir, ".mcp.json"), "", "")
		add("Cursor project", FormatMCPServers, filepath.Join(dir, ".cursor", "mcp.json"), "", "")
		add("VS Code project", FormatVSCodeServers, filepath.Join(dir, ".vscode", "mcp.json"), "", "")
	}

	// Operator-supplied extras: scan whatever file the operator pointed at.
	// The format is guessed from the filename, defaulting to the common one.
	for _, p := range e.ExtraConfigs {
		add("Extra", extraFormat(p), p, "", "flag:--extra-config")
	}
	return locs
}

// extraFormat picks a config layout from a file name. Unknown names fall back
// to the common {"mcpServers": …} shape so an unrecognised custom file is
// still parsed.
func extraFormat(path string) Format {
	base := filepath.Base(path)
	switch base {
	case ".claude.json":
		return FormatClaudeCode
	case "settings.json":
		return FormatVSCodeSettings
	case "mcp.json":
		return FormatVSCodeServers
	}
	return FormatMCPServers
}
