import { Color3 } from "@babylonjs/core/Maths/math.color";
import { Mesh } from "@babylonjs/core/Meshes/mesh";
import { MeshBuilder } from "@babylonjs/core/Meshes/meshBuilder";
import { PBRMaterial } from "@babylonjs/core/Materials/PBR/pbrMaterial";
import { Matrix, Quaternion, Vector3 } from "@babylonjs/core/Maths/math.vector";
import { Scene } from "@babylonjs/core/scene";
import { TransformNode } from "@babylonjs/core/Meshes/transformNode";
import { TrailMesh } from "@babylonjs/core/Meshes/trailMesh";
import { StandardMaterial } from "@babylonjs/core/Materials/standardMaterial";
import { AudioEngine } from "../audio/AudioEngine";
import { BodyZone, HitKind } from "../config/game";
import { lookRotation } from "../core/math";
import { NavGraph } from "../level/NavGraph";
import { BIPED, SkinnedModel, type Rig } from "../allies/HeroRig";
import type { Dir } from "../allies/SpiderRig";
import {
  HIT, LANDING, PERCH, TUCK, UPPER, clipDur, copyPose, follow, loadSpiderClips, mixPose, naturalArms, newPose, pose, sample,
  type ClipName, type DirClip,
} from "../allies/SpiderPoses";
import type { Combatant, Foe, HulkHost, HulkThreat } from "./Hulk";
import wolverineUrl from "../assets/characters/wolverine.glb?url";

/**
 * WOLVERINE — against you ("Wolverine | Rigged | Deadpool And Wolverine" by K Animator, CC BY 4.0:
 * a 3ds Max Biped skeleton, its bones read as Mixamo's so the same bone-direction poses drive him).
 * He comes after Spider-Man, on the Hulk's side of the fight: a growl from up on a container, the
 * claws out one fist at a time (snikt), a roar, a leap down in front of you and a landing that shakes
 * the ground — then he's at you, or whichever of the heroes is nearest and hurting him most.
 *
 * He fights like a feral thing: low, fast, never still — claw flurries in close (the mocap combos,
 * blades out of his fists), a pounce from mid-range that bowls you over, a roll out of a fusillade,
 * a berserker rage when he's hurt (faster, angrier, once). His healing factor closes his wounds when
 * nobody's hit him for a few seconds; bullets only half bite. Put him down and he stays down.
 *
 * The heroes fight him the way they fight the Hulk (he's a Foe: his next blow is readable, he can
 * be webbed for a moment, he can't be ridden). The Hulk ignores him, and he ignores the Hulk.
 */

export interface WolverineHost {
  scene: Scene;
  nav: NavGraph;
  audio: AudioEngine;
  player: HulkHost["player"];
  /** the heroes on your side (alive) */
  allies: () => Combatant[];
  /** someone else's entrance is playing: he waits */
  holdFight: () => boolean;
  /** the one he has a score to settle with (Deadpool; Superman) — he'll go for him first */
  rival?: () => Combatant | null;
  dust: (pos: Vector3, power: number) => void;
  spark: (pos: Vector3, normal: Vector3) => void;
  blood: (pos: Vector3, dir: Vector3) => void;
  /** he's down for good (counts as a kill) */
  onDown: () => void;
}

type State = "dormant" | "intro" | "held" | "chase" | "attack" | "pounce" | "lunge" | "spin" | "dodge" | "webbed" | "stagger" | "frozen" | "air" | "getup" | "down";

