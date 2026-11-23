// Sense by Shafiq - researched device settings database.
// Sources (fetched 2026-11-23):
//  - vortexgaming.io device/RAM-tier guide: DPI + sensitivity per RAM class
//  - item4gamer.com 2025 brand table: Samsung/Xiaomi/Realme/iPhone/Huawei
//  - xascomplo.org per-brand values + DPI method (Developer Options > Smallest Width)
//  - sensiff.pro refresh-rate guide (sensitivity math unchanged by Hz; stability + battery saver advice)
// Scale: 0-200 (current Free Fire sliders). DPI via "Smallest Width" developer setting.

const BRAND = {
  samsung: { general: 190, redDot: 95,  scope2x: 85,  scope4x: 75,  sniper: 62, freeLook: 73, dpi: 420 },
  xiaomi:  { general: 200, redDot: 98,  scope2x: 92,  scope4x: 86,  sniper: 54, freeLook: 60, dpi: 410 },
  realme:  { general: 193, redDot: 97,  scope2x: 89,  scope4x: 83,  sniper: 70, freeLook: 100, dpi: 430 },
  infinix: { general: 190, redDot: 95,  scope2x: 88,  scope4x: 90,  sniper: 55, freeLook: 87, dpi: 440 },
  tecno:   { general: 190, redDot: 95,  scope2x: 88,  scope4x: 90,  sniper: 55, freeLook: 87, dpi: 440 },
  vivo:    { general: 195, redDot: 100, scope2x: 100, scope4x: 100, sniper: 85, freeLook: 100, dpi: 450 },
  oppo:    { general: 190, redDot: 65,  scope2x: 60,  scope4x: 50,  sniper: 45, freeLook: 100, dpi: 430 },
  honor:   { general: 188, redDot: 90,  scope2x: 80,  scope4x: 72,  sniper: 55, freeLook: 75, dpi: 420 },
  huawei:  { general: 188, redDot: 90,  scope2x: 80,  scope4x: 72,  sniper: 55, freeLook: 75, dpi: 400 },
  generic: { general: 192, redDot: 96,  scope2x: 88,  scope4x: 82,  sniper: 60, freeLook: 80, dpi: 440 }
};

// DPI by RAM tier (vortexgaming). null = لا تغيّر DPI (موبايلات 2 جيجا عليها لاج)
const RAM_DPI = { 2: null, 3: 425, 4: 497, 6: 525, 8: 560, 12: 591 };

// DPI per model: computed from the actual screen (size + resolution -> density -> stock smallest-width dp),
// then kept coherent with the sensitivity as one unit: generalSens x dpi stays ~constant around the balanced anchor.
const SENS_ANCHOR = 193;
const RAM_DPI_CAP = { 3: 460, 4: 540, 6: 600, 8: 640, 12: 680 };
function screenPpi(m) { if (!m.scr) return null; const [inch, w, h] = m.scr; return Math.round(Math.sqrt(w * w + h * h) / inch); }
function stockDp(m) { const p = screenPpi(m); if (!p) return null; return m.scr[1] * 160 / p; }
function dpiFor(m, generalSens) {
  const tier = ramTier(m.ram);
  if (tier === 2) return null; // 2GB: لا ننصح بتغيير DPI (لاج)
  const sd = stockDp(m);
  const base = sd != null ? sd * 1.30 : (RAM_DPI[tier] != null ? RAM_DPI[tier] : (BRAND[m.brand] || BRAND.generic).dpi);
  const cap = Math.min(sd != null ? sd * 1.65 : 700, RAM_DPI_CAP[tier] || 640);
  const floor = sd != null ? sd * 1.05 : 380;
  const coherent = base * (SENS_ANCHOR / Math.max(120, generalSens || SENS_ANCHOR));
  return Math.max(300, Math.min(800, Math.round(Math.min(cap, Math.max(floor, coherent)) / 5) * 5));
}
function dpiNote(m, dpi) {
  const p = screenPpi(m);
  if (p == null || dpi == null) return '';
  return 'DPI ' + dpi + ' محسوب من شاشة موبايلك (' + m.scr[0] + ' بوصة، ~' + p + ' بكسل/بوصة) ومتوازن مع الحساسية عشان الحركة الكلية تفضل ثابتة.';
}

