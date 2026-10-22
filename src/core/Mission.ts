import { FreeCamera } from "@babylonjs/core/Cameras/freeCamera";
import { Vector3 } from "@babylonjs/core/Maths/math.vector";
import { Scene } from "@babylonjs/core/scene";
import { AudioEngine } from "../audio/AudioEngine";
import { Enemy } from "../enemies/Enemy";
import { EnemyManager } from "../enemies/EnemyManager";
import { Gate } from "../level/Gate";
import { Hostage } from "../level/Hostage";
import { Lockers } from "../level/Lockers";
import { NavGraph } from "../level/NavGraph";
import { MissionHud } from "../ui/MissionHud";
import { bindings } from "./Bindings";

/**
 * A story mission on top of a stage: objectives in order, each one taking you through another
 * part of the kasbah, and the mission's own ending. No clock — take your time.
 *
 * OPERATION SANDSTORM (Dust 2) — a hostage rescue. Nobody knows where he's held, and the cell has
 * walled off the streets with crates, so the only way is round the whole kasbah:
 *   MARKET  → clear the cell's market on the east side.
 *   TUNNELS → down into the old tunnels under the kasbah: search the cell's lockers there. One holds
 *             the transfer order (where he is — now marked on the map) and the key ring (the west
 *             gate's key, the cuffs' key).                                   ▸ CHECKPOINT 1
 *   WEST    → north through the depot and their HQ to the west site      ▸ CHECKPOINT 2
 *             then down the long road to the locked west gate: hold USE to unlock it.
 *                                                                          ▸ CHECKPOINT 3
 *   RESCUE  → the yard: kill his guards, hold USE by the chair to unlock the cuffs. He gets up
 *             (Sit To Stand).
 *   THE TAPE → (a cinematic) he turns to you, takes a video tape out of his coat lining — what
 *             they really took him for: evidence, a national secret — and hands it over. The moment
 *             it's in your hands: MISSION COMPLETE.
 * A checkpoint is saved every two parts of the kasbah; die (or lose the hostage) and you go back to the
 * last one, with everyone you'd killed by then still dead.
 */

export interface MissionHost {
  scene: Scene;
  /** the player's camera: cinematics drive it while the player is frozen */
  camera: FreeCamera;
  player: { feet: Vector3; yaw: number; pitch: number; alive: boolean };
  enemies: EnemyManager;
  nav: NavGraph;
  audio: AudioEngine;
  input: { held(a: "use"): boolean; wasPressed(code: string): boolean };
  hostage: Hostage;
  lockers: Lockers;
  gate: Gate;
  /** gameplay HUD and the weapon in your hands (hidden during cinematics) */
  showHud(on: boolean): void;
  showWeapon(on: boolean): void;
  setObjective(text: string): void;
  setTimeScale(s: number): void;
  /** put the player down here (a checkpoint) */
  respawn(at: Vector3, yaw: number): void;
  /** a short line on the game HUD ("CHECKPOINT SAVED") */
  flash(text: string): void;
  finish(won: boolean, title: string, kicker: string): void;
}

export interface MissionConfig {
  name: string;
  hostage: { name: string; short: string; title: string };
  /** where each stage is reached */
  points: { market: Vector3; tunnels: Vector3; westSite: Vector3; gate: Vector3 };
  /** the paper in the locker */
  letter: { title: string; body: string[]; sign: string };
  /** the hostage's hand-over once he's free (a cinematic): what he says, and his last line as he holds it out */
  tape: { talk: string[]; offer: string };
}

/** the hand-over: he's talking (and turning to you), it's on its way to you, it's yours */
type TapeStep = "none" | "talk" | "flying" | "taken";

type Phase = "idle" | "market" | "tunnels" | "west" | "rescue" | "ending" | "done" | "failed";

interface Shot {
  dur: number;
  from: Vector3;
  to: Vector3;
  look: () => Vector3;
  fov?: number;
  sub?: [string, string];
  enter?: () => void;
  /** something that happens `t` seconds into the shot */
  cue?: [number, () => void];
}

