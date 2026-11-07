# LAST CALL — road and ground vehicles built from shaped parts instead of blocks.
#
# Each vehicle lives in its own local frame: s along its length (0 = rear, L = front), t across it
# (−W/2 … +W/2), z up from the ground. Frame(rect, front) places that frame on a map rectangle with the
# front towards "+x", "-x", "+y" or "-y" (map axes), so every vehicle keeps the footprint (and the cover)
# of the block it replaced.
#
# Bodies are convex side profiles extruded across the width. Wheel arches are cut out of the body (the
# profile is clipped around each wheel and a dark wheel well closes the gap), so the tyres sit in real
# openings instead of being painted on. Glass is a separate, slightly narrower volume (tumblehome), pillars
# and trim are their own volumes standing proud of it: no two faces share a plane, so nothing z-fights.
import math
import pcx_lib as L

EPS = 1e-6


def _sub(a, b):
    return (a[0] - b[0], a[1] - b[1], a[2] - b[2])


def _cross(a, b):
    return (a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0])


def _dot(a, b):
    return a[0] * b[0] + a[1] * b[1] + a[2] * b[2]


def clip(poly, axis, value, keep_ge):
    """Sutherland–Hodgman: the part of a convex (s, z) polygon with p[axis] >= value (or <= value)"""
    inside = (lambda p: p[axis] >= value - EPS) if keep_ge else (lambda p: p[axis] <= value + EPS)
    out = []
    n = len(poly)
    for i in range(n):
        a, b = poly[i], poly[(i + 1) % n]
        ia, ib = inside(a), inside(b)
        if ia:
            out.append(a)
        if ia != ib:
            k = (value - a[axis]) / (b[axis] - a[axis])
            out.append((a[0] + (b[0] - a[0]) * k, a[1] + (b[1] - a[1]) * k))
    # drop repeated points
    res = []
    for p in out:
        if not res or abs(p[0] - res[-1][0]) > EPS or abs(p[1] - res[-1][1]) > EPS:
            res.append(p)
    if len(res) > 1 and abs(res[0][0] - res[-1][0]) < EPS and abs(res[0][1] - res[-1][1]) < EPS:
        res.pop()
    return res


def _span(poly, s):
    """lowest and highest z of a convex (s, z) polygon at s"""
    zs = []
    n = len(poly)
    for i in range(n):
        a, b = poly[i], poly[(i + 1) % n]
        lo, hi = min(a[0], b[0]), max(a[0], b[0])
        if s < lo - EPS or s > hi + EPS:
            continue
        if hi - lo < EPS:
            zs += [a[1], b[1]]
        else:
            zs.append(a[1] + (b[1] - a[1]) * (s - a[0]) / (b[0] - a[0]))
    return min(zs), max(zs)


