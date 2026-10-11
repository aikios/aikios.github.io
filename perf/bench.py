"""
Benchmark the landing page in headless Chromium.

Serves each site variant from a local gzip-enabled server (GitHub Pages
gzips text and fonts, so uncompressed local serving would overstate load
cost), then for each profile (desktop / throttled phone) records:

  load:    FCP, LCP, load event, bytes transferred
  runtime: frame rate and main-thread busy time over a steady-state window
           while the tapes scroll, plus composited layer count/area
           (a proxy for graphics memory)

Usage:
  uv run --project perf python perf/bench.py VARIANT_DIR [VARIANT_DIR ...] [--runs N]

Build VARIANT_DIRs with perf/make_variants.sh; see perf/README.md.

Each VARIANT_DIR is a directory containing the site's index.html. Results
are appended to perf/results.jsonl and a median table is printed.
"""
from __future__ import annotations

import argparse
import gzip
import http.server
import io
import itertools
import json
import statistics
import threading
import time
from functools import partial
from pathlib import Path

from playwright.sync_api import sync_playwright

HERE = Path(__file__).resolve().parent
RESULTS = HERE / "results.jsonl"

NO_GZIP = {".png", ".jpg", ".jpeg", ".gif", ".webp", ".woff2"}

# Lighthouse's default mobile throttling: 150ms RTT, 1.6 Mbps down,
# 750 Kbps up, 4x CPU slowdown.
PROFILES = {
    "desktop": {"viewport": {"width": 1440, "height": 900}, "dpr": 1, "mobile": False, "cpu": 1, "net": None},
    "phone": {
        "viewport": {"width": 390, "height": 844}, "dpr": 3, "mobile": True, "cpu": 4,
        "net": {"latency": 150, "downloadThroughput": 1.6e6 / 8, "uploadThroughput": 750e3 / 8},
    },
}

SETTLE_S = 4.0   # let script.js's 75s-duration switch land before measuring
WINDOW_S = 5.0   # steady-state measurement window


class GzipHandler(http.server.SimpleHTTPRequestHandler):
    def log_message(self, format: str, *args: object) -> None:
        pass

    def send_head(self):
        path = Path(self.translate_path(self.path))
        if path.is_dir():
            path = path / "index.html"
        if not path.is_file() or path.suffix.lower() in NO_GZIP:
            return super().send_head()
        body = gzip.compress(path.read_bytes())
        self.send_response(200)
        self.send_header("Content-Type", self.guess_type(str(path)))
        self.send_header("Content-Encoding", "gzip")
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Cache-Control", "no-store")
        self.end_headers()
        return io.BytesIO(body)


def serve(root: Path) -> tuple[http.server.ThreadingHTTPServer, str]:
    srv = http.server.ThreadingHTTPServer(("127.0.0.1", 0), partial(GzipHandler, directory=str(root)))
    threading.Thread(target=srv.serve_forever, daemon=True).start()
    return srv, f"http://127.0.0.1:{srv.server_address[1]}/"


LCP_OBSERVER = """
window.__lcp = 0;
new PerformanceObserver(l => { for (const e of l.getEntries()) window.__lcp = e.startTime; })
  .observe({type: 'largest-contentful-paint', buffered: true});
"""

FRAME_PROBE = """
(windowMs) => new Promise(resolve => {
  const t = []; const start = performance.now();
  function f(ts) { t.push(ts); if (ts - start < windowMs) requestAnimationFrame(f); else resolve(t); }
  requestAnimationFrame(f);
})
"""


def task_metrics(cdp) -> dict[str, float]:
    return {m["name"]: m["value"] for m in cdp.send("Performance.getMetrics")["metrics"]}


