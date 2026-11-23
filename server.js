// FF Settings - backend server (zero dependencies, Node 18+)
const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const devices = require('./devices');

const PORT = process.env.PORT || 3000;
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || 'admin1234';
const DB_FILE = process.env.DB_FILE || path.join(__dirname, 'db.json');
const PUBLIC = path.join(__dirname, 'public');

// ---------- storage ----------
let db = { users: [], sessions: {} };
try { db = JSON.parse(fs.readFileSync(DB_FILE, 'utf8')); } catch (e) { /* fresh */ }
function save() {
  const tmp = DB_FILE + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(db, null, 2));
  fs.renameSync(tmp, DB_FILE);
}
const DURATIONS = { '1w': 7, '2w': 14, '1m': 30, '2m': 60, '3m': 90, '6m': 180, '1y': 365 };
function durationDays(d) {
  if (DURATIONS[d]) return DURATIONS[d];
  const n = parseInt(d, 10);
  return (Number.isFinite(n) && n > 0 && n <= 3650) ? n : null;
}
function hashPassword(pw, salt) { return crypto.scryptSync(String(pw), salt, 32).toString('hex'); }
function newToken() { return crypto.randomBytes(24).toString('hex'); }
function publicUser(u) {
  const now = Date.now();
  const active = u.status === 'active' && u.expiresAt > now;
  return {
    id: u.id, username: u.username, plan: u.plan, status: u.status,
    createdAt: u.createdAt, expiresAt: u.expiresAt, active,
    daysLeft: Math.max(0, Math.ceil((u.expiresAt - now) / 86400000))
  };
}
function getSession(req) {
  const h = req.headers.authorization || '';
  const m = h.match(/^Bearer\s+(.+)$/i);
  if (!m) return null;
  const s = db.sessions[m[1]];
  if (!s || s.exp < Date.now()) return null;
  const u = db.users.find(x => x.id === s.userId);
  return u ? { user: u, token: m[1] } : null;
}
function isAdmin(req) {
  const t = req.headers['x-admin-token'] || '';
  const want = crypto.createHash('sha256').update(ADMIN_PASSWORD).digest('hex');
  return t.length === want.length && crypto.timingSafeEqual(Buffer.from(t), Buffer.from(want));
}
function readBody(req) {
  return new Promise((res, rej) => {
    let b = '';
    req.on('data', c => { b += c; if (b.length > 1e6) rej(new Error('too big')); });
    req.on('end', () => { try { res(b ? JSON.parse(b) : {}); } catch (e) { rej(e); } });
    req.on('error', rej);
  });
}
function json(res, code, obj) {
  const s = JSON.stringify(obj);
  res.writeHead(code, { 'Content-Type': 'application/json; charset=utf-8' });
  res.end(s);
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://x');
  const p = url.pathname;
  try {
    // ---------- customer auth ----------
    if (p === '/api/login' && req.method === 'POST') {
      const { username, password } = await readBody(req);
      const u = db.users.find(x => x.username.toLowerCase() === String(username || '').trim().toLowerCase());
      if (!u || hashPassword(password, u.salt) !== u.hash) return json(res, 401, { error: 'bad_credentials' });
      const token = newToken();
      db.sessions[token] = { userId: u.id, exp: Date.now() + 30 * 86400000 };
      save();
      return json(res, 200, { token, user: publicUser(u) });
    }
    if (p === '/api/me' && req.method === 'GET') {
      const s = getSession(req);
      if (!s) return json(res, 401, { error: 'unauthorized' });
      return json(res, 200, { user: publicUser(s.user) });
    }
    if (p === '/api/logout' && req.method === 'POST') {
      const s = getSession(req);
      if (s) { delete db.sessions[s.token]; save(); }
      return json(res, 200, { ok: true });
    }
    // ---------- settings ----------
    if (p === '/api/device' && req.method === 'GET') {
      const s = getSession(req);
      if (!s) return json(res, 401, { error: 'unauthorized' });
      const pu = publicUser(s.user);
      if (!pu.active) return json(res, 403, { error: 'subscription_inactive', user: pu });
      const model = url.searchParams.get('model') || '';
      const result = devices.match(model);
      return json(res, 200, { user: pu, query: model, ...result });
    }
    if (p === '/api/models' && req.method === 'GET') {
      const s = getSession(req);
      if (!s) return json(res, 401, { error: 'unauthorized' });
      return json(res, 200, { models: devices.list() });
    }
    // ---------- admin ----------
    if (p === '/api/admin/login' && req.method === 'POST') {
      const { password } = await readBody(req);
      if (password !== ADMIN_PASSWORD) return json(res, 401, { error: 'bad_credentials' });
      return json(res, 200, { token: crypto.createHash('sha256').update(ADMIN_PASSWORD).digest('hex') });
    }
    if (p.startsWith('/api/admin/')) {
      if (!isAdmin(req)) return json(res, 401, { error: 'unauthorized' });
      if (p === '/api/admin/export' && req.method === 'GET') {
        return json(res, 200, { users: db.users });
      }
      if (p === '/api/admin/import' && req.method === 'POST') {
        const { users } = await readBody(req);
        if (!Array.isArray(users)) return json(res, 400, { error: 'bad_format' });
        let n = 0;
        for (const u of users) {
          if (!u || !u.username || !u.hash || !u.salt) continue;
          if (db.users.some(x => x.username.toLowerCase() === String(u.username).toLowerCase())) continue;
          db.users.push({
            id: u.id || crypto.randomBytes(8).toString('hex'), username: u.username,
            salt: u.salt, hash: u.hash, plan: u.plan || '1m',
            createdAt: u.createdAt || Date.now(), expiresAt: u.expiresAt || Date.now(),
            status: u.status === 'cancelled' ? 'cancelled' : 'active'
          });
          n++;
        }
        save();
        return json(res, 200, { imported: n, total: db.users.length });
      }
      if (p === '/api/admin/users' && req.method === 'GET') {
        return json(res, 200, { users: db.users.map(publicUser) });
      }
      if (p === '/api/admin/users' && req.method === 'POST') {
        const { username, password, duration } = await readBody(req);
        const uname = String(username || '').trim();
        if (!uname || uname.length < 3) return json(res, 400, { error: 'username_too_short' });
        if (!password || String(password).length < 4) return json(res, 400, { error: 'password_too_short' });
        if (db.users.some(x => x.username.toLowerCase() === uname.toLowerCase())) return json(res, 409, { error: 'username_taken' });
        const days = durationDays(duration || '1m');
        if (!days) return json(res, 400, { error: 'bad_duration' });
        const salt = crypto.randomBytes(16).toString('hex');
        const u = {
          id: crypto.randomBytes(8).toString('hex'), username: uname, salt,
          hash: hashPassword(password, salt), plan: duration,
          createdAt: Date.now(), expiresAt: Date.now() + days * 86400000, status: 'active'
        };
        db.users.push(u); save();
        return json(res, 201, { user: publicUser(u) });
      }
      const m2 = p.match(/^\/api\/admin\/users\/([a-f0-9]+)(\/(cancel|reactivate|extend|password))?$/);
      if (m2) {
        const u = db.users.find(x => x.id === m2[1]);
        if (!u) return json(res, 404, { error: 'not_found' });
        const action = m2[3];
        if (req.method === 'DELETE' && !action) {
          db.users = db.users.filter(x => x.id !== u.id);
          for (const t of Object.keys(db.sessions)) if (db.sessions[t].userId === u.id) delete db.sessions[t];
          save();
          return json(res, 200, { ok: true });
        }
        if (req.method === 'POST' && action === 'cancel') { u.status = 'cancelled'; save(); return json(res, 200, { user: publicUser(u) }); }
        if (req.method === 'POST' && action === 'reactivate') { u.status = 'active'; save(); return json(res, 200, { user: publicUser(u) }); }
        if (req.method === 'POST' && action === 'extend') {
          const { duration } = await readBody(req);
          const days = durationDays(duration);
          if (!days) return json(res, 400, { error: 'bad_duration' });
          const base = Math.max(Date.now(), u.expiresAt);
          u.expiresAt = base + days * 86400000;
          u.plan = duration;
          if (u.status !== 'active') u.status = 'active';
          save();
          return json(res, 200, { user: publicUser(u) });
        }
        if (req.method === 'POST' && action === 'password') {
          const { password } = await readBody(req);
          if (!password || String(password).length < 4) return json(res, 400, { error: 'password_too_short' });
          u.salt = crypto.randomBytes(16).toString('hex');
          u.hash = hashPassword(password, u.salt);
          for (const t of Object.keys(db.sessions)) if (db.sessions[t].userId === u.id) delete db.sessions[t];
          save();
          return json(res, 200, { user: publicUser(u) });
        }
        return json(res, 400, { error: 'bad_request' });
      }
      return json(res, 404, { error: 'not_found' });
    }
    // ---------- static ----------
    if (req.method === 'GET') {
      let f = p === '/' ? '/index.html' : p;
      const file = path.normalize(path.join(PUBLIC, f));
      if (!file.startsWith(PUBLIC)) { res.writeHead(403); return res.end(); }
      if (fs.existsSync(file) && fs.statSync(file).isFile()) {
        const ext = path.extname(file).toLowerCase();
        const types = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.png': 'image/png', '.svg': 'image/svg+xml' };
        res.writeHead(200, { 'Content-Type': types[ext] || 'application/octet-stream' });
        return fs.createReadStream(file).pipe(res);
      }
    }
    json(res, 404, { error: 'not_found' });
  } catch (e) {
    json(res, 500, { error: 'server_error' });
  }
});
server.listen(PORT, () => console.log('FF Settings server on port ' + PORT));
