// Speaks text out loud.
//   'always'   → ElevenLabs is set up: use it for everything, phone voice only as a backup.
//   'fallback' → (unused now) server voice only when the phone has none for the language.
// Screen reader mode stays silent because the screen reader reads the live region instead.
import { settings } from './settings.js';
import { LOCALES } from './i18n.js';

let voices = [];
let serverVoice = false; // false | 'fallback' | 'always'
// Recently spoken sentences, kept in memory only so repeated prompts play instantly.
const cache = new Map();
const CACHE_MAX = 60;
let token = 0;
const audio = new Audio();
audio.preload = 'auto';

function loadVoices() {
  voices = window.speechSynthesis?.getVoices() || [];
}
if ('speechSynthesis' in window) {
  loadVoices();
  speechSynthesis.addEventListener?.('voiceschanged', loadVoices);
}

export function enableServerVoice(mode) {
  serverVoice = mode;
}

function voiceFor(lang) {
  const locale = LOCALES[lang].toLowerCase();
  const norm = (v) => v.lang.replace('_', '-').toLowerCase();
  const matches = voices.filter((v) => norm(v).startsWith(lang));
  return (
    matches.find((v) => norm(v) === locale && v.localService) ||
    matches.find((v) => norm(v) === locale) ||
    matches.find((v) => v.localService) ||
    matches[0] ||
    null
  );
}

export function splitSentences(text) {
  return (text.match(/[^.!?؟।\n]+[.!?؟।]*\s*/g) || [text]).map((s) => s.trim()).filter(Boolean);
}

function silentWav() {
  const buf = new ArrayBuffer(44 + 800);
  const v = new DataView(buf);
  const w = (o, str) => [...str].forEach((c, i) => v.setUint8(o + i, c.charCodeAt(0)));
  w(0, 'RIFF'); v.setUint32(4, 36 + 800, true); w(8, 'WAVE'); w(12, 'fmt ');
  v.setUint32(16, 16, true); v.setUint16(20, 1, true); v.setUint16(22, 1, true);
  v.setUint32(24, 8000, true); v.setUint32(28, 16000, true); v.setUint16(32, 2, true);
  v.setUint16(34, 16, true); w(36, 'data'); v.setUint32(40, 800, true);
  return URL.createObjectURL(new Blob([buf], { type: 'audio/wav' }));
}

// Call inside the first tap so iPhone allows sound later.
export function unlockVoice() {
  try {
    if ('speechSynthesis' in window) {
      const u = new SpeechSynthesisUtterance(' ');
      u.volume = 0;
      speechSynthesis.speak(u);
    }
    audio.src = silentWav();
    audio.play().catch(() => {});
  } catch {}
}

export function stopSpeaking() {
  token++;
  try {
    speechSynthesis.cancel();
  } catch {}
  audio.pause();
}

function estimateMs(text) {
  return (text.length * 85) / settings.rate + 2500;
}

function speakBrowser(text, lang, my) {
  return new Promise((resolve) => {
    if (!('speechSynthesis' in window)) return setTimeout(resolve, 400);
    const u = new SpeechSynthesisUtterance(text);
    u.lang = LOCALES[lang];
    const v = voiceFor(lang);
    if (v) u.voice = v;
    u.rate = settings.rate;
    u.volume = settings.volume;
    let done = false;
    const finish = () => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      clearInterval(watch);
      resolve();
    };
    // onend is not always fired on every phone, so a timer backs it up.
    const timer = setTimeout(finish, estimateMs(text));
    const watch = setInterval(() => my !== token && finish(), 100);
    u.onend = finish;
    u.onerror = finish;
    speechSynthesis.speak(u);
  });
}

function fetchServerAudio(text, lang) {
  const key = `${lang}|${text}`;
  if (cache.has(key)) {
    const hit = cache.get(key);
    cache.delete(key);
    cache.set(key, hit); // most recently used goes last
    return hit;
  }
  const p = fetch('/api/speak', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ text, lang }),
  })
    .then((r) => {
      if (!r.ok) throw new Error('tts');
      return r.blob();
    })
    .then((b) => URL.createObjectURL(b));
  p.catch(() => cache.delete(key));
  cache.set(key, p);
  if (cache.size > CACHE_MAX) {
    const [oldKey, old] = cache.entries().next().value;
    cache.delete(oldKey);
    old.then((u) => URL.revokeObjectURL(u)).catch(() => {});
  }
  return p;
}

/** Warm the cache for prompts the app is about to say, so they start instantly. */
export function preload(texts, lang) {
  if (serverVoice !== 'always') return;
  texts.forEach((t) => splitSentences(t).forEach((s) => fetchServerAudio(s, lang).catch(() => {})));
}

function playUrl(url, my) {
  return new Promise((resolve) => {
    let done = false;
    const finish = () => {
      if (done) return;
      done = true;
      clearInterval(watch);
      audio.onended = audio.onerror = null;
      resolve();
    };
    const watch = setInterval(() => my !== token && (audio.pause(), finish()), 100);
    audio.onended = finish;
    audio.onerror = finish;
    audio.src = url;
    audio.playbackRate = settings.rate;
    audio.volume = settings.volume;
    audio.play().catch(finish);
  });
}

function srWait(text, my) {
  return new Promise((resolve) => {
    const end = Date.now() + text.split(/\s+/).length * 380 + 600;
    const watch = setInterval(() => {
      if (my !== token || Date.now() > end) {
        clearInterval(watch);
        resolve();
      }
    }, 100);
  });
}

/**
 * Speak text sentence by sentence. Resolves when finished or stopped.
 * onSentence(index, sentence) lets the screen show the part being spoken.
 */
export async function speak(text, { lang = settings.lang, onSentence } = {}) {
  stopSpeaking();
  const my = token;
  const parts = splitSentences(text);
  if (settings.srMode) {
    onSentence?.(-1, text);
    return srWait(text, my);
  }
  const useServer = serverVoice === 'always' || (serverVoice === 'fallback' && !voiceFor(lang));
  // Ask the server for every sentence at once so playback has no gaps.
  const urls = useServer ? parts.map((p) => fetchServerAudio(p, lang).catch(() => null)) : [];
  for (let i = 0; i < parts.length; i++) {
    if (my !== token) return;
    onSentence?.(i, parts[i]);
    if (useServer) {
      const url = await urls[i];
      if (my !== token) return;
      if (url) await playUrl(url, my);
      else await speakBrowser(parts[i], lang, my);
    } else {
      await speakBrowser(parts[i], lang, my);
    }
  }
}
