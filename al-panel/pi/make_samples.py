#!/usr/bin/env python3
"""Makes one short sample clip for each of Astra-9's five voices.

Run on AL's Pi:   python3 ~/al_panel/make_samples.py
Writes ~/al_panel/audio/accent-<name>.mp3. Reuses the voice key from ~/al.py.
Uses a little ElevenLabs credit: five short sentences, once.
"""
import os
import re
import sys

import requests

sys.path.insert(0, os.path.expanduser("~"))
import al  # noqa: E402

VOICES = {
    "robot": ("weA4Q36twV5kwSaTEL0Q", "Hi, I am Astra-9 Lite. You can call me Elle. It is nice to meet you."),
    "american": ("lqgYrNyQrOY96N3mj3M9", "Hi, I am Astra-9 Lite. Call me Elle. It is great to meet you."),
    "swedish": ("oVXQ3H21hRI9OtM4YH5K", "Hello, I am Astra-9 Lite. Call me Elle. It is nice to meet you."),
    "british": ("k9kFjM4M02PYt2PvKMYq", "Hello, I am Astra-9 Lite. Do call me Elle. Lovely to meet you."),
    "indian": ("6qL48o1LBmtR94hIYAQh", "Hello, I am Astra-9 Lite. Please call me Elle. It is very nice to meet you."),
}

src = open(os.path.expanduser("~/al.py")).read()
m = re.search(r"[\"']xi-api-key[\"']\s*:\s*([^,}\n]+)", src, re.I)
if not m:
    raise SystemExit("Could not find the voice key line in al.py. Tell Claude.")
KEY = eval(m.group(1).strip(), al.__dict__)

out_dir = os.path.expanduser("~/al_panel/audio")
os.makedirs(out_dir, exist_ok=True)
for name, (vid, text) in VOICES.items():
    r = requests.post(
        "https://api.elevenlabs.io/v1/text-to-speech/" + vid,
        headers={"xi-api-key": KEY},
        json={"text": text, "model_id": "eleven_multilingual_v2"},
        timeout=60,
    )
    if r.status_code != 200:
        print("FAILED", name, r.status_code, r.text[:200])
        continue
    path = os.path.join(out_dir, "accent-" + name + ".mp3")
    with open(path, "wb") as f:
        f.write(r.content)
    print("saved", path, len(r.content), "bytes")
