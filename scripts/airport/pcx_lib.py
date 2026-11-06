# PCX airport — geometry helpers shared by the build scripts (Blender 5.x).
#
# Coordinates: every helper takes MAP coordinates, the ones on docs/airport/layout-v1.svg:
#   x east 0..128, y SOUTH 0..96 (north = airside at the top of the drawing), z up, metres.
# Blender:  X = x - 64,  Y = 48 - y,  Z = z.
#
# Geometry is not made object by object: every face goes into a batch keyed by (collection, material)
# and each batch becomes ONE mesh at the end — one draw call per material per collection in the game.
# Big faces are cut into a grid (CELL metres) so the baked lighting, stored per vertex, has resolution.
import bpy, math, os

CELL = 2.0          # lighting grid (m) for big faces
HERE = os.path.dirname(os.path.abspath(__file__))


def B(x, y, z=0.0):
    """map → Blender"""
    return (x - 64.0, 48.0 - y, z)


# ----------------------------------------------------------------------------------------- materials
# name: (blockout colour, Poly Haven source scan or None, metres per texture repeat, (unused), kind)
# textured materials use textures/pcx/<name>.jpg, made from the scan by textures.mjs
# kind: opaque | glass | emit | fence | clip
MATS = {
    "concrete":    ((0.62, 0.61, 0.58), "concrete_tiles", 6.0, (0.95, 0.93, 0.9), "opaque"),
    "asphalt":     ((0.25, 0.25, 0.26), "asphalt_02", 8.0, (0.9, 0.9, 0.9), "opaque"),
    "terrazzo":    ((0.86, 0.84, 0.8), "terrazzo_tiles", 3.0, (1.0, 1.0, 1.0), "opaque"),
    "floor_tile":  ((0.7, 0.7, 0.68), "floor_tiles_06", 2.5, (1.0, 1.0, 1.0), "opaque"),
    "carpet":      ((0.25, 0.3, 0.4), "dirty_carpet", 3.0, (0.55, 0.68, 0.9), "opaque"),
    "epoxy":       ((0.42, 0.48, 0.45), "anti_slip_concrete", 4.0, (0.75, 0.88, 0.8), "opaque"),
    "plaster":     ((0.9, 0.88, 0.84), "grey_plaster", 3.0, (1.05, 1.02, 0.97), "opaque"),
    "paint":       ((0.72, 0.74, 0.76), "painted_concrete", 4.0, (1.0, 1.0, 1.0), "opaque"),
    "block":       ((0.55, 0.55, 0.55), "concrete_block_wall", 3.0, (0.95, 0.95, 0.95), "opaque"),
    "corrugated":  ((0.55, 0.6, 0.62), "corrugated_iron_02", 3.0, (0.85, 0.95, 1.0), "opaque"),
    "metal_sheet": ((0.6, 0.62, 0.6), "box_profile_metal_sheet", 4.0, (0.9, 0.95, 0.92), "opaque"),
    "shutter":     ((0.5, 0.52, 0.55), "painted_metal_shutter", 3.0, (1.0, 1.0, 1.0), "opaque"),
    "metal_plate": ((0.5, 0.5, 0.5), "metal_plate", 2.0, (1.0, 1.0, 1.0), "opaque"),
    "wood":        ((0.7, 0.5, 0.3), "oak_wood_planks", 2.5, (1.05, 0.95, 0.85), "opaque"),
    "white_steel": ((0.92, 0.92, 0.9), None, 1, None, "opaque"),
    "dark_steel":  ((0.16, 0.17, 0.19), None, 1, None, "opaque"),
    "grey_steel":  ((0.45, 0.47, 0.5), None, 1, None, "opaque"),
    "coral":       ((0.86, 0.33, 0.25), None, 1, None, "opaque"),
    "teal":        ((0.03, 0.33, 0.36), None, 1, None, "opaque"),
    "gse_yellow":  ((0.95, 0.68, 0.08), None, 1, None, "opaque"),
    "rubber":      ((0.05, 0.05, 0.05), None, 1, None, "opaque"),
    "seat_blue":   ((0.12, 0.2, 0.38), None, 1, None, "opaque"),
    "seat_teal":   ((0.06, 0.2, 0.25), None, 1, None, "opaque"),
    "navy_steel":  ((0.07, 0.11, 0.22), None, 1, None, "opaque"),
    "roof_glass":  ((0.66, 0.78, 0.84), None, 1, None, "glass"),
    "plane_white": ((0.93, 0.94, 0.95), None, 1, None, "opaque"),
    "plane_grey":  ((0.58, 0.6, 0.63), None, 1, None, "opaque"),
    "window_dark": ((0.05, 0.07, 0.09), None, 1, None, "opaque"),
    "sign_dark":   ((0.1, 0.11, 0.12), None, 1, None, "opaque"),
    "marking":     ((0.95, 0.75, 0.1), None, 1, None, "opaque"),
    "line_white":  ((0.88, 0.88, 0.86), None, 1, None, "opaque"),
    "line_red":    ((0.75, 0.12, 0.1), None, 1, None, "opaque"),
    "grass":       ((0.33, 0.4, 0.2), None, 1, None, "opaque"),
    "far_build":   ((0.62, 0.66, 0.72), None, 1, None, "opaque"),
    "luggage":     ((0.06, 0.08, 0.13), None, 1, None, "opaque"),
    "sign_text":   ((1.0, 0.8, 0.12), None, 1, None, "emit"),
    "sign_white":  ((0.95, 0.96, 1.0), None, 1, None, "emit"),
    "light_panel": ((1.0, 0.96, 0.88), None, 1, None, "emit"),
    "screen":      ((0.2, 0.45, 0.75), None, 1, None, "emit"),
    "glass":       ((0.55, 0.7, 0.75), None, 1, None, "glass"),
    "tower_glass": ((0.12, 0.2, 0.25), None, 1, None, "opaque"),
    "fence":       ((0.45, 0.47, 0.5), None, 1, None, "fence"),
    "clip":        ((1.0, 0.0, 1.0), None, 1, None, "clip"),
}
TEXTURED = False      # set by the build script: False = flat blockout colours (phase 2-4), True = textures (5+)


