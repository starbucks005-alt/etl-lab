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

voices, seen = [], set()
def take(vs):
    for v in vs:
        if v.get("voice_id") and v["voice_id"] not in seen:
            seen.add(v["voice_id"])
            voices.append(v)

# Ask for the list two ways and combine them; either one alone can leave voices out.
token = None
while True:
    r = requests.get("https://api.elevenlabs.io/v2/voices", headers={"xi-api-key": KEY},
                     params={"page_size": 100, **({"next_page_token": token} if token else {})}, timeout=60)
    if r.status_code != 200:
        print("The newer voice list failed:", r.status_code, r.text[:120])
        break
    j = r.json()
    take(j.get("voices", []))
    token = j.get("next_page_token")
    if not j.get("has_more") or not token:
        break
n2 = len(voices)
r = requests.get("https://api.elevenlabs.io/v1/voices", headers={"xi-api-key": KEY}, timeout=60)
if r.status_code == 200:
    take(r.json().get("voices", []))
else:
    print("The older voice list failed:", r.status_code, r.text[:120])
print("Found by the newer list:", n2, "| added by the older list:", len(voices) - n2)
print("Voices in the account:", len(voices))

if "--list" in sys.argv:
    # Everything not already used by a personality, with its labels, so the right one can be picked by gender, accent and age.
    used = {p.get("voice") for p in personas.values() if p.get("voice")}
    rest = [v for v in voices if v["voice_id"] not in used]
    print("Not used by any personality yet:", len(rest))
    for v in sorted(rest, key=lambda v: v.get("name", "").lower()):
        lab = v.get("labels") or {}
        tags = ",".join(str(lab[k]) for k in ("gender", "accent", "age", "descriptive") if lab.get(k))
        print(v.get("name", "")[:60] + " [" + tags + "] = " + v["voice_id"])
    raise SystemExit(0)

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
