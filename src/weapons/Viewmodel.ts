import { AbstractMesh } from "@babylonjs/core/Meshes/abstractMesh";
import { Camera } from "@babylonjs/core/Cameras/camera";
import { Matrix, Quaternion, Vector3 } from "@babylonjs/core/Maths/math.vector";
import { Scene } from "@babylonjs/core/scene";
import { TransformNode } from "@babylonjs/core/Meshes/transformNode";
import { RENDER } from "../config/game";
import { Spring, clamp, damp, lerp, rand } from "../core/math";
import { Materials } from "../render/Materials";
import { Pose, WeaponRig, ZERO_POSE, makeForearm } from "./WeaponModels";

export interface ViewmodelFrame {
  rig: WeaponRig;
  adsT: number;
  sprintT: number;
  raised: number;
  reloadPhase: string | null;
  reloadT: number;
  moveAmount: number;
  grounded: boolean;
  verticalVel: number;
  lateralVel: number;
  crouched: boolean;
  /** lying down: crawling sways the gun and dips it a little */
  prone?: boolean;
  mouseDX: number;
  mouseDY: number;
  swayAmount: number;
  swayAdsScale: number;
  swaySmoothing: number;
  /** player's gait phase (π per footstep) and smoothed bob strength */
  gaitPhase: number;
  gaitAmt: number;
  /** melee swing progress 0..1 (or -1) and style */
  melee: number;
  meleeStyle: "rifle" | "pistol";
}

/** melee keyframes (camera space offsets): wind-up, strike, follow-through */
const MELEE: Record<"rifle" | "pistol", { t: number[]; k: Pose[] }> = {
  // rifle butt-stroke: the gun swings so the stock leads, then drives forward into the target
  rifle: {
    t: [0, 0.24, 0.4, 0.56, 1],
    k: [
      { px: 0, py: 0, pz: 0, rx: 0, ry: 0, rz: 0 },
      { px: 0.09, py: -0.02, pz: -0.07, rx: 0.12, ry: 0.95, rz: -0.4 },
      { px: -0.12, py: 0.03, pz: 0.27, rx: -0.12, ry: 0.55, rz: -0.3 },
      { px: -0.1, py: 0.0, pz: 0.2, rx: -0.05, ry: 0.45, rz: -0.25 },
      { px: 0, py: 0, pz: 0, rx: 0, ry: 0, rz: 0 },
    ],
  },
  // pistol whip: raise the frame, chop down and forward
  pistol: {
    t: [0, 0.26, 0.42, 0.56, 1],
    k: [
      { px: 0, py: 0, pz: 0, rx: 0, ry: 0, rz: 0 },
      { px: 0.03, py: 0.09, pz: -0.04, rx: -0.95, ry: 0.15, rz: 0.35 },
      { px: -0.06, py: -0.07, pz: 0.2, rx: 0.65, ry: -0.1, rz: 0.1 },
      { px: -0.05, py: -0.06, pz: 0.16, rx: 0.5, ry: -0.08, rz: 0.08 },
      { px: 0, py: 0, pz: 0, rx: 0, ry: 0, rz: 0 },
    ],
  },
};
const meleePose = (style: "rifle" | "pistol", u: number, out: Pose) => {
  const m = MELEE[style];
  let i = 0;
  while (i < m.t.length - 2 && u > m.t[i + 1]) i++;
  const a = m.k[i], b = m.k[i + 1];
  let k = clamp((u - m.t[i]) / (m.t[i + 1] - m.t[i]), 0, 1);
  k = k * k * (3 - 2 * k);
  out.px = lerp(a.px, b.px, k);
  out.py = lerp(a.py, b.py, k);
  out.pz = lerp(a.pz, b.pz, k);
  out.rx = lerp(a.rx, b.rx, k);
  out.ry = lerp(a.ry, b.ry, k);
  out.rz = lerp(a.rz, b.rz, k);
  return out;
};

/**
 * Procedural first-person animation layer. The gun pose is the sum of
 * hip/ADS blend + sprint + reload pose + bob + sway + recoil springs. Using
 * springs means recoil, landing and switching all blend naturally without
 * clip-state bugs, and timing is exact (no animation blending latency).
 */
export class Viewmodel {
  readonly base: TransformNode;
  readonly pivot: TransformNode;
  private armL: { node: TransformNode; meshes: AbstractMesh[] };
  private armR: { node: TransformNode; meshes: AbstractMesh[] };
  /** Elbow offsets relative to each hand (camera space) — keeps forearm length constant. */
  private elbowL = new Vector3(-0.13, -0.2, -0.22);
  private elbowR = new Vector3(0.1, -0.2, -0.24);
  private elbowTmp = new Vector3();

