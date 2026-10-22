import { Color3 } from "@babylonjs/core/Maths/math.color";
import { FreeCamera } from "@babylonjs/core/Cameras/freeCamera";
import { Quaternion, Vector3 } from "@babylonjs/core/Maths/math.vector";
import { Scene } from "@babylonjs/core/scene";
import { StandardMaterial } from "@babylonjs/core/Materials/standardMaterial";
import { TrailMesh } from "@babylonjs/core/Meshes/trailMesh";
import { TransformNode } from "@babylonjs/core/Meshes/transformNode";
import { AudioEngine } from "../audio/AudioEngine";
import { alignDir, worldPos } from "../core/ik";
import { lookRotation } from "../core/math";
import type { Combatant, Foe } from "../enemies/Hulk";
import type { AirUnit } from "../enemies/Air";
import { BeamFx, IceFx, ShockRing, SpriteStream } from "../fx/SuperFx";
import { NavGraph } from "../level/NavGraph";
import { SkinnedModel, SkinnedRig, type RigNames } from "./HeroRig";
import type { Dir } from "./SpiderRig";
import { HIT, aimArm, clipDur, copyPose, follow, loadSpiderClips, mixPose, newPose, pose, type ClipName, type DirClip } from "./SpiderPoses";
import type { SoldierLike } from "./SpiderMan";
import type { TeamBoard } from "./Team";
import supermanUrl from "../assets/characters/superman.glb?url";

/**
 * SUPERMAN — the last to arrive, on your side ("Superman (Textured) (Rigged)" by CAPTAAINR,
 * CC BY 4.0: a rig of his own with cape bones and effect sockets at the eyes, renamed to Mixamo's by
 * prep-heroes3.mjs). He comes in once Batman has joined the Hulk's side.
 *
 * The entrance: a sonic boom high overhead, a white streak down out of the sky, and a landing that
 * cracks the ground and shakes your view — he rises out of the crouch, hands on his hips, the cape
 * moving, says his line, and goes straight up into the fight.
 *
 * His powers, each with its own moment:
 *  - flight: fast, banked, body flat along the line of flight, one fist forward; past ~24 m/s the
 *    air breaks — a shock ring, a boom, a vapour cone, and a contrail behind him;
 *  - the power punch: in at speed and through — a soldier is killed outright and flies (the body
 *    leaves at 25 m/s); Wolverine and Batman are thrown far and come down hard; even the Hulk is
 *    driven back across the ground;
 *  - heat vision: two red beams from his eyes, held on the target, burning;
 *  - freeze breath: a cone of frost; whoever's caught in it on the other side freezes solid in a
 *    shell of ice. Soldiers don't come out of it (the ice shatters, and them with it); Wolverine and
 *    Batman work free after a few seconds; the Hulk just breaks it.
 *
 * His cape is simulated: three strands of five bones each (the model's own cape bones) hang from
 * his shoulders as chains of points under gravity, pushed back by the air of his own motion,
 * fluttering, tied to each other across and kept off his back — and the bones follow the points, so
 * it streams flat behind him in flight, swings as he turns and falls round him when he stands.
 */

export interface SupermanHost {
  scene: Scene;
  nav: NavGraph;
  audio: AudioEngine;
  player: { feet: Vector3; alive: boolean; yaw: number; camera: FreeCamera; shake(a: number): void };
  /** the foe he takes on (the Hulk, Wolverine, Batman), or null */
  foe: () => Foe | null;
  /** every foe that's up (for the freeze breath's cone) */
  foes: () => Foe[];
  soldiers: () => (SoldierLike & { freeze?(s: number): boolean; readonly frozen?: boolean })[];
  team: TeamBoard;
  ice: IceFx;
  bounds: { minX: number; maxX: number; minZ: number; maxZ: number };
  dust: (pos: Vector3, power: number) => void;
  /** a landing's crater and debris */
  slam: (pos: Vector3, power: number) => void;
  scorch: (pos: Vector3) => void;
  /** the gunships and jets up there */
  air?: () => AirUnit[];
}

type Mode = "intro" | "fly" | "ground" | "tumble";
export type SupermanState = "intro" | "follow" | "hover" | "punch" | "heat" | "freeze" | "dash" | "carry" | "air" | "jet" | "recover" | "victory" | "land";

interface Action {
  kind: "punch" | "heat" | "freeze" | "carry" | "air" | "jet" | "land" | "victory";
  t: number;
  dur: number;
  phase: number;
  target: Foe | SoldierLike | AirUnit | null;
  /** the carry: how high he takes them, the blows landed up there */
  top?: number;
  blows?: number;
  hit?: boolean;
}

const G = 20;
const SM = {
  health: 2400,
  cruise: 16,
  dash: 38,
  accel: 26,
  dashAccel: 60,
  minAlt: 1.6,
  maxAlt: 30,
};
const LINES = {
  intro: ["Looks like you could use a hand."],
  hulk: ["Easy, big guy.", "Let's calm down."],
  batman: ["Bruce. Stand down.", "This isn't you, Bruce."],
  wolverine: ["It's over, Logan.", "Stay down, Logan."],
  victory: ["Everyone's safe. That's what matters.", "Good work. All of you."],
};

const V = (x = 0, y = 0, z = 0) => new Vector3(x, y, z);
const flat = (v: Vector3) => new Vector3(v.x, 0, v.z);
const rnd = (a: number, b: number) => a + Math.random() * (b - a);
const pick = <T,>(a: T[]) => a[Math.floor(Math.random() * a.length)];
const norm = (d: Dir): Dir => {
  const l = Math.hypot(d[0], d[1], d[2]) || 1;
  return [d[0] / l, d[1] / l, d[2] / l];
};

