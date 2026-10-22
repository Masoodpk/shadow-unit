import { Color3 } from "@babylonjs/core/Maths/math.color";
import { DynamicTexture } from "@babylonjs/core/Materials/Textures/dynamicTexture";
import { Material } from "@babylonjs/core/Materials/material";
import { PBRMaterial } from "@babylonjs/core/Materials/PBR/pbrMaterial";
import { Scene } from "@babylonjs/core/scene";
import { StandardMaterial } from "@babylonjs/core/Materials/standardMaterial";
import { Texture } from "@babylonjs/core/Materials/Textures/texture";
import * as T from "./TextureGen";

export type MatKey =
  | "concrete"
  | "concreteDark"
  | "floor"
  | "metal"
  | "metalDark"
  | "rust"
  | "containerOrange"
  | "containerTeal"
  | "containerBone"
  | "sand"
  | "snow"
  | "snowRock"
  | "rock"
  | "wood"
  | "hazard"
  | "fence"
  | "lightPanel"
  | "beacon"
  | "screen"
  | "water"
  | "stain"
  | "signA"
  | "signC"
  // military set dressing (made on demand)
  | "camo"
  | "sandbag"
  | "tacmap"
  | "emergency"
  | "screenRed"
  | "signB1"
  | "signB2"
  | "signB3"
  | "signB4"
  // village (Greywater)
  | "plaster0"
  | "plaster1"
  | "plaster2"
  | "plaster3"
  | "roofTile"
  | "roofSlate"
  | "roofTin"
  | "cobble"
  | "grass"
  | "dirt"
  | "glassDark"
  | "door"
  | "trimStone"
  | "facade0"
  | "facade1"
  | "facade2"
  | "facade3";

/** World metres covered by one texture repeat, per material (keeps texel density consistent). */
export const TILE: Partial<Record<MatKey, number>> = {
  concrete: 3.2,
  concreteDark: 3.2,
  floor: 6,
  metal: 3,
  metalDark: 3,
  rust: 2,
  containerOrange: 2.6,
  containerTeal: 2.6,
  containerBone: 2.6,
  sand: 5,
  rock: 8,
  wood: 1.2,
  hazard: 1.2,
  fence: 2,
  plaster0: 3.2,
  plaster1: 3.2,
  plaster2: 3.2,
  plaster3: 3.2,
  roofTile: 2.6,
  roofSlate: 2.4,
  roofTin: 2.2,
  cobble: 1.9,
  grass: 4,
  dirt: 4,
  door: 1.1,
  trimStone: 2,
  facade0: 3,
  facade1: 3,
  facade2: 3,
  facade3: 3,
};

const yield0 = () => new Promise((r) => setTimeout(r, 0));

/**
 * One shared material per surface type. Everything in the level references
 * these, so the merged static geometry ends up with only a handful of draw calls.
 */
export class Materials {
  readonly m = {} as Record<MatKey, Material>;
  readonly particle: Texture;
  readonly smoke: Texture;
  readonly flashFront: Texture;
  readonly flashSide: Texture;
  readonly bulletHole: Texture;
  readonly polymer: Texture;
  private waterBump?: Texture;

  private constructor(private scene: Scene, fx: { particle: Texture; smoke: Texture; flashFront: Texture; flashSide: Texture; bulletHole: Texture; polymer: Texture }) {
    this.particle = fx.particle;
    this.smoke = fx.smoke;
    this.flashFront = fx.flashFront;
    this.flashSide = fx.flashSide;
    this.bulletHole = fx.bulletHole;
    this.polymer = fx.polymer;
  }

