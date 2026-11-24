import os
import shutil
import tempfile
import unittest

from PIL import Image, ImageDraw

import al_assets as aa


def room(path, bright=0, moved=False):
    im = Image.new("RGB", (400, 300), (110 + bright, 110 + bright, 120 + bright))
    d = ImageDraw.Draw(im)
    d.rectangle((40, 40, 140, 120), fill=(30 + bright, 60 + bright, 160))            # the item in box "Cart"
    d.rectangle((250, 150, 350, 250), fill=(180 + min(bright, 20), 90, 60))          # the item in box "Projector"
    if moved:
        d.rectangle((40, 40, 140, 120), fill=(110 + bright, 110 + bright, 120 + bright))   # the Cart is gone
    im.save(path, "JPEG", quality=95)


ITEMS = [{"name": "Cart", "x": 0.08, "y": 0.1, "w": 0.3, "h": 0.3}, {"name": "Projector", "x": 0.6, "y": 0.48, "w": 0.3, "h": 0.36}]


class Assets(unittest.TestCase):
    def setUp(self):
        self.d = tempfile.mkdtemp()
        self.s, self.l, self.ref = (os.path.join(self.d, n) for n in ("s.json", "l.jsonl", "ref.jpg"))

    def photo_fn(self, **kw):
        def f():
            room(os.path.join(self.d, "p.jpg"), **kw)
            return {"ok": True, "name": "p.jpg"}
        return f

    def ready(self):
        aa.set_items(ITEMS, self.s, self.l)
        r = aa.take_reference(self.photo_fn(), self.s, self.ref, self.l, self.d)
        self.assertTrue(r["ok"])

    def test_same_room_no_change(self):
        self.ready()
        r = aa.check(self.photo_fn(), self.d, self.s, self.ref, self.l)
        self.assertTrue(r["ok"])
        self.assertFalse(any(x["changed"] for x in r["results"]))

    def test_removed_item_is_named(self):
        self.ready()
        got = []
        r = aa.check(self.photo_fn(moved=True), self.d, self.s, self.ref, self.l, on_change=lambda names, p: got.append(names))
        self.assertEqual([x["name"] for x in r["results"] if x["changed"]], ["Cart"])
        self.assertEqual(got, [["Cart"]])

    def test_a_cloud_is_not_a_change(self):
        self.ready()
        r = aa.check(self.photo_fn(bright=20), self.d, self.s, self.ref, self.l)
        self.assertFalse(any(x["changed"] for x in r["results"]))

    def test_big_light_shift_says_camera_may_have_moved(self):
        self.ready()
        r = aa.check(self.photo_fn(bright=70), self.d, self.s, self.ref, self.l)
        self.assertTrue(r["moved"])

    def test_needs_reference_and_items(self):
        self.assertIn("reference", aa.check(self.photo_fn(), self.d, self.s, self.ref, self.l)["why"])
        open(self.ref, "w").close()
        self.assertIn("box", aa.check(self.photo_fn(), self.d, self.s, self.ref, self.l)["why"])

    def test_failed_photo_is_reported_and_no_comparison(self):
        self.ready()
        r = aa.check(lambda: {"ok": False, "why": "no photo: she could not say it out loud"}, self.d, self.s, self.ref, self.l)
        self.assertFalse(r["ok"])
        self.assertIn("say it", r["why"])

    def test_items_are_cleaned_and_capped(self):
        aa.set_items([{"name": "<b>Bad</b>", "x": -1, "y": 0.5, "w": 5, "h": 0.2}] + [{"name": "n%d" % i, "x": 0, "y": 0, "w": .1, "h": .1} for i in range(30)], self.s, self.l)
        st = aa.state(self.s)
        self.assertEqual(len(st["items"]), aa.MAX_ITEMS)
        self.assertEqual(st["items"][0]["name"], "bBadb")
        self.assertLessEqual(st["items"][0]["w"], 1.0)

    def test_interval_only_from_the_list(self):
        aa.set_interval(15, self.s, self.l)
        self.assertEqual(aa.state(self.s)["interval"], 15)
        with self.assertRaises(ValueError):
            aa.set_interval(7, self.s, self.l)

    def test_log_is_tamper_evident(self):
        self.ready()
        aa.check(self.photo_fn(moved=True), self.d, self.s, self.ref, self.l)
        self.assertTrue(aa.view(self.s, self.ref, self.l)["log_ok"])


if __name__ == "__main__":
    unittest.main()
