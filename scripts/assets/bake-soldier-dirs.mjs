// Soldier mocap clips (src/assets/anims/soldier_anims.json, the FSB rig's local rotations) → bone
// directions per frame in the body frame, the same format fbx-anim.mjs writes — so any Mixamo-style
// rig (Spider-Man's, built at load) can play them with alignDir posing.
//
//   node bake-soldier-dirs.mjs ../../src/assets/soldier_fsb.glb ../../src/assets/anims/soldier_anims.json out.json run sprint roll …
//
// Needs: three@0.169.0 and @gltf-transform/core (no-save, see README).
import fs from "node:fs";
import { NodeIO } from "@gltf-transform/core";
import { ALL_EXTENSIONS } from "@gltf-transform/extensions";
import * as THREE from "three";

const [, , glbPath, animsPath, outPath, ...want] = process.argv;
const doc = await new NodeIO().registerExtensions(ALL_EXTENSIONS).read(glbPath);
const set = JSON.parse(fs.readFileSync(animsPath, "utf8")).fsb;

// a three.js copy of the node tree
const obj = new Map();
const world = new THREE.Object3D();
const build = (n, parent) => {
  const o = new THREE.Object3D();
  o.name = n.getName();
  o.position.fromArray(n.getTranslation());
  o.quaternion.fromArray(n.getRotation());
  o.scale.fromArray(n.getScale());
  parent.add(o);
  obj.set(o.name, o);
  for (const c of n.listChildren()) build(c, o);
};
for (const s of doc.getRoot().listScenes()) for (const n of s.listChildren()) build(n, world);
const byMixamo = (name) => {
  for (const [k, o] of obj) if (k.replace(/^mixamorig:?/, "").replace(/_\d+$/, "") === name) return o;
  return null;
};
const PAIRS = [
  ["Hips", "Spine1"], ["Spine", "Spine1"], ["Spine1", "Spine2"], ["Spine2", "Neck"], ["Neck", "Head"], ["Head", "HeadTop_End"],
  ["LeftArm", "LeftForeArm"], ["LeftForeArm", "LeftHand"], ["LeftHand", "LeftHandMiddle1"],
  ["RightArm", "RightForeArm"], ["RightForeArm", "RightHand"], ["RightHand", "RightHandMiddle1"],
  ["LeftUpLeg", "LeftLeg"], ["LeftLeg", "LeftFoot"], ["LeftFoot", "LeftToeBase"],
  ["RightUpLeg", "RightLeg"], ["RightLeg", "RightFoot"], ["RightFoot", "RightToeBase"],
];
const bone = (n) => {
  const o = byMixamo(n);
  if (!o) throw new Error("missing " + n);
  return o;
};
// (the FSB rig has no head-top joint: a point above the head along the neck→head line stands in)
const headTop = byMixamo("HeadTop_End");
const animated = set.bones.map((b) => obj.get(b));
if (animated.some((o) => !o)) throw new Error("rig/clip bone mismatch");
const hips = obj.get(set.hips);
const rest = new Map([...obj.values()].map((o) => [o, o.quaternion.clone()]));
const hipRest = hips.position.clone();

world.updateMatrixWorld(true);
const P = new THREE.Vector3(), Q = new THREE.Vector3();
// facing from the rest pose: toes point forward; up is +Y; his right = forward × up (right-handed)
const toe = bone("LeftToeBase").getWorldPosition(new THREE.Vector3()).sub(bone("LeftFoot").getWorldPosition(new THREE.Vector3()));
toe.y = 0;
const fwd = toe.normalize();
const up = new THREE.Vector3(0, 1, 0);
const right = new THREE.Vector3().crossVectors(fwd, up);
const toBody = (v) => [v.dot(right), v.y, v.dot(fwd)];
// pelvis heights are fractions of the rest pose's hip height (the same for every clip)
const restHip = bone("Hips").getWorldPosition(new THREE.Vector3()).y - Math.min(bone("LeftToeBase").getWorldPosition(new THREE.Vector3()).y, bone("RightToeBase").getWorldPosition(new THREE.Vector3()).y);

const bin = (s) => {
  const b = Buffer.from(s, "base64");
  return b;
};
const out = {};
for (const key of want) {
  const c = set.clips[key];
  if (!c) throw new Error("no clip " + key);
  const rb = bin(c.rot), hb = bin(c.hips);
  const rot = new Int16Array(rb.buffer, rb.byteOffset, rb.byteLength / 2);
  const hp = new Float32Array(hb.buffer.slice(hb.byteOffset, hb.byteOffset + hb.byteLength));
  const nb = set.bones.length;
  const frames = [];
  const standHip = restHip;
  for (let f = 0; f < c.n; f++) {
    for (const [o, q] of rest) o.quaternion.copy(q);
    animated.forEach((o, b) => {
      const k = (f * nb + b) * 4;
      o.quaternion.set(rot[k] / 32767, rot[k + 1] / 32767, rot[k + 2] / 32767, rot[k + 3] / 32767).normalize();
    });
    hips.position.set(hp[f * 3], hp[f * 3 + 1], hp[f * 3 + 2]);
    world.updateMatrixWorld(true);
    const dirs = PAIRS.map(([a, b]) => {
      bone(a).getWorldPosition(P);
      if (b === "HeadTop_End" && !headTop) {
        const neck = bone("Neck").getWorldPosition(new THREE.Vector3());
        Q.copy(P).sub(neck).normalize().add(P);
      } else bone(b).getWorldPosition(Q);
      return toBody(Q.sub(P).normalize()).map((x) => +x.toFixed(4));
    });
    bone("Hips").getWorldPosition(P);
    const feet = Math.min(bone("LeftToeBase").getWorldPosition(Q).y, bone("RightToeBase").getWorldPosition(new THREE.Vector3()).y);
    frames.push({ hips: toBody(P), feetY: feet, hipY: P.y, d: dirs });
  }
  const h0 = frames[0].hips;
  out[key] = {
    source: "soldier_anims.json:" + key,
    fps: c.fps,
    speed: c.speed,
    pairs: PAIRS,
    frames: frames.map((fr) => ({
      hip: [(fr.hips[0] - h0[0]) / standHip, (fr.hipY - fr.feetY) / standHip, (fr.hips[2] - h0[2]) / standHip].map((x) => +x.toFixed(4)),
      d: fr.d,
    })),
  };
  console.log(key, "frames", c.n, "standing hip", standHip.toFixed(3));
}
hips.position.copy(hipRest);
fs.writeFileSync(outPath, JSON.stringify(out));
console.log("→", outPath);
