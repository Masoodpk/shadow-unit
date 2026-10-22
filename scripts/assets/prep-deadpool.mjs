// Deadpool's old weapons for Red Dune (no longer loaded: he carries the sci-fi blasters now):
// the Desert Eagle ("Deadpool's Desert Eagle" by Evgeniy Nesudimov, CC BY 4.0) and his katanas with
// their back harness ("Deadpool's Katanas" by Anthony Yanez, CC BY 4.0).
//  - Deadpool himself is prepared by prep-heroes2.mjs now (his skin weights KEPT: the game re-rigs
//    him on them). Don't strip it again — the old distance-weighted auto-rig stretched his legs.
//  - the Desert Eagle: its display ground plane dropped; textures → 512² WebP.
//  - the katanas: the stray animation dropped; textures → 512² WebP.
//
//   node prep-deadpool.mjs ~/Downloads ../../src/assets/characters
import { NodeIO } from "@gltf-transform/core";
import { ALL_EXTENSIONS } from "@gltf-transform/extensions";
import { dedup, prune, textureCompress } from "@gltf-transform/functions";
import sharp from "sharp";
import path from "node:path";

const [, , src, out] = process.argv;
const io = new NodeIO().registerExtensions(ALL_EXTENSIONS);

// the gun
{
  const doc = await io.read(path.join(src, "deadpools_desert_eagle.glb"));
  for (const n of doc.getRoot().listNodes()) if (/Ground/i.test(n.getName())) n.dispose();
  for (const m of doc.getRoot().listMeshes()) if (/Ground/i.test(m.getName())) m.dispose();
  await doc.transform(prune(), dedup(), textureCompress({ encoder: sharp, targetFormat: "webp", resize: [512, 512], quality: 82 }), prune());
  await io.write(path.join(out, "deagle.glb"), doc);
}
// the katanas
{
  const doc = await io.read(path.join(src, "deadpools_katanas.glb"));
  for (const a of doc.getRoot().listAnimations()) {
    for (const c of a.listChannels()) c.dispose();
    for (const s of a.listSamplers()) s.dispose();
    a.dispose();
  }
  await doc.transform(dedup(), textureCompress({ encoder: sharp, targetFormat: "webp", resize: [512, 512], quality: 82 }), prune());
  await io.write(path.join(out, "katanas.glb"), doc);
}
console.log("done");
