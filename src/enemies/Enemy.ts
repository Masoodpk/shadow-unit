import type { BarkEvent } from "../audio/Barks";
import { InstancedMesh } from "@babylonjs/core/Meshes/instancedMesh";
import { Mesh } from "@babylonjs/core/Meshes/mesh";
import { MeshBuilder } from "@babylonjs/core/Meshes/meshBuilder";
import { Ray } from "@babylonjs/core/Culling/ray";
import { Scene } from "@babylonjs/core/scene";
import { Vector3 } from "@babylonjs/core/Maths/math.vector";
import { BodyZone, ENEMY, HitKind } from "../config/game";
import { AudioEngine } from "../audio/AudioEngine";
import { DEG, Spring, clamp, damp, lerp, rand, saturate, wrapAngle } from "../core/math";
import { Effects } from "../fx/Effects";
import { NavGraph } from "../level/NavGraph";
import { EnemySpawn } from "../level/KestrelPoint";
import { PlayerController } from "../player/PlayerController";
import { Materials } from "../render/Materials";
import type { PhysicsService } from "../physics/PhysicsService";
import { SoldierParts, buildSoldier, setPartsVisible } from "./EnemyModel";
import { RELOAD_EVENTS, RELOAD_TIME, type AnimInput, type SoldierSkin } from "./SoldierSkin";
import type { ActionKey } from "./EnemyAnimationController";
import { BOSS, RAGDOLL, REFLEX, TACTICS } from "./EnemyConfig";
import type { RagdollImpulse } from "./EnemyRagdoll";
import { difficulty } from "../config/difficulty";

/** AKS-74U magazine */
const ENEMY_MAG = 30;
/** the sidearm: 15 rounds, one at a time */
const PISTOL_MAG = 15;
const PISTOL_INTERVAL = 0.3;
const SWAP_TIME = 0.45;

export type AIState = "IDLE" | "PATROL" | "ALERT" | "SEARCH" | "ATTACK" | "DEAD";

/** a live grenade the soldiers can see coming */
export interface Threat {
  pos: Vector3;
  /** seconds to detonation (estimate) */
  fuse: number;
  key: object;
}

/** how a hit was delivered (drives the death reaction and ragdoll impulse) */
export interface HitInfo {
  kind: "bullet" | "blast" | "melee" | "fire";
  center?: Vector3;
  radius?: number;
  /** extra push scale (melee from behind etc.) */
  force?: number;
  /** a superhuman blow: the body flies off at this velocity (m/s) */
  launch?: Vector3;
}

export interface EnemyContext {
  scene: Scene;
  player: PlayerController;
  nav: NavGraph;
  fx: Effects;
  audio: AudioEngine;
  alertAllies(e: Enemy): void;
  onKilled(e: Enemy, headshot: boolean): void;
  time: number;
  /** developer mode: enemies neither see nor hear the player */
  passive?: boolean;
  /** does a thrown grenade get from a to b untouched? (the grenade's own collision: doors, glass, props) */
  throwClear?(a: Vector3, b: Vector3): boolean;
  /** the boss crossed a health threshold (0 calm, 1 pressed, 2 enraged) */
  onBossPhase?(e: Enemy, phase: number): void;
  /** a soldier shouts something (voice line) */
  bark?(e: Enemy, ev: BarkEvent): void;
  /** seconds of quiet arrival left (no detection build-up until it runs out or the player fires) */
  grace?: number;
  /** the insertion point */
  start?: Vector3;
  physics?: PhysicsService;
  ragdollSlot(e: Enemy): number;
  ragdollDone(e: Enemy): void;
  /** every soldier (separation) */
  squad?: Enemy[];
  /** a boot came down at (x, y, z) walking towards yaw: footprints */
  onFootstep?(x: number, y: number, z: number, yaw: number, side: number, run: number): void;
  /** live player/enemy grenades */
  threats?(): Threat[];
  /** spawn an enemy frag grenade */
  throwGrenade?(from: Vector3, vel: Vector3, owner: object): void;
  /** team-wide grenade clock: true if a grenade may be thrown now (and consumes it) */
  grenadeClock?(): boolean;
  /** the same clock, without consuming it (worth planning a throw?) */
  grenadeReady?(): boolean;
  /** frag model for the grenade in hand */
  grenadeProp?(): InstancedMesh | null;
  /** a shot travelled from → to: shatter any window on the way */
  breakGlass?(from: Vector3, to: Vector3): void;
  /** walking at (pos) towards (dirX, dirZ): open a shut door in the way */
  openDoor?(pos: Vector3, dirX: number, dirZ: number): void;
}

/**
 * One hostile soldier.
 *
 * Decisions run at ~8 Hz (staggered across the squad): perception, the state
 * machine IDLE → PATROL → ALERT → ATTACK → SEARCH, and inside ATTACK the
 * tactics — take cover / peek, or in the open keep a fighting distance
 * (back off when you're close, push in when you're far) and strafe, changing
 * direction every couple of seconds or when the way is blocked. Reflexes on
 * top: dodge-roll away from grenades, rifle-butt strike when you get close,
 * lob a frag when you've been hiding, flinch / side-step when hit, reload
 * when dry.
 *
 * Every frame: movement with acceleration, separation from squad mates and
 * smooth turning; burst fire; the skinned body is posed (motion capture +
 * procedural layers). Death hands the body to Havok as a ragdoll.
 */
export class Enemy {
  readonly parts: SoldierParts;
  readonly collider: Mesh;
  state: AIState = "IDLE";
  health: number = ENEMY.maxHealth;
  /** not in play yet (a mission area he belongs to hasn't been reached): parked out of the world */
  dormant = false;
  /** the stage's boss: more health, damage scaled, three phases (calmer → aggressive) */
  readonly boss: boolean;
  /** boss: 0 = calm, 1 = pressed, 2 = enraged (set from health) */
  phase = 0;
  /** 0..1: how hard he pushes (faster repositions and bursts, closes in) */
  private rage = 0;
  thinkTimer = 0;

  private stateTime = 0;
  private yaw = 0;
  private faceYaw = 0;
  private awareness = 0;
  private lastKnown = new Vector3();
  /** heard gunfire: moving in on it (run, then advance carefully) rather than a casual look */
  private investigate = false;
  /** the noise moved: plan a new route on the next decision */
  private repath = false;
  private lastSeen = -99;
  private canSee = false;
  /** seconds left blinded by a flashbang */
  blindT = 0;
  private blindMax = 1;
  private seenSince = -1;
  private path: Vector3[] = [];
  private pathIdx = 0;
  private moveSpeed = 0;
  private curSpeed = 0;
  private routeIdx = 0;
  private waitTimer = 0;
  private crouchT = 0;
  private wantCrouch = false;
  /** peeking round the side of cover: -1 left, +1 right, 0 none (and its smoothed amount) */
  private leanSide = 0;
  private leanT = 0;
  private aimT = 0;
  private wantAim = 0;
  private stuckTimer = 0;
  private lastPos = new Vector3();
  /**
   * Squad role (fixed per soldier): the rifleman pushes straight in, the two flankers swing wide
   * round either side, the support gunner hangs back in cover and keeps the player's head down.
   */
  private readonly role: "assault" | "flankL" | "flankR" | "support";
  /** where he's heading (squad mates pick other spots) */
  private dest: Vector3 | null = null;
  /** bearing from the player to him when the fight started (flankers work round from it) */
  private flankBase = 0;
  /** last position known to be on the right side of every wall (the wall watchdog) */
  private safePos = new Vector3();
  private wallCheck = 0;
  private repositionTimer = 0;
  private peekTimer = 0;
  private atCover = false;
  private burstLeft = 0;
  private burstTimer = 0;
  private burstCooldown = 0;
  private flashTimer = 0;
  private gaitPhase = 0;
  private hitPitch = new Spring(140, 10);
  private hitYaw = new Spring(140, 10);
  private recoil = new Spring(300, 22);
  private deathT = -1;
  private deathDir = 1;
  private deathTwist = 0;
  private dropVel = new Vector3();
  private dropDone = false;
  private bodyFallPlayed = false;
  private poolDone = false;
  private groundTimer = 0;
  private ray = new Ray(Vector3.Zero(), new Vector3(0, -1, 0), 3);
  private eyeV = new Vector3();
  private tmp = new Vector3();
  private tmp2 = new Vector3();
  private tmp3 = new Vector3();
  private tmp4 = new Vector3();
  /** the rifle muzzle flash's own place (the pistol borrows the flash) */
  private flashHome: Vector3 | null = null;
  private disp = new Vector3();
  private lastHeadshot = false;

  // ---- tactics (open-ground movement without a path)
  private tacX = 0;
  private tacZ = 0;
  private tacSpeed = 0;
  private tacCrouch = false;
  private strafeDir = 1;
  private strafeTimer = 0;
  // ---- reflexes
  private flinchCd = 0;
  private meleeCd = 0;
  private nades = REFLEX.grenades;
  private throwTarget = new Vector3();
  private nadeProp: InstancedMesh | null = null;
  private dodged = new WeakSet<object>();
  // ---- death
  private killInfo: { dir: Vector3; point: Vector3; damage: number; zone: BodyZone; info: HitInfo } | null = null;
  private ragdollPath = false;
  private ragdollStarted = false;
  private ragdollT = 0;
  private ragdollLive = false;
  private deathLead = 0;
  private prevCenters = new Map<string, Vector3>();
  private hasPrev = false;

  /** skinned character (null = blocky fallback) */
  skin: SoldierSkin | null = null;
  private skinTick = 0;
  private skinDt = 0;
  attachSkin(s: SoldierSkin) {
    this.skin = s;
    this.poseSkin(0, true);
  }
  private inp: AnimInput = { dt: 0, speed: 0, vx: 0, vz: 0, aim: 0, crouch: 0, crouchMove: false, reload: -1, blind: 0, aimAt: null, aimW: 0, hitPitch: 0, hitYaw: 0, recoil: 0 };
  private aimPoint = new Vector3();
  /** world velocity (accelerated / decelerated) */
  private velX = 0;
  /** the velocity the legs are animated at (his own, rate-limited) */
  private reloadAim = 1;
  private animVX = 0;
  private animVZ = 0;
  private velZ = 0;
  private hp = 0;
  private hy = 0;
  private rc = 0;
  /** rounds left in the magazine; reloadT = progress 0..1 (or -1) */
  mag = ENEMY_MAG;
  reloadT = -1;
  /**
   * The sidearm (a soldier given one — the boss): drawn when the rifle runs dry with you in sight
   * and not far off, or when you're right on top of him; fired in quick single shots; put away to
   * reload the rifle when it's empty or you've backed off. `pistolW` eases the arms between the two.
   */
  weapon: "rifle" | "pistol" = "rifle";
  pistolMag = PISTOL_MAG;
  private pistolW = 0;
  private swapT = 0;
  private farT = 0;
  /** seconds on the weapon in his hands (no swapping back and forth) */
  private weaponT = 0;
  private burstShots = 0;

  constructor(
    private ctx: EnemyContext,
    mats: Materials,
    readonly spawn: EnemySpawn,
    readonly index: number,
  ) {
    this.boss = !!spawn.boss;
    this.parts = buildSoldier(ctx.scene, mats, this, index);
    this.collider = MeshBuilder.CreateBox(`enemyCol_${index}`, { width: 0.6, height: 1.8, depth: 0.6 }, ctx.scene);
    this.collider.isVisible = false;
    this.collider.isPickable = false;
    this.collider.checkCollisions = true;
    this.collider.ellipsoid = new Vector3(ENEMY.radius, ENEMY.halfHeight, ENEMY.radius);
    this.collider.metadata = { kind: HitKind.EnemyBody };
    this.thinkTimer = (index / 9) * (1 / ENEMY.thinkRate);
    this.role = (["assault", "flankL", "flankR", "support"] as const)[index % 4];
    this.reset();
  }

  get alive() {
    return this.state !== "DEAD";
  }
  get position() {
    return this.collider.position;
  }
  /** body yaw (radians, 0 = +Z) */
  get heading() {
    return this.yaw;
  }
  get aiState() {
    return this.state;
  }
  /** the spot he's taken: where he's going, or where he stands */
  get claim() {
    return this.dest && this.isMoving() ? this.dest : this.collider.position;
  }
  get stateLabel() {
    return this.state;
  }
  /** true while AI/animation still run (dead bodies stop once sunk) */
  get active() {
    return !this.dormant && (this.state !== "DEAD" || this.deathT < ENEMY.corpseTime + ENEMY.sinkTime);
  }
  get maxHealth() {
    return (this.boss ? BOSS.health : ENEMY.maxHealth) * difficulty.k.enemyHealth;
  }

