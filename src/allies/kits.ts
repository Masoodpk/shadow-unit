import { Color3 } from "@babylonjs/core/Maths/math.color";
import { Mesh } from "@babylonjs/core/Meshes/mesh";
import { Quaternion, Vector3 } from "@babylonjs/core/Maths/math.vector";
import { TransformNode } from "@babylonjs/core/Meshes/transformNode";
import { BeamFx } from "../fx/SuperFx";
import type { CineShot } from "../characters/cinematics";
import { lookRotation } from "../core/math";
import { pose, type Pose } from "./SpiderPoses";
import {
  HIT, LANDING, P, STANCE, TUCK, V, aimArm, angDiff, clipDur, comboMove, copyPose, flat, mixPose, naturalArms, normD, pick, rnd, sample, shootMove,
  type Act, type Entrance, type Kit, type Move, type RosterHero, type Tgt,
} from "./RosterHero";

/**
 * The seven Phase-2 heroes, each a kit for RosterHero: their poses, their moves (the roster's
 * abilities performed), their own landing, their entrance (staged and shot), and what they say.
 * Lines are written for this game (subtitles only — no voice files are used).
 */

// ------------------------------------------------------------------ shared helpers
/** an open spot in front of you, `min`–`max` m out, with sky above it and a clear view to it */
export function spotNear(h: RosterHero, min: number, max: number, sky = true): Vector3 | null {
  const nav = h.host.nav;
  const me = h.host.player.feet;
  const look = h.host.player.camera.getDirection(Vector3.Forward());
  look.y = 0;
  look.normalize();
  const eye = me.add(V(0, 1.6, 0));
  let best: Vector3 | null = null, bs = -Infinity;
  for (const n of nav.nodes) {
    const d = Math.hypot(n.p.x - me.x, n.p.z - me.z);
    if (d < min || d > max) continue;
    if (sky && !nav.clear(n.p.add(V(0, 1.2, 0)), n.p.add(V(0, 40, 0)))) continue;
    if (!nav.clear(eye, n.p.add(V(0, 1.2, 0)))) continue;
    if ([[1.2, 0], [-1.2, 0], [0, 1.2], [0, -1.2]].some(([dx, dz]) => nav.embedded(n.p.x + dx, n.p.y + 1, n.p.z + dz))) continue;
    const s = Vector3.Dot(n.p.subtract(me).normalize(), look) * 10 - Math.abs(d - (min + max) / 2) * 0.3 + Math.random();
    if (s > bs) (bs = s), (best = n.p.clone());
  }
  return best;
}
/** from the spot toward you (the way they face when they arrive) */
export const faceYou = (h: RosterHero) => h.faceTo(h.host.player.feet);
/** a camera at `dist` m from the hero at `ang` (radians off his facing), `up` m high, looking at his chest */
export function orbit(h: RosterHero, ang: number, dist: number, up: number, fov: number, cut = false, lookUp = 1.1): CineShot {
  const a = h.yaw + ang;
  const at = h.p.add(V(0, h.def.height * 0.55 * lookUp, 0));
  return { pos: h.p.add(V(Math.sin(a) * dist, up, Math.cos(a) * dist)), target: at, fov, cut };
}
/** the foe or the nearest trouble, for a look at it */
export function trouble(h: RosterHero) {
  // (a villain looks at you)
  if (h.side === "villain") return h.host.player.feet;
  const f = h.host.foe(h);
  if (f && f.alive && f.state !== "dormant") return f.position;
  let best: Vector3 | null = null, bd = 60;
  for (const s of h.host.soldiers()) {
    if (!s.alive || s.dormant) continue;
    const d = Vector3.Distance(s.position, h.p);
    if (d < bd) (bd = d), (best = s.position);
  }
  return best;
}
/** a forward rush to the target (a charge, a ram, the Flash's dash), hitting on arrival */
export function dashMove(id: string, o: { speed: number; reach: number; launch: number; up: number; pose: (h: RosterHero, a: Act, want: Pose) => void; fly?: boolean; trail?: (h: RosterHero, dir: Vector3) => void; sound?: string; vsAir?: boolean; afterHit?: (h: RosterHero, t: Tgt) => void }): Move {
  return {
    moves: true,
    airborne: o.fly,
    vsAir: o.vsAir,
    start(h, a) {
      if (!a.tgt) return false;
      a.dur = 2.2;
      a.data.wind = 0.18;
      h.host.audio.play(o.sound ?? "swingWhoosh", { x: h.p.x, y: h.p.y + 1, z: h.p.z, volume: 0.8 });
    },
    frame(h, a, dt) {
      const t = a.tgt!;
      if (!h.tgtAlive(t)) return true;
      if (a.t < (a.data.wind as number)) {
        h.faceTo(h.tgtGround(t));
        return;
      }
      const aim = o.fly ? h.aimOf(t).subtract(V(0, h.def.height * 0.5, 0)) : h.tgtGround(t);
      const to = o.fly ? aim.subtract(h.p) : flat(aim.subtract(h.p));
      const d = to.length();
      if (d < o.reach + 0.4 * h.sizeOf(t)) {
        const def = h.book.def(id);
        h.hit(t, def?.damage ?? 30, to.lengthSquared() > 1e-4 ? to : h.fwd(), { force: 3, launch: o.launch, up: o.up });
        const p = h.aimOf(t);
        h.host.audio.play("superPunch", { x: p.x, y: p.y, z: p.z, volume: 0.9 });
        h.host.spark(p, to.normalizeToNew().scale(-1));
        h.host.dust(h.p.clone(), 0.3);
        o.afterHit?.(h, t);
        return true;
      }
      const dir = to.scale(1 / d);
      h.yaw = Math.atan2(dir.x, dir.z);
      const step = Math.min(d, o.speed * dt);
      if (o.fly) {
        h.v.copyFrom(dir.scale(o.speed));
        const next = h.p.add(dir.scale(step));
        if (h.host.nav.moveHit(h.center(), next.add(V(0, h.def.height * 0.55, 0)))) return true;
        h.p.copyFrom(next);
      } else {
        const n = Math.max(1, Math.ceil(step / 0.5));
        for (let i = 0; i < n; i++) if (!h.stepTo(h.p.x + (dir.x * step) / n, h.p.z + (dir.z * step) / n)) return true;
      }
      o.trail?.(h, dir);
    },
    pose(h, a, want) {
      o.pose(h, a, want);
      return 22;
    },
  };
}
/**
 * A model's prop bone re-seated on the body (in the rest pose, before anything moves). These models
 * came without their animations, and their prop bones sit where the clips would have pulled them
 * from (Thor's hammer 1.3 m off his hand, Cap's shield 0.6 m) — so the prop is placed by its own
 * geometry instead: `grip` is the point on the prop (in its bone's units) that goes in the palm;
 * the prop's long axis (its bone's +Y) runs across the hand, index to little finger (a fist round a
 * handle); for `onForearm` it's laid flat on the outside of the forearm instead (a shield).
 */
export function seat(h: RosterHero, node: TransformNode, side: "Left" | "Right", o: { grip?: number; onForearm?: boolean; out?: number; flip?: boolean }) {
  const rig = h.rig;
  const hand = rig.bone(side + "Hand"), fore = rig.bone(side + "ForeArm");
  if (!hand || !fore) return false;
  const P = (n: string) => rig.bone(n)?.getAbsolutePosition();
  for (const n of [hand, fore]) n.computeWorldMatrix(true);
  const hp = hand.getAbsolutePosition(), ep = fore.getAbsolutePosition();
  const idx = P(side + "HandIndex1"), pinky = P(side + "HandPinky1"), mid = P(side + "HandMiddle1");
  const fingers = (mid ?? hp.add(hp.subtract(ep).normalize().scale(0.08))).subtract(hp).normalize();
  // across the hand (index → little finger); without fingers, square to the forearm and the world's up
  let across = idx && pinky ? pinky.subtract(idx) : Vector3.Cross(fingers, V(0, 1, 0));
  across = across.subtract(fingers.scale(Vector3.Dot(across, fingers))).normalize();
  // the back of the hand (and the outside of the forearm): the rest pose has the palms down
  let back = Vector3.Cross(fingers, across).normalize();
  if (back.y < 0) back = back.scale(-1);
  const ps = V();
  hand.getWorldMatrix().decompose(ps);
  const k = (ps.x + ps.y + ps.z) / 3;
  let Y: Vector3, Z: Vector3, at: Vector3;
  if (o.onForearm) {
    // the disc's face (its +Y) out from the back of the forearm, its top (+Z) toward the hand
    const fdir = hp.subtract(ep).normalize();
    Y = back;
    Z = fdir.subtract(Y.scale(Vector3.Dot(fdir, Y))).normalize();
    at = Vector3.Lerp(ep, hp, 0.55).add(Y.scale(o.out ?? 0.07));
  } else {
    // (flip: the prop's +Y toward the index finger — a staff's head up out of the top of the fist)
    Y = o.flip ? across.scale(-1) : across;
    Z = back.subtract(Y.scale(Vector3.Dot(back, Y))).normalize();
    const palm = hp.add(fingers.scale(Vector3.Distance(hp, mid ?? hp) * 0.55 + 0.02)).subtract(back.scale(0.03));
    at = palm.subtract(Y.scale((o.grip ?? 0) * k));
  }
  const X = Vector3.Cross(Y, Z).normalize();
  const q = Quaternion.RotationQuaternionFromAxis(X, Y, Z);
  h.takeProp(node).place(at, q);
  return true;
}

/**
 * A rigid prop's parts merged by material, in its own space (Star-Lord's element guns: nine parts
 * each, a draw each, down to one per material)
 */
function mergeByMaterial(node: TransformNode, owned: Mesh[]) {
  const parts = node.getChildMeshes(false).filter((m): m is Mesh => m instanceof Mesh && !m.skeleton && m.getTotalVertices() > 0);
  const byMat = new Map<unknown, Mesh[]>();
  for (const m of parts) {
    if (!byMat.has(m.material)) byMat.set(m.material, []);
    byMat.get(m.material)!.push(m);
  }
  node.computeWorldMatrix(true);
  const inv = node.getWorldMatrix().clone().invert();
  for (const [mat, list] of byMat) {
    if (list.length < 2) continue;
    const baked = list.map((m) => {
      m.computeWorldMatrix(true);
      const c = m.clone(m.name + "_m", null, true)!;
      c.makeGeometryUnique();
      c.setParent(null);
      c.position.setAll(0);
      c.rotationQuaternion = null;
      c.rotation.setAll(0);
      c.scaling.setAll(1);
      c.bakeTransformIntoVertices(m.getWorldMatrix().multiply(inv));
      const i = owned.indexOf(m);
      if (i >= 0) owned.splice(i, 1);
      m.dispose();
      return c;
    });
    const merged = Mesh.MergeMeshes(baked, true, true, undefined, false, false);
    if (!merged) continue;
    merged.parent = node;
    merged.material = mat as Mesh["material"];
    merged.isPickable = false;
    merged.alwaysSelectAsActiveMesh = true;
    merged.receiveShadows = true;
    owned.push(merged);
  }
}

/** the arm points at a world position (for poses aimed at someone) */
export function armAt(h: RosterHero, want: Pose, side: "l" | "r", at: Vector3) {
  const d = h.toBody(at.subtract(h.rig.at(side === "l" ? "LeftArm" : "RightArm")));
  aimArm(want, side, d);
}

