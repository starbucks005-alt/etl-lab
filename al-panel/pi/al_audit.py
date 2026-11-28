#!/usr/bin/env python3
"""The Guardian's security check and self diagnostics (written 2026-11-25, Dr. O's Guardian skills, item 2 and the self diagnostics of item 9).

She looks at herself and reports what she actually found, one line per check, each marked ok or needs attention, with what to do about it.
Everything is read only. She changes nothing on her own, and a problem is a notice on the panel (tier 1), never an alarm.

The checks, all things she can really see from inside:
  Panel passcode        is one set (her page is reachable from the whole network)
  Open doors            which network ports she is listening on beyond her own panel and remote login, on the network side
  Records               every hash chained log still checks out
  Network watch         on, and nothing flagged waiting
  Asset watch           a reference photo exists, and the last check is not stale
  Room sensor           chosen and heard from recently
  Alerts                nothing left uncleared
  Clock                 her time is confirmed with an internet time server, and not before the day her own files were put on her
  Internet              she can reach out (the weather, CISA and place lookups need it)
  Heat, disk, memory    the Pi's own health
It is not a scan of anything else on the network, and it does not claim to find intruders. It tells the owner the state of this robot.
The name PAID is not used here: Dr. O has not yet settled how the Gemini module's PAID and her own house PAID should be told apart.
"""
import glob
import json
import os
import re
import shutil
import socket
import subprocess
import time

try:
    import al_chain
except ImportError:
    al_chain = None

HERE = os.path.dirname(os.path.abspath(__file__))
STATE_FILE = os.path.join(HERE, "audit.json")
LOG_FILE = os.path.join(HERE, "audit_log.jsonl")
EXPECTED_PORTS = {22, 8000}          # remote login and her own panel
STALE_ASSET_DAYS = 3
STALE_ROOM_SECONDS = 30 * 60
TEMP_WARN_C = 75.0
DISK_WARN_FREE = 0.10
MEM_WARN_FREE = 0.10
PORT_NAMES = {111: "rpcbind (a file sharing helper I do not use)", 631: "printing", 5353: "device discovery", 139: "Windows file sharing", 445: "Windows file sharing", 21: "ftp", 23: "telnet", 80: "a web page", 443: "a web page"}


def _row(cid, name, ok, detail, fix=""):
    return {"id": cid, "name": name, "status": "ok" if ok is True else ("attention" if ok is False else "unknown"), "detail": detail, "fix": fix if ok is False else ""}


def lan_ports(text=None):
    """Ports open to the whole network, from `ss -ltnH`. Tailscale and loopback addresses are not the open network."""
    if text is None:
        try:
            text = subprocess.run(["ss", "-ltnH"], capture_output=True, text=True, timeout=5).stdout
        except (OSError, subprocess.SubprocessError):
            return None
    ports = set()
    for line in text.splitlines():
        cols = line.split()
        if len(cols) < 4:
            continue
        addr = cols[3]
        host, _, port = addr.rpartition(":")
        if "%" in host or host.startswith("127.") or host in ("[::1]", "::1") or host.startswith("100.") or host.startswith("[fd7a"):
            continue
        if port.isdigit():
            ports.add(int(port))
    return ports


def _internet(timeout=3):
    try:
        socket.create_connection(("1.1.1.1", 443), timeout=timeout).close()
        return True
    except OSError:
        return False


def _cpu_temp():
    try:
        return int(open("/sys/class/thermal/thermal_zone0/temp").read().strip()) / 1000.0
    except (OSError, ValueError):
        return None


def _mem_free_fraction():
    try:
        d = dict(re.findall(r"(\w+):\s+(\d+)", open("/proc/meminfo").read()))
        return int(d["MemAvailable"]) / int(d["MemTotal"])
    except (OSError, KeyError, ValueError, ZeroDivisionError):
        return None


def _disk_free_fraction(path="/"):
    try:
        u = shutil.disk_usage(path)
        return u.free / u.total
    except OSError:
        return None


def _clock():
    try:
        import al_clock
        st = al_clock.status()
        return st if st.get("known") else None
    except Exception:
        return None


def _lock_set():
    try:
        import al_lock
        return bool(al_lock.is_set())
    except Exception:
        return None


