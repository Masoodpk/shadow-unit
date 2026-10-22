import { Color3, Color4 } from "@babylonjs/core/Maths/math.color";
import { Constants } from "@babylonjs/core/Engines/constants";
import { DynamicTexture } from "@babylonjs/core/Materials/Textures/dynamicTexture";
import { Mesh } from "@babylonjs/core/Meshes/mesh";
import { MeshBuilder } from "@babylonjs/core/Meshes/meshBuilder";
import { ParticleSystem } from "@babylonjs/core/Particles/particleSystem";
import { Quaternion, Vector3 } from "@babylonjs/core/Maths/math.vector";
import { Scene } from "@babylonjs/core/scene";
import { StandardMaterial } from "@babylonjs/core/Materials/standardMaterial";
import { Texture } from "@babylonjs/core/Materials/Textures/texture";
import { Materials } from "../render/Materials";
import { lookRotation } from "../core/math";
import { PointLight } from "@babylonjs/core/Lights/pointLight";
import { InstancedMesh } from "@babylonjs/core/Meshes/instancedMesh";

/**
 * Big, pooled explosion effects (nothing is created after loading):
 *   frag    white-hot core flash → rolling orange fireball → black smoke column,
 *           debris and sparks thrown out, a ground dust ring, an expanding
 *           shock-wave ring, a scorch mark, and a brief exposure flash
 *   plasma  blue-white core, electric arcs, a cyan shock ring, violet haze
 *   fire    incendiary area: rolling flames + oily smoke for several seconds
 */

type Burst = { ps: ParticleSystem[]; next: number };

interface Ring {
  mesh: Mesh;
  t: number;
  dur: number;
  radius: number;
  color: Color3;
}
interface Flare {
  mesh: Mesh;
  t: number;
  dur: number;
  size: number;
}
interface Scorch {
  mesh: Mesh;
  t: number;
}
/** a chunk of rubble thrown out by a blast: flies, bounces, settles and stays a while */
interface Rubble {
  m: InstancedMesh;
  vel: Vector3;
  spin: Vector3;
  floorY: number;
  /** where the floor under it was last measured (re-measured after it has travelled) */
  rayX: number;
  rayZ: number;
  life: number;
  resting: boolean;
  scale: number;
}
/** a crater that keeps smouldering after the blast */
interface Smoulder {
  smoke: ParticleSystem;
  t: number;
  dur: number;
  rate: number;
}
export interface FireArea {
  pos: Vector3;
  radius: number;
  t: number;
  dur: number;
  flames: ParticleSystem;
  smoke: ParticleSystem;
  embers: ParticleSystem;
  active: boolean;
  /** looping sound handle */
  sound?: { stop(fade?: number): void };
}

function canvasTex(scene: Scene, name: string, size: number, draw: (c: CanvasRenderingContext2D, s: number) => void) {
  const tex = new DynamicTexture(name, { width: size, height: size }, scene, true, Texture.TRILINEAR_SAMPLINGMODE);
  const c = tex.getContext() as unknown as CanvasRenderingContext2D;
  c.clearRect(0, 0, size, size);
  draw(c, size);
  tex.update(false);
  tex.hasAlpha = true;
  tex.wrapU = tex.wrapV = Texture.CLAMP_ADDRESSMODE;
  return tex;
}

/** tileable-ish value noise in 0..1 (fbm of a hashed lattice), for painting decals */
function makeNoise(seed: number) {
  const hash = (x: number, y: number) => {
    let h = (x * 374761393 + y * 668265263 + seed * 2147483647) | 0;
    h = Math.imul(h ^ (h >>> 13), 1274126177);
    return ((h ^ (h >>> 16)) >>> 0) / 4294967295;
  };
  const smooth = (t: number) => t * t * (3 - 2 * t);
  const vnoise = (x: number, y: number) => {
    const xi = Math.floor(x), yi = Math.floor(y);
    const xf = smooth(x - xi), yf = smooth(y - yi);
    const a = hash(xi, yi), b = hash(xi + 1, yi), c = hash(xi, yi + 1), d = hash(xi + 1, yi + 1);
    return a + (b - a) * xf + (c - a) * yf + (a - b - c + d) * xf * yf;
  };
  return (x: number, y: number, oct = 4) => {
    let v = 0, amp = 0.5, f = 1, n = 0;
    for (let i = 0; i < oct; i++) {
      v += vnoise(x * f, y * f) * amp;
      n += amp;
      amp *= 0.5;
      f *= 2.03;
    }
    return v / n;
  };
}

/**
 * Blast mark: an irregular charred patch, darkest at the seat of the blast, with a ring of
 * thrown-out dust and grit and loose specks of debris — no hard lines (radial strokes read as
 * a cartoon starburst).
 */
function paintScorch(c: CanvasRenderingContext2D, s: number) {
  const n = makeNoise(17);
  const img = c.createImageData(s, s);
  const d = img.data;
  for (let y = 0; y < s; y++)
    for (let x = 0; x < s; x++) {
      const u = (x / s) * 2 - 1, v = (y / s) * 2 - 1;
      const r = Math.hypot(u, v);
      const ang = Math.atan2(v, u);
      // ragged outline: the edge radius wanders with the angle
      const edge = 0.55 + 0.28 * n(Math.cos(ang) * 1.6 + 3, Math.sin(ang) * 1.6 + 3, 3);
      const grain = n(x * 0.06, y * 0.06, 4);
      const fine = n(x * 0.25 + 40, y * 0.25 + 40, 2);
      const k = r / edge;
      let R = 0, G = 0, B = 0, A = 0;
      if (k < 1) {
        // char: near-black soot in the middle, burnt brown towards the rim, mottled
        const t = Math.pow(k, 1.6);
        R = 10 + 46 * t + grain * 22;
        G = 9 + 38 * t + grain * 18;
        B = 8 + 30 * t + grain * 14;
        A = (0.97 - 0.35 * t) * (0.75 + 0.25 * grain);
        // the very centre is blasted clean-ish and lighter grey (pulverised surface)
        if (r < 0.12) {
          const c0 = 1 - r / 0.12;
          R += 30 * c0 * fine;
          G += 28 * c0 * fine;
          B += 26 * c0 * fine;
        }
      } else if (k < 1.5) {
        // ejecta ring: pale dust and grit fading out, patchy
        const t = (k - 1) / 0.5;
        const patch = Math.max(0, grain - 0.35) * 1.8;
        R = 96 + fine * 30;
        G = 88 + fine * 26;
        B = 76 + fine * 22;
        A = (1 - t) * (1 - t) * 0.55 * patch;
      }
      // scattered debris specks
      if (fine > 0.8 && r < 0.95 && grain > 0.45) {
        R = G = B = 18;
        A = Math.max(A, 0.85);
      }
      const i = (y * s + x) * 4;
      d[i] = R;
      d[i + 1] = G;
      d[i + 2] = B;
      d[i + 3] = Math.max(0, Math.min(1, A)) * 255 * Math.min(1, (1 - r) * 6);
    }
  c.putImageData(img, 0, 0);
}

