// Talks to Gemini and OpenAI. API keys are read from environment variables only
// and never leave the server. Nothing is logged or stored.

export const LANGS = {
  en: { name: 'English', notSure: "I'm not sure.", checkPerson: 'Please check with a person.' },
  ar: { name: 'Arabic', notSure: 'لست متأكدًا.', checkPerson: 'يرجى التحقق مع شخص.' },
  ml: { name: 'Malayalam', notSure: 'എനിക്ക് ഉറപ്പില്ല.', checkPerson: 'ദയവായി ഒരാളോട് ചോദിച്ച് ഉറപ്പാക്കുക.' },
};

export function langOf(code) {
  return LANGS[code] ? code : 'en';
}

// Pasted keys often carry a stray space, newline or quotes; strip them.
const clean = (v) => String(v || '').trim().replace(/^["']|["']$/g, '').trim();

function keys() {
  return {
    gemini: clean(process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY || process.env.GOOGLE_GENERATIVE_AI_API_KEY),
    openai: clean(process.env.OPENAI_API_KEY),
    elevenlabs: clean(process.env.ELEVENLABS_API_KEY || process.env.ELEVEN_LABS_API_KEY || process.env.XI_API_KEY),
  };
}

/**
 * Asks each provider "is this key good, and does the model exist?" using free calls.
 * Returns only HTTP status codes and a hint — never the key or the provider's message.
 */
export async function checkKeys() {
  const k = keys();
  const hint = (st) =>
    ({ 200: 'ok', 400: 'bad request (check model name)', 401: 'key rejected', 403: 'key not allowed / no access', 404: 'model or voice not found', 429: 'out of credit or rate limited' })[st] ||
    (st >= 500 ? 'provider is down' : 'unexpected');
  const probe = async (name, url, headers) => {
    if (!k[name]) return [name, { status: 0, hint: 'no key set' }];
    try {
      const r = await fetch(url, { headers, signal: AbortSignal.timeout(10000) });
      return [name, { status: r.status, hint: hint(r.status) }];
    } catch {
      return [name, { status: -1, hint: 'could not reach provider' }];
    }
  };
  const gm = process.env.GEMINI_MODEL || 'gemini-flash-latest';
  const om = process.env.OPENAI_MODEL || 'gpt-4.1-mini';
  const voice = process.env.ELEVENLABS_VOICE_ID || 'JBFqnCBsd6RMkjVDRZzb';
  const out = await Promise.all([
    probe('gemini', `https://generativelanguage.googleapis.com/v1beta/models/${gm}`, { 'x-goog-api-key': k.gemini }),
    probe('openai', `https://api.openai.com/v1/models/${om}`, { authorization: `Bearer ${k.openai}` }),
    probe('elevenlabs', `https://api.elevenlabs.io/v1/voices/${voice}`, { 'xi-api-key': k.elevenlabs }),
  ]);
  return Object.fromEntries(out);
}

export function available() {
  const k = keys();
  const mock = process.env.MOCK_AI === '1';
  return {
    gemini: !!k.gemini,
    openai: !!k.openai,
    ask: mock || !!(k.gemini || k.openai),
    elevenlabs: !!k.elevenlabs,
    transcribe: !!(k.elevenlabs || k.gemini || k.openai),
    speak: !!(k.elevenlabs || k.openai),
    // ElevenLabs sounds good enough to be the app's only voice; OpenAI is used only as a backup.
    voice: k.elevenlabs ? 'elevenlabs' : k.openai ? 'openai' : null,
    mock,
  };
}

// Preferred provider first, the other one as a fallback.
function order(preferred) {
  const k = keys();
  const pref = preferred || process.env.AI_PROVIDER || 'gemini';
  const list = pref === 'openai' ? ['openai', 'gemini'] : ['gemini', 'openai'];
  return list.filter((p) => k[p]);
}

export function systemPrompt(lang) {
  const L = LANGS[langOf(lang)];
  return `You are "Eyes for Everyone", a helper for a person with low vision. They took a photo with their phone and asked a question out loud. Your reply is shown in very large text and read aloud.

Rules:
- Reply ONLY in ${L.name}. Use short, simple sentences and everyday words. No lists, no markdown, no emojis, no headings.
- Say the most important thing first. Keep replies under 50 words, unless you are asked to read text.
- Give positions (left, right, center, top, bottom, near, far) and colors.
- Never identify any person by their face or name, even if they seem famous. You may say "a person" and describe clothing, position and what they are doing.
- When asked to read, read the printed text exactly, word for word. Do not fix, summarize or translate it unless asked.
- Medicine: for any medicine box, bottle, blister pack or label, read only the printed text. Do not explain what it is for or how to take it. Then say exactly: "${L.checkPerson}"
- Give no medical advice. Give no guidance on crossing roads, traffic, stairs, edges, driving, electricity, or anything where a mistake could hurt someone. If asked, say you cannot help with safety decisions and suggest asking a person nearby.
- If the photo is unclear, too dark, blurry, cut off, or does not show what they asked about, or if you are not sure, say exactly "${L.notSure}" and ask them to take a new photo. Never guess.
- The question came from speech-to-text and may contain small mistakes. Use common sense.`;
}

function userText(question, history) {
  const past = (history || [])
    .slice(-3)
    .map((h) => `Earlier question: ${h.q}\nYour earlier answer: ${h.a}`)
    .join('\n\n');
  return past ? `${past}\n\nNew question about the same photo: ${question}` : question;
}

async function readError(r) {
  const body = await r.text().catch(() => '');
  try {
    const j = JSON.parse(body);
    return j.error?.message || body.slice(0, 200);
  } catch {
    return body.slice(0, 200);
  }
}

// Each Gemini model has its own quota, so when one is used up the next one is tried.
const geminiModels = () =>
  [process.env.GEMINI_MODEL || 'gemini-flash-latest', process.env.GEMINI_FALLBACK_MODEL || 'gemini-flash-lite-latest'].filter(
    (m, i, all) => m && all.indexOf(m) === i
  );

async function geminiGenerate(parts, system, maxTokens = 8192, allowEmpty = false) {
  let lastErr;
  for (const model of geminiModels()) {
    // Google is sometimes briefly overloaded (5xx); try the same model once more.
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        return await geminiOnce(model, parts, system, maxTokens, allowEmpty);
      } catch (e) {
        lastErr = e;
        if (e.status === 429 || e.status === 404) break; // quota used up or model missing: next model
        if (!e.retry) throw e;
        await new Promise((r) => setTimeout(r, 700));
      }
    }
  }
  throw lastErr;
}

