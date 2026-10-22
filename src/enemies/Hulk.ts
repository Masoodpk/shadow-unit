import { AnimationGroup } from "@babylonjs/core/Animations/animationGroup";
import { AssetContainer } from "@babylonjs/core/assetContainer";
import { Color3 } from "@babylonjs/core/Maths/math.color";
import { FreeCamera } from "@babylonjs/core/Cameras/freeCamera";
import { LoadAssetContainerAsync } from "@babylonjs/core/Loading/sceneLoader";
import { Mesh } from "@babylonjs/core/Meshes/mesh";
import { MeshBuilder } from "@babylonjs/core/Meshes/meshBuilder";
import { StandardMaterial } from "@babylonjs/core/Materials/standardMaterial";
import { Node } from "@babylonjs/core/node";
import { PBRMaterial } from "@babylonjs/core/Materials/PBR/pbrMaterial";
import { Scene } from "@babylonjs/core/scene";
import { TransformNode } from "@babylonjs/core/Meshes/transformNode";
import { Vector3 } from "@babylonjs/core/Maths/math.vector";
import { AbstractMesh } from "@babylonjs/core/Meshes/abstractMesh";
import { AudioEngine } from "../audio/AudioEngine";
import { BodyZone, HitKind } from "../config/game";
import { forceWorld, worldPos } from "../core/ik";
import { NavGraph } from "../level/NavGraph";
import { MissionHud } from "../ui/MissionHud";
import { extFor } from "../weapons/ArmsRig";
import { findIn } from "./SoldierSkin";
import hulkUrl from "../assets/characters/hulk.glb?url";

/**
 * THE HULK — Red Dune's wild card ("Hulk | Marvel Rivals" by King_45, CC BY 4.0; see README for the
 * licence caveat). Halfway through the fight he comes down out of the sky in one enormous leap,
 * lands in a crater, roars, and goes for you.
 *
 * He fights like the films: he runs you down; from range he leaps at you and lands on you (a
 * shockwave that throws you); up close he punches, hooks, kicks and throws combos that knock you
 * across the ground. Bullets barely slow him — and the more you hurt him, the angrier he gets, and
 * the angrier he gets, the stronger he gets: at two-thirds and one-third health he roars and pounds
 * the ground, grows, glows, runs faster and hits harder. Beaten, he's knocked out cold.
 *
 * Moves: the model's own Marvel Rivals clips (idle, run, punches, the leap smash, the roar, stagger,
 * the fall), the user's "Jumping Down" retargeted onto his skeleton for the entrance, and a
 * thunderclap keyed by hand — all made by scripts/assets/prep-hulk.mjs. The thunderclap: his hands
 * slam together and a wall of air in front of him throws you off your feet.
 */

/** anyone he fights: you, and your allies (Spider-Man) */
export interface Combatant {
  readonly feet: Vector3;
  readonly alive: boolean;
  takeDamage(amount: number, from: Vector3): void;
  /** thrown off his back (an ally who climbed on) */
  thrown?(vel: Vector3, up: number): void;
  knock(vel: Vector3, up?: number): void;
  knockDown?(seconds: number): void;
  shake?(amount: number): void;
}

/**
 * Whoever the heroes are fighting: the Hulk, or Wolverine. Everything the allies read and do to
 * him — where he is, who he's after, his next blow, hitting him, webbing him, riding him.
 */
export interface Foe {
  readonly position: Vector3;
  readonly alive: boolean;
  readonly heading: number;
  readonly state: string;
  readonly cinematic: boolean;
  /** how big he is (the Hulk ~1.2–1.6; a man 0.75): reaches and aim points scale with it */
  readonly size: number;
  readonly target: Combatant | null;
  readonly webbedT: number;
  readonly rider: Combatant | null;
  applyHit(damage: number, zone: BodyZone, dir: Vector3, point: Vector3, info?: { kind: string; force?: number; source?: Combatant }): boolean;
  threat(): HulkThreat | null;
  web(seconds: number): boolean;
  mount(rider: Combatant): boolean;
  riderPoint(): Vector3;
  bonePos(name: "pelvis" | "spine_03" | "spine_05" | "head" | "hand_l" | "hand_r" | "foot_l" | "foot_r" | "calf_l" | "calf_r"): Vector3;
}

/** a blow on its way (allies read this to get out from under it) */
export interface HulkThreat {
  kind: "punch" | "clap" | "leap" | "smash" | "throw";
  /** where it comes from / lands, which way, how far it reaches, the half-angle of its cone (π = all round) */
  at: Vector3;
  dir: Vector3;
  radius: number;
  cone: number;
  /** seconds to impact */
  t: number;
  target: Combatant | null;
}

export interface HulkHost {
  scene: Scene;
  nav: NavGraph;
  audio: AudioEngine;
  player: {
    feet: Vector3;
    alive: boolean;
    yaw: number;
    pitch: number;
    camera: FreeCamera;
    takeDamage(amount: number, from: Vector3): void;
    knock(vel: Vector3, up?: number): void;
    knockDown(seconds: number): void;
    shake(amount: number): void;
  };
  /** where the sky is open: he comes down there, and he only ever goes where it is (never indoors) */
  openSky?: (x: number, y: number, z: number) => boolean;
  /** who else is in the fight on your side (Spider-Man, Iron Man) */
  allies?: () => Combatant[];
  /** an ally's entrance is playing: he stands and glares (no attacks) */
  holdFight?: () => boolean;
  /** dust, rubble and a crater where he lands / pounds the ground */
  slam(pos: Vector3, power: number): void;
  /** the thunderclap's blast of air: a shock ring at his hands and a wall of dust rolling forward */
  clap(pos: Vector3, dir: Vector3): void;
  /** he's down (as a foe: for good, counts as a kill; as an ally: knocked out — he gets up again) */
  onDown(): void;
  /**
   * His side (the roster's faction): "hero" makes him fight FOR you — he goes for `hostiles()`, never
   * for you or the heroes, your fire passes through him, and when he's knocked out he gets back up.
   */
  ally?: boolean;
  /** (ally) whoever's against you: the foes and the soldiers, as things he can hit */
  hostiles?: () => Combatant[];
  /** (ally) his health, for the heroes' panel */
  onHealth?(frac: number, state: string): void;
}

type State = "dormant" | "inbound" | "landing" | "roar" | "chase" | "attack" | "clap" | "leap" | "smash" | "stagger" | "webbed" | "frozen" | "taunt" | "buck" | "throw" | "down" | "rise";

interface Attack {
  clip: string;
  /** fractions of the clip where a blow lands */
  hits: number[];
  damage: number;
  /** throw (m/s along the ground, m/s up) */
  force: number;
  up: number;
  speed: number;
}

const G_HULK = 22;
const HULK = {
  health: 3400,
  /** bullets: his hide shrugs most of it off (blasts do full damage) */
  bulletFactor: 0.6,
  height: 2.75,
  /** per rage level */
  run: [5.0, 6.0, 7.2],
  mul: [1, 1.3, 1.65],
  grow: [1, 1.07, 1.14],
  reach: 3.1,
  leapMin: 9,
  leapMax: 28,
  leapCooldown: [7, 5.5, 4],
};

/** his own Marvel Rivals punches (each lands about a quarter of the way through: measured) */
const ATTACKS: Attack[] = [
  { clip: "101211_Punch_01", hits: [0.24], damage: 22, force: 6, up: 1.5, speed: 1 },
  { clip: "101211_Punch_02", hits: [0.25], damage: 24, force: 7, up: 1.8, speed: 1 },
  { clip: "101211_Punch_03", hits: [0.26], damage: 26, force: 8, up: 2, speed: 1 },
  { clip: "101211_Punch_04", hits: [0.28], damage: 32, force: 10, up: 2.8, speed: 0.95 },
];
/** the thunderclap: when the hands meet (fraction of mx_Thunderclap), its reach and cone */
const CLAP = { at: 0.43, range: 20, cone: 0.75, cooldown: [11, 8, 5.5] };
const MOOD = ["ANGRY", "ANGRIER", "HULK SMASH!"];
/** the model's own clips used */
const CLIP = {
  idle: "Idle_C",
  run: "Run_Fwd_C",
  walk: "Walk_Fwd_C",
  /** chest out, arms flexed: the roar */
  roar: "Emote_10115012021",
  leapStart: "101199_Jump_Attack_Start",
  leapFloat: "101199_Jump_Attack_Float",
  leapLand: "101199_Jump_Attack_Land",
  leapRecover: "101199_Jump_Attack_Recovery",
  stagger: "Giddiness",
  down: "Dead_F",
  entrance: "mx_JumpingDown",
};
/** the entrance clip (30 fps): airborne from frame 28 to the landing crouch at 52 */
const JUMP_AIR = [28 / 30, 52 / 30];

export class HulkModel {
  private constructor(private c: AssetContainer) {}
  static async load(scene: Scene) {
    const c = await LoadAssetContainerAsync(hulkUrl, scene, { pluginExtension: extFor(hulkUrl) });
    for (const g of c.animationGroups) g.stop();
    for (const m of c.materials)
      if (m instanceof PBRMaterial) {
        m.maxSimultaneousLights = 4;
        // (he's mostly seen against a low sun: a little more of the sky's light keeps him readable)
        m.environmentIntensity = 1.25;
      }
    return new HulkModel(c);
  }
  spawn(host: HulkHost) {
    return new Hulk(host, this.c);
  }
}