/** what a checkpoint keeps */
interface Save {
  n: number;
  phase: Phase;
  at: Vector3;
  yaw: number;
  /** soldiers dead by then (they stay dead) */
  dead: Enemy[];
  /** the groups in play by then */
  woken: string[];
  gate: boolean;
  /** which lockers were open */
  searched: boolean[];
  /** past the west site (checkpoint 2) */
  west: boolean;
}

/** hold USE this long: a locker, the gate's padlock, the cuffs */
const SEARCH_TIME = 1.2;
const GATE_TIME = 2;
const UNCUFF_TIME = 3;
const REACH = 1.8;

const ORDER: Phase[] = ["market", "tunnels", "west", "rescue", "ending"];
/** which soldiers wake as you get to each part of the mission */
const WAKE: Partial<Record<Phase, string[]>> = {
  west: ["depot", "hq", "mid", "west", "long"],
  rescue: ["yard", "lane"],
};

export class Mission {
  phase: Phase = "idle";
  readonly hud = new MissionHud();
  /** the hold-USE prompt for the game HUD (null when none) */
  prompt: string | null = null;
  /** the last checkpoint (null: none yet — a restart is from the start) */
  save: Save | null = null;
  private holdT = 0;
  private locker = -1;
  private heard = false;
  /** reached the west site (checkpoint 2) */
  private westReached = false;
  private woken = new Set<string>();
  private shots: Shot[] = [];
  private shotI = 0;
  private shotT = 0;
  private afterShots: (() => void) | null = null;
  private endT = 0;
  private tape: TapeStep = "none";
  private flyT = 0;
  private flyFrom = new Vector3();
  /** delayed beats (real seconds), cleared on restart */
  private later: { t: number; fn: () => void }[] = [];
  private after(t: number, fn: () => void) {
    this.later.push({ t, fn });
  }

  constructor(private host: MissionHost, private cfg: MissionConfig) {}

  get cinematic() {
    return this.shots.length > 0;
  }
  /** soldiers keep still and blind in a cinematic, and once he's free */
  get freezeHostiles() {
    return this.cinematic || this.phase === "ending" || this.phase === "done";
  }
  /** the dossier's been read: the hostage's yard shows on the map */
  get knowsWhere() {
    return this.phase === "west" || this.phase === "rescue";
  }

  /** where the HUD and the radar point now */
  get marker(): { pos: Vector3; label: string } | null {
    const h = this.host;
    const p = this.cfg.points;
    const up = (v: Vector3, y = 1.4) => v.add(new Vector3(0, y, 0));
    switch (this.phase) {
      case "market":
        return this.straggler("market") ?? { pos: up(p.market), label: "MARKET" };
      case "tunnels":
        return { pos: h.lockers.marker, label: "LOCKERS" };
      case "west":
        return this.westReached ? { pos: up(p.gate, 1.6), label: "WEST GATE" } : { pos: up(p.westSite), label: "WEST SITE" };
      case "rescue":
        return this.straggler("yard") ?? { pos: up(h.hostage.position, 1.3), label: this.cfg.hostage.short.toUpperCase() };
    }
    return null;
  }

  /** the last one or two of a group, marked so a soldier holed up somewhere can't hold you up */
  private straggler(group: string) {
    const h = this.host;
    const left = h.enemies.enemies.filter((e) => e.spawn.group === group && e.alive && !e.dormant);
    if (!left.length || left.length > 2) return null;
    const me = h.player.feet;
    const e = left.reduce((a, b) => (Vector3.DistanceSquared(a.collider.position, me) < Vector3.DistanceSquared(b.collider.position, me) ? a : b));
    return { pos: e.collider.position.add(new Vector3(0, 1.2, 0)), label: "HOSTILE" };
  }

  /** the first start (begin can be called more than once: only the first counts) */
  start() {
    if (this.phase === "idle") this.reset();
  }

  /** what the clean state of every attempt shares */
  private clear() {
    const h = this.host;
    this.holdT = 0;
    this.locker = -1;
    this.heard = false;
    this.shots = [];
    this.later = [];
    this.prompt = null;
    this.tape = "none";
    this.hud.reset();
    h.setTimeScale(1);
    h.showHud(true);
    h.showWeapon(true);
    h.hostage.reset();
  }

