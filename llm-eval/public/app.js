// Dashboard front-end. Talks to the REST API in src/server.js. No framework —
// just fetch + DOM, kept small on purpose.

const $ = (sel, root = document) => root.querySelector(sel);
const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];
const api = async (url, opts) => {
  const res = await fetch(url, opts && { headers: { 'content-type': 'application/json' }, ...opts });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(json.error || res.statusText);
  return json;
};
const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

let providers = [];
let prompts = [];

// ---------- tabs ----------
$$('#tabs button').forEach((b) => b.addEventListener('click', () => {
  $$('#tabs button').forEach((x) => x.classList.toggle('active', x === b));
  $$('.tab').forEach((t) => t.classList.toggle('active', t.id === `tab-${b.dataset.tab}`));
  if (b.dataset.tab === 'results') loadRuns();
}));

// ---------- providers ----------
async function loadProviders() {
  providers = await api('/api/providers');
  const list = $('#provider-list');
  list.innerHTML = providers.length ? '' : '<li class="muted">No providers yet. Add one, or discover local servers.</li>';
  for (const p of providers) {
    const li = document.createElement('li');
    li.innerHTML = `<strong>${esc(p.name)}</strong> <span class="badge">${p.kind}</span>
      ${p.hasKey ? '<span class="badge">key ✓</span>' : (p.kind !== 'ollama' ? '<span class="badge">no key</span>' : '')}
      <div class="muted">${esc(p.baseUrl || '')}</div>
      <div class="muted">models: ${p.models?.length ? esc(p.models.join(', ')) : '—'}</div>
      <div class="row" style="margin-top:8px">
        <button class="ghost pill-btn" data-models="${p.id}">refresh models</button>
        <button class="ghost pill-btn" data-del="${p.id}">delete</button>
      </div>`;
    list.appendChild(li);
  }
  $$('#provider-list [data-del]').forEach((b) => b.onclick = async () => { await api(`/api/providers/${b.dataset.del}`, { method: 'DELETE' }); refreshAll(); });
  $$('#provider-list [data-models]').forEach((b) => b.onclick = async () => {
    const { models } = await api(`/api/providers/${b.dataset.models}/models`);
    await api('/api/providers', { method: 'POST', body: JSON.stringify({ id: b.dataset.models, models }) });
    refreshAll();
  });
  // populate judge + draft provider selects
  fillProviderSelect($('#judge-provider'));
  fillProviderSelect($('#draft-provider'));
}

function fillProviderSelect(sel) {
  if (!sel) return;
  const cur = sel.value;
  sel.innerHTML = providers.map((p) => `<option value="${p.id}">${esc(p.name)} [${p.kind}]</option>`).join('');
  if (cur) sel.value = cur;
}

$('#provider-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  await api('/api/providers', { method: 'POST', body: JSON.stringify({
    id: $('#provider-id').value || undefined,
    name: $('#provider-name').value,
    kind: $('#provider-kind').value,
    baseUrl: $('#provider-baseurl').value,
    apiKeyEnv: $('#provider-keyenv').value || null,
  }) });
  e.target.reset();
  refreshAll();
});

$('#discover-btn').addEventListener('click', async () => {
  const btn = $('#discover-btn');
  btn.textContent = 'Scanning…'; btn.disabled = true;
  try {
    const { servers } = await api('/api/discovery');
    const list = $('#discovery-list');
    list.innerHTML = servers.length ? '' : '<li class="muted">Nothing found on common local ports.</li>';
    for (const s of servers) {
      const li = document.createElement('li');
      li.innerHTML = `<strong>${esc(s.name)}</strong> <span class="badge">${s.kind}</span>
        <div class="muted">${esc(s.baseUrl)} · ${s.models.length} models</div>
        <button class="ghost pill-btn" style="margin-top:6px">add as provider</button>`;
      li.querySelector('button').onclick = async () => {
        await api('/api/providers', { method: 'POST', body: JSON.stringify({ name: s.name, kind: s.kind, baseUrl: s.baseUrl, models: s.models }) });
        refreshAll();
      };
      list.appendChild(li);
    }
  } finally { btn.textContent = 'Scan this machine'; btn.disabled = false; }
});

