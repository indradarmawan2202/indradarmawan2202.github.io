"""
Ambil SPOTIFY_REFRESH_TOKEN sekali saja (jalankan di laptop kamu, bukan di server).

1. Spotify Developer Dashboard → app kamu → Settings → Redirect URIs:
       http://127.0.0.1:8888/callback
   (localhost TIDAK diterima lagi, wajib 127.0.0.1)
2. Jalankan:
       python get_refresh_token.py <CLIENT_ID> <CLIENT_SECRET>
3. Login & Agree di browser → refresh token tercetak di terminal.
"""
import base64, http.server, json, secrets, sys, urllib.parse, urllib.request, webbrowser

if len(sys.argv) != 3:
    sys.exit("usage: python get_refresh_token.py <CLIENT_ID> <CLIENT_SECRET>")
CID, SECRET = sys.argv[1], sys.argv[2]
REDIRECT = "http://127.0.0.1:8888/callback"
SCOPES = "user-read-currently-playing user-read-recently-played"
STATE = secrets.token_urlsafe(16)

class H(http.server.BaseHTTPRequestHandler):
    def do_GET(self):
        q = urllib.parse.parse_qs(urllib.parse.urlparse(self.path).query)
        if q.get("state", [None])[0] != STATE or "code" not in q:
            self.send_response(400); self.end_headers(); self.wfile.write(b"state/code invalid"); return
        body = urllib.parse.urlencode({"grant_type": "authorization_code", "code": q["code"][0], "redirect_uri": REDIRECT}).encode()
        req = urllib.request.Request("https://accounts.spotify.com/api/token", data=body, headers={
            "Authorization": "Basic " + base64.b64encode(f"{CID}:{SECRET}".encode()).decode(),
            "Content-Type": "application/x-www-form-urlencoded"})
        tok = json.load(urllib.request.urlopen(req))
        print("\nSPOTIFY_REFRESH_TOKEN =\n" + tok["refresh_token"] + "\n")
        self.send_response(200); self.end_headers(); self.wfile.write("Beres, cek terminal ✦".encode())
    def log_message(self, *a): pass

url = "https://accounts.spotify.com/authorize?" + urllib.parse.urlencode(
    {"client_id": CID, "response_type": "code", "redirect_uri": REDIRECT, "scope": SCOPES, "state": STATE})
print("Membuka browser untuk login Spotify…\n" + url)
webbrowser.open(url)
http.server.HTTPServer(("127.0.0.1", 8888), H).handle_request()
