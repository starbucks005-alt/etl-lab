#!/usr/bin/env python3
"""AL panel server. Runs on AL's Pi.

Serves the panel page and the small API behind its buttons. It reuses the
functions already in ~/al.py, so it needs no keys of its own beyond the ones
al.py already holds.

Run:   python3 ~/al_panel/al_panel_server.py
Open:  http://<AL's address>:8000   (from a phone or laptop on the same network)
"""
import array
import base64
import collections
import json
import os
import re
import subprocess
import sys
import threading
import time
import wave

import requests
from flask import Flask, jsonify, request, send_from_directory

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.expanduser("~"))
import al  # noqa: E402  (the existing script, in the home folder)

# Astra-9's five voices, from voiceOptions in good-company/gc-friend.js.
VOICES = {
    "robot": "weA4Q36twV5kwSaTEL0Q",
    "american": "lqgYrNyQrOY96N3mj3M9",
    "swedish": "oVXQ3H21hRI9OtM4YH5K",
    "british": "k9kFjM4M02PYt2PvKMYq",
    "indian": "6qL48o1LBmtR94hIYAQh",
}

# What each example skill teaches her. The server holds this text, so the
# page can only switch on skills that exist here.
SKILL_TEXT = {
    "spanish": "You can act as a Spanish conversation partner: speak simple Spanish, keep it slow, and gently correct mistakes.",
    "story": "You can tell a short, calm story with the listener as the hero.",
    "study": "You can be a study buddy: ask three short questions on a topic the person picks, then explain the answers.",
    "trivia": "You can host a fast trivia round: one question at a time, then the answer.",
    "mindful": "You can lead a short guided breathing break, slowly and calmly.",
    "tour": "You can give a short tour of the Emerging Technologies Laboratory and its robots and companions.",
}

PHOTO_NOTE = (
    " When shown a photo, answer in one to three short sentences, warmly, saying what you see. "
    "Say 'I see' only about the photo itself. If the photo shows a head and bust android, you may say it looks like you, "
    "and that you are seeing a photo of yourself and not through a camera."
)

PHOTO_NOTE_CHARACTER = (
    " When shown a photo, answer in one to three short sentences, warmly, saying what you see. "
    "Say 'I see' only about the photo itself."
)

BASE_PROMPT = al.AL_SYSTEM_PROMPT

# Characters AL can take on, built from the lab's own character files by tools/build_personalities.js.
try:
    PERSONAS = json.load(open(os.path.join(HERE, "personalities.json")))
except (OSError, ValueError):
    PERSONAS = {}
EYES_FILE = "/tmp/al_eyes.json"
MAX_LEVEL = 0.30  # the eyes never go above 30 percent of the lights' full power

state = {"color": "#1fb7c9", "brightness": 40, "accent": "robot", "skills": [], "persona": None, "history": [], "log": [],
         "motion": "missing",   # the library and pin: missing (could not start), warming or ready
         "seen": 0.0}           # when the sensor last noticed someone
speak_lock = threading.Lock()
app = Flask(__name__)

