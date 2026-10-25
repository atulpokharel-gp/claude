// Package report builds the scan result that is printed or uploaded.
package report

import (
	"fmt"
	"io"
	"sort"
	"strings"
	"time"

	"github.com/atulpokharel-gp/claude/scanner/internal/discover"
	"github.com/atulpokharel-gp/claude/scanner/internal/rules"
	"github.com/atulpokharel-gp/claude/scanner/internal/skillscan"
)

// SchemaVersion changes when the JSON shape changes in a breaking way.
const SchemaVersion = 1

// Redacted replaces any argument that looks like a credential.
const Redacted = "[REDACTED]"

// Report is the full result of one scan of one computer.
type Report struct {
	SchemaVersion  int                        `json:"schemaVersion"`
	ScannerVersion string                     `json:"scannerVersion"`
	Hostname       string                     `json:"hostname"`
	OS             string                     `json:"os"`
	ScannedAt      time.Time                  `json:"scannedAt"`
	Summary        Summary                    `json:"summary"`
	Servers        []ServerResult             `json:"servers"`
	Configs        []discover.ConfigResult    `json:"configs"`
	Skills         []SkillResult              `json:"skills,omitempty"`
	SkillDirs      []skillscan.LocationResult `json:"skillDirs,omitempty"`
	Tools          []ToolResult               `json:"tools,omitempty"`
	ToolProbes     []ToolProbeResult          `json:"toolProbes,omitempty"`
}

// Summary counts servers and skills by their worst finding. Server and skill
// counts stay separate so a dashboard can show them side by side without
// double-counting.
type Summary struct {
	Servers     int `json:"servers"`
	High        int `json:"high"`
	Medium      int `json:"medium"`
	Low         int `json:"low"`
	Clean       int `json:"clean"`
	Skills      int `json:"skills,omitempty"`
	SkillHigh   int `json:"skillHigh,omitempty"`
	SkillMedium int `json:"skillMedium,omitempty"`
	SkillLow    int `json:"skillLow,omitempty"`
	SkillClean  int `json:"skillClean,omitempty"`
	Tools       int `json:"tools,omitempty"`
	ToolHigh    int `json:"toolHigh,omitempty"`
}

// ServerResult is one server with its findings and overall risk.
type ServerResult struct {
	discover.Server
	// User is the profile the config belongs to (the home folder's name), so
	// the console can show who uses each tool.
	User     string          `json:"user,omitempty"`
	Risk     rules.Severity  `json:"risk"`
	Findings []rules.Finding `json:"findings"`
}

// SkillResult is one skill with its findings and overall risk. The SKILL.md
// body is not serialised; the console only ever needs the rule output.
type SkillResult struct {
	skillscan.Skill
	User     string          `json:"user,omitempty"`
	Risk     rules.Severity  `json:"risk"`
	Findings []rules.Finding `json:"findings"`
}

// ToolResult is one tool advertised by an MCP server at runtime, together
// with any findings from running the tool-level rules against it.
type ToolResult struct {
	Server      string          `json:"server"`
	Name        string          `json:"name"`
	Description string          `json:"description,omitempty"`
	Risk        rules.Severity  `json:"risk"`
	Findings    []rules.Finding `json:"findings"`
}

// ToolProbeResult records whether a server could be probed and, if not,
// why. It is kept separate from ToolResult so the UI can distinguish
// "server responded with no tools" from "probe failed".
type ToolProbeResult struct {
	Server string `json:"server"`
	Tools  int    `json:"tools"`
	Error  string `json:"error,omitempty"`
}

