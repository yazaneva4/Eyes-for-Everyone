// The brain of the app: a small state machine driven by one giant tap target.
//   start → ready ⇄ listening → thinking → answer → listening …
//   double-tap: new photo · long-press: repeat answer · hold 3 s: settings
//   swipe left/right or tap a mode name: change mode (Ask, Read, Money, Color, Light, Qibla) · swipe down: open a picture
//   the dock (gallery · shutter · one changing action) and top bar (help · settings) do the same things with buttons
//   laptop/PC: Space = tap, arrows = modes, N/R/O/S/H keys, drop or paste a picture
import { t, setLang, LANG_ORDER } from './i18n.js';
import { settings, save, applyLook, RATES, SIZES, THEMES, step } from './settings.js';
import { sounds, vibrate, liveTone } from './sounds.js';
import { speak, stopSpeaking, unlockVoice, enableServerVoice, splitSentences, preload } from './voice.js';
import { startCamera, stopCamera, capture, toJpegBase64, checkQuality, cameraRunning } from './camera.js';
import { startListening, useServerStt } from './listen.js';
import { matchCommand } from './commands.js';
import { initGlass } from './glass.js';
import { startLight, lightWord, startQibla, compassPoint, centerColor, nameColor } from './sensors.js';

const TIMING = { LONG: 700, SETTINGS: 3000, DOUBLE: 320, DEBOUNCE: 500, ASK_TIMEOUT: 35000 };
const MIN_PT = 16;
const MODES = ['ask', 'read', 'money', 'color', 'light', 'qibla'];
// Laptop or PC with a mouse or trackpad: speak keyboard hints instead of touch gestures.
const DESKTOP = matchMedia('(hover: hover) and (pointer: fine)').matches;
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
  srLink: $('sr-link'),
  btnHelp: $('btn-help'),
  btnSettings: $('btn-settings'),
  btnGallery: $('btn-gallery'),
  btnShutter: $('btn-shutter'),
  btnSide: $('btn-side'),
  shutterIcon: $('shutter-icon'),
  sideIcon: $('side-icon'),
  modebar: $('modebar'),
  fileInput: $('file-input'),
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
let pendingPicture = null; // a picture dropped on the page before the first tap

// ---------- screen ----------

function setState(s) {
  state = s;
  el.body.dataset.state = s;
  if (s !== 'answer' && el.body.dataset.sheet !== 'auto') el.body.dataset.sheet = 'auto';
  morph(pill, () => (el.statusWord.textContent = t(`status.${s}`)));
  el.liveStatus.textContent = t(`status.${s}`);
  if (s !== 'start') vibrate(40);
  el.body.dataset.photo = photo && ['listening', 'thinking', 'answer'].includes(s) ? 'on' : 'off';
  updateLabels();
}

// Liquid motion: when a glass panel changes size (new message, new status word),
// it morphs from its old size to the new one instead of jumping.
const REDUCED = matchMedia('(prefers-reduced-motion: reduce)');
function morph(box, change) {
  const a = box.getBoundingClientRect();
  change();
  const b = box.getBoundingClientRect();
  if (REDUCED.matches || !box.animate || (Math.abs(a.width - b.width) < 2 && Math.abs(a.height - b.height) < 2)) return;
  box.animate([{ width: `${a.width}px`, height: `${a.height}px` }, { width: `${b.width}px`, height: `${b.height}px` }], {
    duration: 460,
    easing: 'cubic-bezier(0.22, 1, 0.36, 1)',
  });
}
const sheet = document.querySelector('.sheet');
const grabber = document.getElementById('grabber');
const SHEET_SIZES = ['peek', 'auto', 'full'];
let currentText = '';
const pill = document.querySelector('.pill');

const overflows = (inner) => inner.offsetHeight > el.message.clientHeight + 1 || inner.scrollWidth > el.message.clientWidth + 1;

// Shows text at the chosen size, shrinking toward MIN_PT only if it does not fit.
// Returns the size used, or 0 if it does not fit even at MIN_PT.
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
  while (overflows(span) && pt > MIN_PT) {
    pt -= 2;
    el.message.style.fontSize = `${pt}pt`;
  }
  return overflows(span) ? 0 : pt;
}

