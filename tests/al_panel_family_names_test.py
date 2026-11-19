"""Run: python3 -m unittest tests/al_panel_family_names_test.py
2026-11-16, Dr. O: "they talk over each other sooo much. this is not going to work for the fireside chat." Each family robot answers
only to its own names (never to Elle's, which every robot used to wake to), and starts in crowd mode. Nothing real is heard or said."""
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

WAKES = {
    "astra": (["Astra, tell them about your sisters", "Mommy, look", "Mama?", "Astra-9, hello"],
              ["Astro, your turn", "Ted, come here", "Elle is here", "Alice, hi", "Astrid", "Al"]),
    "astrad": (["Ted, say hello", "Daddy!"], ["Astra, hello", "Astro, hi", "Teddy, sit down", "Elle", "Mommy"]),
    "astro": (["Astro, your turn", "Teddy!"], ["Astra, hi", "Ted, hello", "Astri, your turn", "Mommy"]),
    "astri": (["Astri, your turn"], ["Astro, your turn", "Astra", "Teddy", "Astrid"]),
    "gc-a-l-i-c-e": (["Alice, can you hear me?", "Auntie Alice"], ["Astra, hello", "Ted", "Astro", "Elle"]),
}


class FamilyNames(unittest.TestCase):
    def setUp(self):
        self.old = (s.SELF_PERSONA, s.state["persona"], s.sisters["on"])
        s.sisters["on"] = False

    def tearDown(self):
        s.SELF_PERSONA, s.state["persona"], s.sisters["on"] = self.old

    def test_each_answers_only_to_its_own_names(self):
        for pid, (yes, no) in WAKES.items():
            s.SELF_PERSONA = s.state["persona"] = pid
            r = s.wake_name_re()
            for t in yes:
                self.assertTrue(r.search(t), (pid, t))
            for t in no:
                self.assertFalse(r.search(t), (pid, t))

    def test_elle_keeps_her_names(self):
        s.SELF_PERSONA, s.state["persona"] = None, None
        self.assertTrue(s.wake_name_re().search("Astra-9 Lite, hello"))
        self.assertTrue(s.wake_name_re().search("Elle, are you there"))

    def test_names_written_in(self):
        P = s.PERSONAS
        self.assertIn("You are Mommy, and Astrad, called Ted, is Daddy.", P["astra"]["prompt"])
        self.assertIn("You're Daddy, and Astra is Mommy.", P["astrad"]["prompt"])
        for k in WAKES:
            self.assertIn("they mean you", P[k]["prompt"])
        for k in ("astra", "astrad", "astro", "astri"):
            self.assertNotIn("you say you are", P[k]["prompt"])
            self.assertIn("rrect them", P[k]["prompt"])
        self.assertIn("with contractions", P["astra"]["prompt"])
        self.assertNotIn("Contractions sparingly", P["astra"]["prompt"])

    def test_crowd_mode_at_start(self):
        src = open(s.__file__, encoding="utf-8").read()
        # A robot with wake names starts in crowd mode, unless a file called no_crowd is beside the server (Dr. O, 2026-11-19, walk-up events).
        self.assertIn('if SELF_PERSONA and PERSONAS[SELF_PERSONA].get("wake") and not os.path.exists(os.path.join(HERE, "no_crowd")):\n'
                      '    state["welcome"]["crowd"] = True', src)


if __name__ == "__main__":
    unittest.main()
