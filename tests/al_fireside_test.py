"""Three pretend robots and the real director: one speaks at a time, and the host is in charge.
Run: python3 -m unittest tests/al_fireside_test.py   (needs node and requests; takes under a minute)"""
import os, shutil, socket, subprocess, sys, threading, time, unittest

try:
    import requests
except ImportError:
    raise unittest.SkipTest("requests is not installed")
if not shutil.which("node"):
    raise unittest.SkipTest("node is not installed")

ROOT = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..")
sys.path.insert(0, os.path.join(ROOT, "al-panel", "pi"))
import al_fireside  # noqa: E402


class Robot:
    def __init__(self, seat, name, room, talk):
        self.seat, self.name, self.room, self.talk = seat, name, room, talk
        self.on_seen, self.asks, self.cutoff = [], [], threading.Event()
        self.n = 0
        self.f = al_fireside.Fireside(seat, name, self.post, self.think, self.speak, self.cut, on_change=self.on_seen.append,
                                      here=room["dir"], log=lambda t: None)

    def post(self, url, body):
        r = requests.post(url, json=body, timeout=5)
        return r.json() if r.status_code == 200 else None

    def think(self, ask):
        self.asks.append(ask)
        time.sleep(0.3)
        self.n += 1
        return "%s, turn %d. %s" % (self.name, self.n, self.talk)

    def speak(self, words):
        self.cutoff.clear()
        start = time.time()
        self.room["log"].append(("start", self.seat, start))
        cut = self.cutoff.wait(self.room["speak_s"])
        self.room["log"].append(("cut" if cut else "end", self.seat, time.time()))

    def cut(self):
        self.cutoff.set()


class ThreeRobots(unittest.TestCase):
    def setUp(self):
        s = socket.socket(); s.bind(("127.0.0.1", 0)); self.port = s.getsockname()[1]; s.close()
        self.srv = subprocess.Popen(["node", os.path.join(ROOT, "tests", "fireside_test_server.js"), str(self.port)], stdout=subprocess.PIPE)
        self.srv.stdout.readline()
        al_fireside.URL = "http://127.0.0.1:%d/" % self.port
        self.room = {"log": [], "speak_s": 1.2, "dir": os.path.dirname(os.path.abspath(__file__))}
        self.bots = [Robot("alice", "ALICE", self.room, "Elle, what do you think?"),
                     Robot("elle", "Elle", self.room, "Lumvivo, your turn."),
                     Robot("lumvivo", "Reggie", self.room, "I like walks.")]
        for b in self.bots:
            threading.Thread(target=b.f.run, daemon=True).start()

    def tearDown(self):
        self.srv.kill()
        self.srv.wait()
        self.srv.stdout.close()

    def host(self, action, **kw):
        r = requests.post(al_fireside.URL, json=dict(action=action, code="fire", **kw), timeout=5)
        self.assertEqual(r.status_code, 200, r.text)
        return r.json()

    def wait_for(self, cond, secs):
        t0 = time.time()
        while time.time() - t0 < secs:
            if cond():
                return True
            time.sleep(0.1)
        return False

    def speakers(self):
        return [e for e in self.room["log"] if e[0] == "start"]

    def test_the_room(self):
        time.sleep(1.5)                                     # their first look finds no chat, so they look again in 20 seconds
        self.host("start", topic="almost human", order=["alice", "elle", "lumvivo"])
        self.assertTrue(self.wait_for(lambda: len(self.speakers()) >= 4, 45), "they join within 20 seconds and take turns")
        self.assertTrue(all(b.on_seen and b.on_seen[0] is True for b in self.bots), "each one knew the chat had started")
        self.assertEqual([e[1] for e in self.speakers()[:3]], ["alice", "elle", "lumvivo"], "ALICE opens, and the one named answers")
        self.assertIn("Open the chat", self.bots[0].asks[0])
        self.assertIn('ALICE: "ALICE, turn 1. Elle, what do you think?"', self.bots[1].asks[0], "Elle is told what ALICE said")

        # stop now, while one of them is speaking: she is cut off and nobody starts
        self.assertTrue(self.wait_for(lambda: self.room["log"][-1][0] == "start", 10))
        talking = self.room["log"][-1][1]
        self.host("hold")
        self.assertTrue(self.wait_for(lambda: self.room["log"][-1][:2] == ("cut", talking), 3), "the speaker is cut off within a few seconds")
        n = len(self.speakers())
        time.sleep(4)
        self.assertEqual(len(self.speakers()), n, "while the floor is the host's, nobody speaks")

        # the host asks Elle a question
        self.host("ask", seat="elle", prompt="What would you like to learn?")
        self.assertTrue(self.wait_for(lambda: len(self.speakers()) > n, 8))
        self.assertEqual(self.speakers()[n][1], "elle")
        self.assertIn('Dr. Oroszi asks you: "What would you like to learn?"', self.bots[1].asks[-1])

        # end it
        self.host("end")
        self.assertTrue(self.wait_for(lambda: all(b.on_seen[-1] is False for b in self.bots), 5), "each one knew the chat had ended")

        # nobody ever spoke over anybody
        talking_now = None
        for kind, seat, t in self.room["log"]:
            if kind == "start":
                self.assertIsNone(talking_now, "%s started while %s was speaking" % (seat, talking_now))
                talking_now = seat
            else:
                self.assertEqual(talking_now, seat)
                talking_now = None


if __name__ == "__main__":
    unittest.main()
