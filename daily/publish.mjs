// Sense by Shafiq - daily settings publisher (runs on wake, no customer data touched)
import { match, MODELS, screenPpi, gyroFor } from '/downloads/ff-app/repo/devices.js';
import { dailyFor } from '/downloads/ff-app/repo/content.js';
import fs from 'fs';

const TOK = fs.readFileSync('/downloads/ff-app/daily/upstash_token', 'utf8').trim();
const UP = 'https://grown-bear-211824.upstash.io';
async function cmd(...args) {
  const r = await fetch(UP, { method: 'POST', headers: { authorization: 'Bearer ' + TOK, 'content-type': 'application/json' }, body: JSON.stringify(args) });
  const j = await r.json();
  if (j.error) throw new Error(j.error);
  return j.result;
}
const getJ = async (k) => { const v = await cmd('GET', k); return v == null ? null : JSON.parse(v); };
const setJ = (k, v) => cmd('SET', k, JSON.stringify(v));
async function scan(pat) { let c = '0', out = []; do { const r = await cmd('SCAN', c, 'MATCH', pat, 'COUNT', '500'); c = String(r[0]); out.push(...r[1]); } while (c !== '0'); return out; }
const clamp = (v) => Math.max(1, Math.min(200, Math.round(v)));
const round5 = (v) => Math.round(v / 5) * 5;
const clampDpi = (v) => v == null ? null : Math.max(300, Math.min(800, round5(v)));
const rid = () => [...crypto.getRandomValues(new Uint8Array(8))].map(x => x.toString(16).padStart(2, '0')).join('');

const STYLES = [
  { id: 'headshot', note: 'سيت النهارده: ستايل هيدشوت سريع 🔥 اسحب لفوق بعد أول طلقة', d: { general: 6, redDot: 5, scope2x: 4, scope4x: 2, sniper: 0, freeLook: 3 } },
  { id: 'balanced', note: 'سيت النهارده: متوازن لكل المسافات ⚖️', d: { general: 0, redDot: 0, scope2x: 0, scope4x: 0, sniper: 0, freeLook: 0 } },
  { id: 'smooth',   note: 'سيت النهارده: ناعم وثابت للسبراي 🧊', d: { general: -5, redDot: -4, scope2x: -4, scope4x: -3, sniper: -2, freeLook: -2 } }
];
const dayOfYear = Math.floor((Date.now() - new Date(new Date().getFullYear(), 0, 0)) / 86400000);
const style = STYLES[dayOfYear % 3];
const dateTag = new Date().toISOString().slice(5, 10);
const now = Date.now();

// target models: recently-seen device keys + generic (unknown models must still get daily sets); fallback = full catalog
let targets = [];
for (const k of await scan('devseen/*')) {
  const ts = await getJ(k);
  if (ts && now - ts < 45 * 86400000) targets.push(k.slice(8));
}
if (!targets.includes('generic')) targets.push('generic');
if (targets.length === 1) targets = MODELS.map(m => m.name); // first ever run: seed the whole catalog

const report = [];
for (const name of targets) {
  const m = MODELS.find(x => x.name === name);
  const base = m ? match(m.keys[0]).device : match('').device;
  let baseSens = base.sens, baseDpi = base.dpi, src = 'auto';
  // rating-informed base: best-rated existing set (avg >= 4) wins
  let best = null;
  for (const sk of await scan('ratesum/' + name + '/*')) {
    const a = await getJ(sk);
    if (!a || !a.n) continue;
    const avg = a.sum / a.n;
    const score = avg * 10 + (a.worked || 0);
    if (!best || score > best.score) best = { avg, setId: sk.split('/').pop(), score };
  }
  if (best && best.avg >= 4) {
    const arr = (await getJ('sets/' + name)) || [];
    const st = best.setId === 'base' ? { sens: base.sens, dpi: base.dpi } : arr.find(x => x.id === best.setId);
    if (st) { baseSens = st.sens; baseDpi = st.dpi; src = 'rated ' + best.avg + '★'; }
  }
  const j = src === 'auto' ? 1 : 0.4; // smaller variation around proven sets
  const d = style.d;
  const sens = {
    general: clamp(baseSens.general + d.general * j),
    redDot: clamp(baseSens.redDot + d.redDot * j),
    scope2x: clamp(baseSens.scope2x + d.scope2x * j),
    scope4x: clamp(baseSens.scope4x + d.scope4x * j),
    sniper: clamp(baseSens.sniper + d.sniper * j),
    freeLook: clamp(baseSens.freeLook + d.freeLook * j)
  };
  // coherent DPI: sens.general x dpi stays constant -> high sens lowers DPI, calm sens raises it
  const dpi = clampDpi(baseDpi == null ? null : baseDpi * (baseSens.general / Math.max(120, sens.general)));
  let note = style.note;
  if (dpi != null) {
    const ppi = m ? screenPpi(m) : null;
    note += ' — DPI ' + dpi + (ppi ? ' محسوب من شاشة موبايلك (' + m.scr[0] + ' بوصة، ~' + ppi + ' بكسل/بوصة)' : ' متظبط لموبايلك') + ' ومتوازن مع حساسية السيت.';
  }
  const gyro = gyroFor(m || { ram: 4 }, sens.general);
  const arr = (await getJ('sets/' + name)) || [];
  const item = { id: rid(), name: 'سيت ' + dateTag, note, sens, dpi, gyro, updatedAt: now };
  const sameDay = arr.findIndex(x => x.name === item.name);
  if (sameDay >= 0) arr[sameDay] = item; else arr.push(item); // re-run same day replaces, never duplicates
  while (arr.length > 6) arr.shift();
  await setJ('sets/' + name, arr);
  report.push(name + ' [' + src + '] dpi=' + dpi);
}
// محتوى اليوم: تمرين + نصيحة (بنفس تاريخ السيت)
const dc = dailyFor(dayOfYear);
await setJ('meta/daily', { date: dateTag, training: dc.training, tip: dc.tip });
console.log(JSON.stringify({ style: style.id, dateTag, training: dc.training.t, count: report.length, models: report }));
