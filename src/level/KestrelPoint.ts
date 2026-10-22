import { Color3 } from "@babylonjs/core/Maths/math.color";
import { Mesh } from "@babylonjs/core/Meshes/mesh";
import { MeshBuilder } from "@babylonjs/core/Meshes/meshBuilder";
import { Scene } from "@babylonjs/core/scene";
import { Vector3 } from "@babylonjs/core/Maths/math.vector";
import { Materials } from "../render/Materials";
import { Environment } from "../render/Environment";
import { LevelBuilder } from "./LevelBuilder";
import { NavGraph } from "./NavGraph";

export interface EnemySpawn {
  pos: Vector3;
  yaw: number;
  route?: Vector3[];
  /** Holds position (overwatch) instead of chasing. */
  anchored?: boolean;
  /** mission stages: the part of the base he belongs to (woken when the player gets there) */
  group?: string;
  /** not in play yet (no AI, not drawn) until the mission wakes his group */
  dormant?: boolean;
  /** the stage's boss */
  boss?: boolean;
}

export interface LevelData {
  casters: Mesh[];
  colliders: Mesh[];
  nav: NavGraph;
  playerSpawn: { pos: Vector3; yaw: number };
  enemySpawns: EnemySpawn[];
  bounds: { minX: number; maxX: number; minZ: number; maxZ: number };
  /** Red Dune: the container Deadpool bursts out of (its centre, its turn; doors at its local +Z end) */
  dpContainer?: { x: number; z: number; rotY: number };
  /** voxel-built stages: the collision boxes (min/max per box) and flags (1 sight, 2 movement) */
  boxes?: { data: Float32Array; flags: Uint8Array };
  /** triangle meshes (world space) only falling bodies and dropped guns land on: drops a player is kept out of */
  physicsOnly?: Mesh[];
  /** authored models to place (containers, trucks) */
  props?: import("./Props").PropPlacement[];
  /** doorways that get an opening door: x, floor y, z, axis (0 spans X / 1 spans Z), width, height, wall depth */
  doors?: number[][];
  /** breakable window glass (split into panes by the game) */
  glassMesh?: Mesh;
  /** height of the visible surface under a point (the collision voxels are up to 12.5 cm off): decals */
  surfaceAt?: (x: number, y: number, z: number) => { y: number; snow: boolean } | null;
  /** distance to the drawn wall along a horizontal ray (when it differs from the collision boxes) */
  wallAt?: (from: Vector3, dx: number, dz: number, max: number) => number | null;
  /** nothing overhead (roof, porch, ceiling) above this point */
  openSky?: (x: number, y: number, z: number) => boolean;
  /** lowest / highest playable floor (minimap filtering) */
  floorRange?: [number, number];
}

const V = (x: number, y: number, z: number) => new Vector3(x, y, z);
const door = (a: number, b: number, top = 2.4) => ({ a, b, bottom: 0, top });
const win = (a: number, b: number, bottom = 1.1, top = 2.3) => ({ a, b, bottom, top });

/**
 * KESTREL POINT — Station 4. A decommissioned coastal salinity-research
 * station on a cliff above a cold sea. Compact (≈90 × 80 m) with three
 * combat spaces: the lab block (CQB), the central courtyard + container
 * yard (mid-range, lanes) and the warehouse with mezzanine (verticality).
 */
