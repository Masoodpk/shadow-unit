import { Scene } from "@babylonjs/core/scene";
import { EnemyRagdoll } from "./EnemyRagdoll";
import type { SoldierSkins } from "./SoldierSkin";
import { Vector3 } from "@babylonjs/core/Maths/math.vector";
import { ENEMY } from "../config/game";
import { AudioEngine } from "../audio/AudioEngine";
import { Effects } from "../fx/Effects";
import { LevelData } from "../level/KestrelPoint";
import { PlayerController } from "../player/PlayerController";
import { Materials } from "../render/Materials";
import { Enemy, EnemyContext, Threat } from "./Enemy";
import { prepareSoldierSources, soldierShadowSources } from "./EnemyModel";
import { PhysicsService } from "../physics/PhysicsService";
import { RAGDOLL, REFLEX } from "./EnemyConfig";
import type { BarkEvent } from "../audio/Barks";
import type { InstancedMesh } from "@babylonjs/core/Meshes/instancedMesh";

/**
 * Owns all soldiers. They are built once at load and *reset* on restart —
 * never re-created — so restarts cannot leak or duplicate entities.
 */
export class EnemyManager {
  readonly enemies: Enemy[] = [];
  private ctx: EnemyContext;
  onKilled?: (e: Enemy, headshot: boolean, remaining: number) => void;

  /** world hooks (grenades) supplied by the game */
  hooks?: {
    threats(): Threat[];
    throwGrenade(from: Vector3, vel: Vector3, owner: object): void;
    grenadeProp(): InstancedMesh | null;
    breakGlass?(from: Vector3, to: Vector3): void;
    openDoor?(pos: Vector3, dirX: number, dirZ: number): void;
    footstep?(x: number, y: number, z: number, yaw: number, side: number, run: number): void;
    bark?(e: Enemy, ev: BarkEvent): void;
    throwClear?(a: Vector3, b: Vector3): boolean;
  };
  private nextGrenade = 20;
  /** soldiers whose ragdoll is simulating right now (oldest first) */
  private ragdolls: Enemy[] = [];
  private nextSlot = 0;

  constructor(scene: Scene, mats: Materials, level: LevelData, player: PlayerController, fx: Effects, audio: AudioEngine, physics?: PhysicsService) {
    prepareSoldierSources(scene, mats);
    // (ragdolls pull their limbs back out of the level's walls)
    EnemyRagdoll.embedded = (x, y, z) => level.nav.embedded(x, y, z);
    this.ctx = {
      scene,
      player,
      nav: level.nav,
      fx,
      audio,
      time: 0,
      grace: ENEMY.startGrace,
      start: level.playerSpawn.pos.clone(),
      alertAllies: (e) => this.alertAllies(e),
      onKilled: (e, hs) => this.onKilled?.(e, hs, this.awakeCount),
      throwClear: (a, b) => this.hooks?.throwClear?.(a, b) ?? true,
      onBossPhase: (e, phase) => this.onBossPhase?.(e, phase),
      physics,
      ragdollSlot: (e) => this.ragdollSlot(e),
      squad: this.enemies,
      threats: () => this.hooks?.threats() ?? [],
      throwGrenade: (from, vel, owner) => this.hooks?.throwGrenade(from, vel, owner),
      grenadeClock: () => {
        if (this.ctx.time < this.nextGrenade) return false;
        this.nextGrenade = this.ctx.time + REFLEX.grenadeTeamCooldown;
        return true;
      },
      grenadeReady: () => this.ctx.time >= this.nextGrenade,
      grenadeProp: () => this.hooks?.grenadeProp() ?? null,
      breakGlass: (from, to) => this.hooks?.breakGlass?.(from, to),
      openDoor: (pos, dx, dz) => this.hooks?.openDoor?.(pos, dx, dz),
      onFootstep: (x, y, z, yaw, side, run) => this.hooks?.footstep?.(x, y, z, yaw, side, run),
      ragdollDone: (e) => {
        const i = this.ragdolls.indexOf(e);
        if (i >= 0) this.ragdolls.splice(i, 1);
      },
    };
    // every spawn the stage defines (Red Dune: 15, Frostline: 16)
    level.enemySpawns.forEach((s, i) => this.enemies.push(new Enemy(this.ctx, mats, s, i)));
    void ENEMY;
  }

