// Sense by Shafiq - Vercel edge function (all /api/* routes) with Upstash Redis REST storage
import { match as matchDevice, list as listModels } from "../devices.js";

const UPURL = process.env.UPSTASH_REDIS_REST_URL;
const UPTOK = process.env.UPSTASH_REDIS_REST_TOKEN;
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || "admin1234";
const DURATIONS = { "1w": 7, "2w": 14, "1m": 30, "2m": 60, "3m": 90, "6m": 180, "1y": 365, "life": 36500 };

function durationDays(d) {
  if (DURATIONS[d]) return DURATIONS[d];
  const n = parseInt(d, 10);
  return Number.isFinite(n) && n > 0 && n <= 3650 ? n : null;
}
const te = new TextEncoder();
const toHex = (b) => [...new Uint8Array(b.buffer ? b : b)].map(x => x.toString(16).padStart(2, "0")).join("");
const fromHex = (h) => new Uint8Array(h.match(/.{2}/g).map(x => parseInt(x, 16)));
async function hashPassword(pw, saltHex) {
  const key = await crypto.subtle.importKey("raw", te.encode(pw), "PBKDF2", false, ["deriveBits"]);
  const bits = await crypto.subtle.deriveBits({ name: "PBKDF2", salt: fromHex(saltHex), iterations: 100000, hash: "SHA-256" }, key, 256);
  return toHex(bits);
}
function eq(a, b) {
  if (a.length !== b.length) return false;
  let d = 0; for (let i = 0; i < a.length; i++) d |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return d === 0;
}
const newToken = () => toHex(crypto.getRandomValues(new Uint8Array(24)));
const rid = () => toHex(crypto.getRandomValues(new Uint8Array(8)));
const rand16 = () => toHex(crypto.getRandomValues(new Uint8Array(16)));
const normPw = (s) => String(s ?? "").trim()
  .replace(/[\u0660-\u0669]/g, (d) => String(d.charCodeAt(0) - 0x0660))
  .replace(/[\u06F0-\u06F9]/g, (d) => String(d.charCodeAt(0) - 0x06F0));
async function getSets(key) { return (await get("sets/" + key)) || []; }
const saveSets = (key, arr) => set("sets/" + key, arr);
async function notifMsg() {
  const n = await get("meta/notif");
  return {
    title: (n && n.title) || "إعدادات جديدة نزلت يا وحش 🔥",
    text: (n && n.text) || "تعالى جرّب السيت الجديد وافشخ أصحابك، خليهم يقولوا عليك مفعّل 😈"
  };
}
const DKEYS = Object.keys(DURATIONS);
async function paymentInfo() {
  const p = (await get("meta/payment")) || {};
  return { method: p.method || "فودافون كاش", number: p.number || "", prices: p.prices || {} };
}
async function myRenewals(userId) {
  const keys = await listPrefix("renewals/");
  const out = [];
  for (const k of keys) { const r = await get(k); if (r && r.userId === userId) out.push(r); }
  out.sort((a, b) => b.createdAt - a.createdAt);
  return out;
}
async function pwMatch(pw, storedHash) {
  const cands = [normPw(pw)];
  const raw = String(pw ?? "");
  if (!cands.includes(raw)) cands.push(raw);
  for (const c of cands) { if (eq(await hashPassword(c, storedHash.salt), storedHash.hash)) return true; }
  return false;
}

async function cmd(...args) {
  const r = await fetch(UPURL, { method: "POST", headers: { authorization: "Bearer " + UPTOK, "content-type": "application/json" }, body: JSON.stringify(args) });
  const j = await r.json();
  if (j.error) throw new Error("upstash: " + j.error);
  return j.result;
}
async function get(key) {
  const v = await cmd("GET", key);
  if (v == null) return null;
  try { return JSON.parse(v); } catch { return v; }
}
const set = (key, val) => cmd("SET", key, JSON.stringify(val));
const del = (key) => cmd("DEL", key);
async function listPrefix(prefix) {
  const out = [];
  let cursor = "0";
  do {
    const r = await cmd("SCAN", cursor, "MATCH", prefix + "*", "COUNT", "1000");
    cursor = String(r[0]);
    out.push(...r[1]);
  } while (cursor !== "0");
  return out;
}

