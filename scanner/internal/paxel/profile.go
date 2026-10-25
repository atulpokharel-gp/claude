package paxel

// Builder profiles. Paxel scores each Claude Code session on five dimensions
// of how a developer uses AI coding tools:
//
//   * Steering       — how specifically the developer directs the AI
//   * Execution      — how much the session actually ships
//   * Engineering    — care for tests, lint, refactor shape
//   * ProductInstinct — attention to users: docs, UI, API
//   * Planning       — breaking work down before diving in
//
// The scorer looks at prompts and tool-use metadata on the laptop because
// it has to count signals, but only the final integer scores and small
// counter metrics leave the device. The raw text of a user turn, an
// assistant answer, or a file edited is never written into a bucket, a
// metrics field or an upload.

import (
	"encoding/json"
	"errors"
	"io"
	"os"
	"path/filepath"
	"regexp"
	"sort"
	"strings"
	"time"
)

// The five scored dimensions. Keep these strings stable — they key the
// profile_scores table and the public-profile toggle.
const (
	DimSteering        = "steering"
	DimExecution       = "execution"
	DimEngineering     = "engineering"
	DimProductInstinct = "product-instinct"
	DimPlanning        = "planning"
)

var AllDimensions = []string{DimSteering, DimExecution, DimEngineering, DimProductInstinct, DimPlanning}

// ProfileRow is one developer's score for one dimension on one day for one
// project. Scores are 0-100 integers; metrics is a small bag of counters.
type ProfileRow struct {
	Tool         string         `json:"tool"`
	UserHash     string         `json:"userHash"`
	UserLabel    string         `json:"userLabel,omitempty"`
	ProjectHash  string         `json:"projectHash"`
	ProjectLabel string         `json:"projectLabel,omitempty"`
	Dimension    string         `json:"dimension"`
	Day          string         `json:"day"`
	Score        int            `json:"score"`
	Sessions     int            `json:"sessions"`
	Metrics      map[string]int `json:"metrics,omitempty"`
}

// SessionProfile holds all five dimension scores for one Claude Code
// session, plus the raw counters each dimension used.
type SessionProfile struct {
	Day     string
	Scores  map[string]int
	Metrics map[string]int
	HasData bool
}

// Counters pulled out of a Claude Code JSONL session, before scoring.
type sessionCounts struct {
	day             string
	userTurns       int
	userChars       int
	userFirstChars  int
	correctionTurns int
	todoTurns       int
	outlineTurns    int
	assistantTurns  int
	toolUses        int
	toolReads       int
	toolWrites      int
	toolTests       int
	toolDocsUI      int
	toolAPI         int
	bashTypecheck   int
	bashTest        int
	bashLint        int
	todoWrite       int
	hasAssistant    bool
}

var (
	// A user turn that reads like a correction. We match on short cues only
	// so we don't need the whole message content; the regex is anchored
	// to the first ~80 chars of the turn text.
	reCorrection = regexp.MustCompile(`(?i)\b(no,?|wait|undo|revert|that'?s wrong|that is wrong|not quite|that'?s not|hold on|stop|redo|try again|rollback)\b`)

	// A TODO-ish user turn.
	reTodoList = regexp.MustCompile(`(?m)^\s*(?:[-*]\s*\[[ xX]\]|[0-9]+\.\s|[-*]\s)`)

	// An outline-shaped user turn: "step 1", "first,", "plan:".
	reOutline = regexp.MustCompile(`(?i)(^|\n)\s*(step\s*[0-9]+|first[,:]|then[,:]|finally|plan:|here'?s the plan)`)
)

// We only look at the first N chars of each user turn so the scorer stays
// fast and so prompts past that cap stay unread. 1 KB is plenty for the
// cues we care about.
const maxUserTurnScan = 1024

