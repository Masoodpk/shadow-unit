import { Color3 } from "@babylonjs/core/Maths/math.color";
import { PBRMaterial } from "@babylonjs/core/Materials/PBR/pbrMaterial";
import { Quaternion, Vector3 } from "@babylonjs/core/Maths/math.vector";
import { TransformNode } from "@babylonjs/core/Meshes/transformNode";
import { armAt, dashMove, faceYou, orbit, spotNear } from "../allies/kits";
import { pose, type DirClip, type Pose } from "../allies/SpiderPoses";
import {
  P, TUCK, V, comboMove, copyPose, flat, naturalArms, normD, rnd, sample, shootMove,
  type Entrance, type Kit, type Move, type RosterHero,
} from "../allies/RosterHero";
import { beamMove, guardMove, guardTick, slamMove } from "./villainKits";
import type { HulkThreat } from "./Hulk";
import type { RosterVillain } from "./RosterVillain";

/**
 * The second wave against you (round 10), each a kit for RosterVillain: Hela, Red Skull, Megatron,
 * Venom (whose side is the faction table's call — the same kit fights for you if a mission turns
 * him) and Godzilla (a giant: his own clip's moves, his own tread, a tail that swings). Every move
 * that hurts says so in advance (`threat`) where the shared builders don't already. Lines are
 * written for this game — subtitles only, no voice files.
 */

/** a boss's name on screen as he arrives */
const titled = (h: RosterHero, sub: string) => h.host.card?.(h.def.name, sub, 3);
type E = { _land?: Vector3; _from?: Vector3; _beat?: number; _ph?: number };
/** a one-off beat in an entrance: true the first time `t` passes `at` (in order, by number) */
function beat(h: RosterHero, n: number, t: number, at: number) {
  const e = h as E;
  if (t < at || (e._beat ?? 0) >= n) return false;
  e._beat = n;
  return true;
}
/** walking in, on the shared clip (his arms his own) */
function walkIn(h: RosterHero, dt: number, want: Pose, pace: number, keep?: Pose) {
  const e = h as E;
  e._ph = (e._ph ?? 0) + dt * (pace / 1.25);
  sample(h.clips.walk, e._ph, true, want);
  naturalArms(want, 0.1, 0.02);
  if (keep) for (const k of [P.lArm, P.lFore, P.rArm, P.rFore]) want.d[k] = keep.d[k];
}

