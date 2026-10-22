import { Matrix, Quaternion, Vector3 } from "@babylonjs/core/Maths/math.vector";

const _lx = new Vector3();
const _ly = new Vector3();
const _lz = new Vector3();
const _lm = new Matrix();
/**
 * Rotation that turns local +Z onto `forward` (local +Y towards `up`). Babylon 9's
 * Quaternion.FromLookDirectionLH maps +Z onto −forward (a view-matrix convention), which had
 * every decal facing into its wall — this builds the basis directly instead.
 */
export function lookRotation(forward: Vector3, up: Vector3, out: Quaternion) {
  _lz.copyFrom(forward).normalize();
  Vector3.CrossToRef(up, _lz, _lx);
  if (_lx.lengthSquared() < 1e-8) Vector3.CrossToRef(Math.abs(_lz.x) < 0.9 ? Vector3.RightReadOnly : Vector3.UpReadOnly, _lz, _lx);
  _lx.normalize();
  Vector3.CrossToRef(_lz, _lx, _ly);
  Matrix.FromValuesToRef(_lx.x, _lx.y, _lx.z, 0, _ly.x, _ly.y, _ly.z, 0, _lz.x, _lz.y, _lz.z, 0, 0, 0, 0, 1, _lm);
  Quaternion.FromRotationMatrixToRef(_lm, out);
  return out;
}

export const clamp = (v: number, a: number, b: number) => (v < a ? a : v > b ? b : v);
export const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
export const saturate = (v: number) => clamp(v, 0, 1);
export const DEG = Math.PI / 180;

/** Frame-rate independent exponential smoothing factor. */
export const damp = (rate: number, dt: number) => 1 - Math.exp(-rate * dt);

export const rand = (a: number, b: number) => a + Math.random() * (b - a);
export const randSign = () => (Math.random() < 0.5 ? -1 : 1);
export const smoothstep = (t: number) => {
  const x = saturate(t);
  return x * x * (3 - 2 * x);
};
export const easeOutCubic = (t: number) => 1 - Math.pow(1 - saturate(t), 3);
export const easeInOutSine = (t: number) => -(Math.cos(Math.PI * saturate(t)) - 1) / 2;
/** 0 → 1 → 0 bump over [0,1] */
export const bump = (t: number) => Math.sin(Math.PI * saturate(t));

/** Wrap angle to [-PI, PI] */
export const wrapAngle = (a: number) => {
  while (a > Math.PI) a -= Math.PI * 2;
  while (a < -Math.PI) a += Math.PI * 2;
  return a;
};

/** Damped spring for a scalar — used for recoil, kicks and reactions (allocation free). */
export class Spring {
  x = 0;
  v = 0;
  constructor(public stiffness: number, public damping: number) {}
  impulse(dv: number) {
    this.v += dv;
  }
  update(dt: number, target = 0) {
    // semi-implicit Euler, sub-stepped for stability at low fps
    const steps = dt > 1 / 90 ? Math.ceil(dt * 120) : 1;
    const h = dt / steps;
    for (let i = 0; i < steps; i++) {
      const a = -this.stiffness * (this.x - target) - this.damping * this.v;
      this.v += a * h;
      this.x += this.v * h;
    }
    return this.x;
  }
  reset() {
    this.x = 0;
    this.v = 0;
  }
}

/** Seeded PRNG so the procedural level/textures are identical on every load. */
export function mulberry32(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
