import { AbstractMesh } from "@babylonjs/core/Meshes/abstractMesh";
import { Color3 } from "@babylonjs/core/Maths/math.color";
import { LoadAssetContainerAsync } from "@babylonjs/core/Loading/sceneLoader";
import { Mesh } from "@babylonjs/core/Meshes/mesh";
import { MeshBuilder } from "@babylonjs/core/Meshes/meshBuilder";
import { MorphTargetManager } from "@babylonjs/core/Morph/morphTargetManager";
import { PBRMaterial } from "@babylonjs/core/Materials/PBR/pbrMaterial";
import { Matrix, Quaternion, Vector3 } from "@babylonjs/core/Maths/math.vector";
import { Scene } from "@babylonjs/core/scene";
import { TransformNode } from "@babylonjs/core/Meshes/transformNode";
import { AudioEngine } from "../audio/AudioEngine";
import { BodyZone, HitKind } from "../config/game";
import { lookRotation } from "../core/math";
import { NavGraph } from "../level/NavGraph";
import { SkinnedModel, type Rig } from "../allies/HeroRig";
import { ThrusterFx } from "../allies/IronFx";
import type { Dir } from "../allies/SpiderRig";
import {
  HIT, LANDING, PERCH, TUCK, DIVE_KICK, UPPER, aimArm, clipDur, copyPose, follow, loadSpiderClips, mixPose, newPose, pose, sample,
  type ClipName, type DirClip,
} from "../allies/SpiderPoses";
import { SpriteStream } from "../fx/SuperFx";
import { extFor } from "../weapons/ArmsRig";
import type { Combatant, Foe, HulkHost, HulkThreat } from "./Hulk";
import batmanUrl from "../assets/characters/batman.glb?url";
import batmobileUrl from "../assets/characters/batmobile.glb?url";
import batarangUrl from "../assets/characters/batarang.glb?url";
import gunUrl from "../assets/characters/deagle.glb?url";
import { bakeWorld, mergeParts, normaliseGun } from "../allies/Deadpool";

/**
 * BATMAN — on the Hulk's side tonight ("Batman Rigged (HatchXR)" by nitwit.friends: a Mixamo rig
 * with his own run, stand, walk, jumps and punch; his car is "Arkham Knight Batmobile (ADVANCED
 * RIG)" by northsideanimation; both CC BY 4.0).
 *
 * He arrives in the Batmobile: you hear the turbine first, then it comes down the open ground at
 * you with its afterburner lit, throws itself into a power-slide broadside on, stops in a cloud of
 * dust — the canopy slides open, he rises out of the seat, leaps over the bonnet and lands in front
 * of you. The car stays where he left it (you can't walk through it).
 *
 * He fights like himself: patient and precise. Combos in close (his own punch and the mocap
 * hooks, elbows and kicks), a leaping flying kick, a fan of batarangs from range (they stagger the
 * heroes), and his signature: a smoke pellet — he's gone, and a second later he's behind whoever he
 * wants, with a takedown. He rolls out of a fusillade, and he's armoured (bullets do a third).
 * Superman's ice holds him; Superman's fist sends him flying.
 */

export interface BatmanHost {
  scene: Scene;
  nav: NavGraph;
  audio: AudioEngine;
  player: HulkHost["player"];
  allies: () => Combatant[];
  holdFight: () => boolean;
  /** the one he has a score to settle with (Deadpool; Superman) — he'll go for him first */
  rival?: () => Combatant | null;
  dust: (pos: Vector3, power: number) => void;
  spark: (pos: Vector3, normal: Vector3) => void;
  blood: (pos: Vector3, dir: Vector3) => void;
  tracer: (from: Vector3, to: Vector3) => void;
  onDown: () => void;
}

type State = "dormant" | "intro" | "held" | "chase" | "attack" | "pounce" | "throw" | "gun" | "smoke" | "dodge" | "webbed" | "stagger" | "frozen" | "air" | "getup" | "down";

const G = 20;
const B = {
  health: 2500,
  /** his armour: bullets do a third */
  bulletFactor: 0.34,
  run: 7.0,
  sprint: 8.8,
  reach: 2.2,
};
/** his close combos: clip ("own:" = his model's own clip), speed, blows (fraction), damage to you / a hero */
const COMBOS: { clip: string; speed: number; hits: number[]; dmg: number; hero: number }[] = [
  { clip: "own:punch", speed: 1.25, hits: [0.45], dmg: 12, hero: 22 },
  { clip: "combo", speed: 1.5, hits: [0.12, 0.32, 0.56, 0.72, 0.79], dmg: 5, hero: 10 },
  { clip: "elbowCombo", speed: 1.7, hits: [0.119, 0.371, 0.503, 0.589, 0.861], dmg: 5, hero: 10 },
  { clip: "hook", speed: 1.35, hits: [0.29], dmg: 12, hero: 22 },
  { clip: "mmaKick3", speed: 1.25, hits: [0.388], dmg: 14, hero: 26 },
  { clip: "kick", speed: 1.5, hits: [0.56], dmg: 12, hero: 22 },
];
const LINES = {
  intro: ["You should have stayed out of this."],
  intro2: ["Let's finish it."],
  taunt: ["Predictable.", "Stay down.", "I've already won. You just don't know it yet.", "Is that all?"],
  hurt: ["Not bad.", "…Impressive."],
  smoke: ["Looking for me?", "Behind you."],
  superman: ["Clark. Of course."],
  down: ["…This isn't over."],
};

const V = (x = 0, y = 0, z = 0) => new Vector3(x, y, z);
const flat = (v: Vector3) => new Vector3(v.x, 0, v.z);
const angDiff = (a: number, b: number) => Math.atan2(Math.sin(a - b), Math.cos(a - b));
const rnd = (a: number, b: number) => a + Math.random() * (b - a);
const pick = <T,>(a: T[]) => a[Math.floor(Math.random() * a.length)];
const norm = (d: Dir): Dir => {
  const l = Math.hypot(d[0], d[1], d[2]) || 1;
  return [d[0] / l, d[1] / l, d[2] / l];
};

/** his guard: square, fists high, chin down */
const GUARD = pose(
  {
    hips: [0, 1, 0.06], spine: [0, 1, 0.1], spine1: [0, 1, 0.12], spine2: [0, 1, 0.08], neck: [0, 1, 0.1], head: [0, 0.97, 0.22],
    lArm: [-0.38, -0.75, 0.55], lFore: [0.25, 0.6, 0.76], lHand: [0.2, 0.4, 0.9],
    rArm: [0.36, -0.8, 0.48], rFore: [-0.2, 0.55, 0.8], rHand: [-0.15, 0.35, 0.92],
    lThigh: [-0.18, -0.95, 0.22], lShin: [-0.04, -0.97, -0.22], lFoot: [-0.12, -0.35, 0.93],
    rThigh: [0.2, -0.96, -0.15], rShin: [0.05, -0.93, -0.32], rFoot: [0.25, -0.3, 0.92],
  },
  [0, 0.94, 0],
);
/** his landing: a deep crouch, knees wide, the fists low and spread out to the sides — the cape's shape */
const BAT_LAND = pose(
  {
    hips: [0, 0.85, 0.52], spine: [0, 0.8, 0.6], spine1: [0, 0.82, 0.57], spine2: [0, 0.88, 0.47], neck: [0, 0.92, 0.38], head: [0, 0.98, 0.18],
    lArm: [-0.85, -0.5, 0.15], lFore: [-0.75, -0.62, 0.2], lHand: [-0.6, -0.78, 0.15],
    rArm: [0.85, -0.5, 0.15], rFore: [0.75, -0.62, 0.2], rHand: [0.6, -0.78, 0.15],
    lThigh: [-0.55, -0.3, 0.78], lShin: [-0.1, -0.99, -0.05], lFoot: [-0.35, -0.3, 0.88],
    rThigh: [0.55, -0.3, 0.78], rShin: [0.1, -0.99, -0.05], rFoot: [0.35, -0.3, 0.88],
  },
  [0, 0.5, -0.05],
);
/** the throw: the right arm whipped across, the batarangs leaving his fingers */
const THROW = pose(
  {
    hips: [0, 1, 0.05], spine: [0.1, 1, 0.1], spine1: [0.15, 1, 0.12], spine2: [0.15, 1, 0.1], neck: [0, 1, 0.1], head: [0, 0.97, 0.22],
    lArm: [-0.6, -0.6, 0.4], lFore: [-0.2, 0.2, 0.95],
    rArm: [-0.25, -0.1, 0.96], rFore: [-0.6, 0.05, 0.8], rHand: [-0.7, 0, 0.7],
    lThigh: [-0.2, -0.95, 0.2], rThigh: [0.22, -0.95, -0.2], rShin: [0.05, -0.9, -0.4],
  },
  [0, 0.93, 0],
);

/**
 * The Batmobile: scaled to 6.6 m, nose along +Z on its anchor; the four wheels on pivots of their
 * own (they spin with the ground speed, the front pair steer), the canopy's own morph opens it.
 */
