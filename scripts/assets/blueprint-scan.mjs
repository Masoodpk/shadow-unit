// A photogrammetry village scan → a BLUEPRINT for a clean, game-built village.
// The scan itself is never shown in the game: it's read for its layout only.
// No dependencies (own GLB reader and PNG decoder).
//
//   1. rasterise the scan from above on a 0.5 m grid: the top surface (height + colour from the
//      texture) and the lowest surface per cell; vertical faces give a wall colour per cell
//   2. the bare ground: a morphological opening of the lowest surface (removes everything narrower
//      than ~18 m standing on it — houses, trees, cars), smoothed
//   3. classify each cell: building (≥ 2.2 m above the ground, not green), tree (tall and green),
//      or ground — paved / dirt / grass by colour
//   4. houses: building cells split into roof segments (similar height and colour), each fitted
//      with its minimum-area rectangle → centre, size, rotation, base, eave and ridge heights,
//      roof style (gable / flat) and colours
//   5. trees: tall green blobs → trunk position, height, crown radius
// Writes JSON (heights + surface map on a 1 m grid, houses, trees) and a debug PNG.
//
//   node blueprint-scan.mjs --in=country.glb --out=../../src/assets/maps/greywater.json --png=bp.png
import fs from "node:fs";
import zlib from "node:zlib";

const args = Object.fromEntries(process.argv.slice(2).map((a) => a.replace(/^--/, "").split("=")));
const CELL = 0.5;

// ------------------------------------------------------------------ GLB
const buf = fs.readFileSync(args.in);
const jsonLen = buf.readUInt32LE(12);
const gltf = JSON.parse(buf.subarray(20, 20 + jsonLen).toString("utf8"));
const binStart = 20 + jsonLen + 8;
const CT = { 5120: Int8Array, 5121: Uint8Array, 5122: Int16Array, 5123: Uint16Array, 5125: Uint32Array, 5126: Float32Array };
const NC = { SCALAR: 1, VEC2: 2, VEC3: 3, VEC4: 4 };
function accessor(i) {
  const a = gltf.accessors[i];
  const bv = gltf.bufferViews[a.bufferView];
  const T = CT[a.componentType];
  const n = a.count * NC[a.type];
  const off = binStart + (bv.byteOffset ?? 0) + (a.byteOffset ?? 0);
  return new T(buf.buffer.slice(buf.byteOffset + off, buf.byteOffset + off + n * T.BYTES_PER_ELEMENT));
}
const mul = (a, b) => {
  const o = new Array(16).fill(0);
  for (let c = 0; c < 4; c++) for (let r = 0; r < 4; r++) for (let k = 0; k < 4; k++) o[c * 4 + r] += a[k * 4 + r] * b[c * 4 + k];
  return o;
};
const I4 = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];
const local = (n) => n.matrix ?? I4;
const tris = [];
(function walk(list, parent) {
  for (const ni of list) {
    const n = gltf.nodes[ni];
    const m = mul(parent, local(n));
    if (n.mesh !== undefined)
      for (const prim of gltf.meshes[n.mesh].primitives) {
        const pos = accessor(prim.attributes.POSITION);
        const uv = accessor(prim.attributes.TEXCOORD_0);
        const P = new Float32Array(pos.length);
        for (let i = 0; i < pos.length; i += 3) {
          const x = pos[i], y = pos[i + 1], z = pos[i + 2];
          // glTF → Babylon (the loader mirrors X)
          P[i] = -(m[0] * x + m[4] * y + m[8] * z + m[12]);
          P[i + 1] = m[1] * x + m[5] * y + m[9] * z + m[13];
          P[i + 2] = m[2] * x + m[6] * y + m[10] * z + m[14];
        }
        tris.push({ P, uv, ia: accessor(prim.indices) });
      }
    walk(n.children ?? [], m);
  }
})(gltf.scenes[gltf.scene ?? 0].nodes, I4);

