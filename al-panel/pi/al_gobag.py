#!/usr/bin/env python3
"""The Guardian's go bag and crisis plan (written 2026-11-25, Dr. O's Guardian skills, item 1).

From the place card (county disaster risks from the FEMA National Risk Index) she says what to keep in a go bag, and what to do for the hazards that rate high for this place.
Severe wind comes first: strong wind, tornado, hurricane, lightning and hail are told before everything else.

Where it comes from:
  The kit list and the wind and tornado steps are from Ready.gov (the Build a Kit, Thunderstorms and Lightning, and Tornadoes pages, read 2026-11-25).
  The other hazards carry short steps from the same family of public guidance and say so ("read" is False), so she tells the owner to check ready.gov for the whole page.
  A hazard she has no plan for (avalanche, drought, landslide, tsunami, volcano) gets "I do not have a plan for that one."
She is a helper, not a replacement for 911 or the official alerts, and she says so. She never speaks the street address or the county name, only the hazards.
There are no counts that change in here: no prices, no phone numbers, no station names.
"""
import re

WIND_FIRST = ["Strong wind", "Tornado", "Hurricane", "Lightning", "Hail"]
RANK = {"Very High": 5, "Relatively High": 4, "Relatively Moderate": 3, "Relatively Low": 2, "Very Low": 1}

KIT = {
    "source": "Ready.gov, Build a Kit, read 2026-11-25",
    "basics": [
        "Water, about one gallon per person per day, for drinking and sanitation, for several days",
        "Food that keeps, enough for several days",
        "A battery or hand crank radio, and a NOAA Weather Radio with tone alert",
        "A flashlight and extra batteries",
        "A first aid kit",
        "A whistle to signal for help",
        "A dust mask",
        "Plastic sheeting, scissors and duct tape",
        "Moist towelettes, garbage bags and plastic ties",
        "A wrench or pliers to turn off utilities",
        "A manual can opener",
        "Local maps",
        "A phone with chargers and a backup battery",
    ],
    "extras": [
        "Prescription medicines and glasses",
        "Cash",
        "Copies of important papers, saved electronically or in a waterproof container",
        "A sleeping bag or warm blanket for each person",
        "A change of clothes for the weather, and sturdy shoes",
        "Matches in a waterproof container",
        "Soap, hand sanitizer and personal hygiene items",
        "Food and extra water for pets",
        "Baby supplies, if there is a baby",
        "Paper and a pencil",
    ],
    "where": "Keep one at home, one at work with enough to shelter for at least a day, and one in the car.",
}

