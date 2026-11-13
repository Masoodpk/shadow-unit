// Mixamo FBX animations → clips on a Mixamo-rigged soldier's OWN skeleton (no FSB rig in between), in
// src/assets/anims/soldier_anims.json under that soldier's kind. At load they take the place of the clips
// of the same name that the soldier would otherwise get by retargeting the FSB's mocap
// (SoldierSkins.load → mergeOwnClips); every other clip still comes the retargeted way.
//
// The same retargeting as fbx-soldier-clip.mjs (each bone's turn from rest, in the body's frame, applied
// to the target bone after its rest pose is turned to point along the source's rest bone), but:
//  · the body frame is taken from the hips (left thigh → right thigh) on both rigs, not from a toe — a
//    rig whose boots rest turned out would otherwise have its whole body turned by that much;
//  · locomotion keeps its timing: `speed` is the clip's ground speed (m/s at the target's file scale,
//    scaled to the hip height; `hipH` lets the game rescale it to the height the soldier is stood at)
//    and `sync` the phase of the left heel strike, so the gait-cycle blend keeps the feet in step.
//
//   node fbx-own-clips.mjs --spread=0.7 blackout ../../src/assets/soldier_blackout.glb \
//     "~/Downloads/Firing Rifle.fbx=walk" "~/Downloads/Run Forward.fbx=run" "~/Downloads/Stepping Backward.fbx=back" \
//     "~/Downloads/Strafe Right.fbx=strafeR" "~/Downloads/Strafing.fbx=strafeL"
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
const animsPath = path.join(here, "../../src/assets/anims/soldier_anims.json");
const args = process.argv.slice(2);
const opt = (name, dflt) => {
  const i = args.findIndex((a) => a.startsWith(`--${name}=`));
  return i < 0 ? dflt : parseFloat(args.splice(i, 1)[0].split("=")[1]);
};
/**
 * How much of the target's own rest stance its legs keep (0: the source's, straight down from the hip
 * joints; 1: the target's own). A rig whose hip joints sit close together inside a wide-modelled pelvis
 * (Meshy's auto-rig: joints 9 cm either side, the boots 21 cm out) brought to the source's straight
 * legs walks knock-kneed, its trousers pressed together.
 */
const spread = opt("spread", 0);
const SPREAD_BONES = new Set(["LeftUpLeg", "LeftLeg", "RightUpLeg", "RightLeg"]);
const [kind, rigPath, ...jobs] = args;
if (!kind || !rigPath || !jobs.length) throw new Error("usage: node fbx-own-clips.mjs [--spread=0..1] <kind> <rig.glb> <file.fbx>=<clipKey> ...");
const home = (p) => p.replace(/^~/, process.env.HOME);

/** the bones driven, by their Mixamo names, with the joint each one points at */
const DRIVE = [
  ["Hips", null], ["Spine", "Spine1"], ["Spine1", "Spine2"], ["Spine2", "Neck"], ["Neck", "Head"], ["Head", null],
  ["LeftShoulder", "LeftArm"], ["LeftArm", "LeftForeArm"], ["LeftForeArm", "LeftHand"], ["LeftHand", "LeftHandMiddle1"],
  ["RightShoulder", "RightArm"], ["RightArm", "RightForeArm"], ["RightForeArm", "RightHand"], ["RightHand", "RightHandMiddle1"],
  ["LeftUpLeg", "LeftLeg"], ["LeftLeg", "LeftFoot"], ["LeftFoot", "LeftToeBase"],
  ["RightUpLeg", "RightLeg"], ["RightLeg", "RightFoot"], ["RightFoot", "RightToeBase"],
];
const wq = (o) => o.getWorldQuaternion(new THREE.Quaternion());
const wp = (o) => o.getWorldPosition(new THREE.Vector3());
const UP = new THREE.Vector3(0, 1, 0);

/** the body frame (x = up × forward, y up, z forward → world) from the thighs: forward = (left − right) × up */
function bodyFrame(lThigh, rThigh) {
  const across = wp(lThigh).sub(wp(rThigh));
  across.y = 0;
  const f = new THREE.Vector3().crossVectors(across.normalize(), UP).normalize();
  const right = new THREE.Vector3().crossVectors(UP, f);
  return new THREE.Quaternion().setFromRotationMatrix(new THREE.Matrix4().makeBasis(right, UP, f));
}

