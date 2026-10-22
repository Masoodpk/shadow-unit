import { AbstractMesh } from "@babylonjs/core/Meshes/abstractMesh";
import { Color3 } from "@babylonjs/core/Maths/math.color";
import { FreeCamera } from "@babylonjs/core/Cameras/freeCamera";
import { LoadAssetContainerAsync } from "@babylonjs/core/Loading/sceneLoader";
import { Matrix, Quaternion, Vector3 } from "@babylonjs/core/Maths/math.vector";
import { Mesh } from "@babylonjs/core/Meshes/mesh";
import { MeshBuilder } from "@babylonjs/core/Meshes/meshBuilder";
import { PBRMaterial } from "@babylonjs/core/Materials/PBR/pbrMaterial";
import { Scene } from "@babylonjs/core/scene";
import { StandardMaterial } from "@babylonjs/core/Materials/standardMaterial";
import { TransformNode } from "@babylonjs/core/Meshes/transformNode";
import { VertexBuffer } from "@babylonjs/core/Buffers/buffer";
import { AudioEngine } from "../audio/AudioEngine";
import { lookRotation } from "../core/math";
import type { Combatant, Foe, HulkThreat } from "../enemies/Hulk";
import { NavGraph } from "../level/NavGraph";
import { extFor } from "../weapons/ArmsRig";
import type { Dir } from "./SpiderRig";
import { SkinnedModel, type Rig } from "./HeroRig";
import {
  HIT, LANDING, RELAXED, STANCE, TUCK, aimArm, clipDur, copyPose, follow, loadSpiderClips, mixPose, naturalArms, newPose, pose, sample,
  type ClipName, type DirClip,
} from "./SpiderPoses";
import type { SoldierLike } from "./SpiderMan";
import type { TeamBoard } from "./Team";
import "@babylonjs/loaders/glTF/2.0/Extensions/KHR_materials_emissive_strength";
import gunUrl from "../assets/characters/scifi_gun.glb?url";

/**
 * DEADPOOL — on your side ("Deadpool MMD PORT FBX" by Izann2842_o; his twin blasters are "Scifi Gun"
 * by Max; both CC BY 4.0). His model's own MMD skeleton drives him (its bones renamed to Mixamo's
 * by prep-heroes3.mjs), with the swords on his back and the pistols on his hips as part of the
 * suit; he moves on the same bone-direction poses as the others: the soldiers' run and roll,
 * Mixamo's punches, the Punch To Elbow Combo, Smash and three MMA kicks.
 *
 * He turns up in a shipping container: it shakes, something bangs inside, he complains about being
 * locked in, kicks the doors open, steps out, notices the Hulk, says so, and charges.
 *
 * He fights gun-kata: a blaster in each fist, never still —
 *  - strafing runs round the target, both arms out to the side, plasma bolts alternating;
 *  - in close, a kick-and-elbow combo with the guns in his fists, finished point-blank with both;
 *  - a back-flip out of trouble, firing upside down;
 *  - a knee-slide in at the target, both guns blazing;
 *  - a gun-kata spin: arms out, each gun firing as it comes round;
 *  - a leap over the target, shooting down on the way, a stomp on landing;
 *  - a charged twin blast (both barrels glowing) when nobody else just landed a big one;
 *  - the blasters overheat now and then (a vent, a hiss);
 *  - taunts, a look at the camera, a line for everything; he heals, and if he goes down he
 *    "grows back" and gets up complaining. He fights the Hulk, Wolverine and the soldiers.
 */

export interface DeadpoolHost {
  scene: Scene;
  nav: NavGraph;
  audio: AudioEngine;
  player: { feet: Vector3; alive: boolean; yaw: number; health: number; knockedDown: boolean; camera: FreeCamera; shake(a: number): void };
  playerMaxHealth: number;
  hulk: Foe | null;
  soldiers: () => SoldierLike[];
  team: TeamBoard;
  /** the container he's in (prop_entrance), its doors to open */
  container: TransformNode | null;
  tracer: (from: Vector3, to: Vector3) => void;
  dust: (pos: Vector3, power: number) => void;
  spark: (pos: Vector3, normal: Vector3) => void;
}

type Mode = "ground" | "air" | "ko";
export type DeadpoolState =
  | "entrance" | "join" | "follow" | "locate" | "approach" | "melee" | "combo" | "ranged" | "dodge" | "taunt"
  | "recover" | "assist" | "return" | "victory" | "soldier";

interface Action {
  kind: "intro" | "combo" | "shoot" | "strafe" | "slide" | "spin" | "charge" | "reload" | "leap" | "roll" | "flip" | "taunt" | "tumble" | "down" | "getup" | "land" | "victory";
  t: number;
  dur: number;
  clip?: ClipName;
  speed?: number;
  hits?: number[];
  hitsDone?: number;
  damage?: number;
  dir?: Vector3;
  shots?: number;
  target?: SoldierLike | null;
  /** a strafing run: which way round (±1), and the radius he holds */
  turn?: number;
  radius?: number;
  /** a back-flip that shoots */
  firing?: boolean;
}

const G = 20;
const DP = { health: 420, run: 7.2, sprint: 10.2, reach: 2.9, closeIn: 2.0 };
/** his close-in combos (guns in his fists): clip, speed, blows (fraction), damage each */
const COMBOS: { clip: ClipName; speed: number; hits: number[]; damage: number }[] = [
  { clip: "elbowCombo", speed: 1.9, hits: [0.119, 0.371, 0.503, 0.589, 0.861], damage: 13 },
  { clip: "mmaKick", speed: 1.5, hits: [0.258, 0.468], damage: 20 },
  { clip: "mmaKick2", speed: 1.35, hits: [0.265, 0.408, 0.551], damage: 15 },
  { clip: "mmaKick3", speed: 1.3, hits: [0.388], damage: 26 },
  { clip: "hook", speed: 1.35, hits: [0.29], damage: 22 },
  { clip: "combo", speed: 1.6, hits: [0.12, 0.32, 0.56, 0.72, 0.79], damage: 10 },
];
const LINES = {
  inside: ["Okay, who's the idiot that locked the coolest guy in a box?"],
  out: ["Whoa. You started the party without me?"],
  charge: ["Maximum effort!", "Hey Shrek! Wrong movie!", "Big mistake, buddy. Big. Huge."],
  logan: ["Logan! Buddy! Put the claws away, we can hug it out.", "Peanut, stop being a grump!", "You and me, pal. Healing factor cage match."],
  kata: ["Gun-kata, baby!", "Pew pew pew! I make my own sound effects.", "Look ma, no aiming!"],
  heat: ["Ow, hot hot hot!", "Overheating. Story of my life."],
  hit: ["Ow! That's going to leave a mark. For like a minute.", "My spleen! I liked that spleen.", "Rude!"],
  combo: ["Chimichangas!", "Point blank, baby!", "Hold still, I'm working here."],
  shoot: ["Pew pew!", "Say hello to my little friends!", "Two guns. Zero chill."],
  taunt: ["Is that all you got?", "You hit like a Hulk. That's a compliment. He's ours now, by the way.", "Bet you can't catch me! …Please don't catch me."],
  wall: ["Hi, player. Yes, you. Little help?", "This is the part where you shoot him. Hint hint.", "Love the aim. Really. Keep it up."],
  down: ["Ow. My everything.", "Give me a sec, my legs are growing back."],
  up: ["And I'm back! Did you miss me?", "Healing factor, baby!"],
  victory: ["We did it! Group hug? No? Fine.", "Somebody get the big guy a juice box."],
  soldier: ["Sorry, wrong franchise!", "Nothing personal. Okay, a little personal."],
};

const V = (x = 0, y = 0, z = 0) => new Vector3(x, y, z);
const flat = (v: Vector3) => new Vector3(v.x, 0, v.z);
const angDiff = (a: number, b: number) => Math.atan2(Math.sin(a - b), Math.cos(a - b));
const rnd = (a: number, b: number) => a + Math.random() * (b - a);
const pick = <T,>(a: T[]) => a[Math.floor(Math.random() * a.length)];
const norm = (d: Dir): Dir => {
  const l = Math.hypot(d[0], d[1], d[2]) || 1;
  return [d[0] / l, d[1] / l, d[2] / l];
};

/** the pose for the guns-up swagger: both pistols raised beside his head, barrels to the sky */
const GUNS_UP = pose(
  {
    hips: [0, 1, 0], spine: [0, 1, -0.05], spine1: [0, 1, -0.08], spine2: [0, 1, -0.05], neck: [0, 1, 0.1], head: [0, 0.98, 0.18],
    lArm: [-0.75, -0.55, 0.2], lFore: [0.1, 0.98, 0.15], lHand: [0.05, 0.99, 0.1],
    rArm: [0.75, -0.55, 0.2], rFore: [-0.1, 0.98, 0.15], rHand: [-0.05, 0.99, 0.1],
    lThigh: [-0.15, -0.98, 0.05], rThigh: [0.16, -0.98, -0.05],
  },
  [0, 0.99, 0],
);
/** the knee-slide: down on the right knee, the left leg out ahead, leaning back */
const SLIDE = pose(
  {
    hips: [0, 0.9, -0.42], spine: [0, 0.95, -0.3], spine1: [0, 0.97, -0.22], spine2: [0, 0.98, -0.15], neck: [0, 1, 0.1], head: [0, 0.97, 0.25],
    lThigh: [-0.15, -0.25, 0.96], lShin: [-0.05, -0.55, 0.83], lFoot: [-0.05, 0.4, 0.92],
    rThigh: [0.18, -0.95, 0.25], rShin: [0.05, -0.05, -1], rFoot: [0.05, -0.2, -0.98],
  },
  [0, 0.5, -0.1],
);
/** "come at me": arms out wide, palms up, chest out */
const TAUNT = pose(
  {
    hips: [0, 1, -0.05], spine: [0, 1, -0.1], spine1: [0, 1, -0.12], spine2: [0, 1, -0.1], neck: [0, 1, 0.15], head: [0, 0.97, 0.25],
    lArm: [-0.9, -0.35, 0.25], lFore: [-0.75, 0.1, 0.65], lHand: [-0.6, 0.35, 0.72],
    rArm: [0.9, -0.35, 0.25], rFore: [0.75, 0.1, 0.65], rHand: [0.6, 0.35, 0.72],
    lThigh: [-0.2, -0.98, 0.1], rThigh: [0.2, -0.98, -0.05],
  },
  [0, 0.98, 0],
);

export class DeadpoolModel {
  private constructor(
    readonly body: SkinnedModel,
    readonly gun: Mesh,
    readonly muzzle: number,
  ) {}
  static async load(scene: Scene, url: string) {
    // his model's own skeleton (MMD, renamed to Mixamo's by prep-heroes3.mjs) and its own skin
    const body = await SkinnedModel.load(scene, url, 1.86, (m) => {
      m.maxSimultaneousLights = 4;
      m.environmentIntensity = 1.15;
      m.unlit = false;
    });
    // the blaster: one mesh (barrel along +Z, the grip at the origin), 48 cm long
    const gc = await LoadAssetContainerAsync(gunUrl, scene, { pluginExtension: extFor(gunUrl) });
    gc.addAllToScene();
    const gm = gc.meshes.filter((m) => m.getTotalVertices() > 0);
    const gun = mergeParts(gm.map((m) => bakeWorld(m)))!;
    const { len: gunLen } = normaliseGun(gun, 0.48, 0.38, 0.18);
    gun.name = "dpBlasterTpl";
    gun.setEnabled(false);
    for (const m of gc.materials)
      if (m instanceof PBRMaterial) {
        m.maxSimultaneousLights = 4;
        m.environmentIntensity = 1.1;
      }
    for (const n of gc.rootNodes) n.setEnabled(false);
    return new DeadpoolModel(body, gun, gunLen);
  }
}