// ================================================================== HELA
const NECRO = new Color3(0.25, 1, 0.45);
const NECRO2 = new Color3(0.02, 0.35, 0.12);
const HELA_STANCE = pose(
  {
    hips: [0, 1, 0.02], spine: [0, 1, 0.05], spine1: [0, 1, 0.05], spine2: [0, 1, 0.03], neck: [0, 1, 0.06], head: [0, 0.99, 0.12],
    // a sword low in each hand, points out
    lArm: [-0.45, -0.86, 0.22], lFore: [-0.2, -0.45, 0.87], lHand: [-0.15, -0.3, 0.94],
    rArm: [0.45, -0.86, 0.22], rFore: [0.2, -0.45, 0.87], rHand: [0.15, -0.3, 0.94],
    lThigh: [-0.12, -0.98, 0.14], rThigh: [0.15, -0.98, -0.05],
  },
  [0, 0.98, 0],
);
const HELA_THROW = pose(
  {
    hips: [0, 1, 0.05], spine: [0, 1, 0.1], spine1: [0, 1, 0.12], spine2: [0, 1, 0.1], neck: [0, 1, 0.06], head: [0, 0.99, 0.1],
    lArm: [-0.3, 0.2, 0.93], lFore: [-0.1, 0.25, 0.96], lHand: [0, 0.3, 0.95],
    rArm: [0.3, 0.2, 0.93], rFore: [0.1, 0.25, 0.96], rHand: [0, 0.3, 0.95],
    lThigh: [-0.15, -0.92, 0.35], rThigh: [0.18, -0.95, -0.25], rShin: [0.04, -0.9, -0.42],
  },
  [0, 0.94, 0],
);
/** arms flung down and out: the ground answers with blades */
const HELA_SUMMON = pose(
  {
    hips: [0, 1, 0], spine: [0, 1, 0.08], spine1: [0, 1, 0.1], spine2: [0, 1, 0.06], neck: [0, 1, 0.1], head: [0, 0.96, 0.25],
    lArm: [-0.8, -0.55, 0.2], lFore: [-0.7, -0.6, 0.35], rArm: [0.8, -0.55, 0.2], rFore: [0.7, -0.6, 0.35],
    lThigh: [-0.22, -0.96, 0.12], rThigh: [0.22, -0.96, -0.05],
  },
  [0, 0.96, 0],
);
/** the eruption: black-green blades out of the ground under the target, one after another */
function bladesUp(h: RosterHero, at: Vector3, r: number) {
  for (let k = 0; k < 7; k++) {
    const a = rnd(0, Math.PI * 2), d = rnd(0, r);
    const g = at.add(V(Math.sin(a) * d, 0, Math.cos(a) * d));
    h.host.lightning.strike(g, g.add(V(rnd(-0.4, 0.4), rnd(1.8, 3.2), rnd(-0.4, 0.4))), NECRO, 0.6, 1.1, 0.05, 0);
  }
}
const HELA_ENTRANCE: Entrance = {
  dur: 7,
  begin(h) {
    const land = spotNear(h, 8, 14, false);
    if (!land) return false;
    const e = h as E;
    e._land = land.clone();
    e._beat = 0;
    h.p.copyFrom(land).addInPlaceFromFloats(0, -2.2, 0);
    faceYou(h);
    return true;
  },
  frame(h, t, dt) {
    // the light goes green; black smoke boils out of the snow; she rises out of it, the swords
    // forming in her hands in a flash, and the headdress last
    const e = h as E;
    const land = e._land!;
    const live = dt < 0.095;
    // (a knee-high boil, round her — not a wall in front of the camera)
    if (live && t < 4.5) for (let k = 0; k < 2; k++) {
      const a = rnd(0, Math.PI * 2), r = rnd(0.6, 1.8) * Math.min(1, t / 1.2);
      h.host.smoke.emit(land.add(V(Math.sin(a) * r, 0.1, Math.cos(a) * r)), V(-Math.cos(a) * 0.9, rnd(0.3, 0.9), Math.sin(a) * 0.9), rnd(0.7, 1.1), rnd(0.35, 0.6), 0.6, new Color3(0.02, 0.04, 0.03), new Color3(0.05, 0.12, 0.07), 0.7, 0.5, -0.3);
      if (Math.random() < 0.5) h.host.glow.emit(land.add(V(Math.sin(a) * r, 0.2, Math.cos(a) * r)), V(0, rnd(1, 3), 0), 0.5, 0.3, 0.3, NECRO, NECRO2, 0.8, 1, 0);
    }
    if (beat(h, 1, t, 0.2)) h.host.audio.play("hulkRoar", { x: land.x, y: land.y, z: land.z, volume: 0.5, rate: 1.6, reverb: 1.8 });
    // rising: two metres in two and a half seconds
    const k = Math.min(1, Math.max(0, (t - 1.2) / 2.5));
    h.p.copyFrom(land).addInPlaceFromFloats(0, -2.2 * (1 - k * k * (3 - 2 * k)), 0);
    const sw = (h as { _swords?: { setEnabled(v: boolean): void }[] })._swords ?? [];
    for (const m of sw) m.setEnabled(t > 4);
    if (beat(h, 2, t, 4)) {
      for (const s of ["l", "r"] as const) for (let i = 0; i < 12; i++) h.host.glow.emit(h.hand(s), V(rnd(-2, 2), rnd(-1, 2), rnd(-2, 2)), 0.35, 0.25, 2, new Color3(0.7, 1, 0.8), NECRO, 1, 3, 0);
      h.host.audio.play("swingWhoosh", { x: h.p.x, y: h.p.y + 1, z: h.p.z, volume: 0.9, rate: 0.7 });
    }
    if (beat(h, 3, t, 4.6)) {
      titled(h, "GODDESS OF DEATH");
      h.say("Kneel. Before your queen.", 2.8);
    }
    if (t > 4) faceYou(h);
  },
  pose(h, t, want) {
    h.rig.setVisible(t > 1);
    copyPose(t < 4 ? HELA_SUMMON : t < 5.2 ? HELA_THROW : HELA_STANCE, want);
    return 8;
  },
  shot(h, t) {
    const land = (h as E)._land ?? h.p;
    const toYou = flat(h.host.player.feet.subtract(land)).normalize();
    if (t < 4) return { pos: land.add(toYou.scale(7)).addInPlaceFromFloats(0, 0.6, 0), target: land.add(V(0, 1.2, 0)), fov: 0.75, cut: t < 0.03 };
    return orbit(h, 0.35, 2.8, 0.35, 0.68, t < 4.03, 1.15);
  },
};
export const HELA: Kit = {
  id: "hela", color: "#1f7a43", label: "HE",
  run: 7.5, sprint: 10,
  prefer: ["spikes", "counter", "blades", "combo"],
  holdRange: 2.4,
  stance: HELA_STANCE,
  landing: HELA_STANCE,
  rival: "thor",
  moves: {
    combo: comboMove("combo", [{ clip: "combo", speed: 1.35, hits: [0.12, 0.32, 0.56, 0.79] }, { clip: "elbowCombo", speed: 1.3, hits: [0.3, 0.62] }, { clip: "hook", speed: 1.3, hits: [0.29] }], 2.6, { launch: 9, up: 4, force: 2, sound: "meleeHit" }),
    blades: shootMove("blades", { hands: "both", shots: 6, every: 0.12, speed: 50, core: new Color3(0.6, 1, 0.7), glow: NECRO, size: 1.5, sound: "batarang", rate: 0.8, pose: (_h, _a, want) => copyPose(HELA_THROW, want) }),
    spikes: slamMove("spikes", { wind: 0.9, radius: 3.5, at: "target", color: NECRO, launch: 12, pose: (_h, _a, want) => copyPose(HELA_SUMMON, want), after: (h, at) => bladesUp(h, at, 3.5) }),
    counter: guardMove({ guard: 0.15, secs: 2.5, color: NECRO, line: "Is that all?" }),
  },
  phaseMove: slamMove("phase", { wind: 1.4, radius: 10, at: "self", color: NECRO, launch: 15, pose: (_h, _a, want) => copyPose(HELA_SUMMON, want), after: (h, at) => {
    bladesUp(h, at, 9);
    bladesUp(h, at, 6);
    h.say("I'm not a queen, or a monster. I'm the goddess of death.", 3);
    h.power = 1.25;
  } }),
  entrance: HELA_ENTRANCE,
  lines: {
    intro: "Kneel. Before your queen.",
    hit: ["Hm. You bleed better than you fight.", "Cute."],
    down: ["This… isn't how it ends."],
    up: [],
    victory: [],
    fight: ["You're going to be fun to kill.", "Kneel!", "So many of you. So little time."],
  },
  tune(m) {
    m.environmentIntensity = 1.3;
  },
  setup(h) {
    // her two Necroswords stay (they're skinned to her hand props); the spear and the halberd in
    // the file aren't used — hidden. The swords appear in her entrance.
    const sw: { setEnabled(v: boolean): void }[] = [];
    for (const m of h.rig.meshes) {
      if (/^(Spear|Halbred)_Mesh/.test(m.name)) m.setEnabled(false);
      else if (/^Sword_mesh/.test(m.name)) sw.push(m);
    }
    (h as { _swords?: typeof sw })._swords = sw;
  },
  after(h, dt) {
    guardTick(h, dt, NECRO);
  },
};