  static async create(scene: Scene, lowQuality: boolean, onProgress: (p: number) => void) {
    const S = lowQuality ? 256 : 512;
    const tex = (name: string, p: T.PixelSet, alpha = false) => T.toTexture(scene, name, p, { alpha });
    const pair = (name: string, p: T.PixelSet, strength: number) => ({
      albedo: tex(name + "_a", p),
      normal: tex(name + "_n", T.normalFromHeight(p, strength)),
    });

    const fx = {
      particle: T.toTexture(scene, "fx_dot", T.softDot(64), { alpha: true, clamp: true }),
      smoke: T.toTexture(scene, "fx_smoke", T.smokePuff(128), { alpha: true, clamp: true }),
      flashFront: T.toTexture(scene, "fx_flash", T.flashSprite(128), { alpha: true, clamp: true }),
      flashSide: T.toTexture(scene, "fx_flash_side", T.flashSide(128), { alpha: true, clamp: true }),
      bulletHole: T.toTexture(scene, "fx_hole", T.bulletHole(64), { alpha: true, clamp: true }),
      polymer: tex("polymer", T.polymer(128)),
    };
    const lib = new Materials(scene, fx);
    onProgress(0.1);

    const concrete = pair("concrete", T.concreteWall(S), 2.2);
    await yield0();
    onProgress(0.3);
    const floor = pair("floor", T.concreteFloor(S), 1.1);
    await yield0();
    onProgress(0.5);
    const metal = pair("metal", T.paintedMetal(S), 3);
    await yield0();
    onProgress(0.65);
    const rust = pair("rust", T.rustSteel(256), 2);
    const corr = pair("corr", T.corrugated(256), 2.5);
    await yield0();
    onProgress(0.8);
    const sand = pair("sand", T.sand(256), 1.0);
    const rock = pair("rock", T.rock(256), 2.5);
    const wood = pair("wood", T.wood(256), 2);
    const hazard = tex("hazard", T.hazard(256));
    const waves = T.toTexture(scene, "waves_n", T.normalFromHeight(T.waves(256), 2.5));
    lib.waterBump = waves;
    await yield0();
    onProgress(0.95);

    const pbr = (key: MatKey, o: { t?: { albedo: Texture; normal: Texture }; albedo?: Texture; color?: Color3; metal?: number; rough?: number; bumpLevel?: number }) => {
      const m = new PBRMaterial(key, scene);
      if (o.t) {
        m.albedoTexture = o.t.albedo;
        m.bumpTexture = o.t.normal;
        m.bumpTexture.level = o.bumpLevel ?? 1;
      } else if (o.albedo) m.albedoTexture = o.albedo;
      m.albedoColor = o.color ?? Color3.White();
      m.metallic = o.metal ?? 0;
      m.roughness = o.rough ?? 0.85;
      m.environmentIntensity = 0.55;
      m.useHorizonOcclusion = true;
      m.maxSimultaneousLights = 4;
      lib.m[key] = m;
      return m;
    };

    pbr("concrete", { t: concrete, rough: 0.92 });
    pbr("concreteDark", { t: concrete, color: new Color3(0.62, 0.6, 0.58), rough: 0.95 });
    pbr("floor", { t: floor, rough: 0.88, bumpLevel: 0.8 });
    pbr("metal", { t: metal, metal: 0.35, rough: 0.62 });
    pbr("metalDark", { t: metal, color: new Color3(0.38, 0.4, 0.42), metal: 0.5, rough: 0.55 });
    pbr("rust", { t: rust, metal: 0.45, rough: 0.82 });
    pbr("containerOrange", { t: corr, color: new Color3(0.78, 0.27, 0.09), metal: 0.3, rough: 0.6 });
    pbr("containerTeal", { t: corr, color: new Color3(0.13, 0.36, 0.37), metal: 0.3, rough: 0.6 });
    pbr("containerBone", { t: corr, color: new Color3(0.74, 0.71, 0.64), metal: 0.3, rough: 0.6 });
    pbr("sand", { t: sand, rough: 0.97 });
    const snowT = pair("snow", T.snow(256), 0.6);
    pbr("snow", { t: snowT, color: new Color3(0.82, 0.85, 0.9), rough: 0.78, bumpLevel: 0.8 });
    pbr("snowRock", { t: rock, color: new Color3(0.62, 0.66, 0.72), rough: 0.88, bumpLevel: 1.1 });
    pbr("rock", { t: rock, rough: 0.9, bumpLevel: 1.2 });
    pbr("wood", { t: wood, rough: 0.8 });
    pbr("hazard", { albedo: hazard, rough: 0.7 }).zOffset = -1; // painted markings lie on the pads

    const fence = pbr("fence", { albedo: tex("fence", T.chainLink(128), true), metal: 0.6, rough: 0.5 }) as PBRMaterial;
    fence.albedoTexture!.hasAlpha = true;
    fence.transparencyMode = PBRMaterial.PBRMATERIAL_ALPHATEST;
    fence.alphaCutOff = 0.5;
    fence.backFaceCulling = false;

    const emissive = (key: MatKey, c: Color3, power = 1) => {
      const m = new StandardMaterial(key, scene);
      m.disableLighting = true;
      m.emissiveColor = c.scale(power);
      m.diffuseColor = Color3.Black();
      m.specularColor = Color3.Black();
      lib.m[key] = m;
    };
    emissive("lightPanel", new Color3(0.75, 0.95, 1.0), 1.6);
    emissive("beacon", new Color3(1.0, 0.18, 0.08), 3);
    emissive("screen", new Color3(0.2, 0.85, 0.75), 1.2);

    const water = new PBRMaterial("water", scene);
    water.albedoColor = new Color3(0.02, 0.07, 0.08);
    water.metallic = 0;
    water.roughness = 0.14; // a touch rougher: a mirror-sharp tiled normal map sparkles / shimmers at range
    water.bumpTexture = waves;
    waves.uScale = waves.vScale = 220;
    waves.level = 0.35;
    water.environmentIntensity = 1.0;
    water.maxSimultaneousLights = 1;
    lib.m.water = water;

    const stain = new PBRMaterial("stain", scene);
    stain.albedoTexture = tex("stain", T.stainDecal(256), true);
    stain.albedoTexture.hasAlpha = true;
    stain.useAlphaFromAlbedoTexture = true;
    stain.transparencyMode = PBRMaterial.PBRMATERIAL_ALPHABLEND;
    stain.roughness = 1;
    stain.metallic = 0;
    stain.zOffset = -1;
    stain.environmentIntensity = 0.3;
    lib.m.stain = stain;

    lib.m.signA = lib.sign("signA", ["BLOCK A", "HYDROLOGY · SALINITY LAB"], "#1f3a38", "#e8e2d6");
    lib.m.signC = lib.sign("signC", ["RED DUNE", "DEPOT 4 · STORES"], "#2a2622", "#ff6a2b");

    return lib;
  }

