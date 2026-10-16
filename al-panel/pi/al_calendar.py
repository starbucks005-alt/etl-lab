"""Her calendar, read only, added 2026-10-16, Dr. O: "Auggie can check my calendar."

It works the way Auggie does: the owner publishes a calendar (Outlook: Settings, Calendar, Shared calendars, Publish a calendar, can view all details, ICS link) and pastes
the link on the panel once. She reads that feed. She cannot add, change or delete anything, and she cannot see anything the link does not show.

The link is private: anyone who has it can read the calendar. It is kept in calendar.json next to the server (kept out of git) and is never sent back to the page.

What it understands: one-time events, all-day events, and repeating events that are daily, weekly (with days), monthly (by date or by the first, second, ... or last weekday)
or yearly, with an end date or a count, with dates removed from the series, and with single occurrences that were moved. What it does not: time zones other than her own
(a time with a zone name is read as her own local time, which is right for an Eastern calendar read in Eastern time), and anything else exotic. When she cannot read the feed
she says so and does not guess.

Tested here against sample feeds only, as of 2026-10-16. Not yet against a real Outlook link."""
import calendar as _cal
import datetime as dt
import json
import os
import re
import time

HERE = os.path.dirname(os.path.abspath(__file__))
CAL_FILE = os.path.join(HERE, "calendar.json")
CACHE_SECONDS = 600
_cache = {"at": 0.0, "url": "", "events": [], "error": ""}


def load_feed():
    try:
        d = json.load(open(CAL_FILE))
        return {"url": str(d.get("url", ""))}
    except (OSError, ValueError):
        return {"url": ""}


def save_feed(url):
    url = (url or "").strip()
    if url.lower().startswith("webcal://"):
        url = "https://" + url[9:]
    if url and not url.lower().startswith("https://"):
        raise ValueError("The calendar link has to be the https address from Publish a calendar")
    tmp = CAL_FILE + ".tmp"
    with open(tmp, "w") as f:
        json.dump({"url": url}, f)
    os.replace(tmp, CAL_FILE)
    _cache.update(at=0.0, url="", events=[], error="")


# ---------------------------------------------------------------- reading the feed
def _unfold(text):
    out = []
    for ln in re.split(r"\r?\n", text or ""):
        if ln[:1] in (" ", "\t") and out:
            out[-1] += ln[1:]
        else:
            out.append(ln)
    return out


def _unescape(v):
    return v.replace("\\n", " ").replace("\\N", " ").replace("\\,", ",").replace("\\;", ";").replace("\\\\", "\\").strip()


def _parse_dt(v, allday_hint=False):
    """(naive local datetime, is_all_day). A trailing Z is read as UTC and converted to her local time."""
    m = re.match(r"^(\d{4})(\d{2})(\d{2})(?:T(\d{2})(\d{2})(\d{2})?(Z)?)?$", v.strip())
    if not m:
        return None, False
    y, mo, d = int(m.group(1)), int(m.group(2)), int(m.group(3))
    if m.group(4) is None:
        return dt.datetime(y, mo, d), True
    base = dt.datetime(y, mo, d, int(m.group(4)), int(m.group(5)), int(m.group(6) or 0))
    if m.group(7):
        epoch = _cal.timegm(base.timetuple())
        lt = time.localtime(epoch)
        base = dt.datetime(lt.tm_year, lt.tm_mon, lt.tm_mday, lt.tm_hour, lt.tm_min, lt.tm_sec)
    return base, False


def parse_ics(text):
    events, cur = [], None
    for ln in _unfold(text):
        if ln == "BEGIN:VEVENT":
            cur = {"exdates": []}
            continue
        if ln == "END:VEVENT":
            if cur and cur.get("start") and cur.get("summary") and cur.get("status") != "CANCELLED":
                events.append(cur)
            cur = None
            continue
        if cur is None or ":" not in ln:
            continue
        head, val = ln.split(":", 1)
        name = head.split(";")[0].upper()
        if name == "DTSTART":
            cur["start"], cur["allday"] = _parse_dt(val)
        elif name == "DTEND":
            cur["end"], _ = _parse_dt(val)
        elif name == "SUMMARY":
            cur["summary"] = _unescape(val)
        elif name == "LOCATION":
            cur["location"] = _unescape(val)
        elif name == "UID":
            cur["uid"] = val.strip()
        elif name == "STATUS":
            cur["status"] = val.strip().upper()
        elif name == "RRULE":
            cur["rrule"] = dict(p.split("=", 1) for p in val.split(";") if "=" in p)
        elif name == "EXDATE":
            for part in val.split(","):
                d, _ = _parse_dt(part)
                if d:
                    cur["exdates"].append(d)
        elif name == "RECURRENCE-ID":
            cur["recurrence_id"], _ = _parse_dt(val)
    return [e for e in events if e.get("start")]