/** merge parts into one mesh, keeping only the vertex attributes they all have */
export function mergeParts(parts: Mesh[]) {
  if (!parts.length) return null;
  const common = parts.map((m) => new Set(m.getVerticesDataKinds())).reduce((a, b) => new Set([...a].filter((k) => b.has(k))));
  for (const m of parts) for (const k of m.getVerticesDataKinds()) if (!common.has(k)) m.removeVerticesData(k);
  // (a prop whose materials differ only in their colours — the sci-fi blaster has thirty — is drawn
  // with one: each part's colour baked into its vertices; one draw instead of thirty)
  const pbr = parts.map((m) => m.material).filter((x): x is PBRMaterial => x instanceof PBRMaterial);
  const sameMaps = pbr.length === parts.length && new Set(pbr.map((x) => `${x.albedoTexture?.name}|${x.bumpTexture?.name}|${x.metallicTexture?.name}`)).size === 1;
  if (sameMaps && new Set(pbr).size > 4) {
    for (const m of parts) {
      const mat = m.material as PBRMaterial;
      const n = m.getTotalVertices();
      const c = mat.albedoColor, e = mat.emissiveColor;
      const cols = new Float32Array(n * 4);
      // (a glowing part keeps its glow in the colour: bright enough to read as lit)
      for (let i = 0; i < n; i++) {
        cols[i * 4] = Math.min(1, c.r + e.r);
        cols[i * 4 + 1] = Math.min(1, c.g + e.g);
        cols[i * 4 + 2] = Math.min(1, c.b + e.b);
        cols[i * 4 + 3] = 1;
      }
      m.setVerticesData(VertexBuffer.ColorKind, cols);
    }
    const one = (pbr[0].clone("propOneMat") as PBRMaterial);
    one.albedoColor = new Color3(1, 1, 1);
    one.emissiveColor = new Color3(0, 0, 0);
    const merged = Mesh.MergeMeshes(parts, true, true, undefined, false, false);
    if (merged) {
      merged.material = one;
      merged.useVertexColors = true;
      merged.hasVertexAlpha = false;
      return merged;
    }
  }
  // (parts that share a material first merged into one: one draw per material, not one per part)
  const byMat = new Map<unknown, Mesh[]>();
  for (const m of parts) {
    const k = m.material ?? null;
    if (!byMat.has(k)) byMat.set(k, []);
    byMat.get(k)!.push(m);
  }
  const merged = [...byMat.values()].map((g) => (g.length > 1 ? Mesh.MergeMeshes(g, true, true, undefined, false, false)! : g[0]));
  if (merged.length === 1) return merged[0];
  return Mesh.MergeMeshes(merged, true, true, undefined, false, true);
}

/** a loaded mesh's world transform baked in, detached */
export function bakeWorld(m: AbstractMesh) {
  m.computeWorldMatrix(true);
  // (a repeated part comes as an instance: give it geometry of its own first)
  let mesh = m as Mesh;
  if (typeof (m as Mesh).bakeTransformIntoVertices !== "function") {
    const src = (m as unknown as { sourceMesh: Mesh }).sourceMesh;
    mesh = src.clone(m.name + "_own", null, true)!;
    mesh.makeGeometryUnique();
    const W0 = m.getWorldMatrix().clone();
    mesh.setParent(null);
    mesh.position.setAll(0);
    mesh.rotationQuaternion = null;
    mesh.rotation.setAll(0);
    mesh.scaling.setAll(1);
    mesh.bakeTransformIntoVertices(W0);
    m.setEnabled(false);
    return mesh;
  }
  const W = mesh.getWorldMatrix().clone();
  mesh.setParent(null);
  mesh.position.setAll(0);
  mesh.rotationQuaternion = null;
  mesh.rotation.setAll(0);
  mesh.scaling.setAll(1);
  mesh.bakeTransformIntoVertices(W);
  return mesh;
}
/**
 * The pistol from whatever axes it came in: the long axis is the barrel; the muzzle is the end
 * where the model is thin (the grip end is tall); up is the way the barrel sits above the grip.
 * Rebuilt with the barrel along +Z, up +Y, the grip at the origin, scaled to `len`.
 */
export function normaliseGun(m: Mesh, len: number, gripBack = 0.3, gripDown = 0.25) {
  const pos = m.getVerticesData(VertexBuffer.PositionKind)!;
  const n = pos.length / 3;
  const min = V(Infinity, Infinity, Infinity), max = V(-Infinity, -Infinity, -Infinity);
  for (let i = 0; i < n; i++) {
    min.minimizeInPlace(V(pos[i * 3], pos[i * 3 + 1], pos[i * 3 + 2]));
    max.maximizeInPlace(V(pos[i * 3], pos[i * 3 + 1], pos[i * 3 + 2]));
  }
  const size = max.subtract(min).asArray();
  const order = [0, 1, 2].sort((a, b) => size[b] - size[a]);
  const L = order[0], U = order[1];
  const c = min.add(max).scale(0.5).asArray();
  // the two ends of the barrel axis: how tall the model is at each
  const ends = [{ lo: Infinity, hi: -Infinity, sum: 0, k: 0 }, { lo: Infinity, hi: -Infinity, sum: 0, k: 0 }];
  for (let i = 0; i < n; i++) {
    const a = pos[i * 3 + L], u = pos[i * 3 + U];
    const f = (a - min.asArray()[L]) / size[L];
    const e = f < 0.22 ? ends[0] : f > 0.78 ? ends[1] : null;
    if (!e) continue;
    e.lo = Math.min(e.lo, u);
    e.hi = Math.max(e.hi, u);
    e.sum += u;
    e.k++;
  }
  const tall0 = ends[0].hi - ends[0].lo, tall1 = ends[1].hi - ends[1].lo;
  // muzzle: the thin end
  const muzzleSign = tall0 < tall1 ? -1 : 1;
  const muzzle = ends[tall0 < tall1 ? 0 : 1], grip = ends[tall0 < tall1 ? 1 : 0];
  // up: from the grip's low end toward the barrel
  const upSign = Math.sign(muzzle.sum / Math.max(1, muzzle.k) - grip.sum / Math.max(1, grip.k)) || 1;
  const W = order[2];
  const fwd = [0, 0, 0], up = [0, 0, 0], right = [0, 0, 0];
  fwd[L] = muzzleSign;
  up[U] = upSign;
  const f = V(fwd[0], fwd[1], fwd[2]), u = V(up[0], up[1], up[2]);
  const r = Vector3.Cross(u, f);
  void right;
  void W;
  // the grip: low at the grip end, a quarter of the length in from the back
  const gripAt = V(c[0], c[1], c[2]);
  const ga = gripAt.asArray();
  ga[L] = c[L] - (muzzleSign * size[L]) * gripBack;
  ga[U] = c[U] - upSign * size[U] * gripDown;
  const g = V(ga[0], ga[1], ga[2]);
  const k = len / size[L];
  // rows: the new axes in the old coordinates (a rotation into x=r, y=u, z=f), then scale
  const M = Matrix.FromValues(r.x * k, u.x * k, f.x * k, 0, r.y * k, u.y * k, f.y * k, 0, r.z * k, u.z * k, f.z * k, 0, 0, 0, 0, 1);
  m.bakeTransformIntoVertices(Matrix.Translation(-g.x, -g.y, -g.z).multiply(M));
  return { len };
}

export class Deadpool implements Combatant {
  readonly rig: Rig;
  readonly p = V();
  readonly v = V();
  yaw = 0;
  mode: Mode = "ground";
  ai: DeadpoolState = "entrance";
  health = DP.health;
  readonly maxHealth = DP.health;
  private enabled = false;
  private clips!: Record<ClipName, DirClip>;
  private action: Action | null = null;
  private aiT = 0;
  private thinkT = 0;
  private goal: Vector3 | null = null;
  private pace: "walk" | "run" | "sprint" = "run";
  private path: Vector3[] = [];
  private repath = 0;
  private cd = { combo: 0, shoot: 2, strafe: 1, slide: 4, spin: 6, charge: 8, leap: 5, dodge: 0, taunt: 8, quip: 6, wall: 25, soldier: 3, roll: 0, logan: 4 };
  private lastCombo = -1;
  private flank = 1;
  private sinceHurt = 99;
  private koT = 0;
  private reaction = -1;
  private pendingThreat: HulkThreat | null = null;
  private wasFighting = false;
  private shown = newPose();
  private want = newPose();
  private runPhase = 0;
  private gait: "walk" | "run" | "sprint" = "run";
  private flip = { axis: "pitch" as "pitch" | "roll", a: 0, rate: 0 };
  private q = new Quaternion();
  private stillT = 0;
  private stepT = 0;
  private downFor = 0;
  // weapons: a blaster in each fist; plasma bolts in flight; the heat they build
  private guns: TransformNode[] = [];
  private gunMeshes: Mesh[] = [];
  private sinceMelee = 99;
  private heat = 0;
  private flash: Mesh[] = [];
  private flashT = [0, 0];
  private glow = [0, 0];
  private muzzle: number;
  private aimDir = V(0, 0, 1);
  private aimT = 0;
  private bolts: { m: Mesh; from: Vector3; to: Vector3; t: number; dur: number; hit: (() => void) | null }[] = [];
  // the entrance
  private doors: { hinge: TransformNode; closed: number; open: number }[] = [];
  private box: TransformNode | null;
  private intro = { t: -1, at: V(), out: V(), fwd: V(0, 0, 1), said: 0, banged: 0 };
  private boxRest = { p: V(), r: 0 };
  private hud: HTMLDivElement;
  private hudBar: HTMLDivElement;
  private line: HTMLDivElement;
  private lineT = 0;

  private constructor(private host: DeadpoolHost, model: DeadpoolModel) {
    const scene = host.scene;
    this.rig = model.body.spawn("deadpool");
    this.rig.setVisible(false);
    this.muzzle = model.muzzle;
    // the blasters, one in each hand
    for (let i = 0; i < 2; i++) {
      const tn = new TransformNode("dpGun" + i, scene);
      tn.rotationQuaternion = new Quaternion();
      const m = model.gun.clone("dpGunMesh" + i, tn)!;
      m.setEnabled(true);
      m.isPickable = false;
      m.receiveShadows = true;
      this.gunMeshes.push(m);
      this.guns.push(tn);
      // the muzzle: a hot red flash when it fires, a glow building while it charges
      const f = MeshBuilder.CreateSphere("dpFlash" + i, { diameter: 0.2, segments: 8 }, scene);
      const fm = new StandardMaterial("dpFlashMat" + i, scene);
      fm.disableLighting = true;
      fm.emissiveColor = new Color3(1, 0.25, 0.18);
      fm.alphaMode = 1;
      fm.alpha = 0.95;
      f.material = fm;
      f.isPickable = false;
      f.setEnabled(false);
      this.flash.push(f);
    }
    // plasma bolts: a white-hot core in a red sheath, stretched along the flight
    const bm = new StandardMaterial("dpBoltMat", scene);
    bm.disableLighting = true;
    bm.emissiveColor = new Color3(1, 0.3, 0.22);
    bm.alphaMode = 1;
    const core = new StandardMaterial("dpBoltCore", scene);
    core.disableLighting = true;
    core.emissiveColor = new Color3(1, 0.9, 0.85);
    for (let i = 0; i < 24; i++) {
      const m = MeshBuilder.CreateCapsule("dpBolt" + i, { radius: 0.06, height: 0.9, tessellation: 8, subdivisions: 1 }, scene);
      m.material = bm;
      const c = MeshBuilder.CreateCapsule("dpBoltC" + i, { radius: 0.025, height: 0.8, tessellation: 6, subdivisions: 1 }, scene);
      c.material = core;
      c.parent = m;
      c.isPickable = false;
      m.isPickable = false;
      m.rotationQuaternion = new Quaternion();
      m.setEnabled(false);
      this.bolts.push({ m, from: V(), to: V(), t: 1, dur: 0, hit: null });
    }
    this.box = host.container;    this.box = host.container;
    if (this.box) {
      this.boxRest = { p: this.box.position.clone(), r: this.box.rotation.y };
      this.hingeDoors(this.box);
    }
    this.hud = document.createElement("div");
    this.hud.id = "ally-hud-dp";
    this.hud.className = "ally-hud";
    this.hud.innerHTML = `<div class="ally-name">DEADPOOL</div><div class="ally-track"><div class="ally-bar"></div></div><div class="ally-state"></div>`;
    document.getElementById("hud")?.appendChild(this.hud);
    this.hudBar = this.hud.querySelector(".ally-bar") as HTMLDivElement;
    this.hud.style.display = "none";
    this.line = document.createElement("div");
    this.line.id = "dp-line";
    document.getElementById("hud")?.appendChild(this.line);
    this.setWeaponsVisible(false);
  }

