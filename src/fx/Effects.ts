import { Color3, Color4 } from "@babylonjs/core/Maths/math.color";
import { Constants } from "@babylonjs/core/Engines/constants";
import { InstancedMesh } from "@babylonjs/core/Meshes/instancedMesh";
import { Mesh } from "@babylonjs/core/Meshes/mesh";
import { MeshBuilder } from "@babylonjs/core/Meshes/meshBuilder";
import { ParticleSystem } from "@babylonjs/core/Particles/particleSystem";
import { Matrix, Quaternion, Vector3 } from "@babylonjs/core/Maths/math.vector";
import { Ray } from "@babylonjs/core/Culling/ray";
import { Scene } from "@babylonjs/core/scene";
import { StandardMaterial } from "@babylonjs/core/Materials/standardMaterial";
import { PBRMaterial } from "@babylonjs/core/Materials/PBR/pbrMaterial";
import type { Texture } from "@babylonjs/core/Materials/Textures/texture";
import { TransformNode } from "@babylonjs/core/Meshes/transformNode";
import { DynamicTexture } from "@babylonjs/core/Materials/Textures/dynamicTexture";
import { HitKind, RENDER, SurfaceType } from "../config/game";
import { lookRotation, rand } from "../core/math";
import { AudioEngine } from "../audio/AudioEngine";
import { Materials } from "../render/Materials";
import { getBrass, getShellHull } from "../weapons/WeaponModels";

/**
 * All transient visual effects, fully pooled and pre-warmed. Nothing in here
 * allocates GPU resources after loading: firing only toggles, moves and
 * re-emits existing objects.
 */

class BurstPool {
  private systems: ParticleSystem[] = [];
  private next = 0;
  constructor(
    scene: Scene,
    count: number,
    capacity: number,
    setup: (ps: ParticleSystem) => void,
  ) {
    for (let i = 0; i < count; i++) {
      const ps = new ParticleSystem("burst", capacity, scene);
      ps.emitter = new Vector3(0, -100, 0);
      ps.emitRate = 0;
      ps.minEmitBox = Vector3.Zero();
      ps.maxEmitBox = Vector3.Zero();
      ps.updateSpeed = 1 / 60;
      ps.isLocal = false;
      setup(ps);
      ps.start();
      this.systems.push(ps);
    }
  }
  emit(pos: Vector3, dir: Vector3, count: number, spread: number, speedMin: number, speedMax: number) {
    const ps = this.systems[this.next];
    this.next = (this.next + 1) % this.systems.length;
    (ps.emitter as Vector3).copyFrom(pos);
    ps.direction1.set(dir.x - spread, dir.y - spread, dir.z - spread);
    ps.direction2.set(dir.x + spread, dir.y + spread, dir.z + spread);
    ps.minEmitPower = speedMin;
    ps.maxEmitPower = speedMax;
    ps.manualEmitCount = count;
  }
  reset() {
    for (const ps of this.systems) ps.reset();
  }
  get active() {
    let n = 0;
    for (const ps of this.systems) n += ps.getActiveCount();
    return n;
  }
}

interface Casing {
  inst: InstancedMesh;
  vel: Vector3;
  spin: Vector3;
  life: number;
  floorY: number;
  bounced: number;
  shell: boolean;
}

interface Tracer {
  inst: InstancedMesh;
  life: number;
}

export interface MuzzleFlash {
  node: TransformNode;
  front: Mesh;
  sides: Mesh[];
  timer: number;
  duration: number;
  scale: number;
  length: number;
}

export class Effects {
  private sparks: BurstPool;
  private dust: BurstPool;
  private chips: BurstPool;
  private blood: BurstPool;
  /** ballistic blood droplets (stretched along their motion, fall with gravity) */
  private drops: BurstPool;
  /** heavier dark clots (headshots, close range) */
  private clots: BurstPool;
  private smoke: BurstPool;
  private bigSmoke: BurstPool;
  private casings: Casing[] = [];
  private casingIdx = 0;
  private shells: Casing[] = [];
  private shellIdx = 0;
  private decals: InstancedMesh[] = [];
  /** blood splatter on walls / floors behind and under a hit soldier (three painted variants) */
  private bloodDecals: InstancedMesh[] = [];
  private bloodIdx = 0;
  /** small drip marks where droplets land */
  private dripDecals: InstancedMesh[] = [];
  private dripIdx = 0;
  /** pools spreading under bodies */
  private pools: { m: InstancedMesh; t: number; size: number }[] = [];
  private poolIdx = 0;
  private decalIdx = 0;
  private tracers: Tracer[] = [];
  private tracerIdx = 0;
  private flashes: MuzzleFlash[] = [];
  private ray = new Ray(Vector3.Zero(), new Vector3(0, -1, 0), 4);
  private tmp = new Vector3();
  private tmp2 = new Vector3();
  private q = new Quaternion();
  private mtx = new Matrix();

