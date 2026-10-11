# perf

Local tooling for the landing page, using Playwright's headless Chromium and
WebKit (Safari's engine). Not part of the site: `perf/` is excluded from the
Jekyll build in `_config.yml`.

| Script | What it does |
|---|---|
| `serve.py` | Preview server with caching off, so a plain reload shows your latest edits |
| `check.py` | Chromium + WebKit, desktop + phone: JS errors, tapes built and moving, no tape inside the menu's clear zone; saves screenshots to `perf/shots/` |
| `bench.py` + `make_variants.sh` | Load and runtime benchmark, comparing git refs and your edits |
| `make_tiles.py` | Crops each `graphics/tape-*.png` to one repeat as `graphics/tile-*.png` |

`bench.py` measures load (bytes, FCP, LCP, load event) and runtime (fps, p95 frame
time, main-thread busy %, style+layout time, composited layer area) under two
profiles: `desktop` and `phone`. The phone profile uses Lighthouse's mobile
throttling: 4x CPU slowdown, 150 ms RTT, 1.6 Mbps down.

## Setup (once per machine)

```sh
uv run --project perf playwright install chromium-headless-shell webkit   # into ~/Library/Caches/ms-playwright
```

## Preview and check in both engines

```sh
python3 perf/serve.py                              # http://127.0.0.1:4000/
uv run --project perf python perf/check.py         # in another terminal
```

## Compare your edits to the last commit

```sh
perf/make_variants.sh                 # builds perf/variants/{worktree,HEAD}
uv run --project perf python perf/bench.py perf/variants/HEAD perf/variants/worktree
```

Other refs work too: `perf/make_variants.sh main 6f1ded7`.
For a quick check that the pipeline works, add `--runs 1 --profiles desktop`.
Raw runs are appended to `perf/results.jsonl` (gitignored).

## Remove the browser afterwards

```sh
rm -rf ~/Library/Caches/ms-playwright
```

## Caveats

Headless Chromium rasterizes in software, so its fps and graphics numbers are a
pessimistic stand-in for a real GPU. Use them to compare variants against each
other, not as absolute numbers for a real device.
