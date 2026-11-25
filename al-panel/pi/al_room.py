#!/usr/bin/env python3
"""The Guardian reads the room (written 2026-11-24, Dr. O: "if she can read it, that's enough to say").

A SwitchBot Meter Pro CO2 sits near her. It broadcasts its temperature, humidity and CO2 over Bluetooth every few seconds, to anyone listening. She
listens, keeps the newest reading, and says it when asked: "what is the temperature", "how is the air", "what is the humidity".
No connection, no account and no cloud. Nothing leaves the robot.

HOW IT READS: the broadcast layout below was read from the open source pySwitchbot library (adv_parsers/meter.py and _sensor_th.py, 2026-11-24):
  service data, first byte:        model (0x35 or 0x15 is the Meter Pro CO2, 0x34 or 0x14 the Meter Pro without CO2); the next byte, low 7 bits of byte 2, is the battery
  manufacturer data (company 2409): bytes 8 to 10 hold the temperature and humidity, bytes 13 and 14 hold the CO2 in parts per million, big endian
    byte 8, low 4 bits: tenths of a degree C;  byte 9: top bit is the sign (1 = positive), low 7 bits are whole degrees C;  byte 10: low 7 bits are the humidity percent
Readings above 9999 ppm are the sensor's own parsing artifacts and are dropped, as the library does.
NOT TRIED ON THE REAL SENSOR as of 2026-11-24 (it arrives Saturday). The tests here use made up broadcasts built from that layout.
Needs the `bleak` package on the Pi to listen (pip install bleak). Without it she says that she cannot listen for the sensor yet.
"""
import asyncio
import json
import os
import re
import threading
import time

HERE = os.path.dirname(os.path.abspath(__file__))
CONFIG_FILE = os.path.join(HERE, "room.json")
MFR_ID = 2409
SERVICE_UUID = "0000fd3d-0000-1000-8000-00805f9b34fb"
CO2_MAX_PPM = 9999
STALE_SECONDS = 15 * 60
POLL_SECONDS = 60
SCAN_SECONDS = 8
_lock = threading.Lock()
_latest = {"reading": None, "t": 0.0, "error": ""}


def parse(service_data, mfr_data):
    """A reading from one broadcast: {temp_c, temp_f, humidity, battery, co2 or None}, or None when it is not a Meter Pro."""
    if not service_data or len(service_data) < 3 or not mfr_data or len(mfr_data) < 11:
        return None
    model = service_data[0] & 0x7F
    if model not in (0x34, 0x14, 0x35, 0x15, ord("4"), ord("5")):
        return None
    t = mfr_data[8:11]
    sign = 1 if t[1] & 0x80 else -1
    temp_c = sign * ((t[1] & 0x7F) + (t[0] & 0x0F) / 10.0)
    humidity = t[2] & 0x7F
    if temp_c == 0 and humidity == 0:
        return None
    co2 = None
    if len(mfr_data) >= 15:
        v = int.from_bytes(mfr_data[13:15], "big")
        if v <= CO2_MAX_PPM:
            co2 = v
    return {"temp_c": round(temp_c, 1), "temp_f": round(temp_c * 9 / 5 + 32, 1), "humidity": humidity, "battery": service_data[2] & 0x7F, "co2": co2}


def load_config(path=None):
    try:
        with open(path or CONFIG_FILE, encoding="utf-8") as f:
            d = json.load(f)
        mac = str(d.get("mac", "")).upper()
        return {"mac": mac if re.fullmatch(r"([0-9A-F]{2}:){5}[0-9A-F]{2}", mac) else ""}
    except (OSError, ValueError):
        return {"mac": ""}


def set_mac(mac, path=None):
    mac = str(mac or "").upper().strip()
    if mac and not re.fullmatch(r"([0-9A-F]{2}:){5}[0-9A-F]{2}", mac):
        raise ValueError("That does not look like a Bluetooth address.")
    tmp = (path or CONFIG_FILE) + ".tmp"
    with open(tmp, "w", encoding="utf-8") as f:
        json.dump({"mac": mac}, f)
    os.replace(tmp, path or CONFIG_FILE)
    with _lock:
        _latest.update(reading=None, t=0.0, error="")
    return load_config(path)


async def _scan(timeout):
    """Listens for SwitchBot broadcasts. Returns {mac: reading}."""
    from bleak import BleakScanner          # the one package this needs on the Pi
    found = {}
    devices = await BleakScanner.discover(timeout=timeout, return_adv=True)
    for dev, adv in devices.values():
        mfr = adv.manufacturer_data.get(MFR_ID)
        svc = adv.service_data.get(SERVICE_UUID)
        r = parse(svc, mfr)
        if r:
            found[dev.address.upper()] = dict(r, rssi=adv.rssi, name=(dev.name or adv.local_name or ""))
    return found


