import { FreeCamera } from "@babylonjs/core/Cameras/freeCamera";
import { Quaternion, Vector3 } from "@babylonjs/core/Maths/math.vector";
import { Scene } from "@babylonjs/core/scene";
import { AudioEngine } from "../audio/AudioEngine";
import { lookRotation } from "../core/math";
import type { Combatant, Foe, HulkThreat } from "../enemies/Hulk";
import { NavGraph } from "../level/NavGraph";
import type { Dir } from "./SpiderRig";
import type { Rig, SkinnedModel } from "./HeroRig";
import {
  AIR, CLING, CRAWL_A, CRAWL_B, DIVE_KICK, HIT, LANDING, PERCH, RELAXED, RIDE_A, RIDE_B, STANCE, SWING, TUCK,
  aimArm, clipDur, copyPose, follow, loadSpiderClips, mixPose, naturalArms, newPose, sample,
  type ClipName, type DirClip,
} from "./SpiderPoses";
import { WebFx } from "./WebFx";
import type { TeamBoard } from "./Team";

/**
 * SPIDER-MAN — your ally on Red Dune. He keeps near you while the soldiers are about (and takes
 * one down now and then), and when the Hulk lands he goes for him: he swings in on his webs,
 * climbs walls and crouches on rooftops, webs the Hulk up for a moment so you can pour it on,
 * darts in for punch-and-kick combos from the side you aren't, flies in feet first off a rooftop,
 * and flips, rolls and jumps out from under the Hulk's fists, thunderclaps and leaps — reading the
 * Hulk's wind-ups (Hulk.threat) the way you would. He can be hit, thrown and knocked out cold, and
 * gets back up.
 *
 * Movement is his own kinematic body against the level's collision boxes (the NavGraph's ray casts,
 * the same queries the Hulk and the soldiers use): running on the nav graph, ballistic jumps, a
 * rope constraint for swinging (gravity, momentum, a taut line that's reeled in, released at the top
 * of the arc), and crawling on box faces. Nothing here touches the player's controller or camera,
 * and nothing of his blocks your movement or your bullets.
 */

export interface SoldierLike {
  readonly alive: boolean;
  readonly position: Vector3;
  applyHit(damage: number, zone: "head" | "torso" | "limb", dir: Vector3, point: Vector3, info?: { kind: "bullet" | "melee"; force?: number }): boolean;
}

export interface SpiderHost {
  scene: Scene;
  nav: NavGraph;
  audio: AudioEngine;
  player: { feet: Vector3; alive: boolean; yaw: number; health: number; knockedDown: boolean; camera: FreeCamera; velocity: Vector3 };
  playerMaxHealth: number;
  /** the Hulk, if he's on this stage */
  hulk: Foe | null;
  soldiers: () => SoldierLike[];
  /** a puff of dust (a hard landing) */
  dust?: (pos: Vector3, power: number) => void;
  /** the allies' shared board (who just did what) */
  team?: TeamBoard;
}

type Mode = "ground" | "air" | "swing" | "wall" | "ride" | "ko";
/** what he's doing (for anyone watching: the debug overlay, the tests) */
export type SpiderState =
  | "follow" | "explore" | "search" | "approach" | "swing" | "climb" | "dodge" | "web" | "melee" | "air"
  | "assist" | "recover" | "reposition" | "victory" | "hold" | "intro" | "ride";

interface Action {
  kind: "melee" | "web" | "dive" | "flip" | "land" | "tumble" | "down" | "getup" | "mantle" | "kick-soldier" | "victory" | "intro" | "mount" | "ride";
  /** a soft landing's weight (0..1) */
  w?: number;
  t: number;
  dur: number;
  clip?: ClipName;
  speed?: number;
  hits?: number[];
  hitsDone?: number;
  damage?: number;
  force?: number;
  /** the soldier he's taking down */
  soldier?: SoldierLike;
}

const G = 20; // m/s² (snappier than the real thing: heroes fall fast)
const SPIDEY = {
  health: 420,
  run: 6.6,
  sprint: 9.8,
  /** melee reach from the Hulk's centre, and how close he steps in */
  reach: 2.9,
  closeIn: 2.15,
  /** web shot: range and cooldown */
  webRange: [5, 22],
  webCd: 9,
  airCd: 7,
  dodgeCd: 0.9,
};
/** his melee moves: clip, playback speed, when the blows land (fraction), damage each, force */
const MOVES: { clip: ClipName; speed: number; hits: number[]; damage: number; force: number }[] = [
  { clip: "punch", speed: 1.5, hits: [0.39], damage: 15, force: 1 },
  { clip: "hook", speed: 1.35, hits: [0.29], damage: 19, force: 1.2 },
  { clip: "kick", speed: 1.7, hits: [0.56], damage: 24, force: 1.6 },
  { clip: "combo", speed: 1.55, hits: [0.12, 0.21, 0.32, 0.56, 0.62, 0.72, 0.79], damage: 7, force: 0.8 },
];

const V = (x = 0, y = 0, z = 0) => new Vector3(x, y, z);
/** how close to stand: the Hulk's distances as they were; a man-sized foe from closer */
const near = (h: Foe) => Math.max(0.6, Math.min(1, h.size));
const flat = (v: Vector3) => new Vector3(v.x, 0, v.z);
const angDiff = (a: number, b: number) => Math.atan2(Math.sin(a - b), Math.cos(a - b));
const rnd = (a: number, b: number) => a + Math.random() * (b - a);
const pick = <T,>(a: T[]) => a[Math.floor(Math.random() * a.length)];

export class SpiderMan implements Combatant {
  readonly rig: Rig;
  /** the model's own clips (run, stand, jumps, swings, hanging, dances), as bone directions */
  private own: Record<string, DirClip>;
  readonly webs: WebFx;
  /** feet (his anchor: on a wall, the point against it) */
  readonly p = V();
  readonly v = V();
  yaw = 0;
  mode: Mode = "ground";
  ai: SpiderState = "follow";
  health = SPIDEY.health;
  readonly maxHealth = SPIDEY.health;
  private enabled = false;
  private clips!: Record<ClipName, DirClip>;
  private action: Action | null = null;
  private aiT = 0;
  private thinkT = 0;
  private goal: Vector3 | null = null;
  private pace: "walk" | "run" | "sprint" = "run";
  private path: Vector3[] = [];
  private repath = 0;
  private cd = { web: 3, air: 4, dodge: 0, melee: 0, swing: 0, explore: 10, soldier: 6, think: 0, stuck: 0, ride: 6, quip: 8 };
  private lastMove = -1;
  private side = 1;
  private flank = 1;
  /** the swing: anchor, rope length, the strand drawn, seconds on it */
  private rope = { A: V(), L: 8, Lgoal: 8, id: -1, t: 0 };
  /** on a wall: its outward normal, the box, its top */
  private wall = { n: V(), box: -1, top: 0, phase: 0, sideDir: 0 };
  private mantle = { from: V(), to: V(), t: -1 };
  /** a flip: axis ("pitch" back/forward, "roll" sideways), angle, rate */
  private flip = { axis: "pitch" as "pitch" | "roll", a: 0, rate: 0 };
  private anchors: Vector3[] = [];
  private shown = newPose();
  private want = newPose();
  private runPhase = 0;
  private crawlPhase = 0;
  private downFor = 0;
  private koT = 0;
  private reaction = -1;
  private pendingThreat: HulkThreat | null = null;
  private wasFighting = false;
  private webShot: { blob: ReturnType<WebFx["blob"]>; line: number; at: Vector3; vel: Vector3; t: number } | null = null;
  private pins: number[] = [];
  private stepT = 0;
  private hud: HTMLDivElement;
  private hudBar: HTMLDivElement;
  private q = new Quaternion();
  private lastPos = V();
  private stillT = 0;

  private constructor(private host: SpiderHost, model: SkinnedModel) {
    this.rig = model.spawn("spidey");
    this.own = model.clips;
    this.webs = new WebFx(host.scene);
    this.rig.setVisible(false);
    this.findAnchors();
    // his health, under yours
    this.hud = document.createElement("div");
    this.hud.id = "ally-hud";
    this.hud.innerHTML = `<div class="ally-name">SPIDER-MAN</div><div class="ally-track"><div class="ally-bar"></div></div><div class="ally-state"></div>`;
    document.getElementById("hud")?.appendChild(this.hud);
    this.hudBar = this.hud.querySelector(".ally-bar") as HTMLDivElement;
    this.hud.style.display = "none";
    // what he says (subtitles)
    this.line = document.createElement("div");
    this.line.id = "spidey-line";
    document.getElementById("hud")?.appendChild(this.line);
  }
  private line: HTMLDivElement;
  private lineT = 0;
  /** a line of his, as a subtitle */
  say(text: string, secs = 3.2) {
    this.line.innerHTML = `<b>SPIDER-MAN</b> ${text}`;
    this.line.classList.add("on");
    this.lineT = secs;
    this.cd.quip = 14 + Math.random() * 10;
  }

  static async create(host: SpiderHost, model: SkinnedModel) {
    const s = new SpiderMan(host, model);
    s.clips = await loadSpiderClips();
    return s;
  }

  // ------------------------------------------------------------------ Combatant (the Hulk's view of him)
  get feet() {
    return this.p;
  }
  get alive() {
    return this.enabled && this.mode !== "ko";
  }
  takeDamage(amount: number, _from: Vector3) {
    if (!this.alive) return;
    this.health = Math.max(0, this.health - amount * 0.45);
    this.host.audio.play("fleshHit", { x: this.p.x, y: this.p.y + 1.2, z: this.p.z, volume: 0.7 });
    if (this.health <= 0) this.knockOut();
  }
  /** hurled off the Hulk's back */
  thrown(vel: Vector3, up: number) {
    if (!this.enabled) return;
    if (this.mode === "ko") return;
    this.mode = "ground";
    this.knock(vel, up);
    if (Math.random() < 0.5) this.say(pick(["Whoa — okay, okay, I'm off!", "Rude!", "Somebody's not a hugger."]), 2.2);
  }
  knock(vel: Vector3, up = 0) {
    if (!this.enabled || this.mode === "ko") return;
    this.dropRope();
    this.v.copyFrom(vel).scaleInPlace(0.85);
    this.v.y = Math.max(this.v.y, up + 1.5);
    this.mode = "air";
    this.p.y += 0.05;
    this.action = { kind: "tumble", t: 0, dur: 9 };
    this.flip = { axis: "pitch", a: 0, rate: -7 };
    this.ai = "recover";
  }
  knockDown(seconds: number) {
    this.downFor = Math.max(this.downFor, seconds * 0.8);
  }