  /**
   * `litWorld`: the level is lit by the scene's lights (Red Dune) rather than baked (Frostline). Its
   * decals are then lit exactly like its walls (same physically based material, shadows included),
   * so blood and bullet holes are never brighter than the wall they're on — not in the sun, and not
   * in a dark building where the wall is in shadow.
   */
  constructor(private scene: Scene, private mats: Materials, private audio: AudioEngine, private litWorld = false) {
    const particle = mats.particle;
    const smokeTex = mats.smoke;
    // a cloud of fine droplets (white, tinted per particle): blood mist reads as spray, not a ball
    const speckle = new DynamicTexture("bloodSpeckle", { width: 128, height: 128 }, scene, true);
    {
      const g = speckle.getContext() as unknown as CanvasRenderingContext2D;
      g.clearRect(0, 0, 128, 128);
      let sd = 77;
      const rnd = () => ((sd = (sd * 16807) % 2147483647) / 2147483647);
      for (let i = 0; i < 220; i++) {
        const a = rnd() * Math.PI * 2;
        const d = Math.pow(rnd(), 0.8) * 58;
        g.fillStyle = `rgba(255,255,255,${0.5 + rnd() * 0.5})`;
        g.beginPath();
        g.arc(64 + Math.cos(a) * d, 64 + Math.sin(a) * d, 0.5 + rnd() * 2.2 * (1 - d / 64), 0, Math.PI * 2);
        g.fill();
      }
      speckle.update();
      speckle.hasAlpha = true;
    }

    this.sparks = new BurstPool(scene, 6, 24, (ps) => {
      ps.particleTexture = particle;
      ps.color1 = new Color4(1, 0.85, 0.55, 1);
      ps.color2 = new Color4(1, 0.55, 0.2, 1);
      ps.colorDead = new Color4(0.6, 0.15, 0.0, 0);
      ps.minSize = 0.012;
      ps.maxSize = 0.03;
      ps.minLifeTime = 0.08;
      ps.maxLifeTime = 0.25;
      ps.gravity = new Vector3(0, -12, 0);
      ps.blendMode = ParticleSystem.BLENDMODE_ADD;
      ps.minScaleX = 1;
      ps.maxScaleX = 1;
      ps.minScaleY = 3;
      ps.maxScaleY = 5;
      ps.isBillboardBased = true;
      ps.billboardMode = ParticleSystem.BILLBOARDMODE_STRETCHED;
    });
    this.dust = new BurstPool(scene, 8, 16, (ps) => {
      ps.particleTexture = smokeTex;
      ps.color1 = new Color4(0.62, 0.58, 0.52, 0.55);
      ps.color2 = new Color4(0.5, 0.47, 0.43, 0.4);
      ps.colorDead = new Color4(0.5, 0.48, 0.45, 0);
      ps.minSize = 0.12;
      ps.maxSize = 0.35;
      ps.minLifeTime = 0.35;
      ps.maxLifeTime = 0.9;
      ps.gravity = new Vector3(0, -0.4, 0);
      ps.minAngularSpeed = -2;
      ps.maxAngularSpeed = 2;
      ps.blendMode = ParticleSystem.BLENDMODE_STANDARD;
      ps.addSizeGradient(0, 0.4);
      ps.addSizeGradient(1, 1.6);
    });
    this.chips = new BurstPool(scene, 6, 12, (ps) => {
      ps.particleTexture = particle;
      ps.color1 = new Color4(0.25, 0.24, 0.22, 1);
      ps.color2 = new Color4(0.4, 0.38, 0.35, 1);
      ps.colorDead = new Color4(0.3, 0.3, 0.3, 0);
      ps.minSize = 0.015;
      ps.maxSize = 0.035;
      ps.minLifeTime = 0.3;
      ps.maxLifeTime = 0.6;
      ps.gravity = new Vector3(0, -9.8, 0);
      ps.blendMode = ParticleSystem.BLENDMODE_STANDARD;
    });
    // mist: a fast-expanding dark-red aerosol puff that hangs for a moment
    this.blood = new BurstPool(scene, 8, 24, (ps) => {
      ps.particleTexture = speckle;
      ps.color1 = new Color4(0.3, 0.02, 0.02, 0.85);
      ps.color2 = new Color4(0.2, 0.01, 0.01, 0.7);
      ps.colorDead = new Color4(0.12, 0.0, 0.0, 0);
      ps.minSize = 0.1;
      ps.maxSize = 0.24;
      ps.minLifeTime = 0.18;
      ps.maxLifeTime = 0.4;
      ps.minInitialRotation = 0;
      ps.maxInitialRotation = 6.28;
      ps.gravity = new Vector3(0, -1.2, 0);
      ps.minAngularSpeed = -2;
      ps.maxAngularSpeed = 2;
      ps.blendMode = ParticleSystem.BLENDMODE_STANDARD;
      ps.addSizeGradient(0, 0.4);
      ps.addSizeGradient(0.25, 1.4);
      ps.addSizeGradient(1, 2.4);
      ps.addVelocityGradient(0, 1);
      ps.addVelocityGradient(0.3, 0.15);
    });
    this.drops = new BurstPool(scene, 8, 48, (ps) => {
      ps.particleTexture = particle;
      ps.color1 = new Color4(0.3, 0.015, 0.015, 1);
      ps.color2 = new Color4(0.2, 0.01, 0.01, 1);
      ps.colorDead = new Color4(0.15, 0.0, 0.0, 0.6);
      ps.minSize = 0.012;
      ps.maxSize = 0.03;
      ps.minScaleY = 1.5;
      ps.maxScaleY = 4;
      ps.minLifeTime = 0.45;
      ps.maxLifeTime = 0.95;
      ps.gravity = new Vector3(0, -9.8, 0);
      ps.blendMode = ParticleSystem.BLENDMODE_STANDARD;
      ps.billboardMode = ParticleSystem.BILLBOARDMODE_STRETCHED;
    });
    this.clots = new BurstPool(scene, 4, 12, (ps) => {
      ps.particleTexture = particle;
      ps.color1 = new Color4(0.28, 0.01, 0.01, 1);
      ps.color2 = new Color4(0.2, 0.0, 0.0, 1);
      ps.colorDead = new Color4(0.15, 0.0, 0.0, 0.8);
      ps.minSize = 0.03;
      ps.maxSize = 0.06;
      ps.minLifeTime = 0.6;
      ps.maxLifeTime = 1.0;
      ps.minAngularSpeed = -6;
      ps.maxAngularSpeed = 6;
      ps.gravity = new Vector3(0, -9.8, 0);
      ps.blendMode = ParticleSystem.BLENDMODE_STANDARD;
    });
    this.smoke = new BurstPool(scene, 4, 14, (ps) => {
      ps.particleTexture = smokeTex;
      ps.color1 = new Color4(0.75, 0.74, 0.72, 0.13);
      ps.color2 = new Color4(0.65, 0.65, 0.63, 0.09);
      ps.colorDead = new Color4(0.7, 0.7, 0.7, 0);
      ps.minSize = 0.03;
      ps.maxSize = 0.07;
      ps.minLifeTime = 0.5;
      ps.maxLifeTime = 1.1;
      ps.gravity = new Vector3(0, 0.35, 0);
      ps.minAngularSpeed = -1;
      ps.maxAngularSpeed = 1;
      ps.blendMode = ParticleSystem.BLENDMODE_STANDARD;
      ps.addSizeGradient(0, 0.6);
      ps.addSizeGradient(1, 2.6);
    });

    this.bigSmoke = new BurstPool(scene, 2, 48, (ps) => {
      ps.particleTexture = smokeTex;
      ps.color1 = new Color4(0.82, 0.82, 0.8, 0.5);
      ps.color2 = new Color4(0.7, 0.7, 0.68, 0.38);
      ps.colorDead = new Color4(0.72, 0.72, 0.7, 0);
      ps.minSize = 0.35;
      ps.maxSize = 0.8;
      ps.minLifeTime = 1.6;
      ps.maxLifeTime = 3.2;
      ps.gravity = new Vector3(0, 0.25, 0);
      ps.minAngularSpeed = -0.8;
      ps.maxAngularSpeed = 0.8;
      ps.blendMode = ParticleSystem.BLENDMODE_STANDARD;
      ps.addSizeGradient(0, 0.4);
      ps.addSizeGradient(1, 3.2);
      ps.addVelocityGradient(0, 1);
      ps.addVelocityGradient(1, 0.05);
    });

    // ---- casings (instanced, max 28 rifle + 8 shotgun)
    const brassSrc = MeshBuilder.CreateCylinder("casingSrc", { diameter: 0.0095, height: 0.034, tessellation: 8 }, scene);
    brassSrc.material = getBrass(scene, mats);
    brassSrc.isPickable = false;
    brassSrc.setEnabled(true);
    brassSrc.isVisible = false;
    for (let i = 0; i < 28; i++) this.casings.push(this.makeCasing(brassSrc, false));
    const shellSrc = MeshBuilder.CreateCylinder("shellSrc", { diameter: 0.02, height: 0.065, tessellation: 8 }, scene);
    shellSrc.material = getShellHull(scene, mats);
    shellSrc.isPickable = false;
    shellSrc.isVisible = false;
    for (let i = 0; i < 8; i++) this.shells.push(this.makeCasing(shellSrc, true));

    // ---- bullet-hole decals (instanced, 90 max, recycled oldest first)
    mats.bulletHole.hasAlpha = true;
    const decalMat = this.decalMaterial("decalMat", mats.bulletHole, 0.9, -3, false);
    const decalSrc = MeshBuilder.CreatePlane("decalSrc", { size: 0.09 }, scene);
    decalSrc.receiveShadows = true;
    decalSrc.material = decalMat;
    decalSrc.isPickable = false;
    decalSrc.isVisible = false;
    for (let i = 0; i < 90; i++) {
      const d = decalSrc.createInstance("decal");
      d.isPickable = false;
      d.setEnabled(false);
      d.rotationQuaternion = new Quaternion();
      this.decals.push(d);
    }

    // ---- blood decals: painted once at load (spatter, directional spray, smear), drips and pools
    const paint = (name: string, draw: (g: CanvasRenderingContext2D, rnd: () => number) => void, seed: number) => {
      const t = new DynamicTexture(name, { width: 256, height: 256 }, scene, true);
      const g = t.getContext() as unknown as CanvasRenderingContext2D;
      g.clearRect(0, 0, 256, 256);
      let sd = seed;
      draw(g, () => ((sd = (sd * 16807) % 2147483647) / 2147483647));
      t.update();
      t.hasAlpha = true;
      return t;
    };
    const blob = (g: CanvasRenderingContext2D, rnd: () => number, x: number, y: number, r: number, a: number, lumpy = 0.3) => {
      const grad = g.createRadialGradient(x, y, 0, x, y, r);
      grad.addColorStop(0, `rgba(78, 5, 4, ${a})`);
      grad.addColorStop(0.75, `rgba(64, 4, 3, ${a * 0.9})`);
      grad.addColorStop(1, "rgba(50, 2, 2, 0)");
      g.fillStyle = grad;
      g.beginPath();
      const n = 12;
      for (let i = 0; i <= n; i++) {
        const ang = (i / n) * Math.PI * 2;
        const rr = r * (1 - lumpy / 2 + rnd() * lumpy);
        if (i === 0) g.moveTo(x + Math.cos(ang) * rr, y + Math.sin(ang) * rr);
        else g.lineTo(x + Math.cos(ang) * rr, y + Math.sin(ang) * rr);
      }
      g.fill();
    };
    // Blood on walls reads as thousands of fine dark droplets around a darker core, thin streaks
    // flung outwards and runs dripping down — never a smooth bright disc. Colours stay dark
    // (oxidised maroon to near black) and matte. Canvas +y = down the wall.
    const gauss = (rnd: () => number) => (rnd() + rnd() + rnd() - 1.5) / 1.5;
    const dot = (g: CanvasRenderingContext2D, x: number, y: number, r: number, a: number, dark = 0) => {
      g.fillStyle = `rgba(${Math.round(118 - dark * 50)}, ${Math.round(9 - dark * 5)}, ${Math.round(7 - dark * 4)}, ${a})`;
      g.beginPath();
      g.arc(x, y, r, 0, Math.PI * 2);
      g.fill();
    };
    const streak = (g: CanvasRenderingContext2D, x0: number, y0: number, ang: number, len: number, w: number, a: number) => {
      // a flung droplet: thick at the head, tapering back towards where it came from
      const x1 = x0 + Math.cos(ang) * len, y1 = y0 + Math.sin(ang) * len;
      g.strokeStyle = `rgba(96, 7, 6, ${a})`;
      g.lineCap = "round";
      const steps = 6;
      for (let i = 0; i < steps; i++) {
        const t0 = i / steps, t1 = (i + 1) / steps;
        g.lineWidth = Math.max(0.6, w * (0.25 + 0.75 * t1));
        g.beginPath();
        g.moveTo(x0 + (x1 - x0) * t0, y0 + (y1 - y0) * t0);
        g.lineTo(x0 + (x1 - x0) * t1, y0 + (y1 - y0) * t1);
        g.stroke();
      }
      dot(g, x1, y1, w * 0.7, a, 0.3);
    };
    const run = (g: CanvasRenderingContext2D, rnd: () => number, x: number, y: number, len: number, w: number) => {
      // gravity pulls a run straight down, thinning, with a bead at the end
      const grad = g.createLinearGradient(0, y, 0, y + len);
      grad.addColorStop(0, "rgba(80, 5, 5, 0.9)");
      grad.addColorStop(0.85, "rgba(96, 7, 6, 0.75)");
      grad.addColorStop(1, "rgba(96, 7, 6, 0)");
      g.fillStyle = grad;
      g.beginPath();
      g.moveTo(x - w / 2, y);
      g.lineTo(x + w / 2, y);
      g.lineTo(x + w * 0.25 + (rnd() - 0.5), y + len);
      g.lineTo(x - w * 0.25 + (rnd() - 0.5), y + len);
      g.fill();
      dot(g, x, y + len * 0.93, w * 0.45, 0.85, 0.4);
    };
    const burst = (g: CanvasRenderingContext2D, rnd: () => number, cx: number, cy: number, spread: number, fine: number, dir?: number) => {
      // dense irregular core of overlapping droplets
      for (let i = 0; i < 70; i++) dot(g, cx + gauss(rnd) * spread * 0.25, cy + gauss(rnd) * spread * 0.22, 2 + rnd() * 6, 0.5 + rnd() * 0.4, 0.4 + rnd() * 0.6);
      // fine mist of droplets, denser towards the middle (and thrown one way if dir is set)
      for (let i = 0; i < fine; i++) {
        const a = dir === undefined ? rnd() * Math.PI * 2 : dir + gauss(rnd) * 0.7;
        const d = Math.abs(gauss(rnd)) * spread;
        dot(g, cx + Math.cos(a) * d, cy + Math.sin(a) * d, 0.4 + rnd() * 1.6 * (1 - d / (spread * 1.6)), 0.55 + rnd() * 0.4, rnd());
      }
      // a few short flung droplets (not a starburst)
      for (let i = 0; i < 7; i++) {
        const a = dir === undefined ? rnd() * Math.PI * 2 : dir + gauss(rnd) * 0.6;
        const d0 = spread * (0.35 + rnd() * 0.4);
        streak(g, cx + Math.cos(a) * d0, cy + Math.sin(a) * d0, a, spread * (0.08 + rnd() * 0.14), 1.5 + rnd() * 2, 0.75);
      }
    };
    const spatter = paint("bloodSpatter", (g, rnd) => {
      burst(g, rnd, 128, 112, 95, 900);
      for (let i = 0; i < 6; i++) run(g, rnd, 100 + rnd() * 56, 112 + rnd() * 10, 50 + rnd() * 80, 2 + rnd() * 4);
    }, 101);
    // thrown one way (+x): a fan of droplets and streaks off a smaller core
    const spray = paint("bloodSpray", (g, rnd) => {
      burst(g, rnd, 70, 128, 120, 1100, 0);
    }, 202);
    // a heavy wet hit: big dark core, many runs
    const smear = paint("bloodSmear", (g, rnd) => {
      burst(g, rnd, 128, 96, 70, 600);
      for (let i = 0; i < 10; i++) run(g, rnd, 92 + rnd() * 72, 96 + rnd() * 16, 60 + rnd() * 95, 2.5 + rnd() * 5);
    }, 303);
    const drips = paint("bloodDrips", (g, rnd) => {
      for (let i = 0; i < 9; i++) blob(g, rnd, 128 + (rnd() - 0.5) * 150, 128 + (rnd() - 0.5) * 150, 4 + rnd() * 10, 0.9);
    }, 404);
    const pool = paint("bloodPool", (g, rnd) => {
      for (let i = 0; i < 14; i++) blob(g, rnd, 128 + (rnd() - 0.5) * 80, 128 + (rnd() - 0.5) * 80, 34 + rnd() * 36, 0.8, 0.25);
      // darker, thicker middle
      blob(g, rnd, 128, 128, 60, 0.6, 0.3);
    }, 505);
    const mkDecal = (name: string, tex: DynamicTexture, count: number, out: InstancedMesh[], wet: boolean, zo: number) => {
      // blood absorbs light: never brighter than the wall it's on, even under a work lamp; matte
      // when dry, a pool keeps a faint wet sheen
      const mat = this.decalMaterial(name + "Mat", tex, 0.62, zo, wet);
      const src = MeshBuilder.CreatePlane(name + "Src", { size: 1 }, scene);
      src.receiveShadows = true;
      src.material = mat;
      src.isPickable = false;
      src.isVisible = false;
      for (let i = 0; i < count; i++) {
        const d = src.createInstance(name);
        d.isPickable = false;
        d.setEnabled(false);
        d.rotationQuaternion = new Quaternion();
        out.push(d);
      }
    };
    // interleave the variants so the ring buffer cycles through all three
    const a: InstancedMesh[] = [], b: InstancedMesh[] = [], c: InstancedMesh[] = [];
    mkDecal("bloodSpatter", spatter, 24, a, false, -2);
    mkDecal("bloodSpray", spray, 24, b, false, -2);
    mkDecal("bloodSmear", smear, 16, c, false, -2);
    for (let i = 0; i < 24; i++) this.bloodDecals.push(a[i], b[i], ...(i < 16 ? [c[i]] : []));
    mkDecal("bloodDrips", drips, 48, this.dripDecals, false, -2);
    const poolMeshes: InstancedMesh[] = [];
    mkDecal("bloodPool", pool, 16, poolMeshes, true, -1);
    for (const m of poolMeshes) this.pools.push({ m, t: -1, size: 1 });

    // ---- tracers
    const tracerMat = new StandardMaterial("tracerMat", scene);
    tracerMat.disableLighting = true;
    tracerMat.emissiveColor = new Color3(1.0, 0.72, 0.35).scale(2.5);
    tracerMat.alpha = 0.85;
    tracerMat.alphaMode = Constants.ALPHA_ADD;
    const tracerSrc = MeshBuilder.CreateBox("tracerSrc", { width: 0.012, height: 0.012, depth: 1 }, scene);
    tracerSrc.material = tracerMat;
    tracerSrc.isPickable = false;
    tracerSrc.isVisible = false;
    for (let i = 0; i < 16; i++) {
      const t = tracerSrc.createInstance("tracer");
      t.isPickable = false;
      t.setEnabled(false);
      this.tracers.push({ inst: t, life: 0 });
    }
  }

