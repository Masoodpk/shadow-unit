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
import { SKY_HAZE, createSkyMaterial } from "../render/Sky";
import { Environment } from "../render/Environment";
import type { EnemySpawn, LevelData } from "./KestrelPoint";
import { NavGraph } from "./NavGraph";
import { extFor } from "../weapons/ArmsRig";
import { chunkMeshes, openSkyTest, pickEnemySpawns, visibleSurface, wallTest } from "./Office";
import mapUrl from "../assets/maps/railway.glb?url";
import dataUrl from "../assets/maps/railway-data.json?url";

/**
 * TERMINUS (stage id "railway") — Port Calder Central, our own map: a Victorian terminus built in Blender by
 * scripts/railway/*.py (concept, blueprint, the heritage restyle and numbers in docs/railway/), its daylight
 * baked into the vertices and drawn unlit, like LAST CALL. Three arched iron train sheds over six tracks and
 * four platforms (a steam express at platform 1, a walk-through saloon train at platform 2 with its doors open
 * on both sides, old coaches and an InterCity 125 power car at the others), the brick station building with its
 * clock tower, booking hall and galleries, two lattice footbridges, a tiled subway under every platform and an
 * underground railway under the booking hall, the north building with the control room, the goods yard (an
 * armoured locomotive), the engine shed and the city forecourt.
 *
 * Collision and navigation come from the offline voxelisation of the same triangles
 * (scripts/assets/voxel-map.mjs --u=1 --mode=all --crop=… --skip=glass --wall=glass --soft='fence|clip|soft_':
 * the open ironwork — balusters, the footbridges' lattice — stops players but not bullets).
 * The glTF carries the gameplay empties: "mission_start" (the forecourt), "mission_target" (the control room).
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

/** map coordinates (docs/railway: x east 0–240, y south 0–150, z up) → Babylon */
const M = (x: number, y: number, z = 0) => new Vector3(64 - x, z, y - 48);
/** the forecourt, if the file has no "mission_start" empty */
const FORECOURT = M(110, 136.5, 0);

/**
 * Walks the 3 m nav grid misses (map coords, rough floor heights): down the aisles of the two walk-through
 * trains and out of each open door onto the platform, so soldiers use the trains like everyone else.
 */
const STITCH: [number, number, number][][] = [];
{
  // the saloon train on T2: cars at x 98 / 123 / 148 (24 m, 1 m gangways), aisle y 83.0; every door is open on
  // both sides — onto platform 2 (north) and down its footboards to the T1 track bed (south)
  // (the aisle walk passes through every doorway's own point, so the door walks join it)
  const xs: number[] = [];
  for (let x = 99.0; x <= 171.0; x += 3) xs.push(x);
  for (const a of [98, 123, 148]) for (const d of [3.9, 12, 20.1]) xs.push(a + d);
  STITCH.push(xs.sort((p, q) => p - q).map((x) => [x, 83.0, 0] as [number, number, number]));
  for (const a of [98, 123, 148])
    for (const d of [3.9, 12, 20.1]) {
      STITCH.push([[a + d, 83.0, 0], [a + d, 81.2, 0], [a + d, 79.4, 0]]);
      STITCH.push([[a + d, 83.0, 0], [a + d, 84.75, -0.3], [a + d, 85.35, -0.9], [a + d, 86.4, -1.2]]);
    }
  // the underground train: cars at x 90 / 113 (22 m), aisle y 118.2 at −7, doors to its platform (north)
  const mx: number[] = [];
  for (let x = 91.0; x <= 134.0; x += 3) mx.push(x);
  for (const a of [90, 113]) for (const d of [3.9, 11, 18.1]) mx.push(a + d);
  STITCH.push(mx.sort((p, q) => p - q).map((x) => [x, 118.2, -7] as [number, number, number]));
  for (const a of [90, 113]) for (const d of [3.9, 11, 18.1]) STITCH.push([[a + d, 118.2, -7], [a + d, 116.4, -7], [a + d, 114.8, -7]]);
  // every stair and escalator (the 3 m grid can't thread a 2–3 m wide flight): a walk from a landing
  // before its foot, up the flight every ~2 m, to a landing past its head. (foot x, y, z) → (head x, y, z)
  const flight = (a: [number, number, number], b: [number, number, number], before?: [number, number, number], after?: [number, number, number]) => {
    const pts: [number, number, number][] = [];
    const dx = b[0] - a[0], dy = b[1] - a[1], len = Math.hypot(dx, dy);
    const ux = dx / len, uy = dy / len;
    pts.push(before ?? [a[0] - ux * 1.2, a[1] - uy * 1.2, a[2]]);
    const n = Math.max(2, Math.round(len / 2));
    for (let i = 0; i <= n; i++) pts.push([a[0] + (dx * i) / n, a[1] + (dy * i) / n, a[2] + ((b[2] - a[2]) * i) / n]);
    pts.push(after ?? [b[0] + ux * 1.2, b[1] + uy * 1.2, b[2]]);
    STITCH.push(pts);
  };
  // the booking hall's grand stairs and stair cores (ground → gallery +7)
  for (const x of [88, 132]) flight([x, 110, 0], [x, 122, 7]);
  for (const x of [45.2, 181.2]) flight([x, 104, 0], [x, 115.7, 7]);
  // the north building's stairs (their foot and head are reached from the side)
  flight([38.2, 19.3, 0], [38.2, 31, 7], [40.6, 18.8, 0], [40.6, 31.4, 7]);
  flight([183.8, 19.3, 0], [183.8, 31, 7], [181.4, 18.8, 0], [181.4, 31.4, 7]);
  // the footbridges' stairs down to platforms 2 and 3, the gallery stairs to platforms 1 and 4
  for (const x1 of [78, 148]) for (const y of [76, 56]) flight([x1 + 11.7, y, 0], [x1, y, 7]);
  for (const y of [98.2, 33.8]) flight([163.9, y, 0], [152.2, y, 7]);
  // the road bridge's two stairs
  flight([18, 115.7, 0], [18, 104, 7]);
  flight([18, 14.3, -1.2], [18, 26, 7]);
  // down: each platform's stair to the subway, the emergency stair, the lobby's stair to the metro
  for (const y of [95.5, 76, 56, 36.5]) flight([100, y, 0], [112, y, -7]);
  flight([116, 21.3, 0], [116, 33, -7]);
  flight([140, 107.5, 0], [151.7, 107.5, -7]);
}
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
    for (let i = 1; i < ids.length; i++) if (nav.clear(waist(nav.nodes[ids[i - 1]].p), waist(nav.nodes[ids[i]].p))) nav.link(ids[i - 1], ids[i]);
    for (const id of ids) {
      const p = nav.nodes[id].p;
      for (const n of nav.nodes)
        if (!fresh.has(n.id) && Vector3.Distance(n.p, p) < 3.6 && Math.abs(n.p.y - p.y) < 0.8 && nav.clear(waist(p), waist(n.p))) nav.link(id, n.id);
    }
  }
}

