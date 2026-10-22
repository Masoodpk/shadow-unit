import { Color3 } from "@babylonjs/core/Maths/math.color";
import { FreeCamera } from "@babylonjs/core/Cameras/freeCamera";
import { Mesh } from "@babylonjs/core/Meshes/mesh";
import { MeshBuilder } from "@babylonjs/core/Meshes/meshBuilder";
import { PointLight } from "@babylonjs/core/Lights/pointLight";
import { Matrix, Quaternion, Vector3 } from "@babylonjs/core/Maths/math.vector";
import { Scene } from "@babylonjs/core/scene";
import { StandardMaterial } from "@babylonjs/core/Materials/standardMaterial";
import { AudioEngine } from "../audio/AudioEngine";
import { lookRotation } from "../core/math";
import type { Combatant, Foe, HulkThreat } from "../enemies/Hulk";
import { NavGraph } from "../level/NavGraph";
import type { Dir } from "./SpiderRig";
import { SkinnedModel, type Rig } from "./HeroRig";
import {
  HIT, LANDING, RELAXED, STANCE, TUCK, aimArm, clipDur, copyPose, follow, loadSpiderClips, mixPose, newPose, pose, sample,
  type ClipName, type DirClip, type Pose,
} from "./SpiderPoses";
import type { TeamBoard } from "./Team";
import { ThrusterFx } from "./IronFx";
import type { SoldierLike } from "./SpiderMan";

/**
 * IRON MAN — the second ally on Red Dune ("Iron Man" by Grant Riley, CC BY-NC 4.0; a static mesh,
 * rigged at load by SpiderRig like Spider-Man). 45 s after Spider-Man turns up he comes in out of
 * the sky — the thrusters heard first, then the armour dropping in, braking hard, the landing on one
 * knee, the turn to the Hulk with a palm raised — and takes to the air for the fight.
 *
 * He flies on a thrust model: an acceleration toward where he wants to be (it arrives and brakes
 * rather than snapping there), gravity when the thrusters cut, a look-ahead for walls with a push
 * away and up, an altitude band and the map's bounds. Boot and palm thrusters burn harder the
 * harder he accelerates, and a light and a roar go with them.
 *
 * He fights from the air: single repulsor shots, bursts, a charged blast, the unibeam (a clear
 * charge, a beam that holds for a second and a half, a long cooldown), a dive from above the Hulk
 * into a powered punch, and close-in punches with his thrusters behind them. Every blow is checked
 * against where the Hulk really is when it lands. He reads the Hulk's wind-ups to dodge, braces when
 * he can't, takes knockback, rights himself in the air and comes back. With Spider-Man he plays off
 * whatever the Hulk is doing: the Hulk turned on Spidey — Iron Man opens fire from a clear angle; the
 * Hulk webbed or bucking — Iron Man drops on him from above; the Hulk on you — a shot to turn him.
 */

export interface IronHost {
  scene: Scene;
  nav: NavGraph;
  audio: AudioEngine;
  player: { feet: Vector3; alive: boolean; yaw: number; health: number; knockedDown: boolean; camera: FreeCamera; shake(a: number): void };
  playerMaxHealth: number;
  hulk: Foe | null;
  soldiers: () => SoldierLike[];
  /** the other ally */
  spidey: () => Combatant | null;
  team: TeamBoard;
  bounds: { minX: number; maxX: number; minZ: number; maxZ: number };
  energy: (pos: Vector3, power: number) => void;
  dust: (pos: Vector3, power: number) => void;
}

type Mode = "fly" | "ground" | "tumble" | "ko";
export type IronState =
  | "intro" | "follow" | "locate" | "approach" | "takeoff" | "hover" | "position" | "repulsor" | "charged" | "unibeam"
  | "melee" | "dive" | "dodge" | "defend" | "recover" | "land" | "assist" | "victory";

interface Action {
  kind: "shot" | "burst" | "charged" | "unibeam" | "dive" | "melee" | "dodge" | "brace" | "land" | "getup" | "intro" | "victory";
  t: number;
  dur: number;
  phase?: number;
  shots?: number;
  hand?: "l" | "r";
  clip?: ClipName;
  hits?: number[];
  hitsDone?: number;
}

const G = 16;
const IRON = {
  health: 540,
  cruise: 13,
  dash: 24,
  accel: 16,
  dashAccel: 34,
  minAlt: 1.2,
  maxAlt: 16,
  /** where he likes to fight from: this far from the Hulk, this high (in close: he's in the fight, not above it) */
  range: [5, 8.5],
  height: [1.6, 3.4],
};

const V = (x = 0, y = 0, z = 0) => new Vector3(x, y, z);
const flat = (v: Vector3) => new Vector3(v.x, 0, v.z);
const angDiff = (a: number, b: number) => Math.atan2(Math.sin(a - b), Math.cos(a - b));
const rnd = (a: number, b: number) => a + Math.random() * (b - a);
const pick = <T,>(a: T[]) => a[Math.floor(Math.random() * a.length)];

// ------------------------------------------------------------------ his poses (body frame)
/** hovering: legs together and just bent, toes down, arms down and a little out, palms to the ground */
const HOVER = pose(
  {
    hips: [0, 1, 0], spine: [0, 1, 0.02], spine1: [0, 1, 0.02], spine2: [0, 1, 0], neck: [0, 1, 0.05], head: [0, 1, 0.08],
    lArm: [-0.35, -0.94, 0.05], lFore: [-0.3, -0.95, 0.08], lHand: [-0.12, -0.3, 0.95],
    lThigh: [-0.04, -1, 0.12], lShin: [0, -1, -0.12], lFoot: [0, -0.85, 0.5],
    rThigh: [0.04, -1, 0.08], rShin: [0, -1, -0.18], rFoot: [0, -0.85, 0.5],
  },
  [0, 1, 0],
);
/** flying (the body is pitched forward by his orientation): legs straight back, arms back along his sides, palms back */
const FLY = pose(
  {
    hips: [0, 1, 0], spine: [0, 1, 0.05], spine1: [0, 1, 0.08], spine2: [0, 1, 0.1], neck: [0, 0.8, 0.6], head: [0, 0.45, 0.9],
    lArm: [-0.28, -0.9, -0.33], lFore: [-0.2, -0.92, -0.35], lHand: [-0.1, -0.3, -0.95],
    lThigh: [-0.06, -1, -0.06], lShin: [-0.02, -1, -0.04], lFoot: [0, -0.55, -0.83],
    rThigh: [0.06, -1, -0.04], rShin: [0.02, -1, -0.08], rFoot: [0, -0.55, -0.83],
  },
  [0, 1, 0],
);
/** the unibeam: chest thrown out, arms back and down, fists, legs braced */
const UNIBEAM = pose(
  {
    hips: [0, 1, -0.05], spine: [0, 1, -0.12], spine1: [0, 1, -0.2], spine2: [0, 1, -0.25], neck: [0, 1, 0.1], head: [0, 1, 0.05],
    lArm: [-0.55, -0.7, -0.45], lFore: [-0.45, -0.8, -0.4], lHand: [-0.3, -0.9, -0.3],
    lThigh: [-0.22, -0.95, 0.15], lShin: [-0.1, -0.98, -0.18],
    rThigh: [0.25, -0.95, -0.12], rShin: [0.1, -0.98, -0.15],
  },
  [0, 0.97, 0],
);
/** braced against a blow: forearms crossed in front of his face */
const BRACE = pose(
  {
    hips: [0, 1, 0.1], spine: [0, 1, 0.15], spine1: [0, 1, 0.2], spine2: [0, 1, 0.15], neck: [0, 1, 0.2], head: [0, 0.95, 0.3],
    lArm: [-0.3, -0.45, 0.84], lFore: [0.82, 0.45, 0.35], lHand: [0.6, 0.7, 0.4],
    rArm: [0.32, -0.4, 0.86], rFore: [-0.85, 0.42, 0.3], rHand: [-0.6, 0.72, 0.36],
    lThigh: [-0.15, -0.95, 0.25], lShin: [-0.05, -0.95, -0.3],
  },
  [0, 0.92, 0],
);
/** the dive (his body points along the flight, head first): right fist driven ahead, left arm back */
const DIVE = pose(
  {
    hips: [0, 1, 0], spine: [0, 1, 0.05], spine1: [0, 1, 0.08], spine2: [0, 1, 0.05], neck: [0, 1, 0.2], head: [0, 0.9, 0.45],
    rArm: [0.15, 0.97, 0.18], rFore: [0.08, 0.99, 0.12], rHand: [0.05, 0.99, 0.1],
    lArm: [-0.3, -0.9, -0.3], lFore: [-0.2, -0.92, -0.33], lHand: [-0.1, -0.3, -0.95],
    lThigh: [-0.06, -1, -0.1], lShin: [-0.02, -1, -0.05], lFoot: [0, -0.55, -0.83],
    rThigh: [0.08, -1, 0.15], rShin: [0.02, -0.9, -0.4], rFoot: [0, -0.55, -0.83],
  },
  [0, 1, 0],
);

/** a quaternion turning +Y onto `d` */
function fromY(d: Vector3, out: Quaternion) {
  const y = Vector3.UpReadOnly;
  const c = Vector3.Dot(y, d);
  if (c > 0.9999) return out.set(0, 0, 0, 1);
  if (c < -0.9999) return out.set(1, 0, 0, 0);
  const ax = Vector3.Cross(y, d).normalize();
  return Quaternion.RotationAxisToRef(ax, Math.acos(c), out);
}

/** additive glow material */
function glow(scene: Scene, name: string, c: Color3, alpha = 1) {
  const m = new StandardMaterial(name, scene);
  m.disableLighting = true;
  m.emissiveColor = c;
  m.alpha = alpha;
  m.alphaMode = 1; // ADD
  m.backFaceCulling = false;
  return m;
}

interface Bolt {
  core: Mesh;
  trail: Mesh;
  on: boolean;
  pos: Vector3;
  vel: Vector3;
  life: number;
  damage: number;
  force: number;
  big: boolean;
  /** shot at a soldier (not the Hulk) */
  soldier: SoldierLike | null;
  /** turning after its target (something in the sky) */
  homing?: boolean;
}

