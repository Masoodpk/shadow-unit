import { Mesh } from "@babylonjs/core/Meshes/mesh";
import { Physics6DoFConstraint, Physics6DoFLimit } from "@babylonjs/core/Physics/v2/physicsConstraint";
import { PhysicsBody } from "@babylonjs/core/Physics/v2/physicsBody";
import { PhysicsConstraintAxis, PhysicsMotionType } from "@babylonjs/core/Physics/v2/IPhysicsEnginePlugin";
import { PhysicsShape, PhysicsShapeBox, PhysicsShapeCapsule } from "@babylonjs/core/Physics/v2/physicsShape";
import { Quaternion, Vector3 } from "@babylonjs/core/Maths/math.vector";
import { Scene } from "@babylonjs/core/scene";
import { TransformNode } from "@babylonjs/core/Meshes/transformNode";
import { PoseRig } from "../core/pose";
import { CollisionGroups } from "../physics/CollisionGroups";
import { RAGDOLL } from "./EnemyConfig";

/** What the ragdoll needs from a skinned soldier. */
export interface RagdollRig {
  pose: PoseRig;
  /** hips, spine0.., neck, head, L/R up, fore, hand, thigh, calf, foot */
  b: Record<string, TransformNode>;
  spineCount: number;
  /** bone-local axes measured in the bind pose */
  hipsUp: Vector3;
  hipsFwd: Vector3;
  headUp: Vector3;
}

type PartKey = "pelvis" | "torso" | "head" | "uArmL" | "fArmL" | "uArmR" | "fArmR" | "thighL" | "calfL" | "thighR" | "calfR";

interface Part {
  key: PartKey;
  node: TransformNode;
  body: PhysicsBody;
  shape: PhysicsShape;
  /** bones driven rigidly by this body: world X/Y axes of the bone at activation (body-local == world then) */
  drive: { bone: TransformNode; ax: Vector3; ay: Vector3 }[];
  mass: number;
}

/** ragdoll slots → unique filter bit each, so a body never collides with its own limbs */
const SLOT_BITS = [3, 4, 5, 6, 7, 8, 9, 10];
const ALL_RAGDOLL_BITS = SLOT_BITS.reduce((m, b) => m | (1 << b), 0);

const EX = new Vector3(1, 0, 0);
const EY = new Vector3(0, 1, 0);

export interface RagdollImpulse {
  /** world point the force acts at (bullet hit / blast centre) */
  point: Vector3;
  /** world impulse (N·s) */
  impulse: Vector3;
  /** part that takes the hit (others get a share) */
  part?: "head" | "torso" | "limb";
  /** the whole body thrown at this velocity (m/s) — a superhuman punch, uncapped */
  launch?: Vector3;
}

/** the gun that falls with him: a mesh to take its box from (the rifle), or a box of its own, centred */
export type RagdollGun = { node: TransformNode; mesh: Mesh } | { node: TransformNode; box: Vector3; mass: number };

/**
 * Havok ragdoll for one dead soldier, built on demand from the current pose:
 * 11 bodies (pelvis, torso, head, upper/lower arms, thighs, shins) linked by
 * 6-DoF joints with anatomical limits (knees and elbows are hinges that only
 * bend the right way, hips/shoulders/spine/neck are limited cones with twist).
 * Each frame the bodies drive the skinned bones; after the body comes to rest
 * (or a time limit) every physics object is disposed and the pose is frozen.
 */
export class EnemyRagdoll {
  /**
   * Is this point inside the level's solid geometry (set by the soldiers' manager: the nav's boxes)?
   * The level's physics is triangle surfaces with no thickness — a limb shoved hard enough goes
   * through a wall — so the ragdoll checks its parts against the solid boxes and pulls them back out.
   */
  static embedded: ((x: number, y: number, z: number) => boolean) | null = null;
  private parts: Part[] = [];
  /** parts teleported out of a wall this frame (their pre-step is switched back off next frame) */
  private moved: PhysicsBody[] = [];
  private wallCheck = 0;
  private constraints: Physics6DoFConstraint[] = [];
  private gunBody: PhysicsBody | null = null;
  private gunShape: PhysicsShape | null = null;
  private hipsLocal = new Vector3();
  private t = 0;
  private calm = 0;
  active = false;
  frozen = false;
  private slot = 0;

  private tv = [new Vector3(), new Vector3(), new Vector3(), new Vector3(), new Vector3(), new Vector3()];

  constructor(
    private scene: Scene,
    private rig: RagdollRig,
  ) {}

  private part(key: PartKey) {
    return this.parts.find((p) => p.key === key)!;
  }

