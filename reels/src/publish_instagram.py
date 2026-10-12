#!/usr/bin/env python3
"""Publish a rendered reel to an Instagram Business account via the Graph API.

Instagram's Content Publishing API does not accept file uploads for Reels: it
fetches the video from a public HTTPS URL you supply. So the flow is

    render -> host the mp4 somewhere public -> create container -> poll -> publish

Credentials come from the environment and are never written to disk or logged:

    IG_USER_ID        the Instagram Business account id (not the @handle)
    IG_ACCESS_TOKEN   a long-lived token with instagram_content_publish

Run --check first: it validates the file against Instagram's Reels spec and
confirms the token works, without posting anything.
"""
import argparse, json, os, pathlib, subprocess, sys, time, urllib.error, urllib.parse, urllib.request

API = "https://graph.facebook.com/v21.0"

# Instagram Reels specification, as enforced server-side at publish time.
SPEC = dict(min_dur=3.0, max_dur=900.0, max_w=1920, max_bytes=1_000_000_000,
            min_fps=23, max_fps=60, vcodec={"h264", "hevc"}, acodec={"aac"})


def api(path, params=None, data=None, timeout=60):
    url = f"{API}/{path}"
    body = None
    if data:
        body = urllib.parse.urlencode(data).encode()
    elif params:
        url += "?" + urllib.parse.urlencode(params)
    req = urllib.request.Request(url, data=body, method="POST" if data else "GET")
    try:
        with urllib.request.urlopen(req, timeout=timeout) as r:
            return json.loads(r.read())
    except urllib.error.HTTPError as e:
        detail = e.read().decode("utf-8", "replace")[:600]
        raise SystemExit(f"Graph API {e.code} on {path}:\n  {detail}")
    except urllib.error.URLError as e:
        raise SystemExit(f"cannot reach graph.facebook.com ({e.reason}).\n"
                         "  If this is a proxy refusal, the environment's network policy "
                         "must allow graph.facebook.com before publishing can work.")


def probe(path):
    out = subprocess.run(
        ["ffprobe", "-v", "error", "-show_entries",
         "stream=codec_type,codec_name,width,height,r_frame_rate,sample_rate,channels",
         "-show_entries", "format=duration,size", "-of", "json", str(path)],
        capture_output=True, text=True, check=True).stdout
    d = json.loads(out)
    v = next(s for s in d["streams"] if s["codec_type"] == "video")
    a = next((s for s in d["streams"] if s["codec_type"] == "audio"), None)
    num, den = v["r_frame_rate"].split("/")
    return dict(w=int(v["width"]), h=int(v["height"]), vcodec=v["codec_name"],
                fps=float(num) / float(den), acodec=a and a["codec_name"],
                dur=float(d["format"]["duration"]), size=int(d["format"]["size"]))


def validate(path):
    """Check the file against the Reels spec locally, so a bad render fails here
    rather than after Instagram has already fetched it."""
    m = probe(path)
    problems = []
    if not SPEC["min_dur"] <= m["dur"] <= SPEC["max_dur"]:
        problems.append(f"duration {m['dur']:.1f}s outside {SPEC['min_dur']}–{SPEC['max_dur']}s")
    if m["w"] > SPEC["max_w"]:
        problems.append(f"width {m['w']} exceeds {SPEC['max_w']}")
    if m["vcodec"] not in SPEC["vcodec"]:
        problems.append(f"video codec {m['vcodec']} not in {sorted(SPEC['vcodec'])}")
    if m["acodec"] is None:
        problems.append("no audio stream (Reels require one)")
    elif m["acodec"] not in SPEC["acodec"]:
        problems.append(f"audio codec {m['acodec']} not in {sorted(SPEC['acodec'])}")
    if not SPEC["min_fps"] <= round(m["fps"]) <= SPEC["max_fps"]:
        problems.append(f"{m['fps']:.2f} fps outside {SPEC['min_fps']}–{SPEC['max_fps']}")
    if m["size"] > SPEC["max_bytes"]:
        problems.append(f"{m['size']/1e6:.0f} MB exceeds 1 GB")
    ratio = m["w"] / m["h"]
    note = "" if abs(ratio - 9 / 16) < 0.01 else f"  (note: {ratio:.3f}, not 9:16 — Instagram will letterbox or crop)"
    print(f"  {path.name}: {m['w']}x{m['h']} {m['vcodec']}/{m['acodec']} "
          f"{m['fps']:.0f}fps {m['dur']:.1f}s {m['size']/1e6:.1f}MB{note}")
    return problems


