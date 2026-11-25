#!/usr/bin/env python3
"""The owner's notes (written 2026-11-25, Dr. O's Guardian skills, item 6, the InfraGard half).

InfraGard shares its alerts with vetted members and publishes no public feed. So nothing from InfraGard reaches the Guardian on its own.
Her owner types or pastes a note into the panel, and she keeps it. That is all this is, and she says so.

Because member material often carries a handling mark (for example a TLP color), every note is kept OWNER ONLY by default:
  owner   shown on the owner's panel only. By voice she says how many notes there are and that they are on the panel, and never reads one.
  room    the owner has marked this note as fine to say out loud. She reads it, with its mark, and says it is a note the owner gave her.
The text is spoken as written, word for word. It is never handed to a model, so a note cannot change how she behaves.
She never says a note came from InfraGard unless the owner wrote that in the source label, and even then she says "you told me".
The log keeps the id, the mark and whether it was shareable, never the words.
"""
import json
import os
import re
import time

try:
    import al_chain
except ImportError:
    al_chain = None

HERE = os.path.dirname(os.path.abspath(__file__))
FILE = os.path.join(HERE, "inbox.json")
LOG_FILE = os.path.join(HERE, "inbox_log.jsonl")
MAX_NOTES = 50
MAX_TEXT = 1500
MAX_TITLE = 120
SHARE = ("owner", "room")
ASK_RE = re.compile(r"\b(?:read|tell me|what(?:'s| is| are)|any|show|check|give me) (?:me )?(?:my |the |your )?(?:member|partner|owner|inbox)\b|\binfragard (?:alerts?|notes?|messages?|reports?|bulletins?)\b|\bmy notes\b|\bnotes (?:i|you)(?: gave| have| kept)\b", re.I)


def _clean(s, n):
    s = re.sub(r"[\x00-\x08\x0b\x0c\x0e-\x1f]", "", str(s or ""))
    return s.strip()[:n]


def load(path=None):
    try:
        with open(path or FILE, encoding="utf-8") as f:
            d = json.load(f)
        return d if isinstance(d, list) else []
    except (OSError, ValueError):
        return []


def _save(items, path=None):
    with open(path or FILE, "w", encoding="utf-8") as f:
        json.dump(items, f)


def add(title, text, source="", mark="", share="owner", received="", path=None, log=None, now=None):
    """Adds one note. Raises ValueError with words for the owner."""
    now = time.time() if now is None else now
    title, text = _clean(title, MAX_TITLE), _clean(text, MAX_TEXT)
    if not title and not text:
        raise ValueError("Give the note a title or some words.")
    if share not in SHARE:
        share = "owner"
    items = load(path)
    if len(items) >= MAX_NOTES:
        raise ValueError("The notes box is full. Remove one you are done with first.")
    nid = "n%d" % (max([int(i["id"][1:]) for i in items] or [0]) + 1)
    note = {"id": nid, "title": title or text[:60], "text": text, "source": _clean(source, 40), "mark": _clean(mark, 20), "share": share, "received": _clean(received, 30), "t": int(now)}
    items.append(note)
    _save(items, path)
    if al_chain:
        try:
            al_chain.append(log or LOG_FILE, "added", {"id": nid, "mark": note["mark"], "share": share}, now=int(now))
        except OSError:
            pass
    return note


def remove(nid, path=None, log=None):
    items = load(path)
    keep = [i for i in items if i["id"] != nid]
    if len(keep) == len(items):
        return False
    _save(keep, path)
    if al_chain:
        try:
            al_chain.append(log or LOG_FILE, "removed", {"id": nid})
        except OSError:
            pass
    return True


def set_share(nid, share, path=None, log=None):
    if share not in SHARE:
        raise ValueError("share must be owner or room")
    items = load(path)
    for i in items:
        if i["id"] == nid:
            i["share"] = share
            _save(items, path)
            if al_chain:
                try:
                    al_chain.append(log or LOG_FILE, "share_set", {"id": nid, "share": share})
                except OSError:
                    pass
            return True
    return False


def view(path=None, log=None):
    ok, n = al_chain.verify(log or LOG_FILE) if al_chain else (True, 0)
    return {"notes": load(path), "max": MAX_NOTES, "max_text": MAX_TEXT, "log_ok": ok, "log_count": n}


def counts(path=None):
    items = load(path)
    return len(items), len([i for i in items if i["share"] == "room"])


def briefing_line(path=None):
    """One line for the briefing: how many notes, and the titles of those marked fine to say. None when there are none."""
    total, room = counts(path)
    if not total:
        return None
    titles = [i["title"] for i in load(path) if i["share"] == "room"][:3]
    s = "You gave me %d note%s." % (total, "" if total == 1 else "s")
    if titles:
        s += " Marked fine to say: " + "; ".join(titles) + "."
    if total > len(titles):
        s += " The rest are on my panel."
    return s


def wants(text):
    return bool(ASK_RE.search(text or ""))


def reply(text, path=None):
    """(spoken, shown) for 'any InfraGard alerts' or 'read my notes'. Always says what she is and is not."""
    if not wants(text):
        return None
    items = load(path)
    lead = "I do not see InfraGard alerts myself. I only have notes you gave me."
    if not items:
        s = lead + " There are none right now."
        return s, s
    room = [i for i in items if i["share"] == "room"][:3]
    s = lead + " You gave me %d note%s." % (len(items), "" if len(items) == 1 else "s")
    parts = []
    for i in room:
        parts.append("%s%s: %s" % ((i["mark"] + ", ") if i["mark"] else "", i["title"], i["text"] or "no more words"))
    if room:
        s += " Marked fine to say out loud: " + " ".join(parts)
    held = len(items) - len(room)
    if held:
        s += " %d more %s on my panel for you, and I do not read those out." % (held, "is" if held == 1 else "are")
    # the chat line is on a screen anyone may see, so it carries the same as she says: owner only notes appear as a count, never a title
    shown = s + ("\n\n" + "\n".join("- %s%s%s" % (i["title"], " [%s]" % i["mark"] if i["mark"] else "", " (you said: %s)" % i["source"] if i["source"] else "") for i in room) if room else "")
    return s, shown