// Build checks every server and assembles the report.
// Secret-looking arguments are redacted here so nothing downstream sees them.
func Build(servers []discover.Server, configs []discover.ConfigResult, skills []skillscan.Skill, skillDirs []skillscan.LocationResult, ctx rules.Context, meta Report) Report {
	r := meta
	r.SchemaVersion = SchemaVersion
	r.Configs = configs
	r.SkillDirs = skillDirs
	r.Servers = make([]ServerResult, 0, len(servers))
	for _, s := range servers {
		f := rules.Check(s, ctx)
		if f == nil {
			f = []rules.Finding{}
		}
		origArgs, origURL := s.Args, s.URL
		s.Args = redactArgs(s.Args)
		s.URL = redactURL(s.URL)
		f = scrubFindings(f, origArgs, s.Args, origURL, s.URL)
		res := ServerResult{Server: s, Risk: rules.Worst(f), Findings: f}
		r.Servers = append(r.Servers, res)
		switch res.Risk {
		case rules.High:
			r.Summary.High++
		case rules.Medium:
			r.Summary.Medium++
		case rules.Low:
			r.Summary.Low++
		default:
			r.Summary.Clean++
		}
	}
	r.Summary.Servers = len(r.Servers)
	sort.SliceStable(r.Servers, func(i, j int) bool {
		return r.Servers[i].Risk.Rank() > r.Servers[j].Risk.Rank()
	})
	r.Skills = make([]SkillResult, 0, len(skills))
	for _, s := range skills {
		f := rules.CheckSkill(s)
		if f == nil {
			f = []rules.Finding{}
		}
		// The body is checked but not shipped; drop it before serialising.
		s.Body = ""
		res := SkillResult{Skill: s, Risk: rules.Worst(f), Findings: f}
		r.Skills = append(r.Skills, res)
		switch res.Risk {
		case rules.High:
			r.Summary.SkillHigh++
		case rules.Medium:
			r.Summary.SkillMedium++
		case rules.Low:
			r.Summary.SkillLow++
		default:
			r.Summary.SkillClean++
		}
	}
	r.Summary.Skills = len(r.Skills)
	sort.SliceStable(r.Skills, func(i, j int) bool {
		return r.Skills[i].Risk.Rank() > r.Skills[j].Risk.Rank()
	})
	return r
}

// WithTools attaches runtime tool-probe output to an already-built report.
// Keeping it separate from Build lets callers who don't opt into probing
// avoid passing nil slices through the main signature. Tools are checked
// with rules.CheckTool and sorted worst-first for the UI.
func WithTools(r Report, tools []rules.Tool, probes []ToolProbeResult) Report {
	r.ToolProbes = probes
	r.Tools = make([]ToolResult, 0, len(tools))
	for _, t := range tools {
		f := rules.CheckTool(t)
		if f == nil {
			f = []rules.Finding{}
		}
		res := ToolResult{
			Server:      t.Server,
			Name:        t.Name,
			Description: t.Description,
			Risk:        rules.Worst(f),
			Findings:    f,
		}
		r.Tools = append(r.Tools, res)
		if res.Risk == rules.High {
			r.Summary.ToolHigh++
		}
	}
	r.Summary.Tools = len(r.Tools)
	sort.SliceStable(r.Tools, func(i, j int) bool {
		return r.Tools[i].Risk.Rank() > r.Tools[j].Risk.Rank()
	})
	return r
}

