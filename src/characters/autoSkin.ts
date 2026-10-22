import { AssetContainer } from "@babylonjs/core/assetContainer";
import { Bone } from "@babylonjs/core/Bones/bone";
import { Skeleton } from "@babylonjs/core/Bones/skeleton";
import { VertexBuffer } from "@babylonjs/core/Buffers/buffer";
import { Matrix, Vector3 } from "@babylonjs/core/Maths/math.vector";
import { Mesh } from "@babylonjs/core/Meshes/mesh";
import { TransformNode } from "@babylonjs/core/Meshes/transformNode";

/**
 * A skeleton for a model that came without one (Ant-Man's file is four static meshes): a Mixamo-
 * named skeleton placed by the body's own proportions, and each vertex weighted to the two bones
 * nearest it (softly, so the joints bend rather than tear). "Nearest" is to each bone's surface,
 * not its centre line (a torso is far thicker than an arm hanging beside it: the side of a vest
 * belongs to the chest), and a small loose piece — a pouch, a magazine, a plate — moves whole with
 * the bone at its middle, so it never stretches between two. Done on the loaded file before the
 * rig is built, so the rest of the game sees an ordinary skinned character.
 *
 * Works in the meshes' own space (they share one parent). It reads the figure as standing up its
 * tallest axis, facing the way its feet point, arms down-and-out (an A- or T-pose) — what a
 * figure exported for rigging is in. Anything else and the rig check fails, honestly, on load.
 */
type J = { name: string; parent: string | null; at: Vector3 };
const SEG: [string, string][] = [
  ["Hips", "Spine"], ["Spine", "Spine1"], ["Spine1", "Spine2"], ["Spine2", "Neck"], ["Neck", "Head"], ["Head", "HeadTop_End"],
  ["LeftShoulder", "LeftArm"], ["LeftArm", "LeftForeArm"], ["LeftForeArm", "LeftHand"], ["LeftHand", "LeftHandMiddle1"],
  ["RightShoulder", "RightArm"], ["RightArm", "RightForeArm"], ["RightForeArm", "RightHand"], ["RightHand", "RightHandMiddle1"],
  ["LeftUpLeg", "LeftLeg"], ["LeftLeg", "LeftFoot"], ["LeftFoot", "LeftToeBase"],
  ["RightUpLeg", "RightLeg"], ["RightLeg", "RightFoot"], ["RightFoot", "RightToeBase"],
];
/** each vertex's piece: joined by a triangle, or welded where two vertices share a spot (a seam) */
function pieces(m: Mesh, pos: ArrayLike<number>) {
  const n = pos.length / 3;
  const par = new Int32Array(n);
  for (let i = 0; i < n; i++) par[i] = i;
  const find = (x: number) => {
    while (par[x] !== x) x = par[x] = par[par[x]];
    return x;
  };
  const join = (a: number, b: number) => {
    a = find(a);
    b = find(b);
    if (a !== b) par[b] = a;
  };
  const ix = m.getIndices();
  if (ix) for (let i = 0; i < ix.length; i += 3) (join(ix[i], ix[i + 1]), join(ix[i], ix[i + 2]));
  const seen = new Map<string, number>();
  for (let v = 0; v < n; v++) {
    const k = `${Math.round(pos[v * 3] * 1e4)},${Math.round(pos[v * 3 + 1] * 1e4)},${Math.round(pos[v * 3 + 2] * 1e4)}`;
    const o = seen.get(k);
    if (o === undefined) seen.set(k, v);
    else join(o, v);
  }
  const out = new Int32Array(n);
  for (let v = 0; v < n; v++) out[v] = find(v);
  return out;
}

function segDist(p: Vector3, a: Vector3, b: Vector3) {
  const ab = b.subtract(a);
  const t = Math.max(0, Math.min(1, Vector3.Dot(p.subtract(a), ab) / Math.max(1e-9, ab.lengthSquared())));
  return Vector3.Distance(p, a.add(ab.scale(t)));
}

