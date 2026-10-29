import "@babylonjs/loaders/glTF/glTFFileLoader";
import "@babylonjs/loaders/glTF/2.0/glTFLoader";
import "@babylonjs/loaders/glTF/2.0/Extensions/EXT_texture_webp";
import "@babylonjs/loaders/glTF/2.0/Extensions/KHR_materials_unlit";
import { LoadAssetContainerAsync } from "@babylonjs/core/Loading/sceneLoader";
import { Mesh } from "@babylonjs/core/Meshes/mesh";
import { MeshBuilder } from "@babylonjs/core/Meshes/meshBuilder";
import { StandardMaterial } from "@babylonjs/core/Materials/standardMaterial";
import { DynamicTexture } from "@babylonjs/core/Materials/Textures/dynamicTexture";
import { Texture } from "@babylonjs/core/Materials/Textures/texture";
import { Color3, Color4 } from "@babylonjs/core/Maths/math.color";
import { SKY_WINTER, createSkyMaterial } from "../render/Sky";
import { mulberry32 } from "../core/math";
import { Scene } from "@babylonjs/core/scene";
import { Vector3 } from "@babylonjs/core/Maths/math.vector";
import { Environment } from "../render/Environment";
import type { LevelData } from "./KestrelPoint";
import { NavGraph } from "./NavGraph";
import { extFor } from "../weapons/ArmsRig";
import { chunkMeshes, openSkyTest, pickEnemySpawns, visibleSurface, wallTest } from "./Office";
import mapUrl from "../assets/maps/office2.glb?url";
import dataUrl from "../assets/maps/office2-data.json?url";

/**
 * BLACK LEDGER (stage id "nightshift") — "Cs_office with real light" by Neo_minigan (CC BY 4.0): the classic low-poly
 * cs_office (not Frostline's CS:GO remake), its light baked into one atlas per section.
 *
 * Built the Frostline way: the model drawn as-is (unlit), and everything the game touches from an
 * offline voxelisation of the same triangles (scripts/assets/voxel-map.mjs --u=1.016 --mode=all
 * --skip=glass --wall=glass --edges=void): solid boxes for movement, bullets and sight, nav nodes with cover flags and their
 * links. No scripted mission: clear the building (the game ends the round on the last soldier).
 *
 * The export is the building and nothing around it — no skybox, no clip brushes, no world outside the
 * windows. So: --edges=void puts thin invisible walls only where the walkable floor ends over nothing
 * (no stepping off a ledge or out of a window into the void; stairs, drops and inner windows stay open), and
 * `buildBackdrop` gives the windows a winter sky, snowy ground and distant office blocks to look at.
 */

/** the export's own node scale is 0.025 per Source inch: ×1.016 makes it 0.0254 (metres) */
const UNIT = 1.016;

interface MapData {
  voxel: number;
  bounds: { minX: number; maxX: number; minZ: number; maxZ: number; minY: number; maxY: number };
  solid: number[];
  soft: number[];
  clip: number[];
  nodes: number[][];
  links: number[];
  doors?: number[][];
}

/** the insertion point (Babylon metres): inside the front lobby (sofas and reception), under its roof */
export const LEDGER_START = new Vector3(-44, 0, -30.7);

