#!/usr/bin/env python3
"""The Guardian's reference on the nation's critical infrastructure sectors (written 2026-11-25, Dr. O: "I want her to know everything about the 16 critical infrastructure sectors").

What she carries for each sector: its name, who leads it in government, what it is, its parts, what it leans on, what leans on it, how it gets hurt, one real
example where there is one, and what a place like the one she guards can do.
Sources: the sector pages at cisa.gov (read 2026-11-25) for the names, descriptions, parts and lead agencies, and Presidential Policy Directive 21 and National
Security Memorandum 22 for the sector list and the lead agency system. The dependencies are the main ones CISA names, not every link.
No counts that change (how many dams, plants or water systems) are kept here, because they go out of date. If asked for one she says she does not carry it.
She answers from this file and says so. A question it cannot answer gets "I don't know that one", never a guess.
"""
import re

SOURCE = "cisa.gov sector pages, PPD-21 and NSM-22, read 2026-11-25"

SECTORS = [
    {"key": "chemical", "name": "Chemical", "aka": [], "lead": "the Department of Homeland Security (CISA)",
     "what": "It makes, stores, uses and moves chemicals that nearly every other sector relies on.",
     "parts": ["basic chemicals", "specialty chemicals", "agricultural chemicals", "consumer products"],
     "leans_on": ["energy", "transportation", "water", "communications"],
     "hurt_by": "Theft or release of dangerous chemicals, plant control systems reached over a network, and supply chain disruption that starves other sectors.",
     "example": "", "you_can": "Know what is stored nearby, keep it secured, and report missing or odd chemical deliveries."},
    {"key": "commercial", "name": "Commercial Facilities", "aka": ["commercial facilities", "commercial"], "lead": "the Department of Homeland Security",
     "what": "Places that draw crowds for shopping, business, entertainment or lodging, built on open public access.",
     "parts": ["entertainment and media", "gaming", "lodging", "outdoor events", "public assembly", "real estate", "retail", "sports leagues"],
     "leans_on": ["energy", "communications", "water", "transportation", "emergency"],
     "hurt_by": "Attacks on crowds, because open access means few barriers, plus ransomware and point of sale intrusions.",
     "example": "", "you_can": "Walk the building with fresh eyes, know the exits, train staff to notice and report, and keep visitors logged."},
    {"key": "communications", "name": "Communications", "aka": ["communications", "telecom", "telecommunications"], "lead": "the Department of Homeland Security (CISA)",
     "what": "Wired, wireless and satellite networks that every other sector, public safety and government run on. It is an enabling sector.",
     "parts": ["wireline", "wireless", "satellite", "cable", "broadcast"],
     "leans_on": ["energy", "it"],
     "hurt_by": "Power loss at towers and switching sites, cut fiber, software flaws in network gear and attacks on the companies that run them.",
     "example": "", "you_can": "Plan for the phones and internet being down: a radio, paper contacts, a meeting point."},
    {"key": "manufacturing", "name": "Critical Manufacturing", "aka": ["critical manufacturing", "manufacturing"], "lead": "the Department of Homeland Security (CISA)",
     "what": "Core industries whose loss would ripple through the country: metals, machinery, electrical equipment and transportation equipment.",
     "parts": ["primary metals", "machinery", "electrical equipment and appliances", "transportation equipment"],
     "leans_on": ["transportation", "energy", "chemical", "water"],
     "hurt_by": "Ransomware that stops a production line, tampered control systems, and parts shortages from a single supplier.",
     "example": "", "you_can": "Keep factory control networks apart from office networks and know your single points of supply."},
    {"key": "dams", "name": "Dams", "aka": ["dams", "dam", "levees"], "lead": "the Department of Homeland Security (CISA)",
     "what": "Water retention and control: hydroelectric power, drinking and irrigation water, flood control, river navigation, and the levees and locks that go with them.",
     "parts": ["dams", "levees", "navigation locks", "hydropower"],
     "leans_on": ["communications", "energy"],
     "hurt_by": "Remote gates and sensors reached over a network, physical tampering, and failure in floods that no one was warned about.",
     "example": "", "you_can": "Know whether you live below a dam or behind a levee and where the warning comes from."},
    {"key": "defense", "name": "Defense Industrial Base", "aka": ["defense industrial base", "defense", "dib"], "lead": "the Department of Defense",
     "what": "The companies and sites that research, design, build and maintain military systems and parts, including many small subcontractors.",
     "parts": ["prime contractors", "subcontractors and suppliers", "government owned facilities"],
     "leans_on": ["energy", "communications", "transportation", "it"],
     "hurt_by": "Theft of designs by foreign intelligence, intrusions through small suppliers, and counterfeit parts.",
     "example": "", "you_can": "If you supply it, protect controlled information and report intrusions promptly."},
    {"key": "emergency", "name": "Emergency Services", "aka": ["emergency services", "emergency"], "lead": "the Department of Homeland Security (CISA)",
     "what": "The people and systems that keep the public safe and respond when things go wrong, at every level of government and in the private sector.",
     "parts": ["law enforcement", "fire and rescue", "emergency medical services", "emergency management", "public works"],
     "leans_on": ["communications", "energy", "it", "transportation", "water"],
     "hurt_by": "Attacks on dispatch and 911 systems, ransomware on agencies, and being overwhelmed when several things fail together.",
     "example": "", "you_can": "In an emergency call 911 first, and know your nearest police and fire stations."},
    {"key": "energy", "name": "Energy", "aka": ["energy", "electric", "power grid", "grid", "oil and gas", "pipeline", "pipelines"], "lead": "the Department of Energy",
     "what": "Electricity, oil and natural gas. It is an enabling sector: every other sector depends on it, and most of it is privately owned.",
     "parts": ["electricity", "oil", "natural gas"],
     "leans_on": ["communications", "transportation", "water", "it", "dams"],
     "hurt_by": "Ransomware on the business side that forces a shutdown, attacks on control systems, severe weather and physical attacks on substations.",
     "example": "In May 2021 ransomware hit the company that runs the Colonial Pipeline, and it shut the fuel pipeline as a precaution.",
     "you_can": "Plan for a long outage: water, light, a way to keep medicine cold, and a way to hear the news without the internet."},
    {"key": "financial", "name": "Financial Services", "aka": ["financial services", "financial", "banking", "banks"], "lead": "the Department of the Treasury",
     "what": "Banks, credit unions, insurers, investment firms and the utilities that move money between them.",
     "parts": ["depository institutions", "investment products", "insurance", "credit and financing", "financial utilities"],
     "leans_on": ["communications", "energy", "it"],
     "hurt_by": "Fraud, ransomware, denial of service, attacks on a shared provider, and large outages.",
     "example": "", "you_can": "Keep some cash at home, use strong sign in on every account, and watch for business email compromise."},
    {"key": "food", "name": "Food and Agriculture", "aka": ["food and agriculture", "food", "agriculture", "farming"], "lead": "the Department of Agriculture and the Food and Drug Administration",
     "what": "Farms, food makers, processors, storage, and the restaurants and stores at the end, almost all privately owned.",
     "parts": ["farms", "food manufacturing and processing", "storage and distribution", "restaurants and retail"],
     "leans_on": ["water", "transportation", "energy", "chemical", "dams"],
     "hurt_by": "Animal and plant disease, contamination, ransomware at a processor, and a broken cold chain.",
     "example": "", "you_can": "Keep a few days of food and water, and watch for recall notices."},
    {"key": "government", "name": "Government Services and Facilities", "aka": ["government services and facilities", "government facilities", "government"], "lead": "the General Services Administration and the Department of Homeland Security",
     "what": "The buildings, systems and services of federal, state, local, tribal and territorial government.",
     "parts": ["federal buildings", "state and local offices", "courts", "schools", "public records and services"],
     "leans_on": ["communications", "energy", "it"],
     "hurt_by": "Ransomware on cities and counties, insider threats, and physical threats to public buildings.",
     "example": "", "you_can": "Know how your local government tells residents about closures and emergencies."},
    {"key": "healthcare", "name": "Healthcare and Public Health", "aka": ["healthcare and public health", "healthcare", "health care", "hospitals", "public health"], "lead": "the Department of Health and Human Services",
     "what": "Hospitals, clinics, labs, pharmacies, medical device makers and public health agencies. It protects the other sectors from disease and disaster.",
     "parts": ["direct patient care", "health information technology", "medical materials", "laboratories and blood", "public health"],
     "leans_on": ["communications", "emergency", "energy", "food", "it", "transportation", "water"],
     "hurt_by": "Ransomware that takes records offline and diverts patients, attacks on a shared billing or records provider, and medical device flaws.",
     "example": "In February 2024 a ransomware attack on Change Healthcare disrupted claims and payments for providers across the country.",
     "you_can": "Keep a list of your medicines and doctors on paper, and know a second pharmacy."},
    {"key": "it", "name": "Information Technology", "aka": ["information technology", "technology", "software", "cloud"], "lead": "the Department of Homeland Security (CISA)",
     "what": "Hardware, software, services and, with Communications, the internet itself. Everyone depends on it.",
     "parts": ["hardware", "software", "IT services", "internet infrastructure", "cloud and hosting"],
     "leans_on": ["communications", "energy"],
     "hurt_by": "Flaws in widely used software, attacks on a vendor that reach all its customers, and attacks on the services that run the internet.",
     "example": "", "you_can": "Apply updates, use multi factor sign in, keep offline backups, and check the CISA known exploited list for what you run."},
    {"key": "nuclear", "name": "Nuclear Reactors, Materials, and Waste", "aka": ["nuclear reactors, materials, and waste", "nuclear"], "lead": "the Department of Homeland Security (CISA)",
     "what": "The civilian nuclear infrastructure: power reactors, research reactors, fuel cycle sites, medical and industrial radioactive sources, and waste.",
     "parts": ["power reactors", "research and test reactors", "fuel cycle facilities", "radioactive sources", "transport and waste"],
     "leans_on": ["energy", "communications", "water", "transportation"],
     "hurt_by": "Loss of off site power, physical and cyber threats, and loss of control of radioactive sources.",
     "example": "", "you_can": "If you live near a plant, know its emergency plan and alert signals."},
    {"key": "transportation", "name": "Transportation Systems", "aka": ["transportation systems", "transportation", "transport"], "lead": "the Department of Homeland Security and the Department of Transportation",
     "what": "Moving people and goods by air, road, sea, rail, transit and pipeline, and the systems that direct them.",
     "parts": ["aviation", "highway and motor carrier", "maritime", "mass transit and passenger rail", "pipeline", "freight rail", "postal and shipping"],
     "leans_on": ["energy", "communications", "it", "dams"],
     "hurt_by": "Attacks on scheduling and control systems, ransomware on operators, severe weather and physical incidents.",
     "example": "", "you_can": "Keep a full tank, know two routes home, and have a plan for the people who rely on you."},
    {"key": "water", "name": "Water and Wastewater", "aka": ["water and wastewater", "water", "wastewater", "drinking water"], "lead": "the Environmental Protection Agency",
     "what": "Drinking water supply and treatment, and the collection and treatment of wastewater. Both are national critical functions.",
     "parts": ["public drinking water systems", "wastewater treatment"],
     "leans_on": ["energy", "chemical", "communications", "it", "dams"],
     "hurt_by": "Contamination, physical attack, control systems reachable over the internet or left on default passwords, and natural disasters.",
     "example": "In February 2021 someone remotely reached the control system of the water plant in Oldsmar, Florida, and tried to raise the sodium hydroxide level. An operator saw it and reversed it.",
     "you_can": "Store water, know how your utility sends boil notices, and keep control systems off the open internet."},
]

