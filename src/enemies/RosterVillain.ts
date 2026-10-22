import { Mesh } from "@babylonjs/core/Meshes/mesh";
import { MeshBuilder } from "@babylonjs/core/Meshes/meshBuilder";
import { Vector3 } from "@babylonjs/core/Maths/math.vector";
import { BodyZone, HitKind } from "../config/game";
import { RosterHero, RosterModel, V, flat, pick, type Act, type Kit, type Move, type RosterHost, type Tgt } from "../allies/RosterHero";
import { HIT, copyPose, mixPose, type Pose } from "../allies/SpiderPoses";
import type { CharacterDef } from "../characters/roster";
import type { Combatant, Foe, HulkThreat } from "./Hulk";

/**
 * A ROSTER VILLAIN — Ultron, Ronan, the Joker, Darkseid, Doctor Doom (Phase 3). The same fighter as
 * the heroes (RosterHero: body, movement, the Brain, the AbilityBook, the entrance) on the other
 * side, plus what it takes to be a Foe the whole game understands:
 *
 *  - hit boxes along his bones (your bullets and knife find them), a blast test (grenades,
 *    rockets), a solid body you can't walk through;
 *  - the Foe interface the heroes read and act on: where he is, how big, who he's after, the blow
 *    he's winding up (so they dodge it), being webbed (Spider-Man), frozen (Superman's breath),
 *    carried and slammed (Superman), shoved (anyone's big blow);
 *  - his health bar at the top of the screen, and boss phases — at the roster's thresholds he
 *    stops, does his kit's phase move (a roar, a power-up) and fights harder after it;
 *  - beaten, he's down for good (he counts toward the win).
 *
 * Whom he fights is the Game's: you and the heroes (an independent like Doom, also whoever the
 * faction table makes him hostile to). His rival — the hero he has history with — comes first.
 */

export interface VillainHost extends RosterHost {
  /** the hero his kit names as his rival, if that hero is up */
  rival?: (me: RosterVillain) => Combatant | null;
  onDefeated?: (me: RosterVillain) => void;
  /** (Red Skull's call) wake up to `n` of the stage's reserve soldiers round `at`; returns how many came */
  guards?: (at: Vector3, n: number) => number;
}

/** the bones the heroes' code asks a foe for, on this rig */
const BONES: Record<string, string> = {
  pelvis: "Hips", spine_03: "Spine1", spine_05: "Spine2", head: "Head",
  hand_l: "LeftHand", hand_r: "RightHand", foot_l: "LeftFoot", foot_r: "RightFoot", calf_l: "LeftLeg", calf_r: "RightLeg",
};

/** held still (webbed, a stagger): the flinch, then standing */
const STUN: Move = {
  start(_h, a) {
    a.dur = (a.data.secs as number) ?? 1.2;
  },
  frame(h) {
    h.v.setAll(0);
  },
  pose(h, a, want) {
    mixPose(HIT, h.kit.stance, Math.min(1, a.t / a.dur), want);
    return 12;
  },
};

export class RosterVillain extends RosterHero implements Foe {
  declare readonly host: VillainHost;
  webbedT = 0;
  rider: Combatant | null = null;
  readonly solid: Mesh;
  private boxes: { m: Mesh; a: string; b: string; w: number }[] = [];
  private bar: HTMLDivElement;
  private fill: HTMLDivElement;
  private ghostEl: HTMLDivElement;
  private ghost = 1;
  defeated = false;
  private phaseDone = 0;
  /** his filmed defeat (the kit's outro): seconds into it, −1 none */
  private outroT = -1;
  private frozenT = 0;
  private heldAt: Vector3 | null = null;
  private stick = 0;
  private lastBy = new Map<Combatant, number>();
  private playerC: Combatant | null = null;

