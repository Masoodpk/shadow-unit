// Blackridge (the "Residential buildings, ancient villages" scan) → game collision + navigation.
// No dependencies: reads the GLB itself (positions + indices + node matrices).
//   1. rasterise every triangle into a voxel grid (Babylon frame, metres)
//   2. greedy-merge voxels into axis-aligned boxes (movement / bullets / AI rays)
//   3. find walkable floor with head room, flood-fill what's reachable from --seed inside --box
//   4. lay nav nodes on that floor (with cover flags) and link them by voxel line of sight
//   5. invisible clip walls where the playable floor ends
// Writes a top-down PNG (reachable floor coloured by height, nodes as dots) to check the layout.
//
//   node voxel-village.mjs --in=../../src/assets/maps/village.glb --out=../../src/assets/maps/village-data.json \
//        --seed=-120,-70 --box=-150,-95,150,95 --png=village-floor.png
import fs from "node:fs";
import zlib from "node:zlib";

const args = Object.fromEntries(process.argv.slice(2).map((a) => a.replace(/^--/, "").split("=")));
const VS = parseFloat(args.vs ?? "0.25");
const M = (m) => Math.max(1, Math.round(m / VS)); // metres → voxels

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
  if (bv.byteStride && bv.byteStride !== T.BYTES_PER_ELEMENT * NC[a.type]) throw new Error("strided accessor");
  return new T(buf.buffer.slice(buf.byteOffset + off, buf.byteOffset + off + n * T.BYTES_PER_ELEMENT));
}
const mul = (a, b) => {
  const o = new Array(16).fill(0);
  for (let c = 0; c < 4; c++) for (let r = 0; r < 4; r++) for (let k = 0; k < 4; k++) o[c * 4 + r] += a[k * 4 + r] * b[c * 4 + k];
  return o;
};
const I4 = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];
function local(n) {
  if (n.matrix) return n.matrix;
  const [tx, ty, tz] = n.translation ?? [0, 0, 0];
  const [qx, qy, qz, qw] = n.rotation ?? [0, 0, 0, 1];
  const [sx, sy, sz] = n.scale ?? [1, 1, 1];
  return [
    (1 - 2 * (qy * qy + qz * qz)) * sx, 2 * (qx * qy + qz * qw) * sx, 2 * (qx * qz - qy * qw) * sx, 0,
    2 * (qx * qy - qz * qw) * sy, (1 - 2 * (qx * qx + qz * qz)) * sy, 2 * (qy * qz + qx * qw) * sy, 0,
    2 * (qx * qz + qy * qw) * sz, 2 * (qy * qz - qx * qw) * sz, (1 - 2 * (qx * qx + qy * qy)) * sz, 0,
    tx, ty, tz, 1,
  ];
}
const tris = [];
function walk(ni, parent) {
  const n = gltf.nodes[ni];
  const m = mul(parent, local(n));
  if (n.mesh !== undefined) {
    for (const prim of gltf.meshes[n.mesh].primitives) {
      const pos = accessor(prim.attributes.POSITION);
      const P = new Float32Array(pos.length);
      for (let i = 0; i < pos.length; i += 3) {
        const x = pos[i], y = pos[i + 1], z = pos[i + 2];
        // glTF → Babylon (the loader mirrors X)
        P[i] = -(m[0] * x + m[4] * y + m[8] * z + m[12]);
        P[i + 1] = m[1] * x + m[5] * y + m[9] * z + m[13];
        P[i + 2] = m[2] * x + m[6] * y + m[10] * z + m[14];
      }
      const ia = prim.indices !== undefined ? accessor(prim.indices) : Uint32Array.from({ length: pos.length / 3 }, (_, i) => i);
      tris.push({ P, ia });
    }
  }
  for (const c of n.children ?? []) walk(c, m);
}
for (const r of gltf.scenes[gltf.scene ?? 0].nodes) walk(r, I4);