  // ------------------------------------------------------------------ in and out
  spawn(at: Vector3, yaw: number) {
    this.enabled = true;
    this.p.copyFrom(at);
    this.v.setAll(0);
    this.yaw = yaw;
    this.mode = "ground";
    this.health = this.maxHealth;
    this.action = null;
    this.ai = "follow";
    this.wasFighting = false;
    this.dropRope();
    this.webs.reset();
    this.webShot = null;
    this.pins = [];
    copyPose(STANCE, this.shown);
    this.rig.setVisible(true);
    this.hud.style.display = "";
  }
  hide() {
    this.enabled = false;
    this.rig.setVisible(false);
    this.webs.reset();
    this.hud.style.display = "none";
    this.line.classList.remove("on");
    this.lineT = 0;
  }
  get active() {
    return this.enabled;
  }
  /** his entrance is playing (the camera's on him, the fight holds) — and the leap into it */
  get cinematic() {
    return this.enabled && (this.action?.kind === "intro" || this.introLeap > 0);
  }
  private introLeap = 0;
  /**
   * The entrance's camera (a drone): straight above him at first, high, coming down and round as
   * he talks; then after him as he leaps. Null when there's no entrance playing.
   */
  cineShot(): { pos: Vector3; target: Vector3; fov: number } | null {
    if (!this.cinematic) return null;
    const c = this.center();
    const a = this.action;
    if (a?.kind === "intro") {
      const f = Math.min(1, a.t / a.dur);
      const e = f * f * (3 - 2 * f);
      const ang = this.yaw + Math.PI + 0.3 + e * 1.1;
      const r = 0.6 + e * 3.4, h = 15 - e * 8.5;
      return { pos: c.add(V(Math.sin(ang) * r, h, Math.cos(ang) * r)), target: c.add(V(0, -0.2, 0)), fov: 0.75 - e * 0.15 };
    }
    // the leap: from behind and above, following him down into the fight
    const back = V(-Math.sin(this.yaw), 0, -Math.cos(this.yaw));
    return { pos: c.add(back.scale(5)).addInPlaceFromFloats(0, 3.2, 0), target: c.add(V(0, -0.3, 0)), fov: 0.85 };
  }
  /** skip the entrance: straight off the container into the fight */
  skip() {
    if (this.action?.kind === "intro") this.action.t = this.action.dur;
    this.introLeap = 0;
  }
  /** where the camera looks during his entrance */
  cineFocus() {
    return this.center().add(V(0, 0.35, 0));
  }

  /**
   * His entrance: standing on top of a container, looking down at the Hulk — the camera a drone high
   * above him, coming down and round — a line for the Hulk, then the leap down into it.
   */
  enter(at: Vector3, face: Vector3) {
    this.spawn(at, 0);
    const to = flat(face.subtract(at));
    this.yaw = Math.atan2(to.x, to.z);
    this.reclineFwd.copyFrom(to.lengthSquared() > 1e-4 ? to.normalize() : V(0, 0, 1));
    this.action = { kind: "intro", t: 0, dur: 4.6 };
    this.setAi("intro");
    copyPose(STANCE, this.shown);
    // (the Hulk is on your side now: Spider-Man's first look is at him, and he's thrilled)
    this.say(pick(["Wait — Big Green's on <i>our</i> side today? Best. Day. Ever.", "Okay, the Hulk's with us. Nobody make him angry. Angrier.", "Hey, big guy! Save some for me!"]), 3.6);
    this.host.audio.play("webShoot", { x: at.x, y: at.y + 1, z: at.z, volume: 0.5, rate: 0.9 });
  }
  private reclineFwd = V(0, 0, 1);

  private knockOut() {
    this.dropRope();
    this.mode = "ko";
    this.koT = 9;
    this.ai = "recover";
    this.action = { kind: "down", t: 0, dur: 9 };
    this.host.audio.play("bodyFall", { x: this.p.x, y: this.p.y, z: this.p.z, volume: 0.8 });
  }

  // ------------------------------------------------------------------ the web anchors on Red Dune
  /**
   * Where a web can stick: along the top edges of anything tall (the warehouse, the lab's roof,
   * stacked containers, the watch platform, the mast) — points that are really on a box.
   */
  private findAnchors() {
    const nav = this.host.nav;
    for (let i = 0; i < nav.boxCount; i++) {
      const [x0, y0, z0, x1, y1, z1] = nav.boxBoundsOf(i);
      if (y1 < 4.4 || y1 - y0 < 0.3 || Math.max(x1 - x0, z1 - z0) < 1.2) continue;
      const edges: [number, number, number, number][] = [
        [x0, z0, x1, z0], [x1, z0, x1, z1], [x1, z1, x0, z1], [x0, z1, x0, z0],
      ];
      for (const [ax, az, bx, bz] of edges) {
        const L = Math.hypot(bx - ax, bz - az);
        const n = Math.max(1, Math.round(L / 3.5));
        for (let k = 0; k <= n; k++) {
          const x = ax + ((bx - ax) * k) / n, z = az + ((bz - az) * k) / n;
          // (an edge point of a turned box's bounds may be in thin air: keep only ones on the box)
          const ix = x + Math.sign((x0 + x1) / 2 - x) * 0.25, iz = z + Math.sign((z0 + z1) / 2 - z) * 0.25;
          if (!nav.embedded(ix, y1 - 0.08, iz)) continue;
          if (this.anchors.some((a) => Math.abs(a.x - ix) + Math.abs(a.z - iz) < 1.5 && Math.abs(a.y - y1) < 0.5)) continue;
          this.anchors.push(V(ix, y1 - 0.05, iz));
        }
      }
    }
  }

  /** the best anchor to swing on toward `dir` from where he is (null: nothing suitable) */
  private pickAnchor(dir: Vector3, maxDist = 26) {
    const nav = this.host.nav;
    const c = this.center();
    const floor = nav.floorAt(c.x, c.y, c.z, 30) ?? 0;
    const cands: { a: Vector3; s: number; L: number }[] = [];
    for (const a of this.anchors) {
      const dx = a.x - c.x, dz = a.z - c.z;
      const h = Math.hypot(dx, dz);
      if (h < 3 || h > maxDist || a.y < c.y + 2.5) continue;
      const fwd = (dx * dir.x + dz * dir.z) / h;
      if (fwd < 0.25) continue;
      const L = Math.hypot(h, a.y - c.y);
      // the rope is shortened so the bottom of the arc clears the ground
      const Lg = Math.min(L, a.y - floor - 1.3);
      if (Lg < 4) continue;
      cands.push({ a, s: fwd * 10 + Math.min(h, 16) - Math.abs(a.y - c.y - 7) * 0.3, L: Lg });
    }
    cands.sort((x, y) => y.s - x.s);
    for (const k of cands.slice(0, 10)) {
      const toC = c.subtract(k.a).normalize();
      if (nav.clear(c, k.a.add(toC.scale(0.4)))) return k;
    }
    return null;
  }

  // ------------------------------------------------------------------ frame
  update(dt: number) {
    if (!this.enabled) return;
    for (const k of Object.keys(this.cd) as (keyof typeof this.cd)[]) this.cd[k] -= dt;
    if (this.introLeap > 0) this.introLeap -= dt;
    this.aiT += dt;
    if (this.mode === "ko") this.recovering(dt);
    else {
      this.react(dt);
      this.think(dt);
    }
    this.act(dt);
    this.move(dt);
    // (never let a bad number loose: if one ever gets in, he's back at your side)
    if (!isFinite(this.p.x + this.p.y + this.p.z + this.v.x + this.v.y + this.v.z + this.yaw)) {
      console.warn("spidey: bad state, respawning", this.mode, this.action?.kind, this.ai);
      this.spawn(this.host.player.feet.add(V(1.5, 0, 0)), 0);
    }
    this.animate(dt);
    this.updateWebShot(dt);
    this.updatePins();
    this.webs.update(dt);
    this.hudBar.style.width = `${(100 * this.health) / this.maxHealth}%`;
    if (this.lineT > 0 && (this.lineT -= dt) <= 0) this.line.classList.remove("on");
    this.hud.classList.toggle("ko", this.mode === "ko");
    (this.hud.querySelector(".ally-state") as HTMLDivElement).textContent = this.mode === "ko" ? "DOWN" : "";
  }

  /** his centre of mass (swinging, collisions) */
  private center() {
    return this.mode === "wall" ? this.p.add(this.wall.n.scale(0.4)) : this.p.add(V(0, 1.0, 0));
  }
  private get hulk() {
    const h = this.host.hulk;
    return h && h.alive && h.state !== "dormant" ? h : null;
  }
  /** the Hulk's chest */
  private hulkChest(h: Foe) {
    return h.position.add(V(0, 1.7 * h.size, 0));
  }
  private busy() {
    const a = this.action;
    return !!a && a.kind !== "victory";
  }

  // ------------------------------------------------------------------ reading the Hulk: get out of the way
  private react(dt: number) {
    const h = this.hulk;
    if (!h || h.cinematic) return;
    if (this.reaction >= 0) {
      this.reaction -= dt;
      if (this.reaction < 0 && this.pendingThreat) this.dodge(this.pendingThreat);
      return;
    }
    if (this.cd.dodge > 0 || this.mode === "swing" || this.mode === "wall" || this.mode === "ride") return;
    if (this.action?.kind === "intro" || this.action?.kind === "mount") return;
    if (this.action && (this.action.kind === "tumble" || this.action.kind === "down" || this.action.kind === "flip" || this.action.kind === "getup")) return;
    const t = h.threat();
    if (!t || !this.inDanger(t, 0.6) || t.t > 0.5) return;
    // he reads it and goes — after his reaction time (if it's already too late, it lands)
    const delay = rnd(0.05, 0.2);
    if (t.t < delay * 0.8 && Math.random() < 0.6) {
      this.cd.dodge = 0.6;
      return;
    }
    this.reaction = delay;
    this.pendingThreat = t;
  }
  private inDanger(t: HulkThreat, margin: number) {
    const to = this.p.subtract(t.at);
    if (Math.abs(to.y) > 2.6) return false;
    to.y = 0;
    const d = to.length();
    if (d > t.radius + margin) return false;
    if (t.cone >= Math.PI || d < 0.5) return true;
    const ang = Math.abs(angDiff(Math.atan2(to.x, to.z), Math.atan2(t.dir.x, t.dir.z)));
    return ang < t.cone + 0.25;
  }

  /** out from under it: flip back from a fist, jump sideways out of a clap's cone, clear a landing */
  private dodge(t: HulkThreat) {
    this.pendingThreat = null;
    this.cd.dodge = SPIDEY.dodgeCd;
    this.dropRope();
    this.action = null;
    const away = flat(this.p.subtract(t.at));
    if (away.lengthSquared() < 1e-3) away.copyFrom(V(Math.sin(this.yaw + Math.PI), 0, Math.cos(this.yaw + Math.PI)));
    away.normalize();
    this.ai = "dodge";
    this.aiT = 0;
    if (t.kind === "clap") {
      // sideways, out of the cone (whichever side is clear)
      const side = V(t.dir.z, 0, -t.dir.x).normalize();
      const s = Math.sign(Vector3.Dot(side, away)) || 1;
      const clearA = this.host.nav.moveRay(this.center(), this.center().add(side.scale(4 * s))) < 0;
      const dir = side.scale(clearA ? s : -s);
      this.jump(dir.scale(8.5), 5.2);
      this.flip = { axis: "roll", a: 0, rate: 9 * (clearA ? s : -s) };
    } else if (t.kind === "punch") {
      // a back-flip out of reach
      this.yaw = Math.atan2(-away.x, -away.z);
      this.jump(away.scale(7.8), 5.6);
      this.flip = { axis: "pitch", a: 0, rate: -8.5 };
    } else {
      // a leap or a ground-pound: clear the circle
      this.jump(away.scale(9.5), 6.5);
      this.flip = { axis: "pitch", a: 0, rate: 7 };
    }
    this.action = { kind: "flip", t: 0, dur: 9 };
    this.host.audio.play("meleeSwing", { x: this.p.x, y: this.p.y + 1, z: this.p.z, volume: 0.5, rate: 1.3 });
  }

