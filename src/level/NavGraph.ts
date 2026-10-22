import { Matrix } from "@babylonjs/core/Maths/math.vector";
import { Mesh } from "@babylonjs/core/Meshes/mesh";
import { Ray } from "@babylonjs/core/Culling/ray";
import { Scene } from "@babylonjs/core/scene";
import { Vector3 } from "@babylonjs/core/Maths/math.vector";
import { HitKind } from "../config/game";

export interface NavNode {
  id: number;
  p: Vector3;
  cover: boolean;
  links: number[];
}

/**
 * Lightweight waypoint graph. Nodes are authored with the level; links are
 * generated automatically using line-of-sight + floor-continuity raycasts at
 * load, plus explicit links for stairs. A* over ~100 nodes costs microseconds.
 */
export class NavGraph {
  nodes: NavNode[] = [];
  private ray = new Ray(Vector3.Zero(), Vector3.Forward(), 1);

  constructor(private scene: Scene) {}

  add(x: number, y: number, z: number, cover = false) {
    const n: NavNode = { id: this.nodes.length, p: new Vector3(x, y, z), cover, links: [] };
    this.nodes.push(n);
    return n.id;
  }

  link(a: number, b: number) {
    const na = this.nodes[a];
    const nb = this.nodes[b];
    if (!na.links.includes(b)) na.links.push(b);
    if (!nb.links.includes(a)) nb.links.push(a);
  }

