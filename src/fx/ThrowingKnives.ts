import { AbstractMesh } from "@babylonjs/core/Meshes/abstractMesh";
import { Matrix, Quaternion, Vector3 } from "@babylonjs/core/Maths/math.vector";
import { Mesh } from "@babylonjs/core/Meshes/mesh";
import { Ray } from "@babylonjs/core/Culling/ray";
import { Scene } from "@babylonjs/core/scene";
import { TransformNode } from "@babylonjs/core/Meshes/transformNode";
import { BodyZone, HitKind } from "../config/game";
import { THROWING_KNIFE as K } from "../config/weapons";
import type { AudioEngine } from "../audio/AudioEngine";
import type { Effects } from "./Effects";

/**
 * Throwing knives, the way shooters do them (Call of Duty's lethal knife, mostly): a fast, nearly
 * flat throw with a little drop, spinning end over end; whatever it meets first it goes into tip
 * first and stays — a wall, a crate, a soldier. On a soldier it's silent and, anywhere on his body,
 * deadly (a boss survives one in the body). A stuck knife — in the wall, or in the body it killed —
 * is yours again when you walk over it.
 *
 * The flight is swept every frame (a ray from where it was to where it is), so a knife never passes
 * through a thin wall or a soldier between two frames.
 */

interface Enemyish {
  applyHit(damage: number, zone: BodyZone, dir: Vector3, point: Vector3, info?: { kind: "bullet" | "melee"; force?: number }): boolean;
  readonly alive: boolean;
  /** his drawn body: the bone nearest a point on it */
  readonly skin?: { nearestBone(p: Vector3): TransformNode } | null;
}

interface Knife {
  node: TransformNode;
  pos: Vector3;
  vel: Vector3;
  /** spin angle (rad) and the axis it turns about (across the line of flight) */
  spin: number;
  axis: Vector3;
  age: number;
  /** stuck: in a wall (null) or in a soldier */
  stuck: boolean;
  in: Enemyish | null;
}

/**
 * The thrown knife's model: the combat knife's blade from its first-person file, in metres, the grip's
 * middle at the origin and +Y to the tip (the file's own blade axis), scaled to a throwing knife.
 */
export function makeKnifeTemplate(src: Mesh): Mesh {
  const m = src.clone("throwKnifeTpl", null, true)!;
  m.makeGeometryUnique();
  m.parent = null;
  m.position.setAll(0);
  m.rotationQuaternion = null;
  m.rotation.setAll(0);
  m.scaling.setAll(1);
  // (the file's centimetres: grip middle at y = −4, tip at +30.8)
  m.bakeTransformIntoVertices(Matrix.Translation(0, 4, 0).multiply(Matrix.Scaling(K.scale, K.scale, K.scale)));
  m.isPickable = false;
  m.setEnabled(false);
  return m;
}

export class ThrowingKnives {
  private list: Knife[] = [];
  private ray = new Ray(Vector3.Zero(), Vector3.Forward(), 1);
  private step = new Vector3();
  private tip = new Vector3();
  private q = new Quaternion();
  /** a knife hit a soldier (hit marker / kill feed) */
  onHit?: (head: boolean, killed: boolean) => void;
  /** a knife was taken back (inventory +1); return false when there's no room for it */
  onTake?: () => boolean;
  private readonly pred = (m: AbstractMesh) => {
    const md = m.metadata as { kind?: number; enemy?: Enemyish } | null;
    if (!md) return false;
    if (md.kind === HitKind.Level) return m.isPickable;
    if (md.kind === HitKind.EnemyPart) return !!md.enemy?.alive;
    return false;
  };

  constructor(
    private scene: Scene,
    private tpl: Mesh,
    private fx: Effects,
    private audio: AudioEngine,
  ) {}

  /** in flight or stuck about the stage */
  get count() {
    return this.list.length;
  }

  throw(origin: Vector3, vel: Vector3) {
    const node = new TransformNode("throwKnife", this.scene);
    const mesh = this.tpl.clone("throwKnifeMesh", node, true)!;
    // (the template is hidden by the grenade system, which draws instances of its templates)
    mesh.setEnabled(true);
    mesh.isVisible = true;
    mesh.isPickable = false;
    mesh.receiveShadows = true;
    node.rotationQuaternion = new Quaternion();
    const dir = vel.normalizeToNew();
    // end over end: the blade turns about the line across the flight (and level)
    let axis = Vector3.Cross(Vector3.Up(), dir);
    if (axis.lengthSquared() < 1e-4) axis = new Vector3(1, 0, 0);
    axis.normalize();
    const k: Knife = { node, pos: origin.clone(), vel: vel.clone(), spin: 0, axis, age: 0, stuck: false, in: null };
    this.list.push(k);
    this.pose(k);
    this.audio.play("knifeSlash", { x: origin.x, y: origin.y, z: origin.z, volume: 0.6, pitchVar: 0.1, rate: 1.15 });
  }

