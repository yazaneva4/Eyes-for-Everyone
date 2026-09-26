// Remembers language, voice speed, volume, text size and theme on this phone only.
import { detectLang } from './i18n.js';

const KEY = 'eyes.settings.v1';
export const RATES = [0.6, 0.8, 1, 1.25, 1.5, 1.75, 2];
export const SIZES = [18, 20, 24, 28, 32, 40, 48, 56, 64];
export const THEMES = ['yellow', 'white', 'light'];

const defaults = () => ({
  lang: detectLang(),
  rate: 1,
  volume: 0.8,
  textPt: 24,
  theme: 'yellow',
  srMode: false,
  disclaimerShown: false,
});

function load() {
  try {
    return { ...defaults(), ...JSON.parse(localStorage.getItem(KEY) || '{}') };
  } catch {
    return defaults();
  }
}

export const settings = load();
// Text became smaller by default; move people from the old 40pt default once.
if (!settings.sizeV2) {
  if (settings.textPt === 40) settings.textPt = 24;
  settings.sizeV2 = true;
  try {
    localStorage.setItem(KEY, JSON.stringify(settings));
  } catch {}
}

export function save() {
  try {
    localStorage.setItem(KEY, JSON.stringify(settings));
  } catch {}
}

export function applyLook() {
  const root = document.documentElement;
  root.dataset.theme = settings.theme;
  root.style.setProperty('--text-size', `${settings.textPt}pt`);
  const meta = document.querySelector('meta[name="theme-color"]');
  if (meta) meta.content = settings.theme === 'light' ? '#ffffff' : '#000000';
}

// Moves to the next value in a list. Returns false when already at the end.
export function step(list, value, dir) {
  const i = list.indexOf(value);
  const j = (i === -1 ? list.indexOf(1) : i) + dir;
  if (j < 0 || j >= list.length) return false;
  return list[j];
}
