import os
import tempfile
import unittest

import al_devcheck as dc

OUI = """OUI/MA-L			Organization
company_id			Organization Name

00-50-56   (hex)\t\tVMware, Inc.
005056     (base 16)\t\tVMware, Inc.
B8-27-EB   (hex)\t\tRaspberry Pi Foundation
"""

DEVICES = {"b8:27:eb:11:22:33": {"ip": "192.168.0.50", "name": "pi"}, "02:aa:bb:cc:dd:ee": {"ip": "192.168.0.51", "name": ""},
           "00:11:22:33:44:55": {"ip": "8.8.8.8", "name": "outside"}, "00:50:56:00:00:01": {"ip": "127.0.0.1", "name": "loop"}}


class Dev(unittest.TestCase):
    def setUp(self):
        d = tempfile.mkdtemp()
        self.oui = os.path.join(d, "oui.txt")
        open(self.oui, "w", encoding="utf-8").write(OUI)
        self.sf, self.log = os.path.join(d, "s.json"), os.path.join(d, "l.jsonl")
        dc._last.clear()
        self.tried = []

    def connect_for(self, open_ports):
        def c(ip, port, timeout):
            self.tried.append((ip, port))
            return port in open_ports
        return c

    def run_check(self, mac, open_ports=(), **kw):
        return dc.check(mac, DEVICES, now=kw.pop("now", 1000), connect=self.connect_for(open_ports), oui=[self.oui], state_file=self.sf, log=self.log)

    def test_the_maker_comes_from_the_list_and_is_never_guessed(self):
        self.assertEqual(dc.vendor("b8:27:eb:11:22:33", [self.oui]), ("Raspberry Pi Foundation", ""))
        m, note = dc.vendor("ac:de:48:00:11:22", [self.oui])
        self.assertIsNone(m)
        self.assertIn("not in my maker list", note)
        m, note = dc.vendor("b8:27:eb:11:22:33", [os.path.join(tempfile.gettempdir(), "no_such_oui.txt")])
        self.assertIsNone(m)
        self.assertIn("do not have a maker list", note)

    def test_a_made_up_phone_address_says_so_instead_of_guessing(self):
        m, note = dc.vendor("02:aa:bb:cc:dd:ee", [self.oui])
        self.assertIsNone(m)
        self.assertIn("made up on purpose", note)
        self.assertTrue(dc.is_random("da:a1:19:00:00:00"))
        self.assertFalse(dc.is_random("b8:27:eb:00:00:00"))

    def test_open_ports_are_reported_with_what_they_are_for(self):
        r = self.run_check("b8:27:eb:11:22:33", open_ports=(22, 80, 9100))
        self.assertEqual([o["port"] for o in r["open"]], [22, 80, 9100])
        self.assertEqual(r["maker"], "Raspberry Pi Foundation")
        said = dc.say(r)
        self.assertIn("22, remote login (ssh)", said)
        self.assertIn("I do not say whether a device is safe", said)

    def test_nothing_answering_is_said(self):
        r = self.run_check("b8:27:eb:11:22:33")
        self.assertIn("None of the", dc.say(r))

    def test_telnet_gets_a_fact_not_a_verdict(self):
        said = dc.say(self.run_check("b8:27:eb:11:22:33", open_ports=(23,)))
        self.assertIn("unencrypted", said)
        for bad in ("malicious", "hacker", "intruder", "dangerous"):
            self.assertNotIn(bad, said.lower())

    def test_only_private_network_devices_that_netwatch_has_seen(self):
        for mac in ("00:11:22:33:44:55", "00:50:56:00:00:01"):
            with self.assertRaises(ValueError):
                self.run_check(mac)
        with self.assertRaises(ValueError):
            self.run_check("aa:bb:cc:dd:ee:ff")
        self.assertEqual(self.tried, [])

    def test_address_rules(self):
        for ip in ("192.168.0.9", "10.1.2.3", "172.16.0.5"):
            self.assertTrue(dc.allowed_ip(ip), ip)
        for ip in ("8.8.8.8", "127.0.0.1", "169.254.1.1", "224.0.0.1", "0.0.0.0", "100.88.176.37", "::1", "nonsense"):
            self.assertFalse(dc.allowed_ip(ip), ip)

    def test_it_only_makes_connections_to_that_one_address_on_the_listed_ports(self):
        self.run_check("b8:27:eb:11:22:33")
        self.assertEqual({ip for ip, _ in self.tried}, {"192.168.0.50"})
        self.assertEqual({p for _, p in self.tried}, set(dc.PORTS))

    def test_a_second_press_within_the_gap_waits(self):
        self.run_check("b8:27:eb:11:22:33", now=1000)
        with self.assertRaises(ValueError):
            self.run_check("b8:27:eb:11:22:33", now=1010)
        self.assertIsNotNone(self.run_check("b8:27:eb:11:22:33", now=1031))

    def test_the_log_holds_the_address_and_ports_only(self):
        self.run_check("b8:27:eb:11:22:33", open_ports=(22,))
        with open(self.log, encoding="utf-8") as f:
            log = f.read()
        self.assertIn("b8:27:eb:11:22:33", log)
        self.assertNotIn("Raspberry", log)

    def test_no_em_dashes(self):
        with open(dc.__file__, encoding="utf-8") as f:
            self.assertNotIn("—", f.read())


if __name__ == "__main__":
    unittest.main()