  /** where the knife is in flight: tip forward along the flight, turned by its spin */
  private pose(k: Knife) {
    const d = this.step.copyFrom(k.vel).normalize();
    // tip = the flight direction turned about the axis by the spin
    const perp = Vector3.Cross(d, k.axis).normalize();
    this.tip.copyFrom(d).scaleInPlace(Math.cos(k.spin)).addInPlace(perp.scaleInPlace(Math.sin(k.spin)));
    this.setFrame(k.node, this.tip, k.axis);
    k.node.position.copyFrom(k.pos);
  }

  /** the knife's +Y onto `tip`, its flat (+X) onto `flat` */
  private setFrame(n: TransformNode, tip: Vector3, flat: Vector3) {
    const y = tip.normalizeToNew();
    const x = flat.subtract(y.scale(Vector3.Dot(flat, y))).normalize();
    const z = Vector3.Cross(x, y);
    Quaternion.RotationQuaternionFromAxisToRef(x, y, z, this.q);
    n.rotationQuaternion!.copyFrom(this.q);
  }

  update(dt: number, player: Vector3) {
    for (let i = this.list.length - 1; i >= 0; i--) {
      const k = this.list[i];
      if (k.stuck) {
        // walked over: taken back (from a wall, or from the body it's in once he's down)
        if (k.in?.alive) continue;
        if (!k.node.isEnabled(true)) continue;
        const p = k.node.getAbsolutePosition();
        if (Math.hypot(p.x - player.x, p.z - player.z) < K.pickupRange && Math.abs(p.y - player.y) < 1.9 && this.onTake?.()) {
          this.audio.play("foley", { volume: 0.55 });
          k.node.dispose();
          this.list.splice(i, 1);
        }
        continue;
      }
      k.age += dt;
      if (k.age > K.life) {
        k.node.dispose();
        this.list.splice(i, 1);
        continue;
      }
      // swept: from here to where it'll be at the end of the frame
      k.vel.y -= K.gravity * dt;
      this.step.copyFrom(k.vel).scaleInPlace(dt);
      const len = this.step.length();
      this.ray.origin.copyFrom(k.pos);
      this.ray.direction.copyFrom(this.step).scaleInPlace(1 / Math.max(1e-6, len));
      this.ray.length = len + 0.02;
      const hit = this.scene.pickWithRay(this.ray, this.pred, false);
      if (hit?.hit && hit.pickedPoint && hit.pickedMesh) {
        this.strike(k, hit.pickedMesh, hit.pickedPoint, this.ray.direction.clone());
        continue;
      }
      k.pos.addInPlace(this.step);
      k.spin += K.spin * Math.PI * 2 * dt;
      this.pose(k);
    }
  }

  /** into whatever it met: tip first, a few centimetres deep, and it stays there */
  private strike(k: Knife, mesh: AbstractMesh, point: Vector3, dir: Vector3) {
    k.stuck = true;
    // (a little roll about the blade, so a row of them don't look stamped)
    const roll = (Math.random() - 0.5) * 0.8;
    const flat = k.axis.clone();
    const qr = Quaternion.RotationAxis(dir, roll);
    flat.rotateByQuaternionToRef(qr, flat);
    this.setFrame(k.node, dir, flat);
    k.node.position.copyFrom(point).subtractInPlace(dir.scale(K.tipLength - K.embed));
    const md = mesh.metadata as { kind?: number; enemy?: Enemyish; zone?: BodyZone } | null;
    if (md?.kind === HitKind.EnemyPart && md.enemy) {
      const e = md.enemy;
      const head = md.zone === "head";
      const flatDir = new Vector3(dir.x, 0.1, dir.z).normalize();
      // (the bone it went into, picked before the hit knocks him about)
      const bone = e.skin?.nearestBone(point) ?? null;
      const killed = e.applyHit(head ? K.headDamage : K.damage, md.zone ?? "torso", flatDir, point, { kind: "melee", force: 0.55 });
      this.audio.play("knifeStab", { x: point.x, y: point.y, z: point.z, volume: 0.95, pitchVar: 0.07 });
      this.fx.bloodHit(point, flatDir, true);
      this.onHit?.(head, killed);
      // rides the drawn body — its bone follows him down, fall and ragdoll alike (the hitboxes don't)
      k.in = e;
      k.node.setParent(bone ?? (mesh.parent as TransformNode | null) ?? mesh);
    } else {
      this.audio.play("knifeWall", { x: point.x, y: point.y, z: point.z, volume: 0.85, pitchVar: 0.08 });
      const n = dir.scale(-1);
      this.fx.impact(point, n, "concrete", false);
    }
  }

  reset() {
    for (const k of this.list) k.node.dispose();
    this.list.length = 0;
  }
}
