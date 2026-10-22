import { Color3 } from "@babylonjs/core/Maths/math.color";
import { Quaternion, Vector3 } from "@babylonjs/core/Maths/math.vector";
import { TransformNode } from "@babylonjs/core/Meshes/transformNode";
import { armAt, dashMove, faceYou, orbit, spotNear, trouble } from "./kits";
import { pose, type Pose } from "./SpiderPoses";
import {
  P, V, comboMove, copyPose, flat, naturalArms, normD, rnd, sample, shootMove,
  type Act, type Entrance, type Kit, type Move, type RosterHero, type Tgt,
} from "./RosterHero";
import { beamMove, slamMove } from "../enemies/villainKits";
import { AUTO } from "./HeroRig";
import { autoSkin } from "../characters/autoSkin";
import { STANCE } from "./SpiderPoses";

/**
 * The second wave of heroes (round 10), each a kit for RosterHero like the first seven: Doctor
 * Strange, Ironhide, the Silver Surfer, the Human Torch, Mister Fantastic (Toothless and Ant-Man in
 * their own sections below). Lines are written for this game — subtitles only, no voice files.
 */

/** a ring of sprites: a sling-ring portal (upright, facing `n`) or a mandala on the ground (n up) */
export function ringFx(h: RosterHero, at: Vector3, n: Vector3, r: number, c0: Color3, c1: Color3, count = 14, life = 0.25) {
  const a = Math.abs(n.y) > 0.9 ? V(1, 0, 0) : Vector3.Cross(n, V(0, 1, 0)).normalize();
  const b = Vector3.Cross(n, a).normalize();
  for (let k = 0; k < count; k++) {
    const t = rnd(0, Math.PI * 2);
    const p = at.add(a.scale(Math.cos(t) * r)).addInPlace(b.scale(Math.sin(t) * r));
    // (sparks thrown off the rim, along it — the sling ring's sputter)
    const tan = a.scale(-Math.sin(t)).addInPlace(b.scale(Math.cos(t))).scale(rnd(0.5, 2));
    h.host.glow.emit(p, tan, life, rnd(0.12, 0.22) * Math.max(1, r / 1.5), 1.5, c0, c1, 0.95, 2, 0.2);
  }
}
/** a safe spot beside `at`, `d` m out to one side (a portal's far end): on the floor, in bounds, in sight of `at` */
export function safeSpot(h: RosterHero, at: Vector3, d: number): Vector3 | null {
  const b = h.host.bounds, nav = h.host.nav;
  const base = flat(h.p.subtract(at)).normalize();
  for (const ang of [1.4, -1.4, 2.4, -2.4, 0.8, -0.8, Math.PI]) {
    const dir = V(base.x * Math.cos(ang) - base.z * Math.sin(ang), 0, base.x * Math.sin(ang) + base.z * Math.cos(ang));
    const p = at.add(dir.scale(d));
    if (p.x < b.minX + 2 || p.x > b.maxX - 2 || p.z < b.minZ + 2 || p.z > b.maxZ - 2) continue;
    const fy = nav.floorAt(p.x, at.y + 3, p.z, 6);
    if (fy === null || Math.abs(fy - at.y) > 1.5) continue;
    p.y = fy;
    if (nav.embedded(p.x, fy + 0.9, p.z) || !nav.clear(p.add(V(0, 1.2, 0)), at.add(V(0, 1.2, 0)))) continue;
    return p;
  }
  return null;
}
/** the heroes near him that can take a buff (the roster heroes; the older ones keep their own) */
function teamNear(h: RosterHero, r: number) {
  return h.host.heroes().filter((c) => c !== h && "guard" in c && Vector3.Distance(c.feet, h.p) < r) as unknown as RosterHero[];
}

// ================================================================== DOCTOR STRANGE
const ORANGE = new Color3(1, 0.55, 0.12);
const ORANGE2 = new Color3(1, 0.25, 0.02);
const CRIMSON = new Color3(1, 0.15, 0.1);
/** hands up and apart, fingers spread: a sorcerer's guard */
const DS_STANCE = pose(
  {
    hips: [0, 1, 0.02], spine: [0, 1, 0.04], spine1: [0, 1, 0.05], spine2: [0, 1, 0.03], neck: [0, 1, 0.06], head: [0, 0.99, 0.1],
    lArm: [-0.55, -0.62, 0.55], lFore: [-0.25, 0.35, 0.9], lHand: [-0.2, 0.5, 0.84],
    rArm: [0.55, -0.62, 0.55], rFore: [0.25, 0.35, 0.9], rHand: [0.2, 0.5, 0.84],
    lThigh: [-0.16, -0.98, 0.08], rThigh: [0.17, -0.98, -0.06],
  },
  [0, 0.98, 0],
);
/** both palms thrown forward (a bolt, a band) */
const DS_CAST = pose(
  {
    hips: [0, 1, 0.06], spine: [0, 1, 0.1], spine1: [0, 1, 0.12], spine2: [0, 1, 0.08], neck: [0, 1, 0.08], head: [0, 0.99, 0.1],
    lArm: [-0.22, 0.02, 0.97], lFore: [-0.1, 0.12, 0.99], lHand: [0, 0.6, 0.8],
    rArm: [0.22, 0.02, 0.97], rFore: [0.1, 0.12, 0.99], rHand: [0, 0.6, 0.8],
    lThigh: [-0.2, -0.92, 0.33], lShin: [-0.05, -0.98, -0.15], rThigh: [0.2, -0.96, -0.2], rShin: [0.05, -0.92, -0.38],
  },
  [0, 0.94, 0],
);
/** arms raised before him, hands circling: the shield, the mandala */
const DS_CIRCLE = pose(
  {
    hips: [0, 1, 0], spine: [0, 1, 0.02], spine1: [0, 1, 0.02], spine2: [0, 1, 0], neck: [0, 1, 0.04], head: [0, 0.99, 0.08],
    lArm: [-0.4, 0.35, 0.85], lFore: [0.25, 0.55, 0.8], lHand: [0.3, 0.7, 0.65],
    rArm: [0.4, 0.35, 0.85], rFore: [-0.25, 0.55, 0.8], rHand: [-0.3, 0.7, 0.65],
    lThigh: [-0.2, -0.97, 0.08], rThigh: [0.2, -0.97, -0.05],
  },
  [0, 0.98, 0],
);
const palms = (h: RosterHero) => h.hand("l").add(h.hand("r")).scale(0.5).add(h.fwd().scale(0.25));
/** the Shield of the Seraphim: a mandala before him, and on whoever's next to him for a while */
const DS_SHIELD: Move = {
  start(h, a) {
    a.dur = 1.2;
    h.host.audio.play("repulsorCharge", { x: h.p.x, y: h.p.y + 1.3, z: h.p.z, volume: 0.8, rate: 1.4 });
    h.say("Shields up. Stay behind me.", 2);
  },
  frame(h, a) {
    if (a.t > 0.4 && a.n === 0) {
      a.n = 1;
      h.guard = 0.3;
      const shielded = [h, ...teamNear(h, 7)];
      for (const x of shielded) {
        x.guard = Math.min(x.guard, 0.5);
        (x as { _shieldT?: number })._shieldT = 6;
      }
      (h as { _shieldT?: number })._shieldT = 6;
    }
    ringFx(h, palms(h), h.fwd(), 1.1 * Math.min(1, a.t / 0.4), ORANGE, ORANGE2, 16);
  },
  pose(_h, _a, want) {
    copyPose(DS_CIRCLE, want);
    return 14;
  },
};
/** the Crimson Bands of Cyttorak: a red bolt that wraps whatever it hits and holds it */
const DS_BIND: Move = {
  start(_h, a) {
    if (!a.tgt) return false;
    a.dur = 0.9;
  },
  frame(h, a) {
    const t = a.tgt;
    if (!t || !h.tgtAlive(t)) return a.n > 0;
    if (a.t > 0.35 && a.n === 0) {
      a.n = 1;
      const from = palms(h), to = h.aimOf(t);
      h.host.audio.play("batarang", { x: from.x, y: from.y, z: from.z, volume: 0.6, rate: 0.7 });
      h.host.bolts.fire(from, to, 40, new Color3(1, 0.6, 0.5), CRIMSON, 1.4, () => {
        if (!h.tgtAlive(t)) return;
        h.hit(t, h.book.def("bind")?.damage ?? 10, to.subtract(from), { force: 0.5 });
        // (a foe held where he stands — the bigger he is, the shorter it holds)
        if ("foe" in t) t.foe.web(Math.max(0.8, 3.5 / Math.max(1, t.foe.size)));
        (h as { _bound?: { t: Tgt; secs: number } })._bound = { t, secs: 3 };
      });
    }
  },
  pose(h, a, want) {
    copyPose(DS_CAST, want);
    if (a.tgt) {
      armAt(h, want, "l", h.aimOf(a.tgt));
      armAt(h, want, "r", h.aimOf(a.tgt));
    }
    return 22;
  },
};
/**
 * The sling ring: a portal opens beside him, another beside his target, and he steps through —
 * only to a checked spot (on the floor, in bounds, in sight of the target); none, and he stays put.
 */
