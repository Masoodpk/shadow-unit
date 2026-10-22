import { Color3 } from "@babylonjs/core/Maths/math.color";
import { Matrix, Vector3 } from "@babylonjs/core/Maths/math.vector";
import { Mesh } from "@babylonjs/core/Meshes/mesh";
import { MeshBuilder } from "@babylonjs/core/Meshes/meshBuilder";
import { PBRMaterial } from "@babylonjs/core/Materials/PBR/pbrMaterial";
import { Ray } from "@babylonjs/core/Culling/ray";
import { Scene } from "@babylonjs/core/scene";
import { TransformNode } from "@babylonjs/core/Meshes/transformNode";
import { HitKind } from "../config/game";
import type { AudioEngine } from "../audio/AudioEngine";
import type { Materials } from "../render/Materials";

export interface Door {
  id: number;
  pivot: TransformNode;
  collider: Mesh;
  /** current / wanted swing (radians, + swings towards the door's local −Z) */
  angle: number;
  target: number;
  /** closed yaw of the pivot */
  baseYaw: number;
  width: number;
  height: number;
  /** door plane normal (local +Z) in the world, and the closed centre */
  normal: Vector3;
  centre: Vector3;
  /** seconds since it last moved (enemies don't fight over a door) */
  since: number;
  /** world → collider-local, refreshed whenever the door moves (AI sight rays use it) */
  inv: Matrix;
  /** leads nowhere you can go (a sealed-off store room, a blocked stairwell): stays shut, no prompt */
  locked: boolean;
}

const OPEN = 1.75; // ~100°
const SPEED = 3.2; // rad/s
const THICK = 0.05;

/**
 * Hinged doors in doorways (detected in the Office's voxel data, declared openings at Kestrel Point).
 * A door is a panel on a hinge pivot with its own collider, so while it's shut it blocks movement,
 * bullets, blasts and — through `blockRay` — the soldiers' sight. It always swings away from
 * whoever opens it; soldiers open doors they walk into, blasts throw them open.
 */
export class Doors {
  readonly list: Door[] = [];
  readonly colliders: Mesh[] = [];
  private ray = new Ray(Vector3.Zero(), Vector3.Forward(), 1);
  private lo = new Vector3();
  private ld = new Vector3();

  constructor(private scene: Scene, private mats: Materials, private audio: AudioEngine) {}

  /** rows: x, floor y, z, axis (0 = spans X, 1 = spans Z), width, height, wall depth */
  build(rows: number[][]) {
    const wood = this.mats.m.wood ?? null;
    const handleMat = new PBRMaterial("doorHandle", this.scene);
    handleMat.albedoColor = new Color3(0.6, 0.58, 0.52);
    handleMat.metallic = 0.9;
    handleMat.roughness = 0.35;
    rows.forEach((r, id) => {
      const [x, y, z, axis, w0, h0] = r;
      const width = Math.max(0.7, w0 - 0.04);
      const height = Math.min(2.6, Math.max(1.9, h0 - 0.03));
      const pivot = new TransformNode(`door${id}`, this.scene);
      // hinge on one jamb; the panel spans local +X from it
      const baseYaw = axis === 0 ? 0 : -Math.PI / 2;
      pivot.rotation.y = baseYaw;
      const hx = axis === 0 ? x - width / 2 : x;
      const hz = axis === 0 ? z : z - width / 2;
      pivot.position.set(hx, y, hz);
      const panel = MeshBuilder.CreateBox(`doorPanel${id}`, { width: width - 0.02, height, depth: THICK }, this.scene);
      panel.parent = pivot;
      panel.position.set(width / 2, height / 2 + 0.01, 0);
      panel.material = wood;
      panel.isPickable = false;
      panel.receiveShadows = true;
      for (const s of [-1, 1]) {
        const handle = MeshBuilder.CreateBox(`doorHandle${id}`, { width: 0.12, height: 0.025, depth: 0.05 }, this.scene);
        handle.parent = pivot;
        handle.position.set(width - 0.12, 1.0, s * (THICK / 2 + 0.03));
        handle.material = handleMat;
        handle.isPickable = false;
      }
      const collider = MeshBuilder.CreateBox(`doorCol${id}`, { width: width - 0.02, height, depth: THICK + 0.03 }, this.scene);
      collider.parent = pivot;
      collider.position.copyFrom(panel.position);
      collider.isVisible = false;
      collider.checkCollisions = true;
      collider.isPickable = true;
      collider.metadata = { kind: HitKind.Level, surface: "wood", door: id };
      pivot.computeWorldMatrix(true);
      // the pivot's local +Z in the world (yaw −90° turns +Z into −X)
      const normal = axis === 0 ? new Vector3(0, 0, 1) : new Vector3(-1, 0, 0);
      const door: Door = { id, pivot, collider, angle: 0, target: 0, baseYaw, width, height, normal, centre: new Vector3(x, y + height / 2, z), since: 99, inv: new Matrix(), locked: false };
      this.refresh(door);
      this.list.push(door);
      this.colliders.push(collider);
    });
    return this.list.length;
  }

  private refresh(d: Door) {
    d.pivot.computeWorldMatrix(true);
    d.collider.computeWorldMatrix(true).invertToRef(d.inv);
  }

  /**
   * Lock every door that only opens onto somewhere you can't go: `reachable(x, y, z, nx, nz)` tells
   * whether the floor on one side of a doorway (outward normal nx, nz) can be walked into.
   */
  seal(reachable: (d: Door, nx: number, nz: number) => boolean) {
    let n = 0;
    for (const d of this.list) {
      d.locked = !reachable(d, d.normal.x, d.normal.z) || !reachable(d, -d.normal.x, -d.normal.z);
      if (d.locked) n++;
    }
    return n;
  }