class Frame:
    def __init__(self, coll, rect, front):
        x0, y0, x1, y1 = rect
        self.coll, self.rect, self.front = coll, rect, front
        along_x = front in ("+x", "-x")
        self.L = (x1 - x0) if along_x else (y1 - y0)
        self.W = (y1 - y0) if along_x else (x1 - x0)

    # ---- placement
    def map(self, s, t):
        x0, y0, x1, y1 = self.rect
        xc, yc = (x0 + x1) / 2, (y0 + y1) / 2
        f = self.front
        if f == "+x":
            return (x0 + s, yc + t)
        if f == "-x":
            return (x1 - s, yc - t)
        if f == "+y":
            return (xc - t, y0 + s)
        return (xc + t, y1 - s)

    def P(self, s, t, z):
        x, y = self.map(s, t)
        return L.B(x, y, z)

    def dir(self, ds, dt, dz):
        return _sub(self.P(ds, dt, dz), self.P(0, 0, 0))

    def face(self, mat, pts, out, cell=0):
        """a quad or triangle (Blender points) wound so that it faces `out` (a Blender vector)"""
        n = _cross(_sub(pts[1], pts[0]), _sub(pts[-1], pts[0]))
        if _dot(n, out) < 0:
            pts = [pts[0]] + pts[1:][::-1]
        if len(pts) == 4:
            L.quad(self.coll, mat, *pts, cell=cell)
        else:
            L.tri(self.coll, mat, *pts)

    # ---- primitives
    def box(self, mat, s0, s1, t0, t1, z0, z1, cell=0, skip=()):
        s0, s1 = sorted((s0, s1))
        t0, t1 = sorted((t0, t1))
        P, F = self.P, self.face
        if "top" not in skip:
            F(mat, [P(s0, t0, z1), P(s1, t0, z1), P(s1, t1, z1), P(s0, t1, z1)], self.dir(0, 0, 1), cell)
        if z0 > 0.001 and "bottom" not in skip:
            F(mat, [P(s0, t0, z0), P(s1, t0, z0), P(s1, t1, z0), P(s0, t1, z0)], self.dir(0, 0, -1), cell)
        if "rear" not in skip:
            F(mat, [P(s0, t0, z0), P(s0, t1, z0), P(s0, t1, z1), P(s0, t0, z1)], self.dir(-1, 0, 0), cell)
        if "front" not in skip:
            F(mat, [P(s1, t0, z0), P(s1, t1, z0), P(s1, t1, z1), P(s1, t0, z1)], self.dir(1, 0, 0), cell)
        F(mat, [P(s0, t0, z0), P(s1, t0, z0), P(s1, t0, z1), P(s0, t0, z1)], self.dir(0, -1, 0), cell)
        F(mat, [P(s0, t1, z0), P(s1, t1, z0), P(s1, t1, z1), P(s0, t1, z1)], self.dir(0, 1, 0), cell)

    def extrude(self, mat, poly, t0, t1, cell=1.5):
        """a convex side profile [(s, z), …] extruded from t0 to t1"""
        if len(poly) < 3:
            return
        P, F = self.P, self.face
        n = len(poly)
        cs = sum(p[0] for p in poly) / n
        cz = sum(p[1] for p in poly) / n
        for i in range(n):
            a, b = poly[i], poly[(i + 1) % n]
            es, ez = b[0] - a[0], b[1] - a[1]
            if abs(es) < EPS and abs(ez) < EPS:
                continue
            ns, nz = ez, -es
            if ns * ((a[0] + b[0]) / 2 - cs) + nz * ((a[1] + b[1]) / 2 - cz) < 0:
                ns, nz = -ns, -nz
            F(mat, [P(a[0], t0, a[1]), P(b[0], t0, b[1]), P(b[0], t1, b[1]), P(a[0], t1, a[1])], self.dir(ns, 0, nz), cell)
        ss = sorted(set(round(p[0], 5) for p in poly))
        for t, sign in ((t0, -1), (t1, 1)):
            for sa, sb in zip(ss, ss[1:]):
                la, ha = _span(poly, sa)
                lb, hb = _span(poly, sb)
                pts = [P(sa, t, la), P(sb, t, lb), P(sb, t, hb), P(sa, t, ha)]
                F(mat, pts, self.dir(0, sign, 0), cell)

    def body(self, mat, poly, half, arches=(), well="rubber", cell=1.5):
        """a body profile across ±half with wheel arches cut out: arches = [(s centre, half length, top z)]"""
        cuts = sorted(arches)
        edges = [-1e9]
        for (sc, hl, _zt) in cuts:
            edges += [sc - hl, sc + hl]
        edges.append(1e9)
        # solid pieces between the arches
        for k in range(0, len(edges), 2):
            piece = clip(clip(poly, 0, edges[k], True), 0, edges[k + 1], False)
            self.extrude(mat, piece, -half, half, cell)
        # over each arch: only the body above the arch's top, and a dark well behind the tyre
        for (sc, hl, zt) in cuts:
            piece = clip(clip(clip(poly, 0, sc - hl, True), 0, sc + hl, False), 1, zt, True)
            self.extrude(mat, piece, -half, half, cell)
            zlo = min(_span(poly, sc)[0], zt - 0.05)
            self.box(well, sc - hl + 0.02, sc + hl - 0.02, -half + 0.3, half - 0.3, zlo, zt, skip=("top",))

    def cyl(self, mat, axis, c, r, a0, a1, seg=14, caps=True, rz=None):
        """cylinder along "t" or "s"; c = the two other coordinates of its axis (s, z) or (t, z);
        rz: a different vertical radius (an elliptic tank)"""
        rz = r if rz is None else rz
        ring = [(r * math.cos(2 * math.pi * i / seg), rz * math.sin(2 * math.pi * i / seg)) for i in range(seg)]

        def pt(u, w, a):
            if axis == "t":
                return self.P(c[0] + u, a, c[1] + w)
            return self.P(a, c[0] + u, c[1] + w)

        def d(u, w, a):
            return self.dir(u, a, w) if axis == "t" else self.dir(a, u, w)

        for i in range(seg):
            (ua, wa), (ub, wb) = ring[i], ring[(i + 1) % seg]
            um, wm = (ua + ub) / 2, (wa + wb) / 2
            self.face(mat, [pt(ua, wa, a0), pt(ub, wb, a0), pt(ub, wb, a1), pt(ua, wa, a1)], d(um, wm, 0))
            if caps:
                self.face(mat, [pt(0, 0, a0), pt(ua, wa, a0), pt(ub, wb, a0)], d(0, 0, -1))
                self.face(mat, [pt(0, 0, a1), pt(ua, wa, a1), pt(ub, wb, a1)], d(0, 0, 1))

    def wheel(self, s, r, t_in, t_out, hub="grey_steel"):
        """a tyre between |t| = t_in and t_out on both sides, with a hub standing 1 cm proud of it"""
        for sg in (-1, 1):
            self.cyl("rubber", "t", (s, r), r, sg * t_in, sg * t_out)
            self.cyl(hub, "t", (s, r), r * 0.58, sg * (t_out - 0.02), sg * (t_out + 0.01), seg=10)

    def text(self, mat, body, s, side, z, size, t_off=None):
        """lettering on the left (side −1) or right (+1) flank, centred at s, t_off out from the centre line"""
        x, y = self.map(s, side * (self.W / 2 + 0.03 if t_off is None else t_off))
        f = self.front
        out = self.dir(0, side, 0)
        facing = ("e" if out[0] > 0 else "w") if abs(out[0]) > abs(out[1]) else ("n" if out[1] > 0 else "s")
        L.text(self.coll, mat, body, x, y, z, size=size, facing=facing)


