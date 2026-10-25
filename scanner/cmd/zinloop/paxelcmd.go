package main

import (
	"encoding/json"
	"flag"
	"fmt"
	"io"
	"os"
	"os/user"
	"runtime"
	"strings"
	"time"

	"github.com/atulpokharel-gp/claude/scanner/internal/paxel"
)

// runPaxel reads this laptop's AI coding tool session logs and either prints
// the aggregated usage as JSON or uploads it to the Zinloop console at
// /api/paxel/usage. Nothing destructive; nothing is read except each tool's
// own session logs.
func runPaxel(args []string, stdout, stderr io.Writer) int {
	fs := flag.NewFlagSet("zinloop paxel", flag.ContinueOnError)
	fs.SetOutput(stderr)
	home := fs.String("home", "", "home directory to read (default: current user's)")
	asJSON := fs.Bool("json", false, "print the Paxel upload as JSON instead of a human summary")
	out := fs.String("out", "", "also write the Paxel upload JSON to this file")
	uploadURL := fs.String("upload", "", "send the Paxel upload to the console at this URL (token from "+TokenEnv+" or --token-file)")
	tokenFile := fs.String("token-file", "", "file holding the console upload token")
	if err := fs.Parse(args); err != nil {
		return 1
	}

	h := *home
	if h == "" {
		var err error
		h, err = os.UserHomeDir()
		if err != nil {
			fmt.Fprintln(stderr, "cannot find home directory:", err)
			return 1
		}
	}
	username := ""
	if u, err := user.Current(); err == nil {
		username = u.Username
		// Windows prefixes with DOMAIN\, trim it for a friendlier label.
		if i := strings.LastIndexAny(username, "\\/"); i >= 0 {
			username = username[i+1:]
		}
	}
	host, _ := os.Hostname()

	var token string
	if *uploadURL != "" {
		if _, err := checkUploadURL(*uploadURL); err != nil {
			fmt.Fprintln(stderr, err)
			return 1
		}
		t, err := uploadToken(*tokenFile)
		if err != nil {
			fmt.Fprintln(stderr, err)
			return 1
		}
		token = t
	}

	env := paxel.Env{
		Home:     h,
		GOOS:     runtime.GOOS,
		Username: username,
		Hostname: host,
		Now:      func() time.Time { return time.Now().UTC() },
	}
	rep, err := paxel.Collect(env)
	if err != nil {
		fmt.Fprintln(stderr, "paxel: collect failed:", err)
		return 1
	}
	profiles, profDiag := paxel.CollectProfiles(env)
	rep.Profiles = profiles
	rep.Diagnostics = append(rep.Diagnostics, profDiag...)
	rep.Hostname = host
	rep.OS = runtime.GOOS
	rep.ScannerVer = version
	rep.ScannedAt = time.Now().UTC().Format(time.RFC3339)

	if *out != "" {
		b, _ := json.MarshalIndent(rep, "", "  ")
		if err := os.WriteFile(*out, b, 0o600); err != nil {
			fmt.Fprintln(stderr, "cannot write", *out, err)
			return 1
		}
	}

	if *asJSON {
		enc := json.NewEncoder(stdout)
		enc.SetIndent("", "  ")
		_ = enc.Encode(rep)
	} else {
		printPaxelSummary(stdout, rep)
		printProfileSummary(stdout, rep)
	}

	if *uploadURL != "" {
		if err := upload(*uploadURL, token, rep); err != nil {
			fmt.Fprintln(stderr, "upload failed:", err)
			return 1
		}
		fmt.Fprintln(stdout, "uploaded", len(rep.Buckets), "buckets to", *uploadURL)
	}
	return 0
}

