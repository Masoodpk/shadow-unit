# TERMINUS — Port Calder Central (stage id "railway"), a Victorian terminus. Builds the map in Blender.
#
#   /Applications/Blender.app/Contents/MacOS/Blender -b --factory-startup -P scripts/railway/rws_build.py -- --phase 5 --out scripts/railway/out/rws.blend
#
# (or in Blender: Scripting tab → Open this file → Run Script; set PHASE below first.)
#   phase 2–4  the same geometry in flat blockout colours (fast to look at, nothing to load)
#   phase 5    with textures (scripts/airport/textures/pcx, the heritage set from scripts/railway/textures.mjs)
# Light and export are separate scripts: rws_bake.py, ../airport/pcx_export.py.
# Layout, levels and numbers: docs/railway/PHASE1-2-concept-blueprint.md (map coords: x east 0..240,
# y south 0..150, z up, metres; in the game x = 64 − mx, z = my − 48). The heritage restyle (same layout,
# Victorian architecture, the old trains): docs/railway/HERITAGE-plan.md.
#
# Geometry helpers come from the airport build (scripts/airport/pcx_lib.py: box, slab, wall, stairs,
# glass_wall …, one mesh per material per collection). The trains from Sketchfab are made game-ready once by
# prep_models.py (models/*.glb).
import bpy, math, os, random, sys
from mathutils import Matrix, Vector

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.join(HERE, "..", "airport"))
import importlib
import pcx_lib as L
importlib.reload(L)
from pcx_lib import B, box, top, wall, stairs, slab, cyl, cyl_y, cyl_x, prism, quad, tri, text, strut, glass_wall

PHASE = 5
OUT = None
argv = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []
for i, a in enumerate(argv):
    if a == "--phase":
        PHASE = int(argv[i + 1])
    if a == "--out":
        OUT = argv[i + 1]
L.TEXTURED = PHASE >= 5
random.seed(11)

# ---------------------------------------------------------------------------------------- materials
# (name: blockout colour, texture (textures/pcx/<name>.jpg) or None, metres per repeat, unused, kind)
_o = lambda c: (c, None, 1, None, "opaque")
_e = lambda c: (c, None, 1, None, "emit")
L.MATS.update({
    "ballast":     ((0.42, 0.41, 0.4), "ballast", 2.2, None, "opaque"),
    "brick":       ((0.56, 0.3, 0.23), "brick", 1.2, None, "opaque"),
    "brick_dark":  ((0.36, 0.2, 0.15), "brick_dark", 1.6, None, "opaque"),
    "stone":       ((0.74, 0.68, 0.57), "stone", 3.0, None, "opaque"),
    "cobbles":     ((0.5, 0.49, 0.47), "cobbles", 2.5, None, "opaque"),
    "flags":       ((0.63, 0.61, 0.57), "flags", 2.4, None, "opaque"),
    "encaustic":   ((0.56, 0.4, 0.3), "encaustic", 1.6, None, "opaque"),
    "slate":       ((0.33, 0.35, 0.38), "slate", 2.5, None, "opaque"),
    "iron":        ((0.14, 0.24, 0.18), "iron", 2.0, None, "opaque"),
    "timber":      ((0.46, 0.33, 0.21), "timber", 2.0, None, "opaque"),
    "panel":       ((0.34, 0.2, 0.12), "panel", 1.6, None, "opaque"),
    "boards":      ((0.6, 0.46, 0.32), "boards", 2.5, None, "opaque"),
    "tile_glazed": ((0.86, 0.82, 0.68), "tile_glazed", 3.0, None, "opaque"),   # 3.0: the band's height is in it
    "rail_steel":  _o((0.38, 0.36, 0.34)),
    "sleeper":     _o((0.27, 0.2, 0.14)),
    "maroon":      _o((0.36, 0.07, 0.08)),
    "cream":       _o((0.86, 0.8, 0.64)),
    "brass":       _o((0.72, 0.55, 0.25)),
    "loco_green":  _o((0.07, 0.26, 0.13)),
    "loco_black":  _o((0.05, 0.05, 0.06)),
    "coal":        _o((0.035, 0.035, 0.04)),
    "sack":        _o((0.6, 0.5, 0.35)),
    "canvas":      _o((0.3, 0.33, 0.25)),
    "red_paint":   _o((0.62, 0.1, 0.08)),
    "roof_grey":   _o((0.4, 0.4, 0.41)),
    "metro_red":   _o((0.62, 0.1, 0.09)),
    "seat_red":    _o((0.45, 0.08, 0.1)),
    "foliage":     ((0.2, 0.32, 0.14), "foliage", 1.8, None, "opaque"),   # textures.mjs: leaves
    "bark":        ((0.3, 0.26, 0.21), "bark", 1.2, None, "opaque"),
    "sash":        _o((0.85, 0.82, 0.72)),
    "sig_green":   _e((0.25, 1.0, 0.45)),
    "sig_red":     _e((1.0, 0.15, 0.1)),
    "lamp_glass":  _e((1.0, 0.84, 0.55)),
    "clock_face":  _e((0.95, 0.92, 0.82)),
    # the shared airport palette, re-dressed for the period (this build only)
    "navy_steel":  _o((0.09, 0.16, 0.12)),      # glazing bars and frames: deep green
    "white_steel": _o((0.82, 0.77, 0.64)),      # cream paint
    "sign_dark":   _o((0.32, 0.06, 0.07)),      # maroon enamel
    "sign_text":   _e((0.95, 0.89, 0.72)),      # cream lettering
    "sign_white":  _e((0.95, 0.89, 0.72)),
    "light_panel": _e((1.0, 0.85, 0.6)),        # what the baked lamps seem to come from (rws_bake.py)
    "screen":      _e((0.88, 0.8, 0.58)),       # lit track diagrams
    "seat_teal":   _o((0.3, 0.17, 0.09)),
    "marking":     _o((0.88, 0.86, 0.8)),
    "far_build":   _o((0.34, 0.24, 0.2)),
    "fence":       ((0.1, 0.11, 0.1), None, 1, None, "fence"),
})
# collections (batch key → Blender collection, outliner order)
L.COLL_NAMES.clear()
L.COLL_NAMES.update({
    "ground": "RWS_10_Ground", "hall": "RWS_20_Hall", "platform": "RWS_21_Platforms", "track": "RWS_22_Tracks",
    "building": "RWS_30_Station", "north": "RWS_31_NorthBuilding", "upper": "RWS_32_Galleries_Bridges",
    "soft": "RWS_33_Ironwork", "under": "RWS_40_Underground", "yard": "RWS_50_Yards_Depot", "trains": "RWS_60_Trains",
    "props": "RWS_70_Props", "signs": "RWS_75_Signage", "roof": "RWS_25_RoofGlass", "glass": "RWS_80_Glass",
    "fence": "RWS_85_Boundary", "clip": "RWS_86_Clip", "backdrop": "RWS_90_Backdrop",
})
G, H, PL, TR, BL, NB, UP, UG, YD, TN, P, S, BD = ("ground", "hall", "platform", "track", "building", "north", "upper",
                                                  "under", "yard", "trains", "props", "signs", "backdrop")
SO = "soft"   # open ironwork (balusters, lattice): stops players, not bullets (voxel-map --soft 'soft_')

# ---------------------------------------------------------------------------------------- the plan
PLAY = (0, 0, 240, 150)
Z_BED, Z_RAIL, Z_UG, Z_UP = -1.2, -0.9, -7.0, 7.0
HALL = (30, 32, 190, 100)
PX0, PX1 = 36.0, 184.0                       # platform ends (the ramps run down to x 31.5 / 188.5)
PLATFORMS = [("1", 91, 100), ("2", 71, 81), ("3", 51, 61), ("4", 32, 41)]
TRACKS = {"T1": 88.5, "T2": 83.5, "T3": 68.5, "T4": 63.5, "T5": 48.5, "T6": 43.5}
SIDINGS = {"S1": 7.5, "S2": 12.5}
BRIDGES = [(72, 78), (142, 148)]             # lattice footbridges over the tracks (x0, x1), deck at +7
SUB = (112, 120)                             # the subway passage (x0, x1), floor −7, y 33 … 104
SUB_STAIR = (100, 112)                       # each platform's stair down to it (x, high end west)
METRO = (60, 104, 170, 121.5)                # the underground railway's hall under the booking hall
LOBBY_HOLE = (86, 104, 134, 122)             # the booking hall's double-height atrium (no gallery floor)
LANTERN = (86, 104, 134, 119)                # its glazed lantern (the clock tower stands on the roof south of it)
METRO_STAIR = (140, 106, 151.7, 109)         # booking hall → underground platform
GATES = [(66, 74), (106, 114), (128, 136)]   # ticket barriers booking hall → platform 1 (x0, x1)
TOWER = (106.5, 119.0, 113.5, 126.25)        # the clock tower's footprint (on the roof, z 12.5 up)


def plat_centre(name):
    return next((a + b) / 2 for (n, a, b) in PLATFORMS if n == name)


def sub_hole(name):
    c = plat_centre(name)
    return (SUB_STAIR[0], c - 1.5, SUB_STAIR[1], c + 1.5)


# ======================================================================================== heritage helpers
def face(coll, mat, pts, want, cell=0):
    """a planar face (3 or 4 Blender points) turned so its normal points along `want`"""
    a, b, c = pts[0], pts[1], pts[-1]
    n = L._cross(L._sub(b, a), L._sub(c, a))
    if sum(n[i] * want[i] for i in range(3)) < 0:
        pts = pts[::-1]
    if len(pts) == 4:
        quad(coll, mat, *pts, cell)
    else:
        tri(coll, mat, *pts)


def disc(coll, mat, c, normal, r, seg=20):
    """a flat disc (clock faces, lamp lenses, buffer heads) at Blender point c facing `normal`"""
    n = Vector(normal).normalized()
    u = n.cross(Vector((0, 0, 1)) if abs(n.z) < 0.9 else Vector((1, 0, 0))).normalized()
    v = n.cross(u)
    C = Vector(c)
    pts = [C + (u * math.cos(2 * math.pi * i / seg) + v * math.sin(2 * math.pi * i / seg)) * r for i in range(seg)]
    for i in range(seg):
        face(coll, mat, [tuple(C), tuple(pts[i]), tuple(pts[(i + 1) % seg])], tuple(n))


def rail(coll, a, b, z, h=1.05, glassy=True):
    """a cast-iron balustrade (it replaces the airport's glass one everywhere in this map): a moulded handrail,
    a bottom rail, balusters every 0.25 m and a newel every 3 m. The ironwork stops players but not bullets
    ("soft"); a clip block keeps everyone from squeezing through."""
    horiz = abs(a[1] - b[1]) < 1e-6
    s0, s1 = sorted((a[0], b[0])) if horiz else sorted((a[1], b[1]))
    f = a[1] if horiz else a[0]

    def bx(c, mat, sa, sb, w, za, zb, skip=()):
        if horiz:
            box(c, mat, sa, f - w, sb, f + w, za, zb, skip=skip, cell=0)
        else:
            box(c, mat, f - w, sa, f + w, sb, za, zb, skip=skip, cell=0)
    if s1 - s0 < 0.05:
        return
    bx(SO, "iron", s0, s1, 0.05, z + h - 0.07, z + h)
    bx(SO, "iron", s0, s1, 0.03, z + 0.06, z + 0.12)
    n = max(1, round((s1 - s0) / 0.25))
    for i in range(n + 1):
        s = s0 + (s1 - s0) * i / n
        if i % 12 == 0 or i == n:
            bx(SO, "iron", s - 0.045, s + 0.045, 0.045, z, z + h + 0.04)
        else:
            bx(SO, "iron", s - 0.013, s + 0.013, 0.013, z + 0.12, z + h - 0.07, skip=("top", "bottom"))
    bx("clip", "clip", s0, s1, 0.06, z, z + h)


def _wp(horiz, fixed, s, z, off):
    """a point in a wall's plane: s along the wall, z up, off across it (map units) → Blender"""
    return B(s, fixed + off, z) if horiz else B(fixed + off, s, z)


def _wn(horiz, side):
    """the Blender normal of a wall face on `side` (+1: towards +y / +x in map)"""
    return (0.0, -side, 0.0) if horiz else (side, 0.0, 0.0)


def arch_head(coll, mat, horiz, fixed, s0, s1, zs, zt, t, ring="stone", fan=None, fan_coll="roof", seg=12, bars=True):
    """the wall over an arched opening: the rectangle s0..s1 × zs..zt less a semicircle (radius (s1−s0)/2,
    springing at zs), both faces and the soffit; a stone ring and keystone on both faces; `fan`: a material
    that fills the semicircle (a fanlight, with radial glazing bars)"""
    c, r = (s0 + s1) / 2, (s1 - s0) / 2
    hgt = zt - zs
    tc = math.atan2(hgt, r)
    angs = sorted(set([math.pi * k / seg for k in range(seg + 1)] + [tc, math.pi - tc]))
    circ = lambda a: (c + r * math.cos(a), zs + r * math.sin(a))

    def outer(a):
        ca, sa = math.cos(a), math.sin(a)
        if abs(ca) > 1e-9 and abs(r * sa / abs(ca)) <= hgt + 1e-9:
            return (c + math.copysign(r, ca), zs + r * sa / abs(ca))
        return (c + hgt * ca / max(sa, 1e-9), zt)
    for side in (-1, 1):
        o = side * t / 2
        want = _wn(horiz, side)
        for k in range(len(angs) - 1):
            a0, a1 = angs[k], angs[k + 1]
            p0, p1 = circ(a0), circ(a1)
            q0, q1 = outer(a0), outer(a1)
            pts = [_wp(horiz, fixed, *p0, o), _wp(horiz, fixed, *p1, o), _wp(horiz, fixed, *q1, o), _wp(horiz, fixed, *q0, o)]
            if math.dist(pts[0], pts[3]) < 1e-4:
                pts = pts[1:]
            elif math.dist(pts[1], pts[2]) < 1e-4:
                pts = [pts[0], pts[1], pts[3]]
            face(coll, mat, pts, want)
        # the ring: voussoirs proud of the face, a keystone at the crown
        if ring:
            w = min(0.42, r * 0.22)
            ro = o + side * 0.03
            for k in range(seg):
                a0, a1 = math.pi * k / seg, math.pi * (k + 1) / seg
                pa = [(c + rr * math.cos(a), zs + rr * math.sin(a)) for (rr, a) in ((r, a0), (r, a1), (r + w, a1), (r + w, a0))]
                face(coll, ring, [_wp(horiz, fixed, *p, ro) for p in pa], want)
            ks = [(c - w * 0.45, zs + r - 0.05), (c + w * 0.45, zs + r - 0.05), (c + w * 0.6, zs + r + w * 1.3), (c - w * 0.6, zs + r + w * 1.3)]
            face(coll, ring, [_wp(horiz, fixed, *p, ro + side * 0.02) for p in ks], want)
    # the soffit, between the two faces, facing the opening
    for k in range(seg):
        a0, a1 = math.pi * k / seg, math.pi * (k + 1) / seg
        p0, p1 = circ(a0), circ(a1)
        am = (a0 + a1) / 2
        want = (-math.cos(am), 0.0, -math.sin(am)) if horiz else (0.0, math.cos(am), -math.sin(am))
        face(coll, mat, [_wp(horiz, fixed, *p0, -t / 2), _wp(horiz, fixed, *p1, -t / 2), _wp(horiz, fixed, *p1, t / 2), _wp(horiz, fixed, *p0, t / 2)], want)
    if fan:
        for side in (-1, 1):
            for k in range(seg):
                a0, a1 = math.pi * k / seg, math.pi * (k + 1) / seg
                face(fan_coll, fan, [_wp(horiz, fixed, c, zs, 0.0), _wp(horiz, fixed, *circ(a0), 0.0), _wp(horiz, fixed, *circ(a1), 0.0)], _wn(horiz, side))
        if bars:
            for k in range(1, 6):
                a = math.pi * k / 6
                strut(coll if coll != SO else BL, "navy_steel", _wp(horiz, fixed, c, zs, 0.0), _wp(horiz, fixed, *circ(a), 0.0), 0.025)
            strut(coll if coll != SO else BL, "navy_steel", _wp(horiz, fixed, s0, zs, 0.0), _wp(horiz, fixed, s1, zs, 0.0), 0.03)


def arched_window(coll, horiz, fixed, s0, s1, z_sill, z_spring, z_top, t, wall_mat="brick", lights=2, rows=2):
    """an arched sash window in a wall: breakable panes from the sill to the springing, a fanlight in the arch
    head, cream sash bars, a stone sill and a stone ring"""
    glass_wall(coll, horiz, fixed, s0, s1, z_sill, z_spring, (s1 - s0) / lights, (z_spring - z_sill) / rows, frame="sash")
    arch_head(coll, wall_mat, horiz, fixed, s0, s1, z_spring, z_top, t, fan="roof_glass")
    if horiz:
        box(coll, "stone", s0 - 0.15, fixed - t / 2 - 0.08, s1 + 0.15, fixed + t / 2 + 0.08, z_sill - 0.15, z_sill, cell=0)
    else:
        box(coll, "stone", fixed - t / 2 - 0.08, s0 - 0.15, fixed + t / 2 + 0.08, s1 + 0.15, z_sill - 0.15, z_sill, cell=0)


def blind_window(coll, horiz, fixed, side, s0, s1, z_sill, z_spring, glazing="window_dark"):
    """a window drawn on a wall's face (no opening): dark glass with sash bars under a round arch, a stone ring
    and sill. fixed: the face's position, side: the way it faces (+1: towards +y / +x in map)"""
    want = _wn(horiz, side)
    c, r = (s0 + s1) / 2, (s1 - s0) / 2
    o = side * 0.015
    face(coll, glazing, [_wp(horiz, fixed, s0, z_sill, o), _wp(horiz, fixed, s1, z_sill, o), _wp(horiz, fixed, s1, z_spring, o), _wp(horiz, fixed, s0, z_spring, o)], want)
    seg = 10
    for k in range(seg):
        a0, a1 = math.pi * k / seg, math.pi * (k + 1) / seg
        face(coll, glazing, [_wp(horiz, fixed, c, z_spring, o), _wp(horiz, fixed, c + r * math.cos(a0), z_spring + r * math.sin(a0), o),
                             _wp(horiz, fixed, c + r * math.cos(a1), z_spring + r * math.sin(a1), o)], want)
    ob = side * 0.04
    strut(coll, "sash", _wp(horiz, fixed, c, z_sill, ob), _wp(horiz, fixed, c, z_spring + r, ob), 0.03)
    for zz in (z_sill + (z_spring - z_sill) / 2, z_spring):
        strut(coll, "sash", _wp(horiz, fixed, s0, zz, ob), _wp(horiz, fixed, s1, zz, ob), 0.03)
    w = min(0.35, r * 0.3)
    orr = side * 0.05
    for k in range(seg):
        a0, a1 = math.pi * k / seg, math.pi * (k + 1) / seg
        pa = [(c + rr * math.cos(a), z_spring + rr * math.sin(a)) for (rr, a) in ((r, a0), (r, a1), (r + w, a1), (r + w, a0))]
        face(coll, "stone", [_wp(horiz, fixed, *p, orr) for p in pa], want)
    if horiz:
        y0_, y1_ = sorted((fixed, fixed + side * 0.14))
        box(coll, "stone", s0 - 0.12, y0_, s1 + 0.12, y1_, z_sill - 0.16, z_sill, cell=0)
    else:
        x0_, x1_ = sorted((fixed, fixed + side * 0.14))
        box(coll, "stone", x0_, s0 - 0.12, x1_, s1 + 0.12, z_sill - 0.16, z_sill, cell=0)


def iron_column(coll, x, y, r, z0, z1, brackets=(), capital=True):
    """a fluted cast-iron column: square plinth, moulded base, a shaft of 16 flutes, a foliated capital and a
    square abacus; `brackets`: directions ((dx, dy) unit) for the scrolled spandrel brackets under a beam"""
    box(coll, "iron", x - r - 0.14, y - r - 0.14, x + r + 0.14, y + r + 0.14, z0, z0 + 0.55, cell=0)
    cyl(coll, "iron", x, y, r + 0.08, z0 + 0.55, z0 + 0.85, seg=16, caps=False)
    cyl(coll, "iron", x, y, r, z0 + 0.85, z1 - (0.7 if capital else 0), seg=16, caps=False)
    if capital:
        cyl(coll, "iron", x, y, r + 0.06, z1 - 0.7, z1 - 0.6, seg=16, caps=False)
        prism(coll, "iron", [(x - r, y - r), (x + r, y - r), (x + r, y + r), (x - r, y + r)], z1 - 0.6, z1 - 0.15, cell=0)
        box(coll, "iron", x - r - 0.18, y - r - 0.18, x + r + 0.18, y + r + 0.18, z1 - 0.15, z1, cell=0)
    for (dx, dy) in brackets:
        # a quarter-circle scroll from the shaft up to the beam, and its straight back
        R = 1.6
        pts = [B(x + dx * r, y + dy * r, z1 - R)] + [B(x + dx * (r + R * (1 - math.cos(a))), y + dy * (r + R * (1 - math.cos(a))), z1 - R + R * math.sin(a)) for a in [math.pi / 2 * k / 5 for k in range(1, 6)]]
        for i in range(len(pts) - 1):
            strut(coll, "iron", pts[i], pts[i + 1], 0.05)
        strut(coll, "iron", B(x + dx * r, y + dy * r, z1 - 0.05), B(x + dx * (r + R), y + dy * (r + R), z1 - 0.05), 0.05)
        strut(coll, "iron", B(x + dx * r, y + dy * r, z1 - R * 0.55), B(x + dx * (r + R * 0.55), y + dy * (r + R * 0.55), z1 - 0.1), 0.035)


def stone_column(coll, x, y, r, z0, z1):
    """a stone column: a square base, a round shaft, a moulded capital"""
    box(coll, "stone", x - r - 0.2, y - r - 0.2, x + r + 0.2, y + r + 0.2, z0, z0 + 0.6, cell=0)
    cyl(coll, "stone", x, y, r + 0.08, z0 + 0.6, z0 + 0.8, seg=16, caps=False)
    cyl(coll, "stone", x, y, r, z0 + 0.8, z1 - 0.6, seg=16, caps=False)
    cyl(coll, "stone", x, y, r + 0.1, z1 - 0.6, z1 - 0.4, seg=16, caps=False)
    box(coll, "stone", x - r - 0.22, y - r - 0.22, x + r + 0.22, y + r + 0.22, z1 - 0.4, z1, cell=0)


def lantern(x, y, zc, drop=0.9, coll=P, post=False):
    """a hanging lamp: a rod from the ceiling at zc (or the top of a post), an iron canopy, a glass body that
    glows, and under it the small light panel where the bake puts its lamp"""
    zb = zc - drop
    if not post:
        box(coll, "iron", x - 0.02, y - 0.02, x + 0.02, y + 0.02, zb + 0.5, zc, cell=0)
    prism(coll, "iron", [(x - 0.24, y - 0.24), (x + 0.24, y - 0.24), (x + 0.24, y + 0.24), (x - 0.24, y + 0.24)], zb + 0.42, zb + 0.5, cell=0)
    box(coll, "lamp_glass", x - 0.17, y - 0.17, x + 0.17, y + 0.17, zb + 0.04, zb + 0.42, cell=0)
    box(coll, "iron", x - 0.19, y - 0.19, x + 0.19, y + 0.19, zb, zb + 0.04, cell=0)
    top(coll, "light_panel", x - 0.12, y - 0.12, x + 0.12, y + 0.12, zb - 0.005, down=True, cell=0)


