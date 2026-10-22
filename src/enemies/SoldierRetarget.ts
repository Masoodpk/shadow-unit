import { Matrix, Quaternion, Vector3 } from "@babylonjs/core/Maths/math.vector";
import { Node } from "@babylonjs/core/node";
import { TransformNode } from "@babylonjs/core/Meshes/transformNode";
import type { AnimSet, Clip, ClipKey } from "./SoldierAnim";
import { findIn } from "./SoldierSkin";

/**
 * The soldiers' mocap (recorded on the FSB operator's rig) played on another soldier's skeleton:
 * every clip, frame by frame, turned into that rig's own local rotations — once, when the stage
 * loads. Limbs and spine follow the FSB bones' directions (so a rig whose rest pose is different —
 * the Polish soldier's arms already up on his rifle, the A-posed Winter Soldier — still ends up in
 * the same pose), with their twist carried over; the hips and the head follow the FSB's rotation.
 * The result is an ordinary AnimSet: the soldier code can't tell it from the recorded ones.
 */

/** one bone of the target: which FSB bone(s) it follows */
export interface RetargetBone {
  /** the target's bone (model name, as findIn takes it) */
  dst: string;
  /** the FSB bone it plays */
  src: string;
  /** a segment to point along (src child → dst child); none: the FSB bone's turn is copied */
  srcTo?: string;
  dstTo?: string;
}

const S = 1 / 32767;

function rotOf(m: Matrix, out = new Matrix()) {
  // (the rotation of a world matrix, scale taken out)
  const s = new Vector3(), q = new Quaternion(), t = new Vector3();
  m.decompose(s, q, t);
  Matrix.FromQuaternionToRef(q, out);
  return out;
}
/** rows = the axes: (dir, sec, dir × sec), orthonormal */
function frame(dir: Vector3, sec: Vector3, out: Matrix) {
  const d = dir.normalizeToNew();
  let s = sec.subtract(d.scale(Vector3.Dot(sec, d)));
  if (s.lengthSquared() < 1e-6) s = Math.abs(d.y) < 0.9 ? new Vector3(0, 1, 0) : new Vector3(1, 0, 0);
  s = s.subtract(d.scale(Vector3.Dot(s, d))).normalize();
  const c = Vector3.Cross(d, s);
  Matrix.FromXYZAxesToRef(d, s, c, out);
  return out;
}