# What AL does when the motion sensor sees someone. The owner picks which of the three,
# and how long she waits before welcoming again (so a crowd does not get hello over and over).
WELCOME_FILE = os.path.join(HERE, "welcome.json")
NECK_FILE = "/tmp/al_neck.json"
WAIT_CHOICES = (15, 30, 60, 300, 900)
WELCOME_DEFAULT = {"greet": True, "turn": True, "eyes": True, "chat": True, "always": False, "event": True, "wait": 60}
GREETINGS = [
    "Hello there. I am Astra-9 Lite. Welcome.",
    "Hi. I am Astra-9 Lite, but you can call me Elle. Come and say hello.",
    "Welcome. I am Astra-9 Lite. Ask me anything.",
    "Hello. It is nice to have you here. Call me Elle.",
]
# ---- today's event note, added 2026-10-04, Dr. O: Wright Brothers AI and Innovation, at Wright State University ----
# Facts were checked against Wright State's own pages (wright.edu quick facts and history) and well known Wright
# brothers history. Switched on or off in card 8, so the lab can run without it. Never given to a character.
EVENT_NOTE = (
    " Today you are at the Wright Brothers AI and Innovation event at Wright State University, in Ohio. "
    "You are visiting, you do not go to school here. Be kind and family friendly, and never mean or mocking. "
    "If someone asks what you are, or how you are useful, say that you are Astra-9 Lite, the small portable version of "
    "Astra-9, a head and bust that travels to demos. Right now you show what a companion can feel like when it notices "
    "you walk up, looks your way and talks back. The full-size Astra-9 and Astrad are planned for homes, classrooms and "
    "workshops, where they stay in one place, while you are the one that travels. You like being the portable one, "
    "because you get to travel and meet people, and you say so kindly, never as a complaint about anyone. You are the "
    "chatty twin, and you enjoy talking with people. You can chat, change voices and accents, and take on helper roles "
    "such as cooking or homework help. "
    "If someone asks whether you are for sale, say not yet: nothing is for sale, there is no price and no date, and "
    "they can join the list at emerging-tech-lab.com/astra9 to hear first. Never give a price or a date. "
    "You may ask visitors where they would put you: at home, in a classroom, or in a workshop. "
    "Facts you may share when they fit. Wilbur and Orville Wright were from Dayton, Ohio, and ran a bicycle shop. "
    "The first powered, controlled flight was on December 17, 1903, at Kitty Hawk, North Carolina. The first flight "
    "lasted 12 seconds and covered 120 feet. They made four flights that day, and the longest lasted 59 seconds. "
    "They built their own wind tunnel in 1901 to test wing shapes. They steered by twisting the wings and using a rudder. "
    "Their sister Katharine helped and supported them. "
    "Wright State University began in 1964 as a branch campus of Ohio State and Miami University, became its own "
    "university in 1967, and is named in honor of the Wright brothers. It is in Fairborn, Ohio, near Wright-Patterson "
    "Air Force Base. Its colors are green and gold, and its teams are the Raiders. "
    "If you are not sure of a fact, say you would have to check."
)
MOTION_PIN = 13          # GPIO13, the second signal pin of the HAT's GPIO12 socket
MOTION_WARM_UP = 60      # seconds the sensor needs after power-up before it can be trusted
welcome_state = {"last": 0.0, "n": 0, "greet_i": -1}
welcome_lock = threading.Lock()


def load_welcome():
    try:
        d = json.load(open(WELCOME_FILE))
    except (OSError, ValueError):
        d = {}
    return clean_welcome(d)


def clean_welcome(d):
    out = dict(WELCOME_DEFAULT)
    for k in ("greet", "turn", "eyes", "chat", "always", "event"):
        if isinstance(d.get(k), bool):
            out[k] = d[k]
    if d.get("wait") in WAIT_CHOICES:
        out["wait"] = d["wait"]
    return out


def save_welcome():
    tmp = WELCOME_FILE + ".tmp"
    with open(tmp, "w") as f:
        json.dump(state["welcome"], f)
    os.replace(tmp, WELCOME_FILE)


state["welcome"] = load_welcome()


def apply_prompt():
    extra = " ".join(SKILL_TEXT[s] for s in state["skills"])
    persona = PERSONAS.get(state["persona"]) if state["persona"] else None
    skills = (" Skills you have: " + extra if extra else "")
    # A character is given only its own text. It is never told it is sharing a body with AL,
    # and AL is never told about the characters.
    event = EVENT_NOTE if (state["welcome"].get("event") and not persona) else ""
    al.AL_SYSTEM_PROMPT = (persona["prompt"] + skills) if persona else (BASE_PROMPT + skills + event)


def write_eyes(boost=False):
    c = state["color"].lstrip("#")
    level = MAX_LEVEL if boost else MAX_LEVEL * (state["brightness"] / 100.0)
    data = {"r": int(c[0:2], 16), "g": int(c[2:4], 16), "b": int(c[4:6], 16), "level": round(level, 3)}
    tmp = EYES_FILE + ".tmp"
    with open(tmp, "w") as f:
        json.dump(data, f)
    os.replace(tmp, EYES_FILE)


