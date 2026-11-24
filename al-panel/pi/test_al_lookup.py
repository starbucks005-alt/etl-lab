"""Tests for the Guardian's lookup. Run:  py -m unittest test_al_lookup   (from this folder). No network needed: the sources are faked."""
import json
import os
import tempfile
import unittest

import al_lookup as lk


class Resp:
    def __init__(self, data, status=200):
        self.data, self.status_code = data, status

    def json(self):
        return self.data


def fake_get(routes):
    calls = []

    def get(url, params=None, headers=None, timeout=None):
        calls.append((url, params))
        for key, val in routes.items():
            if key in url:
                if isinstance(val, Exception):
                    raise val
                return val if isinstance(val, Resp) else Resp(val)
        return Resp({}, 404)
    get.calls = calls
    return get


GEO = {"results": [{"name": "Dayton", "admin1": "Ohio", "admin1_code": "OH", "country_code": "US", "latitude": 39.76, "longitude": -84.19}]}
POINTS = {"properties": {"forecast": "https://api.weather.gov/gridpoints/ILN/1,1/forecast"}}
FORECAST = {"properties": {"periods": [{"name": "Tonight", "shortForecast": "Mostly Cloudy", "temperature": 31},
                                       {"name": "Wednesday", "shortForecast": "Light Rain", "temperature": 44}]}}
NOALERTS = {"features": []}
ALERTS = {"features": [{"properties": {"event": "Winter Storm Watch", "severity": "Moderate", "headline": "Winter Storm Watch issued for Montgomery County"}}]}
KEV = {"vulnerabilities": [{"cveID": "CVE-2026-0001", "vendorProject": "Acme", "product": "Gate", "dateAdded": "2026-11-20", "shortDescription": "Bad."},
                           {"cveID": "CVE-2026-0003", "vendorProject": "Zed", "product": "Edge", "dateAdded": "2026-11-23", "shortDescription": "Worse."},
                           {"cveID": "CVE-2026-0002", "vendorProject": "Beta", "product": "Box", "dateAdded": "2026-11-22", "shortDescription": "Ugly."}]}


class Kind(unittest.TestCase):
    def test_kinds(self):
        self.assertEqual(lk.kind_of("what is the weather in Dayton"), "weather")
        self.assertEqual(lk.kind_of("are there any weather alerts"), "weather")
        self.assertEqual(lk.kind_of("any new vulnerabilities today"), "cyber")
        self.assertEqual(lk.kind_of("look up the Wright brothers"), "fact")
        self.assertEqual(lk.kind_of("who was Amelia Earhart"), "fact")

    def test_talk_about_her_or_the_room_is_not_a_lookup(self):
        for t in ("what is your name", "who is here", "what is the time", "who are you", "what is that noise", "hello guardian", "what is going on",
                  "tell me about yourself", "look up my schedule", "what was that"):
            self.assertIsNone(lk.kind_of(t), t)


class Weather(unittest.TestCase):
    def routes(self, alerts=NOALERTS):
        return {"geocoding-api": GEO, "/points/": POINTS, "gridpoints": FORECAST, "alerts/active": alerts}

    def test_spoken_place_gives_forecast_and_names_source(self):
        s, shown = lk.weather_reply("what is the weather in Dayton, Ohio", fake_get(self.routes()))
        self.assertIn("Tonight: Mostly Cloudy, 31 degrees", s)
        self.assertIn("National Weather Service", s)
        self.assertIn("not a replacement for official alerts", shown)

    def test_alerts_are_spoken(self):
        s, shown = lk.weather_reply("any weather alerts in Dayton", fake_get(self.routes(ALERTS)))
        self.assertIn("Winter Storm Watch", s)
        self.assertIn("Montgomery County", shown)

    def test_no_alerts_says_so(self):
        s, _ = lk.weather_reply("any weather alerts in Dayton", fake_get(self.routes()))
        self.assertIn("no active alerts", s)

    def test_no_place_and_none_saved_asks_and_never_guesses(self):
        g = fake_get(self.routes())
        s, _ = lk.weather_reply("what is the weather", g, place_path=os.path.join(tempfile.mkdtemp(), "none.json"))
        self.assertIn("city and state", s)
        self.assertEqual(g.calls, [])

    def test_saved_place_is_used_but_its_name_is_never_spoken(self):
        p = os.path.join(tempfile.mkdtemp(), "place.json")
        json.dump({"lat": 39.7, "lon": -84.1, "name": "123 Secret Street"}, open(p, "w"))
        s, shown = lk.weather_reply("what is the weather", fake_get(self.routes()), place_path=p)
        self.assertNotIn("Secret", s + shown)
        self.assertIn("your area", s)

    def test_source_down_says_so_and_does_not_guess(self):
        s, _ = lk.weather_reply("weather in Dayton", fake_get({"geocoding-api": GEO, "/points/": RuntimeError("boom")}))
        self.assertIn("will not guess", s)

    def test_unknown_place(self):
        s, _ = lk.weather_reply("weather in Zzzzzz", fake_get({"geocoding-api": {"results": []}}))
        self.assertIn("could not find that place", s)


class Cyber(unittest.TestCase):
    def test_newest_first_and_source_named(self):
        s, shown = lk.cyber_reply("new vulnerabilities", fake_get({"known_exploited": KEV}))
        self.assertLess(s.index("Zed"), s.index("Beta"))
        self.assertLess(s.index("Beta"), s.index("Acme"))
        self.assertIn("CISA", s)
        self.assertIn("Worse.", shown)

    def test_down(self):
        s, _ = lk.cyber_reply("vulnerabilities", fake_get({"known_exploited": RuntimeError("x")}))
        self.assertIn("will not guess", s)


class Fact(unittest.TestCase):
    def test_summary_with_source(self):
        g = fake_get({"search/title": {"pages": [{"key": "Wright_brothers"}]},
                      "page/summary": {"title": "Wright brothers", "type": "standard", "extract": "The Wright brothers were American aviation pioneers. They flew first. Third sentence."}})
        s, shown = lk.fact_reply("look up the Wright brothers", g)
        self.assertIn("That is from Wikipedia.", s)
        self.assertNotIn("Third sentence", s)
        self.assertIn("Source: Wikipedia", shown)

    def test_nothing_found_says_i_do_not_know(self):
        s, _ = lk.fact_reply("look up qzxqzx", fake_get({"search/title": {"pages": []}}))
        self.assertIn("I do not know that one", s)

    def test_disambiguation_asks_for_more(self):
        g = fake_get({"search/title": {"pages": [{"key": "Mercury"}]}, "page/summary": {"title": "Mercury", "type": "disambiguation", "extract": "Mercury may refer to"}})
        s, _ = lk.fact_reply("who is mercury", g)
        self.assertIn("more than one meaning", s)


class Gate(unittest.TestCase):
    def test_ordinary_talk_goes_on(self):
        self.assertIsNone(lk.lookup_reply("how are you tonight"))

    def test_off_file_stops_it(self):
        old = lk.OFF_FILE
        lk.OFF_FILE = os.path.join(tempfile.mkdtemp(), "off.txt")
        open(lk.OFF_FILE, "w").close()
        try:
            self.assertIsNone(lk.lookup_reply("any new vulnerabilities", fake_get({"known_exploited": KEV})))
        finally:
            lk.OFF_FILE = old

    def test_nothing_people_hear_has_a_dash_or_the_tell_word(self):
        text = open(lk.__file__, encoding="utf-8").read()
        self.assertNotIn("—", text)
        self.assertNotIn("plainly", text.lower())


if __name__ == "__main__":
    unittest.main()
