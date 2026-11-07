# TERMINUS — the three Sketchfab trains, made game-ready once (the build imports the results):
#   Blender -b --factory-startup -P scripts/railway/prep_models.py -- ~/Downloads
# Each model: every mesh joined into one object in world space, turned so its length runs along Blender X,
# scaled to its real width, set on z 0 (rail head) and centred, decimated to a triangle budget, exported to
# scripts/railway/models/<name>.glb with its base-colour textures (the map is drawn unlit).
#   soviet_loco  "Soviet armoured train locomotive" by Nadir Alishly          CC BY 4.0
#   hst_power    "Train - Intercity 125 Executive with buffers" by timblewee   CC BY 4.0
#   old_coach    "Train Wagon" by 3ddominator                                  CC BY 4.0
import bpy, math, os, sys
from mathutils import Matrix, Vector

HERE = os.path.dirname(os.path.abspath(__file__))
argv = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []
SRC = os.path.expanduser(argv[0] if argv else "~/Downloads")
# name: (source file, width across the track in metres, triangle budget, mesh-name patterns to drop)
MODELS = {
    "soviet_loco": ("soviet_armoured_train_locomotive.glb", 3.1, 24000, ()),
    "hst_power": ("train_-_intercity_125_executive_with_buffers.glb", 2.74, 22000, ("Rivets", "Inside Blocker")),
    "old_coach": ("train_wagon.glb", 2.9, 6000, ()),
}


def tris(ob):
    return sum(len(p.vertices) - 2 for p in ob.data.polygons)


def prep(name, src, width, budget, drop):
    bpy.ops.wm.read_factory_settings(use_empty=True)
    bpy.ops.import_scene.gltf(filepath=os.path.join(SRC, src))
    obs = [o for o in bpy.data.objects if o.type == "MESH"]
    keep = []
    for o in obs:
        chain, p = [o.name], o.parent
        while p:
            chain.append(p.name)
            p = p.parent
        if any(d in c for d in drop for c in chain):
            continue
        o.data = o.data.copy()
        o.data.transform(o.matrix_world)
        keep.append(o)
    for o in list(bpy.data.objects):
        if o not in keep:
            bpy.data.objects.remove(o)
    for o in keep:
        o.parent = None
        o.matrix_world = Matrix.Identity(4)
    with bpy.context.temp_override(active_object=keep[0], selected_editable_objects=keep):
        bpy.ops.object.join()
    ob = keep[0]
    me = ob.data
    vs = [v.co for v in me.vertices]
    mn = Vector((min(v.x for v in vs), min(v.y for v in vs), min(v.z for v in vs)))
    mx = Vector((max(v.x for v in vs), max(v.y for v in vs), max(v.z for v in vs)))
    size = mx - mn
    # the length along Blender X (turn a model that runs along Y)
    if size.y > size.x:
        me.transform(Matrix.Rotation(math.radians(90), 4, "Z"))
        size = Vector((size.y, size.x, size.z))
    s = width / size.y
    me.transform(Matrix.Scale(s, 4))
    vs = [v.co for v in me.vertices]
    mn = Vector((min(v.x for v in vs), min(v.y for v in vs), min(v.z for v in vs)))
    mx = Vector((max(v.x for v in vs), max(v.y for v in vs), max(v.z for v in vs)))
    me.transform(Matrix.Translation(Vector((-(mn.x + mx.x) / 2, -(mn.y + mx.y) / 2, -mn.z))))
    before = tris(ob)
    if before > budget:
        md = ob.modifiers.new("dec", "DECIMATE")
        md.ratio = budget / before
        with bpy.context.temp_override(object=ob, active_object=ob):
            bpy.ops.object.modifier_apply(modifier=md.name)
    for m in me.materials:
        if m and m.node_tree:
            bs = next((n for n in m.node_tree.nodes if n.type == "BSDF_PRINCIPLED"), None)
            if bs:
                for l in list(bs.inputs["Alpha"].links):
                    m.node_tree.links.remove(l)
                bs.inputs["Alpha"].default_value = 1.0
            try:
                m.surface_render_method = "DITHERED"
            except Exception:
                pass
    ob.name = me.name = name
    vs = [v.co for v in me.vertices]
    print(f"{name}: {before} → {tris(ob)} tris, scale {s:.4f}, {max(v.x for v in vs) - min(v.x for v in vs):.2f} long × {max(v.y for v in vs) - min(v.y for v in vs):.2f} × {max(v.z for v in vs):.2f} m, materials {len(me.materials)}")
    out = os.path.join(HERE, "models", name + ".glb")
    os.makedirs(os.path.dirname(out), exist_ok=True)
    bpy.ops.export_scene.gltf(filepath=out, export_format="GLB", use_selection=False, export_apply=True,
                              export_normals=False, export_tangents=False, export_animations=False)
    print("wrote", out, f"{os.path.getsize(out) / 1e6:.1f} MB")


for name, (src, width, budget, drop) in MODELS.items():
    prep(name, src, width, budget, drop)
