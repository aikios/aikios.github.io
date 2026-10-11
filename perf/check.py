"""
Cross-engine smoke check for the landing page: Chromium and WebKit (Safari's
engine), at desktop and phone sizes. For each it reports JS errors, how many
tapes were built, whether the tapes are actually moving, and how many tape
(yellow) pixels fall inside the menu's clear zone. That last number should be 0.
It also saves a screenshot per engine/size.

  uv run --project perf python perf/check.py [URL] [--out DIR]

URL defaults to http://127.0.0.1:4000/ (start perf/serve.py first).
Needs both browsers: uv run --project perf playwright install chromium-headless-shell webkit
"""
from __future__ import annotations

import argparse
import io
from pathlib import Path

from PIL import Image
from playwright.sync_api import Browser, ConsoleMessage, ViewportSize, sync_playwright

SIZES: dict[str, tuple[ViewportSize, float]] = {
    "desktop": ({"width": 1440, "height": 900}, 1),
    "phone": ({"width": 390, "height": 844}, 2),
}
CLEAR_ZONE_INSET_PX = 4  # check slightly inside the padding so anti-aliased edges don't count


def is_tape(r: int, g: int, b: int) -> bool:
    return r > 200 and 150 < g < 230 and b < 90


def tape_pixels_near(img: Image.Image, box: list[float], pad: float, dpr: float) -> int:
    """Count tape-coloured pixels closer than `pad` CSS px to `box`.

    The generator keeps tapes `padding` px from the menu box, which makes a
    rounded-corner zone, so this tests true distance to the box rather than a
    square-cornered rectangle.
    """
    x0, y0 = max(0, int((box[0] - pad) * dpr)), max(0, int((box[1] - pad) * dpr))
    x1, y1 = min(img.width, int((box[2] + pad) * dpr)), min(img.height, int((box[3] + pad) * dpr))
    rgb = img.tobytes()
    count = 0
    for y in range(y0, y1):
        dy = max(box[1] - y / dpr, 0.0, y / dpr - box[3])
        for x in range(x0, x1):
            dx = max(box[0] - x / dpr, 0.0, x / dpr - box[2])
            if dx * dx + dy * dy < pad * pad and is_tape(*rgb[3 * (y * img.width + x):3 * (y * img.width + x) + 3]):
                count += 1
    return count


def check(browser: Browser, url: str, viewport: ViewportSize, dpr: float, shot: Path, padding: float) -> dict:
    page = browser.new_page(viewport=viewport, device_scale_factor=dpr)
    errors: list[str] = []
    page.on("pageerror", lambda e: errors.append(str(e)))
    def on_console(m: ConsoleMessage) -> None:
        if m.type == "error":
            errors.append(m.text)
    page.on("console", on_console)
    page.goto(url, wait_until="load")
    page.wait_for_function("document.querySelectorAll('.tape').length > 0", timeout=10000)

    moving = page.evaluate("""async () => {
      const t = document.querySelector('.track');
      const a = getComputedStyle(t).transform;
      await new Promise(r => setTimeout(r, 300));
      return a !== getComputedStyle(t).transform;
    }""")
    tapes = page.evaluate("document.querySelectorAll('.tape').length")
    box = page.evaluate("(() => { const r = document.querySelector('.menu ul').getBoundingClientRect();"
                        " return [r.left, r.top, r.right, r.bottom]; })()")
    png = page.screenshot()
    shot.write_bytes(png)
    page.close()

    img = Image.open(io.BytesIO(png)).convert("RGB")
    intruding = tape_pixels_near(img, box, padding - CLEAR_ZONE_INSET_PX, dpr)
    return {"tapes": tapes, "moving": moving, "intruding": intruding, "errors": errors}


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("url", nargs="?", default="http://127.0.0.1:4000/")
    ap.add_argument("--out", type=Path, default=Path(__file__).resolve().parent / "shots")
    ap.add_argument("--padding", type=float, default=20, help="HOLE_PADDING_PX from script.js")
    args = ap.parse_args()
    args.out.mkdir(parents=True, exist_ok=True)

    with sync_playwright() as p:
        for engine in (p.chromium, p.webkit):
            browser = engine.launch()
            for size, (viewport, dpr) in SIZES.items():
                shot = args.out / f"{engine.name}-{size}.png"
                r = check(browser, args.url, viewport, dpr, shot, args.padding)
                ok = not r["errors"] and r["tapes"] > 0 and r["moving"] and r["intruding"] == 0
                print(f"{'OK  ' if ok else 'FAIL'} {engine.name:<9}{size:<8} tapes={r['tapes']:<3} "
                      f"moving={r['moving']!s:<6}tape_px_in_clear_zone={r['intruding']:<6} "
                      f"errors={r['errors']}  -> {shot.name}")
            browser.close()


if __name__ == "__main__":
    main()
