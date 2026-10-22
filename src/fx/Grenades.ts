import { Color3 } from "@babylonjs/core/Maths/math.color";
import { Constants } from "@babylonjs/core/Engines/constants";
import { InstancedMesh } from "@babylonjs/core/Meshes/instancedMesh";
import { Mesh } from "@babylonjs/core/Meshes/mesh";
import { MeshBuilder } from "@babylonjs/core/Meshes/meshBuilder";
import { Quaternion, Vector3 } from "@babylonjs/core/Maths/math.vector";
import { Ray } from "@babylonjs/core/Culling/ray";
import { Scene } from "@babylonjs/core/scene";
import { StandardMaterial } from "@babylonjs/core/Materials/standardMaterial";
import { AbstractMesh } from "@babylonjs/core/Meshes/abstractMesh";
import { TransformNode } from "@babylonjs/core/Meshes/transformNode";
import { GRENADE_TYPES, GrenadeType } from "../config/weapons";
import { HitKind } from "../config/game";
import { AudioEngine } from "../audio/AudioEngine";
import { Materials } from "../render/Materials";
import { Effects } from "./Effects";

export interface StuckTarget {
  readonly alive: boolean;
}

interface Live {
  type: GrenadeType;
  mesh: InstancedMesh;
  vel: Vector3;
  spin: Vector3;
  fuse: number;
  age: number;
  resting: boolean;
  stuck: boolean;
  stuckTo: StuckTarget | null;
  normal: Vector3;
  active: boolean;
  hum?: { stop(fade?: number): void };
  /** thrown by a hostile (HUD warning) */
  enemy: boolean;
  /** the soldier who threw it: it leaves his hand without hitting his own arm or chest */
  owner: object | null;
}

export interface Detonation {
  type: GrenadeType;
  pos: Vector3;
  /** surface normal it rested / stuck on (up when in the air) */
  normal: Vector3;
  /** enemy a plasma grenade was stuck to */
  stuckTo: StuckTarget | null;
}

/**
 * Thrown grenades of every type: rigid-body flight (gravity, drag, swept ray
 * collision against level *and* soldiers, restitution, friction, rolling to
 * rest), per-type fuses (timed frag/flash, impact incendiary, sticky plasma
 * that latches onto walls or people), and the hand-off to the game for the
 * detonation (effects, damage, blinding).
 */
export class Grenades {
  private pool: Live[] = [];
  private flare: { mesh: Mesh; t: number };
  private ray = new Ray(Vector3.Zero(), Vector3.Forward(), 1);
  private tmp = new Vector3();
  private step = new Vector3();
  private q = new Quaternion();
  onDetonate?: (d: Detonation) => void;
  /** below this a grenade has left the world (set from the stage's lowest floor) */
  killY = -5;
  /** a window pane in the way: break it (true) and fly on through */
  onGlass?: (mesh: AbstractMesh, point: Vector3, dir: Vector3) => boolean;
  /** the thrower of the grenade being stepped (while it's still leaving his hand) */
  private ignore: object | null = null;
  /** stepping a hostile's grenade: it doesn't bounce off his squad mates (they duck past it) */
  private friendly = false;
  private readonly hitPredicate = (m: AbstractMesh) => {
    const md = m.metadata;
    if (!md) return false;
    if (md.kind === HitKind.Level) return m.isPickable;
    if (md.kind === HitKind.EnemyPart) return !this.friendly && !!md.enemy?.alive && md.enemy !== this.ignore;
    return false;
  };

  constructor(private scene: Scene, templates: Record<GrenadeType, Mesh>, mats: Materials, private fx: Effects, private audio: AudioEngine) {
    for (const type of Object.keys(templates) as GrenadeType[]) {
      const tpl = templates[type];
      tpl.setEnabled(true);
      tpl.isVisible = false;
      tpl.isPickable = false;
      for (let i = 0; i < 3; i++) {
        const m = tpl.createInstance(`${type}Live`);
        m.isPickable = false;
        m.setEnabled(false);
        m.rotationQuaternion = new Quaternion();
        this.pool.push({ type, mesh: m, vel: new Vector3(), spin: new Vector3(), fuse: 0, age: 0, resting: false, stuck: false, stuckTo: null, normal: new Vector3(0, 1, 0), active: false, enemy: false, owner: null });
      }
    }
    // flashbang flare: camera-facing additive disc, very bright and very short
    const mat = new StandardMaterial("flashFlare", scene);
    mat.disableLighting = true;
    mat.emissiveTexture = mats.particle;
    mat.opacityTexture = mats.particle;
    mat.emissiveColor = new Color3(1, 1, 1);
    mat.alphaMode = Constants.ALPHA_ADD;
    mat.disableDepthWrite = true;
    const flare = MeshBuilder.CreatePlane("flashFlare", { size: 1 }, scene);
    flare.material = mat;
    flare.billboardMode = Mesh.BILLBOARDMODE_ALL;
    flare.isPickable = false;
    flare.setEnabled(false);
    this.flare = { mesh: flare, t: 0 };
  }