  /**
   * Military set dressing (made on demand, only the stages that use it): camouflage netting
   * (alpha-tested), burlap sandbags, the command chamber's tactical-map screen, emergency red
   * lamps, a red alert screen and the fortress's stencilled signs.
   */
  addMilitaryKit() {
    const scene = this.scene;
    const canvasTex = (name: string, w: number, h: number, draw: (g: CanvasRenderingContext2D) => void, alpha = false) => {
      const dt = new DynamicTexture(name, { width: w, height: h }, scene, true);
      const g = dt.getContext() as unknown as CanvasRenderingContext2D;
      draw(g);
      dt.update(true);
      dt.hasAlpha = alpha;
      return dt;
    };
    let seed = 99;
    const r = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
    // camouflage net: woodland blotches on an open mesh of cord (holes are alpha-tested out)
    const camoTex = canvasTex("camoNet", 256, 256, (g) => {
      g.clearRect(0, 0, 256, 256);
      const cols = ["#3d4a2a", "#5a5f37", "#2b3320", "#6b6644", "#4a5232"];
      for (let i = 0; i < 70; i++) {
        g.fillStyle = cols[i % cols.length];
        g.beginPath();
        g.ellipse(r() * 256, r() * 256, 10 + r() * 30, 6 + r() * 18, r() * 3, 0, Math.PI * 2);
        g.fill();
      }
      // knock holes in it (the net between the garnish)
      g.globalCompositeOperation = "destination-out";
      for (let i = 0; i < 160; i++) {
        g.beginPath();
        g.arc(r() * 256, r() * 256, 3 + r() * 9, 0, Math.PI * 2);
        g.fill();
      }
      g.globalCompositeOperation = "source-over";
      g.strokeStyle = "#2a2a1e";
      g.lineWidth = 1.5;
      for (let i = 0; i <= 256; i += 16) {
        g.beginPath(); g.moveTo(i, 0); g.lineTo(i + 40, 256); g.stroke();
        g.beginPath(); g.moveTo(0, i); g.lineTo(256, i - 40); g.stroke();
      }
    }, true);
    const camo = new PBRMaterial("camo", scene);
    camo.albedoTexture = camoTex;
    camo.useAlphaFromAlbedoTexture = true;
    camo.transparencyMode = PBRMaterial.PBRMATERIAL_ALPHATEST;
    camo.alphaCutOff = 0.4;
    camo.backFaceCulling = false;
    camo.twoSidedLighting = true;
    camo.roughness = 0.95;
    camo.metallic = 0;
    camo.maxSimultaneousLights = 4;
    this.m.camo = camo;
    // sandbags: rows of stuffed burlap bags, staggered
    const bagTex = canvasTex("sandbags", 256, 256, (g) => {
      g.fillStyle = "#5e5440";
      g.fillRect(0, 0, 256, 256);
      for (let row = 0; row < 8; row++) {
        const off = row % 2 ? 32 : 0;
        for (let c = -1; c < 5; c++) {
          const x = c * 64 + off, y = row * 32;
          const grd = g.createLinearGradient(x, y, x, y + 32);
          grd.addColorStop(0, "#9a8c68");
          grd.addColorStop(0.5, "#86795a");
          grd.addColorStop(1, "#4d4433");
          g.fillStyle = grd;
          g.beginPath();
          g.roundRect(x + 2, y + 2, 60, 28, 10);
          g.fill();
        }
      }
      for (let i = 0; i < 3000; i++) {
        g.fillStyle = `rgba(${r() < 0.5 ? "30,24,16" : "200,190,160"},${0.08 + r() * 0.08})`;
        g.fillRect(r() * 256, r() * 256, 1 + r() * 2, 1);
      }
    });
    const bag = new PBRMaterial("sandbag", scene);
    bag.albedoTexture = bagTex;
    bag.roughness = 1;
    bag.metallic = 0;
    bag.maxSimultaneousLights = 4;
    this.m.sandbag = bag;
    // the tactical map on the command table / wall screens: terrain contours, routes, unit markers
    const mapTex = canvasTex("tacmap", 512, 512, (g) => {
      g.fillStyle = "#06141a";
      g.fillRect(0, 0, 512, 512);
      g.strokeStyle = "rgba(60,200,180,0.35)";
      g.lineWidth = 1;
      for (let k = 0; k < 14; k++) {
        g.beginPath();
        for (let a = 0; a <= Math.PI * 2 + 0.01; a += 0.1) {
          const rr = 30 + k * 16 + Math.sin(a * 3 + k) * 10;
          g.lineTo(256 + Math.cos(a) * rr, 256 + Math.sin(a) * rr * 0.8);
        }
        g.stroke();
      }
      g.strokeStyle = "rgba(80,220,200,0.25)";
      for (let i = 0; i <= 512; i += 32) {
        g.beginPath(); g.moveTo(i, 0); g.lineTo(i, 512); g.stroke();
        g.beginPath(); g.moveTo(0, i); g.lineTo(512, i); g.stroke();
      }
      g.strokeStyle = "#ffb43a";
      g.lineWidth = 4;
      g.setLineDash([12, 8]);
      g.beginPath();
      g.moveTo(420, 430); g.lineTo(300, 380); g.lineTo(150, 400); g.lineTo(110, 300); g.lineTo(200, 220); g.lineTo(330, 210);
      g.stroke();
      g.setLineDash([]);
      for (const [x, y, c] of [[330, 210, "#ff3b2f"], [110, 300, "#ff3b2f"], [150, 400, "#ff3b2f"], [420, 430, "#5fd4c8"]] as const) {
        g.fillStyle = c;
        g.beginPath(); g.arc(x, y, 9, 0, Math.PI * 2); g.fill();
      }
      g.fillStyle = "#5fd4c8";
      g.font = "700 22px monospace";
      g.fillText("SECTOR MAP // GREYWATER", 18, 34);
      g.fillStyle = "#ff3b2f";
      g.fillText("INTRUDER", 340, 205);
    });
    const map = new StandardMaterial("tacmap", scene);
    map.disableLighting = true;
    map.emissiveTexture = mapTex;
    map.diffuseColor = Color3.Black();
    map.specularColor = Color3.Black();
    this.m.tacmap = map;
    const glow = (key: MatKey, c: Color3) => {
      const m = new StandardMaterial(key, scene);
      m.disableLighting = true;
      m.emissiveColor = c;
      m.diffuseColor = Color3.Black();
      m.specularColor = Color3.Black();
      this.m[key] = m;
    };
    glow("emergency", new Color3(2.4, 0.25, 0.12));
    glow("screenRed", new Color3(1.0, 0.22, 0.16));
    this.m.signB1 = this.sign("signB1", ["CHECKPOINT 2", "IRON VEIL · STOP · SHOW PASS"], "#2b2f22", "#e0d27a");
    this.m.signB2 = this.sign("signB2", ["COMMS 7", "SIGNALS · AUTHORISED ONLY"], "#1d2a30", "#7fd0e6");
    this.m.signB3 = this.sign("signB3", ["DEPOT", "ORDNANCE · NO NAKED FLAMES"], "#30261c", "#ff8a3c");
    this.m.signB4 = this.sign("signB4", ["SECTOR 0", "RESTRICTED · LETHAL FORCE"], "#2a1414", "#ff4a3a");
  }

