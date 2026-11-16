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

    def test_can_be_his_main_character(self):
        c = s.app.test_client()
        r = c.post("/api/personality/main", json={"id": "astrad"})
        self.assertEqual(r.status_code, 200, r.get_data(as_text=True))


if __name__ == "__main__":
    unittest.main()
