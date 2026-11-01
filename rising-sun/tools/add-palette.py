#!/usr/bin/env python3
"""Puts the Palette menu on the box panel (rising-sun/box-panel.html), the same menu and the same 26 palettes as the robot panel.
Dr. O, 2026-11-01: "and do the palette".

It reuses al-panel/pi/palette_menu.py, which reads good-company/gc-skin.css and gc-skin.js, so the box panel never drifts from the
robot panel. Safe to run twice. Run:  python3 tools/add-palette.py
"""
import importlib.util
import os

HERE = os.path.dirname(os.path.abspath(__file__))
PM = os.path.join(HERE, "..", "..", "al-panel", "pi", "palette_menu.py")
spec = importlib.util.spec_from_file_location("palette_menu", PM)
pm = importlib.util.module_from_spec(spec)
spec.loader.exec_module(pm)

PAGE = os.path.join(HERE, "..", "box-panel.html")
src = open(PAGE, encoding="utf-8").read()
new = pm.add_palette(src, "Box panel", ["#35806f", "#28527a", "#f4f3ee"])
if new == src:
    print("box-panel.html already has the Palette menu")
else:
    # the Palette button sits at the right of the header. There is no Dark/Light button: a palette decides light or dark itself.
    new = new.replace(".themebtn{margin-left:auto;", ".themebtn{", 1)
    new = new.replace('<span class="palwrap">', '<span class="palwrap" style="margin-left:auto">', 1)
    open(PAGE, "w", encoding="utf-8").write(new)
    print("added the Palette menu to box-panel.html,", len(pm.SKINS), "palettes, weakest text pair %.2f:1" % min(pm.WORST.values()))
