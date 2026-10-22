import "@babylonjs/loaders/glTF/glTFFileLoader";
import "@babylonjs/loaders/glTF/2.0/glTFLoader";
import "@babylonjs/loaders/glTF/2.0/Extensions/EXT_texture_webp";
import "@babylonjs/loaders/glTF/2.0/Extensions/KHR_materials_unlit";
import { LoadAssetContainerAsync } from "@babylonjs/core/Loading/sceneLoader";
import { Color3, Color4 } from "@babylonjs/core/Maths/math.color";
import { Mesh } from "@babylonjs/core/Meshes/mesh";
import { MeshBuilder } from "@babylonjs/core/Meshes/meshBuilder";
import { PBRMaterial } from "@babylonjs/core/Materials/PBR/pbrMaterial";
import { Scene } from "@babylonjs/core/scene";
import { Texture } from "@babylonjs/core/Materials/Textures/texture";
import { DynamicTexture } from "@babylonjs/core/Materials/Textures/dynamicTexture";
import { makeFbm } from "../render/TextureGen";
import { Vector3 } from "@babylonjs/core/Maths/math.vector";
import { Environment } from "../render/Environment";
import { Materials, TILE } from "../render/Materials";
import { VertexData } from "@babylonjs/core/Meshes/mesh.vertexData";
import { SKY_DESERT, createSkyMaterial } from "../render/Sky";
import { extFor } from "../weapons/ArmsRig";
import type { EnemySpawn, LevelData } from "./KestrelPoint";
import type { MissionConfig } from "../core/Mission";
import { NavGraph } from "./NavGraph";
import { mulberry32 } from "../core/math";
import { chunkMeshes, openSkyTest, visibleSurface, wallTest } from "./Office";
import type { PropKind, PropPlacement } from "./Props";
import dustUrl from "../assets/maps/dust2.glb?url";
import dustDataUrl from "../assets/maps/dust2-data.json?url";

/**
 * SANDSTORM — "De_Dust 2 with real light" by Neo_minigan (CC BY 4.0, after Valve's de_dust2).
 *
 * Built the Frostline way: the model is drawn as-is (unlit, its light baked into 2048² atlases by
 * the artist, at 2048²) and everything the game touches comes from an offline voxelisation of the same
 * triangles (scripts/assets/voxel-map.mjs --u=1.4773 --mode=all): solid boxes for movement,
 * bullets and sight, nav nodes with cover flags and their links, the doorways. Sun and sky are set
 * to match the baked noon light, so the soldiers and your arms sit in it.
 */

/** the Sketchfab export's node scale → Source inches → metres */
const UNIT = 1.4773;

interface DustData {
  voxel: number;
  bounds: { minX: number; maxX: number; minY: number; maxY: number; minZ: number; maxZ: number };
  solid: number[];
  soft: number[];
  clip: number[];
  nodes: number[][];
  links: number[];
  doors?: number[][];
}