  // ------------------------------------------------------------------ deciding
  private think(dt: number) {
    this.thinkT -= dt;
    if (this.thinkT > 0) return;
    this.thinkT = 0.2;
    const h = this.hulk;
    const host = this.host;
    if (this.action?.kind === "intro" || this.mode === "ride" || this.action?.kind === "mount") return;
    // the Hulk's entrance: he watches it with you
    if (host.hulk?.cinematic) {
      this.setAi("hold");
      this.goal = null;
      return;
    }
    // the Hulk's down — but there are still soldiers about: after them
    if (this.wasFighting && host.hulk && !host.hulk.alive && host.hulk.state === "down" && !this.busy()) {
      const s = this.nearestSoldier(80);
      if (s) {
        this.setAi("assist");
        if (this.huntOf !== s) (this.huntOf = s), (this.huntT = 0);
        this.huntT += 0.2;
        if (this.huntT > 10) {
          this.gaveUp.set(s, performance.now() / 1000 + 30);
          this.huntOf = null;
          return;
        }
        const d = Vector3.Distance(flat(s.position), flat(this.p));
        if (d < 1.9 && this.mode === "ground") {
          this.startKickSoldier(s);
          this.cd.soldier = 1;
        } else {
          this.goTo(s.position, "sprint");
          if (d > 18 && this.mode === "ground" && this.cd.swing <= 0) this.trySwing(flat(s.position.subtract(this.p)).normalize());
        }
        return;
      }
    }
    if (this.wasFighting && host.hulk && !host.hulk.alive && host.hulk.state === "down") {
      if (this.ai !== "victory") {
        this.setAi("victory");
        this.cd.explore = 6;
        this.say(pick(["And stay down! …Please stay down.", "Nap time, big guy.", "That's what I call a smashing success."]), 3.2);
      }
    }
    if (h) {
      this.wasFighting = true;
      this.fight(h);
    } else if (this.ai === "victory" && this.cd.explore > 0) this.celebrate();
    else this.peace();
  }
  private setAi(s: SpiderState) {
    if (this.ai !== s) {
      this.ai = s;
      this.aiT = 0;
    }
  }

  /** no Hulk: stay with the player (a little behind, off to one side), look around, help out */
  private peace() {
    const host = this.host;
    const me = host.player.feet;
    if (this.busy()) return;
    // a soldier giving you trouble, near him: he takes him down
    if (this.cd.soldier <= 0 && this.mode === "ground") {
      const s = this.soldierToHit();
      if (s) {
        this.setAi("assist");
        this.goTo(s.position, "sprint");
        if (Vector3.Distance(flat(s.position), flat(this.p)) < 1.9) this.startKickSoldier(s);
        return;
      }
    }
    // now and then he heads up somewhere high nearby and crouches there a while
    if (this.ai === "explore") {
      if (this.aiT > 14 || Vector3.Distance(this.p, me) > 26) this.setAi("follow");
      else {
        this.exploreStep();
        return;
      }
    } else if (this.cd.explore <= 0 && this.mode === "ground" && Vector3.Distance(this.p, me) < 9) {
      this.cd.explore = rnd(16, 26);
      if (this.pickPerch(me, 14)) {
        this.setAi("explore");
        return;
      }
    }
    this.setAi("follow");
    // keep to the side and a step behind you (never in your line of fire)
    const yaw = host.player.yaw;
    const fwd = V(Math.sin(yaw), 0, Math.cos(yaw)), right = V(Math.cos(yaw), 0, -Math.sin(yaw));
    const rel = this.p.subtract(me);
    if (Math.abs(Vector3.Dot(rel, right)) > 1.5) this.side = Math.sign(Vector3.Dot(rel, right));
    const spot = me.add(right.scale(this.side * 2.8)).addInPlace(fwd.scale(-2.2));
    const d = Vector3.Distance(flat(this.p), flat(me));
    if (this.mode === "wall") {
      // come down off a wall to follow
      if (d > 6) this.leaveWall(flat(me.subtract(this.p)).normalize());
      return;
    }
    if (d > 3.6 || Vector3.Distance(flat(this.p), flat(spot)) > 2.2) this.goTo(spot, d > 12 ? "sprint" : d > 6 ? "run" : "walk");
    else this.goal = null;
    // far behind: swing to catch up
    if (d > 18 && this.mode !== "swing" && this.cd.swing <= 0) this.trySwing(flat(me.subtract(this.p)).normalize());
  }

  private celebrate() {
    // the fight's over: he joins you and crouches, watching the big guy sleep it off
    const me = this.host.player.feet;
    const d = Vector3.Distance(flat(this.p), flat(me));
    if (this.mode === "wall") return this.leaveWall(flat(me.subtract(this.p)).normalize());
    if (d > 4) this.goTo(me.add(V(Math.cos(this.host.player.yaw) * 2.5, 0, -Math.sin(this.host.player.yaw) * 2.5)), "run");
    else {
      this.goal = null;
      if (!this.action) {
        this.action = { kind: "victory", t: 0, dur: 99 };
        this.dance = pick(["silly_1", "silly_2", "hip_hop", "moonwalk"].filter((k) => this.own[k]));
      }
    }
  }

  /**
   * The fight. Every few tenths of a second he weighs it up: is the Hulk after him, or after you
   * (and are you in trouble)? Is a web ready, a dive, an opening to go in close? He comes in from
   * the side you aren't, hits and gets out, and never stands about.
   */
  private fight(h: Foe) {
    const host = this.host;
    const me = host.player.feet;
    if (this.ai === "victory" || this.ai === "follow" || this.ai === "explore" || this.ai === "hold") this.setAi("approach");
    if (this.busy()) return;
    const hc = flat(h.position);
    const myD = Vector3.Distance(flat(this.p), hc);
    const sees = host.nav.clear(this.center(), this.hulkChest(h));
    const afterMe = h.target === this;
    const afterYou = (h.target as unknown) === host.player;
    const youHurt = host.player.knockedDown || host.player.health < host.playerMaxHealth * 0.35;
    const youClose = Vector3.Distance(flat(me), hc) < 9;

    // on a wall or a rooftop: drop in on him (a flying kick) or web him from up there
    if (this.mode === "wall") {
      if (this.cd.web <= 0 && sees && myD < SPIDEY.webRange[1]) return this.startWeb(h);
      if (this.aiT > 1.5 || myD < 10) this.leaveWall(flat(h.position.subtract(this.p)).normalize());
      return;
    }
    if (this.mode === "swing") return;

    // you're in trouble: he steps in — web him, or hit him hard enough to turn him round
    if (afterYou && youHurt && youClose) {
      this.setAi("assist");
      if (this.cd.web <= 0 && sees && myD > 4 && myD < SPIDEY.webRange[1]) return this.startWeb(h);
      if (this.cd.air <= 0 && sees && myD > 5 && myD < 14 && this.mode === "ground") return this.startDive(h);
      return this.closeIn(h, myD);
    }
    // he's chasing me: keep away — up a wall, onto a roof, over his head on a web — then hit back
    if (afterMe && myD < 7 && this.mode === "ground" && this.ai !== "melee") {
      this.setAi("reposition");
      if (Math.random() < 0.4 && this.pickPerch(this.p, 10, h.position)) return;
      const away = flat(this.p.subtract(h.position)).normalize();
      const side = V(away.z, 0, -away.x).scale(this.flank);
      if (this.cd.swing <= 0 && this.trySwing(away.add(side).normalize())) return;
      this.goTo(this.p.add(away.scale(7)).addInPlace(side.scale(4)), "sprint");
      return;
    }
    // he's laying into you and a web's ready: hold him so you can pour it on
    if (afterYou && youClose && this.cd.web <= 0 && sees && myD > 4 && myD < SPIDEY.webRange[1] && h.webbedT <= 0) {
      this.setAi("web");
      return this.startWeb(h);
    }
    // a soldier close by, and the Hulk busy with someone else: take him out of the fight
    if (this.cd.soldier <= 0 && this.mode === "ground" && (!afterMe || myD > 9)) {
      const s = this.soldierToHit(12);
      if (s) {
        this.setAi("assist");
        this.goTo(s.position, "sprint");
        if (Vector3.Distance(flat(s.position), flat(this.p)) < 1.9) this.startKickSoldier(s);
        return;
      }
    }
    // like the films: up onto his back and pound on his head
    if (this.cd.ride <= 0 && this.mode === "ground" && sees && myD > 2 && myD < 7 && !h.rider && (h.state === "chase" || h.state === "attack" || h.state === "webbed") && (this.host.team?.since("heavy") ?? 99) > 1.5) {
      this.host.team?.mark("heavy");
      this.setAi("ride");
      return this.startMount(h);
    }
    // can't see him / far away: go and find him
    if (!sees && myD > 14) {
      this.setAi("search");
      this.goTo(h.position, "sprint");
      if (myD > 20 && this.cd.swing <= 0) this.trySwing(flat(h.position.subtract(this.p)).normalize());
      return;
    }
    // an opening at range: the flying kick
    if (this.cd.air <= 0 && sees && myD > 6 && myD < 13 && Math.random() < 0.5 && (this.host.team?.since("heavy") ?? 99) > 1.5) {
      this.setAi("air");
      return this.startDive(h);
    }
    if (this.cd.web <= 0 && sees && myD > 6 && myD < SPIDEY.webRange[1] && Math.random() < 0.35 && h.webbedT <= 0) {
      this.setAi("web");
      return this.startWeb(h);
    }
    this.setAi(myD < SPIDEY.reach * near(h) ? "melee" : "approach");
    this.closeIn(h, myD);
  }

  /** in close, from the flank (not between you and him), and hit him */
  private closeIn(h: Foe, myD: number) {
    const me = this.host.player.feet;
    // the side of him away from your line of fire
    const fromYou = flat(h.position.subtract(me));
    if (fromYou.lengthSquared() < 1e-3) fromYou.set(1, 0, 0);
    fromYou.normalize();
    const base = Math.atan2(fromYou.x, fromYou.z);
    const a = base + this.flank * 1.5;
    // (a man-sized foe — Wolverine — is fought from closer than the Hulk)
    const k = near(h);
    const spot = h.position.add(V(Math.sin(a), 0, Math.cos(a)).scale(SPIDEY.closeIn * k));
    const t = h.threat();
    // he's swinging at me right now: wait for the dodge, don't walk into it
    if (t && t.target === this && t.t < 0.6) return;
    if (myD < SPIDEY.reach * k && this.cd.melee <= 0 && this.mode === "ground") return this.startMelee(h);
    if (myD > 16 && this.cd.swing <= 0 && this.trySwing(flat(spot.subtract(this.p)).normalize())) return;
    this.goTo(myD < 3.5 ? spot : h.position.add(flat(this.p.subtract(h.position)).normalize().scale(SPIDEY.closeIn * k)), myD > 7 ? "sprint" : "run");
  }

