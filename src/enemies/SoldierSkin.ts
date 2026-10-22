import { AbstractMesh } from "@babylonjs/core/Meshes/abstractMesh";
import { AssetContainer } from "@babylonjs/core/assetContainer";
import { InstancedMesh } from "@babylonjs/core/Meshes/instancedMesh";
import { LoadAssetContainerAsync } from "@babylonjs/core/Loading/sceneLoader";
import { Matrix, Quaternion, Vector3 } from "@babylonjs/core/Maths/math.vector";
import { Mesh } from "@babylonjs/core/Meshes/mesh";
import { Node } from "@babylonjs/core/node";
import { PBRMaterial } from "@babylonjs/core/Materials/PBR/pbrMaterial";
import { Scene } from "@babylonjs/core/scene";
import { TransformNode } from "@babylonjs/core/Meshes/transformNode";
import { alignDir, forceWorld, toLocalDir, worldPos } from "../core/ik";
import { extFor } from "../weapons/ArmsRig";
import { PoseRig } from "../core/pose";
import { SoldierParts } from "./EnemyModel";
import { AnimSet, ClipKey, PoseBuffer, loadSoldierAnims } from "./SoldierAnim";
import { EnemyRagdoll, RagdollGun, RagdollImpulse } from "./EnemyRagdoll";
import { AnimOutput, EnemyAnimationController } from "./EnemyAnimationController";
import markUrl from "../assets/soldier_mark.glb?url";
import fsbUrl from "../assets/soldier_fsb.glb?url";
import polishUrl from "../assets/soldier_polish.glb?url";
import girlUrl from "../assets/soldier_girl.glb?url";
import winterUrl from "../assets/winter_soldier.glb?url";
import { autoSkin } from "../characters/autoSkin";
import { retargetSoldierAnims, retargetTable, type RetargetNames } from "./SoldierRetarget";

/**
 * Skinned soldier characters for the hostiles, driven by motion-captured rifle
 * animations (see SoldierAnim) with procedural layers on top (aiming, crouch,
 * left-hand IK, flinches, flashbang reaction) and a procedural death fall.
 * Two characters ship: "Mark" (Character Creator rig) and the FSB operator
 * (Mixamo rig) — the bone maps below are the only rig-specific part.
 */

/**
 * The city stage (Operation Winter) dresses its soldiers differently: the Polish soldier and the
 * soldier girl, and the Winter Soldier as its boss — driven by the same mocap, retargeted onto their
 * own skeletons when the stage loads (SoldierRetarget).
 */
export type SkinKind = "mark" | "fsb" | "polish" | "girl" | "winter";

export interface ArmMap {
  up: string;
  fore: string;
  hand: string;
  mid: string;
  index: string;
  pinky: string;
}
export interface LegMap {
  thigh: string;
  calf: string;
  foot: string;
  toe: string;
}
export interface RigMap {
  url: string;
  hips: string;
  spine: string[];
  neck: string;
  head: string;
  L: ArmMap;
  R: ArmMap;
  LL: LegMap;
  RL: LegMap;
  /** static props that should ride the chest (pouches, spare mags, patches) */
  toChest?: string[];
  /** nodes to remove (the model's own rifle — we hand everyone the same, IK-held one) */
  hide?: string[];
  /**
   * fingers modelled straight (an A-pose): curled round the grip at load, radians per joint (the
   * thumb less). The rigs that come holding their rifle already have their fingers closed.
   */
  curl?: number;
}

export const RIGS: Record<SkinKind, RigMap> = {
  mark: {
    url: markUrl,
    hips: "CC_Base_Hip",
    spine: ["CC_Base_Waist", "CC_Base_Spine01", "CC_Base_Spine02"],
    neck: "CC_Base_NeckTwist01",
    head: "CC_Base_Head",
    L: { up: "CC_Base_L_Upperarm", fore: "CC_Base_L_Forearm", hand: "CC_Base_L_Hand", mid: "CC_Base_L_Mid1", index: "CC_Base_L_Index1", pinky: "CC_Base_L_Pinky1" },
    R: { up: "CC_Base_R_Upperarm", fore: "CC_Base_R_Forearm", hand: "CC_Base_R_Hand", mid: "CC_Base_R_Mid1", index: "CC_Base_R_Index1", pinky: "CC_Base_R_Pinky1" },
    LL: { thigh: "CC_Base_L_Thigh", calf: "CC_Base_L_Calf", foot: "CC_Base_L_Foot", toe: "CC_Base_L_ToeBase" },
    RL: { thigh: "CC_Base_R_Thigh", calf: "CC_Base_R_Calf", foot: "CC_Base_R_Foot", toe: "CC_Base_R_ToeBase" },
  },
  fsb: {
    url: fsbUrl,
    hips: "mixamorig:Hips",
    spine: ["mixamorig:Spine", "mixamorig:Spine1", "mixamorig:Spine2"],
    neck: "mixamorig:Neck",
    head: "mixamorig:Head",
    L: { up: "mixamorig:LeftArm", fore: "mixamorig:LeftForeArm", hand: "mixamorig:LeftHand", mid: "mixamorig:LeftHandMiddle1", index: "mixamorig:LeftHandIndex1", pinky: "mixamorig:LeftHandPinky1" },
    R: { up: "mixamorig:RightArm", fore: "mixamorig:RightForeArm", hand: "mixamorig:RightHand", mid: "mixamorig:RightHandMiddle1", index: "mixamorig:RightHandIndex1", pinky: "mixamorig:RightHandPinky1" },
    LL: { thigh: "mixamorig:LeftUpLeg", calf: "mixamorig:LeftLeg", foot: "mixamorig:LeftFoot", toe: "mixamorig:LeftToeBase" },
    RL: { thigh: "mixamorig:RightUpLeg", calf: "mixamorig:RightLeg", foot: "mixamorig:RightFoot", toe: "mixamorig:RightToeBase" },
    toChest: ["pouch", "Magazine.0", "Plane"],
    hide: ["Gun_99"],
  },
  // the Polish soldier: a Blender rig with numbered bones (read off its hierarchy and joint positions);
  // no toe bones — a toe joint is made on each foot at load
  polish: {
    url: polishUrl,
    hips: "Bone_base_soldier1",
    spine: ["Bone.002_base_soldier1", "Bone.003_base_soldier1"],
    neck: "Bone.004_base_soldier1",
    head: "Bone.005_base_soldier1",
    L: { up: "Bone.013_base_soldier1", fore: "Bone.014_base_soldier1", hand: "Bone.015_base_soldier1", mid: "Bone.020_base_soldier1", index: "Bone.019_base_soldier1", pinky: "Bone.022_base_soldier1" },
    R: { up: "Bone.036_base_soldier1", fore: "Bone.037_base_soldier1", hand: "Bone.038_base_soldier1", mid: "Bone.043_base_soldier1", index: "Bone.042_base_soldier1", pinky: "Bone.045_base_soldier1" },
    LL: { thigh: "Bone.007_base_soldier1", calf: "Bone.008_base_soldier1", foot: "Bone.009_base_soldier1", toe: "toe_L" },
    RL: { thigh: "Bone.010_base_soldier1", calf: "Bone.011_base_soldier1", foot: "Bone.012_base_soldier1", toe: "toe_R" },
    hide: ["WZ96 Beryl_0", "WZ96 Beryl mag_0", "RGZ89"],
  },
  // the soldier girl: her file has no skeleton — one is made at load (characters/autoSkin), Mixamo-named
  girl: {
    url: girlUrl,
    hips: "Hips",
    spine: ["Spine", "Spine1", "Spine2"],
    neck: "Neck",
    head: "Head",
    L: { up: "LeftArm", fore: "LeftForeArm", hand: "LeftHand", mid: "LeftHandMiddle1", index: "LeftHandIndex1", pinky: "LeftHandPinky1" },
    R: { up: "RightArm", fore: "RightForeArm", hand: "RightHand", mid: "RightHandMiddle1", index: "RightHandIndex1", pinky: "RightHandPinky1" },
    LL: { thigh: "LeftUpLeg", calf: "LeftLeg", foot: "LeftFoot", toe: "LeftToeBase" },
    RL: { thigh: "RightUpLeg", calf: "RightLeg", foot: "RightFoot", toe: "RightToeBase" },
    hide: ["extras_GUN.001_0", "extras_PISTOL.001_0", "extras_FLASH.001_0"],
  },
  // the Winter Soldier: 3ds Max Biped
  winter: {
    url: winterUrl,
    hips: "bip001 pelvis",
    spine: ["bip001 spine", "bip001 spine1", "bip001 spine2"],
    neck: "bip001 neck",
    head: "bip001 head",
    L: { up: "bip001 l upperarm", fore: "bip001 l forearm", hand: "bip001 l hand", mid: "bip001 l finger2", index: "bip001 l finger1", pinky: "bip001 l finger4" },
    R: { up: "bip001 r upperarm", fore: "bip001 r forearm", hand: "bip001 r hand", mid: "bip001 r finger2", index: "bip001 r finger1", pinky: "bip001 r finger4" },
    LL: { thigh: "bip001 l thigh", calf: "bip001 l calf", foot: "bip001 l foot", toe: "bip001 l toe0" },
    RL: { thigh: "bip001 r thigh", calf: "bip001 r calf", foot: "bip001 r foot", toe: "bip001 r toe0" },
    curl: 0.55,
  },
};

