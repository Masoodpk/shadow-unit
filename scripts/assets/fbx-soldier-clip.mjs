// A Mixamo FBX animation → a clip in src/assets/anims/soldier_anims.json, for the FSB operator's rig and
// Mark's (CC) rig: each frame retargeted to those rigs' own local rotations, the format the soldiers'
// mocap is stored in. (The other soldiers get every FSB clip by retargeting at load: SoldierRetarget.)
//
// Retargeting: for every mapped bone, the source's rotation away from its rest pose (in the body's
// frame: x right, y up, z forward) is applied to the target bone, after the target's rest pose has been
// turned so the bone points where the source's rest bone points. So a T-posed Mixamo clip lands right on
// a rig with another rest pose and other bone axes. The hips keep the clip's height (scaled to the rig's
// hip height) and lose its travel: the clip plays in place (the game moves the body).
//
//   node fbx-soldier-clip.mjs "~/Downloads/Running Slide.fbx" slide
//
// Needs (no-save): npm i --no-save three@0.169.0 @gltf-transform/core@4 @gltf-transform/extensions@4
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

globalThis.window = globalThis;
globalThis.self = globalThis;
const THREE = await import("three");
const { FBXLoader } = await import("three/examples/jsm/loaders/FBXLoader.js");
const { NodeIO } = await import("@gltf-transform/core");
const { ALL_EXTENSIONS } = await import("@gltf-transform/extensions");

const here = path.dirname(fileURLToPath(import.meta.url));
const assets = path.join(here, "../../src/assets");
const animsPath = path.join(assets, "anims/soldier_anims.json");
const [, , fbxPath, key] = process.argv;
if (!fbxPath || !key) throw new Error("usage: node fbx-soldier-clip.mjs <file.fbx> <clipKey>");

/** the bones driven, by their Mixamo names, with the joint each one points at */
const DRIVE = [
  ["Hips", null], ["Spine", "Spine1"], ["Spine1", "Spine2"], ["Spine2", "Neck"], ["Neck", "Head"], ["Head", null],
  ["LeftShoulder", "LeftArm"], ["LeftArm", "LeftForeArm"], ["LeftForeArm", "LeftHand"], ["LeftHand", "LeftHandMiddle1"],
  ["RightShoulder", "RightArm"], ["RightArm", "RightForeArm"], ["RightForeArm", "RightHand"], ["RightHand", "RightHandMiddle1"],
  ["LeftUpLeg", "LeftLeg"], ["LeftLeg", "LeftFoot"], ["LeftFoot", "LeftToeBase"],
  ["RightUpLeg", "RightLeg"], ["RightLeg", "RightFoot"], ["RightFoot", "RightToeBase"],
];
/** Mark's Character Creator rig, by Mixamo name */
const CC = {
  Hips: "Hip", Spine: "Waist", Spine1: "Spine01", Spine2: "Spine02", Neck: "NeckTwist01", Head: "Head",
  LeftShoulder: "L_Clavicle", LeftArm: "L_Upperarm", LeftForeArm: "L_Forearm", LeftHand: "L_Hand", LeftHandMiddle1: "L_Mid1",
  RightShoulder: "R_Clavicle", RightArm: "R_Upperarm", RightForeArm: "R_Forearm", RightHand: "R_Hand", RightHandMiddle1: "R_Mid1",
  LeftUpLeg: "L_Thigh", LeftLeg: "L_Calf", LeftFoot: "L_Foot", LeftToeBase: "L_ToeBase",
  RightUpLeg: "R_Thigh", RightLeg: "R_Calf", RightFoot: "R_Foot", RightToeBase: "R_ToeBase",
};
const RIGS = {
  fsb: { glb: "soldier_fsb.glb", name: (n) => (k) => k.replace(/^mixamorig:?/, "").replace(/_\d+$/, "") === n },
  mark: { glb: "soldier_mark.glb", name: (n) => (k) => CC[n] && k.replace(/^CC_Base_/, "").replace(/_\d+$/, "") === CC[n] },
};

