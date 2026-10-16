"""House controls, added 2026-10-16, Dr. O: an option, off until she adds a device. "Elle, turn on the test lamp" / "close the blinds".

It does nothing at all until a device is added on the panel, and it never touches Alexa or anything already in the house. Devices are kept in devices.json
next to the server (kept out of git).

A device is one of two kinds:
  http  the device answers a web address on the home network (Shelly, Tasmota and many others). Each action is an address, optionally with a method and body.
  kasa  a TP-Link Kasa plug or bulb, through the python-kasa library if it is installed. (Tapo needs an account login, which is not built.)

Locks, doors, garage doors, gates, alarms and anything that heats are refused by name. She only switches what is on her list, and says so when something is not.
The http addresses must be on the home network (a private address or a .local name), so the panel cannot be used to reach out to the internet.

NOT TRIED ON A REAL DEVICE as of 2026-10-16. The http kind is tested here against a fake device. The kasa kind needs a real plug to prove."""
import asyncio
import ipaddress
import json
import os
import re
import threading
import urllib.parse

HERE = os.path.dirname(os.path.abspath(__file__))
DEVICES_FILE = os.path.join(HERE, "devices.json")
MAX_DEVICES = 30
KINDS = ("http", "kasa")
TYPES = ("light", "plug", "blinds")
REFUSED = re.compile(r"\b(locks?|doors?|garage|gate|alarm|oven|stove|heater|furnace|thermostat|camera|safe)\b", re.I)
HOUSE_NOUNS = r"(lights?|lamps?|plugs?|outlets?|fans?|blinds?|shades?|curtains?|switch(?:es)?)"


def _load():
    try:
        d = json.load(open(DEVICES_FILE))
        return d if isinstance(d, list) else []
    except (OSError, ValueError):
        return []


def _save(items):
    tmp = DEVICES_FILE + ".tmp"
    with open(tmp, "w") as f:
        json.dump(items, f)
    os.replace(tmp, DEVICES_FILE)


def list_devices():
    return _load()


def _local_host(host):
    """True for a private address or a .local name. Anything that could be the open internet is refused."""
    host = (host or "").strip().lower()
    if not host:
        return False
    if host.endswith(".local"):
        return True
    try:
        ip = ipaddress.ip_address(host)
        return ip.is_private and not ip.is_loopback and not ip.is_link_local
    except ValueError:
        return False


def _check_url(u):
    p = urllib.parse.urlparse(u or "")
    if p.scheme not in ("http", "https") or not _local_host(p.hostname):
        raise ValueError("that address must start with http and point at a device in your house (an address like 192.168.1.40, or a name ending in .local)")
    return u


def add_device(name, kind, dtype="plug", host="", actions=None):
    name = re.sub(r"\s+", " ", (name or "").strip())[:40]
    if not name:
        raise ValueError("give it a name, such as test lamp")
    if REFUSED.search(name):
        raise ValueError("I do not control locks, doors, garage doors, alarms, cameras, heaters or ovens, so that name is refused")
    if kind not in KINDS:
        raise ValueError("kind must be http or kasa")
    if dtype not in TYPES:
        raise ValueError("type must be light, plug or blinds")
    items = _load()
    if len(items) >= MAX_DEVICES:
        raise ValueError("that is the most devices she can keep")
    if any(i["name"].lower() == name.lower() for i in items):
        raise ValueError("a device with that name is already on the list")
    dev = {"name": name, "kind": kind, "type": dtype}
    if kind == "kasa":
        if not _local_host(host):
            raise ValueError("give the plug's address on your home network, such as 192.168.1.40")
        dev["host"] = host.strip()
    else:
        acts = {}
        want = ("open", "close") if dtype == "blinds" else ("on", "off")
        for a in want:
            v = (actions or {}).get(a) or {}
            if isinstance(v, str):
                v = {"url": v}
            if not v.get("url"):
                raise ValueError("this needs an address for %s" % a)
            m = (v.get("method") or "GET").upper()
            if m not in ("GET", "POST", "PUT"):
                raise ValueError("method must be GET, POST or PUT")
            acts[a] = {"url": _check_url(v["url"]), "method": m, "body": str(v.get("body") or "")[:500]}
        dev["actions"] = acts
    items.append(dev)
    _save(items)
    return dev


