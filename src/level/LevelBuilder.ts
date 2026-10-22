import { Mesh } from "@babylonjs/core/Meshes/mesh";
import { MeshBuilder } from "@babylonjs/core/Meshes/meshBuilder";
import { Scene } from "@babylonjs/core/scene";
import { Vector3, Vector4 } from "@babylonjs/core/Maths/math.vector";
import { VertexData } from "@babylonjs/core/Meshes/mesh.vertexData";
import { HitKind, SurfaceType } from "../config/game";
import { mulberry32 } from "../core/math";
import { Materials, MatKey, TILE } from "../render/Materials";

export interface BoxOpts {
  collide?: boolean; // blocks movement
  pick?: boolean; // blocks bullets / line of sight
  shadow?: boolean;
  rotY?: number;
  rotX?: number;
  rotZ?: number;
  tile?: number;
  surface?: SurfaceType;
  visual?: boolean;
}

export interface Opening {
  a: number;
  b: number;
  bottom: number;
  top: number;
}

const SURFACE: Partial<Record<MatKey, SurfaceType>> = {
  metal: "metal",
  metalDark: "metal",
  rust: "metal",
  containerOrange: "metal",
  containerTeal: "metal",
  containerBone: "metal",
  sand: "dirt",
  rock: "dirt",
  wood: "wood",
};

/**
 * Builds the level from simple primitives, then merges all static visual
 * geometry per material + spatial zone (→ few draw calls but still frustum
 * culled per zone). Collision/picking uses separate invisible boxes: cheap
 * bounding tests, exact flat normals for decals, and visual detail never
 * slows down raycasts.
 */
export class LevelBuilder {
  private buckets = new Map<string, { mat: MatKey; shadow: boolean; meshes: Mesh[] }>();
  readonly colliders: Mesh[] = [];
  readonly merged: Mesh[] = [];
  private n = 0;
  readonly rnd = mulberry32(7);
  /** ground height everything is built on (stages on uneven terrain set it per structure) */
  oy = 0;

  constructor(private scene: Scene, private mats: Materials) {}

  private zoneOf(x: number, z: number) {
    return `${Math.floor((x + 200) / 28)}_${Math.floor((z + 200) / 28)}`;
  }

  addVisual(mesh: Mesh, mat: MatKey, shadow = true, zoneKey?: string) {
    const p = mesh.getAbsolutePosition();
    const key = `${mat}|${zoneKey ?? this.zoneOf(p.x, p.z)}|${shadow ? 1 : 0}`;
    let b = this.buckets.get(key);
    if (!b) {
      b = { mat, shadow, meshes: [] };
      this.buckets.set(key, b);
    }
    b.meshes.push(mesh);
  }

  /** Box with bottom at y. (x,z) = centre. */
  box(x: number, y: number, z: number, w: number, h: number, d: number, mat: MatKey, o: BoxOpts = {}) {
    const tile = o.tile ?? TILE[mat] ?? 3;
    if (o.visual !== false) {
      const uv = (a: number, b: number) => new Vector4(0, 0, a / tile, b / tile);
      const mesh = MeshBuilder.CreateBox(
        "b" + this.n++,
        { width: w, height: h, depth: d, wrap: true, faceUV: [uv(w, h), uv(w, h), uv(d, h), uv(d, h), uv(w, d), uv(w, d)] },
        this.scene,
      );
      mesh.position.set(x, this.oy + y + h / 2, z);
      mesh.rotation.set(o.rotX ?? 0, o.rotY ?? 0, o.rotZ ?? 0);
      this.addVisual(mesh, mat, o.shadow !== false);
    }
    if (o.collide !== false || o.pick) {
      this.collider(x, y, z, w, h, d, { ...o, surface: o.surface ?? SURFACE[mat] ?? "concrete" });
    }
  }

