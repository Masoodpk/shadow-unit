// "Roscoe Street - Underground" by Neo_minigan (CC BY 4.0) for the browser — the Underground stage:
//   the Sketchfab root's 0.64° tilt taken out (over the 127 m of tunnels it put the floors 1.4 m out of
//   level), meshes merged one per material (flatten + join), welded; its 157 textures (~91 MB) → WebP
//   at `size` (never upscaled).
//
//   node prep-metro.mjs ~/Downloads/roscoe_street_-_underground.glb ../../src/assets/maps/metro.glb 1024
// Needs: npm i --no-save @gltf-transform/core@4 @gltf-transform/extensions@4 @gltf-transform/functions@4 sharp meshoptimizer
import { NodeIO } from "@gltf-transform/core";
import { ALL_EXTENSIONS, EXTTextureWebP } from "@gltf-transform/extensions";
import { dedup, flatten, join, prune, weld } from "@gltf-transform/functions";
import sharp from "sharp";

const [, , input, output, sizeArg] = process.argv;
const size = parseInt(sizeArg ?? "1024");
const io = new NodeIO().registerExtensions(ALL_EXTENSIONS);
const doc = await io.read(input);
const root = doc.getRoot();

// the export's Z-up → Y-up turn, exactly (the file's has a stray 0.64°)
const top = root.listNodes().find((n) => n.getName() === "Sketchfab_model");
if (top) top.setMatrix([1, 0, 0, 0, 0, 0, 1, 0, 0, -1, 0, 0, 0, 0, 0, 1]);

await doc.transform(dedup(), flatten(), join({ keepNamed: false }), weld(), prune());
console.log("meshes", root.listMeshes().length, "materials", root.listMaterials().length);

doc.createExtension(EXTTextureWebP).setRequired(true);
let bytes = 0;
for (const tex of root.listTextures()) {
  const img = sharp(Buffer.from(tex.getImage()));
  const meta = await img.metadata();
  const normal = root.listMaterials().some((m) => m.getNormalTexture() === tex);
  const out = await img
    .resize({ width: size, height: size, fit: "inside", withoutEnlargement: true, kernel: "lanczos3" })
    .webp(normal ? { quality: 90 } : { quality: 82, effort: 5 })
    .toBuffer();
  tex.setImage(new Uint8Array(out)).setMimeType("image/webp");
  bytes += out.length;
}
console.log("textures", root.listTextures().length, (bytes / 1e6).toFixed(1), "MB");
await io.write(output, doc);
