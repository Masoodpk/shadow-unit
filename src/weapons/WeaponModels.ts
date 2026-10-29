import { AbstractMesh } from "@babylonjs/core/Meshes/abstractMesh";
import { Color3 } from "@babylonjs/core/Maths/math.color";
import { Mesh } from "@babylonjs/core/Meshes/mesh";
import { MeshBuilder } from "@babylonjs/core/Meshes/meshBuilder";
import { PBRMaterial } from "@babylonjs/core/Materials/PBR/pbrMaterial";
import { Scene } from "@babylonjs/core/scene";
import { StandardMaterial } from "@babylonjs/core/Materials/standardMaterial";
import { TransformNode } from "@babylonjs/core/Meshes/transformNode";
import { Vector3 } from "@babylonjs/core/Maths/math.vector";
import { WeaponId } from "../config/weapons";
import { bump, clamp, easeInOutSine, easeOutCubic, lerp, saturate } from "../core/math";
import { Materials } from "../render/Materials";

/** Snapshot the rig needs to pose its moving parts. */
export interface RigState {
  phase: string | null; // reload phase id
  t: number; // 0..1 inside phase
  /** Seconds since last shot (for bolt/pump cycling). */
  sinceShot: number;
  emptyReload: boolean;
  /** Weapon state machine state and equip progress (0 = holstered, 1 = raised). */
  weaponState: "holstered" | "equipping" | "ready" | "reloading" | "holstering";
  raised: number;
  /** Rounds in the magazine (empty → bolt locked back). */
  mag: number;
  /** Authored animation clip range [start, end] in seconds for the current reload phase. */
  clip: [number, number] | null;
  /** Clip name for rigs with one clip per animation. */
  clipName?: string | null;
  /** Grenades: current throw phase and its 0..1 progress. */
  throwPhase?: "idle" | "pin" | "cooked" | "throw" | null;
  throwT?: number;
  /** grenade thrown underhand */
  lob?: boolean;
  /** knife: attack progress 0..1 (or -1) and which attack */
  swing?: number | null;
  swingKind?: string | null;
  /** gun inspect: progress 0..1 (or -1) */
  inspect?: number;
  /** rounds per second (the bolt's cycle on a shot) */
  rpm?: number;
  dt: number;
}

export interface Pose {
  px: number;
  py: number;
  pz: number;
  rx: number;
  ry: number;
  rz: number;
}
export const ZERO_POSE: Pose = { px: 0, py: 0, pz: 0, rx: 0, ry: 0, rz: 0 };

export interface WeaponRig {
  id: WeaponId;
  root: TransformNode;
  muzzle: TransformNode;
  eject: TransformNode;
  sight: TransformNode;
  leftHand: TransformNode;
  rightHand: TransformNode;
  meshes: AbstractMesh[];
  hipPose: Pose;
  sprintPose: Pose;
  adsDistance: number;
  animate(s: RigState): void;
  /** Extra gun pose offset for the current reload phase. */
  reloadPose(phase: string | null, t: number): Pose;
  reset(): void;
  /** Rig ships its own arms (skinned glTF) — hide the procedural forearms. */
  hasArms?: boolean;
  /** Draw/holster are authored clips — skip the procedural drop-in. */
  authoredEquip?: boolean;
  /** Exact aim-down-sights pose (overrides the sight-node solve). */
  adsPose?: Pose;
  /** Point (pivot space) that pose rotations pivot around — e.g. the pistol grip. */
  rotationOrigin?: Vector3;
}

interface Kit {
  scene: Scene;
  gunmetal: PBRMaterial;
  polymer: PBRMaterial;
  accent: PBRMaterial;
  glove: PBRMaterial;
  sleeve: PBRMaterial;
  brass: PBRMaterial;
  shellHull: PBRMaterial;
  lens: StandardMaterial;
  dot: StandardMaterial;
}

