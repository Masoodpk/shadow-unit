import { DynamicTexture } from "@babylonjs/core/Materials/Textures/dynamicTexture";
import { Scene } from "@babylonjs/core/scene";
import { Texture } from "@babylonjs/core/Materials/Textures/texture";
import { mulberry32 } from "../core/math";

/**
 * Procedural texture authoring. Small (256–512px), tileable, generated once at
 * load. Produces an albedo map and a matching tangent-space normal map from a
 * height field so PBR materials have real surface detail without downloads.
 */

export interface PixelSet {
  size: number;
  rgba: Uint8ClampedArray;
  height?: Float32Array;
}

// ---------------------------------------------------------------- noise
function makeValueNoise(seed: number, period: number) {
  const rnd = mulberry32(seed);
  const grid = new Float32Array(period * period);
  for (let i = 0; i < grid.length; i++) grid[i] = rnd();
  return (x: number, y: number) => {
    const xi = Math.floor(x);
    const yi = Math.floor(y);
    const xf = x - xi;
    const yf = y - yi;
    const x0 = ((xi % period) + period) % period;
    const y0 = ((yi % period) + period) % period;
    const x1 = (x0 + 1) % period;
    const y1 = (y0 + 1) % period;
    const u = xf * xf * (3 - 2 * xf);
    const v = yf * yf * (3 - 2 * yf);
    const a = grid[y0 * period + x0];
    const b = grid[y0 * period + x1];
    const c = grid[y1 * period + x0];
    const d = grid[y1 * period + x1];
    return a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v;
  };
}

/** Tileable fBm over [0,1)² */
export function makeFbm(seed: number, baseFreq: number, octaves: number) {
  const layers = Array.from({ length: octaves }, (_, i) => makeValueNoise(seed + i * 101, baseFreq << i));
  return (u: number, v: number) => {
    let s = 0;
    let amp = 0.5;
    let norm = 0;
    for (let i = 0; i < octaves; i++) {
      const f = baseFreq << i;
      s += layers[i](u * f, v * f) * amp;
      norm += amp;
      amp *= 0.5;
    }
    return s / norm;
  };
}

/** Tileable cellular noise (F2-F1 → crack lines). */
function makeCells(seed: number, n: number) {
  const rnd = mulberry32(seed);
  const pts: number[] = [];
  for (let i = 0; i < n * n; i++) pts.push(rnd(), rnd());
  return (u: number, v: number) => {
    const cx = Math.floor(u * n);
    const cy = Math.floor(v * n);
    let f1 = 9;
    let f2 = 9;
    for (let dy = -1; dy <= 1; dy++)
      for (let dx = -1; dx <= 1; dx++) {
        const gx = cx + dx;
        const gy = cy + dy;
        const wx = ((gx % n) + n) % n;
        const wy = ((gy % n) + n) % n;
        const k = (wy * n + wx) * 2;
        const px = (gx + pts[k]) / n;
        const py = (gy + pts[k + 1]) / n;
        const d = Math.hypot(px - u, py - v);
        if (d < f1) {
          f2 = f1;
          f1 = d;
        } else if (d < f2) f2 = d;
      }
    return (f2 - f1) * n;
  };
}

const mixc = (a: number[], b: number[], t: number) => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
const sat = (x: number) => (x < 0 ? 0 : x > 1 ? 1 : x);

function generate(size: number, fn: (u: number, v: number, x: number, y: number) => { c: number[]; h: number; a?: number }): PixelSet {
  const rgba = new Uint8ClampedArray(size * size * 4);
  const height = new Float32Array(size * size);
  for (let y = 0; y < size; y++)
    for (let x = 0; x < size; x++) {
      const r = fn(x / size, y / size, x, y);
      const i = y * size + x;
      rgba[i * 4] = r.c[0] * 255;
      rgba[i * 4 + 1] = r.c[1] * 255;
      rgba[i * 4 + 2] = r.c[2] * 255;
      rgba[i * 4 + 3] = (r.a ?? 1) * 255;
      height[i] = r.h;
    }
  return { size, rgba, height };
}

