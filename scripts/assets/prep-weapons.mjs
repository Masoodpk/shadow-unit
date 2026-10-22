// Prepare the knife / launcher GLBs for the game: bake skins, drop display props,
// convert spec/gloss → metal/rough, WebP textures ≤1024, prune. Prints geometry stats.
import { NodeIO } from "@gltf-transform/core";
import { ALL_EXTENSIONS } from "@gltf-transform/extensions";
import { dedup, prune, textureCompress, metalRough, weld, flatten, join } from "@gltf-transform/functions";
import sharp from "sharp";

const [, , input, output, ...flags] = process.argv;
const io = new NodeIO().registerExtensions(ALL_EXTENSIONS);
const doc = await io.read(input);
const root = doc.getRoot();

const mul = (a, b) => {
  const o = new Array(16).fill(0);
  for (let c = 0; c < 4; c++) for (let r = 0; r < 4; r++) for (let k = 0; k < 4; k++) o[c * 4 + r] += a[k * 4 + r] * b[c * 4 + k];
  return o;
};
const xf = (m, x, y, z, w = 1) => [m[0] * x + m[4] * y + m[8] * z + m[12] * w, m[1] * x + m[5] * y + m[9] * z + m[13] * w, m[2] * x + m[6] * y + m[10] * z + m[14] * w];

// 1. drop nodes by name fragment (e.g. the Sketchfab display plane)
const drop = flags.filter((f) => f.startsWith("--drop=")).map((f) => f.slice(7));
for (const n of root.listNodes()) if (drop.some((d) => n.getName().includes(d))) n.dispose();

// 2. bake skinned meshes into static world-space geometry
for (const node of root.listNodes()) {
  const skin = node.getSkin();
  const mesh = node.getMesh();
  if (!skin || !mesh) continue;
  const joints = skin.listJoints();
  const ibm = skin.getInverseBindMatrices();
  const jm = joints.map((j, i) => mul(j.getWorldMatrix(), ibm ? ibm.getElement(i, []) : [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]));
  for (const prim of mesh.listPrimitives()) {
    const pos = prim.getAttribute("POSITION");
    const nor = prim.getAttribute("NORMAL");
    const J = prim.getAttribute("JOINTS_0");
    const W = prim.getAttribute("WEIGHTS_0");
    const pArr = pos.getArray().slice();
    const nArr = nor ? nor.getArray().slice() : null;
    const j4 = [], w4 = [], p = [], n = [];
    for (let i = 0; i < pos.getCount(); i++) {
      J.getElement(i, j4);
      W.getElement(i, w4);
      pos.getElement(i, p);
      let px = 0, py = 0, pz = 0, nx = 0, ny = 0, nz = 0;
      for (let k = 0; k < 4; k++) {
        const w = w4[k];
        if (!w) continue;
        const m = jm[j4[k]];
        const q = xf(m, p[0], p[1], p[2]);
        px += q[0] * w; py += q[1] * w; pz += q[2] * w;
        if (nArr) {
          nor.getElement(i, n);
          const r = xf(m, n[0], n[1], n[2], 0);
          nx += r[0] * w; ny += r[1] * w; nz += r[2] * w;
        }
      }
      pArr[i * 3] = px; pArr[i * 3 + 1] = py; pArr[i * 3 + 2] = pz;
      if (nArr) {
        const l = Math.hypot(nx, ny, nz) || 1;
        nArr[i * 3] = nx / l; nArr[i * 3 + 1] = ny / l; nArr[i * 3 + 2] = nz / l;
      }
    }
    pos.setArray(pArr);
    if (nor) nor.setArray(nArr);
    prim.setAttribute("JOINTS_0", null);
    prim.setAttribute("WEIGHTS_0", null);
  }
  // geometry is now in scene space: put the node at the scene root with an identity transform
  node.setSkin(null);
  const parent = node.getParentNode();
  if (parent) parent.removeChild(node);
  for (const s of root.listScenes()) s.addChild(node);
  node.setMatrix([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]);
}
for (const s of root.listSkins()) s.dispose();

// --cull-x-below=v: drop triangles with a vertex at world x < v (glTF frame) — removes duplicate props
const cullFlag = flags.find((f) => f.startsWith("--cull-x-below="));
if (cullFlag) {
  const lim = parseFloat(cullFlag.slice(15));
  for (const node of root.listNodes()) {
    const mesh = node.getMesh();
    if (!mesh) continue;
    const W = node.getWorldMatrix();
    for (const prim of mesh.listPrimitives()) {
      const pos = prim.getAttribute("POSITION");
      const idx = prim.getIndices();
      const ia = idx.getArray();
      const keep = [];
      const p = [];
      const wx = (i) => (pos.getElement(i, p), xf(W, p[0], p[1], p[2])[0]);
      for (let t = 0; t < ia.length; t += 3) if (wx(ia[t]) >= lim && wx(ia[t + 1]) >= lim && wx(ia[t + 2]) >= lim) keep.push(ia[t], ia[t + 1], ia[t + 2]);
      idx.setArray(new Uint32Array(keep));
      console.log("cull: kept", keep.length / 3, "of", ia.length / 3, "triangles");
    }
  }
}

