import { Matrix, Quaternion, Vector3 } from "@babylonjs/core/Maths/math.vector";
import { TransformNode } from "@babylonjs/core/Meshes/transformNode";

/**
 * Fast procedural posing for skinned characters.
 *
 * Babylon nodes are only read once (rest pose, base world matrix) and written
 * once per frame (final local rotations). All the solving in between happens on
 * a private copy of the bone chain with our own world-matrix cache, so a whole
 * soldier (hips, spine, head, two-bone IK on four limbs, hands, feet) costs a
 * few hundred small matrix multiplies instead of thousands of scene-graph
 * recomputations.
 *
 * Rotations are applied like TransformNode.rotate(axis, angle, WORLD): the world
 * axis is mapped into the parent's space and pre-multiplied onto the local
 * quaternion. Mirrored parents (glTF handedness) flip the sense of rotation,
 * which is handled from the parent's determinant.
 */
export class PoseRig {
  private nodes: TransformNode[] = [];
  private parent: number[] = [];
  private restP: Vector3[] = [];
  private restQ: Quaternion[] = [];
  private scl: Vector3[] = [];
  private q: Quaternion[] = [];
  private p: Vector3[] = [];
  private local: Matrix[] = [];
  private world: Matrix[] = [];
  private dirtyFrom = 0;
  private index = new Map<TransformNode, number>();
  /** world matrix of the base (the first bone's parent), refreshed by begin() */
  private base = new Matrix();
  private baseNode: TransformNode;

  /**
   * @param base node whose world matrix is the frame everything hangs off (the hips' parent)
   * @param ends bones to reach (hands, feet, head…); every ancestor up to `base` is included
   */
  constructor(base: TransformNode, ends: TransformNode[]) {
    this.baseNode = base;
    const order: TransformNode[] = [];
    const seen = new Set<TransformNode>();
    for (const e of ends) {
      const chain: TransformNode[] = [];
      for (let n: TransformNode | null = e; n && n !== base; n = n.parent as TransformNode | null) chain.push(n);
      for (let i = chain.length - 1; i >= 0; i--) {
        if (seen.has(chain[i])) continue;
        seen.add(chain[i]);
        order.push(chain[i]);
      }
    }
    order.forEach((n, i) => this.index.set(n, i));
    for (const n of order) {
      if (!n.rotationQuaternion) n.rotationQuaternion = Quaternion.FromEulerVector(n.rotation);
      this.nodes.push(n);
      this.parent.push(n.parent === base ? -1 : this.index.get(n.parent as TransformNode)!);
      this.restP.push(n.position.clone());
      this.restQ.push(n.rotationQuaternion.clone());
      this.scl.push(n.scaling.clone());
      this.q.push(n.rotationQuaternion.clone());
      this.p.push(n.position.clone());
      this.local.push(new Matrix());
      this.world.push(new Matrix());
    }
  }

  has(n: TransformNode) {
    return this.index.has(n);
  }
  private i(n: TransformNode) {
    return this.index.get(n)!;
  }

  /** Reset to the rest pose and read the base frame for this update. */
  begin() {
    const chain: TransformNode[] = [];
    for (let c: TransformNode | null = this.baseNode; c; c = c.parent as TransformNode | null) chain.push(c);
    for (let k = chain.length - 1; k >= 0; k--) chain[k].computeWorldMatrix(true);
    this.base.copyFrom(this.baseNode.getWorldMatrix());
    for (let k = 0; k < this.nodes.length; k++) {
      this.q[k].copyFrom(this.restQ[k]);
      this.p[k].copyFrom(this.restP[k]);
    }
    this.dirtyFrom = 0;
  }

  /** Bring cached world matrices up to date (only from the earliest changed bone on). */
  private update(limit = this.nodes.length) {
    // bones are stored parents-first, so bringing indices < limit up to date is enough for bone limit-1
    for (let k = this.dirtyFrom; k < limit; k++) {
      Matrix.ComposeToRef(this.scl[k], this.q[k], this.p[k], this.local[k]);
      const par = this.parent[k];
      this.local[k].multiplyToRef(par < 0 ? this.base : this.world[par], this.world[k]);
    }
    if (limit > this.dirtyFrom) this.dirtyFrom = limit;
  }
  private touch(k: number) {
    if (k < this.dirtyFrom) this.dirtyFrom = k;
  }
  private parentWorld(k: number) {
    const par = this.parent[k];
    return par < 0 ? this.base : this.world[par];
  }