  /** which way his body faces (radians, 0 = +Z) — cutscene cameras */
  get facing() {
    return this.yaw;
  }
  /** scripted: turn to face `yaw` now (cutscenes) */
  faceTo(yaw: number) {
    this.scripted = true;
    this.faceYaw = yaw;
  }
  /** his eye / face point (cutscene cameras) */
  headPos(out: Vector3) {
    return out.copyFrom(this.eye());
  }
  /** in a cutscene: follows its orders (walk there, face that way) and nothing else until engage() */
  private scripted = false;
  /** scripted: walk to a point (cutscenes) */
  scriptMove(target: Vector3, speed: number) {
    this.scripted = true;
    this.goTo(target, speed);
    this.faceYaw = Math.atan2(target.x - this.collider.position.x, target.z - this.collider.position.z);
  }
  /** straight into the fight with the player (knows where he is) */
  engage() {
    this.scripted = false;
    this.lastKnown.copyFrom(this.ctx.player.feet);
    this.lastSeen = this.ctx.time;
    this.awareness = 1;
    this.enterAttack();
  }
  /** out of the mission for good, no body (a restart from a checkpoint past his area) */
  retire() {
    this.state = "DEAD";
    this.deathT = 1e9;
    this.dormant = false;
    this.parts.root.setEnabled(false);
    this.collider.setEnabled(false);
    this.collider.position.y = -500;
  }

  /** out of play: no AI, not drawn, parked far below the world (nothing can hit or meet him) */
  sleep() {
    this.dormant = true;
    this.collider.position.set(this.spawn.pos.x, -500, this.spawn.pos.z);
    this.applyRoot();
    this.parts.root.setEnabled(false);
    this.collider.setEnabled(false);
  }
  /** into play at his post (at `at` instead, facing `yaw`, if given) */
  wake(at?: Vector3, yaw?: number) {
    if (!this.dormant) return;
    this.dormant = false;
    const p = at ?? this.spawn.pos;
    this.collider.setEnabled(true);
    this.collider.position.set(p.x, p.y + ENEMY.halfHeight + 0.02, p.z);
    this.lastPos.copyFrom(this.collider.position);
    this.safePos.copyFrom(this.collider.position);
    if (yaw !== undefined) this.yaw = this.faceYaw = yaw;
    this.parts.root.setEnabled(true);
    this.applyRoot();
    this.poseSkin(0, true);
  }
  /** soldier is in a scripted move (roll, strike, side step …) */
  private get busy() {
    return !!this.skin?.ctrl.busy;
  }

  reset() {
    const s = this.spawn;
    this.scripted = false;
    this.health = this.maxHealth;
    this.phase = 0;
    this.rage = 0;
    this.state = "IDLE";
    this.stateTime = 0;
    this.yaw = this.faceYaw = s.yaw;
    this.awareness = 0;
    this.canSee = false;
    this.seenSince = -1;
    this.lastSeen = -99;
    this.path = [];
    this.pathIdx = 0;
    this.moveSpeed = this.curSpeed = 0;
    this.routeIdx = 0;
    this.waitTimer = rand(1, 3);
    this.crouchT = 0;
    this.leanSide = 0;
    this.leanT = 0;
    this.wantCrouch = false;
    this.aimT = this.wantAim = 0;
    this.burstLeft = 0;
    this.burstCooldown = 0;
    this.flashTimer = 0;
    this.blindT = 0;
    this.lastShotAt = -99;
    this.deathT = -1;
    this.dropDone = false;
    this.bodyFallPlayed = false;
    this.poolDone = false;
    this.investigate = false;
    this.repath = false;
    this.atCover = false;
    this.weapon = "rifle";
    this.pistolMag = PISTOL_MAG;
    this.pistolW = 0;
    this.weaponT = 0;
    this.swapT = 0;
    this.mag = ENEMY_MAG;
    this.reloadT = -1;
    this.burstShots = 0;
    this.velX = this.velZ = 0;
    this.animVX = this.animVZ = 0;
    this.tacX = this.tacZ = this.tacSpeed = 0;
    this.tacCrouch = false;
    this.flinchCd = this.meleeCd = 0;
    this.nades = REFLEX.grenades;
    this.dodged = new WeakSet();
    this.killInfo = null;
    this.ragdollPath = this.ragdollStarted = this.ragdollLive = false;
    this.iceT = 0;
    this.held = false;
    this.ragdollT = 0;
    this.hasPrev = false;
    if (this.nadeProp) this.nadeProp.setEnabled(false);
    this.skin?.enterAnim();
    this.skin?.ctrl.reset();
    this.hitPitch.reset();
    this.hitYaw.reset();
    this.recoil.reset();
    this.collider.setEnabled(true);
    this.collider.position.set(s.pos.x, s.pos.y + ENEMY.halfHeight + 0.02, s.pos.z);
    this.collider.checkCollisions = true;
    this.lastPos.copyFrom(this.collider.position);
    this.safePos.copyFrom(this.collider.position);
    this.wallCheck = 0;
    const p = this.parts;
    p.root.setEnabled(true);
    setPartsVisible(p, true);
    p.flash.setEnabled(false);
    p.gun.parent = p.gunMount;
    p.gun.setEnabled(true);
    p.gun.position.setAll(0);
    p.gun.rotation.setAll(0);
    p.root.rotation.setAll(0);
    this.applyRoot();
    this.animate(0);
    this.dormant = false;
    if (s.dormant) this.sleep();
  }

  private burnFlinch = 0;
  /** Fire damage over time (incendiary): no big hit reaction, a stagger now and then, they know you're near. */
  burn(dmg: number, from: Vector3) {
    if (!this.alive) return false;
    this.burnFlinch -= dmg;
    const dir = this.tmp.copyFrom(this.collider.position).subtractInPlace(from).normalize();
    if (this.burnFlinch <= 0) {
      this.burnFlinch = 18;
      return this.applyHit(dmg, "torso", dir, this.collider.position, { kind: "fire" });
    }
    this.health -= dmg;
    if (this.health <= 0) {
      this.health = 1;
      return this.applyHit(5, "torso", dir, this.collider.position, { kind: "fire" });
    }
    return false;
  }

  /** Flashbang exposure: strength 0..1 (distance, facing, line of sight already applied). */
  flashbang(strength: number, from: Vector3) {
    if (!this.alive || strength <= 0.05) return;
    const t = 1.4 + 4.2 * strength;
    this.blindT = Math.max(this.blindT, t);
    this.blindMax = this.blindT;
    this.hitPitch.impulse(-6 * strength);
    this.hitYaw.impulse(rand(-1, 1) * 6 * strength);
    this.burstLeft = 0;
    this.path = [];
    this.tacSpeed = 0;
    // afterwards they know roughly where it came from
    this.lastKnown.copyFrom(from);
    this.lastSeen = this.ctx.time;
    if (this.state === "IDLE" || this.state === "PATROL") this.setState("ALERT");
  }

  /** frozen solid for this long (Superman's freeze breath); he dies when the ice shatters */
  iceT = 0;
  freeze(seconds: number) {
    if (!this.alive || this.dormant || this.iceT > 0) return false;
    this.iceT = seconds;
    this.endBurst();
    return true;
  }
  get frozen() {
    return this.iceT > 0 && this.alive;
  }
  /** held up in Superman's grip: nothing of his own runs (the manager skips him) */
  held = false;
  carry(at: Vector3) {
    if (!this.alive) return;
    this.held = true;
    this.endBurst();
    this.collider.position.set(at.x, at.y, at.z);
    this.applyRoot();
  }
  /** thrown down from the sky: dead, and the body hits the ground at `vel` */
  slamDown(vel: Vector3) {
    this.held = false;
    if (!this.alive) return;
    this.applyHit(9999, "torso", vel.normalizeToNew(), this.collider.position.clone(), { kind: "melee", force: 1, launch: vel });
  }
  /** the ice gives: he goes down with it */
  shatter() {
    this.iceT = 0;
    if (!this.alive) return;
    const c = this.collider.position;
    this.applyHit(9999, "torso", new Vector3(0, -1, 0), c.clone(), { kind: "melee", force: 0.2 });
  }

  // ======================================================================= damage
  applyHit(damage: number, zone: BodyZone, dir: Vector3, point: Vector3, info: HitInfo = { kind: "bullet" }): boolean {
    if (!this.alive || this.dormant) return false;
    if (this.boss) {
      // the commander wears plates and a lot of nerve: body shots count for less, a headshot isn't
      // the end, and no single hit (a backstab, a rocket) takes more than a slice
      damage *= zone === "head" ? BOSS.headScale : BOSS.bodyScale;
      damage = Math.min(damage, BOSS.maxHit);
    }
    this.health -= damage;
    if (this.boss && this.health > 0) {
      const f = this.health / this.maxHealth;
      const phase = f > 0.66 ? 0 : f > 0.33 ? 1 : 2;
      if (phase !== this.phase) {
        this.phase = phase;
        this.rage = phase === 1 ? 0.5 : 1;
        this.nades += 1;
        this.ctx.onBossPhase?.(this, phase);
      }
    }
    const side = Math.sign(dir.x * Math.cos(this.yaw) - dir.z * Math.sin(this.yaw)) || 1;
    this.hitPitch.impulse(zone === "head" ? -9 : -5);
    this.hitYaw.impulse(side * 4);
    // being shot gives away the shooter's position
    this.lastKnown.copyFrom(this.ctx.player.feet);
    this.lastSeen = this.ctx.time;
    if (this.state !== "ATTACK") this.enterAttack();
    this.repositionTimer = Math.min(this.repositionTimer, rand(0.2, 0.8));
    if (this.health <= 0) {
      this.lastHeadshot = zone === "head";
      this.killInfo = { dir: new Vector3(dir.x, dir.y, dir.z), point: new Vector3(point.x, point.y, point.z), damage, zone, info };
      this.die(dir);
      return true;
    }
    // a rifle butt to the chest knocks him back a step
    if (info.kind === "melee") {
      this.velX += dir.x * 3.4 * (info.force ?? 1);
      this.velZ += dir.z * 3.4 * (info.force ?? 1);
      this.meleeCd = Math.max(this.meleeCd, 0.8);
    }
    // important hits flinch (not every graze — they'd never get a shot off)
    if (this.skin && this.flinchCd <= 0 && (damage >= REFLEX.flinchDamage || zone === "head" || info.kind === "melee") && !this.busy) {
      this.flinchCd = REFLEX.flinchCooldown;
      if (Math.random() < 0.5) this.ctx.bark?.(this, "hit");
      this.skin.ctrl.flinch(damage / 40 + (info.kind === "melee" ? 0.5 : 0));
      if (damage >= 30 || info.kind === "melee") {
        this.burstLeft = 0;
        this.endBurst();
      }
      // caught in the open standing still: step out of the line of fire
      if (info.kind === "bullet" && !this.atCover && this.curSpeed < 0.4 && this.reloadT < 0 && Math.random() < REFLEX.sideStepChance) {
        const key: ActionKey = Math.random() < 0.5 ? "stepL" : "stepR";
        if (this.sideClear(key === "stepR" ? 1 : -1, 1.0)) this.skin.ctrl.play(key);
      }
    }
    return false;
  }

  private die(dir: Vector3) {
    this.state = "DEAD";
    this.deathT = 0;
    this.endBurst();
    this.reloadT = -1;
    this.collider.checkCollisions = false;
    this.parts.flash.setEnabled(false);
    if (this.nadeProp) this.nadeProp.setEnabled(false);
    const fwdX = Math.sin(this.yaw);
    const fwdZ = Math.cos(this.yaw);
    this.deathDir = fwdX * dir.x + fwdZ * dir.z > 0 ? 1 : -1;
    this.deathTwist = rand(-0.6, 0.6);
    this.ctx.onKilled(this, this.lastHeadshot);

    // ---- physics death: a short scripted stagger (body shots), then Havok takes over
    if (this.skin && this.ctx.physics?.ready) {
      this.ragdollPath = true;
      this.ragdollStarted = false;
      this.ragdollT = 0;
      this.hasPrev = false;
      const k = this.killInfo!;
      const heavy = k.zone === "head" || k.info.kind === "blast" || k.info.kind === "melee" || this.curSpeed > 2.5;
      this.deathLead = heavy ? 0 : RAGDOLL.leadIn * rand(0.8, 1.25);
      if (this.deathLead > 0) {
        // stagger away from the shot: shot from the front → fall back, from a side → that way, from behind → forward
        const rx = Math.cos(this.yaw), rz = -Math.sin(this.yaw);
        const along = fwdX * dir.x + fwdZ * dir.z;
        const across = rx * dir.x + rz * dir.z;
        const key: ActionKey = Math.abs(across) > Math.abs(along) * 1.2 ? "deathR" : along > 0 ? "deathB" : "deathF";
        this.skin.ctrl.reset();
        this.skin.ctrl.play(key);
      }
      return;
    }

    // ---- fallback: procedural fall on the driver skeleton
    this.skin?.enterDriver();
    const g = this.parts.gun;
    g.computeWorldMatrix(true);
    const wp = g.getAbsolutePosition().clone();
    if (g.rotationQuaternion) {
      g.rotation.copyFrom(g.absoluteRotationQuaternion.toEulerAngles());
      g.rotationQuaternion = null;
    } else g.rotation.set(0, this.yaw, 0);
    g.parent = null;
    g.position.copyFrom(wp);
    g.scaling.setAll(1);
    this.dropVel.set(dir.x * 1.2 + rand(-0.5, 0.5), 1.2, dir.z * 1.2 + rand(-0.5, 0.5));
    this.dropDone = false;
  }

