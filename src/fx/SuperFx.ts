import { Color3 } from "@babylonjs/core/Maths/math.color";
import { DynamicTexture } from "@babylonjs/core/Materials/Textures/dynamicTexture";
import { Mesh } from "@babylonjs/core/Meshes/mesh";
import { MeshBuilder } from "@babylonjs/core/Meshes/meshBuilder";
import { PBRMaterial } from "@babylonjs/core/Materials/PBR/pbrMaterial";
import { Quaternion, Vector3 } from "@babylonjs/core/Maths/math.vector";
import { Scene } from "@babylonjs/core/scene";
import { StandardMaterial } from "@babylonjs/core/Materials/standardMaterial";
import { VertexBuffer } from "@babylonjs/core/Buffers/buffer";
import { VertexData } from "@babylonjs/core/Meshes/mesh.vertexData";

/**
 * Superman's effects (and anything else that wants them):
 *  - SpriteStream: a pool of camera-facing soft sprites in one mesh (one draw call), each with its
 *    own velocity, drag, growth and colour over life — frost breath, vapour, the contrail, smoke;
 *  - IceFx: someone frozen solid — a shell of crystal shards round them, frost on the ground; when
 *    they break out (or are shattered) it bursts into tumbling chunks;
 *  - BeamFx: heat vision — two searing beams (a white core in a red sheath) from the eyes to where
 *    they burn, glowing at both ends;
 *  - ShockRing: a sonic boom — a flat ring of compressed air flung out from him, fading as it grows.
 */

const V = (x = 0, y = 0, z = 0) => new Vector3(x, y, z);

function softTexture(scene: Scene, name: string) {
  const S = 64;
  const t = new DynamicTexture(name, { width: S, height: S }, scene, true);
  const g = t.getContext() as CanvasRenderingContext2D;
  const grad = g.createRadialGradient(S / 2, S / 2, 0, S / 2, S / 2, S / 2);
  grad.addColorStop(0, "rgba(255,255,255,1)");
  grad.addColorStop(0.3, "rgba(255,255,255,0.65)");
  grad.addColorStop(0.7, "rgba(255,255,255,0.18)");
  grad.addColorStop(1, "rgba(255,255,255,0)");
  g.fillStyle = grad;
  g.fillRect(0, 0, S, S);
  t.update();
  t.hasAlpha = true;
  return t;
}

interface Spr {
  p: Vector3;
  v: Vector3;
  life: number;
  max: number;
  size: number;
  grow: number;
  drag: number;
  rise: number;
  c0: Color3;
  c1: Color3;
  a: number;
}