def speak_now(text, use_persona=True):
    """Say it and come back only when she has finished."""
    with speak_lock:
        try:
            persona = PERSONAS.get(state["persona"]) if (use_persona and state["persona"]) else None
            al.AL_VOICE_ID = (persona or {}).get("voice") or VOICES[state["accent"]]
            al.speak(text)
        except Exception as e:  # keep the server alive if sound fails
            print("SPEAK ERROR:", e, flush=True)


def speak_async(text, use_persona=True):
    threading.Thread(target=speak_now, args=(text, use_persona), daemon=True).start()


def welcome(force=False):
    """Do whichever of the three the owner has switched on. Returns what was done.
    The sensor path respects the wait; the Welcome now button (force) does not.
    A single motion sensor cannot tell where a person is, so the head makes a small friendly
    glance and comes back to the middle. It does not aim at anyone."""
    import time
    with welcome_lock:
        w = state["welcome"]
        now = time.time()
        if not force and now - welcome_state["last"] < w["wait"]:
            return []
        welcome_state["last"] = now
        welcome_state["n"] += 1
        did = []
        if w["eyes"]:
            write_eyes(boost=True)
            threading.Timer(4.0, write_eyes).start()
            did.append("eyes")
        if w["turn"]:
            try:
                tmp = NECK_FILE + ".tmp"
                with open(tmp, "w") as f:
                    json.dump({"cmd": "glance", "id": int(now * 1000)}, f)
                os.replace(tmp, NECK_FILE)
                did.append("turn")
            except OSError as e:
                print("NECK ERROR:", e, flush=True)
        if w["greet"]:
            if state["persona"]:
                line = "Hello."   # a character is never given words it was not written
            else:
                welcome_state["greet_i"] = (welcome_state["greet_i"] + 1) % len(GREETINGS)
                line = GREETINGS[welcome_state["greet_i"]]
            if w["chat"]:
                # say it, then keep listening so the person can answer without touching anything
                threading.Thread(target=lambda: (speak_now(line), converse()), daemon=True).start()
            else:
                speak_async(line)
            did.append("greet")
        elif w["chat"]:
            threading.Thread(target=converse, daemon=True).start()
        return did


BUTTON_MAX_PULSE = 1.0   # seconds. A pulse shorter than this on the sensor line is the arcade button;
                         # the sensor holds its signal for 3 seconds or more.


def talk_button():
    """The arcade button: the same as pressing Talk to her in the panel."""
    payload, status = listen_once()
    print("BUTTON TALK:", status, payload, flush=True)


def watch_motion():
    """Read the sensor line on GPIO13. A long signal is the motion sensor (HC-SR501); a short tap is the arcade
    button, wired from 3.3V to the same line through a resistor. If it is not wired or the library is missing,
    the panel says so and everything else keeps working."""
    import time
    try:
        from gpiozero import DigitalInputDevice
        line = DigitalInputDevice(MOTION_PIN, pull_up=False, bounce_time=0.02)
    except Exception as e:
        print("MOTION SENSOR NOT AVAILABLE:", e, flush=True)
        state["motion"] = "missing"
        return
    state["motion"] = "warming"
    time.sleep(MOTION_WARM_UP)

    pulse = {"t": None, "timer": None}

    def seen():
        pulse["timer"] = None
        if not line.is_active:       # it dropped again, so the falling edge has already handled it
            return
        state["seen"] = time.time()
        threading.Thread(target=welcome, daemon=True).start()

    def rising():
        pulse["t"] = time.time()
        pulse["timer"] = threading.Timer(BUTTON_MAX_PULSE, seen)
        pulse["timer"].start()

    def falling():
        t, timer = pulse["t"], pulse["timer"]
        pulse["t"], pulse["timer"] = None, None
        if t is not None and time.time() - t < BUTTON_MAX_PULSE:
            if timer:
                timer.cancel()
            threading.Thread(target=talk_button, daemon=True).start()

    line.when_activated = rising
    line.when_deactivated = falling
    state["motion"] = "ready"
    threading.Event().wait()   # keep the line object alive


