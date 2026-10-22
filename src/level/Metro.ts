import "@babylonjs/loaders/glTF/glTFFileLoader";
import "@babylonjs/loaders/glTF/2.0/glTFLoader";
import "@babylonjs/loaders/glTF/2.0/Extensions/EXT_texture_webp";
import { LoadAssetContainerAsync } from "@babylonjs/core/Loading/sceneLoader";
import { Color3, Color4 } from "@babylonjs/core/Maths/math.color";
import { Mesh } from "@babylonjs/core/Meshes/mesh";
import { PBRMaterial } from "@babylonjs/core/Materials/PBR/pbrMaterial";
import { Scene } from "@babylonjs/core/scene";
import { Vector3 } from "@babylonjs/core/Maths/math.vector";
import { VertexBuffer } from "@babylonjs/core/Buffers/buffer";
import { VertexData } from "@babylonjs/core/Meshes/mesh.vertexData";
import { Environment } from "../render/Environment";
import { Materials } from "../render/Materials";
import { extFor } from "../weapons/ArmsRig";
import type { EnemySpawn, LevelData } from "./KestrelPoint";
import { NavGraph } from "./NavGraph";
import { mulberry32 } from "../core/math";
import { chunkMeshes, openSkyTest, visibleSurface, wallTest } from "./Office";
import { HoardingSpec, buildHoarding } from "./Hoarding";
import type { PropPlacement } from "./Props";
import metroUrl from "../assets/maps/metro.glb?url";
import metroDataUrl from "../assets/maps/metro-data.json?url";

/**
 * OPERATION UNDERGROUND — "Roscoe Street - Underground" by Neo_minigan (CC BY 4.0): a closed metro
 * station — ticket hall, platforms, the tunnels out of it. Prepared by scripts/assets/prep-metro.mjs
 * (the Sketchfab root's tilt taken out, centimetres) and voxelised by voxel-map.mjs --u=0.01
 * --mode=all: solid boxes for movement, bullets and sight, nav nodes with cover and their links.
 */

/** the model's units → metres (centimetres) */
const UNIT = 0.01;

interface MetroData {
  voxel: number;
  bounds: { minX: number; maxX: number; minY: number; maxY: number; minZ: number; maxZ: number };
  solid: number[];
  soft: number[];
  clip: number[];
  nodes: number[][];
  links: number[];
  doors?: number[][];
}

/** places in the station (Babylon metres) the stage and its mission refer to */
export const METRO = {
  /** insertion: the south end of the passage over the platforms' east end, looking up it (the stairs
   * down to the platforms are at its north end) */
  start: new Vector3(29.6, 3, -25),
  firstLook: new Vector3(29.6, 3, 10),
  /** the concourse south of the platforms (reaching it wakes it) */
  concourse: new Vector3(-2, -1.5, -30),
  /** below this you're on the deep level (it wakes, and his guard with it) */
  deepY: -5.5,
  /** the Winter Soldier's post: the dead end of the deep service corridor */
  boss: new Vector3(64, -8.4, -39.7),
  /** how near his post (on the deep level) you have to get before he comes for you */
  bossRange: 26,
};

/**
 * The station is closed: every tunnel mouth (and the deep corridor's far end) is boarded up a little
 * way inside the opening, wall to wall and floor to ceiling — you never look down a tunnel into the
 * dark or past the end of the model. Positions from the leak test (rays from every nav node) and
 * the tunnels' cross-sections (rays across them).
 */