  constructor(host: VillainHost, def: CharacterDef, kit: Kit, model: RosterModel) {
    super(host, def, kit, model);
    // (what's done to him stays done: no healing between fights)
    this.regen = false;
    const scene = host.scene;
    // hit boxes along the bones (sized to him), for your bullets and knife
    const box = (a: string, b: string, w: number, zone: BodyZone) => {
      const m = MeshBuilder.CreateBox("vilHit_" + def.id, { size: 1 }, scene);
      m.isVisible = false;
      m.isPickable = false;
      m.metadata = { kind: HitKind.EnemyPart, enemy: this, zone };
      this.boxes.push({ m, a, b, w });
    };
    const k = def.height / 1.8;
    box("Hips", "Neck", 0.42 * k, "torso");
    box("Neck", "HeadTop_End", 0.26 * k, "head");
    box("LeftArm", "LeftHand", 0.16 * k, "limb");
    box("RightArm", "RightHand", 0.16 * k, "limb");
    box("LeftUpLeg", "LeftFoot", 0.19 * k, "limb");
    box("RightUpLeg", "RightFoot", 0.19 * k, "limb");
    this.solid = MeshBuilder.CreateBox("vilSolid_" + def.id, { width: 0.7 * k, height: def.height * 0.9, depth: 0.6 * k }, scene);
    this.solid.isVisible = false;
    this.solid.isPickable = false;
    this.solid.checkCollisions = false;
    // the health bar, in the column at the top of the screen
    let col = document.getElementById("boss-stack");
    if (!col) {
      col = document.createElement("div");
      col.id = "boss-stack";
      document.getElementById("hud")?.appendChild(col);
    }
    this.bar = document.createElement("div");
    this.bar.className = "ms-boss vil-boss" + (def.tier === "final-boss" ? " final-boss" : "");
    this.bar.style.setProperty("--vil", kit.color);
    this.bar.innerHTML = `<div class="ms-boss-name">${def.name} <span class="ms-boss-state"></span></div><div class="ms-boss-track"><div class="ms-boss-ghost"></div><div class="ms-boss-fill"></div></div>`;
    col.appendChild(this.bar);
    this.fill = this.bar.querySelector(".ms-boss-fill") as HTMLDivElement;
    this.ghostEl = this.bar.querySelector(".ms-boss-ghost") as HTMLDivElement;
  }
  static async createVillain(host: VillainHost, def: CharacterDef, kit: Kit, model: RosterModel) {
    const h = new RosterVillain(host, def, kit, model);
    const { loadSpiderClips } = await import("../allies/SpiderPoses");
    h.clips = await loadSpiderClips();
    await kit.setup?.(h);
    return h;
  }

