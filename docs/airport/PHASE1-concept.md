# Airport map — Phase 1: Concept & Level Design

Status: **draft v1, waiting for approval**. Layout drawing: [layout-v1.svg](layout-v1.svg).

## Fixed facts (from the game code)

| | |
|---|---|
| Engine | Babylon.js 9 (WebGL2), TypeScript, Vite. Browser game. |
| Map format | `.glb` + `*-data.json` voxel collision (0.125 m voxels), like `office2`, `metro` |
| Modes | Multiplayer FFA + TDM (`server/server.mjs`), **and** a single-player mission stage |
| Players | 8 per room (`MAX_PLAYERS = 8`). Layout leaves room for 12 later. |
| Respawn today | spawn point **farthest from everyone**, from one shared list (no team sides yet) |
| Units | 1 unit = 1 m. Standing eye 1.64 m, crouched eye 1.08 m, capsule 1.8 m tall (1.2 m crouched) |
| Movement | walk 4.4 m/s, sprint 6.9 m/s, gravity 19 → jump apex ≈ 0.66 m; fall damage from ~3 m |
| Target | mid-range desktop, 60 fps in Chrome |

## The three concepts

### A — "Grand Hall" (terminal only, ~85% indoor)
Three stacked floors of one huge terminal: check-in, a security level, a departures floor, and a roof plaza.
- Fights: mostly close and mid range, very controlled sightlines.
- Good: cheap outdoors, strong verticality.
- Weak: reads as a shopping mall or your existing office stages. The aircraft only shows through windows, so it loses what makes an airport an airport.

### B — "Tarmac" (airside at night, ~70% outdoor)
Apron, two hangars, cargo sheds and parked jets under sodium lights.
- Fights: long sightlines, vehicles as cover.
- Good: dramatic, very "airport".
- Weak: big open concrete is hard to balance at 8 players. It needs a lot of big assets (several aircraft, many vehicles). And there's almost no terminal, so missions have nowhere to go room by room.

### C — "LAST CALL" (terminal slice + apron, ~55% indoor / 45% outdoor) ★ recommended
One slice of a real terminal (landside curb → check-in → security → gates) wrapped around one parked narrow-body jet, plus a hangar and a cargo shed.
- Fights: every range — cabin/tunnel CQB, mid-range halls, a long-ish apron.
- The playable aircraft and jet bridge give it a unique identity.
- It works for both a mission (landside → plane) and TDM (two sides, three lanes).

**Why C:** it's the only one that has every airport area you listed and still fits the 8-player scale (128 × 96 m, about the size of Office2). It's also the only one with a natural mission route. A wastes the airport fantasy; B fights the player count.

## Identity — Port Calder International (PCX)

A fictional coastal-city airport, built in the 2010s. The light is **golden hour**: low sun from the west, warm light through the glass, cool interiors.
1. **The Wave roof.** An undulating ceiling of warm timber slats on white branching "tree" columns runs from the check-in hall over the concourse. Its silhouette is visible from the apron. This is the map's signature.
2. **Calder Air.** The hero jet's livery: white, deep-teal tail, coral cheatline. The same coral is used on the landside "PCX" letters.
3. **Real signage = callouts.** Yellow-on-charcoal hanging signs ("Gates 12–14", "Baggage 1–2", "Check-in A–C"). Players call out what they read.
4. **One palette per zone** (readability first):

| Zone | Materials | Light |
|---|---|---|
| Check-in hall | warm timber + white terrazzo | warm |
| Security | grey + blue | blue |
| Concourse | glass + daylight | daylight |
| Baggage | steel + orange belts | — |
| Cargo | corrugated metal + yellow/black hazard | — |
| Hangar | green-grey epoxy floor | sodium |
| Apron | concrete + yellow markings | — |

## Scale & metrics (blockout rules for Phase 2)