def material(name):
    m = bpy.data.materials.get("pcx_" + name)
    if m:
        return m
    col, tex, tile, tint, kind = MATS[name]
    m = bpy.data.materials.new("pcx_" + name)
    try:
        m.use_nodes = True
    except Exception:
        pass
    nt = m.node_tree
    bsdf = next(n for n in nt.nodes if n.type == "BSDF_PRINCIPLED")
    bsdf.inputs["Roughness"].default_value = 0.8
    rgba = (*col, 1.0)
    if TEXTURED and tex:
        # calibrated copy of the Poly Haven scan (scripts/airport/textures.mjs): already the right colour
        img = bpy.data.images.load(os.path.join(HERE, "textures", "pcx", name + ".jpg"), check_existing=True)
        tn = nt.nodes.new("ShaderNodeTexImage")
        tn.image = img
        nt.links.new(tn.outputs["Color"], bsdf.inputs["Base Color"])
    else:
        bsdf.inputs["Base Color"].default_value = rgba
    if kind == "emit":
        bsdf.inputs["Emission Color"].default_value = rgba
        bsdf.inputs["Emission Strength"].default_value = 1.0
    if kind in ("glass", "fence", "clip"):
        bsdf.inputs["Alpha"].default_value = {"glass": 0.22, "fence": 0.4, "clip": 0.0}[kind]
        try:
            m.surface_render_method = "BLENDED"
        except Exception:
            pass
        m.use_backface_culling = False
    m.diffuse_color = rgba
    m["pcx_kind"] = kind
    m["pcx_tile"] = tile
    return m