  collider(x: number, y: number, z: number, w: number, h: number, d: number, o: BoxOpts = {}) {
    const c = MeshBuilder.CreateBox("col" + this.n++, { width: w, height: h, depth: d }, this.scene);
    c.position.set(x, this.oy + y + h / 2, z);
    c.rotation.set(o.rotX ?? 0, o.rotY ?? 0, o.rotZ ?? 0);
    c.isVisible = false;
    c.checkCollisions = o.collide !== false;
    c.isPickable = o.pick !== false;
    c.metadata = { kind: HitKind.Level, surface: o.surface ?? "concrete" };
    c.freezeWorldMatrix();
    c.doNotSyncBoundingInfo = true;
    this.colliders.push(c);
    return c;
  }

  /** door openings in walls (floor-level openings ≤ 1.8 m wide), for the door system: x, y, z, axis, width, height, depth */
  readonly doors: number[][] = [];
  private recordDoors(openings: Opening[], axis: 0 | 1, along: number, y: number, t: number) {
    for (const op of openings) {
      const w = op.b - op.a;
      // floor-level, door-sized, and a real doorway (not a blown-out hole with a low top)
      if (op.bottom !== 0 || w > 1.8 || w < 0.7 || op.top < 2.15) continue;
      const c = (op.a + op.b) / 2;
      this.doors.push(axis === 0 ? [c, this.oy + y, along, 0, w, op.top, t] : [along, this.oy + y, c, 1, w, op.top, t]);
    }
  }

  /** Wall along X at z (wall occupies z..z+t if inward = +1, else z-t..z) with openings. */
  wallX(x0: number, x1: number, z: number, y: number, h: number, t: number, mat: MatKey, openings: Opening[] = [], o: BoxOpts = {}) {
    if (y < 0.5) this.recordDoors(openings, 0, z, y, t);
    this.wallRuns(x0, x1, h, openings, (a, b, y0, y1) => this.box((a + b) / 2, y + y0, z, b - a, y1 - y0, t, mat, o));
  }
  wallZ(z0: number, z1: number, x: number, y: number, h: number, t: number, mat: MatKey, openings: Opening[] = [], o: BoxOpts = {}) {
    if (y < 0.5) this.recordDoors(openings, 1, x, y, t);
    this.wallRuns(z0, z1, h, openings, (a, b, y0, y1) => this.box(x, y + y0, (a + b) / 2, t, y1 - y0, b - a, mat, o));
  }
  private wallRuns(s0: number, s1: number, h: number, openings: Opening[], emit: (a: number, b: number, y0: number, y1: number) => void) {
    const ops = [...openings].sort((p, q) => p.a - q.a);
    let cur = s0;
    for (const op of ops) {
      if (op.a > cur) emit(cur, op.a, 0, h);
      if (op.bottom > 0) emit(op.a, op.b, 0, op.bottom);
      if (op.top < h) emit(op.a, op.b, op.top, h);
      cur = op.b;
    }
    if (cur < s1) emit(cur, s1, 0, h);
  }