const DS_PORTAL: Move = {
  moves: true,
  start(h, a) {
    if (!a.tgt) return false;
    const dest = safeSpot(h, h.tgtGround(a.tgt), 4.5);
    if (!dest) return false;
    a.data.from = h.p.clone();
    a.data.to = dest;
    a.dur = 1.4;
    h.host.audio.play("repulsorCharge", { x: h.p.x, y: h.p.y + 1, z: h.p.z, volume: 0.7, rate: 1.7 });
  },
  frame(h, a) {
    const from = a.data.from as Vector3, to = a.data.to as Vector3;
    const n = h.fwd();
    const k = Math.min(1, a.t / 0.5) * (a.t > 1.1 ? 1 - (a.t - 1.1) / 0.3 : 1);
    ringFx(h, from.add(V(0, 1.1, 0)).add(n.scale(0.8)), n, 1.15 * k, ORANGE, ORANGE2, 10, 0.18);
    ringFx(h, to.add(V(0, 1.1, 0)), n, 1.15 * k, ORANGE, ORANGE2, 10, 0.18);
    if (a.t > 0.6 && a.n === 0) {
      a.n = 1;
      h.p.copyFrom(to);
      h.v.setAll(0);
      if (a.tgt) h.faceTo(h.tgtGround(a.tgt));
      h.host.audio.play("smokePop", { x: to.x, y: to.y + 1, z: to.z, volume: 0.6, rate: 1.3 });
    }
  },
  pose(_h, a, want) {
    copyPose(a.t < 0.6 ? DS_CIRCLE : DS_STANCE, want);
    return 14;
  },
};
const DS_ENTRANCE: Entrance = {
  dur: 6.4,
  begin(h) {
    const land = spotNear(h, 6, 12, false);
    if (!land) return false;
    const toYou = flat(h.host.player.feet.subtract(land)).normalize();
    const e = h as { _land?: Vector3; _gate?: Vector3; _beat?: number };
    e._land = land.clone();
    e._gate = land.subtract(toYou.scale(1.6));
    e._beat = 0;
    h.p.copyFrom(e._gate.subtract(toYou.scale(1.2)));
    h.faceTo(land);
    return true;
  },
  frame(h, t, dt) {
    // sparks in the air, a circle of fire spinning open — and he steps through it, out of somewhere else
    const e = h as { _land?: Vector3; _gate?: Vector3; _beat?: number };
    const land = e._land!, gate = e._gate!;
    const n = flat(land.subtract(gate)).normalize();
    const live = dt < 0.095;
    const open = t < 0.4 ? 0 : t < 1.4 ? (t - 0.4) / 1 : t < 4.6 ? 1 : Math.max(0, 1 - (t - 4.6) / 0.6);
    if (live && open > 0) ringFx(h, gate.add(V(0, 1.2, 0)), n, 1.5 * open, ORANGE, ORANGE2, 18, 0.2);
    if (live && t < 0.4 && Math.random() < 0.6) h.host.glow.emit(gate.add(V(rnd(-0.3, 0.3), 1.2 + rnd(-0.3, 0.3), 0)), V(rnd(-2, 2), rnd(-1, 2), rnd(-2, 2)), 0.25, 0.15, 3, ORANGE, ORANGE2, 1, 3, 0);
    if ((e._beat ?? 0) < 1 && t > 0.4) {
      e._beat = 1;
      h.host.audio.play("repulsorCharge", { x: gate.x, y: gate.y + 1.2, z: gate.z, volume: 0.9, rate: 0.8 });
    }
    if (t > 1.8 && t < 3.4) {
      Vector3.LerpToRef(gate.subtract(n.scale(1.2)), land, (t - 1.8) / 1.6, h.p);
      h.v.copyFrom(n.scale(2.8 / 1.6));
    } else if (t >= 3.4) {
      h.v.setAll(0);
      h.p.copyFrom(land);
      faceYou(h);
    }
    // the mandala at his feet as he sets them down
    if (live && t > 3.6 && t < 5) ringFx(h, land.add(V(0, 0.05, 0)), V(0, 1, 0), 1.8 * Math.min(1, (t - 3.6) / 0.4), ORANGE, ORANGE2, 14, 0.3);
    if ((e._beat ?? 0) < 2 && t > 3.6) {
      e._beat = 2;
      h.host.rings.boom(land.add(V(0, 0.1, 0)), V(0, 1, 0), 6);
      h.host.audio.play("sonicBoom", { x: land.x, y: land.y + 1, z: land.z, volume: 0.4, rate: 1.6 });
    }
    if ((e._beat ?? 0) < 3 && t > 4.1) {
      e._beat = 3;
      h.say("I've seen how this ends. We win — if you do exactly as I say.", 3.2);
    }
  },
  pose(h, t, want, dt) {
    h.rig.setVisible(t > 1.6);
    if (t > 1.8 && t < 3.4) {
      (h as { _ph?: number })._ph = ((h as { _ph?: number })._ph ?? 0) + dt * (1.75 / 1.25);
      sample(h.clips.walk, (h as { _ph?: number })._ph!, true, want);
      naturalArms(want, 0.1, 0.02);
      return 30;
    }
    copyPose(t < 3.4 ? DS_STANCE : t < 4.8 ? DS_CIRCLE : DS_STANCE, want);
    return 10;
  },
  shot(h, t) {
    const e = h as { _land?: Vector3; _gate?: Vector3 };
    const land = e._land ?? h.p, gate = e._gate ?? h.p;
    const n = flat(land.subtract(gate)).normalize();
    const side = V(n.z, 0, -n.x);
    if (t < 3.4) return { pos: land.add(n.scale(3.2)).add(side.scale(1.2)).addInPlaceFromFloats(0, 1.3, 0), target: gate.add(V(0, 1.2, 0)), fov: 0.85, cut: t < 0.03 };
    if (t < 4.8) return { pos: land.add(n.scale(3.6)).addInPlaceFromFloats(0, 3.2, 0), target: land.add(V(0, 0.6, 0)), fov: 0.85, cut: t < 3.43 };
    return orbit(h, 0.4, 2.8, 0.4, 0.7, t < 4.83, 1.15);
  },
};
export const STRANGE: Kit = {
  id: "strange", color: "#d9562b", label: "DS",
  run: 6, sprint: 8.5,
  prefer: ["mandala", "shield", "portal", "bind", "bolts"],
  holdRange: 11,
  stance: DS_STANCE,
  landing: DS_STANCE,
  moves: {
    bolts: shootMove("bolts", { hands: "both", shots: 4, every: 0.22, speed: 48, core: new Color3(1, 0.85, 0.5), glow: ORANGE, size: 1.3, sound: "batarang", rate: 1.6 }),
    shield: DS_SHIELD,
    bind: DS_BIND,
    portal: DS_PORTAL,
    mandala: slamMove("mandala", { wind: 0.9, radius: 8, at: "self", color: ORANGE, launch: 10, pose: (_h, _a, want) => copyPose(DS_CIRCLE, want), after: (h, at) => ringFx(h, at.add(V(0, 0.1, 0)), V(0, 1, 0), 7, ORANGE, ORANGE2, 60, 0.6) }),
  },
  entrance: DS_ENTRANCE,
  lines: {
    intro: "I've seen how this ends.",
    hit: ["The cloak's got it.", "Careless."],
    down: ["Not… how I saw it."],
    up: ["Time's on my side.", "Back again."],
    victory: ["That's the one where we win."],
    fight: ["By the Vishanti!", "The Crimson Bands of Cyttorak!", "Dormammu would be less trouble."],
  },
  after(h, dt) {
    // the shields wearing off (his and the ones he put on the others — wherever they've gone since)
    for (const x of [h, ...teamNear(h, Infinity)]) {
      const s = x as { _shieldT?: number };
      if (!s._shieldT) continue;
      s._shieldT -= dt;
      if (Math.random() < dt * 12) ringFx(x, x.center(), V(rnd(-1, 1), rnd(-0.3, 0.3), rnd(-1, 1)).normalize(), x.def.height * 0.55, ORANGE, ORANGE2, 3, 0.2);
      if (s._shieldT <= 0) {
        s._shieldT = 0;
        x.guard = 1;
      }
    }
    // the bands round whoever's bound
    const b = (h as { _bound?: { t: Tgt; secs: number } })._bound;
    if (b) {
      b.secs -= dt;
      if (b.secs <= 0 || !h.tgtAlive(b.t)) (h as { _bound?: unknown })._bound = undefined;
      else if (Math.random() < dt * 20) ringFx(h, h.aimOf(b.t), V(0, 1, 0), 0.6 + 0.3 * h.sizeOf(b.t), CRIMSON, CRIMSON, 4, 0.2);
    }
  },
};

