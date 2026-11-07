#!/usr/bin/env python3
"""ALL ROBOTS: one page that lists every robot and shows which ones are connected.

    py tools\\robots.py            (opens http://localhost:8765 in your browser)

It runs on your own computer, so it can reach the robots on your home network
(the website cannot: a secure web page is not allowed to talk to a device in your house).
Every few seconds it asks each robot "who are you?" at the places that robot could be:
its Tailscale name, the address it was last seen at, its hostname.local, and anything
you add to robot_addresses.json next to this file, like {"astro": ["192.168.0.44"]}.
It only reads: it never changes anything on a robot. Stop it with Ctrl-C.
"""
from __future__ import annotations

import json
import sys
import threading
import time
import urllib.request
import webbrowser
from concurrent.futures import ThreadPoolExecutor
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

HERE = Path(__file__).resolve().parent
PANEL = HERE.parent
PORT_OUT = 8765
ROSTERS = [PANEL / "robots.json", PANEL / "to_AL" / "robots.json"]
EXTRA = HERE / "robot_addresses.json"

state = {"robots": [], "at": 0.0}
lock = threading.Lock()


def load_roster() -> list[dict]:
    for path in ROSTERS:
        if path.exists():
            data = json.loads(path.read_text(encoding="utf-8"))
            return [r for r in data.get("robots", data) if isinstance(r, dict) and r.get("id")]
    sys.exit("No robots.json found next to the panel files.")


def extra_addresses() -> dict:
    try:
        return json.loads(EXTRA.read_text(encoding="utf-8"))
    except (OSError, ValueError):
        return {}


def candidates(r: dict, extra: dict) -> list[tuple[str, int]]:
    port = int(r.get("port") or 8000)
    names = list(extra.get(r["id"], []))
    if r.get("last_seen_address"):
        names.append(r["last_seen_address"])
    if r.get("hostname"):
        names.append(str(r["hostname"]).lower() + ".local")
    names.append(r["id"] + ".local")
    seen, out = set(), []
    for n in names:
        n = str(n).strip()
        if n and n not in seen:
            seen.add(n)
            out.append((n, port))
    return out


def ask_robot(host: str, port: int) -> dict | None:
    try:
        with urllib.request.urlopen(f"http://{host}:{port}/api/robot", timeout=1.5) as resp:
            return json.loads(resp.read().decode("utf-8"))
    except Exception:
        return None


def check(r: dict, extra: dict) -> dict:
    for host, port in candidates(r, extra):
        answer = ask_robot(host, port)
        # A robot that has no robot.txt yet answers with no id: still a robot, so it counts.
        if answer and answer.get("ok") and answer.get("id") in (r["id"], None):
            return {"id": r["id"], "name": r.get("name", r["id"]), "connected": True,
                    "address": f"{host}:{port}", "url": f"http://{host}:{port}/", "who": answer.get("id")}
    return {"id": r["id"], "name": r.get("name", r["id"]), "connected": False, "address": "", "url": "", "who": None}


def poll_forever() -> None:
    roster = load_roster()
    while True:
        extra = extra_addresses()
        with ThreadPoolExecutor(max_workers=12) as pool:
            results = list(pool.map(lambda r: check(r, extra), roster))
        with lock:
            state["robots"], state["at"] = results, time.time()
        time.sleep(4)


PAGE = """<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>All robots</title><style>
body{margin:0;background:#0f141b;color:#ece8dc;font-family:Segoe UI,system-ui,sans-serif}
main{max-width:760px;margin:0 auto;padding:24px 16px}
h1{font-weight:600;font-size:28px;margin:0 0 4px}
p.s{color:#9aa4b0;margin:0 0 18px}
.row{display:flex;align-items:center;gap:14px;background:#161d27;border:1px solid #263142;border-radius:12px;padding:14px 16px;margin:10px 0}
.dot{width:14px;height:14px;border-radius:50%;background:#5b6573;flex:none}
.on .dot{background:#4fd18b;box-shadow:0 0 10px #4fd18b88}
.n{font-size:19px;font-weight:600}.a{color:#9aa4b0;font-size:14px}
.row div.t{flex:1}
a.b{background:#d9b65f;color:#1b1405;text-decoration:none;font-weight:600;padding:9px 16px;border-radius:8px}
.off{opacity:.6}
</style></head><body><main><h1>All robots</h1><p class="s" id="s">Looking...</p><div id="l"></div></main>
<script>
function esc(s){return String(s).replace(/[&<>"]/g,function(c){return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]})}
function go(){fetch('/api/status').then(function(r){return r.json()}).then(function(d){
 var on=d.robots.filter(function(r){return r.connected}).length;
 document.getElementById('s').textContent=on+' of '+d.robots.length+' connected. Updates every few seconds.';
 document.getElementById('l').innerHTML=d.robots.slice().sort(function(a,b){return (b.connected-a.connected)||a.name.localeCompare(b.name)}).map(function(r){
  return '<div class="row '+(r.connected?'on':'off')+'"><span class="dot"></span><div class="t"><div class="n">'+esc(r.name)+'</div><div class="a">'+(r.connected?esc(r.address):'Not connected')+'</div></div>'+(r.connected?'<a class="b" href="'+esc(r.url)+'" target="_blank">Open panel</a>':'')+'</div>'}).join('')
 }).catch(function(){document.getElementById('s').textContent='This program stopped.'})}
go();setInterval(go,3000);
</script></body></html>"""


class Handler(BaseHTTPRequestHandler):
    def log_message(self, *a):  # quiet
        pass

    def do_GET(self):
        if self.path.startswith("/api/status"):
            with lock:
                body = json.dumps({"robots": state["robots"], "at": state["at"]}).encode()
            ctype = "application/json"
        else:
            body, ctype = PAGE.encode(), "text/html; charset=utf-8"
        self.send_response(200)
        self.send_header("Content-Type", ctype)
        self.send_header("Cache-Control", "no-store")
        self.end_headers()
        self.wfile.write(body)


def main() -> None:
    threading.Thread(target=poll_forever, daemon=True).start()
    server = ThreadingHTTPServer(("127.0.0.1", PORT_OUT), Handler)
    url = f"http://localhost:{PORT_OUT}/"
    print(f"All robots: {url}   (Ctrl-C to stop)")
    if "--no-browser" not in sys.argv:
        webbrowser.open(url)
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        print("\nStopped.")


if __name__ == "__main__":
    main()
