import { AssetContainer } from "@babylonjs/core/assetContainer";
import { AbstractMesh } from "@babylonjs/core/Meshes/abstractMesh";
import { Color3 } from "@babylonjs/core/Maths/math.color";
import { LoadAssetContainerAsync } from "@babylonjs/core/Loading/sceneLoader";
import { Matrix, Quaternion, Vector3 } from "@babylonjs/core/Maths/math.vector";
import { Mesh } from "@babylonjs/core/Meshes/mesh";
import { MeshBuilder } from "@babylonjs/core/Meshes/meshBuilder";
import { Node } from "@babylonjs/core/node";
import { PBRMaterial } from "@babylonjs/core/Materials/PBR/pbrMaterial";
import { Scene } from "@babylonjs/core/scene";
import { StandardMaterial } from "@babylonjs/core/Materials/standardMaterial";
import { TransformNode } from "@babylonjs/core/Meshes/transformNode";
import { BodyZone, HitKind } from "../config/game";
import { alignDir, forceWorld, worldPos } from "../core/ik";
import { findIn } from "../enemies/SoldierSkin";
import { extFor } from "../weapons/ArmsRig";
import hostageUrl from "../assets/characters/hostage.glb?url";
import cuffsUrl from "../assets/props/handcuffs.glb?url";
import tapeUrl from "../assets/props/betamax.glb?url";
import sitToStandUrl from "../assets/anims/sit-to-stand.json?url";

/**
 * The hostage ("Prisoner Hostage Low Poly Character" by 00amza, CC BY 4.0, Mixamo rig): seated on a
 * wooden chair, hands cuffed in his lap ("Handcuffs", CC BY 4.0, simplified by
 * scripts/assets/prep-props.mjs). Freed, the cuffs drop to the ground and he gets up with Mixamo's
 * "Sit To Stand" (baked by scripts/assets/fbx-anim.mjs into bone directions per frame).
 *
 * Every pose — the mocap frames and the few hand-set ones (cuffed hands, slumped when shot) — is a
 * set of bone directions in his body frame (x his right, y up, z forward); each bone is turned to
 * its direction, parents first, so his own rest pose (a T-pose) and bone axes don't matter. He has
 * hitboxes like a soldier's: your bullets (and blasts) can kill him; enemy fire can't.
 *
 * Once he's up he turns to face you (faceTo), reaches into his coat and holds out a video tape
 * ("Sony Betamax Video Tape" by Tomek Suchodolski, CC BY 4.0, prepared by prep-props.mjs) for you
 * to take.
 */

type Dir = [number, number, number];
interface Clip {
  fps: number;
  pairs: [string, string][];
  /** per frame: pelvis (right, up from the feet, forward) as a fraction of the standing hip height; directions per pair */
  frames: { hip: Dir; d: Dir[] }[];
}

/** cuffed: hands side by side in his lap, the cuffs' chain between the wrists (left side; the right is mirrored: x → -x) */
const CUFFED: Record<string, Dir> = {
  LeftArm: [-0.1, -0.86, 0.5],
  LeftForeArm: [0.42, -0.36, 0.83],
  LeftHand: [0.3, -0.42, 0.86],
};
/** shot: slumped forward, head on his chest */
const SLUMPED: Record<string, Dir> = {
  Spine1: [0, 1, 0.28],
  Spine2: [0, 1, 0.32],
  Neck: [0, 0.6, 0.8],
  Head: [0, 0.05, 1],
};
/** into his coat: the right hand at the left breast (the tape's in the lining) */
const REACH_IN: Record<string, Dir> = {
  RightArm: [0.18, -0.8, 0.56],
  RightForeArm: [-0.78, 0.42, 0.46],
  RightHand: [-0.85, 0.3, 0.42],
};
/** holding it out to you: arm forward, hand flat */
const OFFER: Record<string, Dir> = {
  RightArm: [0.12, -0.32, 0.94],
  RightForeArm: [0, 0.1, 1],
  RightHand: [0, -0.05, 1],
};
/** reach in, take it out, hold it out (seconds) */
const OFFER_IN = 0.7, OFFER_OUT = 1.5;
/** how fast he turns to face you (rad/s) */
const TURN_RATE = 2.4;
const mirror = (d: Dir): Dir => [-d[0], d[1], d[2]];
const lerpDir = (a: Dir, b: Dir, t: number): Dir => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
const M = (n: string) => "mixamorig:" + n;