  // ---- fast analytic ray casts against the level's box colliders (no scene-wide mesh walk)
  private boxInv: Float32Array | null = null;
  private boxHalf: Float32Array | null = null;
  private boxFlags: Uint8Array | null = null;
  private boxBounds: Float32Array | null = null;
  /** register the level colliders (oriented boxes, static) */
  setColliders(colliders: Mesh[]) {
    const n = colliders.length;
    this.boxInv = new Float32Array(n * 16);
    this.boxHalf = new Float32Array(n * 3);
    this.boxFlags = new Uint8Array(n);
    this.boxBounds = new Float32Array(n * 6);
    const m = new Matrix();
    colliders.forEach((c, i) => {
      c.computeWorldMatrix(true);
      c.getWorldMatrix().invertToRef(m);
      this.boxInv!.set(m.asArray(), i * 16);
      const e = c.getBoundingInfo().boundingBox.extendSize;
      this.boxHalf!.set([e.x, e.y, e.z], i * 3);
      this.boxFlags![i] = (c.isPickable ? 1 : 0) | (c.checkCollisions ? 2 : 0);
      const bb = c.getBoundingInfo().boundingBox;
      this.boxBounds!.set([bb.minimumWorld.x, bb.minimumWorld.y, bb.minimumWorld.z, bb.maximumWorld.x, bb.maximumWorld.y, bb.maximumWorld.z], i * 6);
    });
  }
  /**
   * Register axis-aligned boxes directly (large voxel-built levels): `boxes` holds
   * minX,minY,minZ,maxX,maxY,maxZ per box, `flags` 1 = blocks sight/bullets, 2 = blocks movement.
   * A uniform XZ grid makes every ray test only the boxes along its path.
   */
  setBoxes(boxes: Float32Array, flags: Uint8Array, obbs: Mesh[] = []) {
    const nb = flags.length;
    const n = nb + obbs.length;
    this.boxInv = new Float32Array(n * 16);
    this.boxHalf = new Float32Array(n * 3);
    if (obbs.length) {
      // oriented box colliders (built structures) after the axis-aligned voxel boxes
      const f = new Uint8Array(n);
      f.set(flags);
      const b = new Float32Array(n * 6);
      b.set(boxes);
      const m = new Matrix();
      obbs.forEach((c, j) => {
        const i = nb + j;
        c.computeWorldMatrix(true);
        c.getWorldMatrix().invertToRef(m);
        this.boxInv!.set(m.asArray(), i * 16);
        const e = c.getBoundingInfo().boundingBox.extendSize;
        this.boxHalf!.set([e.x, e.y, e.z], i * 3);
        f[i] = (c.isPickable ? 1 : 0) | (c.checkCollisions ? 2 : 0);
        const bb = c.getBoundingInfo().boundingBox;
        b.set([bb.minimumWorld.x, bb.minimumWorld.y, bb.minimumWorld.z, bb.maximumWorld.x, bb.maximumWorld.y, bb.maximumWorld.z], i * 6);
      });
      flags = f;
      boxes = b;
    }
    this.boxFlags = flags;
    this.boxBounds = boxes;
    let x0 = Infinity, z0 = Infinity, x1 = -Infinity, z1 = -Infinity;
    for (let i = 0; i < nb; i++) {
      const b = i * 6;
      const cx = (boxes[b] + boxes[b + 3]) / 2, cy = (boxes[b + 1] + boxes[b + 4]) / 2, cz = (boxes[b + 2] + boxes[b + 5]) / 2;
      // inverse of a pure translation (row-vector layout, like Matrix.asArray())
      const k = i * 16;
      this.boxInv[k] = this.boxInv[k + 5] = this.boxInv[k + 10] = this.boxInv[k + 15] = 1;
      this.boxInv[k + 12] = -cx;
      this.boxInv[k + 13] = -cy;
      this.boxInv[k + 14] = -cz;
      this.boxHalf[i * 3] = (boxes[b + 3] - boxes[b]) / 2;
      this.boxHalf[i * 3 + 1] = (boxes[b + 4] - boxes[b + 1]) / 2;
      this.boxHalf[i * 3 + 2] = (boxes[b + 5] - boxes[b + 2]) / 2;
      x0 = Math.min(x0, boxes[b]);
      z0 = Math.min(z0, boxes[b + 2]);
      x1 = Math.max(x1, boxes[b + 3]);
      z1 = Math.max(z1, boxes[b + 5]);
    }
    for (let i = nb; i < n; i++) {
      const b = i * 6;
      x0 = Math.min(x0, boxes[b]);
      z0 = Math.min(z0, boxes[b + 2]);
      x1 = Math.max(x1, boxes[b + 3]);
      z1 = Math.max(z1, boxes[b + 5]);
    }
    const G = (this.gridSize = 2);
    this.gx0 = x0;
    this.gz0 = z0;
    const gw = (this.gw = Math.max(1, Math.ceil((x1 - x0) / G)));
    const gh = (this.gh = Math.max(1, Math.ceil((z1 - z0) / G)));
    const counts = new Int32Array(gw * gh + 1);
    const span = (i: number, f: (c: number) => void) => {
      const b = i * 6;
      const ax = Math.max(0, Math.floor((boxes[b] - x0) / G)), bx = Math.min(gw - 1, Math.floor((boxes[b + 3] - x0) / G));
      const az = Math.max(0, Math.floor((boxes[b + 2] - z0) / G)), bz = Math.min(gh - 1, Math.floor((boxes[b + 5] - z0) / G));
      for (let z = az; z <= bz; z++) for (let x = ax; x <= bx; x++) f(z * gw + x);
    };
    for (let i = 0; i < n; i++) span(i, (c) => counts[c + 1]++);
    for (let c = 0; c < gw * gh; c++) counts[c + 1] += counts[c];
    const list = new Int32Array(counts[gw * gh]);
    const fill = counts.slice();
    for (let i = 0; i < n; i++) span(i, (c) => (list[fill[c]++] = i));
    this.gridStart = counts;
    this.gridList = list;
    this.stamp = new Uint32Array(n);
  }
  private gridSize = 2;
  private gx0 = 0;
  private gz0 = 0;
  private gw = 0;
  private gh = 0;
  private gridStart: Int32Array | null = null;
  private gridList: Int32Array | null = null;
  private stamp: Uint32Array | null = null;
  private rayId = 0;

