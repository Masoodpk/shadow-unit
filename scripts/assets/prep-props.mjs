// The Sandstorm mission's two props, made small for the browser:
//   handcuffs.glb ("Handcuffs", 308k triangles, 12 MB) → welded and simplified to a few thousand
//   triangles, flattened into one mesh per material, centred and scaled to real size (~25 cm).
//   locker.glb ("Locker room - 1mb") → its three 2048² PNGs as 1024² WebP.
//   wood_box.glb ("military wooden box"), ration_box.glb ("Ration cardboard box") → PNGs as 512² WebP
//   (barricade crates: seen in piles, never up close).
//   betamax.glb ("Sony Betamax Video Tape") → PNGs as 1024² WebP, centred, lying flat (long side
//   along x, thin side up), real size (15.6 cm long): the tape the hostage hands you.
//   c64.glb ("Commodore 64 || Computer (Full Pack)") → the cables, connectors, monitor plug and
//   power brick dropped (nothing lies loose on the desk), textures as 1024² WebP, real size (the
//   C64 is 40.4 cm wide), front along +z, resting on y = 0. Nodes kept by name: c64, drive,
//   joystick, monitor, screen (the monitor's glass — the game draws the picture on it).
//
//   node prep-props.mjs ~/Downloads/handcuffs.glb "~/Downloads/locker_room_-_1mb (1).glb" ../../src/assets/props \
//     ~/Downloads/military_wooden_box.glb "~/Downloads/ration_cardboard_box (1).glb" \
//     ~/Downloads/sony_betamax_video_tape.glb ~/Downloads/commodore_64__computer_full_pack.glb
// Needs: npm i --no-save @gltf-transform/core@4 @gltf-transform/extensions@4 @gltf-transform/functions@4 sharp meshoptimizer
import { NodeIO } from "@gltf-transform/core";
import { ALL_EXTENSIONS } from "@gltf-transform/extensions";
import { dedup, flatten, getBounds, join, prune, simplify, textureCompress, weld } from "@gltf-transform/functions";
import { MeshoptSimplifier } from "meshoptimizer";
import sharp from "sharp";
import fs from "node:fs";

const [, , cuffsIn, lockerIn, outDir, woodIn, rationIn, tapeIn, c64In] = process.argv;
const io = new NodeIO().registerExtensions(ALL_EXTENSIONS);

// (pass "-" for a model you don't want to rebuild)
const has = (f) => f && f !== "-" && fs.existsSync(f);

// ------------------------------------------------------------------ handcuffs
if (has(cuffsIn)) {
  const doc = await io.read(cuffsIn);
  const root = doc.getRoot();
  // (the file carries a lamp node: drop everything that isn't geometry)
  for (const n of root.listNodes()) if (/Sun/i.test(n.getName())) n.dispose();
  // (no textures; the UVs and hard-edge normals only stop the welder joining the triangles the
  // simplifier needs connected — smooth normals are rebuilt after)
  for (const m of root.listMeshes()) for (const p of m.listPrimitives()) for (const s of p.listSemantics()) if (s !== "POSITION") p.setAttribute(s, null);
  await doc.transform(dedup(), flatten(), join({ keepNamed: false }), weld({ tolerance: 0.001 }));
  await MeshoptSimplifier.ready;
  await doc.transform(simplify({ simplifier: MeshoptSimplifier, ratio: 0.015, error: 0.02 }), prune());
  for (const m of root.listMeshes()) for (const p of m.listPrimitives()) p.setAttribute("NORMAL", smoothNormals(doc, p));
  // centre and scale: the pair (two rings and the chain) ~25 cm end to end
  const scene = root.listScenes()[0];
  const b = getBounds(scene);
  const size = b.max.map((v, i) => v - b.min[i]);
  const s = 0.25 / Math.max(...size);
  const c = b.min.map((v, i) => (v + b.max[i]) / 2);
  const top = doc.createNode("cuffs").setScale([s, s, s]).setTranslation(c.map((v) => -v * s));
  for (const n of scene.listChildren()) {
    scene.removeChild(n);
    top.addChild(n);
  }
  scene.addChild(top);
  // polished steel
  for (const m of root.listMaterials()) m.setBaseColorFactor([0.62, 0.63, 0.66, 1]).setMetallicFactor(1).setRoughnessFactor(0.32);
  let tris = 0;
  for (const m of root.listMeshes()) for (const p of m.listPrimitives()) tris += p.getIndices().getCount() / 3;
  console.log("handcuffs: size (m)", size.map((v) => +(v * s).toFixed(3)), "triangles", tris);
  await io.write(`${outDir}/handcuffs.glb`, doc);
}