/** soldiers per zone (26 in all) and the zone of a Babylon position */
// 31 in all (five more than at first: a huge map felt empty) — the extra ones in the train hall, the north
// building, the goods yard and the depot, the big zones that had the fewest
const QUOTA: Record<string, number> = { hall: 9, station: 4, upper: 4, underground: 4, north: 3, goods: 3, depot: 3, city: 1 };
function zoneOf(p: Vector3) {
  const x = 64 - p.x, y = p.z + 48;
  if (p.y < -3) return "underground";
  if (p.y > 5) return "upper";
  if (x >= 40 && x <= 186 && y >= 100 && y <= 126) return "station";
  if (x >= 30 && x <= 190 && y >= 32 && y <= 100) return "hall";
  if (x >= 36 && x <= 186 && y >= 18 && y < 32) return "north";
  if (y < 18) return "goods";
  if (x > 190 && y <= 110) return "depot";
  return "city";
}

export async function buildRailway(scene: Scene, env: Environment, progress: (p: number, label?: string) => void): Promise<LevelData> {
  const [container, data] = await Promise.all([
    LoadAssetContainerAsync(mapUrl, scene, {
      pluginExtension: extFor(mapUrl),
      onProgress: (e) => e.lengthComputable && progress((e.loaded / e.total) * 0.85, `Downloading Terminus — ${(e.loaded / 1e6).toFixed(1)} / ${(e.total / 1e6).toFixed(1)} MB`),
    }),
    fetch(dataUrl).then((r) => r.json() as Promise<MapData>),
  ]);
  progress(0.86, "Placing Terminus");
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
  // (the invisible blocks over the seats: only the voxel data needs them — no draw call)
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
    ...chunkMeshes(scene, solid, "rwsSolid", { pick: true }),
    ...chunkMeshes(scene, soft, "rwsSoft", { pick: false }),
    ...chunkMeshes(scene, clip, "rwsClip", { pick: false }),
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

  // ---------------------------------------------------------------- spawns: the forecourt, facing the station
  const nodes = nav.nodes;
  const want = marker("mission_start") ?? FORECOURT;
  let start = nodes[0];
  let bd = Infinity;
  for (const n of nodes) {
    const d = (n.p.x - want.x) ** 2 + (n.p.z - want.z) ** 2 + (n.p.y - want.y) ** 2 * 4;
    if (d < bd && n.links.length >= 2) {
      bd = d;
      start = n;
    }
  }
  const target = marker("mission_target") ?? M(132, 23, 0);
  const playerYaw = Math.atan2(target.x - start.p.x, target.z - start.p.z);
  // a big map: 31 of them, by zone, so the fight is where the map is (spread farthest-first inside each
  // zone, from a well-spread candidate list; a zone short of candidates gives its places to the rest)
  const pool = pickEnemySpawns(nav, start.p, 96);
  const enemySpawns: EnemySpawn[] = [];
  const left: EnemySpawn[] = [];
  const taken = new Map<string, number>();
  for (const sp of pool) {
    const z = zoneOf(sp.pos);
    const k = taken.get(z) ?? 0;
    if (k < (QUOTA[z] ?? 0)) {
      taken.set(z, k + 1);
      enemySpawns.push(sp);
    } else left.push(sp);
  }
  // top up a zone the pool left short from its own nodes: out of sight of the start, ≥ 28 m from it,
  // farthest-first from everyone already placed
  const eyes = [0, 1.5, -1.5].flatMap((dx) => [0, 1.5, -1.5].map((dz) => new Vector3(start.p.x + dx, start.p.y + 1.6, start.p.z + dz)));
  const hidden = (q: Vector3) => eyes.every((e) => !nav.clear(new Vector3(q.x, q.y + 1.6, q.z), e));
  for (const [z, want] of Object.entries(QUOTA)) {
    let have = taken.get(z) ?? 0;
    if (have >= want) continue;
    const cand = nav.nodes.filter((n) => n.links.length >= 2 && zoneOf(n.p) === z && Vector3.Distance(n.p, start.p) > 28 && hidden(n.p));
    while (have < want && cand.length) {
      let best = 0, bd = -1;
      cand.forEach((n, i) => {
        let d = Infinity;
        for (const e of enemySpawns) d = Math.min(d, Vector3.DistanceSquared(n.p, e.pos));
        if (d > bd) {
          bd = d;
          best = i;
        }
      });
      const n = cand.splice(best, 1)[0];
      enemySpawns.push({ pos: n.p.clone(), yaw: Math.atan2(start.p.x - n.p.x, start.p.z - n.p.z), anchored: !!n.cover });
      have++;
    }
    taken.set(z, have);
  }
  while (enemySpawns.length < 31 && left.length) enemySpawns.push(left.shift()!);

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
  // (breakable panes — the facade, the footbridges, the trains' windows — one quad each, in the mesh "glass";
  // the vaults' glazing "roof_roof_glass" is out of reach and stays whole)
  const glassMesh = container.meshes.find((m) => m.name === "glass" && (m as Mesh).getTotalVertices?.() > 0) as Mesh | undefined;
  daylight(scene, env);
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
    doors: DOORS,
  };
}

