import clipsUrl from "../assets/anims/spidey-clips.json?url";
import type { Dir } from "./SpiderRig";

/**
 * Spider-Man's moves, all as bone directions in his body frame (x his right, y up, z forward),
 * in the order of SpiderRig.PAIRS:
 *
 *  - motion capture, baked by scripts/assets: run, sprint, roll, side-steps, stop, kneel, a fall
 *    (the soldiers' clips, read off their rig), and Mixamo's Punching, Combo Punch, Right Hook,
 *    Kicking and Jumping Down;
 *  - poses set by hand for what no clip covers: the fighting stance, the crouch on a rooftop, the
 *    three-point landing, the swing, a tuck for flips, the wall crawl, the web shot, a hit flinch.
 *
 * Arms in the soldier clips hold a rifle: his arms are re-posed over them (a sprinter's swing).
 */

export interface DirClip {
  fps: number;
  speed?: number;
  frames: { hip: Dir; d: Dir[] }[];
  /** when blows land (fraction of the clip), which limb */
  hits?: [number, string, string][];
}
export type ClipName = "elbowCombo" | "smash" | "mmaKick" | "mmaKick2" | "mmaKick3" | "walk" | "run" | "sprint" | "roll" | "stepL" | "stepR" | "stop" | "kneel" | "deathB" | "punch" | "combo" | "hook" | "kick" | "jumpDown";

export async function loadSpiderClips() {
  const raw = (await (await fetch(clipsUrl)).json()) as { pairs: [string, string][]; clips: Record<ClipName, DirClip> };
  return raw.clips;
}

/** pair indices (the head's pair points to the crown: "up" for a level gaze, forward tips the face down) */
export const P = {
  hips: 0, spine: 1, spine1: 2, spine2: 3, neck: 4, head: 5,
  lArm: 6, lFore: 7, lHand: 8, rArm: 9, rFore: 10, rHand: 11,
  lThigh: 12, lShin: 13, lFoot: 14, rThigh: 15, rShin: 16, rFoot: 17,
} as const;
export const NPAIRS = 18;

export interface Pose {
  d: Dir[];
  /** pelvis: right, up (fraction of the standing hip height), forward */
  hip: Dir;
}

const norm = (v: Dir): Dir => {
  const l = Math.hypot(v[0], v[1], v[2]) || 1;
  return [v[0] / l, v[1] / l, v[2] / l];
};
const mir = (v: Dir): Dir => [-v[0], v[1], v[2]];

/**
 * A pose from the left side's directions (the right mirrored unless given) and the torso.
 * Missing entries fall back to standing straight.
 */
export function pose(parts: Partial<Record<keyof typeof P, Dir>>, hip: Dir = [0, 1, 0]): Pose {
  const d: Dir[] = new Array(NPAIRS);
  const base: Record<keyof typeof P, Dir> = {
    hips: [0, 1, 0], spine: [0, 1, 0], spine1: [0, 1, 0], spine2: [0, 1, 0], neck: [0, 1, 0.05], head: [0, 1, 0.05],
    lArm: [-0.2, -1, 0], lFore: [-0.1, -1, 0.1], lHand: [-0.1, -1, 0.1],
    rArm: [0.2, -1, 0], rFore: [0.1, -1, 0.1], rHand: [0.1, -1, 0.1],
    lThigh: [-0.05, -1, 0], lShin: [0, -1, -0.02], lFoot: [-0.05, -0.45, 0.9],
    rThigh: [0.05, -1, 0], rShin: [0, -1, -0.02], rFoot: [0.05, -0.45, 0.9],
  };
  const pick = (k: keyof typeof P, mirrorOf?: keyof typeof P): Dir =>
    parts[k] ?? (mirrorOf && parts[mirrorOf] ? mir(parts[mirrorOf]!) : base[k]);
  d[P.hips] = norm(pick("hips"));
  d[P.spine] = norm(pick("spine"));
  d[P.spine1] = norm(pick("spine1"));
  d[P.spine2] = norm(pick("spine2"));
  d[P.neck] = norm(pick("neck"));
  d[P.head] = norm(pick("head"));
  d[P.lArm] = norm(pick("lArm"));
  d[P.lFore] = norm(pick("lFore"));
  d[P.lHand] = norm(pick("lHand"));
  d[P.rArm] = norm(pick("rArm", "lArm"));
  d[P.rFore] = norm(pick("rFore", "lFore"));
  d[P.rHand] = norm(pick("rHand", "lHand"));
  d[P.lThigh] = norm(pick("lThigh"));
  d[P.lShin] = norm(pick("lShin"));
  d[P.lFoot] = norm(pick("lFoot"));
  d[P.rThigh] = norm(pick("rThigh", "lThigh"));
  d[P.rShin] = norm(pick("rShin", "lShin"));
  d[P.rFoot] = norm(pick("rFoot", "lFoot"));
  return { d, hip };
}