# =========================================================================================== vehicles
def sedan(coll, rect, front, body="gse_yellow", taxi=True):
    """a 4.5 m saloon (a taxi by default): shaped bonnet and boot, raked screens, cut arches"""
    v = Frame(coll, rect, front)
    Lv, W = v.L, v.W
    h = W / 2
    k = Lv / 4.5
    S = lambda s: s * k
    lower = [(0, 0.3), (Lv, 0.3), (Lv, 0.64), (S(4.36), 0.81), (S(3.25), 0.95), (S(1.0), 0.97), (S(0.06), 0.92), (0, 0.76)]
    axles = (S(0.95), S(3.62))
    v.body(body, lower, h, arches=[(a, 0.42, 0.74) for a in axles], cell=1.0)
    hg = h - 0.08
    v.extrude("window_dark", [(S(0.75), 0.88), (S(3.35), 0.88), (S(2.42), 1.41), (S(1.33), 1.41)], -hg, hg, cell=0)
    v.extrude(body, [(S(1.28), 1.405), (S(2.47), 1.405), (S(2.40), 1.46), (S(1.36), 1.47)], -hg - 0.01, hg + 0.01, cell=0)
    for sg in (-1, 1):
        a, b = sorted((sg * (hg - 0.05), sg * (hg + 0.012)))
        v.extrude(body, [(S(3.35), 0.88), (S(3.24), 0.88), (S(2.33), 1.41), (S(2.44), 1.41)], a, b, cell=0)     # A
        v.extrude(body, [(S(0.75), 0.88), (S(1.08), 0.88), (S(1.62), 1.41), (S(1.33), 1.41)], a, b, cell=0)     # C
        v.box(body, S(2.0), S(2.1), a, b, 0.9, 1.41)                                                          # B
        v.box(body, S(3.05), S(3.2), sg * h, sg * (h + 0.14), 0.95, 1.06)                                     # mirror
        v.box("dark_steel", S(2.05), S(2.32), sg * (h - 0.01), sg * (h + 0.015), 0.84, 0.86)                  # handles
        v.box("dark_steel", S(0.9), S(1.15), sg * (h - 0.01), sg * (h + 0.015), 0.84, 0.86)
        if taxi:   # the checker band, broken by the arches
            for (s0, s1) in ((S(0.35), axles[0] - 0.45), (axles[0] + 0.45, axles[1] - 0.45)):
                v.box("sign_dark", s0, s1, sg * (h - 0.01), sg * (h + 0.012), 0.76, 0.84)
        v.box("sign_white", Lv - 0.03, Lv + 0.012, sg * 0.52, sg * 0.8, 0.52, 0.61)                         # headlights
        v.box("line_red", -0.012, 0.03, sg * 0.5, sg * 0.82, 0.64, 0.73)                                      # tail lights
    v.box("dark_steel", Lv - 0.06, Lv + 0.07, -h + 0.04, h - 0.04, 0.3, 0.46)                                  # bumpers
    v.box("dark_steel", -0.07, 0.06, -h + 0.04, h - 0.04, 0.3, 0.46)
    v.box("dark_steel", Lv - 0.02, Lv + 0.02, -0.42, 0.42, 0.47, 0.6)                                         # grille
    for a in axles:
        v.wheel(a, 0.33, h - 0.25, h - 0.03)
    if taxi:
        v.box("sign_text", S(1.72), S(2.06), -0.32, 0.32, 1.47, 1.62)                                         # roof sign
        v.box("dark_steel", S(1.70), S(2.08), -0.34, 0.34, 1.465, 1.48)


