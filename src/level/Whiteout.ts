import { Color3 } from "@babylonjs/core/Maths/math.color";
import { Mesh } from "@babylonjs/core/Meshes/mesh";
import { PBRMaterial } from "@babylonjs/core/Materials/PBR/pbrMaterial";
import { Scene } from "@babylonjs/core/scene";
import { Matrix, Quaternion, Vector3 } from "@babylonjs/core/Maths/math.vector";
import "@babylonjs/core/Meshes/thinInstanceMesh";
import { VertexData } from "@babylonjs/core/Meshes/mesh.vertexData";
import { Materials } from "../render/Materials";
import { Environment } from "../render/Environment";
import { EnemySpawn, LevelData } from "./KestrelPoint";
import { LevelBuilder } from "./LevelBuilder";
import { NavGraph } from "./NavGraph";
import { LoadAssetContainerAsync } from "@babylonjs/core/Loading/sceneLoader";
import { extFor } from "../weapons/ArmsRig";
import treeUrl from "../assets/props/tree_lowpoly.glb?url";

/**
 * WHITEOUT — a forward outpost on a frozen high plateau. The fighting ground is flat, packed snow
 * (≈180 × 180 m): a small concrete command bunker, fuel tanks, container stacks, jersey barriers,
 * parked trucks, snow-capped boulders and drifts to hide behind — and on every side, well clear of
 * the fight, a range of real mountains: foothills rising off the plateau, then ridged peaks up to
 * ~400 m, snow on everything that isn't too steep to hold it, bare rock where it is.
 *
 * The mountains are one terrain mesh generated here (no download): a 240 × 240 grid over 2.8 km,
 * height from ridged fractal noise that's zero over the plateau and climbs with distance from it;
 * vertex colours from slope and height (rock on the steep faces, snow on the rest, blue in the
 * shadowed hollows). It casts no shadows and isn't walkable — the plateau's invisible walls stop
 * you at its edge.
 */

const V = (x: number, y: number, z: number) => new Vector3(x, y, z);

/** a small seeded value-noise with ridges (deterministic: the same range every load) */
function noise2(seed: number) {
  const hash = (x: number, z: number) => {
    let h = (x * 374761393 + z * 668265263 + seed * 2147483647) | 0;
    h = (h ^ (h >>> 13)) * 1274126177;
    return ((h ^ (h >>> 16)) >>> 0) / 4294967295;
  };
  const smooth = (t: number) => t * t * (3 - 2 * t);
  const value = (x: number, z: number) => {
    const xi = Math.floor(x), zi = Math.floor(z);
    const xf = smooth(x - xi), zf = smooth(z - zi);
    const a = hash(xi, zi), b = hash(xi + 1, zi), c = hash(xi, zi + 1), d = hash(xi + 1, zi + 1);
    return a + (b - a) * xf + (c - a) * zf + (a - b - c + d) * xf * zf;
  };
  return {
    fbm(x: number, z: number, oct = 5) {
      let s = 0, amp = 0.5, f = 1;
      for (let i = 0; i < oct; i++) {
        s += amp * value(x * f, z * f);
        amp *= 0.5;
        f *= 2.03;
      }
      return s;
    },
    /** ridged: sharp crests where the noise crosses its middle */
    ridged(x: number, z: number, oct = 6) {
      let s = 0, amp = 0.55, f = 1, prev = 1;
      for (let i = 0; i < oct; i++) {
        const n = 1 - Math.abs(value(x * f, z * f) * 2 - 1);
        const r = n * n * prev;
        s += r * amp;
        prev = Math.min(1, r * 1.8);
        amp *= 0.5;
        f *= 2.1;
      }
      return s;
    },
  };
}

const nz = noise2(11), nz2 = noise2(29);
/** the land's height off the plateau (0 under the fighting ground) */
function terrainHeight(x: number, z: number) {
  {
    const r = Math.hypot(x, z);
    // flat (a touch below the plateau's own ground) out to 140 m; foothills to 420 m; then the range
    if (r < 140) return -0.25;
    const foot = Math.min(1, (r - 140) / 280);
    const hills = nz.fbm(x / 160, z / 160, 4) * 46 * foot * foot;
    const range = Math.max(0, Math.min(1, (r - 330) / 380));
    const peaks = nz2.ridged(x / 520 + 3.1, z / 520 - 1.7, 6) * 430 * range * range * (0.75 + 0.5 * nz.fbm(x / 900, z / 900, 2));
    return -0.25 + hills + peaks;
  }
}

