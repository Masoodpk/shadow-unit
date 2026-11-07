# LAST CALL — Port Calder International (PCX). Builds the airport map in Blender, phase by phase.
#
#   /Applications/Blender.app/Contents/MacOS/Blender -b -P scripts/airport/pcx_build.py -- --phase 5 --out scripts/airport/out/pcx.blend
#
# (or in Blender: Scripting tab → Open this file → Run Script; edit PHASE below first.)
#   phase 2  blockout: floors, walls, levels, stairs, tunnel, the playable jet and jet bridge, simple cover
#   phase 3  architecture: Wave ceilings, tree columns, canopy, hangar trusses/doors, apron paint, backdrop
#   phase 4  props + signage + light fittings (replace the phase-2 cover blocks at the same footprints)
#   phase 5  materials: Poly Haven textures instead of flat blockout colours
# Lighting (phase 6) and export (phase 8) are separate scripts: pcx_bake.py, pcx_export.py.
# Layout and numbers: docs/airport/PHASE1-concept.md (map coords: x east 0..128, y south 0..96).
import bpy, math, os, random, sys
from mathutils import Matrix, Vector

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import importlib
import pcx_lib as L
importlib.reload(L)
from pcx_lib import B, box, top, wall, rail, stairs, slab, cyl, cyl_y, prism, quad, text, strut, empty
import pcx_vehicles as V
importlib.reload(V)

PHASE = 5
OUT = None
argv = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []
for i, a in enumerate(argv):
    if a == "--phase":
        PHASE = int(argv[i + 1])
    if a == "--out":
        OUT = argv[i + 1]
L.TEXTURED = PHASE >= 5
SIMPLE = PHASE < 4          # cover as plain blocks until the props pass

T, U, G, A, P, S, BD = "terminal", "upper", "under", "airside", "props", "signs", "backdrop"
L0H = 5.0                   # L0 walls under the upper floor reach its top (closes the slab edge)
L1 = 5.0                    # upper floor level

# ======================================================================================== floors
FOOT = {
    "cargo": ((0, 0, 34, 32), "epoxy", A),
    "hangar": ((46, 0, 82, 24), "epoxy", A),
    "customs": ((0, 58, 22, 86), "floor_tile", T),
    "busgate": ((40, 44, 56, 56), "terrazzo", T),
    "office": ((40, 56, 56, 64), "floor_tile", T),
    "atrium": ((56, 44, 84, 54), "terrazzo", T),
    "security": ((56, 54, 84, 64), "terrazzo", T),
    "makeup": ((84, 44, 128, 62), "epoxy", T),
    "claim": ((84, 62, 128, 86), "floor_tile", T),
    "hall": ((22, 64, 84, 86), "terrazzo", T),
}
CARPARK = (0, 90, 18, 96)
# the playable rectangle (map coords): the terminal block 0–128 × 0–96, plus the Pier B apron (x to 250,
# y 0–40) and the taxiway strip north of the hangar and cargo (y −17 … 0). The fence follows boundary();
# outside it the backdrop starts 0.3 m clear (the voxeliser crops at PLAY ± 0.15: build_all.sh).
PLAY = (0.0, -17.0, 250.0, 96.0)
STAIR_HOLES = [(5, 71.5, 12.5, 73.5), (51, 56.5, 53.5, 63.5)]


def floors():
    for name, (r, mat, coll) in FOOT.items():
        holes = [h for h in STAIR_HOLES if h[0] >= r[0] and h[2] <= r[2] and h[1] >= r[1] and h[3] <= r[3]]
        for c in L.cut(r, holes):
            top(coll, mat, *c, 0.0)
    excl = [v[0] for v in FOOT.values()] + [CARPARK, (0, 44, 0, 44), (0, 86, 0, 86)]
    for c in L.cut((0, 0, 128, 96), excl):
        top("terrain", "asphalt" if (c[1] + c[3]) / 2 > 86 else "concrete", *c, 0.0)
    # the new ground: the Pier B apron, the taxiway strip (asphalt with its yellow centreline), and the
    # unreachable land behind Pier B (inside the crop: it must not be the backdrop's 40 m quads)
    top("terrain", "concrete", 128, 0, 250, 40, 0.0)
    top("terrain", "concrete", 128, 40, 250, 96, -0.01, cell=12)
    top("terrain", "concrete", 0, -17, 250, -14, 0.0)
    top("terrain", "asphalt", 0, -14, 250, -6.2, 0.0)
    top("terrain", "concrete", 0, -6.2, 250, 0, 0.0)
    top("terrain", "marking", 0, -10.2, 250, -9.9, 0.006, cell=0)
    # upper floor (L1): concourse + Gate 14 lounge + mezzanine food court
    slab(U, "terrazzo", (40, 44, 84, 56), 4.7, L1, holes=[(62, 44, 78, 54), (40.5, 45, 42.5, 53.5)], under="plaster")
    slab(U, "carpet", (84, 44, 128, 56), 4.7, L1, holes=[(125.5, 45, 127.5, 53.5)], under="plaster")
    slab(U, "terrazzo", (40, 56, 84, 68), 4.7, L1, under="plaster")


# ======================================================================================== walls
def walls():
    # --- cargo terminal (h 9)
    wall(A, "corrugated", (0, 0), (0, 32), 0, 9)
    wall(A, "corrugated", (0, 0), (34, 0), 0, 9)
    wall(A, "corrugated", (34, 0), (34, 32), 0, 9, doors=[(16.5, 19.5, 3.5)])
    wall(A, "corrugated", (0, 32), (34, 32), 0, 9, doors=[(6.5, 9.5, 3.5), (16.5, 19.5, 3.5), (26.5, 29.5, 3.5)])
    # --- hangar 3 (h 14)
    wall(A, "metal_sheet", (46, 0), (46, 24), 0, 14, doors=[(12.5, 15.5, 2.4)])
    wall(A, "metal_sheet", (82, 0), (82, 24), 0, 14, doors=[(12.5, 15.5, 2.4)])
    wall(A, "metal_sheet", (46, 0), (82, 0), 0, 14)
    wall(A, "metal_sheet", (46, 24), (82, 24), 0, 14, doors=[(56, 72, 10)])
    # --- customs (h 4.5) + its three rooms
    wall(T, "paint", (0, 58), (0, 86), 0, 4.5)
    wall(T, "paint", (0, 58), (22, 58), 0, 4.5, doors=[(10.5, 13.5, 2.4)])
    wall(T, "paint", (0, 86), (22, 86), 0, 4.5, doors=[(10.5, 13.5, 2.4)])
    wall(T, "paint", (22, 58), (22, 64), 0, 4.5)
    for a, b in (((0, 68), (16, 68)), ((0, 77), (16, 77)), ((16, 58), (16, 63)), ((16, 81), (16, 86))):
        wall(T, "plaster", a, b, 0, 4.5, t=0.2)
    # --- bus gate 12A, security office, atrium, security, make-up, claim, hall
    wall(T, "plaster", (40, 44), (56, 44), 0, L0H, doors=[(46.5, 49.5, 2.4)])
    wall(T, "plaster", (40, 44), (40, 56), 0, L0H, doors=[(49, 52, 2.4)])
    wall(T, "plaster", (56, 44), (56, 56), 0, L0H, doors=[(48, 52, 3.0)])
    wall(T, "plaster", (40, 56), (56, 56), 0, L0H, doors=[(46, 49, 2.4)])
    wall(T, "paint", (40, 56), (40, 64), 0, L0H)
    wall(T, "paint", (56, 56), (56, 64), 0, L0H, doors=[(59, 61.5, 2.4)])
    wall(T, "plaster", (40, 64), (56, 64), 0, L0H, doors=[(46, 49, 2.4)])
    wall(T, None, (56, 44), (84, 44), 0, 9, glassy=True, doors=[(77, 80, 2.6)])
    wall(T, "plaster", (84, 44), (84, 64), 0, L0H)
    wall(T, "plaster", (56, 64), (84, 64), 0, L0H, doors=[(58, 82, L0H)])
    wall(T, "paint", (84, 44), (128, 44), 0, L0H, doors=[(91, 94, 3.0), (119, 122, 3.0)])
    wall(T, "paint", (128, 44), (128, 62), 0, L0H)
    wall(T, "paint", (84, 62), (128, 62), 0, L0H, doors=[(94, 98, 1.5), (112, 116, 1.5), (121, 124, 2.4)])
    wall(T, "plaster", (128, 62), (128, 86), 0, 6)
    wall(T, None, (84, 86), (128, 86), 0, 6, glassy=True, doors=[(101, 107, 2.6)])
    wall(T, "plaster", (84, 64), (84, 86), 0, 12, doors=[(71, 77, 3.0)])
    wall(T, "plaster", (22, 64), (22, 86), 0, 12, doors=[(76.5, 79.5, 2.4)])
    wall(T, "plaster", (22, 64), (40, 64), 0, 12)
    wall(T, None, (22, 86), (84, 86), 0, 12, glassy=True, doors=[(29, 33, 2.6), (48, 52, 2.6), (67, 71, 2.6)])
    # --- upper floor walls
    wall(U, None, (40, 44), (56, 44), L1, 9, glassy=True)
    wall(U, None, (84, 44), (128, 44), L1, 9, glassy=True, doors=[(93.5, 96.5, 2.6)])
    wall(U, None, (40, 44), (40, 56), L1, 9, glassy=True)
    wall(U, None, (40, 56), (40, 68), L1, 12, glassy=True)
    wall(U, "plaster", (128, 44), (128, 56), L1, 9)
    wall(U, "plaster", (84, 56), (128, 56), L1, 9)
    wall(U, "plaster", (84, 56), (84, 64), L1, 12)
    wall(U, None, (40, 56), (84, 56), 9, 12, glassy=True)   # clerestory between the two roofs
    # balustrades: mezz over the hall, the atrium void, stair holes
    rail(U, (40, 68), (76, 68), L1)
    rail(U, (80, 68), (84, 68), L1)
    for a, b in (((62, 54), (64, 54)), ((66.5, 54), (73.5, 54)), ((76, 54), (78, 54)), ((62, 44.3), (62, 54)), ((78, 44.3), (78, 54))):
        rail(U, a, b, L1)
    rail(U, (42.5, 45), (42.5, 53.5), L1, glassy=False)
    rail(U, (40.5, 45), (42.5, 45), L1, glassy=False)
    rail(U, (125.5, 45), (125.5, 53.5), L1, glassy=False)
    rail(U, (125.5, 45), (127.5, 45), L1, glassy=False)
    rail(T, (51, 56.5), (51, 62.5), 0, glassy=False)
    rail(T, (53.5, 56.5), (53.5, 62.5), 0, glassy=False)
    rail(T, (51, 56.5), (53.5, 56.5), 0, glassy=False)
    rail(T, (6.5, 71.5), (12.5, 71.5), 0, glassy=False)
    rail(T, (6.5, 73.5), (12.5, 73.5), 0, glassy=False)
    rail(T, (12.5, 71.5), (12.5, 73.5), 0, glassy=False)
    # car-park block (closed) south-west
    box("terrain", "block", *CARPARK, 0, 8)