function normalFromHeight(p: PixelSet, strength: number): PixelSet {
  const { size, height } = p;
  const h = height!;
  const rgba = new Uint8ClampedArray(size * size * 4);
  const at = (x: number, y: number) => h[((y + size) % size) * size + ((x + size) % size)];
  for (let y = 0; y < size; y++)
    for (let x = 0; x < size; x++) {
      const dx = (at(x + 1, y) - at(x - 1, y)) * strength;
      const dy = (at(x, y + 1) - at(x, y - 1)) * strength;
      const inv = 1 / Math.hypot(dx, dy, 1);
      const i = (y * size + x) * 4;
      rgba[i] = (-dx * inv * 0.5 + 0.5) * 255;
      rgba[i + 1] = (dy * inv * 0.5 + 0.5) * 255;
      rgba[i + 2] = (inv * 0.5 + 0.5) * 255;
      rgba[i + 3] = 255;
    }
  return { size, rgba };
}

export function toTexture(scene: Scene, name: string, p: PixelSet, opts: { alpha?: boolean; clamp?: boolean } = {}) {
  const tex = new DynamicTexture(name, { width: p.size, height: p.size }, scene, true, Texture.TRILINEAR_SAMPLINGMODE);
  const ctx = tex.getContext() as unknown as CanvasRenderingContext2D;
  const img = new ImageData(p.rgba as Uint8ClampedArray<ArrayBuffer>, p.size, p.size);
  ctx.putImageData(img, 0, 0);
  tex.update(false);
  tex.hasAlpha = !!opts.alpha;
  tex.anisotropicFilteringLevel = 8;
  if (opts.clamp) {
    tex.wrapU = Texture.CLAMP_ADDRESSMODE;
    tex.wrapV = Texture.CLAMP_ADDRESSMODE;
  }
  return tex;
}

// ---------------------------------------------------------------- surfaces
export function concreteWall(size = 512) {
  const f = makeFbm(11, 4, 5);
  const fine = makeFbm(12, 32, 2);
  const streak = makeFbm(13, 8, 3);
  const base = [0.56, 0.54, 0.5];
  const stain = [0.33, 0.33, 0.3];
  return generate(size, (u, v) => {
    const n = f(u, v);
    const g = fine(u, v);
    // rain streaks: noise stretched vertically
    const s = Math.pow(sat(streak(u, v * 0.12) * 1.6 - 0.55), 1.5) * (0.4 + 0.6 * v);
    // formwork tie holes in a grid + panel seams
    const gx = (u * 4) % 1;
    const gy = (v * 2) % 1;
    const hole = Math.hypot(gx - 0.5, gy - 0.5) < 0.025 ? 1 : 0;
    const seam = gx < 0.006 || gy < 0.004 ? 1 : 0;
    let c = mixc(base, stain, sat(s * 1.4 + (n - 0.5) * 0.6));
    const k = 0.86 + g * 0.22 - hole * 0.45 - seam * 0.18;
    c = [c[0] * k, c[1] * k, c[2] * k * 0.99];
    return { c, h: n * 0.5 + g * 0.35 - hole * 0.6 - seam * 0.3 };
  });
}

export function concreteFloor(size = 512) {
  const f = makeFbm(21, 4, 5);
  const fine = makeFbm(22, 32, 2);
  const cells = makeCells(23, 5);
  const oil = makeFbm(24, 2, 3);
  return generate(size, (u, v) => {
    const n = f(u, v);
    const g = fine(u, v);
    const cr = cells(u, v);
    const crack = cr < 0.035 && n > 0.45 ? 1 - cr / 0.035 : 0;
    const o = sat((oil(u, v) - 0.62) * 4);
    const b = 0.42 + n * 0.16 + g * 0.06;
    const c = [b * (1 - o * 0.45) - crack * 0.18, b * 0.985 * (1 - o * 0.45) - crack * 0.18, b * 0.95 * (1 - o * 0.4) - crack * 0.16];
    return { c, h: n * 0.4 + g * 0.5 - crack * 0.8 };
  });
}