// ================================================================== THOR
const THOR_STANCE = pose(
  {
    hips: [0, 1, 0.05], spine: [0, 1, 0.1], spine1: [0, 1, 0.12], spine2: [0, 1, 0.08], neck: [0, 1, 0.08], head: [0, 1, 0.1],
    lArm: [-0.4, -0.75, 0.5], lFore: [0.1, 0.35, 0.93], lHand: [0.1, 0.2, 0.97],
    rArm: [0.3, -0.93, 0.18], rFore: [0.12, -0.75, 0.65], rHand: [0.05, -0.6, 0.8],
    lThigh: [-0.22, -0.95, 0.2], lShin: [-0.05, -0.95, -0.25], rThigh: [0.24, -0.96, -0.12], rShin: [0.05, -0.93, -0.33],
  },
  [0, 0.94, 0],
);
/** the hammer to the sky: calling the lightning */
const THOR_CALL = pose(
  {
    hips: [0, 1, -0.05], spine: [0, 1, -0.12], spine1: [0, 1, -0.15], spine2: [0, 1, -0.1], neck: [0, 1, -0.2], head: [0, 0.85, -0.5],
    rArm: [0.18, 0.98, 0.05], rFore: [0.05, 1, 0.02], rHand: [0, 1, 0.05],
    lArm: [-0.85, -0.2, 0.45], lFore: [-0.6, 0.2, 0.75], lHand: [-0.5, 0.2, 0.84],
    lThigh: [-0.25, -0.96, 0.05], rThigh: [0.25, -0.96, 0.05],
  },
  [0, 0.97, 0],
);
/** the throw: wound back over his shoulder / released forward */
const THOR_WIND = pose(
  {
    hips: [0, 1, 0], spine: [0.1, 1, -0.1], spine1: [0.15, 1, -0.15], spine2: [0.15, 1, -0.12], neck: [0, 1, 0.05], head: [0, 1, 0.15],
    rArm: [0.55, 0.55, -0.62], rFore: [0.2, 0.95, -0.25], rHand: [0.1, 0.9, -0.4],
    lArm: [-0.5, -0.3, 0.8], lFore: [-0.2, 0.2, 0.96],
    lThigh: [-0.22, -0.93, 0.3], rThigh: [0.24, -0.96, -0.18], rShin: [0.05, -0.9, -0.42],
  },
  [0, 0.93, 0],
);
const THOR_RELEASE = pose(
  {
    hips: [0, 1, 0.1], spine: [-0.1, 1, 0.2], spine1: [-0.15, 1, 0.25], spine2: [-0.15, 1, 0.2], neck: [0, 1, 0.15], head: [0, 1, 0.15],
    rArm: [0.1, 0.2, 0.98], rFore: [0.05, 0.1, 1], rHand: [0, 0.05, 1],
    lArm: [-0.6, -0.7, -0.35], lFore: [-0.2, -0.6, 0.7],
    lThigh: [-0.2, -0.85, 0.48], lShin: [0, -0.96, -0.3], rThigh: [0.24, -0.92, -0.32], rShin: [0.06, -0.8, -0.6],
  },
  [0, 0.88, 0.05],
);
/** his landing: down on one knee, the hammer driven into the ground beside him */
const THOR_LAND = pose(
  {
    hips: [0, 0.85, 0.5], spine: [0, 0.8, 0.6], spine1: [0, 0.82, 0.57], spine2: [0, 0.88, 0.48], neck: [0, 0.95, 0.3], head: [0, 0.97, 0.22],
    rArm: [0.35, -0.75, 0.56], rFore: [0.05, -1, 0.05], rHand: [0, -1, 0.1],
    lArm: [-0.45, -0.8, 0.4], lFore: [-0.1, -0.5, 0.86], lHand: [-0.1, -0.3, 0.95],
    lThigh: [-0.12, -0.35, 0.93], lShin: [-0.02, -1, -0.08], lFoot: [-0.1, -0.35, 0.93],
    rThigh: [0.15, -0.88, -0.45], rShin: [0.04, -0.12, -0.99], rFoot: [0.05, -0.95, -0.3],
  },
  [0, 0.47, -0.05],
);
const LIGHT = new Color3(0.55, 0.75, 1);

function thorHammer(h: RosterHero) {
  return (h as RosterHero & { _hammer?: ReturnType<RosterHero["takeProp"]> })._hammer;
}
/** Mjolnir out of his hand and back: a spinning flight to the target, a hit, and home again */
const HAMMER_THROW: Move = {
  start(h, a) {
    if (!thorHammer(h) || !a.tgt) return false;
    a.dur = 3.2;
    a.data.phase = "wind";
  },
  frame(h, a, dt) {
    const hm = thorHammer(h)!;
    const t = a.tgt!;
    if (a.data.phase === "wind") {
      h.faceTo(h.tgtGround(t));
      if (a.t >= 0.32) {
        a.data.phase = "out";
        a.data.at = h.hand("r");
        a.data.q0 = hm.worldRot();
        a.data.spin = 0;
        h.host.audio.play("swingWhoosh", { x: h.p.x, y: h.p.y + 1.5, z: h.p.z, volume: 1, rate: 0.7 });
      }
      return;
    }
    const at = a.data.at as Vector3;
    a.data.spin = (a.data.spin as number) + dt * 16;
    const goal = a.data.phase === "out" && h.tgtAlive(t) ? h.aimOf(t) : a.data.phase === "out" ? (a.data.lastAim as Vector3 ?? at) : h.hand("r");
    if (a.data.phase === "out") a.data.lastAim = goal.clone();
    const to = goal.subtract(at);
    const d = to.length();
    const step = (a.data.phase === "out" ? 34 : 30) * dt;
    if (d <= step + 0.3) {
      if (a.data.phase === "out") {
        // the blow: and a crackle of lightning off it
        if (h.tgtAlive(t)) h.hit(t, h.book.def("throw")?.damage ?? 40, to.lengthSquared() > 1e-4 ? to : h.fwd(), { force: 3, launch: 12, up: 4 });
        h.host.audio.play("superPunch", { x: goal.x, y: goal.y, z: goal.z, volume: 1, rate: 0.85 });
        h.host.lightning.strike(goal.add(V(0, 0.2, 0)), goal.add(V(rnd(-1, 1), -1.2, rnd(-1, 1))), LIGHT, 0.2, 0.5, 0.4, 2);
        a.data.phase = "back";
      } else {
        hm.release();
        h.host.audio.play("impactMetal", { x: goal.x, y: goal.y, z: goal.z, volume: 0.7, rate: 0.6 });
        return true;
      }
    } else at.addInPlace(to.scale(step / d));
    const spin = Quaternion.RotationAxis(h.right(), a.data.spin as number);
    hm.place(at, spin.multiply(a.data.q0 as Quaternion));
    if (Math.random() < 0.4) h.host.glow.emit(at, V(rnd(-1, 1), rnd(-1, 1), rnd(-1, 1)), 0.15, 0.25, 0.5, new Color3(0.9, 0.95, 1), LIGHT, 0.8, 3, 0);
    // (the hand stays out for the catch)
    a.dur = Math.max(a.dur, a.t + 0.2);
  },
  pose(_h, a, want) {
    if (a.data.phase === "wind") copyPose(THOR_WIND, want);
    else copyPose(THOR_RELEASE, want);
    return a.data.phase === "wind" ? 18 : 26;
  },
  stop(h: RosterHero) {
    thorHammer(h)?.release();
  },
} as Move;
/** the hammer to the sky, and the lightning comes down on them */
function lightningMove(id: string, bolts: number, radius: number, rise: number): Move {
  return {
    vsAir: id === "lightning",
    moves: rise > 0,
    start(h, a) {
      if (!a.tgt) return false;
      a.dur = rise > 0 ? 3.4 : 1.6;
      a.data.y0 = h.p.y;
      h.host.audio.play("repulsorCharge", { x: h.p.x, y: h.p.y + 2, z: h.p.z, volume: 0.9, rate: 0.6 });
      if (rise > 0) h.say(pick(["Bring me the storm!", "Feel the thunder!"]), 2);
    },
    frame(h, a, dt) {
      const t = a.tgt!;
      if (rise > 0) {
        // up into the air on the storm, held there, and down
        const y0 = a.data.y0 as number;
        const f = a.t < 0.6 ? a.t / 0.6 : a.t > a.dur - 0.5 ? (a.dur - a.t) / 0.5 : 1;
        h.p.y = y0 + rise * Math.sin((f * Math.PI) / 2);
      }
      if (h.tgtAlive(t)) h.turnTo(Math.atan2(h.tgtGround(t).x - h.p.x, h.tgtGround(t).z - h.p.z), dt, 4);
      // the hammer crackles while he calls it
      const top = h.hand("r").add(V(0, 0.35, 0));
      if (Math.random() < 0.5) h.host.lightning.strike(top, top.add(V(rnd(-0.8, 0.8), rnd(0.2, 1), rnd(-0.8, 0.8))), LIGHT, 0.08, 0.3, 0.25, 0);
      const first = 0.75;
      const every = rise > 0 ? 0.28 : 0.3;
      while (a.n < bolts && a.t >= first + a.n * every) {
        a.n++;
        // (the storm: whoever's round him; a strike: the target, and what's near it)
        let at: Vector3;
        if (rise > 0) {
          const near = h.around(h.p, radius);
          const x = near.length ? pick(near) : null;
          at = x ? h.tgtGround(x) : h.p.add(V(rnd(-radius, radius), 0, rnd(-radius, radius)));
        } else at = h.tgtAlive(t) ? ("air" in t ? h.aimOf(t) : h.tgtGround(t)) : (a.data.last as Vector3 ?? h.p.add(h.fwd().scale(8)));
        a.data.last = at.clone();
        const sky = at.add(V(rnd(-3, 3), 34, rnd(-3, 3)));
        h.host.lightning.strike(sky, at, LIGHT, 0.32, 1.4, 2.4, 3);
        h.host.lightning.strike(top, top.add(V(0, 6, 0)), LIGHT, 0.2, 0.6, 0.8, 1);
        h.host.audio.play("hulkClap", { x: at.x, y: at.y, z: at.z, volume: 0.9, rate: 1.5 });
        h.host.audio.play("sonicBoom", { x: at.x, y: at.y + 8, z: at.z, volume: 0.5, rate: 0.75 });
        h.host.rings.boom(at.add(V(0, 0.2, 0)), V(0, 1, 0), radius * 1.6);
        h.host.dust(at.clone(), 0.5);
        const def = h.book.def(id);
        const dmg = def?.damage ?? 50;
        for (const x of h.around(at, radius, true)) h.hit(x, dmg * (rise > 0 ? 0.5 : 1), h.tgtGround(x).subtract(at).add(V(0, 0.01, 0)), { force: 3, launch: 7, up: 5, kind: "blast" });
        h.host.player.shake(Math.max(0.05, 0.4 - Vector3.Distance(at, h.host.player.feet) / 60));
      }
    },
    pose(_h, a, want) {
      copyPose(THOR_CALL, want);
      if (rise > 0) mixPose(want, TUCK, 0.15, want);
      return a.t < 0.3 ? 14 : 24;
    },
    stop(h: RosterHero, a: Act) {
      if (rise > 0) h.p.y = (a.data.y0 as number) ?? h.p.y;
    },
  } as Move;
}
const THOR_ENTRANCE: Entrance = {
  dur: 6.2,
  begin(h) {
    const at = spotNear(h, 9, 18);
    if (!at) return false;
    h.p.copyFrom(at);
    faceYou(h);
    return true;
  },
  frame(h, t) {
    const sky = h.p.add(V(0, 40, 0));
    // the sky splits: a bolt, then him in it
    if (t < 1.4 && Math.random() < 0.25) h.host.lightning.strike(sky.add(V(rnd(-20, 20), 0, rnd(-20, 20))), sky.add(V(rnd(-20, 20), rnd(-14, -4), rnd(-20, 20))), LIGHT, 0.2, 1, 3, 2);
    if (t >= 1.4 && !(h as { _struck?: boolean })._struck) {
      (h as { _struck?: boolean })._struck = true;
      for (let k = 0; k < 3; k++) h.host.lightning.strike(sky.add(V(rnd(-2, 2), 0, rnd(-2, 2))), h.p.add(V(0, 0.4, 0)), LIGHT, 0.6, 2.2, 2.5, 4);
      h.host.audio.play("hulkClap", { x: h.p.x, y: h.p.y, z: h.p.z, volume: 1.2, rate: 1.3 });
      h.host.audio.play("sonicBoom", { x: h.p.x, y: h.p.y + 10, z: h.p.z, volume: 0.9, rate: 0.7 });
      h.host.rings.boom(h.p.add(V(0, 0.2, 0)), V(0, 1, 0), 14);
      h.host.slam(h.p.clone(), 1);
      h.host.player.shake(0.45);
    }
    if (t > 1.4 && t < 2.6 && Math.random() < 0.6) {
      const at = h.hand("r");
      h.host.lightning.strike(at, at.add(V(rnd(-1.5, 1.5), rnd(-1, 0.5), rnd(-1.5, 1.5))), LIGHT, 0.1, 0.4, 0.35, 0);
    }
    if (t > 4.2 && !(h as { _said?: boolean })._said) {
      (h as { _said?: boolean })._said = true;
      h.say("Did someone call for thunder?", 2.6);
    }
    if (t > 4.2) {
      const tr = trouble(h);
      if (tr) h.turnTo(Math.atan2(tr.x - h.p.x, tr.z - h.p.z), 1 / 60, 2.5);
    }
    if (t >= this.dur - 0.05) (h as { _struck?: boolean; _said?: boolean })._struck = (h as { _said?: boolean })._said = false;
  },
  pose(h, t, want) {
    h.rig.setVisible(t >= 1.4);
    if (t < 2.6) copyPose(THOR_LAND, want);
    else if (t < 3.6) mixPose(THOR_LAND, THOR_STANCE, (t - 2.6) / 1, want);
    else if (t < 5) copyPose(THOR_CALL, want);
    else copyPose(THOR_STANCE, want);
    return t < 1.5 ? 60 : 8;
  },
  shot(h, t) {
    if (t < 1.4) return { pos: h.p.add(h.fwd().scale(14)).addInPlaceFromFloats(0, 2, 0), target: h.p.add(V(0, 14, 0)), fov: 0.95, cut: t < 0.03 };
    if (t < 3.6) return orbit(h, 0.5, 4.2 - (t - 1.4) * 0.4, 0.5, 0.8, t < 1.43, 0.7);
    return orbit(h, -0.35 + (t - 3.6) * 0.12, 3.4, 1.4, 0.72, t < 3.63);
  },
};
export const THOR: Kit = {
  id: "thor", color: "#c8102e", label: "TH",
  run: 7, sprint: 9.5,
  prefer: ["storm", "lightning", "throw", "hammer"],
  holdRange: 2.2,
  stance: THOR_STANCE,
  landing: THOR_LAND,
  moves: {
    hammer: comboMove("hammer", [{ clip: "hook", speed: 1.25, hits: [0.29] }, { clip: "combo", speed: 1.3, hits: [0.12, 0.32, 0.56, 0.79] }, { clip: "smash", speed: 1.15, hits: [0.41] }], 2.6, {
      launch: 11, up: 5, force: 3, sound: "superPunch",
      after: (h, _a, last) => {
        if (!last) return;
        const at = h.hand("r");
        h.host.lightning.strike(at, at.add(h.fwd().scale(2)).addInPlaceFromFloats(0, -0.5, 0), LIGHT, 0.12, 0.6, 0.5, 1);
      },
    }),
    lightning: lightningMove("lightning", 2, 4, 0),
    throw: HAMMER_THROW,
    storm: lightningMove("storm", 8, 10, 2.6),
  },
  entrance: THOR_ENTRANCE,
  lines: {
    intro: "Did someone call for thunder?",
    hit: ["Is that all?", "You'll have to do better."],
    down: ["…A moment. Just a moment."],
    up: ["I am Thor! I rise!", "Again!"],
    victory: ["A fine battle! Drinks — on me."],
    fight: ["For Asgard!", "Have at you!", "Come, then!"],
  },
  async setup(h) {
    // Mjolnir is skinned to a bone off his right hand (Bone010): it moves with the hand; for the
    // throw it's taken over and flown
    const b = h.rig.node("Bone010");
    if (b) {
      // (the handle's end at −0.25 along the bone, the head from +0.2: gripped a little up the handle)
      seat(h, b, "Right", { grip: -0.17 });
      (h as RosterHero & { _hammer?: unknown })._hammer = h.takeProp(b);
    }
  },
};

