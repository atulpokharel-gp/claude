# llm-eval

Score local and cloud LLMs against a suite of prompts, then rank them by
**quality** (an LLM judge's 0-3 score) and **speed** (measured latency). Runs as a
browser dashboard and a small CLI over the same data. Zero runtime dependencies —
just Node 18+ (uses the built-in `fetch` and `http`).

```
cd llm-eval
node src/cli.js serve          # dashboard at http://localhost:7878
node src/cli.js discover       # find local servers (Ollama, LM Studio, vLLM, …)
npm test                       # unit + end-to-end tests (no network needed)
```

## What it does

- **Providers & keys** — connect any OpenAI-compatible API, Anthropic, or Ollama.
  API keys are read from named environment variables; they are never written to
  the data files or sent to the browser.
- **Local discovery** — probes common ports for Ollama (11434), LM Studio (1234),
  llama.cpp/generic (8080), vLLM (8000), and Jan/LocalAI (1337).
- **Prompts** — title, category, and a 0-3 rubric. Supports multi-turn
  conversations and tool-use tests (with canned tool responses for determinism).
  An LLM can **draft** a prompt for you from a one-line brief.
- **Judge model** — pick any configured model to score answers 0-3 with written
  reasoning you can inspect.
- **Thinking models** — inline `<think>…</think>` reasoning and Claude/Ollama
  reasoning blocks are stripped before judging, so only the final answer is scored
  (the reasoning is still saved for inspection).
- **Runs** — live progress (bar + per-item log) in the browser or CLI. Each run is
  saved as a single JSON file under `data/runs/`.
- **Browse results** — sort by score/latency/model, tag and mute individual
  results (muted ones drop out of the ranking), and read the judge's reasoning.

## Layout

```
src/
  store.js        JSON persistence + paths (DATA_DIR override via LLM_EVAL_DATA_DIR)
  config.js       providers + settings, API-key resolution/redaction
  providers.js    chat adapters (openai | anthropic | ollama), thinking-stripping
  discovery.js    local-server probing
  prompts.js      prompt CRUD + LLM-assisted drafting
  judge.js        LLM-as-judge scoring
  runs.js         the eval engine, persistence, ranking, tag/mute
  server.js       zero-dep HTTP server: REST API + SSE progress
  cli.js          command-line companion
public/           dashboard (vanilla JS, no build step)
data/             providers.json, prompts.json, settings.json, runs/*.json
```

## CLI examples

```
node src/cli.js providers add --name LMStudio --kind openai --baseUrl http://localhost:1234/v1
node src/cli.js judge --provider prov_openai --model gpt-4o
node src/cli.js run --targets prov_ollama:llama3.1,prov_openai:gpt-4o-mini --name "nightly"
node src/cli.js results
```

Set keys before running cloud providers, e.g. PowerShell:
`$env:OPENAI_API_KEY = "sk-…"` then `node src/cli.js serve`.