def roofs_flat():
    # (the check-in hall, 22–84 × 64–86, has the glazed vault from phase 3: architecture() → vault())
    if PHASE < 3:
        box(T, "plaster", 22, 64, 84, 86, 12, 12.4)
    box(T, "plaster", 40, 56, 84, 64, 12, 12.4)
    box(U, "plaster", 40, 44, 128, 56, 9, 9.4)
    box(T, "plaster", 84, 62, 128, 86, 6, 6.3)
    box(T, "plaster", 84, 56, 128, 62, 4.7, L1)
    box(T, "paint", 0, 58, 22, 86, 4.5, 4.8)
    box(A, "metal_sheet", 0, 0, 34, 32, 9, 9.4)
    box(A, "metal_sheet", 46, 0, 82, 24, 14, 14.5)
    if PHASE < 3:
        box("terrain", "white_steel", 22, 86, 128, 90.5, 7, 7.3)
    for x in range(26, 127, 12):
        cyl("terrain", "white_steel", x, 89.5, 0.3, 0, 7.2, seg=10)
        cyl("terrain", "navy_steel", x, 89.5, 0.36, 0, 0.8, seg=10)


# ======================================================================================== stairs + tunnel
def vertical():
    stairs(T, "metal_plate", (40.5, 45, 42.5, 53.5), 0, L1, "+y", sides=True)          # Gate 12
    stairs(T, "metal_plate", (125.5, 45, 127.5, 53.5), 0, L1, "+y", sides=True)        # Gate 14
    stairs(T, "dark_steel", (64, 46, 66.5, 54), 0, L1, "+y", sides=True)               # atrium escalators
    stairs(T, "dark_steel", (73.5, 46, 76, 54), 0, L1, "+y", sides=True)
    stairs(T, "dark_steel", (76, 68, 77.9, 76), 0, L1, "-y", sides=True)               # hall → mezz
    stairs(T, "dark_steel", (78.1, 68, 80, 76), 0, L1, "-y", sides=True)
    stairs(G, "metal_plate", (5, 71.5, 12.5, 73.5), -4.5, 0, "-x")                     # customs ↓ tunnel
    stairs(G, "metal_plate", (51, 56.5, 53.5, 63.5), -4.5, 0, "+y")                    # security office ↓ tunnel
    # cargo office mezzanine (+4) and its two stairs
    slab(A, "metal_plate", (3, 5, 15.5, 13.5), 3.7, 4.0)
    stairs(A, "metal_plate", (13.5, 13.5, 15.5, 20.1), 0, 4.0, "-y", sides=True)
    stairs(A, "metal_plate", (3, 13.5, 5, 20.1), 0, 4.0, "-y", sides=True)
    wall(A, None, (5, 13.5), (13.5, 13.5), 4.0, 6.4, glassy=True, pane=1.7, row=2.4)
    wall(A, None, (15.5, 5), (15.5, 13.5), 4.0, 6.4, glassy=True, pane=1.7, row=2.4)
    # hangar catwalk (+4.5), stairs both ends
    slab(A, "metal_plate", (79, 3, 81.8, 23), 4.2, 4.5)
    slab(A, "metal_plate", (76.8, 3, 79, 5.5), 4.2, 4.5)
    slab(A, "metal_plate", (76.8, 21.5, 79, 23), 4.2, 4.5)
    stairs(A, "metal_plate", (76.8, 5.5, 78.8, 13), 0, 4.5, "-y", sides=True)
    stairs(A, "metal_plate", (76.8, 14, 78.8, 21.5), 0, 4.5, "+y", sides=True)
    rail(A, (79, 5.5), (79, 21.5), 4.5, glassy=False)
    rail(A, (76.8, 3), (76.8, 5.5), 4.5, glassy=False)
    rail(A, (76.8, 21.5), (76.8, 23), 4.5, glassy=False)


UG = [(5, 71, 28, 74), (28, 68, 38, 77), (38, 71, 56.5, 74), (53.5, 56.5, 56.5, 71), (51, 53.5, 56.5, 56.5), (51, 56.5, 53.5, 63.5)]


def tunnel():
    Z0, Z1 = -4.5, -1.5
    for r in UG:
        top(G, "epoxy", *r, Z0)
        if r != (51, 56.5, 53.5, 63.5):
            for c in L.cut(r, [STAIR_HOLES[0]] if r == UG[0] else []):
                top(G, "block", *c, Z1, down=True)
    # walls: boundary of the union on a 0.5 m grid, merged into runs
    inside = lambda x, y: any(r[0] <= x <= r[2] and r[1] <= y <= r[3] for r in UG)
    step = 0.5
    edges = {"n": {}, "s": {}, "w": {}, "e": {}}
    for r in UG:
        for i in range(int((r[2] - r[0]) / step)):
            for j in range(int((r[3] - r[1]) / step)):
                cx, cy = r[0] + (i + 0.5) * step, r[1] + (j + 0.5) * step
                if not inside(cx, cy - step):
                    edges["n"].setdefault(round(cy - step / 2, 3), []).append(cx)
                if not inside(cx, cy + step):
                    edges["s"].setdefault(round(cy + step / 2, 3), []).append(cx)
                if not inside(cx - step, cy):
                    edges["w"].setdefault(round(cx - step / 2, 3), []).append(cy)
                if not inside(cx + step, cy):
                    edges["e"].setdefault(round(cx + step / 2, 3), []).append(cy)
    for d, lines in edges.items():
        for fixed, cs in lines.items():
            cs = sorted(set(cs))
            runs, s0, prev = [], cs[0], cs[0]
            for c in cs[1:]:
                if c - prev > step + 1e-6:
                    runs.append((s0, prev))
                    s0 = c
                prev = c
            runs.append((s0, prev))
            for a, b in runs:
                a, b = a - step / 2, b + step / 2
                t = 0.3
                if d == "n":
                    box(G, "block", a, fixed - t, b, fixed, Z0, Z1)
                elif d == "s":
                    box(G, "block", a, fixed, b, fixed + t, Z0, Z1)
                elif d == "w":
                    box(G, "block", fixed - t, a, fixed, b, Z0, Z1)
                else:
                    box(G, "block", fixed, a, fixed + t, b, Z0, Z1)
    # shafts between the tunnel ceiling and the ground around both stair holes
    for (x0, y0, x1, y1) in STAIR_HOLES:
        L.rims(G, "block", x0, y0, x1, y1, Z1, 0.0, inward=True)
    # pipes along the tunnel
    if PHASE >= 3:
        L.cyl_x(G, "grey_steel", 12.5, 28, 71.35, -2.0, 0.12)
        L.cyl_x(G, "grey_steel", 38, 53.5, 71.35, -2.0, 0.12)
        L.cyl_y(G, "grey_steel", 56.15, 56.5, 71, -2.0, 0.12, caps=False)