  /** grid version of castBoxes: walk the XZ cells the segment crosses (Amanatides–Woo) */
  private castGrid(ox: number, oy: number, oz: number, dx: number, dy: number, dz: number, len: number, mask: number) {
    const G = this.gridSize, gw = this.gw, gh = this.gh;
    const start = this.gridStart!, list = this.gridList!, stamp = this.stamp!;
    const id = ++this.rayId;
    let best = len;
    let hit = false;
    let cx = Math.floor((ox - this.gx0) / G), cz = Math.floor((oz - this.gz0) / G);
    const stepX = dx > 0 ? 1 : -1, stepZ = dz > 0 ? 1 : -1;
    const tdx = Math.abs(dx) > 1e-9 ? G / Math.abs(dx) : Infinity;
    const tdz = Math.abs(dz) > 1e-9 ? G / Math.abs(dz) : Infinity;
    let tmx = Math.abs(dx) > 1e-9 ? ((dx > 0 ? (cx + 1) * G + this.gx0 - ox : ox - (cx * G + this.gx0)) / Math.abs(dx)) : Infinity;
    let tmz = Math.abs(dz) > 1e-9 ? ((dz > 0 ? (cz + 1) * G + this.gz0 - oz : oz - (cz * G + this.gz0)) / Math.abs(dz)) : Infinity;
    let tEnter = 0;
    for (let guard = 0; guard < 4096; guard++) {
      if (tEnter > best) break;
      if (cx >= 0 && cz >= 0 && cx < gw && cz < gh) {
        const c = cz * gw + cx;
        for (let k = start[c], e = start[c + 1]; k < e; k++) {
          const i = list[k];
          if (stamp[i] === id) continue;
          stamp[i] = id;
          const t = this.testBox(i, ox, oy, oz, dx, dy, dz, best, mask);
          if (t >= 0 && t < best) {
            best = t;
            hit = true;
            this.hitBox = i;
          }
        }
      }
      // next cell
      if (tmx < tmz) {
        tEnter = tmx;
        tmx += tdx;
        cx += stepX;
      } else {
        tEnter = tmz;
        tmz += tdz;
        cz += stepZ;
      }
      if (tEnter > len) break;
    }
    return hit ? best : -1;
  }

  /** slab test of one registered box; distance along the ray or -1 */
  private testBox(i: number, ox: number, oy: number, oz: number, dx: number, dy: number, dz: number, maxT: number, mask: number) {
    const fl = this.boxFlags!;
    if ((fl[i] & mask) !== mask) return -1;
    const b = this.boxBounds!;
    const o = i * 6;
    let t0 = 0, t1 = maxT;
    for (let a = 0; a < 3; a++) {
      const p = a === 0 ? ox : a === 1 ? oy : oz;
      const v = a === 0 ? dx : a === 1 ? dy : dz;
      const lo = b[o + a], hi = b[o + 3 + a];
      if (Math.abs(v) < 1e-9) {
        if (p < lo || p > hi) return -1;
      } else {
        let ta = (lo - p) / v, tb = (hi - p) / v;
        if (ta > tb) {
          const s = ta;
          ta = tb;
          tb = s;
        }
        if (ta > t0) t0 = ta;
        if (tb < t1) t1 = tb;
        if (t0 > t1) return -1;
      }
    }
    return t0;
  }