  // springs
  private kickZ = new Spring(260, 22);
  private kickRX = new Spring(300, 20);
  private kickRY = new Spring(260, 20);
  private kickRZ = new Spring(220, 16);
  private landY = new Spring(140, 12);
  private swayX = 0;
  private swayY = 0;
  private idleT = 0;
  private reloadPoseSmoothed: Pose = { ...ZERO_POSE };
  private meleeTmp: Pose = { ...ZERO_POSE };
  private mPivot = new Matrix();
  private mHand = new Matrix();
  private mOut = new Matrix();
  private q = new Quaternion();
  private one = Vector3.One();
  private tmp = new Vector3();
  private lastGrounded = true;
  private activeRig: WeaponRig | null = null;

  constructor(scene: Scene, camera: Camera, mats: Materials, rigs: WeaponRig[]) {
    this.base = new TransformNode("vmBase", scene);
    this.base.parent = camera;
    this.pivot = new TransformNode("vmPivot", scene);
    this.pivot.parent = this.base;
    this.armL = makeForearm(scene, mats);
    this.armR = makeForearm(scene, mats);
    for (const a of [this.armL, this.armR]) {
      a.node.parent = this.base;
      this.prepMeshes(a.meshes);
    }
    for (const r of rigs) {
      r.root.parent = this.pivot;
      this.prepMeshes(r.meshes);
      r.root.setEnabled(false);
    }
  }

  private prepMeshes(meshes: AbstractMesh[]) {
    for (const m of meshes) {
      m.renderingGroupId = RENDER.viewmodelGroup;
      m.isPickable = false;
      m.receiveShadows = false;
      m.alwaysSelectAsActiveMesh = true;
      m.doNotSyncBoundingInfo = true;
    }
  }

  setActive(rig: WeaponRig | null) {
    if (this.activeRig === rig) return;
    if (this.activeRig) this.activeRig.root.setEnabled(false);
    this.activeRig = rig;
    if (rig) rig.root.setEnabled(true);
    const arms = !!rig && !rig.hasArms;
    this.armL.node.setEnabled(arms);
    this.armR.node.setEnabled(arms);
  }

  /** Per-shot impulses (scaled by weapon recoil config). */
  kick(back: number, rot: number, adsScale: number) {
    const s = adsScale;
    this.kickZ.impulse(-back * 22 * s);
    this.kickRX.impulse(-rot * 22 * s);
    this.kickRY.impulse(rand(-1, 1) * rot * 5 * s);
    this.kickRZ.impulse(rand(-1, 1) * rot * 9 * s);
  }

  reset() {
    for (const s of [this.kickZ, this.kickRX, this.kickRY, this.kickRZ, this.landY]) s.reset();
    this.swayX = this.swayY = 0;
    this.reloadPoseSmoothed = { ...ZERO_POSE };
  }

