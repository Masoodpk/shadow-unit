import "@babylonjs/loaders/glTF/glTFFileLoader";
import "@babylonjs/loaders/glTF/2.0/glTFLoader";
import "@babylonjs/loaders/glTF/2.0/Extensions/EXT_texture_webp";
import "@babylonjs/loaders/glTF/2.0/Extensions/KHR_materials_unlit";
import "@babylonjs/core/Culling/Octrees/octreeSceneComponent";
import { LoadAssetContainerAsync } from "@babylonjs/core/Loading/sceneLoader";
import { Mesh } from "@babylonjs/core/Meshes/mesh";
import { PBRMaterial } from "@babylonjs/core/Materials/PBR/pbrMaterial";
import { Scene } from "@babylonjs/core/scene";
import { Vector3 } from "@babylonjs/core/Maths/math.vector";
import { Color3 } from "@babylonjs/core/Maths/math.color";
import { VertexData } from "@babylonjs/core/Meshes/mesh.vertexData";
import { HitKind } from "../config/game";
import { mulberry32 } from "../core/math";
import { Environment } from "../render/Environment";
import type { EnemySpawn, LevelData } from "./KestrelPoint";
import { NavGraph } from "./NavGraph";
import { extFor } from "../weapons/ArmsRig";
import officeUrl from "../assets/maps/office.glb?url";
import officeDataUrl from "../assets/maps/office-data.json?url";
import treeUrl from "../assets/props/tree_lowpoly.glb?url";
import { InstancedMesh } from "@babylonjs/core/Meshes/instancedMesh";
import { AbstractMesh } from "@babylonjs/core/Meshes/abstractMesh";
import { Ray } from "@babylonjs/core/Culling/ray";

/**
 * OFFICE — "CS_OFFICE (CS:GO Real Light version)" by Neo_minigan (CC BY 4.0, after Valve's cs_office).
 *
 * The visual model is drawn as-is (unlit, lighting baked into its textures; Source inches → metres).
 * Everything the game *touches* comes from an offline voxelisation of the same triangles
 * (12.5 cm voxels, greedy-merged into boxes, limited to what the player can reach):
 *   solid  blocks movement, bullets and sight
 *   soft   glass, fences, foliage — blocks movement only
 *   clip   invisible walls where the playable floor ends (the original map's player clips)
 * plus nav nodes with cover flags and their line-of-sight links. The boxes become a few hundred
 * invisible chunk meshes (8 m), each split into small sub-meshes with an octree, so movement and
 * bullet picks only test the triangles next to them.
 */

const UNIT = 0.0254;

/**
 * Frostline's windows that must stay shut when broken (found by jumping through every one of the 131
 * panes from each side with floor): the south and west walls drop you outside the map, 30–50 m from
 * any floor; (-42.3, -21.2) catches you in its frame. The other panes either stop you or land you on playable floor, and are left as they are.
 */
const OFFICE_SEALED_GLASS: [number, number, number][] = [
  [-35.97, -2.6, -26.92], [-30.48, -2.6, -26.92], [-23.98, -2.6, -26.92], [-22.96, -2.6, -26.92], [-18.08, -2.6, -26.92],
  [-42.27, -2.6, -21.23],
  [-46.02, -2.6, -18.49], [-46.02, -2.6, -17.48], [-46.02, -2.6, -16.26], [-46.02, -2.6, -15.24],
];
const CHUNK = 8;

interface OfficeData {
  voxel: number;
  bounds: { minX: number; maxX: number; minY: number; maxY: number; minZ: number; maxZ: number };
  solid: number[];
  soft: number[];
  clip: number[];
  /** x, y (floor), z, cover per node */
  nodes: number[][];
  links: number[];
  doors?: number[][];
}

/**
 * The mission's playback station (level/PlaybackStation): a desk of its own (w × d) in the middle of
 * the office west of the corridor, its front to the room's door (+x) — clear of the room's baked
 * chairs and of the nav node beside it
 */
export const OFFICE_STATION = { at: new Vector3(-39.2, -4, -8.4), yaw: Math.PI / 2, w: 1.4, d: 0.75 };

/** the T-side yard with the truck: where the player is inserted */
const PLAYER_START = new Vector3(-38, 0, 38);