let paging = false;
let pagePt = 32;
function show(text) {
  morph(sheet, () => layoutText(text));
  if (settings.srMode) announce(text);
}

function layoutText(text) {
  currentText = text;
  // Peek and full show the text at the chosen size as it is (full scrolls; peek shows one line).
  if (el.body.dataset.sheet !== 'auto') {
    paging = false;
    el.message.innerHTML = '';
    const span = document.createElement('span');
    span.textContent = text;
    el.message.append(span);
    el.message.style.fontSize = `${settings.textPt}pt`;
    return;
  }
  paging = !fit(text);
  // Too long even at the smallest size: show one sentence at a time, in step with the voice,
  // all at the same size so the text does not jump around.
  if (paging) {
    const parts = splitSentences(text);
    pagePt = Math.min(...parts.map((p) => fit(p) || MIN_PT));
    fit(parts[0], pagePt);
  }
}

function announce(text) {
  el.liveMessage.textContent = '';
  setTimeout(() => (el.liveMessage.textContent = text), 60);
}

async function say(text, { display = true } = {}) {
  if (display) show(text);
  else if (settings.srMode) announce(text);
  // Sentence-by-sentence paging only while the sheet is its normal size (checked as each sentence starts).
  await speak(text, { onSentence: display ? (i, s) => paging && el.body.dataset.sheet === 'auto' && i >= 0 && fit(s, pagePt) : undefined });
}

function flash() {
  el.flash.classList.remove('go');
  void el.flash.offsetWidth;
  el.flash.classList.add('go');
}

function readyPrompt() {
  if (mode !== 'ask') return t(`modes.${mode}.hint`);
  return DESKTOP ? t('readyDesktop') : t('ready');
}

const MODE_ICON = { ask: null, read: 'i-text', money: 'i-money', color: 'i-palette', light: 'i-sun', qibla: 'i-kaaba' };
function showMode() {
  el.body.dataset.mode = mode;
  for (const b of el.modebar.children) {
    const on = b.dataset.mode === mode;
    b.setAttribute('aria-selected', on ? 'true' : 'false');
    b.tabIndex = on ? 0 : -1;
    if (on) b.scrollIntoView({ block: 'nearest', inline: 'center', behavior: 'smooth' });
  }
  updateLabels();
}

function setIcon(use, btn, id) {
  btn.dataset.icon = id || 'none';
  if (id) use.setAttribute('href', `#${id}`);
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
  el.wordmark.textContent = t('appName');
  el.srLink.textContent = t('srModeButton');
  $('drop-text').textContent = t('dropHere');
  el.btnHelp.setAttribute('aria-label', t('sr.help'));
  el.btnSettings.setAttribute('aria-label', t('sr.settings'));
  el.btnGallery.setAttribute('aria-label', t('sr.open'));
  for (const b of el.modebar.children) b.textContent = t(`modes.${b.dataset.mode}.name`);

  // The shutter: what one tap does right now.
  const shutter = {
    start: [t('start'), 'i-eye'],
    ready: sensor ? [t('sr.cancel'), 'i-stop'] : [mode === 'ask' ? t('sr.takePhoto') : t(`modes.${mode}.name`), MODE_ICON[mode]],
    listening: [t('sr.stop'), 'i-stop'],
    thinking: [t('sr.wait'), null],
    answer: [t('sr.newPhoto'), 'i-cam'],
  }[state];
  if (shutter) {
    el.btnShutter.setAttribute('aria-label', shutter[0]);
    setIcon(el.shutterIcon, el.btnShutter, shutter[1]);
  }
  el.btnShutter.setAttribute('aria-disabled', state === 'thinking' ? 'true' : 'false');

  // The button on the right changes with the moment: repeat, ask more, or cancel.
  const side = {
    ready: lastAnswer ? [t('sr.repeat'), 'i-redo'] : null,
    listening: [t('sr.cancel'), 'i-x'],
    thinking: [t('sr.cancel'), 'i-x'],
    answer: [t('sr.askAgain'), 'i-mic'],
  }[state];
  el.btnSide.hidden = !side;
  if (side) {
    el.btnSide.setAttribute('aria-label', side[0]);
    setIcon(el.sideIcon, el.btnSide, side[1]);
  }
  el.btnGallery.hidden = !['ready', 'answer'].includes(state);
  const size = el.body.dataset.sheet;
  grabber.setAttribute('aria-label', t(size === 'auto' ? 'sheet.expand' : size === 'full' ? 'sheet.shrink' : 'sheet.restore'));
  grabber.setAttribute('aria-expanded', size === 'full' ? 'true' : 'false');
}

