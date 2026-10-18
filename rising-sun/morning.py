#!/usr/bin/env python3
"""The morning routine: the sun reaches full, the fairy greets whoever is there, asks what they want, and does it.

The speaking and listening are passed in, so the flow can be tested without a speaker. On the Pi, speak() and listen() come from the same
Azure and ElevenLabs calls as AL (al-panel/pi/al_panel_server.py: azure_speak, azure_transcribe). Wiring those in is the next step and is NOT done.
The calendar is al_calendar.py from al-panel/pi, copied next to this file.
News is NOT connected. She says so out loud rather than making any up.
"""
import json
import os

HERE = os.path.dirname(os.path.abspath(__file__))


def load_persona(name=None):
    with open(os.path.join(HERE, "personas.json")) as f:
        d = json.load(f)
    return d[name or d.get("chosen", "default")]


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
        speak("I don't have the news hooked up yet.")
    elif what == "else":
        speak("I heard you, and I can't do that one yet.")
    return what


if __name__ == "__main__":
    morning(print, lambda: "check my calendar", lambda t: "(calendar line goes here)")
