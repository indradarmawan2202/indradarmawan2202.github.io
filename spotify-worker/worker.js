/**
 * Spotify "now playing" proxy — Cloudflare Worker (gratis).
 *
 * Secrets (Cloudflare → Worker → Settings → Variables and Secrets):
 *   SPOTIFY_CLIENT_ID      — dari Spotify Developer Dashboard
 *   SPOTIFY_CLIENT_SECRET  — dari Spotify Developer Dashboard (JANGAN taruh di repo)
 *   SPOTIFY_REFRESH_TOKEN  — hasil get_refresh_token.py
 *   ALLOW_ORIGIN           — satu atau beberapa domain, pisahkan dengan koma, misal:
 *                            https://indradarmawan2202.github.io,https://darmawan.is-a.dev
 *
 * Response JSON: { playing, title, artist, album, cover, url }
 */
let cached = { token: null, exp: 0 };

export default {
  async fetch(req, env) {
    const allowed = (env.ALLOW_ORIGIN || '*').split(',').map(s => s.trim().replace(/\/$/, ''));
    const origin = req.headers.get('Origin') || '';
    const headers = {
      'Access-Control-Allow-Origin': allowed.includes('*') ? '*' : (allowed.includes(origin) ? origin : allowed[0]),
      'Vary': 'Origin',
      'Content-Type': 'application/json',
      'Cache-Control': 'public, max-age=20',
    };
    if (req.method === 'OPTIONS') return new Response(null, { headers });

    try {
      const auth = { headers: { Authorization: `Bearer ${await accessToken(env)}` } };

      // 1) lagu yang sedang diputar
      let r = await fetch('https://api.spotify.com/v1/me/player/currently-playing', auth);
      if (r.status === 200) {
        const j = await r.json();
        if (j.item && j.currently_playing_type === 'track') return out(shape(j.item, j.is_playing), headers);
      }
      // 2) fallback: terakhir diputar
      r = await fetch('https://api.spotify.com/v1/me/player/recently-played?limit=1', auth);
      if (r.ok) {
        const it = (await r.json()).items?.[0];
        if (it) return out({ ...shape(it.track, false), playedAt: it.played_at }, headers);
      }
      return out({ playing: false }, headers);
    } catch (e) {
      return out({ error: 'unavailable' }, headers, 502);
    }
  },
};

async function accessToken(env) {
  if (cached.token && Date.now() < cached.exp) return cached.token;
  const r = await fetch('https://accounts.spotify.com/api/token', {
    method: 'POST',
    headers: {
      Authorization: 'Basic ' + btoa(`${env.SPOTIFY_CLIENT_ID}:${env.SPOTIFY_CLIENT_SECRET}`),
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: new URLSearchParams({ grant_type: 'refresh_token', refresh_token: env.SPOTIFY_REFRESH_TOKEN }),
  });
  if (!r.ok) throw new Error('token ' + r.status);
  const j = await r.json();
  cached = { token: j.access_token, exp: Date.now() + (j.expires_in - 60) * 1000 };
  return cached.token;
}

function shape(t, playing) {
  const imgs = t.album?.images || [];
  return {
    playing: !!playing,
    title: t.name,
    artist: (t.artists || []).map(a => a.name).join(', '),
    album: t.album?.name,
    cover: (imgs[1] || imgs[0])?.url,
    url: t.external_urls?.spotify,
  };
}

const out = (body, headers, status = 200) => new Response(JSON.stringify(body), { status, headers });
