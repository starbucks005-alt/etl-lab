#!/usr/bin/env python3
"""Tries Azure speech to text by itself, without the panel (written 2026-11-24, because the panel hears nothing and the log cannot say why).

Run on the Pi with the panel stopped (the microphone can be used by one program at a time):
    sudo systemctl stop al-panel.service; python3 ~/al_panel/stt_test.py; sudo systemctl start al-panel.service
When it says SPEAK NOW, say one sentence, such as "Guardian, can you hear me?". It records 5 seconds, sends them to Azure, and prints Azure's
answer (the status and the words). The key is never printed. It tries the endpoint address and, if azure_speech.json has one, the region address too.
"""
import array
import json
import os
import subprocess
import sys
import wave

import requests

HERE = os.path.dirname(os.path.abspath(__file__))
DEVICE = os.environ.get("AL_MIC_DEVICE", "plughw:wm8960soundcard")
RAW = "/tmp/stt_test_raw.wav"
MONO = "/tmp/stt_test_mono.wav"


def main():
    try:
        cfg = json.load(open(os.path.join(HERE, "azure_speech.json")))
    except (OSError, ValueError):
        sys.exit("There is no azure_speech.json here.")
    key = str(cfg.get("key", "")).strip()
    urls = []
    if cfg.get("endpoint"):
        urls.append(("endpoint", str(cfg["endpoint"]).rstrip("/") + "/stt/speech/recognition/conversation/cognitiveservices/v1"))
    if cfg.get("region"):
        urls.append(("region", "https://%s.stt.speech.microsoft.com/speech/recognition/conversation/cognitiveservices/v1" % cfg["region"]))
    if not key or not urls:
        sys.exit("azure_speech.json has no key, or no endpoint or region.")
    print("Get ready. Recording starts in 2 seconds.", flush=True)
    subprocess.run(["sleep", "2"])
    print(">>> SPEAK NOW: say one sentence <<<", flush=True)
    subprocess.run(["arecord", "-q", "-D", DEVICE, "-f", "S16_LE", "-r", "16000", "-c", "2", "-d", "5", RAW], check=True)
    with wave.open(RAW, "rb") as w:
        ch, rate, frames = w.getnchannels(), w.getframerate(), w.readframes(w.getnframes())
    pcm = array.array("h")
    pcm.frombytes(frames)
    mono = array.array("h", (sum(pcm[i:i + ch]) // ch for i in range(0, len(pcm) - ch + 1, ch))) if ch > 1 else pcm
    print("Recorded %.1f seconds, loudest %d." % (len(mono) / float(rate), max(abs(x) for x in mono) if mono else 0), flush=True)
    with wave.open(MONO, "wb") as o:
        o.setnchannels(1)
        o.setsampwidth(2)
        o.setframerate(rate)
        o.writeframes(mono.tobytes())
    for label, url in urls:
        try:
            with open(MONO, "rb") as f:
                r = requests.post(url, params={"language": "en-US", "format": "simple"},
                                  headers={"Ocp-Apim-Subscription-Key": key, "Content-Type": "audio/wav; codecs=audio/pcm; samplerate=%d" % rate,
                                           "Accept": "application/json"}, data=f, timeout=30)
            print("[%s address] HTTP %s  %s" % (label, r.status_code, r.text[:300].replace(key, "***")), flush=True)
        except Exception as e:
            print("[%s address] failed: %s" % (label, str(e)[:200].replace(key, "***")), flush=True)


if __name__ == "__main__":
    main()