def _logs_ok(base):
    bad, total = [], 0
    if al_chain is None:
        return None, []
    for p in sorted(glob.glob(os.path.join(base, "*_log.jsonl"))):
        total += 1
        ok, n = al_chain.verify(p)
        if not ok:
            bad.append("%s (line %s)" % (os.path.basename(p), n))
    return (not bad), bad if total else []


def _call(modname, fn, *a):
    try:
        mod = __import__(modname)
        return getattr(mod, fn)(*a)
    except Exception:
        return None


def run(now=None, base=None, probes=None):
    """Every check once. probes lets tests replace the things that need the real Pi."""
    now = time.time() if now is None else now
    base = base or HERE
    pr = probes or {}
    get = lambda k, f: pr[k]() if k in pr else f()
    rows = []

    lock = get("lock", _lock_set)
    rows.append(_row("lock", "Panel passcode", lock if lock is None else bool(lock),
                     "A passcode is set." if lock else ("I could not tell." if lock is None else "No passcode is set, so anyone on this network who finds my page can use it."),
                     "Set a passcode in the Panel lock card."))

    ports = get("ports", lan_ports)
    if ports is None:
        rows.append(_row("ports", "Open doors", None, "I could not read my network ports."))
    else:
        extra = sorted(ports - EXPECTED_PORTS)
        rows.append(_row("ports", "Open doors", not extra,
                         "Only my panel and remote login are open on the network." if not extra else "Also open on the network: " + ", ".join(("%d %s" % (p, PORT_NAMES.get(p, ""))).strip() for p in extra) + ".",
                         "If you did not expect these, they can be switched off on the robot."))

    ok, bad = get("logs", lambda: _logs_ok(base))
    rows.append(_row("logs", "Records", ok, "Every log checks out." if ok else ("I could not check the logs." if ok is None else "A log does not match its fingerprints: " + ", ".join(bad) + "."),
                     "Someone or something changed that file. Keep a copy before you touch it."))

    net = get("net", lambda: _call("al_netwatch", "view"))
    if net is None:
        rows.append(_row("net", "Network watch", None, "Not available on this robot."))
    elif not net.get("on"):
        rows.append(_row("net", "Network watch", False, "It is switched off, so a new device on your Wi-Fi would go unseen.", "Switch it on in the Network watch card."))
    else:
        fl = len(net.get("flagged") or [])
        rows.append(_row("net", "Network watch", fl == 0, "On, %d device(s) approved, nothing waiting." % len(net.get("known") or []) if fl == 0 else "%d unknown device(s) are waiting for you to approve or leave flagged." % fl,
                         "Open the Network watch card and decide on each one."))

    asx = get("assets", lambda: _call("al_assets", "view"))
    if asx is None or not asx.get("items"):
        rows.append(_row("assets", "Asset watch", None, "No equipment is being watched yet."))
    elif not asx.get("has_reference"):
        rows.append(_row("assets", "Asset watch", False, "Items are chosen but there is no reference photo.", "Take the reference photo."))
    else:
        last = asx.get("last_check") or asx.get("ref_at") or 0
        old = last and (now - last) > STALE_ASSET_DAYS * 86400
        rows.append(_row("assets", "Asset watch", not old, "Reference photo taken, last check was recent." if not old else "The last check was more than %d days ago." % STALE_ASSET_DAYS,
                         "Run a check, or set a schedule."))

    room = get("room", lambda: _call("al_room", "view"))
    if room is None or not room.get("configured"):
        rows.append(_row("room", "Room sensor", None, "No room sensor is set up."))
    else:
        rd = room.get("reading")
        fresh = bool(rd) and not room.get("stale") and (room.get("age") is None or room["age"] <= STALE_ROOM_SECONDS)
        batt = (rd or {}).get("battery")
        rows.append(_row("room", "Room sensor", fresh and (batt is None or batt >= 15),
                         "Heard from the sensor recently." if fresh and (batt is None or batt >= 15) else ("I have not heard from the sensor lately." if not fresh else "The sensor battery is at %d percent." % batt),
                         "Check the sensor is powered and near me." if not fresh else "Change the sensor battery."))

    al = get("alerts", lambda: _call("al_alert", "view"))
    if al is None:
        rows.append(_row("alerts", "Alerts", None, "Alert tiers are not on this robot."))
    else:
        n = len([a for a in al.get("active", []) if a.get("source") != "Security check" and a.get("tier", 0) >= 2])
        rows.append(_row("alerts", "Alerts", n == 0, "Nothing waiting." if n == 0 else "%d alert(s) are still on the panel." % n, "Look at them and clear the ones you have dealt with."))

    clk = get("clock", _clock)
    if clk is None:
        rows.append(_row("clock", "Clock", None, "I could not read my clock's state."))
    else:
        import al_clock
        c_ok, c_words, c_fix = al_clock.detail(clk)
        rows.append(_row("clock", "Clock", c_ok, c_words, c_fix))

    net_ok = get("internet", _internet)
    rows.append(_row("internet", "Internet", net_ok, "I can reach the internet." if net_ok else "I cannot reach the internet, so weather, CISA and place lookups will fail.", "Check the Wi-Fi."))

    t = get("temp", _cpu_temp)
    rows.append(_row("heat", "Heat", None if t is None else t < TEMP_WARN_C, "Unreadable." if t is None else "%d degrees C." % round(t), "I need more airflow or a cooler spot."))
    d = get("disk", _disk_free_fraction)
    rows.append(_row("disk", "Storage", None if d is None else d > DISK_WARN_FREE, "Unreadable." if d is None else "%d percent free." % round(d * 100), "Old photos and logs can be cleared."))
    m = get("mem", _mem_free_fraction)
    rows.append(_row("mem", "Memory", None if m is None else m > MEM_WARN_FREE, "Unreadable." if m is None else "%d percent free." % round(m * 100), "Restart me."))

    attn = [r for r in rows if r["status"] == "attention"]
    return {"t": int(now), "checks": rows, "ok": len([r for r in rows if r["status"] == "ok"]), "attention": len(attn), "unknown": len([r for r in rows if r["status"] == "unknown"])}