def run_once(browser, url: str, profile: dict) -> dict:
    ctx = browser.new_context(viewport=profile["viewport"], device_scale_factor=profile["dpr"],
                              is_mobile=profile["mobile"], has_touch=profile["mobile"])
    page = ctx.new_page()
    cdp = ctx.new_cdp_session(page)
    cdp.send("Network.enable")
    cdp.send("Network.setCacheDisabled", {"cacheDisabled": True})
    if profile["net"]:
        cdp.send("Network.emulateNetworkConditions", {"offline": False, **profile["net"]})
    cdp.send("Emulation.setCPUThrottlingRate", {"rate": profile["cpu"]})
    cdp.send("Performance.enable")

    bytes_in = [0]
    cdp.on("Network.loadingFinished", lambda e: bytes_in.__setitem__(0, bytes_in[0] + e["encodedDataLength"]))

    page.add_init_script(LCP_OBSERVER)
    page.goto(url, wait_until="load")
    load = page.evaluate("""() => {
      const n = performance.getEntriesByType('navigation')[0];
      const fcp = performance.getEntriesByName('first-contentful-paint')[0];
      return {load_ms: n.loadEventStart, fcp_ms: fcp ? fcp.startTime : null};
    }""")
    page.evaluate("document.fonts.ready")
    time.sleep(SETTLE_S)
    load["lcp_ms"] = page.evaluate("window.__lcp")
    load["bytes"] = bytes_in[0]

    layers: list[list[dict]] = []
    cdp.on("LayerTree.layerTreeDidChange", lambda e: layers.append(e.get("layers") or []))
    cdp.send("LayerTree.enable")

    before = task_metrics(cdp)
    frames = page.evaluate(FRAME_PROBE, WINDOW_S * 1000)
    after = task_metrics(cdp)
    wall = (frames[-1] - frames[0]) / 1000
    intervals = [b - a for a, b in itertools.pairwise(frames)]

    tree = layers[-1] if layers else []
    drawn = [lyr for lyr in tree if lyr.get("drawsContent")]
    runtime = {
        "fps": (len(frames) - 1) / wall,
        "p95_frame_ms": statistics.quantiles(intervals, n=20)[-1],
        "long_frames": sum(1 for i in intervals if i > 25),
        "main_busy_pct": 100 * (after["TaskDuration"] - before["TaskDuration"]) / wall,
        "style_layout_ms_per_s": 1000 * ((after["RecalcStyleDuration"] - before["RecalcStyleDuration"])
                                          + (after["LayoutDuration"] - before["LayoutDuration"])) / wall,
        "layers": len(drawn),
        "layer_mpx": sum(lyr["width"] * lyr["height"] for lyr in drawn) * profile["dpr"] ** 2 / 1e6,
    }
    ctx.close()
    return {**load, **runtime}


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("variants", nargs="+", type=Path)
    ap.add_argument("--runs", type=int, default=5)
    ap.add_argument("--profiles", default="desktop,phone")
    args = ap.parse_args()

    rows = []
    with sync_playwright() as p:
        browser = p.chromium.launch()
        for variant in args.variants:
            srv, url = serve(variant.resolve())
            for pname in args.profiles.split(","):
                runs = [run_once(browser, url, PROFILES[pname]) for _ in range(args.runs)]
                with open(RESULTS, "a") as f:
                    f.writelines(json.dumps({"ts": time.time(), "variant": variant.name, "profile": pname, **r}) + "\n"
                                 for r in runs)
                med = {k: statistics.median(r[k] for r in runs if r[k] is not None) for k in runs[0]}
                rows.append((variant.name, pname, med))
            srv.shutdown()
        browser.close()

    cols = ["bytes", "fcp_ms", "lcp_ms", "load_ms", "fps", "p95_frame_ms", "long_frames",
            "main_busy_pct", "style_layout_ms_per_s", "layers", "layer_mpx"]
    print(f"{'variant':<14}{'profile':<9}" + "".join(f"{c:>14}" for c in cols))
    for name, pname, med in rows:
        print(f"{name:<14}{pname:<9}" + "".join(f"{med[c]:>14.1f}" for c in cols))
    print(f"(medians of {args.runs} runs; raw runs in {RESULTS.relative_to(HERE.parent)})")


if __name__ == "__main__":
    main()
