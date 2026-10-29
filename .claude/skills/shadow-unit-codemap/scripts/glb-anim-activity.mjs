// Where the actions are on a single-timeline animation (FPS viewmodels often pack draw / fire /
// reload / inspect into one clip): motion per node per time bin, so the clip boundaries show up as
// quiet columns. Then print chosen nodes' values over time to read events (mag out, bolt back…).
//   node glb-anim-activity.mjs <file.glb> [--bin=0.2] [--nodes=bolt,clip,carbine] [--anim=0]
import fs from "fs";
const [, , file, ...flags] = process.argv;
const opt = (k, d) => flags.find((f) => f.startsWith(`--${k}=`))?.split("=")[1] ?? d;
const bin = parseFloat(opt("bin", "0.2"));
const pick = opt("nodes", "").split(",").filter(Boolean);
const buf = fs.readFileSync(file);
const jl = buf.readUInt32LE(12);
const j = JSON.parse(buf.slice(20, 20 + jl).toString());
const bin0 = buf.slice(20 + jl + 8);
const acc = (i) => {
  const a = j.accessors[i], bv = j.bufferViews[a.bufferView];
  const comp = { SCALAR: 1, VEC3: 3, VEC4: 4 }[a.type];
  const st = bv.byteStride || comp * 4, off = bin0.byteOffset + (bv.byteOffset || 0) + (a.byteOffset || 0);
  const dv = new DataView(bin0.buffer), d = new Float32Array(a.count * comp);
  for (let k = 0; k < a.count; k++) for (let c = 0; c < comp; c++) d[k * comp + c] = dv.getFloat32(off + k * st + c * 4, true);
  return { n: a.count, comp, d };
};
const an = j.animations[parseInt(opt("anim", "0"))];
let tEnd = 0;
const rows = [];
for (const ch of an.channels) {
  const s = an.samplers[ch.sampler], t = acc(s.input), v = acc(s.output);
  tEnd = Math.max(tEnd, t.d[t.n - 1]);
  rows.push({ name: j.nodes[ch.target.node].name + ":" + ch.target.path[0], t, v });
}
const nb = Math.ceil(tEnd / bin) + 1;
console.log(`duration ${tEnd.toFixed(2)} s, ${nb} bins of ${bin} s ( . still  - slight  o moving  # big )`);
const tot = new Array(nb).fill(0);
for (const r of rows) {
  const act = new Array(nb).fill(0);
  for (let k = 1; k < r.t.n; k++) {
    let d = 0;
    for (let c = 0; c < r.v.comp; c++) d += Math.abs(r.v.d[k * r.v.comp + c] - r.v.d[(k - 1) * r.v.comp + c]);
    act[Math.min(nb - 1, Math.floor(r.t.d[k] / bin))] += d;
  }
  act.forEach((x, i) => (tot[i] += x));
  if (act.some((x) => x > 1e-3)) console.log(r.name.slice(0, 22).padEnd(23), act.map((x) => (x < 1e-3 ? "." : x < 0.05 ? "-" : x < 0.5 ? "o" : "#")).join(""));
}
console.log("TOTAL".padEnd(23), tot.map((x) => (x < 0.01 ? "." : x < 0.5 ? "-" : x < 2 ? "o" : "#")).join(""));
console.log("seconds".padEnd(23), Array.from({ length: nb }, (_, i) => ((i * bin) % 1 < 1e-6 ? String(Math.round(i * bin) % 10) : " ")).join(""));
for (const name of pick) {
  for (const r of rows.filter((x) => x.name.split(":")[0] === name && x.name.endsWith(":t"))) {
    const line = [];
    for (let tt = 0; tt <= tEnd; tt += bin) {
      let k = 0;
      while (k < r.t.n - 1 && r.t.d[k + 1] <= tt) k++;
      line.push(tt.toFixed(1) + "=" + Array.from(r.v.d.slice(k * r.v.comp, k * r.v.comp + r.v.comp)).map((x) => x.toFixed(1)).join(","));
    }
    console.log(name, "translation:", line.join("  "));
  }
}