/** the retargeted rigs: which of their bones plays which of the FSB's, how tall they stand, what's done to the file first */
const RETARGET: Partial<Record<SkinKind, { names: RetargetNames; height: number; prep?: (c: AssetContainer) => void }>> = {
  polish: {
    height: 1.84,
    names: {
      hips: "Bone_base_soldier1", spine: "Bone.002_base_soldier1", chest: "Bone.003_base_soldier1", neck: "Bone.004_base_soldier1", head: "Bone.005_base_soldier1",
      L: { clav: "Bone.006_base_soldier1", up: "Bone.013_base_soldier1", fore: "Bone.014_base_soldier1", hand: "Bone.015_base_soldier1", mid: "Bone.020_base_soldier1" },
      R: { clav: "Bone.035_base_soldier1", up: "Bone.036_base_soldier1", fore: "Bone.037_base_soldier1", hand: "Bone.038_base_soldier1", mid: "Bone.043_base_soldier1" },
      LL: { thigh: "Bone.007_base_soldier1", calf: "Bone.008_base_soldier1", foot: "Bone.009_base_soldier1", toe: "toe_L" },
      RL: { thigh: "Bone.010_base_soldier1", calf: "Bone.011_base_soldier1", foot: "Bone.012_base_soldier1", toe: "toe_R" },
    },
    prep: (c) => {
      // a toe joint ahead of each ankle (the rig ends at the ankles): the feet need somewhere to point
      const all = c.meshes[0].getDescendants(false) as Node[];
      for (const [side, foot] of [["L", "Bone.009_base_soldier1"], ["R", "Bone.012_base_soldier1"]] as const) {
        const f = findIn(all, foot);
        if (!f) continue;
        const toe = new TransformNode("toe_" + side, f.getScene());
        toe.parent = f;
        const w = forceWorld(f);
        const at = Vector3.TransformCoordinates(Vector3.Zero(), w).add(new Vector3(0, -0.06, 0.15));
        toe.position.copyFrom(Vector3.TransformCoordinates(at, w.clone().invert()));
        c.transformNodes.push(toe);
      }
    },
  },
  girl: {
    height: 1.7,
    names: {
      hips: "Hips", spine: "Spine", chest: "Spine2", neck: "Neck", head: "Head",
      L: { clav: "LeftShoulder", up: "LeftArm", fore: "LeftForeArm", hand: "LeftHand", mid: "LeftHandMiddle1" },
      R: { clav: "RightShoulder", up: "RightArm", fore: "RightForeArm", hand: "RightHand", mid: "RightHandMiddle1" },
      LL: { thigh: "LeftUpLeg", calf: "LeftLeg", foot: "LeftFoot", toe: "LeftToeBase" },
      RL: { thigh: "RightUpLeg", calf: "RightLeg", foot: "RightFoot", toe: "RightToeBase" },
    },
    prep: (c) => {
      // (her rifle, pistol and torch are a separate group in the file: not part of her)
      // (her chest plate is in that group too: it's part of her)
      autoSkin(c, (m) => !/^extras_(GUN|PISTOL|FLASH)/.test(m.name));
      // (a made skeleton has no fingers: two markers either side of each hand's middle, for its grip)
      const all = c.meshes[0].getDescendants(false) as Node[];
      for (const S of ["Left", "Right"]) {
        const hand = findIn(all, S + "Hand"), mid = findIn(all, S + "HandMiddle1");
        if (!hand || !mid) continue;
        const along = mid.position.clone();
        // across the palm: square to the hand's line and to "up the body"
        const across = Vector3.Cross(along, new Vector3(0, 0, 1)).normalize().scale(along.length() * 0.5);
        for (const [name, k] of [["Index1", 1], ["Pinky1", -1]] as const) {
          const n = new TransformNode(S + "Hand" + name, hand.getScene());
          n.parent = hand;
          n.position.copyFrom(along.scale(0.9).add(across.scale(k)));
          c.transformNodes.push(n);
        }
      }
    },
  },
  winter: {
    height: 1.86,
    prep: (c) => {
      // his own guns are skinned to three prop bones (one beside his hand, one under the ground):
      // squashed to nothing — he carries the same rifle as everyone
      const all = c.meshes[0].getDescendants(false) as Node[];
      for (const b of ["bone180202", "bone180203", "bone180204"]) (findIn(all, b) as TransformNode | null)?.scaling.setAll(0);
    },
    names: {
      hips: "bip001 pelvis", spine: "bip001 spine", chest: "bip001 spine2", neck: "bip001 neck", head: "bip001 head",
      L: { clav: "bip001 l clavicle", up: "bip001 l upperarm", fore: "bip001 l forearm", hand: "bip001 l hand", mid: "bip001 l finger2" },
      R: { clav: "bip001 r clavicle", up: "bip001 r upperarm", fore: "bip001 r forearm", hand: "bip001 r hand", mid: "bip001 r finger2" },
      LL: { thigh: "bip001 l thigh", calf: "bip001 l calf", foot: "bip001 l foot", toe: "bip001 l toe0" },
      RL: { thigh: "bip001 r thigh", calf: "bip001 r calf", foot: "bip001 r foot", toe: "bip001 r toe0" },
    },
  },
};

/**
 * Rifle frame "G" (metres): origin = centre of the AKS-74U, +Z = muzzle, +Y = up
 * (away from the magazine), +X = right. Measured from the FSB operator's authored
 * hold: where each wrist sits and how each hand is turned (wrist→middle knuckle,
 * pinky→index knuckle).
 */
const G = {
  rWrist: new Vector3(0.0181, -0.0517, -0.2677),
  rD1: new Vector3(0.0078, -0.0221, 0.1186),
  rD2: new Vector3(0.0082, 0.0853, 0.0076),
  lWrist: new Vector3(-0.0907, 0.0054, 0.1253),
  lD1: new Vector3(0.1122, -0.0485, 0.0123),
  lD2: new Vector3(-0.018, -0.0058, 0.0821),
  rPole: new Vector3(0.32, -0.5, -0.45),
  lPole: new Vector3(-0.4, -0.45, -0.05),
  /** gun-node local position of G's origin (gun node = the driver's rifle) */
  mount: new Vector3(0, -0.01, 0.1),
  /** Gun_99-local definition of G (origin and axes), from the same measurement */
  local: {
    origin: new Vector3(0.03313, 1.39531, 1.26626),
    R: new Vector3(-9.72741, 0.12433, -0.24787),
    U: new Vector3(0.22107, 8.72804, -4.2979),
    F: new Vector3(-0.1674, 4.30179, 8.72732),
  },
};

/** Drop vertex attributes not shared by every mesh, so they can be merged. */
function commonAttributes(list: Mesh[]) {
  const sets = list.map((m) => new Set(m.getVerticesDataKinds()));
  const common = [...sets[0]].filter((k) => sets.every((st) => st.has(k)));
  for (const m of list) for (const k of m.getVerticesDataKinds()) if (!common.includes(k)) m.removeVerticesData(k);
}

/**
 * Close a hand's fingers (bind pose, at load): every finger joint turned toward the palm by `curl`
 * radians (the thumb by less). The palm is the side the thumb sits on.
 */