  /** a blast near a body that's already down */
  blastCorpse(pos: Vector3, radius: number) {
    if (this.ragdollLive && this.skin) this.skin.ragdoll.blast(pos, radius, RAGDOLL.blastImpulse);
  }
  /** the manager is out of ragdoll slots: stop simulating this one */
  get ragdollSettled() {
    return !this.ragdollLive || !this.skin || this.skin.ragdoll.settled;
  }
  freezeRagdoll() {
    if (this.skin && this.ragdollLive) {
      this.skin.ragdoll.freeze();
      this.ragdollLive = false;
    }
  }

  // ======================================================================= perception
  /**
   * A noise: gunfire / a blast (`gunfire`) or the player's footsteps (`step`). Certain = close enough
   * to know exactly where — engage. Otherwise turn towards it and go and find out: gunfire brings
   * them in at a run, footsteps get a cautious look.
   */
  hear(pos: Vector3, certain: boolean, kind: "gunfire" | "step" = "gunfire") {
    if (this.ctx.passive) return;
    if (!this.alive || this.dormant) return;
    if (this.state === "ATTACK") {
      // already fighting: only update where to look if he's lost sight of you
      if (!this.canSee) this.lastKnown.copyFrom(pos);
      return;
    }
    const moved = Vector3.DistanceSquared(this.lastKnown, pos) > 16;
    this.lastKnown.copyFrom(pos);
    if (!certain) {
      const j = kind === "step" ? 1.5 : 2.5;
      this.lastKnown.x += rand(-j, j);
      this.lastKnown.z += rand(-j, j);
    }
    this.awareness = Math.max(this.awareness, kind === "step" ? 0.45 : 0.65);
    if (certain) {
      this.enterAttack();
      return;
    }
    if (kind === "gunfire") this.investigate = true;
    if (this.state !== "ALERT") this.setState("ALERT");
    else {
      if (moved) this.repath = true;
      this.stateTime = Math.min(this.stateTime, 0.5);
    }
  }

  /**
   * Where to go when moving in on a noise: a nav point short of it, chosen by his squad role — the
   * rifleman comes straight in, the flankers swing round either side (~80° off), the support gunner
   * stops farther back in cover — and never on top of a spot a squad mate is already heading for,
   * so a squad converges from different angles, spread out, instead of queueing in a clump.
   */
  private approachPoint(): Vector3 {
    const t = this.lastKnown;
    const c = this.collider.position;
    const off = this.role === "flankL" ? -1.35 : this.role === "flankR" ? 1.35 : 0;
    const stop = ENEMY.approachStop + (this.role === "support" ? 6 : this.role === "assault" ? 0 : 2);
    const want = Math.atan2(c.x - t.x, c.z - t.z) + off;
    let best: Vector3 | null = null;
    let bestScore = Infinity;
    for (const n of this.ctx.nav.nodes) {
      const dx = n.p.x - t.x, dz = n.p.z - t.z;
      const d = Math.hypot(dx, dz);
      if (d < 4 || d > stop + 6 || Math.abs(n.p.y - t.y) > 2.5) continue;
      const ang = Math.abs(wrapAngle(Math.atan2(dx, dz) - want));
      const score = Math.abs(d - stop * 0.85) + ang * 4 + (n.cover ? (this.role === "support" ? -3 : -1.5) : 0) + this.crowding(n.p, 4) * 7;
      if (score < bestScore) {
        bestScore = score;
        best = n.p;
      }
    }
    return best ?? t;
  }

  /** how crowded a spot is: squad mates standing on or heading for it (0 = free, ~1 per mate) */
  private crowding(p: Vector3, r: number) {
    let k = 0;
    for (const o of this.ctx.squad ?? []) {
      if (o === this || !o.alive) continue;
      const q = o.claim;
      const d = Math.hypot(q.x - p.x, q.z - p.z);
      if (d < r && Math.abs(q.y - p.y) < 2.5) k += 1 - d / r;
    }
    return k;
  }

  private eye() {
    const c = this.collider.position;
    // leaning out: the head moves sideways past the cover edge (body yaw right = (cos, -sin))
    const l = this.leanT * TACTICS.leanReach;
    return this.eyeV.set(c.x + Math.cos(this.yaw) * l, c.y - ENEMY.halfHeight + lerp(ENEMY.eyeHeight, ENEMY.crouchEyeHeight, this.crouchT) - Math.abs(l) * 0.27, c.z - Math.sin(this.yaw) * l);
  }

  /**
   * Standing in cover: if rising doesn't clear the cover (a wall corner, a pillar), find the side to
   * lean out of — the side where a head offset sideways has a clear line to the player.
   */
  private pickLean(pl: PlayerController) {
    const c = this.collider.position;
    const y = c.y - ENEMY.halfHeight + ENEMY.eyeHeight;
    const pe = pl.eye;
    this.tmp2.set(c.x, y, c.z);
    if (this.ctx.nav.clear(this.tmp2, pe)) return 0;
    const rx = Math.cos(this.yaw), rz = -Math.sin(this.yaw);
    const first = Math.random() < 0.5 ? -1 : 1;
    for (const s of [first, -first]) {
      const r = TACTICS.leanReach * s;
      // room for the head beside the body, then a clear shot from there
      this.tmp2.set(c.x + rx * r, y, c.z + rz * r);
      this.tmp.set(c.x, y, c.z);
      if (!this.ctx.nav.clear(this.tmp, this.tmp2)) continue;
      if (this.ctx.nav.clear(this.tmp2, pe)) return s;
    }
    return 0;
  }

  private perceive(dt: number) {
    const pl = this.ctx.player;
    if (!pl.alive || this.ctx.passive || this.blindT > 0) {
      this.canSee = false;
      return;
    }
    const eye = this.eye();
    const pe = pl.eye;
    const dx = pe.x - eye.x;
    const dz = pe.z - eye.z;
    const dist = Math.hypot(dx, dz);
    let visible = false;
    // cheap tests first (range, field of view), the ray last
    if (dist < ENEMY.visionRange) {
      const ang = Math.abs(wrapAngle(Math.atan2(dx, dz) - this.yaw));
      const fovOk = ang < (ENEMY.visionFovDeg * DEG) / 2 || dist < ENEMY.closeSenseRange || this.state === "ATTACK";
      if (fovOk) {
        visible = this.ctx.nav.clear(eye, pe);
        if (!visible) {
          this.tmp.copyFrom(pe);
          this.tmp.y -= pl.prone ? 0.12 : pl.crouched ? 0.35 : 0.65;
          visible = this.ctx.nav.clear(eye, this.tmp);
        }
      }
    }
    const was = this.canSee;
    this.canSee = visible;
    if (visible) {
      if (!was) this.seenSince = this.ctx.time;
      this.lastKnown.copyFrom(pl.feet);
      this.lastSeen = this.ctx.time;
      if (this.state !== "ATTACK") {
        const near = 1 + 22 / Math.max(3, dist);
        const stance = pl.prone ? 0.32 : pl.crouched ? 0.55 : pl.sprinting ? 1.35 : 1;
        const alertBoost = this.state === "ALERT" || this.state === "SEARCH" ? 2.2 : 1;
        const arriving = this.ctx.grace && this.ctx.grace > 0 && dist > 6 ? 0 : 1;
        this.awareness += ENEMY.detectRate * dt * near * 0.3 * stance * alertBoost * arriving;
        if (this.awareness >= 1) this.enterAttack();
        else if (this.awareness > 0.35 && this.state !== "ALERT") this.setState("ALERT");
      }
    } else if (this.state === "IDLE" || this.state === "PATROL") {
      this.awareness = Math.max(0, this.awareness - dt * 0.15);
    }
  }

  private enterAttack() {
    const fresh = this.state !== "ATTACK";
    this.setState("ATTACK");
    this.awareness = 1;
    if (fresh) {
      const pf = this.ctx.player.feet, me = this.collider.position;
      this.flankBase = Math.atan2(me.x - pf.x, me.z - pf.z);
      this.repositionTimer = rand(0.1, 0.6) + (this.role === "support" ? 0 : this.role === "assault" ? 0.2 : 0.5);
      this.burstCooldown = ENEMY.reactionTime * difficulty.k.reaction + rand(0, 0.35);
      if (this.ctx.audio.canPlay("radio" + this.index, 4)) {
        const p = this.collider.position;
        this.ctx.audio.play("radioChirp", { x: p.x, y: p.y + 0.6, z: p.z, volume: 0.5 });
      }
      this.ctx.bark?.(this, "contact");
      this.ctx.alertAllies(this);
    }
  }

  private setState(s: AIState) {
    if (this.state === s) return;
    this.state = s;
    this.stateTime = 0;
    if (s !== "ALERT") {
      this.investigate = false;
      this.repath = false;
    }
    this.atCover = false;
    this.tacSpeed = 0;
    if (s !== "ATTACK") {
      this.wantCrouch = false;
      this.burstLeft = 0;
    }
  }

  // ======================================================================= decisions (~8 Hz)
  think(dt: number) {
    if (!this.alive) return;
    this.stateTime += dt;
    this.flinchCd -= dt;
    this.meleeCd -= dt;
    if (this.blindT > 0) {
      // blinded: stop, stumble, cover the eyes; nothing else happens until vision returns
      this.canSee = false;
      this.stop();
      this.tacSpeed = 0;
      this.wantAim = 0;
      this.burstLeft = 0;
      this.faceYaw = this.yaw + rand(-0.6, 0.6);
      return;
    }
    this.perceive(dt);
    if (this.busy) return; // mid-roll / mid-strike: the body is committed
    if (this.dodgeGrenades()) return;
    if (this.mag < 12 && !this.canSee && this.reloadT < 0 && this.ctx.time - this.lastSeen > 0.8) this.startReload();
    const pl = this.ctx.player;
    const now = this.ctx.time;
    // a cutscene's orders: walk the path given, then stand facing the way given
    if (this.scripted) {
      this.wantAim = 0;
      if (this.pathIdx >= this.path.length) this.moveSpeed = 0;
      return;
    }

    switch (this.state) {
      case "IDLE":
        this.wantAim = 0;
        this.stop();
        this.waitTimer -= dt;
        if (this.waitTimer <= 0) {
          this.waitTimer = rand(2.5, 5);
          if (this.spawn.route?.length) this.setState("PATROL");
          else this.faceYaw = this.spawn.yaw + rand(-0.8, 0.8);
        }
        break;
      case "PATROL": {
        this.wantAim = 0;
        const route = this.spawn.route!;
        if (!this.path.length || this.pathIdx >= this.path.length) {
          this.waitTimer -= dt;
          if (this.waitTimer <= 0) {
            this.routeIdx = (this.routeIdx + 1) % route.length;
            this.goTo(route[this.routeIdx], ENEMY.walkSpeed);
            this.waitTimer = rand(1.5, 3.5);
          }
        }
        break;
      }
      case "ALERT": {
        this.wantAim = this.investigate ? 0.9 : 0.7;
        this.faceTowards(this.lastKnown);
        const d = this.distTo(this.lastKnown);
        // a beat to react (staggered across the squad), then move
        // the squad doesn't move off as one: the rifleman first, flankers a beat later, support last
        const lag = this.role === "assault" ? 0 : this.role === "support" ? 0.9 : 0.45;
        const react = this.investigate ? 0.3 + lag + (this.index % 3) * 0.12 : 1.3 + lag * 0.5;
        if (this.stateTime > react && !this.spawn.anchored && (!this.isMoving() || this.repath)) {
          this.repath = false;
          if (this.investigate && d > ENEMY.approachStop) {
            // gunfire: run in (sprint from far away) to a point short of it…
            this.goTo(this.approachPoint(), d > TACTICS.sprintDistance * 2 ? TACTICS.sprintSpeed : TACTICS.runSpeed);
          } else {
            // …then the last stretch at a careful walk, weapon up — each to his own corner of it
            this.goTo(this.spreadNear(this.lastKnown, 5), ENEMY.walkSpeed * (this.investigate ? 1.25 : 1.15));
          }
        }
        const limit = this.investigate ? ENEMY.investigateTime : 12;
        if (this.stateTime > limit || (this.stateTime > 2 && !this.isMoving() && d < 2.5)) this.setState("SEARCH");
        break;
      }
      case "SEARCH":
        this.wantAim = 0.6;
        // just lost him behind cover: a frag to flush him out (if there's a clear throw)
        if (this.stateTime < 8 && this.awareness > 0.8 && this.tryGrenade(now)) break;
        if (!this.isMoving()) {
          this.waitTimer -= dt;
          if (this.waitTimer <= 0 && !this.spawn.anchored) {
            this.waitTimer = rand(1.5, 3);
            // each searches his own patch, not the one a squad mate is already checking
            const near = this.randomNodeNear(this.lastKnown, 12);
            if (near && this.crowding(near, 3) < 0.5) this.goTo(near, ENEMY.walkSpeed);
          } else this.faceYaw += rand(-0.6, 0.6) * dt * 4;
        }
        if (this.stateTime > ENEMY.searchTime) {
          this.awareness = 0.3;
          this.setState(this.spawn.route ? "PATROL" : "IDLE");
          if (!this.spawn.route) this.goTo(this.spawn.pos, ENEMY.walkSpeed);
        }
        break;
      case "ATTACK":
        this.thinkAttack(dt, now, pl);
        break;
    }
  }

