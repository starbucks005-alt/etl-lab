"""The skills that remember and read for her, added 2026-10-15, Dr. O: a voice notebook with lists, a bench guide that reads steps one at a time, and a knowledge shelf.

Everything here works on plain text and plain files kept next to the server, so it can be tested without the robot. The server calls these from skills_reply()
only when the skill is installed. Nothing here is sent anywhere. Files it makes: notebook.json, shelf/*.txt. They are kept out of git.

The shelf answers only from the files on it, and the server checks the answer against them in the same way science mode checks it against papers."""
import json
import os
import re
import time

HERE = os.path.dirname(os.path.abspath(__file__))
NOTEBOOK_FILE = os.path.join(HERE, "notebook.json")
SHELF_DIR = os.path.join(HERE, "shelf")
SHELF_MAX_FILES = 30
SHELF_MAX_BYTES = 400_000
STOPWORDS = set("a an the of to in on at for and or is are was were be do does did i me my you your it its this that what where when who how which with from about any there their they them have has had can could would should will shall not no yes please tell say hey okay ok".split())


# ---------------------------------------------------------------- the notebook and lists
def _load(path, default):
    try:
        d = json.load(open(path))
        return d if isinstance(d, type(default)) else default
    except (OSError, ValueError):
        return default


def _save(path, data):
    tmp = path + ".tmp"
    with open(tmp, "w") as f:
        json.dump(data, f)
    os.replace(tmp, path)


def load_notebook():
    d = _load(NOTEBOOK_FILE, {})
    d.setdefault("notes", [])
    d.setdefault("lists", {})
    return d


def _stem(w):
    """A rough stem so dispose and disposal, gel and gels, meet. Not a real stemmer, only enough for matching a question to a file."""
    for suf in ("ation", "ing", "ed", "es", "al", "s", "e"):
        if w.endswith(suf) and len(w) - len(suf) >= 4:
            return w[:-len(suf)]
    return w


def _words(t):
    return {_stem(w) for w in re.findall(r"[a-z0-9']+", (t or "").lower()) if w not in STOPWORDS and len(w) > 1}


def _clean(t):
    return re.sub(r"\s+", " ", (t or "").strip().strip(".!?,;: ")).strip()


def _list_name(n):
    n = re.sub(r"\b(the|my|our|a)\b", " ", (n or "").lower())
    n = _clean(n)
    return re.sub(r"\s+list$", "", n) or "shopping"


