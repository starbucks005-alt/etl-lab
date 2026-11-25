import unittest

import al_sectors as sx


class Sectors(unittest.TestCase):
    def test_the_sector_list_is_the_one_cisa_publishes(self):
        names = [s["name"] for s in sx.SECTORS]
        self.assertEqual(sx.count(), 16)
        for n in ("Chemical", "Commercial Facilities", "Communications", "Critical Manufacturing", "Dams", "Defense Industrial Base", "Emergency Services", "Energy",
                  "Financial Services", "Food and Agriculture", "Government Services and Facilities", "Healthcare and Public Health", "Information Technology",
                  "Nuclear Reactors, Materials, and Waste", "Transportation Systems", "Water and Wastewater"):
            self.assertIn(n, names)

    def test_every_sector_is_complete(self):
        for s in sx.SECTORS:
            for f in ("name", "lead", "what", "hurt_by", "you_can"):
                self.assertTrue(s[f], s["key"] + " " + f)
            self.assertTrue(s["parts"], s["key"])
            for k in s["leans_on"]:
                self.assertIn(k, sx.BY_KEY, s["key"] + " leans on an unknown sector " + k)
                self.assertNotEqual(k, s["key"])

    def test_energy_and_communications_are_leaned_on_by_most(self):
        for k in ("energy", "communications"):
            self.assertGreaterEqual(len(sx.relied_on_by(k)), 8, k)

    def test_list_question(self):
        s, shown = sx.sector_reply("what are the critical infrastructure sectors")
        self.assertIn("16 critical infrastructure sectors", s)
        self.assertIn("Dams", s)
        self.assertIn("Source", shown)

    def test_about_a_sector(self):
        s, _ = sx.sector_reply("tell me about the energy sector")
        self.assertIn("Department of Energy", s)
        self.assertIn("Colonial Pipeline", s)

    def test_longest_alias_wins(self):
        self.assertEqual(sx.find("the water and wastewater sector")["key"], "water")
        self.assertEqual(sx.find("the nuclear reactors, materials, and waste sector")["key"], "nuclear")

    def test_specific_questions(self):
        self.assertIn("led by the Environmental Protection Agency", sx.sector_reply("who leads the water sector")[0])
        self.assertIn("leans on", sx.sector_reply("what does the healthcare sector depend on")[0])
        self.assertIn("includes", sx.sector_reply("what are the parts of the transportation sector")[0])
        self.assertIn("Oldsmar", sx.sector_reply("how is the water sector attacked")[0])

    def test_ordinary_talk_is_left_alone(self):
        for q in ("what is it", "how is the water", "it is cold in here", "hello guardian", "what is the weather", "tell me about the energy drink"):
            self.assertIsNone(sx.sector_reply(q), q)

    def test_no_numbers_that_go_stale(self):
        text = open(sx.__file__, encoding="utf-8").read()
        body = text[text.index("SECTORS = ["):text.index("KEYS =")]
        import re
        self.assertEqual(re.findall(r"\b\d[\d,]*\b", body.replace("2021", "").replace("2024", "").replace("911", "")), [])

    def test_no_dash_and_no_tell_word(self):
        text = open(sx.__file__, encoding="utf-8").read()
        self.assertNotIn("\u2014", text)
        self.assertNotIn("plainly", text.lower())


if __name__ == "__main__":
    unittest.main()