let min = [Infinity, Infinity, Infinity], max = [-Infinity, -Infinity, -Infinity];
for (const t of tris) for (let i = 0; i < t.P.length; i += 3) for (let k = 0; k < 3; k++) {
  min[k] = Math.min(min[k], t.P[i + k]);
  max[k] = Math.max(max[k], t.P[i + k]);
}
min = min.map((v) => Math.floor(v / VS) * VS - VS * 2);
max = max.map((v) => Math.ceil(v / VS) * VS + VS * 12);
const NX = Math.round((max[0] - min[0]) / VS), NY = Math.round((max[1] - min[1]) / VS), NZ = Math.round((max[2] - min[2]) / VS);
console.log("grid", NX, NY, NZ, "=", ((NX * NY * NZ) / 1e6).toFixed(0), "M voxels", "min", min, "max", max);
const N = NX * NY * NZ;
const idx3 = (x, y, z) => (y * NZ + z) * NX + x;
const mk = () => new Uint8Array(Math.ceil(N / 8));
const get = (b, i) => (b[i >> 3] >> (i & 7)) & 1;
const set = (b, i) => (b[i >> 3] |= 1 << (i & 7));
const solid = mk();
let samples = 0;
for (const { P, ia } of tris) {
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
        set(solid, idx3(x, y, z));
        samples++;
      }
  }
}
console.log("samples", samples);
// a scan is a thin shell: fill the ground solid downwards a little (no falling between shell voxels,
// and boxes merge into slabs instead of a carpet of single voxels)
{
  const DOWN = M(1.0);
  for (let z = 0; z < NZ; z++)
    for (let x = 0; x < NX; x++) {
      let below = 0;
      for (let y = NY - 1; y >= 0; y--) {
        const i = idx3(x, y, z);
        if (get(solid, i)) below = DOWN;
        else if (below > 0) {
          // only directly under a surface that has open air above it (ground, not the gap under eaves)
          set(solid, i);
          below--;
        }
      }
    }
}
const occ = (x, y, z) => x >= 0 && y >= 0 && z >= 0 && x < NX && y < NY && z < NZ && get(solid, idx3(x, y, z));

// ------------------------------------------------------------------ walkable floor (0.5 m nav cells)
const C = M(0.5); // voxels per nav cell
const CX = Math.floor(NX / C), CZ = Math.floor(NZ / C);
const HEAD = M(1.8);
const STEP = M(0.5);
const BODY = M(0.35);
const floors = new Map();
for (let cz = 0; cz < CZ; cz++)
  for (let cx = 0; cx < CX; cx++) {
    const x = cx * C + (C >> 1), z = cz * C + (C >> 1);
    const list = [];
    for (let y = 1; y < NY - HEAD; y++) {
      if (!occ(x, y - 1, z) || occ(x, y, z)) continue;
      let ok = true;
      for (let h = 0; h < HEAD && ok; h++) if (occ(x, y + h, z)) ok = false;
      for (let dz = -BODY; dz <= BODY && ok; dz++)
        for (let dx = -BODY; dx <= BODY && ok; dx++) for (let h = STEP + 1; h < HEAD && ok; h++) if (occ(x + dx, y + h, z + dz)) ok = false;
      if (ok) list.push(y);
    }
    if (list.length) floors.set(cz * CX + cx, list);
  }
console.log("walkable cells", floors.size);

