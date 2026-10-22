import { VertexBuffer } from "@babylonjs/core/Buffers/buffer";
import { AbstractMesh } from "@babylonjs/core/Meshes/abstractMesh";
import { AnimationGroup } from "@babylonjs/core/Animations/animationGroup";
import { AssetContainer } from "@babylonjs/core/assetContainer";
import { LoadAssetContainerAsync } from "@babylonjs/core/Loading/sceneLoader";
import { Matrix, Quaternion, Vector3 } from "@babylonjs/core/Maths/math.vector";
import { Node } from "@babylonjs/core/node";
import { PBRMaterial } from "@babylonjs/core/Materials/PBR/pbrMaterial";
import { Scene } from "@babylonjs/core/scene";
import { TransformNode } from "@babylonjs/core/Meshes/transformNode";
import { alignDir, forceWorld, plantFeet, worldPos } from "../core/ik";
import { extFor } from "../weapons/ArmsRig";
import { PAIRS, type Dir } from "./SpiderRig";
import type { DirClip } from "./SpiderPoses";

/**
 * A hero that comes with his own skeleton (Iron Man: a Mixamo rig, fingers and all, and Mixamo's
 * flying clip). The same interface as SpiderRig, so the same poses, clips and controllers drive
 * him: every pose is bone directions in his body frame, applied parents first. The model's own
 * clips are read off its skeleton at load into that form (so his flight blends with everything else).
 */
export interface Rig {
  readonly anchor: TransformNode;
  readonly meshes: AbstractMesh[];
  readonly height: number;
  readonly hipH: number;
  at(name: string, out?: Vector3): Vector3;
  pose(dirs: Dir[], hip: Vector3): void;
  setVisible(v: boolean): void;
  /** fingers: 0 open … 1 a fist (rigs without fingers ignore it) */
  grip?(side: "l" | "r", k: number): void;
}

