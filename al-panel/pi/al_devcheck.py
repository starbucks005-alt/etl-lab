#!/usr/bin/env python3
"""The unknown-device check (written 2026-11-26, Dr. O's item 9). The owner presses Check on a device Network watch has flagged, and she reports what she finds.

What she does, only for that one device, only when the owner presses the button:
  Name the maker from the first half of its hardware address, using a list on herself. A phone with a "private address" (many do this on purpose) has no
  readable maker, and she says that instead of guessing.
  Try about twenty common TCP ports, one connection each, to see which are answering: web, remote login, printing, camera video, file sharing and so on.
What she does NOT do: log in, send anything but the opening connection, read what a service says, block or change the device, or challenge it.
She only checks a device that Network watch has already seen, and only at a private network address (never the internet, never someone else's network).
She reports facts and what they are normally used for. She does not say a device is malicious, because open ports are normal for printers, TVs and phones.
The owner decides, with the approve or leave flagged buttons that were already there.
"""
import concurrent.futures
import ipaddress
import json
import os
import re
import socket
import time

try:
    import al_chain
except ImportError:
    al_chain = None

HERE = os.path.dirname(os.path.abspath(__file__))
STATE_FILE = os.path.join(HERE, "devcheck.json")
LOG_FILE = os.path.join(HERE, "devcheck_log.jsonl")
GAP_SECONDS = 30
CONNECT_TIMEOUT = 0.6
OUI_FILES = ("/usr/share/ieee-data/oui.txt", "/var/lib/ieee-data/oui.txt", os.path.join(HERE, "oui.txt"))
PORTS = {21: "file transfer (ftp)", 22: "remote login (ssh)", 23: "telnet, an old login that is not encrypted", 53: "name lookup (dns)", 80: "a web page",
         139: "Windows file sharing", 443: "a secure web page", 445: "Windows file sharing", 515: "printing", 554: "camera video (rtsp)", 631: "printing",
         1883: "device messaging (mqtt)", 3389: "Windows remote desktop", 5900: "screen sharing (vnc)", 8008: "a Chromecast or similar", 8009: "a Chromecast or similar",
         8080: "a web page on another port", 8443: "a secure web page on another port", 8883: "device messaging (mqtt, encrypted)", 9100: "printing"}
_last = {}


def is_random(mac):
    """Phones and laptops often use a made up address on purpose: the second hex digit is 2, 6, a or e."""
    m = (mac or "").lower()
    return len(m) > 1 and m[1] in "26ae"


def vendor(mac, files=None):
    """(maker or None, note). Never guesses: with no list on her, or no match, she says so."""
    if is_random(mac):
        return None, "This address is made up on purpose, which phones and laptops do for privacy, so no maker can be read from it."
    prefix = re.sub(r"[^0-9A-F]", "", (mac or "").upper())[:6]
    if len(prefix) < 6:
        return None, "I could not read that address."
    seen = False
    for p in (files or OUI_FILES):
        try:
            with open(p, encoding="utf-8", errors="replace") as f:
                seen = True
                for line in f:
                    if "(hex)" in line and line.strip().replace("-", "").upper().startswith(prefix):
                        return line.split("(hex)", 1)[1].strip()[:60], ""
        except OSError:
            continue
    return None, ("That address is not in my maker list." if seen else "I do not have a maker list on me yet.")


def allowed_ip(ip):
    """Only private network addresses, never the internet, and never loopback, link local or multicast."""
    try:
        a = ipaddress.ip_address(ip)
    except ValueError:
        return False
    return a.version == 4 and a.is_private and not (a.is_loopback or a.is_link_local or a.is_multicast or a.is_unspecified)


def _try(ip, port, connect):
    try:
        return connect(ip, port, CONNECT_TIMEOUT)
    except OSError:
        return False


def _connect(ip, port, timeout):
    s = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
    s.settimeout(timeout)
    try:
        return s.connect_ex((ip, port)) == 0
    finally:
        s.close()


def open_ports(ip, connect=None):
    connect = connect or _connect
    with concurrent.futures.ThreadPoolExecutor(max_workers=16) as ex:
        results = list(ex.map(lambda p: (p, _try(ip, p, connect)), sorted(PORTS)))
    return [p for p, ok in results if ok]


def _load():
    try:
        with open(STATE_FILE, encoding="utf-8") as f:
            return json.load(f)
    except (OSError, ValueError):
        return {}


def check(mac, devices, now=None, connect=None, oui=None, state_file=None, log=None):
    """devices is {mac: {"ip":..., "name":...}} of the ones Network watch has seen. Returns the result dict, or raises ValueError with words for the owner."""
    now = time.time() if now is None else now
    mac = (mac or "").lower()
    dev = devices.get(mac)
    if not dev:
        raise ValueError("Network watch has not seen that device.")
    ip = dev.get("ip", "")
    if not allowed_ip(ip):
        raise ValueError("I only check devices on your own network.")
    if now - _last.get(mac, 0) < GAP_SECONDS:
        raise ValueError("I just checked that one. Give it a moment.")
    _last[mac] = now
    maker, note = vendor(mac, oui)
    ports = open_ports(ip, connect)
    res = {"mac": mac, "ip": ip, "name": dev.get("name", ""), "maker": maker, "maker_note": note, "random": is_random(mac), "t": int(now),
           "open": [{"port": p, "what": PORTS[p]} for p in ports], "tried": len(PORTS)}
    try:
        data = _load()
        data[mac] = res
        with open(state_file or STATE_FILE, "w", encoding="utf-8") as f:
            json.dump(data, f)
    except OSError:
        pass
    if al_chain:
        try:
            al_chain.append(log or LOG_FILE, "checked", {"mac": mac, "open": ports}, now=int(now))
        except OSError:
            pass
    return res


def last(mac):
    return _load().get((mac or "").lower())


def say(res):
    """The report, in her words, for the panel."""
    lines = ["Maker: " + (res["maker"] if res["maker"] else res["maker_note"])]
    if res["open"]:
        lines.append("Answering on: " + "; ".join("%d, %s" % (o["port"], o["what"]) for o in res["open"]) + ".")
    else:
        lines.append("None of the %d common ports I tried answered." % res["tried"])
    if any(o["port"] in (23, 21) for o in res["open"]):
        lines.append("Telnet and ftp send everything unencrypted. They are normal on very old devices and worth asking about on a new one.")
    lines.append("Open ports are normal for printers, TVs and phones. I do not say whether a device is safe. You decide with Approve or Leave flagged.")
    return " ".join(lines)