export class Hulk implements Foe, Combatant {
  // the bullet target interface (WeaponManager)
  alive = false;
  heading = 0;
  readonly position = new Vector3();
  health = HULK.health;
  readonly maxHealth = HULK.health;
  /** 0 angry → 1 angrier → 2 HULK SMASH */
  rage = 0;
  state: State = "dormant";
  /** the entrance (the player watches; the soldiers hold) */
  get cinematic() {
    return this.state === "inbound" || this.state === "landing" || (this.state === "roar" && this.intro);
  }
  readonly hud = new MissionHud();
  /** on your side (see HulkHost.ally) */
  readonly ally: boolean;
  /** (ally) with nobody to fight he stays by you: a stand-in target at your feet that can't be hurt */
  private followMe: Combatant;
  /** (ally) knocked out: seconds till he's back up */
  private downT = 0;

  private anchor: TransformNode;
  private model: TransformNode;
  private groups = new Map<string, AnimationGroup>();
  private cur: AnimationGroup | null = null;
  private curName = "";
  private clipT = 0;
  private clipDur = 1;
  private bones: Record<string, TransformNode> = {};
  private hitboxes: { m: Mesh; a: string; b: string; zone: BodyZone }[] = [];
  /** blocks the player (and his bullets don't need it: the hitboxes do that) */
  readonly solid: Mesh;
  private materials: PBRMaterial[] = [];
  private stateT = 0;
  private intro = false;
  private attack: Attack | null = null;
  private hitsDone = 0;
  /** punches left in this flurry */
  private chain = 0;
  private leapCd = 4;
  private clapCd = 6;
  private clapCheck = 0;
  private clapped = false;
  private attackCd = 0;
  private staggerCd = 0;
  private path: Vector3[] = [];
  private repath = 0;
  /** an arc in the air: from, to, height, duration */
  private arc = { from: new Vector3(), to: new Vector3(), h: 6, dur: 1, t: 0 };
  private yawOffset = 0;
  private dmgSinceStagger = 0;
  /** who he's after, and how long he sticks with them before he looks again */
  private tgt!: Combatant;
  private tgtHold = 0;
  private tgtCheck = 0;
  /** who's been hurting him (decays): he turns on whoever hurts him most */
  private threatOf = new Map<Combatant, number>();
  /** since he last came down (a landing, a ground-pound): the thunderclap waits for something else first */
  private sinceLand = 99;
  private runSinceLand = 0;
  private actedSinceLand = true;
  /** webbed: seconds left; immune for a while after (and each web holds him for less) */
  webbedT = 0;
  /** a chunk of ground he's torn up and thrown (at someone in the air): in his hand, then flying */
  private rock: Mesh;
  private rockV = new Vector3();
  private rockOn = 0; // 0 none, 1 in his hand, 2 flying
  private rockAt = new Vector3();
  private rockT = 0;
  private throwCd = 3;
  private throwAt: Combatant | null = null;
  /** someone on his back (Spider-Man), and how long before he's shaken off */
  rider: Combatant | null = null;
  private buckT = 0;
  private webImmune = 0;
  private webCount = 0;
  private webForget = 0;
  /** nav nodes under open sky (he never goes in under a roof) */
  private openNodes: Uint8Array | null = null;
  private watch = { node: -1, t: 0 };
  private tauntCd = 4;
  /** footfalls: each foot's height last frame, and whether it was coming down */
  private feetPrev = [0, 0];
  private feetDown = [false, false];
  private feetLock = [0, 0];