// ================================================================== RED SKULL
const TESS = new Color3(0.35, 0.65, 1);
const RS_STANCE = pose(
  {
    hips: [0, 1, 0.03], spine: [0, 1, 0.05], spine1: [0, 1, 0.05], spine2: [0, 1, 0.03], neck: [0, 1, 0.05], head: [0, 0.99, 0.12],
    // the pistol in his right hand, low and ready; the left arm behind his back (an officer)
    rArm: [0.3, -0.9, 0.3], rFore: [0.15, -0.3, 0.94], rHand: [0.1, -0.1, 0.99],
    lArm: [-0.2, -0.95, -0.25], lFore: [0.4, -0.3, -0.85],
    lThigh: [-0.12, -0.98, 0.1], rThigh: [0.13, -0.98, -0.05],
  },
  [0, 0.98, 0],
);
const RS_THROW = pose(
  {
    hips: [0, 1, 0.02], spine: [0, 1, -0.05], spine1: [0, 1, -0.08], spine2: [0, 1, -0.05], neck: [0, 1, 0.05], head: [0, 0.99, 0.12],
    lArm: [-0.4, 0.4, 0.82], lFore: [-0.1, 0.8, 0.6], lHand: [0, 0.9, 0.45],
    rArm: [0.3, -0.9, 0.3], rFore: [0.15, -0.3, 0.94],
    lThigh: [-0.15, -0.92, 0.35], rThigh: [0.16, -0.95, -0.25],
  },
  [0, 0.95, 0],
);
/** a grenade lobbed at the target: it lands, it sits a moment, it goes — you can see where */
const RS_GRENADE: Move = {
  start(h, a) {
    if (!a.tgt) return false;
    a.data.at = h.tgtGround(a.tgt);
    a.dur = 1.9;
    h.faceTo(a.data.at as Vector3);
  },
  threat(h, a): HulkThreat | null {
    if (a.n > 1) return null;
    const at = a.data.at as Vector3;
    return { kind: "throw", at: at.clone(), dir: flat(at.subtract(h.p)).normalize(), radius: 4.5, cone: Math.PI, t: Math.max(0, 1.6 - a.t), target: a.tgt && "hero" in a.tgt ? a.tgt.hero : null };
  },
  frame(h, a) {
    const at = a.data.at as Vector3;
    if (a.t > 0.45 && a.n === 0) {
      a.n = 1;
      const from = h.hand("l");
      h.host.audio.play("swingWhoosh", { x: from.x, y: from.y, z: from.z, volume: 0.5, rate: 1.3 });
      h.host.bolts.fire(from, at.add(V(0, 0.2, 0)), 22, new Color3(0.5, 0.5, 0.4), new Color3(0.2, 0.2, 0.15), 0.6, null);
    }
    // (the warning: a red ring blinking where it lies)
    if (a.t > 0.8 && a.n === 1 && Math.random() < 0.6) {
      const ang = rnd(0, Math.PI * 2);
      h.host.glow.emit(at.add(V(Math.sin(ang) * 4, 0.1, Math.cos(ang) * 4)), V(0, 0.4, 0), 0.3, 0.35, 0, new Color3(1, 0.2, 0.1), new Color3(1, 0.2, 0.1), 0.8, 0, 0);
    }
    if (a.t > 1.6 && a.n === 1) {
      a.n = 2;
      h.host.blast(at.add(V(0, 0.3, 0)), 4.5, h.book.def("grenade")?.damage ?? 35);
    }
  },
  pose(_h, a, want) {
    copyPose(a.t < 0.7 ? RS_THROW : RS_STANCE, want);
    return 18;
  },
};
const RS_ORDERS: Move = {
  start(h, a) {
    a.dur = 1.4;
    h.say("Hydra! To me!", 2.2);
    h.host.audio.play("foley", { x: h.p.x, y: h.p.y + 1, z: h.p.z, volume: 0.7 });
  },
  frame(h, a) {
    if (a.t > 0.6 && a.n === 0) {
      a.n = 1;
      const came = (h.host as { guards?: (at: Vector3, n: number) => number }).guards?.(h.p.clone(), 3) ?? 0;
      if (!came) h.say("…Hydra? HYDRA!", 1.6);
    }
  },
  pose(_h, _a, want) {
    copyPose(RS_STANCE, want);
    // (the left fist up: the salute, the order)
    want.d[P.lArm] = normD([-0.25, 0.9, 0.35]);
    want.d[P.lFore] = normD([-0.05, 1, 0.1]);
    return 12;
  },
};
const RS_ENTRANCE: Entrance = {
  dur: 6.5,
  begin(h) {
    const land = spotNear(h, 10, 16, false);
    if (!land) return false;
    const e = h as E;
    e._land = land.clone();
    e._from = land.add(flat(land.subtract(h.host.player.feet)).normalize().scale(8));
    e._beat = 0;
    h.p.copyFrom(e._from);
    h.faceTo(land);
    return true;
  },
  frame(h, t, dt) {
    // an alarm; his guard comes out first and fans out; then he walks through them, unhurried
    const e = h as E;
    const land = e._land!, from = e._from!;
    if (beat(h, 1, t, 0.1)) {
      h.host.audio.play("killConfirm", { x: land.x, y: land.y, z: land.z, volume: 0.8, rate: 0.5 });
      (h.host as { guards?: (at: Vector3, n: number) => number }).guards?.(land.clone(), 3);
    }
    if (t > 1.6 && t < 4.6) {
      Vector3.LerpToRef(from, land, (t - 1.6) / 3, h.p);
      h.v.copyFrom(land.subtract(from).scale(1 / 3));
      if (dt < 0.095 && Math.random() < dt * 2) h.host.audio.play("foley", { x: h.p.x, y: h.p.y, z: h.p.z, volume: 0.4 });
    } else if (t >= 4.6) {
      h.v.setAll(0);
      h.p.copyFrom(land);
      faceYou(h);
    }
    if (beat(h, 2, t, 4.8)) {
      titled(h, "HYDRA");
      h.say("Cut off one head, and two more shall take its place.", 3);
    }
  },
  pose(h, t, want, dt) {
    h.rig.setVisible(t > 1.4);
    if (t > 1.6 && t < 4.6) {
      walkIn(h, dt, want, 2.7 / 3 + 0.6, RS_STANCE);
      return 30;
    }
    copyPose(RS_STANCE, want);
    return 10;
  },
  shot(h, t) {
    const land = (h as E)._land ?? h.p;
    const toYou = flat(h.host.player.feet.subtract(land)).normalize();
    if (t < 4.6) return { pos: land.add(toYou.scale(3)).addInPlaceFromFloats(0, 0.35, 0), target: h.center().add(V(0, 0.4, 0)), fov: 0.8, cut: t < 0.03 };
    return orbit(h, 0.45, 2.6, 0.35, 0.65, t < 4.63, 1.15);
  },
};
export const REDSKULL: Kit = {
  id: "redskull", color: "#b3201b", label: "RS",
  run: 5.8, sprint: 7.5,
  prefer: ["orders", "grenade", "pistol", "combo"],
  holdRange: 14,
  stance: RS_STANCE,
  landing: RS_STANCE,
  rival: "cap",
  moves: {
    pistol: shootMove("pistol", { hands: "r", shots: 3, every: 0.3, speed: 70, core: new Color3(0.8, 0.95, 1), glow: TESS, size: 1.1, sound: "repulsorFire", rate: 1.8 }),
    grenade: RS_GRENADE,
    orders: RS_ORDERS,
    combo: comboMove("combo", [{ clip: "punch", speed: 1.1, hits: [0.4] }, { clip: "hook", speed: 1.1, hits: [0.29] }], 2.2, { launch: 6, up: 3 }),
  },
  phaseMove: RS_ORDERS,
  entrance: RS_ENTRANCE,
  lines: {
    intro: "Cut off one head, and two more shall take its place.",
    hit: ["Impudent.", "You will regret that."],
    down: ["Hail… Hydra…"],
    up: [],
    victory: [],
    fight: ["Hail Hydra!", "You are already defeated.", "Order will be restored."],
  },
};