  /** a new attempt from the very start (forgets the checkpoint) */
  reset() {
    const h = this.host;
    this.clear();
    this.save = null;
    this.phase = "market";
    this.westReached = false;
    this.woken = new Set();
    h.gate.close();
    // the dossier's in a different locker each time (never the first one along)
    h.lockers.reset(1 + Math.floor(Math.random() * (h.lockers.list.length - 1)));
    this.objective();
    const c = this.cfg.hostage;
    this.hud.card(this.cfg.name, `Find and rescue ${c.short}`, 3.5);
    this.after(1.2, () => this.hud.say("COMMAND", `Two days ago the Viper's cell ambushed the convoy of ${c.name}, ${c.title}. They're holding him somewhere inside this old kasbah.`, 7));
    this.after(8.6, () => this.hud.say("COMMAND", "If he dies, the ceasefire dies with him. They've sealed the kasbah's lanes with crates — the only way in is through their market on the east side. Clear it.", 7));
    this.after(16, () => this.hud.say("COMMAND", "Somebody in that cell wrote down where they're keeping him. Find it.", 4.5));
  }

  // ------------------------------------------------------------------ checkpoints
  /** save here (the game's soldiers and the mission as they are now) */
  private checkpoint(at: Vector3, yaw: number) {
    const h = this.host;
    // stand on the nav graph's nearest node (never inside a wall or on a ledge)
    const node = h.nav.nodes[h.nav.nearest(at, false)];
    this.save = {
      n: (this.save?.n ?? 0) + 1,
      phase: this.phase,
      at: node && Vector3.Distance(node.p, at) < 3 ? node.p.clone() : at.clone(),
      yaw,
      dead: h.enemies.enemies.filter((e) => !e.alive),
      woken: [...this.woken],
      gate: h.gate.open,
      searched: h.lockers.list.map((l) => l.searched),
      west: this.westReached,
    };
    h.flash("CHECKPOINT SAVED");
    h.audio.play("radioChirp", { volume: 0.6 });
  }

  /** back to the last checkpoint (the game has just reset the round: everyone at their posts) */
  resume() {
    const s = this.save;
    if (!s) return this.reset();
    const h = this.host;
    this.clear();
    this.phase = s.phase;
    this.westReached = s.west;
    this.woken = new Set(s.woken);
    for (const g of s.woken) h.enemies.wakeGroup(g);
    for (const e of s.dead) e.retire();
    if (s.gate) h.gate.unlock(true);
    else h.gate.close();
    h.lockers.restore(s.searched);
    h.respawn(s.at, s.yaw);
    this.objective();
    this.hud.card(`CHECKPOINT ${s.n}`, this.cfg.name, 2.5);
  }

  // ------------------------------------------------------------------ frame
  update(dt: number, rawDt: number) {
    const h = this.host;
    if (!this.cinematic)
      for (let i = this.later.length - 1; i >= 0; i--) {
        const l = this.later[i];
        l.t -= rawDt;
        if (l.t <= 0) {
          this.later.splice(i, 1);
          l.fn();
        }
      }
    if (this.cinematic) this.runShots(rawDt);
    // (he turns to you before he's posed for the frame)
    if (this.tape === "talk") h.hostage.faceTo(this.eye, dt);
    if (this.tape === "flying") this.flyTape(rawDt);
    h.hostage.update(dt);
    h.lockers.update(dt);
    h.gate.update(dt);
    if (!this.cinematic) this.stage(dt);
    if (this.phase === "ending" && !this.cinematic) {
      this.endT -= rawDt;
      if (this.endT <= 0) this.complete();
    }
    if (this.phase === "failed") {
      this.endT -= rawDt;
      if (this.endT <= 0) {
        this.phase = "done";
        this.hud.reset();
        h.finish(false, "MISSION FAILED", `${this.cfg.name} // THE HOSTAGE IS DEAD`);
      }
    }
    this.hud.update(rawDt, this.cinematic ? null : this.marker, h.camera, h.scene);
  }