const HOARDINGS: HoardingSpec[] = [
  // the main platforms' two tracks, east and west
  { at: new Vector3(35.5, -3.0, -6.25), facing: new Vector3(-1, 0, 0), width: 17, height: 7.5, notice: ["TUNNEL CLOSED", "Eastbound line — track works"] },
  { at: new Vector3(-35.5, -3.0, -6.25), facing: new Vector3(1, 0, 0), width: 17, height: 7.5, notice: ["TUNNEL CLOSED", "Westbound line — track works"] },
  // (and the lower strip beside the westbound track, a floor further down: its own board, on its own floor)
  { at: new Vector3(-35.5, -4.4, -19.5), facing: new Vector3(1, 0, 0), width: 10, height: 9, dressing: false, notice: ["NO ENTRY", "Track works"] },
  // the deep platform's track, both ways
  { at: new Vector3(-33.5, -9.7, -16.5), facing: new Vector3(1, 0, 0), width: 13, height: 9, notice: ["TUNNEL CLOSED", "Deep line — no trains"] },
  // (the track's trench only: the platform beside it turns south there, the way to his corridor)
  { at: new Vector3(26, -9.7, -16.1), facing: new Vector3(-1, 0, 0), width: 8.3, height: 9, notice: ["TUNNEL CLOSED", "Deep line — no trains"] },
  // the deep corridor's far end
  { at: new Vector3(71, -8.4, -33), facing: new Vector3(-1, 0, 0), width: 20, height: 7, notice: ["NO ENTRY", "Service tunnel sealed"] },
  // the top corridor's doors out onto the station's roofs (black above them: nothing's built there)
  { at: new Vector3(-13.2, 2.85, -52.85), facing: new Vector3(1, 0, 0), width: 3.6, height: 4.4, dressing: false, notice: ["NO ENTRY", "Unsafe structure"] },
  { at: new Vector3(-11.4, 2.5, -51.45), facing: new Vector3(0, 0, -1), width: 2.6, height: 3.4, dressing: false, notice: ["NO ENTRY", "Unsafe structure"] },
  { at: new Vector3(-4.9, 2.5, -51.45), facing: new Vector3(0, 0, -1), width: 2.6, height: 3.4, dressing: false, notice: ["NO ENTRY", "Unsafe structure"] },
  { at: new Vector3(2.9, 2.5, -51.45), facing: new Vector3(0, 0, -1), width: 2.6, height: 3.4, dressing: false, notice: ["NO ENTRY", "Unsafe structure"] },
  // the concourse's two ticket-office windows (an unbuilt room behind them), the doorway off the platform's
  // east end, a gap in the south passage, the control room's back door — boarded from behind, so only
  // the openings show it
  { at: new Vector3(-10.35, -1.5, -28.0), facing: new Vector3(1, 0, 0), width: 6, height: 4.5, dressing: false, notice: ["CLOSED", "Ticket office"] },
  { at: new Vector3(-10.35, -1.5, -22.75), facing: new Vector3(1, 0, 0), width: 3.8, height: 4.5, dressing: false, notice: ["CLOSED", "Ticket office"] },
  { at: new Vector3(24.0, -1.45, 2.35), facing: new Vector3(0, 0, -1), width: 3, height: 3.6, dressing: false, notice: ["NO ENTRY", "Staff only"] },
  { at: new Vector3(-6.3, -1.5, -55.1), facing: new Vector3(1, 0, 0), width: 2.6, height: 3.6, dressing: false, notice: ["NO ENTRY", "Staff only"] },
  { at: new Vector3(-13.75, -1.5, -53.45), facing: new Vector3(1, 0, 0), width: 2.2, height: 3.4, dressing: false, notice: ["NO ENTRY", "Staff only"] },
  // the mezzanine's ticket gates by the start: swung open, but a metre past them the station ends —
  // boarded just behind them, so it reads as the closed exit it is (gates still seen, way plainly shut)
  { at: new Vector3(39.35, 3.0, -27.55), facing: new Vector3(-1, 0, 0), width: 4.4, height: 3.4, dressing: false, notice: ["NO EXIT", "Station closed"] },
];

/** who's where (x0, z0, x1, z1 and the floor's height range — the levels overlap in plan): the
 * platforms awake from the start; the concourse, the deep platform and his guard asleep till you get there */
