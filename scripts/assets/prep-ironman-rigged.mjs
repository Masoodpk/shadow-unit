// Iron Man, rigged ("Iron man Flying animation" by 19503, CC BY 4.0: a Mixamo skeleton — fingers
// too — and Mixamo's flying clip). 142k triangles → joined and simplified (skin weights kept),
// textures → 2048² WebP, the clip resampled.
//
//   node prep-ironman-rigged.mjs ~/Downloads/iron_man_flying_animation.glb ../../src/assets/characters/ironman_rigged.glb
import { NodeIO } from "@gltf-transform/core";
import { ALL_EXTENSIONS } from "@gltf-transform/extensions";
import { dedup, join, prune, resample, simplify, textureCompress, weld } from "@gltf-transform/functions";
import { MeshoptSimplifier } from "meshoptimizer";
import sharp from "sharp";

const [, , input, output] = process.argv;
const io = new NodeIO().registerExtensions(ALL_EXTENSIONS);
const doc = await io.read(input);
const tris = () => doc.getRoot().listMeshes().reduce((n, m) => n + m.listPrimitives().reduce((k, p) => k + (p.getIndices()?.getCount() ?? 0) / 3, 0), 0);
console.log("triangles in", tris());
await MeshoptSimplifier.ready;
await doc.transform(dedup(), join({ keepNamed: false }), weld({ tolerance: 0.0001 }));
await doc.transform(simplify({ simplifier: MeshoptSimplifier, ratio: 0.34, error: 0.0015 }), resample(), prune());
console.log("triangles out", tris(), "meshes", doc.getRoot().listMeshes().length, "skins", doc.getRoot().listSkins().length, "anims", doc.getRoot().listAnimations().map((a) => a.getName()));
await doc.transform(textureCompress({ encoder: sharp, targetFormat: "webp", resize: [2048, 2048], quality: 84 }), prune());
await io.write(output, doc);