/** Resize the answer sheet to peek / auto / full, morphing from wherever it is now. */
function setSheet(size) {
  if (!SHEET_SIZES.includes(size)) return;
  morph(sheet, () => {
    sheet.style.height = '';
    el.body.dataset.sheet = size;
    if (currentText) layoutText(currentText);
  });
  vibrate(15);
  updateLabels();
}

function stepSheet(dir) {
  if (state !== 'answer') return;
  const i = SHEET_SIZES.indexOf(el.body.dataset.sheet) + dir;
  if (i >= 0 && i < SHEET_SIZES.length) setSheet(SHEET_SIZES[i]);
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
  // Sheet dragging
  let dragging = false;
  let canDrag = false;
  let h0 = 0;
  let vy = 0;
  let lastY = 0;
  let lastT = 0;
  const clear = () => {
    clearTimeout(longTimer);
    clearTimeout(settingsTimer);
    down = false;
    el.body.classList.remove('pressing');
  };
  const hud = document.querySelector('.hud');
  const maxSheet = () => {
    const cs = getComputedStyle(hud);
    return hud.clientHeight - parseFloat(cs.paddingTop) - parseFloat(cs.paddingBottom);
  };

  const onDown = (e) => {
    if (!e.isPrimary) return;
    sounds.unlock();
    // On the sheet: drag it (only an answer can be resized). In full size the text itself scrolls,
    // so there the sheet is dragged by its handle only.
    canDrag =
      e.currentTarget === sheet &&
      state === 'answer' &&
      (el.body.dataset.sheet !== 'full' || e.target.closest('.grabber') || e.clientY - sheet.getBoundingClientRect().top < 48);
    if (e.currentTarget === sheet) {
      try {
        sheet.setPointerCapture(e.pointerId); // keep following the finger outside the sheet
      } catch {}
    }
    lastY = e.clientY;
    lastT = e.timeStamp;
    vy = 0;
    down = true;
    longFired = false;
    x0 = e.clientX;
    y0 = e.clientY;
    if (!canDrag) el.body.classList.add('pressing');
    longTimer = setTimeout(() => {
      longFired = true;
      lastAction = Date.now();
      onLongPress();
    }, TIMING.LONG);
    settingsTimer = setTimeout(() => {
      clear();
      openSettings();
    }, TIMING.SETTINGS);
  };

  // A finger that moves is a swipe (or a sheet drag), not a press: cancel the long-press timers.
  const onMove = (e) => {
    if (!down) return;
    const dx = e.clientX - x0;
    const dy = e.clientY - y0;
    if (Math.hypot(dx, dy) > 24) {
      clearTimeout(longTimer);
      clearTimeout(settingsTimer);
    }
    if (canDrag && !dragging && Math.abs(dy) > 8 && Math.abs(dy) > Math.abs(dx)) {
      dragging = true;
      clearTimeout(longTimer);
      clearTimeout(settingsTimer);
      h0 = sheet.getBoundingClientRect().height;
      el.body.classList.add('dragging');
      el.body.classList.remove('pressing');
    }
    if (!dragging) return;
    // Follow the finger; past the ends it resists like rubber.
    const lo = 84;
    const hi = maxSheet();
    let h = h0 - dy;
    if (h > hi) h = hi + (h - hi) * 0.25;
    if (h < lo) h = lo - (lo - h) * 0.25;
    sheet.style.height = `${h}px`;
    const dt = e.timeStamp - lastT;
    if (dt > 0) vy = (e.clientY - lastY) / dt; // px per ms, + = down
    lastY = e.clientY;
    lastT = e.timeStamp;
  };

  const onUp = (e) => {
    if (!down) return;
    clear();
    if (dragging) {
      dragging = false;
      el.body.classList.remove('dragging');
      // Settle on the nearest size, or the next one if the sheet was flicked.
      const dy = e.clientY - y0;
      const i = SHEET_SIZES.indexOf(el.body.dataset.sheet);
      let next = i;
      if (vy < -0.45 || dy < -60) next = Math.min(i + 1, 2);
      else if (vy > 0.45 || dy > 60) next = Math.max(i - 1, 0);
      if (dy < -maxSheet() * 0.45) next = 2;
      if (dy > maxSheet() * 0.45) next = 0;
      setSheet(SHEET_SIZES[next]);
      lastAction = Date.now();
      return;
    }
    if (longFired) return;
    // The handle is a button; its own click does the resizing.
    if (e.target.closest?.('.grabber')) return;
    const dx = e.clientX - x0;
    const dy = e.clientY - y0;
    if (Math.abs(dx) > 70 && Math.abs(dx) > Math.abs(dy) * 1.4) return onSwipe(dx < 0 ? 1 : -1);
    if (dy > 80 && Math.abs(dy) > Math.abs(dx) * 1.4) return onSwipeDown();
    rawTap();
  };

  const onCancel = () => {
    clear();
    if (dragging) {
      dragging = false;
      el.body.classList.remove('dragging');
      setSheet(el.body.dataset.sheet);
    }
  };

  // The whole screen and the answer sheet share the same gestures.
  for (const target of [el.stage, sheet]) {
    target.addEventListener('pointerdown', onDown);
    target.addEventListener('pointermove', onMove);
    target.addEventListener('pointerup', onUp);
    target.addEventListener('pointercancel', onCancel);
    target.addEventListener('contextmenu', (e) => e.preventDefault());
  }
  grabber.addEventListener('click', (e) => {
    e.stopPropagation();
    const size = el.body.dataset.sheet;
    setSheet(size === 'auto' ? 'full' : size === 'full' ? 'peek' : 'auto');
  });
  // Keyboard, switch access and screen readers send a click without pointer events.
  el.stage.addEventListener('click', (e) => e.detail === 0 && rawTap());

  el.srLink.addEventListener('click', () => {
    settings.srMode = true;
    save();
    el.body.classList.add('sr');
    begin();
  });
  // Dock and top bar buttons do exactly what the gestures do.
  el.btnShutter.addEventListener('click', () => {
    if (state === 'thinking' || Date.now() - lastAction < TIMING.DEBOUNCE) return;
    lastAction = Date.now();
    vibrate(20);
    onTap();
  });
  el.btnSide.addEventListener('click', () => {
    if (state === 'answer') return listen(t('askNow'));
    if (['listening', 'thinking'].includes(state)) return newPhoto();
    if (state === 'ready') return onLongPress();
  });
  el.btnGallery.addEventListener('click', openPicker);
  el.btnSettings.addEventListener('click', openSettings);
  el.btnHelp.addEventListener('click', () => {
    if (state === 'start') {
      unlockVoice();
      sounds.unlock();
    }
    sayHelp();
  });
  el.modebar.addEventListener('click', (e) => {
    const b = e.target.closest('[data-mode]');
    if (b && ['ready', 'answer'].includes(state) && b.dataset.mode !== mode) selectMode(b.dataset.mode);
  });
  // Arrow keys move between modes inside the mode strip (tab-list keyboard pattern).
  el.modebar.addEventListener('keydown', (e) => {
    if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return;
    e.stopPropagation();
    e.preventDefault();
    const rtl = document.documentElement.dir === 'rtl';
    onSwipe((e.key === 'ArrowRight') !== rtl ? 1 : -1);
    el.modebar.querySelector('[aria-selected="true"]')?.focus();
  });
  el.fileInput.addEventListener('change', () => {
    const f = el.fileInput.files?.[0];
    el.fileInput.value = '';
    if (f) loadPicture(f);
  });

  // Trackpad / mouse: a sideways scroll changes mode.
  let wheelX = 0;
  let wheelAt = 0;
  el.stage.addEventListener(
    'wheel',
    (e) => {
      if (Math.abs(e.deltaX) <= Math.abs(e.deltaY)) return;
      wheelX += e.deltaX;
      if (Math.abs(wheelX) > 120 && Date.now() - wheelAt > 700) {
        wheelAt = Date.now();
        onSwipe(wheelX > 0 ? 1 : -1);
        wheelX = 0;
      }
    },
    { passive: true }
  );

  // Laptop/PC: drop a picture anywhere, or paste one (Ctrl/⌘+V).
  let dragDepth = 0;
  addEventListener('dragenter', (e) => {
    if (![...(e.dataTransfer?.types || [])].includes('Files')) return;
    dragDepth++;
    el.body.classList.add('dropping');
  });
  addEventListener('dragleave', () => {
    if (--dragDepth <= 0) {
      dragDepth = 0;
      el.body.classList.remove('dropping');
    }
  });
  addEventListener('dragover', (e) => e.preventDefault());
  addEventListener('drop', (e) => {
    e.preventDefault();
    dragDepth = 0;
    el.body.classList.remove('dropping');
    const f = [...(e.dataTransfer?.files || [])][0];
    if (f) loadPicture(f);
  });
  addEventListener('paste', (e) => {
    const item = [...(e.clipboardData?.items || [])].find((i) => i.type.startsWith('image/'));
    if (item) loadPicture(item.getAsFile());
  });

  document.addEventListener('keydown', (e) => {
    if (state === 'settings') {
      if (e.key === 'Escape') closeSettings();
      return;
    }
    if (e.metaKey || e.ctrlKey || e.altKey) return; // leave browser shortcuts (like paste) alone
    const onButton = e.target instanceof HTMLButtonElement;
    // Space or Enter anywhere = the big tap (a focused button already clicks itself).
    if ((e.key === ' ' || e.key === 'Enter') && !onButton) {
      e.preventDefault();
      return rawTap();
    }
    const key = e.key.toLowerCase();
    if (key === 'a' && state === 'answer') listen(t('askNow'));
    else if (key === 'n') state === 'answer' ? retake() : onDoubleTap();
    else if (e.key === 'Escape') onDoubleTap();
    else if (key === 'r') onLongPress();
    else if (key === 's') openSettings();
    else if (key === 'o') openPicker();
    else if (e.key === 'ArrowUp') stepSheet(1);
    else if (e.key === 'ArrowDown') stepSheet(-1);
    else if (key === 'h' || e.key === '?') sayHelp();
    else if (e.key === 'ArrowRight') onSwipe(1);
    else if (e.key === 'ArrowLeft') onSwipe(-1);

  });
}