# ----------------------------------------------------------------------------------------- batches
class Batch:
    def __init__(self):
        self.v, self.f, self.uv = [], [], []


BATCHES = {}


def batch(coll, mat):
    return BATCHES.setdefault((coll, mat), Batch())


def _uv(p, n, tile):
    ax, ay, az = abs(n[0]), abs(n[1]), abs(n[2])
    if az >= ax and az >= ay:
        return (p[0] / tile, p[1] / tile)
    if ax >= ay:
        return (p[1] / tile, p[2] / tile)
    return (p[0] / tile, p[2] / tile)


def _cross(a, b):
    return (a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0])


def _sub(a, b):
    return (a[0] - b[0], a[1] - b[1], a[2] - b[2])


def _len(a):
    return math.sqrt(a[0] ** 2 + a[1] ** 2 + a[2] ** 2)


def quad(coll, mat, p0, p1, p2, p3, cell=CELL):
    """one face (Blender coords, counter-clockwise seen from the front), cut into a grid of ~cell metres"""
    bt = batch(coll, mat)
    tile = MATS[mat][2]
    n = _cross(_sub(p1, p0), _sub(p3, p0))
    nu = max(1, round(max(_len(_sub(p1, p0)), _len(_sub(p2, p3))) / cell)) if cell else 1
    nv = max(1, round(max(_len(_sub(p3, p0)), _len(_sub(p2, p1))) / cell)) if cell else 1

    def at(u, v):
        a = [p0[i] + (p1[i] - p0[i]) * u for i in range(3)]
        b = [p3[i] + (p2[i] - p3[i]) * u for i in range(3)]
        return tuple(a[i] + (b[i] - a[i]) * v for i in range(3))

    base = len(bt.v)
    for j in range(nv + 1):
        for i in range(nu + 1):
            bt.v.append(at(i / nu, j / nv))
    for j in range(nv):
        for i in range(nu):
            a = base + j * (nu + 1) + i
            face = (a, a + 1, a + nu + 2, a + nu + 1)
            bt.f.append(face)
            bt.uv.append([_uv(bt.v[k], n, tile) for k in face])


def tri(coll, mat, p0, p1, p2):
    bt = batch(coll, mat)
    n = _cross(_sub(p1, p0), _sub(p2, p0))
    base = len(bt.v)
    bt.v += [p0, p1, p2]
    bt.f.append((base, base + 1, base + 2))
    bt.uv.append([_uv(p, n, MATS[mat][2]) for p in (p0, p1, p2)])


def box(coll, mat, x0, y0, x1, y1, z0, z1, skip=(), cell=CELL):
    """axis-aligned box in map coords. skip: any of top bottom n s e w (bottom is skipped on the ground)"""
    X0, X1 = sorted((x0 - 64.0, x1 - 64.0))
    Y0, Y1 = sorted((48.0 - y0, 48.0 - y1))
    if z0 <= 0.001 and z0 >= -0.001:
        skip = tuple(skip) + ("bottom",)
    if "top" not in skip:
        quad(coll, mat, (X0, Y0, z1), (X1, Y0, z1), (X1, Y1, z1), (X0, Y1, z1), cell)
    if "bottom" not in skip:
        quad(coll, mat, (X0, Y0, z0), (X0, Y1, z0), (X1, Y1, z0), (X1, Y0, z0), cell)
    if "e" not in skip:
        quad(coll, mat, (X1, Y0, z0), (X1, Y1, z0), (X1, Y1, z1), (X1, Y0, z1), cell)
    if "w" not in skip:
        quad(coll, mat, (X0, Y1, z0), (X0, Y0, z0), (X0, Y0, z1), (X0, Y1, z1), cell)
    if "n" not in skip:   # map north = Blender +Y
        quad(coll, mat, (X1, Y1, z0), (X0, Y1, z0), (X0, Y1, z1), (X1, Y1, z1), cell)
    if "s" not in skip:
        quad(coll, mat, (X0, Y0, z0), (X1, Y0, z0), (X1, Y0, z1), (X0, Y0, z1), cell)