/** the mountains round the plateau */
function buildMountains(scene: Scene) {
  const N = 240, SIZE = 2800;
  const height = terrainHeight;
  const pos: number[] = [], col: number[] = [], idx: number[] = [];
  const step = SIZE / N;
  for (let j = 0; j <= N; j++)
    for (let i = 0; i <= N; i++) {
      const x = -SIZE / 2 + i * step, z = -SIZE / 2 + j * step;
      pos.push(x, height(x, z), z);
    }
  for (let j = 0; j < N; j++)
    for (let i = 0; i < N; i++) {
      const a = j * (N + 1) + i, b = a + 1, c = a + N + 1, d = c + 1;
      idx.push(a, b, c, b, d, c);
    }
  const nrm: number[] = [];
  VertexData.ComputeNormals(pos, idx, nrm);
  // (whichever way the winding came out, the normals point up)
  if (nrm[1 + 3 * (N / 2) * (N + 1)] < 0) for (let k = 0; k < nrm.length; k++) nrm[k] = -nrm[k];
  // colour: snow, unless it's steep (rock), a little bluer in the hollows, brighter on the crests
  for (let k = 0; k < pos.length / 3; k++) {
    const y = pos[k * 3 + 1];
    const ny = nrm[k * 3 + 1];
    const steep = Math.max(0, Math.min(1, (0.78 - ny) / 0.22));
    const hi = Math.max(0, Math.min(1, y / 260));
    const rock = steep * (0.85 - hi * 0.35);
    const sr = 0.93 + hi * 0.06, sg = 0.95 + hi * 0.04, sb = 1.0;
    const hollow = Math.max(0, 1 - ny) * 0.12;
    let r = sr * (1 - rock) + 0.36 * rock - hollow * 0.6;
    let g = sg * (1 - rock) + 0.37 * rock - hollow * 0.4;
    let b = sb * (1 - rock) + 0.4 * rock;
    // aerial perspective, baked in (the scene's fog is off for the range: it would flatten it to a wall)
    const dist = Math.hypot(pos[k * 3], pos[k * 3 + 2]);
    const haze = Math.min(0.62, Math.max(0, (dist - 300) / 2400));
    r += (0.8 - r) * haze;
    g += (0.85 - g) * haze;
    b += (0.93 - b) * haze;
    col.push(r * 0.82, g * 0.84, b * 0.88, 1);
  }
  const m = new Mesh("mountains", scene);
  const vd = new VertexData();
  vd.positions = pos;
  vd.indices = idx;
  vd.normals = nrm;
  vd.colors = col;
  vd.applyToMesh(m);
  const mat = new PBRMaterial("mountainMat", scene);
  mat.albedoColor = Color3.White();
  mat.metallic = 0;
  mat.roughness = 0.82;
  mat.environmentIntensity = 0.7;
  mat.maxSimultaneousLights = 4;
  mat.fogEnabled = false;
  m.material = mat;
  m.useVertexColors = true;
  m.isPickable = false;
  m.receiveShadows = false;
  m.freezeWorldMatrix();
  return m;
}

