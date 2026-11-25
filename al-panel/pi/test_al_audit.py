import os
import tempfile
import unittest

import al_audit as au
import al_chain

GOOD = {"lock": lambda: True, "ports": lambda: {22, 8000}, "logs": lambda: (True, []), "net": lambda: {"on": True, "known": [1, 2], "flagged": []},
        "assets": lambda: None, "room": lambda: None, "alerts": lambda: {"active": []}, "internet": lambda: True, "temp": lambda: 45.0, "disk": lambda: 0.8, "mem": lambda: 0.6}


def probes(**over):
    p = dict(GOOD)
    p.update(over)
    return p


def by_id(res, cid):
    return [r for r in res["checks"] if r["id"] == cid][0]


class Checks(unittest.TestCase):
    def test_all_good(self):
        r = au.run(now=1000, probes=probes())
        self.assertEqual(r["attention"], 0)
        self.assertIn("all in good order", au.spoken(r))

    def test_no_passcode_needs_attention(self):
        r = au.run(probes=probes(lock=lambda: False))
        self.assertEqual(by_id(r, "lock")["status"], "attention")
        self.assertIn("passcode", by_id(r, "lock")["fix"].lower())

    def test_extra_open_port_is_named(self):
        r = au.run(probes=probes(ports=lambda: {22, 8000, 111}))
        c = by_id(r, "ports")
        self.assertEqual(c["status"], "attention")
        self.assertIn("111", c["detail"])

    def test_tampered_log_is_reported(self):
        r = au.run(probes=probes(logs=lambda: (False, ["netwatch_log.jsonl (line 3)"])))
        self.assertIn("netwatch_log.jsonl", by_id(r, "logs")["detail"])

    def test_network_watch_off_and_flagged(self):
        self.assertEqual(by_id(au.run(probes=probes(net=lambda: {"on": False})), "net")["status"], "attention")
        self.assertEqual(by_id(au.run(probes=probes(net=lambda: {"on": True, "known": [], "flagged": [{}]})), "net")["status"], "attention")

    def test_hot_full_and_offline(self):
        r = au.run(probes=probes(temp=lambda: 82.0, disk=lambda: 0.02, mem=lambda: 0.03, internet=lambda: False))
        self.assertEqual(r["attention"], 4)

    def test_unreadable_is_unknown_not_a_pass(self):
        r = au.run(probes=probes(temp=lambda: None))
        self.assertEqual(by_id(r, "heat")["status"], "unknown")
        self.assertEqual(r["unknown"] >= 1, True)

    def test_lan_ports_ignores_loopback_and_tailscale(self):
        text = "LISTEN 0 128 0.0.0.0:8000 0.0.0.0:*\nLISTEN 0 128 100.88.1.1%tailscale0:443 0.0.0.0:*\nLISTEN 0 5 127.0.0.1:631 0.0.0.0:*\nLISTEN 0 128 [::]:22 [::]:*\nLISTEN 0 128 0.0.0.0:111 0.0.0.0:*\n"
        self.assertEqual(au.lan_ports(text), {8000, 22, 111})

    def test_logs_check_really_catches_a_changed_file(self):
        d = tempfile.mkdtemp()
        p = os.path.join(d, "x_log.jsonl")
        al_chain.append(p, "a")
        al_chain.append(p, "b")
        self.assertEqual(au._logs_ok(d)[0], True)
        s = open(p).read().replace('"event": "a"', '"event": "z"')
        open(p, "w").write(s)
        ok, bad = au._logs_ok(d)
        self.assertFalse(ok)
        self.assertIn("x_log.jsonl", bad[0])


class Ask(unittest.TestCase):
    def test_which_sentences_ask_for_it(self):
        for q in ("run a security check", "do a self check", "run your diagnostics", "security audit please", "check yourself"):
            self.assertTrue(au.wants(q), q)
        for q in ("how are you", "what is the temperature", "check the weather"):
            self.assertFalse(au.wants(q), q)

    def test_reply_saves_logs_and_raises_notices(self):
        d = tempfile.mkdtemp()
        raised = []
        orig = au.run
        au.run = lambda *a, **k: orig(probes=probes(lock=lambda: False))
        try:
            s, shown = au.reply("run a security check", raised.append if False else (lambda src, t: raised.append((src, t))), os.path.join(d, "a.json"), os.path.join(d, "a_log.jsonl"))
        finally:
            au.run = orig
        self.assertIn("passcode", s.lower())
        self.assertEqual(raised[0][0], "Security check")
        self.assertEqual(al_chain.verify(os.path.join(d, "a_log.jsonl")), (True, 1))
        self.assertEqual(au.last(os.path.join(d, "a.json"))["attention"], 1)
        self.assertIn("ATTENTION", shown)

    def test_no_dash_and_no_tell_word(self):
        text = open(au.__file__, encoding="utf-8").read()
        self.assertNotIn("\u2014", text)
        self.assertNotIn("plainly", text.lower())


if __name__ == "__main__":
    unittest.main()