def save(result, state=None, log=None):
    """Keeps the newest result and writes a line in the chain, so the owner can see she checked and what she found."""
    try:
        with open(state or STATE_FILE, "w", encoding="utf-8") as f:
            json.dump(result, f)
    except OSError:
        pass
    if al_chain:
        try:
            al_chain.append(log or LOG_FILE, "run", {"ok": result["ok"], "attention": result["attention"], "needs": [r["id"] for r in result["checks"] if r["status"] == "attention"]}, now=result["t"])
        except OSError:
            pass


def last(state=None):
    try:
        with open(state or STATE_FILE, encoding="utf-8") as f:
            return json.load(f)
    except (OSError, ValueError):
        return None


def view(state=None, log=None):
    ok, count = al_chain.verify(log or LOG_FILE) if al_chain else (True, 0)
    return {"last": last(state), "log_ok": ok, "log_count": count, "log": al_chain.recent(log or LOG_FILE, 15) if al_chain else []}


ASK_RE = re.compile(r"\b(security (?:check|audit|scan|posture|status)|self[- ]?(?:check|test|diagnostics?)|(?:run|do) (?:a |your |the )?(?:diagnostics?|system check|health check)|check yourself)\b", re.I)


def wants(text):
    return bool(ASK_RE.search(text or ""))


def spoken(result):
    n = len(result["checks"]) - result["unknown"]
    attn = [r for r in result["checks"] if r["status"] == "attention"]
    if not attn:
        return "I checked %d things and they are all in good order." % n
    head = "I checked %d things. %d need%s your attention. " % (n, len(attn), "s" if len(attn) == 1 else "")
    return head + " ".join("%s: %s" % (r["name"], r["detail"]) for r in attn[:3]) + (" The rest are on my panel." if len(attn) > 3 else "")


def reply(text, raise_notice=None, state=None, log=None):
    """(spoken, shown) when she is asked for a security check or a self check, running it now. raise_notice(source, text) puts a notice on the panel."""
    if not wants(text):
        return None
    res = run()
    save(res, state, log)
    if raise_notice:
        for r in res["checks"]:
            if r["status"] == "attention":
                try:
                    raise_notice("Security check", "%s: %s" % (r["name"], r["detail"]))
                except Exception:
                    pass
    s = spoken(res)
    lines = ["%s %s: %s%s" % ("OK " if r["status"] == "ok" else ("ATTENTION " if r["status"] == "attention" else "?"), r["name"], r["detail"], (" " + r["fix"]) if r["fix"] else "") for r in res["checks"]]
    return s, s + "\n\n" + "\n".join(lines) + "\n\nSource: my own checks, just now."
