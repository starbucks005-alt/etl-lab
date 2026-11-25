#!/usr/bin/env python3
"""The panel passcode (written 2026-11-24, Dr. O: remote arming from the phone needs a lock on the panel).

The owner sets a passcode once, on the panel or with set_panel_passcode.py on the robot. From then on the panel, its photos and every control ask for it,
on the home network and on the phone alike. Until a passcode is set the panel behaves as it always has, so nobody is locked out of a robot by an update.

How it keeps the passcode safe:
  The passcode itself is never stored. Only a salted PBKDF2 fingerprint is kept in panel_lock.json, which stays on this robot.
  A wrong passcode is slowed down: after five misses in a row the panel waits a minute, then longer on each further miss, up to a quarter hour.
  A signed cookie (HttpOnly, SameSite) keeps the owner signed in on that browser for a week, or until they sign out. The signing key is made once and kept in panel_secret.key.
  Every set, change, removal, sign in and miss goes into a log that shows if anyone alters it (al_chain.py).
If the owner forgets it: sign in to the robot and run  python3 set_panel_passcode.py --remove  (or delete panel_lock.json). The robot itself is the owner's proof.
"""
import hashlib
import hmac
import json
import os
import secrets
import time

import al_chain

HERE = os.path.dirname(os.path.abspath(__file__))
LOCK_FILE = os.path.join(HERE, "panel_lock.json")
SECRET_FILE = os.path.join(HERE, "panel_secret.key")
LOG_FILE = os.path.join(HERE, "lock_log.jsonl")
ITERATIONS = 200000
MIN_LENGTH = 6
SESSION_DAYS = 7
FREE_MISSES = 5
MAX_WAIT = 900
_fail = {"count": 0, "until": 0.0}


def _fingerprint(passcode, salt, iterations=None):
    return hashlib.pbkdf2_hmac("sha256", passcode.encode("utf-8"), salt, int(iterations or ITERATIONS)).hex()


def _load(path):
    try:
        with open(path or LOCK_FILE, encoding="utf-8") as f:
            d = json.load(f)
        return d if d.get("hash") and d.get("salt") else None
    except (OSError, ValueError):
        return None


def is_set(path=None):
    return _load(path) is not None


def secret_key(path=None):
    """The key that signs the cookie. Made once, then kept."""
    p = path or SECRET_FILE
    try:
        with open(p, "rb") as f:
            k = f.read()
        if len(k) >= 32:
            return k
    except OSError:
        pass
    k = secrets.token_bytes(48)
    tmp = p + ".tmp"
    with open(tmp, "wb") as f:
        f.write(k)
    try:
        os.chmod(tmp, 0o600)
    except OSError:
        pass
    os.replace(tmp, p)
    return k


def wait_left(now=None):
    now = time.time() if now is None else now
    return max(0, int(_fail["until"] - now + 0.999))


def _note_miss(now):
    _fail["count"] += 1
    over = _fail["count"] - FREE_MISSES
    if over >= 0:
        _fail["until"] = now + min(MAX_WAIT, 60 * (2 ** over))


def verify(passcode, path=None, log=None, now=None):
    """True for the right passcode. Returns (ok, why) so the page can say how long to wait."""
    now = time.time() if now is None else now
    rec = _load(path)
    if rec is None:
        return True, ""
    if now < _fail["until"]:
        return False, "Too many tries. Wait %d seconds." % wait_left(now)
    good = hmac.compare_digest(_fingerprint(str(passcode or ""), bytes.fromhex(rec["salt"]), int(rec.get("iterations", ITERATIONS))), rec["hash"])
    if good:
        _fail["count"], _fail["until"] = 0, 0.0
        al_chain.append(log or LOG_FILE, "sign_in", {}, now=now)
        return True, ""
    _note_miss(now)
    al_chain.append(log or LOG_FILE, "wrong_passcode", {"misses": _fail["count"]}, now=now)
    return False, ("Wrong passcode." if now >= _fail["until"] else "Too many tries. Wait %d seconds." % wait_left(now))


