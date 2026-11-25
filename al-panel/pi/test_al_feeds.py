import os
import tempfile
import unittest

import al_feeds as ff

XML = """<?xml version="1.0"?><rss><channel><title>ICS Advisories</title>
<item><title>AutomationDirect C-More EA9 &amp; Software</title><link>https://www.cisa.gov/a</link><pubDate>Tue, 24 Nov 26 12:00:00 +0000</pubDate><description>&lt;p&gt;x&lt;/p&gt;</description></item>
<item><title><![CDATA[Danfoss AK-SM]]></title><link>https://www.cisa.gov/b</link><pubDate>Mon, 23 Nov 26 12:00:00 +0000</pubDate></item>
<item><title>Third</title><link>https://www.cisa.gov/c</link></item>
<item><title>Fourth</title><link>https://www.cisa.gov/d</link></item></channel></rss>"""


class R:
    def __init__(self, text, code=200):
        self.text, self.status_code = text, code


class Feeds(unittest.TestCase):
    def setUp(self):
        self.p = os.path.join(tempfile.mkdtemp(), "c.json")
        self.calls = 0

    def get_ok(self, url, headers=None, timeout=None):
        self.calls += 1
        return R(XML)

    def get_down(self, url, headers=None, timeout=None):
        raise OSError("down")

    def test_parse_reads_title_link_date_and_unescapes(self):
        it = ff.parse(XML)
        self.assertEqual(len(it), 4)
        self.assertEqual(it[0]["title"], "AutomationDirect C-More EA9 & Software")
        self.assertEqual(it[1]["title"], "Danfoss AK-SM")
        self.assertEqual(ff.day_of(it[0]["date"]), "November 24")
        self.assertEqual(ff.day_of("nonsense"), "")

    def test_spoken_line_names_titles_dates_and_source(self):
        sp, shown = ff.say("ics", ff.get_feed("ics", self.get_ok, 1000, self.p), 1000)
        self.assertIn("The newest ICS advisories: AutomationDirect", sp)
        self.assertIn("November 24", sp)
        self.assertNotIn("Fourth", sp)
        self.assertIn("Source: CISA industrial control system advisories", shown)
        self.assertIn("I read titles and dates only", shown)

    def test_a_fresh_copy_is_reused_for_half_an_hour(self):
        ff.get_feed("ics", self.get_ok, 1000, self.p)
        ff.get_feed("ics", self.get_ok, 1000 + 600, self.p)
        self.assertEqual(self.calls, 1)
        ff.get_feed("ics", self.get_ok, 1000 + 2000, self.p)
        self.assertEqual(self.calls, 2)

    def test_down_with_an_old_copy_says_how_old(self):
        ff.get_feed("ics", self.get_ok, 1000, self.p)
        feed = ff.get_feed("ics", self.get_down, 1000 + 7200, self.p)
        self.assertTrue(feed["stale"])
        sp, _ = ff.say("ics", feed, 1000 + 7200)
        self.assertIn("from my last look, 2 hours ago", sp)

    def test_down_with_nothing_says_so_and_does_not_guess(self):
        feed = ff.get_feed("ics", self.get_down, 1000, self.p)
        self.assertFalse(feed["ok"])
        self.assertIn("will not guess", ff.say("ics", feed)[0])

    def test_bad_status_and_empty_feed_are_failures(self):
        self.assertFalse(ff.get_feed("ics", lambda u, headers=None, timeout=None: R("x", 503), 1, self.p)["ok"])
        self.assertFalse(ff.get_feed("alerts", lambda u, headers=None, timeout=None: R("<rss></rss>"), 1, self.p)["ok"])

    def test_which_questions_are_taken(self):
        self.assertEqual(ff.wants("any new ICS advisories"), "ics")
        self.assertEqual(ff.wants("what are the latest ICS advisories"), "ics")
        self.assertEqual(ff.wants("give me the SCADA advisories"), "ics")
        self.assertEqual(ff.wants("any new CISA alerts"), "alerts")
        for q in ("what is the weather", "tell me about the energy sector", "what are the newest known exploited vulnerabilities", "run a security check", "brief me", "what time is it"):
            self.assertIsNone(ff.wants(q), q)

    def test_it_does_not_claim_a_sector_mapping_and_has_no_em_dash(self):
        with open(ff.__file__, encoding="utf-8") as f:
            self.assertNotIn("—", f.read())
        sp, shown = ff.say("alerts", ff.get_feed("alerts", self.get_ok, 5, self.p), 5)
        self.assertNotIn("sector", sp.lower())


if __name__ == "__main__":
    unittest.main()
