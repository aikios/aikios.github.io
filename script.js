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
const MAX_SEGMENT_DEVICE_PX = 1024;  // longest moving piece; see makeTape

// One repeat of each tape ("CAUTION ▲▼▲"), cropped by perf/make_tiles.py at
// several heights: graphics/tile-<name>-<height>.png. w x h is the full-size
// tile; the smaller copies keep its proportions. The page loads the smallest
// height that is still sharp on this screen, so a phone or a 1x monitor never
// decodes, and holds in memory, more image than it can show.
const TILE_HEIGHTS = [58, 87, 116, 174];  // plus each tile's full height
const TILES = [
  { name: "cave", w: 2541, h: 232 },
  { name: "achtung", w: 2702, h: 233 },
  { name: "caution", w: 2702, h: 232 },
];

// Tape thickness in CSS px before the per-tape 0.8-1.2x variation.
const baseHeight = (vw) => Math.max(MIN_HEIGHT_PX, (HEIGHT_VW / 100) * vw);

// Smallest tile height that covers the thickest tape in device pixels.
function tileHeight(tile) {
  const need = baseHeight(window.innerWidth) * 1.2 * window.devicePixelRatio;  // 1.2 = pickHeight max
  return TILE_HEIGHTS.find((h) => h >= need) ?? tile.h;
}
const tileSrc = (tile) => `graphics/tile-${tile.name}-${tileHeight(tile)}.png`;

// Decode tiles before showing any tape, so tapes don't pop in one by one.
// Cached per URL, so a resize that keeps the same height doesn't reload.
const decoded = new Map();
function tilesReady() {
  return Promise.all(TILES.map((tile) => {
    const src = tileSrc(tile);
    if (!decoded.has(src)) {
      const img = new Image();
      img.src = src;
      decoded.set(src, img.decode().catch(() => {}));
    }
    return decoded.get(src);
  }));
}

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
  // Make the tape just long enough to cross the screen: clip its centre line
  // to the screen grown by h on every side (so the square-cut ends stay off
  // screen) and centre it on that stretch. Tape that would sit off screen
  // still costs graphics memory, so a tape cutting across a corner is short.
  const px = hole.cx + g.nx * s, py = hole.cy + g.ny * s;
  let t0 = -Infinity, t1 = Infinity;
  for (const [p, d, max] of [[px, g.dx, vw], [py, g.dy, vh]]) {
    if (Math.abs(d) < 1e-9) continue;  // parallel to these edges; the other pair bounds it
    const a = (-h - p) / d, b = (max + h - p) / d;
    t0 = Math.max(t0, Math.min(a, b));
    t1 = Math.min(t1, Math.max(a, b));
  }
  const along = (t0 + t1) / 2;
  const len = t1 - t0;
  const tileW = h * tile.w / tile.h;
  const speed = SPEED_PX_S[0] + rand() * (SPEED_PX_S[1] - SPEED_PX_S[0]);
  const angleDeg = Math.atan2(g.dy, g.dx) * 180 / Math.PI;

  const row = document.createElement("div");
  row.className = "tape";
  row.style.cssText = `left:${px + g.dx * along}px;top:${py + g.dy * along}px;width:${len}px;height:${h}px;` +
                      `transform:translate(-50%,-50%) rotate(${angleDeg}deg)`;

  // A strip one tile longer than the tape, shifted by exactly one tile per
  // loop, so the seam never shows. The strip is built from short segments that
  // all move in sync: WebKit splits any long moving layer into tiles and
  // sometimes shows one before drawing it (a blank flash), so each segment is
  // kept to at most MAX_SEGMENT_DEVICE_PX and drawn whole. Segments overlap by
  // 1px so no hairline shows between them.
  const k = Math.ceil(tileW * window.devicePixelRatio / MAX_SEGMENT_DEVICE_PX);
  const segW = tileW / k;
  const track = document.createElement("div");
  track.className = "track" + (rand() < 0.5 ? " reverse" : "");
  track.style.cssText = `background-image:url(${tileSrc(tile)});background-size:${tileW}px ${h}px;` +
                        `--shift:${-tileW}px;--dur:${tileW / speed}s;--delay:${-rand() * 20}s`;
  const segments = Math.ceil(len / segW) + k;
  for (let i = 0; i < segments; i++) {
    const seg = document.createElement("div");
    seg.className = "seg";
    seg.style.cssText = `left:${i * segW}px;width:${segW + 1}px;background-position-x:${-i * segW}px`;
    track.append(seg);
  }
  row.append(track);
  return row;
}

function buildTapes(field) {
  const rand = mulberry32(SEED);
  const vw = window.innerWidth, vh = window.innerHeight;
  const count = Math.max(MIN_TAPES, Math.round((vw * vh / 1e6) * TAPES_PER_MEGAPIXEL));
  const baseH = baseHeight(vw);
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

// Start fetching right away, in parallel with the font.
tilesReady();

document.addEventListener("DOMContentLoaded", async () => {
  const field = document.querySelector(".tapes");
  // The menu's size depends on the web font. document.fonts.ready alone can
  // resolve before the font has even been requested, so ask for it directly.
  await Promise.all([tilesReady(), document.fonts.load("1em MSMINCHO").catch(() => {})]);
  buildTapes(field);
  // Re-lay the tapes whenever the window or the menu changes size.
  let pending;
  const relayout = () => {
    clearTimeout(pending);
    pending = setTimeout(() => tilesReady().then(() => buildTapes(field)), 150);
  };
  window.addEventListener("resize", relayout);
  // ResizeObserver also reports once on observe(); only act on real changes.
  const menu = document.querySelector(".menu ul");
  let menuSize = `${menu.offsetWidth}x${menu.offsetHeight}`;
  new ResizeObserver(() => {
    const size = `${menu.offsetWidth}x${menu.offsetHeight}`;
    if (size !== menuSize) { menuSize = size; relayout(); }
  }).observe(menu);
});
