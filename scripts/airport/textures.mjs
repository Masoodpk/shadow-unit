// Phase 5 — the airport's surface textures, calibrated. Poly Haven diffuse maps (CC0, textures/src) keep
// their detail but take a chosen colour and brightness, so every surface sits at a believable albedo
// under the baked light (the raw scans are dark, and some are the wrong hue: red box-profile, green paint).
//   node scripts/airport/textures.mjs          → scripts/airport/textures/pcx/<material>.jpg (1024², sRGB)
import sharp from "sharp";
import { mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
// material: [source scan, target colour (sRGB 0..1), detail contrast 0..1]
const SET = {
  concrete: ["concrete_tiles", [0.72, 0.71, 0.68], 0.6],
  asphalt: ["asphalt_02", [0.34, 0.34, 0.35], 0.6],
  terrazzo: ["terrazzo_tiles", [0.86, 0.84, 0.8], 0.45],
  floor_tile: ["floor_tiles_06", [0.76, 0.77, 0.76], 0.45],
  carpet: ["dirty_carpet", [0.3, 0.37, 0.5], 0.55],
  epoxy: ["anti_slip_concrete", [0.55, 0.6, 0.57], 0.45],
  plaster: ["grey_plaster", [0.93, 0.91, 0.87], 0.2],
  paint: ["grey_plaster", [0.8, 0.82, 0.84], 0.25],
  block: ["concrete_block_wall", [0.63, 0.63, 0.61], 0.5],
  corrugated: ["corrugated_iron_02", [0.6, 0.65, 0.7], 0.65],
  metal_sheet: ["box_profile_metal_sheet", [0.74, 0.76, 0.76], 0.8],
  shutter: ["painted_metal_shutter", [0.62, 0.64, 0.66], 0.5],
  metal_plate: ["metal_plate", [0.56, 0.57, 0.6], 0.6],
  wood: ["oak_wood_planks", [0.8, 0.6, 0.42], 0.55],
};
const out = join(HERE, "textures", "pcx");
mkdirSync(out, { recursive: true });
for (const [name, [src, col, k]] of Object.entries(SET)) {
  const img = sharp(join(HERE, "textures", "src", src + ".jpg")).recomb([
    [0.299, 0.587, 0.114],
    [0.299, 0.587, 0.114],
    [0.299, 0.587, 0.114],
  ]);
  // (stats() reads the source pixels, not the recombined grey: weight the source channels the same way)
  const { channels } = await sharp(join(HERE, "textures", "src", src + ".jpg")).stats();
  const m = Math.max(1, 0.299 * channels[0].mean + 0.587 * channels[1].mean + 0.114 * channels[2].mean);
  // out = colour × ((1 − k) + k × grey / mean)
  const a = col.map((c) => (c * 255 * k) / m);
  const b = col.map((c) => c * 255 * (1 - k));
  await img.linear(a, b).jpeg({ quality: 88 }).toFile(join(out, name + ".jpg"));
  console.log(name.padEnd(12), "←", src);
}
