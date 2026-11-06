# Phase 6 — lighting. Golden-hour sun + sky + the interior fittings, baked by Cycles into a per-vertex
# colour layer ("light"). The game draws the map unlit: what you see = texture × this layer, so the light
# costs nothing at run time (no real-time lights, no shadow maps).
#   Blender -b scripts/airport/out/pcx.blend -P scripts/airport/pcx_bake.py -- --out scripts/airport/out/pcx_baked.blend [--samples 256]
import bpy, math, os, sys, time
from mathutils import Vector

argv = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []
opt = {argv[i].lstrip("-"): argv[i + 1] for i in range(0, len(argv) - 1, 2)}
OUT = os.path.abspath(opt.get("out", "pcx_baked.blend"))
SAMPLES = int(opt.get("samples", "256"))
sc = bpy.context.scene
B = lambda x, y, z: Vector((x - 64.0, 48.0 - y, z))

# ---------------------------------------------------------------- engine
sc.render.engine = "CYCLES"
try:
    prefs = bpy.context.preferences.addons["cycles"].preferences
    prefs.compute_device_type = "METAL"
    prefs.get_devices()
    for d in prefs.devices:
        d.use = True
    sc.cycles.device = "GPU"
    print("cycles: GPU", [d.name for d in prefs.devices if d.use])
except Exception as e:
    print("cycles: CPU", e)
sc.cycles.samples = SAMPLES
sc.cycles.use_denoising = False
sc.cycles.max_bounces = 4
sc.cycles.diffuse_bounces = 3

# ---------------------------------------------------------------- lights
lights = bpy.data.collections.get("PCX_96_Lights") or bpy.data.collections.new("PCX_96_Lights")
if lights.name not in sc.collection.children:
    sc.collection.children.link(lights)
for o in list(lights.objects):
    bpy.data.objects.remove(o)


def lamp(name, kind, loc, energy, color, size=1.0, aim=None):
    ld = bpy.data.lights.new(name, kind)
    ld.energy = energy
    ld.color = color
    if kind == "AREA":
        ld.size = size
    if kind == "SUN":
        ld.angle = math.radians(1.5)
    ob = bpy.data.objects.new(name, ld)
    ob.location = loc
    if aim is not None:
        ob.rotation_euler = (Vector(aim)).to_track_quat("-Z", "Y").to_euler()
    lights.objects.link(ob)
    return ob


# the sun: low in the west-south-west (golden hour) — light travels east-north-east
az, el = math.radians(200), math.radians(17)          # azimuth measured in Blender XY from +X
sun_dir = Vector((math.cos(el) * math.cos(az), math.cos(el) * math.sin(az), math.sin(el)))   # towards the sun
lamp("sun", "SUN", (0, 0, 100), 3.6, (1.0, 0.77, 0.52), aim=-sun_dir)

WARM, COOL, NEUTRAL = (1.0, 0.86, 0.68), (0.82, 0.9, 1.0), (1.0, 0.95, 0.88)
# hall + mezzanine (under the Wave), concourse, hangar, cargo
for x in range(28, 84, 10):
    for y in range(66, 86, 9):
        lamp("hall", "AREA", B(x, y, 10.0), 1400, WARM, 4.0, aim=(0, 0, -1))
    lamp("mezz", "AREA", B(x + 12, 61, 9.8), 900, WARM, 3.0, aim=(0, 0, -1)) if x + 12 < 84 else None
for x in range(44, 128, 9):
    lamp("conc", "AREA", B(x, 50, 7.6), 650, NEUTRAL, 3.0, aim=(0, 0, -1))
for y in (6, 14, 22):
    for x in range(52, 80, 9):
        lamp("hangar", "AREA", B(x, y, 12.4), 1300, (1.0, 0.74, 0.45), 3.0, aim=(0, 0, -1))
for y in (6, 14, 22, 28):
    for x in (8, 22, 30):
        lamp("cargo", "AREA", B(x, y, 8.8), 700, NEUTRAL, 2.5, aim=(0, 0, -1))
# every ceiling panel in the low rooms becomes a small area light (security cooler, make-up neutral)
for o in bpy.data.objects:
    if o.type == "MESH" and o.data.materials and o.data.materials[0].name == "pcx_light_panel":
        me = o.data
        for p in me.polygons:
            c = o.matrix_world @ p.center
            mx = c.x + 64.0
            my = 48.0 - c.y
            col = COOL if (56 <= mx <= 84 and 54 <= my <= 64) else (NEUTRAL if c.z < 0 or mx > 84 else WARM)
            e = 70 if c.z < 0 else (900 if c.z > 8 else 160)
            if c.z > 8:
                continue   # hangar / cargo: the big lamps above cover them
            lamp("panel", "AREA", (c.x, c.y, c.z - 0.05), e, col, 1.2, aim=(0, 0, -1))