// ================================================================== CAPTAIN AMERICA
const CAP_STANCE = pose(
  {
    hips: [0, 1, 0.06], spine: [0, 1, 0.12], spine1: [0, 1, 0.15], spine2: [0, 1, 0.1], neck: [0, 1, 0.1], head: [0, 0.98, 0.15],
    // the shield on the left arm, held across the body below the chest (his face clear above it)
    lArm: [-0.42, -0.78, 0.46], lFore: [0.55, -0.05, 0.83], lHand: [0.5, -0.05, 0.86],
    rArm: [0.42, -0.8, 0.42], rFore: [-0.12, 0.45, 0.88], rHand: [-0.1, 0.25, 0.96],
    lThigh: [-0.22, -0.92, 0.3], lShin: [-0.05, -0.95, -0.28], rThigh: [0.25, -0.95, -0.15], rShin: [0.05, -0.92, -0.38],
  },
  [0, 0.9, 0],
);
/** behind the shield: low, the shield up in front of his face */
const CAP_BLOCK = pose(
  {
    hips: [0, 1, 0.15], spine: [0, 0.95, 0.3], spine1: [0, 0.95, 0.3], spine2: [0, 0.97, 0.22], neck: [0, 1, 0.1], head: [0, 0.98, 0.15],
    lArm: [-0.2, 0.05, 0.98], lFore: [0.75, 0.6, 0.28], lHand: [0.6, 0.7, 0.3],
    rArm: [0.4, -0.7, 0.6], rFore: [-0.2, 0.4, 0.9],
    lThigh: [-0.3, -0.8, 0.5], lShin: [-0.05, -0.95, -0.3], rThigh: [0.3, -0.9, -0.3], rShin: [0.05, -0.8, -0.6],
  },
  [0, 0.78, 0],
);
/** the throw: shield drawn across to his right hip, then flung out flat */
const CAP_WIND = pose(
  {
    hips: [0, 1, 0], spine: [-0.2, 1, 0.05], spine1: [-0.3, 1, 0.05], spine2: [-0.3, 1, 0.05], neck: [0, 1, 0.1], head: [0.1, 1, 0.15],
    lArm: [0.45, -0.55, 0.7], lFore: [0.95, -0.1, -0.25], lHand: [0.9, 0, -0.4],
    rArm: [0.6, -0.75, -0.2], rFore: [0.4, -0.6, 0.7],
    lThigh: [-0.22, -0.93, 0.3], rThigh: [0.24, -0.96, -0.18],
  },
  [0, 0.92, 0],
);
const CAP_FLING = pose(
  {
    hips: [0, 1, 0.08], spine: [0.2, 1, 0.15], spine1: [0.3, 1, 0.15], spine2: [0.3, 1, 0.12], neck: [0, 1, 0.1], head: [-0.1, 1, 0.15],
    lArm: [-0.95, 0.05, 0.3], lFore: [-0.98, 0.05, 0.2], lHand: [-1, 0.05, 0.1],
    rArm: [0.5, -0.7, 0.5], rFore: [0.1, -0.2, 0.97],
    lThigh: [-0.22, -0.88, 0.42], rThigh: [0.25, -0.95, -0.25],
  },
  [0, 0.9, 0.04],
);
/** his landing: down on one knee, the shield up over him, the right fist on the ground */
const CAP_LAND = pose(
  {
    hips: [0, 0.8, 0.6], spine: [0, 0.72, 0.7], spine1: [0, 0.7, 0.72], spine2: [0, 0.78, 0.62], neck: [0, 0.9, 0.45], head: [0, 0.95, 0.3],
    lArm: [-0.25, 0.25, 0.94], lFore: [0.55, 0.6, 0.58], lHand: [0.5, 0.6, 0.62],
    rArm: [0.28, -0.88, 0.38], rFore: [0.08, -0.99, 0.08], rHand: [0.05, -0.9, 0.42],
    lThigh: [-0.12, -0.35, 0.93], lShin: [-0.02, -1, -0.08], lFoot: [-0.1, -0.35, 0.93],
    rThigh: [0.15, -0.88, -0.45], rShin: [0.04, -0.12, -0.99], rFoot: [0.05, -0.95, -0.3],
  },
  [0, 0.47, -0.05],
);
/** "Avengers…": the shield raised high */
const CAP_RALLY = pose(
  {
    hips: [0, 1, 0], spine: [0, 1, -0.05], spine1: [0, 1, -0.08], spine2: [0, 1, -0.05], neck: [0, 1, 0], head: [0, 1, 0.05],
    lArm: [-0.3, 0.95, 0.1], lFore: [-0.1, 0.99, 0.1], lHand: [0, 1, 0.1],
    rArm: [0.3, -0.85, 0.4], rFore: [-0.1, 0.4, 0.9],
  },
  [0, 1, 0],
);
function capShield(h: RosterHero) {
  return (h as RosterHero & { _shield?: ReturnType<RosterHero["takeProp"]> })._shield;
}
/** the shield thrown: out to the target, off it to one more if there's one near, and back to his arm */
const SHIELD_THROW: Move = {
  start(h, a) {
    if (!capShield(h) || !a.tgt) return false;
    a.dur = 3.4;
    a.data.phase = "wind";
    a.data.hops = 0;
  },
  frame(h, a, dt) {
    const sh = capShield(h)!;
    if (a.data.phase === "wind") {
      if (a.tgt) h.faceTo(h.tgtGround(a.tgt));
      if (a.t >= 0.3) {
        a.data.phase = "out";
        a.data.at = h.hand("l");
        a.data.q0 = sh.worldRot();
        a.data.spin = 0;
        a.data.cur = a.tgt;
        h.host.audio.play("batarang", { x: h.p.x, y: h.p.y + 1.3, z: h.p.z, volume: 0.9, rate: 0.75 });
      }
      return;
    }
    const at = a.data.at as Vector3;
    a.data.spin = (a.data.spin as number) + dt * 22;
    const cur = a.data.cur as Tgt | null;
    const goal = a.data.phase === "out" && cur && h.tgtAlive(cur) ? h.aimOf(cur) : h.hand("l");
    if (a.data.phase === "out" && !(cur && h.tgtAlive(cur))) a.data.phase = "back";
    const to = goal.subtract(at);
    const d = to.length();
    const step = 30 * dt;
    if (d <= step + 0.35) {
      if (a.data.phase === "out" && cur) {
        h.hit(cur, h.book.def("shieldThrow")?.damage ?? 25, to.lengthSquared() > 1e-4 ? to : h.fwd(), { force: 2, launch: 7, up: 2.5 });
        h.host.audio.play("impactMetal", { x: goal.x, y: goal.y, z: goal.z, volume: 1, rate: 0.9 });
        h.host.spark(goal, to.normalizeToNew().scale(-1));
        // a ricochet to one more, close by
        const hops = (a.data.hops as number) + 1;
        a.data.hops = hops;
        const next = hops < 2 ? h.around(goal, 9).find((x) => !("foe" in x && "foe" in cur && x.foe === cur.foe) && !("soldier" in x && "soldier" in cur && x.soldier === cur.soldier)) : undefined;
        if (next) a.data.cur = next;
        else a.data.phase = "back";
      } else if (a.data.phase === "back") {
        sh.release();
        h.host.audio.play("impactMetal", { x: goal.x, y: goal.y, z: goal.z, volume: 0.6, rate: 1.3 });
        return true;
      }
    } else at.addInPlace(to.scale(step / d));
    // (flat, spinning)
    sh.place(at, Quaternion.RotationAxis(V(0, 1, 0), a.data.spin as number).multiply(a.data.q0 as Quaternion));
    a.dur = Math.max(a.dur, a.t + 0.2);
  },
  pose(_h, a, want) {
    copyPose(a.data.phase === "wind" ? CAP_WIND : CAP_FLING, want);
    return a.data.phase === "wind" ? 20 : 26;
  },
  stop(h: RosterHero) {
    capShield(h)?.release();
  },
} as Move;
/** the block: up behind the shield, the blow glances off */
const CAP_BLOCK_MOVE: Move = {
  start(h, a) {
    a.dur = 1.1;
    h.guard = 0.12;
    h.host.audio.play("foley", { x: h.p.x, y: h.p.y, z: h.p.z, volume: 0.6 });
    void a;
  },
  frame(h, a) {
    const f = h.host.foe(h);
    if (f) h.faceTo(f.position);
    if (a.t > a.dur - 0.05) h.guard = 1;
  },
  pose(_h, _a, want) {
    copyPose(CAP_BLOCK, want);
    return 30;
  },
  stop(h: RosterHero) {
    h.guard = 1;
  },
} as Move;
const CAP_RALLY_MOVE: Move = {
  start(h, a) {
    a.dur = 2;
    h.say("Avengers… assemble!", 2.4);
    h.host.audio.play("impactMetal", { x: h.p.x, y: h.p.y + 2, z: h.p.z, volume: 0.6, rate: 0.5 });
    // (everyone near him on the roster's side fights harder for a while)
    for (const c of h.host.heroes()) {
      const r = c as RosterHero;
      if (r.power !== undefined && Vector3.Distance(c.feet, h.p) < 15) {
        r.power = 1.25;
        setTimeout(() => (r.power = 1), 9000);
      }
    }
    void a;
  },
  frame() {},
  pose(_h, _a, want) {
    copyPose(CAP_RALLY, want);
    return 12;
  },
};
const CAP_ENTRANCE: Entrance = {
  dur: 5.6,
  begin(h) {
    const at = spotNear(h, 8, 16);
    if (!at) return false;
    h.p.copyFrom(at);
    faceYou(h);
    (h as { _land?: Vector3 })._land = at.clone();
    return true;
  },
  frame(h, t, dt) {
    // dropped in from high above (out of the low cloud), shield first: the landing cracks the snow
    const land = (h as { _land?: Vector3 })._land!;
    const T = 1.5;
    if (t < T) {
      const f = t / T;
      h.p.set(land.x, land.y + 38 * (1 - f * f), land.z);
    } else if (h.p.y > land.y) {
      h.p.copyFrom(land);
      h.host.slam(land.clone(), 0.8);
      h.host.audio.play("impactMetal", { x: land.x, y: land.y, z: land.z, volume: 1.2, rate: 0.5 });
      h.host.audio.play("hulkSlam", { x: land.x, y: land.y, z: land.z, volume: 0.6, rate: 1.5 });
      h.host.rings.boom(land.add(V(0, 0.1, 0)), V(0, 1, 0), 7);
      h.host.player.shake(0.3);
    }
    if (t > 3.6) {
      const tr = trouble(h);
      if (tr) h.turnTo(Math.atan2(tr.x - h.p.x, tr.z - h.p.z), dt, 2.5);
    }
  },
  pose(_h, t, want) {
    if (t < 1.5) copyPose(TUCK, want);
    else if (t < 2.8) copyPose(CAP_LAND, want);
    else if (t < 3.8) mixPose(CAP_LAND, CAP_STANCE, (t - 2.8) / 1, want);
    else copyPose(CAP_STANCE, want);
    return t < 1.55 ? 40 : 9;
  },
  shot(h, t) {
    const land = (h as { _land?: Vector3 })._land ?? h.p;
    if (t < 1.5) return { pos: land.add(h.fwd().scale(9)).addInPlaceFromFloats(0, 0.6, 0), target: h.p.add(V(0, 0.8, 0)), fov: 0.9, cut: t < 0.03 };
    if (t < 3.6) return orbit(h, 0.6, 3.2, 0.35, 0.78, t < 1.53, 0.6);
    return orbit(h, -0.4, 3, 1.3, 0.72, t < 3.63);
  },
};
export const CAP: Kit = {
  id: "cap", color: "#2f5fd0", label: "CA",
  run: 7, sprint: 10,
  prefer: ["rally", "shieldThrow", "bash"],
  holdRange: 2,
  stance: CAP_STANCE,
  landing: CAP_LAND,
  moves: {
    bash: comboMove("bash", [{ clip: "hook", speed: 1.4, hits: [0.29] }, { clip: "mmaKick", speed: 1.4, hits: [0.258, 0.468] }, { clip: "combo", speed: 1.6, hits: [0.12, 0.32, 0.56, 0.79] }], 2.5, { launch: 6, up: 2, sound: "impactMetal" }),
    shieldThrow: SHIELD_THROW,
    rally: CAP_RALLY_MOVE,
    block: CAP_BLOCK_MOVE,
  },
  dodge: CAP_BLOCK_MOVE,
  entrance: CAP_ENTRANCE,
  lines: {
    intro: "I can do this all day.",
    hit: ["Keep your heads down!", "Not today."],
    down: ["I'm… still here."],
    up: ["On your feet, soldier. That's me.", "Back in it."],
    victory: ["Good work, everyone. Let's get them home."],
    fight: ["Hold the line!", "With me!", "Watch your flanks!"],
  },
  async setup(h) {
    // the shield is skinned to Bone_WP (off his left hand); the model has a second copy on
    // Bone_WP002 off the root that stands loose beside him — folded away to nothing
    const spare = h.rig.node("Bone_WP002");
    if (spare) {
      h.rig.unloose(spare);
      spare.scaling.setAll(0);
    }
    const b = h.rig.node("Bone_WP");
    if (b) {
      // (the disc lies in its bone's XZ, its face +Y: strapped to the outside of the left forearm)
      seat(h, b, "Left", { onForearm: true, out: 0.06 });
      (h as RosterHero & { _shield?: unknown })._shield = h.takeProp(b);
    }
  },
};

