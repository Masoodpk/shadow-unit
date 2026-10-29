// Dev-only soldier line-up: ?kinds=mark,fsb,tmerc — every character side by side, driven by the same
// animation input (window.S.set({ speed, vz, vx, aim, crouch, reload, aimAt })), lit, on a grid.
import "../src/core/babylon";
import { Engine } from "@babylonjs/core/Engines/engine";
import { Scene } from "@babylonjs/core/scene";
import { ArcRotateCamera } from "@babylonjs/core/Cameras/arcRotateCamera";
import { HemisphericLight } from "@babylonjs/core/Lights/hemisphericLight";
import { DirectionalLight } from "@babylonjs/core/Lights/directionalLight";
import { Vector3 } from "@babylonjs/core/Maths/math.vector";
import { Color3, Color4 } from "@babylonjs/core/Maths/math.color";
import { MeshBuilder } from "@babylonjs/core/Meshes/meshBuilder";
import { Materials } from "../src/render/Materials";
import { buildSoldier } from "../src/enemies/EnemyModel";
import { SoldierSkins, type AnimInput, type SkinKind } from "../src/enemies/SoldierSkin";

const q = new URLSearchParams(location.search);
const kinds = (q.get("kinds") ?? "mark,fsb,tmerc").split(",") as SkinKind[];
const engine = new Engine(document.getElementById("c") as HTMLCanvasElement, true, { preserveDrawingBuffer: true });
const scene = new Scene(engine);
scene.clearColor = new Color4(0.42, 0.46, 0.5, 1);
new HemisphericLight("h", new Vector3(0.2, 1, -0.3), scene).intensity = 0.9;
const sun = new DirectionalLight("s", new Vector3(-0.4, -1, 0.6), scene);
sun.intensity = 1.6;
const ground = MeshBuilder.CreateGround("g", { width: 20, height: 20 }, scene);
const gl = MeshBuilder.CreateLineSystem("gl", { lines: Array.from({ length: 41 }, (_, i) => [new Vector3(-10 + i * 0.5, 0.002, -10), new Vector3(-10 + i * 0.5, 0.002, 10)]).concat(Array.from({ length: 41 }, (_, i) => [new Vector3(-10, 0.002, -10 + i * 0.5), new Vector3(10, 0.002, -10 + i * 0.5)])) }, scene);
gl.color = new Color3(0.3, 0.3, 0.3);
void ground;
const cam = new ArcRotateCamera("cam", -Math.PI / 2, 1.35, 5.5, new Vector3(0, 1, 0), scene);
cam.minZ = 0.05;
cam.attachControl(true);

const mats = await Materials.create(scene, true, () => {});
const skins = await SoldierSkins.load(scene, undefined, kinds);
const inp: AnimInput = { dt: 0, speed: 0, vx: 0, vz: 0, aim: 0, crouch: 0, crouchMove: false, reload: -1, blind: 0, aimAt: null, aimW: 0, hitPitch: 0, hitYaw: 0, recoil: 0 };
const list = kinds.map((k, i) => {
  const parts = buildSoldier(scene, mats, null, i);
  const x = (i - (kinds.length - 1) / 2) * 1.3;
  parts.root.position.set(x, 0, 0);
  const skin = skins.create(k, parts, i);
  return { k, parts, skin, x };
});
const S = {
  inp,
  list,
  skins,
  /** aim target in front (world z), or null */
  aimZ: null as number | null,
  set(o: Partial<AnimInput> & { aimZ?: number | null }) {
    Object.assign(inp, o);
    if (o.aimZ !== undefined) S.aimZ = o.aimZ;
  },
  cam,
  /** step the animation by `t` seconds (frozen otherwise) */
  run: true,
};
(window as unknown as { S: typeof S }).S = S;
const at = new Vector3();
engine.runRenderLoop(() => {
  const dt = S.run ? Math.min(0.05, engine.getDeltaTime() / 1000) : 0;
  inp.dt = dt;
  for (const s of list) {
    if (S.aimZ !== null) {
      inp.aimAt = at.set(s.x, 1.45, S.aimZ);
      inp.aimW = inp.aim;
    } else {
      inp.aimAt = null;
      inp.aimW = 0;
    }
    s.parts.root.computeWorldMatrix(true);
    s.skin.animate(inp);
  }
  scene.render();
});