// جيروسكوب: متوازن مع حساسية السيت وفئة الموبايل (الأخف/الأرخص = أهدى)
const GYRO_TIER = { 2: 130, 3: 145, 4: 160, 6: 175, 8: 190, 12: 195 };
function gyroFor(m, sensGeneral) {
  const tier = ramTier(m.ram || 4);
  const base = GYRO_TIER[tier] || 160;
  const g = Math.max(1, Math.min(200, Math.round(base * (SENS_ANCHOR / Math.max(120, sensGeneral || SENS_ANCHOR)) / 5) * 5));
  return {
    general: g,
    redDot: Math.min(200, Math.round(g * 0.95 / 5) * 5),
    scope2x: Math.min(200, Math.round(g * 0.9 / 5) * 5),
    scope4x: Math.min(200, Math.round(g * 0.8 / 5) * 5),
    sniper: Math.min(200, Math.round(g * 0.6 / 5) * 5)
  };
}

// رفع الفريمات - طرق شرعية 100%: إعدادات اللعبة نفسها + إعدادات الموبايل (ممنوع GFX tools أو تعديل ملفات)
const FPS_GENERAL_TIPS = [
  'اقفل كل التطبيقات اللي في الخلفية قبل ما تلعب.',
  'فعّل وضع الألعاب / الأداء من إعدادات الموبايل.',
  'العب والبطارية فوق 20% ووضع توفير البطارية مقفول.',
  'متلعبش والموبايل سخن أو بيشحن — السخونية بتقلل الفريمات.',
  'سيب مساحة فاضية في التخزين (3-4 جيجا على الأقل).',
  'نضف الشاشة وإيدك — اللمس النضيف استجابته أسرع.'
];
function fpsBoostFor(m) {
  const tier = ramTier(m.ram || 4);
  const hz = m.hz || 60;
  const cls = (tier >= 8 || hz >= 120) ? 'قوي' : (tier >= 4 ? 'متوسط' : 'ضعيف');
  const fpsLevel = hz >= 120 ? 'ألترا (لو متاح) وإلا عالي' : hz >= 90 ? 'عالي' : 'عادي';
  const inGame = [
    { k: 'الرسومات', v: 'سلس (Smooth)' },
    { k: 'معدل FPS', v: fpsLevel, d: hz >= 90 ? 'شاشتك ' + hz + 'Hz — فعّل أعلى معدل من إعدادات شاشة الموبايل الأول' : 'موبايلك ' + hz + 'Hz — الثبات أهم من الرقم' },
    { k: 'الظلال (Shadows)', v: 'مقفولة' },
    { k: 'الضبط التلقائي للجرافيك', v: 'مقفول', d: 'لو سيبته شغال اللعبة بتلعب بالفريمات في نص الجيم' },
    { k: 'جودة العرض العالية (HD)', v: 'مقفولة' }
  ];
  const tierNotes = cls === 'ضعيف'
    ? ['موبايلك من الفئة الضعيفة: اقفل التنزيل التلقائي للموارد من إعدادات اللعبة.', 'امسح كاش اللعبة كل فترة من إعدادات الموبايل > التطبيقات > فري فاير > مسح الكاش (مش مسح البيانات).', 'قلل الأصوات والمؤثرات من إعدادات اللعبة.']
    : cls === 'متوسط'
    ? ['موبايلك من الفئة المتوسطة: لو حسيت بتهنيج وقت الزحمة، وطّي FPS لعادي مؤقتًا — ثبات الفريم أهم من الرقم العالي.']
    : ['موبايلك قوي: فعّل أعلى معدل تحديث للشاشة من إعدادات الموبايل نفسها قبل اللعب.', 'شغّل وضع الأداء/الألعاب من إعدادات الموبايل لو موجود.'];
  return { cls, inGame, deviceGeneral: FPS_GENERAL_TIPS, deviceTier: tierNotes };
}

