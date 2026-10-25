// Package paxel reads local AI coding tool session logs and aggregates
// per-day token usage so the console can show how AI coding is used across
// a team.
//
// Only numbers and labels leave the laptop: tool name, model name, project
// folder name, hashed OS user, hashed project path, token counts, cost.
// Prompts and generated code are never read past the fields paxel pulls out
// of each JSONL message (which are counters, model name and timestamps).
package paxel

import (
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"io"
	"os"
	"path/filepath"
	"sort"
	"strings"
	"time"
)

// Tool names used in uploads. Keep these in sync with console/lib/paxel.ts.
const (
	ToolClaudeCode = "claude-code"
	ToolCodex      = "codex"
)

// Bucket is one day's usage for one (tool, user, project, model, session).
type Bucket struct {
	Tool             string `json:"tool"`
	UserHash         string `json:"userHash"`
	UserLabel        string `json:"userLabel,omitempty"`
	ProjectHash      string `json:"projectHash"`
	ProjectLabel     string `json:"projectLabel,omitempty"`
	Model            string `json:"model,omitempty"`
	SessionID        string `json:"sessionId,omitempty"`
	Day              string `json:"day"`
	InputTokens      int64  `json:"inputTokens"`
	OutputTokens     int64  `json:"outputTokens"`
	CacheReadTokens  int64  `json:"cacheReadTokens,omitempty"`
	CacheWriteTokens int64  `json:"cacheWriteTokens,omitempty"`
	CostUsdCents     int64  `json:"costUsdCents,omitempty"`
	Messages         int    `json:"messages"`
}

// Report is what we POST to the console.
type Report struct {
	Hostname    string          `json:"hostname"`
	OS          string          `json:"os,omitempty"`
	ScannerVer  string          `json:"scannerVersion,omitempty"`
	ScannedAt   string          `json:"scannedAt,omitempty"`
	Buckets     []Bucket        `json:"buckets"`
	Profiles    []ProfileRow    `json:"profiles,omitempty"`
	Claim       *ClaimForUpload `json:"claim,omitempty"`
	Diagnostics []string        `json:"diagnostics,omitempty"`
}

// Env is the input to Collect: where to look.
type Env struct {
	Home     string // the user's home folder
	GOOS     string // runtime.GOOS, so tests can pin it
	Username string // OS user name; mixed with hostname into user_hash
	Hostname string // the device's hostname

	// MaxBytesPerFile caps how much of one JSONL we read. 0 means default.
	MaxBytesPerFile int64

	// Now returns the current time; tests override.
	Now func() time.Time
}

const defaultMaxBytes = 32 * 1024 * 1024 // 32 MB per JSONL

