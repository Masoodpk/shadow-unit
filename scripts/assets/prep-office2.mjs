// "Cs_office with real light" (Neo_minigan, CC BY 4.0) — the classic low-poly cs_office with its light
// baked into one atlas per section: textures → WebP at `size` (never upscaled); the geometry
// (32k vertices) is kept as it is.
//   node prep-office2.mjs ~/Downloads/cs_office_with_real_light.glb ../../src/assets/maps/office2.glb 2048
import { NodeIO } from "@gltf-transform/core";
import { ALL_EXTENSIONS, EXTTextureWebP } from "@gltf-transform/extensions";
import { dedup, prune } from "@gltf-transform/functions";
import sharp from "sharp";

const [, , input, output, sizeArg] = process.argv;
const size = parseInt(sizeArg ?? "2048");
const io = new NodeIO().registerExtensions(ALL_EXTENSIONS);
const doc = await io.read(input);
const root = doc.getRoot();
await doc.transform(dedup(), prune());
doc.createExtension(EXTTextureWebP).setRequired(true);
let bytes = 0;
for (const tex of root.listTextures()) {
  const img = sharp(Buffer.from(tex.getImage()));
  const meta = await img.metadata();
  const out = await img.resize({ width: size, height: size, fit: "inside", withoutEnlargement: true, kernel: "lanczos3" }).webp({ quality: 86, effort: 5 }).toBuffer();
  tex.setImage(new Uint8Array(out)).setMimeType("image/webp");
  bytes += out.length;
  console.log(tex.getName() || "texture", `${meta.width}×${meta.height}`, (out.length / 1e6).toFixed(2), "MB");
}
console.log("textures", (bytes / 1e6).toFixed(1), "MB");
await io.write(output, doc);