def gas_lamp(x, y, z0=0.0, h=3.4, coll=P):
    """a cast-iron lamp standard: fluted post, ladder bar, a lantern on top"""
    box(coll, "iron", x - 0.13, y - 0.13, x + 0.13, y + 0.13, z0, z0 + 0.45, cell=0)
    cyl(coll, "iron", x, y, 0.07, z0 + 0.45, z0 + h, seg=8, caps=False)
    box(coll, "iron", x - 0.32, y - 0.02, x + 0.32, y + 0.02, z0 + h - 0.35, z0 + h - 0.3, cell=0)
    lantern(x, y, z0 + h + 0.55, drop=0.55, coll=coll, post=True)


def hanging_clock(x, y, z, axis="x", coll=P, top_z=None):
    """a double-faced station clock in an iron case, hung from above (faces along ±axis)"""
    nrm = [(1, 0, 0), (-1, 0, 0)] if axis == "x" else [(0, -1, 0), (0, 1, 0)]
    X, Y, _ = B(x, y)
    if axis == "x":
        cyl_x(coll, "iron", x - 0.16, x + 0.16, y, z, 0.62, seg=20)
    else:
        cyl_y(coll, "iron", x, y - 0.16, y + 0.16, z, 0.62, seg=20)
    for n in nrm:
        c = (X + n[0] * 0.17, Y + n[1] * 0.17, z)
        disc(coll, "clock_face", c, n, 0.54, seg=20)
        for k in range(12):
            a = 2 * math.pi * k / 12
            ox, oz = 0.46 * math.cos(a), 0.46 * math.sin(a)
            p = (c[0] + n[0] * 0.005 + (ox if axis != "x" else 0), c[1] + n[1] * 0.005 + (ox if axis == "x" else 0), c[2] + oz)
            disc(coll, "iron", p, n, 0.03 if k % 3 else 0.05, seg=4)
        for (ln, a, w) in ((0.36, 1.1, 0.025), (0.26, -0.5, 0.035)):
            e = (c[0] + n[0] * 0.01 + (ln * math.cos(a) if axis != "x" else 0), c[1] + n[1] * 0.01 + (ln * math.cos(a) if axis == "x" else 0), c[2] + ln * math.sin(a))
            strut(coll, "iron", (c[0] + n[0] * 0.01, c[1] + n[1] * 0.01, c[2]), e, w)
    if top_z is None or top_z > z + 0.7:
        box(coll, "iron", x - 0.03, y - 0.03, x + 0.03, y + 0.03, z + 0.6, top_z if top_z is not None else z + 1.6, cell=0)


def crate_stack(x0, y0, x1, y1, z0, h, coll=YD, seed=0):
    """goods waiting in the yard: wooden crates (with a few sacks and barrels) filling a footprint to about h"""
    rnd = random.Random(seed)
    nx = max(1, round((x1 - x0) / 1.25))
    ny = max(1, round((y1 - y0) / 1.2))
    dx, dy = (x1 - x0) / nx, (y1 - y0) / ny
    for i in range(nx):
        for j in range(ny):
            ax, ay = x0 + i * dx, y0 + j * dy
            z = z0
            levels = max(1, round(h / 1.15)) - (1 if rnd.random() < 0.25 else 0)
            for lv in range(max(1, levels)):
                kind = rnd.random()
                hh = 1.05 + rnd.random() * 0.15
                if kind < 0.14 and lv == levels - 1:
                    cyl(coll, "timber", ax + dx / 2, ay + dy / 2, min(dx, dy) * 0.42, z, z + 1.0, seg=10)
                    for zz in (z + 0.15, z + 0.82):
                        cyl(coll, "iron", ax + dx / 2, ay + dy / 2, min(dx, dy) * 0.43, zz, zz + 0.05, seg=10, caps=False)
                    z += 1.0
                elif kind < 0.24 and lv == levels - 1:
                    box(coll, "sack", ax + 0.1, ay + 0.1, ax + dx - 0.1, ay + dy - 0.1, z, z + 0.55, cell=0)
                    z += 0.55
                else:
                    box(coll, "wood", ax + 0.04, ay + 0.04, ax + dx - 0.04, ay + dy - 0.04, z, z + hh, cell=0)
                    box(coll, "timber", ax + 0.02, ay + 0.02, ax + dx - 0.02, ay + dy - 0.02, z + hh * 0.45, z + hh * 0.55, cell=0)
                    z += hh


def sign(x, y, z, body, facing="s", w=None, size=0.45, board=True, post=False, coll=S, floor=None):
    """an enamel sign: cream lettering on a maroon board with a cream border (on a wall, hung, or standing on two
    iron posts with post=True)"""
    w = w or max(1.2, len(body) * size * 0.62 + 0.6)
    hgt = size * 1.7
    off = {"s": (0, 0.07), "n": (0, -0.07), "e": (0.07, 0), "w": (-0.07, 0)}[facing]
    if board:
        if facing in ("s", "n"):
            box(coll, "sign_dark", x - w / 2, y - 0.05, x + w / 2, y + 0.05, z - hgt / 2, z + hgt / 2, cell=0)
            box(coll, "cream", x - w / 2 - 0.05, y - 0.035, x + w / 2 + 0.05, y + 0.035, z - hgt / 2 - 0.05, z + hgt / 2 + 0.05, cell=0)
        else:
            box(coll, "sign_dark", x - 0.05, y - w / 2, x + 0.05, y + w / 2, z - hgt / 2, z + hgt / 2, cell=0)
            box(coll, "cream", x - 0.035, y - w / 2 - 0.05, x + 0.035, y + w / 2 + 0.05, z - hgt / 2 - 0.05, z + hgt / 2 + 0.05, cell=0)
    if post:
        zb = z - hgt / 2
        if floor is None:
            floor = Z_UG if zb < -3 else 0.0
        for o in (-(w / 2 - 0.2), w / 2 - 0.2):
            px, py = (x + o, y) if facing in ("s", "n") else (x, y + o)
            box(coll, "iron", px - 0.045, py - 0.045, px + 0.045, py + 0.045, floor, zb, cell=0)
        # a standing sign is seen from both sides: lettering on the back too (not a blank maroon board)
        back = {"s": "n", "n": "s", "e": "w", "w": "e"}[facing]
        text(coll, "sign_text", body, x - off[0], y - off[1], z, size=size, facing=back)
    text(coll, "sign_text", body, x + off[0], y + off[1], z, size=size, facing=facing)


# ======================================================================================== ground
def ground():
    """the levels: the rail lands (ballast and setts at −1.2), the city side (z 0: setts, flagstone pavements)"""
    top(G, "cobbles", 0, 1, 200, 18, Z_BED)                        # goods yard
    top(G, "cobbles", 0, 18, 30, 28, Z_BED)
    top(G, "cobbles", 186, 100, 196, 110, Z_BED)
    top(G, "ballast", 30, 100, 40, 100.6, Z_BED)
    top(G, "cobbles", 196, 1, 240, 110, Z_BED)                     # depot yard
    top(G, "ballast", 8, 28, 30, 101, Z_BED)                       # west throat
    top(G, "ballast", 190, 28, 196, 101, Z_BED)                    # east throat (to the depot)
    top(G, "cobbles", 30, 18, 36, 32, Z_BED)
    top(G, "cobbles", 186, 18, 196, 32, Z_BED)
    for (a, b) in ((41, 51), (61, 71), (81, 91)):
        top(TR, "ballast", 30, a, 190, b, Z_BED)
    for (_n, a, b) in PLATFORMS:
        top(TR, "ballast", 30, a, PX0, b, Z_BED)
        top(TR, "ballast", PX1, a, 190, b, Z_BED)
    # city side at z 0: the park (west), the forecourt + road + pavement, the cab yard (east)
    top(G, "grass", 0, 101, 40, 132, 0)
    top(G, "cobbles", 40, 126, 186, 132, 0)                        # station forecourt
    top(G, "stone", 0, 132, 240, 133.2, 0.15)                      # kerb (north)
    top(G, "cobbles", 0, 133.2, 240, 142.8, 0.0)                   # the street (setts)
    top(G, "flags", 0, 142.8, 240, 150, 0.15)                      # pavement (south)
    box(G, "stone", 0, 132, 240, 133.2, 0, 0.15, skip=("top",), cell=0)
    box(G, "stone", 0, 142.8, 240, 150, 0, 0.15, skip=("top",), cell=0)
    top(G, "cobbles", 186, 110, 240, 132, 0)                       # cab yard
    # retaining walls where the city (z 0) meets the rail lands (−1.2): stone, iron railings on top
    box(G, "stone", 0, 100.6, 40, 101, Z_BED, 0.0, cell=2.0)
    box(G, "stone", 186, 109.6, 240, 110, Z_BED, 0.0, cell=2.0)
    for (a, b) in (((8, 100.8), (40, 100.8)), ((186, 109.8), (198, 109.8)), ((203, 109.8), (240, 109.8))):
        rail(G, a, b, 0.0, 1.1)
    stairs(G, "stone", (198, 103.3, 203, 109.6), Z_BED, 0.0, "+y")


# ======================================================================================== tracks
def track(x0, x1, y, zbed=Z_BED, coll=TR):
    """timber sleepers every 0.65 m, two rails (1.435 m gauge)"""
    x = x0 + 0.3
    while x < x1 - 0.3:
        box(coll, "sleeper", x - 0.13, y - 1.3, x + 0.13, y + 1.3, zbed, zbed + 0.15, skip=("bottom",), cell=0)
        x += 0.65
    for s in (-0.75, 0.75):
        box(coll, "rail_steel", x0, y + s - 0.035, x1, y + s + 0.035, zbed + 0.15, zbed + 0.3, skip=("bottom",), cell=0)


def buffer_stop(x, y, facing, zbed=Z_BED):
    """a timber-faced buffer stop on an iron frame, its red lamp (facing +1: the train comes from −x)"""
    d = -0.6 * facing
    box(TR, "red_paint", x + d - 0.18, y - 1.4, x + d + 0.18, y + 1.4, zbed + 0.7, zbed + 1.25, cell=0)
    for s in (-0.9, 0.9):
        box(TR, "loco_black", x - 0.2, y + s - 0.15, x + 0.2, y + s + 0.15, zbed, zbed + 1.3, cell=0)
        strut(TR, "loco_black", B(x + d, y + s, zbed + 1.0), B(x - d * 2.2, y + s, zbed + 0.15), 0.07)
        cyl_x(TR, "timber", min(x, x + d), max(x, x + d), y + s, zbed + 0.95, 0.14, seg=8)
    box(TR, "iron", x + d - 0.05, y - 0.08, x + d + 0.05, y + 0.08, zbed + 1.25, zbed + 1.7, cell=0)
    disc(TR, "sig_red", B(x + d - 0.06 * facing, y, zbed + 1.55), (-facing, 0, 0), 0.08, seg=10)


def tracks():
    for name, y in TRACKS.items():
        end = {"T1": 198, "T6": 198, "T3": 234, "T4": 234}.get(name, 238)
        track(8, end, y)
        buffer_stop(end, y, 1)
    for y in SIDINGS.values():
        track(62, 196, y)
        buffer_stop(62, y, -1)
        buffer_stop(196, y, 1)


def signals():
    """semaphore signals at both ends of every platform track: a lattice post, a red arm with a white stripe,
    its spectacle (red or green lit) and a finial; a ladder up the post"""
    for name, y in TRACKS.items():
        for (x, red, d) in ((26.5, name in ("T1", "T4", "T6"), 1), (193.5, name in ("T2", "T5"), -1)):
            sy = y - 1.9 if name in ("T1", "T3", "T5") else y + 1.9
            for (ox, oy) in ((-0.1, -0.1), (0.1, -0.1), (0.1, 0.1), (-0.1, 0.1)):
                box(TR, "iron", x + ox - 0.025, sy + oy - 0.025, x + ox + 0.025, sy + oy + 0.025, Z_BED, 6.2, cell=0)
            for k in range(14):
                z = Z_BED + 0.3 + k * 0.5
                strut(TR, "iron", B(x - 0.1, sy - 0.1, z), B(x + 0.1, sy + 0.1, z + 0.5), 0.015)
            cyl(TR, "iron", x, sy, 0.06, 6.2, 6.6, seg=6)
            cyl(TR, "iron", x, sy, 0.12, 6.6, 6.75, seg=8)
            ty = y
            arm0, arm1 = sorted((sy, sy + (ty - sy) * 0.95))
            ang = 0.0 if red else 0.6
            za = 5.4
            # the arm (horizontal = danger, raised = clear), pivoted at the post
            a0 = B(x + d * 0.14, sy, za)
            a1 = B(x + d * 0.14, sy + (ty - sy) * 0.9, za + abs(ty - sy) * 0.9 * math.sin(ang))
            strut(TR, "red_paint", a0, a1, 0.12)
            m = (a0[0], a0[1] + (a1[1] - a0[1]) * 0.75, a0[2] + (a1[2] - a0[2]) * 0.75)
            strut(TR, "cream", (m[0] + d * 0.01, m[1] - 0.06 * (1 if ty > sy else -1), m[2]), (m[0] + d * 0.01, m[1] + 0.06 * (1 if ty > sy else -1), m[2]), 0.125)
            disc(TR, "sig_red" if red else "sig_green", B(x + d * 0.2, sy, za - 0.45), (d, 0, 0), 0.1, seg=10)
            box(TR, "loco_black", x + d * 0.12 - 0.08, sy - 0.18, x + d * 0.12 + 0.08, sy + 0.18, za - 0.7, za - 0.2, cell=0)


# ======================================================================================== platforms
def platforms():
    for (n, a, b) in PLATFORMS:
        holes = [sub_hole(n)]
        slab(PL, "flags", (PX0, a, PX1, b), Z_BED, 0.0, holes=holes, under="brick")
        # edges: stone coping with a white painted edge (only the track sides: P1 and P4 have a wall behind)
        edges = []
        if n != "4":
            edges.append((a, a + 0.6, a, a + 0.1))
        if n != "1":
            edges.append((b - 0.6, b, b - 0.1, b))
        for (c0, c1, t0, t1) in edges:
            top(PL, "stone", PX0, c0, PX1, c1, 0.006, cell=0)
            top(PL, "line_white", PX0, t0, PX1, t1, 0.009, cell=0)
        # ramps at both ends down to the bed (so the tracks are a route, and you can climb back up)
        prism(PL, "stone", [(31.5, a), (PX0, a), (PX0, b), (31.5, b)], Z_BED, [Z_BED, 0.0, 0.0, Z_BED])
        prism(PL, "stone", [(PX1, a), (188.5, a), (188.5, b), (PX1, b)], Z_BED, [0.0, Z_BED, Z_BED, 0.0])
        # the stair down to the subway (from x 100 at 0 to x 112 at −7): its tiled well, iron railings
        h = sub_hole(n)
        stairs(UG, "stone", h, Z_UG, 0.0, "-x")
        box(UG, "tile_glazed", h[0], h[1] - 0.3, h[2], h[1], Z_UG, Z_BED, cell=2.0)
        box(UG, "tile_glazed", h[0], h[3], h[2], h[3] + 0.3, Z_UG, Z_BED, cell=2.0)
        rail(PL, (h[0], h[1] - 0.05), (h[2], h[1] - 0.05), 0.0)
        rail(PL, (h[0], h[3] + 0.05), (h[2], h[3] + 0.05), 0.0)
        rail(PL, (h[2] + 0.05, h[1]), (h[2] + 0.05, h[3]), 0.0)
        sign(h[0] + 4.0, (a + b) / 2, 2.9, "SUBWAY  ·  UNDERGROUND", "e", size=0.3, post=True)


# ======================================================================================== the train shed
VAULTS = [(32.0, 56.0), (56.0, 76.0), (76.0, 100.0)]
VX0, VX1, VZ, VRISE = 30.0, 190.0, 12.0, 6.0


def vault_z(y, y0, y1):
    t = min(1.0, max(0.0, (y - y0) / (y1 - y0)))
    return VZ + VRISE * math.sin(math.pi * t)


def hall_roof():
    """three arched wrought-iron train sheds over the tracks: lattice-girder ribs every 10 m with plain ribs
    between, purlins and glazing bars, slate on the haunches and glass over the crown, tie rods; deep
    springing girders on the column rows; at both ends a fan-glazed gable screen over a timber valance (open
    below +8 for the trains); cast-iron columns with scrolled brackets on the islands"""
    nb = 32
    xs = [VX0 + (VX1 - VX0) * i / nb for i in range(nb + 1)]
    for (y0, y1) in VAULTS:
        ns = 12
        ys = [y0 + (y1 - y0) * j / ns for j in range(ns + 1)]
        P_ = lambda x, y, dz=0.0: B(x, y, vault_z(y, y0, y1) + dz)
        for i in range(nb):
            for j in range(ns):
                xa, xb, ya, yb = xs[i], xs[i + 1], ys[j], ys[j + 1]
                solid = j <= 2 or j >= ns - 3
                mat, coll = ("slate", H) if solid else ("roof_glass", "roof")
                quad(coll, mat, P_(xa, ya), P_(xb, ya), P_(xb, yb), P_(xa, yb), 0)
                quad(coll, "timber" if solid else mat, P_(xa, yb, -0.02 if solid else 0), P_(xb, yb, -0.02 if solid else 0), P_(xb, ya, -0.02 if solid else 0), P_(xa, ya, -0.02 if solid else 0), 0)
        # ribs: a lattice girder (two chords, zigzag web) every 10 m, a plain rib between
        sub = [y0 + (y1 - y0) * j / 24 for j in range(25)]
        for i, x in enumerate(xs):
            if i % 2 == 0:
                for j in range(24):
                    strut(H, "iron", P_(x, sub[j], -0.12), P_(x, sub[j + 1], -0.12), 0.07)
                    strut(H, "iron", P_(x, sub[j], -0.95), P_(x, sub[j + 1], -0.95), 0.07)
                    strut(H, "iron", P_(x, sub[j], -0.12 if j % 2 == 0 else -0.95), P_(x, sub[j + 1], -0.95 if j % 2 == 0 else -0.12), 0.035)
            else:
                for j in range(24):
                    strut(H, "iron", P_(x, sub[j], -0.1), P_(x, sub[j + 1], -0.1), 0.05)
        # purlins along the vault, glazing bars over the glass every 2.5 m
        for y in ys[1:-1]:
            strut(H, "iron", P_(VX0, y, -0.06), P_(VX1, y, -0.06), 0.045)
        xg = VX0 + 2.5
        while xg < VX1 - 0.1:
            if abs((xg - VX0) % 5.0) > 0.1:
                strut(H, "navy_steel", P_(xg, ys[3], -0.03), P_(xg, ys[ns - 3], -0.03), 0.02)
            xg += 2.5
        # tie rods across each shed every 10 m, with a ring at mid-span
        for x in xs[::2]:
            strut(H, "iron", B(x, y0, VZ + 0.2), B(x, y1, VZ + 0.2), 0.025)
            cyl_x(H, "iron", x - 0.04, x + 0.04, (y0 + y1) / 2, VZ + 0.2, 0.25, seg=10)
        # the gable screens: glass under the arch, radial glazing bars, a deep timber valance along the bottom
        for xe in (VX0, VX1):
            yc = (y0 + y1) / 2
            for j in range(ns):
                ya, yb = ys[j], ys[j + 1]
                za, zb = vault_z(ya, y0, y1), vault_z(yb, y0, y1)
                quad("roof", "roof_glass", B(xe, ya, 8.0), B(xe, yb, 8.0), B(xe, yb, zb), B(xe, ya, za), 0)
                quad("roof", "roof_glass", B(xe, yb, 8.0), B(xe, ya, 8.0), B(xe, ya, za), B(xe, yb, zb), 0)
            for j in range(ns + 1):
                strut(H, "navy_steel", B(xe, yc, 8.0), B(xe, ys[j], vault_z(ys[j], y0, y1)), 0.035)
            for k in range(1, 4):
                rr = k / 4
                for j in range(ns):
                    pa = (yc + (ys[j] - yc) * rr, 8.0 + (vault_z(ys[j], y0, y1) - 8.0) * rr)
                    pb = (yc + (ys[j + 1] - yc) * rr, 8.0 + (vault_z(ys[j + 1], y0, y1) - 8.0) * rr)
                    strut(H, "navy_steel", B(xe, pa[0], pa[1]), B(xe, pb[0], pb[1]), 0.025)
            for j in range(24):
                strut(H, "iron", B(xe, sub[j], vault_z(sub[j], y0, y1) - 0.1), B(xe, sub[j + 1], vault_z(sub[j + 1], y0, y1) - 0.1), 0.12)
            box(H, "iron", xe - 0.15, y0, xe + 0.15, y1, 7.85, 8.15, cell=0)
            # the valance: vertical boards with pointed ends (a saw-tooth edge) hung under the screen
            yv = y0 + 0.2
            while yv < y1 - 0.2:
                X = xe - 64.0
                for sgn in (1, -1):
                    face(H, "timber", [(X + sgn * 0.08, 48 - yv, 7.85), (X + sgn * 0.08, 48 - (yv + 0.3), 7.85),
                                       (X + sgn * 0.08, 48 - (yv + 0.3), 7.1), (X + sgn * 0.08, 48 - (yv + 0.15), 6.85)], (sgn, 0, 0))
                    face(H, "timber", [(X + sgn * 0.08, 48 - yv, 7.85), (X + sgn * 0.08, 48 - (yv + 0.15), 6.85), (X + sgn * 0.08, 48 - yv, 7.1)], (sgn, 0, 0))
                yv += 0.3
    # springing girders on the two column rows and along both side walls: plate girders with a moulded top
    for y in (32.0, 56.0, 76.0, 100.0):
        box(H, "iron", VX0, y - 0.3, VX1, y + 0.3, VZ - 1.1, VZ - 0.1, cell=0)
        box(H, "iron", VX0, y - 0.42, VX1, y + 0.42, VZ - 0.1, VZ + 0.05, cell=0)
        box(H, "iron", VX0, y - 0.36, VX1, y + 0.36, VZ - 1.22, VZ - 1.1, cell=0)
    # the columns on the island platforms (P2: y 76, P3: y 56), scrolled brackets under the girder
    for y in (56.0, 76.0):
        for x in range(40, 184, 16):
            if any(b0 - 2 < x < b1 + 13 for (b0, b1) in BRIDGES) or SUB_STAIR[0] - 2 < x < SUB_STAIR[1] + 2:
                continue
            iron_column(H, x, y, 0.3, 0.0, VZ - 1.22, brackets=((1, 0), (-1, 0)))
            lantern(x + 0.55, y, 4.6, drop=0.5, coll=P, post=True)
            box(P, "iron", x + 0.3, y - 0.02, x + 0.6, y + 0.02, 4.55, 4.6, cell=0)


# ======================================================================================== station building (south)
FACADE_Y, FACADE_T = 126.0, 0.5
ENTRANCES = [(94, 102), (106, 114), (118, 126)]


