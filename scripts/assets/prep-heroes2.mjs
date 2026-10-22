// Round 4 heroes for Red Dune (all CC BY 4.0, from Sketchfab):
//  - "Spiderman Rigged" by nitwit.friends: a Mixamo skeleton (fingers too) and 14 clips of his own
//    → spiderman_rigged.glb (clips resampled, textures → 1024² WebP).
//  - "Wolverine | Rigged | Deadpool And Wolverine" by K Animator: a 3ds Max Biped skeleton
//    → wolverine.glb (its one stray clip dropped, textures → 1024² WebP).
//  - "Scifi Gun" by Max: Deadpool's pistols → scifi_gun.glb (deduplicated; no textures).
//  - "Deadpool - Marvel" by DEV STUDIOS 3D: this time his skin weights are KEPT (the game re-rigs
//    him on his own artist's weights) → deadpool.glb (textures → 2048² WebP).
//
//   node prep-heroes2.mjs ~/Downloads ../../src/assets/characters
import { NodeIO } from "@gltf-transform/core";
import { ALL_EXTENSIONS } from "@gltf-transform/extensions";
import { dedup, prune, resample, textureCompress } from "@gltf-transform/functions";
import sharp from "sharp";
import path from "node:path";

const [, , src, out] = process.argv;
const io = new NodeIO().registerExtensions(ALL_EXTENSIONS);
const dropAnims = (doc) => {
  for (const a of doc.getRoot().listAnimations()) {
    for (const c of a.listChannels()) c.dispose();
    for (const s of a.listSamplers()) s.dispose();
    a.dispose();
  }
};
{
  const doc = await io.read(path.join(src, "spiderman_rigged.glb"));
  await doc.transform(dedup(), resample(), textureCompress({ encoder: sharp, targetFormat: "webp", resize: [1024, 1024], quality: 84 }), prune());
  await io.write(path.join(out, "spiderman_rigged.glb"), doc);
}
{
  const doc = await io.read(path.join(src, "wolverine__rigged__deadpool_and_wolverine.glb"));
  dropAnims(doc);
  await doc.transform(dedup(), textureCompress({ encoder: sharp, targetFormat: "webp", resize: [1024, 1024], quality: 84 }), prune());
  await io.write(path.join(out, "wolverine.glb"), doc);
}
{
  const doc = await io.read(path.join(src, "scifi_gun.glb"));
  await doc.transform(dedup(), prune());
  await io.write(path.join(out, "scifi_gun.glb"), doc);
}
{
  const doc = await io.read(path.join(src, "deadpool_-_marvel.glb"));
  dropAnims(doc);
  await doc.transform(dedup(), textureCompress({ encoder: sharp, targetFormat: "webp", resize: [2048, 2048], quality: 84 }), prune());
  await io.write(path.join(out, "deadpool.glb"), doc);
}
console.log("done");
