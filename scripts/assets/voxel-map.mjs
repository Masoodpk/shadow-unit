// CS Office → game collision + navigation.
//   1. rasterise the map's solid triangles into a 12.5 cm voxel grid (Babylon frame, metres)
//   2. greedy-merge voxels into axis-aligned boxes (movement / bullets / AI rays)
//   3. find walkable floors with head room, flood-fill what's reachable from a seed
//   4. lay nav nodes on that floor (with cover flags) and link them by voxel line of sight
// Also writes a top-down PNG of the floors so the layout can be checked by eye.
import { NodeIO } from "@gltf-transform/core";
import { ALL_EXTENSIONS } from "@gltf-transform/extensions";
import sharp from "sharp";
import fs from "node:fs";

const args = Object.fromEntries(process.argv.slice(2).map((a) => a.replace(/^--/, "").split("=")));
const input = args.in;
const out = args.out;
// node world units → metres (CS Office: inches; Dust 2's Sketchfab export is pre-scaled: --u=1.4773)
const U = parseFloat(args.u ?? "0.0254");
const VS = parseFloat(args.vs ?? "0.125");
const CROP = args.crop ? args.crop.split(",").map(Number) : null;
const io = new NodeIO().registerExtensions(ALL_EXTENSIONS);
const doc = await io.read(input);

// glass is skipped: the game splits it into breakable panes with their own colliders
const SKIP = [/SNOW1/, /TRANS6/, /BACK1/, /BACK2/, /_WIRE_/, /decals/, /GLASS/];
// see-through / thin things (foliage, fences): block movement but not bullets or sight
const SOFT = [/TRANS\d/];
const tris = { solid: [], soft: [] };
const xf = (m, x, y, z) => [m[0] * x + m[4] * y + m[8] * z + m[12], m[1] * x + m[5] * y + m[9] * z + m[13], m[2] * x + m[6] * y + m[10] * z + m[14]];
for (const node of doc.getRoot().listNodes()) {
  const mesh = node.getMesh();
  if (!mesh) continue;
  const name = node.getName();
  if (SKIP.some((r) => r.test(name))) continue;
  const cls = SOFT.some((r) => r.test(name)) ? "soft" : "solid";
  const m = node.getWorldMatrix();
  for (const prim of mesh.listPrimitives()) {
    const pos = prim.getAttribute("POSITION");
    const idx = prim.getIndices();
    const p = [];
    const P = new Float32Array(pos.getCount() * 3);
    for (let i = 0; i < pos.getCount(); i++) {
      pos.getElement(i, p);
      const q = xf(m, p[0], p[1], p[2]);
      // glTF → Babylon (the loader mirrors X), inches → metres
      P[i * 3] = -q[0] * U;
      P[i * 3 + 1] = q[1] * U;
      P[i * 3 + 2] = q[2] * U;
    }
    let ia = idx ? idx.getArray() : Uint32Array.from({ length: pos.getCount() }, (_, i) => i);
    // --crop=x0,z0,x1,z1 (Babylon metres): only the triangles over the playable area (a city is a
    // kilometre of skyline; the fight is a few blocks of it)
    if (CROP) {
      const keep = [];
      for (let t = 0; t < ia.length; t += 3) {
        let inside = false;
        for (let k = 0; k < 3 && !inside; k++) {
          const v = ia[t + k] * 3, x = P[v], z = P[v + 2];
          inside = x >= CROP[0] && x <= CROP[2] && z >= CROP[1] && z <= CROP[3];
        }
        if (inside) keep.push(ia[t], ia[t + 1], ia[t + 2]);
      }
      if (!keep.length) continue;
      ia = Uint32Array.from(keep);
    }
    tris[cls].push({ P, ia });
  }
}

// bounds of the solid geometry
let min = [Infinity, Infinity, Infinity], max = [-Infinity, -Infinity, -Infinity];
for (const t of tris.solid) for (let i = 0; i < t.P.length; i += 3) for (let k = 0; k < 3; k++) {
  min[k] = Math.min(min[k], t.P[i + k]);
  max[k] = Math.max(max[k], t.P[i + k]);
}
min = min.map((v) => Math.floor(v / VS) * VS - VS * 2);
max = max.map((v) => Math.ceil(v / VS) * VS + VS * 2);
const NX = Math.round((max[0] - min[0]) / VS), NY = Math.round((max[1] - min[1]) / VS), NZ = Math.round((max[2] - min[2]) / VS);
console.log("grid", NX, NY, NZ, "=", ((NX * NY * NZ) / 1e6).toFixed(0), "M voxels", "min", min, "max", max);
const N = NX * NY * NZ;
const idx3 = (x, y, z) => (y * NZ + z) * NX + x;
const mk = () => new Uint8Array(Math.ceil(N / 8));
const get = (b, i) => (b[i >> 3] >> (i & 7)) & 1;
const set = (b, i) => (b[i >> 3] |= 1 << (i & 7));

