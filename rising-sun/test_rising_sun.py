import json, os, sys
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import sunrise, morning

bad = []
def check(name, ok):
    print(("ok   " if ok else "FAIL ") + name)
    if not ok: bad.append(name)

check("starts dark", sunrise.color_at(0) == (0, 0, 0))
check("ends daylight", sunrise.color_at(1) == (255, 235, 200))
prev = -1
mono = True
for i in range(101):
    r, g, b = sunrise.color_at(i / 100)
    if r + g + b < prev: mono = False
    prev = r + g + b
check("never gets darker on the way up", mono)
check("out of range input is held", sunrise.color_at(-1) == (0, 0, 0) and sunrise.color_at(9) == (255, 235, 200))

said = []
r = morning.morning(said.append, lambda: "check my calendar", lambda t: "cal")
check("calendar choice answered", r == "calendar" and said[-1] == "cal")
said.clear(); morning.morning(said.append, lambda: "good morning human", lambda t: "x")
check("default greeting uses her words", said[0] == "Good morning, human.")
said.clear(); r = morning.morning(said.append, lambda: "the news please", lambda t: "x")
check("news introduces Above the Fold", r == "news" and "Above the Fold" in said[-1])
check("silence is handled", morning.choice("") == "nothing")
text = open(os.path.join(os.path.dirname(os.path.abspath(__file__)), "personas.json")).read()
check("each fairy has only Dr. O's written Court text, no invented drinks or hometowns", all("keeper of the Hearth" in json.loads(text)["velvet"]["backstory"] and json.loads(text)[k]["backstory"].strip() != "" for k in ("velvet",)) and "drink" not in json.loads(text)["ember"]["backstory"].lower())
sys.exit(1 if bad else 0)
