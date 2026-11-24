import json
import os
import tempfile
import unittest

import al_chain as ch


class Chain(unittest.TestCase):
    def setUp(self):
        self.p = os.path.join(tempfile.mkdtemp(), "log.jsonl")

    def test_good_log_verifies(self):
        for i in range(5):
            ch.append(self.p, "x", {"i": i}, now=100 + i)
        self.assertEqual(ch.verify(self.p), (True, 5))

    def test_empty_log_verifies(self):
        self.assertEqual(ch.verify(self.p), (True, 0))

    def test_changed_line_is_found(self):
        for i in range(4):
            ch.append(self.p, "x", {"i": i}, now=i)
        rows = ch.read(self.p)
        rows[1]["data"]["i"] = 99
        open(self.p, "w").write("\n".join(json.dumps(r, sort_keys=True) for r in rows) + "\n")
        self.assertEqual(ch.verify(self.p), (False, 2))

    def test_removed_line_is_found(self):
        for i in range(4):
            ch.append(self.p, "x", {"i": i}, now=i)
        rows = ch.read(self.p)
        del rows[1]
        open(self.p, "w").write("\n".join(json.dumps(r, sort_keys=True) for r in rows) + "\n")
        self.assertFalse(ch.verify(self.p)[0])

    def test_recent_newest_first(self):
        for i in range(3):
            ch.append(self.p, "e%d" % i, now=i)
        self.assertEqual([r["event"] for r in ch.recent(self.p, 2)], ["e2", "e1"])


if __name__ == "__main__":
    unittest.main()
