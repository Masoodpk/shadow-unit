import { Color3, Color4 } from "@babylonjs/core/Maths/math.color";
import { Mesh } from "@babylonjs/core/Meshes/mesh";
import { ParticleSystem } from "@babylonjs/core/Particles/particleSystem";
import { PBRMaterial } from "@babylonjs/core/Materials/PBR/pbrMaterial";
import { Ray } from "@babylonjs/core/Culling/ray";
import { Scene } from "@babylonjs/core/scene";
import { Vector3 } from "@babylonjs/core/Maths/math.vector";
import { VertexData } from "@babylonjs/core/Meshes/mesh.vertexData";
import { InstancedMesh } from "@babylonjs/core/Meshes/instancedMesh";
import { Quaternion } from "@babylonjs/core/Maths/math.vector";
import { HitKind } from "../config/game";
import type { AudioEngine } from "../audio/AudioEngine";
import type { Materials } from "../render/Materials";

/** a falling piece of glass: thin triangle, ballistic + spin, bounces and settles on the floor */
interface Shard {
  m: InstancedMesh;
  vel: Vector3;
  spin: Vector3;
  floorY: number;
  /** where the floor under it was last measured */
  rayX: number;
  rayZ: number;
  life: number;
  resting: boolean;
  scale: number;
}

interface Pane {
  visual: Mesh;
  collider: Mesh;
  broken: boolean;
  /** broken or not, nobody gets through (bullets do) */
  sealed?: boolean;
  /** the pane's middle (blasts) and its vertices (world): where the shards fall from */
  center: Vector3;
  pts: number[];
  tris: number[];
}

/**
 * Breakable windows. The map's glass is one mesh; it is split into its separate panes
 * (connected pieces), each with its own thin collider that blocks movement and stops a
 * bullet once — the bullet shatters it and carries on. Enemies' shots break glass the same
 * way, so a window never protects one side only.
 */
export class Glass {
  private panes: Pane[] = [];
  private shards: ParticleSystem;
  private pieces: Shard[] = [];
  private pieceIdx = 0;
  private q = new Quaternion();
  private ray = new Ray(Vector3.Zero(), Vector3.Forward(), 1);
  readonly colliders: Mesh[] = [];
  /**
   * Floor height under a point (null = none within reach). Every piece measures its own floor and
   * measures again once it has flown on, so pieces thrown past the sill fall to the ground outside
   * instead of stopping in mid-air at sill height.
   */
  groundAt: (x: number, y: number, z: number, maxDrop: number) => number | null = () => null;

  constructor(private scene: Scene, mats: Materials, private audio: AudioEngine) {
    const ps = new ParticleSystem("glassShards", 160, scene);
    ps.particleTexture = mats.particle;
    ps.emitter = new Vector3(0, -200, 0);
    ps.emitRate = 0;
    // glitter: tiny flecks that catch the light for a moment while falling (not glowing dots)
    ps.color1 = new Color4(0.78, 0.86, 0.9, 0.7);
    ps.color2 = new Color4(0.55, 0.65, 0.7, 0.55);
    ps.colorDead = new Color4(0.55, 0.62, 0.66, 0);
    ps.minSize = 0.012;
    ps.maxSize = 0.035;
    ps.minLifeTime = 0.35;
    ps.maxLifeTime = 0.7;
    ps.gravity = new Vector3(0, -9.8, 0);
    ps.minAngularSpeed = -8;
    ps.maxAngularSpeed = 8;
    ps.blendMode = ParticleSystem.BLENDMODE_STANDARD;
    ps.updateSpeed = 1 / 60;
    ps.start();
    this.shards = ps;

    // shard pieces: a few jagged triangle shapes, instanced
    const shardMat = new PBRMaterial("glassShard", scene);
    shardMat.albedoColor = new Color3(0.5, 0.6, 0.63);
    shardMat.alpha = 0.38;
    shardMat.metallic = 0.15;
    shardMat.roughness = 0.06;
    shardMat.environmentIntensity = 0.9;
    shardMat.backFaceCulling = false;
    shardMat.maxSimultaneousLights = 4;
    const tpls: Mesh[] = [];
    for (let k = 0; k < 5; k++) {
      const m = new Mesh("shardTpl" + k, scene);
      const a = 0.5 + Math.random() * 0.8, b = 0.4 + Math.random() * 0.9;
      const vd = new VertexData();
      vd.positions = [0, 0, 0, a, 0.1 * k, 0, 0.3 * k - 0.2, b, 0, 0.15, -0.3 - 0.2 * Math.random(), 0];
      vd.indices = [0, 1, 2, 0, 3, 1];
      vd.normals = [];
      VertexData.ComputeNormals(vd.positions, vd.indices, vd.normals);
      vd.applyToMesh(m);
      m.material = shardMat;
      m.isPickable = false;
      m.isVisible = false;
      tpls.push(m);
    }
    for (let i = 0; i < 140; i++) {
      const m = tpls[i % tpls.length].createInstance("shard");
      m.isPickable = false;
      m.setEnabled(false);
      m.rotationQuaternion = new Quaternion();
      this.pieces.push({ m, vel: new Vector3(), spin: new Vector3(), floorY: 0, rayX: 0, rayZ: 0, life: 0, resting: true, scale: 0.05 });
    }
  }

