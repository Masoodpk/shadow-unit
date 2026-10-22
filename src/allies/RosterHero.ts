import { Color3 } from "@babylonjs/core/Maths/math.color";
import { FreeCamera } from "@babylonjs/core/Cameras/freeCamera";
import { Matrix, Quaternion, Vector3 } from "@babylonjs/core/Maths/math.vector";
import { PBRMaterial } from "@babylonjs/core/Materials/PBR/pbrMaterial";
import { Scene } from "@babylonjs/core/scene";
import { TransformNode } from "@babylonjs/core/Meshes/transformNode";
import { AudioEngine } from "../audio/AudioEngine";
import { worldPos } from "../core/ik";
import { lookRotation } from "../core/math";
import type { Combatant, Foe, HulkThreat } from "../enemies/Hulk";
import type { AirUnit } from "../enemies/Air";
import type { Bolts, Lightning } from "../fx/HeroFx";
import type { ShockRing, SpriteStream } from "../fx/SuperFx";
import { NavGraph } from "../level/NavGraph";
import { AbilityBook } from "../characters/abilities";
import { Brain } from "../characters/brain";
import type { CineActor, CineShot } from "../characters/cinematics";
import type { CharacterDef } from "../characters/roster";
import { AUTO, SkinnedModel, SkinnedRig, type RigNames } from "./HeroRig";
import { sideOf } from "../characters/factions";
import type { Dir } from "./SpiderRig";
import { HIT, LANDING, P, RELAXED, STANCE, TUCK, aimArm, clipDur, copyPose, follow, loadSpiderClips, mixPose, naturalArms, newPose, sample, type ClipName, type DirClip, type Pose } from "./SpiderPoses";
import type { SoldierLike } from "./SpiderMan";
import type { TeamBoard } from "./Team";

/**
 * A ROSTER HERO — one shared fighter for the Phase-2 allies (Thor, Captain America, Captain Marvel,
 * Star-Lord, Drax, Rocket, the Flash). Everything they have in common lives here, once:
 *
 *  - the body: the model through the hero rig (AUTO bone names), posed by bone directions from the
 *    shared motion-capture clips (run, sprint, punches, kicks, rolls) and the kit's own poses;
 *  - getting about: on foot over the nav graph (steering, vaulting what's low, sub-stepped so the
 *    Flash can't run through a wall), or flying (Captain Marvel);
 *  - the fight: a Brain (the Phase-1 state machine and its watchdog) deciding, an AbilityBook (the
 *    roster's abilities and cooldowns) choosing the move, and the kit's moves performing it —
 *    against the foes (Wolverine, Batman), the soldiers, and for some, the aircraft;
 *  - staying out of trouble: reading the foe's wind-up (its `threat`) and getting out of the way;
 *  - taking it: hurt, knocked flying, knocked out — under gravity from any height, down a while,
 *    then back up (they're your side's permanent members);
 *  - the entrance: a CineActor, so the director films it, with the kit's own staging and camera.
 *
 * The kit (allies/kits.ts) supplies what makes each one themselves: poses, moves, effects, lines,
 * the landing, the entrance. The roster supplies the numbers.
 */

export interface RosterHost {
  scene: Scene;
  nav: NavGraph;
  audio: AudioEngine;
  player: { feet: Vector3; alive: boolean; yaw: number; camera: FreeCamera; shake(a: number): void };
  /** the foe this hero takes on (the Game's foeFor), or null */
  foe: (me: RosterHero) => Foe | null;
  soldiers: () => Soldier[];
  air: () => AirUnit[];
  team: TeamBoard;
  /** everyone on your side who's up (Cap's rally reads it) */
  heroes: () => Combatant[];
  bolts: Bolts;
  lightning: Lightning;
  rings: ShockRing;
  /** additive glow sprites (energy, sparks) and alpha smoke */
  glow: SpriteStream;
  smoke: SpriteStream;
  dust(pos: Vector3, power: number): void;
  slam(pos: Vector3, power: number): void;
  spark(pos: Vector3, normal: Vector3): void;
  /** an explosion on your side's terms: it hurts the soldiers, the foes and the aircraft — never you or the heroes */
  blast(pos: Vector3, radius: number, damage: number): void;
  bounds: { minX: number; maxX: number; minZ: number; maxZ: number };
  /** (villains) whom he may fight: you and the heroes (and, for an independent, whoever his side is hostile to) */
  targets?: (me: RosterHero) => Combatant[];
  /** (the finale) a big title card on screen */
  card?(title: string, subtitle: string, secs: number): void;
  /** (the finale) the sky darkening: 0 the stage's own light, 1 a storm */
  sky?(k: number): void;
}
export type Soldier = SoldierLike & { readonly dormant?: boolean; held?: boolean };

/** whom a move is aimed at: (heroes) a foe, a soldier, an aircraft; (villains) you or a hero */
export type Tgt = { foe: Foe } | { soldier: Soldier } | { air: AirUnit } | { hero: Combatant };

export interface Act {
  id: string;
  t: number;
  dur: number;
  tgt: Tgt | null;
  phase: number;
  /** blows / shots done */
  n: number;
  /** move-specific */
  data: Record<string, unknown>;
  /** the move performing it (when it isn't one of the kit's by id: a boss phase, a stun) */
  move?: Move;
}

/** a move: the kit's performance of an ability (or of a dodge, a landing…) */
export interface Move {
  /** set the action up (duration, data); return false to refuse after all */
  start(h: RosterHero, a: Act): boolean | void;
  /** each frame; return true when it's over (also over at a.t >= a.dur) */
  frame(h: RosterHero, a: Act, dt: number): boolean | void;
  /** the body: write `want`; return the follow rate */
  pose(h: RosterHero, a: Act, want: Pose, dt: number): number;
  /** moving under its own power (a dash, a ram): the mover leaves him be */
  moves?: boolean;
  /** usable on aircraft */
  vsAir?: boolean;
  /** usable on soldiers (default true) */
  vsSoldier?: boolean;
  /** works in the air (flyers) */
  airborne?: boolean;
  /** (villains) the blow on its way, for the heroes to get out from under it */
  threat?(h: RosterHero, a: Act): HulkThreat | null;
}

export interface Entrance {
  dur: number;
  /** stage it (place him, the props); false: nowhere to do it now */
  begin(h: RosterHero): boolean;
  frame(h: RosterHero, t: number, dt: number): void;
  pose(h: RosterHero, t: number, want: Pose, dt: number): number;
  shot(h: RosterHero, t: number): CineShot | null;
}

export interface Kit {
  id: string;
  color: string;
  label: string;
  /** pace on foot (m/s) */
  run: number;
  sprint: number;
  flyer?: boolean;
  /** moves faster than the eye: sub-stepped, a blur trail */
  speedster?: boolean;
  /** the order he prefers his abilities in (ids from the roster), and the range he likes to fight at */
  prefer: string[];
  holdRange: number;
  stance: Pose;
  idle?: Pose;
  /** his own landing (each hero comes down differently) */
  landing: Pose;
  moves: Record<string, Move>;
  /** getting out of the way of a blow (default: a roll) */
  dodge?: Move;
  entrance: Entrance;
  lines: { intro?: string; hit: string[]; down: string[]; up: string[]; victory: string[]; fight: string[] };
  tune?(m: PBRMaterial): void;
  /** (villains) the hero he has a score to settle with (roster id) — he goes for them first */
  rival?: string;
  /** his own walk cycle (a clip of the model's own, by name) instead of the shared one */
  walkClip?: string;
  /** (villains) his defeat, filmed: the director shoots it like an entrance */
  outro?: { dur: number; frame?(h: RosterHero, t: number, dt: number): void; pose(h: RosterHero, t: number, want: Pose, dt: number): number; shot(h: RosterHero, t: number): CineShot | null };
  /** (villains) when his health crosses one of the roster's boss phases: the move he makes of it */
  phaseMove?: Move;
  /** his own way of walking (a dragon's four legs, a giant's tread): the body while moving on the ground; returns the follow rate */
  gait?(h: RosterHero, speed: number, dt: number, want: Pose): number;
  /** a giant (Godzilla): walks over the level's props instead of round them, turns slowly */
  giant?: boolean;
  /** his own bone names (a rig AUTO can't read — Toothless's dragon bones); default AUTO */
  rig?: RigNames;
  /** the props: attach, hide, make (called once the rig exists) */
  setup?(h: RosterHero): void | Promise<void>;
  /** per frame, after the pose (props in hand, glows) */
  after?(h: RosterHero, dt: number): void;
}