export class HostageModel {
  private constructor(private c: AssetContainer, private clip: Clip, private cuffs: AssetContainer, private tape: AssetContainer) {}
  static async load(scene: Scene) {
    const [c, clip, cuffs, tape] = await Promise.all([
      LoadAssetContainerAsync(hostageUrl, scene, { pluginExtension: extFor(hostageUrl) }),
      fetch(sitToStandUrl).then((r) => r.json() as Promise<Clip>),
      LoadAssetContainerAsync(cuffsUrl, scene, { pluginExtension: extFor(cuffsUrl) }),
      LoadAssetContainerAsync(tapeUrl, scene, { pluginExtension: extFor(tapeUrl) }),
    ]);
    for (const m of tape.materials) if (m instanceof PBRMaterial) m.maxSimultaneousLights = 4;
    for (const m of cuffs.materials)
      if (m instanceof PBRMaterial) {
        m.maxSimultaneousLights = 4;
        m.albedoColor = new Color3(0.78, 0.79, 0.82);
        m.metallic = 0.9;
        m.roughness = 0.28;
      }
    for (const g of c.animationGroups) g.stop();
    for (const m of c.materials) {
      if (!(m instanceof PBRMaterial)) continue;
      m.maxSimultaneousLights = 4;
      m.metallic = 0;
      m.roughness = 0.85;
      m.environmentIntensity = 0.8;
    }
    return new HostageModel(c, clip, cuffs, tape);
  }
  place(scene: Scene, at: Vector3, yaw: number, onShot: () => void) {
    return new Hostage(scene, this.c, this.clip, this.cuffs, this.tape, at, yaw, onShot);
  }
}

export class Hostage {
  readonly anchor: TransformNode;
  /** blocks movement round the chair */
  readonly solid: Mesh;
  /** the bullet target interface (WeaponManager): alive while he's a hostage in danger */
  alive = true;
  /** which way he faces (turns to face you once he's up) */
  heading: number;
  /** the chair */
  readonly position: Vector3;
  /** the video tape: hidden till he takes it out of his coat (the mission moves it once you take it) */
  readonly tape: TransformNode;
  /** holding the tape out (the hand-out has played to the end) */
  get offering() {
    return this.offerT >= OFFER_IN + OFFER_OUT;
  }
  freed = false;
  /** the stand-up: seconds played (-1 = not started) */
  private standT = -1;
  private dead = false;
  private root: TransformNode;
  private b: Record<string, TransformNode> = {};
  private rest = new Map<TransformNode, { q: Quaternion; p: Vector3 }>();
  /** the handcuffs: the model under a holder turned so its rings sit round his wrists */
  private cuffs!: TransformNode;
  /** the model's long axis (ring to ring), the axis through the rings, the ring-centre spacing */
  private cuffAxes = { long: 0, through: 2, span: 0.164 };
  private hitboxes: Mesh[] = [];
  private fwd = new Vector3();
  private right = new Vector3();
  private hipH = 1;
  private struggleT = 0;
  private neckBase = new Quaternion();
  /** the pose's ground point (the chair; moved as he turns, so he turns where he stands) */
  private base = new Vector3();
  /** anchor yaw − heading (the model's own facing) */
  private yawOff = 0;
  private yaw0: number;
  /** the hand-out: seconds played (-1 = not started); where to look (a head-top tilt, radians) */
  private offerT = -1;
  private lookPitch = 0;
  /** the tape's in his hand, not yours */
  private tapeHeld = false;
  private tapeGiven = false;
  private lowerT = 0;