  /** nearest hit distance along the (unit) ray within len, or -1. mask: 1 = pickable, 3 = pickable & solid */
  private castBoxes(ox: number, oy: number, oz: number, dx: number, dy: number, dz: number, len: number, mask: number) {
    if (this.gridStart) return this.castGrid(ox, oy, oz, dx, dy, dz, len, mask);
    const inv = this.boxInv!, half = this.boxHalf!, fl = this.boxFlags!, bb = this.boxBounds!;
    let best = len;
    let hit = false;
    // world AABB of the segment for a cheap reject
    const ex = ox + dx * len, ey = oy + dy * len, ez = oz + dz * len;
    const sx0 = Math.min(ox, ex), sx1 = Math.max(ox, ex), sy0 = Math.min(oy, ey), sy1 = Math.max(oy, ey), sz0 = Math.min(oz, ez), sz1 = Math.max(oz, ez);
    for (let i = 0, n = fl.length; i < n; i++) {
      if ((fl[i] & mask) !== mask) continue;
      const b = i * 6;
      if (bb[b] > sx1 || bb[b + 3] < sx0 || bb[b + 1] > sy1 || bb[b + 4] < sy0 || bb[b + 2] > sz1 || bb[b + 5] < sz0) continue;
      const k = i * 16;
      // row-vector matrices: p' = p * M
      const lx = ox * inv[k] + oy * inv[k + 4] + oz * inv[k + 8] + inv[k + 12];
      const ly = ox * inv[k + 1] + oy * inv[k + 5] + oz * inv[k + 9] + inv[k + 13];
      const lz = ox * inv[k + 2] + oy * inv[k + 6] + oz * inv[k + 10] + inv[k + 14];
      const vx = dx * inv[k] + dy * inv[k + 4] + dz * inv[k + 8];
      const vy = dx * inv[k + 1] + dy * inv[k + 5] + dz * inv[k + 9];
      const vz = dx * inv[k + 2] + dy * inv[k + 6] + dz * inv[k + 10];
      const h = i * 3;
      let t0 = 0, t1 = best;
      // slab test, axis by axis (inlined: this loop runs for every AI ray)
      let o = lx, v = vx, e = half[h];
      if (Math.abs(v) < 1e-9) {
        if (o < -e || o > e) continue;
      } else {
        let a = (-e - o) / v, c = (e - o) / v;
        if (a > c) (o = a), (a = c), (c = o);
        if (a > t0) t0 = a;
        if (c < t1) t1 = c;
        if (t0 > t1) continue;
      }
      (o = ly), (v = vy), (e = half[h + 1]);
      if (Math.abs(v) < 1e-9) {
        if (o < -e || o > e) continue;
      } else {
        let a = (-e - o) / v, c = (e - o) / v;
        if (a > c) (o = a), (a = c), (c = o);
        if (a > t0) t0 = a;
        if (c < t1) t1 = c;
        if (t0 > t1) continue;
      }
      (o = lz), (v = vz), (e = half[h + 2]);
      if (Math.abs(v) < 1e-9) {
        if (o < -e || o > e) continue;
      } else {
        let a = (-e - o) / v, c = (e - o) / v;
        if (a > c) (o = a), (a = c), (c = o);
        if (a > t0) t0 = a;
        if (c < t1) t1 = c;
        if (t0 > t1) continue;
      }
      if (t0 < best) {
        best = t0;
        hit = true;
        this.hitBox = i;
      }
    }
    return hit ? best : -1;
  }

  /** the box the last ray hit */
  private hitBox = -1;
  /**
   * A movement ray that also says what it hit: distance, the point, and the face's outward normal
   * (walls to climb, roof edges to web) — or null.
   */
  moveHit(from: Vector3, to: Vector3, mask = 2) {
    const dx = to.x - from.x, dy = to.y - from.y, dz = to.z - from.z;
    const len = Math.hypot(dx, dy, dz);
    if (len < 1e-4 || !this.boxInv) return null;
    this.hitBox = -1;
    const t = this.castBoxes(from.x, from.y, from.z, dx / len, dy / len, dz / len, len, mask);
    if (t < 0 || this.hitBox < 0) return null;
    const point = new Vector3(from.x + (dx / len) * t, from.y + (dy / len) * t, from.z + (dz / len) * t);
    return { t, point, normal: this.boxNormal(this.hitBox, point), box: this.hitBox };
  }
  /** a registered box's world bounds (min x,y,z, max x,y,z) */
  boxBoundsOf(i: number) {
    const b = this.boxBounds!;
    return [b[i * 6], b[i * 6 + 1], b[i * 6 + 2], b[i * 6 + 3], b[i * 6 + 4], b[i * 6 + 5]];
  }
  get boxCount() {
    return this.boxFlags?.length ?? 0;
  }
  /** the outward normal of box i's face nearest `p` (p on or near its surface) */
  boxNormal(i: number, p: Vector3) {
    const inv = this.boxInv!, half = this.boxHalf!;
    const k = i * 16, h = i * 3;
    // into the box's own frame (row vectors: p' = p * M)
    const l = [
      p.x * inv[k] + p.y * inv[k + 4] + p.z * inv[k + 8] + inv[k + 12],
      p.x * inv[k + 1] + p.y * inv[k + 5] + p.z * inv[k + 9] + inv[k + 13],
      p.x * inv[k + 2] + p.y * inv[k + 6] + p.z * inv[k + 10] + inv[k + 14],
    ];
    let ax = 0, best = -Infinity;
    for (let a = 0; a < 3; a++) {
      const r = Math.abs(l[a]) / Math.max(1e-4, half[h + a]);
      if (r > best) (best = r), (ax = a);
    }
    const nl = [0, 0, 0];
    nl[ax] = Math.sign(l[ax]) || 1;
    // back to the world: the face normal goes through the transpose of the inverse
    const n = new Vector3(
      inv[k] * nl[0] + inv[k + 1] * nl[1] + inv[k + 2] * nl[2],
      inv[k + 4] * nl[0] + inv[k + 5] * nl[1] + inv[k + 6] * nl[2],
      inv[k + 8] * nl[0] + inv[k + 9] * nl[1] + inv[k + 10] * nl[2],
    );
    return n.normalize();
  }