  update(dt: number, f: ViewmodelFrame) {
    const rig = f.rig;
    this.setActive(rig);
    this.idleT += dt;

    // ---- ADS target from the sight position (sight lands exactly on the view axis)
    const sp = rig.sight.position;
    const ads = rig.adsPose ?? { px: -sp.x, py: -sp.y, pz: rig.adsDistance - sp.z, rx: 0, ry: 0, rz: 0 };
    const hip = rig.hipPose;
    const a = f.adsT;
    let px = lerp(hip.px, ads.px, a);
    let py = lerp(hip.py, ads.py, a);
    let pz = lerp(hip.pz, ads.pz, a);
    let rx = lerp(hip.rx, ads.rx, a);
    let ry = lerp(hip.ry, ads.ry, a);
    let rz = lerp(hip.rz, ads.rz, a);

    // ---- sprint
    const spr = rig.sprintPose;
    const sT = f.sprintT;
    px += spr.px * sT;
    py += spr.py * sT;
    pz += spr.pz * sT;
    rx += spr.rx * sT;
    ry += spr.ry * sT;
    rz += spr.rz * sT;

    // ---- reload pose (smoothed so phase changes never pop)
    const rp = rig.reloadPose(f.reloadPhase, f.reloadT);
    const k = damp(18, dt);
    const sm = this.reloadPoseSmoothed;
    sm.px += (rp.px - sm.px) * k;
    sm.py += (rp.py - sm.py) * k;
    sm.pz += (rp.pz - sm.pz) * k;
    sm.rx += (rp.rx - sm.rx) * k;
    sm.ry += (rp.ry - sm.ry) * k;
    sm.rz += (rp.rz - sm.rz) * k;
    px += sm.px;
    py += sm.py;
    pz += sm.pz;
    rx += sm.rx;
    ry += sm.ry;
    rz += sm.rz;

    // ---- melee swing
    if (f.melee >= 0) {
      const mp = meleePose(f.meleeStyle, f.melee, this.meleeTmp);
      px += mp.px;
      py += mp.py;
      pz += mp.pz;
      rx += mp.rx;
      ry += mp.ry;
      rz += mp.rz;
    }

    // ---- equip / holster (drops below the screen and rotates in)
    const e = rig.authoredEquip ? 0 : 1 - f.raised;
    const ee = e * e * (3 - 2 * e);
    py -= ee * 0.32;
    rx += ee * 0.9;
    ry -= ee * 0.2;

    // ---- bob + idle breathing: locked to the player's footsteps (same phase as the head bob),
    // smooth figure-eight — the gun lags the head a little so it never looks glued or shaky.
    const g = f.gaitAmt * (1 - a * 0.9) * (f.prone ? 1.6 : f.crouched ? 0.7 : 1);
    if (f.prone) {
      // crawling: elbows walk the rifle forward — it rolls side to side and dips with each pull
      const crawl = Math.min(1, f.gaitAmt * 2.5) * (1 - a * 0.8);
      py -= 0.025 * crawl;
      rz += Math.sin(f.gaitPhase) * 0.07 * crawl;
      ry += Math.sin(f.gaitPhase) * 0.04 * crawl;
      rx += 0.05 * crawl;
    }
    const ph = f.gaitPhase - 0.35;
    const sprintK = 1 + sT * 0.7;
    px += Math.sin(ph) * 0.0065 * g * sprintK;
    py += (Math.cos(2 * ph) * 0.5 - 0.5) * 0.0075 * g * sprintK;
    rz += Math.sin(ph) * 0.012 * g;
    rx += (Math.cos(2 * ph) * 0.5 - 0.5) * 0.008 * g;
    // sprint: the rifle swings with the arms, one slow arc per stride
    ry += Math.sin(ph) * 0.035 * sT * g;
    rx += Math.cos(2 * ph) * 0.012 * sT * g;
    const breathe = (1 - a * 0.85) * (1 - Math.min(1, f.gaitAmt));
    py += Math.sin(this.idleT * 1.4) * 0.0018 * breathe;
    rx += Math.sin(this.idleT * 1.1) * 0.003 * breathe;

    // ---- mouse sway (lagging behind the view)
    const swayS = f.swayAmount * lerp(1, f.swayAdsScale, a);
    const tx = clamp(-f.mouseDX * 0.0009, -0.06, 0.06) * swayS;
    const ty = clamp(-f.mouseDY * 0.0009, -0.06, 0.06) * swayS;
    const ks = damp(f.swaySmoothing, dt);
    this.swayX += (tx - this.swayX) * ks;
    this.swayY += (ty - this.swayY) * ks;
    ry += this.swayX * 1.2;
    rx -= this.swayY * 1.0;
    px += this.swayX * 0.06;
    py += this.swayY * 0.05;
    rz += this.swayX * 0.8;
    // strafe lean
    rz += clamp(-f.lateralVel * 0.008, -0.05, 0.05) * (1 - a * 0.6);

    // ---- landing / jumping
    if (f.grounded && !this.lastGrounded) this.landY.impulse(-0.25);
    this.lastGrounded = f.grounded;
    py += clamp(-f.verticalVel * 0.0025, -0.012, 0.012) + this.landY.update(dt) * 0.08;

    // ---- recoil springs
    pz += this.kickZ.update(dt) * 0.01;
    rx += this.kickRX.update(dt) * 0.01;
    ry += this.kickRY.update(dt) * 0.01;
    rz += this.kickRZ.update(dt) * 0.01;

    // rotate around the rig's grip (if given) instead of the pivot origin
    const o = rig.rotationOrigin;
    if (o) {
      Quaternion.RotationYawPitchRollToRef(ry, rx, rz, this.q);
      this.mPivot.reset();
      this.q.toRotationMatrix(this.mPivot);
      Vector3.TransformCoordinatesToRef(o, this.mPivot, this.tmp);
      px += o.x - this.tmp.x;
      py += o.y - this.tmp.y;
      pz += o.z - this.tmp.z;
    }
    this.pivot.position.set(px, py, pz);
    this.pivot.rotation.set(rx, ry, rz);

    if (!rig.hasArms) this.updateArms(rig);
  }

  private updateArms(rig: WeaponRig) {
    Quaternion.FromEulerAnglesToRef(this.pivot.rotation.x, this.pivot.rotation.y, this.pivot.rotation.z, this.q);
    Matrix.ComposeToRef(this.one, this.q, this.pivot.position, this.mPivot);
    const place = (hand: TransformNode, arm: TransformNode, elbow: Vector3) => {
      Quaternion.FromEulerAnglesToRef(hand.rotation.x, hand.rotation.y, hand.rotation.z, this.q);
      Matrix.ComposeToRef(this.one, this.q, hand.position, this.mHand);
      this.mHand.multiplyToRef(this.mPivot, this.mOut);
      this.mOut.getTranslationToRef(this.tmp);
      arm.position.copyFrom(this.tmp);
      arm.lookAt(this.elbowTmp.copyFrom(this.tmp).addInPlace(elbow));
    };
    place(rig.leftHand, this.armL.node, this.elbowL);
    place(rig.rightHand, this.armR.node, this.elbowR);
  }
}
