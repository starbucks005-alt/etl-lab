#!/usr/bin/env python3
"""Puts more Good Company companions into the box (rising-sun/box-lines.json), 2026-11-01, Dr. O: "add other companions to the box. include all the fairies".

Everything a companion says about herself or himself is copied word for word from Dr. O's own file (good-company/gc-friend.js, via gc-extract.js) or, for the fairies,
from rising-sun/personas.json and the roster. Nothing is written here except the two short fixed lines every box needs ("say that again", "enough for today").
Run:  node rising-sun/tools/gc-extract.js && python3 rising-sun/tools/add-companions.py        (safe to run again: it only adds)
"""
import json, os, re
HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.join(HERE, "..", "..")
LINES = os.path.join(ROOT, "rising-sun", "box-lines.json")
GC = json.load(open("/tmp/gc-all.json"))
d = json.load(open(LINES))
comps = d["companions"]
scenes = json.loads(json.dumps(comps["reggie"]["scenes"]))     # the same sounds and music for every companion

def clean(s):
    s = str(s).replace("—", ", ").replace("–", ", ")
    return re.sub(r"\s{2,}", " ", s).strip()

LINES2 = {"didnt_hear": "I did not catch that. Say it again?", "too_many": "That is enough for today. Come back tomorrow."}

# (key in the box, key in gc-friend.js, face file)
PEOPLE = [("arch", "arch"), ("sophia", "sofia"), ("nina", "cora"), ("kioko", "kioko"), ("julian", "julian"), ("winston", "winston"), ("viv", "viv"),
          ("aaron", "aaron"), ("theo", "theo"), ("cressida", "cressida"), ("dario", "dario"), ("nora", "nora"), ("zoe", "zoe"), ("rin", "rin"),
          ("sarah", "sarah"), ("olivia", "olivia")]
FACE_FROM = {"sophia": "sofia", "nina": "cora"}          # the face files made from their pictures are named for the box key

def build(key, gk):
    o = GC[gk]
    seg = [o.get(f) for f in ("form", "family", "knows", "now", "why", "underneath", "ritual", "pushes", "neverABother", "notTheAnswer", "humor") if o.get(f)]
    persona = {"name": o["name"], "full": o.get("full") or o["name"], "voice": ", ".join(o.get("voice") or []), "mood": o.get("mood", ""),
               "underneath": clean(" ".join(seg))[:5500]}
    for f in ("habit", "been", "hello"):
        if o.get(f): persona[f] = clean(o[f])
    if o.get("into"): persona["into"] = [clean(x) for x in o["into"]]
    if o.get("offLimits"): persona["kidTalk"] = clean(o["offLimits"])
    work = clean(o.get("work", ""))
    role = re.split(r"[,;:]| -- ", work)[0][:70] if work else ""
    face = "/rising-sun/box-faces/%s_v1.jpg" % key
    return {"display": o["name"], "voiceId": o["voiceId"], "role": role,
            "written": {"tagline": clean(o.get("full") or o["name"]), "bio": clean((o.get("premise", "") + " " + work).strip())[:700],
                        "background": clean(o.get("from", "")), "interests": [clean(x) for x in (o.get("into") or [])]},
            "lines": dict(LINES2), "scenes": json.loads(json.dumps(scenes)), "face": face, "persona": persona}

added = []
for key, gk in PEOPLE:
    if key in comps: continue
    comps[key] = build(key, gk); added.append(key)

# the fairies: their written life comes from the roster and personas.json, so they get no "written" block (that is what makes the box treat them as fairies)
P = json.load(open(os.path.join(ROOT, "rising-sun", "personas.json")))
FACES = {"blue": "blue_v1", "poppy": "poppy_v1", "ash": "ash_v2", "velvet": "velvet_v1", "ember": "ember_v1", "flint": "flint_v1"}
for key, face in FACES.items():
    if key in comps: continue
    comps[key] = {"display": P[key]["name"], "voiceId": P[key]["voice"], "lines": dict(LINES2) if key != "tansy" else {}, "scenes": json.loads(json.dumps(scenes)),
                  "face": "/rising-sun/box-faces/%s.jpg" % face}
    added.append(key)

json.dump(d, open(LINES, "w"), indent=2, ensure_ascii=False); open(LINES, "a").write("\n")
print("added", len(added), ":", ", ".join(added))