export class Batmobile {
  readonly anchor: TransformNode;
  private model: TransformNode;
  private wheels: { pivot: TransformNode; front: boolean; r: number }[] = [];
  private canopy: MorphTargetManager[] = [];
  readonly meshes: AbstractMesh[] = [];
  readonly solid: Mesh;
  readonly length: number;
  /** the exhaust (local to the anchor) and the cockpit (where he sits) */
  readonly tail: Vector3;
  readonly seat: Vector3;
  private spin = 0;
  private constructor(scene: Scene, root: TransformNode[], meshes: AbstractMesh[]) {
    this.anchor = new TransformNode("batmobile", scene);
    this.anchor.rotationQuaternion = new Quaternion();
    this.model = new TransformNode("batmobileModel", scene);
    this.model.parent = this.anchor;
    for (const r of root) r.parent = this.model;
    // its bounds (as loaded: nose to +Z, up +Y) → 6.6 m long, sat on y = 0, centred
    let lo = V(Infinity, Infinity, Infinity), hi = V(-Infinity, -Infinity, -Infinity);
    for (const m of meshes) {
      m.computeWorldMatrix(true);
      const bb = m.getBoundingInfo().boundingBox;
      lo = Vector3.Minimize(lo, bb.minimumWorld);
      hi = Vector3.Maximize(hi, bb.maximumWorld);
    }
    const k = 6.6 / (hi.z - lo.z);
    this.model.scaling.setAll(k);
    // (the lowest bounds are the brake discs and the tread's bounding corners: the tyres sit 0.22 m lower)
    this.model.position.set(-((lo.x + hi.x) / 2) * k, -lo.y * k - 0.22, -((lo.z + hi.z) / 2) * k);
    this.length = 6.6;
    this.tail = V(0, (hi.y - lo.y) * k * 0.42, -3.35);
    // (everything's world matrix again, now it's scaled and placed)
    this.anchor.computeWorldMatrix(true);
    this.model.computeWorldMatrix(true);
    for (const n of this.model.getDescendants(false)) (n as TransformNode).computeWorldMatrix?.(true);
    // the seat: under the canopy (the parts that have its morph)
    let sa = V(Infinity, Infinity, Infinity), sb = V(-Infinity, -Infinity, -Infinity);
    for (const m of meshes)
      if ((m as Mesh).morphTargetManager) {
        const bb = m.getBoundingInfo().boundingBox;
        sa = Vector3.Minimize(sa, bb.minimumWorld);
        sb = Vector3.Maximize(sb, bb.maximumWorld);
      }
    this.seat = isFinite(sa.x) ? sa.add(sb).scale(0.5).addInPlaceFromFloats(0, -0.45, 0) : V(0, (hi.y - lo.y) * k * 0.6, 1.2);
    for (const m of meshes) {
      m.isPickable = false;
      m.receiveShadows = true;
      m.alwaysSelectAsActiveMesh = true;
      this.meshes.push(m);
      const mm = (m as Mesh).morphTargetManager;
      if (mm) this.canopy.push(mm);
    }
    // the wheels: a pivot at each wheel's centre (the parts grouped by their node), parented under the model
    this.anchor.computeWorldMatrix(true);
    const groups = new Map<string, AbstractMesh[]>();
    for (const m of meshes) {
      const key = /Wheel\.(Ft|Br|Bk)\.(L|R)/.exec(m.parent?.name ?? m.name)?.[0];
      if (!key) continue;
      (groups.get(key) ?? groups.set(key, []).get(key)!).push(m);
    }
    for (const [key, parts] of groups) {
      let a = V(Infinity, Infinity, Infinity), b = V(-Infinity, -Infinity, -Infinity);
      for (const p of parts) {
        p.computeWorldMatrix(true);
        const bb = p.getBoundingInfo().boundingBox;
        a = Vector3.Minimize(a, bb.minimumWorld);
        b = Vector3.Maximize(b, bb.maximumWorld);
      }
      const c = a.add(b).scale(0.5);
      const pivot = new TransformNode("bmWheel_" + key, scene);
      pivot.position.copyFrom(c);
      pivot.rotationQuaternion = new Quaternion();
      pivot.setParent(this.anchor);
      const holder = parts[0].parent as TransformNode;
      holder.setParent(pivot);
      this.wheels.push({ pivot, front: /Ft/.test(key), r: (b.y - a.y) / 2 });
    }
    this.solid = MeshBuilder.CreateBox("batmobileSolid", { width: 2.9, height: 1.7, depth: 6.4 }, scene);
    this.solid.isVisible = false;
    this.solid.isPickable = false;
    this.solid.checkCollisions = false;
    this.solid.parent = this.anchor;
    this.solid.position.y = 0.85;
    this.setVisible(false);
  }
  static async load(scene: Scene) {
    const c = await LoadAssetContainerAsync(batmobileUrl, scene, { pluginExtension: extFor(batmobileUrl) });
    for (const g of c.animationGroups) g.stop();
    c.addAllToScene();
    for (const m of c.materials)
      if (m instanceof PBRMaterial) {
        m.maxSimultaneousLights = 4;
        m.environmentIntensity = 1.3;
      }
    const meshes = c.meshes.filter((m) => m.getTotalVertices() > 0);
    return new Batmobile(scene, c.rootNodes as TransformNode[], meshes);
  }
  setVisible(v: boolean) {
    this.anchor.setEnabled(v);
    this.solid.checkCollisions = v;
  }
  /** where it is, which way, how fast (m/s: the wheels roll), the front wheels' steer (rad) */
  place(at: Vector3, yaw: number, speed: number, steer: number, dt: number, roll = 0) {
    this.anchor.position.copyFrom(at);
    this.anchor.rotationQuaternion!.copyFrom(Quaternion.RotationYawPitchRoll(yaw, 0, roll));
    this.spin += (speed * dt) / 0.72;
    for (const w of this.wheels) {
      const q = Quaternion.RotationAxis(Vector3.RightReadOnly, this.spin);
      w.pivot.rotationQuaternion!.copyFrom(w.front ? Quaternion.RotationAxis(Vector3.UpReadOnly, steer).multiply(q) : q);
    }
  }
  /** the canopy: 0 shut … 1 open */
  open(k: number) {
    for (const mm of this.canopy) for (let i = 0; i < mm.numTargets; i++) mm.getTarget(i).influence = i === 0 ? k : 0;
  }
  world(local: Vector3) {
    this.anchor.computeWorldMatrix(true);
    return Vector3.TransformCoordinates(local, this.anchor.getWorldMatrix());
  }
}

export class BatmanModel {
  private constructor(readonly m: SkinnedModel, readonly car: Batmobile | null, readonly rang: Mesh | null, readonly gun: Mesh | null, readonly gunLen: number) {}
  static async load(scene: Scene) {
    const m = await SkinnedModel.load(scene, batmanUrl, 1.9, (mat) => {
      mat.maxSimultaneousLights = 4;
      mat.environmentIntensity = 1.1;
    });
    const car = await Batmobile.load(scene).catch((e) => (console.warn("batmobile failed to load", e), null));
    // his batarang (the model's flat in its XY plane, 7.4 units across): laid flat, 32 cm wingtip to wingtip
    let rang: Mesh | null = null;
    try {
      const rc = await LoadAssetContainerAsync(batarangUrl, scene, { pluginExtension: extFor(batarangUrl) });
      rc.addAllToScene();
      const rm = mergeParts(rc.meshes.filter((x) => x.getTotalVertices() > 0).map((x) => bakeWorld(x)));
      if (rm) {
        rm.refreshBoundingInfo();
        const bb = rm.getBoundingInfo().boundingBox;
        const k = 0.32 / (bb.extendSize.x * 2);
        rm.bakeTransformIntoVertices(Matrix.Translation(-bb.center.x, -bb.center.y, -bb.center.z).multiply(Matrix.RotationX(Math.PI / 2)).multiply(Matrix.Scaling(k, k, k)));
        rm.setEnabled(false);
        rm.isPickable = false;
        for (const mat of rc.materials) if (mat instanceof PBRMaterial) mat.maxSimultaneousLights = 4;
        rang = rm;
      }
    } catch (e) {
      console.warn("batarang failed to load", e);
    }
    // his gun: a heavy pistol, for when it's quicker than walking up to you
    let gun: Mesh | null = null, gunLen = 0.3;
    try {
      const gc = await LoadAssetContainerAsync(gunUrl, scene, { pluginExtension: extFor(gunUrl) });
      gc.addAllToScene();
      const gm = mergeParts(gc.meshes.filter((x) => x.getTotalVertices() > 0).map((x) => bakeWorld(x)));
      if (gm) {
        gunLen = normaliseGun(gm, 0.3).len;
        gm.setEnabled(false);
        gm.isPickable = false;
        for (const mat of gc.materials) if (mat instanceof PBRMaterial) mat.maxSimultaneousLights = 4;
        gun = gm;
      }
      for (const n of gc.rootNodes) n.setEnabled(false);
    } catch (e) {
      console.warn("batman's gun failed to load", e);
    }
    return new BatmanModel(m, car, rang, gun, gunLen);
  }
}