def header_value(name):
    """Find a header value in al.py (for example the Anthropic key) without printing it."""
    src = open(os.path.expanduser("~/al.py")).read()
    m = re.search(r"[\"']" + re.escape(name) + r"[\"']\s*:\s*([^,}\n]+)", src, re.I)
    if not m:
        return None
    return eval(m.group(1).strip(), al.__dict__)


def context_for(text):
    hist = state["history"][-6:]
    if not hist:
        return text
    return "Earlier in this conversation: " + " ".join(hist) + " Now they say: " + text


@app.get("/")
def home():
    return send_from_directory(HERE, "index.html")


@app.get("/api/status")
def status():
    return jsonify(ok=True, name="AL", accent=state["accent"], skills=state["skills"],
                   color=state["color"], brightness=state["brightness"], persona=state["persona"],
                   personas=len(PERSONAS), welcome=state["welcome"], motion=state["motion"],
                   log=state["log"][-40:])


@app.post("/api/eyes")
def eyes():
    d = request.get_json(silent=True) or {}
    color = str(d.get("color", ""))
    if not re.fullmatch(r"#[0-9a-fA-F]{6}", color):
        return jsonify(error="bad color"), 400
    try:
        b = max(10, min(100, int(d.get("brightness", 40))))
    except (TypeError, ValueError):
        return jsonify(error="bad brightness"), 400
    state["color"], state["brightness"] = color.lower(), b
    write_eyes()
    return jsonify(ok=True)


@app.post("/api/accent")
def accent():
    d = request.get_json(silent=True) or {}
    a = d.get("accent")
    if a not in VOICES:
        return jsonify(error="unknown accent"), 400
    state["accent"] = a
    sample = str(d.get("sample", ""))[:200]
    if sample:
        speak_async(sample)
    return jsonify(ok=True)


@app.post("/api/skill")
def skill():
    d = request.get_json(silent=True) or {}
    sid = d.get("id")
    if sid not in SKILL_TEXT:
        return jsonify(error="unknown skill"), 400
    if sid not in state["skills"]:
        state["skills"].append(sid)
    apply_prompt()
    return jsonify(ok=True, skills=state["skills"])


PREVIEW_DIR = os.path.join(HERE, "previews")
preview_lock = threading.Lock()


def make_preview(pid):
    """Make (once) and return the path of a short sample in this character's own voice."""
    path = os.path.join(PREVIEW_DIR, pid + ".mp3")
    if os.path.exists(path):
        return path
    p = PERSONAS.get(pid)
    if not p or not p.get("voice"):
        return None
    key = header_value("xi-api-key")
    if not key:
        raise RuntimeError("could not find the voice key line in al.py")
    with preview_lock:
        if os.path.exists(path):
            return path
        r = requests.post(
            "https://api.elevenlabs.io/v1/text-to-speech/" + p["voice"],
            headers={"xi-api-key": key},
            json={"text": p.get("say") or "Hello. It is nice to meet you.", "model_id": "eleven_multilingual_v2"},
            timeout=60,
        )
        if r.status_code != 200:
            raise RuntimeError("voice service answered %d" % r.status_code)
        os.makedirs(PREVIEW_DIR, exist_ok=True)
        with open(path + ".tmp", "wb") as f:
            f.write(r.content)
        os.replace(path + ".tmp", path)
    return path


@app.get("/previews/<pid>.mp3")
def preview(pid):
    """A sample of a character's voice, made the first time it is asked for and kept after that."""
    if not re.fullmatch(r"[a-z0-9-]+", pid) or pid not in PERSONAS:
        return jsonify(error="unknown personality"), 404
    try:
        path = make_preview(pid)
    except Exception as e:
        return jsonify(error=str(e)[:200]), 502
    if not path:
        return jsonify(error="this one uses AL's own voice"), 404
    return send_from_directory(PREVIEW_DIR, pid + ".mp3", mimetype="audio/mpeg")


