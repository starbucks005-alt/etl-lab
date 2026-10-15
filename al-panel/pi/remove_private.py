"""Take one character out of the private list on this robot, 2026-10-15, Dr. O ("remove David").

Run it on the Pi, in ~/al_panel:   python3 remove_private.py David
It looks in every personalities_private*.json next to it for characters whose name or id contains that word, makes a backup copy
(the file name with .bak after it), takes them out, and says what it removed. Then restart her: sudo systemctl restart al-panel.service
Run it with no word to only list who is there. The characters are never in the public repository, only in those files on the robot."""
import glob
import json
import os
import shutil
import sys

here = os.path.dirname(os.path.abspath(__file__))
word = " ".join(sys.argv[1:]).strip().lower()
found = 0
for path in sorted(glob.glob(os.path.join(here, "personalities_private*.json"))):
    try:
        data = json.load(open(path))
    except (OSError, ValueError):
        print("could not read", path)
        continue
    if not isinstance(data, dict):
        continue
    hits = [k for k, v in data.items() if word and (word in k.lower() or word in str((v or {}).get("name", "")).lower())]
    for k, v in data.items():
        print("%s: %s (%s)%s" % (os.path.basename(path), k, (v or {}).get("name", ""), "   <- will be removed" if k in hits else ""))
    if hits:
        shutil.copy(path, path + ".bak")
        for k in hits:
            del data[k]
        json.dump(data, open(path, "w"), indent=2)
        found += len(hits)
if word:
    print("removed %d. A backup of each changed file is next to it, ending .bak." % found if found else "nobody matched that word, nothing changed.")
