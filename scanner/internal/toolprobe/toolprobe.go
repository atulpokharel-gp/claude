// Package toolprobe starts a discovered MCP stdio server in a subprocess,
// speaks the minimum MCP JSON-RPC subset needed to list its tools, then
// kills the subprocess. It is only wired up behind an explicit --probe-tools
// flag because, unlike the rest of the scanner, probing executes the user's
// configured servers.
//
// Only stdio transports are probed from here. Remote transports (URL-based)
// stay out of scope — reaching those from the scanner would make outbound
// requests to third-party endpoints just by running `zinloop`, which the
// read-only posture of the config scan avoids.
package toolprobe

import (
	"bufio"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"os"
	"os/exec"
	"strings"
	"time"

	"github.com/atulpokharel-gp/claude/scanner/internal/discover"
)

// maxToolReply caps the bytes the probe will read from one JSON-RPC reply.
// A hostile server could otherwise stream unbounded output to exhaust memory.
const maxToolReply = 1 << 20 // 1 MiB

// DefaultTimeout is how long one server has to start, initialize and list
// its tools before the probe gives up and kills it.
const DefaultTimeout = 5 * time.Second

// Tool is one entry from an MCP server's tools/list reply.
// Fields are the ones the rules read; nothing else is kept.
type Tool struct {
	Name        string `json:"name"`
	Description string `json:"description"`
}

// Result is the outcome of probing one server.
type Result struct {
	Server string `json:"server"` // the server's config name
	Tools  []Tool `json:"tools,omitempty"`
	// Error is set when the probe could not list the tools. The server
	// itself may still be fine; the probe does not treat probe failures
	// as findings.
	Error string `json:"error,omitempty"`
}

// Options tune one Probe call. A zero Timeout means DefaultTimeout.
type Options struct {
	Timeout time.Duration
	// Env overrides the inherited environment for the subprocess. The caller
	// is responsible for mixing the server's own Env in. An empty slice
	// means the subprocess inherits the current process's environment.
	Env []string
}

// Probe launches one stdio MCP server from its discovered config, speaks
// the init + tools/list handshake, and returns the tools it advertises.
// The subprocess is always killed before Probe returns, success or not.
//
// Remote servers (s.URL != "") return a zero Result with no error so the
// caller can skip them cleanly.
func Probe(ctx context.Context, s discover.Server, opts Options) Result {
	r := Result{Server: s.Name}
	if s.Transport != "stdio" || s.Command == "" {
		return r
	}
	timeout := opts.Timeout
	if timeout <= 0 {
		timeout = DefaultTimeout
	}
	cctx, cancel := context.WithTimeout(ctx, timeout)
	defer cancel()

	cmd := exec.CommandContext(cctx, s.Command, s.Args...)
	cmd.Env = combineEnv(opts.Env, s.Env)
	stdin, err := cmd.StdinPipe()
	if err != nil {
		r.Error = "open stdin: " + err.Error()
		return r
	}
	stdout, err := cmd.StdoutPipe()
	if err != nil {
		r.Error = "open stdout: " + err.Error()
		return r
	}
	// Keep stderr out of the probe's logs; a chatty server would otherwise
	// drown the scanner's output.
	cmd.Stderr = io.Discard
	if err := cmd.Start(); err != nil {
		r.Error = "start: " + err.Error()
		return r
	}
	// Make sure the subprocess is reaped on every return path.
	defer func() {
		_ = stdin.Close()
		// Prefer a graceful close via EOF on stdin; cctx timeout will kill
		// the process if it refuses to exit on its own.
		_ = cmd.Wait()
	}()

	br := bufio.NewReaderSize(stdout, 4096)
	// initialize
	if err := writeJSON(stdin, map[string]any{
		"jsonrpc": "2.0",
		"id":      1,
		"method":  "initialize",
		"params": map[string]any{
			"protocolVersion": "2024-11-05",
			"capabilities":    map[string]any{},
			"clientInfo":      map[string]any{"name": "zinloop-probe", "version": "1"},
		},
	}); err != nil {
		r.Error = "write initialize: " + err.Error()
		return r
	}
	if err := readResponse(br, 1); err != nil {
		r.Error = "initialize: " + err.Error()
		return r
	}
	// notifications/initialized is required by the spec before further calls.
	if err := writeJSON(stdin, map[string]any{
		"jsonrpc": "2.0",
		"method":  "notifications/initialized",
	}); err != nil {
		r.Error = "write initialized: " + err.Error()
		return r
	}
	// tools/list
	if err := writeJSON(stdin, map[string]any{
		"jsonrpc": "2.0",
		"id":      2,
		"method":  "tools/list",
	}); err != nil {
		r.Error = "write tools/list: " + err.Error()
		return r
	}
	raw, err := readRawResponse(br, 2)
	if err != nil {
		r.Error = "tools/list: " + err.Error()
		return r
	}
	tools, err := parseTools(raw)
	if err != nil {
		r.Error = "parse tools: " + err.Error()
		return r
	}
	r.Tools = tools
	return r
}