KEYS = [s["key"] for s in SECTORS]
BY_KEY = {s["key"]: s for s in SECTORS}
ASK_LIST_RE = re.compile(r"\b(list|name|what are|which are|tell me|read)\b.{0,40}\b(critical infrastructure|infrastructure) sectors\b|\bcritical infrastructure sectors\b", re.I)
SECTOR_WORD_RE = re.compile(r"\bsectors?\b", re.I)


def count():
    return len(SECTORS)


def find(text):
    """The sector a sentence is about, or None. The longest alias wins, so 'water and wastewater' beats 'water'."""
    t = (" " + (text or "").lower() + " ")
    best, blen = None, 0
    for s in SECTORS:
        for a in [s["name"].lower()] + s["aka"]:
            if re.search(r"(?<![a-z])" + re.escape(a) + r"(?![a-z])", t) and len(a) > blen:
                best, blen = s, len(a)
    return best


def _names(keys):
    return [BY_KEY[k]["name"] for k in keys if k in BY_KEY]


def relied_on_by(key):
    return [s["key"] for s in SECTORS if key in s["leans_on"]]


def card(key):
    s = BY_KEY[key]
    return {"key": key, "name": s["name"], "lead": s["lead"], "what": s["what"], "parts": s["parts"], "leans_on": _names(s["leans_on"]),
            "relied_on_by": _names(relied_on_by(key)), "hurt_by": s["hurt_by"], "example": s["example"], "you_can": s["you_can"], "source": SOURCE}


