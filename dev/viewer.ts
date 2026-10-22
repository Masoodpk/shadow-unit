// Dev-only model inspector: ?m=<asset url>&view=side|top|front — orthographic, metre grid, axis lines.
import "../src/core/babylon";
import "@babylonjs/loaders/glTF/glTFFileLoader";
import "@babylonjs/loaders/glTF/2.0/glTFLoader";
import "@babylonjs/loaders/glTF/2.0/Extensions/EXT_texture_webp";
import "@babylonjs/loaders/glTF/2.0/Extensions/KHR_materials_unlit";
import { Engine } from "@babylonjs/core/Engines/engine";
import { Scene } from "@babylonjs/core/scene";
import { FreeCamera } from "@babylonjs/core/Cameras/freeCamera";
import { Camera } from "@babylonjs/core/Cameras/camera";
import { HemisphericLight } from "@babylonjs/core/Lights/hemisphericLight";
import { Vector3 } from "@babylonjs/core/Maths/math.vector";
import { Color3, Color4 } from "@babylonjs/core/Maths/math.color";
import { MeshBuilder } from "@babylonjs/core/Meshes/meshBuilder";
import { LoadAssetContainerAsync } from "@babylonjs/core/Loading/sceneLoader";

const q = new URLSearchParams(location.search);
const engine = new Engine(document.getElementById("c") as HTMLCanvasElement, true, { preserveDrawingBuffer: true });
const scene = new Scene(engine);
scene.clearColor = new Color4(0.13, 0.13, 0.14, 1);
new HemisphericLight("h", new Vector3(0.3, 1, 0.2), scene).intensity = 1.2;
const cam = new FreeCamera("c", new Vector3(0, 0, -10), scene);
cam.mode = Camera.ORTHOGRAPHIC_CAMERA;
(window as any).viewer = { scene, engine, cam, Vector3, MeshBuilder, Color3 };
const c = await LoadAssetContainerAsync(q.get("m")!, scene, { pluginExtension: ".glb" });
c.addAllToScene();
const root = c.meshes[0];
const s = parseFloat(q.get("s") ?? "1");
root.scaling.scaleInPlace(s);
root.computeWorldMatrix(true);
const { min, max } = root.getHierarchyBoundingVectors(true);
const ctr = min.add(max).scale(0.5);
const size = max.subtract(min);
const view = q.get("view") ?? "side";
const half = Math.max(size.x, size.y, size.z) * 0.6;
const asp = engine.getRenderWidth() / engine.getRenderHeight();
cam.orthoLeft = -half * asp; cam.orthoRight = half * asp; cam.orthoTop = half; cam.orthoBottom = -half;
const dir = view === "side" ? new Vector3(1, 0, 0) : view === "top" ? new Vector3(0, 1, 0) : view === "front" ? new Vector3(0, 0, 1) : new Vector3(-1, 0, 0);
cam.position = ctr.add(dir.scale(view === "top" ? 200 : 10));
cam.maxZ = 2000;
if (view === "top") {
  cam.rotation.set(Math.PI / 2, 0, 0);
} else cam.setTarget(ctr);
const box = q.get("box");
if (box) {
  // ?box=x0,z0,x1,z1 : frame that rectangle from above
  const [x0, z0, x1, z1] = box.split(",").map(Number);
  const hw = (x1 - x0) / 2, hh = (z1 - z0) / 2;
  const h = Math.max(hh, hw / asp);
  cam.orthoLeft = -h * asp; cam.orthoRight = h * asp; cam.orthoTop = h; cam.orthoBottom = -h;
  cam.position.set((x0 + x1) / 2, parseFloat(q.get("y") ?? "60"), (z0 + z1) / 2);
}
// grid every 5 cm, axis lines through the origin
const lines: Vector3[][] = [];
const step = parseFloat(q.get("grid") ?? "0.05");
for (let a = Math.floor(min.y / step) * step; a <= max.y; a += step) lines.push([new Vector3(-50, a, ctr.z), new Vector3(50, a, ctr.z)].map((v) => (view === "side" ? new Vector3(ctr.x, a, v.x) : v)));
const g = MeshBuilder.CreateLineSystem("g", { lines }, scene);
g.color = new Color3(0.3, 0.3, 0.3);
const ax = MeshBuilder.CreateLineSystem("ax", { lines: [[new Vector3(-50, 0, 0), new Vector3(50, 0, 0)], [new Vector3(0, -50, 0), new Vector3(0, 50, 0)], [new Vector3(0, 0, -50), new Vector3(0, 0, 50)]] }, scene);
ax.color = new Color3(1, 0.3, 0.2);
document.getElementById("info")!.textContent = `min ${min.x.toFixed(3)} ${min.y.toFixed(3)} ${min.z.toFixed(3)}\nmax ${max.x.toFixed(3)} ${max.y.toFixed(3)} ${max.z.toFixed(3)}\nview ${view} (camera looks along ${dir.scale(-1).toString()})`;
engine.runRenderLoop(() => scene.render());