  /**
   * The village's surfaces (made on demand): four plaster tints over the same lime-plaster texture,
   * clay-tile / slate / tin roofs, cobbles, grass, packed earth, dark window glass, plank doors and a
   * stone trim for plinths and sills. World-tiled like the rest (TILE metres per repeat).
   */
  addVillageKit(lowQuality: boolean) {
    const scene = this.scene;
    const S = lowQuality ? 256 : 512;
    // repeating (dynamic textures clamp by default): the village's meshes carry world-scaled uvs
    const tex = (name: string, p: T.PixelSet) => {
      const t = T.toTexture(scene, name, p);
      t.wrapU = t.wrapV = 1;
      return t;
    };
    const pair = (name: string, p: T.PixelSet, strength: number) => ({ albedo: tex(name + "_a", p), normal: tex(name + "_n", T.normalFromHeight(p, strength)) });
    const pbr = (key: MatKey, t: { albedo: import("@babylonjs/core/Materials/Textures/texture").Texture; normal?: import("@babylonjs/core/Materials/Textures/texture").Texture }, o: { color?: Color3; rough?: number; metal?: number; bump?: number } = {}) => {
      const m = new PBRMaterial(key, scene);
      m.albedoTexture = t.albedo;
      if (t.normal) {
        m.bumpTexture = t.normal;
        m.bumpTexture.level = o.bump ?? 1;
      }
      m.albedoColor = o.color ?? Color3.White();
      m.metallic = o.metal ?? 0;
      m.roughness = o.rough ?? 0.9;
      m.environmentIntensity = 0.5;
      m.useHorizonOcclusion = true;
      m.maxSimultaneousLights = 4;
      this.m[key] = m;
      return m;
    };
    const pl = pair("plaster", T.plaster(S), 1.6);
    // the same plaster, tinted: whitewash, ochre, dusty pink, grey-green
    pbr("plaster0", pl, { color: new Color3(1.0, 0.99, 0.96) });
    pbr("plaster1", pl, { color: new Color3(0.98, 0.86, 0.66) });
    pbr("plaster2", pl, { color: new Color3(0.94, 0.8, 0.74) });
    pbr("plaster3", pl, { color: new Color3(0.8, 0.84, 0.76) });
    // the same tints with a window in every 3 m storey (shutters on two of them)
    const tints = [new Color3(1.0, 0.99, 0.96), new Color3(0.98, 0.86, 0.66), new Color3(0.94, 0.8, 0.74), new Color3(0.8, 0.84, 0.76)];
    for (let i = 0; i < 4; i++) pbr(("facade" + i) as MatKey, pair("facade" + i, T.facade(S, 301, i === 1 || i === 3), 1.8), { color: tints[i], rough: 0.85 });
    pbr("roofTile", pair("roofTile", T.roofTiles(S), 2.4), { rough: 0.8 });
    pbr("roofSlate", pair("roofSlate", T.slate(256), 2), { color: new Color3(1.45, 1.4, 1.35), rough: 0.75 });
    pbr("roofTin", pair("roofTin", T.corrugated(256), 2.5), { color: new Color3(0.4, 0.47, 0.55), metal: 0.1, rough: 0.6 });
    pbr("cobble", pair("cobble", T.cobble(S), 2.2), { rough: 0.85 });
    pbr("grass", pair("grass", T.grass(256), 1.2), { rough: 0.95 });
    pbr("dirt", pair("dirt", T.dirt(256), 1.4), { rough: 0.95 });
    pbr("door", pair("door", T.plankDoor(256), 1.6), { rough: 0.8 });
    pbr("trimStone", pair("trimStone", T.concreteFloor(256), 1.2), { color: new Color3(0.74, 0.74, 0.74), rough: 0.9 });
    const glass = new PBRMaterial("glassDark", scene);
    glass.albedoColor = new Color3(0.05, 0.06, 0.07);
    glass.metallic = 0.1;
    glass.roughness = 0.08;
    glass.environmentIntensity = 1.2;
    glass.maxSimultaneousLights = 4;
    this.m.glassDark = glass;
  }

