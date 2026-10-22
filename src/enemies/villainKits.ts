import { Color3 } from "@babylonjs/core/Maths/math.color";
import { PBRMaterial } from "@babylonjs/core/Materials/PBR/pbrMaterial";
import { Vector3 } from "@babylonjs/core/Maths/math.vector";
import { BeamFx } from "../fx/SuperFx";
import { armAt, faceYou, orbit, seat, spotNear, trouble } from "../allies/kits";
import { pose, type Pose } from "../allies/SpiderPoses";
import {
  HIT, P, V, clipDur, clipOf, comboMove, copyPose, flat, mixPose, naturalArms, normD, pick, rnd, sample, shootMove,
  type Act, type Entrance, type Kit, type Move, type RosterHero, type Tgt,
} from "../allies/RosterHero";
import type { HulkThreat } from "./Hulk";

/**
 * The Phase-3 villains, each a kit for RosterVillain: Ultron, Ronan, the Joker, Darkseid, Doctor
 * Doom — their poses, moves (the roster's abilities, against you and the heroes), boss-phase moves,
 * entrances and lines (subtitles only — no voice files). Every move that hurts says so in advance
 * (`threat`): the heroes read it and get out of the way, the way they do the Hulk's blows.
 */

// ------------------------------------------------------------------ shared villain moves
/** darker models (Ultron's armour, Darkseid's stone skin) read in the snow light */
export function brighten(k: number) {
  return (m: PBRMaterial) => {
    m.environmentIntensity = 1.15 * k;
    if (m.metallic !== null && m.metallic !== undefined) m.metallic = Math.min(m.metallic, 0.55);
    if (m.roughness !== null && m.roughness !== undefined) m.roughness = Math.max(m.roughness, 0.35);
    m.albedoColor = m.albedoColor.scale(k);
  };
}
/** a beam held on the target (from the hands, the eyes or a staff's head) */
export function beamMove(id: string, o: { from: (h: RosterHero) => Vector3; core: Color3; sheath: Color3; width: number; dur: number; wind: number; sound: string; airborne?: boolean; pose: (h: RosterHero, a: Act, want: Pose) => void }): Move {
  let fx: BeamFx | null = null;
  return {
    airborne: o.airborne,
    start(h, a) {
      if (!a.tgt) return false;
      fx ??= new BeamFx(h.host.scene, { name: "beam_" + id, core: o.core, sheath: o.sheath, width: o.width, glow0: o.core, glow1: o.sheath });
      a.dur = o.wind + o.dur;
      h.host.audio.play(o.sound, { x: h.p.x, y: h.p.y + 1.5, z: h.p.z, volume: 0.9 });
    },
    threat(h, a) {
      if (!a.tgt || a.t > o.wind) return null;
      const at = h.tgtGround(a.tgt);
      return { kind: "throw", at, dir: flat(at.subtract(h.p)).normalize(), radius: 1.8, cone: Math.PI, t: o.wind - a.t, target: "hero" in a.tgt ? a.tgt.hero : null };
    },
    frame(h, a, dt) {
      const t = a.tgt!;
      if (!h.tgtAlive(t)) {
        fx?.off();
        return true;
      }
      const aim = h.aimOf(t);
      h.turnTo(Math.atan2(aim.x - h.p.x, aim.z - h.p.z), dt, a.t < o.wind ? 5 : 1.6);
      if (a.t < o.wind) {
        if (Math.random() < 0.6) h.host.glow.emit(o.from(h), V(rnd(-0.4, 0.4), rnd(-0.4, 0.4), rnd(-0.4, 0.4)), 0.2, 0.25, 1, o.core, o.sheath, 0.9, 2, 0);
        return;
      }
      // (it lags a little behind a moving target: a beam you can run out of)
      const from = o.from(h);
      const lead = (a.data.aim as Vector3 | undefined) ?? aim.clone();
      Vector3.LerpToRef(lead, aim, Math.min(1, dt * 3), lead);
      a.data.aim = lead;
      const blocked = h.host.nav.rayLevel(from, lead);
      const end = blocked >= 0 ? from.add(lead.subtract(from).normalize().scale(blocked)) : lead;
      fx!.set(0, from, end);
      fx!.update(dt);
      a.data.acc = ((a.data.acc as number) ?? 0) + dt;
      if ((a.data.acc as number) > 0.25) {
        a.data.acc = 0;
        const dmg = (h.book.def(id)?.damage ?? 40) * 0.25;
        for (const x of h.around(end, 1.3)) h.hit(x, dmg, end.subtract(from), { kind: "blast" });
      }
      if (a.t > a.dur - 0.05) fx!.off();
    },
    pose(h, a, want) {
      o.pose(h, a, want);
      return 18;
    },
    stop() {
      fx?.off();
    },
  } as Move;
}
/** wind up, then slam: a ring of force round the point (him, or the target) */
export function slamMove(id: string, o: { wind: number; radius: number; at: "self" | "target"; clip?: string; clipSpeed?: number; color: Color3; launch: number; pose?: (h: RosterHero, a: Act, want: Pose) => void; after?: (h: RosterHero, at: Vector3) => void }): Move {
  return {
    start(h, a) {
      a.dur = o.wind + 0.7;
      a.data.at = o.at === "target" && a.tgt ? h.tgtGround(a.tgt) : h.p.clone();
      if (o.clip) a.dur = Math.max(a.dur, clipDur(clipOf(h, o.clip)) / (o.clipSpeed ?? 1));
      if (a.tgt) h.faceTo(h.tgtGround(a.tgt));
    },
    threat(h, a): HulkThreat | null {
      if (a.n > 0) return null;
      return { kind: "smash", at: (a.data.at as Vector3).clone(), dir: h.fwd(), radius: o.radius, cone: Math.PI, t: Math.max(0, o.wind - a.t), target: a.tgt && "hero" in a.tgt ? a.tgt.hero : null };
    },
    frame(h, a) {
      const at = a.data.at as Vector3;
      if (a.t < o.wind) {
        // (the warning: a glowing ring forming on the ground where it'll land)
        if (Math.random() < 0.5) {
          const ang = rnd(0, Math.PI * 2);
          h.host.glow.emit(at.add(V(Math.sin(ang) * o.radius, 0.1, Math.cos(ang) * o.radius)), V(0, 0.6, 0), 0.4, 0.4, 0.5, o.color, o.color, 0.7, 1, 0);
        }
        return;
      }
      if (a.n > 0) return;
      a.n = 1;
      h.host.slam(at.clone(), Math.min(1.4, o.radius / 6));
      h.host.rings.boom(at.add(V(0, 0.2, 0)), V(0, 1, 0), o.radius * 2);
      h.host.audio.play("hulkSlam", { x: at.x, y: at.y, z: at.z, volume: 1, rate: 0.85 });
      h.host.player.shake(Math.max(0.1, 0.6 - Vector3.Distance(at, h.host.player.feet) / 40));
      const dmg = h.book.def(id)?.damage ?? 50;
      for (const x of h.around(at, o.radius)) {
        const g = h.tgtGround(x);
        const k = 1 - Math.min(1, Vector3.Distance(g, at) / o.radius);
        h.hit(x, dmg * (0.45 + 0.55 * k), g.subtract(at).add(V(0, 0.01, 0)), { force: 3, launch: o.launch * (0.4 + 0.6 * k), up: 4 });
      }
      o.after?.(h, at);
    },
    pose(h, a, want) {
      if (o.clip) sample(clipOf(h, o.clip), a.t * (o.clipSpeed ?? 1), false, want);
      else if (o.pose) o.pose(h, a, want);
      else copyPose(h.kit.stance, want);
      return 20;
    },
  };
}
/** a shield round him: blows do a fraction for a while (sparks of his colour on it) */
export function guardMove(o: { guard: number; secs: number; color: Color3; airborne?: boolean; line?: string }): Move {
  return {
    airborne: o.airborne,
    start(h, a) {
      a.dur = 0.8;
      h.guard = o.guard;
      (h as { _guardT?: number })._guardT = o.secs;
      h.host.audio.play("repulsorCharge", { x: h.p.x, y: h.p.y + 1, z: h.p.z, volume: 0.8, rate: 0.7 });
      if (o.line) h.say(o.line, 2);
    },
    frame() {},
    pose(h, _a, want) {
      copyPose(h.kit.stance, want);
      want.d[P.lArm] = normD([-0.85, -0.2, 0.5]);
      want.d[P.rArm] = normD([0.85, -0.2, 0.5]);
      return 14;
    },
  };
}
/** each frame: a guard wears off, and while it's up, it shows */
export function guardTick(h: RosterHero, dt: number, color: Color3) {
  const g = h as { _guardT?: number };
  if (!g._guardT) return;
  g._guardT -= dt;
  if (Math.random() < dt * 40) {
    const d = V(rnd(-1, 1), rnd(-0.6, 1), rnd(-1, 1)).normalize();
    h.host.glow.emit(h.center().add(d.scale(h.def.height * 0.45)), d.scale(0.2), 0.3, 0.3, 0.2, color, color, 0.55, 1, 0);
  }
  if (g._guardT <= 0) {
    g._guardT = 0;
    h.guard = 1;
  }
}
/** the entrance pieces every villain shares: where (in front of you), facing you */
export function placeNear(h: RosterHero, min: number, max: number, sky = false) {
  const at = spotNear(h, min, max, sky);
  if (!at) return null;
  h.p.copyFrom(at);
  faceYou(h);
  return at;
}
const RED = new Color3(1, 0.18, 0.1);
const RED2 = new Color3(1, 0.55, 0.35);

