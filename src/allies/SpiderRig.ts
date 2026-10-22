import "@babylonjs/loaders/glTF/2.0/Extensions/KHR_materials_unlit";
import { AbstractMesh } from "@babylonjs/core/Meshes/abstractMesh";
import { Bone } from "@babylonjs/core/Bones/bone";
import { Color3 } from "@babylonjs/core/Maths/math.color";
import { LoadAssetContainerAsync } from "@babylonjs/core/Loading/sceneLoader";
import { Matrix, Quaternion, Vector3 } from "@babylonjs/core/Maths/math.vector";
import { Mesh } from "@babylonjs/core/Meshes/mesh";
import { PBRMaterial } from "@babylonjs/core/Materials/PBR/pbrMaterial";
import { Scene } from "@babylonjs/core/scene";
import { Skeleton } from "@babylonjs/core/Bones/skeleton";
import { TransformNode } from "@babylonjs/core/Meshes/transformNode";
import { VertexBuffer } from "@babylonjs/core/Buffers/buffer";
import { VertexData } from "@babylonjs/core/Meshes/mesh.vertexData";
import { alignDir, forceWorld, plantFeet, worldPos } from "../core/ik";
import { extFor } from "../weapons/ArmsRig";

/**
 * The runtime rig for a hero mesh whose own skeleton can't be posed (first written for the old
 * static Spider-Man; now Deadpool's): a static mesh in an A-pose, rigged here at load —
 *
 *  - the mesh is measured (height, the crotch, the arms' line, the feet) and a Mixamo-named
 *    skeleton is placed inside it: pelvis, three spine joints, neck, head; clavicle, shoulder, elbow,
 *    wrist and hand each side; hip, knee, ankle and toe each side;
 *  - every vertex is weighted to the nearest bones (up to four, by distance to each bone's segment,
 *    fenced by side and region so a hand never follows a thigh, the head stays rigid) — or, when the
 *    model brings its artist's skin (ArtistSkin), the artist's joints place ours and the artist's
 *    weights are moved over onto them;
 *  - the bones are linked to transform nodes, so the same direction-posing the hostage uses
 *    (alignDir, parents first) moves him — mocap clips baked as bone directions, or poses set by hand.
 */

export type Dir = [number, number, number];

/** the posed pairs: bone → the joint it points at (the order of the baked clips) */
export const PAIRS: [string, string][] = [
  ["Hips", "Spine1"], ["Spine", "Spine1"], ["Spine1", "Spine2"], ["Spine2", "Neck"], ["Neck", "Head"], ["Head", "HeadTop_End"],
  ["LeftArm", "LeftForeArm"], ["LeftForeArm", "LeftHand"], ["LeftHand", "LeftHandMiddle1"],
  ["RightArm", "RightForeArm"], ["RightForeArm", "RightHand"], ["RightHand", "RightHandMiddle1"],
  ["LeftUpLeg", "LeftLeg"], ["LeftLeg", "LeftFoot"], ["LeftFoot", "LeftToeBase"],
  ["RightUpLeg", "RightLeg"], ["RightLeg", "RightFoot"], ["RightFoot", "RightToeBase"],
];

