import unittest

import al_clock as ck

SYNCED = "Timezone=America/New_York\nLocalRTC=no\nNTP=yes\nNTPSynchronized=yes\n"
UNSYNCED = "Timezone=America/New_York\nLocalRTC=no\nNTP=yes\nNTPSynchronized=no\n"
NOW, FLOOR = 2_000_000_000, 1_900_000_000


class Clock(unittest.TestCase):
    def st(self, show, **kw):
        kw.setdefault("rtc", True)
        kw.setdefault("floor", FLOOR)
        kw.setdefault("now", NOW)
        return ck.status(show=show, **kw)

    def test_synced_and_not_behind_is_trusted(self):
        s = self.st(SYNCED)
        self.assertTrue(s["ok"])
        ok, words, fix = ck.detail(s)
        self.assertTrue(ok)
        self.assertIn("confirmed with an internet time server", words)
        self.assertEqual(fix, "")
        self.assertEqual(s["tz"], "America/New_York")

    def test_unsynced_is_flagged_and_does_not_claim_a_battery(self):
        s = self.st(UNSYNCED)
        ok, words, fix = ck.detail(s)
        self.assertFalse(ok)
        self.assertIn("may be off", words)
        self.assertIn("cannot see whether its battery is fitted", words)
        self.assertNotIn("battery is ok", words.lower())
        self.assertIn("battery", fix)

    def test_without_a_clock_chip_she_does_not_mention_a_battery_in_the_state(self):
        ok, words, _ = ck.detail(self.st(UNSYNCED, rtc=False))
        self.assertNotIn("clock chip", words)

    def test_a_time_before_her_own_files_is_certainly_wrong_even_if_synced(self):
        s = self.st(SYNCED, now=FLOOR - 10 * 86400)
        self.assertTrue(s["behind"])
        self.assertFalse(s["ok"])
        self.assertIn("certainly wrong", ck.detail(s)[1])

    def test_a_little_slack_is_allowed(self):
        self.assertFalse(self.st(SYNCED, now=FLOOR - 1800)["behind"])

    def test_unreadable_is_unknown_not_ok(self):
        s = self.st("")
        self.assertFalse(s["known"])
        self.assertIsNone(s["ok"])
        self.assertIsNone(ck.detail(s)[0])

    def test_view_carries_the_words_and_the_time(self):
        v = ck.view(show=SYNCED, rtc=True, floor=FLOOR, now=NOW)
        self.assertEqual(v["now"], NOW)
        self.assertTrue(v["trusted"])
        self.assertIn("words", v)

    def test_no_em_dashes(self):
        with open(ck.__file__, encoding="utf-8") as f:
            self.assertNotIn("—", f.read())


if __name__ == "__main__":
    unittest.main()