let kitCache: Kit | null = null;
function kit(scene: Scene, mats: Materials): Kit {
  if (kitCache && kitCache.scene === scene) return kitCache;
  const p = (name: string, c: Color3, metal: number, rough: number, tex = true) => {
    const m = new PBRMaterial(name, scene);
    m.albedoColor = c;
    m.metallic = metal;
    m.roughness = rough;
    if (tex) {
      m.albedoTexture = mats.polymer;
    }
    m.environmentIntensity = 0.9;
    m.maxSimultaneousLights = 4;
    return m;
  };
  const lens = new StandardMaterial("vm_lens", scene);
  lens.diffuseColor = new Color3(0.2, 0.5, 0.5);
  lens.emissiveColor = new Color3(0.05, 0.16, 0.16);
  lens.specularColor = new Color3(1, 1, 1);
  lens.specularPower = 128;
  lens.alpha = 0.22;
  lens.backFaceCulling = false;
  const dot = new StandardMaterial("vm_dot", scene);
  dot.disableLighting = true;
  dot.emissiveColor = new Color3(1.0, 0.32, 0.1).scale(2.2);
  kitCache = {
    scene,
    gunmetal: p("vm_gunmetal", new Color3(0.13, 0.14, 0.15), 0.85, 0.38),
    polymer: p("vm_polymer", new Color3(0.2, 0.21, 0.19), 0.0, 0.66),
    accent: p("vm_accent", new Color3(0.95, 0.36, 0.12), 0.1, 0.5), // signal orange — SALTLINE livery
    glove: p("vm_glove", new Color3(0.09, 0.09, 0.085), 0, 0.8),
    sleeve: p("vm_sleeve", new Color3(0.13, 0.15, 0.14), 0, 0.9),
    brass: p("vm_brass", new Color3(0.78, 0.58, 0.28), 1, 0.3, false),
    shellHull: p("vm_shell", new Color3(0.72, 0.2, 0.09), 0.05, 0.5, false),
    lens,
    dot,
  };
  return kitCache;
}

export function getBrass(scene: Scene, mats: Materials) {
  return kit(scene, mats).brass;
}
export function getShellHull(scene: Scene, mats: Materials) {
  return kit(scene, mats).shellHull;
}

class PartBuilder {
  readonly meshes: AbstractMesh[] = [];
  constructor(private k: Kit) {}
  box(parent: TransformNode, w: number, h: number, d: number, x: number, y: number, z: number, mat: PBRMaterial | StandardMaterial, rx = 0, ry = 0, rz = 0) {
    const m = MeshBuilder.CreateBox("vm", { width: w, height: h, depth: d }, this.k.scene);
    m.parent = parent;
    m.position.set(x, y, z);
    m.rotation.set(rx, ry, rz);
    m.material = mat;
    this.meshes.push(m);
    return m;
  }
  cyl(parent: TransformNode, d: number, len: number, x: number, y: number, z: number, mat: PBRMaterial | StandardMaterial, tess = 12, dTop?: number) {
    const m = MeshBuilder.CreateCylinder("vm", { diameterBottom: d, diameterTop: dTop ?? d, height: len, tessellation: tess }, this.k.scene);
    m.parent = parent;
    m.position.set(x, y, z);
    m.rotation.x = Math.PI / 2;
    m.material = mat;
    this.meshes.push(m);
    return m;
  }
  node(name: string, parent: TransformNode, x = 0, y = 0, z = 0) {
    const n = new TransformNode(name, this.k.scene);
    n.parent = parent;
    n.position.set(x, y, z);
    return n;
  }
  hand(parent: TransformNode, left: boolean) {
    const h = this.node(left ? "lhand" : "rhand", parent);
    // palm + knuckle wrap + thumb
    this.box(h, 0.05, 0.075, 0.095, 0, 0, 0, this.k.glove);
    this.box(h, 0.054, 0.03, 0.05, left ? 0.012 : -0.012, -0.035, 0.03, this.k.glove, 0.3);
    this.box(h, 0.02, 0.02, 0.055, left ? -0.03 : 0.03, 0.02, 0.02, this.k.glove, 0, left ? 0.3 : -0.3);
    this.box(h, 0.052, 0.012, 0.03, 0, 0.03, -0.04, this.k.accent); // cuff tab
    return h;
  }
}