export async function buildOffice(scene: Scene, env: Environment, progress: (p: number, label?: string) => void): Promise<LevelData> {
  const [container, data, treeC] = await Promise.all([
    LoadAssetContainerAsync(officeUrl, scene, {
      pluginExtension: extFor(officeUrl),
      onProgress: (e) => e.lengthComputable && progress((e.loaded / e.total) * 0.85, `Downloading Frostline — ${(e.loaded / 1e6).toFixed(1)} / ${(e.total / 1e6).toFixed(1)} MB`),
    }),
    fetch(officeDataUrl).then((r) => r.json() as Promise<OfficeData>),
    LoadAssetContainerAsync(treeUrl, scene, { pluginExtension: extFor(treeUrl) }).catch((e) => {
      console.warn("tree model failed, keeping the map's own trees", e);
      return null;
    }),
  ]);
  progress(0.86, "Placing Frostline");
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
  // the map's trees → the low-poly tree model (before materials are frozen)
  if (treeC) replaceTrees(container.meshes, treeC);
  for (const mat of container.materials) {
    // foliage, fences, grates: alpha-blended in the source, which washes them out and sorts badly.
    // Alpha-tested cut-outs draw crisp leaves, write depth and cast proper silhouettes.
    if (/^TRANS/.test(mat.name) && mat instanceof PBRMaterial) {
      // test away the empty parts, blend the soft edges (leaves stay smooth, depth stays right)
      mat.transparencyMode = PBRMaterial.PBRMATERIAL_ALPHATESTANDBLEND;
      mat.alphaCutOff = 0.2;
      mat.needDepthPrePass = true;
      mat.useAlphaFromAlbedoTexture = true;
      mat.backFaceCulling = false;
      mat.twoSidedLighting = true;
      if (mat.albedoTexture) mat.albedoTexture.hasAlpha = true;
    }
    mat.freeze();
  }
  progress(0.88);

  // ---------------------------------------------------------------- collision chunks
  const solid = Float32Array.from(data.solid);
  const soft = Float32Array.from(data.soft);
  const clip = Float32Array.from(data.clip);
  const colliders: Mesh[] = [
    ...chunkMeshes(scene, solid, "officeSolid", { pick: true }),
    ...chunkMeshes(scene, soft, "officeSoft", { pick: false }),
    ...chunkMeshes(scene, clip, "officeClip", { pick: false }),
  ];
  progress(0.94);

  // ---------------------------------------------------------------- navigation (AABBs + grid for AI rays)
  const nb = solid.length / 6, ns = soft.length / 6, nc = clip.length / 6;
  const all = new Float32Array((nb + ns + nc) * 6);
  all.set(solid, 0);
  all.set(soft, nb * 6);
  all.set(clip, (nb + ns) * 6);
  const flags = new Uint8Array(nb + ns + nc);
  flags.fill(3, 0, nb); // solid: sight + movement
  flags.fill(2, nb); // soft & clip: movement only
  const nav = new NavGraph(scene);
  nav.setBoxes(all, flags);
  for (const n of data.nodes) nav.add(n[0], n[1], n[2], n[3] === 1);
  for (let i = 0; i < data.links.length; i += 2) nav.link(data.links[i], data.links[i + 1]);

  // ---------------------------------------------------------------- spawns
  const nodes = nav.nodes;
  let start = nodes[0];
  let bd = Infinity;
  for (const n of nodes) {
    const d = (n.p.x - PLAYER_START.x) ** 2 + (n.p.z - PLAYER_START.z) ** 2;
    if (d < bd && n.links.length >= 2) {
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

  const glassMesh = container.meshes.find((m) => /GLASS/.test(m.name)) as Mesh | undefined;
  env.indoor();
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
    sealedGlass: OFFICE_SEALED_GLASS,
    surfaceAt: visibleSurface(scene, container.meshes),
    openSky: openSkyTest(scene, container.meshes),
    wallAt: wallTest(scene, container.meshes),
    // only real doorways: an opening with a lintel (no top found under 2.85 m = an outdoor gap)
    doors: (data.doors ?? []).filter((d) => d[5] < 2.85),
  };
}

/**
 * Hostiles spread through the office, away from the insertion point: farthest-point sampling
 * over nav nodes, every one at least 20 m from the player. About a third hold a covered spot,
 * the rest patrol a short loop of nearby nodes.
 */
export function pickEnemySpawns(nav: NavGraph, from: Vector3, count: number): EnemySpawn[] {
  const rnd = mulberry32(11);
  // nobody may see the insertion point: you arrive unseen, and they only notice you once you
  // move into their area (no line of sight from a soldier's head to anywhere near the start)
  const eyes = [0, 1.5, -1.5].flatMap((dx) => [0, 1.5, -1.5].map((dz) => new Vector3(from.x + dx, from.y + 1.6, from.z + dz)));
  const hidden = (p: Vector3) => {
    const head = new Vector3(p.x, p.y + 1.6, p.z);
    return eyes.every((e) => !nav.clear(head, e));
  };
  const nodes = nav.nodes.filter((n) => n.links.length >= 2 && Vector3.Distance(n.p, from) > 28 && hidden(n.p));
  const chosen: typeof nodes = [];
  // start from the node farthest from the player
  let first = nodes[0];
  for (const n of nodes) if (Vector3.DistanceSquared(n.p, from) > Vector3.DistanceSquared(first.p, from)) first = n;
  chosen.push(first);
  while (chosen.length < count && chosen.length < nodes.length) {
    let best = nodes[0];
    let bestD = -1;
    for (const n of nodes) {
      let d = Infinity;
      for (const c of chosen) d = Math.min(d, Vector3.DistanceSquared(n.p, c.p));
      // keep a little pull towards the player so the fight isn't all at the far end
      d -= Vector3.Distance(n.p, from) * 0.6;
      if (d > bestD) {
        bestD = d;
        best = n;
      }
    }
    chosen.push(best);
  }
  return chosen.map((n, i) => {
    const yaw = Math.atan2(from.x - n.p.x, from.z - n.p.z) + (rnd() - 0.5) * 1.2;
    if (i % 3 === 2 && n.cover) return { pos: n.p.clone(), yaw, anchored: true };
    // patrol: a loop through linked nodes within ~12 m
    const route = [n.p.clone()];
    let cur = n;
    for (let k = 0; k < 3; k++) {
      const opts = cur.links.map((l) => nav.nodes[l]).filter((m) => Vector3.Distance(m.p, n.p) < 12 && Vector3.Distance(m.p, from) > 28 && hidden(m.p) && !route.some((r) => Vector3.DistanceSquared(r, m.p) < 1));
      if (!opts.length) break;
      cur = opts[Math.floor(rnd() * opts.length)];
      route.push(cur.p.clone());
    }
    return route.length > 1 ? { pos: n.p.clone(), yaw, route } : { pos: n.p.clone(), yaw };
  });
}

/** Invisible collision meshes from boxes, grouped per 8 m chunk, with a sub-mesh octree each. */
export function chunkMeshes(scene: Scene, boxes: Float32Array, name: string, o: { pick: boolean }) {
  const groups = new Map<string, number[]>();
  for (let i = 0; i < boxes.length / 6; i++) {
    const b = i * 6;
    const cx = Math.floor((boxes[b] + boxes[b + 3]) / 2 / CHUNK);
    const cz = Math.floor((boxes[b + 2] + boxes[b + 5]) / 2 / CHUNK);
    const k = cx + "," + cz;
    const l = groups.get(k) ?? [];
    l.push(i);
    groups.set(k, l);
  }
  const tpl = VertexData.CreateBox({ size: 1 });
  const tp = tpl.positions!;
  const ti = tpl.indices!;
  const tv = tp.length / 3;
  const meshes: Mesh[] = [];
  let n = 0;
  for (const list of groups.values()) {
    // spatial order inside the chunk so each sub-mesh is a compact cluster of boxes
    list.sort((a, b) => {
      const ka = Math.floor(boxes[a * 6 + 2] / 2) * 64 + Math.floor(boxes[a * 6] / 2);
      const kb = Math.floor(boxes[b * 6 + 2] / 2) * 64 + Math.floor(boxes[b * 6] / 2);
      return ka - kb || boxes[a * 6 + 1] - boxes[b * 6 + 1];
    });
    const pos = new Float32Array(list.length * tv * 3);
    const idx = new Uint32Array(list.length * ti.length);
    list.forEach((bi, j) => {
      const b = bi * 6;
      const sx = boxes[b + 3] - boxes[b], sy = boxes[b + 4] - boxes[b + 1], sz = boxes[b + 5] - boxes[b + 2];
      const cx = boxes[b] + sx / 2, cy = boxes[b + 1] + sy / 2, cz = boxes[b + 2] + sz / 2;
      for (let v = 0; v < tv; v++) {
        pos[(j * tv + v) * 3] = cx + tp[v * 3] * sx;
        pos[(j * tv + v) * 3 + 1] = cy + tp[v * 3 + 1] * sy;
        pos[(j * tv + v) * 3 + 2] = cz + tp[v * 3 + 2] * sz;
      }
      for (let k = 0; k < ti.length; k++) idx[j * ti.length + k] = ti[k] + j * tv;
    });
    const mesh = new Mesh(`${name}${n++}`, scene);
    const vd = new VertexData();
    vd.positions = pos;
    vd.indices = idx;
    vd.applyToMesh(mesh, false);
    mesh.isVisible = false;
    mesh.checkCollisions = true;
    mesh.isPickable = o.pick;
    mesh.metadata = { kind: HitKind.Level, surface: "concrete" };
    if (list.length > 6) {
      mesh.subdivide(Math.ceil(list.length / 4));
      mesh.createOrUpdateSubmeshesOctree(16, 3);
      mesh.useOctreeForCollisions = true;
      // not for picking: Babylon's sub-mesh octree pick ignores the ray length and reports phantom
      // hits (bullets stopping in mid-air, sight lines that disagree with the AI's); plain picking is
      // exact and measured faster here anyway
      mesh.useOctreeForPicking = false;
    }
    mesh.freezeWorldMatrix();
    mesh.doNotSyncBoundingInfo = true;
    meshes.push(mesh);
  }
  return meshes;
}

/**
 * Swap the map's trees for the low-poly tree model. The trees live in the TRANS4 foliage mesh as
 * connected pieces: each trunk-and-branch card set is one big piece ~9.7 m tall, with smaller crown
 * cards around it. Every triangle inside a tree's footprint and height is dropped from the index
 * buffer, and a new tree is planted at the same base, scaled to the same height. (The voxel
 * colliders around the old trunks stay: they still block the trunk of the new tree.)
 */
function replaceTrees(mapMeshes: AbstractMesh[], treeC: import("@babylonjs/core/assetContainer").AssetContainer) {
  const foliage = mapMeshes.find((m) => /TRANS4/.test(m.name)) as Mesh | undefined;
  if (!foliage) return [];
  foliage.computeWorldMatrix(true);
  const W = foliage.getWorldMatrix();
  const pos = foliage.getVerticesData("position");
  const idx = foliage.getIndices();
  if (!pos || !idx) return [];
  const nv = pos.length / 3;
  const wp = new Float32Array(pos.length);
  const t = new Vector3();
  for (let i = 0; i < nv; i++) {
    Vector3.TransformCoordinatesFromFloatsToRef(pos[i * 3], pos[i * 3 + 1], pos[i * 3 + 2], W, t);
    wp[i * 3] = t.x;
    wp[i * 3 + 1] = t.y;
    wp[i * 3 + 2] = t.z;
  }
  // connected pieces: weld equal positions, join triangle corners
  const parent = new Int32Array(nv).map((_, i) => i);
  const find = (a: number) => {
    while (parent[a] !== a) a = parent[a] = parent[parent[a]];
    return a;
  };
  const unite = (a: number, b: number) => {
    a = find(a);
    b = find(b);
    if (a !== b) parent[a] = b;
  };
  const weld = new Map<string, number>();
  for (let i = 0; i < nv; i++) {
    const k = `${Math.round(wp[i * 3] * 100)},${Math.round(wp[i * 3 + 1] * 100)},${Math.round(wp[i * 3 + 2] * 100)}`;
    const j = weld.get(k);
    if (j === undefined) weld.set(k, i);
    else unite(i, j);
  }
  for (let i = 0; i < idx.length; i += 3) {
    unite(idx[i], idx[i + 1]);
    unite(idx[i], idx[i + 2]);
  }
  const comps = new Map<number, { n: number; b: number[] }>();
  for (let i = 0; i < nv; i++) {
    const r = find(i);
    let c = comps.get(r);
    if (!c) comps.set(r, (c = { n: 0, b: [Infinity, Infinity, Infinity, -Infinity, -Infinity, -Infinity] }));
    c.n++;
    for (let k = 0; k < 3; k++) {
      c.b[k] = Math.min(c.b[k], wp[i * 3 + k]);
      c.b[k + 3] = Math.max(c.b[k + 3], wp[i * 3 + k]);
    }
  }
  const sites: { x: number; z: number; y0: number; y1: number; r: number }[] = [];
  for (const c of comps.values()) {
    const h = c.b[4] - c.b[1];
    if (c.n >= 200 && h > 8) sites.push({ x: (c.b[0] + c.b[3]) / 2, z: (c.b[2] + c.b[5]) / 2, y0: c.b[1], y1: c.b[4], r: Math.max(c.b[3] - c.b[0], c.b[5] - c.b[2]) / 2 + 1.4 });
  }
  if (!sites.length) return [];
  // drop every triangle inside a tree (its centroid within the footprint and height)
  const keep: number[] = [];
  for (let i = 0; i < idx.length; i += 3) {
    const a = idx[i] * 3, b = idx[i + 1] * 3, c = idx[i + 2] * 3;
    const cx = (wp[a] + wp[b] + wp[c]) / 3, cy = (wp[a + 1] + wp[b + 1] + wp[c + 1]) / 3, cz = (wp[a + 2] + wp[b + 2] + wp[c + 2]) / 3;
    const inTree = sites.some((s) => Math.hypot(cx - s.x, cz - s.z) < s.r && cy > s.y0 - 0.3 && cy < s.y1 + 1.5);
    if (!inTree) keep.push(idx[i], idx[i + 1], idx[i + 2]);
  }
  foliage.setIndices(keep);

  // the model: two tree variants side by side under a scaled root — bake each into its own
  // origin-based mesh (base centre at 0,0,0), then instance
  treeC.addAllToScene();
  const variants: Mesh[] = [];
  for (const m of treeC.meshes) {
    if (!(m instanceof Mesh) || !m.getTotalVertices()) continue;
    m.computeWorldMatrix(true);
    m.setParent(null);
    m.bakeCurrentTransformIntoVertices();
    m.refreshBoundingInfo();
    const bb = m.getBoundingInfo().boundingBox;
    const cx = (bb.minimumWorld.x + bb.maximumWorld.x) / 2, cz = (bb.minimumWorld.z + bb.maximumWorld.z) / 2;
    m.position.set(-cx, -bb.minimumWorld.y, -cz);
    m.bakeCurrentTransformIntoVertices();
    m.refreshBoundingInfo();
    m.isPickable = false;
    m.checkCollisions = false;
    m.isVisible = false;
    variants.push(m);
  }
  for (const n of treeC.transformNodes) if (!n.getChildMeshes().length) n.dispose();
  for (const mat of treeC.materials) {
    if (!(mat instanceof PBRMaterial)) continue;
    // the source blends the whole tree at 82 % alpha (see-through trunks, sorting errors): cut-out leaves instead
    mat.alpha = 1;
    mat.transparencyMode = PBRMaterial.PBRMATERIAL_ALPHATEST;
    mat.alphaCutOff = 0.45;
    mat.useAlphaFromAlbedoTexture = true;
    if (mat.albedoTexture) mat.albedoTexture.hasAlpha = true;
    mat.backFaceCulling = false;
    mat.twoSidedLighting = true;
    // a winter tint: leaves a little desaturated and frosted, like the rest of the snowy yard
    mat.albedoColor = new Color3(0.86, 0.92, 0.96);
    mat.metallic = 0;
    mat.roughness = 0.9;
    mat.environmentIntensity = 0.6;
    mat.maxSimultaneousLights = 2;
  }
  if (!variants.length) return [];
  const rnd = mulberry32(7);
  const placed: InstancedMesh[] = [];
  sites.forEach((s, i) => {
    const src = variants[i % variants.length];
    const h = src.getBoundingInfo().boundingBox.maximumWorld.y || 1;
    const inst = src.createInstance("tree" + i);
    // a touch shorter than the old trees' card tips, with some natural variation
    const k = ((s.y1 - s.y0) * (0.82 + rnd() * 0.16)) / h;
    inst.scaling.setAll(k);
    inst.position.set(s.x, s.y0, s.z);
    inst.rotation.y = rnd() * Math.PI * 2;
    inst.isPickable = false;
    inst.computeWorldMatrix(true);
    inst.freezeWorldMatrix();
    placed.push(inst);
  });
  return placed;
}

/**
 * The visible map surface under a point (a pick against the drawn meshes, not the voxel boxes,
 * which sit up to a voxel above or below it), and whether that surface is snow: the colour of the
 * ground texture under the point (bright and grey-white = snow; asphalt, concrete, carpet and wood
 * are darker or coloured). Textures are read back once per material at 1/8 size. Results are
 * cached on a 25 cm grid.
 */
export function visibleSurface(scene: Scene, mapMeshes: AbstractMesh[]) {
  const ground = new Set(mapMeshes.filter((m) => m.getTotalVertices() > 0 && !/TRANS|GLASS|decals|WIRE|BACK/.test(m.name)));
  const ray = new Ray(Vector3.Zero(), new Vector3(0, -1, 0), 1.2);
  const cache = new Map<string, { y: number; snow: boolean } | null>();
  const texels = new Map<unknown, { w: number; h: number; d: Uint8Array } | "pending" | null>();
  const LEVEL = 3;
  const lumaAt = (mat: unknown, u: number, v: number): number | null => {
    const tex = (mat as PBRMaterial | undefined)?.albedoTexture;
    if (!tex) return null;
    const t = texels.get(tex);
    if (t === undefined) {
      texels.set(tex, "pending");
      const size = tex.getSize();
      const w = Math.max(1, size.width >> LEVEL), h = Math.max(1, size.height >> LEVEL);
      void tex
        .readPixels(0, LEVEL)
        ?.then((d) => texels.set(tex, d ? { w, h, d: new Uint8Array(d.buffer, d.byteOffset, d.byteLength) } : null))
        .catch(() => texels.set(tex, null));
      return null;
    }
    if (!t || t === "pending") return null;
    const x = Math.min(t.w - 1, Math.max(0, Math.floor((((u % 1) + 1) % 1) * t.w)));
    const y = Math.min(t.h - 1, Math.max(0, Math.floor((((v % 1) + 1) % 1) * t.h)));
    const i = (y * t.w + x) * 4;
    const r = t.d[i], g = t.d[i + 1], b = t.d[i + 2];
    // snow: bright and nearly colourless in the light; in the baked shadows it turns a clear blue
    // (concrete and asphalt in shade stay grey, so blue-over-red is the tell)
    const luma = (0.3 * r + 0.59 * g + 0.11 * b) / 255;
    const sat = (Math.max(r, g, b) - Math.min(r, g, b)) / 255;
    if (sat < 0.16 && luma > 0.5) return 1;
    return b > 105 && b > r + 28 && b >= g ? 1 : 0;
  };
  return (x: number, y: number, z: number) => {
    const key = `${Math.round(x * 4)},${Math.round(y * 2)},${Math.round(z * 4)}`;
    const c = cache.get(key);
    if (c !== undefined) return c;
    ray.origin.set(x, y + 0.6, z);
    const hit = scene.pickWithRay(ray, (m) => ground.has(m), false);
    if (!hit?.hit || !hit.pickedPoint) {
      cache.set(key, null);
      return null;
    }
    const uv = hit.getTextureCoordinates();
    const l = uv ? lumaAt(hit.pickedMesh?.material, uv.x, uv.y) : null;
    const res = { y: hit.pickedPoint.y, snow: l === 1 };
    // texture not read back yet: answer, but don't remember the answer
    if (l !== null) cache.set(key, res);
    return res;
  };
}

/**
 * Open sky above a point? A pick straight up against everything drawn (roofs, porches, ceilings,
 * walkways — the collision voxels only cover what the player can reach, not every ceiling).
 * Cached on a 50 cm grid.
 */
export function openSkyTest(scene: Scene, mapMeshes: AbstractMesh[]) {
  const all = new Set(mapMeshes.filter((m) => m.getTotalVertices() > 0 && !/GLASS|decals|WIRE|BACK/.test(m.name)));
  const ray = new Ray(Vector3.Zero(), new Vector3(0, 1, 0), 60);
  const cache = new Map<string, boolean>();
  return (x: number, y: number, z: number) => {
    const key = `${Math.round(x * 2)},${Math.round(y)},${Math.round(z * 2)}`;
    const c = cache.get(key);
    if (c !== undefined) return c;
    ray.origin.set(x, y + 0.3, z);
    const open = !scene.pickWithRay(ray, (m) => all.has(m), true)?.hit;
    cache.set(key, open);
    return open;
  };
}

/** distance to the drawn wall along a horizontal ray (the voxel walls are up to 12.5 cm off it) */
export function wallTest(scene: Scene, mapMeshes: AbstractMesh[]) {
  const all = new Set(mapMeshes.filter((m) => m.getTotalVertices() > 0 && !/TRANS|GLASS|decals|WIRE|BACK/.test(m.name)));
  const ray = new Ray(Vector3.Zero(), new Vector3(1, 0, 0), 1);
  return (from: Vector3, dx: number, dz: number, max: number) => {
    ray.origin.copyFrom(from);
    ray.direction.set(dx, 0, dz);
    ray.length = max;
    const hit = scene.pickWithRay(ray, (m) => all.has(m), false);
    return hit?.hit ? hit.distance : null;
  };
}