def top(coll, mat, x0, y0, x1, y1, z, down=False, cell=CELL):
    """a flat face only (floor seen from above, or a ceiling seen from below with down=True)"""
    X0, X1 = sorted((x0 - 64.0, x1 - 64.0))
    Y0, Y1 = sorted((48.0 - y0, 48.0 - y1))
    if down:
        quad(coll, mat, (X0, Y0, z), (X0, Y1, z), (X1, Y1, z), (X1, Y0, z), cell)
    else:
        quad(coll, mat, (X0, Y0, z), (X1, Y0, z), (X1, Y1, z), (X0, Y1, z), cell)


def rims(coll, mat, x0, y0, x1, y1, z0, z1, inward=False):
    """the four side faces of a rectangle: facing out (a slab's edge) or in (the rim of a hole)"""
    X0, X1 = sorted((x0 - 64.0, x1 - 64.0))
    Y0, Y1 = sorted((48.0 - y0, 48.0 - y1))
    faces = [
        [(X1, Y0, z0), (X1, Y1, z0), (X1, Y1, z1), (X1, Y0, z1)],
        [(X0, Y1, z0), (X0, Y0, z0), (X0, Y0, z1), (X0, Y1, z1)],
        [(X1, Y1, z0), (X0, Y1, z0), (X0, Y1, z1), (X1, Y1, z1)],
        [(X0, Y0, z0), (X1, Y0, z0), (X1, Y0, z1), (X0, Y0, z1)],
    ]
    for f in faces:
        if inward:
            f = [f[1], f[0], f[3], f[2]]
        quad(coll, mat, *f)


def cut(outer, holes):
    """rectangle minus rectangles → list of rectangles (map coords)"""
    x0, y0, x1, y1 = outer
    xs = sorted({x0, x1, *[min(max(h[i], x0), x1) for h in holes for i in (0, 2)]})
    ys = sorted({y0, y1, *[min(max(h[i], y0), y1) for h in holes for i in (1, 3)]})
    out = []
    for j in range(len(ys) - 1):
        row = []
        for i in range(len(xs) - 1):
            cx, cy = (xs[i] + xs[i + 1]) / 2, (ys[j] + ys[j + 1]) / 2
            inside = any(h[0] <= cx <= h[2] and h[1] <= cy <= h[3] for h in holes)
            if not inside:
                if row and row[-1][2] == xs[i]:
                    row[-1][2] = xs[i + 1]
                else:
                    row.append([xs[i], ys[j], xs[i + 1], ys[j + 1]])
        # merge with the row above when identical spans
        for r in row:
            prev = next((o for o in out if o[0] == r[0] and o[2] == r[2] and o[3] == r[1]), None)
            if prev:
                prev[3] = r[3]
            else:
                out.append(r)
    return [tuple(r) for r in out]


def slab(coll, mat, rect, z0, z1, holes=(), under=None):
    """floor slab with holes: top in `mat`, underside in `under` (or mat), edges included"""
    for r in cut(rect, list(holes)):
        top(coll, mat, *r, z1)
        top(coll, under or mat, *r, z0, down=True)
    rims(coll, under or mat, *rect, z0, z1)
    for h in holes:
        rims(coll, under or mat, *h, z0, z1, inward=True)


