# TERMINUS → heritage station: Phase 1 inspection and the plan

Status: **built** (2026-11-07, all phases approved at once). Rebuild: `sh scripts/railway/build_all.sh`; the three Sketchfab trains are prepared once by `scripts/railway/prep_models.py`. What shipped is summarised in the README ("TERMINUS restyled").

## 1. What looks modern today, and what looks like LAST CALL

Most of the station's look came from the airport's parts library (`pcx_lib.py`) and the airport's own design decisions:

| Element today | Why it reads modern / like the airport |
|---|---|
| Glazed barrel vaults with white tubular arches and tie rods | The same vault as the airport's check-in hall |
| White "tree" columns with navy collars | Copied from the airport's columns |
| Navy-mullion glass curtain walls (station façade, north building windows) and glass balustrades on the galleries | The airport's façade system |
| Glass-tube footbridges with white trusses | They read like a jet bridge |
| Terrazzo floors, white steel, navy trim, flat ceiling light panels | The airport's material palette |
| Linked teal gate seating | The identical bench model |
| Security checkpoint (X-ray scanners, walk-through arches) | An airport security lane |
| Dark boards with glowing yellow text | The airport's signage |
| Escalators, blue screens, vending machines, digital departure boards | Modern equipment |
| Modern buses, taxis and cars on the forecourt | The airport's curb vehicles |
| Overhead electric line masts and colour-light signals | A modern railway |
| ISO containers, corrugated-metal sheds, forklift | A modern logistics yard |
| 3 bullet trains | Very modern. You asked for them to go |

**Bug found in your screenshot:** the regional train's lower body has jagged black streaks. The train's floor slab shares the exact outer face of the body side, so the two surfaces z-fight. The fix is to inset the floor.

## 2. What will be replaced

1. **Train shed roof.** The three glass vaults become wrought-iron arched trusses.
   - The ribs are lattice girders, every 5 m as now, in oxidised dark-green iron.
   - The roof is clad in weathered dark metal, with a glazed lantern strip along each crown.
   - The two gable ends become the classic fan-glazed screens with radial iron glazing bars.
2. **Columns.** Cast-iron columns, fluted, with a capital and decorative spandrel brackets, stand at the same positions.
3. **Station building façade** (same footprint, x 40–186, y 100–126):
   - red brick with stone dressings, cornices and pilasters, and a stone parapet
   - three tall arched entrance portals with wooden doors
   - arched windows on both floors, with a balcony over the middle portal
   - a central **clock tower** (about 30 m) with four clock faces: the landmark you can see from anywhere
4. **Booking hall (the lobby)**:
   - massive stone columns instead of the white tubes
   - a timber booking office with arched ticket windows and brass grilles
   - a mechanical flap departure board
   - cream plaster above dark wood panelling, and an encaustic-tile floor
   - hanging lanterns, and the skylight kept as an ornate iron-and-glass lantern
5. **Security checkpoint.** It becomes Victorian ticket barriers: cast-iron railings with a ticket-collector's booth. The gate openings stay the same width.
6. **Galleries.** Cast-iron balustrades replace the glass ones.
7. **Footbridges** (same positions, stairs and height): Victorian lattice-girder iron bridges with timber decks and a pitched roof on iron posts.
8. **Escalators.** Stairs on the same footprint, since escalators are wrong for the period.
9. **Platforms.**
   - worn stone flags with stone coping and a painted white edge line
   - wooden platform shelters and waiting rooms on the islands
   - gas-lamp standards, enamel signs, wooden benches with cast-iron ends
   - water cranes at the platform ends, and big double-faced hanging clocks
10. **Railway equipment.** The overhead line goes, and semaphore signals and telegraph poles replace the colour-light signals.
11. **North building, depot, goods yard.**
    - The north building and the warehouse become red brick with arched windows.
    - The depot becomes a brick **engine shed** with arched doors and roof smoke vents.
    - The goods shed gets a timber canopy, and crates, barrels and sacks replace the containers.
12. **Underground.** Victorian glazed tiles (cream with a dark green band) and cast-iron columns. The metro train gets a heritage tube-stock livery.
13. **City.** The modern bus, taxis and cars are replaced by period vehicles (1930s-style cabs and a vintage bus), with cobbled forecourt paving and Victorian lamp posts.
14. **Signage.** Enamel signs: cream lettering on maroon or navy, with a border.

## 3. What will be reused, unchanged

- The **whole layout**:
  - every floor, platform, track, stair, room, wall line and doorway
  - the subway and the metro, and every route and opening
  - the map size and the levels (−7 / −1.2 / 0 / +7)