const G = 20;
export const V = (x = 0, y = 0, z = 0) => new Vector3(x, y, z);
export const flat = (v: Vector3) => new Vector3(v.x, 0, v.z);
export const rnd = (a: number, b: number) => a + Math.random() * (b - a);
export const pick = <T,>(a: T[]) => a[Math.floor(Math.random() * a.length)];
export const angDiff = (a: number, b: number) => Math.atan2(Math.sin(a - b), Math.cos(a - b));
export const normD = (d: Dir): Dir => {
  const l = Math.hypot(d[0], d[1], d[2]) || 1;
  return [d[0] / l, d[1] / l, d[2] / l];
};

export class RosterModel {
  private constructor(readonly body: SkinnedModel) {}
  static async load(scene: Scene, def: CharacterDef, kit: Kit) {
    const body = await SkinnedModel.load(scene, def.model!, def.height, (m) => {
      m.maxSimultaneousLights = 4;
      m.environmentIntensity = 1.15;
      kit.tune?.(m);
    }, kit.rig ?? AUTO);
    return new RosterModel(body);
  }
}

export class RosterHero implements Combatant, CineActor {
  readonly rig: SkinnedRig;
  readonly brain: Brain;
  readonly book: AbilityBook;
  readonly p = V();
  readonly v = V();
  yaw = 0;
  /** body tilt in flight (radians forward) and roll */
  pitch = 0;
  roll = 0;
  health: number;
  /** (a villain's is scaled to the team he walks into) */
  maxHealth: number;
  mode: "ground" | "air" | "fly" | "ko" = "ground";
  action: Act | null = null;
  clips!: Record<ClipName, DirClip>;
  /** the model's own clips (Darkseid's attacks), by name */
  own: Record<string, DirClip> = {};
  /** which side he fights for (the roster's faction: a villain or an independent is against you) */
  readonly side: "hero" | "villain";
  enabled = false;
  /** a buff: incoming damage scaled by this (Cap's block, Marvel's Binary mode) */
  guard = 1;
  /** a buff: outgoing damage scaled by this */
  power = 1;
  /** the target he's fighting right now */
  tgt: Tgt | null = null;
  readonly shown: Pose = copyPose(STANCE, newPose());
  readonly want: Pose = newPose();
  readonly q = new Quaternion();
  /** the entrance clock (−1: not in it) */
  introT = -1;
  /** a word on screen */
  private line: HTMLDivElement;
  private lineT = 0;
  private quipCd = 4;
  private goal: Vector3 | null = null;
  private pace: "walk" | "run" | "sprint" = "run";
  private path: Vector3[] = [];
  private repath = 0;
  private stillT = 0;
  protected thinkT = 0;
  protected koT = 0;
  private stepT = 0;
  private runPhase = 0;
  private gait: ClipName = "run";
  protected sinceHurt = 9;
  /** heals a little when left alone a while (the heroes; not the villains) */
  regen = true;
  private dodgeCd = 0;
  private reaction = -1;
  private pendingThreat: HulkThreat | null = null;
  private tumble = 0;
  /** where round the target he fights from (radians off the line from it to him): spread by who he is, so they don't stack */
  private flank = 0;
  /** the last frame's fly velocity (for the body's lean) */
  private flyV = V();
  /** a soldier he gave up on (can't get at him) */
  private gaveUp = new Map<Soldier, number>();
  private huntT = 0;
  private huntOf: Soldier | null = null;
  time = 0;

  constructor(
    readonly host: RosterHost,
    readonly def: CharacterDef,
    readonly kit: Kit,
    model: RosterModel,
  ) {
    // (the faction table's call: Venom is built on either side from the same kit)
    this.side = sideOf(def.id, def.faction) === "hero" ? "hero" : "villain";
    this.own = model.body.clips;
    this.rig = model.body.spawn("ros_" + def.id);
    this.rig.setVisible(false);
    this.brain = new Brain(def.id);
    this.book = new AbilityBook(def.abilities);
    this.health = this.maxHealth = def.stats.health;
    const hash = [...def.id].reduce((a, c) => (a * 31 + c.charCodeAt(0)) % 997, 7);
    this.flank = ((hash % 7) - 3) * 0.5;
    this.line = document.createElement("div");
    this.line.className = "hero-line";
    this.line.style.borderLeftColor = kit.color;
    // (one column for all their lines: two heroes talking at once stack, never overlap)
    let col = document.getElementById("hero-lines");
    if (!col) {
      col = document.createElement("div");
      col.id = "hero-lines";
      document.getElementById("hud")?.appendChild(col);
    }
    col.appendChild(this.line);
  }
  static async create(host: RosterHost, def: CharacterDef, kit: Kit, model: RosterModel) {
    const h = new RosterHero(host, def, kit, model);
    h.clips = await loadSpiderClips();
    await kit.setup?.(h);
    return h;
  }

  // ------------------------------------------------------------------ Combatant / CineActor
  get feet() {
    return this.p;
  }
  get alive() {
    return this.enabled && this.mode !== "ko" && this.introT < 0;
  }
  get active() {
    return this.enabled;
  }
  /** a moment of the fight the director films (Godzilla's first atomic breaths): seconds in, how long, the shot */
  film: { t: number; dur: number; shot: (h: RosterHero, t: number) => CineShot | null } | null = null;
  get cinematic() {
    return this.enabled && (this.introT >= 0 || (!!this.film && this.film.t < this.film.dur));
  }
  /** for the minimap / HUD */
  get state(): string {
    return !this.enabled ? "hidden" : this.mode === "ko" ? "down" : this.brain.state;
  }
  get position() {
    return this.p;
  }
  cineShot() {
    if (this.introT >= 0) return this.kit.entrance.shot(this, this.introT);
    return this.film && this.film.t < this.film.dur ? this.film.shot(this, this.film.t) : null;
  }
  cineFocus() {
    return this.center();
  }
  skip() {
    if (this.introT < 0) return;
    // (straight to the end of it: wherever it would have left him)
    const E = this.kit.entrance;
    for (let t = this.introT; t < E.dur; t += 0.1) E.frame(this, t, 0.1);
    this.endIntro();
  }
  takeDamage(amount: number, _from: Vector3) {
    if (!this.alive) return;
    const dmg = amount * (1 - this.def.stats.armor * 0.6) * this.guard;
    this.health = Math.max(0, this.health - dmg);
    this.sinceHurt = 0;
    this.host.audio.play("fleshHit", { x: this.p.x, y: this.p.y + 1.2, z: this.p.z, volume: 0.6 });
    if (Math.random() < 0.25) this.quip(this.kit.lines.hit);
    if (this.health <= 0) this.knockOut();
  }
  knock(vel: Vector3, up = 0) {
    if (!this.alive || this.guard < 0.5) return;
    // (the sturdy ones barely move)
    const k = 1 - this.def.stats.staggerResist * 0.75;
    if (Math.hypot(vel.x, vel.z) * k < 2.5 && up * k < 2) return;
    this.endAction();
    this.v.copyFrom(vel).scaleInPlace(0.85 * k);
    this.v.y = Math.max(this.v.y, (up + 1.5) * k);
    this.mode = "air";
    this.p.y += 0.05;
    this.tumble = 1;
    this.brain.go("recover", "knocked");
  }
  knockDown(seconds: number) {
    this.koT = Math.max(this.koT, 0);
    void seconds;
  }