def facade():
    """the south front: red brick on a stone plinth, two storeys of arched sash windows, pilasters, a stone
    string course, cornice and parapet; three arched entrances with fanlights and their doors folded back;
    the name in cast letters on a stone frieze; stone quoins at the corners"""
    y, t = FACADE_Y, FACADE_T
    x0, x1 = 40.0, 186.0
    wins = [43 + 6 * k for k in range(9)] + [129 + 6 * k for k in range(10)]
    hw = 1.1
    # the plinth (stone, 0–1 m) everywhere but the entrances
    cur = x0
    for (d0, d1) in ENTRANCES + [(x1, x1)]:
        if d0 > cur:
            box(BL, "stone", cur, y - t / 2 - 0.1, d0, y + t / 2 + 0.1, 0.0, 1.0, cell=2.0)
        cur = d1
    # the wings: piers between the windows, the window columns
    edges = [x0]
    for c in wins:
        edges += [c - hw, c + hw]
    edges.append(x1)
    spans = [(edges[i], edges[i + 1]) for i in range(0, len(edges), 2)]
    for (a, b) in spans:
        segs = [(a, b)]
        if a < 94 < b:
            segs = [(a, 94), (102, 106), (114, 118), (126, b)]
        for (sa, sb) in segs:
            if sb - sa > 0.01:
                box(BL, "brick", sa, y - t / 2, sb, y + t / 2, 1.0, 12.5, cell=2.0)
                if sb - sa > 1.5 and not (94 <= sa and sb <= 126):
                    m = (sa + sb) / 2
                    box(BL, "brick", m - 0.45, y + t / 2, m + 0.45, y + t / 2 + 0.16, 1.0, 12.5, cell=2.0)
                    box(BL, "stone", m - 0.55, y + t / 2, m + 0.55, y + t / 2 + 0.22, 1.0, 1.6, cell=0)
    for c in wins:
        s0, s1 = c - hw, c + hw
        arched_window(BL, True, y, s0, s1, 1.0, 4.0, 6.4, t)
        box(BL, "brick", s0, y - t / 2, s1, y + t / 2, 6.4, 8.0, cell=2.0)
        arched_window(BL, True, y, s0, s1, 8.0, 10.2, 11.9, t)
        box(BL, "brick", s0, y - t / 2, s1, y + t / 2, 11.9, 12.5, cell=2.0)
    # the entrances: an arch over each (r 4, springing at 4.2), fanlight, the doors folded back inside
    for (d0, d1) in ENTRANCES:
        arch_head(BL, "brick", True, y, d0, d1, 4.2, 12.5, t, fan="roof_glass", seg=16)
        for (dx0, dx1) in ((d0 - 2.0, d0), (d1, d1 + 2.0)):
            box(BL, "panel", dx0, y - t / 2 - 0.12, dx1, y - t / 2 - 0.02, 0.0, 4.2, cell=0)
            for zz in (0.3, 2.2):
                box(BL, "panel", dx0 + 0.12, y - t / 2 - 0.15, dx1 - 0.12, y - t / 2 - 0.12, zz, zz + 1.6, cell=0)
        box(BL, "stone", d0 - 0.3, y - t / 2 - 0.12, d0, y + t / 2 + 0.12, 0.0, 4.4, cell=0)
        box(BL, "stone", d1, y - t / 2 - 0.12, d1 + 0.3, y + t / 2 + 0.12, 0.0, 4.4, cell=0)
    # string course, cornice, parapet with stone coping (the parapet stops at the tower)
    for (a, b) in ((x0, 94), (126, x1)):
        box(BL, "stone", a, y - t / 2 - 0.02, b, y + t / 2 + 0.12, 6.6, 7.0, cell=2.0)
    box(BL, "stone", x0 - 0.3, y - t / 2 - 0.05, x1 + 0.3, y + t / 2 + 0.35, 12.5, 12.95, cell=2.0)
    for (a, b) in ((x0 - 0.2, TOWER[0]), (TOWER[2], x1 + 0.2)):
        box(BL, "brick", a, y - t / 2, b, y + t / 2, 12.95, 13.7, cell=2.0)
        box(BL, "stone", a, y - t / 2 - 0.06, b, y + t / 2 + 0.06, 13.7, 13.86, cell=2.0)
    # the frieze over the entrances, cast-iron letters
    box(BL, "stone", 93, y + t / 2, 127, y + t / 2 + 0.08, 9.4, 11.6, cell=2.0)
    text(S, "iron", "PORT CALDER CENTRAL", 110, y + t / 2 + 0.1, 10.5, size=1.25, facing="s")
    text(S, "iron", "GREAT CALDER RAILWAY  ·  MDCCCLXXIV", 110, y + t / 2 + 0.1, 9.75, size=0.32, facing="s")
    # quoins at the corners (on both end walls' ends too)
    for (xq, sgn) in ((x0, 1), (x1, -1)):
        for k in range(14):
            z = 1.0 + k * 0.82
            w = 0.9 if k % 2 == 0 else 0.55
            xa, xb = sorted((xq - sgn * 0.08, xq + sgn * w))
            box(BL, "stone", xa, y - t / 2 - 0.04, xb, y + t / 2 + 0.06, z, z + 0.7, cell=0)


def clock_tower():
    """the landmark: a brick tower on the roof over the middle entrance — stone bands, tall arched louvres, a
    four-faced clock stage, a cornice and a slated pyramid roof with an iron finial (about 38 m)"""
    x0, y0, x1, y1 = TOWER
    cx, cy = (x0 + x1) / 2, (y0 + y1) / 2
    z0 = 12.5
    box(BL, "brick", x0, y0, x1, y1, z0, 26.0, cell=2.0)
    for z in (13.86, 19.0, 26.0):
        box(BL, "stone", x0 - 0.15, y0 - 0.15, x1 + 0.15, y1 + 0.15, z - 0.35, z, cell=0)
    for (xa, xb) in ((x0 - 0.06, x0 + 0.7), (x1 - 0.7, x1 + 0.06)):
        for (ya, yb) in ((y0 - 0.06, y0 + 0.7), (y1 - 0.7, y1 + 0.06)):
            for k in range(14):
                z = z0 + 1.4 + k * 0.84
                box(BL, "stone", xa, ya, xb, yb, z, z + 0.7, cell=0)
    # tall arched louvres (dark) on each face, 19.6–25 m
    for (horiz, fixed, s0, s1, side) in ((True, y1 + 0.01, cx - 1.1, cx + 1.1, 1), (True, y0 - 0.01, cx - 1.1, cx + 1.1, -1),
                                          (False, x1 + 0.01, cy - 1.1, cy + 1.1, 1), (False, x0 - 0.01, cy - 1.1, cy + 1.1, -1)):
        want = _wn(horiz, side)
        face(BL, "window_dark", [_wp(horiz, fixed, s0, 19.6, 0), _wp(horiz, fixed, s1, 19.6, 0), _wp(horiz, fixed, s1, 24.0, 0), _wp(horiz, fixed, s0, 24.0, 0)], want)
        for k in range(10):
            a0, a1 = math.pi * k / 10, math.pi * (k + 1) / 10
            face(BL, "window_dark", [_wp(horiz, fixed, cx if horiz else cy, 24.0, 0), _wp(horiz, fixed, (cx if horiz else cy) + 1.1 * math.cos(a0), 24.0 + 1.1 * math.sin(a0), 0),
                                     _wp(horiz, fixed, (cx if horiz else cy) + 1.1 * math.cos(a1), 24.0 + 1.1 * math.sin(a1), 0)], want)
        for k in range(9):
            z = 19.9 + k * 0.45
            face(BL, "timber", [_wp(horiz, fixed, s0, z, side * 0.02), _wp(horiz, fixed, s1, z, side * 0.02), _wp(horiz, fixed, s1, z + 0.12, side * 0.08), _wp(horiz, fixed, s0, z + 0.12, side * 0.08)], want)
    # the clock stage (26–30.6): a stone block a little wider, a clock on each face
    box(BL, "stone", x0 - 0.3, y0 - 0.3, x1 + 0.3, y1 + 0.3, 26.0, 30.6, cell=2.0)
    zc = 28.3
    for (n, c) in (((0, -1, 0), B(cx, y1 + 0.3, zc)), ((0, 1, 0), B(cx, y0 - 0.3, zc)), ((1, 0, 0), B(x1 + 0.3, cy, zc)), ((-1, 0, 0), B(x0 - 0.3, cy, zc))):
        disc(BL, "iron", tuple(Vector(c) + Vector(n) * 0.02), n, 1.95, seg=28)
        disc(BL, "clock_face", tuple(Vector(c) + Vector(n) * 0.05), n, 1.75, seg=28)
        u = Vector(n).cross(Vector((0, 0, 1))).normalized()
        C = Vector(c) + Vector(n) * 0.08
        for k in range(12):
            a = 2 * math.pi * k / 12
            p = C + u * (1.5 * math.cos(a)) + Vector((0, 0, 1.5 * math.sin(a)))
            disc(BL, "iron", tuple(p), n, 0.07 if k % 3 else 0.12, seg=6)
        for (ln, a, w) in ((1.35, 1.25, 0.05), (0.95, -0.35, 0.08)):
            e = C + u * (ln * math.cos(a)) + Vector((0, 0, ln * math.sin(a)))
            strut(BL, "iron", tuple(C), tuple(e), w)
    box(BL, "stone", x0 - 0.55, y0 - 0.55, x1 + 0.55, y1 + 0.55, 30.6, 31.1, cell=0)
    # the pyramid roof, slated, and the finial
    a, b = 0.45, 37.0
    corners = [B(x0 - a, y0 - a, 31.1), B(x1 + a, y0 - a, 31.1), B(x1 + a, y1 + a, 31.1), B(x0 - a, y1 + a, 31.1)]
    apex = B(cx, cy, b)
    for i in range(4):
        p, q = corners[i], corners[(i + 1) % 4]
        out = ((p[0] + q[0]) / 2 - apex[0], (p[1] + q[1]) / 2 - apex[1], 0.6)
        face(BL, "slate", [p, q, apex], out)
    cyl(BL, "iron", cx, cy, 0.09, b - 0.3, b + 2.2, seg=8)
    cyl(BL, "brass", cx, cy, 0.26, b + 0.5, b + 0.95, seg=10)
    strut(BL, "iron", B(cx - 0.9, cy, b + 1.7), B(cx + 0.9, cy, b + 1.7), 0.04)


def station():
    z1, zr = Z_UP, 12.0
    bx0, by0, bx1, by1 = 40, 100, 186, 126
    # ground floor: encaustic tiles, the underground stair hole; the plinth's faces down to the rail lands
    L.rims(BL, "stone", bx0, by0, bx1, by1, Z_BED, 0.0)
    for r in L.cut((bx0, by0, bx1, by1), [METRO_STAIR, (140, 109.4, 151.7, 111.4)]):
        top(BL, "encaustic", *r, 0.0)
    # the gallery floor (+7) round the atrium: boards, a plaster soffit
    slab(UP, "boards", (bx0, by0, bx1, by1), z1 - 0.4, z1, holes=[LOBBY_HOLE, (44, 104, 46.4, 115.7), (180, 104, 182.4, 115.7)], under="plaster")
    rail(UP, (LOBBY_HOLE[0], LOBBY_HOLE[1]), (LOBBY_HOLE[2], LOBBY_HOLE[1]), z1)
    rail(UP, (LOBBY_HOLE[0], LOBBY_HOLE[3]), (87, LOBBY_HOLE[3]), z1)
    rail(UP, (89, LOBBY_HOLE[3]), (131, LOBBY_HOLE[3]), z1)
    rail(UP, (133, LOBBY_HOLE[3]), (LOBBY_HOLE[2], LOBBY_HOLE[3]), z1)
    rail(UP, (LOBBY_HOLE[0], LOBBY_HOLE[1]), (LOBBY_HOLE[0], LOBBY_HOLE[3]), z1)
    rail(UP, (LOBBY_HOLE[2], LOBBY_HOLE[1]), (LOBBY_HOLE[2], LOBBY_HOLE[3]), z1)
    # the gallery's edge over the train shed: an iron balustrade, the bridges join it at x 72–78 / 142–148
    rail(UP, (bx0, 100.25), (BRIDGES[0][0], 100.25), z1)
    rail(UP, (BRIDGES[0][1], 100.25), (BRIDGES[1][0], 100.25), z1)
    rail(UP, (152.2, 100.25), (bx1, 100.25), z1)
    # the roof (+12, slate over a plaster ceiling) and the atrium's iron-and-glass lantern (+14.5)
    slab(BL, "slate", (bx0, by0, bx1, by1), zr, zr + 0.5, holes=[LANTERN], under="plaster")
    lx0, ly0, lx1, ly1 = LANTERN
    for (a, b, c, d) in ((lx0, ly0, lx1, ly0 + 0.4), (lx0, ly1 - 0.4, lx1, ly1), (lx0, ly0, lx0 + 0.4, ly1), (lx1 - 0.4, ly0, lx1, ly1)):
        box(BL, "iron", a, b, c, d, zr, 14.5)
    for k in range(0, 13):
        x = lx0 + k * 4
        box(BL, "iron", x - 0.12, ly0, x + 0.12, ly1, 14.3, 14.6, cell=0)
        strut(BL, "iron", B(x, ly0 + 0.4, 12.6), B(x, (ly0 + ly1) / 2, 14.3), 0.05)
        strut(BL, "iron", B(x, ly1 - 0.4, 12.6), B(x, (ly0 + ly1) / 2, 14.3), 0.05)
    for y in range(int(ly0) + 2, int(ly1), 2):
        box(BL, "navy_steel", lx0, y - 0.03, lx1, y + 0.03, 14.42, 14.5, cell=0)
    quad("roof", "roof_glass", B(lx0 + 0.4, ly0 + 0.4, 14.5), B(lx1 - 0.4, ly0 + 0.4, 14.5), B(lx1 - 0.4, ly1 - 0.4, 14.5), B(lx0 + 0.4, ly1 - 0.4, 14.5), 0)
    quad("roof", "roof_glass", B(lx0 + 0.4, ly1 - 0.4, 14.5), B(lx1 - 0.4, ly1 - 0.4, 14.5), B(lx1 - 0.4, ly0 + 0.4, 14.5), B(lx0 + 0.4, ly0 + 0.4, 14.5), 0)
    # north wall (to platform 1): brick, solid to +7 with the three ticket-barrier openings under stone lintels
    gates = [(g0, g1, 4.2) for (g0, g1) in GATES]
    wall(BL, "brick", (bx0, by0), (bx1, by0), 0.0, z1 - 0.4, 0.4, doors=gates)
    for (g0, g1) in GATES:
        box(BL, "stone", g0 - 0.4, by0 - 0.26, g1 + 0.4, by0 + 0.26, 4.2, 4.75, cell=0)
    # the booking hall's dado: dark panelling on the inside of the north wall
    cur = bx0 + 0.4
    for (g0, g1) in GATES + [(bx1 - 0.4, bx1)]:
        if g0 > cur:
            box(BL, "panel", cur, by0 + 0.2, g0, by0 + 0.27, 0.0, 1.4, cell=2.0)
            box(BL, "panel", cur, by0 + 0.2, g0, by0 + 0.31, 1.4, 1.5, cell=0)
        cur = g1
    facade()
    clock_tower()
    # the entrance canopy: an iron-and-glass porte-cochère on cast-iron columns, a timber valance
    quad("roof", "roof_glass", B(84, 126.3, 6.4), B(136, 126.3, 6.4), B(136, 131, 6.0), B(84, 131, 6.0), 0)
    quad("roof", "roof_glass", B(84, 131, 6.0), B(136, 131, 6.0), B(136, 126.3, 6.4), B(84, 126.3, 6.4), 0)
    for x in range(84, 137, 4):
        strut(BL, "iron", B(x, 126.3, 6.45), B(x, 131, 6.05), 0.06)
    box(BL, "iron", 84, 130.8, 136, 131.2, 5.7, 6.05, cell=0)
    xv = 84.0
    while xv < 136:
        face(BL, "timber", [B(xv, 131.25, 5.75), B(xv + 0.3, 131.25, 5.75), B(xv + 0.3, 131.25, 5.35), B(xv + 0.15, 131.25, 5.15)], (0, -1, 0))
        face(BL, "timber", [B(xv, 131.25, 5.75), B(xv + 0.15, 131.25, 5.15), B(xv, 131.25, 5.35)], (0, -1, 0))
        xv += 0.3
    for x in (86, 100, 110, 120, 134):
        iron_column(BL, x, 130.5, 0.17, 0.0, 5.7, brackets=((0, -1),))
    # end walls with doors to the park (west) and the cab yard (east)
    wall(BL, "brick", (bx0, by0), (bx0, by1), 0.0, zr + 0.5, 0.4, doors=[(112, 116, 3.0)])
    wall(BL, "brick", (bx1, by0), (bx1, by1), 0.0, zr + 0.5, 0.4, doors=[(118, 122, 3.0)])
    for (xe, d) in ((bx0, -1), (bx1, 1)):
        for yw in (104.0, 110.0, 122.0):
            blind_window(BL, False, xe + d * 0.2, d, yw - 1.0, yw + 1.0, 8.0, 10.2, glazing="window_dark")
        for yw in (104.0, 108.0, 124.0) if d < 0 else (104.0, 110.0, 114.0):
            if not (111.5 < yw < 116.5 if d < 0 else 117.5 < yw < 122.5):
                blind_window(BL, False, xe + d * 0.2, d, yw - 0.9, yw + 0.9, 1.0, 4.0, glazing="window_dark")
        box(BL, "stone", xe - 0.3, 100, xe + 0.3, 126, 0.0, 1.0, cell=2.0)
        box(BL, "stone", xe - 0.32, 100, xe + 0.32, 126, 6.6, 7.0, cell=2.0)
    # columns in the booking hall: cast iron on a 12 m grid outside the atrium, stone round the atrium
    for x in range(52, 184, 12):
        for y in (106.0, 120.0):
            if LOBBY_HOLE[0] - 1 < x < LOBBY_HOLE[2] + 1:
                continue
            iron_column(BL, x, y, 0.26, 0.0, z1 - 0.4)
            iron_column(UP, x, y, 0.24, z1, zr)
    for x in (LOBBY_HOLE[0] - 0.5, LOBBY_HOLE[2] + 0.5):
        for y in (104.0, 113.0, 122.0):
            stone_column(BL, x, y, 0.45, 0.0, zr)
    # the grand stairs in the atrium (+7 at the south end), stair cores at both ends
    for x0 in (87.0, 131.0):
        stairs(BL, "stone", (x0, 110.0, x0 + 2.0, 122.0), 0.0, z1, "+y", sides=True, side_mat="panel")
    stairs(BL, "stone", (44, 104, 46.4, 115.7), 0.0, z1, "+y", sides=True, side_mat="panel")
    stairs(BL, "stone", (180, 104, 182.4, 115.7), 0.0, z1, "+y", sides=True, side_mat="panel")
    lobby_fittings()
    gallery_fittings()


def bench_row(x0, x1, y, z=0.0):
    """a wooden slatted bench with cast-iron ends (y … y + 0.7), its clip block (nobody stands on the seats)"""
    box("clip", "clip", x0 - 0.02, y, x1 + 0.02, y + 0.7, z, z + 1.25, cell=0)
    for k in range(4):
        box(P, "wood", x0, y + 0.06 + k * 0.12, x1, y + 0.16 + k * 0.12, z + 0.42, z + 0.46, cell=0)
    for k in range(3):
        box(P, "wood", x0, y + 0.6, x1, y + 0.66, z + 0.58 + k * 0.15, z + 0.7 + k * 0.15, cell=0)
    k = max(2, int((x1 - x0) / 1.8) + 1)
    for i in range(k):
        xa = x0 + 0.08 + i * (x1 - x0 - 0.16) / (k - 1)
        box(P, "iron", xa - 0.03, y + 0.05, xa + 0.03, y + 0.1, z, z + 0.46, cell=0)
        box(P, "iron", xa - 0.03, y + 0.55, xa + 0.03, y + 0.62, z, z + 1.05, cell=0)
        box(P, "iron", xa - 0.03, y + 0.05, xa + 0.03, y + 0.62, z + 0.36, z + 0.42, cell=0)
        strut(P, "iron", B(xa, y + 0.1, z + 0.42), B(xa, y + 0.0, z + 0.62), 0.025)


