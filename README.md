# indradarmawan2202.github.io

Portofolio **Muhammad Indra Darmawan**, Fullstack Developer & AI Engineer (Surabaya).

🔗 **Live:** https://indradarmawan2202.github.io

Gaya visualnya *Signal / Noise*: estetika zine punk dengan latar hitam ber-grain, judul serif besar, dan aksen merah. Gambar-gambarnya halftone yang dibuat di canvas dan ditempel di atas sobekan kertas merah. Section-nya dibuat seperti album: Tracklist (proyek), Side B (riset), Tour dates (pengalaman), Gear list (skill), Heavy rotation (musik).

Semua ada di satu `index.html`: HTML, CSS, dan JS murni, tanpa build step.

## Edit cepat
- **Kontak:** cari `TODO` di `index.html` (email, LinkedIn, Upwork).
- **Foto sendiri di collage:** taruh foto di folder `img/`, lalu tambahkan `data-src="img/foto.jpg"` di `<canvas>` milik `.shot`. Foto otomatis diubah jadi halftone.

## Spotify
Ada dua opsi, dan keduanya bisa dipakai bersamaan. Atur di objek `SPOTIFY` di bagian atas `<script>` dalam `index.html`.

### 1. Embed playlist (gampang, tanpa API key)
Ambil ID dari link playlist publik `https://open.spotify.com/playlist/<ID>?si=...`, lalu isi:
```js
const SPOTIFY = { playlistId: '<ID>', nowPlayingUrl: '' };
```

### 2. "Now playing" live (Spotify Web API + Cloudflare Worker)
GitHub Pages itu statis, jadi client secret tidak boleh ditaruh di sini. Worker gratis di Cloudflare yang menyimpan secret-nya lalu meneruskan datanya.

> Syarat Spotify sejak Feb 2026: app dalam *Development Mode* hanya jalan kalau pemilik app punya **Spotify Premium** aktif.

1. **Buat app:** buka https://developer.spotify.com/dashboard → Create app. Pilih API: Web API. Redirect URI: `http://127.0.0.1:8888/callback` (pakai `127.0.0.1`, `localhost` sudah ditolak Spotify).
2. **Ambil refresh token** (sekali saja, di laptop):
   ```bash
   python spotify-worker/get_refresh_token.py <CLIENT_ID> <CLIENT_SECRET>
   ```
3. **Deploy worker:** buka https://dash.cloudflare.com → Workers & Pages → Create → Worker. Tempel isi `spotify-worker/worker.js` → Deploy.
4. **Isi secrets** di Settings → Variables and Secrets: `SPOTIFY_CLIENT_ID`, `SPOTIFY_CLIENT_SECRET`, `SPOTIFY_REFRESH_TOKEN`, dan `ALLOW_ORIGIN` = `https://indradarmawan2202.github.io,https://darmawan.is-a.dev` (bisa lebih dari satu domain, dipisah koma).
5. **Sambungkan ke website:** isi `nowPlayingUrl` dengan URL worker (`https://<nama>.<akun>.workers.dev`), lalu push.

Kalau tidak ada lagu yang sedang diputar, widget-nya menampilkan "Last played".