/** Soft, lumpy flame puff (several overlapping blobs). */
function firePuff(c: CanvasRenderingContext2D, s: number) {
  let seed = 7;
  const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  for (let i = 0; i < 22; i++) {
    const r = s * (0.12 + rnd() * 0.22);
    const x = s / 2 + (rnd() - 0.5) * s * 0.4;
    const y = s / 2 + (rnd() - 0.5) * s * 0.4;
    const g = c.createRadialGradient(x, y, 0, x, y, r);
    g.addColorStop(0, "rgba(255,255,255,0.55)");
    g.addColorStop(0.5, "rgba(255,255,255,0.22)");
    g.addColorStop(1, "rgba(255,255,255,0)");
    c.fillStyle = g;
    c.fillRect(0, 0, s, s);
  }
}

export class Explosions {
  private fireball: Burst;
  /** rockets: a much bigger, longer fireball */
  private bigFire: Burst;
  /** one flash light for blasts / launches (always present, intensity animated: no shader recompiles) */
  private light: PointLight;
  private lightT = 0;
  private lightDur = 1;
  private lightPeak = 0;
  /* (fireball pool has 3 systems so both emissions of one blast and a second blast can overlap) */
  private core: Burst;
  private darkSmoke: Burst;
  private debris: Burst;
  private sparks: Burst;
  private dustRing: Burst;
  /** powder snow blown up and out of a blast on snow */
  private snowPlume: Burst;
  /**
   * Light painted on the ground round a blast. On a baked, unlit map (Frostline) the blast's point
   * light can't light anything, so the flash on the floor and walls is drawn instead.
   */
  private glows: { mesh: Mesh; t: number; dur: number; size: number }[] = [];
  /** the level is unlit (lighting baked into its textures): draw the blast's light */
  unlit = false;
  private plasmaBall: Burst;
  private arcs: Burst;
  private rings: Ring[] = [];
  private flares: Flare[] = [];
  private scorches: Scorch[] = [];
  private scorchIdx = 0;
  private rubble: Rubble[] = [];
  private rubbleIdx = 0;
  private smoulders: Smoulder[] = [];
  private q = new Quaternion();
  /** floor height under a point (null = nothing within reach): set by the game from the level */
  groundAt: (x: number, y: number, z: number, maxDrop: number) => number | null = () => null;
  /** height of the drawn ground under a point, where it differs from the collision boxes (or null) */
  surfaceY?: (x: number, y: number, z: number) => number | null;
  /** a level surface on this segment? (distance or -1): used to keep decals on the surface */
  rayLevel: (from: Vector3, to: Vector3) => number = () => -1;
  readonly fires: FireArea[] = [];
  /** extra exposure added to the frame (decays) — bright flashes light up the whole view */
  exposureKick = 0;
  private fireTex: Texture;

