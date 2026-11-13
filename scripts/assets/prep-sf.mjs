// A Meshy AI soldier rigged by Meshy to a 24-bone Mixamo skeleton (the user's own characters): the Indian SF
// soldier (Sandstorm's SREEJITH, Akash's lieutenant) and the spy operative (BASIL RAYEES), prepared alike. Its three clips (Running, Walking, air_squat: no rifle) dropped,
// the mesh welded and thinned to `ratio`, the maps → WebP (the colour map at `size`, the 8192² normal and
// metal/roughness maps at half that), and his hands given fingers:
//  · the rig stops at the wrist (no finger joints: every hand vertex rides the Hand bone, a rigid mitten).
//    Each hand gets a finger chain — HandMiddle1 at the knuckles, 2 and 3 along the fingers, 4 at the
//    tips — new joints in the skin, bound where they stand (inverse bind = their local⁻¹ · the hand's),
//    the four fingers skinned to it as one (the thumb, out to the side of the fingers' band, stays with
//    the palm), and closed round a grip in the rest pose. The game holds the rifle with the hand's
//    direction to HandMiddle1, and the retargeter leaves finger joints alone, so the grip stays shut.
//   node prep-sf.mjs ~/Downloads/Meshy_AI_Indian_SF_Soldier_Rigged_..._All_animation.glb ../../src/assets/soldier_sf.glb 2048 0.6
import { NodeIO } from "@gltf-transform/core";
import { ALL_EXTENSIONS, EXTTextureWebP } from "@gltf-transform/extensions";
import { dedup, prune, simplify, weld } from "@gltf-transform/functions";
import { MeshoptSimplifier } from "meshoptimizer";
import sharp from "sharp";
import * as THREE from "three";

const [, , input, output, sizeArg, ratioArg] = process.argv;
const size = parseInt(sizeArg ?? "2048");
const ratio = parseFloat(ratioArg ?? "0.6");
const io = new NodeIO().registerExtensions(ALL_EXTENSIONS);
const doc = await io.read(input);
const root = doc.getRoot();
for (const a of root.listAnimations()) a.dispose();

const V = (a) => new THREE.Vector3().fromArray(a);
const M = (a) => new THREE.Matrix4().fromArray(a);
const skin = root.listSkins()[0];
const ibm = skin.getInverseBindMatrices();
const J = (n) => skin.listJoints().find((j) => j.getName() === "mixamorig:" + n);
const idx = (n) => skin.listJoints().indexOf(J(n));
const prim = root.listMeshes()[0].listPrimitives()[0];
const P = prim.getAttribute("POSITION"), JN = prim.getAttribute("JOINTS_0"), WT = prim.getAttribute("WEIGHTS_0");
const smooth = (e0, e1, x) => {
  const k = Math.min(1, Math.max(0, (x - e0) / (e1 - e0)));
  return k * k * (3 - 2 * k);
};
// how far each finger joint closes (radians: knuckle, middle, end) — right round the pistol grip, left
// under the handguard
const CURL = { Left: [0.75, 0.95, 0.6], Right: [0.95, 1.15, 0.7] };

