"""Run: python3 -m unittest tests/al_panel_astrad_test.py
2026-11-15, Dr. O: Astrad (Ted) said he was Astra-9 Lite because his body never had a character of its own. Checks his entry is there,
can be made his main character, and that his written facts are hers: Cincinnati Reds, Dr. O leads the build, no long dashes."""
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


class Astrad(unittest.TestCase):
    def test_entry(self):
        p = s.PERSONAS["astrad"]
        t = p["prompt"]
        self.assertIn("Cincinnati Reds", t)
        self.assertIn("Dr. O, Dr. Terry Oroszi, designs your body and leads the build", t)
        self.assertIn("never Astra-9 Lite", t)
        for bad in ("—", "–", "plainly"):
            self.assertNotIn(bad, t + p["say"])

    def test_speaks_in_the_robots_own_voice(self):
        # "ted is using Elle's voice": with his character on he must still go to Azure (Christopher), not ElevenLabs.
        self.assertNotIn("voice", s.PERSONAS["astrad"])
        used = []
        old = (s.state["persona"], s.state["accent"], s.azure_cfg, s.azure_speak, s._speak_text, s.ROBOT_VOICE, s.file_voice, s.SELF_PERSONA)
        s.SELF_PERSONA = "astrad"                  # what robot.txt "astrad" gives on his Pi
        self.assertTrue(s.is_self("astrad"))
        self.assertFalse(s.is_self("astro"))
        s.state["persona"], s.state["accent"] = "astrad", "american"
        s.azure_cfg = lambda kind: {"key": "k", "region": "r"}
        s.azure_speak = lambda part, cfg, voice: used.append(("azure", voice))
        s._speak_text = lambda part: used.append(("eleven", s.al.AL_VOICE_ID))
        s.ROBOT_VOICE = None
        s.file_voice = lambda name: "en-US-ChristopherNeural" if name == "tts_voice" else None
        try:
            s._speak_inner("Hey there.")
            self.assertEqual(used, [("azure", "en-US-ChristopherNeural")])
            used.clear()
            s.state["persona"] = "astro"           # a guest character on his Pi is unchanged: ElevenLabs
            s._speak_inner("Hi!")
            self.assertEqual([u[0] for u in used], ["eleven"])
            used.clear()
            s.SELF_PERSONA, s.state["persona"] = "gc-a-l-i-c-e", "gc-a-l-i-c-e"   # A.L.I.C.E. keeps her own written voice
            s._speak_inner("Hello.")
            self.assertEqual(used, [("eleven", s.PERSONAS["gc-a-l-i-c-e"]["voice"])])
        finally:
            s.state["persona"], s.state["accent"], s.azure_cfg, s.azure_speak, s._speak_text, s.ROBOT_VOICE, s.file_voice, s.SELF_PERSONA = old

    def test_alice_only_rules_stay_with_alice(self):
        self.assertFalse(s.IS_ALICE)             # no robot.txt in this test: not ALICE, so Azure is allowed
        src = open(s.__file__, encoding="utf-8").read()
        self.assertIn("if IS_ALICE:\n        return None", src)
        self.assertIn("cues.which_set(IS_ALICE)", src)
        self.assertIn("seat_for(HERE, IS_ALICE)", src)

    def test_can_be_his_main_character(self):
        c = s.app.test_client()
        r = c.post("/api/personality/main", json={"id": "astrad"})
        self.assertEqual(r.status_code, 200, r.get_data(as_text=True))


if __name__ == "__main__":
    unittest.main()
