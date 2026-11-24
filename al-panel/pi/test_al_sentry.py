"""Tests for Sentry mode. Run:  py -m unittest test_al_sentry   (from this folder). No camera, speaker or sensor needed."""
import os
import tempfile
import unittest

import al_sentry as sn


class Sentry(unittest.TestCase):
    def setUp(self):
        d = tempfile.mkdtemp()
        self.st, self.al = os.path.join(d, "s.json"), os.path.join(d, "a.json")
        sn._last_alert[0] = 0.0
        self.shots, self.alarms = [], []

    def photo(self, ok=True):
        def f():
            self.shots.append(1)
            return {"ok": True, "name": "photo_x.jpg"} if ok else {"ok": False, "why": "no photo: she could not say it out loud"}
        return f

    def motion(self, t, ok=True):
        return sn.on_motion(self.photo(ok), alarm_fn=lambda: self.alarms.append(1), clock=lambda: t, state_path=self.st, alerts_path=self.al)

    def test_disarmed_does_nothing(self):
        self.assertIsNone(self.motion(1000))
        self.assertEqual(self.shots, [])

    def test_exit_delay_then_alert(self):
        sn.set_armed(True, now=1000, path=self.st)
        self.assertEqual(self.motion(1010), {"skipped": "exit delay"})
        self.assertEqual(self.shots, [])
        r = self.motion(1000 + sn.EXIT_DELAY_SECONDS + 1)
        self.assertTrue(r["ok"])
        self.assertEqual(len(self.shots), 1)
        self.assertEqual(sn.alerts(self.al)[0]["photo"], "photo_x.jpg")

    def test_gap_suppresses_the_next(self):
        sn.set_armed(True, now=0, path=self.st)
        t = sn.EXIT_DELAY_SECONDS + 5
        self.motion(t)
        self.assertEqual(self.motion(t + 5), {"skipped": "just alerted"})
        self.assertTrue(self.motion(t + sn.GAP_SECONDS + 1)["ok"])
        self.assertEqual(len(self.shots), 2)

    def test_failed_photo_is_recorded_and_no_alarm(self):
        sn.set_armed(True, now=0, path=self.st)
        sn.set_alarm(True, path=self.st)
        r = self.motion(sn.EXIT_DELAY_SECONDS + 1, ok=False)
        self.assertFalse(r["ok"])
        self.assertEqual(self.alarms, [])
        self.assertIn("could not say it", sn.alerts(self.al)[0]["why"])

    def test_alarm_only_when_on_and_photo_taken(self):
        sn.set_armed(True, now=0, path=self.st)
        self.motion(sn.EXIT_DELAY_SECONDS + 1)
        self.assertEqual(self.alarms, [])
        sn._last_alert[0] = 0.0
        sn.set_alarm(True, path=self.st)
        self.motion(sn.EXIT_DELAY_SECONDS + 100)
        self.assertEqual(self.alarms, [1])

    def test_disarm_stops_it_and_state_persists(self):
        sn.set_armed(True, now=0, path=self.st)
        self.assertTrue(sn.is_armed(self.st))
        sn.set_armed(False, now=5, path=self.st)
        self.assertFalse(sn.is_armed(self.st))
        self.assertIsNone(self.motion(100))

    def test_alert_list_is_newest_first_and_capped(self):
        for i in range(sn.MAX_ALERTS + 7):
            sn._add_alert({"time": i, "ok": True, "photo": None, "why": None}, self.al)
        a = sn.alerts(self.al)
        self.assertEqual(len(a), sn.MAX_ALERTS)
        self.assertEqual(a[0]["time"], sn.MAX_ALERTS + 6)

    def test_the_photo_function_is_always_the_gated_one_so_a_second_run_is_refused_while_busy(self):
        sn.set_armed(True, now=0, path=self.st)
        sn._lock.acquire()
        try:
            self.assertEqual(self.motion(sn.EXIT_DELAY_SECONDS + 1), {"skipped": "busy"})
        finally:
            sn._lock.release()
        self.assertEqual(self.shots, [])

    def test_alarm_file_is_made_once(self):
        p = os.path.join(tempfile.mkdtemp(), "alarm.wav")
        self.assertEqual(sn.make_alarm_file(p), p)
        self.assertGreater(os.path.getsize(p), 1000)

    def test_nothing_people_read_has_a_dash_or_the_tell_word(self):
        text = sn.page_html() + sn.__doc__
        self.assertNotIn("\u2014", text)
        self.assertNotIn("plainly", text.lower())


if __name__ == "__main__":
    unittest.main()