  // ------------------------------------------------------------------ words
  say(text: string, secs = 2.6) {
    if (!text) return;
    this.line.innerHTML = `<b style="color:${this.kit.color}">${this.def.name}</b> ${text}`;
    this.line.classList.add("on");
    this.lineT = secs;
    this.quipCd = 10 + Math.random() * 8;
  }
  quip(set: string[], chance = 1) {
    if (this.quipCd > 0 || !set.length || Math.random() > chance) return;
    this.say(pick(set));
  }

  // ------------------------------------------------------------------ in and out
  /** the entrance (the director films it); false: nowhere to stage it right now */
  enter() {
    if (this.enabled) return false;
    this.health = this.maxHealth;
    this.mode = this.kit.flyer ? "fly" : "ground";
    this.v.setAll(0);
    this.action = null;
    this.book.reset();
    this.guard = this.power = 1;
    if (!this.kit.entrance.begin(this)) return false;
    this.enabled = true;
    this.introT = 0;
    this.brain.go("cinematic", "entrance");
    this.rig.setVisible(true);
    return true;
  }
  private endIntro() {
    this.introT = -1;
    this.brain.go("select", "in");
    if (this.kit.lines.intro && !this.lineT) this.say(this.kit.lines.intro, 2.6);
  }
  reset() {
    this.enabled = false;
    this.introT = -1;
    this.rig.setVisible(false);
    this.line.classList.remove("on");
    this.action = null;
    this.tgt = null;
    this.mode = "ground";
    this.guard = this.power = 1;
    this.brain.go("idle", "reset");
  }

  // ------------------------------------------------------------------ geometry
  center() {
    return this.p.add(V(0, this.def.height * 0.55, 0));
  }
  fwd() {
    return V(Math.sin(this.yaw), 0, Math.cos(this.yaw));
  }
  right() {
    return V(Math.cos(this.yaw), 0, -Math.sin(this.yaw));
  }
  hand(side: "l" | "r") {
    // (as of the last render: a frame old at most — cheap, and it's asked for often)
    return this.rig.atCached(side === "l" ? "LeftHand" : "RightHand");
  }
  /** a point on the target to aim at / hit */
  aimOf(t: Tgt): Vector3 {
    if ("hero" in t) return t.hero.feet.add(V(0, "size" in t.hero ? 1.8 : 1.2, 0));
    if ("foe" in t) return t.foe.position.add(V(0, 1.45 * Math.max(0.7, t.foe.size), 0));
    if ("air" in t) return t.air.position.clone();
    return t.soldier.position.add(V(0, 0.35, 0));
  }
  tgtAlive(t: Tgt | null) {
    if (!t) return false;
    if ("hero" in t) return t.hero.alive;
    if ("foe" in t) return t.foe.alive && t.foe.state !== "dormant" && !t.foe.cinematic;
    if ("air" in t) return t.air.alive;
    return t.soldier.alive && !t.soldier.dormant;
  }
  tgtGround(t: Tgt) {
    if ("hero" in t) return t.hero.feet.clone();
    if ("foe" in t) return t.foe.position.clone();
    if ("air" in t) return t.air.position.clone();
    return t.soldier.position.subtract(V(0, 0.9, 0));
  }
  sizeOf(t: Tgt | null) {
    if (t && "hero" in t) return "size" in t.hero ? (t.hero as unknown as { size: number }).size : 0.75;
    return t && "foe" in t ? t.foe.size : 0.75;
  }
  /** turn the body's frame onto a world direction (for aimArm) */
  toBody(w: Vector3): Dir {
    const b = w.normalizeToNew().applyRotationQuaternion(Quaternion.Inverse(this.q));
    return [b.x, b.y, b.z];
  }
  faceTo(p: Vector3) {
    this.yaw = Math.atan2(p.x - this.p.x, p.z - this.p.z);
  }
  turnTo(yaw: number, dt: number, rate: number) {
    const d = angDiff(yaw, this.yaw);
    this.yaw += Math.sign(d) * Math.min(Math.abs(d), rate * dt);
  }
  sees(p: Vector3) {
    return this.host.nav.clear(this.center(), p);
  }

  /**
   * A blow (or a shot) landing on a target: damage scaled by his power; `launch` throws a soldier's
   * body (he dies of it) and shoves a foe; aircraft take it as a blast.
   */
  hit(t: Tgt, damage: number, dir: Vector3, opts: { force?: number; launch?: number; up?: number; kind?: "melee" | "bullet" | "blast" } = {}) {
    const dmg = damage * this.power;
    const point = this.aimOf(t);
    const d = dir.normalizeToNew();
    if ("hero" in t) {
      // (a villain's blow on you or a hero: the hurt, and a throw if it's a big one)
      t.hero.takeDamage(dmg, this.p);
      if (opts.launch) t.hero.knock(flat(d).normalize().scale(opts.launch * 0.6), (opts.up ?? 3) * 0.7);
      t.hero.shake?.(Math.min(0.5, dmg / 120));
      return;
    }
    if ("foe" in t) {
      t.foe.applyHit(dmg, "torso", d, point, { kind: opts.kind === "bullet" ? "melee" : (opts.kind ?? "melee"), force: opts.force ?? 1, source: this });
      if (opts.launch) (t.foe as Foe & { launch?(v: Vector3): void }).launch?.(flat(d).normalize().scale(opts.launch).addInPlaceFromFloats(0, opts.up ?? 3, 0));
    } else if ("air" in t) t.air.applyHit(dmg, "torso", d, point, { kind: "blast", source: this });
    else {
      const info: Record<string, unknown> = { kind: opts.kind === "blast" ? "melee" : (opts.kind ?? "melee"), force: opts.force ?? 1 };
      if (opts.launch) info.launch = flat(d).normalize().scale(opts.launch).addInPlaceFromFloats(0, opts.up ?? 4, 0);
      t.soldier.applyHit(dmg, "torso", d, point, info as { kind: "melee" });
    }
  }
  /** everything hostile within `r` of `at` (soldiers and foes; aircraft too if `air`) */
  around(at: Vector3, r: number, air = false): Tgt[] {
    const out: Tgt[] = [];
    if (this.side === "villain") {
      for (const c of this.host.targets?.(this) ?? []) if (c.alive && Vector3.Distance(c.feet, at) < r + ("size" in c ? 1 : 0.4)) out.push({ hero: c });
      return out;
    }
    const f = this.host.foe(this);
    for (const x of this.foesAll()) if (this.tgtAlive({ foe: x }) && Vector3.Distance(x.position, at) < r + 0.6 * x.size) out.push({ foe: x });
    void f;
    for (const s of this.host.soldiers()) if (s.alive && !s.dormant && Vector3.Distance(s.position, at) < r) out.push({ soldier: s });
    if (air) for (const u of this.host.air()) if (u.alive && Vector3.Distance(u.position, at) < r + u.hitR) out.push({ air: u });
    return out;
  }
  private foesAll(): Foe[] {
    const f = this.host.foe(this);
    return f ? [f] : [];
  }

