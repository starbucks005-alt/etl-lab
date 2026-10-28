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


# ---- the Palette menu: the same 25 palettes as Good Company and My Echo ----------------------------------------------
# Read from Good Company's own files so they never drift: the colours from good-company/gc-skin.css, the swatches and
# the order from good-company/gc-skin.js. Each palette's names are mapped onto this page's names.
import json

GC = os.path.join(HERE, "..", "..", "good-company")
gc_css = open(os.path.join(GC, "gc-skin.css"), encoding="utf-8").read()
gc_js = open(os.path.join(GC, "gc-skin.js"), encoding="utf-8").read()
SKINS = re.findall(r"\{\s*key:'([a-z]+)',\s*label:'([^']+)',\s*swatch:\['(#[0-9A-Fa-f]{6})','(#[0-9A-Fa-f]{6})','(#[0-9A-Fa-f]{6})'\]", gc_js)
BLOCKS = {k: dict(re.findall(r"(--[a-z-]+)\s*:\s*([^;]+);", b)) for k, b in re.findall(r'\[data-skin="([a-z]+)"\]\s*\{(.*?)\}', gc_css, re.S)}


def rgb(h):
    h = h.strip().lstrip("#")
    return [int(h[i:i + 2], 16) for i in (0, 2, 4)]


def hexof(c):
    return "#%02x%02x%02x" % tuple(max(0, min(255, round(v))) for v in c)


def mix(a, b, t):
    """t of b into a"""
    x, y = rgb(a), rgb(b)
    return hexof([x[i] + (y[i] - x[i]) * t for i in range(3)])


def lum(h):
    c = [v / 255 for v in rgb(h)]
    c = [v / 12.92 if v <= .03928 else ((v + .055) / 1.055) ** 2.4 for v in c]
    return .2126 * c[0] + .7152 * c[1] + .0722 * c[2]


def ratio(a, b):
    x, y = sorted((lum(a), lum(b)), reverse=True)
    return (x + .05) / (y + .05)


def nudge(color, toward, backs, need=4.5):
    """Move color toward `toward` in small steps until it reads at `need` to 1 on every background in `backs`."""
    c = color
    for i in range(41):
        if all(ratio(c, b) >= need for b in backs):
            return c
        c = mix(color, toward, (i + 1) / 40)
    return c


def skin_css(key):
    b = BLOCKS[key]
    paper, panel, ink, dim = b["--paper"].strip(), b["--panel"].strip(), b["--ink"].strip(), b["--ink-dim"].strip()
    dark = lum(paper) < .2
    bg, card = (paper, panel) if dark else (panel, paper)
    text = nudge(mix(ink, dim, .15), ink, [card])
    mute = nudge(dim, ink, [card, bg])
    moss = b["--moss"].strip()
    # the accent is both a fill (primary buttons) and a text colour on the card and on its own tint; it has to read as both
    acc_bg = mix(card, b["--accent"].strip(), .14)
    accent = nudge(b["--accent"].strip(), ink, [card, acc_bg])
    on_acc = max((card, ink), key=lambda c: ratio(c, accent))
    status = nudge(moss, ink, [mix(card, moss, .14)])
    v = {"--bg": bg, "--panel": card, "--line": b["--line"].strip(), "--line2": mix(b["--line"].strip(), ink, .25),
         "--ink": ink, "--text": text, "--mute": mute, "--accent": accent, "--accent-bg": acc_bg, "--on-accent": on_acc,
         "--status": status, "--status-bg": mix(card, moss, .14), "--note": status, "--note-bg": mix(card, moss, .14),
         "--on-status": card, "--muted-dot": mute, "--night": paper if dark else ink,
         "--field": mix(card, ink, .06) if dark else card}
    worst = min(ratio(v["--ink"], v["--panel"]), ratio(v["--text"], v["--panel"]), ratio(v["--mute"], v["--panel"]),
                ratio(v["--mute"], v["--bg"]), ratio(v["--accent"], v["--panel"]), ratio(v["--on-accent"], v["--accent"]),
                ratio(v["--accent"], v["--accent-bg"]), ratio(v["--status"], v["--status-bg"]), ratio(v["--ink"], v["--bg"]))
    css = 'html:root[data-skin="%s"]{color-scheme:%s;%s}\n' % (key, "dark" if dark else "light", ";".join("%s:%s" % kv for kv in v.items()))
    return css, worst


SKIN_CSS, WORST = "", {}
for k, label, c1, c2, c3 in SKINS:
    css, w = skin_css(k)
    SKIN_CSS += css
    WORST[k] = round(w, 2)