// ------------------------------------------------------------------ texture (PNG decode)
function decodePNG(b) {
  let p = 8, w = 0, h = 0, ct = 0, idat = [];
  while (p < b.length) {
    const len = b.readUInt32BE(p), type = b.toString("ascii", p + 4, p + 8);
    const data = b.subarray(p + 8, p + 8 + len);
    if (type === "IHDR") { w = data.readUInt32BE(0); h = data.readUInt32BE(4); ct = data[9]; }
    if (type === "IDAT") idat.push(data);
    p += 12 + len;
  }
  const bpp = ct === 6 ? 4 : ct === 2 ? 3 : 1;
  const raw = zlib.inflateSync(Buffer.concat(idat));
  const out = new Uint8Array(w * h * 3);
  const stride = w * bpp;
  let prev = new Uint8Array(stride);
  for (let y = 0; y < h; y++) {
    const f = raw[y * (stride + 1)];
    const line = new Uint8Array(raw.buffer, raw.byteOffset + y * (stride + 1) + 1, stride).slice();
    for (let x = 0; x < stride; x++) {
      const a = x >= bpp ? line[x - bpp] : 0, up = prev[x], c = x >= bpp ? prev[x - bpp] : 0;
      let v = line[x];
      if (f === 1) v += a;
      else if (f === 2) v += up;
      else if (f === 3) v += (a + up) >> 1;
      else if (f === 4) { const pp = a + up - c, pa = Math.abs(pp - a), pb = Math.abs(pp - up), pc = Math.abs(pp - c); v += pa <= pb && pa <= pc ? a : pb <= pc ? up : c; }
      line[x] = v & 255;
    }
    for (let x = 0; x < w; x++) for (let k = 0; k < 3; k++) out[(y * w + x) * 3 + k] = line[x * bpp + k];
    prev = line;
  }
  return { w, h, rgb: out };
}
const img = gltf.images[0];
const ibv = gltf.bufferViews[img.bufferView];
const tex = decodePNG(buf.subarray(binStart + (ibv.byteOffset ?? 0), binStart + (ibv.byteOffset ?? 0) + ibv.byteLength));
const texel = (u, v, out) => {
  const x = Math.min(tex.w - 1, Math.max(0, Math.floor((((u % 1) + 1) % 1) * tex.w)));
  const y = Math.min(tex.h - 1, Math.max(0, Math.floor((((v % 1) + 1) % 1) * tex.h)));
  const i = (y * tex.w + x) * 3;
  out[0] = tex.rgb[i]; out[1] = tex.rgb[i + 1]; out[2] = tex.rgb[i + 2];
};
console.log("texture", tex.w, tex.h, "triangles", tris.reduce((a, t) => a + t.ia.length / 3, 0));

