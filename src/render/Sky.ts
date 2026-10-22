import { Effect } from "@babylonjs/core/Materials/effect";
import { Scene } from "@babylonjs/core/scene";
import { ShaderMaterial } from "@babylonjs/core/Materials/shaderMaterial";
import { Vector3 } from "@babylonjs/core/Maths/math.vector";

/**
 * SALTLINE sky: warm sodium horizon over the sea, slate-teal zenith, a soft
 * sun bloom and thin wind-sheared cloud bands lit from below. Fully
 * procedural, a single full-screen-cost pass.
 */
Effect.ShadersStore["saltSkyVertexShader"] = `
precision highp float;
attribute vec3 position;
uniform mat4 worldViewProjection;
varying vec3 vDir;
void main(void) {
  vDir = position;
  gl_Position = worldViewProjection * vec4(position, 1.0);
}`;

Effect.ShadersStore["saltSkyFragmentShader"] = `
precision highp float;
varying vec3 vDir;
uniform vec3 sunDir;
uniform float time;
uniform vec3 cHorizon;
uniform vec3 cBand;
uniform vec3 cZenith;
uniform vec3 cSun;
uniform vec3 cCloudLit;
uniform vec3 cCloudShade;
uniform vec3 cBelow;

float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
float noise(vec2 p) {
  vec2 i = floor(p); vec2 f = fract(p);
  vec2 u = f * f * (3.0 - 2.0 * f);
  return mix(mix(hash(i), hash(i + vec2(1.0, 0.0)), u.x), mix(hash(i + vec2(0.0, 1.0)), hash(i + vec2(1.0, 1.0)), u.x), u.y);
}
float fbm(vec2 p) {
  float s = 0.0; float a = 0.5;
  for (int i = 0; i < 5; i++) { s += noise(p) * a; p *= 2.03; a *= 0.5; }
  return s;
}

void main(void) {
  vec3 d = normalize(vDir);
  float h = d.y;
  float t = clamp(h, 0.0, 1.0);
  vec3 horizon = cHorizon;
  vec3 band = cBand;
  vec3 zenith = cZenith;
  vec3 col = mix(horizon, band, smoothstep(0.0, 0.14, t));
  col = mix(col, zenith, smoothstep(0.1, 0.65, t));

  float s = max(dot(d, sunDir), 0.0);
  col += cSun * pow(s, 6.0) * 0.55 * (1.0 - t * 0.6);
  col += vec3(1.0, 0.72, 0.45) * pow(s, 90.0) * 1.4;
  col += vec3(1.0, 0.92, 0.8) * smoothstep(0.99935, 0.99965, s) * 8.0;

  // cloud bands (projected onto a high plane), lit warm on the sun side
  if (h > 0.0) {
    vec2 uv = d.xz / (h + 0.12) * 1.4 + vec2(time * 0.004, time * 0.0015);
    float c = fbm(uv * vec2(0.6, 2.2));
    c = smoothstep(0.52, 0.85, c) * smoothstep(0.0, 0.08, h) * (1.0 - smoothstep(0.4, 0.9, h));
    vec3 cloudCol = mix(cCloudShade, cCloudLit, pow(s, 3.0) * 0.9 + 0.15);
    col = mix(col, cloudCol, c * 0.75);
  }
  // below the horizon: sea haze (mostly hidden by the water plane)
  if (h < 0.0) col = mix(horizon * 0.55, cBelow, smoothstep(0.0, -0.2, h));
  gl_FragColor = vec4(col, 1.0);
}`;

/** sky colours (the default is Red Dune's warm last light over the sea) */
export interface SkyPalette {
  horizon: Vector3;
  band: Vector3;
  zenith: Vector3;
  sun: Vector3;
  cloudLit: Vector3;
  cloudShade: Vector3;
  below: Vector3;
}
const V = (x: number, y: number, z: number) => new Vector3(x, y, z);
export const SKY_DUSK: SkyPalette = { horizon: V(1.0, 0.6, 0.38), band: V(0.62, 0.48, 0.5), zenith: V(0.09, 0.19, 0.25), sun: V(1.0, 0.5, 0.22), cloudLit: V(1.0, 0.62, 0.42), cloudShade: V(0.36, 0.34, 0.4), below: V(0.06, 0.1, 0.11) };
/** a clear, cold mountain afternoon */
/** clear desert noon: pale dusty horizon, deep blue overhead */
export const SKY_DESERT: SkyPalette = { horizon: V(0.9, 0.86, 0.78), band: V(0.62, 0.74, 0.88), zenith: V(0.18, 0.38, 0.68), sun: V(1.0, 0.93, 0.78), cloudLit: V(1.0, 0.98, 0.94), cloudShade: V(0.7, 0.72, 0.76), below: V(0.62, 0.56, 0.46) };
/** a cold winter afternoon: pale grey-white horizon, thin high cloud, a weak white sun */
export const SKY_WINTER: SkyPalette = { horizon: V(0.82, 0.86, 0.92), band: V(0.66, 0.74, 0.84), zenith: V(0.3, 0.44, 0.62), sun: V(1.0, 0.96, 0.9), cloudLit: V(0.98, 0.99, 1.0), cloudShade: V(0.66, 0.7, 0.78), below: V(0.78, 0.82, 0.88) };
export const SKY_MOUNTAIN: SkyPalette = { horizon: V(0.8, 0.84, 0.88), band: V(0.58, 0.68, 0.8), zenith: V(0.2, 0.36, 0.58), sun: V(0.9, 0.8, 0.6), cloudLit: V(1.0, 0.98, 0.95), cloudShade: V(0.62, 0.66, 0.72), below: V(0.52, 0.56, 0.6) };

export function createSkyMaterial(scene: Scene, sunDirection: Vector3, palette: SkyPalette = SKY_DUSK) {
  const m = new ShaderMaterial(
    "saltSky",
    scene,
    { vertex: "saltSky", fragment: "saltSky" },
    { attributes: ["position"], uniforms: ["worldViewProjection", "sunDir", "time", "cHorizon", "cBand", "cZenith", "cSun", "cCloudLit", "cCloudShade", "cBelow"] },
  );
  m.setVector3("cHorizon", palette.horizon);
  m.setVector3("cBand", palette.band);
  m.setVector3("cZenith", palette.zenith);
  m.setVector3("cSun", palette.sun);
  m.setVector3("cCloudLit", palette.cloudLit);
  m.setVector3("cCloudShade", palette.cloudShade);
  m.setVector3("cBelow", palette.below);
  m.setVector3("sunDir", sunDirection.normalizeToNew());
  m.setFloat("time", 0);
  m.backFaceCulling = false;
  m.disableDepthWrite = true;
  let t = 0;
  scene.onBeforeRenderObservable.add(() => {
    t += scene.getEngine().getDeltaTime() / 1000;
    m.setFloat("time", t);
  });
  return m;
}