func printPaxelSummary(out io.Writer, r paxel.Report) {
	if len(r.Buckets) == 0 {
		fmt.Fprintln(out, "paxel: no AI coding session logs found")
		if len(r.Diagnostics) > 0 {
			fmt.Fprintln(out, "notes:")
			for _, d := range r.Diagnostics {
				fmt.Fprintln(out, "  -", d)
			}
		}
		return
	}
	totals := struct {
		In, Out, CacheR, CacheW int64
		Messages                int
		Cost                    int64
	}{}
	toolTotal := map[string]int64{}
	projTotal := map[string]int64{}
	modelTotal := map[string]int64{}
	for _, b := range r.Buckets {
		totals.In += b.InputTokens
		totals.Out += b.OutputTokens
		totals.CacheR += b.CacheReadTokens
		totals.CacheW += b.CacheWriteTokens
		totals.Messages += b.Messages
		totals.Cost += b.CostUsdCents
		all := b.InputTokens + b.OutputTokens + b.CacheReadTokens + b.CacheWriteTokens
		toolTotal[b.Tool] += all
		if b.ProjectLabel != "" {
			projTotal[b.ProjectLabel] += all
		}
		if b.Model != "" {
			modelTotal[b.Model] += all
		}
	}
	fmt.Fprintf(out, "paxel: %d sessions · %d messages · %s tokens · $%.2f\n",
		len(r.Buckets), totals.Messages, humanTokens(totals.In+totals.Out+totals.CacheR+totals.CacheW),
		float64(totals.Cost)/100)
	fmt.Fprintln(out, "  by tool:")
	for name, n := range toolTotal {
		fmt.Fprintf(out, "    %-14s %s\n", name, humanTokens(n))
	}
	if len(projTotal) > 0 {
		fmt.Fprintln(out, "  top projects:")
		for _, e := range topN(projTotal, 5) {
			fmt.Fprintf(out, "    %-30s %s\n", e.K, humanTokens(e.V))
		}
	}
	if len(modelTotal) > 0 {
		fmt.Fprintln(out, "  by model:")
		for _, e := range topN(modelTotal, 5) {
			fmt.Fprintf(out, "    %-30s %s\n", e.K, humanTokens(e.V))
		}
	}
	if len(r.Diagnostics) > 0 {
		fmt.Fprintln(out, "  notes:")
		for _, d := range r.Diagnostics {
			fmt.Fprintln(out, "    -", d)
		}
	}
}

func printProfileSummary(out io.Writer, r paxel.Report) {
	if len(r.Profiles) == 0 {
		return
	}
	// Average each dimension over whatever rows are present.
	avg := map[string]int{}
	count := map[string]int{}
	for _, p := range r.Profiles {
		avg[p.Dimension] += p.Score
		count[p.Dimension]++
	}
	fmt.Fprintln(out, "  builder profile (0-100, averaged across sessions):")
	for _, dim := range paxel.AllDimensions {
		if count[dim] == 0 {
			continue
		}
		fmt.Fprintf(out, "    %-18s %3d\n", dim, avg[dim]/count[dim])
	}
}

func humanTokens(n int64) string {
	switch {
	case n < 1_000:
		return fmt.Sprintf("%d", n)
	case n < 1_000_000:
		return fmt.Sprintf("%.1fK", float64(n)/1_000)
	case n < 1_000_000_000:
		return fmt.Sprintf("%.1fM", float64(n)/1_000_000)
	default:
		return fmt.Sprintf("%.1fB", float64(n)/1_000_000_000)
	}
}

type kv struct {
	K string
	V int64
}

// topN returns the top N entries of a map as a descending-value slice.
func topN(m map[string]int64, n int) []kv {
	list := make([]kv, 0, len(m))
	for k, v := range m {
		list = append(list, kv{k, v})
	}
	// Selection sort — N is small (5) and lists are tiny.
	for i := 0; i < len(list) && i < n; i++ {
		best := i
		for j := i + 1; j < len(list); j++ {
			if list[j].V > list[best].V {
				best = j
			}
		}
		list[i], list[best] = list[best], list[i]
	}
	if len(list) > n {
		list = list[:n]
	}
	return list
}