// ------------------------------------------------------------------ his poses (body frame)
/** flying (his body turned along the flight, so "up" is forward): the right fist out ahead, the left along his side, legs together */
const FLY = pose(
  {
    hips: [0, 1, 0], spine: [0, 1, 0.02], spine1: [0, 1, 0.03], spine2: [0, 1, 0.03], neck: [0, 0.75, 0.66], head: [0, 0.5, 0.86],
    rArm: [0.12, 0.98, 0.1], rFore: [0.05, 1, 0.05], rHand: [0, 1, 0.08],
    lArm: [-0.2, -0.97, -0.12], lFore: [-0.12, -0.98, -0.12], lHand: [-0.1, -0.9, -0.3],
    lThigh: [-0.04, -1, -0.03], lShin: [-0.02, -1, -0.06], lFoot: [0, -0.6, -0.8],
    rThigh: [0.04, -1, -0.03], rShin: [0.02, -1, -0.08], rFoot: [0, -0.6, -0.8],
  },
  [0, 1, 0],
);
/** hovering: upright, legs together and just bent, arms loose and a little out */
const HOVER = pose(
  {
    hips: [0, 1, 0], spine: [0, 1, 0.02], spine1: [0, 1, 0.02], spine2: [0, 1, 0], neck: [0, 1, 0.04], head: [0, 1, 0.06],
    lArm: [-0.3, -0.95, 0.05], lFore: [-0.2, -0.96, 0.15], lHand: [-0.15, -0.95, 0.2],
    lThigh: [-0.04, -1, 0.1], lShin: [0, -1, -0.15], lFoot: [0, -0.8, 0.55],
    rThigh: [0.05, -1, 0.04], rShin: [0, -1, -0.22], rFoot: [0, -0.8, 0.55],
  },
  [0, 1, 0],
);
/** the punch, landing: the right fist driven straight out, the left drawn back, shoulders behind it */
const PUNCH = pose(
  {
    hips: [0, 1, 0.1], spine: [0.05, 1, 0.15], spine1: [0.1, 1, 0.18], spine2: [0.12, 1, 0.15], neck: [0, 1, 0.15], head: [0, 0.98, 0.2],
    rArm: [0.15, 0.05, 0.99], rFore: [0.05, 0.05, 1], rHand: [0, 0.05, 1],
    lArm: [-0.5, -0.6, -0.6], lFore: [0.3, 0.5, 0.8], lHand: [0.2, 0.3, 0.93],
    lThigh: [-0.15, -0.9, 0.4], lShin: [0, -0.95, -0.3], rThigh: [0.15, -0.95, -0.25], rShin: [0.05, -0.85, -0.5],
  },
  [0, 1, 0],
);
/** the wind-up: the right fist drawn right back */
const PUNCH_WIND = pose(
  {
    hips: [0, 1, 0.05], spine: [-0.05, 1, 0.05], spine1: [-0.1, 1, 0.05], spine2: [-0.12, 1, 0.05], neck: [0, 1, 0.1], head: [0, 0.98, 0.2],
    rArm: [0.55, -0.4, -0.73], rFore: [-0.2, 0.6, 0.77], rHand: [-0.1, 0.4, 0.9],
    lArm: [-0.3, -0.2, 0.93], lFore: [-0.05, 0.1, 1], lHand: [0, 0.1, 1],
    lThigh: [-0.15, -0.95, 0.25], lShin: [0, -0.95, -0.3], rThigh: [0.15, -0.95, -0.25], rShin: [0.05, -0.85, -0.5],
  },
  [0, 1, 0],
);
/** his landing: no crouch — he comes down upright, the knees just giving, arms a little out, the cape settling */
const TOUCHDOWN = pose(
  {
    hips: [0, 1, 0.02], spine: [0, 1, 0.04], spine1: [0, 1, 0.04], spine2: [0, 1, 0.02], neck: [0, 1, 0.05], head: [0, 0.99, 0.1],
    lArm: [-0.42, -0.9, 0.06], lFore: [-0.3, -0.94, 0.15], lHand: [-0.25, -0.94, 0.2],
    lThigh: [-0.14, -0.97, 0.18], lShin: [-0.05, -0.98, -0.18], lFoot: [-0.12, -0.42, 0.9],
    rThigh: [0.14, -0.97, 0.12], rShin: [0.05, -0.98, -0.22], rFoot: [0.12, -0.42, 0.9],
  },
  [0, 0.94, 0],
);
/** hands on his hips, chest out, chin up, feet apart — the pose */
const HANDS_ON_HIPS = pose(
  {
    hips: [0, 1, 0], spine: [0, 1, -0.02], spine1: [0, 1, -0.05], spine2: [0, 1, -0.06], neck: [0, 1, 0.02], head: [0, 1, -0.02],
    lArm: [-0.72, -0.62, -0.3], lFore: [0.55, -0.62, 0.55], lHand: [0.5, -0.8, 0.3],
    rArm: [0.72, -0.62, -0.3], rFore: [-0.55, -0.62, 0.55], rHand: [-0.5, -0.8, 0.3],
    lThigh: [-0.16, -0.99, 0.02], lShin: [-0.06, -1, -0.02], lFoot: [-0.15, -0.45, 0.88],
    rThigh: [0.16, -0.99, 0.02], rShin: [0.06, -1, -0.02], rFoot: [0.15, -0.45, 0.88],
  },
  [0, 1, 0],
);
/** freeze breath: chest filled, leaning in, head forward, arms back */
const BREATH = pose(
  {
    hips: [0, 1, 0.05], spine: [0, 1, 0.15], spine1: [0, 1, 0.2], spine2: [0, 1, 0.22], neck: [0, 0.9, 0.42], head: [0, 0.8, 0.6],
    lArm: [-0.45, -0.85, -0.25], lFore: [-0.35, -0.9, -0.2], lHand: [-0.3, -0.9, -0.2],
    lThigh: [-0.05, -1, 0.1], lShin: [0, -1, -0.15],
    rThigh: [0.06, -1, 0.04], rShin: [0, -1, -0.2],
  },
  [0, 1, 0],
);

const SUPER_NAMES: RigNames = {};

export class SupermanModel {
  private constructor(readonly m: SkinnedModel) {}
  static async load(scene: Scene) {
    const m = await SkinnedModel.load(scene, supermanUrl, 1.9, (mat) => {
      mat.maxSimultaneousLights = 4;
      mat.environmentIntensity = 1.2;
      mat.unlit = false;
    }, SUPER_NAMES);
    return new SupermanModel(m);
  }
}

interface Strand {
  bones: TransformNode[];
  rest: Quaternion[];
  pts: Vector3[];
  prev: Vector3[];
  len: number[];
}

export class Superman implements Combatant {
  readonly rig: SkinnedRig;
  /** his centre (chest-ish); feet are 1 m below */
  readonly p = V();
  readonly v = V();
  yaw = 0;
  mode: Mode = "intro";
  ai: SupermanState = "intro";
  health = SM.health;
  readonly maxHealth = SM.health;
  private enabled = false;
  private clips!: Record<ClipName, DirClip>;
  /** (the shared mocap: loaded with him, for his landings' and tumbles' clips later) */
  get clipsReady() {
    return !!this.clips;
  }
  private action: Action | null = null;
  private goal: Vector3 | null = null;
  private dashing = false;
  private thinkT = 0;
  private cd = { punch: 1, heat: 3, freeze: 6, boom: 0, quip: 6, soldier: 0, talk: 0, carry: 8, air: 4, cine: 0 };
  private shown = newPose();
  private want = newPose();
  private q = new Quaternion();
  private bank = 0;
  private lastYaw = 0;
  private tumbleT = 0;
  private gripK = 0.9;
  private strands: Strand[] = [];
  private eyes: TransformNode[] = [];
  private beams: BeamFx;
  private vapor: SpriteStream;
  private rings: ShockRing;
  private trail!: TrailMesh;
  private trailMat: StandardMaterial;
  /** a fresh contrail from where he is now (a trail mesh keeps its history: a new one starts clean) */
  private makeTrail() {
    this.trail?.dispose();
    this.trail = new TrailMesh("smTrail", this.trailNode, this.host.scene, 0.35, 70, true);
    this.trail.material = this.trailMat;
    this.trail.isPickable = false;
    this.trail.isVisible = false;
    return this.trail;
  }
  private trailNode: TransformNode;
  private breath: SpriteStream;
  private exposure = new Map<object, number>();
  private heatLoop: ReturnType<AudioEngine["playLoop"]> | null = null;
  private frostLoop: ReturnType<AudioEngine["playLoop"]> | null = null;
  private intro = { t: 0, from: V(), land: V(), said: 0, boom: 0, dir: V() };
  private hud: HTMLDivElement;
  private hudBar: HTMLDivElement;
  private line: HTMLDivElement;
  private lineT = 0;
  private wasFighting = false;

  private constructor(private host: SupermanHost, model: SupermanModel) {
    const scene = host.scene;
    this.rig = model.m.spawn("superman") as SkinnedRig;
    this.rig.setVisible(false);
    // the cape: three strands of five bones
    for (const S of ["Left", "Mid", "Right"]) {
      const bones: TransformNode[] = [];
      for (let k = 1; k <= 5; k++) {
        const n = this.rig.node(`Cape${S}${k}`);
        if (!n) break;
        if (!n.rotationQuaternion) n.rotationQuaternion = Quaternion.FromEulerVector(n.rotation);
        bones.push(n);
      }
      if (bones.length < 3) continue;
      this.strands.push({ bones, rest: bones.map((b) => b.rotationQuaternion!.clone()), pts: [], prev: [], len: [] });
    }
    for (const n of ["VFX_Socket_Eye_L", "VFX_Socket_Eye_R"]) {
      const e = this.rig.node(n);
      if (e) this.eyes.push(e);
    }
    this.beams = new BeamFx(scene);
    this.vapor = new SpriteStream(scene, "smVapor", 160, false);
    this.breath = new SpriteStream(scene, "smBreath", 220, false);
    this.rings = new ShockRing(scene);
    // the contrail: a long white streak behind him at speed
    this.trailNode = new TransformNode("smTrailNode", scene);
    this.trailMat = new StandardMaterial("smTrailMat", scene);
    this.trailMat.disableLighting = true;
    this.trailMat.emissiveColor = new Color3(0.95, 0.96, 1);
    this.trailMat.alpha = 0.22;
    this.trailMat.backFaceCulling = false;
    this.trail = this.makeTrail();
    this.hud = document.createElement("div");
    this.hud.id = "ally-hud-sm";
    this.hud.innerHTML = `<div class="ally-name">SUPERMAN</div><div class="ally-track"><div class="ally-bar"></div></div><div class="ally-state"></div>`;
    document.getElementById("hud")?.appendChild(this.hud);
    this.hudBar = this.hud.querySelector(".ally-bar") as HTMLDivElement;
    this.hud.style.display = "none";
    this.line = document.createElement("div");
    this.line.id = "sm-line";
    document.getElementById("hud")?.appendChild(this.line);
  }
  static async create(host: SupermanHost, model: SupermanModel) {
    const s = new Superman(host, model);
    s.clips = await loadSpiderClips();
    return s;
  }
  get meshes() {
    return this.rig.meshes;
  }

