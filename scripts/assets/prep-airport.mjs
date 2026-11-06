// LAST CALL (Port Calder International) — our own map, built by scripts/airport/*.py in Blender with its
// light baked into each vertex (COLOR_0). Here: every material made unlit (KHR_materials_unlit: the game
// draws texture × baked light, no real-time lighting), textures → WebP at `size`, geometry quantised
// (KHR_mesh_quantization), duplicates merged.
//   node prep-airport.mjs ../airport/out/pcx_raw.glb ../../src/assets/maps/airport.glb 1024
import { NodeIO } from "@gltf-transform/core";
import { ALL_EXTENSIONS, EXTTextureWebP, KHRMaterialsUnlit } from "@gltf-transform/extensions";
import { dedup, prune, quantize } from "@gltf-transform/functions";
import sharp from "sharp";
import { statSync } from "node:fs";

const [, , input, output, sizeArg] = process.argv;
const size = parseInt(sizeArg ?? "1024");
const io = new NodeIO().registerExtensions(ALL_EXTENSIONS);
const doc = await io.read(input);
const root = doc.getRoot();

const unlit = doc.createExtension(KHRMaterialsUnlit);
for (const mat of root.listMaterials()) {
  mat.setExtension("KHR_materials_unlit", unlit.createUnlit());
  // (unlit ignores these anyway; dropping them keeps the file small)
  mat.setMetallicRoughnessTexture(null).setNormalTexture(null).setOcclusionTexture(null).setEmissiveTexture(null);
  mat.setEmissiveFactor([0, 0, 0]);
}
await doc.transform(dedup(), prune({ keepLeaves: true }), quantize({ quantizeColor: 8, quantizeNormal: 8, quantizeTexcoord: 12, quantizePosition: 16 }));
doc.createExtension(EXTTextureWebP).setRequired(true);
let bytes = 0;
for (const tex of root.listTextures()) {
  const out = await sharp(Buffer.from(tex.getImage()))
    .resize({ width: size, height: size, fit: "inside", withoutEnlargement: true, kernel: "lanczos3" })
    .webp({ quality: 82, effort: 5 })
    .toBuffer();
  tex.setImage(new Uint8Array(out)).setMimeType("image/webp");
  bytes += out.length;
}
let tris = 0;
for (const mesh of root.listMeshes()) for (const prim of mesh.listPrimitives()) tris += (prim.getIndices()?.getCount() ?? 0) / 3;
console.log(`materials ${root.listMaterials().length}, meshes ${root.listMeshes().length}, triangles ${tris}, textures ${(bytes / 1e6).toFixed(2)} MB`);
await io.write(output, doc);
console.log(`${input} ${(statSync(input).size / 1e6).toFixed(1)} MB → ${output} ${(statSync(output).size / 1e6).toFixed(1)} MB`);
