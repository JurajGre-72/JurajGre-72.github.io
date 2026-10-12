# Marvel Resort — property reel

Vertical 1080×1920 reel for CoralCoves Estates, built from client footage by
`src/build_estate_reel.py`.

## Render

```bash
python3 -I src/build_estate_reel.py --lang cs      # Czech
python3 -I src/build_estate_reel.py --lang en --keep-base
python3 -I src/build_estate_reel.py --preview 1.6,14,28.5,39.8
```

`--keep-base` reuses the cut footage, so a second language only re-renders the
overlay — about a quarter of the work.

## Footage (not in git)

`footage/` holds `build.mp4`, `shell.mp4`, `shore.mp4` and is gitignored: this
repository is a public GitHub Pages site and the clips are the developer's.
Restore them before rendering.

| file | content |
|---|---|
| `build.mp4` | construction site, daylight, sea behind |
| `shell.mp4` | concrete shell framing the sea (0–8 s), CGI interiors (10–26 s) |
| `shore.mp4` | dusk buildings and beach (0–10 s), surf (12–22 s), CGI exteriors (24–35 s) |

## Two things to know about the source

**Resolution.** The clips arrived via WhatsApp at 480×784 / 480×800. The reel
renders at 1080×1920, so the footage is upscaled ~2.4× and is visibly soft. The
overlay is drawn at full 1080p, which carries the perceived quality, but original
camera files would improve the result more than any change to this code.

**Letterboxing.** The CGI sections are 16:9 content padded into a vertical frame
(`crop=480:308:0:210` on shore, `480:302:0:216` on shell). Cropping them to fill
vertical would discard most of the image, so segments carrying a `crop` field are
composited as a sharp strip over a blurred, darkened copy of themselves. Re-detect
with `ffmpeg -ss T -i clip.mp4 -vf cropdetect -f null -` if the sources change.

## Copy

All text lives in `edit.json` under each segment, keyed by language (`cs`, `en`).
Adding a language means adding a key and rendering with `--lang`; no code changes.

Prices are reproduced from the developer brief and carry the supplied disclaimer
on the final card.