  private thinkAttack(dt: number, now: number, pl: PlayerController) {
    this.wantAim = 1;
    if (!this.canSee && now - this.lastSeen > ENEMY.loseTargetTime) {
      // hiding? a grenade first, then go and look
      if (this.tryGrenade(now)) return;
      this.setState("SEARCH");
      this.ctx.bark?.(this, "search");
      this.awareness = 0.9;
      if (!this.spawn.anchored) this.goTo(this.lastKnown, TACTICS.runSpeed * 0.7);
      return;
    }
    this.faceTowards(this.canSee ? pl.feet : this.lastKnown);
    const dist = this.distTo(pl.feet);
    // out of sight a moment: the rifleman and the boss go and get you (still in the fight, rifle up)
    if (!this.canSee && (this.boss || this.role === "assault") && !this.spawn.anchored && !this.atCover && now - this.lastSeen > TACTICS.huntAfter && !this.isMoving()) {
      this.goTo(this.spreadNear(this.lastKnown, 2.5), TACTICS.runSpeed * 0.8);
      return;
    }

    // too close: rifle-butt
    if (this.canSee && dist < REFLEX.meleeRange && this.meleeCd <= 0 && this.reloadT < 0 && this.skin) {
      this.startMelee();
      return;
    }
    if (this.tryGrenade(now)) return;

    this.repositionTimer -= dt;
    const anchored = this.spawn.anchored;
    if (!anchored && (this.repositionTimer <= 0 || (dist < TACTICS.panicRange && !this.isMoving() && !this.atCover))) {
      this.repositionTimer = rand(ENEMY.repositionMin, ENEMY.repositionMax) * (1 - 0.5 * this.rage);
      const cover = this.findCover(pl);
      if (cover && Math.random() < 0.7) {
        const d = this.distTo(cover);
        this.goTo(cover, d > TACTICS.sprintDistance ? TACTICS.sprintSpeed : TACTICS.runSpeed);
        if (this.role === "flankL" || this.role === "flankR") this.ctx.bark?.(this, this.role);
        this.atCover = false;
        this.tacSpeed = 0;
      }
    }
    if (!this.isMoving() && this.path.length) this.atCover = true;

    if (this.atCover || anchored) {
      // peek cycle: crouch behind cover, rise to shoot, now and then shuffle along it
      this.peekTimer -= dt;
      this.tacSpeed = 0;
      if (this.peekTimer <= 0) {
        this.wantCrouch = !this.wantCrouch;
        this.peekTimer = this.wantCrouch ? rand(1.0, 2.0) : rand(1.8, 3.2);
        // rising to peek: over the top if that works, otherwise lean out round the side
        this.leanSide = this.wantCrouch ? 0 : this.pickLean(pl);
        if (!this.wantCrouch) {
          this.burstCooldown = Math.min(this.burstCooldown, 0.25);
          if (this.role === "support" && Math.random() < 0.2) this.ctx.bark?.(this, "suppress");
        }
        else if (!anchored && Math.random() < TACTICS.coverShuffleChance) {
          const s = Math.random() < 0.5 ? -1 : 1;
          if (this.sideClear(s, 1.4)) this.setTactic(s, 0, TACTICS.coverShuffleSpeed, true);
        }
      }
      if (this.wantCrouch && !this.coverBlocks(pl)) this.wantCrouch = false; // cover no longer valid
      // peeking but still blind to the player (he moved): try the other edge
      if (!this.wantCrouch && !this.canSee && this.leanSide === 0 && Math.random() < 0.3) this.leanSide = this.pickLean(pl);
    } else if (!this.isMoving() && !anchored) {
      this.wantCrouch = false;
      this.leanSide = 0;
      this.openGround(dt, dist);
    } else {
      this.wantCrouch = false;
      this.leanSide = 0;
    }
  }

  /**
   * In the open: keep a fighting distance and never stand still — strafe
   * (switching sides every 1–3 s or when blocked), back off when the player is
   * close, push in when he's far.
   */
  /** in a corridor (no room to strafe): the way along it he's working, kept a while (0: choose) */
  private alongDir = 0;
  /** the way along it that last ran into something, and when */
  private alongBlocked: { dir: number; t: number } | null = null;
  private openGround(dt: number, dist: number) {
    this.strafeTimer -= dt;
    if (this.strafeTimer <= 0) {
      this.strafeTimer = rand(TACTICS.strafeSwitch[0], TACTICS.strafeSwitch[1]);
      this.alongDir = 0;
      this.strafeDir = Math.random() < 0.65 ? -this.strafeDir : this.strafeDir;
    }
    if (this.reloadT >= 0) {
      // reloading in the open: a slow sidestep, crouched — not a retreat
      this.setTactic(this.strafeDir, 0, TACTICS.coverShuffleSpeed * 0.8, true);
      if (!this.probe(this.tacX, this.tacZ, TACTICS.strafeProbe)) this.tacSpeed = 0;
      return;
    }
    let fwd = 0;
    let speed: number = TACTICS.strafeSpeed;
    // (no falling back: only right on top of you a step back — inside a rifle-butt's reach he strikes)
    const pushes = this.boss || this.role === "assault";
    if (dist < TACTICS.panicRange) {
      fwd = -1;
      speed = TACTICS.backpedalSpeed;
    } else if ((dist > TACTICS.maxRange || (pushes && dist > TACTICS.assaultPushRange) || (this.rage > 0.9 && dist > 6)) && this.canSee) {
      // (the rifleman and the boss close in; an enraged boss all the way)
      fwd = 0.85;
      speed = TACTICS.advanceSpeed * (1 + 0.4 * this.rage);
    }
    const side = fwd === -1 ? 0.25 * this.strafeDir : this.strafeDir;
    this.setTactic(side, fwd, speed, false);
    if (!this.probe(this.tacX, this.tacZ, TACTICS.strafeProbe)) {
      // blocked: try the other side, then just hold
      this.strafeDir = -this.strafeDir;
      this.setTactic(-side, fwd, speed, false);
      if (!this.probe(this.tacX, this.tacZ, TACTICS.strafeProbe)) {
        // a corridor, no room either side: work up and down it rather than stand there — the boss and
        // the rifleman in to pistol range, anyone too close a step back, the rest a step in or out
        // (the way chosen is kept till the strafe timer runs out — picked fresh each frame it flipped
        // back and forth across the range line, a dither)
        if (this.alongDir === 0) {
          this.alongDir = pushes && dist > 4.5 ? 0.85 : dist < 3.5 ? -1 : this.strafeDir;
          // (not straight back into what just stopped him)
          const b = this.alongBlocked;
          if (b && this.ctx.time - b.t < 2 && Math.sign(this.alongDir) === b.dir) this.alongDir = -this.alongDir;
        }
        const along = fwd !== 0 ? fwd : this.alongDir;
        this.setTactic(0, along, fwd !== 0 ? speed : along < 0 ? TACTICS.backpedalSpeed : TACTICS.strafeSpeed * 0.7, false);
        if (!this.probe(this.tacX, this.tacZ, TACTICS.strafeProbe)) this.tacSpeed = 0;
      }
    }
  }

  /** body-relative tactical move (side = right +, fwd = toward the player +) */
  private setTactic(side: number, fwd: number, speed: number, crouch: boolean) {
    const fy = this.faceYaw;
    const fx = Math.sin(fy), fz = Math.cos(fy);
    const rx = Math.cos(fy), rz = -Math.sin(fy);
    let x = rx * side + fx * fwd;
    let z = rz * side + fz * fwd;
    const l = Math.hypot(x, z);
    if (l < 1e-3) {
      this.tacSpeed = 0;
      return;
    }
    x /= l;
    z /= l;
    this.tacX = x;
    this.tacZ = z;
    this.tacSpeed = speed;
    this.tacCrouch = crouch;
  }

  /** is the way (world dir x,z) clear for `dist` metres, with floor under it? */
  private probe(x: number, z: number, dist: number) {
    const c = this.collider.position;
    this.tmp2.set(c.x, c.y + 0.1, c.z);
    this.tmp.set(c.x + x * dist, c.y + 0.1, c.z + z * dist);
    if (!this.ctx.nav.clear(this.tmp2, this.tmp)) return false;
    return this.ctx.nav.floorAt(this.tmp.x, c.y - ENEMY.halfHeight, this.tmp.z) !== null;
  }
  private sideClear(side: number, dist: number) {
    const rx = Math.cos(this.yaw) * side, rz = -Math.sin(this.yaw) * side;
    return this.probe(rx, rz, dist);
  }

  private findCover(pl: PlayerController): Vector3 | null {
    const nav = this.ctx.nav;
    const me = this.collider.position;
    const pe = pl.eye;
    const cands = nav.nodes
      .filter((n) => n.cover && Math.abs(n.p.y - (me.y - ENEMY.halfHeight)) < 1.0)
      .map((n) => ({ n, d: Vector3.Distance(n.p, me), dp: Vector3.Distance(n.p, pl.feet) }))
      // (cover between you and him or level with him — never a spot further back: falling back to
      // cover reads as running away)
      .filter((c) => c.d < ENEMY.coverSearchRadius && c.dp > 4 && c.dp < 30 && c.dp <= Vector3.Distance(me, pl.feet) + 1.5)
      .sort((a, b) => a.d - b.d)
      .slice(0, 10);
    let best: Vector3 | null = null;
    let bestScore = Infinity;
    for (const c of cands) {
      // squad mates there or heading there? pick another spot (keep a few metres between men)
      const crowd = this.crowding(c.n.p, 3);
      if (crowd > 0.45) continue;
      this.tmp.set(c.n.p.x, c.n.p.y + 0.95, c.n.p.z);
      const covered = !nav.clear(pe, this.tmp);
      if (!covered) continue;
      this.tmp2.set(c.n.p.x, c.n.p.y + 1.55, c.n.p.z);
      let peek = nav.clear(this.tmp2, pe);
      if (!peek) {
        // a corner works too: lean out sideways (perpendicular to the line to the player)
        const dx = pe.x - c.n.p.x, dz = pe.z - c.n.p.z;
        const l = Math.hypot(dx, dz) || 1;
        for (const s of [-1, 1]) {
          this.tmp2.set(c.n.p.x + (dz / l) * TACTICS.leanReach * s, c.n.p.y + 1.5, c.n.p.z - (dx / l) * TACTICS.leanReach * s);
          if (nav.clear(this.tmp2, pe)) {
            peek = true;
            break;
          }
        }
      }
      // by role: the rifleman fights close, support from range, flankers from off to the side
      const ideal = this.role === "assault" ? 7 : this.role === "support" ? 14 : 10;
      let side = 0;
      if (this.role === "flankL" || this.role === "flankR") {
        const want = this.flankBase + (this.role === "flankL" ? -1.4 : 1.4);
        side = Math.abs(wrapAngle(Math.atan2(c.n.p.x - pl.feet.x, c.n.p.z - pl.feet.z) - want)) * 3;
      }
      const score = c.d + (peek ? 0 : 8) + Math.abs(c.dp - ideal) * 0.3 + side + crowd * 6 + rand(0, 2);
      if (score < bestScore) {
        bestScore = score;
        best = c.n.p;
      }
    }
    return best;
  }

  private coverBlocks(pl: PlayerController) {
    const c = this.collider.position;
    this.tmp.set(c.x, c.y - ENEMY.halfHeight + 0.95, c.z);
    return !this.ctx.nav.clear(pl.eye, this.tmp);
  }

  /** a free nav spot within r of p (nobody standing on or heading for it); p itself if none */
  private spreadNear(p: Vector3, r: number) {
    if (this.crowding(p, 2.5) < 0.2) return p;
    let best: Vector3 | null = null;
    let bestScore = Infinity;
    for (const n of this.ctx.nav.nodes) {
      const d = Vector3.Distance(n.p, p);
      if (d > r || Math.abs(n.p.y - p.y) > 1.5) continue;
      const score = this.crowding(n.p, 3) * 10 + d * 0.5 + Math.random();
      if (score < bestScore) {
        bestScore = score;
        best = n.p;
      }
    }
    return best ?? p;
  }

  private randomNodeNear(p: Vector3, r: number) {
    const list = this.ctx.nav.nodes.filter((n) => Vector3.Distance(n.p, p) < r);
    return list.length ? list[(Math.random() * list.length) | 0].p : null;
  }

