// The brain of the app: a small state machine driven by one giant tap target.
//   start → ready ⇄ listening → thinking → answer → listening …
//   double-tap: new photo · long-press: repeat answer · hold 3 s: settings
import { t, setLang, LANG_ORDER } from './i18n.js';
import { settings, save, applyLook, RATES, SIZES, THEMES, step } from './settings.js';
import { sounds, vibrate } from './sounds.js';
import { speak, stopSpeaking, unlockVoice, enableServerVoice, splitSentences, preload } from './voice.js';
import { startCamera, stopCamera, capture, toJpegBase64, checkQuality, cameraRunning } from './camera.js';
import { startListening, useServerStt } from './listen.js';
import { matchCommand } from './commands.js';
import { initGlass } from './glass.js';

const TIMING = { LONG: 700, SETTINGS: 3000, DOUBLE: 320, DEBOUNCE: 500, ASK_TIMEOUT: 35000 };

const $ = (id) => document.getElementById(id);
const el = {
  body: document.body,
  video: $('video'),
  photo: $('photo'),
  stage: $('stage'),
  statusWord: $('status-word'),
  message: $('message'),
  flash: $('flash'),
  welcomeSr: $('welcome-sr'),
  srMain: $('sr-main'),
  srNew: $('sr-new'),
  srRepeat: $('sr-repeat'),
  srSettings: $('sr-settings'),
  settings: $('settings'),
  wordmark: $('wordmark'),
  liveStatus: $('live-status'),
  liveMessage: $('live-message'),
};

let state = 'start';
let op = 0; // bumped by every new action; older async work sees the change and quietly stops
let photo = null; // { base64, url } — kept in memory only, never saved
let history = []; // questions and answers about the current photo
let lastAnswer = '';
let recorderP = null;
let prompting = false;
let blurStrikes = 0;
let abort = null;
let returnState = 'ready';
let wakeLock = null;

// ---------- screen ----------

function setState(s) {
  state = s;
  el.body.dataset.state = s;
  el.statusWord.textContent = t(`status.${s}`);
  el.liveStatus.textContent = t(`status.${s}`);
  if (s !== 'start') vibrate(40);
  el.body.dataset.photo = photo && ['listening', 'thinking', 'answer'].includes(s) ? 'on' : 'off';
  updateLabels();
}

const overflows = (inner) => inner.offsetHeight > el.message.clientHeight + 1 || inner.scrollWidth > el.message.clientWidth + 1;

// Shows text as big as the chosen size, shrinking toward 32pt only if it does not fit.
// Returns the size used, or 0 if it does not fit even at 32pt.
function fit(text, maxPt = settings.textPt) {
  el.message.innerHTML = '';
  const span = document.createElement('span');
  span.textContent = text;
  el.message.append(span);
  let pt = maxPt;
  el.message.style.fontSize = `${pt}pt`;
  while (overflows(span) && pt > 32) {
    pt -= 2;
    el.message.style.fontSize = `${pt}pt`;
  }
  return overflows(span) ? 0 : pt;
}

let paging = false;
let pagePt = 32;
function show(text) {
  paging = !fit(text);
  // Too long even at 32pt: show one sentence at a time, in step with the voice,
  // all at the same size so the text does not jump around.
  if (paging) {
    const parts = splitSentences(text);
    pagePt = Math.min(...parts.map((p) => fit(p) || 32));
    fit(parts[0], pagePt);
  }
  if (settings.srMode) announce(text);
}

function announce(text) {
  el.liveMessage.textContent = '';
  setTimeout(() => (el.liveMessage.textContent = text), 60);
}

async function say(text, { display = true } = {}) {
  if (display) show(text);
  else if (settings.srMode) announce(text);
  await speak(text, { onSentence: paging && display ? (i, s) => i >= 0 && fit(s, pagePt) : undefined });
}

function flash() {
  el.flash.classList.remove('go');
  void el.flash.offsetWidth;
  el.flash.classList.add('go');
}

// Buttons keep their icon; only the words in .v change.
const label = (btn, text) => ((btn.querySelector('.v') || btn).textContent = text);

