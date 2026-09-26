// The brain of the app: a small state machine driven by one giant tap target.
//   start → ready ⇄ listening → thinking → answer → listening …
//   double-tap: new photo · long-press: repeat answer · hold 3 s: settings
//   swipe left/right: change mode (Ask, Read, Money, Light, Qibla) · swipe up: share the answer
import { t, setLang, LANG_ORDER } from './i18n.js';
import { settings, save, applyLook, RATES, SIZES, THEMES, step } from './settings.js';
import { sounds, vibrate, liveTone } from './sounds.js';
import { speak, stopSpeaking, unlockVoice, enableServerVoice, splitSentences, preload } from './voice.js';
import { startCamera, stopCamera, capture, toJpegBase64, checkQuality, cameraRunning } from './camera.js';
import { startListening, useServerStt } from './listen.js';
import { matchCommand } from './commands.js';
import { initGlass } from './glass.js';
import { startLight, lightWord, startQibla } from './sensors.js';

const TIMING = { LONG: 700, SETTINGS: 3000, DOUBLE: 320, DEBOUNCE: 500, ASK_TIMEOUT: 35000 };
const MODES = ['ask', 'read', 'money', 'light', 'qibla'];
const DEMO = new URLSearchParams(location.search).has('demo');

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
  srMode: $('sr-mode'),
  srShare: $('sr-share'),
  modeIcon: $('mode-icon'),
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
let mode = MODES.includes(settings.mode) ? settings.mode : 'ask';
let sensor = null; // the running light meter or Qibla compass

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
// live = a reading that changes several times a second (light, Qibla): update the words in place, no animation.
function fit(text, maxPt = settings.textPt, live = false) {
  let span = live && el.message.firstElementChild;
  if (span) span.textContent = text;
  else {
    el.message.innerHTML = '';
    span = document.createElement('span');
    span.textContent = text;
    el.message.append(span);
  }
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

function readyPrompt() {
  return mode === 'ask' ? t('ready') : t(`modes.${mode}.hint`);
}

const MODE_ICON = { ask: 'i-cam', read: 'i-text', money: 'i-money', light: 'i-sun', qibla: 'i-kaaba' };
function showMode() {
  el.body.dataset.mode = mode;
  el.modeIcon.setAttribute('href', `#${MODE_ICON[mode]}`);
  document.querySelectorAll('.dots i').forEach((d, i) => d.classList.toggle('on', MODES[i] === mode));
}

// Buttons keep their icon; only the words in .v change.
const label = (btn, text) => ((btn.querySelector('.v') || btn).textContent = text);

function updateLabels() {
  const prompt = {
    start: t('tapToStart'),
    ready: readyPrompt(),
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
    ready: mode === 'ask' ? t('sr.takePhoto') : t(`modes.${mode}.name`),
    listening: t('sr.stop'),
    thinking: t('sr.wait'),
    answer: t('sr.askAgain'),
  }[state];
  if (main) label(el.srMain, main);
  el.srMain.setAttribute('aria-disabled', state === 'thinking' ? 'true' : 'false');
  label(el.srNew, t('sr.newPhoto'));
  label(el.srRepeat, t('sr.repeat'));
  label(el.srSettings, t('sr.settings'));
  label(el.srMode, t('sr.mode', { m: t(`modes.${mode}.name`) }));
  label(el.srShare, t('sr.share'));
  el.srMode.hidden = state !== 'ready';
  el.srShare.hidden = state !== 'answer' || !lastAnswer;
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
  let x0 = 0;
  let y0 = 0;
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
    x0 = e.clientX;
    y0 = e.clientY;
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
  // A finger that moves is a swipe, not a press: cancel the long-press timers.
  el.stage.addEventListener('pointermove', (e) => {
    if (down && Math.hypot(e.clientX - x0, e.clientY - y0) > 24) {
      clearTimeout(longTimer);
      clearTimeout(settingsTimer);
    }
  });
  el.stage.addEventListener('pointerup', (e) => {
    if (!down) return;
    clear();
    if (longFired) return;
    const dx = e.clientX - x0;
    const dy = e.clientY - y0;
    if (Math.abs(dx) > 70 && Math.abs(dx) > Math.abs(dy) * 1.4) return onSwipe(dx < 0 ? 1 : -1);
    if (dy < -80 && Math.abs(dy) > Math.abs(dx) * 1.4) return onSwipeUp();
    rawTap();
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
  el.srMode.addEventListener('click', () => changeMode(1));
  el.srShare.addEventListener('click', shareAnswer);

  document.addEventListener('keydown', (e) => {
    if (state === 'settings') {
      if (e.key === 'Escape') closeSettings();
      return;
    }
    if (e.key === 'n' || e.key === 'Escape') onDoubleTap();
    else if (e.key === 'r') onLongPress();
    else if (e.key === 's') openSettings();
    else if (e.key === 'ArrowRight') onSwipe(1);
    else if (e.key === 'ArrowLeft') onSwipe(-1);
    else if (e.key === 'ArrowUp') onSwipeUp();
  });
}

// ---------- actions ----------

function onTap() {
  switch (state) {
    case 'start':
      return begin();
    case 'ready':
      if (mode === 'light') return toggleLight();
      if (mode === 'qibla') return toggleQibla();
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
  if (state === 'ready') {
    if (sensor) return stopSensorsAndSay();
    return say(readyPrompt());
  }
  return onTap();
}

function onSwipe(dir) {
  if (!['ready', 'answer'].includes(state)) return;
  changeMode(dir);
}

function changeMode(dir) {
  mode = MODES[(MODES.indexOf(mode) + dir + MODES.length) % MODES.length];
  settings.mode = mode;
  save();
  showMode();
  sounds.tap();
  vibrate(25);
  goReady();
}

function onSwipeUp() {
  if (state === 'answer') shareAnswer();
}

// Must run straight from the gesture: phones only open the share sheet after a real touch.
function shareAnswer() {
  if (!lastAnswer) return;
  if (!navigator.share) {
    sounds.error();
    return say(t('shareFail'), { display: false });
  }
  navigator
    .share({ title: t('appName'), text: lastAnswer })
    .then(() => say(t('shared'), { display: false }))
    .catch(() => {});
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
  else if (my === op) show(readyPrompt());
}

function stopSensors() {
  sensor?.stop();
  sensor = null;
  delete el.body.dataset.running;
  delete el.body.dataset.facing;
}

function stopSensorsAndSay() {
  const was = el.body.dataset.running;
  stopSensors();
  ++op;
  return say(t(was === 'qibla' ? 'qiblaStopped' : 'lightStopped'));
}

function cancelWork() {
  stopSensors();
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
  let prompt = prefix ? `${prefix} ${readyPrompt()}` : readyPrompt();
  if (!settings.swipeHintShown) {
    prompt += ` ${t('swipeHint')}`;
    settings.swipeHintShown = true;
    save();
  }
  await say(prompt);
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
  // Read and Money modes need no question: go straight to the answer.
  if (mode === 'read') return ask(t('readQuestion'), my);
  if (mode === 'money') return ask(t('moneyQuestion'), my);
  listen(t('photoTaken'));
}

// ---------- light meter (no AI, no internet) ----------

function toggleLight() {
  if (sensor) return stopSensorsAndSay();
  const my = ++op;
  stopSpeaking();
  const tone = liveTone();
  let lastWord = null;
  let lastSpoke = Date.now() + 2500; // let the first instruction finish
  let lastShown = 0;
  const run = startLight(
    el.video,
    (level) => {
      if (my !== op) return;
      tone.set(level);
      el.body.style.setProperty('--light', level.toFixed(2));
      const word = lightWord(level);
      const now = Date.now();
      if (word !== lastWord || now - lastShown > 1000) {
        lastShown = now;
        fit(t('lightLevel', { word: t(`lightWords.${word}`), n: Math.round(level * 100) }), settings.textPt, true);
      }
      if (word !== lastWord && now > lastSpoke) {
        lastSpoke = now + 1500;
        settings.srMode ? announce(t(`lightWords.${word}`)) : speak(t(`lightWords.${word}`));
      }
      lastWord = word;
    },
    DEMO
  );
  sensor = {
    stop: () => {
      run.stop();
      tone.stop();
    },
  };
  el.body.dataset.running = 'light';
  vibrate(40);
  speak(t('lightOn'));
  if (settings.srMode) announce(t('lightOn'));
}

// ---------- Qibla compass (location stays on the phone) ----------

async function toggleQibla() {
  if (sensor) return stopSensorsAndSay();
  const my = ++op;
  stopSpeaking();
  let lastTick = 0;
  let lastSpoke = Date.now() + 2500; // let the first instruction finish
  let lastText = '';
  // startQibla asks the iPhone for compass permission inside this tap, before anything else.
  const pending = startQibla((turn) => {
    if (my !== op) return;
    el.body.style.setProperty('--qibla', `${turn.toFixed(1)}deg`);
    const off = Math.abs(turn);
    const now = Date.now();
    if (off < 8) {
      if (el.body.dataset.facing !== 'yes') {
        el.body.dataset.facing = 'yes';
        sounds.found();
        vibrate([60, 40, 60, 40, 200]);
        lastSpoke = now;
        fit(t('facing'));
        settings.srMode ? announce(t('facing')) : speak(t('facing'));
      }
      return;
    }
    if (el.body.dataset.facing === 'yes' && off < 20) return; // stay "found" through small wobbles
    el.body.dataset.facing = 'no';
    if (now - lastTick > 180 + off * 5) {
      lastTick = now;
      sounds.tick(1 - off / 180);
    }
    const text = `${turn < 0 ? '←' : '→'} ${Math.round(off / 5) * 5}°`;
    if (text !== lastText) {
      lastText = text;
      fit(text, settings.textPt, true);
    }
    if (now - lastSpoke > 3000) {
      lastSpoke = now;
      const words = t(turn < 0 ? 'turnLeft' : 'turnRight');
      settings.srMode ? announce(words) : speak(words);
    }
  }, DEMO);
  let cancelled = false;
  sensor = { stop: () => (cancelled = true) };
  el.body.dataset.running = 'qibla';
  say(t('qiblaStart'));
  try {
    const compass = await pending;
    if (cancelled || my !== op) return compass.stop();
    sensor = compass;
  } catch (e) {
    if (cancelled || my !== op) return;
    stopSensors();
    sounds.error();
    say(t(e.message === 'no-location' ? 'noLocation' : 'noCompass'));
  }
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
  if (my !== op) return;
  await say(t('tapAgain'), { display: false });
  if (my === op && !settings.shareHintShown && navigator.share) {
    settings.shareHintShown = true;
    save();
    await say(t('shareHint'), { display: false });
  }
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
    case 'read':
    case 'money':
      // "Read" / "Money" said about the current photo: answer it right away.
      if (photo) return ask(t(cmd === 'read' ? 'readQuestion' : 'moneyQuestion'), my);
      mode = cmd;
      settings.mode = mode;
      save();
      showMode();
      return goReady();
    case 'light':
    case 'qibla':
    case 'ask':
      mode = cmd;
      settings.mode = mode;
      save();
      showMode();
      return goReady();
    case 'share':
      msg = t('shareHint');
      break;
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
  // App hidden: stop microphone, camera, sensors and speech right away.
  stopSensors();
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
  preload([readyPrompt(), t('photoTaken'), t('askNow'), t('tapAgain'), t('newPhoto'), ...MODES.map((m) => t(`modes.${m}.hint`))], settings.lang);
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
showMode();
el.body.classList.toggle('sr', settings.srMode);
bindGestures();
bindSettings();
initGlass({ video: el.video, photo: el.photo, body: el.body });
checkServer();
showStart();
