# Phase 8 — export the baked airport to glTF binary (.glb) for the game.
#   Blender -b scripts/airport/out/pcx_baked.blend -P scripts/airport/pcx_export.py -- --out scripts/airport/out/pcx_raw.glb
# Then: node scripts/assets/prep-airport.mjs scripts/airport/out/pcx_raw.glb src/assets/maps/airport.glb
# Exported: every mesh (with its "light" colour layer as COLOR_0) and the gameplay empties
# (mission_start, spawn_*), +Y up, metres. Not exported: bake lamps, cameras.
import bpy, os, sys

argv = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []
opt = {argv[i].lstrip("-"): argv[i + 1] for i in range(0, len(argv) - 1, 2)}
OUT = os.path.abspath(opt.get("out", "pcx_raw.glb"))

bpy.ops.object.select_all(action="DESELECT")
n = 0
for o in bpy.data.objects:
    if o.type == "MESH" or (o.type == "EMPTY" and o.name.startswith(("mission_", "spawn_"))):
        o.hide_set(False)
        o.select_set(True)
        n += 1
kw = dict(
    filepath=OUT, export_format="GLB", use_selection=True, export_apply=True, export_yup=True,
    export_texcoords=True, export_normals=True, export_materials="EXPORT", export_extras=False,
    export_cameras=False, export_lights=False, export_animations=False,
)
props = bpy.ops.export_scene.gltf.get_rna_type().properties
if "export_vertex_color" in props:
    kw["export_vertex_color"] = "ACTIVE"
elif "export_colors" in props:
    kw["export_colors"] = True
if "export_all_vertex_colors" in props:
    kw["export_all_vertex_colors"] = False
if "export_image_format" in props:
    kw["export_image_format"] = "JPEG"
bpy.ops.export_scene.gltf(**kw)
print(f"exported {n} objects → {OUT} ({os.path.getsize(OUT) / 1e6:.1f} MB)")