/** soft sprites in one mesh; `additive` for light (fire, beams), alpha-blended for frost and smoke */
export class SpriteStream {
  private mesh: Mesh;
  private pos: Float32Array;
  private col: Float32Array;
  private spr: Spr[] = [];
  private right = V();
  private up = V();
  constructor(private scene: Scene, name: string, private max: number, additive: boolean) {
    this.pos = new Float32Array(max * 12);
    this.col = new Float32Array(max * 16);
    const m = (this.mesh = new Mesh(name, scene));
    const uv = new Float32Array(max * 8);
    const idx: number[] = [];
    for (let i = 0; i < max; i++) {
      uv.set([0, 0, 1, 0, 1, 1, 0, 1], i * 8);
      const k = i * 4;
      idx.push(k, k + 1, k + 2, k, k + 2, k + 3);
    }
    const vd = new VertexData();
    vd.positions = this.pos;
    vd.uvs = uv;
    vd.colors = this.col;
    vd.indices = idx;
    vd.applyToMesh(m, true);
    const mat = new StandardMaterial(name + "Mat", scene);
    const tex = softTexture(scene, name + "Tex");
    mat.disableLighting = true;
    mat.emissiveTexture = tex;
    mat.opacityTexture = tex;
    mat.emissiveColor = new Color3(1, 1, 1);
    mat.alphaMode = additive ? 1 : 2;
    mat.backFaceCulling = false;
    mat.disableDepthWrite = true;
    m.material = mat;
    m.hasVertexAlpha = true;
    m.useVertexColors = true;
    m.isPickable = false;
    m.alwaysSelectAsActiveMesh = true;
    for (let i = 0; i < max; i++) this.spr.push({ p: V(), v: V(), life: 0, max: 1, size: 0.1, grow: 0, drag: 0, rise: 0, c0: new Color3(), c1: new Color3(), a: 1 });
    m.setEnabled(false);
  }
  /** (where the search for a free slot starts: round-robin, not from the front every time) */
  private cursor = 0;
  /** how many quads were written last frame (only those need clearing) */
  private lastQ = 0;
  emit(p: Vector3, v: Vector3, life: number, size: number, grow: number, c0: Color3, c1: Color3, alpha = 1, drag = 2, rise = 0) {
    let s: Spr | null = null;
    for (let k = 0; k < this.max; k++) {
      const x = this.spr[(this.cursor + k) % this.max];
      if (x.life <= 0) {
        s = x;
        this.cursor = (this.cursor + k + 1) % this.max;
        break;
      }
    }
    if (!s) return;
    s.p.copyFrom(p);
    s.v.copyFrom(v);
    s.life = s.max = life;
    s.size = size;
    s.grow = grow;
    s.c0.copyFrom(c0);
    s.c1.copyFrom(c1);
    s.a = alpha;
    s.drag = drag;
    s.rise = rise;
  }
  update(dt: number) {
    const cam = this.scene.activeCamera;
    if (!cam) return;
    const view = cam.getViewMatrix();
    this.right.set(view.m[0], view.m[4], view.m[8]);
    this.up.set(view.m[1], view.m[5], view.m[9]);
    const P = this.pos, C = this.col;
    let q = 0;
    for (const s of this.spr) {
      if (s.life <= 0) continue;
      s.life -= dt;
      if (s.life <= 0) continue;
      s.p.addInPlaceFromFloats(s.v.x * dt, s.v.y * dt, s.v.z * dt);
      s.v.scaleInPlace(Math.exp(-s.drag * dt));
      s.v.y += s.rise * dt;
      const f = 1 - s.life / s.max;
      const size = s.size * (1 + f * s.grow);
      const rx = this.right.x * size, ry = this.right.y * size, rz = this.right.z * size;
      const ux = this.up.x * size, uy = this.up.y * size, uz = this.up.z * size;
      const c = s.p, o = q * 12;
      P[o] = c.x - rx - ux; P[o + 1] = c.y - ry - uy; P[o + 2] = c.z - rz - uz;
      P[o + 3] = c.x + rx - ux; P[o + 4] = c.y + ry - uy; P[o + 5] = c.z + rz - uz;
      P[o + 6] = c.x + rx + ux; P[o + 7] = c.y + ry + uy; P[o + 8] = c.z + rz + uz;
      P[o + 9] = c.x - rx + ux; P[o + 10] = c.y - ry + uy; P[o + 11] = c.z - rz + uz;
      const r = s.c0.r + (s.c1.r - s.c0.r) * f, g = s.c0.g + (s.c1.g - s.c0.g) * f, b = s.c0.b + (s.c1.b - s.c0.b) * f;
      const a = s.a * (f < 0.15 ? f / 0.15 : 1 - (f - 0.15) / 0.85);
      const k = q * 16;
      for (let v = 0; v < 4; v++) {
        C[k + v * 4] = r;
        C[k + v * 4 + 1] = g;
        C[k + v * 4 + 2] = b;
        C[k + v * 4 + 3] = a;
      }
      q++;
    }
    // (only the quads written last frame and not this one are cleared; nothing at all to send when
    // there's nothing alive and nothing was)
    if (q === 0 && this.lastQ === 0) return;
    P.fill(0, q * 12, this.lastQ * 12);
    this.lastQ = q;
    this.mesh.updateVerticesData(VertexBuffer.PositionKind, P, false, false);
    this.mesh.updateVerticesData(VertexBuffer.ColorKind, C, false, false);
    this.mesh.setEnabled(q > 0);
  }
  reset() {
    for (const s of this.spr) s.life = 0;
    this.pos.fill(0);
    this.lastQ = 0;
    this.mesh.setEnabled(false);
  }
}

// ------------------------------------------------------------------ ice
interface Shell {
  key: object;
  at: () => Vector3;
  height: number;
  radius: number;
  still: () => boolean;
  parts: Mesh[];
  t: number;
}
interface Chunk {
  m: Mesh;
  v: Vector3;
  spin: Vector3;
  life: number;
  floor: number;
}