// ---------------------------------------------------------------- the target: the soldier's own rig
const io = new NodeIO().registerExtensions(ALL_EXTENSIONS);
const doc = await io.read(rigPath);
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
const dst = (n) => {
  const o = byName.get("mixamorig:" + n);
  if (!o) throw new Error(`${kind}: no bone mixamorig:${n}`);
  return o;
};
const animated = DRIVE.map(([n]) => dst(n));
const hips = dst("Hips");
const restLocal = animated.map((o) => o.quaternion.clone());
const hipRestLocal = hips.position.clone();
const dstB = bodyFrame(dst("LeftUpLeg"), dst("RightUpLeg"));
const dstBi = dstB.clone().invert();
const dstHipRest = wp(hips);
const dstHipH = dstHipRest.y - Math.min(wp(dst("LeftToeBase")).y, wp(dst("RightToeBase")).y);
const depth = (o) => (o.parent ? depth(o.parent) + 1 : 0);

const anims = JSON.parse(fs.readFileSync(animsPath, "utf8"));
const set = (anims[kind] ??= { bones: animated.map((o) => o.name), hips: hips.name, hipH: dstHipH, clips: {} });
set.bones = animated.map((o) => o.name);
set.hips = hips.name;
set.hipH = +dstHipH.toFixed(4);