export class Batman implements Foe {
  readonly rig: Rig;
  readonly car: Batmobile | null;
  readonly position = V();
  readonly v = V();
  heading = 0;
  alive = false;
  state: State = "dormant";
  health = B.health;
  /** (the Game scales it to the size of the team he walks into) */
  maxHealth = B.health;
  webbedT = 0;
  readonly rider: Combatant | null = null;
  readonly size = 0.78;
  readonly solid: Mesh;
  private clips!: Record<ClipName, DirClip>;
  private own: Record<string, DirClip>;
  private tgt: Combatant | null = null;
  private tgtT = 0;
  private threatOf = new Map<Combatant, number>();
  private stateT = 0;
  private thinkT = 0;
  private cd = { attack: 0, pounce: 4, throw: 3, smoke: 8, gun: 6, dodge: 0, taunt: 6, line: 3, web: 0 };
  private attack: { k: number; t: number; dur: number; done: number; takedown?: boolean } | null = null;
  private pounceAt = V();
  private pounceHit = false;
  private goal: Vector3 | null = null;
  private path: Vector3[] = [];
  private repath = 0;
  private stillT = 0;
  private stepT = 0;
  private sinceHurt = 99;
  private recentDmg = 0;
  private berserk = false;
  private circle = 1;
  private stalk = false;
  private shown = newPose();
  private want = newPose();
  private runPhase = 0;
  private q = new Quaternion();
  private flipA = 0;
  private flipRate = 0;
  private gripK = 0.9;
  private hitboxes: { m: Mesh; a: string; b: string }[] = [];
  /** batarangs in flight */
  private rangs: { m: TransformNode; from: Vector3; to: Vector3; t: number; dur: number; target: Combatant | null }[] = [];
  private smoke: SpriteStream;
  private gun: TransformNode | null = null;
  private gunLen = 0.3;
  private shots = 0;
  /** seconds he's gone in the smoke */
  private vanished = 0;
  private exhaust: ThrusterFx;
  private engine: ReturnType<AudioEngine["playLoop"]> | null = null;
  // the entrance
  private intro = { t: 0, start: V(), slideAt: V(), stop: V(), land: V(), dir: V(), yaw0: 0, yaw1: 0, said: 0, sound: 0, seat: V() };
  private hud: HTMLDivElement;
  private hudFill: HTMLDivElement;
  private ghost = 1;
  private hudGhost: HTMLDivElement;
  private line: HTMLDivElement;
  private lineT = 0;

  private constructor(private host: BatmanHost, model: BatmanModel) {
    const scene = host.scene;
    this.rig = model.m.spawn("batman");
    this.own = model.m.clips;
    this.car = model.car;
    this.rig.setVisible(false);
    this.solid = MeshBuilder.CreateBox("batSolid", { width: 0.7, height: 1.85, depth: 0.6 }, scene);
    this.solid.isVisible = false;
    this.solid.isPickable = false;
    this.solid.checkCollisions = false;
    const box = (a: string, b: string, w: number, zone: BodyZone) => {
      const m = MeshBuilder.CreateBox("batHit", { size: 1 }, scene);
      m.isVisible = false;
      m.isPickable = false;
      m.metadata = { kind: HitKind.EnemyPart, enemy: this, zone };
      m.scaling.set(w, 1, w * 0.8);
      this.hitboxes.push({ m, a, b });
    };
    box("Hips", "Neck", 0.46, "torso");
    box("Neck", "HeadTop_End", 0.27, "head");
    box("LeftArm", "LeftHand", 0.16, "limb");
    box("RightArm", "RightHand", 0.16, "limb");
    box("LeftUpLeg", "LeftFoot", 0.19, "limb");
    box("RightUpLeg", "RightFoot", 0.19, "limb");
    // batarangs: a dark bat shape (a body and two swept wings), spinning flat
    const steel = new PBRMaterial("batarangMat", scene);
    steel.albedoColor = new Color3(0.08, 0.08, 0.09);
    steel.metallic = 0.9;
    steel.roughness = 0.3;
    steel.maxSimultaneousLights = 4;
    for (let i = 0; i < 6; i++) {
      const root = new TransformNode("batarang" + i, scene);
      root.rotationQuaternion = new Quaternion();
      const mk = (w: number, d: number, x: number, z: number, yaw: number) => {
        const b = MeshBuilder.CreateBox("batarangPart", { width: w, height: 0.012, depth: d }, scene);
        b.material = steel;
        b.parent = root;
        b.position.set(x, 0, z);
        b.rotation.y = yaw;
        b.isPickable = false;
      };
      if (model.rang) {
        const m = model.rang.clone("batarangMesh" + i, root)!;
        m.setEnabled(true);
        m.isPickable = false;
      } else {
        mk(0.06, 0.07, 0, 0, 0);
        mk(0.16, 0.035, -0.08, -0.01, 0.35);
        mk(0.16, 0.035, 0.08, -0.01, -0.35);
      }
      root.setEnabled(false);
      this.rangs.push({ m: root, from: V(), to: V(), t: 1, dur: 0, target: null });
    }
    this.smoke = new SpriteStream(scene, "batSmoke", 140, false);
    this.gunLen = model.gunLen;
    if (model.gun) {
      this.gun = new TransformNode("batGun", scene);
      this.gun.rotationQuaternion = new Quaternion();
      const gm = model.gun.clone("batGunMesh", this.gun)!;
      gm.setEnabled(true);
      gm.isPickable = false;
      this.gun.setEnabled(false);
    }
    this.exhaust = new ThrusterFx(scene);
    this.hud = document.createElement("div");
    this.hud.className = "ms-boss wolv-boss bat-boss";
    this.hud.innerHTML = `<div class="ms-boss-name">BATMAN <span class="ms-boss-state"></span></div><div class="ms-boss-track"><div class="ms-boss-ghost"></div><div class="ms-boss-fill"></div></div>`;
    document.getElementById("hud")?.appendChild(this.hud);
    this.hudFill = this.hud.querySelector(".ms-boss-fill") as HTMLDivElement;
    this.hudGhost = this.hud.querySelector(".ms-boss-ghost") as HTMLDivElement;
    this.line = document.createElement("div");
    this.line.id = "bat-line";
    document.getElementById("hud")?.appendChild(this.line);
  }

  static async create(host: BatmanHost, model: BatmanModel) {
    const b = new Batman(host, model);
    b.clips = await loadSpiderClips();
    return b;
  }

  get meshes() {
    return [...this.rig.meshes, ...(this.car?.meshes ?? [])];
  }
  get active() {
    return this.state !== "dormant";
  }
  get cinematic() {
    return this.state === "intro";
  }
  get target() {
    return this.tgt;
  }
  say(text: string, secs = 2.6) {
    this.line.innerHTML = `<b>BATMAN</b> ${text}`;
    this.line.classList.add("on");
    this.lineT = secs;
    this.cd.line = 10 + Math.random() * 8;
  }
  private quip(set: keyof typeof LINES, chance = 1) {
    if (this.cd.line > 0 || Math.random() > chance) return;
    this.say(pick(LINES[set]));
  }
  greetClark() {
    if (this.alive) this.say(LINES.superman[0], 2);
  }

  // ------------------------------------------------------------------ the Foe the heroes see
  threat(): HulkThreat | null {
    if (!this.alive) return null;
    const fwd = V(Math.sin(this.heading), 0, Math.cos(this.heading));
    if (this.state === "attack" && this.attack) {
      const f = COMBOS[this.attack.k];
      const next = f.hits[this.attack.done];
      if (next === undefined) return null;
      const t = next * this.attack.dur - this.attack.t;
      return { kind: "punch", at: this.position.clone(), dir: fwd, radius: B.reach + 0.4, cone: 0.9, t: Math.max(0, t), target: this.tgt };
    }
    if (this.state === "pounce") {
      const t = Math.max(0, (this.v.y + Math.sqrt(Math.max(0, this.v.y * this.v.y + 2 * G * Math.max(0, this.position.y - this.pounceAt.y)))) / G);
      return { kind: "leap", at: this.pounceAt.clone(), dir: fwd, radius: 2.2, cone: Math.PI, t, target: this.tgt };
    }
    return null;
  }
  web(seconds: number) {
    if (!this.alive || this.cinematic || this.cd.web > 0 || this.state === "pounce" || this.state === "air" || this.state === "down") return false;
    this.webbedT = Math.min(1.8, seconds * 0.6);
    this.cd.web = 7;
    this.attack = null;
    this.go("webbed");
    return true;
  }
  mount(_r: Combatant) {
    return false;
  }
  riderPoint() {
    return this.position.add(V(0, 1.45, 0));
  }
  bonePos(name: "pelvis" | "spine_03" | "spine_05" | "head" | "hand_l" | "hand_r" | "foot_l" | "foot_r" | "calf_l" | "calf_r") {
    const map = { pelvis: "Hips", spine_03: "Spine1", spine_05: "Spine2", head: "Head", hand_l: "LeftHand", hand_r: "RightHand", foot_l: "LeftFoot", foot_r: "RightFoot", calf_l: "LeftLeg", calf_r: "RightLeg" } as const;
    return this.rig.at(map[name]);
  }
  /** a blast's reach on him (grenades, rockets) */
  inBlast(pos: Vector3, radius: number) {
    return this.alive && !this.cinematic && Vector3.Distance(pos, this.position.add(V(0, 1, 0))) < radius + 0.4;
  }