// ---------- actions ----------

function onTap() {
  switch (state) {
    case 'start':
      return begin();
    case 'ready':
      if (mode === 'color') return sayColor();
      if (mode === 'light') return toggleLight();
      if (mode === 'qibla') return toggleQibla();
      return takePhoto();
    case 'listening':
      return prompting ? stopSpeaking() : finishListening();
    case 'answer':
      return retake(); // tap after an answer = take the next photo straight away
    default: // thinking: ignore every tap
  }
}

function onDoubleTap() {
  if (state === 'answer') return listen(t('askNow')); // ask more about the same photo
  if (['listening', 'thinking'].includes(state)) return newPhoto();
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
  selectMode(MODES[(MODES.indexOf(mode) + dir + MODES.length) % MODES.length]);
}

function selectMode(next) {
  mode = next;
  settings.mode = mode;
  save();
  showMode();
  sounds.tap();
  vibrate(25);
  goReady();
}

function onSwipeDown() {
  if (['ready', 'answer'].includes(state)) openPicker();
}

// Opens the phone's gallery / the computer's file picker. Must run straight from a touch, click or key.
function openPicker() {
  if (['thinking', 'settings'].includes(state)) return;
  el.fileInput.click();
}

function sayHelp() {
  if (['thinking', 'settings', 'listening'].includes(state)) return;
  ++op;
  say(DESKTOP ? t('helpKeys') : t('helpTouch'), { display: state !== 'start' });
}