  // ------------------------------------------------------------------ actions
  /** start a move (an ability's id, or a kit move like "dodge") */
  begin(id: string, tgt: Tgt | null, move = this.kit.moves[id]) {
    if (!move) return false;
    const a: Act = { id, t: 0, dur: 1, tgt, phase: 0, n: 0, data: {}, move };
    if (move.start(this, a) === false) return false;
    this.action = a;
    this.goal = null;
    this.brain.go(id === "dodge" ? "dodge" : id === "phase" ? "bossPhase" : "ability", id);
    return true;
  }
  protected moveOf(a: Act | null) {
    if (!a) return null;
    if (a.move) return a.move;
    return a.id === "dodge" ? (this.kit.dodge ?? ROLL) : a.id === "land" ? LAND : a.id === "getup" ? GETUP : this.kit.moves[a.id] ?? null;
  }
  endAction() {
    const m = this.moveOf(this.action);
    if (m && this.action) (m as Move & { stop?(h: RosterHero, a: Act): void }).stop?.(this, this.action);
    this.action = null;
  }

  // ------------------------------------------------------------------ frame
  update(dt: number) {
    if (!this.enabled) return;
    this.time += dt;
    if (this.film && (this.film.t += dt) >= this.film.dur) this.film = null;
    this.sinceHurt += dt;
    this.dodgeCd -= dt;
    this.quipCd -= dt;
    this.book.tick(dt);
    if (this.lineT > 0 && (this.lineT -= dt) <= 0) this.line.classList.remove("on");
    // (out of harm's way a while: some of it comes back)
    if (this.regen && this.mode !== "ko" && this.sinceHurt > 5 && this.health < this.maxHealth) this.health = Math.min(this.maxHealth, this.health + this.maxHealth * 0.01 * dt);
    if (this.introT >= 0) {
      this.introT += dt;
      this.kit.entrance.frame(this, this.introT, dt);
      if (this.introT >= this.kit.entrance.dur) this.endIntro();
    } else if (this.mode === "ko") this.recovering(dt);
    else {
      if (this.brain.tick(dt)) {
        // (the watchdog: whatever he was stuck in, drop it and think again)
        this.endAction();
        this.goal = null;
      }
      this.react(dt);
      this.think(dt);
      this.act(dt);
    }
    if (this.introT < 0) this.move(dt);
    // (never out of the fight's bounds — a knock, a throw, a teleport: back inside, where everyone can get at him)
    if (this.introT < 0) {
      const B = this.host.bounds;
      if (this.p.x < B.minX + 1 || this.p.x > B.maxX - 1 || this.p.z < B.minZ + 1 || this.p.z > B.maxZ - 1) {
        this.p.x = Math.max(B.minX + 1, Math.min(B.maxX - 1, this.p.x));
        this.p.z = Math.max(B.minZ + 1, Math.min(B.maxZ - 1, this.p.z));
        if (this.mode === "ground") {
          const fy = this.host.nav.floorAt(this.p.x, this.p.y + 1, this.p.z, 4);
          if (fy === null) this.mode = "air";
        }
      }
    }
    if (!isFinite(this.p.x + this.p.y + this.p.z + this.v.x + this.v.y + this.v.z + this.yaw)) {
      console.warn(this.def.id + ": bad state, back by the player");
      this.p.copyFrom(this.host.player.feet.add(V(2, 0, 0)));
      this.v.setAll(0);
      this.mode = this.kit.flyer ? "fly" : "ground";
      this.action = null;
    }
    this.animate(dt);
    this.kit.after?.(this, dt);
  }

  // ------------------------------------------------------------------ deciding
  private react(dt: number) {
    if (this.reaction >= 0) {
      this.reaction -= dt;
      if (this.reaction < 0 && this.pendingThreat && !this.action) this.dodge(this.pendingThreat);
      return;
    }
    if (this.dodgeCd > 0 || this.action || (this.mode !== "ground" && this.mode !== "fly")) return;
    const f = this.host.foe(this);
    if (!f || !this.tgtAlive({ foe: f })) return;
    const t = f.threat();
    if (!t || t.t > 0.55 || !this.inDanger(t)) return;
    // (quick reflexes: the Flash reacts at once, the heavyweights a beat later)
    this.reaction = this.def.stats.reaction * rnd(0.6, 1.2);
    this.pendingThreat = t;
  }
  private inDanger(t: HulkThreat) {
    const to = this.p.subtract(t.at);
    if (Math.abs(to.y) > 2.6) return false;
    to.y = 0;
    const d = to.length();
    if (d > t.radius + 0.6) return false;
    if (t.cone >= Math.PI || d < 0.5) return true;
    return Math.abs(angDiff(Math.atan2(to.x, to.z), Math.atan2(t.dir.x, t.dir.z))) < t.cone + 0.25;
  }
  private dodge(t: HulkThreat) {
    this.pendingThreat = null;
    this.dodgeCd = 1.4;
    const away = flat(this.p.subtract(t.at));
    if (away.lengthSquared() < 1e-3) away.copyFrom(this.fwd().scale(-1));
    away.normalize();
    const side = V(away.z, 0, -away.x).scale(Math.random() < 0.5 ? 1 : -1);
    const dir = t.kind === "clap" ? side : t.kind === "punch" ? away.add(side.scale(0.6)).normalize() : away;
    this.begin("dodge", null, this.kit.dodge ?? ROLL);
    if (this.action) this.action.data.dir = dir;
  }

  protected think(dt: number) {
    this.thinkT -= dt;
    if (this.thinkT > 0 || this.action) return;
    this.thinkT = 0.2;
    if (this.mode === "air") return;
    const t = this.pickTarget();
    this.tgt = t;
    if (!t) {
      this.brain.state !== "follow" && this.brain.go("follow", "nobody");
      this.followPlayer();
      return;
    }
    this.engage(t);
  }
  /** whom: the foe if there's one up; else the nearest soldier; else (if he can) what's in the sky */
  protected pickTarget(): Tgt | null {
    const host = this.host;
    const f = host.foe(this);
    let t: Tgt | null = f && this.tgtAlive({ foe: f }) ? { foe: f } : null;
    if (t && "foe" in t && t.foe.state === "held") t = null;
    // (with no foe up, anyone left on the map is his: he goes and finds them)
    const near = this.nearestSoldier(t ? 10 : 400);
    if (near && (!t || Math.random() < 0.35)) t = { soldier: near };
    if (!t) {
      const u = this.airTarget();
      if (u) t = { air: u };
    }
    return t;
  }
  /** at him: the best move he has ready for this range — or get to where he fights from */
  protected engage(t: Tgt) {
    const host = this.host;
    const at = this.tgtGround(t);
    const d = Vector3.Distance(flat(this.p), flat(at));
    const size = this.sizeOf(t);
    // a heavy blow waits till the last big one has landed (the team's board)
    const ids = this.kit.prefer.filter((id) => {
      const m = this.kit.moves[id];
      const def = this.book.def(id);
      if (!m || !def) return false;
      if ("air" in t! && !m.vsAir) return false;
      if ("soldier" in t! && m.vsSoldier === false) return false;
      if (this.mode === "fly" && !m.airborne) return false;
      if (def.stagger >= 1.5 && host.team.since("heavy") < 1.2) return false;
      return true;
    });
    const sees = this.sees(this.aimOf(t));
    for (const id of ids) {
      const def = this.book.def(id)!;
      // (anything at range needs a clear line)
      if (def.kind !== "melee" && def.kind !== "buff" && !sees) continue;
      if (!this.book.usable(id, "air" in t ? Math.min(d, 30) : d, size)) continue;
      if (this.begin(id, t)) {
        this.book.use(id);
        host.team.mark(def.stagger >= 1.5 ? "heavy" : def.kind === "melee" ? "melee" : "ranged");
        if (Math.random() < 0.18) this.quip(this.kit.lines.fight);
        return;
      }
    }
    // nothing to throw yet: get to where he fights from
    if ("air" in t) {
      this.brain.go("approach", "air");
      return this.followPlayer();
    }
    this.brain.state !== "approach" && this.brain.go("approach", "range");
    const want = this.kit.holdRange * (t && "foe" in t ? Math.max(0.8, Math.min(1.3, t.foe.size)) : 1);
    if (d > want + 1 || !sees) {
      // round to his flank, not straight down the middle with everyone else
      const from = flat(this.p.subtract(at));
      if (from.lengthSquared() < 1e-3) from.set(1, 0, 0);
      const base = Math.atan2(from.x, from.z) + this.flank;
      const spot = at.add(V(Math.sin(base), 0, Math.cos(base)).scale(Math.max(1.4, want * 0.9)));
      this.goTo(spot, d > 12 ? "sprint" : "run");
    } else {
      this.goal = null;
      this.faceTo(at);
    }
    // (the same soldier too long, no way to him: try another for a while)
    if ("soldier" in t) {
      if (this.huntOf !== t.soldier) (this.huntOf = t.soldier), (this.huntT = 0);
      this.huntT += 0.2;
      if (this.huntT > 12) {
        this.gaveUp.set(t.soldier, this.time + 25);
        this.huntOf = null;
      }
    }
  }
  private nearestSoldier(range: number) {
    let best: Soldier | null = null, bd = range;
    for (const s of this.host.soldiers()) {
      if (!s.alive || s.dormant || s.held || (this.gaveUp.get(s) ?? 0) > this.time) continue;
      const d = Vector3.Distance(s.position, this.p);
      if (d < bd) (bd = d), (best = s);
    }
    return best;
  }
  private airTarget() {
    if (!Object.values(this.kit.moves).some((m) => m.vsAir)) return null;
    let best: AirUnit | null = null, bd = 120;
    for (const u of this.host.air()) {
      if (!u.alive) continue;
      const d = Vector3.Distance(u.position, this.p);
      if (d < bd && this.sees(u.position)) (bd = d), (best = u);
    }
    return best;
  }
  protected followPlayer() {
    const me = this.host.player.feet;
    const yaw = this.host.player.yaw;
    // each one a different spot round you (spread by their place in the line-up)
    const k = (this.def.id.charCodeAt(0) + this.def.id.length * 7) % 8;
    const a = yaw + Math.PI + (k - 3.5) * 0.45;
    const spot = me.add(V(Math.sin(a) * 4.5, 0, Math.cos(a) * 4.5));
    const d = Vector3.Distance(flat(this.p), flat(me));
    if (d > 6 || Vector3.Distance(flat(this.p), flat(spot)) > 2.5) this.goTo(spot, d > 14 ? "sprint" : d > 7 ? "run" : "walk");
    else this.goal = null;
  }