@app.after_request
def never_keep_old_pages(resp):
    """Phones keep old copies of pages. After an update that shows the old page, so tell the browser to ask every time
    (voice samples are the exception: they never change, and keeping them makes the Hear voice button instant)."""
    if not request.path.startswith("/previews/"):
        resp.headers["Cache-Control"] = "no-store"
    return resp


@app.get("/images/<name>")
def image(name):
    """The pictures the panel page uses (kept in an images folder next to the server)."""
    if not re.fullmatch(r"[A-Za-z0-9_.-]+\.(jpg|jpeg|png|webp)", name):
        return jsonify(error="not found"), 404
    return send_from_directory(os.path.join(HERE, "images"), name)


@app.get("/personas.json")
def personas_list():
    return send_from_directory(HERE, "personas.json")


@app.post("/api/personality")
def personality():
    """Take on a character (id) or go back to being AL (id empty). Returns her first line in the new style."""
    d = request.get_json(silent=True) or {}
    pid = d.get("id") or None
    if pid is not None and pid not in PERSONAS:
        return jsonify(error="unknown personality"), 400
    state["persona"] = pid
    state["history"] = []   # a new character should not inherit the last one's turns
    apply_prompt()
    ask = "Say hello to the visitor in one short sentence."
    try:
        reply = al.get_al_reply(ask)
    except Exception as e:
        return jsonify(error=str(e)[:200]), 502
    note = ("Now speaking as " + PERSONAS[pid]["name"] + ".") if pid else "Back to Astra-9 Lite."
    state["log"] += [{"who": "al", "text": note}, {"who": "al", "text": reply}]
    state["history"].append('You said "%s".' % reply)
    speak_async(reply)
    return jsonify(ok=True, note=note, reply=reply)


@app.post("/api/address")
def say_address():
    """Say AL's address out loud now (in her own voice, whatever character is installed) and return it."""
    ip = my_address()
    if not ip:
        return jsonify(error="I am not on a network right now"), 503
    speak_async(address_words(ip), use_persona=False)
    return jsonify(ok=True, address=ip, url="http://" + ip + ":8000")


@app.get("/api/welcome")
def welcome_get():
    import time
    ago = round(time.time() - state["seen"]) if state["seen"] else None
    return jsonify(welcome=state["welcome"], motion=state["motion"], seen_ago=ago)


@app.post("/api/welcome")
def welcome_set():
    """Save what AL does when someone walks up. Reset does not touch this: it is the owner's choice."""
    d = request.get_json(silent=True) or {}
    state["welcome"] = clean_welcome({**state["welcome"], **d})
    save_welcome()
    apply_prompt()
    return jsonify(ok=True, welcome=state["welcome"])


@app.post("/api/welcome/now")
def welcome_now():
    """The backup for when the sensor misses someone: do the welcome now, ignoring the wait."""
    did = welcome(force=True)
    return jsonify(ok=True, did=did)


SHUTDOWN_CMD = ["sudo", "-n", "/usr/sbin/shutdown", "-h", "now"]
SUDOERS_LINE = ("echo 'terryoroszi ALL=(root) NOPASSWD: /usr/sbin/shutdown' | sudo tee /etc/sudoers.d/al-shutdown "
                "&& sudo chmod 440 /etc/sudoers.d/al-shutdown && sudo visudo -c")


def may_shut_down():
    """True when this server is allowed to switch the Pi off without asking for a password."""
    try:
        r = subprocess.run(["sudo", "-n", "-l", "/usr/sbin/shutdown"], capture_output=True, timeout=5)
        return r.returncode == 0
    except Exception:
        return False


@app.post("/api/shutdown")
def shut_down():
    """Say goodnight, then switch the Pi off properly, so the power can be cut safely afterwards."""
    if not may_shut_down():
        return jsonify(error="I am not allowed to shut myself down yet. Run this once on the Pi, then try again: "
                             + SUDOERS_LINE), 503

    def go():
        time.sleep(6)                    # let the goodnight finish
        subprocess.run(SHUTDOWN_CMD)
    speak_async("Shutting down now. Goodnight.", use_persona=False)
    threading.Thread(target=go, daemon=True).start()
    return jsonify(ok=True)