function ramTier(ram) {
  if (ram <= 2) return 2;
  if (ram <= 3) return 3;
  if (ram <= 4) return 4;
  if (ram <= 6) return 6;
  if (ram <= 8) return 8;
  return 12;
}

// keys: lowercase substrings matched against Build.MODEL or a typed name
// ram: GB, hz: screen refresh, brand: key of BRAND
const MODELS = [
  { keys: ['sm-a05'], name: 'Samsung Galaxy A05', scr: [6.7, 720, 1600], brand: 'samsung', ram: 4, hz: 60 },
  { keys: ['sm-a06'], name: 'Samsung Galaxy A06', scr: [6.7, 720, 1600], brand: 'samsung', ram: 4, hz: 60 },
  { keys: ['sm-a15'], name: 'Samsung Galaxy A15', scr: [6.5, 1080, 2340], brand: 'samsung', ram: 4, hz: 90 },
  { keys: ['sm-a16'], name: 'Samsung Galaxy A16', scr: [6.7, 1080, 2340], brand: 'samsung', ram: 4, hz: 90 },
  { keys: ['sm-a25'], name: 'Samsung Galaxy A25', scr: [6.5, 1080, 2340], brand: 'samsung', ram: 6, hz: 120 },
  { keys: ['sm-a26'], name: 'Samsung Galaxy A26', scr: [6.7, 1080, 2340], brand: 'samsung', ram: 6, hz: 120 },
  { keys: ['sm-a35'], name: 'Samsung Galaxy A35', scr: [6.6, 1080, 2340], brand: 'samsung', ram: 6, hz: 120 },
  { keys: ['sm-a36'], name: 'Samsung Galaxy A36', scr: [6.7, 1080, 2340], brand: 'samsung', ram: 6, hz: 120 },
  { keys: ['sm-a54'], name: 'Samsung Galaxy A54', scr: [6.4, 1080, 2340], brand: 'samsung', ram: 8, hz: 120 },
  { keys: ['sm-a55'], name: 'Samsung Galaxy A55', scr: [6.6, 1080, 2340], brand: 'samsung', ram: 8, hz: 120 },
  { keys: ['sm-a56'], name: 'Samsung Galaxy A56', scr: [6.7, 1080, 2340], brand: 'samsung', ram: 8, hz: 120 },
  { keys: ['sm-a73'], name: 'Samsung Galaxy A73', scr: [6.7, 1080, 2400], brand: 'samsung', ram: 8, hz: 120 },
  { keys: ['sm-s91'], name: 'Samsung Galaxy S23', scr: [6.1, 1080, 2340], brand: 'samsung', ram: 8, hz: 120 },
  { keys: ['sm-s92'], name: 'Samsung Galaxy S24', scr: [6.2, 1080, 2340], brand: 'samsung', ram: 8, hz: 120 },
  { keys: ['sm-s93'], name: 'Samsung Galaxy S25', scr: [6.2, 1080, 2340], brand: 'samsung', ram: 12, hz: 120 },
  { keys: ['sm-m14', 'sm-m15'], name: 'Samsung Galaxy M14/M15', scr: [6.6, 1080, 2408], brand: 'samsung', ram: 4, hz: 90 },
  { keys: ['redmi note 13 pro'], name: 'Redmi Note 13 Pro', scr: [6.67, 1220, 2712], brand: 'xiaomi', ram: 8, hz: 120 },
  { keys: ['redmi note 13'], name: 'Redmi Note 13', scr: [6.67, 1080, 2400], brand: 'xiaomi', ram: 6, hz: 120 },
  { keys: ['redmi note 14'], name: 'Redmi Note 14', scr: [6.67, 1080, 2400], brand: 'xiaomi', ram: 6, hz: 120 },
  { keys: ['redmi note 12'], name: 'Redmi Note 12', scr: [6.67, 1080, 2400], brand: 'xiaomi', ram: 4, hz: 120 },
  { keys: ['redmi note 11'], name: 'Redmi Note 11', scr: [6.43, 1080, 2400], brand: 'xiaomi', ram: 4, hz: 90 },
  { keys: ['redmi 13c'], name: 'Redmi 13C', scr: [6.74, 720, 1600], brand: 'xiaomi', ram: 4, hz: 90 },
  { keys: ['redmi 14c'], name: 'Redmi 14C', scr: [6.88, 720, 1640], brand: 'xiaomi', ram: 4, hz: 120 },
  { keys: ['redmi 12'], name: 'Redmi 12', scr: [6.79, 1080, 2460], brand: 'xiaomi', ram: 4, hz: 90 },
  { keys: ['redmi 13'], name: 'Redmi 13', scr: [6.79, 1080, 2460], brand: 'xiaomi', ram: 6, hz: 90 },
  { keys: ['redmi a3'], name: 'Redmi A3', scr: [6.71, 720, 1650], brand: 'xiaomi', ram: 3, hz: 90 },
  { keys: ['poco x6'], name: 'Poco X6', scr: [6.67, 1220, 2712], brand: 'xiaomi', ram: 8, hz: 120 },
  { keys: ['poco x7'], name: 'Poco X7', scr: [6.67, 1220, 2712], brand: 'xiaomi', ram: 8, hz: 120 },
  { keys: ['poco x5'], name: 'Poco X5', scr: [6.67, 1080, 2400], brand: 'xiaomi', ram: 6, hz: 120 },
  { keys: ['poco m6'], name: 'Poco M6', scr: [6.79, 1080, 2460], brand: 'xiaomi', ram: 4, hz: 90 },
  { keys: ['poco m7'], name: 'Poco M7', scr: [6.88, 720, 1640], brand: 'xiaomi', ram: 6, hz: 90 },
  { keys: ['poco f5'], name: 'Poco F5', scr: [6.67, 1080, 2400], brand: 'xiaomi', ram: 8, hz: 120 },
  { keys: ['poco f6'], name: 'Poco F6', scr: [6.67, 1220, 2712], brand: 'xiaomi', ram: 8, hz: 120 },
  { keys: ['poco c65', 'poco c75'], name: 'Poco C65/C75', scr: [6.8, 720, 1640], brand: 'xiaomi', ram: 4, hz: 90 },
  { keys: ['realme c55'], name: 'Realme C55', scr: [6.72, 1080, 2400], brand: 'realme', ram: 6, hz: 90 },
  { keys: ['realme c61', 'realme c63', 'realme c65'], name: 'Realme C61/C63/C65', scr: [6.74, 720, 1600], brand: 'realme', ram: 4, hz: 90 },
  { keys: ['realme c11', 'realme c12', 'realme c15', 'realme c17'], name: 'Realme C11-C17', scr: [6.5, 720, 1600], brand: 'realme', ram: 3, hz: 60 },
  { keys: ['realme 12'], name: 'Realme 12', scr: [6.67, 1080, 2400], brand: 'realme', ram: 8, hz: 120 },
  { keys: ['realme 11'], name: 'Realme 11', scr: [6.4, 1080, 2400], brand: 'realme', ram: 8, hz: 120 },
  { keys: ['realme 9'], name: 'Realme 9', scr: [6.4, 1080, 2400], brand: 'realme', ram: 6, hz: 90 },
  { keys: ['realme note 50'], name: 'Realme Note 50', scr: [6.74, 720, 1600], brand: 'realme', ram: 4, hz: 90 },
  { keys: ['hot 40'], name: 'Infinix Hot 40', scr: [6.78, 1080, 2460], brand: 'infinix', ram: 8, hz: 90 },
  { keys: ['hot 50'], name: 'Infinix Hot 50', scr: [6.78, 1080, 2460], brand: 'infinix', ram: 8, hz: 120 },
  { keys: ['hot 30'], name: 'Infinix Hot 30', scr: [6.78, 1080, 2460], brand: 'infinix', ram: 8, hz: 90 },
  { keys: ['note 40'], name: 'Infinix Note 40', scr: [6.78, 1080, 2436], brand: 'infinix', ram: 8, hz: 120 },
  { keys: ['note 50'], name: 'Infinix Note 50', scr: [6.78, 1080, 2436], brand: 'infinix', ram: 8, hz: 120 },
  { keys: ['smart 8', 'smart 9'], name: 'Infinix Smart 8/9', scr: [6.6, 720, 1612], brand: 'infinix', ram: 4, hz: 90 },
  { keys: ['gt 10', 'gt 20'], name: 'Infinix GT', scr: [6.78, 1080, 2436], brand: 'infinix', ram: 8, hz: 120 },
  { keys: ['spark 20'], name: 'Tecno Spark 20', scr: [6.6, 720, 1612], brand: 'tecno', ram: 4, hz: 90 },
  { keys: ['spark 30'], name: 'Tecno Spark 30', scr: [6.78, 1080, 2460], brand: 'tecno', ram: 8, hz: 90 },
  { keys: ['spark go'], name: 'Tecno Spark Go', scr: [6.67, 720, 1600], brand: 'tecno', ram: 3, hz: 90 },
  { keys: ['camon 30'], name: 'Tecno Camon 30', scr: [6.78, 1080, 2436], brand: 'tecno', ram: 8, hz: 120 },
  { keys: ['camon 40'], name: 'Tecno Camon 40', scr: [6.78, 1080, 2436], brand: 'tecno', ram: 8, hz: 120 },
  { keys: ['pova 5', 'pova 6'], name: 'Tecno Pova 5/6', scr: [6.78, 1080, 2460], brand: 'tecno', ram: 8, hz: 120 },
  { keys: ['oppo a58'], name: 'Oppo A58', scr: [6.72, 1080, 2400], brand: 'oppo', ram: 6, hz: 90 },
  { keys: ['oppo a78'], name: 'Oppo A78', scr: [6.43, 1080, 2400], brand: 'oppo', ram: 8, hz: 90 },
  { keys: ['oppo a3'], name: 'Oppo A3', scr: [6.67, 720, 1604], brand: 'oppo', ram: 6, hz: 90 },
  { keys: ['oppo a5'], name: 'Oppo A5', scr: [6.67, 720, 1604], brand: 'oppo', ram: 6, hz: 90 },
  { keys: ['oppo reno'], name: 'Oppo Reno', scr: [6.4, 1080, 2340], brand: 'oppo', ram: 8, hz: 120 },
  { keys: ['vivo y28'], name: 'Vivo Y28', scr: [6.68, 720, 1608], brand: 'vivo', ram: 8, hz: 90 },
  { keys: ['vivo y27', 'vivo y36'], name: 'Vivo Y27/Y36', scr: [6.64, 1080, 2388], brand: 'vivo', ram: 8, hz: 90 },
  { keys: ['vivo y1', 'vivo y2'], name: 'Vivo Y series', scr: [6.56, 720, 1612], brand: 'vivo', ram: 4, hz: 60 },
  { keys: ['honor x8', 'honor x9'], name: 'Honor X8/X9', scr: [6.8, 1080, 2388], brand: 'honor', ram: 6, hz: 90 },
  { keys: ['honor x6', 'honor x7'], name: 'Honor X6/X7', scr: [6.6, 720, 1600], brand: 'honor', ram: 4, hz: 90 }
];

