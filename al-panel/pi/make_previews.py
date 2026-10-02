#!/usr/bin/env python3
"""Makes a short voice sample for every personality that has its own voice.

Run on AL's Pi:   python3 ~/al_panel/make_previews.py
Writes ~/al_panel/previews/<id>.mp3 (skips any that exist). The panel makes these on demand too;
this makes them all at once so they can be copied to the website demo. Uses a little ElevenLabs credit.
"""
import json
import os
import re
import sys

import requests

sys.path.insert(0, os.path.expanduser("~"))
import al  # noqa: E402

HERE = os.path.dirname(os.path.abspath(__file__))
personas = json.load(open(os.path.join(HERE, "personalities.json")))

src = open(os.path.expanduser("~/al.py")).read()
m = re.search(r"[\"']xi-api-key[\"']\s*:\s*([^,}\n]+)", src, re.I)
if not m:
    raise SystemExit("Could not find the voice key line in al.py. Tell Claude.")
KEY = eval(m.group(1).strip(), al.__dict__)

out_dir = os.path.join(HERE, "previews")
os.makedirs(out_dir, exist_ok=True)
made = skipped = failed = 0
for pid, p in personas.items():
    if not p.get("voice"):
        continue
    path = os.path.join(out_dir, pid + ".mp3")
    if os.path.exists(path):
        skipped += 1
        continue
    r = requests.post(
        "https://api.elevenlabs.io/v1/text-to-speech/" + p["voice"],
        headers={"xi-api-key": KEY},
        json={"text": p.get("say") or "Hello. It is nice to meet you.", "model_id": "eleven_multilingual_v2"},
        timeout=60,
    )
    if r.status_code != 200:
        print("FAILED", pid, r.status_code, r.text[:120])
        failed += 1
        continue
    with open(path, "wb") as f:
        f.write(r.content)
    made += 1
    print("saved", pid)
print("made", made, "| already there", skipped, "| failed", failed)