// writeJSON sends one line-delimited JSON-RPC message.
func writeJSON(w io.Writer, msg any) error {
	data, err := json.Marshal(msg)
	if err != nil {
		return err
	}
	data = append(data, '\n')
	_, err = w.Write(data)
	return err
}

// readResponse drops the result for one id. Used for messages whose payload
// the probe doesn't need to inspect (initialize's reply).
func readResponse(br *bufio.Reader, wantID int) error {
	_, err := readRawResponse(br, wantID)
	return err
}

// readRawResponse reads line-delimited JSON until it sees a response whose
// id matches wantID, skipping unrelated notifications. Returns the raw
// bytes of that response so the caller can decode the shape it expects.
func readRawResponse(br *bufio.Reader, wantID int) ([]byte, error) {
	for {
		line, err := readLine(br)
		if err != nil {
			return nil, err
		}
		if len(line) == 0 {
			continue
		}
		var head struct {
			ID    *json.Number    `json:"id"`
			Error json.RawMessage `json:"error"`
		}
		if err := json.Unmarshal(line, &head); err != nil {
			return nil, fmt.Errorf("invalid JSON: %w", err)
		}
		if head.ID == nil {
			continue // notification, keep reading
		}
		id, err := head.ID.Int64()
		if err != nil || int(id) != wantID {
			continue
		}
		if len(head.Error) > 0 && string(head.Error) != "null" {
			return nil, fmt.Errorf("rpc error: %s", string(head.Error))
		}
		return line, nil
	}
}

// readLine returns one newline-delimited JSON message, capped at
// maxToolReply bytes so a hostile server can't exhaust memory.
func readLine(br *bufio.Reader) ([]byte, error) {
	var buf []byte
	for {
		chunk, isPrefix, err := br.ReadLine()
		if err != nil {
			if errors.Is(err, io.EOF) && len(buf) > 0 {
				return buf, nil
			}
			return nil, err
		}
		if len(buf)+len(chunk) > maxToolReply {
			return nil, errors.New("reply exceeds size limit")
		}
		buf = append(buf, chunk...)
		if !isPrefix {
			return buf, nil
		}
	}
}

func parseTools(raw []byte) ([]Tool, error) {
	var reply struct {
		Result struct {
			Tools []Tool `json:"tools"`
		} `json:"result"`
	}
	if err := json.Unmarshal(raw, &reply); err != nil {
		return nil, err
	}
	return reply.Result.Tools, nil
}

// combineEnv builds the subprocess environment. If override is non-nil, it
// replaces the inherited environment (same contract as exec.Cmd.Env); the
// server's own env map is layered on last.
func combineEnv(override []string, serverEnv map[string]string) []string {
	var base []string
	switch {
	case override != nil:
		base = append(base, override...)
	default:
		base = append(base, os.Environ()...)
	}
	for k, v := range serverEnv {
		base = append(base, k+"="+v)
	}
	return base
}

// ProbeAll runs Probe on every server whose transport is stdio, in the
// order given. A per-server error is recorded in the result rather than
// aborting the batch, so one broken server does not hide findings from
// the rest.
func ProbeAll(ctx context.Context, servers []discover.Server, opts Options) []Result {
	var out []Result
	for _, s := range servers {
		if s.Disabled || s.Transport != "stdio" || s.Command == "" {
			continue
		}
		// Only probe when the server command is a sensible-looking path or
		// package runner; refuse to probe shell wrappers whose single arg
		// is a free-form script. The config-time SHELL_ACCESS rule already
		// flags these; probing them means executing them.
		if looksUnsafeToProbe(s) {
			out = append(out, Result{Server: s.Name, Error: "refused: command runs a free-form shell script"})
			continue
		}
		out = append(out, Probe(ctx, s, opts))
	}
	return out
}

// looksUnsafeToProbe refuses to launch things like `bash -c '…'` whose body
// is arbitrary shell. A regular stdio MCP server is launched by invoking a
// program; a shell wrapper means the config already asked us to run
// something we have no insight into.
func looksUnsafeToProbe(s discover.Server) bool {
	base := strings.ToLower(baseName(s.Command))
	base = strings.TrimSuffix(base, ".exe")
	switch base {
	case "bash", "sh", "zsh", "cmd", "powershell", "pwsh":
		return true
	}
	return false
}

func baseName(p string) string {
	if i := strings.LastIndexAny(p, `/\`); i >= 0 {
		return p[i+1:]
	}
	return p
}