function curlFingers(hand: TransformNode, mid: Vector3, curl: number) {
  const isFinger = (n: Node): n is TransformNode => n instanceof TransformNode && !(n instanceof AbstractMesh) && /finger|thumb|index|middle|ring|pinky/i.test(n.name);
  const bases = hand.getChildren().filter(isFinger);
  const thumb = bases.find((n) => /thumb|finger0$|finger0[_#]/i.test(n.name));
  if (!thumb || bases.length < 3) return;
  const hp = worldPos(hand);
  const along = mid.subtract(hp).normalize();
  // (the palm: from the hand's line toward the thumb)
  const tp = worldPos(thumb).subtract(hp);
  const palm = tp.subtract(along.scale(Vector3.Dot(tp, along)));
  if (palm.lengthSquared() < 1e-8) return;
  palm.normalize();
  for (const base of bases) {
    const k = base === thumb ? 0.45 : 1;
    for (let j: TransformNode | undefined = base; j; ) {
      const next = j.getChildren().find(isFinger);
      if (!next) break;
      const joint: TransformNode = j, child: TransformNode = next;
      const measure = () => worldPos(child).subtract(worldPos(joint));
      const dir = measure().normalize();
      const n = palm.subtract(dir.scale(Vector3.Dot(palm, dir)));
      if (n.lengthSquared() > 1e-6) {
        n.normalize();
        const a = curl * k;
        alignDir(joint, dir, dir.scale(Math.cos(a)).addInPlace(n.scaleInPlace(Math.sin(a))), measure);
      }
      j = child;
    }
  }
}

export const findIn = (nodes: Node[], base: string) => {
  const re = new RegExp("^" + base.replace(/[.*+?^${}()|[\]\\]/g, "\\$&") + "(_\\d+)?(#\\d+)?$");
  return (nodes.find((n) => re.test(n.name)) as TransformNode | undefined) ?? null;
};

export class SoldierSkins {
  private containers = {} as Record<SkinKind, AssetContainer>;
  /** shared rifle (merged AKS-74U in frame G) — every soldier gets an instance */
  gun!: Mesh;
  /** muzzle in G */
  muzzleG = new Vector3(0, 0.03, 0.3);
  private anims!: Record<SkinKind, AnimSet>;

  /** the characters loaded for this stage (the FSB operator always: the rifle and the mocap come from him) */
  readonly kinds: SkinKind[] = [];
  static async load(scene: Scene, onProgress?: (p: number) => void, kinds: SkinKind[] = ["mark", "fsb"]) {
    const s = new SoldierSkins();
    const want = [...new Set<SkinKind>(["fsb", ...kinds])];
    s.kinds.push(...kinds);
    const prog = want.map(() => 0);
    const rep = () => onProgress?.(prog.reduce((a, b) => a + b, 0) / prog.length);
    const animsP = loadSoldierAnims();
    const loaded = await Promise.all(
      want.map((k, i) =>
        LoadAssetContainerAsync(RIGS[k].url, scene, { pluginExtension: extFor(RIGS[k].url), onProgress: (e) => e.lengthComputable && ((prog[i] = e.loaded / e.total), rep()) }),
      ),
    );
    want.forEach((k, i) => (s.containers[k] = loaded[i]));
    const fsb = s.containers.fsb;
    for (const k of want) {
      const r = RETARGET[k];
      if (!r) continue;
      const c = s.containers[k];
      r.prep?.(c);
      // stood at its height (the rigs come in centimetres, metres, or a Sketchfab node's own scale)
      const root = c.meshes[0];
      root.computeWorldMatrix(true);
      let lo = Infinity, hi = -Infinity;
      for (const m of c.meshes) {
        if (!m.getTotalVertices()) continue;
        m.computeWorldMatrix(true);
        m.refreshBoundingInfo({ applySkeleton: true });
        const b = m.getBoundingInfo().boundingBox;
        lo = Math.min(lo, b.minimumWorld.y);
        hi = Math.max(hi, b.maximumWorld.y);
      }
      if (isFinite(hi - lo) && hi - lo > 1e-3) root.scaling.scaleInPlace(r.height / (hi - lo));
      root.computeWorldMatrix(true);
    }
    for (const c of want.map((k) => s.containers[k])) {
      c.addAllToScene();
      c.meshes[0].setEnabled(false);
      for (const m of c.materials) {
        if (!(m instanceof PBRMaterial)) continue;
        m.maxSimultaneousLights = 4;
        m.environmentIntensity = 0.85;
        m.metallic = Math.min(m.metallic ?? 0, 0.2);
      }
    }
    s.buildGun(scene, fsb);
    s.anims = await animsP;
    // the mocap onto the rigs it wasn't recorded on
    for (const k of want) {
      const r = RETARGET[k];
      if (!r) continue;
      s.anims[k] = retargetSoldierAnims(s.anims.fsb, s.restNodes("fsb"), s.restNodes(k), retargetTable(r.names), r.names.hips);
    }
    return s;
  }

  /** Bake the FSB operator's AKS-74U into one multi-material mesh in frame G. */
  private buildGun(scene: Scene, fsb: AssetContainer) {
    const all = fsb.meshes[0].getDescendants(false) as Node[];
    const gunNode = findIn(all, "Gun_99")!;
    const gw = forceWorld(gunNode);
    const L = G.local;
    const o = Vector3.TransformCoordinates(L.origin, gw);
    const R = Vector3.TransformNormal(L.R, gw).normalize();
    const U = Vector3.TransformNormal(L.U, gw).normalize();
    const F = Vector3.TransformNormal(L.F, gw).normalize();
    // world → G (row vectors): translate, then project on R/U/F
    const toG = Matrix.Translation(-o.x, -o.y, -o.z).multiply(Matrix.FromValues(R.x, U.x, F.x, 0, R.y, U.y, F.y, 0, R.z, U.z, F.z, 0, 0, 0, 0, 1));
    const parts: Mesh[] = [];
    const stockNode = findIn(all, "Stock_98");
    for (const m of gunNode.getChildMeshes(false) as Mesh[]) {
      if (!m.getTotalVertices()) continue;
      const w = forceWorld(m).clone();
      const c = m.clone(m.name + "_g", null, true) as Mesh;
      c.setEnabled(true);
      c.parent = null;
      c.position.setAll(0);
      c.rotationQuaternion = Quaternion.Identity();
      c.scaling.setAll(1);
      c.bakeTransformIntoVertices(w.multiply(toG));
      if (stockNode && m.isDescendantOf(stockNode)) this.straightenStock(c, Vector3.TransformCoordinates(forceWorld(stockNode).getTranslation(), toG));
      parts.push(c);
    }
    commonAttributes(parts);
    const gun = Mesh.MergeMeshes(parts, true, true, undefined, false, true)!;
    gun.name = "enemyRifle";
    gun.isPickable = false;
    gun.isVisible = false; // template: instances render
    // muzzle = front-most centre of the barrel
    const pos = gun.getVerticesData("position")!;
    let maxZ = -1e9;
    for (let i = 2; i < pos.length; i += 3) maxZ = Math.max(maxZ, pos[i]);
    let n = 0;
    const acc = new Vector3();
    for (let i = 0; i < pos.length; i += 3) if (pos[i + 2] > maxZ - 0.012) (acc.x += pos[i], acc.y += pos[i + 1], n++);
    this.muzzleG.set(acc.x / Math.max(1, n), acc.y / Math.max(1, n), maxZ + 0.01);
    this.gun = gun;
    void scene;
  }

  /**
   * The rest pose leaves the AKS-74U's skeleton stock swung up off the receiver;
   * rotate it about its hinge so it runs straight back into the shoulder.
   */
  private straightenStock(m: Mesh, hinge: Vector3) {
    const pos = m.getVerticesData("position")!;
    // farthest point from the hinge = the butt plate
    let far = 0;
    const tip = new Vector3();
    for (let i = 0; i < pos.length; i += 3) {
      const d = (pos[i] - hinge.x) ** 2 + (pos[i + 1] - hinge.y) ** 2 + (pos[i + 2] - hinge.z) ** 2;
      if (d > far) {
        far = d;
        tip.set(pos[i], pos[i + 1], pos[i + 2]);
      }
    }
    const from = tip.subtract(hinge).normalize();
    const to = new Vector3(0, -0.1, -1).normalize();
    const q = new Quaternion();
    Quaternion.FromUnitVectorsToRef(from, to, q);
    const rot = new Matrix();
    q.toRotationMatrix(rot);
    m.bakeTransformIntoVertices(Matrix.Translation(-hinge.x, -hinge.y, -hinge.z).multiply(rot).multiply(Matrix.Translation(hinge.x, hinge.y, hinge.z)));
  }

  /** a character's unposed template nodes (its rest pose: the reference for retargeting onto other rigs) */
  restNodes(kind: SkinKind): Node[] {
    return this.containers[kind].meshes[0].getDescendants(false) as Node[];
  }

  create(kind: SkinKind, parts: SoldierParts, idx: number): SoldierSkin {
    return new SoldierSkin(this, this.containers[kind], RIGS[kind], parts, idx, this.anims[kind]);
  }
}

/** What the AI wants the body to do this frame. */
export interface AnimInput {
  dt: number;
  /** ground speed, m/s */
  speed: number;
  /** body-local velocity (x right, z forward), m/s */
  vx: number;
  vz: number;
  /** 0 = low ready, 1 = rifle shouldered */
  aim: number;
  /** 0..1 */
  crouch: number;
  /** leaning out of cover: -1 left … +1 right (spine roll) */
  lean?: number;
  /** moving crouched (cover shuffle / crouched retreat) */
  crouchMove: boolean;
  /** reload progress 0..1, or -1 */
  reload: number;
  /** 0..1 off hand over the eyes (flashbanged) */
  blind: number;
  /** world point the muzzle should track, weight 0..1 */
  aimAt: Vector3 | null;
  aimW: number;
  /** additive reactions (radians) */
  hitPitch: number;
  hitYaw: number;
  recoil: number;
  /** 0 the rifle … 1 the sidearm drawn, two hands on it (a soldier who carries one: the boss) */
  pistol?: number;
}

type DriverKey = "hips" | "spine" | "neck" | "shoulderL" | "shoulderR" | "elbowL" | "elbowR" | "hipL" | "hipR" | "kneeL" | "kneeR";
const DRIVER_KEYS: DriverKey[] = ["hips", "spine", "neck", "shoulderL", "shoulderR", "elbowL", "elbowR", "hipL", "hipR", "kneeL", "kneeR"];
/** driver box lengths along the bone (for scaling the hitboxes to the real limb) */
const DRIVER_LEN: Partial<Record<DriverKey, number>> = { spine: 0.56, shoulderL: 0.29, shoulderR: 0.29, elbowL: 0.28, elbowR: 0.28, hipL: 0.43, hipR: 0.43, kneeL: 0.43, kneeR: 0.43 };

const RELOAD_RATE = 1.25;
export const RELOAD_TIME = 3.667 / RELOAD_RATE;
/** reload foley on the clip's own frames (normalised): mag out, new mag seated, bolt */
export const RELOAD_EVENTS = { magOut: 0.15, magIn: 0.63, bolt: 0.77 };


/**
 * One soldier's skinned body.
 *
 * Alive: a blend of the motion-captured clips (locomotion blend space by speed
 * and direction, low-ready ↔ shooting stance, reload / low-ready upper-body
 * layers), then procedural layers on top — crouch with planted feet, the
 * spine turning the rifle onto the target, hit flinches and recoil, the left
 * hand IK'd onto the handguard (or over the eyes when flashbanged). The rifle
 * rides the right hand. The invisible hitboxes follow the bones.
 *
 * Dead: the body cross-fades onto the procedural "driver" fall (knees buckle,
 * topple away from the shot, limp arms) via two-bone IK as before.
 */
export class SoldierSkin {
  readonly root: TransformNode;
  readonly meshes: AbstractMesh[] = [];
  readonly gun: InstancedMesh;
  private pose: PoseRig;
  private b: Record<string, TransformNode> = {};
  private hipH: number;
  private ankleH: number;
  private loc = {} as Record<string, { a: Vector3; b: Vector3 }>;
  private spine: TransformNode[] = [];

  // animation
  private anim: AnimSet;
  private rk: number[] = [];
  private hipsK: number;
  private upperMask: Float32Array;
  private base: PoseBuffer;
  private layer: PoseBuffer;
  /** clip selection / blending (rig-independent) */
  readonly ctrl: EnemyAnimationController;
  private mode: "anim" | "driver" | "ragdoll" = "anim";
  readonly ragdoll: EnemyRagdoll;
  private driverOrig = new Map<TransformNode, { parent: Node | null; pos: Vector3 }>();
  /** gun-in-hand calibration (G axes expressed in the hand-derived frame) */
  private calF = new Vector3(0, 0, 1);
  private calU = new Vector3(0, 1, 0);

  constructor(owner: SoldierSkins, c: AssetContainer, map: RigMap, private p: SoldierParts, idx: number, anim: AnimSet) {
    const e = c.instantiateModelsToScene((n) => `${n}#${idx}`, false, { doNotInstantiate: true });
    const root = (this.root = e.rootNodes[0] as TransformNode);
    root.setEnabled(true);
    const all = root.getDescendants(false) as Node[];
    const get = (base: string) => {
      const n = findIn(all, base);
      if (!n) throw new Error(`soldier rig: missing bone ${base}`);
      if (!n.rotationQuaternion) n.rotationQuaternion = Quaternion.FromEulerVector(n.rotation);
      return n;
    };

    // props → chest, own rifle removed
    const chestBone = get(map.spine[map.spine.length - 1]);
    if (map.hide) for (const h of map.hide) findIn(all, h)?.setEnabled(false);
    if (map.toChest) {
      for (const n of all) {
        if (!(n instanceof TransformNode) || n instanceof AbstractMesh) continue;
        if (n.parent && (n.parent as Node).name.startsWith("Gun_99")) continue;
        if (map.toChest.some((f) => n.name.startsWith(f)) && !n.name.startsWith("Gun_99")) {
          forceWorld(n);
          n.setParent(chestBone);
        }
      }
    }

    // ---- bind-pose measurements (model at the origin, facing +Z)
    const up = Vector3.Up();
    const fwd = Vector3.Forward();
    const B = (key: string, base: string) => (this.b[key] = get(base));
    B("hips", map.hips);
    this.spine = map.spine.map((s, i) => B("spine" + i, s));
    B("neck", map.neck);
    B("head", map.head);
    for (const side of ["L", "R"] as const) {
      const a = map[side];
      B(side + "up", a.up);
      B(side + "fore", a.fore);
      B(side + "hand", a.hand);
      const hp = worldPos(this.b[side + "hand"]);
      const mid = worldPos(get(a.mid)).subtract(hp);
      let across = worldPos(get(a.index)).subtract(worldPos(get(a.pinky)));
      // (a rig whose index and pinky knuckles share a spot — the Polish soldier's — gives no "across":
      // the hand's twist was undefined and the rifle's roll, and with it the aim, jumped from frame to
      // frame. Facing +Z in the bind pose, the index knuckle is ahead of the pinky on either hand.)
      if (across.length() < 0.004) {
        const m = mid.clone().normalize();
        across = Vector3.Forward().subtract(m.scale(Vector3.Dot(Vector3.Forward(), m)));
        if (across.length() < 1e-3) across = Vector3.Up().subtract(m.scale(Vector3.Dot(Vector3.Up(), m)));
      }
      this.loc[side + "hand"] = { a: toLocalDir(this.b[side + "hand"], mid), b: toLocalDir(this.b[side + "hand"], across) };
      const l = map[(side + "L") as "LL" | "RL"];
      B(side + "thigh", l.thigh);
      B(side + "calf", l.calf);
      B(side + "foot", l.foot);
      const fp = worldPos(this.b[side + "foot"]);
      const toe = worldPos(get(l.toe)).subtract(fp);
      toe.y = 0;
      this.loc[side + "foot"] = { a: toLocalDir(this.b[side + "foot"], toe.normalize()), b: toLocalDir(this.b[side + "foot"], up) };
    }
    for (const k of ["hips", "neck", "head", ...this.spine.map((_, i) => "spine" + i)]) this.loc[k] = { a: toLocalDir(this.b[k], up), b: toLocalDir(this.b[k], fwd) };
    if (map.curl) for (const side of ["L", "R"] as const) curlFingers(this.b[side + "hand"], worldPos(get(map[side].mid)), map.curl);
    this.hipH = worldPos(this.b.hips).y;
    this.ankleH = (worldPos(this.b.Lfoot).y + worldPos(this.b.Rfoot).y) / 2;

    // ---- animation binding: every animated bone joins the pose rig
    this.anim = anim;
    const animNodes = anim.bones.map((n) => get(n));
    this.pose = new PoseRig(this.b.hips.parent as TransformNode, [...animNodes, this.b.head, this.b.Lhand, this.b.Rhand, this.b.Lfoot, this.b.Rfoot]);
    this.rk = animNodes.map((n) => this.pose.indexOf(n));
    this.hipsK = this.pose.indexOf(this.b.hips);
    const spine0 = this.spine[0];
    this.upperMask = new Float32Array(animNodes.map((n) => (n === spine0 || n.isDescendantOf(spine0) ? 1 : 0)));
    this.base = new PoseBuffer(animNodes.length);
    this.layer = new PoseBuffer(animNodes.length);
    const clav = this.b.Lup.parent as TransformNode;
    const leftArm = new Float32Array(animNodes.map((n) => (n === clav || n.isDescendantOf(clav) ? 1 : 0)));
    this.ctrl = new EnemyAnimationController(anim.clips, this.upperMask, leftArm);

    // ---- one draw call per material
    const skel = e.skeletons[0];
    const byMat = new Map<number, Mesh[]>();
    for (const m of root.getChildMeshes(false) as Mesh[]) {
      if (!m.getTotalVertices() || !m.isEnabled(true) || !m.material) continue;
      if (!m.skeleton) continue; // static props keep their own transforms
      const k = m.material.uniqueId;
      if (!byMat.has(k)) byMat.set(k, []);
      byMat.get(k)!.push(m);
    }
    for (const list of byMat.values()) {
      if (list.length === 1) {
        this.meshes.push(list[0]);
        continue;
      }
      const par = list[0].parent;
      const mat = list[0].material;
      for (const m of list) m.parent = null;
      commonAttributes(list);
      const merged = Mesh.MergeMeshes(list, true, true, undefined, false, false)!;
      merged.parent = par;
      merged.skeleton = skel;
      merged.numBoneInfluencers = 4;
      merged.material = mat;
      merged.name = `soldier_${mat?.name}#${idx}`;
      this.meshes.push(merged);
    }
    // the static props (magazines, pouches, patches): those that share a material and ride on the same
    // bone are rigid together — merged into one mesh under that bone (4 magazines → 1 draw)
    {
      const boneNodes = new Set(skel.bones.map((b) => b.getTransformNode()).filter((n) => !!n));
      // (a prop the file left on no bone at all — the Polish soldier's spare magazines — would ride the
      // soldier's root, not his body: off his chest as he moves, hanging in the air when he falls. It
      // goes onto the body bone nearest it, where it is.)
      {
        const body = [this.b.hips, ...this.spine, this.b.Lthigh, this.b.Rthigh];
        // (meshes and instances alike: the file draws its two spare magazines as instances of one)
        const loose = root.getChildMeshes(false).filter((m) => !m.skeleton && m.getTotalVertices() > 0 && m.isEnabled(true));
        for (const m of loose) {
          let onBone = false;
          for (let q = m.parent; q && !onBone; q = q.parent) onBone = boneNodes.has(q as TransformNode);
          if (onBone) continue;
          m.computeWorldMatrix(true);
          m.refreshBoundingInfo({});
          const c = m.getBoundingInfo().boundingBox.centerWorld;
          const near = body.reduce((a, b) => (Vector3.DistanceSquared(worldPos(a), c) < Vector3.DistanceSquared(worldPos(b), c) ? a : b));
          m.setParent(near);
        }
      }
      const statics = root.getChildMeshes(false).filter((m): m is Mesh => m instanceof Mesh && !m.skeleton && m.getTotalVertices() > 0 && !this.meshes.includes(m) && m.isEnabled(true));
      // (the nearest bone above a prop: everything between it and the prop is fixed)
      const boneOf = (m: Mesh) => {
        for (let p = m.parent; p; p = p.parent) if (boneNodes.has(p as TransformNode)) return p as TransformNode;
        return null;
      };
      const groups = new Map<string, Mesh[]>();
      for (const m of statics) {
        const b = boneOf(m);
        if (!b || !m.material) continue;
        const key = m.material.uniqueId + "|" + b.uniqueId;
        if (!groups.has(key)) groups.set(key, []);
        groups.get(key)!.push(m);
      }
      for (const list of groups.values()) {
        if (list.length < 2) continue;
        const bone = boneOf(list[0])!;
        const mat = list[0].material;
        bone.computeWorldMatrix(true);
        const inv = bone.getWorldMatrix().clone().invert();
        const parts: Mesh[] = [];
        for (const m of list) {
          m.computeWorldMatrix(true);
          const local = m.getWorldMatrix().multiply(inv);
          const c = m.clone(m.name + "_m", null, true)!;
          c.makeGeometryUnique();
          c.setParent(null);
          c.position.setAll(0);
          c.rotationQuaternion = null;
          c.rotation.setAll(0);
          c.scaling.setAll(1);
          c.bakeTransformIntoVertices(local);
          parts.push(c);
          m.setEnabled(false);
        }
        commonAttributes(parts);
        const merged = Mesh.MergeMeshes(parts, true, true, undefined, false, false);
        if (!merged) continue;
        merged.parent = bone;
        merged.position.setAll(0);
        merged.rotationQuaternion = null;
        merged.rotation.setAll(0);
        merged.scaling.setAll(1);
        merged.material = mat;
        merged.name = `soldier_${mat?.name}_props#${idx}`;
        this.meshes.push(merged);
      }
    }
    for (const m of root.getChildMeshes(false)) if (m.getTotalVertices() && !this.meshes.includes(m) && m.isEnabled(true)) this.meshes.push(m);
    for (const m of this.meshes) {
      m.isPickable = false;
      m.alwaysSelectAsActiveMesh = true; // skinned bounds would cull wrongly
      m.receiveShadows = true;
    }

    // ---- calibrate the rifle in the right hand: in the shooting stance it must point straight ahead, level
    this.sampleInto(this.base, "aim", 0);
    this.pose.begin();
    this.writeBase();
    const [F, U] = this.handGunAxes(this.tv[0], this.tv[1], true);
    // express the wanted world axes (+Z, +Y) in the uncalibrated gun frame
    const R = Vector3.Cross(U, F);
    this.calF.set(R.z, U.z, F.z); // coords of world +Z
    this.calU.set(R.y, U.y, F.y); // coords of world +Y
    this.calF.normalize();
    this.calU.normalize();
    this.offF.copyFrom(this.calF);
    this.offU.copyFrom(this.calU);

    // ---- rifle instance on the driver's gun node; the driver muzzle moves to the real muzzle
    this.gun = owner.gun.createInstance(`enemyRifle#${idx}`);
    this.gun.isPickable = false;
    this.gun.parent = p.gun;
    this.gun.position.copyFrom(G.mount);
    this.muzzleLocal.copyFrom(owner.muzzleG);
    p.muzzle.position.copyFrom(owner.muzzleG).addInPlace(G.mount);

    root.parent = p.root;
    root.position.setAll(0);
    // keep the glTF loader's handedness flip on __root__ (180° about Y + mirrored Z): the model faces +Z
    for (const m of p.all) m.isVisible = false; // the old blocky body stays only as hitboxes
    for (const k of DRIVER_KEYS) this.driverOrig.set(p[k], { parent: p[k].parent, pos: p[k].position.clone() });
    this.ragdoll = new EnemyRagdoll(root.getScene(), {
      pose: this.pose,
      b: this.b,
      spineCount: this.spine.length,
      hipsUp: this.loc.hips.a,
      hipsFwd: this.loc.hips.b,
      headUp: this.loc.head.a,
    });
    this.enterAnim();
  }

  // ======================================================================= mode switching
  /** alive: hitboxes ride the bones, rifle rides the right hand */
  enterAnim() {
    this.ragdoll.dispose();
    this.mode = "anim";
    for (const k of DRIVER_KEYS) {
      const n = this.p[k];
      n.parent = this.p.root;
      if (!n.rotationQuaternion) n.rotationQuaternion = new Quaternion();
    }
  }
  /** dying: hand the body to the procedural fall, cross-fading from the current pose */
  enterDriver() {
    if (this.mode === "driver") return;
    this.mode = "driver";
    this.pose.snapshot();
    for (const k of DRIVER_KEYS) {
      const n = this.p[k];
      const o = this.driverOrig.get(n)!;
      n.parent = o.parent;
      n.position.copyFrom(o.pos);
      n.rotationQuaternion = null;
      n.rotation.setAll(0);
      n.scaling.setAll(1);
    }
  }
  get animating() {
    return this.mode === "anim";
  }
  get ragdolling() {
    return this.mode === "ragdoll";
  }

  /**
   * Death: physics takes the body from the current pose. `vel` = the soldier's
   * motion, `hit` = the killing impulse, `vels` = per-limb velocities.
   */
  startRagdoll(slot: number, vel: Vector3, hit: RagdollImpulse | null, vels?: Map<string, Vector3>) {
    if (this.mode === "ragdoll") return;
    this.mode = "ragdoll";
    // (the gun in his hands falls with him — the pistol if it's out; the rifle, hidden meanwhile, stays put)
    const side = this.sidearm?.isEnabled() ? this.sidearm : null;
    const gun: RagdollGun = side ? { node: side, box: new Vector3(0.035, 0.14, 0.2), mass: 0.9 } : { node: this.p.gun, mesh: this.gun as unknown as Mesh };
    this.ragdoll.activate(slot, vel, hit, gun, vels);
  }
  /** returns false once the body has come to rest (pose frozen, physics released) */
  updateRagdoll(dt: number) {
    return this.mode === "ragdoll" && this.ragdoll.update(dt);
  }

  private centers = new Map<string, Vector3>();
  /** approximate ragdoll part centres of the current pose (for limb velocities at hand-off) */
  partCenters(out = this.centers) {
    const P = this.pose;
    const b = this.b;
    const mid = (k: string, a: TransformNode, c: TransformNode) => {
      const v = out.get(k) ?? new Vector3();
      P.worldPos(a, v);
      v.addInPlace(P.worldPos(c, this.tv[7])).scaleInPlace(0.5);
      out.set(k, v);
    };
    mid("pelvis", b.Lthigh, b.Rthigh);
    mid("torso", b.spine0, b.neck);
    mid("head", b.neck, b.head);
    for (const s of ["L", "R"]) {
      mid("uArm" + s, b[s + "up"], b[s + "fore"]);
      mid("fArm" + s, b[s + "fore"], b[s + "hand"]);
      mid("thigh" + s, b[s + "thigh"], b[s + "calf"]);
      mid("calf" + s, b[s + "calf"], b[s + "foot"]);
    }
    return out;
  }

  // ======================================================================= sampling
  private clip(k: ClipKey) {
    return this.anim.clips[k];
  }
  private sampleInto(buf: PoseBuffer, k: ClipKey, t: number, loop = true) {
    buf.clear();
    buf.add(this.clip(k), t, 1, loop);
    buf.normalize();
  }
  private writeBase() {
    const q = this.base.q;
    const P = this.pose;
    for (let i = 0; i < this.rk.length; i++) {
      const k = this.rk[i];
      if (k < 0) continue;
      const o = i * 4;
      P.setLocalRot(k, q[o], q[o + 1], q[o + 2], q[o + 3]);
    }
    const h = this.base.hips;
    if (this.base.w > 0) P.setLocalPos(this.hipsK, h[0], h[1], h[2]);
  }

  private tv = [new Vector3(), new Vector3(), new Vector3(), new Vector3(), new Vector3(), new Vector3(), new Vector3(), new Vector3(), new Vector3()];
  private gv = [new Vector3(), new Vector3(), new Vector3(), new Vector3()];

  /**
   * Rifle axes from the right hand: the FSB operator's authored grip (wrist →
   * knuckles, pinky → index measured in the rifle frame) mapped onto the
   * animated hand, then the stance calibration. Returns [forward, up].
   */
  private handGunAxes(outF: Vector3, outU: Vector3, raw = false, calibrated = false): [Vector3, Vector3] {
    const P = this.pose;
    const [A, Bv, Cv, t] = this.gv;
    P.worldAxis(this.b.Rhand, this.loc.Rhand.a, A);
    P.worldAxis(this.b.Rhand, this.loc.Rhand.b, Bv);
    // orthonormal world basis from the hand
    Bv.subtractInPlace(t.copyFrom(A).scaleInPlace(Vector3.Dot(Bv, A))).normalize();
    Vector3.CrossToRef(A, Bv, Cv);
    // same basis in G
    const g = G_HAND;
    // v (in G) → world: coefficients on (g.x, g.y, g.z) applied to (A, Bv, Cv)
    const toWorld = (v: Vector3, out: Vector3) => {
      const cx = Vector3.Dot(v, g.x), cy = Vector3.Dot(v, g.y), cz = Vector3.Dot(v, g.z);
      return out.set(A.x * cx + Bv.x * cy + Cv.x * cz, A.y * cx + Bv.y * cy + Cv.y * cz, A.z * cx + Bv.z * cy + Cv.z * cz);
    };
    if (raw) {
      toWorld(Vector3.Forward(), outF);
      toWorld(Vector3.Up(), outU);
    } else {
      // calibrated axes are given in raw-gun coordinates (R,U,F) → first to G, then to world
      const f = this.tv[6].set(0, 0, 0);
      const u = this.tv[7].set(0, 0, 0);
      // raw gun axes in G are the identity, so calibrated vectors are already G coordinates
      f.copyFrom(calibrated ? this.calF : this.offF);
      u.copyFrom(calibrated ? this.calU : this.offU);
      toWorld(f, outF);
      toWorld(u, outU);
    }
    outF.normalize();
    outU.subtractInPlace(t.copyFrom(outF).scaleInPlace(Vector3.Dot(outU, outF))).normalize();
    return [outF, outU];
  }
  /** world direction → G coordinates relative to the current hand basis (inverse of handGunAxes' mapping) */
  private toHand(W: Vector3, out: Vector3) {
    const [A, Bv, Cv] = this.gv; // valid right after handGunAxes()
    const cx = Vector3.Dot(W, A), cy = Vector3.Dot(W, Bv), cz = Vector3.Dot(W, Cv);
    const g = G_HAND;
    return out.set(g.x.x * cx + g.y.x * cy + g.z.x * cz, g.x.y * cx + g.y.y * cy + g.z.y * cz, g.x.z * cx + g.y.z * cy + g.z.z * cz);
  }
  /** rifle orientation held relative to the right hand (tracks the two-hand hold while both hands are on it) */
  private offF = new Vector3(0, 0, 1);
  private offU = new Vector3(0, 1, 0);

  // ======================================================================= alive
  private gunF = new Vector3();
  private gunU = new Vector3();
  private gunR = new Vector3();
  private gunO = new Vector3();
  private gq = new Quaternion();
  private gm = new Matrix();

  private hF = new Vector3();
  private hU = new Vector3();
  /**
   * Rifle frame G in world. With both hands on it, the rifle lies along the
   * line from the right (grip) hand to the left (handguard) hand of the clip —
   * exactly where the animator's rifle was — rolled by the right hand. When the
   * left hand lets go (reload, flashbang) the last grip offset is held in the
   * right hand. `leftFree` 0..1 blends between the two.
   */
  private placeGun(leftFree = 0) {
    const P = this.pose;
    // (both hands on it: the hand's own calibrated grip gives the roll — never last frame's remembered
    // grip, which fed back into itself frame after frame and set the rifle and the chest shaking.
    // The remembered grip is only for when the left hand lets go.)
    this.handGunAxes(this.hF, this.hU, false, leftFree <= 0.001);
    const F = this.gunF, U = this.gunU;
    if (leftFree < 0.999) {
      const [d, w2, w3, e2] = [this.tv[6], this.tv[7], this.gunR, this.gunO];
      P.worldPos(this.b.Lhand, d);
      d.subtractInPlace(P.worldPos(this.b.Rhand, w2)).normalize();
      // world basis: d, hand-up ⊥ d
      w2.copyFrom(this.hU).subtractInPlace(w3.copyFrom(d).scaleInPlace(Vector3.Dot(this.hU, d))).normalize();
      Vector3.CrossToRef(d, w2, w3);
      // G basis: grip→handguard line, +Y ⊥ it
      const g = G_LINE;
      const map = (v: Vector3, out: Vector3) => {
        const a = Vector3.Dot(v, g.x), b = Vector3.Dot(v, g.y), c = Vector3.Dot(v, g.z);
        return out.set(d.x * a + w2.x * b + w3.x * c, d.y * a + w2.y * b + w3.y * c, d.z * a + w2.z * b + w3.z * c);
      };
      map(Vector3.Forward(), F);
      map(Vector3.Up(), e2);
      U.copyFrom(e2);
      if (leftFree > 0.001) {
        Vector3.LerpToRef(F, this.hF, leftFree, F);
        Vector3.LerpToRef(U, this.hU, leftFree, U);
      } else {
        // remember this grip so the rifle stays put when the left hand leaves
        this.toHand(F, this.offF);
        this.toHand(U, this.offU);
      }
    } else {
      F.copyFrom(this.hF);
      U.copyFrom(this.hU);
    }
    F.normalize();
    U.subtractInPlace(this.tv[6].copyFrom(F).scaleInPlace(Vector3.Dot(U, F))).normalize();
    Vector3.CrossToRef(this.gunU, this.gunF, this.gunR);
    const w = this.pose.worldPos(this.b.Rhand, this.tv[5]);
    const r = G.rWrist;
    this.gunO.copyFrom(w);
    this.gunO.x -= this.gunR.x * r.x + this.gunU.x * r.y + this.gunF.x * r.z;
    this.gunO.y -= this.gunR.y * r.x + this.gunU.y * r.y + this.gunF.y * r.z;
    this.gunO.z -= this.gunR.z * r.x + this.gunU.z * r.y + this.gunF.z * r.z;
  }
  /** G-space point → world */
  private gPoint(v: Vector3, out: Vector3) {
    return out.set(
      this.gunO.x + this.gunR.x * v.x + this.gunU.x * v.y + this.gunF.x * v.z,
      this.gunO.y + this.gunR.y * v.x + this.gunU.y * v.y + this.gunF.y * v.z,
      this.gunO.z + this.gunR.z * v.x + this.gunU.z * v.y + this.gunF.z * v.z,
    );
  }
  private gDir(v: Vector3, out: Vector3) {
    return out.set(
      this.gunR.x * v.x + this.gunU.x * v.y + this.gunF.x * v.z,
      this.gunR.y * v.x + this.gunU.y * v.y + this.gunF.y * v.z,
      this.gunR.z * v.x + this.gunU.z * v.y + this.gunF.z * v.z,
    ).normalize();
  }

  /** Sample, blend and post-process the living body. */
  animate(inp: AnimInput): AnimOutput | null {
    if (this.mode !== "anim") return null;
    const out = this.ctrl.evaluate(inp, this.base, this.layer);
    const leftFree = out.leftFree;
    const leftFree0 = Math.max(leftFree, inp.blind);
    const P = this.pose;
    P.begin();
    this.writeBase();
    const [t0, t1, t2, t3, t4, t5] = this.tv;
    const UP = Vector3.UpReadOnly;
    const aimW = inp.aimW * out.aimScale;

    // ---------- lean (peek round cover): roll the spine about the body's forward axis, before the aim
    // solve so the muzzle still lands on target
    const n = this.spine.length;
    const lean = inp.lean ?? 0;
    if (Math.abs(lean) > 0.01) {
      P.worldAxis(this.b.hips, this.loc.hips.b, t1);
      t1.y = 0;
      t1.normalize();
      for (let i = 0; i < n; i++) P.rotateWorld(this.spine[i], t1, (LEAN_ROLL * lean) / n);
      P.rotateWorld(this.b.neck, t1, -LEAN_ROLL * 0.35 * lean);
    }

    // ---------- aim: turn the spine so the muzzle tracks the target
    if (inp.aimAt && aimW > 0.01) {
      for (let it = 0; it < 2; it++) {
        this.placeGun(leftFree0);
        const mz = this.gPoint(this.muzzleLocal, t0);
        t1.copyFrom(inp.aimAt).subtractInPlace(mz).normalize();
        const f = this.gunF;
        // yaw (about world up)
        const yawCur = Math.atan2(f.x, f.z);
        const yawWant = Math.atan2(t1.x, t1.z);
        let dy = yawWant - yawCur;
        dy = Math.atan2(Math.sin(dy), Math.cos(dy));
        dy = Math.max(-1.2, Math.min(1.2, dy)) * aimW;
        // pitch (about the horizontal axis across the aim)
        const pc = Math.asin(Math.max(-1, Math.min(1, f.y)));
        const pw = Math.asin(Math.max(-1, Math.min(1, t1.y)));
        const dp = Math.max(-1.0, Math.min(1.0, pw - pc)) * aimW;
        t2.set(t1.z, 0, -t1.x).normalize(); // right of the aim direction (LH: right = up × fwd)
        for (let i = 0; i < n; i++) {
          const k = SPINE_SHARE[i] ?? 1 / n;
          P.rotateWorld(this.spine[i], UP, dy * k);
          P.rotateWorld(this.spine[i], t2, -dp * k);
        }
      }
    }

    // ---------- reactions: flinch from hits, recoil kick
    if (Math.abs(inp.hitPitch) + Math.abs(inp.hitYaw) + Math.abs(inp.recoil) > 1e-4) {
      P.worldAxis(this.b.hips, this.loc.hips.b, t1);
      t1.y = 0;
      t1.normalize();
      Vector3.CrossToRef(UP, t1, t2).normalize(); // body right
      const top = this.spine[n - 1];
      P.rotateWorld(top, t2, inp.hitPitch + inp.recoil);
      P.rotateWorld(this.spine[Math.max(0, n - 2)], UP, inp.hitYaw);
      P.rotateWorld(this.b.neck, t2, inp.hitPitch * 0.6);
    }

    // ---------- head: bow away when blinded
    if (inp.blind > 0.01) {
      P.worldAxis(this.b.hips, this.loc.hips.b, t1);
      Vector3.CrossToRef(UP, t1, t2).normalize();
      P.rotateWorld(this.b.neck, t2, 0.45 * inp.blind);
      P.rotateWorld(this.b.head, UP, 0.45 * inp.blind);
    }

    // ---------- head: look where the rifle looks (or where the body faces) — blended clips and the spine
    // turn can leave the head pointing off to one side, which reads as "wrong" instantly
    const look = 1 - inp.blind;
    if (look > 0.05 && this.ctrl.busy === false) {
      const hd = P.worldPos(this.b.head, t0);
      // (the way he faces, turned toward the target as far as he's aiming at it — a switch between the
      // two at an aim weight of 0.05 snapped the neck round in a frame)
      Vector3.TransformNormalToRef(SoldierSkin.FWD, this.p.root.getWorldMatrix(), t1);
      t1.y = -0.12;
      t1.normalize();
      if (inp.aimAt && aimW > 0) {
        const at = this.tv[8].copyFrom(inp.aimAt).subtractInPlace(hd).normalize();
        Vector3.LerpToRef(t1, at, Math.min(1, aimW * 4), at);
        if (at.lengthSquared() > 1e-4) t1.copyFrom(at).normalize();
      }
      const hf = P.worldAxis(this.b.head, this.loc.head.b, t2);
      let dy = Math.atan2(t1.x, t1.z) - Math.atan2(hf.x, hf.z);
      dy = Math.atan2(Math.sin(dy), Math.cos(dy));
      dy = Math.max(-0.9, Math.min(0.9, dy)) * look;
      const dp = Math.max(-0.6, Math.min(0.6, Math.asin(Math.max(-1, Math.min(1, t1.y))) - Math.asin(Math.max(-1, Math.min(1, hf.y))))) * look;
      t3.set(t1.z, 0, -t1.x).normalize(); // right of the look direction
      P.rotateWorld(this.b.neck, UP, dy * 0.4);
      P.rotateWorld(this.b.neck, t3, -dp * 0.4);
      P.rotateWorld(this.b.head, UP, dy * 0.6);
      P.rotateWorld(this.b.head, t3, -dp * 0.6);
    }

    // ---------- rifle in the right hand, left hand onto the handguard (or the sidearm, two-handed)
    this.placeGun(leftFree0);
    const L = this.b;
    const pw = this.sidearm ? Math.max(0, Math.min(1, inp.pistol ?? 0)) : 0;
    const wl = (1 - leftFree) * (1 - inp.blind) * (1 - pw);
    if (pw > 0.01) this.pistolArms(inp, pw);
    if (this.sidearm) this.sidearm.setEnabled(pw > 0.5 && this.p.root.isEnabled());
    this.p.gun.setEnabled(pw <= 0.5);
    if (wl > 0.01) {
      this.gPoint(G.lWrist, t0);
      this.gPoint(G.lPole, t1);
      if (wl < 0.999) {
        P.worldPos(L.Lhand, t2);
        Vector3.LerpToRef(t2, t0, wl, t0);
        P.worldPos(L.Lfore, t3);
        Vector3.LerpToRef(t3, t1, wl, t1);
      }
      P.twoBone(L.Lup, L.Lfore, L.Lhand, t0, t1);
      this.gDir(G.lD1, t4);
      this.gDir(G.lD2, t5);
      P.alignFrame(L.Lhand, this.loc.Lhand.a, this.loc.Lhand.b, t4, t5, wl);
    }
    if (inp.blind > 0.01) {
      // palm over the eyes, elbow out
      const hd = P.worldPos(L.head, t0);
      P.worldAxis(L.head, this.loc.head.b, t1);
      P.worldAxis(L.head, this.loc.head.a, t2);
      Vector3.CrossToRef(t2, t1, t3).normalize(); // head right
      t4.copyFrom(hd).addInPlace(t1.scale(0.16)).addInPlace(t2.scale(0.05)).addInPlace(t3.scale(-0.02));
      P.worldPos(L.Lhand, t5);
      Vector3.LerpToRef(t5, t4, inp.blind, t4);
      t5.copyFrom(hd).addInPlace(t3.scale(-0.45)).addInPlace(t2.scale(-0.25)).addInPlace(t1.scale(0.1));
      P.twoBone(L.Lup, L.Lfore, L.Lhand, t4, t5);
      P.alignFrame(L.Lhand, this.loc.Lhand.a, this.loc.Lhand.b, t2, t3, inp.blind);
    }
    P.commit();
    this.syncGun();
    this.syncHitboxes();
    return out;
  }

  // ------------------------------------------------------------------ the sidearm
  /** a pistol (the Glock pickup's model: centred, +Z its muzzle, 0.19 m long) — none: rifle only */
  sidearm: TransformNode | null = null;
  private pistolU = new Vector3(0, 1, 0);
  private pistolC = new Vector3();
  setSidearm(n: TransformNode) {
    this.sidearm = n;
    n.setEnabled(false);
    if (!n.rotationQuaternion) n.rotationQuaternion = new Quaternion();
    for (const m of n.getChildMeshes(false)) m.isPickable = false;
  }
  /** where a pistol round leaves it (world) */
  pistolMuzzle(out: Vector3) {
    const n = this.sidearm!;
    n.computeWorldMatrix(true);
    return Vector3.TransformCoordinatesFromFloatsToRef(0, 0.03, 0.1, n.getWorldMatrix(), out);
  }
  /**
   * Both arms up into a pistol stance — the gun out in front of the chest at the target, the right
   * hand round the grip, the left cupped under it — blended in by `w` over whatever the rifle clip
   * had the arms doing. The pistol is placed in the right hand's palm.
   */
  private pistolArms(inp: AnimInput, w: number) {
    const P = this.pose, L = this.b;
    const [a, b, c, d, e, f, gp, h] = this.pv;
    const UP = Vector3.UpReadOnly;
    const sR = P.worldPos(L.Rup, a), sL = P.worldPos(L.Lup, b);
    const chest = c.copyFrom(sR).addInPlace(sL).scaleInPlace(0.5);
    // the aim: at the target (or straight ahead, a touch down)
    const A = d;
    if (inp.aimAt) A.copyFrom(inp.aimAt).subtractInPlace(chest).normalize();
    else {
      Vector3.TransformNormalToRef(SoldierSkin.FWD, this.p.root.getWorldMatrix(), A);
      A.y = -0.1;
      A.normalize();
    }
    const R = e.set(A.z, 0, -A.x).normalize(); // LH: right = up × forward
    // the hands: right round the grip ~0.5 m out, left cupped under and inside it
    const tR = f.copyFrom(chest).addInPlace(A.scale(0.5)).addInPlace(R.scale(0.03)).addInPlaceFromFloats(0, -0.07, 0);
    const tL = gp.copyFrom(tR).addInPlace(R.scale(-0.05)).addInPlace(A.scale(-0.025)).addInPlaceFromFloats(0, -0.035, 0);
    if (w < 0.999) {
      Vector3.LerpToRef(P.worldPos(L.Rhand, h), tR, w, tR);
      Vector3.LerpToRef(P.worldPos(L.Lhand, h), tL, w, tL);
    }
    // the elbows out and down
    const poleR = sR.add(R.scale(0.35)).addInPlace(A.scale(-0.05)).addInPlaceFromFloats(0, -0.45, 0);
    const poleL = sL.add(R.scale(-0.35)).addInPlace(A.scale(-0.05)).addInPlaceFromFloats(0, -0.45, 0);
    P.twoBone(L.Rup, L.Rfore, L.Rhand, tR, poleR);
    P.twoBone(L.Lup, L.Lfore, L.Lhand, tL, poleL);
    // the hands turned onto the grip: knuckles along the barrel, index finger on top
    const U = this.pistolU.copyFrom(UP).subtractInPlace(A.scale(Vector3.Dot(UP, A))).normalize();
    P.alignFrame(L.Rhand, this.loc.Rhand.a, this.loc.Rhand.b, A, U, w);
    P.alignFrame(L.Lhand, this.loc.Lhand.a, this.loc.Lhand.b, A, U, w * 0.8);
    // the pistol in the right palm
    P.worldPos(L.Rhand, this.pistolC).addInPlace(A.scale(0.075)).addInPlace(U.scale(0.045));
    // (on the soldier's root, like the rifle: on a frame his pose isn't redone it moves with him,
    // not left hanging in the air where it was last put)
    const n = this.sidearm!;
    if (n.parent !== this.p.root) n.parent = this.p.root;
    n.position.copyFrom(this.pistolC);
    quatFromAxes(Vector3.CrossToRef(U, A, h), U, A, n.rotationQuaternion!);
    // (this frame's root — the rifle's sync, which also refreshes it, comes after)
    this.refreshRootInv();
    this.toRoot(n);
  }
  private pv = [new Vector3(), new Vector3(), new Vector3(), new Vector3(), new Vector3(), new Vector3(), new Vector3(), new Vector3()];

  /** world position of a hand (grenade in the left hand while throwing) */
  handPos(side: "L" | "R", out: Vector3) {
    return this.pose.worldPos(this.b[side + "hand"], out);
  }

  /** muzzle in G (set by the owner after the rifle is built) */
  muzzleLocal = new Vector3(0, 0.03, 0.3);

  private rootInv = new Matrix();
  private rootQi = new Quaternion();
  /** world → soldier-root space (gun / hitboxes ride the root so skipped LOD frames don't lag behind) */
  private toRoot(n: TransformNode) {
    n.position.copyFrom(Vector3.TransformCoordinatesToRef(n.position, this.rootInv, this.tv[5]));
    this.rootQi.multiplyToRef(n.rotationQuaternion!, n.rotationQuaternion!);
  }
  private refreshRootInv() {
    const r = this.p.root;
    r.computeWorldMatrix(true);
    r.getWorldMatrix().invertToRef(this.rootInv);
    Quaternion.FromRotationMatrixToRef(r.getWorldMatrix().getRotationMatrix(), this.rootQi);
    this.rootQi.invertInPlace();
  }

  private syncGun() {
    const g = this.p.gun;
    if (g.parent !== this.p.root) g.parent = this.p.root;
    if (!g.rotationQuaternion) g.rotationQuaternion = new Quaternion();
    this.refreshRootInv();
    quatFromAxes(this.gunR, this.gunU, this.gunF, g.rotationQuaternion);
    // G origin sits at `mount` in the gun node
    const mt = G.mount;
    g.position.set(
      this.gunO.x - (this.gunR.x * mt.x + this.gunU.x * mt.y + this.gunF.x * mt.z),
      this.gunO.y - (this.gunR.y * mt.x + this.gunU.y * mt.y + this.gunF.y * mt.z),
      this.gunO.z - (this.gunR.z * mt.x + this.gunU.z * mt.y + this.gunF.z * mt.z),
    );
    g.scaling.setAll(1);
    this.toRoot(g);
    void this.gq;
    void this.gm;
  }

  private hu = new Vector3();
  private hf = new Vector3();
  private ha = new Vector3();
  private hb = new Vector3();
  /** invisible hitboxes ride the animated bones */
  private syncHitboxes() {
    const P = this.pose;
    const p = this.p;
    const b = this.b;
    const up = this.hu;
    const fwd = this.hf;
    const pa = this.ha;
    const pb = this.hb;
    P.worldAxis(b.hips, this.loc.hips.b, fwd);
    const set = (k: DriverKey, at: TransformNode, to: TransformNode | null, down: boolean, fwdHint: Vector3, upAxis?: Vector3) => {
      const n = p[k];
      P.worldPos(at, pa);
      if (to) {
        P.worldPos(to, pb);
        up.copyFrom(pb).subtractInPlace(pa);
      } else up.copyFrom(upAxis!);
      const len = up.length();
      up.scaleInPlace(1 / Math.max(1e-5, len));
      if (down) up.scaleInPlace(-1);
      n.position.copyFrom(pa);
      // forward hint orthogonal to up
      const f = this.tv[6].copyFrom(fwdHint);
      f.subtractInPlace(this.tv[7].copyFrom(up).scaleInPlace(Vector3.Dot(f, up)));
      if (f.lengthSquared() < 1e-6) f.set(0, 0, 1);
      f.normalize();
      quatFromAxes(Vector3.CrossToRef(up, f, this.tv[5]), up, f, n.rotationQuaternion!);
      const L0 = DRIVER_LEN[k];
      n.scaling.set(1, to && L0 ? len / L0 : 1, 1);
      this.toRoot(n);
    };
    set("hips", b.hips, b.spine0, false, fwd);
    set("spine", b.spine0, b.neck, false, P.worldAxis(b["spine" + (this.spine.length - 1)], this.loc["spine" + (this.spine.length - 1)].b, this.tv[2]));
    set("neck", b.head, null, false, P.worldAxis(b.head, this.loc.head.b, this.tv[3]), P.worldAxis(b.head, this.loc.head.a, this.tv[4]));
    set("shoulderL", b.Lup, b.Lfore, true, fwd);
    set("shoulderR", b.Rup, b.Rfore, true, fwd);
    set("elbowL", b.Lfore, b.Lhand, true, fwd);
    set("elbowR", b.Rfore, b.Rhand, true, fwd);
    set("hipL", b.Lthigh, b.Lcalf, true, fwd);
    set("hipR", b.Rthigh, b.Rcalf, true, fwd);
    set("kneeL", b.Lcalf, b.Lfoot, true, fwd);
    set("kneeR", b.Rcalf, b.Rfoot, true, fwd);
  }

  // ======================================================================= dead: follow the driver
  private driverOrder: TransformNode[] | null = null;
  private refreshDriver() {
    const p = this.p;
    if (!this.driverOrder) this.driverOrder = [p.root, p.hips, p.spine, p.neck, p.shoulderL, p.shoulderR, p.elbowL, p.elbowR, p.hipL, p.hipR, p.kneeL, p.kneeR, p.gunMount, p.gun];
    for (const n of this.driverOrder) n.computeWorldMatrix(true);
  }
  private axis(n: TransformNode, local: Vector3, out: Vector3) {
    Vector3.TransformNormalToRef(local, n.getWorldMatrix(), out);
    return out.normalize();
  }
  private point(n: TransformNode, local: Vector3, out: Vector3) {
    return Vector3.TransformCoordinatesToRef(local, n.getWorldMatrix(), out);
  }
  private up6 = [new Vector3(), new Vector3(), new Vector3(), new Vector3(), new Vector3(), new Vector3()];

  /**
   * Pose onto the procedural driver skeleton (death fall): hips / spine / head
   * take the driver's orientation, legs two-bone IK onto its feet, arms limp.
   * `fromSnapshot` 1 → still the last animated pose, 0 → fully the fall.
   */
  follow(fromSnapshot: number) {
    if (this.mode !== "driver") return;
    const p = this.p;
    const b = this.b;
    const P = this.pose;
    const [t0, t1, t2, t3, t4, t5] = this.tv;
    const [hipsUp, hipsFwd, chestUp, chestFwd, headUp, headFwd] = this.up6;
    this.refreshDriver();
    P.begin();
    const UP = Vector3.UpReadOnly;
    const FWD = SoldierSkin.FWD;

    this.point(p.hips, t0.set(0, this.hipH - 0.94, 0), t1);
    P.setWorldPos(b.hips, t1);
    this.axis(p.hips, UP, hipsUp);
    this.axis(p.hips, FWD, hipsFwd);
    P.alignFrame(b.hips, this.loc.hips.a, this.loc.hips.b, hipsUp, hipsFwd);
    this.axis(p.spine, UP, chestUp);
    this.axis(p.spine, FWD, chestFwd);
    const n = this.spine.length;
    for (let i = 0; i < n; i++) {
      const k = (i + 1) / n;
      Vector3.LerpToRef(hipsUp, chestUp, k, t4).normalize();
      Vector3.LerpToRef(hipsFwd, chestFwd, k, t5).normalize();
      P.alignFrame(this.spine[i], this.loc["spine" + i].a, this.loc["spine" + i].b, t4, t5);
    }
    this.axis(p.neck, UP, headUp);
    this.axis(p.neck, FWD, headFwd);
    Vector3.LerpToRef(chestUp, headUp, 0.5, t4).normalize();
    Vector3.LerpToRef(chestFwd, headFwd, 0.5, t5).normalize();
    P.alignFrame(b.neck, this.loc.neck.a, this.loc.neck.b, t4, t5);
    P.alignFrame(b.head, this.loc.head.a, this.loc.head.b, headUp, headFwd);
    for (const side of SIDES) {
      const knee = side === "L" ? p.kneeL : p.kneeR;
      this.point(knee, t0.set(0, -0.48 + this.ankleH, 0.02), t1);
      knee.getWorldMatrix().getTranslationToRef(t2);
      t2.addInPlace(t3.copyFrom(hipsFwd).scaleInPlace(0.5));
      P.twoBone(b[side + "thigh"], b[side + "calf"], b[side + "foot"], t1, t2);
      this.axis(knee, FWD, t4);
      this.axis(knee, UP, t5);
      P.alignFrame(b[side + "foot"], this.loc[side + "foot"].a, this.loc[side + "foot"].b, t4, t5);
    }
    for (const side of ARM_ORDER) {
      const el = side === "R" ? p.elbowR : p.elbowL;
      this.point(el, t0.set(0, -0.27, 0.02), t1);
      el.getWorldMatrix().getTranslationToRef(t2);
      P.twoBone(b[side + "up"], b[side + "fore"], b[side + "hand"], t1, t2);
      this.axis(el, SoldierSkin.DOWN, t4);
      this.axis(el, FWD, t5);
      P.alignFrame(b[side + "hand"], this.loc[side + "hand"].a, this.loc[side + "hand"].b, t4, t5);
    }
    P.blendSnapshot(fromSnapshot);
    P.commit();
  }

  static readonly FWD = new Vector3(0, 0, 1);
  static readonly RIGHT = new Vector3(1, 0, 0);
  static readonly DOWN = new Vector3(0, -1, 0);
}

/** total spine roll at full lean (radians); sign so +lean moves the head to the body's right */
const LEAN_ROLL = -0.8;

/** how much of the aim turn each spine bone takes (lower → upper) */
const SPINE_SHARE = [0.25, 0.35, 0.4];
const SIDES = ["L", "R"] as const;
const ARM_ORDER = ["R", "L"] as const;

const _m = new Matrix();
/** rotation whose local X/Y/Z map onto the given orthonormal world axes */
function quatFromAxes(x: Vector3, y: Vector3, z: Vector3, out: Quaternion) {
  Matrix.FromValuesToRef(x.x, x.y, x.z, 0, y.x, y.y, y.z, 0, z.x, z.y, z.z, 0, 0, 0, 0, 1, _m);
  return Quaternion.FromRotationMatrixToRef(_m, out);
}

/** G basis along the grip→handguard line (x), +Y orthogonalised (y), z = x × y */
const G_LINE = (() => {
  const x = G.lWrist.subtract(G.rWrist).normalize();
  const y = Vector3.Up().subtract(x.scale(x.y)).normalize();
  const z = Vector3.Cross(x, y);
  return { x, y, z };
})();

/** orthonormal basis of the right-hand grip in G (wrist→knuckles, pinky→index) */
const G_HAND = (() => {
  const x = G.rD1.clone().normalize();
  const y = G.rD2.subtract(x.scale(Vector3.Dot(G.rD2, x))).normalize();
  const z = Vector3.Cross(x, y);
  return { x, y, z };
})();