// ------------------------------------------------------------------ top-down raster
let x0 = Infinity, x1 = -Infinity, z0 = Infinity, z1 = -Infinity;
for (const t of tris) for (let i = 0; i < t.P.length; i += 3) {
  x0 = Math.min(x0, t.P[i]); x1 = Math.max(x1, t.P[i]);
  z0 = Math.min(z0, t.P[i + 2]); z1 = Math.max(z1, t.P[i + 2]);
}
const W = Math.ceil((x1 - x0) / CELL), H = Math.ceil((z1 - z0) / CELL);
const top = new Float32Array(W * H).fill(-Infinity);
const low = new Float32Array(W * H).fill(Infinity);
const topCol = new Uint8Array(W * H * 3);
const wallCol = new Float32Array(W * H * 4); // r g b n
const col = [0, 0, 0];
for (const { P, uv, ia } of tris) {
  for (let t = 0; t < ia.length; t += 3) {
    const a = ia[t], b = ia[t + 1], c = ia[t + 2];
    const ax = P[a * 3], ay = P[a * 3 + 1], az = P[a * 3 + 2];
    const bx = P[b * 3], by = P[b * 3 + 1], bz = P[b * 3 + 2];
    const cx = P[c * 3], cy = P[c * 3 + 1], cz = P[c * 3 + 2];
    // face normal: vertical faces are walls
    const ux = bx - ax, uy = by - ay, uz = bz - az, vx = cx - ax, vy = cy - ay, vz = cz - az;
    const nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
    const nl = Math.hypot(nx, ny, nz) || 1;
    const steep = Math.abs(ny / nl) < 0.35;
    const gx0 = Math.floor((Math.min(ax, bx, cx) - x0) / CELL), gx1 = Math.floor((Math.max(ax, bx, cx) - x0) / CELL);
    const gz0 = Math.floor((Math.min(az, bz, cz) - z0) / CELL), gz1 = Math.floor((Math.max(az, bz, cz) - z0) / CELL);
    const d = (bz - cz) * (ax - cx) + (cx - bx) * (az - cz);
    if (steep) {
      // a wall: its colour (centre texel) goes to the cells it stands on
      texel((uv[a * 2] + uv[b * 2] + uv[c * 2]) / 3, (uv[a * 2 + 1] + uv[b * 2 + 1] + uv[c * 2 + 1]) / 3, col);
      for (let gz = gz0; gz <= gz1; gz++) for (let gx = gx0; gx <= gx1; gx++) {
        if (gx < 0 || gz < 0 || gx >= W || gz >= H) continue;
        const k = (gz * W + gx) * 4;
        wallCol[k] += col[0]; wallCol[k + 1] += col[1]; wallCol[k + 2] += col[2]; wallCol[k + 3]++;
      }
    }
    if (Math.abs(d) < 1e-9) continue;
    for (let gz = gz0; gz <= gz1; gz++)
      for (let gx = gx0; gx <= gx1; gx++) {
        if (gx < 0 || gz < 0 || gx >= W || gz >= H) continue;
        const X = x0 + (gx + 0.5) * CELL, Z = z0 + (gz + 0.5) * CELL;
        const l1 = ((bz - cz) * (X - cx) + (cx - bx) * (Z - cz)) / d;
        const l2 = ((cz - az) * (X - cx) + (ax - cx) * (Z - cz)) / d;
        const l3 = 1 - l1 - l2;
        if (l1 < -1e-4 || l2 < -1e-4 || l3 < -1e-4) continue;
        const y = l1 * ay + l2 * by + l3 * cy;
        const i = gz * W + gx;
        if (y < low[i]) low[i] = y;
        if (y > top[i]) {
          top[i] = y;
          texel(l1 * uv[a * 2] + l2 * uv[b * 2] + l3 * uv[c * 2], l1 * uv[a * 2 + 1] + l2 * uv[b * 2 + 1] + l3 * uv[c * 2 + 1], col);
          topCol[i * 3] = col[0]; topCol[i * 3 + 1] = col[1]; topCol[i * 3 + 2] = col[2];
        }
      }
  }
}
// fill empty cells from neighbours (scan holes)
for (let pass = 0; pass < 6; pass++) {
  for (let z = 0; z < H; z++) for (let x = 0; x < W; x++) {
    const i = z * W + x;
    if (Number.isFinite(top[i])) continue;
    let s = 0, sl = 0, n = 0;
    for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const xx = x + dx, zz = z + dz;
      if (xx < 0 || zz < 0 || xx >= W || zz >= H) continue;
      const j = zz * W + xx;
      if (!Number.isFinite(top[j])) continue;
      s += top[j]; sl += low[j]; n++;
      for (let k = 0; k < 3; k++) topCol[i * 3 + k] = topCol[j * 3 + k];
    }
    if (n) { top[i] = s / n; low[i] = sl / n; }
  }
}
console.log("grid", W, H, "cells of", CELL, "m; x", x0.toFixed(1), x1.toFixed(1), "z", z0.toFixed(1), z1.toFixed(1));

