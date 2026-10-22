import { Clip, ClipKey, PoseBuffer, rootAt } from "./SoldierAnim";

/**
 * Decides which motion-captured clips play and how they blend — nothing here
 * knows about bones or meshes, so a different character (or rig) only needs
 * a new clip set.
 *
 *  - Locomotion blend space: 6 directions (forward, both diagonals, both sides,
 *    back) × speed tiers (walk → run → sprint, strafe → side-walk, back-step →
 *    crouched retreat → back-pedal). All moving clips share one synchronised
 *    gait cycle whose rate follows the real ground speed, so feet don't skate.
 *  - Standing: low-ready idle ↔ shooting stance (by aim) ↔ kneeling (by crouch).
 *  - Upper-body layers: low ready while walking unalerted, reload, hit flinch.
 *  - Arm layer: grenade throw (left arm — the rifle stays in the right hand).
 *  - One-shot full-body actions with root motion: dodge roll, side steps,
 *    run-to-stop, rifle-butt strike, death stagger.
 */
export type ActionKey = "roll" | "stepL" | "stepR" | "stop" | "whip" | "stab" | "deathF" | "deathR" | "deathB";

interface ActionDef {
  clip: ClipKey;
  t0: number;
  t1: number;
  rate: number;
  fadeIn: number;
  fadeOut: number;
  /** clip time of the strike / landing etc. */
  event?: number;
  /** how much the procedural aim may still turn the spine */
  aim: number;
}

export const ACTIONS: Record<ActionKey, ActionDef> = {
  roll: { clip: "roll", t0: 0.05, t1: 1.9, rate: 1.05, fadeIn: 0.1, fadeOut: 0.3, aim: 0 },
  stepL: { clip: "stepL", t0: 0.08, t1: 1.05, rate: 1.35, fadeIn: 0.1, fadeOut: 0.2, aim: 0.6 },
  stepR: { clip: "stepR", t0: 0.08, t1: 1.05, rate: 1.35, fadeIn: 0.1, fadeOut: 0.2, aim: 0.6 },
  stop: { clip: "stop", t0: 0.55, t1: 1.75, rate: 1.0, fadeIn: 0.15, fadeOut: 0.35, aim: 0.2 },
  whip: { clip: "whip", t0: 0.2, t1: 1.45, rate: 1.3, fadeIn: 0.1, fadeOut: 0.25, event: 0.9, aim: 0.15 },
  stab: { clip: "stab", t0: 0.35, t1: 1.85, rate: 1.4, fadeIn: 0.1, fadeOut: 0.25, event: 0.92, aim: 0.15 },
  deathF: { clip: "deathF", t0: 0, t1: 1.2, rate: 1, fadeIn: 0.06, fadeOut: 0, aim: 0 },
  deathR: { clip: "deathR", t0: 0, t1: 1.2, rate: 1, fadeIn: 0.06, fadeOut: 0, aim: 0 },
  deathB: { clip: "deathB", t0: 0, t1: 1.2, rate: 1, fadeIn: 0.06, fadeOut: 0, aim: 0 },
};
/** grenade throw (left arm): clip time of the release */
export const THROW_RELEASE = 0.9;
const THROW_RATE = 1.15;

export interface LocoInput {
  dt: number;
  speed: number;
  vx: number;
  vz: number;
  aim: number;
  crouch: number;
  /** moving crouched (cover shuffle / crouched retreat) */
  crouchMove: boolean;
  reload: number;
  blind: number;
}

export interface AnimOutput {
  /** 0 = left hand on the handguard, 1 = free */
  leftFree: number;
  /** how much procedural aiming may turn the spine */
  aimScale: number;
  /** root motion this frame (body frame, metres) */
  rootX: number;
  rootZ: number;
  /** a one-shot crossed its event this frame ("strike", "release") */
  event: "strike" | "release" | null;
  /** a full-body action is playing */
  busy: boolean;
}