  /** moving blockers the static boxes don't know about (shut doors): distance along the ray or -1 */
  extraBlock?: (ox: number, oy: number, oz: number, dx: number, dy: number, dz: number, len: number) => number;

  /** Level-only ray test. Returns hit distance or -1. */
  rayLevel(from: Vector3, to: Vector3) {
    const d = to.subtract(from);
    const len = d.length();
    if (len < 1e-4) return -1;
    if (this.boxInv) {
      const dx = d.x / len, dy = d.y / len, dz = d.z / len;
      const t = this.castBoxes(from.x, from.y, from.z, dx, dy, dz, len, 1);
      const e = this.extraBlock ? this.extraBlock(from.x, from.y, from.z, dx, dy, dz, t >= 0 ? t : len) : -1;
      return e >= 0 && (t < 0 || e < t) ? e : t;
    }
    this.ray.origin.copyFrom(from);
    this.ray.direction.copyFrom(d.scaleInPlace(1 / len));
    this.ray.length = len;
    const hit = this.scene.pickWithRay(this.ray, (m) => m.metadata?.kind === HitKind.Level && m.isPickable, true);
    return hit?.hit ? hit.distance : -1;
  }

  clear(from: Vector3, to: Vector3) {
    return this.rayLevel(from, to) < 0;
  }

  /**
   * Movement-blocking geometry along a segment — walls, props, and the movement-only volumes
   * (railings, caution tape, clip brushes) that sight rays pass through — plus shut doors.
   * Hit distance or -1.
   */
  moveRay(from: Vector3, to: Vector3, doors = true) {
    const dx = to.x - from.x, dy = to.y - from.y, dz = to.z - from.z;
    const len = Math.hypot(dx, dy, dz);
    if (len < 1e-4 || !this.boxInv) return -1;
    const t = this.castBoxes(from.x, from.y, from.z, dx / len, dy / len, dz / len, len, 2);
    const e = doors && this.extraBlock ? this.extraBlock(from.x, from.y, from.z, dx / len, dy / len, dz / len, t >= 0 ? t : len) : -1;
    return e >= 0 && (t < 0 || e < t) ? e : t;
  }

  /** is this point inside movement-blocking geometry (a wall, a prop)? */
  embedded(x: number, y: number, z: number) {
    return !!this.boxInv && this.castBoxes(x, y, z, 0, 1, 0, 0.02, 2) >= 0;
  }

  /** which box flags count as floor (a stage whose coarse ground boxes only block sight sets 1) */
  floorMask = 3;
  /**
   * Exact drawn-ground height near (x, y, z) where the boxes are only approximate (a scanned stage's
   * 0.5 m voxels), or null to use the boxes.
   */
  groundHeight?: (x: number, y: number, z: number, maxDrop: number) => number | null;

  floorAt(x: number, y: number, z: number, maxDrop = 1.2) {
    if (this.boxInv) {
      const t = this.castBoxes(x, y + 0.5, z, 0, -1, 0, maxDrop + 0.5, this.floorMask);
      const box = t >= 0 ? y + 0.5 - t : null;
      if (this.groundHeight) {
        const g = this.groundHeight(x, y, z, maxDrop);
        // the drawn ground, unless a built floor (a box above it: a platform, a crate) is higher
        if (g !== null && (box === null || box < g + 0.6)) return g;
      }
      return box;
    }
    this.ray.origin.set(x, y + 0.5, z);
    this.ray.direction.set(0, -1, 0);
    this.ray.length = maxDrop + 0.5;
    const hit = this.scene.pickWithRay(this.ray, (m) => m.metadata?.kind === HitKind.Level && m.checkCollisions && m.isPickable, false);
    return hit?.hit && hit.pickedPoint ? hit.pickedPoint.y : null;
  }