# ======================================================================================== aircraft
class Plane:
    """a narrow-body jet in a local frame: v along the fuselage (tail 0 → nose 37), u to the side, w up.
    heading 0 = nose to map south (+y). interior=True: cabin floor, inner shell, seats and door holes."""

    def __init__(self, ox, oy, heading=0.0, coll="aircraft", interior=False):
        self.ox, self.oy, self.h, self.coll, self.interior = ox, oy, heading, coll, interior

    def P(self, u, v, w):
        c, s = math.cos(self.h), math.sin(self.h)
        x = self.ox + u * c - v * s
        y = self.oy + u * s + v * c
        return B(x, y, w)

    def q(self, mat, a, b, c, d, cell=0):
        # local (u, v, w) points; the map's y flip mirrors handedness, so the order is reversed here
        quad(self.coll, mat, self.P(*d), self.P(*c), self.P(*b), self.P(*a), cell)

    def lbox(self, mat, u0, u1, v0, v1, w0, w1):
        p = self.P
        c = [(u0, v0, w0), (u1, v0, w0), (u1, v1, w0), (u0, v1, w0), (u0, v0, w1), (u1, v0, w1), (u1, v1, w1), (u0, v1, w1)]
        f = [(4, 5, 6, 7), (0, 3, 2, 1), (0, 1, 5, 4), (1, 2, 6, 5), (2, 3, 7, 6), (3, 0, 4, 7)]
        for (a, b, cc, d) in f:
            self.q(mat, c[a], c[b], c[cc], c[d])

    @staticmethod
    def radius(v):
        if v < 5.0:
            return 0.45 + 1.55 * math.sin(v / 5.0 * math.pi / 2)
        if v > 31.5:
            k = min(1.0, (v - 31.5) / 5.5)
            return max(0.15, 2.0 * math.sqrt(max(0.0, 1 - k * k)))
        return 2.0

    @staticmethod
    def zc(v):
        if v < 5.0:
            return 4.4 + 0.9 * (1 - v / 5.0) ** 2
        if v > 31.5:
            return 4.4 - 0.35 * min(1.0, (v - 31.5) / 5.5)
        return 4.4

    # door openings (v range along the body, angle range around it): sill at the cabin floor (3.4 m),
    # 2.4 m clear — the jet-bridge door, the rear airstair door, and the over-wing exits both sides
    HOLES = [(30.5, 31.9, 135, 210), (5.5, 6.9, 135, 210), (17.5, 18.7, 135, 210), (17.5, 18.7, -30, 45)]

    def build(self):
        st = sorted({0.0, 0.6, 1.4, 2.4, 3.6, 5.0, 36.9, 36.4, 35.6, 34.5, 33.2, 32.3, *[x for h in self.HOLES for x in h[:2]], *[5.0 + i * 1.3 for i in range(21)]})
        st = [v for v in st if 0 <= v <= 36.9]
        seg = 24
        for i in range(len(st) - 1):
            va, vb = st[i], st[i + 1]
            for k in range(seg):
                ta, tb = k * 360 / seg, (k + 1) * 360 / seg
                tm = (ta + tb) / 2
                vm = (va + vb) / 2
                hole = self.interior and any(h[0] <= vm <= h[1] and (h[2] <= tm <= h[3] or h[2] <= tm - 360 <= h[3]) for h in self.HOLES)
                if hole:
                    continue
                sm = math.sin(math.radians(tm))
                mat = "plane_white"
                cm = math.cos(math.radians(tm))
                if 6 < vm < 31 and 0.22 < sm < 0.42:
                    mat = "window_dark"
                elif 34.1 < vm < 35.4 and 0.28 < sm < 0.66 and abs(cm) < 0.85:
                    mat = "window_dark"                                      # cockpit windscreen
                elif 3 < vm < 34 and 0.02 < sm < 0.16:
                    mat = "coral"
                elif sm < -0.62:
                    mat = "plane_grey"
                pt = lambda v, t, dr=0.0: ((self.radius(v) - dr) * math.cos(math.radians(t)), v, self.zc(v) + (self.radius(v) - dr) * math.sin(math.radians(t)))
                # (skin facing out: the bake lights the side the face looks at — inward-facing, it baked black)
                self.q(mat, pt(va, tb), pt(va, ta), pt(vb, ta), pt(vb, tb))
                if self.interior and 4.0 < vm < 33.5 and sm > -0.55:
                    # inner shell (cabin wall/ceiling), facing in
                    self.q("plaster", pt(va, ta, 0.12), pt(va, tb, 0.12), pt(vb, tb, 0.12), pt(vb, ta, 0.12))
        # wings: low, swept, with dihedral; thick at the root, thin at the tip
        R_U, T_U = 1.9, 17.9                       # root (at the fuselage side) and tip, across
        R_LE, R_TE, T_LE, T_TE = 21.6, 15.2, 13.3, 11.7
        R_BOT, R_TOP, T_BOT, T_TOP = 2.9, 3.35, 3.85, 3.97
        f = lambda u: (abs(u) - R_U) / (T_U - R_U)
        le = lambda u: R_LE + (T_LE - R_LE) * f(u)
        te = lambda u: R_TE + (T_TE - R_TE) * f(u)
        bot = lambda u: R_BOT + (T_BOT - R_BOT) * f(u)
        top_ = lambda u: R_TOP + (T_TOP - R_TOP) * f(u)
        for sgn in (-1, 1):
            ur, ut = R_U * sgn, T_U * sgn
            self._prism("plane_white", [(ur, R_TE), (ur, R_LE), (ut, T_LE), (ut, T_TE)], [R_BOT, R_BOT, T_BOT, T_BOT], [R_TOP, R_TOP, T_TOP, T_TOP])
            # the wing reaches into the body (no gap under the fuselage side)
            self._prism("plane_white", [(0.0, R_TE), (0.0, R_LE), (ur, R_LE), (ur, R_TE)], [R_BOT] * 4, [R_TOP] * 4)
            # blended winglet, swept back
            self._prism("teal", [(ut - 0.06 * sgn, T_TE), (ut - 0.06 * sgn, T_LE), (ut + 0.06 * sgn, T_LE), (ut + 0.06 * sgn, T_TE)], [T_BOT] * 4, [T_TOP] * 4,
                        top_pts=[(ut - 0.04 * sgn, T_TE - 0.6), (ut - 0.04 * sgn, T_TE + 0.5), (ut + 0.04 * sgn, T_TE + 0.5), (ut + 0.04 * sgn, T_TE - 0.6)], top_w=5.7)
            # flap-track fairings under the trailing edge
            for uu in (4.2, 8.0, 11.8):
                u = uu * sgn
                self.lbox("plane_grey", u - 0.16, u + 0.16, te(u) - 0.9, te(u) + 1.3, bot(u) - 0.32, bot(u) + 0.02)
            # the engine: under the wing, mostly ahead of it, on a pylon that runs up into the wing
            ue = 5.7 * sgn
            vf, vr, wc = 23.3, 18.8, 2.0
            self._lathe("plane_grey", ue, wc, [(vf, 0.92), (vf - 0.35, 1.05), (vf - 1.6, 1.06), (vr + 1.0, 0.98), (vr, 0.72)], seg=18)
            self._disc("dark_steel", ue, wc, vf - 0.3, 0.88, seg=18, facing=1)       # fan face, set back in the lip
            self._lathe("dark_steel", ue, wc, [(vf - 0.05, 0.22), (vf - 0.3, 0.3)], seg=10)  # spinner
            self._lathe("grey_steel", ue, wc, [(vr, 0.6), (vr - 0.9, 0.28)], seg=14)   # exhaust cone
            self._prism("plane_white", [(ue - 0.17, vr + 0.1), (ue - 0.17, vf - 1.2), (ue + 0.17, vf - 1.2), (ue + 0.17, vr + 0.1)], [wc + 0.95] * 4, [wc + 0.95] * 4,
                        top_pts=[(ue - 0.14, te(ue) + 2.2), (ue - 0.14, le(ue) + 1.0), (ue + 0.14, le(ue) + 1.0), (ue + 0.14, te(ue) + 2.2)], top_w=(bot(ue) + top_(ue)) / 2)
            # horizontal stabiliser (swept, tapering)
            self._prism("plane_white", [(0.4 * sgn, 1.8), (0.4 * sgn, 5.0), (6.5 * sgn, 2.2), (6.5 * sgn, 0.6)], [5.6, 5.6, 5.85, 5.85], [5.85, 5.85, 5.95, 5.95])
        # belly fairing (where the wing meets the body)
        self.lbox("plane_grey", -2.05, 2.05, 13.6, 23.0, 2.45, 3.0)
        self._prism("teal", [(-0.18, 0.8), (-0.18, 6.5), (0.18, 6.5), (0.18, 0.8)], [5.5] * 4, [6.0] * 4, top_pts=[(-0.12, 0.0), (-0.12, 2.6), (0.12, 2.6), (0.12, 0.0)], top_w=12.5)
        self.lbox("dark_steel", -0.16, 0.16, -0.08, 0.02, 5.05, 5.37)               # APU exhaust
        # landing gear: twin-wheel nose leg; a twin-wheel main leg each side under the wing root, braced
        self.lbox("dark_steel", -0.1, 0.1, 33.9, 34.1, 0.4, 2.6)
        self.lbox("grey_steel", -0.16, 0.16, 33.8, 34.2, 1.3, 2.0)
        for uw in (-0.27, 0.27):
            self._wheel("rubber", uw, 34.0, 0.38, 0.38, 0.2)
        for sgn in (-1, 1):
            ug = 2.95 * sgn
            self.lbox("dark_steel", ug - 0.13, ug + 0.13, 16.1, 16.4, 0.55, bot(ug) + 0.05)
            self.lbox("grey_steel", ug - 0.17, ug + 0.17, 16.0, 16.5, 1.2, 2.1)
            self._strut("dark_steel", (ug, 16.25, 1.5), (1.75 * sgn, 17.6, 2.75), 0.06)  # side brace up into the bay
            self.lbox("dark_steel", ug - 0.5, ug + 0.5, 16.17, 16.33, 0.5, 0.66)        # axle
            for du in (-0.4, 0.4):
                self._wheel("rubber", ug + du, 16.25, 0.58, 0.58, 0.32)
        if self.interior:
            self.cabin()

    def _prism(self, mat, pts, bw, tw, top_pts=None, top_w=None):
        tp = top_pts or pts
        T_ = [(p[0], p[1], (top_w if top_w is not None else tw[i])) for i, p in enumerate(tp)]
        Bm = [(p[0], p[1], bw[i]) for i, p in enumerate(pts)]
        # orientation: make the outline counter-clockwise in (u, v)
        area = sum(pts[i][0] * pts[(i + 1) % 4][1] - pts[(i + 1) % 4][0] * pts[i][1] for i in range(4))
        order = [0, 1, 2, 3] if area > 0 else [3, 2, 1, 0]
        T_ = [T_[i] for i in order]
        Bm = [Bm[i] for i in order]
        self.q(mat, T_[0], T_[1], T_[2], T_[3], 2.0)
        self.q(mat, Bm[0], Bm[3], Bm[2], Bm[1])
        for i in range(4):
            j = (i + 1) % 4
            self.q(mat, Bm[i], Bm[j], T_[j], T_[i])

    def _lathe(self, mat, u, w, prof, seg=16):
        """a body of revolution along v at (u, w): prof = [(v, radius), …] from the front back"""
        for i in range(len(prof) - 1):
            (va, ra), (vb, rb) = prof[i], prof[i + 1]
            for k in range(seg):
                a, b = 2 * math.pi * k / seg, 2 * math.pi * (k + 1) / seg
                pa = lambda r, t: (u + r * math.cos(t), va, w + r * math.sin(t))
                self.q(mat, (u + ra * math.cos(a), va, w + ra * math.sin(a)), (u + ra * math.cos(b), va, w + ra * math.sin(b)),
                       (u + rb * math.cos(b), vb, w + rb * math.sin(b)), (u + rb * math.cos(a), vb, w + rb * math.sin(a)))
                self.q(mat, (u + rb * math.cos(a), vb, w + rb * math.sin(a)), (u + rb * math.cos(b), vb, w + rb * math.sin(b)),
                       (u + ra * math.cos(b), va, w + ra * math.sin(b)), (u + ra * math.cos(a), va, w + ra * math.sin(a)))

    def _disc(self, mat, u, w, v, r, seg=16, facing=1):
        for k in range(seg):
            a, b = 2 * math.pi * k / seg, 2 * math.pi * (k + 1) / seg
            pa, pb = (u + r * math.cos(a), v, w + r * math.sin(a)), (u + r * math.cos(b), v, w + r * math.sin(b))
            self.q(mat, (u, v, w), pa, pb, pb) if facing > 0 else self.q(mat, (u, v, w), pb, pa, pa)
            self.q(mat, (u, v, w), pb, pa, pa) if facing > 0 else self.q(mat, (u, v, w), pa, pb, pb)

    def _wheel(self, mat, u, v, w, r, width, seg=12):
        """a tyre: a short cylinder across the body (axis along u), centre (u, v, w)"""
        for k in range(seg):
            a, b = 2 * math.pi * k / seg, 2 * math.pi * (k + 1) / seg
            p = lambda du, t: (u + du, v + r * math.cos(t), w + r * math.sin(t))
            self.q(mat, p(-width / 2, a), p(-width / 2, b), p(width / 2, b), p(width / 2, a))
            self.q(mat, p(width / 2, a), p(width / 2, b), p(-width / 2, b), p(-width / 2, a))
        for du in (-width / 2, width / 2):
            for k in range(seg):
                a, b = 2 * math.pi * k / seg, 2 * math.pi * (k + 1) / seg
                c = (u + du, v, w)
                self.q("dark_steel", c, (u + du, v + r * 0.6 * math.cos(a), w + r * 0.6 * math.sin(a)), (u + du, v + r * 0.6 * math.cos(b), w + r * 0.6 * math.sin(b)), (u + du, v + r * 0.6 * math.cos(b), w + r * 0.6 * math.sin(b)))

    def _strut(self, mat, a, b, r):
        strut(self.coll, mat, self.P(*a), self.P(*b), r)

    def _cyl(self, mat, u, v0, v1, w, r, seg=12):
        for k in range(seg):
            a, b = 2 * math.pi * k / seg, 2 * math.pi * (k + 1) / seg
            pa = (u + r * math.cos(a), w + r * math.sin(a))
            pb = (u + r * math.cos(b), w + r * math.sin(b))
            self.q(mat, (pa[0], v0, pa[1]), (pa[0], v1, pa[1]), (pb[0], v1, pb[1]), (pb[0], v0, pb[1]))
        self.q("dark_steel", (u - r * 0.8, v1, w - r * 0.8), (u + r * 0.8, v1, w - r * 0.8), (u + r * 0.8, v1, w + r * 0.8), (u - r * 0.8, v1, w + r * 0.8))

    def cabin(self):
        F = 3.4
        self.lbox("carpet", -1.75, 1.75, 4.6, 33.4, 3.2, F)
        self.lbox("plaster", -1.9, 1.9, 4.3, 4.6, F, 6.4)           # aft bulkhead
        self.lbox("plaster", -1.9, -0.45, 33.4, 33.7, F, 6.4)        # cockpit wall (door in the middle, shut)
        self.lbox("plaster", 0.45, 1.9, 33.4, 33.7, F, 6.4)
        self.lbox("plaster", -0.45, 0.45, 33.4, 33.7, F, 6.4)
        # galleys: half-height blocks aft and forward of the seats, an aisle between
        for v0, v1 in ((7.2, 8.2), (28.6, 29.6)):
            self.lbox("grey_steel", -1.7, -0.55, v0, v1, F, F + 1.9)
            self.lbox("grey_steel", 0.55, 1.7, v0, v1, F, F + 1.9)
        v = 9.0
        while v < 28.0:
            if not (16.6 < v < 19.6):
                for (u0, u1) in ((-1.7, -0.6), (0.6, 1.7)):
                    self.lbox("seat_blue", u0, u1, v, v + 0.5, F, F + 0.45)
                    self.lbox("seat_blue", u0, u1, v, v + 0.12, F + 0.45, F + 1.1)
            v += 0.86
        for vv in (8.4, 27.8):                                        # galley trolleys, parked: low cover
            self.lbox("grey_steel", 0.7, 1.1, vv, vv + 0.8, F, F + 1.0)