def delete_device(name):
    items = _load()
    keep = [i for i in items if i["name"].lower() != (name or "").lower()]
    _save(keep)
    return len(keep) != len(items)


# ---------------------------------------------------------------- doing it
def _http(act):
    import requests
    r = requests.request(act["method"], act["url"], data=(act["body"].encode() if act.get("body") else None),
                         headers={"Content-Type": "application/json"} if act.get("body") else None, timeout=6)
    r.raise_for_status()


def _kasa(host, on):
    try:
        from kasa import Discover
    except ImportError:
        raise RuntimeError("the Kasa library is not installed on her. Run: pip3 install python-kasa")

    async def go():
        dev = await Discover.discover_single(host)
        await dev.update()
        await (dev.turn_on() if on else dev.turn_off())
        try:
            await dev.disconnect()
        except Exception:
            pass
    out = {}

    def run():
        try:
            asyncio.run(go())
        except Exception as e:                      # reported to the caller, not swallowed
            out["err"] = e
    t = threading.Thread(target=run)
    t.start()
    t.join(15)
    if t.is_alive():
        raise RuntimeError("the plug did not answer in time")
    if "err" in out:
        raise out["err"]


def do(dev, action):
    """action is on, off, open or close. Raises on failure; returns nothing."""
    if dev["kind"] == "http":
        _http(dev["actions"][action])
    else:
        _kasa(dev["host"], action == "on")


# ---------------------------------------------------------------- what she hears
def _find(text, items):
    low = " " + re.sub(r"[^a-z0-9 ]", " ", text.lower()) + " "
    low = re.sub(r"\s+", " ", low)
    best = None
    for d in items:
        n = " " + re.sub(r"\s+", " ", re.sub(r"[^a-z0-9 ]", " ", d["name"].lower())).strip() + " "
        if n in low and (best is None or len(n) > len(best[0])):
            best = (n, d)
    return best[1] if best else None


def house_reply(text, runner=None):
    """What she says back when this was a house command, or None when it was not. runner is do() by default; a test passes its own."""
    t = (text or "").lower()
    if not t.strip():
        return None
    # never doors or locks, whether or not any device is on the list
    if re.search(r"\b(unlock|lock|open|close|raise|lower)\b.{0,25}\b(the )?(front |back |garage |side )?(door|doors|gate|garage|lock|window)\b", t) or \
            re.search(r"\b(unlock|lock)\b", t):
        return "I do not open doors, locks, gates or garage doors, and I do not lock them either. Please do that yourself."
    items = _load()
    runner = runner or do
    on = re.search(r"\b(turn|switch)\b.{0,40}\bon\b|\blights? on\b", t)
    off = re.search(r"\b(turn|switch)\b.{0,40}\boff\b|\blights? off\b", t)
    opn = re.search(r"\b(open|raise)\b", t)
    cls = re.search(r"\b(close|lower|shut)\b", t)
    asking = re.search(r"\bis the\b.{0,30}\b(on|off|open|closed)\b", t)
    if asking and not (on or off or opn or cls):
        return None
    if not (on or off or opn or cls):
        return None
    dev = _find(t, items)
    if dev is None:
        if re.search(r"\b" + HOUSE_NOUNS + r"\b", t) and not re.search(r"\b(timer|alarm|reminder|music|volume|screen|eyes?)\b", t):
            if not items:
                return "I have no devices on my list yet. Add one on my panel first, and then I can switch it."
            return "I do not have that on my list. I can switch: " + ", ".join(i["name"] for i in items[:8]) + "."
        return None
    if dev["type"] == "blinds":
        action = "open" if (opn and not cls) else "close" if (cls and not opn) else None
        if action is None:
            return "Do you want the %s open or closed?" % dev["name"]
        verb = "opened" if action == "open" else "closed"
    else:
        action = "on" if (on and not off) else "off" if (off and not on) else None
        if action is None:
            return "Do you want the %s on or off?" % dev["name"]
        verb = "turned " + action
    try:
        runner(dev, action)
    except Exception as e:
        print("HOUSE could not switch %s: %s" % (dev["name"], str(e)[:120]), flush=True)
        return "I could not reach the %s, so nothing changed. %s" % (dev["name"], str(e)[:120] if "not installed" in str(e) else "Please check that it is plugged in and on the network.")
    return "Okay, I %s the %s." % (verb, dev["name"])
