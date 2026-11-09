"""Run: python3 -m unittest tests/al_follow_test.py   (stand-in HuskyLens, no robot, no servos)"""
import os, sys, unittest

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "al-panel", "pi"))
import al_follow as af  # noqa: E402


class FakeTransport:
    """Answers each request with the frames it was given, handed out 16 bytes at a time, padded with zeros."""

    def __init__(self, answers=()):
        self.answers = list(answers)
        self.sent = []
        self.pending = b""

    def write(self, data):
        self.sent.append(bytes(data))
        self.pending = self.answers.pop(0) if self.answers else b""

    def read(self, n):
        chunk, self.pending = self.pending[:n], self.pending[n:]
        return chunk + bytes(n - len(chunk))


def block(x, y, w, h, ident=0):
    data = b"".join(v.to_bytes(2, "little") for v in (x, y, w, h, ident))
    return af.frame(af.CMD_RETURN_BLOCK, data)


def info(count):
    return af.frame(af.CMD_RETURN_INFO, count.to_bytes(2, "little") + bytes(8))


class Protocol(unittest.TestCase):
    def test_knock_frame_matches_the_published_bytes(self):
        self.assertEqual(af.frame(af.CMD_KNOCK), bytes([0x55, 0xAA, 0x11, 0x00, 0x2C, 0x3C]))

    def test_request_blocks_frame(self):
        self.assertEqual(af.frame(af.CMD_REQUEST_BLOCKS), bytes([0x55, 0xAA, 0x11, 0x00, 0x21, 0x31]))

    def test_parse_finds_frames_among_junk_and_keeps_a_partial_one(self):
        good = af.frame(af.CMD_RETURN_OK)
        part = block(1, 2, 3, 4)[:7]
        frames, left = af.parse(b"\x00\xff" + good + part)
        self.assertEqual(frames, [(af.CMD_RETURN_OK, b"")])
        self.assertEqual(left, part)

    def test_parse_skips_a_bad_sum(self):
        bad = bytearray(af.frame(af.CMD_RETURN_OK))
        bad[-1] ^= 0xFF
        frames, _ = af.parse(bytes(bad) + af.frame(af.CMD_RETURN_OK))
        self.assertEqual(frames, [(af.CMD_RETURN_OK, b"")])

    def test_block_numbers_are_low_byte_first(self):
        b = af.block_from((300).to_bytes(2, "little") + (20).to_bytes(2, "little") + (64).to_bytes(2, "little")
                          + (70).to_bytes(2, "little") + (2).to_bytes(2, "little"))
        self.assertEqual(b, {"x": 300, "y": 20, "w": 64, "h": 70, "id": 2})


class Talking(unittest.TestCase):
    def test_knock_answered(self):
        t = FakeTransport([af.frame(af.CMD_RETURN_OK)])
        self.assertTrue(af.Husky(t).knock())
        self.assertEqual(t.sent[0], af.frame(af.CMD_KNOCK))

    def test_knock_unanswered_is_false_not_a_crash(self):
        self.assertFalse(af.Husky(FakeTransport(), wait=0.05).knock())

    def test_algorithm_sends_the_number_in_two_bytes(self):
        t = FakeTransport([af.frame(af.CMD_RETURN_OK)])
        self.assertTrue(af.Husky(t).algorithm(af.FACE_RECOGNITION))
        self.assertEqual(t.sent[0], af.frame(af.CMD_ALGORITHM, bytes([0, 0])))

    def test_two_faces_come_back_as_two_blocks(self):
        t = FakeTransport([info(2) + block(100, 90, 60, 60, 1) + block(250, 100, 40, 44, 0)])
        got = af.Husky(t).blocks()
        self.assertEqual([b["x"] for b in got], [100, 250])
        self.assertEqual(got[0]["id"], 1)

    def test_no_faces_is_an_empty_list(self):
        self.assertEqual(af.Husky(FakeTransport([info(0)])).blocks(), [])

    def test_a_silent_husky_is_none(self):
        self.assertIsNone(af.Husky(FakeTransport(), wait=0.05).blocks())

    def test_an_io_error_is_none_not_a_crash(self):
        class Broken:
            def write(self, d): raise OSError(121, "Remote I/O error")
            def read(self, n): raise OSError(121, "Remote I/O error")
        self.assertIsNone(af.Husky(Broken(), wait=0.05).blocks())


class Aiming(unittest.TestCase):
    def test_biggest_face_wins_and_tiny_ones_are_ignored(self):
        faces = [{"x": 10, "y": 10, "w": 15, "h": 15, "id": 0},
                 {"x": 100, "y": 90, "w": 50, "h": 50, "id": 0},
                 {"x": 250, "y": 90, "w": 80, "h": 80, "id": 1}]
        self.assertEqual(af.biggest(faces)["x"], 250)
        self.assertIsNone(af.biggest([faces[0]]))
        self.assertIsNone(af.biggest([]))

    def test_centered_face_does_not_move_her(self):
        self.assertEqual(af.nudge(5.0, 160), 5.0)
        self.assertEqual(af.nudge(5.0, 160 + af.DEADBAND), 5.0)

    def test_face_on_the_right_turns_her_right_and_on_the_left_turns_her_left(self):
        self.assertGreater(af.nudge(0.0, 300), 0.0)
        self.assertLess(af.nudge(0.0, 20), 0.0)

    def test_one_look_never_moves_more_than_a_step(self):
        self.assertLessEqual(abs(af.nudge(0.0, 320)), af.STEP)
        self.assertLessEqual(abs(af.nudge(0.0, 0)), af.STEP)

    def test_a_small_error_moves_less_than_a_step(self):
        move = af.nudge(0.0, 160 + af.DEADBAND + 5)
        self.assertTrue(0 < move < af.STEP)

    def test_she_never_turns_past_the_limit(self):
        offset = 0.0
        for _ in range(500):
            offset = af.nudge(offset, 319)
        self.assertEqual(offset, af.LIMIT)
        for _ in range(500):
            offset = af.nudge(offset, 0)
        self.assertEqual(offset, -af.LIMIT)

    def test_the_neck_chases_the_pan_no_faster_than_a_step_and_ends_equal(self):
        neck, pan = 0.0, 40.0
        for _ in range(20):
            before = neck
            neck = af.ease(neck, pan, af.STEP)
            self.assertLessEqual(abs(neck - before), af.STEP)
        for _ in range(100):
            neck = af.ease(neck, pan, af.STEP)
        self.assertEqual(neck, pan)

    def test_pan_and_neck_end_on_the_same_offset_after_a_long_follow(self):
        pan = neck = 0.0
        for _ in range(200):
            pan = af.nudge(pan, 280)
            neck = af.ease(neck, pan, af.STEP)
        self.assertEqual(neck, pan)

    def test_servo_angle_flip_and_clamp(self):
        self.assertEqual(af.servo_angle(90, 20, False), 110)
        self.assertEqual(af.servo_angle(90, 20, True), 70)
        self.assertEqual(af.servo_angle(170, 60, False), 180)
        self.assertEqual(af.servo_angle(10, 60, True), 0)
        self.assertEqual(af.servo_angle(10, 60, False), 70)
        self.assertEqual(af.servo_angle(5, -60, False), 0)


if __name__ == "__main__":
    unittest.main()