export class IronMan implements Combatant {
  readonly rig: Rig;
  /** the model's own Mixamo flying clip, and where in it he is */
  private flyClip: DirClip | null;
  private flyT = 0;
  private flyPose = newPose();
  /** feet */
  readonly p = V();
  readonly v = V();
  yaw = 0;
  mode: Mode = "fly";
  ai: IronState = "follow";
  health = IRON.health;
  readonly maxHealth = IRON.health;
  private enabled = false;
  private clips!: Record<ClipName, DirClip>;
  private action: Action | null = null;
  private aiT = 0;
  private thinkT = 0;
  private cd = { shot: 1, burst: 3, charged: 6, unibeam: 14, dive: 8, melee: 6, dodge: 0, slot: 0, quip: 10, takeoff: 0, soldier: 4 };
  /** where he's flying to, and how hard */
  private goal: Vector3 | null = null;
  private dash = false;
  private slot = V();
  private side = 1;
  private shown = newPose();
  private want = newPose();
  private tmp = newPose();
  private q = new Quaternion();
  private pitch = 0;
  private roll = 0;
  private thrust = 0;
  private thrustLoop: ReturnType<AudioEngine["playLoop"]> | null = null;
  private gaveUp = new Map<SoldierLike, number>();
  private huntOf: SoldierLike | null = null;
  private huntT = 0;
  /** the fight's over: up into the sky and away */
  private departing = false;
  private departT = 0;
  private koT = 0;
  private tumbleT = 0;
  private reaction = -1;
  private pending: HulkThreat | null = null;
  private wasFighting = false;
  private charge = 0;
  private chestCharge = 0;
  // effects
  private flames: { outer: Mesh; inner: Mesh }[] = [];
  private palmGlow: Mesh[] = [];
  private chestGlow: Mesh;
  private beam: { outer: Mesh; inner: Mesh };
  private light: PointLight;
  /** the flares and the plume of fire from each nozzle */
  private plume: ThrusterFx;
  private bolts: Bolt[] = [];
  private fq = new Quaternion();
  private hud: HTMLDivElement;
  private hudBar: HTMLDivElement;
  private line: HTMLDivElement;
  private lineT = 0;
  private intro = { t: -1, from: V(), to: V(), dur: 2.4 };

  private constructor(private host: IronHost, model: SkinnedModel) {
    const scene = host.scene;
    this.rig = model.spawn();
    this.flyClip = model.clips["mixamo.com"] ?? Object.values(model.clips)[0] ?? null;
    this.rig.setVisible(false);
    // thrusters: a flame from each boot and each palm (an outer cone and a hot core)
    const outerMat = glow(scene, "ironFlameOuter", new Color3(1, 0.55, 0.22), 0.75);
    const innerMat = glow(scene, "ironFlameInner", new Color3(0.85, 0.92, 1), 0.95);
    for (let i = 0; i < 4; i++) {
      const outer = MeshBuilder.CreateCylinder("ironFlame", { height: 1, diameterTop: 0.02, diameterBottom: 0.2, tessellation: 10 }, scene);
      const inner = MeshBuilder.CreateCylinder("ironFlameCore", { height: 1, diameterTop: 0.01, diameterBottom: 0.09, tessellation: 8 }, scene);
      // (cylinders are built with the top at +Y: the flame's tip there, its base at the nozzle)
      for (const m of [outer, inner]) {
        // (the wide end at the origin — the nozzle — and the flame growing away along +Y)
        m.bakeTransformIntoVertices(Matrix.Translation(0, 0.5, 0));
        m.isPickable = false;
        m.rotationQuaternion = new Quaternion();
        m.setEnabled(false);
      }
      outer.material = outerMat;
      inner.material = innerMat;
      this.flames.push({ outer, inner });
    }
    const palmMat = glow(scene, "ironPalm", new Color3(0.45, 0.75, 1), 0.6);
    for (let i = 0; i < 2; i++) {
      const g = MeshBuilder.CreateSphere("ironPalmGlow", { diameter: 0.22, segments: 8 }, scene);
      g.material = palmMat;
      g.isPickable = false;
      g.setEnabled(false);
      this.palmGlow.push(g);
    }
    this.chestGlow = MeshBuilder.CreateSphere("ironChestGlow", { diameter: 0.34, segments: 10 }, scene);
    this.chestGlow.material = palmMat;
    this.chestGlow.isPickable = false;
    this.chestGlow.setEnabled(false);
    const beamOuter = MeshBuilder.CreateCylinder("unibeam", { height: 1, diameter: 0.55, tessellation: 14 }, scene);
    const beamInner = MeshBuilder.CreateCylinder("unibeamCore", { height: 1, diameter: 0.2, tessellation: 10 }, scene);
    beamOuter.material = glow(scene, "unibeamMat", new Color3(0.4, 0.75, 1), 0.55);
    beamInner.material = glow(scene, "unibeamCoreMat", new Color3(0.9, 0.97, 1), 1);
    for (const m of [beamOuter, beamInner]) {
      m.isPickable = false;
      m.rotationQuaternion = new Quaternion();
      m.setEnabled(false);
    }
    this.beam = { outer: beamOuter, inner: beamInner };
    // repulsor bolts: a hot core and a streak behind it (a fixed pool)
    const boltMat = glow(scene, "repulsorMat", new Color3(0.6, 0.88, 1), 1);
    const trailMat = glow(scene, "repulsorTrail", new Color3(0.3, 0.6, 1), 0.6);
    for (let i = 0; i < 10; i++) {
      const core = MeshBuilder.CreateSphere("repulsor", { diameter: 0.26, segments: 6 }, scene);
      // (its +Y points back along the flight: thin at the back, wide at the bolt)
      const trail = MeshBuilder.CreateCylinder("repulsorStreak", { height: 1, diameterTop: 0.02, diameterBottom: 0.2, tessellation: 8 }, scene);
      core.material = boltMat;
      trail.material = trailMat;
      trail.rotationQuaternion = new Quaternion();
      for (const m of [core, trail]) {
        m.isPickable = false;
        m.setEnabled(false);
      }
      this.bolts.push({ core, trail, on: false, pos: V(), vel: V(), life: 0, damage: 0, force: 0, big: false, soldier: null });
    }
    this.plume = new ThrusterFx(scene);
    // one light for the thrusters (and the beam's glare)
    this.light = new PointLight("ironLight", V(), scene);
    this.light.range = 7;
    this.light.intensity = 0;
    this.light.diffuse = new Color3(1, 0.6, 0.3);
    this.light.specular = new Color3(0.4, 0.3, 0.2);
    // his health, and his lines
    this.hud = document.createElement("div");
    this.hud.id = "ally-hud-iron";
    this.hud.className = "ally-hud";
    this.hud.innerHTML = `<div class="ally-name">IRON MAN</div><div class="ally-track"><div class="ally-bar"></div></div><div class="ally-state"></div>`;
    document.getElementById("hud")?.appendChild(this.hud);
    this.hudBar = this.hud.querySelector(".ally-bar") as HTMLDivElement;
    this.hud.style.display = "none";
    this.line = document.createElement("div");
    this.line.id = "iron-line";
    document.getElementById("hud")?.appendChild(this.line);
  }

  static async create(host: IronHost, model: SkinnedModel) {
    const s = new IronMan(host, model);
    s.clips = await loadSpiderClips();
    return s;
  }

  say(text: string, secs = 3) {
    this.line.innerHTML = `<b>IRON MAN</b> ${text}`;
    this.line.classList.add("on");
    this.lineT = secs;
    this.cd.quip = 16 + Math.random() * 12;
  }

  // ------------------------------------------------------------------ Combatant
  get feet() {
    return this.p;
  }
  get alive() {
    return this.enabled && this.mode !== "ko" && this.intro.t < 0;
  }
  get active() {
    return this.enabled;
  }
  get cinematic() {
    return this.enabled && this.action?.kind === "intro";
  }
  cineFocus() {
    return this.center().add(V(0, 0.3, 0));
  }
  /** skip the entrance: landed, and up into the fight */
  skip() {
    if (this.action?.kind !== "intro") return;
    this.p.copyFrom(this.intro.to);
    this.v.setAll(0);
    this.charge = 0;
    this.said = false;
    this.intro.t = -1;
    this.action = null;
    this.mode = "ground";
    this.takeOff();
  }
  /**
   * The entrance's camera, shot by shot: low on the ground looking up as he dives in out of the
   * sky; a low angle as he drops the last metres on his boots; a slow push-in on the landing; then
   * over his shoulder as he turns to the Hulk and raises his palm.
   */
  cineShot(): { pos: Vector3; target: Vector3; fov: number; cut?: boolean } | null {
    const a = this.action;
    if (!this.enabled || a?.kind !== "intro") return null;
    const I = this.intro;
    const L = I.to;
    const toYou = flat(this.host.player.feet.subtract(L));
    if (toYou.lengthSquared() < 1e-3) toYou.set(0, 0, 1);
    toYou.normalize();
    const side = V(toYou.z, 0, -toYou.x);
    const c = this.center();
    const t = a.t;
    if (t < I.dur) {
      // 1 — from the ground near where he'll land, looking up at him coming in
      const pos = L.add(toYou.scale(7)).addInPlace(side.scale(2.5)).addInPlaceFromFloats(0, 1.1, 0);
      const d = Vector3.Distance(pos, c);
      return { pos, target: c, fov: Math.max(0.18, Math.min(0.9, 2 * Math.atan(3.2 / Math.max(1, d)))) };
    }
    if (t < I.dur + 0.75) {
      // 2 — low, close, looking up as he drops the last metres, boots blazing
      return { pos: L.add(toYou.scale(4.2)).addInPlace(side.scale(-1.8)).addInPlaceFromFloats(0, 0.5, 0), target: c, fov: 0.95, cut: t - I.dur < 0.03 };
    }
    const fwd = V(Math.sin(this.yaw), 0, Math.cos(this.yaw));
    const right = V(Math.cos(this.yaw), 0, -Math.sin(this.yaw));
    const k = t - I.dur - 0.75;
    if (k < 1.5) {
      // 3 — the landing: a slow push in on him, down on one knee, then rising
      const f = k / 1.5;
      return { pos: this.p.add(fwd.scale(4.4 - f * 1.3)).addInPlace(right.scale(1.2)).addInPlaceFromFloats(0, 0.7 + f * 0.6, 0), target: this.p.add(V(0, 0.8 + f * 0.5, 0)), fov: 0.8, cut: k < 0.03 };
    }
    // 4 — over his shoulder: the raised palm, and the Hulk beyond it
    const h = this.host.hulk;
    const look = h ? this.chestOf(h) : this.p.add(fwd.scale(12)).addInPlaceFromFloats(0, 1.5, 0);
    return { pos: this.p.subtract(fwd.scale(2.3)).addInPlace(right.scale(0.85)).addInPlaceFromFloats(0, 1.95, 0), target: look, fov: 0.7, cut: k < 1.53 };
  }
  takeDamage(amount: number, _from: Vector3) {
    if (!this.alive) return;
    // the armour takes most of it (and bracing more)
    const k = this.action?.kind === "brace" ? 0.18 : 0.42;
    this.health = Math.max(0, this.health - amount * k);
    this.host.audio.play("ironClank", { x: this.p.x, y: this.p.y + 1.2, z: this.p.z, volume: 0.7, rate: 1.2 });
    if (this.health <= 0) this.knockOut();
  }
  knock(vel: Vector3, up = 0) {
    if (!this.alive) return;
    // braced: he's shoved, not thrown
    const k = this.action?.kind === "brace" ? 0.35 : 1;
    this.v.copyFrom(vel).scaleInPlace(0.9 * k);
    this.v.y = Math.max(this.v.y, (up + 2) * k);
    this.mode = "tumble";
    this.tumbleT = 0;
    this.action = null;
    this.ai = "recover";
  }
  knockDown(seconds: number) {
    this.tumbleT = -seconds * 0.3;
  }