  constructor(private scene: Scene, mats: Materials) {
    const dot = mats.particle;
    const smoke = mats.smoke;
    this.fireTex = canvasTex(scene, "fx_fire", 128, firePuff);

    const pool = (count: number, cap: number, setup: (ps: ParticleSystem) => void): Burst => {
      const ps: ParticleSystem[] = [];
      for (let i = 0; i < count; i++) {
        const p = new ParticleSystem("expl", cap, scene);
        p.emitter = new Vector3(0, -200, 0);
        p.emitRate = 0;
        p.updateSpeed = 1 / 60;
        p.minEmitBox = Vector3.Zero();
        p.maxEmitBox = Vector3.Zero();
        setup(p);
        p.start();
        ps.push(p);
      }
      return { ps, next: 0 };
    };

    // rolling fireball: big lumpy orange puffs, additive, short-lived, expand + rise
    this.fireball = pool(3, 70, (p) => {
      p.particleTexture = this.fireTex;
      p.blendMode = ParticleSystem.BLENDMODE_ADD;
      p.color1 = new Color4(1.0, 0.62, 0.22, 1);
      p.color2 = new Color4(1.0, 0.42, 0.1, 1);
      p.colorDead = new Color4(0.25, 0.06, 0.0, 0);
      p.addColorGradient(0, new Color4(1, 0.88, 0.6, 1));
      p.addColorGradient(0.08, new Color4(1, 0.62, 0.2, 1));
      p.addColorGradient(0.45, new Color4(0.85, 0.3, 0.06, 0.7));
      p.addColorGradient(0.8, new Color4(0.35, 0.1, 0.03, 0.3));
      p.addColorGradient(1, new Color4(0.1, 0.04, 0.02, 0));
      p.minSize = 1.1;
      p.maxSize = 2.3;
      p.addSizeGradient(0, 0.55);
      p.addSizeGradient(0.3, 1.25);
      p.addSizeGradient(1, 1.9);
      p.minLifeTime = 0.45;
      p.maxLifeTime = 1.0;
      p.minAngularSpeed = -2;
      p.maxAngularSpeed = 2;
      p.minInitialRotation = 0;
      p.maxInitialRotation = 6.28;
      p.gravity = new Vector3(0, 2.2, 0);
      p.addVelocityGradient(0, 1);
      p.addVelocityGradient(0.3, 0.25);
      p.addVelocityGradient(1, 0.1);
    });
    this.bigFire = pool(3, 90, (p) => {
      p.particleTexture = this.fireTex;
      p.blendMode = ParticleSystem.BLENDMODE_ADD;
      p.addColorGradient(0, new Color4(1, 0.92, 0.7, 1));
      p.addColorGradient(0.1, new Color4(1, 0.66, 0.24, 1));
      p.addColorGradient(0.5, new Color4(0.9, 0.32, 0.06, 0.75));
      p.addColorGradient(0.85, new Color4(0.35, 0.1, 0.03, 0.3));
      p.addColorGradient(1, new Color4(0.1, 0.04, 0.02, 0));
      p.minSize = 2.2;
      p.maxSize = 4.4;
      p.addSizeGradient(0, 0.5);
      p.addSizeGradient(0.3, 1.2);
      p.addSizeGradient(1, 2.0);
      p.minLifeTime = 0.7;
      p.maxLifeTime = 1.5;
      p.minAngularSpeed = -1.5;
      p.maxAngularSpeed = 1.5;
      p.minInitialRotation = 0;
      p.maxInitialRotation = 6.28;
      p.gravity = new Vector3(0, 2.8, 0);
      p.addVelocityGradient(0, 1);
      p.addVelocityGradient(0.3, 0.2);
      p.addVelocityGradient(1, 0.08);
    });
    this.light = new PointLight("blastLight", new Vector3(0, -200, 0), scene);
    this.light.diffuse = new Color3(1, 0.62, 0.3);
    this.light.specular = new Color3(1, 0.6, 0.3);
    this.light.range = 24;
    this.light.intensity = 0;
    // white-hot core flash
    this.core = pool(2, 16, (p) => {
      p.particleTexture = dot;
      p.blendMode = ParticleSystem.BLENDMODE_ADD;
      p.color1 = new Color4(1, 0.9, 0.7, 0.9);
      p.color2 = new Color4(1, 0.75, 0.45, 0.9);
      p.colorDead = new Color4(1, 0.45, 0.1, 0);
      p.minSize = 1.4;
      p.maxSize = 2.4;
      p.minLifeTime = 0.06;
      p.maxLifeTime = 0.11;
    });
    // black smoke column
    this.darkSmoke = pool(2, 70, (p) => {
      p.particleTexture = smoke;
      p.blendMode = ParticleSystem.BLENDMODE_STANDARD;
      p.color1 = new Color4(0.13, 0.12, 0.11, 0.75);
      p.color2 = new Color4(0.22, 0.2, 0.18, 0.6);
      p.colorDead = new Color4(0.35, 0.33, 0.31, 0);
      p.addColorGradient(0, new Color4(0.08, 0.07, 0.06, 0));
      p.addColorGradient(0.08, new Color4(0.12, 0.11, 0.1, 0.8));
      p.addColorGradient(0.6, new Color4(0.25, 0.24, 0.22, 0.45));
      p.addColorGradient(1, new Color4(0.42, 0.4, 0.38, 0));
      p.minSize = 1.0;
      p.maxSize = 2.2;
      p.addSizeGradient(0, 0.6);
      p.addSizeGradient(1, 3.6);
      p.minLifeTime = 2.6;
      p.maxLifeTime = 5.5;
      p.gravity = new Vector3(0.25, 0.9, 0);
      p.minAngularSpeed = -0.5;
      p.maxAngularSpeed = 0.5;
      p.minInitialRotation = 0;
      p.maxInitialRotation = 6.28;
      p.addVelocityGradient(0, 1);
      p.addVelocityGradient(0.2, 0.15);
      p.addVelocityGradient(1, 0.05);
    });
    // chunks of dirt and casing
    this.debris = pool(2, 60, (p) => {
      p.particleTexture = dot;
      p.blendMode = ParticleSystem.BLENDMODE_STANDARD;
      p.color1 = new Color4(0.12, 0.1, 0.08, 1);
      p.color2 = new Color4(0.28, 0.24, 0.2, 1);
      p.colorDead = new Color4(0.2, 0.18, 0.15, 0);
      p.minSize = 0.04;
      p.maxSize = 0.11;
      p.minLifeTime = 0.8;
      p.maxLifeTime = 1.6;
      p.gravity = new Vector3(0, -9.8, 0);
    });
    // white-hot fragments
    this.sparks = pool(2, 70, (p) => {
      p.particleTexture = dot;
      p.blendMode = ParticleSystem.BLENDMODE_ADD;
      p.color1 = new Color4(1, 0.85, 0.5, 1);
      p.color2 = new Color4(1, 0.6, 0.2, 1);
      p.colorDead = new Color4(0.6, 0.15, 0, 0);
      p.minSize = 0.02;
      p.maxSize = 0.05;
      p.minScaleY = 4;
      p.maxScaleY = 9;
      p.minLifeTime = 0.2;
      p.maxLifeTime = 0.6;
      p.gravity = new Vector3(0, -9, 0);
      p.billboardMode = ParticleSystem.BILLBOARDMODE_STRETCHED;
    });
    // dust kicked out along the ground
    this.dustRing = pool(2, 50, (p) => {
      p.particleTexture = smoke;
      p.blendMode = ParticleSystem.BLENDMODE_STANDARD;
      p.color1 = new Color4(0.55, 0.5, 0.44, 0.55);
      p.color2 = new Color4(0.45, 0.41, 0.37, 0.45);
      p.colorDead = new Color4(0.5, 0.47, 0.43, 0);
      p.minSize = 0.6;
      p.maxSize = 1.3;
      p.addSizeGradient(0, 0.5);
      p.addSizeGradient(1, 2.5);
      p.minLifeTime = 1.0;
      p.maxLifeTime = 2.2;
      p.gravity = new Vector3(0, 0.3, 0);
      p.addVelocityGradient(0, 1);
      p.addVelocityGradient(0.3, 0.12);
      p.addVelocityGradient(1, 0.02);
    });
    this.snowPlume = pool(2, 60, (p) => {
      p.particleTexture = smoke;
      p.blendMode = ParticleSystem.BLENDMODE_STANDARD;
      p.color1 = new Color4(0.9, 0.93, 0.98, 0.42);
      p.color2 = new Color4(0.78, 0.83, 0.9, 0.32);
      p.colorDead = new Color4(0.85, 0.88, 0.95, 0);
      p.minSize = 0.9;
      p.maxSize = 1.8;
      p.addSizeGradient(0, 0.5);
      p.addSizeGradient(1, 3.2);
      p.minLifeTime = 1.4;
      p.maxLifeTime = 2.8;
      p.gravity = new Vector3(0, -1.6, 0);
      p.minAngularSpeed = -0.6;
      p.maxAngularSpeed = 0.6;
    });
    // ground glow: a warm radial wash, additive, lying on the surface
    const glowTex = canvasTex(scene, "fx_groundGlow", 128, (c, n) => {
      const g = c.createRadialGradient(n / 2, n / 2, 0, n / 2, n / 2, n / 2);
      g.addColorStop(0, "rgba(255,200,130,1)");
      g.addColorStop(0.25, "rgba(255,150,70,0.7)");
      g.addColorStop(0.6, "rgba(200,90,30,0.22)");
      g.addColorStop(1, "rgba(120,40,10,0)");
      c.fillStyle = g;
      c.fillRect(0, 0, n, n);
    });
    for (let i = 0; i < 3; i++) {
      const m = MeshBuilder.CreateGround("explGlow", { width: 1, height: 1 }, scene);
      const mat = new StandardMaterial("explGlowMat" + i, scene);
      mat.disableLighting = true;
      mat.emissiveTexture = glowTex;
      mat.opacityTexture = glowTex;
      mat.alphaMode = Constants.ALPHA_ADD;
      mat.disableDepthWrite = true;
      mat.zOffset = -2;
      m.material = mat;
      m.isPickable = false;
      m.setEnabled(false);
      this.glows.push({ mesh: m, t: 0, dur: 0.5, size: 8 });
    }
    // plasma: blue-white ball and electric arcs
    this.plasmaBall = pool(1, 70, (p) => {
      p.particleTexture = this.fireTex;
      p.blendMode = ParticleSystem.BLENDMODE_ADD;
      p.addColorGradient(0, new Color4(0.85, 0.97, 1, 1));
      p.addColorGradient(0.3, new Color4(0.25, 0.75, 1, 0.9));
      p.addColorGradient(0.7, new Color4(0.35, 0.2, 0.9, 0.4));
      p.addColorGradient(1, new Color4(0.1, 0.05, 0.3, 0));
      p.minSize = 0.8;
      p.maxSize = 1.8;
      p.addSizeGradient(0, 0.4);
      p.addSizeGradient(1, 2.2);
      p.minLifeTime = 0.3;
      p.maxLifeTime = 0.7;
      p.minAngularSpeed = -3;
      p.maxAngularSpeed = 3;
      p.addVelocityGradient(0, 1);
      p.addVelocityGradient(0.4, 0.15);
    });
    this.arcs = pool(1, 80, (p) => {
      p.particleTexture = dot;
      p.blendMode = ParticleSystem.BLENDMODE_ADD;
      p.color1 = new Color4(0.7, 0.95, 1, 1);
      p.color2 = new Color4(0.35, 0.7, 1, 1);
      p.colorDead = new Color4(0.2, 0.2, 1, 0);
      p.minSize = 0.03;
      p.maxSize = 0.06;
      p.minScaleY = 6;
      p.maxScaleY = 14;
      p.minLifeTime = 0.12;
      p.maxLifeTime = 0.35;
      p.gravity = new Vector3(0, -2, 0);
      p.billboardMode = ParticleSystem.BILLBOARDMODE_STRETCHED;
    });

    // shock rings (flat, additive, expanding)
    const ringTex = canvasTex(scene, "fx_ring", 128, (c, s) => {
      const g = c.createRadialGradient(s / 2, s / 2, s * 0.3, s / 2, s / 2, s / 2);
      g.addColorStop(0, "rgba(255,255,255,0)");
      g.addColorStop(0.75, "rgba(255,255,255,0.9)");
      g.addColorStop(1, "rgba(255,255,255,0)");
      c.fillStyle = g;
      c.fillRect(0, 0, s, s);
    });
    for (let i = 0; i < 3; i++) {
      const m = MeshBuilder.CreatePlane("shockRing", { size: 2 }, scene);
      const mat = new StandardMaterial("shockRingMat" + i, scene);
      mat.disableLighting = true;
      mat.emissiveTexture = ringTex;
      mat.opacityTexture = ringTex;
      mat.alphaMode = Constants.ALPHA_COMBINE;
      mat.disableDepthWrite = true;
      mat.backFaceCulling = false;
      m.material = mat;
      m.rotation.x = Math.PI / 2;
      m.isPickable = false;
      m.setEnabled(false);
      this.rings.push({ mesh: m, t: 0, dur: 0.4, radius: 8, color: new Color3(1, 0.7, 0.4) });
    }
    // flare billboards (lights up the surroundings for a few frames)
    for (let i = 0; i < 3; i++) {
      const m = MeshBuilder.CreatePlane("explFlare", { size: 1 }, scene);
      const mat = new StandardMaterial("explFlareMat" + i, scene);
      mat.disableLighting = true;
      mat.emissiveTexture = dot;
      mat.opacityTexture = dot;
      mat.alphaMode = Constants.ALPHA_ADD;
      mat.disableDepthWrite = true;
      m.material = mat;
      m.billboardMode = Mesh.BILLBOARDMODE_ALL;
      m.isPickable = false;
      m.setEnabled(false);
      this.flares.push({ mesh: m, t: 0, dur: 0.2, size: 6 });
    }
    // scorch marks: lifted off the surface instead of a big depth offset (a large polygon offset
    // pushes the decal in front of nearby walls at grazing angles)
    const scorchTex = canvasTex(scene, "fx_scorch", 256, paintScorch);
    const scorchMat = new StandardMaterial("scorchMat", scene);
    scorchMat.diffuseTexture = scorchTex;
    scorchMat.useAlphaFromDiffuseTexture = true;
    scorchMat.specularColor = Color3.Black();
    scorchMat.zOffset = -1;
    scorchMat.backFaceCulling = true;
    for (let i = 0; i < 8; i++) {
      const m = MeshBuilder.CreatePlane("scorch", { size: 3.2 }, scene);
      m.material = scorchMat;
      m.rotationQuaternion = new Quaternion();
      m.isPickable = false;
      m.setEnabled(false);
      this.scorches.push({ mesh: m, t: 0 });
    }

    // rubble: a few lumpy low-poly rocks (instanced), concrete / dirt coloured
    const rubbleMat = new StandardMaterial("rubbleMat", scene);
    rubbleMat.diffuseColor = new Color3(0.27, 0.25, 0.23);
    rubbleMat.specularColor = new Color3(0.04, 0.04, 0.04);
    const tpls: Mesh[] = [];
    for (let k = 0; k < 4; k++) {
      const m = MeshBuilder.CreateIcoSphere("rubbleTpl" + k, { radius: 0.5, subdivisions: 1, flat: true }, scene);
      const p = m.getVerticesData("position")!;
      // squash and dent every corner so no two chunks look alike
      const sx = 0.7 + Math.random() * 0.6, sy = 0.4 + Math.random() * 0.4, sz = 0.7 + Math.random() * 0.6;
      const dents = new Map<string, number>();
      for (let i = 0; i < p.length; i += 3) {
        const key = `${p[i].toFixed(3)},${p[i + 1].toFixed(3)},${p[i + 2].toFixed(3)}`;
        let f = dents.get(key);
        if (f === undefined) dents.set(key, (f = 0.65 + Math.random() * 0.55));
        p[i] *= sx * f;
        p[i + 1] *= sy * f;
        p[i + 2] *= sz * f;
      }
      m.updateVerticesData("position", p);
      m.refreshBoundingInfo();
      m.material = rubbleMat;
      m.isPickable = false;
      m.isVisible = false;
      tpls.push(m);
    }
    for (let i = 0; i < 96; i++) {
      const m = tpls[i % tpls.length].createInstance("rubble");
      m.isPickable = false;
      m.setEnabled(false);
      m.rotationQuaternion = new Quaternion();
      this.rubble.push({ m, vel: new Vector3(), spin: new Vector3(), floorY: 0, rayX: 0, rayZ: 0, life: 0, resting: true, scale: 0.1 });
    }
    // smouldering craters: a thin column of grey smoke that keeps rising after the blast
    for (let i = 0; i < 3; i++) {
      const p = new ParticleSystem("smoulder" + i, 120, scene);
      p.particleTexture = smoke;
      p.blendMode = ParticleSystem.BLENDMODE_STANDARD;
      p.addColorGradient(0, new Color4(0.16, 0.15, 0.14, 0));
      p.addColorGradient(0.15, new Color4(0.2, 0.19, 0.18, 0.42));
      p.addColorGradient(1, new Color4(0.42, 0.41, 0.4, 0));
      p.minSize = 0.4;
      p.maxSize = 0.9;
      p.addSizeGradient(0, 0.5);
      p.addSizeGradient(1, 3.4);
      p.minLifeTime = 3;
      p.maxLifeTime = 6;
      p.minAngularSpeed = -0.4;
      p.maxAngularSpeed = 0.4;
      p.gravity = new Vector3(0.18, 0.55, 0.05);
      p.direction1 = new Vector3(-0.15, 1, -0.15);
      p.direction2 = new Vector3(0.15, 1, 0.15);
      p.minEmitPower = 0.2;
      p.maxEmitPower = 0.6;
      p.emitRate = 0;
      p.updateSpeed = 1 / 60;
      p.emitter = new Vector3(0, -200, 0);
      p.start();
      this.smoulders.push({ smoke: p, t: 0, dur: 0, rate: 0 });
    }
    // incendiary areas (2 at once)
    for (let i = 0; i < 2; i++) this.fires.push(this.makeFire(i, smoke, dot));
  }

