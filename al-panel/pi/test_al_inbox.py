import os
import tempfile
import unittest

import al_inbox as ib


class Inbox(unittest.TestCase):
    def setUp(self):
        d = tempfile.mkdtemp()
        self.p, self.l = os.path.join(d, "i.json"), os.path.join(d, "i.jsonl")

    def add(self, *a, **k):
        return ib.add(*a, path=self.p, log=self.l, **k)

    def test_notes_are_owner_only_by_default(self):
        n = self.add("Phishing wave", "Watch for invoices.", source="InfraGard", mark="TLP:AMBER")
        self.assertEqual(n["share"], "owner")
        self.assertEqual(ib.load(self.p)[0]["title"], "Phishing wave")

    def test_she_never_reads_an_owner_only_note_and_never_shows_its_title(self):
        self.add("Phishing wave", "Watch for invoices.", mark="TLP:AMBER")
        sp, shown = ib.reply("any InfraGard alerts", self.p)
        self.assertIn("I do not see InfraGard alerts myself", sp)
        self.assertIn("1 more is on my panel", sp)
        for s in (sp, shown):
            self.assertNotIn("Phishing", s)
            self.assertNotIn("invoices", s)

    def test_a_note_marked_room_is_read_word_for_word_with_its_mark(self):
        self.add("Road closure", "Main gate closed Friday.", mark="TLP:CLEAR", share="room")
        sp, shown = ib.reply("read my notes", self.p)
        self.assertIn("TLP:CLEAR, Road closure: Main gate closed Friday.", sp)
        self.assertIn("Road closure", shown)

    def test_empty_box_says_so(self):
        self.assertIn("There are none right now", ib.reply("any infragard alerts", self.p)[0])

    def test_owner_can_change_who_may_hear_it_and_remove_it(self):
        n = self.add("A", "words")
        self.assertTrue(ib.set_share(n["id"], "room", self.p, self.l))
        self.assertEqual(ib.counts(self.p), (1, 1))
        self.assertTrue(ib.remove(n["id"], self.p, self.l))
        self.assertFalse(ib.remove(n["id"], self.p, self.l))
        self.assertEqual(ib.counts(self.p), (0, 0))
        with self.assertRaises(ValueError):
            ib.set_share("n1", "everyone", self.p, self.l)

    def test_limits_and_cleaning(self):
        n = self.add("T" * 500, "x" * 5000 + "\x00\x07")
        self.assertEqual(len(n["title"]), ib.MAX_TITLE)
        self.assertEqual(len(n["text"]), ib.MAX_TEXT)
        with self.assertRaises(ValueError):
            self.add("", "   ")
        for i in range(ib.MAX_NOTES - 1):
            self.add("t%d" % i, "x")
        with self.assertRaises(ValueError):
            self.add("one more", "x")

    def test_ids_do_not_repeat_after_a_removal(self):
        a, b = self.add("A", "x"), self.add("B", "x")
        ib.remove(a["id"], self.p, self.l)
        self.assertNotEqual(self.add("C", "x")["id"], b["id"])

    def test_the_log_never_holds_the_words(self):
        self.add("Secret title", "Secret words", mark="TLP:RED")
        with open(self.l, encoding="utf-8") as f:
            log = f.read()
        self.assertNotIn("Secret", log)
        self.assertIn("TLP:RED", log)
        self.assertTrue(ib.view(self.p, self.l)["log_ok"])

    def test_briefing_line_counts_and_names_only_shareable_titles(self):
        self.assertIsNone(ib.briefing_line(self.p))
        self.add("Hidden", "x")
        self.add("Sayable", "x", share="room")
        s = ib.briefing_line(self.p)
        self.assertIn("2 notes", s)
        self.assertIn("Sayable", s)
        self.assertNotIn("Hidden", s)

    def test_which_questions_are_taken(self):
        for q in ("any InfraGard alerts", "read my InfraGard notes", "what are my notes", "check the inbox", "infragard messages"):
            self.assertTrue(ib.wants(q), q)
        for q in ("what is infragard", "tell me about the water sector", "brief me", "what is the weather"):
            self.assertFalse(ib.wants(q), q)


if __name__ == "__main__":
    unittest.main()