function publicUser(u) {
  const now = Date.now();
  const active = u.status === "active" && u.expiresAt > now;
  return { id: u.id, username: u.username, plan: u.plan, status: u.status, createdAt: u.createdAt, expiresAt: u.expiresAt, active, daysLeft: Math.max(0, Math.ceil((u.expiresAt - now) / 86400000)) };
}
async function findByName(uname) {
  const id = await get("byname/" + uname.trim().toLowerCase());
  if (!id) return null;
  return await get("users/" + id);
}
async function putUser(u) {
  await set("users/" + u.id, u);
  await set("byname/" + u.username.trim().toLowerCase(), u.id);
}
async function getSession(req) {
  const h = req.headers.get("authorization") || "";
  const m = h.match(/^Bearer\s+(.+)$/i);
  if (!m) return null;
  const s = await get("sessions/" + m[1]);
  if (!s || s.exp < Date.now()) return null;
  const u = await get("users/" + s.userId);
  return u ? { user: u, token: m[1] } : null;
}
async function isAdmin(req) {
  const t = req.headers.get("x-admin-token") || "";
  if (!t) return false;
  const s = await get("adminsessions/" + t);
  return !!s && s.exp > Date.now();
}
const json = (obj, code = 200) => new Response(JSON.stringify(obj), { status: code, headers: { "content-type": "application/json; charset=utf-8" } });

export const config = { runtime: "edge" };