def lobby_fittings():
    # the booking office (west): a mahogany counter with a timber screen, an arched window with a brass grille
    # at each position, a cornice across the top, the panelled back wall
    for k in range(5):
        x = 52 + k * 4.4
        box(P, "panel", x, 112, x + 3.6, 113, 0, 1.1)
        box(P, "stone", x - 0.05, 111.95, x + 3.65, 113.05, 1.1, 1.15)
        c = x + 1.8
        w0, w1 = c - 0.6, c + 0.6
        box(P, "panel", x - 0.05, 112.45, w0, 112.55, 1.15, 3.0, cell=0)
        box(P, "panel", w1, 112.45, x + 3.65, 112.55, 1.15, 3.0, cell=0)
        arch_head(P, "panel", True, 112.5, w0, w1, 2.2, 3.0, 0.1, ring="brass", seg=8)
        for g in range(9):
            gx = w0 + 0.06 + g * (w1 - w0 - 0.12) / 8
            box(P, "brass", gx - 0.008, 112.49, gx + 0.008, 112.51, 1.15, 2.2, cell=0)
        box(P, "brass", w0, 112.47, w1, 112.53, 1.5, 1.53, cell=0)
        box(P, "panel", x - 0.15, 112.35, x + 3.75, 112.65, 3.0, 3.25, cell=0)
    box(BL, "panel", 50, 116.5, 61, 117, 0, 5.5)
    box(BL, "panel", 63.6, 116.5, 74, 117, 0, 5.5)
    box(BL, "panel", 61, 116.5, 63.6, 117, 3.0, 5.5)                 # a doorway through to the chemist's
    sign(62, 116.4, 4.4, "BOOKING OFFICE", "n", size=0.55)
    # the left-luggage office: a counter with trunks and cases waiting on it and behind it
    box(P, "panel", 76, 116, 84, 116.8, 0, 1.1)
    box(P, "stone", 75.95, 115.95, 84.05, 116.85, 1.1, 1.15)
    for (xa, xb, za, zb, m) in ((76.4, 77.6, 1.15, 1.75, "timber"), (77.8, 78.6, 1.15, 1.5, "maroon"), (79.2, 80.8, 1.15, 1.8, "luggage"), (81.2, 82.2, 1.15, 1.55, "timber"), (82.6, 83.6, 1.15, 1.7, "sack")):
        box(P, m, xa, 116.1, xb, 116.7, za, zb, cell=0)
    sign(80, 116.0, 2.6, "LEFT LUGGAGE", "n", size=0.3)
    # the enquiry office in the atrium (mahogany, a brass rail), the flap departure board hung over it
    box(P, "panel", 105, 112, 115, 113.4, 0, 1.05)
    box(P, "stone", 104.8, 111.9, 115.2, 113.5, 1.05, 1.12)
    box(P, "brass", 104.8, 111.86, 115.2, 111.9, 0.25, 0.3, cell=0)
    sign(110, 112.7, 1.42, "ENQUIRIES", "n", size=0.3)
    sign(110, 112.7, 1.42, "ENQUIRIES", "s", size=0.3, board=False)
    box(S, "panel", 97.8, 104.4, 122.2, 104.8, 3.9, 6.75, cell=0)
    box(S, "loco_black", 98.3, 104.35, 121.7, 104.4, 4.1, 6.0, cell=0)
    text(S, "sign_text", "DEPARTURES", 110, 104.32, 6.3, size=0.4, facing="n")
    rows = ["09.40   NORTHAM  ·  ELM CROSS          1", "09.55   CALDER BAY  ·  THE COAST        2",
            "10.10   HARROWGATE  ·  ST AUBYN        3", "10.25   KINGSFORD  ·  THE NORTH        4"]
    rows2 = ["10.40   PORT ROYAL  ·  DOCKS           1", "10.55   ASHBY  ·  LOWER WICK          2",
             "11.05   MARLOW HEATH                  3", "11.20   BRANDON  ·  FENWAY          4"]
    for i, (r1, r2) in enumerate(zip(rows, rows2)):
        z = 5.6 - i * 0.43
        text(S, "sign_text", r1, 104.0, 104.32, z, size=0.2, facing="n")
        text(S, "sign_text", r2, 116.0, 104.32, z, size=0.2, facing="n")
        box(S, "iron", 98.4, 104.33, 121.6, 104.35, z - 0.215, z - 0.2, cell=0)
    for x in (100.0, 120.0):
        box(S, "iron", x - 0.02, 104.58, x + 0.02, 104.62, 6.75, 12.0, cell=0)
    # waiting hall: wooden benches
    for y in (115.0, 118.0):
        for (x0, x1) in ((92, 103), (117, 128)):
            bench_row(x0, x1, y)
    # the ticket barriers between the hall and platform 1: a collector's booth per lane, iron railings
    for (d0, d1) in GATES:
        for lane in range(2):
            lx = d0 + 1.2 + lane * 3.6
            box(P, "panel", lx - 1.0, 102.0, lx + 0.6, 104.2, 0, 1.1)
            box(P, "panel", lx - 1.0, 102.0, lx - 0.85, 104.2, 1.1, 2.3, cell=0)
            box(P, "panel", lx + 0.45, 102.0, lx + 0.6, 104.2, 1.1, 2.3, cell=0)
            box(P, "window_dark", lx - 0.85, 102.05, lx + 0.45, 104.15, 1.6, 2.2, cell=0)
            box(P, "panel", lx - 1.1, 101.9, lx + 0.7, 104.3, 2.3, 2.5)
            box(P, "stone", lx - 1.05, 101.95, lx + 0.65, 104.25, 1.1, 1.16, cell=0)
            # the barrier's swing gate posts and arch
            for s in (-0.05, 1.2):
                box(P, "iron", lx + 0.8 + s, 101.7, lx + 0.95 + s, 102.0, 0, 2.2, cell=0)
            box(P, "iron", lx + 0.8, 101.7, lx + 2.15, 102.0, 2.05, 2.2, cell=0)
            cyl(P, "brass", lx + 0.875, 101.85, 0.06, 2.2, 2.32, seg=6)
            cyl(P, "brass", lx + 2.075, 101.85, 0.06, 2.2, 2.32, seg=6)
        rail(P, (d0 - 2, 104.85), (d0, 104.85), 0.0)
        rail(P, (d1, 104.85), (d1 + 2, 104.85), 0.0)
        sign((d0 + d1) / 2, 100.45, 5.4, "TO THE TRAINS", "s", size=0.45)
    # shops: the west block (newsagent, chemist) and the refreshment rooms in the east
    shops = [(40.4, "NEWSAGENT"), (52.4, "CHEMIST")]
    for (x, name) in shops:
        wall(BL, "plaster", (x + 12, 117.5), (x + 12, 125.7), 0, 6.6, 0.2)
        box(BL, "panel", x, 117.4, x + 12, 117.6, 4.0, 6.6)
        sign(x + 6, 117.35, 4.8, name, "n", size=0.42)
        for k in range(3):
            box(P, "wood", x + 1 + k * 3.6, 121.5, x + 3.6 + k * 3.6, 125.2, 0, 1.9)
        box(P, "panel", x + 2, 118.5, x + 8, 119.4, 0, 1.0)
        box(P, "stone", x + 1.95, 118.45, x + 8.05, 119.45, 1.0, 1.05, cell=0)
    for k in range(4):
        x = 152 + k * 8
        box(P, "panel", x, 121, x + 6, 122.2, 0, 1.05)
        box(P, "stone", x - 0.05, 120.95, x + 6.05, 122.25, 1.05, 1.1)
        box(BL, "plaster", x - 0.2, 124, x + 6.2, 125.7, 0, 3.4)
        box(BL, "panel", x - 0.2, 123.9, x + 6.2, 124.0, 0, 1.2, cell=0)
        sign(x + 3, 123.9, 2.8, ["TEA ROOM", "BUFFET", "BAKER", "TOBACCONIST"][k], "n", size=0.34, board=True)
    for (x, y) in ((154, 110), (160, 110), (166, 110), (172, 110), (154, 115), (166, 115), (172, 115)):
        cyl(P, "stone", x + 0.8, y + 0.8, 0.75, 0.72, 0.78, seg=14)
        cyl(P, "iron", x + 0.8, y + 0.8, 0.05, 0, 0.72, seg=6, caps=False)
        box(P, "iron", x + 0.5, y + 0.5, x + 1.1, y + 1.1, 0, 0.04, cell=0)
        for (dx, dy) in ((-0.6, 0.8), (2.2, 0.8)):
            box(P, "wood", x + dx, y + dy - 0.22, x + dx + 0.44, y + dy + 0.22, 0.42, 0.47, cell=0)
            for (cx_, cy_) in ((0.04, -0.18), (0.4, -0.18), (0.04, 0.18), (0.4, 0.18)):
                box(P, "wood", x + dx + cx_ - 0.02, y + dy + cy_ - 0.02, x + dx + cx_ + 0.02, y + dy + cy_ + 0.02, 0, 0.42, cell=0)
            bx_ = x + dx + (0.44 if dx < 0 else 0.0)
            box(P, "wood", bx_ - 0.03, y + dy - 0.2, bx_ + 0.03, y + dy + 0.2, 0.47, 0.95, cell=0)
    # the stair down to the underground: tiled well walls, iron railings, its sign
    stairs(BL, "stone", METRO_STAIR, Z_UG, 0.0, "-x")
    stairs(BL, "stone", (140, 109.4, 151.7, 111.4), Z_UG, 0.0, "-x", sides=True, side_mat="panel")
    for y in (METRO_STAIR[1] - 0.3, 111.4):
        box(UG, "tile_glazed", 140, y, 152, y + 0.3, -2.4, 0.0, cell=0)
    box(UG, "tile_glazed", 151.7, 105.7, 152.0, 111.7, -2.4, 0.0, cell=0)
    rail(BL, (140, 105.95), (151.7, 105.95), 0.0)
    rail(BL, (140, 111.45), (151.7, 111.45), 0.0)
    # (the stairs climb west: their heads at x 140 are the way in from the hall, the drop is at the east end)
    rail(BL, (151.75, 106), (151.75, 111.4), 0.0)
    sign(146, 105.9, 2.6, "UNDERGROUND", "n", size=0.42, post=True)


def gallery_fittings():
    z = Z_UP
    # the south gallery: shopfronts along the back, benches at the balustrade, the stationmaster's offices west
    for (x, name) in ((64, "BOOKSTALL"), (73, "TELEGRAPH"), (140, "POST OFFICE"), (147.5, "HATTER"), (155, "TAILOR"), (162.5, "FIRST CLASS")):
        box(UP, "plaster", x, 122, x + 6.5, 125.7, z, z + 3.6)
        box(UP, "panel", x, 121.9, x + 6.5, 122.0, z, z + 1.0, cell=0)
        box(UP, "panel", x, 121.85, x + 6.5, 122.0, z + 2.8, z + 3.6, cell=0)
        sign(x + 3.25, 121.8, z + 3.2, name, "n", size=0.3, board=False)
    for (x0, x1) in ((56, 70), (82, 86), (136, 140), (150, 164)):
        bench_row(x0, x1, 102.0, z)
    wall(UP, "plaster", (40.2, 117), (60, 117), z, z + 3.6, 0.2, doors=[(50, 52, 2.4)])
    wall(UP, "plaster", (60, 117), (60, 125.8), z, z + 3.6, 0.2, doors=[(120, 122, 2.4)])
    box(P, "panel", 46, 120, 52, 121, z, z + 0.76)
    box(P, "panel", 46, 123.5, 52, 124.5, z, z + 0.76)
    sign(50, 116.85, z + 2.9, "STATIONMASTER", "n", size=0.3)


# ======================================================================================== north building
def north_building():
    z1, zr = Z_UP, 11.5
    x0, y0, x1, y1 = 36, 18, 186, 32
    hole = (114, 21.3, 118, 32)                       # the subway's emergency stair comes up here
    L.rims(NB, "stone", x0, y0, x1, y1, Z_BED, 0.0)
    for r in L.cut((x0, y0, x1, y1), [hole]):
        top(NB, "flags", *r, 0.0)
    slab(NB, "boards", (x0, y0, x1, y1), z1 - 0.4, z1, holes=[(37, 19.3, 39.4, 31), (182.6, 19.3, 185, 31)], under="plaster")
    slab(NB, "slate", (x0, y0, x1, y1), zr, zr + 0.4, under="plaster")
    # walls: the brick north front (to the goods yard) with doors and windows under stone lintels, the
    # platform side open in wide bays at ground level, the gallery open to the train shed above
    wall(NB, "brick", (x0, y0), (x1, y0), Z_BED, zr, 0.4, doors=[(48, 51, 3.8), (98, 101, 3.8), (158, 161, 3.8)])
    for (a, b) in ((60, 92), (122, 152)):
        glass_wall(NB, True, y0 - 0.25, a, b, z1 + 0.6, z1 + 3.4, 2.0, 2.8, frame="sash")
        for k in range(int((b - a) / 2)):
            box(NB, "stone", a + k * 2 + 0.1, y0 - 0.32, a + k * 2 + 1.9, y0 - 0.18, z1 + 3.4, z1 + 3.75, cell=0)
        box(NB, "stone", a - 0.1, y0 - 0.36, b + 0.1, y0 - 0.18, z1 + 0.45, z1 + 0.6, cell=0)
    for (d0, d1) in ((48, 51), (98, 101), (158, 161)):
        box(NB, "stone", d0 - 0.3, y0 - 0.28, d1 + 0.3, y0 + 0.28, Z_BED + 3.8, Z_BED + 4.3, cell=0)
    box(NB, "stone", x0 - 0.1, y0 - 0.3, x1 + 0.1, y0 + 0.1, zr - 0.3, zr + 0.1, cell=2.0)
    wall(NB, "brick", (x0, y1), (x1, y1), 0.0, z1 - 0.4, 0.4, doors=[(46, 58, 3.6), (86, 98, 3.6), (130, 142, 3.6), (166, 178, 3.6)])
    for (d0, d1) in ((46, 58), (86, 98), (130, 142), (166, 178)):
        box(NB, "iron", d0, y1 - 0.25, d1, y1 + 0.25, 3.6, 4.0, cell=0)
    wall(NB, "brick", (x0, y0), (x0, y1), Z_BED, zr, 0.4)
    wall(NB, "brick", (x1, y0), (x1, y1), Z_BED, zr, 0.4)
    rail(NB, (x0, 31.75), (BRIDGES[0][0], 31.75), z1)
    rail(NB, (BRIDGES[0][1], 31.75), (BRIDGES[1][0], 31.75), z1)
    rail(NB, (152.2, 31.75), (x1, 31.75), z1)
    # ground floor rooms off a corridor (y 26–32): staff, lockers, police, the SIGNAL CONTROL room, stores
    rooms = [(40, 60, "STAFF"), (60, 80, "LOCKERS"), (80, 100, "POLICE"), (100, 112, "BOILERS"), (120, 146, "CONTROL ROOM"), (146, 166, "STORES"), (166, 182, "MESS")]
    wall(NB, "plaster", (40, 26), (182, 26), 0.0, z1 - 0.4, 0.2, doors=[(a + 2, a + 4, 2.4) for (a, _b, _n) in rooms] + [(112.2, 119.8, 6.0)])
    dado = [(a + 2, a + 4) for (a, _b, _n) in rooms] + [(112.2, 119.8)]
    cur = 40.0
    for (d0, d1) in sorted(dado):
        box(NB, "panel", cur, 25.85, d0, 25.9, 0, 1.2, cell=2.0)
        cur = d1
    box(NB, "panel", cur, 25.85, 182, 25.9, 0, 1.2, cell=2.0)
    for (a, b, name) in rooms:
        if b < x1:
            wall(NB, "plaster", (b, 18.2), (b, 26), 0.0, z1 - 0.4, 0.2)
        sign(a + 3, 26.15, 2.9, name, "s", size=0.26, board=True)
    wall(NB, "plaster", (112, 18.2), (112, 26), 0.0, z1 - 0.4, 0.2)
    wall(NB, "plaster", (120, 18.2), (120, 26), 0.0, z1 - 0.4, 0.2)
    # the control room: lever frames facing the big illuminated track diagram
    box(P, "panel", 121, 18.3, 145, 18.6, 1.0, 5.0)
    box(P, "screen", 121.3, 18.6, 144.7, 18.65, 1.3, 4.7, cell=0)
    for k in range(9):
        box(P, "loco_black", 122 + k * 2.6, 18.66, 122.08 + k * 2.6 + 1.6, 18.68, 2.1 + (k % 3) * 0.7, 2.14 + (k % 3) * 0.7, cell=0)
    text(P, "sign_text", "PORT CALDER CENTRAL  —  SIGNALLING", 133, 18.7, 4.35, size=0.3, facing="s")
    lever = ["red_paint", "red_paint", "loco_black", "navy_steel", "red_paint", "brass", "loco_black", "red_paint"]
    for row in range(2):
        for k in range(4):
            cx = 123 + k * 5.6
            cy = 21.5 + row * 2.6
            box(P, "panel", cx, cy, cx + 4.2, cy + 0.9, 0, 0.85)
            box(P, "brass", cx - 0.02, cy - 0.02, cx + 4.22, cy + 0.92, 0.85, 0.88, cell=0)
            for m in range(12):
                lx = cx + 0.3 + m * 0.32
                pulled = m % 4 == 1
                strut(P, lever[m % 8], B(lx, cy + 0.45, 0.88), B(lx, cy + (0.2 if pulled else 0.4), 1.45), 0.014)
                box(P, "grey_steel", lx - 0.03, cy + (0.17 if pulled else 0.37), lx + 0.03, cy + (0.23 if pulled else 0.43), 1.42, 1.5, cell=0)
    # lockers, the police desk, store racks, mess tables
    for k in range(12):
        box(P, "panel", 61 + k * 1.5, 18.3, 62.3 + k * 1.5, 18.9, 0, 2.0)
        box(P, "brass", 62.1 + k * 1.5, 18.91, 62.18 + k * 1.5, 18.93, 1.0, 1.1, cell=0)
    box(P, "panel", 84, 21, 92, 22, 0, 1.0)
    for y in (20.0, 23.0):
        rack(148, y, 164, y + 1.0, 3.2)
    for k in range(3):
        box(P, "wood", 168 + k * 4.5, 21, 171 + k * 4.5, 23, 0.72, 0.78)
        for (ox, oy) in ((0.1, 0.1), (2.8, 0.1), (0.1, 1.8), (2.8, 1.8)):
            box(P, "wood", 168 + k * 4.5 + ox, 21 + oy, 168 + k * 4.5 + ox + 0.1, 21 + oy + 0.1, 0, 0.72, cell=0)
    for k in range(4):
        box(P, "grey_steel", 101 + k * 2.6, 18.3, 103 + k * 2.6, 19.0, 0, 2.2)
    stairs(NB, "stone", (37, 19.3, 39.4, 31), 0.0, z1, "+y", sides=True, side_mat="panel")
    stairs(NB, "stone", (182.6, 19.3, 185, 31), 0.0, z1, "+y", sides=True, side_mat="panel")
    wall(NB, "plaster", (40, 26), (182, 26), z1, z1 + 3.6, 0.2, doors=[(x, x + 2, 2.4) for x in range(46, 180, 16)])
    for x in range(54, 182, 16):
        wall(NB, "plaster", (x, 18.2), (x, 26), z1, z1 + 3.6, 0.2)
    for x in range(44, 180, 16):
        box(P, "panel", x, 20, x + 5, 21, z1, z1 + 0.76)
    for (x0_, x1_) in ((50, 66), (90, 136), (154, 172)):
        bench_row(x0_, x1_, 29.5, z1)
    for (d0, d1, _h) in ((48, 51, 0), (98, 101, 0), (158, 161, 0)):
        stairs(YD, "stone", (d0, 15.6, d1, 17.8), Z_BED, 0.0, "+y")
    sign(133, 17.75, 4.2, "SIGNAL CONTROL", "n", size=0.45)


# ======================================================================================== footbridges
def lattice_side(coll, horiz, fixed, s0, s1, z, h_plate=1.1, h_top=2.7, pitch=1.0):
    """a lattice-girder side: a solid iron plate to h_plate (cover for a crouching player), a diamond lattice
    above it to h_top (it stops players, not bullets), top and bottom booms"""
    if horiz:
        box(coll, "iron", s0, fixed - 0.05, s1, fixed + 0.05, z, z + h_plate, cell=2.0)
        box(coll, "iron", s0, fixed - 0.12, s1, fixed + 0.12, z + h_top, z + h_top + 0.18, cell=0)
        box(coll, "iron", s0, fixed - 0.1, s1, fixed + 0.1, z + h_plate, z + h_plate + 0.1, cell=0)
    else:
        box(coll, "iron", fixed - 0.05, s0, fixed + 0.05, s1, z, z + h_plate, cell=2.0)
        box(coll, "iron", fixed - 0.12, s0, fixed + 0.12, s1, z + h_top, z + h_top + 0.18, cell=0)
        box(coll, "iron", fixed - 0.1, s0, fixed + 0.1, s1, z + h_plate, z + h_plate + 0.1, cell=0)
    n = max(1, round((s1 - s0) / pitch))
    za, zb = z + h_plate + 0.1, z + h_top
    for i in range(n):
        a, b = s0 + (s1 - s0) * i / n, s0 + (s1 - s0) * (i + 1) / n
        strut(SO, "iron", _wp(horiz, fixed, a, za, 0), _wp(horiz, fixed, b, zb, 0), 0.03)
        strut(SO, "iron", _wp(horiz, fixed, a, zb, 0), _wp(horiz, fixed, b, za, 0), 0.03)
        if i % 4 == 0:
            box(SO, "iron", *((a - 0.05, fixed - 0.06, a + 0.05, fixed + 0.06) if horiz else (fixed - 0.06, a - 0.05, fixed + 0.06, a + 0.05)), za, zb, cell=0)
    if horiz:
        box("clip", "clip", s0, fixed - 0.06, s1, fixed + 0.06, za, z + 3.2, cell=0)
    else:
        box("clip", "clip", fixed - 0.06, s0, fixed + 0.06, s1, za, z + 3.2, cell=0)


def footbridges():
    """two lattice-girder footbridges at +7: timber decks, iron sides (plate below, lattice above), a pitched
    slate roof on iron posts, lanterns; stairs down to the island platforms; stairs from balconies off the
    galleries down to platforms 1 and 4"""
    z = Z_UP
    for (x0, x1) in BRIDGES:
        y0, y1 = 32.0, 100.0
        box(UP, "iron", x0, y0, x1, y1, z - 0.6, z - 0.08)
        top(UP, "boards", x0, y0, x1, y1, z)
        box(UP, "boards", x0, y0, x1, y1, z - 0.08, z, skip=("top", "bottom"), cell=0)
        stair_ys = [(plat_centre(n) - 1.25, plat_centre(n) + 1.25) for n in ("2", "3")]
        lattice_side(UP, False, x0, y0, y1, z)
        east, cur = [], y0
        for (a, b) in stair_ys:
            east.append((cur, a))
            cur = b
        east.append((cur, y1))
        for (a, b) in east:
            lattice_side(UP, False, x1, a, b, z)
        for (a, b) in stair_ys:
            box(UP, "iron", x1 - 0.1, a, x1 + 0.1, b, z + 2.7, z + 3.2, cell=0)
            stairs(UP, "iron", (x1, a, x1 + 11.7, b), 0.0, z, "-x", sides=True, side_mat="iron")
        # the roof: iron posts, a pitched slate roof with a ridge, a timber valance at the eaves
        for y in range(int(y0), int(y1) + 1, 4):
            for xe in (x0 + 0.05, x1 - 0.05):
                box(UP, "iron", xe - 0.07, y - 0.07, xe + 0.07, y + 0.07, z + 2.88, z + 3.3, cell=0)
            strut(UP, "iron", B(x0, y, z + 3.3), B((x0 + x1) / 2, y, z + 4.3), 0.05)
            strut(UP, "iron", B(x1, y, z + 3.3), B((x0 + x1) / 2, y, z + 4.3), 0.05)
        xm = (x0 + x1) / 2
        for (xa, xb) in ((x0 - 0.4, xm), (x1 + 0.4, xm)):
            za_, zb_ = z + 3.15, z + 4.35
            pa, pb, pc, pd = B(xa, y0, za_), B(xa, y1, za_), B(xb, y1, zb_), B(xb, y0, zb_)
            nrm = (xa - xm, 0.0, 1.5)
            face(UP, "slate", [pa, pb, pc, pd], nrm, cell=2.0)
            face(UP, "timber", [(q[0], q[1], q[2] - 0.04) for q in (pa, pb, pc, pd)], (-nrm[0], 0.0, -1.5), cell=2.0)
        box(UP, "iron", xm - 0.1, y0, xm + 0.1, y1, z + 4.3, z + 4.45, cell=0)
        for xe in (x0 - 0.4, x1 + 0.4):
            box(UP, "timber", xe - 0.03, y0, xe + 0.03, y1, z + 2.85, z + 3.15, cell=0)
        for yv in (y0, y1):
            face(UP, "timber", [B(x0 - 0.4, yv, z + 3.15), B(xm, yv, z + 4.35), B(x1 + 0.4, yv, z + 3.15)], (0, 1 if yv == y0 else -1, 0))
        # piers on the island platforms
        for n in ("2", "3"):
            iron_column(UP, xm, plat_centre(n), 0.32, 0.0, z - 0.6, capital=True)
        for y in range(36, 100, 6):
            lantern(xm, y, z + 3.3, drop=0.7, coll=P)
    # stairs from the galleries down to platforms 1 and 4 (beside the east bridge), each from a balcony
    for (by0, by1, ey0, ey1, edge) in ((96.5, 100.0, 97.0, 99.4, 96.5), (32.0, 35.5, 32.6, 35.0, 35.5)):
        box(UP, "iron", 148, by0, 152.2, by1, z - 0.5, z - 0.08)
        top(UP, "boards", 148, by0, 152.2, by1, z)
        box(UP, "boards", 148, by0, 152.2, by1, z - 0.08, z, skip=("top", "bottom"), cell=0)
        rail(UP, (148, edge), (152.2, edge), z)
        for (a, b) in ((by0, ey0), (ey1, by1)):
            if b - a > 0.05:
                rail(UP, (152.25, a), (152.25, b), z)
        stairs(PL, "iron", (152.2, ey0, 163.9, ey1), 0.0, z, "-x", sides=True, side_mat="iron")