def bus(coll, rect, front, door_side=-1, livery="teal"):
    """a 12 m low-floor airport shuttle: window band with pillars, two doors on the kerb side, cut arches,
    destination sign, livery stripes and lettering"""
    v = Frame(coll, rect, front)
    Lv, W = v.L, v.W
    h = W / 2
    belt, eave, top = 1.25, 2.75, 3.2
    rear_ax, front_ax = 3.0, Lv - 2.7
    arches = [(rear_ax, 0.62, 1.1), (front_ax, 0.62, 1.1)]
    v.body("white_steel", [(0, 0.3), (Lv - 0.12, 0.3), (Lv, 0.46), (Lv, belt), (0, belt)], h, arches=arches)
    hg = h - 0.03
    v.extrude("window_dark", [(0.04, belt), (Lv - 0.02, belt), (Lv - 0.14, eave), (0.04, eave)], -hg, hg)
    v.extrude("white_steel", [(0, eave), (Lv - 0.14, eave), (Lv - 0.22, 3.08), (Lv - 0.42, top), (0.15, top), (0, 3.08)], -h, h)
    doors = [(5.4, 6.6), (Lv - 1.9, Lv - 0.65)]
    # window pillars, skipping the door openings
    s = 0.04
    pill = []
    while s < Lv - 0.8:
        s += 1.55
        if s < Lv - 0.8:
            pill.append(s)
    pill.append(Lv - 0.46)
    for p in pill:
        for sg in (-1, 1):
            if sg == door_side and any(d0 - 0.1 < p < d1 + 0.1 for (d0, d1) in doors):
                continue
            a, b = sorted((sg * (hg - 0.05), sg * (h + 0.004)))
            v.box("white_steel", p, p + 0.2, a, b, belt, eave)
    # doors: glass leaves standing out of the side, dark frames and a centre seal
    for (d0, d1) in doors:
        a, b = sorted((door_side * (h - 0.04), door_side * (h + 0.035)))
        v.box("window_dark", d0, d1, a, b, 0.34, eave - 0.03)
        a2, b2 = sorted((door_side * (h - 0.03), door_side * (h + 0.05)))
        for (f0, f1) in ((d0 - 0.06, d0), (d1, d1 + 0.06), ((d0 + d1) / 2 - 0.02, (d0 + d1) / 2 + 0.02)):
            v.box("dark_steel", f0, f1, a2, b2, 0.32, eave)
        v.box("dark_steel", d0 - 0.06, d1 + 0.06, a2, b2, eave - 0.05, eave + 0.02)
    # livery: a stripe on the skirt between the arches and doors, a band under the roof
    for sg in (-1, 1):
        a, b = sorted((sg * (h - 0.01), sg * (h + 0.015)))
        cuts = sorted([(sc - hl - 0.02, sc + hl + 0.02) for (sc, hl, _z) in arches] + ([(d0 - 0.08, d1 + 0.08) for (d0, d1) in doors] if sg == door_side else []))
        s0 = 0.05
        for (c0, c1) in cuts + [(Lv - 0.2, Lv)]:
            if c0 - s0 > 0.2:
                v.box(livery, s0, c0, a, b, 0.86, 1.08)
            s0 = max(s0, c1)
        v.box(livery, 0.02, Lv - 0.3, a, b, eave + 0.03, eave + 0.17)
    v.text(livery, "PCX  AIRPORT SHUTTLE", (rear_ax + front_ax) / 2, -door_side, 0.62, 0.3)
    v.text(livery, "PCX", 4.2, door_side, 0.64, 0.32)
    # rear: a solid back with the engine louvres and a smaller rear window, not one big pane
    v.box("white_steel", 0.0, 0.22, -h, h, belt, eave)
    v.box("window_dark", -0.025, 0.05, -0.95, 0.95, 1.75, 2.62)
    v.box("dark_steel", -0.02, 0.05, -0.8, 0.8, 0.5, 0.95)
    # front and rear
    v.box("dark_steel", Lv - 0.06, Lv + 0.08, -h + 0.05, h - 0.05, 0.3, 0.5)
    v.box("dark_steel", -0.08, 0.05, -h + 0.05, h - 0.05, 0.3, 0.5)
    for sg in (-1, 1):
        v.box("sign_white", Lv - 0.02, Lv + 0.015, sg * 0.85, sg * 1.3, 0.56, 0.7)
        v.box("line_red", -0.015, 0.02, sg * 1.08, sg * 1.38, 0.72, 1.12)
        v.box("dark_steel", Lv - 0.35, Lv - 0.15, sg * h, sg * (h + 0.22), 2.25, 2.4)     # mirror arms
        v.box("dark_steel", Lv - 0.3, Lv - 0.2, sg * (h + 0.16), sg * (h + 0.26), 1.75, 2.35)
    v.box("sign_text", Lv - 0.24, Lv - 0.11, -1.0, 1.0, 2.82, 3.02)                          # destination sign
    v.box("sign_text", -0.03, 0.02, -0.7, 0.7, 2.84, 3.0)
    v.box("grey_steel", 2.2, 5.2, -0.8, 0.8, top, top + 0.22, skip=("bottom",))                                # roof A/C pod
    for a in (rear_ax, front_ax):
        v.wheel(a, 0.5, h - 0.32, h - 0.04)