/** skeleton: name → parent (body-frame joint positions are measured from the mesh) */
const PARENT: Record<string, string | null> = {
  Hips: null, Spine: "Hips", Spine1: "Spine", Spine2: "Spine1", Neck: "Spine2", Head: "Neck", HeadTop_End: "Head",
  LeftShoulder: "Spine2", LeftArm: "LeftShoulder", LeftForeArm: "LeftArm", LeftHand: "LeftForeArm", LeftHandMiddle1: "LeftHand", LeftHandEnd: "LeftHandMiddle1",
  RightShoulder: "Spine2", RightArm: "RightShoulder", RightForeArm: "RightArm", RightHand: "RightForeArm", RightHandMiddle1: "RightHand", RightHandEnd: "RightHandMiddle1",
  LeftUpLeg: "Hips", LeftLeg: "LeftUpLeg", LeftFoot: "LeftLeg", LeftToeBase: "LeftFoot", LeftToe_End: "LeftToeBase",
  RightUpLeg: "Hips", RightLeg: "RightUpLeg", RightFoot: "RightLeg", RightToeBase: "RightFoot", RightToe_End: "RightToeBase",
};
/** bones that carry skin, each with the joint its segment runs to */
const SEG: [string, string][] = [
  ["Hips", "Spine"], ["Spine", "Spine1"], ["Spine1", "Spine2"], ["Spine2", "Neck"], ["Neck", "Head"], ["Head", "HeadTop_End"],
  ["LeftShoulder", "LeftArm"], ["LeftArm", "LeftForeArm"], ["LeftForeArm", "LeftHand"], ["LeftHand", "LeftHandEnd"],
  ["RightShoulder", "RightArm"], ["RightArm", "RightForeArm"], ["RightForeArm", "RightHand"], ["RightHand", "RightHandEnd"],
  ["LeftUpLeg", "LeftLeg"], ["LeftLeg", "LeftFoot"], ["LeftFoot", "LeftToeBase"], ["LeftToeBase", "LeftToe_End"],
  ["RightUpLeg", "RightLeg"], ["RightLeg", "RightFoot"], ["RightFoot", "RightToeBase"], ["RightToeBase", "RightToe_End"],
];

/**
 * A model that comes with its artist's skin, on a skeleton the poses can't drive (Deadpool: limbs
 * hung off the root, the torso a chain run head-down). Its joints place ours, and its weights are
 * moved over onto our bones — the artist's painting, our skeleton. Names are the model's bones
 * (trailing _NN dropped); targets are ours ("Left…" sides are checked against the mesh and swapped
 * if the model has them the other way), "torso" (spread along our spine by height) or "A|B" (A above
 * A's joint, B below the top of B, blended between).
 */
export interface ArtistSkin {
  joints: Record<string, string>;
  weights: Record<string, string>;
}
interface Part {
  /** mesh in the body frame (x his right, y up from the soles, z forward) */
  pos: Float32Array;
  /** the artist's weights (model bone names, four per vertex), when re-rigging on them */
  aw?: { names: string[]; idx: Float32Array; w: Float32Array };
  nrm: Float32Array;
  uv: Float32Array | null;
  idx: Uint32Array;
  material: PBRMaterial;
}
interface Measured extends Part {
  /** every mesh of the model (the first is also spread on the object itself, for one-mesh models) */
  parts: Part[];
  joints: Record<string, Vector3>;
  height: number;
}