  say(text: string, secs = 2.8) {
    this.line.innerHTML = `<b>SUPERMAN</b> ${text}`;
    this.line.classList.add("on");
    this.lineT = secs;
    this.cd.quip = 12 + Math.random() * 10;
  }

  // ------------------------------------------------------------------ Combatant
  get feet() {
    return this.p.subtract(V(0, 1.0, 0));
  }
  get alive() {
    return this.enabled && this.mode !== "intro";
  }
  get active() {
    return this.enabled;
  }
  get cinematic() {
    return this.enabled && (this.mode === "intro" || this.action?.kind === "jet");
  }
  cineFocus() {
    return this.p.clone();
  }
  takeDamage(amount: number, _from: Vector3) {
    if (!this.alive) return;
    // (very little gets through)
    this.health = Math.max(this.maxHealth * 0.25, this.health - amount * 0.15);
  }
  knock(vel: Vector3, up = 0) {
    if (!this.alive) return;
    this.v.copyFrom(vel).scaleInPlace(0.5);
    this.v.y += up * 0.5 + 2;
    this.mode = "tumble";
    this.tumbleT = 0;
    this.endAction();
  }
  knockDown(_s: number) {}

  // ------------------------------------------------------------------ the entrance
  /** a spot in front of you to land on (open sky over it) */
  landingSpot(player: Vector3, look: Vector3) {
    const nav = this.host.nav;
    const fwd = flat(look).normalize();
    for (const a of [0, 0.5, -0.5, 1, -1, 1.6, -1.6, 2.4, -2.4, 3.14]) {
      const d = V(fwd.x * Math.cos(a) - fwd.z * Math.sin(a), 0, fwd.x * Math.sin(a) + fwd.z * Math.cos(a));
      for (const r of [9, 7, 11]) {
        const p = player.add(d.scale(r));
        const fy = nav.floorAt(p.x, player.y + 1.5, p.z, 3);
        if (fy === null || Math.abs(fy - player.y) > 1) continue;
        if (nav.embedded(p.x, fy + 1, p.z) || !nav.clear(V(p.x, fy + 1.2, p.z), V(p.x, fy + 40, p.z))) continue;
        if (!nav.clear(player.add(V(0, 1.4, 0)), V(p.x, fy + 1.2, p.z))) continue;
        return V(p.x, fy, p.z);
      }
    }
    return null;
  }
  enter(land: Vector3) {
    this.enabled = true;
    this.mode = "intro";
    this.ai = "intro";
    this.health = this.maxHealth;
    const pl = this.host.player.feet;
    const away = flat(land.subtract(pl)).normalize();
    const side = V(away.z, 0, -away.x);
    // from high and far off to one side, down in a long streak
    this.intro = { t: 0, from: land.add(side.scale(70)).addInPlace(away.scale(40)).addInPlaceFromFloats(0, 85, 0), land: land.clone(), said: 0, boom: 0, dir: V() };
    this.intro.dir.copyFrom(land.subtract(this.intro.from).normalize());
    this.p.copyFrom(this.intro.from);
    this.v.copyFrom(this.intro.dir.scale(50));
    this.yaw = Math.atan2(-away.x, -away.z);
    copyPose(FLY, this.shown);
    this.resetCape();
    // (the contrail starts where he does)
    this.trailNode.position.copyFrom(this.p);
    this.makeTrail();
    this.rig.setVisible(true);
    this.hud.style.display = "";
    this.action = null;
  }
  skip() {
    if (this.mode !== "intro") return;
    this.p.copyFrom(this.intro.land).addInPlaceFromFloats(0, 1, 0);
    this.endIntro();
  }
  private endIntro() {
    this.mode = "fly";
    this.ai = "hover";
    this.v.set(0, 6, 0);
    this.trail.isVisible = false;
    // (he opens with his eyes and his fists; the breath comes later, once he's been at it a while)
    this.cd.punch = 2.2;
    this.cd.heat = 0.4;
    this.cd.freeze = 24;
    this.moves = 0;
  }
  /** heat-vision bursts and punches since he arrived (the freeze breath waits for a few of them) */
  private moves = 0;
  /** 6 s: the streak down (0–2.2) — the landing (2.2–3.4) — up, hands on hips, the line (3.4–4.9) — up into the sky */
  private introFrame(dt: number) {
    const I = this.intro;
    I.t += dt;
    const t = I.t;
    const au = this.host.audio;
    const pl = this.host.player.feet;
    const toYou = flat(pl.subtract(I.land)).normalize();
    if (t < 2.2) {
      const f = t / 2.2;
      const e = f * f * (3 - 2 * f) * 0.35 + f * 0.65;
      const prev = this.p.clone();
      Vector3.LerpToRef(I.from, I.land.add(V(0, 1, 0)), e, this.p);
      this.v.copyFrom(this.p.subtract(prev).scale(1 / Math.max(1e-3, dt)));
      this.trail.isVisible = true;
      if (I.boom === 0 && t > 0.15) {
        I.boom = 1;
        this.sonicBoom(this.p, I.dir, 14);
      }
    } else if (I.said === 0) {
      // the landing: the ground cracks
      I.said = 1;
      this.p.copyFrom(I.land).addInPlaceFromFloats(0, 1, 0);
      this.v.setAll(0);
      this.host.slam(I.land.clone(), 1.1);
      this.host.dust(I.land.clone(), 1.0);
      au.play("superPunch", { x: I.land.x, y: I.land.y, z: I.land.z, volume: 1.2, rate: 0.6 });
      au.play("hulkSlam", { x: I.land.x, y: I.land.y, z: I.land.z, volume: 0.8, rate: 1.2 });
      this.host.player.shake(0.6);
      this.yaw = Math.atan2(toYou.x, toYou.z);
    }
    if (t > 2.6) this.trail.isVisible = false;
    if (t > 4.0 && I.said === 1) {
      I.said = 2;
      this.say(LINES.intro[0], 2.8);
    }
    if (t > 4.9) {
      // straight up, into the fight
      const f = Math.min(1, (t - 4.9) / 1.1);
      this.p.y = I.land.y + 1 + f * f * 9;
      this.v.set(0, 18 * f, 0);
    }
    if (t >= 6) this.endIntro();
  }
  cineShot(): { pos: Vector3; target: Vector3; fov: number; cut?: boolean } | null {
    if (this.action?.kind === "jet") return this.jetShot();
    if (this.mode !== "intro") return null;
    const I = this.intro, t = I.t;
    const eye = this.host.player.camera.position;
    const toYou = flat(eye.subtract(I.land)).normalize();
    const side = V(toYou.z, 0, -toYou.x);
    if (t < 1.1) return { pos: eye.add(toYou.scale(0.5)).addInPlaceFromFloats(0, -0.2, 0), target: this.p, fov: 0.75, cut: t < 0.03 };
    if (t < 2.2) return { pos: I.land.add(side.scale(14)).addInPlace(toYou.scale(4)).addInPlaceFromFloats(0, 3, 0), target: this.p, fov: 0.9, cut: t < 1.13 };
    if (t < 3.4) return { pos: I.land.add(toYou.scale(3.4)).addInPlace(side.scale(1.4)).addInPlaceFromFloats(0, 0.35, 0), target: I.land.add(V(0, 0.8, 0)), fov: 0.8, cut: t < 2.23 };
    // the hero shot: low, in front, looking up at him — the cape moving behind
    if (t < 4.9) return { pos: I.land.add(toYou.scale(2.8)).addInPlace(side.scale(-0.6)).addInPlaceFromFloats(0, 0.4, 0), target: I.land.add(V(0, 1.45, 0)), fov: 0.82, cut: t < 3.43 };
    return { pos: eye.add(side.scale(0.5)), target: this.p, fov: 0.8, cut: t < 4.93 };
  }

