import json
import os
import tempfile
import unittest

import al_briefing as bf

PLACE = None


class Resp:
    def __init__(self, data, code=200):
        self.data, self.status_code = data, code

    def json(self):
        return self.data


def fake_get(alerts=True, kev=True, weather=True):
    def get(url, params=None, headers=None, timeout=None):
        if "cisa.gov" in url:
            if not kev:
                raise OSError("down")
            return Resp({"vulnerabilities": [
                {"cveID": "CVE-1", "vendorProject": "Acme", "product": "Router", "dateAdded": "2026-11-20", "shortDescription": "x"},
                {"cveID": "CVE-2", "vendorProject": "Beta", "product": "Gate", "dateAdded": "2026-11-24", "shortDescription": "y"},
                {"cveID": "CVE-3", "vendorProject": "Cora", "product": "Hub", "dateAdded": "2026-11-22", "shortDescription": "z"},
                {"cveID": "CVE-0", "vendorProject": "Old", "product": "Thing", "dateAdded": "2026-01-01", "shortDescription": "w"}]})
        if not weather:
            raise OSError("down")
        if "/points/" in url:
            return Resp({"properties": {"forecast": "https://api.weather.gov/gridpoints/x/forecast"}})
        if "forecast" in url:
            return Resp({"properties": {"periods": [{"name": "Tonight", "shortForecast": "Clear.", "temperature": 31}, {"name": "Thursday", "shortForecast": "Sunny", "temperature": 45}]}})
        if "alerts" in url:
            return Resp({"features": [{"properties": {"event": "Wind Advisory", "severity": "Minor", "headline": "Wind Advisory until 6 PM"}}] if alerts else []})
        raise AssertionError(url)
    return get