function updateLabels() {
  const prompt = {
    start: t('tapToStart'),
    ready: t('ready'),
    listening: t('sr.stop'),
    thinking: t('sr.wait'),
    answer: t('tapAgain'),
    settings: '',
  }[state];
  el.stage.setAttribute('aria-label', prompt || t('appName'));
  label(el.welcomeSr, t('srModeButton'));
  el.wordmark.textContent = t('appName');
  const main = {
    start: t('start'),
    ready: t('sr.takePhoto'),
    listening: t('sr.stop'),
    thinking: t('sr.wait'),
    answer: t('sr.askAgain'),
  }[state];
  if (main) label(el.srMain, main);
  el.srMain.setAttribute('aria-disabled', state === 'thinking' ? 'true' : 'false');
  label(el.srNew, t('sr.newPhoto'));
  label(el.srRepeat, t('sr.repeat'));
  label(el.srSettings, t('sr.settings'));
  el.srNew.hidden = !['listening', 'thinking', 'answer'].includes(state);
  el.srRepeat.hidden = state !== 'answer';
  el.srSettings.hidden = !['start', 'ready'].includes(state);
}

// ---------- gestures ----------

let lastAction = 0;
let pendingTap = null;

function rawTap() {
  const now = Date.now();
  if (pendingTap) {
    clearTimeout(pendingTap);
    pendingTap = null;
    lastAction = now;
    return onDoubleTap();
  }
  if (now - lastAction < TIMING.DEBOUNCE) return; // accidental extra tap
  vibrate(20);
  // Double-tap means nothing in these states, so act at once for a snappy shutter.
  if (['start', 'ready'].includes(state)) {
    lastAction = now;
    return onTap();
  }
  pendingTap = setTimeout(() => {
    pendingTap = null;
    lastAction = Date.now();
    onTap();
  }, TIMING.DOUBLE);
}

function bindGestures() {
  let down = false;
  let longFired = false;
  let longTimer;
  let settingsTimer;
  const clear = () => {
    clearTimeout(longTimer);
    clearTimeout(settingsTimer);
    down = false;
    el.body.classList.remove('pressing');
  };
  el.stage.addEventListener('pointerdown', (e) => {
    if (!e.isPrimary) return;
    sounds.unlock();
    down = true;
    longFired = false;
    el.body.classList.add('pressing');
    longTimer = setTimeout(() => {
      longFired = true;
      lastAction = Date.now();
      onLongPress();
    }, TIMING.LONG);
    settingsTimer = setTimeout(() => {
      clear();
      openSettings();
    }, TIMING.SETTINGS);
  });
  el.stage.addEventListener('pointerup', () => {
    if (!down) return;
    clear();
    if (!longFired) rawTap();
  });
  el.stage.addEventListener('pointercancel', clear);
  el.stage.addEventListener('contextmenu', (e) => e.preventDefault());
  // Keyboard, switch access and screen readers send a click without pointer events.
  el.stage.addEventListener('click', (e) => e.detail === 0 && rawTap());

  el.welcomeSr.addEventListener('click', () => {
    settings.srMode = true;
    save();
    el.body.classList.add('sr');
    begin();
  });
  el.srMain.addEventListener('click', () => {
    if (Date.now() - lastAction < TIMING.DEBOUNCE) return;
    lastAction = Date.now();
    onTap();
  });
  el.srNew.addEventListener('click', onDoubleTap);
  el.srRepeat.addEventListener('click', onLongPress);
  el.srSettings.addEventListener('click', openSettings);

  document.addEventListener('keydown', (e) => {
    if (state === 'settings') {
      if (e.key === 'Escape') closeSettings();
      return;
    }
    if (e.key === 'n' || e.key === 'Escape') onDoubleTap();
    else if (e.key === 'r') onLongPress();
    else if (e.key === 's') openSettings();
  });
}

// ---------- actions ----------

function onTap() {
  switch (state) {
    case 'start':
      return begin();
    case 'ready':
      return takePhoto();
    case 'listening':
      return prompting ? stopSpeaking() : finishListening();
    case 'answer':
      return listen(t('askNow'));
    default: // thinking: ignore every tap
  }
}

function onDoubleTap() {
  if (['listening', 'thinking', 'answer'].includes(state)) return newPhoto();
  if (state === 'ready') return say(t('ready'));
  return onTap();
}