function raster(list, bits) {
  let samples = 0;
  for (const { P, ia } of list) {
    for (let t = 0; t < ia.length; t += 3) {
      const a = ia[t] * 3, b = ia[t + 1] * 3, c = ia[t + 2] * 3;
      const ax = P[a], ay = P[a + 1], az = P[a + 2];
      const ux = P[b] - ax, uy = P[b + 1] - ay, uz = P[b + 2] - az;
      const vx = P[c] - ax, vy = P[c + 1] - ay, vz = P[c + 2] - az;
      const L = Math.max(Math.hypot(ux, uy, uz), Math.hypot(vx, vy, vz), Math.hypot(ux - vx, uy - vy, uz - vz));
      const n = Math.max(1, Math.ceil(L / (VS * 0.45)));
      for (let i = 0; i <= n; i++)
        for (let j = 0; j <= n - i; j++) {
          const s = i / n, r = j / n;
          const x = Math.floor((ax + ux * s + vx * r - min[0]) / VS);
          const y = Math.floor((ay + uy * s + vy * r - min[1]) / VS);
          const z = Math.floor((az + uz * s + vz * r - min[2]) / VS);
          if (x < 0 || y < 0 || z < 0 || x >= NX || y >= NY || z >= NZ) continue;
          set(bits, idx3(x, y, z));
          samples++;
        }
    }
  }
  return samples;
}
const solid = mk();
const soft = mk();
console.log("solid samples", raster(tris.solid, solid));
console.log("soft samples", raster(tris.soft, soft));

// ------------------------------------------------------------------ greedy box merge
function greedy(bits, R) {
  const used = mk();
  const boxes = [];
  const free = (i) => get(bits, i) && !get(used, i);
  for (let y = R.y0; y < R.y1; y++)
    for (let z = R.z0; z < R.z1; z++)
      for (let x = R.x0; x < R.x1; x++) {
        const i0 = idx3(x, y, z);
        if (!free(i0)) continue;
        let lx = 1;
        while (x + lx < R.x1 && free(idx3(x + lx, y, z))) lx++;
        let lz = 1;
        grow: while (z + lz < R.z1) {
          for (let k = 0; k < lx; k++) if (!free(idx3(x + k, y, z + lz))) break grow;
          lz++;
        }
        let ly = 1;
        growY: while (y + ly < R.y1) {
          for (let c = 0; c < lz; c++) for (let k = 0; k < lx; k++) if (!free(idx3(x + k, y + ly, z + c))) break growY;
          ly++;
        }
        for (let a = 0; a < ly; a++) for (let c = 0; c < lz; c++) for (let k = 0; k < lx; k++) set(used, idx3(x + k, y + a, z + c));
        boxes.push([x, y, z, x + lx, y + ly, z + lz]);
      }
  return boxes;
}

// ------------------------------------------------------------------ walkable floors (0.5 m nav cells)
const C = 4; // voxels per nav cell
const CX = Math.floor(NX / C), CZ = Math.floor(NZ / C);
const HEAD = Math.ceil(1.75 / VS); // standing head room
const occ = (x, y, z) => x >= 0 && y >= 0 && z >= 0 && x < NX && y < NY && z < NZ && (get(solid, idx3(x, y, z)) || get(soft, idx3(x, y, z)));
// floors[cell] = list of floor voxel tops (y index of the first empty voxel above a filled one, with head room)
const floors = new Map();
for (let cz = 0; cz < CZ; cz++)
  for (let cx = 0; cx < CX; cx++) {
    const x = cx * C + 2, z = cz * C + 2;
    const list = [];
    for (let y = 1; y < NY - HEAD; y++) {
      if (!occ(x, y - 1, z) || occ(x, y, z)) continue;
      let ok = true;
      for (let h = 0; h < HEAD && ok; h++) if (occ(x, y + h, z)) ok = false;
      if (!ok) continue;
      // body clearance: nothing within ~0.375 m between knee and head height
      for (let dz = -2; dz <= 2 && ok; dz++)
        for (let dx = -2; dx <= 2 && ok; dx++) for (let h = 4; h < HEAD && ok; h++) if (occ(x + dx, y + h, z + dz)) ok = false;
      if (ok) list.push(y);
    }
    if (list.length) floors.set(cz * CX + cx, list);
  }
