import { Color3 } from "@babylonjs/core/Maths/math.color";
import { Mesh } from "@babylonjs/core/Meshes/mesh";
import { MeshBuilder } from "@babylonjs/core/Meshes/meshBuilder";
import { Quaternion, Vector3 } from "@babylonjs/core/Maths/math.vector";
import { Scene } from "@babylonjs/core/scene";
import { StandardMaterial } from "@babylonjs/core/Materials/standardMaterial";
import { SpriteStream } from "./SuperFx";

/**
 * The roster heroes' effects (shared, pooled — one set for all of them):
 *  - Lightning: a jagged forked bolt between two points (Thor's strike from the sky, the storm,
 *    the hammer's charge; the Flash's sparks), a white-hot core in a coloured sheath, flickering out;
 *  - Bolts: energy shots in flight — a glowing slug and a short trail of sprites behind it, with a
 *    hit callback when it gets there (photon blasts, element-gun shots, Rocket's rounds).
 * Both are updated every frame from the Game, whoever fired them — a shot fired by a hero who then
 * goes down still flies on and lands (the round-7 Iron Man lesson), and `reset` clears them all.
 */

const V = (x = 0, y = 0, z = 0) => new Vector3(x, y, z);
const rnd = (a: number, b: number) => a + Math.random() * (b - a);

function stand(m: Mesh, a: Vector3, b: Vector3, width: number) {
  const d = b.subtract(a);
  const L = d.length();
  if (L < 1e-4) {
    m.setEnabled(false);
    return;
  }
  m.position.copyFrom(a.add(d.scale(0.5)));
  const dir = d.scale(1 / L);
  const c = Vector3.Dot(Vector3.UpReadOnly, dir);
  if (c > 0.9999) m.rotationQuaternion!.set(0, 0, 0, 1);
  else if (c < -0.9999) m.rotationQuaternion!.set(1, 0, 0, 0);
  else Quaternion.RotationAxisToRef(Vector3.Cross(Vector3.UpReadOnly, dir).normalize(), Math.acos(c), m.rotationQuaternion!);
  m.scaling.set(width, L, width);
}

// ------------------------------------------------------------------ lightning
interface Seg {
  core: Mesh;
  sheath: Mesh;
  mat: StandardMaterial;
  a: Vector3;
  b: Vector3;
  t: number;
  life: number;
  w: number;
}

export class Lightning {
  private segs: Seg[] = [];
  readonly glow: SpriteStream;
  constructor(scene: Scene) {
    const cm = new StandardMaterial("boltCore", scene);
    cm.disableLighting = true;
    cm.emissiveColor = new Color3(1, 1, 1);
    for (let i = 0; i < 110; i++) {
      const core = MeshBuilder.CreateCylinder("boltSegCore" + i, { height: 1, diameter: 0.05, tessellation: 4 }, scene);
      core.material = cm;
      const mat = new StandardMaterial("boltSheath" + i, scene);
      mat.disableLighting = true;
      mat.alphaMode = 1;
      mat.disableDepthWrite = true;
      const sheath = MeshBuilder.CreateCylinder("boltSeg" + i, { height: 1, diameter: 0.22, tessellation: 6 }, scene);
      sheath.material = mat;
      for (const m of [core, sheath]) {
        m.isPickable = false;
        m.rotationQuaternion = new Quaternion();
        m.setEnabled(false);
      }
      this.segs.push({ core, sheath, mat, a: V(), b: V(), t: 1, life: 0, w: 1 });
    }
    this.glow = new SpriteStream(scene, "boltGlow", 220, true);
  }
  private free() {
    return this.segs.find((s) => s.t >= s.life) ?? null;
  }
  /**
   * A forked bolt from `a` to `b`: `jag` metres of sideways wander, `forks` side branches, gone in
   * `life` seconds. Returns nothing; the light flash at the strike point is part of it.
   */
  strike(a: Vector3, b: Vector3, color: Color3, life = 0.28, width = 1, jag = 1, forks = 2) {
    // (a crackle a metre long is two segments; a bolt from the sky up to fourteen)
    const n = Math.max(Vector3.Distance(a, b) < 2 ? 2 : 4, Math.min(14, Math.round(Vector3.Distance(a, b) / 2.2)));
    const d = b.subtract(a);
    const side = Vector3.Cross(d, Math.abs(d.y) > 0.9 * d.length() ? V(1, 0, 0) : V(0, 1, 0)).normalize();
    const side2 = Vector3.Cross(d, side).normalize();
    const pts: Vector3[] = [];
    for (let i = 0; i <= n; i++) {
      const f = i / n;
      const p = a.add(d.scale(f));
      if (i > 0 && i < n) {
        const k = Math.sin(f * Math.PI) * jag;
        p.addInPlace(side.scale(rnd(-k, k))).addInPlace(side2.scale(rnd(-k, k)));
      }
      pts.push(p);
    }
    for (let i = 0; i < n; i++) this.seg(pts[i], pts[i + 1], color, life, width);
    // forks: off a point part-way down, shorter and thinner
    for (let k = 0; k < forks; k++) {
      const i = 1 + Math.floor(Math.random() * (n - 2));
      const from = pts[i];
      const dir = d.normalizeToNew().addInPlace(side.scale(rnd(-1.2, 1.2))).addInPlace(side2.scale(rnd(-1.2, 1.2))).normalize();
      const len = d.length() * rnd(0.12, 0.28);
      let p = from;
      for (let j = 0; j < 3; j++) {
        const q = p.add(dir.scale(len / 3)).addInPlace(side.scale(rnd(-0.4, 0.4) * jag));
        this.seg(p, q, color, life * 0.8, width * 0.5);
        p = q;
      }
    }
    for (let i = 0; i < 6; i++) this.glow.emit(b, V(rnd(-4, 4), rnd(0, 5), rnd(-4, 4)), rnd(0.15, 0.35), rnd(0.25, 0.6) * width, 2.5, new Color3(1, 1, 1), color, 1, 3, 0);
    this.glow.emit(b, V(), 0.25, 2.4 * width, 2, new Color3(1, 1, 1), color, 0.9, 0, 0);
  }
  private seg(a: Vector3, b: Vector3, color: Color3, life: number, w: number) {
    const s = this.free();
    if (!s) return;
    s.a.copyFrom(a);
    s.b.copyFrom(b);
    s.t = 0;
    s.life = life;
    s.w = w;
    s.mat.emissiveColor.copyFrom(color);
    // (the white core only on the big bolts: a thin crackle is all sheath — half the draws)
    s.core.setEnabled(w >= 0.8);
    s.sheath.setEnabled(true);
    if (w >= 0.8) stand(s.core, a, b, w);
    stand(s.sheath, a, b, w);
  }
  update(dt: number) {
    for (const s of this.segs) {
      if (s.t >= s.life) continue;
      s.t += dt;
      if (s.t >= s.life) {
        s.core.setEnabled(false);
        s.sheath.setEnabled(false);
        continue;
      }
      // flicker: on and off, thinning as it goes
      const on = Math.random() > 0.18;
      const f = 1 - s.t / s.life;
      s.core.setEnabled(on && s.w >= 0.8);
      s.sheath.setEnabled(on);
      s.mat.alpha = 0.75 * f;
      s.core.scaling.x = s.core.scaling.z = s.w * (0.5 + 0.5 * f);
    }
    this.glow.update(dt);
  }
  reset() {
    for (const s of this.segs) {
      s.t = s.life = 0;
      s.core.setEnabled(false);
      s.sheath.setEnabled(false);
    }
    this.glow.reset();
  }
}