/** the fighting stance: weight low, fists up, one foot forward */
export const STANCE = pose(
  {
    hips: [0, 1, 0.08], spine: [0, 1, 0.12], spine1: [0, 1, 0.18], spine2: [0, 1, 0.12], neck: [0, 1, 0.12], head: [0, 0.98, 0.15],
    lArm: [-0.4, -0.72, 0.55], lFore: [0.2, 0.55, 0.8], lHand: [0.15, 0.25, 0.95],
    rArm: [0.42, -0.8, 0.4], rFore: [-0.15, 0.45, 0.88], rHand: [-0.1, 0.2, 0.97],
    lThigh: [-0.22, -0.92, 0.3], lShin: [-0.05, -0.95, -0.28], lFoot: [-0.15, -0.35, 0.92],
    rThigh: [0.25, -0.95, -0.15], rShin: [0.05, -0.92, -0.38], rFoot: [0.3, -0.3, 0.9],
  },
  [0, 0.9, 0],
);
/** the crouch: low on his haunches, knees out, both hands planted wide in front, head up (rooftop edges) */
export const PERCH = pose(
  {
    hips: [0, 0.75, 0.66], spine: [0, 0.62, 0.78], spine1: [0, 0.58, 0.81], spine2: [0, 0.62, 0.78], neck: [0, 0.8, 0.6], head: [0, 0.95, 0.3],
    lArm: [-0.5, -0.66, 0.56], lFore: [-0.2, -0.92, 0.34], lHand: [-0.18, -0.9, 0.4],
    rArm: [0.46, -0.7, 0.55], rFore: [0.18, -0.93, 0.32], rHand: [0.16, -0.91, 0.38],
    lThigh: [-0.6, -0.05, 0.8], lShin: [-0.12, -0.99, -0.05], lFoot: [-0.25, -0.3, 0.92],
  },
  [0, 0.4, -0.05],
);
/** standing easy: arms down at his sides, weight even (following you, nothing to fight) */
export const RELAXED = pose(
  {
    hips: [0, 1, 0.02], spine: [0, 1, 0.04], spine1: [0, 1, 0.03], spine2: [0, 1, 0], neck: [0, 1, 0.06], head: [0, 1, 0.04],
    lArm: [-0.16, -1, 0.04], lFore: [-0.06, -1, 0.18], lHand: [-0.02, -1, 0.12],
    lThigh: [-0.06, -1, 0.02], lShin: [0, -1, -0.03], lFoot: [-0.08, -0.45, 0.89],
    rThigh: [0.07, -1, -0.03], rShin: [0, -1, -0.04], rFoot: [0.12, -0.45, 0.88],
  },
  [0, 0.99, 0],
);
/**
 * Lying on his side on a container, head propped on his hand, one knee up — the entrance. (His
 * body frame is rolled so his right side faces the sky: his left (−x) is the container top.)
 */
