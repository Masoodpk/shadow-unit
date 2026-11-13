// The Blackout Operative (the user's own Meshy AI character, rigged by Meshy to a Mixamo skeleton):
// its ten clips dropped — the game drives every soldier with its own mocap, retargeted at load — the
// one dense mesh welded and thinned to `ratio` of its triangles (skin weights kept), and the three
// 2048² PNG maps → WebP at `size` (never upscaled). Meshy's hands are put right first:
//  · the hands are rigid mittens: every hand vertex is on the Hand bone, the four Middle joints sit
//    bunched at the knuckle with nothing skinned to them. The joints are moved to the knuckle and the
//    two finger joints, the fingers skinned to them (all four as one, the thumb left with the palm),
//    and the fingers closed round a grip in the rest pose (the retargeter leaves finger bones alone).
//   node prep-blackout.mjs ~/Downloads/Meshy_AI_Blackout_Operative_..._animated_mixamo_All_animation.glb ../../src/assets/soldier_blackout.glb 1024 0.5
// It can be run again on its own output (ratio 1): WebP maps
// are left as they are, and hands already skinned are left alone.
//   node prep-blackout.mjs ../../src/assets/soldier_blackout.glb ../../src/assets/soldier_blackout.glb 1024 1
import { NodeIO } from "@gltf-transform/core";
import { ALL_EXTENSIONS, EXTTextureWebP } from "@gltf-transform/extensions";
import { dedup, prune, simplify, weld } from "@gltf-transform/functions";
import { MeshoptSimplifier } from "meshoptimizer";
import sharp from "sharp";

const [, , input, output, sizeArg, ratioArg] = process.argv;
const size = parseInt(sizeArg ?? "1024");
const ratio = parseFloat(ratioArg ?? "0.5");
const io = new NodeIO().registerExtensions(ALL_EXTENSIONS);
const doc = await io.read(input);
const root = doc.getRoot();

for (const a of root.listAnimations()) a.dispose();

