#!/usr/bin/env python3
"""The Guardian's Sentry mode (written 2026-11-24, Phase 1 of her skills).

Armed from her panel, the phone, or by voice, she watches her motion sensor. When it sees someone while she is armed she takes a photo, and the photo
goes through the one gate in al_photo.py: she says it out loud first (Dr. O's rule), and if she cannot say it, NO photo is taken.
ONE exception, Dr. O's decision of 2026-11-24, built 2026-11-26: announcing a photo to an intruder can get people hurt, so the OWNER may switch on silent
photos for armed Sentry (set_silent). It is off by default, it needs the owner's tick that they are responsible, and it is the only place a photo skips
the spoken line. Silent also means no alarm sound. Each time is written to a list of alerts that her panel shows, with the time, the photo, and whether it was silent.

Safe defaults I added so it behaves (each one is a constant below):
  EXIT_DELAY_SECONDS  after arming she ignores motion for a while, so the person who armed her can walk away;
  GAP_SECONDS         after one alert she waits before the next, so one person walking about is one alert and not fifty;
  MAX_ALERTS          the list keeps the newest ones. The photos themselves follow al_photo.KEEP_LAST, so an old alert may say its photo is no longer kept.
The optional alarm is a short two tone sound from this robot's own speaker. It is off unless switched on.
Everything here stays on this robot. Nothing is sent anywhere.
"""
import json
import math
import os
import struct
import subprocess
import threading
import time
import wave

HERE = os.path.dirname(os.path.abspath(__file__))
STATE_FILE = os.path.join(HERE, "sentry.json")
ALERTS_FILE = os.path.join(HERE, "sentry_alerts.json")
ALARM_FILE = os.path.join(HERE, "alarm.wav")
SENTRY_LINE = os.path.join(HERE, "sentry_line.wav")      # "Motion detected. I am taking a photo now." made once by make_photo_line.py --sentry
PLAY_DEVICE = os.environ.get("AL_PLAY_DEVICE", "plughw:wm8960soundcard")
EXIT_DELAY_SECONDS = 30
GAP_SECONDS = 30
MAX_ALERTS = 100

_lock = threading.Lock()
_last_alert = [0.0]
_boot = time.time()


def _read(path, default):
    try:
        with open(path, encoding="utf-8") as f:
            return json.load(f)
    except (OSError, ValueError):
        return default


def _write(path, data):
    tmp = path + ".tmp"
    with open(tmp, "w", encoding="utf-8") as f:
        json.dump(data, f)
    os.replace(tmp, path)


def load_state(path=None):
    d = _read(path or STATE_FILE, {})
    return {"armed": bool(d.get("armed")), "since": float(d.get("since") or 0), "live_at": float(d.get("live_at") or 0), "alarm": bool(d.get("alarm")),
            "silent": bool(d.get("silent")) and bool(d.get("silent_ack_t")), "silent_ack_t": d.get("silent_ack_t")}


def is_armed(path=None):
    return load_state(path)["armed"]


def set_armed(armed, now=None, path=None):
    """Arm or disarm. Arming starts the exit delay."""
    now = time.time() if now is None else now
    s = load_state(path)
    s["armed"] = bool(armed)
    s["since"] = now
    s["live_at"] = (now + EXIT_DELAY_SECONDS) if armed else 0
    _write(path or STATE_FILE, s)
    return s


def set_alarm(on, path=None):
    s = load_state(path)
    s["alarm"] = bool(on)
    _write(path or STATE_FILE, s)
    return s


def set_silent(on, ack=False, now=None, path=None):
    """Dr. O's decision of 2026-11-24: while armed, her photos are SILENT, because announcing a photo to an intruder can get people hurt.
    Off by default. Turning it on needs the owner's tick that they are responsible for it. Turning it off needs nothing.
    Silent also means no alarm sound. Every other photo she takes is still announced."""
    now = time.time() if now is None else now
    s = load_state(path)
    if on:
        if not ack:
            raise ValueError("Tick the box to say you are responsible for silent photos.")
        s["silent"], s["silent_ack_t"] = True, int(now)
    else:
        s["silent"] = False
    _write(path or STATE_FILE, s)
    return s


def alerts(path=None):
    """The newest alerts first."""
    items = _read(path or ALERTS_FILE, [])
    return list(reversed(items)) if isinstance(items, list) else []


def _add_alert(item, path=None):
    items = _read(path or ALERTS_FILE, [])
    if not isinstance(items, list):
        items = []
    items.append(item)
    _write(path or ALERTS_FILE, items[-MAX_ALERTS:])