export function buildKestrelPoint(scene: Scene, mats: Materials, env: Environment): LevelData {
  const L = new LevelBuilder(scene, mats);
  const R = L.rnd;
  /** a parked truck: the authored model + one box collider */
  const truck = (x: number, z: number, rotY: number, kind: "ural" | "truck") => {
    const c = Math.cos(rotY), s = Math.sin(rotY);
    const at = (lz: number): [number, number] => [x + lz * s, z + lz * c];
    if (kind === "ural") L.collider(x, 0, z, 2.5, 2.9, 7.3, { rotY, surface: "metal" });
    else {
      // tank transporter: tall tractor up front, a low trailer bed behind
      const [tx, tz] = at(4.3);
      L.collider(tx, 0, tz, 3.1, 3.4, 6.9, { rotY, surface: "metal" });
      const [bx, bz] = at(-3.6);
      L.collider(bx, 0, bz, 3.1, 1.0, 8.2, { rotY, surface: "metal" });
    }
    L.props.push({ kind, x, y: 0, z, rotY });
  };

  // ------------------------------------------------------------------ ground
  // Surfaces are layered with clear height steps and never overlap at the same height — coplanar or
  // millimetre-apart faces z-fight (shimmer / flicker) at range with a 3 cm near plane.
  //   sand 0.00 · paved pads 0.04 (edge to edge, no overlap) · building floors 0.09 · decals pad + 0.025
  L.box(2, -0.6, 2, 92, 0.6, 84, "sand", { shadow: false }); // base pad x[-44,48] z[-40,44]
  L.box(-3, -0.56, -14, 38, 0.6, 44, "floor", { collide: false, pick: false, shadow: false }); // courtyard + south yard z[-36,8]
  L.box(5, -0.56, 24, 70, 0.6, 32, "floor", { collide: false, pick: false, shadow: false }); // north alley z[8,40]
  L.box(30, -0.56, -14, 28, 0.6, 44, "concreteDark", { collide: false, pick: false, shadow: false, tile: 6 }); // container yard z[-36,8]
  // cliff face under the west edge (top kept below the sand so the coastline edge doesn't z-fight)
  L.box(-44.5, -11.04, 2, 1.2, 11, 84, "rock", { collide: false, pick: false, shadow: false });

  // ------------------------------------------------------------------ BLOCK A — research lab
  const LAB = { x0: -28, z0: 10, x1: -6, z1: 26, h: 4.2 };
  L.building(
    LAB.x0,
    LAB.z0,
    LAB.x1,
    LAB.z1,
    LAB.h,
    "concrete",
    {
      s: [door(-15.5, -13.5), win(-11, -8)],
      n: [win(-24, -21), win(-13, -10), door(-9, -7.5)],
      w: [win(12, 14), door(17, 19)],
      e: [door(17, 19)],
    },
    { floor: "floor", roof: "concreteDark", trim: "concreteDark" },
  );
  // interior: corridor z[16.5,19.5]
  L.wallX(-27.7, -6.3, 16.6, 0, LAB.h, 0.2, "concrete", [door(-24, -22.8), door(-17, -15.5, 2.0), door(-12, -10.8)]);
  L.wallX(-27.7, -6.3, 19.4, 0, LAB.h, 0.2, "concrete", [door(-25, -23.8), door(-14, -12.8)]);
  L.wallZ(10.3, 16.5, -19, 0, LAB.h, 0.2, "concrete", [door(12, 13.2)]);
  L.wallZ(19.5, 25.7, -18, 0, LAB.h, 0.2, "concrete", [door(22, 23.2)]);
  // breach rubble near the blown hole
  for (let i = 0; i < 7; i++) L.box(-16.2 + (R() - 0.5) * 2, 0, 15.2 + R() * 0.8, 0.3 + R() * 0.4, 0.15 + R() * 0.2, 0.3 + R() * 0.3, "concreteDark", { collide: false, rotY: R() * 3 });
  // ceiling light panels (some dead)
  for (const [x, z, on] of [
    [-25, 18, 1],
    [-20, 18, 0],
    [-15, 18, 1],
    [-10, 18, 1],
    [-14, 13, 1],
    [-9, 13, 1],
    [-24, 13, 0],
    [-12, 23, 1],
    [-23, 23, 1],
  ] as const)
    L.box(x, LAB.h - 0.06, z, 1.6, 0.05, 0.5, on ? "lightPanel" : "metalDark", { collide: false, shadow: false });
  // S2 lab benches + server racks
  L.box(-16.3, 0, 13.3, 2.6, 0.95, 0.9, "metal");
  L.box(-9.5, 0, 12.8, 3, 0.95, 0.9, "metal");
  L.box(-9.5, 0.95, 12.8, 0.6, 0.45, 0.4, "metalDark", { collide: false });
  for (const z of [11.2, 12.3, 13.4]) {
    L.box(-6.7, 0, z, 0.6, 2.1, 1.0, "metalDark");
    L.box(-7.01, 1.2, z, 0.02, 0.6, 0.7, "screen", { collide: false, shadow: false });
  }
  // S1 storage
  L.box(-26.3, 0, 11.5, 1.2, 1.2, 1.2, "wood");
  L.box(-26.3, 1.2, 11.5, 0.9, 0.9, 0.9, "wood", { rotY: 0.3 });
  L.box(-24.8, 0, 11.4, 1.2, 1.0, 1.0, "wood", { rotY: 0.1 });
  L.box(-21, 0, 15.2, 2.4, 0.8, 0.7, "metal");
  // N1/N2 offices
  L.box(-25.5, 0, 24.8, 3, 0.8, 1.2, "wood");
  L.box(-21, 0, 21.5, 1.8, 0.75, 0.9, "wood", { rotY: 0.5 });
  L.box(-21, 0.75, 24.6, 1.6, 0.1, 0.8, "wood", { rotZ: 1.45, collide: false }); // overturned table
  L.box(-14.5, 0, 24.9, 2.8, 2.0, 0.6, "metalDark");
  L.box(-9.5, 0, 22.5, 2.2, 0.85, 1.1, "metal");
  L.box(-9.5, 0.85, 22.5, 0.5, 0.4, 0.05, "screen", { collide: false, shadow: false });
  // exterior pipes along north wall
  for (const y of [2.9, 3.35]) L.box(-17, y, 26.3, 21.5, 0.18, 0.18, "rust", { collide: false });
  L.sign(-14.5, 3.25, LAB.z0 - 0.02, 4.2, 1.05, 0, "signA");

  // roof parapet + props
  const RY = LAB.h + 0.3;
  L.wallX(LAB.x0, LAB.x1, LAB.z0 + 0.125, RY, 1, 0.25, "concrete", [{ a: -20, b: -17.7, bottom: 0, top: 1 }]);
  L.wallX(LAB.x0, LAB.x1, LAB.z1 - 0.125, RY, 1, 0.25, "concrete");
  L.wallZ(LAB.z0 + 0.25, LAB.z1 - 0.25, LAB.x0 + 0.125, RY, 1, 0.25, "concrete");
  L.wallZ(LAB.z0 + 0.25, LAB.z1 - 0.25, LAB.x1 - 0.125, RY, 1, 0.25, "concrete", [{ a: 20, b: 21.4, bottom: 0, top: 1 }]);
  L.box(-24, RY, 14, 1.8, 1.15, 1.3, "metal");
  L.box(-11, RY, 23.8, 1.8, 1.15, 1.3, "metal");
  L.box(-17.5, RY, 19.5, 2.4, 0.6, 2.4, "metalDark");
  L.cylinder(-21, RY, 22, 0.6, 1.4, "metalDark", { tess: 10 });
  L.cylinder(-8.5, RY, 13, 0.5, 1.1, "metalDark", { tess: 10 });

  // external stairs to the roof (south face)
  L.stairs(-27.5, 9.3, "x", 1, 7.5, 1.4, 0, 4.5);
  L.box(-18.8, 4.35, 9.3, 2.4, 0.15, 1.4, "metalDark"); // landing x[-20,-17.6]
  L.rail(-20, 8.62, -17.6, 8.62, 4.5);
  L.rail(-17.62, 8.6, -17.62, 10, 4.5);
  for (const x of [-19.95, -17.65]) L.box(x, 0, 8.65, 0.1, 4.35, 0.1, "metalDark");

  // ------------------------------------------------------------------ watch platform + catwalk
  L.box(4, 4.35, 21.7, 4, 0.15, 4.4, "metalDark"); // platform x[2,6] z[19.5,23.9]
  L.box(6.7, 4.35, 23.2, 1.4, 0.15, 1.4, "metalDark"); // landing
  for (const [x, z] of [
    [2.1, 19.6],
    [5.9, 19.6],
    [2.1, 23.8],
    [5.9, 23.8],
    [7.3, 23.8],
  ])
    L.cylinder(x, 0, z, 0.22, 4.35, "metalDark", { tess: 8 });
  L.box(4, 4.5, 19.6, 4, 1.0, 0.2, "rust"); // steel cover plate (south)
  L.rail(2, 23.9, 7.4, 23.9, 4.5);
  L.rail(7.4, 22.5, 7.4, 23.9, 4.5);
  L.rail(6, 19.5, 6, 22.5, 4.5);
  L.rail(2, 21.4, 2, 23.9, 4.5);
  L.stairs(6.7, 15, "z", 1, 7.5, 1.4, 0, 4.5);
  L.box(-2, 4.35, 20.7, 8, 0.15, 1.4, "metalDark"); // catwalk x[-6,2]
  L.rail(-6, 20, 2, 20, 4.5);
  L.rail(-6, 21.4, 2, 21.4, 4.5);
  for (const z of [20.1, 21.3]) L.box(-2, 0, z, 0.15, 4.35, 0.15, "metalDark");
  L.box(4, 4.5, 23.4, 0.5, 0.18, 0.5, "beacon", { collide: false, shadow: false });

  // ------------------------------------------------------------------ BLOCK C — warehouse
  const WH = { x0: 12, z0: 12, x1: 36, z1: 32, h: 8 };
  L.building(
    WH.x0,
    WH.z0,
    WH.x1,
    WH.z1,
    WH.h,
    "metal",
    {
      s: [door(20, 27, 5.2)],
      w: [door(20, 22)],
      n: [door(30, 32)],
      e: [win(15, 18, 5.5, 6.6), win(21, 24, 5.5, 6.6), win(27, 30, 5.5, 6.6)],
    },
    { floor: "floor", roof: "metalDark", trim: "concreteDark" },
  );
  L.cylinder(23.5, 5.25, WH.z0 - 0.35, 0.6, 7.6, "rust", { rotZ: Math.PI / 2, collide: false });
  L.sign(23.5, 6.6, WH.z0 - 0.02, 7, 1.75, 0, "signC");
  // racks
  const rack = (x: number, z0: number, z1: number) => {
    const len = z1 - z0;
    for (let i = 0; i <= Math.round(len / 2.75); i++) {
      const z = z0 + (i * len) / Math.round(len / 2.75);
      for (const dx of [-0.45, 0.45]) L.box(x + dx, 0, z, 0.08, 3.3, 0.08, "rust", { collide: false });
    }
    for (const y of [0.15, 1.25, 2.35]) L.box(x, y, (z0 + z1) / 2, 1.0, 0.06, len, "metalDark", { collide: false });
    for (let i = 0; i < 9; i++) {
      const y = [0.21, 1.31, 2.41][i % 3];
      const s = 0.55 + R() * 0.3;
      L.box(x, y, z0 + 0.6 + R() * (len - 1.2), s, s * 0.8, s, "wood", { collide: false, rotY: R() * 0.3 });
    }
    L.collider(x, 0, (z0 + z1) / 2, 1.05, 3.3, len, { surface: "metal" });
  };
  rack(15, 15, 26);
  rack(29.5, 14, 24);
  // mezzanine (north) + stairs (east wall)
  L.box(24.35, 3.45, 29.85, 22.7, 0.15, 3.7, "metalDark");
  L.box(34.95, 3.45, 26.25, 1.5, 0.15, 3.5, "metalDark");
  for (let x = 14; x <= 34; x += 4) L.box(x, 0, 28.15, 0.2, 3.45, 0.2, "metalDark");
  L.rail(13, 28, 34.2, 28, 3.6);
  L.rail(34.2, 24.5, 34.2, 28, 3.6);
  L.stairs(34.95, 18, "z", 1, 6.5, 1.4, 0, 3.6);
  // crates & clutter
  for (const [x, z, s, st] of [
    [18.5, 15, 1.3, 2],
    [20, 15.3, 1.1, 1],
    [26, 18.5, 1.2, 1],
    [19.5, 24, 1.4, 2],
    [25, 26.5, 1.2, 1],
    [32.5, 26.5, 1.0, 1],
    [16, 30.5, 1.2, 2],
    [27, 30.6, 1.1, 1],
  ] as const) {
    for (let k = 0; k < st; k++) L.box(x + (R() - 0.5) * 0.15, k * s, z, s, s, s, "wood", { rotY: (R() - 0.5) * 0.4 });
  }
  L.box(22.5, 3.6, 30.5, 1.3, 1.0, 0.9, "wood"); // mezz cover
  L.box(28.5, 3.6, 29.2, 1.2, 1.1, 1.2, "wood");
  L.cylinder(32.5, 0, 14, 0.6, 0.9, "containerOrange", { tess: 12 });
  L.cylinder(33.2, 0, 14.4, 0.6, 0.9, "rust", { tess: 12 });

  // ------------------------------------------------------------------ courtyard
  L.container(1, 0, -2, 0, "containerOrange");
  L.container(8, 0, 4, Math.PI / 2, "containerTeal");
  L.container(9.5, 0, -9, 0, "containerBone");
  L.barrier(4.5, -6.5, 0.4);
  L.barrier(-3.5, 2, Math.PI / 2);
  L.barrier(5, 7.8, Math.PI / 2 + 0.1);
  L.barrier(-1, -11, 1.2);
  // sandbag wall
  for (let k = 0; k < 3; k++) L.box(-3.5, k * 0.28, -4, 0.6, 0.28, 3, "sand", { tile: 0.7, rotY: (k - 1) * 0.02 });
  L.box(-4.5, 0, 7.6, 1.2, 1.6, 2.2, "metal"); // generator
  L.box(-4.5, 1.6, 7.6, 0.25, 0.6, 0.25, "rust", { collide: false });

  // radio mast with warning beacon
  {
    const mx = -11;
    const mz = -13;
    for (const [dx, dz] of [
      [-0.6, -0.6],
      [0.6, -0.6],
      [-0.6, 0.6],
      [0.6, 0.6],
    ])
      L.box(mx + dx, 0, mz + dz, 0.1, 16, 0.1, "rust", { collide: false });
    for (let y = 1.5; y < 16; y += 2) {
      L.box(mx, y, mz - 0.6, 1.2, 0.05, 0.05, "rust", { collide: false });
      L.box(mx, y, mz + 0.6, 1.2, 0.05, 0.05, "rust", { collide: false });
      L.box(mx - 0.6, y, mz, 0.05, 0.05, 1.2, "rust", { collide: false });
      L.box(mx + 0.6, y, mz, 0.05, 0.05, 1.2, "rust", { collide: false });
    }
    L.collider(mx, 0, mz, 1.3, 16, 1.3, { surface: "metal" });
    L.box(mx, 16, mz, 0.4, 0.4, 0.4, "beacon", { collide: false, shadow: false });
    L.cylinder(mx + 0.8, 12.4, mz, 1.4, 0.15, "metal", { rotZ: Math.PI / 2, collide: false, tess: 14 });
  }

  // ------------------------------------------------------------------ south yard
  // guard booth
  L.building(0.5, -31.5, 3.5, -28.5, 2.7, "concrete", { n: [door(1.4, 2.4, 2.2)], s: [win(1, 3, 1.0, 2.0)], e: [win(-30.5, -29.5, 1, 2)], w: [win(-30.5, -29.5, 1, 2)] }, { roof: "concreteDark", t: 0.2 });
  // army truck (Ural) parked by the gate
  truck(-8, -23, 0.35, "ural");
  L.barrier(-14, -30, 0.2);
  L.barrier(12, -24, -0.3);
  L.barrier(-2, -20, 1.4);
  L.box(5, 0, -20, 1.2, 1.2, 1.2, "wood", { rotY: 0.3 });
  L.box(6.2, 0, -19.6, 1.2, 1.2, 1.2, "wood", { rotY: 0.1 });
  L.box(5.5, 1.2, -19.8, 1.0, 1.0, 1.0, "wood", { rotY: 0.6 });

  // ------------------------------------------------------------------ pump house (SW) + outfall pipe
  L.building(-34, -26, -24, -16, 3.6, "concrete", { n: [door(-30, -28.6)], e: [door(-22, -20.8)], s: [win(-32, -30)], w: [win(-22, -20)] }, { floor: "floor", roof: "concreteDark", trim: "concreteDark" });
  L.cylinder(-31, 0, -21, 1.3, 1.5, "rust");
  L.cylinder(-27, 0, -23.5, 1.1, 1.3, "rust");
  L.box(-29, 1.0, -21.6, 3.6, 0.3, 0.3, "rust", { collide: false });
  L.box(-26.5, 3.5, -21, 1.4, 0.05, 0.45, "lightPanel", { collide: false, shadow: false });
  L.cylinder(-39.5, 0.2, -19, 0.9, 11, "rust", { rotZ: Math.PI / 2, collide: false, tess: 14 });
  L.collider(-39.5, 0, -19, 11, 1.1, 0.9, { surface: "metal" });

  // ------------------------------------------------------------------ container yard (SE)
  const C: [number, number, number, number, "containerOrange" | "containerTeal" | "containerBone"][] = [
    [21, 0, -4, Math.PI / 2, "containerOrange"],
    [31, 0, -4, Math.PI / 2, "containerBone"],
    [31, 2.6, -4, Math.PI / 2 + 0.03, "containerTeal"],
    [40, 0, -8, 0, "containerTeal"],
    [19, 0, -15, 0, "containerBone"],
    [27, 0, -14, Math.PI / 2, "containerOrange"],
    [27, 2.6, -14, Math.PI / 2 - 0.04, "containerBone"],
    [36, 0, -18, Math.PI / 2, "containerTeal"],
    [23, 0, -26, 0, "containerBone"],
    [32, 0, -28, Math.PI / 2, "containerOrange"],
    [41, 0, -28, 0, "containerTeal"],
  ];
  for (const [x, y, z, r, m] of C) L.container(x, y, z, r, m);
  // fuel tank
  L.cylinder(14.5, 0, 6.5, 3.2, 4.6, "rust", { collide: false, tess: 20 });
  L.collider(14.5, 0, 6.5, 2.9, 4.6, 2.9, { surface: "metal", rotY: 0.4 });
  for (const y of [1.2, 2.6, 4.0]) L.cylinder(14.5, y, 6.5, 3.3, 0.1, "metalDark", { collide: false, tess: 20 });
  for (const [x, z] of [
    [38, 4],
    [38.7, 4.4],
    [37.6, 4.8],
    [42, -36],
    [24.5, -34],
  ])
    L.cylinder(x, 0, z, 0.6, 0.9, R() > 0.5 ? "containerOrange" : "rust", { tess: 12 });

  // ------------------------------------------------------------------ north alley clutter
  for (const [x, z] of [
    [-12, 29],
    [-11.3, 29.4],
    [-12.4, 29.8],
    [9.5, 30],
    [10.1, 29.4],
  ])
    L.cylinder(x, 0, z, 0.6, 0.9, R() > 0.5 ? "containerTeal" : "rust", { tess: 12 });
  L.box(-2, 0, 31, 1.3, 1.3, 1.3, "wood", { rotY: 0.2 });
  L.box(-0.8, 0, 31.5, 1.1, 1.1, 1.1, "wood");
  L.container(-24, 0, 33, Math.PI / 2, "containerTeal");
  L.container(20, 0, 37, Math.PI / 2 + 0.05, "containerOrange");
  L.barrier(3, 35, 0.2);

  // ------------------------------------------------------------------ THE DEPOT (east, x 47–115)
  // A sprawling container depot: rows of stacked containers make lanes, trucks parked in them,
  // the depot office in the south-east corner.
  L.box(81, -0.6, 2, 68, 0.6, 84, "sand", { shadow: false });
  L.box(81, -0.56, 2, 62, 0.6, 76, "concreteDark", { collide: false, pick: false, shadow: false, tile: 6 });
  {
    const rowsZ = [-27, -15, -3, 9, 21, 33];
    for (const rz of rowsZ) {
      let x = 54 + R() * 3;
      while (x < 108) {
        const run = 1 + Math.floor(R() * 3);
        for (let k = 0; k < run && x < 108; k++) {
          const cx = x + 3.03;
          const mats = ["containerOrange", "containerTeal", "containerBone"] as const;
          const m = mats[Math.floor(R() * 3)];
          const zz = rz + (R() - 0.5) * 0.4;
          const ry = Math.PI / 2 + (R() - 0.5) * 0.04;
          L.container(cx, 0, zz, ry, m, false);
          const h = R();
          if (h > 0.45) L.container(cx + (R() - 0.5) * 0.3, 2.6, zz + (R() - 0.5) * 0.2, ry + (R() - 0.5) * 0.06, mats[Math.floor(R() * 3)], true);
          if (h > 0.85) L.container(cx, 5.2, zz, ry, mats[Math.floor(R() * 3)], true);
          x += 6.2;
        }
        x += 3.5 + R() * 4; // a gap to cut through between rows
      }
    }
  }
  // trucks parked in the lanes
  truck(68, 15, 0.12, "ural");
  truck(82, 3, Math.PI / 2 + 0.03, "truck");
  truck(99, 27, Math.PI / 2 - 0.2, "ural");
  // depot office (south-east corner)
  L.building(96, -37, 108, -30, 3.4, "concrete", { n: [door(100, 101.3), win(103, 106)], w: [door(-34.6, -33.3)], e: [win(-35, -32)] }, { floor: "floor", roof: "concreteDark", trim: "concreteDark" });
  L.box(101.5, 0, -35.5, 2.4, 0.8, 1.0, "wood");
  L.box(105.5, 0, -32, 1.0, 2.0, 2.2, "metalDark");
  // barriers and crate piles for cover in the open lanes
  for (const [bx, bz, br] of [
    [62, -9, 0.1],
    [70, -9, 1.4],
    [94, 15, 0.3],
    [75, 27, 1.2],
    [104, -20, 0.2],
    [52, 4, 1.5],
  ] as const)
    L.barrier(bx, bz, br);
  for (const [cx, cz] of [
    [72, -21],
    [94, -9],
    [64, 27],
    [106, 9],
  ] as const) {
    L.box(cx, 0, cz, 1.2, 1.2, 1.2, "wood", { rotY: R() });
    L.box(cx + 1.3, 0, cz + 0.2, 1.2, 1.2, 1.2, "wood", { rotY: R() });
    L.box(cx + 0.6, 1.2, cz + 0.1, 1.0, 1.0, 1.0, "wood", { rotY: R() });
  }
  for (let i = 0; i < 26; i++) {
    const x = 50 + R() * 62;
    const z = -36 + R() * 76;
    const s = 1.5 + R() * 4;
    L.decal(x, 0.04, z, s, s * (0.6 + R() * 0.8), R() * 3, "stain");
  }

  // ------------------------------------------------------------------ perimeter
  const fence = (x0: number, z0: number, x1: number, z1: number) => {
    const len = Math.hypot(x1 - x0, z1 - z0);
    const rot = Math.atan2(x1 - x0, z1 - z0);
    L.box((x0 + x1) / 2, 0, (z0 + z1) / 2, 0.03, 2.8, len, "fence", { rotY: rot, collide: false, shadow: false, tile: 0.6 });
    const posts = Math.ceil(len / 3);
    for (let i = 0; i <= posts; i++) {
      const t = i / posts;
      L.box(x0 + (x1 - x0) * t, 0, z0 + (z1 - z0) * t, 0.08, 3.0, 0.08, "metalDark", { collide: false, shadow: false });
    }
  };
  fence(-42, 43, 115, 43);
  fence(115, -39, 115, 43);
  fence(-42, -39, 115, -39);
  L.rail(-42.4, -39, -42.4, 43, 0, "metalDark", false);
  // invisible boundaries (movement only)
  L.collider(-42.9, -1, 2, 0.6, 7, 84, { pick: false });
  L.collider(36.5, -1, 43.3, 161, 7, 0.6, { pick: false });
  L.collider(115.3, -1, 2, 0.6, 7, 84, { pick: false });
  L.collider(36.5, -1, -39.3, 161, 7, 0.6, { pick: false });

  // ------------------------------------------------------------------ ground dressing
  for (let i = 0; i < 46; i++) {
    const x = -38 + R() * 82;
    const z = -36 + R() * 76;
    const s = 1.5 + R() * 4;
    L.decal(x, 0.04, z, s, s * (0.6 + R() * 0.8), R() * 3, "stain");
  }
  L.decal(23.5, 0.04, 10.6, 7.2, 0.45, 0, "hazard");
  L.decal(6.7, 0.04, 14.2, 1.6, 0.4, 0, "hazard");
  L.decal(-28.1, 0.04, 9.3, 0.4, 1.4, 0, "hazard");
  L.decal(8, 0.04, -36, 6, 0.4, 0, "hazard");

  // ------------------------------------------------------------------ backdrop (visual only)
  for (let z = -90; z <= 100; z += 9) L.boulder(-52 - R() * 10, -6 + R() * 2.5, z + R() * 4, 7 + R() * 5, 5 + R() * 3, 6 + R() * 4, { zone: "cliff" });
  for (let i = 0; i < 12; i++) L.boulder(-48 - R() * 30, -9.5, -100 + R() * 200, 3 + R() * 5, 1.5 + R() * 2, 3 + R() * 4, { zone: "cliff" });
  for (let i = 0; i < 9; i++) {
    const a = -0.2 + (i / 8) * 1.9; // north → east arc
    const d = 150 + R() * 60; // (beyond the fence)
    L.boulder(Math.sin(a) * d + 10, -3, Math.cos(a) * d + 5, 30 + R() * 25, 10 + R() * 16, 25 + R() * 20, { zone: "hills" });
  }
  L.boulder(-260, -12, -60, 42, 18, 30, { zone: "far" });
  L.boulder(-340, -12, 95, 70, 26, 45, { zone: "far" });
  L.boulder(-190, -11, -150, 25, 10, 18, { zone: "far" });
  // lighthouse ruin on the near island
  L.cylinder(-255, 4, -60, 5, 18, "concrete", { collide: false, shadow: false, tess: 18 });
  L.cylinder(-255, 14, -60, 5.1, 1.5, "containerOrange", { collide: false, shadow: false, tess: 18 });
  L.cylinder(-255, 22, -60, 3.2, 2.2, "metalDark", { collide: false, shadow: false, tess: 12 });
  L.box(-255, 24.2, -60, 1.2, 1.2, 1.2, "beacon", { collide: false, shadow: false });
  // half-sunk freighter
  L.box(-150, -14, 32, 10, 9, 48, "rust", { rotY: 0.45, rotZ: 0.13, collide: false, shadow: false, tile: 6 });
  L.box(-158, -6, 16, 9, 8, 9, "rust", { rotY: 0.45, rotZ: 0.13, collide: false, shadow: false, tile: 6 });
  L.cylinder(-147, -6, 40, 0.8, 16, "rust", { rotZ: 0.13, collide: false, shadow: false, tess: 8 });

  // sea
  const sea = MeshBuilder.CreateGround("sea", { width: 3000, height: 3000 }, scene);
  sea.position.y = -9;
  sea.material = mats.m.water;
  sea.isPickable = false;
  sea.freezeWorldMatrix();

  const casters = L.finalize();

  // practical lights (non-shadowing)
  env.addPractical("labLight", V(-15, 3.7, 16), new Color3(0.7, 0.92, 1.0), 60, 16);
  env.addPractical("whLight", V(24, 6.2, 21), new Color3(1.0, 0.72, 0.45), 260, 26);

  // ------------------------------------------------------------------ navigation
  const nav = new NavGraph(scene);
  const N = (x: number, z: number, y = 0, cover = false) => nav.add(x, y, z, cover);
  // courtyard
  N(-1.6, -2, 0, true);
  N(3.4, -2, 0, true);
  N(1, -6.6, 0, true);
  N(1, 2.6, 0, true);
  N(8, 1.4, 0, true);
  N(8, 6.6, 0, true);
  N(4.3, -8.4, 0, true);
  N(9.5, -13.6, 0, true);
  N(7, -9, 0, true);
  N(-5, -4, 0, true);
  N(-2, 6.4, 0, true);
  N(-4.6, 0.5);
  N(5, -3.5);
  N(11.5, -3);
  N(-6, -9);
  // south yard
  N(8, -34);
  N(2, -26);
  N(-5.5, -21, 0, true);
  N(-10.5, -26.5, 0, true);
  N(-14, -32.5, 0, true);
  N(-15, -20);
  N(4, -17.5, 0, true);
  N(12, -21.6, 0, true);
  N(-12.5, -10.5);
  N(-20, -12);
  N(2, -27.4, 0, true); // inside booth door
  N(-2, -36);
  N(14, -35);
  // pump house
  N(-29.3, -14.6);
  N(-29.3, -17.6);
  N(-29, -19.2);
  N(-25.5, -21.4);
  N(-22.6, -21.4);
  N(-35, -12);
  N(-24, -30);
  // lab exterior/doors
  N(-30, 18);
  N(-26.6, 18);
  N(-23.4, 18);
  N(-20, 18);
  N(-16.2, 18);
  N(-13.4, 18);
  N(-11.4, 18);
  N(-7.5, 18);
  N(-4.4, 18);
  N(-23.4, 15.2);
  N(-23.5, 13.5, 0, true);
  N(-20, 12.6);
  N(-18, 12.6);
  N(-11.4, 15.4);
  N(-12.5, 14.6, 0, true);
  N(-12.5, 11.4);
  N(-16.2, 15.6);
  N(-14.5, 11.2);
  N(-14.5, 8.4);
  N(-24.4, 20.6);
  N(-23, 22.8, 0, true);
  N(-19, 22.6);
  N(-17, 22.6);
  N(-13.4, 20.6);
  N(-12, 22.6, 0, true);
  N(-8.2, 24.8);
  N(-8.2, 27.6);
  N(-29, 9.3);
  N(-30, 12);
  N(-30, 27);
  // lab roof
  const roofTop = N(-18.8, 9.3, 4.5);
  N(-18.8, 11.6, 4.5);
  N(-15.5, 15, 4.5, true);
  N(-24.5, 21.5, 4.5, true);
  N(-10, 21.2, 4.5, true);
  N(-7.2, 20.7, 4.5);
  N(-26, 12, 4.5, true);
  // catwalk/platform
  N(-2, 20.7, 4.5);
  N(3.5, 21.7, 4.5, true);
  const towerTop = N(6.7, 23.2, 4.5);
  // alley north
  const towerBottom = N(6.7, 13.6);
  const labStairBottom = N(-28.6, 9.3);
  N(-2, 12.5);
  N(-2, 25);
  N(0.5, 16.5);
  N(9.6, 17.5, 0, true);
  N(9.6, 26);
  N(0.5, 28.5);
  N(-8, 31);
  N(-19, 30.5);
  N(5, 35);
  N(15, 35.5);
  N(29, 35.5);
  N(31, 33.6);
  N(10.4, 21);
  N(10, 10);
  N(-12, 8.4);
  // warehouse
  N(13.6, 21);
  N(18, 18.5);
  N(17.8, 26.8, 0, true);
  N(23.5, 14);
  N(23.5, 9.6);
  N(24, 21.5);
  N(27, 26, 0, true);
  N(32.2, 16.2);
  N(32.2, 22);
  const whStairBottom = N(34.95, 17.2);
  const whStairTop = N(34.95, 25.4, 3.6);
  N(33, 30, 3.6);
  N(26, 29.8, 3.6, true);
  N(19, 29.8, 3.6, true);
  N(14, 29.8, 3.6);
  N(31, 30.4);
  N(21.5, 30.3);
  // container yard
  N(17, 0);
  N(26, 0);
  N(36, 0, 0, true);
  N(44, -2);
  N(24, -8.6, 0, true);
  N(33.5, -8.6, 0, true);
  N(43.6, -14);
  N(16, -20, 0, true);
  N(22.6, -19.5, 0, true);
  N(31, -20.5, 0, true);
  N(36.5, -23, 0, true);
  N(43.5, -21);
  N(17, -31);
  N(27, -32.5);
  N(37, -33.5);
  N(36.5, -11.5);
  N(44, -34);

  nav.setColliders(L.colliders);
  // depot: a 4 m grid of nodes, dropped where it's inside or hugging a box; cover = a box within
  // 1.6 m at crouch height
  const depotStart = nav.nodes.length;
  {
    const h = V(0, 0.8, 0);
    const dirs = [V(1, 0, 0), V(-1, 0, 0), V(0, 0, 1), V(0, 0, -1), V(0.7, 0, 0.7), V(-0.7, 0, 0.7), V(0.7, 0, -0.7), V(-0.7, 0, -0.7)];
    for (let x = 50; x <= 112; x += 4)
      for (let z = -36; z <= 40; z += 4) {
        const p = V(x, 0, z).add(h);
        let free = true;
        for (const d of dirs.slice(0, 4)) if (!nav.clear(p, p.add(d.scale(0.55)))) free = false;
        if (!free) continue;
        let cover = false;
        for (const d of dirs) if (!nav.clear(p.add(V(0, 0.15, 0)), p.add(V(0, 0.15, 0)).add(d.scale(1.6)))) cover = true;
        N(x, z, 0, cover);
      }
  }
  void depotStart;
  nav.autoLink(17);
  // stairs (explicit)
  nav.link(labStairBottom, roofTop);
  nav.link(towerBottom, towerTop);
  nav.link(whStairBottom, whStairTop);

  // ------------------------------------------------------------------ spawns
  const enemySpawns: EnemySpawn[] = [
    { pos: V(3.4, 0, -2), yaw: Math.PI },
    { pos: V(4.3, 0, -8.4), yaw: 0, route: [V(4.3, 0, -8.4), V(8, 0, 1.4), V(-2, 0, 6.4), V(-5, 0, -4)] },
    { pos: V(3.5, 4.5, 21.2), yaw: Math.PI, anchored: true },
    { pos: V(-15.5, 4.5, 15), yaw: Math.PI, route: [V(-15.5, 4.5, 15), V(-24.5, 4.5, 21.5), V(-10, 4.5, 21.2)] },
    { pos: V(-12.5, 0, 14.6), yaw: Math.PI * 0.8 },
    { pos: V(-23, 0, 22.8), yaw: 0, route: [V(-23, 0, 22.8), V(-23.4, 0, 18), V(-7.5, 0, 18), V(-13.4, 0, 18)] },
    { pos: V(18, 0, 18.5), yaw: Math.PI, route: [V(18, 0, 18.5), V(24, 0, 21.5), V(32.2, 0, 16.2), V(17.8, 0, 26.8)] },
    { pos: V(22, 3.6, 29.4), yaw: Math.PI, anchored: true },
    { pos: V(24, 0, -8.6), yaw: Math.PI, route: [V(24, 0, -8.6), V(36, 0, 0), V(43.6, 0, -14), V(22.6, 0, -19.5)] },
    // the depot
    ...depotSpawns(nav, depotStart),
  ];

  return {
    casters,
    colliders: L.colliders,
    nav,
    playerSpawn: { pos: V(8, 0, -34.5), yaw: -0.25 },
    enemySpawns,
    bounds: { minX: -42, maxX: 115, minZ: -39, maxZ: 44 },
    doors: L.doors,
    props: L.props,
  };
}

