// Round 5 heroes for Red Dune (all CC BY 4.0, from Sketchfab):
//  - "Deadpool MMD PORT FBX" by Izann2842_o: an MMD skeleton with Japanese bone names → the bones
//    the poses drive renamed to Mixamo's (by their place in the skin), the upper body re-hung under
//    the lower body (so the pelvis carries everything, as a Mixamo Hips does), a head-top added;
//    textures → 1024² WebP → deadpool2.glb
//  - "Batman Rigged (HatchXR)" by nitwit.friends: a Mixamo rig and his own clips → batman.glb
//  - "Superman (Textured) (Rigged)" by CAPTAAINR: "Base_" bones renamed to Mixamo's, the missing
//    Spine2 / HeadTop_End / HandMiddle1 added as bone-less nodes, cape bones kept → superman.glb
//  - "Arkham Knight Batmobile (ADVANCED RIG)" by northsideanimation: 300k triangles simplified,
//    its rig's clips dropped (the game drives the wheels and the canopy) → batmobile.glb
//
//   node prep-heroes3.mjs ~/Downloads ../../src/assets/characters
import { NodeIO } from "@gltf-transform/core";
import { ALL_EXTENSIONS } from "@gltf-transform/extensions";
import { dedup, prune, simplify, textureCompress, weld } from "@gltf-transform/functions";
import { MeshoptSimplifier } from "meshoptimizer";
import sharp from "sharp";
import path from "node:path";

const [, , src, out] = process.argv;
const io = new NodeIO().registerExtensions(ALL_EXTENSIONS);

// ---- 4×4 column-major helpers
function inv(a) {
  const b = new Array(16); const [a00,a01,a02,a03,a10,a11,a12,a13,a20,a21,a22,a23,a30,a31,a32,a33] = a;
  const b00=a00*a11-a01*a10,b01=a00*a12-a02*a10,b02=a00*a13-a03*a10,b03=a01*a12-a02*a11,b04=a01*a13-a03*a11,b05=a02*a13-a03*a12,b06=a20*a31-a21*a30,b07=a20*a32-a22*a30,b08=a20*a33-a23*a30,b09=a21*a32-a22*a31,b10=a21*a33-a23*a31,b11=a22*a33-a23*a32;
  const d = 1 / (b00*b11-b01*b10+b02*b09+b03*b08-b04*b07+b05*b06);
  b[0]=(a11*b11-a12*b10+a13*b09)*d;b[1]=(a02*b10-a01*b11-a03*b09)*d;b[2]=(a31*b05-a32*b04+a33*b03)*d;b[3]=(a22*b04-a21*b05-a23*b03)*d;b[4]=(a12*b08-a10*b11-a13*b07)*d;b[5]=(a00*b11-a02*b08+a03*b07)*d;b[6]=(a32*b02-a30*b05-a33*b01)*d;b[7]=(a20*b05-a22*b02+a23*b01)*d;b[8]=(a10*b10-a11*b08+a13*b06)*d;b[9]=(a01*b08-a00*b10-a03*b06)*d;b[10]=(a30*b04-a31*b02+a33*b00)*d;b[11]=(a21*b02-a20*b04-a23*b00)*d;b[12]=(a11*b07-a10*b09-a12*b06)*d;b[13]=(a00*b09-a01*b07+a02*b06)*d;b[14]=(a31*b01-a30*b03-a32*b00)*d;b[15]=(a20*b03-a21*b01+a22*b00)*d;
  return b;
}
const mul = (a, b) => { const o = new Array(16); for (let i = 0; i < 4; i++) for (let j = 0; j < 4; j++) { let s = 0; for (let k = 0; k < 4; k++) s += a[k * 4 + j] * b[i * 4 + k]; o[i * 4 + j] = s; } return o; };
const xf = (m, p) => [m[0]*p[0]+m[4]*p[1]+m[8]*p[2]+m[12], m[1]*p[0]+m[5]*p[1]+m[9]*p[2]+m[13], m[2]*p[0]+m[6]*p[1]+m[10]*p[2]+m[14]];
const wpos = (n) => { const m = n.getWorldMatrix(); return [m[12], m[13], m[14]]; };
/** a bone-less node under `parent`, at world point `w` */
function addAt(doc, parent, name, w) {
  const local = xf(inv(parent.getWorldMatrix()), w);
  const n = doc.createNode(name).setTranslation(local);
  parent.addChild(n);
  return n;
}
/** move `child` under `parent`, keeping where it is */
function rehang(child, parent) {
  const W = child.getWorldMatrix();
  child.getParentNode()?.removeChild(child);
  parent.addChild(child);
  child.setMatrix(mul(inv(parent.getWorldMatrix()), W));
}
function meshTop(doc) {
  let top = -Infinity;
  for (const node of doc.getRoot().listNodes()) {
    const m = node.getMesh(); if (!m) continue;
    for (const p of m.listPrimitives()) { const P = p.getAttribute("POSITION"); const a = []; for (let i = 0; i < P.getCount(); i++) { P.getElement(i, a); top = Math.max(top, a[1]); } }
  }
  return top;
}
const dropAnims = (doc) => { for (const a of doc.getRoot().listAnimations()) { for (const c of a.listChannels()) c.dispose(); for (const s of a.listSamplers()) s.dispose(); a.dispose(); } };