  worldMatrix(n: TransformNode) {
    const k = this.i(n);
    this.update(k + 1);
    return this.world[k];
  }
  worldPos(n: TransformNode, out = new Vector3()) {
    return this.worldMatrix(n).getTranslationToRef(out);
  }
  worldAxis(n: TransformNode, local: Vector3, out = new Vector3()) {
    Vector3.TransformNormalToRef(local, this.worldMatrix(n), out);
    return out.normalize();
  }

  /** Place a bone's origin at a world position (e.g. the pelvis). */
  setWorldPos(n: TransformNode, pos: Vector3) {
    const k = this.i(n);
    this.update(k);
    const inv = this.mTmp.copyFrom(this.parentWorld(k));
    inv.invert();
    Vector3.TransformCoordinatesToRef(pos, inv, this.p[k]);
    this.touch(k);
  }

  private mTmp = new Matrix();
  private ax = new Vector3();
  private qa = new Quaternion();
  /** Rotate bone `n` by `angle` about a world axis. */
  rotateWorld(n: TransformNode, axisWorld: Vector3, angle: number) {
    const k = this.i(n);
    this.update(k);
    const pw = this.parentWorld(k);
    this.mTmp.copyFrom(pw).invert();
    Vector3.TransformNormalToRef(axisWorld, this.mTmp, this.ax);
    this.ax.normalize();
    const sign = pw.determinant() < 0 ? -1 : 1;
    Quaternion.RotationAxisToRef(this.ax, angle * sign, this.qa);
    this.qa.multiplyToRef(this.q[k], this.q[k]);
    this.touch(k);
  }

  private f = new Vector3();
  private t = new Vector3();
  private c = new Vector3();
  /** Rotate `n` so that world direction `from` turns into `to` (both carried by n). */
  alignDir(n: TransformNode, from: Vector3, to: Vector3, weight = 1) {
    from.normalizeToRef(this.f);
    to.normalizeToRef(this.t);
    Vector3.CrossToRef(this.f, this.t, this.c);
    const sin = this.c.length();
    const cos = Vector3.Dot(this.f, this.t);
    if (sin < 1e-6) {
      if (cos > 0) return;
      this.c.copyFrom(Math.abs(this.f.y) < 0.9 ? Vector3.UpReadOnly : Vector3.RightReadOnly);
      Vector3.CrossToRef(this.f, this.c, this.c);
    }
    this.c.normalize();
    this.rotateWorld(n, this.c, Math.atan2(sin, cos) * weight);
  }

  private a1 = new Vector3();
  private a2 = new Vector3();
  private a3 = new Vector3();
  private a4 = new Vector3();
  /** Local axis `la` → world `wa`, then twist about it so local `lb` → world `wb`. */
  alignFrame(n: TransformNode, la: Vector3, lb: Vector3, wa: Vector3, wb: Vector3, weight = 1) {
    this.alignDir(n, this.worldAxis(n, la, this.a1), wa, weight);
    const ax = this.a2.copyFrom(wa).normalize();
    const cur = this.worldAxis(n, lb, this.a1);
    cur.subtractInPlace(this.a3.copyFrom(ax).scaleInPlace(Vector3.Dot(cur, ax)));
    const want = this.a4.copyFrom(wb);
    want.subtractInPlace(this.a3.copyFrom(ax).scaleInPlace(Vector3.Dot(want, ax)));
    if (cur.lengthSquared() < 1e-8 || want.lengthSquared() < 1e-8) return;
    this.alignDir(n, cur, want, weight);
  }