// extensions for file-shaped tool inputs.
var (
	testFileSuffixes = []string{"_test.go", ".test.ts", ".test.tsx", ".test.js", ".spec.ts", ".spec.tsx", ".spec.js", "_test.py", "_spec.rb"}
	uiExts           = []string{".tsx", ".jsx", ".html", ".css", ".svelte", ".vue"}
	docExts          = []string{".md", ".mdx", ".rst", ".txt"}
	apiExts          = []string{".sql", ".proto", ".graphql", ".openapi.yaml", ".openapi.yml"}
)

// ScoreClaudeCodeJSONL reads one Claude Code session file and returns a
// SessionProfile. It is a thin wrapper around (parseSessionCounts +
// scoreCounts) so tests can drive each half.
func ScoreClaudeCodeJSONL(path string, maxBytes int64) (SessionProfile, error) {
	if maxBytes <= 0 {
		maxBytes = defaultMaxBytes
	}
	c, err := parseSessionCounts(path, maxBytes)
	if err != nil {
		return SessionProfile{}, err
	}
	return scoreCounts(c), nil
}

func parseSessionCounts(path string, maxBytes int64) (sessionCounts, error) {
	f, err := os.Open(path)
	if err != nil {
		return sessionCounts{}, err
	}
	defer f.Close()
	st, err := f.Stat()
	if err != nil {
		return sessionCounts{}, err
	}
	if st.Size() > maxBytes {
		return sessionCounts{}, errors.New("file too large to score")
	}

	type toolUseBlock struct {
		Type  string          `json:"type"`
		Name  string          `json:"name"`
		Input json.RawMessage `json:"input"`
	}
	type msgContent struct {
		// A content block is either a text block {type:"text", text:"..."}
		// or a tool_use {type:"tool_use", name:"...", input:{}}.
		Type  string          `json:"type"`
		Text  string          `json:"text"`
		Name  string          `json:"name"`
		Input json.RawMessage `json:"input"`
	}
	type msg struct {
		Role    string          `json:"role"`
		Content json.RawMessage `json:"content"`
	}
	type line struct {
		Type      string `json:"type"`
		Timestamp string `json:"timestamp"`
		Message   msg    `json:"message"`
	}

	c := sessionCounts{}
	seenUser := 0
	dec := json.NewDecoder(io.LimitReader(f, maxBytes))
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
		if c.day == "" {
			if t, err := time.Parse(time.RFC3339, l.Timestamp); err == nil {
				c.day = t.UTC().Format("2006-01-02")
			}
		}
		switch l.Type {
		case "user":
			text := userText(l.Message.Content)
			if text == "" {
				continue
			}
			c.userTurns++
			if len(text) > maxUserTurnScan {
				text = text[:maxUserTurnScan]
			}
			c.userChars += len(text)
			seenUser++
			if seenUser == 1 {
				c.userFirstChars = len(text)
			}
			if reCorrection.MatchString(text) {
				c.correctionTurns++
			}
			if reTodoList.MatchString(text) {
				c.todoTurns++
			}
			if reOutline.MatchString(text) {
				c.outlineTurns++
			}
		case "assistant":
			c.hasAssistant = true
			c.assistantTurns++
			blocks := assistantBlocks(l.Message.Content)
			for _, b := range blocks {
				if b.Type != "tool_use" {
					continue
				}
				c.toolUses++
				classifyTool(b.Name, b.Input, &c)
			}
		}
	}
	return c, nil
}

func userText(raw json.RawMessage) string {
	// The content can be a plain string or an array of {type:"text",text:...}
	// / {type:"tool_result",...} blocks.
	if len(raw) == 0 {
		return ""
	}
	if raw[0] == '"' {
		var s string
		if err := json.Unmarshal(raw, &s); err != nil {
			return ""
		}
		return s
	}
	type block struct {
		Type    string `json:"type"`
		Text    string `json:"text"`
		Content string `json:"content"`
	}
	var blocks []block
	if err := json.Unmarshal(raw, &blocks); err != nil {
		return ""
	}
	var sb strings.Builder
	for _, b := range blocks {
		if b.Type == "text" {
			sb.WriteString(b.Text)
			sb.WriteString("\n")
		}
		// tool_result content is skipped: it's the tool output, not the
		// developer's own words.
	}
	return sb.String()
}

