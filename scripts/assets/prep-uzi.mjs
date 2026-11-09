// The UZI with its own arms ("UZI | First Person Animations (2026 Remake)" by 1Matzh, CC BY 4.0): one skinned
// rig (arms, gloves, sleeves, watch, gun, magazine) with 13 named clips. The file's aim-helper planes
// (Aim, AimBottom) and its backdrop card ("Background") are dropped, keyframes resampled (redundant keys
// removed), textures → WebP at `size` (never upscaled; the file's 20 PNG maps are ~22 MB).
//
// Its skin is repaired: the Sketchfab conversion left the vertices in a space that differs from what the
// inverse bind matrices expect by one shared affine map (the bind matrices are consistent with each other —
// every parent→child bind is rigid and equals the node's own offset — but the mesh's x axis is ~4.4× the
// others and it sits in centimetre-ish units), so every engine drew long stretched spikes. The map X is
// solved by least squares: for each bone, the centroid c of the vertices it owns (weight > 0.95) must land on
// the bone in the rest pose, restWorld · IBM · (X c) ≈ bone position (40 bones, median error ~1 cm), and the
// positions (and normals, by the inverse transpose) are baked through X.
//   node prep-uzi.mjs ~/Downloads/uzi__first_person_animations_2026_remake.glb ../../src/assets/weapons/uzi.glb 1024
import { NodeIO } from "@gltf-transform/core";
import { ALL_EXTENSIONS, EXTTextureWebP } from "@gltf-transform/extensions";
import { dedup, prune, resample } from "@gltf-transform/functions";
import sharp from "sharp";

const [, , input, output, sizeArg] = process.argv;
const size = parseInt(sizeArg ?? "1024");
const io = new NodeIO().registerExtensions(ALL_EXTENSIONS);
const doc = await io.read(input);
const root = doc.getRoot();

for (const node of root.listNodes()) {
  const mesh = node.getMesh();
  const bg = mesh && mesh.listPrimitives().some((p) => p.getMaterial()?.getName() === "Background");
  if (/^(Aim|AimBottom)$/.test(node.getName()) || bg) node.dispose();
}
await doc.transform(resample(), prune(), dedup());

// ---- the skin repair (see the header)
const mul = (a, b) => { const o = new Array(16).fill(0); for (let c = 0; c < 4; c++) for (let r = 0; r < 4; r++) for (let k = 0; k < 4; k++) o[c * 4 + r] += a[k * 4 + r] * b[c * 4 + k]; return o; };
const skin = root.listSkins()[0];
const joints = skin.listJoints();
const ibm = skin.getInverseBindMatrices().getArray();
const prims = [];
for (const node of root.listNodes()) if (node.getMesh() && node.getSkin()) prims.push(...node.getMesh().listPrimitives());
const acc = new Map();
for (const p of prims) {
  const P = p.getAttribute("POSITION"), J = p.getAttribute("JOINTS_0"), W = p.getAttribute("WEIGHTS_0");
  for (let i = 0; i < P.getCount(); i++) {
    const w = W.getElement(i, []), j = J.getElement(i, []), v = P.getElement(i, []);
    for (let k = 0; k < 4; k++) if (w[k] > 0.95) { const a = acc.get(j[k]) ?? [0, 0, 0, 0]; a[0] += v[0]; a[1] += v[1]; a[2] += v[2]; a[3]++; acc.set(j[k], a); }
  }
}
const rows = [], rhs = [];
for (const [j, a] of acc) {
  if (a[3] < 20) continue;
  const c = [a[0] / a[3], a[1] / a[3], a[2] / a[3], 1];
  const rw = joints[j].getWorldMatrix();
  const G = mul(rw, Array.from(ibm.slice(j * 16, j * 16 + 16)));
  for (let r = 0; r < 3; r++) {
    const row = new Array(12).fill(0);
    for (let k = 0; k < 3; k++) for (let m = 0; m < 4; m++) row[k * 4 + m] = G[k * 4 + r] * c[m];
    rows.push(row);
    rhs.push(rw[12 + r] - G[12 + r]);
  }
}
const N = 12, A = Array.from({ length: N }, () => new Array(N + 1).fill(0));
for (let i = 0; i < rows.length; i++) for (let a = 0; a < N; a++) { for (let b = 0; b < N; b++) A[a][b] += rows[i][a] * rows[i][b]; A[a][N] += rows[i][a] * rhs[i]; }
for (let i = 0; i < N; i++) {
  let pv = i;
  for (let r = i + 1; r < N; r++) if (Math.abs(A[r][i]) > Math.abs(A[pv][i])) pv = r;
  [A[i], A[pv]] = [A[pv], A[i]];
  for (let r = 0; r < N; r++) if (r !== i) { const f = A[r][i] / A[i][i]; for (let c = i; c <= N; c++) A[r][c] -= f * A[i][c]; }
}
const X = A.map((r, i) => r[N] / r[i]);   // rows of the 3×4 map
console.log("skin repair X", [0, 1, 2].map((k) => X.slice(k * 4, k * 4 + 4).map((x) => x.toExponential(3)).join(" ")).join(" | "));
// normals: inverse transpose of the 3×3 part
const m3 = [[X[0], X[1], X[2]], [X[4], X[5], X[6]], [X[8], X[9], X[10]]];
const det = m3[0][0] * (m3[1][1] * m3[2][2] - m3[1][2] * m3[2][1]) - m3[0][1] * (m3[1][0] * m3[2][2] - m3[1][2] * m3[2][0]) + m3[0][2] * (m3[1][0] * m3[2][1] - m3[1][1] * m3[2][0]);
const cof = (r, c) => { const rr = [0, 1, 2].filter((i) => i !== r), cc = [0, 1, 2].filter((i) => i !== c); return ((r + c) % 2 ? -1 : 1) * (m3[rr[0]][cc[0]] * m3[rr[1]][cc[1]] - m3[rr[0]][cc[1]] * m3[rr[1]][cc[0]]); };
const nIT = [0, 1, 2].map((r) => [0, 1, 2].map((c) => cof(r, c) / det));   // (M^-1)^T = cofactor / det
const done = new Set();
for (const p of prims) {
  const P = p.getAttribute("POSITION"), Nn = p.getAttribute("NORMAL");
  if (!done.has(P)) {
    done.add(P);
    const v = [];
    for (let i = 0; i < P.getCount(); i++) {
      P.getElement(i, v);
      P.setElement(i, [0, 1, 2].map((k) => X[k * 4] * v[0] + X[k * 4 + 1] * v[1] + X[k * 4 + 2] * v[2] + X[k * 4 + 3]));
    }
  }
  if (Nn && !done.has(Nn)) {
    done.add(Nn);
    const n = [];
    for (let i = 0; i < Nn.getCount(); i++) {
      Nn.getElement(i, n);
      const q = nIT.map((r) => r[0] * n[0] + r[1] * n[1] + r[2] * n[2]);
      const l = Math.hypot(...q) || 1;
      Nn.setElement(i, q.map((x) => x / l));
    }
  }
  // a mirrored map (det < 0) flips the winding: restore it so faces stay front-facing
  if (det < 0) {
    const idx = p.getIndices();
    if (idx && !done.has(idx)) {
      done.add(idx);
      const arr = idx.getArray();
      for (let i = 0; i < arr.length; i += 3) { const t = arr[i + 1]; arr[i + 1] = arr[i + 2]; arr[i + 2] = t; }
      idx.setArray(arr);
    }
  }
  p.setAttribute("TANGENT", null);
}

doc.createExtension(EXTTextureWebP).setRequired(true);
let bytes = 0;
for (const tex of root.listTextures()) {
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