export async function buildOffice2(scene: Scene, env: Environment, progress: (p: number, label?: string) => void): Promise<LevelData> {
  const [container, data] = await Promise.all([
    LoadAssetContainerAsync(mapUrl, scene, {
      pluginExtension: extFor(mapUrl),
      onProgress: (e) => e.lengthComputable && progress((e.loaded / e.total) * 0.85, `Downloading Black Ledger — ${(e.loaded / 1e6).toFixed(1)} / ${(e.total / 1e6).toFixed(1)} MB`),
    }),
    fetch(dataUrl).then((r) => r.json() as Promise<MapData>),
  ]);
  progress(0.86, "Placing Black Ledger");
  container.addAllToScene();
  const root = container.meshes[0];
  root.scaling.scaleInPlace(UNIT);
  root.computeWorldMatrix(true);
  for (const m of container.meshes) {
    m.isPickable = false;
    m.checkCollisions = false;
    m.receiveShadows = false;
    m.computeWorldMatrix(true);
    m.freezeWorldMatrix();
    m.doNotSyncBoundingInfo = true;
  }
  for (const mat of container.materials) mat.freeze();
  progress(0.88);

  // ---------------------------------------------------------------- collision chunks
  const solid = Float32Array.from(data.solid);
  const soft = Float32Array.from(data.soft);
  const clip = Float32Array.from(data.clip);
  const colliders: Mesh[] = [
    ...chunkMeshes(scene, solid, "nightSolid", { pick: true }),
    ...chunkMeshes(scene, soft, "nightSoft", { pick: false }),
    ...chunkMeshes(scene, clip, "nightClip", { pick: false }),
  ];
  progress(0.94);

  // ---------------------------------------------------------------- navigation
  const nb = solid.length / 6, ns = soft.length / 6, nc = clip.length / 6;
  const all = new Float32Array((nb + ns + nc) * 6);
  all.set(solid, 0);
  all.set(soft, nb * 6);
  all.set(clip, (nb + ns) * 6);
  const flags = new Uint8Array(nb + ns + nc);
  flags.fill(3, 0, nb);
  flags.fill(2, nb);
  const nav = new NavGraph(scene);
  nav.setBoxes(all, flags);
  for (const n of data.nodes) nav.add(n[0], n[1], n[2], n[3] === 1);
  for (let i = 0; i < data.links.length; i += 2) nav.link(data.links[i], data.links[i + 1]);

  // ---------------------------------------------------------------- spawns
  const nodes = nav.nodes;
  // (indoors: a roof within 6 m overhead — the insertion point must not be the walk along the facade)
  const roofed = (p: Vector3) => !nav.clear(new Vector3(p.x, p.y + 1.6, p.z), new Vector3(p.x, p.y + 7.6, p.z));
  let start = nodes[0];
  let bd = Infinity;
  for (const n of nodes) {
    const d = (n.p.x - LEDGER_START.x) ** 2 + (n.p.z - LEDGER_START.z) ** 2;
    if (d < bd && n.links.length >= 2 && roofed(n.p)) {
      bd = d;
      start = n;
    }
  }
  const centre = nodes.reduce((a, n) => a.addInPlace(n.p), new Vector3()).scaleInPlace(1 / nodes.length);
  const playerYaw = Math.atan2(centre.x - start.p.x, centre.z - start.p.z);
  const enemySpawns = pickEnemySpawns(nav, start.p, 16);

  let floorMin = Infinity, floorMax = -Infinity;
  let x0 = Infinity, x1 = -Infinity, z0 = Infinity, z1 = -Infinity;
  for (const n of nodes) {
    floorMin = Math.min(floorMin, n.p.y);
    floorMax = Math.max(floorMax, n.p.y);
    x0 = Math.min(x0, n.p.x);
    x1 = Math.max(x1, n.p.x);
    z0 = Math.min(z0, n.p.z);
    z1 = Math.max(z1, n.p.z);
  }

  const glassMesh = container.meshes.find((m) => /glass/i.test(m.name)) as Mesh | undefined;
  env.indoor();
  buildBackdrop(scene, env, (x0 + x1) / 2, (z0 + z1) / 2, floorMin);
  progress(1);
  return {
    casters: [],
    colliders,
    nav,
    playerSpawn: { pos: start.p.clone(), yaw: playerYaw },
    enemySpawns,
    bounds: { minX: x0 - 2, maxX: x1 + 2, minZ: z0 - 2, maxZ: z1 + 2 },
    boxes: { data: all, flags },
    floorRange: [floorMin, floorMax],
    glassMesh,
    surfaceAt: visibleSurface(scene, container.meshes),
    openSky: openSkyTest(scene, container.meshes),
    wallAt: wallTest(scene, container.meshes),
    doors: (data.doors ?? []).filter((d) => d[5] < 2.85),
  };
}

/**
 * What the windows look out on (the map has nothing past its walls): a winter sky, snow-covered ground
 * level with the yard, and office blocks in a ring 130–300 m out, fading into the haze. Unlit like the
 * baked map, so they sit in the same light; never pickable, never in the way.
 */