def notebook_reply(text):
    """What she says when this was a notebook or list request, or None."""
    t = _clean(text)
    low = t.lower()
    if not low:
        return None
    nb = None

    def book():
        nonlocal nb
        if nb is None:
            nb = load_notebook()
        return nb

    m = re.match(r"^(?:hey \w+,? )?(?:please )?(?:remember|make a note|note|write down|jot down|keep in mind)(?: that| down| this)?[:,]? (.+)$", low)
    if m and len(m.group(1).split()) >= 2:
        book()["notes"].append({"t": int(time.time()), "text": _clean(t[m.start(1):])})
        _save(NOTEBOOK_FILE, nb)
        return "Okay, I have written that down."
    m = re.search(r"\badd (.+?) to (?:the |my |our )?(.+?)(?: list)?$", low)
    if m and re.search(r"\blist\b", low):
        item, name = _clean(m.group(1)), _list_name(m.group(2))
        book()["lists"].setdefault(name, []).append(item)
        _save(NOTEBOOK_FILE, nb)
        return "Added %s to the %s list." % (item, name)
    m = re.search(r"\b(?:remove|take|delete|cross) (.+?) (?:off|from|out of) (?:the |my |our )?(.+?)(?: list)?$", low)
    if m and re.search(r"\blist\b", low):
        item, name = _clean(m.group(1)), _list_name(m.group(2))
        items = book()["lists"].get(name, [])
        hit = [i for i in items if item in i.lower() or i.lower() in item]
        if not hit:
            return "I do not see %s on the %s list." % (item, name)
        items.remove(hit[0])
        _save(NOTEBOOK_FILE, nb)
        return "Okay, I took %s off the %s list." % (hit[0], name)
    m = re.search(r"\b(?:clear|empty|wipe) (?:the |my |our )?(.+?) list\b", low)
    if m:
        name = _list_name(m.group(1))
        if name in book()["lists"]:
            n = len(nb["lists"].pop(name))
            _save(NOTEBOOK_FILE, nb)
            return "Okay, I cleared the %s list, which had %d item%s." % (name, n, "" if n == 1 else "s")
        return "I do not have a %s list." % name
    if re.search(r"\bwhat lists do i have\b|\bwhich lists\b", low):
        names = sorted(book()["lists"])
        return ("You have these lists: " + ", ".join(names) + ".") if names else "You do not have any lists yet."
    m = re.search(r"\b(?:what'?s|what is|what are|read (?:me )?|tell me)\b.*?\b(?:on|in) (?:the |my |our )?(.+?) list\b", low) or re.search(r"\bread (?:me )?(?:the |my |our )?(.+?) list\b", low)
    if m:
        name = _list_name(m.group(1))
        items = book()["lists"].get(name, [])
        if not items:
            return "The %s list is empty." % name
        return "On the %s list: %s." % (name, ", ".join(items[:15]) + (", and %d more" % (len(items) - 15) if len(items) > 15 else ""))
    if re.search(r"\b(?:forget|delete|remove) (?:that|the last|my last) note\b", low):
        if book()["notes"]:
            gone = nb["notes"].pop()
            _save(NOTEBOOK_FILE, nb)
            return "Okay, I forgot the note about %s." % " ".join(gone["text"].split()[:6])
        return "You do not have any notes."
    if re.search(r"\b(?:what|which) notes\b|\bread (?:me )?my notes\b|\bwhat have i told you to remember\b", low):
        notes = book()["notes"][-5:]
        return ("Your latest notes: " + " Then, ".join(n["text"] for n in notes) + ".") if notes else "You do not have any notes yet."
    m = re.search(r"\b(?:where (?:is|are|did i put)|do you remember|what did i (?:say|tell you) about|what do you remember about|remind me about)\b (.+)$", low)
    if m:
        want = _words(m.group(1))
        if want:
            best = max(book()["notes"], key=lambda n: len(want & _words(n["text"])), default=None)
            if best and len(want & _words(best["text"])) >= max(1, len(want) // 2):
                return "You told me: %s." % best["text"]
            return "I do not have a note about that."
    return None


# ---------------------------------------------------------------- the bench guide
protocol = {"name": "", "steps": [], "i": -1, "offered": None}
DURATION_RE = re.compile(r"\b(\d+(?:\.\d+)?)\s*(seconds?|secs?|minutes?|mins?|hours?|hrs?|h|min|s)\b", re.I)


def parse_steps(text):
    """Steps from a text: numbered lines, then bullets, then paragraphs, then sentences. At most 80."""
    lines = [l.strip() for l in (text or "").splitlines() if l.strip()]
    numbered = [re.sub(r"^\s*(?:step\s*)?\d+\s*[.):-]\s*", "", l, flags=re.I) for l in lines if re.match(r"^\s*(?:step\s*)?\d+\s*[.):-]\s*\S", l, re.I)]
    if len(numbered) >= 2:
        steps = numbered
    else:
        bullets = [re.sub(r"^\s*[-*•]\s*", "", l) for l in lines if re.match(r"^\s*[-*•]\s*\S", l)]
        if len(bullets) >= 2:
            steps = bullets
        else:
            paras = [p.strip() for p in re.split(r"\n\s*\n", text or "") if p.strip()]
            steps = paras if len(paras) >= 3 else [s.strip() for s in re.split(r"(?<=[.!?])\s+", " ".join(lines)) if len(s.strip()) > 8]
    return [re.sub(r"\s+", " ", s)[:400] for s in steps if s][:80]


def load_protocol(name, text):
    steps = parse_steps(text)
    if len(steps) < 2:
        return 0
    protocol.update(name=name, steps=steps, i=-1, offered=None)
    return len(steps)


def _seconds_in(step):
    m = DURATION_RE.search(step)
    if not m:
        return None
    n, u = float(m.group(1)), m.group(2).lower()
    return int(n * (3600 if u.startswith("h") else 60 if u.startswith("m") else 1))


def _say_step(timer_note=True):
    i, steps = protocol["i"], protocol["steps"]
    s = "Step %d of %d. %s" % (i + 1, len(steps), steps[i])
    sec = _seconds_in(steps[i])
    protocol["offered"] = sec
    if sec and timer_note and 5 <= sec <= 24 * 3600:
        s += " That step has a wait. Say timer and I will set it."
    return s


def protocol_reply(text, set_timer=None):
    """Only answers while a protocol is loaded, and only to short commands, so ordinary talk is never taken for a step command."""
    steps = protocol["steps"]
    if not steps:
        return None
    low = _clean(text).lower()
    words = low.split()
    if not low or len(words) > 8:
        return None
    if re.search(r"\b(?:stop|end|clear|finish|close|forget) (?:the |this )?(?:protocol|procedure|steps|guide)\b|\bwe are done with the protocol\b", low):
        name = protocol["name"] or "the protocol"
        protocol.update(name="", steps=[], i=-1, offered=None)
        return "Okay, I put away %s." % name
    if re.fullmatch(r"(?:okay |ok |alright )?(?:start|begin|read)(?: the)?(?: protocol| procedure| steps| first step)?(?: please)?|first step|from the (?:top|start|beginning)", low):
        protocol["i"] = 0
        return _say_step()
    if protocol["i"] < 0:
        return None
    if re.fullmatch(r"(?:okay |ok |alright |and )?(?:next|next step|continue|go on|done|finished|ready|go ahead)(?: please)?", low):
        if protocol["i"] >= len(steps) - 1:
            return "That was the last step. Say stop protocol when you are finished, or repeat to hear it again."
        protocol["i"] += 1
        return _say_step()
    if re.fullmatch(r"(?:okay |ok )?(?:back|go back|previous|previous step|last step)(?: please)?", low):
        protocol["i"] = max(0, protocol["i"] - 1)
        return _say_step()
    if re.fullmatch(r"(?:okay |ok )?(?:repeat|repeat that|say that again|again|what was that|pardon)(?: please)?", low):
        return _say_step()
    m = re.fullmatch(r"(?:go to |jump to |read )?step (\d{1,2})", low)
    if m and 1 <= int(m.group(1)) <= len(steps):
        protocol["i"] = int(m.group(1)) - 1
        return _say_step()
    if re.search(r"\bwhat step\b|\bhow many steps\b|\bwhere (?:am i|are we)\b", low):
        return "You are on step %d of %d." % (protocol["i"] + 1, len(steps))
    if re.fullmatch(r"(?:okay |ok |yes |yes please )?(?:set )?(?:a |the )?(?:timer|that timer)(?: please| for that)?|yes|yes please|set it", low) and protocol["offered"]:
        sec = protocol["offered"]
        if set_timer:
            set_timer(sec, "step %d" % (protocol["i"] + 1))
        protocol["offered"] = None
        return "Okay, a timer for %s." % _human(sec)
    return None


def _human(sec):
    if sec % 3600 == 0:
        n = sec // 3600
        return "%d hour%s" % (n, "" if n == 1 else "s")
    if sec % 60 == 0:
        n = sec // 60
        return "%d minute%s" % (n, "" if n == 1 else "s")
    return "%d seconds" % sec


# ---------------------------------------------------------------- the knowledge shelf
def _safe(name):
    base = re.sub(r"\.[A-Za-z0-9]{1,5}$", "", os.path.basename(name or "file"))
    return re.sub(r"[^A-Za-z0-9 _()\-]", "", base).strip()[:60] or "file"


def shelf_list():
    try:
        return sorted(f[:-4] for f in os.listdir(SHELF_DIR) if f.endswith(".txt"))
    except OSError:
        return []


def shelf_add(name, text):
    """(ok, message). Text only: a PDF has to be turned into text first."""
    if len(text.encode("utf-8")) > SHELF_MAX_BYTES:
        return False, "That file is too large for the shelf."
    if len(text.strip()) < 40:
        return False, "That file has almost nothing in it."
    os.makedirs(SHELF_DIR, exist_ok=True)
    n = _safe(name)
    if n not in shelf_list() and len(shelf_list()) >= SHELF_MAX_FILES:
        return False, "The shelf is full. Take something off it first."
    with open(os.path.join(SHELF_DIR, n + ".txt"), "w") as f:
        f.write(text)
    return True, n


def shelf_remove(name):
    try:
        os.remove(os.path.join(SHELF_DIR, _safe(name) + ".txt"))
        return True
    except OSError:
        return False


def shelf_chunks():
    out = []
    for n in shelf_list():
        try:
            body = open(os.path.join(SHELF_DIR, n + ".txt"), errors="replace").read()
        except OSError:
            continue
        paras = [re.sub(r"\s+", " ", p).strip() for p in re.split(r"\n\s*\n", body) if p.strip()]
        cur = ""
        for p in paras:
            if cur and len(cur) + len(p) > 900:
                out.append((n, cur))
                cur = ""
            cur = (cur + " " + p).strip()
            while len(cur) > 1400:                      # one long paragraph: cut it at a word
                cut = cur[:1200].rsplit(" ", 1)[0]
                out.append((n, cut))
                cur = cur[len(cut):].strip()
        if cur:
            out.append((n, cur))
    return out


def shelf_search(question, k=4, min_hits=2):
    """The best chunks for a question as numbered sources, or []. A chunk needs at least min_hits of the question's words, so ordinary chat is not matched to the shelf."""
    q = _words(question)
    if len(q) < 2:
        return []
    scored = []
    for n, c in shelf_chunks():
        hits = len(q & _words(c))
        if hits >= min(min_hits, len(q)):
            scored.append((hits / (len(q) ** 0.5), n, c))
    scored.sort(reverse=True)
    return [{"n": i + 1, "title": n, "journal": "your files", "year": "", "kind": "from the shelf", "text": c, "url": "the file called " + n}
            for i, (_, n, c) in enumerate(scored[:k])]


# ---------------------------------------------------------------- the daily briefing, 2026-10-16, Dr. O: a personal assistant mode
BRIEF_RE = re.compile(r"\b(what(?:'s| is| do i have)? (?:on )?(?:my )?(?:day|schedule|agenda|today)|what do i have (?:today|planned|on today)|(?:my|the|a) (?:daily )?(?:briefing|brief)\b|brief me|plan for today|my day)\b", re.I)
TODO_NAMES = ("to do", "todo", "to-do", "tasks", "task", "today")


def briefing_reply(text, clock_items=None, now=None):
    """The day in a few spoken sentences, from what she is actually holding: today's reminders, her timers and alarms, and the to do list. She has no calendar,
    and says so. Returns None when this was not a request for the day."""
    if not BRIEF_RE.search(text or ""):
        return None
    now = now or time.time()
    lt = time.localtime(now)
    hello = "Good morning." if lt.tm_hour < 12 else "Good afternoon." if lt.tm_hour < 17 else "Good evening."
    day = time.strftime("%A, %B ", lt) + str(lt.tm_mday)
    parts = []
    today = []
    for r in load_routines():
        at = r.get("next_at") or 0
        a = time.localtime(at)
        if at > now and (a.tm_year, a.tm_yday) == (lt.tm_year, lt.tm_yday):
            today.append((at, "%s at %s" % (_you(r.get("text", "")), _label(r.get("time") or time.strftime("%H:%M", a)))))
    for c in (clock_items or []):
        at = c.get("at") or 0
        a = time.localtime(at)
        if at > now and (a.tm_year, a.tm_yday) == (lt.tm_year, lt.tm_yday):
            today.append((at, "%s at %s" % ("an alarm" if c.get("kind") == "alarm" else "a timer", time.strftime("%I:%M %p", a).lstrip("0").lower())))
    today.sort()
    if today:
        parts.append("Still ahead today: " + "; ".join(x[1] for x in today[:6]) + ".")
    lists = load_notebook()["lists"]
    todo = []
    for name, items in lists.items():
        if name.lower() in TODO_NAMES and items:
            todo.extend(items)
    if todo:
        parts.append("On your to do list: " + ", ".join(todo[:6]) + (", and %d more" % (len(todo) - 6) if len(todo) > 6 else "") + ".")
    if not parts:
        parts.append("You have nothing set for the rest of today, and nothing on a to do list.")
    parts.append("I do not have your calendar, so tell me anything else to add.")
    return "%s It is %s. %s" % (hello, day, " ".join(parts))


# ---------------------------------------------------------------- the Guardian: a front-door greeter and front desk
# Added 2026-10-15, Dr. O. The ETL Guardians are the front desk robots the lab means to build. Elle can act as one now ("Hi, can I assist you? Where are you going?"),
# and the setup below is what a building fills in: its offices, forms, hours, who to tell, and what to say in an emergency. What visitors ask and she cannot answer is
# kept too, because that list is what the Guardians will need. She reads the directory exactly as written. She never opens a door, blocks anyone or claims authority.
GUARDIAN_FILE = os.path.join(HERE, "guardian.json")
VISITS_FILE = os.path.join(HERE, "visitors.json")
UNMET_FILE = os.path.join(HERE, "unmet_questions.json")
GUARDIAN_FIELDS = ("building", "greeting", "directory", "forms", "hours", "afterhours_start", "afterhours_end", "afterhours_line", "emergency", "notify_url")
EMERGENCY_RE = re.compile(r"\b(emergency|fire|on fire|smoke|someone (?:is |has )?(?:hurt|injured|collapsed|unconscious|bleeding)|call (?:911|the police|an ambulance|security)|need help now|bomb|gun|weapon|shooter|attack)\b", re.I)


def load_guardian():
    d = _load(GUARDIAN_FILE, {})
    return {k: str(d.get(k, ""))[:4000] for k in GUARDIAN_FIELDS}


def save_guardian(d):
    clean = {k: str(d.get(k, "")).strip()[:4000] for k in GUARDIAN_FIELDS}
    if clean["notify_url"] and not re.match(r"^https://", clean["notify_url"]):
        raise ValueError("The notice address has to start with https://")
    _save(GUARDIAN_FILE, clean)
    return clean


def parse_directory(text):
    """Lines of  Name | Where | Details | alias, alias  (the last two are optional)."""
    out = []
    for line in (text or "").splitlines():
        parts = [p.strip() for p in line.split("|")]
        if len(parts) >= 2 and parts[0] and parts[1]:
            out.append({"name": parts[0], "where": parts[1], "details": parts[2] if len(parts) > 2 else "",
                        "aliases": [a.strip() for a in (parts[3] if len(parts) > 3 else "").split(",") if a.strip()]})
    return out


def directory_find(query, directory):
    q = _words(query)
    if not q:
        return []
    scored = []
    for e in directory:
        names = [e["name"]] + e["aliases"]
        best = max((len(q & _words(n)) / max(1, len(_words(n))) for n in names), default=0)
        whole = any(n.lower() in (query or "").lower() for n in names)
        score = 1.0 if whole else best
        if score >= 0.5:
            scored.append((score, e))
    scored.sort(key=lambda x: -x[0])
    if not scored:
        return []
    top = scored[0][0]
    return [e for s, e in scored if s == top][:2]


def parse_forms(text):
    out = []
    for line in (text or "").splitlines():
        parts = [p.strip() for p in line.split("|")]
        if parts and parts[0]:
            out.append({"name": parts[0], "where": parts[1] if len(parts) > 1 else ""})
    return out


def is_after_hours(cfg, now=None):
    s, e = cfg.get("afterhours_start", ""), cfg.get("afterhours_end", "")
    if not (re.fullmatch(r"\d{1,2}:\d{2}", s or "") and re.fullmatch(r"\d{1,2}:\d{2}", e or "")):
        return False
    t = time.localtime(now) if now else time.localtime()
    cur = t.tm_hour * 60 + t.tm_min
    a = int(s.split(":")[0]) * 60 + int(s.split(":")[1])
    b = int(e.split(":")[0]) * 60 + int(e.split(":")[1])
    return (a <= cur < b) if a <= b else (cur >= a or cur < b)


def guardian_greeting(now=None):
    cfg = load_guardian()
    if is_after_hours(cfg, now):
        return cfg["afterhours_line"] or "Hello. The building is closed right now. Can I help you?"
    if cfg["greeting"]:
        return cfg["greeting"]
    b = cfg["building"]
    return ("Hello, welcome to %s. Can I assist you? Where are you going today?" % b) if b else "Hello, welcome. Can I assist you? Where are you going today?"


def visits():
    return _load(VISITS_FILE, [])


def log_visit(name, host, note=""):
    v = visits()
    v.append({"t": int(time.time()), "when": time.strftime("%Y-%m-%d %H:%M"), "name": _clean(name)[:60], "host": _clean(host)[:80], "note": note[:200]})
    _save(VISITS_FILE, v[-500:])


def visits_csv():
    rows = ["when,name,here to see,note"]
    for v in visits():
        rows.append(",".join('"%s"' % str(v.get(k, "")).replace('"', '""') for k in ("when", "name", "host", "note")))
    return "\n".join(rows) + "\n"


def note_unmet(question):
    d = _load(UNMET_FILE, {})
    q = _clean(question)[:120].lower()
    if q:
        d[q] = int(d.get(q, 0)) + 1
        _save(UNMET_FILE, dict(sorted(d.items(), key=lambda kv: -kv[1])[:100]))


def unmet():
    return _load(UNMET_FILE, {})


def guardian_reply(text, notify=None, now=None):
    """(spoken, shown) when this is something the Guardian handles, else None. notify(text) tells the front office, when a notice address is set."""
    t = _clean(text)
    low = t.lower()
    if not low:
        return None
    cfg = load_guardian()
    note = notify or (lambda msg: None)
    if EMERGENCY_RE.search(low):
        script = cfg["emergency"] or ""
        msg = "If anyone is in danger, call 911 now. " + (script + " " if script else "") + "I am telling the front office."
        note("EMERGENCY words heard at the front door: " + t)
        log_visit("", "", "EMERGENCY words heard: " + t)
        return msg, msg
    host = None
    m = re.search(r"\b(?:here to see|here for|to see|visiting|meeting with|have an appointment with|appointment with|here to meet|looking for)\s+((?:the |a |an )?.+)$", low)
    name = None
    mn = re.search(r"\b(?:my name is|i am|i'm|this is|it's|it is)\s+([a-z][a-z .'-]{1,40}?)(?=,| and | here| for| to see| i| i'm|$)", low)
    if mn and mn.group(1).split()[0] not in ("looking", "here", "going", "trying", "a", "an", "the", "from", "with", "lost", "new", "not", "sorry", "just"):
        name = " ".join(w.capitalize() for w in mn.group(1).split())
    if m and (name or re.search(r"\b(here to see|here for|visiting|meeting with|appointment|here to meet)\b", low)):
        host = _clean(t[m.start(1):]).strip(" .")
        found = directory_find(host, parse_directory(cfg["directory"]))
        who = ("Thank you, %s. " % name) if name else "Thank you. "
        msg = who + "I will let %s know you are here." % host
        if found:
            msg += " Directions: %s." % found[0]["where"].rstrip(".")
        log_visit(name or "", host)
        note("%s is here to see %s." % (name or "A visitor", host))
        return msg, msg
    m2 = re.search(r"\b(?:where(?:'s| is| are)|where can i find|how do i get to|how can i get to|which way (?:is|to)|directions to|take me to|i(?:'m| am) looking for|i need to find|i'm trying to find|i am trying to find)\s+(?:the |a |an )?(.+?)(?: please)?$", low)
    if m2:
        want = _clean(m2.group(1))
        found = directory_find(want, parse_directory(cfg["directory"]))
        if found:
            e = found[0]
            msg = "%s: %s." % (e["name"], e["where"].rstrip(".")) + ((" " + e["details"].rstrip(".") + ".") if e["details"] else "")
            return msg, msg
        note_unmet(t)
        msg = "I do not have that in my directory. Please ask at the front desk, and I will let them know you asked."
        return msg, msg
    if re.search(r"\b(forms?|paperwork|register|registration|sign in|sign-in|check in|get started|application|apply|visitor pass)\b", low) and len(low.split()) <= 14:
        forms = parse_forms(cfg["forms"])
        if forms:
            spoken = "I can help you get started. I have these forms: " + ", ".join(f["name"] for f in forms[:6]) + ". The links are on the panel."
            shown = spoken + "\n\n" + "\n".join("%s: %s" % (f["name"], f["where"]) for f in forms)
            return spoken, shown
        note_unmet(t)
        msg = "I do not have any forms here yet. Please ask at the front desk."
        return msg, msg
    if re.search(r"\b(hours|opening hours|what time do you (?:open|close)|when do you (?:open|close)|are you open|is the building open)\b", low):
        if cfg["hours"]:
            msg = "The hours are " + cfg["hours"].rstrip(".") + "."
            return msg, msg
        note_unmet(t)
        msg = "I do not have the hours here. Please ask at the front desk."
        return msg, msg
    return None


# ---------------------------------------------------------------- reminders, medication, the daily check-in and the focus partner
# Added 2026-10-15, Dr. O. One small scheduler. She is a helper with routines, not a medical device: she says when it is time, asks whether a dose was taken, writes
# the answer down, and can tell a family member by a notice if it was not confirmed. She gives no medical advice. The log and the schedule stay on the robot.
ROUTINES_FILE = os.path.join(HERE, "reminders.json")
ROUTINE_LOG_FILE = os.path.join(HERE, "routine_log.json")
CARE_FILE = os.path.join(HERE, "care.json")
MED_RE = re.compile(r"\b(pills?|medicine|medicines|medication|medications|meds|insulin|inhaler|tablets?|doses?|vitamins?|injection|eye drops|capsules?)\b", re.I)
DISTRESS_RE = re.compile(r"\b(fell|fallen|fall|hurt|pain|chest|dizzy|faint|can'?t breathe|cannot breathe|bleeding|scared|afraid|lonely|alone|sad|depressed|awful|terrible|not good|not well|bad|sick|help)\b", re.I)
URGENT_RE = re.compile(r"\b(fell|fallen|chest pain|can'?t breathe|cannot breathe|bleeding|unconscious|stroke|heart attack|emergency)\b", re.I)
pending_reminder = {"task": None, "t": 0.0}


def load_routines():
    return _load(ROUTINES_FILE, [])


def save_routines(items):
    _save(ROUTINES_FILE, items)


def load_care():
    return {"notify_url": str(_load(CARE_FILE, {}).get("notify_url", ""))}


def save_care(url):
    url = (url or "").strip()
    if url and not url.startswith("https://"):
        raise ValueError("The notice address has to start with https://")
    _save(CARE_FILE, {"notify_url": url})


def routine_log():
    return _load(ROUTINE_LOG_FILE, [])


def log_routine(kind, text, result, said=""):
    log = routine_log()
    log.append({"when": time.strftime("%Y-%m-%d %H:%M"), "kind": kind, "text": text[:120], "result": result, "said": said[:200]})
    _save(ROUTINE_LOG_FILE, log[-300:])


def next_occurrence(hhmm, repeat, now=None):
    """The next time (epoch seconds) at hh:mm that fits repeat ('daily', 'weekdays' or 'once')."""
    now = now or time.time()
    h, m = (int(x) for x in hhmm.split(":"))
    t = time.localtime(now)
    base = time.mktime((t.tm_year, t.tm_mon, t.tm_mday, h, m, 0, 0, 0, -1))
    for add in range(0, 9):
        cand = base + add * 86400
        wd = time.localtime(cand).tm_wday
        if cand > now + 1 and (repeat != "weekdays" or wd < 5):
            return cand
    return base + 86400


def add_routine(kind, text, hhmm, repeat, confirm=False, now=None, at=None):
    items = load_routines()
    rid = int((now or time.time()) * 1000)
    while any(i.get("id") == rid for i in items):          # two made in the same moment must not share an id
        rid += 1
    item = {"id": rid, "kind": kind, "text": text[:120], "time": hhmm, "repeat": repeat, "confirm": bool(confirm), "next_at": at or next_occurrence(hhmm, repeat, now)}
    items.append(item)
    save_routines(items)
    return item


def delete_routine(rid):
    items = load_routines()
    keep = [i for i in items if i.get("id") != rid]
    save_routines(keep)
    return len(keep) != len(items)


def _you(t):
    t = re.sub(r"\bmy\b", "your", t, flags=re.I)
    t = re.sub(r"\bme\b", "you", t, flags=re.I)
    return re.sub(r"\bi\b", "you", t, flags=re.I)


def _repeat_of(low):
    if re.search(r"\b(weekdays?|monday to friday|every weekday|on workdays)\b", low):
        return "weekdays"
    if re.search(r"\b(every ?day|daily|each day|every morning|every evening|every night|each morning|each night|each evening)\b", low):
        return "daily"
    return "once"


def _hhmm(epoch):
    t = time.localtime(epoch)
    return "%02d:%02d" % (t.tm_hour, t.tm_min)


def _label(hhmm):
    h, m = (int(x) for x in hhmm.split(":"))
    return "%d%s %s" % (h % 12 or 12, (":%02d" % m) if m else "", "am" if h < 12 else "pm")


def _task_of(rest):
    task = re.split(r"\s+(?:at|in|on|every|each|tomorrow|tonight|this|daily|weekdays?|before|after|around)\b", rest, maxsplit=1)[0]
    return _clean(_you(task))


def routine_reply(text, parse_time, parse_dur, add_timer, have=("reminders",), now=None):
    """What she says when this was a reminder, check-in or focus request, else None. parse_time(text) gives (epoch, label) or None. parse_dur(text) gives seconds or None.
    add_timer(seconds, label, spoken) sets a one-off timer."""
    t = _clean(text)
    low = t.lower()
    if not low:
        return None
    now = now or time.time()
    if pending_reminder["task"] and now - pending_reminder["t"] > 40:
        pending_reminder["task"] = None
    if pending_reminder["task"] and "reminders" in have:
        when, dur = parse_time(low), parse_dur(low)
        if when or dur:
            task = pending_reminder["task"]
            pending_reminder["task"] = None
            return _make_reminder(task, low, when, dur, parse_time, add_timer, now)
        if re.search(r"\b(never mind|nevermind|cancel|forget it)\b", low):
            pending_reminder["task"] = None
            return "Okay, I will not set it."
    if "reminders" in have or "checkin" in have:
        if re.search(r"\b(what|which) (?:reminders|check.?ins?)\b|\bdo i have any (?:reminders|check.?ins?)\b|\blist (?:my |the )?(?:reminders|check.?ins?)\b", low):
            items = load_routines()
            if not items:
                return "You do not have any reminders or check-ins set."
            bits = ["%s at %s%s" % (i["text"] if i["kind"] != "checkin" else "a check-in", _label(i["time"]), ", every day" if i["repeat"] == "daily" else ", on weekdays" if i["repeat"] == "weekdays" else "") for i in items[:5]]
            return "You have " + "; ".join(bits) + "."
        m = re.search(r"\b(?:cancel|delete|remove|stop|forget|clear)\b(?: all| my| the)?(?: of)? (?:my |the )?(.*?)(reminders?|check.?ins?)\b", low)
        if m:
            items = load_routines()
            kind_w = m.group(2).startswith("check")
            word = _clean(m.group(1))
            gone = [i for i in items if (i["kind"] == "checkin") == kind_w and (not word or word == "all" or _words(word) & _words(i["text"]))]
            if gone:
                save_routines([i for i in items if i not in gone])
                return "Okay, I cancelled %s." % ("it" if len(gone) == 1 else "all %d of them" % len(gone))
            return "I do not see one like that."
    if "reminders" in have and re.search(r"\bi (?:just |already )?(?:took|had|have taken|took my|have had)\b", low) and MED_RE.search(low):
        items = [i for i in load_routines() if i.get("confirm")]
        what = items[0]["text"] if items else "that"
        log_routine("medication", what, "taken", t)
        return "Thank you. I have noted that you took it."
    if "checkin" in have:
        m = re.search(r"\b(?:check on me|check in on me|check in with me|ask me how i am|ask how i am|ask me how i'm doing|daily check.?in)\b", low)
        if m:
            when = parse_time(low)
            hhmm = _hhmm(when[0]) if when else "09:00"
            for old in [i for i in load_routines() if i["kind"] == "checkin"]:
                delete_routine(old["id"])
            add_routine("checkin", "daily check-in", hhmm, "weekdays" if _repeat_of(low) == "weekdays" else "daily", confirm=True, now=now)
            return "Okay. I will ask how you are every %s at %s." % ("weekday" if _repeat_of(low) == "weekdays" else "day", _label(hhmm))
    if "focus" in have:
        m = re.search(r"\b(?:focus|work|study|concentrate)(?: with me)?(?: for)? (.+)$", low) or re.search(r"\bfocus (?:session|time)\b", low)
        if m:
            dur = parse_dur(low) or (25 * 60 if re.search(r"\bfocus (?:session|time)\b|\bpomodoro\b", low) else None)
            if dur and 300 <= dur <= 4 * 3600:
                add_timer(dur // 2, "focus halfway", "Halfway through. How is it going? Keep going, you are doing well.")
                add_timer(dur, "focus", "Time for a break. Well done. Stand up, stretch and drink some water.")
                return "Okay, a focus session of %s. I will check in halfway and tell you when it is time for a break." % _human(dur)
    if "reminders" in have:
        m = re.search(r"\bremind me (?:to |about |that )?(.+)$", low)
        if m:
            when, dur = parse_time(low), parse_dur(low)
            task = _task_of(m.group(1))
            if not task:
                return None
            if not (when or dur):
                pending_reminder.update(task=task, t=now)
                return "When should I remind you to %s?" % task
            return _make_reminder(task, low, when, dur, parse_time, add_timer, now)
    return None


def _make_reminder(task, low, when, dur, parse_time, add_timer, now):
    if dur and not when:
        add_timer(dur, "reminder", "Reminder: %s." % task)
        return "Okay, I will remind you in %s to %s." % (_human(dur) if dur % 60 == 0 else "%d seconds" % dur, task)
    hhmm = _hhmm(when[0])
    rep = _repeat_of(low)
    med = bool(MED_RE.search(task))
    add_routine("medication" if med else "reminder", task, hhmm, rep, confirm=med, now=now, at=when[0] if rep == "once" else None)     # a one-off keeps the exact day that was said
    day = " tomorrow" if (rep == "once" and "tomorrow" in str(when[1]).lower()) else ""
    return "Okay. I will remind you to %s at %s%s%s.%s" % (task, _label(hhmm), day, ", every day" if rep == "daily" else ", on weekdays" if rep == "weekdays" else "",
                                                           " I will ask whether you took it." if med else "")
