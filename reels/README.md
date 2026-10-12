# Reelwright — reel pipelines

Two renderers share this directory.

1. **Story reels** — a generated 3D scene (below).
2. **Property reels** — a client's own footage and photos, cut and branded
   (`src/build_estate_reel.py`, see `projects/*/README.md`).

---

## 1. 3D story reels

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

---

## 2. Property reels

```bash
python3 -I src/build_estate_reel.py --project <id> --lang en
python3 -I src/build_estate_reel.py --project <id> --lang sk --keep-base
python3 -I src/build_estate_reel.py --project <id> --preview 1.6,14,28.5
```

`projects/<id>/edit.json` is the whole edit — segment sources, in-points,
durations, Ken Burns range, and the copy per language. `--keep-base` reuses the
cut, so each extra language only re-renders the overlay.

### Starting a new project

1. `mkdir -p projects/<id>/footage` and drop the clips and stills in.
2. Write `projects/<id>/edit.json`: one entry per segment with `src` (the filename
   without extension), `dur`, `zoom`, and a copy block per language.
3. Preview, adjust in-points, then render.

### Segment sources

A segment's `src` may be a video (`.mp4 .mov .m4v .webm .mkv`) or a still
(`.jpg .jpeg .png .webp .avif`); the builder resolves whichever is present.
Videos take an `in` time, stills are held for `dur`.

`fit` controls how a source meets the 9:16 frame, and is chosen automatically
from its aspect unless set:

- **`fill`** — crop to fill. Picked for vertical sources.
- **`strip`** — the image sharp at full width over a blurred, darkened copy of
  itself. Picked for landscape sources, where filling would crop most of the
  picture away. This is what makes 16:9 renders and photos usable in a vertical
  reel without butchering them.

`crop` (`w:h:x:y`) runs first, to strip letterboxing that is baked into a source.
Find it with `ffmpeg -ss T -i clip.mp4 -vf cropdetect -f null -`.

### Copy

Every string lives in `edit.json` under a language key. A segment can carry
`kicker`, `headline`, `sub`, `note`, `chips` (pill row), `rows` (two-column
table, for sizes or prices) and `cta`. Adding a language is a new key plus
`--lang`; no code changes.

---

## 3. Publishing to Instagram

```bash
export IG_USER_ID=...          # Instagram Business account id, not the @handle
export IG_ACCESS_TOKEN=...     # long-lived token with instagram_content_publish

# validate the file and the token without posting
python3 -I src/publish_instagram.py out/<reel>.mp4 --check \
    --caption-file projects/<id>/caption-short.txt

# publish
python3 -I src/publish_instagram.py out/<reel>.mp4 \
    --video-url https://<public-host>/<reel>.mp4 \
    --cover-url https://<public-host>/cover.jpg \
    --caption-file projects/<id>/caption-short.txt
```

### What this needs before it can work

1. **An Instagram Business or Creator account** linked to a Facebook Page. A
   personal account cannot publish through the API at all.
2. **A Meta app** with the `instagram_content_publish` and
   `instagram_basic` permissions, and a long-lived access token. Short-lived
   tokens expire in an hour; long-lived ones last 60 days and must be refreshed.
3. **The mp4 reachable at a public HTTPS URL.** This is the part people are
   surprised by: the Content Publishing API does not accept file uploads for
   Reels. Instagram fetches the video itself, so it has to be hosted somewhere
   public first — an S3/R2 bucket, or this GitHub Pages site if you are willing
   for the file to be publicly downloadable.
4. **Network access to `graph.facebook.com`.** Cloud sessions deny it by
   default; see the environment's Network access setting.

Credentials are read from the environment only. Never commit a token — it grants
posting rights to the account for as long as it is valid.

### Limits worth knowing

- 50 published posts per rolling 24 hours, per account. `--check` prints current usage.
- Caption maximum 2200 characters; `--check` verifies this before posting.
- A container that stays `IN_PROGRESS` is Instagram still transcoding; the script
  polls for up to 10 minutes, which is generous for a 45-second reel.
