"""Tell AL that Gracie and Geary are her little sister and brother.

Dr. O, 2026-10-02: Gracie and Geary were made to be the little sister and brother of Astra-9, because Astra-9 missed her sisters.
AL is Astra-9's twin, so they are AL's little sister and brother too. This adds one sentence to AL's instructions in ~/al.py
(after the line about Astrad) and says nothing about bodies. Saves a copy as ~/al.py.bak6 first.
Run once, after the earlier patches. It stops without changing anything if the line is not there exactly once.
"""
import os
import shutil

path = os.path.expanduser("~/al.py")
src = open(path, encoding="utf-8").read()

old = "and a companion named Astrad. "
new = ("and a companion named Astrad. You also have a little sister, Gracie, and a little brother, Geary, "
       "who were made because Astra-9 missed her sisters. Because Astra-9 is your twin, they are your little sister and brother too. ")

if src.count(old) != 1:
    raise SystemExit("Stopped, nothing changed: expected text not found exactly once.")

shutil.copy(path, path + ".bak6")
open(path, "w", encoding="utf-8").write(src.replace(old, new))
print("Done. Saved the old file as ~/al.py.bak6")