  // ------------------------------------------------------------------ acting
  private act(dt: number) {
    const a = this.action;
    if (!a) return;
    const m = this.moveOf(a);
    if (!m) {
      this.action = null;
      return;
    }
    a.t += dt;
    // (the target's gone mid-move: a ranged move ends, a melee one finishes its swing in the air)
    const done = m.frame(this, a, dt) === true || a.t >= a.dur;
    if (done && this.action === a) {
      this.action = null;
      if (this.brain.state === "ability" || this.brain.state === "dodge") this.brain.go("select", "done");
    }
  }

  // ------------------------------------------------------------------ getting about
  goTo(p: Vector3, pace: "walk" | "run" | "sprint") {
    if (!this.goal || Vector3.DistanceSquared(this.goal, p) > 1) this.repath = 0;
    this.goal = p.clone();
    this.pace = pace;
  }
  private move(dt: number) {
    if (this.mode === "ground") return this.moveGround(dt);
    if (this.mode === "fly") return this.moveFly(dt);
    return this.moveAir(dt, this.mode === "ko");
  }
  private moveGround(dt: number) {
    const nav = this.host.nav;
    const fy = nav.floorAt(this.p.x, this.p.y + 0.3, this.p.z, 0.6);
    if (fy === null) {
      this.mode = "air";
      this.v.y = 0;
      return;
    }
    this.p.y += (fy - this.p.y) * Math.min(1, dt * 15);
    const m = this.moveOf(this.action);
    if (m?.moves) return;
    if (this.action) {
      this.v.setAll(0);
      return;
    }
    let speed = 0;
    if (this.goal) {
      const target = this.steer(dt);
      const step = flat(target.subtract(this.p));
      const L = step.length();
      const s = this.pace === "sprint" ? this.kit.sprint : this.pace === "run" ? this.kit.run : 1.7;
      if (L > 0.15) {
        this.turnTo(Math.atan2(step.x, step.z), dt, this.kit.speedster ? 30 : 12);
        const dir = this.fwd();
        this.avoid(dir);
        const want = Math.min(L, s * dt);
        // (sub-stepped: 0.5 m at a time, so nothing fast goes through a wall)
        let moved = 0;
        const n = Math.max(1, Math.ceil(want / 0.5));
        for (let i = 0; i < n; i++) {
          const st = want / n;
          if (this.stepTo(this.p.x + dir.x * st, this.p.z + dir.z * st)) moved += st;
          else {
            this.blocked(dir);
            break;
          }
        }
        speed = moved / dt;
        if (this.kit.speedster && speed > 12) this.blur(dir, speed);
      } else if (Vector3.Distance(flat(this.p), flat(this.goal)) < 0.4) this.goal = null;
    }
    this.v.set(Math.sin(this.yaw) * speed, 0, Math.cos(this.yaw) * speed);
    if (this.goal && speed < 0.3 && this.mode === "ground") {
      this.stillT += dt;
      if (this.stillT > 0.9) {
        // stuck on something: hop it
        this.stillT = 0;
        const dir = flat(this.goal.subtract(this.p)).normalize();
        this.v.set(dir.x * 4.5, 8, dir.z * 4.5);
        this.mode = "air";
        this.p.y += 0.05;
      }
    } else this.stillT = 0;
    if (speed > 1) {
      this.stepT -= dt * (Math.min(speed, 12) / 4.2);
      if (this.stepT <= 0) {
        this.stepT = 0.34;
        this.host.audio.play("footstep", { x: this.p.x, y: this.p.y, z: this.p.z, volume: 0.28 * Math.min(1.6, this.def.height / 1.8) });
      }
    }
  }
  /** the Flash: a smear of light along where he's been */
  blur(dir: Vector3, speed: number) {
    const c0 = new Color3(1, 0.85, 0.3), c1 = new Color3(1, 0.25, 0.05);
    for (let k = 0; k < 3; k++) {
      const at = this.p.add(V(rnd(-0.2, 0.2), rnd(0.3, 1.6), rnd(-0.2, 0.2))).subtract(dir.scale(rnd(0, 1.5)));
      this.host.glow.emit(at, V(rnd(-0.5, 0.5), rnd(-0.2, 0.4), rnd(-0.5, 0.5)), rnd(0.18, 0.35), rnd(0.18, 0.32), 0.2, c0, c1, 0.9, 6, 0);
    }
    if (Math.random() < Math.min(0.5, speed / 80)) {
      const a = this.p.add(V(rnd(-0.4, 0.4), rnd(0.4, 1.4), rnd(-0.4, 0.4)));
      this.host.lightning.strike(a, a.subtract(dir.scale(rnd(1.2, 2.6))).addInPlaceFromFloats(rnd(-0.4, 0.4), rnd(-0.4, 0.4), rnd(-0.4, 0.4)), new Color3(1, 0.8, 0.2), 0.12, 0.25, 0.25, 0);
    }
  }
  stepTo(x: number, z: number) {
    const nav = this.host.nav;
    const b = this.host.bounds;
    if (x < b.minX + 0.5 || x > b.maxX - 0.5 || z < b.minZ + 0.5 || z > b.maxZ - 0.5) return false;
    if (this.kit.giant) {
      // (a containers' height is his ankle: he walks the ground under them, never stands on them)
      const g = nav.floorAt(x, 0.5, z, 3);
      this.p.set(x, g ?? this.p.y, z);
      return true;
    }
    const fy = nav.floorAt(x, this.p.y + 0.5, z, 1.2);
    if (fy === null) {
      if (!nav.embedded(x, this.p.y + 0.5, z)) {
        this.p.x = x;
        this.p.z = z;
        return true;
      }
      return false;
    }
    if (fy > this.p.y + 0.5 || nav.embedded(x, this.p.y + 0.4, z) || nav.embedded(x, fy + 1.0, z)) return false;
    this.p.x = x;
    this.p.z = z;
    return true;
  }
  private blocked(dir: Vector3) {
    const nav = this.host.nav;
    const c = this.p.add(V(0, 0.6, 0));
    const hit = nav.moveHit(c, c.add(dir.scale(1.2)));
    if (!hit) return;
    const top = nav.boxBoundsOf(hit.box)[4];
    const h = top - this.p.y;
    if (h < 2.8) {
      // vault it
      this.v.set(dir.x * 4.5, Math.sqrt(2 * G * (h + 0.7)), dir.z * 4.5);
      this.mode = "air";
      this.p.y += 0.05;
      return;
    }
    this.repath = 0;
    this.path = [];
  }
  private avoid(dir: Vector3) {
    const keep = (q: Vector3, r: number) => {
      const to = flat(q.subtract(this.p));
      const d = to.length();
      if (d > r || d < 1e-3 || Vector3.Dot(to.scale(1 / d), dir) < 0.2) return;
      const side = V(to.z, 0, -to.x).normalize();
      if (Vector3.Dot(side, dir) < 0) side.scaleInPlace(-1);
      dir.addInPlace(side.scale(1.2 * (1 - d / r))).normalize();
    };
    keep(this.host.player.feet, 2.2);
    for (const c of this.host.heroes()) if (c !== this) keep(c.feet, 1.4);
  }
  private steer(dt: number) {
    const nav = this.host.nav;
    const goal = this.goal!;
    const knee = V(0, 0.5, 0), chest = V(0, 1.2, 0);
    if (Math.abs(goal.y - this.p.y) < 1.5 && nav.moveRay(this.p.add(knee), goal.add(knee)) < 0 && nav.moveRay(this.p.add(chest), goal.add(chest)) < 0) {
      this.path = [];
      return goal;
    }
    this.repath -= dt;
    if (this.repath <= 0 || !this.path.length) {
      this.repath = 0.7;
      const a = nav.nearest(this.p, true), b = nav.nearest(goal, false);
      this.path = nav.path(a, b);
      if (a >= 0 && (!this.path[0] || nav.moveRay(this.p.add(knee), this.path[0].add(knee)) >= 0)) this.path.unshift(nav.nodes[a].p);
      this.path.push(goal.clone());
    }
    while (this.path.length > 1 && Vector3.Distance(flat(this.path[0]), flat(this.p)) < 0.8) this.path.shift();
    return this.path[0] ?? goal;
  }
  /** falling, thrown, vaulting (and knocked out: still falling, to the ground, from any height) */
  protected moveAir(dt: number, ko: boolean) {
    const nav = this.host.nav;
    const prevC = this.center();
    this.v.y -= G * dt;
    this.p.addInPlace(this.v.scale(dt));
    const c = this.center();
    const hit = nav.moveHit(prevC, c);
    if (hit && hit.normal.y < 0.5) {
      const vn = Vector3.Dot(this.v, hit.normal);
      if (vn < 0) this.v.subtractInPlace(hit.normal.scale(vn * 1.15));
      this.p.copyFrom(hit.point.add(hit.normal.scale(0.12))).subtractInPlace(V(0, this.def.height * 0.55, 0));
    }
    if (this.v.y <= 0) {
      const fy = nav.floorAt(this.p.x, this.p.y + 0.6 - this.v.y * dt, this.p.z, 0.8 - this.v.y * dt) ?? (this.p.y < 0 ? 0 : null);
      if (fy !== null && this.p.y <= fy + 0.02) {
        const impact = -this.v.y;
        this.p.y = fy;
        this.v.setAll(0);
        this.tumble = 0;
        this.host.audio.play(impact > 9 ? "bodyFall" : "land", { x: this.p.x, y: this.p.y, z: this.p.z, volume: 0.5 });
        if (ko) return;
        this.mode = this.kit.flyer ? "fly" : "ground";
        if (this.mode === "fly") this.p.y += 0.1;
        // his own landing: down hard, his way
        if (!this.action && impact > 7) this.begin("land", null, LAND);
        if (this.brain.state === "recover") this.brain.go("select", "landed");
      }
    }
    if (this.p.y < -30) this.p.copyFrom(this.host.player.feet.add(V(2, 0, 0)));
  }
  /**
   * Flight (Captain Marvel): she goes where the goal is at fighting height (a few metres up, higher
   * over a crowd), accelerating hard and banking into turns; never through a wall, never into the ground.
   */
  private moveFly(dt: number) {
    const nav = this.host.nav;
    const m = this.moveOf(this.action);
    if (m?.moves) return;
    const floor = nav.floorAt(this.p.x, this.p.y + 0.5, this.p.z, 60) ?? 0;
    let want = V();
    if (this.goal && !this.action) {
      const g = this.goal.add(V(0, 3.2, 0));
      const to = g.subtract(this.p);
      const L = to.length();
      const s = this.pace === "sprint" ? this.kit.sprint : this.pace === "run" ? this.kit.run : 4;
      if (L > 0.3) want = to.scale(Math.min(s, L * 2) / L);
      else this.goal = null;
    } else if (!this.action) {
      // hovering: a slow bob
      want = V(0, Math.sin(this.time * 1.7) * 0.4, 0);
    }
    if (this.p.y < floor + 2.2) want.y = Math.max(want.y, 3);
    if (this.p.y > floor + 14) want.y = Math.min(want.y, -2);
    const k = 1 - Math.exp(-(this.action ? 6 : 3) * dt);
    Vector3.LerpToRef(this.v, want, k, this.v);
    const prev = this.center();
    const next = this.p.add(this.v.scale(dt));
    const hit = nav.moveHit(prev, next.add(V(0, this.def.height * 0.55, 0)));
    if (hit) {
      const vn = Vector3.Dot(this.v, hit.normal);
      if (vn < 0) this.v.subtractInPlace(hit.normal.scale(vn * 1.1));
    } else this.p.copyFrom(next);
    const b = this.host.bounds;
    this.p.x = Math.max(b.minX + 1, Math.min(b.maxX - 1, this.p.x));
    this.p.z = Math.max(b.minZ + 1, Math.min(b.maxZ - 1, this.p.z));
    const hs = flat(this.v).length();
    if (hs > 1 && !this.action) this.turnTo(Math.atan2(this.v.x, this.v.z), dt, 5);
    // (the lean: into the flight, a bank into the turn)
    this.pitch += (Math.min(1.25, hs / 14) - this.pitch) * Math.min(1, dt * 4);
    const turn = this.flyV.lengthSquared() > 0.1 ? angDiff(Math.atan2(this.v.x, this.v.z), Math.atan2(this.flyV.x, this.flyV.z)) / Math.max(dt, 1e-3) : 0;
    this.roll += (Math.max(-0.6, Math.min(0.6, -turn * 0.15)) - this.roll) * Math.min(1, dt * 3);
    this.flyV.copyFrom(this.v);
  }

