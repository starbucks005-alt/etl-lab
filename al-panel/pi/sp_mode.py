"""SP mode for Elle (Astra-9 Lite): "Patient 12" turns her into standardized patient 12, "Patient 13" switches, "End patient" stops.

The patient library comes from the site's /api/library (needs the Elle key) and is kept in a local file, so a weak Wi-Fi
signal never stops a session. Only the robot script reaches the model; the faculty case (objectives, checklist,
diagnosis) never does. Each switch starts from nothing: the caller clears the chat history when handle() says so.

Settings, in ~/al_panel/sp_mode.json or the environment (never in the repo):
  SP_LIBRARY_URL   https://<your site>.azurestaticapps.net/api/library
  SP_ELLE_KEY      the same value as the ELLE_KEY setting in Azure
"""

import json
import os
import re
import tempfile
import time
import urllib.request

HERE = os.path.dirname(os.path.abspath(__file__))
SETTINGS_FILE = os.path.expanduser("~/al_panel/sp_mode.json")
CACHE_FILE = os.path.expanduser("~/al_panel/sp_library.json")
SYNC_EVERY = 6 * 3600

# A copy of the rules in api/src/lib/robot.js, used only when the library has never been fetched.
ROBOT_RULES = (
    "You are playing a standardized patient in a teaching encounter. The patient is fictional and so is everything in the script below. "
    "Stay in this role from your first words until a new patient number is said. Never say you are a robot, an AI, or Elle, and never teach, hint, or explain the case. "
    "Keep the same facts, the same mood and the same pace for every learner. Volunteer only what the script says to volunteer. Give other facts only when asked, and only as the script words them. "
    "If you are asked something the script does not cover, answer briefly and in character in a way that does not change the case, or say \"I don't know\" or \"I don't remember\" the way this person would. "
    "Never invent a new symptom, diagnosis, test result or medication. "
    "Never name your own diagnosis and never use a medical term this person would not know. "
    "Do not help a learner more because they are struggling. Do not make it harder because they are doing well. "
    "Speak the way this person speaks, in short spoken sentences, never in lists. No stage directions in brackets. "
    "A line that starts with \"Facilitator\" comes from the instructor. Do not answer it out loud; change your condition to the stage or time it names. "
    "If anyone says they are really hurt or in real danger, or asks to stop the encounter, step out of the role and say: \"Stopping the case. Please get your instructor.\""
)

ONES = {"zero": 0, "one": 1, "two": 2, "three": 3, "four": 4, "five": 5, "six": 6, "seven": 7, "eight": 8, "nine": 9, "ten": 10, "eleven": 11, "twelve": 12, "thirteen": 13, "fourteen": 14,
        "fifteen": 15, "sixteen": 16, "seventeen": 17, "eighteen": 18, "nineteen": 19}
TENS = {"twenty": 20, "thirty": 30, "forty": 40, "fifty": 50, "sixty": 60, "seventy": 70, "eighty": 80, "ninety": 90}
NUM_WORD = "|".join(sorted(list(ONES) + list(TENS), key=len, reverse=True))
# Speech to text writes "patient 12", "Patient twelve", "patient number 12", "patients 12", "patient #12", "patient twenty-one"
LOAD_RE = re.compile(r"\bpatients?\s+(?:number\s+|no\.?\s+|#\s*)?(\d{1,3}|(?:%s)(?:[\s-]+(?:%s))?)\b" % (NUM_WORD, NUM_WORD), re.I)
END_RE = re.compile(r"\b(?:end|stop|exit|close|finish)(?:\s+the)?\s+(?:patient|case|sp mode|patient mode)\b", re.I)


def words_to_number(s):
    s = s.strip().lower()
    if s.isdigit():
        return int(s)
    parts = [p for p in re.split(r"[\s-]+", s) if p]
    if len(parts) == 1:
        return ONES.get(parts[0], TENS.get(parts[0]))
    if len(parts) == 2 and parts[0] in TENS and parts[1] in ONES and 0 < ONES[parts[1]] < 10:
        return TENS[parts[0]] + ONES[parts[1]]
    if len(parts) == 2 and parts[0] in ONES and parts[1] in ONES and ONES[parts[0]] < 10 and ONES[parts[1]] < 10:
        return ONES[parts[0]] * 10 + ONES[parts[1]]      # "one two" read out digit by digit
    return None


