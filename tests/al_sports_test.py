"""Run: python3 -m unittest tests/al_sports_test.py
2026-11-15, Dr. O: sports is Astrad's thing. Checks, with a made-up scoreboard and no network, that the right team is found, that a score is
reported the right way round, and that a failed lookup adds nothing so he says he didn't catch it."""
import datetime, json, os, sys, tempfile, unittest

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "al-panel", "pi"))
import al_sports as sp  # noqa: E402

NOW = datetime.datetime(2026, 11, 15, 22, 0).astimezone()


def game(date, me_home, me_score, them_score, won, state="post", opp="Samford Bulldogs", tid="2750"):
    return {"date": date, "competitions": [{"venue": {"fullName": "Nutter Center"}, "status": {"type": {"state": state, "name": "STATUS_FINAL" if state == "post" else "STATUS_SCHEDULED", "shortDetail": ""}},
            "competitors": [{"team": {"id": tid, "displayName": "Wright State Raiders"}, "homeAway": "home" if me_home else "away", "score": {"displayValue": me_score}, "winner": won},
                            {"team": {"id": "1", "displayName": opp}, "homeAway": "away" if me_home else "home", "score": {"displayValue": them_score}, "winner": not won}]}]}


class Sports(unittest.TestCase):
    def setUp(self):
        self.here = tempfile.mkdtemp()
        json.dump({"t": 9e12, "teams": [["football/nfl", "13", "Las Vegas Raiders", "Raiders", "Las Vegas"],
                                       ["football/nfl", "5", "Cleveland Browns", "Browns", "Cleveland"],
                                       ["basketball/mens-college-basketball", "2750", "Wright State Raiders", "Raiders", "Wright State"]]},
                  open(os.path.join(self.here, "sports_teams.json"), "w"))
        self.old_get = sp._get

    def tearDown(self):
        sp._get = self.old_get

    def test_raiders_means_wright_state_here(self):
        self.assertEqual(sp.find_teams("Did the Raiders win?", self.here), [("basketball/mens-college-basketball", "2750")])
        self.assertEqual(sp.find_teams("How are the Las Vegas Raiders?", self.here), [("football/nfl", "13")])
        self.assertEqual(sp.find_teams("Did the Browns win?", self.here), [("football/nfl", "5")])
        self.assertEqual(sp.find_teams("What's the weather like?", self.here), [])

    def test_scores_the_right_way_round(self):
        sched = {"team": {"displayName": "Wright State Raiders", "recordSummary": "4-1"}, "requestedSeason": {"year": 2027},
                 "events": [game("2026-11-14T01:00Z", False, "90", "66", True),
                            game("2026-11-15T01:00Z", True, "60", "70", False, opp="Toledo Rockets"),
                            game("2026-11-19T00:30Z", True, None, None, False, state="pre", opp="Malone Pioneers")]}
        sp._get = lambda url, params=None, keep=0: sched
        f = sp.team_facts("basketball/mens-college-basketball", "2750", NOW)
        self.assertIn("record this season 4 and 1", f)
        self.assertIn("they lost to Toledo Rockets, 70 to 60, at home", f)      # the last finished game, the winner's score first
        self.assertIn("next game is Wednesday, November 18 at 7:30 PM against Malone Pioneers, at home at Nutter Center", f)

    def test_failed_lookup_adds_nothing(self):
        def boom(*a, **k):
            raise OSError("no network")
        sp._get = boom
        self.assertEqual(sp.facts_for("How are the Raiders doing?", self.here), "")


if __name__ == "__main__":
    unittest.main()