for (const S of ["Left", "Right"]) {
  if (J(S + "HandMiddle1")) {
    console.log(S, "hand: already has fingers, left alone");
    continue;
  }
  const hand = J(S + "Hand");
  const handW = M(hand.getWorldMatrix());
  const handIbm = M(ibm.getElement(idx(S + "Hand"), []));
  // the bind transform (mesh space → world, as skinned at rest): the hand's world · its inverse bind
  const bind = handW.clone().multiply(handIbm);
  const H = new THREE.Vector3().setFromMatrixPosition(handW);
  // the hand's vertices (mostly on the Hand bone), in world space at rest
  const hi = idx(S + "Hand");
  const verts = [];
  const jv = [], wv = [], pv = [];
  for (let i = 0; i < P.getCount(); i++) {
    JN.getElement(i, jv);
    WT.getElement(i, wv);
    let w = 0;
    for (let k = 0; k < 4; k++) if (jv[k] === hi) w += wv[k];
    if (w < 0.5) continue;
    verts.push({ i, p: V(P.getElement(i, pv)).applyMatrix4(bind) });
  }
  // along the hand: wrist → the far tenth of its vertices (the fingertips)
  const far0 = verts.map((v) => v.p.distanceTo(H)).sort((a, b) => b - a)[Math.floor(verts.length * 0.1)];
  const tips = verts.filter((v) => v.p.distanceTo(H) >= far0);
  const a = tips.reduce((s, v) => s.add(v.p), new THREE.Vector3()).multiplyScalar(1 / tips.length).sub(H).normalize();
  // across the palm: the widest spread square to `a` (fingers side by side, the thumb out at one side)
  const perp = verts.map((v) => {
    const d = v.p.clone().sub(H);
    return d.sub(a.clone().multiplyScalar(d.dot(a)));
  });
  let best = null, bw = -1;
  for (let k = 0; k < 36; k++) {
    const ang = (k / 36) * Math.PI;
    const t0 = new THREE.Vector3().crossVectors(a, Math.abs(a.y) < 0.9 ? new THREE.Vector3(0, 1, 0) : new THREE.Vector3(1, 0, 0)).normalize();
    const t1 = new THREE.Vector3().crossVectors(a, t0);
    const u = t0.multiplyScalar(Math.cos(ang)).add(t1.multiplyScalar(Math.sin(ang)));
    const vals = perp.map((d) => d.dot(u));
    const w = Math.max(...vals) - Math.min(...vals);
    if (w > bw) (bw = w), (best = u.clone());
  }
  const u = best;
  // the palm's normal, facing the body and the ground (arms hang in an A-pose)
  let n = new THREE.Vector3().crossVectors(a, u).normalize();
  if (n.dot(new THREE.Vector3(-Math.sign(H.x), -1, 0)) < 0) n.negate();
  for (const v of verts) {
    const d = v.p.clone().sub(H);
    v.t = d.dot(a);
    v.u = d.dot(u);
  }
  const L = Math.max(...verts.map((v) => v.t));
  // the fingers' band across the palm: where the fingertips are (the thumb's base sticks out past it)
  const tipU = verts.filter((v) => v.t > 0.82 * L).map((v) => v.u);
  const uLo = Math.min(...tipU) - 0.004, uHi = Math.max(...tipU) + 0.004;
  // the joints: knuckles at half the hand's length, then the two finger joints and the tips
  const t1 = 0.5 * L, t2 = t1 + (L - t1) * 0.42, t3 = t1 + (L - t1) * 0.72;
  const at = [t1, t2, t3, L];
  let parent = hand, parentW = handW, parentIbm = handIbm;
  const chain = [];
  for (let k = 0; k < 4; k++) {
    const node = doc.createNode(`mixamorig:${S}HandMiddle${k + 1}`);
    const want = H.clone().add(a.clone().multiplyScalar(at[k]));
    // (its local translation: where it should stand, in the parent's frame; no rotation of its own)
    const local = want.clone().applyMatrix4(parentW.clone().invert());
    node.setTranslation(local.toArray());
    parent.addChild(node);
    const lm = M(node.getMatrix());
    const nodeIbm = lm.clone().invert().multiply(parentIbm);
    skin.addJoint(node);
    const grown = new Float32Array((ibm.getCount() + 1) * 16);
    grown.set(ibm.getArray());
    grown.set(nodeIbm.toArray(), ibm.getCount() * 16);
    ibm.setArray(grown);
    chain.push(node);
    parent = node;
    parentW = M(node.getWorldMatrix());
    parentIbm = nodeIbm;
  }
  // the fingers' skin: palm → knuckle → middle → end, blended over each joint
  const b = 0.012 * (L / 0.2);
  const ids = [hi, idx(S + "HandMiddle1"), idx(S + "HandMiddle2"), idx(S + "HandMiddle3")];
  let nf = 0;
  for (const v of verts) {
    if (v.t < t1 - b || v.u < uLo || v.u > uHi) continue;
    const s1 = smooth(t1 - b, t1 + b, v.t), s2 = smooth(t2 - b, t2 + b, v.t), s3 = smooth(t3 - b, t3 + b, v.t);
    JN.setElement(v.i, ids);
    WT.setElement(v.i, [1 - s1, s1 * (1 - s2), s1 * s2 * (1 - s3), s1 * s2 * s3]);
    nf++;
  }
  // closed round a grip: each joint turned about the line across the palm, the fingers toward the palm
  const hinge = new THREE.Vector3().crossVectors(a, n).normalize();
  for (let k = 0; k < 3; k++) {
    const node = chain[k];
    const wq = new THREE.Quaternion();
    M(node.getWorldMatrix()).decompose(new THREE.Vector3(), wq, new THREE.Vector3());
    const axisLocal = hinge.clone().applyQuaternion(wq.clone().invert());
    const q = new THREE.Quaternion().fromArray(node.getRotation()).multiply(new THREE.Quaternion().setFromAxisAngle(axisLocal, CURL[S][k]));
    node.setRotation(q.toArray());
  }
  const tipNow = new THREE.Vector3().setFromMatrixPosition(M(chain[3].getWorldMatrix()));
  console.log(S, `hand ${verts.length} verts, ${(L * 100).toFixed(1)} cm long, fingers ${nf} (band ${(uHi - uLo) * 100 | 0} cm of ${(bw * 100) | 0}), tip at rest`, tipNow.toArray().map((x) => +x.toFixed(3)));
}

const tris = () => root.listMeshes().reduce((s, m) => s + m.listPrimitives().reduce((t, p) => t + (p.getIndices()?.getCount() ?? p.getAttribute("POSITION").getCount()) / 3, 0), 0);
const before = tris();
await doc.transform(prune({ keepLeaves: true }), dedup());
if (ratio < 1) {
  await MeshoptSimplifier.ready;
  await doc.transform(weld(), simplify({ simplifier: MeshoptSimplifier, ratio, error: 0.001 }));
}
console.log("triangles", before, "→", tris(), "joints", root.listSkins()[0].listJoints().length);

doc.createExtension(EXTTextureWebP).setRequired(true);
let bytes = 0;
const mat = root.listMaterials()[0];
for (const tex of root.listTextures()) {
  if (tex.getMimeType() === "image/webp") {
    bytes += tex.getImage().length;
    continue;
  }
  const normal = mat.getNormalTexture() === tex;
  const colour = mat.getBaseColorTexture() === tex;
  const px = colour ? size : size / 2;
  const out = await sharp(Buffer.from(tex.getImage()), { limitInputPixels: false })
    .resize({ width: px, height: px, fit: "inside", withoutEnlargement: true, kernel: "lanczos3" })
    .webp(normal ? { quality: 92 } : { quality: 86, effort: 5 })
    .toBuffer();
  tex.setImage(new Uint8Array(out)).setMimeType("image/webp");
  bytes += out.length;
  console.log("texture", colour ? "colour" : normal ? "normal" : "metal/rough", px + "²", (out.length / 1e6).toFixed(2), "MB");
}
console.log("textures", root.listTextures().length, (bytes / 1e6).toFixed(1), "MB");
await io.write(output, doc);
