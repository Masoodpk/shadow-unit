import { Camera } from "@babylonjs/core/Cameras/camera";
import { Color3, Color4 } from "@babylonjs/core/Maths/math.color";
import { ColorCurves } from "@babylonjs/core/Materials/colorCurves";
import { DefaultRenderingPipeline } from "@babylonjs/core/PostProcesses/RenderPipeline/Pipelines/defaultRenderingPipeline";
import { DirectionalLight } from "@babylonjs/core/Lights/directionalLight";
import { HemisphericLight } from "@babylonjs/core/Lights/hemisphericLight";
import { ImageProcessingConfiguration } from "@babylonjs/core/Materials/imageProcessingConfiguration";
import { Mesh } from "@babylonjs/core/Meshes/mesh";
import { MeshBuilder } from "@babylonjs/core/Meshes/meshBuilder";
import { PointLight } from "@babylonjs/core/Lights/pointLight";
import { ReflectionProbe } from "@babylonjs/core/Probes/reflectionProbe";
import { RenderTargetTexture } from "@babylonjs/core/Materials/Textures/renderTargetTexture";
import { Scene } from "@babylonjs/core/scene";
import { ShadowGenerator } from "@babylonjs/core/Lights/Shadows/shadowGenerator";
import { Vector3 } from "@babylonjs/core/Maths/math.vector";
import { SKY_WINTER, createSkyMaterial } from "./Sky";
import { RENDER } from "../config/game";

/**
 * Lighting direction for SALTLINE: "last light over a cold sea".
 * One low, warm sun from the west over the water, cool teal sky fill,
 * a couple of practical lights indoors. Everything else is emissive.
 */
export class Environment {
  sun!: DirectionalLight;
  hemi!: HemisphericLight;
  shadows!: ShadowGenerator;
  pipeline?: DefaultRenderingPipeline;
  sky!: Mesh;
  private probe?: ReflectionProbe;

  constructor(private scene: Scene) {}

  build(lowQuality: boolean) {
    const scene = this.scene;
    scene.clearColor = new Color4(0.55, 0.45, 0.4, 1);
    scene.ambientColor = new Color3(0, 0, 0);

    // Low sun over the sea (west, -X), slightly south.
    const sunDir = new Vector3(0.84, -0.4, 0.3).normalize();
    this.sun = new DirectionalLight("sun", sunDir, scene);
    this.sun.position = sunDir.scale(-90).add(new Vector3(4, 0, 0));
    this.sun.diffuse = new Color3(1.0, 0.74, 0.52);
    this.sun.specular = new Color3(1.0, 0.8, 0.6);
    this.sun.intensity = 3.4;
    this.sun.shadowMinZ = 1;
    this.sun.shadowMaxZ = 220;

    this.hemi = new HemisphericLight("sky", new Vector3(0.2, 1, -0.1), scene);
    this.hemi.diffuse = new Color3(0.42, 0.55, 0.66);
    this.hemi.groundColor = new Color3(0.2, 0.16, 0.13);
    this.hemi.specular = Color3.Black();
    this.hemi.intensity = 0.62;

    // Fog/haze matches the horizon colour so distant silhouettes melt into the sea air.
    scene.fogMode = Scene.FOGMODE_EXP2;
    scene.fogDensity = 0.0062;
    scene.fogColor = new Color3(0.66, 0.54, 0.47);

    // Art-directed gradient sky with sun glow and drifting cloud bands (one shader, no textures)
    const skyMat = createSkyMaterial(scene, sunDir.scale(-1));
    this.sky = MeshBuilder.CreateBox("sky", { size: 1500 }, scene);
    this.sky.material = skyMat;
    this.sky.infiniteDistance = true;
    this.sky.isPickable = false;
    this.sky.applyFog = false;

    // Environment reflections: render the sky once into a cube map.
    this.probe = new ReflectionProbe("envProbe", lowQuality ? 64 : 128, scene, true);
    this.probe.renderList!.push(this.sky);
    this.probe.refreshRate = RenderTargetTexture.REFRESHRATE_RENDER_ONCE;
    scene.environmentTexture = this.probe.cubeTexture;

    // Shadows: one generator, PCF, small caster set.
    this.shadows = new ShadowGenerator(lowQuality ? RENDER.shadowMapLow : RENDER.shadowMapHigh, this.sun);
    this.shadows.usePercentageCloserFiltering = true;
    this.shadows.filteringQuality = lowQuality ? ShadowGenerator.QUALITY_LOW : ShadowGenerator.QUALITY_MEDIUM;
    this.shadows.bias = 0.0035;
    this.shadows.normalBias = 0.045;
    this.shadows.darkness = 0.12;
    this.shadows.transparencyShadow = false;
    this.sun.autoUpdateExtends = false;
    this.sun.autoCalcShadowZBounds = false;
    // Fixed ortho bounds around the playable area (no per-frame recompute).
    this.sun.orthoLeft = -80;
    this.sun.orthoRight = 80;
    this.sun.orthoTop = 70;
    this.sun.orthoBottom = -70;
  }

