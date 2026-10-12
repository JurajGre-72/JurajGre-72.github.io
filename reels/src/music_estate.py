#!/usr/bin/env python3
"""Score for a property reel: warm pad + plucked arpeggio, deterministic.

Chord changes land on the edit's cut points, so the music turns with the picture.
"""
import argparse, wave
import numpy as np

SR = 44100
midi = lambda m: 440.0 * 2.0 ** ((m - 69) / 12.0)

# chord per segment, aligned to the edit's segment boundaries
D  = [50, 62, 66, 69, 74]
A  = [45, 57, 61, 64, 69]
Bm = [47, 59, 62, 66, 71]
G  = [43, 55, 59, 62, 67]
PLAN = [(0.0, D), (4.0, A), (7.8, Bm), (12.0, G), (16.5, D),
        (21.0, A), (26.0, Bm), (31.0, G), (34.0, A), (37.0, D)]


class Mix:
    def __init__(self, dur):
        self.n = int(dur * SR); self.buf = np.zeros(self.n)

    def _win(self, t0, ln):
        a = int(t0 * SR)
        if a >= self.n or ln <= 0: return None, None
        return a, min(a + ln, self.n)

    def pad(self, notes, t0, dur, amp):
        a, b = self._win(t0, int(dur * SR))
        if a is None: return
        t = np.arange(b - a) / SR
        atk, rel = dur * 0.30, dur * 0.42
        env = np.clip(np.minimum(t / atk, (dur - t) / rel), 0, 1) ** 1.3
        sig = np.zeros_like(t)
        for m in notes:
            f = midi(m)
            for d in (-0.13, 0.0, 0.14):
                sig += np.sin(2 * np.pi * (f + d) * t)
            sig += 0.22 * np.sin(2 * np.pi * f * 2 * t)
        self.buf[a:b] += sig / (len(notes) * 3.3) * env * amp

    def pluck(self, m, t0, amp, dur=2.4):
        a, b = self._win(t0, int(dur * SR))
        if a is None: return
        t = np.arange(b - a) / SR
        f = midi(m)
        env = np.exp(-t * 2.6) * (1 - np.exp(-t * 400))
        sig = (np.sin(2*np.pi*f*t) + 0.34*np.sin(2*np.pi*f*2*t)
               + 0.14*np.sin(2*np.pi*f*3*t) + 0.05*np.sin(2*np.pi*f*4.2*t))
        self.buf[a:b] += sig * env * amp

    def sub(self, m, t0, dur, amp):
        a, b = self._win(t0, int(dur * SR))
        if a is None: return
        t = np.arange(b - a) / SR
        f = midi(m)
        env = np.minimum(t / 0.14, 1.0) * np.minimum((dur - t) / 0.6, 1.0)
        self.buf[a:b] += np.sin(2 * np.pi * f * t) * np.clip(env, 0, 1) * amp

    def swell(self, t0, dur, amp, seed=11):
        """Airy riser into the money shot."""
        a, b = self._win(t0, int(dur * SR))
        if a is None: return
        rng = np.random.default_rng(seed)
        x = np.convolve(rng.standard_normal(b - a), np.ones(180) / 180.0, mode='same')
        t = np.arange(b - a) / SR
        self.buf[a:b] += x * (t / dur) ** 2.2 * amp


def build(dur):
    mx = Mix(dur)
    # intensity rises across the reel and peaks on the price/CTA beats
    def energy(t):
        return 0.55 + 0.45 * min(1.0, max(0.0, (t - 2.0) / 30.0))

    for i, (t0, ch) in enumerate(PLAN):
        t1 = PLAN[i + 1][0] if i + 1 < len(PLAN) else dur
        span = t1 - t0
        e = energy(t0)
        mx.pad(ch[1:], t0, span + 0.5, amp=0.21 * e)
        mx.sub(ch[0], t0, span, amp=0.26 * e)

        # arpeggio over the upper voices, eighth notes, thinning on long chords
        tones = ch[1:] + [ch[-1] + 5]
        step, k, j = 0.3125, 0.0, 0
        while k < span - 0.05:
            if j % 8 not in (3, 7):                     # leave air
                mx.pluck(tones[j % len(tones)], t0 + k, amp=0.17 * e)
            k += step; j += 1

    mx.swell(28.0, 3.0, amp=0.055)
    mx.swell(35.0, 2.0, amp=0.045)
    return mx.buf


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--duration", type=float, required=True)
    ap.add_argument("--out", required=True)
    a = ap.parse_args()

    x = build(a.duration)
    x = np.tanh(x * 1.2) / np.tanh(1.2)
    x = x / (np.max(np.abs(x)) or 1.0) * 0.80
    fi, fo = int(0.5 * SR), int(2.0 * SR)
    x[:fi] *= np.linspace(0, 1, fi); x[-fo:] *= np.linspace(1, 0, fo)

    st = np.stack([x * 0.99, x * 1.01], axis=1)
    pcm = (np.clip(st, -1, 1) * 32767).astype("<i2")
    with wave.open(a.out, "wb") as w:
        w.setnchannels(2); w.setsampwidth(2); w.setframerate(SR); w.writeframes(pcm.tobytes())
    print(f"    pad: {a.out} ({a.duration:.1f}s)")


if __name__ == "__main__":
    main()