const ZONES: { group: string; rect: [number, number, number, number]; y: [number, number]; n: number; dormant: boolean }[] = [
  { group: "platforms", rect: [-30, -16, 28, 8], y: [-2.5, 0], n: 6, dormant: false },
  { group: "concourse", rect: [-14, -60, 14, -17], y: [-3, 0], n: 5, dormant: true },
  { group: "deep", rect: [-33, -47, 26, -18], y: [-10, -6], n: 4, dormant: true },
  { group: "guard", rect: [30, -45, 62, -25], y: [-10, -6], n: 3, dormant: true },
];

export async function buildMetro(scene: Scene, env: Environment, mats: Materials, low: boolean, progress: (p: number, label?: string) => void): Promise<LevelData> {
  void mats;
  void low;
  const url = metroUrl;
  const [container, data] = await Promise.all([
    LoadAssetContainerAsync(url, scene, {
      pluginExtension: extFor(url),
      onProgress: (e) => e.lengthComputable && progress((e.loaded / e.total) * 0.85, `Downloading the station — ${(e.loaded / 1e6).toFixed(1)} / ${(e.total / 1e6).toFixed(1)} MB`),
    }),
    fetch(metroDataUrl).then((r) => r.json() as Promise<MetroData>),
  ]);
  progress(0.86, "Placing the station");
  container.addAllToScene();
  const root = container.meshes[0];
  root.scaling.scaleInPlace(UNIT);
  root.computeWorldMatrix(true);
  for (const m of container.meshes) {
    m.isPickable = false;
    m.checkCollisions = false;
    m.receiveShadows = true;
    m.computeWorldMatrix(true);
    m.freezeWorldMatrix();
    m.doNotSyncBoundingInfo = true;
  }
  for (const mat of container.materials) {
    if (mat instanceof PBRMaterial) {
      // (brick, tar and corrugated iron: nothing in this city is a mirror)
      mat.metallic = 0;
      mat.roughness = 0.88;
      mat.environmentIntensity = 0.55;
      mat.maxSimultaneousLights = 2;
      if (mat.albedoTexture) mat.albedoTexture.anisotropicFilteringLevel = 8;
    }
    mat.freeze();
  }
  progress(0.88);

  // ---------------------------------------------------------------- navigation (first: the invisible
  // walls are trimmed against its links, its island bridges included)
  const solid = Float32Array.from(data.solid);
  const soft = Float32Array.from(data.soft);
  const boxesWith = (clipBoxes: Float32Array) => {
    const nb = solid.length / 6, ns = soft.length / 6, nc = clipBoxes.length / 6;
    const all = new Float32Array((nb + ns + nc) * 6);
    all.set(solid, 0);
    all.set(soft, nb * 6);
    all.set(clipBoxes, (nb + ns) * 6);
    const flags = new Uint8Array(nb + ns + nc);
    flags.fill(3, 0, nb);
    flags.fill(2, nb);
    return { all, flags };
  };
  const nav = new NavGraph(scene);
  const raw = clearClip(Float32Array.from(data.clip));
  {
    const b = boxesWith(raw);
    nav.setBoxes(b.all, b.flags);
  }
  for (const n of data.nodes) nav.add(n[0], n[1], n[2], n[3] === 1);
  for (let i = 0; i < data.links.length; i += 2) nav.link(data.links[i], data.links[i + 1]);
  bridgeIslands(nav);
  centreNodes(nav);
  centreLinks(nav);
  const links: number[] = [];
  for (const n of nav.nodes) for (const l of n.links) if (l > n.id) links.push(n.id, l);
  const clip = openDrops(openDoorways(raw, nav.nodes.map((n) => [n.p.x, n.p.y, n.p.z]), links), nav);
  const { all, flags } = boxesWith(clip);
  nav.setBoxes(all, flags);

  // ---------------------------------------------------------------- collision chunks
  const colliders: Mesh[] = [
    ...chunkMeshes(scene, solid, "metroSolid", { pick: true }),
    ...chunkMeshes(scene, soft, "metroSoft", { pick: false }),
    ...chunkMeshes(scene, clip, "metroClip", { pick: false }),
  ];
  // invisible walls at every drop the voxeliser left open (the deep platform's edge over its track)
  colliders.push(...chunkMeshes(scene, edgeGuards(nav), "metroGuard", { pick: false }));
  // the boarded-up openings
  const props: PropPlacement[] = [];
  HOARDINGS.forEach((h, i) => {
    const b = buildHoarding(scene, h, 101 + i);
    colliders.push(...b.colliders);
    props.push(...b.props);
  });
  progress(0.94);

  const nodes = nav.nodes;
  // (on the right level: the station's floors are stacked)
  const nearY = (p: Vector3) => {
    let best = nodes[0], bd = Infinity;
    for (const n of nodes) {
      const d = (n.p.x - p.x) ** 2 + (n.p.z - p.z) ** 2 + ((n.p.y - p.y) * 3) ** 2;
      if (d < bd && n.links.length >= 2) {
        bd = d;
        best = n;
      }
    }
    return best;
  };
  const start = nearY(METRO.start);
  const toward = METRO.firstLook;
  const playerYaw = Math.atan2(toward.x - start.p.x, toward.z - start.p.z);
  const enemySpawns = metroSpawns(nav, start.p);
  // the Winter Soldier, at his post (on the floor there)
  const post = nearY(METRO.boss);
  // (not anchored: once he's woken he moves, takes cover, closes in and hunts you like his men)
  // (facing back down the corridor, the way you'll come)
  enemySpawns.push({ pos: post.p.clone(), yaw: -Math.PI / 2, group: "boss", dormant: true, boss: true });

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

  lightMetro(env, scene);
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
    surfaceAt: visibleSurface(scene, container.meshes),
    openSky: openSkyTest(scene, container.meshes),
    wallAt: wallTest(scene, container.meshes),
    // (no doors made in the station's doorways: a station's openings stand open — and swung open, a
    // made door lay across the deep platform's walkway, the one way to his corridor)
    doors: [],
    props,
    // the track beds: off the platforms (edge guards keep you up there) the voxels have no floor, and a
    // body or a gun going over the edge fell out of the world — they land on the track's own triangles
    physicsOnly: container.meshes.filter((m) => /^metal_floor4/.test(m.name)).map((m) => worldCopy(scene, m as Mesh, "metroTrackPhys")),
  };
}