def view():
    return {"count": count(), "source": SOURCE, "sectors": [{"key": s["key"], "name": s["name"], "lead": s["lead"]} for s in SECTORS]}


def say(key):
    c = card(key)
    out = "%s is led by %s. %s." % (c["name"], c["lead"], c["what"].rstrip("."))
    out += " It leans on %s." % (", ".join(c["leans_on"]) or "no one in particular")
    out += " These lean on it: %s." % (", ".join(c["relied_on_by"]) or "none that I carry")
    if c["hurt_by"]:
        out += " It gets hurt by: " + c["hurt_by"]
    return out + ((" " + c["example"]) if c["example"] else "")


def sector_reply(text):
    """(spoken, shown) for a question about the critical infrastructure sectors, else None."""
    t = text or ""
    s = find(t)
    mentions = bool(SECTOR_WORD_RE.search(t)) or "infrastructure" in t.lower()
    if ASK_LIST_RE.search(t) and not s:
        m = "There are %d critical infrastructure sectors: %s. Ask me about any one." % (count(), ", ".join(x["name"] for x in SECTORS))
        return m, m + "\n\nSource: " + SOURCE
    if not s or not mentions:
        return None
    low = t.lower()
    c = card(s["key"])
    if re.search(r"\b(who leads|who runs|who is in charge|who oversees|lead agency|sector risk)\b", low):
        m = "The %s sector is led by %s." % (c["name"], c["lead"])
    elif re.search(r"\b(depend|rely|relies|lean|leans)\b", low):
        m = "The %s sector leans on %s. These sectors lean on it: %s." % (c["name"], ", ".join(c["leans_on"]), ", ".join(c["relied_on_by"]) or "none that I carry")
    elif re.search(r"\b(parts|subsectors?|made up|includes?|consists?)\b", low):
        m = "The %s sector includes %s." % (c["name"], ", ".join(c["parts"]))
    elif re.search(r"\b(attack|hurt|threat|risk|vulnerab|harm)\b", low):
        m = "%s. %s" % (c["name"] + " gets hurt by", c["hurt_by"]) + ((" " + c["example"]) if c["example"] else "")
    elif re.search(r"\b(what can i do|protect|prepare|what should)\b", low):
        m = "For %s: %s" % (c["name"], c["you_can"])
    else:
        m = say(s["key"])
    return m, m + "\n\nSource: " + SOURCE