  // ------------------------------------------------------------------ in and out
  /** the entrance: in out of the sky to `at`, then turn to the Hulk */
  enter(at: Vector3) {
    this.enabled = true;
    this.health = this.maxHealth;
    const away = flat(at.subtract(this.host.player.feet));
    if (away.lengthSquared() < 1e-3) away.set(0, 0, 1);
    away.normalize();
    // from far off and high, beyond the landing spot, the way you're looking
    this.intro = { t: 0, from: at.add(away.scale(60)).addInPlaceFromFloats(0, 38, 0), to: at.clone(), dur: 2.6 };
    this.p.copyFrom(this.intro.from);
    this.v.copyFrom(at.subtract(this.intro.from).normalize().scale(30));
    this.yaw = Math.atan2(-away.x, -away.z);
    this.mode = "fly";
    this.action = { kind: "intro", t: 0, dur: 6.2 };
    this.ai = "intro";
    copyPose(FLY, this.shown);
    this.rig.setVisible(true);
    this.hud.style.display = "";
    this.thrustLoop?.stop(0.1);
    this.thrustLoop = this.host.audio.playLoop("thrustLoop", { x: this.p.x, y: this.p.y, z: this.p.z, volume: 0.9 });
    this.host.audio.play("hulkIncoming", { volume: 0.55, rate: 1.35 });
  }
  hide() {
    this.enabled = false;
    for (const b of this.bolts) if (b.on) this.freeBolt(b);
    this.rig.setVisible(false);
    this.hud.style.display = "none";
    this.line.classList.remove("on");
    this.thrustLoop?.stop(0.1);
    this.thrustLoop = null;
    for (const f of this.flames) f.outer.setEnabled(false), f.inner.setEnabled(false);
    for (const g of this.palmGlow) g.setEnabled(false);
    this.chestGlow.setEnabled(false);
    this.beam.outer.setEnabled(false);
    this.beam.inner.setEnabled(false);
    for (const b of this.bolts) this.freeBolt(b);
    this.plume.reset();
    this.light.intensity = 0;
    this.intro.t = -1;
  }
  private knockOut() {
    this.mode = "ko";
    this.koT = 9;
    this.action = null;
    this.ai = "recover";
    this.say(pick(["Okay. Ow.", "Rebooting… rebooting…", "Note to self: don't do that again."]), 2.4);
  }

  /** a landing spot for the entrance: open ground 9–16 m in front of you, clear overhead, in sight */
  landingSpot(player: Vector3, eye: Vector3, look: Vector3, hulk: Vector3 | null) {
    const nav = this.host.nav;
    let best: Vector3 | null = null, bestS = -Infinity;
    for (const n of nav.nodes) {
      const d = Math.hypot(n.p.x - player.x, n.p.z - player.z);
      if (d < 9 || d > 17) continue;
      if (hulk && Math.hypot(n.p.x - hulk.x, n.p.z - hulk.z) < 8) continue;
      if (!nav.clear(n.p.add(V(0, 1.2, 0)), n.p.add(V(0, 40, 0)))) continue;
      if ([[1.2, 0], [-1.2, 0], [0, 1.2], [0, -1.2]].some(([dx, dz]) => nav.embedded(n.p.x + dx, n.p.y + 1, n.p.z + dz))) continue;
      if (!nav.clear(eye, n.p.add(V(0, 1.2, 0)))) continue;
      const to = flat(n.p.subtract(player)).normalize();
      const sc = Vector3.Dot(to, flat(look).normalize()) * 8 - Math.abs(d - 12) * 0.4;
      if (sc > bestS) (bestS = sc), (best = n.p.clone());
    }
    return best;
  }

  // ------------------------------------------------------------------ frame
  update(dt: number) {
    // (bolts already in flight finish their flight even after he's gone)
    if (!this.enabled) {
      this.updateBolts(dt);
      return;
    }
    for (const k of Object.keys(this.cd) as (keyof typeof this.cd)[]) this.cd[k] -= dt;
    this.aiT += dt;
    if (this.lineT > 0 && (this.lineT -= dt) <= 0) this.line.classList.remove("on");
    if (this.action?.kind === "intro") this.introFrame(dt);
    else if (this.mode === "ko") this.recovering(dt);
    else {
      this.react(dt);
      this.think(dt);
      this.act(dt);
    }
    if (this.departing) {
      this.departT += dt;
      if (this.departT > 1.2) {
        const away = flat(this.p.subtract(this.host.player.feet));
        if (away.lengthSquared() < 1e-3) away.set(0, 0, 1);
        this.goal = this.p.add(away.normalize().scale(40)).addInPlaceFromFloats(0, 60, 0);
        this.dash = true;
      }
      if (this.departT > 6.5) {
        this.hide();
        return;
      }
    }
    if (this.action?.kind !== "intro") this.move(dt);
    if (!isFinite(this.p.x + this.p.y + this.p.z + this.v.x + this.v.y + this.v.z)) {
      console.warn("ironman: bad state, resetting");
      this.p.copyFrom(this.host.player.feet.add(V(2, 4, 0)));
      this.v.setAll(0);
      this.mode = "fly";
    }
    this.animate(dt);
    this.updateBolts(dt);
    this.effects(dt);
    this.hudBar.style.width = `${(100 * this.health) / this.maxHealth}%`;
    this.hud.classList.toggle("ko", this.mode === "ko");
    (this.hud.querySelector(".ally-state") as HTMLDivElement).textContent = this.mode === "ko" ? "DOWN" : "";
  }

  private center() {
    return this.p.add(V(0, 1.0, 0));
  }
  private get hulk() {
    const h = this.host.hulk;
    return h && h.alive && h.state !== "dormant" ? h : null;
  }
  private chestOf(h: Foe) {
    return h.position.add(V(0, 1.75 * h.size, 0));
  }
  private floorUnder(p: Vector3) {
    return this.host.nav.floorAt(p.x, p.y + 0.2, p.z, 40) ?? 0;
  }

  // ------------------------------------------------------------------ the entrance
  private introFrame(dt: number) {
    const a = this.action!;
    a.t += dt;
    const I = this.intro;
    const h = this.host.hulk;
    if (a.t < I.dur) {
      // the dive in: fast at first, braking toward a point above the landing spot
      const f = a.t / I.dur;
      const e = 1 - Math.pow(1 - f, 2.6);
      const hoverAt = I.to.add(V(0, 5, 0));
      const prev = this.p.clone();
      Vector3.LerpToRef(I.from, hoverAt, e, this.p);
      this.v.copyFrom(this.p.subtract(prev).scale(1 / Math.max(1e-3, dt)));
      this.thrust = 0.6 + (1 - f) * 0.4;
      if (flat(this.v).lengthSquared() > 1) this.yaw = Math.atan2(this.v.x, this.v.z);
    } else if (a.t < I.dur + 0.75) {
      // upright, boots blazing, coming straight down
      const f = (a.t - I.dur) / 0.75;
      this.p.copyFrom(I.to).addInPlaceFromFloats(0, 5 * (1 - f * f), 0);
      this.v.set(0, -10 * f, 0);
      this.thrust = 1.1;
      if (h) this.turnTo(Math.atan2(h.position.x - this.p.x, h.position.z - this.p.z), dt, 2);
      if (f >= 1 - 1e-3 || a.t + dt >= I.dur + 0.75) this.touchdown();
    } else {
      // on one knee… up… the turn to the Hulk, a palm raised and charging
      this.p.copyFrom(I.to);
      this.v.setAll(0);
      this.thrust = Math.max(0, this.thrust - dt * 2.5);
      if (h) this.turnTo(Math.atan2(h.position.x - this.p.x, h.position.z - this.p.z), dt, 3);
      const t = a.t - I.dur - 0.75;
      if (t > 1.5 && !this.said) {
        this.said = true;
        this.say(pick(["Sorry I'm late. Traffic was murder.", "Hey, big guy. Sun's getting real low.", "Did I miss the party? Looks like I didn't."]), 3.2);
        this.host.audio.play("servo", { x: this.p.x, y: this.p.y + 1.4, z: this.p.z, volume: 0.6 });
        this.host.audio.play("repulsorCharge", { x: this.p.x, y: this.p.y + 1.4, z: this.p.z, volume: 0.5 });
      }
      this.charge = t > 1.5 ? Math.min(1, (t - 1.5) / 1.2) : 0;
      if (a.t >= a.dur) {
        this.charge = 0;
        this.said = false;
        this.intro.t = -1;
        this.action = null;
        this.mode = "ground";
        this.ai = "takeoff";
        this.takeOff();
      }
    }
    this.thrustLoop?.setPosition(this.p.x, this.p.y, this.p.z);
  }
  private said = false;
  private touchdown() {
    const p = this.intro.to;
    this.host.audio.play("ironClank", { x: p.x, y: p.y, z: p.z, volume: 1, rate: 0.8 });
    this.host.audio.play("hulkSlam", { x: p.x, y: p.y, z: p.z, volume: 0.45, rate: 1.4 });
    this.host.dust(p.clone(), 0.55);
    this.host.player.shake(0.35);
    this.thrust = 0.3;
  }