  private makeCasing(src: Mesh, shell: boolean): Casing {
    const inst = src.createInstance(shell ? "shell" : "casing");
    inst.isPickable = false;
    inst.setEnabled(false);
    inst.rotationQuaternion = null;
    return { inst, vel: new Vector3(), spin: new Vector3(), life: 0, floorY: 0, bounced: 0, shell };
  }

  // ------------------------------------------------------------------ muzzle flash
  createFlash(parent: TransformNode, tint: [number, number, number], scale: number, length: number, duration: number): MuzzleFlash {
    const scene = this.scene;
    const node = new TransformNode("flash", scene);
    node.parent = parent;
    const mk = (tex: typeof this.mats.flashFront, name: string) => {
      const m = new StandardMaterial(name, scene);
      m.disableLighting = true;
      m.emissiveTexture = tex;
      m.opacityTexture = tex;
      m.emissiveColor = new Color3(tint[0], tint[1], tint[2]).scale(2.2);
      m.alphaMode = Constants.ALPHA_ADD;
      m.backFaceCulling = false;
      m.disableDepthWrite = true;
      return m;
    };
    const front = MeshBuilder.CreatePlane("flashFront", { size: 1 }, scene);
    front.material = mk(this.mats.flashFront, "flashFrontMat");
    front.parent = node;
    const sideMat = mk(this.mats.flashSide, "flashSideMat");
    const sides: Mesh[] = [];
    for (let i = 0; i < 2; i++) {
      const s = MeshBuilder.CreatePlane("flashSide", { width: 1, height: 1 }, scene);
      s.material = sideMat;
      s.parent = node;
      s.rotation.y = -Math.PI / 2;
      s.rotation.x = i * (Math.PI / 2);
      s.position.z = 0.5;
      sides.push(s);
    }
    for (const m of [front, ...sides]) {
      m.renderingGroupId = RENDER.viewmodelGroup;
      m.isPickable = false;
      m.alwaysSelectAsActiveMesh = true;
    }
    const f: MuzzleFlash = { node, front, sides, timer: 0, duration, scale, length };
    node.setEnabled(false);
    this.flashes.push(f);
    return f;
  }