  constructor(private host: HulkHost, c: AssetContainer) {
    const scene = host.scene;
    this.ally = !!host.ally;
    this.followMe = { get feet() { return host.player.feet; }, alive: true, takeDamage() {}, knock() {} };
    this.tgt = this.ally ? this.followMe : host.player;
    this.anchor = new TransformNode("hulk", scene);
    const inst = c.instantiateModelsToScene((n) => `${n}#7`, false, { doNotInstantiate: true });
    this.model = inst.rootNodes[0] as TransformNode;
    this.model.parent = this.anchor;
    const all = this.model.getDescendants(false) as Node[];
    for (const m of all)
      if (m instanceof AbstractMesh) {
        m.isPickable = false;
        m.alwaysSelectAsActiveMesh = true;
        if (m.material instanceof PBRMaterial && !this.materials.includes(m.material)) this.materials.push(m.material);
      }
    for (const g of inst.animationGroups) {
      g.stop();
      for (const ta of g.targetedAnimations) {
        ta.animation.enableBlending = true;
        ta.animation.blendingSpeed = 0.1;
      }
      this.groups.set(g.name.replace(/#\d+$/, ""), g);
    }
    for (const b of ["pelvis", "spine_03", "spine_05", "head", "neck_01", "upperarm_l", "upperarm_r", "hand_l", "hand_r", "thigh_l", "thigh_r", "calf_l", "calf_r", "foot_l", "foot_r", "ball_l", "ball_r"]) {
      const t = findIn(all, b);
      if (!t) throw new Error("hulk rig: missing " + b);
      this.bones[b] = t;
    }
    // size and facing: measured on the rest pose (toes point forward)
    this.play(CLIP.idle);
    this.cur?.goToFrame(this.cur.from);
    forceWorld(this.model);
    const top = worldPos(this.bones.head).y + 0.25;
    this.model.scaling.scaleInPlace(HULK.height / Math.max(0.5, top));
    forceWorld(this.model);
    const toe = worldPos(this.bones.ball_l).subtract(worldPos(this.bones.foot_l)).add(worldPos(this.bones.ball_r).subtract(worldPos(this.bones.foot_r)));
    this.yawOffset = -Math.atan2(toe.x, toe.z);

    this.rock = MeshBuilder.CreateIcoSphere("hulkRock", { radius: 0.45, subdivisions: 1, flat: true }, scene);
    this.rock.scaling.set(1.2, 0.8, 1);
    // (the level's own rock, so it looks like a lump of the ground he tore up)
    const lvlRock = scene.getMaterialByName("rock");
    if (lvlRock) this.rock.material = lvlRock;
    else {
      const rm = new StandardMaterial("hulkRockMat", scene);
      rm.diffuseColor = new Color3(0.3, 0.25, 0.2);
      rm.specularColor = new Color3(0.03, 0.03, 0.03);
      this.rock.material = rm;
    }
    this.rock.isPickable = false;
    this.rock.setEnabled(false);
    this.solid = MeshBuilder.CreateBox("hulkSolid", { width: 1.3, height: 2.5, depth: 1.0 }, scene);
    this.solid.isVisible = false;
    this.solid.isPickable = false;
    this.solid.checkCollisions = false;
    // hitboxes along his bones: your bullets, knife, grenades and rockets find these
    const box = (a: string, b: string, w: number, d: number, zone: BodyZone) => {
      const m = MeshBuilder.CreateBox("hulkHit", { size: 1 }, scene);
      m.isVisible = false;
      m.isPickable = false;
      m.metadata = { kind: HitKind.EnemyPart, enemy: this, zone };
      m.scaling.set(w, 1, d);
      this.hitboxes.push({ m, a, b, zone });
    };
    box("pelvis", "spine_05", 1.05, 0.8, "torso");
    box("neck_01", "head", 0.5, 0.5, "head");
    box("upperarm_l", "hand_l", 0.45, 0.45, "limb");
    box("upperarm_r", "hand_r", 0.45, 0.45, "limb");
    box("thigh_l", "foot_l", 0.42, 0.42, "limb");
    box("thigh_r", "foot_r", 0.42, 0.42, "limb");
    this.anchor.setEnabled(false);
  }

  // ------------------------------------------------------------------ animation
  private play(name: string, loop = true, speed = 1) {
    const g = this.groups.get(name);
    if (!g) return;
    if (this.cur === g && loop) {
      g.speedRatio = speed;
      return;
    }
    this.cur?.stop();
    g.start(loop, speed, g.from, g.to, false);
    this.cur = g;
    this.curName = name;
    this.clipT = 0;
    const fps = g.targetedAnimations[0]?.animation.framePerSecond ?? 60;
    this.clipDur = (g.to - g.from) / fps / speed;
  }
  /** a clip from `startSec` into it, at `speed` (the entrance: its airborne part stretched over the flight) */
  private playFrom(name: string, startSec: number, speed: number) {
    const g = this.groups.get(name);
    if (!g) return;
    this.cur?.stop();
    const fps = g.targetedAnimations[0]?.animation.framePerSecond ?? 60;
    g.start(false, speed, Math.min(g.to, g.from + startSec * fps), g.to, false);
    this.cur = g;
    this.curName = name;
    this.clipT = 0;
    this.clipDur = (g.to - g.from - startSec * fps) / fps / speed;
  }
  private clipLen(name: string) {
    const g = this.groups.get(name);
    if (!g) return 1;
    return (g.to - g.from) / (g.targetedAnimations[0]?.animation.framePerSecond ?? 60);
  }

  // ------------------------------------------------------------------ in and out of the fight
  /**
   * In he comes: one huge leap from far off, out of the sky, landing 12–20 m in front of you where
   * there's open ground and sky. Returns false if there's nowhere to land.
   */
  enter() {
    const h = this.host;
    const me = h.player.feet;
    const look = h.player.camera.getDirection(Vector3.Forward());
    look.y = 0;
    look.normalize();
    const eye = me.add(new Vector3(0, 1.6, 0));
    let best: Vector3 | null = null, bestS = -Infinity;
    for (const n of h.nav.nodes) {
      const d = Math.hypot(n.p.x - me.x, n.p.z - me.z);
      if (d < 11 || d > 22 || n.links.length < 2) continue;
      if (h.openSky && !h.openSky(n.p.x, n.p.y, n.p.z)) continue;
      if (!h.nav.clear(eye, n.p.add(new Vector3(0, 1.5, 0)))) continue;
      // room to land: nothing within a metre and a half
      if ([[1.5, 0], [-1.5, 0], [0, 1.5], [0, -1.5]].some(([dx, dz]) => h.nav.embedded(n.p.x + dx, n.p.y + 1, n.p.z + dz))) continue;
      const to = n.p.subtract(me).normalize();
      const s = Vector3.Dot(to, look) * 10 - Math.abs(d - 16) * 0.3;
      if (s > bestS) (bestS = s), (best = n.p);
    }
    if (!best) return false;
    // he comes from beyond the landing spot, from high up
    const away = best.subtract(me);
    away.y = 0;
    away.normalize();
    this.arc.from = best.add(away.scale(55)).addInPlaceFromFloats(0, 30, 0);
    this.arc.to = best.clone();
    this.arc.h = 14;
    this.arc.dur = 2.3;
    this.arc.t = 0;
    this.position.copyFrom(this.arc.from);
    this.heading = Math.atan2(-away.x, -away.z);
    this.health = this.maxHealth;
    this.rage = 0;
    this.setGrow(0);
    this.alive = true;
    this.intro = true;
    this.anchor.setEnabled(true);
    for (const b of this.hitboxes) b.m.isPickable = !this.ally;
    this.go("inbound");
    // the jump's airborne frames, stretched over the whole flight
    this.playFrom(CLIP.entrance, JUMP_AIR[0], (JUMP_AIR[1] - JUMP_AIR[0]) / this.arc.dur);
    this.hud.letterbox(true, false);
    // something huge falling out of the sky: air tearing past, louder and higher as it comes
    h.audio.play("hulkIncoming", { volume: 1 });
    return true;
  }

  /** out of the round (a restart) */
  reset() {
    this.alive = false;
    this.state = "dormant";
    this.anchor.setEnabled(false);
    this.solid.checkCollisions = false;
    for (const b of this.hitboxes) b.m.isPickable = false;
    this.cur?.stop();
    this.cur = null;
    this.hud.reset();
    this.setGrow(0);
    this.threatOf.clear();
    this.tgt = this.ally ? this.followMe : this.host.player;
    this.webbedT = this.webImmune = this.webCount = 0;
    this.rider = null;
    this.rockOn = 0;
    this.rock.setEnabled(false);
  }

  private go(s: State) {
    this.state = s;
    this.stateT = 0;
  }

  // ------------------------------------------------------------------ damage (EnemyHitTarget)
  applyHit(damage: number, zone: BodyZone, _dir: Vector3, _point: Vector3, info?: { kind: string; force?: number; source?: Combatant }) {
    if (!this.alive || this.cinematic) return false;
    // (on your side: your bullets, knife and blasts pass him by)
    if (this.ally) return false;
    const bullet = !info || info.kind === "bullet";
    // (the heroes' blows are the kind that really hurt him)
    const dmg = damage * (bullet ? HULK.bulletFactor : 1) * (zone === "head" ? 1.3 : 1) * (info?.source ? 1.5 : 1);
    // every blow shows: he flashes as it lands
    this.flashT = 0.09;
    this.health = Math.max(0, this.health - dmg);
    // whoever hurts him most, he goes for (your fire, unless it says otherwise, is yours)
    const src = info?.source ?? this.host.player;
    // (the heroes up close are the ones in his face: their blows count for more of his anger)
    this.threatOf.set(src, (this.threatOf.get(src) ?? 0) + dmg * (src === this.host.player ? 1 : 1.5));
    this.lastHitBy.set(src, this.time);
    // (an ally's quick blows don't rock him; their heavy ones count)
    if (!info?.source || (info.force ?? 0) >= 2) this.dmgSinceStagger += dmg;
    if (!this.ally) this.hud.bossBar(this.health / this.maxHealth);
    if (this.health <= 0) {
      this.knockedOut();
      return true;
    }
    // (the angrier he gets: checked each frame, when he's free to roar)
    if (!bullet && this.dmgSinceStagger > 220 && this.staggerCd <= 0 && (this.state === "chase" || this.state === "attack" || this.state === "taunt")) {
      // a rocket or a grenade can still rock him back on his heels — for a moment
      this.dmgSinceStagger = 0;
      this.staggerCd = 8;
      this.play(CLIP.stagger, false, 1.6);
      this.go("stagger");
    }
    return false;
  }

  // ---- Superman: his freeze breath, and a punch that moves even the Hulk
  private frozenT = 0;
  private shoveV = new Vector3();
  private fallV = 0;
  get frozen() {
    return this.state === "frozen";
  }
  freeze(seconds: number) {
    if (!this.alive || this.cinematic || this.state === "frozen" || this.state === "leap" || this.state === "inbound") return false;
    this.frozenT = seconds;
    this.cur?.pause();
    this.attack = null;
    this.go("frozen");
    return true;
  }
  /** knocked back across the ground (he doesn't fly: he slides, and staggers) */
  launch(vel: Vector3) {
    if (!this.alive || this.cinematic || this.state === "leap" || this.state === "inbound") return;
    this.shoveV.set(vel.x, 0, vel.z).scaleInPlace(0.5);
    if (this.state === "frozen") this.cur?.play(true);
    this.play(CLIP.stagger, false, 1.3);
    this.go("stagger");
  }

  /** a blast's reach on him (grenades, rockets) */
  inBlast(pos: Vector3, radius: number) {
    return this.alive && !this.ally && Vector3.Distance(pos, worldPos(this.bones.spine_03)) < radius + 0.6;
  }

  // ---- Combatant (an ally: the foes, the jets and the soldiers' blasts hit him through this)
  get feet() {
    return this.position;
  }
  takeDamage(amount: number, from: Vector3) {
    if (!this.alive || this.cinematic || !this.ally) return;
    // (his hide: blows from the foes count, but he's built for it)
    const dmg = amount * 0.7;
    // (no hit flash on your side: under a long beating it turned him orange)
    this.health = Math.max(0, this.health - dmg);
    // whoever did it is the one he turns on (the nearest of them to where it came from)
    let src: Combatant | null = null, bd = 6;
    for (const c of this.host.hostiles?.() ?? []) {
      const d = Vector3.Distance(c.feet, from);
      if (c.alive && d < bd) (bd = d), (src = c);
    }
    if (src) {
      this.threatOf.set(src, (this.threatOf.get(src) ?? 0) + dmg * 1.5);
      this.lastHitBy.set(src, this.time);
    }
    this.dmgSinceStagger += dmg;
    if (this.health <= 0) this.knockedOut();
  }
  knock(vel: Vector3) {
    if (!this.ally || !this.alive || this.cinematic || this.state === "leap" || this.state === "inbound") return;
    // (a foe's blows barely move him: a slide; only a big one, now and then, rocks him back)
    const k = Math.hypot(vel.x, vel.z);
    this.shoveV.set(vel.x, 0, vel.z).scaleInPlace(0.3);
    if (k > 9 && this.staggerCd <= 0 && (this.state === "chase" || this.state === "attack")) {
      this.staggerCd = 6;
      this.attack = null;
      this.play(CLIP.stagger, false, 1.5);
      this.go("stagger");
    }
  }
  shake() {}

  private angrier() {
    const h = this.host;
    if (!this.ally) this.hud.bossMood(MOOD[this.rage], this.rage);
    h.audio.play("hulkRoar", { volume: 1, rate: 0.95 - this.rage * 0.04 });
    this.play(CLIP.roar, false, 1.15);
    this.go("smash");
  }

  private knockedOut() {
    const h = this.host;
    if (this.rider) {
      const r = this.rider;
      this.rider = null;
      r.thrown?.(new Vector3(-Math.sin(this.heading) * 4, 0, -Math.cos(this.heading) * 4), 4);
    }
    this.alive = false;
    for (const b of this.hitboxes) b.m.isPickable = false;
    this.solid.checkCollisions = false;
    this.play(CLIP.down, false, 1);
    this.go("down");
    this.fallV = 0;
    h.audio.play("hulkSlam", { x: this.position.x, y: this.position.y, z: this.position.z, volume: 0.7 });
    if (!this.ally) this.hud.bossMood("DOWN", 0);
    // (on your side he's only knocked out: he's back up in a while)
    this.downT = 14;
    h.onDown();
  }

  private flashT = 0;
  private flashOn = false;
  /** a material's resting glow (his rage) */
  private glowFor(m: PBRMaterial) {
    const g = this.rage === 0 ? 0 : this.rage === 1 ? 0.35 : 1;
    return /Eyes/.test(m.name) ? new Color3(0.25 * g, 1.0 * g, 0.2 * g) : new Color3(0.01 * g, 0.045 * g, 0.005 * g);
  }
  /** he grows and glows with his anger */
  private setGrow(level: number) {
    const k = HULK.grow[level];
    this.anchor.scaling.setAll(k);
    for (const m of this.materials) {
      const eyes = /Eyes/.test(m.name);
      const g = level === 0 ? 0 : level === 1 ? 0.35 : 1;
      m.emissiveColor = eyes ? new Color3(0.25 * g, 1.0 * g, 0.2 * g) : new Color3(0.01 * g, 0.045 * g, 0.005 * g);
    }
  }

  // ------------------------------------------------------------------ frame
  update(dt: number) {
    if (this.state === "dormant") return;
    const h = this.host;
    this.stateT += dt;
    this.clipT += dt;
    this.leapCd -= dt;
    this.clapCd -= dt;
    this.attackCd -= dt;
    this.staggerCd -= dt;
    this.sinceLand += dt;
    this.time += dt;
    this.webImmune -= dt;
    this.tauntCd -= dt;
    this.reach.t -= dt;
    // (he forgets the webs once he's been free a while)
    if (this.webCount > 0 && (this.webForget -= dt) <= 0) {
      this.webCount--;
      this.webForget = 15;
    }
    for (const [c, v] of this.threatOf) this.threatOf.set(c, v * Math.exp(-dt / 7));
    if (this.alive && !this.cinematic) this.pickTarget(dt);
    const me = this.tgt.feet;
    const to = me.subtract(this.position);
    to.y = 0;
    const dist = to.length();
    const want = Math.atan2(to.x, to.z);

    // the angrier he gets… (the madder he gets, the stronger he gets)
    const level = this.health < this.maxHealth / 3 ? 2 : this.health < (this.maxHealth * 2) / 3 ? 1 : 0;
    if (this.alive && level > this.rage && (this.state === "chase" || this.state === "attack" || this.state === "stagger")) {
      this.rage = level;
      this.angrier();
    }

    // an ally's entrance: he stops where he is and glares (he'll be at you in a moment)
    const held = this.alive && !this.cinematic && !!h.holdFight?.() && (this.state === "chase" || this.state === "taunt");
    if (held) {
      this.play(CLIP.idle);
      this.turn(want, dt, 3);
    } else switch (this.state) {
      case "inbound": {
        // the leap in: he's airborne for the middle of Jumping Down, stretched over the flight
        const a = this.arc;
        a.t += dt;
        const f = Math.min(1, a.t / a.dur);
        this.flight(f);
        this.lookAtMe(dt, 3);
        if (f >= 1) {
          this.land(1.4, 0);
          // the landing crouch and the rise, at full speed
          this.playFrom(CLIP.entrance, JUMP_AIR[1], 1);
          this.go("landing");
        }
        break;
      }
      case "landing":
        this.lookAtMe(dt, 4);
        if (this.stateT > this.clipLen(CLIP.entrance) - JUMP_AIR[1] - 0.15) {
          this.hud.card("HULK", this.ally ? "The strongest one there is — and he's with you" : "The strongest one there is", 3);
          h.audio.play("hulkRoar", { x: this.position.x, y: this.position.y + 2, z: this.position.z, volume: 1 });
          h.player.shake(0.5);
          this.play(CLIP.roar, false, 1);
          this.go("roar");
        }
        break;
      case "roar":
        this.lookAtMe(dt, 4);
        if (this.intro) this.turn(want, dt, 3);
        if (this.stateT > Math.min(this.clipDur, 2.8)) {
          if (this.intro) this.endIntro();
          this.go("chase");
        }
        break;
      case "smash":
        // the roar — then he pounds the ground: everything near him is thrown
        this.turn(want, dt, 4);
        if (this.stateT > Math.min(this.clipDur, 2.4)) {
          this.setGrow(this.rage);
          this.land(1.2 + this.rage * 0.2, 7 + this.rage);
          this.go("chase");
        }
        break;
      case "stagger":
        if (this.stateT > Math.min(this.clipDur, 1.4)) this.go("chase");
        break;
      case "frozen":
        // iced over (Superman's breath): still as a statue — and then he simply breaks it
        this.frozenT -= dt;
        if (this.frozenT <= 0) {
          this.cur?.play(true);
          h.audio.play("iceShatter", { x: this.position.x, y: this.position.y + 1.5, z: this.position.z, volume: 1.2, rate: 0.8 });
          h.audio.play("hulkRoar", { x: this.position.x, y: this.position.y + 2, z: this.position.z, volume: 1 });
          h.player.shake(0.25);
          this.attackCd = 0.2;
          this.go("chase");
        }
        break;
      case "webbed":
        // webbed up: he strains against it (his stagger, slowed), then tears free
        this.webbedT -= dt;
        if (this.webbedT <= 0) {
          this.attackCd = Math.max(this.attackCd, 0.3);
          this.go("chase");
        }
        break;
      case "buck": {
        // someone on his back: he roars, twists and claws at them — then throws them off
        this.heading += Math.sin(this.stateT * 5.5) * dt * 2.6;
        if (this.stateT > this.buckT || !this.rider?.alive) this.throwRider();
        break;
      }
      case "throw":
        this.throwing(dt, want);
        break;
      case "taunt":
        // you're inside where he won't go: he roars at the doorway
        this.turn(want, dt, 3);
        if (this.stateT > Math.min(this.clipDur, 2.6)) this.go("chase");
        break;
      case "chase":
        this.chase(dt, dist, want);
        break;
      case "attack":
        this.melee(dt, dist, want);
        break;
      case "clap":
        this.clapping(dt, want);
        break;
      case "leap":
        this.leaping(dt);
        break;
      case "down": {
        // (knocked out mid-leap, or up on something: he falls, and hits the ground hard)
        const fy = h.nav.floorAt(this.position.x, this.position.y + 0.5, this.position.z, 400) ?? 0;
        if (fy !== null && this.position.y > fy + 0.01) {
          this.fallV += G_HULK * dt;
          this.position.y = Math.max(fy, this.position.y - this.fallV * dt);
          if (this.position.y <= fy + 0.01) {
            h.slam(this.position.clone(), 1.2);
            h.audio.play("hulkSlam", { x: this.position.x, y: this.position.y, z: this.position.z, volume: 1 });
            h.player.shake(0.4);
            this.fallV = 0;
          }
        } else if (this.ally && (this.downT -= dt) <= 0) {
          // the Hulk doesn't stay down: up, half his strength back, and a roar
          this.health = this.maxHealth * 0.5;
          this.rage = Math.max(this.rage, 1);
          this.setGrow(this.rage);
          this.alive = true;
          this.solid.checkCollisions = true;
          this.threatOf.clear();
          this.tgt = this.followMe;
          this.play(CLIP.roar, false, 1.1);
          h.audio.play("hulkRoar", { x: this.position.x, y: this.position.y + 2, z: this.position.z, volume: 1 });
          this.go("rise");
        }
        break;
      }
      case "rise":
        this.turn(want, dt, 3);
        if (this.stateT > Math.min(this.clipDur, 2.4)) this.go("chase");
        break;
    }
    if (this.rockOn === 2) this.rockFlight(dt);
    // shoved (a blow even he gives ground to): sliding back over the ground, digging in
    if (this.shoveV.lengthSquared() > 0.01) {
      const nx = this.position.x + this.shoveV.x * dt, nz = this.position.z + this.shoveV.z * dt;
      const fy = h.nav.floorAt(nx, this.position.y + 0.6, nz, 1.2);
      if (fy !== null && !h.nav.embedded(nx, fy + 1.2, nz)) {
        this.position.x = nx;
        this.position.z = nz;
        this.position.y = fy;
      } else this.shoveV.setAll(0);
      this.shoveV.scaleInPlace(Math.exp(-4 * dt));
      if (Math.random() < dt * 12) h.slam(this.position.clone(), 0.12);
    }
    // the hit flash (a red-hot tint over his skin for a moment)
    if (this.flashT > 0 || this.flashOn) {
      this.flashT -= dt;
      const on = this.flashT > 0;
      if (on !== this.flashOn) {
        this.flashOn = on;
        for (const m of this.materials) if (!/Eyes/.test(m.name)) m.emissiveColor = on ? new Color3(0.32, 0.05, 0.02) : this.glowFor(m);
      }
    }
    this.anchor.position.copyFrom(this.position);
    this.anchor.rotation.y = this.heading + this.yawOffset;
    this.solid.position.set(this.position.x, this.position.y + 1.25, this.position.z);
    this.solid.rotation.y = this.heading;
    this.placeHitboxes();
    if (this.ally) h.onHealth?.(this.health / this.maxHealth, this.state);
    else if (this.alive && !this.cinematic) this.hud.bossBar(this.health / this.maxHealth);
    this.hud.update(dt, null, h.player.camera, h.scene);
  }

  /** the player's view follows him in (the entrance) */
  private lookAtMe(dt: number, k: number) {
    const cam = this.host.player.camera;
    const at = this.position.add(new Vector3(0, 1.8 * this.anchor.scaling.y, 0)).subtract(cam.position);
    const yaw = Math.atan2(at.x, at.z), pitch = -Math.atan2(at.y, Math.hypot(at.x, at.z));
    let dy = yaw - cam.rotation.y;
    dy = Math.atan2(Math.sin(dy), Math.cos(dy));
    const a = 1 - Math.exp(-k * dt);
    cam.rotation.y += dy * a;
    cam.rotation.x += (pitch - cam.rotation.x) * a;
    cam.rotation.z = 0;
  }

  private endIntro() {
    const h = this.host;
    this.intro = false;
    this.hud.letterbox(false, false);
    // you keep looking where the entrance left you
    h.player.yaw = h.player.camera.rotation.y;
    h.player.pitch = h.player.camera.rotation.x;
    if (!this.ally) {
      this.hud.bossShow("HULK");
      this.hud.bossMood(MOOD[0], 0);
    }
    this.solid.checkCollisions = true;
    this.leapCd = 3;
    // (no thunderclap the moment he's done roaring: he has to get stuck in first)
    this.clapCd = Math.max(this.clapCd, 6);
  }

  /** along the arc (f 0..1) */
  private flight(f: number) {
    const a = this.arc;
    Vector3.LerpToRef(a.from, a.to, f, this.position);
    this.position.y += Math.sin(f * Math.PI) * a.h;
  }

  /** touchdown: crater, dust, rubble — and anyone close is hit and thrown */
  private land(power: number, damage: number) {
    const h = this.host;
    const p = this.position;
    h.slam(p.clone(), power);
    h.audio.play("hulkSlam", { x: p.x, y: p.y, z: p.z, volume: 1 });
    h.player.shake(Math.max(0.15, Math.min(1, power * (1 - Vector3.Distance(h.player.feet, p) / 30))));
    // the thunderclap waits: he's only just come down
    this.sinceLand = 0;
    this.runSinceLand = 0;
    this.actedSinceLand = false;
    this.clapCd = Math.max(this.clapCd, 3);
    const R = 6.5 * power;
    if (damage <= 0) return;
    for (const c of this.combatants()) {
      const me = c.feet;
      const d = Vector3.Distance(me, p);
      if (d >= R || !c.alive || Math.abs(me.y - p.y) >= 2.5) continue;
      const k = 1 - d / R;
      const out = me.subtract(p);
      out.y = 0;
      if (out.lengthSquared() < 1e-4) out.set(Math.sin(this.heading), 0, Math.cos(this.heading));
      out.normalize();
      c.takeDamage(damage * (0.4 + 0.6 * k) * HULK.mul[this.rage], p);
      c.knock(out.scale(6 * k + 2), 3 * k + 1.2);
    }
  }

  /**
   * Spider-Man jumps on his back. He takes it (and the punches to the head) for a few seconds,
   * thrashing, then reaches back and hurls him off. Not mid-leap, mid-clap or mid-roar.
   */
  mount(rider: Combatant) {
    if (!this.alive || this.cinematic || this.rider) return false;
    if (!(this.state === "chase" || this.state === "attack" || this.state === "webbed" || this.state === "taunt")) return false;
    this.rider = rider;
    this.buckT = 2.4 + Math.random() * 1.4 - this.rage * 0.4;
    this.webbedT = 0;
    this.play(CLIP.stagger, true, 1.5);
    this.host.audio.play("hulkRoar", { x: this.position.x, y: this.position.y + 2, z: this.position.z, volume: 0.85, rate: 1.1 });
    this.go("buck");
    return true;
  }
  private throwRider() {
    const r = this.rider;
    this.rider = null;
    if (r?.alive) {
      // over his shoulder and away
      const side = Math.random() < 0.5 ? 1 : -1;
      const out = new Vector3(Math.sin(this.heading) + Math.cos(this.heading) * side * 0.6, 0, Math.cos(this.heading) - Math.sin(this.heading) * side * 0.6).normalize();
      r.takeDamage(16 * HULK.mul[this.rage], this.position);
      if (r.thrown) r.thrown(out.scale(10), 7);
      else r.knock(out.scale(10), 7);
      this.host.audio.play("meleeSwing", { x: this.position.x, y: this.position.y + 2, z: this.position.z, volume: 1, rate: 0.55 });
    }
    this.attackCd = 0.4;
    this.go("chase");
  }
  /** where a rider holds on: high on his back, between the shoulders */
  riderPoint() {
    const up = worldPos(this.bones.spine_05);
    const back = new Vector3(-Math.sin(this.heading), 0, -Math.cos(this.heading));
    return up.addInPlace(back.scale(0.45 * this.anchor.scaling.x)).addInPlaceFromFloats(0, 0.05, 0);
  }

  /** you, and whoever's fighting with you */
  private combatants(): Combatant[] {
    // (on your side: only ever the ones against you)
    if (this.ally) return (this.host.hostiles?.() ?? []).filter((c) => c.alive);
    const a = this.host.allies?.() ?? [];
    return a.length ? [this.host.player, ...a] : [this.host.player];
  }

  /**
   * Who he goes for: whoever's hurt him most lately, nearer is better, someone he can see and get
   * at (out in the open) much better. He sticks with a choice for a few seconds before he looks again.
   */
  private pickTarget(dt: number) {
    this.tgtHold -= dt;
    this.tgtCheck -= dt;
    this.onTgtT += dt;
    this.lastOn.set(this.tgt, this.time);
    if (this.rider && this.tgt !== this.rider) this.tgt = this.rider;
    if (this.tgt.alive && this.tgt !== this.followMe && (this.tgtHold > 0 || this.tgtCheck > 0)) return;
    if (this.tgt === this.followMe && this.tgtCheck > 0) return;
    this.tgtCheck = 0.5;
    const nav = this.host.nav;
    const eye = this.position.add(new Vector3(0, 2, 0));
    let best = this.tgt.alive ? this.tgt : this.ally ? this.followMe : this.tgt, bestS = -Infinity;
    // (an ally with nobody near enough to fight stays by you)
    if (this.ally) bestS = -40;
    for (const c of this.combatants()) {
      if (!c.alive) continue;
      const f = c.feet;
      const d = Math.hypot(f.x - this.position.x, f.z - this.position.z);
      // whoever's hurt him lately (it fades, and only counts so far), whoever just hit him, whoever's
      // in his face; he sticks with a fight a while — then gets restless and turns on someone else
      let sc = Math.min(10, (this.threatOf.get(c) ?? 0) * 0.15) - d * 0.4;
      if (d < 4) sc += 7;
      // (a blow from close counts; shots from across the yard less)
      if (this.time - (this.lastHitBy.get(c) ?? -99) < 3) sc += d < 8 ? 7 : 2;
      if (nav.clear(eye, f.add(new Vector3(0, 1.2, 0)))) sc += 4;
      if (!this.openAt(f.x, f.y, f.z)) sc -= 25;
      // (someone hovering well out of reach is hard to hit: less tempting, not ignored)
      if (f.y - this.position.y > 2.5 && d > 5) sc -= 5;
      if (c === this.tgt) sc += this.onTgtT < 7 ? 6 : -9;
      // (you're the one he came for)
      if (c === this.host.player) sc += 2;
      // (on your side: the big ones first, and nobody across the map)
      if (this.ally) sc += ("state" in c ? 8 : 0) - Math.max(0, d - 45);
      // everyone gets their turn: the longer he's left someone alone, the more they're on his mind
      sc += Math.min(12, (this.time - (this.lastOn.get(c) ?? this.time - 4)) * 0.55);
      if (sc > bestS) (bestS = sc), (best = c);
    }
    if (this.ally && bestS <= -40) best = this.followMe;
    if (best !== this.tgt) {
      this.lastOn.set(this.tgt, this.time);
      this.tgt = best;
      this.onTgtT = 0;
      this.path = [];
      this.repath = 0;
    }
    this.tgtHold = 3;
  }
  private onTgtT = 0;
  private time = 0;
  private lastHitBy = new Map<Combatant, number>();
  /** when he last had each of them in his sights */
  private lastOn = new Map<Combatant, number>();
  private swatted = false;

  /** who he's after */
  get target() {
    return this.tgt;
  }

  // ------------------------------------------------------------------ open ground only
  /**
   * Out in the open (where he may go): not inside a room or a shed — under a roof AND walled in
   * most of the way round. (A catwalk or a pipe overhead isn't "inside": he runs under those.)
   */
  private openAt(x: number, y: number, z: number) {
    const f = this.host.openSky;
    if (!f) return true;
    const key = Math.round(x * 2) * 100003 + Math.round(z * 2) * 7 + Math.round(y);
    let v = this.openCache.get(key);
    if (v === undefined) {
      v = true;
      if (!f(x, y, z)) {
        const nav = this.host.nav;
        let walls = 0;
        // (eight ways round: a corridor open at both ends is still walled in on six; each way is
        // felt below the window sills and at chest height — a shed's window isn't a way out)
        for (let k = 0; k < 8; k++) {
          const a = (k * Math.PI) / 4;
          const dx = Math.sin(a) * 14, dz = Math.cos(a) * 14;
          if (nav.moveRay(new Vector3(x, y + 0.5, z), new Vector3(x + dx, y + 0.5, z + dz), false) >= 0 || nav.moveRay(new Vector3(x, y + 1.2, z), new Vector3(x + dx, y + 1.2, z + dz), false) >= 0) walls++;
        }
        v = walls < 5;
      }
      this.openCache.set(key, v);
    }
    return v;
  }
  private openCache = new Map<number, boolean>();
  private nodeOpen(i: number) {
    if (!this.openNodes) {
      const nodes = this.host.nav.nodes;
      this.openNodes = new Uint8Array(nodes.length);
      nodes.forEach((n, k) => (this.openNodes![k] = this.openAt(n.p.x, n.p.y, n.p.z) ? 1 : 0));
    }
    return this.openNodes[i] === 1;
  }
  /** a link he can run along: open sky all the way (not under a catwalk or through a shed) */
  private linkOpen(a: number, b: number) {
    const key = a < b ? a * 65536 + b : b * 65536 + a;
    let v = this.openLinks.get(key);
    if (v === undefined) {
      const p = this.host.nav.nodes[a].p, q = this.host.nav.nodes[b].p;
      const n = Math.max(1, Math.ceil(Vector3.Distance(p, q) / 1.5));
      v = true;
      for (let i = 1; i < n && v; i++) {
        const f = i / n;
        v = this.openAt(p.x + (q.x - p.x) * f, p.y + (q.y - p.y) * f, p.z + (q.z - p.z) * f);
      }
      this.openLinks.set(key, v);
    }
    return v;
  }
  private openLinks = new Map<number, boolean>();
  /** the open nodes he can reach from `start` over open links (cached a moment) */
  private reachable(start: number) {
    const r = this.reach;
    if (r.start === start && r.t > 0 && r.set) return r.set;
    const nodes = this.host.nav.nodes;
    const set = new Uint8Array(nodes.length);
    const q = [start];
    set[start] = 1;
    while (q.length) {
      const c = q.pop()!;
      for (const nb of nodes[c].links) if (!set[nb] && this.nodeOpen(nb) && this.linkOpen(c, nb)) (set[nb] = 1), q.push(nb);
    }
    this.reach = { start, t: 3, set };
    return set;
  }
  private reach: { start: number; t: number; set: Uint8Array | null } = { start: -1, t: 0, set: null };

  /**
   * The open node nearest `p`: one with a clear run to it (`reach`: where he starts a path from), or
   * one that can see it (`see`: where he waits for you outside).
   */
  private nearestOpen(p: Vector3, see = false, reach = false, within: Uint8Array | null = null) {
    const nav = this.host.nav;
    let best = -1, bestS = Infinity;
    for (const n of nav.nodes) {
      if (!this.nodeOpen(n.id) || (within && !within[n.id])) continue;
      let sc = Math.hypot(n.p.x - p.x, n.p.z - p.z) + Math.abs(n.p.y - p.y) * 4;
      if (sc > bestS) continue;
      if (see && !nav.clear(n.p.add(new Vector3(0, 1.6, 0)), p.add(new Vector3(0, 1.2, 0)))) sc += 8;
      if (reach && nav.moveRay(p.add(new Vector3(0, 0.5, 0)), n.p.add(new Vector3(0, 0.5, 0))) >= 0) sc += 12;
      if (sc < bestS) (bestS = sc), (best = n.id);
    }
    return best;
  }

  // ------------------------------------------------------------------ allies' view of him
  /** the blow he's winding up, if any (where, how far, how soon) */
  threat(): HulkThreat | null {
    if (!this.alive) return null;
    if (this.rockOn === 2 && this.state !== "throw")
      return { kind: "throw", at: this.rockAt.clone(), dir: this.rockV.normalizeToNew(), radius: 1.9, cone: Math.PI, t: Math.max(0, this.rockT), target: this.throwAt };
    const fwd = new Vector3(Math.sin(this.heading), 0, Math.cos(this.heading));
    const k = this.anchor.scaling.x;
    switch (this.state) {
      case "attack": {
        const a = this.attack!;
        const f = this.clipT / this.clipDur;
        const next = a.hits[this.hitsDone];
        if (next === undefined) return null;
        return { kind: "punch", at: this.position.clone(), dir: fwd, radius: HULK.reach * 1.25 * k, cone: 1.25, t: Math.max(0, (next - f) * this.clipDur), target: this.tgt };
      }
      case "clap": {
        if (this.clapped) return null;
        const f = this.clipT / this.clipDur;
        return { kind: "clap", at: this.position.clone(), dir: fwd, radius: CLAP.range, cone: CLAP.cone, t: Math.max(0, (CLAP.at - f) * this.clipDur), target: this.tgt };
      }
      case "leap":
        if (this.curName !== CLIP.leapFloat && this.arc.t > 0) return null;
        return { kind: "leap", at: this.arc.to.clone(), dir: fwd, radius: 6.5, cone: Math.PI, t: Math.max(0, this.arc.dur - this.arc.t), target: this.tgt };
      case "throw":
        if (this.rockOn !== 2) return null;
        return { kind: "throw", at: this.rockAt.clone(), dir: this.rockV.normalizeToNew(), radius: 1.9, cone: Math.PI, t: Math.max(0, this.rockT), target: this.throwAt };
      case "smash":
        return { kind: "smash", at: this.position.clone(), dir: fwd, radius: 6.5 * (1.2 + this.rage * 0.2), cone: Math.PI, t: Math.max(0, Math.min(this.clipDur, 2.4) - this.stateT), target: this.tgt };
    }
    return null;
  }

  /**
   * Webbed (Spider-Man): held for a moment — less each time, and not again for a while. Mid-leap,
   * mid-clap or mid-roar it doesn't take. Returns whether it held.
   */
  web(seconds: number) {
    if (!this.alive || this.cinematic || this.webImmune > 0) return false;
    if (!(this.state === "chase" || this.state === "attack" || this.state === "taunt")) return false;
    // (each web in quick succession holds him for less)
    const t = seconds / (1 + this.webCount * 0.6);
    this.webCount++;
    this.webbedT = Math.max(0.35, t);
    this.webImmune = 6 + this.webbedT;
    this.webForget = 15;
    this.play(CLIP.stagger, false, 0.9);
    this.go("webbed");
    return true;
  }

  // ------------------------------------------------------------------ the fight
  private chase(dt: number, dist: number, want: number) {
    const h = this.host;
    const nav = h.nav;
    const me = this.tgt.feet.clone();
    // (on your side with nobody to fight: he walks with you, a few metres off — no swings, no leaps)
    const following = this.tgt === this.followMe;
    if (following && dist < 7) {
      this.play(CLIP.idle);
      this.turn(want, dt, 3);
      return;
    }
    // close enough: hit him
    if (!following && dist < HULK.reach && this.attackCd <= 0 && Math.abs(me.y - this.position.y) < 2.2) return this.startAttack();
    // the thunderclap: never straight after he's come down — only once he's been at it a while
    // (run at you, thrown a punch), and only in front of him, a little way off
    this.clapCheck -= dt;
    const clapReady = this.sinceLand > 2.5 && this.actedSinceLand;
    if (!following && clapReady && this.clapCd <= 0 && this.clapCheck <= 0 && dist > 5 && dist < CLAP.range * 0.8) {
      this.clapCheck = 0.8;
      const facing = Math.abs(Math.atan2(Math.sin(want - this.heading), Math.cos(want - this.heading))) < 0.45;
      if (facing && Math.random() < 0.45 + this.rage * 0.15 && nav.clear(this.position.add(new Vector3(0, 1.6, 0)), me.add(new Vector3(0, 1.4, 0)))) return this.startClap();
    }
    // he never goes in under a roof: if you're inside, he makes for the open ground nearest you
    const inside = !this.openAt(me.x, me.y, me.z);
    let goalNode = -1;
    if (inside) {
      this.watch.t -= dt;
      if (this.watch.t <= 0 || this.watch.node < 0) {
        this.watch.t = 0.8;
        // (only somewhere he can actually get to over open ground)
        const from = this.nearestOpen(this.position, false, true);
        this.watch.node = this.nearestOpen(me, true, false, from >= 0 ? this.reachable(from) : null);
      }
      goalNode = this.watch.node;
    }
    // far off, and nothing over the way: leap (only ever onto open ground)
    // someone up in the air out of his reach, a way off: he tears up the ground and throws it at them
    this.throwCd -= dt;
    if (!following && !inside && this.throwCd <= 0 && me.y - this.position.y > 2 && dist > 5 && dist < 26 && this.rockOn === 0 && nav.clear(this.position.add(new Vector3(0, 2, 0)), me.add(new Vector3(0, 1, 0))))
      return this.startThrow();
    // (someone hovering overhead, out of reach: he jumps up at them)
    const overhead = me.y - this.position.y > 2.4 && dist < 9;
    if (!inside && this.leapCd <= 0 && (following ? dist > 26 : dist > HULK.leapMin || overhead) && dist < (following ? 60 : HULK.leapMax)) {
      if (this.canLeap(me)) return this.startLeap(me);
      this.leapCd = 0.5; // (no clear arc: look again in a moment, not every frame)
    }
    // run: straight at him when the way is clear, else along the nav graph (open nodes only)
    const eye = this.position.add(new Vector3(0, 1.2, 0));
    const direct = !inside && nav.moveRay(eye, me.add(new Vector3(0, 1.0, 0))) < 0 && nav.moveRay(this.position.add(new Vector3(0, 0.5, 0)), me.add(new Vector3(0, 0.5, 0))) < 0;
    let target = inside ? (goalNode >= 0 ? nav.nodes[goalNode].p : this.position) : me;
    if (!direct) {
      this.repath -= dt;
      if (this.repath <= 0 || !this.path.length) {
        this.repath = 0.6;
        const goal = inside ? goalNode : this.nearestOpen(me);
        const start = this.nearestOpen(this.position, false, true);
        this.path = nav.path(start, goal, (i) => this.nodeOpen(i), (a, b) => this.linkOpen(a, b));
        // (the path leaves out where it starts: if he can't run straight to its first node, he goes to
        // the start node first — and never doubles back for it when he can)
        const knee = new Vector3(0, 0.5, 0);
        const first = this.path[0];
        if (start >= 0 && (!first || nav.moveRay(this.position.add(knee), first.add(knee)) >= 0) && Math.hypot(nav.nodes[start].p.x - this.position.x, nav.nodes[start].p.z - this.position.z) > 1)
          this.path.unshift(nav.nodes[start].p);
      }
      while (this.path.length && Math.hypot(this.path[0].x - this.position.x, this.path[0].z - this.position.z) < 0.8) this.path.shift();
      if (this.path.length) target = this.path[0];
      else if (!inside) target = me;
    } else this.path = [];
    const wp = goalNode >= 0 ? nav.nodes[goalNode].p : this.position;
    const atWatch = inside && Math.hypot(wp.x - this.position.x, wp.z - this.position.z) < 1.5;
    if ((!following && dist < HULK.reach * 0.9) || atWatch) {
      // in range, waiting for his arm — or at the doorway you're hiding behind: stand and glare
      this.play(CLIP.idle);
      this.turn(want, dt, 6);
      if (atWatch && this.tauntCd <= 0) {
        // …and now and then roar at you
        this.tauntCd = 7 + Math.random() * 4;
        h.audio.play("hulkRoar", { x: this.position.x, y: this.position.y + 2, z: this.position.z, volume: 0.8, rate: 1.05 });
        this.play(CLIP.roar, false, 1.25);
        this.go("taunt");
      }
      return;
    }
    const step = target.subtract(this.position);
    step.y = 0;
    const L = step.length();
    if (L < 1e-3) return;
    const speed = HULK.run[this.rage] * (this.webbedT > 0 ? 0.35 : 1);
    this.turn(Math.atan2(step.x, step.z), dt, 5);
    // he runs where he's facing (wide turns, like something that heavy)
    const fwd = new Vector3(Math.sin(this.heading), 0, Math.cos(this.heading));
    const move = fwd.scale(Math.min(L, speed * dt));
    const next = this.position.add(move);
    // (a step up is a step, not a climb: anything higher than his knee is a wall; he drops off edges)
    const stepTo = (nx: number, nz: number) => {
      const fy = nav.floorAt(nx, this.position.y + 0.6, nz, 4);
      if (fy === null || fy >= this.position.y + 0.65 || nav.embedded(nx, this.position.y + 0.5, nz) || nav.embedded(nx, fy + 1.0, nz) || !this.openAt(nx, fy, nz)) return false;
      this.position.set(nx, this.position.y + (fy - this.position.y) * Math.min(1, dt * 12), nz);
      return true;
    };
    if (!stepTo(next.x, next.z)) {
      // blocked: slide along it (the way that's nearer where he's going), and think again
      const m = move.length();
      let slid = false;
      for (const a of [0.7, -0.7, 1.4, -1.4]) {
        const h2 = this.heading + a * Math.sign(Math.sin(Math.atan2(step.x, step.z) - this.heading) || 1);
        if (stepTo(this.position.x + Math.sin(h2) * m, this.position.z + Math.cos(h2) * m)) {
          slid = true;
          break;
        }
      }
      if (!slid || this.repath > 0.3) this.repath = Math.min(this.repath, 0.3);
      if (!slid) this.path = [];
    }
    this.play(CLIP.run, true, speed / 5.5);
    this.runSinceLand += dt;
    if (this.runSinceLand > 1.5) this.actedSinceLand = true;
    this.footfalls(dt, 1);
  }

  /**
   * The ground feels it: a heavy thud each time a foot comes down (its lowest point in the stride),
   * the recorded footfall layered over a sub-bass thump, and the camera trembles if you're close.
   */
  private footfalls(dt: number, volume: number) {
    const h = this.host;
    const k = this.anchor.scaling.y;
    (["foot_l", "foot_r"] as const).forEach((b, i) => {
      this.feetLock[i] -= dt;
      const y = (worldPos(this.bones[b]).y - this.position.y) / k;
      const down = y < this.feetPrev[i] - 1e-4;
      // it was coming down and now it isn't, low to the ground: that's the foot landing
      if (this.feetDown[i] && !down && y < 0.3 && this.feetLock[i] <= 0) {
        this.feetLock[i] = 0.2;
        const p = worldPos(this.bones[b]);
        h.audio.play("hulkThud", { x: p.x, y: p.y, z: p.z, volume: 1.0 * volume, rate: 0.9 - this.rage * 0.04, pitchVar: 0.06 });
        h.audio.play("hulkStep", { x: p.x, y: p.y, z: p.z, volume: 0.55 * volume });
        const d = Vector3.Distance(h.player.feet, this.position);
        if (d < 16) h.player.shake(0.07 * (1 - d / 16) * (1 + this.rage * 0.3));
      }
      this.feetDown[i] = down;
      this.feetPrev[i] = y;
    });
  }

  private turn(yaw: number, dt: number, rate: number) {
    let d = yaw - this.heading;
    d = Math.atan2(Math.sin(d), Math.cos(d));
    this.heading += Math.sign(d) * Math.min(Math.abs(d), rate * dt);
  }

  private startAttack() {
    // angrier: the heavy hits come more often
    const pick = this.rage === 0 ? [0, 0, 1, 2, 3] : this.rage === 1 ? [0, 1, 1, 2, 3, 3] : [1, 1, 2, 3, 3, 3];
    this.attack = ATTACKS[pick[Math.floor(Math.random() * pick.length)]];
    this.chain = [0, 1, 2][this.rage] + (Math.random() < 0.4 ? 1 : 0);
    this.hitsDone = 0;
    this.actedSinceLand = true;
    this.play(this.attack.clip, false, this.attack.speed * (1 + this.rage * 0.12));
    this.go("attack");
  }

  private melee(dt: number, _dist: number, want: number) {
    const h = this.host;
    const a = this.attack!;
    const f = this.clipT / this.clipDur;
    // he tracks you through the wind-up, then commits
    if (f < (a.hits[this.hitsDone] ?? 1) - 0.08) this.turn(want, dt, 3.5);
    while (this.hitsDone < a.hits.length && f >= a.hits[this.hitsDone]) {
      this.hitsDone++;
      h.audio.play("meleeSwing", { x: this.position.x, y: this.position.y + 1.5, z: this.position.z, volume: 0.9, rate: 0.6 });
      // the blow lands on whoever's in front of him and in reach (you, or your ally)
      for (const c of this.combatants()) {
        const me = c.feet;
        const to = me.subtract(this.position);
        to.y = 0;
        const d = to.length();
        const ang = Math.abs(Math.atan2(Math.sin(Math.atan2(to.x, to.z) - this.heading), Math.cos(Math.atan2(to.x, to.z) - this.heading)));
        if (!c.alive || d >= HULK.reach * 1.25 * this.anchor.scaling.x || ang >= 1.25 || Math.abs(me.y - this.position.y) >= 2.2) continue;
        const m = HULK.mul[this.rage];
        c.takeDamage(a.damage * m, this.position);
        c.knock(to.normalize().scale(a.force * (0.8 + 0.2 * m)), a.up);
        c.shake?.(0.35 + 0.1 * this.rage);
        h.audio.play("hulkPunch", { x: me.x, y: me.y + 1.2, z: me.z, volume: 0.9 });
      }
    }
    // a flurry: still in reach, he follows one punch straight into another (more often when angrier)
    const me = this.tgt.feet;
    if (f >= 0.62 && this.chain > 0 && Vector3.Distance(me, this.position) < HULK.reach * 1.1 && this.tgt.alive) {
      this.chain--;
      this.attack = ATTACKS[(ATTACKS.indexOf(a) + 1 + Math.floor(Math.random() * 3)) % ATTACKS.length];
      this.hitsDone = 0;
      this.play(this.attack.clip, false, this.attack.speed * (1 + this.rage * 0.12));
      return;
    }
    if (f >= 1) {
      this.attackCd = [0.9, 0.6, 0.35][this.rage];
      this.go("chase");
    }
  }

  // ------------------------------------------------------------------ the throw
  private startThrow() {
    this.throwCd = 4.5 + Math.random() * 3 - this.rage;
    this.throwAt = this.tgt;
    this.rockOn = 1;
    this.actedSinceLand = true;
    this.play(ATTACKS[3].clip, false, 0.75);
    this.go("throw");
  }
  private throwing(dt: number, want: number) {
    const h = this.host;
    const f = this.clipT / this.clipDur;
    if (f < 0.3) this.turn(want, dt, 4);
    const hand = worldPos(this.bones.hand_r);
    if (this.rockOn === 1) {
      // torn up out of the ground (a burst of dust as he grabs it), then in his fist
      if (this.stateT < dt * 1.5) h.slam(this.position.add(new Vector3(Math.sin(this.heading) * 0.8, 0, Math.cos(this.heading) * 0.8)), 0.35);
      this.rock.setEnabled(true);
      this.rock.position.copyFrom(hand);
      if (f >= 0.27) {
        // let fly — leading them a little, on an arc that gets there
        const tgt = this.throwAt ?? this.tgt;
        const aim = tgt.feet.add(new Vector3(0, 1, 0));
        const T = Math.max(0.45, Vector3.Distance(hand, aim) / 26);
        this.rockAt.copyFrom(aim);
        this.rockV.copyFrom(aim.subtract(hand).scaleInPlace(1 / T));
        this.rockV.y += 0.5 * 14 * T;
        this.rockT = T;
        this.rockOn = 2;
        h.audio.play("meleeSwing", { x: hand.x, y: hand.y, z: hand.z, volume: 1, rate: 0.5 });
      }
    }
    if (f >= 1) this.go("chase");
  }
  private rockFlight(dt: number) {
    const h = this.host;
    const prev = this.rock.position.clone();
    this.rockV.y -= 14 * dt;
    this.rock.position.addInPlace(this.rockV.scale(dt));
    this.rock.rotation.x += dt * 7;
    this.rock.rotation.z += dt * 5;
    this.rockT -= dt;
    const p = this.rock.position;
    const smash = () => {
      this.rockOn = 0;
      this.rock.setEnabled(false);
      h.slam(p.clone(), 0.3);
      h.audio.play("hulkSlam", { x: p.x, y: p.y, z: p.z, volume: 0.55, rate: 1.4 });
    };
    for (const c of this.combatants()) {
      if (!c.alive) continue;
      const body = c.feet.add(new Vector3(0, 1, 0));
      if (Vector3.Distance(body, p) < 1.25) {
        c.takeDamage(30 * HULK.mul[this.rage], this.position);
        c.knock(this.rockV.normalizeToNew().scale(9), 3);
        h.audio.play("hulkPunch", { x: p.x, y: p.y, z: p.z, volume: 1 });
        return smash();
      }
    }
    if (h.nav.moveHit(prev, p, 1) || p.y < -5 || this.rockT < -2) smash();
  }

  // ------------------------------------------------------------------ the thunderclap
  private startClap() {
    this.clapCd = CLAP.cooldown[this.rage];
    this.clapped = false;
    this.play("mx_Thunderclap", false, 1 + this.rage * 0.1);
    this.go("clap");
  }

  private clapping(dt: number, want: number) {
    const h = this.host;
    const f = this.clipT / this.clipDur;
    if (f < CLAP.at - 0.05) this.turn(want, dt, 3);
    if (!this.clapped && f >= CLAP.at) {
      this.clapped = true;
      const fwd = new Vector3(Math.sin(this.heading), 0, Math.cos(this.heading));
      const at = this.position.add(fwd.scale(1.4 * this.anchor.scaling.x)).addInPlaceFromFloats(0, 1.7 * this.anchor.scaling.y, 0);
      h.audio.play("hulkClap", { x: at.x, y: at.y, z: at.z, volume: 1 });
      h.clap(at, fwd);
      h.player.shake(Math.max(0.2, 1 - Vector3.Distance(h.player.feet, this.position) / 40));
      // the wall of air: in front of him and in range, it picks you up and throws you down
      for (const c of this.combatants()) {
        const me = c.feet;
        const to = me.subtract(this.position);
        to.y = 0;
        const d = to.length();
        const ang = Math.abs(Math.atan2(Math.sin(Math.atan2(to.x, to.z) - this.heading), Math.cos(Math.atan2(to.x, to.z) - this.heading)));
        if (!c.alive || d >= CLAP.range || ang >= CLAP.cone || Math.abs(me.y - this.position.y) >= 3 || !h.nav.clear(at, me.add(new Vector3(0, 1.2, 0)))) continue;
        const k = 1 - d / CLAP.range;
        c.takeDamage((6 + 20 * k) * HULK.mul[this.rage], this.position);
        c.knockDown?.(1.3 + 1.0 * k);
        c.knock(to.normalize().scale(10 + 12 * k), 4 + 3 * k);
      }
    }
    if (f >= 1) this.go("chase");
  }

  /** a clear arc from him to `to`: open overhead and nothing in the way at mid-height */
  private canLeap(to: Vector3) {
    const nav = this.host.nav;
    const from = this.position;
    for (let i = 1; i < 8; i++) {
      const f = i / 8;
      const p = Vector3.Lerp(from, to, f);
      p.y += Math.sin(f * Math.PI) * 7 + 1.2;
      const q = Vector3.Lerp(from, to, (i - 1) / 8);
      q.y += Math.sin(((i - 1) / 8) * Math.PI) * 7 + 1.2;
      if (!nav.clear(q, p)) return false;
    }
    return true;
  }

  private startLeap(target: Vector3) {
    const d = Vector3.Distance(target, this.position);
    // he lands just short of you — on top of you if you stand still
    const to = target.subtract(this.position);
    to.y = 0;
    to.normalize();
    // (catching up with you, on your side: he comes down a few metres off, not on you)
    const land = target.subtract(to.scale(this.tgt === this.followMe ? 6 : 1.2));
    const fy = this.host.nav.floorAt(land.x, land.y + 1, land.z, 30);
    if (fy === null || !this.openAt(land.x, fy, land.z)) {
      this.leapCd = 1;
      return;
    }
    land.y = fy;
    this.arc.from = this.position.clone();
    this.arc.to = land;
    this.arc.h = 5 + d * 0.18;
    this.arc.dur = 0.7 + d * 0.03;
    this.arc.t = -0.35; // (the crouch before the spring)
    this.heading = Math.atan2(to.x, to.z);
    this.leapCd = HULK.leapCooldown[this.rage];
    this.swatted = false;
    this.play(CLIP.leapStart, false, 1.3);
    this.host.audio.play("hulkLeap", { x: this.position.x, y: this.position.y + 2, z: this.position.z, volume: 1 });
    this.go("leap");
  }

  private leaping(dt: number) {
    const a = this.arc;
    a.t += dt;
    if (a.t < 0) return;
    if (a.t < a.dur) {
      this.play(CLIP.leapFloat);
      this.flight(a.t / a.dur);
      // anyone in the air in his way gets swatted out of it (once a leap)
      if (!this.swatted) {
        const chest = this.position.add(new Vector3(0, 1.6 * this.anchor.scaling.y, 0));
        for (const c of this.combatants()) {
          if (!c.alive) continue;
          const fy = this.host.nav.floorAt(c.feet.x, c.feet.y, c.feet.z, 30) ?? this.position.y;
          if (c.feet.y - fy < 1.5) continue;
          if (Vector3.Distance(c.feet.add(new Vector3(0, 1, 0)), chest) < 2.4 * this.anchor.scaling.x) {
            this.swatted = true;
            const out = c.feet.subtract(this.position);
            out.y = 0;
            out.normalize();
            c.takeDamage(28 * HULK.mul[this.rage], this.position);
            c.knock(out.scale(12), 3);
            this.host.audio.play("hulkPunch", { x: chest.x, y: chest.y, z: chest.z, volume: 1 });
            break;
          }
        }
      }
      return;
    }
    if (this.curName === CLIP.leapFloat) {
      this.position.copyFrom(a.to);
      this.play(CLIP.leapLand, false, 1.2);
      this.land(1, 40 + this.rage * 8);
    }
    if (this.curName === CLIP.leapLand && this.clipT >= this.clipDur) this.play(CLIP.leapRecover, false, 1.5);
    if (this.curName === CLIP.leapRecover && this.clipT >= this.clipDur * 0.6) this.go("chase");
  }

  // ------------------------------------------------------------------ hitboxes
  private placeHitboxes() {
    for (const hb of this.hitboxes) {
      const a = worldPos(this.bones[hb.a]), b = worldPos(this.bones[hb.b]);
      const mid = a.add(b).scale(0.5);
      const ab = b.subtract(a);
      const L = ab.length();
      hb.m.position.copyFrom(mid);
      hb.m.scaling.y = Math.max(0.3, L + 0.25);
      // stand the box along the bone
      const yaw = Math.atan2(ab.x, ab.z);
      const pitch = Math.acos(Math.max(-1, Math.min(1, ab.y / Math.max(1e-4, L))));
      hb.m.rotation.set(pitch, yaw, 0);
    }
  }

  /** the bones the minimap / HUD might want (his head) */
  headPos() {
    return worldPos(this.bones.head);
  }
  /** a bone's world position (allies: where webs pin him, where a blow lands) */
  bonePos(name: "pelvis" | "spine_03" | "spine_05" | "head" | "hand_l" | "hand_r" | "foot_l" | "foot_r" | "calf_l" | "calf_r") {
    return worldPos(this.bones[name]);
  }
  /** his size now (he grows with his rage) */
  get size() {
    return this.anchor.scaling.x;
  }
}
