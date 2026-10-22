import { Matrix, Quaternion, Vector3 } from "@babylonjs/core/Maths/math.vector";
import { Space } from "@babylonjs/core/Maths/math.axis";
import { TransformNode } from "@babylonjs/core/Meshes/transformNode";

/**
 * Small, allocation-light pose toolkit used to drive skinned characters
 * procedurally (enemy soldiers, the grenade arms):
 *   - world-space direction alignment that works through reflected glTF
 *     hierarchies (the sense of rotation is verified once per node and cached)
 *   - analytic two-bone IK (shoulder/hip → elbow/knee → wrist/ankle) with a pole
 *   - frame alignment (point one bone axis somewhere, then twist a second axis)
 */

/** Recompute the world matrix of `n` and all its ancestors (top-down) and return it. */
export function forceWorld(n: TransformNode): Matrix {
  const chain = _chain;
  chain.length = 0;
  for (let c: TransformNode | null = n; c; c = c.parent as TransformNode | null) chain.push(c);
  for (let i = chain.length - 1; i >= 0; i--) chain[i].computeWorldMatrix(true);
  return n.getWorldMatrix();
}
const _chain: TransformNode[] = [];

export function worldPos(n: TransformNode, out = new Vector3()) {
  return forceWorld(n).getTranslationToRef(out);
}

/** World direction of a bone-local axis. */
export function worldAxis(n: TransformNode, local: Vector3, out = new Vector3()) {
  Vector3.TransformNormalToRef(local, forceWorld(n), out);
  return out.normalize();
}

const signCache = new WeakMap<TransformNode, number>();
const tA = new Vector3();
const tB = new Vector3();
const tAx = new Vector3();
const tq = new Quaternion();

/**
 * Rotate `node` in world space so that the world direction `from` (something the
 * node carries, e.g. bone → child) turns into `to`.
 * `measure` returns the carried direction after the rotation — used once to learn
 * whether the node's parent chain is mirrored (glTF handedness) and the angle must be negated.
 */
export function alignDir(node: TransformNode, from: Vector3, to: Vector3, measure: () => Vector3, weight = 1) {
  const f = from.normalizeToRef(tA);
  const t = to.normalizeToRef(tB);
  Vector3.CrossToRef(f, t, tAx);
  const sin = tAx.length();
  const cos = Vector3.Dot(f, t);
  if (sin < 1e-6 && cos > 0) return;
  let ang = Math.atan2(sin, cos) * weight;
  if (sin < 1e-6) {
    // 180°: any perpendicular axis
    tAx.copyFrom(Math.abs(f.y) < 0.9 ? Vector3.UpReadOnly : Vector3.RightReadOnly);
    Vector3.CrossToRef(f, tAx, tAx);
  }
  tAx.normalize();
  if (!node.rotationQuaternion) node.rotationQuaternion = Quaternion.FromEulerVector(node.rotation);
  let sign = signCache.get(node);
  if (sign === undefined) {
    // mirrored parent chain ⇒ Babylon's world-space rotate turns the other way
    const p = node.parent as TransformNode | null;
    const guess = p && forceWorld(p).determinant() < 0 ? -1 : 1;
    if (Math.abs(ang) < 0.3 || weight < 1) {
      sign = guess; // too small to verify reliably — use the determinant, don't cache
    } else {
      tq.copyFrom(node.rotationQuaternion);
      node.rotate(tAx, ang * guess, Space.WORLD);
      const got = measure().normalize();
      if (Vector3.Dot(got, t) > 0.99) {
        signCache.set(node, guess);
        return;
      }
      node.rotationQuaternion.copyFrom(tq);
      sign = -guess;
      signCache.set(node, sign);
    }
  }
  ang *= sign;
  node.rotate(tAx, ang, Space.WORLD);
}

const vS = new Vector3();
const vE = new Vector3();
const vW = new Vector3();
const vDir = new Vector3();
const vPole = new Vector3();
const vE2 = new Vector3();
const vTmp = new Vector3();
const vTmp2 = new Vector3();

/**
 * Two-bone IK: rotates `a` (shoulder/hip) and `b` (elbow/knee) so that `c`
 * (wrist/ankle) reaches `target` (world), bending towards `pole` (world point).
 */