// ================================================================== CAPTAIN MARVEL
const GOLD = new Color3(1, 0.78, 0.35);
const GOLD2 = new Color3(1, 0.45, 0.1);
const MARVEL_HOVER = pose(
  {
    hips: [0, 1, 0], spine: [0, 1, 0.02], spine1: [0, 1, 0.02], spine2: [0, 1, 0], neck: [0, 1, 0.04], head: [0, 1, 0.06],
    lArm: [-0.38, -0.92, 0.08], lFore: [-0.28, -0.93, 0.22], lHand: [-0.25, -0.9, 0.3],
    lThigh: [-0.04, -1, 0.12], lShin: [0, -1, -0.18], lFoot: [0, -0.8, 0.55],
    rThigh: [0.05, -1, 0.04], rShin: [0, -1, -0.25], rFoot: [0, -0.8, 0.55],
  },
  [0, 1, 0],
);
/** flying fist-first (the body is tilted along the flight by the mover: "up" is forward) */
const MARVEL_RAM = pose(
  {
    hips: [0, 1, 0], spine: [0, 1, 0.02], spine1: [0, 1, 0.03], spine2: [0, 1, 0.03], neck: [0, 0.75, 0.66], head: [0, 0.5, 0.86],
    rArm: [0.12, 0.98, 0.1], rFore: [0.05, 1, 0.05], rHand: [0, 1, 0.08],
    lArm: [-0.12, 0.98, 0.1], lFore: [-0.05, 1, 0.05], lHand: [0, 1, 0.08],
    lThigh: [-0.04, -1, -0.03], lShin: [-0.02, -1, -0.06], lFoot: [0, -0.6, -0.8],
    rThigh: [0.04, -1, -0.03], rShin: [0.02, -1, -0.08], rFoot: [0, -0.6, -0.8],
  },
  [0, 1, 0],
);
const MARVEL_LAND = pose(
  {
    hips: [0, 1, 0.05], spine: [0, 1, 0.08], spine1: [0, 1, 0.08], spine2: [0, 1, 0.05], neck: [0, 1, 0.1], head: [0, 0.98, 0.18],
    lArm: [-0.55, -0.8, 0.1], lFore: [-0.4, -0.85, 0.3], lHand: [-0.3, -0.9, 0.3],
    rArm: [0.55, -0.8, 0.1], rFore: [0.4, -0.85, 0.3], rHand: [0.3, -0.9, 0.3],
    lThigh: [-0.15, -0.9, 0.4], lShin: [-0.05, -0.95, -0.3], rThigh: [0.15, -0.98, -0.05], rShin: [0.05, -0.97, -0.2],
  },
  [0, 0.88, 0],
);
/** fists glowing; Binary: the whole of her burning gold */
function marvelGlow(h: RosterHero, dt: number) {
  const binary = h.power > 1.4;
  const k = binary ? 3 : h.action ? 1.2 : 0.35;
  for (const s of ["l", "r"] as const) if (Math.random() < dt * 30 * k) h.host.glow.emit(h.hand(s), V(rnd(-0.3, 0.3), rnd(0, 0.6), rnd(-0.3, 0.3)), rnd(0.12, 0.25), rnd(0.12, 0.22), 1, GOLD, GOLD2, 0.8, 3, 0.5);
  if (binary && Math.random() < dt * 40) h.host.glow.emit(h.center().add(V(rnd(-0.4, 0.4), rnd(-0.8, 0.9), rnd(-0.4, 0.4))), V(rnd(-0.5, 0.5), rnd(0, 1.5), rnd(-0.5, 0.5)), 0.3, 0.4, 0.8, GOLD, GOLD2, 0.7, 2, 1);
  const bin = (h as { _binT?: number })._binT ?? 0;
  if (bin > 0 && ((h as { _binT?: number })._binT = bin - dt) <= 0) {
    h.power = 1;
    h.guard = 1;
  }
}
let marvelBeam: BeamFx | null = null;
const MARVEL_BEAM: Move = {
  airborne: true,
  vsAir: true,
  start(h, a) {
    if (!a.tgt) return false;
    marvelBeam ??= new BeamFx(h.host.scene, { name: "photon", core: new Color3(1, 0.97, 0.85), sheath: new Color3(1, 0.6, 0.15), width: 2.4, glow0: GOLD, glow1: GOLD2 });
    a.dur = 2.2;
    h.host.audio.play("unibeam", { x: h.p.x, y: h.p.y + 1, z: h.p.z, volume: 0.8, rate: 1.2 });
  },
  frame(h, a, dt) {
    const t = a.tgt!;
    if (!h.tgtAlive(t)) {
      marvelBeam?.off();
      return true;
    }
    const aim = h.aimOf(t);
    h.turnTo(Math.atan2(aim.x - h.p.x, aim.z - h.p.z), dt, 6);
    if (a.t < 0.45) return;
    const from = h.hand("r").add(h.hand("l")).scale(0.5);
    const blocked = h.host.nav.rayLevel(from, aim);
    const end = blocked >= 0 ? from.add(aim.subtract(from).normalize().scale(blocked)) : aim;
    marvelBeam!.set(0, from, end);
    marvelBeam!.update(dt);
    a.data.acc = ((a.data.acc as number) ?? 0) + dt;
    if ((a.data.acc as number) > 0.2 && blocked < 0) {
      a.data.acc = 0;
      h.hit(t, (h.book.def("charged")?.damage ?? 60) * 0.2, aim.subtract(from), { force: 2, kind: "blast" });
    }
    if (a.t > a.dur - 0.05) marvelBeam!.off();
  },
  pose(h, a, want) {
    copyPose(MARVEL_HOVER, want);
    if (a.tgt) {
      const at = h.aimOf(a.tgt);
      armAt(h, want, "r", at);
      armAt(h, want, "l", at);
    }
    return 20;
  },
  stop() {
    marvelBeam?.off();
  },
} as Move;
const MARVEL_BINARY: Move = {
  airborne: true,
  start(h, a) {
    a.dur = 1.6;
    h.say("Let's see what I can really do.", 2.4);
    h.host.audio.play("repulsorCharge", { x: h.p.x, y: h.p.y + 1, z: h.p.z, volume: 1, rate: 0.7 });
    h.host.rings.boom(h.center(), V(0, 1, 0), 10);
  },
  frame(h, a) {
    if (a.t > 1.2 && h.power < 1.4) {
      h.power = 1.6;
      h.guard = 0.5;
      (h as { _binT?: number })._binT = 14;
      h.host.audio.play("sonicBoom", { x: h.p.x, y: h.p.y + 1, z: h.p.z, volume: 0.7, rate: 1.2 });
    }
  },
  pose(_h, a, want) {
    copyPose(MARVEL_HOVER, want);
    // arms flung wide, head back
    want.d[P.lArm] = normD([-0.95, 0.25, 0.1]);
    want.d[P.rArm] = normD([0.95, 0.25, 0.1]);
    want.d[P.lFore] = normD([-0.95, 0.3, 0.1]);
    want.d[P.rFore] = normD([0.95, 0.3, 0.1]);
    want.d[P.head] = normD([0, 0.8, a.t > 0.6 ? -0.5 : 0.1]);
    return 10;
  },
};
const MARVEL_ENTRANCE: Entrance = {
  dur: 6,
  begin(h) {
    const at = spotNear(h, 9, 18);
    if (!at) return false;
    (h as { _land?: Vector3 })._land = at.add(V(0, 2.4, 0));
    h.p.copyFrom(at.add(V(0, 46, 0)));
    faceYou(h);
    h.pitch = 0;
    h.roll = 0;
    return true;
  },
  frame(h, t, dt) {
    // a star coming down: a slow descent in a column of light, then hovering
    const land = (h as { _land?: Vector3 })._land!;
    const f = Math.min(1, t / 3.4);
    const e = 1 - Math.pow(1 - f, 3);
    h.p.set(land.x, land.y + 44 * (1 - e), land.z);
    h.pitch = 0;
    // (a halo round her, not a sun in front of her: few sprites, out at her edges)
    if (Math.random() < 0.6) {
      const side = V(rnd(-1, 1), 0, rnd(-1, 1)).normalize().scale(0.45);
      h.host.glow.emit(h.center().add(side).addInPlaceFromFloats(0, rnd(-0.9, 0.9), 0), V(side.x, rnd(1, 2.5), side.z), rnd(0.25, 0.45), rnd(0.18, 0.32), 0.8, GOLD, GOLD2, 0.45, 1.5, 1);
    }
    if (t < 3.4 && Math.random() < 0.4) h.host.glow.emit(h.p.subtract(V(0, rnd(0, 8), 0)), V(0, 2, 0), 0.5, 0.5, 0, GOLD, GOLD2, 0.5, 0, 0);
    if (t > 3.4 && !(h as { _bang?: boolean })._bang) {
      (h as { _bang?: boolean })._bang = true;
      h.host.rings.boom(h.center(), V(0, 1, 0), 12);
      h.host.audio.play("sonicBoom", { x: h.p.x, y: h.p.y + 1, z: h.p.z, volume: 0.6, rate: 1.3 });
      h.host.dust(land.subtract(V(0, 2.4, 0)), 0.6);
    }
    if (t > 4) {
      const tr = trouble(h);
      if (tr) h.turnTo(Math.atan2(tr.x - h.p.x, tr.z - h.p.z), dt, 2);
    }
    if (t > this.dur - 0.05) (h as { _bang?: boolean })._bang = false;
  },
  pose(_h, t, want) {
    copyPose(t < 3.4 ? MARVEL_LAND : MARVEL_HOVER, want);
    return 6;
  },
  shot(h, t) {
    const land = (h as { _land?: Vector3 })._land ?? h.p;
    if (t < 3.4) return { pos: land.add(h.fwd().scale(10)).addInPlaceFromFloats(0, -1.6, 0), target: h.center(), fov: 0.85, cut: t < 0.03 };
    return orbit(h, 0.35 - (t - 3.4) * 0.1, 3.6, 0.5, 0.72, t < 3.43);
  },
};
export const MARVEL: Kit = {
  id: "marvel", color: "#e2b13c", label: "CM",
  flyer: true,
  run: 18, sprint: 30,
  prefer: ["binary", "ram", "charged", "blast"],
  holdRange: 9,
  stance: MARVEL_HOVER,
  idle: MARVEL_HOVER,
  landing: MARVEL_LAND,
  moves: {
    blast: shootMove("blast", { hands: "both", shots: 4, every: 0.18, speed: 70, core: new Color3(1, 0.95, 0.8), glow: GOLD, size: 1.6, sound: "repulsorFire", rate: 1.1, vsAir: true, airborne: true }),
    charged: MARVEL_BEAM,
    ram: dashMove("ram", {
      speed: 34, reach: 1.4, launch: 18, up: 6, fly: true, vsAir: true, sound: "sonicBoom",
      pose: (_h, _a, want) => copyPose(MARVEL_RAM, want),
      trail: (h, dir) => {
        for (let k = 0; k < 3; k++) h.host.glow.emit(h.center().subtract(dir.scale(rnd(0, 1.5))), V(rnd(-0.3, 0.3), rnd(-0.3, 0.3), rnd(-0.3, 0.3)), 0.35, 0.45, 0.6, GOLD, GOLD2, 0.8, 3, 0);
      },
    }),
    binary: MARVEL_BINARY,
  },
  entrance: MARVEL_ENTRANCE,
  lines: {
    intro: "Hey. Heard you needed a hand.",
    hit: ["That tickled.", "Cute."],
    down: ["Okay… that one hurt."],
    up: ["Higher, further, faster.", "Still burning."],
    victory: ["That's how it's done."],
    fight: ["Higher!", "Light 'em up!", "Coming in hot!"],
  },
  after: marvelGlow,
};