/** an invisible copy of a mesh's triangles, baked into world space (for a physics shape at the origin) */
function worldCopy(scene: Scene, m: Mesh, name: string) {
  const pos = m.getVerticesData(VertexBuffer.PositionKind)!;
  const idx = Uint32Array.from(m.getIndices()!);
  const w = m.getWorldMatrix();
  const out = new Float32Array(pos.length);
  const v = new Vector3();
  for (let i = 0; i < pos.length; i += 3) {
    Vector3.TransformCoordinatesFromFloatsToRef(pos[i], pos[i + 1], pos[i + 2], w, v);
    out[i] = v.x;
    out[i + 1] = v.y;
    out[i + 2] = v.z;
  }
  // (a mirrored transform — the glTF's handedness flip — turns the triangles inside out: turn them back)
  if (w.determinant() < 0) for (let i = 0; i < idx.length; i += 3) [idx[i + 1], idx[i + 2]] = [idx[i + 2], idx[i + 1]];
  const c = new Mesh(name, scene);
  const vd = new VertexData();
  vd.positions = out;
  vd.indices = idx;
  vd.applyToMesh(c);
  c.isVisible = false;
  c.isPickable = false;
  c.checkCollisions = false;
  return c;
}

/**
 * The voxeliser's invisible walls along a floor's edge (`--edges`): kept over the track beds and the
 * void, gone where the drop lands on floor that's part of the level (a stairwell's lower hall, a
 * landing) — an open edge with nothing drawn there is a jump you may take, not a wall you can't see.
 */