  // ------------------------------------------------------------------ reading the Hulk
  private react(dt: number) {
    const h = this.hulk;
    if (!h || h.cinematic || this.mode === "tumble") return;
    if (this.reaction >= 0) {
      this.reaction -= dt;
      if (this.reaction < 0 && this.pending) this.evade(this.pending);
      return;
    }
    if (this.cd.dodge > 0) return;
    if (this.action && (this.action.kind === "dodge" || this.action.kind === "brace" || this.action.kind === "getup")) return;
    const t = h.threat();
    if (!t || t.t > 0.55 || !this.inDanger(t)) return;
    this.reaction = rnd(0.06, 0.18);
    this.pending = t;
  }
  private inDanger(t: HulkThreat) {
    const to = this.p.subtract(t.at);
    if (to.y > (t.kind === "clap" ? 3 : 2.4)) return false;
    to.y = 0;
    const d = to.length();
    if (d > t.radius + 0.8) return false;
    if (t.cone >= Math.PI || d < 0.5) return true;
    return Math.abs(angDiff(Math.atan2(to.x, to.z), Math.atan2(t.dir.x, t.dir.z))) < t.cone + 0.25;
  }
  /** an aerial dodge — or, with no time and no room, a brace */
  private evade(t: HulkThreat) {
    this.pending = null;
    this.cd.dodge = 1.1;
    const away = flat(this.p.subtract(t.at));
    if (away.lengthSquared() < 1e-3) away.set(1, 0, 0);
    away.normalize();
    if (t.t < 0.12 && t.kind === "punch") {
      this.action = { kind: "brace", t: 0, dur: 0.7 };
      this.ai = "defend";
      this.host.audio.play("servo", { x: this.p.x, y: this.p.y + 1.4, z: this.p.z, volume: 0.5, rate: 1.3 });
      return;
    }
    const side = V(away.z, 0, -away.x).scale(Math.random() < 0.5 ? 1 : -1);
    const dir = t.kind === "clap" ? side.add(away.scale(0.3)) : away.add(side.scale(0.5));
    dir.normalize();
    if (this.mode === "ground") this.mode = "fly";
    this.v.addInPlace(dir.scale(15)).addInPlaceFromFloats(0, 7, 0);
    this.action = { kind: "dodge", t: 0, dur: 0.5 };
    this.ai = "dodge";
    this.roll = Math.sign(Vector3.Dot(dir, V(Math.cos(this.yaw), 0, -Math.sin(this.yaw)))) * 0.9;
  }

  // ------------------------------------------------------------------ deciding
  private think(dt: number) {
    this.thinkT -= dt;
    if (this.thinkT > 0 || this.mode === "tumble") return;
    this.thinkT = 0.25;
    const host = this.host;
    if (host.hulk?.cinematic) return;
    if (this.wasFighting && host.hulk && !host.hulk.alive && host.hulk.state === "down") {
      if (this.ai !== "victory" && this.ai !== "assist") {
        this.say(pick(["And that's how it's done.", "Big guy's down. Somebody get him a smoothie.", "Remind me to never make him angry."]), 3.2);
      }
      if (this.mode === "ground" && !this.action) return this.takeOff();
      // soldiers still standing: hunt them from the air
      const now = performance.now() / 1000;
      let left = this.host.soldiers().filter((x) => x.alive && (this.gaveUp.get(x) ?? 0) < now);
      // (only the ones he'd given up on are left: back to them — he doesn't leave with anyone standing)
      if (!left.length && this.host.soldiers().some((x) => x.alive)) {
        this.gaveUp.clear();
        left = this.host.soldiers().filter((x) => x.alive);
      }
      if (left.length) {
        this.ai = "assist";
        if (this.action) return;
        const seen = this.soldierInSight(60);
        if (seen && this.cd.soldier <= 0) {
          this.cd.soldier = rnd(0.9, 1.5);
          return this.shootSoldier(seen);
        }
        // to a spot above the nearest one, where he can see him
        let near = left[0], nd = Infinity;
        for (const x of left) {
          const d = Vector3.Distance(x.position, this.p);
          if (d < nd) (nd = d), (near = x);
        }
        // the same one too long without a clear shot (he's indoors): someone else for a while
        if (this.huntOf !== near) (this.huntOf = near), (this.huntT = 0);
        this.huntT += 0.25;
        if (this.huntT > 8) {
          this.gaveUp.set(near, now + 30);
          this.huntOf = null;
          return;
        }
        const back = flat(this.p.subtract(near.position));
        if (back.lengthSquared() < 1e-3) back.set(1, 0, 0);
        this.goal = near.position.add(back.normalize().scale(9)).addInPlaceFromFloats(0, 6, 0);
        this.dash = nd > 20;
        return;
      }
      // everyone's down: back up into the sky, the way he came
      if (this.ai !== "victory") {
        this.ai = "victory";
        this.aiT = 0;
        this.say(pick(["My work here is done. Call me if he wakes up.", "That's a wrap. Jarvis, take me home.", "Next time, invite me to the start of the party."]), 3.2);
      }
      if (this.mode === "ground" && !this.action) this.takeOff();
      this.departing = true;
      return;
    }
    const h = this.hulk;
    // a soldier in sight and nothing more pressing: a repulsor shot for him
    if (!this.action && this.mode === "fly" && this.cd.soldier <= 0 && (!h || (h.target as unknown) !== this)) {
      const s = this.soldierInSight(h ? 22 : 34);
      if (s) {
        this.cd.soldier = h ? rnd(4, 7) : rnd(1.2, 2.2);
        this.shootSoldier(s);
        return;
      }
    }
    if (!h) return this.followPlayer();
    this.wasFighting = true;
    if (this.action) return;
    if (this.mode === "ground") return this.takeOff();
    this.fight(h);
  }

  private followPlayer() {
    const me = this.host.player.feet;
    const yaw = this.host.player.yaw;
    const spot = me.add(V(Math.cos(yaw) * -3 - Math.sin(yaw) * 2, 2.8, Math.sin(yaw) * 3 - Math.cos(yaw) * 2));
    if (this.mode === "ground") return;
    this.ai = "follow";
    this.goal = spot;
    this.dash = Vector3.Distance(spot, this.p) > 14;
  }



  /**
   * The fight: one decision every quarter second. He picks what the moment calls for — playing off
   * whoever the Hulk is after — and otherwise keeps up the pressure from his firing position.
   */
  private fight(h: Foe) {
    const host = this.host;
    const chest = this.chestOf(h);
    const d = Vector3.Distance(this.center(), chest);
    const sees = host.nav.clear(this.center(), chest);
    const spidey = host.spidey();
    const onSpidey = !!spidey && (h.target as unknown) === spidey;
    const onYou = (h.target as unknown) === host.player;
    const onMe = (h.target as unknown) === this;
    const youClose = Vector3.Distance(flat(host.player.feet), flat(h.position)) < 9;
    const team = host.team;
    const opening = onSpidey || h.webbedT > 0 || h.state === "buck" || h.state === "stagger";

    // Combo C: he's on you — a shot to turn him
    if (onYou && youClose && sees && this.cd.shot <= 0 && this.cd.burst <= 0) {
      this.ai = "assist";
      team.mark("distract");
      return this.startBurst(h);
    }
    // Combo B: he's busy (on Spidey, webbed, bucking) — from above, a dive into a powered punch
    if (opening && this.cd.dive <= 0 && team.since("heavy") > 1.6 && d < 26) {
      this.ai = "dive";
      team.mark("heavy");
      return this.startDive();
    }
    // Combo A: he's turned on Spider-Man — open up from a clear angle
    if (onSpidey && sees && this.cd.burst <= 0 && d < 24) {
      this.ai = "repulsor";
      team.mark("ranged");
      return this.startBurst(h);
    }
    // the unibeam: a clear line, the right range, not when he's right on top of me
    if (this.cd.unibeam <= 0 && sees && d > 8 && d < 26 && !(onMe && d < 9) && team.since("heavy") > 1.6) {
      this.ai = "unibeam";
      team.mark("heavy");
      return this.startUnibeam();
    }
    // the charged blast
    if (this.cd.charged <= 0 && sees && d > 6 && d < 30) {
      this.ai = "charged";
      return this.startCharged();
    }
    // in close with the thrusters behind his fists — when he isn't the one being hunted
    if (this.cd.melee <= 0 && (!onMe || d < 6) && team.since("melee") > 0.8 && Math.random() < 0.85) {
      this.ai = "melee";
      team.mark("melee");
      return this.startMelee(h);
    }
    // otherwise: hold a firing position off to one side, and keep shooting
    this.ai = onMe && d < 9 ? "position" : "hover";
    this.pickSlot(h, onMe);
    this.goal = this.slot.clone();
    this.dash = Vector3.Distance(this.slot, this.p) > 10 || (onMe && d < 7);
    if (sees && this.cd.shot <= 0 && d < 30) this.startShot();
    else if (!sees) this.ai = "locate";
  }

  /** where to fight from: off the line between you and him, away from Spider-Man, in the air, in sight */
  private pickSlot(h: Foe, hunted: boolean) {
    if (this.cd.slot > 0 && !hunted && Vector3.Distance(flat(this.slot), flat(h.position)) > IRON.range[0] - 1) return;
    this.cd.slot = rnd(3.5, 6);
    const nav = this.host.nav;
    const me = this.host.player.feet;
    const fromYou = flat(h.position.subtract(me));
    if (fromYou.lengthSquared() < 1e-3) fromYou.set(1, 0, 0);
    const base = Math.atan2(fromYou.x, fromYou.z);
    const spidey = this.host.spidey();
    let best = this.slot.clone(), bestS = -Infinity;
    for (let k = 0; k < 8; k++) {
      const a = base + (this.side * (1.0 + Math.random() * 1.6)) * (k % 2 ? 1 : -1);
      const r = rnd(IRON.range[0], IRON.range[1]) + (hunted ? 4 : 0);
      const c = h.position.add(V(Math.sin(a) * r, 0, Math.cos(a) * r));
      const fy = this.floorUnder(c.add(V(0, 20, 0)));
      c.y = Math.max(fy, h.position.y) + rnd(IRON.height[0], IRON.height[1]);
      if (c.x < this.host.bounds.minX + 3 || c.x > this.host.bounds.maxX - 3 || c.z < this.host.bounds.minZ + 3 || c.z > this.host.bounds.maxZ - 3) continue;
      if (nav.embedded(c.x, c.y, c.z) || nav.embedded(c.x, c.y + 1, c.z)) continue;
      let s = 0;
      if (nav.clear(c, this.chestOf(h))) s += 10;
      if (spidey) s += Math.min(8, Vector3.Distance(flat(c), flat(spidey.feet))) * 0.4;
      s -= Vector3.Distance(c, this.p) * 0.15;
      if (s > bestS) (bestS = s), (best = c);
    }
    this.slot.copyFrom(best);
    if (Math.random() < 0.3) this.side = -this.side;
  }