  applyHit(damage: number, zone: BodyZone, dir: Vector3, point: Vector3, info?: { kind: string; force?: number; source?: Combatant }) {
    if (!this.alive || this.cinematic) return false;
    const bullet = !info || info.kind === "bullet";
    const dmg = damage * (bullet ? B.bulletFactor : 1) * (zone === "head" ? 1.6 : zone === "limb" ? 0.8 : 1) * (info?.source ? 1.2 : 1);
    this.health = Math.max(0, this.health - dmg);
    this.sinceHurt = 0;
    this.recentDmg += dmg;
    const src = info?.source ?? this.host.player;
    this.threatOf.set(src, (this.threatOf.get(src) ?? 0) + dmg);
    this.host.blood(point, dir);
    if (this.health <= 0) {
      this.knockedOut();
      return true;
    }
    // a heavy blow rocks him (not mid-pounce)
    if ((info?.force ?? 0) >= 2 && this.state !== "pounce" && this.state !== "air" && this.state !== "stagger") {
      this.attack = null;
      this.v.copyFrom(flat(dir).normalize().scale(4)).addInPlaceFromFloats(0, 2.5, 0);
      this.position.y += 0.05;
      this.flipRate = -5;
      this.go("air");
    } else if (Math.random() < 0.08) this.quip("hurt");
    return false;
  }

  private knockedOut() {
    this.alive = false;
    this.attack = null;
    this.go("down");
    this.say(LINES.down[0], 1.6);
    for (const b of this.hitboxes) b.m.isPickable = false;
    this.solid.checkCollisions = false;
    this.host.audio.play("bodyFall", { x: this.position.x, y: this.position.y, z: this.position.z, volume: 0.8 });
    this.host.onDown();
  }

  private go(s: State) {
    this.state = s;
    this.stateT = 0;
  }

  // ------------------------------------------------------------------ Superman's freeze breath and his fist
  private frozenT = 0;
  get frozen() {
    return this.state === "frozen";
  }
  /** iced over for a few seconds (he works his way out of it) */
  freeze(seconds: number) {
    if (!this.alive || this.cinematic || this.state === "frozen") return false;
    this.attack = null;
    this.v.setAll(0);
    this.flipA = 0;
    this.flipRate = 0;
    this.frozenT = seconds;
    this.go("frozen");
    return true;
  }
  /** thrown by a blow far stronger than anything he can stand against */
  private slammed = false;
  /** up in Superman's grip: where he holds him */
  hold(at: Vector3) {
    if (!this.alive) return;
    if (this.state !== "held") {
      this.attack = null;
      this.go("held");
    }
    this.position.copyFrom(at);
    this.v.setAll(0);
  }
  /** let go, hurled down at the ground */
  drop(vel: Vector3) {
    if (this.state !== "held") return;
    this.slammed = true;
    this.v.copyFrom(vel);
    this.flipRate = -6;
    this.go("air");
  }
  launch(vel: Vector3) {
    if (!this.alive || this.cinematic) return;
    this.attack = null;
    this.v.copyFrom(vel);
    this.position.y += 0.08;
    this.flipRate = -7;
    this.go("air");
  }

  // ------------------------------------------------------------------ the entrance: the Batmobile
  /**
   * Where the car comes in: a stop 11–14 m from you on open ground, a straight run of 55 m up to it
   * across your view (clear of everything at bonnet and roof height). Null if there's no such road.
   */
  entryRoute(player: Vector3) {
    const nav = this.host.nav;
    const clearAt = (a: Vector3, b: Vector3) => [0.7, 1.5].every((h) => nav.clear(a.add(V(0, h, 0)), b.add(V(0, h, 0))));
    let best: { stop: Vector3; start: Vector3; dir: Vector3 } | null = null, bs = -Infinity;
    for (let k = 0; k < 24; k++) {
      const a = (k / 24) * Math.PI * 2;
      const out = V(Math.sin(a), 0, Math.cos(a));
      const stop = player.add(out.scale(12.5));
      const fy = nav.floorAt(stop.x, player.y + 1.5, stop.z, 3);
      if (fy === null || Math.abs(fy - player.y) > 0.8) continue;
      stop.y = fy;
      if (!clearAt(player, stop)) continue;
      for (const s of [1, -1]) {
        const tan = V(out.z * s, 0, -out.x * s);
        const start = stop.subtract(tan.scale(55));
        const sy = nav.floorAt(start.x, fy + 2, start.z, 4);
        if (sy === null || Math.abs(sy - fy) > 1) continue;
        start.y = sy;
        const side = V(-tan.z, 0, tan.x).scale(1.3);
        if (!clearAt(start, stop) || !clearAt(start.add(side), stop.add(side)) || !clearAt(start.subtract(side), stop.subtract(side))) continue;
        // (a few points along it: the ground's there all the way)
        let ok = true;
        for (let f = 0.2; f < 1; f += 0.2) {
          const p = Vector3.Lerp(start, stop, f);
          const y = nav.floorAt(p.x, fy + 2, p.z, 4);
          if (y === null || Math.abs(y - fy) > 1) ok = false;
        }
        if (!ok) continue;
        const sc = Math.random();
        if (sc > bs) (bs = sc), (best = { stop, start, dir: tan });
      }
    }
    return best;
  }
  /** the car in along `route`, him out of it */
  enter(route: { stop: Vector3; start: Vector3; dir: Vector3 }) {
    const I = this.intro;
    I.t = 0;
    I.start.copyFrom(route.start);
    I.stop.copyFrom(route.stop);
    I.dir.copyFrom(route.dir);
    I.slideAt.copyFrom(route.stop.subtract(route.dir.scale(9)));
    I.yaw0 = Math.atan2(route.dir.x, route.dir.z);
    // (broadside on at the stop: turned a quarter toward the side away from you, nose sweeping round)
    const toYou = flat(this.host.player.feet.subtract(route.stop)).normalize();
    const cross = route.dir.x * toYou.z - route.dir.z * toYou.x;
    I.yaw1 = I.yaw0 + (cross > 0 ? -1 : 1) * 1.35;
    // he lands between the car and you
    I.land.copyFrom(route.stop.add(toYou.scale(4.2)));
    I.land.y = this.host.nav.floorAt(I.land.x, route.stop.y + 1.5, I.land.z, 3) ?? route.stop.y;
    I.said = 0;
    I.sound = 0;
    this.health = this.maxHealth;
    this.ghost = 1;
    this.alive = true;
    this.vanished = 0;
    this.threatOf.clear();
    this.tgt = this.host.player;
    this.heading = Math.atan2(toYou.x, toYou.z);
    copyPose(PERCH, this.shown);
    this.car?.setVisible(true);
    this.go("intro");
    this.hud.classList.add("on");
    this.bar();
    this.engine?.stop(0);
    this.engine = this.host.audio.playLoop("carEngine", { x: route.start.x, y: route.start.y + 1, z: route.start.z, volume: 1 });
    return true;
  }
  skip() {
    if (this.state !== "intro") return;
    const I = this.intro;
    I.t = 99;
    this.car?.place(I.stop, I.yaw1, 0, 0, 0);
    this.car?.open(1);
    this.position.copyFrom(I.land);
    this.endIntro();
  }
  private endIntro() {
    this.engine?.stop(1.5);
    this.engine = null;
    this.rig.setVisible(true);
    for (const b of this.hitboxes) b.m.isPickable = true;
    this.solid.checkCollisions = true;
    this.cd.attack = 0.8;
    this.cd.throw = 2;
    this.go("chase");
  }
  /** car position along the run: 0–2.6 s in at speed, 2.6–3.6 s the slide */
  private carAt(t: number) {
    const I = this.intro;
    if (t < 2.6) {
      // 33 m/s easing to 20: covering start → slideAt
      const f = t / 2.6;
      const e = f * (1.3 - 0.3 * f);
      return { p: Vector3.Lerp(I.start, I.slideAt, e), yaw: I.yaw0, speed: 33 - 13 * f, steer: 0, roll: 0 };
    }
    const f = Math.min(1, (t - 2.6) / 1.0);
    const e = 1 - Math.pow(1 - f, 2.2);
    return { p: Vector3.Lerp(I.slideAt, I.stop, e), yaw: I.yaw0 + (I.yaw1 - I.yaw0) * e, speed: 20 * (1 - f), steer: (I.yaw1 > I.yaw0 ? 0.45 : -0.45) * (1 - f), roll: (I.yaw1 > I.yaw0 ? -0.05 : 0.05) * Math.sin(f * Math.PI) };
  }
  /**
   * The timeline (8.4 s): the car in (0–2.6) — the slide (2.6–3.6) — the canopy (3.6–4.6), him
   * rising in the seat — the leap (4.6–5.4) — the landing (5.4–6.4) — up and squaring to you.
   */
  private introFrame(dt: number) {
    const I = this.intro;
    I.t += dt;
    const t = I.t;
    const au = this.host.audio;
    const car = this.car;
    if (car && t < 3.7) {
      const c = this.carAt(t);
      car.place(c.p, c.yaw, c.speed, c.steer, dt, c.roll);
      this.engine?.setPosition(c.p.x, c.p.y + 1, c.p.z);
      this.engine?.setRate(0.8 + c.speed / 40);
      // the afterburner
      const tail = car.world(car.tail);
      const back = V(-Math.sin(c.yaw), 0.05, -Math.cos(c.yaw));
      if (t < 2.7) this.exhaust.nozzle(0, tail, back, 1.1, V(Math.sin(c.yaw), 0, Math.cos(c.yaw)).scale(c.speed), dt, true);
      // dust off the wheels, more in the slide
      if (Math.random() < dt * (t > 2.6 ? 30 : 10)) this.host.dust(c.p.add(back.scale(2.5)), t > 2.6 ? 0.25 : 0.1);
      if (t > 2.6 && I.sound === 0) {
        I.sound = 1;
        au.play("carSkid", { x: c.p.x, y: c.p.y + 0.5, z: c.p.z, volume: 1.1 });
      }
    }
    this.exhaust.update(dt);
    if (car && t >= 3.6 && t < 4.7) car.open(Math.min(1, (t - 3.6) / 0.9));
    if (t > 3.62 && I.sound === 1) {
      I.sound = 2;
      au.play("servo", { x: I.stop.x, y: I.stop.y + 1.5, z: I.stop.z, volume: 0.8, rate: 0.6 });
      this.engine?.setVolume(0.45);
    }
    // him: up out of the seat, then the leap
    if (car && t >= 4.1) {
      const seat = car.world(car.seat);
      if (t < 4.6) {
        this.rig.setVisible(true);
        this.position.copyFrom(seat).addInPlaceFromFloats(0, -0.9 + Math.min(1, (t - 4.1) / 0.4) * 0.5, 0);
        I.seat.copyFrom(this.position);
      } else if (t < 5.4) {
        const f = (t - 4.6) / 0.8;
        Vector3.LerpToRef(I.seat, I.land, f, this.position);
        this.position.y = I.seat.y + (I.land.y - I.seat.y) * f + 2.4 * 4 * f * (1 - f);
        this.flipA = f < 0.9 ? -f * Math.PI * 2 * 0.95 : 0;
      } else if (I.said < 1) {
        I.said = 1;
        this.position.copyFrom(I.land);
        this.flipA = 0;
        this.host.dust(I.land.clone(), 0.5);
        au.play("land", { x: I.land.x, y: I.land.y, z: I.land.z, volume: 1, rate: 0.7 });
        au.play("hulkSlam", { x: I.land.x, y: I.land.y, z: I.land.z, volume: 0.35, rate: 2 });
        this.host.player.shake(0.18);
      }
    } else if (!car && t > 4.6 && I.said < 1) {
      I.said = 1;
      this.rig.setVisible(true);
      this.position.copyFrom(I.land);
    }
    if (t > 6.7 && I.said < 2) {
      I.said = 2;
      this.say(LINES.intro[0], 2.8);
    }
    if (t >= 8.4) this.endIntro();
  }

