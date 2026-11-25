import os
import tempfile
import unittest

import al_alert as aa
import al_chain


class Alerts(unittest.TestCase):
    def setUp(self):
        d = tempfile.mkdtemp()
        self.p = os.path.join(d, "alerts.json")
        self.log = os.path.join(d, "log.jsonl")
        self.light = os.path.join(d, "light.json")

    def raise_(self, source="net", text="x", tier=2, **kw):
        return aa.raise_alert(source, text, tier, path=self.p, log=self.log, now=kw.pop("now", 1000.0), light_file=self.light, **kw)

    def test_watch_pulses_and_urgent_flashes(self):
        self.raise_()
        self.assertEqual(aa.light_tier(aa._load(self.p), 1010), 2)
        self.raise_("leak", "Water at the door", 3)
        self.assertEqual(aa.light_tier(aa._load(self.p), 1010), 3)

    def test_notice_has_no_light(self):
        self.raise_(tier=1)
        self.assertEqual(aa.light_tier(aa._load(self.p), 1010), 0)

    def test_pulse_stops_by_itself_but_the_banner_stays(self):
        self.raise_()
        later = 1000 + (aa.PULSE_MINUTES + 1) * 60
        self.assertEqual(aa.light_tier(aa._load(self.p), later), 0)
        self.assertEqual(len(aa.view(self.p, self.log, later)["active"]), 1)

    def test_flash_never_stops_by_itself(self):
        self.raise_(tier=3)
        self.assertEqual(aa.light_tier(aa._load(self.p), 1000 + 86400), 3)

    def test_same_alert_again_is_one_line_with_a_count(self):
        self.raise_()
        self.raise_(now=1100.0)
        a = aa.view(self.p, self.log, 1200)["active"]
        self.assertEqual((len(a), a[0]["n"]), (1, 2))

    def test_silent_by_default_and_speaks_only_when_switched_on(self):
        said = []
        self.raise_(speak=said.append)
        self.assertEqual(said, [])
        aa.set_speak(True, self.p, self.log)
        self.raise_(text="y", speak=said.append)
        self.assertEqual(said, ["y"])

    def test_clear_one_and_all_and_the_light_follows(self):
        a = self.raise_()
        self.raise_("leak", "z", 3)
        self.assertEqual(aa.clear(a["id"], path=self.p, log=self.log, light_file=self.light, now=1010), 1)
        self.assertEqual(aa.light_tier(aa._load(self.p), 1010), 3)
        self.assertEqual(aa.clear(None, path=self.p, log=self.log, light_file=self.light, now=1010), 1)
        self.assertEqual(aa.light_tier(aa._load(self.p), 1010), 0)
        self.assertIn('"tier": 0', open(self.light).read())

    def test_every_raise_and_clear_is_in_the_chain(self):
        a = self.raise_()
        aa.clear(a["id"], path=self.p, log=self.log, light_file=self.light)
        ok, n = al_chain.verify(self.log)
        self.assertEqual((ok, n), (True, 2))

    def test_bad_tier_refused(self):
        with self.assertRaises(ValueError):
            self.raise_(tier=9)


class Frames(unittest.TestCase):
    def test_flash_rate_is_capped(self):
        ons = [aa.alert_frame(4, i / 100.0, 3)[0] for i in range(100)]
        edges = sum(1 for i in range(1, 100) if ons[i] == 1.0 and ons[i - 1] == 0.0)
        self.assertLessEqual(edges + 1, aa.MAX_FLASHES_PER_SECOND)

    def test_pulse_never_goes_fully_dark_and_never_above_one(self):
        vals = [aa.alert_frame(3, i / 10.0, 2)[0] for i in range(60)]
        self.assertGreater(min(vals), 0.0)
        self.assertLessEqual(max(vals), 1.0)

    def test_no_alert_is_dark_and_empty_strip_is_empty(self):
        self.assertEqual(aa.alert_frame(3, 1.0, 0), [0.0, 0.0, 0.0])
        self.assertEqual(aa.alert_frame(0, 1.0, 3), [])

    def test_nothing_she_says_has_a_dash_or_the_tell_word(self):
        text = open(aa.__file__, encoding="utf-8").read()
        self.assertNotIn("—", text)
        self.assertNotIn("plainly", text.lower())


if __name__ == "__main__":
    unittest.main()