// Collect walks the local AI tool session logs and returns one bucket per
// (tool, user, project, model, session, day). Diagnostics (as human-readable
// strings) list files that couldn't be parsed. Collect never fails hard on
// an unreadable file — the goal is best-effort reporting.
func Collect(env Env) (Report, error) {
	if env.Now == nil {
		env.Now = func() time.Time { return time.Now().UTC() }
	}
	if env.MaxBytesPerFile <= 0 {
		env.MaxBytesPerFile = defaultMaxBytes
	}
	userHash := hashUser(env.Username, env.Hostname)
	userLabel := shortLabel(env.Username)
	key := func(b Bucket) string {
		return strings.Join([]string{b.Tool, b.ProjectHash, b.Model, b.SessionID, b.Day}, "|")
	}
	buckets := map[string]*Bucket{}
	diag := []string{}

	add := func(nb Bucket) {
		nb.UserHash = userHash
		nb.UserLabel = userLabel
		k := key(nb)
		if existing, ok := buckets[k]; ok {
			existing.InputTokens += nb.InputTokens
			existing.OutputTokens += nb.OutputTokens
			existing.CacheReadTokens += nb.CacheReadTokens
			existing.CacheWriteTokens += nb.CacheWriteTokens
			existing.CostUsdCents += nb.CostUsdCents
			existing.Messages += nb.Messages
			return
		}
		b := nb // copy
		buckets[k] = &b
	}

	// Claude Code: ~/.claude/projects/<slug>/<session>.jsonl
	root := filepath.Join(env.Home, ".claude", "projects")
	if entries, err := os.ReadDir(root); err == nil {
		for _, e := range entries {
			if !e.IsDir() {
				continue
			}
			projDir := filepath.Join(root, e.Name())
			projLabel, projHash := projectLabelHash(e.Name())
			files, err := os.ReadDir(projDir)
			if err != nil {
				diag = append(diag, "cannot read "+projDir+": "+err.Error())
				continue
			}
			for _, f := range files {
				if f.IsDir() || !strings.HasSuffix(f.Name(), ".jsonl") {
					continue
				}
				path := filepath.Join(projDir, f.Name())
				sessionID := strings.TrimSuffix(f.Name(), ".jsonl")
				if len(sessionID) > 80 {
					sessionID = sessionID[:80]
				}
				bs, err := parseClaudeCodeJSONL(path, env.MaxBytesPerFile)
				if err != nil {
					diag = append(diag, path+": "+err.Error())
					continue
				}
				for _, b := range bs {
					b.Tool = ToolClaudeCode
					b.ProjectHash = projHash
					b.ProjectLabel = projLabel
					b.SessionID = sessionID
					add(b)
				}
			}
		}
	} else if !os.IsNotExist(err) {
		diag = append(diag, "cannot read "+root+": "+err.Error())
	}

	// Codex: ~/.codex/sessions/**/*.jsonl (one session per file).
	codexRoot := filepath.Join(env.Home, ".codex", "sessions")
	_ = filepath.Walk(codexRoot, func(path string, info os.FileInfo, err error) error {
		if err != nil {
			if os.IsNotExist(err) {
				return filepath.SkipDir
			}
			return nil
		}
		if info.IsDir() || !strings.HasSuffix(path, ".jsonl") {
			return nil
		}
		bs, err := parseCodexJSONL(path, env.MaxBytesPerFile)
		if err != nil {
			diag = append(diag, path+": "+err.Error())
			return nil
		}
		for _, b := range bs {
			add(b)
		}
		return nil
	})

	out := make([]Bucket, 0, len(buckets))
	for _, b := range buckets {
		b.CostUsdCents = costCents(b.Model, b.InputTokens, b.OutputTokens, b.CacheReadTokens, b.CacheWriteTokens)
		out = append(out, *b)
	}
	sort.Slice(out, func(i, j int) bool {
		if out[i].Day != out[j].Day {
			return out[i].Day > out[j].Day
		}
		if out[i].Tool != out[j].Tool {
			return out[i].Tool < out[j].Tool
		}
		return out[i].ProjectLabel < out[j].ProjectLabel
	})
	return Report{Buckets: out, Diagnostics: diag}, nil
}

// hashUser gives a stable per-device-per-user id. We also mix in the
// hostname so a user name shared across devices (like "admin") does not
// collapse into one row.
func hashUser(username, hostname string) string {
	if username == "" {
		username = "unknown"
	}
	h := sha256.Sum256([]byte("paxel-user\x00" + username + "\x00" + hostname))
	return hex.EncodeToString(h[:16]) // 32 hex chars
}

func shortLabel(s string) string {
	s = strings.TrimSpace(s)
	if len(s) > 120 {
		s = s[:120]
	}
	return s
}

// projectLabelHash turns a Claude Code project folder name (which is the
// slugified cwd — "/Users/alice/code/foo" becomes "-Users-alice-code-foo")
// into a short display label (the basename "foo") and a stable hash of the
// underlying path.
func projectLabelHash(slug string) (label, hash string) {
	// Claude Code's slug keeps the leading separator as "-" (so an absolute
	// path begins with "-"). Trim a single leading dash and split on "-".
	s := strings.TrimPrefix(slug, "-")
	parts := strings.Split(s, "-")
	// Pick the last non-empty part as the label.
	for i := len(parts) - 1; i >= 0; i-- {
		if parts[i] != "" {
			label = parts[i]
			break
		}
	}
	if label == "" {
		label = slug
	}
	if len(label) > 120 {
		label = label[:120]
	}
	h := sha256.Sum256([]byte("paxel-project\x00" + slug))
	return label, hex.EncodeToString(h[:16])
}

