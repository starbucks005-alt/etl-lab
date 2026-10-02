#!/usr/bin/env python3
"""Looks through the voices in AL's ElevenLabs account and matches them, by name, to personalities that have no voice yet.

Run on AL's Pi:   python3 ~/al_panel/find_voices.py
It only reads the list of voices (names and ids), changes nothing, and uses no credit.
Paste what it prints back to Claude. Voice names and ids are not secret.
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

voices, token = [], None
while True:
    r = requests.get("https://api.elevenlabs.io/v2/voices", headers={"xi-api-key": KEY},
                     params={"page_size": 100, **({"next_page_token": token} if token else {})}, timeout=60)
    if r.status_code != 200:
        raise SystemExit("The voice list failed: %d %s" % (r.status_code, r.text[:150]))
    j = r.json()
    voices += j.get("voices", [])
    token = j.get("next_page_token")
    if not j.get("has_more") or not token:
        break
print("Voices in the account:", len(voices))

words = lambda s: [w for w in re.findall(r"[a-z]+", s.lower()) if w not in ("dr", "ms", "mr", "the", "and", "of", "rph", "dpt", "md", "coach")]
need = {pid: p for pid, p in personas.items() if not p.get("voice")}
print("Personalities without a voice:", len(need))
print()
found = 0
for pid, p in need.items():
    ws = words(p["name"].split(" (")[0])
    hits = []
    for v in voices:
        vw = words(v.get("name", ""))
        if any(w in vw for w in ws if len(w) > 2):
            hits.append(v["name"] + " = " + v["voice_id"])
    if hits:
        found += 1
    print(pid, "|", p["name"].split(" (")[0], "|", (" ; ".join(hits[:3]) if hits else "no match"))
print()
print("matched", found, "of", len(need))