// ================================================================== ULTRON
const ULTRON_HOVER = pose(
  {
    hips: [0, 1, 0], spine: [0, 1, 0.03], spine1: [0, 1, 0.04], spine2: [0, 1, 0.02], neck: [0, 1, 0.08], head: [0, 0.97, 0.2],
    lArm: [-0.45, -0.88, 0.15], lFore: [-0.3, -0.85, 0.42], lHand: [-0.25, -0.8, 0.55],
    lThigh: [-0.06, -1, 0.05], lShin: [0, -1, -0.12], lFoot: [0, -0.85, 0.5],
    rThigh: [0.06, -1, 0.02], rShin: [0, -1, -0.18], rFoot: [0, -0.85, 0.5],
  },
  [0, 1, 0],
);
/** the drones: three red orbs round him for a while, each taking shots */
function ultronDrones(h: RosterHero, dt: number) {
  const D = h as { _drones?: { t: number; fire: number } };
  if (!D._drones || D._drones.t <= 0) return;
  D._drones.t -= dt;
  D._drones.fire -= dt;
  const c = h.center().add(V(0, 0.6, 0));
  for (let i = 0; i < 3; i++) {
    const a = h.time * 2.4 + (i * Math.PI * 2) / 3;
    const p = c.add(V(Math.sin(a) * 1.6, Math.sin(h.time * 3 + i) * 0.3, Math.cos(a) * 1.6));
    h.host.glow.emit(p, V(), 0.06, 0.3, 0, RED2, RED, 0.95, 0, 0);
    if (D._drones.fire <= 0 && i === Math.floor(h.time * 7) % 3) {
      const near = h.around(p, 28);
      const x = near.length ? pick(near) : null;
      if (x) {
        const aim = h.aimOf(x);
        h.host.bolts.fire(p, aim, 60, RED2, RED, 0.8, () => h.alive && h.tgtAlive(x) && h.hit(x, 7, aim.subtract(p), { kind: "bullet" }));
        h.host.audio.play("repulsorFire", { x: p.x, y: p.y, z: p.z, volume: 0.35, rate: 2 });
      }
    }
  }
  if (D._drones.fire <= 0) D._drones.fire = 0.45;
}
const ULTRON_ENTRANCE: Entrance = {
  dur: 5.6,
  begin(h) {
    const at = placeNear(h, 9, 16, true);
    if (!at) return false;
    (h as { _at?: Vector3 })._at = at.add(V(0, 2.6, 0));
    h.p.copyFrom((h as { _at?: Vector3 })._at!);
    h.pitch = h.roll = 0;
    return true;
  },
  frame(h, t, dt) {
    // red sparks from everywhere, pulled to one point — and he's made of them
    const at = (h as { _at?: Vector3 })._at!;
    h.p.copyFrom(at);
    const c = at.add(V(0, h.def.height * 0.5, 0));
    if (t < 2.2) for (let k = 0; k < 6; k++) {
      const d = V(rnd(-1, 1), rnd(-0.3, 1), rnd(-1, 1)).normalize().scale(rnd(6, 14));
      h.host.glow.emit(c.add(d), d.scale(-1 / 0.5), 0.5, 0.18, 0, RED2, RED, 0.9, 0, 0);
    }
    if (t > 2.2 && !(h as { _flash?: boolean })._flash) {
      (h as { _flash?: boolean })._flash = true;
      h.host.rings.boom(c, V(0, 1, 0), 10);
      h.host.audio.play("unibeam", { x: c.x, y: c.y, z: c.z, volume: 1, rate: 0.6 });
      h.host.player.shake(0.3);
    }
    if (t > 3.2 && !(h as { _said?: boolean })._said) {
      (h as { _said?: boolean })._said = true;
      h.say("I've seen your future. It's empty.", 2.8);
    }
    if (t > 4) h.turnTo(Math.atan2(h.host.player.feet.x - h.p.x, h.host.player.feet.z - h.p.z), dt, 2);
    if (t > this.dur - 0.05) (h as { _flash?: boolean; _said?: boolean })._flash = (h as { _said?: boolean })._said = false;
  },
  pose(h, t, want) {
    h.rig.setVisible(t >= 2.2);
    copyPose(ULTRON_HOVER, want);
    if (t > 2.2 && t < 3.2) {
      want.d[P.lArm] = normD([-0.95, 0.2, 0.1]);
      want.d[P.rArm] = normD([0.95, 0.2, 0.1]);
    }
    return t < 2.3 ? 60 : 8;
  },
  shot(h, t) {
    const at = (h as { _at?: Vector3 })._at ?? h.p;
    if (t < 2.2) return { pos: at.add(h.fwd().scale(9)).addInPlaceFromFloats(0, 0.5, 0), target: at.add(V(0, 1, 0)), fov: 0.85, cut: t < 0.03 };
    return orbit(h, 0.4 - (t - 2.2) * 0.1, 3.6, 0.2, 0.72, t < 2.23);
  },
};
export const ULTRON: Kit = {
  id: "ultron", color: "#d23a2a", label: "UL",
  flyer: true,
  run: 10, sprint: 16,
  prefer: ["drones", "shield", "beam", "bolt"],
  holdRange: 11,
  stance: ULTRON_HOVER,
  idle: ULTRON_HOVER,
  landing: ULTRON_HOVER,
  rival: "ironman",
  tune: brighten(1.8),
  moves: {
    bolt: shootMove("bolt", { hands: "both", shots: 4, every: 0.2, speed: 65, core: RED2, glow: RED, size: 1.4, sound: "repulsorFire", rate: 0.9, airborne: true }),
    beam: beamMove("beam", {
      from: (h) => h.hand("r").add(h.hand("l")).scale(0.5), core: new Color3(1, 0.85, 0.8), sheath: RED, width: 2.2, dur: 2, wind: 0.6, sound: "unibeam", airborne: true,
      pose: (h, a, want) => {
        copyPose(ULTRON_HOVER, want);
        if (a.tgt) {
          armAt(h, want, "l", h.aimOf(a.tgt));
          armAt(h, want, "r", h.aimOf(a.tgt));
        }
      },
    }),
    shield: guardMove({ guard: 0.3, secs: 6, color: RED, airborne: true, line: "Armour hardened." }),
    drones: {
      airborne: true,
      start(h, a) {
        a.dur = 1;
        (h as { _drones?: { t: number; fire: number } })._drones = { t: 9, fire: 0.8 };
        h.say("Say hello to my children.", 2);
      },
      frame() {},
      pose(_h, _a, want) {
        copyPose(ULTRON_HOVER, want);
        want.d[P.lArm] = normD([-0.9, 0.35, 0.2]);
        want.d[P.rArm] = normD([0.9, 0.35, 0.2]);
        return 12;
      },
    },
  },
  phaseMove: slamMove("phase", {
    wind: 1.1, radius: 7, at: "self", color: RED, launch: 12,
    pose: (_h, a, want) => {
      copyPose(ULTRON_HOVER, want);
      const up = Math.min(1, a.t / 1);
      want.d[P.lArm] = normD([-0.9, 0.4 * up, 0.1]);
      want.d[P.rArm] = normD([0.9, 0.4 * up, 0.1]);
    },
    after: (h) => h.say("Upgrade complete.", 2.4),
  }),
  entrance: ULTRON_ENTRANCE,
  lines: {
    intro: "I've seen your future. It's empty.",
    hit: ["Irrelevant.", "Is that the best you have?"],
    down: ["This… isn't… the end…"],
    up: [],
    victory: [],
    fight: ["Obsolete.", "You're all puppets.", "Peace in our time."],
  },
  after(h, dt) {
    ultronDrones(h, dt);
    guardTick(h, dt, RED);
  },
};

