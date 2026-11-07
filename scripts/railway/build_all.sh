#!/bin/sh
# TERMINUS — the whole railway-station pipeline, Blender to game files.
#   sh scripts/railway/build_all.sh [bake samples, default 192]
# The crop is PLAY (rws_build.py) ± 0.15 m in Babylon metres (x = 64 − map x, z = map y − 48).
# Needs Blender 5.x and the glTF tools from scripts/assets/README.md (gltf-transform, sharp, meshoptimizer).
set -e
cd "$(dirname "$0")"
BL=${BLENDER:-/Applications/Blender.app/Contents/MacOS/Blender}
SAMPLES=${1:-192}
node textures.mjs                                                                               # textures (generated + calibrated scans)
# (the three Sketchfab trains are prepared once: Blender -b --factory-startup -P prep_models.py -- ~/Downloads)
"$BL" -b --factory-startup -P rws_build.py -- --phase 5 --out out/rws.blend                      # phases 3–10
"$BL" -b out/rws.blend -P rws_bake.py -- --out out/rws_baked.blend --samples "$SAMPLES"          # phase 11
"$BL" -b out/rws_baked.blend -P ../airport/pcx_export.py -- --out out/rws_raw.glb                # phase 13
cd ../assets
node prep-airport.mjs ../railway/out/rws_raw.glb ../../src/assets/maps/railway.glb 1024
node --max-old-space-size=8192 voxel-map.mjs --in=../../src/assets/maps/railway.glb \
  --out=../../src/assets/maps/railway-data.json --png=../railway/out/railway-floor.png \
  --u=1 --mode=all --crop=-176.15,-48.15,64.15,102.15 --skip=glass --wall=glass --soft='fence|clip|soft_'
