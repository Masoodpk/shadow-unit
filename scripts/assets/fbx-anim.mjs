// A Mixamo FBX animation → bone directions per frame, in the character's own frame (x = his right,
// y = up, z = forward), plus the pelvis's path. The game turns any Mixamo-style rig's bones to these
// directions (level/Hostage.ts), so rest poses and bone axes don't have to match.
// Needs three.js for its FBX parser: npm i --no-save three@0.169.0
//
//   node fbx-anim.mjs "~/Downloads/Sit To Stand.fbx" ../../src/assets/anims/sit-to-stand.json
import fs from "node:fs";

globalThis.window = globalThis;
globalThis.self = globalThis;
const THREE = await import("three");
const { FBXLoader } = await import("three/examples/jsm/loaders/FBXLoader.js");

const [, , input, output] = process.argv;
const buf = fs.readFileSync(input);
const obj = new FBXLoader().parse(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength), "");
const clip = obj.animations.find((a) => a.tracks.length > 0);
// (a Mixamo FBX can hold two skeletons with the same bone names: use the one the animation moves —
// the hips that travel between the first and last frame — and look the rest up below it)
let hipsRoot = null;
const bone = (n) => {
  const scope = hipsRoot ?? obj;
  let b = null;
  scope.traverse((o) => {
    if (!b && o.isBone && o.name === "mixamorig" + n) b = o;
  });
  if (!b && scope !== obj) obj.traverse((o) => { if (!b && o.isBone && o.name === "mixamorig" + n) b = o; });
  if (!b) throw new Error("missing bone " + n);
  return b;
};
// the pairs the game poses: bone → the joint it points at
const PAIRS = [
  ["Hips", "Spine1"], ["Spine", "Spine1"], ["Spine1", "Spine2"], ["Spine2", "Neck"], ["Neck", "Head"], ["Head", "HeadTop_End"],
  ["LeftArm", "LeftForeArm"], ["LeftForeArm", "LeftHand"], ["LeftHand", "LeftHandMiddle1"],
  ["RightArm", "RightForeArm"], ["RightForeArm", "RightHand"], ["RightHand", "RightHandMiddle1"],
  ["LeftUpLeg", "LeftLeg"], ["LeftLeg", "LeftFoot"], ["LeftFoot", "LeftToeBase"],
  ["RightUpLeg", "RightLeg"], ["RightLeg", "RightFoot"], ["RightFoot", "RightToeBase"],
];
const mixer = new THREE.AnimationMixer(obj);
const action = mixer.clipAction(clip);
action.play();
// (mixer.setTime doesn't pose the bones here: set the action's time and apply it)
const seek = (t) => {
  action.time = t;
  mixer.update(0);
  obj.updateMatrixWorld(true);
};
{
  const cands = [];
  obj.traverse((o) => { if (o.isBone && o.name === "mixamorigHips") cands.push(o); });
  const at = (t) => { seek(t); return cands.map((c) => c.getWorldPosition(new THREE.Vector3())); };
  const a0 = at(0), a1 = at(clip.duration);
  let best = 0;
  cands.forEach((c, i) => { if (a0[i].distanceTo(a1[i]) > a0[best].distanceTo(a1[best])) best = i; });
  hipsRoot = cands[best];
  console.log("hips candidates", cands.length, "moving", a0.map((p, i) => p.distanceTo(a1[i]).toFixed(1)).join(","));
}
const fps = 30;
const n = Math.round(clip.duration * fps) + 1;
const P = new THREE.Vector3(), Q = new THREE.Vector3();
// three's Mixamo characters face +Z with their left hand on +X: his right is -X
const toBody = (v) => [-v.x, v.y, v.z];
const frames = [];
let standHip = 0;
for (let f = 0; f < n; f++) {
  seek(Math.min(clip.duration - 1e-4, f / fps));
  const dirs = PAIRS.map(([a, b]) => {
    bone(a).getWorldPosition(P);
    bone(b).getWorldPosition(Q);
    const d = Q.sub(P).normalize();
    return toBody(d).map((x) => +x.toFixed(4));
  });
  bone("Hips").getWorldPosition(P);
  const feet = Math.min(bone("LeftToeBase").getWorldPosition(Q).y, bone("RightToeBase").getWorldPosition(new THREE.Vector3()).y);
  frames.push({ hips: toBody(P).map((x) => +x.toFixed(2)), feet: +feet.toFixed(2), dirs });
  standHip = Math.max(standHip, P.y - feet);
}
// pelvis path relative to the first frame, as a fraction of the standing hip height (scales to any body)
const h0 = frames[0].hips;
const out = {
  source: input.split("/").pop(),
  fps,
  pairs: PAIRS,
  frames: frames.map((fr) => ({
    hip: [(fr.hips[0] - h0[0]) / standHip, (fr.hips[1] - fr.feet) / standHip, (fr.hips[2] - h0[2]) / standHip].map((x) => +x.toFixed(4)),
    d: fr.dirs,
  })),
};
fs.writeFileSync(output, JSON.stringify(out));
console.log("frames", n, "duration", clip.duration.toFixed(2), "standing hip height (source units)", standHip.toFixed(1), "→", output);
console.log("first hip", out.frames[0].hip, "last hip", out.frames[n - 1].hip);