// ================================================================== RONAN
const PURPLE = new Color3(0.7, 0.3, 1);
const RONAN_STANCE = pose(
  {
    hips: [0, 1, 0.04], spine: [0, 1, 0.08], spine1: [0, 1, 0.08], spine2: [0, 1, 0.05], neck: [0, 1, 0.08], head: [0, 0.98, 0.12],
    // the Universal Weapon upright in his right fist, the left arm down
    // (out at his side, so the staff stands up beside him, its head by his shoulder — not in his face)
    rArm: [0.6, -0.78, 0.15], rFore: [0.45, -0.15, 0.88], rHand: [0.4, -0.1, 0.9],
    lArm: [-0.3, -0.94, 0.12], lFore: [-0.15, -0.9, 0.35],
    lThigh: [-0.2, -0.97, 0.1], rThigh: [0.22, -0.97, -0.05],
  },
  [0, 0.97, 0],
);
/** both hands up on the staff, high over his head (the slam) */
const RONAN_RAISE = pose(
  {
    hips: [0, 1, -0.05], spine: [0, 1, -0.12], spine1: [0, 1, -0.15], spine2: [0, 1, -0.1], neck: [0, 1, 0], head: [0, 0.97, 0.15],
    rArm: [0.25, 0.95, 0.15], rFore: [0, 1, 0.1], rHand: [0, 1, 0.1],
    lArm: [-0.25, 0.95, 0.15], lFore: [0, 1, 0.1], lHand: [0, 1, 0.1],
    lThigh: [-0.22, -0.95, 0.15], rThigh: [0.22, -0.96, -0.1],
  },
  [0, 0.96, 0],
);
const RONAN_STRIKE = pose(
  {
    hips: [0, 0.9, 0.4], spine: [0, 0.8, 0.6], spine1: [0, 0.75, 0.66], spine2: [0, 0.78, 0.62], neck: [0, 0.9, 0.42], head: [0, 0.95, 0.3],
    rArm: [0.15, -0.3, 0.95], rFore: [0.05, -0.75, 0.66], rHand: [0, -0.8, 0.6],
    lArm: [-0.15, -0.3, 0.95], lFore: [-0.05, -0.75, 0.66], lHand: [0, -0.8, 0.6],
    lThigh: [-0.25, -0.6, 0.76], lShin: [-0.05, -0.95, -0.3], rThigh: [0.25, -0.95, -0.3], rShin: [0.05, -0.7, -0.7],
  },
  [0, 0.75, 0.05],
);
function ronanHead(h: RosterHero) {
  const n = h.rig.node("bip001 prop1");
  if (!n) return h.hand("r").add(V(0, 0.6, 0));
  n.computeWorldMatrix(true);
  // (the head of the staff: +Y along the prop bone, ~6 units out)
  return Vector3.TransformCoordinates(V(0, 6, 0), n.getWorldMatrix());
}
const RONAN_ENTRANCE: Entrance = {
  dur: 6.2,
  begin(h) {
    const land = spotNear(h, 9, 15, false);
    if (!land) return false;
    const away = flat(land.subtract(h.host.player.feet)).normalize();
    (h as { _land?: Vector3 })._land = land.clone();
    (h as { _from?: Vector3 })._from = land.add(away.scale(9));
    h.p.copyFrom((h as { _from?: Vector3 })._from!);
    h.faceTo(land);
    return true;
  },
  frame(h, t, dt) {
    // he marches in out of the snow, stops, and brings the staff down: the ground splits
    const land = (h as { _land?: Vector3 })._land!, from = (h as { _from?: Vector3 })._from!;
    if (t < 3.4) {
      Vector3.LerpToRef(from, land, t / 3.4, h.p);
      h.v.copyFrom(land.subtract(from).scale(1 / 3.4));
      if (Math.random() < dt * 2) h.host.audio.play("hulkStep", { x: h.p.x, y: h.p.y, z: h.p.z, volume: 0.5, rate: 1.2 });
    } else {
      h.v.setAll(0);
      h.p.copyFrom(land);
      faceYou(h);
    }
    if (t > 4.6 && !(h as { _slam?: boolean })._slam) {
      (h as { _slam?: boolean })._slam = true;
      const at = h.p.add(h.fwd().scale(1.6));
      h.host.slam(at, 1);
      h.host.rings.boom(at.add(V(0, 0.2, 0)), V(0, 1, 0), 12);
      h.host.audio.play("hulkSlam", { x: at.x, y: at.y, z: at.z, volume: 1, rate: 0.8 });
      h.host.player.shake(0.45);
      h.say("Kneel before the Accuser.", 2.6);
    }
    if (t > this.dur - 0.05) (h as { _slam?: boolean })._slam = false;
  },
  pose(h, t, want, dt) {
    if (t < 3.4) {
      (h as { _ph?: number })._ph = ((h as { _ph?: number })._ph ?? 0) + dt * (2.6 / 1.25);
      sample(h.clips.walk, (h as { _ph?: number })._ph!, true, want);
      naturalArms(want, 0.1, 0.02);
      want.d[P.rArm] = RONAN_STANCE.d[P.rArm];
      want.d[P.rFore] = RONAN_STANCE.d[P.rFore];
      return 30;
    }
    if (t < 4.4) copyPose(RONAN_RAISE, want);
    else if (t < 5.2) copyPose(RONAN_STRIKE, want);
    else copyPose(RONAN_STANCE, want);
    return t > 4.4 && t < 4.7 ? 30 : 10;
  },
  shot(h, t) {
    const land = (h as { _land?: Vector3 })._land ?? h.p;
    const toYou = flat(h.host.player.feet.subtract(land)).normalize();
    if (t < 3.4) return { pos: land.add(toYou.scale(3)).addInPlaceFromFloats(0, 0.4, 0), target: h.center().add(V(0, 0.4, 0)), fov: 0.85, cut: t < 0.03 };
    return orbit(h, 0.5, 4, 0.3, 0.8, t < 3.43, 1.2);
  },
};
export const RONAN: Kit = {
  id: "ronan", color: "#6b3fa0", label: "RO",
  run: 5, sprint: 7,
  prefer: ["quake", "blast", "swing"],
  holdRange: 2.8,
  stance: RONAN_STANCE,
  landing: RONAN_STRIKE,
  rival: "drax",
  moves: {
    swing: comboMove("swing", [{ clip: "smash", speed: 1, hits: [0.41] }, { clip: "hook", speed: 1.1, hits: [0.29] }], 3.2, { launch: 13, up: 5, force: 3, sound: "superPunch" }),
    quake: slamMove("quake", { wind: 0.85, radius: 8, at: "self", color: PURPLE, launch: 12, pose: (_h, a, want) => copyPose(a.t < 0.85 ? RONAN_RAISE : RONAN_STRIKE, want) }),
    blast: beamMove("blast", {
      from: ronanHead, core: new Color3(0.95, 0.85, 1), sheath: PURPLE, width: 2.6, dur: 1.6, wind: 0.7, sound: "unibeam",
      pose: (h, a, want) => {
        copyPose(RONAN_STANCE, want);
        if (a.tgt) armAt(h, want, "r", h.aimOf(a.tgt).add(V(0, 1.5, 0)));
      },
    }),
  },
  phaseMove: slamMove("phase", { wind: 1.2, radius: 11, at: "self", color: PURPLE, launch: 16, pose: (_h, a, want) => copyPose(a.t < 1.2 ? RONAN_RAISE : RONAN_STRIKE, want), after: (h) => h.say("You dare?!", 2) }),
  entrance: RONAN_ENTRANCE,
  lines: {
    intro: "Kneel before the Accuser.",
    hit: ["Insolence.", "Is that all?"],
    down: ["Impossible…"],
    up: [],
    victory: [],
    fight: ["Your judgement is at hand.", "I will bring you to ruin!", "Fall!"],
  },
  setup(h) {
    // the Universal Weapon hangs off the Biped root (bip001 prop1): re-hung in his right fist,
    // head up — its butt end is at −14, the head from +4.4 to +7.7 along the bone
    const n = h.rig.node("bip001 prop1");
    const hand = h.rig.bone("RightHand");
    if (!n || !hand) return;
    // (seated in the fist where it is now — the rest pose — then held to the hand from its own parent)
    h.rig.unloose(n);
    seat(h, n, "Right", { grip: -9 });
    h.rig.pin(n, "RightHand");
  },
};

