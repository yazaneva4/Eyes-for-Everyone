// TEMPORARY: one tiny real request per provider; returns only status + error code. Remove after debugging.
const clean = (v) => String(v || '').trim().replace(/^["']|["']$/g, '').trim();
async function run(url, opt) {
  try {
    const r = await fetch(url, { ...opt, signal: AbortSignal.timeout(20000) });
    const t = await r.text();
    let j = {};
    try { j = JSON.parse(t); } catch {}
    const e = j.error || j.detail || {};
    return { status: r.status, code: e.code || e.status || e.type || (typeof e === 'string' ? e.slice(0, 60) : undefined), finish: j.candidates?.[0]?.finishReason, text: (j.candidates?.[0]?.content?.parts?.[0]?.text || j.choices?.[0]?.message?.content || '').slice(0, 20) || undefined, bytes: r.ok && !t.startsWith('{') ? t.length : undefined };
  } catch (err) { return { status: -1, code: String(err.name) }; }
}
export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  const g = clean(process.env.GEMINI_API_KEY), o = clean(process.env.OPENAI_API_KEY), x = clean(process.env.ELEVENLABS_API_KEY);
  const [gemini, openai, eleven_tts, eleven_user] = await Promise.all([
    run(`https://generativelanguage.googleapis.com/v1beta/models/${process.env.GEMINI_MODEL || 'gemini-flash-latest'}:generateContent`, { method: 'POST', headers: { 'content-type': 'application/json', 'x-goog-api-key': g }, body: JSON.stringify({ contents: [{ role: 'user', parts: [{ text: 'Say ok' }] }], generationConfig: { maxOutputTokens: 2048 } }) }),
    run('https://api.openai.com/v1/chat/completions', { method: 'POST', headers: { 'content-type': 'application/json', authorization: `Bearer ${o}` }, body: JSON.stringify({ model: process.env.OPENAI_MODEL || 'gpt-4.1-mini', messages: [{ role: 'user', content: 'Say ok' }], max_completion_tokens: 5 }) }),
    run(`https://api.elevenlabs.io/v1/text-to-speech/${process.env.ELEVENLABS_VOICE_ID || 'JBFqnCBsd6RMkjVDRZzb'}?output_format=mp3_44100_128`, { method: 'POST', headers: { 'content-type': 'application/json', 'xi-api-key': x }, body: JSON.stringify({ text: 'ok', model_id: 'eleven_flash_v2_5', language_code: 'en' }) }),
    run('https://api.elevenlabs.io/v1/user/subscription', { headers: { 'xi-api-key': x } }),
  ]);
  res.status(200).json({ gemini, openai, eleven_tts, eleven_user, keyShapes: { gemini: g.slice(0, 4) + '…' + g.length, openai: o.slice(0, 3) + '…' + o.length, elevenlabs: x.slice(0, 3) + '…' + x.length } });
}
