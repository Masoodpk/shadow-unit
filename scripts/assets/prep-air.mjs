// Round 6 for Red Dune: the air war, and Batman's batarang (all from Sketchfab):
//  - "Helicopter Gunship" by DavidFischer (CC BY 4.0) → heli_gunship.glb
//  - "Mil Mi-28NM Havoc" by VTX (CC BY-NC-SA 4.0 — non-commercial) → heli_mi28.glb (201k → ~40k
//    triangles, spec-gloss → metal-rough)
//  - "F-15 free rig" by ARAZ BASIC (CC BY 4.0) → jet_f15.glb
//  - "rigged Northrop YF-23" by metlocaypsecrasy (CC BY 4.0) → jet_yf23.glb
//  - "b-2 spirit" by Kevin Love SketchFab (CC BY 4.0) → jet_b2.glb
//  - "Viettel F50 (A,B,C) "Red Eagle"" by thientrung2004pr (CC BY 4.0) → jet_f50.glb (220k → ~40k)
//  - "Batarang" by Killian_Delias (CC BY 4.0) → batarang.glb
// Clips dropped (the game flies them), textures → WebP.
//
//   node prep-air.mjs ~/Downloads ../../src/assets/characters
import { NodeIO } from "@gltf-transform/core";
import { ALL_EXTENSIONS } from "@gltf-transform/extensions";
import { dedup, metalRough, prune, simplify, textureCompress, weld } from "@gltf-transform/functions";
import { MeshoptSimplifier } from "meshoptimizer";
import sharp from "sharp";
import path from "node:path";

const [, , src, out] = process.argv;
const io = new NodeIO().registerExtensions(ALL_EXTENSIONS);
await MeshoptSimplifier.ready;
const tris = (doc) => doc.getRoot().listMeshes().reduce((n, m) => n + m.listPrimitives().reduce((k, p) => k + (p.getIndices()?.getCount() ?? 0) / 3, 0), 0);
const jobs = [
  ["helicopter_gunship.glb", "heli_gunship.glb", 1, 1024],
  ["mil_mi-28nm_havoc.glb", "heli_mi28.glb", 0.2, 1024],
  ["f-15_free_rig.glb", "jet_f15.glb", 0.6, 1024],
  ["rigged_northrop_yf-23.glb", "jet_yf23.glb", 1, 1024],
  ["b-2_spirit.glb", "jet_b2.glb", 1, 1024],
  ["viettel_f50_abc_red_eagle.glb", "jet_f50.glb", 0.18, 1024],
  ["batarang.glb", "batarang.glb", 1, 256],
];
for (const [inp, outp, ratio, tex] of jobs) {
  const doc = await io.read(path.join(src, inp));
  for (const a of doc.getRoot().listAnimations()) {
    for (const c of a.listChannels()) c.dispose();
    for (const s of a.listSamplers()) s.dispose();
    a.dispose();
  }
  const before = tris(doc);
  await doc.transform(metalRough(), dedup());
  if (ratio < 1) await doc.transform(weld({ tolerance: 0.0001 }), simplify({ simplifier: MeshoptSimplifier, ratio, error: 0.004 }));
  await doc.transform(textureCompress({ encoder: sharp, targetFormat: "webp", resize: [tex, tex], quality: 80 }), prune());
  await io.write(path.join(out, outp), doc);
  console.log(outp, before, "→", tris(doc));
}