  /**
   * Build the bodies from the current pose and let go.
   * @param vel initial velocity of the body (running deaths keep their momentum)
   * @param vels optional per-part velocities measured from the last animated frames
   */
  activate(slot: number, vel: Vector3, hit: RagdollImpulse | null, gun: RagdollGun | null, vels?: Map<string, Vector3>) {
    if (this.active) return;
    this.active = true;
    this.frozen = false;
    this.t = 0;
    this.calm = 0;
    this.slot = slot % SLOT_BITS.length;
    const P = this.rig.pose;
    const b = this.rig.b;
    P.snapshot();
    const W = (n: TransformNode) => P.worldPos(n, new Vector3());
    const A = (n: TransformNode, v: Vector3) => P.worldAxis(n, v, new Vector3());

    const hips = W(b.hips);
    const up = A(b.hips, this.rig.hipsUp);
    const fwd = A(b.hips, this.rig.hipsFwd);
    fwd.subtractInPlace(up.scale(Vector3.Dot(fwd, up))).normalize();
    const right = Vector3.Cross(up, fwd).normalize(); // LH: right = up × forward
    const spine0 = W(b.spine0);
    const neck = W(b.neck);
    const head = W(b.head);
    const headTop = head.add(A(b.head, this.rig.headUp).scale(0.2));
    const seg = (a: Vector3, c: Vector3) => c.subtract(a).normalize();

    const R = RAGDOLL;
    const mk = (key: PartKey, shape: PhysicsShape, center: Vector3, mass: number, drive: TransformNode[]) => {
      const node = new TransformNode("rd_" + key, this.scene);
      node.position.copyFrom(center);
      node.rotationQuaternion = Quaternion.Identity();
      const body = new PhysicsBody(node, PhysicsMotionType.DYNAMIC, false, this.scene);
      shape.filterMembershipMask = 1 << SLOT_BITS[this.slot];
      // limbs hit the level and other bodies — never their own limbs or the rifles (no explosive overlaps at hand-off)
      shape.filterCollideMask = CollisionGroups.LEVEL | (ALL_RAGDOLL_BITS & ~(1 << SLOT_BITS[this.slot]));
      shape.material = { friction: R.friction, restitution: R.restitution };
      body.shape = shape;
      body.setMassProperties({ mass });
      body.setLinearDamping(R.linearDamping);
      body.setAngularDamping(R.angularDamping);
      const d = drive.map((bone) => ({ bone, ax: A(bone, EX), ay: A(bone, EY) }));
      this.parts.push({ key, node, body, shape, drive: d, mass });
      return node;
    };
    // capsule between two world points (body-local == world offsets at activation)
    const capsule = (key: PartKey, a: Vector3, c: Vector3, r: number, mass: number, drive: TransformNode[], shrink = 0) => {
      const dir = seg(a, c);
      const a2 = a.add(dir.scale(shrink));
      const c2 = c.subtract(dir.scale(shrink));
      const center = a2.add(c2).scaleInPlace(0.5);
      const shape = new PhysicsShapeCapsule(a2.subtract(center), c2.subtract(center), r, this.scene);
      return mk(key, shape, center, mass, drive);
    };

    // pelvis: across the hip joints
    const thL = W(b.Lthigh), thR = W(b.Rthigh);
    {
      const center = thL.add(thR).scaleInPlace(0.5).addInPlace(up.scale(0.06));
      const shape = new PhysicsShapeCapsule(thL.subtract(center).addInPlace(up.scale(0.06)), thR.subtract(center).addInPlace(up.scale(0.06)), 0.12, this.scene);
      mk("pelvis", shape, center, R.mass.pelvis, [b.hips]);
      this.hipsLocal.copyFrom(hips).subtractInPlace(center);
    }
    // torso: a box from the waist to the neck, chest-wide
    {
      const dir = seg(spine0, neck);
      const len = Vector3.Distance(spine0, neck);
      const center = spine0.add(neck).scaleInPlace(0.5);
      const f2 = fwd.subtract(dir.scale(Vector3.Dot(fwd, dir))).normalize();
      const r2 = Vector3.Cross(dir, f2).normalize();
      const q = Quaternion.RotationQuaternionFromAxis(r2, dir, f2);
      const shape = new PhysicsShapeBox(Vector3.Zero(), q, new Vector3(0.34, len * 0.95, 0.22), this.scene);
      const spines: TransformNode[] = [];
      for (let i = 0; i < this.rig.spineCount; i++) spines.push(b["spine" + i]);
      mk("torso", shape, center, R.mass.torso, spines);
    }
    capsule("head", neck, headTop, 0.1, R.mass.head, [b.neck, b.head], 0.04);
    for (const s of ["L", "R"] as const) {
      const u = W(b[s + "up"]), f = W(b[s + "fore"]), h = W(b[s + "hand"]);
      const hd = h.add(seg(f, h).scale(0.09));
      capsule(("uArm" + s) as PartKey, u, f, 0.055, R.mass.upperArm, [b[s + "up"]], 0.02);
      capsule(("fArm" + s) as PartKey, f, hd, 0.045, R.mass.foreArm, [b[s + "fore"], b[s + "hand"]], 0.02);
      const t = W(b[s + "thigh"]), c = W(b[s + "calf"]), ft = W(b[s + "foot"]);
      capsule(("thigh" + s) as PartKey, t, c, 0.075, R.mass.thigh, [b[s + "thigh"]], 0.03);
      capsule(("calf" + s) as PartKey, c, ft.add(up.scale(-0.05)), 0.055, R.mass.calf, [b[s + "calf"], b[s + "foot"]], 0.02);
    }

    // ---- joints (frames defined so that "zero" = child straight along the parent's reference axis)
    const D = Math.PI / 180;
    const joint = (parent: PartKey, child: PartKey, pivot: Vector3, axisA: Vector3, axisB: Vector3, perp: Vector3, lim: { tw: number; y: [number, number]; z: [number, number] }) => {
      const pa = this.part(parent), pb = this.part(child);
      const orth = (ax: Vector3) => {
        const p = perp.subtract(ax.scale(Vector3.Dot(perp, ax)));
        return p.lengthSquared() < 1e-6 ? Vector3.Cross(ax, Math.abs(ax.y) < 0.9 ? Vector3.Up() : Vector3.Right()).normalize() : p.normalize();
      };
      const limits: Physics6DoFLimit[] = [
        { axis: PhysicsConstraintAxis.LINEAR_X, minLimit: 0, maxLimit: 0 },
        { axis: PhysicsConstraintAxis.LINEAR_Y, minLimit: 0, maxLimit: 0 },
        { axis: PhysicsConstraintAxis.LINEAR_Z, minLimit: 0, maxLimit: 0 },
        { axis: PhysicsConstraintAxis.ANGULAR_X, minLimit: -lim.tw * D, maxLimit: lim.tw * D },
        { axis: PhysicsConstraintAxis.ANGULAR_Y, minLimit: lim.y[0] * D, maxLimit: lim.y[1] * D },
        { axis: PhysicsConstraintAxis.ANGULAR_Z, minLimit: lim.z[0] * D, maxLimit: lim.z[1] * D },
      ];
      const c = new Physics6DoFConstraint(
        {
          pivotA: pivot.subtract(pa.node.position),
          pivotB: pivot.subtract(pb.node.position),
          axisA: axisA.clone().normalize(),
          axisB: axisB.clone().normalize(),
          perpAxisA: orth(axisA.clone().normalize()),
          perpAxisB: orth(axisB.clone().normalize()),
          collision: false,
        },
        limits,
        this.scene,
      );
      pa.body.addConstraint(pb.body, c);
      this.constraints.push(c);
    };
    const down = up.scale(-1);
    const J = R.joints;
    joint("pelvis", "torso", spine0, up, seg(spine0, neck), right, J.spine);
    joint("torso", "head", neck, seg(spine0, neck), seg(neck, headTop), right, J.neck);
    for (const s of ["L", "R"] as const) {
      const u = W(b[s + "up"]), f = W(b[s + "fore"]), h = W(b[s + "hand"]);
      const ud = seg(u, f), fd = seg(f, h);
      joint("torso", ("uArm" + s) as PartKey, u, down, ud, right, J.shoulder);
      // elbow hinge: bend-plane normal (fallback: the arm bends forward)
      let n = Vector3.Cross(ud, fd);
      if (n.length() < 0.15) n = right.scale(-1);
      joint(("uArm" + s) as PartKey, ("fArm" + s) as PartKey, f, ud, fd, n.normalize(), J.elbow);
      const t = W(b[s + "thigh"]), c = W(b[s + "calf"]), ft = W(b[s + "foot"]);
      const td = seg(t, c), cd = seg(c, ft);
      joint("pelvis", ("thigh" + s) as PartKey, t, down, td, right, J.hip);
      let kn = Vector3.Cross(td, cd);
      if (kn.length() < 0.15) kn = right.clone();
      joint(("thigh" + s) as PartKey, ("calf" + s) as PartKey, c, td, cd, kn.normalize(), J.knee);
    }

    // ---- motion: each limb carries its own velocity from the last animated frame
    for (const p of this.parts) {
      const v = this.tv[0].copyFrom(vels?.get(p.key) ?? vel);
      if (v.length() > 12) v.normalize().scaleInPlace(12);
      p.body.setLinearVelocity(v);
    }
    if (hit) this.applyImpulse(hit);

    // ---- the gun in his hands (the rifle, or the pistol if it's out) tumbles away on its own
    if (gun) {
      const g = gun.node;
      g.computeWorldMatrix(true);
      const pos = g.getAbsolutePosition().clone();
      const rot = g.absoluteRotationQuaternion.clone();
      g.parent = null;
      g.position.copyFrom(pos);
      g.rotationQuaternion = rot;
      g.scaling.setAll(1);
      let shape: PhysicsShapeBox;
      if ("box" in gun) shape = new PhysicsShapeBox(Vector3.Zero(), Quaternion.Identity(), gun.box, this.scene);
      else {
        const bb = gun.mesh.getBoundingInfo().boundingBox;
        shape = new PhysicsShapeBox(bb.center.add(gun.mesh.position), Quaternion.Identity(), bb.extendSize.scale(2), this.scene);
      }
      const mass = "box" in gun ? gun.mass : 3.2;
      shape.filterMembershipMask = CollisionGroups.DEBRIS;
      shape.filterCollideMask = CollisionGroups.LEVEL | CollisionGroups.DEBRIS;
      shape.material = { friction: 0.7, restitution: 0.15 };
      const body = new PhysicsBody(g, PhysicsMotionType.DYNAMIC, false, this.scene);
      body.shape = shape;
      body.setMassProperties({ mass });
      body.setLinearDamping(0.1);
      body.setAngularDamping(0.4);
      // (it leaves the hand at about the speed the shot gives his chest — 2–3 m/s — and drops beside
      // him; a share of the bullet's whole push on a 3 kg gun sent it skidding 10 m down the hall)
      const v = vel.clone();
      if (hit) {
        const kick = hit.impulse.scale(1 / RAGDOLL.mass.torso);
        if (kick.length() > 3) kick.normalize().scaleInPlace(3);
        v.addInPlace(kick);
        // (a superhuman blow throws the gun with the body)
        if (hit.launch) v.addInPlace(hit.launch);
      }
      v.y += 0.6;
      body.setLinearVelocity(v);
      body.setAngularVelocity(new Vector3(Math.random() * 6 - 3, Math.random() * 6 - 3, Math.random() * 6 - 3));
      this.gunBody = body;
      this.gunShape = shape;
    }
  }

