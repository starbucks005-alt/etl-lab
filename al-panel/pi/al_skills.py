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