// ------------------------------------------------------------------ locker
if (has(lockerIn)) {
  const doc = await io.read(lockerIn);
  await doc.transform(textureCompress({ encoder: sharp, targetFormat: "webp", resize: [1024, 1024], quality: 82 }), prune());
  console.log("locker: textures", doc.getRoot().listTextures().map((t) => t.getMimeType() + " " + t.getSize()));
  await io.write(`${outDir}/locker.glb`, doc);
}

// ------------------------------------------------------------------ barricade boxes
for (const [src, name] of [[woodIn, "wood_box"], [rationIn, "ration_box"]]) {
  if (!has(src)) continue;
  const doc = await io.read(src);
  // the wooden-box file is a heap of six crates at odd angles: each one becomes its own node at the
  // scene root, upright (its shortest side up, longest along z), biggest first — Props makes each a
  // variant
  if (name === "wood_box") separateCrates(doc);
  await doc.transform(dedup(), textureCompress({ encoder: sharp, targetFormat: "webp", resize: [512, 512], quality: 80 }), prune());
  await io.write(`${outDir}/${name}.glb`, doc);
  console.log(name, "written");
}

// ------------------------------------------------------------------ betamax tape
if (has(tapeIn)) {
  const doc = await io.read(tapeIn);
  // (Sketchfab's wrapper nodes turn it for their viewer: the mesh's own axes are the box's)
  for (const n of doc.getRoot().listNodes()) n.setTranslation([0, 0, 0]).setRotation([0, 0, 0, 1]).setScale([1, 1, 1]);
  // (Babylon builds tangents for the normal map in the shader)
  for (const m of doc.getRoot().listMeshes()) for (const p of m.listPrimitives()) p.setAttribute("TANGENT", null);
  await doc.transform(dedup(), flatten(), textureCompress({ encoder: sharp, targetFormat: "webp", resize: [1024, 1024], quality: 82 }), prune());
  const root = doc.getRoot();
  const scene = root.listScenes()[0];
  const b = getBounds(scene);
  const size = b.max.map((v, i) => v - b.min[i]);
  // its axes, longest first: the long one → x, the middle one → z, the thin one → y (a proper rotation)
  const order = [0, 1, 2].sort((i, j) => size[j] - size[i]);
  const M = [[0, 0, 0], [0, 0, 0], [0, 0, 0]];
  M[0][order[0]] = 1;
  M[2][order[1]] = 1;
  M[1][order[2]] = 1;
  const det = M[0][0] * (M[1][1] * M[2][2] - M[1][2] * M[2][1]) - M[0][1] * (M[1][0] * M[2][2] - M[1][2] * M[2][0]) + M[0][2] * (M[1][0] * M[2][1] - M[1][1] * M[2][0]);
  if (det < 0) M[1][order[2]] = -1;
  const s = 0.156 / size[order[0]];
  const c = b.min.map((v, i) => (v + b.max[i]) / 2);
  // (centre first, then turn and scale)
  const centre = doc.createNode("tapeCentre").setTranslation(c.map((v) => -v));
  for (const n of scene.listChildren()) {
    scene.removeChild(n);
    centre.addChild(n);
  }
  const top = doc.createNode("tape").setScale([s, s, s]).setRotation(quat(M)).addChild(centre);
  scene.addChild(top);
  console.log("tape: size (m)", order.map((i) => +(size[i] * s).toFixed(3)), "textures", root.listTextures().map((t) => t.getMimeType() + " " + t.getSize()));
  await io.write(`${outDir}/betamax.glb`, doc);
}

// ------------------------------------------------------------------ commodore 64
if (has(c64In)) {
  const doc = await io.read(c64In);
  const root = doc.getRoot();
  const named = { "commodore 64_0": "c64", "1541_3": "drive", "joystick c1311_2": "joystick", "video monitor 1702_6": "monitor" };
  for (const n of root.listNodes()) {
    const name = n.getName();
    if (/cable|plug|power adapter/i.test(name)) n.dispose();
    else if (named[name]) n.setName(named[name]);
  }
  // (the glass: the monitor's mesh with the screen material, split off as its own node)
  for (const n of root.listNodes()) {
    const mesh = n.getMesh();
    if (mesh && mesh.listPrimitives().some((p) => p.getMaterial()?.getName() === "monitor_screen")) n.setName("screen");
  }
  await doc.transform(textureCompress({ encoder: sharp, targetFormat: "webp", resize: [1024, 1024], quality: 82 }), prune({ keepLeaves: true }));
  const scene = root.listScenes()[0];
  const b = getBounds(root.listNodes().find((n) => n.getName() === "c64"));
  const s = 0.404 / (b.max[0] - b.min[0]);
  const all = getBounds(scene);
  const top = doc.createNode("c64set").setScale([s, s, s]).setTranslation([-(all.min[0] + all.max[0]) / 2 * s, -all.min[1] * s, -(all.min[2] + all.max[2]) / 2 * s]);
  for (const n of scene.listChildren()) {
    scene.removeChild(n);
    top.addChild(n);
  }
  scene.addChild(top);
  const size = all.max.map((v, i) => +((v - all.min[i]) * s).toFixed(3));
  console.log("c64: set size (m)", size, "nodes", root.listNodes().map((n) => n.getName()).filter((n) => /c64|drive|joystick|monitor|screen/.test(n)));
  await io.write(`${outDir}/c64.glb`, doc);
}

