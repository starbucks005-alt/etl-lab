"""Run: python3 -m unittest tests/al_panel_game_test.py
2026-11-16, Dr. O: "the twins will speak from their own bodies, not the tablet". The tablet asks a twin to say a game line; the twin
says it out of its own speaker. The first time costs one speech request, after that it is replayed from the robot for nothing.
Only lines written for that twin can be said. Nothing real is played or sent."""
import os, sys, tempfile, unittest

try:
    import flask  # noqa: F401
except ImportError:
    raise unittest.SkipTest("Flask is not installed")

HOME = tempfile.mkdtemp()
with open(os.path.join(HOME, "al.py"), "w") as f:
    f.write('AL_SYSTEM_PROMPT = "You are Elle."\nANTHROPIC_WORKSPACE_ID = "x"\ndef get_al_reply(ask): return "ok"\ndef __getattr__(name): return None\n')
os.environ["HOME"] = HOME
os.environ["USERPROFILE"] = HOME
sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "al-panel", "pi"))
import al_panel_server as s  # noqa: E402


class Game(unittest.TestCase):
    def setUp(self):
        self.old = (s.ROBOT_ID, s.azure_cfg, s.azure_wav, s.subprocess.run, s.LINE_CACHE, s.ROBOT_VOICE, s.state["persona"], s.state["accent"], s.file_voice, s.game["until"])
        s.ROBOT_ID = "astro"
        s.LINE_CACHE = tempfile.mkdtemp()
        s.ROBOT_VOICE = None
        s.state["persona"], s.state["accent"] = None, "american"
        s.azure_cfg = lambda kind: ("k", "r")
        s.file_voice = lambda name: "en-US-AnaNeural" if name == "tts_voice" else None
        self.made, self.played = [], []
        s.azure_wav = lambda text, cfg, voice: self.made.append((text, voice)) or b"RIFFfake"
        s.subprocess.run = lambda cmd, **k: self.played.append(cmd)
        self.c = s.app.test_client()

    def tearDown(self):
        (s.ROBOT_ID, s.azure_cfg, s.azure_wav, s.subprocess.run, s.LINE_CACHE, s.ROBOT_VOICE, s.state["persona"], s.state["accent"], s.file_voice, s.game["until"]) = self.old

    def test_said_once_then_free(self):
        r = self.c.post("/api/game/line", json={"line": "c4"})
        self.assertEqual(r.status_code, 200, r.get_json())
        self.assertEqual(r.get_json()["text"], "In the middle! Right in the middle!")
        self.assertFalse(r.get_json()["kept"])
        r = self.c.post("/api/game/line", json={"line": "c4"})
        self.assertTrue(r.get_json()["kept"])
        self.assertEqual(len(self.made), 1)                 # one request to the speech service, two plays
        self.assertEqual(len(self.played), 2)
        self.assertEqual(self.played[0][:4], ["aplay", "-q", "-D", s.PLAY_DEVICE])

    def test_only_its_own_lines(self):
        self.assertEqual(self.c.post("/api/game/line", json={"line": "nope"}).status_code, 404)
        self.assertEqual(self.c.post("/api/game/line", json={"line": "Say something rude"}).status_code, 404)
        s.ROBOT_ID = "astra"                                 # not a twin: no game lines at all
        self.assertEqual(self.c.post("/api/game/line", json={"line": "c4"}).status_code, 404)
        self.assertEqual(self.made, [])

    def test_quiet_during_the_game(self):
        s.game["until"] = 0
        self.assertFalse(s.is_quiet())
        self.c.post("/api/game/line", json={"line": "cheer"})
        self.assertTrue(s.is_quiet())                       # "Good one, Astri!" does not set the other twin answering

    def test_pages(self):
        self.assertEqual(self.c.get("/twins.html").status_code, 200)
        self.assertIn("astro", self.c.get("/twins-lines.json").get_json()["twins"])

    def test_tablet_on_tailscale_may_ask(self):
        r = self.c.get("/api/robot", headers={"Origin": "http://astro.example-net.ts.net:8000"})
        self.assertEqual(r.headers.get("Access-Control-Allow-Origin"), "http://astro.example-net.ts.net:8000")
        r = self.c.get("/api/robot", headers={"Origin": "https://evil.example.com"})
        self.assertIsNone(r.headers.get("Access-Control-Allow-Origin"))


if __name__ == "__main__":
    unittest.main()
