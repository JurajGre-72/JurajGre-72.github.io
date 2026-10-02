#!/usr/bin/env python3
"""Synthesise the lullaby score for a story reel. Deterministic, numpy + stdlib wave only.

The arrangement follows the story beats: sparse music box -> a falling figure ->
a hollow sad passage -> fireflies shimmering in -> a warm rising climax -> resolve.
"""
import argparse, wave
import numpy as np

SR = 44100

def midi(m):            # midi note -> Hz
    return 440.0 * 2.0 ** ((m - 69) / 12.0)

class Mix:
    def __init__(self, dur):
        self.n = int(dur * SR)
        self.buf = np.zeros(self.n, dtype=np.float64)

    def _slice(self, t0, length):
        a = int(t0 * SR)
        if a >= self.n: return None, None
        b = min(a + length, self.n)
        return a, b

    def box(self, m, t0, dur, amp=0.5):
        """Music box / celesta: bright inharmonic partials, fast decay."""
        a, b = self._slice(t0, int(dur * SR))
        if a is None: return
        t = np.arange(b - a) / SR
        f = midi(m)
        env = np.exp(-t * 3.2) * (1 - np.exp(-t * 320))
        sig = np.zeros_like(t)
        for h, ha in ((1, 1.0), (2, 0.42), (3, 0.20), (4.19, 0.11), (5.43, 0.05)):
            sig += ha * np.sin(2 * np.pi * f * h * t)
        self.buf[a:b] += sig * env * amp

    def pad(self, ms, t0, dur, amp=0.18):
        """Warm detuned pad, slow swell."""
        a, b = self._slice(t0, int(dur * SR))
        if a is None: return
        t = np.arange(b - a) / SR
        env = np.minimum(t / max(dur * 0.42, 1e-6), 1.0) * np.minimum((dur - t) / max(dur * 0.45, 1e-6), 1.0)
        env = np.clip(env, 0, 1) ** 1.4
        sig = np.zeros_like(t)
        for m in ms:
            f = midi(m)
            for d in (-0.14, 0.0, 0.15):
                sig += np.sin(2 * np.pi * (f + d) * t + d)
            sig += 0.30 * np.sin(2 * np.pi * f * 2 * t)
        self.buf[a:b] += sig / (len(ms) * 3.3) * env * amp

    def bass(self, m, t0, dur, amp=0.30):
        a, b = self._slice(t0, int(dur * SR))
        if a is None: return
        t = np.arange(b - a) / SR
        f = midi(m)
        env = np.minimum(t / 0.09, 1.0) * np.exp(-t * 0.95)
        self.buf[a:b] += (np.sin(2*np.pi*f*t) + 0.22*np.sin(2*np.pi*f*2*t)) * env * amp

    def noise_swell(self, t0, dur, amp=0.10, seed=7):
        """Airy whoosh for the fall — lowpassed noise with a swell envelope."""
        a, b = self._slice(t0, int(dur * SR))
        if a is None: return
        rng = np.random.default_rng(seed)
        x = rng.standard_normal(b - a)
        k = np.ones(220) / 220.0                       # cheap lowpass
        x = np.convolve(x, k, mode='same')
        t = np.arange(b - a) / SR
        env = np.sin(np.pi * np.clip(t / dur, 0, 1)) ** 1.8
        self.buf[a:b] += x * env * amp

    def shimmer(self, t0, dur, notes, amp=0.16, seed=3):
        rng = np.random.default_rng(seed)
        for _ in range(int(dur * 7)):
            self.box(int(rng.choice(notes)), t0 + rng.random() * dur,
                     1.8, amp * (0.45 + rng.random() * 0.55))