const BRAND_GUESS = [
  [/sm-s9|sm-s8|galaxy s2|galaxy note2/, { brand: 'samsung', ram: 8, hz: 120 }],
  [/sm-a5|sm-a7|galaxy a5|galaxy a7/, { brand: 'samsung', ram: 6, hz: 90 }],
  [/sm-a|galaxy a|sm-m|galaxy m/, { brand: 'samsung', ram: 4, hz: 90 }],
  [/sm-j|galaxy j/, { brand: 'samsung', ram: 3, hz: 60 }],
  [/poco f|redmi k|mi 1[0-9]/, { brand: 'xiaomi', ram: 8, hz: 120 }],
  [/redmi note|poco x/, { brand: 'xiaomi', ram: 6, hz: 120 }],
  [/redmi|poco|xiaomi/, { brand: 'xiaomi', ram: 4, hz: 90 }],
  [/realme gt|realme [0-9]/, { brand: 'realme', ram: 6, hz: 120 }],
  [/realme|rmx/, { brand: 'realme', ram: 4, hz: 90 }],
  [/infinix/, { brand: 'infinix', ram: 4, hz: 90 }],
  [/tecno|itel/, { brand: 'tecno', ram: 4, hz: 90 }],
  [/reno|find x/, { brand: 'oppo', ram: 8, hz: 120 }],
  [/oppo|cph/, { brand: 'oppo', ram: 4, hz: 90 }],
  [/vivo/, { brand: 'vivo', ram: 4, hz: 90 }],
  [/honor|huawei/, { brand: 'honor', ram: 4, hz: 90 }],
  [/pixel/, { brand: 'generic', ram: 8, hz: 120 }],
  [/oneplus/, { brand: 'generic', ram: 8, hz: 120 }],
  [/motorola|moto g/, { brand: 'generic', ram: 4, hz: 90 }]
];

