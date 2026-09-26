// Hidden test bench: runs a folder of photos through /api/ask and lets you grade each reply.
// Only replies and ratings are stored (localStorage). Photos stay in memory.

const KEY = 'eyes.test.v1';
const $ = (id) => document.getElementById(id);
const DEFAULT_Q = 'Describe what you see.';

let items = []; // { name, file, url, question }
let results = loadResults();

function loadResults() {
  try {
    return JSON.parse(localStorage.getItem(KEY) || '{}');
  } catch {
    return {};
  }
}
function saveResults() {
  try {
    localStorage.setItem(KEY, JSON.stringify(results));
  } catch {}
}

const lang = () => $('lang').value;
const provider = () => $('provider').value;
const keyOf = (item) => `${item.name}|${lang()}|${provider() || 'auto'}`;

// ---------- loading ----------

function parseCsv(text) {
  const rows = [];
  let row = [];
  let cell = '';
  let q = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (q) {
      if (c === '"' && text[i + 1] === '"') (cell += '"'), i++;
      else if (c === '"') q = false;
      else cell += c;
    } else if (c === '"') q = true;
    else if (c === ',') row.push(cell), (cell = '');
    else if (c === '\n' || c === '\r') {
      if (c === '\r' && text[i + 1] === '\n') i++;
      row.push(cell), rows.push(row), (row = []), (cell = '');
    } else cell += c;
  }
  if (cell || row.length) row.push(cell), rows.push(row);
  return rows.filter((r) => r.some((x) => x.trim()));
}

async function readQuestions(files) {
  const map = {};
  for (const f of files) {
    const name = f.name.toLowerCase();
    if (name === 'questions.json') {
      const j = JSON.parse(await f.text());
      if (Array.isArray(j)) j.forEach((r) => (map[r.file] = r.question));
      else Object.assign(map, j);
    } else if (name.endsWith('.csv')) {
      const rows = parseCsv((await f.text()).replace(/^﻿/, ''));
      if (rows[0] && /file/i.test(rows[0][0])) rows.shift();
      rows.forEach(([file, question]) => file && (map[file.trim()] = (question || '').trim()));
    }
  }
  return map;
}

async function load(fileList) {
  const files = [...fileList];
  const questions = await readQuestions(files);
  items.forEach((it) => URL.revokeObjectURL(it.url));
  items = files
    .filter((f) => f.type.startsWith('image/'))
    .sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true }))
    .map((f) => ({ name: f.name, file: f, url: URL.createObjectURL(f), question: questions[f.name] || DEFAULT_Q }));
  render();
}

// ---------- running ----------

async function toJpegBase64(file, maxSide = 1280) {
  const bmp = await createImageBitmap(file);
  const scale = Math.min(1, maxSide / Math.max(bmp.width, bmp.height));
  const c = document.createElement('canvas');
  c.width = Math.round(bmp.width * scale);
  c.height = Math.round(bmp.height * scale);
  c.getContext('2d').drawImage(bmp, 0, 0, c.width, c.height);
  bmp.close?.();
  return c.toDataURL('image/jpeg', 0.85).split(',')[1];
}

async function runOne(item) {
  const key = keyOf(item);
  const prev = results[key];
  const started = performance.now();
  try {
    const r = await fetch('/api/ask', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ image: await toJpegBase64(item.file), mime: 'image/jpeg', question: item.question, lang: lang(), provider: provider() || undefined }),
    });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(j.error || `HTTP ${r.status}`);
    results[key] = {
      file: item.name,
      question: item.question,
      lang: lang(),
      ai: j.tokens?.model ? `${j.provider} · ${j.tokens.model}` : j.provider || provider() || 'auto',
      tokensIn: j.tokens?.in ?? '',
      tokensOut: j.tokens?.out ?? '',
      reply: j.answer,
      ms: Math.round(performance.now() - started),
      at: new Date().toISOString(),
      // A new reply needs a fresh rating unless the question and reply are unchanged.
      rating: prev && prev.reply === j.answer && prev.question === item.question ? prev.rating : '',
    };
  } catch (e) {
    results[key] = { ...(prev || {}), file: item.name, question: item.question, lang: lang(), error: String(e.message || e), at: new Date().toISOString() };
  }
  saveResults();
}

async function runAll(onlyMissing) {
  const todo = items.filter((it) => !onlyMissing || !results[keyOf(it)]?.reply);
  if (!todo.length) return;
  setBusy(true);
  let n = 0;
  for (const it of todo) {
    $('summary').textContent = `Running ${++n} of ${todo.length}: ${it.name}…`;
    await runOne(it);
    render();
  }
  setBusy(false);
  render();
}

function setBusy(b) {
  ['run', 'run-missing', 'clear', 'folder', 'files'].forEach((id) => ($(id).disabled = b));
}

// ---------- screen ----------