// Merge joins reports built for several user profiles on one computer into
// one report, keeping meta's hostname, OS and times.
func Merge(meta Report, parts []Report) Report {
	if len(parts) == 1 {
		return parts[0]
	}
	r := meta
	r.SchemaVersion = SchemaVersion
	r.Servers = []ServerResult{}
	r.Configs = []discover.ConfigResult{}
	r.Skills = []SkillResult{}
	r.SkillDirs = []skillscan.LocationResult{}
	r.Tools = []ToolResult{}
	r.ToolProbes = []ToolProbeResult{}
	for _, p := range parts {
		r.Servers = append(r.Servers, p.Servers...)
		r.Configs = append(r.Configs, p.Configs...)
		r.Skills = append(r.Skills, p.Skills...)
		r.SkillDirs = append(r.SkillDirs, p.SkillDirs...)
		r.Tools = append(r.Tools, p.Tools...)
		r.ToolProbes = append(r.ToolProbes, p.ToolProbes...)
		r.Summary.Servers += p.Summary.Servers
		r.Summary.High += p.Summary.High
		r.Summary.Medium += p.Summary.Medium
		r.Summary.Low += p.Summary.Low
		r.Summary.Clean += p.Summary.Clean
		r.Summary.Skills += p.Summary.Skills
		r.Summary.SkillHigh += p.Summary.SkillHigh
		r.Summary.SkillMedium += p.Summary.SkillMedium
		r.Summary.SkillLow += p.Summary.SkillLow
		r.Summary.SkillClean += p.Summary.SkillClean
		r.Summary.Tools += p.Summary.Tools
		r.Summary.ToolHigh += p.Summary.ToolHigh
	}
	sort.SliceStable(r.Servers, func(i, j int) bool {
		return r.Servers[i].Risk.Rank() > r.Servers[j].Risk.Rank()
	})
	sort.SliceStable(r.Skills, func(i, j int) bool {
		return r.Skills[i].Risk.Rank() > r.Skills[j].Risk.Rank()
	})
	sort.SliceStable(r.Tools, func(i, j int) bool {
		return r.Tools[i].Risk.Rank() > r.Tools[j].Risk.Rank()
	})
	return r
}

func redactArgs(args []string) []string {
	if args == nil {
		return nil
	}
	out := append([]string(nil), args...)
	for _, i := range rules.SecretArgs(args) {
		a := out[i]
		switch {
		case strings.Contains(a, "://") && !strings.HasPrefix(a, "-"):
			out[i] = redactURL(a)
		case strings.HasPrefix(a, "-") && strings.Contains(a, "="):
			name, _, _ := strings.Cut(a, "=")
			out[i] = name + "=" + Redacted
		default:
			out[i] = Redacted
		}
		// Tokens can sit anywhere, e.g. in a URL path, so sweep what's left.
		out[i] = rules.RedactTokens(out[i], Redacted)
	}
	return out
}

// scrubFindings removes redacted values from finding text. Rules quote
// arguments (package names, paths) in their messages, so any argument that was
// redacted must also be replaced wherever a message repeats it.
func scrubFindings(fs []rules.Finding, origArgs, redArgs []string, origURL, redURL string) []rules.Finding {
	var pairs []string
	for i := range origArgs {
		if origArgs[i] != redArgs[i] {
			pairs = append(pairs, origArgs[i], redArgs[i])
		}
	}
	if origURL != redURL {
		pairs = append(pairs, origURL, redURL)
	}
	if len(pairs) == 0 {
		return fs
	}
	rep := strings.NewReplacer(pairs...)
	out := make([]rules.Finding, len(fs))
	for i, f := range fs {
		f.Title = rules.RedactTokens(rep.Replace(f.Title), Redacted)
		f.Detail = rules.RedactTokens(rep.Replace(f.Detail), Redacted)
		f.Fix = rules.RedactTokens(rep.Replace(f.Fix), Redacted)
		out[i] = f
	}
	return out
}

func redactURL(u string) string {
	if u == "" {
		return u
	}
	u = rules.RedactTokens(u, Redacted)
	// Drop user info and query strings, which is where tokens hide in URLs.
	if i := strings.Index(u, "?"); i >= 0 {
		u = u[:i] + "?" + Redacted
	}
	if i := strings.Index(u, "#"); i >= 0 {
		u = u[:i]
	}
	// User info ends at the last @ before the path: passwords can contain
	// an unescaped @, and URL parsers accept that.
	if scheme := strings.Index(u, "://"); scheme >= 0 {
		start := scheme + 3
		end := len(u)
		if i := strings.IndexAny(u[start:], "/?"); i >= 0 {
			end = start + i
		}
		if at := strings.LastIndex(u[start:end], "@"); at >= 0 {
			u = u[:start] + Redacted + u[start+at:]
		}
	}
	return u
}