async function onLongPress() {
  if (!['ready', 'answer'].includes(state)) return;
  const my = ++op;
  vibrate([30, 50, 30]);
  if (!lastAnswer) return say(t('nothingToRepeat'), { display: state === 'answer' });
  const back = state;
  if (back === 'answer') setState('answer');
  await say(lastAnswer);
  if (my === op && back === 'answer') await say(t('tapAgain'), { display: false });
  else if (my === op) show(t('ready'));
}

function cancelWork() {
  stopSpeaking();
  sounds.thinkingStop();
  abort?.abort();
  abort = null;
  recorderP?.then((r) => r.cancel()).catch(() => {});
  recorderP = null;
  prompting = false;
  el.body.classList.remove('recording');
}

async function begin() {
  unlockVoice();
  sounds.unlock();
  requestWakeLock();
  goReady();
}

async function showDisclaimer() {
  el.body.classList.add('disclaimer');
  await say(t('disclaimer'));
  el.body.classList.remove('disclaimer');
  settings.disclaimerShown = true;
  save();
}

async function goReady(prefix) {
  cancelWork();
  const my = ++op;
  photo = null;
  history = [];
  blurStrikes = 0;
  el.photo.removeAttribute('src');
  setState('ready');
  if (!settings.disclaimerShown) await showDisclaimer();
  if (my !== op) return;
  const cam = startCamera(el.video)
    .then(() => (el.body.dataset.camera = 'on'))
    .catch(async () => {
      if (my !== op) return;
      sounds.error();
      await say(t('noCamera'));
    });
  await say(prefix ? `${prefix} ${t('ready')}` : t('ready'));
  await cam;
}

function newPhoto() {
  cancelWork();
  sounds.stop();
  goReady(t('newPhoto'));
}

async function takePhoto() {
  const my = ++op;
  stopSpeaking();
  if (!cameraRunning()) {
    try {
      await startCamera(el.video);
      el.body.dataset.camera = 'on';
    } catch {
      sounds.error();
      return say(t('noCamera'));
    }
  }
  let canvas;
  try {
    canvas = capture(el.video);
  } catch {
    sounds.error();
    return say(t('noCamera'));
  }
  sounds.shutter();
  flash();
  vibrate([30, 40, 30]);
  const q = checkQuality(canvas);
  el.body.dataset.quality = `${q.mean}/${q.sharpness}`;
  // After two "blurry" warnings in a row, accept the photo anyway (plain walls look "blurry").
  if (!q.ok && !(q.problem === 'blurry' && blurStrikes >= 2)) {
    blurStrikes = q.problem === 'blurry' ? blurStrikes + 1 : 0;
    sounds.error();
    vibrate([90, 60, 90]);
    return say(t(q.problem));
  }
  if (my !== op) return;
  blurStrikes = 0;
  photo = { base64: toJpegBase64(canvas), url: canvas.toDataURL('image/jpeg', 0.7) };
  history = [];
  el.photo.src = photo.url;
  stopCamera(el.video);
  el.body.dataset.camera = 'off';
  listen(t('photoTaken'));
}

async function listen(intro) {
  cancelWork();
  const my = ++op;
  setState('listening');
  prompting = true;
  await say(intro);
  prompting = false;
  if (my !== op) return;
  sounds.listening();
  vibrate(60);
  el.body.classList.add('recording');
  recorderP = startListening(settings.lang, () => my === op && state === 'listening' && finishListening());
  recorderP.then((rec) => meter(rec, my)).catch(() => {});
  recorderP.catch(async () => {
    if (my !== op) return;
    recorderP = null;
    el.body.classList.remove('recording');
    sounds.error();
    await say(t('noMic'));
    if (my === op) ask('', my);
  });
}

// Feeds the microphone loudness to the CSS so the rings and screen edge move with your voice.
function meter(rec, my) {
  let smooth = 0;
  const tick = () => {
    if (my !== op || state !== 'listening') return el.body.style.setProperty('--level', '0');
    smooth = smooth * 0.7 + (rec.level?.() || 0) * 0.3;
    el.body.style.setProperty('--level', smooth.toFixed(3));
    requestAnimationFrame(tick);
  };
  tick();
}

