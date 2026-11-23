// Sense by Shafiq - Deno Deploy backend (Deno KV storage, zero deps)
// deno run --allow-net --allow-env --allow-read --unstable-kv server.ts
import { match as matchDevice, list as listModels } from "./devices.js";

const kv = await Deno.openKv();
const ADMIN_PASSWORD = Deno.env.get("ADMIN_PASSWORD") || "admin1234";
const DURATIONS: Record<string, number> = { "1w": 7, "2w": 14, "1m": 30, "2m": 60, "3m": 90, "6m": 180, "1y": 365 };

function durationDays(d: string): number | null {
  if (DURATIONS[d]) return DURATIONS[d];
  const n = parseInt(d, 10);
  return Number.isFinite(n) && n > 0 && n <= 3650 ? n : null;
}
const te = new TextEncoder();
function toHex(b: ArrayBuffer | Uint8Array) { return [...new Uint8Array(b as ArrayBuffer)].map(x => x.toString(16).padStart(2, "0")).join(""); }
function fromHex(h: string) { return new Uint8Array(h.match(/.{2}/g)!.map(x => parseInt(x, 16))); }
async function hashPassword(pw: string, saltHex: string): Promise<string> {
  const key = await crypto.subtle.importKey("raw", te.encode(pw), "PBKDF2", false, ["deriveBits"]);
  const bits = await crypto.subtle.deriveBits({ name: "PBKDF2", salt: fromHex(saltHex), iterations: 100000, hash: "SHA-256" }, key, 256);
  return toHex(bits);
}
function eq(a: string, b: string) {
  if (a.length !== b.length) return false;
  let d = 0; for (let i = 0; i < a.length; i++) d |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return d === 0;
}
function newToken() { return toHex(crypto.getRandomValues(new Uint8Array(24))); }
function rid() { return toHex(crypto.getRandomValues(new Uint8Array(8))); }
function rand16() { return toHex(crypto.getRandomValues(new Uint8Array(16))); }

interface User { id: string; username: string; salt: string; hash: string; plan: string; createdAt: number; expiresAt: number; status: string; }
function publicUser(u: User) {
  const now = Date.now();
  const active = u.status === "active" && u.expiresAt > now;
  return { id: u.id, username: u.username, plan: u.plan, status: u.status, createdAt: u.createdAt, expiresAt: u.expiresAt, active, daysLeft: Math.max(0, Math.ceil((u.expiresAt - now) / 86400000)) };
}
async function findByName(uname: string): Promise<User | null> {
  const id = (await kv.get(["byname", uname.trim().toLowerCase()])).value as string | null;
  if (!id) return null;
  return (await kv.get(["users", id])).value as User | null;
}
async function putUser(u: User) {
  await kv.atomic().set(["users", u.id], u).set(["byname", u.username.trim().toLowerCase()], u.id).commit();
}
async function getSession(req: Request): Promise<{ user: User; token: string } | null> {
  const h = req.headers.get("authorization") || "";
  const m = h.match(/^Bearer\s+(.+)$/i);
  if (!m) return null;
  const s = (await kv.get(["sessions", m[1]])).value as { userId: string; exp: number } | null;
  if (!s || s.exp < Date.now()) return null;
  const u = (await kv.get(["users", s.userId])).value as User | null;
  return u ? { user: u, token: m[1] } : null;
}
async function isAdmin(req: Request): Promise<boolean> {
  const t = req.headers.get("x-admin-token") || "";
  if (!t) return false;
  const s = (await kv.get(["adminsessions", t])).value as { exp: number } | null;
  return !!s && s.exp > Date.now();
}
function json(obj: unknown, code = 200) {
  return new Response(JSON.stringify(obj), { status: code, headers: { "content-type": "application/json; charset=utf-8" } });
}
const MIME: Record<string, string> = { ".html": "text/html; charset=utf-8", ".js": "text/javascript", ".css": "text/css", ".png": "image/png", ".svg": "image/svg+xml", ".json": "application/json" };

Deno.serve(async (req) => {
  const url = new URL(req.url);
  const p = url.pathname;
  try {
    // customer auth
    if (p === "/api/login" && req.method === "POST") {
      const { username, password } = await req.json();
      const u = await findByName(String(username || ""));
      if (!u || !(eq(await hashPassword(String(password ?? ""), u.salt), u.hash))) return json({ error: "bad_credentials" }, 401);
      const token = newToken();
      await kv.set(["sessions", token], { userId: u.id, exp: Date.now() + 30 * 86400000 });
      return json({ token, user: publicUser(u) });
    }
    if (p === "/api/me" && req.method === "GET") {
      const s = await getSession(req);
      if (!s) return json({ error: "unauthorized" }, 401);
      return json({ user: publicUser(s.user) });
    }
    if (p === "/api/logout" && req.method === "POST") {
      const s = await getSession(req);
      if (s) await kv.delete(["sessions", s.token]);
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
    // admin
    if (p === "/api/admin/login" && req.method === "POST") {
      const { password } = await req.json();
      if (!eq(String(password ?? ""), ADMIN_PASSWORD)) return json({ error: "bad_credentials" }, 401);
      const token = newToken();
      await kv.set(["adminsessions", token], { exp: Date.now() + 12 * 3600000 });
      return json({ token });
    }
    if (p.startsWith("/api/admin/")) {
      if (!(await isAdmin(req))) return json({ error: "unauthorized" }, 401);
      if (p === "/api/admin/users" && req.method === "GET") {
        const users: unknown[] = [];
        for await (const e of kv.list({ prefix: ["users"] })) users.push(publicUser(e.value as User));
        return json({ users });
      }
      if (p === "/api/admin/export" && req.method === "GET") {
        const users: unknown[] = [];
        for await (const e of kv.list({ prefix: ["users"] })) users.push(e.value);
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
        const u: User = { id: rid(), username: uname, salt, hash: await hashPassword(String(password), salt), plan: duration, createdAt: Date.now(), expiresAt: Date.now() + days * 86400000, status: "active" };
        await putUser(u);
        return json({ user: publicUser(u) }, 201);
      }
      const m2 = p.match(/^\/api\/admin\/users\/([a-f0-9]+)(\/(cancel|reactivate|extend|password))?$/);
      if (m2) {
        const u = (await kv.get(["users", m2[1]])).value as User | null;
        if (!u) return json({ error: "not_found" }, 404);
        const action = m2[3];
        if (req.method === "DELETE" && !action) {
          await kv.atomic().delete(["users", u.id]).delete(["byname", u.username.trim().toLowerCase()]).commit();
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
    // static
    if (req.method === "GET") {
      const f = p === "/" ? "/index.html" : p;
      if (f.includes("..")) return json({ error: "forbidden" }, 403);
      try {
        const data = await Deno.readFile(new URL("./public" + f, import.meta.url));
        const ext = f.slice(f.lastIndexOf("."));
        return new Response(data, { headers: { "content-type": MIME[ext] || "application/octet-stream" } });
      } catch { return json({ error: "not_found" }, 404); }
    }
    return json({ error: "not_found" }, 404);
  } catch (e) {
    console.error(e);
    return json({ error: "server_error" }, 500);
  }
});
