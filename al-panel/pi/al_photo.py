#!/usr/bin/env python3
"""The Guardian's camera (written 2026-11-24).

Dr. O's rule: whenever the Guardian takes a photo she says out loud that she is doing so, first.
That rule lives here, in code, in the one function every photo goes through (take_photo). It is not
a line in her persona, because a persona can be ignored and this cannot:

  1. the recorded line ("I am taking a photo now.", photo_line.wav, made once by make_photo_line.py)
     is played through the speaker, and the program waits for it to finish;
  2. a short pause, so people can step out of the frame;
  3. only then the picture is taken.

If the line is missing, or cannot be played (speaker busy, sound card gone), NO photo is taken.
Photos stay on this robot, in ~/al_photos, and the newest KEEP_LAST are kept; older ones are deleted.
Nothing here sends a photo anywhere. The panel shows them on its /photos page.
"""
import os
import re
import subprocess
import threading
import time

HERE = os.path.dirname(os.path.abspath(__file__))
PHOTO_DIR = os.environ.get("AL_PHOTO_DIR", os.path.join(os.path.expanduser("~"), "al_photos"))
LINE_FILE = os.path.join(HERE, "photo_line.wav")
PLAY_DEVICE = os.environ.get("AL_PLAY_DEVICE", "plughw:wm8960soundcard")   # by name, because the card number can move
PAUSE_SECONDS = 1.5          # after she has spoken, before the picture
KEEP_LAST = 20               # newest photos kept on the robot
OWN_GAP_SECONDS = 30         # when she decides to take a photo herself, at least this long since her last one (the panel and a spoken request are not held back)
WIDTH, HEIGHT = 2028, 1520   # the camera's binned mode: sharp, quick, and a small file
NAME_RE = re.compile(r"^photo_\d{8}_\d{6}(?:_\d+)?\.jpg$")

_lock = threading.Lock()
_last_own = [0.0]


def play_line(line_file=None, device=None):
    """Play the recorded line and come back when it has finished. Raises if it cannot."""
    subprocess.run(["aplay", "-q", "-D", device or PLAY_DEVICE, line_file or LINE_FILE], check=True, timeout=30)


