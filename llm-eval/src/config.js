// Provider & settings management.
//
// A "provider" is a connection to one API that serves one or more models. We
// support three wire protocols that between them cover almost every local and
// cloud server people use:
//
//   - "openai"    OpenAI /v1/chat/completions shape. Also covers LM Studio,
//                 vLLM, llama.cpp server, Together, Groq, OpenRouter, DeepSeek,
//                 and anything else that speaks the OpenAI API.
//   - "anthropic" Anthropic /v1/messages shape (Claude).
//   - "ollama"    Ollama native /api/chat shape.
//
// API keys are never required to live in these files: a provider can name an
// environment variable (apiKeyEnv) instead of embedding the secret. An inline
// `apiKey` is supported for convenience but is stored as-is, so prefer env.
import path from 'node:path';
import { DATA_DIR, readJson, writeJson, newId } from './store.js';

const PROVIDERS_FILE = path.join(DATA_DIR, 'providers.json');
const SETTINGS_FILE = path.join(DATA_DIR, 'settings.json');

export async function listProviders() {
  return readJson(PROVIDERS_FILE, []);
}

export async function getProvider(id) {
  const all = await listProviders();
  return all.find((p) => p.id === id) || null;
}

export async function saveProvider(input) {
  const all = await listProviders();
  const id = input.id || newId('prov_');
  const existing = all.find((p) => p.id === id);
  const provider = {
    id,
    name: input.name || input.kind || 'provider',
    kind: input.kind || 'openai',
    baseUrl: (input.baseUrl || '').replace(/\/$/, ''),
    apiKeyEnv: input.apiKeyEnv || null,
    apiKey: input.apiKey || null,
    models: Array.isArray(input.models) ? input.models : (existing?.models ?? []),
  };
  const next = existing
    ? all.map((p) => (p.id === id ? provider : p))
    : [...all, provider];
  await writeJson(PROVIDERS_FILE, next);
  return provider;
}

export async function deleteProvider(id) {
  const all = await listProviders();
  await writeJson(PROVIDERS_FILE, all.filter((p) => p.id !== id));
}

/** Resolve the API key for a provider from inline value or named env var. */
export function resolveApiKey(provider) {
  if (!provider) return null;
  if (provider.apiKey) return provider.apiKey;
  if (provider.apiKeyEnv) return process.env[provider.apiKeyEnv] || null;
  return null;
}

/** Return a provider with secrets stripped, safe to send to the browser. */
export function redactProvider(provider) {
  const hasKey = Boolean(resolveApiKey(provider));
  const { apiKey, ...rest } = provider;
  return { ...rest, hasKey, apiKeyStored: Boolean(apiKey) };
}

export async function getSettings() {
  return readJson(SETTINGS_FILE, { defaultJudge: null });
}

export async function saveSettings(patch) {
  const current = await getSettings();
  const next = { ...current, ...patch };
  await writeJson(SETTINGS_FILE, next);
  return next;
}