  fireFlash(f: MuzzleFlash) {
    f.timer = f.duration;
    const s = f.scale * rand(0.85, 1.2);
    f.front.scaling.set(s, s, s);
    f.front.rotation.z = Math.random() * Math.PI * 2;
    const L = f.length * rand(0.8, 1.25);
    for (const side of f.sides) {
      side.scaling.set(L, s * 0.9, 1);
      side.position.z = L * 0.5;
    }
    f.node.setEnabled(true);
  }

  // ------------------------------------------------------------------ casings
  ejectCasing(pos: Vector3, right: Vector3, up: Vector3, fwd: Vector3, playerVel: Vector3, shell: boolean) {
    const c = shell ? this.shells[this.shellIdx++ % this.shells.length] : this.casings[this.casingIdx++ % this.casings.length];
    c.inst.position.copyFrom(pos);
    const sr = shell ? rand(1.6, 2.2) : rand(2.2, 3.2);
    c.vel.set(right.x * sr + up.x * rand(1.2, 2) + fwd.x * rand(-0.3, 0.3), right.y * sr + up.y * rand(1.2, 2.0), right.z * sr + up.z * rand(1.2, 2) + fwd.z * rand(-0.3, 0.3));
    c.vel.addInPlace(playerVel);
    c.spin.set(rand(-25, 25), rand(-25, 25), rand(-25, 25));
    c.inst.rotation.set(0, 0, Math.PI / 2);
    c.life = shell ? 3.2 : 2.2;
    c.bounced = 0;
    // one ray at spawn to find the floor; integration afterwards is pure math
    this.ray.origin.copyFrom(pos);
    this.ray.direction.set(0, -1, 0);
    this.ray.length = 4;
    const hit = this.scene.pickWithRay(this.ray, (m) => m.metadata?.kind === HitKind.Level && m.isPickable, false);
    c.floorY = hit?.hit && hit.pickedPoint ? hit.pickedPoint.y + 0.005 : pos.y - 1.6;
    c.inst.setEnabled(true);
  }

