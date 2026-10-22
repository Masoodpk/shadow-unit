// The Hulk for Red Dune ("Hulk | Marvel Rivals" by King_45, CC BY 4.0 — a Marvel Rivals character
// model: personal / non-commercial use only, see README).
//
//   node prep-hulk.mjs ~/Downloads/hulk__marvel_rivals.glb <clips dir> ../../src/assets/characters/hulk.glb
//
// <clips dir> holds Mixamo clips baked by fbx-anim.mjs (bone directions per frame in the body frame):
//   JumpingDown1.json, RightHook.json, Kicking.json, ComboPunch.json, Punching.json
//
// What it does:
//  - keeps only the model's own clips the game uses (idle, walk, run, jump, the leap smash, roars,
//    stagger, knockdown) out of ~200, resampled;
//  - retargets the Mixamo clips onto the Hulk's Unreal-style skeleton as real glTF animations
//    ("mx_<name>"): each frame, every mapped bone is turned (parents first) so it points the way the
//    Mixamo bone points, measured in the body frame — rest poses and proportions don't matter. His
//    hands close into fists (the fingers of the model's own punch);
//  - drops what a browser doesn't need: the 7 extra UV sets, tangents; textures → 1024² WebP.
// Needs: npm i --no-save @gltf-transform/core@4 @gltf-transform/extensions@4 @gltf-transform/functions@4 sharp meshoptimizer three@0.169.0
import fs from "node:fs";
import { NodeIO } from "@gltf-transform/core";
import { ALL_EXTENSIONS } from "@gltf-transform/extensions";
import { prune, resample, textureCompress, dedup } from "@gltf-transform/functions";
import sharp from "sharp";
import * as THREE from "three";

const [, , input, clipsDir, output] = process.argv;
const io = new NodeIO().registerExtensions(ALL_EXTENSIONS);
const doc = await io.read(input);
const root = doc.getRoot();

// ------------------------------------------------------------------ the model's own clips
const KEEP = [
  "Idle_C", "Walk_Fwd_C", "Run_Fwd_C",
  "Jump_Start_C", "Jump_Falling_C", "Jump_Land_C",
  "101199_Jump_Attack_Start", "101199_Jump_Attack_Float", "101199_Jump_Attack_Land", "101199_Jump_Attack_Recovery",
  "101211_Punch_01", "101211_Punch_02", "101211_Punch_03", "101211_Punch_04",
  "Fight_Start", "Like_Personality", "Emote_10115012021", "Emote_10110012011", "Smashing",
  "Giddiness", "KnockOut_F", "Knockout", "Dead_F", "SmashLieDown", "SmashRecover",
];
const punch = root.listAnimations().find((a) => a.getName() === "101211_Punch_01");
// (an animation's samplers and channels go with it: a disposed animation alone keeps its data)
const drop = (a) => {
  for (const c of a.listChannels()) c.dispose();
  for (const s of a.listSamplers()) s.dispose();
  a.dispose();
};
for (const a of root.listAnimations()) if (!KEEP.includes(a.getName()) && a !== punch) drop(a);

// ------------------------------------------------------------------ a three.js copy of the skeleton
const obj = new Map();
const build = (n, parent) => {
  const o = new THREE.Object3D();
  o.name = n.getName();
  o.position.fromArray(n.getTranslation());
  o.quaternion.fromArray(n.getRotation());
  o.scale.fromArray(n.getScale());
  parent.add(o);
  obj.set(n, o);
  for (const c of n.listChildren()) build(c, o);
};
const world = new THREE.Object3D();
for (const n of root.listScenes()[0].listChildren()) build(n, world);
world.updateMatrixWorld(true);
const byName = (stem) => {
  for (const [n, o] of obj) if (new RegExp(`^${stem}_\\d+$`).test(n.getName())) return { node: n, o };
  throw new Error("missing joint " + stem);
};
const J = (s) => byName(s).o;
const W = (o) => o.getWorldPosition(new THREE.Vector3());

