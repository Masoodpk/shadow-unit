import { Vector3 } from "@babylonjs/core/Maths/math.vector";
import type { LevelData } from "./KestrelPoint";

/** a stretch of solid wall beside the walkable floor: where things get stood or mounted */
export interface WallSpot {
  /** floor point in front of the wall (`gap` out from it) */
  pos: Vector3;
  /** the wall face at 1.2 m height */
  wall: Vector3;
  /** horizontal normal out of the wall (towards the room) */
  normal: Vector3;
  /** yaw that faces out of the wall (0 = +Z) */
  yaw: number;
  /** roof / ceiling overhead */
  indoor: boolean;
}

const DIRS = Array.from({ length: 8 }, (_, i) => (i * Math.PI) / 4);

/**
 * Wall spots for the whole stage: from every nav node, look along 8 directions for a solid wall
 * close by — solid floor-to-head height (not a window, a railing or a low wall), a floor in front of
 * it level with the node, and well clear of doorways (a crate never blocks a door).
 * One spot per ~2 m of wall.
 */
export function wallSpots(level: LevelData, gap = 0.3): WallSpot[] {
  const nav = level.nav;
  const doors = (level.doors ?? []).map((d) => new Vector3(d[0], d[1], d[2]));
  const out: WallSpot[] = [];
  const a = new Vector3(), b = new Vector3();
  const near = (p: Vector3, r: number) => out.some((s) => Vector3.DistanceSquared(s.pos, p) < r * r);
  for (const n of nav.nodes) {
    if (!n.links.length) continue;
    for (const ang of DIRS) {
      const dx = Math.sin(ang), dz = Math.cos(ang);
      const R = 1.6;
      // chest and knee height must both meet the same wall
      a.set(n.p.x, n.p.y + 1.2, n.p.z);
      b.set(n.p.x + dx * R, a.y, n.p.z + dz * R);
      const hi = nav.rayLevel(a, b);
      if (hi < 0.35) continue;
      a.y = b.y = n.p.y + 0.35;
      const lo = nav.moveRay(a, b, false);
      if (lo < 0 || Math.abs(lo - hi) > 0.12) continue;
      a.y = b.y = n.p.y + 2.0;
      const top = nav.rayLevel(a, b);
      if (top < 0 || Math.abs(top - hi) > 0.2) continue;
      a.y = n.p.y + 1.2;
      // the visible wall (voxel walls can sit a few cm off the drawn one); nothing drawn there or
      // something much farther = a window (glass isn't a wall to stack crates against)
      let d = hi;
      if (level.wallAt) {
        const vis = level.wallAt(a, dx, dz, hi + 0.3);
        if (vis === null || Math.abs(vis - hi) > 0.3) continue;
        d = vis;
      }
      const wall = new Vector3(n.p.x + dx * d, n.p.y + 1.2, n.p.z + dz * d);
      const pos = new Vector3(wall.x - dx * gap, n.p.y, wall.z - dz * gap);
      const fy = nav.floorAt(pos.x, n.p.y + 0.3, pos.z, 0.6);
      if (fy === null || Math.abs(fy - n.p.y) > 0.15) continue;
      pos.y = fy;
      if (nav.embedded(pos.x, fy + 0.5, pos.z)) continue;
      if (doors.some((p) => Math.hypot(p.x - pos.x, p.z - pos.z) < 2.0 && Math.abs(p.y - fy) < 1.5)) continue;
      if (near(pos, 2)) continue;
      a.set(pos.x, fy + 1.5, pos.z);
      b.set(pos.x, fy + 12, pos.z);
      const indoor = level.openSky ? !level.openSky(pos.x, fy, pos.z) : nav.rayLevel(a, b) >= 0;
      out.push({ pos, wall, normal: new Vector3(-dx, 0, -dz), yaw: Math.atan2(-dx, -dz), indoor });
    }
  }
  return out;
}