// ------------------------------------------------------------------ bare ground
function filt(src, r, fn) {
  // separable min / max filter
  const tmp = new Float32Array(src.length), out = new Float32Array(src.length);
  for (let z = 0; z < H; z++) for (let x = 0; x < W; x++) {
    let v = fn === "min" ? Infinity : -Infinity;
    for (let k = -r; k <= r; k++) { const xx = Math.min(W - 1, Math.max(0, x + k)); const s = src[z * W + xx]; v = fn === "min" ? Math.min(v, s) : Math.max(v, s); }
    tmp[z * W + x] = v;
  }
  for (let z = 0; z < H; z++) for (let x = 0; x < W; x++) {
    let v = fn === "min" ? Infinity : -Infinity;
    for (let k = -r; k <= r; k++) { const zz = Math.min(H - 1, Math.max(0, z + k)); const s = tmp[zz * W + x]; v = fn === "min" ? Math.min(v, s) : Math.max(v, s); }
    out[z * W + x] = v;
  }
  return out;
}
function blur(src, r) {
  const out = new Float32Array(src.length);
  for (let z = 0; z < H; z++) for (let x = 0; x < W; x++) {
    let s = 0, n = 0;
    for (let dz = -r; dz <= r; dz++) for (let dx = -r; dx <= r; dx++) {
      const xx = x + dx, zz = z + dz;
      if (xx < 0 || zz < 0 || xx >= W || zz >= H) continue;
      s += src[zz * W + xx]; n++;
    }
    out[z * W + x] = s / n;
  }
  return out;
}
const R = Math.round(parseFloat(args.open ?? "9") / CELL);
// the lowest surface, then the opening: min-filter (eat everything narrower than 2R) and max-filter
let ground = filt(filt(low, R, "min"), R, "max");
// where the scan's own lowest surface is the ground, keep it (a little detail), else the opening
for (let i = 0; i < ground.length; i++) if (low[i] - ground[i] < 0.6) ground[i] = Math.max(ground[i], low[i]);
ground = blur(ground, 3);

// ------------------------------------------------------------------ classes
// 0 paved, 1 dirt, 2 grass, 3 building, 4 tree
const cls = new Uint8Array(W * H);
const above = new Float32Array(W * H);
const isGreen = (r, g, b) => g > r * 1.06 && g > b * 1.08 && g > 55;
for (let i = 0; i < W * H; i++) {
  const r = topCol[i * 3], g = topCol[i * 3 + 1], b = topCol[i * 3 + 2];
  const hgt = top[i] - ground[i];
  above[i] = hgt;
  if (hgt > 2.2) cls[i] = isGreen(r, g, b) ? 4 : 3;
  else if (isGreen(r, g, b)) cls[i] = 2;
  else {
    const mx = Math.max(r, g, b), mn = Math.min(r, g, b);
    const sat = mx ? (mx - mn) / mx : 0;
    cls[i] = sat < 0.16 ? 0 : 1;
  }
}
// clean speckle: a cell takes the majority class of its 5x5 neighbourhood (buildings stay crisp)
{
  const out = Uint8Array.from(cls);
  for (let z = 2; z < H - 2; z++) for (let x = 2; x < W - 2; x++) {
    const cnt = [0, 0, 0, 0, 0];
    for (let dz = -2; dz <= 2; dz++) for (let dx = -2; dx <= 2; dx++) cnt[cls[(z + dz) * W + x + dx]]++;
    let best = 0;
    for (let k = 1; k < 5; k++) if (cnt[k] > cnt[best]) best = k;
    if (cnt[best] >= 14) out[z * W + x] = best;
  }
  cls.set(out);
}

// ------------------------------------------------------------------ the true ground
// open cells (lanes, yards, grass) are measured: the scan's surface there IS the ground. Under the
// houses and trees it is unknown: filled in from the open ground round them (Jacobi relaxation,
// coarse to fine), so the ground runs flat under a house instead of rising into a mound.
{
  const known = new Uint8Array(W * H);
  // a ring of a metre round every building / tree is suspect too (walls, eaves, the scan's skirts)
  for (let z = 0; z < H; z++) for (let x = 0; x < W; x++) {
    const i0 = z * W + x;
    // one surface only (nothing overhanging), and near the lower envelope: not a roof's low edge
    let ok = top[i0] - low[i0] < 0.5 && top[i0] - ground[i0] < 1.4;
    for (let dz = -4; dz <= 4 && ok; dz++) for (let dx = -4; dx <= 4 && ok; dx++) {
      const xx = Math.min(W - 1, Math.max(0, x + dx)), zz = Math.min(H - 1, Math.max(0, z + dz));
      if (cls[zz * W + xx] >= 3) ok = false;
    }
    known[z * W + x] = ok ? 1 : 0;
  }
  const g = new Float32Array(W * H);
  for (let i = 0; i < W * H; i++) g[i] = known[i] ? Math.min(top[i], low[i] + 0.3) : ground[i];
  for (let it = 0; it < 900; it++) {
    for (let z = 0; z < H; z++) for (let x = 0; x < W; x++) {
      const i = z * W + x;
      if (known[i]) continue;
      const a = g[z * W + Math.max(0, x - 1)], b = g[z * W + Math.min(W - 1, x + 1)];
      const c = g[Math.max(0, z - 1) * W + x], d = g[Math.min(H - 1, z + 1) * W + x];
      g[i] = (a + b + c + d) / 4;
    }
  }
  ground = blur(g, 2);
}

