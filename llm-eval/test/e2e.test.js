// End-to-end test of the run pipeline against a fake OpenAI-compatible server,
// so it exercises provider dispatch, thinking-stripping, judging, and ranking
// without any real network or API keys. Uses an isolated DATA_DIR.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { promises as fs } from 'node:fs';

test('executeRun scores targets and produces a ranked summary', async () => {
  // 1. Fake LLM server: targets echo an answer; the judge returns a JSON verdict.
  const fake = http.createServer((req, res) => {
    let body = '';
    req.on('data', (c) => (body += c));
    req.on('end', () => {
      const payload = JSON.parse(body);
      const isJudge = payload.messages.some((m) => m.role === 'system' && /evaluator/i.test(m.content || ''));
      let content;
      if (isJudge) {
        // Give the "good-model" a 3 and anything else a 1, so ranking is deterministic.
        const scored = /good-model/.test(body) ? 3 : 1;
        content = JSON.stringify({ score: scored, reasoning: 'test verdict' });
      } else if (payload.model === 'thinky') {
        content = '<think>pondering</think>Final answer from thinky.';
      } else {
        content = `Answer from ${payload.model}.`;
      }
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ model: payload.model, choices: [{ message: { content } }], usage: { prompt_tokens: 5, completion_tokens: 7, total_tokens: 12 } }));
    });
  });
  await new Promise((r) => fake.listen(0, r));
  const port = fake.address().port;
  const base = `http://localhost:${port}`;

  // 2. Isolated data dir.
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'llm-eval-test-'));
  process.env.LLM_EVAL_DATA_DIR = dir;

  const { saveProvider } = await import('../src/config.js');
  const { savePrompt } = await import('../src/prompts.js');
  const { executeRun } = await import('../src/runs.js');

  const prov = await saveProvider({ name: 'fake', kind: 'openai', baseUrl: base });
  const prompt = await savePrompt({ title: 'q', category: 'test', user: 'hello?', rubric: '0-3' });

  const events = [];
  const run = await executeRun({
    name: 'test run',
    targets: [{ providerId: prov.id, model: 'good-model' }, { providerId: prov.id, model: 'thinky' }],
    promptIds: [prompt.id],
    judge: { providerId: prov.id, model: 'judge' },
  }, (e) => events.push(e.type));

  // 3. Assertions.
  assert.equal(run.status, 'done');
  assert.equal(run.results.length, 2);
  assert.ok(events.includes('start') && events.includes('done'));

  const thinky = run.results.find((r) => r.model === 'thinky');
  assert.equal(thinky.answer, 'Final answer from thinky.'); // thinking stripped
  assert.match(thinky.thinking, /pondering/);

  assert.equal(run.summary[0].model, 'good-model'); // scored 3, ranks first
  assert.equal(run.summary[0].avgScore, 3);
  assert.equal(run.summary[0].rank, 1);

  fake.close();
  await fs.rm(dir, { recursive: true, force: true });
  delete process.env.LLM_EVAL_DATA_DIR;
});