# ---------------------------------------------------------------- repeating events
_DAYS = {"MO": 0, "TU": 1, "WE": 2, "TH": 3, "FR": 4, "SA": 5, "SU": 6}


def _nth_weekday(year, month, wd, n):
    if n > 0:
        first = dt.date(year, month, 1)
        day = 1 + (wd - first.weekday()) % 7 + 7 * (n - 1)
    else:
        last = dt.date(year, month, _cal.monthrange(year, month)[1])
        day = last.day - (last.weekday() - wd) % 7 + 7 * (n + 1)
    try:
        return dt.date(year, month, day) if 1 <= day <= _cal.monthrange(year, month)[1] else None
    except ValueError:
        return None


def _occurrences(ev, lo, hi, cap=2000):
    """Start times (naive local datetimes) of a repeating event that fall between lo and hi."""
    r = ev["rrule"]
    start = ev["start"]
    freq = r.get("FREQ", "")
    interval = max(1, int(r.get("INTERVAL", "1") or 1))
    count = int(r["COUNT"]) if r.get("COUNT", "").isdigit() else None
    until = None
    if r.get("UNTIL"):
        u, _ = _parse_dt(r["UNTIL"])
        until = (u + dt.timedelta(days=1)) if (u and len(r["UNTIL"]) == 8) else u
    byday = []
    for part in [p for p in r.get("BYDAY", "").split(",") if p]:
        m = re.match(r"^([+-]?\d)?([A-Z]{2})$", part)
        if m and m.group(2) in _DAYS:
            byday.append((int(m.group(1)) if m.group(1) else 0, _DAYS[m.group(2)]))
    tod = start.time()
    out, made, steps = [], 0, 0

    def accept(d):
        nonlocal made
        occ = dt.datetime.combine(d, tod)
        if occ < start:
            return True
        if until and occ > until:
            return False
        made += 1
        if count is not None and made > count:
            return False
        if lo <= occ <= hi and occ not in ev["exdates"]:
            out.append(occ)
        return occ <= hi

    if freq == "DAILY":
        d = start.date()
        while steps < cap and accept(d):
            d += dt.timedelta(days=interval)
            steps += 1
    elif freq == "WEEKLY":
        days = sorted({w for _, w in byday}) or [start.weekday()]
        week0 = start.date() - dt.timedelta(days=start.weekday())
        k = 0
        go = True
        while go and steps < cap:
            for w in days:
                d = week0 + dt.timedelta(weeks=k * interval, days=w)
                if not accept(d):
                    go = False
                    break
            k += 1
            steps += 1
    elif freq == "MONTHLY":
        y, mth = start.year, start.month
        go = True
        while go and steps < cap:
            dates = []
            if byday:
                for n, w in byday:
                    if n:
                        x = _nth_weekday(y, mth, w, n)
                        if x:
                            dates.append(x)
            else:
                md = int(r["BYMONTHDAY"]) if r.get("BYMONTHDAY", "").lstrip("-").isdigit() else start.day
                if md < 0:
                    md = _cal.monthrange(y, mth)[1] + 1 + md
                if 1 <= md <= _cal.monthrange(y, mth)[1]:
                    dates.append(dt.date(y, mth, md))
            for d in sorted(dates):
                if not accept(d):
                    go = False
                    break
            mth += interval
            while mth > 12:
                mth -= 12
                y += 1
            steps += 1
    elif freq == "YEARLY":
        y = start.year
        while steps < cap:
            try:
                d = dt.date(y, start.month, start.day)
            except ValueError:
                d = None
            if d and not accept(d):
                break
            y += interval
            steps += 1
            if y > hi.year + 1:
                break
    else:
        if lo <= start <= hi:
            out.append(start)
    return out


def expand(events, lo, hi):
    """Every occurrence between lo and hi (naive local datetimes), as dicts with start, end, allday, summary, location, soonest first."""
    moved = {}
    for e in events:
        if e.get("recurrence_id"):
            moved.setdefault(e.get("uid"), set()).add(e["recurrence_id"])
    out = []
    for e in events:
        length = (e["end"] - e["start"]) if e.get("end") else dt.timedelta(0)
        if e.get("rrule") and not e.get("recurrence_id"):
            starts = [s for s in _occurrences(e, lo - length, hi) if s not in moved.get(e.get("uid"), set())]
        else:
            starts = [e["start"]] if (lo - length) <= e["start"] <= hi else []
        for s in starts:
            if not ((s + length > lo) if length else (s >= lo)):      # it must overlap the window: an all-day event ends at midnight, so it is not on the next day
                continue
            out.append({"start": s, "end": s + length, "allday": bool(e.get("allday")), "summary": e["summary"], "location": e.get("location", "")})
    out.sort(key=lambda x: (x["start"], x["summary"]))
    return out