const key = (cx, cz, y) => `${cx},${cz},${y}`;
const wy0 = (y) => min[1] + y * VS;
const B = (args.box ?? "-150,-95,150,95").split(",").map(Number);
const inBox = (cx, cz) => {
  const X = min[0] + (cx * C + C / 2) * VS, Z = min[2] + (cz * C + C / 2) * VS;
  return X >= B[0] && X <= B[2] && Z >= B[1] && Z <= B[3];
};
// slope limit: no more than STEP between neighbours (0.5 m per 0.5 m = 45°); --maxy keeps the
// fill on the village floor (the hillsides above it are scenery)
const MAXY = args.maxy !== undefined ? parseFloat(args.maxy) : Infinity;
const reach = new Map();
{
  const [SX, SZ] = args.seed.split(",").map(Number);
  const scx = Math.floor((SX - min[0]) / VS / C), scz = Math.floor((SZ - min[2]) / VS / C);
  const list = floors.get(scz * CX + scx);
  if (!list) throw new Error("seed has no floor");
  // the floor nearest --seedy (default: the highest)
  const SY = args.seedy !== undefined ? (parseFloat(args.seedy) - min[1]) / VS : Infinity;
  const sy = list.reduce((a, b) => (Math.abs(b - SY) < Math.abs(a - SY) ? b : a));
  console.log("seed floors", list.map((y) => wy0(y).toFixed(2)), "→", wy0(sy).toFixed(2));
  const start = [scx, scz, sy];
  const q = [start];
  reach.set(key(...start), start);
  while (q.length) {
    const [cx, cz, y] = q.pop();
    for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const nx = cx + dx, nz = cz + dz;
      if (nx < 0 || nz < 0 || nx >= CX || nz >= CZ || !inBox(nx, nz)) continue;
      const l = floors.get(nz * CX + nx);
      if (!l) continue;
      for (const ny of l) {
        if (Math.abs(ny - y) > STEP || min[1] + ny * VS > MAXY) continue;
        const k = key(nx, nz, ny);
        if (reach.has(k)) continue;
        reach.set(k, [nx, nz, ny]);
        q.push([nx, nz, ny]);
      }
    }
  }
}
if (args.probe) {
  const [x0, z0, x1, z1] = args.probe.split(",").map(Number);
  for (let t = 0; t <= 1.0001; t += 1 / 40) {
    const X = x0 + (x1 - x0) * t, Z = z0 + (z1 - z0) * t;
    const cx = Math.floor((X - min[0]) / VS / C), cz = Math.floor((Z - min[2]) / VS / C);
    const l = floors.get(cz * CX + cx) ?? [];
    // surface column: solid runs
    const x = cx * C + (C >> 1), z = cz * C + (C >> 1);
    const runs = [];
    let inR = false, st = 0;
    for (let y = 0; y < NY; y++) { const o = occ(x, y, z); if (o && !inR) { inR = true; st = y; } if (!o && inR) { inR = false; runs.push(wy0(st).toFixed(2) + ".." + wy0(y).toFixed(2)); } }
    console.log(X.toFixed(1), Z.toFixed(1), "floors", l.map((y) => wy0(y).toFixed(2) + (reach.has(key(cx, cz, y)) ? "*" : "")).join(" "), "| runs", runs.slice(-4).join(" "));
  }
}
console.log("reachable cells", reach.size, "≈", (reach.size * 0.25).toFixed(0), "m²");

const wx = (cx) => min[0] + (cx * C + C / 2) * VS;
const wz = (cz) => min[2] + (cz * C + C / 2) * VS;
const wy = (y) => min[1] + y * VS;