  constructor(scene: Scene, c: AssetContainer, private clip: Clip, cuffs: AssetContainer, tape: AssetContainer, at: Vector3, yaw: number, private onShot: () => void) {
    this.heading = this.yaw0 = yaw;
    this.base.copyFrom(at);
    this.position = at.clone();
    this.anchor = new TransformNode("hostage", scene);
    this.anchor.position.copyFrom(at);
    const inst = c.instantiateModelsToScene((n) => `${n}#901`, false, { doNotInstantiate: true });
    for (const g of inst.animationGroups) g.stop();
    this.root = inst.rootNodes[0] as TransformNode;
    this.root.parent = this.anchor;
    const all = this.root.getDescendants(false) as Node[];
    for (const m of all)
      if (m instanceof AbstractMesh) {
        m.isPickable = false;
        m.alwaysSelectAsActiveMesh = true;
      }
    const need = (n: string) => {
      const t = findIn(all, M(n));
      if (!t) throw new Error("hostage rig: missing " + n);
      if (!t.rotationQuaternion) t.rotationQuaternion = Quaternion.FromEulerVector(t.rotation);
      return t;
    };
    for (const [a, b] of clip.pairs) {
      this.b[a] = need(a);
      this.b[b] = need(b);
    }

    // size: 1.75 m tall; facing: turn the model so his toes point along the anchor's +Z
    forceWorld(this.root);
    const top = worldPos(this.b.HeadTop_End).y, feet = (worldPos(this.b.LeftFoot).y + worldPos(this.b.RightFoot).y) / 2;
    this.root.scaling.scaleInPlace(1.75 / Math.max(0.01, top - feet + 0.08));
    forceWorld(this.root);
    const toe = worldPos(this.b.LeftToeBase).subtract(worldPos(this.b.LeftFoot)).add(worldPos(this.b.RightToeBase).subtract(worldPos(this.b.RightFoot)));
    this.anchor.rotation.y = yaw - Math.atan2(toe.x, toe.z);
    this.yawOff = this.anchor.rotation.y - yaw;
    forceWorld(this.root);
    this.hipH = worldPos(this.b.Hips).y - Math.min(worldPos(this.b.LeftToeBase).y, worldPos(this.b.RightToeBase).y);
    this.fwd.set(Math.sin(yaw), 0, Math.cos(yaw));
    this.right.set(Math.cos(yaw), 0, -Math.sin(yaw));
    for (const n of Object.values(this.b)) this.rest.set(n, { q: n.rotationQuaternion!.clone(), p: n.position.clone() });

    this.chair(scene, at, yaw);
    this.solid = MeshBuilder.CreateBox("hostageSolid", { width: 0.6, height: 1.3, depth: 0.75 }, scene);
    this.solid.position.set(at.x, at.y + 0.65, at.z);
    this.solid.rotation.y = yaw;
    this.solid.isVisible = false;
    this.solid.isPickable = false;
    this.solid.checkCollisions = true;
    this.makeCuffs(scene, cuffs);
    this.tape = this.makeTape(scene, tape);
    this.pose(0, CUFFED);
    this.makeHitboxes(scene);
    this.placeCuffs();
  }

  // ------------------------------------------------------------------ pose
  private w(d: Dir) {
    return this.right.scale(d[0]).addInPlace(new Vector3(0, d[1], 0)).addInPlace(this.fwd.scale(d[2])).normalize();
  }

  /**
   * Frame `f` (fractional) of Sit To Stand, with some bones overridden (`over`, left side given; the
   * right is mirrored) blended in by `w`.
   */
  private pose(f: number, over: Record<string, Dir> = {}, w = 1, over2: Record<string, [Dir, number]> = {}) {
    const C = this.clip;
    const i0 = Math.max(0, Math.min(C.frames.length - 1, Math.floor(f))), i1 = Math.min(C.frames.length - 1, i0 + 1), u = f - i0;
    const A = C.frames[i0], B = C.frames[i1];
    const lerp = (a: Dir, b: Dir, t: number): Dir => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
    for (const [n, r] of this.rest) {
      n.rotationQuaternion!.copyFrom(r.q);
      n.position.copyFrom(r.p);
    }
    // pelvis: on the seat at frame 0, then where the clip takes it (scaled to his body)
    const hip = lerp(A.hip, B.hip, u);
    const want = this.base
      .add(this.right.scale(hip[0] * this.hipH))
      .addInPlace(new Vector3(0, hip[1] * this.hipH, 0))
      .addInPlace(this.fwd.scale(hip[2] * this.hipH - 0.06));
    const inv = new Matrix();
    forceWorld(this.b.Hips.parent as TransformNode).invertToRef(inv);
    Vector3.TransformCoordinatesToRef(want, inv, this.b.Hips.position);
    C.pairs.forEach(([bone, child], k) => {
      let d = lerp(A.d[k], B.d[k], u);
      const o = over[bone] ?? (bone.startsWith("Right") ? over["Left" + bone.slice(5)] && mirror(over["Left" + bone.slice(5)]) : undefined);
      if (o) d = lerp(d, o, w);
      const o2 = over2[bone];
      if (o2) d = lerp(d, o2[0], o2[1]);
      const n = this.b[bone], c = this.b[child];
      const from = worldPos(c).subtract(worldPos(n));
      alignDir(n, from, this.w(d), () => worldPos(c).subtract(worldPos(n)));
    });
    this.neckBase.copyFrom(this.b.Neck.rotationQuaternion!);
  }

