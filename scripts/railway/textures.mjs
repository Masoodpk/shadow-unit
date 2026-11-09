// TERMINUS textures that the shared set (scripts/airport/textures/pcx) lacks:
//   ballast.jpg      — track ballast: tileable crushed granite, a Voronoi of stones with shaded faces (generated)
//   tile_glazed.jpg  — Victorian glazed wall tiles, cream with a dark green band (generated; the band sits at
//                      z mod 3 ∈ [0.2, 0.5] m, i.e. 1.2 m above the −7 floors)
//   the heritage set — Poly Haven scans (CC0, textures/src), calibrated to a target mean colour per channel
//                      (hue and detail kept): brick, brick_dark, stone, cobbles, flags, encaustic, slate,
//                      iron, timber, panel, boards
//   node scripts/railway/textures.mjs
import sharp from "sharp";
import path from "node:path";
const OUT = path.join(path.dirname(new URL(import.meta.url).pathname), "../airport/textures/pcx");
const N = 1024;
let seed = 7;
const rnd = () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 4294967296);

function ballast() {
  const G = 22; // grid cells per side, ~2 stones each
  const pts = [];
  for (let gy = 0; gy < G; gy++)
    for (let gx = 0; gx < G; gx++)
      for (let k = 0; k < 2; k++)
        pts.push({ x: (gx + rnd()) / G, y: (gy + rnd()) / G, g: 0.38 + rnd() * 0.32, w: 0.95 + rnd() * 0.15, lx: rnd() * 2 - 1, ly: rnd() * 2 - 1, cx: gx, cy: gy });
  const cell = Array.from({ length: G * G }, () => []);
  pts.forEach((p, i) => cell[p.cy * G + p.cx].push(i));
  const px = Buffer.alloc(N * N * 3);
  for (let y = 0; y < N; y++)
    for (let x = 0; x < N; x++) {
      const u = x / N, v = y / N;
      const gx = Math.floor(u * G), gy = Math.floor(v * G);
      let d1 = 9, d2 = 9, best = null, bdx = 0, bdy = 0;
      for (let oy = -1; oy <= 1; oy++)
        for (let ox = -1; ox <= 1; ox++) {
          const cx = (gx + ox + G) % G, cy = (gy + oy + G) % G;
          for (const i of cell[cy * G + cx]) {
            const p = pts[i];
            let dx = u - p.x, dy = v - p.y;
            dx -= Math.round(dx); dy -= Math.round(dy);
            const d = Math.hypot(dx, dy) * p.w;
            if (d < d1) { d2 = d1; d1 = d; best = p; bdx = dx; bdy = dy; } else if (d < d2) d2 = d;
          }
        }
      const edge = (d2 - d1) * G;             // 0 at the crack between two stones
      const crack = Math.min(1, edge / 0.16);
      // a facetted stone: light from the upper left, the face tilted by where we are in it
      const shade = 0.78 + 0.35 * (-(bdx * best.lx + bdy * best.ly) * G * 1.4);
      const h = Math.sin(x * 12.9898 + y * 78.233) * 43758.5453; const grain = 0.9 + 0.2 * (h - Math.floor(h));
      let g = best.g * shade * grain * (0.25 + 0.75 * crack);
      g = Math.max(0, Math.min(1, g));
      const warm = 0.96 + (best.g - 0.5) * 0.12;
      const i = (y * N + x) * 3;
      px[i] = Math.round(255 * Math.min(1, g * warm * 1.02));
      px[i + 1] = Math.round(255 * Math.min(1, g * 0.99));
      px[i + 2] = Math.round(255 * Math.min(1, g * 0.97 / warm));
    }
  return sharp(px, { raw: { width: N, height: N, channels: 3 } }).jpeg({ quality: 86 }).toFile(path.join(OUT, "ballast.jpg"));
}
function glazed() {
  const px = Buffer.alloc(N * N * 3);
  const T = 1024 / 20; // 20 tiles per 3 m repeat: 15 cm tiles
  for (let y = 0; y < N; y++)
    for (let x = 0; x < N; x++) {
      const v = 1 - (y + 0.5) / N; // texture v (0 at the bottom row), = (z mod 3) / 3
      const zm = v * 3;
      const band = zm >= 0.2 && zm < 0.5;
      const edge = (zm >= 0.17 && zm < 0.2) || (zm >= 0.5 && zm < 0.53);
      const ty = Math.floor(y / T), tx = Math.floor(x / T);
      const gx = x - tx * T, gy = y - ty * T;
      const grout = gx < 2.5 || gy < 2.5;
      const h = Math.sin(tx * 127.1 + ty * 311.7) * 43758.5453; const r = h - Math.floor(h);
      // a soft glaze: lighter towards each tile's upper left, a touch of variation per tile
      const sheen = 1 + 0.06 * (1 - (gx + gy) / (2 * T)) + (r - 0.5) * 0.05;
      let c = band ? [0.1, 0.27, 0.17] : edge ? [0.08, 0.1, 0.09] : [0.86, 0.82, 0.68];
      if (grout && !edge) c = [0.6, 0.58, 0.52];
      const i = (y * N + x) * 3;
      for (let k = 0; k < 3; k++) px[i + k] = Math.round(255 * Math.min(1, c[k] * (grout ? 1 : sheen)));
    }
  return sharp(px, { raw: { width: N, height: N, channels: 3 } }).jpeg({ quality: 88 }).toFile(path.join(OUT, "tile_glazed.jpg"));
}