  private makeFire(i: number, smoke: Texture, dot: Texture): FireArea {
    const scene = this.scene;
    const flames = new ParticleSystem("fireArea" + i, 520, scene);
    flames.particleTexture = this.fireTex;
    flames.blendMode = ParticleSystem.BLENDMODE_ADD;
    // additive: keep each tongue dim so hundreds of them overlapping still read as flames, not a
    // solid orange wall (standing close to a fire must not white-out the whole view)
    flames.addColorGradient(0, new Color4(0.9, 0.6, 0.25, 0));
    flames.addColorGradient(0.12, new Color4(0.85, 0.42, 0.1, 0.42));
    flames.addColorGradient(0.5, new Color4(0.7, 0.2, 0.03, 0.26));
    flames.addColorGradient(1, new Color4(0.2, 0.03, 0.0, 0));
    // tongues of flame: tall, narrow, short-lived, licking upward
    flames.minSize = 0.16;
    flames.maxSize = 0.38;
    flames.minScaleX = 0.8;
    flames.maxScaleX = 1.1;
    flames.minScaleY = 1.7;
    flames.maxScaleY = 2.6;
    flames.addSizeGradient(0, 0.5);
    flames.addSizeGradient(0.35, 1.15);
    flames.addSizeGradient(1, 0.3);
    flames.minLifeTime = 0.35;
    flames.maxLifeTime = 0.8;
    flames.emitRate = 0;
    flames.gravity = new Vector3(0, 3.2, 0);
    flames.direction1 = new Vector3(-0.2, 1, -0.2);
    flames.direction2 = new Vector3(0.2, 1.4, 0.2);
    flames.minEmitPower = 0.2;
    flames.maxEmitPower = 0.8;
    flames.minAngularSpeed = -1.5;
    flames.maxAngularSpeed = 1.5;
    flames.updateSpeed = 1 / 60;
    flames.emitter = new Vector3(0, -200, 0);
    flames.start();
    const sm = new ParticleSystem("fireSmoke" + i, 90, scene);
    sm.particleTexture = smoke;
    sm.blendMode = ParticleSystem.BLENDMODE_STANDARD;
    sm.addColorGradient(0, new Color4(0.1, 0.09, 0.08, 0));
    sm.addColorGradient(0.15, new Color4(0.1, 0.09, 0.08, 0.55));
    sm.addColorGradient(1, new Color4(0.3, 0.28, 0.26, 0));
    sm.minSize = 0.7;
    sm.maxSize = 1.5;
    sm.addSizeGradient(0, 0.5);
    sm.addSizeGradient(1, 3);
    sm.minLifeTime = 2.0;
    sm.maxLifeTime = 4.0;
    sm.emitRate = 0;
    sm.gravity = new Vector3(0.2, 1.2, 0);
    sm.direction1 = new Vector3(-0.1, 1, -0.1);
    sm.direction2 = new Vector3(0.1, 1, 0.1);
    sm.minEmitPower = 0.3;
    sm.maxEmitPower = 0.7;
    sm.updateSpeed = 1 / 60;
    sm.emitter = new Vector3(0, -200, 0);
    sm.start();
    const em = new ParticleSystem("fireEmbers" + i, 80, scene);
    em.particleTexture = dot;
    em.blendMode = ParticleSystem.BLENDMODE_ADD;
    em.color1 = new Color4(1, 0.7, 0.3, 1);
    em.color2 = new Color4(1, 0.5, 0.15, 1);
    em.colorDead = new Color4(0.5, 0.1, 0, 0);
    em.minSize = 0.02;
    em.maxSize = 0.05;
    em.minLifeTime = 0.8;
    em.maxLifeTime = 1.8;
    em.emitRate = 0;
    em.gravity = new Vector3(0.3, 1.5, 0);
    em.direction1 = new Vector3(-0.6, 1, -0.6);
    em.direction2 = new Vector3(0.6, 2, 0.6);
    em.minEmitPower = 0.5;
    em.maxEmitPower = 1.6;
    em.updateSpeed = 1 / 60;
    em.emitter = new Vector3(0, -200, 0);
    em.start();
    return { pos: new Vector3(), radius: 3.6, t: 0, dur: 7, flames, smoke: sm, embers: em, active: false };
  }