// ------------------------------------------------------------------ houses
// building blocks (connected building cells), each turned to its own main direction and covered by
// the largest rectangles that fit inside it, biggest first, never overlapping: rows of houses
function hull(pts) {
  pts.sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  const cross = (o, a, b) => (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);
  const lo = [], up = [];
  for (const p of pts) { while (lo.length >= 2 && cross(lo[lo.length - 2], lo[lo.length - 1], p) <= 0) lo.pop(); lo.push(p); }
  for (let i = pts.length - 1; i >= 0; i--) { const p = pts[i]; while (up.length >= 2 && cross(up[up.length - 2], up[up.length - 1], p) <= 0) up.pop(); up.push(p); }
  up.pop(); lo.pop();
  return lo.concat(up);
}
function minRectAngle(pts) {
  const h = hull(pts.map((p) => [...p]));
  let best = 0, bestA = Infinity;
  for (let i = 0; i < h.length; i++) {
    const [ax, az] = h[i], [bx, bz] = h[(i + 1) % h.length];
    const ang = Math.atan2(bz - az, bx - ax);
    const c = Math.cos(ang), s = Math.sin(ang);
    let mu = Infinity, Mu = -Infinity, mv = Infinity, Mv = -Infinity;
    for (const [x, z] of h) { const u = x * c + z * s, v = -x * s + z * c; mu = Math.min(mu, u); Mu = Math.max(Mu, u); mv = Math.min(mv, v); Mv = Math.max(Mv, v); }
    const area = (Mu - mu) * (Mv - mv);
    if (area < bestA) { bestA = area; best = ang; }
  }
  return best;
}
const pct = (arr, q) => { const a = [...arr].sort((x, y) => x - y); return a[Math.min(a.length - 1, Math.floor(q * a.length))]; };
const comp = new Int32Array(W * H).fill(-1);
const blocks = [];
for (let i = 0; i < W * H; i++) {
  if (cls[i] !== 3 || comp[i] >= 0) continue;
  const cells = [i];
  comp[i] = blocks.length;
  for (let k = 0; k < cells.length; k++) {
    const c = cells[k], x = c % W, z = (c / W) | 0;
    for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const xx = x + dx, zz = z + dz;
      if (xx < 0 || zz < 0 || xx >= W || zz >= H) continue;
      const j = zz * W + xx;
      if (cls[j] !== 3 || comp[j] >= 0) continue;
      comp[j] = blocks.length;
      cells.push(j);
    }
  }
  blocks.push(cells);
}
const houses = [];
const MINS = parseFloat(args.minside ?? "3.5");
for (const cells of blocks) {
  if (cells.length * CELL * CELL < 12) continue;
  // blocks are irregular: work in tiles of ~30 m so each part takes its own direction
  const tiles = new Map();
  for (const c of cells) {
    const k = Math.floor((c % W) / 60) + "," + Math.floor(((c / W) | 0) / 60);
    (tiles.get(k) ?? tiles.set(k, []).get(k)).push(c);
  }
  for (const part of tiles.values()) {
    if (part.length * CELL * CELL < 12) continue;
    const pts = part.map((c) => [x0 + ((c % W) + 0.5) * CELL, z0 + (((c / W) | 0) + 0.5) * CELL]);
    // the houses' direction: the dominant direction of the roof edges here (height gradients,
    // folded into 0–90°), which tiling can't bias the way a bounding rectangle would
    const hist = new Float32Array(90);
    for (const c of part) {
      const x = c % W, z = (c / W) | 0;
      if (x < 1 || z < 1 || x >= W - 1 || z >= H - 1) continue;
      const gx = top[c + 1] - top[c - 1], gz = top[c + W] - top[c - W];
      const m = Math.hypot(gx, gz);
      if (m < 0.3) continue;
      let deg = ((Math.atan2(gz, gx) * 180) / Math.PI) % 90;
      if (deg < 0) deg += 90;
      hist[Math.floor(deg) % 90] += Math.min(m, 4);
    }
    let ang = minRectAngle(pts);
    {
      let bi = -1, bv = 0;
      for (let d = 0; d < 90; d++) {
        let v = 0;
        for (let k = -3; k <= 3; k++) v += hist[(d + k + 90) % 90] * (4 - Math.abs(k));
        if (v > bv) { bv = v; bi = d; }
      }
      if (bi >= 0 && bv > 20) ang = (bi * Math.PI) / 180;
    }
    const ca = Math.cos(ang), sa = Math.sin(ang);
    let mu = Infinity, mv = Infinity, Mu = -Infinity, Mv = -Infinity;
    const uv = pts.map(([x, z]) => { const u = x * ca + z * sa, v = -x * sa + z * ca; mu = Math.min(mu, u); Mu = Math.max(Mu, u); mv = Math.min(mv, v); Mv = Math.max(Mv, v); return [u, v]; });
    const B = CELL;
    const GW = Math.ceil((Mu - mu) / B) + 1, GH = Math.ceil((Mv - mv) / B) + 1;
    const grid = new Uint8Array(GW * GH);
    const cellOf = new Int32Array(GW * GH).fill(-1);
    uv.forEach(([u, v], k) => {
      const gx = Math.round((u - mu) / B), gz = Math.round((v - mv) / B);
      grid[gz * GW + gx] = 1;
      cellOf[gz * GW + gx] = part[k];
    });
    // close 1-bin gaps left by the rotation
    for (let z = 1; z < GH - 1; z++) for (let x = 1; x < GW - 1; x++) {
      const i = z * GW + x;
      if (grid[i]) continue;
      const n = grid[i - 1] + grid[i + 1] + grid[i - GW] + grid[i + GW];
      if (n >= 3) grid[i] = 2;
    }
    // greedy maximal rectangles
    const minB = Math.ceil(MINS / B);
    for (let guard = 0; guard < 200; guard++) {
      const hgt = new Int32Array(GW);
      let best = null;
      for (let z = 0; z < GH; z++) {
        for (let x = 0; x < GW; x++) hgt[x] = grid[z * GW + x] ? hgt[x] + 1 : 0;
        // largest rectangle in the histogram (stack)
        const st = [];
        for (let x = 0; x <= GW; x++) {
          const hh = x < GW ? hgt[x] : 0;
          let start = x;
          while (st.length && st[st.length - 1][1] >= hh) {
            const [sx, sh] = st.pop();
            const wdt = x - sx;
            if (sh >= minB && wdt >= minB) {
              // prefer house-like shapes: area, but a ridiculous aspect counts for less
              const ar = Math.max(wdt, sh) / Math.min(wdt, sh);
              const score = wdt * sh / (ar > 3.5 ? ar / 3.5 : 1);
              if (!best || score > best.score) best = { score, x0: sx, x1: x, z1: z + 1, z0: z + 1 - sh };
            }
            start = sx;
          }
          st.push([start, hh]);
        }
      }
      if (!best) break;
      // long rows are split into houses of 6–12 m
      const wdt = best.x1 - best.x0, hh = best.z1 - best.z0;
      const along = wdt >= hh ? "x" : "z";
      const span = along === "x" ? wdt : hh;
      const parts = Math.max(1, Math.round((span * B) / 9));
      for (let pi = 0; pi < parts; pi++) {
        const a0 = Math.round((span * pi) / parts), a1 = Math.round((span * (pi + 1)) / parts);
        const rx0 = along === "x" ? best.x0 + a0 : best.x0, rx1 = along === "x" ? best.x0 + a1 : best.x1;
        const rz0 = along === "z" ? best.z0 + a0 : best.z0, rz1 = along === "z" ? best.z0 + a1 : best.z1;
        const inside = [];
        for (let z = rz0; z < rz1; z++) for (let x = rx0; x < rx1; x++) {
          const c = cellOf[z * GW + x];
          if (c >= 0) inside.push(c);
        }
        if (!inside.length) continue;
        const cu = mu + ((rx0 + rx1) / 2 - 0.5) * B, cv = mv + ((rz0 + rz1) / 2 - 0.5) * B;
        const L = (rx1 - rx0) * B, Wd = (rz1 - rz0) * B;
        const tops = inside.map((c) => top[c]);
        const base = pct(inside.map((c) => ground[c]), 0.1);
        const ridge = pct(tops, 0.9), eave = pct(tops, 0.2);
        let rr = 0, rg = 0, rb = 0;
        for (const c of inside) { rr += topCol[c * 3]; rg += topCol[c * 3 + 1]; rb += topCol[c * 3 + 2]; }
        rr /= inside.length; rg /= inside.length; rb /= inside.length;
        let wr = 0, wg = 0, wb = 0, wn = 0;
        for (const c of inside) {
          const x = c % W, z = (c / W) | 0;
          for (const [dx, dz] of [[3, 0], [-3, 0], [0, 3], [0, -3]]) {
            const xx = x + dx, zz = z + dz;
            if (xx < 0 || zz < 0 || xx >= W || zz >= H) continue;
            const k = (zz * W + xx) * 4;
            if (wallCol[k + 3] > 0) { wr += wallCol[k] / wallCol[k + 3]; wg += wallCol[k + 1] / wallCol[k + 3]; wb += wallCol[k + 2] / wallCol[k + 3]; wn++; }
          }
        }
        houses.push({
          x: +(cu * ca - cv * sa).toFixed(2), z: +(cu * sa + cv * ca).toFixed(2), l: +L.toFixed(2), w: +Wd.toFixed(2), a: +ang.toFixed(4),
          base: +base.toFixed(2), eave: +Math.max(2.6, Math.min(12, eave - base)).toFixed(2), ridge: +Math.max(2.8, Math.min(14, ridge - base)).toFixed(2),
          roof: ridge - eave > 0.6 ? "gable" : "flat",
          rc: [Math.round(rr), Math.round(rg), Math.round(rb)],
          wc: wn ? [Math.round(wr / wn), Math.round(wg / wn), Math.round(wb / wn)] : [196, 190, 178],
        });
      }
      for (let z = best.z0; z < best.z1; z++) for (let x = best.x0; x < best.x1; x++) grid[z * GW + x] = 0;
    }
  }
}
console.log("building blocks", blocks.length, "houses", houses.length);

