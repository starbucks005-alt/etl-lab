#!/usr/bin/env python3
"""The Guardian's network watch (written 2026-11-24, Dr. O's Guardian skills: Position, Audit, Interrogate, Demand, as a working tool).

She keeps watch over the Wi-Fi she is on and tells the owner who is there.
  Position   Learn the network: every device that answers right now becomes the approved list, each with a name the owner gives it.
  Audit      Every few minutes she sweeps the network and compares what answers with the approved list.
  Interrogate  A device she does not know is looked at right away: she reads its address, the name it gives, and when it first showed up.
  Demand     An unknown device is flagged to the owner on the panel and by voice, and the owner decides: approve it, or keep it flagged.
Every event goes into a log that shows if anyone changes it (al_chain.py). Nothing leaves the robot.
It works with plain tools already on the Pi (ping and the neighbor table), so there is nothing to install. It is off until the owner switches it on.
"""
import ipaddress
import json
import os
import re
import socket
import subprocess
import threading
import time
from concurrent.futures import ThreadPoolExecutor

import al_chain

HERE = os.path.dirname(os.path.abspath(__file__))
STATE_FILE = os.path.join(HERE, "netwatch.json")
LOG_FILE = os.path.join(HERE, "netwatch_log.jsonl")
SCAN_SECONDS = 300
MAC_RE = re.compile(r"([0-9a-f]{2}(?::[0-9a-f]{2}){5})", re.I)
_lock = threading.Lock()


def _load(path):
    try:
        with open(path, encoding="utf-8") as f:
            d = json.load(f)
    except (OSError, ValueError):
        d = {}
    return {"on": bool(d.get("on")), "known": d.get("known", {}) if isinstance(d.get("known"), dict) else {}, "flagged": d.get("flagged", {}) if isinstance(d.get("flagged"), dict) else {},
            "last_scan": float(d.get("last_scan") or 0), "present": d.get("present", []), "subnet": d.get("subnet", "")}


def _save(path, d):
    tmp = path + ".tmp"
    with open(tmp, "w", encoding="utf-8") as f:
        json.dump(d, f)
    os.replace(tmp, path)


def my_subnet():
    """The network this Pi is on, such as 192.168.0.0/24, from its own address."""
    out = subprocess.run(["ip", "-4", "-o", "addr", "show", "scope", "global"], capture_output=True, text=True, timeout=5).stdout
    for line in out.splitlines():
        m = re.search(r"\binet (\d+\.\d+\.\d+\.\d+)/(\d+)", line)
        if m and not line.split()[1].startswith(("tailscale", "docker", "lo")):
            net = ipaddress.ip_network("%s/%s" % (m.group(1), m.group(2)), strict=False)
            if net.prefixlen < 24:
                net = ipaddress.ip_network("%s/24" % m.group(1), strict=False)
            return str(net), m.group(1)
    return None, None


def _ping(ip):
    subprocess.run(["ping", "-c", "1", "-W", "1", str(ip)], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, timeout=4)


def neighbors():
    """{mac: ip} for every device the Pi has recently heard from."""
    out = subprocess.run(["ip", "neigh"], capture_output=True, text=True, timeout=5).stdout
    found = {}
    for line in out.splitlines():
        if "FAILED" in line or "INCOMPLETE" in line:
            continue
        m = MAC_RE.search(line)
        ip = line.split()[0] if line.split() else ""
        if m and re.fullmatch(r"\d+\.\d+\.\d+\.\d+", ip):
            found[m.group(1).lower()] = ip
    return found


def sweep(subnet=None, ping=_ping, neigh=neighbors, workers=48):
    """Asks every address on the network to answer, then reads who did. Returns {mac: ip}."""
    net = ipaddress.ip_network(subnet, strict=False)
    with ThreadPoolExecutor(max_workers=workers) as ex:
        list(ex.map(ping, list(net.hosts())))
    return neigh()


def hostname(ip):
    """The name a device gives, from the Pi's own name lookup, with a hard time limit. Empty when it has none."""
    try:
        out = subprocess.run(["getent", "hosts", ip], capture_output=True, text=True, timeout=1.5).stdout.split()
        return out[1][:60] if len(out) > 1 else ""
    except Exception:
        return ""


def _is_random_mac(mac):
    """Phones often use a made up address; the second hex digit is 2, 6, a or e. Useful to tell the owner, not a verdict."""
    return mac[1] in "26ae"


def state(path=None):
    return _load(path or STATE_FILE)