const G = 20;
const W = {
  health: 2300,
  /** bullets: half of it (and the healing factor does the rest) */
  bulletFactor: 0.5,
  run: 7.4,
  sprint: 9.4,
  reach: 2.3,
  /** health back per second, a few seconds after the last hit */
  regen: 7,
  regenAfter: 3.2,
};
/** claw flurries: clip, speed, when the blows land (fraction), damage to you / to a hero */
const FLURRIES: { clip: ClipName; speed: number; hits: number[]; dmg: number; hero: number }[] = [
  { clip: "combo", speed: 1.7, hits: [0.12, 0.32, 0.56, 0.72, 0.79], dmg: 4, hero: 10 },
  { clip: "elbowCombo", speed: 1.9, hits: [0.119, 0.371, 0.503, 0.589, 0.861], dmg: 4, hero: 10 },
  { clip: "hook", speed: 1.45, hits: [0.29], dmg: 11, hero: 20 },
  { clip: "mmaKick2", speed: 1.45, hits: [0.265, 0.408, 0.551], dmg: 6, hero: 13 },
];
const LINES = {
  intro: ["You picked the wrong fight, bub."],
  intro2: ["Let's go."],
  taunt: ["That all you got?", "I heal. You don't.", "Come here, bub!", "Keep runnin'."],
  hurt: ["Gonna need more than that.", "Heh. Tickles."],
  berserk: ["RRAAAGH!"],
  wade: ["Wade. Shut up.", "Oh great. Him."],
  down: ["…"],
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

/** his fighting crouch: low, knees wide, chest over them, both fists out front, claws forward */
const FERAL = pose(
  {
    hips: [0, 0.94, 0.34], spine: [0, 0.9, 0.42], spine1: [0, 0.88, 0.47], spine2: [0, 0.92, 0.38], neck: [0, 0.95, 0.3], head: [0, 0.99, 0.12],
    lArm: [-0.55, -0.62, 0.56], lFore: [-0.1, 0.05, 0.99], lHand: [-0.05, 0.1, 0.99],
    rArm: [0.5, -0.7, 0.5], rFore: [0.12, -0.12, 0.98], rHand: [0.05, -0.05, 1],
    lThigh: [-0.38, -0.82, 0.42], lShin: [-0.08, -0.97, -0.22], lFoot: [-0.3, -0.35, 0.89],
    rThigh: [0.34, -0.9, -0.2], rShin: [0.06, -0.86, -0.5], rFoot: [0.3, -0.3, 0.9],
  },
  [0, 0.8, -0.04],
);
/** his landing: down on all fours like an animal — both feet, both fists, the claws dug into the ground */
const FERAL_LAND = pose(
  {
    hips: [0, 0.55, 0.84], spine: [0, 0.4, 0.92], spine1: [0, 0.35, 0.94], spine2: [0, 0.4, 0.92], neck: [0, 0.75, 0.66], head: [0, 0.97, 0.25],
    lArm: [-0.35, -0.75, 0.56], lFore: [-0.1, -0.97, 0.2], lHand: [-0.05, -0.6, 0.8],
    rArm: [0.35, -0.75, 0.56], rFore: [0.1, -0.97, 0.2], rHand: [0.05, -0.6, 0.8],
    lThigh: [-0.45, -0.1, 0.89], lShin: [-0.1, -0.99, -0.1], lFoot: [-0.3, -0.3, 0.9],
    rThigh: [0.42, -0.2, 0.88], rShin: [0.1, -0.98, -0.15], rFoot: [0.3, -0.3, 0.9],
  },
  [0, 0.42, -0.1],
);
/** the roar: chest up and out, arms thrown down and back, claws out, head back */
const ROAR = pose(
  {
    hips: [0, 1, -0.05], spine: [0, 1, -0.12], spine1: [0, 1, -0.2], spine2: [0, 1, -0.25], neck: [0, 0.95, -0.3], head: [0, 0.8, -0.6],
    lArm: [-0.7, -0.6, -0.38], lFore: [-0.65, -0.55, -0.5], lHand: [-0.6, -0.5, -0.6],
    lThigh: [-0.3, -0.95, 0.08], lShin: [-0.06, -0.99, -0.1],
    rThigh: [0.3, -0.95, -0.05], rShin: [0.06, -0.99, -0.12],
  },
  [0, 0.95, 0],
);
/** the lunge: stretched out low, both fists out ahead, the back leg driving */
const LUNGE = pose(
  {
    hips: [0, 0.8, 0.6], spine: [0, 0.6, 0.8], spine1: [0, 0.5, 0.86], spine2: [0, 0.5, 0.86], neck: [0, 0.65, 0.76], head: [0, 0.85, 0.5],
    lArm: [-0.2, 0.05, 0.98], lFore: [-0.05, 0.05, 1], lHand: [0, 0.05, 1],
    rArm: [0.2, -0.05, 0.98], rFore: [0.05, 0, 1], rHand: [0, 0, 1],
    lThigh: [-0.15, -0.6, 0.78], lShin: [-0.05, -0.97, -0.2], lFoot: [-0.1, -0.4, 0.9],
    rThigh: [0.15, -0.75, -0.65], rShin: [0.05, -0.3, -0.95], rFoot: [0.05, -0.9, -0.4],
  },
  [0, 0.7, 0.1],
);
/** the pounce: claws first, knees up under him */
const POUNCE = pose(
  {
    hips: [0, 0.75, 0.66], spine: [0, 0.6, 0.8], spine1: [0, 0.55, 0.84], spine2: [0, 0.55, 0.84], neck: [0, 0.6, 0.8], head: [0, 0.8, 0.6],
    lArm: [-0.3, 0.35, 0.89], lFore: [-0.1, 0.25, 0.96], lHand: [0, 0.15, 0.99],
    lThigh: [-0.25, -0.1, 0.96], lShin: [-0.1, -0.95, -0.3], lFoot: [-0.1, -0.7, 0.7],
  },
  [0, 0.8, 0],
);

export class WolverineModel {
  private constructor(readonly m: SkinnedModel) {}
  static async load(scene: Scene) {
    const m = await SkinnedModel.load(
      scene,
      wolverineUrl,
      1.74,
      (mat) => {
        mat.maxSimultaneousLights = 4;
        mat.environmentIntensity = 1.15;
      },
      BIPED,
    );
    return new WolverineModel(m);
  }
}

export class Wolverine implements Foe {
  readonly rig: Rig;
  readonly position = V();
  readonly v = V();
  heading = 0;
  alive = false;
  state: State = "dormant";
  health = W.health;
  /** (the Game scales it to the size of the team he walks into) */
  maxHealth = W.health;
  webbedT = 0;
  readonly rider: Combatant | null = null;
  readonly size = 0.75;
  /** blocks you (like the Hulk's) */
  readonly solid: Mesh;
  private clips!: Record<ClipName, DirClip>;
  private tgt: Combatant | null = null;
  private tgtT = 0;
  private threatOf = new Map<Combatant, number>();
  private stateT = 0;
  private thinkT = 0;
  private cd = { attack: 0, pounce: 3, lunge: 2, spin: 4, dodge: 0, taunt: 6, line: 3, web: 0, roar: 0 };
  private attack: { k: number; t: number; dur: number; done: number } | null = null;
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
  private shown = newPose();
  private want = newPose();
  private runPhase = 0;
  private gait: "walk" | "run" | "sprint" = "run";
  private q = new Quaternion();
  private flipA = 0;
  private flipRate = 0;
  private gripK = 0.8;
  // the claws: three to a fist, out (1) or in (0)
  private claws: { root: TransformNode; blades: Mesh[]; out: number; want: number }[] = [];
  private hitboxes: { m: Mesh; a: string; b: string }[] = [];
  private trails: TrailMesh[] = [];
  private trailMat?: StandardMaterial;
  // the entrance
  private intro = { t: 0, perch: V(), land: V(), face: 0, said: 0, from: V(), sound: 0 };
  private hud: HTMLDivElement;
  private hudFill: HTMLDivElement;
  private ghost = 1;
  private hudGhost: HTMLDivElement;
  private line: HTMLDivElement;
  private lineT = 0;

  private constructor(private host: WolverineHost, model: WolverineModel) {
    const scene = host.scene;
    this.rig = model.m.spawn("wolverine");
    this.rig.setVisible(false);
    // adamantium: three blades out of the back of each fist, between the knuckles
    const steel = new PBRMaterial("wolvClaw", scene);
    steel.albedoColor = new Color3(0.86, 0.88, 0.9);
    steel.metallic = 1;
    steel.roughness = 0.16;
    steel.maxSimultaneousLights = 4;
    for (const side of ["l", "r"]) {
      const root = new TransformNode("wolvClaws_" + side, scene);
      root.rotationQuaternion = new Quaternion();
      const blades: Mesh[] = [];
      for (let k = 0; k < 3; k++) {
        // a long thin blade, tapering to a point (its base at the knuckle, along +Y)
        const b = MeshBuilder.CreateCylinder("wolvClaw" + side + k, { height: 0.32, diameterTop: 0.0, diameterBottom: 0.016, tessellation: 4 }, scene);
        // (stood on its base, then flattened into a blade)
        b.bakeTransformIntoVertices(Matrix.Translation(0, 0.16, 0));
        b.scaling.set(1, 1, 0.35);
        b.material = steel;
        b.parent = root;
        b.position.set((k - 1) * 0.026, 0, 0);
        b.isPickable = false;
        b.receiveShadows = true;
        blades.push(b);
      }
      // the claws' slash trail: a pale streak behind the tips while he's cutting
      const tip = new TransformNode("wolvClawTip_" + side, scene);
      tip.parent = root;
      tip.position.set(0, 0.28, 0);
      const trail = new TrailMesh("wolvTrail_" + side, tip, scene, 0.05, 14, true);
      trail.material = this.trailMat ??= (() => {
        const m = new StandardMaterial("wolvTrailMat", scene);
        m.disableLighting = true;
        m.emissiveColor = new Color3(0.75, 0.85, 1);
        m.alpha = 0.32;
        m.alphaMode = 1;
        m.backFaceCulling = false;
        return m;
      })();
      trail.isPickable = false;
      trail.isVisible = false;
      this.trails.push(trail);
      this.claws.push({ root, blades, out: 0, want: 0 });
    }
    this.solid = MeshBuilder.CreateBox("wolvSolid", { width: 0.7, height: 1.8, depth: 0.6 }, scene);
    this.solid.isVisible = false;
    this.solid.isPickable = false;
    this.solid.checkCollisions = false;
    // hitboxes along his bones: your bullets, knife and blasts find these
    const box = (a: string, b: string, w: number, zone: BodyZone) => {
      const m = MeshBuilder.CreateBox("wolvHit", { size: 1 }, scene);
      m.isVisible = false;
      m.isPickable = false;
      m.metadata = { kind: HitKind.EnemyPart, enemy: this, zone };
      m.scaling.set(w, 1, w * 0.8);
      this.hitboxes.push({ m, a, b });
    };
    box("Hips", "Neck", 0.42, "torso");
    box("Neck", "HeadTop_End", 0.26, "head");
    box("LeftArm", "LeftHand", 0.15, "limb");
    box("RightArm", "RightHand", 0.15, "limb");
    box("LeftUpLeg", "LeftFoot", 0.18, "limb");
    box("RightUpLeg", "RightFoot", 0.18, "limb");
    // his health bar (under the Hulk's) and his lines
    this.hud = document.createElement("div");
    this.hud.className = "ms-boss wolv-boss";
    this.hud.innerHTML = `<div class="ms-boss-name">WOLVERINE <span class="ms-boss-state"></span></div><div class="ms-boss-track"><div class="ms-boss-ghost"></div><div class="ms-boss-fill"></div></div>`;
    document.getElementById("hud")?.appendChild(this.hud);
    this.hudFill = this.hud.querySelector(".ms-boss-fill") as HTMLDivElement;
    this.hudGhost = this.hud.querySelector(".ms-boss-ghost") as HTMLDivElement;
    this.line = document.createElement("div");
    this.line.id = "wolv-line";
    document.getElementById("hud")?.appendChild(this.line);
  }

  static async create(host: WolverineHost, model: WolverineModel) {
    const w = new Wolverine(host, model);
    w.clips = await loadSpiderClips();
    return w;
  }

  get meshes() {
    return [...this.rig.meshes, ...this.claws.flatMap((c) => c.blades)];
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
    this.line.innerHTML = `<b>WOLVERINE</b> ${text}`;
    this.line.classList.add("on");
    this.lineT = secs;
    this.cd.line = 10 + Math.random() * 8;
  }
  private quip(set: keyof typeof LINES, chance = 1) {
    if (this.cd.line > 0 || Math.random() > chance) return;
    this.say(pick(LINES[set]));
  }

  // ------------------------------------------------------------------ the Foe the heroes see
  threat(): HulkThreat | null {
    if (!this.alive) return null;
    const fwd = V(Math.sin(this.heading), 0, Math.cos(this.heading));
    if (this.state === "attack" && this.attack) {
      const f = FLURRIES[this.attack.k];
      const next = f.hits[this.attack.done];
      if (next === undefined) return null;
      const t = next * this.attack.dur - this.attack.t;
      return { kind: "punch", at: this.position.clone(), dir: fwd, radius: W.reach + 0.4, cone: 0.9, t: Math.max(0, t), target: this.tgt };
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
    const dmg = damage * (bullet ? W.bulletFactor : 1) * (zone === "head" ? 1.6 : zone === "limb" ? 0.8 : 1) * (info?.source ? 1.2 : 1);
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
    for (const c of this.claws) c.want = 0;
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
  /** iced over for a few seconds (his healing factor and his strength break him out) */
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

  // ------------------------------------------------------------------ the entrance
  /**
   * In on top of a container you can see (`perch`), down to `land` in front of you. Returns false
   * if he can't come in yet.
   */
  enter(perch: Vector3, land: Vector3) {
    this.position.copyFrom(perch);
    this.v.setAll(0);
    const toYou = flat(this.host.player.feet.subtract(perch));
    this.heading = Math.atan2(toYou.x, toYou.z);
    this.intro = { t: 0, perch: perch.clone(), land: land.clone(), face: this.heading, said: 0, from: perch.clone(), sound: 0 };
    this.health = this.maxHealth;
    this.ghost = 1;
    this.alive = true;
    this.berserk = false;
    this.threatOf.clear();
    this.tgt = this.host.player;
    for (const c of this.claws) (c.want = 0), (c.out = 0);
    copyPose(PERCH, this.shown);
    this.rig.setVisible(true);
    for (const c of this.claws) c.root.setEnabled(true);
    this.go("intro");
    this.hud.classList.add("on");
    this.bar();
    return true;
  }
  skip() {
    if (this.state !== "intro") return;
    this.intro.t = 99;
    this.position.copyFrom(this.intro.land);
    this.v.setAll(0);
    for (const c of this.claws) c.want = c.out = 1;
    this.endIntro();
  }
  private endIntro() {
    for (const b of this.hitboxes) b.m.isPickable = true;
    this.solid.checkCollisions = true;
    this.cd.attack = 0.6;
    this.cd.pounce = 2.5;
    this.go("chase");
  }

  /** the timeline (9 s): perched — the claws — the roar — the leap — the landing — the stand */
  private introFrame(dt: number) {
    const I = this.intro;
    I.t += dt;
    const t = I.t;
    const au = this.host.audio;
    const at = this.position;
    if (I.sound === 0 && t > 0.3) {
      I.sound = 1;
      au.play("hulkRoar", { x: at.x, y: at.y + 1, z: at.z, volume: 0.32, rate: 2.1 });
    }
    // the claws: the right fist at 2.7 s, the left at 3.15 s — snikt
    if (t > 2.7 && this.claws[1].want === 0) {
      this.claws[1].want = 1;
      this.snikt(1);
    }
    if (t > 3.15 && this.claws[0].want === 0) {
      this.claws[0].want = 1;
      this.snikt(0);
    }
    if (t > 4.0 && I.sound === 1) {
      I.sound = 2;
      au.play("hulkRoar", { x: at.x, y: at.y + 1.4, z: at.z, volume: 0.85, rate: 1.75 });
      this.host.player.shake(0.06);
    }
    if (t > 4.4 && I.said === 0) {
      I.said = 1;
      this.say(LINES.intro[0], 2.6);
    }
    // the leap (5.0 → 5.9): a ballistic arc from the box to the ground in front of you
    const L0 = 5.0, LT = 0.9;
    if (t >= L0 && t < L0 + LT) {
      const f = (t - L0) / LT;
      Vector3.LerpToRef(I.perch, I.land, f, at);
      at.y = I.perch.y + (I.land.y - I.perch.y) * f + 2.2 * 4 * f * (1 - f);
      this.flipA = f < 0.85 ? -f * Math.PI * 2 * 0.9 : 0;
    } else if (t >= L0 + LT && I.said < 2) {
      I.said = 2;
      at.copyFrom(I.land);
      this.flipA = 0;
      this.host.dust(I.land.clone(), 0.55);
      au.play("land", { x: at.x, y: at.y, z: at.z, volume: 1, rate: 0.7 });
      au.play("hulkSlam", { x: at.x, y: at.y, z: at.z, volume: 0.45, rate: 1.8 });
      this.host.player.shake(0.22);
    }
    if (t > 7.5 && I.said < 3) {
      I.said = 3;
      this.say(LINES.intro2[0], 1.8);
    }
    this.heading = I.face;
    if (t >= 9) this.endIntro();
  }
  private snikt(side: number) {
    const hand = this.rig.at(side === 0 ? "LeftHand" : "RightHand");
    this.host.audio.play("knifeSlash", { x: hand.x, y: hand.y, z: hand.z, volume: 0.9, rate: 1.55 });
    this.host.audio.play("slideRelease", { x: hand.x, y: hand.y, z: hand.z, volume: 0.6, rate: 1.4 });
  }

  /**
   * The entrance's camera: low and wide on him crouched up on the box; in on his fists as the claws
   * come out; up at him as he roars; alongside the leap; low in front of the landing; and over his
   * and from beside you as he stands and squares up.
   */
  cineShot(): { pos: Vector3; target: Vector3; fov: number; cut?: boolean } | null {
    if (this.state !== "intro") return null;
    const I = this.intro, t = I.t;
    const fwd = V(Math.sin(I.face), 0, Math.cos(I.face));
    const side = V(fwd.z, 0, -fwd.x);
    const P = I.perch;
    if (t < 1.5) {
      // straight down on him from a drone: the whole of him crouched on the container's roof, turning slowly
      const a = I.face + t * 0.5;
      const lift = 9 - t * 2;
      return { pos: P.add(V(Math.sin(a) * 0.6, lift, Math.cos(a) * 0.6)), target: P.add(V(0, 0.6, 0)), fov: 0.72, cut: t < 0.03 };
    }
    if (t < 2.4) {
      const push = (t - 1.5) / 0.9;
      return { pos: P.add(fwd.scale(9 - push * 2)).addInPlace(side.scale(2.5)).addInPlaceFromFloats(0, -1.6, 0), target: P.add(V(0, 1.0, 0)), fov: 0.7 - push * 0.08, cut: t < 1.53 };
    }
    if (t < 3.7) {
      const fist = t < 3.05 ? this.rig.at("RightHand") : Vector3.Lerp(this.rig.at("RightHand"), this.rig.at("LeftHand"), 0.5);
      return { pos: fist.add(fwd.scale(1.1)).addInPlace(side.scale(t < 3.05 ? 0.55 : -0.2)).addInPlaceFromFloats(0, 0.15, 0), target: fist, fov: 0.62, cut: t < 2.43 };
    }
    if (t < 5.0) {
      const head = this.rig.at("Head");
      return { pos: P.add(fwd.scale(3.2)).addInPlace(side.scale(-1.2)).addInPlaceFromFloats(0, 0.2, 0), target: head, fov: 0.72, cut: t < 3.73 };
    }
    if (t < 5.95) {
      const mid = Vector3.Lerp(P, I.land, 0.5);
      return { pos: mid.add(side.scale(9)).addInPlaceFromFloats(0, 2.2, 0), target: this.position.add(V(0, 0.9, 0)), fov: 0.85, cut: t < 5.03 };
    }
    if (t < 6.7) {
      return { pos: I.land.add(fwd.scale(3.4)).addInPlace(side.scale(0.9)).addInPlaceFromFloats(0, 0.35, 0), target: I.land.add(V(0, 0.9, 0)), fov: 0.78, cut: t < 5.98 };
    }
    if (t < 7.6) {
      // up and round above him as he rises: all of him, claws out, in the dust ring
      const f = (t - 6.7) / 0.9;
      const a = I.face + Math.PI * 0.25 + f * 0.9;
      return { pos: I.land.add(V(Math.sin(a) * 3.2, 4.2 + f * 1.2, Math.cos(a) * 3.2)), target: I.land.add(V(0, 0.8, 0)), fov: 0.8, cut: t < 6.73 };
    }
    // and back to you: from just beside your eyes, him in the crouch, claws out (your view takes over from here)
    const eye = this.host.player.camera.position;
    const toHim = flat(I.land.subtract(eye)).normalize();
    return { pos: eye.add(V(toHim.z, 0, -toHim.x).scale(0.6)).addInPlace(toHim.scale(0.8)), target: this.position.add(V(0, 1.1, 0)), fov: 0.8, cut: t < 7.63 };
  }

  /**
   * Somewhere to be found: the top of a container (or a stack) you can see, 10–24 m off, clear of
   * the Hulk — and the spot in front of you he lands on. Null if there's nowhere.
   */
  entrySpot(player: Vector3, eye: Vector3, hulk: Vector3 | null) {
    const nav = this.host.nav;
    let best: Vector3 | null = null, bestS = -Infinity;
    for (let i = 0; i < nav.boxCount; i++) {
      const [x0, y0, z0, x1, y1, z1] = nav.boxBoundsOf(i);
      if (y1 < 2.3 || y1 > 6.5 || y1 - y0 < 2 || Math.min(x1 - x0, z1 - z0) < 2 || Math.max(x1 - x0, z1 - z0) > 8) continue;
      const c = V((x0 + x1) / 2, y1, (z0 + z1) / 2);
      if (!nav.embedded(c.x, y1 - 0.1, c.z) || nav.embedded(c.x, y1 + 0.6, c.z)) continue;
      const fy = nav.floorAt(c.x, y1 + 0.5, c.z, 1);
      if (fy === null || Math.abs(fy - y1) > 0.2) continue;
      const d = Math.hypot(c.x - player.x, c.z - player.z);
      if (d < 10 || d > 24) continue;
      if (hulk && Math.hypot(c.x - hulk.x, c.z - hulk.z) < 7) continue;
      if (!nav.clear(eye, c.add(V(0, 0.8, 0)))) continue;
      const land = this.landFor(V(c.x, fy, c.z), player);
      if (!land) continue;
      const sc = -Math.abs(d - 15) + (y1 > 3 ? 2 : 0);
      if (sc > bestS) (bestS = sc), (best = V(c.x, fy, c.z));
    }
    if (!best) return null;
    return { perch: best, land: this.landFor(best, player)! };
  }
  /** the ground between the box and you, ~5 m in front of you, that he can see from up there */
  private landFor(perch: Vector3, player: Vector3) {
    const nav = this.host.nav;
    const toBox = flat(perch.subtract(player));
    const d = toBox.length();
    if (d < 1) return null;
    toBox.scaleInPlace(1 / d);
    for (const r of [5.5, 7, 4.5, 8.5]) {
      const p = player.add(toBox.scale(Math.min(r, d - 2)));
      const fy = nav.floorAt(p.x, player.y + 1.5, p.z, 3);
      if (fy === null || Math.abs(fy - player.y) > 1) continue;
      if (nav.embedded(p.x, fy + 0.6, p.z) || nav.embedded(p.x, fy + 1.4, p.z)) continue;
      if (!nav.clear(perch.add(V(0, 1.2, 0)), V(p.x, fy + 1.2, p.z))) continue;
      return V(p.x, fy, p.z);
    }
    return null;
  }

  // ------------------------------------------------------------------ frame
  update(dt: number) {
    if (this.state === "dormant") return;
    for (const k of Object.keys(this.cd) as (keyof typeof this.cd)[]) this.cd[k] -= dt;
    this.stateT += dt;
    this.sinceHurt += dt;
    this.recentDmg = Math.max(0, this.recentDmg - dt * 45);
    if (this.lineT > 0 && (this.lineT -= dt) <= 0) this.line.classList.remove("on");
    if (this.state === "intro") this.introFrame(dt);
    else if (this.state === "held") {
      // (Superman moves him)
    } else if (this.state === "frozen") {
      // locked in Superman's ice: nothing moves until he breaks out of it
      this.frozenT -= dt;
      if (this.frozenT <= 0) {
        this.go("stagger");
        this.host.audio.play("iceShatter", { x: this.position.x, y: this.position.y + 1, z: this.position.z, volume: 1 });
        this.host.audio.play("hulkRoar", { x: this.position.x, y: this.position.y + 1.4, z: this.position.z, volume: 0.6, rate: 1.9 });
      }
    } else if (this.state !== "down") {
      // the healing factor
      if (this.sinceHurt > W.regenAfter && this.health < this.maxHealth) this.health = Math.min(this.maxHealth, this.health + W.regen * dt);
      // berserker: once, when he's really hurt
      if (!this.berserk && this.health < this.maxHealth * 0.42 && this.mode() === "ground" && this.state !== "attack") {
        this.berserk = true;
        this.go("stagger");
        this.attack = null;
        this.say(LINES.berserk[0], 1.6);
        this.host.audio.play("hulkRoar", { x: this.position.x, y: this.position.y + 1.4, z: this.position.z, volume: 0.9, rate: 1.6 });
      }
      this.think(dt);
      this.act(dt);
      this.move(dt);
    } else this.moveDown(dt);
    if (!isFinite(this.position.x + this.position.y + this.position.z + this.v.x + this.v.y + this.v.z)) {
      this.position.copyFrom(this.host.player.feet.add(V(4, 0, 4)));
      this.v.setAll(0);
      this.go("chase");
    }
    this.animate(dt);
    this.placeClaws(dt);
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
    const label = this.state === "down" ? "DOWN" : this.berserk ? "BERSERK" : this.sinceHurt > W.regenAfter && f < 1 ? "HEALING" : "";
    if (st.textContent !== label) st.textContent = label;
    this.hud.classList.toggle("l2", this.berserk && this.alive);
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
      if (this.stateT > (this.berserk ? 1.5 : 0.6)) this.go("chase");
      return;
    }
    if (this.state === "getup") {
      if (this.stateT > 0.7) this.go("chase");
      return;
    }
    if (this.state !== "chase") return;
    this.thinkT -= dt;
    this.tgtT -= dt;
    if (!this.tgt?.alive || this.tgtT <= 0) {
      this.tgt = this.pickTarget();
      this.tgtT = rnd(2.5, 4.5);
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
    const k = this.berserk ? 0.7 : 1;
    // under fire: a roll out of it
    if (this.recentDmg > 70 && this.cd.dodge <= 0 && d > 4) {
      this.cd.dodge = rnd(2.5, 4) * k;
      this.recentDmg = 0;
      const side = V(to.z, 0, -to.x).normalize().scale(Math.random() < 0.5 ? 1 : -1);
      this.v.copyFrom(side.scale(8)).addInPlace(to.normalizeToNew().scale(2));
      this.go("dodge");
      return;
    }
    // in close with more than one of them about (or now and then): the spinning slash
    const near = this.combatants().filter((c) => Vector3.Distance(flat(c.feet), flat(this.position)) < 3.2).length;
    if (d < 2.8 && Math.abs(up) < 1.4 && this.cd.spin <= 0 && this.cd.attack <= 0.6 && (near > 1 || Math.random() < 0.3)) return this.startSpin();
    if (d < W.reach && Math.abs(up) < 1.4 && this.cd.attack <= 0) return this.startFlurry();
    // a lunge: a dash straight through him, claws first
    if (d > 3.5 && d < 8 && Math.abs(up) < 1.2 && this.cd.lunge <= 0 && this.host.nav.clear(this.position.add(V(0, 0.9, 0)), tgt.feet.add(V(0, 0.9, 0))) && Math.random() < 0.6) return this.startLunge(to);
    if (d > 5 && d < 13 && Math.abs(up) < 2.2 && this.cd.pounce <= 0 && this.host.nav.clear(this.position.add(V(0, 1, 0)), tgt.feet.add(V(0, 1, 0)))) return this.startPounce(tgt);
    if (d > 6 && d < 16 && this.cd.taunt <= 0 && Math.random() < 0.15) {
      this.cd.taunt = rnd(14, 22);
      this.quip("taunt");
    }
    // between flurries: circling him at a few metres, low, waiting for the opening
    if (d < 5 && this.cd.attack > 0) {
      if (this.stateT > 2 || Math.random() < 0.02) this.circle = -this.circle;
      const ang = Math.atan2(-to.x, -to.z) + this.circle * 0.75;
      this.goal = tgt.feet.add(V(Math.sin(ang), 0, Math.cos(ang)).scale(3.4));
      this.stalk = true;
      return;
    }
    this.stalk = false;
    this.goal = tgt.feet.subtract(to.normalizeToNew().scale(1.3));
  }
  private circle = 1;
  private stalk = false;
  private lungeDir = V();
  private struck = new Set<Combatant>();
  private startLunge(to: Vector3) {
    this.cd.lunge = rnd(4, 6.5) * (this.berserk ? 0.6 : 1);
    this.cd.attack = Math.max(this.cd.attack, 0.9);
    this.lungeDir.copyFrom(to).normalize();
    this.heading = Math.atan2(to.x, to.z);
    this.struck.clear();
    this.goal = null;
    this.go("lunge");
    this.host.audio.play("meleeSwing", { x: this.position.x, y: this.position.y + 1, z: this.position.z, volume: 0.9, rate: 0.6 });
    this.host.audio.play("hulkRoar", { x: this.position.x, y: this.position.y + 1.4, z: this.position.z, volume: 0.3, rate: 2.3 });
  }
  private startSpin() {
    this.cd.spin = rnd(6, 9) * (this.berserk ? 0.6 : 1);
    this.cd.attack = Math.max(this.cd.attack, 1.2);
    this.struck.clear();
    this.goal = null;
    this.spinDir = Math.random() < 0.5 ? 1 : -1;
    this.spinPass = 0;
    this.go("spin");
    this.host.audio.play("meleeSwing", { x: this.position.x, y: this.position.y + 1, z: this.position.z, volume: 0.9, rate: 0.75 });
  }
  private spinDir = 1;
  private spinPass = 0;
  private startFlurry() {
    const k = Math.floor(Math.random() * FLURRIES.length);
    const f = FLURRIES[k];
    const sp = f.speed * (this.berserk ? 1.2 : 1);
    this.attack = { k, t: 0, dur: clipDur(this.clips[f.clip]) / sp, done: 0 };
    // (after it: he backs off and circles, low, for the next opening)
    this.cd.attack = (this.attack.dur + rnd(1.3, 2.4)) * (this.berserk ? 0.65 : 1);
    this.goal = null;
    this.go("attack");
    this.host.audio.play("hulkRoar", { x: this.position.x, y: this.position.y + 1.4, z: this.position.z, volume: 0.25, rate: 2.2 });
  }
  private startPounce(tgt: Combatant) {
    this.cd.pounce = rnd(5, 8) * (this.berserk ? 0.65 : 1);
    const lead = tgt === this.host.player ? (this.host.player as unknown as { velocity?: Vector3 }).velocity ?? V() : V();
    const aim = tgt.feet.add(flat(lead).scale(0.35));
    const from = this.position;
    const T = 0.7;
    const dir = flat(aim.subtract(from));
    const L = dir.length();
    dir.scaleInPlace(1 / Math.max(1e-3, L));
    // (land just short of him: claws first into him)
    const landAt = from.add(dir.scale(Math.max(0, L - 0.8)));
    landAt.y = aim.y;
    this.pounceAt.copyFrom(landAt);
    this.v.copyFrom(landAt.subtract(from).scale(1 / T));
    this.v.y = (landAt.y - from.y) / T + 0.5 * G * T;
    this.heading = Math.atan2(dir.x, dir.z);
    this.position.y += 0.05;
    this.pounceHit = false;
    this.go("pounce");
    this.host.audio.play("meleeSwing", { x: from.x, y: from.y + 1, z: from.z, volume: 0.8, rate: 0.7 });
    this.host.audio.play("hulkRoar", { x: from.x, y: from.y + 1.4, z: from.z, volume: 0.4, rate: 2 });
  }

  private act(dt: number) {
    if (this.state === "lunge") {
      // 17 m/s for under half a second, cutting through anyone in the way
      const sp = 17 * Math.max(0, 1 - this.stateT / 0.42);
      const p = this.position;
      if (!this.stepTo(p.x + this.lungeDir.x * sp * dt, p.z + this.lungeDir.z * sp * dt)) this.stateT = 99;
      this.v.copyFrom(this.lungeDir.scale(sp));
      for (const c of this.combatants()) {
        if (this.struck.has(c) || Vector3.Distance(flat(c.feet), flat(p)) > 1.4 || Math.abs(c.feet.y - p.y) > 1.5) continue;
        this.struck.add(c);
        const you = c === this.host.player;
        c.takeDamage((you ? 9 : 18) * (this.berserk ? 1.25 : 1), p);
        c.knock(this.lungeDir.add(V(this.lungeDir.z, 0, -this.lungeDir.x).scale(Math.random() < 0.5 ? 0.6 : -0.6)).normalize().scale(4.5), 1.5);
        this.host.audio.play("knifeStab", { x: p.x, y: p.y + 1, z: p.z, volume: 1, rate: 0.9 });
        if (you) this.host.player.shake(0.2);
      }
      if (this.stateT > 0.5) {
        this.v.setAll(0);
        this.go("chase");
      }
      return;
    }
    if (this.state === "spin") {
      // two turns in three-quarters of a second; everyone in reach is cut on each pass
      this.heading += this.spinDir * dt * (Math.PI * 4) / 0.75;
      const pass = this.stateT > 0.25 && this.stateT < 0.4 ? 1 : this.stateT > 0.55 && this.stateT < 0.7 ? 2 : 0;
      if (pass && pass !== this.spinPass) {
        this.spinPass = pass;
        this.host.audio.play("knifeSlash", { x: this.position.x, y: this.position.y + 1, z: this.position.z, volume: 0.9, rate: 0.8 });
        for (const c of this.combatants()) {
          const to = flat(c.feet.subtract(this.position));
          if (to.length() > 2.7 || Math.abs(c.feet.y - this.position.y) > 1.5) continue;
          const you = c === this.host.player;
          c.takeDamage((you ? 7 : 14) * (this.berserk ? 1.25 : 1), this.position);
          if (pass === 2) c.knock(to.normalize().scale(6), 2.4);
          this.host.audio.play("fleshHit", { x: c.feet.x, y: c.feet.y + 1, z: c.feet.z, volume: 0.7 });
          if (you) this.host.player.shake(0.15);
        }
      }
      if (this.stateT > 0.78) {
        const t = this.tgt;
        if (t) this.heading = Math.atan2(t.feet.x - this.position.x, t.feet.z - this.position.z);
        this.go("chase");
      }
      return;
    }
    if (this.state === "attack" && this.attack) {
      const a = this.attack;
      const f = FLURRIES[a.k];
      a.t += dt;
      const tgt = this.tgt;
      if (tgt) this.turnTo(Math.atan2(tgt.feet.x - this.position.x, tgt.feet.z - this.position.z), dt, 8);
      // (he steps in with it)
      if (tgt && Vector3.Distance(flat(tgt.feet), flat(this.position)) > 1.4) {
        const fwd = V(Math.sin(this.heading), 0, Math.cos(this.heading));
        this.stepTo(this.position.x + fwd.x * 2.2 * dt, this.position.z + fwd.z * 2.2 * dt);
      }
      while (a.done < f.hits.length && a.t / a.dur >= f.hits[a.done]) {
        a.done++;
        this.slash(f, a.done === f.hits.length);
      }
      if (a.t >= a.dur) {
        this.attack = null;
        this.go("chase");
      }
    }
  }
  /** a claw blow: whoever's in reach in front of him */
  private slash(f: (typeof FLURRIES)[number], last: boolean) {
    const fwd = V(Math.sin(this.heading), 0, Math.cos(this.heading));
    const au = this.host.audio;
    const hand = this.rig.at(Math.random() < 0.5 ? "LeftHand" : "RightHand");
    au.play("knifeSlash", { x: hand.x, y: hand.y, z: hand.z, volume: 0.8, rate: 0.9 + Math.random() * 0.25 });
    for (const c of this.combatants()) {
      const to = flat(c.feet.subtract(this.position));
      const d = to.length();
      if (d > W.reach + 0.5 || Math.abs(c.feet.y - this.position.y) > 1.5) continue;
      if (d > 0.3 && Vector3.Dot(to.scale(1 / d), fwd) < 0.3) continue;
      const you = c === this.host.player;
      const dmg = (you ? f.dmg : f.hero) * (this.berserk ? 1.25 : 1);
      c.takeDamage(dmg, this.position);
      au.play("knifeStab", { x: hand.x, y: hand.y, z: hand.z, volume: 0.9, rate: 0.95 });
      au.play("fleshHit", { x: hand.x, y: hand.y, z: hand.z, volume: 0.6 });
      if (you) this.host.player.shake(0.12);
      // the last blow: a shove, or (now and then) a rising slash that throws them up and over
      if (last) {
        if (Math.random() < 0.35) {
          c.knock(to.normalizeToNew().scale(4), 7);
          this.host.audio.play("meleeHit", { x: hand.x, y: hand.y, z: hand.z, volume: 1, rate: 0.7 });
        } else c.knock(to.normalizeToNew().scale(5.5), 2.2);
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
    const s = (this.stalk ? 2.4 : Vector3.Distance(flat(this.goal), flat(p)) > 7 ? W.sprint : W.run) * (this.berserk ? 1.2 : 1);
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
    // (frozen solid: the pose he was caught in)
    if (this.state === "frozen") return;
    const want = this.want;
    let rate = 14;
    const speed = flat(this.v).length();
    const s = this.state;
    if (s === "intro") {
      const t = this.intro.t;
      if (t < 3.7) {
        copyPose(PERCH, want);
        // the fist that's coming up: turned out so you see the claws come
        if (t > 2.4) {
          want.d[9] = norm([0.6, -0.2, 0.75]);
          want.d[10] = norm([0.1, 0.6, 0.8]);
          want.d[11] = norm([0.05, 0.5, 0.86]);
        }
        if (t > 3.0) {
          want.d[6] = norm([-0.6, -0.2, 0.75]);
          want.d[7] = norm([-0.1, 0.6, 0.8]);
          want.d[8] = norm([-0.05, 0.5, 0.86]);
        }
        rate = 9;
      } else if (t < 5.0) {
        mixPose(PERCH, ROAR, Math.min(1, (t - 3.7) / 0.35), want);
        rate = 12;
      } else if (t < 5.9) {
        copyPose(TUCK, want);
        rate = 16;
      } else if (t < 7.2) {
        copyPose(FERAL_LAND, want);
        rate = 28;
      } else {
        mixPose(FERAL_LAND, FERAL, Math.min(1, (t - 7.2) / 0.9), want);
        rate = 8;
      }
    } else if (s === "attack" && this.attack) {
      const f = FLURRIES[this.attack.k];
      sample(this.clips[f.clip], this.attack.t * f.speed * (this.berserk ? 1.2 : 1), false, want);
      // (lower: a feral crouch under the clip's blows)
      want.hip = [want.hip[0], want.hip[1] * 0.93, want.hip[2]];
      rate = 26;
    } else if (s === "lunge") {
      // the dash: low and stretched out, both fists driven forward, claws first
      copyPose(LUNGE, want);
      rate = 30;
    } else if (s === "spin") {
      // the spin: crouched, both arms flung out to the sides, claws level
      copyPose(FERAL, want);
      want.d[6] = norm([-1, -0.05, 0.12]);
      want.d[7] = norm([-1, 0, 0.2]);
      want.d[8] = norm([-1, 0, 0.25]);
      want.d[9] = norm([1, -0.05, 0.12]);
      want.d[10] = norm([1, 0, 0.2]);
      want.d[11] = norm([1, 0, 0.25]);
      want.d[1] = norm([0.15 * this.spinDir, 0.95, 0.2]);
      rate = 30;
    } else if (s === "pounce") {
      copyPose(POUNCE, want);
      rate = 18;
    } else if (s === "air") {
      copyPose(this.flipRate ? HIT : TUCK, want);
      rate = 14;
    } else if (s === "dodge") {
      sample(this.clips.roll, this.stateT * 2, false, want);
      rate = 30;
    } else if (s === "webbed") {
      // straining against it: arms pinned, twisting
      copyPose(FERAL, want);
      const k = Math.sin(this.stateT * 14) * 0.15;
      want.d[3] = norm([k, 1, 0.2]);
      want.d[6] = norm([-0.25, -1, 0.1]);
      want.d[9] = norm([0.25, -1, 0.1]);
      rate = 18;
    } else if (s === "held") {
      copyPose(HIT, want);
      const k = Math.sin(this.stateT * 9) * 0.3;
      want.d[12] = norm([-0.2 + k * 0.3, -0.9, 0.3]);
      want.d[15] = norm([0.2 - k * 0.3, -0.9, -0.2]);
      rate = 10;
    } else if (s === "stagger") {
      copyPose(this.berserk ? ROAR : HIT, want);
      rate = 12;
    } else if (s === "getup") {
      mixPose(LANDING, FERAL, Math.min(1, this.stateT / 0.7), want);
      rate = 12;
    } else if (s === "down") {
      sample(this.clips.deathB, Math.min(clipDur(this.clips.deathB), this.stateT * 1.1), false, want);
      rate = 10;
    } else if (speed > 0.6) {
      const gait = speed < 3 ? "walk" : speed > 8 ? "sprint" : "run";
      const c = this.clips[gait];
      const cs = (gait === "walk" ? 1.25 : (c.speed ?? 4)) * (this.rig.hipH / 0.9);
      if (gait !== this.gait) {
        const from = this.clips[this.gait];
        this.runPhase = ((this.runPhase % clipDur(from)) / clipDur(from)) * clipDur(c);
        this.gait = gait;
      }
      this.runPhase += dt * (speed / cs);
      sample(c, this.runPhase, true, want);
      // a low, forward-leaning run, the claws out at his sides; circling: the crouch, side-stepping
      naturalArms(want, gait === "walk" ? 0.2 : 1, gait === "sprint" ? 0.3 : 0.2);
      if (this.stalk) {
        mixPose(want, FERAL, 0.75, want, UPPER);
        want.hip = [want.hip[0], want.hip[1] * 0.88, want.hip[2]];
      }
      want.d[1] = norm([want.d[1][0], want.d[1][1], want.d[1][2] + 0.25]);
      want.d[2] = norm([want.d[2][0], want.d[2][1], want.d[2][2] + 0.2]);
      rate = 40;
    } else {
      copyPose(FERAL, want);
      // breathing: the shoulders rise and fall, the head turns a little
      const b = Math.sin(performance.now() / 420) * 0.03;
      want.d[3] = norm([want.d[3][0], want.d[3][1] + b, want.d[3][2]]);
    }
    follow(this.shown, want, rate, dt);
    if (!this.shown.d.every((d) => isFinite(d[0] + d[1] + d[2]))) copyPose(FERAL, this.shown);
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
    // fists (the claws come out between the knuckles)
    const fist = s === "down" ? 0.3 : 0.92;
    this.gripK += (fist - this.gripK) * Math.min(1, dt * 10);
    this.rig.grip?.("l", this.gripK);
    this.rig.grip?.("r", this.gripK);
    this.solid.position.set(this.position.x, this.position.y + 0.9, this.position.z);
    this.solid.rotation.y = this.heading;
  }

  /** the claws: out of the back of each fist (between the knuckles), along the fist's line */
  private placeClaws(dt: number) {
    const cutting = this.state === "attack" || this.state === "lunge" || this.state === "spin" || this.state === "pounce";
    for (const t of this.trails) t.isVisible = cutting && this.rig.anchor.isEnabled();
    ["Left", "Right"].forEach((S, i) => {
      const c = this.claws[i];
      // (snikt: out in a tenth of a second; back in slower)
      c.out += Math.sign(c.want - c.out) * Math.min(Math.abs(c.want - c.out), dt * (c.want > c.out ? 10 : 3));
      c.root.setEnabled(c.out > 0.02 && this.rig.anchor.isEnabled());
      if (!c.root.isEnabled()) return;
      const hand = this.rig.at(S + "Hand"), mid = this.rig.at(S + "HandMiddle1");
      const idx = this.rig.at(S + "HandIndex1"), pinky = this.rig.at(S + "HandPinky1");
      const along = mid.subtract(hand).normalize();
      const across = pinky.subtract(idx);
      if (across.lengthSquared() < 1e-6) across.copyFrom(Vector3.Cross(along, V(0, 1, 0)));
      across.normalize();
      // the back of the hand: the blades come out of it, a little above the knuckle line
      const back = Vector3.Cross(across, along).normalize().scale(i === 0 ? -1 : 1);
      const knuckles = Vector3.Lerp(idx, pinky, 0.5).add(along.scale(0.03)).addInPlace(back.scale(0.012));
      c.root.position.copyFrom(knuckles);
      // blade axis (+Y) along the fist, flat side (Z) to the back of the hand
      const fwdBlade = along.add(back.scale(0.12)).normalize();
      lookRotation(back, fwdBlade, c.root.rotationQuaternion!);
      c.root.scaling.set(1, c.out, 1);
    });
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

  /** a restart: gone again (he comes back when it's his turn) */
  reset() {
    this.alive = false;
    this.go("dormant");
    this.attack = null;
    this.rig.setVisible(false);
    for (const c of this.claws) {
      c.out = c.want = 0;
      c.root.setEnabled(false);
    }
    for (const b of this.hitboxes) b.m.isPickable = false;
    this.solid.checkCollisions = false;
    this.hud.classList.remove("on", "l2");
    this.line.classList.remove("on");
    this.threatOf.clear();
    this.tgt = null;
    this.cd = { attack: 0, pounce: 3, lunge: 2, spin: 4, dodge: 0, taunt: 6, line: 3, web: 0, roar: 0 };
  }
  /** the line when Deadpool turns up */
  greetWade() {
    if (this.alive) this.say(pick(LINES.wade), 2.2);
  }
}