export function twoBone(a: TransformNode, b: TransformNode, c: TransformNode, target: Vector3, pole: Vector3, weight = 1) {
  worldPos(a, vS);
  worldPos(b, vE);
  worldPos(c, vW);
  const l1 = Vector3.Distance(vS, vE);
  const l2 = Vector3.Distance(vE, vW);
  target.subtractToRef(vS, vDir);
  const dist = vDir.length();
  const d = Math.min(Math.max(dist, Math.abs(l1 - l2) + 1e-3), l1 + l2 - 1e-4);
  vDir.scaleInPlace(1 / Math.max(1e-6, dist));
  const along = (l1 * l1 - l2 * l2 + d * d) / (2 * d);
  const h = Math.sqrt(Math.max(0, l1 * l1 - along * along));
  pole.subtractToRef(vS, vPole);
  vPole.subtractInPlace(vTmp.copyFrom(vDir).scaleInPlace(Vector3.Dot(vPole, vDir)));
  if (vPole.lengthSquared() < 1e-8) vPole.copyFrom(Vector3.DownReadOnly);
  vPole.normalize();
  vE2.copyFrom(vS).addInPlace(vTmp.copyFrom(vDir).scaleInPlace(along)).addInPlace(vTmp2.copyFrom(vPole).scaleInPlace(h));
  alignDir(a, vE.subtractInPlace(vS), vTmp.copyFrom(vE2).subtractInPlace(vS), () => worldPos(b, vTmp2).subtractInPlace(worldPos(a, vTmp)), weight);
  worldPos(b, vE);
  // wrist goal on the reachable sphere
  vTmp2.copyFrom(vS).addInPlace(vDir.scaleInPlace(d));
  worldPos(c, vW);
  alignDir(b, vW.subtractInPlace(vE), vTmp2.subtractInPlace(vE), () => worldPos(c, vTmp).subtractInPlace(worldPos(b, vTmp2)), weight);
}

const fA = new Vector3();
const fB = new Vector3();
const fW = new Vector3();
/**
 * Orient `node` so its local axis `la` points along world `wa`, then twist about
 * `wa` so local axis `lb` matches world `wb` (projected).
 */
export function alignFrame(node: TransformNode, la: Vector3, lb: Vector3, wa: Vector3, wb: Vector3, weight = 1) {
  worldAxis(node, la, fA);
  alignDir(node, fA, wa, () => worldAxis(node, la, fW), weight);
  const n = fB.copyFrom(wa).normalize();
  const cur = worldAxis(node, lb, fA);
  cur.subtractInPlace(vTmp.copyFrom(n).scaleInPlace(Vector3.Dot(cur, n)));
  const want = vTmp2.copyFrom(wb);
  want.subtractInPlace(vTmp.copyFrom(n).scaleInPlace(Vector3.Dot(want, n)));
  if (cur.lengthSquared() < 1e-8 || want.lengthSquared() < 1e-8) return;
  alignDir(
    node,
    cur,
    want,
    () => {
      const c = worldAxis(node, lb, fW);
      return c.subtractInPlace(vTmp.copyFrom(n).scaleInPlace(Vector3.Dot(c, n)));
    },
    weight,
  );
}

/** Bone-local vector corresponding to a world direction (at the bone's current pose). */
export function toLocalDir(node: TransformNode, worldDir: Vector3, out = new Vector3()) {
  const inv = forceWorld(node).clone().invert();
  Vector3.TransformNormalToRef(worldDir, inv, out);
  return out.normalize();
}

/**
 * Feet never through the floor: with the body upright, if a toe, a foot or a knee has ended up
 * below the anchor's ground plane (a deep landing crouch, a kneel), the whole body is lifted by it.
 */
export function plantFeet(anchor: TransformNode, up: Vector3, node: (n: string) => TransformNode | undefined, pos: (n: TransformNode) => Vector3 = (n) => worldPos(n)) {
  if (up.y < 0.75) return;
  const base = anchor.position;
  let low = 0;
  for (const n of ["LeftToeBase", "RightToeBase", "LeftToe_End", "RightToe_End", "LeftFoot", "RightFoot", "LeftLeg", "RightLeg"]) {
    const t = node(n);
    if (!t) continue;
    const d = Vector3.Dot(pos(t).subtract(base), up) - (/Leg$/.test(n) ? 0.07 : /Foot$/.test(n) ? 0.06 : 0.015);
    if (d < low) low = d;
  }
  if (low < -0.005) {
    anchor.position.addInPlace(up.scale(-low));
    anchor.computeWorldMatrix(true);
  }
}