/**
 * The hinged doors: the two timber waiting rooms on the island platforms (rws_build.py waiting_room), a door
 * in each long side, 1.2 × 2.2 m in a 12 cm wall. Declared rather than taken from the voxel scan's doorway
 * finder: that measured these openings 20 cm narrow (the leaf left a gap you could see the room through) and
 * also hung "doors" in the open between the two posts of every platform number board and the omnibus
 * shelter's columns. Rows: x, floor y, z, axis (0 = spans X), width, height, wall depth (Babylon metres).
 */
const DOORS: number[][] = [];
for (const [kx, cy] of [[124, 76], [56, 56]])
  for (const y of [cy - 1.6, cy + 1.6]) {
    const p = M(kx + 3.0, y, 0.01);
    DOORS.push([p.x, p.y, p.z, 0, 1.2, 2.2, 0.12]);
  }

/**
 * The baked light is a soft, hazy late morning: the sun from the south-east, 40° up (scripts/railway/rws_bake.py).
 * The sky, the haze and the lights on the soldiers and the gun match it.
 */
function daylight(scene: Scene, env: Environment) {
  env.indoor();
  // (Blender's direction towards the sun, in Babylon axes: glTF swaps y/z, the loader mirrors x)
  const toSun = new Vector3(-0.383, 0.643, 0.663).normalize();
  env.sun.direction = toSun.scale(-1);
  env.sun.diffuse = new Color3(1.0, 0.93, 0.8);
  env.sun.intensity = 1.5;
  env.hemi.diffuse = new Color3(0.86, 0.87, 0.9);
  env.hemi.groundColor = new Color3(0.44, 0.4, 0.36);
  env.hemi.intensity = 1.0;
  env.sky.setEnabled(true);
  env.sky.material = createSkyMaterial(scene, toSun, SKY_HAZE);
  const haze = new Color3(0.82, 0.82, 0.8);
  scene.fogColor = haze;
  scene.clearColor = new Color4(haze.r, haze.g, haze.b, 1);
  scene.fogDensity = 0.0022;
}