  /**
   * Interior / overcast stage (the Office): the map's own lighting is baked into unlit textures,
   * so the lights only need to sit the soldiers and the viewmodel into it — a soft, cool, even fill.
   */
  indoor() {
    const scene = this.scene;
    this.sun.intensity = 1.1;
    this.sun.diffuse = new Color3(0.95, 0.96, 1.0);
    this.sun.direction = new Vector3(0.3, -1, 0.2).normalize();
    this.hemi.intensity = 1.05;
    this.hemi.diffuse = new Color3(0.82, 0.86, 0.92);
    this.hemi.groundColor = new Color3(0.38, 0.35, 0.32);
    scene.fogMode = Scene.FOGMODE_EXP2;
    scene.fogDensity = 0.0028;
    scene.fogColor = new Color3(0.78, 0.82, 0.86);
    scene.clearColor = new Color4(0.74, 0.78, 0.83, 1);
    this.sky.setEnabled(false);
    this.shadows.getShadowMap()!.refreshRate = 0;
  }

  /** big stages: the sun's shadow box moves with the player instead of covering a fixed area */
  shadowFollow = false;
  /** Red Dune: a brighter, clearer evening (more sun and sky light, thinner haze) */
  brighter() {
    this.sun.intensity = 3.9;
    this.hemi.intensity = 0.9;
    this.hemi.groundColor = new Color3(0.3, 0.24, 0.19);
    this.scene.fogDensity = 0.0042;
    this.scene.fogColor = new Color3(0.78, 0.66, 0.56);
    this.scene.clearColor = new Color4(0.7, 0.58, 0.5, 1);
  }
  /** Whiteout: a cold bright afternoon in the snow — a higher, whiter sun, blue sky fill, pale haze */
  winter() {
    const dir = new Vector3(0.45, -0.62, 0.64).normalize();
    this.sun.direction = dir;
    this.sun.position = dir.scale(-90);
    this.sun.diffuse = new Color3(1.0, 0.97, 0.92);
    this.sun.specular = new Color3(1, 1, 1);
    this.sun.intensity = 2.4;
    this.hemi.direction = new Vector3(0, 1, 0);
    this.hemi.diffuse = new Color3(0.62, 0.72, 0.86);
    this.hemi.groundColor = new Color3(0.58, 0.62, 0.68);
    this.hemi.intensity = 0.75;
    this.scene.fogMode = Scene.FOGMODE_EXP2;
    this.scene.fogDensity = 0.0016;
    this.scene.fogColor = new Color3(0.8, 0.84, 0.9);
    this.scene.clearColor = new Color4(0.8, 0.84, 0.9, 1);
    this.sky.material?.dispose();
    this.sky.material = createSkyMaterial(this.scene, dir.scale(-1), SKY_WINTER);
  }
  followShadows(at: Vector3) {
    if (!this.shadowFollow) return;
    // snap to 4 m steps so the shadow texels don't crawl as you walk
    const x = Math.round(at.x / 4) * 4, y = Math.round(at.y / 4) * 4, z = Math.round(at.z / 4) * 4;
    const d = this.sun.direction;
    this.sun.position.set(x - d.x * 100, y - d.y * 100, z - d.z * 100);
  }

  addPractical(name: string, pos: Vector3, color: Color3, intensity: number, range: number) {
    const l = new PointLight(name, pos, this.scene);
    l.diffuse = color;
    l.specular = color.scale(0.4);
    l.intensity = intensity;
    l.range = range;
    return l;
  }

  setupPostFX(camera: Camera, lowQuality: boolean) {
    const ip = this.scene.imageProcessingConfiguration;
    ip.toneMappingEnabled = true;
    ip.toneMappingType = ImageProcessingConfiguration.TONEMAPPING_ACES;
    ip.exposure = 1.05;
    ip.contrast = 1.18;
    ip.vignetteEnabled = true;
    ip.vignetteWeight = 1.6;
    ip.vignetteStretch = 0.3;
    ip.vignetteColor = new Color4(0.02, 0.05, 0.06, 0);
    ip.vignetteBlendMode = ImageProcessingConfiguration.VIGNETTEMODE_MULTIPLY;
    // Signature grade: teal shadows, warm highlights
    const curves = new ColorCurves();
    curves.shadowsHue = 190;
    curves.shadowsDensity = 35;
    curves.shadowsSaturation = 20;
    curves.highlightsHue = 28;
    curves.highlightsDensity = 22;
    curves.globalSaturation = 6;
    ip.colorCurvesEnabled = true;
    ip.colorCurves = curves;

    const p = new DefaultRenderingPipeline("post", true, this.scene, [camera]);
    p.samples = 1;
    p.fxaaEnabled = true;
    p.bloomEnabled = !lowQuality;
    p.bloomThreshold = 0.85;
    p.bloomWeight = 0.32;
    p.bloomKernel = 48;
    p.bloomScale = 0.5;
    p.sharpenEnabled = !lowQuality;
    if (p.sharpen) {
      p.sharpen.edgeAmount = 0.18;
      p.sharpen.colorAmount = 1;
    }
    p.grainEnabled = !lowQuality;
    if (p.grain) {
      p.grain.intensity = 5;
      p.grain.animated = true;
    }
    p.chromaticAberrationEnabled = false;
    p.depthOfFieldEnabled = false;
    this.pipeline = p;
  }
}
