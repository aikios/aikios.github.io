// Tape field: fills the viewport with scrolling caution tapes at random
// angles, then masks out a rectangle around the menu so the text stays
// readable. Layout is seeded, so the same SEED gives the same arrangement on
// every load; change SEED or the knobs below to try other shapes.

const SEED = 7;
const TAPES = ["graphics/tape-cave.png", "graphics/tape-achtung.png", "graphics/tape-caution.png"];
const TAPES_PER_MEGAPIXEL = 9;  // density; a 1440x900 window is ~1.3 MP
const MIN_TAPES = 6;
const MAX_ANGLE_DEG = 40;       // each tape is tilted within +/- this
const HEIGHT_VW = 4.9;          // tape thickness, matching the original tapes
const MIN_HEIGHT_PX = 28;
const SPEED_PX_S = [60, 160];   // scroll speed range
const HOLE_PADDING_PX = 24;     // clear space around the menu text

// Native pixel size of each tape image, so widths are known before load.
const ASPECT = { "graphics/tape-cave.png": 10200 / 232,
                 "graphics/tape-achtung.png": 9547 / 233,
                 "graphics/tape-caution.png": 9495 / 232 };

function mulberry32(a) {
  return function () {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function buildTapes(field) {
  const rand = mulberry32(SEED);
  const between = (lo, hi) => lo + rand() * (hi - lo);
  const vw = window.innerWidth, vh = window.innerHeight;
  const diag = Math.hypot(vw, vh);
  const count = Math.max(MIN_TAPES, Math.round((vw * vh / 1e6) * TAPES_PER_MEGAPIXEL));
  const baseH = Math.max(MIN_HEIGHT_PX, (HEIGHT_VW / 100) * vw);

  field.replaceChildren();
  for (let i = 0; i < count; i++) {
    const src = TAPES[Math.floor(rand() * TAPES.length)];
    const h = baseH * between(0.8, 1.2);
    const imgW = h * ASPECT[src];
    // Stratify vertically so tapes spread over the whole screen instead of clumping.
    const cy = ((i + rand()) / count) * vh;
    const cx = between(0.2, 0.8) * vw;
    const angle = between(-MAX_ANGLE_DEG, MAX_ANGLE_DEG);
    const reverse = rand() < 0.5;

    const row = document.createElement("div");
    row.className = "tape";
    row.style.cssText = `left:${cx}px;top:${cy}px;width:${2 * diag}px;height:${h}px;` +
                        `transform:translate(-50%,-50%) rotate(${angle}deg)`;

    // Three copies, scrolled by exactly one copy's width per loop, so the
    // seam is invisible and the row always covers 2x the screen diagonal.
    const track = document.createElement("div");
    track.className = "track" + (reverse ? " reverse" : "");
    track.style.setProperty("--shift", `${-imgW}px`);
    track.style.animationDuration = `${imgW / between(...SPEED_PX_S)}s`;
    track.style.animationDelay = `${-rand() * 20}s`;
    for (let k = 0; k < 3; k++) {
      const img = document.createElement("img");
      img.src = src; img.alt = ""; img.height = h; img.width = imgW;
      img.decoding = "async";
      track.append(img);
    }
    row.append(track);
    field.append(row);
  }
}

function cutHole(field) {
  const r = document.querySelector(".menu ul").getBoundingClientRect();
  const p = HOLE_PADDING_PX;
  field.style.setProperty("--hole-x", `${r.left - p}px`);
  field.style.setProperty("--hole-y", `${r.top - p}px`);
  field.style.setProperty("--hole-w", `${r.width + 2 * p}px`);
  field.style.setProperty("--hole-h", `${r.height + 2 * p}px`);
}

document.addEventListener("DOMContentLoaded", () => {
  const field = document.querySelector(".tapes");
  const layout = () => { buildTapes(field); cutHole(field); };
  layout();
  document.fonts.ready.then(() => cutHole(field));  // menu size changes when the font lands
  let pending;
  window.addEventListener("resize", () => {
    clearTimeout(pending);
    pending = setTimeout(layout, 150);
  });
});
