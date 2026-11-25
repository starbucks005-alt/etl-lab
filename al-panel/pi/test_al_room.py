import os
import tempfile
import time
import unittest

import al_room as rm


def broadcast(temp_c=21.5, humidity=42, co2=812, battery=100, model=0x35, short=False):
    """A made up broadcast built from the layout in al_room's header."""
    mfr = bytearray(15 if not short else 11)
    sign = 0x80 if temp_c >= 0 else 0
    whole = int(abs(temp_c))
    mfr[8] = int(round((abs(temp_c) - whole) * 10)) & 0x0F
    mfr[9] = sign | whole
    mfr[10] = humidity
    if not short:
        mfr[13:15] = co2.to_bytes(2, "big")
    return bytes([model, 0x00, battery]), bytes(mfr)


class Parse(unittest.TestCase):
    def test_reads_temperature_humidity_battery_and_co2(self):
        r = rm.parse(*broadcast())
        self.assertEqual((r["temp_c"], r["humidity"], r["battery"], r["co2"]), (21.5, 42, 100, 812))
        self.assertEqual(r["temp_f"], 70.7)

    def test_below_zero(self):
        self.assertEqual(rm.parse(*broadcast(temp_c=-3.0))["temp_c"], -3.0)

    def test_no_co2_in_a_short_broadcast(self):
        self.assertIsNone(rm.parse(*broadcast(short=True))["co2"])

    def test_silly_co2_is_dropped(self):
        self.assertIsNone(rm.parse(*broadcast(co2=20000))["co2"])

    def test_other_devices_and_junk_are_ignored(self):
        self.assertIsNone(rm.parse(*broadcast(model=0x48)))
        self.assertIsNone(rm.parse(None, None))
        self.assertIsNone(rm.parse(b"\x35", b"\x00" * 3))


class Ask(unittest.TestCase):
    def setUp(self):
        self.cfg = os.path.join(tempfile.mkdtemp(), "room.json")
        rm._latest.update(reading=None, t=0.0, error="")

    def ready(self, **kw):
        rm.set_mac("AA:BB:CC:DD:EE:01", self.cfg)
        r = rm.parse(*broadcast(**kw))
        rm._latest.update(reading=r, t=1000.0, error="")

    def test_which_questions_are_about_the_room(self):
        for q, k in (("what is the temperature", "temperature"), ("how hot is it in here", "temperature"), ("what is the humidity", "humidity"),
                     ("how is the air", "air"), ("what is the CO2", "air"), ("is it stuffy in here", "air")):
            self.assertEqual(rm.wants(q), k, q)
        for q in ("what is the weather in Dayton", "what is the temperature outside", "what is the temperature in Dayton", "what is your temperature",
                  "hello guardian", "my temperature is high"):
            self.assertIsNone(rm.wants(q), q)

    def test_says_the_numbers_in_words(self):
        self.ready()
        s, shown = rm.room_reply("what is the temperature", now=1030, path=self.cfg)
        self.assertIn("71 degrees", s)
        self.assertIn("42 percent humidity", s)
        self.assertIn("Source", shown)
        a, _ = rm.room_reply("how is the air", now=1030, path=self.cfg)
        self.assertIn("812 parts per million", a)
        self.assertIn("fresh air", a)

    def test_stuffy_and_high(self):
        self.ready(co2=1400)
        self.assertIn("stuffy", rm.room_reply("how is the air", now=1030, path=self.cfg)[0])
        self.ready(co2=2600)
        self.assertIn("open a window", rm.room_reply("how is the air", now=1030, path=self.cfg)[0])

    def test_a_stale_reading_says_so(self):
        self.ready()
        s, _ = rm.room_reply("what is the temperature", now=1000 + 20 * 60, path=self.cfg)
        self.assertIn("20 minutes ago", s)

    def test_no_sensor_set_up_says_she_does_not_know(self):
        s, _ = rm.room_reply("what is the temperature", path=self.cfg)
        self.assertIn("do not have a room sensor", s)

    def test_sensor_set_but_never_heard(self):
        rm.set_mac("AA:BB:CC:DD:EE:01", self.cfg)
        s, _ = rm.room_reply("how is the air", path=self.cfg)
        self.assertIn("have not heard", s)

    def test_poll_uses_the_chosen_sensor_only(self):
        rm.set_mac("AA:BB:CC:DD:EE:01", self.cfg)
        other = dict(rm.parse(*broadcast(temp_c=10)), rssi=-50, name="x")
        mine = dict(rm.parse(*broadcast(temp_c=22)), rssi=-60, name="y")
        r = rm.poll_once(self.cfg, scanner=lambda t: {"AA:BB:CC:DD:EE:02": other, "AA:BB:CC:DD:EE:01": mine}, now=500)
        self.assertEqual(r["temp_c"], 22.0)
        self.assertEqual(rm.latest(now=530)["age"], 30)

    def test_missing_bluetooth_package_is_reported_not_hidden(self):
        rm.set_mac("AA:BB:CC:DD:EE:01", self.cfg)

        def boom(t):
            raise ImportError("no bleak")
        self.assertIsNone(rm.poll_once(self.cfg, scanner=boom))
        self.assertIn("not installed", rm.latest()["error"])

    def test_bad_address_is_refused(self):
        with self.assertRaises(ValueError):
            rm.set_mac("nonsense", self.cfg)

    def test_nothing_she_says_has_a_dash_or_the_tell_word(self):
        text = open(rm.__file__, encoding="utf-8").read()
        self.assertNotIn("—", text)
        self.assertNotIn("plainly", text.lower())


if __name__ == "__main__":
    unittest.main()
