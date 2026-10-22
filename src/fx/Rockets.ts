import { Color3, Color4 } from "@babylonjs/core/Maths/math.color";
import { Mesh } from "@babylonjs/core/Meshes/mesh";
import { MeshBuilder } from "@babylonjs/core/Meshes/meshBuilder";
import { ParticleSystem } from "@babylonjs/core/Particles/particleSystem";
import { PBRMaterial } from "@babylonjs/core/Materials/PBR/pbrMaterial";
import { Quaternion, Vector3 } from "@babylonjs/core/Maths/math.vector";
import { Ray } from "@babylonjs/core/Culling/ray";
import { Scene } from "@babylonjs/core/scene";
import { StandardMaterial } from "@babylonjs/core/Materials/standardMaterial";
import { TransformNode } from "@babylonjs/core/Meshes/transformNode";
import { HitKind } from "../config/game";
import { lookRotation } from "../core/math";
import type { ProjectileConfig } from "../config/weapons";
import type { AudioEngine } from "../audio/AudioEngine";
type LoopHandle = ReturnType<AudioEngine["playLoop"]>;
import type { Materials } from "../render/Materials";
import type { EnemyHitTarget } from "../weapons/WeaponManager";

/** What a rocket hit when it went off. */
export interface RocketBlast {
  pos: Vector3;
  normal: Vector3;
  cfg: ProjectileConfig;
  /** soldier it struck directly (gets cfg.direct on top of the blast) */
  direct: EnemyHitTarget | null;
  directPoint: Vector3 | null;
}

interface Rocket {
  node: TransformNode;
  flame: Mesh;
  trail: ParticleSystem;
  pos: Vector3;
  vel: Vector3;
  cfg: ProjectileConfig | null;
  life: number;
  sound: LoopHandle | null;
  /** distance to the listener last step (Doppler) */
  lastDist: number;
}

/**
 * Shoulder-launched rockets. A handful are pooled (model + flame + smoke trail),
 * flown with a swept ray each step against the level and soldier hitboxes, so a
 * fast rocket can never tunnel through a thin wall or a body.
 */
export class Rockets {
  private pool: Rocket[] = [];
  private ray = new Ray(Vector3.Zero(), Vector3.Forward(), 1);
  private step = new Vector3();
  private q = new Quaternion();
  onDetonate?: (b: RocketBlast) => void;
  /** a window in the way: shatter it and fly on (returns true if it was glass) */
  onGlass?: (mesh: unknown, point: Vector3, dir: Vector3) => boolean;
  private readonly predicate = (m: { metadata?: { kind?: number; enemy?: EnemyHitTarget }; isPickable: boolean }) => {
    const md = m.metadata;
    if (!md) return false;
    if (md.kind === HitKind.Level) return m.isPickable;
    if (md.kind === HitKind.EnemyPart) return !!md.enemy?.alive;
    return false;
  };