  /** world positions + type of grenades in flight (minimap) */
  get live(): { pos: Vector3; type: GrenadeType }[] {
    const out: { pos: Vector3; type: GrenadeType }[] = [];
    for (const g of this.pool) if (g.active) out.push({ pos: g.mesh.getAbsolutePosition(), type: g.type });
    return out;
  }

  /** lethal grenades the soldiers can react to (frag on its fuse, plasma once stuck) */
  threats(out: { pos: Vector3; fuse: number; key: object }[] = []) {
    out.length = 0;
    for (const g of this.pool) {
      if (!g.active) continue;
      if (g.type === "frag" || (g.type === "plasma" && g.stuck)) out.push({ pos: g.mesh.getAbsolutePosition(), fuse: g.fuse, key: g });
    }
    return out;
  }
  /** nearest live enemy grenade to a point (player warning) */
  enemyGrenadeNear(p: Vector3, r: number) {
    for (const g of this.pool) if (g.active && g.enemy && Vector3.DistanceSquared(g.mesh.position, p) < r * r) return g.mesh.position;
    return null;
  }

  throw(type: GrenadeType, pos: Vector3, vel: Vector3, enemy = false, owner: object | null = null) {
    const g = this.pool.find((p) => p.type === type && !p.active) ?? this.pool.find((p) => p.type === type)!;
    if (g.active) this.detonate(g);
    g.active = true;
    g.enemy = enemy;
    g.owner = owner;
    g.resting = false;
    g.stuck = false;
    g.stuckTo = null;
    g.age = 0;
    g.fuse = GRENADE_TYPES[type].fuse;
    g.normal.set(0, 1, 0);
    g.vel.copyFrom(vel);
    g.spin.set(8 + Math.random() * 6, (Math.random() - 0.5) * 4, (Math.random() - 0.5) * 6);
    g.mesh.setParent(null);
    g.mesh.position.copyFrom(pos);
    g.mesh.scaling.setAll(1);
    Quaternion.RotationYawPitchRollToRef(Math.random() * 6.28, 0.3, 0, g.mesh.rotationQuaternion!);
    g.mesh.setEnabled(true);
    if (type !== "plasma") this.audio.play("spoon", { x: pos.x, y: pos.y, z: pos.z, volume: 0.45 });
    else g.hum = this.audio.playLoop("plasmaHum", { x: pos.x, y: pos.y, z: pos.z, volume: 0.35 });
  }

  /** would a grenade fly from a to b without hitting the level (walls, doors, props, glass)? */
  clear(a: Vector3, b: Vector3) {
    const d = b.subtract(a);
    const len = d.length();
    if (len < 1e-4) return true;
    this.ray.origin.copyFrom(a);
    this.ray.direction.copyFrom(d.scaleInPlace(1 / len));
    this.ray.length = len;
    this.friendly = true;
    const hit = this.scene.pickWithRay(this.ray, this.hitPredicate, true);
    this.friendly = false;
    return !hit?.hit;
  }

  update(dt: number) {
    for (const g of this.pool) if (g.active) this.simulate(g, dt);
    const f = this.flare;
    if (f.t > 0) {
      f.t -= dt;
      const k = Math.max(0, f.t / 0.22);
      f.mesh.scaling.setAll(1.5 + 7 * (1 - k));
      f.mesh.visibility = k;
      if (f.t <= 0) f.mesh.setEnabled(false);
    }
  }