  // ------------------------------------------------------------------ frame
  update(dt: number) {
    if (!this.enabled) return;
    for (const k of Object.keys(this.cd) as (keyof typeof this.cd)[]) this.cd[k] -= dt;
    if (this.lineT > 0 && (this.lineT -= dt) <= 0) this.line.classList.remove("on");
    if (this.mode === "intro") this.introFrame(dt);
    else {
      this.think(dt);
      this.act(dt);
      this.move(dt);
    }
    if (!isFinite(this.p.x + this.p.y + this.p.z + this.v.x + this.v.y + this.v.z)) {
      this.p.copyFrom(this.host.player.feet.add(V(2, 4, 2)));
      this.v.setAll(0);
      this.mode = "fly";
    }
    this.animate(dt);
    this.simCape(dt);
    this.effects(dt);
    this.health = Math.min(this.maxHealth, this.health + dt * 20);
    this.hudBar.style.width = `${(100 * this.health) / this.maxHealth}%`;
    (this.hud.querySelector(".ally-state") as HTMLDivElement).textContent = this.ai === "heat" ? "HEAT VISION" : this.ai === "freeze" ? "FREEZE BREATH" : this.dashing ? "SUPERSONIC" : "";
  }

  private chestOf(f: Foe) {
    return f.position.add(V(0, 1.7 * f.size, 0));
  }
  private soldierUp() {
    return this.host.soldiers().filter((s) => s.alive && !s.frozen);
  }
  private nearestSoldier(range = 60) {
    let best: SoldierLike | null = null, bd = range;
    for (const s of this.soldierUp()) {
      const d = Vector3.Distance(s.position, this.p);
      if (d < bd) (bd = d), (best = s);
    }
    return best;
  }

  // ------------------------------------------------------------------ deciding
  private think(dt: number) {
    if (this.mode === "tumble" || this.action) return;
    this.thinkT -= dt;
    if (this.thinkT > 0) return;
    this.thinkT = 0.25;
    // the sky: a gunship or a jet up there, now and then — he goes up after it
    const air = (this.host.air?.() ?? []).filter((u) => u.alive && Vector3.Distance(u.position, this.p) < 320);
    if (air.length && this.cd.air <= 0 && (!this.host.foe() || Math.random() < 0.55)) {
      this.cd.air = rnd(9, 14);
      air.sort((a, b) => Vector3.Distance(a.position, this.p) - Vector3.Distance(b.position, this.p));
      // (the filmed jet takedown twice a fight, no more: after that he takes jets down like the rest, off camera)
      const film = this.cd.cine <= 0 && this.jetsFilmed < 2;
      const u = air.find((x) => x.kind === "jet" && film) ?? air[0];
      if (u.kind === "jet" && film) return this.startJet(u);
      return this.start("air", u, 6);
    }
    const foe = this.host.foe();
    if (foe) {
      this.wasFighting = true;
      this.talkTo(foe);
      const chest = this.chestOf(foe);
      const d = Vector3.Distance(this.p, chest);
      const team = this.host.team;
      // the freeze breath: when it would catch him (and a few others with him)
      if (this.cd.freeze <= 0 && this.moves >= 4 && d < 14 && !(foe as unknown as { frozen?: boolean }).frozen) return this.start("freeze", foe, 2.2);
      // up into the sky with him (not the Hulk: he's too much even to carry far), a beating up there, and down
      if (this.cd.carry <= 0 && this.moves >= 2 && foe.size < 1 && !(foe as unknown as { frozen?: boolean }).frozen) {
        this.cd.carry = rnd(14, 20);
        return this.start("carry", foe, 8);
      }
      // the punch: often — he's the strongest thing here
      if (this.cd.punch <= 0 && team.since("heavy") > 0.8) {
        team.mark("heavy");
        return this.start("punch", foe, 3.5);
      }
      if (this.cd.heat <= 0 && d < 30 && this.host.nav.clear(this.p, chest)) return this.start("heat", foe, 2.0);
      // otherwise: hold close, a little above, circling, facing him
      this.ai = "hover";
      const a = performance.now() / 2600 + (this.yawOf(foe.position) > 0 ? 0 : Math.PI);
      this.goal = foe.position.add(V(Math.sin(a) * 6.5, 2.6 + 1.2 * foe.size, Math.cos(a) * 6.5));
      this.dashing = Vector3.Distance(this.p, this.goal) > 18;
      return;
    }
    // no foe up: the soldiers — one punch each, or the breath on a group
    const s = this.nearestSoldier();
    if (s) {
      if (this.cd.freeze <= 0 && this.moves >= 4 && this.soldierUp().filter((x) => Vector3.Distance(x.position, s.position) < 5).length >= 2) return this.start("freeze", s, 2.2);
      if (this.cd.heat <= 0 && Math.random() < 0.4 && this.host.nav.clear(this.p, s.position)) return this.start("heat", s, 1.4);
      if (this.cd.carry <= 0 && Math.random() < 0.35) {
        this.cd.carry = rnd(10, 15);
        return this.start("carry", s, 8);
      }
      if (this.cd.soldier <= 0) {
        this.cd.soldier = 0.6;
        return this.start("punch", s, 3);
      }
      this.goal = s.position.add(V(0, 4, 0));
      return;
    }
    // it's over: down by you, hands on his hips
    if (this.wasFighting) {
      this.wasFighting = false;
      this.say(pick(LINES.victory), 3);
    }
    const me = this.host.player.feet;
    const spot = me.add(V(Math.cos(this.host.player.yaw) * 3, 0, -Math.sin(this.host.player.yaw) * 3));
    const fy = this.host.nav.floorAt(spot.x, me.y + 1.5, spot.z, 3) ?? me.y;
    this.goal = V(spot.x, fy + 1, spot.z);
    this.dashing = Vector3.Distance(this.p, this.goal) > 18;
    this.ai = Vector3.Distance(this.p, this.goal) < 1.5 ? "victory" : "follow";
  }
  private talkTo(f: Foe) {
    if (this.cd.talk > 0 || this.cd.quip > 0) return;
    this.cd.talk = 20;
    const name = (f as unknown as { constructor: { name: string } }).constructor.name;
    const set = name === "Batman" ? LINES.batman : name === "Wolverine" ? LINES.wolverine : LINES.hulk;
    this.say(pick(set), 2.4);
  }
  private yawOf(at: Vector3) {
    return Math.atan2(at.x - this.p.x, at.z - this.p.z);
  }
  private start(kind: Action["kind"], target: Foe | SoldierLike | AirUnit, dur: number) {
    this.action = { kind, t: 0, dur, phase: 0, target };
    this.ai = kind === "punch" ? "dash" : kind;
    if (kind === "punch" || kind === "heat") this.moves++;
    if (kind === "punch") this.cd.punch = rnd(3.5, 5.5);
    if (kind === "heat") {
      this.cd.heat = rnd(6, 9);
      this.host.audio.play("repulsorCharge", { x: this.p.x, y: this.p.y + 0.6, z: this.p.z, volume: 0.5, rate: 1.4 });
    }
    if (kind === "freeze") {
      this.cd.freeze = rnd(11, 15);
      this.exposure.clear();
    }
  }
  private isAir(t: unknown): t is AirUnit {
    return !!t && typeof t === "object" && "label" in t && "kind" in t;
  }
  private targetPoint(t: Foe | SoldierLike | AirUnit) {
    if (this.isAir(t)) return t.position.clone();
    return "size" in t ? this.chestOf(t as Foe) : (t as SoldierLike).position.add(V(0, 0.3, 0));
  }
  private targetAlive(t: Foe | SoldierLike | AirUnit) {
    if (this.isAir(t)) return t.alive;
    return "size" in t ? (t as Foe).alive : (t as SoldierLike).alive;
  }

