// Provider adapters: turn a normalized chat request into the right HTTP call for
// each wire protocol, and normalize the response back into one shape:
//
//   { text, thinking, toolCalls, usage, model, latencyMs, raw }
//
// `text` is the final answer with any inline chain-of-thought stripped, so a
// judge only ever scores what the model actually presented as its answer.
import { resolveApiKey } from './config.js';

const DEFAULT_TIMEOUT_MS = 120_000;

/** Strip inline reasoning so only the final answer is judged.
 *  Handles <think>…</think> and a few common variants (<thinking>, <reason>). */
export function stripThinking(text) {
  if (!text) return { answer: '', thinking: '' };
  const tagRe = /<(think|thinking|reason|reasoning)>([\s\S]*?)<\/\1>/gi;
  const thinkingParts = [];
  let answer = text.replace(tagRe, (_m, _tag, inner) => {
    thinkingParts.push(inner.trim());
    return '';
  });
  // Some models emit an unterminated reasoning prefix ending in a marker.
  const splitMarkers = [/\n#{1,3}\s*(final answer|answer)\s*:?\n/i];
  for (const marker of splitMarkers) {
    const m = answer.match(marker);
    if (m) {
      thinkingParts.push(answer.slice(0, m.index).trim());
      answer = answer.slice(m.index + m[0].length);
      break;
    }
  }
  return { answer: answer.trim(), thinking: thinkingParts.join('\n\n').trim() };
}

async function postJson(url, { headers, body, timeoutMs = DEFAULT_TIMEOUT_MS }) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json', ...headers },
      body: JSON.stringify(body),
      signal: ctrl.signal,
    });
    const txt = await res.text();
    let json;
    try { json = txt ? JSON.parse(txt) : {}; } catch { json = { _raw: txt }; }
    if (!res.ok) {
      const msg = json?.error?.message || json?.error || json?._raw || res.statusText;
      throw new Error(`HTTP ${res.status}: ${typeof msg === 'string' ? msg : JSON.stringify(msg)}`);
    }
    return json;
  } finally {
    clearTimeout(timer);
  }
}

// ---- OpenAI-compatible (OpenAI, LM Studio, vLLM, llama.cpp, Groq, …) ----
async function chatOpenAI(provider, req) {
  const key = resolveApiKey(provider);
  const body = {
    model: req.model,
    messages: req.messages,
    temperature: req.temperature ?? 0,
    ...(req.maxTokens ? { max_tokens: req.maxTokens } : {}),
    ...(req.tools ? { tools: req.tools, tool_choice: req.toolChoice || 'auto' } : {}),
  };
  const json = await postJson(`${provider.baseUrl}/chat/completions`, {
    headers: key ? { authorization: `Bearer ${key}` } : {},
    body,
  });
  const choice = json.choices?.[0]?.message || {};
  const { answer, thinking } = stripThinking(choice.content || '');
  return {
    text: answer,
    thinking: choice.reasoning_content || thinking,
    toolCalls: (choice.tool_calls || []).map((t) => ({
      id: t.id,
      name: t.function?.name,
      arguments: safeParse(t.function?.arguments),
    })),
    usage: normalizeUsage(json.usage),
    model: json.model || req.model,
    raw: json,
  };
}