  // ------------------------------------------------------------------ impacts
  impact(point: Vector3, normal: Vector3, surface: SurfaceType, loud: boolean) {
    const n = normal;
    if (surface === "metal") {
      this.sparks.emit(point, n, 10, 0.6, 2, 6);
      this.dust.emit(point, n, 2, 0.3, 0.3, 0.8);
      if (loud && this.audio.canPlay("impM", 0.05)) this.audio.play("impactMetal", { x: point.x, y: point.y, z: point.z, volume: 0.45 });
    } else {
      this.dust.emit(point, n, surface === "dirt" ? 6 : 4, 0.35, 0.5, 1.6);
      this.chips.emit(point, n, 5, 0.6, 1.5, 3.5);
      if (Math.random() < 0.25) this.sparks.emit(point, n, 3, 0.5, 1.5, 4);
      if (loud && this.audio.canPlay("impC", 0.05)) this.audio.play("impactConcrete", { x: point.x, y: point.y, z: point.z, volume: 0.5 });
    }
    if (loud && Math.random() < 0.12 && this.audio.canPlay("rico", 0.4)) this.audio.play("ricochet", { x: point.x, y: point.y, z: point.z, volume: 0.35 });
    this.placeDecal(point, n);
  }

  /**
   * A round through a body: back-spatter towards the shooter, an exit spray of droplets and mist
   * along the bullet, clots on big hits, and the blood that lands — on the wall behind, in drips
   * along the floor where the droplets come down, and under him.
   */
  bloodHit(point: Vector3, dir: Vector3, big: boolean) {
    const back = this.tmp.copyFrom(dir).scaleInPlace(-0.5);
    back.y += 0.15;
    this.blood.emit(point, back, big ? 10 : 6, 0.55, 0.4, big ? 1.6 : 1.1);
    this.drops.emit(point, back, big ? 16 : 8, 0.6, 0.8, big ? 2.6 : 1.8);
    // exit: most of it goes on with the round
    this.tmp.copyFrom(dir).scaleInPlace(0.9);
    this.tmp.y += 0.12;
    this.blood.emit(point, this.tmp, big ? 18 : 10, 0.3, 1.4, big ? 4.2 : 3);
    this.drops.emit(point, this.tmp, big ? 44 : 24, 0.32, 2.2, big ? 7.5 : 5.5);
    if (big) this.clots.emit(point, this.tmp, 8, 0.4, 1.5, 4);
    // splatter on whatever is behind him, and on the floor under him
    this.splat(point, dir, big ? 3.4 : 2.8, big ? 1.05 : 0.7, true);
    if (Math.random() < 0.8) this.splat(point, Vector3.DownReadOnly, 2.4, big ? 1.0 : 0.65, false);
    // droplets landing further along the line of fire
    const drips = big ? 3 : 2;
    for (let i = 0; i < drips; i++) {
      const d = 0.4 + Math.random() * (big ? 2.4 : 1.6);
      this.tmp2.set(point.x + dir.x * d + rand(-0.25, 0.25), point.y, point.z + dir.z * d + rand(-0.25, 0.25));
      this.drip(this.tmp2);
    }
  }