  cineShot(): { pos: Vector3; target: Vector3; fov: number; cut?: boolean } | null {
    if (this.state !== "intro") return null;
    const I = this.intro, t = I.t;
    const car = this.car;
    const carP = car ? car.anchor.position.add(V(0, 1, 0)) : I.stop.add(V(0, 1, 0));
    const you = this.host.player.camera.position;
    const toYou = flat(you.subtract(I.stop)).normalize();
    const side = V(I.dir.z, 0, -I.dir.x);
    if (t < 1.4) {
      // from by you, low: the headlights and the flame coming down the open ground at you
      return { pos: I.stop.add(toYou.scale(4)).addInPlace(I.dir.scale(5)).addInPlaceFromFloats(0, 0.5, 0), target: carP, fov: 0.62, cut: t < 0.03 };
    }
    if (t < 2.6) {
      // chasing it: the camera behind and above the car, running with it (clear of the stacks either side)
      const s = toYou.x * side.x + toYou.z * side.z > 0 ? 1 : -1;
      return { pos: carP.subtract(I.dir.scale(7.5)).addInPlace(side.scale(2.2 * s)).addInPlaceFromFloats(0, 2.4, 0), target: carP.add(I.dir.scale(4)), fov: 0.85, cut: t < 1.43 };
    }
    if (t < 3.6) {
      // the slide: low at the stop, it swings round broadside toward the lens
      return { pos: I.stop.add(toYou.scale(6.5)).addInPlace(I.dir.scale(4)).addInPlaceFromFloats(0, 0.45, 0), target: carP, fov: 0.78, cut: t < 2.63 };
    }
    if (t < 4.6) {
      // on the canopy as it opens, him rising in the seat
      const seat = car ? car.world(car.seat) : I.stop.add(V(0, 1.4, 0));
      return { pos: seat.add(toYou.scale(3.2)).addInPlace(side.scale(1.2)).addInPlaceFromFloats(0, 1.1, 0), target: seat.add(V(0, 0.3, 0)), fov: 0.72, cut: t < 3.63 };
    }
    if (t < 5.4) {
      const mid = Vector3.Lerp(I.stop, I.land, 0.5);
      return { pos: mid.add(side.scale(8)).addInPlaceFromFloats(0, 2, 0), target: this.position.add(V(0, 1, 0)), fov: 0.85, cut: t < 4.63 };
    }
    if (t < 6.6) {
      return { pos: I.land.add(toYou.scale(3.2)).addInPlace(side.scale(0.8)).addInPlaceFromFloats(0, 0.3, 0), target: I.land.add(V(0, 1, 0)), fov: 0.78, cut: t < 5.43 };
    }
    return { pos: you.add(V(toYou.z, 0, -toYou.x).scale(0.6)).addInPlace(toYou.scale(-0.8)), target: this.position.add(V(0, 1.2, 0)), fov: 0.8, cut: t < 6.63 };
  }

  // ------------------------------------------------------------------ frame
  update(dt: number) {
    if (this.state === "dormant") return;
    for (const k of Object.keys(this.cd) as (keyof typeof this.cd)[]) this.cd[k] -= dt;
    this.stateT += dt;
    this.sinceHurt += dt;
    this.recentDmg = Math.max(0, this.recentDmg - dt * 50);
    if (this.lineT > 0 && (this.lineT -= dt) <= 0) this.line.classList.remove("on");
    if (this.state === "intro") this.introFrame(dt);
    else if (this.state === "held") {
      // (Superman moves him)
    } else if (this.state === "frozen") {
      this.frozenT -= dt;
      if (this.frozenT <= 0) {
        this.go("stagger");
        this.host.audio.play("iceShatter", { x: this.position.x, y: this.position.y + 1, z: this.position.z, volume: 1 });
      }
    } else if (this.state !== "down") {
      this.think(dt);
      this.act(dt);
      this.move(dt);
    } else this.moveDown(dt);
    if (!isFinite(this.position.x + this.position.y + this.position.z + this.v.x + this.v.y + this.v.z)) {
      this.position.copyFrom(this.host.player.feet.add(V(4, 0, 4)));
      this.v.setAll(0);
      this.go("chase");
    }
    this.flyRangs(dt);
    this.smoke.update(dt);
    if (this.state !== "intro") this.exhaust.update(dt);
    this.animate(dt);
    this.placeHitboxes();
    this.bar();
  }
  private mode() {
    return this.state === "air" || this.state === "pounce" ? "air" : "ground";
  }
  private bar() {
    const f = this.health / this.maxHealth;
    this.hudFill.style.width = `${(f * 100).toFixed(1)}%`;
    this.ghost = Math.max(f, this.ghost - 0.004);
    this.hudGhost.style.width = `${(this.ghost * 100).toFixed(1)}%`;
    const st = this.hud.querySelector(".ms-boss-state") as HTMLSpanElement;
    const label = this.state === "down" ? "DOWN" : this.vanished > 0 ? "VANISHED" : "";
    if (st.textContent !== label) st.textContent = label;
    this.hud.classList.toggle("l2", this.health < this.maxHealth * 0.3 && this.alive);
  }

  // ------------------------------------------------------------------ deciding
  private combatants(): Combatant[] {
    return [this.host.player, ...this.host.allies()].filter((c) => c.alive);
  }
  /** who he's after: whoever's close and hurting him most (sticks with them a while) */
  private pickTarget() {
    const all = this.combatants();
    if (!all.length) return null;
    let best = all[0], bs = -Infinity;
    for (const c of all) {
      const d = Vector3.Distance(flat(c.feet), flat(this.position));
      const up = c.feet.y - this.position.y;
      let s = -d + (this.threatOf.get(c) ?? 0) * 0.05;
      if (up > 2.6) s -= 30; // up in the air / on a roof: out of reach
      if (c === this.tgt) s += 4;
      if (c === this.host.player) s += 2;
      if (c === this.host.rival?.()) s += 14;
      if (s > bs) (bs = s), (best = c);
    }
    return best;
  }