  constructor(private scene: Scene, mats: Materials, private audio: AudioEngine) {
    const body = new PBRMaterial("rocketBody", scene);
    body.albedoColor = new Color3(0.23, 0.26, 0.2);
    body.metallic = 0.3;
    body.roughness = 0.55;
    body.maxSimultaneousLights = 4;
    const tip = new PBRMaterial("rocketTip", scene);
    tip.albedoColor = new Color3(0.55, 0.5, 0.32);
    tip.metallic = 0.6;
    tip.roughness = 0.4;
    const flameMat = new StandardMaterial("rocketFlame", scene);
    flameMat.disableLighting = true;
    flameMat.emissiveColor = new Color3(1.0, 0.62, 0.22).scale(3);
    flameMat.alpha = 0.85;
    flameMat.backFaceCulling = false;

    // template: body along +Z, nose at +Z, fins at the tail
    const parts: Mesh[] = [];
    const b = MeshBuilder.CreateCylinder("rkBody", { height: 0.5, diameter: 0.066, tessellation: 12 }, scene);
    b.rotation.x = Math.PI / 2;
    b.material = body;
    parts.push(b);
    const nose = MeshBuilder.CreateCylinder("rkNose", { height: 0.14, diameterTop: 0, diameterBottom: 0.066, tessellation: 12 }, scene);
    nose.rotation.x = Math.PI / 2;
    nose.position.z = 0.32;
    nose.material = tip;
    parts.push(nose);
    for (let i = 0; i < 4; i++) {
      const fin = MeshBuilder.CreateBox("rkFin", { width: 0.004, height: 0.09, depth: 0.1 }, scene);
      const a = (i * Math.PI) / 2;
      fin.position.set(Math.cos(a) * 0.05, Math.sin(a) * 0.05, -0.22);
      fin.rotation.z = a;
      fin.material = body;
      parts.push(fin);
    }
    const tpl = Mesh.MergeMeshes(parts, true, true, undefined, false, true)!;
    tpl.name = "rocketTpl";
    tpl.isPickable = false;
    tpl.setEnabled(false);
    const flameTpl = MeshBuilder.CreateCylinder("rkFlame", { height: 0.7, diameterTop: 0.12, diameterBottom: 0, tessellation: 8 }, scene);
    flameTpl.rotation.x = Math.PI / 2;
    flameTpl.bakeCurrentTransformIntoVertices();
    flameTpl.material = flameMat;
    flameTpl.isPickable = false;
    flameTpl.setEnabled(false);

    for (let i = 0; i < 4; i++) {
      const node = new TransformNode("rocket" + i, scene);
      const m = tpl.clone("rocketMesh" + i, node)!;
      m.setEnabled(true);
      m.isPickable = false;
      const flame = flameTpl.clone("rocketFlameMesh" + i, node)!;
      flame.position.z = -0.6;
      flame.setEnabled(true);
      node.setEnabled(false);
      node.rotationQuaternion = new Quaternion();
      const trail = new ParticleSystem("rocketTrail" + i, 260, scene);
      trail.particleTexture = mats.smoke;
      trail.emitter = new Vector3(0, -100, 0);
      trail.minEmitBox = new Vector3(-0.03, -0.03, -0.03);
      trail.maxEmitBox = new Vector3(0.03, 0.03, 0.03);
      trail.color1 = new Color4(0.78, 0.76, 0.72, 0.5);
      trail.color2 = new Color4(0.62, 0.6, 0.58, 0.42);
      trail.colorDead = new Color4(0.55, 0.55, 0.55, 0);
      trail.minSize = 0.18;
      trail.maxSize = 0.34;
      trail.addSizeGradient(0, 0.5);
      trail.addSizeGradient(1, 3.2);
      trail.minLifeTime = 1.1;
      trail.maxLifeTime = 2.2;
      trail.emitRate = 0;
      trail.minEmitPower = 0.2;
      trail.maxEmitPower = 0.6;
      trail.direction1 = new Vector3(-0.3, 0.1, -0.3);
      trail.direction2 = new Vector3(0.3, 0.5, 0.3);
      trail.gravity = new Vector3(0, 0.25, 0);
      trail.minAngularSpeed = -1;
      trail.maxAngularSpeed = 1;
      trail.blendMode = ParticleSystem.BLENDMODE_STANDARD;
      trail.updateSpeed = 1 / 60;
      trail.start();
      this.pool.push({ node, flame, trail, pos: new Vector3(), vel: new Vector3(), cfg: null, life: 0, sound: null, lastDist: -1 });
    }
  }

  get live() {
    return this.pool.filter((r) => r.cfg !== null);
  }

  fire(origin: Vector3, dir: Vector3, cfg: ProjectileConfig) {
    const r = this.pool.find((p) => !p.cfg) ?? this.pool[0];
    if (r.cfg) this.finish(r);
    r.cfg = cfg;
    r.life = 0;
    r.pos.copyFrom(origin);
    r.vel.copyFrom(dir).normalize().scaleInPlace(cfg.speed);
    r.node.position.copyFrom(origin);
    this.orient(r);
    r.node.setEnabled(true);
    (r.trail.emitter as Vector3).copyFrom(origin);
    // continuous emission (a one-off manual burst, e.g. the warm-up, would switch the rate off)
    r.trail.manualEmitCount = -1;
    r.trail.emitRate = 160;
    r.sound = this.audio.playLoop(cfg.flightSound, { x: origin.x, y: origin.y, z: origin.z, volume: cfg.flightSound === "rocketMotor" ? 0.75 : 0.55 });
    r.lastDist = -1;
  }

