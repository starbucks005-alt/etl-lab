"""Run: python3 -m unittest tests/al_panel_voices_test.py
Needs Flask. The robot's own script (~/al.py) is replaced by a stand-in, and the microphone and the listening service by stand-ins, so nothing real is touched."""
import os, sys, tempfile, unittest

try:
    import flask  # noqa: F401
except ImportError:
    raise unittest.SkipTest("Flask is not installed")

HOME = tempfile.mkdtemp()
with open(os.path.join(HOME, "al.py"), "w") as f:
    f.write('AL_SYSTEM_PROMPT = "You are Elle."\nANTHROPIC_WORKSPACE_ID = "x"\ndef get_al_reply(ask): return "ok"\ndef __getattr__(name): return None\n')
os.environ["HOME"] = HOME
sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "al-panel", "pi"))
import al_panel_server as s  # noqa: E402
import al_voices as vc  # noqa: E402

VEC = {"terry": [1, 0, 0, 0], "terry_again": [0.97, 0.24, 0, 0], "stranger": [0.2, 0.2, 0.95, 0]}


class PanelVoices(unittest.TestCase):
    def setUp(self):
        self.d = tempfile.mkdtemp()
        vc.VOICE_FILE = os.path.join(self.d, "voices.json")
        vc.EMBEDDER = lambda p: VEC.get(os.path.basename(p).split(".")[0], VEC["terry"])
        self.clips = []
        self.c = s.app.test_client()
        self.heard = "My name is Terry. I agree that this robot may remember my voice. And so on."
        s._transcribe_words = lambda path=None: self.heard
        s.record_clip = lambda path=None, seconds=None: (self.clips.append(path), open(path, "wb").close())
        s.grab_mic = lambda: s.listen_lock.acquire(blocking=False)
        s.write_eyes = lambda boost=False: None
        s.speaker.update(name=None, score=0.0, at=0.0)
        s.state["persona"] = None

    def test_starts_off_and_ready(self):
        j = self.c.get("/api/voices").get_json()
        self.assertFalse(j["on"])
        self.assertTrue(j["ready"])
        self.assertEqual(j["people"], [])

    def test_record_needs_the_tick(self):
        r = self.c.post("/api/voices/record", json={"name": "Terry"})
        self.assertEqual(r.status_code, 400)

    def test_record_needs_the_agreement_to_be_said(self):
        self.heard = "Hello Elle how are you"
        r = self.c.post("/api/voices/record", json={"name": "Terry", "consent": True})
        self.assertEqual(r.status_code, 400)
        self.assertIn("did not hear the agreement", r.get_json()["error"])
        self.assertEqual(vc.people(), [])

    def test_record_registers_and_leaves_no_clip(self):
        r = self.c.post("/api/voices/record", json={"name": "Terry", "consent": True})
        self.assertEqual(r.status_code, 200, r.get_json())
        self.assertEqual([p["name"] for p in vc.people()], ["Terry"])
        self.assertEqual(len(self.clips), 1)
        self.assertFalse(os.path.exists(self.clips[0]))           # the recording is gone

    def test_bad_name_is_refused(self):
        r = self.c.post("/api/voices/record", json={"name": "<b>", "consent": True})
        self.assertEqual(r.status_code, 400)

    def test_a_registered_voice_reaches_the_reply_only_when_on(self):
        vc.EMBEDDER = lambda p: VEC["terry"]
        vc.enroll("Terry", "x")
        vc.EMBEDDER = lambda p: VEC["terry_again"]
        s._transcribe_words = lambda path=None: "hello"
        s.transcribe("any.wav")                                   # off: nothing is compared
        self.assertIsNone(s.speaker["name"])
        self.assertNotIn("Voice match", s.context_for("hello"))
        vc.set_on(True)
        self.assertEqual(s.transcribe("any.wav"), "hello")        # on: the words come back as before
        self.assertEqual(s.speaker["name"], "Terry")
        self.assertIn("Voice match: that sounded like Terry", s.context_for("hello"))

    def test_a_stranger_is_not_named(self):
        vc.EMBEDDER = lambda p: VEC["terry"]
        vc.enroll("Terry", "x")
        vc.set_on(True)
        vc.EMBEDDER = lambda p: VEC["stranger"]
        s.transcribe("any.wav")
        self.assertIsNone(s.speaker["name"])
        self.assertNotIn("Voice match", s.context_for("hello"))

    def test_a_character_is_never_told(self):
        vc.EMBEDDER = lambda p: VEC["terry"]
        vc.enroll("Terry", "x")
        vc.set_on(True)
        s.transcribe("any.wav")
        s.state["persona"] = "gc-arch"
        self.assertNotIn("Voice match", s.context_for("hello"))

    def test_forget(self):
        vc.EMBEDDER = lambda p: VEC["terry"]
        vc.enroll("Terry", "x")
        r = self.c.post("/api/voices/forget", json={"name": "terry"})
        self.assertTrue(r.get_json()["forgot"])
        self.assertEqual(vc.people(), [])

    def test_upload_needs_the_tick_and_a_file(self):
        self.assertEqual(self.c.post("/api/voices/upload", data={"name": "Terry"}).status_code, 400)
        self.assertEqual(self.c.post("/api/voices/upload", data={"name": "Terry", "consent": "yes"}).status_code, 400)


if __name__ == "__main__":
    unittest.main()