// WriteText prints a short human-readable summary.
func WriteText(w io.Writer, r Report) {
	fmt.Fprintf(w, "AI agent scan of %s (%s) at %s\n", r.Hostname, r.OS, r.ScannedAt.Format(time.RFC3339))
	found := 0
	for _, c := range r.Configs {
		if c.Found {
			found++
		}
	}
	fmt.Fprintf(w, "Checked %d config locations, found %d config files and %d MCP servers.\n", len(r.Configs), found, r.Summary.Servers)
	fmt.Fprintf(w, "Risk: %d high, %d medium, %d low, %d clean.\n", r.Summary.High, r.Summary.Medium, r.Summary.Low, r.Summary.Clean)
	if r.Summary.Skills > 0 || len(r.SkillDirs) > 0 {
		skillDirs := 0
		for _, s := range r.SkillDirs {
			if s.Found {
				skillDirs++
			}
		}
		fmt.Fprintf(w, "Checked %d skill directories, found %d skills.\n", skillDirs, r.Summary.Skills)
		fmt.Fprintf(w, "Skill risk: %d high, %d medium, %d low, %d clean.\n", r.Summary.SkillHigh, r.Summary.SkillMedium, r.Summary.SkillLow, r.Summary.SkillClean)
	}

	for _, s := range r.Servers {
		fmt.Fprintf(w, "\n[%s] %s  (%s)\n", strings.ToUpper(string(s.Risk)), s.Name, s.App)
		if s.Scope != "" {
			fmt.Fprintf(w, "  project: %s\n", s.Scope)
		}
		if s.URL != "" {
			fmt.Fprintf(w, "  url:     %s\n", s.URL)
		} else {
			fmt.Fprintf(w, "  runs:    %s\n", strings.TrimSpace(s.Command+" "+strings.Join(s.Args, " ")))
		}
		fmt.Fprintf(w, "  file:    %s\n", s.ConfigPath)
		for _, f := range s.Findings {
			fmt.Fprintf(w, "  - %s: %s\n", strings.ToUpper(string(f.Severity)), f.Title)
			fmt.Fprintf(w, "      %s\n", f.Detail)
			fmt.Fprintf(w, "      Fix: %s\n", f.Fix)
		}
	}
	for _, s := range r.Skills {
		if s.Risk == rules.None {
			continue
		}
		fmt.Fprintf(w, "\n[%s] skill: %s  (%s)\n", strings.ToUpper(string(s.Risk)), s.Name, s.Source)
		fmt.Fprintf(w, "  file:    %s\n", s.Path)
		for _, f := range s.Findings {
			fmt.Fprintf(w, "  - %s: %s\n", strings.ToUpper(string(f.Severity)), f.Title)
			fmt.Fprintf(w, "      %s\n", f.Detail)
			fmt.Fprintf(w, "      Fix: %s\n", f.Fix)
		}
	}
	for _, t := range r.Tools {
		if t.Risk == rules.None {
			continue
		}
		fmt.Fprintf(w, "\n[%s] tool: %s  (server %s)\n", strings.ToUpper(string(t.Risk)), t.Name, t.Server)
		for _, f := range t.Findings {
			fmt.Fprintf(w, "  - %s: %s\n", strings.ToUpper(string(f.Severity)), f.Title)
			fmt.Fprintf(w, "      %s\n", f.Detail)
			fmt.Fprintf(w, "      Fix: %s\n", f.Fix)
		}
	}
	for _, p := range r.ToolProbes {
		if p.Error != "" {
			fmt.Fprintf(w, "\nCould not probe %s: %s\n", p.Server, p.Error)
		}
	}
	for _, c := range r.Configs {
		if c.Error != "" {
			fmt.Fprintf(w, "\nCould not read %s: %s\n", c.Path, c.Error)
		}
	}
	for _, s := range r.SkillDirs {
		if s.Error != "" {
			fmt.Fprintf(w, "\nCould not read skills from %s: %s\n", s.Path, s.Error)
		}
	}
}
