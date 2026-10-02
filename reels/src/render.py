#!/usr/bin/env python3
"""Render a 3D story reel: Three.js scene -> deterministic frames -> H.264 vertical MP4.

The scene exposes window.renderFrame(t) and is driven by absolute time, never by
requestAnimationFrame, so every run produces byte-comparable frames.
"""
import argparse, functools, http.server, json, pathlib, socket, subprocess, sys, threading, time

ROOT    = pathlib.Path(__file__).resolve().parent.parent
CHROME  = "/opt/pw-browsers/chromium-1194/chrome-linux/chrome"


def serve(root: pathlib.Path):
    """Background HTTP server so ES modules + fetch() + fonts all resolve."""
    handler = functools.partial(http.server.SimpleHTTPRequestHandler, directory=str(root))
    handler.log_message = lambda *a, **k: None
    sock = socket.socket(); sock.bind(("127.0.0.1", 0)); port = sock.getsockname()[1]; sock.close()
    httpd = http.server.ThreadingHTTPServer(("127.0.0.1", port), handler)
    threading.Thread(target=httpd.serve_forever, daemon=True).start()
    return httpd, port


def open_scene(p, port, story, lang, w, h):
    from playwright.sync_api import Error as PWError
    page = p.new_page(viewport={"width": w, "height": h}, device_scale_factor=1)
    errors = []
    page.on("pageerror", lambda e: errors.append(str(e)))
    page.on("console", lambda m: errors.append(f"console.{m.type}: {m.text}")
            if m.type == "error" else None)
    page.goto(f"http://127.0.0.1:{port}/src/scene.html?story={story}&lang={lang}",
              wait_until="load")
    try:
        page.wait_for_function("window.__ready === true", timeout=60_000)
    except PWError:
        err = page.evaluate("window.__error || null")
        raise SystemExit(f"scene failed to initialise: {err or errors or 'timeout'}")
    if errors:
        print("  ! page errors:", *errors[:5], sep="\n    ")
    return page


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--story", default="little-star")
    ap.add_argument("--lang",  default="en")
    ap.add_argument("--out",   default=None)
    ap.add_argument("--fps",   type=int, default=None)
    ap.add_argument("--scale", type=float, default=1.0,
                    help="render scale, e.g. 0.5 for a fast draft")
    ap.add_argument("--no-audio", action="store_true")
    ap.add_argument("--preview", default=None,
                    help="comma-separated times (s): write stills instead of video")
    args = ap.parse_args()

    story = json.loads((ROOT / "stories" / f"{args.story}.json").read_text())
    fps   = args.fps or story["fps"]
    dur   = story["duration"]
    w = int(story["width"] * args.scale) // 2 * 2
    h = int(story["height"] * args.scale) // 2 * 2

    httpd, port = serve(ROOT)
    from playwright.sync_api import sync_playwright

    with sync_playwright() as pw:
        browser = pw.chromium.launch(executable_path=CHROME, args=[
            "--enable-unsafe-swiftshader", "--hide-scrollbars",
            "--force-color-profile=srgb", "--disable-lcd-text"])
        page = open_scene(browser, port, args.story, args.lang, w, h)
        if args.scale != 1.0:
            page.evaluate(f"document.getElementById('stage').style.transformOrigin='0 0';"
                          f"document.getElementById('stage').style.transform='scale({args.scale})'")

        # ---- preview stills ----
        if args.preview:
            outdir = ROOT / "out" / "preview"; outdir.mkdir(parents=True, exist_ok=True)
            for ts in [float(x) for x in args.preview.split(",")]:
                page.evaluate(f"window.renderFrame({ts})")
                page.screenshot(path=str(outdir / f"t{ts:05.1f}.png"),
                                clip={"x": 0, "y": 0, "width": w, "height": h})
                print(f"  preview t={ts:>5.1f}s")
            browser.close(); httpd.shutdown(); return

        # ---- video ----
        out = pathlib.Path(args.out) if args.out else ROOT / "out" / f"{args.story}-{args.lang}.mp4"
        out.parent.mkdir(parents=True, exist_ok=True)
        silent = out.with_suffix(".silent.mp4")
        total  = int(round(dur * fps))

        ff = subprocess.Popen([
            "ffmpeg", "-y", "-v", "error",
            "-f", "image2pipe", "-framerate", str(fps), "-i", "-",
            "-c:v", "libx264", "-preset", "slow", "-crf", "19",
            "-pix_fmt", "yuv420p", "-profile:v", "high", "-level", "4.2",
            "-movflags", "+faststart", "-r", str(fps), str(silent)],
            stdin=subprocess.PIPE)

        print(f"  rendering {total} frames @ {w}x{h} {fps}fps ({dur}s)")
        t0 = time.time()
        clip = {"x": 0, "y": 0, "width": w, "height": h}
        for i in range(total):
            page.evaluate("window.renderFrame(%r)" % (i / fps))
            ff.stdin.write(page.screenshot(type="jpeg", quality=95, clip=clip))
            if i % 60 == 0 and i:
                el = time.time() - t0
                print(f"    {i}/{total}  {el:5.1f}s elapsed, ~{el/i*(total-i):5.1f}s left", flush=True)
        ff.stdin.close()
        if ff.wait() != 0:
            raise SystemExit("ffmpeg encode failed")
        browser.close(); httpd.shutdown()
        print(f"  video done in {time.time()-t0:.1f}s -> {silent.name}")

    # ---- score + mux ----
    if args.no_audio:
        silent.replace(out)
    else:
        wav = ROOT / "out" / f"{args.story}.wav"
        subprocess.run([sys.executable, str(ROOT / "src" / "music.py"),
                        "--duration", str(dur), "--out", str(wav)], check=True)
        subprocess.run([
            "ffmpeg", "-y", "-v", "error", "-i", str(silent), "-i", str(wav),
            "-c:v", "copy", "-c:a", "aac", "-b:a", "192k", "-ac", "2",
            "-shortest", "-movflags", "+faststart", str(out)], check=True)
        silent.unlink(missing_ok=True)
    print(f"✓ {out}  ({out.stat().st_size/1e6:.1f} MB)")


if __name__ == "__main__":
    main()
