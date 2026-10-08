"""al_bands: tells a voice from a steady hum by WHERE in the sound the energy is, added 2026-10-07, Dr. O.

Robot Alice heard her only about 15% of the time with a room that had a steady hum. Her ears judged "is someone speaking" by
loudness against the room, and a hum that is loud takes most of the headroom. A hum lives in a few bands (often the low notes, about 100 to
500 Hz). A voice spreads over several. So this watches six bands separately, learns how loud each is when nobody is talking,
and calls a tenth of a second "speechy" when at least two bands are well above their OWN normal. A steady hum never raises
any band above its own normal, however loud it is or wherever it sits. (First version counted only the upper bands; the real
meter run in Dr. O's room showed her voice stands out in the LOW bands there, so every band counts now.)

Tried and rejected first: the speech detector used in web calls (webrtcvad). On a test with a steady hum it called the hum
"speech" in every frame at every strictness setting, because a hum has the same repeating pattern as a voice.

Pure Python, no extra packages: a second order band pass filter per band, with its state carried from one chunk to the next.
"""
import math

CENTERS = (150, 300, 600, 1200, 2400, 4000)     # Hz, about an octave apart
UPPER = 0                                        # bands from this index up are the ones that count. Was 2 (600 Hz and up), on the guess that a hum sits low and a voice reaches high. Dr. O's own meter run in her room showed the opposite: her voice stood out +11 and +10 dB in the 150 and 300 Hz bands and only +1 to +4 above. Each band is compared with its OWN normal, so a steady hum raises nothing wherever it sits, and any band can count.
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
    """True when enough bands are well above their own normal."""
    return sum(1 for i in range(UPPER, len(CENTERS)) if db[i] - floor_db[i] >= EXCESS_DB and db[i] >= MIN_DB) >= NEEDED