  /**
   * Rectangular building shell. Exterior faces at x0/x1/z0/z1.
   * openings keyed by side: s (z0), n (z1), w (x0), e (x1).
   */
  building(
    x0: number,
    z0: number,
    x1: number,
    z1: number,
    h: number,
    mat: MatKey,
    sides: { s?: Opening[]; n?: Opening[]; w?: Opening[]; e?: Opening[] },
    opt: { t?: number; roof?: MatKey | null; floor?: MatKey; roofT?: number; trim?: MatKey } = {},
  ) {
    const t = opt.t ?? 0.3;
    this.wallX(x0, x1, z0 + t / 2, 0, h, t, mat, sides.s);
    this.wallX(x0, x1, z1 - t / 2, 0, h, t, mat, sides.n);
    this.wallZ(z0 + t, z1 - t, x0 + t / 2, 0, h, t, mat, sides.w);
    this.wallZ(z0 + t, z1 - t, x1 - t / 2, 0, h, t, mat, sides.e);
    // interior floor 5 cm above the outdoor pads (no shared plane with the ground)
    if (opt.floor) this.box((x0 + x1) / 2, -0.11, (z0 + z1) / 2, x1 - x0 - 2 * t, 0.2, z1 - z0 - 2 * t, opt.floor, { collide: false, pick: false, shadow: false });
    if (opt.roof !== null) {
      const rt = opt.roofT ?? 0.3;
      this.box((x0 + x1) / 2, h, (z0 + z1) / 2, x1 - x0 + 0.2, rt, z1 - z0 + 0.2, opt.roof ?? "concreteDark");
    }
    // base trim strip (grounds the building visually)
    if (opt.trim) {
      this.box((x0 + x1) / 2, 0, z0 - 0.04, x1 - x0 + 0.1, 0.45, 0.08, opt.trim, { collide: false });
      this.box((x0 + x1) / 2, 0, z1 + 0.04, x1 - x0 + 0.1, 0.45, 0.08, opt.trim, { collide: false });
      this.box(x0 - 0.04, 0, (z0 + z1) / 2, 0.08, 0.45, z1 - z0, opt.trim, { collide: false });
      this.box(x1 + 0.04, 0, (z0 + z1) / 2, 0.08, 0.45, z1 - z0, opt.trim, { collide: false });
    }
  }

  /**
   * Steel stairs. Runs from (x,z) along axis/dir for `run` metres rising `rise`.
   * Visual treads + stringers; a single sloped collider makes movement smooth.
   */
  stairs(x: number, z: number, axis: "x" | "z", dir: 1 | -1, run: number, width: number, y0: number, rise: number, mat: MatKey = "metalDark") {
    const n = Math.max(2, Math.round(rise / 0.2));
    const step = run / n;
    for (let i = 0; i < n; i++) {
      const s = (i + 0.5) * step * dir;
      const yy = y0 + ((i + 1) * rise) / n - 0.05;
      if (axis === "z") this.box(x, yy, z + s, width, 0.05, step + 0.02, mat, { collide: false });
      else this.box(x + s, yy, z, step + 0.02, 0.05, width, mat, { collide: false });
    }
    const len = Math.hypot(run, rise);
    const ang = Math.atan2(rise, run);
    const midS = (run / 2) * dir;
    const thick = 0.12;
    const cy = y0 + rise / 2 - thick / 2 / Math.cos(ang);
    for (const side of [-1, 1]) {
      const off = (side * width) / 2;
      if (axis === "z") this.box(x + off, cy - 0.15, z + midS, 0.06, 0.3, len, mat, { collide: false, rotX: -ang * dir });
      else this.box(x + midS, cy - 0.15, z + off, len, 0.3, 0.06, mat, { collide: false, rotZ: ang * dir });
    }
    // Sloped collider: top surface follows the tread nosing line.
    if (axis === "z") this.collider(x, cy - thick / 2, z + midS, width, thick, len, { rotX: -ang * dir, surface: "metal" });
    else this.collider(x + midS, cy - thick / 2, z, len, thick, width, { rotZ: ang * dir, surface: "metal" });
  }

  /** Handrail between two points at floor height y (blocks movement, not bullets). */
  rail(x0: number, z0: number, x1: number, z1: number, y: number, mat: MatKey = "metalDark", shadow = true) {
    const dx = x1 - x0;
    const dz = z1 - z0;
    const L = Math.hypot(dx, dz);
    const rot = Math.atan2(dx, dz);
    const cx = (x0 + x1) / 2;
    const cz = (z0 + z1) / 2;
    this.box(cx, y + 1.0, cz, 0.05, 0.05, L, mat, { rotY: rot, collide: false, shadow });
    this.box(cx, y + 0.5, cz, 0.04, 0.04, L, mat, { rotY: rot, collide: false, shadow });
    const posts = Math.max(2, Math.ceil(L / 1.6) + 1);
    for (let i = 0; i < posts; i++) {
      const t = i / (posts - 1);
      this.box(x0 + dx * t, y, z0 + dz * t, 0.05, 1.02, 0.05, mat, { collide: false, shadow });
    }
    this.collider(cx, y, cz, 0.1, 1.1, L, { rotY: rot, pick: false });
  }