// foliage.jpg — a tree crown's foliage (generated, tiles): thousands of small overlapping leaves in mixed greens
// over a dark interior, lit from above; bark.jpg — grey-brown bark with vertical fissures (generated, tiles)
function leaves() {
  const px = new Float32Array(N * N * 3);
  for (let i = 0; i < N * N; i++) (px[i * 3] = 0.09), (px[i * 3 + 1] = 0.16), (px[i * 3 + 2] = 0.06);
  for (let n = 0; n < 9000; n++) {
    const cx = rnd() * N, cy = rnd() * N, len = 9 + rnd() * 13, wid = len * (0.38 + rnd() * 0.15), a = rnd() * Math.PI;
    const ca = Math.cos(a), sa = Math.sin(a);
    const t = rnd();
    const base = [0.3 + t * 0.3, 0.48 + t * 0.32, 0.12 + t * 0.1];
    const tilt = rnd() * 2 - 1;
    const R = Math.ceil(len);
    for (let dy = -R; dy <= R; dy++)
      for (let dx = -R; dx <= R; dx++) {
        const u = (dx * ca + dy * sa) / len, v = (-dx * sa + dy * ca) / wid;
        const d = u * u + v * v;
        if (d > 1) continue;
        const X = (Math.floor(cx + dx) + N) % N, Y = (Math.floor(cy + dy) + N) % N;
        // a leaf: lighter on the side facing the light, a darker midrib, darker towards its edge
        const lit = 0.85 + 0.25 * tilt * v + 0.1 * (1 - d) - (Math.abs(v) < 0.08 ? 0.12 : 0);
        const i = (Y * N + X) * 3;
        for (let k = 0; k < 3; k++) px[i + k] = base[k] * lit;
      }
  }
  const out = Buffer.alloc(N * N * 3);
  for (let i = 0; i < out.length; i++) out[i] = Math.round(255 * Math.max(0, Math.min(1, px[i])));
  return sharp(out, { raw: { width: N, height: N, channels: 3 } }).jpeg({ quality: 86 }).toFile(path.join(OUT, "foliage.jpg"));
}
function bark() {
  const px = Buffer.alloc(N * N * 3);
  const cols = Array.from({ length: 48 }, () => ({ x: rnd(), w: 0.004 + rnd() * 0.01, ph: rnd() * 6.28, f: 2 + Math.floor(rnd() * 4) }));
  for (let y = 0; y < N; y++)
    for (let x = 0; x < N; x++) {
      const u = x / N, v = y / N;
      let fiss = 1;
      for (const c of cols) {
        let dx = u - (c.x + 0.012 * Math.sin(v * 6.283 * c.f + c.ph));
        dx -= Math.round(dx);
        const d = Math.abs(dx) / c.w;
        if (d < 1) fiss = Math.min(fiss, 0.35 + 0.65 * d);
      }
      const h = Math.sin(x * 12.9898 + y * 78.233) * 43758.5453; const g = 0.88 + 0.24 * (h - Math.floor(h));
      const plate = 0.9 + 0.1 * Math.sin(v * 40 + Math.sin(u * 30) * 2);
      const k = fiss * g * plate;
      const i = (y * N + x) * 3;
      px[i] = Math.round(255 * Math.min(1, 0.62 * k));
      px[i + 1] = Math.round(255 * Math.min(1, 0.54 * k));
      px[i + 2] = Math.round(255 * Math.min(1, 0.45 * k));
    }
  return sharp(px, { raw: { width: N, height: N, channels: 3 } }).jpeg({ quality: 86 }).toFile(path.join(OUT, "bark.jpg"));
}

// material: [scan in textures/src, target mean colour (sRGB 0..1), detail contrast (1 = as scanned)]
const SCANS = {
  brick: ["red_brick_03", [0.56, 0.3, 0.23]],
  brick_dark: ["red_bricks_04", [0.36, 0.2, 0.15]],
  stone: ["old_sandstone_02", [0.74, 0.68, 0.57]],
  cobbles: ["cobblestone_floor_08", [0.5, 0.49, 0.47]],
  flags: ["precast_stone_paving", [0.63, 0.61, 0.57], 0.6],
  encaustic: ["checkered_pavement_tiles", [0.56, 0.4, 0.3], 0.45],
  slate: ["roof_slates_02", [0.33, 0.35, 0.38]],
  iron: ["green_metal_rust", [0.14, 0.24, 0.18]],
  timber: ["old_planks_02", [0.46, 0.33, 0.21]],
  panel: ["dark_planks", [0.34, 0.2, 0.12]],
  boards: ["brown_planks_05", [0.6, 0.46, 0.32]],
};
const SRC = path.join(path.dirname(new URL(import.meta.url).pathname), "textures/src");
async function scans() {
  for (const [name, [src, col, k = 1]] of Object.entries(SCANS)) {
    const file = path.join(SRC, src + ".jpg");
    const { channels } = await sharp(file).stats();
    // out = colour × ((1 − k) + k × src / mean), per channel
    const a = col.map((c, i) => (c * 255 * k) / Math.max(1, channels[i].mean));
    const b = col.map((c) => c * 255 * (1 - k));
    await sharp(file).removeAlpha().linear(a, b).resize(1024, 1024).jpeg({ quality: 88 }).toFile(path.join(OUT, name + ".jpg"));
    console.log(name.padEnd(12), "←", src);
  }
}
await ballast();
await glazed();
await leaves();
await bark();
await scans();
console.log("wrote", OUT);