export function paintedMetal(size = 512) {
  const f = makeFbm(31, 4, 5);
  const fine = makeFbm(32, 48, 2);
  const paint = [0.24, 0.39, 0.37]; // faded sea-glass green (station livery)
  const rust = [0.36, 0.17, 0.08];
  const bare = [0.42, 0.4, 0.38];
  return generate(size, (u, v) => {
    const n = f(u, v);
    const g = fine(u, v);
    const r = sat((n - 0.56) * 6 + (v > 0.85 ? (v - 0.85) * 6 : 0));
    const chip = sat((g - 0.72) * 8) * sat((n - 0.45) * 4);
    const seam = u % 0.5 < 0.006 || v % 0.25 < 0.006 ? 1 : 0;
    const rivet = Math.hypot((u * 16) % 1 - 0.5, (v * 4) % 1 - 0.12) < 0.08 && u % 0.5 < 0.06 ? 1 : 0;
    let c = mixc(paint, rust, r);
    c = mixc(c, bare, chip * (1 - r));
    const k = 0.9 + g * 0.18 - seam * 0.35;
    return { c: [c[0] * k, c[1] * k, c[2] * k], h: -r * 0.3 + g * 0.2 - seam * 0.8 + rivet * 0.7 - chip * 0.2 };
  });
}

export function rustSteel(size = 256) {
  const f = makeFbm(41, 4, 5);
  const fine = makeFbm(42, 32, 2);
  return generate(size, (u, v) => {
    const n = f(u, v);
    const g = fine(u, v);
    const c = mixc([0.3, 0.13, 0.06], [0.52, 0.27, 0.12], n);
    const k = 0.75 + g * 0.4;
    return { c: [c[0] * k, c[1] * k, c[2] * k], h: n * 0.6 + g * 0.5 };
  });
}

/** Greyscale corrugated container wall — tinted per material. */
export function corrugated(size = 256) {
  const f = makeFbm(51, 4, 4);
  const fine = makeFbm(52, 32, 2);
  return generate(size, (u, v) => {
    const n = f(u, v);
    const g = fine(u, v);
    const wave = Math.sin(u * Math.PI * 2 * 12);
    const dirt = sat((n - 0.5) * 2.5 + v * 0.5 - 0.2);
    const rustSpot = sat((g * n - 0.42) * 10);
    const b = 0.9 - dirt * 0.3 - (wave < -0.8 ? 0.025 : 0);
    const c = mixc([b, b, b], [0.45, 0.25, 0.14], rustSpot);
    return { c, h: wave * 0.5 + g * 0.1 };
  });
}

/** wind-packed snow: near-white, faint blue-grey drifts and a fine crystalline grain */
export function snow(size = 256) {
  const f = makeFbm(71, 3, 5);
  const fine = makeFbm(72, 96, 2);
  return generate(size, (u, v) => {
    const n = f(u, v);
    const g = fine(u, v);
    const c = mixc([0.8, 0.85, 0.92], [0.97, 0.98, 1.0], n);
    const k = 0.96 + g * 0.06;
    return { c: [c[0] * k, c[1] * k, c[2] * k], h: n * 0.6 + g * 0.4 };
  });
}

export function sand(size = 256) {
  const f = makeFbm(61, 4, 5);
  const fine = makeFbm(62, 64, 2);
  return generate(size, (u, v) => {
    const n = f(u, v);
    const g = fine(u, v);
    const c = mixc([0.5, 0.45, 0.36], [0.66, 0.6, 0.49], n);
    const k = 0.85 + g * 0.3;
    return { c: [c[0] * k, c[1] * k, c[2] * k], h: n * 0.4 + g * 0.6 };
  });
}

export function rock(size = 256) {
  const f = makeFbm(71, 4, 6);
  const cells = makeCells(72, 6);
  return generate(size, (u, v) => {
    const n = f(u, v);
    const cr = cells(u, v);
    const c = mixc([0.24, 0.23, 0.22], [0.45, 0.42, 0.38], n);
    const lichen = sat((n - 0.62) * 5);
    const cc = mixc(c, [0.55, 0.5, 0.33], lichen * 0.5);
    return { c: cc, h: n * 0.8 + Math.min(cr, 0.3) };
  });
}