# ======================================================================================== underground
def underground():
    """the subway under the platforms and the underground railway's station: Victorian glazed tiles (cream,
    a dark green band), flagstone floors, cast-iron columns, brick plant rooms, globe lamps"""
    z0, zc = Z_UG, -3.0
    sx0, sx1 = SUB
    top(UG, "flags", sx0, 33, sx1, 104, z0)
    top(UG, "plaster", sx0, 33, sx1, 104, zc, down=True)
    west_doors = [(plat_centre(n) - 1.5, plat_centre(n) + 1.5, 4.0) for (n, _a, _b) in PLATFORMS]
    wall(UG, "tile_glazed", (sx0, 33), (sx0, 104), z0, zc, 0.3, doors=west_doors)
    rooms = [(60, 72, "ELECTRICAL"), (80, 92, "VENTILATION")]
    wall(UG, "tile_glazed", (sx1, 33), (sx1, 104), z0, zc, 0.3, doors=[(a + 4, a + 6.4, 2.4) for (a, _b, _n) in rooms])
    wall(UG, "tile_glazed", (sx0, 33), (sx1, 33), z0, zc, 0.3, doors=[(114, 118, 4.0)])
    for y in range(38, 104, 12):
        cyl(UG, "iron", 116.0, y, 0.2, z0, zc, seg=12, caps=False)
        box(UG, "iron", 115.7, y - 0.3, 116.3, y + 0.3, zc - 0.25, zc, cell=0)
    for y in range(36, 104, 5):
        lantern(116.0, y + 2.5 if (y - 38) % 12 == 0 else y, zc, drop=0.55, coll=UG)
    box(UG, "grey_steel", sx1 - 0.6, 33.5, sx1 - 0.3, 103.5, zc - 0.5, zc - 0.4, cell=0)
    for (n, _a, _b) in PLATFORMS:
        sign(sx0 + 0.25, plat_centre(n), z0 + 3.1, f"PLATFORM {n}", "e", size=0.34)
    for (a, b, name) in rooms:
        top(UG, "flags", sx1, a, 134, b, z0)
        top(UG, "plaster", sx1, a, 134, b, zc, down=True)
        wall(UG, "brick_dark", (sx1, a), (134, a), z0, zc, 0.3)
        wall(UG, "brick_dark", (sx1, b), (134, b), z0, zc, 0.3)
        wall(UG, "brick_dark", (134, a), (134, b), z0, zc, 0.3)
        sign(sx1 + 0.25, a + 7.6, z0 + 2.8, name, "w", size=0.26)
        lantern(127, (a + b) / 2, zc, drop=0.5, coll=UG)
    for k in range(5):
        box(P, "grey_steel", 122 + k * 2.3, 60.3, 124 + k * 2.3, 61.0, z0, z0 + 2.3)
    box(P, "iron", 127, 65, 131, 68, z0, z0 + 2.0)
    for (cx, cy) in ((125, 86), (130.5, 86)):
        cyl(P, "iron", cx, cy, 1.5, z0 + 0.4, z0 + 3.0, seg=14)
        box(P, "loco_black", cx - 1.6, cy - 1.6, cx + 1.6, cy + 1.6, z0, z0 + 0.4)
    box(P, "metal_sheet", 121, 81, 133.5, 82.2, zc - 0.9, zc - 0.05)
    # the emergency stair up into the north building
    stairs(UG, "stone", (114, 21.3, 118, 33), z0, 0.0, "-y", sides=True, side_mat="iron")
    for x in (113.7, 118.0):
        box(UG, "tile_glazed", x, 21.3, x + 0.3, 33, z0, 0.0, cell=2.0)
    box(UG, "tile_glazed", 114, 21.0, 118, 21.3, z0, 0.0, cell=0)
    # railings along the well, open over its top 1.3 m (the steps there are within 0.8 m of the floor): you step
    # off the head of the stair sideways onto the floor beside it (it used to be railed in on three sides — a
    # dead end nobody could leave)
    rail(NB, (113.95, 22.6), (113.95, 31.8), 0.0)
    rail(NB, (118.05, 22.6), (118.05, 31.8), 0.0)
    # ---- the underground railway under the booking hall: platform (north), the trench, the tunnel mouths
    mx0, my0, mx1, my1 = METRO
    ptop = 116.5
    zc2 = -2.4
    top(UG, "flags", 62, my0, 168, ptop, z0)
    top(UG, "stone", 62, ptop - 0.5, 168, ptop, z0 + 0.004, cell=0)
    top(UG, "line_white", 62, ptop - 0.1, 168, ptop, z0 + 0.007, cell=0)
    box(UG, "brick_dark", 62, ptop, 168, ptop + 0.02, z0 - 1.2, z0, skip=("top",), cell=2.0)
    top(UG, "ballast", 52, ptop, 178, my1, z0 - 1.2)
    track(52, 178, 119.0, zbed=z0 - 1.2, coll=UG)
    # steps out of the track trench at both platform ends (the platform is 1.2 m up — too high to climb):
    # whoever jumps down onto the line can walk back up, and soldiers use the line as a route too
    for (tx0, tx1) in ((62.2, 65.2), (164.8, 167.8)):
        stairs(UG, "stone", (tx0, ptop, tx1, my1 - 0.2), z0 - 1.2, z0, "-y")    # (open sides: walk on from the line)
    for r in L.cut((mx0, my0, mx1, my1), [METRO_STAIR, (140, 109.4, 151.7, 111.4)]):
        top(UG, "plaster", *r, zc2, down=True)
    wall(UG, "tile_glazed", (mx0, my0), (mx1, my0), z0, zc2, 0.4, doors=[(sx0, sx1, 4.0)])
    wall(UG, "tile_glazed", (mx0, my1), (mx1, my1), z0 - 1.2, zc2, 0.4)
    wall(UG, "tile_glazed", (62, my0), (62, ptop), z0, zc2, 0.4)
    wall(UG, "tile_glazed", (168, my0), (168, ptop), z0, zc2, 0.4)
    for xe, d in ((mx0, -1), (mx1, 1)):
        xa, xb = sorted((xe, xe + d * 8))
        wa, wb = (xa, 62.0) if d < 0 else (168.0, xb)
        box(UG, "brick_dark", wa, ptop - 0.3, wb, ptop, z0 - 1.2, zc2, cell=2.0)
        box(UG, "brick_dark", xa, my1, xb, my1 + 0.3, z0 - 1.2, zc2, cell=2.0)
        top(UG, "brick_dark", xa, ptop, xb, my1, zc2, down=True)
        xh = xe + d * 7.6
        box(UG, "timber", xh - 0.15, ptop, xh + 0.15, my1, z0 - 1.2, zc2, cell=1.0)
        text(S, "sign_text", "TUNNEL CLOSED", xh - d * 0.2, (ptop + my1) / 2, z0 + 0.6, size=0.32, facing="e" if d < 0 else "w")
        box(UG, "concrete", xa, ptop, xb, my1, zc2, zc2 + 0.01, cell=0)
    for x in range(70, 168, 11):
        if 137 < x < 154:
            continue
        iron_column(UG, x, 110.5, 0.22, z0, zc2, capital=True)
    for x in range(66, 166, 6):
        if not (137 < x < 154):
            lantern(x, 113.0, zc2, drop=0.5, coll=UG)
        lantern(x, 107.0, zc2, drop=0.5, coll=UG)
    for (x0_, x1_) in ((70, 82), (96, 108), (124, 136), (154, 166)):
        bench_row(x0_, x1_, 104.6, z0)
    for x in (88.0, 158.0):
        sign(x, 104.45, z0 + 3.4, "UNDERGROUND  ·  CITY LINE", "s", size=0.34)
    box(UG, "metal_sheet", 64, 114.0, 166, 115.2, zc2 - 0.8, zc2 - 0.01)
    box(UG, "grey_steel", 64, 120.6, 166, 121.0, zc2 - 0.4, zc2 - 0.3, cell=0)


# ======================================================================================== goods yard + depot
def rack(x0, y, x1, y1, h=4.0, coll=None):
    """timber storage racks with crates, sacks and barrels on the shelves"""
    coll = coll or P
    zb = 0 if h < 3.5 else Z_BED
    for x in (x0, (x0 + x1) / 2, x1 - 0.12):
        box(coll, "timber", x - 0.03, y - 0.03, x + 0.15, y1 + 0.03, zb, zb + h, cell=1.0)
    for z in (0.15, 1.45, 2.75)[: (2 if h < 3.5 else 3)]:
        box(coll, "timber", x0 + 0.02, y + 0.02, x1 - 0.02, y1 - 0.02, zb + z, zb + z + 0.1)
        rnd = random.Random(int(y * 10 + z * 3 + x0))
        x = x0 + 0.2
        while x < x1 - 1.2:
            w = 0.9 + rnd.random() * 0.4
            k = rnd.random()
            if k < 0.25:
                cyl(coll, "timber", x + w / 2, (y + y1) / 2, min(w, y1 - y) * 0.42, zb + z + 0.1, zb + z + 0.95, seg=10)
            else:
                box(coll, "wood" if k < 0.7 else "sack", x, y + 0.08, x + w, y1 - 0.08, zb + z + 0.1, zb + z + 0.6 + rnd.random() * 0.6)
            x += w + 0.25


def goods_shed_roof(coll, x0, y0, x1, y1, z, ridge=1.6, under="timber"):
    """a pitched slate roof along x (ridge at mid-y), its gables and a timber soffit"""
    ym = (y0 + y1) / 2
    for (ya, sgn) in ((y0, 1), (y1, -1)):
        pa, pb, pc, pd = B(x0, ya, z), B(x1, ya, z), B(x1, ym, z + ridge), B(x0, ym, z + ridge)
        face(coll, "slate", [pa, pb, pc, pd], (0, sgn * 1.0, 1.5), cell=2.0)
        face(coll, under, [(q[0], q[1], q[2] - 0.04) for q in (pa, pb, pc, pd)], (0, -sgn * 1.0, -1.5), cell=2.0)
    box(coll, "iron", x0, ym - 0.1, x1, ym + 0.1, z + ridge - 0.05, z + ridge + 0.12, cell=0)


def goods_yard():
    # the warehouse (west end of the goods yard): a brick goods shed with dock doors and racks inside
    wx0, wy0, wx1, wy1 = 32, 2, 58, 16
    top(YD, "flags", wx0, wy0, wx1, wy1, Z_BED + 0.01)
    wall(YD, "brick_dark", (wx0, wy0), (wx1, wy0), Z_BED, 9.0, 0.3)
    wall(YD, "brick_dark", (wx0, wy1), (wx1, wy1), Z_BED, 9.0, 0.3, doors=[(36, 41, 4.5), (48, 53, 4.5)])
    wall(YD, "brick_dark", (wx0, wy0), (wx0, wy1), Z_BED, 9.0, 0.3)
    wall(YD, "brick_dark", (wx1, wy0), (wx1, wy1), Z_BED, 9.0, 0.3, doors=[(7, 11, 4.5)])
    for (d0, d1) in ((36, 41), (48, 53)):
        arch_head(YD, "brick_dark", True, wy1, d0, d1, Z_BED + 4.5, Z_BED + 7.4, 0.3, seg=10)
        box(YD, "timber", d0 - 2.6, wy1 + 0.15, d0 - 0.1, wy1 + 0.25, Z_BED, Z_BED + 4.5, cell=0)
    box(YD, "brick_dark", wx0, wy0, wx1, wy1, 9.0, 9.2, skip=("top",))
    goods_shed_roof(YD, wx0 - 0.3, wy0 - 0.3, wx1 + 0.3, wy1 + 0.3, 9.2, ridge=3.0)
    for (xe, sg) in ((wx0 - 0.3, -1), (wx1 + 0.3, 1)):
        face(YD, "brick_dark", [B(xe, wy0 - 0.3, 9.2), B(xe, (wy0 + wy1) / 2, 12.2), B(xe, wy1 + 0.3, 9.2)], (sg, 0, 0))
    for xw in range(35, 58, 5):
        blind_window(YD, True, wy0 - 0.15, -1, xw - 0.8, xw + 0.8, Z_BED + 3.2, Z_BED + 6.0)
    for y in (4.5, 8.0, 11.5):
        rack(35, y, 55, y + 1.0, 4.0, coll=YD)
    for x in range(36, 58, 7):
        for y in (5.0, 12.0):
            lantern(x, y + 1.6, 9.0, drop=1.2, coll=P)
    sign(44.5, 16.2, 6.8, "GOODS SHED  2", "s", size=0.55)
    # the goods shed: a timber-roofed canopy on iron columns over siding S2, a loading dock beside it
    for x in range(130, 172, 8):
        for y in (9.6, 16.4):
            iron_column(YD, x, y, 0.15, Z_BED, 7.0, capital=False)
    box(YD, "iron", 128, 9.4, 172, 9.8, 6.6, 7.0, cell=0)
    box(YD, "iron", 128, 16.2, 172, 16.6, 6.6, 7.0, cell=0)
    goods_shed_roof(YD, 128, 9.0, 172, 17.0, 7.0, ridge=1.8)
    box(YD, "brick_dark", 130, 15.2, 170, 17.6, Z_BED, -0.1)
    box(YD, "stone", 129.9, 15.1, 170.1, 17.7, -0.1, 0.0)
    # goods in the yard (in the containers' old footprints: the same cover)
    for k, (x, y) in enumerate(((176, 1.6), (182.5, 1.6), (189, 1.6))):
        crate_stack(x, y, x + 6.1, y + 2.44, Z_BED, 5.1 if k < 2 else 2.5, seed=k)
    crate_stack(66, 15.2, 78.2, 17.64, Z_BED, 2.5, seed=7)
    box(YD, "canvas", 66.2, 15.3, 78.0, 17.5, Z_BED + 2.45, Z_BED + 2.6, cell=0)
    # yard lamps
    for x in (70, 120, 170):
        gas_lamp(x, 3, Z_BED, h=6.0, coll=YD)


def depot():
    # the engine shed over T3 / T4: dark brick, two arched entrances, a slated roof with a glazed strip and
    # smoke vents along the ridge, inspection walkways inside
    x0, x1, y0, y1 = 200, 236, 56, 76
    for (a, b) in ((y0, y0), (y1, y1)):
        wall(YD, "brick_dark", (x0, a), (x1, b), Z_BED, 9.0, 0.3, doors=[(214, 218, 3.6)])
    for (yw, sd) in ((y0 - 0.15, -1), (y1 + 0.15, 1)):
        for xw in range(203, 236, 6):
            if 213 < xw < 219:
                continue
            blind_window(YD, True, yw, sd, xw - 0.9, xw + 0.9, Z_BED + 3.0, Z_BED + 6.0)
    wall(YD, "brick_dark", (x1, y0), (x1, y1), Z_BED, 9.0, 0.3)
    # the entrance (west, x 200): two arches over the tracks, a pier between them
    arch_head(YD, "brick_dark", False, x0, y0 + 0.15, 66.0, 4.0, 9.0, 0.3, seg=14)
    arch_head(YD, "brick_dark", False, x0, 66.0, y1 - 0.15, 4.0, 9.0, 0.3, seg=14)
    box(YD, "brick_dark", x0 - 0.15, 65.75, x0 + 0.15, 66.25, 3.4, 4.0, cell=0)
    box(YD, "stone", x0 - 0.3, y0, x0 + 0.3, y1, 9.0, 9.3, cell=0)
    goods_shed_roof(YD, x0 - 0.3, y0 - 0.3, x1 + 0.3, y1 + 0.3, 9.0, ridge=3.2, under="iron")
    for (xe, sg) in ((x0 - 0.3, -1), (x1 + 0.3, 1)):
        face(YD, "brick_dark", [B(xe, y0 - 0.3, 9.0), B(xe, (y0 + y1) / 2, 12.2), B(xe, y1 + 0.3, 9.0)], (sg, 0, 0))
    for x in range(203, 236, 4):
        box(YD, "loco_black", x - 0.5, 65.4, x + 0.5, 66.6, 12.2, 13.3, cell=0)
        box(YD, "loco_black", x - 0.7, 65.2, x + 0.7, 66.8, 13.3, 13.45, cell=0)
    for (a, b) in ((57, 60.6), (71.4, 75)):
        box(YD, "metal_plate", x0 + 2, a, x1 - 2, b, Z_BED, 0.0)
        stairs(YD, "metal_plate", (x0 + 0.2, a, x0 + 2, b), Z_BED, 0.0, "+x")
    for x in range(204, 236, 6):
        iron_column(YD, x, 56.5, 0.18, Z_BED, 8.0, capital=False)
        iron_column(YD, x, 75.5, 0.18, Z_BED, 8.0, capital=False)
    box(YD, "iron", x0, 56.3, x1, 56.7, 8.0, 8.5, cell=0)
    box(YD, "iron", x0, 75.3, x1, 75.7, 8.0, 8.5, cell=0)
    box(YD, "loco_black", 218, 56.5, 219, 75.5, 7.6, 8.0, cell=0)            # the overhead crane's bridge
    sign(218, 55.7, 7.6, "ENGINE SHED  No. 3", "n", size=0.55)
    for x in range(204, 236, 8):
        lantern(x, 61.3, 9.0, drop=1.2, coll=P)
        lantern(x, 70.7, 9.0, drop=1.2, coll=P)
    # the workshops: a brick hall with lathes, benches, tool chests
    wx0, wy0, wx1, wy1 = 200, 88, 236, 108
    top(YD, "flags", wx0, wy0, wx1, wy1, Z_BED + 0.01)
    wall(YD, "brick_dark", (wx0, wy0), (wx1, wy0), Z_BED, 8.0, 0.3, doors=[(206, 211, 4.2), (224, 229, 4.2)])
    wall(YD, "brick_dark", (wx0, wy1), (wx1, wy1), Z_BED, 8.0, 0.3)
    wall(YD, "brick_dark", (wx0, wy0), (wx0, wy1), Z_BED, 8.0, 0.3, doors=[(96, 100, 3.8)])
    wall(YD, "brick_dark", (wx1, wy0), (wx1, wy1), Z_BED, 8.0, 0.3)
    for (d0, d1) in ((206, 211), (224, 229)):
        arch_head(YD, "brick_dark", True, wy0, d0, d1, Z_BED + 4.2, Z_BED + 7.0, 0.3, seg=10)
    for xw in (203.5, 215, 220, 232.5):
        blind_window(YD, True, wy0 - 0.15, -1, xw - 0.9, xw + 0.9, Z_BED + 2.6, Z_BED + 5.4)
    goods_shed_roof(YD, wx0 - 0.3, wy0 - 0.3, wx1 + 0.3, wy1 + 0.3, 8.0, ridge=3.0, under="iron")
    for (xe, sg) in ((wx0 - 0.3, -1), (wx1 + 0.3, 1)):
        face(YD, "brick_dark", [B(xe, wy0 - 0.3, 8.0), B(xe, (wy0 + wy1) / 2, 11.0), B(xe, wy1 + 0.3, 8.0)], (sg, 0, 0))
    for k in range(4):
        x = 204 + k * 8
        box(P, "iron", x, 94, x + 2.4, 96.2, Z_BED, Z_BED + 0.4)
        box(P, "iron", x + 0.2, 94.3, x + 2.2, 95.9, Z_BED + 0.4, Z_BED + 1.0)
        cyl_x(P, "grey_steel", x + 0.3, x + 2.1, 95.1, Z_BED + 1.25, 0.12, seg=8)
        box(P, "loco_black", x + 0.9, 95.0, x + 1.5, 95.6, Z_BED + 1.0, Z_BED + 1.6)
    for k in range(5):
        box(P, "wood", 203 + k * 6.5, 106.6, 207.5 + k * 6.5, 107.6, Z_BED, Z_BED + 0.95)
        box(P, "red_paint", 203 + k * 6.5, 101, 204.4 + k * 6.5, 101.8, Z_BED, Z_BED + 1.1)
    rack(210, 90, 228, 91, 4.0, coll=YD)
    for x in range(204, 236, 8):
        lantern(x, 98.9, 8.0, drop=1.0, coll=P)
    sign(217.5, 87.7, 5.5, "WORKSHOPS", "n", size=0.5)
    # the service yard: stacked crates, a pile of sleepers, a coal stage
    for k, (x, y, along) in enumerate(((204, 22, True), (204, 25, True), (226, 22, False), (230, 22, False), (212, 40, True))):
        ln = 6.1 if k != 4 else 12.2
        xa, ya, xb, yb = (x, y, x + ln, y + 2.44) if along else (x, y, x + 2.44, y + ln)
        if k == 4:
            for lv in range(9):
                for j in range(8):
                    box(YD, "sleeper", xa + (lv % 2) * 0.15, ya + j * 0.3 + 0.02, xb - (lv % 2) * 0.15, ya + j * 0.3 + 0.28, Z_BED + lv * 0.28, Z_BED + lv * 0.28 + 0.26, cell=0)
        elif k in (2, 3):
            prism(YD, "coal", [(xa, ya), (xb, ya), (xb, yb), (xa, yb)], Z_BED, [Z_BED + 1.2, Z_BED + 1.2, Z_BED + 2.6, Z_BED + 2.6], cell=1.0)
            box(YD, "timber", xa - 0.1, ya - 0.1, xb + 0.1, yb + 0.1, Z_BED, Z_BED + 1.3, skip=("top",), cell=0)
        else:
            crate_stack(xa, ya, xb, yb, Z_BED, 2.5 if k else 5.1, seed=20 + k)
    sign(220, 18.5, 2.0, "AUTHORISED PERSONS ONLY", "s", size=0.32, post=True, floor=Z_BED)   # the yard is at −1.2


# ======================================================================================== the road bridge (west)
def road_bridge():
    """a brick road bridge over the throat at +7 (x 14–22) on brick piers: stone-coped parapets, lamp
    standards; stairs from the park (south) and the goods yard (north). The tunnel portal behind it: stone,
    three arched mouths, boarded up."""
    z = Z_UP
    box(BD, "brick", 14, 26, 22, 104, z - 0.9, z)
    box(BD, "stone", 13.9, 26, 22.1, 104, z - 0.9, z - 0.7, skip=("top", "bottom"), cell=0)
    top(G, "cobbles", 14.4, 26, 21.6, 104, z + 0.01)
    for x in (14, 21.6):
        box(G, "brick", x, 26, x + 0.4, 104, z, z + 1.1)
        box(G, "stone", x - 0.05, 26, x + 0.45, 104, z + 1.1, z + 1.25, cell=0)
    for y in (36.0, 56.0, 66.0, 76.0, 86.0, 96.0, 46.0):
        box(G, "brick", 15.5, y - 0.6, 20.5, y + 0.6, Z_BED, z - 0.9)
        box(G, "stone", 15.4, y - 0.7, 20.6, y + 0.7, z - 1.3, z - 0.9, cell=0)
    for y in range(32, 104, 16):
        gas_lamp(14.2, y, z + 1.25, h=3.6, coll=G)
    stairs(G, "stone", (16, 104, 20, 115.7), 0.0, z, "-y", sides=True, side_mat="iron")
    stairs(G, "stone", (16, 14.3, 20, 26), Z_BED, z, "+y", sides=True, side_mat="iron")
    for (ya, yb) in ((103.6, 104.0), (26.0, 26.4)):
        box(G, "brick", 14.4, ya, 16, yb, z, z + 1.1, cell=0)
        box(G, "brick", 20, ya, 21.6, yb, z, z + 1.1, cell=0)
    # the tunnel portal at x 2–8: a stone face, an arched mouth over each pair of tracks, boarded up
    box(BD, "stone", 2, 28, 8, 104, Z_BED, 11.0)
    box(BD, "stone", 7.8, 27.5, 8.4, 104.5, 10.4, 11.4, cell=0)
    for (a, b) in ((40.5, 51.5), (60.5, 71.5), (80.5, 91.5)):
        box(G, "brick_dark", 8, a - 0.5, 9.5, a, Z_BED, 9.0, cell=2.0)
        box(G, "brick_dark", 8, b, 9.5, b + 0.5, Z_BED, 9.0, cell=2.0)
        box(G, "timber", 8.0, a, 8.3, b, Z_BED, 4.3, cell=1.0)
        c, r = (a + b) / 2, (b - a) / 2
        for k in range(14):
            a0, a1 = math.pi * k / 14, math.pi * (k + 1) / 14
            face(G, "window_dark", [B(8.31, c, 4.3), B(8.31, c + r * math.cos(a0), 4.3 + r * math.sin(a0)), B(8.31, c + r * math.cos(a1), 4.3 + r * math.sin(a1))], (1, 0, 0))
            pa = [(c + rr * math.cos(ag), 4.3 + rr * math.sin(ag)) for (rr, ag) in ((r, a0), (r, a1), (r + 0.6, a1), (r + 0.6, a0))]
            face(G, "stone", [B(8.34, p[0], p[1]) for p in pa], (1, 0, 0))
        box(G, "stone", 8.3, a - 0.6, 8.36, a, Z_BED, 4.3, cell=0)
        box(G, "stone", 8.3, b, 8.36, b + 0.6, Z_BED, 4.3, cell=0)
        text(S, "sign_text", "NO ENTRY  ·  TRACK WORKS", 8.35, (a + b) / 2, Z_BED + 1.8, size=0.34, facing="e")
    sign(18, 103.8, z + 2.2, "CALDER WAY", "s", size=0.4, board=True, post=True, floor=z)    # on posts on the deck


# ======================================================================================== trains
def bogie(x, y, zr, coll=TN):
    """a two-axle bogie centred at x on the track at y (zr: rail head): spoked-look wheels, leaf springs"""
    box(coll, "loco_black", x - 1.4, y - 1.0, x + 1.4, y + 1.0, zr + 0.45, zr + 0.7, cell=0)
    for dx in (-0.9, 0.9):
        cyl_y(coll, "loco_black", x + dx, y - 0.8, y - 0.68, zr + 0.45, 0.45, seg=12)
        cyl_y(coll, "loco_black", x + dx, y + 0.68, y + 0.8, zr + 0.45, 0.45, seg=12)
        cyl_y(coll, "grey_steel", x + dx, y - 0.68, y + 0.68, zr + 0.45, 0.07, seg=6, caps=False)
    for s in (-1, 1):
        box(coll, "loco_black", x - 1.2, y + s * 1.0 - 0.06, x + 1.2, y + s * 1.0 + 0.06, zr + 0.7, zr + 0.82, cell=0)


