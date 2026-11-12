// The Blackout Operative (the user's own Meshy AI character, rigged by Meshy to a Mixamo skeleton):
// its ten clips dropped — the game drives every soldier with its own mocap, retargeted at load — the
// one dense mesh welded and thinned to `ratio` of its triangles (skin weights kept), and the three
// 2048² PNG maps → WebP at `size` (never upscaled).
//   node prep-blackout.mjs ~/Downloads/Meshy_AI_Blackout_Operative_..._animated_mixamo_All_animation.glb ../../src/assets/soldier_blackout.glb 1024 0.5
import { NodeIO } from "@gltf-transform/core";
import { ALL_EXTENSIONS, EXTTextureWebP } from "@gltf-transform/extensions";
import { dedup, prune, simplify, weld } from "@gltf-transform/functions";
import { MeshoptSimplifier } from "meshoptimizer";
import sharp from "sharp";

const [, , input, output, sizeArg, ratioArg] = process.argv;
const size = parseInt(sizeArg ?? "1024");
const ratio = parseFloat(ratioArg ?? "0.5");
const io = new NodeIO().registerExtensions(ALL_EXTENSIONS);
const doc = await io.read(input);
const root = doc.getRoot();

for (const a of root.listAnimations()) a.dispose();
const tris = () => root.listMeshes().reduce((s, m) => s + m.listPrimitives().reduce((t, p) => t + (p.getIndices()?.getCount() ?? p.getAttribute("POSITION").getCount()) / 3, 0), 0);
const before = tris();
await doc.transform(prune(), dedup());
if (ratio < 1) {
  await MeshoptSimplifier.ready;
  await doc.transform(weld(), simplify({ simplifier: MeshoptSimplifier, ratio, error: 0.001 }));
}
console.log("triangles", before, "→", tris(), "joints", root.listSkins()[0].listJoints().length);

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
