"""al_bands: tells a voice from a steady hum by WHERE in the sound the energy is, added 2026-10-07, Dr. O.

Robot Alice heard her only about 15% of the time with a room that had a steady hum. Her ears judged "is someone speaking" by
loudness against the room, and a hum that is loud takes most of the headroom. A hum lives in the low notes (about 100 to
500 Hz). A voice has plenty of energy up in the middle and high notes (1,000 to 4,000 Hz), where a hum has almost none.
So this watches six bands separately, learns how loud each is when nobody is talking, and calls a tenth of a second
"speechy" when at least two of the upper bands are well above their own normal. A steady hum never raises the upper bands,
however loud it is.

Tried and rejected first: the speech detector used in web calls (webrtcvad). On a test with a steady hum it called the hum
"speech" in every frame at every strictness setting, because a hum has the same repeating pattern as a voice.

Pure Python, no extra packages: a second order band pass filter per band, with its state carried from one chunk to the next.
"""
import math

CENTERS = (150, 300, 600, 1200, 2400, 4000)     # Hz, about an octave apart
UPPER = 2                                        # bands from this index up (600 Hz and above) are the ones that count
EXCESS_DB = 7.0                                  # how far above its own normal a band must be
NEEDED = 2                                       # how many upper bands must be raised at once
MIN_DB = 42.0                                    # and a band must be at least this loud to count (about 125 on the 16 bit scale), so near silence never looks like speech
CUSHION = 1000.0                                 # added to every band's power before turning it into decibels, so a band at almost nothing cannot swing wildly


class Bands:
    def __init__(self, rate=16000, q=1.0):
        self.coef = []
        for f in CENTERS:
            w = 2 * math.pi * f / rate
            alpha = math.sin(w) / (2 * q)
            a0 = 1 + alpha
            self.coef.append((alpha / a0, -alpha / a0, -2 * math.cos(w) / a0, (1 - alpha) / a0))   # b0, b2, a1, a2
        self.state = [[0.0, 0.0, 0.0, 0.0] for _ in CENTERS]                                        # x1, x2, y1, y2

    def levels(self, samples):
        """Mean square of each band over these samples (16 bit units squared)."""
        out = []
        n = max(1, len(samples))
        for (b0, b2, a1, a2), st in zip(self.coef, self.state):
            x1, x2, y1, y2 = st
            acc = 0.0
            for x in samples:
                y = b0 * x + b2 * x2 - a1 * y1 - a2 * y2
                x2, x1, y2, y1 = x1, x, y1, y
                acc += y * y
            st[0], st[1], st[2], st[3] = x1, x2, y1, y2
            out.append(acc / n)
        return out


def to_db(ms):
    return 10.0 * math.log10(ms + CUSHION)


def speechy(db, floor_db):
    """True when enough of the upper bands are well above their own normal."""
    return sum(1 for i in range(UPPER, len(CENTERS)) if db[i] - floor_db[i] >= EXCESS_DB and db[i] >= MIN_DB) >= NEEDED