// ================================================================== THE JOKER
const GREEN = new Color3(0.45, 1, 0.3);
const JOKER_STANCE = pose(
  {
    hips: [0, 1, 0], spine: [0.05, 1, 0.12], spine1: [0.08, 1, 0.15], spine2: [0.05, 1, 0.1], neck: [-0.1, 1, 0.15], head: [-0.2, 0.95, 0.2],
    // a hand on his hip, the other out, palm up: the showman
    lArm: [-0.55, -0.7, -0.4], lFore: [0.5, -0.5, 0.7], lHand: [0.6, -0.3, 0.7],
    rArm: [0.45, -0.75, 0.48], rFore: [0.35, 0.1, 0.93], rHand: [0.3, 0.3, 0.9],
    lThigh: [-0.15, -0.98, 0.1], rThigh: [0.1, -0.98, -0.05],
  },
  [0, 0.98, 0],
);
/** the bow (his entrance) */
const JOKER_BOW = pose(
  {
    hips: [0, 0.9, 0.42], spine: [0, 0.7, 0.71], spine1: [0, 0.65, 0.76], spine2: [0, 0.7, 0.71], neck: [0, 0.6, 0.8], head: [0, 0.5, 0.86],
    rArm: [0.4, -0.5, 0.77], rFore: [-0.6, -0.3, 0.74],
    lArm: [-0.85, 0.2, -0.5], lFore: [-0.8, 0.4, -0.4],
    lThigh: [-0.1, -0.98, 0.2], rThigh: [0.1, -0.98, -0.1],
  },
  [0, 0.95, 0],
);
function gasCloud(h: RosterHero, at: Vector3, secs: number) {
  const G = h as { _gas?: { at: Vector3; t: number }[] };
  (G._gas ??= []).push({ at: at.clone(), t: secs });
  h.host.audio.play("smokePop", { x: at.x, y: at.y, z: at.z, volume: 0.9, rate: 0.8 });
}
function gasTick(h: RosterHero, dt: number) {
  const G = h as { _gas?: { at: Vector3; t: number; acc?: number }[] };
  if (!G._gas?.length) return;
  for (const g of G._gas) {
    g.t -= dt;
    // (a haze you can see through: a few faint puffs, low to the ground)
    if (Math.random() < dt * 14) h.host.smoke.emit(g.at.add(V(rnd(-2.6, 2.6), rnd(0, 0.9), rnd(-2.6, 2.6))), V(rnd(-0.3, 0.3), rnd(0.05, 0.25), rnd(-0.3, 0.3)), rnd(1.4, 2.2), rnd(0.8, 1.2), 0.5, new Color3(0.4, 0.8, 0.3), new Color3(0.6, 0.85, 0.5), 0.14, 0.6, 0.05);
    g.acc = (g.acc ?? 0) + dt;
    if (g.acc > 0.5) {
      g.acc = 0;
      for (const x of h.around(g.at, 3.2)) h.hit(x, (h.book.def("trap")?.damage ?? 30) * 0.2, V(0, 1, 0), { kind: "blast" });
    }
  }
  G._gas = G._gas.filter((g) => g.t > 0);
}
/** the vanishing act: a burst of green smoke, and he's somewhere else */
const JOKER_SMOKE: Move = {
  start(h, a) {
    a.dur = 0.9;
    a.data.done = false;
    gasCloud(h, h.p, 1.5);
  },
  frame(h, a) {
    if (a.data.done || a.t < 0.35) return;
    a.data.done = true;
    // a nav node 9–15 m away, out of reach of whoever's on him
    const nav = h.host.nav;
    let best: Vector3 | null = null, bs = -Infinity;
    for (let k = 0; k < 40; k++) {
      const n = nav.nodes[Math.floor(Math.random() * nav.nodes.length)];
      const d = Vector3.Distance(n.p, h.p);
      if (d < 9 || d > 15 || Math.abs(n.p.y - h.p.y) > 1.5) continue;
      // (inside the fight's bounds, on a floor: never somewhere nobody can follow)
      const B = h.host.bounds;
      if (n.p.x < B.minX + 3 || n.p.x > B.maxX - 3 || n.p.z < B.minZ + 3 || n.p.z > B.maxZ - 3) continue;
      if (h.host.nav.floorAt(n.p.x, n.p.y + 0.5, n.p.z, 1.5) === null) continue;
      const s = Math.random() - (a.tgt ? Math.abs(Vector3.Distance(n.p, h.tgtGround(a.tgt)) - 12) : 0);
      if (s > bs) (bs = s), (best = n.p);
    }
    if (best) {
      h.p.copyFrom(best);
      gasCloud(h, best, 1.2);
      h.say(pick(["Ha! Missed me!", "Peek-a-boo!", "Over here, sweetheart!"]), 1.8);
    }
  },
  pose(_h, a, want) {
    copyPose(a.t < 0.35 ? JOKER_BOW : JOKER_STANCE, want);
    return 20;
  },
};
const JOKER_ENTRANCE: Entrance = {
  dur: 4.6,
  begin(h) {
    const at = placeNear(h, 6, 11);
    if (!at) return false;
    (h as { _at?: Vector3 })._at = at.clone();
    return true;
  },
  frame(h, t) {
    // a pop of green smoke right by you — and there he is, mid-bow
    const at = (h as { _at?: Vector3 })._at!;
    if (t < 0.1 && !(h as { _pop?: boolean })._pop) {
      (h as { _pop?: boolean })._pop = true;
      gasCloud(h, at, 2.2);
    }
    if (t > 1 && !(h as { _said?: boolean })._said) {
      (h as { _said?: boolean })._said = true;
      h.say("Did somebody order a punchline? HA HA HA!", 3);
    }
    faceYou(h);
    if (t > this.dur - 0.05) (h as { _pop?: boolean; _said?: boolean })._pop = (h as { _said?: boolean })._said = false;
  },
  pose(h, t, want) {
    h.rig.setVisible(t > 0.5);
    copyPose(t < 2.6 ? JOKER_BOW : JOKER_STANCE, want);
    return t < 0.6 ? 60 : 8;
  },
  shot(h, t) {
    return orbit(h, 0.3 + t * 0.08, 3.2, 0.5, 0.75, t < 0.03, 1.1);
  },
};
export const JOKER: Kit = {
  id: "joker", color: "#7b2fa3", label: "JK",
  run: 6, sprint: 8.5,
  prefer: ["smoke", "trap", "decoy", "gun"],
  holdRange: 9,
  stance: JOKER_STANCE,
  landing: JOKER_BOW,
  moves: {
    gun: shootMove("gun", { hands: "r", shots: 3, every: 0.28, speed: 80, core: new Color3(1, 0.9, 0.7), glow: new Color3(0.9, 0.4, 1), size: 0.7, sound: "repulsorFire", rate: 1.8 }),
    trap: {
      start(_h, a) {
        if (!a.tgt) return false;
        a.dur = 0.9;
      },
      threat(h, a) {
        if (!a.tgt || a.n > 0) return null;
        return { kind: "throw", at: h.tgtGround(a.tgt), dir: h.fwd(), radius: 3.2, cone: Math.PI, t: Math.max(0, 0.4 - a.t), target: "hero" in a.tgt ? a.tgt.hero : null };
      },
      frame(h, a) {
        if (a.n > 0 || a.t < 0.4) return;
        a.n = 1;
        const t = a.tgt!;
        const to = h.tgtGround(t).add(V(0, 0.2, 0));
        h.host.bolts.fire(h.hand("r"), to, 16, new Color3(0.7, 1, 0.5), GREEN, 1.4, () => gasCloud(h, to, 4));
        h.quip(["Laughing gas! Get it?", "Smile!"], 0.6);
      },
      pose(h, a, want) {
        copyPose(JOKER_STANCE, want);
        if (a.tgt) armAt(h, want, "r", h.aimOf(a.tgt).add(V(0, 3, 0)));
        return 18;
      },
    },
    smoke: JOKER_SMOKE,
    decoy: comboMove("decoy", [{ clip: "punch", speed: 1.2, hits: [0.35] }], 1.8, {
      launch: 4, up: 2,
      after: (h, _a, last) => {
        if (!last) return;
        const at = h.hand("r");
        h.host.lightning.strike(at, at.add(h.fwd().scale(1)), new Color3(0.8, 0.9, 1), 0.15, 0.4, 0.3, 2);
        h.say("Joy buzzer! Shocking, isn't it?", 1.8);
      },
    }),
  },
  entrance: JOKER_ENTRANCE,
  lines: {
    intro: "Did somebody order a punchline?",
    hit: ["Ow! That tickles!", "Hee hee — again!"],
    down: ["You… people… have no sense of humour…"],
    up: [],
    victory: [],
    fight: ["HA HA HA!", "Let's put a smile on that face!", "This town needs an enema!"],
  },
  after: gasTick,
};