def wall(coll, mat, a, b, z0, z1, t=0.3, doors=(), glassy=False, pane=2.0, row=3.0):
    """axis-aligned wall from a=(x,y) to b=(x,y), centred on the line. doors: (s0, s1, h) along the wall's
    axis in map units (x for an east-west wall, y for a north-south one), h = opening height above z0."""
    horiz = abs(a[1] - b[1]) < 1e-6
    s_lo, s_hi = sorted((a[0], b[0])) if horiz else sorted((a[1], b[1]))
    fixed = a[1] if horiz else a[0]
    spans = []
    cur = s_lo
    for (d0, d1, h) in sorted(doors):
        d0, d1 = max(d0, s_lo), min(d1, s_hi)
        if d0 > cur:
            spans.append((cur, d0, z0, z1))
        if z0 + h < z1:
            spans.append((d0, d1, z0 + h, z1))
        cur = max(cur, d1)
    if cur < s_hi:
        spans.append((cur, s_hi, z0, z1))
    for (s0, s1, za, zb) in spans:
        if s1 - s0 < 1e-3:
            continue
        if glassy:
            glass_wall(coll, horiz, fixed, s0, s1, za, zb, pane, row)
        elif horiz:
            box(coll, mat, s0, fixed - t / 2, s1, fixed + t / 2, za, zb)
        else:
            box(coll, mat, fixed - t / 2, s0, fixed + t / 2, s1, za, zb)


def glass_wall(coll, horiz, fixed, s0, s1, z0, z1, pane=2.0, row=3.0, frame="navy_steel"):
    """curtain wall: white mullions/transoms and one separate glass quad per pane (the game breaks panes)"""
    n = max(1, round((s1 - s0) / pane))
    m = max(1, round((z1 - z0) / row))
    w = 0.08
    for i in range(n + 1):
        s = s0 + (s1 - s0) * i / n
        if horiz:
            box(coll, frame, s - w, fixed - 0.1, s + w, fixed + 0.1, z0, z1, cell=0)
        else:
            box(coll, frame, fixed - 0.1, s - w, fixed + 0.1, s + w, z0, z1, cell=0)
    for j in range(m + 1):
        z = z0 + (z1 - z0) * j / m
        za, zb = max(z0, z - w), min(z1, z + w)
        if horiz:
            box(coll, frame, s0, fixed - 0.1, s1, fixed + 0.1, za, zb, cell=0)
        else:
            box(coll, frame, fixed - 0.1, s0, fixed + 0.1, s1, za, zb, cell=0)
    for i in range(n):
        for j in range(m):
            sa = s0 + (s1 - s0) * i / n + w
            sb = s0 + (s1 - s0) * (i + 1) / n - w
            za = z0 + (z1 - z0) * j / m + w
            zb = z0 + (z1 - z0) * (j + 1) / m - w
            if horiz:
                Y = 48.0 - fixed
                quad("glass", "glass", (sa - 64, Y, za), (sb - 64, Y, za), (sb - 64, Y, zb), (sa - 64, Y, zb), 0)
            else:
                X = fixed - 64.0
                quad("glass", "glass", (X, 48 - sa, za), (X, 48 - sb, za), (X, 48 - sb, zb), (X, 48 - sa, zb), 0)


def rail(coll, a, b, z, h=1.05, glassy=True):
    """balustrade: glass panels + white handrail (or a steel rail with no glass)"""
    horiz = abs(a[1] - b[1]) < 1e-6
    if horiz:
        x0, x1 = sorted((a[0], b[0]))
        box(coll, "navy_steel", x0, a[1] - 0.05, x1, a[1] + 0.05, z + h - 0.06, z + h, cell=0)
        if glassy:
            glass_wall(coll, True, a[1], x0, x1, z, z + h - 0.06, 1.5, 2.0)
        else:
            box(coll, "grey_steel", x0, a[1] - 0.03, x1, a[1] + 0.03, z + 0.45, z + 0.5, cell=0)
            for i in range(int((x1 - x0) / 1.5) + 1):
                xx = min(x1, x0 + i * 1.5)
                box(coll, "grey_steel", xx - 0.03, a[1] - 0.03, xx + 0.03, a[1] + 0.03, z, z + h, cell=0)
    else:
        y0, y1 = sorted((a[1], b[1]))
        box(coll, "navy_steel", a[0] - 0.05, y0, a[0] + 0.05, y1, z + h - 0.06, z + h, cell=0)
        if glassy:
            glass_wall(coll, False, a[0], y0, y1, z, z + h - 0.06, 1.5, 2.0)
        else:
            box(coll, "grey_steel", a[0] - 0.03, y0, a[0] + 0.03, y1, z + 0.45, z + 0.5, cell=0)
            for i in range(int((y1 - y0) / 1.5) + 1):
                yy = min(y1, y0 + i * 1.5)
                box(coll, "grey_steel", a[0] - 0.03, yy - 0.03, a[0] + 0.03, yy + 0.03, z, z + h, cell=0)