| Element | Size |
|---|---|
| Playable area | 128 × 96 m; backdrop (runway, taxiway, tower) beyond the fence, out of bounds |
| Levels | L0 = 0 m (ground, apron) · L1 = +5.0 m (concourse, mezz, gate lounge) · L−1 = −4.5 m (service tunnel) |
| Stairs | 0.18 m riser, 0.30 m tread, 2.4 m wide min, landing halfway (28 risers per 5 m) |
| Escalators | 30°, 1.2 m per lane, ~9 m run for 5 m rise, always in pairs |
| Ceilings | check-in hall 12 m, concourse 6–8 m (Wave), rooms 3.5 m, tunnel 3 m, hangar 14 m |
| Widths | concourse 10–12 m, main halls 20 m+, service corridors 2.5–3 m, tunnel 3 m |
| Doors | single 1.2 × 2.2 m, double 2.4 × 2.2 m, hangar door 16 m |
| Low cover | 1.0–1.1 m (check-in counters 1.05 m). Hides crouched players; standing players shoot over it; can't be jumped (apex 0.66 m) |
| Peek cover | LD3 cargo container 1.63 m. Hides crouched players; standing eye (1.64 m) just clears it. Stack 2 for full cover. |
| Full cover | ≥ 2.0 m (X-ray machines 1.9–2.0 m, pillars, vehicles) |
| Aircraft | narrow-body, 37.6 m long, 35.8 m span. Cabin floor +3.4 m, 3.7 m wide inside. Belly clearance ~1.3 m (crouch only). |
| Jet bridge | L1 (+5.0) down to the cabin door (+3.4): 1.6 m drop over ~14 m (~6.5°) |
| Longest sightline | ≤ 60 m, and every one over 35 m is broken by cover |

## Zones (map coords: x east 0–128, y south 0–96; Blender X = x − 64, Y = 48 − y)

| Zone | Rect (x, y, w, h) | Level | Range | Notes |
|---|---|---|---|---|
| Departures curb (**Alpha spawn**) | 22,86,104,10 | L0 | mid | bus + taxis + canopy columns block views into spawn |
| Check-in hall | 22,64,62,22 | L0 | mid/long | 3 counter islands A–C, info desk, pillars, escalator to mezz |
| Customs / cargo office | 2,58,20,28 | L0 | CQB | 3 rooms, stair to tunnel |
| Baggage claim | 84,62,42,24 | L0 | mid | 2 carousels; belt flaps into make-up (crouch-through) |
| Security checkpoint | 54,54,30,10 | L0 | CQB/mid | 4 X-ray lanes, low rails; **choke** |
| Security office | 40,56,14,8 | L0 | CQB | staff bypass, CCTV, mission console, tunnel stair |
| Atrium | 56,44,28,10 | L0 | mid | escalators up to concourse; door to apron |
| Bus gate 12A | 40,44,16,12 | L0 | CQB/mid | ground doors to apron + cargo yard; stair to Gate 12 |
| Baggage make-up | 84,44,42,18 | L0 | CQB/mid | conveyors, bag carts; doors to apron east; stair to Gate 14 |
| Mezz food court | 40,56,44,12 | L1 | mid/long | balcony over check-in hall ★ |
| Concourse, Gates 12–13 | 40,44,44,12 | L1 | mid | glass wall over apron ★, atrium void, duty-free island |
| Gate 14 lounge | 84,44,42,12 | L1 | mid | jet bridge to cabin |
| Service tunnel + "Sparks" | customs → electrical room → security office | L−1 | CQB | flank; two 10–16 m legs with a room between (no long tube) |
| Cargo terminal | 2,4,32,28 | L0 (+4 office) | CQB | rack aisles, ULD bays, office ★ |
| Cargo yard | 2,32,38,26 | L0 | mid/long | semi-trailer, ULD stacks |
| Hangar 3 (**Bravo spawn**) | 46,2,36,22 | L0 (+6 catwalk) | mid | turboprop under maintenance, catwalk ★ |
| Apron (mid) | 34–88, 24–44 | L0 | mid/long | bag-cart train, tug, belt loader, stair truck |
| Gate 14 stand (aircraft) | 88–128, 0–44 | L0 + cabin | CQB in cabin, long outside | 3 ways into the jet: jet bridge, rear airstair, over-wing exit ★ |

## Lanes, routes and timings (sprint 6.9 m/s, paper estimates; we time them for real in Phase 2)

| Lane | Route | Alpha → contact | Bravo → contact | Who it favours |
|---|---|---|---|---|
| West (green) | curb → customs → cargo yard → cargo → hangar W door | ~11 s | ~11 s | even; contact at the customs / yard door |
| Center (amber) | curb → check-in → security → atrium ↔ bus gate → apron → hangar door | ~7 s to atrium | ~9 s | Alpha gets the terminal core first |
| East (blue) | curb → baggage claim → make-up → apron east → hangar E door | ~11 s | ~7 s | Bravo gets the aircraft side first |
| Alternates | mezz (over security) · jet bridge → cabin → airstair · tunnel (customs ↔ security office) · belt flaps | | | |

This is intentional territory: **Alpha naturally holds the terminal (mezz, atrium), Bravo holds the airside (apron, jet).** Each team has one power position near home and must take the other's to win the middle. Target for Phase 2: first contact between 7 and 11 s in every lane.

## Spawns

