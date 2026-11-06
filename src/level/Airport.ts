import "@babylonjs/loaders/glTF/glTFFileLoader";
import "@babylonjs/loaders/glTF/2.0/glTFLoader";
import "@babylonjs/loaders/glTF/2.0/Extensions/EXT_texture_webp";
import "@babylonjs/loaders/glTF/2.0/Extensions/KHR_materials_unlit";
import "@babylonjs/loaders/glTF/2.0/Extensions/KHR_mesh_quantization";
import { LoadAssetContainerAsync } from "@babylonjs/core/Loading/sceneLoader";
import { Mesh } from "@babylonjs/core/Meshes/mesh";
import { Color3, Color4 } from "@babylonjs/core/Maths/math.color";
import { Scene } from "@babylonjs/core/scene";
import { Vector3 } from "@babylonjs/core/Maths/math.vector";
import { SKY_DUSK, createSkyMaterial } from "../render/Sky";
import { Environment } from "../render/Environment";
import type { LevelData } from "./KestrelPoint";
import { NavGraph } from "./NavGraph";
import { extFor } from "../weapons/ArmsRig";
import { chunkMeshes, openSkyTest, pickEnemySpawns, visibleSurface, wallTest } from "./Office";
import mapUrl from "../assets/maps/airport.glb?url";
import dataUrl from "../assets/maps/airport-data.json?url";

/**
 * LAST CALL (stage id "airport") — Port Calder International, our own map: built in Blender by
 * scripts/airport/*.py (layout and numbers in docs/airport/PHASE1-concept.md), its golden-hour light baked
 * into the vertices and drawn unlit, like Black Ledger. A terminal slice (curb → check-in → security →
 * gates) around a parked narrow-body at Gate 14 you can walk through, with a hangar, a cargo shed and a
 * service tunnel; the runway, the tower and the city are low-poly backdrop past the fence.
 *
 * Collision and navigation come from the offline voxelisation of the same triangles
 * (scripts/assets/voxel-map.mjs --u=1 --mode=all --crop=… --skip=glass --wall=glass --soft='fence|clip').
 * The glTF carries the gameplay empties: "mission_start" (the curb) and "mission_target" (the cabin).
 */

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

/** the departures curb, if the file has no "mission_start" empty (Babylon metres) */
const CURB = new Vector3(0, 0, 44.5);

/** map coordinates (docs/airport: x east 0–128, y south 0–96, z up) → Babylon */
const M = (x: number, y: number, z = 0) => new Vector3(64 - x, z, y - 48);

/**
 * Walks the 3 m nav grid missed (map coords, a rough floor height each): the security office's doorways (the hall's included)
 * and the way off the top of its tunnel stair, which comes up between two rails against the hall wall.
 * Without them the office is an island to the soldiers (the player walks them fine).
 * (map coordinates, as on docs/airport/layout-v1.svg)
 */
const STITCH: [number, number, number][][] = [
  [[52.25, 60.5, -1.6], [52.25, 63.0, -0.3], [50.0, 63.05, 0], [47.5, 61.3, 0]],
  [[52.25, 63.0, -0.3], [54.5, 63.05, 0], [54.7, 61.0, 0]],
  [[47.5, 58.0, 0], [47.5, 54.5, 0]],
  [[47.5, 66.0, 0], [47.5, 62.0, 0]],
  // the jet at Gate 14: down the aisle (x 106, floor 3.4), and out of each door — the jet bridge (front,
  // west), the airstair (rear, west), the over-wing exits onto both wings
  [[106, 10.7, 3.45], [106, 16, 3.45], [106, 22.6, 3.45], [106, 28, 3.45], [106, 35.7, 3.45]],
  [[106, 35.7, 3.45], [103.6, 35.7, 3.45], [101.5, 35.7, 3.9]],
  [[106, 10.7, 3.45], [104.4, 10.7, 3.45], [102.5, 10.7, 2.45]],
  [[106, 22.6, 3.45], [103.6, 22.6, 3.4], [101.5, 22.6, 3.45]],
  [[106, 22.6, 3.45], [108.4, 22.6, 3.4], [110.5, 22.6, 3.5]],
  [[54.5, 60.25, 0], [58.0, 60.25, 0]],
];
function stitch(nav: NavGraph) {
  const waist = (v: Vector3) => v.add(new Vector3(0, 0.9, 0));
  const at = new Map<string, number>();
  const node = (q: [number, number, number]) => {
    const key = q.join();
    const had = at.get(key);
    if (had !== undefined) return had;
    const v = M(q[0], q[1], q[2]);
    const y = nav.floorAt(v.x, v.y + 0.6, v.z, 1.6);
    const id = nav.add(v.x, y ?? v.y, v.z);
    at.set(key, id);
    return id;
  };
  const fresh = new Set<number>();
  for (const line of STITCH) {
    const ids = line.map(node);
    ids.forEach((id) => fresh.add(id));
    for (let i = 1; i < ids.length; i++) nav.link(ids[i - 1], ids[i]);
    // each point onto the grid: the nodes in reach, at its height, with nothing in between
    for (const id of ids) {
      const p = nav.nodes[id].p;
      for (const n of nav.nodes)
        if (!fresh.has(n.id) && Vector3.Distance(n.p, p) < 3.6 && Math.abs(n.p.y - p.y) < 0.8 && nav.clear(waist(p), waist(n.p))) nav.link(id, n.id);
    }
  }
}