def make_alarm_file(path=None):
    """A two second, two tone alarm, made once. Kept moderate on purpose; the speaker's own volume decides how loud it is."""
    path = path or ALARM_FILE
    if os.path.exists(path):
        return path
    rate = 16000
    frames = bytearray()
    for i in range(rate * 2):
        f = 880 if (i // (rate // 4)) % 2 == 0 else 660
        frames += struct.pack("<h", int(9000 * math.sin(2 * math.pi * f * i / rate)))
    with wave.open(path, "wb") as w:
        w.setnchannels(1)
        w.setsampwidth(2)
        w.setframerate(rate)
        w.writeframes(bytes(frames))
    return path


def play_alarm():
    subprocess.run(["aplay", "-q", "-D", PLAY_DEVICE, make_alarm_file()], check=True, timeout=30)


def on_motion(photo_fn, alarm_fn=None, clock=None, state_path=None, alerts_path=None, silent_fn=None):
    """The sensor saw someone. Returns None when nothing was due, else what happened.
    photo_fn() must be the gated photo (it says the line, then shoots) and return {"ok": ..., "name"/"why": ...}.
    When the owner has switched silent photos on (set_silent) and silent_fn is given, silent_fn() takes the photo instead, with no spoken line and no alarm."""
    clock = clock or time.time
    now = clock()
    s = load_state(state_path)
    if not s["armed"]:
        return None
    if now < s["live_at"]:
        return {"skipped": "exit delay"}
    if now - _last_alert[0] < GAP_SECONDS:
        return {"skipped": "just alerted"}
    if not _lock.acquire(blocking=False):
        return {"skipped": "busy"}
    try:
        _last_alert[0] = now
        quiet = bool(s["silent"] and silent_fn)
        r = (silent_fn() if quiet else photo_fn()) or {}
        item = {"time": now, "ok": bool(r.get("ok")), "photo": r.get("name") if r.get("ok") else None, "why": None if r.get("ok") else r.get("why", "no photo"), "silent": quiet}
        _add_alert(item, alerts_path)
        if r.get("ok") and s["alarm"] and alarm_fn and not quiet:
            try:
                alarm_fn()
            except Exception:
                item["alarm_failed"] = True
        return item
    finally:
        _lock.release()


def page_html():
    return """<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>Sentry</title>
<style>
:root{--bg:#f6f4f1;--ink:#1b1b1b;--card:#fff;--line:#d8d3cc;--accent:#8a1c1c;--ok:#1d6b3a}
@media (prefers-color-scheme:dark){:root{--bg:#141414;--ink:#f1eee9;--card:#1e1e1e;--line:#3a3a3a;--accent:#e06a6a;--ok:#62c585}}
body{margin:0;background:var(--bg);color:var(--ink);font:18px/1.4 system-ui,sans-serif;padding:16px}
h1{font-size:1.4rem;margin:0 0 8px}
.row{display:flex;gap:12px;flex-wrap:wrap;margin:12px 0}
button{font:inherit;padding:12px 20px;border-radius:10px;border:2px solid var(--accent);background:var(--accent);color:#fff;cursor:pointer}
button.alt{background:transparent;color:var(--accent)}
#status{font-weight:600}
.on{color:var(--ok)} .off{color:var(--accent)}
.alert{display:flex;gap:12px;align-items:center;border:1px solid var(--line);background:var(--card);border-radius:10px;padding:8px;margin:8px 0}
.alert img{width:120px;border-radius:8px}
small{opacity:.75}
</style></head><body>
<h1>Sentry</h1>
<div id="status" role="status">Loading...</div>
<div class="row"><button id="arm">Arm</button><button id="disarm" class="alt">Disarm</button><button id="alarm" class="alt">Alarm sound: off</button></div>
<small id="note"></small>
<h2>Alerts</h2><div id="list"></div>
<script>
const $=id=>document.getElementById(id); let st={};
function ago(t){const s=Math.max(0,Math.round(Date.now()/1000-t));return s<90?s+' seconds ago':s<5400?Math.round(s/60)+' minutes ago':new Date(t*1000).toLocaleString();}
async function load(){
  const d=await (await fetch('/api/sentry')).json(); st=d;
  $('status').innerHTML=d.armed?'<span class="on">Armed</span>'+(d.exit_delay_left>0?' (live in '+d.exit_delay_left+' seconds)':''):'<span class="off">Not armed</span>';
  $('alarm').textContent='Alarm sound: '+(d.alarm?'on':'off');
  $('note').textContent='Motion sensor: '+d.sensor+'. '+(d.silent?'While she is armed her photos are silent, as you chose, and the alarm sound stays off. Every other photo is announced out loud first.':'Every photo is announced out loud first, and no photo is taken if she cannot say it.');
  const L=$('list'); L.innerHTML='';
  if(!d.alerts.length){L.textContent='No alerts yet.';return;}
  d.alerts.forEach(a=>{const e=document.createElement('div');e.className='alert';
    const img=a.photo&&a.photo_kept?'<a href="/photos/'+a.photo+'"><img src="/photos/'+a.photo+'" alt="photo"></a>':'';
    e.innerHTML=img+'<div><div>'+(a.ok?'Motion, photo taken':'Motion, no photo')+'</div><small>'+ago(a.time)+(a.ok?(a.photo_kept?'':' (photo no longer kept)'):' ('+(a.why||'')+')')+'</small></div>';
    L.appendChild(e);});
}
async function post(b){await fetch('/api/sentry',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(b)});await load();}
$('arm').onclick=()=>post({armed:true}); $('disarm').onclick=()=>post({armed:false}); $('alarm').onclick=()=>post({alarm:!st.alarm});
load(); setInterval(load,5000);
</script></body></html>
"""
