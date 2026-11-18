"""
Ambil SPOTIFY_REFRESH_TOKEN sekali saja (jalankan di laptop kamu, bukan di server).

1. Spotify Developer Dashboard -> app kamu -> Settings -> Redirect URIs:
       http://127.0.0.1:8888/callback
   (localhost TIDAK diterima lagi, wajib 127.0.0.1)
2. Jalankan:
       python get_refresh_token.py <CLIENT_ID> <CLIENT_SECRET>
3. Login & Agree di browser -> refresh token tercetak di terminal.
"""
import base64, http.server, json, secrets, sys, urllib.error, urllib.parse, urllib.request, webbrowser

if len(sys.argv) != 3:
    sys.exit("usage: python get_refresh_token.py <CLIENT_ID> <CLIENT_SECRET>")
CID, SECRET = sys.argv[1].strip(), sys.argv[2].strip()
REDIRECT = "http://127.0.0.1:8888/callback"
SCOPES = "user-read-currently-playing user-read-recently-played"
STATE = secrets.token_urlsafe(16)
DONE = False

print(f"Client ID  : {CID[:4]}...{CID[-4:]} ({len(CID)} karakter)")
print(f"Secret     : {len(SECRET)} karakter")
if len(CID) != 32 or len(SECRET) != 32:
    print("!! Peringatan: Client ID / Secret biasanya 32 karakter. Cek lagi copy-nya.")


def page(handler, code, text):
    handler.send_response(code)
    handler.send_header("Content-Type", "text/html; charset=utf-8")
    handler.end_headers()
    handler.wfile.write(f"<h2 style='font-family:sans-serif'>{text}</h2>".encode())


class H(http.server.BaseHTTPRequestHandler):
    def do_GET(self):
        global DONE
        u = urllib.parse.urlparse(self.path)
        if u.path != "/callback":
            page(self, 404, "not found"); return
        q = urllib.parse.parse_qs(u.query)
        if "error" in q:
            print("\n[Spotify menolak login]:", q["error"][0])
            page(self, 400, "Spotify error: " + q["error"][0] + " (cek terminal)"); return
        if q.get("state", [None])[0] != STATE or "code" not in q:
            page(self, 400, "state/code tidak valid, ulangi dari awal"); return

        body = urllib.parse.urlencode({
            "grant_type": "authorization_code",
            "code": q["code"][0],
            "redirect_uri": REDIRECT,
        }).encode()
        req = urllib.request.Request("https://accounts.spotify.com/api/token", data=body, headers={
            "Authorization": "Basic " + base64.b64encode(f"{CID}:{SECRET}".encode()).decode(),
            "Content-Type": "application/x-www-form-urlencoded",
        })
        try:
            tok = json.load(urllib.request.urlopen(req))
        except urllib.error.HTTPError as e:
            detail = e.read().decode(errors="replace")
            print(f"\n[GAGAL tukar token] HTTP {e.code}: {detail}")
            if "invalid_client" in detail:
                print("-> Client Secret salah / tidak cocok dengan Client ID. Copy ulang dari Settings app.")
            elif "invalid_grant" in detail:
                print("-> Kode sudah kedaluwarsa/terpakai atau redirect URI tidak sama persis. Coba lagi.")
            print("\nScript masih jalan: buka link login di atas lagi untuk mencoba ulang (Ctrl+C untuk keluar).")
            page(self, 400, "Gagal tukar token, lihat pesan di terminal."); return

        print("\n" + "=" * 60)
        print("SPOTIFY_REFRESH_TOKEN =\n" + tok["refresh_token"])
        print("=" * 60 + "\nSimpan token di atas. JANGAN dibagikan ke siapa pun.")
        page(self, 200, "Beres, cek terminal ✦")
        DONE = True

    def log_message(self, *a):
        pass


url = "https://accounts.spotify.com/authorize?" + urllib.parse.urlencode({
    "client_id": CID, "response_type": "code", "redirect_uri": REDIRECT,
    "scope": SCOPES, "state": STATE, "show_dialog": "true",
})
srv = http.server.HTTPServer(("127.0.0.1", 8888), H)
print("\nMembuka browser untuk login Spotify. Kalau tidak terbuka, copy link ini:\n" + url + "\n")
webbrowser.open(url)
try:
    while not DONE:
        srv.handle_request()
except KeyboardInterrupt:
    print("\nDibatalkan.")