export async function buildAirport(scene: Scene, env: Environment, progress: (p: number, label?: string) => void): Promise<LevelData> {
  const [container, data] = await Promise.all([
    LoadAssetContainerAsync(mapUrl, scene, {
      pluginExtension: extFor(mapUrl),
      onProgress: (e) => e.lengthComputable && progress((e.loaded / e.total) * 0.85, `Downloading Last Call — ${(e.loaded / 1e6).toFixed(1)} / ${(e.total / 1e6).toFixed(1)} MB`),
    }),
    fetch(dataUrl).then((r) => r.json() as Promise<MapData>),
  ]);
  progress(0.86, "Placing Last Call");
  container.addAllToScene();
  for (const m of container.meshes) {
    m.isPickable = false;
    m.checkCollisions = false;
    m.receiveShadows = false;
    m.computeWorldMatrix(true);
    m.freezeWorldMatrix();
    m.doNotSyncBoundingInfo = true;
  }
  for (const mat of container.materials) mat.freeze();
  // (the invisible blocks over the seat rows: only the voxel data needs them — no draw call)
  for (const m of container.meshes) if (/^clip_clip/.test(m.name)) m.setEnabled(false);
  const marker = (name: string) => {
    const t = container.transformNodes.find((n) => n.name === name);
    return t ? t.getAbsolutePosition().clone() : null;
  };
  progress(0.88);

  // ---------------------------------------------------------------- collision chunks
  const solid = Float32Array.from(data.solid);
  const soft = Float32Array.from(data.soft);
  const clip = Float32Array.from(data.clip);
  const colliders: Mesh[] = [
    ...chunkMeshes(scene, solid, "pcxSolid", { pick: true }),
    ...chunkMeshes(scene, soft, "pcxSoft", { pick: false }),
    ...chunkMeshes(scene, clip, "pcxClip", { pick: false }),
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
  stitch(nav);

  // ---------------------------------------------------------------- spawns: the curb, facing the terminal
  const nodes = nav.nodes;
  const want = marker("mission_start") ?? CURB;
  let start = nodes[0];
  let bd = Infinity;
  for (const n of nodes) {
    const d = (n.p.x - want.x) ** 2 + (n.p.z - want.z) ** 2 + (n.p.y - want.y) ** 2 * 4;
    if (d < bd && n.links.length >= 2) {
      bd = d;
      start = n;
    }
  }
  const target = marker("mission_target") ?? new Vector3(-42, 3.4, -16);
  const playerYaw = Math.atan2(target.x - start.p.x, target.z - start.p.z);
  // (the map runs out to Pier B and the taxiway: a few more of them)
  const enemySpawns = pickEnemySpawns(nav, start.p, 22);

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

  // (the terminal's panes, one quad each: the mesh is named exactly "glass" — the control tower's
  // "backdrop_tower_glass" is scenery past the fence and stays as it is)
  const glassMesh = container.meshes.find((m) => m.name === "glass" && (m as Mesh).getTotalVertices?.() > 0) as Mesh | undefined;
  goldenHour(scene, env);
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
    // (the cargo office's two east panes look out over the rack tops: shot out, they'd let you onto a
    // perch nobody else can reach — they still shatter, and still stop you)
    sealedGlass: [
      [48.5, 5.2, -40.45],
      [48.5, 5.2, -35.35],
    ],
    surfaceAt: visibleSurface(scene, container.meshes),
    openSky: openSkyTest(scene, container.meshes),
    wallAt: wallTest(scene, container.meshes),
    doors: (data.doors ?? []).filter((d) => d[5] < 2.85),
  };
}

/**
 * The baked light is a low west-south-west sun (scripts/airport/pcx_bake.py): the sky, the haze and the
 * lights on the soldiers and the gun match it.
 */
function goldenHour(scene: Scene, env: Environment) {
  env.indoor();
  // (Blender's sun direction, towards the sun, in Babylon axes: glTF swaps y/z, the loader mirrors x)
  const toSun = new Vector3(0.899, 0.292, 0.327).normalize();
  env.sun.direction = toSun.scale(-1);
  env.sun.diffuse = new Color3(1.0, 0.84, 0.66);
  env.sun.intensity = 1.5;
  env.hemi.diffuse = new Color3(0.78, 0.84, 0.95);
  env.hemi.groundColor = new Color3(0.42, 0.36, 0.3);
  env.hemi.intensity = 0.95;
  env.sky.setEnabled(true);
  env.sky.material = createSkyMaterial(scene, toSun, SKY_DUSK);
  const haze = new Color3(0.86, 0.72, 0.6);
  scene.fogColor = haze;
  scene.clearColor = new Color4(haze.r, haze.g, haze.b, 1);
  scene.fogDensity = 0.0019;
}