export async function buildDust2(scene: Scene, env: Environment, mats: Materials, low: boolean, progress: (p: number, label?: string) => void): Promise<LevelData> {
  // the artist's 4096² atlases at 2048² (~13 MB): the full set needs ~1 GB of video memory and
  // brought the browser to a standstill; the stone grain (below) gives back the close-up detail
  const url = dustUrl;
  const [container, data] = await Promise.all([
    LoadAssetContainerAsync(url, scene, {
      pluginExtension: extFor(url),
      onProgress: (e) => e.lengthComputable && progress((e.loaded / e.total) * 0.85, `Downloading Sandstorm — ${(e.loaded / 1e6).toFixed(1)} / ${(e.total / 1e6).toFixed(1)} MB`),
    }),
    fetch(dustDataUrl).then((r) => r.json() as Promise<DustData>),
  ]);
  progress(0.86, "Placing Sandstorm");
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
  // close up, the baked atlas is ~1 cm per texel: a fine stone grain tiled every ~0.6 m over it keeps
  // walls and floors crisp at arm's length (multiplied in, neutral on average). One shared texture
  // at the atlases' median scale (they range 34–60 m per UV unit).
  const grain = grainTexture(scene, low ? 256 : 512);
  grain.uScale = grain.vScale = atlasScale(container.meshes.filter((m) => m instanceof Mesh) as Mesh[]) / 0.6;
  for (const mat of container.materials) {
    if (mat instanceof PBRMaterial && mat.albedoTexture) {
      // the atlases are seen at grazing angles all the time (long streets): full anisotropy
      mat.albedoTexture.anisotropicFilteringLevel = 16;
      (mat.albedoTexture as Texture).updateSamplingMode(Texture.TRILINEAR_SAMPLINGMODE);
      mat.detailMap.texture = grain;
      mat.detailMap.diffuseBlendLevel = 0.32;
      mat.detailMap.isEnabled = true;
    }
    mat.freeze();
  }
  progress(0.88);

  // ---------------------------------------------------------------- collision chunks
  const solid = Float32Array.from(data.solid);
  const soft = Float32Array.from(data.soft);
  const clip = Float32Array.from(data.clip);
  const colliders: Mesh[] = [
    ...chunkMeshes(scene, solid, "dustSolid", { pick: true }),
    ...chunkMeshes(scene, soft, "dustSoft", { pick: false }),
    ...chunkMeshes(scene, clip, "dustClip", { pick: false }),
  ];
  progress(0.94);

  // the cell's barricades (and the depot's lockers): solid for movement, bullets and sight
  const blocks = Float32Array.from(BARRICADES.flatMap((b) => b.boxes.flat()));
  for (const m of chunkMeshes(scene, blocks, "dustBarricade", { pick: true })) {
    m.metadata = { ...m.metadata, surface: "metal" };
    colliders.push(m);
  }

  // ---------------------------------------------------------------- navigation
  const nb = solid.length / 6, ns = soft.length / 6, nc = clip.length / 6, nk = blocks.length / 6;
  const all = new Float32Array((nb + ns + nc + nk) * 6);
  all.set(solid, 0);
  all.set(soft, nb * 6);
  all.set(clip, (nb + ns) * 6);
  all.set(blocks, (nb + ns + nc) * 6);
  const flags = new Uint8Array(nb + ns + nc + nk);
  flags.fill(3, 0, nb);
  flags.fill(2, nb, nb + ns + nc);
  flags.fill(3, nb + ns + nc);
  const nav = new NavGraph(scene);
  nav.setBoxes(all, flags);
  for (const n of data.nodes) nav.add(n[0], n[1], n[2], n[3] === 1);
  for (let i = 0; i < data.links.length; i += 2) nav.link(data.links[i], data.links[i + 1]);
  // nobody walks through a barricade
  for (const b of BARRICADES) for (const box of b.boxes) cutLinks(nav, box);

  const nodes = nav.nodes;
  const near = (p: Vector3) => {
    let best = nodes[0], bd = Infinity;
    for (const n of nodes) {
      const d = (n.p.x - p.x) ** 2 + (n.p.z - p.z) ** 2 + Math.abs(n.p.y - p.y) * 4;
      if (d < bd && n.links.length >= 2) {
        bd = d;
        best = n;
      }
    }
    return best;
  };
  const start = near(DUST.start);
  const toward = DUST.firstLook;
  const playerYaw = Math.atan2(toward.x - start.p.x, toward.z - start.p.z);
  const enemySpawns = sandstormSpawns(nav, start.p);

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

  lightDesert(env, scene);
  desert(scene, mats, floorMin);
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
    doors: (data.doors ?? []).filter((d) => d[5] < 2.85),
    props: BARRICADES.flatMap((b) => b.props),
  };
}