/** measure the mesh and place the joints (all in the body frame) */
export interface Bulk {
  /** behind the spine (back, glutes) and in front of it (chest, belly), depth multipliers; side: width */
  back: number;
  front: number;
  side: number;
}
const stripN = (n: string) => n.replace(/_\d+$/, "");
function measure(meshes: AbstractMesh[], auto = false, height?: number, bulk?: Bulk, artist?: ArtistSkin): Measured {
  const P: Vector3[] = [], N: Vector3[] = [];
  const spans: { mesh: AbstractMesh; from: number; n: number }[] = [];
  /** the artist's joints where they bind (world), by name */
  const AJ: Record<string, Vector3> = {};
  for (const mesh of meshes) {
    mesh.computeWorldMatrix(true);
    const W = mesh.getWorldMatrix();
    if (artist && mesh.skeleton)
      for (const b of mesh.skeleton.bones) {
        // (end joints that carry no skin come with no bind pose: ours are measured instead)
        const bind = b.getAbsoluteInverseBindMatrix().clone().invert();
        if (bind.getTranslation().lengthSquared() < 1e-12) continue;
        AJ[stripN(b.name)] ??= Vector3.TransformCoordinates(bind.getTranslation(), W);
      }
    const src = mesh.getVerticesData(VertexBuffer.PositionKind)!;
    const srcN = mesh.getVerticesData(VertexBuffer.NormalKind)!;
    const k = src.length / 3;
    spans.push({ mesh, from: P.length, n: k });
    for (let i = 0; i < k; i++) {
      P.push(Vector3.TransformCoordinates(new Vector3(src[i * 3], src[i * 3 + 1], src[i * 3 + 2]), W));
      N.push(Vector3.TransformNormal(new Vector3(srcN[i * 3], srcN[i * 3 + 1], srcN[i * 3 + 2]), W).normalize());
    }
  }
  const n = P.length;
  let y0 = Infinity, y1 = -Infinity;
  for (const p of P) (y0 = Math.min(y0, p.y)), (y1 = Math.max(y1, p.y));
  // (a model in other units — millimetres — is scaled to a real height first)
  if (height) {
    const k = height / (y1 - y0);
    for (const p of P) p.scaleInPlace(k);
    for (const a of Object.values(AJ)) a.scaleInPlace(k);
    y0 *= k;
    y1 *= k;
  }
  const H = y1 - y0;
  // facing: the feet reach forward of the shins
  const avg = (sel: (p: Vector3) => boolean) => {
    const s = new Vector3();
    let c = 0;
    for (const p of P) if (sel(p)) s.addInPlace(p), c++;
    return s.scaleInPlace(1 / Math.max(1, c));
  };
  const feet = avg((p) => p.y < y0 + 0.03 * H);
  const shins = avg((p) => p.y > y0 + 0.12 * H && p.y < y0 + 0.2 * H);
  const toe = feet.subtract(shins);
  toe.y = 0;
  // (the forward axis is whichever horizontal axis the toes lean along)
  const fwd = Math.abs(toe.x) > Math.abs(toe.z) ? new Vector3(Math.sign(toe.x), 0, 0) : new Vector3(0, 0, Math.sign(toe.z));
  const up = Vector3.Up();
  const right = Vector3.Cross(up, fwd);
  const o = new Vector3(shins.x, y0, shins.z);
  const pos = new Float32Array(n * 3), nrm = new Float32Array(n * 3);
  const B: Vector3[] = [];
  for (let i = 0; i < n; i++) {
    const d = P[i].subtract(o);
    const b = new Vector3(Vector3.Dot(d, right), d.y, Vector3.Dot(d, fwd));
    B.push(b);
    pos.set([b.x, b.y, b.z], i * 3);
    nrm.set([Vector3.Dot(N[i], right), N[i].y, Vector3.Dot(N[i], fwd)], i * 3);
  }
  // centre the torso on x = 0 (the model's own centre line)
  let cx = 0, cc = 0;
  for (const b of B) if (b.y > 0.6 * H && b.y < 0.75 * H && Math.abs(b.x) < 0.12 * H) (cx += b.x), cc++;
  cx /= Math.max(1, cc);
  for (let i = 0; i < n; i++) {
    B[i].x -= cx;
    pos[i * 3] -= cx;
  }
  // (the artist's joints into the same frame)
  const AB: Record<string, Vector3> = {};
  for (const [k, a] of Object.entries(AJ)) {
    const d = a.subtract(o);
    AB[k] = new Vector3(Vector3.Dot(d, right) - cx, d.y, Vector3.Dot(d, fwd));
  }
  // a fuller build: the torso (hips to shoulders) pushed out from the spine's line — more behind
  // than in front — and a touch wider; it fades out toward the neck, the thighs and the arms
  if (bulk) {
    let zs = 0, zc = 0;
    for (const b of B) if (b.y > 0.55 * H && b.y < 0.8 * H && Math.abs(b.x) < 0.08 * H) (zs += b.z), zc++;
    const zSpine = zs / Math.max(1, zc);
    const ramp = (v: number, a: number, b: number) => Math.max(0, Math.min(1, (v - a) / (b - a)));
    for (let i = 0; i < n; i++) {
      const b = B[i];
      const h = b.y / H;
      const w = ramp(h, 0.38, 0.47) * (1 - ramp(h, 0.8, 0.86)) * (1 - ramp(Math.abs(b.x) / H, 0.12, 0.16));
      if (w <= 0) continue;
      const dz = b.z - zSpine;
      const kz = 1 + ((dz < 0 ? bulk.back : bulk.front) - 1) * w;
      const kx = 1 + (bulk.side - 1) * w;
      b.z = zSpine + dz * kz;
      b.x *= kx;
      pos[i * 3] = b.x;
      pos[i * 3 + 2] = b.z;
    }
  }

  // ---- landmarks
  const slice = (ya: number, yb: number, sel: (b: Vector3) => boolean = () => true) => B.filter((b) => b.y >= ya * H && b.y < yb * H && sel(b));
  const mean = (list: Vector3[]) => list.reduce((s, b) => s.addInPlace(b), new Vector3()).scaleInPlace(1 / Math.max(1, list.length));
  // crotch: the lowest height where there's mesh on the centre line
  let crotch = 0.5 * H;
  for (let y = 0.35; y < 0.62; y += 0.005)
    if (slice(y, y + 0.01, (b) => Math.abs(b.x) < 0.012 * H).length > 0) {
      crotch = y * H;
      break;
    }
  const J: Record<string, Vector3> = {};
  const torsoZ = (y: number) => mean(slice(y - 0.02, y + 0.02, (b) => Math.abs(b.x) < 0.08 * H)).z;
  const legAt = (y: number, s: number) => mean(slice(y - 0.02, y + 0.02, (b) => s * b.x > 0.004 * H && s * b.x < 0.17 * H));
  // the neck: (auto) the first height above the chest where the body narrows to a neck
  let neckY = 0.845 * H;
  if (auto)
    for (let y = 0.72; y < 0.97; y += 0.005) {
      const sl = slice(y, y + 0.012);
      let w = 0;
      for (const b of sl) w = Math.max(w, Math.abs(b.x));
      if (sl.length > 3 && w < 0.075 * H) {
        neckY = (y - 0.01) * H;
        break;
      }
    }
  const hipsY = crotch + 0.05 * H;
  const at = (f: number) => hipsY + (neckY - hipsY) * f;
  J.Hips = new Vector3(0, hipsY, torsoZ(hipsY / H));
  J.Spine = new Vector3(0, auto ? at(0.15) : crotch + 0.1 * H, torsoZ((auto ? at(0.15) : crotch + 0.1 * H) / H));
  J.Spine1 = new Vector3(0, auto ? at(0.45) : 0.66 * H, torsoZ(auto ? at(0.45) / H : 0.66));
  J.Spine2 = new Vector3(0, auto ? at(0.72) : 0.74 * H, torsoZ(auto ? at(0.72) / H : 0.74));
  J.Neck = new Vector3(0, neckY, torsoZ(neckY / H));
  J.Head = new Vector3(0, auto ? neckY + 0.035 * H : 0.88 * H, torsoZ(auto ? neckY / H + 0.04 : 0.89));
  J.HeadTop_End = new Vector3(0, H, J.Head.z);
  const shoulderY = auto ? neckY - 0.055 * H : 0.79 * H;
  const kneeY = auto ? (crotch + 0.055 * H) / 2 + 0.012 * H : 0.28 * H;
  for (const [side, s] of [["Left", -1], ["Right", 1]] as const) {
    // legs: the centre of each leg's cross-section at the hip, knee and ankle
    const hipC = legAt(crotch / H - 0.04, s);
    J[side + "UpLeg"] = new Vector3(hipC.x, crotch + 0.01 * H, hipC.z);
    const knee = legAt(kneeY / H, s);
    J[side + "Leg"] = new Vector3(knee.x, kneeY, knee.z + 0.01 * H);
    const ank = legAt(0.06, s);
    J[side + "Foot"] = new Vector3(ank.x, 0.055 * H, ank.z - 0.01 * H);
    const sole = B.filter((b) => b.y < 0.05 * H && s * b.x > 0);
    let zMax = -Infinity;
    for (const b of sole) zMax = Math.max(zMax, b.z);
    J[side + "ToeBase"] = new Vector3(ank.x, 0.02 * H, J[side + "Foot"].z + (zMax - J[side + "Foot"].z) * 0.62);
    J[side + "Toe_End"] = new Vector3(ank.x, 0.02 * H, zMax);
    // arms: the line through the arm's vertices (outside the torso), shoulder to fingertip
    const arm = B.filter((b) => s * b.x > 0.115 * H && b.y > crotch - 0.06 * H && b.y < shoulderY + 0.03 * H);
    const c = mean(arm);
    // principal axis (power iteration on the covariance)
    let ax = new Vector3(s, -1, 0).normalize();
    for (let it = 0; it < 12; it++) {
      const acc = new Vector3();
      for (const b of arm) {
        const d = b.subtract(c);
        acc.addInPlace(d.scale(Vector3.Dot(d, ax)));
      }
      ax = acc.normalize();
    }
    if (ax.y > 0) ax.scaleInPlace(-1); // shoulder → hand
    let tMax = -Infinity;
    for (const b of arm) tMax = Math.max(tMax, Vector3.Dot(b.subtract(c), ax));
    const tip = c.add(ax.scale(tMax));
    // the shoulder joint: on that line where it meets the shoulder's height
    const shY = shoulderY;
    const tSh = (shY - c.y) / ax.y;
    const shoulder = c.add(ax.scale(tSh));
    const wrist = tip.subtract(ax.scale(0.105 * H));
    J[side + "Shoulder"] = new Vector3(s * 0.03 * H, shoulderY + 0.01 * H, J.Spine2.z);
    J[side + "Arm"] = shoulder;
    J[side + "ForeArm"] = Vector3.Lerp(shoulder, wrist, 0.5).addInPlace(new Vector3(0, 0, -0.008 * H));
    J[side + "Hand"] = wrist;
    J[side + "HandMiddle1"] = wrist.add(ax.scale(0.055 * H));
    J[side + "HandEnd"] = tip;
  }
  // the artist's skeleton places ours (sides as the mesh has them, not as the names say)
  let swap: Record<string, boolean> = {};
  if (artist) {
    const sideOf = (ours: string) => {
      const a = AB[artist.joints[ours]];
      return a ? Math.sign(a.x) : 0;
    };
    // (our Left is his left: x < 0)
    swap = { leg: sideOf("LeftUpLeg") > 0, arm: sideOf("LeftArm") > 0 };
    const flip = (ours: string) => {
      const leg = /UpLeg|Leg|Foot|Toe/.test(ours);
      return (leg ? swap.leg : swap.arm) ? ours.replace(/Left|Right/g, (m) => (m === "Left" ? "Right" : "Left")) : ours;
    };
    for (const [ours, theirs] of Object.entries(artist.joints)) {
      const a = AB[theirs];
      if (a) J[flip(ours)] = a.clone();
    }
    // the pelvis a little above the hip sockets; the hand's middle between wrist and fingertips
    const hy = (J.LeftUpLeg.y + J.RightUpLeg.y) / 2;
    J.Hips.y = Math.max(J.Hips.y, hy + 0.04 * H);
    J.Spine.y = Math.max(J.Spine.y, J.Hips.y + 0.04 * H);
    for (const side of ["Left", "Right"]) {
      // the hand on from the wrist, along the forearm (where the artist left no joint)
      const along = J[side + "Hand"].subtract(J[side + "ForeArm"]).normalize();
      if (!artist.joints[side + "HandEnd"] || !AB[artist.joints[side + "HandEnd"]]) J[side + "HandEnd"] = J[side + "Hand"].add(along.scale(0.105 * H));
      J[side + "HandMiddle1"] = Vector3.Lerp(J[side + "Hand"], J[side + "HandEnd"], 0.45);
      J[side + "Shoulder"].y = J[side + "Arm"].y;
      J[side + "ToeBase"].x = J[side + "Foot"].x;
      J[side + "Toe_End"].x = J[side + "Foot"].x;
    }
  }
  const parts: Part[] = spans.map(({ mesh, from, n: k }) => {
    const uv = mesh.getVerticesData(VertexBuffer.UVKind);
    let aw: Part["aw"];
    if (artist && mesh.skeleton) {
      const bi = mesh.getVerticesData(VertexBuffer.MatricesIndicesKind), bw = mesh.getVerticesData(VertexBuffer.MatricesWeightsKind);
      if (bi && bw) {
        // bone index → our target ("Left…" swapped to match the mesh)
        const names: string[] = [];
        for (const b of mesh.skeleton.bones) {
          let t = artist.weights[stripN(b.name)] ?? "";
          const leg = /UpLeg|Leg|Foot|Toe/.test(t);
          if (t && (leg ? swap.leg : swap.arm)) t = t.replace(/Left|Right/g, (m) => (m === "Left" ? "Right" : "Left"));
          names[b.getIndex()] = t;
        }
        aw = { names, idx: new Float32Array(bi), w: new Float32Array(bw) };
      }
    }
    return {
      aw,
      pos: pos.slice(from * 3, (from + k) * 3),
      nrm: nrm.slice(from * 3, (from + k) * 3),
      uv: uv ? new Float32Array(uv) : null,
      idx: Uint32Array.from(mesh.getIndices()!),
      material: mesh.material as PBRMaterial,
    };
  });
  return { ...parts[0], parts, joints: J, height: H };
}

