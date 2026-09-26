import { askAI, langOf } from './_lib/ai.js';
import { guard, fail, isB64 } from './_lib/http.js';

export default async function handler(req, res) {
  if (!guard(req, res)) return;
  const { image, mime = 'image/jpeg', question, lang, history, provider } = req.body;
  if (!isB64(image, 4_000_000) || !/^image\/(jpeg|png|webp)$/.test(mime)) {
    return res.status(400).json({ error: 'Bad image' });
  }
  const q = String(question || '').slice(0, 500).trim() || 'Describe what you see.';
  const hist = Array.isArray(history)
    ? history.slice(-3).map((h) => ({ q: String(h.q || '').slice(0, 500), a: String(h.a || '').slice(0, 1500) }))
    : [];
  const started = Date.now();
  try {
    const out = await askAI({
      image,
      mime,
      question: q,
      lang: langOf(lang),
      history: hist,
      provider: provider === 'openrouter' || provider === 'gemini' ? provider : undefined,
    });
    res.status(200).json({ ...out, ms: Date.now() - started });
  } catch (e) {
    fail(res, e);
  }
}