/** median world metres per UV unit over a material's triangles (the atlases have a uniform texel density) */
function atlasScale(meshes: Mesh[]) {
  const r: number[] = [];
  const a = new Vector3(), b = new Vector3(), c = new Vector3();
  for (const m of meshes) {
    const p = m.getVerticesData("position"), uv = m.getVerticesData("uv"), ix = m.getIndices();
    if (!p || !uv || !ix) continue;
    const W = m.getWorldMatrix();
    for (let i = 0; i < ix.length; i += 3) {
      const i0 = ix[i], i1 = ix[i + 1], i2 = ix[i + 2];
      Vector3.TransformCoordinatesFromFloatsToRef(p[i0 * 3], p[i0 * 3 + 1], p[i0 * 3 + 2], W, a);
      Vector3.TransformCoordinatesFromFloatsToRef(p[i1 * 3], p[i1 * 3 + 1], p[i1 * 3 + 2], W, b);
      Vector3.TransformCoordinatesFromFloatsToRef(p[i2 * 3], p[i2 * 3 + 1], p[i2 * 3 + 2], W, c);
      const area = Vector3.Cross(b.subtract(a), c.subtract(a)).length() / 2;
      const uvArea = Math.abs((uv[i1 * 2] - uv[i0 * 2]) * (uv[i2 * 2 + 1] - uv[i0 * 2 + 1]) - (uv[i2 * 2] - uv[i0 * 2]) * (uv[i1 * 2 + 1] - uv[i0 * 2 + 1])) / 2;
      if (uvArea > 1e-9 && area > 0.05) r.push(Math.sqrt(area / uvArea));
    }
  }
  r.sort((x, y) => x - y);
  return r.length ? r[r.length >> 1] : 0;
}

/**
 * Detail map (Babylon's layout: R = albedo detail around 0.5, G/A = normal detail, B = roughness):
 * sandstone grain — fine mottling, small pits and a few hairline scratches. Only R matters here
 * (the map is unlit); the rest is kept neutral.
 */
function grainTexture(scene: Scene, size: number) {
  const f = makeFbm(901, 8, 5);
  const fine = makeFbm(902, 64, 2);
  const pits = makeFbm(903, 32, 2);
  const tex = new DynamicTexture("dustGrain", { width: size, height: size }, scene, true, Texture.TRILINEAR_SAMPLINGMODE);
  const ctx = tex.getContext() as unknown as CanvasRenderingContext2D;
  const img = ctx.createImageData(size, size);
  for (let y = 0; y < size; y++)
    for (let x = 0; x < size; x++) {
      const u = x / size, v = y / size;
      let r = 0.5 + (f(u, v) - 0.5) * 0.18 + (fine(u, v) - 0.5) * 0.42;
      const pit = pits(u, v);
      if (pit > 0.72) r -= (pit - 0.72) * 1.4;
      const i = (y * size + x) * 4;
      img.data[i] = Math.max(0, Math.min(255, r * 255));
      img.data[i + 1] = 128;
      img.data[i + 2] = 128;
      img.data[i + 3] = 128;
    }
  ctx.putImageData(img, 0, 0);
  tex.update(false);
  tex.wrapU = tex.wrapV = Texture.WRAP_ADDRESSMODE;
  tex.anisotropicFilteringLevel = 8;
  return tex;
}

/** places on the map (Babylon metres) the stage and its mission refer to */
export const DUST = {
  /** insertion: the south square */
  start: new Vector3(20, 0, -78),
  firstLook: new Vector3(34, 0, -56),
  /** the hostage: cuffed to a chair against the south wall of the walled south-west yard, facing the way in */
  hostage: new Vector3(-15.5, 2.5, -67.4),
  hostageYaw: -Math.PI / 2 + 0.35,
  /** the cell's lockers: underground, against the south wall of the tunnel hall (fronts facing north) */
  lockers: { at: new Vector3(38.5, 0.813, -32.46), yaw: 0, count: 4 },
  /** the locked double gate across the long west road (hinged on its walls, x -40.63 … -32.63) */
  gate: { z: -41, x0: -40.63, x1: -32.63, floor: 0, height: 3.2 },
  /** where each stage of the mission is reached */
  market: new Vector3(48, 0, -62),
  tunnels: new Vector3(46, 0.9, -31),
  /** the west site (a checkpoint when you get there) */
  westSite: new Vector3(-24, 0, -10),
};