  /** Painted station signage (original lettering, not a real organisation). */
  private sign(key: MatKey, lines: string[], bg: string, fg: string) {
    const dt = new DynamicTexture(key, { width: 1024, height: 256 }, this.scene, true);
    const ctx = dt.getContext() as unknown as CanvasRenderingContext2D;
    ctx.fillStyle = bg;
    ctx.fillRect(0, 0, 1024, 256);
    // weathering
    for (let i = 0; i < 260; i++) {
      ctx.fillStyle = `rgba(0,0,0,${Math.random() * 0.12})`;
      ctx.fillRect(Math.random() * 1024, Math.random() * 256, Math.random() * 40, Math.random() * 6);
    }
    ctx.strokeStyle = fg;
    ctx.lineWidth = 6;
    ctx.strokeRect(14, 14, 996, 228);
    // tide-line glyph
    ctx.beginPath();
    for (let x = 0; x <= 120; x += 4) ctx.lineTo(50 + x, 128 + Math.sin(x / 12) * 14);
    ctx.stroke();
    ctx.fillStyle = fg;
    ctx.font = "700 92px 'Chakra Petch', Impact, sans-serif";
    ctx.textBaseline = "middle";
    ctx.fillText(lines[0], 200, 100);
    ctx.font = "500 40px 'Chakra Petch', 'Arial Narrow', sans-serif";
    ctx.globalAlpha = 0.8;
    ctx.fillText(lines[1], 204, 186);
    ctx.globalAlpha = 1;
    dt.update(true);
    const m = new PBRMaterial(key, this.scene);
    m.albedoTexture = dt;
    m.roughness = 0.8;
    m.metallic = 0.2;
    m.environmentIntensity = 0.4;
    return m;
  }

  update(dt: number) {
    if (this.waterBump) {
      this.waterBump.uOffset += dt * 0.004;
      this.waterBump.vOffset += dt * 0.0025;
    }
  }

  freezeStatic() {
    for (const [k, m] of Object.entries(this.m)) if (k !== "water") m.freeze();
  }
}