export default async (req) => {
  const url = new URL(req.url);
  let p = url.pathname;
  const qp = url.searchParams.get("p");
  if (p === "/api/handler" && qp !== null) p = "/api/" + qp;
  try {
    if (p === "/api/login" && req.method === "POST") {
      const { username, password } = await req.json();
      const u = await findByName(String(username || ""));
      if (!u || !(await pwMatch(password, u))) return json({ error: "bad_credentials" }, 401);
      const token = newToken();
      await set("sessions/" + token, { userId: u.id, exp: Date.now() + 30 * 86400000 });
      return json({ token, user: publicUser(u) });
    }
    if (p === "/api/me" && req.method === "GET") {
      const s = await getSession(req);
      if (!s) return json({ error: "unauthorized" }, 401);
      const st = (await get("streak/" + s.user.id)) || { count: 0, best: 0 };
      const cfg = (await get("meta/streak")) || {};
      return json({ user: publicUser(s.user), nick: s.user.nick || "", streak: { count: st.count || 0, best: st.best || 0, giftDays: cfg.giftDays || 1 } });
    }
    if (p === "/api/streak/ping" && req.method === "POST") {
      const s = await getSession(req);
      if (!s) return json({ error: "unauthorized" }, 401);
      const cfg = (await get("meta/streak")) || {};
      const giftDays = Number.isFinite(+cfg.giftDays) && +cfg.giftDays > 0 ? Math.min(30, +cfg.giftDays) : 1;
      const today = new Date().toISOString().slice(0, 10);
      const yest = new Date(Date.now() - 86400000).toISOString().slice(0, 10);
      let st = (await get("streak/" + s.user.id)) || { count: 0, best: 0, lastDay: "", gifts: 0 };
      let gifted = 0;
      if (st.lastDay !== today) {
        st.count = (st.lastDay === yest) ? st.count + 1 : 1;
        st.lastDay = today;
        st.best = Math.max(st.best || 0, st.count);
        if (st.count % 7 === 0 && (st.gifts || 0) < st.count / 7) {
          st.gifts = (st.gifts || 0) + 1;
          const u = await get("users/" + s.user.id);
          if (u) { u.expiresAt += giftDays * 86400000; await putUser(u); gifted = giftDays; }
        }
        await set("streak/" + s.user.id, st);
      }
      return json({ streak: { count: st.count, best: st.best, giftDays }, gifted });
    }
    if (p === "/api/nickname" && req.method === "POST") {
      const s = await getSession(req);
      if (!s) return json({ error: "unauthorized" }, 401);
      const { nick } = await req.json();
      const u = await get("users/" + s.user.id);
      if (!u) return json({ error: "not_found" }, 404);
      u.nick = String(nick || "").trim().slice(0, 24);
      await putUser(u);
      return json({ nick: u.nick });
    }
    if (p === "/api/rate" && req.method === "POST") {
      const s = await getSession(req);
      if (!s) return json({ error: "unauthorized" }, 401);
      const b = await req.json();
      const key = String(b.key || "").slice(0, 80), setId = String(b.setId || "").slice(0, 40);
      if (!key || !setId) return json({ error: "bad_request" }, 400);
      const stars = parseInt(b.stars, 10);
      const worked = b.worked === true;
      if (!Number.isFinite(stars) || stars < 1 || stars > 5) return json({ error: "bad_stars" }, 400);
      const rk = "rating/" + s.user.id + "/" + key + "/" + setId;
      const prev = await get(rk);
      const sk = "ratesum/" + key + "/" + setId;
      let sum = (await get(sk)) || { n: 0, sum: 0, worked: 0 };
      if (prev) { sum.n--; sum.sum -= prev.stars; if (prev.worked) sum.worked--; }
      sum.n++; sum.sum += stars; if (worked) sum.worked++;
      await set(rk, { stars, worked, ts: Date.now() });
      await set(sk, sum);
      return json({ ok: true, mine: { stars, worked } });
    }
    if (p === "/api/rate/mine" && req.method === "GET") {
      const s = await getSession(req);
      if (!s) return json({ error: "unauthorized" }, 401);
      const key = url.searchParams.get("key") || "";
      const keys = await listPrefix("rating/" + s.user.id + "/" + key + "/");
      const out = {};
      for (const k of keys) { const r = await get(k); if (r) out[k.split("/").pop()] = r; }
      return json({ ratings: out });
    }
    if (p === "/api/beast" && req.method === "GET") {
      const s = await getSession(req);
      if (!s) return json({ error: "unauthorized" }, 401);
      const b = await get("meta/beast");
      if (b && b.manual) return json({ beast: { display: b.display || b.username, manual: true }, me: s.user.id === b.userId });
      const keys = await listPrefix("streak/");
      let best = null;
      for (const k of keys) {
        const st = await get(k);
        if (!st || !st.count) continue;
        if (!best || st.count > best.count) best = { count: st.count, userId: k.slice(7) };
      }
      if (!best) return json({ beast: null, me: false });
      const u = await get("users/" + best.userId);
      return json({ beast: { display: (u && (u.nick || u.username)) || "وحش مجهول", streak: best.count }, me: best.userId === s.user.id });
    }
    if (p === "/api/logout" && req.method === "POST") {
      const s = await getSession(req);
      if (s) await del("sessions/" + s.token);
      return json({ ok: true });
    }
    if (p === "/api/device" && req.method === "GET") {
      const s = await getSession(req);
      if (!s) return json({ error: "unauthorized" }, 401);
      const pu = publicUser(s.user);
      if (!pu.active) return json({ error: "subscription_inactive", user: pu }, 403);
      const model = url.searchParams.get("model") || "";
      const mres = matchDevice(model);
      const key = mres.key || "generic";
      const stored = await getSets(key);
      const base = { id: "base", name: "السيت الأساسي", note: "مولّد تلقائيًا حسب موبايلك", sens: mres.device.sens, dpi: mres.device.dpi, updatedAt: 0 };
      const latest = stored.reduce((a, x) => Math.max(a, x.updatedAt || 0), 0);
      await set("devseen/" + key, Date.now()).catch(() => {});
      return json({ user: pu, query: model, ...mres, key, sets: [base, ...stored], setsUpdatedAt: latest });
    }
    if (p === "/api/models" && req.method === "GET") {
      const s = await getSession(req);
      if (!s) return json({ error: "unauthorized" }, 401);
      return json({ models: listModels() });
    }
    if (p === "/api/renewal/info" && req.method === "GET") {
      const s = await getSession(req);
      if (!s) return json({ error: "unauthorized" }, 401);
      return json({ payment: await paymentInfo(), durations: DKEYS });
    }
    if (p === "/api/renewal" && req.method === "POST") {
      const s = await getSession(req);
      if (!s) return json({ error: "unauthorized" }, 401);
      const { duration } = await req.json();
      const days = durationDays(duration);
      if (!days) return json({ error: "bad_duration" }, 400);
      const mine = await myRenewals(s.user.id);
      const pending = mine.find(r => r.status === "pending");
      if (pending) return json({ request: pending });
      const r = { id: rid(), userId: s.user.id, username: s.user.username, plan: duration, status: "pending", createdAt: Date.now(), resolvedAt: 0 };
      await set("renewals/" + r.id, r);
      return json({ request: r }, 201);
    }
    if (p === "/api/renewal/mine" && req.method === "GET") {
      const s = await getSession(req);
      if (!s) return json({ error: "unauthorized" }, 401);
      const mine = await myRenewals(s.user.id);
      return json({ request: mine[0] || null });
    }
    if (p === "/api/updates" && req.method === "GET") {
      const s = await getSession(req);
      if (!s) return json({ error: "unauthorized" }, 401);
      const pu = publicUser(s.user);
      if (!pu.active) return json({ error: "subscription_inactive" }, 403);
      let key = url.searchParams.get("key") || "";
      if (!key) { const m = url.searchParams.get("model") || ""; key = (matchDevice(m).key) || "generic"; }
      const arr = await getSets(key);
      const latest = arr.reduce((a, x) => Math.max(a, x.updatedAt || 0), 0);
      const mine = await myRenewals(s.user.id);
      const approved = mine.find(r => r.status === "approved");
      return json({ key, latest, ...(await notifMsg()),
        renewalApprovedAt: approved ? approved.resolvedAt : 0,
        renewalTitle: "تم قبول التجديد ✅",
        renewalText: "اشتراكك اتمدد بنجاح — كمل فشخ يا وحش 🔥" });
    }
    if (p === "/api/admin/login" && req.method === "POST") {
      const { password } = await req.json();
      if (!eq(normPw(password), ADMIN_PASSWORD)) return json({ error: "bad_credentials" }, 401);
      const token = newToken();
      await set("adminsessions/" + token, { exp: Date.now() + 12 * 3600000 });
      return json({ token });
    }
    if (p.startsWith("/api/admin/")) {
      if (!(await isAdmin(req))) return json({ error: "unauthorized" }, 401);
      if (p === "/api/admin/users" && req.method === "GET") {
        const keys = await listPrefix("users/");
        const users = [];
        for (const k of keys) { const u = await get(k); if (u) users.push(publicUser(u)); }
        return json({ users });
      }
      if (p === "/api/admin/export" && req.method === "GET") {
        const keys = await listPrefix("users/");
        const users = [];
        for (const k of keys) { const u = await get(k); if (u) users.push(u); }
        return json({ users });
      }
      if (p === "/api/admin/import" && req.method === "POST") {
        const { users } = await req.json();
        if (!Array.isArray(users)) return json({ error: "bad_format" }, 400);
        let n = 0;
        for (const u of users) {
          if (!u || !u.username || !u.hash || !u.salt) continue;
          if (await findByName(String(u.username))) continue;
          await putUser({ id: u.id || rid(), username: u.username, salt: u.salt, hash: u.hash, plan: u.plan || "1m", createdAt: u.createdAt || Date.now(), expiresAt: u.expiresAt || Date.now(), status: u.status === "cancelled" ? "cancelled" : "active" });
          n++;
        }
        return json({ imported: n });
      }
      if (p === "/api/admin/users" && req.method === "POST") {
        const { username, password, duration } = await req.json();
        const uname = String(username || "").trim();
        if (uname.length < 3) return json({ error: "username_too_short" }, 400);
        const npw = normPw(password);
        if (npw.length < 4) return json({ error: "password_too_short" }, 400);
        if (await findByName(uname)) return json({ error: "username_taken" }, 409);
        const days = durationDays(duration || "1m");
        if (!days) return json({ error: "bad_duration" }, 400);
        const salt = rand16();
        const u = { id: rid(), username: uname, salt, hash: await hashPassword(npw, salt), plan: duration, createdAt: Date.now(), expiresAt: Date.now() + days * 86400000, status: "active" };
        await putUser(u);
        return json({ user: publicUser(u) }, 201);
      }
      if (p === "/api/admin/renewals" && req.method === "GET") {
        const keys = await listPrefix("renewals/");
        const out = [];
        for (const k of keys) { const r = await get(k); if (r) out.push(r); }
        out.sort((a, b) => b.createdAt - a.createdAt);
        return json({ requests: out.slice(0, 100) });
      }
      if (p === "/api/admin/renewals/approve" && req.method === "POST") {
        const { id } = await req.json();
        const r = await get("renewals/" + id);
        if (!r) return json({ error: "not_found" }, 404);
        if (r.status !== "pending") return json({ error: "already_resolved" }, 400);
        const u = await get("users/" + r.userId);
        if (!u) return json({ error: "user_not_found" }, 404);
        const days = durationDays(r.plan) || 30;
        u.expiresAt = Math.max(Date.now(), u.expiresAt) + days * 86400000;
        u.plan = r.plan; u.status = "active";
        await putUser(u);
        r.status = "approved"; r.resolvedAt = Date.now();
        await set("renewals/" + r.id, r);
        return json({ request: r, user: publicUser(u) });
      }
      if (p === "/api/admin/renewals/reject" && req.method === "POST") {
        const { id } = await req.json();
        const r = await get("renewals/" + id);
        if (!r) return json({ error: "not_found" }, 404);
        r.status = "rejected"; r.resolvedAt = Date.now();
        await set("renewals/" + r.id, r);
        return json({ request: r });
      }
      if (p === "/api/admin/payment" && req.method === "GET") {
        return json({ payment: await paymentInfo() });
      }
      if (p === "/api/admin/payment" && req.method === "POST") {
        const b = await req.json();
        const v = { method: String(b.method || "").slice(0, 60), number: String(b.number || "").slice(0, 40), prices: {} };
        for (const k of DKEYS) { if (b.prices && b.prices[k] != null) v.prices[k] = String(b.prices[k]).slice(0, 20); }
        await set("meta/payment", v);
        return json({ payment: v });
      }
      if (p === "/api/admin/ratings" && req.method === "GET") {
        const keys = await listPrefix("ratesum/");
        const out = [];
        for (const k of keys) {
          const a = await get(k);
          if (!a || !a.n) continue;
          const parts = k.split("/");
          out.push({ key: parts[1], setId: parts[2], avg: Math.round((a.sum / a.n) * 10) / 10, n: a.n, worked: a.worked });
        }
        return json({ ratings: out });
      }
      if (p === "/api/admin/streakcfg" && req.method === "GET") {
        return json({ giftDays: ((await get("meta/streak")) || {}).giftDays || 1 });
      }
      if (p === "/api/admin/streakcfg" && req.method === "POST") {
        const b = await req.json();
        const g = parseInt(b.giftDays, 10);
        if (!Number.isFinite(g) || g < 1 || g > 30) return json({ error: "bad_value" }, 400);
        await set("meta/streak", { giftDays: g });
        return json({ giftDays: g });
      }
      if (p === "/api/admin/beast" && req.method === "GET") {
        return json({ beast: (await get("meta/beast")) || null });
      }
      if (p === "/api/admin/beast" && req.method === "POST") {
        const b = await req.json();
        if (!b.userId) return json({ error: "bad_request" }, 400);
        const u = await get("users/" + b.userId);
        if (!u) return json({ error: "not_found" }, 404);
        const v = { manual: true, userId: u.id, username: u.username, display: u.nick || u.username, setAt: Date.now() };
        await set("meta/beast", v);
        return json({ beast: v });
      }
      if (p === "/api/admin/beast/clear" && req.method === "POST") {
        await del("meta/beast");
        return json({ ok: true });
      }
      if (p === "/api/admin/modelslist" && req.method === "GET") {
        return json({ models: listModels() });
      }
      if (p === "/api/admin/sets" && req.method === "GET") {
        const key = url.searchParams.get("model") || "";
        return json({ sets: await getSets(key) });
      }
      if (p === "/api/admin/sets/save" && req.method === "POST") {
        const b = await req.json();
        const key = String(b.model || "");
        if (!key) return json({ error: "bad_model" }, 400);
        const num = (v) => { const n = parseInt(v, 10); return Number.isFinite(n) ? Math.max(1, Math.min(200, n)) : null; };
        const sens = { general: num(b.general), redDot: num(b.redDot), scope2x: num(b.scope2x), scope4x: num(b.scope4x), sniper: num(b.sniper), freeLook: num(b.freeLook) };
        if (Object.values(sens).some(v => v == null)) return json({ error: "bad_values" }, 400);
        let dpi = parseInt(b.dpi, 10);
        dpi = Number.isFinite(dpi) ? Math.max(300, Math.min(800, dpi)) : null;
        const arr = await getSets(key);
        if (b.id) {
          const i = arr.findIndex(x => x.id === b.id);
          if (i < 0) return json({ error: "not_found" }, 404);
          arr[i] = { ...arr[i], name: String(b.name || arr[i].name).slice(0, 60), note: String(b.note || "").slice(0, 200), sens, dpi, updatedAt: Date.now() };
          await saveSets(key, arr);
          return json({ set: arr[i] });
        }
        const item = { id: rid(), name: String(b.name || ("سيت " + (arr.length + 2))).slice(0, 60), note: String(b.note || "").slice(0, 200), sens, dpi, updatedAt: Date.now() };
        arr.push(item);
        await saveSets(key, arr);
        return json({ set: item }, 201);
      }
      if (p === "/api/admin/sets/delete" && req.method === "POST") {
        const b = await req.json();
        const arr = await getSets(String(b.model || ""));
        const i = arr.findIndex(x => x.id === b.id);
        if (i < 0) return json({ error: "not_found" }, 404);
        arr.splice(i, 1);
        await saveSets(String(b.model || ""), arr);
        return json({ ok: true });
      }
      if (p === "/api/admin/notiftext" && req.method === "GET") {
        return json(await notifMsg());
      }
      if (p === "/api/admin/notiftext" && req.method === "POST") {
        const b = await req.json();
        const v = { title: String(b.title || "").slice(0, 80), text: String(b.text || "").slice(0, 240) };
        await set("meta/notif", v);
        return json(v);
      }
      const m2 = p.match(/^\/api\/admin\/users\/([a-f0-9]+)(\/(cancel|reactivate|extend|password))?$/);
      if (m2) {
        const u = await get("users/" + m2[1]);
        if (!u) return json({ error: "not_found" }, 404);
        const action = m2[3];
        if (req.method === "DELETE" && !action) {
          await del("users/" + u.id);
          await del("byname/" + u.username.trim().toLowerCase());
          return json({ ok: true });
        }
        if (req.method === "POST" && action === "cancel") { u.status = "cancelled"; await putUser(u); return json({ user: publicUser(u) }); }
        if (req.method === "POST" && action === "reactivate") { u.status = "active"; await putUser(u); return json({ user: publicUser(u) }); }
        if (req.method === "POST" && action === "extend") {
          const { duration } = await req.json();
          const days = durationDays(duration);
          if (!days) return json({ error: "bad_duration" }, 400);
          u.expiresAt = Math.max(Date.now(), u.expiresAt) + days * 86400000;
          u.plan = duration; u.status = "active";
          await putUser(u);
          return json({ user: publicUser(u) });
        }
        if (req.method === "POST" && action === "password") {
          const { password } = await req.json();
          const npw2 = normPw(password);
          if (npw2.length < 4) return json({ error: "password_too_short" }, 400);
          u.salt = rand16(); u.hash = await hashPassword(npw2, u.salt);
          await putUser(u);
          return json({ user: publicUser(u) });
        }
        return json({ error: "bad_request" }, 400);
      }
      return json({ error: "not_found" }, 404);
    }
    return json({ error: "not_found" }, 404);
  } catch (e) {
    return json({ error: "server_error", detail: String(e && e.message || e) }, 500);
  }
};
