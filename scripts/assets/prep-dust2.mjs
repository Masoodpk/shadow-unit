// De_Dust 2 (real light) — and the Viper character — for the browser: the geometry is tiny (9k triangles) and stays as it is;
// the eleven 4096² baked-light JPEG atlases (~128 MB) become WebP at the given size.
//
//   node prep-dust2.mjs ~/Downloads/de_dust_2_with_real_light.glb ../../src/assets/maps/dust2.glb 2048
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

// the 1.6 map's advertising banner for a real website (baked into part3's atlas, source pixels):
// painted out by carrying the brick wall in from both sides, row by row (keeps the baked shading)
const ERASE = { part3: [[3771, 1625, 3931, 2625]] };
for (const mat of root.listMaterials()) {
  const rects = ERASE[mat.getName()];
  const tex = mat.getBaseColorTexture();
  if (!rects || !tex) continue;
  const { data, info } = await sharp(Buffer.from(tex.getImage())).raw().toBuffer({ resolveWithObject: true });
  const C = info.channels, W = info.width;
  for (const [x0, y0, x1, y1] of rects) {
    const mid = (x0 + x1) >> 1, w = mid - x0, B = 12;
    for (let y = y0; y < y1; y++)
      for (let x = x0; x < x1; x++) {
        // left half from the wall left of the banner, right half from the wall right of it
        const l = (y * W + (x - w)) * C, r = (y * W + (x + (x1 - mid))) * C, o = (y * W + x) * C;
        const t = Math.min(1, Math.max(0, (x - (mid - B)) / (2 * B)));
        for (let k = 0; k < C; k++) data[o + k] = data[l + k] * (1 - t) + data[r + k] * t;
      }
  }
  const png = await sharp(data, { raw: { width: W, height: info.height, channels: C } }).png().toBuffer();
  tex.setImage(new Uint8Array(png)).setMimeType("image/png");
  console.log("painted out", rects.length, "region(s) in", mat.getName());
}

doc.createExtension(EXTTextureWebP).setRequired(true);
let bytes = 0;
for (const tex of root.listTextures()) {
  const img = sharp(Buffer.from(tex.getImage()));
  const meta = await img.metadata();
  // a touch of sharpening after a downscale keeps the painted detail crisp (never upscaled; textures
  // already at or under the size — e.g. a character's normal maps — are only re-encoded)
  let pipe = img.resize({ width: size, height: size, fit: "inside", withoutEnlargement: true, kernel: "lanczos3" });
  if ((meta.width ?? 0) > size) pipe = pipe.sharpen({ sigma: 0.6 });
  const out = await pipe.webp({ quality: 86, effort: 5 }).toBuffer();
  tex.setImage(new Uint8Array(out)).setMimeType("image/webp");
  bytes += out.length;
  console.log(tex.getName() || "texture", meta.width, "→", size, (out.length / 1e6).toFixed(2), "MB");
}
console.log("texture bytes", (bytes / 1e6).toFixed(1), "MB");
await io.write(output, doc);
