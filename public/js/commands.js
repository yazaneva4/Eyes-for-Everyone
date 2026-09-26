// Recognises short spoken commands like "repeat" or "faster" in all three languages.

const PHRASES = {
  repeat: ['repeat', 'say again', 'say that again', 'repeat that', 'again', 'كرر', 'اعد', 'اعد مره اخرى', 'كرر الاجابه', 'ആവർത്തിക്കുക', 'വീണ്ടും പറയുക', 'ആവർത്തിക്കൂ'],
  faster: ['faster', 'speak faster', 'speed up', 'اسرع', 'بسرعه', 'تكلم اسرع', 'വേഗം', 'വേഗത്തിൽ', 'വേഗം പറയുക'],
  slower: ['slower', 'speak slower', 'slow down', 'ابطا', 'ببطء', 'تكلم ابطا', 'പതുക്കെ', 'സാവധാനം', 'പതുക്കെ പറയുക'],
  louder: ['louder', 'volume up', 'speak louder', 'اعلى', 'ارفع الصوت', 'صوت اعلى', 'ഉച്ചത്തിൽ', 'ശബ്ദം കൂട്ടുക'],
  language: ['change language', 'language', 'switch language', 'غير اللغه', 'تغيير اللغه', 'اللغه', 'ഭാഷ മാറ്റുക', 'ഭാഷ'],
  bigger: ['bigger text', 'bigger', 'larger text', 'larger', 'text bigger', 'كبر الخط', 'خط اكبر', 'تكبير الخط', 'تكبير', 'വലിയ അക്ഷരം', 'അക്ഷരം വലുതാക്കുക'],
  smaller: ['smaller text', 'smaller', 'text smaller', 'صغر الخط', 'خط اصغر', 'تصغير الخط', 'ചെറിയ അക്ഷരം', 'അക്ഷരം ചെറുതാക്കുക'],
  theme: ['change theme', 'change colors', 'change colours', 'theme', 'غير الالوان', 'نمط الالوان', 'തീം മാറ്റുക'],
  settings: ['settings', 'open settings', 'الاعدادات', 'افتح الاعدادات', 'ക്രമീകരണങ്ങൾ'],
  describe: ['describe', 'describe it', 'what is this', 'what do you see', 'وصف', 'صف', 'ماذا ترى', 'ما هذا', 'വിവരിക്കുക', 'ഇതെന്താണ്'],
  qibla: ['qibla', 'qiblah', 'kibla', 'find qibla', 'قبلة', 'القبلة', 'اتجاه القبلة', 'وين القبلة', 'ഖിബ്‌ല', 'ഖിബ്ല'],
  help: ['help', 'help me', 'what can i say', 'مساعدة', 'ساعدني', 'المساعدة', 'സഹായം', 'സഹായിക്കൂ'],
  open: ['open', 'open photo', 'open picture', 'open image', 'gallery', 'افتح صورة', 'افتح الصورة', 'المعرض', 'الاستوديو', 'ഗാലറി', 'ചിത്രം തുറക്കുക'],
};

const FILLERS = ['please', 'can you', 'could you', 'من فضلك', 'لو سمحت', 'ممكن', 'ദയവായി'];

export function normalise(s) {
  return String(s)
    .toLowerCase()
    .replace(/[ً-ْـ]/g, '') // Arabic vowel marks and tatweel
    .replace(/[أإآ]/g, 'ا')
    .replace(/ة/g, 'ه')
    .replace(/ى/g, 'ي')
    .replace(/[.,!?؟،;:'"“”()\-]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

const TABLE = Object.entries(PHRASES).flatMap(([cmd, list]) => list.map((p) => [normalise(p), cmd]));

/** Returns a command name, or null if the text is a normal question. */
export function matchCommand(text) {
  let s = ` ${normalise(text)} `;
  for (const f of FILLERS) s = s.replace(` ${normalise(f)} `, ' ');
  s = s.trim();
  if (!s || s.split(' ').length > 4) return null;
  const hit = TABLE.find(([p]) => p === s);
  return hit ? hit[1] : null;
}