// ---------------------------------------------------------------- the source: the FBX, sampled
const buf = fs.readFileSync(fbxPath.replace(/^~/, process.env.HOME));
const fbx = new FBXLoader().parse(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength), "");
const clip = fbx.animations.find((a) => a.tracks.length > 0);
const srcBone = (n) => {
  let b = null;
  fbx.traverse((o) => {
    if (!b && o.isBone && o.name === "mixamorig" + n) b = o;
  });
  if (!b) throw new Error("fbx: missing bone " + n);
  return b;
};
const wq = (o) => o.getWorldQuaternion(new THREE.Quaternion());
const wp = (o) => o.getWorldPosition(new THREE.Vector3());

/** a body frame (x right, y up, z forward → world) from the rest pose: the toes point forward */
function bodyFrame(toe, foot) {
  const f = wp(toe).sub(wp(foot));
  f.y = 0;
  f.normalize();
  const up = new THREE.Vector3(0, 1, 0);
  // (a proper rotation: x = up × z — the same construction for both rigs, so which way x points doesn't matter)
  const right = new THREE.Vector3().crossVectors(up, f);
  return new THREE.Quaternion().setFromRotationMatrix(new THREE.Matrix4().makeBasis(right, up, f));
}

fbx.updateMatrixWorld(true);
const S = {};
for (const [n, c] of DRIVE) S[n] = { bone: srcBone(n), child: c ? srcBone(c) : null };
const srcB = bodyFrame(srcBone("LeftToeBase"), srcBone("LeftFoot"));
const srcBi = srcB.clone().invert();
const srcHipRest = wp(S.Hips.bone);
const srcHipH = srcHipRest.y - Math.min(wp(srcBone("LeftToeBase")).y, wp(srcBone("RightToeBase")).y);
for (const [n] of DRIVE) {
  const s = S[n];
  s.restQ = wq(s.bone);
  s.restDir = s.child ? wp(s.child).sub(wp(s.bone)).normalize().applyQuaternion(srcBi) : null;
}
const mixer = new THREE.AnimationMixer(fbx);
mixer.clipAction(clip).play();
const fps = 30;
const n = Math.round(clip.duration * fps) + 1;
/** per frame: each bone's turn from rest in the body frame, and the hips' height change (fraction of hip height) */
const frames = [];
for (let f = 0; f < n; f++) {
  mixer.setTime(Math.min(clip.duration, f / fps));
  fbx.updateMatrixWorld(true);
  const d = {};
  for (const [nm] of DRIVE) {
    const s = S[nm];
    // D_body = B⁻¹ · W(t) · W_rest⁻¹ · B
    d[nm] = srcBi.clone().multiply(wq(s.bone)).multiply(s.restQ.clone().invert()).multiply(srcB);
  }
  const hip = wp(S.Hips.bone).sub(srcHipRest).applyQuaternion(srcBi);
  frames.push({ d, hipY: hip.y / srcHipH });
}
console.log(`${clip.name}: ${clip.duration.toFixed(2)} s, ${n} frames`);

