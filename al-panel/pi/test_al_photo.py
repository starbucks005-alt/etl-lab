"""Tests for the Guardian's photo gate. Run:  py -m unittest test_al_photo   (from this folder). No camera or speaker needed."""
import os
import tempfile
import threading
import unittest

import al_photo as ph


class Gate(unittest.TestCase):
    def setUp(self):
        self.dir = tempfile.mkdtemp()
        self.line = os.path.join(self.dir, "photo_line.wav")
        open(self.line, "wb").write(b"RIFFfake")
        self.folder = os.path.join(self.dir, "photos")
        self.calls = []
        ph._last_own[0] = 0.0

    def go(self, play=None, cap=None, **kw):
        def p():
            self.calls.append("say")
            if play:
                play()

        def c(path):
            self.calls.append("shoot")
            if cap:
                cap(path)
            else:
                open(path, "wb").write(b"jpg")
        return ph.take_photo(play=p, capture_fn=c, sleep=lambda s: self.calls.append("wait"), line_file=self.line, folder=self.folder, **kw)

    def test_she_speaks_then_waits_then_shoots(self):
        r = self.go()
        self.assertTrue(r["ok"])
        self.assertEqual(self.calls, ["say", "wait", "shoot"])
        self.assertTrue(os.path.isfile(os.path.join(self.folder, r["name"])))

    def test_no_line_file_no_photo(self):
        os.remove(self.line)
        r = self.go()
        self.assertFalse(r["ok"])
        self.assertNotIn("shoot", self.calls)
        self.assertEqual(ph.list_photos(self.folder), [])

    def test_speaker_fails_no_photo(self):
        def boom():
            raise RuntimeError("busy")
        r = self.go(play=boom)
        self.assertFalse(r["ok"])
        self.assertNotIn("shoot", self.calls)
        self.assertEqual(ph.list_photos(self.folder), [])

    def test_camera_fails_leaves_no_file(self):
        def boom(path):
            open(path, "wb").write(b"half")
            raise RuntimeError("no camera")
        r = self.go(cap=boom)
        self.assertFalse(r["ok"])
        self.assertEqual(ph.list_photos(self.folder), [])

    def test_keeps_only_the_newest(self):
        for i in range(ph.KEEP_LAST + 5):
            os.makedirs(self.folder, exist_ok=True)
            open(os.path.join(self.folder, "photo_20260101_%06d.jpg" % i), "wb").write(b"x")
        ph.prune(self.folder)
        names = ph.list_photos(self.folder)
        self.assertEqual(len(names), ph.KEEP_LAST)
        self.assertEqual(names[0], "photo_20260101_%06d.jpg" % (ph.KEEP_LAST + 4))

    def test_safe_path_refuses_anything_but_our_names(self):
        os.makedirs(self.folder, exist_ok=True)
        open(os.path.join(self.folder, "photo_20260101_000001.jpg"), "wb").write(b"x")
        self.assertIsNotNone(ph.safe_path("photo_20260101_000001.jpg", self.folder))
        for bad in ("../x.jpg", "photo_20260101_000001.jpg/../../x", "a.jpg", "", None, "photo_20260101_000002.jpg"):
            self.assertIsNone(ph.safe_path(bad, self.folder))

    def test_second_request_at_the_same_moment_is_refused(self):
        ph._lock.acquire()
        try:
            r = self.go()
        finally:
            ph._lock.release()
        self.assertFalse(r["ok"])
        self.assertEqual(self.calls, [])

    def test_her_own_photos_are_spaced_but_the_first_goes_through(self):
        t = [1000.0]
        r1 = self.go_herself(t)
        self.assertTrue(r1["ok"])
        t[0] += 5
        r2 = self.go_herself(t)
        self.assertFalse(r2["ok"])
        t[0] += ph.OWN_GAP_SECONDS
        self.assertTrue(self.go_herself(t)["ok"])

    def go_herself(self, t):
        def c(path):
            open(path, "wb").write(b"jpg")
        return ph.take_photo_herself(clock=lambda: t[0], play=lambda: self.calls.append("say"), capture_fn=c,
                                     sleep=lambda s: None, line_file=self.line, folder=self.folder, now=__import__("time").localtime(t[0]))

    def test_no_dashes_or_plainly_in_what_people_read(self):
        text = ph.page_html()
        self.assertNotIn("\u2014", text)
        self.assertNotIn("plainly", text.lower())


if __name__ == "__main__":
    unittest.main()