/** distance from p to the segment ab */
function segDist(p: Vector3, a: Vector3, b: Vector3) {
  const ab = b.subtract(a);
  const t = Math.max(0, Math.min(1, Vector3.Dot(p.subtract(a), ab) / Math.max(1e-8, ab.lengthSquared())));
  return Vector3.Distance(p, a.add(ab.scale(t)));
}

/** skin weights: up to four bones per vertex, by distance, fenced by side and region */
function weigh(m: Measured | (Part & { joints: Record<string, Vector3>; height: number }), boneIndex: Record<string, number>) {
  const J = m.joints, H = m.height;
  const n = m.pos.length / 3;
  const idx = new Float32Array(n * 4), wts = new Float32Array(n * 4);
  const crotch = J.LeftUpLeg.y;
  const p = new Vector3();
  for (let i = 0; i < n; i++) {
    p.set(m.pos[i * 3], m.pos[i * 3 + 1], m.pos[i * 3 + 2]);
    const s = p.x >= 0 ? "Right" : "Left";
    const other = s === "Right" ? "Left" : "Right";
    const cands: { b: string; d: number }[] = [];
    const legZone = p.y < crotch + 0.03 * H && Math.abs(p.x) < 0.17 * H;
    for (const [b, c] of SEG) {
      if (b.startsWith(other)) continue;
      const leg = /UpLeg|Leg|Foot|Toe/.test(b);
      const arm = /Shoulder|Arm|Hand/.test(b);
      if (leg && !legZone) continue;
      if (arm && legZone && p.y < crotch - 0.04 * H) continue;
      // the head is rigid: only the head (and the neck at its base)
      if (p.y > J.Head.y + 0.02 * H && Math.abs(p.x) < 0.1 * H && b !== "Head") continue;
      cands.push({ b, d: segDist(p, J[b], J[c]) });
    }
    cands.sort((x, y) => x.d - y.d);
    const top = cands.slice(0, 4);
    let sum = 0;
    const w = top.map((c) => {
      const v = 1 / Math.pow(c.d + 0.008 * H, 4);
      sum += v;
      return v;
    });
    // (tiny weights are noise: drop them and renormalise)
    let kept = 0;
    for (let k = 0; k < top.length; k++) {
      const v = w[k] / sum;
      if (v < 0.04) continue;
      idx[i * 4 + kept] = boneIndex[top[k].b];
      wts[i * 4 + kept] = v;
      kept++;
    }
    let s2 = 0;
    for (let k = 0; k < 4; k++) s2 += wts[i * 4 + k];
    for (let k = 0; k < 4; k++) wts[i * 4 + k] /= s2 || 1;
  }
  return { idx, wts };
}

