// Prompt suite: the set of test cases models are scored against.
//
// A prompt has:
//   id, title, category
//   rubric        – the 0..3 scoring guide shown to the judge (free text, but
//                   conventionally describes what a 0, 1, 2, and 3 answer looks like)
//   messages      – the conversation to send. For a simple single-turn test this
//                   is just [{ role:'user', content:'…' }]; multi-turn tests list
//                   several turns ending on a user turn.
//   tools         – optional OpenAI-style tool/function schemas for tool-use tests
//   toolResponses – optional { [toolName]: result } canned outputs so a tool-use
//                   test can run a second turn deterministically without a real tool.
import path from 'node:path';
import { DATA_DIR, readJson, writeJson, newId } from './store.js';

const PROMPTS_FILE = path.join(DATA_DIR, 'prompts.json');

export async function listPrompts() {
  return readJson(PROMPTS_FILE, []);
}

export async function getPrompt(id) {
  const all = await listPrompts();
  return all.find((p) => p.id === id) || null;
}

function normalizeMessages(input) {
  if (Array.isArray(input.messages) && input.messages.length) return input.messages;
  if (typeof input.user === 'string') {
    const msgs = [];
    if (input.system) msgs.push({ role: 'system', content: input.system });
    msgs.push({ role: 'user', content: input.user });
    return msgs;
  }
  return [{ role: 'user', content: '' }];
}

export async function savePrompt(input) {
  const all = await listPrompts();
  const id = input.id || newId('prm_');
  const existing = all.find((p) => p.id === id);
  const prompt = {
    id,
    title: input.title || existing?.title || 'Untitled prompt',
    category: input.category || existing?.category || 'general',
    rubric: input.rubric ?? existing?.rubric ?? '0 = wrong, 1 = weak, 2 = good, 3 = excellent',
    messages: normalizeMessages(input),
    tools: input.tools ?? existing?.tools ?? null,
    toolResponses: input.toolResponses ?? existing?.toolResponses ?? null,
  };
  const next = existing ? all.map((p) => (p.id === id ? prompt : p)) : [...all, prompt];
  await writeJson(PROMPTS_FILE, next);
  return prompt;
}

export async function deletePrompt(id) {
  const all = await listPrompts();
  await writeJson(PROMPTS_FILE, all.filter((p) => p.id !== id));
}

/** Use an LLM to draft a prompt (title, category, rubric, user message) from a
 *  short brief. Returns a prompt-shaped object; it is NOT saved automatically. */
export async function draftPrompt({ brief, chat, provider, model }) {
  const sys = `You design evaluation test cases for comparing language models.
Given a short brief, produce ONE test case as strict JSON with keys:
  "title"    short name,
  "category" one lowercase word,
  "user"     the prompt text to send to models under test,
  "rubric"   a 0-3 scoring guide with one line each for scores 0,1,2,3.
Respond with ONLY the JSON object, no prose, no code fences.`;
  const res = await chat(provider, {
    model,
    temperature: 0.4,
    maxTokens: 800,
    messages: [
      { role: 'system', content: sys },
      { role: 'user', content: `Brief: ${brief}` },
    ],
  });
  const obj = extractJson(res.text);
  if (!obj) throw new Error(`Could not parse a prompt from the draft model. Raw: ${res.text.slice(0, 200)}`);
  return {
    title: obj.title || 'Drafted prompt',
    category: obj.category || 'general',
    rubric: obj.rubric || '0 = wrong, 1 = weak, 2 = good, 3 = excellent',
    user: obj.user || '',
  };
}

export function extractJson(text) {
  if (!text) return null;
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const candidate = fenced ? fenced[1] : text;
  const start = candidate.indexOf('{');
  const end = candidate.lastIndexOf('}');
  if (start === -1 || end === -1) return null;
  try { return JSON.parse(candidate.slice(start, end + 1)); } catch { return null; }
}
