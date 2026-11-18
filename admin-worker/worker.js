/**
 * portfolio-admin — Cloudflare Worker untuk mengelola sertifikat di website.
 *
 * Bindings (Worker → Settings):
 *   KV namespace   CERTS_KV        → namespace KV, misal "portfolio"
 *   Text           ADMIN_EMAIL     → email login kamu
 *   Secret         ADMIN_PASSWORD  → password login (min. 12 karakter)
 *   Secret         TOKEN_SECRET    → string acak panjang, untuk menandatangani token login
 *   Text           ALLOW_ORIGIN    → https://indradarmawan2202.github.io,https://darmawan.is-a.dev
 *
 * Public:
 *   GET  /certs            daftar sertifikat (JSON)
 *   GET  /img/:id          gambar sertifikat
 * Admin (Authorization: Bearer <token>):
 *   POST   /login          { email, password } → { token, exp }
 *   GET    /me             cek token
 *   POST   /certs          tambah            (JSON: title, issuer, date, kind, url)
 *   PUT    /certs/:id      ubah
 *   DELETE /certs/:id      hapus
 *   PUT    /certs/:id/image   upload gambar (body = file mentah, Content-Type image/*)
 *   DELETE /certs/:id/image   hapus gambar
 *   POST   /certs/order    { ids: [...] } urutkan ulang
 */
const enc = new TextEncoder();
const TOKEN_TTL = 12 * 60 * 60;          // 12 jam
const MAX_ATTEMPTS = 5, LOCK_SECONDS = 15 * 60;
const MAX_IMAGE_BYTES = 2.5 * 1024 * 1024;
const IMAGE_TYPES = ['image/jpeg', 'image/png', 'image/webp'];

export default {
  async fetch(req, env) {
    const origin = req.headers.get('Origin') || '';
    const allowed = (env.ALLOW_ORIGIN || '').split(',').map(s => s.trim().replace(/\/$/, '')).filter(Boolean);
    const cors = {
      'Access-Control-Allow-Origin': allowed.includes(origin) ? origin : (allowed[0] || '*'),
      'Access-Control-Allow-Methods': 'GET,POST,PUT,DELETE,OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type,Authorization',
      'Access-Control-Max-Age': '86400',
      'Vary': 'Origin',
    };
    if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors });
    if (!env.CERTS_KV) return json({ error: 'kv_not_bound' }, 500, cors);
    try {
      return await route(req, env, new URL(req.url), cors);
    } catch (e) {
      if (e instanceof HttpError) return json({ error: e.code }, e.status, cors);
      return json({ error: 'server_error' }, 500, cors);
    }
  },
};

class HttpError extends Error { constructor(status, code) { super(code); this.status = status; this.code = code; } }

async function route(req, env, url, cors) {
  const path = url.pathname.replace(/\/+$/, '') || '/';
  const m = req.method;
  let r;

  if (m === 'GET' && path === '/certs') {
    const list = await getList(env);
    return json(list.map(c => publicView(c, url.origin)), 200, { ...cors, 'Cache-Control': 'public, max-age=30' });
  }
  if (m === 'GET' && (r = path.match(/^\/img\/([a-f0-9-]{36})$/))) {
    const { value, metadata } = await env.CERTS_KV.getWithMetadata('img:' + r[1], 'arrayBuffer');
    if (!value) return json({ error: 'not_found' }, 404, cors);
    return new Response(value, { headers: { ...cors, 'Content-Type': metadata?.type || 'image/jpeg', 'Cache-Control': 'public, max-age=31536000, immutable' } });
  }
  if (m === 'POST' && path === '/login') return login(req, env, cors);

  // ---- everything below needs a valid token ----
  const who = await verifyToken(req, env);
  if (!who) return json({ error: 'unauthorized' }, 401, cors);

  if (m === 'GET' && path === '/me') return json({ email: who.sub, exp: who.exp }, 200, cors);

  if (m === 'POST' && path === '/certs/order') {
    const { ids } = await body(req);
    if (!Array.isArray(ids)) throw new HttpError(400, 'bad_ids');
    const list = await getList(env), byId = new Map(list.map(c => [c.id, c]));
    const next = ids.map(id => byId.get(id)).filter(Boolean);
    list.forEach(c => { if (!ids.includes(c.id)) next.push(c); });
    await saveList(env, next);
    return json(next.map(c => publicView(c, url.origin)), 200, cors);
  }
  if (m === 'POST' && path === '/certs') {
    const b = await body(req);
    const list = await getList(env);
    if (list.length >= 200) throw new HttpError(400, 'too_many');
    const c = { id: crypto.randomUUID(), ...clean(b), img: false, v: Date.now() };
    list.unshift(c); await saveList(env, list);
    return json(publicView(c, url.origin), 201, cors);
  }
  if ((r = path.match(/^\/certs\/([a-f0-9-]{36})\/image$/))) {
    const list = await getList(env), c = list.find(x => x.id === r[1]);
    if (!c) return json({ error: 'not_found' }, 404, cors);
    if (m === 'PUT') {
      const type = (req.headers.get('Content-Type') || '').split(';')[0].trim();
      if (!IMAGE_TYPES.includes(type)) throw new HttpError(400, 'bad_image');
      const len = +(req.headers.get('Content-Length') || 0);
      if (len > MAX_IMAGE_BYTES) throw new HttpError(413, 'image_too_large');
      const buf = await req.arrayBuffer();
      if (!buf.byteLength || buf.byteLength > MAX_IMAGE_BYTES) throw new HttpError(buf.byteLength ? 413 : 400, buf.byteLength ? 'image_too_large' : 'bad_image');
      await env.CERTS_KV.put('img:' + c.id, buf, { metadata: { type } });
      c.img = true; c.v = Date.now(); await saveList(env, list);
      return json(publicView(c, url.origin), 200, cors);
    }
    if (m === 'DELETE') {
      await env.CERTS_KV.delete('img:' + c.id); c.img = false; c.v = Date.now(); await saveList(env, list);
      return json(publicView(c, url.origin), 200, cors);
    }
  }
  if ((r = path.match(/^\/certs\/([a-f0-9-]{36})$/))) {
    const list = await getList(env), i = list.findIndex(c => c.id === r[1]);
    if (i < 0) return json({ error: 'not_found' }, 404, cors);
    if (m === 'PUT') {
      const b = await body(req), c = { ...list[i], ...clean(b), v: Date.now() };
      list[i] = c; await saveList(env, list);
      return json(publicView(c, url.origin), 200, cors);
    }
    if (m === 'DELETE') {
      await env.CERTS_KV.delete('img:' + list[i].id);
      list.splice(i, 1); await saveList(env, list);
      return json({ ok: true }, 200, cors);
    }
  }
  return json({ error: 'not_found' }, 404, cors);
}