// optional re-orientation: --basis=fx,fy,fz,ux,uy,uz maps that forward → +Z and up → +Y (then --scale)
const basisFlag = flags.find((f) => f.startsWith("--basis="));
const scaleFlag = flags.find((f) => f.startsWith("--scale="));
const centerFlag = flags.includes("--center");
if (basisFlag || scaleFlag) {
  const s = scaleFlag ? parseFloat(scaleFlag.slice(8)) : 1;
  let R = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];
  if (basisFlag) {
    const v = basisFlag.slice(8).split(",").map(Number);
    const nrm = (a) => { const l = Math.hypot(...a); return a.map((x) => x / l); };
    const f = nrm(v.slice(0, 3));
    let u = v.slice(3, 6);
    const d = u[0] * f[0] + u[1] * f[1] + u[2] * f[2];
    u = nrm(u.map((x, i) => x - d * f[i]));
    const r = [u[1] * f[2] - u[2] * f[1], u[2] * f[0] - u[0] * f[2], u[0] * f[1] - u[1] * f[0]]; // up × fwd = +X (RH)
    // rows of the rotation are the new axes: p' = (p·r, p·u, p·f)
    R = [r[0], u[0], f[0], 0, r[1], u[1], f[1], 0, r[2], u[2], f[2], 0, 0, 0, 0, 1];
  }
  for (const node of root.listNodes()) {
    const mesh = node.getMesh();
    if (!mesh) continue;
    const W = node.getWorldMatrix();
    const M = mul(R, W);
    for (const prim of mesh.listPrimitives()) {
      for (const [sem, isDir] of [["POSITION", false], ["NORMAL", true]]) {
        const acc = prim.getAttribute(sem);
        if (!acc) continue;
        const arr = acc.getArray().slice();
        for (let i = 0; i < acc.getCount(); i++) {
          const q = xf(M, arr[i * 3], arr[i * 3 + 1], arr[i * 3 + 2], isDir ? 0 : 1);
          if (isDir) {
            const l = Math.hypot(...q) || 1;
            arr.set(q.map((x) => x / l), i * 3);
          } else arr.set(q.map((x) => x * s), i * 3);
        }
        acc.setArray(arr);
      }
    }
    const parent = node.getParentNode();
    if (parent) parent.removeChild(node);
    for (const sc of root.listScenes()) sc.addChild(node);
    node.setMatrix([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]);
  }
}
void centerFlag;

// baking transforms with a reflection (or skins authored mirrored) inverts the winding:
// a closed, outward-facing mesh has a positive signed volume — reverse the triangles if it's negative
for (const node of root.listNodes()) {
  const mesh = node.getMesh();
  if (!mesh) continue;
  for (const prim of mesh.listPrimitives()) {
    const pos = prim.getAttribute("POSITION");
    const idx = prim.getIndices();
    if (!idx) continue;
    const ia = idx.getArray();
    const a = [], b = [], c = [];
    let vol = 0;
    for (let t = 0; t < ia.length; t += 3) {
      pos.getElement(ia[t], a);
      pos.getElement(ia[t + 1], b);
      pos.getElement(ia[t + 2], c);
      vol += a[0] * (b[1] * c[2] - b[2] * c[1]) - a[1] * (b[0] * c[2] - b[2] * c[0]) + a[2] * (b[0] * c[1] - b[1] * c[0]);
    }
    const want = flags.includes("--flip") ? -1 : 1;
    if (Math.sign(vol) !== want) {
      const out = ia.slice();
      for (let t = 0; t < out.length; t += 3) {
        const tmp = out[t + 1];
        out[t + 1] = out[t + 2];
        out[t + 2] = tmp;
      }
      idx.setArray(out);
      console.log("flipped winding on", node.getName(), "signed volume was", vol.toExponential(2));
    }
  }
}

const transforms = [dedup()];
if (flags.includes("--metalrough")) transforms.push(metalRough());
transforms.push(flatten(), join(), weld(), prune({ keepAttributes: false }), textureCompress({ encoder: sharp, targetFormat: "webp", resize: [1024, 1024], quality: 88 }));
await doc.transform(...transforms);

// 3. stats: world bounds of all geometry
let min = [Infinity, Infinity, Infinity], max = [-Infinity, -Infinity, -Infinity], tris = 0;
for (const node of root.listNodes()) {
  const mesh = node.getMesh();
  if (!mesh) continue;
  const m = node.getWorldMatrix();
  for (const prim of mesh.listPrimitives()) {
    const pos = prim.getAttribute("POSITION");
    const p = [];
    for (let i = 0; i < pos.getCount(); i++) {
      pos.getElement(i, p);
      const q = xf(m, p[0], p[1], p[2]);
      for (let k = 0; k < 3; k++) {
        min[k] = Math.min(min[k], q[k]);
        max[k] = Math.max(max[k], q[k]);
      }
    }
    tris += (prim.getIndices()?.getCount() ?? pos.getCount()) / 3;
  }
}
console.log(JSON.stringify({ output, tris, min: min.map((v) => +v.toFixed(4)), max: max.map((v) => +v.toFixed(4)), size: max.map((v, i) => +(v - min[i]).toFixed(4)), nodes: root.listNodes().map((n) => n.getName()), materials: root.listMaterials().map((m) => m.getName()) }));
await io.write(output, doc);