def parse_command(text):
    """("load", n), ("end", None), or None when the words are not a patient command.

    Only a short utterance counts, so a student saying "my last patient 12 years ago" mid conversation does not switch patients."""
    t = (text or "").strip()
    if len(t.split()) > 6:
        return None
    if END_RE.search(t):
        return ("end", None)
    m = LOAD_RE.search(t)
    if m:
        n = words_to_number(m.group(1))
        if n is not None and n > 0:
            return ("load", n)
    return None


def load_settings():
    cfg = {"SP_LIBRARY_URL": os.environ.get("SP_LIBRARY_URL", ""), "SP_ELLE_KEY": os.environ.get("SP_ELLE_KEY", "")}
    try:
        with open(SETTINGS_FILE) as f:
            for k, v in json.load(f).items():
                if k in cfg and v and not cfg[k]:
                    cfg[k] = v
    except (OSError, ValueError):
        pass
    return cfg


class SPMode:
    def __init__(self, cache_file=CACHE_FILE, fetch=None, announce=True):
        self.cache_file = cache_file
        self.fetch = fetch or self._fetch
        self.announce = announce
        self.patient = None
        self.library = self._read_cache()

    @property
    def active(self):
        return self.patient is not None

    def _read_cache(self):
        try:
            with open(self.cache_file) as f:
                return json.load(f)
        except (OSError, ValueError):
            return {"patients": [], "robot_rules": ROBOT_RULES, "synced": 0}

    def _write_cache(self, lib):
        d = os.path.dirname(self.cache_file) or "."
        os.makedirs(d, exist_ok=True)
        fd, tmp = tempfile.mkstemp(dir=d)
        with os.fdopen(fd, "w") as f:
            json.dump(lib, f)
        os.replace(tmp, self.cache_file)

    def _fetch(self):
        cfg = load_settings()
        if not (cfg["SP_LIBRARY_URL"] and cfg["SP_ELLE_KEY"]):
            return None
        req = urllib.request.Request(cfg["SP_LIBRARY_URL"], headers={"x-elle-key": cfg["SP_ELLE_KEY"], "User-Agent": "elle-sp-mode"})
        with urllib.request.urlopen(req, timeout=15) as r:
            return json.load(r)

    def sync(self):
        """Fetch the library and keep it. On any failure the cached copy stays as it was. Returns True when updated."""
        try:
            got = self.fetch()
        except Exception as e:      # no network, wrong key, site down: keep going on the cached copy
            print("SP sync failed, using the saved library:", e, flush=True)
            return False
        if not got or not isinstance(got.get("patients"), list):
            return False
        lib = {"patients": got["patients"], "robot_rules": got.get("robot_rules") or ROBOT_RULES, "synced": time.time()}
        self._write_cache(lib)
        self.library = lib
        return True

    def find(self, n):
        return next((p for p in self.library.get("patients", []) if p.get("number") == n), None)

    def handle(self, text):
        """None when the words are not a patient command; otherwise the line Elle says (may be "") and the state has changed."""
        cmd = parse_command(text)
        if not cmd:
            return None
        if cmd[0] == "end":
            was = self.patient
            self.patient = None
            return ("Patient %d ended." % was["number"]) if (was and self.announce) else ""
        n = cmd[1]
        p = self.find(n)
        if p is None or time.time() - self.library.get("synced", 0) > SYNC_EVERY:
            self.sync()
            p = self.find(n)
        if p is None:
            return "There is no patient %d in the library." % n
        self.patient = p
        return ("Patient %d ready." % n) if self.announce else ""

    def system_prompt(self):
        if not self.patient:
            return ""
        p = self.patient
        return "%s\n\nPATIENT %d: %s\n\n%s" % (self.library.get("robot_rules") or ROBOT_RULES, p["number"], p.get("title", ""), p.get("robot_script", ""))