/* ---------------- auth ---------------- */
async function login(req, env, cors) {
  if (!env.ADMIN_EMAIL || !env.ADMIN_PASSWORD || !env.TOKEN_SECRET) throw new HttpError(500, 'not_configured');
  const ip = req.headers.get('CF-Connecting-IP') || 'unknown';
  const rlKey = 'rl:' + ip;
  const tries = parseInt(await env.CERTS_KV.get(rlKey) || '0', 10);
  if (tries >= MAX_ATTEMPTS) return json({ error: 'too_many_attempts', retryAfter: LOCK_SECONDS }, 429, cors);

  const { email = '', password = '' } = await body(req);
  const okEmail = await safeEqual(env, String(email).trim().toLowerCase(), String(env.ADMIN_EMAIL).trim().toLowerCase());
  const okPass = await safeEqual(env, String(password), String(env.ADMIN_PASSWORD));
  if (!(okEmail && okPass)) {
    await env.CERTS_KV.put(rlKey, String(tries + 1), { expirationTtl: LOCK_SECONDS });
    await new Promise(r => setTimeout(r, 400));
    return json({ error: 'invalid_credentials', attemptsLeft: Math.max(0, MAX_ATTEMPTS - tries - 1) }, 401, cors);
  }
  await env.CERTS_KV.delete(rlKey);
  const exp = Math.floor(Date.now() / 1000) + TOKEN_TTL;
  const payload = b64url(enc.encode(JSON.stringify({ sub: env.ADMIN_EMAIL, exp })));
  const sig = b64url(await hmac(env.TOKEN_SECRET, payload));
  return json({ token: payload + '.' + sig, exp }, 200, cors);
}
async function verifyToken(req, env) {
  const h = req.headers.get('Authorization') || '';
  const t = h.startsWith('Bearer ') ? h.slice(7) : '';
  const [payload, sig] = t.split('.');
  if (!payload || !sig || !env.TOKEN_SECRET) return null;
  const expect = b64url(await hmac(env.TOKEN_SECRET, payload));
  if (!(await safeEqual(env, sig, expect))) return null;
  try {
    const data = JSON.parse(new TextDecoder().decode(unb64url(payload)));
    return data.exp > Date.now() / 1000 ? data : null;
  } catch (e) { return null; }
}
async function hmac(secret, msg) {
  const key = await crypto.subtle.importKey('raw', enc.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  return new Uint8Array(await crypto.subtle.sign('HMAC', key, enc.encode(msg)));
}
// constant-time compare: compare HMACs of both values
async function safeEqual(env, a, b) {
  const k = env.TOKEN_SECRET || 'k';
  const [x, y] = await Promise.all([hmac(k, a), hmac(k, b)]);
  let d = 0; for (let i = 0; i < x.length; i++) d |= x[i] ^ y[i];
  return d === 0;
}
const b64url = u8 => btoa(String.fromCharCode(...u8)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const unb64url = s => Uint8Array.from(atob(s.replace(/-/g, '+').replace(/_/g, '/')), c => c.charCodeAt(0));

/* ---------------- data ---------------- */
async function getList(env) { return (await env.CERTS_KV.get('certs', 'json')) || []; }
async function saveList(env, list) { await env.CERTS_KV.put('certs', JSON.stringify(list)); }
async function body(req) {
  const len = +(req.headers.get('Content-Length') || 0);
  if (len > 64 * 1024) throw new HttpError(413, 'too_large');
  try { return await req.json(); } catch (e) { throw new HttpError(400, 'bad_json'); }
}
function str(v, max) { return String(v ?? '').trim().slice(0, max); }
function clean(b) {
  const title = str(b.title, 140);
  if (!title) throw new HttpError(400, 'title_required');
  let url = str(b.url, 500);
  if (url && !/^https?:\/\//i.test(url)) throw new HttpError(400, 'bad_url');
  return { title, issuer: str(b.issuer, 140), date: str(b.date, 40), kind: str(b.kind, 30) || 'Certificate', url };
}
function publicView(c, origin) {
  return { id: c.id, title: c.title, issuer: c.issuer, date: c.date, kind: c.kind, url: c.url, img: c.img ? `${origin}/img/${c.id}?v=${c.v}` : null };
}
const json = (data, status, headers) => new Response(JSON.stringify(data), { status, headers: { ...headers, 'Content-Type': 'application/json; charset=utf-8' } });