// ================================================================== MEGATRON
const FUSION = new Color3(0.75, 0.4, 1);
const MEG_STANCE = pose(
  {
    hips: [0, 1, 0.08], spine: [0, 1, 0.14], spine1: [0, 1, 0.16], spine2: [0, 1, 0.12], neck: [0, 0.98, 0.2], head: [0, 0.95, 0.3],
    // hunched forward, the cannon arm (right) forward, the flail hand low
    rArm: [0.55, -0.6, 0.6], rFore: [0.15, -0.1, 0.98], rHand: [0.1, -0.05, 1],
    lArm: [-0.55, -0.8, 0.25], lFore: [-0.3, -0.7, 0.65],
    lThigh: [-0.3, -0.92, 0.25], lShin: [-0.08, -0.98, -0.15], rThigh: [0.3, -0.94, -0.12], rShin: [0.08, -0.96, -0.25],
  },
  [0, 0.92, 0],
);
const MEG_RAISE = pose(
  {
    hips: [0, 1, -0.02], spine: [0, 1, -0.08], spine1: [0, 1, -0.1], spine2: [0, 1, -0.08], neck: [0, 1, 0.05], head: [0, 0.96, 0.25],
    rArm: [0.3, 0.92, 0.2], rFore: [0.05, 1, 0.1], lArm: [-0.3, 0.92, 0.2], lFore: [-0.05, 1, 0.1],
    lThigh: [-0.3, -0.92, 0.2], rThigh: [0.3, -0.94, -0.1],
  },
  [0, 0.95, 0],
);
const fusionAt = (h: RosterHero) => h.hand("r").add(h.fwd().scale(0.9));
const MEG_ENTRANCE: Entrance = {
  dur: 8,
  begin(h) {
    const land = spotNear(h, 16, 24, false);
    if (!land) return false;
    const e = h as E;
    e._land = land.clone();
    e._from = land.add(flat(land.subtract(h.host.player.feet)).normalize().scale(14));
    e._beat = 0;
    h.p.copyFrom(e._from);
    h.faceTo(land);
    return true;
  },
  frame(h, t, dt) {
    // the ground shaking before you see him; out of the snow-haze, step by step, the flail dragging
    // and throwing sparks; he stops, raises both fists, and the cannon lights
    const e = h as E;
    const land = e._land!, from = e._from!;
    if (t < 5) {
      Vector3.LerpToRef(from, land, t / 5, h.p);
      h.v.copyFrom(land.subtract(from).scale(1 / 5));
      const step = Math.floor(t / 0.75);
      if (beat(h, 1 + step, t, step * 0.75)) {
        h.host.audio.play("hulkStep", { x: h.p.x, y: h.p.y, z: h.p.z, volume: 1.2, rate: 0.45 });
        h.host.player.shake(0.3);
        h.host.dust(h.p.clone(), 0.6);
      }
      if (dt < 0.095 && Math.random() < 0.5) h.host.spark(h.hand("l").subtract(V(0, 1.2, 0)), V(0, 1, 0));
    } else {
      h.v.setAll(0);
      h.p.copyFrom(land);
      faceYou(h);
    }
    if (beat(h, 20, t, 5.2)) {
      h.host.audio.play("hulkRoar", { x: h.p.x, y: h.p.y + 4, z: h.p.z, volume: 1, rate: 0.55 });
      h.host.player.shake(0.5);
    }
    if (t > 6 && dt < 0.095) h.host.glow.emit(fusionAt(h), V(rnd(-0.5, 0.5), rnd(-0.5, 0.5), rnd(-0.5, 0.5)), 0.3, 0.5, 1, new Color3(1, 0.85, 1), FUSION, 0.9, 2, 0);
    if (beat(h, 21, t, 6.2)) {
      titled(h, "LEADER OF THE DECEPTICONS");
      h.say("Megatron has arrived. Kneel, or be scrapped.", 3);
    }
  },
  pose(h, t, want, dt) {
    if (t < 5) {
      walkIn(h, dt, want, 14 / 5, MEG_STANCE);
      return 30;
    }
    copyPose(t < 6 ? MEG_RAISE : MEG_STANCE, want);
    return 8;
  },
  shot(h, t) {
    const land = (h as E)._land ?? h.p;
    const toYou = flat(h.host.player.feet.subtract(land)).normalize();
    const side = V(toYou.z, 0, -toYou.x);
    if (t < 5) return { pos: land.add(toYou.scale(6)).add(side.scale(2)).addInPlaceFromFloats(0, 0.4, 0), target: h.center().add(V(0, 1.5, 0)), fov: 0.95, cut: t < 0.03 };
    return orbit(h, 0.4, 12, 1.6, 0.8, t < 5.03, 1.05);
  },
};
export const MEGATRON: Kit = {
  id: "megatron", color: "#6b6b78", label: "MG",
  run: 5, sprint: 7,
  prefer: ["slam", "cannon", "flail"],
  holdRange: 4,
  stance: MEG_STANCE,
  landing: MEG_STANCE,
  rival: "ironhide",
  moves: {
    cannon: shootMove("cannon", { hands: "r", shots: 3, every: 0.45, speed: 50, core: new Color3(1, 0.9, 1), glow: FUSION, size: 2.6, sound: "repulsorFire", rate: 0.5, splash: 3.5, muzzle: (h) => fusionAt(h) }),
    flail: comboMove("flail", [{ clip: "smash", speed: 0.75, hits: [0.41] }, { clip: "hook", speed: 0.75, hits: [0.29] }, { clip: "mmaKick3", speed: 0.8, hits: [0.388] }], 4.6, { launch: 18, up: 7, force: 3, sound: "impactMetal" }),
    slam: slamMove("slam", { wind: 1, radius: 8, at: "self", color: FUSION, launch: 15, pose: (_h, a, want) => copyPose(a.t < 1 ? MEG_RAISE : MEG_STANCE, want) }),
  },
  // (the heavy phase: a barrage from the cannon, harder blows from then on)
  phaseMove: {
    ...shootMove("cannon", { hands: "r", shots: 8, every: 0.22, speed: 55, core: new Color3(1, 0.9, 1), glow: FUSION, size: 2.4, sound: "repulsorFire", rate: 0.55, splash: 3.5, muzzle: (h) => fusionAt(h) }),
    start(h, a) {
      a.dur = 0.25 + 8 * 0.22;
      h.power = 1.3;
      h.say("I will tear you apart, piece by piece!", 2.6);
    },
  },
  entrance: MEG_ENTRANCE,
  lines: {
    intro: "Megatron has arrived.",
    hit: ["Pathetic.", "Insect."],
    down: ["This… is not… over…"],
    up: [],
    victory: [],
    fight: ["Decepticons, attack!", "You fight for nothing!", "Scrap them all!"],
  },
  tune(m: PBRMaterial) {
    m.metallic = Math.min(m.metallic ?? 0.5, 0.5);
    m.roughness = Math.max(m.roughness ?? 0.4, 0.35);
    m.environmentIntensity = 1.5;
    m.albedoColor = m.albedoColor.scale(1.25);
  },
};