  private think(dt: number) {
    for (const [k, v] of this.threatOf) this.threatOf.set(k, v * Math.exp(-dt / 8));
    if (this.state === "webbed") {
      this.webbedT -= dt;
      if (this.webbedT <= 0) this.go("chase");
      return;
    }
    if (this.state === "stagger") {
      if (this.stateT > 0.7) this.go("chase");
      return;
    }
    if (this.state === "getup") {
      if (this.stateT > 0.8) this.go("chase");
      return;
    }
    if (this.state !== "chase") return;
    this.thinkT -= dt;
    this.tgtT -= dt;
    if (!this.tgt?.alive || this.tgtT <= 0) {
      this.tgt = this.pickTarget();
      this.tgtT = rnd(3, 5);
    }
    const tgt = this.tgt;
    if (!tgt || this.host.holdFight()) {
      this.goal = null;
      return;
    }
    if (this.thinkT > 0) return;
    this.thinkT = 0.15;
    const to = flat(tgt.feet.subtract(this.position));
    const d = to.length();
    const up = tgt.feet.y - this.position.y;
    const sees = this.host.nav.clear(this.position.add(V(0, 1.4, 0)), tgt.feet.add(V(0, 1.2, 0)));
    // under fire: a roll out of it
    if (this.recentDmg > 60 && this.cd.dodge <= 0 && d > 3) {
      this.cd.dodge = rnd(2.5, 4);
      this.recentDmg = 0;
      const side = V(to.z, 0, -to.x).normalize().scale(Math.random() < 0.5 ? 1 : -1);
      this.v.copyFrom(side.scale(7.5));
      this.go("dodge");
      return;
    }
    // the smoke pellet: gone — and behind them
    if (this.cd.smoke <= 0 && d > 3 && d < 18 && Math.abs(up) < 1.5 && Math.random() < 0.5) return this.startSmoke(tgt);
    if (d < B.reach && Math.abs(up) < 1.4 && this.cd.attack <= 0) return this.startCombo(false);
    // a flying kick from mid-range
    if (d > 4.5 && d < 10 && Math.abs(up) < 1.8 && this.cd.pounce <= 0 && sees) return this.startPounce(tgt);
    // the gun: from range, a few quick shots
    if (this.cd.gun <= 0 && this.gun && sees && d > 9 && d < 35 && Math.random() < 0.4) {
      this.cd.gun = rnd(8, 12);
      this.shots = 0;
      this.goal = null;
      this.go("gun");
      return;
    }
    // batarangs: from range, or at someone up out of reach
    if (this.cd.throw <= 0 && sees && (d > 7 || up > 2.4) && d < 28) return this.startThrow();
    if (d > 6 && d < 16 && this.cd.taunt <= 0 && Math.random() < 0.15) {
      this.cd.taunt = rnd(16, 24);
      this.quip("taunt");
    }
    if (d < 5 && this.cd.attack > 0) {
      if (this.stateT > 2.4 || Math.random() < 0.02) this.circle = -this.circle;
      const ang = Math.atan2(-to.x, -to.z) + this.circle * 0.6;
      this.goal = tgt.feet.add(V(Math.sin(ang), 0, Math.cos(ang)).scale(3.2));
      this.stalk = true;
      return;
    }
    this.stalk = false;
    this.goal = tgt.feet.subtract(to.normalizeToNew().scale(1.2));
  }
  private clipOf(name: string) {
    return name.startsWith("own:") ? this.own[name.slice(4)] ?? this.clips.punch : this.clips[name as ClipName];
  }
  private startCombo(takedown: boolean) {
    const k = takedown ? 3 : Math.floor(Math.random() * COMBOS.length);
    const c = COMBOS[k];
    this.attack = { k, t: 0, dur: clipDur(this.clipOf(c.clip)) / c.speed, done: 0, takedown };
    this.cd.attack = this.attack.dur + rnd(1.0, 2.0);
    this.goal = null;
    this.go("attack");
  }
  private startPounce(tgt: Combatant) {
    this.cd.pounce = rnd(6, 9);
    const from = this.position;
    const T = 0.6;
    const dir = flat(tgt.feet.subtract(from));
    const L = dir.length();
    dir.scaleInPlace(1 / Math.max(1e-3, L));
    const landAt = from.add(dir.scale(Math.max(0, L - 0.9)));
    landAt.y = tgt.feet.y;
    this.pounceAt.copyFrom(landAt);
    this.v.copyFrom(landAt.subtract(from).scale(1 / T));
    this.v.y = (landAt.y - from.y) / T + 0.5 * G * T;
    this.heading = Math.atan2(dir.x, dir.z);
    this.position.y += 0.05;
    this.pounceHit = false;
    this.go("pounce");
    this.host.audio.play("meleeSwing", { x: from.x, y: from.y + 1, z: from.z, volume: 0.8, rate: 0.6 });
  }
  /** three batarangs, fanned, at whoever he's after */
  private startThrow() {
    this.cd.throw = rnd(4.5, 7);
    this.goal = null;
    this.go("throw");
    this.thrown = 0;
  }
  private thrown = 0;
  private startSmoke(tgt: Combatant) {
    this.cd.smoke = rnd(14, 20);
    this.goal = null;
    this.puff(this.position);
    this.host.audio.play("smokePop", { x: this.position.x, y: this.position.y + 0.5, z: this.position.z, volume: 1 });
    this.vanished = 1.0;
    this.rig.setVisible(false);
    for (const b of this.hitboxes) b.m.isPickable = false;
    this.smokeTgt = tgt;
    this.go("smoke");
    this.quip("smoke", 0.6);
  }
  private smokeTgt: Combatant | null = null;
  private muzzle() {
    if (!this.gun) return this.rig.at("RightHand");
    this.gun.computeWorldMatrix(true);
    return Vector3.TransformCoordinates(V(0, 0.04, this.gunLen * 0.75), this.gun.getWorldMatrix());
  }
  private puff(at: Vector3) {
    for (let i = 0; i < 60; i++) {
      const a = Math.random() * 6.28, r = Math.random() * 1.6;
      this.smoke.emit(at.add(V(Math.cos(a) * r, Math.random() * 1.8, Math.sin(a) * r)), V(Math.cos(a) * 2.2, Math.random() * 1.2, Math.sin(a) * 2.2), rnd(1.6, 2.6), rnd(0.5, 0.9), 2.4, new Color3(0.32, 0.33, 0.35), new Color3(0.2, 0.2, 0.22), 0.85, 1.6, 0.25);
    }
  }

  private act(dt: number) {
    if (this.state === "smoke") {
      this.vanished -= dt;
      if (this.vanished <= 0) {
        // out of the smoke behind them
        const t = this.smokeTgt;
        if (t?.alive) {
          const away = flat(t.feet.subtract(this.position)).normalize();
          const behind = t.feet.add(away.scale(1.3));
          const fy = this.host.nav.floorAt(behind.x, t.feet.y + 1.2, behind.z, 2.5);
          if (fy !== null && !this.host.nav.embedded(behind.x, fy + 1, behind.z)) {
            this.position.set(behind.x, fy, behind.z);
            this.heading = Math.atan2(t.feet.x - behind.x, t.feet.z - behind.z);
          }
        }
        this.puff(this.position);
        this.rig.setVisible(true);
        for (const b of this.hitboxes) b.m.isPickable = true;
        this.tgt = t ?? this.tgt;
        this.startCombo(true);
      }
      return;
    }
    if (this.state === "gun") {
      const tgt = this.tgt;
      if (tgt) this.turnTo(Math.atan2(tgt.feet.x - this.position.x, tgt.feet.z - this.position.z), dt, 10);
      while (tgt && this.stateT > 0.35 + this.shots * 0.22 && this.shots < 5) {
        this.shots++;
        const muzzle = this.muzzle();
        const you = tgt === this.host.player;
        const aim = tgt.feet.add(V(0, 1.1, 0));
        const hit = Math.random() < (you ? 0.55 : 0.75) && this.host.nav.clear(muzzle, aim);
        const end = hit ? aim : aim.add(V(rnd(-1.4, 1.4), rnd(-0.6, 1), rnd(-1.4, 1.4)));
        this.host.tracer(muzzle, end);
        this.host.audio.play("pistolShot", { x: muzzle.x, y: muzzle.y, z: muzzle.z, volume: 0.9, rate: 0.9 });
        if (hit) tgt.takeDamage(you ? 7 : 14, muzzle);
      }
      if (this.stateT > 1.7) this.go("chase");
      return;
    }
    if (this.state === "throw") {
      const tgt = this.tgt;
      if (tgt) this.turnTo(Math.atan2(tgt.feet.x - this.position.x, tgt.feet.z - this.position.z), dt, 9);
      if (this.stateT > 0.35 && this.thrown === 0 && tgt) {
        this.thrown = 1;
        const hand = this.rig.at("RightHand");
        for (let i = -1; i <= 1; i++) this.throwRang(hand, tgt, i * 0.12);
        this.host.audio.play("batarang", { x: hand.x, y: hand.y, z: hand.z, volume: 0.9 });
      }
      if (this.stateT > 0.75) this.go("chase");
      return;
    }
    if (this.state === "attack" && this.attack) {
      const a = this.attack;
      const c = COMBOS[a.k];
      a.t += dt;
      const tgt = this.tgt;
      if (tgt) this.turnTo(Math.atan2(tgt.feet.x - this.position.x, tgt.feet.z - this.position.z), dt, 8);
      if (tgt && Vector3.Distance(flat(tgt.feet), flat(this.position)) > 1.3) {
        const fwd = V(Math.sin(this.heading), 0, Math.cos(this.heading));
        this.stepTo(this.position.x + fwd.x * 2 * dt, this.position.z + fwd.z * 2 * dt);
      }
      while (a.done < c.hits.length && a.t / a.dur >= c.hits[a.done]) {
        a.done++;
        this.strike(c, a.done === c.hits.length, !!a.takedown);
      }
      if (a.t >= a.dur) {
        this.attack = null;
        this.go("chase");
      }
    }
  }
  private strike(c: (typeof COMBOS)[number], last: boolean, takedown: boolean) {
    const fwd = V(Math.sin(this.heading), 0, Math.cos(this.heading));
    const au = this.host.audio;
    const hand = this.rig.at(Math.random() < 0.5 ? "LeftHand" : "RightHand");
    au.play("meleeSwing", { x: hand.x, y: hand.y, z: hand.z, volume: 0.7, rate: 0.85 });
    for (const t of this.combatants()) {
      const to = flat(t.feet.subtract(this.position));
      const d = to.length();
      if (d > B.reach + 0.5 || Math.abs(t.feet.y - this.position.y) > 1.5) continue;
      if (d > 0.3 && Vector3.Dot(to.scale(1 / d), fwd) < 0.3) continue;
      const you = t === this.host.player;
      const k = takedown ? 1.8 : 1;
      t.takeDamage((you ? c.dmg : c.hero) * k, this.position);
      au.play("meleeHit", { x: hand.x, y: hand.y, z: hand.z, volume: 0.9 });
      au.play("fleshHit", { x: hand.x, y: hand.y, z: hand.z, volume: 0.6 });
      if (you) this.host.player.shake(takedown ? 0.35 : 0.14);
      if (last) {
        t.knock(to.normalizeToNew().scale(takedown ? 7 : 5), takedown ? 3 : 2);
        if (takedown) t.knockDown?.(you ? 0.8 : 1.4);
      }
    }
  }
  private throwRang(from: Vector3, tgt: Combatant, spread: number) {
    const r = this.rangs.find((x) => x.t >= x.dur);
    if (!r) return;
    const aim = tgt.feet.add(V(0, 1.1, 0));
    const dir = aim.subtract(from);
    const side = V(dir.z, 0, -dir.x).normalize();
    r.from.copyFrom(from);
    r.to.copyFrom(aim.add(side.scale(spread * dir.length())));
    r.t = 0;
    r.dur = Vector3.Distance(r.from, r.to) / 32;
    r.target = spread === 0 ? tgt : null;
    r.m.setEnabled(true);
  }
  private flyRangs(dt: number) {
    for (const r of this.rangs) {
      if (r.t >= r.dur) continue;
      r.t += dt;
      const f = Math.min(1, r.t / r.dur);
      Vector3.LerpToRef(r.from, r.to, f, r.m.position);
      r.m.position.y += Math.sin(f * Math.PI) * 0.4;
      r.m.rotationQuaternion!.copyFrom(Quaternion.RotationYawPitchRoll(r.t * 38, 0.15, 0));
      if (f >= 1) {
        r.m.setEnabled(false);
        // a hit if whoever it was meant for is still about there
        const t = r.target ?? this.combatants().find((c) => Vector3.Distance(c.feet.add(V(0, 1, 0)), r.to) < 1.1) ?? null;
        if (t && Vector3.Distance(t.feet.add(V(0, 1, 0)), r.to) < 1.6) {
          const you = t === this.host.player;
          t.takeDamage(you ? 12 : 26, r.from);
          if (!you) t.knockDown?.(0.6);
          else this.host.player.shake(0.12);
          this.host.audio.play("impactMetal", { x: r.to.x, y: r.to.y, z: r.to.z, volume: 0.7, rate: 1.3 });
        } else this.host.spark(r.to, r.from.subtract(r.to).normalize());
      }
    }
  }