func assistantBlocks(raw json.RawMessage) []struct {
	Type  string          `json:"type"`
	Name  string          `json:"name"`
	Input json.RawMessage `json:"input"`
} {
	if len(raw) == 0 || raw[0] != '[' {
		return nil
	}
	var out []struct {
		Type  string          `json:"type"`
		Name  string          `json:"name"`
		Input json.RawMessage `json:"input"`
	}
	_ = json.Unmarshal(raw, &out)
	return out
}

func classifyTool(name string, input json.RawMessage, c *sessionCounts) {
	switch name {
	case "Read", "Glob", "Grep":
		c.toolReads++
	case "Edit", "Write", "NotebookEdit", "MultiEdit":
		c.toolWrites++
		for _, p := range extractPaths(input) {
			classifyPath(p, c)
		}
	case "TodoWrite":
		c.todoWrite++
	case "Bash":
		cmd := extractCommand(input)
		if cmd != "" {
			classifyBash(cmd, c)
		}
	}
}

func extractPaths(input json.RawMessage) []string {
	if len(input) == 0 {
		return nil
	}
	type edit struct {
		FilePath string `json:"file_path"`
		Path     string `json:"path"`
	}
	var e edit
	_ = json.Unmarshal(input, &e)
	paths := []string{}
	if e.FilePath != "" {
		paths = append(paths, e.FilePath)
	}
	if e.Path != "" {
		paths = append(paths, e.Path)
	}
	return paths
}

func extractCommand(input json.RawMessage) string {
	if len(input) == 0 {
		return ""
	}
	var b struct {
		Command string `json:"command"`
	}
	_ = json.Unmarshal(input, &b)
	return b.Command
}

func classifyPath(p string, c *sessionCounts) {
	lp := strings.ToLower(p)
	for _, s := range testFileSuffixes {
		if strings.HasSuffix(lp, s) {
			c.toolTests++
			return
		}
	}
	ext := filepath.Ext(lp)
	for _, e := range uiExts {
		if ext == e {
			c.toolDocsUI++
			return
		}
	}
	for _, e := range docExts {
		if ext == e {
			c.toolDocsUI++
			return
		}
	}
	for _, e := range apiExts {
		if ext == e {
			c.toolAPI++
			return
		}
	}
	// A route handler or an API file name heuristic.
	if strings.Contains(lp, "/api/") || strings.Contains(lp, "/routes/") || strings.Contains(lp, "handler") {
		c.toolAPI++
	}
}

func classifyBash(cmd string, c *sessionCounts) {
	l := strings.ToLower(cmd)
	switch {
	case strings.Contains(l, "typecheck"), strings.Contains(l, "tsc "), strings.Contains(l, "mypy"), strings.Contains(l, "pyright"):
		c.bashTypecheck++
	case strings.Contains(l, "pytest"), strings.Contains(l, "go test"), strings.Contains(l, "npm test"), strings.Contains(l, "cargo test"), strings.Contains(l, " test "):
		c.bashTest++
	case strings.Contains(l, "lint"), strings.Contains(l, "eslint"), strings.Contains(l, "ruff"), strings.Contains(l, "golangci"), strings.Contains(l, "gofmt"), strings.Contains(l, "prettier"):
		c.bashLint++
	}
}