def stairs(coll, mat, rect, z_lo, z_hi, rise, sides=False, side_mat="grey_steel", riser=0.18):
    """solid stair inside rect, climbing toward `rise` (+x, -x, +y, -y in MAP axes; +y = south)"""
    x0, y0, x1, y1 = rect
    n = max(1, round((z_hi - z_lo) / riser))
    dz = (z_hi - z_lo) / n
    along_x = rise in ("+x", "-x")
    L = (x1 - x0) if along_x else (y1 - y0)
    for k in range(n):
        f0, f1 = k / n, (k + 1) / n
        if rise == "+x":
            r = (x0 + L * f0, y0, x0 + L * f1 if k < n - 1 else x1, y1)
        elif rise == "-x":
            r = (x1 - L * f1 if k < n - 1 else x0, y0, x1 - L * f0, y1)
        elif rise == "+y":
            r = (x0, y0 + L * f0, x1, y0 + L * f1 if k < n - 1 else y1)
        else:
            r = (x0, y1 - L * f1 if k < n - 1 else y0, x1, y1 - L * f0)
        ztop = z_lo + dz * (k + 1)
        box(coll, mat, r[0], r[1], r[2], r[3], z_lo, ztop, cell=0)
        if sides:
            if along_x:
                box(coll, side_mat, r[0], y0 - 0.06, r[2], y0 + 0.04, ztop, ztop + 1.0, cell=0)
                box(coll, side_mat, r[0], y1 - 0.04, r[2], y1 + 0.06, ztop, ztop + 1.0, cell=0)
            else:
                box(coll, side_mat, x0 - 0.06, r[1], x0 + 0.04, r[3], ztop, ztop + 1.0, cell=0)
                box(coll, side_mat, x1 - 0.04, r[1], x1 + 0.06, r[3], ztop, ztop + 1.0, cell=0)


def strut(coll, mat, a, b, r=0.15):
    """square tube between two Blender points (tree-column branches, truss diagonals)"""
    import mathutils
    A, Bv = mathutils.Vector(a), mathutils.Vector(b)
    d = (Bv - A).normalized()
    up = mathutils.Vector((0, 0, 1)) if abs(d.z) < 0.95 else mathutils.Vector((1, 0, 0))
    s1 = d.cross(up).normalized() * r
    s2 = d.cross(s1).normalized() * r
    ring = [s1 + s2, -s1 + s2, -s1 - s2, s1 - s2]
    for i in range(4):
        p, q = ring[i], ring[(i + 1) % 4]
        quad(coll, mat, tuple(A + p), tuple(A + q), tuple(Bv + q), tuple(Bv + p), 0)


def cyl(coll, mat, x, y, r, z0, z1, seg=12, caps=True, cell=0):
    cx, cy, _ = B(x, y)
    pts = [(cx + r * math.cos(2 * math.pi * i / seg), cy + r * math.sin(2 * math.pi * i / seg)) for i in range(seg)]
    for i in range(seg):
        a, b = pts[i], pts[(i + 1) % seg]
        quad(coll, mat, (a[0], a[1], z0), (b[0], b[1], z0), (b[0], b[1], z1), (a[0], a[1], z1), cell)
    if caps:
        for i in range(seg):
            a, b = pts[i], pts[(i + 1) % seg]
            tri(coll, mat, (cx, cy, z1), (a[0], a[1], z1), (b[0], b[1], z1))