/** Forearm mesh baked to extend along +Z from its origin (so lookAt aims it at the elbow). */
export function makeForearm(scene: Scene, mats: Materials) {
  const k = kit(scene, mats);
  const arm = new TransformNode("forearm", scene);
  const sleeve = MeshBuilder.CreateCylinder("vm_arm", { diameterTop: 0.075, diameterBottom: 0.1, height: 0.42, tessellation: 10 }, scene);
  sleeve.rotation.x = Math.PI / 2;
  sleeve.position.z = 0.26;
  sleeve.bakeCurrentTransformIntoVertices();
  sleeve.material = k.sleeve;
  sleeve.parent = arm;
  const wrist = MeshBuilder.CreateCylinder("vm_wrist", { diameterTop: 0.068, diameterBottom: 0.075, height: 0.06, tessellation: 10 }, scene);
  wrist.rotation.x = Math.PI / 2;
  wrist.position.z = 0.04;
  wrist.bakeCurrentTransformIntoVertices();
  wrist.material = k.glove;
  wrist.parent = arm;
  return { node: arm, meshes: [sleeve, wrist] as AbstractMesh[] };
}

// ======================================================================== RIFLE
export function buildRifle(scene: Scene, mats: Materials): WeaponRig {
  const k = kit(scene, mats);
  const B = new PartBuilder(k);
  const root = new TransformNode("rifle", scene);

  // receiver group
  B.box(root, 0.054, 0.062, 0.34, 0, 0.035, 0.06, k.gunmetal);
  B.box(root, 0.048, 0.052, 0.22, 0, -0.018, 0.04, k.polymer);
  B.box(root, 0.063, 0.064, 0.3, 0, 0.03, 0.38, k.polymer);
  for (const s of [-1, 1]) {
    B.box(root, 0.003, 0.012, 0.22, s * 0.032, 0.03, 0.39, k.accent);
    for (let i = 0; i < 4; i++) B.box(root, 0.004, 0.018, 0.03, s * 0.0325, 0.046, 0.29 + i * 0.06, k.gunmetal);
  }
  B.box(root, 0.024, 0.012, 0.64, 0, 0.072, 0.22, k.gunmetal); // top rail
  for (let i = 0; i < 14; i++) B.box(root, 0.026, 0.004, 0.012, 0, 0.0795, -0.06 + i * 0.045, k.gunmetal);
  B.cyl(root, 0.017, 0.18, 0, 0.03, 0.61, k.gunmetal);
  B.cyl(root, 0.03, 0.065, 0, 0.03, 0.725, k.gunmetal, 8);
  B.box(root, 0.034, 0.008, 0.02, 0, 0.03, 0.735, k.polymer); // brake slots
  B.box(root, 0.03, 0.03, 0.04, 0, 0.05, 0.545, k.gunmetal); // gas block
  // stock
  B.cyl(root, 0.03, 0.2, 0, 0.03, -0.17, k.gunmetal);
  B.box(root, 0.046, 0.075, 0.2, 0, 0.005, -0.25, k.polymer);
  B.box(root, 0.04, 0.03, 0.12, 0, 0.055, -0.25, k.polymer);
  B.box(root, 0.05, 0.11, 0.026, 0, -0.005, -0.362, k.accent);
  // grip + trigger guard
  B.box(root, 0.032, 0.1, 0.048, 0, -0.075, -0.045, k.polymer, 0.28);
  B.box(root, 0.008, 0.006, 0.07, 0, -0.06, 0.02, k.gunmetal);
  B.box(root, 0.005, 0.022, 0.005, 0, -0.05, 0.02, k.gunmetal, -0.3);
  // reflex sight (original "tide-glass" optic)
  const sightY = 0.112;
  const sightZ = 0.04;
  B.box(root, 0.05, 0.016, 0.07, 0, 0.082, sightZ, k.gunmetal);
  for (const s of [-1, 1]) B.box(root, 0.006, 0.05, 0.05, s * 0.024, sightY, sightZ + 0.005, k.gunmetal);
  B.box(root, 0.054, 0.006, 0.055, 0, sightY + 0.027, sightZ + 0.005, k.gunmetal);
  B.box(root, 0.054, 0.004, 0.02, 0, sightY + 0.031, sightZ + 0.005, k.accent);
  const lens = MeshBuilder.CreatePlane("vm_lens", { width: 0.042, height: 0.044 }, scene);
  lens.parent = root;
  lens.position.set(0, sightY, sightZ + 0.02);
  lens.material = k.lens;
  B.meshes.push(lens);
  const dot = MeshBuilder.CreateDisc("vm_dot", { radius: 0.0011, tessellation: 10 }, scene);
  dot.parent = root;
  dot.position.set(0, sightY, sightZ + 0.019);
  dot.material = k.dot;
  B.meshes.push(dot);

  // moving parts
  const magNode = B.node("mag", root, 0, -0.045, 0.1);
  B.box(magNode, 0.026, 0.17, 0.066, 0, -0.08, 0.008, k.polymer, 0.2);
  B.box(magNode, 0.03, 0.016, 0.074, 0, -0.164, 0.026, k.accent, 0.2);
  B.box(magNode, 0.0272, 0.04, 0.05, 0, -0.025, 0, k.polymer, 0.2);
  const bolt = B.node("bolt", root, 0.027, 0.04, 0.11);
  B.box(bolt, 0.006, 0.02, 0.05, 0, 0, 0, k.brass);
  const handle = B.node("chargeHandle", root, 0, 0.065, -0.07);
  B.box(handle, 0.05, 0.01, 0.02, 0, 0, 0, k.gunmetal);

  const muzzle = B.node("muzzle", root, 0, 0.03, 0.76);
  const eject = B.node("eject", root, 0.035, 0.04, 0.11);
  const sight = B.node("sight", root, 0, sightY, sightZ);
  const leftHand = B.hand(root, true);
  const rightHand = B.hand(root, false);
  rightHand.position.set(0.0, -0.068, -0.055);
  rightHand.rotation.set(0.25, 0, 0);

  const guardAnchor = new Vector3(-0.012, -0.03, 0.4);
  const magAnchor = new Vector3(-0.02, -0.1, 0.12);
  const handleAnchor = new Vector3(0.0, 0.07, -0.1);
  const pocket = new Vector3(-0.14, -0.38, 0.05);
  const tmp = new Vector3();
  const setHand = (v: Vector3, rx = 0.15, rz = 0.5) => {
    leftHand.position.copyFrom(v);
    leftHand.rotation.set(rx, 0, rz);
  };

  return {
    id: "rifle",
    root,
    muzzle,
    eject,
    sight,
    leftHand,
    rightHand,
    meshes: B.meshes,
    hipPose: { px: 0.15, py: -0.175, pz: 0.33, rx: 0.0, ry: -0.04, rz: 0 },
    sprintPose: { px: -0.06, py: -0.03, pz: -0.03, rx: 0.35, ry: 0.65, rz: 0.35 },
    adsDistance: 0.2,
    animate(s: RigState) {
      // bolt cycling on fire: back 30 mm then forward within one 83 ms cycle
      const c = saturate(s.sinceShot / 0.06);
      bolt.position.z = 0.11 - 0.028 * bump(c);
      magNode.position.set(0, -0.045, 0.1);
      magNode.rotation.set(0, 0, 0);
      handle.position.z = -0.07;
      setHand(guardAnchor);
      switch (s.phase) {
        case "lower": {
          Vector3.LerpToRef(guardAnchor, magAnchor, easeInOutSine(s.t), tmp);
          setHand(tmp, 0.1, lerp(0.5, 0.2, s.t));
          break;
        }
        case "magOut": {
          const drop = easeInOutSine(saturate((s.t - 0.12) / 0.5));
          magNode.position.y -= drop * 0.42;
          magNode.position.z += drop * 0.04;
          magNode.rotation.x = drop * 0.4;
          magNode.rotation.z = drop * -0.5;
          const follow = magAnchor.add(new Vector3(0, -drop * 0.42, drop * 0.03));
          Vector3.LerpToRef(magAnchor, pocket, saturate((s.t - 0.55) / 0.45), tmp);
          setHand(s.t < 0.55 ? follow : tmp, 0.1, 0.2);
          break;
        }
        case "magIn": {
          const rise = easeOutCubic(saturate(s.t / 0.72));
          magNode.position.y -= (1 - rise) * 0.36;
          magNode.position.z += (1 - rise) * 0.05;
          magNode.rotation.x = (1 - rise) * 0.3;
          magNode.rotation.z = (1 - rise) * -0.35;
          // seat bump at insertion
          const seat = s.t > 0.72 ? bump(saturate((s.t - 0.72) / 0.12)) * 0.006 : 0;
          magNode.position.y += seat;
          const at = magAnchor.add(new Vector3(0, -(1 - rise) * 0.36, 0));
          Vector3.LerpToRef(at, s.emptyReload ? handleAnchor : guardAnchor, easeInOutSine(saturate((s.t - 0.8) / 0.2)), tmp);
          setHand(tmp, 0.1, 0.2);
          break;
        }
        case "bolt": {
          const pull = s.t < 0.35 ? easeInOutSine(saturate((s.t - 0.1) / 0.25)) : 1 - saturate((s.t - 0.35) / 0.06);
          handle.position.z = -0.07 - pull * 0.06;
          tmp.copyFrom(handleAnchor);
          tmp.z -= pull * 0.06;
          if (s.t > 0.45) Vector3.LerpToRef(handleAnchor, guardAnchor, easeInOutSine(saturate((s.t - 0.45) / 0.55)), tmp);
          setHand(tmp, -0.3, 0.9);
          break;
        }
        case "raise": {
          Vector3.LerpToRef(magAnchor, guardAnchor, easeInOutSine(s.t), tmp);
          if (s.emptyReload) tmp.copyFrom(guardAnchor);
          setHand(tmp);
          break;
        }
      }
    },
    reloadPose(phase, t) {
      switch (phase) {
        case "lower":
          return { px: -0.04 * t, py: 0.02 * t, pz: -0.02 * t, rx: -0.2 * t, ry: 0.12 * t, rz: 0.3 * easeInOutSine(t) };
        case "magOut":
        case "magIn": {
          const wob = phase === "magIn" && t > 0.72 ? bump(saturate((t - 0.72) / 0.15)) * 0.05 : 0;
          return { px: -0.04, py: 0.02 + wob * 0.1, pz: -0.02, rx: -0.2 - wob, ry: 0.12, rz: 0.3 };
        }
        case "bolt":
          return { px: -0.02, py: 0.0, pz: 0, rx: -0.08, ry: -0.08, rz: lerp(0.3, -0.22, easeInOutSine(saturate(t * 3))) + bump(saturate((t - 0.35) / 0.15)) * 0.05 };
        case "raise":
          return { px: -0.04 * (1 - t), py: 0.02 * (1 - t), pz: -0.02 * (1 - t), rx: -0.2 * (1 - t), ry: 0.12 * (1 - t), rz: 0.3 * (1 - easeInOutSine(t)) };
      }
      return ZERO_POSE;
    },
    reset() {
      bolt.position.z = 0.11;
      magNode.position.set(0, -0.045, 0.1);
      magNode.rotation.set(0, 0, 0);
      handle.position.z = -0.07;
      setHand(guardAnchor);
    },
  };
}