// ---------------------------------------------------------------- the targets
const anims = JSON.parse(fs.readFileSync(animsPath, "utf8"));
const io = new NodeIO().registerExtensions(ALL_EXTENSIONS);
for (const [kind, rig] of Object.entries(RIGS)) {
  const set = anims[kind];
  const doc = await io.read(path.join(assets, rig.glb));
  const byName = new Map();
  const world = new THREE.Object3D();
  const build = (gn, parent) => {
    const o = new THREE.Object3D();
    o.name = gn.getName();
    o.position.fromArray(gn.getTranslation());
    o.quaternion.fromArray(gn.getRotation());
    o.scale.fromArray(gn.getScale());
    parent.add(o);
    if (!byName.has(o.name)) byName.set(o.name, o);
    for (const c of gn.listChildren()) build(c, o);
  };
  for (const sc of doc.getRoot().listScenes()) for (const c of sc.listChildren()) build(c, world);
  world.updateMatrixWorld(true);
  const find = (mx) => {
    const test = rig.name(mx);
    for (const [k, o] of byName) if (test(k)) return o;
    throw new Error(`${kind}: no bone for ${mx}`);
  };
  const animated = set.bones.map((b) => byName.get(b));
  if (animated.some((o) => !o)) throw new Error(kind + ": rig / clip bone mismatch");
  const hips = byName.get(set.hips);
  const restLocal = new Map(animated.map((o) => [o, o.quaternion.clone()]));
  const hipRestLocal = hips.position.clone();
  const dstB = bodyFrame(find("LeftToeBase"), find("LeftFoot"));
  const dstBi = dstB.clone().invert();
  const dstHipRest = wp(hips);
  const dstHipH = dstHipRest.y - Math.min(wp(find("LeftToeBase")).y, wp(find("RightToeBase")).y);
  // each driven bone: its rest world rotation, turned so the bone points along the source's rest bone
  const T = DRIVE.map(([nm, c]) => {
    const bone = find(nm);
    let restQ = wq(bone);
    if (c) {
      const dir = wp(find(c)).sub(wp(bone)).normalize().applyQuaternion(dstBi);
      const a = new THREE.Quaternion().setFromUnitVectors(dir, S[nm].restDir);
      // (turned in the body frame: A_world = B · A · B⁻¹)
      restQ = dstB.clone().multiply(a).multiply(dstBi).multiply(restQ);
    }
    return { nm, bone, restQ };
  });
  // parents before children
  const depth = (o) => (o.parent ? depth(o.parent) + 1 : 0);
  T.sort((a, b) => depth(a.bone) - depth(b.bone));

  const nb = set.bones.length;
  const rot = new Int16Array(n * nb * 4);
  const hp = new Float32Array(n * 3);
  const prev = animated.map(() => null);
  for (let f = 0; f < n; f++) {
    for (const [o, q] of restLocal) o.quaternion.copy(q);
    hips.position.copy(hipRestLocal);
    world.updateMatrixWorld(true);
    for (const t of T) {
      // W = B · D_body · B⁻¹ · rest′, then local = parentWorld⁻¹ · W
      const W = dstB.clone().multiply(frames[f].d[t.nm]).multiply(dstBi).multiply(t.restQ);
      const pw = wq(t.bone.parent);
      t.bone.quaternion.copy(pw.invert().multiply(W));
      t.bone.updateMatrixWorld(true);
    }
    // the hips: the clip's rise and fall, in place
    const want = dstHipRest.clone().add(new THREE.Vector3(0, frames[f].hipY * dstHipH, 0));
    hips.parent.updateMatrixWorld(true);
    hips.position.copy(hips.parent.worldToLocal(want));
    hp.set([hips.position.x, hips.position.y, hips.position.z], f * 3);
    animated.forEach((o, b) => {
      const q = o.quaternion.clone().normalize();
      // (one hemisphere from frame to frame, so blending never takes the long way round)
      if (prev[b] && prev[b].dot(q) < 0) q.set(-q.x, -q.y, -q.z, -q.w);
      prev[b] = q;
      rot.set([q.x, q.y, q.z, q.w].map((v) => Math.round(v * 32767)), (f * nb + b) * 4);
    });
  }
  set.clips[key] = {
    fps,
    n,
    speed: 0,
    sync: 0,
    rot: Buffer.from(rot.buffer).toString("base64"),
    hips: Buffer.from(hp.buffer).toString("base64"),
  };
  console.log(`${kind}: ${key} written (hip height ${dstHipH.toFixed(3)} vs source ${srcHipH.toFixed(1)})`);
}
fs.writeFileSync(animsPath, JSON.stringify(anims));
console.log("→", animsPath);