def aircraft():
    Plane(106, 4.5, 0.0, "aircraft", interior=True).build()
    # jet bridge: concourse door (y 44, L1) → rotunda → sloping tunnel → front door (z 3.4)
    ac = "aircraft"
    box(ac, "grey_steel", 93.5, 39.5, 96.5, 44, 4.8, L1)
    box(ac, "grey_steel", 93, 34.5, 97, 39.5, 4.8, L1)
    wall(ac, "grey_steel", (93.5, 39.5), (93.5, 44), L1, 7.6, t=0.15)
    wall(ac, "grey_steel", (96.5, 39.5), (96.5, 44), L1, 7.6, t=0.15)
    box(ac, "grey_steel", 93.4, 39.5, 96.6, 44, 7.6, 7.8)
    wall(ac, "grey_steel", (93, 34.5), (93, 39.5), L1, 7.6, t=0.15)
    wall(ac, "grey_steel", (93, 34.5), (97, 34.5), L1, 7.6, t=0.15)
    wall(ac, "grey_steel", (93, 39.5), (97, 39.5), L1, 7.6, t=0.15, doors=[(93.5, 96.5, 2.5)])
    wall(ac, "grey_steel", (97, 34.5), (97, 39.5), L1, 7.6, t=0.15, doors=[(34.9, 36.5, 2.5)])
    box(ac, "grey_steel", 92.9, 34.4, 97.1, 39.6, 7.6, 7.8)
    x0, x1, ya, yb = 97.0, 104.4, 34.9, 36.5
    za, zb = L1, 3.4
    Pp = lambda x, y, z: B(x, y, z)
    quad(ac, "metal_plate", Pp(x0, yb, za), Pp(x1, yb, zb), Pp(x1, ya, zb), Pp(x0, ya, za), 1.5)          # floor
    quad(ac, "grey_steel", Pp(x0, ya, za - 0.2), Pp(x1, ya, zb - 0.2), Pp(x1, yb, zb - 0.2), Pp(x0, yb, za - 0.2), 1.5)
    quad(ac, "grey_steel", Pp(x0, ya, za + 2.5), Pp(x1, ya, zb + 2.5), Pp(x1, yb, zb + 2.5), Pp(x0, yb, za + 2.5), 1.5)  # roof
    quad(ac, "grey_steel", Pp(x0, yb, za + 2.5), Pp(x1, yb, zb + 2.5), Pp(x1, ya, zb + 2.5), Pp(x0, ya, za + 2.5), 1.5)
    for y, flip in ((ya, False), (yb, True)):
        a, b, c, d = Pp(x0, y, za), Pp(x1, y, zb), Pp(x1, y, zb + 2.5), Pp(x0, y, za + 2.5)
        quad(ac, "grey_steel", a, b, c, d, 1.5)
        quad(ac, "grey_steel", b, a, d, c, 1.5)
    cyl(ac, "dark_steel", 100, 35.7, 0.28, 0, 4.3)
    box(ac, "dark_steel", 99.2, 35.0, 100.8, 36.4, 0, 0.7)
    cyl(ac, "dark_steel", 95, 41.5, 0.3, 0, 4.8)
    # rear airstair truck (west side, rear door v 5.5–6.9 → map y 10–11.4)
    stairs(ac, "metal_plate", (98.4, 9.9, 104.1, 11.5), 0, 3.4, "+x", sides=True)


