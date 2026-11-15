"""Run: python3 -m unittest tests/al_panel_motion_test.py
2026-11-15, Dr. O: motion detection and welcome OFF by default, with a way to switch them, on one robot or every robot.
Needs Flask. The robot's own script (~/al.py) is replaced by a stand-in, and the website by a stand-in, so nothing real is touched."""
import os, sys, tempfile, unittest

try:
    import flask  # noqa: F401
except ImportError:
    raise unittest.SkipTest("Flask is not installed")

HOME = tempfile.mkdtemp()
with open(os.path.join(HOME, "al.py"), "w") as f:
    f.write('AL_SYSTEM_PROMPT = "You are Elle."\nANTHROPIC_WORKSPACE_ID = "x"\ndef get_al_reply(ask): return "ok"\ndef __getattr__(name): return None\n')
os.environ["HOME"] = HOME
os.environ["USERPROFILE"] = HOME      # so it also runs on Windows
sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "al-panel", "pi"))
import al_panel_server as s  # noqa: E402


class Answer:
    def __init__(self, j, code=200):
        self.j, self.status_code = j, code

    def json(self):
        return self.j


class Motion(unittest.TestCase):
    def setUp(self):
        s.motion_on.update(on=False, all_rev=None)
        self.c = s.app.test_client()

    def test_off_when_it_starts(self):
        self.assertFalse(s.motion_on["on"])
        self.assertFalse(self.c.get("/api/motion").get_json()["on"])
        self.assertFalse(self.c.get("/api/welcome").get_json()["motion_on"])

    def test_this_robot_on_and_off(self):
        self.assertTrue(self.c.post("/api/motion", json={"on": True}).get_json()["on"])
        self.assertTrue(s.motion_on["on"])
        self.assertFalse(self.c.post("/api/motion", json={"on": False}).get_json()["on"])
        self.assertEqual(self.c.post("/api/motion", json={"on": "yes"}).status_code, 400)

    def test_every_robot_switch_set_before_start_is_not_obeyed(self):
        s._motion_from_site({"all": {"motion": {"on": True, "rev": 4}}})
        self.assertFalse(s.motion_on["on"], "a robot always starts off, whatever was set before")
        s._motion_from_site({"all": {"motion": {"on": True, "rev": 4}}})
        self.assertFalse(s.motion_on["on"], "the same switch again changes nothing")
        s._motion_from_site({"all": {"motion": {"on": True, "rev": 5}}})
        self.assertTrue(s.motion_on["on"], "a new every-robot switch is obeyed")
        s._motion_from_site({"all": {"motion": {"on": False, "rev": 6}}})
        self.assertFalse(s.motion_on["on"])
        s._motion_from_site({"ok": True})
        self.assertFalse(s.motion_on["on"], "an answer from an older website changes nothing")

    def test_every_robot_from_this_panel(self):
        sent = []
        key = os.path.join(tempfile.mkdtemp(), "checkin_key.txt")
        open(key, "w").write("k1")
        old = (s.CHECKIN_KEY_FILE, s.ROBOT_ID, s.requests.post)
        s.CHECKIN_KEY_FILE, s.ROBOT_ID = key, "astro"
        s.requests.post = lambda url, json=None, headers=None, timeout=None: (sent.append((json, headers)), Answer({"ok": True, "all": {"motion": {"on": True, "rev": 9}}}))[1]
        try:
            j = self.c.post("/api/motion/all", json={"on": True}).get_json()
        finally:
            s.CHECKIN_KEY_FILE, s.ROBOT_ID, s.requests.post = old
        self.assertTrue(j["sent"])
        self.assertTrue(s.motion_on["on"])
        self.assertEqual(sent[0][0], {"id": "astro", "set_motion": True})
        self.assertEqual(s.motion_on["all_rev"], 9, "its own switch is remembered, so it is not obeyed twice")

    def test_every_robot_without_a_code_still_switches_this_one(self):
        old = s.CHECKIN_KEY_FILE
        s.CHECKIN_KEY_FILE = os.path.join(tempfile.mkdtemp(), "none.txt")
        try:
            j = self.c.post("/api/motion/all", json={"on": True}).get_json()
        finally:
            s.CHECKIN_KEY_FILE = old
        self.assertFalse(j["sent"])
        self.assertTrue(s.motion_on["on"])


if __name__ == "__main__":
    unittest.main()