# ---------------------------------------------------------------- getting them
def fetch_events(now=None, force=False):
    """(events, error). The feed is read at most every ten minutes. error is empty on success."""
    url = load_feed()["url"]
    if not url:
        return [], "no calendar link"
    now = now or time.time()
    if not force and _cache["url"] == url and now - _cache["at"] < CACHE_SECONDS and not _cache["error"]:
        return _cache["events"], ""
    try:
        import requests
        r = requests.get(url, timeout=10)
        r.raise_for_status()
        events = parse_ics(r.text)
        _cache.update(at=now, url=url, events=events, error="")
        return events, ""
    except Exception as e:
        _cache.update(at=now, url=url, events=_cache["events"] if _cache["url"] == url else [], error=str(e)[:120])
        return _cache["events"] if _cache["url"] == url else [], str(e)[:120]


def day_events(day, now=None, events=None):
    """Events on one date (a datetime.date), as expansion dicts."""
    if events is None:
        events, err = fetch_events(now)
        if err and not events:
            return None
    lo = dt.datetime.combine(day, dt.time(0, 0))
    return [x for x in expand(events, lo, lo + dt.timedelta(days=1) - dt.timedelta(seconds=1))]


def _say_time(d):
    h = d.hour % 12 or 12
    return "%d%s %s" % (h, (":%02d" % d.minute) if d.minute else "", "pm" if d.hour >= 12 else "am")


def say_event(x):
    when = "all day" if x["allday"] else "at " + _say_time(x["start"])
    return "%s %s%s" % (x["summary"], when, (", in " + x["location"]) if x["location"] else "")


CAL_RE = re.compile(r"\b(my calendar|on my calendar|my schedule|my meetings?|my appointments?|my next (?:meeting|appointment|event)|next (?:meeting|appointment|event)|what do i have (?:tomorrow|today|this week|on monday|on tuesday|on wednesday|on thursday|on friday)|what'?s (?:on )?(?:tomorrow|this week)|what is (?:on )?(?:tomorrow|this week)|am i free|do i have (?:a |any )?(?:meeting|meetings|appointment|appointments))", re.I)


def calendar_reply(text, now=None):
    """What she says when this was a calendar question, or None when it was not or when no calendar is connected."""
    t = (text or "").lower()
    if not CAL_RE.search(t):
        return None
    if not load_feed()["url"]:
        return "I do not have your calendar yet. Paste your calendar link on my panel and I can read it."
    now = now or time.time()
    events, err = fetch_events(now)
    if err and not events:
        return "I could not read your calendar just now, so I would rather not guess. Please check the link on my panel."
    lt = time.localtime(now)
    today = dt.date(lt.tm_year, lt.tm_mon, lt.tm_mday)
    nowdt = dt.datetime(lt.tm_year, lt.tm_mon, lt.tm_mday, lt.tm_hour, lt.tm_min)
    if re.search(r"\bnext (?:meeting|appointment|event)\b", t):
        ev = [x for x in expand(events, nowdt, nowdt + dt.timedelta(days=30)) if not x["allday"]]
        if not ev:
            return "I do not see another meeting on your calendar in the next month."
        x = ev[0]
        day = "today" if x["start"].date() == today else "tomorrow" if x["start"].date() == today + dt.timedelta(days=1) else x["start"].strftime("%A, %B ") + str(x["start"].day)
        return "Your next one is %s, %s." % (say_event(x), day)
    if re.search(r"\bthis week\b", t):
        end = today + dt.timedelta(days=(6 - today.weekday()))
        ev = expand(events, nowdt, dt.datetime.combine(end, dt.time(23, 59)))
        if not ev:
            return "Nothing else on your calendar for the rest of this week."
        bits = ["%s: %s" % (x["start"].strftime("%A"), say_event(x)) for x in ev[:6]]
        return "For the rest of this week: " + "; ".join(bits) + (", and %d more." % (len(ev) - 6) if len(ev) > 6 else ".")
    day = today + dt.timedelta(days=1) if re.search(r"\btomorrow\b", t) else today
    for name, n in zip(("monday", "tuesday", "wednesday", "thursday", "friday"), range(5)):
        if re.search(r"\bon " + name + r"\b", t):
            day = today + dt.timedelta(days=(n - today.weekday()) % 7 or 7)
    ev = expand(events, dt.datetime.combine(day, dt.time(0, 0)), dt.datetime.combine(day, dt.time(23, 59)))
    if day == today:
        ev = [x for x in ev if x["allday"] or x["end"] > nowdt]
    label = "today" if day == today else "tomorrow" if day == today + dt.timedelta(days=1) else day.strftime("%A")
    if re.search(r"\bam i free\b", t) and not ev:
        return "Your calendar is clear %s." % label
    if not ev:
        return "You have nothing on your calendar %s." % label
    return "On your calendar %s: %s." % (label, "; ".join(say_event(x) for x in ev[:6]) + (", and %d more" % (len(ev) - 6) if len(ev) > 6 else ""))