  // ------------------------------------------------------------------ getting about
  private turnTo(yaw: number, dt: number, rate: number) {
    const d = angDiff(yaw, this.heading);
    this.heading += Math.sign(d) * Math.min(Math.abs(d), rate * dt);
  }
  private move(dt: number) {
    if (this.mode() === "air" || this.state === "dodge") return this.moveAir(dt);
    const nav = this.host.nav;
    const p = this.position;
    const fy = nav.floorAt(p.x, p.y + 0.3, p.z, 0.6);
    if (fy === null) {
      this.v.set(0, 0, 0);
      this.go("air");
      return;
    }
    p.y += (fy - p.y) * Math.min(1, dt * 15);
    if (this.state !== "chase" || !this.goal) {
      this.v.setAll(0);
      return;
    }
    let speed = 0;
    const target = this.steer(dt);
    const step = flat(target.subtract(p));
    const L = step.length();
    const s = (this.stalk ? 2.4 : Vector3.Distance(flat(this.goal), flat(p)) > 7 ? B.sprint : B.run) * (this.berserk ? 1.2 : 1);
    if (L > 0.15) {
      // (stalking: eyes on him, side-stepping; otherwise he runs where he's going)
      const tg = this.tgt;
      const moveYaw = Math.atan2(step.x, step.z);
      this.turnTo(this.stalk && tg ? Math.atan2(tg.feet.x - p.x, tg.feet.z - p.z) : moveYaw, dt, 12);
      const dir = this.stalk ? V(Math.sin(moveYaw), 0, Math.cos(moveYaw)) : V(Math.sin(this.heading), 0, Math.cos(this.heading));
      const m = Math.min(L, s * dt);
      if (this.stepTo(p.x + dir.x * m, p.z + dir.z * m)) speed = m / dt;
      else this.blocked(dir);
    }
    this.v.set(Math.sin(this.heading) * speed, 0, Math.cos(this.heading) * speed);
    if (speed < 0.3 && L > 0.5 && !this.stalk) {
      this.stillT += dt;
      if (this.stillT > 0.9) {
        // stuck: up and over
        this.stillT = 0;
        const dir = flat(this.goal.subtract(p)).normalize();
        this.v.set(dir.x * 4.5, 8, dir.z * 4.5);
        p.y += 0.05;
        this.go("air");
      }
    } else this.stillT = 0;
    if (speed > 1) {
      this.stepT -= dt * (speed / 4.4);
      if (this.stepT <= 0) {
        this.stepT = 0.32;
        this.host.audio.play("footstep", { x: p.x, y: p.y, z: p.z, volume: 0.32 });
      }
    }
  }
  private stepTo(x: number, z: number) {
    const nav = this.host.nav;
    const p = this.position;
    const fy = nav.floorAt(x, p.y + 0.5, z, 1.2);
    if (fy === null) {
      if (!nav.embedded(x, p.y + 0.5, z)) {
        p.x = x;
        p.z = z;
        return true;
      }
      return false;
    }
    if (fy > p.y + 0.5 || nav.embedded(x, p.y + 0.4, z) || nav.embedded(x, fy + 1.0, z)) return false;
    p.x = x;
    p.z = z;
    return true;
  }
  /** in the way: over it if it's low, else find another way */
  private blocked(dir: Vector3) {
    const nav = this.host.nav;
    const c = this.position.add(V(0, 0.6, 0));
    const hit = nav.moveHit(c, c.add(dir.scale(1.2)));
    if (!hit) return;
    const top = nav.boxBoundsOf(hit.box)[4];
    const h = top - this.position.y;
    if (h < 2.8) {
      this.v.set(dir.x * 4.5, Math.sqrt(2 * G * (h + 0.7)), dir.z * 4.5);
      this.position.y += 0.05;
      this.go("air");
      return;
    }
    this.repath = 0;
    this.path = [];
  }
  private steer(dt: number) {
    const nav = this.host.nav;
    const goal = this.goal!;
    const p = this.position;
    const knee = V(0, 0.5, 0), chest = V(0, 1.2, 0);
    if (Math.abs(goal.y - p.y) < 1.5 && nav.moveRay(p.add(knee), goal.add(knee)) < 0 && nav.moveRay(p.add(chest), goal.add(chest)) < 0) {
      this.path = [];
      return goal;
    }
    this.repath -= dt;
    if (this.repath <= 0 || !this.path.length) {
      this.repath = 0.6;
      const a = nav.nearest(p, true), b = nav.nearest(goal, false);
      this.path = nav.path(a, b);
      if (a >= 0 && (!this.path[0] || nav.moveRay(p.add(knee), this.path[0].add(knee)) >= 0)) this.path.unshift(nav.nodes[a].p);
      this.path.push(goal.clone());
    }
    while (this.path.length > 1 && Vector3.Distance(flat(this.path[0]), flat(p)) < 0.8) this.path.shift();
    return this.path[0] ?? goal;
  }
  private moveAir(dt: number) {
    const nav = this.host.nav;
    const p = this.position;
    const prevC = p.add(V(0, 1, 0));
    this.v.y -= G * dt;
    if (this.state === "dodge") this.v.y = Math.min(this.v.y, 0);
    p.addInPlace(this.v.scale(dt));
    const c = p.add(V(0, 1, 0));
    const hit = nav.moveHit(prevC, c);
    if (hit && hit.normal.y < 0.5) {
      const vn = Vector3.Dot(this.v, hit.normal);
      if (vn < 0) this.v.subtractInPlace(hit.normal.scale(vn * 1.1));
      p.copyFrom(hit.point.add(hit.normal.scale(0.12))).subtractInPlace(V(0, 1, 0));
    }
    // a pounce: claws into whoever's where he comes down (once)
    if (this.state === "pounce" && !this.pounceHit) {
      for (const t of this.combatants()) {
        if (Vector3.Distance(t.feet.add(V(0, 0.9, 0)), p.add(V(0, 0.9, 0))) > 1.6) continue;
        this.pounceHit = true;
        const you = t === this.host.player;
        t.takeDamage((you ? 13 : 24) * (this.berserk ? 1.25 : 1), p);
        t.knock(flat(this.v).normalize().scale(7), 2.5);
        t.knockDown?.(you ? 0.9 : 1.3);
        this.host.audio.play("knifeStab", { x: p.x, y: p.y + 1, z: p.z, volume: 1, rate: 0.85 });
        this.host.audio.play("meleeHit", { x: p.x, y: p.y + 1, z: p.z, volume: 0.9 });
        if (you) this.host.player.shake(0.3);
        this.v.x *= 0.3;
        this.v.z *= 0.3;
        break;
      }
    }
    if (this.flipRate !== 0) this.flipA += this.flipRate * dt;
    if (this.v.y <= 0) {
      const fy = nav.floorAt(p.x, p.y + 0.6 - this.v.y * dt, p.z, 0.8 - this.v.y * dt);
      if (fy !== null && p.y <= fy + 0.02) {
        p.y = fy;
        const hard = this.state === "pounce" || -this.v.y > 9;
        this.v.setAll(0);
        this.flipA = 0;
        this.flipRate = 0;
        if (hard) this.host.dust(p.clone(), 0.2);
        // thrown down out of the sky (Superman): it hurts, and the ground cracks
        if (this.slammed) {
          this.slammed = false;
          this.host.dust(p.clone(), 0.9);
          this.host.audio.play("hulkSlam", { x: p.x, y: p.y, z: p.z, volume: 1, rate: 1.3 });
          this.applyHit(160, "torso", V(0, -1, 0), p.add(V(0, 0.5, 0)), { kind: "melee", force: 0 });
          this.host.player.shake(0.3);
          if (!this.alive) return;
        }
        this.host.audio.play("land", { x: p.x, y: p.y, z: p.z, volume: 0.5 });
        this.go(this.state === "air" && hard ? "getup" : "chase");
      }
    }
    if (this.state === "dodge" && this.stateT > 0.45) {
      this.v.setAll(0);
      this.go("chase");
    }
    if (p.y < -20) p.copyFrom(this.host.player.feet.add(V(4, 0, 4)));
  }
  private fallV = 0;
  private moveDown(dt: number) {
    const p = this.position;
    // (knocked out up in the air — thrown, carried, mid-leap: he falls all the way, and lands hard)
    const fy = this.host.nav.floorAt(p.x, p.y + 0.5, p.z, 400) ?? 0;
    if (p.y > fy + 0.01) {
      this.fallV += G * dt;
      p.y = Math.max(fy, p.y - this.fallV * dt);
      if (p.y <= fy + 0.01) {
        this.fallV = 0;
        this.host.dust(p.clone(), 0.5);
        this.host.audio.play("bodyFall", { x: p.x, y: p.y, z: p.z, volume: 1 });
      }
    } else this.fallV = 0;
    void dt;
  }

