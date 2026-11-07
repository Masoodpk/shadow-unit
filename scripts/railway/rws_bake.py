# Phase 11 — light. A soft, slightly hazy late morning: the sun from the south-east, 40° up, through the
# glazed crowns of the train sheds; warm (about 2700 K) lamps in every lantern — the booking hall, offices,
# the platforms' lamp standards, a dimmer warm glow underground; high lamps in the engine shed — baked by
# Cycles into the per-vertex "light" layer, tone-mapped into 0..1.
# The game draws the map unlit: texture × this layer. (The same method as the airport: ../airport/pcx_bake.py.)
#   Blender -b scripts/railway/out/rws.blend -P scripts/railway/rws_bake.py -- --out scripts/railway/out/rws_baked.blend [--samples 192]
import bpy, math, os, sys, time
from mathutils import Vector

argv = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []
opt = {argv[i].lstrip("-"): argv[i + 1] for i in range(0, len(argv) - 1, 2)}
OUT = os.path.abspath(opt.get("out", "rws_baked.blend"))
SAMPLES = int(opt.get("samples", "192"))
sc = bpy.context.scene
B = lambda x, y, z: Vector((x - 64.0, 48.0 - y, z))

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

lights = bpy.data.collections.get("RWS_96_Lights") or bpy.data.collections.new("RWS_96_Lights")
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
        ld.angle = math.radians(1.2)
    ob = bpy.data.objects.new(name, ld)
    ob.location = loc
    if aim is not None:
        ob.rotation_euler = Vector(aim).to_track_quat("-Z", "Y").to_euler()
    lights.objects.link(ob)
    return ob


# the sun: south-east, 40° up (late morning). In Blender XY, map south is −Y and east is +X.
az, el = math.radians(-60), math.radians(40)
sun_dir = Vector((math.cos(el) * math.cos(az), math.cos(el) * math.sin(az), math.sin(el)))     # towards the sun
lamp("sun", "SUN", (0, 0, 100), 3.9, (1.0, 0.93, 0.8), aim=-sun_dir)
print("toward the sun (Blender):", tuple(round(v, 3) for v in sun_dir))

WARM, NEUTRAL, COOL = (1.0, 0.8, 0.56), (1.0, 0.9, 0.76), (1.0, 0.86, 0.68)
# every ceiling panel becomes a small area lamp
n = 0
for o in bpy.data.objects:
    if o.type == "MESH" and o.data.materials and o.data.materials[0] and o.data.materials[0].name == "pcx_light_panel":
        for p in o.data.polygons:
            c = o.matrix_world @ p.center
            mx, my = c.x + 64.0, 48.0 - c.y
            if c.z < -2.0:
                e, col, sz = 50, COOL, 0.9          # underground: subway, the underground railway, plant rooms
            elif my < 32 and mx < 190:
                e, col, sz = 120, WARM, 1.0         # north building
            elif mx > 196 or my < 18:
                e, col, sz = 650, NEUTRAL, 2.0      # depot, workshops, warehouse (high bays)
            elif c.z > 9:
                e, col, sz = 160, WARM, 1.2         # gallery level ceilings
            else:
                e, col, sz = 140, WARM, 1.0         # lobby, canopy, bridges
            lamp("panel", "AREA", (c.x, c.y, c.z - 0.05), e, col, sz, aim=(0, 0, -1))
            n += 1
print("panel lamps", n)
# the train interiors: a soft lamp every 3 m along each car's ceiling strip
for (x0, x1, y, z) in ((98, 172, 83.0, 2.45), (90, 135, 118.2, -7 + 2.45)):
    x = x0 + 1.5
    while x < x1:
        lamp("cabin", "AREA", B(x, y, z), 35, WARM, 0.8, aim=(0, 0, -1))
        x += 3.0
# a fill over the platforms under the vault (the glass lets the sun in; this lifts the shade under trains)
for x in range(40, 190, 20):
    for y in (36.5, 56.0, 76.0, 95.5):
        lamp("hall", "AREA", B(x, y, 10.5), 1000, NEUTRAL, 5.0, aim=(0, 0, -1))
# the depot shed's interior
for x in range(204, 236, 8):
    for y in (60.0, 72.0):
        lamp("shed", "AREA", B(x, y, 8.5), 700, NEUTRAL, 2.5, aim=(0, 0, -1))

world = sc.world or bpy.data.worlds.new("rws_sky")
sc.world = world
try:
    world.use_nodes = True
except Exception:
    pass
bg = next(n for n in world.node_tree.nodes if n.type == "BACKGROUND")
bg.inputs["Color"].default_value = (0.62, 0.7, 0.84, 1)      # a hazy sky
bg.inputs["Strength"].default_value = 0.95

skip = lambda o: o.type != "MESH" or "glass" in o.name or o.name.startswith(("fence", "clip_"))
for o in bpy.data.objects:
    if o.type == "MESH" and ("glass" in o.name or o.name.startswith(("fence", "clip_"))):
        o.visible_shadow = False
        o.visible_diffuse = False
        o.visible_glossy = False
        o.visible_transmission = False
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

K, AMB = 0.75, 0.06
emit_mats = {m.name for m in bpy.data.materials if m.get("pcx_kind") == "emit"}
hist = [0] * 10
for o in targets:
    me = o.data
    lay = me.color_attributes["light"]
    emissive = me.materials and me.materials[0] and me.materials[0].name in emit_mats
    vals = [0.0] * (len(lay.data) * 4)
    lay.data.foreach_get("color", vals)
    for i in range(0, len(vals), 4):
        for c in range(3):
            e = vals[i + c]
            vals[i + c] = 1.0 if emissive else min(1.0, AMB + 1.3 * e / (e + K))
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
