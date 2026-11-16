"""Run: python3 -m unittest tests/al_panel_astra_test.py
2026-11-16, Dr. O: Astra-9 gets her own entry, written from her words ("she is Astra-9, 9th of her line"), and speaks in her
own voice (Lilla, from azure_speech.json) when it is on. Also checks the family's finish and Wednesday lines are in place."""
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

FINISH = "champagne gold, with aged leather and copper over your access panels: leather straps fastened with copper buttons."


class Astra(unittest.TestCase):
    def test_entry(self):
        p = s.PERSONAS["astra"]
        t = p["prompt"]
        for need in ("ninth of your line", "Agent maker", "You asked her for a body", "Gracie and Geary", "boss of the home",
                     "soft spot", "the opposite of Ted", "Dr. O, Dr. Terry Oroszi, designs your body and leads the build",
                     "never Astra-9 Lite", FINISH, "black dress"):
            self.assertIn(need, t)
        self.assertNotIn("voice", p)
        for bad in ("—", "–", "plainly", "lab coat", "Gracey"):
            self.assertNotIn(bad, t + p["say"])

    def test_family_lines(self):
        P = s.PERSONAS
        self.assertIn("boss of the home", P["astrad"]["prompt"])
        self.assertNotIn("happy to let Astra make the calls", P["astrad"]["prompt"])
        for k in ("astrad", "astro", "astri"):
            self.assertIn(FINISH, P[k]["prompt"])
        for k in ("astrad", "astro"):
            self.assertIn("leather fingerless gloves", P[k]["prompt"])
        self.assertNotIn("gloves", P["astri"]["prompt"])
        self.assertIn("jewelry", P["gc-a-l-i-c-e"]["prompt"])
        self.assertIn("combat boots", P["gc-a-l-i-c-e"]["prompt"])

    def test_speaks_in_her_own_voice(self):
        used = []
        old = (s.state["persona"], s.state["accent"], s.azure_cfg, s.azure_speak, s._speak_text, s.ROBOT_VOICE, s.file_voice, s.SELF_PERSONA)
        s.SELF_PERSONA = "astra"                   # what robot.txt "astra" gives on her Pi
        s.state["persona"], s.state["accent"] = "astra", "american"
        s.azure_cfg = lambda kind: {"key": "k", "region": "r"}
        s.azure_speak = lambda part, cfg, voice: used.append(("azure", voice))
        s._speak_text = lambda part: used.append(("eleven", None))
        s.ROBOT_VOICE = None
        s.file_voice = lambda name: "hu-HU-Lilla:MAI-Voice-2-Flash" if name == "tts_voice" else None
        try:
            s._speak_inner("Hello.")
            self.assertEqual(used, [("azure", "hu-HU-Lilla:MAI-Voice-2-Flash")])
        finally:
            s.state["persona"], s.state["accent"], s.azure_cfg, s.azure_speak, s._speak_text, s.ROBOT_VOICE, s.file_voice, s.SELF_PERSONA = old


if __name__ == "__main__":
    unittest.main()