  private emit(b: Burst, pos: Vector3, count: number, dir1: Vector3, dir2: Vector3, pmin: number, pmax: number, box = 0) {
    const ps = b.ps[b.next];
    b.next = (b.next + 1) % b.ps.length;
    (ps.emitter as Vector3).copyFrom(pos);
    ps.minEmitBox.setAll(-box);
    ps.maxEmitBox.setAll(box);
    ps.direction1.copyFrom(dir1);
    ps.direction2.copyFrom(dir2);
    ps.minEmitPower = pmin;
    ps.maxEmitPower = pmax;
    ps.manualEmitCount = count;
  }

  private ring(pos: Vector3, radius: number, dur: number, color: Color3) {
    const r = this.rings.find((x) => x.t <= 0) ?? this.rings[0];
    r.mesh.position.copyFrom(pos);
    r.mesh.position.y += 0.08;
    r.t = r.dur = dur;
    r.radius = radius;
    r.color.copyFrom(color);
    (r.mesh.material as StandardMaterial).emissiveColor.copyFrom(color);
    r.mesh.setEnabled(true);
  }
  private flare(pos: Vector3, size: number, dur: number, color: Color3) {
    const f = this.flares.find((x) => x.t <= 0) ?? this.flares[0];
    f.mesh.position.copyFrom(pos);
    f.t = f.dur = dur;
    f.size = size;
    (f.mesh.material as StandardMaterial).emissiveColor.copyFrom(color);
    f.mesh.setEnabled(true);
  }
  /**
   * Blast mark on the surface hit (floor or wall). The four corners are tested against the level so
   * the mark shrinks rather than hanging off a ledge, a kerb or the end of a wall.
   */
  scorch(pos: Vector3, normal: Vector3, size = 1) {
    const n = normal.clone().normalize();
    const up = Math.abs(n.y) > 0.9 ? Vector3.Forward() : Vector3.Up();
    const t1 = Vector3.Cross(n, up).normalize();
    const t2 = Vector3.Cross(n, t1).normalize();
    let half = 1.6 * size;
    const a = new Vector3(), b = new Vector3();
    for (let tries = 0; tries < 3; tries++) {
      let ok = true;
      for (const [u, v] of [[0.7, 0.7], [-0.7, 0.7], [0.7, -0.7], [-0.7, -0.7]]) {
        a.copyFrom(pos).addInPlace(t1.scale(u * half)).addInPlace(t2.scale(v * half)).addInPlace(n.scale(0.35));
        if (n.y > 0.9 && this.surfaceY) {
          // floors on a map whose drawn ground isn't the collision ground: test the drawn one
          const y = this.surfaceY(a.x, a.y, a.z);
          if (y === null || Math.abs(y - pos.y) > 0.25) {
            ok = false;
            break;
          }
          continue;
        }
        b.copyFrom(a).addInPlace(n.scale(-0.7));
        const d = this.rayLevel(a, b);
        if (d < 0 || Math.abs(d - 0.35) > 0.18) {
          ok = false;
          break;
        }
      }
      if (ok) break;
      half *= 0.62;
    }
    if (half < 0.35) return;
    const s = this.scorches[this.scorchIdx];
    this.scorchIdx = (this.scorchIdx + 1) % this.scorches.length;
    s.mesh.position.copyFrom(pos).addInPlace(n.scale(0.03));
    // plane faces -Z → align -Z with -normal
    lookRotation(n.scale(-1), up, s.mesh.rotationQuaternion!);
    s.mesh.scaling.setAll((half / 1.6) * (0.9 + Math.random() * 0.2));
    s.mesh.rotationQuaternion!.multiplyInPlace(Quaternion.RotationAxis(Vector3.Forward(), Math.random() * 6.28));
    s.mesh.visibility = 1;
    s.t = 60;
    s.mesh.setEnabled(true);
  }

