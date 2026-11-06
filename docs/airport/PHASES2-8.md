# Airport map — Phases 2–8 (built)

Phase 1 is in [PHASE1-concept.md](PHASE1-concept.md). Everything below is produced by scripts in `scripts/airport/`, so the map can be rebuilt, changed and rebuilt again. Nothing is modelled by hand.

## One command

```bash
sh scripts/airport/build_all.sh        # 256-sample bake, about 5–10 min on an M4
```

It runs, in order:

1. `textures.mjs` (phase 5 textures)
2. `pcx_build.py` (phases 2–5 geometry)
3. `pcx_bake.py` (phase 6 light)
4. `pcx_export.py` (glb)
5. `scripts/assets/prep-airport.mjs` (game-ready glb)
6. `scripts/assets/voxel-map.mjs` (collision + AI nav)

Outputs:

| File | What it is |
|---|---|
| `src/assets/maps/airport.glb` | the map, ~5 MB |
| `src/assets/maps/airport-data.json` | collision boxes + nav, ~0.6 MB |
| `scripts/airport/out/*.blend` | Blender files to open and look around |

**Preview renders** (the game look: unlit, texture × baked light):

```bash
Blender -b scripts/airport/out/pcx_baked.blend -P scripts/airport/pcx_render.py -- --out scripts/airport/out/shots --look game
```

The views are player-eye cameras at every callout. Add `--views hall,cabin` for just some of them.