  /** bullet / blast / melee push on a live ragdoll (also used at activation) */
  applyImpulse(hit: RagdollImpulse) {
    if (!this.active || this.frozen) return;
    if (hit.launch) {
      for (const p of this.parts) p.body.applyImpulse(hit.launch.scale(p.mass), p.node.position);
      this.calm = 0;
      this.t = Math.min(this.t, 0);
    }
    // the struck part takes most of it, the torso the rest (keeps limbs from whipping off)
    let best = this.parts[0];
    let bd = Infinity;
    for (const p of this.parts) {
      if (hit.part === "head" && p.key !== "head") continue;
      const d = Vector3.DistanceSquared(p.node.position, hit.point);
      if (d < bd) {
        bd = d;
        best = p;
      }
    }
    const torso = this.part("torso");
    // a wall right behind him: the push is mostly lost — he crumples where he stands, not into the wall
    const emb = EnemyRagdoll.embedded;
    if (emb) {
      const d = this.tv[4].set(hit.impulse.x, 0, hit.impulse.z);
      const l = d.length();
      if (l > 1e-3) {
        d.scaleInPlace(1 / l);
        const c = torso.node.position;
        for (const r of [0.35, 0.7, 1.05])
          if (emb(c.x + d.x * r, c.y, c.z + d.z * r)) {
            hit = { ...hit, impulse: new Vector3(hit.impulse.x * 0.2, Math.min(hit.impulse.y, 0) - l * 0.1, hit.impulse.z * 0.2) };
            break;
          }
      }
    }
    const cap = (p: Part, v: Vector3) => {
      const l = v.length();
      const max = p.mass * RAGDOLL.maxPartDV;
      return l > max ? v.scaleInPlace(max / l) : v;
    };
    best.body.applyImpulse(cap(best, hit.impulse.scale(best === torso ? 1 : 0.65)), hit.point);
    if (best !== torso) torso.body.applyImpulse(cap(torso, hit.impulse.scale(0.35)), torso.node.position);
    this.calm = 0;
  }