  private goTo(target: Vector3, speed: number) {
    const nav = this.ctx.nav;
    const from = nav.nearest(this.feetPos(this.tmp2), true);
    const to = nav.nearest(target, false);
    const nodes = nav.path(from, to);
    const path = nodes.length ? [...nodes] : [];
    // finish at the exact target if it's directly reachable from the last node
    const last = path.length ? path[path.length - 1] : this.feetPos(this.tmp2);
    if (Vector3.Distance(last, target) > 0.6 && Math.abs(last.y - target.y) < 0.6) {
      this.tmp.set(last.x, last.y + 0.6, last.z);
      const tt = target.add(new Vector3(0, 0.6, 0));
      if (nav.clear(this.tmp, tt)) path.push(target.clone());
    }
    this.path = path;
    this.pathIdx = 0;
    this.dest = target.clone();
    this.moveSpeed = speed;
    this.stuckTimer = 0;
    this.tacSpeed = 0;
  }

  private stop() {
    this.dest = null;
    this.path = [];
    this.pathIdx = 0;
    this.moveSpeed = 0;
  }
  private isMoving() {
    return this.pathIdx < this.path.length;
  }
  private feetPos(out: Vector3) {
    const c = this.collider.position;
    return out.set(c.x, c.y - ENEMY.halfHeight, c.z);
  }
  private distTo(p: Vector3) {
    const c = this.collider.position;
    return Math.hypot(p.x - c.x, p.z - c.z);
  }
  private faceTowards(p: Vector3) {
    const c = this.collider.position;
    this.faceYaw = Math.atan2(p.x - c.x, p.z - c.z);
  }

  // ======================================================================= reflexes
  /** a grenade is about to go off close by: dive-roll away (or sprint) */
  private dodgeGrenades() {
    const list = this.ctx.threats?.();
    if (!list?.length || !this.skin) return false;
    const c = this.collider.position;
    for (const t of list) {
      if (this.dodged.has(t.key)) continue;
      const dx = c.x - t.pos.x, dz = c.z - t.pos.z;
      const d = Math.hypot(dx, dz);
      if (d > REFLEX.dodgeRadius || t.fuse > 2.4 || Math.abs(t.pos.y - (c.y - ENEMY.halfHeight)) > 2.5) continue;
      this.dodged.add(t.key);
      if (Math.random() > REFLEX.dodgeChance) continue; // froze
      const ax = dx / (d || 1), az = dz / (d || 1);
      this.burstLeft = 0;
      this.endBurst();
      this.stop();
      this.tacSpeed = 0;
      this.wantCrouch = false;
      if (this.probe(ax, az, REFLEX.dodgeClear)) {
        // dive along the escape direction
        this.yaw = this.faceYaw = Math.atan2(ax, az);
        this.skin.ctrl.play("roll");
      } else {
        // try either side of it, else just run
        for (const s of [1, -1]) {
          const sx = ax * Math.cos(s) + az * Math.sin(s), sz = -ax * Math.sin(s) + az * Math.cos(s);
          if (this.probe(sx, sz, REFLEX.dodgeClear)) {
            this.yaw = this.faceYaw = Math.atan2(sx, sz);
            this.skin.ctrl.play("roll");
            return true;
          }
        }
        this.tmp3.set(c.x + ax * 6, c.y - ENEMY.halfHeight, c.z + az * 6);
        this.goTo(this.tmp3, TACTICS.sprintSpeed);
      }
      return true;
    }
    return false;
  }

  private startMelee() {
    this.meleeCd = REFLEX.meleeCooldown;
    this.burstLeft = 0;
    this.endBurst();
    this.stop();
    this.tacSpeed = 0;
    this.wantCrouch = false;
    this.skin!.ctrl.play(Math.random() < 0.55 ? "whip" : "stab");
    const c = this.collider.position;
    this.ctx.audio.play("meleeSwing", { x: c.x, y: c.y + 0.5, z: c.z, volume: 0.7, pitchVar: 0.08 });
  }

  /** the strike frame: did it connect? */
  private meleeStrike() {
    const pl = this.ctx.player;
    if (!pl.alive) return;
    const c = this.collider.position;
    const dx = pl.feet.x - c.x, dz = pl.feet.z - c.z;
    const d = Math.hypot(dx, dz);
    const facing = (dx * Math.sin(this.yaw) + dz * Math.cos(this.yaw)) / Math.max(0.01, d);
    if (d < REFLEX.meleeHitRange && facing > 0.35) {
      pl.takeDamage(REFLEX.meleeDamage * rand(0.85, 1.15), c);
      pl.shake(0.85);
      this.ctx.audio.play("meleeHit", { volume: 0.9, pitchVar: 0.06 });
    }
  }

  /**
   * Player's been hiding: lob a frag at where he is (or was last seen). A soldier only throws when
   * he can see the throw through — the arc must clear walls, ceilings and door frames all the way
   * to the target, and land well away from himself and his squad. No clear arc, no throw.
   */
  private tryGrenade(now: number) {
    if (!this.skin || this.nades <= 0 || this.reloadT >= 0 || this.skin.ctrl.throwing || !this.ctx.throwGrenade) return false;
    const hidden = now - this.lastSeen;
    if (this.canSee || hidden < REFLEX.grenadeHiddenFor || hidden > 12) return false;
    const target = this.grenadeTarget(new Vector3());
    const d = this.distTo(target);
    if (d < REFLEX.grenadeRange[0] || d > REFLEX.grenadeRange[1]) return false;
    if (Math.random() > REFLEX.grenadeChance) return false;
    if (this.ctx.grenadeReady && !this.ctx.grenadeReady()) return false;
    // friendlies near the target? don't
    if (this.ctx.squad?.some((o) => o !== this && o.alive && Vector3.DistanceSquared(o.position, target) < 6 * 6)) return false;
    // the arc from about where his hand will be
    const c = this.collider.position;
    const ang = Math.atan2(target.x - c.x, target.z - c.z);
    this.tmp2.set(c.x + Math.sin(ang) * 0.35, c.y + 0.75, c.z + Math.cos(ang) * 0.35);
    if (!this.planThrow(this.tmp2, target)) {
      // no clear arc onto him: onto the floor just short of him or round the corner he's behind
      // (a doorway, the end of a wall) — close enough to flush him out
      let found = false;
      const base = target.clone();
      for (let k = 0; k < 8 && !found; k++) {
        const a2 = ang + Math.PI + (k / 8) * Math.PI * 2;
        const r2 = k % 2 ? 2.2 : 3.2;
        const x = base.x + Math.sin(a2) * r2, z = base.z + Math.cos(a2) * r2;
        const fy = this.ctx.nav.floorAt(x, base.y + 0.5, z, 1.2);
        if (fy === null) continue;
        this.tmp.set(x, fy, z);
        // the blast must still reach him from there
        this.tmp3.set(x, fy + 0.4, z);
        if (!this.ctx.nav.clear(this.tmp3, this.ctx.player.eye)) continue;
        if (this.planThrow(this.tmp2, this.tmp)) {
          target.copyFrom(this.tmp);
          found = true;
        }
      }
      if (!found) return false;
    }
    if (!this.ctx.grenadeClock?.()) return false;
    this.nades--;
    this.throwTarget.copyFrom(target);
    this.stop();
    this.tacSpeed = 0;
    this.wantCrouch = false;
    this.faceTowards(this.throwTarget);
    this.burstLeft = 0;
    this.endBurst();
    this.skin.ctrl.throwGrenade();
    this.ctx.bark?.(this, "grenade");
    if (!this.nadeProp) this.nadeProp = this.ctx.grenadeProp?.() ?? null;
    this.nadeProp?.setEnabled(true);
    return true;
  }

  /** where to throw: the player himself if he was seen moments ago, else his last known spot */
  private grenadeTarget(out: Vector3) {
    const pl = this.ctx.player;
    if (this.ctx.time - this.lastSeen < 4 && pl.alive) return out.copyFrom(pl.feet);
    return out.copyFrom(this.lastKnown);
  }

  /**
   * A throw velocity whose arc reaches `to` without striking anything first (tries a flat throw up
   * to a high lob), or null. The landing must be ≥ 7 m from the thrower.
   */
  private planThrow(from: Vector3, to: Vector3): Vector3 | null {
    const nav = this.ctx.nav;
    const dh0 = Math.hypot(to.x - from.x, to.z - from.z);
    if (dh0 < 7) return null;
    // land a couple of metres short: a frag skips and rolls on to the target
    const short = Math.min(2.2, dh0 * 0.15);
    const tx = to.x - ((to.x - from.x) / dh0) * short, ty = to.y + 0.15, tz = to.z - ((to.z - from.z) / dh0) * short;
    const dh = dh0 - short;
    const a = new Vector3(), b = new Vector3();
    for (const t of [clamp(dh / 12, 0.6, 1.1), clamp(dh / 10, 0.75, 1.5), clamp(dh / 8, 0.9, 1.9)]) {
      const vx = (tx - from.x) / t, vz = (tz - from.z) / t, vy = (ty - from.y) / t + 0.5 * 9.81 * t;
      let ok = true;
      a.copyFrom(from);
      const N = 14;
      for (let i = 1; i <= N && ok; i++) {
        const s = (t * i) / N;
        b.set(from.x + vx * s, from.y + vy * s - 0.5 * 9.81 * s * s, from.z + vz * s);
        // striking something is fine only on the way down, right at the target (floor, a wall behind him)
        const hit = nav.rayLevel(a, b) >= 0 || (this.ctx.throwClear ? !this.ctx.throwClear(a, b) : false);
        if (hit && Math.hypot(b.x - tx, b.z - tz) > 2.2) ok = false;
        a.copyFrom(b);
      }
      if (ok) return new Vector3(vx, vy, vz);
    }
    return null;
  }

  private releaseGrenade() {
    this.nadeProp?.setEnabled(false);
    const from = this.skin!.handPos("L", this.tmp3).clone();
    from.y = Math.max(from.y, this.collider.position.y + 0.6);
    // re-aim at him if he's in the open now, else the planned spot
    const target = this.tmp2.copyFrom(this.throwTarget);
    if (this.canSee) target.copyFrom(this.ctx.player.feet);
    const err = Vector3.Distance(from, target) * 0.045;
    target.x += rand(-err, err);
    target.z += rand(-err, err);
    const vel = this.planThrow(from, target) ?? this.planThrow(from, this.throwTarget);
    if (!vel) {
      // the arc closed up mid-wind-up (a door swung, he turned into a wall): keep the grenade
      this.nades++;
      return;
    }
    this.ctx.throwGrenade!(from, vel, this);
  }

  // ======================================================================= per frame
  update(dt: number) {
    if (this.state === "DEAD") {
      this.updateDeath(dt);
      return;
    }
    if (this.blindT > 0) {
      this.blindT = Math.max(0, this.blindT - dt);
      this.wantAim = 0;
      this.burstLeft = 0;
    }
    this.locomotion(dt);
    this.keepOutOfWalls(dt);
    this.combat(dt);
    this.updateReload(dt);
    const moving = this.isMoving() || this.tacSpeed > 0.05;
    this.crouchT += ((this.wantCrouch && (!moving || this.tacCrouch) ? 1 : 0) - this.crouchT) * damp(7, dt);
    if (moving || this.state !== "ATTACK" || this.blindT > 0) this.leanSide = 0;
    this.leanT += (this.leanSide * (1 - this.crouchT) - this.leanT) * damp(8, dt);
    this.aimT += (this.wantAim - this.aimT) * damp(6, dt);
    this.stepOff *= Math.exp(-14 * dt);
    this.applyRoot(true);
    if (this.skin) {
      this.hp = this.hitPitch.update(dt) * 0.03;
      this.hy = this.hitYaw.update(dt) * 0.03;
      this.rc = this.recoil.update(dt) * 0.02;
      this.gait(dt);
      this.poseSkin(dt, this.busy || this.skin.ctrl.throwing);
      if (this.nadeProp?.isEnabled()) this.skin.handPos("L", this.nadeProp.position);
    } else {
      this.animate(dt);
      if (this.blindT > 0) this.coverEyes();
    }
  }

  /**
   * Wall watchdog. Whatever moved the body this frame — walking, a squad mate's shove, a dive-roll's
   * root motion, a step-up — it may never end up through or inside a wall: a move that crossed
   * solid geometry is undone, and a body found embedded (a door swung onto him, a voxel seam) is
   * put back on the nearest clear spot of the walkable floor.
   */
  private keepOutOfWalls(dt: number) {
    const c = this.collider.position;
    const nav = this.ctx.nav;
    const moved2 = Vector3.DistanceSquared(c, this.safePos);
    if (moved2 > 1e-4) {
      const d = Math.sqrt(moved2);
      const hit = nav.moveRay(this.safePos, c, false);
      if (hit >= 0 && hit < d - 0.01) c.copyFrom(this.safePos);
      else this.safePos.copyFrom(c);
    }
    this.wallCheck -= dt;
    if (this.wallCheck > 0) return;
    this.wallCheck = 0.5;
    const feet = c.y - ENEMY.halfHeight;
    if (!nav.embedded(c.x, c.y, c.z) && !nav.embedded(c.x, feet + 0.35, c.z) && !nav.embedded(c.x, feet + 1.55, c.z)) return;
    let best: Vector3 | null = null;
    let bd = 15 * 15;
    for (const n of nav.nodes) {
      const d2 = (n.p.x - c.x) ** 2 + (n.p.z - c.z) ** 2 + (n.p.y - feet) ** 2 * 4;
      if (d2 >= bd || nav.embedded(n.p.x, n.p.y + 0.9, n.p.z)) continue;
      // not onto a squad mate
      if (this.ctx.squad?.some((o) => o !== this && o.alive && (o.position.x - n.p.x) ** 2 + (o.position.z - n.p.z) ** 2 < 1 && Math.abs(o.position.y - ENEMY.halfHeight - n.p.y) < 1)) continue;
      bd = d2;
      best = n.p;
    }
    if (!best) return;
    c.set(best.x, best.y + ENEMY.halfHeight + 0.02, best.z);
    this.safePos.copyFrom(c);
    this.velX = this.velZ = 0;
    this.animVX = this.animVZ = 0;
    if (this.isMoving()) this.goTo(this.path[this.path.length - 1], this.moveSpeed);
  }

