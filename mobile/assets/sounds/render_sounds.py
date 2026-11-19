#!/usr/bin/env python3
"""frontend/src/services/sounds.js এর notify ও done সাউন্ড অফলাইনে ফাইলে রেন্ডার করে।
চালানো: python3 render_sounds.py  (numpy লাগবে; ffmpeg থাকলে .ogg-ও বানায়)"""
import os, shutil, subprocess, wave
import numpy as np

SR = 44100
HERE = os.path.dirname(os.path.abspath(__file__))

def note(buf, freq, at, dur, gain):
    n0 = int(round(at * SR))
    n = int(round((dur + 0.03) * SR))
    t = np.arange(n) / SR
    env = np.full(n, 0.0001)
    up = t <= 0.012
    env[up] = 0.0001 * (gain / 0.0001) ** (t[up] / 0.012)
    dn = (t > 0.012) & (t <= dur)
    env[dn] = gain * (0.0001 / gain) ** ((t[dn] - 0.012) / (dur - 0.012))
    env[t > dur] = 0.0001
    sig = np.sin(2 * np.pi * freq * t) * env
    end = min(len(buf), n0 + n)
    buf[n0:end] += sig[: end - n0]

def bell(buf, freq, at, dur, gain):
    note(buf, freq, at, dur, gain)
    note(buf, freq * 2.01, at, dur * 0.6, gain * 0.35)

def render(fn, length):
    buf = np.zeros(int(SR * length))
    fn(buf)
    buf *= 0.8 / np.max(np.abs(buf))
    return buf

def notify(b):
    for i, f in enumerate([523, 659, 784, 1047]):
        bell(b, f, i * 0.085, 0.28, 0.12)

def done(b):
    bell(b, 880, 0, 0.14, 0.12)
    bell(b, 1320, 0.08, 0.26, 0.12)

def save(name, data):
    wav = os.path.join(HERE, name + ".wav")
    with wave.open(wav, "wb") as w:
        w.setnchannels(1); w.setsampwidth(2); w.setframerate(SR)
        w.writeframes((data * 32767).astype("<i2").tobytes())
    if shutil.which("ffmpeg"):
        subprocess.run(["ffmpeg", "-y", "-loglevel", "error", "-i", wav,
                        "-c:a", "libvorbis", "-q:a", "6",
                        os.path.join(HERE, name + ".ogg")], check=True)

# সবচেয়ে লম্বা নোট: 0.255 + 0.28 + 0.03 ≈ 0.57s, তাই 0.7s যথেষ্ট
save("sync_notify", render(notify, 0.7))
save("sync_notice", render(done, 0.5))