  // ------------------------------------------------------------------ powers
  private act(dt: number) {
    const a = this.action;
    if (!a) return;
    a.t += dt;
    const tgt = a.target;
    // (the jet goes on after it's torn apart: the cinematic has his flight out of the fireball still to show)
    if (a.kind === "jet") return this.jetFrame(a, dt);
    if (!tgt || !this.targetAlive(tgt)) {
      this.endAction();
      return;
    }
    const at = this.targetPoint(tgt);
    switch (a.kind) {
      case "air": {
        // up to it at full speed, and through it: it comes apart
        const u = tgt as AirUnit;
        const to = at.subtract(this.p);
        this.yaw = Math.atan2(to.x, to.z);
        this.goal = at.clone();
        this.dashing = true;
        if (to.length() < Math.max(3, u.size.z * 0.4)) {
          const side = V(Math.cos(this.yaw), 0, -Math.sin(this.yaw));
          this.host.audio.play("superPunch", { x: at.x, y: at.y, z: at.z, volume: 1.4, rate: 0.8 });
          this.rings.boom(at, to.normalizeToNew(), 8);
          u.rip(side);
          this.v.copyFrom(to.normalizeToNew().scale(12)).addInPlaceFromFloats(0, 6, 0);
          this.endAction();
        } else if (a.t > a.dur) this.endAction();
        break;
      }
      case "carry": {
        // in, grab — up into the sky with him — three blows up there — and hurled down
        const isFoe = "size" in tgt && !this.isAir(tgt);
        const f = tgt as Foe & { hold?(p: Vector3): void; drop?(v: Vector3): void };
        const s2 = tgt as SoldierLike & { carry?(p: Vector3): void; slamDown?(v: Vector3): void };
        const hands = this.p.add(V(Math.sin(this.yaw), -0.4, Math.cos(this.yaw)).scale(0.9));
        const hold = (p: Vector3) => (isFoe ? f.hold?.(p.subtract(V(0, 1.0, 0))) : s2.carry?.(p));
        if (a.phase === 0) {
          const to = at.subtract(this.p);
          this.yaw = Math.atan2(to.x, to.z);
          this.goal = at.subtract(to.normalizeToNew().scale(0.9));
          this.dashing = true;
          if (to.length() < 1.8) {
            a.phase = 1;
            a.t = 0;
            a.top = this.p.y + 22;
            a.blows = 0;
            this.host.audio.play("meleeHit", { x: at.x, y: at.y, z: at.z, volume: 1, rate: 0.7 });
          } else if (a.t > 3) this.endAction();
          break;
        }
        hold(hands);
        if (a.phase === 1) {
          // up
          this.goal = V(this.p.x, a.top!, this.p.z);
          this.dashing = true;
          if (this.p.y > a.top! - 1 || a.t > 2.2) {
            a.phase = 2;
            a.t = 0;
          }
        } else if (a.phase === 2) {
          // the blows: one every 0.45 s, each one a crack and a jolt
          this.goal = null;
          this.v.scaleInPlace(Math.exp(-6 * dt));
          if (a.t > 0.3 + a.blows! * 0.45 && a.blows! < 3) {
            a.blows!++;
            this.host.audio.play("superPunch", { x: hands.x, y: hands.y, z: hands.z, volume: 1.1, rate: 0.9 + a.blows! * 0.1 });
            this.rings.boom(hands, V(Math.sin(this.yaw), 0, Math.cos(this.yaw)), 3);
            if (isFoe) f.applyHit(45, "torso", V(0, -1, 0), hands, { kind: "melee", force: 0, source: this });
          }
          if (a.blows! >= 3 && a.t > 1.8) {
            // and down, hard
            const down = V(Math.sin(this.yaw) * 4, -34, Math.cos(this.yaw) * 4);
            if (isFoe) f.drop?.(down);
            else s2.slamDown?.(down);
            this.host.audio.play("swingWhoosh", { x: hands.x, y: hands.y, z: hands.z, volume: 1, rate: 0.6 });
            this.v.set(0, 4, 0);
            this.endAction();
          }
        }
        break;
      }
      case "punch": {
        // in at speed, the fist out — through him
        const to = at.subtract(this.p);
        const d = to.length();
        this.yaw = Math.atan2(to.x, to.z);
        if (a.phase === 0) {
          this.goal = at.subtract(to.normalizeToNew().scale(1.0));
          this.dashing = true;
          if (d < 1.9) {
            a.phase = 1;
            a.t = 0;
            this.punch(tgt, to.normalize());
          } else if (a.t > 3) this.endAction();
        } else if (a.t > 0.45) this.endAction();
        break;
      }
      case "heat": {
        // hover, face him, two beams from the eyes — burning
        this.goal = null;
        this.v.scaleInPlace(Math.exp(-4 * dt));
        this.yaw = this.yawOf(at);
        if (a.t > 0.25) {
          if (!this.heatLoop) this.heatLoop = this.host.audio.playLoop("heatBeam", { x: this.p.x, y: this.p.y, z: this.p.z, volume: 0.8 });
          this.heatLoop.setPosition(this.p.x, this.p.y, this.p.z);
          const end = this.burnPoint(at);
          this.eyes.forEach((e, i) => this.beams.set(i, worldPos(e), end.add(V((i - 0.5) * 0.06, 0, 0))));
          if (this.eyes.length === 0) {
            const h = this.rig.at("Head");
            this.beams.set(0, h, end);
          }
          a.phase += dt;
          if (a.phase > 0.1) {
            a.phase = 0;
            this.burn(tgt, end);
          }
        }
        if (a.t >= a.dur) this.endAction();
        break;
      }
      case "freeze": {
        // hover a few metres off, lean in, and breathe out a cone of frost
        this.goal = null;
        this.v.scaleInPlace(Math.exp(-4 * dt));
        this.yaw = this.yawOf(at);
        if (a.t > 0.35) {
          if (!this.frostLoop) this.frostLoop = this.host.audio.playLoop("frostBreath", { x: this.p.x, y: this.p.y, z: this.p.z, volume: 1 });
          this.frostLoop.setPosition(this.p.x, this.p.y, this.p.z);
          const mouth = this.rig.at("Head").add(V(0, -0.05, 0));
          const aim = at.subtract(mouth).normalize();
          mouth.addInPlace(aim.scale(0.15));
          for (let i = 0; i < 6; i++) {
            const j = V((Math.random() - 0.5) * 0.35, (Math.random() - 0.5) * 0.35, (Math.random() - 0.5) * 0.35);
            const v = aim.add(j).normalize().scale(rnd(11, 16));
            this.breath.emit(mouth, v, rnd(0.7, 1.0), 0.12, 9, new Color3(0.95, 0.98, 1), new Color3(0.72, 0.86, 1), 0.7, 1.6, -0.6);
          }
          this.freezeCone(mouth, aim, dt);
        }
        if (a.t >= a.dur) this.endAction();
        break;
      }
    }
  }
  /** whoever he had hold of, let go (falling): a carry cut short never leaves anyone hanging in the air */
  private releaseHeld() {
    const a = this.action;
    if (a?.kind !== "carry" || a.phase === 0 || !a.target) return;
    const t = a.target as { drop?(v: Vector3): void; slamDown?(v: Vector3): void; held?: boolean };
    if (t.drop) t.drop(V(0, -12, 0));
    else if (t.slamDown && t.held) t.slamDown(V(0, -12, 0));
    a.phase = 0;
  }
  private endAction() {
    this.releaseHeld();
    this.action = null;
    this.beams.off();
    this.heatLoop?.stop(0.2);
    this.heatLoop = null;
    this.frostLoop?.stop(0.3);
    this.frostLoop = null;
    this.ai = "hover";
  }
  /** where the beams land: him, or whatever's in the way */
  private burnPoint(at: Vector3) {
    const eye = this.rig.at("Head");
    const dir = at.subtract(eye);
    const L = dir.length();
    const t = this.host.nav.rayLevel(eye, at);
    return t >= 0 && t < L - 0.3 ? eye.add(dir.scale(t / L)) : at;
  }
  private burn(t: Foe | SoldierLike, end: Vector3) {
    const dir = end.subtract(this.p).normalize();
    if ("size" in t) {
      const f = t as Foe;
      if (Vector3.Distance(end, this.chestOf(f)) < 1.5 * f.size) f.applyHit(7, "torso", dir, end, { kind: "melee", force: 0, source: this });
    } else if (Vector3.Distance(end, (t as SoldierLike).position) < 1.2) (t as SoldierLike).applyHit(160, "torso", dir, end, { kind: "bullet" });
    if (Math.random() < 0.5) this.host.scorch(end);
  }
  /** the cone: who's in it long enough freezes (never you, never the heroes) */
  private freezeCone(mouth: Vector3, aim: Vector3, dt: number) {
    const inCone = (p: Vector3, reach: number) => {
      const to = p.subtract(mouth);
      const d = to.length();
      return d < reach && d > 0.3 && Vector3.Dot(to.scale(1 / d), aim) > Math.cos(0.42) && this.host.nav.clear(mouth, p);
    };
    const ice = this.host.ice;
    for (const s of this.host.soldiers()) {
      if (!s.alive || s.frozen || !s.freeze || !inCone(s.position, 13)) continue;
      const e = (this.exposure.get(s) ?? 0) + dt;
      this.exposure.set(s, e);
      if (e > 0.4 && s.freeze(3.2)) ice.encase(s, () => s.position.add(V(0, 0.05, 0)), 2.0, 0.55, () => !!s.frozen);
    }
    for (const f of this.host.foes()) {
      const fz = f as Foe & { freeze?(s: number): boolean; readonly frozen?: boolean };
      if (!fz.freeze || fz.frozen || !inCone(this.chestOf(f), 13 + f.size * 2)) continue;
      const e = (this.exposure.get(f) ?? 0) + dt;
      this.exposure.set(f, e);
      const big = f.size >= 1;
      if (e > (big ? 0.8 : 0.5) && fz.freeze(big ? 2.2 : 3.6)) ice.encase(f, () => f.position.add(V(0, 0.95 * f.size * (big ? 1.4 : 1), 0)), 2.0 * (big ? 1.6 : 1) * f.size / (big ? 1 : 0.75) * (big ? 1 : 0.95), 0.65 * (big ? 1.7 : 1), () => !!fz.frozen);
    }
  }
  /** the fist landing */
  private punch(t: Foe | SoldierLike, dir: Vector3) {
    const au = this.host.audio;
    const fist = this.rig.at("RightHand");
    au.play("superPunch", { x: fist.x, y: fist.y, z: fist.z, volume: 1.2 });
    this.rings.boom(fist, dir, 4);
    this.host.dust(fist.clone(), 0.3);
    const away = flat(dir).normalize();
    if ("size" in t) {
      const f = t as Foe & { launch?(v: Vector3): void };
      const big = f.size >= 1;
      f.applyHit(big ? 70 : 60, "torso", dir, fist, { kind: "melee", force: 3, source: this });
      f.launch?.(away.scale(big ? 16 : 22).addInPlaceFromFloats(0, big ? 0 : 8, 0));
      this.host.player.shake(big ? 0.35 : 0.22);
    } else {
      const s = t as SoldierLike;
      // one blow: dead, and the body flies
      s.applyHit(999, "torso", dir, fist, { kind: "melee", force: 1, launch: away.scale(24).addInPlaceFromFloats(0, 8, 0) } as never);
      this.host.player.shake(0.12);
    }
    // (and on through: carry on past, up and round)
    this.v.copyFrom(dir.scale(10)).addInPlaceFromFloats(0, 8, 0);
  }
  private sonicBoom(at: Vector3, dir: Vector3, size = 9) {
    this.cd.boom = 2.5;
    this.rings.boom(at, dir, size);
    this.host.audio.play("sonicBoom", { x: at.x, y: at.y, z: at.z, volume: 1.4 });
    // the vapour cone: a ring of white mist thrown back off him
    const side = Math.abs(dir.y) < 0.9 ? Vector3.Cross(dir, V(0, 1, 0)).normalize() : V(1, 0, 0);
    const up = Vector3.Cross(side, dir).normalize();
    for (let i = 0; i < 40; i++) {
      const a = (i / 40) * Math.PI * 2;
      const r = side.scale(Math.cos(a)).add(up.scale(Math.sin(a)));
      this.vapor.emit(at.add(r.scale(0.8)), r.scale(rnd(4, 7)).add(dir.scale(-3)), rnd(0.6, 1.0), 0.4, 3, new Color3(1, 1, 1), new Color3(0.9, 0.92, 0.95), 0.55, 2, 0);
    }
    const pl = this.host.player.feet;
    const d = Vector3.Distance(pl, at);
    if (d < 60) this.host.player.shake(Math.max(0.05, 0.35 * (1 - d / 60)));
  }

