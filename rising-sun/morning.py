#!/usr/bin/env python3
"""The morning routine: the sun reaches full, the fairy greets whoever is there, asks what they want, and does it.

The speaking and listening are passed in, so the flow can be tested without a speaker. On the device these come from the website (see README). This file is the flow written out so it can be checked.
The news is Above the Fold from ETL Newswire, played by the device; see netlify/functions/sun-morning.js.
"""
import json
import os

HERE = os.path.dirname(os.path.abspath(__file__))


def load_persona(name=None):
    with open(os.path.join(HERE, "personas.json")) as f:
        d = json.load(f)
    return d[name or d.get("chosen", "velvet")]


def choice(heard):
    t = (heard or "").lower()
    if "news" in t:
        return "news"
    if "calendar" in t or "schedule" in t or "day" in t:
        return "calendar"
    if not t.strip():
        return "nothing"
    return "else"


def morning(speak, listen, calendar_reply, persona=None):
    p = persona or load_persona()
    speak(p["greeting"])
    speak(p["ask"])
    heard = listen()
    what = choice(heard)
    if what == "calendar":
        speak(calendar_reply(heard))
    elif what == "news":
        speak("Here is Above the Fold from ETL Newswire.")
    elif what == "else":
        speak("I heard you, and I can't do that one yet.")
    return what


if __name__ == "__main__":
    morning(print, lambda: "check my calendar", lambda t: "(calendar line goes here)")