export function wood(size = 256) {
  const f = makeFbm(81, 2, 4);
  const fine = makeFbm(82, 32, 2);
  return generate(size, (u, v) => {
    const plank = Math.floor(v * 5);
    const pv = (v * 5) % 1;
    const grain = Math.sin((u * 40 + f(u, v + plank * 0.13) * 8) * 1.0) * 0.5 + 0.5;
    const gap = pv < 0.04 ? 1 : 0;
    const tone = 0.85 + ((plank * 37) % 7) * 0.03;
    const c = mixc([0.3, 0.22, 0.14], [0.47, 0.36, 0.24], grain * 0.6 + fine(u, v) * 0.4);
    return { c: [c[0] * tone * (1 - gap * 0.6), c[1] * tone * (1 - gap * 0.6), c[2] * tone * (1 - gap * 0.6)], h: grain * 0.3 - gap };
  });
}

export function hazard(size = 256) {
  const fine = makeFbm(91, 16, 3);
  return generate(size, (u, v) => {
    const s = ((u + v) * 4) % 1 < 0.5;
    const wear = sat((fine(u, v) - 0.68) * 5);
    const c = s ? [0.95, 0.42, 0.12] : [0.07, 0.07, 0.07];
    return { c: mixc(c, [0.4, 0.39, 0.37], wear), h: 0 };
  });
}

export function polymer(size = 128) {
  const fine = makeFbm(101, 32, 3);
  return generate(size, (u, v) => {
    const g = fine(u, v);
    const b = 0.9 + g * 0.1;
    return { c: [b, b, b], h: g };
  });
}

/** Grime/stain decal (alpha) for ground and wall dressing. */
export function stainDecal(size = 256) {
  const f = makeFbm(111, 4, 5);
  return generate(size, (u, v) => {
    const d = Math.hypot(u - 0.5, v - 0.5) * 2;
    const a = sat((f(u, v) * 1.3 - d * 0.9) * 2.2) * 0.85;
    return { c: [0.12, 0.1, 0.08], h: 0, a };
  });
}

export function bulletHole(size = 64) {
  const f = makeFbm(121, 4, 3);
  return generate(size, (u, v) => {
    const d = Math.hypot(u - 0.5, v - 0.5) * 2;
    const ang = Math.atan2(v - 0.5, u - 0.5);
    const rough = f(u, v) * 0.25 + Math.sin(ang * 7) * 0.05;
    const core = d < 0.18 + rough * 0.3 ? 1 : 0;
    const ringA = sat(1 - (d - 0.2) / (0.55 + rough)) * 0.75;
    const a = Math.max(core, ringA * 0.8);
    const c = core ? [0.02, 0.02, 0.02] : [0.16, 0.15, 0.14];
    return { c, h: 0, a };
  });
}

export function softDot(size = 64) {
  return generate(size, (u, v) => {
    const d = Math.hypot(u - 0.5, v - 0.5) * 2;
    const a = Math.pow(sat(1 - d), 1.8);
    return { c: [1, 1, 1], h: 0, a };
  });
}

export function smokePuff(size = 128) {
  const f = makeFbm(131, 4, 4);
  return generate(size, (u, v) => {
    const d = Math.hypot(u - 0.5, v - 0.5) * 2;
    const a = sat((1 - d) * 1.4) * (0.4 + f(u, v) * 0.9);
    return { c: [1, 1, 1], h: 0, a: sat(a) };
  });
}

/** Weapon-agnostic muzzle flash sprite: hot core + petals. Tinted by material. */
export function flashSprite(size = 128, petals = 5, seed = 141) {
  const rnd = mulberry32(seed);
  const lens = Array.from({ length: petals }, () => 0.6 + rnd() * 0.4);
  return generate(size, (u, v) => {
    const dx = u - 0.5;
    const dy = v - 0.5;
    const d = Math.hypot(dx, dy) * 2;
    const ang = Math.atan2(dy, dx);
    const sector = ((ang / (Math.PI * 2) + 1) % 1) * petals;
    const idx = Math.floor(sector);
    const local = Math.abs((sector % 1) - 0.5) * 2;
    const petal = sat(1 - d / lens[idx]) * sat(1 - local * (1.2 + d * 2));
    const core = Math.pow(sat(1 - d * 2.2), 1.5);
    const a = sat(petal * 1.4 + core);
    const hot = sat(core * 1.5);
    return { c: [1, 0.85 + hot * 0.15, 0.6 + hot * 0.4], h: 0, a };
  });
}