# ======================================================================================== cover / props
def cover():
    """the cover the fights are built around. SIMPLE (phase 2-3) = grey blocks; phase 4 = the real props"""
    blk = lambda *r: box(P, "grey_steel", *r)
    # --- check-in hall: 3 islands (A, B, C), info desk, seating
    for x in (47, 56, 65):
        if SIMPLE:
            blk(x, 71, x + 3, 82, 0, 1.05)
            blk(x + 1.2, 74, x + 1.8, 79, 1.05, 2.5)
        else:
            checkin_island(x)
    if SIMPLE:
        blk(27, 76, 34, 78.6, 0, 1.1)
    else:
        box(P, "wood", 27, 76, 34, 78.6, 0, 1.0)
        box(P, "white_steel", 26.9, 75.9, 34.1, 78.7, 1.0, 1.1)
        box(P, "screen", 28, 77.2, 33, 77.4, 1.1, 1.6)
    for y in (82.5, 84.5):
        bench_row(24, 40, y)
    # --- security: 4 X-ray lanes
    for x in (60, 66, 72, 78):
        if SIMPLE:
            blk(x - 0.6, 56.5, x + 0.6, 61.5, 0, 1.9)
        else:
            box(P, "plane_grey", x - 0.6, 57.5, x + 0.6, 60.5, 0, 1.9)
            box(P, "rubber", x - 0.6, 56.3, x + 0.6, 57.5, 0, 0.95)
            box(P, "rubber", x - 0.6, 60.5, x + 0.6, 62.6, 0, 0.95)
            box(P, "dark_steel", x - 0.65, 58.4, x + 0.65, 59.6, 1.9, 2.0)
        ax = x + 3
        box(P, "white_steel", ax - 0.75, 58.85, ax - 0.6, 59.15, 0, 2.2)
        box(P, "white_steel", ax + 0.6, 58.85, ax + 0.75, 59.15, 0, 2.2)
        box(P, "white_steel", ax - 0.75, 58.85, ax + 0.75, 59.15, 2.1, 2.25)
        box(P, "grey_steel", x + 0.6, 58.95, ax - 0.75, 59.05, 0, 1.0)
        box(P, "grey_steel", ax + 0.75, 58.95, x + 5.4, 59.05, 0, 1.0)
    # --- security office: CCTV desks + lockdown console
    box(P, "dark_steel", 40.4, 57, 42.4, 63, 0, 0.75)
    box(P, "screen", 40.3, 57.2, 40.5, 62.8, 0.9, 1.8)
    # (the console stands west of the hall door, x 46–49: in the doorway it shut the office off from the hall)
    box(P, "dark_steel", 42.6, 62.2, 45.6, 63.4, 0, 1.0)
    box(P, "screen", 42.8, 63.3, 45.4, 63.5, 1.0, 1.5)
    # --- bus gate 12A benches
    for y in (50.2, 52.7):
        bench_row(43, 51, y)
    # --- concourse: Gate 12 + Gate 14 seating, gate desks, duty free, food court
    for y in (47.5, 50.5):
        bench_row(44, 58, y, z=L1)
    for y in (47.0, 50.0, 53.0):
        bench_row(99, 121, y, z=L1)
    box(P, "wood", 86, 44.8, 91, 46, L1, L1 + 1.05)                     # Gate 14 desk
    box(P, "wood", 52, 54.0, 56, 55.2, L1, L1 + 1.05)                   # Gate 12 desk
    if SIMPLE:
        blk(82, 46, 88, 51, L1, L1 + 3)
    else:
        box(P, "plaster", 82, 46, 88, 51, L1, L1 + 3.0, skip=("s",))
        box(P, "plaster", 82, 50.7, 84.5, 51, L1, L1 + 3.0)
        box(P, "plaster", 86.5, 50.7, 88, 51, L1, L1 + 3.0)
        for yy in (47.2, 48.8):
            box(P, "wood", 83, yy, 87, yy + 0.6, L1, L1 + 1.6)
    for (x0, x1) in ((42, 50), (66, 74)):
        if SIMPLE:
            blk(x0, 57, x1, 60, L1, L1 + 3)
        else:
            box(P, "wood", x0, 59.0, x1, 60.0, L1, L1 + 1.1)                 # food counter
            box(P, "plaster", x0, 57, x1, 58.6, L1, L1 + 3.0)               # kitchen
            box(P, "sign_dark", x0, 58.6, x1, 58.8, L1 + 2.4, L1 + 3.0)
    rnd = random.Random(4)
    for (tx, ty) in ((46, 63), (52, 61.5), (57, 64.5), (62, 62), (68, 64), (74, 62), (80, 64.5), (54, 66.5)):
        box(P, "white_steel", tx - 0.5, ty - 0.5, tx + 0.5, ty + 0.5, L1 + 0.72, L1 + 0.76)
        box(P, "grey_steel", tx - 0.05, ty - 0.05, tx + 0.05, ty + 0.05, L1, L1 + 0.72)
    for (px, py) in ((58, 57.5), (78.5, 58.2), (61, 66.8)):
        box(P, "plaster", px - 0.6, py - 0.6, px + 0.6, py + 0.6, L1, L1 + 1.1)       # planters
        box(P, "grass", px - 0.5, py - 0.5, px + 0.5, py + 0.5, L1 + 1.1, L1 + 1.5)
    # --- baggage claim: carousels + feed belts, luggage
    for cx in (96, 114):
        box(P, "dark_steel", cx - 6, 70.7, cx + 6, 75.3, 0, 0.5)
        box(P, "grey_steel", cx - 5, 71.6, cx + 5, 74.4, 0.5, 0.95)
        box(P, "rubber", cx - 0.6, 62, cx + 0.6, 70.7, 0, 0.75)
        for k in range(6):
            bx = cx - 5 + rnd.random() * 9
            by = rnd.choice((70.9, 74.4))
            box(P, "luggage", bx, by, bx + 0.7, by + 0.45, 0.5, 0.95)
    for y in (79, 81):
        box(P, "grey_steel", 118, y, 126, y + 0.9, 0, 1.0)                  # trolley lines
    # --- make-up: belt loop through the two flaps, a long belt, carts, a tug
    box(P, "rubber", 95.4, 51.4, 96.6, 62, 0, 0.75)
    box(P, "rubber", 95.4, 51.4, 114.6, 52.6, 0, 0.75)
    box(P, "rubber", 113.4, 51.4, 114.6, 62, 0, 0.75)
    box(P, "rubber", 96, 47.4, 118, 48.6, 0, 0.75)
    for (cx, cy) in ((100, 55), (104, 55), (108.5, 57.5), (89, 52), (121, 50)):
        if SIMPLE:
            bag_cart(cx, cy)
        else:
            MODEL_SPOTS["bagcart"].append((cx, cy, 0.0))
    if SIMPLE:
        box(P, "gse_yellow", 101, 57.8, 103.6, 59.6, 0, 1.5)
    else:
        MODEL_SPOTS["tug"].append((102.3, 58.7, math.pi / 2))
    # --- customs: inspection tables + scanner
    box(P, "white_steel", 4, 61, 10, 62.5, 0, 0.9)
    box(P, "plane_grey", 4, 80, 6, 84, 0, 1.8)
    box(P, "white_steel", 9, 80.5, 13, 82, 0, 0.9)
    # --- curb: bus, taxis, bollards
    # (shaped vehicles from pcx_vehicles.py on the blocks' footprints; the bus's doors face the kerb)
    if SIMPLE:
        blk(84, 89.5, 96, 92.5, 0, 3.2)
    else:
        V.bus(P, (84, 89.5, 96, 92.5), "+x", door_side=-1)
    for (tx, ty) in ((28, 90.1), (34, 90.1), (104, 90.1)):
        if SIMPLE:
            blk(tx, ty, tx + 4.5, ty + 1.8, 0, 1.5)
        else:
            V.sedan(P, (tx, ty, tx + 4.5, ty + 1.8), "+x")
    for x in range(24, 127, 3):
        if not (29 <= x <= 33 or 48 <= x <= 52 or 67 <= x <= 71 or 101 <= x <= 107):
            cyl(P, "dark_steel", x, 86.7, 0.12, 0, 0.9, seg=8)
    # --- apron (mid): ULD stack, stair truck, cart train, tug, belt loader, GPU
    uld(43, 26)
    uld(45, 26)
    uld(43, 28)
    uld(43, 26, 1)
    if SIMPLE:
        vehicle(51, 34, 53, 40, 2.5, "gse_yellow", "dark_steel")
    else:
        V.stair_truck(P, (51, 34, 53, 40), "-y")
    if SIMPLE:
        for x in (58, 62, 66, 70):
            bag_cart(x + 1.5, 30, horiz=True)
        vehicle(66, 37, 68.4, 40, 1.5, "gse_yellow", "window_dark")
        vehicle(76, 35, 78, 42, 1.2, "gse_yellow", "rubber")
        vehicle(84, 27, 87, 30, 1.4, "white_steel", "grey_steel")
    else:
        # a tug pulling four baggage carts; another tug; a ULD dolly pair by the jet's hold; a crew cart
        MODEL_SPOTS["tug"] += [(55.6, 30, math.pi / 2), (67.2, 38.5, 0.0)]
        MODEL_SPOTS["bagcart"] += [(x + 1.5, 30, math.pi / 2) for x in (58, 62, 66, 70)]
        MODEL_SPOTS["uld_dolly"] += [(77, 37.0, 0.0)]
        MODEL_SPOTS["dolly"] += [(77, 40.2, 0.0)]
        MODEL_SPOTS["cart6"] += [(85.5, 28.5, 0.0)]
    # --- apron (east): fuel truck, GPU, belt loader, ULD at the wing's trailing edge
    if SIMPLE:
        vehicle(118, 28, 121, 37, 3.0, "white_steel", "teal")
    else:
        V.fuel_truck(P, (118, 28, 121, 37), "-y")
    if SIMPLE:
        vehicle(111, 38, 113.5, 40, 1.4, "gse_yellow", "grey_steel")
        vehicle(92, 30, 94, 35, 1.2, "gse_yellow", "rubber")
    else:
        MODEL_SPOTS["cart6"] += [(112.2, 39.0, math.pi / 2)]
        MODEL_SPOTS["uld_dolly"] += [(93, 31.2, 0.0)]
        MODEL_SPOTS["dolly"] += [(93, 34.3, 0.0)]
    # --- terminal buggies, parked by the gates (upper floor)
    if not SIMPLE:
        MODEL_SPOTS["buggy"] += [(48, 54.6, math.pi / 2, L1), (106, 55.0, math.pi / 2, L1)]
    # --- the Pier B apron: at each parked CRJ a baggage train, a ULD dolly pair at the hold, a crew cart,
    # and ULD stacks; a cart train waiting between the piers
    for cx in (180, 230):
        if not SIMPLE:
            MODEL_SPOTS["tug"] += [(cx + 9.0, 8.0, math.pi / 2)]
            MODEL_SPOTS["bagcart"] += [(cx + 13.0 + 3.4 * k, 8.0, math.pi / 2) for k in range(3)]
            MODEL_SPOTS["uld_dolly"] += [(cx - 6.5, 27.5, 0.0), (cx - 6.5, 24.4, 0.0)]
            MODEL_SPOTS["cart6"] += [(cx + 7.0, 33.5, math.pi / 2)]
        uld(cx - 16, 4)
        uld(cx - 14, 4)
        uld(cx - 16, 4, 1)
    if not SIMPLE:
        MODEL_SPOTS["tug"] += [(140.0, 30.0, math.pi / 2)]
        MODEL_SPOTS["bagcart"] += [(144.0 + 3.4 * k, 30.0, math.pi / 2) for k in range(4)]
        MODEL_SPOTS["cart6"] += [(150.0, 14.0, 0.0), (205.0, -2.5, math.pi / 2)]
    for (x, y) in ((136, 6), (138, 6), (158, 20)):
        uld(x, y)
    uld(96.5, 15.5)
    # --- cargo yard: semi-trailer, ULD stacks, a shipping container, crates
    if SIMPLE:
        vehicle(5, 36, 8, 50, 4.0, "white_steel", "dark_steel")
        vehicle(5.2, 50.2, 7.8, 53.5, 3.2, "coral", "window_dark")
    else:
        V.semi(P, (5, 36, 8, 53.5), "+y")
    for (x, y) in ((25, 42), (27, 42), (29, 42)):
        uld(x, y)
    uld(27, 42, 1)
    box(P, "teal", 29, 49, 31.6, 55, 0, 2.6)
    box(P, "wood", 12, 52, 14, 54, 0, 1.1)
    # --- cargo terminal: racks, ULD bays, forklift
    for y in (7.5, 12, 16.5, 21, 25.5):
        if SIMPLE:
            blk(16, y, 31, y + 1, 0, 4)
        else:
            rack(16, y, 31, y + 1)
    for (x, y) in ((5, 22), (9, 22), (5, 26)):
        uld(x, y)
    if SIMPLE:
        vehicle(11, 17, 13, 20, 2.0, "gse_yellow", "dark_steel")
    else:
        V.forklift(P, (11, 17, 13, 20), "-y")
    # --- hangar: tool chests, engine stand, work platform
    box(P, "coral", 48, 17, 52, 19, 0, 1.1)
    box(P, "grey_steel", 48, 11, 50, 15, 0, 1.8)
    box(P, "gse_yellow", 68.5, 16.5, 71, 19, 0, 2.6)
    # --- Sparks (electrical room): cabinets on the walls, a transformer in the middle
    box(P, "grey_steel", 28.4, 68.3, 37.6, 69.0, -4.5, -2.3)
    box(P, "grey_steel", 28.4, 76.0, 37.6, 76.7, -4.5, -2.3)
    box(P, "dark_steel", 31, 71.5, 35, 74.5, -4.5, -2.7)


def checkin_island(x):
    box(P, "wood", x, 71, x + 3, 82, 0, 1.0)
    box(P, "white_steel", x - 0.05, 70.95, x + 3.05, 82.05, 1.0, 1.05)
    box(P, "rubber", x + 0.4, 71.5, x + 1.0, 81.5, 1.05, 1.1)           # bag belts
    box(P, "rubber", x + 2.0, 71.5, x + 2.6, 81.5, 1.05, 1.1)
    box(P, "plaster", x + 1.2, 73, x + 1.8, 80, 1.05, 2.6)              # back panel
    box(P, "sign_dark", x + 1.1, 73, x + 1.9, 80, 2.6, 3.2)
    for k in range(4):
        box(P, "screen", x - 0.02, 72.5 + k * 2.4, x + 0.1, 73.3 + k * 2.4, 1.05, 1.35)


def bench_row(x0, x1, y, z=0.0):
    """linked gate seating (the old bench's footprint, y … y + 0.7): wooden pads on a steel beam, teal
    backs at +y, navy armrests between the seats, a pair of feet every 2.4 m"""
    n = max(1, int((x1 - x0) / 0.6))
    pitch = (x1 - x0) / n
    # (a clip block over the row, 1.25 m: movement only — voxel-map --soft=clip — so no one stands on the
    # seat pads, and the AI's nav graph has no nodes on them)
    box("clip", "clip", x0 - 0.02, y, x1 + 0.02, y + 0.7, z, z + 1.25, cell=0)
    box(P, "dark_steel", x0, y + 0.3, x1, y + 0.4, z + 0.32, z + 0.4, cell=0)
    for i in range(n):
        sa, sb = x0 + i * pitch + 0.03, x0 + (i + 1) * pitch - 0.03
        box(P, "wood", sa, y + 0.05, sb, y + 0.56, z + 0.4, z + 0.47, cell=0)
        box(P, "seat_teal", sa, y + 0.56, sb, y + 0.66, z + 0.47, z + 0.95, cell=0)
    for i in range(n + 1):
        xa = x0 + i * pitch
        box(P, "navy_steel", xa - 0.03, y + 0.12, xa + 0.03, y + 0.6, z + 0.47, z + 0.66, cell=0)
    k = max(2, int((x1 - x0) / 2.4) + 1)
    for i in range(k):
        xa = min(x1 - 0.1, x0 + 0.1 + i * (x1 - x0 - 0.2) / (k - 1))
        box(P, "dark_steel", xa - 0.04, y + 0.1, xa + 0.04, y + 0.6, z, z + 0.32, cell=0)

def bag_cart(cx, cy, horiz=False):
    w, d = (2.6, 1.5) if horiz else (1.5, 2.6)
    box(P, "grey_steel", cx - w / 2, cy - d / 2, cx + w / 2, cy + d / 2, 0.35, 0.45)
    box(P, "luggage", cx - w / 2 + 0.15, cy - d / 2 + 0.15, cx + w / 2 - 0.15, cy + d / 2 - 0.15, 0.45, 1.25)
    box(P, "grey_steel", cx - w / 2, cy - d / 2, cx + w / 2, cy + d / 2, 1.3, 1.4)
    box(P, "rubber", cx - w / 2 + 0.1, cy - d / 2 + 0.1, cx + w / 2 - 0.1, cy + d / 2 - 0.1, 0, 0.35)


def uld(x, y, level=0):
    """LD3 container 1.53 × 2.0 × 1.63 m; level 1 stacks on top"""
    z0 = level * 1.63
    box(P, "grey_steel" if SIMPLE else "plane_grey", x, y, x + 1.9, y + 1.53, z0, z0 + 1.63)
    if not SIMPLE:
        box(P, "dark_steel", x - 0.02, y + 0.3, x + 1.92, y + 0.36, z0 + 0.1, z0 + 1.5)


