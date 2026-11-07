# TERMINUS preview cameras for ../airport/pcx_render.py --viewset=scripts/railway/rws_views.py
# name: ((eye map x, y, z), (look-at map x, y, z), lens mm); "plan" = top-down
EYE = 1.64
PLAN = (120, 75, 260)
VIEWS = {
    "plan": None,
    "bird": ((-40, 200, 110), (120, 70, 0), 26),
    "bird_ne": ((280, -60, 120), (110, 70, 0), 26),
    "forecourt": ((110, 140, EYE), (110, 110, 8), 18),
    "lobby": ((110, 123, EYE), (110, 104, 5), 14),
    "gallery": ((60, 112, 7 + EYE), (130, 100, 7), 16),
    "hall_p2": ((38.5, 74.6, EYE), (120, 70, 6), 16),
    "hall_p3": ((180, 56, EYE), (100, 60, 6), 16),
    "hall_bridge": ((75, 95, 7 + EYE), (75, 40, 6), 16),
    "hall_high": ((32, 96, 9.5), (120, 60, 4), 14),
    "track_bed": ((60, 83.5 - 2.5, -1.2 + EYE), (120, 84, 0), 18),
    "emu_inside": ((100.5, 83.0, EYE), (130, 83.0, 1.0), 16),
    "subway": ((116, 40, -7 + EYE), (116, 100, -6), 16),
    "metro": ((64, 108, -7 + EYE), (140, 116, -6), 16),
    "north_room": ((124, 25, EYE), (134, 18.5, 2), 16),
    "goods": ((60, 17, -1.2 + EYE), (150, 8, 0), 16),
    "depot": ((196, 40, -1.2 + EYE), (225, 66, 2), 16),
    "workshop": ((202, 92, -1.2 + EYE), (234, 104, 0), 16),
    "road_bridge": ((18, 102, 7 + EYE), (18, 30, 6), 18),
    "throat": ((22, 66, -1.2 + EYE), (60, 66, 4), 18),
    "carpark": ((236, 146, EYE), (200, 118, 2), 18),
    "thumb": ((36, 98, 8.5), (120, 62, 3.5), 18),
}