// the body frame (Mixamo clips are baked in it): x his right, y up, z forward
const up = new THREE.Vector3(0, 1, 0);
const fwd = W(J("ball_l")).sub(W(J("foot_l"))).add(W(J("ball_r")).sub(W(J("foot_r"))));
fwd.y = 0;
fwd.normalize();
const right = new THREE.Vector3().crossVectors(fwd, up).normalize();
const feetY = Math.min(W(J("ball_l")).y, W(J("ball_r")).y);
const pelvis = J("pelvis");
const hipH = W(pelvis).y - feetY;
console.log("forward", fwd.toArray().map((v) => +v.toFixed(2)), "hip height", hipH.toFixed(2));

// Mixamo bone (as fbx-anim.mjs names its pairs) → the Hulk's bone and the joint it points at
const MAP = {
  Hips: ["pelvis", "spine_03"],
  Spine: ["spine_01", "spine_03"],
  Spine1: ["spine_03", "spine_05"],
  Spine2: ["spine_05", "neck_01"],
  Neck: ["neck_01", "head"],
  LeftArm: ["upperarm_l", "lowerarm_l"],
  LeftForeArm: ["lowerarm_l", "hand_l"],
  LeftHand: ["hand_l", "middle_01_l"],
  RightArm: ["upperarm_r", "lowerarm_r"],
  RightForeArm: ["lowerarm_r", "hand_r"],
  RightHand: ["hand_r", "middle_01_r"],
  LeftUpLeg: ["thigh_l", "calf_l"],
  LeftLeg: ["calf_l", "foot_l"],
  LeftFoot: ["foot_l", "ball_l"],
  RightUpLeg: ["thigh_r", "calf_r"],
  RightLeg: ["calf_r", "foot_r"],
  RightFoot: ["foot_r", "ball_r"],
};
const rest = new Map();
for (const [n, o] of obj) rest.set(o, { q: o.quaternion.clone(), p: o.position.clone() });
const reset = () => {
  for (const [o, r] of rest) {
    o.quaternion.copy(r.q);
    o.position.copy(r.p);
  }
  world.updateMatrixWorld(true);
};

// fists: the fingers from the model's own punch (mid-swing), as constant channels
const fist = [];
for (const ch of punch.listChannels()) {
  const n = ch.getTargetNode();
  if (ch.getTargetPath() !== "rotation" || !/^(index|middle|ring|pinky|thumb)_0[123]_[lr]_/.test(n.getName())) continue;
  const out = ch.getSampler().getOutput();
  fist.push({ node: n, q: out.getElement(Math.floor(out.getCount() / 2), []) });
}
// joints the Mixamo clips don't drive go back to rest (a clip mustn't inherit the last one's twist)
const driven = new Set(Object.values(MAP).map(([b]) => byName(b).node));
const settle = [...obj.keys()].filter((n) => /^(spine_0[24]|neck_02|clavicle_[lr]|(upper|lower)arm_twist_0\d_[lr]|thigh_twist_0\d_[lr]|calf_twist_0\d_[lr])_\d+$/.test(n.getName()) && !driven.has(n));