  // ------------------------------------------------------------------ Foe
  get heading() {
    return this.yaw;
  }
  /** the Hulk ~1.2–1.6, a man 0.75 */
  get size() {
    return this.def.height / 2.3;
  }
  get target(): Combatant | null {
    return this.tgt && "hero" in this.tgt ? this.tgt.hero : null;
  }
  /** which boss phase he's in (0 the first) */
  get phase() {
    return this.phaseDone;
  }
  override get cinematic() {
    return super.cinematic || (!!this.kit.outro && this.outroT >= 0 && this.outroT < this.kit.outro.dur);
  }
  override cineShot() {
    if (this.kit.outro && this.outroT >= 0 && this.outroT < this.kit.outro.dur) return this.kit.outro.shot(this, this.outroT);
    return super.cineShot();
  }
  protected override poseOverride(want: Pose, dt: number) {
    const o = this.kit.outro;
    return o && this.outroT >= 0 ? o.pose(this, Math.min(this.outroT, o.dur), want, dt) : null;
  }
  override get state(): string {
    if (!this.enabled) return "dormant";
    if (this.defeated) return "down";
    if (this.heldAt) return "held";
    if (this.frozenT > 0) return "frozen";
    return this.brain.state;
  }
  get frozen() {
    return this.frozenT > 0;
  }
  applyHit(damage: number, zone: BodyZone, _dir: Vector3, _point: Vector3, info?: { kind: string; force?: number; source?: Combatant }) {
    if (!this.alive || this.cinematic) return false;
    const bullet = !info || info.kind === "bullet";
    // (armoured: a bullet does less than a hero's blow; the head takes more)
    const dmg = damage * (bullet ? 0.7 : 1) * (zone === "head" ? 1.3 : 1) * (1 - this.def.stats.armor * 0.5) * this.guard;
    this.health = Math.max(0, this.health - dmg);
    this.sinceHurt = 0;
    const src = info?.source ?? this.playerC ?? null;
    if (src) this.lastBy.set(src, this.time);
    if (this.health <= 0) {
      this.knockOut();
      return true;
    }
    // a heavy blow rocks him back (now and then)
    if ((info?.force ?? 0) >= 3 && !this.action && Math.random() < 0.3 * (1 - this.def.stats.staggerResist)) this.stun(0.7);
    this.checkPhase();
    return false;
  }
  /** (as a Combatant: anything that hurts "whoever's in reach" — the Hulk's ground slam, a shock ring) */
  override takeDamage(amount: number, from: Vector3) {
    this.applyHit(amount, "torso", this.p.subtract(from), this.center(), { kind: "melee", force: 1 });
  }
  threat(): HulkThreat | null {
    if (!this.alive || !this.action) return null;
    const m = this.moveOf(this.action);
    return m?.threat?.(this, this.action) ?? null;
  }
  web(seconds: number) {
    // (a web, a band of magic: nothing that holds a sixteen-metre monster)
    if (!this.alive || this.cinematic || this.webbedT > 0 || this.kit.giant) return false;
    this.webbedT = seconds * (1 - this.def.stats.staggerResist * 0.6);
    this.stun(this.webbedT);
    return true;
  }
  mount() {
    return false;
  }
  riderPoint() {
    return this.rig.at("Spine2").add(this.fwd().scale(-0.3));
  }
  bonePos(name: string) {
    return this.rig.at(BONES[name] ?? "Spine1");
  }
  inBlast(pos: Vector3, radius: number) {
    return this.alive && !this.cinematic && Vector3.Distance(pos, this.center()) < radius + 0.5 * this.size;
  }
  /** shoved by a big blow (Superman's punch, a hero's launch) */
  launch(vel: Vector3) {
    if (!this.alive || this.cinematic) return;
    this.knock(flat(vel), Math.max(1, vel.y));
  }
  /** Superman's breath: iced still (a boss works free sooner) */
  freeze(seconds: number) {
    if (!this.alive || this.cinematic || this.frozenT > 0) return false;
    this.frozenT = seconds * (this.def.tier === "boss" || this.def.tier === "final-boss" ? 0.5 : 0.8);
    this.endAction();
    return true;
  }
  /** carried (Superman): held where he's put, then dropped */
  hold(at: Vector3) {
    if (!this.alive) return;
    this.endAction();
    this.heldAt = at.clone();
  }
  drop(vel: Vector3) {
    if (!this.heldAt) return;
    this.heldAt = null;
    this.v.copyFrom(vel);
    this.mode = "air";
    // (slammed down from up there: it hurts when he lands — the fall does it, see moveAir)
    if (vel.y < -6) this.applyHit(120, "torso", V(0, -1, 0), this.p, { kind: "melee", force: 3 });
  }
  private stun(secs: number) {
    this.endAction();
    this.begin("stun", null, STUN);
    if (this.action) {
      this.action.data.secs = secs;
      this.action.dur = secs;
    }
  }

  // ------------------------------------------------------------------ in and out
  /** (Game) who "you" are, as a Combatant, so your hits count as yours */
  setPlayer(c: Combatant) {
    this.playerC = c;
  }
  override enter() {
    if (this.enabled || this.defeated) return false;
    const ok = super.enter();
    if (!ok) return false;
    this.ghost = 1;
    this.phaseDone = 0;
    this.lastBy.clear();
    return true;
  }
  override reset() {
    super.reset();
    this.defeated = false;
    this.frozenT = 0;
    this.heldAt = null;
    this.webbedT = 0;
    this.phaseDone = 0;
    this.outroT = -1;
    this.solid.checkCollisions = false;
    for (const b of this.boxes) b.m.isPickable = false;
    this.bar.classList.remove("on", "l2");
  }
  protected override knockOut() {
    this.endAction();
    this.defeated = true;
    this.mode = "ko";
    this.koT = 1e9;
    this.brain.go("defeated", "beaten");
    this.say(pick(this.kit.lines.down), 3);
    this.host.audio.play("bodyFall", { x: this.p.x, y: this.p.y, z: this.p.z, volume: 1, rate: 0.8 });
    if (this.kit.outro) this.outroT = 0;
    this.host.onDefeated?.(this);
  }
  /** beaten for good: falls where he is (from any height) and stays there */
  protected override recovering(dt: number) {
    this.moveAir(dt, true);
  }
  private checkPhase() {
    const ph = this.def.phases ?? [];
    const f = this.health / this.maxHealth;
    if (this.phaseDone >= ph.length || f >= ph[this.phaseDone]) return;
    this.phaseDone++;
    // a new phase: harder, faster with it
    this.power += 0.2;
    this.bar.classList.add("l2");
    if (this.kit.phaseMove && this.alive) {
      this.endAction();
      this.begin("phase", null, this.kit.phaseMove);
    }
  }