  /** fling `n` shards from around `point` (pane centre / size used to spread them over the glass) */
  private spawnPieces(point: Vector3, dir: Vector3, pane: Pane, n: number) {
    const pts = pane.pts, tris = pane.tris;
    const nt = tris.length / 3;
    for (let i = 0; i < n; i++) {
      const p = this.pieces[this.pieceIdx];
      this.pieceIdx = (this.pieceIdx + 1) % this.pieces.length;
      // most pieces burst out of the hole, the rest fall out of the whole frame
      const near = i < n * 0.6;
      const rx = (Math.random() - 0.5) * 2, ry = (Math.random() - 0.5) * 2, rz = (Math.random() - 0.5) * 2;
      // (the rest fall out of the frame: from a random point on one of the glass's own triangles)
      if (near) p.m.position.set(point.x + rx * 0.25, point.y + ry * 0.25, point.z + rz * 0.25);
      else {
        const t = Math.floor(Math.random() * nt) * 3;
        const a = tris[t] * 3, b = tris[t + 1] * 3, c = tris[t + 2] * 3;
        let u = Math.random(), v = Math.random();
        if (u + v > 1) (u = 1 - u), (v = 1 - v);
        const at = (k: number) => pts[a + k] + (pts[b + k] - pts[a + k]) * u + (pts[c + k] - pts[a + k]) * v;
        p.m.position.set(at(0), at(1), at(2));
      }
      const sp = near ? 1.5 + Math.random() * 3.5 : 0.2 + Math.random() * 1.0;
      p.vel.set(dir.x * sp + rx * 1.2, dir.y * sp + Math.random() * 1.4, dir.z * sp + rz * 1.2);
      p.spin.set(rx * 14, ry * 14, rz * 14);
      p.scale = 0.03 + Math.random() * (near ? 0.07 : 0.12);
      p.m.scaling.setAll(p.scale);
      Quaternion.RotationYawPitchRollToRef(Math.random() * 6.3, Math.random() * 6.3, Math.random() * 6.3, p.m.rotationQuaternion!);
      this.measureFloor(p);
      p.life = 0;
      p.resting = false;
      p.m.setEnabled(true);
    }
  }

  private measureFloor(p: Shard) {
    const q = p.m.position;
    let f = this.groundAt(q.x, q.y, q.z, 12);
    if (f === null) {
      // fall back to a pick against the level (stages without box navigation)
      this.ray.origin.set(q.x, q.y + 0.2, q.z);
      this.ray.direction.set(0, -1, 0);
      this.ray.length = 12;
      const fl = this.scene.pickWithRay(this.ray, (m) => m.metadata?.kind === HitKind.Level && m.isPickable && m.metadata?.glass === undefined, false);
      f = fl?.hit && fl.pickedPoint ? fl.pickedPoint.y : null;
    }
    p.floorY = f === null ? -1e9 : f + 0.005;
    p.rayX = q.x;
    p.rayZ = q.z;
  }

  update(dt: number) {
    for (const p of this.pieces) {
      if (!p.m.isEnabled()) continue;
      p.life += dt;
      if (!p.resting) {
        p.vel.y -= 9.8 * dt;
        p.m.position.addInPlaceFromFloats(p.vel.x * dt, p.vel.y * dt, p.vel.z * dt);
        // carried on past the sill / a ledge: the floor below it is somewhere else now
        if (Math.abs(p.m.position.x - p.rayX) + Math.abs(p.m.position.z - p.rayZ) > 0.35) this.measureFloor(p);
        // nothing below at all: let it drop out of sight instead of floating
        if (p.floorY < -1e8 && p.life > 2.5) {
          p.m.setEnabled(false);
          continue;
        }
        Quaternion.RotationYawPitchRollToRef(p.spin.y * dt, p.spin.x * dt, p.spin.z * dt, this.q);
        p.m.rotationQuaternion!.multiplyInPlace(this.q);
        if (p.m.position.y <= p.floorY) {
          p.m.position.y = p.floorY;
          if (Math.abs(p.vel.y) > 1.2) {
            // bounce: lose most of the energy, tinkle
            p.vel.y = -p.vel.y * 0.25;
            p.vel.x *= 0.5;
            p.vel.z *= 0.5;
            p.spin.scaleInPlace(0.4);
            if (Math.random() < 0.15) this.audio.play("casing", { x: p.m.position.x, y: p.m.position.y, z: p.m.position.z, volume: 0.12, rate: 1.8, pitchVar: 0.2 });
          } else {
            // lie flat on the floor
            p.resting = true;
            Quaternion.RotationYawPitchRollToRef(Math.random() * 6.3, Math.PI / 2, 0, p.m.rotationQuaternion!);
          }
        }
      }
      // pieces stay a while, then shrink away
      if (p.life > 14) {
        const k = Math.max(0, 1 - (p.life - 14) / 2);
        p.m.scaling.setAll(p.scale * k);
        if (k <= 0) p.m.setEnabled(false);
      }
    }
  }

