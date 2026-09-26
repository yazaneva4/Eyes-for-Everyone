import { available } from './_lib/ai.js';

// Tells the app which features have a key, without revealing any key.
export default function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  const a = available();
  res.status(200).json({ ask: a.ask, transcribe: a.transcribe, speak: a.speak, gemini: a.gemini, openai: a.openai, mock: a.mock });
}
