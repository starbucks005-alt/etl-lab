import os
import tempfile
import unittest
import wave

import al_record as rc


def make_wav(path, seconds=2):
    with wave.open(path, "wb") as w:
        w.setnchannels(1)
        w.setsampwidth(2)
        w.setframerate(16000)
        w.writeframes(b"\x00\x01" * 16000 * seconds)


class Record(unittest.TestCase):
    def setUp(self):
        d = tempfile.mkdtemp()
        self.st, self.dir, self.idx, self.log = os.path.join(d, "r.json"), os.path.join(d, "rec"), os.path.join(d, "idx.json"), os.path.join(d, "l.jsonl")
        self.src = os.path.join(d, "heard.wav")
        make_wav(self.src)

    def kw(self):
        return dict(path=self.st, folder=self.dir, index=self.idx, log=self.log)

    def allow(self, now=1000, days=None):
        rc.set_allowed(True, ack=True, days=days, path=self.st, log=self.log, now=now)

    def keep(self, now, **extra):
        kw = dict(self.kw(), free=1.0)          # this PC's disk is nearly full, so the test says how much is free
        kw.update(extra)
        return rc.keep(self.src, now=now, **kw)

    def test_off_by_default_and_nothing_is_kept(self):
        self.assertFalse(rc.state(self.st)["allowed"])
        self.assertIsNone(self.keep(1000))
        self.assertFalse(os.path.exists(self.dir))

    def test_the_switch_needs_the_responsibility_tick(self):
        with self.assertRaises(ValueError):
            rc.set_allowed(True, ack=False, path=self.st, log=self.log)
        self.assertFalse(rc.state(self.st)["allowed"])

    def test_allowed_alone_records_nothing_until_a_period_starts(self):
        self.allow()
        self.assertIsNone(self.keep(1000))
        self.assertTrue(rc.start("panel", 10, now=1000, path=self.st, log=self.log))
        self.assertIsNotNone(self.keep(1001))

    def test_a_period_cannot_start_when_not_allowed(self):
        self.assertFalse(rc.start("armed motion", 5, now=1000, path=self.st, log=self.log))
        self.assertIsNone(self.keep(1001))

    def test_a_period_ends_by_itself(self):
        self.allow()
        rc.start("panel", 10, now=1000, path=self.st, log=self.log)
        self.assertIsNotNone(self.keep(1000 + 599))
        self.assertIsNone(self.keep(1000 + 601))

    def test_a_period_is_never_longer_than_the_cap(self):
        self.allow()
        rc.start("panel", 100000, now=1000, path=self.st, log=self.log)
        self.assertEqual(rc.state(self.st)["until"], 1000 + rc.MAX_MINUTES * 60)

    def test_stop_and_switching_off_end_it(self):
        self.allow()
        rc.start("panel", 10, now=1000, path=self.st, log=self.log)
        self.assertTrue(rc.stop(path=self.st, log=self.log, now=1001))
        self.assertIsNone(self.keep(1002))
        rc.start("panel", 10, now=1003, path=self.st, log=self.log)
        rc.set_allowed(False, path=self.st, log=self.log, now=1004)
        self.assertIsNone(self.keep(1005))

    def test_a_clip_is_a_private_copy_with_length_and_reason(self):
        self.allow()
        rc.start("armed motion", 5, now=1000, path=self.st, log=self.log)
        cid = self.keep(1001)
        p = rc.audio_path(cid, self.dir, self.idx)
        self.assertTrue(os.path.isfile(p))
        self.assertEqual(rc.clips(self.idx)[0]["seconds"], 2.0)
        self.assertEqual(rc.clips(self.idx)[0]["reason"], "armed motion")
        if os.name == "posix":
            self.assertEqual(os.stat(p).st_mode & 0o777, 0o600)

    def test_clips_delete_after_the_chosen_days(self):
        self.allow(days=2)
        rc.start("panel", 60, now=1000, path=self.st, log=self.log)
        a = self.keep(1001)
        self.assertEqual(rc.purge(1001 + 1 * 86400, **self.kw()), 0)
        self.assertEqual(rc.purge(1001 + 3 * 86400, **self.kw()), 1)
        self.assertIsNone(rc.audio_path(a, self.dir, self.idx))
        self.assertEqual(rc.clips(self.idx), [])

    def test_days_are_clamped(self):
        self.assertEqual(rc.set_days(0, self.st)["days"], 1)
        self.assertEqual(rc.set_days(999, self.st)["days"], rc.MAX_DAYS)

    def test_the_owner_can_delete_one_or_all(self):
        self.allow()
        rc.start("panel", 60, now=1000, path=self.st, log=self.log)
        a, b = self.keep(1001), self.keep(1002)
        self.assertTrue(rc.delete(a, self.dir, self.idx, self.log))
        self.assertFalse(rc.delete(a, self.dir, self.idx, self.log))
        self.assertEqual(rc.delete_all(self.dir, self.idx, self.log), 1)
        self.assertEqual(os.listdir(self.dir), [])

    def test_space_caps_stop_keeping(self):
        self.allow()
        rc.start("panel", 60, now=1000, path=self.st, log=self.log)
        self.assertIsNone(self.keep(1001, free=0.05))
        old = rc.MAX_BYTES
        try:
            rc.MAX_BYTES = 10
            self.assertIsNone(self.keep(1002))
        finally:
            rc.MAX_BYTES = old
        self.assertEqual(rc.clips(self.idx), [])

    def test_the_log_never_holds_words_or_paths(self):
        self.allow()
        rc.start("panel", 5, now=1000, path=self.st, log=self.log)
        self.keep(1001)
        with open(self.log, encoding="utf-8") as f:
            log = f.read()
        self.assertIn("clip", log)
        self.assertNotIn("heard.wav", log)
        self.assertTrue(rc.view(1002, self.st, self.idx, self.log)["log_ok"])

    def test_she_answers_truthfully_when_recording(self):
        self.allow(days=3)
        rc.start("panel", 10, now=1000, path=self.st, log=self.log)
        sp, _ = rc.reply("are you recording me", now=1001, path=self.st)
        self.assertTrue(sp.startswith("Yes."))
        self.assertIn("3 days", sp)
        self.assertIn("online speech service", sp)
        self.assertIn("never sent anywhere from me", sp)

    def test_she_answers_truthfully_when_not(self):
        for state_up in (lambda: None, lambda: self.allow()):
            state_up()
            sp, _ = rc.reply("is this being recorded", now=1001, path=self.st)
            self.assertTrue(sp.startswith("No."))
            self.assertIn("online speech service", sp)

    def test_after_the_period_ends_she_says_no(self):
        self.allow()
        rc.start("panel", 1, now=1000, path=self.st, log=self.log)
        self.assertTrue(rc.reply("are you recording", now=1010, path=self.st)[0].startswith("Yes."))
        self.assertTrue(rc.reply("are you recording", now=1100, path=self.st)[0].startswith("No."))

    def test_which_questions_are_taken(self):
        for q in ("are you recording", "Are you recording me?", "is this being recorded", "am I being recorded", "are you saving this", "do you record"):
            self.assertTrue(rc.asked(q), q)
        for q in ("what is the weather", "can you record a song", "brief me", "record the score", "who are you"):
            self.assertFalse(rc.asked(q), q)

    def test_no_em_dashes(self):
        with open(rc.__file__, encoding="utf-8") as f:
            self.assertNotIn("—", f.read())


if __name__ == "__main__":
    unittest.main()