// ------------------------------------------------------------------ trees
const tseen = new Uint8Array(W * H);
const trees = [];
for (let i = 0; i < W * H; i++) {
  if (cls[i] !== 4 || tseen[i]) continue;
  const cells = [i];
  tseen[i] = 1;
  for (let k = 0; k < cells.length; k++) {
    const c = cells[k], x = c % W, z = (c / W) | 0;
    for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const j = (z + dz) * W + x + dx;
      if (x + dx < 0 || z + dz < 0 || x + dx >= W || z + dz >= H || tseen[j] || cls[j] !== 4) continue;
      tseen[j] = 1;
      cells.push(j);
    }
  }
  const area = cells.length * CELL * CELL;
  if (area < 4) continue;
  // big canopies hold several trees: one per ~30 m²
  const n = Math.max(1, Math.round(area / 30));
  for (let t = 0; t < n; t++) {
    const c = cells[Math.floor(((t + 0.5) / n) * cells.length)];
    const hgt = Math.max(3, above[c]);
    trees.push([+(x0 + ((c % W) + 0.5) * CELL).toFixed(1), +(z0 + (((c / W) | 0) + 0.5) * CELL).toFixed(1), +hgt.toFixed(1), +Math.min(5, Math.sqrt(area / n / Math.PI)).toFixed(1)]);
  }
}
console.log("trees", trees.length);