def set_passcode(new, current=None, path=None, log=None, now=None):
    """Sets or changes the passcode. When one is already set, the current one has to be right. Raises ValueError with words for the owner."""
    new = str(new or "")
    if len(new) < MIN_LENGTH:
        raise ValueError("Use at least %d characters." % MIN_LENGTH)
    if is_set(path):
        ok, why = verify(current, path, log, now)
        if not ok:
            raise ValueError(why or "The current passcode is not right.")
    salt = secrets.token_bytes(16)
    rec = {"salt": salt.hex(), "hash": _fingerprint(new, salt, ITERATIONS), "iterations": ITERATIONS, "set": int(time.time() if now is None else now)}
    p = path or LOCK_FILE
    tmp = p + ".tmp"
    with open(tmp, "w", encoding="utf-8") as f:
        json.dump(rec, f)
    try:
        os.chmod(tmp, 0o600)
    except OSError:
        pass
    os.replace(tmp, p)
    al_chain.append(log or LOG_FILE, "passcode_set", {}, now=now)


def clear(current, path=None, log=None, now=None):
    """Removes the lock. Needs the current passcode."""
    if not is_set(path):
        return
    ok, why = verify(current, path, log, now)
    if not ok:
        raise ValueError(why or "The passcode is not right.")
    try:
        os.remove(path or LOCK_FILE)
    except OSError:
        pass
    al_chain.append(log or LOG_FILE, "passcode_removed", {}, now=now)


def make_token(key, now=None):
    """A signed value for the cookie: expiry, then a signature."""
    exp = int((time.time() if now is None else now) + SESSION_DAYS * 86400)
    body = str(exp)
    sig = hmac.new(key, body.encode(), hashlib.sha256).hexdigest()
    return body + "." + sig


def token_ok(token, key, now=None):
    try:
        body, sig = str(token).split(".", 1)
        if not hmac.compare_digest(hmac.new(key, body.encode(), hashlib.sha256).hexdigest(), sig):
            return False
        return int(body) > (time.time() if now is None else now)
    except (ValueError, TypeError):
        return False


# the pages and endpoints that answer without a sign in: the page shell shows the sign in form itself, and the roster and robot id are public already
OPEN_PATHS = ("/api/lock", "/login", "/robots.json", "/api/robot", "/images/", "/favicon.ico", "/audio/")


def needs_sign_in(path):
    return not any(path == p or path.startswith(p if p.endswith("/") else p + "/") or path == p.rstrip("/") for p in OPEN_PATHS)


def decide(path, cookie, now=None, lock_path=None, key_path=None):
    """What the server does with a request: "open" (let it through), "api" (answer 401 as data) or "page" (show the sign in page)."""
    if not is_set(lock_path) or not needs_sign_in(path):
        return "open"
    if token_ok(cookie, secret_key(key_path), now):
        return "open"
    last = path.rsplit("/", 1)[-1]
    if path.startswith(("/api/", "/photos/", "/assets/", "/audio/")) or "." in last:
        return "api"
    return "page"


def login_page(error=""):
    esc = (error or "").replace("&", "&amp;").replace("<", "&lt;")
    return """<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>Sign in</title>
<style>
:root{--bg:#f6f4f1;--ink:#1b1b1b;--card:#fff;--line:#d8d3cc;--accent:#8a1c1c}
@media (prefers-color-scheme:dark){:root{--bg:#141414;--ink:#f1eee9;--card:#1e1e1e;--line:#3a3a3a;--accent:#e06a6a}}
body{margin:0;background:var(--bg);color:var(--ink);font:18px/1.4 system-ui,sans-serif;display:grid;place-items:center;min-height:100vh;padding:16px}
form{background:var(--card);border:1px solid var(--line);border-radius:14px;padding:24px;width:100%;max-width:360px}
h1{font-size:1.3rem;margin:0 0 6px}
p{margin:0 0 14px;opacity:.8;font-size:15px}
input{font:inherit;width:100%;box-sizing:border-box;padding:12px;border-radius:10px;border:1px solid var(--line);background:transparent;color:inherit}
button{font:inherit;margin-top:12px;width:100%;padding:12px;border-radius:10px;border:2px solid var(--accent);background:var(--accent);color:#fff;cursor:pointer}
.err{color:var(--accent);min-height:1.3em;margin-top:8px;font-size:15px}
</style></head><body>
<form id="f"><h1>Enter the passcode</h1><p>This panel is locked by its owner.</p>
<input id="p" type="password" autocomplete="current-password" autofocus aria-label="Passcode">
<button type="submit">Sign in</button><div class="err" id="e" role="alert">""" + esc + """</div></form>
<script>
document.getElementById('f').addEventListener('submit',async function(ev){ev.preventDefault();
  const r=await fetch('/api/lock/login',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({passcode:document.getElementById('p').value})});
  const j=await r.json().catch(()=>({}));
  if(r.ok){location.reload();}else{document.getElementById('e').textContent=j.error||'That did not work.';document.getElementById('p').value='';}
});
</script></body></html>
"""