const strip = (n: string) => n.replace(/#.*$/, "").replace(/^mixamorig:?/, "").replace(/_\d+$/, "");

/** how a model's own bone names map onto the Mixamo names the poses use, and which extra bones ride along */
export interface RigNames {
  /** a stripped model bone name → its Mixamo name (unmapped names are kept) */
  rename?: (n: string) => string;
  /** twist/helper bones (model names) that carry skin and must move with a posed bone (Mixamo name), as if fixed to it */
  follow?: [string, string][];
  /** find them by themselves: any "twist" node beside a posed bone (same parent) rides with the nearest one */
  autoTwist?: boolean;
  /** a turn (radians about up) after he's been faced along his toes — a rig whose "toes" don't point his way */
  turn?: number;
  /** done to the loaded file first (Ant-Man's: a skeleton made for a model that has none) */
  prep?: (c: AssetContainer) => void;
}

/** 3ds Max Biped (Bip001-…) → Mixamo */
const BIP_CORE: Record<string, string> = { Pelvis: "Hips", Spine: "Spine", Spine1: "Spine1", Spine2: "Spine2", Neck: "Neck", Head: "Head", Head_end: "HeadTop_End" };
const BIP_SIDE: Record<string, string> = {
  Clavicle: "Shoulder", UpperArm: "Arm", Forearm: "ForeArm", Hand: "Hand", Thigh: "UpLeg", Calf: "Leg", Foot: "Foot", Toe0: "ToeBase", Toe0_end: "Toe_End",
  Finger0: "HandThumb1", Finger01: "HandThumb2", Finger02: "HandThumb3",
  Finger1: "HandIndex1", Finger11: "HandIndex2", Finger12: "HandIndex3",
  Finger2: "HandMiddle1", Finger21: "HandMiddle2", Finger22: "HandMiddle3",
  // (a four-fingered Biped — Wolverine's — ends at Finger3: that's the edge of his hand, the "pinky"
  // the grip and the claws need; a five-fingered one maps Finger4 over it below)
  Finger3: "HandPinky1", Finger31: "HandPinky2", Finger32: "HandPinky3",
};
/**
 * Any of the rigs the roster's models come with, read as Mixamo's: Mixamo itself ("mixamorig:…",
 * "LeftToes" for the toe), 3ds Max Biped however it was exported ("Bip001-L-Thigh", "Bip001 L Thigh",
 * "bip001 l thigh"), and Blender's Rigify deform bones ("DEF-thigh.L", "DEF-spine.003" …).
 */
const RIGIFY: Record<string, string> = {
  "DEF-spine": "Hips", "DEF-spine.001": "Spine", "DEF-spine.002": "Spine1", "DEF-spine.003": "Spine2", "DEF-spine.004": "Neck", "DEF-spine.005": "Neck1", "DEF-spine.006": "Head",
};
const RIGIFY_SIDE: Record<string, string> = {
  thigh: "UpLeg", shin: "Leg", foot: "Foot", toe: "ToeBase", shoulder: "Shoulder", upper_arm: "Arm", forearm: "ForeArm", hand: "Hand",
  "f_index.01": "HandIndex1", "f_index.02": "HandIndex2", "f_index.03": "HandIndex3", "f_middle.01": "HandMiddle1", "f_middle.02": "HandMiddle2", "f_middle.03": "HandMiddle3",
  "f_ring.01": "HandRing1", "f_ring.02": "HandRing2", "f_ring.03": "HandRing3", "f_pinky.01": "HandPinky1", "f_pinky.02": "HandPinky2", "f_pinky.03": "HandPinky3",
  "thumb.01": "HandThumb1", "thumb.02": "HandThumb2", "thumb.03": "HandThumb3",
};
export function autoRename(raw: string) {
  const n = raw.replace(/#.*$/, "").replace(/^mixamorig:?/, "").replace(/_\d+$/, "");
  if (n === "LeftToes" || n === "RightToes") return n.replace("Toes", "ToeBase");
  // Biped, any spelling: words split by space or dash, any case
  const b = /^bip0*1[\s-]+(.*)$/i.exec(n);
  if (b) {
    const parts = b[1].split(/[\s-]+/);
    const cap = (w: string) => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase();
    if (parts.length >= 2 && /^[lr]$/i.test(parts[0])) {
      const rest = parts.slice(1).map(cap).join("").replace(/^Upperarm$/, "UpperArm").replace(/^Toe0end$/, "Toe0_end");
      const k = BIP_SIDE[rest];
      if (k) return (parts[0].toLowerCase() === "l" ? "Left" : "Right") + k;
      return n;
    }
    const core = parts.map(cap).join("").replace(/^Headend$/, "Head_end");
    return BIP_CORE[core] ?? n;
  }
  // Unreal's mannequin (Venom): pelvis, spine_01…, upperarm_l, calf_r, ball_l
  // (its own numbers end in _01: tested before the node-index suffix is stripped a second time)
  const n0 = raw.replace(/#.*$/, "");
  const ue = /^(pelvis|spine_0[1-3]|neck_01|head|clavicle|upperarm|lowerarm|hand|thigh|calf|foot|ball|(?:index|middle|ring|pinky|thumb)_0([1-3]))(?:_([lr]))?$/.exec(n0);
  if (ue) {
    const core: Record<string, string> = { pelvis: "Hips", spine_01: "Spine", spine_02: "Spine1", spine_03: "Spine2", neck_01: "Neck", head: "Head" };
    if (!ue[3] && core[ue[1]]) return core[ue[1]];
    if (ue[3]) {
      const S = ue[3] === "l" ? "Left" : "Right";
      const side: Record<string, string> = { clavicle: "Shoulder", upperarm: "Arm", lowerarm: "ForeArm", hand: "Hand", thigh: "UpLeg", calf: "Leg", foot: "Foot", ball: "ToeBase" };
      if (side[ue[1]]) return S + side[ue[1]];
      if (ue[2]) {
        const f = ue[1].split("_")[0];
        return S + "Hand" + f.charAt(0).toUpperCase() + f.slice(1) + ue[2];
      }
    }
  }
  // Valve's biped (Megatron): ValveBiped.Bip01_L_UpperArm
  const vb = /^ValveBiped\.Bip01_(?:([LR])_)?(\w+)$/.exec(n);
  if (vb) {
    const k = vb[2].charAt(0).toUpperCase() + vb[2].slice(1);
    if (!vb[1]) return BIP_CORE[k] ?? n;
    return BIP_SIDE[k] ? (vb[1] === "L" ? "Left" : "Right") + BIP_SIDE[k] : n;
  }
  // the Transformers rig (Ironhide): C_Spine02_Thoracic01_XB, L_Arm03_Elbow_XB, L_Finger03_Middle01_XL
  const tf = /^([LRC])_(Spine0\d_\w+|Arm0\d_\w+|Leg0\d_\w+|Finger03_Middle01)_X[A-Z]+\d?$/.exec(n);
  if (tf) {
    const TF: Record<string, string> = {
      Spine00_Hips: "Hips", Spine01_Lumbar01: "Spine", Spine02_Thoracic01: "Spine1", Spine03_Neck01: "Neck", Spine04_Head: "Head",
      Arm01_Clav: "Shoulder", Arm02_Shoulder: "Arm", Arm03_Elbow: "ForeArm", Arm04_Hand: "Hand", Leg01_Thigh: "UpLeg", Leg02_Knee: "Leg", Leg03_Ankle: "Foot", Finger03_Middle01: "HandMiddle1",
    };
    const k = TF[tf[2]];
    if (k) return tf[1] === "C" ? k : (tf[1] === "L" ? "Left" : "Right") + k;
  }
  // Godzilla's rig: spineJA_JNT, l_armJB_JNT, l_legJA_JNT
  const gz = /^(?:([lr])_)?([a-z]+)J([A-Z]+)_JNT(?:_\d+)?$/.exec(n);
  if (gz) {
    const G: Record<string, string> = { spineJA: "Hips", spineJB: "Spine", spineJD: "Spine1", spineJF: "Spine2", neckJB: "Neck", headJA: "Head", clavicleJA: "Shoulder", armJA: "Arm", armJB: "ForeArm", handJA: "Hand", legJA: "UpLeg", legJB: "Leg", footJA: "Foot", toesJA: "ToeBase" };
    const k = G[gz[2] + "J" + gz[3]];
    if (k) return gz[1] ? (gz[1] === "l" ? "Left" : "Right") + k : k;
  }
  // Rigify's deform bones
  if (RIGIFY[n]) return RIGIFY[n];
  const r = /^DEF-(.+)\.([LR])$/.exec(n);
  if (r && RIGIFY_SIDE[r[1]]) return (r[2] === "L" ? "Left" : "Right") + RIGIFY_SIDE[r[1]];
  return n;
}
export const AUTO: RigNames = {
  rename: autoRename,
  autoTwist: true,
  follow: [
    ["Bip001_Bn_L_UArmTw", "LeftArm"], ["Bip001-L-ForeTwist", "LeftForeArm"], ["Bip001_Bn_L_ThighTw", "LeftUpLeg"],
    ["Bip001_Bn_R_UArmTw", "RightArm"], ["Bip001-R-ForeTwist", "RightForeArm"], ["Bip001_Bn_R_ThighTw", "RightUpLeg"],
  ],
};
export const BIPED: RigNames = {
  rename: (n) => {
    let m = /^Bip001-(\w+)$/.exec(n);
    if (m && BIP_CORE[m[1]]) return BIP_CORE[m[1]];
    m = /^Bip001-([LR])-(\w+)$/.exec(n);
    if (m && BIP_SIDE[m[2]]) return (m[1] === "L" ? "Left" : "Right") + BIP_SIDE[m[2]];
    return n;
  },
  follow: [
    ["Bip001_Bn_L_UArmTw", "LeftArm"], ["Bip001-L-ForeTwist", "LeftForeArm"], ["Bip001_Bn_L_ThighTw", "LeftUpLeg"],
    ["Bip001_Bn_R_UArmTw", "RightArm"], ["Bip001-R-ForeTwist", "RightForeArm"], ["Bip001_Bn_R_ThighTw", "RightUpLeg"],
  ],
};
const FINGERS = ["Index", "Middle", "Ring", "Pinky"];

export class SkinnedModel {
  private constructor(
    private scene: Scene,
    private c: AssetContainer,
    private height: number,
    /** the model's own clips, as bone directions */
    readonly clips: Record<string, DirClip>,
    private names: RigNames = {},
  ) {}

  static async load(scene: Scene, url: string, height: number, tune?: (m: PBRMaterial) => void, names: RigNames = {}) {
    const c = await LoadAssetContainerAsync(url, scene, { pluginExtension: extFor(url) });
    names.prep?.(c);
    for (const g of c.animationGroups) g.stop();
    for (const m of c.materials) if (m instanceof PBRMaterial) tune?.(m);
    const model = new SkinnedModel(scene, c, height, {}, names);
    // read each clip off a scratch copy of the skeleton, frame by frame
    const tmp = new SkinnedRig(scene, c, height, "bake", names);
    for (const g of tmp.groups) model.clips[g.name.replace(/#.*$/, "")] = tmp.bake(g);
    tmp.dispose();
    return model;
  }
  spawn(tag = "hero") {
    return new SkinnedRig(this.scene, this.c, this.height, tag, this.names);
  }
}

/** a node's local transform (scale, rotation, position) as a matrix */
function localOf(n: TransformNode) {
  return Matrix.Compose(n.scaling, n.rotationQuaternion ?? Quaternion.FromEulerVector(n.rotation), n.position);
}

export class SkinnedRig implements Rig {
  readonly anchor: TransformNode;
  readonly meshes: AbstractMesh[] = [];
  readonly height: number;
  hipH = 1;
  readonly groups: AnimationGroup[] = [];
  private model: TransformNode;
  private root: TransformNode;
  private nodes: Record<string, TransformNode> = {};
  private rest = new Map<TransformNode, { q: Quaternion; p: Vector3 }>();
  private fingers: Record<"l" | "r", { n: TransformNode; q: Quaternion; axis: Vector3 }[]> = { l: [], r: [] };
  private ax = { r: new Vector3(), u: new Vector3(), f: new Vector3() };
  private inv = new Matrix();
  /** helper bones fixed to a posed one: their rest transform relative to it */
  private riders: { n: TransformNode; d: TransformNode; rel: Matrix }[] = [];
  private fresh = new Set<TransformNode>();
  /** each posed joint's line of nodes from just under the pelvis's parent down to it (built once) */
  private chains: Map<TransformNode, TransformNode[]> | null = null;
  /** each node on those lines: the ones below it (they go stale when it turns) */
  private below = new Map<TransformNode, TransformNode[]>();
  private chainsFor(stop: TransformNode) {
    if (this.chains) return this.chains;
    const m = new Map<TransformNode, TransformNode[]>();
    for (const n of Object.values(this.nodes)) {
      const ch: TransformNode[] = [];
      let c: TransformNode | null = n;
      for (; c && c !== stop; c = c.parent as TransformNode | null) ch.unshift(c);
      if (c !== stop) continue;
      m.set(n, ch);
      for (let i = 0; i < ch.length; i++) {
        const l = this.below.get(ch[i]) ?? [];
        for (let j = i + 1; j < ch.length; j++) if (!l.includes(ch[j])) l.push(ch[j]);
        this.below.set(ch[i], l);
      }
    }
    return (this.chains = m);
  }
  /** bones under nothing posed, held to the nearest posed one in world space (AUTO rigs) */
  private loose: { n: TransformNode; d: TransformNode; rel: Matrix }[] = [];

  constructor(scene: Scene, c: AssetContainer, height: number, tag: string, names: RigNames = {}) {
    this.height = height;
    this.anchor = new TransformNode(tag + "Anchor", scene);
    this.anchor.rotationQuaternion = new Quaternion();
    this.model = new TransformNode(tag + "Model", scene);
    this.model.parent = this.anchor;
    const inst = c.instantiateModelsToScene((n) => `${n}#${tag}`, false, { doNotInstantiate: true });
    this.root = inst.rootNodes[0] as TransformNode;
    this.root.parent = this.model;
    for (const g of inst.animationGroups) {
      g.stop();
      this.groups.push(g);
    }
    const all = this.root.getDescendants(false) as Node[];
    for (const m of all)
      if (m instanceof AbstractMesh) {
        m.isPickable = false;
        m.alwaysSelectAsActiveMesh = true;
        m.receiveShadows = true;
        this.meshes.push(m);
      }
    this.all = all;
    this.heavy = all.length > 800;
    const rn = names.rename ?? ((n: string) => n);
    // (two skeletons with the same names — Megatron's mace has a spine of its own: the body's is
    // the one with the pelvis in it, and the heaviest Hips is the body's)
    const byName = new Map<string, TransformNode[]>();
    for (const n of all) if (n instanceof TransformNode) {
      const k = rn(strip(n.name));
      const l = byName.get(k);
      if (l) l.push(n);
      else byName.set(k, [n]);
    }
    let hips0: TransformNode | undefined;
    const find = (name: string) => {
      const l = byName.get(name);
      if (!l || l.length < 2) return l?.[0];
      if (name === "Hips") return l.reduce((a, b) => (b.getDescendants(false).length > a.getDescendants(false).length ? b : a));
      hips0 ??= find("Hips");
      return l.find((x) => hips0 && (x.isDescendantOf(hips0) || hips0.isDescendantOf(x))) ?? l[0];
    };
    const need = new Set<string>(PAIRS.flat());
    // (a few joints some rigs don't have are made here, bone-less, from the ones they do)
    this.synth(find, all);
    for (const n of need) {
      const t = find(n) ?? (this.made.get(n) as TransformNode | undefined);
      if (!t) throw new Error("hero rig: missing " + n);
      if (!t.rotationQuaternion) t.rotationQuaternion = Quaternion.FromEulerVector(t.rotation);
      this.nodes[n] = t;
    }
    for (const n of ["LeftToe_End", "RightToe_End", "LeftShoulder", "RightShoulder", "LeftHandIndex1", "LeftHandPinky1", "RightHandIndex1", "RightHandPinky1"]) {
      const t = find(n) ?? this.made.get(n);
      if (t) {
        if (!t.rotationQuaternion) t.rotationQuaternion = Quaternion.FromEulerVector(t.rotation);
        this.nodes[n] = t;
      }
    }
    // stand him on y = 0 at his height, toes along +Z (the anchor's forward)
    forceWorld(this.root);
    const top = worldPos(this.nodes.HeadTop_End).y;
    const feet = Math.min(worldPos(this.nodes.LeftToeBase).y, worldPos(this.nodes.RightToeBase).y);
    const s = this.height / Math.max(1e-3, top - feet + 0.06 * (top - feet));
    this.model.scaling.setAll(s);
    forceWorld(this.root);
    const toe = worldPos(this.nodes.LeftToeBase).subtract(worldPos(this.nodes.LeftFoot)).add(worldPos(this.nodes.RightToeBase).subtract(worldPos(this.nodes.RightFoot)));
    this.model.rotation.y = -Math.atan2(toe.x, toe.z) + (names.turn ?? 0);
    forceWorld(this.root);
    const f2 = Math.min(worldPos(this.nodes.LeftToeBase).y, worldPos(this.nodes.RightToeBase).y) - 0.02;
    this.model.position.y -= f2;
    forceWorld(this.root);
    this.hipH = worldPos(this.nodes.Hips).y;
    for (const t of Object.values(this.nodes)) this.rest.set(t, { q: t.rotationQuaternion!.clone(), p: t.position.clone() });
    // twist helpers found by name: beside a posed bone, ride with the nearest one
    if (names.autoTwist) {
      const posed = new Set(Object.values(this.nodes));
      for (const x of all) {
        if (!(x instanceof TransformNode) || posed.has(x) || !/twist/i.test(x.name) || !x.parent) continue;
        let best: TransformNode | null = null, bd = Infinity;
        for (const d of posed) {
          if (d.parent !== x.parent) continue;
          const dd = Vector3.Distance(worldPos(d), worldPos(x));
          if (dd < bd) (bd = dd), (best = d);
        }
        if (!best) continue;
        if (!x.rotationQuaternion) x.rotationQuaternion = Quaternion.FromEulerVector(x.rotation);
        this.riders.push({ n: x, d: best, rel: localOf(x).multiply(localOf(best).invert()) });
      }
    }
    // (AUTO rigs) what hangs off bones nothing here moves — Rigify's face bones under its ORG/MCH
    // control rig, hair and teeth parented to control bones — rides with the nearest posed bone, held
    // where it is relative to it; meshes parented that way are re-hung on that bone
    if (names.autoTwist) {
      const posed = new Set<Node>(Object.values(this.nodes));
      const under = (n: Node) => {
        for (let p = n.parent; p; p = p.parent) if (posed.has(p)) return true;
        return false;
      };
      const nearest = (at: Vector3) => {
        let best: TransformNode | null = null, bd = Infinity;
        for (const d of Object.values(this.nodes)) {
          const dd = Vector3.Distance(worldPos(d), at);
          if (dd < bd) (bd = dd), (best = d);
        }
        return best!;
      };
      // (the joints that actually move skin: a Rigify export lists its whole control rig as joints)
      const joints = new Set<TransformNode>();
      const allJoints = new Set<TransformNode>();
      for (const m of this.meshes) {
        const sk = m.skeleton;
        if (!sk) continue;
        for (const b of sk.bones) {
          const t = b.getTransformNode();
          if (t) allJoints.add(t as TransformNode);
        }
        const used = new Set<number>();
        for (const [ik, wk] of [[VertexBuffer.MatricesIndicesKind, VertexBuffer.MatricesWeightsKind], [VertexBuffer.MatricesIndicesExtraKind, VertexBuffer.MatricesWeightsExtraKind]]) {
          const I = m.getVerticesData(ik), Wt = m.getVerticesData(wk);
          if (!I || !Wt) continue;
          for (let i = 0; i < I.length; i++) if (Wt[i] > 0.01) used.add(I[i]);
        }
        for (const i of used) {
          const t = sk.bones[i]?.getTransformNode();
          if (t) joints.add(t as TransformNode);
        }
      }
      // (never an ancestor of a posed bone — Bip001 above the pelvis: moving it would move the pelvis)
      const above = new Set<Node>();
      for (const d of posed) for (let p = d.parent; p; p = p.parent) above.add(p);
      const free = (n: Node) => !posed.has(n) && !above.has(n) && !under(n) && n !== this.root;
      // (only the top of each such branch needs holding: everything under it comes along — a branch
      // stops where the nearest posed bone changes, so the face goes with the head, not the chest)
      const near = new Map<Node, TransformNode>();
      const nearOf = (n: Node) => {
        let v = near.get(n);
        if (!v) near.set(n, (v = nearest(worldPos(n as TransformNode))));
        return v;
      };
      const tops = new Map<Node, Vector3[]>();
      for (const j of joints) {
        if (!free(j)) continue;
        let top: Node = j;
        while (top.parent && free(top.parent) && nearOf(top.parent) === nearOf(j)) top = top.parent;
        const pts = tops.get(top) ?? [];
        pts.push(worldPos(j));
        tops.set(top, pts);
      }
      const depth = (n: Node) => {
        let k = 0;
        for (let p = n.parent; p; p = p.parent) k++;
        return k;
      };
      for (const [t, pts] of [...tops].sort((a, b) => depth(a[0]) - depth(b[0]))) {
        const top = t as TransformNode;
        if (!top.rotationQuaternion) top.rotationQuaternion = Quaternion.FromEulerVector(top.rotation);
        const mid = pts.reduce((a, b) => a.addInPlace(b), new Vector3()).scaleInPlace(1 / pts.length);
        const d = nearest(mid);
        this.loose.push({ n: top, d, rel: forceWorld(top).multiply(forceWorld(d).clone().invert()) });
      }
      // (a static part is re-hung by its own group node — a gun's handle, the hair — when it has one)
      const moved = new Set<Node>();
      for (const m of this.meshes) {
        if (m.skeleton || under(m)) continue;
        const grp = m.parent && !allJoints.has(m.parent as TransformNode) && !above.has(m.parent) && m.parent !== this.root ? (m.parent as TransformNode) : m;
        if (moved.has(grp) || under(grp)) continue;
        moved.add(grp);
        m.computeWorldMatrix(true);
        grp.setParent(nearest(m.getBoundingInfo().boundingBox.centerWorld));
      }
    }
    // twist bones (siblings of the bone they twist with): fixed to it, in their shared parent's space
    for (const [helper, driver] of names.follow ?? []) {
      const n = all.find((x) => x instanceof TransformNode && strip(x.name) === helper) as TransformNode | undefined;
      const d = this.nodes[driver];
      if (!n || !d || n.parent !== d.parent) continue;
      if (!n.rotationQuaternion) n.rotationQuaternion = Quaternion.FromEulerVector(n.rotation);
      const rel = localOf(n).multiply(localOf(d).invert());
      this.riders.push({ n, d, rel });
    }
    // fingers: each joint curls about the axis across the hand (the palm's side-to-side line)
    for (const [side, S] of [["l", "Left"], ["r", "Right"]] as const) {
      const hand = this.nodes[S + "Hand"];
      const idx = find(S + "HandIndex1"), pinky = find(S + "HandPinky1");
      if (!idx || !pinky) continue;
      for (const f of [...FINGERS, "Thumb"])
        for (let k = 1; k <= 3; k++) {
          const t = find(`${S}Hand${f}${k}`);
          if (!t) continue;
          if (!t.rotationQuaternion) t.rotationQuaternion = Quaternion.FromEulerVector(t.rotation);
          // the curl axis in the joint's own space: across the hand (index → pinky), so bending folds toward the palm
          const across = worldPos(pinky).subtract(worldPos(idx)).normalize();
          const m = forceWorld(t).clone().invert();
          const ax = Vector3.TransformNormal(across, m).normalize();
          this.fingers[side].push({ n: t, q: t.rotationQuaternion!.clone(), axis: f === "Thumb" ? ax.scale(0.5) : ax });
        }
      void hand;
    }
  }

  private all: Node[] = [];
  private made = new Map<string, TransformNode>();
  /**
   * The joints the poses need that a rig may lack, added as plain nodes: a crown on the head, a
   * Spine2 between the chest and the neck, a hand's middle knuckle along the forearm's line, a toe.
   */
  private synth(find: (n: string) => TransformNode | undefined, all: Node[]) {
    void all;
    const at = (n: TransformNode) => {
      n.computeWorldMatrix(true);
      return n.getAbsolutePosition().clone();
    };
    const add = (name: string, parent: TransformNode, world: Vector3) => {
      const t = new TransformNode(name + "_synth", parent.getScene());
      t.parent = parent;
      parent.computeWorldMatrix(true);
      t.position.copyFrom(Vector3.TransformCoordinates(world, parent.getWorldMatrix().clone().invert()));
      t.rotationQuaternion = new Quaternion();
      this.made.set(name, t);
    };
    const head = find("Head"), s1 = find("Spine1");
    // (no neck — Megatron's head sits straight on his spine: one is made between)
    if (head && !find("Neck") && head.parent instanceof TransformNode) add("Neck", head.parent, Vector3.Lerp(at(head.parent), at(head), 0.6));
    const neck = find("Neck") ?? (this.made.get("Neck") as TransformNode | undefined);
    if (head && !find("HeadTop_End")) {
      // (sizes relative to the body — the model is still in its own units here, often centimetres)
      const hips = find("Hips");
      const torso = hips ? Vector3.Distance(at(hips), at(head)) : 0;
      const h = at(head), base = neck ? at(neck) : h.subtract(new Vector3(0, torso * 0.2 || 0.1, 0));
      add("HeadTop_End", head, h.add(h.subtract(base).normalize().scale(Math.max(torso * 0.33, Vector3.Distance(h, base) * 2.2))));
    }
    if (s1 && neck && !find("Spine2")) add("Spine2", s1, Vector3.Lerp(at(s1), at(neck), 0.5));
    for (const S of ["Left", "Right"]) {
      const hand = find(S + "Hand"), fore = find(S + "ForeArm");
      if (hand && fore && !find(S + "HandMiddle1")) {
        const h = at(hand);
        add(S + "HandMiddle1", hand, h.add(h.subtract(at(fore)).normalize().scale(Vector3.Distance(h, at(fore)) * 0.35)));
      }
      const foot = find(S + "Foot"), leg = find(S + "Leg");
      if (foot && leg && !find(S + "ToeBase")) {
        const f = at(foot);
        add(S + "ToeBase", foot, f.add(new Vector3(0, -0.6, 1).normalize().scale(Vector3.Distance(f, at(leg)) * 0.3)));
      }
    }
  }
  /**
   * Hold a node to a posed bone from now on, as it is relative to it right now (a prop bone that
   * hangs off the skeleton's root: re-parenting its node wouldn't move the skin — the skeleton
   * keeps its own hierarchy — so it's placed under its own parent, each frame, from the bone).
   */
  pin(n: TransformNode, bone: string) {
    const d = this.nodes[bone];
    if (!d) return false;
    this.unloose(n);
    if (!n.rotationQuaternion) n.rotationQuaternion = Quaternion.FromEulerVector(n.rotation);
    this.loose.push({ n, d, rel: forceWorld(n).multiply(forceWorld(d).clone().invert()) });
    return true;
  }
  /** stop holding a loose bone to the body (a prop the kit takes charge of, or hides) */
  unloose(n: TransformNode) {
    this.loose = this.loose.filter((r) => r.n !== n);
  }
  /** a posed joint by its Mixamo name (LeftHand, Spine2 …) */
  bone(name: string) {
    return this.nodes[name] as TransformNode | undefined;
  }
  /** any of the model's nodes by its (stripped) name — cape bones, effect sockets */
  node(name: string) {
    return this.all.find((n) => n instanceof TransformNode && strip(n.name) === name) as TransformNode | undefined;
  }
  /**
   * A joint's world position as of the last render (no recompute: the render brings every matrix up
   * to date each frame) — a frame old at most, for hit boxes and muzzles, at a fraction of the cost
   */
  atCached(name: string, out = new Vector3()) {
    const n = this.nodes[name];
    return n ? n.getWorldMatrix().getTranslationToRef(out) : out.copyFrom(this.anchor.position);
  }
  at(name: string, out = new Vector3()) {
    const n = this.nodes[name];
    if (!n) return out.copyFrom(this.anchor.position);
    // (the chain above the pelvis brought up to date only when the anchor has moved; then just the
    // joints from the pelvis down to this one — not the whole line from the scene root every time)
    const stop = this.nodes.Hips?.parent as TransformNode | undefined;
    if (!stop) return worldPos(n, out);
    const a = this.anchor.position, q = this.anchor.rotationQuaternion!, sc = this.anchor.scaling, k = this.stopKey;
    if (a.x !== k[0] || a.y !== k[1] || a.z !== k[2] || q.x !== k[3] || q.y !== k[4] || q.z !== k[5] || q.w !== k[6] || sc.x !== k[7]) {
      forceWorld(stop);
      k[0] = a.x; k[1] = a.y; k[2] = a.z; k[3] = q.x; k[4] = q.y; k[5] = q.z; k[6] = q.w; k[7] = sc.x;
    }
    const ch = this.chainBuf;
    ch.length = 0;
    for (let c: TransformNode | null = n; c && c !== stop; c = c.parent as TransformNode | null) ch.push(c);
    for (let i = ch.length - 1; i >= 0; i--) ch[i].computeWorldMatrix(true);
    return n.getWorldMatrix().getTranslationToRef(out);
  }
  private stopKey = new Float64Array(8).fill(NaN);
  private chainBuf: TransformNode[] = [];
  setVisible(v: boolean) {
    this.anchor.setEnabled(v);
  }

  /** each pair turned to its body-frame direction, parents first; the pelvis at `hip` (anchor space) */
  /**
   * Where the camera is (the Game sets it): a body far from it is posed less often — every frame
   * within 10 m, every 2nd to 25 m, every 3rd to 50 m, every 5th beyond. The anchor still moves every
   * frame (the body goes with it), only the limbs update less often where nobody can tell.
   */
  static viewer: (() => Vector3 | null) | null = null;
  private poseTick = Math.floor(Math.random() * 5);
  private heavy = false;
  pose(dirs: Dir[], hip: Vector3) {
    const eye = SkinnedRig.viewer?.();
    if (eye) {
      const d = Vector3.Distance(eye, this.anchor.position);
      // (a very heavy rig — Star-Lord's 1,053 Rigify joints — at most every other frame)
      const every = Math.max(this.heavy ? 2 : 1, d < 7 ? 1 : d < 25 ? 2 : d < 50 ? 3 : 5);
      if (++this.poseTick % every !== 0) return;
    }
    for (const [n, r] of this.rest) {
      n.rotationQuaternion!.copyFrom(r.q);
      n.position.copyFrom(r.p);
    }
    const A = forceWorld(this.anchor);
    Vector3.TransformNormalToRef(Vector3.RightReadOnly, A, this.ax.r).normalize();
    Vector3.TransformNormalToRef(Vector3.UpReadOnly, A, this.ax.u).normalize();
    Vector3.TransformNormalToRef(Vector3.Forward(), A, this.ax.f).normalize();
    // the pelvis: where `hip` is in the world, then into its parent's space
    const want = Vector3.TransformCoordinates(hip, A);
    const hips = this.nodes.Hips;
    forceWorld(hips.parent as TransformNode).invertToRef(this.inv);
    Vector3.TransformCoordinatesToRef(want, this.inv, hips.position);
    const w = new Vector3();
    // (world positions inside the skeleton only: everything above the pelvis was just brought up to
    // date, so a bone's chain is recomputed from there down, not from the scene root every time)
    const stop = hips.parent as TransformNode;
    // (world positions inside the skeleton only — everything above the pelvis was just brought up to
    // date — and only what's changed: each node's matrix is kept until a bone above it turns)
    const chains = this.chainsFor(stop);
    const fresh = this.fresh;
    fresh.clear();
    const wp = (n: TransformNode, out: Vector3) => {
      const ch = chains.get(n);
      if (!ch) return worldPos(n, out);
      let dirty = false;
      for (const c of ch) {
        if (dirty || !fresh.has(c)) {
          c.computeWorldMatrix(true);
          fresh.add(c);
          dirty = true;
        }
      }
      return n.getWorldMatrix().getTranslationToRef(out);
    };
    const stale = (n: TransformNode) => {
      fresh.delete(n);
      for (const d of this.below.get(n) ?? []) fresh.delete(d);
    };
    const a = new Vector3(), b = new Vector3();
    PAIRS.forEach(([bone, child], k) => {
      const d = dirs[k];
      w.copyFrom(this.ax.r).scaleInPlace(d[0]).addInPlace(this.ax.u.scale(d[1])).addInPlace(this.ax.f.scale(d[2]));
      const n = this.nodes[bone], c = this.nodes[child];
      alignDir(n, wp(c, a).subtract(wp(n, b)), w, () => {
        stale(n);
        return wp(c, a).subtract(wp(n, b));
      });
      stale(n);
    });
    for (const r of this.riders) r.rel.multiply(localOf(r.d)).decompose(r.n.scaling, r.n.rotationQuaternion!, r.n.position);
    const before = this.anchor.position.y;
    plantFeet(this.anchor, this.ax.u, (n) => this.nodes[n], (n) => wp(n, new Vector3()));
    // (lifted out of the ground: everything moved with him)
    if (this.anchor.position.y !== before) {
      forceWorld(stop);
      fresh.clear();
    }
    if (this.loose.length) {
      // (each driver's world once; each branch top once, parents first — the chains above them were
      // just brought up to date by the posing)
      const W = new Matrix(), inv = new Matrix();
      const dw = new Map<TransformNode, Matrix>();
      for (const r of this.loose) {
        let D = dw.get(r.d);
        if (!D) {
          wp(r.d, a);
          dw.set(r.d, (D = r.d.getWorldMatrix().clone()));
        }
        r.rel.multiplyToRef(D, W);
        const p = r.n.parent as TransformNode | null;
        if (p) {
          p.computeWorldMatrix(true).invertToRef(inv);
          W.multiplyToRef(inv, W);
        }
        W.decompose(r.n.scaling, r.n.rotationQuaternion!, r.n.position);
        r.n.computeWorldMatrix(true);
      }
    }
  }

  /** curl the fingers: 0 open (repulsors, flying) … 1 a fist (punches) */
  grip(side: "l" | "r", k: number) {
    for (const f of this.fingers[side]) {
      f.n.rotationQuaternion!.copyFrom(f.q).multiplyInPlace(Quaternion.RotationAxis(f.axis, k * 1.25));
    }
  }

  /** a clip read off the skeleton: bone directions per frame (30 fps), in his body frame */
  bake(g: AnimationGroup): DirClip {
    const fps = 30;
    const src = g.targetedAnimations[0]?.animation.framePerSecond ?? 30;
    const dur = (g.to - g.from) / src;
    const n = Math.max(2, Math.round(dur * fps) + 1);
    g.start(false, 1, g.from, g.to, false);
    g.pause();
    const frames: DirClip["frames"] = [];
    const restHip = this.hipH;
    for (let i = 0; i < n; i++) {
      g.goToFrame(g.from + (i / (n - 1)) * (g.to - g.from));
      forceWorld(this.root);
      const d = PAIRS.map(([a, b]) => {
        const v = worldPos(this.nodes[b]).subtract(worldPos(this.nodes[a])).normalize();
        return [+v.x.toFixed(4), +v.y.toFixed(4), +v.z.toFixed(4)] as Dir;
      });
      // (the clip's root wander is left out: the controller moves him)
      const hp = worldPos(this.nodes.Hips);
      frames.push({ hip: [0, +(hp.y / restHip).toFixed(4), 0], d });
    }
    g.stop();
    return { fps, frames };
  }

  dispose() {
    this.anchor.dispose(false, false);
    for (const g of this.groups) g.dispose();
  }
}
