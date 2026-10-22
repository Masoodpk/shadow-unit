// The Underground's soldiers for the browser (the script was written for the old Winterport stage,
// whose "city" step is gone with it):
//   soldiers  — "Polish soldier" by buh (CC BY 4.0), "Soldier Girl" by rafa durand (CC BY-NC 4.0),
//               "Winter Soldier (FREE)(Textured)(Rigged)" by CAPTAAINR (CC BY 4.0): textures → WebP at
//               `size` (never upscaled) — the girl's 36 maps were ~55 MB.
//
//   node prep-soldiers.mjs soldier ~/Downloads/polish_soldier.glb ../../src/assets/soldier_polish.glb 1024 0.5
//   node prep-soldiers.mjs soldier ~/Downloads/soldier_girl.glb ../../src/assets/soldier_girl.glb 1024 0.15
//   node prep-soldiers.mjs soldier ~/Downloads/winter_soldierfreetexturedrigged.glb ../../src/assets/winter_soldier.glb 2048
import { NodeIO } from "@gltf-transform/core";
import { ALL_EXTENSIONS, EXTTextureWebP } from "@gltf-transform/extensions";
import { dedup, prune, simplify, weld } from "@gltf-transform/functions";
import { MeshoptSimplifier } from "meshoptimizer";
import sharp from "sharp";

// (a 5th argument simplifies the meshes to that fraction of their triangles — the girl comes at 407k)
const [, , kind, input, output, sizeArg, ratioArg] = process.argv;
const size = parseInt(sizeArg ?? "4096");
const io = new NodeIO().registerExtensions(ALL_EXTENSIONS);
const doc = await io.read(input);
const root = doc.getRoot();

void kind;
await doc.transform(dedup(), prune());
if (ratioArg) {
  await MeshoptSimplifier.ready;
  await doc.transform(weld(), simplify({ simplifier: MeshoptSimplifier, ratio: parseFloat(ratioArg), error: 0.004 }), prune());
}

doc.createExtension(EXTTextureWebP).setRequired(true);
let bytes = 0;
for (const tex of root.listTextures()) {
  const img = sharp(Buffer.from(tex.getImage()));
  const meta = await img.metadata();
  const normal = root.listMaterials().some((m) => m.getNormalTexture() === tex);
  const out = await img
    .resize({ width: size, height: size, fit: "inside", withoutEnlargement: true, kernel: "lanczos3" })
    .webp(normal ? { lossless: false, quality: 92 } : { quality: 84, effort: 5 })
    .toBuffer();
  tex.setImage(new Uint8Array(out)).setMimeType("image/webp");
  bytes += out.length;
  if ((meta.width ?? 0) > 1024) console.log(tex.getName() || "texture", meta.width, "→", Math.min(size, meta.width ?? size), (out.length / 1e6).toFixed(2), "MB");
}
console.log("texture bytes", (bytes / 1e6).toFixed(1), "MB");
await io.write(output, doc);
