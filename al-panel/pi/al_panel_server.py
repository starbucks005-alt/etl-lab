#!/usr/bin/env python3
"""AL panel server. Runs on AL's Pi.

Serves the panel page and the small API behind its buttons. It reuses the
functions already in ~/al.py, so it needs no keys of its own beyond the ones
al.py already holds.

Run:   python3 ~/al_panel/al_panel_server.py
Open:  http://<AL's address>:8000   (from a phone or laptop on the same network)
"""
import base64
import json
import os
import re
import sys
import threading

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

state = {"color": "#1fb7c9", "brightness": 40, "accent": "robot", "skills": [], "persona": None, "history": [], "log": []}
speak_lock = threading.Lock()
app = Flask(__name__)


def apply_prompt():
    extra = " ".join(SKILL_TEXT[s] for s in state["skills"])
    persona = PERSONAS.get(state["persona"]) if state["persona"] else None
    skills = (" Skills you have: " + extra if extra else "")
    # A character is given only its own text. It is never told it is sharing a body with AL,
    # and AL is never told about the characters.
    al.AL_SYSTEM_PROMPT = (persona["prompt"] + skills) if persona else (BASE_PROMPT + skills)


def write_eyes():
    c = state["color"].lstrip("#")
    level = MAX_LEVEL * (state["brightness"] / 100.0)
    data = {"r": int(c[0:2], 16), "g": int(c[2:4], 16), "b": int(c[4:6], 16), "level": round(level, 3)}
    tmp = EYES_FILE + ".tmp"
    with open(tmp, "w") as f:
        json.dump(data, f)
    os.replace(tmp, EYES_FILE)


def speak_async(text):
    def run():
        with speak_lock:
            try:
                persona = PERSONAS.get(state["persona"]) if state["persona"] else None
                al.AL_VOICE_ID = (persona or {}).get("voice") or VOICES[state["accent"]]
                al.speak(text)
            except Exception as e:  # keep the server alive if sound fails
                print("SPEAK ERROR:", e, flush=True)
    threading.Thread(target=run, daemon=True).start()


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
                   personas=len(PERSONAS), log=state["log"][-40:])


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
    note = ("Now speaking as " + PERSONAS[pid]["name"] + ".") if pid else "Back to AL."
    state["log"] += [{"who": "al", "text": note}, {"who": "al", "text": reply}]
    state["history"].append('You said "%s".' % reply)
    speak_async(reply)
    return jsonify(ok=True, note=note, reply=reply)


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


def say_address_when_ready():
    """Once, after start-up: tell whoever is standing there where to open the panel."""
    import time
    for _ in range(60):
        ip = my_address()
        if ip:
            digits = " dot ".join(" ".join(part) for part in ip.split("."))
            speak_async("I am ready. To open my panel, go to " + digits + " colon eight thousand.")
            return
        time.sleep(2)


if __name__ == "__main__":
    write_eyes()
    apply_prompt()
    threading.Thread(target=say_address_when_ready, daemon=True).start()
    app.run(host="0.0.0.0", port=8000, threaded=True)