  // ------------------------------------------------------------------ actions
  private startMelee(h: Foe) {
    // never the same move twice running
    let k = Math.floor(Math.random() * MOVES.length);
    if (k === this.lastMove) k = (k + 1 + Math.floor(Math.random() * (MOVES.length - 1))) % MOVES.length;
    this.lastMove = k;
    const m = MOVES[k];
    this.faceTo(h.position);
    this.goal = null;
    this.v.setAll(0);
    this.action = { kind: "melee", t: 0, dur: clipDur(this.clips[m.clip]) / m.speed, clip: m.clip, speed: m.speed, hits: m.hits, hitsDone: 0, damage: m.damage, force: m.force };
  }

  private startWeb(h: Foe) {
    this.host.team?.mark("web");
    this.cd.web = SPIDEY.webCd + rnd(-1, 2);
    this.goal = null;
    this.faceTo(h.position);
    this.action = { kind: "web", t: 0, dur: 0.55 };
  }

  /** the flying kick: up and in, feet first, onto his chest */
  private startDive(h: Foe) {
    this.host.team?.mark("heavy");
    this.cd.air = SPIDEY.airCd + rnd(-1, 2);
    const target = this.hulkChest(h).add(flat(this.p.subtract(h.position)).normalize().scale(0.9));
    const from = this.center();
    const T = Math.max(0.55, Math.min(0.95, Vector3.Distance(from, target) / 13));
    // the ballistic arc that gets there in T
    const vel = target.subtract(from).scaleInPlace(1 / T);
    vel.y += 0.5 * G * T;
    this.faceTo(h.position);
    this.v.copyFrom(vel);
    this.mode = "air";
    this.p.y += 0.05;
    this.action = { kind: "dive", t: 0, dur: T + 0.4, damage: 42, force: 2.2 };
    this.flip = { axis: "pitch", a: 0, rate: 0 };
    this.host.audio.play("meleeSwing", { x: this.p.x, y: this.p.y + 1, z: this.p.z, volume: 0.6, rate: 0.8 });
  }

  /** the leap onto his back */
  private startMount(h: Foe) {
    this.cd.ride = rnd(16, 24);
    const target = h.riderPoint();
    const from = this.center();
    const T = 0.6;
    const vel = target.subtract(from).scaleInPlace(1 / T);
    vel.y += 0.5 * G * T;
    this.faceTo(h.position);
    this.v.copyFrom(vel);
    this.mode = "air";
    this.p.y += 0.05;
    this.action = { kind: "mount", t: 0, dur: T + 0.35 };
    this.flip = { axis: "pitch", a: 0, rate: 0 };
    this.host.audio.play("meleeSwing", { x: this.p.x, y: this.p.y + 1, z: this.p.z, volume: 0.6, rate: 0.9 });
  }
  /** riding: knees round his neck, a fist into his head every half second */
  private riding(dt: number, a: Action) {
    const h = this.host.hulk;
    if (!h || !h.alive || h.rider !== this) {
      // he's down, or we're off: let go
      this.mode = "air";
      this.action = null;
      this.v.set(-Math.sin(this.yaw) * 3, 4, -Math.cos(this.yaw) * 3);
      return;
    }
    const before = Math.floor((a.t - dt) / 0.45), now = Math.floor(a.t / 0.45);
    if (now > before && a.t > 0.3) {
      const head = h.bonePos("head");
      h.applyHit(9, "head", V(Math.sin(this.yaw), -0.6, Math.cos(this.yaw)).normalize(), head, { kind: "melee", force: 0, source: this });
      this.host.audio.play("meleeHit", { x: head.x, y: head.y, z: head.z, volume: 0.85, rate: 1.05 });
      this.host.dust?.(head, 0.12);
    }
  }

  private soldierToHit(range = 16) {
    const me = this.host.player.feet;
    let best: SoldierLike | null = null, bd = range;
    for (const s of this.host.soldiers()) {
      if (!s.alive) continue;
      const d = Vector3.Distance(s.position, this.p);
      if (d < bd && Vector3.Distance(s.position, me) < 30 && Math.abs(s.position.y - 0.9 - this.p.y) < 1.5 && this.host.nav.clear(this.center(), s.position.add(V(0, 0.3, 0))))
        (bd = d), (best = s);
    }
    return best;
  }
  private gaveUp = new Map<SoldierLike, number>();
  private huntOf: SoldierLike | null = null;
  private huntT = 0;
  /** the nearest soldier still standing (no line of sight needed: he'll go and find him) */
  private nearestSoldier(range: number) {
    let best: SoldierLike | null = null, bd = range;
    for (const s of this.host.soldiers()) {
      // (one up on a roof or a gantry he leaves to Iron Man and the guns)
      if (!s.alive || s.position.y - 0.9 > this.p.y + 1.5 || (this.gaveUp.get(s) ?? 0) > performance.now() / 1000) continue;
      const d = Vector3.Distance(s.position, this.p);
      if (d < bd) (bd = d), (best = s);
    }
    return best;
  }
  private startKickSoldier(s: SoldierLike) {
    this.cd.soldier = rnd(10, 15);
    this.faceTo(s.position);
    this.goal = null;
    const m = MOVES[2];
    this.action = { kind: "kick-soldier", t: 0, dur: clipDur(this.clips.kick) / m.speed, clip: "kick", speed: m.speed, hits: m.hits, hitsDone: 0, damage: 140, force: 2, soldier: s };
  }

  private act(dt: number) {
    const a = this.action;
    if (!a) return;
    a.t += dt;
    const h = this.hulk;
    switch (a.kind) {
      case "melee":
      case "kick-soldier": {
        const tgt = a.kind === "melee" ? h?.position : a.soldier?.position;
        if (tgt) this.turnTo(Math.atan2(tgt.x - this.p.x, tgt.z - this.p.z), dt, 8);
        const f = a.t / a.dur;
        while (a.hits && a.hitsDone! < a.hits.length && f >= a.hits[a.hitsDone!]) {
          a.hitsDone!++;
          this.host.audio.play("meleeSwing", { x: this.p.x, y: this.p.y + 1.2, z: this.p.z, volume: 0.45, rate: 1.2 });
          if (a.kind === "melee" && h) this.strike(h, a.damage!, a.force!);
          if (a.kind === "kick-soldier" && a.soldier?.alive && Vector3.Distance(a.soldier.position, this.p) < 2.4) {
            const dir = flat(a.soldier.position.subtract(this.p)).normalize();
            a.soldier.applyHit(a.damage!, "torso", dir, a.soldier.position.add(V(0, 1.2, 0)), { kind: "melee", force: 2 });
            this.host.audio.play("meleeHit", { x: this.p.x, y: this.p.y + 1, z: this.p.z, volume: 0.8 });
          }
        }
        if (a.t >= a.dur) {
          this.action = null;
          if (a.kind === "melee") {
            this.cd.melee = rnd(0.2, 0.6);
            // hit and get out: most times he flips or darts away before going in again
            if (h && Math.random() < 0.6) this.hopAway(h);
          }
        }
        break;
      }
      case "web": {
        if (h) this.turnTo(Math.atan2(h.position.x - this.p.x, h.position.z - this.p.z), dt, 10);
        if (a.t >= 0.18 && !this.webShot && h) this.fireWeb(h);
        if (a.t >= a.dur) this.action = null;
        break;
      }
      case "dive": {
        if (h && Vector3.Distance(this.center(), this.hulkChest(h)) < 1.8 * h.size) {
          this.strike(h, a.damage!, a.force!, true);
          // off his chest: flip back and away
          const back = flat(this.p.subtract(h.position)).normalize();
          this.v.copyFrom(back.scale(6.5)).addInPlace(V(0, 6.5, 0));
          this.flip = { axis: "pitch", a: 0, rate: -8 };
          this.action = { kind: "flip", t: 0, dur: 9 };
        } else if (a.t >= a.dur && this.mode !== "air") this.action = null;
        break;
      }
      case "land":
      case "getup":
      case "mantle":
        if (a.t >= a.dur) this.action = null;
        break;
      case "intro":
        if (a.t >= a.dur) {
          // up, and off the container toward him — a flip on the way
          const h2 = this.host.hulk;
          const to = h2 ? flat(h2.position.subtract(this.p)).normalize() : this.reclineFwd.clone();
          this.yaw = Math.atan2(to.x, to.z);
          this.jump(to.scale(6), 6.5);
          this.flip = { axis: "pitch", a: 0, rate: 8 };
          this.action = { kind: "flip", t: 0, dur: 9 };
          this.setAi("approach");
          this.introLeap = 1.2;
          this.say(pick(["Okay. Let's dance.", "Hulk smash? Spider-Man… also smash."]), 2.4);
        }
        break;
      case "mount": {
        if (h && h.alive && Vector3.Distance(this.center(), h.riderPoint()) < 1.4 * h.size && h.mount(this)) {
          this.mode = "ride";
          this.v.setAll(0);
          this.action = { kind: "ride", t: 0, dur: 99 };
          if (this.cd.quip <= 0 || Math.random() < 0.5) this.say(pick(["Yee-haw!", "Hold still — this'll only hurt a lot.", "Piggyback!"]), 2);
        } else if (a.t >= a.dur && this.mode !== "air") this.action = null;
        break;
      }
      case "ride":
        this.riding(dt, a);
        break;
      case "down":
        if (this.mode !== "ko" && a.t >= a.dur) this.action = { kind: "getup", t: 0, dur: 0.8 };
        break;
      case "victory":
        if (this.hulk || this.ai !== "victory") this.action = null;
        break;
    }
  }

  /** a blow on the Hulk (only if he's really there: in reach, in front of him) */
  private strike(h: Foe, damage: number, force: number, flying = false) {
    const chest = this.hulkChest(h);
    const to = chest.subtract(this.center());
    if (to.length() > (flying ? 2.4 : SPIDEY.reach + 0.4) * h.size) return;
    const fwd = V(Math.sin(this.yaw), 0, Math.cos(this.yaw));
    if (!flying && Vector3.Dot(flat(to).normalize(), fwd) < 0.3) return;
    const point = chest.subtract(to.normalizeToNew().scale(0.5));
    h.applyHit(damage, "torso", to.normalize(), point, { kind: "melee", force, source: this });
    this.host.audio.play("meleeHit", { x: point.x, y: point.y, z: point.z, volume: 0.9, rate: 0.9 });
    this.host.dust?.(point, 0.25);
  }