// ------------------------------------------------------------------ output (1 m grid)
const G = 2; // 0.5 m cells per output cell
const OW = Math.floor(W / G), OH = Math.floor(H / G);
const gh = new Int16Array(OW * OH), gc = new Uint8Array(OW * OH);
for (let z = 0; z < OH; z++) for (let x = 0; x < OW; x++) {
  let s = 0;
  const cnt = [0, 0, 0, 0, 0];
  for (let dz = 0; dz < G; dz++) for (let dx = 0; dx < G; dx++) { const i = (z * G + dz) * W + x * G + dx; s += ground[i]; cnt[cls[i]]++; }
  gh[z * OW + x] = Math.round((s / (G * G)) * 100);
  let best = 0;
  for (let k = 1; k < 5; k++) if (cnt[k] > cnt[best]) best = k;
  gc[z * OW + x] = best;
}
const data = {
  source: "Residential buildings, villages, country house — Metazeon (CC BY 4.0), layout only",
  grid: { x0, z0, cell: CELL * G, w: OW, h: OH },
  ground: Buffer.from(gh.buffer).toString("base64"),
  surface: Buffer.from(gc.buffer).toString("base64"),
  houses,
  trees,
};
fs.writeFileSync(args.out, JSON.stringify(data));
console.log("wrote", args.out, (fs.statSync(args.out).size / 1024).toFixed(0), "KB");

