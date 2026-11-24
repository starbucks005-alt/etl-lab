#!/usr/bin/env python3
"""Makes the Guardian's spoken photo line ONCE and saves it as photo_line.wav next to this file.

Dr. O, 2026-11-24: "A recorded (no cost) I am taking a photo now". It is rendered one time, with the voice you name,
and after that it is only played from the file, so every photo is free and needs no internet.

Run on the Pi, from the folder the panel is in, with the Guardian's voice:
    python3 make_photo_line.py --voice en-US-LunaNeural
It reads the Azure key from azure_speech.json, the same file the panel uses. There is no default voice on purpose,
so the line can never be made in the wrong one.
"""
import argparse
import json
import os
import re
import sys
from xml.sax.saxutils import escape

import requests

HERE = os.path.dirname(os.path.abspath(__file__))
LINE = "I am taking a photo now."
OUT = os.path.join(HERE, "photo_line.wav")
SENTRY_LINE = "Motion detected. I am taking a photo now."      # Sentry mode says this before its photo (Dr. O: she always says it first)
SENTRY_OUT = os.path.join(HERE, "sentry_line.wav")


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--voice", required=False, help="an Azure voice name, such as en-US-LunaNeural")
    ap.add_argument("--sentry", action="store_true", help="make the Sentry line instead: Motion detected. I am taking a photo now.")
    a = ap.parse_args()
    text, out = (SENTRY_LINE, SENTRY_OUT) if a.sentry else (LINE, OUT)
    if not a.voice or not re.fullmatch(r"[a-z]{2}-[A-Z]{2}-[A-Za-z0-9]+Neural", a.voice):
        sys.exit("Say which voice she has, for example: python3 make_photo_line.py --voice en-US-LunaNeural")
    # the same two places the panel looks: the AZURE_SPEECH_KEY and AZURE_SPEECH_REGION settings first, then azure_speech.json,
    # which may hold a "region" (such as eastus) or, for a resource whose screen shows only an endpoint, an "endpoint" address
    key, region = os.environ.get("AZURE_SPEECH_KEY", ""), os.environ.get("AZURE_SPEECH_REGION", "")
    endpoint = ""
    try:
        with open(os.path.join(HERE, "azure_speech.json")) as f:
            cfg = json.load(f)
        key, region, endpoint = key or str(cfg.get("key", "")), region or str(cfg.get("region", "")), str(cfg.get("endpoint", ""))
    except (OSError, ValueError, AttributeError):
        pass
    key, region, endpoint = key.strip(), region.strip(), endpoint.strip().rstrip("/")
    if not (key and (region or endpoint)):
        sys.exit("There is no Azure key and location or endpoint here (no AZURE_SPEECH_KEY and AZURE_SPEECH_REGION settings, and no azure_speech.json), so there is no way to make the line.")
    lang = "-".join(a.voice.split("-")[:2])
    ssml = "<speak version='1.0' xml:lang='%s'><voice name='%s'>%s</voice></speak>" % (lang, a.voice, escape(text))
    url = (endpoint + "/tts/cognitiveservices/v1") if endpoint and not region else "https://%s.tts.speech.microsoft.com/cognitiveservices/v1" % region
    r = requests.post(url,
                      headers={"Ocp-Apim-Subscription-Key": key, "Content-Type": "application/ssml+xml",
                               "X-Microsoft-OutputFormat": "riff-16khz-16bit-mono-pcm", "User-Agent": "al-panel"},
                      data=ssml.encode("utf-8"), timeout=30)
    if not r.ok:
        sys.exit("Azure answered %s: %s" % (r.status_code, r.text[:120]))
    tmp = out + ".tmp"
    with open(tmp, "wb") as f:
        f.write(r.content)
    os.replace(tmp, out)
    print("Saved %s (%d bytes). Play it once to hear it:  aplay -D plughw:wm8960soundcard %s" % (out, len(r.content), out))


if __name__ == "__main__":
    main()