function clamp(v) { return Math.max(1, Math.min(200, Math.round(v))); }

function build(m, matchType, query) {
  const b = BRAND[m.brand] || BRAND.generic;
  const tier = ramTier(m.ram);
  // low-RAM devices: general sensitivity up a notch (per vortexgaming low tiers)
  const boost = m.ram <= 3 ? 8 : 0;
  const hz = m.hz || 60;
  // refresh rate: higher Hz catches overshoot sooner, tolerates a touch more sensitivity (sensiff)
  const hzBoost = hz >= 120 ? 3 : hz >= 90 ? 1 : -3;
  const sens = {
    general: clamp(b.general * (m.ram <= 3 ? 0.96 : 1) + boost + hzBoost),
    redDot: clamp(b.redDot + boost + hzBoost),
    scope2x: clamp(b.scope2x + boost + hzBoost),
    scope4x: clamp(b.scope4x + boost + hzBoost),
    sniper: clamp(b.sniper),
    freeLook: clamp(b.freeLook)
  };
  const dpi = dpiFor(m, sens.general);
  const dpiN = dpiNote(m, dpi);
  const fps = hz >= 120 ? 'High / Ultra (90-120 إطار)' : hz >= 90 ? 'High (60-90 إطار)' : 'عادي (40-60 إطار)';
  const tips = [];
  tips.push('الإعدادات دي متظبطة خصيصًا عشان تقوّي تصويبك للراس (الهيدشوت) — القيم مدروسة حسب موبايلك بالظبط، والتزام بيها هتحس بفرق من أول جيم.');
  tips.push('تكنيك الهيدشوت: بعد ما التصويب يلمس جسم الخصم، اسحب زرار الضرب لفوق بسرعة — الحساسية هنا متظبطة عشان السحبة توصل للراس من غير ما تعدّي.');
  if (dpi == null) tips.push('موبايلك رام 2 جيجا أو أقل: منصحش تغيّر DPI نهائيًا عشان اللاج، خلّيه زي ما هو.');
  else tips.push('غيّر الـ DPI من: إعدادات الموبايل > خيارات المطوّر > Smallest Width (أو عرض الحد الأدنى) وخلّيه ' + dpi + '.' + (dpiN ? ' ' + dpiN : ''));
  tips.push('الجرافيك: Smooth دايمًا، وشغّل High FPS لو متاح، واقفل الظلال (Shadows).');
  if (hz >= 90) tips.push('شاشتك ' + hz + 'Hz: تأكد إن معدل التحديث على أعلى قيمة من إعدادات الشاشة قبل اللعب.');
  tips.push('اقفل وضع توفير البطارية وهو بيلعب، بيقلل استجابة اللمس.');
  tips.push('حجم زرار الضرب: بين 48 و 56، وجرب في ساحة التدريب وظبط رقم رقم لحد ما ترتاح.');
  const weapons = [
    { k: 'قريب المدى (SMG / شوتجن)', v: 'ريد دوت ' + sens.redDot, d: 'العب بسحبة سريعة لفوق بعد أول طلقة (Drag Shot)، وحجم زرار الضرب 45-56% بيساعد السحبة' },
    { k: 'متوسط المدى (AR بسكوب 2x)', v: 'سكوب 2x: ' + sens.scope2x, d: 'ثابت للمعارك المتوسطة، تتبع الهدف بحركة مستمرة' },
    { k: 'بعيد المدى (AR بسكوب 4x)', v: 'سكوب 4x: ' + sens.scope4x, d: 'أقل شوية عشان يقلل الرشاش (recoil) وقت السبراي' },
    { k: 'سنايبر (AWM وغيره)', v: 'سنايبر ' + sens.sniper, d: 'حساسية هادية عشان التصويب ما يهتزش، والطلقة الواحدة تحسم' },
    { k: 'لف الكاميرا والاستكشاف', v: 'نظرة حرة ' + sens.freeLook, d: 'لكشف المنطقة من غير ما تغيّر اتجاهك' }
  ];
  const controls = [
    { k: 'دقة التصويب (Aim Precision)', v: 'Default', why: 'النظام بيساعد يقفل التصويب على الجسم قبل ما تسحب للراس' },
    { k: 'مساعدة التصويب (Aim Assist)', v: 'ON', why: '' },
    { k: 'زرار الضرب الشمال (Left Fire Button)', v: 'Always Show', why: 'ضروري للتبديل السريع والضرب من غير سكوب' },
    { k: 'حجم زرار الضرب اليمين', v: tier >= 6 ? '45-52%' : '50-56%', why: 'في Custom HUD' },
    { k: 'مكان زرار الضرب اليمين', v: 'انزله تحت شوية', why: 'يديك مساحة أكبر لسحب الهيدشوت (Drag Shot)' },
    { k: 'Quick Weapon Switch', v: 'ON', why: 'التبديل السريع بين الأسلحة بيكسب معارك' },
    { k: 'Auto Pick-up', v: 'ON', why: '' },
    { k: 'Graphics', v: 'Smooth', why: 'ثبات الفريمات أهم من الشكل' },
    { k: 'Shadows', v: 'OFF', why: '' },
    { k: 'High FPS', v: 'ON لو متاح', why: '' }
  ];
  return {
    matched: matchType !== 'default', matchType,
    key: m.name || 'generic',
    device: {
      name: m.name || (query + ' (حسب فئة الجهاز)'),
      dpi: dpi, dpiNote: dpiN, sens, fps, controls, weapons,
      gyro: gyroFor(m, sens.general),
      fpsBoost: fpsBoostFor(m),
      graphics: 'Smooth + High FPS',
      refresh: hz, ramGB: m.ram,
      tips: tips.join('\n'),
      tier: tier >= 8 ? 'high' : tier >= 4 ? 'mid' : 'low'
    }
  };
}

function norm(s) { return String(s || '').toLowerCase().replace(/[_\-+]+/g, ' ').replace(/\s+/g, ' ').trim(); }

function match(query) {
  let q = norm(query).replace(/\s*(60|90|120|144)\s*hz\s*$/, ''); // strip refresh suffix from app
  if (!q) return build({ brand: 'generic', ram: 4, hz: 60 }, 'default', query);
  for (const m of MODELS) {
    for (const k of m.keys) {
      if (q.includes(norm(k))) return build(m, 'exact', query);
    }
  }
  for (const m of MODELS) {
    for (const k of m.keys) {
      if (norm(k).includes(q) && q.length >= 5) return build(m, 'exact', query);
    }
  }
  for (const [re, g] of BRAND_GUESS) {
    if (re.test(q)) return build({ ...g, name: null }, 'brand', query);
  }
  return build({ brand: 'generic', ram: 4, hz: 60 }, 'default', query);
}

function list() { return MODELS.map(m => m.name); }

export { match, list, MODELS, dpiFor, screenPpi, dpiNote, gyroFor, fpsBoostFor };