  private orient(r: Rocket) {
    const v = r.vel;
    const len = v.length();
    if (len < 1e-4) return;
    lookRotation(this.step.copyFrom(v).scaleInPlace(1 / len), Vector3.UpReadOnly, this.q);
    r.node.rotationQuaternion!.copyFrom(this.q);
  }

  update(dt: number) {
    for (const r of this.pool) {
      if (!r.cfg) continue;
      const cfg = r.cfg;
      r.life += dt;
      r.vel.y -= cfg.gravity * dt;
      this.step.copyFrom(r.vel).scaleInPlace(dt);
      const dist = this.step.length();
      // swept test along this step
      this.ray.origin.copyFrom(r.pos);
      this.ray.direction.copyFrom(this.step).scaleInPlace(1 / Math.max(1e-6, dist));
      this.ray.length = dist + 0.3;
      const hit = this.scene.pickWithRay(this.ray, this.predicate as never, false);
      if (hit?.hit && hit.pickedPoint && this.onGlass?.(hit.pickedMesh, hit.pickedPoint, this.ray.direction)) {
        // shattered a window: hold this step so the next one re-tests what's behind it
        continue;
      } else if (hit?.hit && hit.pickedPoint) {
        const md = hit.pickedMesh?.metadata as { kind?: number; enemy?: EnemyHitTarget } | undefined;
        const n = hit.getNormal(true, false) ?? this.ray.direction.scale(-1);
        const direct = md?.kind === HitKind.EnemyPart ? (md.enemy ?? null) : null;
        // blast centre: just off the surface so the cover test doesn't start inside the wall
        const pos = hit.pickedPoint.add(n.scale(0.15));
        this.detonate(r, pos, n, direct, hit.pickedPoint.clone());
        continue;
      }
      r.pos.addInPlace(this.step);
      r.node.position.copyFrom(r.pos);
      this.orient(r);
      (r.trail.emitter as Vector3).copyFrom(r.pos);
      r.flame.scaling.z = 0.8 + Math.random() * 0.5;
      r.sound?.setPosition(r.pos.x, r.pos.y, r.pos.z);
      // Doppler: pitch drops as it flies away (speed of sound 343 m/s)
      const L = this.audio.listenerPos;
      const d = Math.hypot(r.pos.x - L.x, r.pos.y - L.y, r.pos.z - L.z);
      if (r.lastDist >= 0 && dt > 0) {
        const radial = (d - r.lastDist) / dt;
        r.sound?.setRate(Math.max(0.55, Math.min(1.6, 343 / (343 + radial))));
      }
      r.lastDist = d;
      if (r.life > cfg.life) this.detonate(r, r.pos.clone(), Vector3.Up(), null, null);
    }
  }

  private detonate(r: Rocket, pos: Vector3, normal: Vector3, direct: EnemyHitTarget | null, point: Vector3 | null) {
    const cfg = r.cfg!;
    this.finish(r);
    this.onDetonate?.({ pos, normal, cfg, direct, directPoint: point });
  }

  private finish(r: Rocket) {
    r.cfg = null;
    r.node.setEnabled(false);
    r.trail.emitRate = 0;
    r.sound?.stop();
    r.sound = null;
  }

  warmup(at: Vector3) {
    const r = this.pool[0];
    r.node.position.copyFrom(at);
    r.node.setEnabled(true);
    (r.trail.emitter as Vector3).copyFrom(at);
    r.trail.manualEmitCount = 4;
  }

  reset() {
    for (const r of this.pool) {
      this.finish(r);
      r.trail.reset();
      r.trail.manualEmitCount = -1;
    }
  }
}