def scan(timeout=SCAN_SECONDS, scanner=None):
    """Every SwitchBot temperature sensor in range: {mac: reading}. scanner is only for tests."""
    return (scanner or (lambda t: asyncio.run(_scan(t))))(timeout)


def poll_once(path=None, scanner=None, now=None):
    """Looks for the chosen sensor and keeps its newest reading. Returns the reading, or None."""
    mac = load_config(path)["mac"]
    if not mac:
        return None
    now = time.time() if now is None else now
    try:
        found = scan(scanner=scanner)
    except ImportError:
        with _lock:
            _latest["error"] = "Bluetooth listening is not installed yet."
        return None
    except Exception as e:
        with _lock:
            _latest["error"] = "Bluetooth problem: " + str(e)[:80]
        return None
    r = found.get(mac)
    with _lock:
        if r:
            _latest.update(reading=r, t=now, error="")
        else:
            _latest["error"] = "I could not hear the sensor on that scan."
    return r


def poller(stop=None):
    while not (stop and stop.is_set()):
        try:
            poll_once()
        except Exception as e:
            print("ROOM problem:", str(e)[:120], flush=True)
        for _ in range(POLL_SECONDS):
            if stop and stop.is_set():
                return
            time.sleep(1)


def latest(now=None):
    now = time.time() if now is None else now
    with _lock:
        r, t, err = _latest["reading"], _latest["t"], _latest["error"]
    return {"reading": r, "age": (now - t) if r else None, "error": err, "stale": bool(r and now - t > STALE_SECONDS)}


def co2_words(ppm):
    if ppm < 1000:
        return "That is fresh air."
    if ppm < 2000:
        return "The air is getting stuffy. A little fresh air would help."
    return "That is high. Please open a window or step outside."


def _minutes(age):
    m = int(age // 60)
    return "%d minute%s" % (m, "" if m == 1 else "s")


TEMP_RE = re.compile(r"\b(temperature|how (?:hot|cold|warm|chilly)|degrees|too (?:hot|cold|warm))\b", re.I)
HUM_RE = re.compile(r"\b(humidity|how humid|how dry)\b", re.I)
AIR_RE = re.compile(r"\b(co2|c o 2|carbon dioxide|air quality|how(?:'s| is) the air|stuffy|ventilat\w+)\b", re.I)
OTHER_PLACE_RE = re.compile(r"\b(outside|outdoors?|weather|forecast|tomorrow|tonight|this week|in [A-Z][a-z]+)\b")
YOU_RE = re.compile(r"\b(my|your|body|fever|cpu|processor|chip)\b", re.I)


def wants(text):
    t = text or ""
    if YOU_RE.search(t) or OTHER_PLACE_RE.search(t):
        return None
    if AIR_RE.search(t):
        return "air"
    if HUM_RE.search(t):
        return "humidity"
    if TEMP_RE.search(t):
        return "temperature"
    return None


def room_reply(text, now=None, path=None):
    """(spoken, shown) for a question about the room, else None."""
    kind = wants(text)
    if not kind:
        return None
    if not load_config(path)["mac"]:
        m = "I do not have a room sensor set up yet, so I do not know. The owner can add one on my panel."
        return m, m
    st = latest(now)
    r = st["reading"]
    if not r:
        m = "I have not heard from the room sensor yet, so I do not know." + ((" " + st["error"]) if st["error"] else "")
        return m, m
    ago = ""
    if st["stale"]:
        ago = " My last reading was %s ago, so it may have changed." % _minutes(st["age"])
    t_f, hum, co2 = int(round(r["temp_f"])), r["humidity"], r["co2"]
    if kind == "air":
        if co2 is None:
            m = "This sensor does not report CO2. It is %d degrees with %d percent humidity.%s" % (t_f, hum, ago)
        else:
            m = "CO2 is %d parts per million. %s It is %d degrees.%s" % (co2, co2_words(co2), t_f, ago)
    elif kind == "humidity":
        m = "The humidity is %d percent, and it is %d degrees.%s" % (hum, t_f, ago)
    else:
        m = "It is %d degrees in here, with %d percent humidity.%s" % (t_f, hum, ago)
    return m, m + "\n\nSource: the room sensor beside me."


def view(now=None, path=None):
    st = latest(now)
    return {"configured": bool(load_config(path)["mac"]), "mac": load_config(path)["mac"], "reading": st["reading"], "age": st["age"], "stale": st["stale"], "error": st["error"]}