// ---------- prompts ----------
async function loadPrompts() {
  prompts = await api('/api/prompts');
  const list = $('#prompt-list');
  list.innerHTML = prompts.length ? '' : '<li class="muted">No prompts yet.</li>';
  for (const p of prompts) {
    const li = document.createElement('li');
    const userMsg = [...p.messages].reverse().find((m) => m.role === 'user')?.content || '';
    li.innerHTML = `<strong>${esc(p.title)}</strong> <span class="badge">${esc(p.category)}</span>
      ${p.messages.length > 1 ? `<span class="badge">${p.messages.length} turns</span>` : ''}
      ${p.tools ? '<span class="badge">tools</span>' : ''}
      <div class="muted" style="margin-top:4px">${esc(String(userMsg).slice(0, 160))}</div>
      <div class="row" style="margin-top:8px">
        <button class="ghost pill-btn" data-edit="${p.id}">edit</button>
        <button class="ghost pill-btn" data-del="${p.id}">delete</button>
      </div>`;
    list.appendChild(li);
  }
  $$('#prompt-list [data-del]').forEach((b) => b.onclick = async () => { await api(`/api/prompts/${b.dataset.del}`, { method: 'DELETE' }); refreshAll(); });
  $$('#prompt-list [data-edit]').forEach((b) => b.onclick = () => editPrompt(b.dataset.edit));
  renderPromptChecklist();
}

function editPrompt(id) {
  const p = prompts.find((x) => x.id === id);
  if (!p) return;
  $('#prompt-id').value = p.id;
  $('#prompt-title').value = p.title;
  $('#prompt-category').value = p.category;
  $('#prompt-user').value = [...p.messages].reverse().find((m) => m.role === 'user')?.content || '';
  $('#prompt-rubric').value = p.rubric;
  $$('#tabs button').find((b) => b.dataset.tab === 'prompts').click();
}

$('#prompt-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  await api('/api/prompts', { method: 'POST', body: JSON.stringify({
    id: $('#prompt-id').value || undefined,
    title: $('#prompt-title').value,
    category: $('#prompt-category').value,
    user: $('#prompt-user').value,
    rubric: $('#prompt-rubric').value,
  }) });
  e.target.reset(); $('#prompt-id').value = '';
  refreshAll();
});
$('#prompt-reset').addEventListener('click', () => { $('#prompt-form').reset(); $('#prompt-id').value = ''; });

$('#draft-btn').addEventListener('click', async () => {
  const btn = $('#draft-btn'); btn.disabled = true; btn.textContent = 'Drafting…';
  try {
    const draft = await api('/api/prompts/draft', { method: 'POST', body: JSON.stringify({
      brief: $('#draft-brief').value,
      providerId: $('#draft-provider').value,
      model: $('#draft-model').value,
    }) });
    $('#prompt-id').value = '';
    $('#prompt-title').value = draft.title;
    $('#prompt-category').value = draft.category;
    $('#prompt-user').value = draft.user;
    $('#prompt-rubric').value = draft.rubric;
  } catch (err) { alert('Draft failed: ' + err.message); }
  finally { btn.disabled = false; btn.textContent = 'Draft prompt →'; }
});

// ---------- run ----------
function targetRow() {
  const div = document.createElement('div');
  div.className = 'target';
  div.innerHTML = `
    <select class="t-provider">${providers.map((p) => `<option value="${p.id}">${esc(p.name)}</option>`).join('')}</select>
    <input class="t-model" placeholder="model name" />
    <button class="ghost pill-btn" type="button">✕</button>`;
  div.querySelector('button').onclick = () => div.remove();
  return div;
}
$('#add-target').addEventListener('click', () => $('#target-list').appendChild(targetRow()));