/** Side-on flash (cone of flame along barrel axis). u = along barrel. */
export function flashSide(size = 128) {
  const f = makeFbm(151, 4, 3);
  return generate(size, (u, v) => {
    const w = 0.08 + u * 0.35 * (0.7 + f(u, v) * 0.6);
    const dv = Math.abs(v - 0.5) * 2;
    const a = sat(1 - dv / w) * Math.pow(sat(1 - u), 0.7) * sat(u * 12);
    return { c: [1, 0.8, 0.5], h: 0, a };
  });
}

export function chainLink(size = 128) {
  return generate(size, (u, v) => {
    const a = ((u + v) * 6) % 1;
    const b = ((u - v + 2) * 6) % 1;
    const wire = Math.min(Math.abs(a - 0.5), Math.abs(b - 0.5)) < 0.06 ? 1 : 0;
    const c = [0.55, 0.55, 0.53];
    return { c, h: 0, a: wire };
  });
}

/** Rolling sea normal map source (height = layered directional waves). */
export function waves(size = 256) {
  const f = makeFbm(161, 4, 4);
  return generate(size, (u, v) => {
    const h =
      Math.sin((u * 6 + v * 2) * Math.PI * 2) * 0.35 +
      Math.sin((u * -3 + v * 7) * Math.PI * 2 + 1.7) * 0.25 +
      Math.sin((u * 11 + v * -5) * Math.PI * 2) * 0.12 +
      f(u, v) * 0.6;
    return { c: [0.5, 0.5, 1], h };
  });
}

export { normalFromHeight };

// ---------------------------------------------------------------- village (Greywater)
/** lime plaster over rubble: soft mottling, damp at the foot, hairline cracks, patches fallen off */
export function plaster(size = 512, seed = 301) {
  const f = makeFbm(seed, 4, 5);
  const fine = makeFbm(seed + 1, 48, 2);
  const damp = makeFbm(seed + 2, 6, 3);
  return generate(size, (u, v) => {
    const n = f(u, v);
    const g = fine(u, v);
    // v grows downwards in the texture: the foot of the wall is v → 1
    const wet = sat((damp(u, v) - 0.45) * 2.4) * sat((v - 0.55) * 2.5);
    const spall = sat((n - 0.78) * 7);
    let c = mixc([0.88, 0.85, 0.79], [0.8, 0.77, 0.7], n);
    c = mixc(c, [0.6, 0.57, 0.52], wet * 0.45);
    c = mixc(c, [0.6, 0.52, 0.43], spall * 0.7); // stone under the fallen plaster
    const k = 0.95 + g * 0.08;
    return { c: [c[0] * k, c[1] * k, c[2] * k], h: n * 0.4 + g * 0.3 - spall * 0.6 };
  });
}

/** curved clay roof tiles in overlapping courses, weathered and mossy (u across, v down the slope) */
export function roofTiles(size = 512) {
  const f = makeFbm(311, 4, 4);
  const fine = makeFbm(312, 32, 2);
  return generate(size, (u, v) => {
    const rows = 10, cols = 8;
    const ry = v * rows, row = Math.floor(ry), fy = ry - row;
    const cx = u * cols + (row % 2) * 0.5, fx = cx - Math.floor(cx);
    const arch = Math.sin(fx * Math.PI);
    const lip = fy > 0.86 ? 1 : 0;
    const n = f(u, v), g = fine(u, v);
    const moss = sat((n - 0.6) * 4) * (1 - arch * 0.5);
    let c = mixc([0.55, 0.27, 0.17], [0.68, 0.38, 0.24], arch * 0.6 + g * 0.4);
    c = mixc(c, [0.3, 0.33, 0.2], moss * 0.7);
    const k = 0.75 + arch * 0.3 - lip * 0.25;
    return { c: [c[0] * k, c[1] * k, c[2] * k], h: arch * 0.7 - lip * 0.5 + g * 0.1 };
  });
}

