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

function keys() {
  return {
    gemini:
      process.env.GEMINI_API_KEY ||
      process.env.GOOGLE_API_KEY ||
      process.env.GOOGLE_GENERATIVE_AI_API_KEY ||
      '',
    openai: process.env.OPENAI_API_KEY || '',
  };
}

export function available() {
  const k = keys();
  const mock = process.env.MOCK_AI === '1';
  return {
    gemini: !!k.gemini,
    openai: !!k.openai,
    ask: mock || !!(k.gemini || k.openai),
    transcribe: !!(k.gemini || k.openai),
    speak: !!k.openai,
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

async function geminiGenerate(parts, system, maxTokens = 2048) {
  const model = process.env.GEMINI_MODEL || 'gemini-flash-latest';
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
  if (!r.ok) throw new Error(`Gemini ${r.status}: ${await readError(r)}`);
  const j = await r.json();
  return (j.candidates?.[0]?.content?.parts || [])
    .map((p) => p.text || '')
    .join('')
    .trim();
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

async function geminiTranscribe(buf, mime, lang) {
  const name = LANGS[lang].name;
  const text = await geminiGenerate(
    [
      { inlineData: { mimeType: mime, data: buf.toString('base64') } },
      {
        text: `Transcribe the speech in this audio exactly, in the language spoken (most likely ${name}). Return only the spoken words, nothing else. If there is no speech, return an empty reply.`,
      },
    ],
    null,
    1024
  );
  return text.replace(/^["'“”]+|["'“”]+$/g, '').trim();
}

export async function transcribe({ audio, mime, lang }) {
  const buf = Buffer.from(audio, 'base64');
  const base = (mime || 'audio/webm').split(';')[0].trim();
  // OpenAI handles every browser recording format, so it goes first for speech.
  const k = keys();
  const list = [k.openai && 'openai', k.gemini && 'gemini'].filter(Boolean);
  if (!list.length) throw Object.assign(new Error('No speech-to-text key configured'), { status: 503 });
  let lastErr;
  for (const p of list) {
    try {
      return p === 'openai' ? await openaiTranscribe(buf, base, lang) : await geminiTranscribe(buf, base, lang);
    } catch (e) {
      lastErr = e;
    }
  }
  throw lastErr;
}

// ---------- text to speech (used when the phone has no voice for a language) ----------

export async function speech({ text, lang }) {
  if (!keys().openai) throw Object.assign(new Error('No text-to-speech key configured'), { status: 503 });
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