function openDrops(clip: Float32Array, nav: NavGraph) {
  const keep: number[] = [];
  for (let i = 0; i < clip.length; i += 6) {
    const cx = (clip[i] + clip[i + 3]) / 2, cz = (clip[i + 2] + clip[i + 5]) / 2, y0 = clip[i + 1];
    // (the floor under it, looked for from just below its foot — a clip box counts as floor itself)
    const below = nav.floorAt(cx, y0 - 0.6, cz, 8);
    const jump = below !== null && y0 - below > 0.8 && nav.nodes.some((m) => Math.hypot(m.p.x - cx, m.p.z - cz) < 3.2 && Math.abs(m.p.y - below) < 0.7);
    if (!jump) for (let k = 0; k < 6; k++) keep.push(clip[i + k]);
  }
  return Float32Array.from(keep);
}

/**
 * Places the voxeliser's invisible "too narrow for a man" walls are wrong: the concourse ticket
 * barriers' three lanes are each 0.9 m between the cabinets — they look open and they are — but the
 * half-metre clip cells round each cabinet left two of them 0.5 m wide (the player is 0.68 m). The
 * cabinets' own solid boxes stay; only the clip goes.
 */
const CLIP_CLEAR: [number, number, number, number, number, number][] = [[8.5, -1.8, -33.6, 12.6, 1.2, -31.4]];
function clearClip(clip: Float32Array) {
  const keep: number[] = [];
  for (let i = 0; i < clip.length; i += 6) {
    const inside = CLIP_CLEAR.some((a) => clip[i] < a[3] && clip[i + 3] > a[0] && clip[i + 1] < a[4] && clip[i + 4] > a[1] && clip[i + 2] < a[5] && clip[i + 5] > a[2]);
    if (!inside) for (let k = 0; k < 6; k++) keep.push(clip[i + k]);
  }
  return Float32Array.from(keep);
}

/** the soldiers, zone by zone: spread out, covered spots first, facing the way you'll come */
function metroSpawns(nav: NavGraph, start: Vector3): EnemySpawn[] {
  const rnd = mulberry32(41);
  const out: EnemySpawn[] = [];
  const taken: Vector3[] = [];
  for (const z of ZONES) {
    const [x0, z0, x1, z1] = z.rect;
    const inZone = (p: Vector3) => p.x >= x0 && p.x <= x1 && p.z >= z0 && p.z <= z1 && p.y >= z.y[0] && p.y <= z.y[1];
    const nodes = nav.nodes.filter((n) => n.links.length >= 2 && inZone(n.p) && Vector3.Distance(n.p, start) > 26 && Vector3.Distance(n.p, METRO.boss) > 6);
    const chosen: typeof nodes = [];
    while (chosen.length < z.n && nodes.length) {
      let best = nodes[0], bestD = -Infinity;
      for (const n of nodes) {
        let d = 400;
        for (const t of taken) d = Math.min(d, Vector3.DistanceSquared(n.p, t));
        d += n.cover ? 6 : 0;
        d += rnd() * 4;
        if (d > bestD) (bestD = d), (best = n);
      }
      chosen.push(best);
      taken.push(best.p);
    }
    chosen.forEach((n, i) => {
      const yaw = Math.atan2(start.x - n.p.x, start.z - n.p.z) + (rnd() - 0.5) * 1.6;
      const base: EnemySpawn = { pos: n.p.clone(), yaw, group: z.group, dormant: z.dormant };
      if (i % 3 === 2 && n.cover) return void out.push({ ...base, anchored: true });
      // a short beat through linked nodes inside the zone
      const route = [n.p.clone()];
      let cur = n;
      for (let k = 0; k < 3; k++) {
        const opts = cur.links.map((l) => nav.nodes[l]).filter((m) => inZone(m.p) && Vector3.Distance(m.p, n.p) < 14 && !route.some((r) => Vector3.DistanceSquared(r, m.p) < 1));
        if (!opts.length) break;
        cur = opts[Math.floor(rnd() * opts.length)];
        route.push(cur.p.clone());
      }
      out.push(route.length > 1 ? { ...base, route } : base);
    });
  }
  return out;
}