export class IceFx {
  private shells: Shell[] = [];
  private chunks: Chunk[] = [];
  private tpl: Mesh;
  readonly frost: SpriteStream;
  constructor(scene: Scene, private play: (name: string, at: Vector3, vol: number) => void) {
    const m = new PBRMaterial("iceMat", scene);
    m.albedoColor = new Color3(0.72, 0.88, 1);
    m.emissiveColor = new Color3(0.12, 0.22, 0.32);
    m.metallic = 0.05;
    m.roughness = 0.08;
    m.alpha = 0.62;
    m.maxSimultaneousLights = 4;
    m.environmentIntensity = 1.6;
    m.backFaceCulling = false;
    // a crystal: a tall, faceted spike
    this.tpl = MeshBuilder.CreatePolyhedron("iceTpl", { type: 1, size: 0.5 }, scene);
    this.tpl.material = m;
    this.tpl.isPickable = false;
    this.tpl.setEnabled(false);
    this.frost = new SpriteStream(scene, "frostMist", 160, false);
  }
  get frozenCount() {
    return this.shells.length;
  }
  isEncased(key: object) {
    return this.shells.some((s) => s.key === key);
  }
  /** a shell of ice round `key` (its centre followed while `still()` says it's frozen) */
  encase(key: object, at: () => Vector3, height: number, radius: number, still: () => boolean) {
    if (this.isEncased(key)) return;
    const parts: Mesh[] = [];
    const n = 9 + Math.round(height * 3);
    for (let i = 0; i < n; i++) {
      const p = this.tpl.clone("ice", null)!;
      p.setEnabled(true);
      p.rotationQuaternion = Quaternion.RotationYawPitchRoll(Math.random() * 6.28, (Math.random() - 0.5) * 0.7, (Math.random() - 0.5) * 0.7);
      // (spikes round the body: stretched tall, thicker at the base)
      const h = height * (0.35 + Math.random() * 0.4);
      p.scaling.set(radius * (0.7 + Math.random() * 0.5), h, radius * (0.7 + Math.random() * 0.5));
      (p as unknown as { iceOff: Vector3 }).iceOff = V((Math.random() - 0.5) * radius * 1.1, (i / n) * height * 0.75 + h * 0.3, (Math.random() - 0.5) * radius * 1.1);
      p.scaling.scaleInPlace(0.01);
      parts.push(p);
    }
    this.shells.push({ key, at, height, radius, still, parts, t: 0 });
    const c = at();
    this.play("iceFreeze", c, 1);
    for (let i = 0; i < 26; i++) {
      const a = Math.random() * 6.28, r = radius * (0.5 + Math.random());
      this.frost.emit(c.add(V(Math.cos(a) * r, Math.random() * height, Math.sin(a) * r)), V((Math.random() - 0.5), Math.random() * 0.5, (Math.random() - 0.5)), 1.4, 0.35, 1.5, new Color3(0.9, 0.97, 1), new Color3(0.75, 0.88, 1), 0.55, 1.5, 0.2);
    }
  }
  /** shatter now (a frozen soldier's end; someone breaking out) */
  shatter(key: object) {
    const i = this.shells.findIndex((s) => s.key === key);
    if (i < 0) return;
    const s = this.shells[i];
    this.shells.splice(i, 1);
    const c = s.at();
    this.play("iceShatter", c, 1);
    for (const p of s.parts) {
      // each spike breaks into flying chunks
      for (let k = 0; k < 2; k++) {
        const m = k === 0 ? p : this.tpl.clone("iceChunk", null)!;
        m.setEnabled(true);
        m.rotationQuaternion ??= Quaternion.RotationYawPitchRoll(Math.random() * 6, Math.random() * 6, 0);
        if (k === 1) {
          m.position.copyFrom(p.position);
          m.scaling.copyFrom(p.scaling).scaleInPlace(0.5);
        } else m.scaling.scaleInPlace(0.6);
        const out = m.position.subtract(c);
        out.y = 0;
        out.normalize().scaleInPlace(2 + Math.random() * 4);
        out.y = 2 + Math.random() * 4;
        this.chunks.push({ m, v: out, spin: V(Math.random() * 10 - 5, Math.random() * 10 - 5, Math.random() * 10 - 5), life: 1.4 + Math.random() * 0.6, floor: c.y - s.height * 0.5 });
      }
    }
    for (let k = 0; k < 30; k++) this.frost.emit(c.add(V((Math.random() - 0.5) * s.radius * 2, Math.random() * s.height - s.height * 0.4, (Math.random() - 0.5) * s.radius * 2)), V((Math.random() - 0.5) * 4, Math.random() * 3, (Math.random() - 0.5) * 4), 1.0, 0.25, 2, new Color3(1, 1, 1), new Color3(0.8, 0.9, 1), 0.7, 3, -1);
  }
  update(dt: number) {
    for (const s of [...this.shells]) {
      s.t += dt;
      if (!s.still()) {
        this.shatter(s.key);
        continue;
      }
      // (the ice grows over him in a quarter of a second, then holds; mist curls off it)
      const g = Math.min(1, s.t / 0.25);
      const c = s.at();
      for (const p of s.parts) {
        const off = (p as unknown as { iceOff: Vector3 }).iceOff;
        p.position.copyFrom(c).addInPlace(off).addInPlaceFromFloats(0, -s.height * 0.5, 0);
        const full = (p as unknown as { full?: Vector3 }).full ?? ((p as unknown as { full: Vector3 }).full = p.scaling.scale(100));
        p.scaling.copyFrom(full).scaleInPlace(Math.max(0.01, g));
      }
      if (Math.random() < dt * 6) this.frost.emit(c.add(V((Math.random() - 0.5) * s.radius, Math.random() * s.height * 0.6, (Math.random() - 0.5) * s.radius)), V(0, 0.3, 0), 1.6, 0.3, 1.8, new Color3(0.92, 0.97, 1), new Color3(0.8, 0.9, 1), 0.3, 1, 0.1);
    }
    for (const k of [...this.chunks]) {
      k.life -= dt;
      k.v.y -= 18 * dt;
      k.m.position.addInPlace(k.v.scale(dt));
      if (k.m.position.y < k.floor) {
        k.m.position.y = k.floor;
        k.v.y *= -0.3;
        k.v.x *= 0.6;
        k.v.z *= 0.6;
      }
      k.m.rotationQuaternion!.multiplyInPlace(Quaternion.RotationYawPitchRoll(k.spin.y * dt, k.spin.x * dt, k.spin.z * dt));
      if (k.life < 0.4) k.m.scaling.scaleInPlace(Math.max(0, 1 - dt * 5));
      if (k.life <= 0) {
        k.m.dispose();
        this.chunks.splice(this.chunks.indexOf(k), 1);
      }
    }
    this.frost.update(dt);
  }
  reset() {
    for (const s of this.shells) for (const p of s.parts) p.dispose();
    for (const k of this.chunks) k.m.dispose();
    this.shells = [];
    this.chunks = [];
    this.frost.reset();
  }
}

