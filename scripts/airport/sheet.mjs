// contact sheet of preview renders: node scripts/airport/sheet.mjs <out.jpg> <cols> <a.png> <b.png> ...
// (needs sharp: run from scripts/assets' tool install, see scripts/assets/README.md)
import sharp from "sharp";
const [, , out, colsArg, ...files] = process.argv;
const cols = parseInt(colsArg);
const W = 480, H = 270;
const tiles = await Promise.all(files.map((f) => sharp(f).resize(W, H, { fit: "cover" }).toBuffer()));
const rows = Math.ceil(tiles.length / cols);
await sharp({ create: { width: W * cols, height: H * rows, channels: 3, background: "#222" } })
  .composite(tiles.map((t, i) => ({ input: t, left: (i % cols) * W, top: Math.floor(i / cols) * H })))
  .jpeg({ quality: 82 })
  .toFile(out);
console.log(out, `${cols}×${rows}`);