// ------------------------------------------------------------------ boxes: only what the player can touch
{
  const D = M(2);
  const hiM = new Int16Array(CX * CZ).fill(-1);
  const loM = new Int16Array(CX * CZ).fill(32767);
  const DC = Math.ceil(D / C);
  for (const [cx, cz, y] of reach.values())
    for (let dz = -DC; dz <= DC; dz++)
      for (let dx = -DC; dx <= DC; dx++) {
        const nx = cx + dx, nz = cz + dz;
        if (nx < 0 || nz < 0 || nx >= CX || nz >= CZ) continue;
        const i = nz * CX + nx;
        hiM[i] = Math.max(hiM[i], y);
        loM[i] = Math.min(loM[i], y);
      }
  const up = M(parseFloat(args.ceil ?? "6"));
  // --band: keep only what a body bumps into — from knee height over the ground there up to `ceil`
  // (the walkable ground itself becomes a smooth mesh in the game, not boxes)
  // the floor a column's obstacles are measured from: the highest walkable floor in it or right next
  // to it (so the edge of a step up isn't a wall to the ground below it)
  const own = new Int16Array(CX * CZ).fill(-1);
  for (const [cx, cz, y] of reach.values())
    for (let dz = -1; dz <= 1; dz++)
      for (let dx = -1; dx <= 1; dx++) {
        const nx = cx + dx, nz = cz + dz;
        if (nx < 0 || nz < 0 || nx >= CX || nz >= CZ) continue;
        own[nz * CX + nx] = Math.max(own[nz * CX + nx], y);
      }
  const band = !!args.band;
  for (let z = 0; z < NZ; z++)
    for (let x = 0; x < NX; x++) {
      const cx = Math.min(CX - 1, Math.floor(x / C)), cz = Math.min(CZ - 1, Math.floor(z / C));
      const i = cz * CX + cx;
      const ref = own[i] >= 0 ? own[i] : hiM[i];
      const hiY = hiM[i] < 0 ? -1 : (band ? ref : hiM[i]) + up;
      const loY = hiM[i] < 0 ? 1 : band ? ref + M(0.45) : loM[i] - M(1);
      for (let y = 0; y < NY; y++) {
        if (y >= loY && y <= hiY) continue;
        const v = idx3(x, y, z);
        solid[v >> 3] &= ~(1 << (v & 7));
      }
    }
}
function greedy(bits) {
  const used = mk();
  const boxes = [];
  const free = (i) => get(bits, i) && !get(used, i);
  for (let y = 0; y < NY; y++)
    for (let z = 0; z < NZ; z++)
      for (let x = 0; x < NX; x++) {
        const i0 = idx3(x, y, z);
        if (!free(i0)) continue;
        let lx = 1;
        while (x + lx < NX && free(idx3(x + lx, y, z))) lx++;
        let lz = 1;
        grow: while (z + lz < NZ) {
          for (let k = 0; k < lx; k++) if (!free(idx3(x + k, y, z + lz))) break grow;
          lz++;
        }
        let ly = 1;
        growY: while (y + ly < NY) {
          for (let c = 0; c < lz; c++) for (let k = 0; k < lx; k++) if (!free(idx3(x + k, y + ly, z + c))) break growY;
          ly++;
        }
        for (let a = 0; a < ly; a++) for (let c = 0; c < lz; c++) for (let k = 0; k < lx; k++) set(used, idx3(x + k, y + a, z + c));
        boxes.push([x, y, z, x + lx, y + ly, z + lz]);
      }
  return boxes;
}
const solidBoxes = greedy(solid);
console.log("boxes", solidBoxes.length);

// clip walls where the reachable floor stops but the ground goes on (map edge / --box)
const clipBoxes = [];
for (const [cx, cz, y] of reach.values()) {
  for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
    const nx = cx + dx, nz = cz + dz;
    const l = nx >= 0 && nz >= 0 && nx < CX && nz < CZ ? floors.get(nz * CX + nx) : undefined;
    const near = l?.find((ny) => Math.abs(ny - y) <= STEP);
    if (near !== undefined && reach.has(key(nx, nz, near))) continue;
    // an edge: open air (cliff / end of the scan) or walkable but out of bounds — a clip wall
    if (near === undefined && l?.some((ny) => ny > y)) continue; // a real wall is already there
    clipBoxes.push([nx * C, y - M(1), nz * C, nx * C + C, y + M(4), nz * C + C]);
  }
}
console.log("clip cells", clipBoxes.length);