- **TDM start:** Alpha on the curb, Bravo in the hangar rear. Neither spawn can be seen from enemy-reachable ground (bus/canopy at the curb, half-closed hangar door). Each spawn has 3 exits.
- **Respawns (works with today's "farthest from everyone" server logic):** 16 points spread across all zones.

| Map coords (x, y) | Spawn point |
|---|---|
| 64,92 | curb centre |
| 30,91 | taxi rank |
| 112,92 | arrivals curb |
| 8,78 | customs |
| 30,70 | check-in west |
| 110,80 | baggage claim |
| 47,60 | security office |
| 62,60 (L1) | mezz |
| 48,50 | bus gate |
| 104,56 | make-up |
| 112,50 (L1) | Gate 14 lounge |
| 20,44 | cargo yard |
| 10,20 | cargo |
| 64,6 | hangar |
| 116,10 | apron east tail |
| 40,30 | apron west |

- Optional later (Phase 7, opt-in code change): team-side respawn lists for TDM so teams keep their halves.

## Power positions and their counters

| Position | Counters |
|---|---|
| Mezz balcony | hall escalator, atrium escalators, Gate 12 stair. Its glass balustrade gives half cover and can be shot out. |
| Concourse glass over apron | bus-gate stair, atrium, jet bridge, Gate 14 stair. The glass breaks (`Glass.ts`). |
| Hangar catwalk | stairs at both ends, open to the floor below, hangar door and side doors |
| Cargo office | stair plus 2 rack aisles, low windows |
| Over-wing | open from the apron on both sides and from the cabin. It's a transit spot, not a camp. |

The control tower is out of bounds on purpose, so nobody can camp it.

## Mission — "LAST CALL" (follows Black Ledger)

The cell's paymaster is escaping on a chartered Calder Air jet at Gate 14. The airport is in lockdown.
1. **Breach the check-in hall.** Guards on the floor, shooters on the mezz.
2. **Security office.** The red shutters block the security lanes, the mezz escalator and the baggage door. Use the console (like `PlaybackStation.ts`) to lift the lockdown, or flank through the tunnel.
3. **Concourse to Gate 14.** Enemies wake up in the food court and the gate lounges.
4. **Board the jet.** Clear the cabin (CQB) and take the paymaster.
5. **Exfil across the apron to Hangar 3.** Reinforcements pour out of the hangar and cargo.

In multiplayer every shutter stays open, the same way your online lockdown restrictions already work.

## Callouts (printed on in-world signs)

Curb, Taxis, Bus · Check-in A/B/C, Info · Mezz, Food Court · Security, Lanes, Office · Sparks, Tunnel · Customs · Atrium · Gate 12/13/14, Duty Free · Bus Gate · Belts 1/2, Flaps, Make-up · Jet Bridge, Cabin, Wing, Tail, Airstair · Apron, Carts, Tug · Hangar, Catwalk, Door · Cargo, Racks, Docks, Yard, Trailer.

## Reference searches (for inspiration, not copying)

- **Architecture:**
  - "Madrid Barajas T4 interior" (timber wave ceiling, coloured columns)
  - "airport tree column roof"
  - "Shenzhen Bao'an T3 interior"
  - "airport check-in hall wide angle"
- **Spaces:**
  - "airport security checkpoint lanes X-ray"
  - "baggage make-up area conveyors"
  - "jet bridge interior"
  - "A320 cabin interior wide"
  - "aircraft maintenance hangar interior"
  - "air cargo terminal ULD racks"
  - "airport apron ground support equipment"
- **Gameplay:**
  - Call of Duty MW2 "Terminal" (flow, plane interior)
  - Rainbow Six Siege "Presidential Plane" (cabin CQB)
  - CS2 map overviews (lane timing, choke sizes)
- **Pinterest / ArtStation:** "airport environment concept art golden hour", "modular airport kit".

## Performance budget (mid-range desktop)

| Item | Budget |
|---|---|
| `.glb` | ≤ 18 MB (the backdrop ≤ 1 MB) |
| Draw calls | ≤ 250 in the worst view |
| Triangles | ≤ 400k visible |
| Textures | 2K for hero surfaces only (floor, Wave ceiling, jet), 1K elsewhere, one shared trim sheet for walls and frames |
| Lighting | baked (`lit: false`, like Sandstorm/Frostline), a few real-time lights |
| Collision | voxel `*-data.json`, generated from a separate simplified collision collection |

## How Phase 1 is tested (paper test, before Blender)

1. Every power position has ≥ 2 approaches. ✔ on the drawing
2. No spawn is visible from ground the enemy can reach.
3. No corridor over ~25 m without a bend, room or cover break. The tunnel was split for this.
4. Every room has 2 exits, except small dead-end closets, which we avoid.
5. Lane timings within ±2 s of each other per contact point. Re-measured in Phase 2 with a stopwatch in-game.