def capture(path):
    """Take one picture with the camera and write it to path. Raises if no picture was made."""
    subprocess.run(["rpicam-still", "-n", "-t", "1000", "--width", str(WIDTH), "--height", str(HEIGHT), "-o", path],
                   check=True, timeout=30, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    if not (os.path.isfile(path) and os.path.getsize(path) > 0):
        raise RuntimeError("the camera made no picture")


def list_photos(folder=None):
    """Photo file names, newest first."""
    folder = folder or PHOTO_DIR
    try:
        names = [n for n in os.listdir(folder) if NAME_RE.match(n)]
    except OSError:
        return []
    return sorted(names, reverse=True)


def prune(folder=None, keep=None):
    """Delete the oldest photos so that at most `keep` remain."""
    folder = folder or PHOTO_DIR
    keep = KEEP_LAST if keep is None else keep
    for n in list_photos(folder)[keep:]:
        try:
            os.remove(os.path.join(folder, n))
        except OSError:
            pass


def safe_path(name, folder=None):
    """The full path of a photo, or None unless the name is exactly one of ours and the file exists."""
    folder = folder or PHOTO_DIR
    if not isinstance(name, str) or not NAME_RE.match(name):
        return None
    p = os.path.join(folder, name)
    return p if os.path.isfile(p) else None


def take_photo(play=None, capture_fn=None, sleep=None, pause=None, folder=None, line_file=None, now=None, silent=False, keep=None):
    """Say it, wait, then take the picture. Returns {"ok": True, "name": ...} or {"ok": False, "why": ...}.
    The arguments are only here so the tests can stand in for the speaker and the camera.

    silent=True skips the spoken line and the pause (2026-11-26, Dr. O's decision of 2026-11-24: announcing a photo to an intruder can get people hurt).
    Only the armed Sentry path ever passes it, and only after the OWNER has switched silent photos on and ticked that they are responsible (al_sentry.set_silent).
    Everything else, the panel button, a spoken request, a photo she decides on herself, keeps the rule: she says it first, or no photo."""
    line_file = line_file or LINE_FILE
    folder = folder or PHOTO_DIR
    play = play or (lambda: play_line(line_file))
    capture_fn = capture_fn or capture
    sleep = sleep or time.sleep
    pause = PAUSE_SECONDS if pause is None else pause
    if not _lock.acquire(blocking=False):
        return {"ok": False, "why": "she is already taking a photo"}
    try:
        if not silent:
            if not os.path.isfile(line_file):
                return {"ok": False, "why": "no photo: her spoken line is missing (run make_photo_line.py)"}
            try:
                play()
            except Exception:
                return {"ok": False, "why": "no photo: she could not say it out loud (the speaker was busy or is not working)"}
            sleep(pause)
        try:
            os.makedirs(folder, exist_ok=True)
        except OSError:
            return {"ok": False, "why": "no photo: there is nowhere to keep it"}
        stamp = time.strftime("%Y%m%d_%H%M%S", now or time.localtime())
        name, n = "photo_%s.jpg" % stamp, 1
        while os.path.exists(os.path.join(folder, name)):
            n += 1
            name = "photo_%s_%d.jpg" % (stamp, n)
        path = os.path.join(folder, name)
        try:
            capture_fn(path)
        except Exception:
            try:
                os.remove(path)
            except OSError:
                pass
            return {"ok": False, "why": "the camera did not make a picture"}
        prune(folder, keep)
        return {"ok": True, "name": name}
    finally:
        _lock.release()


def take_photo_herself(clock=None, **kw):
    """She decided she needs a photo. Same gate as every photo, but not again within OWN_GAP_SECONDS of her last one."""
    clock = clock or time.time
    if clock() - _last_own[0] < OWN_GAP_SECONDS:
        return {"ok": False, "why": "she took one a moment ago"}
    r = take_photo(**kw)
    if r.get("ok"):
        _last_own[0] = clock()
    return r


def page_html():
    """The panel's photo page: the newest picture, a Take a photo button, and the ones kept."""
    return """<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>Photos</title>
<style>
:root{--bg:#f6f4f1;--ink:#1b1b1b;--card:#fff;--line:#d8d3cc;--accent:#8a1c1c}
@media (prefers-color-scheme:dark){:root{--bg:#141414;--ink:#f1eee9;--card:#1e1e1e;--line:#3a3a3a;--accent:#e06a6a}}
body{margin:0;background:var(--bg);color:var(--ink);font:18px/1.4 system-ui,sans-serif;padding:16px}
h1{font-size:1.4rem;margin:0 0 12px}
button{font:inherit;padding:12px 20px;border-radius:10px;border:2px solid var(--accent);background:var(--accent);color:#fff;cursor:pointer}
button:disabled{opacity:.6}
#msg{margin:12px 0;min-height:1.4em}
#latest{max-width:100%;border-radius:10px;border:1px solid var(--line);background:var(--card)}
#grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(150px,1fr));gap:10px;margin-top:16px}
#grid img{width:100%;border-radius:8px;border:1px solid var(--line);cursor:pointer}
</style></head><body>
<h1>Photos</h1>
<button id="go">Take a photo</button>
<div id="msg" role="status"></div>
<img id="latest" alt="" hidden>
<div id="grid"></div>
<script>
const msg=document.getElementById('msg'),latest=document.getElementById('latest'),grid=document.getElementById('grid'),go=document.getElementById('go');
async function load(){
  const r=await fetch('/api/photos'); const d=await r.json(); const p=d.photos||[];
  if(p.length){latest.src='/photos/'+p[0];latest.hidden=false;}else{latest.hidden=true;}
  grid.innerHTML=''; p.forEach(n=>{const i=document.createElement('img');i.src='/photos/'+n;i.alt=n;i.onclick=()=>{latest.src=i.src;latest.hidden=false;};grid.appendChild(i);});
  if(!p.length) msg.textContent='No photos yet.';
}
go.onclick=async()=>{
  go.disabled=true; msg.textContent='She is telling you she is taking a photo...';
  try{const r=await fetch('/api/take-photo',{method:'POST'}); const d=await r.json();
    msg.textContent=d.ok?'Done.':(d.why||'No photo was taken.'); await load();}
  catch(e){msg.textContent='Could not reach her.';}
  go.disabled=false;
};
load();
</script></body></html>
"""


if __name__ == "__main__":
    # by hand, to try it: python3 al_photo.py   (she says the line, waits, takes one photo, and prints what happened)
    import json
    print(json.dumps(take_photo()))