// parseClaudeCodeJSONL reads one Claude Code session JSONL file and returns
// per-(model, day) buckets. We skim only the fields we need and tolerate
// unknown fields.
func parseClaudeCodeJSONL(path string, maxBytes int64) ([]Bucket, error) {
	f, err := os.Open(path)
	if err != nil {
		return nil, err
	}
	defer f.Close()
	st, err := f.Stat()
	if err != nil {
		return nil, err
	}
	if st.Size() > maxBytes {
		return nil, errors.New("file too large to read")
	}
	type usage struct {
		Input      int64 `json:"input_tokens"`
		Output     int64 `json:"output_tokens"`
		CacheWrite int64 `json:"cache_creation_input_tokens"`
		CacheRead  int64 `json:"cache_read_input_tokens"`
	}
	type msg struct {
		Model string `json:"model"`
		Usage usage  `json:"usage"`
	}
	type line struct {
		Type      string `json:"type"`
		Timestamp string `json:"timestamp"`
		Message   msg    `json:"message"`
	}
	// A JSONL can have very long lines; use json.Decoder which handles that.
	dec := json.NewDecoder(io.LimitReader(f, maxBytes))
	byKey := map[string]*Bucket{}
	for {
		var l line
		if err := dec.Decode(&l); err != nil {
			if errors.Is(err, io.EOF) {
				break
			}
			// A single bad line should not kill the whole file: try to
			// resync by reading past the next newline.
			if _, skipErr := dec.Token(); skipErr != nil {
				break
			}
			continue
		}
		if l.Type != "assistant" {
			continue
		}
		if l.Message.Usage.Input+l.Message.Usage.Output+l.Message.Usage.CacheRead+l.Message.Usage.CacheWrite == 0 {
			continue
		}
		t, err := time.Parse(time.RFC3339, l.Timestamp)
		if err != nil {
			continue
		}
		day := t.UTC().Format("2006-01-02")
		k := day + "|" + l.Message.Model
		b, ok := byKey[k]
		if !ok {
			b = &Bucket{Day: day, Model: l.Message.Model}
			byKey[k] = b
		}
		b.InputTokens += l.Message.Usage.Input
		b.OutputTokens += l.Message.Usage.Output
		b.CacheReadTokens += l.Message.Usage.CacheRead
		b.CacheWriteTokens += l.Message.Usage.CacheWrite
		b.Messages++
	}
	out := make([]Bucket, 0, len(byKey))
	for _, b := range byKey {
		out = append(out, *b)
	}
	return out, nil
}

// parseCodexJSONL reads one Codex (OpenAI codex) session file. Codex records
// each turn with a `response.completed` event carrying usage. The
// implementation here is tolerant: any JSONL line with an input/output
// token count attached to a known shape is counted.
func parseCodexJSONL(path string, maxBytes int64) ([]Bucket, error) {
	f, err := os.Open(path)
	if err != nil {
		return nil, err
	}
	defer f.Close()
	st, err := f.Stat()
	if err != nil {
		return nil, err
	}
	if st.Size() > maxBytes {
		return nil, errors.New("file too large to read")
	}
	type usage struct {
		Input        int64 `json:"input_tokens"`
		Output       int64 `json:"output_tokens"`
		CacheRead    int64 `json:"input_cached_tokens"`
		ReasoningOut int64 `json:"reasoning_output_tokens"`
	}
	type payload struct {
		Model string `json:"model"`
		Usage usage  `json:"usage"`
		Cwd   string `json:"cwd"`
	}
	type line struct {
		Timestamp string  `json:"timestamp"`
		Type      string  `json:"type"`
		Session   string  `json:"session_id"`
		Payload   payload `json:"payload"`
		// Some older codex builds nest fields at top level.
		TopUsage *usage `json:"usage,omitempty"`
		TopModel string `json:"model,omitempty"`
		TopCwd   string `json:"cwd,omitempty"`
	}
	dec := json.NewDecoder(io.LimitReader(f, maxBytes))
	byKey := map[string]*Bucket{}
	sessionID := strings.TrimSuffix(filepath.Base(path), ".jsonl")
	if len(sessionID) > 80 {
		sessionID = sessionID[:80]
	}
	for {
		var l line
		if err := dec.Decode(&l); err != nil {
			if errors.Is(err, io.EOF) {
				break
			}
			if _, skipErr := dec.Token(); skipErr != nil {
				break
			}
			continue
		}
		u := l.Payload.Usage
		if l.TopUsage != nil {
			u = *l.TopUsage
		}
		if u.Input+u.Output+u.CacheRead+u.ReasoningOut == 0 {
			continue
		}
		model := l.Payload.Model
		if model == "" {
			model = l.TopModel
		}
		cwd := l.Payload.Cwd
		if cwd == "" {
			cwd = l.TopCwd
		}
		t, err := time.Parse(time.RFC3339, l.Timestamp)
		if err != nil {
			continue
		}
		day := t.UTC().Format("2006-01-02")
		projLabel, projHash := codexProjectLabelHash(cwd, path)
		sid := l.Session
		if sid == "" {
			sid = sessionID
		}
		if len(sid) > 80 {
			sid = sid[:80]
		}
		k := day + "|" + model + "|" + projHash + "|" + sid
		b, ok := byKey[k]
		if !ok {
			b = &Bucket{
				Tool:         ToolCodex,
				Day:          day,
				Model:        model,
				SessionID:    sid,
				ProjectHash:  projHash,
				ProjectLabel: projLabel,
			}
			byKey[k] = b
		}
		b.InputTokens += u.Input
		b.OutputTokens += u.Output + u.ReasoningOut
		b.CacheReadTokens += u.CacheRead
		b.Messages++
	}
	out := make([]Bucket, 0, len(byKey))
	for _, b := range byKey {
		out = append(out, *b)
	}
	return out, nil
}