- **Spawn and mission markers**, the nav stitches, and the per-zone soldier quotas.
- **Pipeline:** the build → bake → export → prep → voxel scripts, the track builder (sleepers and rails), the walk-through train builder (restyled), and the room fittings positions.
- **Multiplayer:** the stage id `railway` and the server entry.

## 4. Trains: replacements and placement

| Slot (today) | New | Source | Why there |
|---|---|---|---|
| T1 (bullet, x 48–124) | **Steam locomotive with its tender** (procedural landmark) plus 2 vintage coaches | built in Blender | A heritage station needs a steam engine at platform 1 |
| T2 (walk-through regional) | **Vintage walk-through coaches**: maroon and cream, wooden saloon seats, brass fittings, **doors open on both sides**, footboards | procedural | **You asked to go through the train:** three footboard treads (−0.3 / −0.6 / −0.9) make it walkable from the track bed (the step-up limit is 0.42 m), so the track bed connects through the train to platform 2 |
| T4 (bullet, x 106–182) | 4 × **"Train Wagon"** coaches, stabled | `train_wagon.glb` (3ddominator, CC BY 4.0), 45k verts → 6k triangles each | Old weathered coaches waiting at the platform |
| T6 (bullet, x 36–112) | **InterCity 125 power car** plus 2 "Train Wagon" coaches | `train_-_intercity_125…glb` (timblewee, CC BY 4.0), 687k verts → 22k triangles | An old diesel train at platform 4 |
| Goods siding S1 (modern diesel loco) | **Soviet armoured train locomotive** pulling the boxcars | `soviet_armoured_train_locomotive.glb` (Nadir Alishly, CC BY 4.0), 523k verts → 24k triangles | A military consignment belongs in the goods yard, not at a passenger platform |
| Depot shed | A steam breakdown crane (T3) and a tank engine (T5) | procedural | |

- **Bullet train removed:** `scripts/railway/models/bullet_train.glb`, its import code and its credit all go. The new map file won't contain it.
- **Same cover:** each replacement occupies the same lane, so cover along each platform is kept.

## 5. Gameplay effects (before building)

1. **Footbridges** lose their full glass sides. A solid 1.1 m iron plate parapet gives crouch cover, and open lattice above it lets bullets through but blocks movement (`--soft`, like the fence). Standing on a bridge becomes more exposed than today; that's the period look and gives more fights across the hall.
2. **Station façade:** glass curtain walls become brick with arched windows. The window panes stay breakable glass, but the brick between them blocks sight, so there are fewer sightlines from the forecourt into the lobby. That also means fewer lobby spots are visible from the start, so lobby soldiers get more choice of position.
3. **Overhead line masts removed** (thin cover in the gaps between tracks). Semaphore signal posts and water cranes stand at the platform ends instead.
4. **Escalators become stairs** on the same footprint: no route change.
5. **New route through the T2 train:** track bed → footboards → doors → platform 2.
6. **No change** to the map size, spawns, walls, doors or corridor widths.

## 6. Materials

- **Shared set:** wood, plaster, concrete and asphalt are kept from the shared textures.
- **New CC0 scans from Poly Haven** (no attribution needed): red brick, ashlar stone, roof slate or weathered metal, cobblestones, encaustic or patterned floor tiles, old wood planks, rusty or oxidised iron.
- **Generated:** glazed wall tiles (cream and green band).
- **Ageing:** subtle (slight discolouration, dust near floors, some rust at metal edges). Maintained, not abandoned.

## 7. Light

The airport is golden hour. TERMINUS becomes a **soft, slightly hazy late morning**:
- warm 2700 K interior lamps in the lanterns and pendants
- sun shafts through the roof lanterns and the arched windows
- an underground lit warmer than now, but still dimmer than the hall
- everything kept readable for play

## 8. The phases from here (your brief's numbering)

| Phase | Work |
|---|---|
| 2 | The replacement list above, item by item (done in this document) |
| 3 | The direction: references and mood |
| 4 | Exterior: façade, clock tower, forecourt |
| 5 | Booking hall interior, galleries |
| 6 | Train-shed roof, columns, platforms, footbridges |
| 7 | Trains: remove the bullet train, import and decimate the three models, the steam loco, the walk-through vintage coaches |
| 8 | Materials and textures |
| 9 | Props and details |
| 10 | Light and bake |
| 11 | Checks: nav connectivity, the sight-leak scan, soldier quotas, frame time, online room, every stage |
