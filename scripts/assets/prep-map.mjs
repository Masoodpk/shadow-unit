// CS Office for the browser: drop the snowfall geometry and sky dome, weld + simplify,
// WebP textures sized by how much of the map uses them.
import { NodeIO } from "@gltf-transform/core";
import { ALL_EXTENSIONS, EXTTextureWebP } from "@gltf-transform/extensions";
import { dedup, prune, weld, simplify, flatten } from "@gltf-transform/functions";
import { MeshoptSimplifier } from "meshoptimizer";
import sharp from "sharp";

const [, , input, output, ratioArg] = process.argv;
const ratio = parseFloat(ratioArg ?? "0.6");
const io = new NodeIO().registerExtensions(ALL_EXTENSIONS);
const doc = await io.read(input);
const root = doc.getRoot();

const DROP = [/SNOW1/, /TRANS6/];
for (const n of root.listNodes()) if (DROP.some((r) => r.test(n.getName()))) n.dispose();
await doc.transform(prune());

await MeshoptSimplifier.ready;
await doc.transform(dedup(), flatten(), weld(), simplify({ simplifier: MeshoptSimplifier, ratio, error: 0.0004, lockBorder: true }), prune());

// textures: 1024 for the big shared surfaces, 512 for props
const triOf = new Map();
for (const mesh of root.listMeshes())
  for (const prim of mesh.listPrimitives()) {
    const mat = prim.getMaterial();
    if (!mat) continue;
    const t = (prim.getIndices()?.getCount() ?? 0) / 3;
    triOf.set(mat, (triOf.get(mat) ?? 0) + t);
  }
doc.createExtension(EXTTextureWebP).setRequired(true);
let i = 0;
let bytes = 0;
for (const tex of root.listTextures()) {
  let tris = 0;
  for (const mat of root.listMaterials()) {
    const slots = [mat.getBaseColorTexture(), mat.getEmissiveTexture(), mat.getNormalTexture(), mat.getMetallicRoughnessTexture(), mat.getOcclusionTexture()];
    if (slots.includes(tex)) tris += triOf.get(mat) ?? 0;
  }
  const img = sharp(Buffer.from(tex.getImage()));
  const meta = await img.metadata();
  const hasAlpha = meta.hasAlpha;
  // cut-out textures (leaves, fences) keep full resolution: alpha-testing a downscaled mask turns leaves into blocks
  const size = hasAlpha ? 2048 : tris > 6000 ? 1024 : 512;
  const out = await img.resize({ width: Math.min(size, meta.width ?? size), height: Math.min(size, meta.height ?? size), fit: "inside" }).webp({ quality: 80, alphaQuality: 90, effort: 4, lossless: false }).toBuffer();
  tex.setImage(new Uint8Array(out)).setMimeType("image/webp");
  bytes += out.length;
  if (i++ % 10 === 0) console.log("textures", i, "…", hasAlpha ? "alpha" : "", meta.width, "→", size);
}
console.log("texture bytes", (bytes / 1e6).toFixed(1), "MB");
await io.write(output, doc);
let tris = 0;
for (const mesh of root.listMeshes()) for (const prim of mesh.listPrimitives()) tris += (prim.getIndices()?.getCount() ?? 0) / 3;
console.log("tris", tris, "meshes", root.listMeshes().length, "materials", root.listMaterials().length);
