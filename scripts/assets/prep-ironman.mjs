// Iron Man for Red Dune ("Iron Man" by Grant Riley, CC BY-NC 4.0 — a static, unrigged mesh: the
// game rigs it at load, like Spider-Man). 142k triangles and 23 MB of 4K PNGs → the three parts
// joined into one mesh, simplified to ~45k triangles, tangents dropped, textures → 2048² WebP.
//
//   node prep-ironman.mjs ~/Downloads/iron_man.glb ../../src/assets/characters/ironman.glb
//
// Needs: @gltf-transform/core|extensions|functions@4, sharp, meshoptimizer (no-save, see README).
import { NodeIO } from "@gltf-transform/core";
import { ALL_EXTENSIONS } from "@gltf-transform/extensions";
import { dedup, flatten, join, prune, simplify, textureCompress, weld } from "@gltf-transform/functions";
import { MeshoptSimplifier } from "meshoptimizer";
import sharp from "sharp";

const [, , input, output] = process.argv;
const io = new NodeIO().registerExtensions(ALL_EXTENSIONS);
const doc = await io.read(input);
const tris = () => doc.getRoot().listMeshes().reduce((n, m) => n + m.listPrimitives().reduce((k, p) => k + (p.getIndices()?.getCount() ?? 0) / 3, 0), 0);
console.log("triangles in", tris());
for (const m of doc.getRoot().listMeshes()) for (const p of m.listPrimitives()) p.setAttribute("TANGENT", null);
await MeshoptSimplifier.ready;
await doc.transform(dedup(), flatten(), join({ keepNamed: false }), weld({ tolerance: 0.0001 }));
await doc.transform(simplify({ simplifier: MeshoptSimplifier, ratio: 0.32, error: 0.0015 }), prune());
console.log("triangles out", tris(), "meshes", doc.getRoot().listMeshes().length);
await doc.transform(textureCompress({ encoder: sharp, targetFormat: "webp", resize: [2048, 2048], quality: 84 }), prune());
await io.write(output, doc);
