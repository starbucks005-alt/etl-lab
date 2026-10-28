#!/usr/bin/env python3
"""Make A.L.I.C.E.'s own panel page from the shared one.

Dr. O, 2026-10-28: "this panel is all about Astra, eyes, modes, etc. ALICE is just ALICE".
Reads ../index.html (Astra-9 Lite's page, left as it is) and writes ../index_alice.html:
no mode picker, eye colour, accent, name, skills or personalities, no Astra photos or
text. The sections she keeps are talking to her, photos and files, people and voices she
knows, what she does when someone walks up, and the shut down button. The hidden parts
stay in the page, out of sight, because the page's own script looks for them by name.

Run from anywhere:  python3 make_alice_page.py
The server serves index_alice.html when that file is beside it, and index.html otherwise.
"""
import os
import re

HERE = os.path.dirname(os.path.abspath(__file__))
SRC = os.path.join(HERE, "..", "index.html")
OUT = os.path.join(HERE, "..", "index_alice.html")

s = open(SRC, encoding="utf-8").read()

# the photo (a long data address) goes; the empty frame stays so the page's script finds it
s = re.sub(r'src="data:image/webp;base64,[^"]*"', 'src=""', s)


# A.L.I.C.E.'s colours, taken from her picture (Dr. O, 2026-10-28): warm grey wall, bronze metal, near-black hair and suit.
# Every text pair was checked to at least 4.5 to 1 in both light and dark.
LIGHT = ("--bg:#e6e3de;--panel:#f6f4f0;--line:#d4cfc5;--line2:#bdb6a8;--ink:#15130f;--text:#3d382f;--mute:#665f53;"
         "--accent:#7d5a20;--accent-bg:#efe3cc;--status:#5a4a2e;--status-bg:#e9e1d2;--note:#5a4a2e;--note-bg:#e9e1d2;"
         "--muted-dot:#8a8272;--night:#121110;--field:#ffffff;--on-status:#ffffff;--on-accent:#ffffff;")
DARK = ("--bg:#121110;--panel:#1c1a17;--line:#34302a;--line2:#4a443b;--ink:#f1ece3;--text:#cfc7b8;--mute:#9a917f;"
        "--accent:#cf9f4f;--accent-bg:#3a2d17;--status:#d9bd85;--status-bg:#2b2418;--note:#d9bd85;--note-bg:#2b2418;"
        "--muted-dot:#9a917f;--night:#0a0908;--field:#262320;--on-status:#1a1408;--on-accent:#1a1408;")
PALETTE = (":root{%s}\n:root[data-theme=\"dark\"]{%s}\n"
           "@media (prefers-color-scheme: dark){:root:not([data-theme=\"light\"]){%s}}\n") % (LIGHT, DARK, DARK)

HIDE = ("#modeCard,#eyesCard,#voiceCard,#nameCard,#skillsCard,#personaCard,"
        ".hero,.demo,.tab,.sub,#starters,#sistersRow,label:has(#wEyes){display:none !important}")
s = s.replace("</style>", PALETTE + HIDE + "\n</style>", 1)

# what the page says at the top
s = s.replace("<title>Astra-9 Lite Companion Panel | Emerging Technologies Laboratory</title>",
              "<title>A.L.I.C.E. Panel | Emerging Technologies Laboratory</title>")
s = s.replace("<h1>Meet <em>Astra-9 Lite</em>, a companion you can shape</h1>",
              "<h1>A.L.I.C.E.</h1>")
# a stand-in picture until her real one is finished (Dr. O, 2026-10-28); the Astra hero stays hidden
# if the picture file is missing (on the Pi, where only the page and the server are copied) the figure hides itself
PIC = ('<figure class="alicepic"><img src="images/alice-placeholder_v1.jpg" '
       'alt="Concept art of A.L.I.C.E., seated with her arms around her knees." '
       'style="width:100%;max-width:760px;height:auto;display:block;border-radius:12px;border:1px solid var(--line)" '
       'onerror="this.closest(\'figure\').style.display=\'none\'">'
       '<figcaption style="font-size:13px;color:var(--mute);margin-top:8px">Concept Art - A.L.I.C.E.</figcaption></figure>')
s = s.replace("<h1>A.L.I.C.E.</h1>", "<h1>A.L.I.C.E.</h1>\n  " + PIC, 1)
s = s.replace('<span class="tab">Astra-9 Lite, companion panel</span>', "")
s = s.replace("Open this panel from Astra-9 Lite to use this button.", "Open this panel from A.L.I.C.E. to use this button.")

# the sections she keeps lose their numbers
for old, new in (("<h2>6. Talk to Astra-9 Lite</h2>", "<h2>Talk to A.L.I.C.E.</h2>"),
                 ("<h2>7. Show her a photo or a file</h2>", "<h2>Show her a photo or a file</h2>"),
                 ("<h2>8. When someone walks up</h2>", "<h2>When someone walks up</h2>"),
                 ("<h2>9. Switching off</h2>", "<h2>Switching off</h2>")):
    s = s.replace(old, new)

# her first line on the page, and her footer
s = s.replace("'Hello. I am Astra-9 Lite, and you can call me Elle. Try changing my eyes, or ask me something.'",
              "'Hello. I am A.L.I.C.E. Ask me something.'")
s = s.replace("Astra-9 Lite is a physical companion from Emerging Technologies Laboratory. She is an android, not a person.",
              "A.L.I.C.E. is a robot from Emerging Technologies Laboratory. She is not a person.")

# every other mention
s = s.replace("her name, Elle or Astra", "her name, Alice")
s = s.replace("Astra-9 Lite's", "A.L.I.C.E.'s")
s = s.replace("Astra-9 Lite", "A.L.I.C.E.")
s = s.replace("Elle", "Alice")
s = s.replace("A.L.I.C.E..", "A.L.I.C.E.")


# ---- the Palette menu comes with ../index.html (palette_menu.py adds it there); only her own entry changes here ----
if 'id="palBtn"' not in s:
    raise SystemExit("index.html has no Palette menu yet: run  python3 palette_menu.py  first")
s = s.replace('"sw": ["#35806f", "#28527a", "#f4f3ee"]', '"sw": ["#7D5A20", "#5A4A2E", "#E6E3DE"]')
s = s.replace("</style>", "#themeBtn,#listenAzure{display:none !important}\n</style>", 1)   # her voice is ElevenLabs only (Dr. O, 2026-10-28)

open(OUT, "w", encoding="utf-8").write(s)
print("wrote", os.path.normpath(OUT), len(s), "bytes")