  // ------------------------------------------------------------------ down and up
  protected knockOut() {
    this.endAction();
    this.mode = "ko";
    this.koT = 10;
    this.brain.go("defeated", "knocked out");
    this.say(pick(this.kit.lines.down), 2.4);
  }
  protected recovering(dt: number) {
    this.moveAir(dt, true);
    this.koT -= dt;
    if (this.koT <= 0 && this.v.lengthSquared() < 0.01) {
      this.mode = this.kit.flyer ? "fly" : "ground";
      if (this.mode === "fly") this.p.y += 0.3;
      this.health = this.maxHealth * 0.6;
      this.begin("getup", null, GETUP);
      this.say(pick(this.kit.lines.up), 2.2);
    }
  }

  // ------------------------------------------------------------------ the body
  /** a pose that takes precedence over everything (a villain's filmed defeat); null: none */
  protected poseOverride(_want: Pose, _dt: number): number | null {
    return null;
  }
  private animate(dt: number) {
    const want = this.want;
    const a = this.action;
    let rate = 14;
    const speed = flat(this.v).length();
    const over = this.poseOverride(want, dt);
    if (over !== null) rate = over;
    else if (this.introT >= 0) rate = this.kit.entrance.pose(this, this.introT, want, dt);
    else if (this.mode === "ko") {
      sample(this.clips.deathB, clipDur(this.clips.deathB), false, want);
      rate = 8;
    } else if (a) rate = this.moveOf(a)?.pose(this, a, want, dt) ?? 14;
    else if (this.mode === "air") {
      copyPose(this.tumble ? HIT : TUCK, want);
      if (this.tumble) mixPose(HIT, TUCK, 0.5, want);
      rate = 10;
    } else if (this.mode === "fly") {
      copyPose(this.kit.idle ?? this.kit.stance, want);
      rate = 8;
    } else if (speed > 0.6 && this.kit.gait) rate = this.kit.gait(this, speed, dt, want);
    else if (speed > 0.6) {
      const gait: ClipName = speed < 3 ? "walk" : speed > 7.5 ? "sprint" : "run";
      const ownWalk = this.kit.walkClip ? this.own[this.kit.walkClip] : undefined;
      const c = ownWalk ?? this.clips[gait];
      const cs = (gait === "walk" ? 1.25 : (c.speed ?? 4)) * (this.rig.hipH / 0.9);
      if (gait !== this.gait) {
        const from = this.clips[this.gait];
        this.runPhase = ((this.runPhase % clipDur(from)) / clipDur(from)) * clipDur(c);
        this.gait = gait;
      }
      // (the Flash's legs can't actually go 40 m/s: a flat-out sprint, his speed is the blur)
      this.runPhase += dt * (Math.min(speed, 11) / cs);
      sample(c, this.runPhase, true, want);
      // (his own walk has his own arms; the shared clips are soldiers' — rifle arms re-posed)
      if (!ownWalk) naturalArms(want, gait === "walk" ? 0.1 : gait === "run" ? 0.6 : 1, gait === "sprint" ? 0.24 : 0.1);
      rate = 40;
    } else copyPose(this.tgt ? this.kit.stance : (this.kit.idle ?? RELAXED), want);
    // (a model's own clip can carry root motion in the pelvis — a leap, a lunge: kept under him)
    want.hip[0] = Math.max(-0.4, Math.min(0.4, want.hip[0]));
    want.hip[1] = Math.min(1.08, want.hip[1]);
    want.hip[2] = Math.max(-0.4, Math.min(0.4, want.hip[2]));
    follow(this.shown, want, rate, dt);
    if (!this.shown.d.every((d) => isFinite(d[0] + d[1] + d[2]))) copyPose(STANCE, this.shown);
    lookRotation(this.fwd(), V(0, 1, 0), this.q);
    if (this.mode === "fly" || (this.introT >= 0 && this.kit.flyer)) {
      this.q.multiplyInPlace(Quaternion.RotationAxis(V(1, 0, 0), this.pitch));
      this.q.multiplyInPlace(Quaternion.RotationAxis(V(0, 0, 1), this.roll));
    }
    if (this.tumble && this.mode === "air") this.q.multiplyInPlace(Quaternion.RotationAxis(V(1, 0, 0), -Math.min(1.2, this.time % 6)));
    const anc = this.rig.anchor;
    anc.rotationQuaternion!.copyFrom(this.q);
    if (this.mode === "fly" || (this.introT >= 0 && this.kit.flyer)) {
      // (tilted about the middle of the body, not the feet)
      const mid = V(0, this.rig.hipH, 0).applyRotationQuaternion(this.q);
      anc.position.copyFrom(this.p).addInPlace(V(0, this.rig.hipH, 0)).subtractInPlace(mid);
    } else anc.position.copyFrom(this.p);
    // (far from the camera the body is posed less often: 30 Hz past 14 m, 20 Hz past 40 m, 10 Hz past
    // 80 m — the anchor still moves every frame, so he doesn't stutter across the field)
    // (staggered: they don't all pose on the same frame)
    // (the rig itself poses less often far from the camera: see SkinnedRig.viewer)
    {
      const hip = this.shown.hip;
      this.rig.pose(this.shown.d, V(hip[0] * this.rig.hipH, hip[1] * this.rig.hipH, hip[2] * this.rig.hipH));
      this.rig.grip?.("l", 0.8);
      this.rig.grip?.("r", 0.8);
    }
  }