  private objective() {
    const c = this.cfg.hostage.short.toUpperCase();
    const left = (g: string) => {
      const n = this.host.enemies.groupAlive(g);
      return n > 0 ? ` · ${n} LEFT` : "";
    };
    const t =
      this.phase === "market" ? `CLEAR THE MARKET${left("market")}` :
      this.phase === "tunnels" ? "SEARCH THE LOCKERS IN THE TUNNELS" :
      this.phase === "west" ? (this.westReached ? "REACH THE WEST GATE" : "GO NORTH TO THE WEST SITE") :
      this.phase === "rescue" ? (this.host.enemies.groupAlive("yard") > 0 ? `KILL ${c}'S GUARDS${left("yard")}` : `FREE ${c}`) :
      this.tape === "taken" ? "HOSTAGE AND TAPE SECURE" : "HOSTAGE SECURE";
    this.host.setObjective(t);
  }

  private go(phase: Phase) {
    // (every part of town passed on the way gets its soldiers, even when a stage is skipped)
    const from = ORDER.indexOf(this.phase), to = ORDER.indexOf(phase);
    for (let i = from + 1; i <= to; i++)
      for (const g of WAKE[ORDER[i]] ?? []) {
        this.host.enemies.wakeGroup(g);
        this.woken.add(g);
      }
    this.phase = phase;
    this.holdT = 0;
    this.prompt = null;
    this.hud.defuse(-1);
    this.objective();
  }

  /** a soldier died: the counts on the objective */
  onKilled(e: Enemy) {
    if (this.phase === "market" && e.spawn.group === "market" && this.host.enemies.groupAlive("market") === 0) {
      this.go("tunnels");
      this.hud.say("COMMAND", "Market's clear. Their runners use the old tunnels under the kasbah — get down there and find their lockers.");
      return;
    }
    if (this.phase === "rescue" && e.spawn.group === "yard" && this.host.enemies.groupAlive("yard") === 0)
      this.hud.say("COMMAND", `His guards are down. Get to ${this.cfg.hostage.short} — get those cuffs off him.`);
    this.objective();
  }

  private stage(dt: number) {
    const h = this.host;
    const me = h.player.feet;
    const p = this.cfg.points;
    // (in plan: the floors are at different heights)
    const near = (q: Vector3, r: number) => Math.hypot(me.x - q.x, me.z - q.z) < r;
    switch (this.phase) {
      case "market":
        // (or slipped past them into the tunnels)
        if (near(p.tunnels, 9)) {
          this.go("tunnels");
          this.hud.say("COMMAND", "You're in their tunnels. Find those lockers — and watch the corners down there.");
        }
        break;
      case "tunnels":
        this.searching(dt);
        break;
      case "west":
        if (!this.westReached && near(p.westSite, 14)) {
          this.westReached = true;
          this.objective();
          this.checkpoint(me, h.player.yaw);
          this.hud.say("COMMAND", "West site. The long road's south of you — the gate's at the end of it.");
        }
        this.unlocking(dt);
        break;
      case "rescue":
        if (!this.heard && Vector3.Distance(me, h.hostage.position) < 24) {
          this.heard = true;
          this.hud.say(this.cfg.hostage.short.toUpperCase(), "Help! Over here — please, I'm over here!");
        }
        this.uncuffing(dt);
        break;
    }
  }

  /** hold USE for `time`: true when done (the bar and the prompt while it fills) */
  private hold(dt: number, time: number, doing: string, idle: string, label: string) {
    if (this.host.input.held("use")) {
      this.holdT += dt / time;
      this.prompt = `${doing} — KEEP HOLDING`;
      this.hud.defuse(this.holdT, label);
      if (this.holdT >= 1) {
        this.holdT = 0;
        this.prompt = null;
        this.hud.defuse(-1);
        return true;
      }
    } else {
      this.holdT = Math.max(0, this.holdT - dt * 2);
      this.prompt = `<b>${bindings.label("use")}</b> HOLD · ${idle}`;
      this.hud.defuse(this.holdT > 0 ? this.holdT : -1, label);
    }
    return false;
  }
  private idle() {
    this.holdT = 0;
    this.prompt = null;
    this.hud.defuse(-1);
  }

