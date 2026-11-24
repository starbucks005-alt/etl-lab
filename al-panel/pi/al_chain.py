#!/usr/bin/env python3
"""A log that shows if anyone changed it (written 2026-11-24 for the Guardian's skills).

Each line records what happened, and carries a fingerprint (SHA-256) of the line before it. Change, remove or reorder any line and every
fingerprint after it stops matching, and verify() says exactly where. Used by network watch, asset watch and the latchkey, so the owner has a record
that holds up. It is a plain text file next to the program, one JSON line per event.
"""
import hashlib
import json
import os
import threading
import time

_lock = threading.Lock()
GENESIS = "0" * 64


def _digest(prev, body):
    return hashlib.sha256((prev + json.dumps(body, sort_keys=True, separators=(",", ":"))).encode("utf-8")).hexdigest()


def read(path):
    out = []
    try:
        with open(path, encoding="utf-8") as f:
            for line in f:
                line = line.strip()
                if line:
                    out.append(json.loads(line))
    except (OSError, ValueError):
        pass
    return out


def append(path, event, data=None, now=None):
    """Adds one event and returns the entry."""
    with _lock:
        rows = read(path)
        prev = rows[-1]["hash"] if rows else GENESIS
        body = {"n": len(rows) + 1, "t": int(now if now is not None else time.time()), "event": str(event), "data": data or {}}
        entry = dict(body, prev=prev, hash=_digest(prev, body))
        with open(path, "a", encoding="utf-8") as f:
            f.write(json.dumps(entry, sort_keys=True) + "\n")
        return entry


def verify(path):
    """(True, count) when every line checks out, else (False, the number of the first line that does not)."""
    prev = GENESIS
    rows = read(path)
    for i, r in enumerate(rows, 1):
        body = {k: r.get(k) for k in ("n", "t", "event", "data")}
        if r.get("prev") != prev or r.get("hash") != _digest(prev, body) or r.get("n") != i:
            return False, i
        prev = r["hash"]
    return True, len(rows)


def recent(path, count=50):
    return list(reversed(read(path)[-count:]))