// scoreCounts turns a session's counts into a per-dimension 0-100 score
// plus the raw metrics map. The functions are intentionally simple and
// documented — this is a transparent heuristic, not a classifier.
func scoreCounts(c sessionCounts) SessionProfile {
	if !c.hasAssistant {
		return SessionProfile{}
	}
	m := map[string]int{
		"user_turns":       c.userTurns,
		"user_chars":       c.userChars,
		"assistant_turns":  c.assistantTurns,
		"tool_uses":        c.toolUses,
		"tool_writes":      c.toolWrites,
		"tool_reads":       c.toolReads,
		"tool_tests":       c.toolTests,
		"tool_docs_ui":     c.toolDocsUI,
		"tool_api":         c.toolAPI,
		"bash_typecheck":   c.bashTypecheck,
		"bash_test":        c.bashTest,
		"bash_lint":        c.bashLint,
		"corrections":      c.correctionTurns,
		"todo_turns":       c.todoTurns,
		"outline_turns":    c.outlineTurns,
		"todo_write":       c.todoWrite,
		"first_user_chars": c.userFirstChars,
	}
	scores := map[string]int{
		DimSteering:        scoreSteering(c),
		DimExecution:       scoreExecution(c),
		DimEngineering:     scoreEngineering(c),
		DimProductInstinct: scoreProductInstinct(c),
		DimPlanning:        scorePlanning(c),
	}
	return SessionProfile{Day: c.day, Scores: scores, Metrics: m, HasData: true}
}

func scoreSteering(c sessionCounts) int {
	if c.userTurns == 0 {
		return 0
	}
	avgLen := float64(c.userChars) / float64(c.userTurns)
	specificity := clamp01(avgLen / 400) // 400+ chars → full score
	// Prompt-to-tool-use ratio: 1 user turn per 2-3 tool uses reads like
	// "steering, not babysitting". Below 0.1 is drift; above 1.0 is
	// over-asking.
	var ratio float64
	if c.toolUses > 0 {
		ratio = float64(c.userTurns) / float64(c.toolUses)
	} else {
		ratio = 1
	}
	ratioScore := bellCenteredAt(ratio, 0.4, 0.35)
	// Corrections: a few are healthy, many signal unclear direction.
	var corr float64
	if c.userTurns > 0 {
		corr = float64(c.correctionTurns) / float64(c.userTurns)
	}
	corrScore := bellCenteredAt(corr, 0.1, 0.1)
	return pct((specificity*0.5 + ratioScore*0.3 + corrScore*0.2))
}

func scoreExecution(c sessionCounts) int {
	if !c.hasAssistant {
		return 0
	}
	density := clamp01(float64(c.toolUses) / 20) // 20 tool uses → full
	var writeRatio float64
	rw := c.toolReads + c.toolWrites
	if rw > 0 {
		writeRatio = float64(c.toolWrites) / float64(rw)
	}
	writeScore := clamp01(writeRatio / 0.5) // 50% writes → full
	length := clamp01(float64(c.assistantTurns) / 30)
	return pct(density*0.5 + writeScore*0.3 + length*0.2)
}

func scoreEngineering(c sessionCounts) int {
	if c.toolWrites == 0 && c.bashTest+c.bashTypecheck+c.bashLint == 0 {
		return 0
	}
	var testRatio float64
	if c.toolWrites > 0 {
		testRatio = float64(c.toolTests) / float64(c.toolWrites)
	}
	testScore := clamp01(testRatio / 0.25)
	// Each check kind: 1 run → half, 3 runs → full.
	checksScore := clamp01(float64(c.bashTest+c.bashTypecheck+c.bashLint) / 3)
	// Refactor-shape: a session with many edits and no new writes.
	refactor := 0.0
	if c.toolWrites > 5 {
		refactor = clamp01(float64(c.toolWrites) / 15)
	}
	return pct(testScore*0.4 + checksScore*0.4 + refactor*0.2)
}

func scoreProductInstinct(c sessionCounts) int {
	// Count tool writes that look user-facing or API-shaped.
	userFacing := c.toolDocsUI + c.toolAPI
	if userFacing == 0 {
		return 0
	}
	var ratio float64
	if c.toolWrites > 0 {
		ratio = float64(userFacing) / float64(c.toolWrites)
	}
	// Both the ratio and the absolute count matter.
	ratioScore := clamp01(ratio / 0.5)
	absScore := clamp01(float64(userFacing) / 5)
	return pct(ratioScore*0.6 + absScore*0.4)
}