  /** the wounded player: drops falling from him onto the floor (a trail when badly hurt) */
  playerBleed(feet: Vector3, heavy: boolean) {
    this.tmp2.set(feet.x + rand(-0.3, 0.3), feet.y + 0.9, feet.z + rand(-0.3, 0.3));
    this.drip(this.tmp2, heavy ? 0.45 : 0.3);
  }

  /** a few drops on the floor below `at` */
  private drip(at: Vector3, size = 0.4) {
    this.ray.origin.copyFrom(at);
    this.ray.direction.set(0, -1, 0);
    this.ray.length = 2.6;
    const hit = this.scene.pickWithRay(this.ray, (m) => m.metadata?.kind === HitKind.Level && m.isPickable && !m.metadata?.glass, false);
    if (!hit?.hit || !hit.pickedPoint) return;
    const d = this.dripDecals[this.dripIdx];
    this.dripIdx = (this.dripIdx + 1) % this.dripDecals.length;
    d.position.copyFrom(hit.pickedPoint);
    d.position.y += 0.006;
    lookRotation(Vector3.DownReadOnly, Vector3.RightReadOnly, this.q);
    d.rotationQuaternion!.copyFrom(this.q).multiplyInPlace(Quaternion.RotationAxis(Vector3.Forward(), Math.random() * 6.28));
    d.scaling.setAll(size * (0.6 + Math.random() * 0.75));
    d.setEnabled(true);
  }


  /** a surface decal material: physically based (lit like the walls, shadowed) on a lit level, plain otherwise */
  private decalMaterial(name: string, tex: Texture, albedo: number, zOffset: number, wet: boolean) {
    if (this.litWorld) {
      const m = new PBRMaterial(name, this.scene);
      m.albedoTexture = tex;
      m.useAlphaFromAlbedoTexture = true;
      m.transparencyMode = PBRMaterial.PBRMATERIAL_ALPHABLEND;
      m.albedoColor = new Color3(albedo, albedo, albedo);
      m.metallic = 0;
      m.roughness = wet ? 0.35 : 0.85;
      m.maxSimultaneousLights = 4;
      m.zOffset = zOffset;
      m.backFaceCulling = true;
      return m;
    }
    const m = new StandardMaterial(name, this.scene);
    m.diffuseTexture = tex;
    m.useAlphaFromDiffuseTexture = true;
    m.diffuseColor = new Color3(albedo, albedo, albedo);
    m.maxSimultaneousLights = 2;
    m.specularColor = wet ? new Color3(0.12, 0.03, 0.03) : new Color3(0.03, 0.01, 0.01);
    m.specularPower = wet ? 48 : 16;
    m.zOffset = zOffset;
    m.backFaceCulling = true;
    return m;
  }
  /** a body is down: blood spreads out under it over several seconds */
  bloodPool(at: Vector3) {
    this.ray.origin.set(at.x, at.y + 0.3, at.z);
    this.ray.direction.set(0, -1, 0);
    this.ray.length = 1.8;
    const hit = this.scene.pickWithRay(this.ray, (m) => m.metadata?.kind === HitKind.Level && m.isPickable && !m.metadata?.glass, false);
    if (!hit?.hit || !hit.pickedPoint) return;
    // the pool must lie on the surface: shrink it until its edge is on the floor (a body on a
    // shelf or a ledge gets a small pool, not one hanging in the air)
    const y0 = hit.pickedPoint.y;
    let size = 1.0 + Math.random() * 0.5;
    for (let tries = 0; tries < 3; tries++) {
      let ok = true;
      for (const [u, v] of [[0.4, 0], [-0.4, 0], [0, 0.4], [0, -0.4]]) {
        this.ray.origin.set(hit.pickedPoint.x + u * size, y0 + 0.25, hit.pickedPoint.z + v * size);
        this.ray.length = 0.5;
        const h = this.scene.pickWithRay(this.ray, (m) => m.metadata?.kind === HitKind.Level && m.isPickable && !m.metadata?.glass, false);
        if (!h?.hit || !h.pickedPoint || Math.abs(h.pickedPoint.y - y0) > 0.08) {
          ok = false;
          break;
        }
      }
      if (ok) break;
      size *= 0.5;
    }
    if (size < 0.3) return;
    const p = this.pools[this.poolIdx];
    this.poolIdx = (this.poolIdx + 1) % this.pools.length;
    p.m.position.copyFrom(hit.pickedPoint);
    p.m.position.y += 0.004;
    lookRotation(Vector3.DownReadOnly, Vector3.RightReadOnly, this.q);
    p.m.rotationQuaternion!.copyFrom(this.q).multiplyInPlace(Quaternion.RotationAxis(Vector3.Forward(), Math.random() * 6.28));
    p.t = 0;
    p.size = size;
    p.m.scaling.setAll(0.05);
    p.m.setEnabled(true);
  }