  // ------------------------------------------------------------------ props
  /**
   * A model's own prop (a bone the weapon's skinned to, or a node it hangs from) taken over:
   * from now on it's placed in the world each frame by `place` — thrown, flying, caught — and
   * handed back to the bone it came from with `release`.
   */
  takeProp(node: TransformNode) {
    const rest = { p: node.position.clone(), q: (node.rotationQuaternion ?? Quaternion.FromEulerVector(node.rotation)).clone(), s: node.scaling.clone() };
    if (!node.rotationQuaternion) node.rotationQuaternion = Quaternion.FromEulerVector(node.rotation);
    return {
      node,
      /** world position + rotation for it now */
      place(pos: Vector3, rot: Quaternion) {
        const parent = node.parent as TransformNode | null;
        if (parent) {
          parent.computeWorldMatrix(true);
          const pw = parent.getWorldMatrix();
          // (its own size in the world: its rest scale under the parent's)
          const ps = V();
          pw.decompose(ps);
          const W = Matrix.Compose(ps.multiply(rest.s), rot, pos);
          W.multiply(pw.clone().invert()).decompose(node.scaling, node.rotationQuaternion!, node.position);
        } else Matrix.Compose(rest.s, rot, pos).decompose(node.scaling, node.rotationQuaternion!, node.position);
      },
      /** its world rotation now */
      worldRot() {
        node.computeWorldMatrix(true);
        const q = new Quaternion();
        node.getWorldMatrix().decompose(undefined, q);
        return q;
      },
      release() {
        node.position.copyFrom(rest.p);
        node.rotationQuaternion!.copyFrom(rest.q);
        node.scaling.copyFrom(rest.s);
      },
      world() {
        return worldPos(node);
      },
    };
  }
}

// ------------------------------------------------------------------ the moves everyone has
/** out of the way: a roll (the shared clip), fast along the escape direction */
export const ROLL: Move = {
  moves: true,
  start(h, a) {
    a.dur = clipDur(h.clips.roll) / 1.5;
    h.host.audio.play("foley", { x: h.p.x, y: h.p.y, z: h.p.z, volume: 0.6 });
  },
  frame(h, a, dt) {
    const dir = (a.data.dir as Vector3 | undefined) ?? h.fwd().scale(-1);
    if (a.t < dt * 1.5) h.yaw = Math.atan2(dir.x, dir.z);
    if (h.mode === "fly") h.p.addInPlace(dir.scale(10 * dt));
    else {
      const st = dir.scale(8 * dt);
      h.stepTo(h.p.x + st.x, h.p.z + st.z);
    }
  },
  pose(h, a, want) {
    if (h.mode === "fly") {
      copyPose(TUCK, want);
      return 20;
    }
    sample(h.clips.roll, a.t * 1.5, false, want);
    return 30;
  },
};
/** his own landing pose, held a moment (the kit's) */
export const LAND: Move = {
  start(h, a) {
    a.dur = 0.55;
    h.host.dust(h.p.clone(), 0.25);
  },
  frame() {},
  pose(h, a, want) {
    mixPose(h.kit.landing, h.kit.stance, Math.max(0, (a.t - 0.25) / 0.3), want);
    return 16;
  },
};
/** back up after a knock-out */
export const GETUP: Move = {
  start(_h, a) {
    a.dur = 1.1;
  },
  frame() {},
  pose(h, a, want) {
    mixPose(LANDING, h.kit.stance, Math.min(1, a.t / a.dur), want);
    return 8;
  },
};

