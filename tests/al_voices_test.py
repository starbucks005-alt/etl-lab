"""Run: python3 -m unittest tests/al_voices_test.py   (stand-in fingerprints, no model needed)"""
import os, sys, tempfile, unittest

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "al-panel", "pi"))
import al_voices as vc  # noqa: E402

# a "clip" is just a name here, and the stand-in embedder turns it into a fixed vector
VEC = {"terry1": [1, 0, 0, 0], "terry2": [0.96, 0.28, 0, 0], "sam1": [0, 1, 0, 0], "stranger": [0.3, 0.3, 0.9, 0.0],
       "near_both": [0.7, 0.7, 0, 0]}


class Voices(unittest.TestCase):
    def setUp(self):
        self.d = tempfile.mkdtemp()
        vc.VOICE_FILE = os.path.join(self.d, "voices.json")
        vc.EMBEDDER = lambda p: VEC[p]

    def test_nobody_registered_does_nothing(self):
        self.assertIsNone(vc.identify("terry1"))

    def test_registered_voice_is_named(self):
        vc.enroll("Terry", "terry1")
        r = vc.identify("terry2")
        self.assertEqual(r["name"], "Terry")

    def test_unknown_voice_is_not_guessed(self):
        vc.enroll("Terry", "terry1")
        r = vc.identify("stranger")
        self.assertIsNone(r["name"])

    def test_two_close_voices_are_not_mixed_up(self):
        vc.enroll("Terry", "terry1")
        vc.enroll("Sam", "sam1")
        self.assertIsNone(vc.identify("near_both")["name"])
        self.assertEqual(vc.identify("sam1")["name"], "Sam")

    def test_second_clip_is_added_not_a_second_person(self):
        self.assertEqual(vc.enroll("Terry", "terry1"), 1)
        self.assertEqual(vc.enroll("terry", "terry2"), 2)
        self.assertEqual(len(vc.people()), 1)

    def test_nothing_but_numbers_and_a_name_is_kept(self):
        vc.enroll("Terry", "terry1")
        text = open(vc.VOICE_FILE).read()
        self.assertNotIn("wav", text.lower())
        self.assertEqual([k for k in vc.people()[0]], ["name", "clips", "created"])

    def test_forget(self):
        vc.enroll("Terry", "terry1")
        self.assertTrue(vc.forget("TERRY"))
        self.assertEqual(vc.people(), [])
        self.assertFalse(vc.forget("Terry"))

    def test_names(self):
        self.assertEqual(vc.clean_name("  Dr.  Terry "), "")      # a full stop is not allowed
        self.assertEqual(vc.clean_name("Mary-Jo O'Neil"), "Mary-Jo O'Neil")
        self.assertEqual(vc.clean_name("Sam<script>"), "")
        self.assertEqual(vc.clean_name(""), "")
        with self.assertRaises(ValueError):
            vc.enroll("<b>", "terry1")

    def test_consent_line(self):
        self.assertTrue(vc.consent_ok("My name is Terry. I agree that this robot may remember my voice."))
        self.assertTrue(vc.consent_ok("i agree this robot can remember my voice"))
        self.assertFalse(vc.consent_ok("Hello Elle, how are you today"))
        self.assertFalse(vc.consent_ok(""))

    def test_on_off(self):
        self.assertFalse(vc.is_on())
        vc.set_on(True)
        self.assertTrue(vc.is_on())


if __name__ == "__main__":
    unittest.main()