// ================================================================== VENOM
const SYMB = new Color3(0.02, 0.02, 0.03);
const SYMB2 = new Color3(0.06, 0.06, 0.1);
const VEN_STANCE = pose(
  {
    hips: [0, 1, 0.12], spine: [0, 0.98, 0.22], spine1: [0, 0.96, 0.28], spine2: [0, 0.95, 0.3], neck: [0, 0.9, 0.42], head: [0, 0.85, 0.52],
    // hunched, claws out wide
    lArm: [-0.75, -0.5, 0.42], lFore: [-0.3, -0.3, 0.9], lHand: [-0.2, -0.4, 0.9],
    rArm: [0.75, -0.5, 0.42], rFore: [0.3, -0.3, 0.9], rHand: [0.2, -0.4, 0.9],
    lThigh: [-0.3, -0.88, 0.35], lShin: [-0.08, -0.97, -0.2], rThigh: [0.3, -0.9, 0.1], rShin: [0.08, -0.95, -0.3],
  },
  [0, 0.88, 0.02],
);
/** the tendrils: a black lash from his chest to the target, and back with it */
const VEN_TENDRILS: Move = {
  start(h, a) {
    if (!a.tgt) return false;
    a.dur = 1.1;
    h.faceTo(h.tgtGround(a.tgt));
  },
  threat(h, a): HulkThreat | null {
    if (!a.tgt || a.n > 0) return null;
    return { kind: "punch", at: h.p.clone(), dir: h.fwd(), radius: 12, cone: 0.35, t: Math.max(0, 0.55 - a.t), target: "hero" in a.tgt ? a.tgt.hero : null };
  },
  frame(h, a, dt) {
    const t = a.tgt;
    if (!t || !h.tgtAlive(t)) return a.n > 0;
    const from = h.center().add(h.fwd().scale(0.3)), to = h.aimOf(t);
    h.turnTo(Math.atan2(to.x - h.p.x, to.z - h.p.z), dt, 6);
    // out to it (0.3–0.55 s), holding, then back (to 0.9 s)
    const k = a.t < 0.3 ? 0 : a.t < 0.55 ? (a.t - 0.3) / 0.25 : a.t < 0.7 ? 1 : Math.max(0, 1 - (a.t - 0.7) / 0.25);
    if (dt < 0.095 && k > 0) for (let i = 0; i < 3; i++) {
      for (let j = 0; j < 8; j++) {
        const f = (j / 8) * k;
        const p = Vector3.Lerp(from, to, f).add(V(Math.sin(a.t * 30 + i * 2 + j) * 0.15, Math.cos(a.t * 25 + i + j) * 0.15, 0));
        h.host.smoke.emit(p, V(), 0.08, 0.16, 0, SYMB, SYMB2, 0.95, 0, 0);
      }
    }
    if (a.t > 0.55 && a.n === 0) {
      a.n = 1;
      const toMe = flat(h.p.subtract(h.tgtGround(t)));
      h.hit(t, h.book.def("tendrils")?.damage ?? 24, toMe, { force: 3, launch: Math.min(12, toMe.length() * 1.4), up: 3 });
      h.host.audio.play("hulkClap", { x: to.x, y: to.y, z: to.z, volume: 0.5, rate: 1.6 });
    }
  },
  pose(h, a, want) {
    copyPose(VEN_STANCE, want);
    if (a.tgt) {
      armAt(h, want, "l", h.aimOf(a.tgt));
      armAt(h, want, "r", h.aimOf(a.tgt));
    }
    return 22;
  },
};
/** the symbiote knits him back together: a quarter of his health over four seconds */
const VEN_FEED: Move = {
  start(h, a) {
    if (h.health > h.maxHealth * 0.7) return false;
    a.dur = 1.2;
    (h as { _feedT?: number })._feedT = 4;
    h.say("We… are hungry.", 2);
  },
  frame() {},
  pose(_h, _a, want) {
    copyPose(VEN_STANCE, want);
    want.d[P.head] = normD([0, 0.6, 0.8]);
    return 10;
  },
};
const VEN_ENTRANCE: Entrance = {
  dur: 6.5,
  begin(h) {
    const land = spotNear(h, 7, 12, false);
    if (!land) return false;
    const e = h as E;
    e._land = land.clone();
    e._beat = 0;
    h.p.copyFrom(land);
    faceYou(h);
    return true;
  },
  frame(h, t, dt) {
    // a black shape where there was nothing — a man-sized knot of the stuff, writhing, and growing,
    // and growing: then the teeth, the tongue, and that voice
    const e = h as E;
    const land = e._land!;
    const live = dt < 0.095;
    const k = t < 0.8 ? 0.25 : Math.min(1, 0.25 + 0.75 * ((t - 0.8) / 2.6));
    h.rig.anchor.scaling.setAll(t >= this.dur - 0.05 ? 1 : k);
    // (a writhing knot about his size — round him, never a cloud over the lens)
    if (live && t < 3.6) for (let i = 0; i < 3; i++) {
      const p = land.add(V(rnd(-0.5, 0.5) * k, rnd(0.2, 2) * k, rnd(-0.5, 0.5) * k));
      h.host.smoke.emit(p, V(rnd(-0.6, 0.6), rnd(-0.3, 0.6), rnd(-0.6, 0.6)), rnd(0.3, 0.55), rnd(0.18, 0.32) * (0.5 + k), 0.3, SYMB, SYMB2, 0.95, 1, 0);
    }
    if (beat(h, 1, t, 0.3)) h.host.audio.play("hulkRoar", { x: land.x, y: land.y + 1, z: land.z, volume: 0.4, rate: 2.2 });
    if (beat(h, 2, t, 3.6)) {
      h.host.audio.play("hulkRoar", { x: land.x, y: land.y + 1, z: land.z, volume: 1, rate: 1.3 });
      h.host.player.shake(0.3);
    }
    if (beat(h, 3, t, 4.2)) {
      titled(h, h.side === "hero" ? "LETHAL PROTECTOR" : "THE SYMBIOTE");
      h.say("We are… Venom.", 2.6);
    }
  },
  pose(_h, t, want) {
    copyPose(VEN_STANCE, want);
    if (t > 3.6 && t < 4.6) {
      want.d[P.lArm] = normD([-0.9, 0.2, 0.35]);
      want.d[P.rArm] = normD([0.9, 0.2, 0.35]);
      want.d[P.head] = normD([0, 0.9, 0.3]);
    }
    return 10;
  },
  shot(h, t) {
    const land = (h as E)._land ?? h.p;
    const toYou = flat(h.host.player.feet.subtract(land)).normalize();
    if (t < 3.6) return { pos: land.add(toYou.scale(3.4)).addInPlaceFromFloats(0, 0.6, 0), target: land.add(V(0, 0.9, 0)), fov: 0.8, cut: t < 0.03 };
    return orbit(h, 0.3, 2.4, 0.5, 0.62, t < 3.63, 1.2);
  },
};
export const VENOM: Kit = {
  id: "venom", color: "#20202a", label: "VE",
  run: 8.5, sprint: 11,
  prefer: ["feed", "leap", "tendrils", "combo"],
  holdRange: 2.6,
  stance: VEN_STANCE,
  landing: VEN_STANCE,
  rival: "spiderman",
  moves: {
    combo: comboMove("combo", [{ clip: "combo", speed: 1.2, hits: [0.12, 0.32, 0.56, 0.79] }, { clip: "smash", speed: 1.1, hits: [0.41] }, { clip: "elbowCombo", speed: 1.2, hits: [0.3, 0.62] }], 2.8, { launch: 12, up: 5, force: 2.5, sound: "superPunch" }),
    tendrils: VEN_TENDRILS,
    leap: dashMove("leap", { speed: 20, reach: 1.7, launch: 12, up: 6, sound: "swingWhoosh", pose: (_h, _a, want) => copyPose(TUCK, want) }),
    feed: VEN_FEED,
  },
  phaseMove: VEN_FEED,
  entrance: VEN_ENTRANCE,
  lines: {
    intro: "We are… Venom.",
    hit: ["That tickles, snack.", "Is that all?"],
    down: ["We… need… a moment."],
    up: ["We're back. And hungry."],
    victory: ["Delicious."],
    fight: ["We will feast!", "Run, little snack.", "Hungry…"],
  },
  tune(m) {
    m.environmentIntensity = 1.4;
  },
  after(h, dt) {
    const e = h as { _feedT?: number };
    if (e._feedT && e._feedT > 0) {
      e._feedT -= dt;
      h.health = Math.min(h.maxHealth, h.health + h.maxHealth * 0.25 * (dt / 4));
      if (Math.random() < dt * 20) h.host.smoke.emit(h.center().add(V(rnd(-0.5, 0.5), rnd(-0.8, 0.8), rnd(-0.5, 0.5))), V(0, 0.5, 0), 0.5, 0.3, 0.3, SYMB, SYMB2, 0.9, 0, 0);
    }
  },
};