  // ------------------------------------------------------------------ the lockers
  private searching(dt: number) {
    const h = this.host;
    const L = h.lockers;
    const i = h.player.alive ? L.facing(h.camera.position, h.camera.getDirection(Vector3.Forward())) : -1;
    if (i !== this.locker) {
      this.locker = i;
      this.holdT = 0;
    }
    if (i < 0) return this.idle();
    if (!this.hold(dt, SEARCH_TIME, "SEARCHING", "SEARCH LOCKER", "SEARCHING")) return;
    h.audio.play("doorOpen", { volume: 0.6, rate: 1.35 });
    if (!L.search(i)) {
      this.hud.say("YOU", L.searchedCount === 1 ? "Rags and ration packs. Nothing." : "Empty.", 2);
      return;
    }
    // the folder, and a ring of keys on it
    this.after(0.45, () => {
      L.takeIntel();
      h.audio.play("foley", { volume: 0.8 });
      this.hud.paper(this.cfg.letter, 11);
      this.go("west");
      // market and tunnels done: checkpoint 1
      this.checkpoint(h.player.feet, h.player.yaw);
      this.after(1.2, () => this.hud.say("COMMAND", "That's him. The south-west yard, behind the west gate — and you've got their keys. He's marked on your map.", 6.5));
      this.after(8, () => this.hud.say("COMMAND", "Out of the tunnels north, through their depot and HQ to the west site. Expect company.", 6));
    });
  }

  // ------------------------------------------------------------------ the west gate
  private unlocking(dt: number) {
    const h = this.host;
    const g = this.cfg.points.gate;
    const me = h.player.feet;
    // on your side of it (north), close enough to reach the padlock
    if (!h.player.alive || Math.abs(me.x - g.x) > 2.4 || me.z < g.z || me.z - g.z > 2.4 || Math.abs(me.y - g.y) > 1.3) return this.idle();
    if (!this.hold(dt, GATE_TIME, "UNLOCKING THE GATE", "UNLOCK THE GATE", "UNLOCKING THE GATE")) return;
    h.gate.unlock();
    h.audio.play("doorOpen", { volume: 1, rate: 0.55 });
    this.go("rescue");
    // the west site and the long road done: checkpoint 3 (at the gate)
    this.checkpoint(me, h.player.yaw);
    this.hud.say("COMMAND", "Gate's open. Move — they'll have heard that.");
  }

  // ------------------------------------------------------------------ the cuffs
  private uncuffing(dt: number) {
    const h = this.host;
    const f = h.player.feet, p = h.hostage.position;
    const near = Math.hypot(p.x - f.x, p.z - f.z) < REACH && Math.abs(p.y - f.y) < 1.3 && h.player.alive;
    if (!near) return this.idle();
    // his guards first (and said so: the prompt never just isn't there)
    const guards = h.enemies.groupAlive("yard");
    if (guards > 0) {
      this.holdT = 0;
      this.hud.defuse(-1);
      this.prompt = `KILL HIS GUARDS FIRST · ${guards} LEFT`;
      return;
    }
    const c = this.cfg.hostage.short.toUpperCase();
    if (this.hold(dt, UNCUFF_TIME, `UNLOCKING ${c}'S CUFFS`, `FREE ${c}`, "UNLOCKING THE CUFFS")) this.freed();
  }

