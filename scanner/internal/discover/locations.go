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
}

// Env holds the directories that decide where config files live.
type Env struct {
	GOOS        string   // "darwin", "linux" or "windows"
	Home        string   // user's home directory
	AppData     string   // %APPDATA% on Windows (Roaming)
	ProjectDirs []string // extra project folders to check for project-level configs
}

// Locations returns every known config file location for the given environment.
// Files may or may not exist; the caller checks.
func Locations(e Env) []Location {
	var locs []Location
	add := func(app string, f Format, parts ...string) {
		locs = append(locs, Location{App: app, Path: filepath.Join(parts...), Format: f})
	}

	// Per-user application config directory.
	var appCfg string
	switch e.GOOS {
	case "darwin":
		appCfg = filepath.Join(e.Home, "Library", "Application Support")
	case "windows":
		appCfg = e.AppData
		if appCfg == "" {
			appCfg = filepath.Join(e.Home, "AppData", "Roaming")
		}
	default:
		appCfg = filepath.Join(e.Home, ".config")
	}

	add("Claude Desktop", FormatMCPServers, appCfg, "Claude", "claude_desktop_config.json")
	add("Claude Code", FormatClaudeCode, e.Home, ".claude.json")
	add("Cursor", FormatMCPServers, e.Home, ".cursor", "mcp.json")
	add("Windsurf", FormatMCPServers, e.Home, ".codeium", "windsurf", "mcp_config.json")
	for _, edition := range []string{"Code", "Code - Insiders"} {
		add("VS Code", FormatVSCodeServers, appCfg, edition, "User", "mcp.json")
		add("VS Code", FormatVSCodeSettings, appCfg, edition, "User", "settings.json")
	}

	for _, dir := range e.ProjectDirs {
		add("Project (.mcp.json)", FormatMCPServers, dir, ".mcp.json")
		add("Cursor project", FormatMCPServers, dir, ".cursor", "mcp.json")
		add("VS Code project", FormatVSCodeServers, dir, ".vscode", "mcp.json")
	}
	return locs
}