export function buildWhiteout(scene: Scene, mats: Materials, env: Environment): LevelData {
  const L = new LevelBuilder(scene, mats);
  const R = L.rnd;
  let dpContainer: { x: number; z: number; rotY: number } | undefined;
  const truck = (x: number, z: number, rotY: number) => {
    L.collider(x, 0, z, 2.5, 2.9, 7.3, { rotY, surface: "metal" });
    L.props.push({ kind: "ural", x, y: 0, z, rotY });
  };

  // ------------------------------------------------------------------ the plateau
  L.box(0, -0.6, 0, 200, 0.6, 200, "snow", { shadow: false, tile: 8 }); // x,z[-100,100]
  // a cleared, trodden pad round the bunker (greyer snow)
  L.box(-36, -0.56, 18, 34, 0.6, 26, "concreteDark", { collide: false, pick: false, shadow: false, tile: 6 });

  // the command bunker: thick concrete, a door each side, slit windows
  L.building(-44, 12, -28, 24, 3.6, "concrete", {
    s: [{ a: -38, b: -36.5, bottom: 0, top: 2.4 }, { a: -33, b: -30, bottom: 1.4, top: 2.0 }],
    n: [{ a: -42, b: -39, bottom: 1.4, top: 2.0 }, { a: -33, b: -31.5, bottom: 0, top: 2.4 }],
    e: [{ a: 16, b: 17.5, bottom: 0, top: 2.4 }],
    w: [{ a: 18, b: 21, bottom: 1.4, top: 2.0 }],
  }, { floor: "floor", roof: "concreteDark", trim: "concreteDark" });
  // fuel tanks and a pipe rack by the bunker
  for (const [x, z] of [[-18, 28], [-14.5, 28], [-11, 28]] as const) L.cylinder(x, 0, z, 3, 4.2, "metal", { tess: 18, collide: true, shadow: true });
  L.box(-14.5, 3.9, 25.2, 9, 0.25, 0.3, "metalDark", { collide: false });

  // container stacks (Spider-Man's and Wolverine's perches; cover for everyone)
  L.container(24, 0, 30, 0.2, "containerTeal");
  L.container(24, 2.59, 30, 0.22, "containerOrange");
  L.container(28, 0, 34.5, 0.2, "containerBone");
  L.container(-60, 0, -22, 1.4, "containerOrange");
  L.container(-60, 2.59, -22, 1.38, "containerTeal");
  L.container(55, 0, -40, -0.6, "containerBone");
  L.container(58, 0, -36, -0.6, "containerOrange", true);
  L.container(62, 0, 58, 0.9, "containerTeal");
  L.container(62, 2.59, 58, 0.92, "containerBone");
  L.container(-30, 0, -55, 0.1, "containerTeal");
  // Deadpool's container: walls and roof only (he's inside), doors at its +Z end facing the open
  {
    const cx = 8, cz = 46, rot = Math.PI;
    const c = Math.cos(rot), sn = Math.sin(rot);
    const at = (lx: number, lz: number): [number, number] => [cx + lx * c + lz * sn, cz - lx * sn + lz * c];
    for (const [lx, lz, w, h, d, y] of [
      [-1.17, 0, 0.1, 2.59, 6.06, 0], [1.17, 0, 0.1, 2.59, 6.06, 0], [0, -2.98, 2.44, 2.59, 0.1, 0], [0, 0, 2.44, 0.1, 6.06, 2.49],
    ] as const) {
      const [x, z] = at(lx, lz);
      L.collider(x, y, z, w, h, d, { rotY: rot, surface: "metal" });
    }
    L.props.push({ kind: "container", x: cx, y: 0, z: cz, rotY: rot, variant: 1, tag: "entrance" });
    dpContainer = { x: cx, z: cz, rotY: rot };
  }
  // jersey barriers, sandbag-style lines of them
  for (const [x, z, r] of [[-6, -20, 0.1], [-1, -20.6, 0.1], [4, -21.2, 0.1], [36, 6, 1.5], [36, 11, 1.5], [-52, 40, 0.8], [70, 20, -0.4], [12, 70, 0.3], [-20, 62, -0.2]] as const) L.barrier(x, z, r);
  truck(-8, 38, 1.9);
  truck(46, -12, -0.6);
  truck(-70, 52, 2.6);
  // boulders, snow-capped (a rock with a cap of snow on it), and wind-blown drifts
  for (const [x, z, w, h, d] of [[18, -40, 5, 2.4, 4], [-44, -38, 6, 3, 5], [74, -64, 4, 2, 3.4], [-78, 6, 5, 2.6, 4.5], [40, 76, 5.5, 2.8, 4], [80, 40, 4, 2, 3], [-12, -66, 4.5, 2.2, 4]] as const) {
    const seed = Math.round(x * 7 + z);
    L.boulder(x, -0.2, z, w * 0.6, h * 0.75, d * 0.6, { collide: true, shadow: true, zone: "cliff", seed, mat: "snowRock" });
    L.boulder(x, h * 0.42, z, w * 0.55, h * 0.22, d * 0.55, { shadow: false, zone: "cliff", seed: seed + 1, mat: "snow" });
  }
  for (let i = 0; i < 26; i++) {
    const a = R() * Math.PI * 2, r = 30 + R() * 60;
    const x = Math.cos(a) * r, z = Math.sin(a) * r;
    if (Math.abs(x + 36) < 20 && Math.abs(z - 18) < 16) continue;
    L.boulder(x, -0.35, z, 2.5 + R() * 4, 0.5 + R() * 0.6, 1.5 + R() * 2.5, { shadow: false, zone: "cliff", seed: i * 31, mat: "snow" });
  }

  // ------------------------------------------------------------------ the edge (movement only) and a marker fence
  L.collider(0, -1, 92.5, 190, 8, 0.6, { pick: false });
  L.collider(0, -1, -92.5, 190, 8, 0.6, { pick: false });
  L.collider(92.5, -1, 0, 0.6, 8, 190, { pick: false });
  L.collider(-92.5, -1, 0, 0.6, 8, 190, { pick: false });
  for (let k = -90; k <= 90; k += 6)
    for (const [x, z] of [[k, 92], [k, -92], [92, k], [-92, k]] as const) L.box(x, 0, z, 0.1, 1.4, 0.1, "containerOrange", { collide: false, shadow: false });

  const casters = L.finalize();
  buildMountains(scene);
  env.addPractical("bunkerLight", V(-36, 3.0, 18), new Color3(1.0, 0.82, 0.6), 50, 14);

  // ------------------------------------------------------------------ navigation: a 5 m grid over the open snow, and the bunker
  const nav = new NavGraph(scene);
  const N = (x: number, z: number, y = 0, cover = false) => nav.add(x, y, z, cover);
  const h = V(0, 0.8, 0);
  const dirs = [V(1, 0, 0), V(-1, 0, 0), V(0, 0, 1), V(0, 0, -1)];
  for (let x = -88; x <= 88; x += 5)
    for (let z = -88; z <= 88; z += 5) {
      const p = V(x, 0, z).add(h);
      if (nav.embedded(x, 0.8, z)) continue;
      if (dirs.some((d) => !nav.clear(p, p.add(d.scale(0.6))))) continue;
      let cover = false;
      for (const d of dirs) if (!nav.clear(p.add(V(0, 0.15, 0)), p.add(V(0, 0.15, 0)).add(d.scale(1.8)))) cover = true;
      N(x, z, 0, cover);
    }
  for (const [x, z] of [[-40, 18], [-34, 15], [-34, 21], [-30, 18], [-37, 10], [-32, 26], [-26, 17], [-46, 20]] as const) N(x, z, 0.04, true);
  nav.autoLink(9);

  // ------------------------------------------------------------------ spawns
  const enemySpawns: EnemySpawn[] = [
    { pos: V(-36, 0, 16), yaw: Math.PI },
    { pos: V(-40, 0, 21), yaw: Math.PI * 0.8 },
    { pos: V(-31, 0, 9), yaw: Math.PI, route: [V(-31, 0, 9), V(-16, 0, 6), V(-6, 0, -16), V(-24, 0, -6)] },
    { pos: V(-14, 0, 31), yaw: Math.PI },
    { pos: V(22, 0, 26), yaw: Math.PI, route: [V(22, 0, 26), V(34, 0, 12), V(16, 0, -2), V(4, 0, 18)] },
    { pos: V(24, 5.18, 30), yaw: Math.PI, anchored: true },
    { pos: V(4, 0, -24), yaw: Math.PI },
    { pos: V(-4, 0, -24), yaw: Math.PI * 1.1 },
    { pos: V(40, 0, 8), yaw: -Math.PI * 0.6 },
    { pos: V(52, 0, -34), yaw: Math.PI, route: [V(52, 0, -34), V(66, 0, -20), V(70, 0, 16), V(44, 0, 0)] },
    { pos: V(-58, 0, -18), yaw: 0 },
    { pos: V(-60, 5.18, -22), yaw: Math.PI * 0.2, anchored: true },
    { pos: V(-50, 0, 44), yaw: Math.PI * 0.7, route: [V(-50, 0, 44), V(-70, 0, 30), V(-60, 0, 0), V(-40, 0, 40)] },
    { pos: V(60, 0, 54), yaw: Math.PI },
    { pos: V(14, 0, 66), yaw: Math.PI },
  ];
  // (one lot of three for each of the eleven heroes as they arrive)
  for (let i = 0; i < 32; i++) enemySpawns.push({ pos: V(0, 0, -80), yaw: 0, dormant: true, group: "reinforce" });

  return {
    casters,
    colliders: L.colliders,
    nav,
    playerSpawn: { pos: V(0, 0, -78), yaw: 0 },
    enemySpawns,
    bounds: { minX: -92, maxX: 92, minZ: -92, maxZ: 92 },
    dpContainer,
    props: L.props,
    floorRange: [-1, 6],
  };
}

