# Eyes for Everyone

A phone web app for people with low vision. **The whole screen is one giant button.**
Tap to take a photo, ask a question out loud, tap again, and hear the answer.

| Gesture | What happens |
| --- | --- |
| **Tap** (READY) | Takes a photo (shutter sound + buzz). Too dark or blurry? It tells you and waits. |
| **Tap** (LISTENING) | Stops recording and asks the AI. |
| **Tap** (ANSWER) | Ask another question about the **same** photo. |
| **Double-tap** | New photo. |
| **Press and hold** | Repeat the last answer. |
| **Hold 3 seconds** | Settings (language, speed, text size, theme, screen reader mode). |
| Say *repeat · faster · slower · louder · change language · bigger text* | Voice commands while listening (English, Arabic, Malayalam). |

Taps while THINKING are ignored, and extra taps within 500 ms are ignored so accidental double touches do nothing.

---

## Folder structure (one sentence each, for a 9-year-old)

```
Eyes-for-Everyone/
├── api/                      ← the small robots that live on the server
│   ├── ask.js                ← takes your photo and question and asks the AI what it sees.
│   ├── transcribe.js         ← listens to your recorded voice and writes down the words.
│   ├── speak.js              ← reads text out loud when your phone has no voice for that language.
│   ├── health.js             ← tells the app which AI helpers are switched on.
│   └── _lib/
│       ├── ai.js             ← knows how to talk to Gemini and GPT, and holds the AI's rules.
│       └── http.js           ← the door guard that only lets our own app in.
├── public/                   ← everything your phone downloads
│   ├── index.html            ← the skeleton of the one big screen.
│   ├── css/app.css           ← the paint: big letters, strong colours and shiny glass.
│   ├── js/app.js             ← the brain that decides what happens after every tap.
│   ├── js/camera.js          ← opens the camera, snaps the photo, and checks it is not too dark or blurry.
│   ├── js/listen.js          ← records your question with the microphone.
│   ├── js/voice.js           ← makes the phone talk.
│   ├── js/sounds.js          ← makes the little click, beep and chime sounds.
│   ├── js/commands.js        ← notices when you say "repeat" or "faster" instead of a question.
│   ├── js/i18n.js            ← every sentence in English, Arabic and Malayalam.
│   ├── js/settings.js        ← remembers your language, speed, text size and colours on your phone.
│   ├── manifest.webmanifest  ← lets you add the app to your home screen like a real app.
│   ├── icons/icon.svg        ← the app's eye picture.
│   └── test/                 ← the secret grown-up page at /test
│       ├── index.html        ← the test page layout.
│       ├── test.js           ← runs many photos through the AI and lets you mark Correct, Partly or Wrong.
│       └── test.css          ← the test page's paint.
├── dev-server.js             ← a pretend Vercel so you can try the app on your laptop.
├── vercel.json               ← instructions that tell Vercel how to put the app on the internet.
├── package.json              ← the app's name tag.
├── .env.example              ← a blank form showing where the secret AI keys go.
└── .gitignore                ← a list of files that must never be uploaded (like your keys).
```

---

## Run it on your laptop

1. **Install Node.js** (one time): download the LTS version from <https://nodejs.org> and install it.
2. **Add your AI key(s):** copy `.env.example` to a new file named `.env` and paste your key(s):
   ```
   GEMINI_API_KEY=your-gemini-key
   OPENAI_API_KEY=your-openai-key
   ```
   One is enough. **GPT is recommended for speech-to-text and needed for the server voice** (useful for Malayalam).
   With no keys at all, the app still runs in *demo mode* with a pretend answer.
3. **Start it:**
   ```bash
   node dev-server.js
   ```
4. Open <http://localhost:3000>. Add `?demo` to the address (<http://localhost:3000/?demo>) to use a pretend camera if your laptop has none.

No `npm install` is needed. The app has zero dependencies.

## Open it on your phone

Phones only allow the camera and microphone on **https** pages. The easy way is Vercel:

### A. Vercel (recommended)
1. Go to <https://vercel.com/yazaneva4-3470s-projects/eyes-for-everyone> → **Settings → Git** and connect the GitHub repo `yazaneva4/Eyes-for-Everyone` (if it is not already connected).
2. **Settings → Environment Variables**: add `GEMINI_API_KEY` and/or `OPENAI_API_KEY` (Production + Preview).
3. Framework preset: **Other**. Leave build command empty. (`vercel.json` already sets the output folder to `public`.)
4. Every `git push` deploys automatically. Open the `…vercel.app` link on your phone.
5. Optional: in Safari or Chrome, choose **Add to Home Screen** so it opens full-screen like an app.

### B. On your home Wi-Fi (for quick testing)
```bash
mkdir -p .cert && openssl req -x509 -newkey rsa:2048 -nodes -days 365 -subj "/CN=localhost" -keyout .cert/key.pem -out .cert/cert.pem
node dev-server.js
```
The server prints a `Phone: https://192.168.x.x:3000` address. Open it on a phone on the same Wi-Fi and accept the certificate warning.

---

## The test page (`/test`)

It is not linked anywhere. Type `/test` after the address.

1. Put photos in a folder. Add `questions.csv` with the columns `file,question`, or `questions.json` like `{"photo1.jpg": "What does the label say?"}`.
2. Click **Photo folder** and choose the folder, then **Run all**.
3. Mark each reply **Correct / Partly / Wrong**. The score is shown at the top.
4. **Export CSV** downloads a results table (file, question, language, AI, reply, rating, time).

Replies and ratings are kept in that browser only. Photos are never stored.

---

## Privacy and safety

- API keys live only in `.env` / Vercel environment variables. Browser code never sees them.
- Photos, audio and transcripts are **never saved**. They stay in the phone's memory and are sent once to the AI, and the server does not log them.
- The API only answers requests from the app's own website.
- The AI follows strict rules in `api/_lib/ai.js`:
  - It answers in the user's language with short sentences, most important thing first, with positions and colours.
  - It never identifies people.
  - It reads printed text exactly. For medicine it reads the printed text only, then says "Please check with a person."
  - It gives no medical advice and no road-crossing or other safety-critical guidance.
  - It says "I'm not sure" and asks for a new photo instead of guessing.
- On first run the app shows and speaks: **"This is a helper, not a safety tool."**
- Camera and microphone turn off when the app goes to the background.

## Low-vision design

- Text is 32–64 pt and never scrolls. Long answers shrink to fit, then show one sentence at a time in step with the voice.
- There are three themes, all well above 7:1 contrast: yellow on black (default), white on black, and black on white. The "liquid glass" panels are at least 85% opaque, so the camera behind them can't lower the contrast.
- The screen stays awake, and portrait and landscape both work.
- Live regions announce every state to screen readers. **Screen reader mode** swaps gestures for a few huge buttons.
- No tutorial: the first tap opens the camera (the phone asks for permission) and the app speaks the disclaimer once.

## Settings you can change (optional environment variables)

| Name | Default | Meaning |
| --- | --- | --- |
| `AI_PROVIDER` | `gemini` | Which AI answers first. The other one is the automatic fallback. |
| `GEMINI_MODEL` | `gemini-flash-latest` | Gemini model for answers. |
| `OPENAI_MODEL` | `gpt-4.1-mini` | GPT model for answers. |
| `OPENAI_TRANSCRIBE_MODEL` | `gpt-4o-mini-transcribe` | Speech-to-text model. |
| `OPENAI_TTS_MODEL` | `gpt-4o-mini-tts` | Server voice, used only when the phone has no voice for the language. |