/** OPERATION SANDSTORM: find where the cell keeps the hostage, then get him out */
export const SANDSTORM: MissionConfig = {
  name: "OPERATION SANDSTORM",
  hostage: { name: "Ambassador Adrian Cole", short: "Ambassador Cole", title: "the UN Special Envoy carrying the signed ceasefire accords" },
  points: { market: DUST.market, tunnels: DUST.tunnels, westSite: DUST.westSite, gate: new Vector3((DUST.gate.x0 + DUST.gate.x1) / 2, DUST.gate.floor, DUST.gate.z) },
  letter: {
    title: "TRANSFER ORDER — 17/10",
    body: [
      "The Ambassador is moved to the south-west yard tonight, past the west gate on the long road. Chair and cuffs, two men on him day and night. The accords stay with me.",
      "The gate key and the cuff key stay on this ring, in this locker, down here. Nobody else touches them.",
      "If the soldiers come for him, he does not leave that yard alive.",
    ],
    sign: "— V.",
  },
  tape: {
    talk: [
      "Wait — soldier. They didn't take me for the accords. They took me for this. Searched me twice and never checked an old man's coat lining.",
      "A Betamax from the back room of the talks. Who paid for the convoy ambush, who sold us out, who's paying the Viper — names, dates, faces. All of it.",
      "This tape is evidence. It's a national secret. If it falls into the wrong hands, the ceasefire dies — and so does everyone on it who helped us.",
    ],
    offer: "Take it. Keep it safe — get it to your commander.",
  },
};

/** the hostage's chair: on the floor at his spot */
export function hostageSpot(nav: NavGraph) {
  const p = DUST.hostage;
  const y = nav.floorAt(p.x, p.y + 0.6, p.z, 1.5);
  return new Vector3(p.x, y ?? p.y, p.z);
}

/** one locker's width and depth (the model's own size) */
export const LOCKER_W = 0.5;
export const LOCKER_D = 0.5;

/** a box: [x0, y0, z0, x1, y1, z1] */
type Box = [number, number, number, number, number, number];

/** a crate model as Props scales it: length along the wall, height, depth (m) */
interface Piece {
  kind: PropKind;
  variant?: number;
  l: number;
  h: number;
  d: number;
}
// "military wooden box" (its six crates are variants, scaled by 0.36), "Ration cardboard box",
// and the game's own ammunition crate and ammo can (the pickups' models)
const WOOD_BIG: Piece[] = [
  { kind: "woodCrate", variant: 0, l: 1.43, h: 0.57, d: 0.89 },
  { kind: "woodCrate", variant: 1, l: 1.43, h: 0.565, d: 0.67 },
];
const WOOD_SMALL: Piece[] = [
  { kind: "woodCrate", variant: 2, l: 0.89, h: 0.44, d: 0.45 },
  { kind: "woodCrate", variant: 5, l: 0.53, h: 0.44, d: 0.45 },
  { kind: "woodCrate", variant: 4, l: 0.82, h: 0.31, d: 0.54 },
];
const AMMO_CRATE: Piece = { kind: "crate", l: 1.6, h: 0.308, d: 0.91 };
const RATION: Piece = { kind: "ration", l: 0.6, h: 0.29, d: 0.4 };
const CAN: Piece = { kind: "ammoCan", l: 0.5, h: 0.286, d: 0.39 };
const WALL_H = 2.3;
/**
 * The cell has walled off the streets that would take you straight to the hostage with piles of
 * supply crates — big wooden crates, a row of ammunition crates, more wooden crates, then ration
 * boxes and small crates thrown on top — wall to wall, about 2.3 m high. Each pile's collision box
 * seals the whole opening (movement, bullets, sight). What's left is one way round the whole town:
 * the market, the tunnels, the depot, their HQ, the west site and the long road, with the locked
 * west gate (level/Gate.ts) the last door to the yard.
 */