  // ------------------------------------------------------------------ attacks
  private startShot() {
    this.cd.shot = rnd(0.8, 1.3);
    this.side = -this.side;
    this.action = { kind: "shot", t: 0, dur: 0.45, hand: this.side > 0 ? "r" : "l", shots: 0 };
  }
  private startBurst(h: Foe) {
    this.cd.burst = rnd(2.5, 3.8);
    this.cd.shot = 1.2;
    void h;
    this.action = { kind: "burst", t: 0, dur: 0.95, shots: 0, hand: "r" };
  }
  private startCharged() {
    this.cd.charged = rnd(9, 12);
    this.cd.shot = 1.5;
    this.action = { kind: "charged", t: 0, dur: 1.35, shots: 0, hand: "r" };
    this.host.audio.play("repulsorCharge", { x: this.p.x, y: this.p.y + 1.4, z: this.p.z, volume: 0.75 });
  }
  private startUnibeam() {
    this.cd.unibeam = rnd(22, 28);
    this.cd.shot = 2.5;
    this.action = { kind: "unibeam", t: 0, dur: 3.0, shots: 0 };
    this.goal = null;
    this.host.audio.play("repulsorCharge", { x: this.p.x, y: this.p.y + 1.3, z: this.p.z, volume: 0.9, rate: 0.75 });
    if (this.cd.quip <= 0) this.say(pick(["Unibeam. Stand back.", "Let's light him up.", "Charging — everybody clear!"]), 2);
  }
  private startDive() {
    this.cd.dive = rnd(7, 10);
    this.action = { kind: "dive", t: 0, dur: 4, phase: 0 };
    this.host.audio.play("servo", { x: this.p.x, y: this.p.y + 1.4, z: this.p.z, volume: 0.5 });
  }
  private startMelee(h: Foe) {
    this.cd.melee = rnd(2.8, 4.5);
    void h;
    this.action = { kind: "melee", t: 0, dur: 4, phase: 0, hitsDone: 0, clip: "hook" };
  }

  private act(dt: number) {
    const a = this.action;
    if (!a) return;
    a.t += dt;
    const h = this.hulk;
    switch (a.kind) {
      case "shot":
        if (h) this.faceTo(h.position, dt);
        if (a.shots === 0 && a.t >= 0.2 && h) {
          a.shots = 1;
          this.fire(h, a.hand!, 8, 0.4, false);
        }
        break;
      case "burst":
        if (h) this.faceTo(h.position, dt);
        // three quick shots, alternating hands
        while (h && a.shots! < 3 && a.t >= 0.2 + a.shots! * 0.2) {
          const hand = a.shots! % 2 ? "l" : "r";
          a.hand = hand;
          this.fire(h, hand, 7, 0.6, false);
          a.shots!++;
        }
        break;
      case "charged":
        if (h) this.faceTo(h.position, dt);
        this.goal = null;
        this.charge = Math.min(1, a.t / 0.9);
        if (a.shots === 0 && a.t >= 0.9 && h) {
          a.shots = 1;
          this.charge = 0;
          this.fire(h, "r", 28, 2.4, true);
          this.host.player.shake(0.08);
        }
        break;
      case "unibeam":
        this.unibeamFrame(a, dt, h);
        break;
      case "dive":
        this.diveFrame(a, dt, h);
        break;
      case "melee":
        this.meleeFrame(a, dt, h);
        break;
      case "dodge":
        this.roll *= 0.92;
        break;
      case "brace":
        if (h) this.faceTo(h.position, dt);
        break;
      case "land":
      case "getup":
        break;
      case "victory":
        break;
    }
    if (a && this.action === a && a.t >= a.dur) {
      this.action = null;
      if (a.kind === "unibeam") this.endBeam();
      this.charge = 0;
      this.chestCharge = 0;
    }
  }

  /** the unibeam: settle, face him, charge the chest (it glows — the warning), then the beam */
  private unibeamFrame(a: Action, dt: number, h: Foe | null) {
    this.goal = null;
    this.v.scaleInPlace(Math.exp(-4 * dt));
    if (!h) {
      a.t = a.dur;
      return;
    }
    this.faceTo(h.position, dt, 4);
    if (a.t < 1.2) {
      this.chestCharge = a.t / 1.2;
      return;
    }
    if (a.shots === 0) {
      a.shots = 1;
      this.host.audio.play("unibeam", { x: this.p.x, y: this.p.y + 1.3, z: this.p.z, volume: 1 });
    }
    this.chestCharge = 1;
    const from = this.rig.at("Spine2").add(this.fwd().scale(0.25));
    // the beam tracks him, a little behind
    const want = this.chestOf(h);
    this.beamAim = this.beamAim ? Vector3.Lerp(this.beamAim, want, 1 - Math.exp(-6 * dt)) : want.clone();
    const dir = this.beamAim.subtract(from).normalize();
    let end = from.add(dir.scale(40));
    let hitHulk = false;
    const lvl = this.host.nav.moveHit(from, end, 1);
    if (lvl) end = lvl.point;
    // does it pass through him?
    const toC = want.subtract(from);
    const along = Vector3.Dot(toC, dir);
    if (along > 0 && along < Vector3.Distance(from, end) + 0.5 && toC.subtract(dir.scale(along)).length() < 1.1 * h.size) {
      end = from.add(dir.scale(along - 0.6 * h.size));
      hitHulk = true;
    }
    this.drawBeam(from, end);
    this.beamTick -= dt;
    if (this.beamTick <= 0) {
      this.beamTick = 0.1;
      this.host.energy(end, 0.5);
      if (hitHulk) h.applyHit(4, "torso", dir, end, { kind: "blast", force: a.t > 2.6 ? 2.5 : 1, source: this });
    }
    this.host.player.shake(0.02);
    if (a.t >= 2.75) this.endBeam();
  }
  private beamAim: Vector3 | null = null;
  private beamTick = 0;
  private drawBeam(from: Vector3, to: Vector3) {
    const d = to.subtract(from);
    const L = d.length();
    const mid = from.add(d.scale(0.5));
    fromY(d.scale(1 / Math.max(1e-4, L)), this.fq);
    const flick = 1 + Math.sin(performance.now() / 25) * 0.08;
    for (const [m, w] of [[this.beam.outer, 1.0 * flick], [this.beam.inner, 1]] as const) {
      m.setEnabled(true);
      m.position.copyFrom(mid);
      m.rotationQuaternion!.copyFrom(this.fq);
      m.scaling.set(w, L, w);
    }
  }
  private endBeam() {
    this.beam.outer.setEnabled(false);
    this.beam.inner.setEnabled(false);
    this.beamAim = null;
    this.chestCharge = 0;
  }

  /** the dive: up above him, then down onto him fist first — checked against where he really is */
  private diveFrame(a: Action, dt: number, h: Foe | null) {
    if (!h) {
      a.t = a.dur;
      return;
    }
    const chest = this.chestOf(h);
    if (a.phase === 0) {
      // rise above him, a little behind (from where he isn't looking)
      const back = V(-Math.sin(h.heading), 0, -Math.cos(h.heading));
      this.goal = h.position.add(back.scale(4)).addInPlaceFromFloats(0, 9, 0);
      this.dash = true;
      if (Vector3.Distance(this.p, this.goal) < 2.5 || a.t > 2) {
        a.phase = 1;
        a.t = 0;
        this.goal = null;
        this.host.audio.play("rocketWhoosh", { x: this.p.x, y: this.p.y, z: this.p.z, volume: 0.6, rate: 1.4 });
      }
      return;
    }
    if (a.phase === 1) {
      // straight down at him, faster and faster
      const dir = chest.subtract(this.center()).normalize();
      this.v.copyFrom(Vector3.Lerp(this.v, dir.scale(28), 1 - Math.exp(-8 * dt)));
      this.diving = true;
      if (Vector3.Distance(this.center(), chest) < 1.9 * h.size) {
        this.diving = false;
        h.applyHit(34, "torso", dir, chest, { kind: "melee", force: 2.4, source: this });
        this.host.energy(chest.subtract(dir.scale(0.6)), 1.2);
        this.host.audio.play("ironClank", { x: chest.x, y: chest.y, z: chest.z, volume: 1, rate: 0.7 });
        this.host.audio.play("hulkPunch", { x: chest.x, y: chest.y, z: chest.z, volume: 0.8, rate: 1.2 });
        this.host.player.shake(0.25);
        // off him, back up into the air
        this.v.copyFrom(flat(dir).scale(-9)).addInPlaceFromFloats(0, 10, 0);
        a.phase = 2;
        a.t = 0;
        a.dur = 0.7;
      } else if (a.t > 1.6 || (this.p.y - this.floorUnder(this.p) < 0.8 && a.t > 0.3)) {
        // missed (he moved): pull up
        this.diving = false;
        this.v.y = Math.max(this.v.y, 8);
        a.phase = 2;
        a.t = 0;
        a.dur = 0.6;
      }
    }
  }
  private diving = false;

