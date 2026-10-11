// Tape field: fills the viewport with scrolling caution tapes, placed so that
// no tape crosses the menu. The opening around the text comes from where the
// tapes are laid, not from a mask:
//   1. A few "frame" tapes are laid first, spaced evenly around the menu and
//      each just outside its clear zone, so together they enclose it.
//   2. The rest fill the screen at random, but only at positions whose band
//      clears the menu.
//
// Layout is seeded, so the same SEED gives the same arrangement on every
// load; change SEED or the knobs below to try other shapes.

const SEED = 7;
const TAPES_PER_MEGAPIXEL = 9;  // density; a 1440x900 window is ~1.3 MP
const MIN_TAPES = 6;
const FRAME_TAPES = 5;          // tapes that outline the opening
const MAX_ANGLE_DEG = 60;       // tilt limit either way from horizontal
const HEIGHT_VW = 4.9;          // tape thickness, matching the original tapes
const MIN_HEIGHT_PX = 28;
const SPEED_PX_S = [60, 160];   // scroll speed range
const HOLE_PADDING_PX = 20;     // minimum clear space between tape and menu text
const HUG_JITTER_PX = 30;       // how far past the padding a frame tape may sit

// One repeat of each tape ("CAUTION ▲▼▲"), cropped by perf/make_tiles.py.
// Sizes are the PNGs' pixel dimensions, so widths are known before load.
const TILES = [
  { src: "graphics/tile-cave.png", w: 2541, h: 232 },
  { src: "graphics/tile-achtung.png", w: 2702, h: 233 },
  { src: "graphics/tile-caution.png", w: 2702, h: 232 },
];

function mulberry32(a) {
  return function () {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function holeBox() {
  const r = document.querySelector(".menu ul").getBoundingClientRect();
  return { cx: r.left + r.width / 2, cy: r.top + r.height / 2, hw: r.width / 2, hh: r.height / 2 };
}

// Geometry for a tape at `angle` (radians) relative to the hole centre. A
// tape's line is every point whose offset along the normal (nx, ny) is `s`.
// |s| < clear would cross the hole; lo..hi keeps the tape on screen.
function bandLimits(angle, h, hole, vw, vh) {
  const dx = Math.cos(angle), dy = Math.sin(angle);
  const nx = -dy, ny = dx;
  const clear = hole.hw * Math.abs(nx) + hole.hh * Math.abs(ny) + h / 2 + HOLE_PADDING_PX;
  const proj = [[0, 0], [vw, 0], [0, vh], [vw, vh]]
    .map(([x, y]) => (x - hole.cx) * nx + (y - hole.cy) * ny);
  return { dx, dy, nx, ny, clear, lo: Math.min(...proj) + h / 2, hi: Math.max(...proj) - h / 2 };
}

function makeTape(rand, tile, h, g, s, hole, vw, vh) {
  // Centre the tape on the point of its line nearest the screen centre, so a
  // length of one diagonal (plus a margin) always spans the whole screen.
  const px = hole.cx + g.nx * s, py = hole.cy + g.ny * s;
  const along = (vw / 2 - px) * g.dx + (vh / 2 - py) * g.dy;
  const len = Math.hypot(vw, vh) + 2 * h;
  const tileW = h * tile.w / tile.h;
  const speed = SPEED_PX_S[0] + rand() * (SPEED_PX_S[1] - SPEED_PX_S[0]);
  const angleDeg = Math.atan2(g.dy, g.dx) * 180 / Math.PI;

  const row = document.createElement("div");
  row.className = "tape";
  row.style.cssText = `left:${px + g.dx * along}px;top:${py + g.dy * along}px;width:${len}px;height:${h}px;` +
                      `transform:translate(-50%,-50%) rotate(${angleDeg}deg)`;

  // A strip one tile longer than the tape, shifted by exactly one tile per
  // loop, so the seam never shows.
  const track = document.createElement("div");
  track.className = "track" + (rand() < 0.5 ? " reverse" : "");
  track.style.cssText = `width:${(Math.ceil(len / tileW) + 1) * tileW}px;` +
                        `background-image:url(${tile.src});background-size:${tileW}px ${h}px;` +
                        `--shift:${-tileW}px;animation-duration:${tileW / speed}s;` +
                        `animation-delay:${-rand() * 20}s`;
  row.append(track);
  return row;
}

function buildTapes(field) {
  const rand = mulberry32(SEED);
  const vw = window.innerWidth, vh = window.innerHeight;
  const count = Math.max(MIN_TAPES, Math.round((vw * vh / 1e6) * TAPES_PER_MEGAPIXEL));
  const baseH = Math.max(MIN_HEIGHT_PX, (HEIGHT_VW / 100) * vw);
  const maxAngle = MAX_ANGLE_DEG * Math.PI / 180;
  const hole = holeBox();
  const frag = document.createDocumentFragment();
  const pickTile = () => TILES[Math.floor(rand() * TILES.length)];
  const pickHeight = () => baseH * (0.8 + rand() * 0.4);

  // 1. Frame: spread the tapes' outward normals evenly around the circle, so
  //    each tape closes off one side of the opening.
  const turn = rand() * 2 * Math.PI;
  for (let i = 0; i < Math.min(FRAME_TAPES, count); i++) {
    const normal = turn + (i + 0.5 * rand()) * 2 * Math.PI / FRAME_TAPES;
    // The tape runs perpendicular to its normal; fold into -90..90 degrees
    // and remember which side of the hole the normal points to.
    let angle = normal - Math.PI / 2, side = 1;
    if (Math.cos(angle) < 0) { angle += Math.PI; side = -1; }
    angle = Math.atan2(Math.sin(angle), Math.cos(angle));
    angle = Math.max(-maxAngle, Math.min(maxAngle, angle));
    const h = pickHeight();
    const g = bandLimits(angle, h, hole, vw, vh);
    const s = side * (g.clear + rand() * HUG_JITTER_PX);
    if (s < g.lo || s > g.hi) continue;  // that side of the menu is off screen
    frag.append(makeTape(rand, pickTile(), h, g, s, hole, vw, vh));
  }

  // 2. Fill: random angles and offsets, rejecting any that would cross the hole.
  for (let placed = frag.childElementCount, tries = 0; placed < count && tries < count * 20; tries++) {
    const h = pickHeight();
    const g = bandLimits((rand() * 2 - 1) * maxAngle, h, hole, vw, vh);
    const s = g.lo + rand() * (g.hi - g.lo);
    if (Math.abs(s) < g.clear) continue;
    frag.append(makeTape(rand, pickTile(), h, g, s, hole, vw, vh));
    placed++;
  }
  field.replaceChildren(frag);
}

// Decode all tiles before showing any tape, so tapes don't pop in one by one.
const tilesReady = Promise.all(TILES.map(({ src }) => {
  const img = new Image();
  img.src = src;
  return img.decode().catch(() => {});
}));

document.addEventListener("DOMContentLoaded", async () => {
  const field = document.querySelector(".tapes");
  // The menu's size depends on the web font. document.fonts.ready alone can
  // resolve before the font has even been requested, so ask for it directly.
  await Promise.all([tilesReady, document.fonts.load("1em MSMINCHO").catch(() => {})]);
  buildTapes(field);
  // Re-lay the tapes whenever the window or the menu changes size.
  let pending;
  const relayout = () => {
    clearTimeout(pending);
    pending = setTimeout(() => buildTapes(field), 150);
  };
  window.addEventListener("resize", relayout);
  new ResizeObserver(relayout).observe(document.querySelector(".menu ul"));
});