def vehicle(x0, y0, x1, y1, h, body, accent, car=False):
    """a ground vehicle as a block with a cab/glass band and wheels: cover first, detail second"""
    if SIMPLE:
        box(P, "grey_steel", x0, y0, x1, y1, 0, h)
        return
    box(P, body, x0, y0, x1, y1, 0.35, h * (0.62 if car else 0.85))
    long_x = (x1 - x0) >= (y1 - y0)
    if car:
        if long_x:
            box(P, accent, x0 + 1.0, y0 + 0.1, x1 - 1.0, y1 - 0.1, h * 0.62, h)
        else:
            box(P, accent, x0 + 0.1, y0 + 1.0, x1 - 0.1, y1 - 1.0, h * 0.62, h)
    else:
        box(P, accent, x0, y0, x1, y1, h * 0.85, h)
    for (wx, wy) in ((x0 + 0.5, y0), (x1 - 0.9, y0), (x0 + 0.5, y1 - 0.2), (x1 - 0.9, y1 - 0.2)) if long_x else ((x0, y0 + 0.5), (x0, y1 - 0.9), (x1 - 0.2, y0 + 0.5), (x1 - 0.2, y1 - 0.9)):
        box(P, "rubber", wx, wy, wx + (0.4 if long_x else 0.2), wy + (0.2 if long_x else 0.4), 0, 0.6)


def rack(x0, y, x1, y1):
    # the uprights stand 3 cm proud of the shelf boards on every side, so no board face shares a plane with
    # an upright face (they used to, and z-fought into flickering black/coral bands on the yellow posts)
    for x in (x0, (x0 + x1) / 2, x1 - 0.12):
        box(P, "gse_yellow", x - 0.03, y - 0.03, x + 0.15, y1 + 0.03, 0, 4.0, cell=1.0)
    for z in (0.15, 1.45, 2.75):
        box(P, "coral", x0 + 0.02, y + 0.02, x1 - 0.02, y1 - 0.02, z, z + 0.1)
        rnd = random.Random(int(y * 10 + z * 3))
        x = x0 + 0.2
        while x < x1 - 1.2:
            w = 0.9 + rnd.random() * 0.4
            box(P, "wood" if rnd.random() < 0.6 else "luggage", x, y + 0.08, x + w, y1 - 0.08, z + 0.1, z + 0.6 + rnd.random() * 0.6)
            x += w + 0.25


# ======================================================================================== phase 3
def wave(coll, rect, base, amp, wl, thick=0.25, mat_under="wood", mat_top="white_steel"):
    """the signature ceiling: an undulating slatted surface (wavelength wl along x)"""
    x0, y0, x1, y1 = rect
    nx = max(2, int((x1 - x0) / 1.0))
    ny = max(1, int((y1 - y0) / 2.0))
    z = lambda x, y: base + amp * math.sin(2 * math.pi * (x - 22) / wl) + 0.25 * amp * math.sin(2 * math.pi * y / 37)
    for i in range(nx):
        for j in range(ny):
            xa, xb = x0 + (x1 - x0) * i / nx, x0 + (x1 - x0) * (i + 1) / nx
            ya, yb = y0 + (y1 - y0) * j / ny, y0 + (y1 - y0) * (j + 1) / ny
            p = lambda x, y, dz=0: B(x, y, z(x, y) + dz)
            quad(coll, mat_under, p(xa, ya), p(xa, yb), p(xb, yb), p(xb, ya), 0)
            quad(coll, mat_top, p(xa, ya, thick), p(xb, ya, thick), p(xb, yb, thick), p(xa, yb, thick), 0)


def tree_column(coll, x, y, h_trunk, h_roof, spread=3.0, z0=0.0):
    """white trunk on a navy collar, four branches up to the roof (h_roof: a height, or z(x, y) of the roof)"""
    cyl(coll, "white_steel", x, y, 0.42, z0, h_trunk, seg=12, caps=False)
    cyl(coll, "navy_steel", x, y, 0.5, z0, z0 + 0.9, seg=12)
    X, Y, _ = B(x, y)
    for dx, dy in ((1, 1), (1, -1), (-1, 1), (-1, -1)):
        tx, ty = x + dx * spread, y + dy * spread * 0.7
        top_z = h_roof(tx, ty) - 0.12 if callable(h_roof) else h_roof
        strut(coll, "white_steel", (X, Y, h_trunk - 0.2), B(tx, ty, top_z), 0.14)


# the check-in hall's vault: springs from the 12 m walls at y 64 and 86, 5.5 m rise, axis east–west
VAULT = (22.0, 64.0, 84.0, 86.0, 12.0, 5.5)


def vault_z(x, y):
    x0, y0, x1, y1, zs, rise = VAULT
    t = min(1.0, max(0.0, (y - y0) / (y1 - y0)))
    return zs + rise * math.sin(math.pi * t)


def vault():
    """a glazed barrel vault (the reference: a steel space-frame over timber arches): white steel arches
    every ~4 m, timber arches between them, purlins and diagonals, glass between — solid bands at the
    springing — and white end walls. Its glazing is "roof_roof_glass": the bake lets the sun through it."""
    x0, y0, x1, y1, zs, rise = VAULT
    nb, ns = 15, 14                          # bays along x, segments across the span
    xs = [x0 + (x1 - x0) * i / nb for i in range(nb + 1)]
    ys = [y0 + (y1 - y0) * j / ns for j in range(ns + 1)]
    P_ = lambda x, y, dz=0.0: B(x, y, vault_z(x, y) + dz)
    for i in range(nb):
        for j in range(ns):
            xa, xb, ya, yb = xs[i], xs[i + 1], ys[j], ys[j + 1]
            solid = j < 2 or j >= ns - 2
            mat = "white_steel" if solid else "roof_glass"
            coll = T if solid else "roof"
            quad(coll, mat, P_(xa, ya), P_(xb, ya), P_(xb, yb), P_(xa, yb), 0)
            quad(coll, mat, P_(xa, yb), P_(xb, yb), P_(xb, ya), P_(xa, ya), 0)
            if not solid:
                strut(T, "white_steel", P_(xa, ya, -0.06), P_(xb, yb, -0.06), 0.035)
    for i, x in enumerate(xs):
        for j in range(ns):
            # main arches (steel), and timber arches hung a little lower halfway between
            strut(T, "white_steel", P_(x, ys[j], -0.12), P_(x, ys[j + 1], -0.12), 0.11)
            if i < nb:
                xm = (x + xs[i + 1]) / 2
                strut(T, "wood", P_(xm, ys[j], -0.4), P_(xm, ys[j + 1], -0.4), 0.09)
    for y in ys:
        strut(T, "white_steel", P_(x0, y, -0.08), P_(x1, y, -0.08), 0.05)
    # end walls: white, from the 12 m wall tops up to the curve, both faces
    for xe in (x0, x1):
        for j in range(ns):
            ya, yb = ys[j], ys[j + 1]
            a, b_, c, d = B(xe, ya, zs), B(xe, yb, zs), B(xe, yb, vault_z(xe, yb)), B(xe, ya, vault_z(xe, ya))
            quad(T, "plaster", a, b_, c, d, 0)
            quad(T, "plaster", b_, a, d, c, 0)
    # a navy ring beam along both springings
    for y in (y0, y1):
        box(T, "navy_steel", x0, y - 0.25, x1, y + 0.25, zs - 0.5, zs + 0.05, cell=0)

def architecture():
    # Wave ceilings under the flat roofs; and the Wave canopy over the departures curb
    vault()
    wave(T, (40, 56.15, 84, 64), 10.9, 0.7, 31)
    wave(U, (40, 44.15, 128, 55.85), 8.2, 0.45, 31)
    wave("terrain", (22, 86, 128, 90.5), 7.35, 0.4, 31, thick=0.35)
    for (x, y) in ((30, 69), (30, 81), (42, 84), (54, 67.5), (62.5, 84.5), (71, 67.5)):
        tree_column(T, x, y, 7.5, vault_z, spread=2.6)
    for x in range(48, 127, 14):
        if not (60 < x < 80):
            tree_column(U, x, 50, L1 + 1.6, 7.9, spread=1.8, z0=L1)
            box(U, "white_steel", x - 0.42, 49.58, x + 0.42, 50.42, L1, L1 + 0.05)
    # hangar: roof trusses, sliding door leaves parked either side of the opening
    for y in range(3, 24, 5):
        box(A, "dark_steel", 46.2, y - 0.15, 81.8, y + 0.15, 12.6, 13.4, cell=0)
        for x in range(48, 82, 6):
            strut(A, "dark_steel", B(x, y, 12.6), B(x + 3, y, 13.4), 0.06)
    for (x0, x1) in ((47, 56.2), (71.8, 81)):
        box(A, "metal_sheet", x0, 24.2, x1, 24.6, 0, 10.4)
    box(A, "teal", 46, 23.9, 82, 24.4, 10.4, 11.2)
    # cargo: dock shelters around the three dock doors
    for x in (6.5, 16.5, 26.5):
        box(A, "rubber", x - 0.35, 32.15, x, 32.6, 0, 3.9)
        box(A, "rubber", x + 3, 32.15, x + 3.35, 32.6, 0, 3.9)
        box(A, "rubber", x - 0.35, 32.15, x + 3.35, 32.6, 3.5, 3.9)
    # apron paint: stand lead-in line, stop bar, apron edge lines, hatched no-park boxes
    pl = lambda *r: top("terrain", "marking", *r, 0.012, cell=0)
    pl(105.85, 0.5, 106.15, 43.5)
    for cx in (180, 230):
        pl(cx - 0.15, 0.5, cx + 0.15, 38.5)
        pl(cx - 5, 38.6, cx + 5, 38.9)
    pl(128.5, 39.0, 249.5, 39.2)
    pl(100, 41.8, 112, 42.1)
    pl(36, 33.9, 88, 34.1)
    pl(36, 43.0, 128, 43.2)
    for x in range(40, 86, 4):
        top("terrain", "line_red", x, 41.0, x + 1.5, 42.6, 0.012, cell=0)
    for x in range(24, 126, 6):
        top("terrain", "line_white", x, 93.0, x + 3, 93.2, 0.012, cell=0)
    for x0 in (29, 48, 67, 101):
        for k in range(5):
            top("terrain", "line_white", x0 + k * 0.9, 87.2, x0 + k * 0.9 + 0.5, 89.0, 0.012, cell=0)
    backdrop()