**Working in Blender yourself:** open `scripts/airport/out/pcx_baked.blend`. Solid view with *Attribute* colour shows the baked light; Material Preview shows the textures. To change the layout, edit the numbers in `pcx_build.py` (they're map coordinates, the ones on `layout-v1.svg`) and re-run the build. Don't edit the .blend, because the next build replaces it. You can also run a script from inside Blender: Scripting tab → Open → `pcx_build.py` → set `PHASE` at the top → Run Script.

## Coordinates

- Map coords: x east 0–128, y **south** 0–96, z up, metres.
- Blender: `X = x − 64, Y = 48 − y`.
- In the game (Babylon): `x = 64 − mapx, z = mapy − 48`. The glTF loader mirrors X.

## Phase 2 — Blockout (`--phase 2`)

**What:** the floors, the three levels, the walls with their doors, the stairs and escalators, the service tunnel, the playable jet with its jet bridge and airstair, and grey blocks for all major cover.

**Why:** the block-out is what you test for movement and sightlines before any detail exists.

**Built from these helpers in `pcx_lib.py`:**
- `wall(a, b, z0, z1, doors=[(s0, s1, h)])`: splits itself around its openings.
- `slab(rect, holes=…)`: a floor with stair holes cut out.
- `stairs(rect, z_lo, z_hi, rise)`: 0.18 m risers.
- `glass_wall(…)`: one separate quad per pane, because the game breaks panes one at a time.
- `cut()`: rectangle-minus-rectangles.

**Organisation:** collections `PCX_10_Terrain … PCX_90_Backdrop`, plus `PCX_95_Gameplay` (the empties). There is **one mesh per material per collection**, 99 meshes in all, so in the game that is about 100 draw calls.

**Test:** `pcx_render.py --views plan,…` (Workbench), then walk it in the game (below).

## Phase 3 — Architecture

- The **Wave** timber ceiling under the flat roofs: the hall, the mezz, the concourse, and the canopy over the curb.
- White **tree columns**.
- Hangar trusses and parked sliding door leaves.
- Dock shelters.
- Apron paint: the Gate 14 lead-in line, the stop bar, the hatched no-park boxes, the curb crossings.
- The **backdrop**, all low-poly and out of bounds:
  - runway 09/27 and the taxiway
  - the 58 m control tower west of cargo
  - Pier B with jet bridges, the maintenance hangars, the car park
  - a 40-block city skyline and hills
  - three CRJ-900s (two parked at Pier B, one on the taxiway): `models/crj900.glb`, “Airplane CRJ-900 Cityjet” by CityJet Training on Sketchfab, **CC BY 4.0** (credited in `index.html` and `README.md`). `crj()` in `pcx_build.py` places them, and they are baked with the rest of the map

## Phase 4 — Props and signage

Everything is generated at the phase-2 cover footprints, so the gameplay doesn't change between the blockout and the final map:

| Area | Props |
|---|---|
| Check-in | 3 islands: 1.05 m counters, bag belts, back panels, screens |
| Security | X-ray machines (1.9 m), walk-through arches, lane rails |
| Seating | bench rows at Gates 12 and 14, in the hall and at the bus gate |
| Mezz / concourse | food court counters and kitchens, the duty-free shop, planters, tables |
| Baggage | carousels and feed belts, luggage, the make-up belt loop through the crouch flaps, bag carts, a tug |
| Apron / yard | LD3 containers (1.63 m: a standing player can see over them, a crouched one is hidden), the stair truck, the bag-cart train, the belt loaders, the GPU carts, the fuel truck, the semi-trailer, a shipping container |
| Cargo | the rack aisles |
| Hangar | tool chests |
| Sparks | the electrical cabinets and transformer |
| Curb | the bus, the taxis, the bollards |

**Signage:** real airport signs that double as callouts (CHECK-IN A/B/C, SECURITY GATES 12-14, BELT 1/2, GATE 12/13/14, HANGAR 3, CARGO 7, CUSTOMS, ELECTRICAL…). There's also the coral **PCX** and PORT CALDER INTERNATIONAL on the facade, CALDER on the jet, and flight-information screens. Ceiling light panels everywhere the bake puts a lamp.

**Sketchfab hero assets to swap in later** (optional):

| Search terms | Licence | Size to expect |
|---|---|---|
| "airport baggage tug", "belt loader", "airport stairs truck", "LD3 container", "airport bus", "jet bridge" | CC BY: credit the author in `index.html` and `README.md`. Avoid NC / Standard licences for anything you might sell. | Usually 1–10 MB |

Each one goes through `scripts/assets/prep-props.mjs` and is placed through `level/Props.ts`. Keep them at the same footprints.

## Phase 5 — Materials

There are 14 Poly Haven scans (CC0: no credit required) in `scripts/airport/textures/src`. `textures.mjs` recalibrates each one to a target albedo and contrast and writes it to `textures/pcx/`. The raw scans are dark, and some are the wrong colour (the box-profile metal is red, the "painted concrete" is green).

Every other material is a flat colour (steel, livery, seats, paint lines). Glass is a separate alpha material on one mesh named `glass`. The prep step makes everything **unlit** (`KHR_materials_unlit`) and turns the textures into WebP at 1024 px (2.3 MB in all).

## Phase 6 — Lighting

`pcx_bake.py` sets up:
- A golden-hour sun: west-south-west, 17° high, warm.
- A sky fill.
- About 200 area lamps:
  - warm under the Wave
  - cool over security
  - neutral in the make-up hall
  - sodium-warm in the hangar
  - small lamps in the tunnel and cabin, on the jet bridge, and at every ceiling panel

Cycles (GPU) bakes **diffuse direct + indirect into a per-corner colour layer** and tone-maps it into 0–1. The game multiplies it with the texture (glTF `COLOR_0`).

- **Result:** a fully lit map with no real-time lights, no shadow maps and no lightmap textures.
- **Atmosphere in the game** (`Airport.ts → goldenHour()`): a dusk sky shader with the sun in the same direction, warm haze fog, and soldier lights to match.

## Phase 7 — Gameplay optimisation

| Item | Value |
|---|---|
| Triangles | 83k |
| Meshes / draw calls | 99 |
| Materials | 38 |
| `.glb` | 5.2 MB (budget was 18) |
| Nav / collision data | 0.6 MB |
| Frame rate | 60 fps in the dev build |

- **Collision:** voxels built from the same triangles (0.125 m).
  - Glass is a `--wall`: shootable and breakable, with a clip wall that stays, so broken glass is never a way out of the map.
  - The fence is `--soft`: it blocks movement but not bullets.
  - Everything is cropped to the playable area, so the backdrop never becomes walkable.
- **Reachable floor:** ≈ 11,980 m², checked with `--probe`.
  - It includes the cabin, the airstair, the catwalk, the cargo office and the tunnel.
  - Crouch-only places (the 1.5 m belt flaps) are left out of the AI nav on purpose. Players can still crouch through.
- **Navigation:** 1,730 nav nodes (580 with cover flags) and 10 auto-doorways.
- **Unreachable on purpose:** roofs, the tower, bus and vehicle tops, stacked ULDs, cargo racks. The jump apex is 0.66 m, so nothing over ~0.7 m can be climbed.
- **Fixed in this phase:** the cabin was unreachable. A galley trolley blocked the 1 m aisle, and the doors were only 2.0 m tall. The trolleys are now parked in the galleys, the aisle is 1.2 m, and the doors are 2.4 m.

## Phase 8 — Export and integration

- **Export:** `pcx_export.py` writes glTF binary, +Y up, metres, with the baked layer as `COLOR_0`. The gameplay empties (`mission_start`, `mission_target`, `spawn_alpha`, `spawn_bravo`, `spawn_ffa_01…16`) are exported as nodes. `prep-airport.mjs` adds unlit materials, WebP textures and quantised geometry, and keeps the empties.
- **Game:**
  - `src/level/Airport.ts` (`buildAirport`) follows the Black Ledger pattern: draw the glb as-is, collision chunks and the NavGraph from the JSON, player start at `mission_start` facing the jet, 18 hostiles from `pickEnemySpawns`, breakable glass from the `glass` mesh.
  - Stage id `airport` is registered in:
    - `config/stages.ts` ("LAST CALL", after Black Ledger)
    - `main.ts` (thumbnail `assets/thumbs/airport.webp`)
    - `Game.load()` (the builder; the mark/fsb/swat soldiers)
    - `server/server.mjs` (online rooms: FFA and TDM; spawns are picked automatically from the nav graph)
- **Test it:**
  - Mission: `npm run dev` → `http://localhost:5173/?quick=airport`
  - Online: `npm run server` + `?quick=airport&mp=ROOM&name=A`

## The stage

"Clear the airport": 18 soldiers spread over the map from the nav graph (`pickEnemySpawns`), the player on the departures curb. An earlier scripted mission (lockdown shutters, a console, the paymaster) was taken out at the user's request. `STITCH` in `level/Airport.ts` still adds the walks the 3 m nav grid misses: the security office doorways and the top of its tunnel stair.

## Look pass (after the reference images)

- **Check-in hall roof:** a glazed **barrel vault** (`vault()` in `pcx_build.py`, `VAULT`) springing from the 12 m walls to 17.5 m. White steel arches every ~4 m, timber arches between them, purlins and diagonals, solid bands at the springing, white end walls and a navy ring beam. The glazing is `roof_roof_glass` (`PCX_25_Roof`): the bake lets the sun through it, and it isn't breakable or solid.
- **Columns:** the hall's tree columns branch up into the vault; every column stands on a navy collar.
- **Frames:** window mullions and balustrade rails are navy (`navy_steel`).
- **Seating:** `bench_row` builds linked seats (wooden pads, teal backs, navy armrests, a steel beam on feet), on the old bench footprints.
- **Signs:** `hang_signs()` holds every board up. If there's a wall right behind it, it stays as it is. Otherwise it gets two rods up to whatever is above (ceiling, roof, vault). If neither, it stands on posts, and only a low board can.
- **Removed:** the yellow block beside the airstair.

## Round 3: bigger map, real vehicles, a better jet

- **Playable area** is `PLAY = (0, −17, 250, 96)` in `pcx_build.py`, about 28,000 m² of ground, 20,000 m² of it walkable. It adds the **Pier B apron** (x 128–250, y 0–40), with two parked CRJ-900s at real jet bridges on columns, and the **taxiway strip** north of the hangar and cargo (y −17…0), with the third CRJ taxiing. The CRJs are solid. The fence follows the new edge, and Pier B's front wall is the boundary to the east. The voxel crop in `build_all.sh` is `PLAY ± 0.15 m`.
- **Vehicles** come from `models/` and are placed by `models()` / `MODEL_SPOTS`. Each model is joined, decimated and laid along its length, with one mesh per kind:

  | Model | Where |
  |---|---|
  | Enclosed baggage cart | make-up hall, apron and Pier B trains |
  | Baggage tug | pulling the trains, the make-up hall |
  | ULD dolly + flatbed dolly | at the holds |
  | 6-seat airside cart | on the aprons |
  | Terminal buggy | at Gates 12 and 14 |

  The old block versions are still there for the blockout phases (SIMPLE).
- **The walkable jet:**
  - The skin faces outwards now. It had faced in, which is why it baked black.
  - The engines are proper nacelles (lip, fan face, spinner, exhaust cone) under the wing, on pylons that run up into it.
  - The wing tapers to thin tips, with flap-track fairings and blended winglets.
  - The gear is twin-wheel: a braced main leg each side and a nose leg.
  - Also added: a belly fairing, the cockpit windscreen and an APU exhaust.
- **Seats:** an invisible `clip` block (1.25 m) over every seat row. `--soft='fence|clip'` makes it block movement but not bullets, so nobody stands on the seats and the AI has no nav nodes on them. The game hides the `clip_clip` mesh.
- **Nav stitches** (`STITCH` in `Airport.ts`) now also run down the cabin aisle and out of every jet door.
- **voxel-map.mjs:** the grid's bounds come from the triangles the crop keeps, not from every vertex in their buffers. A shared buffer had stretched the grid a kilometre wide.

## Glass

All 328 terminal panes are breakable (the mesh named exactly `glass`; one quad per pane). Intact glass blocks movement, bullets and sight. What happens once a pane breaks:

| Glass | Once broken |
|---|---|
| Ground-floor facades (curb ↔ check-in / claim, atrium ↔ apron) | walk through, both ways |
| Upper concourse, Gate 12, Gate 14 glass | a 5 m drop to the apron or cargo yard (fall damage, survivable) |
| Cargo office windows | a 3.9 m drop to the cargo floor |
| Glass balustrades (mezz, atrium void) | the 1.05 m handrail stays: too high to jump |
| Upper rows, clerestory | out of reach: break only |

Two cargo-office panes over the rack tops are *sealed* (`sealedGlass` in `Airport.ts`). They shatter but still block movement, so nobody can stand on the racks.

The wide-body cabin model we looked at (`airplane_interior.glb`, 55 m, 3-3-3, 1.4 M tris) doesn't fit the 3.7 m narrow-body cabin, so the cabin stays our own.

**Still to do:** TDM team-side spawns. The server still spawns farthest-from-everyone.