export const RECLINE = pose(
  {
    hips: [0, 1, 0], spine: [0, 1, 0.05], spine1: [0, 1, 0.08], spine2: [0, 1, 0.05], neck: [0.12, 1, 0.12], head: [0.3, 0.92, 0.22],
    // the elbow on the container, forearm up, hand at his temple
    lArm: [-0.55, 0.72, 0.42], lFore: [0.9, 0.38, 0.2], lHand: [0.6, 0.75, 0.1],
    // the top arm drapes over in front, hand on the container
    rArm: [-0.15, -0.35, 0.92], rFore: [-0.7, -0.15, 0.7], rHand: [-0.85, 0.1, 0.5],
    // the bottom leg out long, the top one bent forward at the knee
    lThigh: [-0.05, -1, 0.12], lShin: [0, -1, -0.12], lFoot: [0.05, -0.4, 0.92],
    rThigh: [0.15, -0.55, 0.82], rShin: [-0.25, -0.8, -0.55], rFoot: [-0.3, -0.7, 0.6],
  },
  [0, 1, 0],
);
/** on the Hulk's back: knees clamped round him, left hand on his shoulder — and the right fist: drawn (A), driven down into him (B) */
export const RIDE_A = pose(
  {
    hips: [0, 0.85, 0.5], spine: [0, 0.85, 0.5], spine1: [0, 0.88, 0.45], spine2: [0, 0.9, 0.42], neck: [0, 0.9, 0.42], head: [0, 0.92, 0.35],
    lArm: [-0.35, -0.6, 0.72], lFore: [0.1, -0.8, 0.58], lHand: [0.1, -0.85, 0.5],
    rArm: [0.55, 0.25, -0.8], rFore: [-0.1, 0.9, 0.42], rHand: [-0.1, 0.9, 0.42],
    lThigh: [-0.55, -0.35, 0.76], lShin: [-0.15, -0.95, -0.25], lFoot: [-0.1, -0.6, -0.8],
  },
  [0, 0.55, -0.1],
);
export const RIDE_B = pose(
  {
    hips: [0, 0.85, 0.5], spine: [0, 0.75, 0.66], spine1: [0, 0.72, 0.7], spine2: [0, 0.72, 0.7], neck: [0, 0.85, 0.53], head: [0, 0.9, 0.42],
    lArm: [-0.35, -0.6, 0.72], lFore: [0.1, -0.8, 0.58], lHand: [0.1, -0.85, 0.5],
    rArm: [0.12, -0.35, 0.93], rFore: [0.02, -0.55, 0.83], rHand: [0, -0.5, 0.86],
    lThigh: [-0.55, -0.35, 0.76], lShin: [-0.15, -0.95, -0.25], lFoot: [-0.1, -0.6, -0.8],
  },
  [0, 0.55, -0.1],
);