function buildBackdrop(scene: Scene, env: Environment, cx: number, cz: number, groundY: number) {
  const sunDir = new Vector3(0.3, -1, 0.2).normalize();
  env.sky.setEnabled(true);
  env.sky.material = createSkyMaterial(scene, sunDir.scale(-1), SKY_WINTER);
  const haze = new Color3(0.8, 0.84, 0.9);
  scene.fogColor = haze;
  scene.clearColor = new Color4(haze.r, haze.g, haze.b, 1);
  scene.fogDensity = 0.0024;

  // snow: a big disc just under the yard's floor
  const snowTex = new DynamicTexture("nsSnowTex", { width: 256, height: 256 }, scene, true);
  {
    const c = snowTex.getContext() as CanvasRenderingContext2D;
    c.fillStyle = "#e6ebf1";
    c.fillRect(0, 0, 256, 256);
    const r = mulberry32(7);
    for (let i = 0; i < 1400; i++) {
      const v = 200 + Math.floor(r() * 45);
      c.fillStyle = `rgba(${v - 12},${v - 6},${v + 4},${0.25 + r() * 0.35})`;
      c.fillRect(r() * 256, r() * 256, 2 + r() * 6, 1 + r() * 3);
    }
    snowTex.update();
  }
  snowTex.wrapU = snowTex.wrapV = Texture.WRAP_ADDRESSMODE;
  snowTex.uScale = snowTex.vScale = 90;
  const snowM = new StandardMaterial("nsSnow", scene);
  snowM.disableLighting = true;
  snowM.diffuseColor = Color3.Black();
  snowM.specularColor = Color3.Black();
  snowM.emissiveTexture = snowTex;
  // (a standard material adds its emissive texture to the emissive colour: black, so the texture is the colour)
  snowM.emissiveColor = Color3.Black();
  const ground = MeshBuilder.CreateDisc("nsGround", { radius: 700, tessellation: 48 }, scene);
  ground.rotation.x = Math.PI / 2;
  ground.position.set(cx, groundY - 0.12, cz);
  ground.material = snowM;

  // office blocks: concrete with a grid of dark windows (a few lit), one texture shared
  const facade = new DynamicTexture("nsFacade", { width: 256, height: 512 }, scene, true);
  {
    const c = facade.getContext() as CanvasRenderingContext2D;
    c.fillStyle = "#5f666e";
    c.fillRect(0, 0, 256, 512);
    const r = mulberry32(19);
    for (let y = 12; y < 500; y += 28)
      for (let x = 10; x < 246; x += 30) {
        const lit = r() < 0.12;
        c.fillStyle = lit ? "#e2d3a0" : r() < 0.5 ? "#1f2731" : "#2b3542";
        c.fillRect(x, y, 20, 16);
      }
    facade.update();
  }
  const blockM = new StandardMaterial("nsBlocks", scene);
  blockM.disableLighting = true;
  blockM.diffuseColor = Color3.Black();
  blockM.specularColor = Color3.Black();
  blockM.emissiveTexture = facade;
  blockM.emissiveColor = Color3.Black();
  const roofM = new StandardMaterial("nsRoofs", scene);
  roofM.disableLighting = true;
  roofM.diffuseColor = Color3.Black();
  roofM.specularColor = Color3.Black();
  roofM.emissiveColor = new Color3(0.9, 0.92, 0.95);
  const rnd = mulberry32(31);
  const parts: Mesh[] = [], roofs: Mesh[] = [];
  for (let i = 0; i < 38; i++) {
    const a = (i / 38) * Math.PI * 2 + rnd() * 0.12;
    const dist = 130 + rnd() * 170;
    const w = 18 + rnd() * 34, d = 16 + rnd() * 30, h = 14 + rnd() * (dist > 220 ? 70 : 45);
    const b = MeshBuilder.CreateBox("nsBlock", { width: w, depth: d, height: h, faceUV: undefined }, scene);
    b.position.set(cx + Math.sin(a) * dist, groundY + h / 2 - 0.5, cz + Math.cos(a) * dist);
    b.rotation.y = a + (rnd() - 0.5) * 0.3;
    // windows at a storey's size whatever the block's size
    const uv = b.getVerticesData("uv")!;
    for (let k = 0; k < uv.length; k += 2) {
      uv[k] *= w / 24;
      uv[k + 1] *= h / 46;
    }
    b.setVerticesData("uv", uv);
    parts.push(b);
    const roof = MeshBuilder.CreateBox("nsRoof", { width: w + 0.6, depth: d + 0.6, height: 0.8 }, scene);
    roof.position.set(b.position.x, groundY + h, b.position.z);
    roof.rotation.y = b.rotation.y;
    roofs.push(roof);
  }
  facade.wrapU = facade.wrapV = Texture.WRAP_ADDRESSMODE;
  const city = Mesh.MergeMeshes(parts, true, true)!;
  city.material = blockM;
  const tops = Mesh.MergeMeshes(roofs, true, true)!;
  tops.material = roofM;
  for (const m of [ground, city, tops]) {
    m.isPickable = false;
    m.checkCollisions = false;
    m.receiveShadows = false;
    m.freezeWorldMatrix();
  }
  for (const mat of [snowM, blockM, roofM]) mat.freeze();
}