def _cab(v, s0, s1, half, body, z0, belt, roof, rake=0.15, arch=None):
    """a truck cab from s0 (back) to s1 (front): lower body, glass, roof, mirrors, lights"""
    v.body(body, [(s0, z0), (s1, z0), (s1, belt), (s0, belt)], half, arches=[arch] if arch else ())
    hg = half - 0.04
    v.extrude("window_dark", [(s0 + 0.04, belt), (s1 - 0.03, belt), (s1 - rake, roof), (s0 + 0.04, roof)], -hg, hg, cell=0)
    v.extrude(body, [(s0, roof), (s1 - rake, roof), (s1 - rake - 0.04, roof + 0.14), (s0, roof + 0.14)], -half, half, cell=0)
    for sg in (-1, 1):
        a, b = sorted((sg * (hg - 0.05), sg * (half + 0.005)))
        v.box(body, s0 + 0.04, s0 + 0.3, a, b, belt, roof)                                  # back pillar
        v.box(body, (s0 + s1) / 2 - 0.05, (s0 + s1) / 2 + 0.05, a, b, belt, roof)          # door pillar
        v.box("dark_steel", s1 - 0.35, s1 - 0.25, sg * half, sg * (half + 0.3), roof - 0.3, roof - 0.22)
        v.box("dark_steel", s1 - 0.34, s1 - 0.26, sg * (half + 0.22), sg * (half + 0.32), roof - 0.75, roof - 0.25)
        v.box("sign_white", s1 - 0.02, s1 + 0.015, sg * (half - 0.45), sg * (half - 0.12), z0 + 0.2, z0 + 0.36)
    v.box("dark_steel", s1 - 0.03, s1 + 0.02, -half + 0.5, half - 0.5, z0 + 0.15, belt - 0.12)       # grille
    v.box("dark_steel", s1 - 0.05, s1 + 0.1, -half + 0.02, half - 0.02, z0 - 0.15, z0 + 0.1)          # bumper