  /** in close: fly to arm's length, two thruster-driven punches, then out */
  private meleeFrame(a: Action, dt: number, h: Foe | null) {
    if (!h) {
      a.t = a.dur;
      return;
    }
    const chest = this.chestOf(h);
    const fromHim = flat(this.p.subtract(h.position));
    if (fromHim.lengthSquared() < 1e-3) fromHim.set(1, 0, 0);
    fromHim.normalize();
    if (a.phase === 0) {
      this.goal = h.position.add(fromHim.scale(1.9 * h.size)).addInPlaceFromFloats(0, 0.9 * h.size, 0);
      this.dash = true;
      this.faceTo(h.position, dt, 8);
      if (Vector3.Distance(this.p, this.goal) < 0.9 || a.t > 2.2) {
        a.phase = 1;
        a.t = 0;
        a.clip = Math.random() < 0.5 ? "hook" : "punch";
        a.dur = clipDur(this.clips[a.clip]) / 1.4;
        a.hits = [a.clip === "hook" ? 0.29 : 0.39];
        a.hitsDone = 0;
      }
      if (a.t > 2.2 && a.phase === 0) a.t = a.dur;
      return;
    }
    // the punch: the thrusters kick him into it at the moment it lands
    this.goal = h.position.add(fromHim.scale(1.9 * h.size)).addInPlaceFromFloats(0, 0.9 * h.size, 0);
    this.dash = false;
    this.faceTo(h.position, dt, 10);
    const f = a.t / a.dur;
    if (a.hits && a.hitsDone! < a.hits.length && f >= a.hits[a.hitsDone!]) {
      a.hitsDone!++;
      this.v.addInPlace(fromHim.scale(-5));
      this.thrust = 1.2;
      const fist = this.rig.at("RightHand");
      // only if it really reaches him
      if (Vector3.Distance(fist, chest) < 1.6 * h.size || Vector3.Distance(this.center(), chest) < 2.4 * h.size) {
        h.applyHit(16, "torso", fromHim.scale(-1), fist, { kind: "melee", force: 1.4, source: this });
        this.host.energy(fist, 0.6);
        this.host.audio.play("ironClank", { x: fist.x, y: fist.y, z: fist.z, volume: 0.9 });
        this.host.audio.play("meleeHit", { x: fist.x, y: fist.y, z: fist.z, volume: 0.9, rate: 0.8 });
      } else this.host.audio.play("meleeSwing", { x: fist.x, y: fist.y, z: fist.z, volume: 0.6 });
    }
    if (a.t >= a.dur) {
      if (a.phase === 1 && Vector3.Distance(this.center(), chest) < 3 * h.size) {
        // still in reach: a second strike
        a.phase = 2;
        a.t = 0;
        a.clip = a.clip === "hook" ? "punch" : "hook";
        a.dur = clipDur(this.clips[a.clip]) / 1.4;
        a.hits = [a.clip === "hook" ? 0.29 : 0.39];
        a.hitsDone = 0;
      } else {
        // out and up
        this.v.addInPlace(fromHim.scale(10)).addInPlaceFromFloats(0, 7, 0);
        this.action = null;
      }
    }
  }

  private soldierInSight(range: number) {
    let best: SoldierLike | null = null, bd = range;
    for (const s of this.host.soldiers()) {
      if (!s.alive) continue;
      const d = Vector3.Distance(s.position, this.p);
      if (d < bd && this.host.nav.clear(this.center(), s.position.add(V(0, 0.4, 0)))) (bd = d), (best = s);
    }
    return best;
  }
  /**
   * At something in the sky (a gunship, a jet): a heavy repulsor bolt that homes on it. Only
   * between his own moves; returns whether he fired.
   */
  shootAir(u: SoldierLike & { hitR?: number }) {
    if (!this.alive || this.action || this.mode !== "fly") return false;
    this.shootSoldier(u);
    const b = this.bolts.find((x) => x.on && x.soldier === u);
    if (b) {
      b.damage = 70;
      b.vel.scaleInPlace(1.6);
      b.life = 3;
      b.homing = true;
      b.core.scaling.setAll(1.6);
    }
    if (Math.random() < 0.3 && this.cd.quip <= 0) this.say(pick(["Got one in the air.", "Tagging the bird.", "Air support, my favorite."]), 2);
    return true;
  }
  private shootSoldier(s: SoldierLike) {
    const b = this.bolts.find((x) => !x.on);
    if (!b) return;
    this.side = -this.side;
    const hand = this.side > 0 ? "r" : "l";
    const palm = this.palm(hand);
    const dir = s.position.add(V(0, 0.35, 0)).subtract(palm).normalize();
    this.yaw = Math.atan2(dir.x, dir.z);
    this.action = { kind: "shot", t: 0.2, dur: 0.45, hand, shots: 1 };
    b.on = true;
    b.pos.copyFrom(palm);
    b.vel.copyFrom(dir.scale(70));
    b.life = 1;
    b.damage = 90;
    b.force = 1;
    b.big = false;
    b.soldier = s;
    b.core.scaling.setAll(1);
    b.trail.scaling.set(1, 1.4, 1);
    b.core.setEnabled(true);
    b.trail.setEnabled(true);
    this.host.audio.play("repulsorFire", { x: palm.x, y: palm.y, z: palm.z, volume: 0.7 });
    this.recoil = hand === "l" ? -1 : 1;
    this.recoilT = 0.18;
  }

  /** a repulsor bolt from a palm, aimed at the Hulk's chest (leading him a touch) */
  private fire(h: Foe, hand: "l" | "r", damage: number, force: number, big: boolean) {
    const b = this.bolts.find((x) => !x.on);
    if (!b) return;
    const palm = this.palm(hand);
    const target = this.chestOf(h);
    // (it leaves the palm toward him — a palm pointing away never fires backwards)
    const dir = target.subtract(palm).normalize();
    if (Vector3.Dot(dir, this.fwd()) < -0.2) return;
    b.on = true;
    b.pos.copyFrom(palm);
    b.vel.copyFrom(dir.scale(big ? 52 : 70));
    b.life = 1.2;
    b.damage = damage;
    b.force = force;
    b.big = big;
    b.soldier = null;
    b.core.scaling.setAll(big ? 2.2 : 1);
    b.trail.scaling.set(big ? 2 : 1, big ? 2.2 : 1.4, big ? 2 : 1);
    b.core.setEnabled(true);
    b.trail.setEnabled(true);
    this.host.audio.play("repulsorFire", { x: palm.x, y: palm.y, z: palm.z, volume: big ? 1 : 0.75, rate: big ? 0.75 : 1 });
    this.host.energy(palm, big ? 0.35 : 0.12);
    this.recoil = hand === "l" ? -1 : 1;
    this.recoilT = 0.18;
  }
  private recoil = 0;
  private recoilT = 0;
  private updateBolts(dt: number) {
    const h = this.host.hulk;
    const nav = this.host.nav;
    for (const b of this.bolts) {
      if (!b.on) continue;
      b.life -= dt;
      const prev = b.pos.clone();
      b.pos.addInPlace(b.vel.scale(dt));
      b.core.position.copyFrom(b.pos);
      const dir = b.vel.normalizeToNew();
      fromY(dir.scale(-1), this.fq);
      b.trail.rotationQuaternion!.copyFrom(this.fq);
      b.trail.position.copyFrom(b.pos.subtract(dir.scale(0.6 * b.trail.scaling.y)));
      // a soldier's bolt: him (his body's line), or nothing
      if (b.soldier) {
        const s = b.soldier;
        // (homing on something in the sky: it turns after it)
        if (b.homing && s.alive) {
          const want = s.position.subtract(b.pos).normalize().scale(b.vel.length());
          b.vel.addInPlace(want.subtract(b.vel).scale(Math.min(1, dt * 6)));
        }
        const hr = (s as { hitR?: number }).hitR ?? 0.5;
        const a = s.position.add(V(0, -0.7, 0)), c = s.position.add(V(0, 0.85, 0));
        if (s.alive && segSegDist(prev, b.pos, a, c) < hr) {
          s.applyHit(b.damage, "torso", dir, closestOn(a, c, b.pos), { kind: "bullet" });
          this.host.energy(b.pos, 0.35);
          this.freeBolt(b);
          continue;
        }
      }
      // hit him? (the segment this frame against his body's line, pelvis to head)
      else if (h && h.alive) {
        const a = h.bonePos("pelvis"), c = h.bonePos("head");
        if (segSegDist(prev, b.pos, a, c) < 0.75 * h.size + (b.big ? 0.3 : 0)) {
          const point = closestOn(a, c, b.pos);
          h.applyHit(b.damage, "torso", dir, point, { kind: "blast", force: b.force, source: this });
          this.host.energy(b.pos, b.big ? 1.3 : 0.45);
          this.host.audio.play(b.big ? "rocketBlast" : "impactMetal", { x: b.pos.x, y: b.pos.y, z: b.pos.z, volume: b.big ? 0.5 : 0.35, rate: b.big ? 1.5 : 1.3 });
          this.freeBolt(b);
          continue;
        }
      }
      const hit = nav.moveHit(prev, b.pos, 1);
      if (hit) {
        this.host.energy(hit.point.add(hit.normal.scale(0.1)), b.big ? 0.8 : 0.3);
        this.freeBolt(b);
        continue;
      }
      if (b.life <= 0) this.freeBolt(b);
    }
  }
  private freeBolt(b: Bolt) {
    b.on = false;
    b.homing = false;
    b.core.setEnabled(false);
    b.trail.setEnabled(false);
  }

  // ------------------------------------------------------------------ flight
  private takeOff() {
    this.mode = "fly";
    this.v.y = Math.max(this.v.y, 5);
    this.ai = "takeoff";
    this.host.audio.play("servo", { x: this.p.x, y: this.p.y + 1, z: this.p.z, volume: 0.5 });
    if (!this.thrustLoop) this.thrustLoop = this.host.audio.playLoop("thrustLoop", { x: this.p.x, y: this.p.y, z: this.p.z, volume: 0.5 });
  }