class Briefing(unittest.TestCase):
    def setUp(self):
        self.d = tempfile.mkdtemp()
        self.place = os.path.join(self.d, "place.json")
        json.dump({"lat": 39.7, "lon": -84.2, "name": "Somewhere"}, open(self.place, "w"))
        self.rf = os.path.join(self.d, "refreshers.json")
        self.kw = dict(place_path=self.place, refresh_path=self.rf, audit_last=lambda: None, alerts_view=lambda: {"active": []}, room_view=lambda: None)

    def test_a_full_briefing_names_each_source(self):
        r = bf.build(now=1000, get=fake_get(), **self.kw)
        self.assertIn("Wind Advisory", r["spoken"])
        self.assertIn("Beta Gate", r["spoken"])
        self.assertLess(r["spoken"].index("Beta Gate"), r["spoken"].index("Cora Hub"))
        self.assertNotIn("Old Thing", r["spoken"])
        self.assertIn("Source: National Weather Service", r["shown"])
        self.assertIn("Source: CISA Known Exploited Vulnerabilities", r["shown"])
        self.assertIn("911", r["shown"])

    def test_the_place_name_is_never_spoken(self):
        r = bf.build(now=1000, get=fake_get(), **self.kw)
        self.assertNotIn("Somewhere", r["spoken"] + r["shown"])

    def test_a_down_source_says_so_and_nothing_is_filled_in(self):
        r = bf.build(now=1000, get=fake_get(kev=False, weather=False), **self.kw)
        self.assertIn("could not reach the National Weather Service", r["spoken"])
        self.assertIn("could not reach the CISA list", r["spoken"])
        self.assertNotIn("Wind", r["spoken"])
        self.assertEqual([p["ok"] for p in r["parts"][:2]], [False, False])

    def test_no_saved_place_says_so(self):
        os.remove(self.place)
        r = bf.build(now=1000, get=fake_get(), **self.kw)
        self.assertIn("do not have a place saved", r["spoken"])

    def test_no_alerts_is_said_not_skipped(self):
        r = bf.build(now=1000, get=fake_get(alerts=False), **self.kw)
        self.assertIn("lists no active alerts", r["spoken"])

    def test_her_own_state_is_reported_from_her_own_checks(self):
        kw = dict(self.kw, audit_last=lambda: {"attention": 2, "checks": [{"status": "attention", "name": "Panel passcode", "detail": "No passcode is set."}, {"status": "ok", "name": "x", "detail": "y"}]},
                  alerts_view=lambda: {"active": [{"name": "watch", "source": "Latchkey", "text": "Not home yet"}]})
        r = bf.build(now=1000, get=fake_get(), **kw)
        self.assertIn("2 things needing attention", r["spoken"])
        self.assertIn("1 alert on my panel", r["spoken"])
        self.assertIn("Panel passcode", r["shown"])
        self.assertNotIn("x: y", r["shown"])

    def test_no_check_run_yet_is_said(self):
        self.assertIn("have not run a security check", bf.build(now=1000, get=fake_get(), **self.kw)["spoken"])

    def test_room_only_when_there_is_a_sensor_and_a_fresh_reading(self):
        self.assertFalse([p for p in bf.build(now=1, get=fake_get(), **self.kw)["parts"] if p["id"] == "room"])
        fresh = dict(self.kw, room_view=lambda: {"configured": True, "stale": False, "reading": {"temp_f": 70.2, "humidity": 41, "co2": 640}})
        self.assertIn("70 degrees with 41 percent humidity in here and the CO2 is 640", bf.build(now=1, get=fake_get(), **fresh)["spoken"])
        stale = dict(self.kw, room_view=lambda: {"configured": True, "stale": True, "reading": {"temp_f": 70, "humidity": 41, "co2": 1}})
        self.assertIn("have not heard from the room sensor", bf.build(now=1, get=fake_get(), **stale)["spoken"])

    def test_she_ships_with_no_refreshers_and_invents_none(self):
        self.assertEqual(bf.load_refreshers(self.rf), [])
        self.assertNotIn("reminder", bf.build(now=1000, get=fake_get(), **self.kw)["spoken"].lower())

    def test_owner_refreshers_rotate_by_day(self):
        bf.save_refreshers(["Lock the screen when you leave.", "  Check the badge   log. ", ""], self.rf, os.path.join(self.d, "l.jsonl"))
        self.assertEqual(bf.load_refreshers(self.rf), ["Lock the screen when you leave.", "Check the badge log."])
        a = bf.todays_refresher(0, self.rf)
        b = bf.todays_refresher(86400, self.rf)
        self.assertNotEqual(a, b)
        self.assertIn("Today's reminder: " + bf.todays_refresher(5 * 86400, self.rf), bf.build(now=5 * 86400, get=fake_get(), **self.kw)["spoken"])

    def test_refresher_list_is_capped(self):
        kept = bf.save_refreshers(["r%d" % i for i in range(100)], self.rf, os.path.join(self.d, "l.jsonl"))
        self.assertEqual(len(kept), bf.MAX_REFRESHERS)
        self.assertEqual(len(bf.save_refreshers(["x" * 1000], self.rf, os.path.join(self.d, "l.jsonl"))[0]), bf.MAX_LEN)

    def test_asking_for_a_briefing(self):
        for q in ("brief me", "give me the morning briefing", "give me a security briefing", "daily briefing please", "what is the situation", "sitrep", "catch me up"):
            self.assertTrue(bf.wants(q), q)
        for q in ("what is the weather", "tell me about the energy sector", "run a security check", "I need a break", "what is your name", "go bag"):
            self.assertFalse(bf.wants(q), q)

    def test_a_briefing_is_kept_and_logged(self):
        r = bf.build(now=1000, get=fake_get(), **self.kw)
        bf.save(r, os.path.join(self.d, "b.json"), os.path.join(self.d, "b.jsonl"))
        self.assertEqual(bf.last(os.path.join(self.d, "b.json"))["t"], 1000)
        self.assertTrue(os.path.exists(os.path.join(self.d, "b.jsonl")))

    def test_no_em_dashes_and_no_invented_intelligence(self):
        src = open(bf.__file__, encoding="utf-8").read()
        self.assertNotIn("—", src)
        self.assertNotIn("synthetic", src.lower().replace("no made up", ""))


if __name__ == "__main__":
    unittest.main()