// ------------------------------------------------------------------ energy shots
interface Shot {
  m: Mesh;
  mat: StandardMaterial;
  p: Vector3;
  v: Vector3;
  to: Vector3;
  t: number;
  dur: number;
  on: boolean;
  c0: Color3;
  c1: Color3;
  size: number;
  hit: (() => void) | null;
}

export class Bolts {
  private shots: Shot[] = [];
  readonly trail: SpriteStream;
  constructor(scene: Scene) {
    for (let i = 0; i < 64; i++) {
      const m = MeshBuilder.CreateCapsule("heroShot" + i, { radius: 0.06, height: 0.7, tessellation: 6, subdivisions: 1 }, scene);
      const mat = new StandardMaterial("heroShotMat" + i, scene);
      mat.disableLighting = true;
      m.material = mat;
      m.isPickable = false;
      m.rotationQuaternion = new Quaternion();
      m.setEnabled(false);
      this.shots.push({ m, mat, p: V(), v: V(), to: V(), t: 0, dur: 0, on: false, c0: new Color3(), c1: new Color3(), size: 1, hit: null });
    }
    this.trail = new SpriteStream(scene, "heroShotTrail", 400, true);
  }
  /** a shot from `from` to `to` at `speed` m/s; `hit` runs when it gets there */
  fire(from: Vector3, to: Vector3, speed: number, core: Color3, glow: Color3, size: number, hit: (() => void) | null) {
    const s = this.shots.find((x) => !x.on) ?? this.shots[0];
    if (s.on) s.hit?.();
    s.on = true;
    s.p.copyFrom(from);
    s.to.copyFrom(to);
    const d = to.subtract(from);
    const L = Math.max(0.01, d.length());
    s.v.copyFrom(d.scale(speed / L));
    s.t = 0;
    s.dur = L / speed;
    s.mat.emissiveColor.copyFrom(core);
    s.c0.copyFrom(core);
    s.c1.copyFrom(glow);
    s.size = size;
    s.hit = hit;
    s.m.scaling.setAll(size);
    s.m.setEnabled(true);
    stand(s.m, from, from.add(d.scale(Math.min(1, (0.7 * size) / L))), size);
  }
  update(dt: number) {
    for (const s of this.shots) {
      if (!s.on) continue;
      s.t += dt;
      const f = Math.min(1, s.t / s.dur);
      const prev = s.p.clone();
      s.p.copyFrom(s.to.subtract(s.v.scale(s.dur * (1 - f))));
      const dir = s.v.normalizeToNew();
      stand(s.m, s.p.subtract(dir.scale(0.35 * s.size)), s.p.add(dir.scale(0.35 * s.size)), s.size);
      s.m.scaling.x = s.m.scaling.z = s.size;
      // a short glowing trail
      for (let k = 0; k < 2; k++) this.trail.emit(Vector3.Lerp(prev, s.p, Math.random()), V(rnd(-0.3, 0.3), rnd(-0.3, 0.3), rnd(-0.3, 0.3)), 0.16, 0.22 * s.size, 0.5, s.c0, s.c1, 0.8, 4, 0);
      if (f >= 1) {
        s.on = false;
        s.m.setEnabled(false);
        // the burst where it lands
        for (let k = 0; k < 5; k++) this.trail.emit(s.p, V(rnd(-3, 3), rnd(0, 3), rnd(-3, 3)), rnd(0.15, 0.3), 0.35 * s.size, 1.5, s.c0, s.c1, 0.9, 3, 0);
        const h = s.hit;
        s.hit = null;
        h?.();
      }
    }
    this.trail.update(dt);
  }
  reset() {
    for (const s of this.shots) {
      s.on = false;
      s.hit = null;
      s.m.setEnabled(false);
    }
    this.trail.reset();
  }
}