  static async create(host: DeadpoolHost, model: DeadpoolModel) {
    const s = new Deadpool(host, model);
    s.clips = await loadSpiderClips();
    return s;
  }

  get weaponMeshes() {
    return [...this.gunMeshes];
  }
  private setWeaponsVisible(v: boolean) {
    for (const g of this.guns) g.setEnabled(v);
  }

  say(text: string, secs = 2.8) {
    this.line.innerHTML = `<b>DEADPOOL</b> ${text}`;
    this.line.classList.add("on");
    this.lineT = secs;
    this.cd.quip = 9 + Math.random() * 8;
  }
  private quip(set: keyof typeof LINES, chance = 1) {
    if (this.cd.quip > 0 || Math.random() > chance) return;
    this.say(pick(LINES[set]));
  }

  // ------------------------------------------------------------------ Combatant
  get feet() {
    return this.p;
  }
  get alive() {
    return this.enabled && this.mode !== "ko" && this.action?.kind !== "intro";
  }
  get active() {
    return this.enabled;
  }
  get cinematic() {
    return this.enabled && this.action?.kind === "intro";
  }
  cineFocus() {
    return this.center().add(V(0, 0.4, 0));
  }
  takeDamage(amount: number, _from: Vector3) {
    if (!this.alive) return;
    this.health = Math.max(0, this.health - amount * 0.5);
    this.sinceHurt = 0;
    this.host.audio.play("fleshHit", { x: this.p.x, y: this.p.y + 1.2, z: this.p.z, volume: 0.7 });
    this.quip("hit", 0.35);
    if (this.health <= 0) this.knockOut();
  }
  knock(vel: Vector3, up = 0) {
    if (!this.alive) return;
    this.v.copyFrom(vel).scaleInPlace(0.85);
    this.v.y = Math.max(this.v.y, up + 1.5);
    this.mode = "air";
    this.p.y += 0.05;
    this.action = { kind: "tumble", t: 0, dur: 9 };
    this.flip = { axis: "pitch", a: 0, rate: -7 };
    this.ai = "recover";
  }
  knockDown(seconds: number) {
    this.downFor = Math.max(this.downFor, seconds * 0.7);
  }
  private knockOut() {
    this.mode = "ko";
    this.koT = 6;
    this.action = { kind: "down", t: 0, dur: 6 };
    this.ai = "recover";
    this.say(pick(LINES.down), 2.6);
  }

  // ------------------------------------------------------------------ the container
  /** hinge each door on its outer edge (the model has them hanging open: find their closed angle) */
  private hingeDoors(box: TransformNode) {
    box.computeWorldMatrix(true);
    const inv = box.getWorldMatrix().clone().invert();
    const doors = box.getChildMeshes(false).filter((m) => /Door[LR]/.test(m.name));
    for (const d of doors) {
      const left = /DoorL/.test(d.name);
      // the hinge: the container's corner on that side, at its door end (+Z)
      const hingeLocal = V(left ? 1.22 : -1.22, 0, 3.03);
      const hinge = new TransformNode("dpHinge" + (left ? "L" : "R"), this.host.scene);
      hinge.parent = box;
      hinge.position.copyFrom(hingeLocal);
      d.computeWorldMatrix(true);
      (d as Mesh).unfreezeWorldMatrix?.();
      d.setParent(hinge);
      // its open angle now: where its free edge points from the hinge (closed points across the end)
      const ext = d.getBoundingInfo().boundingBox;
      void ext;
      const free = this.doorFreeDir(d, hinge, inv);
      const closedDir = V(left ? -1 : 1, 0, 0);
      const openAng = Math.atan2(free.x, free.z) - Math.atan2(closedDir.x, closedDir.z);
      this.doors.push({ hinge, closed: -openAng, open: 0 });
    }
    this.closeDoors();
  }
  /** the direction (box local) from the hinge to the door's far edge */
  private doorFreeDir(d: AbstractMesh, hinge: TransformNode, inv: Matrix) {
    const src = ((d as unknown as { sourceMesh?: Mesh }).sourceMesh ?? (d as Mesh)) as Mesh;
    const pos = src.getVerticesData(VertexBuffer.PositionKind)!;
    d.computeWorldMatrix(true);
    const W = d.getWorldMatrix();
    let far = V(), best = -1;
    for (let i = 0; i < pos.length; i += 3) {
      const l = Vector3.TransformCoordinates(Vector3.TransformCoordinates(V(pos[i], pos[i + 1], pos[i + 2]), W), inv);
      const dd = Math.hypot(l.x - hinge.position.x, l.z - hinge.position.z);
      if (dd > best) (best = dd), (far = l);
    }
    return V(far.x - hinge.position.x, 0, far.z - hinge.position.z).normalize();
  }
  private closeDoors() {
    for (const d of this.doors) d.hinge.rotation.y = d.closed;
  }

  /** a place to stand inside the box and the spot outside its doors (world), and the way out */
  private boxSpots() {
    const b = this.box!;
    b.computeWorldMatrix(true);
    const W = b.getWorldMatrix();
    const inside = Vector3.TransformCoordinates(V(0, 0, 0.9), W);
    const out = Vector3.TransformCoordinates(V(0, 0, 5.2), W);
    const fwd = Vector3.TransformNormal(V(0, 0, 1), W).normalize();
    inside.y = this.host.nav.floorAt(inside.x, inside.y + 1, inside.z, 2) ?? inside.y;
    out.y = this.host.nav.floorAt(out.x, out.y + 1, out.z, 2) ?? out.y;
    return { inside, out, fwd };
  }

  /** the entrance: inside the container, the doors shut — then the show */
  enter() {
    if (!this.box) return this.appear(this.host.player.feet.add(V(3, 0, 3)));
    const { inside, out, fwd } = this.boxSpots();
    this.enabled = true;
    this.health = this.maxHealth;
    this.mode = "ground";
    this.p.copyFrom(inside);
    this.v.setAll(0);
    this.yaw = Math.atan2(fwd.x, fwd.z);
    this.intro = { t: 0, at: inside, out, fwd, said: 0, banged: 0 };
    this.action = { kind: "intro", t: 0, dur: 10.4 };
    this.ai = "entrance";
    this.closeDoors();
    copyPose(STANCE, this.shown);
    this.rig.setVisible(true);
    this.setWeaponsVisible(true);
    this.hud.style.display = "";
  }
  /** no container: he just shows up (and still says something) */
  private appear(at: Vector3) {
    this.enabled = true;
    this.p.copyFrom(at);
    this.mode = "ground";
    this.action = null;
    this.ai = "approach";
    this.rig.setVisible(true);
    this.setWeaponsVisible(true);
    this.hud.style.display = "";
    this.say(pick(LINES.out));
  }
  /** skip: doors open, him outside, into the fight */
  skip() {
    if (this.action?.kind !== "intro") return;
    for (const d of this.doors) d.hinge.rotation.y = d.open;
    this.p.copyFrom(this.intro.out);
    if (this.box) this.box.position.copyFrom(this.boxRest.p);
    this.action = null;
    this.ai = "approach";
  }

  private introFrame(dt: number) {
    const a = this.action!;
    a.t += dt;
    const t = a.t;
    const I = this.intro;
    const h = this.host.hulk;
    const box = this.box!;
    const au = this.host.audio;
    const bangs = [0.55, 1.15, 2.85];
    // A — something's in there: the box jumps with each bang
    if (I.banged < bangs.length && t >= bangs[I.banged]) {
      I.banged++;
      au.play("doorKick", { x: box.position.x, y: 1.3, z: box.position.z, volume: 1, rate: 0.75 + Math.random() * 0.15 });
      au.play("impactMetal", { x: box.position.x, y: 1.3, z: box.position.z, volume: 0.8, rate: 0.6 });
      this.boxShake = 0.35;
    }
    if (t >= 1.5 && I.said === 0) {
      I.said = 1;
      this.say(LINES.inside[0], 3.2);
    }
    // B — the doors: kicked open at 3.4 s, flung out past their stops, swinging back a little
    const burst = 3.4;
    if (t >= burst && I.said < 2) {
      I.said = 2;
      au.play("doorKick", { x: I.out.x, y: 1.3, z: I.out.z, volume: 1.2, rate: 0.6 });
      au.play("hulkSlam", { x: I.out.x, y: 1, z: I.out.z, volume: 0.5, rate: 1.6 });
      au.play("impactMetal", { x: I.out.x, y: 1.3, z: I.out.z, volume: 1, rate: 0.45 });
      this.host.dust(I.at.add(I.fwd.scale(2.6)), 0.4);
      this.host.player.shake(0.15);
      this.boxShake = 0.5;
    }
    for (const d of this.doors) {
      if (t < burst) d.hinge.rotation.y = d.closed + (Math.random() - 0.5) * 0.02 * this.boxShake;
      else {
        const f = Math.min(1, (t - burst) / 0.28);
        // fast out, past the stop, and back (a damped spring)
        const over = t - burst > 0.28 ? Math.exp(-(t - burst - 0.28) * 5) * Math.sin((t - burst - 0.28) * 14) * 0.18 : 0;
        d.hinge.rotation.y = d.closed + (d.open - d.closed) * (1 - Math.pow(1 - f, 3)) + over * Math.sign(d.open - d.closed);
      }
    }
    // the box shakes with the bangs
    this.boxShake = Math.max(0, this.boxShake - dt * 2.5);
    box.position.copyFrom(this.boxRest.p).addInPlaceFromFloats((Math.random() - 0.5) * 0.05 * this.boxShake, Math.random() * 0.03 * this.boxShake, (Math.random() - 0.5) * 0.05 * this.boxShake);
    // C — out he comes, a look at you, a look at the Hulk — the line — the guns — and he's off
    const walkFrom = 4.0, walkTo = 6.2;
    if (t > walkFrom && t < walkTo) {
      const f = (t - walkFrom) / (walkTo - walkFrom);
      Vector3.LerpToRef(I.at, I.out, f, this.p);
      this.v.copyFrom(I.out.subtract(I.at).scale(1 / (walkTo - walkFrom)));
      this.yaw = Math.atan2(I.fwd.x, I.fwd.z);
    } else this.v.setAll(0);
    if (t >= walkTo && h) this.turnTo(Math.atan2(h.position.x - this.p.x, h.position.z - this.p.z), dt, 3);
    if (t >= 6.7 && I.said < 3) {
      I.said = 3;
      this.say(LINES.out[0], 2.8);
    }
    if (t >= 8.4 && I.said < 4) {
      I.said = 4;
      au.play("pistolMagIn", { x: this.p.x, y: this.p.y + 1.3, z: this.p.z, volume: 0.7 });
      au.play("slideRelease", { x: this.p.x, y: this.p.y + 1.3, z: this.p.z, volume: 0.7 });
    }
    if (t >= a.dur) {
      box.position.copyFrom(this.boxRest.p);
      this.action = null;
      this.ai = "approach";
      this.say(pick(LINES.charge), 2);
    }
  }
  private boxShake = 0;

