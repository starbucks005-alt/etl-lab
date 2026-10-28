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

HIDE = ("#modeCard,#eyesCard,#voiceCard,#nameCard,#skillsCard,#personaCard,"
        ".hero,.demo,.tab,.sub,#starters,#sistersRow,label:has(#wEyes){display:none !important}")
s = s.replace("</style>", HIDE + "\n</style>", 1)

# what the page says at the top
s = s.replace("<title>Astra-9 Lite Companion Panel | Emerging Technologies Laboratory</title>",
              "<title>A.L.I.C.E. Panel | Emerging Technologies Laboratory</title>")
s = s.replace("<h1>Meet <em>Astra-9 Lite</em>, a companion you can shape</h1>",
              "<h1>A.L.I.C.E.</h1>")
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

open(OUT, "w", encoding="utf-8").write(s)
print("wrote", os.path.normpath(OUT), len(s), "bytes")