def stair_truck(coll, rect, front):
    """passenger stair truck: chassis, low cab, a stair flight with handrails up to a platform over the cab"""
    v = Frame(coll, rect, front)
    Lv, W = v.L, v.W
    h = min(W / 2, 1.0)
    v.box("dark_steel", 0.1, Lv - 0.1, -0.75, 0.75, 0.42, 0.72)
    v.box("gse_yellow", 0.2, Lv - 1.7, -0.9, 0.9, 0.86, 1.0)
    fa = Lv - 1.0
    _cab(v, Lv - 1.65, Lv, h, "gse_yellow", 0.62, 1.3, 2.0, arch=(fa, 0.48, 0.95))
    for a in (1.1, fa):
        v.wheel(a, 0.42, 0.72 if a < fa else h - 0.27, h if a < fa else h - 0.03)
    # the flight: 9 treads from the back up to the platform
    n, s0, s1, z0, z1 = 9, 0.35, Lv - 2.35, 0.95, 2.28
    for i in range(n):
        sa = s0 + (s1 - s0) * i / n
        za = z0 + (z1 - z0) * (i + 1) / n
        v.box("metal_plate", sa, sa + (s1 - s0) / n + 0.03, -0.55, 0.55, za - 0.06, za)
    plat = (s1, Lv - 0.3)
    v.box("metal_plate", plat[0], plat[1], -0.6, 0.6, z1 - 0.07, z1 + 0.01)
    for sg in (-1, 1):
        a, b = sorted((sg * 0.55, sg * 0.62))
        # stringer
        v.extrude("gse_yellow", [(s0, 0.9), (s0 + 0.25, 0.9), (s1, z1 - 0.25), (s1, z1), (s1 - 0.2, z1)], a, b, cell=0)
        # handrail: posts and the rail along the flight, a guard round the platform
        rail = lambda s: z0 + (z1 - z0) * (s - s0) / (s1 - s0) + 0.95
        for s in (s0 + 0.2, (s0 + s1) / 2, s1):
            v.box("white_steel", s - 0.025, s + 0.025, a, b, rail(s) - 0.95, rail(s))
        L.strut(coll, "white_steel", v.P(s0 + 0.2, sg * 0.585, rail(s0 + 0.2)), v.P(s1, sg * 0.585, rail(s1)), r=0.025)
        L.strut(coll, "white_steel", v.P(s1, sg * 0.585, z1 + 0.95), v.P(plat[1], sg * 0.585, z1 + 0.95), r=0.025)
        v.box("white_steel", plat[1] - 0.05, plat[1], a, b, z1, z1 + 0.95)
    # the scissor support under the platform
    for sg in (-1, 1):
        L.strut(coll, "grey_steel", v.P(s1 - 0.4, sg * 0.5, 1.0), v.P(plat[1] - 0.2, sg * 0.5, z1 - 0.08), r=0.04)
        L.strut(coll, "grey_steel", v.P(plat[1] - 0.2, sg * 0.5, 1.0), v.P(s1 - 0.4, sg * 0.5, z1 - 0.08), r=0.04)