  /**
   * The entrance's camera: on the container as it shakes; in close and low as the doors fly open;
   * on him as he looks at you, then at the Hulk; and behind his shoulder as he charges.
   */
  cineShot(): { pos: Vector3; target: Vector3; fov: number; cut?: boolean } | null {
    const a = this.action;
    if (!this.enabled || a?.kind !== "intro") return null;
    const I = this.intro, t = a.t;
    const side = V(I.fwd.z, 0, -I.fwd.x);
    const door = I.at.add(I.fwd.scale(2.2)).addInPlaceFromFloats(0, 1.3, 0);
    if (t < 3.3) return { pos: door.add(I.fwd.scale(7.5)).addInPlace(side.scale(2.2)).addInPlaceFromFloats(0, 0.6, 0), target: door, fov: 0.75 - t * 0.04, cut: t < 0.03 };
    if (t < 6.3) {
      const f = (t - 3.3) / 3;
      return { pos: door.add(I.fwd.scale(5 - f * 0.8)).addInPlace(side.scale(-1.6)).addInPlaceFromFloats(0, -0.6, 0), target: this.p.add(V(0, 1.2, 0)), fov: 0.8, cut: t < 3.33 };
    }
    const fwd = V(Math.sin(this.yaw), 0, Math.cos(this.yaw));
    const right = V(Math.cos(this.yaw), 0, -Math.sin(this.yaw));
    if (t < 8.2) return { pos: this.p.add(fwd.scale(3.2)).addInPlace(right.scale(1.1)).addInPlaceFromFloats(0, 1.5, 0), target: this.p.add(V(0, 1.35, 0)), fov: 0.75, cut: t < 6.33 };
    const h = this.host.hulk;
    const look = h ? h.position.add(V(0, 1.8, 0)) : this.p.add(fwd.scale(10));
    return { pos: this.p.subtract(fwd.scale(2.4)).addInPlace(right.scale(0.9)).addInPlaceFromFloats(0, 1.85, 0), target: look, fov: 0.72, cut: t < 8.23 };
  }

  // ------------------------------------------------------------------ frame
  update(dt: number) {
    if (!this.enabled) return;
    for (const k of Object.keys(this.cd) as (keyof typeof this.cd)[]) this.cd[k] -= dt;
    this.aiT += dt;
    this.sinceHurt += dt;
    this.sinceMelee += dt;
    if (this.lineT > 0 && (this.lineT -= dt) <= 0) this.line.classList.remove("on");
    // the healing factor (after a few seconds unhurt)
    if (this.mode !== "ko" && this.sinceHurt > 3 && this.health < this.maxHealth) this.health = Math.min(this.maxHealth, this.health + 7 * dt);
    if (this.action?.kind === "intro") this.introFrame(dt);
    else if (this.mode === "ko") this.recovering(dt);
    else {
      this.react(dt);
      this.think(dt);
      this.act(dt);
    }
    this.move(dt);
    if (!isFinite(this.p.x + this.p.y + this.p.z + this.v.x + this.v.y + this.v.z + this.yaw)) {
      console.warn("deadpool: bad state, back by the player");
      this.p.copyFrom(this.host.player.feet.add(V(1.5, 0, 0)));
      this.v.setAll(0);
      this.mode = "ground";
    }
    this.animate(dt);
    this.placeWeapons(dt);
    this.hudBar.style.width = `${(100 * this.health) / this.maxHealth}%`;
    this.hud.classList.toggle("ko", this.mode === "ko");
    (this.hud.querySelector(".ally-state") as HTMLDivElement).textContent = this.mode === "ko" ? "REGENERATING" : "";
  }

  private center() {
    return this.p.add(V(0, 1.0, 0));
  }
  private get hulk() {
    const h = this.host.hulk;
    return h && h.alive && h.state !== "dormant" ? h : null;
  }
  private chestOf(h: Foe) {
    return h.position.add(V(0, 1.7 * h.size, 0));
  }
  private busy() {
    return !!this.action && this.action.kind !== "victory";
  }

  // ------------------------------------------------------------------ reading the Hulk
  private react(dt: number) {
    const h = this.hulk;
    if (!h || h.cinematic) return;
    if (this.reaction >= 0) {
      this.reaction -= dt;
      if (this.reaction < 0 && this.pendingThreat) this.dodge(this.pendingThreat);
      return;
    }
    if (this.cd.dodge > 0 || this.mode !== "ground") return;
    if (this.action && (this.action.kind === "tumble" || this.action.kind === "down" || this.action.kind === "roll" || this.action.kind === "getup" || this.action.kind === "leap")) return;
    const t = h.threat();
    if (!t || t.t > 0.5 || !this.inDanger(t)) return;
    this.reaction = rnd(0.05, 0.2);
    this.pendingThreat = t;
  }
  private inDanger(t: HulkThreat) {
    const to = this.p.subtract(t.at);
    if (Math.abs(to.y) > 2.6) return false;
    to.y = 0;
    const d = to.length();
    if (d > t.radius + 0.6) return false;
    if (t.cone >= Math.PI || d < 0.5) return true;
    return Math.abs(angDiff(Math.atan2(to.x, to.z), Math.atan2(t.dir.x, t.dir.z))) < t.cone + 0.25;
  }
  /** an evasive roll — sideways out of a clap, back from a fist, out of a landing's circle */
  private dodge(t: HulkThreat) {
    this.pendingThreat = null;
    this.cd.dodge = 0.9;
    const away = flat(this.p.subtract(t.at));
    if (away.lengthSquared() < 1e-3) away.set(Math.sin(this.yaw + Math.PI), 0, Math.cos(this.yaw + Math.PI));
    away.normalize();
    const side = V(away.z, 0, -away.x).scale(Math.random() < 0.5 ? 1 : -1);
    const dir = t.kind === "clap" ? side : t.kind === "punch" ? away.add(side.scale(0.6)).normalize() : away;
    this.startRoll(dir, t.kind === "leap" || t.kind === "smash" ? 9.5 : 8);
    this.ai = "dodge";
  }
  private startRoll(dir: Vector3, speed: number) {
    // (a roll faces the way he's going; a back-roll if it's behind him)
    const behind = Vector3.Dot(dir, V(Math.sin(this.yaw), 0, Math.cos(this.yaw))) < -0.3;
    if (behind && Math.random() < 0.6) {
      // a back-flip out of it
      this.v.set(dir.x * 7, 5.5, dir.z * 7);
      this.mode = "air";
      this.p.y += 0.05;
      this.flip = { axis: "pitch", a: 0, rate: -8.5 };
      this.action = { kind: "flip", t: 0, dur: 9 };
      return;
    }
    this.yaw = Math.atan2(dir.x, dir.z);
    this.action = { kind: "roll", t: 0, dur: clipDur(this.clips.roll) / 1.5, dir: dir.scale(speed), clip: "roll", speed: 1.5 };
    this.host.audio.play("foley", { x: this.p.x, y: this.p.y, z: this.p.z, volume: 0.6 });
  }

  // ------------------------------------------------------------------ deciding
  private think(dt: number) {
    this.thinkT -= dt;
    if (this.thinkT > 0) return;
    this.thinkT = 0.2;
    const host = this.host;
    if (host.hulk?.cinematic) {
      this.goal = null;
      return;
    }
    // the Hulk's down: soldiers first, then the victory lap
    if (host.hulk && !host.hulk.alive && host.hulk.state === "down" && !this.busy()) {
      const now = performance.now() / 1000;
      let left = this.host.soldiers().filter((x) => x.alive && (this.gaveUp.get(x) ?? 0) < now);
      if (!left.length && this.host.soldiers().some((x) => x.alive)) {
        this.gaveUp.clear();
        left = this.host.soldiers().filter((x) => x.alive);
      }
      if (left.length) {
        this.ai = "soldier";
        const seen = this.soldierInSight(30);
        if (seen && this.cd.soldier <= 0) {
          this.cd.soldier = rnd(0.8, 1.4);
          return this.startShoot(seen);
        }
        let near = left[0], nd = Infinity;
        for (const x of left) {
          const d = Vector3.Distance(x.position, this.p);
          if (d < nd) (nd = d), (near = x);
        }
        // the same one too long and no closer to dropping him: try someone else for a while
        if (this.huntOf !== near) (this.huntOf = near), (this.huntT = 0);
        this.huntT += 0.2;
        if (this.huntT > 10) {
          this.gaveUp.set(near, now + 30);
          this.huntOf = null;
          return;
        }
        // somewhere he can see him from (up on a gantry, behind a wall): the nearest spot with a view
        this.vantageT -= 0.2;
        if (this.vantageT <= 0 || this.vantageOf !== near) {
          this.vantageT = 2;
          this.vantageOf = near;
          this.vantage = this.viewOf(near);
        }
        this.goTo(this.vantage ?? near.position, nd > 12 ? "sprint" : "run");
        return;
      }
    }
    if (this.wasFighting && host.hulk && !host.hulk.alive && host.hulk.state === "down") {
      if (this.ai !== "victory") {
        this.ai = "victory";
        this.aiT = 0;
        this.say(pick(LINES.victory), 3);
        this.action = { kind: "taunt", t: 0, dur: 1.8 };
      }
      const me = host.player.feet;
      if (Vector3.Distance(flat(this.p), flat(me)) > 4) this.goTo(me.add(V(2.2, 0, -1.5)), "run");
      else this.goal = null;
      return;
    }
    if (this.busy()) return;
    const h = this.hulk;
    // soldiers: when there's no Hulk, or one's right by him
    if (this.cd.soldier <= 0) {
      const s = this.soldierInSight(h ? 14 : 30);
      if (s && (!h || (h.target as unknown) !== this)) {
        this.cd.soldier = h ? rnd(5, 8) : rnd(1.5, 2.5);
        this.ai = "soldier";
        this.startShoot(s);
        return;
      }
    }
    if (!h) return this.followPlayer();
    this.wasFighting = true;
    this.fight(h);
  }

  private followPlayer() {
    const me = this.host.player.feet;
    const yaw = this.host.player.yaw;
    const spot = me.add(V(-Math.cos(yaw) * 3 - Math.sin(yaw) * 2, 0, Math.sin(yaw) * 3 - Math.cos(yaw) * 2));
    this.ai = "follow";
    const d = Vector3.Distance(flat(this.p), flat(me));
    if (d > 4 || Vector3.Distance(flat(this.p), flat(spot)) > 2.5) this.goTo(spot, d > 12 ? "sprint" : d > 6 ? "run" : "walk");
    else this.goal = null;
  }