async function finishListening() {
  if (state !== 'listening' || prompting || !recorderP) return;
  const my = ++op;
  const pending = recorderP;
  recorderP = null;
  el.body.classList.remove('recording');
  sounds.stop();
  setState('thinking');
  show(t('thinking'));
  sounds.thinkingStart();
  abort = new AbortController();
  let question = '';
  try {
    const rec = await pending;
    question = await rec.stop(abort.signal);
  } catch (e) {
    if (my !== op || e.name === 'AbortError') return;
    sounds.thinkingStop();
    await say(t('didntHear'));
    if (my !== op) return;
  }
  if (my !== op) return;
  const cmd = matchCommand(question);
  if (cmd) {
    sounds.thinkingStop();
    return runCommand(cmd, my);
  }
  ask(question, my);
}

async function ask(question, my) {
  const q = question.trim() || t('defaultQuestion');
  setState('thinking');
  show(t('thinking'));
  sounds.thinkingStart();
  abort = abort || new AbortController();
  const ctl = abort;
  const timer = setTimeout(() => ctl.abort(), TIMING.ASK_TIMEOUT);
  let answer = '';
  try {
    const r = await fetch('/api/ask', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ image: photo.base64, mime: 'image/jpeg', question: q, lang: settings.lang, history }),
      signal: ctl.signal,
    });
    if (!r.ok) throw new Error(`ask ${r.status}`);
    answer = ((await r.json()).answer || '').trim();
    if (!answer) throw new Error('empty');
  } catch {
    if (my !== op) return;
    clearTimeout(timer);
    abort = null;
    sounds.thinkingStop();
    sounds.error();
    setState('answer');
    return say(t('noAnswer'));
  }
  clearTimeout(timer);
  if (my !== op) return;
  abort = null;
  history.push({ q, a: answer });
  lastAnswer = answer;
  sounds.thinkingStop();
  sounds.answer();
  setState('answer');
  await say(answer);
  if (my === op) await say(t('tapAgain'), { display: false });
}

async function runCommand(cmd, my) {
  let msg;
  switch (cmd) {
    case 'repeat':
      setState('answer');
      if (!lastAnswer) {
        msg = t('nothingToRepeat');
        break;
      }
      await say(lastAnswer);
      if (my === op) await say(t('tapAgain'), { display: false });
      return;
    case 'faster':
    case 'slower': {
      const v = step(RATES, settings.rate, cmd === 'faster' ? 1 : -1);
      if (v === false) msg = t(cmd === 'faster' ? 'fastest' : 'slowest');
      else {
        settings.rate = v;
        msg = t(cmd);
      }
      break;
    }
    case 'louder':
      if (settings.volume >= 1) msg = t('loudest');
      else {
        settings.volume = Math.min(1, Math.round((settings.volume + 0.1) * 10) / 10);
        msg = t('louder');
      }
      break;
    case 'language':
      changeLanguage();
      msg = t('languageName');
      break;
    case 'bigger':
    case 'smaller': {
      const v = step(SIZES, settings.textPt, cmd === 'bigger' ? 1 : -1);
      if (v === false) msg = t(cmd === 'bigger' ? 'biggest' : 'smallest');
      else {
        settings.textPt = v;
        msg = t('textSize', { n: v });
      }
      break;
    }
    case 'theme':
      settings.theme = THEMES[(THEMES.indexOf(settings.theme) + 1) % THEMES.length];
      msg = t(`themeNames.${settings.theme}`);
      break;
    case 'settings':
      return openSettings();
  }
  save();
  applyLook();
  setState('answer');
  await say(msg);
  if (my === op) await say(t('tapAgain'), { display: false });
}

function changeLanguage() {
  settings.lang = LANG_ORDER[(LANG_ORDER.indexOf(settings.lang) + 1) % LANG_ORDER.length];
  setLang(settings.lang);
  save();
  preloadPrompts();
}

// ---------- settings screen ----------

