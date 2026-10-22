// PCA + slice profile of a (single-node, baked) GLB: where is the long axis, which way the parts stick out.
import { NodeIO } from "@gltf-transform/core";
import { ALL_EXTENSIONS } from "@gltf-transform/extensions";
const [, , input, ...flags] = process.argv;
const io = new NodeIO().registerExtensions(ALL_EXTENSIONS);
const doc = await io.read(input);
const P = [];
for (const node of doc.getRoot().listNodes()) {
  const mesh = node.getMesh();
  if (!mesh) continue;
  const m = node.getWorldMatrix();
  for (const prim of mesh.listPrimitives()) {
    const pos = prim.getAttribute("POSITION");
    const p = [];
    for (let i = 0; i < pos.getCount(); i++) {
      pos.getElement(i, p);
      P.push([m[0] * p[0] + m[4] * p[1] + m[8] * p[2] + m[12], m[1] * p[0] + m[5] * p[1] + m[9] * p[2] + m[13], m[2] * p[0] + m[6] * p[1] + m[10] * p[2] + m[14]]);
    }
  }
}
const n = P.length;
const c = [0, 0, 0];
for (const p of P) for (let k = 0; k < 3; k++) c[k] += p[k] / n;
const C = [[0, 0, 0], [0, 0, 0], [0, 0, 0]];
for (const p of P) for (let i = 0; i < 3; i++) for (let j = 0; j < 3; j++) C[i][j] += ((p[i] - c[i]) * (p[j] - c[j])) / n;
// power iteration for eigenvectors
const mv = (M, v) => [0, 1, 2].map((i) => M[i][0] * v[0] + M[i][1] * v[1] + M[i][2] * v[2]);
const norm = (v) => { const l = Math.hypot(...v); return v.map((x) => x / l); };
const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const axes = [];
let M = C.map((r) => r.slice());
for (let k = 0; k < 3; k++) {
  let v = norm([Math.random(), Math.random(), Math.random()]);
  for (let it = 0; it < 200; it++) {
    v = mv(M, v);
    for (const a of axes) { const d = dot(v, a); v = v.map((x, i) => x - d * a[i]); }
    v = norm(v);
  }
  axes.push(v);
}
console.log("centroid", c.map((x) => +x.toFixed(4)));
axes.forEach((a, i) => {
  const proj = P.map((p) => dot([p[0] - c[0], p[1] - c[1], p[2] - c[2]], a));
  console.log(`axis${i}`, a.map((x) => +x.toFixed(4)), "range", +Math.min(...proj).toFixed(4), +Math.max(...proj).toFixed(4));
});
// slice profile along axis0: for each 5% slice, min/max along axis1 and axis2
const a0 = axes[0], a1 = axes[1], a2 = axes[2];
const pr = P.map((p) => { const d = [p[0] - c[0], p[1] - c[1], p[2] - c[2]]; return [dot(d, a0), dot(d, a1), dot(d, a2)]; });
const lo = Math.min(...pr.map((q) => q[0])), hi = Math.max(...pr.map((q) => q[0]));
const N = +(flags.find((f) => f.startsWith("--slices="))?.slice(9) ?? 20);
for (let s = 0; s < N; s++) {
  const a = lo + ((hi - lo) * s) / N, b = lo + ((hi - lo) * (s + 1)) / N;
  const q = pr.filter((x) => x[0] >= a && x[0] < b);
  if (!q.length) continue;
  const r1 = [Math.min(...q.map((x) => x[1])), Math.max(...q.map((x) => x[1]))];
  const r2 = [Math.min(...q.map((x) => x[2])), Math.max(...q.map((x) => x[2]))];
  console.log(`${a.toFixed(3).padStart(7)}..${b.toFixed(3).padStart(7)}  a1 ${r1[0].toFixed(3).padStart(7)} ${r1[1].toFixed(3).padStart(7)}   a2 ${r2[0].toFixed(3).padStart(7)} ${r2[1].toFixed(3).padStart(7)}  n=${q.length}`);
}