export function retargetSoldierAnims(src: AnimSet, srcNodes: Node[], dstNodes: Node[], bones: RetargetBone[], dstHips: string): AnimSet {
  const get = (nodes: Node[], name: string) => {
    const n = findIn(nodes, name);
    if (!n) throw new Error("retarget: missing bone " + name);
    if (!n.rotationQuaternion) n.rotationQuaternion = Quaternion.FromEulerVector(n.rotation);
    return n;
  };
  // the FSB side: its animated bones (parents first, as the clips list them)
  const sBones = src.bones.map((n) => get(srcNodes, n));
  const sRestQ = sBones.map((n) => n.rotationQuaternion!.clone());
  const sHips = get(srcNodes, src.hips);
  const sHipsRest = sHips.position.clone();
  const sBase = sHips.parent as TransformNode;
  // the target side: every node between its hips' parent and the bones it moves
  const dHips = get(dstNodes, dstHips);
  const dBase = dHips.parent as TransformNode;
  const dMapped = bones.map((b) => ({ ...b, n: get(dstNodes, b.dst), s: get(srcNodes, b.src), sTo: b.srcTo ? get(srcNodes, b.srcTo) : null, dTo: b.dstTo ? get(dstNodes, b.dstTo) : null }));
  const order: TransformNode[] = [];
  {
    const seen = new Set<TransformNode>();
    for (const b of dMapped)
      for (const end of [b.n, b.dTo].filter((x): x is TransformNode => !!x)) {
        const chain: TransformNode[] = [];
        for (let n: TransformNode | null = end; n && n !== dBase; n = n.parent as TransformNode | null) chain.push(n);
        for (let i = chain.length - 1; i >= 0; i--) if (!seen.has(chain[i])) (seen.add(chain[i]), order.push(chain[i]));
      }
  }
  const dRestLocal = new Map(order.map((n) => [n, rotOf(Matrix.Compose(Vector3.One(), n.rotationQuaternion ?? Quaternion.FromEulerVector(n.rotation), Vector3.Zero()))]));
  const byNode = new Map(dMapped.map((b) => [b.n, b]));

  // world matrices (both templates stand at the origin facing +Z: the scene's frame is the one frame
  // both rigs agree on — their own roots are turned every which way, Z-up exports and all)
  // (measured under each file's own root: the loader's root mirrors Z, and a rotation taken out of a
  // mirrored matrix comes out conjugated — under the root, both rigs are plain glTF, facing +Z)
  const top = (n: Node) => {
    let c = n;
    while (c.parent) c = c.parent;
    return c as TransformNode;
  };
  const rootOf = new Map<TransformNode, Matrix>();
  const rel = (n: TransformNode, base: TransformNode) => {
    const r = top(base);
    let inv = rootOf.get(r);
    if (!inv) rootOf.set(r, (inv = Matrix.Invert(r.computeWorldMatrix(true))));
    return n.computeWorldMatrix(true).multiply(inv);
  };
  const pos = (n: TransformNode, base: TransformNode) => rel(n, base).getTranslation();
  const forceS = () => {
    for (const n of sBones) n.computeWorldMatrix(true);
  };
  // ---- the rest poses: directions, frames, rotations
  forceS();
  for (const n of order) n.computeWorldMatrix(true);
  const FWD = new Vector3(0, 0, 1);
  const rest = dMapped.map((b) => {
    const sW = rotOf(rel(b.s, sBase));
    const dW = rotOf(rel(b.n, dBase));
    let secLocal = new Vector3();
    const dF = new Matrix();
    if (b.sTo && b.dTo) {
      const dDir = pos(b.dTo, dBase).subtract(pos(b.n, dBase)).normalize();
      // the twist reference: "forward", carried in the FSB bone's own frame
      secLocal = Vector3.TransformNormal(FWD, Matrix.Invert(sW));
      frame(dDir, FWD, dF);
    }
    return { sW, dW, secLocal, dF };
  });
  const sHipH = pos(sHips, sBase).y, dHipH = pos(dHips, dBase).y;
  // (k: the hips' move from the FSB's file units to the target's; kM: in metres, for speeds and root motion)
  const k = dHipH / Math.max(1e-4, sHipH);
  const kM = dHips.computeWorldMatrix(true).getTranslation().y / Math.max(1e-4, sHips.computeWorldMatrix(true).getTranslation().y);
  const dHipsRest = dHips.position.clone();

  const baseW = rotOf(rel(dBase, dBase));
  const out: AnimSet = { bones: dMapped.map((b) => b.dst), hips: dstHips, clips: {} as Record<ClipKey, Clip> };
  const worldNow = new Map<TransformNode, Matrix>();
  const R = new Matrix(), F = new Matrix(), tmp = new Matrix();
  for (const key of Object.keys(src.clips) as ClipKey[]) {
    const c = src.clips[key];
    const nb = dMapped.length;
    const rot = new Int16Array(c.n * nb * 4);
    const hips = new Float32Array(c.n * 3);
    for (let f = 0; f < c.n; f++) {
      // the FSB rig in this frame
      for (let i = 0; i < sBones.length; i++) {
        const o = (f * sBones.length + i) * 4;
        sBones[i].rotationQuaternion!.set(c.rot[o] * S, c.rot[o + 1] * S, c.rot[o + 2] * S, c.rot[o + 3] * S);
      }
      sHips.position.set(c.hips[f * 3], c.hips[f * 3 + 1], c.hips[f * 3 + 2]);
      forceS();
      // the target, parents first
      worldNow.clear();
      for (const n of order) {
        const parent = n.parent as TransformNode;
        const pW = parent === dBase ? baseW : worldNow.get(parent)!;
        const b = byNode.get(n);
        if (!b) {
          worldNow.set(n, dRestLocal.get(n)!.multiply(pW));
          continue;
        }
        const r = rest[dMapped.indexOf(b)];
        const sNow = rotOf(rel(b.s, sBase));
        let W: Matrix;
        if (b.sTo && b.dTo) {
          // point the segment the way the FSB's points, turned about it as the FSB's is
          const dir = pos(b.sTo, sBase).subtract(pos(b.s, sBase)).normalize();
          const sec = Vector3.TransformNormal(r.secLocal, sNow);
          frame(dir, sec, F);
          // rest-frame → now-frame (row vectors: x·dFᵀ = axes coordinates, ·F = now)
          r.dF.transposeToRef(tmp);
          tmp.multiplyToRef(F, R);
          // (the twist reference was "forward" at rest on both: what the FSB adds to it, the target gets)
          W = r.dW.multiply(R);
        } else {
          // the FSB bone's turn since rest, on the target's rest
          W = r.dW.multiply(Matrix.Invert(r.sW).multiply(sNow));
        }
        worldNow.set(n, W);
        // its local rotation: world · parent⁻¹
        const L = W.multiply(Matrix.Invert(pW));
        const q = Quaternion.FromRotationMatrix(L);
        q.normalize();
        const o = (f * nb + dMapped.indexOf(b)) * 4;
        rot[o] = Math.round(q.x * 32767);
        rot[o + 1] = Math.round(q.y * 32767);
        rot[o + 2] = Math.round(q.z * 32767);
        rot[o + 3] = Math.round(q.w * 32767);
      }
      // the hips: the FSB's move from its rest, scaled to the target's leg length, in the target's frame
      const dS = sHips.position.subtract(sHipsRest);
      const sP = sHips.parent as TransformNode, dP = dHips.parent as TransformNode;
      const world = Vector3.TransformNormal(dS, rel(sP, sBase)).scale(k);
      const local = Vector3.TransformNormal(world, Matrix.Invert(rel(dP, dBase)));
      hips[f * 3] = dHipsRest.x + local.x;
      hips[f * 3 + 1] = dHipsRest.y + local.y;
      hips[f * 3 + 2] = dHipsRest.z + local.z;
    }
    // (a taller rig covers more ground per stride: the recorded speed scales with it)
    out.clips[key] = { ...c, rot, hips, speed: c.speed * kM, root: c.root ? c.root.map((v) => v * kM) : undefined };
  }
  // the FSB template back at rest
  sBones.forEach((n, i) => n.rotationQuaternion!.copyFrom(sRestQ[i]));
  sHips.position.copyFrom(sHipsRest);
  for (const n of sBones) n.computeWorldMatrix(true);
  return out;
}