  /** swing it away from `from` (or shut it if open) */
  toggle(d: Door, from: Vector3) {
    if (d.locked) return;
    if (Math.abs(d.target) > 0.1) this.close(d);
    else this.open(d, from);
  }
  open(d: Door, from: Vector3, fast = false) {
    if (Math.abs(d.target) > 0.1) return;
    const side = Vector3.Dot(from.subtract(d.centre), d.normal);
    // + swings towards local −Z: go away from the side the opener stands on
    d.target = side >= 0 ? OPEN : -OPEN;
    d.since = 0;
    if (fast) d.angle = d.target * 0.6;
    this.audio.play("doorOpen", { x: d.centre.x, y: d.centre.y, z: d.centre.z, volume: 0.7, pitchVar: 0.08 });
  }
  close(d: Door) {
    if (Math.abs(d.target) < 0.1) return;
    d.target = 0;
    d.since = 0;
    this.audio.play("doorOpen", { x: d.centre.x, y: d.centre.y, z: d.centre.z, volume: 0.5, pitchVar: 0.08, rate: 1.15 });
  }

  update(dt: number) {
    for (const d of this.list) {
      d.since += dt;
      if (d.angle === d.target) continue;
      const step = SPEED * dt;
      const before = d.angle;
      d.angle = Math.abs(d.target - d.angle) <= step ? d.target : d.angle + Math.sign(d.target - d.angle) * step;
      d.pivot.rotation.y = d.baseYaw + d.angle;
      this.refresh(d);
      if (d.target === 0 && d.angle === 0 && before !== 0) this.audio.play("doorShut", { x: d.centre.x, y: d.centre.y, z: d.centre.z, volume: 0.75, pitchVar: 0.06 });
    }
  }

  /** the door the player is looking at, within reach */
  lookAt(eye: Vector3, dir: Vector3, reach = 2.4): Door | null {
    this.ray.origin.copyFrom(eye);
    this.ray.direction.copyFrom(dir);
    this.ray.length = reach;
    const hit = this.scene.pickWithRay(this.ray, (m) => m.metadata?.kind === HitKind.Level && m.isPickable, false);
    const id = hit?.pickedMesh?.metadata?.door as number | undefined;
    return id === undefined || this.list[id].locked ? null : this.list[id];
  }

  /** soldiers: open a shut door in front of them */
  openNear(pos: Vector3, dirX: number, dirZ: number) {
    for (const d of this.list) {
      if (d.locked || Math.abs(d.target) > 0.1 || d.since < 1.5) continue;
      const dx = d.centre.x - pos.x, dz = d.centre.z - pos.z;
      const dist = Math.hypot(dx, dz);
      if (dist > 1.9 || Math.abs(d.centre.y - d.height / 2 - (pos.y - 0.9)) > 0.8) continue;
      if (dist > 0.5 && (dx * dirX + dz * dirZ) / dist < 0.3) continue;
      this.open(d, pos);
    }
  }

  /** blasts throw nearby doors open */
  blast(pos: Vector3, radius: number) {
    for (const d of this.list) if (!d.locked && Vector3.Distance(d.centre, pos) < radius * 0.7) {
      d.target = 0;
      this.open(d, pos, true);
    }
  }

  /** sight test for the AI: distance along the ray to the first (mostly) shut door, or -1 */
  blockRay(ox: number, oy: number, oz: number, dx: number, dy: number, dz: number, len: number) {
    let best = -1;
    for (const d of this.list) {
      if (Math.abs(d.angle) > 0.9) continue; // wide open: you see past it
      // cheap reject: the ray's closest approach to the door centre
      const cx = d.centre.x - ox, cy = d.centre.y - oy, cz = d.centre.z - oz;
      const along = Math.max(0, Math.min(len, cx * dx + cy * dy + cz * dz));
      const px = cx - dx * along, py = cy - dy * along, pz = cz - dz * along;
      if (px * px + py * py + pz * pz > (d.width + 0.3) ** 2 + (d.height / 2) ** 2) continue;
      Vector3.TransformCoordinatesFromFloatsToRef(ox, oy, oz, d.inv, this.lo);
      Vector3.TransformNormalFromFloatsToRef(dx, dy, dz, d.inv, this.ld);
      const hx = (d.width - 0.02) / 2, hy = d.height / 2, hz = (THICK + 0.03) / 2;
      let t0 = 0, t1 = len;
      let ok = true;
      for (const [o, v, e] of [
        [this.lo.x, this.ld.x, hx],
        [this.lo.y, this.ld.y, hy],
        [this.lo.z, this.ld.z, hz],
      ]) {
        if (Math.abs(v) < 1e-9) {
          if (o < -e || o > e) ok = false;
        } else {
          let a = (-e - o) / v, b = (e - o) / v;
          if (a > b) [a, b] = [b, a];
          t0 = Math.max(t0, a);
          t1 = Math.min(t1, b);
          if (t0 > t1) ok = false;
        }
        if (!ok) break;
      }
      if (ok && (best < 0 || t0 < best)) best = t0;
    }
    return best;
  }

  reset() {
    for (const d of this.list) {
      d.angle = d.target = 0;
      d.since = 99;
      d.pivot.rotation.y = d.baseYaw;
      this.refresh(d);
    }
  }
}