  // ------------------------------------------------------------------ deciding
  /** whom: his rival if he's up; else whoever's hurt him lately, nearer is better; he sticks a while */
  protected override pickTarget(): Tgt | null {
    const all = (this.host.targets?.(this) ?? []).filter((c) => c.alive);
    if (!all.length) return null;
    const cur = this.tgt && "hero" in this.tgt ? this.tgt.hero : null;
    this.stick -= 0.2;
    if (cur && cur.alive && this.stick > 0 && all.includes(cur)) return this.tgt;
    const rival = this.host.rival?.(this) ?? null;
    let best = all[0], bs = -Infinity;
    for (const c of all) {
      const d = Vector3.Distance(c.feet, this.p);
      let s = -d * 0.35;
      if (c === rival) s += 12;
      if (this.time - (this.lastBy.get(c) ?? -99) < 4) s += 7;
      if (c === cur) s += 4;
      if (c === this.playerC) s += 3;
      if (s > bs) (bs = s), (best = c);
    }
    this.stick = 3 + Math.random() * 2;
    return { hero: best };
  }
  /** nobody to fight: he comes for you */
  protected override followPlayer() {
    this.goTo(this.host.player.feet, "run");
  }
  protected override think(dt: number) {
    // (frozen, carried: no thinking till it's over)
    if (this.frozenT > 0 || this.heldAt) return;
    super.think(dt);
  }

  // ------------------------------------------------------------------ frame
  override update(dt: number) {
    if (!this.enabled) {
      return;
    }
    this.webbedT = Math.max(0, this.webbedT - dt);
    if (this.frozenT > 0) {
      this.frozenT -= dt;
      this.v.setAll(0);
    }
    super.update(dt);
    if (this.outroT >= 0 && this.kit.outro) {
      this.outroT += dt;
      this.kit.outro.frame?.(this, this.outroT, dt);
    }
    if (this.heldAt) {
      this.p.copyFrom(this.heldAt);
      this.v.setAll(0);
      this.mode = "air";
    }
    const live = this.alive && !this.cinematic;
    for (const b of this.boxes) {
      b.m.isPickable = live;
      const a = this.rig.atCached(b.a), c = this.rig.atCached(b.b);
      const mid = a.add(c).scale(0.5);
      const ab = c.subtract(a);
      const L = ab.length();
      b.m.position.copyFrom(mid);
      b.m.scaling.set(b.w, Math.max(0.3, L + 0.2), b.w);
      b.m.rotation.set(Math.acos(Math.max(-1, Math.min(1, ab.y / Math.max(1e-4, L)))), Math.atan2(ab.x, ab.z), 0);
    }
    this.solid.checkCollisions = live;
    this.solid.position.set(this.p.x, this.p.y + this.def.height * 0.45, this.p.z);
    // the bar: on while he's in the fight, held a moment after he's down
    const f = this.health / this.maxHealth;
    this.fill.style.width = `${(f * 100).toFixed(1)}%`;
    this.ghost = Math.max(f, this.ghost - 0.004);
    this.ghostEl.style.width = `${(this.ghost * 100).toFixed(1)}%`;
    this.bar.classList.toggle("on", !this.cinematic && (!this.defeated || this.time - this.downAt < 3));
    if (!this.defeated) this.downAt = this.time;
    const st = this.bar.querySelector(".ms-boss-state") as HTMLSpanElement;
    const label = this.defeated ? "DEFEATED" : this.frozenT > 0 ? "FROZEN" : this.phaseDone > 0 ? (this.phaseDone > 1 ? "FINAL PHASE" : "ENRAGED") : "";
    if (st.textContent !== label) st.textContent = label;
  }
  private downAt = 0;
  /** for the debug view: his brain, his abilities */
  debug(a?: Act) {
    return `${this.def.id} ${this.state} ${a?.id ?? this.action?.id ?? ""} · ${this.book.debug()}`;
  }
}
void copyPose;