MENU_CSS = """
.palwrap{position:relative;display:inline-block}
.skins{display:none;position:absolute;right:0;top:calc(100% + 6px);z-index:50;min-width:210px;max-height:70vh;overflow:auto;
  background:var(--panel);border:1px solid var(--line2);border-radius:10px;padding:6px;box-shadow:0 8px 28px rgba(0,0,0,.25)}
.skins.open{display:block}
.skin-opt{display:flex;align-items:center;gap:10px;width:100%;text-align:left;background:transparent;border:1px solid transparent;
  border-radius:8px;padding:8px 10px;color:var(--text);font:inherit;font-family:var(--mono);font-size:.78rem;letter-spacing:.12em;
  text-transform:uppercase;cursor:pointer}
.skin-opt:hover{color:var(--ink);border-color:var(--line)}
.skin-opt.on{color:var(--accent);border-color:var(--accent)}
.swatch{display:flex;gap:3px;flex:none}
.swatch i{width:12px;height:12px;border-radius:3px;display:block}
#themeBtn{display:none !important}
"""

EARLY = ("<script>try{var _k=localStorage.getItem('alice-skin');if(_k&&/^[a-z]+$/.test(_k)){"
         "document.documentElement.setAttribute('data-skin',_k);}}catch(e){}</script>")

OWN = ("A.L.I.C.E.", "#7D5A20", "#5A4A2E", "#E6E3DE")   # her own palette, from her picture
LIST = [{"key": "", "label": OWN[0], "sw": list(OWN[1:])}] + [{"key": k, "label": l, "sw": [a, b, c]} for k, l, a, b, c in SKINS]

MENU_JS = """
<script>
(function(){
  var LIST = %s;
  var btn = document.getElementById('palBtn'), host = btn.parentNode;
  var menu = document.createElement('div'); menu.className = 'skins'; menu.setAttribute('role','menu'); host.appendChild(menu);
  function cur(){ return document.documentElement.getAttribute('data-skin') || ''; }
  function mark(){ Array.prototype.forEach.call(menu.children, function(b){ b.classList.toggle('on', b.getAttribute('data-key') === cur()); }); }
  function shut(){ menu.classList.remove('open'); btn.setAttribute('aria-expanded','false'); }
  LIST.forEach(function(s){
    var b = document.createElement('button'); b.type = 'button'; b.className = 'skin-opt'; b.setAttribute('role','menuitem'); b.setAttribute('data-key', s.key);
    var sw = document.createElement('span'); sw.className = 'swatch';
    s.sw.forEach(function(c){ var i = document.createElement('i'); i.style.background = c; sw.appendChild(i); });
    b.appendChild(sw); b.appendChild(document.createTextNode(s.label));
    b.addEventListener('click', function(){
      if(s.key){ document.documentElement.setAttribute('data-skin', s.key); } else { document.documentElement.removeAttribute('data-skin'); }
      try{ if(s.key){ localStorage.setItem('alice-skin', s.key); } else { localStorage.removeItem('alice-skin'); } }catch(e){}
      mark(); shut();
    });
    menu.appendChild(b);
  });
  mark();
  btn.setAttribute('aria-haspopup','true'); btn.setAttribute('aria-expanded','false');
  btn.addEventListener('click', function(e){ e.stopPropagation(); btn.setAttribute('aria-expanded', menu.classList.toggle('open') ? 'true' : 'false'); });
  menu.addEventListener('click', function(e){ e.stopPropagation(); });
  document.addEventListener('click', shut);
  document.addEventListener('keydown', function(e){ if(e.key === 'Escape'){ shut(); } });
})();
</script>
""" % json.dumps(LIST)

BTN = ('<span class="palwrap"><button class="themebtn" id="palBtn" type="button">&#127912; Palette</button></span> ')
s = s.replace("</style>", SKIN_CSS + MENU_CSS + "</style>", 1)
s = s.replace("<style>", EARLY + "\n<style>", 1)
s = s.replace('<button class="themebtn" id="themeBtn"', BTN + '<button class="themebtn" id="themeBtn"', 1)
s = s.replace("</body>", MENU_JS + "</body>", 1)
print("palettes:", len(SKINS), "| weakest text pair in any palette: %.2f:1" % min(WORST.values()),
      "(%s)" % min(WORST, key=WORST.get))
bad = {k: v for k, v in WORST.items() if v < 4.5}
if bad:
    print("below 4.5:", bad)

open(OUT, "w", encoding="utf-8").write(s)
print("wrote", os.path.normpath(OUT), len(s), "bytes")