  /** Feed the AI's intent to the skinned body (level of detail: far / unseen soldiers re-pose less often). */
  private poseSkin(dt: number, force = false) {
    if (!this.skin) return;
    this.skinDt += dt;
    this.skinTick++;
    const c = this.collider.position;
    const pe = this.ctx.player.eye;
    const dx = c.x - pe.x;
    const dz = c.z - pe.z;
    const d2 = dx * dx + dz * dz;
    const yaw = this.ctx.player.yaw;
    const ahead = (dx * Math.sin(yaw) + dz * Math.cos(yaw)) / Math.sqrt(d2 + 1e-6);
    // (posed every frame wherever you can see him — a pose every 2nd or 3rd frame made the limbs move
    // in jerks; behind you, or a speck 90 m off, less often)
    const every = d2 < 9 * 9 ? 1 : ahead < -0.35 ? 4 : d2 > 90 * 90 ? 2 : 1;
    if (!force && this.skinTick % every) return;
    const i = this.inp;
    i.dt = this.skinDt;
    this.skinDt = 0;
    const sy = Math.sin(this.yaw), cy = Math.cos(this.yaw);
    // (the legs follow his velocity no faster than he can really change it — his own deceleration;
    // a run cut dead against a wall or a shove snapped the gait from stride to stand in one frame)
    let ax = this.velX - this.animVX, az = this.velZ - this.animVZ;
    const al = Math.hypot(ax, az), lim = TACTICS.decel * i.dt;
    if (al > lim) {
      ax *= lim / al;
      az *= lim / al;
    }
    this.animVX += ax;
    this.animVZ += az;
    i.speed = Math.hypot(this.animVX, this.animVZ);
    i.vz = this.animVX * sy + this.animVZ * cy;
    i.vx = this.animVX * cy - this.animVZ * sy;
    i.aim = this.aimT;
    i.crouch = this.crouchT;
    i.lean = this.leanT;
    i.crouchMove = this.tacCrouch && this.tacSpeed > 0.05;
    i.reload = this.reloadT;
    i.blind = this.blindT > 0 ? saturate(Math.min(this.blindMax - this.blindT, this.blindT) / 0.25) : 0;
    i.hitPitch = this.hp;
    i.hitYaw = this.hy;
    i.recoil = this.rc;
    i.pistol = this.pistolW;
    i.aimAt = null;
    i.aimW = 0;
    if (this.alive && (this.state === "ATTACK" || this.state === "ALERT")) {
      const pl = this.ctx.player;
      if (this.state === "ATTACK" && (this.canSee || this.ctx.time - this.lastSeen < 1.5)) this.aimPoint.set(pl.eye.x, pl.eye.y - (pl.prone ? 0.08 : pl.crouched ? 0.2 : 0.38), pl.eye.z);
      else this.aimPoint.set(this.lastKnown.x, this.lastKnown.y + 1.25, this.lastKnown.z);
      i.aimAt = this.aimPoint;
      // the spine and neck can only turn so far: a target behind the shoulder isn't tracked, and a
      // running man carries the rifle the way he runs
      const off = Math.abs(wrapAngle(Math.atan2(this.aimPoint.x - c.x, this.aimPoint.z - c.z) - this.yaw));
      const reach = 1 - saturate((off - 1.0) / 0.7);
      const run = 1 - 0.6 * saturate((i.speed - 2.2) / 1.5);
      // (eased: a reload's start dropped the spine's aim from full to a quarter in one frame)
      this.reloadAim += ((this.reloadT >= 0 ? 0.25 : 1) - this.reloadAim) * Math.min(1, i.dt * 8);
      i.aimW = this.aimT * this.reloadAim * (1 - i.blind) * (this.skin.ctrl.throwing ? 0.3 : 1) * reach * run;
    }
    const out = this.skin.animate(i);
    if (!out) return;
    // root motion of scripted moves (roll, side step, stop, death stagger)
    if (out.rootX !== 0 || out.rootZ !== 0) {
      const rx = Math.cos(this.yaw), rz = -Math.sin(this.yaw);
      this.disp.set(rx * out.rootX + sy * out.rootZ, 0, rz * out.rootX + cy * out.rootZ);
      if (this.alive) this.collider.moveWithCollisions(this.disp);
      else this.collider.position.addInPlace(this.disp);
      this.applyRoot(this.alive);
    }
    if (out.event === "strike" && this.alive) this.meleeStrike();
    if (out.event === "release" && this.alive) this.releaseGrenade();
  }

  // ======================================================================= the sidearm
  get hasSidearm() {
    return !!this.skin?.sidearm;
  }
  private draw() {
    if (this.weapon === "pistol" || this.reloadT >= 0) return;
    this.weapon = "pistol";
    this.swapT = SWAP_TIME;
    this.farT = 0;
    this.weaponT = 0;
    if (this.pistolMag <= 0) this.pistolMag = PISTOL_MAG;
    const c = this.collider.position;
    this.ctx.audio.play("akMagIn", { x: c.x, y: c.y + 0.3, z: c.z, volume: 0.45, rate: 1.4 });
  }
  private holster() {
    if (this.weapon === "rifle") return;
    this.weapon = "rifle";
    this.swapT = SWAP_TIME;
    this.weaponT = 0;
    // (a fresh magazine in the sidearm for next time — he reloads it as he puts it away; the rifle
    // only if there's next to nothing left in it: a part-full rifle goes straight back to work)
    this.pistolMag = PISTOL_MAG;
    if (this.mag < 8) this.startReload();
  }
  /** when the pistol comes out and goes away (besides the rifle running dry) */
  private sidearmRules(dt: number) {
    const dist = this.distTo(this.ctx.player.feet);
    this.weaponT += dt;
    if (this.weapon === "rifle") {
      // you're close: the pistol (quicker to swing on you) — sooner the more pressed he is
      const close = 7 + 3 * this.phase;
      if (this.canSee && dist < close && this.weaponT > 3 && this.reloadT < 0 && this.swapT <= 0 && this.burstLeft <= 0 && Math.random() < dt * (this.mag < 18 ? 1.5 : 0.6)) this.draw();
      // mid-reload with you closing in: drop the reload, draw
      if (this.reloadT >= 0 && this.reloadT < 0.5 && this.canSee && dist < 9 && this.weaponT > 2) {
        this.reloadT = -1;
        this.draw();
      }
    } else {
      // you've backed off out of pistol range: the rifle again
      this.farT = dist > 15 ? this.farT + dt : 0;
      if (this.farT > 1.5 && this.burstLeft <= 0) this.holster();
    }
  }

  // ======================================================================= reload
  startReload() {
    if (this.reloadT >= 0 || !this.alive) return;
    this.reloadT = 0;
    if (this.state === "ATTACK") this.ctx.bark?.(this, "reload");
    this.burstLeft = 0;
    this.endBurst();
  }
  private updateReload(dt: number) {
    if (this.reloadT < 0) return;
    const prev = this.reloadT;
    this.reloadT += dt / RELOAD_TIME;
    const c = this.collider.position;
    const ev = (at: number, name: string, vol: number) => {
      if (prev < at && this.reloadT >= at) this.ctx.audio.play(name, { x: c.x, y: c.y + 0.4, z: c.z, volume: vol, pitchVar: 0.03 });
    };
    ev(RELOAD_EVENTS.magOut, "akMagOut", 0.75);
    ev(RELOAD_EVENTS.magIn, "akMagIn", 0.8);
    ev(RELOAD_EVENTS.bolt, "akBolt", 0.8);
    if (this.reloadT >= 1) {
      this.reloadT = -1;
      this.mag = ENEMY_MAG;
    }
  }
  /** string of rounds ended → the recorded echo tail */
  private endBurst() {
    if (this.burstShots >= 2) {
      const m = this.parts.muzzle.getAbsolutePosition();
      this.ctx.audio.play("akTail", { x: m.x, y: m.y, z: m.z, volume: 0.8, reverb: 0.4, pitchVar: 0.03 });
    }
    this.burstShots = 0;
  }

  private sep = new Vector3();
  private locomotion(dt: number) {
    const c = this.collider.position;
    let vx = 0;
    let vz = 0;
    const busy = this.busy;
    if (busy) {
      // a scripted move owns the body (its root motion moves us)
    } else if (this.isMoving()) {
      const t = this.path[this.pathIdx];
      const dx = t.x - c.x;
      const dz = t.z - c.z;
      const d = Math.hypot(dx, dz);
      const lastNode = this.pathIdx === this.path.length - 1;
      if (d < 0.45) this.pathIdx++;
      else if (lastNode && this.curSpeed > 3.2 && d < 1.25 && this.skin) {
        // arriving at a run: plant and stop (the clip carries the last metre)
        this.faceYaw = Math.atan2(dx, dz);
        this.yaw = this.faceYaw;
        this.skin.ctrl.play("stop");
        this.pathIdx = this.path.length;
      } else {
        let s = this.moveSpeed;
        if (this.state === "ATTACK" && this.canSee) {
          // you're in sight: a tactical jog with the rifle on you, a backstep if the way leads off —
          // never a run with his back to you
          const pf = this.ctx.player.feet;
          const tx = pf.x - c.x, tz = pf.z - c.z;
          const toward = (dx * tx + dz * tz) / (d * (Math.hypot(tx, tz) || 1));
          s = Math.min(s, toward < -0.35 ? TACTICS.combatBackSpeed : TACTICS.combatMoveSpeed);
        }
        vx = (dx / d) * s;
        vz = (dz / d) * s;
      }
      this.stuckTimer += dt;
      if (this.stuckTimer > 1.2) {
        if (Vector3.DistanceSquared(this.lastPos, c) < 0.2) this.pathIdx++; // skip blocked node
        this.lastPos.copyFrom(c);
        this.stuckTimer = 0;
      }
    } else if (this.tacSpeed > 0.05) {
      vx = this.tacX * this.tacSpeed;
      vz = this.tacZ * this.tacSpeed;
    }
    // keep apart from squad mates
    if (this.ctx.squad && !busy) {
      this.sep.setAll(0);
      // moving in as a squad they keep a few metres apart; in the fight, at least an arm's length
      const R = TACTICS.separation * (this.state === "ALERT" || this.state === "SEARCH" ? 2.6 : this.state === "ATTACK" ? 1.5 : 1);
      for (const o of this.ctx.squad) {
        if (o === this || !o.alive) continue;
        const ox = c.x - o.position.x, oz = c.z - o.position.z;
        const d2 = ox * ox + oz * oz;
        if (d2 > R * R || d2 < 1e-6) continue;
        const d = Math.sqrt(d2);
        const k = ((R - d) / R) * TACTICS.separationStrength;
        this.sep.x += (ox / d) * k;
        this.sep.z += (oz / d) * k;
      }
      vx += this.sep.x;
      vz += this.sep.z;
    }
    // acceleration / deceleration
    const want = Math.hypot(vx, vz);
    const cur = Math.hypot(this.velX, this.velZ);
    const rate = (want > cur ? TACTICS.accel : TACTICS.decel) * dt;
    let ddx = vx - this.velX, ddz = vz - this.velZ;
    const dl = Math.hypot(ddx, ddz);
    if (dl > rate) {
      ddx *= rate / dl;
      ddz *= rate / dl;
    }
    if (busy) {
      this.velX *= 1 - Math.min(1, dt * 10);
      this.velZ *= 1 - Math.min(1, dt * 10);
    } else {
      this.velX += ddx;
      this.velZ += ddz;
    }
    this.curSpeed = Math.hypot(this.velX, this.velZ);
    if (this.curSpeed > 0.01 && !busy) {
      if (this.curSpeed > 0.3) this.ctx.openDoor?.(c, this.velX / this.curSpeed, this.velZ / this.curSpeed);
      this.disp.set(this.velX * dt, 0, this.velZ * dt);
      const bx = c.x, bz = c.z;
      this.collider.moveWithCollisions(this.disp);
      let moved = Math.hypot(c.x - bx, c.z - bz);
      // a low step (box-built stairs): lift onto it and try again
      if (moved < this.curSpeed * dt * 0.4) {
        const sp = Math.hypot(this.disp.x, this.disp.z);
        const fx = c.x + (this.disp.x / sp) * (ENEMY.radius + 0.15), fz = c.z + (this.disp.z / sp) * (ENEMY.radius + 0.15);
        const feet = c.y - ENEMY.halfHeight;
        const fy = this.ctx.nav.floorAt(fx, feet + 0.45, fz, 0.47);
        if (fy !== null && fy - feet > 0.03 && fy - feet <= 0.45) {
          const sy = c.y;
          c.y = fy + ENEMY.halfHeight + 0.03;
          this.collider.moveWithCollisions(this.disp);
          moved = Math.hypot(c.x - bx, c.z - bz);
          if (moved < this.curSpeed * dt * 0.4) c.y = sy;
        }
      }
      // blocked (wall / prop): stop pushing into it, change strafe side
      if (moved < this.curSpeed * dt * 0.3 && this.tacSpeed > 0) {
        this.velX *= 0.3;
        this.velZ *= 0.3;
        this.strafeTimer = 0;
        if (this.alongDir !== 0) this.alongBlocked = { dir: Math.sign(this.alongDir), t: this.ctx.time };
      }
    }
    // ground snap (stairs/ramps), rate limited when idle
    this.groundTimer -= dt;
    if (this.curSpeed > 0.01 || busy || this.groundTimer <= 0) {
      this.groundTimer = 0.5;
      const fy = this.ctx.nav.floorAt(c.x, c.y - 0.5, c.z, ENEMY.halfHeight + 0.2);
      if (fy !== null) {
        const ty = fy + ENEMY.halfHeight + 0.02;
        // never "climb" furniture: only follow steps/ramps up to 0.45 m
        if (ty - c.y < 0.45) c.y += (ty - c.y) * Math.min(1, dt * 20 + (this.curSpeed > 0.01 ? 0 : 1));
      }
    }
    // Which way the body faces while moving — how people actually move: the hips and chest turn
    // into the direction of travel; only at a walking pace, in a fight with the target in sight,
    // does a soldier sidestep or back-step with his chest kept on the target. Never a run sideways
    // or backwards with the head turned over the shoulder.
    const sp = Math.hypot(vx, vz);
    if (!busy && sp > 0.25) {
      const moveYaw = Math.atan2(vx, vz);
      const off = Math.abs(wrapAngle(moveYaw - this.faceYaw));
      const engaged = this.state === "ATTACK" && this.canSee;
      const maxOff = sp > TACTICS.faceMoveAbove ? 0 : sp > 1.3 ? 1.65 : Math.PI;
      if (!engaged || off > maxOff) this.faceYaw = moveYaw;
    }
    // smooth turn: eased toward the wanted heading, capped rate (aim is separate — the spine tracks the target)
    if (!busy) {
      const dyaw = wrapAngle(this.faceYaw - this.yaw);
      const step = dyaw * Math.min(1, dt * TACTICS.turnSmooth);
      this.yaw += clamp(step, -TACTICS.turnRate * dt, TACTICS.turnRate * dt);
    }
  }