# hazard name (as the FEMA list spells it) -> plan
PLANS = {
    "Strong wind": {
        "stay": True, "read": True,
        "headline": "Stay in. Do not drive through it.",
        "steps": ["When thunder roars, go indoors, into a sturdy building or a car with a roof.",
                  "Stay away from windows, and keep following the alerts.",
                  "Stay off corded devices plugged into outlets, and out of running water.",
                  "Do not drive through flooded roads. Fast moving water only a few inches deep can knock you down, and about a foot can carry a car away.",
                  "Before the season, trim or take down trees that could fall on the building.",
                  "Afterward, stay clear of fallen power lines and trees and report them right away."],
        "bag": "Keep the go bag where you shelter, not by the front door.",
    },
    "Tornado": {
        "stay": True, "read": True,
        "headline": "Shelter. A car is not a safe place.",
        "steps": ["Know your shelter ahead of time: a storm shelter or safe room if you have one, otherwise a small interior room with no windows or the lowest level of a sturdy building.",
                  "When a warning comes, go there right away and keep listening to the alerts.",
                  "Stay away from windows, doors and outside walls. Cover your head and neck with your arms and put blankets or furniture over you.",
                  "A tornado that is visible, far away, with light traffic: you may be able to drive out of its path at a right angle. If wind or debris catches you, park out of the traffic lanes, stay buckled with your head below the windows and covered. Do not shelter under a bridge.",
                  "Afterward, stay clear of power lines, wear thick soled shoes, long pants and work gloves for cleanup, and text instead of calling so the lines stay free."],
        "bag": "Keep the go bag in the shelter, with water, food, medicine and a radio, for a long stay.",
    },
    "Lightning": {
        "stay": True, "read": True,
        "headline": "When thunder roars, go indoors.",
        "steps": ["Go into a building or a car with a roof as soon as you hear thunder.",
                  "Stay off corded devices plugged into outlets, and out of running water.",
                  "Surge protectors and a lightning protection system help the building."],
        "bag": "A radio and a flashlight matter most here.",
    },
    "Hail": {
        "stay": True, "read": False,
        "headline": "Get under cover.",
        "steps": ["Go indoors and stay away from windows and skylights.", "If you are in a car, drive to cover if you can do it safely, and stay in the car."],
        "bag": "",
    },
    "Hurricane": {
        "stay": False, "read": False,
        "headline": "Leave when the officials say leave.",
        "steps": ["Know whether your address is in an evacuation zone, and know your route ahead of time.",
                  "When local officials order an evacuation, go early, with the go bag, the papers and the medicines.",
                  "If you are told to stay, shelter in an interior room away from windows."],
        "bag": "The go bag is by the door, with the car filled up.",
    },
    "River flooding": {
        "stay": False, "read": False,
        "headline": "Move to higher ground. Do not drive into water.",
        "steps": ["When a flood warning comes, move to higher ground and leave if you are told to.",
                  "Do not walk or drive through flood water. A few inches of fast water can knock you down and a foot can carry a car.",
                  "Turn off utilities at the main switches if you have time and it is safe."],
        "bag": "The go bag is by the door.",
    },
    "Coastal flooding": {
        "stay": False, "read": False,
        "headline": "Move inland and up. Do not drive into water.",
        "steps": ["Follow evacuation orders and know your route ahead of time.",
                  "Do not walk or drive through flood water."],
        "bag": "The go bag is by the door.",
    },
    "Winter weather": {
        "stay": True, "read": False,
        "headline": "Stay put and stay warm.",
        "steps": ["Stay home unless you are told to go. Keep warm clothes, blankets and a way to hear the alerts.",
                  "Keep a kit in the car in case you are stuck: blanket, water, food, flashlight and a charged phone."],
        "bag": "Blankets and warm clothes matter most here.",
    },
    "Ice storm": {
        "stay": True, "read": False,
        "headline": "Stay put. Ice takes down power lines and trees.",
        "steps": ["Stay home, away from windows and trees, and stay clear of fallen power lines.", "Plan to be without power for a while, with warm blankets and a radio."],
        "bag": "Blankets, a radio and a flashlight.",
    },
    "Cold wave": {
        "stay": True, "read": False,
        "headline": "Stay in and stay warm.",
        "steps": ["Dress in layers, keep indoors as much as you can, and check on neighbors who live alone.", "Keep a blanket and food in the car."],
        "bag": "Blankets and warm clothes.",
    },
    "Heat wave": {
        "stay": True, "read": False,
        "headline": "Stay cool and drink water.",
        "steps": ["Stay in the coolest place you have, drink water often, and check on neighbors and anyone who lives alone.", "Never leave a child or a pet in a parked car."],
        "bag": "Extra water.",
    },
    "Wildfire": {
        "stay": False, "read": False,
        "headline": "Leave early when told. Do not wait to see it.",
        "steps": ["Know two ways out ahead of time, and keep the car filled up.", "When officials say go, go, with the go bag, the papers and the medicines.", "Keep a mask in the bag for smoke."],
        "bag": "The go bag is by the door.",
    },
    "Earthquake": {
        "stay": True, "read": False,
        "headline": "Drop, cover and hold on.",
        "steps": ["Drop to the ground, take cover under a sturdy table and hold on until the shaking stops.", "Stay away from windows. Expect aftershocks.",
                  "Afterward, check for hurt people, and if you smell gas leave the building."],
        "bag": "Shoes by the bed, and the go bag where you can reach it.",
    },
}

HAZARD_WORDS = [  # words a person says -> the FEMA hazard name; first match wins
    (r"\btornado(?:es)?\b|\btwister\b", "Tornado"),
    (r"\bhurricane|\btyphoon\b|\bcyclone\b", "Hurricane"),
    (r"\bwind(?:s|storm)?\b|\bderecho\b|\bthunderstorm", "Strong wind"),
    (r"\blightning\b", "Lightning"),
    (r"\bhail\b", "Hail"),
    (r"\bflood(?:ing|s)?\b", "River flooding"),
    (r"\bice storm\b", "Ice storm"),
    (r"\bblizzard|\bsnow|\bwinter (?:storm|weather)", "Winter weather"),
    (r"\bcold wave\b|\bextreme cold\b", "Cold wave"),
    (r"\bheat ?wave\b|\bextreme heat\b", "Heat wave"),
    (r"\bwildfire", "Wildfire"),
    (r"\bearthquake", "Earthquake"),
    (r"\bvolcan", "Volcano"),
    (r"\btsunami", "Tsunami"),
    (r"\blandslide|\bmudslide", "Landslide"),
    (r"\bavalanche", "Avalanche"),
    (r"\bdrought", "Drought"),
]
NO_PLAN = {"Avalanche", "Drought", "Landslide", "Tsunami", "Volcano"}
ASK_BAG = re.compile(r"\b(go[- ]?bag|grab[- ]?bag|bug[- ]?out bag|emergency kit|emergency supplies|disaster kit|crisis (?:prep|plan|kit)|evacuation (?:plan|protocol|kit)|evacuate|what (?:should|do) i (?:pack|bring|keep)|be prepared|get prepared)\b", re.I)
ASK_DO = re.compile(r"\b(what (?:do|should) (?:i|we)|how (?:do|should) (?:i|we)|protocol|safety plan|shelter|prepare for|get ready for|steps for|plan for)\b", re.I)