  /** throw `count` chunks of rubble out of a blast on a surface with normal `n` */
  private throwRubble(pos: Vector3, n: Vector3, count: number, power: number) {
    for (let i = 0; i < count; i++) {
      const r = this.rubble[this.rubbleIdx];
      this.rubbleIdx = (this.rubbleIdx + 1) % this.rubble.length;
      const ang = Math.random() * Math.PI * 2;
      const out = 0.4 + Math.random() * 0.9;
      r.m.position.set(pos.x + Math.cos(ang) * 0.25, pos.y + 0.1, pos.z + Math.sin(ang) * 0.25).addInPlace(n.scale(0.15));
      const sp = power * (0.35 + Math.random() * 0.75);
      r.vel.set(Math.cos(ang) * out + n.x * 1.2, 0.6 + Math.random() * 1.1 + Math.max(0, n.y) * 0.4, Math.sin(ang) * out + n.z * 1.2).normalize().scaleInPlace(sp);
      r.spin.set((Math.random() - 0.5) * 18, (Math.random() - 0.5) * 18, (Math.random() - 0.5) * 18);
      // mostly small grit, a few fist-sized chunks
      r.scale = Math.random() < 0.15 ? 0.1 + Math.random() * 0.08 : 0.025 + Math.random() * 0.06;
      r.m.scaling.setAll(r.scale);
      Quaternion.RotationYawPitchRollToRef(Math.random() * 6.3, Math.random() * 6.3, Math.random() * 6.3, r.m.rotationQuaternion!);
      this.measureFloor(r);
      r.life = 0;
      r.resting = false;
      r.m.setEnabled(true);
    }
  }
  private measureFloor(r: Rubble) {
    const p = r.m.position;
    const f = this.groundAt(p.x, p.y + 0.3, p.z, 12);
    r.floorY = f ?? -1e9;
    r.rayX = p.x;
    r.rayZ = p.z;
  }

  private smoulder(pos: Vector3, dur: number, rate: number) {
    const s = this.smoulders.find((x) => x.t >= x.dur) ?? this.smoulders[0];
    (s.smoke.emitter as Vector3).copyFrom(pos);
    s.smoke.minEmitBox.set(-0.5, 0, -0.5);
    s.smoke.maxEmitBox.set(0.5, 0.1, 0.5);
    s.t = 0;
    s.dur = dur;
    s.rate = rate;
  }

  private v = (x: number, y: number, z: number) => new Vector3(x, y, z);

  /** the blast lights the ground round it (drawn: only on unlit maps, where the point light can't) */
  private groundGlow(pos: Vector3, size: number, dur: number) {
    if (!this.unlit) return;
    const g = this.glows.find((x) => x.t <= 0) ?? this.glows[0];
    g.mesh.position.set(pos.x, pos.y + 0.04, pos.z);
    g.t = g.dur = dur;
    g.size = size;
    g.mesh.setEnabled(true);
  }

  frag(pos: Vector3, snow = false) {
    const v = this.v;
    this.emit(this.core, pos, 3, v(0, 0, 0), v(0, 0, 0), 0, 0);
    // dense core of the fireball + the lobes that roll outward
    this.emit(this.fireball, pos, 30, v(-1, 0, -1), v(1, 1.6, 1), 0.2, 2.2, 0.45);
    this.emit(this.fireball, pos, 26, v(-1, 0, -1), v(1, 1.2, 1), 2.5, 6, 0.3);
    this.emit(this.darkSmoke, pos, 28, v(-0.8, 0.4, -0.8), v(0.8, 1.6, 0.8), 1.5, 4.5, 0.4);
    this.emit(this.debris, pos, 50, v(-1, 0.5, -1), v(1, 2.2, 1), 4, 11, 0.15);
    this.emit(this.sparks, pos, 60, v(-1, -0.1, -1), v(1, 1.3, 1), 10, 26, 0.1);
    if (snow) {
      // on snow: a burst of powder thrown up and out, falling back
      this.emit(this.snowPlume, v(pos.x, pos.y + 0.2, pos.z), 40, v(-1, 0.3, -1), v(1, 1.2, 1), 1.2, 3.6, 0.5);
      this.emit(this.dustRing, v(pos.x, pos.y + 0.15, pos.z), 14, v(-1, 0, -1), v(1, 0.15, 1), 6, 11, 0.2);
    } else this.emit(this.dustRing, v(pos.x, pos.y + 0.15, pos.z), 30, v(-1, 0, -1), v(1, 0.15, 1), 6, 11, 0.2);
    this.ring(pos, 4.5, 0.3, new Color3(0.55, 0.5, 0.44));
    this.flare(pos, this.unlit ? 7 : 5.5, this.unlit ? 0.18 : 0.12, new Color3(1, 0.62, 0.3));
    this.groundGlow(pos, 9, 0.45);
    this.exposureKick = Math.max(this.exposureKick, 0.9);
    this.throwRubble(pos, Vector3.UpReadOnly, 12, 7);
    this.smoulder(pos, 9, 9);
  }

