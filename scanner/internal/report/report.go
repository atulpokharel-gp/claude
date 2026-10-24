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
)

// SchemaVersion changes when the JSON shape changes in a breaking way.
const SchemaVersion = 1

// Redacted replaces any argument that looks like a credential.
const Redacted = "[REDACTED]"

// Report is the full result of one scan of one computer.
type Report struct {
	SchemaVersion  int                     `json:"schemaVersion"`
	ScannerVersion string                  `json:"scannerVersion"`
	Hostname       string                  `json:"hostname"`
	OS             string                  `json:"os"`
	ScannedAt      time.Time               `json:"scannedAt"`
	Summary        Summary                 `json:"summary"`
	Servers        []ServerResult          `json:"servers"`
	Configs        []discover.ConfigResult `json:"configs"`
}

// Summary counts servers by their worst finding.
type Summary struct {
	Servers int `json:"servers"`
	High    int `json:"high"`
	Medium  int `json:"medium"`
	Low     int `json:"low"`
	Clean   int `json:"clean"`
}

// ServerResult is one server with its findings and overall risk.
type ServerResult struct {
	discover.Server
	Risk     rules.Severity  `json:"risk"`
	Findings []rules.Finding `json:"findings"`
}

// Build checks every server and assembles the report.
// Secret-looking arguments are redacted here so nothing downstream sees them.
func Build(servers []discover.Server, configs []discover.ConfigResult, ctx rules.Context, meta Report) Report {
	r := meta
	r.SchemaVersion = SchemaVersion
	r.Configs = configs
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
	for _, c := range r.Configs {
		if c.Error != "" {
			fmt.Fprintf(w, "\nCould not read %s: %s\n", c.Path, c.Error)
		}
	}
}
