# TERMINUS: Port Calder Central (stage id `railway`)

An original multiplayer FPS map: a modern international railway terminal in Port Calder, the same city as LAST CALL. It is built in Blender by `scripts/railway/*.py` and loaded the way LAST CALL is.

## Phase 1: concept

### What the game needs (from the codebase, so I didn't ask)

| Question | Answer |
|---|---|
| Engine | Babylon.js 9, WebGL2, in the browser (desktop and phones) |
| Rendering | Map drawn **unlit**: texture × light baked into the vertices. No real-time lights or shadow maps on the map |
| Collision / AI | Voxelised offline from the same triangles (`voxel-map.mjs`, 12.5 cm voxels) into boxes plus a nav graph |
| Modes | Single player "clear the stage" (about 26 soldiers); online FFA and TDM, up to 8–12 players |
| Movement | Eye height 1.64 m, jump apex 0.66 m (nothing above about 0.7 m can be climbed), 0.18 m stair risers, door openings of 2.4 m or more |
| Budget | About 150–250k triangles, about 120 draw calls, a glb of 15 MB or less |

### Three concepts

1. **Modern International Railway Terminal**
   - **Look:** a glazed barrel-vault train shed over six tracks, with white steel, glass footbridges and galleries lined with shops along both sides.
   - **Also has:** a grand lobby, an underground metro, a depot and a city forecourt.
   - **Play:**
     - Long sightlines down the platforms.
     - Trains to hide behind and cross through.
     - Vertical fights from the galleries and bridges.
     - Close quarters underground.
   - **Strength:** it reads at once and is bright and modern. It also matches the reference picture and the bullet-train model.
2. **Abandoned Industrial Station**
   - **Look:** rusty trains, broken roofs, dark tunnels and warehouses.
   - **Play:** very atmospheric and mostly close range.
   - **Weakness:** dark and samey, and it would repeat the Underground stage's mood. It also doesn't suit a gleaming bullet train.
3. **Massive Urban Junction**
   - **Look:** many tracks, elevated viaducts and yards, with city blocks woven through.
   - **Play:** lots of routes.
   - **Weakness:** sprawling, hard to read, and the hardest of the three to keep fast in a browser.

**Chosen: concept 1**, the Modern International Terminal. It is the strongest fit for the reference image, the bullet train and multiplayer readability. It still borrows concept 3's yard and depot and the industrial underground from concept 2, so each area plays differently.

### Visual direction

- **Daytime.** The sun comes through the glazed vault, so the shed is bright and the underground is dimmer and cooler.
- **Materials:** white steel arches, navy mullions, terrazzo and tile floors, concrete platforms with yellow tactile edges, and ballast and steel rails.
- **No passengers, only soldiers.** The emptiness is the story: the station was locked down mid-service, with trains standing at the platforms.

## Phase 2: blueprint (map coordinates)

Axes: x runs east 0–240 and y runs south 0–150, in metres. In the game the conversion is `x = 64 − mx, z = my − 48`, the same as LAST CALL.

### Levels

| Level | z |
|---|---|
| Underground (subway passage, metro platform, plant rooms) | −7.0 (metro track bed −8.2) |
| Track bed and outdoor yards (ballast top) | −1.2 (rail head −0.9) |
| Platforms, concourse, forecourt | 0.0 |
| Galleries and footbridges | +7.0 |
| Vault springing / crown | +12 / +18 |

### Zones

| Zone | Rect (x0, y0, x1, y1) | Play |
|---|---|---|
| A. Station building: lobby, tickets, security, shops, food court | 40,100 – 180,126 (gallery level +7 over y 100–126 except the lobby atrium x 86–134) | Indoor and mid range; the centrepiece |
| B. Train shed: 6 tracks, 4 platforms | 30,32 – 190,100 | Long lanes, train cover, vertical fights |
| – P1 side platform | y 91–100 | |
| – T1 / T2 | y 86–91 / 81–86 | T2: the walk-through regional train |
| – P2 island | y 71–81 | |
| – T3 / T4 | y 66–71 / 61–66 | |
| – P3 island | y 51–61 | |
| – T5 / T6 | y 46–51 / 41–46 | |
| – P4 side platform | y 32–41 | |
| C. North building: control room, offices, staff, north gallery +7 | 40,18 – 190,32 | Rooms and the elevated north gallery |
| D. Goods yard: two sidings with a freight train, containers, goods shed | 30,2 – 196,18 | Outdoor, low cover, flank |
| E. Depot: inspection shed over T3/T4, workshops, service yard | 190,18 – 240,110 | Industrial, different rhythm |
| F. West throat: tracks to the tunnel portal under the road bridge | 8,32 – 30,100 | Open, risky crossing |
| G. Underground: subway passage under all platforms, metro platform under the lobby, electrical and ventilation rooms, emergency stairs | subway x 112–120, y 33–104; metro 60,104 – 170,124 | Close range |
| H. Forecourt and city: plaza, road, bus bays, taxi rank, car park, park | 0,106 – 240,150 (car park x 190–240) | Outdoor, vehicles as cover |

### Routes between zones

- **Ground**
  - Each end of every platform has a ramp down to the track bed (x 30–36 and 184–190).
  - The tracks lead out to the goods yard (north), the depot (east) and the throat (west).
- **Upper**
  - The south gallery and north gallery are joined by two glazed footbridges (x 72–78 and x 142–148).
  - Each footbridge has stairs down to P2 and P3, and the galleries have stairs and escalators down to P1 and P4.
- **Underground**
  - Every platform has a stair down to the subway passage (x 100–112).
  - The subway leads to the metro platform (south) and has an emergency stair up into the north building.
  - Stairs and an escalator run from the lobby down to the metro platform.

### Spawns

| Spawn | Where (mx, my) |
|---|---|
| Single-player start | the forecourt, (110, 136) |
| TDM Alpha | the forecourt, (110, 136) |
| TDM Bravo | the depot yard, (222, 30) |
| FFA (16) | spread over every zone, including the underground and the galleries |
| Mission target | the control room |

### Sightline and cover rules used

- **Platform lanes** (up to 150 m long) are broken up every 20–25 m by:
  - shelters, kiosks and vending machines
  - stair housings and columns
  - the trains
- **Track pairs** (10 m wide) give low cover: the sleepers, and the 0.9 m platform edge for a crouched player.
- **Bullet trains are solid cover.** There is one on T1, T4 and T6, set at different positions, so each lane is half covered.
- **The regional train on T2 can be walked through.** Its doors on the P2 side are open, and its gangways join all three cars.
- **No hollow walls**, and every wall stands within 1.5 m of walkable floor. The voxeliser drops walls further away: that was the Underground stage's see-through-wall bug.