const SETTING_ACTIONS = {
  lang: () => {
    changeLanguage();
    return t('languageName');
  },
  speed: () => {
    settings.rate = RATES[(RATES.indexOf(settings.rate) + 1) % RATES.length];
    return t('settings.speed', { n: `${settings.rate}×` });
  },
  size: () => {
    settings.textPt = SIZES[(SIZES.indexOf(settings.textPt) + 1) % SIZES.length];
    return t('textSize', { n: settings.textPt });
  },
  theme: () => {
    settings.theme = THEMES[(THEMES.indexOf(settings.theme) + 1) % THEMES.length];
    return t(`themeNames.${settings.theme}`);
  },
  sr: () => {
    settings.srMode = !settings.srMode;
    el.body.classList.toggle('sr', settings.srMode);
    return t('settings.sr', { v: t(settings.srMode ? 'settings.on' : 'settings.off') });
  },
};

function renderSettings() {
  const b = (k) => el.settings.querySelector(`[data-set="${k}"]`);
  label(b('lang'), t('languageName'));
  label(b('speed'), t('settings.speed', { n: `${settings.rate}×` }));
  label(b('size'), t('settings.size', { n: settings.textPt }));
  label(b('theme'), t(`themeNames.${settings.theme}`));
  label(b('sr'), t('settings.sr', { v: t(settings.srMode ? 'settings.on' : 'settings.off') }));
  label(b('done'), t('settings.done'));
  label($('settings-title'), t('status.settings'));
}

function openSettings() {
  if (['settings', 'thinking'].includes(state)) return;
  returnState = state === 'start' ? 'start' : photo ? 'answer' : 'ready';
  cancelWork();
  ++op;
  setState('settings');
  el.settings.hidden = false;
  renderSettings();
  el.settings.querySelector('.row').focus();
  say(t('settings.open'), { display: false });
}

function closeSettings() {
  el.settings.hidden = true;
  applyLook();
  if (returnState === 'start') return showStart();
  if (returnState === 'answer' && photo) {
    ++op;
    setState('answer');
    show(lastAnswer || t('tapAgain'));
    return say(t('tapAgain'), { display: false });
  }
  goReady();
}

function bindSettings() {
  el.settings.addEventListener('click', (e) => {
    const btn = e.target.closest('[data-set]');
    if (!btn) return;
    vibrate(30);
    sounds.tap();
    const key = btn.dataset.set;
    if (key === 'done') return closeSettings();
    const msg = SETTING_ACTIONS[key]();
    save();
    applyLook();
    renderSettings();
    updateLabels();
    say(msg, { display: false });
  });
}

// ---------- phone housekeeping ----------

async function requestWakeLock() {
  try {
    wakeLock = await navigator.wakeLock?.request('screen');
  } catch {}
}

document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible') {
    if (state !== 'start') requestWakeLock();
    if (state === 'ready' && !cameraRunning()) startCamera(el.video).then(() => (el.body.dataset.camera = 'on')).catch(() => {});
    return;
  }
  // App hidden: stop microphone, camera and speech right away.
  if (['listening', 'thinking'].includes(state)) {
    cancelWork();
    ++op;
    setState(photo ? 'answer' : 'ready');
    show(t('cancelled'));
  }
  stopSpeaking();
  stopCamera(el.video);
  el.body.dataset.camera = 'off';
});

window.addEventListener('resize', () => {
  const span = el.message.firstElementChild;
  if (span && !paging) fit(span.textContent);
});

async function checkServer() {
  try {
    const h = await (await fetch('/api/health')).json();
    useServerStt(h.transcribe);
    enableServerVoice(h.voice === 'elevenlabs' ? 'always' : false);
    preloadPrompts();
  } catch {
    useServerStt(false);
  }
}

function preloadPrompts() {
  preload([t('ready'), t('photoTaken'), t('askNow'), t('tapAgain'), t('newPhoto')], settings.lang);
}

function showStart() {
  ++op;
  setState('start');
  show(t('tapToStart'));
}

// ---------- boot ----------

// Keep the message sheet clear of the welcome button, however many lines it wraps to.
new ResizeObserver(() => {
  el.body.style.setProperty('--welcome-h', `${el.welcomeSr.offsetHeight || 88}px`);
  const span = el.message.firstElementChild;
  if (span && !paging) fit(span.textContent);
}).observe(el.welcomeSr);

if (new URLSearchParams(location.search).get('sr') === '1') settings.srMode = true;
setLang(settings.lang);
applyLook();
el.body.classList.toggle('sr', settings.srMode);
bindGestures();
bindSettings();
initGlass({ video: el.video, photo: el.photo, body: el.body });
checkServer();
showStart();
