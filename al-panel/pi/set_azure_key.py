#!/usr/bin/env python3
"""Saves this robot's Azure speech key and location as azure_speech.json next to this file, the file the panel reads.

Run it on the Pi:    python3 set_azure_key.py
It asks for the key with the letters hidden (nothing shows as you type or paste), then for the location, such as eastus.
Stray spaces and line breaks are removed, because a space left in a typed key made a robot's voice fail (Oct 2026).
The file is made readable by this user only. The key is never printed.
"""
import getpass
import json
import os
import re
import stat
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
OUT = os.path.join(HERE, "azure_speech.json")


def set_voice(name):
    """python3 set_azure_key.py --voice en-US-AriaNeural   saves only this robot's own voice, "tts_voice", and touches nothing else."""
    if not re.fullmatch(r"[a-z]{2}-[A-Z]{2}-[A-Za-z0-9]+Neural", name or ""):
        sys.exit("That is not an Azure voice name such as en-US-AriaNeural. Nothing was saved.")
    try:
        with open(OUT) as f:
            old = json.load(f)
    except (OSError, ValueError):
        sys.exit("There is no azure_speech.json yet. Run this without --voice first to save the key.")
    old["tts_voice"] = name
    tmp = OUT + ".tmp"
    with open(tmp, "w") as f:
        json.dump(old, f)
    os.chmod(tmp, stat.S_IRUSR | stat.S_IWUSR)
    os.replace(tmp, OUT)
    print("Saved this robot's voice: %s" % name)


def set_part(part, state):
    """python3 set_azure_key.py --stt off    keeps Azure for her voice but sends her HEARING back to the other service (ElevenLabs). --stt on brings Azure hearing back.
    Same for --tts. Saved in azure_speech.json as "stt": false / "tts": false, which the panel already understands."""
    if part not in ("stt", "tts") or state not in ("on", "off"):
        sys.exit("Use:  python3 set_azure_key.py --stt off   (or on)   Nothing was saved.")
    try:
        with open(OUT) as f:
            old = json.load(f)
    except (OSError, ValueError):
        sys.exit("There is no azure_speech.json yet. Nothing was saved.")
    if state == "off":
        old[part] = False
    else:
        old.pop(part, None)
    tmp = OUT + ".tmp"
    with open(tmp, "w") as f:
        json.dump(old, f)
    os.chmod(tmp, stat.S_IRUSR | stat.S_IWUSR)
    os.replace(tmp, OUT)
    print("Azure %s is now %s." % ("hearing" if part == "stt" else "voice", state))


def main():
    if len(sys.argv) == 3 and sys.argv[1] in ("--stt", "--tts"):
        return set_part(sys.argv[1][2:], sys.argv[2])
    if len(sys.argv) == 3 and sys.argv[1] == "--voice":
        return set_voice(sys.argv[2])
    key = re.sub(r"\s+", "", getpass.getpass("Azure speech key (hidden): "))
    where = re.sub(r"\s+", "", input("Azure location (such as eastus) OR the endpoint address, paste either: "))
    if len(key) < 20 or not re.fullmatch(r"[A-Za-z0-9]+", key):
        sys.exit("That does not look like a key (it should be one long run of letters and numbers). Nothing was saved.")
    old = {}
    try:
        with open(OUT) as f:
            old = json.load(f)
    except (OSError, ValueError):
        pass
    if re.fullmatch(r"https://[A-Za-z0-9.-]+\.azure\.com/?", where, re.I):
        old.update({"key": key, "endpoint": where.rstrip("/")})    # kept apart from "region", which the panel builds its own address from
        what = "endpoint " + where.rstrip("/")
    elif re.fullmatch(r"[a-z0-9]{3,30}", where.lower()):
        old.update({"key": key, "region": where.lower()})
        what = "location " + where.lower()
    else:
        sys.exit("That is neither a one word location such as eastus nor an https address ending in azure.com. Nothing was saved.")
    tmp = OUT + ".tmp"
    with open(tmp, "w") as f:
        json.dump(old, f)
    os.chmod(tmp, stat.S_IRUSR | stat.S_IWUSR)
    os.replace(tmp, OUT)
    print("Saved %s (key of %d characters, %s). The key itself is not shown." % (OUT, len(key), what))


if __name__ == "__main__":
    main()