  private simulate(g: Live, dt: number) {
    g.age += dt;
    const spec = GRENADE_TYPES[g.type];
    // plasma burns from the moment it sticks; give it a hard limit in the air too
    if (!(spec.sticky && !g.stuck && g.age < 3.5)) g.fuse -= dt;
    if (g.type === "plasma" && g.hum) {
      const p = g.mesh.getAbsolutePosition();
      (g.hum as { setPosition?(x: number, y: number, z: number): void }).setPosition?.(p.x, p.y, p.z);
    }
    if (g.fuse <= 0 || (g.stuck && g.stuckTo && !g.stuckTo.alive && g.fuse > 0.25)) {
      if (g.fuse <= 0) {
        this.detonate(g);
        return;
      }
    }
    if (g.resting || g.stuck) return;
    const R = 0.04;
    const sub = 3;
    const h = dt / sub;
    for (let i = 0; i < sub && !g.resting && !g.stuck; i++) {
      g.vel.y -= 9.81 * h;
      g.vel.scaleInPlace(1 - 0.02 * h); // air drag
      this.step.copyFrom(g.vel).scaleInPlace(h);
      const len = this.step.length();
      if (len < 1e-6) continue;
      this.ray.origin.copyFrom(g.mesh.position);
      this.ray.direction.copyFrom(this.step).scaleInPlace(1 / len);
      this.ray.length = len + R;
      this.ignore = g.age < 0.6 ? g.owner : null;
      this.friendly = g.enemy;
      let hit = this.scene.pickWithRay(this.ray, this.hitPredicate, false);
      this.ignore = null;
      this.friendly = false;
      // a window: a thrown grenade goes straight through the pane
      if (hit?.hit && hit.pickedMesh && hit.pickedPoint && hit.pickedMesh.metadata?.glass !== undefined && g.vel.length() > 3 && this.onGlass?.(hit.pickedMesh, hit.pickedPoint, this.ray.direction)) hit = null;
      if (hit?.hit && hit.pickedPoint && hit.pickedMesh) {
        const n = hit.getNormal(true, false) ?? this.tmp.set(0, 1, 0);
        if (Vector3.Dot(n, this.ray.direction) > 0) n.scaleInPlace(-1);
        g.mesh.position.copyFrom(hit.pickedPoint).addInPlace(n.scale(R));
        const vn = Vector3.Dot(g.vel, n);
        const speed = Math.abs(vn);
        const md = hit.pickedMesh.metadata as { kind: number; enemy?: StuckTarget };
        if (spec.sticky) {
          // plasma: latch on, start the countdown
          g.stuck = true;
          g.normal.copyFrom(n);
          if (md.kind === HitKind.EnemyPart && md.enemy) {
            g.stuckTo = md.enemy;
            g.mesh.setParent(hit.pickedMesh as unknown as TransformNode);
          }
          this.audio.play("plasmaStick", { x: hit.pickedPoint.x, y: hit.pickedPoint.y, z: hit.pickedPoint.z, volume: 0.6 });
          break;
        }
        if (spec.impact && g.age > 0.12) {
          g.normal.copyFrom(n);
          g.fuse = 0;
          this.detonate(g);
          return;
        }
        // reflect normal part with restitution, damp the tangential part (friction)
        const normalPart = n.scale(vn);
        const tangent = g.vel.subtract(normalPart).scaleInPlace(0.62);
        g.vel.copyFrom(tangent).addInPlace(normalPart.scaleInPlace(-0.34));
        g.spin.scaleInPlace(0.55);
        if (speed > 1.2 && this.audio.canPlay("nadeBounce", 0.05)) {
          const p = g.mesh.position;
          this.audio.play("grenadeBounce", { x: p.x, y: p.y, z: p.z, volume: Math.min(0.8, 0.2 + speed * 0.08), pitchVar: 0.08, rate: g.type === "frag" ? 0.85 : 1 });
        }
        if (n.y > 0.7 && g.vel.length() < 0.35) {
          g.resting = true;
          g.normal.copyFrom(n);
          // lie on its side
          Quaternion.RotationYawPitchRollToRef(Math.random() * 6.28, Math.PI / 2, 0, g.mesh.rotationQuaternion!);
          g.mesh.position.y = hit.pickedPoint.y + 0.03;
        }
      } else {
        g.mesh.position.addInPlace(this.step);
      }
    }
    if (!g.resting && !g.stuck) {
      Quaternion.RotationYawPitchRollToRef(g.spin.y * dt, g.spin.x * dt, g.spin.z * dt, this.q);
      g.mesh.rotationQuaternion!.multiplyInPlace(this.q);
    }
    // never fall through the world (below the stage's lowest floor)
    if (g.mesh.position.y < this.killY) this.detonate(g);
  }

  private detonate(g: Live) {
    g.active = false;
    g.hum?.stop(0.05);
    g.hum = undefined;
    g.mesh.computeWorldMatrix(true);
    const p = g.mesh.getAbsolutePosition().clone();
    g.mesh.setParent(null);
    g.mesh.setEnabled(false);
    p.addInPlace(g.normal.scale(0.06));
    if (g.type === "flash") {
      this.fx.flashbang(p);
      const f = this.flare;
      f.mesh.position.copyFrom(p);
      f.t = 0.22;
      f.mesh.visibility = 1;
      f.mesh.setEnabled(true);
      this.audio.play("flashBang", { x: p.x, y: p.y, z: p.z, volume: 1.0, reverb: 1 });
    }
    this.onDetonate?.({ type: g.type, pos: p, normal: g.normal.clone(), stuckTo: g.stuckTo });
    g.stuckTo = null;
  }

  warmup(at: Vector3) {
    this.flare.mesh.position.copyFrom(at);
    this.flare.mesh.setEnabled(true);
    this.flare.t = 0.05;
    for (const g of this.pool) {
      g.mesh.position.copyFrom(at);
      g.mesh.setEnabled(true);
    }
  }

  /** hide warm-up instances again */
  settle() {
    for (const g of this.pool) if (!g.active) g.mesh.setEnabled(false);
  }

  reset() {
    for (const g of this.pool) {
      g.active = false;
      g.hum?.stop(0);
      g.hum = undefined;
      g.mesh.setParent(null);
      g.mesh.setEnabled(false);
      g.stuckTo = null;
    }
    this.flare.t = 0;
    this.flare.mesh.setEnabled(false);
  }
}