/** the three-point landing: one knee down, a fist on the ground, the other arm out behind */
export const LANDING = pose(
  {
    hips: [0, 0.8, 0.6], spine: [0, 0.72, 0.7], spine1: [0, 0.7, 0.72], spine2: [0, 0.78, 0.62], neck: [0, 0.88, 0.47], head: [0, 0.94, 0.33],
    lArm: [-0.75, -0.25, -0.6], lFore: [-0.65, -0.15, -0.74], lHand: [-0.6, -0.2, -0.77],
    rArm: [0.28, -0.88, 0.38], rFore: [0.08, -0.99, 0.08], rHand: [0.05, -0.9, 0.42],
    lThigh: [-0.12, -0.35, 0.93], lShin: [-0.02, -1, -0.08], lFoot: [-0.1, -0.35, 0.93],
    rThigh: [0.15, -0.88, -0.45], rShin: [0.04, -0.12, -0.99], rFoot: [0.05, -0.95, -0.3],
  },
  [0, 0.47, -0.05],
);
/** in the air, falling or between swings: limbs loose, one knee up */
export const AIR = pose(
  {
    hips: [0, 1, 0.1], spine: [0, 1, 0.15], spine1: [0, 1, 0.1], spine2: [0, 1, 0.05], neck: [0, 1, 0.1], head: [0, 0.95, 0.3],
    lArm: [-0.85, 0.15, 0.3], lFore: [-0.55, 0.6, 0.55], lHand: [-0.4, 0.6, 0.7],
    rArm: [0.8, -0.1, 0.35], rFore: [0.5, 0.4, 0.75],
    lThigh: [-0.2, -0.6, 0.77], lShin: [-0.1, -0.95, -0.3], lFoot: [-0.15, -0.6, 0.78],
    rThigh: [0.2, -0.97, -0.05], rShin: [0.1, -0.75, -0.65], rFoot: [0.1, -0.85, 0.5],
  },
  [0, 1, 0],
);
/** knees to his chest (flips, the dive into a kick, a tumble) */
export const TUCK = pose(
  {
    hips: [0, 0.85, 0.5], spine: [0, 0.8, 0.6], spine1: [0, 0.75, 0.66], spine2: [0, 0.8, 0.6], neck: [0, 0.6, 0.8], head: [0, 0.4, 0.92],
    lArm: [-0.3, -0.3, 0.9], lFore: [0.35, 0.3, 0.88], lHand: [0.3, 0.1, 0.95],
    lThigh: [-0.15, 0.25, 0.96], lShin: [-0.08, -0.95, -0.3], lFoot: [-0.1, -0.5, 0.86],
  },
  [0, 0.7, 0],
);
/** the flying kick: one leg driven out straight, the other tucked, arms back */
export const DIVE_KICK = pose(
  {
    hips: [0, 0.9, -0.4], spine: [0, 0.9, -0.4], spine1: [0, 0.92, -0.3], spine2: [0, 0.95, -0.2], neck: [0, 0.9, 0.4], head: [0, 0.6, 0.8],
    lArm: [-0.8, 0.1, -0.55], lFore: [-0.6, 0.2, -0.75],
    rArm: [0.8, 0.1, -0.5], rFore: [0.6, 0.3, -0.7],
    rThigh: [0.05, -0.35, 0.94], rShin: [0.02, -0.3, 0.95], rFoot: [0, 0.4, 0.92],
    lThigh: [-0.15, 0.1, 0.99], lShin: [-0.05, -0.95, -0.3], lFoot: [-0.1, -0.6, 0.8],
  },
  [0, 0.9, 0],
);
/** knocked back: arched, arms flung forward */
export const HIT = pose(
  {
    hips: [0, 0.95, -0.3], spine: [0, 0.92, -0.38], spine1: [0, 0.9, -0.42], spine2: [0, 0.9, -0.42], neck: [0, 0.8, -0.55], head: [0, 0.75, -0.6],
    lArm: [-0.45, 0.1, 0.88], lFore: [-0.3, 0.45, 0.85],
    lThigh: [-0.15, -0.8, 0.55], lShin: [-0.05, -0.92, -0.38],
    rThigh: [0.2, -0.95, 0.2], rShin: [0.05, -0.85, -0.5],
  },
  [0, 0.92, -0.05],
);

/**
 * On a wall: his up is the wall's normal (away from it), forward is up the wall. Like the
 * references: one arm reaching high, the other low by his ribs, knees bent out wide like a frog's,
 * feet flat to the wall. The crawl swaps sides (A ⇄ B) as he climbs; CLING is him holding still.
 */
