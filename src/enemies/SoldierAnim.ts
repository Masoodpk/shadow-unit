import animsUrl from "../assets/anims/soldier_anims.json?url";
import type { SkinKind } from "./SoldierSkin";

/**
 * Motion-captured rifle animations (Mixamo "Rifle Idle", "Firing Rifle" walk,
 * "Run Forward", "Stepping Backward", both strafes, the "Gunplay" shooting
 * stance and "Reloading"), retargeted offline onto each soldier rig.
 *
 * Retargeting is geometric: for every frame the source joint positions give
 * each bone a direction and a roll reference (bend plane, palm, foot), and the
 * target bone is turned to match — so the different rest poses and bone axes
 * of the Mixamo, Character-Creator and FSB skeletons don't matter. Root motion
 * is removed (the AI moves the soldier) and recorded as clip speed instead.
 *
 * Data: per rig, per clip, 30 fps local rotations (int16 quaternions) for every
 * driven bone plus the pelvis translation.
 */
export type ClipKey =
  | "idle" | "walk" | "run" | "back" | "strafeR" | "strafeL" | "aim" | "reload"
  | "sprint" | "sprintBack" | "walkL" | "walkR" | "walkFL" | "walkFR"
  | "crouchBack" | "crouchR" | "crouchL" | "kneel" | "hit"
  | "stepR" | "stepL" | "roll" | "stop" | "whip" | "stab" | "throw"
  | "backWalk" | "backLow" | "walkBR" | "walkBL" | "runBR" | "runBL"
  | "deathR" | "deathF" | "deathB";

export interface Clip {
  n: number;
  fps: number;
  /** seconds (last frame == first frame for loops) */
  dur: number;
  /** recorded ground speed, m/s */
  speed: number;
  /** gait phase (0..1) of the left foot's heel strike — loops are sampled relative to it so feet stay in step when blended */
  sync: number;
  rot: Int16Array;
  hips: Float32Array;
  /** root motion (one-shot actions): per frame [right, forward] metres from frame 0 */
  root?: Float32Array;
}
export interface AnimSet {
  bones: string[];
  hips: string;
  clips: Record<ClipKey, Clip>;
}

interface RawClip {
  fps: number;
  n: number;
  speed: number;
  sync?: number;
  rot: string;
  hips: string;
  root?: string;
}

function b64(s: string) {
  const bin = atob(s);
  const u = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) u[i] = bin.charCodeAt(i);
  return u.buffer;
}

export async function loadSoldierAnims(): Promise<Record<SkinKind, AnimSet>> {
  const raw = (await (await fetch(animsUrl)).json()) as Record<SkinKind, { bones: string[]; hips: string; clips: Record<ClipKey, RawClip> }>;
  const out = {} as Record<SkinKind, AnimSet>;
  for (const kind of Object.keys(raw) as SkinKind[]) {
    const r = raw[kind];
    const clips = {} as Record<ClipKey, Clip>;
    for (const k of Object.keys(r.clips) as ClipKey[]) {
      const c = r.clips[k];
      clips[k] = { n: c.n, fps: c.fps, dur: (c.n - 1) / c.fps, speed: c.speed, sync: c.sync ?? 0, rot: new Int16Array(b64(c.rot)), hips: new Float32Array(b64(c.hips)), root: c.root ? new Float32Array(b64(c.root)) : undefined };
    }
    out[kind] = { bones: r.bones, hips: r.hips, clips };
  }
  return out;
}

const S = 1 / 32767;

/** root offset of a clip at time t (clamped), body frame [right, forward] */
export function rootAt(c: Clip, t: number, out: { x: number; z: number }) {
  if (!c.root) {
    out.x = out.z = 0;
    return out;
  }
  const f = Math.min(Math.max(t, 0), c.dur) * c.fps;
  const i0 = Math.min(c.n - 1, Math.floor(f));
  const i1 = Math.min(c.n - 1, i0 + 1);
  const u = f - i0;
  out.x = c.root[i0 * 2] + (c.root[i1 * 2] - c.root[i0 * 2]) * u;
  out.z = c.root[i0 * 2 + 1] + (c.root[i1 * 2 + 1] - c.root[i0 * 2 + 1]) * u;
  return out;
}

/**
 * Pose accumulator: weighted quaternion sums (hemisphere-aligned) per bone,
 * normalised at the end — the standard way to blend N clips.
 */