/** a rig's bones by role, for the table below */
export interface RetargetNames {
  hips: string;
  /** the low spine (optional: some rigs go straight from the hips to the chest) */
  spine?: string;
  chest: string;
  neck: string;
  head: string;
  L: { clav?: string; up: string; fore: string; hand: string; mid: string };
  R: { clav?: string; up: string; fore: string; hand: string; mid: string };
  LL: { thigh: string; calf: string; foot: string; toe: string };
  RL: { thigh: string; calf: string; foot: string; toe: string };
}
/** which FSB bone each of a rig's bones plays (the FSB rig is Mixamo-named) */
export function retargetTable(n: RetargetNames): RetargetBone[] {
  const M = (b: string) => "mixamorig:" + b;
  const t: RetargetBone[] = [{ src: M("Hips"), dst: n.hips }];
  if (n.spine) t.push({ src: M("Spine"), srcTo: M("Spine2"), dst: n.spine, dstTo: n.chest });
  t.push({ src: M("Spine2"), srcTo: M("Neck"), dst: n.chest, dstTo: n.neck });
  t.push({ src: M("Neck"), srcTo: M("Head"), dst: n.neck, dstTo: n.head });
  t.push({ src: M("Head"), dst: n.head });
  for (const S of ["L", "R"] as const) {
    const a = n[S], l = n[(S + "L") as "LL" | "RL"], F = S === "L" ? "Left" : "Right";
    if (a.clav) t.push({ src: M(F + "Shoulder"), srcTo: M(F + "Arm"), dst: a.clav, dstTo: a.up });
    t.push({ src: M(F + "Arm"), srcTo: M(F + "ForeArm"), dst: a.up, dstTo: a.fore });
    t.push({ src: M(F + "ForeArm"), srcTo: M(F + "Hand"), dst: a.fore, dstTo: a.hand });
    t.push({ src: M(F + "Hand"), srcTo: M(F + "HandMiddle1"), dst: a.hand, dstTo: a.mid });
    t.push({ src: M(F + "UpLeg"), srcTo: M(F + "Leg"), dst: l.thigh, dstTo: l.calf });
    t.push({ src: M(F + "Leg"), srcTo: M(F + "Foot"), dst: l.calf, dstTo: l.foot });
    t.push({ src: M(F + "Foot"), srcTo: M(F + "ToeBase"), dst: l.foot, dstTo: l.toe });
  }
  return t;
}