function render() {
  const body = $('rows');
  body.innerHTML = '';
  for (const it of items) {
    const res = results[keyOf(it)];
    const tr = document.createElement('tr');

    const tdImg = document.createElement('td');
    const img = new Image();
    img.src = it.url;
    img.alt = '';
    const name = document.createElement('div');
    name.className = 'name';
    name.textContent = it.name;
    tdImg.append(img, name);

    const tdQ = document.createElement('td');
    const ta = document.createElement('textarea');
    ta.value = it.question;
    ta.setAttribute('aria-label', `Question for ${it.name}`);
    ta.addEventListener('change', () => (it.question = ta.value.trim() || DEFAULT_Q));
    tdQ.append(ta);

    const tdR = document.createElement('td');
    const reply = document.createElement('div');
    reply.className = 'reply';
    const meta = document.createElement('div');
    meta.className = 'meta';
    if (res?.reply) {
      reply.textContent = res.reply;
      const tok = res.tokensIn !== undefined && res.tokensIn !== '' ? ` · ${res.tokensIn} in / ${res.tokensOut} out tokens` : '';
      meta.textContent = `${res.ai} · ${(res.ms / 1000).toFixed(1)} s${tok}${res.question !== it.question ? ' · asked: ' + res.question : ''}`;
    }
    if (res?.error) {
      const err = document.createElement('div');
      err.className = 'err';
      err.textContent = `Error: ${res.error}`;
      tdR.append(err);
    }
    const again = document.createElement('button');
    again.type = 'button';
    again.textContent = 'Run this one';
    again.addEventListener('click', async () => {
      again.disabled = true;
      await runOne(it);
      render();
    });
    tdR.prepend(reply, meta);
    tdR.append(again);

    const tdRate = document.createElement('td');
    const rate = document.createElement('div');
    rate.className = 'rate';
    rate.setAttribute('role', 'group');
    rate.setAttribute('aria-label', `Rating for ${it.name}`);
    for (const [r, label] of [
      ['correct', 'Correct'],
      ['partly', 'Partly'],
      ['wrong', 'Wrong'],
    ]) {
      const b = document.createElement('button');
      b.type = 'button';
      b.dataset.r = r;
      b.textContent = label;
      b.disabled = !res?.reply;
      b.setAttribute('aria-pressed', String(res?.rating === r));
      b.addEventListener('click', () => {
        results[keyOf(it)].rating = res.rating === r ? '' : r;
        saveResults();
        render();
      });
      rate.append(b);
    }
    tdRate.append(rate);

    tr.append(tdImg, tdQ, tdR, tdRate);
    body.append(tr);
  }
  summarise();
}

function summarise() {
  const all = Object.values(results).filter((r) => r.reply);
  const c = { correct: 0, partly: 0, wrong: 0, '': 0 };
  all.forEach((r) => c[r.rating || '']++);
  const rated = c.correct + c.partly + c.wrong;
  const score = rated ? Math.round(((c.correct + c.partly / 2) / rated) * 100) : 0;
  $('summary').textContent =
    `${items.length} photos loaded · ${all.length} replies saved · ✓ ${c.correct} correct · ~ ${c.partly} partly · ✗ ${c.wrong} wrong · ${c['']} not rated` +
    (rated ? ` · score ${score}%` : '');
}

// ---------- export ----------

function exportCsv() {
  const cols = ['file', 'question', 'lang', 'ai', 'reply', 'rating', 'ms', 'tokensIn', 'tokensOut', 'at'];
  const esc = (v) => `"${String(v ?? '').replace(/"/g, '""')}"`;
  const lines = [cols.join(',')].concat(
    Object.values(results)
      .filter((r) => r.reply)
      .sort((a, b) => a.file.localeCompare(b.file, undefined, { numeric: true }))
      .map((r) => cols.map((k) => esc(r[k])).join(','))
  );
  // The BOM makes Excel open Arabic and Malayalam text correctly.
  const blob = new Blob(['﻿' + lines.join('\r\n')], { type: 'text/csv;charset=utf-8' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `eyes-test-results-${new Date().toISOString().slice(0, 10)}.csv`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}

// ---------- wire up ----------

$('folder').addEventListener('change', (e) => load(e.target.files));
$('files').addEventListener('change', (e) => load(e.target.files));
$('lang').addEventListener('change', render);
$('provider').addEventListener('change', render);
$('run').addEventListener('click', () => runAll(false));
$('run-missing').addEventListener('click', () => runAll(true));
$('export').addEventListener('click', exportCsv);
$('clear').addEventListener('click', () => {
  if (!confirm('Delete all saved replies and ratings?')) return;
  results = {};
  saveResults();
  render();
});
fetch('/api/health')
  .then((r) => r.json())
  .then((h) => {
    if (!h.gemini) $('provider').querySelector('[value="gemini"]').disabled = true;
    if (!h.openrouter) $('provider').querySelector('[value="openrouter"]').disabled = true;
  })
  .catch(() => {});
render();
