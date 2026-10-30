import { Mesh } from "@babylonjs/core/Meshes/mesh";
import { Vector3 } from "@babylonjs/core/Maths/math.vector";
import { NavGraph } from "./NavGraph";

/** Level data shared by every stage's builder (Red Dune, the station this file used to build, is gone). */

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
  /**
   * panes (by their middle) that still block you once broken: jumping through them lands you
   * somewhere you can't get back from (stuck in the frame, outside the map, a pit); bullets pass
   */
  sealedGlass?: [number, number, number][];
  /** height of the visible surface under a point (the collision voxels are up to 12.5 cm off): decals */
  surfaceAt?: (x: number, y: number, z: number) => { y: number; snow: boolean } | null;
  /** distance to the drawn wall along a horizontal ray (when it differs from the collision boxes) */
  wallAt?: (from: Vector3, dx: number, dz: number, max: number) => number | null;
  /** nothing overhead (roof, porch, ceiling) above this point */
  openSky?: (x: number, y: number, z: number) => boolean;
  /** lowest / highest playable floor (minimap filtering) */
  floorRange?: [number, number];
}