func codexProjectLabelHash(cwd, filePath string) (label, hash string) {
	key := cwd
	if key == "" {
		// Fall back to the parent folder name of the session file.
		key = filepath.Base(filepath.Dir(filePath))
	}
	label = filepath.Base(key)
	if label == "" || label == "." || label == "/" {
		label = "unknown"
	}
	if len(label) > 120 {
		label = label[:120]
	}
	h := sha256.Sum256([]byte("paxel-project\x00" + key))
	return label, hex.EncodeToString(h[:16])
}

// costCents returns a rough USD-cents cost for the given usage, using a
// small built-in price table of per-million-token prices for well-known
// models. Unknown models get 0.
func costCents(model string, in, out, cacheRead, cacheWrite int64) int64 {
	p, ok := priceFor(model)
	if !ok {
		return 0
	}
	// All prices expressed as cents per million tokens.
	cents := float64(in)*p.InPer1M/1_000_000 +
		float64(out)*p.OutPer1M/1_000_000 +
		float64(cacheRead)*p.CacheReadPer1M/1_000_000 +
		float64(cacheWrite)*p.CacheWritePer1M/1_000_000
	if cents < 0 {
		return 0
	}
	return int64(cents + 0.5)
}

type priceCents struct {
	InPer1M         float64
	OutPer1M        float64
	CacheReadPer1M  float64
	CacheWritePer1M float64
}

func priceFor(model string) (priceCents, bool) {
	m := strings.ToLower(model)
	// Anthropic Claude families. $/M → cents/M = $ * 100.
	switch {
	case strings.Contains(m, "opus"):
		return priceCents{InPer1M: 1500, OutPer1M: 7500, CacheReadPer1M: 150, CacheWritePer1M: 1875}, true
	case strings.Contains(m, "sonnet"):
		return priceCents{InPer1M: 300, OutPer1M: 1500, CacheReadPer1M: 30, CacheWritePer1M: 375}, true
	case strings.Contains(m, "haiku"):
		return priceCents{InPer1M: 100, OutPer1M: 500, CacheReadPer1M: 10, CacheWritePer1M: 125}, true
	case strings.Contains(m, "fable"):
		return priceCents{InPer1M: 150, OutPer1M: 1200, CacheReadPer1M: 15, CacheWritePer1M: 187}, true
	// OpenAI families.
	case strings.Contains(m, "gpt-5"):
		return priceCents{InPer1M: 125, OutPer1M: 1000}, true
	case strings.Contains(m, "gpt-4o"), strings.Contains(m, "o4-mini"):
		return priceCents{InPer1M: 500, OutPer1M: 1500}, true
	case strings.Contains(m, "gpt-4"):
		return priceCents{InPer1M: 300, OutPer1M: 1200}, true
	}
	return priceCents{}, false
}