  // ------------------------------------------------------------------ a jet, by hand (a cinematic)
  private jetCine = { from: V(), dir: V(), side: V(), out: V(), at: V() };
  /**
   * 4 s: up at it head-on (a boom as he goes through the barrier) — his hands on its nose, it
   * shudders, slowing in his grip — and he tears it in two: a fireball, and him coming out of it.
   */
  /** how many jet takedowns he's been filmed doing this fight (two at most) */
  private jetsFilmed = 0;
  private startJet(u: AirUnit) {
    this.jetsFilmed++;
    this.cd.cine = 55;
    this.endAction();
    this.action = { kind: "jet", t: 0, dur: 4.2, phase: 0, target: u };
    this.ai = "dash";
    const J = this.jetCine;
    J.dir.copyFrom(u.v.lengthSquared() > 1 ? u.v.normalizeToNew() : V(0, 0, 1));
    J.side.copyFrom(Vector3.Cross(J.dir, V(0, 1, 0)).normalize());
    // (he starts below and ahead of it, and meets it where it'll be in a second)
    J.at.copyFrom(u.position.add(J.dir.scale(45)));
    J.from.copyFrom(J.at.add(J.dir.scale(70)).addInPlaceFromFloats(0, -30, 0));
    this.p.copyFrom(J.from);
    this.trailNode.position.copyFrom(this.p);
    this.makeTrail();
    this.sonicBoom(this.p.clone(), J.at.subtract(J.from).normalize(), 10);
  }
  private jetFrame(a: Action, dt: number) {
    const u = a.target as AirUnit;
    const J = this.jetCine;
    const t = a.t;
    // (shot down by someone else before he got there)
    if (!u.alive && a.phase < 2) {
      this.endAction();
      return;
    }
    if (t < 1.1) {
      // both closing: the jet slowed (the moment stretched), him rising to meet it
      if (u.alive) u.hold(u.position.add(J.dir.scale(40 * dt)), 0);
      const f = t / 1.1;
      Vector3.LerpToRef(J.from, u.position.subtract(J.dir.scale(-u.size.z * 0.55)), f * f, this.p);
      this.v.copyFrom(u.position.subtract(this.p).normalize().scale(40));
      this.yaw = Math.atan2(-J.dir.x, -J.dir.z);
      this.trail.isVisible = true;
    } else if (t < 2.3) {
      // the catch: his hands on the nose, both pushed back, it shakes in his grip
      if (a.phase === 0) {
        a.phase = 1;
        this.host.audio.play("superPunch", { x: this.p.x, y: this.p.y, z: this.p.z, volume: 1.4, rate: 0.6 });
        this.host.audio.play("impactMetal", { x: this.p.x, y: this.p.y, z: this.p.z, volume: 1.2, rate: 0.5 });
        this.rings.boom(this.p.clone(), J.dir, 6);
      }
      const nose = this.p.add(J.dir.scale(-u.size.z * 0.44 - 0.15));
      this.p.addInPlace(J.dir.scale(8 * dt * (1 - (t - 1.1) / 1.2)));
      if (u.alive) u.hold(nose, 0.08 + (t - 1.1) * 0.25);
      this.v.setAll(0);
      this.trail.isVisible = false;
      if (Math.random() < dt * 8) this.host.audio.play("impactMetal", { x: this.p.x, y: this.p.y, z: this.p.z, volume: 0.8, rate: 0.6 + Math.random() * 0.3 });
    } else if (a.phase === 1) {
      // and apart
      a.phase = 2;
      J.out.copyFrom(J.dir.scale(1)).addInPlaceFromFloats(0, 0.25, 0).normalize();
      if (u.alive) u.rip(J.side);
      this.host.audio.play("sonicBoom", { x: this.p.x, y: this.p.y, z: this.p.z, volume: 1.2, rate: 0.8 });
      this.host.player.shake(0.4);
    } else {
      // out of the fireball, toward the lens
      this.p.addInPlace(J.out.scale(14 * dt));
      this.yaw = Math.atan2(J.out.x, J.out.z);
    }
    if (t >= a.dur) {
      this.endAction();
      this.v.copyFrom(J.out.scale(8));
    }
  }
  private jetShot(): { pos: Vector3; target: Vector3; fov: number; cut?: boolean } | null {
    const a = this.action!;
    const u = a.target as AirUnit;
    const J = this.jetCine;
    const t = a.t;
    if (t < 1.1) return { pos: this.p.subtract(u.position.subtract(this.p).normalize().scale(7)).addInPlaceFromFloats(0, 1.2, 0), target: u.position, fov: 0.75, cut: t < 0.03 };
    if (t < 2.3) {
      const mid = Vector3.Lerp(this.p, u.position, 0.4);
      return { pos: mid.add(J.side.scale(9)).addInPlaceFromFloats(0, 2.2, 0), target: mid, fov: 0.8, cut: t < 1.13 };
    }
    // in front of him as he comes out of it
    const f = (t - 2.3) / 1.9;
    return { pos: this.p.add(J.out.scale(16 - f * 4)).addInPlace(J.side.scale(3)).addInPlaceFromFloats(0, 1.5, 0), target: this.p, fov: 0.85, cut: t < 2.33 };
  }

