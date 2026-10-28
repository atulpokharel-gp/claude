// Discover LLM servers already running on this machine by probing the ports and
// health endpoints that popular local runtimes listen on. Each probe is fast and
// swallows connection errors, so calling this on a machine with nothing running
// simply returns an empty list.

const CANDIDATES = [
  { kind: 'ollama', name: 'Ollama', baseUrl: 'http://localhost:11434', probe: '/api/tags', models: (j) => (j.models || []).map((m) => m.name) },
  { kind: 'openai', name: 'LM Studio', baseUrl: 'http://localhost:1234/v1', probe: '/models', models: (j) => (j.data || []).map((m) => m.id) },
  { kind: 'openai', name: 'llama.cpp / generic (8080)', baseUrl: 'http://localhost:8080/v1', probe: '/models', models: (j) => (j.data || []).map((m) => m.id) },
  { kind: 'openai', name: 'vLLM', baseUrl: 'http://localhost:8000/v1', probe: '/models', models: (j) => (j.data || []).map((m) => m.id) },
  { kind: 'openai', name: 'Jan / LocalAI (1337)', baseUrl: 'http://localhost:1337/v1', probe: '/models', models: (j) => (j.data || []).map((m) => m.id) },
];

async function probeOne(c, timeoutMs) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(`${c.baseUrl}${c.probe}`, { signal: ctrl.signal });
    if (!res.ok) return null;
    const json = await res.json().catch(() => ({}));
    return {
      kind: c.kind,
      name: c.name,
      baseUrl: c.baseUrl,
      models: c.models(json),
      detectedAt: new Date().toISOString(),
    };
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

/** Probe all known local servers in parallel; returns the ones that responded. */
export async function discoverLocalServers({ timeoutMs = 800 } = {}) {
  const results = await Promise.all(CANDIDATES.map((c) => probeOne(c, timeoutMs)));
  return results.filter(Boolean);
}
