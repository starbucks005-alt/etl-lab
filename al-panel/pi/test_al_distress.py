import array
import os
import tempfile
import unittest
import wave

import al_distress as ds


def make_wav(path, levels, rate=16000):
    """One 0.1 second frame per level, each a square wave at that loudness."""
    pcm = array.array("h")
    for lv in levels:
        pcm.extend([lv if (i // 20) % 2 == 0 else -lv for i in range(rate // 10)])
    with wave.open(path, "wb") as w:
        w.setnchannels(1)
        w.setsampwidth(2)
        w.setframerate(rate)
        w.writeframes(pcm.tobytes())


class Distress(unittest.TestCase):
    def setUp(self):
        d = tempfile.mkdtemp()
        self.st, self.log = os.path.join(d, "d.json"), os.path.join(d, "d.jsonl")
        self.quiet, self.loud = os.path.join(d, "q.wav"), os.path.join(d, "l.wav")
        make_wav(self.quiet, [800] * 30)
        make_wav(self.loud, [9000] * 40)
        ds._last[0] = 0.0

    def on(self):
        ds.set_on(True, ack=True, now=100, path=self.st, log=self.log)

    def chk(self, words, clip=None, now=1000, floor=None):
        return ds.check(clip or self.quiet, words, floor=floor, now=now, state_path=self.st, log=self.log)

    def test_off_by_default_hears_nothing(self):
        self.assertIsNone(self.chk("get off me", self.loud))

    def test_the_switch_needs_the_tick(self):
        with self.assertRaises(ValueError):
            ds.set_on(True, ack=False, path=self.st, log=self.log)
        self.assertFalse(ds.state(self.st)["on"])

    def test_clear_phrases_raise_a_tier_two(self):
        self.on()
        for i, w in enumerate(("Get off me!", "Leave me alone.", "I'm calling the police", "help", "Stop it!", "Somebody help me!", "call 911")):
            r = self.chk(w, now=1000 + i * 100)
            self.assertIsNotNone(r, w)
            self.assertEqual(r["tier"], 2)

    def test_ordinary_asking_for_help_or_directions_is_not_an_alarm(self):
        self.on()
        for i, w in enumerate(("Can you help me find the restroom", "I need help with my badge", "please help me with the form", "stop by later", "where do I call the police department", "the help desk",
                               "I will stop here", "can you stop talking", "what is the weather", "let me go get my coat")):
            self.assertIsNone(self.chk(w, now=1000 + i * 100), w)

    def test_words_say_what_she_heard_and_do_not_say_what_it_means(self):
        self.on()
        r = self.chk("get off me")
        self.assertIn("I only heard the words, I cannot tell what is happening", r["text"])
        for bad in ("hostile", "attack", "intruder", "danger", "threat"):
            self.assertNotIn(bad, r["text"].lower())

    def test_loud_alone_is_only_a_notice(self):
        self.on()
        r = self.chk("hello there everyone", self.loud)
        self.assertEqual(r["tier"], 1)
        self.assertIn("cannot tell what it was", r["text"])
        self.assertIsNone(r["phrase"])

    def test_loud_and_words_are_tier_two_and_say_both(self):
        self.on()
        r = self.chk("leave me alone", self.loud)
        self.assertEqual(r["tier"], 2)
        self.assertIn("and loud sound for 4 seconds", r["text"])

    def test_a_loud_room_does_not_count_as_loud(self):
        self.on()
        self.assertIsNone(self.chk("hello", self.loud, floor=8000))       # the room itself is loud: 2.5 times 8000 is above this clip

    def test_one_alert_a_minute(self):
        self.on()
        self.assertIsNotNone(self.chk("get off me", now=1000))
        self.assertIsNone(self.chk("get off me", now=1030))
        self.assertIsNotNone(self.chk("get off me", now=1061))

    def test_it_is_silent_and_uses_the_recording_period_only_when_given(self):
        self.on()
        r = self.chk("get off me")
        calls = []
        ds.act(r, raise_alert=lambda *a: calls.append(("alert",) + a), start_recording=lambda *a: calls.append(("rec",) + a))
        self.assertEqual(calls[0][0:2], ("alert", "Distress words"))
        self.assertEqual(calls[0][3], 2)
        self.assertEqual(calls[1], ("rec", "distress words", ds.RECORD_MINUTES))
        calls.clear()
        ds._last[0] = 0
        r = self.chk("hello", self.loud, now=5000)
        ds.act(r, raise_alert=lambda *a: calls.append(a), start_recording=lambda *a: calls.append(("rec",) + a))
        self.assertEqual(len(calls), 1)               # a notice never starts a recording

    def test_the_log_holds_the_phrase_but_not_the_sentence(self):
        self.on()
        self.chk("I said get off me because he took my private account number 12345")
        with open(self.log, encoding="utf-8") as f:
            log = f.read()
        self.assertIn("get off me", log)
        self.assertNotIn("12345", log)
        self.assertNotIn("account", log)
        self.assertTrue(ds.view(self.st, self.log)["log_ok"])

    def test_loudness_reading(self):
        self.assertEqual(ds.loud_seconds(self.loud), 4.0)
        self.assertEqual(ds.loud_seconds(self.quiet), 0.0)
        self.assertEqual(ds.loud_seconds(os.path.join(tempfile.gettempdir(), "no_such_clip.wav")), 0.0)

    def test_no_em_dashes(self):
        with open(ds.__file__, encoding="utf-8") as f:
            self.assertNotIn("—", f.read())


if __name__ == "__main__":
    unittest.main()
