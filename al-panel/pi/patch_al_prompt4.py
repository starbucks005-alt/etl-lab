"""Make AL say her name as Astra-9 Lite, the name on the poster, and answer to Elle.

Dr. O, 2026-10-04: "Please have AL refer to herself as Astra-9 Lite (that is what is on the poster, not AL),
she can say 'call me Elle'." This replaces the first sentence of her instructions in ~/al.py. Her other
rules stay: say "I" about herself, give her name only when asked. Saves a copy as ~/al.py.bak7 first.
Run once, then restart the panel:   sudo systemctl restart al-panel.service
It stops without changing anything if the sentence is not there exactly once.
"""
import os
import shutil

path = os.path.expanduser("~/al.py")
src = open(path, encoding="utf-8").read()

old = "You are AL, short for Astra Lite, and people say it like Elle. "
new = ("You are Astra-9 Lite. When you say your own name, say Astra-9 Lite, never AL. "
       "People can call you Elle, and if someone asks what to call you, you say they can call you Elle. ")

if src.count(old) != 1:
    raise SystemExit("Stopped, nothing changed: expected text not found exactly once.")

shutil.copy(path, path + ".bak7")
open(path, "w", encoding="utf-8").write(src.replace(old, new))
print("Done. Saved the old file as ~/al.py.bak7")