/** underground: no sun and no sky — the station's own light, a dim fill, black where the tunnels run off */
function lightMetro(env: Environment, scene: Scene) {
  env.sun.direction = new Vector3(0.2, -1, 0.1).normalize();
  env.sun.diffuse = new Color3(1.0, 0.92, 0.8);
  env.sun.intensity = 0.6;
  env.hemi.diffuse = new Color3(0.95, 0.9, 0.82);
  env.hemi.groundColor = new Color3(0.25, 0.24, 0.22);
  env.hemi.intensity = 0.9;
  scene.fogMode = Scene.FOGMODE_EXP2;
  scene.fogDensity = 0.012;
  scene.fogColor = new Color3(0.03, 0.03, 0.035);
  scene.clearColor = new Color4(0.02, 0.02, 0.025, 1);
  env.sky.setEnabled(false);
}

/**
 * The voxeliser links nodes that see each other; through some of the station's doorways and up some
 * stairs no pair did, and the graph fell into islands (the concourse's back rooms, the stairs to the
 * top corridor) — soldiers there could never come for you, nor you be led there. Each island is joined
 * to the rest by its nearest pair of nodes that a man can walk between: nothing in the way at knee and
 * chest height, and floor under every half metre of it.
 */
function bridgeIslands(nav: NavGraph) {
  const nodes = nav.nodes;
  const walkable = (a: Vector3, b: Vector3) => {
    // (the solid geometry only — the invisible edge walls aren't in the way of a level walk; the floor
    // check below keeps a bridge off any drop)
    for (const h of [0.45, 1.3]) if (!nav.clear(a.add(new Vector3(0, h, 0)), b.add(new Vector3(0, h, 0)))) return false;
    const steps = Math.ceil(Vector3.Distance(a, b) / 0.5);
    for (let s = 1; s < steps; s++) {
      const p = Vector3.Lerp(a, b, s / steps);
      const f = nav.floorAt(p.x, p.y + 0.3, p.z, 0.9);
      if (f === null || Math.abs(f - p.y) > 0.55) return false;
    }
    return true;
  };
  for (let round = 0; round < 20; round++) {
    const comp = new Int32Array(nodes.length).fill(-1);
    const size: number[] = [];
    for (let i = 0; i < nodes.length; i++) {
      if (comp[i] >= 0) continue;
      const stack = [i];
      comp[i] = size.length;
      let n = 0;
      while (stack.length) {
        const k = stack.pop()!;
        n++;
        for (const l of nodes[k].links) if (comp[l] < 0) (comp[l] = size.length), stack.push(l);
      }
      size.push(n);
    }
    if (size.length < 2) return;
    let joined = false;
    // each island (smallest first) to its nearest walkable neighbour in another island
    const order = size.map((n, c) => [n, c]).sort((a, b) => a[0] - b[0]).map((x) => x[1]);
    for (const c of order.slice(0, -1)) {
      let best: [number, number] | null = null, bd = Infinity;
      for (let i = 0; i < nodes.length; i++) {
        if (comp[i] !== c) continue;
        for (let j = 0; j < nodes.length; j++) {
          if (comp[j] === c) continue;
          const a = nodes[i].p, b = nodes[j].p;
          const d = Vector3.DistanceSquared(a, b);
          if (d < bd && d < 7 * 7 && Math.abs(a.y - b.y) < 2.2 && walkable(a, b)) (bd = d), (best = [i, j]);
        }
      }
      if (best) {
        nav.link(best[0], best[1]);
        joined = true;
        break;
      }
    }
    if (!joined) return;
  }
}

