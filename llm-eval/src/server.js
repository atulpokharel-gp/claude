// Zero-dependency HTTP server: serves the dashboard from ./public and a small
// JSON REST API backed by the library modules. Run progress is streamed to the
// browser with Server-Sent Events.
import http from 'node:http';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { PUBLIC_DIR, ensureDirs } from './store.js';
import {
  listProviders, saveProvider, deleteProvider, getProvider,
  redactProvider, getSettings, saveSettings,
} from './config.js';
import { listModels, chat } from './providers.js';
import { discoverLocalServers } from './discovery.js';
import { listPrompts, savePrompt, deletePrompt, draftPrompt } from './prompts.js';
import { executeRun, listRuns, getRun, patchResult } from './runs.js';

const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.svg': 'image/svg+xml' };

function send(res, status, body, headers = {}) {
  const payload = typeof body === 'string' || Buffer.isBuffer(body) ? body : JSON.stringify(body);
  res.writeHead(status, { 'content-type': 'application/json', ...headers });
  res.end(payload);
}

async function readBody(req) {
  const chunks = [];
  for await (const c of req) chunks.push(c);
  if (!chunks.length) return {};
  try { return JSON.parse(Buffer.concat(chunks).toString('utf8')); } catch { return {}; }
}

async function serveStatic(res, urlPath) {
  const rel = urlPath === '/' ? 'index.html' : urlPath.replace(/^\/+/, '');
  const file = path.join(PUBLIC_DIR, rel);
  if (!file.startsWith(PUBLIC_DIR)) return send(res, 403, { error: 'forbidden' });
  try {
    const data = await fs.readFile(file);
    res.writeHead(200, { 'content-type': MIME[path.extname(file)] || 'application/octet-stream' });
    res.end(data);
  } catch {
    send(res, 404, { error: 'not found' });
  }
}

// In-memory registry of live runs so SSE clients can attach to progress.
const liveRuns = new Map(); // runId -> { listeners:Set<res>, buffer:[] }

function broadcast(runId, event) {
  const live = liveRuns.get(runId);
  if (!live) return;
  live.buffer.push(event);
  for (const res of live.listeners) {
    res.write(`data: ${JSON.stringify(event)}\n\n`);
  }
  if (event.type === 'done') {
    for (const res of live.listeners) res.end();
    liveRuns.delete(runId);
  }
}

const routes = [
  ['GET', /^\/api\/providers$/, async () => (await listProviders()).map(redactProvider)],
  ['POST', /^\/api\/providers$/, async (_m, req) => redactProvider(await saveProvider(await readBody(req)))],
  ['DELETE', /^\/api\/providers\/([^/]+)$/, async (m) => { await deleteProvider(m[1]); return { ok: true }; }],
  ['GET', /^\/api\/providers\/([^/]+)\/models$/, async (m) => ({ models: await listModels(await getProvider(m[1])) })],

  ['GET', /^\/api\/discovery$/, async () => ({ servers: await discoverLocalServers() })],

  ['GET', /^\/api\/settings$/, async () => getSettings()],
  ['POST', /^\/api\/settings$/, async (_m, req) => saveSettings(await readBody(req))],

  ['GET', /^\/api\/prompts$/, async () => listPrompts()],
  ['POST', /^\/api\/prompts$/, async (_m, req) => savePrompt(await readBody(req))],
  ['DELETE', /^\/api\/prompts\/([^/]+)$/, async (m) => { await deletePrompt(m[1]); return { ok: true }; }],
  ['POST', /^\/api\/prompts\/draft$/, async (_m, req) => {
    const body = await readBody(req);
    const provider = await getProvider(body.providerId);
    if (!provider) throw new Error('draft provider not found');
    return draftPrompt({ brief: body.brief, chat, provider, model: body.model });
  }],

  ['GET', /^\/api\/runs$/, async () => listRuns()],
  ['GET', /^\/api\/runs\/([^/]+)$/, async (m) => getRun(m[1])],
  ['PATCH', /^\/api\/runs\/([^/]+)\/results\/([^/]+)$/, async (m, req) => patchResult(m[1], m[2], await readBody(req))],
];

async function handleApi(req, res, pathname) {
  // SSE progress stream for a run must be handled specially (long-lived).
  const sse = pathname.match(/^\/api\/runs\/([^/]+)\/stream$/);
  if (sse && req.method === 'GET') {
    const runId = sse[1];
    res.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-cache', connection: 'keep-alive' });
    const live = liveRuns.get(runId);
    if (live) {
      for (const ev of live.buffer) res.write(`data: ${JSON.stringify(ev)}\n\n`);
      live.listeners.add(res);
      req.on('close', () => live.listeners.delete(res));
    } else {
      // Run already finished (or unknown): send the stored run and close.
      const run = await getRun(runId);
      res.write(`data: ${JSON.stringify({ type: 'done', runId, run })}\n\n`);
      res.end();
    }
    return;
  }

  // Starting a run returns the runId as soon as it is known; work proceeds async
  // and the client subscribes to /api/runs/:id/stream for progress.
  if (pathname === '/api/runs' && req.method === 'POST') {
    const spec = await readBody(req);
    const live = { listeners: new Set(), buffer: [] };
    const started = new Promise((resolve) => {
      executeRun(spec, (event) => {
        if (event.type === 'start') { liveRuns.set(event.runId, live); resolve(event.runId); }
        broadcast(event.runId, event);
      }).catch((err) => {
        const ev = { type: 'error', error: String(err.message || err) };
        for (const res2 of live.listeners) { res2.write(`data: ${JSON.stringify(ev)}\n\n`); res2.end(); }
        resolve(null);
      });
    });
    const runId = await started;
    if (!runId) return send(res, 400, { error: 'run failed to start (check providers/prompts)' });
    return send(res, 202, { ok: true, runId });
  }

  for (const [method, re, handler] of routes) {
    if (req.method !== method) continue;
    const m = pathname.match(re);
    if (!m) continue;
    try {
      const result = await handler(m, req);
      return send(res, 200, result ?? { ok: true });
    } catch (err) {
      return send(res, 400, { error: String(err.message || err) });
    }
  }
  send(res, 404, { error: 'no such endpoint' });
}

export async function startServer({ port = 7878 } = {}) {
  await ensureDirs();
  const server = http.createServer(async (req, res) => {
    const { pathname } = new URL(req.url, 'http://localhost');
    try {
      if (pathname.startsWith('/api/')) return await handleApi(req, res, pathname);
      return await serveStatic(res, pathname);
    } catch (err) {
      send(res, 500, { error: String(err.message || err) });
    }
  });
  await new Promise((resolve) => server.listen(port, resolve));
  return { server, port };
}