/** the artist's weights moved onto our bones ("torso" spread along the spine by height), four per vertex */
function weighArtist(part: Part, J: Record<string, Vector3>, boneIndex: Record<string, number>) {
  const aw = part.aw!;
  const n = part.pos.length / 3;
  const idx = new Float32Array(n * 4), wts = new Float32Array(n * 4);
  const chain = ["Hips", "Spine", "Spine1", "Spine2", "Neck", "Head"];
  const acc = new Map<string, number>();
  for (let i = 0; i < n; i++) {
    acc.clear();
    const y = part.pos[i * 3 + 1];
    const add = (b: string, w: number) => acc.set(b, (acc.get(b) ?? 0) + w);
    for (let k = 0; k < 4; k++) {
      const w = aw.w[i * 4 + k];
      if (w <= 0) continue;
      const t = aw.names[aw.idx[i * 4 + k]];
      if (t === "torso") {
        // between the two spine joints this height falls between
        let j = 0;
        while (j < chain.length - 1 && y > J[chain[j + 1]].y) j++;
        if (j >= chain.length - 1) add("Head", w);
        else {
          const a = J[chain[j]].y, b = J[chain[j + 1]].y;
          const u = Math.max(0, Math.min(1, (y - a) / Math.max(1e-4, b - a)));
          add(chain[j], w * (1 - u));
          add(chain[j + 1], w * u);
        }
      } else if (t && t.includes("|")) {
        // "A|B": A above A's joint, B below the top of B, blended between (a hip: pelvis → thigh)
        const [A, B] = t.split("|");
        const hi = J[A].y, lo = J[B].y - 0.03 * (J.HeadTop_End.y || 1.8);
        const u = Math.max(0, Math.min(1, (y - lo) / Math.max(1e-4, hi - lo)));
        add(A, w * u);
        add(B, w * (1 - u));
      } else if (t && boneIndex[t] !== undefined) add(t, w);
      else add("Hips", w);
    }
    const top = [...acc.entries()].sort((a, b) => b[1] - a[1]).slice(0, 4);
    const sum = top.reduce((s, e) => s + e[1], 0) || 1;
    top.forEach(([b, w], k) => {
      idx[i * 4 + k] = boneIndex[b];
      wts[i * 4 + k] = w / sum;
    });
    if (!top.length) {
      idx[i * 4] = boneIndex.Hips;
      wts[i * 4] = 1;
    }
  }
  return { idx, wts };
}

