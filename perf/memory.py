"""
Graphics memory of the landing page, measured from Chromium's own memory
accounting (the memory-infra dump that chrome://tracing uses), not estimated
from layer sizes. For each variant and profile it reports:

  tiles:  rasterized tiles the compositor holds for drawing (cc/tile_memory)
  images: decoded images kept for raster, e.g. the tape PNGs (cc/image_memory)

Usage:
  uv run --project perf python perf/memory.py VARIANT_DIR [VARIANT_DIR ...] [--runs N]

A VARIANT_DIR can also be a URL (http://... or https://...), e.g. another site
to compare against.

Profiles match bench.py's viewports and pixel ratios (phone = 3x, like a
current iPhone). No throttling: memory doesn't depend on network or CPU speed.
Headless Chromium rasterizes in software; tile and image memory are kept per
pixel the same way on a GPU, but Safari keeps its own books, so treat these as
Chromium numbers.
"""
from __future__ import annotations

import argparse
import statistics
from pathlib import Path

from bench import PROFILES, SETTLE_S, serve
from playwright.sync_api import Browser, sync_playwright

CATEGORIES = {"tiles": "cc/tile_memory", "images": "cc/image_memory"}


def dump(browser: Browser, url: str, profile: dict) -> dict[str, float]:
    ctx = browser.new_context(viewport=profile["viewport"], device_scale_factor=profile["dpr"],
                              is_mobile=profile["mobile"], has_touch=profile["mobile"])
    page = ctx.new_page()
    page.goto(url, wait_until="load")
    page.wait_for_timeout(SETTLE_S * 1000)
    cdp = ctx.new_cdp_session(page)
    events: list[dict] = []
    done: list[bool] = []
    cdp.on("Tracing.dataCollected", lambda e: events.extend(e["value"]))
    cdp.on("Tracing.tracingComplete", lambda e: done.append(True))
    cdp.send("Tracing.start", {"traceConfig": {"includedCategories": ["disabled-by-default-memory-infra"],
                                               "memoryDumpConfig": {"triggers": []}}})
    cdp.send("Tracing.requestMemoryDump", {"deterministic": True, "levelOfDetail": "detailed"})
    cdp.send("Tracing.end")
    while not done:
        page.wait_for_timeout(50)
    ctx.close()

    out = dict.fromkeys(CATEGORIES, 0.0)
    for ev in events:
        if ev.get("ph") != "v":
            continue
        allocators = ev["args"]["dumps"].get("allocators", {})
        for name, key in CATEGORIES.items():
            size = allocators.get(key, {}).get("attrs", {}).get("size", {}).get("value")
            if size:
                out[name] += int(size, 16) / 1e6
    return out


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("variants", nargs="+")
    ap.add_argument("--runs", type=int, default=3)
    ap.add_argument("--profiles", default="desktop,phone")
    args = ap.parse_args()

    rows = []
    with sync_playwright() as p:
        browser = p.chromium.launch()
        for variant in args.variants:
            remote = variant.startswith(("http://", "https://"))
            srv, url = (None, variant) if remote else serve(Path(variant))
            name = variant.split("//")[1].split("/")[0] if remote else Path(variant).name
            for pname in args.profiles.split(","):
                runs = [dump(browser, url, PROFILES[pname]) for _ in range(args.runs)]
                med = {k: statistics.median(r[k] for r in runs) for k in CATEGORIES}
                rows.append((name, pname, med))
            if srv:
                srv.shutdown()
        browser.close()

    print(f"\n{'variant':<22}{'profile':<9}{'tiles MB':>9}{'images MB':>10}{'total MB':>9}")
    for name, pname, m in rows:
        print(f"{name:<22}{pname:<9}{m['tiles']:>9.1f}{m['images']:>10.1f}{sum(m.values()):>9.1f}")


if __name__ == "__main__":
    main()