  /** authored models to place (containers, trucks): the box colliders stay here */
  readonly props: { kind: "container" | "containerLow" | "ural" | "truck"; x: number; y: number; z: number; rotY: number; variant?: number; tag?: string }[] = [];
  /** draw containers as the authored models (off = the primitive boxes) */
  propContainers = true;

  /** Standard 20ft container (2.44 × 2.6 × 6.06) with doors and frame. */
  container(x: number, y: number, z: number, rotY: number, mat: "containerOrange" | "containerTeal" | "containerBone", low = false) {
    if (this.propContainers) {
      // authored container model, the collider stays a box; mixed detail: hero models near the lanes
      this.collider(x, y, z, 2.44, 2.59, 6.06, { rotY, surface: "metal" });
      const variant = mat === "containerOrange" ? 0 : mat === "containerTeal" ? 1 : 2;
      this.props.push({ kind: low ? "containerLow" : "container", x, y: this.oy + y, z, rotY, variant: low ? (variant + (this.n % 2)) : variant });
      this.n++;
      return;
    }
    this.box(x, y, z, 2.44, 2.59, 6.06, mat, { rotY, surface: "metal" });
    // frame rails
    const c = Math.cos(rotY);
    const s = Math.sin(rotY);
    const at = (lx: number, lz: number) => [x + lx * c + lz * s, z - lx * s + lz * c];
    for (const [lx, lz] of [
      [-1.2, -3.0],
      [1.2, -3.0],
      [-1.2, 3.0],
      [1.2, 3.0],
    ]) {
      const [px, pz] = at(lx, lz);
      this.box(px, y, pz, 0.14, 2.6, 0.14, "metalDark", { rotY, collide: false });
    }
    const [dx, dz] = at(0, 3.04);
    this.box(dx, y + 0.1, dz, 2.3, 2.4, 0.04, "rust", { rotY, collide: false });
  }

  /** Concrete jersey barrier. */
  barrier(x: number, z: number, rotY: number) {
    this.box(x, 0, z, 0.7, 0.35, 3.0, "concrete", { rotY });
    this.box(x, 0.35, z, 0.36, 0.55, 3.0, "concrete", { rotY, collide: true });
  }

  cylinder(x: number, y: number, z: number, diameter: number, height: number, mat: MatKey, o: { tess?: number; rotX?: number; rotZ?: number; rotY?: number; collide?: boolean; shadow?: boolean } = {}) {
    const m = MeshBuilder.CreateCylinder("c" + this.n++, { diameter, height, tessellation: o.tess ?? 16 }, this.scene);
    // stood on `y`: half its length up when upright, half its diameter when lying on its side
    // (a pipe tipped over by rotX/rotZ)
    const tilt = Math.abs(o.rotZ ?? 0) + Math.abs(o.rotX ?? 0);
    m.position.set(x, this.oy + y + (Math.abs(Math.cos(tilt)) * height + Math.abs(Math.sin(tilt)) * diameter) / 2, z);
    m.rotation.set(o.rotX ?? 0, o.rotY ?? 0, o.rotZ ?? 0);
    this.uvScale(m, (diameter * Math.PI) / (TILE[mat] ?? 3), height / (TILE[mat] ?? 3));
    this.addVisual(m, mat, o.shadow !== false);
    if (o.collide !== false && !o.rotX && !o.rotZ) {
      const w = diameter * 0.86;
      this.collider(x, y, z, w, height, w, { surface: SURFACE[mat] ?? "metal", rotY: Math.PI / 4 });
    }
    return m;
  }