def buffers(xe, y, zr, d, coll=TN):
    """a pair of buffers and the coupling hook on a buffer beam at xe, pointing d (±1 along x)"""
    for s in (-0.85, 0.85):
        cyl_x(coll, "loco_black", min(xe, xe + d * 0.45), max(xe, xe + d * 0.45), y + s, zr + 1.05, 0.09, seg=8)
        disc(coll, "grey_steel", B(xe + d * 0.46, y + s, zr + 1.05), (d, 0, 0), 0.22, seg=12)
    box(coll, "loco_black", min(xe, xe + d * 0.3), y - 0.06, max(xe, xe + d * 0.3), y + 0.06, zr + 0.95, zr + 1.1, cell=0)


def coach(x0, yc, zf, cars=3, open_sides=(-1,), style="saloon", clen=24.0, thresh=0.4, steps_side=None):
    """a walk-through vintage saloon train (style "saloon": maroon lower panels, cream above, lined in gold;
    "tube": all red, cream window pillars). Doors stand open on `open_sides` (−1: north, +1: south), closed on
    the rest; a threshold meets the platform edge; `steps_side`: the side whose doorways get footboards down to
    the track bed (three steps of 0.3 m, so you can climb in from the tracks). Seats in bays of four facing
    across a 1 m aisle, luggage racks, roof lamps, bellows gangways between the cars."""
    w = 1.6
    zr = zf - 0.9
    gap = 1.0
    body = "maroon" if style == "saloon" else "metro_red"
    upper = "cream" if style == "saloon" else "metro_red"
    pillar = "cream"
    seat = "seat_red"
    for c in range(cars):
        a = x0 + c * (clen + gap)
        b = a + clen
        doors = [(a + 3.2, a + 4.6), (a + clen / 2 - 0.7, a + clen / 2 + 0.7), (b - 4.6, b - 3.2)]
        # floor (inset from the body sides: no shared faces), underframe, bogies, truss rods
        box(TN, "boards", a + 0.15, yc - w + 0.1, b - 0.15, yc + w - 0.1, zf - 0.15, zf)
        box(TN, "loco_black", a + 0.4, yc - w + 0.2, b - 0.4, yc + w - 0.2, zr + 0.75, zf - 0.15)
        for bx in (a + 3.6, b - 3.6):
            bogie(bx, yc, zr)
        for s in (-1, 1):
            strut(TN, "loco_black", B(a + 5.4, yc + s * 1.2, zr + 0.75), B(a + clen * 0.35, yc + s * 1.2, zr + 0.35), 0.03)
            strut(TN, "loco_black", B(a + clen * 0.35, yc + s * 1.2, zr + 0.35), B(b - clen * 0.35, yc + s * 1.2, zr + 0.35), 0.03)
            strut(TN, "loco_black", B(b - clen * 0.35, yc + s * 1.2, zr + 0.35), B(b - 5.4, yc + s * 1.2, zr + 0.75), 0.03)
        # an elliptical roof (grey outside, cream inside) with oil-lamp tops
        nr = 6
        for j in range(nr):
            ya, yb = yc - w + 2 * w * j / nr, yc - w + 2 * w * (j + 1) / nr
            za = zf + 2.45 + 0.4 * math.sin(math.pi * j / nr)
            zb = zf + 2.45 + 0.4 * math.sin(math.pi * (j + 1) / nr)
            pa, pb, pc, pd = B(a, ya, za), B(b, ya, za), B(b, yb, zb), B(a, yb, zb)
            face(TN, "roof_grey", [pa, pb, pc, pd], (0, -((ya + yb) / 2 - yc), 1.0), cell=2.0)
            face(TN, "cream", [B(a, ya, za - 0.02), B(b, ya, za - 0.02), B(b, yb, zb - 0.02), B(a, yb, zb - 0.02)], (0, ((ya + yb) / 2 - yc), -1.0), cell=2.0)
        for xe in (a, b):
            for j in range(nr):
                ya, yb = yc - w + 2 * w * j / nr, yc - w + 2 * w * (j + 1) / nr
                za = zf + 2.45 + 0.4 * math.sin(math.pi * j / nr)
                zb = zf + 2.45 + 0.4 * math.sin(math.pi * (j + 1) / nr)
                for sgn in (1, -1):
                    face(TN, body if sgn == (1 if xe == b else -1) else "cream", [B(xe, ya, zf + 2.45), B(xe, yb, zf + 2.45), B(xe, yb, zb), B(xe, ya, za)], (sgn, 0, 0))
        for k in range(int(clen / 3)):
            lx = a + 1.5 + k * 3.0
            cyl(TN, "brass", lx, yc, 0.16, zf + 2.85, zf + 3.0, seg=8)
            top(TN, "light_panel", lx - 0.15, yc - 0.15, lx + 0.15, yc + 0.15, zf + 2.8, down=True, cell=0)
        for side in (-1, 1):
            outer = yc + side * w
            inner = outer - side * 0.1
            yi, yo = sorted((outer, inner))
            open_side = side in open_sides
            cur = a
            for (d0, d1) in doors + [(b, b)]:
                if d0 - cur > 0.05:
                    box(TN, body, cur, yi, d0, yo, zf - 0.15, zf + 0.95, cell=1.0)
                    box(TN, upper, cur, yi, d0, yo, zf + 2.05, zf + 2.45, cell=1.0)
                    box(TN, "loco_black", cur, yi - (0.02 if side < 0 else 0), d0, yo + (0.02 if side > 0 else 0), zf + 2.38, zf + 2.45, cell=0)
                    glass_wall(TN, True, outer - side * 0.05, cur, d0, zf + 0.95, zf + 2.05, 1.4, 1.1, frame=pillar)
                    if style == "saloon":
                        # gold lining on the lower panels, panel beading
                        sa, sb = sorted((outer, outer + side * 0.008))
                        box(TN, "brass", cur + 0.1, sa, d0 - 0.1, sb, zf + 0.86, zf + 0.88, cell=0)
                        box(TN, "brass", cur + 0.1, sa, d0 - 0.1, sb, zf - 0.05, zf - 0.03, cell=0)
                        xb_ = cur + 1.2
                        while xb_ < d0 - 0.6:
                            box(TN, "brass", xb_ - 0.01, sa, xb_ + 0.01, sb, zf - 0.03, zf + 0.86, cell=0)
                            xb_ += 1.2
                if d1 > d0:
                    box(TN, upper, d0, yi, d1, yo, zf + 2.1, zf + 2.45, cell=0)
                    if not open_side:
                        box(TN, body, d0, yi, d1, yo, zf - 0.15, zf + 2.1, cell=0)
                        sa, sb = sorted((outer, outer + side * 0.01))
                        box(TN, "window_dark", d0 + 0.25, sa, d1 - 0.25, sb, zf + 1.15, zf + 1.95, cell=0)
                        box(TN, "brass", d1 - 0.3, sa, d1 - 0.18, sb, zf + 1.0, zf + 1.06, cell=0)
                    else:
                        for dx in (d0, d1):
                            cyl(TN, "brass", dx + (0.08 if dx == d0 else -0.08), outer - side * 0.05, 0.02, zf + 0.6, zf + 1.8, seg=6, caps=False)
                        ta, tb = sorted((outer, outer + side * thresh))
                        if side != steps_side:
                            box(TN, "metal_plate", d0, ta, d1, tb, zf - 0.15, zf - 0.005)
                        else:
                            # footboards down to the bed: three treads of 0.3 m, stepping out from the doorway
                            for k in range(3):
                                ya_, yb_ = sorted((outer + side * 0.3 * k, outer + side * 0.3 * (k + 1)))
                                zt = zf - 0.3 * (k + 1)
                                box(TN, "timber", d0 - 0.15, ya_, d1 + 0.15, yb_, zt - 0.06, zt, cell=0)
                                box(TN, "loco_black", d0 - 0.1, ya_, d0 - 0.04, yb_, zt - 0.3, zt - 0.06, cell=0)
                                box(TN, "loco_black", d1 + 0.04, ya_, d1 + 0.1, yb_, zt - 0.3, zt - 0.06, cell=0)
                            ya_, yb_ = sorted((outer, outer + side * 0.12))
                            box(TN, "metal_plate", d0, ya_, d1, yb_, zf - 0.15, zf - 0.005)
                cur = d1
            # a continuous footboard along the side (the period look), clear of the doorways' steps
            if style == "saloon":
                ya_, yb_ = sorted((outer, outer + side * 0.25))
                cur = a + 0.3
                for (d0, d1) in doors + [(b - 0.3, b - 0.3)]:
                    lo = d0 - (0.2 if side == steps_side and open_side else 0)
                    if lo - cur > 0.1:
                        box(TN, "timber", cur, ya_, lo, yb_, zf - 0.66, zf - 0.6, cell=0)
                    cur = d1 + (0.2 if side == steps_side and open_side else 0)
        # ends: gangway openings between cars, closed ends with buffers at the train's two ends
        for (xe, end) in ((a, c == 0), (b, c == cars - 1)):
            t0, t1 = (xe, xe + 0.15) if xe == a else (xe - 0.15, xe)
            if end:
                box(TN, body, t0, yc - w, t1, yc + w, zf - 0.15, zf + 0.95)
                box(TN, "window_dark", t0 - 0.02 if xe == a else t0, yc - w + 0.35, t1 + 0.02 if xe == b else t1, yc - 0.25, zf + 1.05, zf + 2.0, cell=0)
                box(TN, "window_dark", t0 - 0.02 if xe == a else t0, yc + 0.25, t1 + 0.02 if xe == b else t1, yc + w - 0.35, zf + 1.05, zf + 2.0, cell=0)
                box(TN, upper, t0, yc - w, t1, yc - w + 0.35, zf + 0.95, zf + 2.45, cell=0)
                box(TN, upper, t0, yc + w - 0.35, t1, yc + w, zf + 0.95, zf + 2.45, cell=0)
                box(TN, upper, t0, yc - 0.25, t1, yc + 0.25, zf + 0.95, zf + 2.45, cell=0)
                box(TN, upper, t0, yc - w, t1, yc + w, zf + 2.0, zf + 2.45, cell=0)
                buffers(xe, yc, zr, -1 if xe == a else 1)
                box(TN, "loco_black", xe - (0.1 if xe == a else 0), yc - 1.4, xe + (0.1 if xe == b else 0), yc + 1.4, zr + 0.85, zr + 1.3, cell=0)
            else:
                box(TN, upper, t0, yc - w, t1, yc - 0.55, zf, zf + 2.45)
                box(TN, upper, t0, yc + 0.55, t1, yc + w, zf, zf + 2.45)
                box(TN, upper, t0, yc - 0.55, t1, yc + 0.55, zf + 2.05, zf + 2.45)
        if c < cars - 1:
            box(TN, "loco_black", b, yc - 0.75, b + gap, yc - 0.55, zf, zf + 2.15, cell=0)
            box(TN, "loco_black", b, yc + 0.55, b + gap, yc + 0.75, zf, zf + 2.15, cell=0)
            box(TN, "loco_black", b, yc - 0.75, b + gap, yc + 0.75, zf + 2.15, zf + 2.3, cell=0)
            box(TN, "metal_plate", b, yc - 0.55, b + gap, yc + 0.55, zf - 0.15, zf)
        # seats: bays of four (two each side of a 1 m aisle) between the doors, facing pairs; brass racks
        bays = []
        edges = [a + 0.6] + [v for d in doors for v in d] + [b - 0.6]
        for k in range(0, len(edges), 2):
            s0, s1 = edges[k] + 0.4, edges[k + 1] - 0.4
            n = int((s1 - s0) / 1.7)
            for i in range(n):
                bays.append((s0 + i * 1.7, s0 + i * 1.7 + 1.7, i % 2))
        for (s0, s1, fc) in bays:
            for side in (-1, 1):
                ya, yb = sorted((yc + side * 0.5, yc + side * (w - 0.12)))
                box(TN, seat, s0 + 0.1, ya, s1 - 0.1, yb, zf + 0.42, zf + 0.52, cell=0)
                bx = s0 + 0.1 if fc == 0 else s1 - 0.25
                box(TN, seat, bx, ya, bx + 0.15, yb, zf + 0.52, zf + 1.15, cell=0)
                box(TN, "panel", bx - 0.02, ya, bx + 0.17, yb, zf + 1.15, zf + 1.22, cell=0)
                box(TN, "panel", s0 + 0.6, ya + 0.1, s0 + 1.1, yb - 0.1, zf, zf + 0.42, cell=0)
                box(TN, "brass", s0, ya, s1, yb, zf + 2.0, zf + 2.03, cell=0)
                box("clip", "clip", s0 + 0.05, ya, s1 - 0.05, yb, zf, zf + 1.25, cell=0)
        # panelling on the inside of the lower walls
        for side in (-1, 1):
            inner = yc + side * (w - 0.1)
            ya, yb = sorted((inner, inner - side * 0.03))
            cur = a + 0.2
            for (d0, d1) in doors + [(b - 0.2, b - 0.2)]:
                if d0 - cur > 0.05:
                    box(TN, "panel", cur, ya, d0, yb, zf, zf + 0.95, cell=1.0)
                cur = d1


def closed_coach(x0, y, zr, length=20.0, style="saloon"):
    """a vintage coach seen from the platform only (doors shut, blinds down): solid cover, cheap"""
    x1 = x0 + length
    zf = zr + 0.9
    body = "maroon" if style == "saloon" else "loco_green"
    box(TN, "loco_black", x0 + 0.4, y - 1.4, x1 - 0.4, y + 1.4, zr + 0.75, zf - 0.15)
    box(TN, body, x0, y - 1.6, x1, y + 1.6, zf - 0.15, zf + 0.95, cell=1.5)
    box(TN, "cream", x0, y - 1.6, x1, y + 1.6, zf + 0.95, zf + 2.45, cell=1.5)
    nr = 6
    for j in range(nr):
        ya, yb = y - 1.6 + 3.2 * j / nr, y - 1.6 + 3.2 * (j + 1) / nr
        za, zb = zf + 2.45 + 0.4 * math.sin(math.pi * j / nr), zf + 2.45 + 0.4 * math.sin(math.pi * (j + 1) / nr)
        face(TN, "roof_grey", [B(x0, ya, za), B(x1, ya, za), B(x1, yb, zb), B(x0, yb, zb)], (0, -((ya + yb) / 2 - y), 1.0), cell=2.0)
        for xe, sg in ((x0, -1), (x1, 1)):
            face(TN, body, [B(xe, ya, zf + 2.45), B(xe, yb, zf + 2.45), B(xe, yb, zb), B(xe, ya, za)], (sg, 0, 0))
    for side in (-1, 1):
        sa, sb = sorted((y + side * 1.6, y + side * 1.61))
        x = x0 + 1.0
        while x < x1 - 1.4:
            box(TN, "window_dark", x, sa, x + 1.1, sb, zf + 1.1, zf + 2.0, cell=0)
            box(TN, "brass", x, sa, x + 1.1, sb, zf + 0.86, zf + 0.88, cell=0)
            x += 1.5
        ya_, yb_ = sorted((y + side * 1.6, y + side * 1.85))
        box(TN, "timber", x0 + 0.5, ya_, x1 - 0.5, yb_, zf - 0.66, zf - 0.6, cell=0)
    for bx in (x0 + 3.4, x1 - 3.4):
        bogie(bx, y, zr)
    buffers(x0, y, zr, -1)
    buffers(x1, y, zr, 1)


def steam_loco(x0, y, zr, livery="loco_green", tender=True, coll=TN):
    """a steam locomotive facing west (its smokebox at x0): a 4-6-0 with a lined boiler, brass dome and
    safety valves, a cab with spectacle windows, splashers, coupling rods; and its tender of coal"""
    b = lambda *a, **k: box(coll, *a, **k)
    zb = zr + 2.45                                   # boiler centre line
    b("loco_black", x0 + 0.4, y - 0.55, x0 + 13.2, y + 0.55, zr + 0.5, zr + 1.3, cell=0)            # frames
    b("loco_black", x0 + 0.3, y - 1.4, x0 + 13.4, y + 1.4, zr + 1.25, zr + 1.35, cell=0)            # running plate
    b("red_paint", x0, y - 1.35, x0 + 0.35, y + 1.35, zr + 0.85, zr + 1.35, cell=0)                 # buffer beam
    buffers(x0, y, zr, -1, coll=coll)
    for s in (-0.6, 0.0, 0.6):
        b("cream", x0 - 0.12, y + s - 0.12, x0 - 0.02, y + s + 0.12, zr + 1.4, zr + 1.65, cell=0)
    cyl_x(coll, "loco_black", x0 + 0.8, x0 + 2.4, y, zb, 0.86, seg=18)                              # smokebox
    disc(coll, "loco_black", B(x0 + 0.8, y, zb), (-1, 0, 0), 0.86, seg=18)
    disc(coll, "grey_steel", B(x0 + 0.78, y, zb), (-1, 0, 0), 0.3, seg=10)
    cyl_x(coll, livery, x0 + 2.4, x0 + 9.0, y, zb, 0.78, seg=18)                                   # boiler
    for xb_ in (x0 + 3.6, x0 + 5.2, x0 + 6.8, x0 + 8.4):
        cyl_x(coll, "brass", xb_ - 0.04, xb_ + 0.04, y, zb, 0.795, seg=18)
    b(livery, x0 + 9.0, y - 0.95, x0 + 10.4, y + 0.95, zr + 1.35, zr + 3.05, cell=0)               # firebox
    cyl(coll, "loco_black", x0 + 1.55, y, 0.27, zb + 0.6, zr + 4.1, seg=12)                         # chimney
    cyl(coll, "loco_black", x0 + 1.55, y, 0.35, zr + 4.0, zr + 4.2, seg=12)
    cyl(coll, "brass", x0 + 5.6, y, 0.36, zb + 0.6, zr + 3.6, seg=12)                               # dome
    cyl(coll, "brass", x0 + 5.6, y, 0.28, zr + 3.6, zr + 3.72, seg=12)
    for dy in (-0.12, 0.12):
        cyl(coll, "brass", x0 + 8.7, y + dy, 0.09, zb + 0.6, zr + 3.55, seg=8)                     # safety valves
    b("loco_black", x0 + 2.0, y - 1.38, x0 + 9.4, y - 1.3, zr + 1.35, zr + 1.65, cell=0)
    b("loco_black", x0 + 2.0, y + 1.3, x0 + 9.4, y + 1.38, zr + 1.35, zr + 1.65, cell=0)
    for s in (-1, 1):
        cyl_x(coll, livery, x0 + 1.0, x0 + 3.0, y + s * 1.12, zr + 1.0, 0.38, seg=12)               # cylinders
        disc(coll, "loco_black", B(x0 + 1.0, y + s * 1.12, zr + 1.0), (-1, 0, 0), 0.38, seg=12)
        # wheels: the pony truck, three coupled drivers with a coupling rod, their splashers
        for (wx, r) in ((x0 + 1.9, 0.45), (x0 + 3.0, 0.45)):
            cyl_y(coll, "loco_black", wx, y + s * 0.7 - 0.06, y + s * 0.7 + 0.06, zr + r, r, seg=14)
        for wx in (x0 + 5.0, x0 + 7.1, x0 + 9.2):
            ya_, yb_ = sorted((y + s * 0.7, y + s * 0.84))
            cyl_y(coll, "loco_black", wx, ya_, yb_, zr + 0.95, 0.95, seg=20)
            ya_, yb_ = sorted((y + s * 0.84, y + s * 0.87))
            cyl_y(coll, livery, wx, ya_, yb_, zr + 0.95, 0.62, seg=16)
            cyl_y(coll, "grey_steel", wx + 0.3, min(y + s * 0.87, y + s * 0.95), max(y + s * 0.87, y + s * 0.95), zr + 0.95, 0.08, seg=6)
            b(livery, wx - 1.0, min(y + s * 0.62, y + s * 0.92), wx + 1.0, max(y + s * 0.62, y + s * 0.92), zr + 1.35, zr + 1.95, cell=0)
        ya_, yb_ = sorted((y + s * 0.95, y + s * 1.0))
        b("grey_steel", x0 + 5.3, ya_, x0 + 9.5, yb_, zr + 0.9, zr + 1.0, cell=0)
        strut(coll, "grey_steel", B(x0 + 3.0, y + s * 1.12, zr + 1.0), B(x0 + 5.3, y + s * 0.98, zr + 0.95), 0.05)
        # cab sides: low at the front (a cut-out to look out of), full at the back
        ya_, yb_ = sorted((y + s * 1.3, y + s * 1.38))
        b(livery, x0 + 10.55, ya_, x0 + 13.4, yb_, zr + 1.35, zr + 2.5, cell=0)
        b(livery, x0 + 12.3, ya_, x0 + 13.4, yb_, zr + 2.5, zr + 3.9, cell=0)
        disc(coll, "window_dark", B(x0 + 10.39, y + s * 0.62, zr + 3.2), (-1, 0, 0), 0.24, seg=12)
        disc(coll, "brass", B(x0 + 10.385, y + s * 0.62, zr + 3.2), (-1, 0, 0), 0.28, seg=12)
    b(livery, x0 + 10.4, y - 1.38, x0 + 10.55, y + 1.38, zr + 1.35, zr + 3.9, cell=0)              # spectacle plate
    b("loco_black", x0 + 10.2, y - 1.48, x0 + 13.7, y + 1.48, zr + 3.9, zr + 4.02, cell=0)          # cab roof
    b("loco_black", x0 + 10.55, y - 0.7, x0 + 11.2, y + 0.7, zr + 1.35, zr + 3.2, cell=0)            # backhead
    b("brass", x0 + 11.2, y - 0.3, x0 + 11.25, y + 0.3, zr + 2.4, zr + 2.9, cell=0)
    if not tender:
        b(livery, x0 + 13.4, y - 1.38, x0 + 13.55, y + 1.38, zr + 1.35, zr + 3.9, cell=0)
        b("red_paint", x0 + 13.4, y - 1.35, x0 + 13.75, y + 1.35, zr + 0.85, zr + 1.35, cell=0)
        buffers(x0 + 13.75, y, zr, 1, coll=coll)
        for s in (-1, 1):
            b(livery, x0 + 3.2, min(y + s * 0.85, y + s * 1.35), x0 + 9.4, max(y + s * 0.85, y + s * 1.35), zr + 1.35, zr + 3.1, cell=0)   # side tanks
        return
    # the tender
    t0, t1 = x0 + 13.8, x0 + 20.6
    b("loco_black", t0, y - 1.3, t1, y + 1.3, zr + 0.55, zr + 1.35, cell=0)
    b(livery, t0, y - 1.38, t1, y + 1.38, zr + 1.35, zr + 3.2, cell=1.0)
    b("coal", t0 + 0.4, y - 1.2, t1 - 1.6, y + 1.2, zr + 3.2, zr + 3.55, cell=0)
    b(livery, t1 - 1.6, y - 1.38, t1, y + 1.38, zr + 3.2, zr + 3.6, cell=0)
    for s in (-1, 1):
        ya_, yb_ = sorted((y + s * 1.38, y + s * 1.395))
        b("brass", t0 + 0.2, ya_, t1 - 0.2, yb_, zr + 1.5, zr + 1.53, cell=0)
        b("brass", t0 + 0.2, ya_, t1 - 0.2, yb_, zr + 3.0, zr + 3.03, cell=0)
        for wx in (t0 + 1.2, t0 + 3.4, t0 + 5.6):
            cyl_y(coll, "loco_black", wx, *sorted((y + s * 0.7, y + s * 0.82)), zr + 0.55, 0.55, seg=14)
    b("red_paint", t1, y - 1.35, t1 + 0.3, y + 1.35, zr + 0.85, zr + 1.35, cell=0)
    buffers(t1 + 0.3, y, zr, 1, coll=coll)
    text(S, "brass", "GCR", (t0 + t1) / 2, y - 1.4, zr + 2.3, size=0.45, facing="n")
    text(S, "brass", "GCR", (t0 + t1) / 2, y + 1.4, zr + 2.3, size=0.45, facing="s")