  /** radial blast: every part pushed away from the centre, more when closer, with lift */
  blast(center: Vector3, radius: number, strength: number) {
    if (!this.active || this.frozen) return;
    for (const p of this.parts) {
      const d = this.tv[1].copyFrom(p.node.position).subtractInPlace(center);
      const dist = d.length();
      if (dist > radius) continue;
      const k = Math.pow(1 - dist / radius, 1.2) * strength * (p.mass / 80);
      d.scaleInPlace(1 / Math.max(0.2, dist));
      d.y += 0.6;
      d.normalize().scaleInPlace(k);
      p.body.applyImpulse(d, p.node.position);
    }
    this.calm = 0;
    this.t = Math.min(this.t, RAGDOLL.maxTime - 2);
  }

  /** Drive the skinned bones from the bodies; returns true while still simulating. */
  update(dt: number) {
    if (!this.active || this.frozen) return false;
    this.t += dt;
    for (const body of this.moved) body.disablePreStep = true;
    this.moved.length = 0;
    if ((this.wallCheck = (this.wallCheck + 1) % 3) === 0) this.outOfWalls();
    const P = this.rig.pose;
    const b = this.rig.b;
    P.restoreSnapshot();
    const pelvis = this.parts[0];
    const q = pelvis.node.rotationQuaternion!;
    this.hipsLocal.rotateByQuaternionToRef(q, this.tv[0]).addInPlace(pelvis.node.position);
    P.setWorldPos(b.hips, this.tv[0]);
    let maxV = 0;
    for (const p of this.parts) {
      const pq = p.node.rotationQuaternion!;
      for (const d of p.drive) {
        d.ax.rotateByQuaternionToRef(pq, this.tv[1]);
        d.ay.rotateByQuaternionToRef(pq, this.tv[2]);
        P.alignFrame(d.bone, EX, EY, this.tv[1], this.tv[2]);
      }
      p.body.getLinearVelocityToRef(this.tv[3]);
      maxV = Math.max(maxV, this.tv[3].length());
    }
    P.commit();
    // come to rest → freeze the pose and give the physics objects back
    this.calm = maxV < RAGDOLL.sleepSpeed ? this.calm + dt : 0;
    if (this.calm > RAGDOLL.sleepTime || this.t > RAGDOLL.maxTime) this.freeze();
    return !this.frozen;
  }