def set_on(on, path=None, log=None):
    s = _load(path or STATE_FILE)
    s["on"] = bool(on)
    _save(path or STATE_FILE, s)
    al_chain.append(log or LOG_FILE, "watch_on" if on else "watch_off", {})
    return s


def learn(found, host_of=hostname, path=None, log=None, now=None):
    """Position: everything that answers now becomes the approved list. Existing names are kept."""
    now = now if now is not None else time.time()
    s = _load(path or STATE_FILE)
    for mac, ip in found.items():
        if mac not in s["known"]:
            s["known"][mac] = {"name": host_of(ip) or "Device " + mac[-5:], "first": int(now), "ip": ip}
        s["flagged"].pop(mac, None)
    s["present"] = sorted(found)
    s["last_scan"] = now
    _save(path or STATE_FILE, s)
    al_chain.append(log or LOG_FILE, "learned", {"devices": len(found)}, now=now)
    return s


def audit(found, host_of=hostname, path=None, log=None, now=None):
    """Audit and Interrogate: compares the sweep with the approved list. Returns the list of NEW unknown devices (each flagged once)."""
    now = now if now is not None else time.time()
    s = _load(path or STATE_FILE)
    fresh = []
    for mac, ip in found.items():
        if mac in s["known"]:
            s["known"][mac]["ip"] = ip
            s["known"][mac]["last_seen"] = int(now)
            continue
        if mac not in s["flagged"]:
            info = {"ip": ip, "name": host_of(ip), "first": int(now), "private_mac": _is_random_mac(mac)}
            s["flagged"][mac] = info
            fresh.append(dict(info, mac=mac))
            al_chain.append(log or LOG_FILE, "unknown_device", {"mac": mac, "ip": ip, "name": info["name"]}, now=now)
        else:
            s["flagged"][mac]["ip"] = ip
            s["flagged"][mac]["last_seen"] = int(now)
    s["present"] = sorted(found)
    s["last_scan"] = now
    _save(path or STATE_FILE, s)
    return fresh


def approve(mac, name, path=None, log=None):
    """Demand answered: the owner says this device belongs."""
    mac = mac.lower()
    s = _load(path or STATE_FILE)
    info = s["flagged"].pop(mac, None) or s["known"].get(mac) or {}
    s["known"][mac] = {"name": (name or info.get("name") or "Device " + mac[-5:])[:60], "first": info.get("first", int(time.time())), "ip": info.get("ip", "")}
    _save(path or STATE_FILE, s)
    al_chain.append(log or LOG_FILE, "approved", {"mac": mac, "name": s["known"][mac]["name"]})
    return s


def forget(mac, path=None, log=None):
    mac = mac.lower()
    s = _load(path or STATE_FILE)
    s["known"].pop(mac, None)
    s["flagged"].pop(mac, None)
    _save(path or STATE_FILE, s)
    al_chain.append(log or LOG_FILE, "forgotten", {"mac": mac})
    return s


def scan_now(on_unknown=None, path=None, log=None, sweep_fn=None, subnet=None):
    """One full pass. If nothing is approved yet, this pass learns the network (Position). Returns the new unknown devices."""
    with _lock:
        if not subnet:
            subnet, _me = my_subnet()
        if not subnet:
            return []
        found = (sweep_fn or sweep)(subnet)
        s = _load(path or STATE_FILE)
        if not s["known"]:
            learn(found, path=path, log=log)
            return []
        fresh = audit(found, path=path, log=log)
        if fresh and on_unknown:
            try:
                on_unknown(fresh)
            except Exception:
                pass
        return fresh


def watcher(on_unknown=None, stop=None):
    """Background loop: while switched on, sweeps every SCAN_SECONDS."""
    while not (stop and stop.is_set()):
        try:
            if state()["on"]:
                scan_now(on_unknown)
        except Exception as e:
            print("NETWATCH problem:", str(e)[:120], flush=True)
        for _ in range(SCAN_SECONDS):
            if stop and stop.is_set():
                return
            time.sleep(1)


def view(path=None, log=None):
    """What the panel shows."""
    s = _load(path or STATE_FILE)
    ok, count = al_chain.verify(log or LOG_FILE)
    return {"on": s["on"], "last_scan": s["last_scan"], "present": len(s["present"]),
            "known": [dict(mac=m, **v, here=m in s["present"]) for m, v in sorted(s["known"].items(), key=lambda kv: kv[1].get("name", ""))],
            "flagged": [dict(mac=m, **v, here=m in s["present"]) for m, v in s["flagged"].items()],
            "log_ok": ok, "log_count": count, "log": al_chain.recent(log or LOG_FILE, 30)}