  /** split `glass` (world-transformed) into panes; the original mesh is hidden */
  build(glass: Mesh) {
    glass.computeWorldMatrix(true);
    const W = glass.getWorldMatrix();
    const pos = glass.getVerticesData("position")!;
    const nor = glass.getVerticesData("normal");
    const idx = glass.getIndices()!;
    const nv = pos.length / 3;
    // world positions, then union vertices that share a position (weld) and triangles that share a vertex
    const wp = new Float32Array(pos.length);
    const t = new Vector3();
    for (let i = 0; i < nv; i++) {
      Vector3.TransformCoordinatesFromFloatsToRef(pos[i * 3], pos[i * 3 + 1], pos[i * 3 + 2], W, t);
      wp[i * 3] = t.x;
      wp[i * 3 + 1] = t.y;
      wp[i * 3 + 2] = t.z;
    }
    const parent = Array.from({ length: nv }, (_, i) => i);
    const find = (a: number): number => (parent[a] === a ? a : (parent[a] = find(parent[a])));
    const unite = (a: number, b: number) => (parent[find(a)] = find(b));
    const key = new Map<string, number>();
    for (let i = 0; i < nv; i++) {
      const k = `${Math.round(wp[i * 3] * 50)},${Math.round(wp[i * 3 + 1] * 50)},${Math.round(wp[i * 3 + 2] * 50)}`;
      const j = key.get(k);
      if (j === undefined) key.set(k, i);
      else unite(i, j);
    }
    for (let i = 0; i < idx.length; i += 3) {
      unite(idx[i], idx[i + 1]);
      unite(idx[i], idx[i + 2]);
    }
    const groups = new Map<number, number[]>();
    for (let i = 0; i < idx.length; i += 3) {
      const r = find(idx[i]);
      const g = groups.get(r) ?? [];
      g.push(idx[i], idx[i + 1], idx[i + 2]);
      groups.set(r, g);
    }

    // a visible glass: faint blue-grey tint with sky reflections (the map's own is nearly fully transparent)
    const mat = new PBRMaterial("glassPane", this.scene);
    mat.albedoColor = new Color3(0.55, 0.66, 0.7);
    mat.alpha = 0.22;
    mat.metallic = 0.1;
    mat.roughness = 0.05;
    mat.environmentIntensity = 1.2;
    mat.backFaceCulling = false;
    mat.transparencyMode = PBRMaterial.PBRMATERIAL_ALPHABLEND;
    mat.maxSimultaneousLights = 4;

    let n = 0;
    for (const tri of groups.values()) {
      const remap = new Map<number, number>();
      const p: number[] = [];
      const nn: number[] = [];
      const ii: number[] = [];
      let x0 = Infinity, y0 = Infinity, z0 = Infinity, x1 = -Infinity, y1 = -Infinity, z1 = -Infinity;
      for (const v of tri) {
        let m = remap.get(v);
        if (m === undefined) {
          m = p.length / 3;
          remap.set(v, m);
          p.push(wp[v * 3], wp[v * 3 + 1], wp[v * 3 + 2]);
          if (nor) nn.push(nor[v * 3], nor[v * 3 + 1], nor[v * 3 + 2]);
          x0 = Math.min(x0, wp[v * 3]);
          y0 = Math.min(y0, wp[v * 3 + 1]);
          z0 = Math.min(z0, wp[v * 3 + 2]);
          x1 = Math.max(x1, wp[v * 3]);
          y1 = Math.max(y1, wp[v * 3 + 1]);
          z1 = Math.max(z1, wp[v * 3 + 2]);
        }
        ii.push(m);
      }
      const sx = x1 - x0, sy = y1 - y0, sz = z1 - z0;
      if (Math.max(sx, sy, sz) < 0.2) continue; // specks
      const visual = new Mesh(`glassPane${n}`, this.scene);
      const vd = new VertexData();
      vd.positions = p;
      vd.indices = ii;
      if (nn.length) vd.normals = nn;
      else VertexData.ComputeNormals(p, ii, (vd.normals = []));
      vd.applyToMesh(visual);
      visual.material = mat;
      visual.isPickable = false;
      visual.alphaIndex = 10;
      // the collider: the pane's own triangles, not its bounding box — a box round a diagonal or
      // L-shaped window (Black Ledger's lobby) filled the room behind it: a shot at the wall broke the
      // window, and the box stood in the way before it did. (A ray can't slip between triangles, and at
      // a walk the body can't tunnel through them, so it needs no thickness.)
      const collider = new Mesh(`glassCol${n}`, this.scene);
      const cd = new VertexData();
      cd.positions = p.slice();
      cd.indices = ii.slice();
      cd.applyToMesh(collider);
      collider.isVisible = false;
      collider.checkCollisions = true;
      collider.isPickable = true;
      collider.metadata = { kind: HitKind.Level, surface: "glass", glass: n };
      collider.computeWorldMatrix(true);
      this.panes.push({ visual, collider, broken: false, center: new Vector3((x0 + x1) / 2, (y0 + y1) / 2, (z0 + z1) / 2), pts: p, tris: ii });
      this.colliders.push(collider);
      n++;
    }
    glass.setEnabled(false);
    return n;
  }