// ---------------------------------------------------------------- the rig, put right
{
  const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
  const add = (a, b) => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
  const mul = (a, k) => [a[0] * k, a[1] * k, a[2] * k];
  const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
  const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
  const norm = (a) => mul(a, 1 / Math.hypot(...a));
  const qmul = (a, b) => [a[3] * b[0] + a[0] * b[3] + a[1] * b[2] - a[2] * b[1], a[3] * b[1] - a[0] * b[2] + a[1] * b[3] + a[2] * b[0], a[3] * b[2] + a[0] * b[1] - a[1] * b[0] + a[2] * b[3], a[3] * b[3] - a[0] * b[0] - a[1] * b[1] - a[2] * b[2]];
  const qinv = (q) => [-q[0], -q[1], -q[2], q[3]];
  const qaxis = (ax, ang) => [...mul(ax, Math.sin(ang / 2)), Math.cos(ang / 2)];
  const qrot = (q, v) => qmul(qmul(q, [...v, 0]), qinv(q)).slice(0, 3);
  // (rigid matrices only: rotation and translation — the rig has no scale)
  const rigidInv = (m) => {
    const r = [m[0], m[4], m[8], 0, m[1], m[5], m[9], 0, m[2], m[6], m[10], 0, 0, 0, 0, 1];
    r[12] = -(r[0] * m[12] + r[4] * m[13] + r[8] * m[14]);
    r[13] = -(r[1] * m[12] + r[5] * m[13] + r[9] * m[14]);
    r[14] = -(r[2] * m[12] + r[6] * m[13] + r[10] * m[14]);
    return r;
  };
  const mmul = (a, b) => {
    const o = new Array(16).fill(0);
    for (let c = 0; c < 4; c++) for (let r = 0; r < 4; r++) for (let k = 0; k < 4; k++) o[c * 4 + r] += a[k * 4 + r] * b[c * 4 + k];
    return o;
  };
  const skin = root.listSkins()[0];
  const joints = skin.listJoints();
  const J = (n) => joints.find((j) => j.getName() === "mixamorig:" + n);
  const idx = (n) => joints.indexOf(J(n));
  const ibm = skin.getInverseBindMatrices();
  const wp = (n) => J(n).getWorldTranslation();
  const parentOf = (node) => node.getParentNode();

  // ---- the hands
  const prim = root.listMeshes()[0].listPrimitives()[0];
  const P = prim.getAttribute("POSITION"), JN = prim.getAttribute("JOINTS_0"), WT = prim.getAttribute("WEIGHTS_0");
  const smooth = (e0, e1, x) => {
    const k = Math.min(1, Math.max(0, (x - e0) / (e1 - e0)));
    return k * k * (3 - 2 * k);
  };
  // how far each finger joint closes (radians: knuckle, middle, end) — the right hand round the
  // pistol grip, the left under the handguard
  const CURL = { Left: [0.75, 0.95, 0.6], Right: [0.95, 1.15, 0.7] };
  const skinned = (name) => {
    const k = idx(name), jv = [], wv = [];
    for (let i = 0; i < P.getCount(); i++) {
      JN.getElement(i, jv);
      WT.getElement(i, wv);
      for (let q = 0; q < 4; q++) if (jv[q] === k && wv[q] > 0.5) return true;
    }
    return false;
  };
  for (const S of ["Left", "Right"]) {
    if (skinned(S + "HandMiddle2")) {
      console.log(S, "hand: fingers already skinned, left alone");
      continue;
    }
    const H = wp(S + "Hand");
    const a = norm(sub(wp(S + "HandMiddle1"), H));
    // the thumb's side of the hand, square to the hand's line; the palm faces the body and the ground
    const th = sub(wp(S + "HandThumb1"), H);
    const u = norm(sub(th, mul(a, dot(th, a))));
    let n = norm(cross(a, u));
    if (dot(n, [-Math.sign(H[0]), -1, 0]) < 0) n = mul(n, -1);
    const handJ = new Set(joints.map((j, i) => (j.getName().startsWith("mixamorig:" + S + "Hand") ? i : -1)).filter((i) => i >= 0));
    const verts = [];
    const jv = [], wv = [], pv = [];
    for (let i = 0; i < P.getCount(); i++) {
      JN.getElement(i, jv);
      WT.getElement(i, wv);
      let w = 0;
      for (let k = 0; k < 4; k++) if (handJ.has(jv[k])) w += wv[k];
      if (w < 0.5) continue;
      P.getElement(i, pv);
      const d = sub(pv, H);
      verts.push({ i, t: dot(d, a), u: dot(d, u) });
    }
    const L = verts.reduce((m, v) => Math.max(m, v.t), 0);
    // the fingers' band across the hand (the far fingers: no thumb out there), and the knuckle
    const far = verts.filter((v) => v.t > 0.8 * L);
    const uHi = far.reduce((m, v) => Math.max(m, v.u), -Infinity) + 0.006;
    const t1 = dot(sub(wp(S + "HandMiddle1"), H), a);
    const t2 = t1 + (L - t1) * 0.42, t3 = t1 + (L - t1) * 0.72;
    // the finger joints moved out along the hand's line (bind matrices with them: the rest pose holds)
    const tAt = [t1, t2, t3, L];
    for (let k = 1; k < 4; k++) {
      const node = J(`${S}HandMiddle${k + 1}`), par = parentOf(node);
      const before = node.getWorldMatrix();
      const target = add(H, mul(a, tAt[k]));
      node.setTranslation(qrot(qinv(par.getWorldRotation()), sub(target, par.getWorldTranslation())));
      // (new bind = new world⁻¹ · old world · old bind)
      const j = joints.indexOf(node);
      ibm.setElement(j, mmul(rigidInv(node.getWorldMatrix()), mmul(before, ibm.getElement(j, []))));
    }
    // the fingers' skin: palm → knuckle → middle → end, blended over each joint
    const b = 0.012;
    const ids = [idx(S + "Hand"), idx(S + "HandMiddle1"), idx(S + "HandMiddle2"), idx(S + "HandMiddle3")];
    let nf = 0;
    for (const v of verts) {
      if (v.t < t1 - b || v.u > uHi) continue;
      const s1 = smooth(t1 - b, t1 + b, v.t), s2 = smooth(t2 - b, t2 + b, v.t), s3 = smooth(t3 - b, t3 + b, v.t);
      JN.setElement(v.i, ids);
      WT.setElement(v.i, [1 - s1, s1 * (1 - s2), s1 * s2 * (1 - s3), s1 * s2 * s3]);
      nf++;
    }
    // closed round a grip: each joint turned about the line across the palm, the fingers toward the palm
    const hinge = norm(cross(a, n));
    const rest = [1, 2, 3].map((k) => J(`${S}HandMiddle${k}`).getWorldRotation());
    [1, 2, 3].forEach((k, q) => {
      const node = J(`${S}HandMiddle${k}`);
      node.setRotation(qmul(node.getRotation(), qaxis(qrot(qinv(rest[q]), hinge), CURL[S][q])));
    });
    console.log(S, "hand", verts.length, "verts, length", L.toFixed(3), "knuckle", t1.toFixed(3), "fingers", nf, "palm", n.map((x) => +x.toFixed(2)), "tip now", J(S + "HandMiddle4").getWorldTranslation().map((x) => +x.toFixed(3)));
  }
}
const tris = () => root.listMeshes().reduce((s, m) => s + m.listPrimitives().reduce((t, p) => t + (p.getIndices()?.getCount() ?? p.getAttribute("POSITION").getCount()) / 3, 0), 0);
const before = tris();
await doc.transform(prune(), dedup());
if (ratio < 1) {
  await MeshoptSimplifier.ready;
  await doc.transform(weld(), simplify({ simplifier: MeshoptSimplifier, ratio, error: 0.001 }));
}
console.log("triangles", before, "→", tris(), "joints", root.listSkins()[0].listJoints().length);

doc.createExtension(EXTTextureWebP).setRequired(true);
let bytes = 0;
for (const tex of root.listTextures()) {
  if (tex.getMimeType() === "image/webp") {
    bytes += tex.getImage().length;
    continue;
  }
  const normal = root.listMaterials().some((m) => m.getNormalTexture() === tex);
  const out = await sharp(Buffer.from(tex.getImage()))
    .resize({ width: size, height: size, fit: "inside", withoutEnlargement: true, kernel: "lanczos3" })
    .webp(normal ? { quality: 92 } : { quality: 84, effort: 5 })
    .toBuffer();
  tex.setImage(new Uint8Array(out)).setMimeType("image/webp");
  bytes += out.length;
}
console.log("textures", root.listTextures().length, (bytes / 1e6).toFixed(1), "MB");
await io.write(output, doc);