  // ------------------------------------------------------------------ the body
  private animate(dt: number) {
    if (this.state === "frozen") return;
    const want = this.want;
    let rate = 14;
    const speed = flat(this.v).length();
    const s = this.state;
    if (s === "intro") {
      const t = this.intro.t;
      if (t < 4.6) copyPose(PERCH, want);
      else if (t < 5.4) copyPose(TUCK, want);
      else if (t < 6.6) {
        copyPose(BAT_LAND, want);
        rate = 28;
      } else {
        const st = this.own.stand;
        if (st) sample(st, t - 6.6, true, want);
        else copyPose(GUARD, want);
        mixPose(BAT_LAND, want, Math.min(1, (t - 6.6) / 0.8), want);
        rate = 8;
      }
    } else if (s === "attack" && this.attack) {
      const c = COMBOS[this.attack.k];
      sample(this.clipOf(c.clip), this.attack.t * c.speed, false, want);
      rate = 26;
    } else if (s === "pounce") {
      copyPose(DIVE_KICK, want);
      rate = 18;
    } else if (s === "gun") {
      copyPose(GUARD, want);
      const tgt = this.tgt;
      if (tgt) {
        const d = tgt.feet.add(V(0, 1.1, 0)).subtract(this.rig.at("RightArm")).normalize().applyRotationQuaternion(Quaternion.Inverse(this.q));
        aimArm(want, "r", [d.x, d.y, d.z]);
      }
      rate = 22;
    } else if (s === "throw") {
      mixPose(GUARD, THROW, Math.min(1, this.stateT / 0.3), want);
      rate = 24;
    } else if (s === "air") {
      copyPose(this.flipRate ? HIT : TUCK, want);
      rate = 14;
    } else if (s === "dodge") {
      sample(this.clips.roll, this.stateT * 2, false, want);
      rate = 30;
    } else if (s === "webbed") {
      copyPose(GUARD, want);
      const k = Math.sin(this.stateT * 12) * 0.12;
      want.d[3] = norm([k, 1, 0.1]);
      want.d[6] = norm([-0.2, -1, 0.1]);
      want.d[9] = norm([0.2, -1, 0.1]);
    } else if (s === "held") {
      copyPose(HIT, want);
      const k = Math.sin(this.stateT * 9) * 0.3;
      want.d[12] = norm([-0.2 + k * 0.3, -0.9, 0.3]);
      want.d[15] = norm([0.2 - k * 0.3, -0.9, -0.2]);
      rate = 10;
    } else if (s === "stagger") {
      copyPose(HIT, want);
      rate = 12;
    } else if (s === "getup") {
      mixPose(LANDING, GUARD, Math.min(1, this.stateT / 0.8), want);
      rate = 12;
    } else if (s === "down") {
      sample(this.clips.deathB, Math.min(clipDur(this.clips.deathB), this.stateT * 1.1), false, want);
      rate = 10;
    } else if (speed > 0.6) {
      // his own run and walk (the guard over them while he circles)
      const c = speed > 3 ? this.own.run ?? this.clips.run : this.own.walk ?? this.clips.walk;
      const per = speed > 3 ? 3.3 : 1.5;
      this.runPhase += dt * (speed / per);
      sample(c, this.runPhase * clipDur(c), true, want);
      if (this.stalk) mixPose(want, GUARD, 0.7, want, UPPER);
      rate = 40;
    } else {
      copyPose(GUARD, want);
      const b = Math.sin(performance.now() / 600) * 0.02;
      want.d[3] = norm([want.d[3][0], want.d[3][1] + b, want.d[3][2]]);
    }
    follow(this.shown, want, rate, dt);
    if (!this.shown.d.every((d) => isFinite(d[0] + d[1] + d[2]))) copyPose(GUARD, this.shown);
    const fwd = V(Math.sin(this.heading), 0, Math.cos(this.heading));
    lookRotation(fwd, V(0, 1, 0), this.q);
    if (this.flipA !== 0) this.q.multiplyInPlace(Quaternion.RotationAxis(V(1, 0, 0), this.flipA));
    const anc = this.rig.anchor;
    anc.rotationQuaternion!.copyFrom(this.q);
    if (this.flipA !== 0) {
      const mid = V(0, this.rig.hipH, 0).applyRotationQuaternion(this.q);
      anc.position.copyFrom(this.position).addInPlace(V(0, this.rig.hipH, 0)).subtractInPlace(mid);
    } else anc.position.copyFrom(this.position);
    const hip = this.shown.hip;
    this.rig.pose(this.shown.d, V(hip[0] * this.rig.hipH, hip[1] * this.rig.hipH, hip[2] * this.rig.hipH));
    const fist = s === "down" || s === "throw" ? 0.3 : 0.95;
    this.gripK += (fist - this.gripK) * Math.min(1, dt * 10);
    this.rig.grip?.("l", this.gripK);
    this.rig.grip?.("r", this.gripK);
    // the gun in his right fist while he's using it
    if (this.gun) {
      const on = s === "gun" && this.stateT > 0.2;
      this.gun.setEnabled(on);
      if (on) {
        const hand = this.rig.at("RightHand"), mid = this.rig.at("RightHandMiddle1"), elbow = this.rig.at("RightForeArm");
        const fore = hand.subtract(elbow).normalize();
        this.gun.position.copyFrom(hand.add(mid.subtract(hand).scale(0.6)));
        lookRotation(fore, V(0, 1, 0), this.gun.rotationQuaternion!);
      }
    }
    this.solid.position.set(this.position.x, this.position.y + 0.92, this.position.z);
    this.solid.rotation.y = this.heading;
  }

  private placeHitboxes() {
    for (const hb of this.hitboxes) {
      const a = this.rig.at(hb.a), b = this.rig.at(hb.b);
      const mid = a.add(b).scale(0.5);
      const ab = b.subtract(a);
      const L = ab.length();
      hb.m.position.copyFrom(mid);
      hb.m.scaling.y = Math.max(0.2, L + 0.12);
      const yaw = Math.atan2(ab.x, ab.z);
      const pitch = Math.acos(Math.max(-1, Math.min(1, ab.y / Math.max(1e-4, L))));
      hb.m.rotation.set(pitch, yaw, 0);
    }
  }

  reset() {
    this.alive = false;
    this.go("dormant");
    this.attack = null;
    this.vanished = 0;
    this.rig.setVisible(false);
    this.car?.setVisible(false);
    this.car?.open(0);
    this.engine?.stop(0);
    this.engine = null;
    for (const b of this.hitboxes) b.m.isPickable = false;
    for (const r of this.rangs) {
      r.t = r.dur = 0;
      r.m.setEnabled(false);
    }
    this.smoke.reset();
    this.exhaust.reset();
    this.solid.checkCollisions = false;
    this.hud.classList.remove("on", "l2");
    this.line.classList.remove("on");
    this.threatOf.clear();
    this.tgt = null;
    this.cd = { attack: 0, pounce: 4, throw: 3, smoke: 8, gun: 6, dodge: 0, taunt: 6, line: 3, web: 0 };
    this.gun?.setEnabled(false);
  }
}