def goods_van(x0, y, zr, length=15.0, mat="timber"):
    """a wooden goods van: planked body, a curved roof, iron strapping, sliding doors"""
    x1 = x0 + length
    box(TN, "loco_black", x0, y - 1.4, x1, y + 1.4, zr + 1.0, zr + 1.3)
    box(TN, mat, x0 + 0.1, y - 1.4, x1 - 0.1, y + 1.4, zr + 1.3, zr + 3.8, cell=1.5)
    for j in range(5):
        ya, yb = y - 1.45 + 2.9 * j / 5, y - 1.45 + 2.9 * (j + 1) / 5
        za, zb = zr + 3.8 + 0.35 * math.sin(math.pi * j / 5), zr + 3.8 + 0.35 * math.sin(math.pi * (j + 1) / 5)
        face(TN, "roof_grey", [B(x0, ya, za), B(x1, ya, za), B(x1, yb, zb), B(x0, yb, zb)], (0, -((ya + yb) / 2 - y), 1.0), cell=2.0)
        for xe, sg in ((x0 + 0.1, -1), (x1 - 0.1, 1)):
            face(TN, mat, [B(xe, ya, zr + 3.8), B(xe, yb, zr + 3.8), B(xe, yb, zb), B(xe, ya, za)], (sg, 0, 0))
    for s in (-1, 1):
        ya_, yb_ = sorted((y + s * 1.4, y + s * 1.44))
        for k in range(int(length / 2.5) + 1):
            x = x0 + 0.3 + k * (length - 0.6) / int(length / 2.5)
            box(TN, "loco_black", x - 0.04, ya_, x + 0.04, yb_, zr + 1.3, zr + 3.8, cell=0)
        strut(TN, "loco_black", B(x0 + 0.3, (ya_ + yb_) / 2, zr + 1.3), B(x0 + length / 2 - 1.6, (ya_ + yb_) / 2, zr + 3.8), 0.04)
        strut(TN, "loco_black", B(x1 - 0.3, (ya_ + yb_) / 2, zr + 1.3), B(x0 + length / 2 + 1.6, (ya_ + yb_) / 2, zr + 3.8), 0.04)
        box(TN, mat, x0 + length / 2 - 1.6, min(y + s * 1.44, y + s * 1.5), x0 + length / 2 + 1.6, max(y + s * 1.44, y + s * 1.5), zr + 1.3, zr + 3.7, cell=0)
        box(TN, "loco_black", x0 + length / 2 - 1.7, min(y + s * 1.48, y + s * 1.52), x0 + length / 2 + 1.7, max(y + s * 1.48, y + s * 1.52), zr + 3.7, zr + 3.78, cell=0)
    for bx in (x0 + 2.2, x1 - 2.2):
        bogie(bx, y, zr)
    buffers(x0, y, zr, -1)
    buffers(x1, y, zr, 1)


def flat_wagon(x0, y, zr, loads, length=15.0):
    """a flat wagon with its loads: crates, barrels, a sheeted load under a tarpaulin"""
    x1 = x0 + length
    box(TN, "loco_black", x0, y - 1.3, x1, y + 1.3, zr + 0.9, zr + 1.2)
    box(TN, "timber", x0, y - 1.32, x1, y + 1.32, zr + 1.2, zr + 1.3)
    for bx in (x0 + 2.2, x1 - 2.2):
        bogie(bx, y, zr)
    buffers(x0, y, zr, -1)
    buffers(x1, y, zr, 1)
    x = x0 + 0.6
    for (ln, kind) in loads:
        if kind == "sheet":
            box(TN, "canvas", x, y - 1.22, x + ln, y + 1.22, zr + 1.3, zr + 3.6, cell=1.0)
            for k in range(int(ln / 1.5) + 1):
                xr = x + 0.1 + k * (ln - 0.2) / int(ln / 1.5)
                box(TN, "loco_black", xr - 0.03, y - 1.25, xr + 0.03, y + 1.25, zr + 3.45, zr + 3.62, cell=0)
        else:
            crate_stack(x, y - 1.22, x + ln, y + 1.22, zr + 1.3, 2.3, coll=TN, seed=int(x * 7))
        x += ln + 0.4


def steam_crane(x0, y, zr):
    """the depot's steam breakdown crane (18 m with its jib runner): a crane house with its boiler and
    chimney on a well wagon, the lattice jib lowered onto a match wagon"""
    x1 = x0 + 18
    box(TN, "loco_black", x0, y - 1.4, x1, y + 1.4, zr + 0.9, zr + 1.4)
    for bx in (x0 + 2.5, x0 + 8.5, x1 - 2.5):
        bogie(bx, y, zr)
    buffers(x0, y, zr, -1)
    buffers(x1, y, zr, 1)
    cyl(TN, "loco_black", x0 + 4.5, y, 1.5, zr + 1.4, zr + 1.7, seg=16)
    box(TN, "red_paint", x0 + 2.6, y - 1.35, x0 + 7.0, y + 1.35, zr + 1.7, zr + 4.2, cell=1.0)
    box(TN, "loco_black", x0 + 2.5, y - 1.45, x0 + 7.1, y + 1.45, zr + 4.2, zr + 4.35, cell=0)
    cyl(TN, "loco_black", x0 + 3.2, y, 0.22, zr + 4.35, zr + 5.6, seg=10)
    for s in (-1, 1):
        box(TN, "window_dark", x0 + 3.0, min(y + s * 1.35, y + s * 1.37), x0 + 6.6, max(y + s * 1.35, y + s * 1.37), zr + 3.0, zr + 3.8, cell=0)
    # the jib: two lattice sides from the crane house to its rest on the match wagon
    ja, jb = (x0 + 6.8, zr + 2.4), (x1 - 1.2, zr + 2.6)
    for s in (-0.5, 0.5):
        strut(TN, "red_paint", B(ja[0], y + s, ja[1] + 0.6), B(jb[0], y + s * 0.4, jb[1] + 0.3), 0.07)
        strut(TN, "red_paint", B(ja[0], y + s, ja[1] - 0.2), B(jb[0], y + s * 0.4, jb[1] - 0.1), 0.07)
        n = 10
        for k in range(n):
            t0, t1 = k / n, (k + 1) / n
            px = lambda t: ja[0] + (jb[0] - ja[0]) * t
            pz = lambda t, top: (ja[1] + 0.6 if top else ja[1] - 0.2) + ((jb[1] + 0.3 if top else jb[1] - 0.1) - (ja[1] + 0.6 if top else ja[1] - 0.2)) * t
            sy = lambda t: y + (s + (s * 0.4 - s) * t)
            strut(TN, "red_paint", B(px(t0), sy(t0), pz(t0, k % 2 == 0)), B(px(t1), sy(t1), pz(t1, k % 2 == 1)), 0.03)
    box(TN, "timber", x1 - 2.0, y - 0.6, x1 - 0.6, y + 0.6, zr + 1.4, zr + 2.4, cell=0)
    cyl_y(TN, "grey_steel", jb[0] + 0.2, y - 0.25, y + 0.25, jb[1] - 0.6, 0.18, seg=10)


# models that arrive facing the wrong way: the InterCity power car's cab must lead at the west end (its
# coaches follow it east), the model comes with the cab at its east end
TURN = {"hst_power"}
IMPORTS = {   # model name: list of (west end x, track y)
    "soviet_loco": [(68.8, SIDINGS["S1"])],
    "hst_power": [(36.5, TRACKS["T6"])],
    "old_coach": [(106.0, TRACKS["T4"]), (123.3, TRACKS["T4"]), (140.6, TRACKS["T4"]), (157.9, TRACKS["T4"]),
                  (53.8, TRACKS["T6"]), (71.1, TRACKS["T6"])],
}


def imported_trains():
    """the three Sketchfab trains (models/*.glb, made by prep_models.py; credits in index.html):
    "Soviet armoured train locomotive" by Nadir Alishly, "Train - Intercity 125 Executive with buffers" by
    timblewee, "Train Wagon" by 3ddominator — all CC BY 4.0. Solid cover (their insides are hollow shells)."""
    for name, places in IMPORTS.items():
        before = set(bpy.data.objects)
        bpy.ops.import_scene.gltf(filepath=os.path.join(HERE, "models", name + ".glb"))
        new = [o for o in bpy.data.objects if o not in before]
        src = next(o for o in new if o.type == "MESH")
        src.data = src.data.copy()
        src.data.transform(src.matrix_world)
        if name in TURN:
            src.data.transform(Matrix.Rotation(math.pi, 4, "Z"))    # half a turn about its own vertical
        for o in new:
            if o is not src:
                bpy.data.objects.remove(o)
        src.parent = None
        src.matrix_world = Matrix.Identity(4)
        vs = [v.co for v in src.data.vertices]
        mn_x, mx_x = min(v.x for v in vs), max(v.x for v in vs)
        mn_z = min(v.z for v in vs)
        for m in src.data.materials:
            if m:
                m.name = "pcx_m_" + name + "_" + m.name
        copies = []
        for (xw, y) in places:
            ob = src.copy()
            ob.data = src.data.copy()
            ob.data.transform(Matrix.Translation(Vector((xw - 64.0 - mn_x, 48.0 - y, Z_RAIL - mn_z))))
            bpy.context.scene.collection.objects.link(ob)
            copies.append(ob)
        for c in src.users_collection:
            c.objects.unlink(src)
        bpy.data.objects.remove(src)
        if len(copies) > 1:
            with bpy.context.temp_override(active_object=copies[0], selected_editable_objects=copies):
                bpy.ops.object.join()
        ob = copies[0]
        ob.name = ob.data.name = "trains_" + name
        for c in ob.users_collection:
            c.objects.unlink(ob)
        L.collection(L.COLL_NAMES[TN]).objects.link(ob)
        print(f"{name}: {len(places)} placed, {mx_x - mn_x:.1f} m long, {sum(len(p.vertices) - 2 for p in ob.data.polygons)} tris")


def trains():
    zr = Z_RAIL
    # platform 1 (T1): a steam express ready to leave — the engine at the west end, two coaches behind
    steam_loco(40.0, TRACKS["T1"], zr)
    closed_coach(61.5, TRACKS["T1"], zr, 20.0)
    closed_coach(82.0, TRACKS["T1"], zr, 20.0)
    # platform 2 (T2): the walk-through saloon train, doors open on both sides: the platform side (north)
    # and the track side (south, footboards down to the bed) — x 98 … 172
    coach(98.0, 83.0, 0.0, cars=3, open_sides=(-1, 1), style="saloon", steps_side=1)
    # the underground railway: a 2-car train in red, doors open onto its platform (north)
    coach(90.0, 118.2, Z_UG, cars=2, open_sides=(-1,), style="tube", clen=22.0, thresh=0.1)
    # goods: the armoured locomotive (imported) with three vans on S1, flat wagons on S2
    for k, mat in enumerate(("timber", "brick_dark", "timber")):
        goods_van(84.5 + k * 15.5, SIDINGS["S1"], zr, mat=mat)
    flat_wagon(98.0, SIDINGS["S2"], zr, [(6.1, "crates"), (6.1, "sheet")])
    flat_wagon(113.5, SIDINGS["S2"], zr, [(12.2, "sheet")])
    flat_wagon(135.0, SIDINGS["S2"], zr, [(6.1, "crates"), (6.1, "crates")])
    # depot: the breakdown crane in the shed (T3), a tank engine outside (T5)
    steam_crane(206.0, TRACKS["T3"], zr)
    steam_loco(212.0, TRACKS["T5"], zr, livery="loco_black", tender=False)


# ======================================================================================== props
def waiting_room(kx, cy):
    """a timber waiting room on an island platform (6 × 3.2 m): doors in both long sides, windows, benches
    inside, a slated pitched roof with a deep valance"""
    x0, x1, y0, y1 = kx, kx + 6, cy - 1.6, cy + 1.6
    for (yy, d) in ((y0, -1), (y1, 1)):
        wall(P, "timber", (x0, yy), (x1, yy), 0.0, 2.7, 0.12, doors=[(kx + 2.4, kx + 3.6, 2.2)])
        for (wa, wb) in ((x0 + 0.5, x0 + 2.0), (x1 - 2.0, x1 - 0.5)):
            glass_wall(P, True, yy + d * 0.07, wa, wb, 1.0, 2.1, 0.75, 1.1, frame="sash")
    wall(P, "timber", (x0, y0), (x0, y1), 0.0, 2.7, 0.12)
    wall(P, "timber", (x1, y0), (x1, y1), 0.0, 2.7, 0.12)
    top(P, "boards", x0 + 0.06, y0 + 0.06, x1 - 0.06, y1 - 0.06, 0.01)
    for (xa, xb) in ((x0 + 0.1, x0 + 0.8), (x1 - 0.8, x1 - 0.1)):
        box(P, "wood", xa, y0 + 0.3, xb, y1 - 0.3, 0.0, 0.45)
        box("clip", "clip", xa, y0 + 0.3, xb, y1 - 0.3, 0.0, 1.25, cell=0)
    ym = cy
    for (ya, sgn) in ((y0 - 0.5, 1), (y1 + 0.5, -1)):
        pa, pb, pc, pd = B(x0 - 0.4, ya, 2.7), B(x1 + 0.4, ya, 2.7), B(x1 + 0.4, ym, 3.7), B(x0 - 0.4, ym, 3.7)
        face(P, "slate", [pa, pb, pc, pd], (0, sgn * 1.0, 1.3), cell=0)
        face(P, "timber", [(q[0], q[1], q[2] - 0.04) for q in (pa, pb, pc, pd)], (0, -sgn * 1.0, -1.3), cell=0)
    for xe, sg in ((x0 - 0.4, -1), (x1 + 0.4, 1)):
        face(P, "timber", [B(xe, y0 - 0.5, 2.7), B(xe, ym, 3.7), B(xe, y1 + 0.5, 2.7)], (sg, 0, 0))
    box(P, "iron", x0 - 0.4, ym - 0.06, x1 + 0.4, ym + 0.06, 3.65, 3.78, cell=0)
    cyl(P, "brick_dark", x1 - 1.0, ym + 0.5, 0.22, 3.2, 4.3, seg=8)
    for yy in (y0 - 0.5, y1 + 0.5):
        xv = x0 - 0.4
        while xv < x1 + 0.4:
            face(P, "timber", [B(xv, yy, 2.72), B(xv + 0.25, yy, 2.72), B(xv + 0.25, yy, 2.45), B(xv + 0.125, yy, 2.3)], (0, 1 if yy < cy else -1, 0))
            xv += 0.25
    lantern(kx + 3.0, cy, 2.7, drop=0.6, coll=P)
    # lettered on the valance's face (on the wall behind it, the valance's scallops cut the letters up)
    sign(kx + 3.0, y0 - 0.53, 2.58, "WAITING ROOM", "n", size=0.16, board=False)
    sign(kx + 3.0, y1 + 0.53, 2.58, "WAITING ROOM", "s", size=0.16, board=False)


def water_crane(x, y):
    """a water crane for the engines: an iron column, its swinging arm with a leather hose, a brazier"""
    box(P, "iron", x - 0.35, y - 0.35, x + 0.35, y + 0.35, 0.0, 0.3, cell=0)
    cyl(P, "iron", x, y, 0.16, 0.3, 3.2, seg=10)
    cyl(P, "iron", x, y, 0.22, 3.2, 3.35, seg=10)
    cyl_x(P, "iron", x, x + 2.6, y, 3.5, 0.12, seg=8)
    cyl(P, "canvas", x + 2.6, y, 0.09, 2.3, 3.5, seg=8)
    cyl(P, "loco_black", x - 0.6, y, 0.2, 0.0, 0.7, seg=8)


def platform_props():
    """per platform: wooden benches, luggage barrows with trunks and churns, train indicator boards, enamel
    number boards, bins; lamp standards; a waiting room per island; water cranes; hanging clocks — spaced
    so that no lane runs more than ~20 m without cover"""
    blocked = [(b0 - 1, b1 + 13) for (b0, b1) in BRIDGES] + [(SUB_STAIR[0] - 1, SUB_STAIR[1] + 1), (147, 165)]
    for (n, a, b) in PLATFORMS:
        cy = (a + b) / 2
        if n == "1":
            cy = 95.0
        if n == "4":
            cy = 37.0
        cols = [c for c in range(40, 184, 16)] if n in ("2", "3") else []
        kiosk = (122, 132) if n == "2" else (54, 64) if n == "3" else (0, 0)
        for k, x in enumerate(range(42, 182, 10)):
            if any(lo <= x <= hi for (lo, hi) in blocked) or any(abs(x - c) < 3.4 for c in cols) or kiosk[0] <= x <= kiosk[1]:
                continue
            kind = k % 5
            if kind == 0:
                bench_row(x - 2.5, x + 2.5, cy - 0.35)
            elif kind == 1:
                # a platform barrow with trunks and cases, two milk churns beside it
                box(P, "timber", x - 0.8, cy - 0.45, x + 0.8, cy + 0.45, 0.45, 0.55)
                for (ox, oy) in ((-0.6, -0.35), (0.6, -0.35), (-0.6, 0.35), (0.6, 0.35)):
                    cyl_y(P, "loco_black", x + ox, cy + oy - 0.05, cy + oy + 0.05, 0.22, 0.22, seg=10)
                box(P, "iron", x - 0.85, cy - 0.05, x - 0.8, cy + 0.05, 0.55, 1.2, cell=0)
                box(P, "timber", x - 0.7, cy - 0.4, x + 0.1, cy + 0.4, 0.55, 1.15)
                box(P, "maroon", x + 0.15, cy - 0.35, x + 0.75, cy + 0.3, 0.55, 0.95)
                box(P, "luggage", x - 0.55, cy - 0.3, x + 0.05, cy + 0.25, 1.15, 1.45)
                for oy in (-0.25, 0.25):
                    cyl(P, "grey_steel", x + 1.15, cy + oy, 0.2, 0.0, 0.75, seg=10)
                    cyl(P, "grey_steel", x + 1.15, cy + oy, 0.13, 0.75, 0.9, seg=10)
            elif kind == 2:
                # a train indicator: wooden fingerboards on two iron posts
                for s in (-0.3, 0.3):
                    box(P, "iron", x - 0.05, cy + s - 0.05, x + 0.05, cy + s + 0.05, 0, 2.4, cell=0)
                box(P, "panel", x - 0.1, cy - 1.0, x + 0.1, cy + 1.0, 2.4, 3.3, cell=0)
                for f, d in (("e", 0.11), ("w", -0.11)):
                    for i, ln in enumerate(("NEXT TRAIN", "CALDER BAY", "& THE COAST")):
                        text(S, "sign_text", ln, x + d, cy, 3.1 - i * 0.26, size=0.16, facing=f)
            elif kind == 3:
                box(S, "sign_dark", x - 0.08, cy - 0.8, x + 0.08, cy + 0.8, 3.0, 4.0, cell=0)
                box(S, "cream", x - 0.06, cy - 0.85, x + 0.06, cy + 0.85, 2.95, 4.05, cell=0)
                for o in (-0.6, 0.6):
                    box(S, "iron", x - 0.045, cy + o - 0.045, x + 0.045, cy + o + 0.045, 0, 3.0, cell=0)
                for f, d in (("e", 0.1), ("w", -0.1)):
                    text(S, "sign_text", n, x + d, cy, 3.5, size=0.7, facing=f)
            else:
                cyl(P, "iron", x, cy, 0.3, 0, 0.9, seg=10)
                cyl(P, "iron", x, cy, 0.34, 0.9, 0.98, seg=10)
                box(P, "timber", x + 1.0, cy - 0.6, x + 2.6, cy + 0.6, 0.35, 0.45)
                box(P, "iron", x + 2.55, cy - 0.6, x + 2.6, cy + 0.6, 0.45, 1.1, cell=0)
                for (ox, oy) in ((1.2, -0.55), (2.4, -0.55), (1.2, 0.55), (2.4, 0.55)):
                    cyl_y(P, "loco_black", x + ox, cy + oy - 0.04, cy + oy + 0.04, 0.17, 0.17, seg=8)
        # lamp standards: down the middle of the side platforms, off the column line on the islands
        lamp_ys = [cy] if n in ("1", "4") else [cy - 3.2, cy + 3.2]
        for x in range(47, 182, 10 if n in ("1", "4") else 20):
            if any(lo - 1 <= x <= hi + 1 for (lo, hi) in blocked) or kiosk[0] - 1 <= x <= kiosk[1] + 1:
                continue
            for ly in lamp_ys:
                gas_lamp(x, ly)
        # running-in boards with the station's name, on the back walls of platforms 1 and 4
        if n == "1":
            for x in (50, 90, 120, 160):
                sign(x, 99.75, 2.6, "PORT CALDER", "n", size=0.6)
        if n == "4":
            for x in (70, 112, 154):
                sign(x, 32.25, 2.6, "PORT CALDER", "s", size=0.6)
        if n in ("2", "3"):
            waiting_room(124.0 if n == "2" else 56.0, cy)
        # a water crane at the west end, by the track
        wy = {"1": a + 1.3, "2": b - 1.3, "3": a + 1.3, "4": b - 1.3}[n]
        water_crane(38.6, wy)
    # station clocks: on the footbridges (both faces) and hung from the island girders
    for (x0, x1) in BRIDGES:
        for y in (40.0, 92.0):
            hanging_clock((x0 + x1) / 2, y + (-0.4 if y < 60 else 0.4), 5.75, axis="y", top_z=6.4)
    for y in (56.0, 76.0):
        hanging_clock(136.0, y, VZ - 3.0, axis="x", top_z=VZ - 1.22)


def _ico(sub=1):
    """a unit icosphere: (vertices, triangles)"""
    t = (1 + 5 ** 0.5) / 2
    vs = [Vector(v).normalized() for v in ((-1, t, 0), (1, t, 0), (-1, -t, 0), (1, -t, 0), (0, -1, t), (0, 1, t),
                                            (0, -1, -t), (0, 1, -t), (t, 0, -1), (t, 0, 1), (-t, 0, -1), (-t, 0, 1))]
    fs = [(0, 11, 5), (0, 5, 1), (0, 1, 7), (0, 7, 10), (0, 10, 11), (1, 5, 9), (5, 11, 4), (11, 10, 2), (10, 7, 6),
          (7, 1, 8), (3, 9, 4), (3, 4, 2), (3, 2, 6), (3, 6, 8), (3, 8, 9), (4, 9, 5), (2, 4, 11), (6, 2, 10), (8, 6, 7), (9, 8, 1)]
    for _ in range(sub):
        mid, nf = {}, []

        def m(a, b):
            k = (min(a, b), max(a, b))
            if k not in mid:
                mid[k] = len(vs)
                vs.append(((vs[a] + vs[b]) / 2).normalized())
            return mid[k]
        for (a, b, c) in fs:
            ab, bc, ca = m(a, b), m(b, c), m(c, a)
            nf += [(a, ab, ca), (b, bc, ab), (c, ca, bc), (ab, bc, ca)]
        fs = nf
    return vs, fs


ICO = _ico(1)


def leaf_clump(coll, c, r, rnd, squash=0.8):
    """a lumpy ball of leaves: an icosphere pushed in and out at random, a little flattened"""
    vs, fs = ICO
    k = [0.78 + rnd.random() * 0.4 for _ in vs]
    pts = [Vector((c[0] + v.x * r * k[i], c[1] + v.y * r * k[i], c[2] + v.z * r * squash * k[i])) for i, v in enumerate(vs)]
    for (a, b, d) in fs:
        p, q, w = pts[a], pts[b], pts[d]
        n = (q - p).cross(w - p)
        out = (p + q + w) / 3 - Vector(c)
        if n.dot(out) < 0:
            q, w = w, q
        tri(coll, "foliage", tuple(p), tuple(q), tuple(w))