  private combat(dt: number) {
    if (this.flashTimer > 0) {
      this.flashTimer -= dt;
      if (this.flashTimer <= 0) this.parts.flash.setEnabled(false);
    }
    // the arms between rifle and sidearm (a draw or holster takes SWAP_TIME)
    this.pistolW += ((this.weapon === "pistol" ? 1 : 0) - this.pistolW) * Math.min(1, dt / (SWAP_TIME * 0.5));
    if (this.swapT > 0) this.swapT -= dt;
    if (this.state !== "ATTACK" || !this.ctx.player.alive) {
      // (out of the fight: the rifle back in his hands, loaded)
      if (this.weapon === "pistol" && this.state !== "ATTACK") this.holster();
      return;
    }
    this.burstCooldown -= dt;
    if (this.hasSidearm) this.sidearmRules(dt);
    // aimed: his body (and so his rifle) actually turned onto the player — not just settled on the
    // heading he wants, which while he backs off or runs for cover points the way he's going.
    // His spine twists the gun the last few degrees; no more than that.
    const pc = this.ctx.player.collider.position, me = this.collider.position;
    const onTarget = Math.abs(wrapAngle(Math.atan2(pc.x - me.x, pc.z - me.z) - this.yaw)) < 0.5;
    const aimed = onTarget && Math.abs(wrapAngle(this.faceYaw - this.yaw)) < 0.3 && this.aimT > 0.75;
    const canShoot = this.canSee && aimed && !this.busy && !this.skin?.ctrl.throwing && this.reloadT < 0 && this.swapT <= 0 && this.crouchT < 0.4 && this.ctx.time - this.seenSince > ENEMY.reactionTime * 0.6 * difficulty.k.reaction;
    const pistol = this.weapon === "pistol";
    if (this.burstLeft <= 0 && this.burstCooldown <= 0 && canShoot) {
      // (the pistol: two to four aimed shots, then a breath)
      this.burstLeft = pistol ? Math.round(rand(2, 4)) : Math.round(rand(ENEMY.burstMin, ENEMY.burstMax));
      this.burstTimer = 0;
    }
    if (this.burstLeft > 0) {
      this.burstTimer -= dt;
      if (this.burstTimer <= 0) {
        if (!canShoot) {
          this.burstLeft = 0;
          this.endBurst();
        } else {
          this.shoot();
          this.burstLeft--;
          this.burstTimer = pistol ? PISTOL_INTERVAL * rand(0.85, 1.2) : ENEMY.burstInterval * rand(0.95, 1.08);
          if (pistol && this.pistolMag <= 0) {
            // the sidearm's dry: back to the rifle (and reload it)
            this.burstLeft = 0;
            this.endBurst();
            this.holster();
          } else if (!pistol && this.mag <= 0) {
            this.burstLeft = 0;
            this.endBurst();
            // the rifle's dry with you right there: the pistol's quicker than a reload
            if (this.hasSidearm && this.canSee && this.distTo(this.ctx.player.feet) < 20) this.draw();
            else this.startReload();
          } else if (this.burstLeft === 0) {
            this.burstCooldown = rand(ENEMY.burstCooldownMin, ENEMY.burstCooldownMax) * (1 - 0.4 * this.rage);
            this.endBurst();
          }
        }
      }
    }
  }

  private lastShotAt = -99;
  /** fired within the last second (minimap ping) */
  get firing() {
    return this.ctx.time - this.lastShotAt < 1;
  }
  get blinded() {
    return this.blindT > 0;
  }

  shoot() {
    this.lastShotAt = this.ctx.time;
    const ctx = this.ctx;
    const pl = ctx.player;
    const m = this.parts.muzzle;
    m.computeWorldMatrix(true);
    const pistol = this.weapon === "pistol" && !!this.skin?.sidearm;
    const mp = pistol ? this.skin!.pistolMuzzle(this.tmp4) : m.getAbsolutePosition();
    const pe = pl.eye;
    const dist = Vector3.Distance(mp, pe);
    // accuracy: distance, the player's movement and stance, our own movement, first-burst warning
    let chance = ENEMY.baseHitChance;
    chance *= dist < 10 ? 1.25 : dist < 20 ? 1 : dist < 32 ? 0.7 : 0.45;
    if (pl.sprinting) chance *= 0.6;
    else if (pl.moveAmount > 0.3) chance *= 0.8;
    if (pl.prone) chance *= 0.6;
    else if (pl.crouched) chance *= 0.8;
    // peeking: only the head shows past the cover — a much smaller target
    const c = pl.collider.position;
    this.tmp2.set(c.x, c.y, c.z);
    const bodyHidden = Math.abs(pl.leanOffset) > 0.08 && !ctx.nav.clear(mp, this.tmp2);
    if (bodyHidden) chance *= 0.45;
    if (this.curSpeed > 2) chance *= 0.45;
    else if (this.curSpeed > 0.4) chance *= 0.65;
    const sinceSeen = ctx.time - this.seenSince;
    if (sinceSeen < 1.2) chance *= 0.45; // first burst after acquiring is a warning
    chance = Math.min(0.95, chance * difficulty.k.hitChance);
    const hit = Math.random() < chance;

    if (!this.flashHome) this.flashHome = this.parts.flash.position.clone();
    if (pistol) {
      // the sidearm: its own report, a flash at its own muzzle, a smaller kick
      this.parts.flash.setEnabled(true);
      this.parts.flash.setAbsolutePosition(mp);
      this.parts.flash.rotation.z = Math.random() * 6.28;
      this.flashTimer = 0.04;
      this.recoil.impulse(-1.6);
      ctx.audio.play("pistolShot", { x: mp.x, y: mp.y, z: mp.z, volume: 0.9, reverb: 0.3, pitchVar: 0.04 });
      this.pistolMag--;
    } else {
      if (this.flashHome) this.parts.flash.position.copyFrom(this.flashHome);
      this.parts.flash.setEnabled(true);
      this.parts.flash.rotation.z = Math.random() * 6.28;
      this.flashTimer = 0.05;
      this.recoil.impulse(-3);
      // recorded AK: first round with its full report, follow-ups as auto slices, tail when the string ends
      ctx.audio.play(this.burstShots === 0 ? "akShot" : "akAuto", { x: mp.x, y: mp.y, z: mp.z, volume: 0.85, reverb: 0.3, pitchVar: 0.025, rate: 1.03 });
      this.burstShots++;
      this.mag--;
    }

    // the round has to actually reach him: a door, wall or crate on the line stops it
    // (sight is only re-checked a few times a second; a door shut since then must still protect)
    let blocked: { point: Vector3; normal: Vector3; surface: string } | null = null;
    if (hit) {
      this.tmp.set(pe.x + rand(-0.2, 0.2), pe.y - (bodyHidden || pl.prone ? rand(0, 0.15) : rand(0.2, 0.6)), pe.z + rand(-0.2, 0.2));
      const dir = this.tmp3.copyFrom(this.tmp).subtractInPlace(mp);
      const len = dir.length();
      this.ray.origin.copyFrom(mp);
      this.ray.direction.copyFrom(dir.scaleInPlace(1 / Math.max(1e-4, len)));
      this.ray.length = len;
      const h = ctx.scene.pickWithRay(this.ray, (mm) => mm.metadata?.kind === HitKind.Level && mm.isPickable && mm.metadata?.glass === undefined, false);
      if (h?.hit && h.pickedPoint) blocked = { point: h.pickedPoint.clone(), normal: h.getNormal(true, false) ?? this.ray.direction.scale(-1), surface: (h.pickedMesh?.metadata?.surface as string) ?? "concrete" };
      else if (ctx.nav.rayLevel(mp, this.tmp) >= 0) blocked = { point: this.tmp.clone(), normal: this.ray.direction.scale(-1), surface: "concrete" };
    }
    if (blocked) {
      ctx.fx.tracer(mp, blocked.point);
      ctx.fx.impact(blocked.point, blocked.normal, blocked.surface as never, true);
    } else if (hit) {
      ctx.fx.tracer(mp, this.tmp);
      ctx.breakGlass?.(mp, this.tmp);
      pl.takeDamage(rand(ENEMY.damageMin, ENEMY.damageMax), this.collider.position);
    } else {
      // miss: aim at a point beside the player, continue through, impact the world (never through walls)
      const off = rand(0.6, 1.6);
      const ang = Math.random() * Math.PI * 2;
      this.tmp.set(pe.x + Math.cos(ang) * off, pe.y + Math.sin(ang) * off * 0.6 - 0.2, pe.z + Math.sin(ang) * off);
      const dir = this.tmp.subtract(mp).normalize();
      this.ray.origin.copyFrom(mp);
      this.ray.direction.copyFrom(dir);
      this.ray.length = 80;
      const h = ctx.scene.pickWithRay(this.ray, (mm) => mm.metadata?.kind === HitKind.Level && mm.isPickable, false);
      const end = h?.hit && h.pickedPoint ? h.pickedPoint : mp.add(dir.scale(80));
      ctx.breakGlass?.(mp, end);
      ctx.fx.tracer(mp, end);
      if (h?.hit && h.pickedPoint) {
        const n = h.getNormal(true, false) ?? dir.scale(-1);
        ctx.fx.impact(h.pickedPoint, n, (h.pickedMesh?.metadata?.surface as never) ?? "concrete", Vector3.Distance(h.pickedPoint, pe) < 12);
      }
      if (dist > 6 && ctx.audio.canPlay("whiz", 0.25) && Math.random() < 0.6) {
        ctx.audio.play("bulletWhiz", { x: this.tmp.x, y: this.tmp.y, z: this.tmp.z, volume: 0.55, pitchVar: 0.1 });
      }
    }
  }