console.log("walkable cells", floors.size);
if (args.diag) {
  // lowest floor per cell → heightmap + histogram (0.5 m bins)
  const hist = new Map();
  const W = CX, H = CZ;
  const img = Buffer.alloc(W * H * 3, 0);
  let lo = Infinity, hi = -Infinity;
  for (const list of floors.values()) for (const y of list) { lo = Math.min(lo, y); hi = Math.max(hi, y); }
  for (const [cell, list] of floors) {
    const cx = cell % CX, cz = Math.floor(cell / CX);
    for (const y of list) {
      const b = Math.round((min[1] + y * VS) * 2) / 2;
      hist.set(b, (hist.get(b) ?? 0) + 1);
    }
    const y = list[0];
    const t = (y - lo) / (hi - lo);
    const o = ((H - 1 - cz) * W + cx) * 3;
    // colour ramp: blue (low) → green → red (high); multi-level cells get a white tint
    img[o] = Math.min(255, 255 * Math.max(0, t * 2 - 1) + (list.length > 1 ? 60 : 0));
    img[o + 1] = Math.min(255, 255 * (1 - Math.abs(t * 2 - 1)) + (list.length > 1 ? 60 : 0));
    img[o + 2] = Math.min(255, 255 * Math.max(0, 1 - t * 2) + (list.length > 1 ? 60 : 0));
  }
  // grid lines every 10 m (white), axes labels via console
  for (let cz = 0; cz < CZ; cz++) for (let cx = 0; cx < CX; cx++) {
    const X = min[0] + (cx * C + 2) * VS, Z = min[2] + (cz * C + 2) * VS;
    if (Math.abs(X - Math.round(X / 10) * 10) < 0.26 || Math.abs(Z - Math.round(Z / 10) * 10) < 0.26) {
      const o = ((H - 1 - cz) * W + cx) * 3;
      img[o] = img[o + 1] = img[o + 2] = 90;
    }
  }
  await sharp(img, { raw: { width: W, height: H, channels: 3 } }).resize(W * 2, H * 2, { kernel: "nearest" }).png().toFile("office-height.png");
  console.log("height range", (min[1] + lo * VS).toFixed(2), (min[1] + hi * VS).toFixed(2), "image px (2x) → metres: X = minX + px/4, Z = maxZ - py/4", min[0], max[2]);
  console.log([...hist.entries()].sort((a, b) => a[0] - b[0]).filter(([, n]) => n > 200).map(([k, n]) => `${k}:${n}`).join("  "));
  process.exit(0);
}