/** blue-grey slate roof */
export function slate(size = 256) {
  const f = makeFbm(321, 4, 4);
  const fine = makeFbm(322, 32, 2);
  return generate(size, (u, v) => {
    const rows = 9, ry = v * rows, row = Math.floor(ry), fy = ry - row;
    const cx = u * 6 + (row % 2) * 0.5, fx = cx - Math.floor(cx);
    const seam = fx < 0.03 || fy > 0.92 ? 1 : 0;
    const tone = 0.85 + (((row * 7 + Math.floor(cx) * 13) % 5) * 0.04);
    const g = fine(u, v), n = f(u, v);
    const c = mixc([0.26, 0.29, 0.33], [0.36, 0.39, 0.43], n * 0.5 + g * 0.5);
    const k = tone * (1 - seam * 0.35);
    return { c: [c[0] * k, c[1] * k, c[2] * k], h: (1 - fy) * 0.3 - seam * 0.5 + g * 0.1 };
  });
}

/** worn cobblestones (setts) in a fan-less running bond, dark joints with grit */
export function cobble(size = 512) {
  const f = makeFbm(331, 4, 4);
  const fine = makeFbm(332, 48, 2);
  return generate(size, (u, v) => {
    const rows = 12, ry = v * rows, row = Math.floor(ry), fy = ry - row;
    const cols = 9, cx = u * cols + (row % 2) * 0.5 + ((row * 37) % 5) * 0.07, col = Math.floor(cx), fx = cx - col;
    const ex = Math.min(fx, 1 - fx) * 2, ey = Math.min(fy, 1 - fy) * 2;
    const edge = Math.min(ex * 1.4, ey);
    const dome = sat(edge * 3);
    const joint = edge < 0.12 ? 1 : 0;
    const tone = 0.82 + (((row * 31 + col * 17) % 7) * 0.035);
    const n = f(u, v), g = fine(u, v);
    let c = mixc([0.42, 0.41, 0.39], [0.56, 0.54, 0.5], g * 0.6 + n * 0.4);
    c = [c[0] * tone, c[1] * tone, c[2] * tone];
    c = mixc(c, [0.18, 0.17, 0.15], joint * 0.85);
    return { c, h: dome * 0.8 - joint * 0.4 + g * 0.1 };
  });
}

/** short trampled grass with bare patches */
export function grass(size = 256) {
  const f = makeFbm(341, 4, 5);
  const fine = makeFbm(342, 64, 2);
  return generate(size, (u, v) => {
    const n = f(u, v), g = fine(u, v);
    const bare = sat((0.42 - n) * 5);
    let c = mixc([0.24, 0.32, 0.14], [0.36, 0.44, 0.2], g);
    c = mixc(c, [0.42, 0.36, 0.26], bare);
    return { c, h: g * 0.6 + n * 0.2 };
  });
}

/** packed earth path with ruts and small stones */
export function dirt(size = 256) {
  const f = makeFbm(351, 4, 5);
  const fine = makeFbm(352, 64, 2);
  const cells = makeCells(353, 18);
  return generate(size, (u, v) => {
    const n = f(u, v), g = fine(u, v);
    const stone = cells(u, v) > 0.85 ? 1 : 0;
    let c = mixc([0.36, 0.3, 0.22], [0.5, 0.42, 0.31], n);
    c = mixc(c, [0.55, 0.53, 0.5], stone * 0.6);
    const k = 0.88 + g * 0.2;
    return { c: [c[0] * k, c[1] * k, c[2] * k], h: n * 0.5 + g * 0.3 + stone * 0.3 };
  });
}