def fuel_truck(coll, rect, front):
    """an aviation fuel bowser: cab, an elliptic tank with straps and end caps, hose reel, JET A-1 marks"""
    v = Frame(coll, rect, front)
    Lv, W = v.L, v.W
    h = min(W / 2, 1.25)
    v.box("dark_steel", 0.2, Lv - 0.2, -0.8, 0.8, 0.5, 0.85)
    fa = Lv - 1.1
    _cab(v, Lv - 2.0, Lv, h, "white_steel", 0.7, 1.55, 2.55, arch=(fa, 0.58, 1.12))
    v.box("teal", Lv - 2.0, Lv - 0.05, -h - 0.012, h + 0.012, 1.18, 1.32)
    tank0, tank1, cz = 0.45, Lv - 2.25, 1.9
    v.cyl("white_steel", "s", (0.0, cz), h - 0.05, tank0, tank1, seg=18, rz=0.98)
    for s in (tank0 + 0.6, (tank0 + tank1) / 2, tank1 - 0.6):
        v.cyl("dark_steel", "s", (0.0, cz), h - 0.03, s - 0.06, s + 0.06, seg=18, caps=False, rz=1.0)
    v.box("grey_steel", tank0 + 0.4, tank1 - 0.4, -0.25, 0.25, cz + 0.95, cz + 1.05)        # walkway
    v.box("dark_steel", 0.05, 0.45, -0.7, 0.7, 0.85, 1.7)                                      # hose cabinet
    v.cyl("rubber", "t", (0.25, 1.95), 0.3, -0.5, 0.5, seg=12)                                # hose reel
    for sg in (-1, 1):
        v.box("dark_steel", 2.85, tank1 - 0.2, sg * (h - 0.25), sg * (h + 0.02), 0.85, 1.0)  # side skirts
        v.text("teal", "JET A-1", (tank0 + tank1) / 2, sg, cz, 0.42, t_off=h - 0.03)
        v.box("line_red", 0.0, 0.07, sg * 0.5, sg * 0.78, 0.9, 1.1)
    for a in (1.15, 2.25):
        v.wheel(a, 0.5, 0.82, h)
    v.wheel(fa, 0.5, h - 0.3, h - 0.03)


def semi(coll, rect, front, cab_body="coral"):
    """an articulated box lorry: a ribbed trailer on a triple axle with landing legs and rear doors,
    and a tractor unit with a cab, roof fairing, fuel tanks and exhaust stacks"""
    v = Frame(coll, rect, front)
    Lv, W = v.L, v.W
    h = min(W / 2, 1.27)
    tr1 = Lv - 3.9                     # trailer front
    # trailer
    v.box("white_steel", 0.0, tr1, -h + 0.02, h - 0.02, 1.25, 4.0, cell=2.0)
    v.box("dark_steel", 0.0, tr1, -h, h, 1.05, 1.27)
    s = 0.6
    while s < tr1 - 0.2:
        for sg in (-1, 1):
            a, b = sorted((sg * (h - 0.03), sg * (h + 0.01)))
            v.box("grey_steel", s, s + 0.07, a, b, 1.27, 3.86)
        s += 1.2
    for sg in (-1, 1):
        a, b = sorted((sg * (h - 0.03), sg * (h + 0.01)))
        v.box("grey_steel", 0.0, tr1, a, b, 3.86, 4.0)
        v.box("teal", 2.0, tr1 - 1.5, sg * (h - 0.01), sg * (h + 0.025), 2.3, 2.9)
        v.text("white_steel", "PCX CARGO", tr1 / 2 + 0.5, sg, 2.6, 0.42, t_off=h + 0.055)
        v.box("dark_steel", tr1 - 1.9, tr1 - 1.8, sg * 0.6, sg * 0.75, 0.0, 1.05)            # landing legs
        v.box("dark_steel", tr1 - 2.0, tr1 - 1.7, sg * 0.5, sg * 0.85, 0.0, 0.06)
    # rear doors
    v.box("dark_steel", -0.03, 0.0, -0.03, 0.03, 1.27, 3.95)
    for sg in (-1, 1):
        v.box("dark_steel", -0.04, 0.0, sg * (h - 0.12), sg * (h - 0.04), 1.27, 3.95)
        for zz in (1.7, 2.6, 3.5):
            v.box("grey_steel", -0.05, 0.0, sg * 0.3, sg * 0.36, zz - 0.3, zz + 0.3)
        v.box("line_red", -0.05, 0.0, sg * (h - 0.4), sg * (h - 0.15), 1.08, 1.2)
    v.box("dark_steel", -0.15, 0.05, -h + 0.2, h - 0.2, 0.55, 0.65)                         # under-run bar
    for a in (1.3, 2.6, 3.9):
        v.wheel(a, 0.5, 0.75, h)
    # tractor unit
    c0 = tr1 - 1.3
    v.box("dark_steel", c0, Lv - 0.1, -0.85, 0.85, 0.55, 0.95)
    v.box("dark_steel", tr1 - 0.6, tr1 + 0.4, -0.7, 0.7, 0.95, 1.05)                         # fifth wheel
    cab0, fa = Lv - 2.0, Lv - 1.05
    _cab(v, cab0, Lv, h - 0.05, cab_body, 0.95, 2.05, 2.85, rake=0.18, arch=(fa, 0.6, 1.12))
    v.extrude(cab_body, [(cab0 - 0.3, 0.95), (cab0 + 0.02, 0.95), (cab0 + 0.02, 3.38), (cab0 - 0.1, 3.38), (cab0 - 0.3, 2.9)], -h + 0.06, h - 0.06, cell=0)
    v.extrude(cab_body, [(cab0, 2.98), (Lv - 0.25, 2.98), (Lv - 0.4, 3.1), (cab0, 3.32)], -h + 0.1, h - 0.1, cell=0)
    for sg in (-1, 1):
        v.cyl("grey_steel", "s", (sg * (h - 0.3), 0.75), 0.26, tr1 + 0.5, cab0 - 0.15, seg=10)    # fuel tanks
        v.box("dark_steel", cab0 - 0.2, cab0 - 0.06, sg * h, sg * (h + 0.13), 0.95, 3.6)           # exhaust stacks
    v.wheel(tr1 - 0.1, 0.5, 0.85, h - 0.05)
    v.wheel(fa, 0.5, h - 0.35, h - 0.07)