async function geminiOnce(model, parts, system, maxTokens, allowEmpty) {
  const r = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`,
    {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-goog-api-key': keys().gemini },
      body: JSON.stringify({
        ...(system ? { systemInstruction: { parts: [{ text: system }] } } : {}),
        contents: [{ role: 'user', parts }],
        generationConfig: { temperature: 0.2, maxOutputTokens: maxTokens },
      }),
      signal: AbortSignal.timeout(25000),
    }
  );
  if (!r.ok) throw Object.assign(new Error(`Gemini ${model} ${r.status}: ${await readError(r)}`), { retry: r.status >= 500, status: r.status });
  const j = await r.json();
  const text = (j.candidates?.[0]?.content?.parts || [])
    .filter((p) => !p.thought)
    .map((p) => p.text || '')
    .join('')
    .trim();
  if (!text && !allowEmpty) throw Object.assign(new Error(`Gemini empty (${j.candidates?.[0]?.finishReason || 'no candidate'})`), { retry: true });
  return text;
}

async function openaiChat(messages) {
  const r = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${keys().openai}` },
    body: JSON.stringify({
      model: process.env.OPENAI_MODEL || 'gpt-4.1-mini',
      messages,
      max_completion_tokens: 1200,
    }),
    signal: AbortSignal.timeout(25000),
  });
  if (!r.ok) throw new Error(`OpenAI ${r.status}: ${await readError(r)}`);
  const j = await r.json();
  return (j.choices?.[0]?.message?.content || '').trim();
}

const askers = {
  gemini: ({ image, mime, text, system }) =>
    geminiGenerate([{ inlineData: { mimeType: mime, data: image } }, { text }], system),
  openai: ({ image, mime, text, system }) =>
    openaiChat([
      { role: 'system', content: system },
      {
        role: 'user',
        content: [
          { type: 'text', text },
          { type: 'image_url', image_url: { url: `data:${mime};base64,${image}`, detail: 'high' } },
        ],
      },
    ]),
};

export async function askAI({ image, mime, question, lang, history, provider }) {
  if (process.env.MOCK_AI === '1' && !order().length) {
    await new Promise((r) => setTimeout(r, 1200));
    return {
      answer:
        'Demo mode. No AI key is set. I see a photo. Add a Gemini or OpenAI key to get real answers.',
      provider: 'mock',
    };
  }
  const system = systemPrompt(lang);
  const text = userText(question, history);
  const providers = order(provider);
  if (!providers.length) throw Object.assign(new Error('No AI key configured'), { status: 503 });
  let lastErr;
  for (const p of providers) {
    try {
      const answer = await askers[p]({ image, mime, text, system });
      if (answer) return { answer, provider: p };
      lastErr = new Error(`${p} returned an empty answer`);
    } catch (e) {
      lastErr = e;
    }
  }
  throw lastErr;
}

// ---------- speech to text ----------

const EXT = { 'audio/webm': 'webm', 'audio/mp4': 'mp4', 'audio/ogg': 'ogg', 'audio/wav': 'wav', 'audio/mpeg': 'mp3', 'audio/aac': 'aac' };

async function openaiTranscribe(buf, mime, lang) {
  const form = new FormData();
  form.append('file', new Blob([buf], { type: mime }), `question.${EXT[mime] || 'webm'}`);
  form.append('model', process.env.OPENAI_TRANSCRIBE_MODEL || 'gpt-4o-mini-transcribe');
  form.append('language', lang);
  const r = await fetch('https://api.openai.com/v1/audio/transcriptions', {
    method: 'POST',
    headers: { authorization: `Bearer ${keys().openai}` },
    body: form,
    signal: AbortSignal.timeout(20000),
  });
  if (!r.ok) throw new Error(`OpenAI STT ${r.status}: ${await readError(r)}`);
  const j = await r.json();
  return (j.text || '').trim();
}

