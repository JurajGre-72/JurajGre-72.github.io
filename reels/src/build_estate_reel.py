#!/usr/bin/env python3
"""Build a property reel: client footage -> cut + Ken Burns -> branded overlay -> score.

Stage 1  ffmpeg cuts each segment from the source clips, fills 1080x1920 and applies
         a slow push-in/out, then concatenates them into a silent base track.
Stage 2  Chromium renders the overlay (captions, chips, price rows, branding) as a
         transparent PNG sequence, piped straight into ffmpeg and composited.
Stage 3  Sea ambience lifted from the footage is mixed under a synthesised pad.

The base cut is language independent, so extra languages only re-render stage 2.
"""
import argparse, functools, http.server, json, pathlib, shutil, socket, subprocess, sys, threading, time

ROOT   = pathlib.Path(__file__).resolve().parent.parent
CHROME = "/opt/pw-browsers/chromium-1194/chrome-linux/chrome"


def run(cmd):
    r = subprocess.run(cmd, capture_output=True, text=True)
    if r.returncode != 0:
        raise SystemExit(f"command failed: {' '.join(str(c) for c in cmd[:6])}…\n{r.stderr[-1500:]}")
    return r


def serve(root):
    h = functools.partial(http.server.SimpleHTTPRequestHandler, directory=str(root))
    h.log_message = lambda *a, **k: None
    s = socket.socket(); s.bind(("127.0.0.1", 0)); port = s.getsockname()[1]; s.close()
    httpd = http.server.ThreadingHTTPServer(("127.0.0.1", port), h)
    threading.Thread(target=httpd.serve_forever, daemon=True).start()
    return httpd, port


def build_base(edit, pdir, work, fps, W, H):
    """Cut, fill-crop and Ken Burns each segment, then concatenate."""
    parts = []
    for i, seg in enumerate(edit["segments"]):
        src = pdir / "footage" / f"{seg['src']}.mp4"
        if not src.exists():
            raise SystemExit(f"missing footage: {src}")
        z0, z1 = seg.get("zoom", [1.0, 1.0])
        n = max(int(round(seg["dur"] * fps)) - 1, 1)
        out = work / f"seg{i:02d}.mp4"
        kb = (f"zoompan=z='{z0}+({z1}-{z0})*on/{n}':"
              f"x='iw/2-(iw/zoom/2)':y='ih/2-(ih/zoom/2)':d=1:fps={fps}")

        if seg.get("crop"):
            # Source is 16:9 CGI letterboxed inside a vertical frame. Filling the
            # frame with it would crop away most of the image, so instead show the
            # strip sharp over a blurred, darkened copy of itself.
            cw, ch = (int(x) for x in seg["crop"].split(":")[:2])
            fgh = int(round(W * ch / cw / 2)) * 2
            y   = (H - fgh) // 2 - 190                 # sits above the caption block
            vf = (f"fps={fps},crop={seg['crop']},split=2[a][b];"
                  f"[b]scale={W}:{H}:force_original_aspect_ratio=increase,crop={W}:{H},"
                  f"boxblur=30:2,eq=brightness=-0.14:saturation=0.72[bg];"
                  f"[a]scale={W*2}:-2:flags=lanczos,{kb}:s={W}x{fgh},setsar=1[fg];"
                  f"[bg][fg]overlay=0:{y}:format=auto,setsar=1")
            args = ["-filter_complex", vf]
        else:
            # supersample before zoompan, otherwise the push-in visibly steps
            vf = (f"fps={fps},scale=-2:{H}:flags=lanczos,crop={W}:{H},"
                  f"scale={W*2}:{H*2}:flags=lanczos,{kb}:s={W}x{H},setsar=1")
            args = ["-vf", vf]

        run(["ffmpeg", "-y", "-v", "error", "-ss", str(seg["in"]), "-t", str(seg["dur"]),
             "-i", str(src), "-an", *args,
             "-c:v", "libx264", "-crf", "16", "-preset", "veryfast", "-pix_fmt", "yuv420p", str(out)])
        parts.append(out)
        print(f"    seg {i+1}/{len(edit['segments'])}  {seg['src']} @{seg['in']}s +{seg['dur']}s")

    lst = work / "concat.txt"
    lst.write_text("".join(f"file '{p.name}'\n" for p in parts))
    base = work / "base.mp4"
    run(["ffmpeg", "-y", "-v", "error", "-f", "concat", "-safe", "0", "-i", str(lst),
         "-c", "copy", str(base)])
    return base