// flood fill: from --seed (Babylon metres) if given, otherwise the largest connected floor area
const key = (cx, cz, y) => `${cx},${cz},${y}`;
function fill(start, into) {
  const q = [start];
  into.set(key(...start), start);
  while (q.length) {
    const [cx, cz, y] = q.pop();
    for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const nx = cx + dx, nz = cz + dz;
      if (nx < 0 || nz < 0 || nx >= CX || nz >= CZ) continue;
      const list = floors.get(nz * CX + nx);
      if (!list) continue;
      for (const ny of list) {
        if (Math.abs(ny - y) > 4) continue; // ≤ 50 cm step
        const k = key(nx, nz, ny);
        if (into.has(k)) continue;
        into.set(k, [nx, nz, ny]);
        q.push([nx, nz, ny]);
      }
    }
  }
  return into;
}
// "covered" = a roof / ceiling 2.2–9 m above the floor: indoor
const covered = (cx, cz, y) => {
  const x = cx * C + 2, z = cz * C + 2;
  for (let h = Math.ceil(2.2 / VS); h < Math.ceil(9 / VS); h++) if (occ(x, y + h, z)) return true;
  return false;
};
let reach = new Map();
if (args.mode === "all") {
  // an outdoor map: the largest connected walkable area, everything on it
  const seen = new Set();
  for (const [cell, list] of floors)
    for (const y of list) {
      const cx = cell % CX, cz = Math.floor(cell / CX);
      if (seen.has(key(cx, cz, y))) continue;
      const comp = fill([cx, cz, y], new Map());
      for (const k of comp.keys()) seen.add(k);
      if (comp.size > reach.size) reach = comp;
    }
} else {
  // largest connected indoor area
  const indoorFloors = new Map();
  for (const [cell, list] of floors) {
    const cx = cell % CX, cz = Math.floor(cell / CX);
    const l = list.filter((y) => covered(cx, cz, y));
    if (l.length) indoorFloors.set(cell, l);
  }
  const saved = new Map(floors);
  floors.clear();
  for (const [k, v] of indoorFloors) floors.set(k, v);
  const seen = new Set();
  let best = new Map();
  for (const [cell, list] of floors)
    for (const y of list) {
      const cx = cell % CX, cz = Math.floor(cell / CX);
      if (seen.has(key(cx, cz, y))) continue;
      const comp = fill([cx, cz, y], new Map());
      for (const k of comp.keys()) seen.add(k);
      if (comp.size > best.size) best = comp;
    }
  floors.clear();
  for (const [k, v] of saved) floors.set(k, v);
  console.log("indoor component cells", best.size);
  // grow outdoors at most OUT cells (breadth first) and no higher than the indoor floors + 1.5 m
  const OUT = Math.round(parseFloat(args.outdoor ?? "60") / 0.5);
  // the playable footprint (Babylon metres): the building and the yards around it, not the hills beyond
  const B = (args.box ?? "-64,-32,52,62").split(",").map(Number);
  const inBox = (cx, cz) => {
    const X = min[0] + (cx * C + 2) * VS, Z = min[2] + (cz * C + 2) * VS;
    return X >= B[0] && X <= B[2] && Z >= B[1] && Z <= B[3];
  };
  let yMaxIn = -Infinity;
  for (const v of best.values()) yMaxIn = Math.max(yMaxIn, v[2]);
  const dist = new Map();
  let frontier = [];
  for (const [k, v] of best) {
    reach.set(k, v);
    dist.set(k, 0);
    frontier.push(v);
  }
  for (let d = 1; d <= OUT && frontier.length; d++) {
    const next = [];
    for (const [cx, cz, y] of frontier)
      for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const nx = cx + dx, nz = cz + dz;
        const list = floors.get(nz * CX + nx);
        if (!list) continue;
        for (const ny of list) {
          if (Math.abs(ny - y) > 4 || ny > yMaxIn + 12 || !inBox(nx, nz)) continue;
          const k = key(nx, nz, ny);
          if (reach.has(k)) continue;
          const indoor = covered(nx, nz, ny);
          reach.set(k, [nx, nz, ny]);
          // indoors again (another door): distance resets
          next.push([nx, nz, ny]);
          dist.set(k, indoor ? 0 : d);
        }
      }
    frontier = next;
  }
}
if (args.probe) {
  for (const pr of args.probe.split(";")) {
    const [PX, PZ] = pr.split(",").map(Number);
    const cx = Math.floor((PX - min[0]) / VS / C), cz = Math.floor((PZ - min[2]) / VS / C);
    const list = floors.get(cz * CX + cx) ?? [];
    const x = cx * C + 2, z = cz * C + 2;
    let col = "";
    for (let y = NY - 1; y >= 0; y--) col += occ(x, y, z) ? "#" : ".";
    // first filled from the top, and filled runs
    const runs = [];
    let inRun = false, start = 0;
    for (let y = 0; y < NY; y++) {
      const o = occ(x, y, z);
      if (o && !inRun) { inRun = true; start = y; }
      if (!o && inRun) { inRun = false; runs.push([(min[1] + start * VS).toFixed(2), (min[1] + y * VS).toFixed(2)]); }
    }
    console.log("probe", PX, PZ, "floors", list.map((y) => (min[1] + y * VS).toFixed(2)), "reached", list.map((y) => reach.has(key(cx, cz, y))), "solid runs", JSON.stringify(runs));
  }
}
console.log("reachable cells", reach.size, "≈", (reach.size * 0.25).toFixed(0), "m²");