const BARRICADES: { name: string; boxes: Box[]; props: PropPlacement[] }[] = [
  // the south square's west doorway (the short way to the long road)
  crateWall("square west", [7.35, -58.5], [7.35, -50.5], -3.25, 11),
  // the bottom of mid (from the south square)
  crateWall("mid south", [6.45, -45], [13.15, -45], -3.25, 12),
  // the lower tunnel's mouth in mid (the tunnels go one way only: north)
  crateWall("mid tunnel", [12.45, -38.6], [12.45, -33.4], -3.25, 13),
  // the lane from the west site down to the yard (the yard is reached by the long road only)
  crateWall("west lane", [-13.15, -41], [-6.45, -41], 0, 14),
  // the cell's lockers in the tunnels (drawn by level/Lockers.ts): their solid box
  { name: "lockers", boxes: [lockerBox()], props: [] },
];

/**
 * A pile of crates from wall to wall along a → b (in plan) on the floor at `y`: rows laid like
 * bricks (each row starts at a different point along), the big wooden crates and the ammunition
 * crates in rows, a loose top layer of ration boxes, small crates and cans; a little turn and
 * shuffle on each so it looks stacked by hand.
 */
function crateWall(name: string, a: [number, number], b: [number, number], y: number, seed: number) {
  const rnd = mulberry32(seed);
  const dx = b[0] - a[0], dz = b[1] - a[1];
  const len = Math.hypot(dx, dz);
  const ux = dx / len, uz = dz / len;
  const rotY = Math.atan2(ux, uz);
  const props: PropPlacement[] = [];
  const put = (p: Piece, t: number, h: number, turn = 0.07) => {
    const side = (rnd() - 0.5) * 0.08;
    props.push({
      kind: p.kind,
      variant: p.variant,
      x: a[0] + ux * t + uz * side,
      y: y + h,
      z: a[1] + uz * t - ux * side,
      rotY: rotY + (rnd() - 0.5) * turn + (rnd() < 0.5 ? Math.PI : 0),
    });
  };
  let h = 0;
  const rows: Piece[][] = [WOOD_BIG, [AMMO_CRATE], WOOD_BIG, WOOD_BIG];
  rows.forEach((choices, row) => {
    let t = -rnd() * 0.7 - (row % 2) * 0.5;
    let rowH = 0;
    while (t < len) {
      const p = choices[Math.floor(rnd() * choices.length)];
      put(p, Math.min(len - 0.1, Math.max(0.1, t + p.l / 2)), h);
      rowH = Math.max(rowH, p.h);
      t += p.l + 0.03;
    }
    h += rowH;
  });
  // the loose top: ration boxes, small crates, the odd can
  const top: Piece[] = [RATION, RATION, RATION, ...WOOD_SMALL, CAN];
  for (let t = 0.2 + rnd() * 0.4; t < len - 0.2; ) {
    const p = top[Math.floor(rnd() * top.length)];
    put(p, Math.min(len - p.l / 2, t + p.l / 2), h, 0.5);
    t += p.l + 0.15 + rnd() * 0.6;
  }
  // the solid box: the pile's footprint (as deep as the biggest crates), its height
  const half = Math.max(...WOOD_BIG.map((p) => p.d), AMMO_CRATE.d) / 2 + 0.05;
  const xs = [a[0] - uz * half, a[0] + uz * half, b[0] - uz * half, b[0] + uz * half];
  const zs = [a[1] + ux * half, a[1] - ux * half, b[1] + ux * half, b[1] - ux * half];
  const box: Box = [Math.min(...xs), y, Math.min(...zs), Math.max(...xs), y + WALL_H, Math.max(...zs)];
  return { name, boxes: [box], props };
}

