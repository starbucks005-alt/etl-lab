#!/usr/bin/env python3
"""Whether the Guardian's own clock can be trusted (written 2026-11-28, Dr. O: "she needs a clock").

A Raspberry Pi has no clock that survives being powered off, unless it is a Pi 5 with a small battery plugged into its clock socket.
Woken somewhere with no internet she can start with the old time, and then her alerts, check-in photos, recordings, appointments and tamper-checked logs
all carry the wrong time. So she checks, and says so on her panel and in her security check, instead of showing a time she cannot vouch for.

What she can really see (and says):
  synced     the system says the time was confirmed with an internet time server (timedatectl, NTPSynchronized)
  rtc        a clock chip is present (a Pi 5 has one). She CANNOT see whether a battery is fitted, so she says that, not "battery ok".
  floor      the time is not earlier than the day her own program files were put on her. A clock behind that is certainly wrong.
She does not set the clock herself. The fix, when it is wrong, is to let her reach the internet for a minute, or fit the battery.
"""
import os
import re
import subprocess
import time

HERE = os.path.dirname(os.path.abspath(__file__))
RTC_DIR = "/sys/class/rtc"


def _show():
    try:
        return subprocess.run(["timedatectl", "show"], capture_output=True, text=True, timeout=5).stdout
    except (OSError, subprocess.SubprocessError):
        return None


def _rtc_present():
    try:
        return any(n.startswith("rtc") for n in os.listdir(RTC_DIR))
    except OSError:
        return False


def _floor():
    """The earliest the time can possibly be: when her own files were put on her."""
    try:
        return max(os.path.getmtime(os.path.join(HERE, f)) for f in os.listdir(HERE) if f.endswith(".py"))
    except (OSError, ValueError):
        return 0.0


def status(show=None, rtc=None, floor=None, now=None):
    """{known, synced, rtc, tz, now, behind, ok}. known is False when she cannot read it at all."""
    now = time.time() if now is None else now
    text = _show() if show is None else show
    if not text:
        return {"known": False, "synced": None, "rtc": None, "tz": "", "now": int(now), "behind": None, "ok": None}
    kv = dict(re.findall(r"^(\w+)=(.*)$", text, re.M))
    synced = kv.get("NTPSynchronized", "").lower() == "yes"
    fl = _floor() if floor is None else floor
    behind = bool(fl and now < fl - 3600)
    has_rtc = _rtc_present() if rtc is None else rtc
    return {"known": True, "synced": synced, "rtc": has_rtc, "tz": kv.get("Timezone", ""), "now": int(now), "behind": behind, "ok": bool(synced and not behind)}


def detail(st):
    """(ok, words, fix) for the security check and the panel. ok is True, False or None (unknown)."""
    if not st["known"]:
        return None, "I could not read my clock's state.", ""
    if st["behind"]:
        return False, "My clock is earlier than the day my own program was put on me, so it is certainly wrong.", "Let me reach the internet for a minute, then check again."
    if st["synced"]:
        return True, "My time is confirmed with an internet time server.", ""
    s = "I have not confirmed my time with the internet since I woke up, so it may be off."
    if st["rtc"]:
        s += " I have a clock chip, but I cannot see whether its battery is fitted."
    return False, s, "Let me reach the internet for a minute. A small battery in my clock socket would keep the time when I am off."


def view(**kw):
    st = status(**kw)
    ok, words, fix = detail(st)
    return dict(st, words=words, fix=fix, trusted=ok)