  /** flash the blast light: peak intensity, seconds */
  private lightFlash(pos: Vector3, peak: number, dur: number, color = new Color3(1, 0.62, 0.3)) {
    if (peak < this.lightPeak * (1 - this.lightT / this.lightDur)) return;
    this.light.position.copyFrom(pos);
    this.light.diffuse.copyFrom(color);
    this.lightPeak = peak;
    this.lightDur = dur;
    this.lightT = 0;
  }

  /** rocket warhead: a big rolling fireball, shock ring, flung debris along the surface normal, a smoke column, burning scraps */
  rocket(pos: Vector3, normal: Vector3, snow = false) {
    const v = this.v;
    const n = normal;
    this.emit(this.core, pos, 5, v(0, 0, 0), v(0, 0, 0), 0, 0);
    this.emit(this.bigFire, pos, 42, v(-1 + n.x, -0.2 + n.y * 0.6, -1 + n.z), v(1 + n.x, 1.6 + n.y * 0.6, 1 + n.z), 0.5, 3.5, 0.5);
    this.emit(this.fireball, pos, 40, v(-1, 0, -1), v(1, 1.3, 1), 3, 9, 0.4);
    this.emit(this.darkSmoke, pos, 60, v(-1, 0.4, -1), v(1, 2.0, 1), 2, 6, 0.8);
    this.emit(this.debris, pos, 60, v(-1 + n.x * 1.5, 0.3 + n.y, -1 + n.z * 1.5), v(1 + n.x * 1.5, 2.6 + n.y, 1 + n.z * 1.5), 6, 15, 0.2);
    this.emit(this.sparks, pos, 70, v(-1, -0.1, -1), v(1, 1.4, 1), 14, 34, 0.15);
    this.emit(this.dustRing, v(pos.x, pos.y + 0.15, pos.z), snow ? 20 : 50, v(-1, 0, -1), v(1, 0.2, 1), 8, 15, 0.3);
    if (snow) this.emit(this.snowPlume, v(pos.x, pos.y + 0.2, pos.z), 60, v(-1 + n.x, 0.3, -1 + n.z), v(1 + n.x, 1.4, 1 + n.z), 1.8, 5, 0.7);
    this.ring(pos, 8, 0.4, new Color3(0.6, 0.55, 0.48));
    this.flare(pos, this.unlit ? 13 : 10, this.unlit ? 0.28 : 0.2, new Color3(1, 0.66, 0.32));
    this.groundGlow(pos.add(n.scale(0.1)), 16, 0.7);
    this.lightFlash(pos.add(n.scale(0.8)), 140, 0.6);
    this.exposureKick = Math.max(this.exposureKick, 1.1);
    this.throwRubble(pos, n, 26, 10);
    this.smoulder(pos, 16, 14);
  }

  /** a giant landing or pounding the ground: no fire — a dust wave rolling out, a shock ring, rubble thrown up */
  slam(pos: Vector3, power = 1) {
    const v = this.v;
    this.emit(this.dustRing, v(pos.x, pos.y + 0.15, pos.z), Math.round(60 * power), v(-1, 0, -1), v(1, 0.25, 1), 6 * power, 13 * power, 0.4);
    this.emit(this.darkSmoke, pos, Math.round(24 * power), v(-1, 0.1, -1), v(1, 0.9, 1), 1.2, 3.5 * power, 0.7);
    this.emit(this.debris, pos, Math.round(45 * power), v(-1, 0.8, -1), v(1, 2.4, 1), 3, 9 * power, 0.35);
    this.ring(pos, 7 * power, 0.35, new Color3(0.62, 0.55, 0.45));
    this.throwRubble(pos, Vector3.UpReadOnly, Math.round(16 * power), 7);
  }

  /**
   * A thunderclap: a shock ring where the hands met, and a wall of dust thrown forward along `dir`
   * (off the ground in front of him), widening as it goes.
   */
  clapBlast(pos: Vector3, dir: Vector3, groundY: number) {
    const v = this.v;
    this.ring(pos, 5, 0.25, new Color3(0.85, 0.82, 0.75));
    this.flare(pos, 4, 0.08, new Color3(1, 0.95, 0.85));
    for (let i = 1; i <= 5; i++) {
      const at = v(pos.x + dir.x * i * 2.2, groundY + 0.2, pos.z + dir.z * i * 2.2);
      this.emit(this.dustRing, at, 14, v(dir.x * 2 - 0.6, 0.05, dir.z * 2 - 0.6), v(dir.x * 2 + 0.6, 0.35, dir.z * 2 + 0.6), 6, 12, 0.5 + i * 0.25);
    }
    this.emit(this.darkSmoke, v(pos.x, groundY + 0.6, pos.z), 16, v(dir.x - 0.5, 0.1, dir.z - 0.5), v(dir.x + 0.5, 0.6, dir.z + 0.5), 3, 8, 0.6);
    this.exposureKick = Math.max(this.exposureKick, 0.4);
  }

  /** launch: a short hot flash at the muzzle that lights the arms and the room */
  launchFlash(pos: Vector3) {
    this.lightFlash(pos, 40, 0.16, new Color3(1, 0.75, 0.45));
  }

  /** an energy blast (Iron Man's repulsors, the unibeam's end): a cyan flare, a ring, a spray of sparks */
  energy(pos: Vector3, power = 1) {
    const v = this.v;
    this.emit(this.arcs, pos, Math.round(16 + 20 * power), v(-1, -0.5, -1), v(1, 1.5, 1), 4 * power, 11 * power, 0.06);
    this.ring(pos, 1.6 + 2.2 * power, 0.28, new Color3(0.45, 0.85, 1));
    this.flare(pos, 1.4 + 2 * power, 0.12, new Color3(0.65, 0.9, 1));
    this.lightFlash(pos, 10 + 14 * power, 0.12, new Color3(0.55, 0.85, 1));
  }

  plasma(pos: Vector3) {
    const v = this.v;
    this.emit(this.core, pos, 3, v(0, 0, 0), v(0, 0, 0), 0, 0);
    this.emit(this.plasmaBall, pos, 40, v(-1, -0.6, -1), v(1, 1.2, 1), 2, 6, 0.2);
    this.emit(this.arcs, pos, 70, v(-1, -0.5, -1), v(1, 1.5, 1), 8, 20, 0.1);
    this.emit(this.darkSmoke, pos, 10, v(-0.6, 0.4, -0.6), v(0.6, 1.2, 0.6), 1, 2.5, 0.3);
    this.ring(pos, 6, 0.45, new Color3(0.35, 0.8, 1));
    this.flare(pos, 6, 0.18, new Color3(0.5, 0.82, 1));
    this.exposureKick = Math.max(this.exposureKick, 0.8);
  }