const buffer = root.listBuffers()[0];
const acc = (type, arr) => doc.createAccessor().setType(type).setArray(arr).setBuffer(buffer);
const clips = fs.readdirSync(clipsDir).filter((f) => f.endsWith(".json")).map((file) => ({ file, clip: JSON.parse(fs.readFileSync(`${clipsDir}/${file}`, "utf8")) }));
// his thunderclap, keyed by hand on the stance of a Mixamo clip: arms flung wide and back, chest
// open — then both hands slammed together in front of his chest, leaning into it — and back
const stance = clips.find((c) => c.file === "Punching.json")?.clip;
if (stance) clips.push({ file: "Thunderclap.json", clip: thunderclap(stance) });
for (const { file, clip } of clips) {
  const pairs = clip.pairs.map(([a]) => a);
  const N = clip.frames.length;
  const times = new Float32Array(N).map((_, i) => i / clip.fps);
  const bones = Object.keys(MAP).map((k) => ({ k, i: pairs.indexOf(k), o: J(MAP[k][0]), c: J(MAP[k][1]), node: byName(MAP[k][0]).node, q: new Float32Array(N * 4) }));
  const hipPos = new Float32Array(N * 3);
  // (measured on the rest pose: the last clip left the skeleton wherever it ended)
  reset();
  const p0 = W(pelvis);
  clip.frames.forEach((fr, f) => {
    reset();
    // the pelvis where the clip takes it (scaled to his hip height)
    const want = p0.clone().addScaledVector(right, fr.hip[0] * hipH).addScaledVector(fwd, fr.hip[2] * hipH);
    want.y = feetY + fr.hip[1] * hipH;
    pelvis.position.copy(pelvis.parent.worldToLocal(want));
    world.updateMatrixWorld(true);
    for (const b of bones) {
      if (b.i < 0) continue;
      const d = fr.d[b.i];
      const target = new THREE.Vector3().addScaledVector(right, d[0]).addScaledVector(up, d[1]).addScaledVector(fwd, d[2]).normalize();
      const cur = W(b.c).sub(W(b.o)).normalize();
      const turn = new THREE.Quaternion().setFromUnitVectors(cur, target);
      const wq = b.o.getWorldQuaternion(new THREE.Quaternion());
      const pq = b.o.parent.getWorldQuaternion(new THREE.Quaternion());
      b.o.quaternion.copy(pq.invert().multiply(turn.multiply(wq)));
      b.o.updateMatrixWorld(true);
    }
    if (process.env.DEBUG && f % 8 === 0) {
      const rel = (n) => W(J(n)).sub(W(pelvis));
      const hr = rel("hand_r");
      const dHand = clip.frames[f].d[pairs.indexOf("RightHand")];
      const cur = W(J("lowerarm_r")).sub(W(J("upperarm_r"))).normalize();
      const want = clip.frames[f].d[pairs.indexOf("RightArm")];
      console.log(file, f, "hand_r rel pelvis (right, up, fwd)", [hr.dot(right), hr.y, hr.dot(fwd)].map((v) => v.toFixed(2)).join(","), "upperarm dir", [cur.dot(right), cur.y, cur.dot(fwd)].map((v) => v.toFixed(2)).join(","), "want", want.map((v) => v.toFixed(2)).join(","));
    }
    for (const b of bones) {
      // (keep each key on the same side as the last: q and -q are one rotation, but a key that
      // flips sign makes the bone spin the long way round between them)
      if (f > 0) {
        const o = (f - 1) * 4, q = b.o.quaternion;
        if (q.x * b.q[o] + q.y * b.q[o + 1] + q.z * b.q[o + 2] + q.w * b.q[o + 3] < 0) q.set(-q.x, -q.y, -q.z, -q.w);
      }
      b.o.quaternion.toArray(b.q, f * 4);
    }
    pelvis.position.toArray(hipPos, f * 3);
  });
  const name = "mx_" + file.replace(/\d*\.json$/, "");
  const anim = doc.createAnimation(name);
  const input = acc("SCALAR", times);
  const channel = (node, path, out) => {
    const s = doc.createAnimationSampler().setInput(input).setOutput(out).setInterpolation("LINEAR");
    anim.addSampler(s).addChannel(doc.createAnimationChannel().setTargetNode(node).setTargetPath(path).setSampler(s));
  };
  for (const b of bones) channel(b.node, "rotation", acc("VEC4", b.q));
  channel(byName("pelvis").node, "translation", acc("VEC3", hipPos));
  const constant = (node, q) => {
    const out = new Float32Array(N * 4);
    for (let f = 0; f < N; f++) out.set(q, f * 4);
    channel(node, "rotation", acc("VEC4", out));
  };
  for (const { node, q } of fist) constant(node, q);
  for (const n of settle) constant(n, n.getRotation());
  console.log(name, N, "frames,", (N / clip.fps).toFixed(2), "s");
}

// ------------------------------------------------------------------ lighter for the browser
for (const m of root.listMeshes())
  for (const p of m.listPrimitives())
    for (const s of p.listSemantics()) if (/^TEXCOORD_[1-9]$/.test(s) || s === "TANGENT") p.setAttribute(s, null);
