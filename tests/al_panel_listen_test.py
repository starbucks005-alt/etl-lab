"""Run: python3 -m unittest tests/al_panel_listen_test.py
2026-11-15, Astro: his always listening stopped for good at the same second as a FileNotFoundError on the eye file, and only a
restart brought it back. These check that eye-file writes from many threads at once do not fail, and that one error inside a
listening pass does not end listening. Needs Flask; the robot's own script is replaced by a stand-in."""
import os, sys, tempfile, threading, time, unittest

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


class EyeFile(unittest.TestCase):
    def test_many_threads_write_at_once(self):
        old = s.EYES_FILE
        s.EYES_FILE = os.path.join(tempfile.mkdtemp(), "al_eyes.json")
        errors = []

        def burst():
            try:
                for _ in range(200):
                    s.write_eyes()
            except Exception as e:      # the old shared .tmp name failed here
                errors.append(e)
        try:
            ts = [threading.Thread(target=burst) for _ in range(6)]
            [t.start() for t in ts]
            [t.join() for t in ts]
            self.assertEqual(errors, [])
            self.assertTrue(os.path.exists(s.EYES_FILE))
            self.assertEqual([n for n in os.listdir(os.path.dirname(s.EYES_FILE)) if n.endswith(".tmp")], [], "no leftover temporary files")
        finally:
            s.EYES_FILE = old


class ListeningKeepsGoing(unittest.TestCase):
    def test_an_error_in_one_pass_does_not_stop_listening(self):
        calls = {"n": 0}
        old_once, old_sleep = s._watch_names_once, s.time.sleep

        class Done(BaseException):
            pass

        def once():
            calls["n"] += 1
            if calls["n"] == 1:
                raise FileNotFoundError("al_eyes.json.tmp")
            raise Done()
        s._watch_names_once = once
        s.time.sleep = lambda x: None
        try:
            with self.assertRaises(Done):
                s.watch_names()
        finally:
            s._watch_names_once, s.time.sleep = old_once, old_sleep
        self.assertEqual(calls["n"], 2, "after the error it went round again")


if __name__ == "__main__":
    unittest.main()
