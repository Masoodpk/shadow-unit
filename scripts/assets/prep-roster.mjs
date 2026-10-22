// The roster's characters (Sketchfab, CC BY 4.0 — see the credits): textures → 1024² WebP, the
// heavy ones simplified (skin weights kept), their own clips kept (Darkseid's, the HatchXR ones).
//
//   node prep-roster.mjs ~/Downloads ../../src/assets/roster
import { NodeIO } from "@gltf-transform/core";
import { ALL_EXTENSIONS } from "@gltf-transform/extensions";
import { dedup, metalRough, prune, resample, simplify, textureCompress, weld } from "@gltf-transform/functions";
import { MeshoptSimplifier } from "meshoptimizer";
import sharp from "sharp";
import path from "node:path";

const [, , src, out] = process.argv;
const io = new NodeIO().registerExtensions(ALL_EXTENSIONS);
await MeshoptSimplifier.ready;
const tris = (doc) => doc.getRoot().listMeshes().reduce((n, m) => n + m.listPrimitives().reduce((k, p) => k + (p.getIndices()?.getCount() ?? 0) / 3, 0), 0);
const jobs = [
  ["thanos_textured_rigged.glb", "thanos.glb", 1],
  ["darkseidtexturedrigged.glb", "darkseid.glb", 1],
  ["rocket_racoontexturedrigged.glb", "rocket.glb", 1],
  ["rigged_jocker.glb", "joker.glb", 1],
  ["the_flash_rigged_hatchxr.glb", "flash.glb", 1],
  ["draxtexturedrigged.glb", "drax.glb", 1],
  ["star-lord_from_guardians_of_the_galaxy_vol_3.glb", "starlord.glb", 0.12],
  ["ronantexturedrigged.glb", "ronan.glb", 1],
  ["dr_doom_v2.glb", "doom.glb", 0.35],
  ["ultron_infinity_textured_rigged.glb", "ultron.glb", 1],
  ["captain_marveltexturedrigged.glb", "captain_marvel.glb", 1],
  ["captain_americatexturedrigged.glb", "captain_america.glb", 1],
  ["thortexturedrigged.glb", "thor.glb", 1],
];
for (const [inp, outp, ratio] of jobs) {
  const doc = await io.read(path.join(src, inp));
  const before = tris(doc);
  await doc.transform(metalRough(), dedup());
  if (ratio < 1) await doc.transform(weld({ tolerance: 0.0001 }), simplify({ simplifier: MeshoptSimplifier, ratio, error: 0.003 }));
  await doc.transform(resample(), textureCompress({ encoder: sharp, targetFormat: "webp", resize: [1024, 1024], quality: 82 }), prune({ keepLeaves: true }));
  await io.write(path.join(out, outp), doc);
  console.log(outp, before, "→", tris(doc));
}