  // ------------------------------------------------------------------ flight
  private move(dt: number) {
    const nav = this.host.nav;
    if (this.action?.kind === "jet") return;
    if (this.mode === "tumble") {
      this.tumbleT += dt;
      this.v.y -= G * dt * 0.6;
      if (this.tumbleT > 0.7) this.mode = "fly";
    } else {
      const goal = this.goal ?? this.p.add(this.v.scale(0.2));
      const to = goal.subtract(this.p);
      const dist = to.length();
      const maxS = this.dashing ? SM.dash : SM.cruise;
      const want = dist > 1e-3 ? to.scale(Math.min(maxS, dist * (this.dashing ? 2.4 : 1.8)) / dist) : V();
      if (!this.goal) want.y += Math.sin(performance.now() / 700) * 0.3;
      const dv = want.subtract(this.v);
      const lim = (this.dashing ? SM.dashAccel : SM.accel) * dt;
      if (dv.length() > lim) dv.scaleInPlace(lim / dv.length());
      this.v.addInPlace(dv);
      // ahead: a wall — up and over it
      const ahead = this.p.add(this.v.scale(0.4));
      const wall = nav.moveHit(this.p, ahead);
      if (wall) {
        const into = Vector3.Dot(this.v, wall.normal);
        if (into < 0) this.v.subtractInPlace(wall.normal.scale(into * 1.1));
        this.v.y += 14 * dt;
      }
    }
    const next = this.p.add(this.v.scale(dt));
    const hit = this.host.nav.moveHit(this.p, next);
    if (hit) {
      next.copyFrom(hit.point.add(hit.normal.scale(0.3)));
      const vn = Vector3.Dot(this.v, hit.normal);
      if (vn < 0) this.v.subtractInPlace(hit.normal.scale(vn));
    }
    const fy = nav.floorAt(next.x, next.y + 0.5, next.z, 50) ?? 0;
    const minY = fy + (this.ai === "victory" ? 1.0 : SM.minAlt * (this.goal && this.goal.y - fy < 1.5 ? 0.62 : 1));
    if (next.y < minY) {
      next.y = minY;
      if (this.v.y < 0) this.v.y *= 0.2;
    }
    if (next.y > SM.maxAlt) next.y = SM.maxAlt;
    const B = this.host.bounds;
    next.x = Math.max(B.minX + 1, Math.min(B.maxX - 1, next.x));
    next.z = Math.max(B.minZ + 1, Math.min(B.maxZ - 1, next.z));
    this.p.copyFrom(next);
    // the sound barrier
    const sp = this.v.length();
    if (sp > 24 && this.cd.boom <= 0) this.sonicBoom(this.p.clone(), this.v.normalizeToNew());
    this.mode = this.mode === "tumble" ? "tumble" : this.ai === "victory" && sp < 1 ? "ground" : "fly";
    // facing: the way he flies when he's going somewhere fast; otherwise at what he's doing
    if (sp > 8 && !this.action) this.yaw = Math.atan2(this.v.x, this.v.z);
  }

  // ------------------------------------------------------------------ the body
  private animate(dt: number) {
    const want = this.want;
    const a = this.action;
    const sp = this.v.length();
    let rate = 12;
    let along = 0; // 0 upright … 1 flat along the flight
    if (this.mode === "intro") {
      const t = this.intro.t;
      if (t < 2.2) {
        copyPose(FLY, want);
        along = 1;
      } else if (t < 3.4) {
        copyPose(TOUCHDOWN, want);
        rate = 22;
      } else if (t < 4.9) {
        mixPose(TOUCHDOWN, HANDS_ON_HIPS, Math.min(1, (t - 3.4) / 0.6), want);
        rate = 8;
      } else {
        copyPose(HOVER, want);
        rate = 8;
      }
    } else if (this.mode === "tumble") {
      copyPose(HIT, want);
      rate = 14;
    } else if (a?.kind === "punch") {
      if (a.phase === 0) {
        // in flat and fast, the fist out ahead
        copyPose(FLY, want);
        along = Math.min(1, sp / 14);
      } else {
        copyPose(a.t < 0.12 ? PUNCH : PUNCH, want);
        rate = 30;
      }
      if (a.phase === 0 && Vector3.Distance(this.p, this.targetPoint(a.target!)) < 4) mixPose(want, PUNCH_WIND, 0.7, want);
    } else if (a?.kind === "air" || (a?.kind === "carry" && a.phase === 0)) {
      copyPose(FLY, want);
      along = Math.min(1, sp / 12);
    } else if (a?.kind === "heat") {
      copyPose(HOVER, want);
      // (the head on him)
      const d = this.toBody(this.targetPoint(a.target!).subtract(this.rig.at("Head")));
      want.d[4] = norm([d[0] * 0.5, 1, d[2] * 0.5]);
      want.d[5] = norm([d[0] * 0.4, Math.max(0.3, 1 + d[1]), d[2] * 0.7]);
      rate = 16;
    } else if (a?.kind === "carry" && a.phase > 0) {
      // holding him out in front: both arms out, then the right drawn back for each blow
      copyPose(HOVER, want);
      want.d[6] = norm([-0.25, 0.1, 0.96]);
      want.d[7] = norm([-0.1, 0.1, 1]);
      const wind = a.phase === 2 ? ((a.t - 0.3) % 0.45) / 0.45 : 0;
      mixPose(want, wind < 0.6 ? PUNCH_WIND : PUNCH, 0.8, want);
      want.d[6] = norm([-0.25, 0.1, 0.96]);
      want.d[7] = norm([-0.1, 0.1, 1]);
      rate = 20;
    } else if (a?.kind === "jet") {
      // the whole takedown in his flying pose, laid out along the line to the jet: in with the fist
      // ahead, then both fists out in front on its nose (they part a little as it tears)
      const t = a.t;
      copyPose(FLY, want);
      if (t >= 1.1) {
        const k = t < 2.3 ? 0.12 : 0.3;
        want.d[6] = norm([-k, 0.98, 0.1]);
        want.d[7] = norm([-k * 0.5, 1, 0.05]);
        want.d[8] = norm([-k * 0.3, 1, 0.08]);
        want.d[9] = norm([k, 0.98, 0.1]);
        want.d[10] = norm([k * 0.5, 1, 0.05]);
      }
      along = 1;
      rate = 18;
    } else if (a?.kind === "freeze") {
      copyPose(BREATH, want);
      rate = 12;
    } else if (this.ai === "victory" || this.mode === "ground") {
      copyPose(HANDS_ON_HIPS, want);
      rate = 6;
    } else if (sp > 8) {
      copyPose(FLY, want);
      along = Math.min(1, (sp - 6) / 10);
      rate = 10;
    } else {
      copyPose(HOVER, want);
      // a slow drift: the legs and arms move a little
      const b = Math.sin(performance.now() / 900) * 0.05;
      want.d[12] = norm([want.d[12][0], -1, want.d[12][2] + b]);
      want.d[15] = norm([want.d[15][0], -1, want.d[15][2] - b]);
    }
    follow(this.shown, want, rate, dt);
    if (!this.shown.d.every((d) => isFinite(d[0] + d[1] + d[2]))) copyPose(HOVER, this.shown);
    // orientation: flat along the flight (his head leading) when he's flying fast; upright otherwise; banking into turns
    const fwdH = V(Math.sin(this.yaw), 0, Math.cos(this.yaw));
    const vel = sp > 0.5 ? this.v.normalizeToNew() : fwdH;
    this.alongK += (along - this.alongK) * Math.min(1, dt * 4);
    const up = Vector3.Lerp(V(0, 1, 0), vel, this.alongK).normalize();
    const fwd = Vector3.Lerp(fwdH, V(0, -1, 0), this.alongK * 0.9).normalize();
    fwd.subtractInPlace(up.scale(Vector3.Dot(fwd, up))).normalize();
    if (fwd.lengthSquared() < 1e-4) fwd.copyFrom(fwdH);
    lookRotation(fwd, up, this.q);
    const yawRate = Math.atan2(Math.sin(this.yaw - this.lastYaw), Math.cos(this.yaw - this.lastYaw)) / Math.max(1e-3, dt);
    this.lastYaw = this.yaw;
    this.bank += (Math.max(-0.6, Math.min(0.6, -yawRate * 0.08 * this.alongK)) - this.bank) * Math.min(1, dt * 4);
    if (Math.abs(this.bank) > 1e-3) this.q.multiplyInPlace(Quaternion.RotationAxis(V(0, 1, 0), this.bank));
    const anc = this.rig.anchor;
    anc.rotationQuaternion!.copyFrom(this.q);
    // (the anchor at his feet: his centre is a metre up his body)
    anc.position.copyFrom(this.p).subtractInPlace(up.scale(1.0));
    const hip = this.shown.hip;
    this.rig.pose(this.shown.d, V(hip[0] * this.rig.hipH, hip[1] * this.rig.hipH, hip[2] * this.rig.hipH));
    const fist = a?.kind === "punch" || (sp > 8 && this.mode === "fly") ? 1 : 0.45;
    this.gripK += (fist - this.gripK) * Math.min(1, dt * 10);
    this.rig.grip?.("l", this.gripK * 0.8);
    this.rig.grip?.("r", this.gripK);
  }
  private alongK = 0;
  private toBody(w: Vector3): Dir {
    const b = w.normalizeToNew().applyRotationQuaternion(Quaternion.Inverse(this.q));
    return [b.x, b.y, b.z];
  }

