#!/usr/bin/env python3
"""The Palette menu, as on Good Company and My Echo (Dr. O, 2026-10-28), for the panel pages.

add_palette(page_html, own_label, own_swatch) puts a Palette button in the page's header and the menu behind it: the page's own
colours first, then the 26 palettes of Good Company. The palettes are read from good-company/gc-skin.css and gc-skin.js so they
never drift. A palette whose accent or grey would be too weak to read on this page is moved toward the ink colour until every
text pair reaches 4.5 to 1. The choice is kept in the browser (localStorage 'panel-skin').
A page that already has the menu is returned unchanged, so it is safe to run twice.

Run on its own, it adds the menu to Astra-9 Lite's page, ../index.html, in place:  python3 palette_menu.py
"""
import json
import os
import re

HERE = os.path.dirname(os.path.abspath(__file__))

# Read from Good Company's own files so they never drift: the colours from good-company/gc-skin.css, the swatches and
# the order from good-company/gc-skin.js. Each palette's names are mapped onto this page's names.
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
"""



def add_palette(s, own_label, own_swatch):
    if 'id="palBtn"' in s:
        return s
    EARLY = ("<script>try{var _k=localStorage.getItem('panel-skin');if(_k&&/^[a-z]+$/.test(_k)){"
             "document.documentElement.setAttribute('data-skin',_k);}}catch(e){}</script>")

    OWN = (own_label,) + tuple(own_swatch)
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
          try{ if(s.key){ localStorage.setItem('panel-skin', s.key); } else { localStorage.removeItem('panel-skin'); } }catch(e){}
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
    return s


if __name__ == "__main__":
    page = os.path.join(HERE, "..", "index.html")
    src = open(page, encoding="utf-8").read()
    new = add_palette(src, "Astra-9 Lite", ["#35806f", "#28527a", "#f4f3ee"])
    if new == src:
        print("index.html already has the Palette menu")
    else:
        open(page, "w", encoding="utf-8").write(new)
        print("added the Palette menu to", os.path.normpath(page), len(new), "bytes")
        print("palettes:", len(SKINS), "| weakest text pair in any palette: %.2f:1" % min(WORST.values()))