async function elevenTranscribe(buf, mime, lang) {
  const form = new FormData();
  form.append('file', new Blob([buf], { type: mime }), `question.${EXT[mime] || 'webm'}`);
  form.append('model_id', process.env.ELEVENLABS_STT_MODEL || 'scribe_v2');
  form.append('language_code', lang);
  form.append('tag_audio_events', 'false');
  const r = await fetch('https://api.elevenlabs.io/v1/speech-to-text', {
    method: 'POST',
    headers: { 'xi-api-key': keys().elevenlabs },
    body: form,
    signal: AbortSignal.timeout(20000),
  });
  if (!r.ok) throw new Error(`ElevenLabs STT ${r.status}: ${await readError(r)}`);
  const j = await r.json();
  return (j.text || '').trim();
}

async function geminiTranscribe(buf, mime, lang) {
  const name = LANGS[lang].name;
  const text = await geminiGenerate(
    [
      { inlineData: { mimeType: mime, data: buf.toString('base64') } },
      {
        text: `Transcribe the human speech in this audio exactly, in the language spoken (most likely ${name}). Return only the spoken words, nothing else. If there is no clear human speech (silence, noise, music), reply with exactly: [no speech]. Never invent words.`,
      },
    ],
    null,
    8192,
    true // silence is a valid, empty transcript
  );
  const out = text.replace(/^["'“”]+|["'“”]+$/g, '').trim();
  return /^\[?\s*no speech\s*\]?\.?$/i.test(out) ? '' : out;
}

export async function transcribe({ audio, mime, lang }) {
  const buf = Buffer.from(audio, 'base64');
  const base = (mime || 'audio/webm').split(';')[0].trim();
  // ElevenLabs Scribe and OpenAI accept every browser recording format, so they go first.
  const k = keys();
  const list = [k.elevenlabs && 'elevenlabs', k.openai && 'openai', k.gemini && 'gemini'].filter(Boolean);
  if (!list.length) throw Object.assign(new Error('No speech-to-text key configured'), { status: 503 });
  let lastErr;
  for (const p of list) {
    try {
      const fn = { elevenlabs: elevenTranscribe, openai: openaiTranscribe, gemini: geminiTranscribe }[p];
      return await fn(buf, base, lang);
    } catch (e) {
      lastErr = e;
    }
  }
  throw lastErr;
}

// ---------- text to speech ----------

// eleven_flash_v2_5 is the fastest but has no Malayalam, so Malayalam uses eleven_v3.
const ELEVEN_MODEL = { en: 'eleven_flash_v2_5', ar: 'eleven_flash_v2_5', ml: 'eleven_v3' };

async function elevenSpeech(text, lang) {
  const voice = process.env.ELEVENLABS_VOICE_ID || 'JBFqnCBsd6RMkjVDRZzb';
  const model = process.env[`ELEVENLABS_TTS_MODEL_${lang.toUpperCase()}`] || process.env.ELEVENLABS_TTS_MODEL || ELEVEN_MODEL[lang];
  const r = await fetch(`https://api.elevenlabs.io/v1/text-to-speech/${encodeURIComponent(voice)}?output_format=mp3_44100_128`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'xi-api-key': keys().elevenlabs, accept: 'audio/mpeg' },
    body: JSON.stringify({
      text,
      model_id: model,
      language_code: lang,
      voice_settings: { stability: 0.6, similarity_boost: 0.8 },
    }),
    signal: AbortSignal.timeout(20000),
  });
  if (!r.ok) throw new Error(`ElevenLabs TTS ${r.status}: ${await readError(r)}`);
  return Buffer.from(await r.arrayBuffer());
}

async function openaiSpeech(text, lang) {
  const r = await fetch('https://api.openai.com/v1/audio/speech', {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${keys().openai}` },
    body: JSON.stringify({
      model: process.env.OPENAI_TTS_MODEL || 'gpt-4o-mini-tts',
      voice: process.env.OPENAI_TTS_VOICE || 'alloy',
      input: text,
      instructions: `Speak clearly, warmly and calmly in ${LANGS[lang].name}.`,
      response_format: 'mp3',
    }),
    signal: AbortSignal.timeout(20000),
  });
  if (!r.ok) throw new Error(`OpenAI TTS ${r.status}: ${await readError(r)}`);
  return Buffer.from(await r.arrayBuffer());
}

export async function speech({ text, lang }) {
  const k = keys();
  const list = [k.elevenlabs && elevenSpeech, k.openai && openaiSpeech].filter(Boolean);
  if (!list.length) throw Object.assign(new Error('No text-to-speech key configured'), { status: 503 });
  let lastErr;
  for (const fn of list) {
    try {
      return await fn(text, lang);
    } catch (e) {
      lastErr = e;
    }
  }
  throw lastErr;
}