// ================================================================== IRONHIDE
const IH_STANCE = pose(
  {
    hips: [0, 1, 0.04], spine: [0, 1, 0.08], spine1: [0, 1, 0.08], spine2: [0, 1, 0.05], neck: [0, 1, 0.08], head: [0, 0.98, 0.12],
    // both cannons up and forward, elbows out
    lArm: [-0.6, -0.65, 0.45], lFore: [-0.12, -0.08, 0.99], lHand: [-0.1, -0.05, 1],
    rArm: [0.6, -0.65, 0.45], rFore: [0.12, -0.08, 0.99], rHand: [0.1, -0.05, 1],
    lThigh: [-0.28, -0.95, 0.12], lShin: [-0.08, -0.98, -0.12], rThigh: [0.28, -0.95, -0.05], rShin: [0.08, -0.98, -0.15],
  },
  [0, 0.95, 0],
);
const IH_SALVO = pose(
  {
    hips: [0, 1, 0.08], spine: [0, 1, 0.14], spine1: [0, 1, 0.14], spine2: [0, 1, 0.1], neck: [0, 1, 0.1], head: [0, 0.98, 0.12],
    lArm: [-0.3, 0.05, 0.95], lFore: [-0.05, 0.08, 1], lHand: [0, 0.08, 1],
    rArm: [0.3, 0.05, 0.95], rFore: [0.05, 0.08, 1], rHand: [0, 0.08, 1],
    lThigh: [-0.3, -0.85, 0.42], lShin: [-0.08, -0.98, -0.15], rThigh: [0.3, -0.92, -0.28], rShin: [0.08, -0.88, -0.45],
  },
  [0, 0.9, 0],
);
const CANNON = new Color3(1, 0.65, 0.25);
const cannonAt = (h: RosterHero, side: "l" | "r") => h.hand(side).add(h.fwd().scale(0.7));
const IH_ENTRANCE: Entrance = {
  dur: 7.4,
  begin(h) {
    const land = spotNear(h, 12, 20, false);
    if (!land) return false;
    const e = h as { _land?: Vector3; _from?: Vector3; _beat?: number };
    e._land = land.clone();
    e._from = land.add(flat(land.subtract(h.host.player.feet)).normalize().scale(16));
    e._beat = 0;
    h.p.copyFrom(e._from);
    h.faceTo(land);
    return true;
  },
  frame(h, t, dt) {
    // the ground jumping before you see him: low on his feet as they come down, one by one; he
    // stops square on, the cannons come up and spin, the barrels glowing
    const e = h as { _land?: Vector3; _from?: Vector3; _beat?: number };
    const land = e._land!, from = e._from!;
    if (t < 4.6) {
      Vector3.LerpToRef(from, land, t / 4.6, h.p);
      h.v.copyFrom(land.subtract(from).scale(1 / 4.6));
      const step = Math.floor(t / 0.62);
      if ((e._beat ?? 0) < 1 + step) {
        e._beat = 1 + step;
        h.host.audio.play("hulkStep", { x: h.p.x, y: h.p.y, z: h.p.z, volume: 1.1, rate: 0.55 });
        h.host.audio.play("impactMetal", { x: h.p.x, y: h.p.y, z: h.p.z, volume: 0.35, rate: 0.5 });
        h.host.player.shake(0.22);
        h.host.dust(h.p.clone(), 0.5);
      }
    } else {
      h.v.setAll(0);
      h.p.copyFrom(land);
      faceYou(h);
    }
    if (t > 5.2) {
      for (const s of ["l", "r"] as const) if (dt < 0.095 && Math.random() < 0.6) h.host.glow.emit(cannonAt(h, s), V(rnd(-0.3, 0.3), rnd(0, 0.4), rnd(-0.3, 0.3)), 0.2, 0.35, 0.5, CANNON, CANNON, 0.85, 2, 0);
      if ((e._beat ?? 0) < 20) {
        e._beat = 20;
        h.host.audio.play("rocketLoad", { x: h.p.x, y: h.p.y + 2, z: h.p.z, volume: 1, rate: 0.6 });
        h.host.audio.play("repulsorCharge", { x: h.p.x, y: h.p.y + 2, z: h.p.z, volume: 0.9, rate: 0.5 });
      }
    }
    if ((e._beat ?? 0) < 21 && t > 5.8) {
      e._beat = 21;
      h.say("You feeling lucky, punk?", 2.4);
    }
  },
  pose(h, t, want, dt) {
    if (t < 4.6) {
      (h as { _ph?: number })._ph = ((h as { _ph?: number })._ph ?? 0) + dt * ((16 / 4.6) / 1.25) * 0.55;
      sample(h.clips.walk, (h as { _ph?: number })._ph!, true, want);
      naturalArms(want, 0.1, 0.02);
      return 30;
    }
    copyPose(t > 5.2 ? IH_SALVO : IH_STANCE, want);
    return 8;
  },
  shot(h, t) {
    const land = (h as { _land?: Vector3 })._land ?? h.p;
    const toYou = flat(h.host.player.feet.subtract(land)).normalize();
    const side = V(toYou.z, 0, -toYou.x);
    // low, beside his path: the feet coming down; then a step back for all of him
    if (t < 2.6) return { pos: land.add(toYou.scale(2)).add(side.scale(3)).addInPlaceFromFloats(0, 0.35, 0), target: h.p.add(V(0, 0.6, 0)), fov: 0.75, cut: t < 0.03 };
    if (t < 4.6) return { pos: land.add(toYou.scale(9)).add(side.scale(2)).addInPlaceFromFloats(0, 0.6, 0), target: h.center().add(V(0, 0.8, 0)), fov: 0.85, cut: t < 2.63 };
    // the cannons, close
    if (t < 6.2) return { pos: h.center().add(h.fwd().scale(6.5)).add(side.scale(2.5)).addInPlaceFromFloats(0, 0.4, 0), target: cannonAt(h, "r"), fov: 0.7, cut: t < 4.63 };
    return orbit(h, 0.45, 11, 1.6, 0.8, t < 6.23, 1.05);
  },
};
export const IRONHIDE: Kit = {
  id: "ironhide", color: "#3a3a3a", label: "IH",
  run: 5.2, sprint: 7.5,
  prefer: ["barrage", "smash", "cannons"],
  holdRange: 12,
  stance: IH_STANCE,
  landing: IH_STANCE,
  moves: {
    cannons: shootMove("cannons", { hands: "both", shots: 4, every: 0.35, speed: 55, core: new Color3(1, 0.9, 0.7), glow: CANNON, size: 2.4, sound: "repulsorFire", rate: 0.55, splash: 3, muzzle: cannonAt, pose: (_h, _a, want) => copyPose(IH_SALVO, want) }),
    barrage: shootMove("barrage", { hands: "both", shots: 10, every: 0.14, speed: 60, core: new Color3(1, 0.9, 0.7), glow: CANNON, size: 2, sound: "repulsorFire", rate: 0.7, splash: 4, muzzle: cannonAt, vsAir: true, pose: (_h, _a, want) => copyPose(IH_SALVO, want) }),
    smash: comboMove("smash", [{ clip: "smash", speed: 0.8, hits: [0.41] }, { clip: "hook", speed: 0.8, hits: [0.29] }], 3.8, { launch: 16, up: 6, force: 3, sound: "impactMetal" }),
  },
  entrance: IH_ENTRANCE,
  lines: {
    intro: "You feeling lucky, punk?",
    hit: ["That all you've got?", "Scratched my paint."],
    down: ["Armour's… cracked."],
    up: ["Ironhide's still standing!", "Back on my feet."],
    victory: ["Scrap."],
    fight: ["Let's rock and roll!", "Cannons hot!", "Eat this!"],
  },
  tune(m) {
    m.metallic = Math.min(m.metallic ?? 0.5, 0.45);
    m.roughness = Math.max(m.roughness ?? 0.4, 0.35);
    m.environmentIntensity = 1.6;
    m.albedoColor = m.albedoColor.scale(1.3);
  },
  setup(h) {
    // (his vehicle mode is a second skeleton in the file — a truck standing on its end beside him
    // at rest; its clip only parks it. No transformation comes with it: hidden)
    for (const m of h.rig.meshes) if (/^VH_|\.001$/.test(m.material?.name ?? "")) m.setEnabled(false);
  },
};

// ================================================================== THE SILVER SURFER
const SILVER = new Color3(0.75, 0.88, 1);
const COSMIC = new Color3(0.4, 0.7, 1);
/** on the board: feet apart along it, knees bent, arms loose for balance */
const SS_SURF = pose(
  {
    hips: [0, 1, 0], spine: [0, 1, 0.06], spine1: [0, 1, 0.06], spine2: [0, 1, 0.03], neck: [0, 1, 0.05], head: [0, 0.99, 0.1],
    lArm: [-0.75, -0.6, 0.2], lFore: [-0.55, -0.6, 0.55], lHand: [-0.5, -0.6, 0.6],
    rArm: [0.75, -0.6, -0.2], rFore: [0.6, -0.65, -0.3], rHand: [0.55, -0.7, -0.3],
    lThigh: [-0.1, -0.85, 0.5], lShin: [-0.02, -0.98, -0.18], lFoot: [0, -0.5, 0.86],
    rThigh: [0.12, -0.9, -0.4], rShin: [0.04, -0.85, -0.52], rFoot: [0, -0.5, 0.86],
  },
  [0, 0.88, 0],
);
/** one arm thrown out at the target: the Power Cosmic */
const SS_BLAST = pose(
  {
    hips: [0, 1, 0], spine: [0, 1, 0.05], spine1: [0, 1, 0.05], spine2: [0, 1, 0.03], neck: [0, 1, 0.05], head: [0, 0.99, 0.12],
    lArm: [-0.8, -0.55, 0.1], lFore: [-0.6, -0.65, 0.4],
    rArm: [0.2, 0.05, 0.98], rFore: [0.1, 0.05, 1], rHand: [0, 0.3, 0.95],
    lThigh: [-0.1, -0.85, 0.5], lShin: [-0.02, -0.98, -0.18], lFoot: [0, -0.5, 0.86],
    rThigh: [0.12, -0.9, -0.4], rShin: [0.04, -0.85, -0.52], rFoot: [0, -0.5, 0.86],
  },
  [0, 0.88, 0],
);
/** the board under his feet every frame (it hangs off the rig's root: taken over, placed by his feet) */
function surfBoard(h: RosterHero) {
  const e = h as { _board?: { place(p: Vector3, q: Quaternion): void }; _boardQ?: Quaternion };
  const b = e._board;
  if (!b) return;
  const l = h.rig.atCached("LeftToeBase"), r = h.rig.atCached("RightToeBase");
  const mid = l.add(r).scale(0.5).add(h.rig.atCached("LeftFoot").add(h.rig.atCached("RightFoot")).scale(0.5)).scale(0.5);
  b.place(mid.subtract(V(0, 0.08, 0).applyRotationQuaternion(h.q)), h.q.multiply(e._boardQ!));
}
const SS_ENTRANCE: Entrance = {
  dur: 6.5,
  begin(h) {
    const at = spotNear(h, 9, 16);
    if (!at) return false;
    const e = h as { _land?: Vector3; _from?: Vector3; _beat?: number };
    e._land = at.add(V(0, 2.2, 0));
    const side = flat(at.subtract(h.host.player.feet)).normalize();
    e._from = at.add(V(side.z, 0, -side.x).scale(120)).addInPlaceFromFloats(0, 70, 0);
    e._beat = 0;
    h.p.copyFrom(e._from);
    h.pitch = 0;
    h.roll = 0;
    return true;
  },
  frame(h, t, dt) {
    // a silver streak across the sky, a long curve down, and he pulls up level, riding the board
    const e = h as { _land?: Vector3; _from?: Vector3; _beat?: number };
    const land = e._land!, from = e._from!;
    const k = Math.min(1, t / 3.6);
    const ease = 1 - Math.pow(1 - k, 2.4);
    // (an arc: down and round)
    const mid = Vector3.Lerp(from, land, 0.6).addInPlaceFromFloats(0, -20, 0);
    const a = Vector3.Lerp(from, mid, ease), b = Vector3.Lerp(mid, land, ease);
    const prev = h.p.clone();
    Vector3.LerpToRef(a, b, ease, h.p);
    const vel = h.p.subtract(prev).scale(1 / Math.max(dt, 1e-3));
    if (vel.length() > 1) h.yaw = Math.atan2(vel.x, vel.z);
    h.roll = t < 3.6 ? -0.35 * Math.sin(k * Math.PI) : 0;
    if (dt < 0.095 && t < 3.8) for (let i = 0; i < 4; i++) h.host.glow.emit(h.p.add(V(rnd(-0.3, 0.3), rnd(0, 0.3), rnd(-0.3, 0.3))), V(rnd(-0.5, 0.5), rnd(-0.5, 0.5), rnd(-0.5, 0.5)), rnd(0.6, 1.2), rnd(0.25, 0.45), 0, SILVER, COSMIC, 0.85, 0, 0);
    if ((e._beat ?? 0) < 1 && t > 3.6) {
      e._beat = 1;
      h.host.rings.boom(h.center(), V(0, 1, 0), 9);
      h.host.audio.play("sonicBoom", { x: h.p.x, y: h.p.y, z: h.p.z, volume: 0.6, rate: 1.4 });
    }
    if (t > 3.8) {
      const tr = trouble(h);
      if (tr) h.turnTo(Math.atan2(tr.x - h.p.x, tr.z - h.p.z), dt, 1.5);
    }
    if ((e._beat ?? 0) < 2 && t > 4.4) {
      e._beat = 2;
      h.say("Your world is not lost. Not yet.", 2.8);
    }
  },
  pose(_h, t, want) {
    copyPose(t > 4.6 && t < 6 ? SS_BLAST : SS_SURF, want);
    return 8;
  },
  shot(h, t) {
    const land = (h as { _land?: Vector3 })._land ?? h.p;
    const toYou = flat(h.host.player.feet.subtract(land)).normalize();
    if (t < 3.6) return { pos: land.add(toYou.scale(12)).addInPlaceFromFloats(0, -1.2, 0), target: h.center(), fov: 0.9, cut: t < 0.03 };
    return orbit(h, -0.5 + (t - 3.6) * 0.15, 3.6, 0.3, 0.72, t < 3.63, 1);
  },
};
export const SURFER: Kit = {
  id: "surfer", color: "#b9c8d8", label: "SS",
  flyer: true,
  run: 20, sprint: 34,
  prefer: ["nova", "beam", "ram", "cosmic"],
  holdRange: 12,
  stance: SS_SURF,
  idle: SS_SURF,
  landing: SS_SURF,
  moves: {
    cosmic: shootMove("cosmic", { hands: "r", shots: 3, every: 0.22, speed: 75, core: new Color3(0.9, 0.97, 1), glow: COSMIC, size: 1.5, sound: "repulsorFire", rate: 1.5, vsAir: true, airborne: true, pose: (_h, _a, want) => copyPose(SS_BLAST, want) }),
    beam: ((m: Move) => ({ ...m, vsAir: true }))(beamMove("beam", {
      from: (h) => h.hand("r"), core: new Color3(0.9, 0.97, 1), sheath: COSMIC, width: 2.2, dur: 2, wind: 0.5, sound: "unibeam", airborne: true,
      pose: (h, a, want) => {
        copyPose(SS_BLAST, want);
        if (a.tgt) armAt(h, want, "r", h.aimOf(a.tgt));
      },
    })),
    ram: dashMove("ram", {
      speed: 38, reach: 1.6, launch: 20, up: 7, fly: true, vsAir: true, sound: "sonicBoom",
      pose: (_h, _a, want) => copyPose(SS_SURF, want),
      trail: (h, dir) => {
        for (let k = 0; k < 3; k++) h.host.glow.emit(h.p.subtract(dir.scale(rnd(0, 2))), V(), 0.5, 0.4, 0, SILVER, COSMIC, 0.8, 0, 0);
      },
    }),
    nova: ((m: Move) => ({ ...m, airborne: true }))(slamMove("nova", { wind: 1, radius: 9, at: "self", color: SILVER, launch: 14, pose: (_h, _a, want) => {
      copyPose(SS_SURF, want);
      want.d[P.lArm] = normD([-0.95, 0.3, 0]);
      want.d[P.rArm] = normD([0.95, 0.3, 0]);
      want.d[P.lFore] = normD([-0.95, 0.3, 0]);
      want.d[P.rFore] = normD([0.95, 0.3, 0]);
    } })),
  },
  entrance: SS_ENTRANCE,
  lines: {
    intro: "Your world is not lost. Not yet.",
    hit: ["Hm.", "A sting. Nothing more."],
    down: ["The Power Cosmic… fades."],
    up: ["I endure.", "The board, to me."],
    victory: ["It is done."],
    fight: ["Feel the Power Cosmic!", "You cannot outrun me.", "Enough."],
  },
  tune(m) {
    // (chrome: the sky in him, not a dark-blue man — the file's skin texture is blue, so his body
    // is plain silver over its own normal map; the board keeps its texture)
    if (m.name !== "hero_silversurfer01_s01_surfboard") {
      m.albedoTexture = null;
      m.albedoColor = new Color3(0.82, 0.85, 0.9);
    }
    m.metallic = 0.95;
    m.roughness = 0.2;
    m.environmentIntensity = 1.8;
  },
  setup(h) {
    // his spear and sword (in his right hand in the file) aren't his: hidden
    for (const m of h.rig.meshes) if ((m.material?.name ?? "") === "hero_silversurfer_s01_wp01") m.setEnabled(false);
    const n = h.rig.node("Bone_surfboard");
    if (!n) return;
    h.rig.unloose(n);
    const prop = h.takeProp(n);
    // (its turn relative to him as it sits in the rest pose)
    h.rig.anchor.computeWorldMatrix(true);
    const aq = h.rig.anchor.rotationQuaternion!.clone();
    (h as { _boardQ?: Quaternion })._boardQ = Quaternion.Inverse(aq).multiply(prop.worldRot());
    (h as { _board?: unknown })._board = prop;
  },
  after(h, dt) {
    surfBoard(h);
    if (h.alive && Math.random() < dt * 8) h.host.glow.emit(h.p.add(V(rnd(-0.4, 0.4), 0, rnd(-0.4, 0.4))), V(0, -0.5, 0), 0.4, 0.25, 0, SILVER, COSMIC, 0.6, 0, 0);
  },
};