// ---- Anthropic Claude (/v1/messages) ----
async function chatAnthropic(provider, req) {
  const key = resolveApiKey(provider);
  if (!key) throw new Error('Anthropic provider requires an API key');
  // Anthropic takes a top-level system string, not a system message.
  const system = req.messages.filter((m) => m.role === 'system').map((m) => m.content).join('\n');
  const messages = req.messages
    .filter((m) => m.role !== 'system')
    .map((m) => ({ role: m.role === 'assistant' ? 'assistant' : 'user', content: m.content }));
  const body = {
    model: req.model,
    max_tokens: req.maxTokens || 2048,
    temperature: req.temperature ?? 0,
    ...(system ? { system } : {}),
    messages,
    ...(req.tools ? { tools: toAnthropicTools(req.tools) } : {}),
  };
  const json = await postJson(`${provider.baseUrl || 'https://api.anthropic.com'}/v1/messages`, {
    headers: { 'x-api-key': key, 'anthropic-version': '2023-06-01' },
    body,
  });
  // Claude returns an array of content blocks; "thinking" blocks are separate
  // from "text" blocks, so the final answer is already cleanly separated.
  const blocks = json.content || [];
  const text = blocks.filter((b) => b.type === 'text').map((b) => b.text).join('');
  const thinking = blocks.filter((b) => b.type === 'thinking').map((b) => b.thinking || b.text || '').join('\n');
  const toolCalls = blocks
    .filter((b) => b.type === 'tool_use')
    .map((b) => ({ id: b.id, name: b.name, arguments: b.input }));
  return {
    text: text.trim(),
    thinking: thinking.trim(),
    toolCalls,
    usage: {
      promptTokens: json.usage?.input_tokens ?? null,
      completionTokens: json.usage?.output_tokens ?? null,
      totalTokens: (json.usage?.input_tokens ?? 0) + (json.usage?.output_tokens ?? 0) || null,
    },
    model: json.model || req.model,
    raw: json,
  };
}

// ---- Ollama native (/api/chat) ----
async function chatOllama(provider, req) {
  const body = {
    model: req.model,
    messages: req.messages,
    stream: false,
    options: { temperature: req.temperature ?? 0 },
    ...(req.tools ? { tools: req.tools } : {}),
  };
  const json = await postJson(`${provider.baseUrl || 'http://localhost:11434'}/api/chat`, { body });
  const msg = json.message || {};
  const { answer, thinking } = stripThinking(msg.content || '');
  return {
    text: answer,
    thinking: msg.thinking || thinking,
    toolCalls: (msg.tool_calls || []).map((t) => ({
      name: t.function?.name,
      arguments: t.function?.arguments,
    })),
    usage: {
      promptTokens: json.prompt_eval_count ?? null,
      completionTokens: json.eval_count ?? null,
      totalTokens: (json.prompt_eval_count ?? 0) + (json.eval_count ?? 0) || null,
    },
    model: json.model || req.model,
    raw: json,
  };
}

const ADAPTERS = { openai: chatOpenAI, anthropic: chatAnthropic, ollama: chatOllama };

/** Normalized chat entry point. Adds latency timing around every call. */
export async function chat(provider, req) {
  const adapter = ADAPTERS[provider.kind];
  if (!adapter) throw new Error(`Unknown provider kind: ${provider.kind}`);
  const started = Date.now();
  const out = await adapter(provider, req);
  out.latencyMs = Date.now() - started;
  return out;
}

/** List models exposed by a provider, best-effort per protocol. */
export async function listModels(provider) {
  try {
    if (provider.kind === 'ollama') {
      const res = await fetch(`${provider.baseUrl || 'http://localhost:11434'}/api/tags`);
      const json = await res.json();
      return (json.models || []).map((m) => m.name);
    }
    if (provider.kind === 'openai') {
      const key = resolveApiKey(provider);
      const res = await fetch(`${provider.baseUrl}/models`, {
        headers: key ? { authorization: `Bearer ${key}` } : {},
      });
      const json = await res.json();
      return (json.data || []).map((m) => m.id);
    }
  } catch {
    // Fall through to whatever was manually configured.
  }
  return provider.models || [];
}

function toAnthropicTools(tools) {
  return tools.map((t) => {
    const fn = t.function || t;
    return { name: fn.name, description: fn.description, input_schema: fn.parameters || fn.input_schema || { type: 'object' } };
  });
}

function normalizeUsage(u) {
  if (!u) return { promptTokens: null, completionTokens: null, totalTokens: null };
  return {
    promptTokens: u.prompt_tokens ?? null,
    completionTokens: u.completion_tokens ?? null,
    totalTokens: u.total_tokens ?? null,
  };
}

function safeParse(s) {
  if (typeof s !== 'string') return s;
  try { return JSON.parse(s); } catch { return s; }
}
