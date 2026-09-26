// Every word the app says or shows, in English, Arabic and Malayalam.

export const LANG_ORDER = ['en', 'ar', 'ml'];
export const LOCALES = { en: 'en-US', ar: 'ar-SA', ml: 'ml-IN' };
export const RTL = { ar: true };

const STRINGS = {
  en: {
    appName: 'Eyes for Everyone',
    status: { start: 'START', ready: 'TAP', listening: 'LISTENING', thinking: 'THINKING', answer: 'ANSWER', settings: 'SETTINGS' },
    tapToStart: 'Tap anywhere to start.',
    srModeButton: 'Screen reader mode',
    start: 'Start',
    ready: 'Ready. Tap anywhere to take a photo.',
    photoTaken: 'Photo taken. Ask your question, then tap.',
    askNow: 'Ask your question, then tap.',
    tooDark: 'The photo is too dark. Turn on a light or move near a window, then tap.',
    tooBright: 'The photo is too bright. Move away from the light, then tap.',
    blurry: 'The photo is blurry. Hold the phone still, then tap.',
    thinking: 'Thinking.',
    tapAgain: 'Tap to ask again.',
    noAnswer: 'Sorry, I could not get an answer. Check the internet, then tap to try again.',
    noCamera: 'I cannot use the camera. Please allow camera access in your browser settings, then tap.',
    noMic: 'I cannot use the microphone. I will describe the photo.',
    didntHear: 'I did not catch your question. I will describe the photo.',
    nothingToRepeat: 'There is no answer yet.',
    newPhoto: 'New photo.',
    cancelled: 'Cancelled.',
    faster: 'Faster.',
    slower: 'Slower.',
    fastest: 'This is the fastest.',
    slowest: 'This is the slowest.',
    louder: 'Louder.',
    loudest: 'This is the loudest. Use your phone volume buttons.',
    languageName: 'English',
    textSize: 'Text size {n}.',
    biggest: 'This is the biggest text.',
    smallest: 'This is the smallest text.',
    themeNames: { yellow: 'Yellow on black', white: 'White on black', light: 'Black on white' },
    disclaimer: 'This is a helper, not a safety tool.',
    defaultQuestion: 'Describe what you see.',
    settings: {
      open: 'Settings. Tap a big button to change it.',
      speed: 'Speed {n}',
      size: 'Text {n}',
      sr: 'Reader: {v}',
      on: 'On',
      off: 'Off',
      done: 'Done',
    },
    sr: { takePhoto: 'Take photo', stop: 'Stop and ask', wait: 'Please wait', askAgain: 'Ask again', newPhoto: 'New photo', repeat: 'Repeat answer', settings: 'Settings' },
  },

  ar: {
    appName: 'عيون للجميع',
    status: { start: 'ابدأ', ready: 'انقر', listening: 'أستمع', thinking: 'أفكر', answer: 'الإجابة', settings: 'الإعدادات' },
    tapToStart: 'انقر في أي مكان للبدء.',
    srModeButton: 'وضع قارئ الشاشة',
    start: 'ابدأ',
    ready: 'جاهز. انقر في أي مكان لالتقاط صورة.',
    photoTaken: 'تم التقاط الصورة. اسأل سؤالك، ثم انقر.',
    askNow: 'اسأل سؤالك، ثم انقر.',
    tooDark: 'الصورة مظلمة جدًا. شغّل ضوءًا أو اقترب من نافذة، ثم انقر.',
    tooBright: 'الصورة ساطعة جدًا. ابتعد عن الضوء، ثم انقر.',
    blurry: 'الصورة غير واضحة. أمسك الهاتف بثبات، ثم انقر.',
    thinking: 'أفكر.',
    tapAgain: 'انقر لتسأل مرة أخرى.',
    noAnswer: 'عذرًا، لم أحصل على إجابة. تحقق من الإنترنت، ثم انقر للمحاولة مرة أخرى.',
    noCamera: 'لا أستطيع استخدام الكاميرا. يرجى السماح بالكاميرا في إعدادات المتصفح، ثم انقر.',
    noMic: 'لا أستطيع استخدام الميكروفون. سأصف الصورة.',
    didntHear: 'لم أفهم سؤالك. سأصف الصورة.',
    nothingToRepeat: 'لا توجد إجابة بعد.',
    newPhoto: 'صورة جديدة.',
    cancelled: 'تم الإلغاء.',
    faster: 'أسرع.',
    slower: 'أبطأ.',
    fastest: 'هذه أسرع سرعة.',
    slowest: 'هذه أبطأ سرعة.',
    louder: 'صوت أعلى.',
    loudest: 'هذا أعلى صوت. استخدم أزرار الصوت في هاتفك.',
    languageName: 'العربية',
    textSize: 'حجم الخط {n}.',
    biggest: 'هذا أكبر خط.',
    smallest: 'هذا أصغر خط.',
    themeNames: { yellow: 'أصفر على أسود', white: 'أبيض على أسود', light: 'أسود على أبيض' },
    disclaimer: 'هذا مساعد، وليس أداة للسلامة.',
    defaultQuestion: 'صف ما تراه.',
    settings: {
      open: 'الإعدادات. انقر على زر كبير لتغييره.',
      speed: 'السرعة {n}',
      size: 'الخط {n}',
      sr: 'القارئ: {v}',
      on: 'تشغيل',
      off: 'إيقاف',
      done: 'تم',
    },
    sr: { takePhoto: 'التقط صورة', stop: 'توقف واسأل', wait: 'يرجى الانتظار', askAgain: 'اسأل مرة أخرى', newPhoto: 'صورة جديدة', repeat: 'كرر الإجابة', settings: 'الإعدادات' },
  },

  ml: {
    appName: 'എല്ലാവർക്കും കണ്ണുകൾ',
    status: { start: 'തുടങ്ങുക', ready: 'തൊടുക', listening: 'കേൾക്കുന്നു', thinking: 'ചിന്തിക്കുന്നു', answer: 'ഉത്തരം', settings: 'ക്രമീകരണങ്ങൾ' },
    tapToStart: 'തുടങ്ങാൻ എവിടെയെങ്കിലും തൊടുക.',
    srModeButton: 'സ്ക്രീൻ റീഡർ മോഡ്',
    start: 'തുടങ്ങുക',
    ready: 'തയ്യാർ. ഫോട്ടോ എടുക്കാൻ എവിടെയെങ്കിലും തൊടുക.',
    photoTaken: 'ഫോട്ടോ എടുത്തു. നിങ്ങളുടെ ചോദ്യം ചോദിക്കൂ, എന്നിട്ട് തൊടുക.',
    askNow: 'നിങ്ങളുടെ ചോദ്യം ചോദിക്കൂ, എന്നിട്ട് തൊടുക.',
    tooDark: 'ഫോട്ടോ വളരെ ഇരുണ്ടതാണ്. ഒരു ലൈറ്റ് ഇടുക, അല്ലെങ്കിൽ ജനലിനടുത്തേക്ക് നീങ്ങുക, എന്നിട്ട് തൊടുക.',
    tooBright: 'ഫോട്ടോയിൽ വെളിച്ചം കൂടുതലാണ്. വെളിച്ചത്തിൽ നിന്ന് മാറുക, എന്നിട്ട് തൊടുക.',
    blurry: 'ഫോട്ടോ മങ്ങിയതാണ്. ഫോൺ അനങ്ങാതെ പിടിക്കുക, എന്നിട്ട് തൊടുക.',
    thinking: 'ആലോചിക്കുന്നു.',
    tapAgain: 'വീണ്ടും ചോദിക്കാൻ തൊടുക.',
    noAnswer: 'ക്ഷമിക്കണം, ഉത്തരം കിട്ടിയില്ല. ഇന്റർനെറ്റ് പരിശോധിക്കുക, എന്നിട്ട് വീണ്ടും ശ്രമിക്കാൻ തൊടുക.',
    noCamera: 'എനിക്ക് ക്യാമറ ഉപയോഗിക്കാൻ കഴിയുന്നില്ല. ബ്രൗസർ ക്രമീകരണങ്ങളിൽ ക്യാമറ അനുവദിക്കുക, എന്നിട്ട് തൊടുക.',
    noMic: 'എനിക്ക് മൈക്രോഫോൺ ഉപയോഗിക്കാൻ കഴിയുന്നില്ല. ഞാൻ ഫോട്ടോ വിവരിക്കാം.',
    didntHear: 'നിങ്ങളുടെ ചോദ്യം എനിക്ക് മനസ്സിലായില്ല. ഞാൻ ഫോട്ടോ വിവരിക്കാം.',
    nothingToRepeat: 'ഇതുവരെ ഉത്തരമൊന്നുമില്ല.',
    newPhoto: 'പുതിയ ഫോട്ടോ.',
    cancelled: 'റദ്ദാക്കി.',
    faster: 'വേഗത്തിൽ.',
    slower: 'പതുക്കെ.',
    fastest: 'ഇതാണ് ഏറ്റവും കൂടിയ വേഗത.',
    slowest: 'ഇതാണ് ഏറ്റവും കുറഞ്ഞ വേഗത.',
    louder: 'ഉച്ചത്തിൽ.',
    loudest: 'ഇതാണ് ഏറ്റവും കൂടിയ ശബ്ദം. ഫോണിന്റെ ശബ്ദ ബട്ടണുകൾ ഉപയോഗിക്കുക.',
    languageName: 'മലയാളം',
    textSize: 'അക്ഷര വലിപ്പം {n}.',
    biggest: 'ഇതാണ് ഏറ്റവും വലിയ അക്ഷരം.',
    smallest: 'ഇതാണ് ഏറ്റവും ചെറിയ അക്ഷരം.',
    themeNames: { yellow: 'കറുപ്പിൽ മഞ്ഞ', white: 'കറുപ്പിൽ വെള്ള', light: 'വെള്ളയിൽ കറുപ്പ്' },
    disclaimer: 'ഇതൊരു സഹായി മാത്രമാണ്, സുരക്ഷാ ഉപകരണമല്ല.',
    defaultQuestion: 'നിങ്ങൾ കാണുന്നത് വിവരിക്കുക.',
    settings: {
      open: 'ക്രമീകരണങ്ങൾ. മാറ്റാൻ ഒരു വലിയ ബട്ടൺ തൊടുക.',
      speed: 'വേഗത {n}',
      size: 'അക്ഷരം {n}',
      sr: 'റീഡർ: {v}',
      on: 'ഓൺ',
      off: 'ഓഫ്',
      done: 'കഴിഞ്ഞു',
    },
    sr: { takePhoto: 'ഫോട്ടോ എടുക്കുക', stop: 'നിർത്തി ചോദിക്കുക', wait: 'ദയവായി കാത്തിരിക്കുക', askAgain: 'വീണ്ടും ചോദിക്കുക', newPhoto: 'പുതിയ ഫോട്ടോ', repeat: 'ഉത്തരം ആവർത്തിക്കുക', settings: 'ക്രമീകരണങ്ങൾ' },
  },
};

let current = 'en';

export function setLang(code) {
  current = STRINGS[code] ? code : 'en';
  document.documentElement.lang = current;
  document.documentElement.dir = RTL[current] ? 'rtl' : 'ltr';
}

export function getLang() {
  return current;
}

// t('status.ready') or t('textSize', { n: 40 })
export function t(path, vars) {
  const pick = (lang) => path.split('.').reduce((o, k) => (o == null ? o : o[k]), STRINGS[lang]);
  let v = pick(current) ?? pick('en') ?? path;
  if (typeof v === 'string' && vars) v = v.replace(/\{(\w+)\}/g, (_, k) => vars[k] ?? '');
  return v;
}

export function detectLang() {
  const nav = (navigator.languages || [navigator.language || 'en']).map((l) => l.slice(0, 2).toLowerCase());
  return nav.find((l) => STRINGS[l]) || 'en';
}