  /**
   * His fight — gun-kata: strafing runs round the target with both blasters going; in close, a
   * kick-and-elbow combo finished point-blank; a charged twin blast when the big hits are free; a
   * leap over him, shooting down; a taunt when he's busy with someone else. Never still.
   */
  private fight(h: Foe) {
    const host = this.host;
    const team = host.team;
    const hc = flat(h.position);
    const d = Vector3.Distance(flat(this.p), hc);
    const sees = host.nav.clear(this.center(), this.chestOf(h));
    const onMe = (h.target as unknown) === this;
    const t = h.threat();
    const wolv = h.size < 1;
    if (wolv && this.cd.logan <= 0) {
      this.cd.logan = rnd(25, 40);
      this.say(pick(LINES.logan), 3);
    }
    // he's winding up at me: a back-flip out of it, shooting
    if (t && (t.target as unknown) === this && t.t < 0.6 && d < 5) {
      if (this.cd.roll <= 0) return this.backFlipShot(h);
      this.goTo(this.p.add(flat(this.p.subtract(h.position)).normalize().scale(4)), "sprint");
      return;
    }
    // a charged twin blast: when nobody else just landed a big one and he's got a clear line
    if (this.cd.charge <= 0 && sees && d > 4 && d < 20 && team.since("heavy") > 2 && this.heat < 0.6) {
      team.mark("heavy");
      this.ai = "ranged";
      return this.startCharge();
    }
    // a leap over him, shooting down, a stomp on landing
    if (this.cd.leap <= 0 && sees && d > 5 && d < 11 && team.since("heavy") > 1.5 && Math.random() < 0.45) {
      team.mark("heavy");
      this.ai = "melee";
      return this.startLeap(h);
    }
    // the Hulk's busy with someone else: the occasional taunt (and now and then a word to you)
    if (!onMe && this.cd.taunt <= 0 && d > 6 && d < 18 && Math.random() < 0.25) {
      this.cd.taunt = rnd(16, 24);
      this.ai = "taunt";
      this.faceTo(h.position);
      this.action = { kind: "taunt", t: 0, dur: 1.4 };
      if (this.cd.wall <= 0 && Math.random() < 0.45) {
        this.cd.wall = rnd(30, 45);
        this.lookAtYou = 1.5;
        this.say(pick(LINES.wall), 2.8);
      } else this.quip("taunt");
      return;
    }
    // in close: the combo, finished point-blank
    if (d < DP.reach * Math.max(0.75, Math.min(1, h.size)) && this.cd.combo <= 0 && !onMe) {
      this.ai = "combo";
      team.mark("melee");
      return this.startCombo(h);
    }
    // a knee-slide in at him, both guns blazing (from mid-range, with room to slide)
    if (sees && this.cd.slide <= 0 && d > 6 && d < 14 && this.heat < 0.8 && Math.random() < 0.5) {
      this.ai = "ranged";
      team.mark("ranged");
      return this.startSlide(h);
    }
    // the gun-kata spin: in close, a pirouette with both arms out, firing every time he comes round
    if (this.cd.spin <= 0 && d < 5.5 && this.heat < 0.75 && Math.random() < 0.45) {
      this.ai = "combo";
      team.mark("melee");
      return this.startSpin();
    }
    // the strafing run: round him at 6–10 m, both guns out to the side
    if (sees && this.cd.strafe <= 0 && d < 22 && this.heat < 0.85) {
      this.ai = "ranged";
      team.mark("ranged");
      return this.startStrafe(h, d);
    }
    // a quick volley if he's in the open and nothing else is ready
    if (sees && this.cd.shoot <= 0 && d < 24 && (d > 7 || onMe)) {
      this.ai = "ranged";
      team.mark("ranged");
      return this.startShoot(null);
    }
    this.ai = d > 14 ? "locate" : "approach";
    const me = host.player.feet;
    const fromYou = flat(h.position.subtract(me));
    if (fromYou.lengthSquared() < 1e-3) fromYou.set(1, 0, 0);
    const base = Math.atan2(fromYou.x, fromYou.z) - this.flank * 1.4;
    // (hunted: keep him at arm's length; otherwise in to the combo range)
    const r = onMe ? 7 : DP.closeIn * Math.max(0.75, Math.min(1, h.size));
    const spot = h.position.add(V(Math.sin(base), 0, Math.cos(base)).scale(r));
    const zig = Math.sin(this.aiT * 3.1) * (d > 6 ? 2 : 0);
    const side = V(Math.cos(base), 0, -Math.sin(base)).scale(zig);
    this.goTo(d < 3.5 ? spot : spot.add(side), d > 6 ? "sprint" : "run");
  }
  private lookAtYou = 0;

  private gaveUp = new Map<SoldierLike, number>();
  private huntOf: SoldierLike | null = null;
  private huntT = 0;
  private vantage: Vector3 | null = null;
  private vantageOf: SoldierLike | null = null;
  private vantageT = 0;
  /** the nav node nearest him that can see the soldier (null: walk up to him) */
  private viewOf(s: SoldierLike) {
    const nav = this.host.nav;
    const at = s.position.add(V(0, 0.4, 0));
    let best: Vector3 | null = null, bs = Infinity;
    for (const n of nav.nodes) {
      const d = Vector3.Distance(n.p, s.position);
      if (d > 26 || d < 3 || Math.abs(n.p.y - this.p.y) > 1) continue;
      const sc = Vector3.Distance(n.p, this.p) + d * 0.5;
      if (sc >= bs) continue;
      if (!nav.clear(n.p.add(V(0, 1.4, 0)), at)) continue;
      bs = sc;
      best = n.p.clone();
    }
    return best;
  }
  private soldierInSight(range: number) {
    let best: SoldierLike | null = null, bd = range;
    for (const s of this.host.soldiers()) {
      if (!s.alive) continue;
      const d = Vector3.Distance(s.position, this.p);
      if (d < bd && Math.abs(s.position.y - 0.9 - this.p.y) < 5 && this.host.nav.clear(this.center().add(V(0, 0.4, 0)), s.position.add(V(0, 0.4, 0)))) (bd = d), (best = s);
    }
    return best;
  }

  // ------------------------------------------------------------------ attacks
  private startCombo(h: Foe) {
    let k = Math.floor(Math.random() * COMBOS.length);
    if (k === this.lastCombo) k = (k + 1 + Math.floor(Math.random() * (COMBOS.length - 1))) % COMBOS.length;
    this.lastCombo = k;
    const c = COMBOS[k];
    this.faceTo(h.position);
    this.goal = null;
    this.cd.combo = rnd(1.2, 2.2);
    this.action = { kind: "combo", t: 0, dur: clipDur(this.clips[c.clip]) / c.speed + 0.45, clip: c.clip, speed: c.speed, hits: c.hits, hitsDone: 0, damage: c.damage, shots: 0 };
    this.quip("combo", 0.3);
  }
  private startShoot(target: SoldierLike | null) {
    this.cd.shoot = rnd(2, 3.2);
    this.goal = null;
    this.action = { kind: "shoot", t: 0, dur: 1.3, shots: 0, target };
    if (!target) this.quip("shoot", 0.25);
    else this.quip("soldier", 0.2);
  }
  /** round him, both arms out to the side, the bolts alternating */
  private startStrafe(h: Foe, d: number) {
    this.cd.strafe = rnd(3.5, 5.5);
    this.cd.shoot = 1.5;
    const turn = Math.random() < 0.5 ? 1 : -1;
    this.action = { kind: "strafe", t: 0, dur: rnd(2.2, 3.2), shots: 0, turn, radius: Math.max(6, Math.min(10, d)) };
    this.quip("kata", 0.3);
    void h;
  }
  /** down on one knee and sliding in at him, guns up */
  private startSlide(h: Foe) {
    this.cd.slide = rnd(6, 9);
    this.cd.shoot = 1.2;
    const dir = flat(h.position.subtract(this.p)).normalize();
    this.faceTo(h.position);
    this.goal = null;
    this.action = { kind: "slide", t: 0, dur: 0.95, shots: 0, dir: dir.scale(9) };
    this.host.audio.play("foley", { x: this.p.x, y: this.p.y, z: this.p.z, volume: 0.7, rate: 0.8 });
    this.quip("kata", 0.35);
  }
  /** a pirouette, arms out: each gun fires as it comes round to him */
  private startSpin() {
    this.cd.spin = rnd(7, 10);
    this.goal = null;
    this.action = { kind: "spin", t: 0, dur: 1.1, shots: 0, turn: Math.random() < 0.5 ? 1 : -1 };
    this.host.audio.play("meleeSwing", { x: this.p.x, y: this.p.y + 1, z: this.p.z, volume: 0.6, rate: 0.7 });
  }
  /** both barrels together: a charge (they glow), then one big blast */
  private startCharge() {
    this.cd.charge = rnd(9, 13);
    this.goal = null;
    this.action = { kind: "charge", t: 0, dur: 1.35, shots: 0 };
    this.host.audio.play("repulsorCharge", { x: this.p.x, y: this.p.y + 1.3, z: this.p.z, volume: 0.6, rate: 1.25 });
  }
  /** a back-flip away, firing upside down */
  private backFlipShot(h: Foe) {
    this.cd.roll = rnd(2.5, 4);
    const away = flat(this.p.subtract(h.position)).normalize();
    this.faceTo(h.position);
    this.v.set(away.x * 7.5, 6.5, away.z * 7.5);
    this.mode = "air";
    this.p.y += 0.05;
    this.flip = { axis: "pitch", a: 0, rate: -7.5 };
    this.action = { kind: "flip", t: 0, dur: 9, shots: 0, firing: true };
    this.host.audio.play("foley", { x: this.p.x, y: this.p.y, z: this.p.z, volume: 0.6 });
  }
  private startLeap(h: Foe) {
    this.cd.leap = rnd(8, 12);
    // over him and down on the far side, shooting down at him on the way
    const across = flat(h.position.subtract(this.p)).normalize();
    const target = h.position.add(across.scale(2.2 * Math.max(0.8, h.size)));
    const T = 0.95;
    const vel = target.subtract(this.p).scaleInPlace(1 / T);
    vel.y = 0.5 * G * T + 1.5;
    this.faceTo(h.position);
    this.v.copyFrom(vel);
    this.mode = "air";
    this.p.y += 0.05;
    this.action = { kind: "leap", t: 0, dur: T + 1.4, clip: "smash", hits: [0.407], hitsDone: 0, damage: 34, shots: 0 };
    this.flip = { axis: "pitch", a: 0, rate: 6.6 };
    this.host.audio.play("meleeSwing", { x: this.p.x, y: this.p.y + 1, z: this.p.z, volume: 0.6, rate: 0.8 });
  }

  /** where to shoot: the soldier, or the target's chest */
  private aimAt(s: SoldierLike | null | undefined): Vector3 | null {
    if (s) return s.alive ? s.position.add(V(0, 0.35, 0)) : null;
    const h = this.hulk;
    return h ? this.chestOf(h) : null;
  }
  private aimTo(tgt: Vector3) {
    this.aimDir.copyFrom(tgt.subtract(this.center().add(V(0, 0.4, 0))).normalize());
    this.aimT = 0.4;
  }

