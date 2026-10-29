// The evaluation engine. A "run" scores a set of prompts across a set of target
// models, judged by one judge model, and is persisted as a single JSON file.
//
// Each run emits progress events through an onProgress callback so the CLI can
// print a live bar and the web server can stream Server-Sent Events.
import path from 'node:path';
import { RUNS_DIR, readJson, writeJson, newId } from './store.js';
import { getProvider } from './config.js';
import { chat } from './providers.js';
import { judgeAnswer } from './judge.js';
import { getPrompt } from './prompts.js';

/** Flatten a conversation to a readable string for the judge / for display. */
function flattenPrompt(messages) {
  return messages.map((m) => `${m.role}: ${typeof m.content === 'string' ? m.content : JSON.stringify(m.content)}`).join('\n');
}

/** Run one prompt against one target model, including one round of tool use when
 *  the prompt defines tools and supplies canned toolResponses. */
async function evalOne({ prompt, target }) {
  const messages = structuredClone(prompt.messages);
  const first = await chat(target.provider, {
    model: target.model,
    messages,
    tools: prompt.tools || undefined,
    maxTokens: target.maxTokens,
    temperature: target.temperature,
  });

  let final = first;
  let turns = 1;
  // If the model asked to call tools and the prompt provides canned responses,
  // feed them back and take one more turn so the final answer reflects the tool.
  if (first.toolCalls?.length && prompt.toolResponses) {
    messages.push({ role: 'assistant', content: first.text || '', tool_calls: first.raw?.choices?.[0]?.message?.tool_calls });
    for (const call of first.toolCalls) {
      const canned = prompt.toolResponses[call.name];
      messages.push({
        role: 'tool',
        name: call.name,
        content: typeof canned === 'string' ? canned : JSON.stringify(canned ?? null),
      });
    }
    final = await chat(target.provider, { model: target.model, messages, maxTokens: target.maxTokens, temperature: target.temperature });
    turns = 2;
  }

  return {
    answer: final.text,
    thinking: final.thinking,
    toolCalls: first.toolCalls,
    turns,
    latencyMs: (first.latencyMs || 0) + (turns === 2 ? final.latencyMs || 0 : 0),
    usage: final.usage,
  };
}

/**
 * Execute a full run.
 * @param spec { name, targets:[{providerId, model}], promptIds:[], judge:{providerId,model} }
 * @param onProgress optional (event) => void
 * @returns the saved run object
 */
export async function executeRun(spec, onProgress = () => {}) {
  const run = {
    id: newId('run_'),
    name: spec.name || 'Untitled run',
    startedAt: new Date().toISOString(),
    finishedAt: null,
    status: 'running',
    targets: spec.targets,
    judge: spec.judge,
    results: [],
  };

  // Resolve providers once.
  const judgeProvider = await getProvider(spec.judge.providerId);
  if (!judgeProvider) throw new Error(`Judge provider not found: ${spec.judge.providerId}`);
  const judge = { provider: judgeProvider, model: spec.judge.model };

  const targets = [];
  for (const t of spec.targets) {
    const provider = await getProvider(t.providerId);
    if (!provider) throw new Error(`Target provider not found: ${t.providerId}`);
    targets.push({ ...t, provider, label: `${provider.name}:${t.model}` });
  }

  const prompts = [];
  for (const pid of spec.promptIds) {
    const p = await getPrompt(pid);
    if (p) prompts.push(p);
  }

  const total = prompts.length * targets.length;
  let done = 0;
  onProgress({ type: 'start', runId: run.id, total });

  for (const prompt of prompts) {
    const promptText = flattenPrompt(prompt.messages);
    for (const target of targets) {
      const item = {
        id: newId('res_'),
        promptId: prompt.id,
        promptTitle: prompt.title,
        category: prompt.category,
        targetLabel: target.label,
        providerId: target.providerId,
        model: target.model,
        muted: false,
        tags: [],
      };
      try {
        const out = await evalOne({ prompt, target });
        const verdict = await judgeAnswer({ chat, judge, promptText, rubric: prompt.rubric, answer: out.answer });
        Object.assign(item, {
          answer: out.answer,
          thinking: out.thinking,
          toolCalls: out.toolCalls,
          turns: out.turns,
          latencyMs: out.latencyMs,
          usage: out.usage,
          score: verdict.score,
          judgeReasoning: verdict.reasoning,
          judgeModel: verdict.judgeModel,
          error: null,
        });
      } catch (err) {
        Object.assign(item, { score: null, error: String(err.message || err), latencyMs: null });
      }
      run.results.push(item);
      done += 1;
      onProgress({ type: 'item', runId: run.id, done, total, item });
    }
  }

  run.finishedAt = new Date().toISOString();
  run.status = 'done';
  run.summary = summarize(run);
  await saveRun(run);
  onProgress({ type: 'done', runId: run.id, run });
  return run;
}

/** Aggregate per-target quality (avg score) and speed (avg latency). */
export function summarize(run) {
  const byTarget = new Map();
  for (const r of run.results) {
    if (r.muted) continue;
    const key = r.targetLabel;
    const agg = byTarget.get(key) || { targetLabel: key, model: r.model, n: 0, scoreSum: 0, scoreN: 0, latSum: 0, latN: 0, errors: 0 };
    agg.n += 1;
    if (r.error) agg.errors += 1;
    if (Number.isFinite(r.score)) { agg.scoreSum += r.score; agg.scoreN += 1; }
    if (Number.isFinite(r.latencyMs)) { agg.latSum += r.latencyMs; agg.latN += 1; }
    byTarget.set(key, agg);
  }
  const rows = [...byTarget.values()].map((a) => ({
    targetLabel: a.targetLabel,
    model: a.model,
    count: a.n,
    errors: a.errors,
    avgScore: a.scoreN ? +(a.scoreSum / a.scoreN).toFixed(2) : null,
    avgLatencyMs: a.latN ? Math.round(a.latSum / a.latN) : null,
  }));
  // Rank by quality first, then speed.
  rows.sort((x, y) => (y.avgScore ?? -1) - (x.avgScore ?? -1) || (x.avgLatencyMs ?? 1e12) - (y.avgLatencyMs ?? 1e12));
  rows.forEach((r, i) => { r.rank = i + 1; });
  return rows;
}

export function runFile(id) {
  return path.join(RUNS_DIR, `${id}.json`);
}

export async function saveRun(run) {
  run.summary = summarize(run);
  await writeJson(runFile(run.id), run);
  return run;
}

export async function getRun(id) {
  return readJson(runFile(id), null);
}

export async function listRuns() {
  const { promises: fs } = await import('node:fs');
  let files = [];
  try { files = await fs.readdir(RUNS_DIR); } catch { return []; }
  const runs = [];
  for (const f of files) {
    if (!f.endsWith('.json')) continue;
    const r = await readJson(path.join(RUNS_DIR, f), null);
    if (r) runs.push({ id: r.id, name: r.name, startedAt: r.startedAt, status: r.status, count: r.results?.length || 0, summary: r.summary });
  }
  runs.sort((a, b) => (b.startedAt || '').localeCompare(a.startedAt || ''));
  return runs;
}

/** Patch a single result (tag / mute / untag) and re-summarize. */
export async function patchResult(runId, resultId, patch) {
  const run = await getRun(runId);
  if (!run) throw new Error('run not found');
  const item = run.results.find((r) => r.id === resultId);
  if (!item) throw new Error('result not found');
  if (typeof patch.muted === 'boolean') item.muted = patch.muted;
  if (Array.isArray(patch.tags)) item.tags = patch.tags;
  await saveRun(run);
  return item;
}
