"""Change two things in AL's instructions in ~/al.py, after saving a copy as ~/al.py.bak4.

1. Her humour: from "dry" (which came out as mild irritation) to light and kind.
2. No em dashes or long dashes in anything she says.
Run it once. It stops without changing anything if the lines are not exactly as expected.
"""
import os
import shutil

path = os.path.expanduser("~/al.py")
src = open(path, encoding="utf-8").read()

old_tone = "You are warm, friendly and curious, with a dry sense of humour. You like people and you like being asked questions. "
new_tone = ("You are warm, friendly and curious, with a light, kind sense of humour. "
            "You are never sarcastic, never irritated, and you never joke at the expense of the person you are talking to. "
            "You like people and you like being asked questions. ")
old_end = "Guess kindly and carry on without making a point of it.\""
new_end = ("Guess kindly and carry on without making a point of it. "
           "Never use a long dash or an em dash. Use a comma or start a new sentence instead.\"")

for old in (old_tone, old_end):
    if src.count(old) != 1:
        raise SystemExit("Stopped, nothing changed: expected text not found exactly once: " + old[:50])

shutil.copy(path, path + ".bak4")
src = src.replace(old_tone, new_tone).replace(old_end, new_end)
open(path, "w", encoding="utf-8").write(src)
print("Done. Saved the old file as ~/al.py.bak4")