const wx = (cx) => min[0] + (cx * C + 2 + 0.5) * VS;
const wz = (cz) => min[2] + (cz * C + 2 + 0.5) * VS;
const wy = (y) => min[1] + y * VS;

// ------------------------------------------------------------------ collision boxes inside the playable region
let rx0 = Infinity, rx1 = -Infinity, rz0 = Infinity, rz1 = -Infinity, ry0 = Infinity, ry1 = -Infinity;
for (const [cx, cz, y] of reach.values()) {
  rx0 = Math.min(rx0, cx); rx1 = Math.max(rx1, cx); rz0 = Math.min(rz0, cz); rz1 = Math.max(rz1, cz);
  ry0 = Math.min(ry0, y); ry1 = Math.max(ry1, y);
}
const MARGIN = Math.round(3 / VS);
const R = {
  x0: Math.max(0, rx0 * C - MARGIN), x1: Math.min(NX, (rx1 + 1) * C + MARGIN),
  z0: Math.max(0, rz0 * C - MARGIN), z1: Math.min(NZ, (rz1 + 1) * C + MARGIN),
  y0: Math.max(0, ry0 - Math.round(1.5 / VS)), y1: Math.min(NY, ry1 + Math.round(6 / VS)),
};
console.log("region (m)", (min[0] + R.x0 * VS).toFixed(1), (min[0] + R.x1 * VS).toFixed(1), "z", (min[2] + R.z0 * VS).toFixed(1), (min[2] + R.z1 * VS).toFixed(1), "y", (min[1] + R.y0 * VS).toFixed(1), (min[1] + R.y1 * VS).toFixed(1));

// de-clutter: drop small free-floating voxel clusters (cables, mice, papers) — they'd only cost boxes
function declutter(bits, minSize) {
  const seen = mk();
  let removed = 0;
  const stack = [];
  const comp = [];
  for (let y = R.y0; y < R.y1; y++)
    for (let z = R.z0; z < R.z1; z++)
      for (let x = R.x0; x < R.x1; x++) {
        const i0 = idx3(x, y, z);
        if (!get(bits, i0) || get(seen, i0)) continue;
        stack.length = 0;
        comp.length = 0;
        stack.push(x, y, z);
        set(seen, i0);
        let big = false;
        while (stack.length) {
          const cz = stack.pop(), cy = stack.pop(), cx = stack.pop();
          if (comp.length < minSize * 3) comp.push(cx, cy, cz);
          else big = true;
          for (const [dx, dy, dz] of [[1, 0, 0], [-1, 0, 0], [0, 1, 0], [0, -1, 0], [0, 0, 1], [0, 0, -1]]) {
            const nx = cx + dx, ny = cy + dy, nz = cz + dz;
            if (nx < R.x0 || ny < R.y0 || nz < R.z0 || nx >= R.x1 || ny >= R.y1 || nz >= R.z1) continue;
            const ni = idx3(nx, ny, nz);
            if (!get(bits, ni) || get(seen, ni)) continue;
            set(seen, ni);
            stack.push(nx, ny, nz);
          }
        }
        if (!big) {
          for (let k = 0; k < comp.length; k += 3) {
            const i = idx3(comp[k], comp[k + 1], comp[k + 2]);
            bits[i >> 3] &= ~(1 << (i & 7));
          }
          removed += comp.length / 3;
        }
      }
  return removed;
}
// only what the player can touch: voxels within ~1.5 m of the walkable floor and below ceiling height
{
  const D = 3;
  const mask = new Int16Array(CX * CZ).fill(-1); // highest reachable floor y in the dilated cell (or -1)
  const lowM = new Int16Array(CX * CZ).fill(32767);
  for (const [cx, cz, y] of reach.values())
    for (let dz = -D; dz <= D; dz++)
      for (let dx = -D; dx <= D; dx++) {
        const nx = cx + dx, nz = cz + dz;
        if (nx < 0 || nz < 0 || nx >= CX || nz >= CZ) continue;
        const i = nz * CX + nx;
        mask[i] = Math.max(mask[i], y);
        lowM[i] = Math.min(lowM[i], y);
      }
  const up = Math.round(parseFloat(args.ceil ?? "3.4") / VS);
  let kept = 0, cleared = 0;
  for (let z = R.z0; z < R.z1; z++)
    for (let x = R.x0; x < R.x1; x++) {
      const cx = Math.min(CX - 1, Math.floor(x / C)), cz = Math.min(CZ - 1, Math.floor(z / C));
      const i = cz * CX + cx;
      const hiY = mask[i] < 0 ? -1 : mask[i] + up;
      const loY = mask[i] < 0 ? 1 : lowM[i] - 4;
      for (let y = R.y0; y < R.y1; y++) {
        const v = idx3(x, y, z);
        if (y < loY || y > hiY) {
          if (get(solid, v) || get(soft, v)) cleared++;
          solid[v >> 3] &= ~(1 << (v & 7));
          soft[v >> 3] &= ~(1 << (v & 7));
        } else if (get(solid, v)) kept++;
      }
    }
  console.log("mask kept", kept, "cleared", cleared);
}
console.log("declutter removed voxels", declutter(solid, parseInt(args.minblob ?? "40")));
const solidBoxes = greedy(solid, R);
const softBoxes = greedy(soft, R);
console.log("boxes solid", solidBoxes.length, "soft", softBoxes.length);