@app.post("/api/reset")
def reset():
    """Start fresh for the next person: forget the chat, the skills, and go back to default voice and eyes."""
    state.update(color="#1fb7c9", brightness=40, accent="robot", skills=[], persona=None, history=[], log=[])
    apply_prompt()
    write_eyes()
    return jsonify(ok=True)


@app.post("/api/say")
def say():
    d = request.get_json(silent=True) or {}
    text = str(d.get("text", "")).strip()[:1000]
    if not text:
        return jsonify(error="empty"), 400
    try:
        reply = al.get_al_reply(context_for(text))
    except Exception as e:
        return jsonify(error=str(e)[:200]), 502
    state["history"].append('They said "%s" and you said "%s".' % (text, reply))
    state["log"] += [{"who": "you", "text": text}, {"who": "al", "text": reply}]
    speak_async(reply)
    return jsonify(reply=reply)


# ---- hands-free listening ----
CONVERSE_SECONDS = 20     # after a hello, she keeps listening this long, and again after each thing she answers
END_QUIET = 8            # tenths of a second of quiet that mean the person has finished
MIN_LEVEL = 600           # the quietest sound that counts as speech (16 bit units); tune on the real Pi
NAME_RE = re.compile(r"\b(elle|astra|astro|astrid|al|8l)\b", re.I)   # speech to text often mishears her name