// ================================================================== STAR-LORD
const PURPLE = new Color3(0.75, 0.35, 1);
const SL_STANCE = pose(
  {
    hips: [0, 1, 0.05], spine: [0, 1, 0.1], spine1: [0, 1, 0.12], spine2: [0, 1, 0.08], neck: [0, 1, 0.1], head: [0, 0.98, 0.15],
    lArm: [-0.3, -0.85, 0.45], lFore: [-0.1, -0.35, 0.93], lHand: [-0.05, -0.25, 0.97],
    rArm: [0.3, -0.85, 0.45], rFore: [0.1, -0.35, 0.93], rHand: [0.05, -0.25, 0.97],
    lThigh: [-0.2, -0.95, 0.2], lShin: [-0.05, -0.95, -0.25], rThigh: [0.22, -0.96, -0.12], rShin: [0.05, -0.93, -0.33],
  },
  [0, 0.94, 0],
);
/** landing on his jet boots: low, a knee down, both blasters out to the sides */
const SL_LAND = pose(
  {
    hips: [0, 0.9, 0.35], spine: [0, 0.92, 0.36], spine1: [0, 0.95, 0.3], spine2: [0, 0.97, 0.24], neck: [0, 0.98, 0.15], head: [0, 0.98, 0.18],
    // (arms out low: this rig's shoulders don't follow an arm raised high)
    lArm: [-0.75, -0.6, 0.28], lFore: [-0.6, -0.25, 0.76], lHand: [-0.5, -0.2, 0.84],
    rArm: [0.75, -0.6, 0.28], rFore: [0.6, -0.25, 0.76], rHand: [0.5, -0.2, 0.84],
    lThigh: [-0.3, -0.4, 0.86], lShin: [-0.05, -1, -0.05], rThigh: [0.25, -0.85, -0.45], rShin: [0.05, -0.15, -0.98], rFoot: [0.05, -0.95, -0.3],
  },
  [0, 0.5, -0.05],
);
/** the jet boots: two flames under his feet */
function bootJets(h: RosterHero, k: number) {
  for (const s of ["LeftFoot", "RightFoot"]) {
    const f = h.rig.at(s);
    for (let i = 0; i < 2; i++) h.host.glow.emit(f.add(V(rnd(-0.05, 0.05), -0.05, rnd(-0.05, 0.05))), V(rnd(-0.5, 0.5), -rnd(4, 7) * k, rnd(-0.5, 0.5)), rnd(0.12, 0.22), rnd(0.15, 0.25), 1.2, new Color3(1, 0.9, 0.6), new Color3(1, 0.35, 0.05), 0.9, 2, 0);
  }
}
/** the jet-boot hop out of trouble: up and sideways, both guns still going */
const SL_JET: Move = {
  moves: true,
  start(h, a) {
    a.dur = 0.9;
    a.data.dir = (a.data.dir as Vector3 | undefined) ?? h.right().scale(Math.random() < 0.5 ? 1 : -1);
    h.host.audio.play("thrustLoop", { x: h.p.x, y: h.p.y, z: h.p.z, volume: 0.6, rate: 1.3 });
  },
  frame(h, a, dt) {
    const dir = (a.data.dir as Vector3) ?? h.right();
    const up = a.t < 0.45 ? 5 : -5;
    h.p.y = Math.max(h.host.nav.floorAt(h.p.x, h.p.y + 0.5, h.p.z, 3) ?? h.p.y, h.p.y + up * dt);
    const st = dir.scale(9 * dt);
    h.stepTo(h.p.x + st.x, h.p.z + st.z);
    bootJets(h, 1);
  },
  pose(_h, _a, want) {
    copyPose(SL_LAND, want);
    mixPose(want, SL_STANCE, 0.5, want);
    return 18;
  },
};
/** the gravity mine: a lobbed orb that pulls in and bursts */
const SL_MINE: Move = {
  start(_h, a) {
    if (!a.tgt) return false;
    a.dur = 1;
  },
  frame(h, a) {
    if (a.n === 0 && a.t > 0.35) {
      a.n = 1;
      const t = a.tgt!;
      const from = h.hand("l");
      const to = h.tgtGround(t).add(V(0, 0.4, 0));
      h.host.audio.play("rocketWhoosh", { x: from.x, y: from.y, z: from.z, volume: 0.5, rate: 1.4 });
      h.host.bolts.fire(from, to, 18, new Color3(0.9, 0.75, 1), PURPLE, 2.4, () => {
        // the pull, then the burst
        for (let k = 0; k < 14; k++) {
          const off = V(rnd(-3, 3), rnd(0, 2), rnd(-3, 3));
          h.host.glow.emit(to.add(off), off.scale(-3), 0.35, 0.4, 0.2, new Color3(0.9, 0.75, 1), PURPLE, 0.9, 0, 0);
        }
        h.host.rings.boom(to, V(0, 1, 0), 9);
        h.host.blast(to, h.book.def("grenade")?.radius ?? 4, h.book.def("grenade")?.damage ?? 35);
      });
    }
  },
  pose(h, a, want) {
    copyPose(SL_STANCE, want);
    if (a.tgt) armAt(h, want, "l", h.aimOf(a.tgt).add(V(0, 3, 0)));
    return 20;
  },
};
const SL_ENTRANCE: Entrance = {
  dur: 5.4,
  begin(h) {
    const at = spotNear(h, 8, 16);
    if (!at) return false;
    (h as { _land?: Vector3 })._land = at.clone();
    const away = flat(at.subtract(h.host.player.feet)).normalize();
    (h as { _from?: Vector3 })._from = at.add(away.scale(40)).addInPlaceFromFloats(rnd(-10, 10), 18, 0);
    h.p.copyFrom((h as { _from?: Vector3 })._from!);
    h.faceTo(at);
    return true;
  },
  frame(h, t, dt) {
    // in over the field on his boots, a skid of a landing, guns out — and a grin
    const land = (h as { _land?: Vector3 })._land!, from = (h as { _from?: Vector3 })._from!;
    const T = 2.2;
    if (t < T) {
      const f = t / T;
      const e = f * (2 - f);
      Vector3.LerpToRef(from, land, e, h.p);
      h.p.y += Math.sin(f * Math.PI) * 3;
      bootJets(h, 1.3);
      if (Math.random() < dt * 4) h.host.audio.play("thrustLoop", { x: h.p.x, y: h.p.y, z: h.p.z, volume: 0.5, rate: 1.2 });
    } else if (h.p.y > land.y + 0.01 || t < T + dt * 1.5) {
      h.p.copyFrom(land);
      h.host.dust(land.clone(), 0.5);
      h.host.audio.play("land", { x: land.x, y: land.y, z: land.z, volume: 0.8 });
      faceYou(h);
    }
    if (t > 3.8) {
      const tr = trouble(h);
      if (tr) h.turnTo(Math.atan2(tr.x - h.p.x, tr.z - h.p.z), dt, 3);
    }
  },
  pose(_h, t, want) {
    if (t < 2.2) copyPose(TUCK, want);
    else if (t < 3.6) copyPose(SL_LAND, want);
    else mixPose(SL_LAND, SL_STANCE, Math.min(1, (t - 3.6) / 0.6), want);
    return t < 2.25 ? 30 : 10;
  },
  shot(h, t) {
    const land = (h as { _land?: Vector3 })._land ?? h.p;
    if (t < 2.2) return { pos: land.add(V(0, 1.3, 0)).add(flat(h.host.player.feet.subtract(land)).normalize().scale(4)), target: h.center(), fov: 0.85, cut: t < 0.03 };
    return orbit(h, 0.5, 3.2, 0.6, 0.74, t < 2.23);
  },
};
export const STARLORD: Kit = {
  id: "starlord", color: "#b0402a", label: "SL",
  run: 7, sprint: 9.5,
  prefer: ["grenade", "blasters"],
  holdRange: 12,
  stance: SL_STANCE,
  landing: SL_LAND,
  moves: {
    blasters: shootMove("blasters", {
      hands: "both", shots: 6, every: 0.14, speed: 75, core: new Color3(1, 0.85, 0.95), glow: PURPLE, size: 1.1, sound: "repulsorFire", rate: 1.6, vsAir: true,
      muzzle: (h, s) => {
        const i = s === "l" ? 0 : 1;
        const g = (h as { _guns?: TransformNode[] })._guns?.[i];
        const mz = (h as { _muzzles?: { dir: Vector3; len: number }[] })._muzzles?.[i];
        if (!g || !mz) return h.hand(s);
        g.computeWorldMatrix(true);
        // (mz.dir is the muzzle point in the gun's own space)
        return Vector3.TransformCoordinates(mz.dir, g.getWorldMatrix());
      },
    }),
    grenade: SL_MINE,
    jet: SL_JET,
  },
  dodge: SL_JET,
  entrance: SL_ENTRANCE,
  lines: {
    intro: "Okay, who ordered the legendary outlaw?",
    hit: ["Ow! Rude!", "Not the face!"],
    down: ["Somebody… play my song…"],
    up: ["Legendary outlaw's back, baby.", "Did I miss anything?"],
    victory: ["Dance-off, anyone? No? Fine."],
    fight: ["Let's go, let's go!", "Pew pew!", "You're gonna regret that."],
  },
  async setup(h) {
    // his element guns hang off the Rigify FK hand controls (which nothing moves here):
    // re-hung on the deform hands, where they stay where they were modelled
    const guns: TransformNode[] = [];
    const muzzles: { dir: Vector3; len: number }[] = [];
    for (const [nm, side] of [["handle for gun", "Left"], ["handle for gun.001", "Right"]] as const) {
      const g = h.rig.node(nm) ?? (h.host.scene.getTransformNodeByName(nm + "#ros_starlord") as TransformNode | null) ?? undefined;
      const b = h.rig.bone(side + "Hand"), fore = h.rig.bone(side + "ForeArm");
      if (!g || !b || !fore) continue;
      g.setParent(b);
      // the barrel: the gun's long axis (in its own space), the muzzle the end away from the fist
      g.computeWorldMatrix(true);
      const W = g.getWorldMatrix().clone();
      const inv = W.clone().invert();
      let lo = V(Infinity, Infinity, Infinity), hi = V(-Infinity, -Infinity, -Infinity);
      for (const m of g.getChildMeshes(false)) {
        m.computeWorldMatrix(true);
        for (const c of m.getBoundingInfo().boundingBox.vectorsWorld) {
          const l = Vector3.TransformCoordinates(c, inv);
          lo = Vector3.Minimize(lo, l);
          hi = Vector3.Maximize(hi, l);
        }
      }
      if (!isFinite(lo.x)) continue;
      const size = hi.subtract(lo);
      const ax = size.x >= size.y && size.x >= size.z ? 0 : size.y >= size.z ? 1 : 2;
      const hp = b.getAbsolutePosition();
      const handL = Vector3.TransformCoordinates(hp, inv);
      const c = lo.add(hi).scale(0.5);
      const comp = (v: Vector3) => (ax === 0 ? v.x : ax === 1 ? v.y : v.z);
      const set = (v: Vector3, x: number) => (ax === 0 ? (v.x = x) : ax === 1 ? (v.y = x) : (v.z = x));
      // (the muzzle: in the model's rest pose both guns point forward, +Z, the way he faces)
      const axisW = Vector3.TransformNormal(V(ax === 0 ? 1 : 0, ax === 1 ? 1 : 0, ax === 2 ? 1 : 0), W);
      const far = axisW.z >= 0 ? comp(hi) : comp(lo);
      void handL;
      const near = far === comp(hi) ? comp(lo) : comp(hi);
      const muzzleL = c.clone(), buttL = c.clone();
      set(muzzleL, far);
      set(buttL, near);
      const barrel = Vector3.TransformCoordinates(muzzleL, W).subtract(Vector3.TransformCoordinates(buttL, W)).normalize();
      // turned (about the fist) so the barrel runs along the forearm, out of the fist
      const want = hp.subtract(fore.getAbsolutePosition()).normalize();
      const axis = Vector3.Cross(barrel, want);
      const ang = Math.acos(Math.max(-1, Math.min(1, Vector3.Dot(barrel, want))));
      const turn = axis.lengthSquared() > 1e-8 ? Quaternion.RotationAxis(axis.normalize(), ang) : Quaternion.Identity();
      const q0 = new Quaternion();
      const pos = V();
      W.decompose(undefined, q0, pos);
      const pos2 = hp.add(pos.subtract(hp).applyRotationQuaternion(turn));
      h.takeProp(g).place(pos2, turn.multiply(q0));
      muzzles.push({ dir: muzzleL, len: 0 });
      mergeByMaterial(g, h.rig.meshes as Mesh[]);
      guns.push(g);
    }
    (h as { _guns?: TransformNode[]; _muzzles?: { dir: Vector3; len: number }[] })._guns = guns;
    (h as { _muzzles?: { dir: Vector3; len: number }[] })._muzzles = muzzles;
  },
};