  /** he's free: he gets up, thanks you — and it's over */
  private freed() {
    const h = this.host;
    const hs = h.hostage;
    hs.free();
    // nobody else walks into the ending: whoever's still about is gone (the round's reset brings them back)
    for (const e of h.enemies.enemies) if (e.alive && !e.dormant) e.sleep();
    this.go("ending");
    this.endT = Infinity;
    // cameras in front of him (he faces the open yard; his back is to the wall), each checked at
    // both ends of its move: out of the walls with a margin, and a clear view of his head both
    // seated and once he's up (Sit To Stand lifts him and brings him forward)
    const around = (a: number, r: number, y: number) => hs.position.add(new Vector3(Math.sin(a) * r, y, Math.cos(a) * r));
    const seated = hs.headPos();
    const fwd = new Vector3(Math.sin(hs.heading), 0, Math.cos(hs.heading));
    const standing = seated.add(new Vector3(0, 0.6, 0)).addInPlace(fwd.scale(0.35));
    const roomy = (c: Vector3) =>
      [[0, 0], [0.35, 0], [-0.35, 0], [0, 0.35], [0, -0.35]].every(([dx, dz]) => !h.nav.embedded(c.x + dx, c.y, c.z + dz)) &&
      h.nav.clear(c, seated) &&
      h.nav.clear(c, standing);
    const shot = (offs: number[], r: number, y: number, dr: number, dy: number, da: number) => {
      for (const k of [1, 0.8, 0.62])
        for (const off of offs) {
          const a = hs.heading + off;
          const from = around(a, r * k, y), to = around(a + da, (r + dr) * k, y + dy);
          if (roomy(from) && roomy(to)) return { from, to };
        }
      const a = hs.heading + offs[0];
      return { from: around(a, r * 0.6, y), to: around(a, r * 0.6, y + dy) };
    };
    const s1 = shot([0.45, -0.45, 0.8, -0.8, 0.15, -0.15, 1.2, -1.2], 2.6, 1.3, -0.5, 0.3, -0.15);
    // the hand-over: a point a pace in front of him at eye height (your eyes, as near as the walls
    // allow) — he turns to it and talks to it, and the tape comes to it
    let eyeA = hs.heading, eyeR = 1.25;
    const eye = (() => {
      for (const r of [1.7, 1.45, 1.25])
        for (const off of [0, 0.3, -0.3, 0.6, -0.6, 0.9, -0.9]) {
          const c = around(hs.heading + off, r, 1.62);
          if (roomy(c)) return (eyeA = hs.heading + off), (eyeR = r), c;
        }
      return around(hs.heading, 1.25, 1.62);
    })();
    // off to one side and a little low, back far enough to frame his face and the hand he holds it out with
    const side = (() => {
      for (const off of [0.55, -0.55, 0.8, -0.8, 0.35, -0.35]) {
        const c = around(eyeA + off, eyeR + 0.5, 1.35);
        if (roomy(c)) return c;
      }
      return eye.add(new Vector3(0, -0.2, 0));
    })();
    this.eye.copyFrom(eye);
    const T = this.cfg.tape;
    const who = this.cfg.hostage.short.toUpperCase();
    // (each line on screen long enough to read)
    const dur = (line: string) => Math.max(4, line.length / 16);
    const toward = (k: number, dy = 0) => {
      const c = hs.position.add(new Vector3(0, 1.62, 0));
      return Vector3.Lerp(eye, c, k).addInPlace(new Vector3(0, dy, 0));
    };
    const face = () => hs.headPos().add(new Vector3(0, -0.05, 0));
    const tapeAndFace = () => Vector3.Lerp(hs.tape.isEnabled() ? hs.tape.position : face(), face(), 0.45);
    this.play(
      [
        {
          dur: 3.4,
          from: s1.from,
          to: s1.to,
          look: () => hs.headPos().add(new Vector3(0, -0.1, 0)),
          fov: 0.75,
          // the cuffs are off: he gets up off the chair (Sit To Stand)
          enter: () => hs.standUp(),
          sub: [who, "I thought… I thought nobody was coming. Thank you."],
        },
        {
          // your eyes: he turns to you, and reaches into his coat
          dur: dur(T.talk[0]),
          from: eye,
          to: toward(0.08),
          look: face,
          fov: 0.85,
          enter: () => (this.tape = "talk"),
          cue: [2.2, () => hs.offerTape()],
          sub: [who, T.talk[0]],
        },
        {
          // closer, a little low: the tape in his hand, his face behind it
          dur: dur(T.talk[1]),
          from: side,
          to: Vector3.Lerp(side, toward(0.3, -0.25), 0.15),
          look: tapeAndFace,
          fov: 0.8,
          sub: [who, T.talk[1]],
        },
        {
          dur: dur(T.talk[2]),
          from: toward(0.1),
          to: toward(0.16),
          look: face,
          fov: 0.8,
          sub: [who, T.talk[2]],
        },
        {
          // he holds it out — and it's in your hands
          dur: 2.3,
          from: toward(0.02),
          to: toward(0.06, -0.05),
          // (from his face down to his hand — and held there while the tape comes up to you)
          look: () => Vector3.Lerp(face(), this.tape === "talk" ? hs.tape.position : this.flyFrom, 0.5 * Math.min(1, this.shotT / 0.8)),
          fov: 0.8,
          cue: [1.3, () => this.takeTape()],
          sub: [who, T.offer],
        },
      ],
      () => this.complete(),
    );
  }