  /** incendiary burst + a burning area */
  ignite(pos: Vector3, radius: number, dur: number): FireArea {
    const v = this.v;
    this.emit(this.fireball, pos, 26, v(-1, 0, -1), v(1, 1.6, 1), 2, 5.5, 0.3);
    this.emit(this.sparks, pos, 40, v(-1, 0.2, -1), v(1, 1.5, 1), 4, 10, 0.1);
    this.flare(pos, 4.5, 0.18, new Color3(1, 0.5, 0.15));
    this.exposureKick = Math.max(this.exposureKick, 0.45);
    const f = this.fires.find((x) => !x.active) ?? this.fires[0];
    f.sound?.stop(0.3);
    f.pos.copyFrom(pos);
    f.radius = radius;
    f.t = 0;
    f.dur = dur;
    f.active = true;
    for (const ps of [f.flames, f.smoke, f.embers]) {
      (ps.emitter as Vector3).copyFrom(pos);
      ps.minEmitBox.set(-radius * 0.6, 0, -radius * 0.6);
      ps.maxEmitBox.set(radius * 0.6, 0.1, radius * 0.6);
    }
    return f;
  }

  update(dt: number) {
    if (this.lightPeak > 0) {
      this.lightT += dt;
      const k = Math.max(0, 1 - this.lightT / this.lightDur);
      this.light.intensity = this.lightPeak * k * k;
      if (k <= 0) this.lightPeak = 0;
    }
    for (const r of this.rings) {
      if (r.t <= 0) continue;
      r.t -= dt;
      const k = 1 - Math.max(0, r.t) / r.dur;
      const e = 1 - (1 - k) * (1 - k);
      r.mesh.scaling.setAll(0.2 + r.radius * e);
      r.mesh.visibility = (1 - k) * 0.22;
      if (r.t <= 0) r.mesh.setEnabled(false);
    }
    for (const g of this.glows) {
      if (g.t <= 0) continue;
      g.t -= dt;
      const k = Math.max(0, g.t) / g.dur;
      g.mesh.scaling.set(g.size * (0.75 + 0.25 * k), 1, g.size * (0.75 + 0.25 * k));
      g.mesh.visibility = k * k;
      if (g.t <= 0) g.mesh.setEnabled(false);
    }
    for (const f of this.flares) {
      if (f.t <= 0) continue;
      f.t -= dt;
      const k = Math.max(0, f.t) / f.dur;
      f.mesh.scaling.setAll(f.size * (0.6 + 0.4 * k));
      f.mesh.visibility = k;
      if (f.t <= 0) f.mesh.setEnabled(false);
    }
    for (const s of this.scorches) {
      if (s.t <= 0) continue;
      s.t -= dt;
      s.mesh.visibility = Math.min(1, s.t / 6);
      if (s.t <= 0) s.mesh.setEnabled(false);
    }
    for (const s of this.smoulders) {
      if (s.t >= s.dur) {
        s.smoke.emitRate = 0;
        continue;
      }
      s.t += dt;
      // thick at first, thinning out
      const k = 1 - s.t / s.dur;
      s.smoke.emitRate = s.rate * (0.25 + 0.75 * k * k);
    }
    this.updateRubble(dt);
    for (const f of this.fires) {
      if (!f.active) {
        f.flames.emitRate = f.smoke.emitRate = f.embers.emitRate = 0;
        continue;
      }
      f.t += dt;
      // flare up, burn, die down
      const k = f.t < 0.4 ? f.t / 0.4 : f.t > f.dur - 1.5 ? Math.max(0, (f.dur - f.t) / 1.5) : 1;
      const area = f.radius * f.radius;
      f.flames.emitRate = 16 * area * k;
      f.smoke.emitRate = 2.2 * area * k;
      f.embers.emitRate = 2 * area * k;
      if (f.t >= f.dur) {
        f.active = false;
        f.sound?.stop(0.6);
        f.sound = undefined;
      }
    }
    this.exposureKick = Math.max(0, this.exposureKick - dt * 5);
  }

  private updateRubble(dt: number) {
    for (const r of this.rubble) {
      if (!r.m.isEnabled()) continue;
      r.life += dt;
      if (!r.resting) {
        r.vel.y -= 9.8 * dt;
        const p = r.m.position;
        p.addInPlaceFromFloats(r.vel.x * dt, r.vel.y * dt, r.vel.z * dt);
        Quaternion.RotationYawPitchRollToRef(r.spin.y * dt, r.spin.x * dt, r.spin.z * dt, this.q);
        r.m.rotationQuaternion!.multiplyInPlace(this.q);
        // flew off past an edge: find the floor where it is now
        if (Math.abs(p.x - r.rayX) + Math.abs(p.z - r.rayZ) > 0.6) this.measureFloor(r);
        const floor = r.floorY + r.scale * 0.3;
        if (p.y <= floor && r.vel.y < 0) {
          p.y = floor;
          if (Math.abs(r.vel.y) > 1.5) {
            r.vel.y = -r.vel.y * 0.3;
            r.vel.x *= 0.55;
            r.vel.z *= 0.55;
            r.spin.scaleInPlace(0.5);
          } else {
            r.resting = true;
          }
        }
        // nothing underneath (off the map): drop it rather than leave it hanging
        if (r.floorY < -1e8 && r.life > 3) r.m.setEnabled(false);
        else if (r.life > 8) {
          p.y = Math.max(r.floorY + r.scale * 0.3, Math.min(p.y, r.floorY + r.scale * 0.3));
          r.resting = true;
        }
      }
      // the area stays wrecked for a good while, then the bits sink away
      if (r.life > 50) {
        const k = Math.max(0, 1 - (r.life - 50) / 3);
        r.m.scaling.setAll(r.scale * k);
        if (k <= 0) r.m.setEnabled(false);
      }
    }
  }

  warmup(at: Vector3) {
    this.frag(at);
    this.rocket(at, Vector3.Up());
    this.plasma(at);
    const f = this.ignite(at, 1, 0.1);
    f.active = false;
    this.exposureKick = 0;
  }

  reset() {
    this.lightPeak = 0;
    this.light.intensity = 0;
    for (const b of [this.fireball, this.bigFire, this.core, this.darkSmoke, this.debris, this.sparks, this.dustRing, this.plasmaBall, this.arcs]) for (const ps of b.ps) ps.reset();
    for (const r of this.rings) (r.t = 0), r.mesh.setEnabled(false);
    for (const f of this.flares) (f.t = 0), f.mesh.setEnabled(false);
    for (const g of this.glows) (g.t = 0), g.mesh.setEnabled(false);
    for (const s of this.scorches) (s.t = 0), s.mesh.setEnabled(false);
    for (const r of this.rubble) r.m.setEnabled(false);
    for (const s of this.smoulders) {
      s.t = s.dur = 0;
      s.smoke.emitRate = 0;
      s.smoke.reset();
    }
    for (const f of this.fires) {
      f.active = false;
      f.sound?.stop(0);
      f.sound = undefined;
      f.flames.reset();
      f.smoke.reset();
      f.embers.reset();
    }
    this.exposureKick = 0;
  }
}