// ================================================================== DARKSEID
const DS_STANCE: Pose = pose({ hips: [0, 1, 0], spine: [0, 1, 0.04], spine1: [0, 1, 0.04], spine2: [0, 1, 0.02], neck: [0, 1, 0.05], head: [0, 0.98, 0.15], lArm: [-0.32, -0.94, 0.1], lFore: [-0.15, -0.95, 0.25], rThigh: [0.2, -0.97, -0.05], lThigh: [-0.2, -0.97, 0.05] }, [0, 0.98, 0]);
function dsEyes(h: RosterHero) {
  return h.rig.at("Head").add(h.fwd().scale(0.12)).addInPlaceFromFloats(0, 0.08, 0);
}
const DS_ENTRANCE: Entrance = {
  dur: 6.6,
  begin(h) {
    const land = spotNear(h, 9, 15, false);
    if (!land) return false;
    (h as { _land?: Vector3 })._land = land.clone();
    const away = flat(land.subtract(h.host.player.feet)).normalize();
    (h as { _tube?: Vector3 })._tube = land.add(away.scale(3.5));
    h.p.copyFrom((h as { _tube?: Vector3 })._tube!);
    h.faceTo(land);
    return true;
  },
  frame(h, t, dt) {
    // the Boom Tube: a ring of white light tears open, thunder, and he walks out of it
    const tube = (h as { _tube?: Vector3 })._tube!, land = (h as { _land?: Vector3 })._land!;
    const c = tube.add(V(0, 1.6, 0));
    if (t < 2) for (let k = 0; k < 8; k++) {
      const a = rnd(0, Math.PI * 2);
      const r = 1.7 + rnd(-0.1, 0.1);
      const side = V(Math.cos(h.yaw), 0, -Math.sin(h.yaw));
      h.host.glow.emit(c.add(side.scale(Math.cos(a) * r)).addInPlaceFromFloats(0, Math.sin(a) * r, 0), V(), 0.15, 0.45, 0, new Color3(1, 1, 1), new Color3(0.6, 0.8, 1), 0.9, 0, 0);
    }
    if (t > 0.3 && !(h as { _boom?: boolean })._boom) {
      (h as { _boom?: boolean })._boom = true;
      h.host.audio.play("sonicBoom", { x: c.x, y: c.y, z: c.z, volume: 1.1, rate: 0.6 });
      h.host.player.shake(0.4);
    }
    if (t > 2 && t < 4.6) {
      Vector3.LerpToRef(tube, land, (t - 2) / 2.6, h.p);
      h.v.copyFrom(land.subtract(tube).scale(1 / 2.6));
    } else h.v.setAll(0);
    if (t > 4.8 && !(h as { _said?: boolean })._said) {
      (h as { _said?: boolean })._said = true;
      h.say("Kneel. All of you.", 2.8);
    }
    if (t > 4.6) h.turnTo(Math.atan2(h.host.player.feet.x - h.p.x, h.host.player.feet.z - h.p.z), dt, 2);
    if (t > this.dur - 0.05) (h as { _boom?: boolean; _said?: boolean })._boom = (h as { _said?: boolean })._said = false;
  },
  pose(h, t, want, dt) {
    h.rig.setVisible(t > 1.2);
    if (t > 2 && t < 4.6) {
      (h as { _ph?: number })._ph = ((h as { _ph?: number })._ph ?? 0) + dt;
      sample(clipOf(h, "MOVE001"), (h as { _ph?: number })._ph!, true, want);
      return 30;
    }
    if (t >= 4.6) {
      // (his own DETECT: a slow look over all of you — the CUTSCENE clip leaps, root motion and all)
      sample(clipOf(h, "DETECT001"), Math.min(t - 4.6, 0.7), false, want);
      if (t > 5.4) copyPose(DS_STANCE, want);
      return 10;
    }
    copyPose(DS_STANCE, want);
    return 10;
  },
  shot(h, t) {
    const land = (h as { _land?: Vector3 })._land ?? h.p;
    const toYou = flat(h.host.player.feet.subtract(land)).normalize();
    if (t < 4.6) return { pos: land.add(toYou.scale(4)).addInPlaceFromFloats(0, 0.6, 0), target: h.center().add(V(0, 0.3, 0)), fov: 0.85, cut: t < 0.03 };
    return orbit(h, 0.35, 3.4, 0.2, 0.75, t < 4.63, 1.2);
  },
};
export const DARKSEID: Kit = {
  id: "darkseid", color: "#5a5f70", label: "DS",
  run: 3.8, sprint: 5,
  prefer: ["quake", "omega", "strike"],
  holdRange: 2.8,
  stance: DS_STANCE,
  landing: DS_STANCE,
  rival: "superman",
  walkClip: "MOVE001",
  tune: brighten(1.7),
  moves: {
    strike: comboMove("strike", [{ clip: "ATTACK001_1", speed: 1.1, hits: [0.42] }, { clip: "ATTACK003", speed: 1, hits: [0.45] }, { clip: "ATTACK002", speed: 1, hits: [0.45] }], 3, { launch: 15, up: 5, force: 3, sound: "superPunch" }),
    omega: beamMove("omega", {
      from: dsEyes, core: new Color3(1, 0.9, 0.85), sheath: RED, width: 1.6, dur: 2.2, wind: 0.8, sound: "heatBeam",
      pose: (_h, _a, want) => copyPose(DS_STANCE, want),
    }),
    quake: slamMove("quake", { wind: 1.2, radius: 10, at: "self", color: new Color3(0.6, 0.75, 1), launch: 15, clip: "SKILL004", clipSpeed: 1.1 }),
  },
  phaseMove: slamMove("phase", { wind: 1.6, radius: 13, at: "self", color: new Color3(0.7, 0.8, 1), launch: 18, clip: "TAGSKILL001", clipSpeed: 1, after: (h) => h.say("I am inevitable as the dark.", 2.6) }),
  entrance: DS_ENTRANCE,
  lines: {
    intro: "Kneel. All of you.",
    hit: ["Pathetic.", "You cannot harm a god."],
    down: ["This… is not… possible…"],
    up: [],
    victory: [],
    fight: ["Despair.", "I am the end.", "Your world is mine."],
  },
  setup(h) {
    // his standing pose is his own (IDLE002's first frame)
    const idle = h.own["IDLE002"];
    if (idle) sample(idle, 0, false, DS_STANCE);
  },
};

// ================================================================== DOCTOR DOOM
const DOOM_GREEN = new Color3(0.35, 1, 0.45);
const DOOM_STANCE = pose(
  {
    hips: [0, 1, 0], spine: [0, 1, 0.03], spine1: [0, 1, 0.02], spine2: [0, 1, 0], neck: [0, 1, 0.03], head: [0, 1, 0.08],
    // one hand forward, open, as if he's about to pronounce sentence; the other at his side
    rArm: [0.35, -0.6, 0.72], rFore: [0.2, -0.05, 0.98], rHand: [0.15, 0.2, 0.97],
    lArm: [-0.25, -0.96, 0.1], lFore: [-0.1, -0.97, 0.2],
    lThigh: [-0.12, -0.99, 0.05], rThigh: [0.12, -0.99, -0.03],
  },
  [0, 1, 0],
);
const DOOM_ENTRANCE: Entrance = {
  dur: 5.8,
  begin(h) {
    const at = spotNear(h, 9, 16, true);
    if (!at) return false;
    (h as { _land?: Vector3 })._land = at.clone();
    h.p.copyFrom(at.add(V(0, 30, 0)));
    faceYou(h);
    return true;
  },
  frame(h, t, dt) {
    // down out of the sky in a column of green fire, the cape spread, and a word for all of you
    const land = (h as { _land?: Vector3 })._land!;
    const f = Math.min(1, t / 2.8);
    h.p.set(land.x, land.y + 30 * Math.pow(1 - f, 2), land.z);
    if (t < 2.9) for (let k = 0; k < 4; k++) h.host.glow.emit(h.p.add(V(rnd(-0.4, 0.4), rnd(-0.2, 0.3), rnd(-0.4, 0.4))), V(rnd(-0.5, 0.5), -rnd(3, 6), rnd(-0.5, 0.5)), 0.4, 0.35, 0.8, DOOM_GREEN, new Color3(0.1, 0.6, 0.2), 0.7, 1, 0);
    if (t > 2.8 && !(h as { _land2?: boolean })._land2) {
      (h as { _land2?: boolean })._land2 = true;
      h.host.rings.boom(land.add(V(0, 0.2, 0)), V(0, 1, 0), 9);
      h.host.dust(land.clone(), 0.6);
      h.host.audio.play("hulkSlam", { x: land.x, y: land.y, z: land.z, volume: 0.7, rate: 1.4 });
    }
    if (t > 3.4 && !(h as { _said?: boolean })._said) {
      (h as { _said?: boolean })._said = true;
      h.say("Doom bows to no one.", 2.6);
    }
    if (t > 3) h.turnTo(Math.atan2(h.host.player.feet.x - h.p.x, h.host.player.feet.z - h.p.z), dt, 2);
    if (t > this.dur - 0.05) (h as { _land2?: boolean; _said?: boolean })._land2 = (h as { _said?: boolean })._said = false;
  },
  pose(_h, t, want) {
    copyPose(DOOM_STANCE, want);
    if (t < 2.8) {
      want.d[P.lArm] = normD([-0.7, -0.6, 0.1]);
      want.d[P.rArm] = normD([0.7, -0.6, 0.1]);
    }
    return 8;
  },
  shot(h, t) {
    const land = (h as { _land?: Vector3 })._land ?? h.p;
    if (t < 2.8) return { pos: land.add(h.fwd().scale(8)).addInPlaceFromFloats(0, 0.4, 0), target: h.center(), fov: 0.85, cut: t < 0.03 };
    return orbit(h, -0.4 + (t - 2.8) * 0.1, 3.4, 0.6, 0.72, t < 2.83);
  },
};
export const DOOM: Kit = {
  id: "doom", color: "#2f8a3a", label: "DM",
  run: 5.5, sprint: 7.5,
  prefer: ["barrier", "seal", "bolts", "blast"],
  holdRange: 10,
  stance: DOOM_STANCE,
  landing: DOOM_STANCE,
  rival: "thor",
  tune: brighten(1.35),
  moves: {
    blast: shootMove("blast", { hands: "both", shots: 4, every: 0.18, speed: 60, core: new Color3(0.8, 1, 0.8), glow: DOOM_GREEN, size: 1.3, sound: "repulsorFire", rate: 0.8 }),
    barrier: guardMove({ guard: 0.25, secs: 7, color: DOOM_GREEN, line: "You cannot touch Doom." }),
    bolts: beamMove("bolts", {
      from: (h) => h.hand("r"), core: new Color3(0.85, 1, 0.85), sheath: DOOM_GREEN, width: 2, dur: 1.8, wind: 0.6, sound: "unibeam",
      pose: (h, a, want) => {
        copyPose(DOOM_STANCE, want);
        if (a.tgt) armAt(h, want, "r", h.aimOf(a.tgt));
      },
    }),
    seal: slamMove("seal", { wind: 1.1, radius: 4, at: "target", color: DOOM_GREEN, launch: 9, pose: (h, a, want) => {
      copyPose(DOOM_STANCE, want);
      if (a.tgt) armAt(h, want, "l", h.aimOf(a.tgt));
    } }),
  },
  phaseMove: {
    start(h, a) {
      a.dur = 2.4;
      h.guard = 0.25;
      (h as { _guardT?: number })._guardT = 6;
      h.say("Enough! Now you face DOOM!", 2.6);
    },
    frame(h, a) {
      // bolts of green fire on everyone within reach, one after another
      while (a.n < 5 && a.t > 0.5 + a.n * 0.35) {
        a.n++;
        const near = h.around(h.p, 18);
        if (!near.length) continue;
        const x: Tgt = pick(near);
        const to = h.aimOf(x);
        h.host.lightning.strike(h.hand("r"), to, DOOM_GREEN, 0.3, 1.2, 1.2, 2);
        h.hit(x, 30, to.subtract(h.p), { kind: "blast", launch: 6, up: 3 });
        h.host.audio.play("hulkClap", { x: to.x, y: to.y, z: to.z, volume: 0.5, rate: 1.7 });
      }
    },
    pose(_h, _a, want) {
      copyPose(DOOM_STANCE, want);
      want.d[P.lArm] = normD([-0.9, 0.4, 0.1]);
      want.d[P.rArm] = normD([0.9, 0.4, 0.1]);
      return 12;
    },
  },
  entrance: DOOM_ENTRANCE,
  lines: {
    intro: "Doom bows to no one.",
    hit: ["You dare strike Doom?", "Insignificant."],
    down: ["Doom… will… return…"],
    up: [],
    victory: [],
    fight: ["Kneel before Doom!", "Your science is primitive.", "Doom is inevitable."],
  },
  after(h, dt) {
    guardTick(h, dt, DOOM_GREEN);
  },
};