def hazard_from(text):
    for rx, name in HAZARD_WORDS:
        if re.search(rx, text or "", re.I):
            return name
    return None


def ordered_risks(card):
    """The hazards rated high for this place, severe wind first, then the rest by rating."""
    rows = [r for r in (card or {}).get("risks", []) if RANK.get(r.get("rating"), 0) >= 4]
    def key(r):
        w = WIND_FIRST.index(r["hazard"]) if r["hazard"] in WIND_FIRST else 99
        return (w, -RANK[r["rating"]])
    return sorted(rows, key=key)


def plan(hazard):
    """The plan for one hazard, or None."""
    p = PLANS.get(hazard)
    return dict(p, hazard=hazard) if p else None


def view(card=None):
    """Everything for the panel: the kit, and a plan for each high hazard of this place (or the wind plans when there is no place yet)."""
    risks = ordered_risks(card)
    names = [r["hazard"] for r in risks]
    return {"kit": KIT, "has_place": bool(card), "hazards": [dict(plan(n), rating=r["rating"]) if plan(n) else {"hazard": n, "rating": r["rating"], "none": True} for n, r in zip(names, risks)],
            "wind": [plan(n) for n in ("Strong wind", "Tornado")],
            "limits": "I am a helper. I do not replace 911 or the official alerts. For the whole page on any hazard, ready.gov."}


def kit_say(card=None, alerts=0):
    top = ordered_risks(card)
    s = ""
    if alerts:
        s += "There are active weather alerts for this place. They are on my panel, and the official alerts come first. "
    s += "A go bag starts with water, about a gallon per person per day for several days, and food that keeps for the same days. Then a radio, a flashlight with batteries, a first aid kit, a whistle, a dust mask, and a phone charger with a backup battery. "
    s += "Add your medicines, cash, and copies of your important papers. "
    if top:
        s += "For this place the highest risks are " + ", ".join(r["hazard"].lower() for r in top[:3]) + ". " + (plan(top[0]["hazard"]) or {}).get("bag", "")
    else:
        s += "Tell me your place on my panel and I will fit it to the risks there."
    return s.strip()


def plan_say(hazard):
    if hazard in NO_PLAN:
        return "I do not have a plan for that one. Ready.gov has it."
    p = PLANS.get(hazard)
    if not p:
        return "I do not know that one."
    s = "%s: %s " % (hazard, p["headline"]) + " ".join(p["steps"][:3])
    if p["bag"]:
        s += " " + p["bag"]
    if not p["read"]:
        s += " That is general guidance. Check ready.gov for the whole page."
    return s


def reply(text, card=None, alerts=0):
    """(spoken, shown) for a go bag, evacuation or hazard plan question, or None when the question is not one."""
    h = hazard_from(text)
    bag = bool(ASK_BAG.search(text or ""))
    if not bag and not (h and ASK_DO.search(text or "")):
        return None
    if bag and not h:
        sp = kit_say(card, alerts)
        shown = sp + "\n\nBasics:\n- " + "\n- ".join(KIT["basics"]) + "\n\nIf they apply:\n- " + "\n- ".join(KIT["extras"]) + "\n\n" + KIT["where"] + "\n\nSource: " + KIT["source"] + ". I am a helper, not a replacement for 911 or the official alerts."
        return sp, shown
    p = PLANS.get(h)
    sp = plan_say(h)
    shown = sp
    if p:
        shown = "%s: %s\n\n- " % (h, p["headline"]) + "\n- ".join(p["steps"]) + ("\n\n" + p["bag"] if p["bag"] else "") + ("\n\nFrom Ready.gov." if p["read"] else "\n\nGeneral guidance. Ready.gov has the whole page.") + "\nI am a helper, not a replacement for 911 or the official alerts."
    return sp, shown