  /** after a combo: a quick flip or side-dash out of his reach */
  private hopAway(h: Foe) {
    const away = flat(this.p.subtract(h.position)).normalize();
    const side = V(away.z, 0, -away.x).scale(Math.random() < 0.5 ? 1 : -1);
    if (Math.random() < 0.55) {
      this.jump(away.scale(6.5).addInPlace(side.scale(2)), 5);
      this.flip = { axis: "pitch", a: 0, rate: -8 };
    } else {
      this.jump(side.scale(7).addInPlace(away.scale(2.5)), 3.8);
      this.flip = { axis: "roll", a: 0, rate: 9 * Math.sign(Vector3.Dot(side, V(Math.cos(this.yaw), 0, -Math.sin(this.yaw)))) };
    }
    this.action = { kind: "flip", t: 0, dur: 9 };
    this.flank = -this.flank * (Math.random() < 0.7 ? 1 : -1);
    this.setAi("reposition");
  }

  // ------------------------------------------------------------------ webs
  private fireWeb(h: Foe) {
    const hand = this.rig.at("RightHand");
    const target = this.hulkChest(h);
    // lead him a little
    const vel = target.subtract(hand).normalize().scale(42);
    const blob = this.webs.blob(hand);
    const line = this.webs.line(hand, hand, 0.018);
    this.webShot = { blob, line, at: hand.clone(), vel, t: 0 };
    this.host.audio.play("webShoot", { x: hand.x, y: hand.y, z: hand.z, volume: 0.85 });
  }
  private updateWebShot(dt: number) {
    const w = this.webShot;
    if (!w) return;
    w.t += dt;
    const prev = w.at.clone();
    w.at.addInPlace(w.vel.scale(dt));
    if (w.blob) w.blob.m.position.copyFrom(w.at);
    this.webs.move(w.line, this.rig.at("RightHand"), w.at);
    const h = this.host.hulk;
    const end = () => {
      this.webs.freeBlob(w.blob);
      this.webs.release(w.line, 0.2);
      this.webShot = null;
    };
    // hit him?
    if (h && h.alive) {
      const chest = this.hulkChest(h);
      if (Vector3.Distance(w.at, chest) < 1.1 * h.size) {
        this.host.audio.play("webHit", { x: w.at.x, y: w.at.y, z: w.at.z, volume: 0.9 });
        this.webs.splat(w.at, w.vel.scale(-1));
        h.applyHit(4, "torso", w.vel.normalizeToNew(), w.at, { kind: "melee", force: 0, source: this });
        if (h.web(1.5)) {
          this.pinHulk(h);
          if (this.cd.quip <= 0) this.say(pick(["Webs: one. Bad guys: zero.", "Hang in there, big guy!", "Now — while he's tied up!"]), 2.4);
        }
        return end();
      }
    }
    // or the wall in the way
    const hit = this.host.nav.moveHit(prev, w.at, 1);
    if (hit) {
      this.webs.splat(hit.point, hit.normal);
      this.host.audio.play("webHit", { x: hit.point.x, y: hit.point.y, z: hit.point.z, volume: 0.6 });
      return end();
    }
    if (w.t > 0.8) end();
  }
  /** strands from his arms and legs to the ground round him while the web holds */
  private pinHulk(h: Foe) {
    for (const id of this.pins) this.webs.release(id, 0.1);
    this.pins = [];
    const bones = ["hand_l", "hand_r", "calf_l", "calf_r", "spine_03"] as const;
    bones.forEach((b, i) => {
      const from = h.bonePos(b);
      const a = h.heading + (i / bones.length) * Math.PI * 2 + 0.4;
      const g = h.position.add(V(Math.sin(a) * 2.2, 0, Math.cos(a) * 2.2));
      g.y = this.host.nav.floorAt(g.x, h.position.y + 1, g.z, 3) ?? h.position.y;
      const id = this.webs.line(from, g, 0.03);
      if (id >= 0) this.pins.push(id);
    });
    this.pinEnds = bones.map((_, i) => {
      const a = h.heading + (i / bones.length) * Math.PI * 2 + 0.4;
      const g = h.position.add(V(Math.sin(a) * 2.2, 0, Math.cos(a) * 2.2));
      g.y = this.host.nav.floorAt(g.x, h.position.y + 1, g.z, 3) ?? h.position.y;
      return g;
    });
  }
  private pinEnds: Vector3[] = [];
  private updatePins() {
    if (!this.pins.length) return;
    const h = this.host.hulk;
    if (!h || h.webbedT <= 0 || !h.alive) {
      // he tears free
      for (const id of this.pins) this.webs.release(id, 0.25);
      this.pins = [];
      return;
    }
    const bones = ["hand_l", "hand_r", "calf_l", "calf_r", "spine_03"] as const;
    this.pins.forEach((id, i) => this.webs.move(id, h.bonePos(bones[i]), this.pinEnds[i]));
  }

  // ------------------------------------------------------------------ getting about
  private goTo(p: Vector3, pace: "walk" | "run" | "sprint") {
    if (!this.goal || Vector3.DistanceSquared(this.goal, p) > 1) this.repath = 0;
    this.goal = p.clone();
    this.pace = pace;
  }
  private faceTo(p: Vector3) {
    this.yaw = Math.atan2(p.x - this.p.x, p.z - this.p.z);
  }
  private turnTo(yaw: number, dt: number, rate: number) {
    const d = angDiff(yaw, this.yaw);
    this.yaw += Math.sign(d) * Math.min(Math.abs(d), rate * dt);
  }
  private jump(horiz: Vector3, up: number) {
    this.dropRope();
    this.v.set(horiz.x, up, horiz.z);
    if (this.mode === "wall") this.p.addInPlace(this.wall.n.scale(0.3));
    this.mode = "air";
    this.p.y += 0.05;
  }

  /** a web to swing on toward `dir`, if there's one in reach. Takes off if he's on the ground. */
  private trySwing(dir: Vector3) {
    if (this.cd.swing > 0) return false;
    this.cd.swing = 0.6;
    const k = this.pickAnchor(dir);
    if (!k) return false;
    if (this.mode === "ground") {
      // a jump to get going
      this.v.set(dir.x * 6, 6, dir.z * 6);
      this.p.y += 0.05;
    }
    this.mode = "swing";
    this.rope.A.copyFrom(k.a);
    this.rope.L = Vector3.Distance(this.center(), k.a);
    this.rope.Lgoal = k.L;
    this.rope.t = 0;
    const hand = this.rig.at("RightHand");
    this.rope.id = this.webs.line(hand, k.a, 0.032, -1, 0.5);
    this.webs.splat(k.a, this.center().subtract(k.a), 5, 0.3, 2.5);
    this.yaw = Math.atan2(dir.x, dir.z);
    this.host.audio.play("webShoot", { x: hand.x, y: hand.y, z: hand.z, volume: 0.8 });
    this.host.audio.play("webZip", { x: hand.x, y: hand.y, z: hand.z, volume: 0.55 });
    this.setAi("swing");
    return true;
  }
  private dropRope() {
    if (this.rope.id >= 0) this.webs.release(this.rope.id, 0.18);
    this.rope.id = -1;
    if (this.mode === "swing") this.mode = "air";
  }

  /** somewhere high near `around` to climb up to and crouch on (a wall face to climb, its top) */
  private pickPerch(around: Vector3, radius: number, avoid?: Vector3) {
    const nav = this.host.nav;
    let best: { face: Vector3; n: Vector3; s: number } | null = null;
    for (let i = 0; i < nav.boxCount; i++) {
      const [x0, y0, z0, x1, y1, z1] = nav.boxBoundsOf(i);
      const h = y1 - y0;
      if (h < 2.3 || y1 > 9 || y0 > this.p.y + 0.6 || Math.min(x1 - x0, z1 - z0) < 1.2) continue;
      const cx = (x0 + x1) / 2, cz = (z0 + z1) / 2;
      const d = Math.hypot(cx - around.x, cz - around.z);
      if (d > radius) continue;
      // the face nearest him
      const faces: [Vector3, Vector3][] = [
        [V(x0 - 0.3, y0, cz), V(-1, 0, 0)], [V(x1 + 0.3, y0, cz), V(1, 0, 0)],
        [V(cx, y0, z0 - 0.3), V(0, 0, -1)], [V(cx, y0, z1 + 0.3), V(0, 0, 1)],
      ];
      for (const [f, n] of faces) {
        // (turned boxes' bounds aren't their faces: the wall must really be there)
        if (nav.moveRay(f.add(V(0, 1.2, 0)), f.add(V(0, 1.2, 0)).subtract(n.scale(0.8))) < 0) continue;
        const fy = nav.floorAt(f.x, this.p.y + 0.5, f.z, 2);
        if (fy === null || Math.abs(fy - this.p.y) > 1) continue;
        // (an outside wall: open sky above the foot of it — not a wall inside a building)
        if (!nav.clear(V(f.x, fy + 1.2, f.z), V(f.x, fy + 30, f.z))) continue;
        let s = -Vector3.Distance(f, this.p) * 0.5 + h * 0.6;
        if (avoid) s += Math.min(8, Vector3.Distance(f, avoid)) * 0.8;
        if (!best || s > best.s) best = { face: f, n, s };
      }
    }
    if (!best) return false;
    this.climbTo = { at: best.face, n: best.n };
    this.goTo(best.face, "sprint");
    this.perchT = rnd(3, 6);
    return true;
  }
  private climbTo: { at: Vector3; n: Vector3 } | null = null;
  private perchT = 0;
  private exploreStep() {
    const c = this.climbTo;
    if (this.mode === "ground" && c && this.p.y < c.at.y + 1) {
      // run to the wall, then onto it
      if (Vector3.Distance(flat(this.p), flat(c.at)) < 1.2) this.startWall(c.n, c.at);
      else this.goTo(c.at, "sprint");
      return;
    }
    if (this.mode === "ground" && this.p.y > 1.5) {
      // up top: crouch and look out, then back down to you
      this.goal = null;
      this.perchT -= 0.2;
      if (this.perchT <= 0) {
        this.climbTo = null;
        this.setAi("follow");
      }
    }
  }

  // ------------------------------------------------------------------ walls
  private startWall(n: Vector3, at: Vector3) {
    const nav = this.host.nav;
    const hit = nav.moveHit(at.add(V(0, 1.2, 0)).add(n.scale(0.4)), at.add(V(0, 1.2, 0)).subtract(n.scale(1.2)));
    if (!hit || Math.abs(hit.normal.y) > 0.3) return false;
    const top = nav.boxBoundsOf(hit.box)[4];
    this.dropRope();
    this.mode = "wall";
    this.wall = { n: flat(hit.normal).normalize(), box: hit.box, top, phase: 0, sideDir: 0 };
    this.p.set(hit.point.x, Math.max(this.p.y, hit.point.y - 1.0), hit.point.z).addInPlace(this.wall.n.scale(0.05));
    this.v.setAll(0);
    this.setAi("climb");
    this.host.audio.play("webHit", { x: this.p.x, y: this.p.y, z: this.p.z, volume: 0.35, rate: 1.4 });
    return true;
  }
  private leaveWall(dir: Vector3) {
    const n = this.wall.n;
    const out = n.scale(4.5).addInPlace(dir.scale(3));
    this.yaw = Math.atan2(out.x, out.z);
    this.mode = "air";
    this.p.addInPlace(n.scale(0.4));
    this.v.set(out.x, 4.5, out.z);
    this.flip = { axis: "pitch", a: 0, rate: -7.5 };
    this.action = { kind: "flip", t: 0, dur: 9 };
  }