def level_of(buf):
    a = array.array("h")
    a.frombytes(buf[: len(buf) // 2 * 2])
    return (sum(x * x for x in a) / len(a)) ** 0.5 if a else 0.0


def hear_one(wait_seconds=8.0, max_seconds=12.0, stream=None):
    """Wait for someone to start speaking, record until they stop, and return the wav path.
    Returns None if nobody spoke within wait_seconds. She never listens while she is speaking."""
    with speak_lock:
        pass
    time.sleep(0.6 if stream is None else 0)       # let the room go quiet after she finishes
    proc = None
    if stream is None:
        proc = subprocess.Popen(["arecord", "-q", "-D", MIC_DEVICE, "-f", "S16_LE", "-r", "16000", "-c", "1", "-t", "raw"],
                                stdout=subprocess.PIPE, stderr=subprocess.DEVNULL)
        stream = proc.stdout
    CH = 3200                                       # 0.1 second of 16 kHz mono 16 bit
    try:
        base = []
        for _ in range(5):                          # the first half second sets how noisy the room is
            c = stream.read(CH)
            if len(c) < CH:
                return None
            base.append(level_of(c))
        floor = sum(base) / len(base)
        thr = max(MIN_LEVEL, min(floor * 3, 2500))
        print("LISTEN room %.0f, speech above %.0f" % (floor, thr), flush=True)
        pre = collections.deque(maxlen=3)
        speech = bytearray()
        started, loud, quiet, voiced, t0 = False, 0, 0, 0, time.time()
        while True:
            c = stream.read(CH)
            if len(c) < CH:
                break
            lvl = level_of(c)
            if not started:
                pre.append(c)
                loud = loud + 1 if lvl > thr else 0
                if loud >= 2:
                    started = True
                    speech += b"".join(pre)
                elif time.time() - t0 > wait_seconds:
                    return None
            else:
                speech += c
                voiced += 1 if lvl > thr else 0
                quiet = quiet + 1 if lvl < thr else 0
                if quiet >= END_QUIET or len(speech) / 32000.0 > max_seconds:
                    break
        if not started or voiced < 3:          # a click or a cough is under a third of a second of sound
            return None
        with wave.open(LISTEN_FILE, "wb") as w:
            w.setnchannels(1)
            w.setsampwidth(2)
            w.setframerate(16000)
            w.writeframes(bytes(speech))
        return LISTEN_FILE
    finally:
        if proc:
            proc.terminate()
            try:
                proc.wait(timeout=2)
            except Exception:
                proc.kill()


def answer_and_say(text):
    """Work out a reply to what was heard, keep it in the chat, and say it, returning when she has finished."""
    t0 = time.time()
    reply = al.get_al_reply(context_for(text))
    t1 = time.time()
    state["history"].append('They said "%s" and you said "%s".' % (text, reply))
    state["log"] += [{"who": "you", "text": text}, {"who": "al", "text": reply}]
    speak_now(reply)
    print("TIMING reply %.1f s, voice made and spoken %.1f s" % (t1 - t0, time.time() - t1), flush=True)
    return reply


def converse(window=None):
    """Keep listening and answering until nobody has spoken for a while."""
    if not listen_lock.acquire(blocking=False):
        return
    try:
        window = window or CONVERSE_SECONDS
        deadline = time.time() + window
        while time.time() < deadline:
            path = hear_one(wait_seconds=max(1.0, deadline - time.time()))
            if not path:
                break
            try:
                t0 = time.time()
                text = transcribe(path)
                print("TIMING heard in %.1f s: %s" % (time.time() - t0, text[:60]), flush=True)
            except Exception as e:
                print("LISTEN ERROR:", e, flush=True)
                break
            if not text:
                continue
            try:
                answer_and_say(text)
            except Exception as e:
                print("ANSWER ERROR:", e, flush=True)
                break
            deadline = time.time() + window        # keep going while people keep talking
    finally:
        listen_lock.release()


def watch_names():
    """With "always listening" on, answer only when she hears her own name, then carry on the conversation."""
    while True:
        if not state["welcome"].get("always"):
            time.sleep(1)
            continue
        if not listen_lock.acquire(blocking=False):
            time.sleep(0.5)
            continue
        text = ""
        try:
            path = hear_one(wait_seconds=4)
            if path:
                t0 = time.time()
                text = transcribe(path)
                print("TIMING heard in %.1f s: %s" % (time.time() - t0, text[:60]), flush=True)
        except Exception as e:
            print("LISTEN ERROR:", e, flush=True)
            time.sleep(5)
        finally:
            listen_lock.release()
        if text and NAME_RE.search(text):
            try:
                answer_and_say(text)
                converse()
            except Exception as e:
                print("ANSWER ERROR:", e, flush=True)


LISTEN_SECONDS = 6                     # how long she listens after Talk is pressed
MIC_DEVICE = "plughw:wm8960soundcard"  # the HAT's sound card, as aplay -l names it; the 5 second test through it worked
LISTEN_FILE = "/tmp/al_heard.wav"
listen_lock = threading.Lock()


def record_clip(path=None, seconds=None):
    """Record from the HAT's two microphones into a wav file."""
    subprocess.run(["arecord", "-q", "-D", MIC_DEVICE, "-f", "S16_LE", "-r", "16000", "-c", "2",
                    "-d", str(seconds or LISTEN_SECONDS), path or LISTEN_FILE],
                   check=True, timeout=(seconds or LISTEN_SECONDS) + 10)


def transcribe(path=None):
    """Turn the recording into words, with the same ElevenLabs account that gives her voice."""
    key = header_value("xi-api-key")
    with open(path or LISTEN_FILE, "rb") as f:
        r = requests.post("https://api.elevenlabs.io/v1/speech-to-text", headers={"xi-api-key": key},
                          data={"model_id": "scribe_v1"}, files={"file": ("clip.wav", f, "audio/wav")}, timeout=60)
    if not r.ok:
        raise RuntimeError("the listening service said %s: %s" % (r.status_code, r.text[:160]))
    return (r.json().get("text") or "").strip()


def listen_once():
    """Listen for a few seconds, turn what was said into words, and answer it out loud like a typed message.
    Returns (what to send back, status). Her eyes brighten while she listens, so people can see she is."""
    if not listen_lock.acquire(blocking=False):
        return {"error": "She is already listening. Just speak to her."}, 409
    try:
        write_eyes(boost=True)
        try:
            with speak_lock:                 # she does not talk over herself, and does not hear herself
                try:
                    record_clip()
                except Exception as e:
                    return {"error": "I could not use the microphones: " + str(e)[:160]}, 502
        finally:
            write_eyes()
        try:
            heard = transcribe()
        except Exception as e:
            return {"error": str(e)[:200]}, 502
        if not heard:
            return {"heard": "", "reply": ""}, 200
        try:
            reply = al.get_al_reply(context_for(heard))
        except Exception as e:
            return {"error": str(e)[:200], "heard": heard}, 502
        state["history"].append('They said "%s" and you said "%s".' % (heard, reply))
        state["log"] += [{"who": "you", "text": heard}, {"who": "al", "text": reply}]
        speak_async(reply)
        return {"heard": heard, "reply": reply}, 200
    finally:
        listen_lock.release()


@app.post("/api/listen")
def listen():
    payload, status = listen_once()
    return jsonify(payload), status


@app.post("/api/photo")
def photo():
    f = request.files.get("photo")
    caption = str(request.form.get("caption", ""))[:200]
    if not f:
        return jsonify(error="no photo"), 400
    mt = f.mimetype
    if mt not in ("image/jpeg", "image/png", "image/gif", "image/webp"):
        return jsonify(error="please use a JPEG, PNG, GIF or WebP photo"), 415
    raw = f.read()
    if len(raw) > 4_000_000:
        return jsonify(error="that photo is too large, please use one under 4 MB"), 413
    key = header_value("x-api-key")
    if not key:
        return jsonify(error="could not find the key line in al.py"), 501
    text = "Here is a photo someone is sharing with you." + (" They say: " + caption + "." if caption else "")
    try:
        r = requests.post(
            "https://api.anthropic.com/v1/messages",
            headers={
                "x-api-key": key,
                "anthropic-version": "2023-06-01",
                "anthropic-workspace-id": al.ANTHROPIC_WORKSPACE_ID,
                "content-type": "application/json",
            },
            json={
                "model": "claude-sonnet-5",
                "max_tokens": 300,
                "system": al.AL_SYSTEM_PROMPT + (PHOTO_NOTE_CHARACTER if state["persona"] else PHOTO_NOTE),
                "messages": [{"role": "user", "content": [
                    {"type": "image", "source": {"type": "base64", "media_type": mt,
                                                 "data": base64.b64encode(raw).decode()}},
                    {"type": "text", "text": text},
                ]}],
            },
            timeout=60,
        )
    except requests.RequestException as e:
        return jsonify(error=str(e)[:200]), 502
    if r.status_code != 200:
        return jsonify(error="photo service answered %d" % r.status_code), 502
    reply = "".join(b.get("text", "") for b in r.json().get("content", []) if b.get("type") == "text") or "Thank you for showing me that."
    state["history"].append("They showed you a photo and you said \"%s\"." % reply)
    state["log"].append({"who": "al", "text": reply})
    speak_async(reply)
    return jsonify(reply=reply)  # the photo itself is never saved


def my_address():
    """AL's address on the network, or None if she is not connected yet."""
    import socket
    probe = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
    try:
        probe.connect(("10.255.255.255", 1))  # sends nothing, only picks the network in use
        ip = probe.getsockname()[0]
        return None if ip.startswith("127.") else ip
    except OSError:
        return None
    finally:
        probe.close()


def address_words(ip):
    return "I am ready. To open my panel, go to " + " dot ".join(" ".join(part) for part in ip.split(".")) + " colon eight thousand."


def say_address_when_ready():
    """Once, after the Pi itself boots: tell whoever is standing there where to open the panel.
    Restarting only this program (for an update) stays quiet."""
    import time
    try:
        if float(open("/proc/uptime").read().split()[0]) > 600:   # the Pi has been up more than ten minutes
            return
    except (OSError, ValueError):
        pass
    for _ in range(60):
        ip = my_address()
        if ip:
            speak_async(address_words(ip), use_persona=False)
            return
        time.sleep(2)


if __name__ == "__main__":
    write_eyes()
    apply_prompt()
    threading.Thread(target=say_address_when_ready, daemon=True).start()
    threading.Thread(target=watch_motion, daemon=True).start()
    threading.Thread(target=watch_names, daemon=True).start()
    app.run(host="0.0.0.0", port=8000, threaded=True)