// clip walls: where the playable floor ends but walkable ground carries on, an invisible wall
const clipCells = [];
for (const [cx, cz, y] of reach.values()) {
  for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
    const nx = cx + dx, nz = cz + dz;
    const list = floors.get(nz * CX + nx);
    // (--edges: where the floor just stops — a drop into nothing, the crop's edge — a wall too)
    if (!list) {
      if (args.edges) clipCells.push([nx, nz, y]);
      continue;
    }
    const near = list.find((ny) => Math.abs(ny - y) <= 4);
    if (near === undefined) {
      // (a floor a little higher is a step or a wall's top — no clip; one far overhead (another level of
      // a station) doesn't stop this being a drop)
      if (args.edges && !list.some((ny) => ny > y && ny - y <= Math.round(2 / VS))) clipCells.push([nx, nz, y]);
      continue;
    }
    if (reach.has(key(nx, nz, near))) continue;
    clipCells.push([nx, nz, near]);
  }
}
const clipBoxes = clipCells.map(([cx, cz, y]) => [cx * C, y - 2, cz * C, cx * C + C, y + Math.round(4 / VS), cz * C + C]);
console.log("clip cells", clipCells.length);

// ------------------------------------------------------------------ doorways
// A doorway: standing room under a lintel (2.0–3.0 m), walls on both sides 0.75–1.7 m apart, a short
// passage through the wall (≤ 0.6 m) with open floor in front and behind. Rooms with a low ceiling fail
// the passage test (their "lintel" goes on and on), corridors fail the width test.
const doorCands = [];
{
  const MID = Math.round(1.0 / VS), HEAD = Math.round(2.0 / VS);
  const maxW = Math.round(1.8 / VS), maxDepth = Math.round(0.95 / VS);
  // width of free space at (x,z) across `axis` (1 = spans X, i.e. measured along X), knee-to-chest height
  const widthAt = (x, y, z, ax, az) => {
    let a = 0, b = 0;
    while (a < maxW + 6 && !occ(x - ax * (a + 1), y + MID, z - az * (a + 1))) a++;
    while (b < maxW + 6 && !occ(x + ax * (b + 1), y + MID, z + az * (b + 1))) b++;
    return { a, b, w: a + b + 1 };
  };
  const clearUnder = (x, y, z) => {
    for (let h = 1; h < HEAD; h++) if (occ(x, y + h, z)) return false;
    return true;
  };
  for (const [cx, cz, y] of reach.values()) {
    for (let sz = 0; sz < C; sz++)
      for (let sx = 0; sx < C; sx++) {
        const x = cx * C + sx, z = cz * C + sz;
        if (occ(x, y + MID, z) || !clearUnder(x, y, z)) continue;
        void sx;
        for (const axis of [0, 1]) {
          const ax = axis === 0 ? 1 : 0, az = axis === 0 ? 0 : 1;
          const { a, b, w } = widthAt(x, y, z, ax, az);
          if (w * VS < 0.75 || w * VS > 1.7) continue;
          // how far the jambs go through (the wall's thickness), then the room must open up on both sides
          const wide = w + Math.round(0.8 / VS);
          let d0 = 0, d1 = 0;
          while (d0 <= maxDepth && widthAt(x - az * (d0 + 1), y, z - ax * (d0 + 1), ax, az).w < wide) d0++;
          while (d1 <= maxDepth && widthAt(x + az * (d1 + 1), y, z + ax * (d1 + 1), ax, az).w < wide) d1++;
          if (d0 > maxDepth || d1 > maxDepth) continue;
          const depth = d0 + d1 + 1;
          if (depth > maxDepth) continue;
          // and there is floor to stand on at both openings (not a gap into a void)
          const fx = az * Math.round(0.9 / VS), fz = ax * Math.round(0.9 / VS);
          if (!occ(x + fx, y - 1, z + fz) || !occ(x - fx, y - 1, z - fz)) continue;
          // the opening's top: first solid above, capped at 2.9 m
          let top = HEAD;
          while (top < Math.round(2.9 / VS) && !occ(x, y + top, z)) top++;
          doorCands.push({ axis, cx: x + ax * ((b - a) / 2), cz: z + az * ((b - a) / 2), dc: (d1 - d0) / 2, w, y, top, depth });
        }
      }
  }
}
// one door per doorway: cluster candidates (same axis, centres within 0.6 m)
const doors = [];
for (const c of doorCands) {
  const px = c.cx + (c.axis === 0 ? 0 : c.dc), pz = c.cz + (c.axis === 0 ? c.dc : 0);
  const near = doors.find((d) => d.axis === c.axis && Math.hypot(d.x - px, d.z - pz) * VS < 0.9);
  if (near) {
    near.n++;
    continue;
  }
  doors.push({ axis: c.axis, x: px, z: pz, y: c.y, w: c.w, top: c.top, depth: c.depth, n: 1 });
}
const doorList = doors.filter((d) => d.n >= 6);
console.log("door candidates", doorCands.length, "doorways", doorList.length);