export const CRAWL_A = pose(
  {
    hips: [0, 0.18, 0.98], spine: [0, 0.18, 0.98], spine1: [0, 0.16, 0.99], spine2: [0, 0.16, 0.99], neck: [0, 0.55, 0.83], head: [0, 0.82, 0.57],
    lArm: [-0.28, -0.12, 0.95], lFore: [-0.12, -0.3, 0.95], lHand: [-0.05, -0.75, 0.66],
    rArm: [0.7, -0.15, -0.3], rFore: [0.12, -0.4, 0.91], rHand: [0.05, -0.85, 0.52],
    lThigh: [-0.7, 0.08, -0.7], lShin: [-0.1, -0.45, -0.89], lFoot: [-0.1, -0.95, 0.3],
    rThigh: [0.72, 0.25, 0.4], rShin: [0.15, -0.55, -0.82], rFoot: [0.1, -0.95, 0.3],
  },
  [0, 0.42, 0],
);
export const CRAWL_B = pose(
  {
    hips: [0, 0.18, 0.98], spine: [0, 0.18, 0.98], spine1: [0, 0.16, 0.99], spine2: [0, 0.16, 0.99], neck: [0, 0.55, 0.83], head: [0, 0.82, 0.57],
    rArm: [0.28, -0.12, 0.95], rFore: [0.12, -0.3, 0.95], rHand: [0.05, -0.75, 0.66],
    lArm: [-0.7, -0.15, -0.3], lFore: [-0.12, -0.4, 0.91], lHand: [-0.05, -0.85, 0.52],
    rThigh: [0.7, 0.08, -0.7], rShin: [0.1, -0.45, -0.89], rFoot: [0.1, -0.95, 0.3],
    lThigh: [-0.72, 0.25, 0.4], lShin: [-0.15, -0.55, -0.82], lFoot: [-0.1, -0.95, 0.3],
  },
  [0, 0.42, 0],
);
/** clinging still: one hand up by his head, the other at his chest, knees up wide (image 2), looking out over his shoulder */
export const CLING = pose(
  {
    hips: [0, 0.3, 0.95], spine: [0, 0.3, 0.95], spine1: [0, 0.28, 0.96], spine2: [0, 0.3, 0.95], neck: [0.25, 0.75, 0.6], head: [0.35, 0.85, 0.38],
    lArm: [-0.55, 0.05, 0.84], lFore: [0.1, -0.25, 0.96], lHand: [0.05, -0.8, 0.6],
    rArm: [0.75, 0.2, 0.1], rFore: [-0.2, 0.15, 0.97], rHand: [-0.1, -0.6, 0.79],
    lThigh: [-0.8, 0.35, 0.2], lShin: [-0.1, -0.5, -0.86], lFoot: [-0.15, -0.95, 0.2],
    rThigh: [0.8, 0.35, 0.15], rShin: [0.1, -0.5, -0.86], rFoot: [0.15, -0.95, 0.2],
  },
  [0, 0.5, -0.05],
);
/** swinging: legs together and bent, the free arm out (the web arm is aimed at the anchor live) */
export const SWING = pose(
  {
    hips: [0, 1, -0.1], spine: [0, 1, -0.05], spine1: [0, 1, 0], spine2: [0, 1, 0.05], neck: [0, 1, 0.15], head: [0, 0.9, 0.42],
    lArm: [-0.85, -0.3, 0.42], lFore: [-0.5, 0.2, 0.84],
    lThigh: [-0.08, -0.75, 0.66], lShin: [-0.03, -0.9, -0.43], lFoot: [-0.05, -0.85, -0.5],
    rThigh: [0.08, -0.9, 0.42], rShin: [0.03, -0.75, -0.66], rFoot: [0.05, -0.85, -0.5],
  },
  [0, 1, 0],
);

// ------------------------------------------------------------------ sampling and blending
/** a clip at time t (seconds) — looped or held at its end */
export function sample(c: DirClip, t: number, loop: boolean, out: Pose) {
  const n = c.frames.length;
  const dur = (n - 1) / c.fps;
  if (loop) {
    t %= dur;
    if (t < 0) t += dur;
  } else t = Math.max(0, Math.min(dur, t));
  const f = t * c.fps;
  const i0 = Math.min(n - 1, Math.floor(f)), i1 = Math.min(n - 1, i0 + 1), u = f - i0;
  const A = c.frames[i0], B = c.frames[i1];
  for (let k = 0; k < NPAIRS; k++) {
    const a = A.d[k], b = B.d[k];
    out.d[k] = norm([a[0] + (b[0] - a[0]) * u, a[1] + (b[1] - a[1]) * u, a[2] + (b[2] - a[2]) * u]);
  }
  out.hip = [A.hip[0] + (B.hip[0] - A.hip[0]) * u, A.hip[1] + (B.hip[1] - A.hip[1]) * u, A.hip[2] + (B.hip[2] - A.hip[2]) * u];
  return out;
}
export function clipDur(c: DirClip) {
  return (c.frames.length - 1) / c.fps;
}
export function newPose(): Pose {
  return { d: Array.from({ length: NPAIRS }, () => [0, 1, 0] as Dir), hip: [0, 1, 0] };
}
export function copyPose(src: Pose, out: Pose) {
  for (let k = 0; k < NPAIRS; k++) out.d[k] = [src.d[k][0], src.d[k][1], src.d[k][2]];
  out.hip = [src.hip[0], src.hip[1], src.hip[2]];
  return out;
}
/** out = a → b by w (directions renormalised); `mask` limits which pairs */
export function mixPose(a: Pose, b: Pose, w: number, out: Pose, mask?: readonly number[]) {
  const ks = mask ?? ALL;
  if (out !== a) copyPose(a, out);
  for (const k of ks) {
    const x = a.d[k], y = b.d[k];
    out.d[k] = norm([x[0] + (y[0] - x[0]) * w, x[1] + (y[1] - x[1]) * w, x[2] + (y[2] - x[2]) * w]);
  }
  if (!mask) out.hip = [a.hip[0] + (b.hip[0] - a.hip[0]) * w, a.hip[1] + (b.hip[1] - a.hip[1]) * w, a.hip[2] + (b.hip[2] - a.hip[2]) * w];
  return out;
}
const ALL = Array.from({ length: NPAIRS }, (_, k) => k);
export const ARMS = [P.lArm, P.lFore, P.lHand, P.rArm, P.rFore, P.rHand] as const;
export const UPPER = [P.spine, P.spine1, P.spine2, P.neck, P.head, ...ARMS] as const;