// ================================================================== GODZILLA
const ATOMIC2 = new Color3(0.1, 0.35, 1);
/** his own clip, cut into its moves (it's one 10 s take: an idle, a roar, a stomp, a lunge) */
const GZ_CUTS: Record<string, [number, number]> = { gzIdle: [0, 1.3], gzRoar: [1.5, 4.4], gzStomp: [5.5, 7.5], gzLunge: [7.6, 9] };
function cut(c: DirClip, a: number, b: number): DirClip {
  return { ...c, frames: c.frames.slice(Math.round(a * c.fps), Math.round(b * c.fps)) };
}
const gzOwn = (h: RosterHero, n: string) => h.own[n] ?? h.clips.punch;
const LEGS = [P.lThigh, P.lShin, P.lFoot, P.rThigh, P.rShin, P.rFoot];
/** his tread: the shared walk's legs under his own idle body (no walk comes with the model) */
function gzGait(h: RosterHero, speed: number, dt: number, want: Pose) {
  const e = h as { _gph?: number; _tmp?: Pose };
  // (a stride of ~6 m: slow, heavy steps)
  e._gph = (e._gph ?? 0) + dt * (speed / 4.5);
  sample(gzOwn(h, "gzIdle"), h.time % 1.3, true, want);
  const tmp = (e._tmp ??= pose({}, [0, 1, 0]));
  sample(h.clips.walk, e._gph, true, tmp);
  for (const k of LEGS) {
    const a = want.d[k], b = tmp.d[k];
    want.d[k] = normD([a[0] * 0.35 + b[0] * 0.65, a[1] * 0.35 + b[1] * 0.65, a[2] * 0.35 + b[2] * 0.65]);
  }
  const step = Math.floor(e._gph * 2);
  if (step !== (h as { _step?: number })._step) {
    (h as { _step?: number })._step = step;
    h.host.audio.play("hulkStep", { x: h.p.x, y: h.p.y, z: h.p.z, volume: 1.4, rate: 0.3 });
    const d = Vector3.Distance(h.p, h.host.player.feet);
    h.host.player.shake(Math.max(0, 0.45 - d / 120));
    h.host.dust(h.p.add(V(rnd(-2, 2), 0, rnd(-2, 2))), 1.2);
  }
  return 20;
}
/** the tail: sixty joints, each turned a little on its rest — a slow sway, or a sweep */
function gzTail(h: RosterHero, dt: number) {
  const e = h as { _tail?: { n: TransformNode; q: Quaternion }[]; _sweep?: number; _sweepT?: number };
  if (!e._tail) return;
  const s = e._sweepT ?? 0;
  if (s > 0) e._sweepT = s - dt;
  const sweep = s > 0 ? Math.sin((1 - s / 1.4) * Math.PI) * (e._sweep ?? 1) : 0;
  const q = new Quaternion();
  e._tail.forEach((j, i) => {
    const sway = Math.sin(h.time * 1.1 - i * 0.18) * 0.018 + sweep * 0.045;
    Quaternion.RotationAxisToRef(V(0, 0, 1), sway, q);
    j.n.rotationQuaternion!.copyFrom(j.q).multiplyInPlace(q);
  });
}
/** the dorsal plates' glow (the model's emissive map): up for the breath, down after */
function gzGlow(h: RosterHero, k: number) {
  for (const m of h.rig.meshes) {
    const mat = m.material as PBRMaterial | null;
    if (mat && mat.emissiveTexture) mat.emissiveIntensity = 0.15 + k * 3;
  }
}
const GZ_ROAR: Move = {
  start(h, a) {
    a.dur = 2.9;
    h.host.audio.play("hulkRoar", { x: h.p.x, y: h.p.y + 12, z: h.p.z, volume: 1.6, rate: 0.32, reverb: 2 });
  },
  threat(h, a): HulkThreat | null {
    if (a.n > 0) return null;
    return { kind: "smash", at: h.p.clone(), dir: h.fwd(), radius: 14, cone: Math.PI, t: Math.max(0, 1 - a.t), target: null };
  },
  frame(h, a) {
    // (the roar itself throws the small ones back: a blast of air, not damage worth the name)
    if (a.t > 1 && a.n === 0) {
      a.n = 1;
      h.host.player.shake(0.7);
      h.host.rings.boom(h.rig.atCached("Head"), h.fwd(), 20);
      for (const x of h.around(h.p, 14)) h.hit(x, 6, flat(h.tgtGround(x).subtract(h.p)).add(V(0, 0.01, 0)), { force: 2, launch: 9, up: 3 });
    }
  },
  pose(h, a, want) {
    sample(gzOwn(h, "gzRoar"), a.t, false, want);
    return 14;
  },
};
const GZ_TAIL = ((m: Move): Move => ({
  ...m,
  start(h, a) {
    m.start(h, a);
    (h as { _sweepT?: number })._sweepT = 1.4;
    (h as { _sweep?: number })._sweep = Math.random() < 0.5 ? 1 : -1;
    a.dur = Math.max(a.dur ?? 0, 1.6);
  },
}))(slamMove("tail", { wind: 0.9, radius: 13, at: "self", color: new Color3(0.8, 0.9, 1), launch: 20, pose: (h, a, want) => sample(gzOwn(h, "gzIdle"), a.t, true, want) }));
/** the breath on film: from beside and behind his head, along the beam to where it lands (his first two) */
function gzBreathShot(h: RosterHero, t: number) {
  const H = h.def.height;
  const head = h.rig.atCached("Head");
  const f = h.fwd(), side = V(f.z, 0, -f.x);
  const aim = (h.action?.data.aim as Vector3 | undefined) ?? head.add(f.scale(30)).subtractFromFloats(0, H * 0.6, 0);
  // (first the charge — the plates lighting, close on him; then wide, the beam and where it lands)
  if (t < 1.6) return { pos: head.add(side.scale(H * 0.55)).add(f.scale(H * 0.25)).addInPlaceFromFloats(0, -H * 0.15, 0), target: head.subtract(f.scale(H * 0.15)), fov: 0.8, cut: t < 0.03 };
  return { pos: head.add(side.scale(H * 0.9)).subtract(f.scale(H * 0.5)).addInPlaceFromFloats(0, H * 0.05, 0), target: Vector3.Lerp(head, aim, 0.55), fov: 0.95, cut: t < 1.63 };
}
const GZ_BREATH = ((m: Move): Move => ({
  ...m,
  start(h, a) {
    const r = m.start(h, a);
    if (r === false) return false;
    h.host.audio.play("repulsorCharge", { x: h.p.x, y: h.p.y + 12, z: h.p.z, volume: 1.2, rate: 0.35 });
    // (his first two, filmed: you see it coming, and where it goes)
    const e = h as { _breaths?: number };
    e._breaths = (e._breaths ?? 0) + 1;
    if (e._breaths <= 2) h.film = { t: 0, dur: 4.3, shot: gzBreathShot };
    return r;
  },
  frame(h, a, dt) {
    gzGlow(h, Math.min(1, a.t / 1.6));
    const r = m.frame(h, a, dt);
    // (the beam made to read at any distance: blue fire down its length, and a burning blast where it lands)
    const aim = a.data.aim as Vector3 | undefined;
    if (aim && a.t > 1.6 && dt < 0.095) {
      const from = h.rig.atCached("Head").add(h.fwd().scale(h.def.height * 0.1));
      for (let k = 0; k < 8; k++) {
        const p = Vector3.Lerp(from, aim, Math.random());
        h.host.glow.emit(p, V(rnd(-1, 1), rnd(-1, 1), rnd(-1, 1)), rnd(0.15, 0.3), rnd(0.8, 1.8), 1, new Color3(0.8, 0.92, 1), ATOMIC2, 0.9, 2, 0);
      }
      for (let k = 0; k < 6; k++) h.host.glow.emit(aim, V(rnd(-6, 6), rnd(1, 8), rnd(-6, 6)), rnd(0.3, 0.6), rnd(1, 2.2), 2, new Color3(0.85, 0.95, 1), ATOMIC2, 1, 3, 0.5);
      const e = a.data as { boomT?: number };
      e.boomT = (e.boomT ?? 0) - dt;
      if (e.boomT <= 0) {
        e.boomT = 0.35;
        h.host.dust(aim.clone(), 1.2);
        h.host.rings.boom(aim.clone(), V(0, 1, 0), 8);
      }
    }
    if (r || a.t > a.dur - 0.05) gzGlow(h, 0);
    return r;
  },
}))(beamMove("breath", {
  from: (h) => h.rig.atCached("Head").add(h.fwd().scale(h.def.height * 0.1)),
  core: new Color3(0.9, 0.97, 1), sheath: ATOMIC2, width: 8, dur: 2.6, wind: 1.6, sound: "unibeam",
  pose: (h, a, want) => sample(gzOwn(h, a.t < 1.6 ? "gzRoar" : "gzLunge"), a.t < 1.6 ? a.t * 0.5 : 0.4, false, want),
}));
const GZ_ENTRANCE: Entrance = {
  dur: 12,
  begin(h) {
    // from the far side of the field, toward a spot ~40 m from you
    const me = h.host.player.feet;
    const b = h.host.bounds;
    const look = V(Math.sin(h.host.player.yaw), 0, Math.cos(h.host.player.yaw));
    const land = me.add(look.scale(40));
    land.x = Math.max(b.minX + 15, Math.min(b.maxX - 15, land.x));
    land.z = Math.max(b.minZ + 15, Math.min(b.maxZ - 15, land.z));
    const from = land.add(flat(land.subtract(me)).normalize().scale(38));
    from.x = Math.max(b.minX + 6, Math.min(b.maxX - 6, from.x));
    from.z = Math.max(b.minZ + 6, Math.min(b.maxZ - 6, from.z));
    land.y = h.host.nav.floorAt(land.x, 0.5, land.z, 3) ?? 0;
    from.y = h.host.nav.floorAt(from.x, 0.5, from.z, 3) ?? 0;
    const e = h as E & { _breaths?: number };
    e._land = land;
    e._from = from;
    e._beat = 0;
    e._breaths = 0;
    h.p.copyFrom(from);
    h.faceTo(land);
    return true;
  },
  frame(h, t, dt) {
    // a roar from far off; the ground starts to jump, harder each time; out of the haze at the
    // field's edge, the size of a building, he comes on — stops, and roars at you
    const e = h as E;
    const land = e._land!, from = e._from!;
    if (beat(h, 1, t, 0.2)) h.host.audio.play("hulkRoar", { x: from.x, y: from.y + 30, z: from.z, volume: 1.4, rate: 0.28, reverb: 2.5 });
    if (t > 1.5 && t < 7.5) {
      Vector3.LerpToRef(from, land, (t - 1.5) / 6, h.p);
      h.v.copyFrom(land.subtract(from).scale(1 / 6));
    } else if (t >= 7.5) {
      h.v.setAll(0);
      h.p.copyFrom(land);
      h.turnTo(Math.atan2(h.host.player.feet.x - h.p.x, h.host.player.feet.z - h.p.z), dt, 0.6);
    }
    if (beat(h, 2, t, 8)) {
      h.host.audio.play("hulkRoar", { x: h.p.x, y: h.p.y + 12, z: h.p.z, volume: 1.8, rate: 0.3, reverb: 2 });
      h.host.player.shake(0.8);
      h.host.rings.boom(h.rig.atCached("Head"), h.fwd(), 24);
    }
    if (beat(h, 3, t, 8.6)) titled(h, "KING OF THE MONSTERS");
    gzTail(h, dt);
  },
  pose(h, t, want, dt) {
    if (t > 1.5 && t < 7.5) return gzGait(h, 38 / 6, dt, want);
    if (t >= 7.8 && t < 10.7) {
      sample(gzOwn(h, "gzRoar"), t - 7.8, false, want);
      return 14;
    }
    sample(gzOwn(h, "gzIdle"), t % 1.3, true, want);
    return 10;
  },
  shot(h, t) {
    const land = (h as E)._land ?? h.p;
    const me = h.host.player.feet;
    const toYou = flat(me.subtract(land)).normalize();
    const H = h.def.height;
    // wide and low, from beside you; then close under him as he roars
    if (t < 7.5) return { pos: me.add(toYou.scale(-2)).add(V(toYou.z, 0, -toYou.x).scale(5)).addInPlaceFromFloats(0, 1.2, 0), target: h.p.add(V(0, H * 0.55, 0)), fov: 0.9, cut: t < 0.03 };
    return { pos: land.add(toYou.scale(H * 0.9)).add(V(toYou.z, 0, -toYou.x).scale(H * 0.3)).addInPlaceFromFloats(0, 1, 0), target: h.rig.atCached("Head"), fov: 0.85, cut: t < 7.53 };
  },
};
export const GODZILLA: Kit = {
  id: "godzilla", color: "#3d4a5c", label: "GZ",
  run: 4.2, sprint: 5.5,
  giant: true,
  prefer: ["breath", "tail", "roar", "stomp"],
  holdRange: 9,
  stance: pose({}, [0, 1, 0]),
  landing: pose({}, [0, 1, 0]),
  gait: gzGait,
  moves: {
    stomp: slamMove("stomp", { wind: 1.1, radius: 9, at: "self", clip: "gzStomp", color: new Color3(0.8, 0.85, 0.9), launch: 16 }),
    tail: GZ_TAIL,
    breath: GZ_BREATH,
    roar: GZ_ROAR,
  },
  entrance: GZ_ENTRANCE,
  lines: { hit: [], down: [], up: [], victory: [], fight: [] },
  tune(m) {
    // (the file's metal factor is 1 with no metal map: that's a black monster — he's not metal)
    m.metallic = 0;
    m.roughness = 0.75;
    m.environmentIntensity = 1.2;
    m.emissiveIntensity = 0.15;
  },
  setup(h) {
    const all = Object.entries(h.own).find(([k]) => /^All Animations/.test(k))?.[1];
    if (all) for (const [k, [a, b]] of Object.entries(GZ_CUTS)) h.own[k] = cut(all, a, b);
    // his rest stance: the first frame of his idle
    const idle = h.own.gzIdle?.frames[0];
    if (idle) {
      const st = { d: idle.d.map((d) => [d[0], d[1], d[2]] as [number, number, number]), hip: [idle.hip[0], idle.hip[1], idle.hip[2]] as [number, number, number] } as Pose;
      h.kit.stance.d = st.d;
      h.kit.stance.hip = st.hip;
      h.kit.landing.d = st.d;
      h.kit.landing.hip = st.hip;
    }
    // the tail's joints below its first (that one rides the hips)
    const tail: { n: TransformNode; q: Quaternion }[] = [];
    for (let n = h.rig.node("tailJB_JNT_90") as TransformNode | undefined; n; ) {
      if (!n.rotationQuaternion) n.rotationQuaternion = Quaternion.FromEulerVector(n.rotation);
      tail.push({ n, q: n.rotationQuaternion.clone() });
      n = n.getChildren().find((c) => /^tailJ/.test(c.name)) as TransformNode | undefined;
    }
    (h as { _tail?: typeof tail })._tail = tail;
    gzGlow(h, 0);
  },
  after(h, dt) {
    if (h.introT < 0) gzTail(h, dt);
  },
};

export const VILLAIN_KITS2: Record<string, Kit> = { hela: HELA, redskull: REDSKULL, megatron: MEGATRON, venom: VENOM, godzilla: GODZILLA };
export type { RosterVillain };