  /** a frame: restless while cuffed, the stand-up once freed */
  update(dt: number) {
    if (this.dead) return;
    if (this.standT >= 0) {
      const C = this.clip;
      this.standT += dt;
      const f = Math.min(C.frames.length - 1, this.standT * C.fps);
      // his hands come out of the cuffed pose over the first third of a second
      const extra: Record<string, [Dir, number]> = {};
      if (this.offerT >= 0) {
        this.offerT += dt;
        const t = this.offerT;
        // in to the coat, then out to you
        const arm = t < OFFER_IN ? REACH_IN : mixPose(REACH_IN, OFFER, smooth(Math.min(1, (t - OFFER_IN) / OFFER_OUT)));
        // (and once you've taken it, his arm comes back down)
        if (this.tapeGiven) this.lowerT += dt;
        const w = (t < OFFER_IN ? smooth(t / OFFER_IN) : 1) * (1 - smooth(Math.min(1, this.lowerT / 0.9)));
        for (const k in arm) extra[k] = [arm[k], w];
        if (t >= OFFER_IN * 0.85 && !this.tapeGiven) this.tapeHeld = true;
      }
      // his head tipped to look you in the eye (Head points at the top of his head)
      // (the head bone's axis leans back from his face: a touch forward reads as level)
      if (this.standing) extra.Head = [[0, Math.cos(this.lookPitch), 0.16 - Math.sin(this.lookPitch)], 1];
      this.pose(f, CUFFED, Math.max(0, 1 - this.standT / 0.35), extra);
      if (this.tapeHeld) this.placeTape();
      return;
    }
    if (this.freed) return;
    this.struggleT += dt;
    const s = Math.sin(this.struggleT * 1.7) * 0.07 + Math.sin(this.struggleT * 0.53) * 0.06;
    this.neckBase.multiplyToRef(Quaternion.RotationAxis(new Vector3(0, 0, 1), s), this.b.Neck.rotationQuaternion!);
    this.placeCuffs();
  }

  /**
   * Up on his feet: turn (at a walking turn rate) to face `eye`, and look at it. He turns where he
   * stands: the ground point moves so his pelvis stays put.
   */
  faceTo(eye: Vector3, dt: number) {
    if (!this.standing || this.dead) return;
    const hips = worldPos(this.b.Hips);
    const want = Math.atan2(eye.x - hips.x, eye.z - hips.z);
    let d = want - this.heading;
    d = Math.atan2(Math.sin(d), Math.cos(d));
    const step = Math.max(-TURN_RATE * dt, Math.min(TURN_RATE * dt, d));
    const head = worldPos(this.b.Head);
    this.lookPitch = Math.max(-0.5, Math.min(0.5, Math.atan2(eye.y - head.y, Math.hypot(eye.x - head.x, eye.z - head.z))));
    if (Math.abs(step) < 1e-5) return;
    // the pelvis's offset from the ground point, before and after the turn
    const C = this.clip, hip = C.frames[C.frames.length - 1].hip;
    const off = (fwd: Vector3, right: Vector3) => right.scale(hip[0] * this.hipH).addInPlace(fwd.scale(hip[2] * this.hipH - 0.06));
    const before = off(this.fwd, this.right);
    this.heading += step;
    this.fwd.set(Math.sin(this.heading), 0, Math.cos(this.heading));
    this.right.set(Math.cos(this.heading), 0, -Math.sin(this.heading));
    this.base.addInPlace(before).subtractInPlace(off(this.fwd, this.right));
    this.anchor.position.copyFrom(this.base);
    this.anchor.rotation.y = this.heading + this.yawOff;
  }

  /** take the tape out of his coat and hold it out */
  offerTape() {
    if (this.offerT < 0) this.offerT = 0;
  }

  /** the stand-up has played to the end */
  get standing() {
    return this.standT >= this.clip.frames.length / this.clip.fps;
  }

