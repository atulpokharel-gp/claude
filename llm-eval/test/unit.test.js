import { test } from 'node:test';
import assert from 'node:assert/strict';
import { stripThinking } from '../src/providers.js';
import { extractJson } from '../src/prompts.js';
import { summarize } from '../src/runs.js';

test('stripThinking removes <think> blocks but keeps the answer', () => {
  const { answer, thinking } = stripThinking('<think>let me reason\nstep by step</think>The answer is 42.');
  assert.equal(answer, 'The answer is 42.');
  assert.match(thinking, /reason/);
});

test('stripThinking handles plain answers unchanged', () => {
  const { answer, thinking } = stripThinking('Just the answer.');
  assert.equal(answer, 'Just the answer.');
  assert.equal(thinking, '');
});

test('stripThinking splits an explicit Final answer marker', () => {
  const { answer } = stripThinking('weighing options\n### Final answer:\nParis');
  assert.equal(answer, 'Paris');
});

test('extractJson pulls JSON out of fenced and noisy text', () => {
  assert.deepEqual(extractJson('```json\n{"score":3}\n```'), { score: 3 });
  assert.deepEqual(extractJson('Here you go: {"a":1} thanks'), { a: 1 });
  assert.equal(extractJson('no json here'), null);
});

test('summarize ranks by score then latency and skips muted', () => {
  const run = { results: [
    { targetLabel: 'A:m', model: 'm', score: 3, latencyMs: 100, muted: false },
    { targetLabel: 'A:m', model: 'm', score: 3, latencyMs: 300, muted: false },
    { targetLabel: 'B:m', model: 'm', score: 3, latencyMs: 50, muted: false },
    { targetLabel: 'C:m', model: 'm', score: 1, latencyMs: 10, muted: false },
    { targetLabel: 'C:m', model: 'm', score: 0, latencyMs: 10, muted: true },
  ] };
  const rows = summarize(run);
  assert.equal(rows[0].targetLabel, 'B:m'); // same score as A, faster
  assert.equal(rows[0].rank, 1);
  assert.equal(rows[1].targetLabel, 'A:m');
  const c = rows.find((r) => r.targetLabel === 'C:m');
  assert.equal(c.count, 1); // muted result excluded
  assert.equal(c.avgScore, 1);
});