/** A picture from the gallery, a file, a paste or a drop. */
async function loadPicture(file) {
  if (!file || !/^image\//.test(file.type)) {
    sounds.error();
    return say(t('badFile'), { display: state !== 'start' });
  }
  // Sound needs one tap first; keep the picture until then.
  if (state === 'start') {
    pendingPicture = file;
    return show(t('sharedReceivedStart'));
  }
  if (['thinking', 'settings'].includes(state)) return;
  cancelWork();
  const my = ++op;
  let canvas;
  try {
    const bmp = await createImageBitmap(file);
    const scale = Math.min(1, 1280 / Math.max(bmp.width, bmp.height));
    canvas = document.createElement('canvas');
    canvas.width = Math.round(bmp.width * scale);
    canvas.height = Math.round(bmp.height * scale);
    canvas.getContext('2d').drawImage(bmp, 0, 0, canvas.width, canvas.height);
    bmp.close?.();
  } catch {
    if (my !== op) return;
    sounds.error();
    return say(t('badFile'));
  }
  if (my !== op) return;
  sounds.shutter();
  vibrate([30, 40, 30]);
  usePhoto(canvas, my, t('photoReceived'));
}

// ---------- colour (no AI, no internet) ----------

async function sayColor() {
  const my = ++op;
  stopSpeaking();
  if (!cameraRunning()) {
    try {
      await startCamera(el.video);
      el.body.dataset.camera = 'on';
    } catch {
      sounds.error();
      return say(t(DESKTOP ? 'noCameraDesktop' : 'noCamera'));
    }
  }
  let canvas;
  try {
    canvas = capture(el.video, 480);
  } catch {
    sounds.error();
    return say(t(DESKTOP ? 'noCameraDesktop' : 'noCamera'));
  }
  if (my !== op) return;
  const rgb = centerColor(canvas);
  const { key, shade } = nameColor(rgb);
  const name = t(`colors.${key}`);
  const words = shade ? t(shade === 'dark' ? 'colorDark' : 'colorLight', { c: name }) : name;
  el.body.style.setProperty('--swatch', `rgb(${rgb.join(' ')})`);
  el.body.dataset.swatch = 'on';
  sounds.tap();
  vibrate(40);
  say(words.charAt(0).toUpperCase() + words.slice(1) + '.');
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
  delete el.body.dataset.swatch;
  const had = !!sensor;
  sensor?.stop();
  sensor = null;
  delete el.body.dataset.running;
  delete el.body.dataset.facing;
  if (had) updateLabels();
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
  if (pendingPicture) {
    const f = pendingPicture;
    pendingPicture = null;
    setState('ready');
    if (!settings.disclaimerShown) await showDisclaimer();
    return loadPicture(f);
  }
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
      await say(t(DESKTOP ? 'noCameraDesktop' : 'noCamera'));
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

// After an answer: back to the camera and snap the next photo in one tap (same mode).
async function retake() {
  cancelWork();
  const my = ++op;
  photo = null;
  history = [];
  el.photo.removeAttribute('src');
  setState('ready');
  show(t('newPhoto'));
  try {
    await startCamera(el.video);
    el.body.dataset.camera = 'on';
  } catch {
    if (my !== op) return;
    sounds.error();
    return say(t(DESKTOP ? 'noCameraDesktop' : 'noCamera'));
  }
  // Give the camera a moment to set its exposure and focus before the picture.
  await new Promise((r) => setTimeout(r, 700));
  if (my !== op || state !== 'ready') return;
  if (mode === 'color') return sayColor();
  if (['light', 'qibla'].includes(mode)) return say(readyPrompt());
  takePhoto();
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
  usePhoto(canvas, my, t('photoTaken'));
}

function usePhoto(canvas, my, intro) {
  photo = { base64: toJpegBase64(canvas), url: canvas.toDataURL('image/jpeg', 0.7) };
  history = [];
  el.photo.src = photo.url;
  stopCamera(el.video);
  el.body.dataset.camera = 'off';
  // Read and Money modes need no question: go straight to the answer.
  if (mode === 'read') return ask(t('readQuestion'), my);
  if (mode === 'money') return ask(t('moneyQuestion'), my);
  listen(intro);
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
  updateLabels();
  vibrate(40);
  speak(t('lightOn'));
  if (settings.srMode) announce(t('lightOn'));
}

// ---------- Qibla compass (location stays on the phone) ----------

const num = (n) => new Intl.NumberFormat(settings.lang === 'ar' ? 'ar-SA' : settings.lang === 'ml' ? 'ml-IN' : 'en-US').format(Math.round(n));

async function toggleQibla() {
  if (sensor) return stopSensorsAndSay();
  const my = ++op;
  stopSpeaking();
  let lastTick = 0;
  let lastSpoke = Date.now() + 6000; // let the introduction finish first
  let lastText = '';
  let warnedCalibration = false;
  const talk = (words) => (settings.srMode ? announce(words) : speak(words));
  // startQibla asks the iPhone for compass permission inside this tap, before anything else.
  const pending = startQibla(({ heading, turn, accuracy }) => {
    if (my !== op) return;
    el.body.style.setProperty('--heading', `${heading.toFixed(1)}deg`);
    const off = Math.abs(turn);
    const now = Date.now();
    // iPhone tells us when the compass is unsure (accuracy in degrees, -1 = unknown).
    if (!warnedCalibration && (accuracy === -1 || accuracy > 25)) {
      warnedCalibration = true;
      lastSpoke = now + 3000;
      talk(t('calibrate'));
    }
    if (off < 8) {
      if (el.body.dataset.facing !== 'yes') {
        el.body.dataset.facing = 'yes';
        sounds.found();
        vibrate([60, 40, 60, 40, 200]);
        lastSpoke = now;
        fit(t('facing'), settings.textPt, true);
        talk(t('facing'));
      }
      return;
    }
    if (el.body.dataset.facing === 'yes' && off < 20) return; // stay "found" through small wobbles
    el.body.dataset.facing = 'no';
    // Ticks get faster and higher as you get closer.
    if (now - lastTick > 160 + off * 5) {
      lastTick = now;
      sounds.tick(1 - off / 180);
    }
    const text = `${turn < 0 ? '←' : '→'} ${num(Math.round(off / 5) * 5)}°`;
    if (text !== lastText) {
      lastText = text;
      fit(text, settings.textPt, true);
    }
    if (now - lastSpoke > 3500) {
      lastSpoke = now;
      const n = num(Math.round(off / 10) * 10 || 10);
      talk(off < 25 ? t('almost') : t(turn < 0 ? 'turnLeftDeg' : 'turnRightDeg', { n }));
    }
  }, DEMO);
  let cancelled = false;
  sensor = { stop: () => (cancelled = true) };
  el.body.dataset.running = 'qibla';
  updateLabels();
  show(t('qiblaLocating'));
  let q;
  try {
    q = await pending;
  } catch {
    if (cancelled || my !== op) return;
    stopSensors();
    sounds.error();
    return say(t('noLocation'));
  }
  if (cancelled || my !== op) return q.stop();
  el.body.style.setProperty('--target', `${q.target.toFixed(1)}deg`);
  const facts = { km: num(q.distanceKm), deg: num(q.target), dir: t(`compass.${compassPoint(q.target)}`) };
  if (!q.compass) {
    // Laptop or a phone without a compass: still give the real direction, map style (north up).
    stopSensors();
    el.body.dataset.running = 'qibla-map';
    el.body.style.setProperty('--heading', '0deg');
    return say(t('qiblaNoCompass', facts));
  }
  sensor = q;
  updateLabels();
  say(t('qiblaIntro', facts));
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
    case 'color':
      mode = cmd;
      settings.mode = mode;
      save();
      showMode();
      return goReady();
    case 'open':
      msg = t(DESKTOP ? 'openHintDesktop' : 'openHint');
      break;
    case 'help':
      msg = DESKTOP ? t('helpKeys') : t('helpTouch');
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
  settings.langChosen = true;
  setLang(settings.lang);
  save();
  preloadPrompts();
}

// ---------- settings screen ----------

function renderSettings() {
  $('settings-title').textContent = t('settings.title');
  $('settings-done').textContent = t('settings.done');
  $('lbl-lang').textContent = t('settings.language');
  $('lbl-size').textContent = t('settings.textSize');
  $('lbl-speed').textContent = t('settings.speechSpeed');
  $('lbl-theme').textContent = t('settings.colours');
  $('lbl-sr').textContent = t('settings.reader');
  for (const b of el.settings.querySelectorAll('.seg button')) b.setAttribute('aria-checked', b.dataset.v === settings.lang ? 'true' : 'false');
  for (const b of el.settings.querySelectorAll('.sw')) {
    b.setAttribute('aria-checked', b.dataset.v === settings.theme ? 'true' : 'false');
    b.setAttribute('aria-label', t(`themeNames.${b.dataset.v}`));
  }
  $('set-size').value = Math.max(0, SIZES.indexOf(settings.textPt));
  $('out-size').textContent = settings.textPt;
  $('set-speed').value = Math.max(0, RATES.indexOf(settings.rate));
  $('out-speed').textContent = `${settings.rate}×`;
  $('set-sr').setAttribute('aria-checked', settings.srMode ? 'true' : 'false');
}

function openSettings() {
  if (['settings', 'thinking'].includes(state)) return;
  returnState = state === 'start' ? 'start' : photo ? 'answer' : 'ready';
  cancelWork();
  ++op;
  setState('settings');
  el.settings.hidden = false;
  renderSettings();
  el.settings.querySelector('.seg [aria-checked="true"]')?.focus();
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
  // Each change is applied at once and spoken, so it can be used without looking.
  const changed = (msg) => {
    vibrate(20);
    sounds.tap();
    save();
    applyLook();
    renderSettings();
    updateLabels();
    say(msg, { display: false });
  };
  el.settings.querySelector('.seg').addEventListener('click', (e) => {
    const b = e.target.closest('[data-v]');
    if (!b || b.dataset.v === settings.lang) return;
    settings.lang = b.dataset.v;
    settings.langChosen = true;
    setLang(settings.lang);
    preloadPrompts();
    changed(t('languageName'));
  });
  el.settings.querySelector('.swatches').addEventListener('click', (e) => {
    const b = e.target.closest('[data-v]');
    if (!b) return;
    settings.theme = b.dataset.v;
    changed(t(`themeNames.${settings.theme}`));
  });
  const size = $('set-size');
  size.addEventListener('input', () => {
    settings.textPt = SIZES[+size.value];
    $('out-size').textContent = settings.textPt;
    applyLook();
  });
  size.addEventListener('change', () => changed(t('textSize', { n: settings.textPt })));
  const speed = $('set-speed');
  speed.addEventListener('input', () => {
    settings.rate = RATES[+speed.value];
    $('out-speed').textContent = `${settings.rate}×`;
  });
  speed.addEventListener('change', () => changed(t('settings.speed', { n: `${settings.rate}×` })));
  $('set-sr').addEventListener('click', () => {
    settings.srMode = !settings.srMode;
    el.body.classList.toggle('sr', settings.srMode);
    changed(t('settings.sr', { v: t(settings.srMode ? 'settings.on' : 'settings.off') }));
  });
  $('settings-done').addEventListener('click', () => closeSettings());
  // Tapping the dimmed area outside the sheet also closes it.
  el.settings.addEventListener('click', (e) => e.target === el.settings && closeSettings());
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
  if (currentText && !paging && !el.body.dataset.running) layoutText(currentText);
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
  show(pendingPicture ? t('sharedReceivedStart') : DESKTOP ? t('tapToStartDesktop') : t('tapToStart'));
}

// ---------- boot ----------

if (new URLSearchParams(location.search).get('sr') === '1') settings.srMode = true;
setLang(settings.lang);
applyLook();
showMode();
el.body.classList.toggle('sr', settings.srMode);
bindGestures();
bindSettings();
initGlass({ video: el.video, photo: el.photo, body: el.body });
el.body.classList.toggle('desktop', DESKTOP);
checkServer();
showStart();
// Offline app shell: Light, Qibla, Colour and the app itself open without internet.
if ('serviceWorker' in navigator) navigator.serviceWorker.register('/sw.js').catch(() => {});