  /** any part inside a wall: back along the line to the pelvis to the first free spot, stopped there */
  private outOfWalls() {
    const emb = EnemyRagdoll.embedded;
    if (!emb) return;
    // (in a wall, not just resting on the floor: solid here and still solid a hand's height up)
    const inWall = (v: Vector3) => emb(v.x, v.y, v.z) && emb(v.x, v.y + 0.3, v.z);
    const pelvis = this.parts[0].node.position;
    if (inWall(pelvis)) return;
    for (const p of this.parts) {
      const at = p.node.position;
      if (p === this.parts[0] || !inWall(at)) continue;
      const to = this.tv[5];
      for (let k = 1; k <= 6; k++) {
        Vector3.LerpToRef(at, pelvis, k / 6, to);
        if (inWall(to)) continue;
        p.node.position.copyFrom(to);
        p.body.disablePreStep = false;
        p.body.setLinearVelocity(Vector3.ZeroReadOnly);
        p.body.setAngularVelocity(Vector3.ZeroReadOnly);
        this.moved.push(p.body);
        this.calm = 0;
        break;
      }
    }
  }

  /** Stop simulating, keep the final pose. */
  /** at rest (or near enough): safe to freeze without leaving a body hanging in the air */
  get settled() {
    return this.frozen || !this.active || this.calm > 0.3 || this.t > 4;
  }
  freeze() {
    if (this.frozen) return;
    this.frozen = true;
    this.disposeBodies();
  }

  private disposeBodies() {
    for (const c of this.constraints) c.dispose();
    for (const p of this.parts) {
      p.body.dispose();
      p.shape.dispose();
      p.node.dispose();
    }
    this.constraints = [];
    this.parts = [];
    this.gunBody?.dispose();
    this.gunShape?.dispose();
    this.gunBody = null;
    this.gunShape = null;
  }

  /** Full cleanup (respawn / restart). */
  dispose() {
    this.disposeBodies();
    this.active = false;
    this.frozen = false;
  }

  /** current pelvis position (for corpse effects / camera) */
  get center() {
    return this.parts.length ? this.parts[0].node.position : null;
  }
}