export class SpiderModel {
  private constructor(
    private scene: Scene,
    private m: Measured,
    private material: PBRMaterial,
  ) {}

  /**
   * Load and rig a static hero mesh. Spider-Man by default; Iron Man passes his own file, `auto`
   * landmarks (his proportions are his own) and keeps his armour's metal.
   */
  static async load(scene: Scene, url: string, opts: { auto?: boolean; height?: number; bulk?: Bulk; tune?: (m: PBRMaterial) => void; artist?: ArtistSkin } = {}) {
    const c = await LoadAssetContainerAsync(url, scene, { pluginExtension: extFor(url) });
    const meshes = c.meshes.filter((x) => x.getTotalVertices() > 0);
    const mesh = meshes[0];
    const mat = mesh.material as PBRMaterial;
    for (const x of meshes) if (x !== mesh && x.material instanceof PBRMaterial) opts.tune?.(x.material);
    if (opts.tune) opts.tune(mat);
    else {
      // lit, so he shades like everyone else (the suit's own texture, untouched)
      mat.unlit = false;
      mat.metallic = 0;
      mat.roughness = 0.62;
      mat.maxSimultaneousLights = 4;
      mat.environmentIntensity = 1.1;
      mat.albedoColor = new Color3(1, 1, 1);
    }
    const m = measure(meshes, !!opts.auto, opts.height, opts.bulk, opts.artist);
    // (the loaded mesh was only measured: the rigged copy is built from it; keep the material)
    c.addAllToScene();
    for (const x of c.meshes) x.setEnabled(false);
    return new SpiderModel(scene, m, mat);
  }