  private act(dt: number) {
    const a = this.action;
    if (!a) return;
    a.t += dt;
    const h = this.hulk;
    switch (a.kind) {
      case "combo": {
        if (h) this.turnTo(Math.atan2(h.position.x - this.p.x, h.position.z - this.p.z), dt, 9);
        this.sinceMelee = 0;
        const blows = a.dur - 0.45;
        const f = a.t / blows;
        while (a.hits && a.hitsDone! < a.hits.length && f >= a.hits[a.hitsDone!]) {
          a.hitsDone!++;
          this.host.audio.play("meleeSwing", { x: this.p.x, y: this.p.y + 1.2, z: this.p.z, volume: 0.6, rate: 0.9 });
          if (h) this.strike(h, a.damage!, 1);
        }
        // and the finish: both blasters to his chest, point-blank
        if (a.t >= blows && h) {
          const tgt = this.chestOf(h);
          this.aimTo(tgt);
          while (a.t >= blows + 0.12 + a.shots! * 0.1 && a.shots! < 2) {
            this.fireGun(a.shots! % 2, tgt, null, 24, 1.4);
            a.shots!++;
          }
        }
        if (a.t >= a.dur) {
          this.action = null;
          // and out: a roll, or straight on if he's busy with someone else
          if (h && ((h.target as unknown) === this || Math.random() < 0.6)) {
            const away = flat(this.p.subtract(h.position)).normalize();
            const side = V(away.z, 0, -away.x).scale(this.flank);
            this.startRoll(away.add(side).normalize(), 8);
            this.flank = -this.flank;
          }
        }
        break;
      }
      case "shoot": {
        // both guns up, alternating — at the target's chest, or the soldier
        const tgt = this.aimAt(a.target);
        if (!tgt) {
          this.action = null;
          break;
        }
        this.turnTo(Math.atan2(tgt.x - this.p.x, tgt.z - this.p.z), dt, 10);
        this.aimTo(tgt);
        const every = 0.15;
        while (a.t >= 0.2 + a.shots! * every && a.shots! < 7) {
          const gun = a.shots! % 2;
          a.shots!++;
          this.fireGun(gun, tgt, a.target ?? null, a.target ? 40 : 8, 0);
        }
        if (a.t >= a.dur) this.action = this.heat >= 1 ? this.vent() : null;
        break;
      }
      case "strafe": {
        // running round him (facing the way he runs), the arms out at him; bolts every 0.13 s
        const tgt = this.aimAt(null);
        if (!tgt || !h) {
          this.action = null;
          break;
        }
        const out = flat(this.p.subtract(h.position));
        const r = out.length();
        out.scaleInPlace(1 / Math.max(1e-3, r));
        const tan = V(out.z, 0, -out.x).scale(a.turn!);
        // (holding the radius: a little in or out)
        const dir = tan.add(out.scale(Math.max(-0.6, Math.min(0.6, (a.radius! - r) * 0.35)))).normalize();
        this.goTo(this.p.add(dir.scale(4)), "sprint");
        this.aimTo(tgt);
        while (a.t >= 0.15 + a.shots! * 0.13 && a.t < a.dur - 0.1) {
          this.fireGun(a.shots! % 2, tgt, null, 7, 0);
          a.shots!++;
        }
        if (a.t >= a.dur) {
          this.goal = null;
          this.action = this.heat >= 1 ? this.vent() : null;
        }
        break;
      }
      case "slide": {
        // the slide: fast at first, scraping to a stop; firing all the way in
        const f = a.t / a.dur;
        const k = Math.max(0, 1 - f * f);
        this.v.set(a.dir!.x * k, 0, a.dir!.z * k);
        const tgt = this.aimAt(null);
        if (tgt) {
          this.aimTo(tgt);
          while (a.t >= 0.08 + a.shots! * 0.1 && a.shots! < 8) {
            this.fireGun(a.shots! % 2, tgt, null, 7, 0);
            a.shots!++;
          }
        }
        if (Math.random() < dt * 20) this.host.dust(this.p.clone(), 0.05);
        if (a.t >= a.dur) this.action = this.heat >= 1 ? this.vent() : null;
        break;
      }
      case "spin": {
        // two full turns; a gun fires when its arm sweeps past him (and at any soldier it passes)
        const prev = this.yaw;
        this.yaw += a.turn! * dt * (Math.PI * 4) / a.dur;
        const tgt = this.aimAt(null);
        if (tgt) {
          const toT = Math.atan2(tgt.x - this.p.x, tgt.z - this.p.z);
          for (const [gun, side] of [[0, -1], [1, 1]] as const) {
            // (each arm points out to its side: ±90° from where he faces)
            const armNow = this.yaw + side * Math.PI / 2, armWas = prev + side * Math.PI / 2;
            const crossed = Math.sign(angDiff(toT, armWas)) !== Math.sign(angDiff(toT, armNow)) && Math.abs(angDiff(toT, armNow)) < 0.6;
            if (crossed) this.fireGun(gun, tgt, null, 11, 0.6);
          }
          // (the guns lie along his arms as he turns)
          this.aimT = 0;
        }
        if (a.t >= a.dur) {
          if (tgt) this.faceTo(tgt);
          this.action = this.heat >= 1 ? this.vent() : null;
        }
        break;
      }
      case "charge": {
        const tgt = this.aimAt(null);
        if (!tgt) {
          this.action = null;
          break;
        }
        this.turnTo(Math.atan2(tgt.x - this.p.x, tgt.z - this.p.z), dt, 8);
        this.aimTo(tgt);
        // the glow builds in both muzzles, then both barrels at once
        const k = Math.min(1, a.t / 0.85);
        this.glow[0] = this.glow[1] = k;
        if (a.t >= 0.85 && a.shots === 0) {
          a.shots = 1;
          this.glow[0] = this.glow[1] = 0;
          this.fireGun(0, tgt, null, 32, 2.2, true);
          this.fireGun(1, tgt, null, 32, 2.2, true);
          this.host.audio.play("unibeam", { x: this.p.x, y: this.p.y + 1.3, z: this.p.z, volume: 0.55, rate: 1.6 });
          this.host.player.shake(0.12);
          // (the kick: a step back)
          const back = flat(this.p.subtract(tgt)).normalize();
          this.v.addInPlace(back.scale(3));
          this.say(pick(["Double tap!", "Maximum effort!", "Boom. Headshot. Well, chest-shot."]), 1.8);
        }
        if (a.t >= a.dur) this.action = null;
        break;
      }
      case "reload":
        // the vent: the barrels hiss and smoke
        if (a.t > 0.2 && a.shots === undefined) {
          a.shots = 1;
          this.host.audio.play("thrustLoop", { x: this.p.x, y: this.p.y + 1.2, z: this.p.z, volume: 0.25, rate: 1.8 });
        }
        if (a.t >= a.dur) {
          this.heat = 0;
          this.host.audio.play("pistolMagIn", { x: this.p.x, y: this.p.y + 1.2, z: this.p.z, volume: 0.6 });
          this.action = null;
        }
        break;
      case "leap": {
        if (this.mode === "air") {
          // shooting down at him on the way over
          const tgt = this.aimAt(null);
          if (tgt && a.t > 0.2) {
            this.aimTo(tgt);
            while (a.t >= 0.2 + a.shots! * 0.12 && a.shots! < 6) {
              this.fireGun(a.shots! % 2, tgt, null, 8, 0);
              a.shots!++;
            }
          }
          if (a.t > 2.5) this.action = null;
        } else {
          // down: the stomp
          if (a.hitsDone === 0) {
            a.hitsDone = 1;
            if (h) this.strike(h, a.damage!, 2.2, true);
            this.host.dust(this.p.clone(), 0.35);
            this.host.audio.play("hulkSlam", { x: this.p.x, y: this.p.y, z: this.p.z, volume: 0.4, rate: 1.7 });
          }
          if (a.t > 0.9 + 0.75) {
            this.action = null;
            if (h) this.startRoll(flat(this.p.subtract(h.position)).normalize(), 8);
          }
        }
        break;
      }
      case "flip": {
        // a firing back-flip: the guns on him all the way round
        if (a.firing && this.mode === "air") {
          const tgt = this.aimAt(null);
          if (tgt) {
            this.aimTo(tgt);
            while (a.t >= 0.12 + a.shots! * 0.11 && a.shots! < 5) {
              this.fireGun(a.shots! % 2, tgt, null, 7, 0);
              a.shots!++;
            }
          }
        }
        break;
      }
      case "roll": {
        const f = a.t / a.dur;
        const k = f < 0.75 ? 1 : Math.max(0, 1 - (f - 0.75) / 0.25);
        this.v.set(a.dir!.x * k, this.v.y, a.dir!.z * k);
        if (a.t >= a.dur) this.action = null;
        break;
      }
      case "taunt":
        if (a.t >= a.dur) this.action = null;
        break;
      case "land":
      case "getup":
        if (a.t >= a.dur) this.action = null;
        break;
      case "down":
        if (this.mode !== "ko" && a.t >= a.dur) this.action = { kind: "getup", t: 0, dur: 0.8 };
        break;
    }
  }
  private vent(): Action {
    this.quip("heat", 0.5);
    return { kind: "reload", t: 0, dur: 1.0 };
  }

  /** a kick, an elbow, a gun-butt: only if he's really there — in reach, in front of him */
  private strike(h: Foe, damage: number, force: number, stomp = false) {
    const chest = this.chestOf(h);
    const to = chest.subtract(this.center());
    if (to.length() > (stomp ? 3.4 : DP.reach + 0.6) * Math.max(0.8, h.size)) return;
    const fwd = V(Math.sin(this.yaw), 0, Math.cos(this.yaw));
    if (!stomp && Vector3.Dot(flat(to).normalize(), fwd) < 0.25) return;
    const point = chest.subtract(to.normalizeToNew().scale(0.4 * Math.max(0.8, h.size)));
    h.applyHit(damage, "torso", to.normalize(), point, { kind: "melee", force, source: this });
    this.host.audio.play("meleeHit", { x: point.x, y: point.y, z: point.z, volume: 0.85 });
    this.host.audio.play("fleshHit", { x: point.x, y: point.y, z: point.z, volume: 0.5 });
    this.host.spark(point, to.scale(-1).normalize());
  }

  /**
   * A plasma bolt: the hit is decided now (along the barrel's line to the target, if nothing's in
   * the way) and lands when the bolt gets there (~80 m/s).
   */
  private fireGun(gun: number, target: Vector3, soldier: SoldierLike | null, damage: number, force: number, big = false) {
    const muzzle = this.muzzleAt(gun);
    const dir = target.subtract(muzzle);
    const L = dir.length();
    dir.scaleInPlace(1 / L);
    // a little spread (two guns, on the move); none for the charged shot
    const sp = big ? 0.005 : 0.035;
    dir.addInPlace(V((Math.random() - 0.5) * sp, (Math.random() - 0.5) * sp, (Math.random() - 0.5) * sp)).normalize();
    const end = muzzle.add(dir.scale(L + 2));
    const blocked = this.host.nav.rayLevel(muzzle, end);
    let hitAt = blocked >= 0 ? muzzle.add(dir.scale(blocked)) : end;
    const au = this.host.audio;
    au.play("repulsorFire", { x: muzzle.x, y: muzzle.y, z: muzzle.z, volume: big ? 0.9 : 0.5, rate: big ? 0.9 : 1.55 + Math.random() * 0.2 });
    this.flashT[gun] = big ? 0.12 : 0.05;
    this.heat = Math.min(1, this.heat + (big ? 0.12 : 0.045));
    let land: (() => void) | null = null;
    const h = this.hulk;
    if (soldier) {
      if (blocked < 0 || blocked > L - 0.4) {
        hitAt = target;
        land = () => {
          if (soldier.applyHit(damage, "torso", dir, target, { kind: "bullet" })) this.quip("soldier", 0.3);
        };
      }
    } else if (h && (blocked < 0 || blocked > L - 0.5)) {
      hitAt = target;
      land = () => {
        if (h.alive) h.applyHit(damage, "torso", dir, target, { kind: "melee", force, source: this });
      };
    }
    const b = this.bolts.find((x) => x.t >= x.dur) ?? this.bolts[0];
    b.from.copyFrom(muzzle);
    b.to.copyFrom(hitAt);
    b.t = 0;
    b.dur = Math.max(0.03, Vector3.Distance(muzzle, hitAt) / 80);
    b.m.scaling.setAll(big ? 2.4 : 1);
    const end2 = hitAt.clone();
    b.hit = () => {
      land?.();
      this.host.spark(end2, dir.scale(-1));
      if (big) this.host.dust(end2.clone(), 0.12);
    };
    b.m.setEnabled(true);
  }
  private muzzleAt(gun: number) {
    const g = this.guns[gun];
    g.computeWorldMatrix(true);
    return Vector3.TransformCoordinates(V(0, 0.045, this.muzzle * 0.9), g.getWorldMatrix());
  }
  /** the bolts in flight */
  private flyBolts(dt: number) {
    for (const b of this.bolts) {
      if (b.t >= b.dur) continue;
      b.t += dt;
      const f = Math.min(1, b.t / b.dur);
      const dir = b.to.subtract(b.from);
      Vector3.LerpToRef(b.from, b.to, f, b.m.position);
      // (stood along the flight: the capsule's length is its Y)
      const L = dir.length();
      if (L > 1e-3) {
        const d = dir.scale(1 / L);
        const y = Vector3.UpReadOnly;
        const c = Vector3.Dot(y, d);
        if (c > 0.9999) b.m.rotationQuaternion!.set(0, 0, 0, 1);
        else if (c < -0.9999) b.m.rotationQuaternion!.set(1, 0, 0, 0);
        else Quaternion.RotationAxisToRef(Vector3.Cross(y, d).normalize(), Math.acos(c), b.m.rotationQuaternion!);
      }
      if (f >= 1) {
        b.m.setEnabled(false);
        const hit = b.hit;
        b.hit = null;
        hit?.();
      }
    }
  }

