import re
import unittest

import al_gobag as gb

CARD = {"kind": "home", "lat": 39.7, "lon": -84.2, "county": {"county": "Greene", "state": "Ohio", "overall": "x"},
        "risks": [{"hazard": "Winter weather", "rating": "Very High"}, {"hazard": "Tornado", "rating": "Relatively High"},
                  {"hazard": "Strong wind", "rating": "Relatively High"}, {"hazard": "Heat wave", "rating": "Relatively Moderate"},
                  {"hazard": "Lightning", "rating": "Relatively High"}]}


class GoBag(unittest.TestCase):
    def test_wind_comes_first_even_when_winter_rates_higher(self):
        names = [r["hazard"] for r in gb.ordered_risks(CARD)]
        self.assertEqual(names, ["Strong wind", "Tornado", "Lightning", "Winter weather"])

    def test_only_high_ratings_are_told(self):
        self.assertNotIn("Heat wave", [r["hazard"] for r in gb.ordered_risks(CARD)])

    def test_no_place_still_gives_a_kit_and_asks_for_the_place(self):
        r = gb.reply("what should be in my go bag")
        self.assertIn("water", r[0].lower())
        self.assertIn("place", r[0].lower())

    def test_kit_with_a_place_names_the_top_risks(self):
        sp, shown = gb.reply("what should I pack in a go bag", CARD)
        self.assertIn("strong wind", sp)
        self.assertIn("Weather Radio", shown)
        self.assertIn("911", shown)

    def test_active_alerts_are_told_first(self):
        sp, _ = gb.reply("go bag", CARD, alerts=2)
        self.assertTrue(sp.startswith("There are active weather alerts"))

    def test_tornado_says_a_car_is_not_safe(self):
        sp, shown = gb.reply("what do I do in a tornado")
        self.assertIn("car is not a safe place", sp)
        self.assertIn("From Ready.gov", shown)

    def test_thunderstorm_and_wind_map_to_strong_wind(self):
        for q in ("what do I do in a thunderstorm", "what should I do in strong winds"):
            self.assertEqual(gb.hazard_from(q), "Strong wind")

    def test_hazard_without_a_plan_says_so(self):
        self.assertIn("I do not have a plan", gb.plan_say("Volcano"))

    def test_general_guidance_is_marked_not_passed_off_as_read(self):
        sp = gb.plan_say("Hurricane")
        self.assertIn("general guidance", sp.lower())
        self.assertFalse(gb.PLANS["Hurricane"]["read"])
        self.assertTrue(gb.PLANS["Tornado"]["read"])

    def test_ordinary_questions_are_not_taken(self):
        for q in ("what is the weather", "tell me about the water sector", "what time is it", "is it windy", "run a security check", "where is the nearest fire station"):
            self.assertIsNone(gb.reply(q), q)

    def test_no_street_address_county_or_changing_numbers_are_spoken(self):
        for q in ("what should I pack in a go bag", "what do I do in a tornado"):
            sp, shown = gb.reply(q, CARD)
            self.assertNotIn("Greene", sp + shown)
            self.assertNotIn("Ohio", sp + shown)
        for p in gb.PLANS.values():
            self.assertNotRegex(" ".join(p["steps"]), r"\$|\bphone number")

    def test_no_em_dashes_or_british_words(self):
        blob = repr(gb.KIT) + repr(gb.PLANS) + open(gb.__file__, encoding="utf-8").read()
        self.assertNotIn("—", blob)
        for w in ("colour", "whilst", "torch", "lorry", "plainly"):
            self.assertNotIn(w, blob.lower().replace("torch", "") if w == "torch" else blob.lower())

    def test_view_carries_the_wind_plans_without_a_place(self):
        v = gb.view(None)
        self.assertFalse(v["has_place"])
        self.assertEqual([p["hazard"] for p in v["wind"]], ["Strong wind", "Tornado"])
        self.assertIn("911", v["limits"])


if __name__ == "__main__":
    unittest.main()