  private splat(from: Vector3, dir: Vector3, reach: number, size: number, directional = false) {
    this.ray.origin.copyFrom(from);
    this.ray.direction.copyFrom(dir);
    this.ray.length = reach;
    const hit = this.scene.pickWithRay(this.ray, (m) => m.metadata?.kind === HitKind.Level && m.isPickable && !m.metadata?.glass, false);
    if (!hit?.hit || !hit.pickedPoint) return;
    const n = hit.getNormal(true, false);
    if (!n) return;
    const d = this.bloodDecals[this.bloodIdx];
    this.bloodIdx = (this.bloodIdx + 1) % this.bloodDecals.length;
    d.position.copyFrom(hit.pickedPoint).addInPlace(this.tmp2.copyFrom(n).scaleInPlace(0.006));
    const fwd = this.tmp.copyFrom(n).scaleInPlace(-1);
    lookRotation(fwd, Math.abs(fwd.y) > 0.95 ? Vector3.RightReadOnly : Vector3.UpReadOnly, this.q);
    // the spray variant points along the bullet's path across the surface; on walls the others
    // stay upright so their runs drip down; on floors they spin freely
    let spin = Math.abs(n.y) < 0.6 ? (Math.random() - 0.5) * 0.3 : Math.random() * 6.28;
    if (directional && d.name === "bloodSpray") {
      Vector3.TransformNormalToRef(Vector3.RightReadOnly, this.q.toRotationMatrix(this.mtx), this.tmp2);
      const along = this.tmp.copyFrom(dir).subtractInPlace(n.scale(Vector3.Dot(dir, n)));
      if (along.lengthSquared() > 1e-4) {
        along.normalize();
        const cross = Vector3.Cross(this.tmp2, along);
        spin = Math.atan2(Vector3.Dot(cross, fwd), Vector3.Dot(this.tmp2, along));
      }
    }
    d.rotationQuaternion!.copyFrom(this.q).multiplyInPlace(Quaternion.RotationAxis(Vector3.Forward(), spin));
    // farther from the body = bigger, thinner spray
    const s = size * (0.7 + Math.random() * 0.6) * (0.75 + hit.distance * 0.25);
    d.scaling.set(s, s, s);
    d.setEnabled(true);
  }

  muzzleSmoke(pos: Vector3, dir: Vector3, amount: number) {
    // start slightly ahead of the muzzle so the puff never fills the screen
    this.tmp2.copyFrom(dir).scaleInPlace(0.18).addInPlace(pos);
    this.smoke.emit(this.tmp2, dir, amount, 0.12, 0.25, 0.8);
  }

  private placeDecal(point: Vector3, normal: Vector3) {
    const d = this.decals[this.decalIdx];
    this.decalIdx = (this.decalIdx + 1) % this.decals.length;
    d.position.copyFrom(point).addInPlace(this.tmp2.copyFrom(normal).scaleInPlace(0.004));
    // plane faces -Z: orient so -Z looks along -normal... i.e. +Z = -normal
    const fwd = this.tmp.copyFrom(normal).scaleInPlace(-1);
    const upRef = Math.abs(fwd.y) > 0.95 ? Vector3.RightReadOnly : Vector3.UpReadOnly;
    lookRotation(fwd, upRef, this.q);
    d.rotationQuaternion!.copyFrom(this.q);
    const s = rand(0.8, 1.25);
    d.scaling.set(s, s, s);
    d.setEnabled(true);
  }

  tracer(from: Vector3, to: Vector3) {
    const t = this.tracers[this.tracerIdx];
    this.tracerIdx = (this.tracerIdx + 1) % this.tracers.length;
    const len = Vector3.Distance(from, to);
    if (len < 1.5) return;
    // show a 4 m streak positioned partway down the path (reads as a fast round)
    const seg = Math.min(4, len * 0.5);
    const f = rand(0.15, 0.45);
    Vector3.LerpToRef(from, to, f, t.inst.position);
    t.inst.scaling.set(1, 1, seg);
    t.inst.lookAt(to);
    t.life = 0.035;
    t.inst.setEnabled(true);
  }