  // ------------------------------------------------------------------ getting about
  private goTo(p: Vector3, pace: "walk" | "run" | "sprint") {
    if (!this.goal || Vector3.DistanceSquared(this.goal, p) > 1) this.repath = 0;
    this.goal = p.clone();
    this.pace = pace;
  }
  private faceTo(p: Vector3) {
    this.yaw = Math.atan2(p.x - this.p.x, p.z - this.p.z);
  }
  private turnTo(yaw: number, dt: number, rate: number) {
    const d = angDiff(yaw, this.yaw);
    this.yaw += Math.sign(d) * Math.min(Math.abs(d), rate * dt);
  }

  private move(dt: number) {
    if (this.action?.kind === "intro") return;
    if (this.mode === "ground") return this.moveGround(dt);
    return this.moveAir(dt, this.mode === "ko");
  }
  private moveGround(dt: number) {
    const nav = this.host.nav;
    const fy = nav.floorAt(this.p.x, this.p.y + 0.3, this.p.z, 0.6);
    if (fy === null) {
      this.mode = "air";
      this.v.y = 0;
      return;
    }
    this.p.y += (fy - this.p.y) * Math.min(1, dt * 15);
    const a = this.action;
    if (a?.kind === "roll" || a?.kind === "slide") {
      const step = this.v.scale(dt);
      if (!this.stepTo(this.p.x + step.x, this.p.z + step.z)) this.v.set(0, 0, 0);
      return;
    }
    if (a && (a.kind === "combo" || a.kind === "shoot" || a.kind === "spin" || a.kind === "charge" || a.kind === "reload" || a.kind === "taunt" || a.kind === "land" || a.kind === "getup" || a.kind === "down" || a.kind === "leap")) {
      // (a reload or a shot on the move: he keeps a slow drift; everything else plants him)
      this.v.setAll(0);
      return;
    }
    let speed = 0;
    if (this.goal) {
      const target = this.steer(dt);
      const step = flat(target.subtract(this.p));
      const L = step.length();
      const s = this.pace === "sprint" ? DP.sprint : this.pace === "run" ? DP.run : 1.7;
      if (L > 0.15) {
        // (sudden changes of direction: he turns fast)
        this.turnTo(Math.atan2(step.x, step.z), dt, 14);
        const dir = V(Math.sin(this.yaw), 0, Math.cos(this.yaw));
        this.avoid(dir);
        const m = Math.min(L, s * dt);
        if (this.stepTo(this.p.x + dir.x * m, this.p.z + dir.z * m)) speed = m / dt;
        else this.blocked(dir);
      } else if (Vector3.Distance(flat(this.p), flat(this.goal)) < 0.4) this.goal = null;
    }
    this.v.set(Math.sin(this.yaw) * speed, 0, Math.cos(this.yaw) * speed);
    if (this.goal && speed < 0.3) {
      this.stillT += dt;
      if (this.stillT > 0.8) {
        this.stillT = 0;
        const dir = flat(this.goal.subtract(this.p)).normalize();
        this.v.set(dir.x * 4.5, 8, dir.z * 4.5);
        this.mode = "air";
        this.p.y += 0.05;
      }
    } else this.stillT = 0;
    if (speed > 1) {
      this.stepT -= dt * (speed / 4.2);
      if (this.stepT <= 0) {
        this.stepT = 0.34;
        this.host.audio.play("footstep", { x: this.p.x, y: this.p.y, z: this.p.z, volume: 0.3 });
      }
    }
  }
  private stepTo(x: number, z: number) {
    const nav = this.host.nav;
    const fy = nav.floorAt(x, this.p.y + 0.5, z, 1.2);
    if (fy === null) {
      if (!nav.embedded(x, this.p.y + 0.5, z)) {
        this.p.x = x;
        this.p.z = z;
        return true;
      }
      return false;
    }
    if (fy > this.p.y + 0.5 || nav.embedded(x, this.p.y + 0.4, z) || nav.embedded(x, fy + 1.0, z)) return false;
    this.p.x = x;
    this.p.z = z;
    return true;
  }
  /** in the way: vault it if it's low (a flip if it's tall), else find another way */
  private blocked(dir: Vector3) {
    const nav = this.host.nav;
    const c = this.p.add(V(0, 0.6, 0));
    const hit = nav.moveHit(c, c.add(dir.scale(1.2)));
    if (!hit) return;
    const top = nav.boxBoundsOf(hit.box)[4];
    const h = top - this.p.y;
    if (h < 2.8) {
      this.v.set(dir.x * 4.5, Math.sqrt(2 * G * (h + 0.7)), dir.z * 4.5);
      this.mode = "air";
      this.p.y += 0.05;
      this.flip = { axis: "pitch", a: 0, rate: h > 1.2 ? 8 : 0 };
      if (this.flip.rate) this.action = { kind: "flip", t: 0, dur: 9 };
      return;
    }
    this.repath = 0;
    this.path = [];
  }
  private avoid(dir: Vector3) {
    const keep = (q: Vector3, r: number) => {
      const to = flat(q.subtract(this.p));
      const d = to.length();
      if (d > r || d < 1e-3 || Vector3.Dot(to.scale(1 / d), dir) < 0.2) return;
      const side = V(to.z, 0, -to.x).normalize();
      if (Vector3.Dot(side, dir) < 0) side.scaleInPlace(-1);
      dir.addInPlace(side.scale(1.2 * (1 - d / r))).normalize();
    };
    keep(this.host.player.feet, 2.2);
    const h = this.host.hulk;
    if (h?.alive) keep(h.position, 1.5 * h.size);
  }
  private steer(dt: number) {
    const nav = this.host.nav;
    const goal = this.goal!;
    const knee = V(0, 0.5, 0), chest = V(0, 1.2, 0);
    if (Math.abs(goal.y - this.p.y) < 1.5 && nav.moveRay(this.p.add(knee), goal.add(knee)) < 0 && nav.moveRay(this.p.add(chest), goal.add(chest)) < 0) {
      this.path = [];
      return goal;
    }
    this.repath -= dt;
    if (this.repath <= 0 || !this.path.length) {
      this.repath = 0.7;
      const a = nav.nearest(this.p, true), b = nav.nearest(goal, false);
      this.path = nav.path(a, b);
      if (a >= 0 && (!this.path[0] || nav.moveRay(this.p.add(knee), this.path[0].add(knee)) >= 0)) this.path.unshift(nav.nodes[a].p);
      this.path.push(goal.clone());
    }
    while (this.path.length > 1 && Vector3.Distance(flat(this.path[0]), flat(this.p)) < 0.8) this.path.shift();
    return this.path[0] ?? goal;
  }
  private moveAir(dt: number, ko: boolean) {
    const nav = this.host.nav;
    const prevC = this.center();
    this.v.y -= G * dt;
    this.p.addInPlace(this.v.scale(dt));
    const c = this.center();
    const hit = nav.moveHit(prevC, c);
    if (hit && hit.normal.y < 0.5) {
      const vn = Vector3.Dot(this.v, hit.normal);
      if (vn < 0) this.v.subtractInPlace(hit.normal.scale(vn * 1.15));
      this.p.copyFrom(hit.point.add(hit.normal.scale(0.12))).subtractInPlace(V(0, 1.0, 0));
    }
    if (this.v.y <= 0) {
      const fy = nav.floorAt(this.p.x, this.p.y + 0.6 - this.v.y * dt, this.p.z, 0.8 - this.v.y * dt);
      if (fy !== null && this.p.y <= fy + 0.02) {
        const impact = -this.v.y;
        this.p.y = fy;
        this.v.setAll(0);
        this.flip = { axis: "pitch", a: 0, rate: 0 };
        if (ko) return;
        this.mode = "ground";
        const a = this.action;
        if (a?.kind === "tumble") {
          const down = this.downFor;
          this.downFor = 0;
          this.action = down > 0.2 ? { kind: "down", t: 0, dur: down } : { kind: "getup", t: 0, dur: 0.55 };
          this.host.audio.play("bodyFall", { x: this.p.x, y: this.p.y, z: this.p.z, volume: 0.6 });
          this.ai = this.hulk ? "return" : "follow";
        } else if (a?.kind === "flip") this.action = null;
        else if (a?.kind === "leap") a.t = 0.9; // (the Smash plays from where the blades come down)
        else if (impact > 9 && !a) this.action = { kind: "land", t: 0, dur: 0.4 };
        this.host.audio.play("land", { x: this.p.x, y: this.p.y, z: this.p.z, volume: 0.45 });
      }
    }
    if (this.flip.rate !== 0) this.flip.a += this.flip.rate * dt;
    if (this.p.y < -20) this.p.copyFrom(this.host.player.feet.add(V(1.5, 0, 0)));
  }

  private recovering(dt: number) {
    this.moveAir(dt, true);
    this.koT -= dt;
    if (this.koT <= 0) {
      // the healing factor: back up, good as new (almost)
      this.mode = "ground";
      this.health = this.maxHealth * 0.8;
      this.action = { kind: "getup", t: 0, dur: 1 };
      this.ai = this.hulk ? "return" : "follow";
      this.say(pick(LINES.up), 2.4);
    }
  }