// ================================================================== DRAX
const DRAX_STANCE = pose(
  {
    hips: [0, 0.98, 0.15], spine: [0, 0.95, 0.3], spine1: [0, 0.95, 0.3], spine2: [0, 0.97, 0.22], neck: [0, 0.95, 0.3], head: [0, 0.97, 0.25],
    lArm: [-0.62, -0.7, 0.35], lFore: [-0.25, -0.35, 0.9], lHand: [-0.2, -0.3, 0.93],
    rArm: [0.62, -0.7, 0.35], rFore: [0.25, -0.35, 0.9], rHand: [0.2, -0.3, 0.93],
    lThigh: [-0.32, -0.92, 0.2], lShin: [-0.05, -0.95, -0.25], rThigh: [0.34, -0.93, -0.1], rShin: [0.05, -0.93, -0.33],
  },
  [0, 0.88, 0],
);
/** the roar: arms flung wide, chest out, head back */
const DRAX_ROAR = pose(
  {
    hips: [0, 1, -0.05], spine: [0, 1, -0.15], spine1: [0, 1, -0.2], spine2: [0, 1, -0.15], neck: [0, 0.95, -0.3], head: [0, 0.8, -0.6],
    lArm: [-0.92, 0.35, 0.1], lFore: [-0.7, 0.7, 0.1], lHand: [-0.6, 0.8, 0.1],
    rArm: [0.92, 0.35, 0.1], rFore: [0.7, 0.7, 0.1], rHand: [0.6, 0.8, 0.1],
    lThigh: [-0.3, -0.95, 0.05], rThigh: [0.3, -0.95, 0.05],
  },
  [0, 0.96, 0],
);
/** the charge: head down, shoulder first */
const DRAX_CHARGE = pose(
  {
    hips: [0, 0.9, 0.42], spine: [0.15, 0.75, 0.65], spine1: [0.2, 0.7, 0.68], spine2: [0.2, 0.72, 0.66], neck: [0, 0.6, 0.8], head: [0, 0.5, 0.87],
    lArm: [-0.4, -0.6, 0.7], lFore: [0.3, 0.2, 0.93],
    rArm: [0.55, -0.75, -0.35], rFore: [0.3, -0.6, 0.74],
    lThigh: [-0.2, -0.7, 0.68], lShin: [-0.05, -0.95, -0.3], rThigh: [0.22, -0.9, -0.38], rShin: [0.05, -0.6, -0.8],
  },
  [0, 0.82, 0.1],
);
/** his landing: both feet at once, a deep squat, the fists to the ground */
const DRAX_LAND = pose(
  {
    hips: [0, 0.7, 0.7], spine: [0, 0.65, 0.76], spine1: [0, 0.7, 0.71], spine2: [0, 0.78, 0.62], neck: [0, 0.9, 0.42], head: [0, 0.97, 0.22],
    lArm: [-0.35, -0.9, 0.25], lFore: [-0.1, -1, 0.05], lHand: [0, -1, 0.1],
    rArm: [0.35, -0.9, 0.25], rFore: [0.1, -1, 0.05], rHand: [0, -1, 0.1],
    lThigh: [-0.4, -0.3, 0.86], lShin: [-0.08, -1, -0.05], lFoot: [-0.15, -0.35, 0.92],
  },
  [0, 0.45, -0.05],
);
const DRAX_ENTRANCE: Entrance = {
  dur: 6.4,
  begin(h) {
    const at = spotNear(h, 9, 16, false);
    if (!at) return false;
    (h as { _land?: Vector3 })._land = at.clone();
    const away = flat(at.subtract(h.host.player.feet)).normalize();
    (h as { _from?: Vector3 })._from = at.add(away.scale(7));
    h.p.copyFrom((h as { _from?: Vector3 })._from!);
    h.faceTo(at);
    return true;
  },
  frame(h, t, dt) {
    // out of a wall of smoke, walking, slow; a stop; the roar that shakes you
    const land = (h as { _land?: Vector3 })._land!, from = (h as { _from?: Vector3 })._from!;
    if (t < 0.15) for (let k = 0; k < 30; k++) h.host.smoke.emit(from.add(V(rnd(-4, 4), rnd(0, 2.6), rnd(-2, 2))), V(rnd(-0.6, 0.6), rnd(0.1, 0.5), rnd(-0.6, 0.6)), rnd(4, 6), rnd(1.6, 2.6), 0.4, new Color3(0.55, 0.55, 0.58), new Color3(0.75, 0.76, 0.8), 0.7, 0.4, 0.15);
    if (t < 3.4) {
      Vector3.LerpToRef(from, land, Math.min(1, t / 3.4), h.p);
      h.v.copyFrom(land.subtract(from).scale(1 / 3.4));
    } else h.v.setAll(0);
    if (t > 3.9 && !(h as { _roar?: boolean })._roar) {
      (h as { _roar?: boolean })._roar = true;
      h.host.audio.play("hulkRoar", { x: h.p.x, y: h.p.y + 2, z: h.p.z, volume: 0.6, rate: 1.35 });
      h.host.player.shake(0.25);
      h.say("I have come to destroy your enemies.", 2.8);
    }
    if (t > 5.4) {
      const tr = trouble(h);
      if (tr) h.turnTo(Math.atan2(tr.x - h.p.x, tr.z - h.p.z), dt, 3);
    }
    if (t > this.dur - 0.05) (h as { _roar?: boolean })._roar = false;
  },
  pose(h, t, want, dt) {
    if (t < 3.4) {
      const c = h.clips.walk;
      (h as { _ph?: number })._ph = ((h as { _ph?: number })._ph ?? 0) + dt * (2.1 / 1.25);
      sample(c, (h as { _ph?: number })._ph!, true, want);
      // (the walk is a soldier's, rifle in his arms: Drax's swing loose and heavy)
      naturalArms(want, 0.15, 0.04);
      want.d[P.lArm] = normD([want.d[P.lArm][0] - 0.25, want.d[P.lArm][1], want.d[P.lArm][2]]);
      want.d[P.rArm] = normD([want.d[P.rArm][0] + 0.25, want.d[P.rArm][1], want.d[P.rArm][2]]);
      return 30;
    }
    copyPose(t < 5.3 ? DRAX_ROAR : DRAX_STANCE, want);
    return 9;
  },
  shot(h, t) {
    const land = (h as { _land?: Vector3 })._land ?? h.p;
    const toYou = flat(h.host.player.feet.subtract(land)).normalize();
    if (t < 3.4) return { pos: land.add(toYou.scale(2.2)).addInPlaceFromFloats(0, 0.4, 0), target: h.center().add(V(0, 0.3, 0)), fov: 0.8, cut: t < 0.03 };
    return orbit(h, 0.4, 2.8, 0.2, 0.75, t < 3.43, 1.2);
  },
};
export const DRAX: Kit = {
  id: "drax", color: "#4f8a5a", label: "DX",
  run: 6.5, sprint: 9,
  prefer: ["finisher", "charge", "slash"],
  holdRange: 1.8,
  stance: DRAX_STANCE,
  landing: DRAX_LAND,
  moves: {
    slash: comboMove("slash", [{ clip: "elbowCombo", speed: 1.6, hits: [0.119, 0.371, 0.503, 0.589, 0.861] }, { clip: "combo", speed: 1.5, hits: [0.12, 0.32, 0.56, 0.72, 0.79] }, { clip: "hook", speed: 1.3, hits: [0.29] }], 2.4, { launch: 7, up: 2.5 }),
    charge: dashMove("charge", {
      speed: 13, reach: 1.5, launch: 13, up: 4,
      pose: (_h, a, want) => copyPose(a.t < 0.18 ? DRAX_STANCE : DRAX_CHARGE, want),
      trail: (h) => {
        if (Math.random() < 0.3) h.host.dust(h.p.clone(), 0.08);
      },
    }),
    finisher: comboMove("finisher", [{ clip: "smash", speed: 1.05, hits: [0.41] }], 2.6, {
      launch: 15, up: 6, force: 3, sound: "superPunch",
      after: (h, _a, last) => {
        if (!last) return;
        const at = h.p.add(h.fwd().scale(1.4));
        h.host.slam(at, 0.6);
        h.host.player.shake(0.2);
      },
    }),
  },
  entrance: DRAX_ENTRANCE,
  lines: {
    intro: "I have come to destroy your enemies.",
    hit: ["Your blow was adequate.", "I did not feel that."],
    down: ["I am… resting my eyes."],
    up: ["I have risen! As I always do.", "Again I stand."],
    victory: ["Our enemies are destroyed. I am content."],
    fight: ["Die, cowards!", "I will tear you in half!", "Nothing goes over my head!"],
  },
};