  spawn() {
    return new SpiderRig(this.scene, this.m, this.material);
  }
}

/** one rigged Spider-Man: a root to place and turn, bones to pose */
export class SpiderRig {
  /** placed and oriented by the controller (any orientation: walls, flips) */
  readonly anchor: TransformNode;
  readonly mesh: Mesh;
  readonly height: number;
  /** pelvis height standing (m) */
  readonly hipH: number;
  private nodes: Record<string, TransformNode> = {};
  private rest = new Map<TransformNode, { q: Quaternion; p: Vector3 }>();
  private model: TransformNode;
  private ax = { r: new Vector3(), u: new Vector3(), f: new Vector3() };

  constructor(scene: Scene, m: Measured, material: PBRMaterial) {
    this.height = m.height;
    this.anchor = new TransformNode("spidey", scene);
    this.anchor.rotationQuaternion = new Quaternion();
    this.model = new TransformNode("spideyModel", scene);
    this.model.parent = this.anchor;
    // skeleton (bind pose: no rotations, joints where we measured them)
    const skel = new Skeleton("spideySkel", "spideySkel", scene);
    const bones: Record<string, Bone> = {};
    const boneIndex: Record<string, number> = {};
    const names = Object.keys(PARENT);
    for (const name of names) {
      const par = PARENT[name];
      const local = par ? m.joints[name].subtract(m.joints[par]) : m.joints[name].clone();
      const bone = new Bone(name, skel, par ? bones[par] : null, Matrix.Translation(local.x, local.y, local.z));
      bones[name] = bone;
      boneIndex[name] = skel.bones.indexOf(bone);
      const tn = new TransformNode("sp_" + name, scene);
      tn.parent = par ? this.nodes[par] : this.model;
      tn.position.copyFrom(local);
      tn.rotationQuaternion = new Quaternion();
      this.nodes[name] = tn;
      bone.linkTransformNode(tn);
    }
    const made = m.parts.map((part, k) => {
      const { idx, wts } = part.aw ? weighArtist(part, m.joints, boneIndex) : weigh({ ...part, joints: m.joints, height: m.height }, boneIndex);
      const mesh = new Mesh("heroBody" + k, scene);
      const vd = new VertexData();
      vd.positions = part.pos;
      vd.normals = part.nrm;
      if (part.uv) vd.uvs = part.uv;
      vd.indices = part.idx;
      vd.matricesIndices = idx;
      vd.matricesWeights = wts;
      vd.applyToMesh(mesh);
      mesh.numBoneInfluencers = 4;
      mesh.skeleton = skel;
      mesh.material = k === 0 ? material : part.material;
      mesh.parent = this.model;
      mesh.isPickable = false;
      mesh.alwaysSelectAsActiveMesh = true;
      mesh.receiveShadows = true;
      return mesh;
    });
    this.mesh = made[0];
    this.allMeshes = made;
    for (const tn of Object.values(this.nodes)) this.rest.set(tn, { q: tn.rotationQuaternion!.clone(), p: tn.position.clone() });
    this.hipH = m.joints.Hips.y;
  }