def forklift(coll, rect, front):
    """a counterbalance forklift: body and counterweight, overhead guard, mast, carriage and forks"""
    v = Frame(coll, rect, front)
    Lv = v.L
    m = Lv - 1.0                    # mast position
    v.extrude("gse_yellow", [(0.15, 0.25), (m - 0.05, 0.25), (m - 0.05, 0.95), (m - 0.5, 1.1), (0.45, 1.1), (0.15, 0.85)], -0.6, 0.6, cell=0)
    v.extrude("dark_steel", [(0.05, 0.3), (0.6, 0.3), (0.6, 1.25), (0.25, 1.25), (0.05, 1.0)], -0.62, 0.62, cell=0)   # counterweight
    v.box("rubber", 0.7, 1.15, -0.3, 0.3, 1.1, 1.35)                                           # seat
    v.box("rubber", 0.7, 0.8, -0.3, 0.3, 1.35, 1.75)
    for s in (0.7, m - 0.45):
        for sg in (-1, 1):
            a, b = sorted((sg * 0.5, sg * 0.56))
            v.box("dark_steel", s, s + 0.06, a, b, 1.1, 2.1)
    v.box("dark_steel", 0.68, m - 0.37, -0.58, 0.58, 2.1, 2.15)                                  # guard roof
    for sg in (-1, 1):
        a, b = sorted((sg * 0.32, sg * 0.42))
        v.box("grey_steel", m, m + 0.1, a, b, 0.1, 2.25)                                          # mast
        a, b = sorted((sg * 0.18, sg * 0.3))
        v.box("grey_steel", m + 0.17, Lv - 0.02, a, b, 0.08, 0.14)                               # forks
        v.box("grey_steel", m + 0.12, m + 0.17, a, b, 0.08, 1.0)
    v.box("dark_steel", m + 0.1, m + 0.14, -0.5, 0.5, 0.25, 1.0)                                  # carriage
    v.box("dark_steel", m + 0.01, m + 0.09, -0.43, 0.43, 2.15, 2.25)
    for (a, r) in ((0.45, 0.28), (m - 0.3, 0.32)):
        v.wheel(a, r, 0.6, 0.8)