interface Dir {
  ang: number;
  tiers: ClipKey[];
  /** low-ready alternative (rifle down), blended in by (1 - aim) */
  low?: ClipKey[];
  crouch?: ClipKey[];
}
const RAD = Math.PI / 180;
const DIRS: Dir[] = ([
  { ang: -180, tiers: ["back", "backWalk", "sprintBack"], low: ["backLow", "sprintBack"], crouch: ["crouchBack"] },
  { ang: -135, tiers: ["walkBL", "runBL"], crouch: ["crouchBack", "crouchL"] },
  { ang: -90, tiers: ["strafeL", "walkL"], crouch: ["crouchL"] },
  { ang: -45, tiers: ["walkFL", "run", "sprint"] },
  { ang: 0, tiers: ["walk", "run", "sprint"] },
  { ang: 45, tiers: ["walkFR", "run", "sprint"] },
  { ang: 90, tiers: ["strafeR", "walkR"], crouch: ["crouchR"] },
  { ang: 135, tiers: ["walkBR", "runBR"], crouch: ["crouchBack", "crouchR"] },
  { ang: 180, tiers: ["back", "backWalk", "sprintBack"], low: ["backLow", "sprintBack"], crouch: ["crouchBack"] },
] as Dir[]).map((d) => ({ ...d, ang: d.ang * RAD }));

const smooth = (a: number, b: number, x: number) => {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};

export class EnemyAnimationController {
  private phase = Math.random();
  /** the direction the legs are stepping (body-local, radians), eased toward the way he's moving */
  private dirAng = 0;
  /** how far into the crouched gait (0 upright … 1 crouched), eased: a flag flipped mid-stride popped the hips */
  private crouchW = 0;
  private tIdle = Math.random() * 7;
  private tAim = 0;
  private action: { key: ActionKey; t: number; fired: boolean; out: boolean } | null = null;
  private throwT = -1;
  private throwFired = false;
  private flinchT = -1;
  private flinchAmp = 0;
  private ra = { x: 0, z: 0 };
  private rb = { x: 0, z: 0 };
  private picks: { c: Clip; w: number }[] = [];
  readonly out: AnimOutput = { leftFree: 0, aimScale: 1, rootX: 0, rootZ: 0, event: null, busy: false };

  constructor(
    private clips: Record<ClipKey, Clip>,
    private upper: Float32Array,
    private leftArm: Float32Array,
  ) {}

  /** start a one-shot (interrupts any other) */
  play(key: ActionKey) {
    this.action = { key, t: ACTIONS[key].t0, fired: false, out: false };
  }
  get current() {
    return this.action?.key ?? null;
  }
  get busy() {
    return !!this.action && !this.action.out;
  }
  /** grenade throw on the left arm */
  throwGrenade() {
    this.throwT = 0;
    this.throwFired = false;
  }
  get throwing() {
    return this.throwT >= 0;
  }
  /** upper-body hit reaction, amplitude 0..1 */
  flinch(amp: number) {
    this.flinchT = 0;
    this.flinchAmp = Math.min(1, Math.max(0.3, amp));
  }
  reset() {
    this.action = null;
    this.throwT = -1;
    this.flinchT = -1;
  }

  private addDir(d: Dir, crouched: boolean, aim: number, s: number, w: number) {
    if (crouched && d.crouch) {
      // crouched diagonals: half back, half side
      const n = d.crouch.length;
      for (const c of d.crouch) this.addTiers([c], s, w / n);
      return;
    }
    if (d.low) {
      this.addTiers(d.tiers, s, w * aim);
      this.addTiers(d.low, s, w * (1 - aim));
    } else this.addTiers(d.tiers, s, w);
  }

  private addTiers(tiers: ClipKey[], s: number, w: number) {
    if (w <= 1e-4) return;
    const C = this.clips;
    if (tiers.length === 1 || s <= C[tiers[0]].speed) {
      this.picks.push({ c: C[tiers[0]], w });
      return;
    }
    for (let i = 0; i < tiers.length - 1; i++) {
      const a = C[tiers[i]], b = C[tiers[i + 1]];
      if (s <= b.speed || i === tiers.length - 2) {
        const k = smooth(0, 1, (s - a.speed) / (b.speed - a.speed));
        this.picks.push({ c: a, w: w * (1 - k) });
        this.picks.push({ c: b, w: w * k });
        return;
      }
    }
  }