  autoLink(maxDist = 17) {
    const up1 = new Vector3(0, 0.55, 0);
    const up2 = new Vector3(0, 1.35, 0);
    const N = this.nodes.length;
    for (let i = 0; i < N; i++)
      for (let j = i + 1; j < N; j++) {
        const a = this.nodes[i].p;
        const b = this.nodes[j].p;
        if (Math.abs(a.y - b.y) > 0.6) continue;
        const dist = Vector3.Distance(a, b);
        if (dist > maxDist) continue;
        if (!this.clear(a.add(up1), b.add(up1)) || !this.clear(a.add(up2), b.add(up2))) continue;
        // floor continuity (no linking across gaps / off roofs)
        let ok = true;
        const steps = Math.max(2, Math.ceil(dist / 2.5));
        for (let s = 1; s < steps && ok; s++) {
          const t = s / steps;
          const y = a.y + (b.y - a.y) * t;
          const fy = this.floorAt(a.x + (b.x - a.x) * t, y, a.z + (b.z - a.z) * t);
          if (fy === null || Math.abs(fy - y) > 0.5) ok = false;
        }
        if (ok) this.link(i, j);
      }
  }

  /** drop every link that crosses the box x0..x1, z0..z1 in plan (grown by `pad`): something solid stands there now */
  cutLinks(x0: number, z0: number, x1: number, z1: number, pad = 0.35) {
    x0 -= pad;
    z0 -= pad;
    x1 += pad;
    z1 += pad;
    const hits = (a: Vector3, c: Vector3) => {
      let t0 = 0, t1 = 1;
      const dx = c.x - a.x, dz = c.z - a.z;
      for (const [p, q] of [[-dx, a.x - x0], [dx, x1 - a.x], [-dz, a.z - z0], [dz, z1 - a.z]]) {
        if (p === 0) {
          if (q < 0) return false;
          continue;
        }
        const r = q / p;
        if (p < 0) {
          if (r > t1) return false;
          t0 = Math.max(t0, r);
        } else {
          if (r < t0) return false;
          t1 = Math.min(t1, r);
        }
      }
      return true;
    };
    for (const n of this.nodes) n.links = n.links.filter((l) => !hits(n.p, this.nodes[l].p));
  }

  nearest(p: Vector3, requireClear = true) {
    let best = -1;
    let bestD = Infinity;
    const eye = p.add(new Vector3(0, 0.6, 0));
    for (const n of this.nodes) {
      const d = Vector3.DistanceSquared(n.p, p) + Math.abs(n.p.y - p.y) * 40;
      if (d < bestD) {
        if (requireClear && !this.clear(eye, n.p.add(new Vector3(0, 0.6, 0)))) continue;
        bestD = d;
        best = n.id;
      }
    }
    return best;
  }

  /** A* returning node positions (excluding start node); `allow` limits which nodes (and links) it may use. */
  path(fromId: number, toId: number, allow?: (id: number) => boolean, allowLink?: (a: number, b: number) => boolean): Vector3[] {
    if (fromId < 0 || toId < 0) return [];
    if (fromId === toId) return [this.nodes[toId].p];
    const N = this.nodes.length;
    const g = new Float32Array(N).fill(Infinity);
    const f = new Float32Array(N).fill(Infinity);
    const came = new Int32Array(N).fill(-1);
    const open = new Set<number>([fromId]);
    const goal = this.nodes[toId].p;
    g[fromId] = 0;
    f[fromId] = Vector3.Distance(this.nodes[fromId].p, goal);
    while (open.size) {
      let cur = -1;
      let bf = Infinity;
      for (const o of open)
        if (f[o] < bf) {
          bf = f[o];
          cur = o;
        }
      if (cur === toId) break;
      open.delete(cur);
      const cn = this.nodes[cur];
      for (const nb of cn.links) {
        if (allow && nb !== toId && !allow(nb)) continue;
        if (allowLink && !allowLink(cur, nb)) continue;
        const tg = g[cur] + Vector3.Distance(cn.p, this.nodes[nb].p);
        if (tg < g[nb]) {
          came[nb] = cur;
          g[nb] = tg;
          f[nb] = tg + Vector3.Distance(this.nodes[nb].p, goal);
          open.add(nb);
        }
      }
    }
    if (came[toId] < 0) return [];
    const out: Vector3[] = [];
    for (let c = toId; c !== fromId; c = came[c]) out.push(this.nodes[c].p);
    return out.reverse();
  }
}