// ------------------------------------------------------------------ nav nodes
const SP = Math.round(parseFloat(args.spacing ?? "4") / 0.5); // nav cells between nodes
const nodes = [];
const byCell = new Map();
for (const v of reach.values()) {
  const k = `${Math.floor(v[0] / SP)},${Math.floor(v[1] / SP)}`;
  const l = byCell.get(k) ?? [];
  l.push(v);
  byCell.set(k, l);
}
for (const [k, list] of byCell) {
  const [gx, gz] = k.split(",").map(Number);
  const tx = (gx + 0.5) * SP, tz = (gz + 0.5) * SP;
  const levels = new Map();
  for (const v of list) {
    const lk = Math.round(v[2] / M(1.5));
    const l = levels.get(lk) ?? [];
    l.push(v);
    levels.set(lk, l);
  }
  for (const l of levels.values()) {
    if (l.length < 6) continue;
    let best = null, bd = Infinity;
    for (const v of l) {
      // prefer open floor: count reachable neighbours
      let open = 0;
      for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [-1, -1], [1, -1], [-1, 1]]) {
        const lst = floors.get((v[1] + dz) * CX + v[0] + dx);
        if (lst?.some((y) => Math.abs(y - v[2]) <= STEP && reach.has(key(v[0] + dx, v[1] + dz, y)))) open++;
      }
      const d = (v[0] - tx) ** 2 + (v[1] - tz) ** 2 + (8 - open) * 4;
      if (d < bd) { bd = d; best = v; }
    }
    nodes.push({ cx: best[0], cz: best[1], y: best[2] });
  }
}
for (const n of nodes) {
  const x = n.cx * C + (C >> 1), z = n.cz * C + (C >> 1);
  let cover = false;
  for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [-1, -1], [1, -1], [-1, 1]]) {
    for (let s = M(0.4); s <= M(1.2) && !cover; s++) {
      let hit = true;
      for (let h = M(0.5); h <= M(1.0); h++) if (!occ(x + dx * s, n.y + h, z + dz * s)) hit = false;
      if (hit) cover = true;
    }
  }
  n.cover = cover;
}
console.log("nav nodes", nodes.length, "cover", nodes.filter((n) => n.cover).length);

function los(ax, ay, az, bx, by, bz) {
  const d = Math.hypot(bx - ax, by - ay, bz - az);
  const n = Math.ceil(d / 0.5);
  for (let i = 1; i < n; i++) {
    const t = i / n;
    if (occ(Math.floor(ax + (bx - ax) * t), Math.floor(ay + (by - ay) * t), Math.floor(az + (bz - az) * t))) return false;
  }
  return true;
}
const links = [];
const maxD = parseFloat(args.link ?? "9");
const nodeGrid = new Map();
nodes.forEach((n, i) => {
  const k = `${Math.floor(n.cx / 20)},${Math.floor(n.cz / 20)}`;
  (nodeGrid.get(k) ?? nodeGrid.set(k, []).get(k)).push(i);
});
for (let i = 0; i < nodes.length; i++) {
  const a = nodes[i];
  const gx = Math.floor(a.cx / 20), gz = Math.floor(a.cz / 20);
  for (let ox = -1; ox <= 1; ox++)
    for (let oz = -1; oz <= 1; oz++)
      for (const j of nodeGrid.get(`${gx + ox},${gz + oz}`) ?? []) {
        if (j <= i) continue;
        const b = nodes[j];
        const ax = a.cx * C + C / 2, az = a.cz * C + C / 2, bx = b.cx * C + C / 2, bz = b.cz * C + C / 2;
        const dm = Math.hypot(ax - bx, az - bz) * VS;
        if (dm > maxD || Math.abs(a.y - b.y) * VS > 2.5) continue;
        if (!los(ax, a.y + M(0.6), az, bx, b.y + M(0.6), bz)) continue;
        if (!los(ax, a.y + M(1.4), az, bx, b.y + M(1.4), bz)) continue;
        let ok = true;
        const steps = Math.ceil(dm / 0.5);
        let prevY = a.y;
        for (let s = 1; s < steps && ok; s++) {
          const t = s / steps;
          const cx = Math.round(a.cx + (b.cx - a.cx) * t), cz = Math.round(a.cz + (b.cz - a.cz) * t);
          const l = floors.get(cz * CX + cx);
          const y = l?.find((yy) => Math.abs(yy - prevY) <= STEP && reach.has(key(cx, cz, yy)));
          if (y === undefined) ok = false;
          else prevY = y;
        }
        if (ok && Math.abs(prevY - b.y) <= STEP) links.push([i, j]);
      }
}
console.log("links", links.length);