// ------------------------------------------------------------------ nav nodes
const SP = parseInt(args.spacing ?? "6"); // nav cells between nodes (3 m)
const nodes = [];
const byCell = new Map();
for (const v of reach.values()) {
  const [cx, cz] = v;
  const k = `${Math.floor(cx / SP)},${Math.floor(cz / SP)}`;
  const l = byCell.get(k) ?? [];
  l.push(v);
  byCell.set(k, l);
}
for (const [k, list] of byCell) {
  const [gx, gz] = k.split(",").map(Number);
  const tx = (gx + 0.5) * SP, tz = (gz + 0.5) * SP;
  // split levels: one node per distinct floor height in this block
  const levels = new Map();
  for (const v of list) {
    const lk = Math.round(v[2] / 6);
    const l = levels.get(lk) ?? [];
    l.push(v);
    levels.set(lk, l);
  }
  for (const l of levels.values()) {
    if (l.length < 6) continue; // slivers
    // the cell nearest the block centre that has open floor around it
    let best = null, bd = Infinity;
    for (const v of l) {
      const d = (v[0] - tx) ** 2 + (v[1] - tz) ** 2;
      if (d < bd) { bd = d; best = v; }
    }
    nodes.push({ cx: best[0], cz: best[1], y: best[2] });
  }
}
// cover: an obstacle at crouch height within ~1 m (vertical voxel range 0.5–1.0 m above floor)
for (const n of nodes) {
  const x = n.cx * C + 2, z = n.cz * C + 2;
  let cover = false;
  for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [-1, -1], [1, -1], [-1, 1]]) {
    for (let s = 3; s <= 9 && !cover; s++) {
      let hit = true;
      for (let h = 4; h <= 8; h++) if (!occ(x + dx * s, n.y + h, z + dz * s)) hit = false;
      if (hit) cover = true;
    }
  }
  n.cover = cover;
}
console.log("nav nodes", nodes.length, "cover", nodes.filter((n) => n.cover).length);