  // ------------------------------------------------------------------ the body
  private animate(dt: number) {
    const want = this.want;
    const a = this.action;
    let rate = 14;
    const speed = flat(this.v).length();
    if (a?.kind === "intro") {
      const t = a.t;
      if (t < 3.15) copyPose(STANCE, want);
      else if (t < 3.75) sample(this.clips.mmaKick3, 0.388 * clipDur(this.clips.mmaKick3) + (t - 3.4) * 0.8, false, want); // the kick that opens the doors
      else if (t < 6.2) {
        this.runPhase += dt * (1.3 / 1.25);
        sample(this.clips.walk, this.runPhase, true, want);
        naturalArms(want, 0.1, 0.02);
      } else if (t < 8.2) {
        // "whoa": a point at the Hulk with his right hand, the left on his hip
        copyPose(RELAXED, want);
        const h = this.host.hulk;
        if (h && t > 6.5) aimArm(want, "r", this.toBody(h.position.add(V(0, 1.8, 0)).subtract(this.rig.at("RightArm"))));
        want.d[6] = norm([-0.6, -0.6, -0.3]);
        want.d[7] = norm([0.6, -0.2, 0.6]);
      } else copyPose(GUNS_UP, want);
      rate = t > 3.3 && t < 3.8 ? 30 : 10;
    } else if (a?.kind === "combo" && a.t >= a.dur - 0.45) {
      // the finish: both blasters at his chest
      copyPose(STANCE, want);
      const d = this.toBody(this.aimDir);
      aimArm(want, "l", [d[0] - 0.05, d[1], d[2]]);
      aimArm(want, "r", [d[0] + 0.05, d[1], d[2]]);
      rate = 30;
    } else if (a?.clip && (a.kind === "combo" || a.kind === "roll")) {
      sample(this.clips[a.clip], a.t * (a.speed ?? 1), false, want);
      rate = a.kind === "roll" ? 30 : 26;
    } else if (a?.kind === "slide") {
      // on one knee, leaning back, the front leg out ahead, both arms up at him
      copyPose(SLIDE, want);
      const d = this.toBody(this.aimDir);
      aimArm(want, "l", [d[0] - 0.06, d[1], d[2]]);
      aimArm(want, "r", [d[0] + 0.06, d[1], d[2]]);
      rate = 26;
    } else if (a?.kind === "spin") {
      // arms straight out to the sides, the guns level, a lean into the turn
      copyPose(STANCE, want);
      want.d[6] = norm([-1, 0.05, 0.05]);
      want.d[7] = norm([-1, 0.05, 0.1]);
      want.d[8] = norm([-1, 0.05, 0.12]);
      want.d[9] = norm([1, 0.05, 0.05]);
      want.d[10] = norm([1, 0.05, 0.1]);
      want.d[11] = norm([1, 0.05, 0.12]);
      want.d[1] = norm([0.12 * (a.turn ?? 1), 1, 0.05]);
      rate = 30;
    } else if (a?.kind === "strafe" && this.mode === "ground") {
      // running, both arms out at him (gun-kata), the chest turned a little toward him
      const c = this.clips.sprint;
      const cs = (c.speed ?? 4) * (this.rig.hipH / 0.9);
      this.runPhase += dt * (Math.max(3, speed) / cs);
      sample(c, this.runPhase, true, want);
      const d = this.toBody(this.aimDir);
      want.d[3] = norm([d[0] * 0.25, 1, 0.05 + d[2] * 0.1]);
      aimArm(want, "l", [d[0] - 0.06, d[1] + 0.02, d[2]]);
      aimArm(want, "r", [d[0] + 0.06, d[1] + 0.02, d[2]]);
      rate = 34;
    } else if (a?.kind === "charge") {
      // both arms straight out together, braced
      copyPose(STANCE, want);
      const d = this.toBody(this.aimDir);
      aimArm(want, "l", [d[0] - 0.03, d[1], d[2]]);
      aimArm(want, "r", [d[0] + 0.03, d[1], d[2]]);
      want.d[0] = norm([0, 1, -0.08]);
      rate = 18;
    } else if (a?.kind === "leap" || (a?.kind === "flip" && a.firing)) {
      if (this.mode === "air") {
        copyPose(TUCK, want);
        if (this.aimT > 0) {
          const d = this.toBody(this.aimDir);
          aimArm(want, "l", [d[0] - 0.08, d[1], d[2]]);
          aimArm(want, "r", [d[0] + 0.08, d[1], d[2]]);
        }
      } else if (a.kind === "flip") copyPose(STANCE, want);
      else sample(this.clips.smash, (a.t - 0.9) + 0.407 * clipDur(this.clips.smash) - 0.25, false, want);
      rate = 22;
    } else if (a?.kind === "shoot" || this.aimT > 0) {
      copyPose(STANCE, want);
      const d = this.toBody(this.aimDir);
      aimArm(want, "l", [d[0] - 0.08, d[1], d[2]]);
      aimArm(want, "r", [d[0] + 0.08, d[1], d[2]]);
      rate = 24;
    } else if (a?.kind === "reload") {
      // the vent: both guns up by his face, blowing on them
      copyPose(GUNS_UP, want);
      want.d[5] = norm([0, 0.7, 0.7]);
    } else if (a?.kind === "taunt" || a?.kind === "victory") {
      copyPose(TAUNT, want);
      rate = 10;
    } else if (a?.kind === "flip" || a?.kind === "tumble") {
      copyPose(this.mode === "air" ? TUCK : STANCE, want);
      if (a.kind === "tumble" && this.mode === "air") mixPose(HIT, TUCK, Math.min(1, a.t * 2), want);
      rate = 20;
    } else if (a?.kind === "down" || this.mode === "ko") {
      sample(this.clips.deathB, clipDur(this.clips.deathB), false, want);
      rate = 8;
    } else if (a?.kind === "getup" || a?.kind === "land") {
      mixPose(LANDING, STANCE, Math.min(1, a.t / a.dur), want);
      rate = 12;
    } else if (this.mode === "air") {
      copyPose(TUCK, want);
      rate = 10;
    } else if (speed > 0.6) {
      const gait = speed < 3 ? "walk" : speed > 7.5 ? "sprint" : "run";
      const c = this.clips[gait];
      const cs = (gait === "walk" ? 1.25 : (c.speed ?? 4)) * (this.rig.hipH / 0.9);
      if (gait !== this.gait) {
        const from = this.clips[this.gait];
        this.runPhase = ((this.runPhase % clipDur(from)) / clipDur(from)) * clipDur(c);
        this.gait = gait;
      }
      this.runPhase += dt * (speed / cs);
      sample(c, this.runPhase, true, want);
      naturalArms(want, gait === "walk" ? 0.1 : gait === "run" ? 0.6 : 1, gait === "sprint" ? 0.24 : 0.1);
      rate = 40;
    } else {
      copyPose(this.hulk ? STANCE : RELAXED, want);
    }
    if (this.aimT > 0) this.aimT -= dt;
    // a look at you (the fourth wall)
    if (this.lookAtYou > 0) {
      this.lookAtYou -= dt;
      const to = this.toBody(this.host.player.camera.position.subtract(this.rig.at("Head")));
      want.d[4] = norm([to[0] * 0.6, 1, to[2] * 0.6]);
      want.d[5] = norm([to[0] * 0.4, 0.8, to[2] * 0.6 + 0.2]);
    }
    follow(this.shown, want, rate, dt);
    if (!this.shown.d.every((d) => isFinite(d[0] + d[1] + d[2]))) copyPose(STANCE, this.shown);
    const up = V(0, 1, 0), fwd = V(Math.sin(this.yaw), 0, Math.cos(this.yaw));
    lookRotation(fwd, up, this.q);
    if (this.flip.a !== 0 && (this.mode === "air" || this.mode === "ko")) {
      const axis = this.flip.axis === "pitch" ? V(1, 0, 0) : V(0, 0, 1);
      this.q.multiplyInPlace(Quaternion.RotationAxis(axis, this.flip.a));
    }
    const anc = this.rig.anchor;
    anc.rotationQuaternion!.copyFrom(this.q);
    if (this.flip.a !== 0 && this.mode === "air") {
      const mid = V(0, this.rig.hipH, 0).applyRotationQuaternion(this.q);
      anc.position.copyFrom(this.p).addInPlace(V(0, this.rig.hipH, 0)).subtractInPlace(mid);
    } else anc.position.copyFrom(this.p);
    const hip = this.shown.hip;
    this.rig.pose(this.shown.d, V(hip[0] * this.rig.hipH, hip[1] * this.rig.hipH, hip[2] * this.rig.hipH));
    // his fingers round the grips (a loose hand for the taunts)
    const g = a?.kind === "taunt" || a?.kind === "victory" ? 0.35 : 0.85;
    this.rig.grip?.("l", g);
    this.rig.grip?.("r", g);
  }
  private toBody(w: Vector3): Dir {
    const b = w.normalizeToNew().applyRotationQuaternion(Quaternion.Inverse(this.q));
    return [b.x, b.y, b.z];
  }

  // ------------------------------------------------------------------ the blasters
  /**
   * Each frame: a blaster in each fist — along the forearm (barrel forward and a little up) when
   * he isn't shooting, along the aim when he is; in a combo, gripped like a knuckle-duster. The
   * muzzle flashes, the charge glow, the heat haze, and the bolts in flight.
   */
  private placeWeapons(dt: number) {
    const A = this.rig.anchor;
    A.computeWorldMatrix(true);
    const R = Vector3.TransformNormal(V(1, 0, 0), A.getWorldMatrix()).normalize();
    const U = Vector3.TransformNormal(V(0, 1, 0), A.getWorldMatrix()).normalize();
    const F = Vector3.TransformNormal(V(0, 0, 1), A.getWorldMatrix()).normalize();
    const shooting = this.aimT > 0;
    ["Left", "Right"].forEach((S, i) => {
      const hand = this.rig.at(S + "Hand"), mid = this.rig.at(S + "HandMiddle1"), elbow = this.rig.at(S + "ForeArm");
      const fore = hand.subtract(elbow).normalize();
      const grip = hand.add(mid.subtract(hand).scale(0.6));
      // the barrel out of the top of the fist; up toward his body's up (canted in a little)
      const barrel = shooting ? this.aimDir.clone() : fore.add(F.scale(0.5)).addInPlace(U.scale(0.15)).normalize();
      const upv = U.subtract(barrel.scale(Vector3.Dot(U, barrel))).normalize().addInPlace(R.scale(i === 0 ? 0.3 : -0.3)).normalize();
      const g = this.guns[i];
      g.position.copyFrom(grip);
      lookRotation(barrel, upv, g.rotationQuaternion!);
      // the muzzle: the flash, or the charge glow
      const f = this.flash[i];
      this.flashT[i] -= dt;
      const glow = this.glow[i];
      f.setEnabled(this.enabled && (this.flashT[i] > 0 || glow > 0.02));
      if (f.isEnabled()) {
        f.position.copyFrom(this.muzzleAt(i));
        f.scaling.setAll(this.flashT[i] > 0 ? 0.9 + Math.random() * 0.9 : 0.4 + glow * 1.6 + Math.random() * 0.15 * glow);
      }
    });
    if (this.action?.kind !== "charge") this.glow[0] = this.glow[1] = 0;
    // the guns cool off when they aren't firing
    this.heat = Math.max(0, this.heat - dt * 0.12);
    this.flyBolts(dt);
  }

  /** a restart */
  reset() {
    this.enabled = false;
    this.rig.setVisible(false);
    this.setWeaponsVisible(false);
    this.hud.style.display = "none";
    this.line.classList.remove("on");
    this.action = null;
    this.mode = "ground";
    this.wasFighting = false;
    this.heat = 0;
    for (const b of this.bolts) {
      b.t = b.dur = 0;
      b.hit = null;
      b.m.setEnabled(false);
    }
    for (const f of this.flash) f.setEnabled(false);
    this.cd = { combo: 0, shoot: 2, strafe: 1, slide: 4, spin: 6, charge: 8, leap: 5, dodge: 0, taunt: 8, quip: 6, wall: 25, soldier: 3, roll: 0, logan: 4 };
    if (this.box) {
      this.box.position.copyFrom(this.boxRest.p);
      this.closeDoors();
    }
  }
}
