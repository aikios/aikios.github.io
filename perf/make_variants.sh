#!/usr/bin/env bash
# Build site snapshots under perf/variants/ for bench.py to compare.
#
#   perf/make_variants.sh [REF ...]
#
# Always builds `worktree` (your current, possibly uncommitted, files).
# Each REF (any git ref: HEAD, main, a commit hash, a branch) is exported
# as it was committed into perf/variants/<REF>, with / in the name turned into -.
# With no REFs, defaults to HEAD, so the default run is "last commit vs my edits".
set -euo pipefail
cd "$(dirname "$0")/.."
V=perf/variants
FILES="index.html style.css script.js graphics fonts pictures"

rm -rf "$V" && mkdir -p "$V/worktree"
cp -R $FILES "$V/worktree/"
for ref in "${@:-HEAD}"; do
  dir="$V/${ref//\//-}"
  mkdir -p "$dir"
  git archive "$ref" $FILES | tar -x -C "$dir"
done
ls "$V"
