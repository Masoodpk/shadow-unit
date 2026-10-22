// Post-build step for hosts that only serve web types (no .glb):
// converts every .glb in the output into a self-contained glTF JSON file
// (binary buffer embedded as base64) named .json, and rewrites references in the JS.
import fs from "fs";
import path from "path";

const dir = path.resolve(process.argv[2] ?? "dist-artifact", "assets");
const files = fs.readdirSync(dir);
const renames = [];
for (const f of files.filter((f) => f.endsWith(".glb"))) {
  const buf = fs.readFileSync(path.join(dir, f));
  const jsonLen = buf.readUInt32LE(12);
  const json = JSON.parse(buf.subarray(20, 20 + jsonLen).toString("utf8"));
  let off = 20 + jsonLen;
  const binLen = buf.readUInt32LE(off);
  const bin = buf.subarray(off + 8, off + 8 + binLen);
  json.buffers[0].uri = "data:application/octet-stream;base64," + bin.toString("base64");
  const out = f.replace(/\.glb$/, ".json");
  fs.writeFileSync(path.join(dir, out), JSON.stringify(json));
  fs.unlinkSync(path.join(dir, f));
  renames.push([f, out]);
  console.log(`${f} → ${out} (${(fs.statSync(path.join(dir, out)).size / 1048576).toFixed(1)} MB)`);
}
for (const f of fs.readdirSync(dir).filter((f) => f.endsWith(".js"))) {
  let s = fs.readFileSync(path.join(dir, f), "utf8");
  for (const [a, b] of renames) s = s.split(a).join(b);
  fs.writeFileSync(path.join(dir, f), s);
}
