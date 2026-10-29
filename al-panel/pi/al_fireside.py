"""The fireside chat, on the robot's side. 2026-10-29, Dr. O: "a way to control the room when I have alice the robot, Astra Lite (Elle), and the
Holopod (Lumvivo) all talking ... stops them from overlapping conversation."

The director is on the website (netlify/functions/fireside.js) and the host runs it from good-company/fireside.html. This asks the director
what to do: every 20 seconds between chats, every second during one. While a chat is on she does nothing by herself (the server treats it like
quiet: no listening, no hello, no reminders). When the director gives her the turn it hands her the words to answer; she thinks, checks that the
turn is still hers, speaks, and says she has finished. If the host presses Stop, or the director moves on, she is cut off.

A file called no_fireside beside the server switches all of this off. fireside.json beside it can set {"seat": "alice", "name": "ALICE"}.
Tested here with stand-ins for the website, her thinking and her voice. NOT TRIED on the robots."""
import json
import os
import threading
import time

URL = "https://emerging-tech-lab.com/.netlify/functions/fireside"
ROOM = "etl-fireside"


class Fireside:
    def __init__(self, seat, name, post, think, speak, cut, on_change=None, here=".", log=print):
        """post(url, body) -> dict or None. think(ask) -> words. speak(words) returns when she has finished. cut() stops her voice now."""
        self.seat, self.name = seat, name
        self.post, self.think, self.speak, self.cut = post, think, speak, cut
        self.on_change = on_change or (lambda on: None)
        self.here, self.log = here, log
        self.on = False
        self.stop = 0               # the director's stop count, as last seen
        self.turn = None            # {"id", "stop"} while she has a turn
        self.seen = set()
        self.lock = threading.Lock()

    def call(self, action, **kw):
        body = dict(action=action, room=ROOM, seat=self.seat, name=self.name, **kw)
        try:
            return self.post(URL, body)
        except Exception as e:
            self.log("FIRESIDE could not reach the director (%s)" % str(e)[:80])
            return None

    def off(self):
        return os.path.exists(os.path.join(self.here, "no_fireside"))

    def once(self):
        """One question to the director. Returns how many seconds to wait before the next."""
        if self.off():
            if self.on:
                self._set_on(False)
            return 20
        v = self.call("poll")
        if not v or "on" not in v:
            return 5 if self.on else 20
        if bool(v["on"]) != self.on:
            self._set_on(bool(v["on"]))
        self.stop = int(v.get("stop") or 0)
        cue = v.get("cue")
        with self.lock:
            t = self.turn
            if t and (self.stop > t["stop"] or not v["on"] or not cue or cue.get("id") != t["id"]):
                self.log("FIRESIDE cut off: the host stopped her or the floor moved on")
                t["cancel"] = True
                self.turn = None
                try:
                    self.cut()
                except Exception:
                    pass
            if v["on"] and cue and cue.get("id") and cue["id"] not in self.seen and not self.turn:
                self.seen.add(cue["id"])
                self.turn = {"id": cue["id"], "stop": self.stop, "cancel": False}
                threading.Thread(target=self._take_turn, args=(self.turn, cue.get("ask") or ""), daemon=True).start()
        return max(1, int(v.get("every") or (1 if self.on else 20)))

    def _set_on(self, on):
        self.on = on
        self.log("FIRESIDE %s" % ("started: she waits for her turn and does nothing by herself" if on else "ended: back to normal"))
        try:
            self.on_change(on)
        except Exception as e:
            self.log("FIRESIDE change problem: %s" % e)

    def _still_mine(self, t):
        if t["cancel"]:
            return False
        v = self.call("poll")
        if v is None:
            return True             # the website did not answer this once; the turn was hers a moment ago
        return bool(v.get("on")) and (v.get("cue") or {}).get("id") == t["id"] and int(v.get("stop") or 0) <= t["stop"]

    def _take_turn(self, t, ask):
        said = ""
        try:
            self.log("FIRESIDE her turn")
            said = (self.think(ask) or "").strip()
            if not said or not self._still_mine(t):
                if not said:
                    self.call("done", cue=t["id"], said="")
                return
            self.call("speaking", cue=t["id"])
            self.speak(said)
            if not t["cancel"]:
                self.call("done", cue=t["id"], said=said)
        except Exception as e:
            self.log("FIRESIDE turn problem: %s" % e)
            if not t["cancel"]:
                self.call("done", cue=t["id"], said="")
        finally:
            with self.lock:
                if self.turn is t:
                    self.turn = None

    def run(self):
        while True:
            try:
                wait = self.once()
            except Exception as e:
                self.log("FIRESIDE problem: %s" % e)
                wait = 5
            time.sleep(wait)


def seat_for(here, is_alice):
    """ALICE's Pi (the one with her page) is "alice", Astra Lite's is "elle". fireside.json can say otherwise."""
    seat, name = ("alice", "ALICE") if is_alice else ("elle", "Elle")
    try:
        d = json.load(open(os.path.join(here, "fireside.json")))
        seat = str(d.get("seat") or seat)[:20]
        name = str(d.get("name") or name)[:30]
    except (OSError, ValueError):
        pass
    return seat, name