// ================================================================== THE HUMAN TORCH
const FIRE = new Color3(1, 0.62, 0.15);
const FIRE2 = new Color3(1, 0.2, 0.02);
const HT_HOVER = pose(
  {
    hips: [0, 1, 0], spine: [0, 1, 0.03], spine1: [0, 1, 0.03], spine2: [0, 1, 0], neck: [0, 1, 0.05], head: [0, 0.99, 0.1],
    lArm: [-0.5, -0.82, 0.25], lFore: [-0.3, -0.5, 0.8], lHand: [-0.2, -0.4, 0.9],
    rArm: [0.5, -0.82, 0.25], rFore: [0.3, -0.5, 0.8], rHand: [0.2, -0.4, 0.9],
    lThigh: [-0.06, -1, 0.1], lShin: [0, -1, -0.2], lFoot: [0, -0.75, 0.6],
    rThigh: [0.06, -1, 0.02], rShin: [0, -1, -0.28], rFoot: [0, -0.75, 0.6],
  },
  [0, 1, 0],
);
const HT_THROW = pose(
  {
    hips: [0, 1, 0], spine: [0.05, 1, 0.08], spine1: [0.08, 1, 0.1], spine2: [0.05, 1, 0.08], neck: [0, 1, 0.05], head: [0, 0.99, 0.1],
    lArm: [-0.6, -0.75, 0.2], lFore: [-0.3, -0.5, 0.8],
    rArm: [0.2, 0.08, 0.97], rFore: [0.08, 0.1, 1], rHand: [0, 0.25, 0.97],
    lThigh: [-0.06, -1, 0.1], lShin: [0, -1, -0.2], rThigh: [0.06, -1, 0.02], rShin: [0, -1, -0.28],
  },
  [0, 1, 0],
);
/** fire on the ground: a hit every half second to whatever's standing in it (never every frame) */
interface Blaze { at: Vector3; r: number; t: number; tick: number; dmg: number }
function htBlazes(h: RosterHero) {
  const e = h as { _blazes?: Blaze[] };
  return (e._blazes ??= []);
}
function burnBody(h: RosterHero, dt: number, k: number) {
  if (!h.active || h.mode === "ko") return;
  const n = dt * 40 * k;
  for (let i = 0; i < 3 && Math.random() < n - i; i++) {
    const at = h.center().add(V(rnd(-0.3, 0.3), rnd(-0.85, 0.85), rnd(-0.25, 0.25)));
    h.host.glow.emit(at, V(rnd(-0.3, 0.3), rnd(0.8, 2), rnd(-0.3, 0.3)), rnd(0.3, 0.55), rnd(0.25, 0.5), -0.5, FIRE, FIRE2, 0.8, 1.5, 0.6);
  }
}
const HT_STREAM = beamMove("stream", {
  from: (h) => h.hand("r"), core: new Color3(1, 0.9, 0.5), sheath: FIRE2, width: 2.6, dur: 1.6, wind: 0.3, sound: "thrustLoop", airborne: true,
  pose: (h, a, want) => {
    copyPose(HT_THROW, want);
    if (a.tgt) armAt(h, want, "r", h.aimOf(a.tgt));
  },
});
const HT_RING: Move = {
  airborne: true,
  start(h, a) {
    a.dur = 1.2;
    h.host.audio.play("thrustLoop", { x: h.p.x, y: h.p.y + 1, z: h.p.z, volume: 0.9, rate: 0.6 });
  },
  frame(h, a) {
    if (a.t > 0.6 && a.n === 0) {
      a.n = 1;
      const g = h.host.nav.floorAt(h.p.x, h.p.y + 1, h.p.z, 20) ?? h.p.y;
      const at = V(h.p.x, g, h.p.z);
      // (a ring of fire on the ground round him: it stands for 5 s and burns whoever's in it)
      for (let k = 0; k < 8; k++) {
        const ang = (k / 8) * Math.PI * 2;
        htBlazes(h).push({ at: at.add(V(Math.sin(ang) * 5, 0, Math.cos(ang) * 5)), r: 2.2, t: 5, tick: 0, dmg: (h.book.def("ring")?.damage ?? 30) * 0.18 });
      }
      h.host.rings.boom(at.add(V(0, 0.2, 0)), V(0, 1, 0), 14);
    }
  },
  pose(_h, _a, want) {
    copyPose(HT_HOVER, want);
    want.d[P.lArm] = normD([-0.95, -0.25, 0]);
    want.d[P.rArm] = normD([0.95, -0.25, 0]);
    return 12;
  },
};
const HT_NOVA: Move = {
  airborne: true,
  start(h, a) {
    a.dur = 1.4;
    h.say("Supernova! Stand back!", 2.2);
    h.host.audio.play("repulsorCharge", { x: h.p.x, y: h.p.y + 1, z: h.p.z, volume: 1, rate: 0.6 });
  },
  frame(h, a) {
    if (a.t > 1 && a.n === 0) {
      a.n = 1;
      h.power = 1.6;
      (h as { _novaT?: number })._novaT = 12;
      h.host.rings.boom(h.center(), V(0, 1, 0), 12);
      h.host.audio.play("sonicBoom", { x: h.p.x, y: h.p.y + 1, z: h.p.z, volume: 0.7, rate: 0.9 });
    }
  },
  pose(_h, a, want) {
    copyPose(HT_HOVER, want);
    want.d[P.lArm] = normD([-0.9, 0.4, 0.1]);
    want.d[P.rArm] = normD([0.9, 0.4, 0.1]);
    want.d[P.head] = normD([0, 0.8, a.t > 0.6 ? -0.5 : 0.1]);
    return 10;
  },
};
const HT_ENTRANCE: Entrance = {
  dur: 6,
  begin(h) {
    const at = spotNear(h, 9, 16);
    if (!at) return false;
    const e = h as { _land?: Vector3; _from?: Vector3; _beat?: number };
    e._land = at.add(V(0, 2.4, 0));
    const side = flat(at.subtract(h.host.player.feet)).normalize();
    e._from = at.add(V(-side.z, 0, side.x).scale(70)).addInPlaceFromFloats(0, 30, 0);
    e._beat = 0;
    h.p.copyFrom(e._from);
    return true;
  },
  frame(h, t, dt) {
    // a comet low across the sky, trailing fire; he stops dead in the air, the flames roar up round him
    const e = h as { _land?: Vector3; _from?: Vector3; _beat?: number };
    const land = e._land!, from = e._from!;
    const k = Math.min(1, t / 2.8);
    const ease = 1 - Math.pow(1 - k, 3);
    const prev = h.p.clone();
    Vector3.LerpToRef(from, land, ease, h.p);
    const vel = h.p.subtract(prev);
    if (vel.length() > 1e-3) h.yaw = Math.atan2(vel.x, vel.z);
    if (dt < 0.095 && t < 2.9) for (let i = 0; i < 5; i++) h.host.glow.emit(h.center().add(V(rnd(-0.3, 0.3), rnd(-0.5, 0.5), rnd(-0.3, 0.3))), V(rnd(-1, 1), rnd(0, 1.5), rnd(-1, 1)), rnd(0.5, 1), rnd(0.4, 0.7), -0.3, FIRE, FIRE2, 0.8, 1, 0.5);
    if (t > 2.8) {
      faceYou(h);
      burnBody(h, dt, t < 4 ? 3 : 1);
    }
    if ((e._beat ?? 0) < 1 && t > 2.8) {
      e._beat = 1;
      h.host.rings.boom(h.center(), V(0, 1, 0), 10);
      h.host.audio.play("thrustLoop", { x: h.p.x, y: h.p.y, z: h.p.z, volume: 1, rate: 0.45 });
    }
    if ((e._beat ?? 0) < 2 && t > 3.2) {
      e._beat = 2;
      h.say("Flame on!", 2.2);
    }
  },
  pose(_h, t, want) {
    copyPose(t < 2.8 ? HT_THROW : HT_HOVER, want);
    if (t > 3.2 && t < 4.4) {
      want.d[P.lArm] = normD([-0.85, 0.45, 0.2]);
      want.d[P.rArm] = normD([0.85, 0.45, 0.2]);
    }
    return 8;
  },
  shot(h, t) {
    const land = (h as { _land?: Vector3 })._land ?? h.p;
    const toYou = flat(h.host.player.feet.subtract(land)).normalize();
    if (t < 2.8) return { pos: land.add(toYou.scale(10)).addInPlaceFromFloats(0, -1.5, 0), target: h.center(), fov: 0.9, cut: t < 0.03 };
    return orbit(h, 0.35, 3.4, 0.2, 0.75, t < 2.83, 1.05);
  },
};
export const TORCH: Kit = {
  id: "torch", color: "#ff7a1a", label: "HT",
  flyer: true,
  run: 16, sprint: 26,
  prefer: ["nova", "ring", "stream", "fireball"],
  holdRange: 10,
  stance: HT_HOVER,
  idle: HT_HOVER,
  landing: HT_HOVER,
  moves: {
    fireball: shootMove("fireball", { hands: "both", shots: 3, every: 0.25, speed: 45, core: new Color3(1, 0.85, 0.45), glow: FIRE2, size: 2, sound: "rocketWhoosh", rate: 1.4, splash: 2, vsAir: true, airborne: true, pose: (_h, _a, want) => copyPose(HT_THROW, want) }),
    stream: HT_STREAM,
    ring: HT_RING,
    nova: HT_NOVA,
  },
  entrance: HT_ENTRANCE,
  lines: {
    intro: "Flame on!",
    hit: ["Hey, watch the hair!", "Hot, hot, hot!"],
    down: ["Flame… off."],
    up: ["Flame on — again!", "Can't keep a good fire down."],
    victory: ["Toasted."],
    fight: ["Flame on!", "Too hot for you?", "Light 'em up!"],
  },
  after(h, dt) {
    // the fire on him (more of it in a supernova); the fires he's left on the ground
    const nova = (h as { _novaT?: number })._novaT ?? 0;
    if (nova > 0 && ((h as { _novaT?: number })._novaT = nova - dt) <= 0) h.power = 1;
    if (h.introT < 0) burnBody(h, dt, nova > 0 ? 3.5 : 1.8);
    const list = htBlazes(h);
    for (let i = list.length - 1; i >= 0; i--) {
      const z = list[i];
      z.t -= dt;
      if (z.t <= 0) {
        list.splice(i, 1);
        continue;
      }
      if (Math.random() < dt * 14) h.host.glow.emit(z.at.add(V(rnd(-z.r, z.r) * 0.6, 0.1, rnd(-z.r, z.r) * 0.6)), V(rnd(-0.3, 0.3), rnd(1, 2.5), rnd(-0.3, 0.3)), rnd(0.4, 0.8), rnd(0.35, 0.6), -0.8, FIRE, FIRE2, 0.8, 1, 0.8);
      z.tick -= dt;
      if (z.tick > 0) continue;
      z.tick = 0.5;
      for (const x of h.around(z.at, z.r)) h.hit(x, z.dmg, V(0, 1, 0), { kind: "blast" });
    }
  },
  tune(m) {
    // (lit from inside: the fire is him)
    m.emissiveColor = new Color3(0.55, 0.22, 0.03);
  },
};

