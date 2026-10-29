// The S.W.A.T. operator ("S.W.A.T. Operator" by Mateusz Woliński, CC BY 4.0 — a Mixamo rig): his own
// rifle and the two patches (loose meshes on no bone: they'd hang where he was modelled) and his idle
// clip dropped — the game hands every soldier its rifle and drives him with the mocap — and the
// textures → WebP at `size` (never upscaled; the file's 45 maps are ~28 MB).
//   node prep-swat.mjs ~/Downloads/s.w.a.t._operator.glb ../../src/assets/soldier_swat.glb 1024
import { NodeIO } from "@gltf-transform/core";
import { ALL_EXTENSIONS, EXTTextureWebP } from "@gltf-transform/extensions";
import { dedup, prune } from "@gltf-transform/functions";
import sharp from "sharp";

const [, , input, output, sizeArg] = process.argv;
const size = parseInt(sizeArg ?? "1024");
const io = new NodeIO().registerExtensions(ALL_EXTENSIONS);
const doc = await io.read(input);
const root = doc.getRoot();

for (const node of root.listNodes()) if (/^(part_2_low|Circle|Plane)(_\d+)?$/.test(node.getName())) node.dispose();
for (const a of root.listAnimations()) a.dispose();
await doc.transform(prune(), dedup());

doc.createExtension(EXTTextureWebP).setRequired(true);
let bytes = 0;
for (const tex of root.listTextures()) {
  const normal = root.listMaterials().some((m) => m.getNormalTexture() === tex);
  const out = await sharp(Buffer.from(tex.getImage()))
    .resize({ width: size, height: size, fit: "inside", withoutEnlargement: true, kernel: "lanczos3" })
    .webp(normal ? { quality: 92 } : { quality: 84, effort: 5 })
    .toBuffer();
  tex.setImage(new Uint8Array(out)).setMimeType("image/webp");
  bytes += out.length;
}
console.log("textures", root.listTextures().length, (bytes / 1e6).toFixed(1), "MB");
await io.write(output, doc);