function lockerBox(): Box {
  const L = DUST.lockers;
  const half = (L.count * LOCKER_W) / 2;
  // (their backs on the wall at L.at, fronts facing L.yaw: north (0) or south (π); abreast along x)
  const z0 = Math.cos(L.yaw) > 0 ? L.at.z : L.at.z - LOCKER_D - 0.02;
  return [L.at.x - half, L.at.y, z0, L.at.x + half, L.at.y + 1.8, z0 + LOCKER_D + 0.02];
}

/** drop the nav links that pass through a box (in plan) */
function cutLinks(nav: NavGraph, b: Box) {
  nav.cutLinks(b[0], b[2], b[3], b[5]);
}

/**
 * Who's where, by the part of town they hold (x0, z0, x1, z1): two soldiers in each. The first two
 * parts are awake from the start; the mission wakes the rest as you work your way round.
 */
const ZONES: { group: string; rect: [number, number, number, number]; n: number; dormant: boolean }[] = [
  { group: "market", rect: [33, -82, 62, -44], n: 2, dormant: false },
  { group: "tunnels", rect: [22, -40, 58, -22], n: 2, dormant: false },
  { group: "depot", rect: [26, -8, 56, 27], n: 2, dormant: true },
  { group: "hq", rect: [-12, 6, 24, 28], n: 2, dormant: true },
  { group: "mid", rect: [5, -32, 14, -5], n: 2, dormant: true },
  { group: "west", rect: [-45, -30, -10, 10], n: 2, dormant: true },
  { group: "long", rect: [-42, -40, -32, -30], n: 2, dormant: true },
  { group: "yard", rect: [-34, -71, -8, -58], n: 2, dormant: true },
  { group: "lane", rect: [-36, -58.5, -12, -50], n: 2, dormant: true },
];

function sandstormSpawns(nav: NavGraph, start: Vector3): EnemySpawn[] {
  const rnd = mulberry32(23);
  const out: EnemySpawn[] = [];
  const taken: Vector3[] = [];
  const hs = DUST.hostage;
  for (const z of ZONES) {
    const [x0, z0, x1, z1] = z.rect;
    const inZone = (p: Vector3) => p.x >= x0 && p.x <= x1 && p.z >= z0 && p.z <= z1;
    const nodes = nav.nodes.filter(
      (n) =>
        n.links.length >= 2 &&
        inZone(n.p) &&
        Vector3.Distance(n.p, start) > 22 &&
        // (the yard guards keep off the hostage's chair)
        Math.hypot(n.p.x - hs.x, n.p.z - hs.z) > 3.5,
    );
    const chosen: typeof nodes = [];
    while (chosen.length < z.n && nodes.length) {
      // spread out (farthest from everyone already placed), covered spots first
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
      // they face the way you'll come from: towards the start, roughly
      const yaw = Math.atan2(start.x - n.p.x, start.z - n.p.z) + (rnd() - 0.5) * 1.6;
      const base: EnemySpawn = { pos: n.p.clone(), yaw, group: z.group, dormant: z.dormant };
      if (z.group === "yard" && i < 2) {
        // two of them stand over the hostage
        out.push({ ...base, yaw: Math.atan2(hs.x - n.p.x, hs.z - n.p.z), anchored: true });
        return;
      }
      if (i % 3 === 2 && n.cover) return void out.push({ ...base, anchored: true });
      // a short beat through linked nodes inside the zone
      const route = [n.p.clone()];
      let cur = n;
      for (let k = 0; k < 3; k++) {
        const opts = cur.links.map((l) => nav.nodes[l]).filter((m) => inZone(m.p) && Vector3.Distance(m.p, n.p) < 12 && !route.some((r) => Vector3.DistanceSquared(r, m.p) < 1));
        if (!opts.length) break;
        cur = opts[Math.floor(rnd() * opts.length)];
        route.push(cur.p.clone());
      }
      out.push(route.length > 1 ? { ...base, route } : base);
    });
  }
  return out;
}