export class PoseBuffer {
  readonly q: Float32Array;
  readonly hips = new Float32Array(3);
  w = 0;
  constructor(readonly nb: number) {
    this.q = new Float32Array(nb * 4);
  }
  clear() {
    this.q.fill(0);
    this.hips.fill(0);
    this.w = 0;
  }
  /** add clip at time t (seconds; wrapped when loop) with weight w */
  add(c: Clip, t: number, w: number, loop = true) {
    if (w <= 1e-4) return;
    if (loop) {
      t %= c.dur;
      if (t < 0) t += c.dur;
    } else t = Math.min(Math.max(t, 0), c.dur);
    const f = t * c.fps;
    const i0 = Math.min(c.n - 1, Math.floor(f));
    const i1 = Math.min(c.n - 1, i0 + 1);
    const u = f - i0;
    const nb = this.nb;
    const r = c.rot;
    const q = this.q;
    for (let b = 0; b < nb; b++) {
      const o0 = (i0 * nb + b) * 4;
      const o1 = (i1 * nb + b) * 4;
      let x1 = r[o1] * S, y1 = r[o1 + 1] * S, z1 = r[o1 + 2] * S, w1 = r[o1 + 3] * S;
      const x0 = r[o0] * S, y0 = r[o0 + 1] * S, z0 = r[o0 + 2] * S, w0 = r[o0 + 3] * S;
      if (x0 * x1 + y0 * y1 + z0 * z1 + w0 * w1 < 0) (x1 = -x1), (y1 = -y1), (z1 = -z1), (w1 = -w1);
      let x = x0 + (x1 - x0) * u, y = y0 + (y1 - y0) * u, z = z0 + (z1 - z0) * u, ww = w0 + (w1 - w0) * u;
      const o = b * 4;
      if (q[o] * x + q[o + 1] * y + q[o + 2] * z + q[o + 3] * ww < 0) (x = -x), (y = -y), (z = -z), (ww = -ww);
      q[o] += x * w;
      q[o + 1] += y * w;
      q[o + 2] += z * w;
      q[o + 3] += ww * w;
    }
    const h = c.hips;
    const a = i0 * 3, bb = i1 * 3;
    this.hips[0] += (h[a] + (h[bb] - h[a]) * u) * w;
    this.hips[1] += (h[a + 1] + (h[bb + 1] - h[a + 1]) * u) * w;
    this.hips[2] += (h[a + 2] + (h[bb + 2] - h[a + 2]) * u) * w;
    this.w += w;
  }
  normalize() {
    const q = this.q;
    for (let o = 0; o < q.length; o += 4) {
      const l = Math.hypot(q[o], q[o + 1], q[o + 2], q[o + 3]);
      if (l < 1e-8) {
        q[o + 3] = 1;
        continue;
      }
      q[o] /= l;
      q[o + 1] /= l;
      q[o + 2] /= l;
      q[o + 3] /= l;
    }
    if (this.w > 1e-6) for (let i = 0; i < 3; i++) this.hips[i] /= this.w;
  }
  /** whole-body blend toward `other` (rotations and pelvis) */
  mixAll(other: PoseBuffer, w: number) {
    if (w <= 1e-4) return;
    if (!this.allMask || this.allMask.length !== this.nb) this.allMask = new Float32Array(this.nb).fill(1);
    this.mix(other, w, this.allMask);
    for (let i = 0; i < 3; i++) this.hips[i] += (other.hips[i] - this.hips[i]) * w;
  }
  private allMask: Float32Array | null = null;

  /** this = nlerp(this, other, w) on masked bones (other must be normalised) */
  mix(other: PoseBuffer, w: number, mask: Float32Array) {
    if (w <= 1e-4) return;
    const q = this.q;
    const p = other.q;
    for (let b = 0; b < this.nb; b++) {
      const k = w * mask[b];
      if (k <= 1e-4) continue;
      const o = b * 4;
      const s = q[o] * p[o] + q[o + 1] * p[o + 1] + q[o + 2] * p[o + 2] + q[o + 3] * p[o + 3] < 0 ? -1 : 1;
      let x = q[o] + (p[o] * s - q[o]) * k;
      let y = q[o + 1] + (p[o + 1] * s - q[o + 1]) * k;
      let z = q[o + 2] + (p[o + 2] * s - q[o + 2]) * k;
      let ww = q[o + 3] + (p[o + 3] * s - q[o + 3]) * k;
      const l = Math.hypot(x, y, z, ww) || 1;
      x /= l;
      y /= l;
      z /= l;
      ww /= l;
      q[o] = x;
      q[o + 1] = y;
      q[o + 2] = z;
      q[o + 3] = ww;
    }
  }
}