  // ------------------------------------------------------------------ physics
  private move(dt: number) {
    switch (this.mode) {
      case "ground":
        return this.moveGround(dt);
      case "air":
        return this.moveAir(dt);
      case "swing":
        return this.moveSwing(dt);
      case "wall":
        return this.moveWall(dt);
      case "ride": {
        const h = this.host.hulk;
        if (!h || h.rider !== this) {
          this.mode = "air";
          return;
        }
        // held on high on his back, between the shoulders
        const rp = h.riderPoint();
        this.yaw = h.heading;
        this.p.copyFrom(rp).addInPlaceFromFloats(0, -0.4 * this.rig.hipH, 0);
        this.v.setAll(0);
        return;
      }
      case "ko":
        return this.moveAir(dt, true);
    }
  }

  private moveGround(dt: number) {
    const nav = this.host.nav;
    if (this.mantle.t >= 0) {
      this.mantle.t += dt / 0.35;
      Vector3.LerpToRef(this.mantle.from, this.mantle.to, Math.min(1, this.mantle.t), this.p);
      this.p.y += Math.sin(Math.min(1, this.mantle.t) * Math.PI) * 0.3;
      if (this.mantle.t >= 1) this.mantle.t = -1;
      return;
    }
    // standing on nothing: fall
    const fy = nav.floorAt(this.p.x, this.p.y + 0.3, this.p.z, 0.6);
    if (fy === null) {
      this.mode = "air";
      this.v.y = 0;
      return;
    }
    this.p.y += (fy - this.p.y) * Math.min(1, dt * 15);
    const a = this.action;
    if (a && (a.kind === "melee" || a.kind === "web" || a.kind === "land" || a.kind === "getup" || a.kind === "kick-soldier" || a.kind === "down" || a.kind === "victory" || a.kind === "intro")) {
      this.v.setAll(0);
      return;
    }
    let speed = 0;
    if (this.goal) {
      const target = this.steer(dt);
      if (target) {
        const step = flat(target.subtract(this.p));
        const L = step.length();
        const s = this.pace === "sprint" ? SPIDEY.sprint : this.pace === "run" ? SPIDEY.run : 1.7;
        if (L > 0.15) {
          this.turnTo(Math.atan2(step.x, step.z), dt, 11);
          // (personal space: never into you, never into the Hulk)
          const dir = V(Math.sin(this.yaw), 0, Math.cos(this.yaw));
          this.avoid(dir);
          const m = Math.min(L, s * dt);
          if (this.stepTo(this.p.x + dir.x * m, this.p.z + dir.z * m)) speed = m / dt;
          else this.blocked(dir);
        } else if (this.goal && Vector3.Distance(flat(this.p), flat(this.goal)) < 0.4) this.goal = null;
      }
    }
    this.v.set(Math.sin(this.yaw) * speed, 0, Math.cos(this.yaw) * speed);
    // stuck in place while trying to go somewhere: hop
    if (this.goal && speed < 0.3) {
      this.stillT += dt;
      if (this.stillT > 0.8) {
        this.stillT = 0;
        const dir = flat(this.goal.subtract(this.p)).normalize();
        this.jump(dir.scale(4.5), 8.5);
        this.flip = { axis: "pitch", a: 0, rate: 0 };
      }
    } else this.stillT = 0;
    // footfalls (light)
    if (speed > 1) {
      this.stepT -= dt * (speed / 4.2);
      if (this.stepT <= 0) {
        this.stepT = 0.36;
        this.host.audio.play("footstep", { x: this.p.x, y: this.p.y, z: this.p.z, volume: 0.25, rate: 1.15 });
      }
    }
  }
  /** a step on the ground: no wall at the knee, a floor under it that's a step at most */
  private stepTo(x: number, z: number) {
    const nav = this.host.nav;
    const fy = nav.floorAt(x, this.p.y + 0.5, z, 1.2);
    if (fy === null) {
      // a drop: off the edge he goes (the fall takes care of it)
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
  /** something in the way: over it if it's low, up it if it's a wall worth climbing, round it if not */
  private blocked(dir: Vector3) {
    const nav = this.host.nav;
    const c = this.p.add(V(0, 0.6, 0));
    const hit = nav.moveHit(c, c.add(dir.scale(1.2)));
    if (!hit) return;
    const top = nav.boxBoundsOf(hit.box)[4];
    const h = top - this.p.y;
    if (h < 3.2) {
      // vault it
      this.jump(dir.scale(4.2), Math.sqrt(2 * G * (h + 0.8)));
      this.flip = { axis: "pitch", a: 0, rate: h > 1.5 ? 7 : 0 };
      return;
    }
    if (Math.abs(hit.normal.y) < 0.3 && (this.ai === "explore" || this.ai === "reposition" || this.ai === "search" || Math.random() < 0.3)) {
      this.startWall(flat(hit.normal).normalize(), hit.point);
      return;
    }
    this.repath = 0;
    this.path = [];
  }
  /** keep clear of the player and the Hulk (a nudge to the side) */
  private avoid(dir: Vector3) {
    const keep = (q: Vector3, r: number) => {
      const to = flat(q.subtract(this.p));
      const d = to.length();
      if (d > r || d < 1e-3) return;
      if (Vector3.Dot(to.scale(1 / d), dir) < 0.2) return;
      const side = V(to.z, 0, -to.x).normalize();
      if (Vector3.Dot(side, dir) < 0) side.scaleInPlace(-1);
      dir.addInPlace(side.scale(1.2 * (1 - d / r))).normalize();
    };
    keep(this.host.player.feet, 2.2);
    const h = this.host.hulk;
    if (h?.alive) keep(h.position, 1.6 * h.size);
  }

  /** the next point toward the goal: straight when the way is clear, else along the nav graph */
  private steer(dt: number) {
    const nav = this.host.nav;
    const goal = this.goal!;
    const knee = V(0, 0.5, 0), chest = V(0, 1.2, 0);
    const direct = Math.abs(goal.y - this.p.y) < 1.5 && nav.moveRay(this.p.add(knee), goal.add(knee)) < 0 && nav.moveRay(this.p.add(chest), goal.add(chest)) < 0;
    if (direct) {
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

  private moveAir(dt: number, ko = false) {
    const nav = this.host.nav;
    const prevC = this.center();
    this.v.y -= G * dt;
    // a little steering in the air toward where he's going
    if (this.goal && !ko && this.action?.kind !== "dive" && this.action?.kind !== "tumble") {
      const to = flat(this.goal.subtract(this.p));
      if (to.lengthSquared() > 1) this.v.addInPlace(to.normalize().scale(4 * dt));
    }
    this.p.addInPlace(this.v.scale(dt));
    // walls and anything in the way
    const c = this.center();
    const hit = nav.moveHit(prevC, c);
    if (hit && hit.normal.y < 0.5) {
      const n = hit.normal;
      if (Math.abs(n.y) < 0.3 && !ko && this.action?.kind !== "tumble" && this.wantsWall()) {
        this.p.set(hit.point.x, hit.point.y - 1.0, hit.point.z);
        if (this.startWall(flat(n).normalize(), this.p.clone())) return;
      }
      // bounce off / slide along it (his middle kept just off the surface)
      const vn = Vector3.Dot(this.v, n);
      if (vn < 0) this.v.subtractInPlace(n.scale(vn * 1.15));
      this.p.copyFrom(hit.point.add(n.scale(0.12))).subtractInPlace(V(0, 1.0, 0));
    }
    // the floor (or a rooftop) under him
    if (this.v.y <= 0) {
      const fy = nav.floorAt(this.p.x, this.p.y + 0.6 - this.v.y * dt, this.p.z, 0.8 - this.v.y * dt);
      if (fy !== null && this.p.y <= fy + 0.02) {
        const impact = -this.v.y;
        this.p.y = fy;
        this.v.setAll(0);
        this.land(impact, ko);
      }
    }
    // the flip/spin, if any
    if (this.flip.rate !== 0) this.flip.a += this.flip.rate * dt;
    // out of the world: put him back by the player
    if (this.p.y < -20) this.spawn(this.host.player.feet.add(V(1.5, 0, 0)), this.yaw);
  }
  private wantsWall() {
    return this.ai === "explore" || this.ai === "reposition" || this.ai === "climb" || this.ai === "search" || (this.ai === "swing" && Math.random() < 0.5);
  }
  private land(impact: number, ko: boolean) {
    this.flip = { axis: "pitch", a: 0, rate: 0 };
    const p = this.p;
    if (ko) return;
    this.mode = "ground";
    const a = this.action;
    if (a?.kind === "tumble") {
      // thrown: down a moment if knocked flat, then up
      const down = this.downFor;
      this.downFor = 0;
      this.action = down > 0.2 ? { kind: "down", t: 0, dur: down } : { kind: "getup", t: 0, dur: 0.55 };
      this.host.audio.play("bodyFall", { x: p.x, y: p.y, z: p.z, volume: 0.6 });
      this.ai = this.hulk ? "approach" : "follow";
      return;
    }
    if (a && (a.kind === "flip" || a.kind === "dive")) this.action = null;
    if (impact > 9) {
      // the three-point landing
      this.action = { kind: "land", t: 0, dur: Math.min(0.6, 0.25 + impact * 0.02), w: 1 };
      this.host.audio.play("land", { x: p.x, y: p.y, z: p.z, volume: 0.6, rate: 0.8 });
      this.host.dust?.(p.clone(), Math.min(0.6, impact / 30));
    } else {
      this.host.audio.play("footstep", { x: p.x, y: p.y, z: p.z, volume: 0.4 });
      if (impact > 4 && !this.action) this.action = { kind: "land", t: 0, dur: 0.28, w: Math.min(0.55, (impact - 4) / 9) };
    }
  }

  private moveSwing(dt: number) {
    const nav = this.host.nav;
    const r = this.rope;
    r.t += dt;
    const c0 = this.center();
    const off = V(0, 1.0, 0);
    // gravity, and a pump along the swing (he drives it with his legs) toward where he's going
    this.v.y -= G * dt;
    const rd = c0.subtract(r.A).normalize();
    const tang = this.v.subtract(rd.scale(Vector3.Dot(this.v, rd)));
    if (tang.lengthSquared() > 0.01 && rd.y < 0) this.v.addInPlace(tang.normalize().scale(3.2 * dt));
    if (this.goal) {
      const to = flat(this.goal.subtract(this.p));
      if (to.lengthSquared() > 1) this.v.addInPlace(to.normalize().scale(3 * dt));
    }
    // reel the line in to its length (the arc's bottom clears the ground)
    r.L += Math.max(-10 * dt, Math.min(10 * dt, r.Lgoal - r.L));
    let c = c0.add(this.v.scale(dt));
    // the rope: never longer than L — pulled back onto the sphere, the outward speed taken away
    const d = c.subtract(r.A);
    const L = d.length();
    if (L > r.L) {
      const n = d.scale(1 / L);
      c = r.A.add(n.scale(r.L));
      const out = Vector3.Dot(this.v, n);
      if (out > 0) this.v.subtractInPlace(n.scale(out));
    }
    // (no wild speeds)
    const sp = this.v.length();
    if (sp > 24) this.v.scaleInPlace(24 / sp);
    // something in the way: let go
    const hit = nav.moveHit(c0, c);
    this.p.copyFrom(c.subtract(off));
    if (hit) {
      this.p.copyFrom(hit.point.add(hit.normal.scale(0.15)).subtract(off));
      const vn = Vector3.Dot(this.v, hit.normal);
      if (vn < 0) this.v.subtractInPlace(hit.normal.scale(vn));
      return this.release(false);
    }
    // the floor coming up: let go
    const fy = nav.floorAt(this.p.x, this.p.y + 0.5, this.p.z, 0.6);
    if (fy !== null && this.p.y < fy + 0.3) return this.release(false);
    this.webs.move(r.id, this.rig.at("RightHand"), r.A);
    // slack while it's reeling in, taut once his weight's on it
    this.webs.setSag(r.id, Math.max(0, Math.min(0.5, (r.L - Vector3.Distance(c, r.A)) * 0.6)));
    if (this.v.y < 0 && Math.abs(c.y - (r.A.y - r.L)) < 0.5) {
      // the bottom of the arc: the air rushes past
      if (r.t > 0.3 && !this.whooshed) {
        this.whooshed = true;
        this.host.audio.play("swingWhoosh", { x: this.p.x, y: this.p.y + 1, z: this.p.z, volume: 0.6 });
      }
    }
    if (flat(this.v).lengthSquared() > 1) this.yaw = Math.atan2(this.v.x, this.v.z);
    // let go at the top of the swing, going up and forward — or when it's gone on too long
    const ahead = this.goal ? Vector3.Dot(flat(c.subtract(r.A)), flat(this.goal.subtract(r.A)).normalize()) : 1;
    if ((r.t > 0.6 && this.v.y > 0 && ahead > 0.5 && rd.y > -0.75) || r.t > 3) this.release(true);
  }
  private whooshed = false;
  /** off the web: on into the air (a little boost at the top of a good swing), maybe straight onto another */
  private release(boost: boolean) {
    if (boost) {
      this.v.y += 3.5;
      this.v.scaleInPlace(1.06);
      this.flip = { axis: "pitch", a: 0, rate: Math.random() < 0.35 ? 8 : 0 };
      this.action = this.flip.rate ? { kind: "flip", t: 0, dur: 9 } : this.action;
    }
    this.whooshed = false;
    this.dropRope();
    this.mode = "air";
    this.cd.swing = boost ? 0.35 : 0.8;
    // still a long way to go: the next web
    if (boost && this.goal && Vector3.Distance(flat(this.p), flat(this.goal)) > 14) this.trySwingChain();
  }
  private trySwingChain() {
    this.cd.swing = 0;
    const g = this.goal;
    if (!g) return;
    const dir = flat(g.subtract(this.p)).normalize();
    const k = this.pickAnchor(dir);
    if (!k) return;
    this.mode = "swing";
    this.rope.A.copyFrom(k.a);
    this.rope.L = Vector3.Distance(this.center(), k.a);
    this.rope.Lgoal = k.L;
    this.rope.t = 0;
    const hand = this.rig.at("RightHand");
    this.rope.id = this.webs.line(hand, k.a, 0.032, -1, 0.5);
    this.webs.splat(k.a, this.center().subtract(k.a), 5, 0.3, 2.5);
    this.host.audio.play("webShoot", { x: hand.x, y: hand.y, z: hand.z, volume: 0.8 });
  }

  private moveWall(dt: number) {
    const nav = this.host.nav;
    const w = this.wall;
    const n = w.n;
    // up the wall, drifting sideways toward where he wants to be
    let up = 3.6;
    const tang = V(-n.z, 0, n.x);
    let side = 0;
    const h = this.hulk;
    if (this.ai === "climb" || this.ai === "explore" || this.ai === "reposition") up = 3.6;
    else up = 0;
    if (this.goal) {
      const to = flat(this.goal.subtract(this.p));
      side = Math.max(-1.5, Math.min(1.5, Vector3.Dot(to, tang)));
    }
    // something jutting out above him (a sign, a ledge): crawl sideways round it, or let go
    if (up > 0) {
      const head = this.p.add(n.scale(0.35)).addInPlace(V(0, 1.4, 0));
      if (nav.moveRay(head, head.add(V(0, 0.7, 0))) >= 0) {
        up = 0;
        const s = this.wall.sideDir || (this.wall.sideDir = Math.random() < 0.5 ? 1 : -1);
        const ahead = head.add(tang.scale(s * 0.8));
        if (nav.moveRay(head, ahead) >= 0) this.wall.sideDir = -s;
        side = 2.2 * this.wall.sideDir;
        if (this.aiT > 6) {
          this.mode = "air";
          this.v.copyFrom(n.scale(2));
          return;
        }
      }
    }
    this.p.y += up * dt;
    this.p.addInPlace(tang.scale(side * dt));
    this.crawlPhase += (Math.abs(up) + Math.abs(side)) * dt * 2.2;
    // still on the wall? (feel for it just in front)
    const c = this.p.add(n.scale(0.5)).addInPlace(V(0, 0.6, 0));
    const hit = nav.moveHit(c, c.subtract(n.scale(1.2)));
    if (!hit || Math.abs(hit.normal.y) > 0.3) {
      // past the corner or the top edge
      if (this.p.y + 0.5 >= w.top) return this.overTop();
      this.mode = "air";
      this.v.copyFrom(n.scale(1.5));
      return;
    }
    // reached the top: over the edge onto the roof
    if (this.p.y + 1.1 >= w.top) return this.overTop();
    // a frightened moment on a wall facing the Hulk's clap? he's out of reach up here; but if he's
    // been here too long while the Hulk's about, he drops back into the fight (the AI decides)
    void h;
  }
  private overTop() {
    const w = this.wall;
    const to = this.p.subtract(w.n.scale(0.8));
    const fy = this.host.nav.floorAt(to.x, w.top + 0.5, to.z, 1.5);
    if (fy === null) {
      this.mode = "air";
      this.v.copyFrom(w.n.scale(-2)).addInPlace(V(0, 3, 0));
      return;
    }
    to.y = fy;
    this.mode = "ground";
    this.mantle = { from: this.p.clone(), to, t: 0 };
    this.yaw = Math.atan2(-w.n.x, -w.n.z);
    this.action = { kind: "mantle", t: 0, dur: 0.4 };
    this.host.audio.play("footstep", { x: to.x, y: to.y, z: to.z, volume: 0.35 });
  }

  // ------------------------------------------------------------------ recovering
  private recovering(dt: number) {
    this.koT -= dt;
    if (this.koT <= 0 && this.mode === "ko") {
      this.mode = "ground";
      this.health = this.maxHealth * 0.55;
      this.action = { kind: "getup", t: 0, dur: 1.0 };
      this.setAi(this.hulk ? "approach" : "follow");
    }
  }

  // ------------------------------------------------------------------ the body
  private animate(dt: number) {
    const want = this.want;
    this.airT = this.mode === "air" ? this.airT + dt : 0;
    const a = this.action;
    let rate = 14;
    const speed = flat(this.v).length();
    let hipScale = 1;
    if (a?.clip && (a.kind === "melee" || a.kind === "kick-soldier")) {
      sample(this.clips[a.clip], a.t * (a.speed ?? 1), false, want);
      rate = 26;
    } else if (a?.kind === "web") {
      copyPose(STANCE, want);
      const h = this.host.hulk;
      if (h) aimArm(want, "r", this.toBody(this.hulkChest(h).subtract(this.rig.at("RightArm"))));
      rate = 24;
    } else if (a?.kind === "dive") {
      mixPose(TUCK, DIVE_KICK, Math.min(1, a.t / Math.max(0.2, a.dur - 0.5)), want);
      rate = 18;
    } else if (a?.kind === "flip" || a?.kind === "tumble") {
      copyPose(this.mode === "air" ? TUCK : STANCE, want);
      if (a.kind === "tumble" && this.mode === "air") mixPose(HIT, TUCK, Math.min(1, a.t * 2), want);
      rate = 20;
    } else if (a?.kind === "intro") {
      // standing on the edge, weight low, looking down at the Hulk — and a crouch to spring as he goes
      copyPose(STANCE, want);
      want.d[4] = [0, 0.92, 0.38];
      want.d[5] = [0, 0.82, 0.57];
      if (a.t > a.dur - 0.45) mixPose(want, PERCH, Math.min(1, (a.t - (a.dur - 0.45)) / 0.3), want);
      rate = 10;
    } else if (a?.kind === "ride" || this.mode === "ride") {
      // the fist drawn back, then driven down: in time with the blows (every 0.45 s)
      const ph = ((a?.t ?? 0) % 0.45) / 0.45;
      mixPose(RIDE_A, RIDE_B, ph < 0.55 ? ph / 0.55 : Math.max(0, 1 - (ph - 0.55) / 0.2), want);
      rate = 30;
    } else if (a?.kind === "mount") {
      copyPose(TUCK, want);
      rate = 16;
    } else if (a?.kind === "land") {
      // a hard landing goes all the way down to the three-point; a light one just gives at the knees
      const w = a.w ?? 1;
      mixPose(STANCE, LANDING, w, this.tmpPose);
      mixPose(this.tmpPose, this.hulk ? STANCE : RELAXED, Math.max(0, (a.t - a.dur * 0.5) / (a.dur * 0.5)), want);
      rate = 24;
    } else if (a?.kind === "down" || this.mode === "ko") {
      const c = this.clips.deathB;
      sample(c, clipDur(c), false, want);
      rate = 8;
    } else if (a?.kind === "getup") {
      mixPose(LANDING, STANCE, Math.min(1, a.t / a.dur), want);
      rate = 10;
    } else if (a?.kind === "victory" && this.dance && this.own[this.dance]) {
      // the fight's won: a little dance of his own (the rig's clips)
      sample(this.own[this.dance], a.t, true, want);
      rate = 16;
    } else if (a?.kind === "mantle" || a?.kind === "victory") {
      copyPose(PERCH, want);
      rate = 12;
    } else if (this.mode === "swing") {
      // his own swing: the pull into the arc, then the ride out of it — the web hand on the line
      const ss = this.own.swingStart, se = this.own.swingEnd;
      if (ss && se) {
        const out = this.v.y > 0 && this.rope.t > 0.5;
        sample(out ? se : ss, out ? Math.min(clipDur(se) * 0.6, this.rope.t - 0.5) : this.rope.t * 1.2, false, want);
        mixPose(want, SWING, 0.35, want);
      } else copyPose(SWING, want);
      aimArm(want, "r", this.toBody(this.rope.A.subtract(this.rig.at("RightArm"))));
      rate = 12;
    } else if (this.mode === "air") {
      // his own jump: tucking up on the way up, reaching for the ground on the way down
      const up = this.own.jumpUp, down = this.own.jumpDown;
      if (up && down) {
        if (this.v.y > 0) sample(up, clipDur(up) * Math.min(0.7, 0.25 + this.airT * 0.9), false, want);
        else sample(down, clipDur(down) * Math.min(0.55, 0.15 + Math.max(0, -this.v.y) * 0.03), false, want);
        mixPose(want, AIR, 0.25, want);
      } else copyPose(AIR, want);
      rate = 9;
    } else if (this.mode === "wall") {
      // climbing: hand over hand (the reach swaps sides); holding still: clinging
      mixPose(CRAWL_A, CRAWL_B, 0.5 + 0.5 * Math.sin(this.crawlPhase), want);
      this.wallStill = this.crawlPhase === this.lastCrawl ? Math.min(1, this.wallStill + dt * 2.5) : Math.max(0, this.wallStill - dt * 5);
      this.lastCrawl = this.crawlPhase;
      if (this.wallStill > 0) mixPose(want, CLING, this.wallStill, want);
      rate = 12;
    } else {
      // on his feet: running, or the stance (a crouch when he's up high and still)
      const fighting = !!this.hulk;
      const ownRun = this.own.run;
      if (speed > 3 && ownRun) {
        // his own run (the rig's clip: arms down and pumping, a real stride). Measured off the clip:
        // a planted foot goes back at 5.3 m/s at the clip's own rate, 3.36 m a cycle — so a cycle
        // per 3.36 m of ground keeps his feet from sliding. (Its own phase, in cycles.)
        this.ownRunPhase += dt * (speed / 3.36);
        sample(ownRun, this.ownRunPhase * clipDur(ownRun), true, want);
        if (speed > 7) want.d[2] = [want.d[2][0], want.d[2][1], want.d[2][2] + 0.12];
        rate = 40;
        this.gait = "run";
      } else if (speed > 0.6) {
        // a walk below 3 m/s, a run, a sprint — each with natural arms (down, swinging)
        const gait = speed < 3 ? "walk" : speed > 7 ? "sprint" : "run";
        const c = this.clips[gait];
        // (the clip's own ground speed, scaled to his legs: the feet keep pace with the ground)
        const cs = (gait === "walk" ? 1.25 : (c.speed ?? 4)) * (this.rig.hipH / 0.9);
        if (gait !== this.gait) {
          // keep the step's phase across a change of gait
          const from = this.clips[this.gait];
          this.runPhase = ((this.runPhase % clipDur(from)) / clipDur(from)) * clipDur(c);
          this.gait = gait;
        }
        this.runPhase += dt * (speed / cs);
        sample(c, this.runPhase, true, want);
        naturalArms(want, gait === "walk" ? Math.max(0, (speed - 1.2) / 3) : gait === "run" ? 0.6 : 1, gait === "sprint" ? 0.22 : gait === "run" ? 0.1 : 0.02);
        // (a stride is quick: follow it closely, or the smoothing eats the step)
        rate = 40;
        hipScale = 1;
      } else if (this.p.y > 1.5 || this.ai === "explore") copyPose(PERCH, want);
      else {
        if (!fighting && this.own.stand) sample(this.own.stand, performance.now() / 1000, true, want);
        else {
          copyPose(fighting ? STANCE : RELAXED, want);
          // breathing
          const b = Math.sin(performance.now() / 700) * 0.02;
          want.d[2] = [want.d[2][0], want.d[2][1], want.d[2][2] + b];
        }
      }
    }
    follow(this.shown, want, rate, dt);
    // (one bad direction would stay in the blend for good: start the pose over if one gets in)
    if (!this.shown.d.every((d) => isFinite(d[0] + d[1] + d[2])) || !isFinite(this.shown.hip[0] + this.shown.hip[1] + this.shown.hip[2])) copyPose(STANCE, this.shown);
    // orientation: upright on his heading — on a wall, belly to it — tilted on the rope — turned by a flip
    const up = V(0, 1, 0), fwd = V(Math.sin(this.yaw), 0, Math.cos(this.yaw));
    if (this.mode === "ride") {
      const h = this.host.hulk;
      if (h) fwd.set(Math.sin(h.heading), 0, Math.cos(h.heading));
    } else if (this.mode === "wall") {
      up.copyFrom(this.wall.n);
      fwd.set(0, 1, 0);
    } else if (this.mode === "swing") {
      const toA = this.rope.A.subtract(this.center()).normalize();
      up.copyFrom(Vector3.Lerp(up, toA, 0.6).normalize());
      fwd.subtractInPlace(up.scale(Vector3.Dot(fwd, up))).normalize();
    } else if (a?.kind === "dive") {
      const dir = this.v.normalizeToNew();
      // feet first: lie back along the flight
      up.copyFrom(Vector3.Lerp(up, dir.scale(-1), 0.5).normalize());
      fwd.subtractInPlace(up.scale(Vector3.Dot(fwd, up))).normalize();
    }
    // (heading straight along his own up — a vertical dive: any perpendicular will do)
    if (fwd.lengthSquared() < 1e-4) fwd.copyFrom(Math.abs(up.x) < 0.9 ? Vector3.Cross(up, V(1, 0, 0)) : Vector3.Cross(up, V(0, 0, 1))).normalize();
    lookRotation(fwd, up, this.q);
    if (!isFinite(this.q.x + this.q.y + this.q.z + this.q.w)) this.q.set(0, Math.sin(this.yaw / 2), 0, Math.cos(this.yaw / 2));
    // the body answers the motion: leaning into a sprint and a burst of speed, banking into turns
    if (this.mode === "ground" && !a) {
      const yawRate = angDiff(this.yaw, this.lastYaw) / Math.max(1e-3, dt);
      const accel = (speed - this.lastSpeed) / Math.max(1e-3, dt);
      const bank = Math.max(-0.3, Math.min(0.3, -yawRate * speed * 0.035));
      const lean = Math.max(-0.12, Math.min(0.28, speed * 0.018 + accel * 0.012));
      const k = 1 - Math.exp(-10 * dt);
      this.bank += (bank - this.bank) * k;
      this.lean += (lean - this.lean) * k;
    } else {
      this.bank *= 0.9;
      this.lean *= 0.9;
    }
    this.lastYaw = this.yaw;
    this.lastSpeed = speed;
    if (Math.abs(this.bank) + Math.abs(this.lean) > 1e-3) this.q.multiplyInPlace(Quaternion.RotationYawPitchRoll(0, this.lean, this.bank));
    if (this.flip.a !== 0 && (this.mode === "air" || this.mode === "ko")) {
      const axis = this.flip.axis === "pitch" ? V(1, 0, 0) : V(0, 0, 1);
      this.q.multiplyInPlace(Quaternion.RotationAxis(axis, this.flip.a));
    }
    const anc = this.rig.anchor;
    anc.rotationQuaternion!.copyFrom(this.q);
    // a flip turns about his middle, not his feet
    if (this.flip.a !== 0 && this.mode === "air") {
      const mid = V(0, this.rig.hipH, 0);
      const rotated = mid.applyRotationQuaternion(this.q);
      anc.position.copyFrom(this.p).addInPlace(V(0, this.rig.hipH, 0)).subtractInPlace(rotated);
    } else anc.position.copyFrom(this.p);

    const hip = this.shown.hip;
    this.rig.pose(this.shown.d, V(hip[0] * this.rig.hipH, hip[1] * this.rig.hipH * hipScale, hip[2] * this.rig.hipH));
    this.lastPos.copyFrom(this.p);
    // his hands: fists to hit, a web hand on the line, loose otherwise
    const fist = a?.kind === "melee" || a?.kind === "kick-soldier" || a?.kind === "ride" ? 0.95 : this.mode === "swing" || a?.kind === "web" ? 0.7 : this.mode === "wall" ? 0.45 : 0.3;
    this.grip += (fist - this.grip) * Math.min(1, dt * 12);
    this.rig.grip?.("l", this.grip);
    this.rig.grip?.("r", this.grip);
  }
  private tmpPose = newPose();
  private dance: string | undefined;
  private ownRunPhase = 0;
  private grip = 0.3;
  private airT = 0;
  private gait: "walk" | "run" | "sprint" = "run";
  private wallStill = 0;
  private lastCrawl = 0;
  private bank = 0;
  private lean = 0;
  private lastYaw = 0;
  private lastSpeed = 0;
  /** a world direction in his body frame */
  private toBody(w: Vector3): Dir {
    const q = this.q;
    const inv = Quaternion.Inverse(q);
    const b = w.normalizeToNew().applyRotationQuaternion(inv);
    return [b.x, b.y, b.z];
  }

  /**
   * Somewhere to be found lounging: the top of a container (or a stack) you can see from where you
   * stand, 8–24 m off, well clear of the Hulk. Null if there's nowhere (he'll come in on foot).
   */
  entrySpot(player: Vector3, eye: Vector3, hulk: Vector3 | null) {
    const nav = this.host.nav;
    let best: Vector3 | null = null, bestS = -Infinity;
    for (let i = 0; i < nav.boxCount; i++) {
      const [x0, y0, z0, x1, y1, z1] = nav.boxBoundsOf(i);
      if (y1 < 2.3 || y1 > 5.6 || y1 - y0 < 2 || Math.min(x1 - x0, z1 - z0) < 2 || Math.max(x1 - x0, z1 - z0) > 7) continue;
      const c = V((x0 + x1) / 2, y1, (z0 + z1) / 2);
      // really the top of a box (not the bounds of a turned one), and nothing on top of it
      if (!nav.embedded(c.x, y1 - 0.1, c.z) || nav.embedded(c.x, y1 + 0.6, c.z)) continue;
      const fy = nav.floorAt(c.x, y1 + 0.5, c.z, 1);
      if (fy === null || Math.abs(fy - y1) > 0.2) continue;
      const d = Math.hypot(c.x - player.x, c.z - player.z);
      if (d < 8 || d > 24) continue;
      if (hulk && Math.hypot(c.x - hulk.x, c.z - hulk.z) < 8) continue;
      if (!nav.clear(eye, c.add(V(0, 0.5, 0)))) continue;
      const sc = -Math.abs(d - 13) + (hulk ? Math.min(20, Math.hypot(c.x - hulk.x, c.z - hulk.z)) * 0.2 : 0);
      if (sc > bestS) (bestS = sc), (best = V(c.x, fy, c.z));
    }
    return best;
  }

  /** a restart */
  reset(at: Vector3, yaw: number) {
    this.spawn(at, yaw);
    this.cd = { web: 3, air: 4, dodge: 0, melee: 0, swing: 0, explore: 10, soldier: 6, think: 0, stuck: 0, ride: 6, quip: 8 };
  }
}