// ================================================================== MISTER FANTASTIC
const MF_STANCE = pose(
  {
    hips: [0, 1, 0.03], spine: [0, 1, 0.06], spine1: [0, 1, 0.06], spine2: [0, 1, 0.04], neck: [0, 1, 0.06], head: [0, 0.99, 0.1],
    lArm: [-0.5, -0.8, 0.3], lFore: [-0.15, -0.3, 0.94], rArm: [0.5, -0.8, 0.3], rFore: [0.15, -0.3, 0.94],
    lThigh: [-0.18, -0.97, 0.12], rThigh: [0.2, -0.97, -0.08],
  },
  [0, 0.97, 0],
);
/** one arm out straight at the target (it's the arm that does the reaching) */
const MF_REACH = pose(
  {
    hips: [0, 1, 0.08], spine: [0.05, 1, 0.12], spine1: [0.08, 1, 0.12], spine2: [0.05, 1, 0.1], neck: [0, 1, 0.08], head: [0, 0.99, 0.1],
    lArm: [-0.5, -0.8, 0.3], lFore: [-0.15, -0.3, 0.94],
    rArm: [0.08, 0.02, 1], rFore: [0.02, 0.02, 1], rHand: [0, 0, 1],
    lThigh: [-0.2, -0.9, 0.38], lShin: [-0.05, -0.98, -0.15], rThigh: [0.2, -0.96, -0.2], rShin: [0.05, -0.92, -0.38],
  },
  [0, 0.92, 0],
);
/**
 * His stretch: the forearm made longer along its own length (the Biped bone runs along X), the
 * hand scaled back so it stays a hand — the skeleton is untouched, only its proportions.
 */
