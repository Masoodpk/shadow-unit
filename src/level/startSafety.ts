import { Vector3 } from "@babylonjs/core/Maths/math.vector";
import type { EnemySpawn } from "./KestrelPoint";
import type { NavGraph } from "./NavGraph";

/** nobody posted or patrolling inside this radius of the insertion point… */
const NEAR = 28;
/** …and nobody within sight of it closer than this (a soldier sees ~48 m) */
const SIGHT = 52;

/**
 * The insertion point is quiet: you arrive unseen, and the base only learns you're there when you
 * make it known. Every guard post and patrol waypoint that is too close to the start, or that has
 * a line of sight to it, is moved (posts) or dropped (waypoints, and the walk between them).
 */
export function secureStart(nav: NavGraph, start: Vector3, spawns: EnemySpawn[]) {
  const eye = new Vector3(start.x, start.y + 1.6, start.z);
  const chest = new Vector3(start.x, start.y + 0.95, start.z);
  const at = new Vector3();
  const sees = (p: Vector3) => {
    const d = Math.hypot(p.x - start.x, p.z - start.z);
    if (d < NEAR) return true;
    if (d > SIGHT) return false;
    // a soldier's eye to your head, or to your chest (they see through gaps at waist height too)
    at.set(p.x, p.y + 1.55, p.z);
    if (nav.clear(at, eye)) return true;
    return nav.clear(at, chest);
  };
  const taken: Vector3[] = [];
  for (const s of spawns) {
    if (s.route?.length) {
      // keep the waypoints that are safe, and only legs whose walked path (every nav node of it) is too
      const keep = s.route.filter((p) => !sees(p));
      const legClear = (a: Vector3, b: Vector3) => {
        // the walk itself: every 3 m along the path between the waypoints (nav links can be 17 m long)
        const pts = [a, ...nav.path(nav.nearest(a, false), nav.nearest(b, false)), b];
        for (let i = 0; i + 1 < pts.length; i++) {
          const n = Math.max(1, Math.ceil(Vector3.Distance(pts[i], pts[i + 1]) / 3));
          for (let k = 0; k <= n; k++) if (sees(Vector3.Lerp(pts[i], pts[i + 1], k / n))) return false;
        }
        return true;
      };
      const legsOk = keep.filter((p, i) => keep.length < 2 || legClear(p, keep[(i + 1) % keep.length]));
      s.route = legsOk.length >= 2 && legsOk.every((p, i) => legClear(p, legsOk[(i + 1) % legsOk.length])) ? legsOk : undefined;
      if (s.route && sees(s.pos)) s.pos = s.route[0].clone();
    }
    if (sees(s.pos)) {
      // the nearest safe floor to the post (not on top of another soldier)
      let best: Vector3 | null = null;
      let bd = Infinity;
      for (const n of nav.nodes) {
        if (n.links.length < 1 || sees(n.p) || taken.some((t) => Vector3.DistanceSquared(t, n.p) < 9)) continue;
        const d = Vector3.DistanceSquared(n.p, s.pos) + (n.p.y - s.pos.y) ** 2 * 4;
        if (d < bd) {
          bd = d;
          best = n.p;
        }
      }
      if (best) {
        s.pos = best.clone();
        s.route = undefined;
      }
    }
    taken.push(s.pos);
  }
}