  get shadowSources() {
    return soldierShadowSources();
  }

  get aliveCount() {
    let n = 0;
    for (const e of this.enemies) if (e.alive) n++;
    return n;
  }
  /** alive and in play (not asleep waiting for a mission beat) — what the HUD counts */
  get awakeCount() {
    let n = 0;
    for (const e of this.enemies) if (e.alive && !e.dormant) n++;
    return n;
  }
  get activeCount() {
    let n = 0;
    for (const e of this.enemies) if (e.active) n++;
    return n;
  }

  /** Dress every hostile in a skinned soldier (alternating the two characters). */
  attachSkins(skins: SoldierSkins) {
    // (a stage that brings its own soldiers — the Underground: the Polish soldier and the soldier girl, the
    // Winter Soldier its boss — dresses them in those; otherwise the FSB operator and Mark, alternating)
    const own = skins.kinds.filter((k) => k !== "winter" && k !== "fsb" && k !== "mark");
    const boss = skins.kinds.includes("winter") ? "winter" : "fsb";
    this.enemies.forEach((e, i) => e.attachSkin(skins.create(e.boss ? boss : own.length ? own[i % own.length] : i % 2 === 0 ? "fsb" : "mark", e.parts, i)));
  }

  /**
   * Swept-collision candidates: Babylon otherwise tests every mesh in the scene
   * (thousands, incl. particles and hitboxes) for each move. Level solids +
   * the player + squad mates is all a soldier can bump into.
   */
  setCollisionSet(level: import("@babylonjs/core/Meshes/abstractMesh").AbstractMesh[], player: import("@babylonjs/core/Meshes/abstractMesh").AbstractMesh) {
    const solids = level.filter((m) => m.checkCollisions);
    for (const e of this.enemies) e.collider.surroundingMeshes = [...solids, player, ...this.enemies.filter((o) => o !== e).map((o) => o.collider)];
    return solids;
  }

  /** a slot for a new ragdoll; the oldest one freezes when too many are simulating */
  private ragdollSlot(e: Enemy) {
    // (the oldest are frozen to make room — but never one still in the air: a body thrown by
    // Superman or a blast flies on and lands; up to twice the budget while bodies are flying)
    while (this.ragdolls.length >= RAGDOLL.maxActive) {
      const i = this.ragdolls.findIndex((r) => r.ragdollSettled);
      if (i < 0 && this.ragdolls.length < RAGDOLL.maxActive * 2) break;
      this.ragdolls.splice(i < 0 ? 0 : i, 1)[0].freezeRagdoll();
    }
    this.ragdolls.push(e);
    return this.nextSlot++;
  }

  reset() {
    this.ragdolls = [];
    this.nextGrenade = 20;
    this.ctx.time = 0;
    this.ctx.grace = ENEMY.startGrace;
    for (const e of this.enemies) e.reset();
  }

  /** developer mode: ACTIVE (normal), PASSIVE (blind & deaf, never shoot), FROZEN (stand still) */
  aiMode: "ACTIVE" | "PASSIVE" | "FROZEN" = "ACTIVE";