def cyl_y(coll, mat, x, y0, y1, z, r, seg=12, caps=True):
    """cylinder lying along the map's y axis (engines, wheels)"""
    X = x - 64.0
    Ya, Yb = 48.0 - y0, 48.0 - y1
    pts = [(X + r * math.cos(2 * math.pi * i / seg), z + r * math.sin(2 * math.pi * i / seg)) for i in range(seg)]
    for i in range(seg):
        a, b = pts[i], pts[(i + 1) % seg]
        quad(coll, mat, (a[0], Ya, a[1]), (b[0], Ya, b[1]), (b[0], Yb, b[1]), (a[0], Yb, a[1]), 0)
    if caps:
        for i in range(seg):
            a, b = pts[i], pts[(i + 1) % seg]
            tri(coll, mat, (X, Ya, z), (b[0], Ya, b[1]), (a[0], Ya, a[1]))
            tri(coll, mat, (X, Yb, z), (a[0], Yb, a[1]), (b[0], Yb, b[1]))


def cyl_x(coll, mat, x0, x1, y, z, r, seg=10):
    """cylinder lying along the map's x axis"""
    Y = 48.0 - y
    Xa, Xb = x0 - 64.0, x1 - 64.0
    pts = [(Y + r * math.cos(2 * math.pi * i / seg), z + r * math.sin(2 * math.pi * i / seg)) for i in range(seg)]
    for i in range(seg):
        a, b = pts[i], pts[(i + 1) % seg]
        quad(coll, mat, (Xa, b[0], b[1]), (Xa, a[0], a[1]), (Xb, a[0], a[1]), (Xb, b[0], b[1]), 0)


def prism(coll, mat, outline, z_bot, z_top, cell=CELL):
    """vertical prism over a convex 4-point outline in map coords (counter-clockwise on the drawing is
    clockwise in Blender, so it is reordered here). z_bot / z_top: one height or one per point."""
    P = [B(x, y) for (x, y) in outline]
    zb = z_bot if isinstance(z_bot, (list, tuple)) else [z_bot] * len(P)
    zt = z_top if isinstance(z_top, (list, tuple)) else [z_top] * len(P)
    # make P counter-clockwise in Blender XY
    area = sum(P[i][0] * P[(i + 1) % len(P)][1] - P[(i + 1) % len(P)][0] * P[i][1] for i in range(len(P)))
    idx = list(range(len(P)))
    if area < 0:
        idx.reverse()
    P = [P[i] for i in idx]
    zb = [zb[i] for i in idx]
    zt = [zt[i] for i in idx]
    T = [(p[0], p[1], zt[i]) for i, p in enumerate(P)]
    Bm = [(p[0], p[1], zb[i]) for i, p in enumerate(P)]
    quad(coll, mat, T[0], T[1], T[2], T[3], cell)
    quad(coll, mat, Bm[0], Bm[3], Bm[2], Bm[1], cell)
    for i in range(4):
        j = (i + 1) % 4
        quad(coll, mat, Bm[i], Bm[j], T[j], T[i], cell)


def text(coll, mat, body, x, y, z, size=0.6, facing="s", depth=0.02, align="CENTER"):
    """flat 3D text (a sign's lettering) on a wall facing map north/south/east/west, baked into the batch"""
    cu = bpy.data.curves.new("t", "FONT")
    cu.body = body
    cu.size = size
    cu.resolution_u = 2
    cu.extrude = depth
    cu.align_x = align
    cu.align_y = "CENTER"
    ob = bpy.data.objects.new("t", cu)
    bpy.context.scene.collection.objects.link(ob)
    rot = {"s": (math.pi / 2, 0, 0), "n": (math.pi / 2, 0, math.pi), "e": (math.pi / 2, 0, math.pi / 2), "w": (math.pi / 2, 0, -math.pi / 2), "up": (0, 0, 0)}[facing]
    ob.rotation_euler = rot
    ob.location = B(x, y, z)
    bpy.context.view_layer.update()
    dg = bpy.context.evaluated_depsgraph_get()
    ev = ob.evaluated_get(dg)
    me = ev.to_mesh()
    M = ob.matrix_world
    bt = batch(coll, mat)
    base = len(bt.v)
    for v in me.vertices:
        w = M @ v.co
        bt.v.append((w.x, w.y, w.z))
    for p in me.polygons:
        bt.f.append(tuple(base + i for i in p.vertices))
        bt.uv.append([(0.0, 0.0)] * len(p.vertices))
    ev.to_mesh_clear()
    bpy.data.objects.remove(ob)
    bpy.data.curves.remove(cu)


