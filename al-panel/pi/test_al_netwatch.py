import os
import tempfile
import unittest

import al_chain
import al_netwatch as nw


class Net(unittest.TestCase):
    def setUp(self):
        d = tempfile.mkdtemp()
        self.s, self.l = os.path.join(d, "s.json"), os.path.join(d, "l.jsonl")
        self.host = lambda ip: "host-" + ip.split(".")[-1]

    A, B, C = "aa:aa:aa:aa:aa:01", "aa:aa:aa:aa:aa:02", "fa:aa:aa:aa:aa:03"

    def test_first_scan_learns_everything_and_flags_nothing(self):
        fresh = nw.scan_now(sweep_fn=lambda net: {self.A: "192.168.0.5", self.B: "192.168.0.6"}, path=self.s, log=self.l, subnet="192.168.0.0/24")
        self.assertEqual(fresh, [])
        self.assertEqual(len(nw.state(self.s)["known"]), 2)

    def test_unknown_device_is_flagged_once_and_logged(self):
        nw.learn({self.A: "192.168.0.5"}, self.host, self.s, self.l)
        got = []
        nw.audit({self.A: "192.168.0.5", self.C: "192.168.0.9"}, self.host, self.s, self.l)
        again = nw.audit({self.A: "192.168.0.5", self.C: "192.168.0.9"}, self.host, self.s, self.l)
        self.assertEqual(again, [])
        v = nw.view(self.s, self.l)
        self.assertEqual(len(v["flagged"]), 1)
        self.assertTrue(v["flagged"][0]["private_mac"])
        self.assertTrue(v["log_ok"])
        self.assertIn("unknown_device", [r["event"] for r in v["log"]])

    def test_scan_calls_the_voice_hook_for_new_unknowns(self):
        nw.learn({self.A: "192.168.0.5"}, self.host, self.s, self.l)
        got = []
        nw.scan_now(on_unknown=got.extend, sweep_fn=lambda net: {self.A: "192.168.0.5", self.B: "192.168.0.7"}, path=self.s, log=self.l, subnet="192.168.0.0/24")
        self.assertEqual(len(got), 1)

    def test_approve_moves_it_to_known_with_a_name(self):
        nw.learn({self.A: "192.168.0.5"}, self.host, self.s, self.l)
        nw.audit({self.A: "192.168.0.5", self.B: "192.168.0.7"}, self.host, self.s, self.l)
        nw.approve(self.B, "Front desk printer", self.s, self.l)
        st = nw.state(self.s)
        self.assertEqual(st["known"][self.B]["name"], "Front desk printer")
        self.assertEqual(st["flagged"], {})

    def test_tampered_log_is_noticed(self):
        nw.learn({self.A: "192.168.0.5"}, self.host, self.s, self.l)
        nw.audit({self.A: "192.168.0.5", self.B: "192.168.0.7"}, self.host, self.s, self.l)
        text = open(self.l).read().replace("unknown_device", "approved")
        open(self.l, "w").write(text)
        self.assertFalse(nw.view(self.s, self.l)["log_ok"])

    def test_switch(self):
        self.assertFalse(nw.state(self.s)["on"])
        nw.set_on(True, self.s, self.l)
        self.assertTrue(nw.state(self.s)["on"])

    def test_neighbor_parser(self):
        class R:
            stdout = "192.168.0.1 dev wlan0 lladdr aa:bb:cc:dd:ee:01 REACHABLE\n192.168.0.99 dev wlan0  FAILED\n192.168.0.7 dev wlan0 lladdr AA:BB:CC:DD:EE:02 STALE\n"
        import subprocess
        old = subprocess.run
        subprocess.run = lambda *a, **k: R()
        try:
            self.assertEqual(nw.neighbors(), {"aa:bb:cc:dd:ee:01": "192.168.0.1", "aa:bb:cc:dd:ee:02": "192.168.0.7"})
        finally:
            subprocess.run = old


if __name__ == "__main__":
    unittest.main()
