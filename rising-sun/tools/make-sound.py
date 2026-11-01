#!/usr/bin/env python3
"""make-sound: turns a sound or a piece of music into the file the box plays. 2026-11-01, for Dr. O.

Usage: python3 make-sound.py input.mp3 output.ulaw            (a track, played once; its loudness is levelled like the others)
       python3 make-sound.py input.mp3 output.ulaw --loop 1.5  (a short sound that repeats: its end is faded into its start, so there is no jump)

The box plays raw sound at 16,000 samples a second, mono. To keep a six minute track small this stores each sample in 8 bits (mu-law, the way telephones do),
which the box turns back into 16 bit sound. A six minute track comes to about 5.8 MB. Needs ffmpeg.
"""
import array, math, subprocess, sys, os

def pcm(src):
    """The whole input as 16,000 a second, mono, 16 bit samples."""
    raw = subprocess.check_output(["ffmpeg", "-v", "error", "-i", src, "-ac", "1", "-ar", "16000", "-f", "s16le", "-"])
    a = array.array("h"); a.frombytes(raw)
    return a

def level(a, target=0.09, ceiling=0.9, max_gain=20.0, min_gain=0.3):
    """Bring the average loudness to about 9 percent of full scale, so every sound is about as loud as the others, and round off any peak that would go past 90 percent with a soft limiter (so a crackle or a clap does not distort)."""
    n = len(a)
    rms = (sum(v * v for v in a[::5]) / (n / 5)) ** 0.5 or 1.0
    g = max(min_gain, min(max_gain, target * 32767.0 / rms))
    out = array.array("h", (int(ceiling * 32767.0 * math.tanh(g * v / (ceiling * 32767.0))) for v in a))
    return out

def seamless(a, secs):
    """Cut the first secs off, and replace the last secs with the end fading out while the cut-off start fades in, so the end flows into the start."""
    n, L = len(a), int(16000 * secs)
    mix = array.array("h", (int(a[n - L + i] * (1 - i / L) + a[i] * (i / L)) for i in range(L)))
    return array.array("h", a[L:n - L]) + mix

def main():
    args = [x for x in sys.argv[1:]]
    loop = None
    if "--loop" in args:
        i = args.index("--loop"); loop = float(args[i + 1]); del args[i:i + 2]
    if len(args) < 2:
        print(__doc__); sys.exit(1)
    src, dst = args[0], args[1]
    if True:
        a = level(pcm(src))
        if loop is not None:
            a = seamless(a, loop)
        p = subprocess.Popen(["ffmpeg", "-v", "error", "-y", "-f", "s16le", "-ar", "16000", "-ac", "1", "-i", "-", "-f", "mulaw", "-acodec", "pcm_mulaw", dst], stdin=subprocess.PIPE)
        p.communicate(a.tobytes())
        if p.returncode: sys.exit(p.returncode)
    size = os.path.getsize(dst)
    print("%s: %.1f seconds, %.2f MB" % (dst, size / 16000.0, size / 1048576.0))

if __name__ == "__main__":
    main()
