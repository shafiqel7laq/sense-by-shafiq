// Sense by Shafiq - Netlify Function (all /api/* routes) with Netlify Blobs storage
import { getStore } from "@netlify/blobs";
import { match as matchDevice, list as listModels } from "../../devices.js";

const store = getStore("sense-db");
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || "admin1234";
const DURATIONS = { "1w": 7, "2w": 14, "1m": 30, "2m": 60, "3m": 90, "6m": 180, "1y": 365 };

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

async function get(key) { try { return await store.get(key, { type: "json" }); } catch { return null; } }
const set = (key, val) => store.setJSON(key, val);
const del = (key) => store.delete(key);
async function listPrefix(prefix) {
  const out = [];
  let cursor;
  do {
    const r = await store.list({ prefix, cursor });
    for (const b of r.blobs) out.push(b.key);
    cursor = r.cursor;
  } while (cursor);
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

export default async (req) => {
  let p = new URL(req.url).pathname;
  p = p.replace(/^\/\.netlify\/functions\/api/, "/api");
  const url = new URL(req.url);
  try {
    if (p === "/api/login" && req.method === "POST") {
      const { username, password } = await req.json();
      const u = await findByName(String(username || ""));
      if (!u || !eq(await hashPassword(String(password ?? ""), u.salt), u.hash)) return json({ error: "bad_credentials" }, 401);
      const token = newToken();
      await set("sessions/" + token, { userId: u.id, exp: Date.now() + 30 * 86400000 });
      return json({ token, user: publicUser(u) });
    }
    if (p === "/api/me" && req.method === "GET") {
      const s = await getSession(req);
      if (!s) return json({ error: "unauthorized" }, 401);
      return json({ user: publicUser(s.user) });
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
      return json({ user: pu, query: model, ...matchDevice(model) });
    }
    if (p === "/api/models" && req.method === "GET") {
      const s = await getSession(req);
      if (!s) return json({ error: "unauthorized" }, 401);
      return json({ models: listModels() });
    }
    if (p === "/api/admin/login" && req.method === "POST") {
      const { password } = await req.json();
      if (!eq(String(password ?? ""), ADMIN_PASSWORD)) return json({ error: "bad_credentials" }, 401);
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
        if (!password || String(password).length < 4) return json({ error: "password_too_short" }, 400);
        if (await findByName(uname)) return json({ error: "username_taken" }, 409);
        const days = durationDays(duration || "1m");
        if (!days) return json({ error: "bad_duration" }, 400);
        const salt = rand16();
        const u = { id: rid(), username: uname, salt, hash: await hashPassword(String(password), salt), plan: duration, createdAt: Date.now(), expiresAt: Date.now() + days * 86400000, status: "active" };
        await putUser(u);
        return json({ user: publicUser(u) }, 201);
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
          if (!password || String(password).length < 4) return json({ error: "password_too_short" }, 400);
          u.salt = rand16(); u.hash = await hashPassword(String(password), u.salt);
          await putUser(u);
          return json({ user: publicUser(u) });
        }
        return json({ error: "bad_request" }, 400);
      }
      return json({ error: "not_found" }, 404);
    }
    return json({ error: "not_found" }, 404);
  } catch (e) {
    console.error(e);
    return json({ error: "server_error" }, 500);
  }
};
