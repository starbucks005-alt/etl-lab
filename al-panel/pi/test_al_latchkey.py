import os
import tempfile
import time
import unittest

import al_latchkey as lk


def at(h, m, day=1):
    """A local timestamp on a Tuesday (2026-11-24) unless another day number is given: day 1 = Tue 24 Nov, 5 = Sat 28 Nov."""
    return time.mktime((2026, 11, 23 + day, h, m, 0, 0, 0, -1))


class Latch(unittest.TestCase):
    def setUp(self):
        d = tempfile.mkdtemp()
        self.s, self.l = os.path.join(d, "s.json"), os.path.join(d, "l.jsonl")
        lk.configure({"on": True, "child": "Sam", "start": "15:00", "end": "18:30", "expected": "16:00",
                      "reminders": [{"time": "16:30", "text": "Time to start your homework."}]}, self.s, self.l)
        self.shots = []

    def photo(self):
        self.shots.append(1)
        return {"ok": True, "name": "p.jpg"}

    def test_first_motion_in_window_is_the_arrival(self):
        told = []
        r = lk.on_motion(self.photo, told.append, at(15, 42), self.s, self.l)
        self.assertEqual(r["arrived"], "3:42 PM")
        self.assertIn("Sam arrived at 3:42 PM", told[0])
        self.assertEqual(len(self.shots), 1)
        self.assertIsNone(lk.on_motion(self.photo, told.append, at(15, 50), self.s, self.l))
        self.assertEqual(len(self.shots), 1)

    def test_outside_window_or_off_does_nothing(self):
        self.assertIsNone(lk.on_motion(self.photo, None, at(10, 0), self.s, self.l))
        lk.configure({"on": False}, self.s, self.l)
        self.assertIsNone(lk.on_motion(self.photo, None, at(15, 42), self.s, self.l))

    def test_weekend_skipped_when_school_days_only(self):
        self.assertIsNone(lk.on_motion(self.photo, None, at(15, 42, day=5), self.s, self.l))

    def test_failed_photo_still_logs_the_arrival(self):
        told = []
        r = lk.on_motion(lambda: {"ok": False, "why": "no photo: she could not say it"}, told.append, at(15, 42), self.s, self.l)
        self.assertIsNone(r["photo"])
        self.assertNotIn("photo of the door", told[0])

    def test_reminder_is_said_once(self):
        said = []
        lk.tick(said.append, None, at(16, 31), self.s, self.l)
        lk.tick(said.append, None, at(16, 33), self.s, self.l)
        self.assertEqual(said, ["Sam, Time to start your homework."])

    def test_not_home_by_expected_time(self):
        told = []
        lk.tick(None, told.append, at(16, 5), self.s, self.l)
        lk.tick(None, told.append, at(16, 9), self.s, self.l)
        self.assertEqual(told, ["Sam is not home yet. Expected by 16:00."])

    def test_no_late_notice_if_they_arrived(self):
        lk.on_motion(self.photo, None, at(15, 42), self.s, self.l)
        told = []
        lk.tick(None, told.append, at(16, 5), self.s, self.l)
        self.assertEqual(told, [])

    def test_bad_times_are_refused(self):
        with self.assertRaises(ValueError):
            lk.configure({"start": "3pm"}, self.s, self.l)

    def test_log_checks_out(self):
        lk.on_motion(self.photo, None, at(15, 42), self.s, self.l)
        self.assertTrue(lk.view(self.s, self.l)["log_ok"])


if __name__ == "__main__":
    unittest.main()