for (const job of jobs) {
  const eq = job.lastIndexOf("=");
  const fbxPath = home(job.slice(0, eq)), key = job.slice(eq + 1);
  // ---------------------------------------------------------------- the source: the FBX, sampled
  const buf = fs.readFileSync(fbxPath);
  const fbx = new FBXLoader().parse(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength), "");
  const clip = fbx.animations.find((a) => a.tracks.length > 0);
  const src = (n) => {
    let b = null;
    fbx.traverse((o) => {
      if (!b && o.isBone && o.name === "mixamorig" + n) b = o;
    });
    if (!b) throw new Error(`${path.basename(fbxPath)}: missing bone ${n}`);
    return b;
  };
  fbx.updateMatrixWorld(true);
  const S = DRIVE.map(([n, c]) => ({ n, bone: src(n), child: c ? src(c) : null }));
  const srcB = bodyFrame(src("LeftUpLeg"), src("RightUpLeg"));
  const srcBi = srcB.clone().invert();
  const srcHipRest = wp(src("Hips"));
  const srcHipH = srcHipRest.y - Math.min(wp(src("LeftToeBase")).y, wp(src("RightToeBase")).y);
  for (const s of S) {
    s.restQ = wq(s.bone);
    s.restDir = s.child ? wp(s.child).sub(wp(s.bone)).normalize().applyQuaternion(srcBi) : null;
  }
  const mixer = new THREE.AnimationMixer(fbx);
  mixer.clipAction(clip).play();
  const fps = 30;
  const n = Math.round(clip.duration * fps) + 1;
  const frames = [];
  const lFootY = [];
  let travel0 = null, travel1 = null;
  for (let f = 0; f < n; f++) {
    mixer.setTime(Math.min(clip.duration, f / fps));
    fbx.updateMatrixWorld(true);
    // D_body = B⁻¹ · W(t) · W_rest⁻¹ · B
    const d = S.map((s) => srcBi.clone().multiply(wq(s.bone)).multiply(s.restQ.clone().invert()).multiply(srcB));
    const hipW = wp(S[0].bone);
    const hip = hipW.clone().sub(srcHipRest).applyQuaternion(srcBi);
    frames.push({ d, hipY: hip.y / srcHipH });
    lFootY.push(wp(src("LeftFoot")).y);
    if (f === 0) travel0 = hipW.clone();
  }
  // (the travel: measured a hair before the end — at the end itself a looping action is back at frame 0)
  const tEnd = clip.duration - 1e-3;
  mixer.setTime(tEnd);
  fbx.updateMatrixWorld(true);
  travel1 = wp(S[0].bone);
  // ground speed (hip heights per second → the target's file metres) and the left heel strike
  const tr = travel1.sub(travel0);
  tr.y = 0;
  const speed = (tr.length() / srcHipH / tEnd) * dstHipH;
  const lo = Math.min(...lFootY), hi = Math.max(...lFootY);
  const down = lo + (hi - lo) * 0.15;
  let strike = 0;
  for (let i = 0; i < n - 1; i++) {
    const a = lFootY[i], b = lFootY[(i + 1) % (n - 1)];
    if (a > down && b <= down) {
      strike = ((i + 1) % (n - 1)) / (n - 1);
      break;
    }
  }

  // ---------------------------------------------------------------- onto the target
  // (from its rest pose: the clip before this one left the skeleton in its last frame)
  animated.forEach((o, b) => o.quaternion.copy(restLocal[b]));
  hips.position.copy(hipRestLocal);
  world.updateMatrixWorld(true);
  const T = DRIVE.map(([nm, c], i) => {
    const bone = animated[i];
    let restQ = wq(bone);
    if (c) {
      const dir = wp(dst(c)).sub(wp(bone)).normalize().applyQuaternion(dstBi);
      const a = new THREE.Quaternion().setFromUnitVectors(dir, S[i].restDir);
      // (the legs keep `spread` of their own rest stance: see SPREAD)
      if (SPREAD_BONES.has(nm)) a.slerp(new THREE.Quaternion(), spread);
      restQ = dstB.clone().multiply(a).multiply(dstBi).multiply(restQ);
    }
    return { i, bone, restQ };
  }).sort((a, b) => depth(a.bone) - depth(b.bone));
  const nb = animated.length;
  const rot = new Int16Array(n * nb * 4);
  const hp = new Float32Array(n * 3);
  const prev = animated.map(() => null);
  const worst = DRIVE.map(() => 0);
  for (let f = 0; f < n; f++) {
    animated.forEach((o, b) => o.quaternion.copy(restLocal[b]));
    hips.position.copy(hipRestLocal);
    world.updateMatrixWorld(true);
    for (const t of T) {
      // W = B · D_body · B⁻¹ · rest′, then local = parentWorld⁻¹ · W
      const W = dstB.clone().multiply(frames[f].d[t.i]).multiply(dstBi).multiply(t.restQ);
      t.bone.quaternion.copy(wq(t.bone.parent).invert().multiply(W));
      t.bone.updateMatrixWorld(true);
    }
    const want = dstHipRest.clone().add(new THREE.Vector3(0, frames[f].hipY * dstHipH, 0));
    hips.parent.updateMatrixWorld(true);
    hips.position.copy(hips.parent.worldToLocal(want));
    hp.set([hips.position.x, hips.position.y, hips.position.z], f * 3);
    world.updateMatrixWorld(true);
    // (the check: every bone — the hips too — turned from its rest′ exactly as the source's from its rest)
    for (const t of T) {
      const got = dstBi.clone().multiply(wq(t.bone)).multiply(t.restQ.clone().invert()).multiply(dstB);
      worst[t.i] = Math.max(worst[t.i], (got.angleTo(frames[f].d[t.i]) * 180) / Math.PI);
    }
    animated.forEach((o, b) => {
      const q = o.quaternion.clone().normalize();
      if (prev[b] && prev[b].dot(q) < 0) q.set(-q.x, -q.y, -q.z, -q.w);
      prev[b] = q;
      rot.set([q.x, q.y, q.z, q.w].map((v) => Math.round(v * 32767)), (f * nb + b) * 4);
    });
  }
  set.clips[key] = {
    fps,
    n,
    speed: +speed.toFixed(3),
    sync: +strike.toFixed(3),
    rot: Buffer.from(rot.buffer).toString("base64"),
    hips: Buffer.from(hp.buffer).toString("base64"),
  };
  const bad = DRIVE.map(([nm], i) => [nm, worst[i]]).filter(([, w]) => w > 2);
  if (bad.length) console.log("  bones not turned as the source's (deg):", bad.map(([nm, w]) => `${nm} ${w.toFixed(1)}`).join(", "));
  console.log(`${kind}.${key} ← ${path.basename(fbxPath)}: ${clip.duration.toFixed(2)} s, ${n} frames, ${speed.toFixed(2)} m/s (file scale), left heel strike at ${strike.toFixed(2)}`);
}
fs.writeFileSync(animsPath, JSON.stringify(anims));
console.log("→", animsPath);
