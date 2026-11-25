import os
import tempfile
import unittest

import al_chain
import al_lock as lk


class Lock(unittest.TestCase):
    def setUp(self):
        d = tempfile.mkdtemp()
        self.p, self.l, self.k = (os.path.join(d, n) for n in ("lock.json", "log.jsonl", "secret.key"))
        lk._fail["count"], lk._fail["until"] = 0, 0.0
        lk.ITERATIONS_BACKUP = lk.ITERATIONS
        lk.ITERATIONS = 1000        # fast for tests; the real value is used by the robot

    def tearDown(self):
        lk.ITERATIONS = lk.ITERATIONS_BACKUP

    def test_open_until_set(self):
        self.assertFalse(lk.is_set(self.p))
        self.assertEqual(lk.verify("anything", self.p, self.l), (True, ""))

    def test_set_then_verify(self):
        lk.set_passcode("blue heron 77", path=self.p, log=self.l)
        self.assertTrue(lk.verify("blue heron 77", self.p, self.l)[0])
        self.assertFalse(lk.verify("blue heron 78", self.p, self.l)[0])

    def test_passcode_is_not_stored(self):
        lk.set_passcode("blue heron 77", path=self.p, log=self.l)
        self.assertNotIn("blue heron", open(self.p).read())
        self.assertNotIn("blue heron", open(self.l).read())

    def test_too_short_is_refused(self):
        with self.assertRaises(ValueError):
            lk.set_passcode("abc", path=self.p, log=self.l)

    def test_change_needs_the_current_one(self):
        lk.set_passcode("blue heron 77", path=self.p, log=self.l)
        with self.assertRaises(ValueError):
            lk.set_passcode("new one 1234", "wrong", self.p, self.l)
        lk.set_passcode("new one 1234", "blue heron 77", self.p, self.l)
        self.assertTrue(lk.verify("new one 1234", self.p, self.l)[0])

    def test_five_misses_then_a_wait_that_even_the_right_one_respects(self):
        lk.set_passcode("blue heron 77", path=self.p, log=self.l)
        t = 1000.0
        for i in range(lk.FREE_MISSES):
            lk.verify("no", self.p, self.l, now=t + i)
        ok, why = lk.verify("blue heron 77", self.p, self.l, now=t + 6)
        self.assertFalse(ok)
        self.assertIn("Wait", why)
        self.assertTrue(lk.verify("blue heron 77", self.p, self.l, now=t + 200)[0])

    def test_wait_grows_and_is_capped(self):
        lk.set_passcode("blue heron 77", path=self.p, log=self.l)
        t = 0.0
        for i in range(40):
            t += 10000
            lk.verify("no", self.p, self.l, now=t)
        self.assertLessEqual(lk.wait_left(t), lk.MAX_WAIT)

    def test_clear_needs_the_passcode(self):
        lk.set_passcode("blue heron 77", path=self.p, log=self.l)
        with self.assertRaises(ValueError):
            lk.clear("nope", self.p, self.l)
        lk.clear("blue heron 77", self.p, self.l)
        self.assertFalse(lk.is_set(self.p))

    def test_cookie_token(self):
        key = lk.secret_key(self.k)
        self.assertEqual(key, lk.secret_key(self.k))
        t = lk.make_token(key, now=1000)
        self.assertTrue(lk.token_ok(t, key, now=2000))
        self.assertFalse(lk.token_ok(t, key, now=1000 + 8 * 86400))
        self.assertFalse(lk.token_ok(t + "0", key, now=2000))
        self.assertFalse(lk.token_ok("garbage", key))
        self.assertFalse(lk.token_ok(t, b"x" * 48, now=2000))

    def test_open_paths(self):
        for p in ("/api/lock/login", "/api/lock/status", "/login", "/robots.json", "/api/robot", "/images/x.webp"):
            self.assertFalse(lk.needs_sign_in(p), p)
        for p in ("/", "/api/sentry", "/api/place", "/photos", "/photos/a.jpg", "/api/netwatch", "/sentry", "/api/take-photo"):
            self.assertTrue(lk.needs_sign_in(p), p)

    def test_decide(self):
        self.assertEqual(lk.decide("/api/sentry", "", lock_path=self.p, key_path=self.k), "open")      # no passcode set yet: the panel is open as before
        lk.set_passcode("blue heron 77", path=self.p, log=self.l)
        good = lk.make_token(lk.secret_key(self.k))
        for path in ("/api/sentry", "/api/place", "/photos/a.jpg", "/api/take-photo"):
            self.assertEqual(lk.decide(path, "", lock_path=self.p, key_path=self.k), "api", path)
            self.assertEqual(lk.decide(path, good, lock_path=self.p, key_path=self.k), "open", path)
        for path in ("/", "/sentry", "/photos"):
            self.assertEqual(lk.decide(path, "", lock_path=self.p, key_path=self.k), "page", path)
            self.assertEqual(lk.decide(path, "nonsense", lock_path=self.p, key_path=self.k), "page", path)
        for path in ("/api/lock/status", "/api/lock/login", "/api/robot", "/robots.json", "/images/x.webp"):
            self.assertEqual(lk.decide(path, "", lock_path=self.p, key_path=self.k), "open", path)

    def test_events_are_logged_and_the_log_verifies(self):
        lk.set_passcode("blue heron 77", path=self.p, log=self.l)
        lk.verify("no", self.p, self.l)
        lk.verify("blue heron 77", self.p, self.l)
        self.assertEqual(al_chain.verify(self.l), (True, 3))

    def test_login_page_has_no_dash_or_the_tell_word(self):
        text = lk.login_page("x") + lk.__doc__
        self.assertNotIn("—", text)
        self.assertNotIn("plainly", text.lower())


if __name__ == "__main__":
    unittest.main()