def backdrop():
    """everything past the fence: airfield, runway, the tower, other piers, the city. Low-poly, unreachable."""
    x0, y0, x1, y1 = PLAY
    hole = (x0 - 0.3, y0 - 0.3, x1 + 0.3, y1 + 0.3)
    for c in L.cut((-500, -420, 640, 520), [(-130, -6, 330, 112), hole]):
        top(BD, "grass", *c, -0.03, cell=60)
    # (0.3 m clear of the playable area: the voxeliser crops at its edge and must not pick these up)
    for c in L.cut((-130, -6, 330, 112), [hole]):
        top(BD, "concrete" if c[3] <= 96 else "asphalt", *c, -0.01, cell=40)
    for r in ((hole[0], hole[1], hole[2], y0), (hole[0], y1, hole[2], hole[3]), (hole[0], y0, x0, y1), (x1, y0, hole[2], y1)):
        top(BD, "concrete", *r, -0.012, cell=0)
    top(BD, "asphalt", -500, -36, 640, -18, 0.0, cell=60)
    for x in range(-480, 620, 40):
        top(BD, "line_white", x, -27.2, x + 22, -26.8, 0.005, cell=0)
    for c in L.cut((-500, -14, 640, -6.2), [hole]):
        top(BD, "asphalt", *c, 0.0, cell=60)
    for c in L.cut((-500, -10.2, 640, -9.9), [hole]):
        top(BD, "marking", *c, 0.006, cell=0)
    # control tower, west of the cargo terminal
    cyl(BD, "plaster", -40, 22, 3.2, 0, 52, seg=16)
    cyl(BD, "white_steel", -40, 22, 6.0, 52, 53, seg=16)
    cyl(BD, "tower_glass", -40, 22, 5.6, 53, 57.5, seg=16, caps=False)
    cyl(BD, "white_steel", -40, 22, 6.2, 57.5, 58.6, seg=16)
    cyl(BD, "dark_steel", -40, 22, 0.15, 58.6, 66, seg=6)
    # other buildings: Pier B to the east, maintenance hangars to the west, a car park south
    for (a, b) in ((140, 250.6), (250.6, 320)):
        box(BD, "far_build", a, 40, b, 82, 0, 14, cell=0)
        box(BD, "white_steel", a, 40, b, 82, 14, 15, cell=0)
    for (a, b) in ((140, 250), (251, 320)):
        L.quad(BD, "window_dark", B(a, 39.97, 5.2), B(b, 39.97, 5.2), B(b, 39.97, 9.6), B(a, 39.97, 9.6), 0)
        L.quad(BD, "navy_steel", B(a, 39.96, 9.6), B(b, 39.96, 9.6), B(b, 39.96, 10.2), B(a, 39.96, 10.2), 0)
    for cx in (180, 230):
        # (the CRJ's forward door: port side, ~4 m behind the nose at y 38.2 — sill ~1.8 m)
        bx0, bx1 = cx + 1.0, cx + 3.6
        box(BD, "grey_steel", bx0, 34.6, bx1, 40, 1.9, 4.5, cell=0)
        box(BD, "navy_steel", bx0 - 0.05, 34.4, bx1 + 0.05, 34.6, 1.9, 4.5, cell=0)
        cyl(BD, "dark_steel", cx + 2.3, 36.0, 0.25, 0, 1.9, seg=10)
        box(BD, "dark_steel", cx + 1.4, 35.6, cx + 3.2, 36.4, 0, 0.6, cell=0)
    box(BD, "metal_sheet", -125, -2, -55, 40, 0, 20, cell=0)
    box(BD, "teal", -125, -2, -55, 40, 20, 21, cell=0)
    box(BD, "block", -20, 118, 150, 176, 0, 14, cell=0)
    for z in (3.5, 7.0, 10.5):
        box(BD, "dark_steel", -20.2, 117.8, 150.2, 176.2, z, z + 0.8, cell=0)
    rnd = random.Random(11)
    for i in range(46):
        a = math.radians(140 + rnd.random() * 260)
        dist = 260 + rnd.random() * 240
        cx, cy = 64 + math.cos(a) * dist, 48 + math.sin(a) * dist
        if cy < 120:
            continue
        w, d, h = 18 + rnd.random() * 30, 16 + rnd.random() * 26, 20 + rnd.random() * 90
        box(BD, "far_build", cx - w / 2, cy - d / 2, cx + w / 2, cy + d / 2, 0, h, cell=0)
    for k in range(7):
        cx = -420 + k * 150 + rnd.random() * 60
        prism(BD, "far_build", [(cx - 120, -420), (cx + 120, -420), (cx + 60, -380), (cx - 60, -380)], 0, [0, 0, 26 + rnd.random() * 22, 26], cell=0)
    # parked and taxiing traffic: CityJet CRJ-900s (models/crj900.glb, CC BY 4.0 — CityJet Training on Sketchfab)
    crj([(180, 2, 0.0), (230, 2, 0.0), (236, -8.5, math.pi / 2)])


# models placed by spots (map x, y, heading[, floor z]) — heading 0 = the model's length along map y.
# file, which of its meshes (a name prefix, "!x" leaves x out), length in metres, decimate to (ratio)
MODELS = {
    "bagcart":   ("baggage_cart.glb", None, 2.9, 1.0),
    "tug":       ("baggage_tug_set.glb", "21.1.BaggageTruck", 3.0, 0.2),
    "uld_dolly": ("baggage_tug_set.glb", "21.2.BaggageTruck", 2.8, 0.2),
    "dolly":     ("baggage_tug_set.glb", "21.3.BaggageTruck", 2.8, 0.3),
    "buggy":     ("terminal_buggy.glb", "!Ventilation", 2.5, 0.12),
    "cart6":     ("airside_cart.glb", None, 4.08, 0.12),
}
MODEL_SPOTS = {k: [] for k in MODELS}


def _proto(kind):
    """the model as one mesh: the meshes it's made of joined, decimated, laid along +Y (Blender), centred on
    its footprint with its wheels at z 0, at its real length"""
    file, pick, length, ratio = MODELS[kind]
    before = set(bpy.data.objects)
    bpy.ops.import_scene.gltf(filepath=os.path.join(L.HERE, "models", file))
    new = [o for o in bpy.data.objects if o not in before]
    keep = []
    for o in new:
        ok = o.type == "MESH" and "Collider" not in o.name
        if ok and pick:
            ok = (pick[1:] not in o.name) if pick.startswith("!") else o.name.startswith(pick)
        if ok:
            o.data = o.data.copy()
            o.data.transform(o.matrix_world)
            keep.append(o)
    for o in new:
        if o not in keep:
            bpy.data.objects.remove(o)
    for o in keep:
        o.parent = None
        o.matrix_world = Matrix.Identity(4)
    with bpy.context.temp_override(active_object=keep[0], selected_editable_objects=keep):
        bpy.ops.object.join()
    ob = keep[0]
    if ratio < 1.0:
        m = ob.modifiers.new("dec", "DECIMATE")
        m.ratio = ratio
        with bpy.context.temp_override(object=ob, active_object=ob):
            bpy.ops.object.modifier_apply(modifier=m.name)
    vs = [v.co for v in ob.data.vertices]
    lo = Vector([min(v[i] for v in vs) for i in range(3)])
    hi = Vector([max(v[i] for v in vs) for i in range(3)])
    M = Matrix.Translation((-(lo.x + hi.x) / 2, -(lo.y + hi.y) / 2, -lo.z))
    if (hi.x - lo.x) > (hi.y - lo.y):
        M = Matrix.Rotation(math.pi / 2, 4, "Z") @ M
    k = length / max(hi.x - lo.x, hi.y - lo.y)
    ob.data.transform(Matrix.Scale(k, 4) @ M)
    for mat in ob.data.materials:
        if mat and not mat.name.startswith("pcx_m_"):
            mat.name = "pcx_m_" + kind + "_" + mat.name
    return ob


def models():
    """every MODEL_SPOTS spot: one joined mesh per kind ("props_model_<kind>", PCX_50_Props), so each kind is
    one draw call per material; the bake lights them and the voxeliser gives them their real shapes"""
    for kind, spots in MODEL_SPOTS.items():
        if not spots:
            continue
        src = _proto(kind)
        copies = []
        for sp in spots:
            x, y, h = sp[:3]
            z = sp[3] if len(sp) > 3 else 0.0
            ob = src.copy()
            ob.data = src.data.copy()
            ob.data.transform(Matrix.Translation(Vector(B(x, y, z))) @ Matrix.Rotation(-h, 4, "Z"))
            bpy.context.scene.collection.objects.link(ob)
            copies.append(ob)
        for c in src.users_collection:
            c.objects.unlink(src)
        bpy.data.objects.remove(src)
        with bpy.context.temp_override(active_object=copies[0], selected_editable_objects=copies):
            bpy.ops.object.join()
        ob = copies[0]
        ob.name = ob.data.name = "props_model_" + kind
        for c in ob.users_collection:
            c.objects.unlink(ob)
        L.collection(L.COLL_NAMES[P]).objects.link(ob)
        print(f"model {kind}: {len(spots)} placed, {sum(len(p.vertices) - 2 for p in ob.data.polygons)} tris")


CRJ_LEN = 36.2   # a CRJ-900 is 36.2 m long; the file's model is 3.652 units, nose at its origin, tail towards +Y


def crj(spots):
    """the CRJ-900 model at each (tail x, tail y, heading) — heading as Plane's: 0 = nose to map south.
    One joined mesh, its own texture; past the fence, so it's scenery only (lit by the bake like the rest)."""
    before = set(bpy.data.objects)
    bpy.ops.import_scene.gltf(filepath=os.path.join(L.HERE, "models", "crj900.glb"))
    new = [o for o in bpy.data.objects if o not in before]
    src = next(o for o in new if o.type == "MESH")
    src.data.transform(src.matrix_world)
    for o in new:
        if o is not src:
            bpy.data.objects.remove(o)
    src.parent = None
    src.matrix_world = Matrix.Identity(4)
    k = CRJ_LEN / 3.652
    copies = []
    for (ox, oy, h) in spots:
        ob = src.copy()
        ob.data = src.data.copy()
        # nose direction in Blender for map heading h: (-sin h, -cos h); the model's nose looks down -Y
        tail = Vector(B(ox, oy, 0))
        nose_dir = Vector((-math.sin(h), -math.cos(h), 0))
        ob.matrix_world = Matrix.Translation(tail + nose_dir * CRJ_LEN) @ Matrix.Rotation(-h, 4, "Z") @ Matrix.Scale(k, 4)
        ob.data.transform(ob.matrix_world)
        ob.matrix_world = Matrix.Identity(4)
        bpy.context.scene.collection.objects.link(ob)
        copies.append(ob)
    bpy.data.objects.remove(src)
    with bpy.context.temp_override(active_object=copies[0], selected_editable_objects=copies):
        bpy.ops.object.join()
    ob = copies[0]
    ob.name = "backdrop_crj900"
    ob.data.name = "backdrop_crj900"
    ob.data.materials[0].name = "pcx_crj900"
    for c in ob.users_collection:
        c.objects.unlink(ob)
    L.collection(L.COLL_NAMES[BD]).objects.link(ob)


def boundary():
    """perimeter fence: posts + a mesh named 'fence' (blocks movement, not bullets: voxel-map --soft=fence)"""
    x0, y0, x1, _ = PLAY
    runs = [((0, 32), (0, 58)), ((0, 86), (0, 90)), ((128, 86), (128, 96)), ((18, 96), (128, 96)),
            ((x0, y0), (x0, 0)), ((x0, y0), (x1, y0)), ((x1, y0), (x1, 40)), ((128, 44), (140, 44))]
    for (a, b) in runs:
        horiz = a[1] == b[1]
        s0, s1 = (a[0], b[0]) if horiz else (a[1], b[1])
        n = max(1, int((s1 - s0) / 3))
        for i in range(n + 1):
            s = s0 + (s1 - s0) * i / n
            if horiz:
                box("terrain", "dark_steel", s - 0.05, a[1] - 0.05, s + 0.05, a[1] + 0.05, 0, 4.0, cell=0)
            else:
                box("terrain", "dark_steel", a[0] - 0.05, s - 0.05, a[0] + 0.05, s + 0.05, 0, 4.0, cell=0)
        if horiz:
            X0, X1, Y = s0 - 64, s1 - 64, 48 - a[1]
            quad("fence", "fence", (X0, Y, 0), (X1, Y, 0), (X1, Y, 4.0), (X0, Y, 4.0), 0)
        else:
            X, Y0, Y1 = a[0] - 64, 48 - s0, 48 - s1
            quad("fence", "fence", (X, Y0, 0), (X, Y1, 0), (X, Y1, 4.0), (X, Y0, 4.0), 0)