function stretch(h: RosterHero, side: "l" | "r", k: number) {
  const S = side === "l" ? "Left" : "Right";
  const fore = h.rig.bone(S + "ForeArm"), hand = h.rig.bone(S + "Hand");
  if (!fore || !hand) return;
  const e = h as { _len?: Record<string, number> };
  const len = (e._len ??= {});
  const cur = len[side] ?? 1;
  const nk = cur + (k - cur) * 0.35;
  len[side] = Math.abs(nk - 1) < 0.01 ? 1 : nk;
  fore.scaling.x = len[side];
  hand.scaling.x = 1 / len[side];
}
/** how far he can reach with an arm `k` times its length */
const reachOf = (h: RosterHero, k: number) => h.def.height * 0.3 * k;
const MF_PUNCH: Move = {
  start(h, a) {
    if (!a.tgt) return false;
    const d = Vector3.Distance(flat(h.tgtGround(a.tgt)), flat(h.p));
    // (the arm as long as it needs to be: up to 4 times its length)
    a.data.k = Math.max(1, Math.min(4, d / reachOf(h, 1)));
    a.dur = 0.9;
    h.faceTo(h.tgtGround(a.tgt));
  },
  frame(h, a, dt) {
    const t = a.tgt;
    if (t && h.tgtAlive(t)) h.turnTo(Math.atan2(h.tgtGround(t).x - h.p.x, h.tgtGround(t).z - h.p.z), dt, 8);
    const k = a.t < 0.25 ? 1 : a.t < 0.55 ? (a.data.k as number) : 1;
    stretch(h, "r", k);
    if (a.t > 0.42 && a.n === 0 && t && h.tgtAlive(t)) {
      a.n = 1;
      const aim = h.aimOf(t);
      const to = aim.subtract(h.center());
      if (flat(to).length() < reachOf(h, a.data.k as number) + 1 + 0.5 * h.sizeOf(t)) {
        h.hit(t, h.book.def("reach")?.damage ?? 16, to, { force: 2, launch: 9, up: 3 });
        h.host.audio.play("superPunch", { x: aim.x, y: aim.y, z: aim.z, volume: 0.8, rate: 1.1 });
        h.host.spark(aim, to.scale(-1).normalize());
      }
    }
  },
  pose(h, a, want) {
    copyPose(MF_REACH, want);
    if (a.tgt) armAt(h, want, "r", h.aimOf(a.tgt));
    return 24;
  },
};
/** a long arm out to grab whoever it is, and back, bringing him — thrown down at his feet */
const MF_GRAB: Move = {
  start(h, a) {
    if (!a.tgt) return false;
    const d = Vector3.Distance(flat(h.tgtGround(a.tgt)), flat(h.p));
    a.data.k = Math.max(1, Math.min(4, d / reachOf(h, 1)));
    a.dur = 1.3;
    h.faceTo(h.tgtGround(a.tgt));
  },
  frame(h, a) {
    const t = a.tgt;
    stretch(h, "r", a.t < 0.2 ? 1 : a.t < 0.6 ? (a.data.k as number) : 1);
    if (a.t > 0.6 && a.n === 0 && t && h.tgtAlive(t)) {
      a.n = 1;
      const aim = h.aimOf(t);
      const toMe = flat(h.p.subtract(h.tgtGround(t)));
      // (pulled in toward him — a giant just staggers)
      h.hit(t, h.book.def("grab")?.damage ?? 20, toMe, { force: 3, launch: Math.min(14, toMe.length() * 1.6), up: 4 });
      h.host.audio.play("hulkClap", { x: aim.x, y: aim.y, z: aim.z, volume: 0.5, rate: 1.4 });
    }
  },
  pose(h, a, want) {
    copyPose(MF_REACH, want);
    if (a.tgt) armAt(h, want, "r", h.aimOf(a.tgt));
    return 22;
  },
};
/** both arms out long and swung round him: everything close goes over */
const MF_WHIP: Move = {
  start(_h, a) {
    a.dur = 1.3;
  },
  frame(h, a, dt) {
    stretch(h, "l", a.t < 1.1 ? 2.6 : 1);
    stretch(h, "r", a.t < 1.1 ? 2.6 : 1);
    h.yaw += dt * (a.t < 1.1 ? 9 : 0);
    if (a.t > 0.5 && a.n === 0) {
      a.n = 1;
      for (const x of h.around(h.p, 6)) h.hit(x, h.book.def("whip")?.damage ?? 22, flat(h.tgtGround(x).subtract(h.p)).add(V(0, 0.01, 0)), { force: 3, launch: 12, up: 5 });
      h.host.audio.play("swingWhoosh", { x: h.p.x, y: h.p.y + 1, z: h.p.z, volume: 0.9, rate: 0.7 });
    }
  },
  pose(_h, _a, want) {
    copyPose(MF_STANCE, want);
    want.d[P.lArm] = normD([-1, 0.05, 0.05]);
    want.d[P.lFore] = normD([-1, 0.05, 0.05]);
    want.d[P.rArm] = normD([1, 0.05, 0.05]);
    want.d[P.rFore] = normD([1, 0.05, 0.05]);
    return 20;
  },
};
const MF_ENTRANCE: Entrance = {
  dur: 5.6,
  begin(h) {
    const land = spotNear(h, 8, 14, false);
    if (!land) return false;
    const e = h as { _land?: Vector3; _from?: Vector3; _beat?: number };
    e._land = land.clone();
    const toYou = flat(h.host.player.feet.subtract(land)).normalize();
    e._from = land.subtract(toYou.scale(22)).addInPlaceFromFloats(0, 9, 0);
    e._beat = 0;
    h.p.copyFrom(e._from);
    h.faceTo(land);
    return true;
  },
  frame(h, t, dt) {
    // an arm shoots out of the distance and grabs the ground, then the rest of him comes after it
    // like a released spring — a long arc in, a soft landing, and the arm comes back to length
    const e = h as { _land?: Vector3; _from?: Vector3; _beat?: number };
    const land = e._land!, from = e._from!;
    stretch(h, "r", t < 0.6 ? 1 : t < 2.6 ? 4 : 1);
    if (t > 1.2 && t < 2.6) {
      const k = (t - 1.2) / 1.4;
      Vector3.LerpToRef(from, land, k * k * (3 - 2 * k), h.p);
      h.p.y = from.y + (land.y - from.y) * k + Math.sin(k * Math.PI) * 4;
    } else if (t >= 2.6) {
      h.p.copyFrom(land);
      h.turnTo(Math.atan2(h.host.player.feet.x - h.p.x, h.host.player.feet.z - h.p.z), dt, 3);
    }
    if ((e._beat ?? 0) < 1 && t > 0.6) {
      e._beat = 1;
      h.host.audio.play("swingWhoosh", { x: from.x, y: from.y, z: from.z, volume: 1, rate: 0.6 });
    }
    if ((e._beat ?? 0) < 2 && t > 2.6) {
      e._beat = 2;
      h.host.dust(land, 0.5);
      h.host.audio.play("land", { x: land.x, y: land.y, z: land.z, volume: 0.8 });
    }
    if ((e._beat ?? 0) < 3 && t > 3.4) {
      e._beat = 3;
      h.say("Fascinating. Let's see what they're made of.", 2.8);
    }
  },
  pose(_h, t, want) {
    copyPose(t < 2.6 ? MF_REACH : MF_STANCE, want);
    return t < 2.6 ? 20 : 8;
  },
  shot(h, t) {
    const land = (h as { _land?: Vector3 })._land ?? h.p;
    const toYou = flat(h.host.player.feet.subtract(land)).normalize();
    const side = V(toYou.z, 0, -toYou.x);
    if (t < 2.6) return { pos: land.add(toYou.scale(4)).add(side.scale(5)).addInPlaceFromFloats(0, 2, 0), target: h.center(), fov: 0.95, cut: t < 0.03 };
    return orbit(h, 0.4, 3, 0.35, 0.72, t < 2.63, 1.1);
  },
};
export const FANTASTIC: Kit = {
  id: "fantastic", color: "#3c6fd8", label: "MF",
  run: 6.8, sprint: 9,
  prefer: ["whip", "grab", "reach"],
  holdRange: 5,
  stance: MF_STANCE,
  landing: MF_STANCE,
  moves: { reach: MF_PUNCH, grab: MF_GRAB, whip: MF_WHIP },
  entrance: MF_ENTRANCE,
  lines: {
    intro: "Fascinating. Let's see what they're made of.",
    hit: ["Elastic. Didn't hurt.", "Interesting."],
    down: ["Need… a moment… to reform."],
    up: ["Back in shape.", "Stretched, not broken."],
    victory: ["Exactly as I calculated."],
    fight: ["Simple physics!", "Let me reach out.", "Their weak point's right there."],
  },
  after(h) {
    // (out of a move his arms ease back to length — never left stretched)
    if (!h.action && h.introT < 0) {
      stretch(h, "l", 1);
      stretch(h, "r", 1);
    }
  },
};


// ================================================================== TOOTHLESS (rig names)
/**
 * Toothless's bones read as the pose skeleton's, so the rig can stand him up and carry him: his
 * body controller as the hips, his back and shoulders as the spine, his front legs as the arms and
 * his hind legs as the legs. His moving is all his own (see TOOTHLESS below): the poses keep these
 * bones where they rest, and the wings, legs, tail and head are turned on top, every frame.
 */
export const TOOTHLESS_RIG = {
  rename: (n: string) => {
    const M: Record<string, string> = {
      "BodyController.1": "Hips", "BackBone.1": "Spine", "ShoulderControl.1": "Spine1", "NeckStart.1": "Spine2", "Neck.1": "Neck", "Head.1": "Head",
      "Shoulder.L": "LeftArm", "Elbow.L": "LeftForeArm", "Wrist.L": "LeftHand", "Shoulder.R": "RightArm", "Elbow.R": "RightForeArm", "Wrist.R": "RightHand",
      "Thigh.L": "LeftUpLeg", "Knee.L": "LeftLeg", "Ankle.L": "LeftFoot", "Thigh.R": "RightUpLeg", "Knee.R": "RightLeg", "Ankle.R": "RightFoot",
    };
    return M[n] ?? "~" + n;
  },
};

// ================================================================== TOOTHLESS
const PLASMA = new Color3(0.55, 0.45, 1);
const PLASMA2 = new Color3(0.2, 0.15, 1);
/** where his bones rest (the poses leave them there: his moving is turned on top, below) */
const TT_REST = pose({}, [0, 1, 0]);
type TTJoint = { n: TransformNode; q: Quaternion };
interface TTRig { j: Record<string, TTJoint>; tail: TTJoint[]; flap: number; walk: number; jaw: number; look: number; tuck: number }
function ttRig(h: RosterHero) {
  return (h as { _tt?: TTRig })._tt;
}
/** turn a joint by `ang` about a world axis, on top of its rest (absolute every frame: never accumulates) */
function turnW(j: TTJoint | undefined, axis: Vector3, ang: number) {
  if (!j) return;
  const p = j.n.parent as TransformNode | null;
  const pq = new Quaternion();
  if (p) p.getWorldMatrix().decompose(undefined, pq);
  const local = Quaternion.Inverse(pq).multiply(Quaternion.RotationAxis(axis, ang)).multiply(pq);
  j.n.rotationQuaternion!.copyFrom(local.multiply(j.q));
  j.n.computeWorldMatrix(true);
}
/**
 * Toothless moving: the wings beating (or folded on the ground), the legs tucked in flight or
 * striding on the ground, the tail swaying and steering, the head on his target, the jaw for the
 * plasma — every joint turned from its rest about his own body's axes.
 */