/** `keep`: which meshes are the body (props in the file — a held rifle — are left out of the measuring and the skin) */
export function autoSkin(c: AssetContainer, keep: (m: Mesh) => boolean = () => true) {
  const meshes = c.meshes.filter((m): m is Mesh => m instanceof Mesh && m.getTotalVertices() > 0 && keep(m));
  if (!meshes.length || meshes.some((m) => m.skeleton)) return;
  const parent = meshes[0].parent as TransformNode;
  const scene = meshes[0].getScene();
  // every vertex, in the meshes' shared space
  const all: Vector3[] = [];
  for (const m of meshes) {
    const pos = m.getVerticesData(VertexBuffer.PositionKind)!;
    for (let i = 0; i < pos.length; i += 3) all.push(new Vector3(pos[i], pos[i + 1], pos[i + 2]));
  }
  // the axes: up the tallest; forward the way the feet stick out; side the third
  const lo = new Vector3(Infinity, Infinity, Infinity), hi = new Vector3(-Infinity, -Infinity, -Infinity);
  for (const p of all) {
    lo.minimizeInPlace(p);
    hi.maximizeInPlace(p);
  }
  const ext = hi.subtract(lo);
  const axes = ["x", "y", "z"] as const;
  const upA = axes.reduce((a, b) => (ext[b] > ext[a] ? b : a));
  const rest = axes.filter((a) => a !== upA);
  const H = ext[upA];
  const h = (p: Vector3) => (p[upA] - lo[upA]) / H;
  // (the feet: the low band — they reach out further forward than back; the arms reach out sideways)
  const feet = all.filter((p) => h(p) < 0.06);
  const mid = (a: (typeof axes)[number]) => (lo[a] + hi[a]) / 2;
  const spread = (pts: Vector3[], a: (typeof axes)[number]) => Math.max(...pts.map((p) => p[a])) - Math.min(...pts.map((p) => p[a]));
  const sideA = spread(all, rest[0]) > spread(all, rest[1]) ? rest[0] : rest[1];
  const fwdA = rest.find((a) => a !== sideA)!;
  const fc = feet.reduce((s, p) => s + p[fwdA], 0) / Math.max(1, feet.length);
  const fwdSign = Math.max(...feet.map((p) => p[fwdA])) - fc > fc - Math.min(...feet.map((p) => p[fwdA])) ? 1 : -1;
  const sc = mid(sideA);
  const P = (side: number, up: number, fwd: number) => {
    const v = new Vector3();
    v[sideA] = sc + side;
    v[upA] = lo[upA] + up * H;
    v[fwdA] = fwd;
    return v;
  };
  // the body's centre line front-to-back at a height (the torso's own middle there)
  const band = (f: number, w = 0.03, sideMax = H * 0.12) => all.filter((p) => Math.abs(h(p) - f) < w && Math.abs(p[sideA] - sc) < sideMax);
  const cOf = (pts: Vector3[], a: (typeof axes)[number]) => (pts.length ? pts.reduce((s, p) => s + p[a], 0) / pts.length : mid(a));
  const core = (f: number) => cOf(band(f), fwdA);
  // the hands: the vertices furthest out to each side (the arms hang out from the body)
  const latMax = Math.max(...all.map((p) => Math.abs(p[sideA] - sc)));
  // (left: the character's own — with up and forward as found, the side axis's sign that makes it so)
  const leftSign = (() => {
    const u = new Vector3(), f = new Vector3();
    u[upA] = 1;
    f[fwdA] = fwdSign;
    const l = Vector3.Cross(f, u);
    return Math.sign(l[sideA]) || 1;
  })();
  const joints: J[] = [];
  const add = (name: string, parentName: string | null, at: Vector3) => joints.push({ name, parent: parentName, at });
  add("Hips", null, P(0, 0.5, core(0.5)));
  add("Spine", "Hips", P(0, 0.58, core(0.58)));
  add("Spine1", "Spine", P(0, 0.66, core(0.66)));
  add("Spine2", "Spine1", P(0, 0.74, core(0.74)));
  add("Neck", "Spine2", P(0, 0.84, core(0.84)));
  add("Head", "Neck", P(0, 0.88, core(0.9)));
  add("HeadTop_End", "Head", P(0, 1, core(0.95)));
  for (const [S, sg] of [["Left", leftSign], ["Right", -leftSign]] as const) {
    const hand = all.filter((p) => (p[sideA] - sc) * sg > latMax * 0.86);
    const hc = hand.length ? hand.reduce((s, p) => s.addInPlace(p), new Vector3()).scale(1 / hand.length) : P(sg * latMax * 0.9, 0.5, core(0.5));
    const sh = P(sg * H * 0.115, 0.815, core(0.8));
    add(S + "Shoulder", "Spine2", P(sg * H * 0.03, 0.8, core(0.8)));
    add(S + "Arm", S + "Shoulder", sh);
    const arm = hc.subtract(sh);
    add(S + "ForeArm", S + "Arm", sh.add(arm.scale(0.47)));
    add(S + "Hand", S + "ForeArm", sh.add(arm.scale(0.86)));
    add(S + "HandMiddle1", S + "Hand", sh.add(arm.scale(1.04)));
    // the legs: each one's middle in its own half, at each height
    const legC = (f: number) => {
      const pts = all.filter((p) => Math.abs(h(p) - f) < 0.03 && (p[sideA] - sc) * sg > 0 && Math.abs(p[sideA] - sc) < H * 0.16);
      return pts.length ? { s: cOf(pts, sideA) - sc, f: cOf(pts, fwdA) } : { s: sg * H * 0.06, f: core(f) };
    };
    const hip = legC(0.47), knee = legC(0.27), ank = legC(0.06);
    add(S + "UpLeg", "Hips", P(hip.s, 0.48, hip.f));
    add(S + "Leg", S + "UpLeg", P(knee.s, 0.27, knee.f));
    add(S + "Foot", S + "Leg", P(ank.s, 0.05, ank.f));
    add(S + "ToeBase", S + "Foot", P(ank.s, 0.012, ank.f + fwdSign * H * 0.075));
  }
  // the nodes (the rig moves these) and the skeleton's bones on them
  const byName = new Map<string, J>(joints.map((j) => [j.name, j]));
  const nodes = new Map<string, TransformNode>();
  const skel = new Skeleton("autoSkel", "autoSkel", scene);
  const bones = new Map<string, Bone>();
  for (const j of joints) {
    const pj = j.parent ? byName.get(j.parent)! : null;
    const local = pj ? j.at.subtract(pj.at) : j.at.clone();
    const n = new TransformNode(j.name, scene);
    n.parent = pj ? nodes.get(pj.name)! : parent;
    n.position.copyFrom(local);
    nodes.set(j.name, n);
    c.transformNodes.push(n);
    const b = new Bone(j.name, skel, pj ? bones.get(pj.name)! : null, Matrix.Translation(local.x, local.y, local.z));
    b.linkTransformNode(n);
    bones.set(j.name, b);
  }
  scene.removeSkeleton(skel);
  c.skeletons.push(skel);
  const index = new Map<string, number>(skel.bones.map((b, i) => [b.name, i]));
  // each vertex to its two nearest bones (their segments), the nearer weighted more
  // (each bone's thickness, as a share of the height: the distance is to its surface)
  const thick = (a: string) =>
    /^(Hips|Spine)/.test(a) ? 0.085 : /UpLeg/.test(a) ? 0.048 : /Leg$/.test(a) ? 0.032 : /Arm$/.test(a) ? 0.028 : /ForeArm/.test(a) ? 0.022 : /^(Neck|Head)/.test(a) ? 0.035 : 0.012;
  const segs = SEG.map(([a, b]) => ({ i: index.get(a)!, a: byName.get(a)!.at, b: byName.get(b)!.at, r: thick(a) * H, side: a.startsWith("Left") ? leftSign : a.startsWith("Right") ? -leftSign : 0 }));
  for (const m of meshes) {
    const pos = m.getVerticesData(VertexBuffer.PositionKind)!;
    const n = pos.length / 3;
    const idx = new Float32Array(n * 4), wts = new Float32Array(n * 4);
    const p = new Vector3();
    const weigh = (v: number, at: Vector3) => {
      const side = Math.sign(at[sideA] - sc);
      let b1 = -1, d1 = Infinity, b2 = -1, d2 = Infinity;
      for (const s of segs) {
        // (a limb on the other side of the body is never the nearest — the legs pressed together)
        // (inside two bones' thickness at once — an arm against the ribs — the nearer centre line decides)
        const dc = segDist(at, s.a, s.b);
        let d = Math.max(dc - s.r, dc * 0.2);
        if (s.side && side && s.side !== side && Math.abs(at[sideA] - sc) > H * 0.015) d += H;
        if (d < d1) {
          b2 = b1; d2 = d1;
          b1 = s.i; d1 = d;
        } else if (d < d2 && s.i !== b1) {
          b2 = s.i; d2 = d;
        }
      }
      // (soft only near the joint between them: a vertex well inside one bone's reach is all that bone's)
      const w1 = 1 / Math.pow(d1 + H * 0.004, 4), w2 = b2 >= 0 ? 1 / Math.pow(d2 + H * 0.004, 4) : 0;
      idx[v * 4] = b1;
      idx[v * 4 + 1] = Math.max(0, b2);
      wts[v * 4] = w1 / (w1 + w2);
      wts[v * 4 + 1] = w2 / (w1 + w2);
    };
    // the pieces: vertices joined by a triangle (or sitting on the same spot — a texture seam)
    const comp = pieces(m, pos);
    const size = new Map<number, number>(), lo3 = new Map<number, Vector3>(), hi3 = new Map<number, Vector3>(), sum = new Map<number, Vector3>();
    for (let v = 0; v < n; v++) {
      const c0 = comp[v];
      p.set(pos[v * 3], pos[v * 3 + 1], pos[v * 3 + 2]);
      size.set(c0, (size.get(c0) ?? 0) + 1);
      if (!sum.has(c0)) (sum.set(c0, p.clone()), lo3.set(c0, p.clone()), hi3.set(c0, p.clone()));
      else (sum.get(c0)!.addInPlace(p), lo3.get(c0)!.minimizeInPlace(p), hi3.get(c0)!.maximizeInPlace(p));
    }
    // a small piece (a pouch, not the body or a sleeve): every vertex weighted as its middle is
    const rigid = new Map<number, Vector3>();
    for (const [c0, k] of size) {
      const ext3 = hi3.get(c0)!.subtract(lo3.get(c0)!);
      if (k < 700 && Math.max(ext3.x, ext3.y, ext3.z) < H * 0.14) rigid.set(c0, sum.get(c0)!.scale(1 / k));
    }
    for (let v = 0; v < n; v++) {
      const mid = rigid.get(comp[v]);
      if (mid) weigh(v, mid);
      else weigh(v, p.set(pos[v * 3], pos[v * 3 + 1], pos[v * 3 + 2]));
    }
    m.setVerticesData(VertexBuffer.MatricesIndicesKind, idx, false, 4);
    m.setVerticesData(VertexBuffer.MatricesWeightsKind, wts, false, 4);
    m.numBoneInfluencers = 2;
    m.skeleton = skel;
  }
}