/**
 * Six hostiles for the depot: spread over its nodes (farthest-point), half on patrol loops through
 * nearby lanes, the rest holding covered spots.
 */
function depotSpawns(nav: NavGraph, first: number): EnemySpawn[] {
  const pool = nav.nodes.slice(first).filter((n) => n.links.length >= 2);
  if (!pool.length) return [];
  const chosen = [pool.reduce((a, b) => (b.p.x + b.p.z > a.p.x + a.p.z ? b : a))];
  while (chosen.length < 6 && chosen.length < pool.length) {
    let best = pool[0];
    let bestD = -1;
    for (const n of pool) {
      const d = Math.min(...chosen.map((c) => Vector3.DistanceSquared(c.p, n.p)));
      if (d > bestD) {
        bestD = d;
        best = n;
      }
    }
    chosen.push(best);
  }
  return chosen.map((n, i) => {
    const yaw = Math.atan2(30 - n.p.x, -10 - n.p.z);
    if (i % 2 === 1) return { pos: n.p.clone(), yaw, anchored: n.cover };
    const route = [n.p.clone()];
    let cur = n;
    for (let k = 0; k < 3; k++) {
      const opts = cur.links.map((l) => nav.nodes[l]).filter((m) => Vector3.Distance(m.p, n.p) < 14 && !route.some((r) => Vector3.DistanceSquared(r, m.p) < 1));
      if (!opts.length) break;
      cur = opts[k % opts.length];
      route.push(cur.p.clone());
    }
    return { pos: n.p.clone(), yaw, route };
  });
}