/** an old wooden door: vertical boards, two ledges, iron studs */
export function plankDoor(size = 256) {
  const f = makeFbm(361, 2, 4);
  return generate(size, (u, v) => {
    const board = Math.floor(u * 6), bu = u * 6 - board;
    const gap = bu < 0.05 ? 1 : 0;
    const ledge = Math.abs(v - 0.22) < 0.04 || Math.abs(v - 0.78) < 0.04 ? 1 : 0;
    const grain = Math.sin((v * 60 + f(u + board * 0.2, v) * 10)) * 0.5 + 0.5;
    const tone = 0.8 + ((board * 29) % 5) * 0.05;
    let c = mixc([0.28, 0.2, 0.13], [0.42, 0.31, 0.2], grain * 0.7);
    c = [c[0] * tone * (1 - gap * 0.6), c[1] * tone * (1 - gap * 0.6), c[2] * tone * (1 - gap * 0.6)];
    if (ledge) c = [c[0] * 0.8, c[1] * 0.8, c[2] * 0.8];
    return { c, h: grain * 0.2 - gap * 0.6 + ledge * 0.4 };
  });
}

/**
 * A 3 m × 3 m storey of plastered wall with one window in it (repeat it across a facade): stone
 * frame, sill, dark glass with a cross mullion and a sky glint, optional wooden shutters. The
 * texture's top row is the top of the storey (the floor is at the bottom).
 */
export function facade(size = 512, seed = 401, shutters = false) {
  const base = plaster(size, seed);
  const fine = makeFbm(seed + 9, 32, 2);
  const W0 = 0.35, W1 = 0.65, V0 = 1 - 2.15 / 3, V1 = 1 - 0.9 / 3;
  const FR = 0.022;
  return generate(size, (u, v, x, y) => {
    const i = (y * size + x) * 4;
    let c = [base.rgba[i] / 255, base.rgba[i + 1] / 255, base.rgba[i + 2] / 255];
    let h = base.height![y * size + x];
    const inFrame = u > W0 - FR && u < W1 + FR && v > V0 - FR && v < V1 + FR * 0.5;
    const inGlass = u > W0 && u < W1 && v > V0 && v < V1;
    const sill = u > W0 - FR * 2 && u < W1 + FR * 2 && v >= V1 + FR * 0.5 && v < V1 + FR * 2.2;
    if (sill) {
      c = mixc([0.78, 0.76, 0.72], [0.6, 0.58, 0.55], fine(u, v));
      h = 0.9;
    } else if (inGlass) {
      const mull = Math.abs(u - (W0 + W1) / 2) < 0.008 || Math.abs(v - (V0 + (V1 - V0) * 0.38)) < 0.008;
      const t = (v - V0) / (V1 - V0);
      c = mull ? [0.82, 0.8, 0.75] : mixc([0.2, 0.26, 0.32], [0.04, 0.05, 0.06], t * 0.8 + 0.2);
      // a glint of sky in the upper corner
      if (!mull && t < 0.3 && (u - W0) / (W1 - W0) > 0.55) c = mixc(c, [0.45, 0.55, 0.62], (0.3 - t) * 1.6);
      h = mull ? 0.2 : -0.8;
    } else if (inFrame) {
      c = mixc([0.85, 0.84, 0.8], [0.7, 0.69, 0.65], fine(u, v));
      h = 0.4;
    } else if (shutters && v > V0 && v < V1 && ((u > W0 - 0.14 && u < W0 - FR - 0.005) || (u > W1 + FR + 0.005 && u < W1 + 0.14))) {
      const slat = ((v - V0) * 60) % 1 < 0.25;
      c = mixc([0.24, 0.32, 0.3], [0.18, 0.24, 0.22], slat ? 1 : fine(u, v));
      h = slat ? 0.1 : 0.3;
    }
    // a dirt shadow under the sill and grime streaking down from it
    if (!inFrame && !sill && u > W0 && u < W1 && v > V1 + FR * 2.2 && v < V1 + 0.18) {
      const k = 1 - 0.18 * (1 - (v - V1) / 0.18) * fine(u * 3, v);
      c = [c[0] * k, c[1] * k, c[2] * k];
    }
    return { c, h };
  });
}