  update(dt: number) {
    this.ctx.time += dt;
    // the quiet arrival: the first seconds, and for as long as you stay at the insertion point,
    // until you fire
    if ((this.ctx.grace ?? 0) > 0) {
      const f = this.ctx.player.feet, s = this.ctx.start!;
      const atStart = Math.hypot(f.x - s.x, f.z - s.z) < ENEMY.startZone;
      this.ctx.grace = atStart ? Math.max(this.ctx.grace!, 0.5) : Math.max(0, this.ctx.grace! - dt);
    }
    this.ctx.passive = this.aiMode !== "ACTIVE";
    if (!this.ctx.passive) this.listenSteps(dt);
    const step = 1 / ENEMY.thinkRate;
    for (const e of this.enemies) {
      if (!e.active) continue;
      if (this.aiMode === "FROZEN" && e.alive) continue;
      // frozen solid (Superman's breath): no thought, no motion — and when it gives, so does he
      if (e.held && e.alive) continue;
      if (e.iceT > 0 && e.alive) {
        e.iceT -= dt;
        if (e.iceT <= 0) e.shatter();
        continue;
      }
      e.thinkTimer -= dt;
      if (e.thinkTimer <= 0) {
        e.thinkTimer += step;
        if (e.thinkTimer < 0) e.thinkTimer = step;
        e.think(step);
      }
      // (far, or off screen: updated in fewer, bigger steps — the Game decides how often)
      const lod = this.lodOf?.(e) ?? 0;
      if (lod > 0) {
        this.lodAcc.set(e, (this.lodAcc.get(e) ?? 0) + dt);
        if (this.lodAcc.get(e)! < lod) continue;
        e.update(Math.min(this.lodAcc.get(e)!, 1 / 12));
        this.lodAcc.set(e, 0);
        continue;
      }
      e.update(dt);
    }
  }
  /** (set by the Game) how many seconds between a soldier's updates: 0 every frame */
  lodOf?: (e: Enemy) => number;
  private lodAcc = new Map<Enemy, number>();

  /** Flashbang detonation: blind everyone who can see it (line of sight, distance, facing). */
  flashbang(pos: Vector3, losClear: (from: Vector3, to: Vector3) => boolean) {
    let n = 0;
    for (const e of this.enemies) {
      if (!e.alive) continue;
      const eye = e.position.clone();
      eye.y += 0.7;
      const d = Vector3.Distance(eye, pos);
      if (d > 22) continue;
      const near = d < 2.5;
      if (!near && !losClear(pos, eye)) continue;
      const dist = d < 3 ? 1 : Math.max(0, 1 - (d - 3) / 19);
      const yaw = e.heading;
      const fx = Math.sin(yaw);
      const fz = Math.cos(yaw);
      const dot = ((pos.x - eye.x) * fx + (pos.z - eye.z) * fz) / Math.max(0.01, Math.hypot(pos.x - eye.x, pos.z - eye.z));
      const facing = near ? 1 : 0.35 + 0.65 * Math.min(1, Math.max(0, (dot + 0.3) / 1.0));
      const s = dist * facing;
      if (s > 0.05) {
        e.flashbang(s, pos);
        n++;
      }
    }
    // the bang itself is heard by everyone in range
    this.onPlayerShot(pos, 1.6);
    return n;
  }

  /**
   * Blast damage: falls off with distance, needs line of sight to the torso or
   * the head (cover works), the stuck target always takes full damage.
   */
  explosion(pos: Vector3, radius: number, damage: number, los: (a: Vector3, b: Vector3) => boolean, stuck: unknown = null) {
    let hits = 0;
    let kills = 0;
    const torso = new Vector3();
    const head = new Vector3();
    for (const e of this.enemies) {
      if (!e.alive) continue;
      torso.copyFrom(e.position);
      head.copyFrom(e.position).addInPlaceFromFloats(0, 0.7, 0);
      const d = Vector3.Distance(torso, pos);
      const isStuck = e === stuck;
      if (!isStuck && d > radius) continue;
      if (!isStuck && d > 1.2 && !los(pos, torso) && !los(pos, head)) continue;
      const k = isStuck ? 1 : Math.pow(1 - Math.min(1, d / radius), 1.35);
      const dmg = damage * k;
      if (dmg < 2) continue;
      const dir = torso.subtract(pos);
      dir.y = Math.max(dir.y, 0.4);
      dir.normalize();
      hits++;
      if (e.applyHit(dmg, d < radius * 0.25 ? "head" : "torso", dir, torso, { kind: "blast", center: pos, radius })) kills++;
    }
    // bodies already on the ground get thrown too
    for (const e of this.enemies) if (!e.alive) e.blastCorpse(pos, radius);
    this.onPlayerShot(pos, 2.2);
    return { hits, kills };
  }