  // ------------------------------------------------------------------ the tape
  /** the hand-over's eye point (he turns to it) */
  private eye = new Vector3();

  /** it leaves his hand for yours */
  private takeTape() {
    this.host.hostage.handOver();
    this.tape = "flying";
    this.flyT = 0;
    this.flyFrom.copyFrom(this.host.hostage.tape.position);
    this.host.audio.play("foley", { volume: 0.9 });
  }

  /** the tape on its way from his hand to just under your eyes (then it's in your kit) */
  private flyTape(dt: number) {
    const h = this.host;
    this.flyT = Math.min(1, this.flyT + dt / 0.7);
    const c = h.camera;
    // (into the middle of the frame, a little low — your hands, just out of shot)
    const to = c.position.add(c.getDirection(Vector3.Forward()).scale(0.42)).addInPlace(c.getDirection(Vector3.Up()).scale(-0.07));
    const k = this.flyT * this.flyT * (3 - 2 * this.flyT);
    Vector3.LerpToRef(this.flyFrom, to, k, h.hostage.tape.position);
    if (this.flyT >= 1) {
      h.hostage.tape.setEnabled(false);
      this.tape = "taken";
    }
  }

  /** your bullet or blast found the hostage */
  hostageKilled() {
    if (this.phase === "failed" || this.phase === "done" || this.phase === "ending") return;
    this.phase = "failed";
    this.endT = 2.5;
    this.prompt = null;
    this.hud.defuse(-1);
    this.hud.say("COMMAND", "Hostage down! Hostage down! …Mission failed.");
  }

  private complete() {
    if (this.phase === "done") return;
    this.phase = "done";
    this.save = null;
    this.hud.reset();
    this.host.finish(true, "MISSION COMPLETE", `${this.cfg.name} // HOSTAGE RESCUED · TAPE SECURED`);
  }

  // ------------------------------------------------------------------ cinematics
  private saved = { fov: 1, x: 0, y: 0, z: 0, rx: 0, ry: 0 };
  private play(shots: Shot[], after: () => void) {
    const h = this.host;
    const c = h.camera;
    this.saved = { fov: c.fov, x: c.position.x, y: c.position.y, z: c.position.z, rx: c.rotation.x, ry: c.rotation.y };
    this.shots = shots;
    this.shotI = 0;
    this.shotT = 0;
    this.afterShots = after;
    h.showHud(false);
    h.showWeapon(false);
    this.hud.letterbox(true, false);
    this.startShot();
  }

  /** this shot's cue has fired */
  private cued = false;
  private startShot() {
    const s = this.shots[this.shotI];
    this.cued = false;
    s.enter?.();
    if (s.sub) this.hud.say(s.sub[0], s.sub[1], s.dur);
  }

  private runShots(rawDt: number) {
    const h = this.host;
    const s = this.shots[this.shotI];
    this.shotT += rawDt;
    if (s.cue && !this.cued && this.shotT >= s.cue[0]) {
      this.cued = true;
      s.cue[1]();
    }
    const t = Math.min(1, this.shotT / s.dur);
    const e = t * t * (3 - 2 * t);
    const c = h.camera;
    Vector3.LerpToRef(s.from, s.to, e, c.position);
    const look = s.look().subtract(c.position);
    c.rotation.y = Math.atan2(look.x, look.z);
    c.rotation.x = -Math.atan2(look.y, Math.hypot(look.x, look.z));
    c.rotation.z = 0;
    c.fov = s.fov ?? 0.9;
    if (this.shotT >= s.dur) {
      this.shotI++;
      this.shotT = 0;
      if (this.shotI >= this.shots.length) this.endShots();
      else this.startShot();
    }
  }

  private endShots() {
    const h = this.host;
    const c = h.camera;
    const s = this.saved;
    c.position.set(s.x, s.y, s.z);
    c.rotation.set(s.rx, s.ry, 0);
    c.fov = s.fov;
    this.shots = [];
    this.hud.letterbox(false, false);
    if (this.phase !== "ending") {
      h.showHud(true);
      h.showWeapon(true);
    }
    const a = this.afterShots;
    this.afterShots = null;
    a?.();
  }
}