  // ------------------------------------------------------------------ the cape
  private resetCape() {
    for (const s of this.strands) {
      s.bones.forEach((b, i) => b.rotationQuaternion!.copyFrom(s.rest[i]));
      s.pts = [];
    }
  }
  /**
   * Each strand: its first bone pinned to his shoulders; the rest a chain of points (gravity, the
   * air of his motion pushing them back, a flutter), held at the bones' lengths, tied to the
   * neighbouring strands, kept off his back — then each bone turned to point at the next point.
   */
  private simCape(dt: number) {
    if (!this.strands.length) return;
    const h = Math.min(dt, 1 / 30);
    // (his back's plane: behind the chest, facing out)
    const A = this.rig.anchor;
    A.computeWorldMatrix(true);
    const back = Vector3.TransformNormal(V(0, 0, -1), A.getWorldMatrix()).normalize();
    const bodyUp = Vector3.TransformNormal(V(0, 1, 0), A.getWorldMatrix()).normalize();
    const chest = this.rig.at("Spine1");
    // the air: his own motion, against the cape, and a little gust
    const air = this.v.scale(-1).addInPlace(V(Math.sin(performance.now() / 330) * 0.8, 0, Math.cos(performance.now() / 410) * 0.8));
    for (const s of this.strands) {
      s.bones.forEach((b, i) => b.rotationQuaternion!.copyFrom(s.rest[i]));
      const root = worldPos(s.bones[0]);
      if (!s.pts.length) {
        // start from the rest shape
        for (let i = 0; i < s.bones.length; i++) {
          const p = worldPos(s.bones[i]);
          s.pts.push(p.clone());
          s.prev.push(p.clone());
          if (i > 0) s.len.push(Vector3.Distance(p, s.pts[i - 1]));
        }
        // the tip: past the last bone by its length
        const tip = s.pts[s.pts.length - 1].add(s.pts[s.pts.length - 1].subtract(s.pts[s.pts.length - 2]));
        s.pts.push(tip);
        s.prev.push(tip.clone());
        s.len.push(s.len[s.len.length - 1]);
      }
      s.pts[0].copyFrom(root);
      s.prev[0].copyFrom(root);
      for (let i = 1; i < s.pts.length; i++) {
        const p = s.pts[i], q = s.prev[i];
        const vel = p.subtract(q).scaleInPlace(0.96);
        q.copyFrom(p);
        // gravity, and the air (the further down the cape, the more it catches)
        const k = i / (s.pts.length - 1);
        vel.addInPlace(V(0, -9.8 * h * h, 0)).addInPlace(air.subtract(vel.scale(1 / h)).scaleInPlace(0.9 * k * h * h));
        p.addInPlace(vel);
      }
    }
    // constraints, a few passes: lengths along each strand, spacing across them, off his back
    for (let it = 0; it < 4; it++) {
      for (const s of this.strands) {
        for (let i = 1; i < s.pts.length; i++) {
          const a = s.pts[i - 1], b = s.pts[i];
          const d = b.subtract(a);
          const L = d.length() || 1e-4;
          const fix = d.scale((L - s.len[i - 1]) / L);
          if (i === 1) b.subtractInPlace(fix);
          else {
            a.addInPlace(fix.scale(0.5));
            b.subtractInPlace(fix.scale(0.5));
          }
          // (pinned at the shoulders: where it was found this frame, not recomputed from the scene root each pass)
          s.pts[0].copyFrom(s.prev[0]);
          // off his body: at least 6 cm behind the plane through his chest
          const off = Vector3.Dot(b.subtract(chest), back);
          const below = Vector3.Dot(b.subtract(chest), bodyUp);
          if (off < 0.06 && below > -1.2) b.addInPlace(back.scale(0.06 - off));
        }
      }
      for (let k = 1; k < this.strands.length; k++) {
        const A2 = this.strands[k - 1], B2 = this.strands[k];
        for (let i = 1; i < Math.min(A2.pts.length, B2.pts.length); i++) {
          const a = A2.pts[i], b = B2.pts[i];
          const want = Vector3.Distance(A2.prev[0], B2.prev[0]) * (1 + i * 0.12);
          const d = b.subtract(a);
          const L = d.length() || 1e-4;
          const fix = d.scale(((L - want) / L) * 0.5);
          a.addInPlace(fix.scale(0.5));
          b.subtractInPlace(fix.scale(0.5));
        }
      }
    }
    // the bones follow the points
    for (const s of this.strands) {
      for (let i = 0; i < s.bones.length - 1; i++) {
        const b = s.bones[i], c = s.bones[i + 1];
        alignDir(b, worldPos(c).subtract(worldPos(b)), s.pts[i + 1].subtract(s.pts[i]), () => worldPos(c).subtract(worldPos(b)));
      }
      // (the last bone: toward the tip)
      const last = s.bones[s.bones.length - 1], prev = s.bones[s.bones.length - 2];
      const dir = worldPos(last).subtract(worldPos(prev));
      alignDir(last, dir, s.pts[s.pts.length - 1].subtract(s.pts[s.pts.length - 2]), () => dir);
    }
  }

  // ------------------------------------------------------------------ effects
  private effects(dt: number) {
    const sp = this.v.length();
    this.trailNode.position.copyFrom(this.feet);
    if (this.mode !== "intro") this.trail.isVisible = sp > 18;
    this.beams.update(dt);
    this.vapor.update(dt);
    this.breath.update(dt);
    this.rings.update(dt);
    this.dashing = this.dashing && !!this.goal;
    if (sp > 18 && Math.random() < dt * 30) this.vapor.emit(this.p.clone(), this.v.scale(-0.1), 0.5, 0.25, 2, new Color3(1, 1, 1), new Color3(0.9, 0.93, 1), 0.25, 1, 0);
  }

  /** a restart */
  reset() {
    this.jetsFilmed = 0;
    this.enabled = false;
    this.rig.setVisible(false);
    this.hud.style.display = "none";
    this.line.classList.remove("on");
    this.endAction();
    this.trail.isVisible = false;
    this.vapor.reset();
    this.breath.reset();
    this.rings.reset();
    this.mode = "intro";
    this.wasFighting = false;
    this.cd = { punch: 1, heat: 3, freeze: 6, boom: 0, quip: 6, soldier: 0, talk: 0, carry: 8, air: 4, cine: 0 };
  }
}
void aimArm;
void clipDur;
export const _supermanClipsUsed = (s: Superman) => s.clipsReady;