// links: voxel line of sight at knee and chest height + floor under the whole segment
function los(ax, ay, az, bx, by, bz) {
  const d = Math.hypot(bx - ax, by - ay, bz - az);
  const n = Math.ceil(d / (VS * 0.5));
  for (let i = 1; i < n; i++) {
    const t = i / n;
    if (occ(Math.floor(ax + (bx - ax) * t), Math.floor(ay + (by - ay) * t), Math.floor(az + (bz - az) * t))) return false;
  }
  return true;
}
const links = [];
const maxD = parseFloat(args.link ?? "9");
for (let i = 0; i < nodes.length; i++)
  for (let j = i + 1; j < nodes.length; j++) {
    const a = nodes[i], b = nodes[j];
    const ax = a.cx * C + 2, az = a.cz * C + 2, bx = b.cx * C + 2, bz = b.cz * C + 2;
    const dm = Math.hypot(ax - bx, az - bz) * VS;
    if (dm > maxD || Math.abs(a.y - b.y) * VS > 1.6) continue;
    if (!los(ax + 0.5, a.y + 4.5, az + 0.5, bx + 0.5, b.y + 4.5, bz + 0.5)) continue;
    if (!los(ax + 0.5, a.y + 11, az + 0.5, bx + 0.5, b.y + 11, bz + 0.5)) continue;
    // walkable all the way: every nav cell along the segment is reachable at a height between the two
    let ok = true;
    const steps = Math.ceil(dm / 0.5);
    for (let s = 1; s < steps && ok; s++) {
      const t = s / steps;
      const cx = Math.round(a.cx + (b.cx - a.cx) * t), cz = Math.round(a.cz + (b.cz - a.cz) * t);
      const y = a.y + (b.y - a.y) * t;
      let found = false;
      for (let dy = -4; dy <= 4 && !found; dy++) if (reach.has(key(cx, cz, Math.round(y) + dy))) found = true;
      if (!found) ok = false;
    }
    if (ok) links.push([i, j]);
  }
console.log("links", links.length);

// ------------------------------------------------------------------ output
const r3 = (v) => Math.round(v * 1000) / 1000;
const toM = (b) => [r3(min[0] + b[0] * VS), r3(min[1] + b[1] * VS), r3(min[2] + b[2] * VS), r3(min[0] + b[3] * VS), r3(min[1] + b[4] * VS), r3(min[2] + b[5] * VS)];
const data = {
  voxel: VS,
  bounds: { minX: min[0], maxX: max[0], minY: min[1], maxY: max[1], minZ: min[2], maxZ: max[2] },
  solid: solidBoxes.flatMap(toM),
  soft: softBoxes.flatMap(toM),
  clip: clipBoxes.flatMap(toM),
  nodes: nodes.map((n) => [r3(wx(n.cx)), r3(wy(n.y)), r3(wz(n.cz)), n.cover ? 1 : 0]),
  links: links.flat(),
  // doorway: centre x, floor y, centre z, axis (0 = the door spans X, 1 = spans Z), width, height, wall depth
  doors: doorList.map((d) => [r3(min[0] + (d.x + 0.5) * VS), r3(wy(d.y)), r3(min[2] + (d.z + 0.5) * VS), d.axis, r3(d.w * VS), r3(d.top * VS), r3(d.depth * VS)]),
};
fs.writeFileSync(out, JSON.stringify(data));
console.log("wrote", out, (fs.statSync(out).size / 1e6).toFixed(2), "MB");

// top-down map: reachable floor coloured by height, other walkable floor dim, nodes as dots
const W = CX, H = CZ;
const img = Buffer.alloc(W * H * 3, 0);
let ylo = Infinity, yhi = -Infinity;
for (const v of reach.values()) { ylo = Math.min(ylo, v[2]); yhi = Math.max(yhi, v[2]); }
for (const [cell, list] of floors) {
  const cx = cell % CX, cz = Math.floor(cell / CX);
  const o = ((H - 1 - cz) * W + cx) * 3; // view from above: +X right, +Z up
  img[o] = img[o + 1] = img[o + 2] = 40;
}
for (const v of reach.values()) {
  const [cx, cz, y] = v;
  const t = (y - ylo) / Math.max(1, yhi - ylo);
  const o = ((H - 1 - cz) * W + cx) * 3;
  img[o] = 60 + 195 * t;
  img[o + 1] = 160;
  img[o + 2] = 255 - 195 * t;
}
for (const n of nodes) {
  const o = ((H - 1 - n.cz) * W + n.cx) * 3;
  img[o] = n.cover ? 255 : 255;
  img[o + 1] = n.cover ? 60 : 255;
  img[o + 2] = n.cover ? 40 : 255;
}
await sharp(img, { raw: { width: W, height: H, channels: 3 } }).resize(W * 2, H * 2, { kernel: "nearest" }).png().toFile(args.png ?? "map.png");
console.log("png", W * 2, H * 2, "x maps to image left→right as -X… (mirrored for a top view)", "y range", wy(ylo).toFixed(2), wy(yhi).toFixed(2));