/**
 * The desert round the town (only seen from the rooftops and the briefing's sky shots): sand at
 * the foot of the town's walls, rolling into dunes, then a ring of dark rocky mesas on the horizon.
 */
function desert(scene: Scene, mats: Materials, floorMin: number) {
  const cx = 8, cz = -27; // the town's centre
  const NA = 160, NR = 36;
  const pos: number[] = [], uv: number[] = [], col: number[] = [], idx: number[] = [];
  const tile = TILE.sand ?? 5;
  for (let r = 0; r <= NR; r++) {
    const t = r / NR;
    const rad = 48 + 1400 * Math.pow(t, 1.8);
    for (let i = 0; i <= NA; i++) {
      const a = (i / NA) * Math.PI * 2;
      const x = cx + Math.cos(a) * rad * 1.15, z = cz + Math.sin(a) * rad;
      // dunes rising away from town, then the mesas
      const dune = (Math.sin(x * 0.045 + Math.sin(z * 0.03) * 2) * 0.5 + 0.5) * Math.min(1, t * 5) * 9;
      const mesa = Math.max(0, Math.sin(a * 5 + 1.2) * 0.6 + Math.sin(a * 11) * 0.4) ** 0.6 * Math.max(0, t - 0.45) * 220;
      const y = floorMin - 1.5 + dune + mesa;
      pos.push(x, y, z);
      uv.push(x / tile, z / tile);
      const rock = Math.min(1, mesa / 25);
      col.push(1 - rock * 0.45, 0.94 - rock * 0.5, 0.86 - rock * 0.52, 1);
    }
  }
  for (let r = 0; r < NR; r++)
    for (let i = 0; i < NA; i++) {
      const a = r * (NA + 1) + i, b = a + NA + 1;
      idx.push(a, b, a + 1, a + 1, b, b + 1);
    }
  // the middle under the town
  const m = new Mesh("desert", scene);
  const vd = new VertexData();
  vd.positions = pos;
  vd.indices = idx;
  vd.uvs = uv;
  vd.colors = col;
  const nrm: number[] = [];
  VertexData.ComputeNormals(pos, idx, nrm);
  vd.normals = nrm;
  vd.applyToMesh(m);
  m.material = mats.m.sand;
  m.isPickable = false;
  m.freezeWorldMatrix();
  const under = MeshBuilder.CreateDisc("desertUnder", { radius: 50, tessellation: 48 }, scene);
  under.rotation.x = Math.PI / 2;
  under.scaling.x = 1.15;
  under.position.set(cx, floorMin - 1.5, cz);
  under.material = mats.m.sand;
  under.isPickable = false;
  under.freezeWorldMatrix();
}

/**
 * Hard desert noon to match the baked light: a high, warm sun, a bright sky fill, no fog to speak
 * of. The map is unlit — these lights are for the soldiers, the weapons and the effects.
 */
function lightDesert(env: Environment, scene: Scene) {
  const sunDir = new Vector3(-0.35, -0.82, 0.45).normalize();
  env.sun.direction = sunDir;
  env.sun.diffuse = new Color3(1.0, 0.92, 0.8);
  env.sun.intensity = 3.0;
  env.hemi.diffuse = new Color3(0.78, 0.82, 0.88);
  env.hemi.groundColor = new Color3(0.55, 0.45, 0.32);
  env.hemi.intensity = 0.95;
  scene.fogMode = Scene.FOGMODE_EXP2;
  scene.fogDensity = 0.0022;
  scene.fogColor = new Color3(0.86, 0.82, 0.74);
  scene.clearColor = new Color4(0.86, 0.82, 0.74, 1);
  env.sky.material = createSkyMaterial(scene, sunDir.scale(-1), SKY_DESERT);
  // the map takes no shadows (unlit): don't render a shadow map every frame
  env.shadows.getShadowMap()!.refreshRate = 0;
}