  private s = new Vector3();
  private e = new Vector3();
  private w = new Vector3();
  private dir = new Vector3();
  private pole = new Vector3();
  private e2 = new Vector3();
  private tmp = new Vector3();
  /** Two-bone IK: a (shoulder/hip) → b (elbow/knee) → c (wrist/ankle) reaches `target`, bending toward `pole`. */
  twoBone(a: TransformNode, b: TransformNode, c: TransformNode, target: Vector3, pole: Vector3) {
    this.worldPos(a, this.s);
    this.worldPos(b, this.e);
    this.worldPos(c, this.w);
    const l1 = Vector3.Distance(this.s, this.e);
    const l2 = Vector3.Distance(this.e, this.w);
    target.subtractToRef(this.s, this.dir);
    const dist = this.dir.length();
    const d = Math.min(Math.max(dist, Math.abs(l1 - l2) + 1e-3), l1 + l2 - 1e-4);
    this.dir.scaleInPlace(1 / Math.max(1e-6, dist));
    const along = (l1 * l1 - l2 * l2 + d * d) / (2 * d);
    const h = Math.sqrt(Math.max(0, l1 * l1 - along * along));
    pole.subtractToRef(this.s, this.pole);
    this.pole.subtractInPlace(this.tmp.copyFrom(this.dir).scaleInPlace(Vector3.Dot(this.pole, this.dir)));
    if (this.pole.lengthSquared() < 1e-8) this.pole.copyFrom(Vector3.DownReadOnly);
    this.pole.normalize();
    this.e2.copyFrom(this.s).addInPlace(this.tmp.copyFrom(this.dir).scaleInPlace(along)).addInPlace(this.pole.scaleInPlace(h));
    this.alignDir(a, this.e.subtractInPlace(this.s), this.tmp.copyFrom(this.e2).subtractInPlace(this.s));
    this.worldPos(b, this.e);
    this.worldPos(c, this.w);
    this.s.addInPlace(this.dir.scaleInPlace(d)); // reachable wrist goal
    this.alignDir(b, this.w.subtractInPlace(this.e), this.s.subtractInPlace(this.e));
  }

  /** index of a bone in this rig (-1 if not part of it) */
  indexOf(n: TransformNode) {
    return this.index.get(n) ?? -1;
  }
  /** Set a bone's local rotation directly (sampled animation), by rig index. */
  setLocalRot(k: number, x: number, y: number, z: number, w: number) {
    this.q[k].set(x, y, z, w);
    this.touch(k);
  }
  setLocalPos(k: number, x: number, y: number, z: number) {
    this.p[k].set(x, y, z);
    this.touch(k);
  }
  /** Re-read the base frame without touching the local pose (after begin()+set*). */
  refreshBase() {
    const chain: TransformNode[] = [];
    for (let c: TransformNode | null = this.baseNode; c; c = c.parent as TransformNode | null) chain.push(c);
    for (let k = chain.length - 1; k >= 0; k--) chain[k].computeWorldMatrix(true);
    this.base.copyFrom(this.baseNode.getWorldMatrix());
    this.dirtyFrom = 0;
  }

  private snapQ: Quaternion[] = [];
  private snapP: Vector3[] = [];
  /** Remember the last committed pose (for cross-fading into another pose source). */
  snapshot() {
    this.snapQ = this.q.map((q) => q.clone());
    this.snapP = this.p.map((p) => p.clone());
  }
  /** Start a frame from the snapshot (instead of the rest pose); re-reads the base frame. */
  restoreSnapshot() {
    this.refreshBase();
    for (let k = 0; k < this.q.length; k++) {
      this.q[k].copyFrom(this.snapQ[k]);
      this.p[k].copyFrom(this.snapP[k]);
    }
    this.dirtyFrom = 0;
  }
  /** Re-snapshot the current (committed) pose. */
  get hasSnapshot() {
    return this.snapQ.length > 0;
  }

  /** Blend the current solve toward the snapshot: w = 1 → snapshot, 0 → current. */
  blendSnapshot(w: number) {
    if (w <= 0 || !this.snapQ.length) return;
    for (let k = 0; k < this.q.length; k++) {
      Quaternion.SlerpToRef(this.q[k], this.snapQ[k], w, this.q[k]);
      Vector3.LerpToRef(this.p[k], this.snapP[k], w, this.p[k]);
    }
    this.dirtyFrom = 0;
  }

  /** Write the solved pose into the Babylon nodes. */
  commit() {
    for (let k = 0; k < this.nodes.length; k++) {
      this.nodes[k].rotationQuaternion!.copyFrom(this.q[k]);
      this.nodes[k].position.copyFrom(this.p[k]);
    }
  }
}