// ------------------------------------------------------------------ debug PNG (top view, +X right, +Z up)
if (args.png) {
  const img = Buffer.alloc(W * H * 3);
  const C = [[150, 150, 150], [150, 120, 85], [90, 140, 70], [60, 60, 70], [30, 90, 30]];
  for (let z = 0; z < H; z++) for (let x = 0; x < W; x++) {
    const i = z * W + x, o = ((H - 1 - z) * W + x) * 3;
    const k = cls[i];
    const shade = Math.max(0.5, Math.min(1.2, 0.8 + (ground[i] / 40)));
    img[o] = C[k][0] * shade; img[o + 1] = C[k][1] * shade; img[o + 2] = C[k][2] * shade;
  }
  // house rectangles
  for (const h of houses) {
    const c = Math.cos(h.a), s = Math.sin(h.a);
    for (let t = 0; t < 1; t += 0.002) {
      const per = 2 * (h.l + h.w), d = t * per;
      let u, v;
      if (d < h.l) { u = d - h.l / 2; v = -h.w / 2; }
      else if (d < h.l + h.w) { u = h.l / 2; v = d - h.l - h.w / 2; }
      else if (d < 2 * h.l + h.w) { u = h.l / 2 - (d - h.l - h.w); v = h.w / 2; }
      else { u = -h.l / 2; v = h.w / 2 - (d - 2 * h.l - h.w); }
      const X = h.x + u * c - v * s, Z = h.z + u * s + v * c;
      const gx = Math.floor((X - x0) / CELL), gz = Math.floor((Z - z0) / CELL);
      if (gx < 0 || gz < 0 || gx >= W || gz >= H) continue;
      const o = ((H - 1 - gz) * W + gx) * 3;
      img[o] = 255; img[o + 1] = h.roof === "gable" ? 200 : 80; img[o + 2] = 40;
    }
  }
  for (const [X, Z] of trees) {
    const gx = Math.floor((X - x0) / CELL), gz = Math.floor((Z - z0) / CELL);
    for (let k = -1; k <= 1; k++) { const o = ((H - 1 - gz) * W + gx + k) * 3; if (o >= 0) { img[o] = 0; img[o + 1] = 255; img[o + 2] = 0; } }
  }
  const raw = Buffer.alloc((W * 3 + 1) * H);
  for (let y = 0; y < H; y++) { raw[y * (W * 3 + 1)] = 0; img.copy(raw, y * (W * 3 + 1) + 1, y * W * 3, (y + 1) * W * 3); }
  const crcT = Array.from({ length: 256 }, (_, n) => { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; return c >>> 0; });
  const crc = (b) => { let c = 0xffffffff; for (const x of b) c = crcT[(c ^ x) & 255] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; };
  const chunk = (t, d) => { const l = Buffer.alloc(4); l.writeUInt32BE(d.length); const td = Buffer.concat([Buffer.from(t), d]); const c = Buffer.alloc(4); c.writeUInt32BE(crc(td)); return Buffer.concat([l, td, c]); };
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(W, 0); ihdr.writeUInt32BE(H, 4); ihdr[8] = 8; ihdr[9] = 2;
  fs.writeFileSync(args.png, Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk("IHDR", ihdr), chunk("IDAT", zlib.deflateSync(raw)), chunk("IEND", Buffer.alloc(0))]));
  console.log("png", W, H);
}