# ======================================================================================== phase 4 signage + lights
HANG = []   # boards (x, y, z, w, h, facing) — hang_signs() mounts each on its wall, hangs it or stands it


def sign(x, y, z, body, facing="s", w=None, size=0.45, coll=S, board=True):
    w = w or max(1.2, len(body) * size * 0.62 + 0.6)
    hgt = size * 1.7
    if board:
        HANG.append((x, y, z, w, hgt, facing))
    off = {"s": (0, 0.07), "n": (0, -0.07), "e": (0.07, 0), "w": (-0.07, 0)}[facing]
    if board:
        if facing in ("s", "n"):
            box(coll, "sign_dark", x - w / 2, y - 0.05, x + w / 2, y + 0.05, z - hgt / 2, z + hgt / 2, cell=0)
        else:
            box(coll, "sign_dark", x - 0.05, y - w / 2, x + 0.05, y + w / 2, z - hgt / 2, z + hgt / 2, cell=0)
    text(coll, "sign_text", body, x + off[0], y + off[1], z, size=size, facing=facing)


def signage():
    for x, letter in ((48.5, "A"), (57.5, "B"), (66.5, "C")):
        sign(x, 76.5, 4.4, "CHECK-IN " + letter, "s")
    sign(70, 69.5, 4.0, "SECURITY  GATES 12-14", "s")
    sign(83.78, 74, 3.8, "BAGGAGE CLAIM", "w")
    sign(22.22, 74, 4.0, "CUSTOMS  CARGO", "e")
    sign(47.5, 64.22, 3.2, "SECURITY OFFICE", "s", size=0.32)
    sign(96, 73, 4.2, "BELT 1", "s")
    sign(114, 73, 4.2, "BELT 2", "s")
    sign(70, 54.6, 3.8, "GATES 12-14  UP", "n")
    sign(70, 44.4, 7.6, "GATE 13", "s", size=0.6)
    sign(50, 50.0, 7.3, "GATE 12", "s", size=0.55)
    sign(105, 55.85, 7.3, "GATE 14", "n", size=0.55)
    sign(95, 44.35, 7.9, "CALDER AIR  CA 207  LAST CALL", "s", size=0.32)
    sign(64, 24.32, 12.4, "HANGAR 3", "s", size=1.6, coll=A)
    sign(17, 32.3, 7.2, "CARGO 7", "s", size=1.4, coll=A)
    sign(11, 57.75, 3.7, "CUSTOMS", "n", size=0.5)
    sign(100, 43.78, 4.3, "BAGGAGE MAKE-UP  STAFF ONLY", "n", size=0.32)
    sign(28.2, 72.5, -2.2, "ELECTRICAL", "w", size=0.3, coll=G)
    text(S, "coral", "PCX", 53, 86.4, 13.6, size=3.2, facing="s", depth=0.25)
    text(S, "sign_white", "PORT CALDER INTERNATIONAL", 53, 86.45, 12.7, size=0.62, facing="s", depth=0.05)
    text(S, "sign_white", "DEPARTURES", 75, 90.65, 6.55, size=0.6, facing="s", depth=0.03)
    text(S, "teal", "CALDER", 103.9, 26, 5.25, size=1.1, facing="w", depth=0.04)
    # flight information boards
    for (x, y, z, f) in ((40, 85.6, 3.0, "n"), (60, 66.0, 3.0, "s"), (100, 84.6, 2.6, "n")):
        box(S, "sign_dark", x - 2, y - 0.1, x + 2, y + 0.1, z - 0.8, z + 0.8, cell=0)
        HANG.append((x, y, z, 4.0, 1.6, f))
        box(S, "screen", x - 1.85, y - 0.12, x + 1.85, y + 0.12, z - 0.7, z + 0.7, cell=0)


def fittings():
    """ceiling light panels: what the baked lights appear to come from"""
    # no panel over a stair: the customs stair's tread rose to 0.28 m under the tunnel panel at x 8, which
    # showed as a white slab lying on the steps (and the bake hung a lamp there). Stair footprints as in stairs.
    stair_fp = [(40.5, 45, 42.5, 53.5), (125.5, 45, 127.5, 53.5), (64, 46, 66.5, 54), (73.5, 46, 76, 54),
                (76, 68, 80, 76), (5, 71.5, 12.5, 73.5), (51, 56.5, 53.5, 63.5)]

    def lp(x0, y0, x1, y1, z):
        if any(x0 < b[2] + 0.3 and x1 > b[0] - 0.3 and y0 < b[3] + 0.3 and y1 > b[1] - 0.3 for b in stair_fp):
            return
        top(P, "light_panel", x0, y0, x1, y1, z - 0.02, down=True, cell=0)
    rooms = [((40, 44, 56, 56), L0H - 0.3), ((40, 56, 56, 64), 4.68), ((84, 44, 128, 62), 4.68), ((56, 54, 84, 64), 4.68), ((0, 58, 22, 86), 4.48), ((84, 62, 128, 86), 5.98)]
    for (r, z) in rooms:
        for x in range(int(r[0]) + 3, int(r[2]) - 1, 6):
            for y in range(int(r[1]) + 3, int(r[3]) - 1, 6):
                lp(x - 0.6, y - 0.3, x + 0.6, y + 0.3, z)
    for x in range(8, 50, 6):
        if not (28 < x < 38):
            lp(x - 0.5, 72.3, x + 0.5, 72.7, -1.52)
    for (x, y) in ((30, 72.5), (35, 72.5)):
        lp(x - 0.6, y - 2.5, x + 0.6, y - 2.0, -1.52)
    for y in (3, 8, 13, 18, 23):
        for x in range(51, 80, 6):
            lp(x - 0.8, y - 0.14, x + 0.8, y + 0.14, 12.6)
    for y in (6, 14, 22, 28):
        for x in (8, 22):
            lp(x - 0.8, y - 0.3, x + 0.8, y + 0.3, 8.95)


# ======================================================================================== gameplay markers
FFA = [(64, 92), (30, 91), (112, 92), (8, 78), (30, 70), (110, 80), (47, 60), (62, 62, L1), (48, 50), (104, 56), (112, 50, L1), (20, 44), (10, 20), (64, 6), (116, 10), (40, 30)]


def markers():
    empty("mission_start", 64, 92.5, 0.05)
    empty("spawn_alpha", 64, 92, 0.05)
    empty("spawn_bravo", 64, 6, 0.05)
    empty("mission_target", 106, 32, 3.45)
    for i, p in enumerate(FFA):
        empty(f"spawn_ffa_{i + 1:02d}", p[0], p[1], (p[2] if len(p) > 2 else 0.0) + 0.05)


# ======================================================================================== main
def hang_signs():
    """every board in HANG gets held up: against a wall right behind it, nothing to add; else two rods up to
    whatever is above it (ceiling, roof, the vault's arches); else two posts down to the floor"""
    sc = bpy.context.scene
    dg = bpy.context.evaluated_depsgraph_get()
    behind = {"s": (0, 1, 0), "n": (0, -1, 0), "e": (-1, 0, 0), "w": (1, 0, 0)}

    def cast(o, d, dist):
        hit, loc, _n, _i, ob, _m = sc.ray_cast(dg, Vector(o), Vector(d), distance=dist)
        return (loc, ob) if hit else (None, None)

    walled = hung = stood = 0
    for (x, y, z, w, h, f) in HANG:
        X, Y, _ = B(x, y)
        bd = Vector(behind[f])
        loc, ob = cast(Vector((X, Y, z)) + bd * 0.06, bd, 0.6)
        if loc is not None and "glass" not in ob.name:
            walled += 1
            continue
        along = (1, 0) if f in ("s", "n") else (0, 1)
        offs = (-(w / 2 - 0.3), w / 2 - 0.3) if w > 1.0 else (0.0,)
        up_hits = [cast((X + along[0] * o, Y + along[1] * o, z + h / 2 + 0.01), (0, 0, 1), 30)[0] for o in offs]
        if all(u is not None for u in up_hits):
            for o, u in zip(offs, up_hits):
                rx, ry = x + along[0] * o, y - along[1] * o
                box(S, "dark_steel", rx - 0.02, ry - 0.02, rx + 0.02, ry + 0.02, z + h / 2, u.z, cell=0)
            hung += 1
            continue
        # (posts only for a low board: a high one with nothing round it is a placement mistake — say so)
        dn_hits = [cast((X + along[0] * o, Y + along[1] * o, z - h / 2 - 0.01), (0, 0, -1), 3.5)[0] for o in offs]
        for o, d in zip(offs, dn_hits):
            if d is not None:
                rx, ry = x + along[0] * o, y - along[1] * o
                box(S, "dark_steel", rx - 0.04, ry - 0.04, rx + 0.04, ry + 0.04, d.z, z - h / 2, cell=0)
        stood += 1
        print(f"  sign on posts at {x}, {y}, z {z}")
    print(f"signs: {walled} on walls, {hung} hung, {stood} on posts")


def build():
    L.reset_scene()
    floors()
    walls()
    roofs_flat()
    vertical()
    tunnel()
    aircraft()
    cover()
    boundary()
    if PHASE >= 3:
        architecture()
    if PHASE >= 4:
        signage()
        fittings()
    objs = L.flush()
    L.weld([o for o in objs if not o.name.startswith(("glass", "fence"))])
    if PHASE >= 4:
        models()
    if PHASE >= 4:
        hang_signs()
        rods = L.flush()
        L.weld(rods)
        objs += rods
    markers()
    stats = {}
    for o in objs:
        c = o.users_collection[0].name
        s = stats.setdefault(c, [0, 0, 0])
        s[0] += 1
        s[1] += len(o.data.vertices)
        s[2] += sum(len(p.vertices) - 2 for p in o.data.polygons)
    print(f"PCX phase {PHASE}: {len(objs)} meshes")
    for c in sorted(stats):
        print(f"  {c:24s} meshes {stats[c][0]:3d}  verts {stats[c][1]:7d}  tris {stats[c][2]:7d}")
    tv = sum(s[1] for s in stats.values())
    tt = sum(s[2] for s in stats.values())
    print(f"  {'TOTAL':24s} meshes {len(objs):3d}  verts {tv:7d}  tris {tt:7d}")
    if OUT:
        os.makedirs(os.path.dirname(os.path.abspath(OUT)), exist_ok=True)
        bpy.ops.wm.save_as_mainfile(filepath=os.path.abspath(OUT))
        print("saved", OUT)


build()