  /** a bullet / blast hit this collider: shatter the pane (returns false if it wasn't glass) */
  hit(collider: { metadata?: { glass?: number } } | null | undefined, point: Vector3, dir: Vector3) {
    const id = collider?.metadata?.glass;
    if (id === undefined) return false;
    const p = this.panes[id];
    if (!p || p.broken) return false;
    p.broken = true;
    p.visual.setEnabled(false);
    p.collider.isPickable = false;
    // (a sealed pane's collider stays for movement: you can't climb out through it)
    if (!p.sealed) {
      p.collider.setEnabled(false);
      p.collider.checkCollisions = false;
    }
    this.spawnPieces(point, dir, p, 34);
    const ps = this.shards;
    (ps.emitter as Vector3).copyFrom(point);
    ps.minEmitBox.set(-0.4, -0.5, -0.4);
    ps.maxEmitBox.set(0.4, 0.5, 0.4);
    ps.direction1.set(dir.x - 0.6, dir.y - 0.2, dir.z - 0.6);
    ps.direction2.set(dir.x + 0.6, dir.y + 0.8, dir.z + 0.6);
    ps.minEmitPower = 1;
    ps.maxEmitPower = 4;
    ps.manualEmitCount = 90;
    this.audio.play("glassBreak", { x: point.x, y: point.y, z: point.z, volume: 0.9, pitchVar: 0.08 });
    return true;
  }

  /** break every intact pane on the segment (enemy shots) */
  breakAlong(from: Vector3, to: Vector3) {
    const d = to.subtract(from);
    const len = d.length();
    if (len < 0.01 || !this.panes.length) return;
    this.ray.origin.copyFrom(from);
    this.ray.direction.copyFrom(d.scaleInPlace(1 / len));
    this.ray.length = len;
    const hits = this.ray.intersectsMeshes(this.colliders.filter((c) => c.isPickable), false);
    for (const h of hits) if (h.pickedMesh && h.pickedPoint) this.hit(h.pickedMesh as never, h.pickedPoint, this.ray.direction);
  }

  /** blasts shatter nearby panes */
  blast(pos: Vector3, radius: number) {
    for (const p of this.panes) {
      if (p.broken) continue;
      if (Vector3.Distance(p.center, pos) < radius * 0.8) this.hit(p.collider as never, p.center.clone(), p.center.subtract(pos).normalize());
    }
  }

  /** these panes (by their middle, within 0.3 m) keep blocking movement once broken */
  seal(centers: [number, number, number][]) {
    let n = 0;
    for (const p of this.panes)
      if (centers.some(([x, y, z]) => Math.abs(p.center.x - x) < 0.3 && Math.abs(p.center.y - y) < 0.3 && Math.abs(p.center.z - z) < 0.3)) {
        p.sealed = true;
        n++;
      }
    if (n !== centers.length) console.warn(`glass: sealed ${n} of ${centers.length} panes`);
  }

  reset() {
    for (const p of this.panes) {
      p.broken = false;
      p.visual.setEnabled(true);
      p.collider.setEnabled(true);
      p.collider.isPickable = true;
      p.collider.checkCollisions = true;
    }
    this.shards.reset();
    this.shards.manualEmitCount = -1;
    for (const s of this.pieces) s.m.setEnabled(false);
  }
}