def creds():
    uid, tok = os.environ.get("IG_USER_ID"), os.environ.get("IG_ACCESS_TOKEN")
    missing = [n for n, v in (("IG_USER_ID", uid), ("IG_ACCESS_TOKEN", tok)) if not v]
    if missing:
        raise SystemExit("missing environment variable(s): " + ", ".join(missing) +
                         "\n  Set them in the environment's secrets; never commit them.")
    return uid, tok


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("video", type=pathlib.Path, help="the rendered mp4 (for local validation)")
    ap.add_argument("--video-url", help="public HTTPS URL Instagram will fetch the mp4 from")
    ap.add_argument("--cover-url", help="public HTTPS URL of the cover image (optional)")
    ap.add_argument("--caption-file", type=pathlib.Path)
    ap.add_argument("--caption", default="")
    ap.add_argument("--share-to-feed", action="store_true", default=True)
    ap.add_argument("--check", action="store_true",
                    help="validate the file and the token, then stop without posting")
    ap.add_argument("--poll-timeout", type=int, default=600)
    args = ap.parse_args()

    if not args.video.exists():
        raise SystemExit(f"no such file: {args.video}")

    print("  [1/4] validating against the Reels spec")
    problems = validate(args.video)
    if problems:
        for p in problems:
            print(f"    ✗ {p}")
        raise SystemExit("file does not meet the Reels spec; not publishing")
    print("    ✓ spec OK")

    caption = args.caption
    if args.caption_file:
        caption = args.caption_file.read_text().strip()
    if len(caption) > 2200:
        raise SystemExit(f"caption is {len(caption)} characters; Instagram allows 2200")
    print(f"    ✓ caption {len(caption)} / 2200 characters")

    uid, tok = creds()

    print("  [2/4] checking the account and its publishing quota")
    me = api(f"{uid}", {"fields": "username,account_type", "access_token": tok})
    quota = api(f"{uid}/content_publishing_limit",
                {"fields": "quota_usage,config", "access_token": tok})
    used = quota.get("data", [{}])[0].get("quota_usage", "?")
    print(f"    account @{me.get('username')} ({me.get('account_type')}), "
          f"{used} of 50 posts used in the last 24h")

    if args.check:
        print("  --check given: stopping before publishing. Nothing was posted.")
        return
    if not args.video_url:
        raise SystemExit("--video-url is required to publish: Instagram fetches the file "
                         "itself and cannot be handed local bytes.")

    print("  [3/4] creating the media container")
    fields = {"media_type": "REELS", "video_url": args.video_url,
              "caption": caption, "share_to_feed": str(bool(args.share_to_feed)).lower(),
              "access_token": tok}
    if args.cover_url:
        fields["cover_url"] = args.cover_url
    cid = api(f"{uid}/media", data=fields)["id"]
    print(f"    container {cid}")

    deadline = time.time() + args.poll_timeout
    while True:
        st = api(cid, {"fields": "status_code,status", "access_token": tok})
        code = st.get("status_code")
        if code == "FINISHED":
            print("    container ready"); break
        if code in ("ERROR", "EXPIRED"):
            raise SystemExit(f"container {code}: {st.get('status')}")
        if time.time() > deadline:
            raise SystemExit(f"container still {code} after {args.poll_timeout}s; not publishing")
        print(f"    {code}… waiting")
        time.sleep(10)

    print("  [4/4] publishing")
    pid = api(f"{uid}/media_publish", data={"creation_id": cid, "access_token": tok})["id"]
    link = api(pid, {"fields": "permalink", "access_token": tok}).get("permalink", "")
    print(f"✓ published: {link or pid}")


if __name__ == "__main__":
    main()
