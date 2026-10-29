// Summarise a .glb without loading it into context: asset credit, node tree (with transforms and
// matrices), meshes (vertex count, material, skinned?, bounds), materials, images, skins, animations.
//   node glb-info.mjs <file.glb> [--nodes] [--filter=<regex on node names>]
// Positions are read with the bufferView's byteStride (Sketchfab exports are often interleaved).
import fs from "fs";
const [, , file, ...flags] = process.argv;
const showNodes = flags.includes("--nodes");
const filt = flags.find((f) => f.startsWith("--filter="))?.slice(9);
const buf = fs.readFileSync(file);
const jl = buf.readUInt32LE(12);
const j = JSON.parse(buf.slice(20, 20 + jl).toString());
const r3 = (a) => a && a.map((x) => +x.toFixed(3));
console.log("asset", JSON.stringify(j.asset?.extras ?? j.asset));
console.log(`nodes ${j.nodes?.length} meshes ${j.meshes?.length} materials ${j.materials?.length} images ${j.images?.length} skins ${j.skins?.map((s) => s.joints.length)} anims ${j.animations?.map((a) => a.name + ":" + a.channels.length)} ext ${j.extensionsUsed}`);
const parent = {};
j.nodes.forEach((n, i) => (n.children || []).forEach((c) => (parent[c] = i)));
const chain = (i) => { const o = []; for (let k = parent[i]; k !== undefined; k = parent[k]) o.push(j.nodes[k].name); return o.join(" < "); };
if (showNodes || filt) {
  const re = filt ? new RegExp(filt, "i") : null;
  j.nodes.forEach((n, i) => {
    if (re && !re.test(n.name ?? "")) return;
    console.log(i, n.name, JSON.stringify({ kids: n.children?.length, mesh: n.mesh, skin: n.skin, t: r3(n.translation), r: r3(n.rotation), s: r3(n.scale), m: r3(n.matrix) }));
  });
}
j.nodes.forEach((n, i) => {
  if (n.mesh === undefined) return;
  const p = j.meshes[n.mesh].primitives[0];
  const a = j.accessors[p.attributes.POSITION];
  console.log("mesh", n.mesh, n.name, "<", chain(i), "|", a.count, "verts", j.materials?.[p.material]?.name, p.attributes.JOINTS_0 !== undefined ? "SKINNED" : "static", "min", r3(a.min), "max", r3(a.max));
});
(j.images || []).forEach((im, i) => console.log("image", i, im.mimeType, ((j.bufferViews[im.bufferView]?.byteLength ?? 0) / 1e6).toFixed(2), "MB"));
for (const an of j.animations || []) {
  const t = an.samplers.map((s) => j.accessors[s.input].max?.[0] ?? 0);
  console.log("anim", an.name, "channels", an.channels.length, "duration", Math.max(...t).toFixed(2), "s");
}