function ttAnimate(h: RosterHero, dt: number) {
  const r = ttRig(h);
  if (!r) return;
  const q = h.rig.anchor.rotationQuaternion!;
  const right = V(1, 0, 0).applyRotationQuaternion(q), up = V(0, 1, 0).applyRotationQuaternion(q), fwd = V(0, 0, 1).applyRotationQuaternion(q);
  const ground = h.host.nav.floorAt(h.p.x, h.p.y + 0.5, h.p.z, 30) ?? 0;
  const onGround = h.mode !== "fly" || h.p.y - ground < 0.6;
  const speed = flat(h.v).length();
  // (beats faster climbing or charging; folded on the ground)
  r.flap += dt * (onGround ? 0 : 2.4 + Math.min(2, speed / 10)) * Math.PI * 2;
  r.tuck += ((onGround ? 0 : 1) - r.tuck) * Math.min(1, dt * 4);
  if (onGround && speed > 0.5) r.walk += dt * (speed / 2.2) * Math.PI * 2;
  const f = Math.sin(r.flap), fold = 1 - r.tuck;
  for (const [S, sgn] of [["L", 1], ["R", -1]] as const) {
    // wings: up and down about the body's length; folded back and down when he's standing
    turnW(r.j["WingShoulder." + S], fwd, sgn * (r.tuck * (f * 0.75 + 0.1) + fold * 0.5));
    turnW(r.j["WingShoulder." + S], up, sgn * fold * 1.1);
    turnW(r.j["WingElbow." + S], fwd, sgn * (r.tuck * Math.sin(r.flap - 0.9) * 0.35 - fold * 1.9));
    turnW(r.j["WingForeArm." + S], up, -sgn * fold * 1.2);
    // legs: tucked back in the air; striding on the ground (diagonal pairs together)
    const ph = r.walk + (S === "L" ? 0 : Math.PI);
    const stride = onGround && speed > 0.5 ? Math.sin(ph) * 0.55 : 0;
    turnW(r.j["Shoulder." + S], right, -stride + r.tuck * 0.9);
    turnW(r.j["Elbow." + S], right, r.tuck * -0.6 + (onGround ? Math.max(0, Math.cos(ph)) * 0.4 : 0));
    turnW(r.j["Thigh." + S], right, stride * -1 + r.tuck * -1.1);
    turnW(r.j["Knee." + S], right, r.tuck * 0.8 + (onGround ? Math.max(0, -Math.cos(ph)) * 0.4 : 0));
  }
  // the tail: a slow sway, a steer into turns, a lift in flight
  r.tail.forEach((j, i) => {
    turnW(j, up, Math.sin(h.time * 1.6 - i * 0.6) * 0.08 + r.look * 0.05);
    turnW(j, right, r.tuck * -0.03);
  });
  // the head on whatever he's after; the jaw open for the shot
  turnW(r.j["Head.1"], up, r.look * 0.5);
  turnW(r.j["Jaw.1"], right, r.jaw * 0.55);
  r.jaw = Math.max(0, r.jaw - dt * 2);
  r.look *= Math.exp(-dt * 2);
}
const mouth = (h: RosterHero) => h.rig.atCached("Head").add(h.fwd().scale(0.7)).subtract(V(0, 0.15, 0));
/** the plasma blast: a purple bolt out of his mouth that bursts where it lands */
const TT_PLASMA: Move = {
  airborne: true,
  vsAir: true,
  start(h, a) {
    if (!a.tgt) return false;
    a.dur = 1;
    h.host.audio.play("repulsorCharge", { x: h.p.x, y: h.p.y + 1, z: h.p.z, volume: 0.6, rate: 1.8 });
  },
  frame(h, a, dt) {
    const t = a.tgt;
    if (!t || !h.tgtAlive(t)) return a.n > 0;
    const aim = h.aimOf(t);
    h.turnTo(Math.atan2(aim.x - h.p.x, aim.z - h.p.z), dt, 4);
    const r = ttRig(h);
    if (r) r.jaw = Math.min(1, a.t / 0.3);
    if (a.t < 0.4) {
      if (Math.random() < 0.7) h.host.glow.emit(mouth(h), V(rnd(-0.3, 0.3), rnd(-0.3, 0.3), rnd(-0.3, 0.3)), 0.2, 0.3, 1, new Color3(0.9, 0.85, 1), PLASMA, 0.9, 2, 0);
      return;
    }
    if (a.n > 0) return;
    a.n = 1;
    const from = mouth(h);
    const blocked = h.host.nav.rayLevel(from, aim);
    const end = blocked >= 0 ? from.add(aim.subtract(from).normalize().scale(blocked)) : aim;
    h.host.audio.play("rocketWhoosh", { x: from.x, y: from.y, z: from.z, volume: 0.9, rate: 1.5 });
    const dmg = h.book.def("plasma")?.damage ?? 35;
    h.host.bolts.fire(from, end, 60, new Color3(0.9, 0.85, 1), PLASMA, 2.8, () => {
      h.host.blast(end, 3.5, dmg);
      h.host.rings.boom(end, V(0, 1, 0), 6);
      for (let k = 0; k < 10; k++) h.host.glow.emit(end, V(rnd(-4, 4), rnd(0, 4), rnd(-4, 4)), 0.4, 0.5, 2, new Color3(0.9, 0.85, 1), PLASMA2, 1, 3, 0);
    });
  },
  pose(_h, _a, want) {
    copyPose(TT_REST, want);
    return 10;
  },
};
const TT_DIVE: Move = ((m: Move) => ({ ...m, airborne: true }))(dashMove("dive", {
  speed: 30, reach: 2.4, launch: 14, up: 6, fly: true, vsAir: true, sound: "rocketWhoosh",
  pose: (_h, _a, want) => copyPose(TT_REST, want),
  trail: (h) => {
    if (Math.random() < 0.6) h.host.glow.emit(mouth(h), V(), 0.2, 0.25, 0, new Color3(0.9, 0.85, 1), PLASMA, 0.7, 0, 0);
  },
  // (pulling out of the dive: a plasma burst into the ground where he came down)
  afterHit: (h) => {
    const at = h.p.clone();
    h.host.blast(at, 5, h.book.def("dive")?.damage ?? 50);
    h.host.rings.boom(at, V(0, 1, 0), 10);
    h.v.set(0, 12, 0);
  },
}));
/** close in: the tail whipped round at whatever's beside him */
const TT_TAIL: Move = {
  airborne: true,
  start(_h, a) {
    a.dur = 0.9;
  },
  frame(h, a, dt) {
    h.yaw += dt * (a.t < 0.6 ? 10 : 0);
    if (a.t > 0.35 && a.n === 0) {
      a.n = 1;
      for (const x of h.around(h.p, 3.6)) h.hit(x, h.book.def("bite")?.damage ?? 18, flat(h.tgtGround(x).subtract(h.p)).add(V(0, 0.01, 0)), { force: 2, launch: 10, up: 4 });
      h.host.audio.play("swingWhoosh", { x: h.p.x, y: h.p.y + 1, z: h.p.z, volume: 0.8, rate: 0.8 });
    }
  },
  pose(_h, _a, want) {
    copyPose(TT_REST, want);
    return 10;
  },
};
const TT_ENTRANCE: Entrance = {
  dur: 7,
  begin(h) {
    const at = spotNear(h, 6, 11);
    if (!at) return false;
    const e = h as { _land?: Vector3; _beat?: number };
    e._land = at.clone();
    e._beat = 0;
    h.p.copyFrom(at.add(V(0, 40, 0)));
    faceYou(h);
    return true;
  },
  frame(h, t, dt) {
    // a black shape against the sky, spiralling down on beating wings — he lands beside you, folds
    // his wings, looks round at the fight, and the screech
    const e = h as { _land?: Vector3; _beat?: number };
    const land = e._land!;
    const r = ttRig(h);
    if (t < 3.6) {
      const k = t / 3.6;
      const ang = k * Math.PI * 2.2, rad = 14 * (1 - k);
      h.p.set(land.x + Math.sin(ang) * rad, land.y + 40 * (1 - k) * (1 - k) + 0.2, land.z + Math.cos(ang) * rad);
      h.yaw = ang + Math.PI / 2;
      h.v.set(Math.cos(ang), -1, -Math.sin(ang));
      h.pitch = 0.15;
    } else {
      h.p.copyFrom(land);
      h.v.setAll(0);
      h.pitch = 0;
      const tr = trouble(h);
      if (tr && t > 4.4) {
        h.turnTo(Math.atan2(tr.x - h.p.x, tr.z - h.p.z), dt, 2);
        if (r) r.look = Math.sin((t - 4.4) * 3) * 0.6;
      } else faceYou(h);
    }
    if ((e._beat ?? 0) < 1 && t > 3.6) {
      e._beat = 1;
      h.host.dust(land, 0.6);
      h.host.audio.play("land", { x: land.x, y: land.y, z: land.z, volume: 0.8, rate: 0.8 });
    }
    if ((e._beat ?? 0) < 2 && t > 5.4) {
      e._beat = 2;
      if (r) r.jaw = 1;
      h.host.audio.play("hulkRoar", { x: land.x, y: land.y + 1, z: land.z, volume: 0.7, rate: 2.4 });
    }
  },
  pose(_h, _t, want) {
    copyPose(TT_REST, want);
    return 8;
  },
  shot(h, t) {
    const land = (h as { _land?: Vector3 })._land ?? h.p;
    const toYou = flat(h.host.player.feet.subtract(land)).normalize();
    if (t < 3.6) return { pos: land.add(toYou.scale(9)).addInPlaceFromFloats(0, 1.2, 0), target: h.p.add(V(0, 1, 0)), fov: 0.95, cut: t < 0.03 };
    return orbit(h, 0.7, 9, 1, 0.8, t < 3.63, 0.9);
  },
};
export const TOOTHLESS: Kit = {
  id: "toothless", color: "#25262e", label: "TL",
  flyer: true,
  run: 16, sprint: 26,
  prefer: ["dive", "plasma", "bite"],
  holdRange: 12,
  stance: TT_REST,
  idle: TT_REST,
  landing: TT_REST,
  rig: TOOTHLESS_RIG,
  // (on the ground his legs stride in ttAnimate: the poses just hold the rest)
  gait: (_h, _speed, _dt, want) => {
    copyPose(TT_REST, want);
    return 10;
  },
  moves: { plasma: TT_PLASMA, dive: TT_DIVE, bite: TT_TAIL },
  dodge: TT_TAIL,
  entrance: TT_ENTRANCE,
  lines: { hit: [], down: [], up: [], victory: [], fight: [] },
  tune(m) {
    // (his skin is a black colour with no texture: a hair off black, or it doesn't draw at all)
    if (m.albedoColor.r + m.albedoColor.g + m.albedoColor.b < 0.01) m.albedoColor = new Color3(0.05, 0.05, 0.06);
  },
  setup(h) {
    // the rest pose, read off the rig as it stands: what the poses hold him to
    const rig = h.rig;
    rig.anchor.position.setAll(0);
    rig.anchor.rotationQuaternion!.set(0, 0, 0, 1);
    rig.anchor.computeWorldMatrix(true);
    const PAIRS_N: [string, string][] = [
      ["Hips", "Spine1"], ["Spine", "Spine1"], ["Spine1", "Spine2"], ["Spine2", "Neck"], ["Neck", "Head"], ["Head", "HeadTop_End"],
      ["LeftArm", "LeftForeArm"], ["LeftForeArm", "LeftHand"], ["LeftHand", "LeftHandMiddle1"],
      ["RightArm", "RightForeArm"], ["RightForeArm", "RightHand"], ["RightHand", "RightHandMiddle1"],
      ["LeftUpLeg", "LeftLeg"], ["LeftLeg", "LeftFoot"], ["LeftFoot", "LeftToeBase"],
      ["RightUpLeg", "RightLeg"], ["RightLeg", "RightFoot"], ["RightFoot", "RightToeBase"],
    ];
    PAIRS_N.forEach(([a, b], k) => {
      const d = rig.at(b).subtract(rig.at(a)).normalize();
      TT_REST.d[k] = [d.x, d.y, d.z];
    });
    const hp = rig.at("Hips");
    TT_REST.hip = [hp.x / rig.hipH, hp.y / rig.hipH, hp.z / rig.hipH];
    // the joints he moves with, at rest
    const j: Record<string, TTJoint> = {};
    const names = ["Head.1", "Jaw.1"];
    for (const S of ["L", "R"]) names.push(...["WingShoulder.", "WingElbow.", "WingForeArm.", "Shoulder.", "Elbow.", "Thigh.", "Knee."].map((n) => n + S));
    for (const n of names) {
      const node = rig.node(n);
      if (!node) continue;
      if (!node.rotationQuaternion) node.rotationQuaternion = Quaternion.FromEulerVector(node.rotation);
      j[n] = { n: node, q: node.rotationQuaternion.clone() };
      rig.unloose(node);
    }
    const tail: TTJoint[] = [];
    for (const n of ["Tail.1", "TailBendy.1", "TailBendy.002", "TailBendy.003", "Tail.3", "Tail.4", "Tail.005"]) {
      const node = rig.node(n);
      if (!node) continue;
      if (!node.rotationQuaternion) node.rotationQuaternion = Quaternion.FromEulerVector(node.rotation);
      tail.push({ n: node, q: node.rotationQuaternion.clone() });
    }
    (h as { _tt?: TTRig })._tt = { j, tail, flap: 0, walk: 0, jaw: 0, look: 0, tuck: 1 };
  },
  after(h, dt) {
    ttAnimate(h, dt);
  },
};


