#!/usr/bin/env node
// Small command-line companion to the dashboard. Everything the browser can do
// (discover servers, manage providers/prompts, run evals, browse results) is
// reachable here too, reading and writing the same ./data JSON files.
import { startServer } from './server.js';
import { discoverLocalServers } from './discovery.js';
import { listProviders, saveProvider, getSettings, saveSettings } from './config.js';
import { listPrompts } from './prompts.js';
import { executeRun, listRuns, getRun } from './runs.js';

const [, , cmd, ...args] = process.argv;

function parseFlags(argv) {
  const flags = {};
  for (let i = 0; i < argv.length; i += 1) {
    if (argv[i].startsWith('--')) {
      const key = argv[i].slice(2);
      const val = argv[i + 1] && !argv[i + 1].startsWith('--') ? argv[(i += 1)] : true;
      flags[key] = val;
    }
  }
  return flags;
}

function bar(done, total, width = 24) {
  const filled = total ? Math.round((done / total) * width) : 0;
  return `[${'#'.repeat(filled)}${'-'.repeat(width - filled)}] ${done}/${total}`;
}

async function main() {
  switch (cmd) {
    case 'serve': {
      const { port } = parseFlags(args);
      const { port: p } = await startServer({ port: port ? Number(port) : 7878 });
      console.log(`llm-eval dashboard → http://localhost:${p}`);
      break;
    }

    case 'discover': {
      const servers = await discoverLocalServers();
      if (!servers.length) { console.log('No local LLM servers detected (checked Ollama, LM Studio, vLLM, llama.cpp, Jan/LocalAI).'); break; }
      for (const s of servers) {
        console.log(`• ${s.name}  ${s.baseUrl}  [${s.kind}]`);
        for (const m of s.models.slice(0, 20)) console.log(`    - ${m}`);
      }
      break;
    }

    case 'providers': {
      const sub = args[0];
      if (sub === 'add') {
        const f = parseFlags(args.slice(1));
        const p = await saveProvider({ name: f.name, kind: f.kind, baseUrl: f.baseUrl, apiKeyEnv: f.apiKeyEnv, apiKey: f.apiKey });
        console.log(`added provider ${p.id} (${p.name})`);
      } else {
        for (const p of await listProviders()) console.log(`${p.id}  ${p.name}  [${p.kind}]  ${p.baseUrl || ''}`);
      }
      break;
    }

    case 'prompts': {
      for (const p of await listPrompts()) console.log(`${p.id}  [${p.category}]  ${p.title}`);
      break;
    }

    case 'judge': {
      // set default judge: llm-eval judge --provider <id> --model <name>
      const f = parseFlags(args);
      if (f.provider && f.model) {
        await saveSettings({ defaultJudge: { providerId: f.provider, model: f.model } });
        console.log('default judge saved');
      } else {
        console.log(JSON.stringify((await getSettings()).defaultJudge, null, 2));
      }
      break;
    }

    case 'run': {
      // llm-eval run --name X --prompts id1,id2 --targets provA:model,provB:model --judge provC:model
      const f = parseFlags(args);
      const settings = await getSettings();
      const promptIds = f.prompts ? String(f.prompts).split(',') : (await listPrompts()).map((p) => p.id);
      const targets = String(f.targets || '').split(',').filter(Boolean).map((t) => {
        const [providerId, ...rest] = t.split(':');
        return { providerId, model: rest.join(':') };
      });
      let judge = settings.defaultJudge;
      if (f.judge) { const [providerId, ...rest] = String(f.judge).split(':'); judge = { providerId, model: rest.join(':') }; }
      if (!targets.length) { console.error('no --targets given (provId:model,provId:model)'); process.exit(1); }
      if (!judge) { console.error('no judge: pass --judge provId:model or set a default with `judge`'); process.exit(1); }

      const run = await executeRun({ name: f.name || 'cli run', promptIds, targets, judge }, (ev) => {
        if (ev.type === 'item') process.stdout.write(`\r${bar(ev.done, ev.total)}  last: ${ev.item.targetLabel} → ${ev.item.score ?? 'ERR'}   `);
      });
      process.stdout.write('\n\n');
      console.log(`Run ${run.id} — ranked:`);
      for (const row of run.summary) {
        console.log(`  #${row.rank}  ${row.targetLabel}  score ${row.avgScore ?? '—'}  ${row.avgLatencyMs ?? '—'}ms${row.errors ? `  (${row.errors} errors)` : ''}`);
      }
      break;
    }

    case 'results': {
      const f = parseFlags(args);
      if (f.id) {
        const run = await getRun(f.id);
        if (!run) { console.error('run not found'); process.exit(1); }
        console.log(`${run.name} — ${run.startedAt}`);
        for (const row of run.summary || []) console.log(`  #${row.rank} ${row.targetLabel}  score ${row.avgScore ?? '—'}  ${row.avgLatencyMs ?? '—'}ms`);
      } else {
        for (const r of await listRuns()) console.log(`${r.id}  ${r.startedAt}  ${r.name}  (${r.count} results)`);
      }
      break;
    }

    default:
      console.log(`llm-eval — compare local & cloud LLMs

Usage:
  llm-eval serve [--port 7878]          start the web dashboard
  llm-eval discover                     probe this machine for local LLM servers
  llm-eval providers                    list providers
  llm-eval providers add --name N --kind openai|anthropic|ollama --baseUrl URL [--apiKeyEnv VAR]
  llm-eval prompts                      list prompts
  llm-eval judge [--provider ID --model M]   show or set the default judge
  llm-eval run --targets provId:model,... [--prompts id,id] [--judge provId:model] [--name N]
  llm-eval results [--id runId]         list runs or show one run's ranking
`);
  }
}

main().catch((err) => { console.error(err); process.exit(1); });