  /** Noise-displaced boulder (decorative backdrop, merged, optional collider). */
  boulder(x: number, y: number, z: number, sx: number, sy: number, sz: number, o: { collide?: boolean; shadow?: boolean; zone?: string; seed?: number; mat?: MatKey } = {}) {
    const m = MeshBuilder.CreateIcoSphere("r" + this.n++, { radius: 1, subdivisions: 2, flat: true }, this.scene);
    const pos = m.getVerticesData("position")!;
    const rnd = mulberry32(o.seed ?? this.n * 13);
    const offs = Array.from({ length: 6 }, () => rnd() * 10);
    for (let i = 0; i < pos.length; i += 3) {
      const px = pos[i];
      const py = pos[i + 1];
      const pz = pos[i + 2];
      const n = 1 + 0.18 * Math.sin(px * 3.1 + offs[0]) * Math.cos(pz * 2.7 + offs[1]) + 0.12 * Math.sin(py * 4.3 + offs[2]);
      pos[i] = px * n * sx;
      pos[i + 1] = py * n * sy * (py < 0 ? 0.6 : 1);
      pos[i + 2] = pz * n * sz;
    }
    m.setVerticesData("position", pos);
    const normals: number[] = [];
    VertexData.ComputeNormals(pos, m.getIndices()!, normals);
    m.setVerticesData("normal", normals);
    this.uvScale(m, Math.max(sx, sz) / 4, sy / 4);
    m.position.set(x, this.oy + y, z);
    m.rotation.y = rnd() * Math.PI * 2;
    this.addVisual(m, o.mat ?? "rock", o.shadow ?? false, o.zone);
    if (o.collide) this.collider(x, y - sy * 0.6, z, sx * 1.3, sy * 1.5, sz * 1.3, { surface: "dirt" });
  }

  /** Flat decal quad lying on a surface (stains, markings). */
  decal(x: number, y: number, z: number, w: number, d: number, rotY: number, mat: MatKey) {
    const m = MeshBuilder.CreateGround("d" + this.n++, { width: w, height: d }, this.scene);
    m.position.set(x, this.oy + y + 0.025, z);
    m.rotation.y = rotY;
    this.addVisual(m, mat, false);
  }

  /** Vertical sign plane facing direction normal (+z rotated by rotY). */
  sign(x: number, y: number, z: number, w: number, h: number, rotY: number, mat: MatKey) {
    const m = MeshBuilder.CreatePlane("s" + this.n++, { width: w, height: h, sideOrientation: Mesh.FRONTSIDE }, this.scene);
    m.position.set(x, this.oy + y, z);
    m.rotation.y = rotY;
    this.addVisual(m, mat, false);
  }

  private uvScale(m: Mesh, su: number, sv: number) {
    const uv = m.getVerticesData("uv");
    if (!uv) return;
    for (let i = 0; i < uv.length; i += 2) {
      uv[i] *= su;
      uv[i + 1] *= sv;
    }
    m.setVerticesData("uv", uv);
  }

  /** Merge buckets; returns shadow casters. */
  finalize(receiveShadows = true) {
    const casters: Mesh[] = [];
    for (const b of this.buckets.values()) {
      if (!b.meshes.length) continue;
      const merged = Mesh.MergeMeshes(b.meshes, true, true, undefined, false, false);
      if (!merged) continue;
      merged.name = "lvl_" + b.mat;
      merged.material = this.mats.m[b.mat];
      merged.isPickable = false;
      merged.checkCollisions = false;
      merged.receiveShadows = receiveShadows && b.mat !== "water";
      merged.freezeWorldMatrix();
      merged.doNotSyncBoundingInfo = true;
      this.merged.push(merged);
      if (b.shadow) casters.push(merged);
    }
    this.buckets.clear();
    return casters;
  }

  static v(x: number, y: number, z: number) {
    return new Vector3(x, y, z);
  }
}