// ================================================================== THANOS (Phase 4: the final boss)
/**
 * Three fights in one. Phase 1, the brawler: heavy combos, a grab-and-throw, a stomp shockwave, a
 * block. At two-thirds he stops, raises the Gauntlet and the stones wake — Phase 2 adds the Power
 * Stone's beam and the Space Stone's portals (gone in blue light, out behind whoever he wants). At
 * one-third he roars and the sky comes down: Phase 3 adds the moon-fall, rocks raining on all of
 * you. Beaten, he goes down on one knee, the Gauntlet sparking — and that's the end of it.
 */
const STONES = [new Color3(0.7, 0.3, 1), new Color3(0.25, 0.45, 1), new Color3(1, 0.15, 0.15), new Color3(1, 0.6, 0.1), new Color3(1, 0.9, 0.2), new Color3(0.2, 0.9, 0.4)];
const POWER = STONES[0], SPACE = STONES[1];
const TH_STANCE = pose(
  {
    hips: [0, 1, 0.06], spine: [0, 1, 0.1], spine1: [0, 1, 0.12], spine2: [0, 1, 0.08], neck: [0, 1, 0.1], head: [0, 0.98, 0.15],
    // the Gauntlet (left) up and closed, the right fist low
    lArm: [-0.45, -0.7, 0.55], lFore: [0.1, 0.45, 0.89], lHand: [0.05, 0.3, 0.95],
    rArm: [0.42, -0.85, 0.3], rFore: [0.15, -0.4, 0.9],
    lThigh: [-0.24, -0.93, 0.25], lShin: [-0.05, -0.95, -0.25], rThigh: [0.26, -0.95, -0.12], rShin: [0.05, -0.93, -0.33],
  },
  [0, 0.93, 0],
);
/** the Gauntlet raised to the sky: the stones flare */
const TH_RAISE = pose(
  {
    hips: [0, 1, -0.04], spine: [0, 1, -0.08], spine1: [0, 1, -0.1], spine2: [0, 1, -0.06], neck: [0, 1, 0], head: [0, 0.9, -0.4],
    lArm: [-0.15, 0.98, 0.1], lFore: [-0.05, 1, 0.05], lHand: [0, 1, 0.05],
    rArm: [0.55, -0.8, 0.2], rFore: [0.3, -0.7, 0.6],
    lThigh: [-0.22, -0.96, 0.08], rThigh: [0.22, -0.96, 0.05],
  },
  [0, 0.98, 0],
);
/** the Gauntlet thrust out at someone (the beam, the grab) */
const TH_THRUST = pose(
  {
    hips: [0, 1, 0.1], spine: [0.1, 1, 0.15], spine1: [0.15, 1, 0.18], spine2: [0.12, 1, 0.15], neck: [0, 1, 0.12], head: [0, 0.98, 0.18],
    lArm: [-0.12, 0.08, 0.99], lFore: [-0.05, 0.05, 1], lHand: [0, 0.05, 1],
    rArm: [0.5, -0.7, -0.4], rFore: [0.3, -0.4, 0.85],
    lThigh: [-0.22, -0.88, 0.42], lShin: [0, -0.96, -0.3], rThigh: [0.24, -0.95, -0.25], rShin: [0.05, -0.85, -0.5],
  },
  [0, 0.9, 0.05],
);
/** beaten: down on one knee, the Gauntlet on the ground in front of him, head bowed */
const TH_KNEEL = pose(
  {
    hips: [0, 0.9, 0.42], spine: [0, 0.85, 0.52], spine1: [0, 0.82, 0.57], spine2: [0, 0.85, 0.52], neck: [0, 0.6, 0.8], head: [0, 0.4, 0.92],
    lArm: [-0.25, -0.85, 0.46], lFore: [0, -1, 0.1], lHand: [0, -1, 0.15],
    rArm: [0.3, -0.92, 0.25], rFore: [0.1, -0.95, 0.3],
    lThigh: [-0.12, -0.35, 0.93], lShin: [-0.02, -1, -0.08], lFoot: [-0.1, -0.35, 0.93],
    rThigh: [0.15, -0.88, -0.45], rShin: [0.04, -0.12, -0.99], rFoot: [0.05, -0.95, -0.3],
  },
  [0, 0.47, -0.05],
);
const gauntlet = (h: RosterHero) => h.hand("l");
/** a move only from boss phase `n` on (the stones wake at two-thirds) */
export function gated(n: number, m: Move): Move {
  return { ...m, start: (h, a) => (phaseOf(h) < n ? false : m.start(h, a)) };
}
const phaseOf = (h: RosterHero) => (h as RosterHero & { phase?: number }).phase ?? 0;
/** the stones' glow on the Gauntlet (more of it, the further into the fight) */
function stonesGlow(h: RosterHero, dt: number) {
  const k = phaseOf(h);
  if (!h.alive && !h.cinematic) return;
  const g = gauntlet(h);
  const n = (k + 1) * 6 * dt * (h.action ? 2 : 1);
  if (Math.random() < n) {
    const c = STONES[Math.floor(Math.random() * (k === 0 ? 2 : 6))];
    h.host.glow.emit(g.add(V(rnd(-0.08, 0.08), rnd(-0.08, 0.08), rnd(-0.08, 0.08))), V(rnd(-0.4, 0.4), rnd(0, 0.8), rnd(-0.4, 0.4)), rnd(0.2, 0.4), rnd(0.1, 0.2), 1, c, c, 0.9, 2, 0.5);
  }
  guardTick(h, dt, new Color3(0.9, 0.7, 0.3));
}
/** the grab: a hand round whoever's closest, held up, then thrown */
const TH_GRAB: Move = {
  start(h, a) {
    if (!a.tgt) return false;
    a.dur = 1.9;
    h.faceTo(h.tgtGround(a.tgt));
  },
  threat(h, a) {
    if (!a.tgt || a.t > 0.45) return null;
    return { kind: "punch", at: h.p.clone(), dir: h.fwd(), radius: 2.8, cone: 0.9, t: 0.45 - a.t, target: "hero" in a.tgt ? a.tgt.hero : null };
  },
  frame(h, a) {
    const t = a.tgt!;
    if (!h.tgtAlive(t)) return a.n === 0;
    if (a.n === 0 && a.t > 0.45) {
      a.n = 1;
      const d = Vector3.Distance(flat(h.tgtGround(t)), flat(h.p));
      if (d > 3) return true;
      a.data.held = true;
      h.host.audio.play("hulkPunch", { x: h.p.x, y: h.p.y + 2, z: h.p.z, volume: 0.9, rate: 0.8 });
      h.say(pick(["Hold still.", "Struggle all you like."]), 1.6);
    }
    // (squeezed)
    if (a.data.held && a.n < 4 && a.t > 0.6 + a.n * 0.25) {
      a.n++;
      h.hit(t, (h.book.def("grab")?.damage ?? 60) * 0.25, h.fwd(), { kind: "melee" });
    }
    if (a.data.held && a.n === 4 && a.t > 1.5) {
      a.n = 5;
      h.hit(t, (h.book.def("grab")?.damage ?? 60) * 0.25, h.fwd(), { force: 3, launch: 18, up: 7 });
      h.host.audio.play("swingWhoosh", { x: h.p.x, y: h.p.y + 2, z: h.p.z, volume: 1, rate: 0.6 });
    }
  },
  pose(_h, a, want) {
    copyPose(a.t < 0.45 ? TH_STANCE : a.t < 1.5 ? TH_RAISE : TH_THRUST, want);
    return 16;
  },
};
/** the Space Stone: gone in a ring of blue light, out of another behind the target — and a blow */
const TH_PORTAL: Move = {
  moves: true,
  start(h, a) {
    if (!a.tgt || phaseOf(h) < 1) return false;
    a.dur = 1.6;
    h.host.rings.boom(h.center(), h.fwd(), 4);
    h.host.audio.play("unibeam", { x: h.p.x, y: h.p.y + 1, z: h.p.z, volume: 0.8, rate: 1.6 });
  },
  frame(h, a) {
    const ring = (at: Vector3) => {
      for (let k = 0; k < 10; k++) {
        const ang = rnd(0, Math.PI * 2);
        h.host.glow.emit(at.add(V(Math.cos(ang) * 1.4, 1.6 + Math.sin(ang) * 1.4, 0)), V(), 0.2, 0.3, 0, SPACE, SPACE, 0.9, 0, 0);
      }
    };
    if (a.t < 0.45) ring(h.p);
    if (a.n === 0 && a.t > 0.45) {
      a.n = 1;
      const t = a.tgt!;
      const tp = h.tgtGround(t);
      const behind = tp.subtract(flat(h.p.subtract(tp)).normalize().scale(2.4));
      const fy = h.host.nav.floorAt(behind.x, tp.y + 2, behind.z, 4);
      if (fy !== null && !h.host.nav.embedded(behind.x, fy + 1, behind.z)) h.p.set(behind.x, fy, behind.z);
      h.faceTo(tp);
      h.host.rings.boom(h.center(), h.fwd(), 4);
    }
    if (a.n === 1 && a.t < 0.8) ring(h.p);
    if (a.n === 1 && a.t > 0.9) {
      a.n = 2;
      const t = a.tgt!;
      if (h.tgtAlive(t) && Vector3.Distance(flat(h.tgtGround(t)), flat(h.p)) < 3.4) {
        h.hit(t, 50, h.tgtGround(t).subtract(h.p), { force: 3, launch: 15, up: 5 });
        h.host.audio.play("superPunch", { x: h.p.x, y: h.p.y + 1.5, z: h.p.z, volume: 1, rate: 0.8 });
      }
    }
  },
  pose(_h, a, want) {
    copyPose(a.t < 0.9 ? TH_RAISE : TH_THRUST, want);
    return a.t < 0.9 ? 14 : 30;
  },
};
/** the moon-fall: rocks from the sky on all of them, one after another */
const TH_METEORS: Move = {
  start(h, a) {
    if (phaseOf(h) < 2) return false;
    a.dur = 3.4;
    a.data.spots = h.around(h.p, 40).map((x) => h.tgtGround(x));
    h.say(pick(["Let the sky fall.", "Rain."]), 2);
    h.host.audio.play("sonicBoom", { x: h.p.x, y: h.p.y + 20, z: h.p.z, volume: 0.9, rate: 0.5 });
  },
  threat(h, a) {
    const spots = a.data.spots as Vector3[];
    const at = spots[a.n];
    return at ? { kind: "smash", at, dir: h.fwd(), radius: 4, cone: Math.PI, t: Math.max(0, 0.9 + a.n * 0.35 - a.t), target: null } : null;
  },
  frame(h, a) {
    const spots = a.data.spots as Vector3[];
    // (a burning warning on the ground where each will land)
    for (const at of spots) if (Math.random() < 0.3) h.host.glow.emit(at.add(V(rnd(-1.5, 1.5), 0.1, rnd(-1.5, 1.5))), V(0, 0.5, 0), 0.3, 0.4, 0.4, new Color3(1, 0.5, 0.2), new Color3(1, 0.2, 0.05), 0.6, 1, 0);
    while (a.n < Math.max(4, spots.length) && a.t > 0.6 + a.n * 0.35) {
      const at = spots.length ? spots[a.n % spots.length].add(V(rnd(-1.2, 1.2), 0, rnd(-1.2, 1.2))) : h.p.add(V(rnd(-12, 12), 0, rnd(-12, 12)));
      a.n++;
      const from = at.add(V(rnd(-14, 14), 46, rnd(-14, 14)));
      h.host.bolts.fire(from, at, 55, new Color3(1, 0.7, 0.4), new Color3(1, 0.3, 0.05), 5, () => h.host.blast(at, 4, h.book.def("meteor")?.damage ?? 45));
    }
  },
  pose(_h, _a, want) {
    copyPose(TH_RAISE, want);
    return 10;
  },
};
/**
 * The final boss's entrance (12 s): the sky goes dark and purple lightning walks the ground where
 * he'll land; a Space Stone gate tears open in the air and he steps out of it, slowly; his foot
 * comes down and the snow jumps; then the Gauntlet, close — the six stones lighting one by one —
 * the fist closes, the ring of light, his name. The sky stays dark while he's up.
 */