  private move(dt: number) {
    const nav = this.host.nav;
    // (a dive cut short — a blow, a dodge — mustn't leave him coasting: steering is off only mid-dive)
    if (this.action?.kind !== "dive") this.diving = false;
    if (this.mode === "ko") {
      // down: the armour falls and lies there
      this.v.y -= G * dt;
      this.p.addInPlace(this.v.scale(dt));
      const fy = this.floorUnder(this.p.add(V(0, 0.5, 0)));
      if (this.p.y <= fy) {
        this.p.y = fy;
        this.v.setAll(0);
      }
      this.thrust = 0;
      return;
    }
    if (this.mode === "ground") {
      const fy = nav.floorAt(this.p.x, this.p.y + 0.5, this.p.z, 1);
      if (fy !== null) this.p.y = fy;
      this.v.setAll(0);
      this.thrust = Math.max(0, this.thrust - dt * 2);
      return;
    }
    const c0 = this.center();
    if (this.mode === "tumble") {
      // thrown: falling and spinning, then the thrusters catch him
      this.tumbleT += dt;
      this.v.y -= G * dt;
      this.thrust = 0.1;
      this.roll += dt * 9;
      if (this.tumbleT > 0.75) {
        this.mode = "fly";
        this.roll = 0;
        this.ai = "recover";
        this.host.audio.play("servo", { x: this.p.x, y: this.p.y + 1, z: this.p.z, volume: 0.6, rate: 0.8 });
      }
    } else {
      // thrust toward the goal: arrive, don't snap; gravity is what the boots are fighting
      const goal = this.goal ?? c0.subtract(V(0, 1, 0)).addInPlace(this.v.scale(0.3));
      const to = goal.add(V(0, 1, 0)).subtract(c0);
      const dist = to.length();
      const maxS = this.dash ? IRON.dash : IRON.cruise;
      const want = dist > 1e-3 ? to.scale(Math.min(maxS, dist * (this.dash ? 2.2 : 1.6)) / dist) : V();
      // hovering in place: a slow bob
      if (!this.goal) want.y += Math.sin(performance.now() / 600) * 0.4;
      const dv = want.subtract(this.v);
      const lim = (this.dash || this.diving ? IRON.dashAccel : IRON.accel) * dt;
      if (dv.length() > lim) dv.scaleInPlace(lim / dv.length());
      if (!this.diving) this.v.addInPlace(dv);
      this.thrust = Math.min(1.3, 0.45 + dv.length() / Math.max(1e-3, dt) / 30 + this.v.length() * 0.02);
      // look ahead: a wall coming — push off it and up over it
      const ahead = c0.add(this.v.scale(0.45)).addInPlace(this.v.normalizeToNew().scale(1.2));
      const wall = nav.moveHit(c0, ahead);
      if (wall) {
        const into = Vector3.Dot(this.v, wall.normal);
        if (into < 0) this.v.subtractInPlace(wall.normal.scale(into * 1.1));
        this.v.y += 12 * dt;
      }
    }
    // the move, and never through anything
    let c = c0.add(this.v.scale(dt));
    const hit = nav.moveHit(c0, c);
    if (hit) {
      c = hit.point.add(hit.normal.scale(0.25));
      const vn = Vector3.Dot(this.v, hit.normal);
      if (vn < 0) this.v.subtractInPlace(hit.normal.scale(vn * (this.mode === "tumble" ? 1.4 : 1)));
      if (this.diving) this.diving = false;
    }
    // altitude band and the map's edges
    const fy = this.floorUnder(c.add(V(0, 0.5, 0)));
    if (c.y - 1 < fy + (this.mode === "tumble" ? 0 : IRON.minAlt * (this.goal && this.goal.y - fy < 0.5 ? 0 : 1))) {
      if (this.mode === "tumble") {
        // a hard landing: down on a knee, then back up
        c.y = fy + 1;
        this.v.setAll(0);
        this.mode = "ground";
        this.action = { kind: "getup", t: 0, dur: 0.8 };
        this.host.audio.play("ironClank", { x: c.x, y: fy, z: c.z, volume: 0.8 });
        this.host.dust(V(c.x, fy, c.z), 0.3);
      } else {
        c.y = Math.max(c.y, fy + 1 + IRON.minAlt * 0.6);
        if (this.v.y < 0) this.v.y *= 0.3;
      }
    }
    if (c.y > IRON.maxAlt && !this.departing) {
      c.y = IRON.maxAlt;
      this.v.y = Math.min(this.v.y, 0);
    }
    const B = this.host.bounds;
    const m = 2;
    if (!this.departing && (c.x < B.minX + m || c.x > B.maxX - m || c.z < B.minZ + m || c.z > B.maxZ - m)) {
      const inward = V((B.minX + B.maxX) / 2 - c.x, 0, (B.minZ + B.maxZ) / 2 - c.z).normalize();
      this.v.addInPlace(inward.scale(25 * dt));
      c.x = Math.max(B.minX + m - 1, Math.min(B.maxX - m + 1, c.x));
      c.z = Math.max(B.minZ + m - 1, Math.min(B.maxZ - m + 1, c.z));
    }
    // (no wild speeds)
    const sp = this.v.length();
    if (sp > 30) this.v.scaleInPlace(30 / sp);
    this.p.copyFrom(c).subtractInPlace(V(0, 1, 0));
    // facing: at the Hulk while he holds a firing position, along the flight when cruising
    const hk = this.hulk;
    if (!this.action) {
      if (hk && (this.ai === "hover" || this.ai === "position" || this.ai === "assist" || this.ai === "locate" || this.ai === "recover")) this.faceTo(hk.position, dt, 4);
      else if (flat(this.v).length() > 3) this.turnTo(Math.atan2(this.v.x, this.v.z), dt, 4);
    }
    this.thrustLoop?.setPosition(this.p.x, this.p.y, this.p.z);
  }

  private faceTo(p: Vector3, dt: number, rate = 6) {
    this.turnTo(Math.atan2(p.x - this.p.x, p.z - this.p.z), dt, rate);
  }
  private turnTo(yaw: number, dt: number, rate: number) {
    const d = angDiff(yaw, this.yaw);
    this.yaw += Math.sign(d) * Math.min(Math.abs(d), rate * dt);
  }
  private fwd() {
    return V(Math.sin(this.yaw), 0, Math.cos(this.yaw));
  }
  /** a palm's position (a little out from the wrist) */
  private palm(hand: "l" | "r") {
    const w = this.rig.at(hand === "l" ? "LeftHand" : "RightHand");
    const m = this.rig.at(hand === "l" ? "LeftHandMiddle1" : "RightHandMiddle1");
    return w.add(m.subtract(w).scale(0.5));
  }

  private recovering(dt: number) {
    this.koT -= dt;
    this.thrust = 0;
    if (this.koT <= 0) {
      this.health = this.maxHealth * 0.55;
      this.mode = "ground";
      this.action = { kind: "getup", t: 0, dur: 1 };
      this.ai = "recover";
    }
  }

