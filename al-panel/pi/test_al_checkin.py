import os
import tempfile
import unittest

import al_checkin as ck
import al_photo as ph
import al_skills as sk


class Checkin(unittest.TestCase):
    def setUp(self):
        d = tempfile.mkdtemp()
        self.st, self.idx, self.log = os.path.join(d, "c.json"), os.path.join(d, "i.json"), os.path.join(d, "l.jsonl")
        self.dir = os.path.join(d, "photos")
        os.makedirs(self.dir)
        self.taken = []

    def fake_photo(self, why=None):
        def take(folder):
            if why:
                return {"ok": False, "why": why}
            name = "photo_20261126_10%02d00.jpg" % len(self.taken)
            open(os.path.join(folder, name), "wb").write(b"jpg")
            self.taken.append(name)
            return {"ok": True, "name": name}
        return take

    def go(self, name="Jordan Lee", host="Dr. Patel", now=1000, why=None):
        return ck.take_for_visit(name, host, self.fake_photo(why), now=now, path=self.st, index=self.idx, log=self.log, folder=self.dir)

    def test_off_by_default_no_photo(self):
        self.assertIsNone(self.go())
        self.assertEqual(self.taken, [])

    def test_the_switch_needs_the_tick(self):
        with self.assertRaises(ValueError):
            ck.set_on(True, ack=False, path=self.st, log=self.log)
        self.assertFalse(ck.state(self.st)["on"])

    def test_a_photo_goes_with_the_visit(self):
        ck.set_on(True, ack=True, now=500, path=self.st, log=self.log)
        e = self.go()
        self.assertEqual(e["name"], "Jordan Lee")
        self.assertEqual(e["host"], "Dr. Patel")
        v = ck.view(1001, self.st, self.idx, self.dir, self.log)
        self.assertEqual(len(v["photos"]), 1)
        self.assertTrue(v["photos"][0]["kept"])

    def test_if_the_photo_is_not_taken_nothing_is_recorded(self):
        ck.set_on(True, ack=True, path=self.st, log=self.log)
        self.assertIsNone(self.go(why="no photo: she could not say it out loud"))
        self.assertEqual(ck.view(path=self.st, index=self.idx, folder=self.dir, log=self.log)["photos"], [])

    def test_photos_delete_after_the_chosen_days(self):
        ck.set_on(True, ack=True, days=2, path=self.st, log=self.log)
        self.go(now=1000)
        self.assertEqual(ck.purge(1000 + 86400, self.st, self.dir, self.idx, self.log), 0)
        self.assertEqual(ck.purge(1000 + 3 * 86400, self.st, self.dir, self.idx, self.log), 1)
        self.assertEqual(os.listdir(self.dir), [])

    def test_the_owner_can_delete_one(self):
        ck.set_on(True, ack=True, path=self.st, log=self.log)
        e = self.go()
        self.assertTrue(ck.delete(e["photo"], self.dir, self.idx, self.log))
        self.assertFalse(ck.delete(e["photo"], self.dir, self.idx, self.log))
        self.assertEqual(os.listdir(self.dir), [])

    def test_the_log_never_holds_a_name_or_host(self):
        ck.set_on(True, ack=True, path=self.st, log=self.log)
        self.go()
        with open(self.log, encoding="utf-8") as f:
            log = f.read()
        self.assertNotIn("Jordan", log)
        self.assertNotIn("Patel", log)
        self.assertTrue(ck.view(path=self.st, index=self.idx, folder=self.dir, log=self.log)["log_ok"])

    def test_it_uses_the_announced_gate_not_the_silent_one(self):
        # the server passes gcam.take_photo(folder=...) with no silent flag; the gate refuses without the spoken line
        d = tempfile.mkdtemp()
        r = ph.take_photo(play=lambda: None, capture_fn=lambda p: open(p, "wb").write(b"x"), sleep=lambda s: None, folder=d, line_file=os.path.join(d, "missing.wav"))
        self.assertFalse(r["ok"])

    def test_the_front_desk_calls_the_hook_on_a_real_arrival_only(self):
        seen = []
        old = (sk.GUARDIAN_FILE, sk.VISITS_FILE, sk.UNMET_FILE)
        d = tempfile.mkdtemp()
        sk.GUARDIAN_FILE, sk.VISITS_FILE, sk.UNMET_FILE = (os.path.join(d, "g.json"), os.path.join(d, "v.json"), os.path.join(d, "u.json"))
        try:
            sk.save_guardian({"building": "Test", "directory": "Dr. Patel | Room 2", "appointments": "2:30 PM | Jordan Lee | Dr. Patel"})
            sk.guardian_reply("Hi, my name is Jordan Lee", on_visit=lambda n, h: seen.append((n, h)))
            sk.guardian_reply("what are your hours", on_visit=lambda n, h: seen.append(("hours", h)))
            sk.guardian_reply("there is a fire", on_visit=lambda n, h: seen.append(("fire", h)))
            sk.guardian_reply("I'm here to see Dr. Patel", on_visit=lambda n, h: seen.append((n, h)))
        finally:
            sk.GUARDIAN_FILE, sk.VISITS_FILE, sk.UNMET_FILE = old
        self.assertEqual(seen, [("Jordan Lee", "Dr. Patel"), ("", "Dr. Patel")])

    def test_no_em_dashes(self):
        with open(ck.__file__, encoding="utf-8") as f:
            self.assertNotIn("—", f.read())


if __name__ == "__main__":
    unittest.main()