def limb(coll, a, b, r0, r1, seg=7):
    """a tapered round limb between two Blender points (bark)"""
    A, Bv = Vector(a), Vector(b)
    d = (Bv - A).normalized()
    up = Vector((0, 0, 1)) if abs(d.z) < 0.95 else Vector((1, 0, 0))
    s1 = d.cross(up).normalized()
    s2 = d.cross(s1).normalized()
    ring = [s1 * math.cos(2 * math.pi * i / seg) + s2 * math.sin(2 * math.pi * i / seg) for i in range(seg)]
    for i in range(seg):
        p, q = ring[i], ring[(i + 1) % seg]
        quad(coll, "bark", tuple(A + p * r0), tuple(A + q * r0), tuple(Bv + q * r1), tuple(Bv + p * r1), 0)


def tree(x, y, z0=0.0, h=9.0, seed=0):
    """a broadleaf park tree (a London plane / lime, h metres): a leaning, tapering trunk that forks into
    main limbs, and a domed crown of irregular leaf clumps round them, its underside lifted ~3 m clear
    of the ground. Trunk and limbs are solid; the crown stops players only (bullets and sight go through)."""
    rnd = random.Random(seed * 7919 + 13)
    base = Vector(B(x, y, z0))
    fork_z = h * (0.36 + rnd.random() * 0.06)
    lean = Vector((rnd.uniform(-0.25, 0.25), rnd.uniform(-0.25, 0.25), 0))
    fork = base + Vector((0, 0, fork_z)) + lean
    r_trunk = 0.17 + h * 0.012
    # root flare, then the trunk in two pieces so it bends a little
    limb(P, tuple(base + Vector((0, 0, -0.05))), tuple(base + Vector((0, 0, 0.5))), r_trunk * 1.45, r_trunk * 1.05)
    mid = base + Vector((0, 0, fork_z * 0.55)) + lean * 0.4
    limb(P, tuple(base + Vector((0, 0, 0.5))), tuple(mid), r_trunk * 1.05, r_trunk * 0.95)
    limb(P, tuple(mid), tuple(fork), r_trunk * 0.95, r_trunk * 0.8)
    # the crown: an ellipsoid over the fork
    cz = z0 + h * 0.66
    rx = h * (0.3 + rnd.random() * 0.05)
    rz = h * 0.3
    centre = Vector((base.x + lean.x * 1.5, base.y + lean.y * 1.5, cz))
    n_limbs = 4 + rnd.randrange(2)
    a0 = rnd.random() * 6.283
    for i in range(n_limbs):
        a = a0 + 6.283 * i / n_limbs + rnd.uniform(-0.3, 0.3)
        tip = centre + Vector((math.cos(a) * rx * 0.62, math.sin(a) * rx * 0.62, rnd.uniform(-0.1, 0.35) * rz))
        elbow = fork.lerp(tip, 0.5) + Vector((0, 0, 0.4))
        limb(P, tuple(fork), tuple(elbow), r_trunk * 0.6, r_trunk * 0.38, seg=6)
        limb(P, tuple(elbow), tuple(tip), r_trunk * 0.38, r_trunk * 0.14, seg=5)
    limb(P, tuple(fork), tuple(centre + Vector((0, 0, rz * 0.5))), r_trunk * 0.55, r_trunk * 0.15, seg=6)
    # leaf clumps: a core plus a shell of overlapping balls (golden-angle spread), bigger low down
    leaf_clump(SO, tuple(centre), min(rx, rz) * 0.82, rnd)
    n = 14
    for i in range(n):
        zf = 1 - 2 * (i + 0.5) / n                      # −1 … 1 bottom to top
        zf = zf * 0.85
        ring = math.sqrt(max(0.0, 1 - zf * zf))
        a = i * 2.39996 + rnd.uniform(-0.25, 0.25)
        p = centre + Vector((math.cos(a) * ring * rx * 0.72, math.sin(a) * ring * rx * 0.72, zf * rz * 0.7))
        leaf_clump(SO, tuple(p), (0.32 + rnd.random() * 0.14) * h * (0.42 if zf > 0.4 else 0.5), rnd)


def city():
    """the park (trees, benches, lamps), lamp standards along the street, the omnibus shelter, the cab rank"""
    for k, (x, y) in enumerate(((6, 108), (8, 114), (28, 108), (8, 122), (24, 124), (32, 118), (4, 128), (34, 128))):
        tree(x, y, 0.0, h=8.5 + (k * 37 % 5) * 0.8, seed=k)
    for (x0_, x1_, y) in ((6, 12, 116), (16, 22, 128)):
        bench_row(x0_, x1_, y)
    for x in range(8, 240, 18):
        for y in (132.6, 143.4):
            gas_lamp(x, y, 0.15, h=4.0)
    # the omnibus shelter: a timber shelter with a slated roof
    box(P, "timber", 56, 126.6, 74, 126.85, 0, 2.4)
    for x in range(56, 75, 3):
        box(P, "iron", x - 0.06, 127.9, x + 0.06, 128.0, 0, 2.5, cell=0)
    face(P, "slate", [B(55.8, 126.4, 2.75), B(74.2, 126.4, 2.75), B(74.2, 128.6, 2.45), B(55.8, 128.6, 2.45)], (0, -0.3, 1), cell=0)
    face(P, "timber", [B(55.8, 126.4, 2.73), B(74.2, 126.4, 2.73), B(74.2, 128.6, 2.43), B(55.8, 128.6, 2.43)], (0, 0.3, -1), cell=0)
    sign(65, 126.95, 2.05, "OMNIBUS  ·  CITY  ·  DOCKS", "s", size=0.26, board=False)
    sign(146, 128.6, 2.4, "CAB RANK", "s", size=0.45, post=True)
    # boundary railings (they block movement, not bullets): north edge, east edge, the south pavement's edge
    fence_run((0, 1.0), (240, 1.0), Z_BED)
    fence_run((239.5, 1.0), (239.5, 110), Z_BED)
    fence_run((239.5, 110), (239.5, 150), 0.0)
    fence_run((0, 149.6), (240, 149.6), 0.15)
    fence_run((0.4, 101), (0.4, 150), 0.0)
    fence_run((0.4, 1.0), (0.4, 28), Z_BED)


def fence_run(a, b, z0, h=3.5):
    horiz = abs(a[1] - b[1]) < 1e-6
    s0, s1 = (a[0], b[0]) if horiz else (a[1], b[1])
    n = max(1, int(abs(s1 - s0) / 3))
    for i in range(n + 1):
        s = s0 + (s1 - s0) * i / n
        if horiz:
            box(G, "iron", s - 0.06, a[1] - 0.06, s + 0.06, a[1] + 0.06, z0, z0 + h + 0.2, cell=0)
        else:
            box(G, "iron", a[0] - 0.06, s - 0.06, a[0] + 0.06, s + 0.06, z0, z0 + h + 0.2, cell=0)
    if horiz:
        X0, X1, Y = s0 - 64, s1 - 64, 48 - a[1]
        quad("fence", "fence", (X0, Y, z0), (X1, Y, z0), (X1, Y, z0 + h), (X0, Y, z0 + h), 0)
        box(G, "iron", min(s0, s1), a[1] - 0.04, max(s0, s1), a[1] + 0.04, z0 + h - 0.08, z0 + h, cell=0)
    else:
        X, Y0, Y1 = a[0] - 64, 48 - s0, 48 - s1
        quad("fence", "fence", (X, Y0, z0), (X, Y1, z0), (X, Y1, z0 + h), (X, Y0, z0 + h), 0)
        box(G, "iron", a[0] - 0.04, min(s0, s1), a[0] + 0.04, max(s0, s1), z0 + h - 0.08, z0 + h, cell=0)


# ======================================================================================== period vehicles
class Frame:
    """a vehicle's own axes: u along its length from the back (0) to the front (L), v across (+ left), z up;
    `rect` is its map footprint and `facing` the way its front points (+x −x +y −y)"""
    def __init__(self, rect, facing, z=0.0):
        self.r, self.f, self.z = rect, facing, z
        x0, y0, x1, y1 = rect
        self.L = (x1 - x0) if facing in ("+x", "-x") else (y1 - y0)

    def map(self, u, v):
        x0, y0, x1, y1 = self.r
        if self.f == "+x":
            return (x0 + u, (y0 + y1) / 2 - v)
        if self.f == "-x":
            return (x1 - u, (y0 + y1) / 2 + v)
        if self.f == "+y":
            return ((x0 + x1) / 2 + v, y0 + u)
        return ((x0 + x1) / 2 - v, y1 - u)

    def box(self, mat, u0, u1, v0, v1, z0, z1, cell=0):
        (ax, ay), (bx, by) = self.map(u0, v0), self.map(u1, v1)
        box(P, mat, min(ax, bx), min(ay, by), max(ax, bx), max(ay, by), z0 + self.z, z1 + self.z, cell=cell)

    def wheel(self, u, v, r, w=0.14, mat="loco_black", hub="cream"):
        x, y = self.map(u, v)
        x0, y0, x1, y1 = self.r
        zc = r + self.z
        if self.f in ("+x", "-x"):
            out = 1 if y > (y0 + y1) / 2 else -1
            cyl_y(P, mat, x, y - w / 2, y + w / 2, zc, r, seg=14)
            disc(P, hub, B(x, y + out * (w / 2 + 0.005), zc), (0, -out, 0), r * 0.45, seg=10)
        else:
            out = 1 if x > (x0 + x1) / 2 else -1
            cyl_x(P, mat, x - w / 2, x + w / 2, y, zc, r, seg=14)
            for sg in (-1, 1):
                disc(P, mat, B(x + sg * w / 2, y, zc), (sg, 0, 0), r, seg=14)
            disc(P, hub, B(x + out * (w / 2 + 0.005), y, zc), (out, 0, 0), r * 0.45, seg=10)


def vintage_car(rect, facing, body="maroon", taxi=False, z=0.0):
    """a 1930s motor car (4.5 × 1.8 m): long bonnet with a brass radiator, upright cabin, separate wings,
    running boards, spoked-look wheels with cream hubs, lamps, a spare wheel at the back"""
    F = Frame(rect, facing, z)
    Lv = F.L
    k = Lv / 4.5
    F.box("loco_black", 0.3 * k, 4.2 * k, -0.7, 0.7, 0.32, 0.5)                          # chassis
    F.box(body, 2.65 * k, 4.3 * k, -0.55, 0.55, 0.5, 1.15)                                # bonnet
    F.box("brass", 4.3 * k, 4.4 * k, -0.45, 0.45, 0.45, 1.2)                              # radiator
    F.box(body, 0.25 * k, 2.65 * k, -0.82, 0.82, 0.5, 1.3)                                # cabin body
    F.box("window_dark", 0.35 * k, 2.6 * k, -0.8, 0.8, 1.3, 1.82)
    for (u0, u1) in ((0.25 * k, 0.4 * k), (1.35 * k, 1.5 * k), (2.5 * k, 2.65 * k)):
        F.box(body, u0, u1, -0.82, 0.82, 1.3, 1.85)
    F.box("loco_black" if not taxi else body, 0.2 * k, 2.7 * k, -0.85, 0.85, 1.85, 1.97)  # roof
    for v in (-1, 1):
        F.box("loco_black", 3.1 * k, 4.25 * k, *sorted((v * 0.55, v * 0.95)), 0.72, 0.82)  # front wings
        F.box("loco_black", 0.2 * k, 1.1 * k, *sorted((v * 0.82, v * 0.97)), 0.72, 0.82)  # rear wings
        F.box("loco_black", 1.1 * k, 3.1 * k, *sorted((v * 0.82, v * 0.97)), 0.38, 0.43)  # running board
        F.wheel(3.6 * k, v * 0.78, 0.38)
        F.wheel(0.7 * k, v * 0.78, 0.38)
        x, y = F.map(4.35 * k, v * 0.62)
        cyl(P, "brass", x, y, 0.11, 0.95 + z, 1.18 + z, seg=8)
    F.box("loco_black", 0.05 * k, 0.25 * k, -0.35, 0.35, 0.5, 1.1)
    if taxi:
        F.box("lamp_glass", 1.2 * k, 1.6 * k, -0.15, 0.15, 1.97, 2.12)


def vintage_bus(rect, facing):
    """a single-deck motor omnibus (12 × 3 m): a half cab beside the bonnet, maroon below and cream above,
    a row of windows, a roof rack, an open rear platform"""
    F = Frame(rect, facing)
    Lv = F.L
    F.box("loco_black", 0.4, Lv - 0.3, -1.2, 1.2, 0.45, 0.7)
    F.box("maroon", 0.0, Lv - 1.9, -1.45, 1.45, 0.7, 1.55, cell=1.5)
    F.box("cream", 0.0, Lv - 1.9, -1.45, 1.45, 2.35, 2.75, cell=1.5)
    F.box("window_dark", 0.2, Lv - 2.0, -1.43, 1.43, 1.55, 2.35, cell=1.5)
    F.box("cream", 0.0, 0.2, -1.45, 1.45, 1.55, 2.35)                                          # rear panel
    F.box("window_dark", -0.02, 0.0, -1.0, 1.0, 1.65, 2.25)                                     # rear window
    u = 1.35
    while u < Lv - 2.0:
        F.box("cream", u, u + 0.12, -1.45, 1.45, 1.55, 2.35)
        u += 1.15
    F.box("roof_grey", -0.05, Lv - 1.85, -1.5, 1.5, 2.75, 2.85, cell=1.5)
    for v in (-1.15, 1.15):
        F.box("loco_black", 1.0, Lv - 3.0, v - 0.03, v + 0.03, 2.85, 3.15)
    F.box("maroon", Lv - 1.9, Lv - 0.2, -1.3, -0.1, 0.7, 1.55)                                  # bonnet
    F.box("brass", Lv - 0.2, Lv - 0.1, -1.2, -0.2, 0.65, 1.6)
    F.box("maroon", Lv - 1.9, Lv - 0.4, 0.1, 1.45, 0.7, 1.55)                                  # half cab
    F.box("window_dark", Lv - 1.85, Lv - 0.45, 0.15, 1.4, 1.55, 2.3)
    F.box("cream", Lv - 1.95, Lv - 0.35, 0.05, 1.5, 2.3, 2.6)
    for v in (-1, 1):
        F.wheel(Lv - 2.4, v * 1.2, 0.5, w=0.22)
        F.wheel(2.2, v * 1.2, 0.5, w=0.22)
        F.box("loco_black", Lv - 3.0, Lv - 1.7, *sorted((v * 1.1, v * 1.5)), 1.0, 1.1)
    text(S, "sign_text", "CITY  ·  DOCKS", *F.map(Lv - 1.88, -0.7), 2.55, size=0.14, facing={"+x": "e", "-x": "w", "+y": "s", "-y": "n"}[facing])


def city_vehicles():
    """the forecourt's omnibuses and cabs, motor cars in the cab yard and on the road bridge — the same
    footprints the modern ones had (the same cover)"""
    vintage_bus((52, 128.8, 64, 131.8), "+x")
    vintage_bus((68, 128.8, 80, 131.8), "+x")
    for x in (140, 146, 152):
        vintage_car((x, 129.6, x + 4.5, 131.4), "+x", body="loco_black", taxi=True)
    cars = ["maroon", "loco_green", "loco_black", "cream", "navy_steel", "maroon", "roof_grey", "loco_green"]
    for k, x in enumerate((191, 200, 209, 221, 230)):
        vintage_car((x, 112.2, x + 1.8, 116.7), "+y", body=cars[k])
    for k, x in enumerate((194, 212, 227)):
        vintage_car((x, 125.3, x + 1.8, 129.8), "-y", body=cars[k + 5])
    # the two on the road bridge stand on its deck (+7), not at street level under it
    vintage_car((15.2, 60, 17.0, 64.5), "-y", body="maroon", z=Z_UP)
    vintage_car((19.0, 80, 20.8, 84.5), "+y", body="loco_green", z=Z_UP)


def backdrop():
    """the Victorian city beyond the fences: brick terraces and warehouses with slate roofs and chimneys, a
    church spire, a gasholder, chimney stacks; a hazy skyline"""
    rnd = random.Random(5)

    def block(x0, y0, x1, y1, z0, h, ridge_x=True):
        box(BD, "brick" if rnd.random() < 0.5 else "brick_dark", x0, y0, x1, y1, z0, h, cell=4.0)
        if ridge_x:
            ym = (y0 + y1) / 2
            prism(BD, "slate", [(x0, y0), (x1, y0), (x1, ym), (x0, ym)], h, [h, h, h + 3.5, h + 3.5], cell=0)
            prism(BD, "slate", [(x0, ym), (x1, ym), (x1, y1), (x0, y1)], h, [h + 3.5, h + 3.5, h, h], cell=0)
        else:
            xm = (x0 + x1) / 2
            prism(BD, "slate", [(x0, y0), (xm, y0), (xm, y1), (x0, y1)], h, [h, h + 3.5, h + 3.5, h], cell=0)
            prism(BD, "slate", [(xm, y0), (x1, y0), (x1, y1), (xm, y1)], h, [h + 3.5, h, h, h + 3.5], cell=0)
        for k in range(int((x1 - x0) / 6)):
            cx = x0 + 2 + k * 6 + rnd.random()
            box(BD, "brick_dark", cx, (y0 + y1) / 2 - 0.5, cx + 1.2, (y0 + y1) / 2 + 0.5, h + 2.5, h + 5.0, cell=0)
    for k in range(14):
        x = -20 + k * 20 + rnd.random() * 6
        hgt = 9 + rnd.random() * 12
        block(x, 156 + rnd.random() * 8, x + 12 + rnd.random() * 6, 172 + rnd.random() * 10, 0, hgt)
    for k in range(9):
        x = 10 + k * 26
        block(x, -30 - rnd.random() * 10, x + 20, -6, Z_BED, 7 + rnd.random() * 8)
    for k in range(6):
        y = 0 + k * 26
        block(246, y, 266 + rnd.random() * 10, y + 20, Z_BED, 9 + rnd.random() * 12, ridge_x=False)
        block(-36, y, -12, y + 20, Z_BED, 8 + rnd.random() * 10, ridge_x=False)
    # a church: nave, tower and spire (south-west), a gasholder (north-east), mill chimneys
    box(BD, "far_build", 30, 176, 60, 188, 0, 14, cell=0)
    prism(BD, "slate", [(30, 176), (60, 176), (60, 182), (30, 182)], 14, [14, 14, 20, 20], cell=0)
    prism(BD, "slate", [(30, 182), (60, 182), (60, 188), (30, 188)], 14, [20, 20, 14, 14], cell=0)
    box(BD, "stone", 22, 177, 30, 185, 0, 30, cell=0)
    for (p, q) in (((22, 177), (30, 177)), ((30, 177), (30, 185)), ((30, 185), (22, 185)), ((22, 185), (22, 177))):
        face(BD, "slate", [B(p[0], p[1], 30), B(q[0], q[1], 30), B(26, 181, 52)], ((p[0] + q[0]) / 2 - 26, -((p[1] + q[1]) / 2 - 181), 0.4))
    cyl(BD, "iron", 250, -30, 18, Z_BED, 22, seg=20, caps=True)
    for k in range(8):
        a = 2 * math.pi * k / 8
        box(BD, "iron", 250 + 18.6 * math.cos(a) - 0.3, -30 + 18.6 * math.sin(a) - 0.3, 250 + 18.6 * math.cos(a) + 0.3, -30 + 18.6 * math.sin(a) + 0.3, Z_BED, 26, cell=0)
    for (x, y, h) in ((140, -40, 38), (190, 190, 44), (-40, 70, 34)):
        cyl(BD, "brick_dark", x, y, 1.6, 0, h, seg=10)
        cyl(BD, "brick_dark", x, y, 1.9, h - 1.2, h, seg=10)
    for k in range(10):
        cx = -300 + k * 80 + rnd.random() * 30
        box(BD, "far_build", cx - 30, 232, cx + 30, 250 + rnd.random() * 10, 0, 12 + rnd.random() * 14, cell=0)
    top(BD, "grass", -120, -120, 360, 0, Z_BED - 0.02, cell=0)
    top(BD, "cobbles", -120, 150, 360, 260, -0.02, cell=0)


# ======================================================================================== light fittings
def fittings():
    """the lamps the bake lights (rws_bake.py puts a lamp under each light panel): pendant lanterns in the
    booking hall, the gallery and the north building, the canopy and under the road bridge"""
    for x in range(46, 184, 8):
        for y in range(103, 126, 6):
            if LOBBY_HOLE[0] - 1 < x < LOBBY_HOLE[2] + 1 and LOBBY_HOLE[1] - 1 < y < LOBBY_HOLE[3] + 1:
                continue
            lantern(x, y, Z_UP - 0.4, drop=0.9)
            lantern(x, y, 12.0, drop=1.1)
    for x in range(98, 124, 8):
        for y in (108.0, 116.0):
            lantern(x, y, 12.0, drop=2.6)
    for x in range(42, 184, 8):
        for y in (21.0, 29.0):
            lantern(x, y, Z_UP - 0.4, drop=0.8)
            lantern(x, y, 11.5, drop=0.8)
    for y in range(32, 104, 8):
        lantern(18.0, y, Z_UP - 0.9, drop=0.5)
    for x in range(88, 134, 6):
        lantern(x, 128.5, 6.2, drop=0.6)


# ======================================================================================== gameplay markers
FFA = [(110, 136, 0), (24, 124, 0), (214, 120, 0), (60, 95, 0), (166, 96, 0), (118, 76, 0), (64, 56, 0),
       (172, 56, 0), (140, 37, 0), (75, 66, 7), (64, 112, 7), (104, 28, 7), (116, 70, -7), (96, 110, -7),
       (80, 10, -1.2), (222, 64, -1.2), (218, 94, -1.2), (18, 60, 7), (40, 30, -1.2), (210, 30, -1.2)]


def markers():
    L.empty("mission_start", 110, 136.5, 0.05, coll="RWS_95_Gameplay")
    L.empty("spawn_alpha", 110, 136.5, 0.05, coll="RWS_95_Gameplay")
    L.empty("spawn_bravo", 222, 30, Z_BED + 0.05, coll="RWS_95_Gameplay")
    L.empty("mission_target", 132, 23, 0.05, coll="RWS_95_Gameplay")
    for i, p in enumerate(FFA):
        L.empty(f"spawn_ffa_{i + 1:02d}", p[0], p[1], p[2] + 0.05, coll="RWS_95_Gameplay")


# ======================================================================================== main
def build():
    L.reset_scene()
    ground()
    tracks()
    signals()
    platforms()
    hall_roof()
    station()
    north_building()
    footbridges()
    underground()
    goods_yard()
    depot()
    road_bridge()
    trains()
    platform_props()
    city()
    city_vehicles()
    backdrop()
    fittings()
    objs = L.flush()
    L.weld([o for o in objs if not o.name.startswith(("glass", "fence"))])
    imported_trains()
    markers()
    stats = {}
    for o in [o for o in bpy.data.objects if o.type == "MESH"]:
        c = o.users_collection[0].name
        s = stats.setdefault(c, [0, 0, 0])
        s[0] += 1
        s[1] += len(o.data.vertices)
        s[2] += sum(len(p.vertices) - 2 for p in o.data.polygons)
    print(f"RWS phase {PHASE}:")
    for c in sorted(stats):
        print(f"  {c:28s} meshes {stats[c][0]:3d}  verts {stats[c][1]:7d}  tris {stats[c][2]:7d}")
    print(f"  {'TOTAL':28s} meshes {sum(s[0] for s in stats.values()):3d}  verts {sum(s[1] for s in stats.values()):7d}  tris {sum(s[2] for s in stats.values()):7d}")
    if OUT:
        os.makedirs(os.path.dirname(os.path.abspath(OUT)), exist_ok=True)
        bpy.ops.wm.save_as_mainfile(filepath=os.path.abspath(OUT))
        print("saved", OUT)


build()