  /** Fill `base` with the blended pose for this frame. */
  evaluate(inp: LocoInput, base: PoseBuffer, layer: PoseBuffer): AnimOutput {
    const C = this.clips;
    const o = this.out;
    const dt = inp.dt;
    o.event = null;
    o.rootX = o.rootZ = 0;
    o.leftFree = 0;
    o.aimScale = 1;

    // ---------------- locomotion
    const s = inp.speed;
    const m = smooth(0.05, 0.45, s);
    this.picks.length = 0;
    if (m > 1e-3) {
      // (eased, not taken raw: as he reverses, his velocity passes through zero and its angle jumps
      // straight from ahead to behind — the walk swapped to the back-step in one frame, a jolt through
      // the hips. Moving properly the legs swing round to a new heading at up to 5 rad/s; nearly
      // stopped, where the cycle hardly shows, they take it at once)
      const want = Math.atan2(inp.vx, inp.vz);
      const d = Math.atan2(Math.sin(want - this.dirAng), Math.cos(want - this.dirAng));
      const rate = 5 + 40 * (1 - m);
      this.dirAng += Math.max(-rate * dt, Math.min(rate * dt, d));
      if (this.dirAng > Math.PI) this.dirAng -= 2 * Math.PI;
      else if (this.dirAng < -Math.PI) this.dirAng += 2 * Math.PI;
      const ang = this.dirAng;
      let i = 0;
      while (i < DIRS.length - 2 && ang > DIRS[i + 1].ang) i++;
      const a = DIRS[i], b = DIRS[i + 1];
      const k = smooth(0, 1, (ang - a.ang) / (b.ang - a.ang));
      // (crouched and upright cross-fade over a quarter second — the shuffle along cover ending
      // while he's still moving at 0.9 m/s swapped the legs' clips in one frame, a 13–23 cm pop)
      this.crouchW += ((inp.crouchMove ? 1 : 0) - this.crouchW) * Math.min(1, dt / 0.25);
      const cw = this.crouchW;
      if (cw > 1e-3) {
        this.addDir(a, true, inp.aim, s, m * (1 - k) * cw);
        this.addDir(b, true, inp.aim, s, m * k * cw);
      }
      if (cw < 0.999) {
        this.addDir(a, false, inp.aim, s, m * (1 - k) * (1 - cw));
        this.addDir(b, false, inp.aim, s, m * k * (1 - cw));
      }
      // synchronised cycle
      let wsum = 0, T = 0, v = 0, backW = 0;
      for (const p of this.picks) {
        wsum += p.w;
        T += p.w * p.c.dur;
        v += p.w * p.c.speed;
        if (p.c === C.back) backW += p.w;
      }
      if (wsum > 1e-4) {
        T /= wsum;
        v /= wsum;
        const maxRate = 1.5 + (backW / wsum) * 1.0;
        const rate = Math.min(maxRate, Math.max(0.5, s / Math.max(0.1, v)));
        this.phase = (this.phase + (dt * rate) / T) % 1;
      }
    }
    this.tIdle += dt;
    this.tAim += dt;
    base.clear();
    const still = 1 - m;
    const kneel = smooth(0.05, 0.95, inp.crouch) * still;
    base.add(C.idle, this.tIdle, still * (1 - kneel) * (1 - inp.aim));
    base.add(C.aim, this.tAim, still * (1 - kneel) * inp.aim);
    base.add(C.kneel, C.kneel.dur, kneel, false);
    // every loop is sampled relative to its own left-heel strike, so blended clips step together
    for (const p of this.picks) base.add(p.c, ((this.phase + p.c.sync) % 1) * p.c.dur, p.w);
    base.normalize();

    // ---------------- upper-body layers
    let runW = 0;
    for (const p of this.picks) if (p.c === C.run || p.c === C.sprint || p.c === C.sprintBack) runW += p.w;
    const low = (1 - inp.aim) * m * (1 - Math.min(1, runW)) * (1 - this.crouchW);
    const lowW = Math.max(low, inp.blind * 0.8);
    if (lowW > 1e-3) {
      layer.clear();
      layer.add(C.idle, this.tIdle, 1);
      layer.normalize();
      base.mix(layer, lowW, this.upper);
    }
    if (inp.reload >= 0) {
      const pr = inp.reload;
      const w = smooth(0, 0.07, pr) * (1 - smooth(0.93, 1, pr));
      layer.clear();
      layer.add(C.reload, pr * C.reload.dur, 1, false);
      layer.normalize();
      base.mix(layer, w, this.upper);
      o.leftFree = smooth(0.09, 0.15, pr) * (1 - smooth(0.82, 0.9, pr));
    }
    if (this.flinchT >= 0) {
      this.flinchT += dt * 1.5;
      const t = this.flinchT;
      if (t > 0.95) this.flinchT = -1;
      else {
        const w = Math.sin(Math.min(1, t / 0.95) * Math.PI) * 0.75 * this.flinchAmp;
        layer.clear();
        layer.add(C.hit, 0.08 + t, 1, false);
        layer.normalize();
        base.mix(layer, w, this.upper);
        o.leftFree = Math.max(o.leftFree, w * 0.6);
        o.aimScale *= 1 - w * 0.7;
      }
    }

    // ---------------- grenade throw (left arm)
    if (this.throwT >= 0) {
      const prev = this.throwT;
      this.throwT += dt * THROW_RATE;
      const t = this.throwT;
      const dur = C.throw.dur;
      if (!this.throwFired && prev < THROW_RELEASE && t >= THROW_RELEASE) {
        this.throwFired = true;
        o.event = "release";
      }
      if (t >= dur) this.throwT = -1;
      else {
        const w = smooth(0, 0.15, t) * (1 - smooth(dur - 0.25, dur, t));
        layer.clear();
        layer.add(C.throw, t, 1, false);
        layer.normalize();
        base.mix(layer, w, this.leftArm);
        o.leftFree = Math.max(o.leftFree, w);
      }
    }

    // ---------------- one-shot full-body action
    o.busy = false;
    const a = this.action;
    if (a) {
      const def = ACTIONS[a.key];
      const clip = C[def.clip];
      const prev = a.t;
      a.t += dt * def.rate;
      const t1 = Math.min(def.t1, clip.dur);
      if (def.event !== undefined && !a.fired && prev < def.event && a.t >= def.event) {
        a.fired = true;
        o.event = "strike";
      }
      const wIn = def.fadeIn > 0 ? smooth(0, 1, (a.t - def.t0) / (def.fadeIn * def.rate)) : 1;
      const wOut = def.fadeOut > 0 ? 1 - smooth(t1 - def.fadeOut * def.rate, t1, a.t) : 1;
      const w = Math.min(wIn, wOut);
      // root motion (only while the action owns the body)
      if (clip.root) {
        rootAt(clip, prev, this.ra);
        rootAt(clip, Math.min(a.t, t1), this.rb);
        o.rootX = (this.rb.x - this.ra.x) * w;
        o.rootZ = (this.rb.z - this.ra.z) * w;
      }
      layer.clear();
      layer.add(clip, Math.min(a.t, t1), 1, false);
      layer.normalize();
      base.mixAll(layer, w);
      o.aimScale *= 1 - w * (1 - def.aim);
      o.leftFree = Math.max(o.leftFree, def.clip === "whip" || def.clip === "stab" ? w : 0);
      o.busy = a.t < t1 - def.fadeOut * def.rate * 0.5;
      // death clips hold their last frame until the ragdoll takes over
      if (a.t >= t1 && def.fadeOut > 0) this.action = null;
      else if (a.t >= t1) a.t = t1;
    }
    return o;
  }
}