// ------------------------------------------------------------------ move builders the kits share
export interface ComboStep {
  /** a shared clip, or one of the model's own (Darkseid's ATTACK001…) */
  clip: ClipName | string;
  speed: number;
  /** fractions of the clip where blows land */
  hits: number[];
}
/** a clip by name: the model's own first, then the shared ones */
export function clipOf(h: RosterHero, name: string): DirClip {
  return h.own[name] ?? h.clips[name as ClipName] ?? h.clips.punch;
}
/**
 * A close-in combo off the shared clips: each blow lands on whatever's in front and in reach;
 * the last can throw (`launch` m/s).
 */
export function comboMove(id: string, steps: ComboStep[], reach: number, opts: { launch?: number; up?: number; force?: number; sound?: string; after?: (h: RosterHero, a: Act, last: boolean) => void } = {}): Move {
  return {
    start(h, a) {
      const s = steps[Math.floor(Math.random() * steps.length)];
      a.data.s = s;
      a.dur = clipDur(clipOf(h, s.clip)) / s.speed + 0.15;
      if (a.tgt) h.faceTo(h.tgtGround(a.tgt));
    },
    threat(h, a) {
      const s = a.data.s as ComboStep;
      const next = s.hits[a.n];
      if (next === undefined) return null;
      const f = (a.t * s.speed) / clipDur(clipOf(h, s.clip));
      const target = a.tgt && "hero" in a.tgt ? a.tgt.hero : null;
      return { kind: "punch", at: h.p.clone(), dir: h.fwd(), radius: reach * 1.2, cone: 1.2, t: Math.max(0, ((next - f) * clipDur(clipOf(h, s.clip))) / s.speed), target };
    },
    frame(h, a, dt) {
      const s = a.data.s as ComboStep;
      const f = (a.t * s.speed) / clipDur(clipOf(h, s.clip));
      const t = a.tgt;
      if (t && h.tgtAlive(t)) {
        const at = h.tgtGround(t);
        // close the gap through the wind-up (a step into each blow)
        const d = Vector3.Distance(flat(h.p), flat(at));
        if (d > reach * 0.7 && f < (s.hits[a.n] ?? 1)) {
          const step = flat(at.subtract(h.p)).normalize().scale(Math.min(d - reach * 0.6, 5 * dt));
          h.stepTo(h.p.x + step.x, h.p.z + step.z);
        }
        h.turnTo(Math.atan2(at.x - h.p.x, at.z - h.p.z), dt, 8);
      }
      while (a.n < s.hits.length && f >= s.hits[a.n]) {
        a.n++;
        const last = a.n === s.hits.length;
        const def = h.book.def(id);
        const dmg = def?.damage ?? 15;
        h.host.audio.play("meleeSwing", { x: h.p.x, y: h.p.y + 1.3, z: h.p.z, volume: 0.6 });
        if (!t || !h.tgtAlive(t)) continue;
        const aim = h.aimOf(t);
        const to = aim.subtract(h.center());
        if (flat(to).length() > reach + 0.5 * h.sizeOf(t) || Vector3.Dot(flat(to).normalize(), h.fwd()) < 0.2) continue;
        h.hit(t, dmg, to, { force: last ? (opts.force ?? 2) : 1, launch: last ? opts.launch : undefined, up: opts.up });
        h.host.audio.play(opts.sound ?? "meleeHit", { x: aim.x, y: aim.y, z: aim.z, volume: 0.85 });
        h.host.spark(aim.subtract(to.normalizeToNew().scale(0.3)), to.scale(-1).normalize());
        opts.after?.(h, a, last);
      }
    },
    pose(h, a, want) {
      const s = a.data.s as ComboStep;
      sample(clipOf(h, s.clip), a.t * s.speed, false, want);
      return 26;
    },
  };
}

/**
 * Energy shots: `shots` of them, `every` seconds apart, from the hands (alternating with "both"),
 * each a glowing bolt that lands what it hits (with a `splash` if it's explosive).
 */
export function shootMove(
  id: string,
  o: { hands: "l" | "r" | "both"; shots: number; every: number; speed: number; core: Color3; glow: Color3; size: number; sound?: string; rate?: number; splash?: number; launch?: number; muzzle?: (h: RosterHero, side: "l" | "r") => Vector3; vsAir?: boolean; airborne?: boolean; pose?: (h: RosterHero, a: Act, want: Pose) => void },
): Move {
  return {
    vsAir: o.vsAir,
    airborne: o.airborne,
    start(_h, a) {
      a.dur = 0.25 + o.shots * o.every;
    },
    frame(h, a, dt) {
      const t = a.tgt;
      if (!t || !h.tgtAlive(t)) return a.n > 0;
      const aim = h.aimOf(t);
      h.turnTo(Math.atan2(aim.x - h.p.x, aim.z - h.p.z), dt, 10);
      while (a.n < o.shots && a.t >= 0.2 + a.n * o.every) {
        const side: "l" | "r" = o.hands === "both" ? (a.n % 2 ? "l" : "r") : o.hands;
        const from = o.muzzle ? o.muzzle(h, side) : h.hand(side).add(h.fwd().scale(0.15));
        a.n++;
        const sp = 0.6;
        const to = aim.add(V(rnd(-sp, sp), rnd(-sp, sp) * 0.5, rnd(-sp, sp)).scale(Math.min(1, Vector3.Distance(from, aim) / 25)));
        const blocked = h.host.nav.rayLevel(from, to);
        const end = blocked >= 0 ? from.add(to.subtract(from).normalize().scale(blocked)) : to;
        const def = h.book.def(id);
        const dmg = def?.damage ?? 10;
        h.host.audio.play(o.sound ?? "repulsorFire", { x: from.x, y: from.y, z: from.z, volume: 0.55, rate: (o.rate ?? 1.4) + rnd(-0.1, 0.1) });
        const dir = to.subtract(from);
        const target = t;
        h.host.bolts.fire(from, end, o.speed, o.core, o.glow, o.size, () => {
          if (o.splash) {
            h.host.blast(end, o.splash, dmg);
            return;
          }
          if (blocked < 0 && h.tgtAlive(target)) h.hit(target, dmg, dir, { kind: "bullet", launch: o.launch });
          h.host.spark(end, dir.normalizeToNew().scale(-1));
        });
      }
    },
    pose(h, a, want) {
      copyPose(h.kit.stance, want);
      const t = a.tgt;
      if (t) {
        const d = h.toBody(h.aimOf(t).subtract(h.rig.at("RightArm")));
        if (o.hands !== "l") aimArm(want, "r", [d[0] + 0.06, d[1], d[2]]);
        if (o.hands !== "r") aimArm(want, "l", [d[0] - 0.06, d[1], d[2]]);
      }
      o.pose?.(h, a, want);
      return 24;
    },
  };
}

/** the shared rest poses re-exported for the kits */
export { HIT, LANDING, P, RELAXED, STANCE, TUCK, aimArm, clipDur, copyPose, mixPose, naturalArms, sample };