// ================================================================== ANT-MAN
const PYM = new Color3(1, 0.25, 0.2);
const PYM2 = new Color3(0.3, 0.5, 1);
/** his size now and where it's going (1 a man; 0.1 an ant's-eye; 3.2 Giant-Man) */
interface AntSize { k: number; want: number; giantT: number; small: boolean }
function antSize(h: RosterHero) {
  return ((h as { _size?: AntSize })._size ??= { k: 1, want: 1, giantT: 0, small: false });
}
/** the size change: the body, and what goes with it — how hard he is to hit, how hard he hits */
function antScale(h: RosterHero, dt: number) {
  const z = antSize(h);
  // (knocked out, or out of a move that shrank him: back to his own size)
  if (h.mode === "ko" || (!h.action && z.want < 1 && h.introT < 0)) z.want = z.giantT > 0 && h.mode !== "ko" ? 3.2 : 1;
  if (z.giantT > 0 && (z.giantT -= dt) <= 0) {
    z.want = 1;
    h.say("Okay — that's all the Pym Particles I've got.", 2.2);
  }
  const prev = z.k;
  z.k += (z.want - z.k) * Math.min(1, dt * 7);
  if (Math.abs(z.want - z.k) < 0.005) z.k = z.want;
  h.rig.anchor.scaling.setAll(z.k);
  // (tiny: next to impossible to hit; giant: a wall of a man who hits like one)
  h.guard = z.k < 0.5 ? 0.15 : z.k > 2 ? 0.6 : 1;
  h.power = z.k > 2 ? 1.8 : z.k < 0.5 ? 1.4 : 1;
  // (a size change: a puff of red-and-blue particles)
  if (Math.abs(z.k - prev) > 0.02 && Math.random() < 0.8) h.host.glow.emit(h.center(), V(rnd(-1, 1), rnd(0, 1.5), rnd(-1, 1)), 0.3, 0.2 * z.k + 0.05, 1, PYM, PYM2, 0.9, 2, 0);
}
/** shrink, run in under their guard, and come back up to size inside it — the blow at full size */
const ANT_SHRINK: Move = {
  moves: true,
  start(h, a) {
    // (not as Giant-Man: he stays big till it wears off)
    if (!a.tgt || antSize(h).giantT > 0) return false;
    a.dur = 1.8;
    antSize(h).want = 0.1;
    h.host.audio.play("smokePop", { x: h.p.x, y: h.p.y + 1, z: h.p.z, volume: 0.6, rate: 1.8 });
  },
  frame(h, a, dt) {
    const t = a.tgt;
    if (!t || !h.tgtAlive(t)) {
      antSize(h).want = 1;
      return true;
    }
    const at = h.tgtGround(t);
    const d = Vector3.Distance(flat(at), flat(h.p));
    if (a.n === 0) {
      // (an ant at a sprint: 16 m/s along the ground)
      const dir = flat(at.subtract(h.p)).normalize();
      h.yaw = Math.atan2(dir.x, dir.z);
      const step = Math.min(d, 16 * dt);
      h.stepTo(h.p.x + dir.x * step, h.p.z + dir.z * step);
      h.v.copyFrom(dir.scale(16));
      if (d < 1.2 + 0.4 * h.sizeOf(t) || a.t > 1.3) {
        a.n = 1;
        antSize(h).want = 1;
        h.hit(t, h.book.def("shrink")?.damage ?? 30, at.subtract(h.p).add(V(0, 0.5, 0)), { force: 3, launch: 12, up: 7 });
        h.host.audio.play("superPunch", { x: at.x, y: at.y + 1, z: at.z, volume: 0.9, rate: 1.2 });
        h.host.spark(h.aimOf(t), V(0, -1, 0));
      }
    } else h.v.setAll(0);
  },
  pose(h, a, want) {
    if (a.n === 0) {
      (h as { _ph?: number })._ph = ((h as { _ph?: number })._ph ?? 0) + 0.1;
      sample(h.clips.sprint, (h as { _ph?: number })._ph!, true, want);
      return 30;
    }
    sample(h.clips.hook, 0.35, false, want);
    return 30;
  },
};
const ANT_GIANT: Move = {
  start(h, a) {
    if (antSize(h).giantT > 0) return false;
    a.dur = 1.4;
    h.say("Going big!", 1.8);
    h.host.audio.play("repulsorCharge", { x: h.p.x, y: h.p.y + 1, z: h.p.z, volume: 0.9, rate: 0.5 });
  },
  frame(h, a) {
    if (a.t > 0.3 && a.n === 0) {
      a.n = 1;
      const z = antSize(h);
      z.want = 3.2;
      z.giantT = 14;
      h.host.player.shake(0.3);
    }
  },
  pose(_h, _a, want) {
    copyPose(STANCE, want);
    return 10;
  },
};
/** Giant-Man's stomp (only while he's giant) */
const ANT_STOMP = ((m: Move): Move => ({ ...m, start: (h, a) => (antSize(h).k < 2 ? false : m.start(h, a)) }))(
  slamMove("stomp", { wind: 0.7, radius: 6, at: "self", color: new Color3(1, 0.5, 0.3), launch: 14, pose: (h, a, want) => sample(h.clips.mmaKick3, a.t * 0.8, false, want) }),
);
const ANT_ENTRANCE: Entrance = {
  dur: 4.8,
  begin(h) {
    const at = spotNear(h, 3, 5, false);
    if (!at) return false;
    const e = h as { _land?: Vector3; _beat?: number };
    e._land = at.clone();
    e._beat = 0;
    h.p.copyFrom(at);
    faceYou(h);
    const z = antSize(h);
    z.k = z.want = 0.06;
    return true;
  },
  frame(h, t, dt) {
    // right by your boot: something no bigger than a beetle, with a red glint — then he's full size,
    // straightening up, rolling his shoulders
    const e = h as { _land?: Vector3; _beat?: number };
    const z = antSize(h);
    if (t < 1.6) {
      z.want = 0.06;
      if (dt < 0.095 && Math.random() < 0.4) h.host.glow.emit(h.p.add(V(0, 0.08, 0)), V(), 0.15, 0.06, 0, PYM, PYM, 0.9, 0, 0);
    } else z.want = 1;
    antScale(h, dt);
    if ((e._beat ?? 0) < 1 && t > 1.6) {
      e._beat = 1;
      h.host.audio.play("smokePop", { x: h.p.x, y: h.p.y + 1, z: h.p.z, volume: 0.9, rate: 0.8 });
      h.host.dust(h.p.clone(), 0.3);
    }
    if ((e._beat ?? 0) < 2 && t > 2.6) {
      e._beat = 2;
      h.say("Hey! Down here! …okay, up here now.", 2.6);
    }
    if (t >= this.dur - 0.05) {
      z.k = z.want = 1;
      h.rig.anchor.scaling.setAll(1);
    }
  },
  pose(_h, t, want) {
    copyPose(STANCE, want);
    if (t > 2.4 && t < 3.6) {
      want.d[P.lArm] = normD([-0.6, 0.2, 0.2]);
      want.d[P.rArm] = normD([0.6, 0.2, 0.2]);
    }
    return 10;
  },
  shot(h, t) {
    const land = (h as { _land?: Vector3 })._land ?? h.p;
    const toYou = flat(h.host.player.feet.subtract(land)).normalize();
    const side = V(toYou.z, 0, -toYou.x);
    if (t < 1.7) return { pos: land.add(toYou.scale(0.7)).add(side.scale(0.2)).addInPlaceFromFloats(0, 0.12, 0), target: land.add(V(0, 0.06, 0)), fov: 0.7, cut: t < 0.03 };
    return { pos: land.add(toYou.scale(3)).add(side.scale(0.8)).addInPlaceFromFloats(0, 0.9, 0), target: land.add(V(0, 1, 0)), fov: 0.8, cut: t < 1.73 };
  },
};
export const ANTMAN: Kit = {
  id: "antman", color: "#c4302b", label: "AM",
  run: 7, sprint: 9.5,
  prefer: ["giant", "stomp", "shrink", "combo"],
  holdRange: 2.4,
  stance: STANCE,
  landing: STANCE,
  // (the file has no skeleton: one is made for him when it loads — characters/autoSkin.ts)
  rig: { ...AUTO, prep: autoSkin },
  moves: {
    combo: comboMove("combo", [{ clip: "combo", speed: 1.15, hits: [0.12, 0.32, 0.56, 0.79] }, { clip: "hook", speed: 1.1, hits: [0.29] }, { clip: "kick", speed: 1.1, hits: [0.4] }], 2.4, { launch: 8, up: 4 }),
    shrink: ANT_SHRINK,
    giant: ANT_GIANT,
    stomp: ANT_STOMP,
  },
  entrance: ANT_ENTRANCE,
  lines: {
    intro: "Hey! Down here! …okay, up here now.",
    hit: ["Ow. Ow ow ow.", "Still standing!"],
    down: ["I'm okay… mostly."],
    up: ["Back up — literally.", "Ant-Man's back."],
    victory: ["Small guy, big win."],
    fight: ["Going small!", "Ants! Ants, anybody?", "Big things come in small packages."],
  },
  after(h, dt) {
    if (h.introT < 0) antScale(h, dt);
  },
};

export const KITS2: Record<string, Kit> = { strange: STRANGE, ironhide: IRONHIDE, surfer: SURFER, torch: TORCH, fantastic: FANTASTIC, toothless: TOOTHLESS, antman: ANTMAN };
export type { Pose, Act };