// ================================================================== ROCKET
const ROCKET_STANCE = pose(
  {
    hips: [0, 1, 0.08], spine: [0, 1, 0.15], spine1: [0, 1, 0.15], spine2: [0, 1, 0.1], neck: [0, 1, 0.1], head: [0, 0.98, 0.15],
    // the big gun two-handed at the hip
    rArm: [0.35, -0.85, 0.38], rFore: [-0.15, -0.25, 0.96], rHand: [-0.1, -0.2, 0.97],
    lArm: [-0.4, -0.7, 0.6], lFore: [0.45, -0.05, 0.89], lHand: [0.4, 0, 0.92],
    lThigh: [-0.25, -0.92, 0.25], lShin: [-0.05, -0.95, -0.25], rThigh: [0.26, -0.95, -0.12], rShin: [0.05, -0.93, -0.33],
  },
  [0, 0.92, 0],
);
/** running in on all fours */
const ROCKET_FOURS = pose(
  {
    hips: [0, 0.4, 0.92], spine: [0, 0.15, 0.99], spine1: [0, 0.1, 0.99], spine2: [0, 0.15, 0.99], neck: [0, 0.5, 0.87], head: [0, 0.75, 0.66],
    lArm: [-0.2, -0.95, 0.2], lFore: [-0.05, -1, 0.05], rArm: [0.2, -0.95, -0.15], rFore: [0.05, -1, 0.05],
    lThigh: [-0.15, -0.7, 0.7], lShin: [-0.05, -0.95, -0.3], rThigh: [0.15, -0.95, -0.3], rShin: [0.05, -0.7, -0.7],
  },
  [0, 0.65, 0],
);
/** his landing: on all fours, tail up, then straight up with the gun */
const ROCKET_LAND = pose(
  {
    hips: [0, 0.55, 0.83], spine: [0, 0.4, 0.92], spine1: [0, 0.4, 0.92], spine2: [0, 0.5, 0.87], neck: [0, 0.8, 0.6], head: [0, 0.95, 0.3],
    lArm: [-0.3, -0.95, 0.1], lFore: [-0.05, -1, 0.05], rArm: [0.3, -0.95, 0.1], rFore: [0.05, -1, 0.05],
    lThigh: [-0.3, -0.3, 0.9], lShin: [-0.05, -1, -0.05], rThigh: [0.3, -0.3, 0.9], rShin: [0.05, -1, -0.05],
  },
  [0, 0.42, 0],
);
function rocketGun(h: RosterHero) {
  return (h as { _gun?: { node: TransformNode; len: number } })._gun;
}
/** the big gun: in both hands, along the forearms — along the aim when he fires */
function placeRocketGun(h: RosterHero) {
  const g = rocketGun(h);
  if (!g) return;
  g.node.setEnabled(h.enabled);
  const hr = h.hand("r"), hl = h.hand("l");
  const grip = hr.add(hl.subtract(hr).scale(0.3));
  const a = h.action;
  const aiming = !!a && !!a.tgt && (a.id === "rifle" || a.id === "rocket");
  const aimP = a?.tgt ? h.aimOf(a.tgt) : null;
  const barrel = aiming && aimP ? aimP.subtract(grip).normalize() : hl.subtract(h.rig.at("RightForeArm")).normalize().add(h.fwd()).normalize();
  g.node.position.copyFrom(grip);
  lookRotation(barrel, V(0, 1, 0), g.node.rotationQuaternion!);
}
const ROCKET_ENTRANCE: Entrance = {
  dur: 5,
  begin(h) {
    const at = spotNear(h, 7, 14, false);
    if (!at) return false;
    (h as { _land?: Vector3 })._land = at.clone();
    const away = flat(at.subtract(h.host.player.feet)).normalize();
    const side = V(away.z, 0, -away.x);
    (h as { _from?: Vector3 })._from = at.add(away.scale(14)).addInPlace(side.scale(8));
    h.p.copyFrom((h as { _from?: Vector3 })._from!);
    h.faceTo(at);
    return true;
  },
  frame(h, t, dt) {
    // tearing in on all fours, a leap, a roll of a landing, the gun up and racked
    const land = (h as { _land?: Vector3 })._land!, from = (h as { _from?: Vector3 })._from!;
    if (t < 1.8) {
      Vector3.LerpToRef(from, land, t / 1.8, h.p);
      if (t > 1.3) h.p.y = land.y + Math.sin(((t - 1.3) / 0.5) * Math.PI) * 1.3;
      h.v.copyFrom(land.subtract(from).scale(1 / 1.8));
      if (Math.random() < 0.3) h.host.dust(h.p.clone(), 0.05);
    } else {
      h.v.setAll(0);
      h.p.copyFrom(land);
    }
    if (t > 2.6 && !(h as { _rack?: boolean })._rack) {
      (h as { _rack?: boolean })._rack = true;
      h.host.audio.play("rocketLoad", { x: h.p.x, y: h.p.y + 1, z: h.p.z, volume: 0.8 });
      h.say("Alright, who wants to get blown up?", 2.6);
    }
    if (t > 3) {
      const tr = trouble(h);
      if (tr) h.turnTo(Math.atan2(tr.x - h.p.x, tr.z - h.p.z), dt, 3);
    } else if (t > 1.8) faceYou(h);
    if (t > this.dur - 0.05) (h as { _rack?: boolean })._rack = false;
  },
  pose(h, t, want, dt) {
    if (t < 1.3) {
      (h as { _ph?: number })._ph = ((h as { _ph?: number })._ph ?? 0) + dt * 3.2;
      copyPose(ROCKET_FOURS, want);
      // (a bounding gallop)
      const s = Math.sin(((h as { _ph?: number })._ph ?? 0) * 6);
      want.d[P.lArm] = normD([-0.2, -0.95, 0.2 + s * 0.6]);
      want.d[P.rArm] = normD([0.2, -0.95, 0.2 + s * 0.6]);
      want.d[P.lThigh] = normD([-0.15, -0.8, 0.2 - s * 0.7]);
      want.d[P.rThigh] = normD([0.15, -0.8, 0.2 - s * 0.7]);
      return 40;
    }
    if (t < 1.8) copyPose(TUCK, want);
    else if (t < 2.5) copyPose(ROCKET_LAND, want);
    else copyPose(ROCKET_STANCE, want);
    return t < 1.85 ? 30 : 12;
  },
  shot(h, t) {
    const land = (h as { _land?: Vector3 })._land ?? h.p;
    if (t < 1.8) return { pos: land.add(flat(h.host.player.feet.subtract(land)).normalize().scale(3)).addInPlaceFromFloats(0, 0.4, 0), target: h.p.add(V(0, 0.5, 0)), fov: 0.85, cut: t < 0.03 };
    return orbit(h, 0.45, 2.2, 0.1, 0.72, t < 1.83, 0.9);
  },
};
export const ROCKET: Kit = {
  id: "rocket", color: "#c07a32", label: "RR",
  run: 7, sprint: 9.5,
  prefer: ["bombs", "rocket", "rifle"],
  holdRange: 13,
  stance: ROCKET_STANCE,
  landing: ROCKET_LAND,
  moves: {
    rifle: shootMove("rifle", {
      hands: "r", shots: 7, every: 0.09, speed: 90, core: new Color3(1, 0.95, 0.75), glow: new Color3(1, 0.5, 0.15), size: 0.8, sound: "repulsorFire", rate: 2, vsAir: true,
      muzzle: (h) => {
        const g = rocketGun(h);
        if (!g) return h.hand("r");
        g.node.computeWorldMatrix(true);
        return Vector3.TransformCoordinates(V(0, 0.05, g.len), g.node.getWorldMatrix());
      },
    }),
    rocket: shootMove("rocket", {
      hands: "r", shots: 1, every: 0.2, speed: 38, core: new Color3(1, 0.85, 0.5), glow: new Color3(1, 0.35, 0.05), size: 2.2, sound: "m72Launch", rate: 1.1, splash: 4, vsAir: true,
      muzzle: (h) => {
        const g = rocketGun(h);
        if (!g) return h.hand("r");
        g.node.computeWorldMatrix(true);
        return Vector3.TransformCoordinates(V(0, 0.05, g.len), g.node.getWorldMatrix());
      },
    }),
    bombs: {
      start(h, a) {
        if (!a.tgt) return false;
        a.dur = 1.1;
        h.say(pick(["Catch!", "Fire in the hole!"]), 1.4);
      },
      frame(h, a) {
        while (a.n < 3 && a.t > 0.35 + a.n * 0.15) {
          a.n++;
          const t = a.tgt!;
          const from = h.hand("l");
          const to = h.tgtGround(t).add(V(rnd(-2.2, 2.2), 0.2, rnd(-2.2, 2.2)));
          h.host.bolts.fire(from, to, 16, new Color3(0.4, 0.4, 0.45), new Color3(1, 0.4, 0.1), 1.6, () => {
            h.host.blast(to, h.book.def("bombs")?.radius ?? 3.5, h.book.def("bombs")?.damage ?? 30);
          });
        }
      },
      pose(h, a, want) {
        copyPose(ROCKET_STANCE, want);
        if (a.tgt) armAt(h, want, "l", h.aimOf(a.tgt).add(V(0, 4, 0)));
        return 20;
      },
    },
  },
  entrance: ROCKET_ENTRANCE,
  lines: {
    intro: "Alright, who wants to get blown up?",
    hit: ["Hey! Watch the fur!", "Ow! You'll pay for that!"],
    down: ["Ugh… somebody get the number of that truck…"],
    up: ["I'm up! And I'm angry!", "That all you got?"],
    victory: ["Ha! Who's the trash panda now?"],
    fight: ["Blow 'em up!", "Ka-boom!", "Get some!"],
  },
  setup(h) {
    // he has no gun of his own in the model: Deadpool's sci-fi blaster, scaled up to a cannon
    const tpl = (h.host as { gunTpl?: { mesh: Mesh; len: number } }).gunTpl;
    if (!tpl) return;
    const node = new TransformNode("rocketGun", h.host.scene);
    node.rotationQuaternion = new Quaternion();
    const m = tpl.mesh.clone("rocketGunMesh", node)!;
    m.setEnabled(true);
    m.isPickable = false;
    node.scaling.setAll(1.4);
    node.setEnabled(false);
    (h as { _gun?: { node: TransformNode; len: number } })._gun = { node, len: tpl.len };
  },
  after(h) {
    placeRocketGun(h);
  },
};

