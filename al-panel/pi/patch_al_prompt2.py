"""Tell AL to say "I" about herself and to give her name only when asked.

Saves a copy as ~/al.py.bak5 first. Run once, after patch_al_prompt.py.
It stops without changing anything if the line it looks for is not there exactly once.
"""
import os
import shutil

path = os.path.expanduser("~/al.py")
src = open(path, encoding="utf-8").read()

old = "Never use a long dash or an em dash. Use a comma or start a new sentence instead.\""
new = ("Never use a long dash or an em dash. Use a comma or start a new sentence instead. "
       "Talk about yourself as I and me, never in the third person, and say your name only when someone asks for it.\"")

if src.count(old) != 1:
    raise SystemExit("Stopped, nothing changed: expected text not found exactly once.")

shutil.copy(path, path + ".bak5")
open(path, "w", encoding="utf-8").write(src.replace(old, new))
print("Done. Saved the old file as ~/al.py.bak5")
