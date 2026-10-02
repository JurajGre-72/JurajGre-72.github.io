# Reelwright — 3D story reels

Renders a vertical 1080×1920 animated short from a JSON story file: a Three.js
scene driven frame-by-frame in headless Chromium, encoded to H.264, scored with a
synthesised lullaby.

Everything renders offline and deterministically — same input, same frames, every
run. No stock footage, no external API, no per-render cost.

## Render

```bash
pip install playwright numpy pillow      # one-time
npm install                              # one-time (vendors three.js)

python3 src/render.py                                  # English  -> out/little-star-en.mp4
python3 src/render.py --lang sk                        # Slovak   -> out/little-star-sk.mp4
python3 src/render.py --scale 0.5 --no-audio           # fast draft
python3 src/render.py --preview 1,14,28,41             # stills at given seconds
```

A full 45 s render is ~1350 frames and takes roughly 20–40 min on this container;
`--scale 0.5` is about 4× faster and is the right way to check staging.

## How it fits together

| File | Role |
|---|---|
| `stories/*.json` | The story: title, duration, fps, and the caption beats with their in/out times. Per-language text lives here. |
| `src/scene.html` | The 3D scene. Exposes `window.renderFrame(t)` — absolute time in, one rendered frame out. |
| `src/render.py` | Serves the scene over HTTP, steps `renderFrame` once per frame, pipes screenshots into ffmpeg, then muxes the score. |
| `src/music.py` | Generates the score with numpy. Arrangement is keyed to the same beat times as the captions. |
| `vendor/` | three.js, its postprocessing addons, and the Baloo 2 / Nunito webfonts (`latin-ext`, so Slovak diacritics render). Committed so renders don't depend on the network. |

### Why frames are driven, not played

`renderFrame(t)` sets every animated value from `t` alone and never reads a clock,
so a slow frame can't drift the animation. All randomness (star placement, tree
scatter, firefly paths, grain) comes from one seeded PRNG. Re-rendering a story
after changing nothing produces identical output.

## Writing another story

1. Copy `stories/little-star.json`, change `id`, `title`, `duration`, and the `beats`.
2. Render with `--story <id>`.

Captions, timing and language need nothing but that file. New *visuals* mean
editing `src/scene.html` — the choreography lives in three small places:

- `CAM` — camera keyframes (`t`, position, look-at target, fov), smoothstepped between.
- `starPos(t)` / `brightness(t)` — where the subject is and how hard it glows.
- `ffGather(t)` / `ffAlpha(t)` — when the fireflies travel and how visible they are.

## Known limits

- **No voiceover.** No TTS engine is installed in this container, so the captions
  carry the story (which is how most reels are watched anyway). The pipeline has a
  slot for narration: generate a WAV, mux it in `render.py` alongside the score, and
  drive caption timing from word timestamps instead of the fixed `beats` times.
- **Software WebGL.** Chromium renders through SwiftShader here, which is why a
  full render takes minutes rather than seconds. On a GPU box the same code is
  far faster with no changes.
