import os
import tempfile
import unittest

import al_photo as ph
import al_sentry as sn


class SilentPhoto(unittest.TestCase):
    def setUp(self):
        d = tempfile.mkdtemp()
        self.folder = os.path.join(d, "photos")
        self.line = os.path.join(d, "line.wav")
        self.played = []
        self.slept = []

    def shoot(self, **kw):
        return ph.take_photo(play=lambda: self.played.append(1), capture_fn=lambda p: open(p, "wb").write(b"jpg"),
                             sleep=lambda s: self.slept.append(s), folder=self.folder, line_file=self.line, **kw)

    def test_the_default_still_says_it_first_and_needs_the_line(self):
        r = self.shoot()
        self.assertFalse(r["ok"])
        self.assertIn("spoken line is missing", r["why"])
        self.assertEqual(self.played, [])
        open(self.line, "wb").write(b"x")
        r = self.shoot()
        self.assertTrue(r["ok"])
        self.assertEqual(self.played, [1])
        self.assertEqual(len(self.slept), 1)

    def test_a_failed_announcement_still_means_no_photo(self):
        open(self.line, "wb").write(b"x")
        def boom():
            raise OSError("speaker busy")
        r = ph.take_photo(play=boom, capture_fn=lambda p: open(p, "wb").write(b"jpg"), sleep=lambda s: None, folder=self.folder, line_file=self.line)
        self.assertFalse(r["ok"])

    def test_silent_says_nothing_waits_for_nothing_and_needs_no_line(self):
        r = self.shoot(silent=True)
        self.assertTrue(r["ok"])
        self.assertEqual(self.played, [])
        self.assertEqual(self.slept, [])
        self.assertTrue(os.path.isfile(os.path.join(self.folder, r["name"])))


class SilentSentry(unittest.TestCase):
    def setUp(self):
        d = tempfile.mkdtemp()
        self.st, self.al = os.path.join(d, "s.json"), os.path.join(d, "a.json")
        sn._last_alert[0] = 0.0
        self.calls = []

    def arm(self, now=1000):
        sn.set_armed(True, now=now, path=self.st)

    def motion(self, now=2000, silent_fn=True):
        return sn.on_motion(lambda: self.calls.append("announced") or {"ok": True, "name": "a.jpg"},
                            alarm_fn=lambda: self.calls.append("alarm"), clock=lambda: now, state_path=self.st, alerts_path=self.al,
                            silent_fn=(lambda: self.calls.append("silent") or {"ok": True, "name": "s.jpg"}) if silent_fn else None)

    def test_silent_is_off_by_default_so_the_photo_is_announced(self):
        self.arm()
        self.assertFalse(sn.load_state(self.st)["silent"])
        r = self.motion()
        self.assertEqual(self.calls, ["announced"])
        self.assertFalse(r["silent"])

    def test_the_owner_must_tick_to_switch_it_on(self):
        with self.assertRaises(ValueError):
            sn.set_silent(True, ack=False, path=self.st)
        self.assertFalse(sn.load_state(self.st)["silent"])
        s = sn.set_silent(True, ack=True, now=500, path=self.st)
        self.assertTrue(s["silent"])
        self.assertEqual(sn.load_state(self.st)["silent_ack_t"], 500)

    def test_a_silent_flag_without_the_tick_does_nothing(self):
        import json
        json.dump({"armed": True, "silent": True}, open(self.st, "w"))
        self.assertFalse(sn.load_state(self.st)["silent"])

    def test_silent_uses_the_silent_photo_and_never_the_announced_one(self):
        self.arm()
        sn.set_silent(True, ack=True, path=self.st)
        r = self.motion()
        self.assertEqual(self.calls, ["silent"])
        self.assertTrue(r["silent"])
        self.assertEqual(r["photo"], "s.jpg")

    def test_silent_also_means_no_alarm_even_when_the_alarm_is_on(self):
        self.arm()
        sn.set_alarm(True, path=self.st)
        sn.set_silent(True, ack=True, path=self.st)
        self.motion()
        self.assertNotIn("alarm", self.calls)

    def test_the_alarm_still_sounds_when_not_silent(self):
        self.arm()
        sn.set_alarm(True, path=self.st)
        self.motion()
        self.assertEqual(self.calls, ["announced", "alarm"])

    def test_without_a_silent_function_she_announces_even_if_silent_is_on(self):
        self.arm()
        sn.set_silent(True, ack=True, path=self.st)
        self.motion(silent_fn=False)
        self.assertEqual(self.calls, ["announced"])

    def test_arming_and_disarming_keep_the_choice(self):
        sn.set_silent(True, ack=True, path=self.st)
        self.arm()
        self.assertTrue(sn.load_state(self.st)["silent"])
        sn.set_armed(False, path=self.st)
        self.assertTrue(sn.load_state(self.st)["silent"])
        sn.set_silent(False, path=self.st)
        self.assertFalse(sn.load_state(self.st)["silent"])

    def test_not_armed_does_nothing_even_when_silent(self):
        sn.set_silent(True, ack=True, path=self.st)
        self.assertIsNone(self.motion())
        self.assertEqual(self.calls, [])

    def test_the_alert_record_says_it_was_silent(self):
        self.arm()
        sn.set_silent(True, ack=True, path=self.st)
        self.motion()
        self.assertTrue(sn.alerts(self.al)[0]["silent"])


if __name__ == "__main__":
    unittest.main()