/**
 * Pines round the plateau (the low-poly tree model, frosted): stands of them on the slopes just past
 * the edge and scattered up the foothills, never on the fighting ground. Instances: one draw call a part.
 */
export async function plantWhiteoutTrees(scene: Scene) {
  const c = await LoadAssetContainerAsync(treeUrl, scene, { pluginExtension: extFor(treeUrl) });
  c.addAllToScene();
  const parts = c.meshes.filter((m): m is Mesh => m instanceof Mesh && m.getTotalVertices() > 0);
  for (const m of c.materials)
    if (m instanceof PBRMaterial) {
      // (frost on the needles: lighter, bluer)
      m.albedoColor = Color3.Lerp(m.albedoColor, new Color3(0.86, 0.9, 0.95), 0.45);
      m.maxSimultaneousLights = 4;
    }
  // the model's height → about 9 m a tree (each one scaled a little differently)
  let lo = Infinity, hi = -Infinity;
  for (const p of parts) {
    p.computeWorldMatrix(true);
    const bb = p.getBoundingInfo().boundingBox;
    lo = Math.min(lo, bb.minimumWorld.y);
    hi = Math.max(hi, bb.maximumWorld.y);
  }
  const base = 9 / Math.max(1e-3, hi - lo);
  // (each part's own place in the model baked into its vertices: an instance is then just a tree's spot)
  for (const p of parts) {
    p.setParent(null);
    p.bakeCurrentTransformIntoVertices();
    // (the template itself hidden; its instances still draw)
    p.isVisible = false;
    p.isPickable = false;
  }
  let seed = 7;
  const r = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  const spots: [number, number][] = [];
  for (let k = 0; k < 26; k++) {
    // stands: a centre, then a dozen round it
    const a = r() * Math.PI * 2, d = 112 + r() * 110;
    const cx = Math.cos(a) * d, cz = Math.sin(a) * d;
    for (let i = 0; i < 6 + Math.floor(r() * 8); i++) spots.push([cx + (r() - 0.5) * 24, cz + (r() - 0.5) * 24]);
  }
  // (thin instances: each part of the tree drawn once for the whole forest — 400-odd separate
  // instances were a draw-list entry and a world matrix each, every frame)
  const mats: Matrix[] = [];
  for (const [x, z] of spots) {
    if (Math.hypot(x, z) < 104) continue;
    const k = base * (0.7 + r() * 0.6);
    mats.push(Matrix.Compose(new Vector3(k, k, k), Quaternion.RotationAxis(Vector3.Up(), r() * Math.PI * 2), new Vector3(x, Math.max(-0.3, terrainHeight(x, z)) - 0.25 - lo * k, z)));
  }
  const buf = new Float32Array(mats.length * 16);
  mats.forEach((m, i) => m.copyToArray(buf, i * 16));
  for (const p of parts) {
    p.isVisible = true;
    p.thinInstanceSetBuffer("matrix", buf, 16, true);
    p.thinInstanceRefreshBoundingInfo(false);
    p.freezeWorldMatrix();
    p.name = "pine";
  }
}
