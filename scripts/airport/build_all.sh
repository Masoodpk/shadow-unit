#!/bin/sh
# LAST CALL — the whole airport pipeline, Blender to game files.
#   sh scripts/airport/build_all.sh [bake samples, default 256]
# The crop is PLAY (pcx_build.py) ± 0.15 m in Babylon metres (x = 64 − map x, z = map y − 48).
# Needs Blender 5.x and the glTF tools from scripts/assets/README.md (gltf-transform, sharp).
set -e
cd "$(dirname "$0")"
BL=${BLENDER:-/Applications/Blender.app/Contents/MacOS/Blender}
SAMPLES=${1:-256}
node textures.mjs                                                                              # phase 5 textures
"$BL" -b --factory-startup -P pcx_build.py -- --phase 5 --out out/pcx.blend                     # phases 2-5
"$BL" -b out/pcx.blend -P pcx_bake.py -- --out out/pcx_baked.blend --samples "$SAMPLES"         # phase 6
"$BL" -b out/pcx_baked.blend -P pcx_export.py -- --out out/pcx_raw.glb                          # phase 8
cd ../assets
node prep-airport.mjs ../airport/out/pcx_raw.glb ../../src/assets/maps/airport.glb 1024
node --max-old-space-size=8192 voxel-map.mjs --in=../../src/assets/maps/airport.glb \
  --out=../../src/assets/maps/airport-data.json --png=../airport/out/airport-floor.png \
  --u=1 --mode=all --crop=-186.15,-65.15,64.15,48.15 --skip=glass --wall=glass --soft='fence|clip'