/**
 * Smooth the shown pose toward a target: every direction turns a fraction of the way (a
 * critically-damped follow), so any change of move blends instead of snapping.
 */
export function follow(cur: Pose, target: Pose, rate: number, dt: number) {
  const a = 1 - Math.exp(-rate * dt);
  return mixPose(cur, target, a, cur);
}

/**
 * Natural arms over the rifle-carrying clips: hanging down, each swinging against the opposite
 * thigh — a gentle swing at a walk, a fuller one with the elbow bent as he runs. `run` 0 walk → 1 sprint.
 */
export function naturalArms(p: Pose, run: number, lean: number) {
  const lt = p.d[P.lThigh], rt = p.d[P.rThigh];
  // how far the upper arm swings (radians either side of hanging straight down), and the elbow's bend
  const amp = 0.32 + run * 0.45;
  const bend = 0.22 + run * 1.15;
  const swingL = Math.max(-1, Math.min(1, rt[2] * 1.7));
  const swingR = Math.max(-1, Math.min(1, lt[2] * 1.7));
  const arm = (s: number, sw: number): [Dir, Dir, Dir] => {
    // (forward swings go a little higher than backward ones, as they do)
    const th = sw * amp * (sw > 0 ? 1 : 0.8);
    const fe = th + bend + Math.max(0, sw) * 0.25 * run;
    return [
      norm([s * 0.05, -Math.cos(th), Math.sin(th)]),
      norm([-s * 0.04, -Math.cos(fe), Math.sin(fe)]),
      norm([-s * 0.05, -Math.cos(fe + 0.12), Math.sin(fe + 0.12)]),
    ];
  };
  [p.d[P.lArm], p.d[P.lFore], p.d[P.lHand]] = arm(-1, swingL);
  [p.d[P.rArm], p.d[P.rFore], p.d[P.rHand]] = arm(1, swingR);
  p.d[P.spine1] = norm([0, 1, 0.05 + lean]);
  p.d[P.spine2] = norm([0, 1, 0.03 + lean]);
  p.d[P.neck] = norm([0, 1, 0.05]);
  p.d[P.head] = norm([0, 1, 0.08 - lean * 0.6]);
}

/** aim an arm (and its hand) at a body-frame direction (web shots, the web line while swinging) */
export function aimArm(p: Pose, side: "l" | "r", dir: Dir) {
  const d = norm(dir);
  if (side === "l") {
    p.d[P.lArm] = d;
    p.d[P.lFore] = d;
    p.d[P.lHand] = norm([d[0], d[1] - 0.35, d[2]]);
  } else {
    p.d[P.rArm] = d;
    p.d[P.rFore] = d;
    p.d[P.rHand] = norm([d[0], d[1] - 0.35, d[2]]);
  }
}