// ------------------------------------------------------------------ heat vision
export class BeamFx {
  private beams: { core: Mesh; sheath: Mesh }[] = [];
  readonly glow: SpriteStream;
  /** (the defaults are Superman's heat vision; other heroes pass their own colours and width) */
  private g0: Color3;
  private g1: Color3;
  constructor(scene: Scene, opts: { name?: string; core?: Color3; sheath?: Color3; width?: number; glow0?: Color3; glow1?: Color3 } = {}) {
    const nm = opts.name ?? "heat";
    this.g0 = opts.glow0 ?? new Color3(1, 0.85, 0.5);
    this.g1 = opts.glow1 ?? new Color3(1, 0.25, 0.05);
    const W = opts.width ?? 1;
    const core = new StandardMaterial(nm + "Core", scene);
    core.disableLighting = true;
    core.emissiveColor = opts.core ?? new Color3(1, 0.95, 0.85);
    const sheath = new StandardMaterial(nm + "Sheath", scene);
    sheath.disableLighting = true;
    sheath.emissiveColor = opts.sheath ?? new Color3(1, 0.12, 0.05);
    sheath.alpha = 0.55;
    sheath.alphaMode = 1;
    sheath.disableDepthWrite = true;
    for (let i = 0; i < 2; i++) {
      const c = MeshBuilder.CreateCylinder(nm + "BeamCore" + i, { height: 1, diameter: 0.025 * W, tessellation: 6 }, scene);
      c.material = core;
      const s = MeshBuilder.CreateCylinder(nm + "BeamSheath" + i, { height: 1, diameter: 0.09 * W, tessellation: 8 }, scene);
      s.material = sheath;
      for (const m of [c, s]) {
        m.isPickable = false;
        m.rotationQuaternion = new Quaternion();
        m.setEnabled(false);
      }
      this.beams.push({ core: c, sheath: s });
    }
    this.glow = new SpriteStream(scene, nm + "Glow", 120, true);
  }
  /** beam `i` from `a` to `b` this frame (or off: a = null) */
  set(i: number, a: Vector3 | null, b?: Vector3) {
    const B = this.beams[i];
    if (!a || !b) {
      B.core.setEnabled(false);
      B.sheath.setEnabled(false);
      return;
    }
    const d = b.subtract(a);
    const L = d.length();
    if (L < 1e-3) return;
    const mid = a.add(d.scale(0.5));
    const dir = d.scale(1 / L);
    const y = Vector3.UpReadOnly;
    const c = Vector3.Dot(y, dir);
    const q = new Quaternion();
    if (c > 0.9999) q.set(0, 0, 0, 1);
    else if (c < -0.9999) q.set(1, 0, 0, 0);
    else Quaternion.RotationAxisToRef(Vector3.Cross(y, dir).normalize(), Math.acos(c), q);
    const flick = 0.8 + Math.random() * 0.45;
    for (const m of [B.core, B.sheath]) {
      m.setEnabled(true);
      m.position.copyFrom(mid);
      m.rotationQuaternion!.copyFrom(q);
      m.scaling.set(flick, L, flick);
    }
    // the glow: at the eye and where it burns
    this.glow.emit(a, V(), 0.05, 0.07, 0.5, new Color3(1, 0.6, 0.4), new Color3(1, 0.2, 0.1), 0.9, 0, 0);
    if (Math.random() < 0.8) this.glow.emit(b, V((Math.random() - 0.5) * 3, Math.random() * 3, (Math.random() - 0.5) * 3), 0.3, 0.18, 2, this.g0, this.g1, 0.9, 2, 1.5);
  }
  update(dt: number) {
    this.glow.update(dt);
  }
  off() {
    this.set(0, null);
    this.set(1, null);
  }
}