// ---- Deadpool (MMD)
{
  const doc = await io.read(path.join(src, "deadpool_mmd_port_fbx.glb"));
  const joints = doc.getRoot().listSkins()[0].listJoints();
  const NAMES = {
    4: "Hips", 45: "Spine", 47: "Spine1", 48: "Spine2", 49: "Neck", 51: "Head",
    5: "LeftUpLeg", 6: "LeftLeg", 7: "LeftFoot", 8: "LeftToeBase", 25: "RightUpLeg", 26: "RightLeg", 27: "RightFoot", 28: "RightToeBase",
    115: "LeftShoulder", 116: "LeftArm", 117: "LeftForeArm", 118: "LeftHand", 174: "RightShoulder", 175: "RightArm", 176: "RightForeArm", 177: "RightHand",
  };
  const fingers = (S, base) => ["Thumb", "Index", "Middle", "Ring", "Pinky"].forEach((f, i) => [1, 2, 3].forEach((k) => (NAMES[base + i * 4 + k - 1] = `${S}Hand${f}${k}`)));
  fingers("Left", 131);
  fingers("Right", 190);
  joints.forEach((j, k) => j.setName(NAMES[k] ?? `dpj_${k}`));
  // (the bind is the rest pose? the largest gap between them, model units)
  const ibm = doc.getRoot().listSkins()[0].getInverseBindMatrices();
  let gap = 0;
  joints.forEach((j, k) => { const b = inv(ibm.getElement(k, new Array(16))); const w = wpos(j); gap = Math.max(gap, Math.hypot(b[12] - w[0], b[13] - w[1], b[14] - w[2])); });
  console.log("deadpool bind↔rest gap", gap.toFixed(4));
  // the upper body under the lower body: the pelvis carries the whole body
  rehang(joints[45], joints[4]);
  const head = joints[51];
  const hp = wpos(head);
  // (the head-top: straight up from the head joint to the top of the mesh — the mesh is in the skin's space)
  const top = meshTop(doc);
  const skinRootW = joints[0].getWorldMatrix();
  addAt(doc, head, "HeadTop_End", [hp[0], Math.max(hp[1] + 0.05 * (hp[1]), xf(skinRootW, [0, top, 0])[1]), hp[2]]);
  console.log("deadpool head", hp.map((v) => v.toFixed(3)), "top", top.toFixed(3));
  // (keepLeaves: the added head-top has no mesh and no skin — prune would drop it)
  await doc.transform(dedup(), textureCompress({ encoder: sharp, targetFormat: "webp", resize: [1024, 1024], quality: 82 }), prune({ keepLeaves: true }));
  await io.write(path.join(out, "deadpool2.glb"), doc);
}
// ---- Batman
{
  const doc = await io.read(path.join(src, "batman_rigged_hatchxr.glb"));
  await doc.transform(dedup(), textureCompress({ encoder: sharp, targetFormat: "webp", resize: [1024, 1024], quality: 84 }), prune());
  await io.write(path.join(out, "batman.glb"), doc);
}
// ---- Superman
{
  const doc = await io.read(path.join(src, "superman_textured_rigged.glb"));
  const by = (n) => doc.getRoot().listNodes().find((x) => x.getName() === n);
  for (const n of doc.getRoot().listNodes()) {
    let nm = n.getName();
    if (!nm.startsWith("Base_")) continue;
    nm = nm.replace(/^Base_/, "").replace(/_\d+$/, "");
    nm = nm.replace(/HandRing(\d)/, "HandPinky$1");
    n.setName(nm);
  }
  for (const n of doc.getRoot().listNodes()) if (/^VFX_Socket_Eye_[LR]/.test(n.getName())) n.setName(n.getName().replace(/_\d+$/, ""));
  const spine1 = by("Spine1"), neck = by("Neck"), head = by("Head");
  const a = wpos(spine1), b = wpos(neck);
  addAt(doc, spine1, "Spine2", [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2, (a[2] + b[2]) / 2]);
  const hp = wpos(head), np = wpos(neck);
  // (the crown: the head's length up again from the neck, ×2.4)
  addAt(doc, head, "HeadTop_End", [hp[0], hp[1] + (hp[1] - np[1]) * 2.4, hp[2]]);
  for (const S of ["Left", "Right"]) {
    const i1 = wpos(by(`${S}HandIndex1`)), r1 = wpos(by(`${S}HandPinky1`));
    addAt(doc, by(`${S}Hand`), `${S}HandMiddle1`, [(i1[0] + r1[0]) / 2, (i1[1] + r1[1]) / 2, (i1[2] + r1[2]) / 2]);
  }
  await doc.transform(dedup(), textureCompress({ encoder: sharp, targetFormat: "webp", resize: [1024, 1024], quality: 86 }), prune({ keepLeaves: true }));
  await io.write(path.join(out, "superman.glb"), doc);
}
// ---- the Batmobile
{
  const doc = await io.read(path.join(src, "arkham_knight_batmobile_advanced_rig.glb"));
  dropAnims(doc);
  const tris = () => doc.getRoot().listMeshes().reduce((n, m) => n + m.listPrimitives().reduce((k, p) => k + (p.getIndices()?.getCount() ?? 0) / 3, 0), 0);
  console.log("batmobile triangles in", tris());
  await MeshoptSimplifier.ready;
  await doc.transform(dedup(), weld({ tolerance: 0.0001 }), simplify({ simplifier: MeshoptSimplifier, ratio: 0.18, error: 0.002 }), prune());
  console.log("batmobile triangles out", tris());
  await doc.transform(textureCompress({ encoder: sharp, targetFormat: "webp", resize: [1024, 1024], quality: 82 }), prune());
  await io.write(path.join(out, "batmobile.glb"), doc);
}
console.log("done");