function renderPromptChecklist() {
  const box = $('#prompt-checklist');
  box.innerHTML = prompts.map((p) => `<label style="color:var(--text)"><input type="checkbox" style="width:auto;display:inline;margin-right:8px" value="${p.id}" checked /> ${esc(p.title)} <span class="muted">[${esc(p.category)}]</span></label>`).join('') || '<p class="muted">Add prompts first.</p>';
}
$('#select-all-prompts').addEventListener('click', () => $$('#prompt-checklist input').forEach((c) => c.checked = true));
$('#select-no-prompts').addEventListener('click', () => $$('#prompt-checklist input').forEach((c) => c.checked = false));

$('#start-run').addEventListener('click', async () => {
  const targets = $$('#target-list .target').map((row) => ({
    providerId: $('.t-provider', row).value,
    model: $('.t-model', row).value.trim(),
  })).filter((t) => t.model);
  const promptIds = $$('#prompt-checklist input:checked').map((c) => c.value);
  const judge = { providerId: $('#judge-provider').value, model: $('#judge-model').value.trim() };
  if (!targets.length) return alert('Add at least one target model.');
  if (!judge.model) return alert('Pick a judge model.');
  if (!promptIds.length) return alert('Select at least one prompt.');

  const spec = { name: $('#run-name').value || 'run', targets, promptIds, judge };
  const { runId } = await api('/api/runs', { method: 'POST', body: JSON.stringify(spec) });
  streamRun(runId, promptIds.length * targets.length);
});

function streamRun(runId, total) {
  const prog = $('#progress'); prog.hidden = false;
  $('#progress-log').innerHTML = '';
  $('#bar-fill').style.width = '0%';
  $('#progress-text').textContent = `Starting… 0/${total}`;
  const es = new EventSource(`/api/runs/${runId}/stream`);
  es.onmessage = (e) => {
    const ev = JSON.parse(e.data);
    if (ev.type === 'item') {
      const pct = Math.round((ev.done / ev.total) * 100);
      $('#bar-fill').style.width = pct + '%';
      $('#progress-text').textContent = `${ev.done}/${ev.total}`;
      const li = document.createElement('li');
      const sc = ev.item.error ? `<span class="err">ERR</span>` : `<span class="score s${ev.item.score}">${ev.item.score}</span>`;
      li.innerHTML = `${esc(ev.item.promptTitle)} — ${esc(ev.item.targetLabel)} → ${sc} <span class="muted">${ev.item.latencyMs ?? '—'}ms</span>`;
      $('#progress-log').appendChild(li);
    } else if (ev.type === 'done') {
      es.close();
      $('#progress-text').textContent = 'Done. Opening results…';
      $$('#tabs button').find((b) => b.dataset.tab === 'results').click();
      setTimeout(() => showRun(ev.runId), 200);
    } else if (ev.type === 'error') {
      es.close();
      $('#progress-text').textContent = 'Error: ' + ev.error;
    }
  };
  es.onerror = () => { es.close(); };
}

// ---------- results ----------
async function loadRuns() {
  const runs = await api('/api/runs');
  const list = $('#run-list');
  list.innerHTML = runs.length ? '' : '<li class="muted">No runs yet.</li>';
  for (const r of runs) {
    const li = document.createElement('li');
    const top = r.summary?.[0];
    li.innerHTML = `<strong>${esc(r.name)}</strong> <span class="badge">${r.count}</span>
      <div class="muted">${new Date(r.startedAt).toLocaleString()}</div>
      ${top ? `<div class="muted">winner: ${esc(top.targetLabel)} (${top.avgScore})</div>` : ''}`;
    li.onclick = () => showRun(r.id);
    list.appendChild(li);
  }
}