  node(name: string) {
    return this.nodes[name];
  }
  private allMeshes: Mesh[] = [];
  get meshes() {
    return this.allMeshes.length ? this.allMeshes : [this.mesh];
  }
  /** world position of a joint */
  at(name: string, out = new Vector3()) {
    return worldPos(this.nodes[name], out);
  }

  /**
   * Pose: each pair's bone turned to its direction (body frame: x his right, y up, z forward — the
   * anchor's own axes), parents first, with the pelvis at `hip` (body frame, metres from the
   * anchor, which sits at his feet).
   */
  pose(dirs: Dir[], hip: Vector3) {
    for (const [n, r] of this.rest) {
      n.rotationQuaternion!.copyFrom(r.q);
      n.position.copyFrom(r.p);
    }
    const A = forceWorld(this.anchor);
    Vector3.TransformNormalToRef(Vector3.RightReadOnly, A, this.ax.r).normalize();
    Vector3.TransformNormalToRef(Vector3.UpReadOnly, A, this.ax.u).normalize();
    Vector3.TransformNormalToRef(Vector3.Forward(), A, this.ax.f).normalize();
    // the pelvis: placed in the model's frame (which is the anchor's)
    this.nodes.Hips.position.copyFrom(hip);
    const w = new Vector3();
    PAIRS.forEach(([bone, child], k) => {
      const d = dirs[k];
      w.copyFrom(this.ax.r).scaleInPlace(d[0]).addInPlace(this.ax.u.scale(d[1])).addInPlace(this.ax.f.scale(d[2]));
      const n = this.nodes[bone], c = this.nodes[child];
      alignDir(n, worldPos(c).subtract(worldPos(n)), w, () => worldPos(c).subtract(worldPos(n)));
    });
    plantFeet(this.anchor, this.ax.u, (n) => this.nodes[n]);
  }

  setVisible(v: boolean) {
    this.anchor.setEnabled(v);
  }
}