  // ------------------------------------------------------------------ the body
  private animate(dt: number) {
    const want = this.want;
    const a = this.action;
    let rate = 12;
    const hs = flat(this.v).length();
    const h = this.host.hulk;
    const aimAt = h ? this.chestOf(h) : this.center().add(this.fwd().scale(10));
    const intro = a?.kind === "intro" ? a.t - this.intro.dur : -99;
    // his flying clip, playing on (the hand-set FLY if the model has none)
    this.flyT += dt * (0.8 + Math.min(1, hs / 14) * 0.5);
    const fly = this.flyClip ? sample(this.flyClip, this.flyT, true, this.flyPose) : FLY;
    // (the clip reaches one arm out ahead: both go back along his sides, the right mirroring the left)
    if (this.flyClip) for (const k of [0, 1, 2]) fly.d[9 + k] = [-fly.d[6 + k][0], fly.d[6 + k][1], fly.d[6 + k][2]];
    if (a?.kind === "intro" && intro < 0) {
      copyPose(fly, want);
    } else if (a?.kind === "intro" && intro < 0.75) {
      copyPose(HOVER, want);
      rate = 10;
    } else if (a?.kind === "intro") {
      const t = intro - 0.75;
      // the landing: down on one knee, fist to the ground… up… a palm raised at the Hulk
      if (t < 0.9) copyPose(LANDING, want);
      else mixPose(LANDING, STANCE, Math.min(1, (t - 0.9) / 0.6), want);
      if (t > 1.5) this.palmAt(want, "r", aimAt, Math.min(1, (t - 1.5) / 0.4));
      rate = t < 0.2 ? 30 : 9;
    } else if (this.mode === "ko") {
      sample(this.clips.deathB, clipDur(this.clips.deathB), false, want);
      rate = 8;
    } else if (a?.kind === "getup" || a?.kind === "land") {
      mixPose(LANDING, STANCE, Math.min(1, a.t / a.dur), want);
      rate = 12;
    } else if (this.mode === "tumble") {
      mixPose(HIT, TUCK, Math.min(1, this.tumbleT * 2), want);
      rate = 14;
    } else if (a?.kind === "brace") {
      copyPose(BRACE, want);
      rate = 26;
    } else if (a?.kind === "unibeam") {
      copyPose(UNIBEAM, want);
      rate = 10;
    } else if (a?.kind === "dive" && a.phase === 1) {
      copyPose(DIVE, want);
      rate = 14;
    } else if (a?.kind === "melee" && a.phase! >= 1 && a.clip) {
      sample(this.clips[a.clip], a.t * 1.4, false, want);
      // legs hang in the hover while he punches
      for (const k of [12, 13, 14, 15, 16, 17]) want.d[k] = HOVER.d[k];
      rate = 26;
    } else if (this.mode === "ground") {
      if (this.ai === "victory" || !h) copyPose(RELAXED, want);
      else copyPose(STANCE, want);
    } else {
      // flying: hover ↔ flight by speed (the body's pitch comes from his orientation)
      const k = Math.min(1, Math.max(0, (hs - 3) / 9));
      mixPose(HOVER, fly, k, want);
      if (a?.kind === "shot" || a?.kind === "burst" || a?.kind === "charged") {
        const hand = a.hand ?? "r";
        this.palmAt(want, hand, aimAt, 1);
        if (a.kind === "charged") this.palmAt(want, hand === "r" ? "l" : "r", aimAt, 1);
        rate = 22;
      }
    }
    // a shot's kick: the arm snaps back a little
    if (this.recoilT > 0) {
      this.recoilT -= dt;
      const k = this.recoil > 0 ? 9 : 6;
      const d = want.d[k];
      want.d[k] = [d[0], d[1] + 0.3, d[2] - 0.25];
    }
    follow(this.shown, want, rate, dt);
    if (!this.shown.d.every((d) => isFinite(d[0] + d[1] + d[2]))) copyPose(HOVER, this.shown);
    // fists to punch (and to brace, and in the dive); open palms for the repulsors and to fly
    const fist = a?.kind === "melee" || a?.kind === "brace" || (a?.kind === "dive" && a.phase === 1) || a?.kind === "unibeam";
    this.gripK += ((fist ? 1 : 0.12) - this.gripK) * (1 - Math.exp(-14 * dt));

    // orientation: upright — pitched into the flight with speed, banked by turns; the dive head first
    const up = V(0, 1, 0);
    const fwd = this.fwd();
    let pitch = 0;
    if (this.mode === "fly" && !(a?.kind === "unibeam" || a?.kind === "shot" || a?.kind === "burst" || a?.kind === "charged" || a?.kind === "melee" || a?.kind === "brace")) {
      const along = Vector3.Dot(flat(this.v), fwd);
      // (his flying clip already lays him out flat: just a lean with the speed on top of it)
      pitch = this.flyClip ? Math.max(-0.2, Math.min(0.3, along / 40)) : Math.max(-0.3, Math.min(1.25, along / 14));
    } else if (a?.kind === "intro" && intro < 0) pitch = this.flyClip ? 0.25 : 1.1;
    // nose down into a descent, up into a climb (only once he's really flying, not hovering)
    if (this.flyClip && (this.mode === "fly" || (a?.kind === "intro" && intro < 0)) && hs > 4) pitch += Math.atan2(-this.v.y, hs) * Math.min(1, hs / 12) * 0.85;
    else if (this.mode === "fly") pitch = 0.12;
    this.pitch += (pitch - this.pitch) * (1 - Math.exp(-5 * dt));
    if (a?.kind === "dive" && a.phase === 1) {
      const dir = this.v.normalizeToNew();
      up.copyFrom(dir);
      fwd.copyFrom(flat(dir).lengthSquared() > 1e-3 ? flat(dir).normalize().scale(-1) : V(0, 0, 1));
      fwd.subtractInPlace(up.scale(Vector3.Dot(fwd, up)));
      if (fwd.lengthSquared() < 1e-4) fwd.copyFrom(Vector3.Cross(up, V(1, 0, 0)));
      fwd.normalize();
      this.pitch = 0;
    }
    lookRotation(fwd, up, this.q);
    const rollTarget = this.mode === "tumble" ? this.roll : this.roll;
    this.q.multiplyInPlace(Quaternion.RotationYawPitchRoll(0, this.pitch, this.mode === "tumble" ? rollTarget : this.roll * 0.6));
    if (this.mode !== "tumble") this.roll *= Math.exp(-3 * dt);
    if (!isFinite(this.q.x + this.q.y + this.q.z + this.q.w)) this.q.set(0, 0, 0, 1);
    const anc = this.rig.anchor;
    anc.rotationQuaternion!.copyFrom(this.q);
    // he turns about his middle in the air
    if (this.mode === "fly" || this.mode === "tumble" || (a?.kind === "intro" && intro < 0.75)) {
      const mid = V(0, this.rig.hipH, 0).applyRotationQuaternion(this.q);
      anc.position.copyFrom(this.p).addInPlace(V(0, this.rig.hipH, 0)).subtractInPlace(mid);
    } else anc.position.copyFrom(this.p);
    const hip = this.shown.hip;
    this.rig.pose(this.shown.d, V(hip[0] * this.rig.hipH, hip[1] * this.rig.hipH, hip[2] * this.rig.hipH));
    this.rig.grip?.("l", this.gripK);
    this.rig.grip?.("r", this.gripK);
  }
  private gripK = 0.1;
  /** an arm up at a point, the hand bent back so the palm (the repulsor) faces it */
  private palmAt(p: Pose, hand: "l" | "r", at: Vector3, w: number) {
    const shoulder = this.rig.at(hand === "l" ? "LeftArm" : "RightArm");
    const d = this.toBody(at.subtract(shoulder));
    const tmp = copyPose(p, this.tmp);
    aimArm(tmp, hand, d);
    // fingers up (perpendicular to the arm, toward his up): the palm faces down the arm's line
    const up: Dir = [0, 1, 0];
    const dot = d[0] * up[0] + d[1] * up[1] + d[2] * up[2];
    let f: Dir = [up[0] - d[0] * dot, up[1] - d[1] * dot, up[2] - d[2] * dot];
    const l = Math.hypot(f[0], f[1], f[2]) || 1;
    f = [f[0] / l * 0.95 + d[0] * 0.3, f[1] / l * 0.95 + d[1] * 0.3, f[2] / l * 0.95 + d[2] * 0.3];
    tmp.d[hand === "l" ? 8 : 11] = f;
    mixPose(p, tmp, w, p, hand === "l" ? [6, 7, 8] : [9, 10, 11]);
  }
  private toBody(w: Vector3): Dir {
    const b = w.normalizeToNew().applyRotationQuaternion(Quaternion.Inverse(this.q));
    return [b.x, b.y, b.z];
  }

  // ------------------------------------------------------------------ thrusters, glows, light, sound
  private effects(dt: number) {
    const flying = (this.mode === "fly" || this.mode === "tumble" || (this.action?.kind === "intro" && this.action.t < this.intro.dur + 0.75)) && this.enabled;
    const k = flying ? this.thrust : Math.max(0, this.thrust);
    const flick = () => 0.85 + Math.random() * 0.3;
    // boots: from the sole, along the shin, down and back
    const nozzles: [Vector3, Vector3, number][] = [];
    for (const s of ["Left", "Right"]) {
      const foot = this.rig.at(s + "Foot"), toe = this.rig.at(s + "ToeBase"), knee = this.rig.at(s + "Leg");
      const dir = foot.subtract(knee).normalize();
      nozzles.push([foot.add(toe).scale(0.5).add(dir.scale(0.06)), dir, 1]);
    }
    // palms: pushing down/back (they steer); off while that hand's aiming
    const aiming = this.action && (this.action.kind === "shot" || this.action.kind === "burst" || this.action.kind === "charged");
    for (const s of ["l", "r"] as const) {
      const w = this.rig.at(s === "l" ? "LeftHand" : "RightHand"), m = this.rig.at(s === "l" ? "LeftHandMiddle1" : "RightHandMiddle1");
      const along = m.subtract(w).normalize();
      // the palm faces opposite the back of the hand: roughly down the body when hovering
      const bodyDown = V(0, -1, 0).applyRotationQuaternion(this.q);
      const dir = bodyDown.subtract(along.scale(Vector3.Dot(bodyDown, along))).normalize();
      const off = aiming && (this.action!.hand === s || this.action!.kind === "charged");
      nozzles.push([w.add(m).scale(0.5).add(dir.scale(0.03)), dir, off ? 0 : 0.55]);
    }
    nozzles.forEach(([at, dir, scale], i) => {
      const f = this.flames[i];
      const len = k * scale * (i < 2 ? 0.8 : 0.42) * flick();
      const on = flying && len > 0.05;
      f.outer.setEnabled(on);
      f.inner.setEnabled(on);
      if (!on) return;
      // the flare on the nozzle and the plume of fire behind it
      this.plume.nozzle(i, at, dir, k * scale, this.v, dt, i < 2);
      fromY(dir, this.fq);
      for (const [m, w] of [[f.outer, 1], [f.inner, 0.8]] as const) {
        m.position.copyFrom(at);
        m.rotationQuaternion!.copyFrom(this.fq);
        m.scaling.set(w * (0.7 + k * 0.4), len * (m === f.inner ? 0.6 : 1), w * (0.7 + k * 0.4));
      }
    });
    this.plume.update(dt);
    // palm glow while charging / aiming; the chest while the unibeam charges
    const a = this.action;
    for (const [i, s] of (["l", "r"] as const).entries()) {
      const g = this.palmGlow[i];
      const lit = a?.kind === "charged" ? this.charge : a?.kind === "intro" && s === "r" ? this.charge : a?.hand === s && (a?.kind === "shot" || a?.kind === "burst") ? 0.45 : 0;
      g.setEnabled(lit > 0.02);
      if (lit > 0.02) {
        g.position.copyFrom(this.palm(s));
        g.scaling.setAll(0.3 + lit * 0.65 * (0.9 + Math.random() * 0.2));
      }
    }
    this.chestGlow.setEnabled(this.chestCharge > 0.02);
    if (this.chestCharge > 0.02) {
      this.chestGlow.position.copyFrom(this.rig.at("Spine2").add(this.fwd().scale(0.2)));
      this.chestGlow.scaling.setAll(0.5 + this.chestCharge * 1.6 * (0.9 + Math.random() * 0.2));
    }
    // one light: warm with the thrusters, blue-white with the beam
    this.light.position.copyFrom(this.center());
    const beamOn = this.beam.outer.isEnabled();
    this.light.diffuse = beamOn || this.chestCharge > 0.3 ? new Color3(0.55, 0.8, 1) : new Color3(1, 0.6, 0.3);
    this.light.intensity = beamOn ? 2.4 : (flying ? k * 1.4 : 0) + this.chestCharge * 1.2 + this.charge * 0.8;
    // the roar follows the thrust
    if (this.thrustLoop) {
      this.thrustLoop.setVolume(flying ? 0.25 + k * 0.6 : 0.0);
      this.thrustLoop.setRate(0.8 + k * 0.35);
    }
  }

  /** a restart */
  reset() {
    for (const b of this.bolts) if (b.on) this.freeBolt(b);
    this.hide();
    this.cd = { shot: 1, burst: 3, charged: 6, unibeam: 14, dive: 8, melee: 6, dodge: 0, slot: 0, quip: 10, takeoff: 0, soldier: 4 };
    this.wasFighting = false;
    this.action = null;
    this.mode = "fly";
    this.departing = false;
    this.departT = 0;
  }
}

/** distance between segments pq and ab */
function segSegDist(p: Vector3, q: Vector3, a: Vector3, b: Vector3) {
  // sample the moving point's segment (short: one frame of travel)
  let best = Infinity;
  for (let i = 0; i <= 4; i++) {
    const x = Vector3.Lerp(p, q, i / 4);
    best = Math.min(best, Vector3.Distance(x, closestOn(a, b, x)));
  }
  return best;
}
function closestOn(a: Vector3, b: Vector3, p: Vector3) {
  const ab = b.subtract(a);
  const t = Math.max(0, Math.min(1, Vector3.Dot(p.subtract(a), ab) / Math.max(1e-8, ab.lengthSquared())));
  return a.add(ab.scale(t));
}