// ------------------------------------------------------------------ the sonic boom
export class ShockRing {
  private rings: { m: Mesh; t: number; max: number; size: number }[] = [];
  private mat: StandardMaterial;
  constructor(private scene: Scene) {
    const m = (this.mat = new StandardMaterial("shockMat", scene));
    m.disableLighting = true;
    m.emissiveColor = new Color3(0.95, 0.97, 1);
    m.alpha = 0.5;
    m.alphaMode = 2;
    m.backFaceCulling = false;
    m.disableDepthWrite = true;
  }
  /** a ring at `at`, facing along `dir` (the way he's flying), `size` across at its widest */
  boom(at: Vector3, dir: Vector3, size = 9) {
    const m = MeshBuilder.CreateTorus("shockRing", { diameter: 1, thickness: 0.18, tessellation: 40 }, this.scene);
    m.material = this.mat.clone("shockMatI")!;
    m.isPickable = false;
    m.position.copyFrom(at);
    // the torus lies in XZ: turn its axis (Y) onto the flight
    const y = Vector3.UpReadOnly;
    const d = dir.normalizeToNew();
    const c = Vector3.Dot(y, d);
    m.rotationQuaternion = Math.abs(c) > 0.9999 ? new Quaternion() : Quaternion.RotationAxis(Vector3.Cross(y, d).normalize(), Math.acos(c));
    this.rings.push({ m, t: 0, max: 0.7, size });
  }
  update(dt: number) {
    for (const r of [...this.rings]) {
      r.t += dt;
      const f = r.t / r.max;
      const s = 0.6 + f * r.size;
      r.m.scaling.set(s, s * 0.6, s);
      (r.m.material as StandardMaterial).alpha = 0.55 * (1 - f);
      if (f >= 1) {
        r.m.material?.dispose();
        r.m.dispose();
        this.rings.splice(this.rings.indexOf(r), 1);
      }
    }
  }
  reset() {
    for (const r of this.rings) {
      r.m.material?.dispose();
      r.m.dispose();
    }
    this.rings = [];
  }
}