def build_audio(edit, pdir, work, dur):
    """Sea ambience from the client footage, under a synthesised pad."""
    amb_src = pdir / "footage" / "shore.mp4"
    amb = work / "amb.wav"
    # the wave section of the shore clip; loop it to cover the reel
    run(["ffmpeg", "-y", "-v", "error", "-stream_loop", "6", "-ss", "13.5", "-t", "8.5",
         "-i", str(amb_src), "-vn",
         "-af", f"highpass=f=110,lowpass=f=7200,afade=t=in:d=1.2,"
                f"atrim=0:{dur},afade=t=out:st={dur-2.2}:d=2.2,loudnorm=I=-26:TP=-3",
         "-ar", "44100", "-ac", "2", str(amb)])

    pad = work / "pad.wav"
    run([sys.executable, "-I", str(ROOT / "src" / "music_estate.py"),
         "--duration", str(dur), "--out", str(pad)])

    mixed = work / "mix.wav"
    run(["ffmpeg", "-y", "-v", "error", "-i", str(amb), "-i", str(pad),
         "-filter_complex", "[0:a]volume=0.62[a];[1:a]volume=1.0[b];[a][b]amix=inputs=2:duration=longest:normalize=0,"
                            "alimiter=limit=0.95,loudnorm=I=-15:TP=-1.5",
         "-ar", "44100", "-ac", "2", str(mixed)])
    return mixed


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--project", default="marvel-resort")
    ap.add_argument("--lang", default="cs")
    ap.add_argument("--out", default=None)
    ap.add_argument("--no-audio", action="store_true")
    ap.add_argument("--keep-base", action="store_true", help="reuse an existing base cut")
    ap.add_argument("--preview", default=None, help="comma-separated times (s): stills only")
    args = ap.parse_args()

    pdir = ROOT / "projects" / args.project
    edit = json.loads((pdir / "edit.json").read_text())
    fps, W, H = edit["fps"], edit["width"], edit["height"]
    dur = sum(s["dur"] for s in edit["segments"])
    work = ROOT / "out" / f"_work-{args.project}"; work.mkdir(parents=True, exist_ok=True)

    httpd, port = serve(ROOT)
    from playwright.sync_api import sync_playwright, Error as PWError

    base = work / "base.mp4"
    if not (args.keep_base and base.exists()):
        print(f"  [1/3] base cut — {len(edit['segments'])} segments, {dur:.1f}s")
        base = build_base(edit, pdir, work, fps, W, H)
    else:
        print("  [1/3] base cut — reusing existing")

    print(f"  [2/3] overlay — {args.lang}")
    with sync_playwright() as pw:
        br = pw.chromium.launch(executable_path=CHROME,
                                args=["--enable-unsafe-swiftshader", "--hide-scrollbars",
                                      "--force-color-profile=srgb"])
        page = br.new_page(viewport={"width": W, "height": H}, device_scale_factor=1)
        errs = []
        page.on("pageerror", lambda e: errs.append(str(e)))
        page.goto(f"http://127.0.0.1:{port}/src/estate_overlay.html"
                  f"?project={args.project}&lang={args.lang}", wait_until="load")
        try:
            page.wait_for_function("window.__ready === true", timeout=60_000)
        except PWError:
            raise SystemExit(f"overlay failed: {page.evaluate('window.__error') or errs}")

        clip = {"x": 0, "y": 0, "width": W, "height": H}

        if args.preview:
            od = ROOT / "out" / "preview"; od.mkdir(parents=True, exist_ok=True)
            for ts in [float(x) for x in args.preview.split(",")]:
                page.evaluate(f"window.renderFrame({ts})")
                # composite one still over the matching base frame so staging is judged in context
                frame = work / "pf.png"
                run(["ffmpeg", "-y", "-v", "error", "-ss", str(ts), "-i", str(base),
                     "-frames:v", "1", str(frame)])
                ov = work / "po.png"
                page.screenshot(path=str(ov), clip=clip, omit_background=True)
                run(["ffmpeg", "-y", "-v", "error", "-i", str(frame), "-i", str(ov),
                     "-filter_complex", "[0][1]overlay=0:0", str(od / f"e{ts:05.1f}.png")])
                print(f"    preview t={ts:>5.1f}s")
            br.close(); httpd.shutdown(); return

        out = pathlib.Path(args.out) if args.out else ROOT / "out" / f"{args.project}-{args.lang}.mp4"
        out.parent.mkdir(parents=True, exist_ok=True)
        silent = work / f"silent-{args.lang}.mp4"
        total = int(round(dur * fps))

        ff = subprocess.Popen([
            "ffmpeg", "-y", "-v", "error",
            "-i", str(base),
            "-f", "image2pipe", "-framerate", str(fps), "-i", "-",
            "-filter_complex", "[0:v][1:v]overlay=0:0:format=auto,format=yuv420p",
            "-c:v", "libx264", "-preset", "slow", "-crf", "19",
            "-profile:v", "high", "-level", "4.2", "-movflags", "+faststart",
            "-r", str(fps), "-frames:v", str(total), str(silent)], stdin=subprocess.PIPE)

        t0 = time.time()
        for i in range(total):
            page.evaluate("window.renderFrame(%r)" % (i / fps))
            ff.stdin.write(page.screenshot(type="png", clip=clip, omit_background=True))
            if i % 120 == 0 and i:
                el = time.time() - t0
                print(f"    {i}/{total}  {el:5.1f}s elapsed, ~{el/i*(total-i):5.1f}s left", flush=True)
        ff.stdin.close()
        if ff.wait() != 0:
            raise SystemExit("overlay composite failed")
        br.close(); httpd.shutdown()
        print(f"    composited in {time.time()-t0:.1f}s")

    if args.no_audio:
        shutil.copy(silent, out)
    else:
        print("  [3/3] audio — sea ambience + pad")
        mixed = build_audio(edit, pdir, work, dur)
        run(["ffmpeg", "-y", "-v", "error", "-i", str(silent), "-i", str(mixed),
             "-c:v", "copy", "-c:a", "aac", "-b:a", "192k", "-ac", "2", "-shortest",
             "-movflags", "+faststart", str(out)])
    print(f"✓ {out}  ({out.stat().st_size/1e6:.1f} MB)")


if __name__ == "__main__":
    main()