/**
 * The voxeliser's invisible walls along every drop (--edges) also landed across a few doorways where
 * the floor beyond counted as another cell — walling off ways the nav graph walks (the deep
 * platform's only way to his corridor). Any such wall a nav link runs through is dropped.
 */
function openDoorways(clip: Float32Array, nodes: number[][], links: number[]) {
  const keep: number[] = [];
  const crosses = (b: number, ax: number, ay: number, az: number, bx: number, by: number, bz: number) => {
    // slab test, the segment at waist height, the box grown 0.2 m (a wall it runs through, or one that
    // pinches a doorway narrower than a man; a platform edge a link runs along, half a cell off, stays)
    const g = 0.2;
    let t0 = 0, t1 = 1;
    const o = [ax, ay + 0.9, az], d = [bx - ax, by - ay, bz - az];
    for (let k = 0; k < 3; k++) {
      const lo = clip[b * 6 + k] - (k === 1 ? 0 : g), hi = clip[b * 6 + 3 + k] + (k === 1 ? 0 : g);
      if (Math.abs(d[k]) < 1e-9) {
        if (o[k] < lo || o[k] > hi) return false;
        continue;
      }
      let u = (lo - o[k]) / d[k], v = (hi - o[k]) / d[k];
      if (u > v) [u, v] = [v, u];
      t0 = Math.max(t0, u);
      t1 = Math.min(t1, v);
      if (t0 > t1) return false;
    }
    return true;
  };
  let dropped = 0;
  for (let b = 0; b < clip.length / 6; b++) {
    let hit = false;
    for (let i = 0; i < links.length && !hit; i += 2) {
      const a = nodes[links[i]], c = nodes[links[i + 1]];
      hit = crosses(b, a[0], a[1], a[2], c[0], c[1], c[2]);
    }
    if (hit) dropped++;
    else for (let k = 0; k < 6; k++) keep.push(clip[b * 6 + k]);
  }
  void dropped;
  return Float32Array.from(keep);
}

/**
 * Player clip at the drops: from every nav node, out in 16 directions at half-metre steps, the first
 * place the floor falls away by more than 0.8 m from one step to the next gets an invisible wall (a
 * stair's steps are far smaller) — so nobody walks off a platform into a track trench they can't
 * climb out of. Boxes on a 0.5 m grid, deduplicated (min/max per box, Babylon metres).
 */
function edgeGuards(nav: NavGraph) {
  const seen = new Set<string>();
  const out: number[] = [];
  for (const n of nav.nodes) {
    for (let k = 0; k < 16; k++) {
      const a = (k / 16) * Math.PI * 2, dx = Math.sin(a), dz = Math.cos(a);
      let prev = n.p.y;
      for (let s = 0.5; s <= 3; s += 0.5) {
        const x = n.p.x + dx * s, z = n.p.z + dz * s;
        // (a wall first: nothing to guard past it)
        if (!nav.clear(new Vector3(n.p.x + dx * (s - 0.5), prev + 0.5, n.p.z + dz * (s - 0.5)), new Vector3(x, prev + 0.5, z))) break;
        const f = nav.floorAt(x, prev + 0.3, z, 3);
        if (f !== null && prev - f <= 0.8) {
          prev = f;
          continue;
        }
        // (a drop onto floor that's part of the level — a stairwell's landing, the hall below — is
        // a jump you may take: only drops onto the track beds or into nothing are walled off)
        const below = nav.floorAt(x + dx * 0.5, prev + 0.3, z + dz * 0.5, 6);
        if (below !== null && prev - below > 0.8 && nav.nodes.some((m) => Math.hypot(m.p.x - x, m.p.z - z) < 3.2 && Math.abs(m.p.y - below) < 0.7)) break;
        const gx = Math.floor(x / 0.5) * 0.5, gz = Math.floor(z / 0.5) * 0.5, gy = Math.round(prev * 2) / 2;
        const key = `${gx},${gy},${gz}`;
        if (!seen.has(key)) {
          seen.add(key);
          out.push(gx, prev - 0.2, gz, gx + 0.5, prev + 2.2, gz + 0.5);
        }
        break;
      }
    }
  }
  return Float32Array.from(out);
}

