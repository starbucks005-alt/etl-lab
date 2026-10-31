#!/usr/bin/env python3
"""make-clip: turns a video into a small silent clip for the lid screen. 2026-10-31, for Dr. O.

Usage: python3 make-clip.py input.mp4 output.clp [frames_per_second]

The clip is 172 by 320 (the screen), without sound, one small JPEG per frame, so the screen board can show it from a microSD card.
File layout: "CLP1", then fps, frame count, width, height (each 2 bytes, little endian), then for each frame its length (4 bytes) and the JPEG.
Needs ffmpeg. Default 10 frames a second. A 10 second clip comes to about 1 MB.
"""
import os, struct, subprocess, sys, tempfile, glob

W, H = 172, 320

def main():
    if len(sys.argv) < 3:
        print(__doc__); sys.exit(1)
    src, dst = sys.argv[1], sys.argv[2]
    fps = int(sys.argv[3]) if len(sys.argv) > 3 else 10
    with tempfile.TemporaryDirectory() as tmp:
        vf = "fps=%d,scale=%d:%d:force_original_aspect_ratio=increase,crop=%d:%d" % (fps, W, H, W, H)
        subprocess.check_call(["ffmpeg", "-v", "error", "-y", "-i", src, "-an", "-vf", vf, "-q:v", "7", os.path.join(tmp, "f%04d.jpg")])
        frames = sorted(glob.glob(os.path.join(tmp, "f*.jpg")))
        if not frames:
            print("No frames were made."); sys.exit(1)
        with open(dst, "wb") as out:
            out.write(b"CLP1" + struct.pack("<HHHH", fps, len(frames), W, H))
            for f in frames:
                data = open(f, "rb").read()
                out.write(struct.pack("<I", len(data)) + data)
    print("%s: %d frames at %d a second, %.0f KB" % (dst, len(frames), fps, os.path.getsize(dst) / 1024))

if __name__ == "__main__":
    main()