def build(dur):
    mx = Mix(dur)
    D, A, Bm, G = [50, 62, 66, 69], [45, 57, 64, 69], [47, 59, 66, 71], [43, 55, 62, 67]

    # ---- 0-12  the sleeping woods: sparse music box over a soft pad ----
    for i, (ch, root) in enumerate([(D, 38), (A, 33), (Bm, 35), (G, 31)]):
        mx.pad(ch[1:], i * 3.0, 3.3, amp=0.17)
        mx.bass(root, i * 3.0, 2.9, amp=0.26)
    for t, m in [(0.0, 74), (0.75, 71), (1.5, 69), (2.4, 66), (3.0, 69), (3.9, 71),
                 (4.5, 69), (5.4, 64), (6.0, 66), (6.75, 69), (7.5, 71), (8.4, 74),
                 (9.0, 71), (9.9, 69), (10.5, 66), (11.25, 64)]:
        mx.box(m, t, 2.6, amp=0.42)

    # ---- 12-17  the fall: descending figure + whoosh ----
    mx.noise_swell(11.6, 5.4, amp=0.085)
    mx.pad([62, 66, 69], 12.0, 5.2, amp=0.15)
    fall = [74, 71, 69, 66, 64, 62, 59, 57, 54]
    for i, m in enumerate(fall):
        mx.box(m, 12.0 + i * 0.52, 2.2, amp=0.40 - i * 0.022)
    mx.bass(38, 12.0, 4.0, amp=0.24)

    # ---- 17-29.5  alone in the clearing: hollow, minor, thinning out ----
    mx.bass(35, 17.0, 5.0, amp=0.22); mx.pad([59, 62, 66], 17.0, 6.2, amp=0.14)
    mx.bass(33, 23.0, 5.0, amp=0.20); mx.pad([57, 61, 64], 23.0, 6.4, amp=0.12)
    for t, m in [(17.4, 62), (18.6, 59), (20.2, 57), (22.0, 59),
                 (23.6, 57), (25.4, 54), (27.2, 57), (28.4, 54)]:
        mx.box(m, t, 2.8, amp=0.26)

    # ---- 29.5-36  the forest notices: pad swells, little lights arrive ----
    mx.pad([59, 62, 66, 71], 29.5, 6.8, amp=0.19)
    mx.bass(35, 29.5, 6.4, amp=0.24)
    mx.shimmer(30.0, 5.8, [78, 81, 83, 86, 88], amp=0.11)
    for t, m in [(30.2, 66), (31.4, 69), (32.6, 71), (33.8, 74), (35.0, 76)]:
        mx.box(m, t, 2.8, amp=0.34)

    # ---- 36-42  carried home: full, rising ----
    for i, (ch, root) in enumerate([(G, 31), (D, 38), (A, 33)]):
        mx.pad(ch[1:], 36.0 + i * 2.0, 2.4, amp=0.24)
        mx.bass(root, 36.0 + i * 2.0, 2.2, amp=0.30)
    for t, m in [(36.0, 74), (36.6, 78), (37.2, 81), (38.0, 83), (38.7, 81),
                 (39.3, 78), (39.9, 81), (40.6, 86), (41.3, 83)]:
        mx.box(m, t, 3.0, amp=0.46)
    mx.shimmer(36.4, 5.2, [81, 83, 86, 88, 90], amp=0.14)

    # ---- 42-45  good night ----
    mx.pad([62, 66, 69, 74], 42.0, 3.4, amp=0.22)
    mx.bass(38, 42.0, 3.0, amp=0.26)
    for t, m in [(42.0, 78), (42.9, 74), (43.8, 69)]:
        mx.box(m, t, 3.2, amp=0.36)
    return mx.buf


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--duration", type=float, default=45.0)
    ap.add_argument("--out", required=True)
    a = ap.parse_args()

    x = build(a.duration)
    # soft-knee limit, then a short fade at each end
    x = np.tanh(x * 1.25) / np.tanh(1.25)
    peak = np.max(np.abs(x)) or 1.0
    x = x / peak * 0.82
    f_in, f_out = int(0.35 * SR), int(1.6 * SR)
    x[:f_in]  *= np.linspace(0, 1, f_in)
    x[-f_out:] *= np.linspace(1, 0, f_out)

    stereo = np.stack([x, x], axis=1)                 # gentle width on the pad range
    stereo[:, 0] *= 0.99; stereo[:, 1] *= 1.01
    pcm = np.clip(stereo, -1, 1)
    pcm = (pcm * 32767).astype("<i2")
    with wave.open(a.out, "wb") as w:
        w.setnchannels(2); w.setsampwidth(2); w.setframerate(SR)
        w.writeframes(pcm.tobytes())
    print(f"  score: {a.out} ({a.duration:.1f}s)")


if __name__ == "__main__":
    main()