let sortState = { key: 'score', dir: -1 };
async function showRun(id) {
  const run = await api(`/api/runs/${id}`);
  const detail = $('#run-detail');
  const lb = (run.summary || []).map((row) => `<tr class="${row.rank === 1 ? 'rank1' : ''}">
    <td>#${row.rank}</td><td>${esc(row.targetLabel)}</td>
    <td class="score s${Math.round(row.avgScore)}">${row.avgScore ?? '—'}</td>
    <td>${row.avgLatencyMs ?? '—'}ms</td><td>${row.count}</td><td>${row.errors || 0}</td></tr>`).join('');

  const rows = [...run.results].sort(cmp);
  const table = rows.map((r) => `
    <tr class="result-row ${r.muted ? 'muted-row' : ''}">
      <td>${esc(r.promptTitle)}<div class="muted">${esc(r.category)}</div></td>
      <td>${esc(r.targetLabel)}</td>
      <td>${r.error ? '<span class="err">ERR</span>' : `<span class="score s${r.score}">${r.score ?? '—'}</span>`}</td>
      <td>${r.latencyMs ?? '—'}ms</td>
      <td>
        ${(r.tags || []).map((t) => `<span class="tag">${esc(t)}</span>`).join('')}
        <details>
          <summary>inspect</summary>
          ${r.error ? `<p class="err">${esc(r.error)}</p>` : ''}
          <p><strong>Answer</strong><br>${esc(r.answer || '').slice(0, 1200) || '—'}</p>
          ${r.thinking ? `<details><summary>thinking (not judged)</summary><pre class="muted" style="white-space:pre-wrap">${esc(r.thinking).slice(0, 2000)}</pre></details>` : ''}
          <p><strong>Judge (${esc(r.judgeModel || '')})</strong><br>${esc(r.judgeReasoning || '')}</p>
          <div class="row">
            <button class="ghost pill-btn" data-mute="${r.id}">${r.muted ? 'unmute' : 'mute'}</button>
            <button class="ghost pill-btn" data-tag="${r.id}">tag</button>
          </div>
        </details>
      </td>
    </tr>`).join('');

  detail.innerHTML = `
    <h3>${esc(run.name)} — ${new Date(run.startedAt).toLocaleString()}</h3>
    <table><thead><tr><th>Rank</th><th>Model</th><th>Avg score</th><th>Avg latency</th><th>n</th><th>err</th></tr></thead><tbody>${lb}</tbody></table>
    <h3>Per-prompt results <small class="muted">(click a column to sort)</small></h3>
    <table><thead><tr>
      <th data-sort="promptTitle">Prompt</th><th data-sort="targetLabel">Model</th>
      <th data-sort="score">Score</th><th data-sort="latencyMs">Latency</th><th>Detail</th>
    </tr></thead><tbody>${table}</tbody></table>`;

  $$('#run-detail th[data-sort]').forEach((th) => th.style.cursor = 'pointer');
  $$('#run-detail th[data-sort]').forEach((th) => th.onclick = () => {
    const key = th.dataset.sort;
    sortState = { key, dir: sortState.key === key ? -sortState.dir : -1 };
    showRun(id);
  });
  $$('#run-detail [data-mute]').forEach((b) => b.onclick = async () => {
    const r = run.results.find((x) => x.id === b.dataset.mute);
    await api(`/api/runs/${id}/results/${b.dataset.mute}`, { method: 'PATCH', body: JSON.stringify({ muted: !r.muted }) });
    showRun(id);
  });
  $$('#run-detail [data-tag]').forEach((b) => b.onclick = async () => {
    const r = run.results.find((x) => x.id === b.dataset.tag);
    const t = prompt('Tags (comma separated):', (r.tags || []).join(', '));
    if (t === null) return;
    await api(`/api/runs/${id}/results/${b.dataset.tag}`, { method: 'PATCH', body: JSON.stringify({ tags: t.split(',').map((s) => s.trim()).filter(Boolean) }) });
    showRun(id);
  });
}

function cmp(a, b) {
  const k = sortState.key;
  const av = a[k] ?? (typeof a[k] === 'number' ? -1 : '');
  const bv = b[k] ?? (typeof b[k] === 'number' ? -1 : '');
  if (typeof av === 'number' || typeof bv === 'number') return ((av ?? -1) - (bv ?? -1)) * sortState.dir;
  return String(av).localeCompare(String(bv)) * sortState.dir;
}

// ---------- boot ----------
async function refreshAll() { await loadProviders(); await loadPrompts(); }
refreshAll();
// seed one empty target row once providers are known
setTimeout(() => { if (providers.length && !$('#target-list').children.length) $('#add-target').click(); }, 300);