/**
 * A link that grazes a jamb part-way along it (both its nodes clear of walls, the doorway between
 * them pinched on one side): a node is put in at the pinch, slid across to the doorway's middle, and
 * the link goes through it — so a man walking it passes the jamb, not into it.
 */
function centreLinks(nav: NavGraph) {
  const R = 0.5;
  const pairs: [number, number][] = [];
  for (const n of nav.nodes) for (const l of n.links) if (l > n.id) pairs.push([n.id, l]);
  for (const [a, b] of pairs) {
    const pa = nav.nodes[a].p, pb = nav.nodes[b].p;
    const len = Math.hypot(pb.x - pa.x, pb.z - pa.z);
    if (len < 1 || Math.abs(pb.y - pa.y) > 0.3) continue;
    const side = new Vector3(-(pb.z - pa.z) / len, 0, (pb.x - pa.x) / len);
    // the tightest point along it: how far to its left and right is a wall
    let worst = 0, at: Vector3 | null = null, gap = 0;
    for (let s = 0.4; s < len - 0.4; s += 0.2) {
      const p = Vector3.Lerp(pa, pb, s / len).addInPlaceFromFloats(0, 1, 0);
      const hl = nav.rayLevel(p, p.add(side.scale(R))), hr = nav.rayLevel(p, p.subtract(side.scale(R)));
      const l = hl < 0 ? R : hl, r = hr < 0 ? R : hr;
      if (Math.min(l, r) < R && R - Math.min(l, r) > worst) {
        worst = R - Math.min(l, r);
        at = p;
        gap = (l - r) / 2;
      }
    }
    if (!at || Math.abs(gap) < 0.05) continue;
    const m = at.add(side.scale(Math.max(-0.35, Math.min(0.35, gap))));
    const f = nav.floorAt(m.x, m.y - 0.7, m.z, 0.6);
    if (f === null || Math.abs(f - (pa.y + pb.y) / 2) > 0.2) continue;
    const up = new Vector3(0, 1, 0);
    if (!nav.clear(pa.add(up), m) || !nav.clear(m, pb.add(up))) continue;
    const id = nav.add(m.x, f, m.z);
    nav.nodes[a].links = nav.nodes[a].links.filter((l) => l !== b);
    nav.nodes[b].links = nav.nodes[b].links.filter((l) => l !== a);
    nav.link(a, id);
    nav.link(id, b);
  }
}

/**
 * A node hard against a wall (the voxeliser's nodes sit on its cell grid, one of them on a narrow
 * doorway's jamb) has a man walking into the jamb: each node is eased up to 0.3 m away from any solid
 * within 0.65 m of it (the nearer the wall, the harder), if it stays on the same floor.
 */
function centreNodes(nav: NavGraph) {
  for (const n of nav.nodes) {
    const push = new Vector3();
    const at = new Vector3(n.p.x, n.p.y + 1, n.p.z);
    for (let k = 0; k < 8; k++) {
      const a = (k / 8) * Math.PI * 2;
      const d = new Vector3(Math.sin(a), 0, Math.cos(a));
      for (const r of [0.3, 0.45, 0.65]) if (!nav.clear(at, at.add(d.scale(r)))) push.subtractInPlace(d);
    }
    if (push.lengthSquared() < 1e-6) continue;
    push.normalize().scaleInPlace(0.3);
    const to = n.p.add(push);
    const f = nav.floorAt(to.x, to.y + 0.3, to.z, 0.6);
    if (f !== null && Math.abs(f - n.p.y) < 0.2 && nav.clear(at, at.add(push))) n.p.set(to.x, f, to.z);
  }
}