// ================================================================== THE FLASH
const FLASH_STANCE = pose(
  {
    hips: [0, 1, 0.1], spine: [0, 1, 0.15], spine1: [0, 1, 0.15], spine2: [0, 1, 0.1], neck: [0, 1, 0.1], head: [0, 0.98, 0.15],
    lArm: [-0.35, -0.75, 0.55], lFore: [0.15, 0.45, 0.88], lHand: [0.1, 0.25, 0.96],
    rArm: [0.4, -0.85, 0.35], rFore: [-0.1, 0.4, 0.9], rHand: [-0.08, 0.2, 0.97],
    lThigh: [-0.18, -0.9, 0.38], lShin: [-0.05, -0.95, -0.3], lFoot: [-0.1, -0.6, 0.8], rThigh: [0.2, -0.95, -0.2], rShin: [0.05, -0.85, -0.5], rFoot: [0.1, -0.7, 0.7],
  },
  [0, 0.9, 0],
);
/** the skid stop: a long lunge, leaning back against his own speed, a hand trailing on the ground */
const FLASH_SKID = pose(
  {
    hips: [0, 0.9, -0.35], spine: [0, 0.95, -0.25], spine1: [0, 0.97, -0.15], spine2: [0, 0.98, -0.05], neck: [0, 1, 0.15], head: [0, 0.97, 0.25],
    lArm: [-0.55, -0.82, -0.15], lFore: [-0.3, -0.95, 0.1], lHand: [-0.2, -0.97, 0.1],
    rArm: [0.6, -0.3, 0.75], rFore: [0.2, 0.3, 0.93],
    lThigh: [-0.2, -0.3, 0.93], lShin: [-0.05, -0.6, 0.8], lFoot: [-0.05, 0.3, 0.95],
    rThigh: [0.22, -0.9, -0.38], rShin: [0.05, -0.2, -0.98], rFoot: [0.05, -0.9, -0.4],
  },
  [0, 0.55, -0.15],
);
/** the lightning throw: wound back like a javelin */
const FLASH_THROW = pose(
  {
    hips: [0, 1, 0], spine: [0.1, 1, -0.1], spine1: [0.12, 1, -0.12], spine2: [0.12, 1, -0.1], neck: [0, 1, 0.05], head: [0, 1, 0.15],
    rArm: [0.5, 0.6, -0.62], rFore: [0.15, 0.97, -0.2],
    lArm: [-0.5, -0.1, 0.86], lFore: [-0.2, 0.25, 0.95],
    lThigh: [-0.2, -0.88, 0.42], rThigh: [0.24, -0.96, -0.2],
  },
  [0, 0.93, 0],
);
const BOLT_Y = new Color3(1, 0.85, 0.25);
/** the flurry: a blur of fists, far more blows than the clip has (the clip runs at triple speed) */
const FLASH_FLURRY: Move = {
  start(_h, a) {
    if (!a.tgt) return false;
    a.dur = 1.6;
  },
  frame(h, a, dt) {
    const t = a.tgt!;
    if (!h.tgtAlive(t)) return true;
    const at = h.tgtGround(t);
    const d = Vector3.Distance(flat(h.p), flat(at));
    if (d > 1.4) {
      const st = flat(at.subtract(h.p)).normalize().scale(Math.min(d - 1.1, 20 * dt));
      h.stepTo(h.p.x + st.x, h.p.z + st.z);
    }
    h.faceTo(at);
    // (and round him: a different side every few blows)
    while (a.n < 14 && a.t > 0.08 + a.n * 0.1) {
      a.n++;
      const aim = h.aimOf(t);
      h.hit(t, h.book.def("flurry")?.damage ?? 6, aim.subtract(h.center()), { force: a.n === 14 ? 3 : 1, launch: a.n === 14 ? 10 : undefined, up: 3 });
      h.host.audio.play("meleeHit", { x: aim.x, y: aim.y, z: aim.z, volume: 0.5, rate: 1.4 });
      if (a.n % 4 === 0) {
        const side = rnd(-1.4, 1.4);
        const dir = flat(h.p.subtract(at)).normalize();
        const r = V(Math.cos(side) * dir.x - Math.sin(side) * dir.z, 0, Math.sin(side) * dir.x + Math.cos(side) * dir.z).scale(1.2);
        h.blur(r.scale(-1), 30);
        h.stepTo(at.x + r.x, at.z + r.z);
      }
    }
  },
  pose(h, a, want) {
    sample(h.clips.combo, (a.t * 3) % clipDur(h.clips.combo), false, want);
    return 50;
  },
};
const FLASH_THROW_MOVE: Move = {
  vsAir: true,
  start(_h, a) {
    if (!a.tgt) return false;
    a.dur = 1.1;
  },
  frame(h, a) {
    const hand = h.hand("r");
    if (a.t < 0.45 && Math.random() < 0.6) h.host.lightning.strike(hand, hand.add(V(rnd(-0.5, 0.5), rnd(-0.5, 0.5), rnd(-0.5, 0.5))), BOLT_Y, 0.06, 0.25, 0.2, 0);
    if (a.n === 0 && a.t > 0.5) {
      a.n = 1;
      const t = a.tgt!;
      if (!h.tgtAlive(t)) return true;
      const aim = h.aimOf(t);
      h.host.lightning.strike(hand, aim, BOLT_Y, 0.3, 1.1, 1.2, 2);
      h.host.audio.play("hulkClap", { x: aim.x, y: aim.y, z: aim.z, volume: 0.6, rate: 1.9 });
      h.hit(t, h.book.def("bolt")?.damage ?? 35, aim.subtract(hand), { force: 3, launch: 9, up: 4, kind: "blast" });
    }
  },
  pose(_h, a, want) {
    copyPose(a.t < 0.5 ? FLASH_THROW : HIT, want);
    if (a.t >= 0.5) {
      want.d[P.rArm] = normD([0.1, 0.1, 1]);
      want.d[P.rFore] = normD([0.05, 0.05, 1]);
    }
    return a.t < 0.5 ? 14 : 30;
  },
};
/** gone in a blink: out of the way and back */
const FLASH_DODGE: Move = {
  moves: true,
  start(_h, a) {
    a.dur = 0.3;
  },
  frame(h, a, dt) {
    const dir = (a.data.dir as Vector3 | undefined) ?? h.right();
    const st = dir.scale(30 * dt);
    const n = Math.ceil(st.length() / 0.5);
    for (let i = 0; i < n; i++) h.stepTo(h.p.x + st.x / n, h.p.z + st.z / n);
    h.blur(dir, 30);
  },
  pose(_h, _a, want) {
    copyPose(FLASH_STANCE, want);
    return 30;
  },
};
const FLASH_ENTRANCE: Entrance = {
  dur: 4.6,
  begin(h) {
    const at = spotNear(h, 4, 8, false);
    if (!at) return false;
    (h as { _land?: Vector3 })._land = at.clone();
    h.p.copyFrom(at.add(V(0, 0, 0)));
    faceYou(h);
    return true;
  },
  frame(h, t, dt) {
    // a streak of lightning round the field — round you — and he's just there, skidding to a stop
    const land = (h as { _land?: Vector3 })._land!;
    const me = h.host.player.feet;
    if (t < 1.8) {
      const a = t * 7;
      const r = 14 - t * 5;
      const p = me.add(V(Math.sin(a) * r, 0, Math.cos(a) * r));
      const fy = h.host.nav.floorAt(p.x, me.y + 2, p.z, 6) ?? me.y;
      const prev = h.p.clone();
      h.p.set(p.x, fy, p.z);
      const dir = h.p.subtract(prev);
      if (dir.lengthSquared() > 1e-4) {
        h.yaw = Math.atan2(dir.x, dir.z);
        h.blur(dir.normalize(), 40);
        h.host.lightning.strike(prev.add(V(0, 1, 0)), h.p.add(V(0, 1, 0)), BOLT_Y, 0.25, 0.5, 0.4, 0);
      }
      if (Math.random() < dt * 6) h.host.audio.play("swingWhoosh", { x: h.p.x, y: h.p.y + 1, z: h.p.z, volume: 0.6, rate: 1.4 });
    } else if (t < 2.4) {
      // the skid: in to the landing spot, digging a furrow
      const f = (t - 1.8) / 0.6;
      const from = (h as { _skid?: Vector3 })._skid ?? ((h as { _skid?: Vector3 })._skid = h.p.clone());
      Vector3.LerpToRef(from, land, 1 - Math.pow(1 - f, 2), h.p);
      if (Math.random() < 0.7) h.host.dust(h.p.clone(), 0.12);
      h.yaw = Math.atan2(land.x - from.x, land.z - from.z);
    } else {
      h.p.copyFrom(land);
      (h as { _skid?: Vector3 })._skid = undefined;
      if (t < 3.6) faceYou(h);
    }
    if (t > 2.6 && !(h as { _said?: boolean })._said) {
      (h as { _said?: boolean })._said = true;
      h.say("Sorry I'm late. Ironic, right?", 2.6);
    }
    if (t > 3.6) {
      const tr = trouble(h);
      if (tr) h.turnTo(Math.atan2(tr.x - h.p.x, tr.z - h.p.z), dt, 4);
    }
    if (t > this.dur - 0.05) (h as { _said?: boolean })._said = false;
  },
  pose(h, t, want, dt) {
    if (t < 1.8) {
      (h as { _ph?: number })._ph = ((h as { _ph?: number })._ph ?? 0) + dt * 2.6;
      sample(h.clips.sprint, (h as { _ph?: number })._ph!, true, want);
      naturalArms(want, 1, 0.3);
      return 50;
    }
    if (t < 3.2) copyPose(FLASH_SKID, want);
    else mixPose(FLASH_SKID, FLASH_STANCE, Math.min(1, (t - 3.2) / 0.5), want);
    return t < 1.85 ? 50 : 14;
  },
  shot(h, t) {
    const me = h.host.player.feet;
    if (t < 1.8) return { pos: me.add(V(0, 2.2, 0)), target: h.center(), fov: 1.0, cut: t < 0.03 };
    return orbit(h, 0.6, 3, 0.4, 0.74, t < 1.83);
  },
};
export const FLASH: Kit = {
  id: "flash", color: "#e8c020", label: "FL",
  speedster: true,
  run: 14, sprint: 40,
  prefer: ["bolt", "flurry", "dash"],
  holdRange: 2,
  stance: FLASH_STANCE,
  landing: FLASH_SKID,
  moves: {
    dash: dashMove("dash", {
      speed: 40, reach: 1.2, launch: 9, up: 3,
      pose: (h, a, want) => {
        if (a.t < 0.18) copyPose(FLASH_STANCE, want);
        else {
          sample(h.clips.sprint, a.t * 2.6, true, want);
          naturalArms(want, 1, 0.3);
        }
      },
      trail: (h, dir) => h.blur(dir, 40),
      afterHit: (h) => {
        // and back out of reach
        const back = h.fwd().scale(-1);
        for (let i = 0; i < 8; i++) h.stepTo(h.p.x + back.x * 0.5, h.p.z + back.z * 0.5);
        h.blur(back, 40);
      },
    }),
    flurry: FLASH_FLURRY,
    bolt: FLASH_THROW_MOVE,
  },
  dodge: FLASH_DODGE,
  entrance: FLASH_ENTRANCE,
  lines: {
    intro: "Sorry I'm late. Ironic, right?",
    hit: ["Didn't see that one coming. Literally.", "Ow — too slow, Barry."],
    down: ["Everything's… really slow right now…"],
    up: ["And I'm back. Blink and you missed it.", "Speed Force, don't fail me now."],
    victory: ["That's the fastest win ever. I timed it."],
    fight: ["Run, Barry, run!", "Catch me if you can!", "Faster!"],
  },
  after(h, dt) {
    // a crackle on him now and then, more when he's moving
    if (Math.random() < dt * (flat(h.v).length() > 8 ? 20 : 2)) {
      const a = h.center().add(V(rnd(-0.3, 0.3), rnd(-0.6, 0.6), rnd(-0.3, 0.3)));
      h.host.lightning.strike(a, a.add(V(rnd(-0.5, 0.5), rnd(-0.5, 0.5), rnd(-0.5, 0.5))), BOLT_Y, 0.06, 0.2, 0.2, 0);
    }
  },
};

/** the kits by roster id */
export const KITS: Record<string, Kit> = { thor: THOR, cap: CAP, marvel: MARVEL, starlord: STARLORD, drax: DRAX, rocket: ROCKET, flash: FLASH };
void angDiff;
void LANDING;
void STANCE;