  /** Incendiary area tick. */
  burn(pos: Vector3, radius: number, dmg: number) {
    let kills = 0;
    for (const e of this.enemies) {
      if (!e.alive) continue;
      const dx = e.position.x - pos.x;
      const dz = e.position.z - pos.z;
      if (dx * dx + dz * dz > radius * radius || Math.abs(e.position.y - 0.9 - pos.y) > 1.6) continue;
      if (e.burn(dmg, pos)) kills++;
    }
    return kills;
  }

  /** developer mode: drop every living hostile */
  killAll() {
    for (const e of this.enemies) if (e.alive) e.applyHit(9999, "torso", new Vector3(0, 0, 1), e.position);
  }

  /**
   * Player gunfire (and blasts): heard by everyone within range. Range scales with how loud the
   * weapon is, and a wall in between muffles it to half. Close by, they know exactly where it came
   * from; farther out they come and investigate.
   */
  onPlayerShot(pos: Vector3, noise = 1) {
    this.ctx.grace = 0;
    const ear = this.ear;
    const src = this.src.set(pos.x, pos.y + 0.4, pos.z);
    for (const e of this.enemies) {
      if (!e.alive) continue;
      const d = Vector3.Distance(e.position, pos);
      const range = ENEMY.hearingRange * noise;
      if (d > range) continue;
      ear.set(e.position.x, e.position.y + 0.7, e.position.z);
      const open = d < 3 || this.ctx.nav.clear(ear, src);
      if (!open && d > range * ENEMY.wallMuffle) continue;
      e.hear(pos, open && d < ENEMY.certainRange * Math.min(1.5, noise), "gunfire");
    }
  }

  /** Player footsteps: sprinting carries, walking is heard close by, crouched / prone are silent. */
  private stepT = 0;
  private listenSteps(dt: number) {
    this.stepT -= dt;
    if (this.stepT > 0) return;
    this.stepT = 0.3;
    const pl = this.ctx.player;
    if (!pl.alive || !pl.grounded || pl.crouched || pl.prone || pl.moveAmount < 0.35) return;
    const radius = pl.sprinting ? ENEMY.footstepSprint : ENEMY.footstepWalk;
    const feet = pl.feet;
    const src = this.src.set(feet.x, feet.y + 0.4, feet.z);
    for (const e of this.enemies) {
      if (!e.alive || e.aiState === "ATTACK") continue;
      const d = Vector3.Distance(e.position, feet);
      if (d > radius) continue;
      this.ear.set(e.position.x, e.position.y + 0.7, e.position.z);
      if (d > radius * ENEMY.wallMuffle && !this.ctx.nav.clear(this.ear, src)) continue;
      e.hear(feet, d < 3, "step");
    }
  }
  private ear = new Vector3();
  private src = new Vector3();

  /** mission stages: bring a sleeping group into play */
  wakeGroup(group: string) {
    for (const e of this.enemies) if (e.spawn.group === group && e.dormant && e.alive && !e.boss) e.wake();
  }
  /** soldiers of a group still alive (asleep or not) */
  groupAlive(group: string) {
    let n = 0;
    for (const e of this.enemies) if (e.spawn.group === group && e.alive) n++;
    return n;
  }
  get boss() {
    return this.enemies.find((e) => e.boss) ?? null;
  }
  /** the boss crossed a health threshold */
  onBossPhase?: (e: Enemy, phase: number) => void;

  /** anyone fighting the player right now */
  get engaged() {
    return this.enemies.some((e) => e.alive && e.aiState === "ATTACK");
  }

  /** one soldier engaged: squad mates in radio range move in on the position he called */
  private alertAllies(src: Enemy) {
    const p = this.ctx.player.feet.clone();
    for (const e of this.enemies) {
      if (e === src || !e.alive) continue;
      if (Vector3.Distance(e.position, src.position) < ENEMY.allyAlertRange) e.hear(p, false, "gunfire");
    }
  }

  stateCounts() {
    const c: Record<string, number> = {};
    for (const e of this.enemies) c[e.aiState] = (c[e.aiState] ?? 0) + 1;
    return c;
  }
}
