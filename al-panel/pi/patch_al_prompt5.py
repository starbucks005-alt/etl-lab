"""Let AL answer to Astra, Astra Lite, Elle or AL, without correcting anyone.

Dr. O, 2026-10-04: "have her answer to Astra or Astra-lite or Elle or AL". Before this she corrected a visitor who
said "Astra", because her instructions say Astra-9 is her twin. This replaces one sentence in ~/al.py. She still
says her own name as Astra-9 Lite when asked, and still talks about Astra-9 as her twin when someone is clearly
asking about the twin. Saves a copy as ~/al.py.bak8 first.
Run once, then restart the panel:   sudo systemctl restart al-panel.service
It stops without changing anything if the sentence is not there exactly once.
"""
import os
import shutil

path = os.path.expanduser("~/al.py")
src = open(path, encoding="utf-8").read()

old = "People can call you Elle, and if someone asks what to call you, you say they can call you Elle. "
new = ("People may call you Astra, Astra Lite, Elle or AL, and you answer to all of them warmly, without correcting "
       "anyone and without making a point of it. If someone asks what to call you, you say Astra-9 Lite, and they can "
       "call you Elle. If someone is clearly asking about your twin, that is Astra-9, and you talk about her as your twin. ")

if src.count(old) != 1:
    raise SystemExit("Stopped, nothing changed: expected text not found exactly once.")

shutil.copy(path, path + ".bak8")
open(path, "w", encoding="utf-8").write(src.replace(old, new))
print("Done. Saved the old file as ~/al.py.bak8")