  // ------------------------------------------------------------------ chair and cuffs
  private chair(scene: Scene, at: Vector3, yaw: number) {
    const wood = new StandardMaterial("chairWood", scene);
    wood.diffuseColor = new Color3(0.2, 0.14, 0.09);
    wood.specularColor = new Color3(0.05, 0.05, 0.05);
    const root = new TransformNode("chairRoot", scene);
    root.position.copyFrom(at);
    root.rotation.y = yaw;
    const part = (w: number, h: number, d: number, x: number, y: number, z: number) => {
      const m = MeshBuilder.CreateBox("chair", { width: w, height: h, depth: d }, scene);
      m.material = wood;
      m.parent = root;
      m.position.set(x, y, z);
      m.isPickable = false;
    };
    part(0.48, 0.05, 0.46, 0, 0.45, 0);
    for (const [x, z] of [[-0.21, -0.2], [0.21, -0.2], [-0.21, 0.2], [0.21, 0.2]]) part(0.045, 0.45, 0.045, x, 0.225, z);
    for (const x of [-0.21, 0.21]) part(0.05, 0.62, 0.05, x, 0.78, -0.21);
    for (const y of [0.72, 0.96]) part(0.47, 0.07, 0.035, 0, y, -0.21);
  }

  private makeCuffs(scene: Scene, c: AssetContainer) {
    const inst = c.instantiateModelsToScene((n) => `${n}#cuffs`, false, { doNotInstantiate: true });
    this.cuffs = new TransformNode("cuffs", scene);
    this.cuffs.rotationQuaternion = new Quaternion();
    (inst.rootNodes[0] as TransformNode).parent = this.cuffs;
    const meshes = this.cuffs.getChildMeshes(false);
    for (const m of meshes) {
      m.isPickable = false;
      m.alwaysSelectAsActiveMesh = true;
    }
    // measure it in its own frame: longest side runs ring to ring, the thinnest goes through the rings
    const min = new Vector3(Infinity, Infinity, Infinity), max = min.scale(-1);
    this.cuffs.computeWorldMatrix(true);
    for (const m of meshes) {
      m.computeWorldMatrix(true);
      m.refreshBoundingInfo({});
      const b = m.getBoundingInfo().boundingBox;
      min.minimizeInPlace(b.minimumWorld);
      max.maximizeInPlace(b.maximumWorld);
    }
    const size = max.subtract(min).asArray();
    const long = size.indexOf(Math.max(...size)), through = size.indexOf(Math.min(...size));
    // (each ring's centre sits a ring-radius in from its end)
    const third = 3 - long - through;
    this.cuffAxes = { long, through, span: size[long] - size[third] };
  }

  /** turn the cuffs so their long axis lies along `x` and the rings face along `n`, at `p` */
  private setCuffs(p: Vector3, x: Vector3, n: Vector3, stretch: number) {
    const { long, through } = this.cuffAxes;
    const W: Vector3[] = [];
    W[long] = x;
    W[through] = n;
    const k = 3 - long - through;
    W[k] = through === (long + 1) % 3 ? Vector3.Cross(x, n) : Vector3.Cross(n, x);
    Quaternion.RotationQuaternionFromAxisToRef(W[0], W[1], W[2], this.cuffs.rotationQuaternion!);
    this.cuffs.position.copyFrom(p);
    const s = [1, 1, 1];
    s[long] = stretch;
    this.cuffs.scaling.set(s[0], s[1], s[2]);
  }

  private makeTape(scene: Scene, c: AssetContainer) {
    const inst = c.instantiateModelsToScene((n) => `${n}#tape`, false, { doNotInstantiate: true });
    const t = new TransformNode("tapeHeld", scene);
    t.rotationQuaternion = new Quaternion();
    (inst.rootNodes[0] as TransformNode).parent = t;
    for (const m of t.getChildMeshes(false)) {
      m.isPickable = false;
      m.alwaysSelectAsActiveMesh = true;
    }
    t.setEnabled(false);
    return t;
  }

  /** in his right hand: flat on the fingers, long side across, label up */
  private placeTape() {
    const hand = worldPos(this.b.RightHand), mid = worldPos(this.b.RightHandMiddle1);
    const along = mid.subtract(hand);
    // (in his fingers, sitting just on them)
    const p = hand.add(along.scale(1.5)).addInPlace(new Vector3(0, -0.005, 0));
    // across his hand (his right, turned to the hand's heading), up, along the hand
    const fwd = new Vector3(along.x, 0, along.z);
    if (fwd.lengthSquared() < 1e-6) fwd.copyFrom(this.fwd);
    fwd.normalize();
    const x = new Vector3(fwd.z, 0, -fwd.x);
    Quaternion.RotationQuaternionFromAxisToRef(x, Vector3.Up(), fwd, this.tape.rotationQuaternion!);
    this.tape.position.copyFrom(p);
    this.tape.setEnabled(true);
  }