  /** Rocket launch backblast: a jet of grey smoke and dust out of the rear of the tube. */
  backblast(pos: Vector3, dir: Vector3) {
    this.tmp2.copyFrom(dir).scaleInPlace(0.4).addInPlace(pos);
    this.bigSmoke.emit(this.tmp2, dir, 22, 0.35, 2.5, 6);
    this.dust.emit(this.tmp2, dir, 14, 0.5, 3, 7);
    this.smoke.emit(pos, dir, 10, 0.3, 1.5, 4);
  }

  /** Flashbang detonation: hot sparks + a lingering white smoke cloud. */
  flashbang(pos: Vector3) {
    this.sparks.emit(pos, Vector3.UpReadOnly, 24, 1.0, 2.5, 7);
    this.bigSmoke.emit(pos, Vector3.UpReadOnly, 34, 1.0, 0.6, 2.2);
    this.dust.emit(pos, Vector3.UpReadOnly, 12, 1.0, 0.8, 2.5);
  }

  // ------------------------------------------------------------------ per frame
  update(dt: number) {
    for (const f of this.flashes) {
      if (f.timer > 0) {
        f.timer -= dt;
        if (f.timer <= 0) f.node.setEnabled(false);
      }
    }
    for (const t of this.tracers) {
      if (t.life > 0) {
        t.life -= dt;
        if (t.life <= 0) t.inst.setEnabled(false);
      }
    }
    this.updateCasings(this.casings, dt);
    this.updateCasings(this.shells, dt);
    for (const p of this.pools) {
      if (p.t < 0 || p.t > 9) continue;
      p.t += dt;
      // spreads fast at first, then slows (ease-out over ~9 s)
      const k = 1 - Math.pow(1 - Math.min(1, p.t / 9), 2.2);
      p.m.scaling.setAll(0.05 + p.size * k);
    }
  }

  private updateCasings(list: Casing[], dt: number) {
    for (const c of list) {
      if (c.life <= 0) continue;
      c.life -= dt;
      if (c.life <= 0) {
        c.inst.setEnabled(false);
        continue;
      }
      if (c.bounced >= 3) continue;
      c.vel.y -= 9.8 * dt;
      const p = c.inst.position;
      p.addInPlace(this.tmp.copyFrom(c.vel).scaleInPlace(dt));
      c.inst.rotation.x += c.spin.x * dt;
      c.inst.rotation.y += c.spin.y * dt;
      c.inst.rotation.z += c.spin.z * dt;
      if (p.y <= c.floorY && c.vel.y < 0) {
        p.y = c.floorY;
        c.vel.y *= -0.32;
        c.vel.x *= 0.5;
        c.vel.z *= 0.5;
        c.spin.scaleInPlace(0.4);
        c.bounced++;
        if (c.bounced === 1 && this.audio.canPlay(c.shell ? "shellT" : "casT", 0.06)) {
          this.audio.play(c.shell ? "shellDrop" : "casing", { x: p.x, y: p.y, z: p.z, volume: 0.28, pitchVar: 0.1 });
        }
        if (c.bounced >= 3 || Math.abs(c.vel.y) < 0.25) {
          c.bounced = 3;
          c.inst.rotation.x = Math.PI / 2;
          c.inst.rotation.z = 0;
        }
      }
    }
  }

  /** Render every pooled effect once so shaders compile during loading. */
  warmup(at: Vector3, dirs: Vector3) {
    this.sparks.emit(at, dirs, 2, 0.1, 0.1, 0.2);
    this.dust.emit(at, dirs, 2, 0.1, 0.1, 0.2);
    this.chips.emit(at, dirs, 2, 0.1, 0.1, 0.2);
    this.blood.emit(at, dirs, 2, 0.1, 0.1, 0.2);
    this.drops.emit(at, dirs, 2, 0.1, 0.1, 0.2);
    this.clots.emit(at, dirs, 2, 0.1, 0.1, 0.2);
    for (const d of [this.dripDecals[0], this.pools[0].m, ...this.bloodDecals.slice(0, 3)]) {
      d.position.copyFrom(at);
      d.setEnabled(true);
    }
    this.smoke.emit(at, dirs, 2, 0.1, 0.1, 0.2);
    this.bigSmoke.emit(at, dirs, 2, 0.1, 0.1, 0.2);
    for (const f of this.flashes) {
      f.timer = 0.2;
      f.node.setEnabled(true);
    }
    this.tracers[0].inst.position.copyFrom(at);
    this.tracers[0].inst.setEnabled(true);
    this.tracers[0].life = 0.2;
    this.decals[0].position.copyFrom(at);
    this.decals[0].setEnabled(true);
    this.bloodDecals[0].position.copyFrom(at);
    this.bloodDecals[0].setEnabled(true);
    this.casings[0].inst.position.copyFrom(at);
    this.casings[0].inst.setEnabled(true);
    this.shells[0].inst.position.copyFrom(at);
    this.shells[0].inst.setEnabled(true);
  }

  reset() {
    for (const p of [this.sparks, this.dust, this.chips, this.blood, this.drops, this.clots, this.smoke, this.bigSmoke]) p.reset();
    for (const d of this.dripDecals) d.setEnabled(false);
    for (const p of this.pools) {
      p.t = -1;
      p.m.setEnabled(false);
    }
    for (const c of [...this.casings, ...this.shells]) {
      c.life = 0;
      c.inst.setEnabled(false);
    }
    for (const d of this.decals) d.setEnabled(false);
    for (const d of this.bloodDecals) d.setEnabled(false);
    for (const t of this.tracers) {
      t.life = 0;
      t.inst.setEnabled(false);
    }
    for (const f of this.flashes) {
      f.timer = 0;
      f.node.setEnabled(false);
    }
    this.decalIdx = 0;
  }

  get activeParticles() {
    return this.sparks.active + this.dust.active + this.chips.active + this.blood.active + this.drops.active + this.clots.active + this.smoke.active + this.bigSmoke.active;
  }
}