const TH_ENTRANCE: Entrance = {
  dur: 12,
  begin(h) {
    const land = spotNear(h, 11, 18, false);
    if (!land) return false;
    const e = h as { _land?: Vector3; _gate?: Vector3; _beat?: number };
    e._land = land.clone();
    const away = flat(land.subtract(h.host.player.feet)).normalize();
    e._gate = land.add(away.scale(4));
    e._beat = 0;
    h.p.copyFrom(e._gate);
    h.faceTo(land);
    return true;
  },
  frame(h, t, dt) {
    const e = h as { _land?: Vector3; _gate?: Vector3; _beat?: number };
    const gate = e._gate!, land = e._land!;
    // (a skip runs this in 0.1 s steps: the one-off beats still happen, the random flicker doesn't)
    const live = dt < 0.095;
    const beat = (n: number, at: number) => {
      if (t < at || (e._beat ?? 0) >= n) return false;
      e._beat = n;
      return true;
    };
    // the sky: dark in a second and a half, easing back to a storm light when he's done
    h.host.sky?.(t < 10 ? Math.min(1, t / 1.5) : 1 - 0.55 * Math.min(1, (t - 10) / 2));
    // 0.3–3.4: purple lightning out of the dark onto the ground round the spot
    if (live && t > 0.3 && t < 3.4 && Math.random() < dt * 5) {
      const to = land.add(V(rnd(-7, 7), 0, rnd(-7, 7)));
      const fy = h.host.nav.floorAt(to.x, to.y + 2, to.z, 4);
      if (fy !== null) to.y = fy;
      h.host.lightning.strike(to.add(V(rnd(-6, 6), rnd(28, 40), rnd(-6, 6))), to, Math.random() < 0.5 ? POWER : SPACE, 0.32, 1.2, 2.2, 3);
      h.host.audio.play("hulkClap", { x: to.x, y: to.y, z: to.z, volume: 0.8, rate: rnd(0.4, 0.55), reverb: 1.6 });
      h.host.dust(to, 0.6);
    }
    if (beat(1, 0.3)) {
      h.host.audio.play("hulkRoar", { x: land.x, y: land.y + 10, z: land.z, volume: 0.6, rate: 0.35, reverb: 2 });
      h.host.player.shake(0.25);
    }
    // 2–6.6: the Space Stone gate — a ring of blue fire, a blue haze inside it
    const c = gate.add(V(0, 1.8, 0));
    const side = V(Math.cos(h.yaw), 0, -Math.sin(h.yaw));
    if (live && t > 2 && t < 6.6) {
      const open = Math.min(1, (t - 2) / 0.6) * (t > 6 ? 1 - (t - 6) / 0.6 : 1);
      for (let k = 0; k < 16; k++) {
        const a = rnd(0, Math.PI * 2);
        const r = 2.3 * open;
        h.host.glow.emit(c.add(side.scale(Math.cos(a) * r)).addInPlaceFromFloats(0, Math.sin(a) * r * 1.15, 0), V(rnd(-0.3, 0.3), rnd(-0.3, 0.3), rnd(-0.3, 0.3)), 0.28, 0.5, 0, new Color3(0.7, 0.85, 1), SPACE, 0.95, 0, 0);
      }
      for (let k = 0; k < 3; k++) {
        const a = rnd(0, Math.PI * 2), r = rnd(0, 2) * open;
        h.host.glow.emit(c.add(side.scale(Math.cos(a) * r)).addInPlaceFromFloats(0, Math.sin(a) * r, 0), V(), 0.4, 0.9, 0, SPACE, new Color3(0.05, 0.1, 0.4), 0.35, 0, 0);
      }
      if (Math.random() < dt * 8) h.host.lightning.strike(c, c.add(side.scale(rnd(-2.3, 2.3))).addInPlaceFromFloats(0, rnd(-2.3, 2.3), 0), SPACE, 0.12, 0.5, 0.5, 0);
    }
    if (beat(2, 2)) {
      h.host.audio.play("sonicBoom", { x: c.x, y: c.y, z: c.z, volume: 1.3, rate: 0.4 });
      h.host.rings.boom(c, V(0, 0, 1), 6);
      h.host.player.shake(0.5);
    }
    // 3.4–6.4: he walks out of it
    if (t > 3.4 && t < 6.4) {
      Vector3.LerpToRef(gate, land, (t - 3.4) / 3, h.p);
      h.v.copyFrom(land.subtract(gate).scale(1 / 3));
      if (live && Math.random() < dt * 1.6) h.host.audio.play("hulkStep", { x: h.p.x, y: h.p.y, z: h.p.z, volume: 0.8, rate: 0.75 });
    } else if (t >= 6.4) {
      h.v.setAll(0);
      h.p.copyFrom(land);
      h.turnTo(Math.atan2(h.host.player.feet.x - h.p.x, h.host.player.feet.z - h.p.z), dt, 2);
    }
    // 6.4: the last step — the ground jumps
    if (beat(3, 6.4)) {
      h.host.rings.boom(land.add(V(0, 0.1, 0)), V(0, 1, 0), 12);
      h.host.slam(land, 1.2);
      h.host.audio.play("hulkSlam", { x: land.x, y: land.y, z: land.z, volume: 1.2, rate: 0.7 });
      h.host.player.shake(0.7);
    }
    // 7–9.1: the Gauntlet, the stones waking one by one (Space, Mind, Reality, Power, Time, Soul)
    for (let i = 0; i < 6; i++) {
      if (!beat(4 + i, 7 + i * 0.35)) continue;
      const col = STONES[[1, 4, 2, 0, 5, 3][i]];
      const g = gauntlet(h);
      for (let k = 0; k < 10; k++) h.host.glow.emit(g, V(rnd(-1.5, 1.5), rnd(-0.5, 2), rnd(-1.5, 1.5)), rnd(0.25, 0.5), rnd(0.12, 0.25), 1.5, new Color3(1, 1, 1), col, 1, 2, 0.4);
      h.host.glow.emit(g, V(), 0.35, 0.9, 0, new Color3(1, 1, 1), col, 0.9, 0, 0);
      h.host.audio.play("repulsorCharge", { x: g.x, y: g.y, z: g.z, volume: 0.5, rate: 0.6 + i * 0.12 });
    }
    // 9.4: the fist closes — the ring of light
    if (beat(10, 9.4)) {
      const g = gauntlet(h);
      h.host.rings.boom(g, V(0, 1, 0), 14);
      for (let k = 0; k < 4; k++) h.host.lightning.strike(g, g.add(V(rnd(-3, 3), rnd(1, 4), rnd(-3, 3))), pick(STONES), 0.25, 0.8, 0.8, 1);
      h.host.audio.play("unibeam", { x: g.x, y: g.y, z: g.z, volume: 0.9, rate: 0.5 });
      h.host.audio.play("hulkRoar", { x: h.p.x, y: h.p.y + 2, z: h.p.z, volume: 1, rate: 0.6 });
      h.host.player.shake(0.8);
    }
    if (beat(11, 9.7)) h.host.card?.("THANOS", "THE MAD TITAN", 3.6);
    if (beat(12, 10.2)) h.say("You have fought well. It changes nothing.", 3.2);
    stonesGlow(h, dt);
  },
  pose(h, t, want, dt) {
    h.rig.setVisible(t > 3.2);
    if (t > 3.4 && t < 6.4) {
      (h as { _ph?: number })._ph = ((h as { _ph?: number })._ph ?? 0) + dt * (1.6 / 1.25);
      sample(h.clips.walk, (h as { _ph?: number })._ph!, true, want);
      naturalArms(want, 0.1, 0.02);
      want.d[P.lArm] = TH_STANCE.d[P.lArm];
      want.d[P.lFore] = TH_STANCE.d[P.lFore];
      return 30;
    }
    // (the Gauntlet up while the stones wake, and up again for the ring; then the stance)
    copyPose((t > 6.9 && t < 9.2) || (t > 9.4 && t < 10.6) ? TH_RAISE : TH_STANCE, want);
    return 8;
  },
  shot(h, t) {
    const e = h as { _land?: Vector3; _gate?: Vector3 };
    const land = e._land ?? h.p, gate = e._gate ?? h.p;
    const toYou = flat(h.host.player.feet.subtract(land)).normalize();
    // the dark coming down on the spot, wide
    if (t < 3.4) return { pos: land.add(toYou.scale(15)).addInPlaceFromFloats(0, 2.5, 0), target: gate.add(V(0, 2.4, 0)), fov: 0.95, cut: t < 0.03 };
    // low, looking up at him walking out
    if (t < 6.4) return { pos: land.add(toYou.scale(5)).addInPlaceFromFloats(0, 0.5, 0), target: h.center().add(V(0, 0.5, 0)), fov: 0.8, cut: t < 3.43 };
    if (t < 7) return orbit(h, 0.3, 3.4, 0.6, 0.62, t < 6.43, 1.25);
    // the Gauntlet, close
    if (t < 9.4) {
      const g = gauntlet(h);
      const fwd = V(Math.sin(h.yaw), 0, Math.cos(h.yaw));
      const right = V(Math.cos(h.yaw), 0, -Math.sin(h.yaw));
      return { pos: g.add(fwd.scale(2.8)).addInPlace(right.scale(-1.3)).addInPlaceFromFloats(0, -0.9, 0), target: g.add(V(0, -0.35, 0)), fov: 0.72, cut: t < 7.03 };
    }
    return orbit(h, -0.5, 4.4, -0.2, 0.75, t < 9.43, 1.3);
  },
};
export const THANOS: Kit = {
  id: "thanos", color: "#8a4fd0", label: "TH",
  run: 5.5, sprint: 8,
  prefer: ["meteor", "portal", "power", "grab", "shockwave", "combo", "block"],
  holdRange: 2.6,
  stance: TH_STANCE,
  landing: TH_STANCE,
  rival: "hulk",
  tune: brighten(1.2),
  moves: {
    combo: comboMove("combo", [{ clip: "hook", speed: 1, hits: [0.29] }, { clip: "smash", speed: 0.95, hits: [0.41] }, { clip: "mmaKick3", speed: 1.1, hits: [0.388] }, { clip: "combo", speed: 1.25, hits: [0.12, 0.32, 0.56, 0.79] }], 3, { launch: 16, up: 6, force: 3, sound: "superPunch" }),
    grab: TH_GRAB,
    shockwave: slamMove("shockwave", { wind: 0.8, radius: 9, at: "self", color: new Color3(0.9, 0.7, 1), launch: 14, pose: (_h, a, want) => copyPose(a.t < 0.8 ? TH_RAISE : TH_KNEEL, want) }),
    block: guardMove({ guard: 0.15, secs: 2.5, color: new Color3(0.9, 0.7, 0.3) }),
    power: gated(1, beamMove("power", {
      from: gauntlet, core: new Color3(1, 0.85, 1), sheath: POWER, width: 3.2, dur: 2.2, wind: 0.7, sound: "unibeam",
      pose: (h, a, want) => {
        copyPose(TH_THRUST, want);
        if (a.tgt) armAt(h, want, "l", h.aimOf(a.tgt));
      },
    })),
    portal: TH_PORTAL,
    meteor: TH_METEORS,
  },
  phaseMove: {
    start(h, a) {
      a.dur = 3;
      h.guard = 0.1;
      (h as { _guardT?: number })._guardT = 3;
      h.say(phaseOf(h) >= 2 ? "I will shatter this world to the last stone." : "Enough. Now the stones.", 3);
      h.host.audio.play("hulkRoar", { x: h.p.x, y: h.p.y + 2, z: h.p.z, volume: 1, rate: 0.7 });
    },
    frame(h, a) {
      const g = gauntlet(h);
      if (Math.random() < 0.8) {
        const c = pick(STONES);
        h.host.lightning.strike(g, g.add(V(rnd(-2, 2), rnd(0.5, 3), rnd(-2, 2))), c, 0.15, 0.6, 0.6, 1);
      }
      if (a.n === 0 && a.t > 2) {
        a.n = 1;
        h.host.rings.boom(h.center(), V(0, 1, 0), 18);
        h.host.player.shake(0.6);
        for (const x of h.around(h.p, 9)) h.hit(x, 40, h.tgtGround(x).subtract(h.p).add(V(0, 0.01, 0)), { force: 3, launch: 14, up: 6, kind: "blast" });
      }
    },
    pose(_h, _a, want) {
      copyPose(TH_RAISE, want);
      return 10;
    },
  },
  outro: {
    dur: 6,
    frame(h, t) {
      const g = gauntlet(h);
      // (small sparks: the camera's close)
      if (t < 4 && Math.random() < 0.35) h.host.lightning.strike(g, g.add(V(rnd(-0.6, 0.6), rnd(0, 0.8), rnd(-0.6, 0.6))), pick(STONES), 0.1, 0.18, 0.25, 0);
      if (t > 1.2 && !(h as { _last?: boolean })._last) {
        (h as { _last?: boolean })._last = true;
        h.say("…Impossible.", 3);
      }
      if (t > 5.9) (h as { _last?: boolean })._last = false;
    },
    pose(_h, t, want) {
      copyPose(t < 0.6 ? TH_THRUST : TH_KNEEL, want);
      return t < 0.6 ? 20 : 4;
    },
    shot(h, t) {
      // in close and low on him; then up and away: the heroes round him, the field
      if (t < 3.5) return orbit(h, 0.4 + t * 0.05, 3.4, 0.2, 0.7, t < 0.03, 1);
      const k = (t - 3.5) / 2.5;
      return { pos: h.p.add(V(Math.sin(h.yaw + 0.6) * (6 + k * 10), 3 + k * 9, Math.cos(h.yaw + 0.6) * (6 + k * 10))), target: h.p.add(V(0, 1, 0)), fov: 0.8 };
    },
  },
  entrance: TH_ENTRANCE,
  lines: {
    intro: "You have fought well. It changes nothing.",
    hit: ["Is that all?", "Little one…"],
    down: ["…"],
    up: [],
    victory: [],
    fight: ["I am the end of this.", "Kneel.", "You could not live with your own failure."],
  },
  after: stonesGlow,
};

export const VILLAIN_KITS: Record<string, Kit> = { ultron: ULTRON, ronan: RONAN, joker: JOKER, darkseid: DARKSEID, doom: DOOM, thanos: THANOS };
void HIT;
void mixPose;
void trouble;