# ----------------------------------------------------------------------------------------- output
COLLECTIONS = {}


def collection(name, parent=None):
    if name in COLLECTIONS:
        return COLLECTIONS[name]
    c = bpy.data.collections.new(name)
    (parent or bpy.context.scene.collection).children.link(c)
    COLLECTIONS[name] = c
    return c


# batch collection key → Blender collection name (order = outliner order)
COLL_NAMES = {
    "terrain": "PCX_10_Terrain", "terminal": "PCX_20_Terminal", "upper": "PCX_21_Terminal_L1",
    "under": "PCX_22_Underground", "airside": "PCX_30_Airside", "aircraft": "PCX_40_Aircraft",
    "props": "PCX_50_Props", "signs": "PCX_60_Signage", "glass": "PCX_70_Glass", "roof": "PCX_25_Roof",
    "fence": "PCX_80_Boundary", "clip": "PCX_81_Clip", "backdrop": "PCX_90_Backdrop",
}


def flush():
    """every batch → one mesh object (collection × material), with UVs and a 'light' colour layer"""
    made = []
    for (ck, mk), bt in BATCHES.items():
        if not bt.f:
            continue
        me = bpy.data.meshes.new(f"{ck}_{mk}")
        me.from_pydata(bt.v, [], bt.f)
        uvl = me.uv_layers.new(name="UVMap")
        li = 0
        for p, uvs in zip(me.polygons, bt.uv):
            for k, li_ in enumerate(p.loop_indices):
                uvl.data[li_].uv = uvs[k]
        me.materials.append(material(mk))
        me.validate()
        # glass must keep one separate quad per pane (the game breaks panes); everything else is welded
        name = "glass" if ck == "glass" else ("fence" if ck == "fence" else ("clip_" + mk if ck == "clip" else f"{ck}_{mk}"))
        ob = bpy.data.objects.new(name, me)
        collection(COLL_NAMES[ck]).objects.link(ob)
        made.append(ob)
    BATCHES.clear()
    return made


def weld(objs, dist=0.002):
    import bmesh
    for ob in objs:
        if ob.name.startswith(("glass",)):
            continue
        bm = bmesh.new()
        bm.from_mesh(ob.data)
        bmesh.ops.remove_doubles(bm, verts=bm.verts, dist=dist)
        bm.to_mesh(ob.data)
        bm.free()


def empty(name, x, y, z, coll="PCX_95_Gameplay", yaw=0.0):
    ob = bpy.data.objects.new(name, None)
    ob.empty_display_type = "ARROWS"
    ob.location = B(x, y, z)
    ob.rotation_euler = (0, 0, yaw)
    collection(coll).objects.link(ob)
    return ob


def reset_scene():
    for ob in list(bpy.data.objects):
        bpy.data.objects.remove(ob)
    for c in list(bpy.data.collections):
        bpy.data.collections.remove(c)
    for m in list(bpy.data.meshes):
        bpy.data.meshes.remove(m)
    for m in list(bpy.data.materials):
        bpy.data.materials.remove(m)
    COLLECTIONS.clear()
    BATCHES.clear()
    sc = bpy.context.scene
    sc.unit_settings.system = "METRIC"
    sc.unit_settings.scale_length = 1.0
