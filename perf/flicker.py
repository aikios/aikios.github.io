"""
Flicker probe: records a few seconds of the page in Chromium and WebKit and
counts tape-covered (non-white) pixels in every video frame.

The tape bands never move, only the pattern slides along them, so coverage
should be nearly constant from frame to frame. A tape flashing blank shows up
as a frame whose coverage dips below the run's median. Reports per engine:
frames, median coverage, worst dip, and how many frames dip more than
--dip-pct; saves the worst frame to perf/shots/flicker-<engine>-worst.png.

  uv run --project perf python perf/flicker.py [URL] [--seconds 6] [--engines chromium,webkit] [--dpr 2]

Uses the ffmpeg that Playwright installs alongside its browsers.
"""
from __future__ import annotations

import argparse
import glob
import subprocess
import tempfile
from pathlib import Path

import numpy as np
from PIL import Image
from playwright.sync_api import ViewportSize, sync_playwright

HERE = Path(__file__).resolve().parent
VIEWPORT: ViewportSize = {"width": 960, "height": 600}


def ffmpeg_path() -> str:
    found = glob.glob(str(Path.home() / "Library/Caches/ms-playwright/ffmpeg-*/ffmpeg-*"))
    if not found:
        raise SystemExit("no Playwright ffmpeg found; run: uv run --project perf playwright install ffmpeg")
    return found[0]


def frames(video: Path) -> np.ndarray:
    # Playwright's ffmpeg build has no raw-video output, so go through PNGs.
    with tempfile.TemporaryDirectory() as td:
        subprocess.run([ffmpeg_path(), "-v", "error", "-i", str(video), f"{td}/%05d.png"], check=True)
        return np.stack([np.asarray(Image.open(f).convert("RGB")) for f in sorted(Path(td).glob("*.png"))])


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("url", nargs="?", default="http://127.0.0.1:4000/")
    ap.add_argument("--seconds", type=float, default=6)
    ap.add_argument("--engines", default="chromium,webkit")
    ap.add_argument("--dpr", type=float, default=1, help="device pixel ratio (2 = Retina)")
    ap.add_argument("--dip-pct", type=float, default=2.0, help="flag frames this %% below median coverage")
    args = ap.parse_args()
    (HERE / "shots").mkdir(exist_ok=True)

    with sync_playwright() as p, tempfile.TemporaryDirectory() as td:
        for engine in (getattr(p, name) for name in args.engines.split(",")):
            browser = engine.launch()
            ctx = browser.new_context(viewport=VIEWPORT, device_scale_factor=args.dpr,
                                      record_video_dir=td, record_video_size=VIEWPORT)
            page = ctx.new_page()
            page.goto(args.url, wait_until="load")
            page.wait_for_function("document.querySelectorAll('.tape').length > 0", timeout=10000)
            page.wait_for_timeout(1000)  # skip the first paint
            page.wait_for_timeout(args.seconds * 1000)
            video = page.video
            ctx.close()
            browser.close()
            assert video is not None
            fr = frames(Path(video.path()))

            # Drop the frames before the tapes first appear in full (page load).
            # Anything after that first full frame counts, so a blank frame
            # later on is still caught as a flash.
            coverage = (fr.min(axis=3) < 235).mean(axis=(1, 2)) * 100  # % of pixels not near-white
            full = np.flatnonzero(coverage >= np.median(coverage) * (1 - args.dip_pct / 100))
            fr, coverage = fr[full[0]:], coverage[full[0]:]
            med = float(np.median(coverage))
            worst = int(coverage.argmin())
            dips = int((coverage < med * (1 - args.dip_pct / 100)).sum())
            out = HERE / "shots" / f"flicker-{engine.name}-worst.png"
            Image.fromarray(fr[worst]).save(out)
            print(f"{engine.name:<9} frames={len(fr):<4} median_coverage={med:5.1f}%  "
                  f"min={coverage.min():5.1f}%  max={coverage.max():5.1f}%  "
                  f"frames_dipping>{args.dip_pct}%={dips}  worst-> {out.name}")


if __name__ == "__main__":
    main()