// ------------------------------------------------------------------ exact ground heights
// The voxels are coarse (a floor top can sit up to a voxel above the drawn surface): for every
// reachable 0.5 m cell, the height of the drawn ground at its centre, from the triangles themselves.
const HF = new Int16Array(CX * CZ).fill(-32768); // centimetres
{
  const G = new Map(); // triangle buckets per nav cell
  tris.forEach(({ P, ia }, mi) => {
    for (let t = 0; t < ia.length; t += 3) {
      const a = ia[t] * 3, b = ia[t + 1] * 3, c = ia[t + 2] * 3;
      const x0 = Math.min(P[a], P[b], P[c]), x1 = Math.max(P[a], P[b], P[c]);
      const z0 = Math.min(P[a + 2], P[b + 2], P[c + 2]), z1 = Math.max(P[a + 2], P[b + 2], P[c + 2]);
      const cx0 = Math.floor((x0 - min[0]) / VS / C), cx1 = Math.floor((x1 - min[0]) / VS / C);
      const cz0 = Math.floor((z0 - min[2]) / VS / C), cz1 = Math.floor((z1 - min[2]) / VS / C);
      for (let cz = cz0; cz <= cz1; cz++) for (let cx = cx0; cx <= cx1; cx++) {
        const k = cz * CX + cx;
        let l = G.get(k);
        if (!l) G.set(k, (l = []));
        l.push(mi, t);
      }
    }
  });
  let hit = 0;
  for (const [cx, cz, y] of reach.values()) {
    const X = wx(cx), Z = wz(cz), want = wy(y);
    const l = G.get(cz * CX + cx);
    if (!l) continue;
    let best = null;
    for (let i = 0; i < l.length; i += 2) {
      const { P, ia } = tris[l[i]];
      const t = l[i + 1];
      const a = ia[t] * 3, b = ia[t + 1] * 3, c = ia[t + 2] * 3;
      // barycentric in XZ
      const ax = P[a], az = P[a + 2], bx = P[b], bz = P[b + 2], qx = P[c], qz = P[c + 2];
      const d = (bz - qz) * (ax - qx) + (qx - bx) * (az - qz);
      if (Math.abs(d) < 1e-9) continue;
      const u = ((bz - qz) * (X - qx) + (qx - bx) * (Z - qz)) / d;
      const v = ((qz - az) * (X - qx) + (ax - qx) * (Z - qz)) / d;
      if (u < -1e-4 || v < -1e-4 || u + v > 1 + 1e-4) continue;
      const h = u * P[a + 1] + v * P[b + 1] + (1 - u - v) * P[c + 1];
      // the surface this floor voxel stands on: at or just below its top
      if (h > want + 0.1 || h < want - VS * 2.5) continue;
      if (best === null || h > best) best = h;
    }
    if (best !== null) {
      HF[cz * CX + cx] = Math.round(best * 100);
      hit++;
    }
  }
  console.log("exact heights", hit, "of", reach.size);
}