/** area-weighted vertex normals */
function smoothNormals(doc, prim) {
  const pos = prim.getAttribute("POSITION").getArray();
  const idx = prim.getIndices().getArray();
  const n = new Float32Array(pos.length);
  for (let t = 0; t < idx.length; t += 3) {
    const a = idx[t] * 3, b = idx[t + 1] * 3, c = idx[t + 2] * 3;
    const ux = pos[b] - pos[a], uy = pos[b + 1] - pos[a + 1], uz = pos[b + 2] - pos[a + 2];
    const vx = pos[c] - pos[a], vy = pos[c + 1] - pos[a + 1], vz = pos[c + 2] - pos[a + 2];
    const nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
    for (const i of [a, b, c]) (n[i] += nx), (n[i + 1] += ny), (n[i + 2] += nz);
  }
  for (let i = 0; i < n.length; i += 3) {
    const l = Math.hypot(n[i], n[i + 1], n[i + 2]) || 1;
    n[i] /= l, n[i + 1] /= l, n[i + 2] /= l;
  }
  return doc.createAccessor().setType("VEC3").setArray(n).setBuffer(doc.getRoot().listBuffers()[0]);
}

function separateCrates(doc) {
  const root = doc.getRoot();
  const scene = root.listScenes()[0];
  const crates = root.listNodes().filter((n) => n.getMesh());
  const size = (n) => {
    const P = n.getMesh().listPrimitives()[0].getAttribute("POSITION");
    const mn = P.getMin([]), mx = P.getMax([]);
    return mx.map((v, i) => v - mn[i]);
  };
  crates.sort((a, b) => Math.max(...size(b)) * Math.min(...size(b)) - Math.max(...size(a)) * Math.min(...size(a)));
  for (const n of scene.listChildren()) scene.removeChild(n);
  crates.forEach((n, i) => {
    const s = size(n);
    const up = s.indexOf(Math.min(...s)), long = s.indexOf(Math.max(...s)), other = 3 - up - long;
    // rotation matrix columns: local up → +Y, local long → +Z, the other → ±X (a proper rotation)
    const M = [[0, 0, 0], [0, 0, 0], [0, 0, 0]];
    M[1][up] = 1;
    M[2][long] = 1;
    M[0][other] = 1;
    const det = M[0][0] * (M[1][1] * M[2][2] - M[1][2] * M[2][1]) - M[0][1] * (M[1][0] * M[2][2] - M[1][2] * M[2][0]) + M[0][2] * (M[1][0] * M[2][1] - M[1][1] * M[2][0]);
    if (det < 0) M[0][other] = -1;
    const node = doc.createNode(`crate${i}`).setMesh(n.getMesh()).setRotation(quat(M));
    scene.addChild(node);
    console.log(`  crate${i}: ${s.map((v) => v.toFixed(2)).join(" × ")} (local), up axis ${up}, long axis ${long}`);
  });
  for (const n of root.listNodes()) if (!n.getName().startsWith("crate")) n.dispose();
}

/** rotation matrix (rows) → quaternion [x, y, z, w] */
function quat(m) {
  const t = m[0][0] + m[1][1] + m[2][2];
  let x, y, z, w;
  if (t > 0) {
    const s = Math.sqrt(t + 1) * 2;
    w = s / 4;
    x = (m[2][1] - m[1][2]) / s;
    y = (m[0][2] - m[2][0]) / s;
    z = (m[1][0] - m[0][1]) / s;
  } else if (m[0][0] > m[1][1] && m[0][0] > m[2][2]) {
    const s = Math.sqrt(1 + m[0][0] - m[1][1] - m[2][2]) * 2;
    w = (m[2][1] - m[1][2]) / s;
    x = s / 4;
    y = (m[0][1] + m[1][0]) / s;
    z = (m[0][2] + m[2][0]) / s;
  } else if (m[1][1] > m[2][2]) {
    const s = Math.sqrt(1 + m[1][1] - m[0][0] - m[2][2]) * 2;
    w = (m[0][2] - m[2][0]) / s;
    x = (m[0][1] + m[1][0]) / s;
    y = s / 4;
    z = (m[1][2] + m[2][1]) / s;
  } else {
    const s = Math.sqrt(1 + m[2][2] - m[0][0] - m[1][1]) * 2;
    w = (m[1][0] - m[0][1]) / s;
    x = (m[0][2] + m[2][0]) / s;
    y = (m[1][2] + m[2][1]) / s;
    z = s / 4;
  }
  return [x, y, z, w];
}