for (const mat of root.listMaterials())
  for (const t of [mat.getBaseColorTextureInfo(), mat.getNormalTextureInfo(), mat.getMetallicRoughnessTextureInfo(), mat.getOcclusionTextureInfo(), mat.getEmissiveTextureInfo()]) if (t) t.setTexCoord(0);
await doc.transform(dedup(), resample({ tolerance: 0.0005 }), textureCompress({ encoder: sharp, targetFormat: "webp", resize: [1024, 1024], quality: 82 }), prune({ keepLeaves: true }));
// (prune leaves the disposed clips' accessors behind: ~200k of them, mostly JSON)
{
  let n = 0;
  for (const a of root.listAccessors()) if (!a.listParents().some((p) => p.propertyType !== "Root")) (a.dispose(), n++);
  console.log("orphan accessors dropped", n, "left", root.listAccessors().length);
}
await io.write(output, doc);
console.log("clips:", root.listAnimations().map((a) => a.getName()).join(", "));
console.log("wrote", output, (fs.statSync(output).size / 1e6).toFixed(1), "MB");

/** a clip in fbx-anim.mjs's format, built from key poses (left side given, the right mirrored) */
function thunderclap(base) {
  const fps = 30;
  const pairs = base.pairs;
  const rest = base.frames[0];
  const norm = (v) => {
    const l = Math.hypot(...v) || 1;
    return v.map((x) => x / l);
  };
  const KEYS = [
    { t: 0, pose: {} },
    // wind-up: arms out wide and back, the chest thrown open, a little crouch
    { t: 0.5, hip: -0.06, pose: { LeftArm: [-0.85, 0.3, -0.45], LeftForeArm: [-0.55, 0.6, -0.55], LeftHand: [-0.4, 0.7, -0.55], Spine1: [0, 0.97, -0.25], Spine2: [0, 0.95, -0.3], Neck: [0, 0.9, -0.1] } },
    // CLAP: both hands together in front of his chest, leaning into it
    { t: 0.68, hip: -0.1, pose: { LeftArm: [0.3, 0.02, 0.95], LeftForeArm: [0.55, 0.05, 0.83], LeftHand: [0.5, 0.02, 0.86], Spine1: [0, 0.95, 0.3], Spine2: [0, 0.93, 0.36], Neck: [0, 0.85, 0.5] } },
    { t: 1.0, hip: -0.1, pose: { LeftArm: [0.3, 0.02, 0.95], LeftForeArm: [0.55, 0.05, 0.83], LeftHand: [0.5, 0.02, 0.86], Spine1: [0, 0.95, 0.3], Spine2: [0, 0.93, 0.36], Neck: [0, 0.85, 0.5] } },
    { t: 1.5, pose: {} },
  ];
  const at = (k, name) => {
    const p = k.pose[name] ?? (name.startsWith("Right") && k.pose["Left" + name.slice(5)] ? [-k.pose["Left" + name.slice(5)][0], k.pose["Left" + name.slice(5)][1], k.pose["Left" + name.slice(5)][2]] : null);
    return p ? norm(p) : rest.d[pairs.findIndex(([a]) => a === name)];
  };
  const frames = [];
  const N = Math.round(KEYS[KEYS.length - 1].t * fps) + 1;
  for (let f = 0; f < N; f++) {
    const t = f / fps;
    let i = 0;
    while (i < KEYS.length - 2 && t > KEYS[i + 1].t) i++;
    const A = KEYS[i], B = KEYS[i + 1];
    let u = Math.min(1, Math.max(0, (t - A.t) / (B.t - A.t)));
    u = u * u * (3 - 2 * u);
    const d = pairs.map(([name]) => {
      const a = at(A, name), b = at(B, name);
      return norm(a.map((x, j) => x + (b[j] - x) * u));
    });
    const hy = rest.hip[1] + (A.hip ?? 0) + ((B.hip ?? 0) - (A.hip ?? 0)) * u;
    frames.push({ hip: [0, hy, 0], d });
  }
  return { fps, pairs, frames };
}