// heightfield of the reachable ground (0.5 m cells, the highest reachable floor): decals, spawning
const r3 = (v) => Math.round(v * 1000) / 1000;
const toM = (b) => [r3(min[0] + b[0] * VS), r3(min[1] + b[1] * VS), r3(min[2] + b[2] * VS), r3(min[0] + b[3] * VS), r3(min[1] + b[4] * VS), r3(min[2] + b[5] * VS)];
const data = {
  voxel: VS,
  bounds: { minX: min[0], maxX: max[0], minY: min[1], maxY: max[1], minZ: min[2], maxZ: max[2] },
  solid: solidBoxes.flatMap(toM),
  soft: [],
  clip: clipBoxes.flatMap(toM),
  nodes: nodes.map((n) => [r3(wx(n.cx)), r3(wy(n.y)), r3(wz(n.cz)), n.cover ? 1 : 0]),
  links: links.flat(),
  doors: [],
  // drawn ground height (cm) per 0.5 m cell over the reachable floor, -32768 = none
  heights: { x0: min[0], z0: min[2], cell: VS * C, w: CX, h: CZ, data: Buffer.from(HF.buffer).toString("base64") },
};
fs.writeFileSync(args.out, JSON.stringify(data));
console.log("wrote", args.out, (fs.statSync(args.out).size / 1e6).toFixed(2), "MB");

// ------------------------------------------------------------------ PNG (no deps)
const W = CX, H = CZ;
const img = Buffer.alloc(W * H * 3, 0);
let ylo = Infinity, yhi = -Infinity;
for (const v of reach.values()) { ylo = Math.min(ylo, v[2]); yhi = Math.max(yhi, v[2]); }
for (const [cell] of floors) {
  const cx = cell % CX, cz = Math.floor(cell / CX);
  const o = ((H - 1 - cz) * W + (W - 1 - cx)) * 3; // top view: +Z up, +X left (Babylon X is mirrored)
  img[o] = img[o + 1] = img[o + 2] = 40;
}
for (const [cx, cz, y] of reach.values()) {
  const t = (y - ylo) / Math.max(1, yhi - ylo);
  const o = ((H - 1 - cz) * W + (W - 1 - cx)) * 3;
  img[o] = 60 + 195 * t;
  img[o + 1] = 160;
  img[o + 2] = 255 - 195 * t;
}
for (const n of nodes) {
  const o = ((H - 1 - n.cz) * W + (W - 1 - n.cx)) * 3;
  img[o] = 255;
  img[o + 1] = n.cover ? 60 : 255;
  img[o + 2] = n.cover ? 40 : 255;
}
// 10 m grid
for (let cz = 0; cz < CZ; cz++) for (let cx = 0; cx < CX; cx++) {
  const X = wx(cx), Z = wz(cz);
  if (Math.abs(X - Math.round(X / 10) * 10) < 0.26 || Math.abs(Z - Math.round(Z / 10) * 10) < 0.26) {
    const o = ((H - 1 - cz) * W + (W - 1 - cx)) * 3;
    img[o] = Math.min(255, img[o] + 50); img[o + 1] = Math.min(255, img[o + 1] + 50); img[o + 2] = Math.min(255, img[o + 2] + 50);
  }
}
function png(w, h, rgb) {
  const raw = Buffer.alloc((w * 3 + 1) * h);
  for (let y = 0; y < h; y++) {
    raw[y * (w * 3 + 1)] = 0;
    rgb.copy(raw, y * (w * 3 + 1) + 1, y * w * 3, (y + 1) * w * 3);
  }
  const crcT = Array.from({ length: 256 }, (_, n) => { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; return c >>> 0; });
  const crc = (b) => { let c = 0xffffffff; for (const x of b) c = crcT[(c ^ x) & 255] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; };
  const chunk = (t, d) => { const l = Buffer.alloc(4); l.writeUInt32BE(d.length); const td = Buffer.concat([Buffer.from(t), d]); const c = Buffer.alloc(4); c.writeUInt32BE(crc(td)); return Buffer.concat([l, td, c]); };
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4); ihdr[8] = 8; ihdr[9] = 2;
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk("IHDR", ihdr), chunk("IDAT", zlib.deflateSync(raw)), chunk("IEND", Buffer.alloc(0))]);
}
fs.writeFileSync(args.png ?? "village-floor.png", png(W, H, img));
console.log("png", W, H, "1 px = 0.5 m; left edge X =", wx(CX - 1).toFixed(1), "top edge Z =", wz(CZ - 1).toFixed(1));