  /**
   * The body onto the collider. `smooth`: a step's height change (the collider climbs a stair's
   * voxels a quarter metre at a time — at a run, one jump a frame) is eased out over a few frames,
   * the drawn body behind it, not snapped — the way shooters smooth a character's root over steps.
   */
  private applyRoot(smooth = false) {
    const c = this.collider.position;
    const r = this.parts.root;
    const base = c.y - ENEMY.halfHeight;
    const jump = base - this.rootBase;
    this.stepOff = smooth && Math.abs(jump) < 0.6 ? Math.max(-0.35, Math.min(0.35, this.stepOff - jump)) : 0;
    this.rootBase = base;
    r.position.set(c.x, base + this.stepOff, c.z);
    r.rotation.y = this.yaw;
  }
  /** the collider's foot height last placed, and how far the drawn body is behind it (eased to 0) */
  private rootBase = 0;
  private stepOff = 0;

  /** footsteps for the skinned body (the clips are rate-matched to the same speed) */
  private gait(dt: number) {
    const speed = this.curSpeed;
    const run = saturate((speed - ENEMY.walkSpeed) / (ENEMY.runSpeed - ENEMY.walkSpeed));
    const prevStep = Math.floor(this.gaitPhase / Math.PI);
    this.gaitPhase += dt * speed * (run > 0.5 ? 2.0 : 2.6);
    if (Math.floor(this.gaitPhase / Math.PI) !== prevStep && speed > 0.3) this.footstep(run);
  }

  private footstep(run: number) {
    const c = this.collider.position;
    this.ctx.onFootstep?.(c.x, c.y - ENEMY.halfHeight, c.z, this.yaw, Math.floor(this.gaitPhase / Math.PI) % 2 ? 1 : -1, run);
    const pe = this.ctx.player.eye;
    const d2 = (c.x - pe.x) ** 2 + (c.z - pe.z) ** 2;
    if (d2 > 22 * 22) return; // inaudible — skip creating a voice
    this.ctx.audio.play("footstep", { x: c.x, y: c.y - 0.9, z: c.z, volume: 0.35 + run * 0.35, pitchVar: 0.1, rate: 0.9 });
  }

  // ======================================================================= death
  private impulseFor(): RagdollImpulse | null {
    const k = this.killInfo;
    if (!k || k.info.kind === "blast") return null;
    const R = RAGDOLL;
    let mag: number;
    if (k.info.kind === "melee") mag = R.meleeImpulse * (k.info.force ?? 1);
    else mag = Math.min(60, k.damage) * R.bulletPerDamage * (k.zone === "head" ? R.headshotScale : 1);
    const dir = k.dir.clone();
    dir.y = Math.max(dir.y, k.info.kind === "melee" ? 0.15 : 0.02);
    dir.normalize();
    return { point: k.point, impulse: dir.scale(mag), part: k.zone, launch: k.info.launch };
  }

  private updateDeath(dt: number) {
    if (this.deathT > ENEMY.corpseTime + ENEMY.sinkTime) return;
    this.deathT += dt;
    const p = this.parts;
    const t = this.deathT;
    if (this.ragdollPath && this.skin) {
      this.updateRagdollDeath(dt);
    } else this.updateDriverDeath(dt);
    // after a while the body sinks away and is fully disabled (no CPU/GPU cost)
    if (t > ENEMY.corpseTime) {
      if (this.ragdollLive) this.freezeRagdoll();
      const s = saturate((t - ENEMY.corpseTime) / ENEMY.sinkTime);
      p.root.position.y = this.collider.position.y - ENEMY.halfHeight - s * 0.6;
      p.gun.position.y -= dt * 0.4;
      // (a pistol he dropped lies loose, off his root: it goes with him)
      const side = this.skin?.sidearm;
      if (side && !side.parent) side.position.y -= dt * 0.4;
      if (s >= 1) {
        p.root.setEnabled(false);
        setPartsVisible(p, false);
        p.gun.setEnabled(false);
        side?.setEnabled(false);
      }
    }
  }

  private updateRagdollDeath(dt: number) {
    const skin = this.skin!;
    if (!this.ragdollStarted) {
      // scripted stagger: keep animating, remember limb positions for the hand-off velocities
      if (this.deathLead > 0) {
        skin.partCenters(this.prevCenters); // last frame's pose
        this.hasPrev = true;
        this.hp = this.hitPitch.update(dt) * 0.03;
        this.hy = this.hitYaw.update(dt) * 0.03;
        this.poseSkin(dt, true);
        this.deathLead -= dt;
        if (this.deathLead > 0) return;
      }
      // hand over to Havok
      let vels: Map<string, Vector3> | undefined;
      if (this.hasPrev) {
        vels = new Map();
        const now = skin.partCenters(new Map());
        for (const [k, v] of now) {
          const was = this.prevCenters.get(k);
          if (was) vels.set(k, v.subtract(was).scaleInPlace(1 / Math.max(1 / 240, dt)));
        }
      }
      const slot = this.ctx.ragdollSlot(this);
      this.tmp.set(this.velX, 0, this.velZ);
      skin.startRagdoll(slot, this.tmp, this.impulseFor(), vels);
      const k = this.killInfo;
      if (k?.info.kind === "blast" && k.info.center) skin.ragdoll.blast(k.info.center, (k.info.radius ?? 6) * 1.2, RAGDOLL.blastImpulse);
      this.ragdollStarted = true;
      this.ragdollLive = true;
      this.ragdollT = 0;
      return;
    }
    this.ragdollT += dt;
    const rt = this.ragdollT;
    if (this.ragdollLive && !skin.updateRagdoll(dt)) {
      this.ragdollLive = false;
      this.ctx.ragdollDone(this);
    }
    const c = skin.ragdoll.center ?? this.collider.position;
    if (!this.dropDone && rt > 0.45) {
      this.dropDone = true;
      const g = this.parts.gun.position;
      this.ctx.audio.play("weaponDrop", { x: g.x, y: g.y, z: g.z, volume: 0.45 });
    }
    if (!this.bodyFallPlayed && rt > 0.55) {
      this.bodyFallPlayed = true;
      this.ctx.audio.play("bodyFall", { x: c.x, y: c.y, z: c.z, volume: 0.6 });
    }
    // once he has come to rest, blood spreads under the body (not for burns)
    if (!this.poolDone && rt > 1.4 && this.killInfo?.info.kind !== "fire") {
      this.poolDone = true;
      this.ctx.fx.bloodPool(c);
    }
  }

  // ======================================================================= fallback animation (no skin / no physics)
  private animate(dt: number) {
    const p = this.parts;
    const speed = this.curSpeed;
    const run = saturate((speed - ENEMY.walkSpeed) / (ENEMY.runSpeed - ENEMY.walkSpeed));
    const moving = saturate(speed / 0.6);
    const prevStep = Math.floor(this.gaitPhase / Math.PI);
    this.gaitPhase += dt * speed * (run > 0.5 ? 2.0 : 2.6);
    const ph = this.gaitPhase;
    if (Math.floor(ph / Math.PI) !== prevStep && moving > 0.5) this.footstep(run);
    const amp = lerp(0.42, 0.8, run) * moving;
    const cr = this.crouchT * (1 - moving);
    const hp = this.hitPitch.update(dt) * 0.03;
    const hy = this.hitYaw.update(dt) * 0.03;
    const rc = this.recoil.update(dt) * 0.02;
    p.hips.position.y = 0.94 - cr * 0.38 - Math.abs(Math.sin(ph)) * 0.04 * moving;
    p.hips.rotation.x = run * 0.12 * moving;
    p.hipL.rotation.x = Math.sin(ph) * amp - cr * 1.25;
    p.hipR.rotation.x = -Math.sin(ph) * amp - cr * 0.2;
    p.kneeL.rotation.x = Math.max(0, -Math.sin(ph + 0.6)) * amp * 1.4 + cr * 1.9;
    p.kneeR.rotation.x = Math.max(0, Math.sin(ph + 0.6)) * amp * 1.4 + cr * 1.15;
    p.hipR.rotation.z = cr * 0.12;
    let aimPitch = 0;
    if (this.state === "ATTACK" || this.state === "ALERT") {
      const c = this.collider.position;
      const pe = this.ctx.player.eye;
      const dh = Math.hypot(pe.x - c.x, pe.z - c.z);
      aimPitch = clamp(-Math.atan2(pe.y - (c.y + 0.5), dh), -0.6, 0.6) * this.aimT;
    }
    p.spine.rotation.x = aimPitch * 0.6 + hp + rc * 0.3 + cr * 0.25 + run * 0.15 * (1 - this.aimT);
    p.spine.rotation.y = hy + Math.sin(ph) * 0.08 * moving;
    p.neck.rotation.x = aimPitch * 0.4 + hp * 0.6 - cr * 0.2;
    p.neck.rotation.y = 0;
    const a = this.aimT;
    p.gunMount.position.set(lerp(0.13, 0.11, a), lerp(0.24, 0.42, a), lerp(0.3, 0.26, a));
    p.gun.rotation.x = lerp(0.42, 0, a) + rc;
    p.gun.rotation.y = lerp(-0.38, 0, a);
    p.shoulderR.rotation.set(lerp(-0.5, -1.35, a), 0, lerp(0.1, 0.25, a));
    p.elbowR.rotation.set(lerp(-1.0, -0.4, a), 0, 0);
    p.shoulderL.rotation.set(lerp(-0.9, -1.45, a), lerp(0.4, 0.55, a), lerp(-0.25, -0.35, a));
    p.elbowL.rotation.set(lerp(-0.9, -0.25, a), 0, 0);
  }

  /** blinded pose (fallback body): off hand over the eyes, gun hand dropped, head turned away */
  private coverEyes() {
    const p = this.parts;
    const k = saturate(Math.min(this.blindMax - this.blindT, this.blindT) / 0.25);
    const w = Math.sin(this.ctx.time * 9) * 0.05;
    p.shoulderL.rotation.set(lerp(p.shoulderL.rotation.x, -2.5, k), lerp(p.shoulderL.rotation.y, 0.7, k), lerp(p.shoulderL.rotation.z, -0.2, k));
    p.elbowL.rotation.set(lerp(p.elbowL.rotation.x, -2.0, k), 0, 0);
    p.neck.rotation.x = lerp(p.neck.rotation.x, 0.45 + w, k);
    p.neck.rotation.y = lerp(0, 0.5, k);
    p.spine.rotation.x += 0.22 * k;
    p.gun.rotation.x = lerp(p.gun.rotation.x, 0.9, k);
  }

  /** procedural fall on the driver skeleton (used when physics is unavailable) */
  private updateDriverDeath(dt: number) {
    const p = this.parts;
    const t = this.deathT;
    const buckle = saturate(t / 0.22);
    const topple = saturate((t - 0.1) / 0.62);
    const fall = topple * topple;
    const settle = t > 0.72 ? Math.sin(saturate((t - 0.72) / 0.25) * Math.PI) * 0.06 : 0;
    p.root.rotation.x = this.deathDir * (fall * 1.48 - settle);
    p.root.rotation.z = this.deathTwist * fall * 0.3;
    p.hips.position.y = 0.94 - buckle * 0.28 + fall * 0.12;
    p.hipL.rotation.x = -buckle * 0.7 * (1 - fall) - 0.15 * fall;
    p.hipR.rotation.x = -buckle * 0.4 * (1 - fall) + 0.1 * fall;
    p.kneeL.rotation.x = buckle * 1.1 * (1 - fall * 0.7);
    p.kneeR.rotation.x = buckle * 0.8 * (1 - fall * 0.7);
    p.spine.rotation.x = -this.deathDir * 0.3 * fall + this.hitPitch.update(dt) * 0.02;
    p.neck.rotation.x = -this.deathDir * 0.5 * fall;
    p.shoulderL.rotation.set(-0.35 - fall * 0.7 * this.deathDir, 0, -0.18 - fall * 0.3);
    p.shoulderR.rotation.set(-0.3 - fall * 0.6 * this.deathDir, 0, 0.15 + fall * 0.35);
    p.elbowL.rotation.x = -0.5 - 0.3 * fall;
    p.elbowR.rotation.x = -0.7 - 0.2 * fall;
    if (t < 1.4) this.skin?.follow(1 - saturate(t / 0.3));
    if (!this.bodyFallPlayed && t > 0.72) {
      this.bodyFallPlayed = true;
      const c = this.collider.position;
      this.ctx.audio.play("bodyFall", { x: c.x, y: c.y - 0.8, z: c.z, volume: 0.6 });
    }
    if (!this.poolDone && t > 1.6 && this.killInfo?.info.kind !== "fire") {
      this.poolDone = true;
      this.ctx.fx.bloodPool(this.collider.position);
    }
    if (!this.dropDone) {
      const g = p.gun;
      this.dropVel.y -= 9.8 * dt;
      g.position.addInPlace(this.tmp.copyFrom(this.dropVel).scaleInPlace(dt));
      g.rotation.z += dt * 5;
      g.rotation.x += dt * 2;
      const floor = this.collider.position.y - ENEMY.halfHeight + 0.04;
      if (g.position.y <= floor) {
        g.position.y = floor;
        g.rotation.z = Math.PI / 2;
        g.rotation.x = 0;
        this.dropDone = true;
        this.ctx.audio.play("weaponDrop", { x: g.position.x, y: g.position.y, z: g.position.z, volume: 0.45 });
      }
    }
  }
}