  /** you've taken it: his hand's empty */
  handOver() {
    this.tapeHeld = false;
    this.tapeGiven = true;
  }

  /** a ring round each wrist, the chain between */
  private placeCuffs() {
    const wrists: Vector3[] = [];
    const along = new Vector3();
    ["Left", "Right"].forEach((s) => {
      const hand = worldPos(this.b[s + "Hand"]);
      const a = hand.subtract(worldPos(this.b[s + "ForeArm"])).normalize();
      along.addInPlace(a);
      // just above the wrist joint, round the end of the forearm
      wrists.push(hand.subtract(a.scale(0.025)));
    });
    const span = wrists[0].subtract(wrists[1]);
    const len = span.length();
    const x = span.scale(1 / Math.max(1e-4, len));
    // the rings face along the forearms (made square to the line between the wrists)
    const n = along.subtract(x.scale(Vector3.Dot(along, x))).normalize();
    this.setCuffs(wrists[0].add(wrists[1]).scale(0.5), x, n, Math.min(1.5, Math.max(0.8, len / this.cuffAxes.span)));
  }

  /** off: dropped on the ground in front of the chair */
  private dropCuffs() {
    const p = this.position.add(this.fwd.scale(0.42)).addInPlace(this.right.scale(-0.18));
    p.y = this.position.y + 0.012;
    const x = this.right.scale(Math.cos(0.6)).addInPlace(this.fwd.scale(Math.sin(0.6)));
    this.setCuffs(p, x, Vector3.Up(), 1);
  }

  private makeHitboxes(scene: Scene) {
    const box = (bone: string, w: number, h: number, d: number, zone: BodyZone) => {
      const m = MeshBuilder.CreateBox("hostageHit", { width: w, height: h, depth: d }, scene);
      m.isVisible = false;
      m.isPickable = true;
      m.metadata = { kind: HitKind.EnemyPart, enemy: this, zone };
      m.position.copyFrom(worldPos(this.b[bone]));
      m.rotation.y = this.heading;
      this.hitboxes.push(m);
    };
    box("Spine1", 0.42, 0.55, 0.32, "torso");
    box("Head", 0.22, 0.26, 0.24, "head");
    box("LeftUpLeg", 0.4, 0.2, 0.5, "limb");
  }

  // ------------------------------------------------------------------ events
  /** a player's bullet (WeaponManager) — or a blast. Reports "not a kill": no kill-confirm for him */
  applyHit(): boolean {
    if (!this.alive) return false;
    this.alive = false;
    this.dead = true;
    this.pose(0, { ...CUFFED, ...SLUMPED });
    this.placeCuffs();
    this.onShot();
    return false;
  }

  /** a blast at `pos`: does it reach him? */
  inBlast(pos: Vector3, radius: number) {
    return this.alive && Vector3.Distance(pos, worldPos(this.b.Spine1)) < radius * 0.75;
  }

  /** the cuffs come off */
  free() {
    this.freed = true;
    this.alive = false;
    this.dropCuffs();
    for (const h of this.hitboxes) h.isPickable = false;
    this.solid.checkCollisions = false;
  }
  /** he gets up (Sit To Stand) */
  standUp() {
    this.standT = 0;
  }

  /** head position (cinematic cameras) */
  headPos() {
    return worldPos(this.b.Head);
  }

  reset() {
    this.freed = false;
    this.dead = false;
    this.alive = true;
    this.standT = -1;
    this.offerT = -1;
    this.tapeHeld = false;
    this.tapeGiven = false;
    this.lowerT = 0;
    this.tape.setEnabled(false);
    this.lookPitch = 0;
    this.heading = this.yaw0;
    this.fwd.set(Math.sin(this.heading), 0, Math.cos(this.heading));
    this.right.set(Math.cos(this.heading), 0, -Math.sin(this.heading));
    this.base.copyFrom(this.position);
    this.anchor.position.copyFrom(this.position);
    this.anchor.rotation.y = this.heading + this.yawOff;
    for (const h of this.hitboxes) h.isPickable = true;
    this.solid.checkCollisions = true;
    this.root.setEnabled(true);
    this.pose(0, CUFFED);
    this.placeCuffs();
  }
}

const smooth = (t: number) => t * t * (3 - 2 * t);
function mixPose(a: Record<string, Dir>, b: Record<string, Dir>, t: number) {
  const out: Record<string, Dir> = {};
  for (const k of Object.keys(b)) out[k] = a[k] ? lerpDir(a[k], b[k], t) : b[k];
  return out;
}