# the jet: cabin ceiling lights along the aisle, the jet bridge
for v in range(7, 33, 3):
    lamp("cabin", "AREA", B(106, 4.5 + v, 6.05), 70, NEUTRAL, 0.8, aim=(0, 0, -1))
for (x, y, z) in ((95, 42, 7.45), (95, 37, 7.45), (100.5, 35.7, 6.4)):
    lamp("bridge", "AREA", B(x, y, z), 90, NEUTRAL, 1.0, aim=(0, 0, -1))
for (x, y) in ((24, 72.5), (32, 72.5), (46, 72.5), (55, 62), (55, 58)):
    lamp("tunnel", "AREA", B(x, y, -1.6), 120, NEUTRAL, 1.0, aim=(0, 0, -1))

# sky
world = sc.world or bpy.data.worlds.new("pcx_sky")
sc.world = world
try:
    world.use_nodes = True
except Exception:
    pass
bg = next(n for n in world.node_tree.nodes if n.type == "BACKGROUND")
bg.inputs["Color"].default_value = (0.5, 0.64, 0.92, 1)
bg.inputs["Strength"].default_value = 0.9

# ---------------------------------------------------------------- what bakes
# (glass anywhere in the name: the panes, and the hall vault's glazing "roof_roof_glass" — light goes through)
skip = lambda o: o.type != "MESH" or "glass" in o.name or o.name.startswith(("fence", "clip_"))
for o in bpy.data.objects:
    if o.type == "MESH" and ("glass" in o.name or o.name.startswith(("fence", "clip_"))):
        o.visible_shadow = False
        o.visible_diffuse = False
        o.visible_glossy = False
        o.visible_transmission = False
# emissive materials shouldn't light the scene twice (the lamps stand in for them) during the bake
for m in bpy.data.materials:
    bsdf = next((n for n in m.node_tree.nodes if n.type == "BSDF_PRINCIPLED"), None) if m.node_tree else None
    if bsdf and m.get("pcx_kind") == "emit":
        bsdf.inputs["Emission Strength"].default_value = 0.0

targets = [o for o in bpy.data.objects if not skip(o)]
for o in targets:
    me = o.data
    for a in list(me.color_attributes):
        me.color_attributes.remove(a)
    me.color_attributes.new("light", "FLOAT_COLOR", "CORNER")
    me.color_attributes.active_color = me.color_attributes["light"]

bpy.ops.object.select_all(action="DESELECT")
for o in targets:
    o.select_set(True)
bpy.context.view_layer.objects.active = targets[0]
sc.render.bake.target = "VERTEX_COLORS"
sc.render.bake.use_selected_to_active = False
t0 = time.time()
bpy.ops.object.bake(type="DIFFUSE", pass_filter={"DIRECT", "INDIRECT"}, target="VERTEX_COLORS")
print(f"baked {len(targets)} meshes in {time.time() - t0:.0f} s")

# ---------------------------------------------------------------- tone map into 0..1 (stored per corner)
K, AMB = 0.75, 0.05
emit_mats = {m.name for m in bpy.data.materials if m.get("pcx_kind") == "emit"}
hist = [0] * 10
for o in targets:
    me = o.data
    lay = me.color_attributes["light"]
    emissive = me.materials and me.materials[0].name in emit_mats
    vals = [0.0] * (len(lay.data) * 4)
    lay.data.foreach_get("color", vals)
    for i in range(0, len(vals), 4):
        for c in range(3):
            e = vals[i + c]
            v = 1.0 if emissive else min(1.0, AMB + 1.3 * e / (e + K))
            vals[i + c] = v
        vals[i + 3] = 1.0
        hist[min(9, int(vals[i] * 10))] += 1
    lay.data.foreach_set("color", vals)
print("light histogram (red, tenths):", hist)
for m in bpy.data.materials:
    bsdf = next((n for n in m.node_tree.nodes if n.type == "BSDF_PRINCIPLED"), None) if m.node_tree else None
    if bsdf and m.get("pcx_kind") == "emit":
        bsdf.inputs["Emission Strength"].default_value = 1.0
bpy.ops.wm.save_as_mainfile(filepath=OUT)
print("saved", OUT)
