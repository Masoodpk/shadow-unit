# Preview renders of the airport .blend (checks, thumbnails).
#   Blender -b scripts/airport/out/pcx.blend -P scripts/airport/pcx_render.py -- --out scripts/airport/out/shots [--engine workbench|eevee] [--views top,curb,...]
# Views are player-eye cameras (1.64 m) at the map's callouts plus a top-down plan.
import bpy, math, os, sys
from mathutils import Vector

argv = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []
opt = {argv[i].lstrip("-"): argv[i + 1] for i in range(0, len(argv) - 1, 2)}
OUT = os.path.abspath(opt.get("out", "shots"))
ENGINE = opt.get("engine", "workbench")
RES = int(opt.get("res", "960"))

B = lambda x, y, z: Vector((x - 64.0, 48.0 - y, z))
EYE = 1.64
# name: (eye map x, y, z, look-at map x, y, z, lens mm)
VIEWS = {
    "plan": None,
    "bird": ((-20, 140, 70), (64, 40, 0), 28),
    "curb": ((64, 93, EYE), (58, 70, 3), 18),
    "hall": ((28, 84, EYE), (70, 68, 4), 16),
    "vault": ((26, 83, EYE + 0.4), (70, 72, 9), 14),
    "jet": ((84, 14, 2.2), (106, 22, 3.0), 18),
    "jet_front": ((122, 40, 2.0), (106, 24, 3.5), 18),
    "pierb": ((150, 2, 2.4), (200, 24, 3.0), 18),
    "taxiway": ((190, 6, 2.0), (220, -8, 3.0), 18),
    "carts": ((57, 25.5, 1.8), (64, 30, 0.9), 16),
    "mezz": ((44, 66, 5 + EYE), (70, 82, 1), 18),
    "security": ((70, 66.5, EYE), (70, 50, 2), 18),
    "atrium": ((66, 52.5, 5 + EYE), (70, 30, 2), 16),
    "concourse": ((44, 50, 5 + EYE), (126, 50, 5), 18),
    "cabin": ((106, 11.0, 3.4 + EYE), (106, 30, 4.6), 16),
    "apron": ((64, 22, EYE), (64, 44, 4), 16),
    "apron_east": ((96, 6, EYE), (104, 40, 4), 16),
    "hangar": ((50, 20, EYE), (75, 6, 4), 16),
    "cargo": ((32, 30, EYE), (10, 6, 2), 16),
    "yard": ((36, 56, EYE), (10, 36, 2), 18),
    "makeup": ((88, 60, EYE), (126, 46, 1), 16),
    "claim": ((88, 84, EYE), (124, 64, 1), 16),
    "tunnel": ((14, 72.5, -4.5 + EYE), (50, 72.5, -3), 18),
    "sparks": ((40, 72.5, -4.5 + EYE), (28, 72.5, -3.5), 16),
    "thumb": ((30, 104, 3.2), (62, 80, 9.5), 20),
}
want = opt.get("views", ",".join(VIEWS)).split(",")

sc = bpy.context.scene
try:
    sc.render.engine = {"workbench": "BLENDER_WORKBENCH", "eevee": "BLENDER_EEVEE"}.get(ENGINE, "BLENDER_WORKBENCH")
except TypeError as e:
    print("engine:", e)
sc.render.resolution_x = RES
sc.render.resolution_y = int(RES * 9 / 16)
sc.render.film_transparent = False
if sc.render.engine == "BLENDER_WORKBENCH":
    sh = sc.display.shading
    sh.light = "STUDIO"
    sh.color_type = opt.get("color", "MATERIAL")
    sh.show_shadows = True
    sh.show_cavity = True
    sh.cavity_type = "WORLD"
    sc.display.shading.background_type = "WORLD" if False else sh.background_type
for o in bpy.data.objects:
    if o.name.startswith("clip_"):
        o.hide_render = True
if "Light" in bpy.data.objects:
    pass

if opt.get("look") == "game":
    # what the game draws: unlit, texture × tint × the baked "light" colour layer (no scene lights)
    try:
        sc.render.engine = "BLENDER_EEVEE"
    except TypeError as e:
        print("engine:", e)
    sc.view_settings.view_transform = "Standard"
    for m in bpy.data.materials:
        nt = m.node_tree
        if not nt:
            continue
        bsdf = next((n for n in nt.nodes if n.type == "BSDF_PRINCIPLED"), None)
        out = next((n for n in nt.nodes if n.type == "OUTPUT_MATERIAL"), None)
        if not bsdf or not out:
            continue
        src = bsdf.inputs["Base Color"].links[0].from_socket if bsdf.inputs["Base Color"].links else None
        attr = nt.nodes.new("ShaderNodeVertexColor")
        attr.layer_name = "light"
        mul = nt.nodes.new("ShaderNodeMix")
        mul.data_type = "RGBA"
        mul.blend_type = "MULTIPLY"
        mul.inputs["Factor"].default_value = 1.0
        if src:
            nt.links.new(src, mul.inputs[6])
        else:
            mul.inputs[6].default_value = bsdf.inputs["Base Color"].default_value
        if m.get("pcx_kind") in ("glass", "fence"):
            mul.inputs[7].default_value = (1, 1, 1, 1)
        else:
            nt.links.new(attr.outputs["Color"], mul.inputs[7])
        em = nt.nodes.new("ShaderNodeEmission")
        nt.links.new(mul.outputs[2], em.inputs["Color"])
        if m.get("pcx_kind") in ("glass", "fence"):
            tr = nt.nodes.new("ShaderNodeBsdfTransparent")
            mx = nt.nodes.new("ShaderNodeMixShader")
            mx.inputs[0].default_value = {"glass": 0.25, "fence": 0.45}[m["pcx_kind"]]
            nt.links.new(tr.outputs[0], mx.inputs[1])
            nt.links.new(em.outputs[0], mx.inputs[2])
            nt.links.new(mx.outputs[0], out.inputs["Surface"])
        else:
            nt.links.new(em.outputs[0], out.inputs["Surface"])
    for o in bpy.data.objects:
        if o.type == "LIGHT":
            o.hide_render = True
    w = sc.world or bpy.data.worlds.new("w")
    sc.world = w
    bg = next((n for n in w.node_tree.nodes if n.type == "BACKGROUND"), None)
    if bg:
        bg.inputs["Color"].default_value = (0.86, 0.72, 0.6, 1)
        bg.inputs["Strength"].default_value = 1.0

cam_data = bpy.data.cameras.new("pcx_cam")
cam = bpy.data.objects.new("pcx_cam", cam_data)
sc.collection.objects.link(cam)
sc.camera = cam
cam_data.clip_start = 0.05
cam_data.clip_end = 3000
os.makedirs(OUT, exist_ok=True)
for name in want:
    if name not in VIEWS:
        continue
    v = VIEWS[name]
    if v is None:
        cam_data.type = "ORTHO"
        cam_data.ortho_scale = 140
        cam.location = B(64, 48, 200)
        cam.rotation_euler = (0, 0, 0)
        sc.render.resolution_y = int(RES * 96 / 128 * 1.05)
    else:
        cam_data.type = "PERSP"
        cam_data.lens = v[2]
        eye, at = B(*v[0]), B(*v[1])
        cam.location = eye
        cam.rotation_euler = (at - eye).to_track_quat("-Z", "Y").to_euler()
        sc.render.resolution_y = int(RES * 9 / 16)
    sc.render.filepath = os.path.join(OUT, name + ".png")
    bpy.ops.render.render(write_still=True)
    print("shot", name)