func scorePlanning(c sessionCounts) int {
	// A long first user turn is the clearest planning signal.
	first := clamp01(float64(c.userFirstChars) / 400)
	// TodoWrite tool use.
	tw := clamp01(float64(c.todoWrite) / 2)
	// TODO/outline-shaped user turns.
	var todoRatio float64
	if c.userTurns > 0 {
		todoRatio = float64(c.todoTurns+c.outlineTurns) / float64(c.userTurns)
	}
	todoScore := clamp01(todoRatio / 0.3)
	return pct(first*0.5 + tw*0.3 + todoScore*0.2)
}

func pct(x float64) int {
	n := int(100*x + 0.5)
	if n < 0 {
		return 0
	}
	if n > 100 {
		return 100
	}
	return n
}

func clamp01(x float64) float64 {
	if x < 0 {
		return 0
	}
	if x > 1 {
		return 1
	}
	return x
}

// bellCenteredAt returns 1 at center and falls to 0 at center ± 3*width.
func bellCenteredAt(x, center, width float64) float64 {
	if width <= 0 {
		return 0
	}
	d := (x - center) / width
	v := 1 - d*d/9 // simple quadratic bell; cheap and bounded
	return clamp01(v)
}

// CollectProfiles walks the same Claude Code project tree Collect uses and
// returns per-(user, project, dimension, day) profile rows.
func CollectProfiles(env Env) ([]ProfileRow, []string) {
	if env.Now == nil {
		env.Now = func() time.Time { return time.Now().UTC() }
	}
	if env.MaxBytesPerFile <= 0 {
		env.MaxBytesPerFile = defaultMaxBytes
	}
	userHash := hashUser(env.Username, env.Hostname)
	userLabel := shortLabel(env.Username)
	type key struct {
		project, dim, day string
	}
	agg := map[key]*ProfileRow{}
	var diag []string

	root := filepath.Join(env.Home, ".claude", "projects")
	entries, err := os.ReadDir(root)
	if err != nil {
		if !os.IsNotExist(err) {
			diag = append(diag, "cannot read "+root+": "+err.Error())
		}
		return nil, diag
	}
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
			p, err := ScoreClaudeCodeJSONL(filepath.Join(projDir, f.Name()), env.MaxBytesPerFile)
			if err != nil {
				diag = append(diag, filepath.Join(projDir, f.Name())+": "+err.Error())
				continue
			}
			if !p.HasData || p.Day == "" {
				continue
			}
			for _, dim := range AllDimensions {
				k := key{projHash, dim, p.Day}
				row, ok := agg[k]
				if !ok {
					row = &ProfileRow{
						Tool:         ToolClaudeCode,
						UserHash:     userHash,
						UserLabel:    userLabel,
						ProjectHash:  projHash,
						ProjectLabel: projLabel,
						Dimension:    dim,
						Day:          p.Day,
						Metrics:      map[string]int{},
					}
					agg[k] = row
				}
				// Running mean, weighted by sessions so a developer who runs
				// several short sessions on one day gets one blended score.
				row.Score = runningMean(row.Score, row.Sessions, p.Scores[dim])
				// Metric counters sum.
				for mk, mv := range p.Metrics {
					row.Metrics[mk] += mv
				}
				row.Sessions++
			}
		}
	}

	out := make([]ProfileRow, 0, len(agg))
	for _, r := range agg {
		out = append(out, *r)
	}
	sort.Slice(out, func(i, j int) bool {
		if out[i].Day != out[j].Day {
			return out[i].Day > out[j].Day
		}
		if out[i].Dimension != out[j].Dimension {
			return out[i].Dimension < out[j].Dimension
		}
		return out[i].ProjectLabel < out[j].ProjectLabel
	})
	return out, diag
}

func runningMean(prev, prevN, next int) int {
	if prevN == 0 {
		return next
	}
	return (prev*prevN + next) / (prevN + 1)
}
