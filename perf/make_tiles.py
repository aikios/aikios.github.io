"""
Crop each tape image in graphics/ down to one repeat period ("CAUTION ▲▼▲"),
so the page can tile a short image instead of scrolling a ~10,000px one.

  uv run --project perf python perf/make_tiles.py

Finds the period by autocorrelating the image's column-darkness profile, then
writes graphics/tile-<name>-<height>.png at each height in HEIGHTS and prints
the period it found. script.js loads the smallest height that is still sharp at
the screen's tape size and pixel ratio, so phones and 1x screens don't decode
(and hold in memory) the full-size image.
"""
from __future__ import annotations

from pathlib import Path

import numpy as np
from PIL import Image

GRAPHICS = Path(__file__).resolve().parent.parent / "graphics"
HEIGHTS = (58, 87, 116, 174, 0)  # px; 0 = source height, unscaled. Keep in sync with script.js


def period(profile: np.ndarray, min_p: int) -> int:
    x = profile - profile.mean()
    n = len(x)
    best, best_score = 0, -1.0
    for p in range(min_p, n // 2):
        a, b = x[:-p], x[p:]
        score = float((a * b).sum() / np.sqrt((a * a).sum() * (b * b).sum()))
        if score > best_score:
            best, best_score = p, score
    return best


for name in ("cave", "achtung", "caution"):
    src = GRAPHICS / f"tape-{name}.png"
    img = Image.open(src).convert("RGB")
    # darkness per column: black text/triangles vs yellow tape
    gray = np.asarray(img.convert("L"), dtype=float)
    profile = (255 - gray).sum(axis=0)
    p = period(profile, min_p=img.width // 8)
    # start the crop mid-way through the first period to skip any left-edge artifacts
    left = p // 2
    tile = img.crop((left, 0, left + p, img.height))
    print(f"{name}: {img.width}px wide, period {p}px")
    for h in HEIGHTS:
        h = h or img.height
        w = round(p * h / img.height)
        out = GRAPHICS / f"tile-{name}-{h}.png"
        scaled = tile if h == img.height else tile.resize((w, h), Image.Resampling.LANCZOS)
        # The sources use 256 colours; a palette keeps the files as small as theirs.
        scaled.quantize(256).save(out, optimize=True)
        print(f"  {out.name}: {w}x{h} ({out.stat().st_size} bytes)")