export function buildRig(id: WeaponId, scene: Scene, mats: Materials) {
  void id;
  return buildRifle(scene, mats);
}

/** Merge static (non-animated) meshes of a rig per material to cut draw calls. */
export function optimizeRig(rig: WeaponRig) {
  const movable = new Set<TransformNode>();
  rig.root.getChildTransformNodes(false).forEach((n) => movable.add(n));
  const staticByMat = new Map<string, Mesh[]>();
  const keep: AbstractMesh[] = [];
  for (const m of rig.meshes) {
    if (m.parent === rig.root && m instanceof Mesh && m.material && m.material.alpha === 1 && !(m.material instanceof StandardMaterial)) {
      const key = m.material.uniqueId + "";
      if (!staticByMat.has(key)) staticByMat.set(key, []);
      staticByMat.get(key)!.push(m);
    } else keep.push(m);
  }
  for (const list of staticByMat.values()) {
    const mat = list[0].material;
    // MergeMeshes bakes world matrices; temporarily detach root transform.
    const merged = Mesh.MergeMeshes(list, true, true, undefined, false, false);
    if (merged) {
      merged.material = mat;
      merged.parent = null;
      // merged vertices are in world space at build time (root at identity) → parent to root
      merged.parent = rig.root;
      keep.push(merged);
    }
  }
  rig.meshes.length = 0;
  rig.meshes.push(...keep);
  void clamp;
}
