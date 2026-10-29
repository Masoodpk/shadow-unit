---
name: shadow-unit-world
description: Stages, missions, collision, navigation and physics in the Shadow Unit FPS — adding/removing/reordering a stage, mission phases and wake groups, enemy spawns, supply caches, doors/glass, collision boxes, nav graph, Havok physics, grenades/ragdolls hitting the world. Use it for "add this place as a stage", "remove a stage", "enemies on the map but I can't find them", "player falls through / gets stuck", "objective doesn't advance", or any physics or collision change.
---

# Stages, missions, physics

## A stage is

- `config/stages.ts`: `StageId` + a `STAGES` entry (play order; NEXT STAGE follows it; the Heroes Playground last; the first one is the default for new players), with `lit`, `snow`, `ambience`.
- A builder returning `LevelData` (`level/KestrelPoint.ts` has the type): visual meshes, `colliders`, `boxes` (voxel collision: flag 1 blocks sight and bullets, flag 2 blocks movement), `nav`, `playerSpawn`, `enemySpawns` (`group`, `dormant`, `boss`, `route`, `anchored`), `doors`, `glassMesh`, `surfaceAt`, `openSky`, `floorRange`, `props`.
- Its branch in `Game.load()`: builder, music, which `SoldierSkins` kinds, mission object, plus small per-stage tweaks (exposure, shadows, `heroStage` features). `main.ts` `THUMBS` for the card.
- **Removing one**: delete its `STAGES` entry, `StageId` member, thumbnail, builder branch and per-stage conditions; keep shared types; fix `index.html` placeholder text; grep the name in comments and README.

## Map exports without a world around them

A Sketchfab map is usually the building alone: no skybox, no player-clip walls, nothing past the windows. Before calling a stage done:
- **Voxelise with `--skip=<glass> --wall=<glass> --edges=void`**. `--wall` counts glass as solid when working out where you can walk, but gives it no collision, so anywhere you can only reach by climbing through a window falls out of play. `--edges=void` puts thin slabs only where the playable floor ends over nothing (no playable floor within 4 m). Don't use `--edges=1` or `--soft=glass` on a map like this: they wall every drop and every window, and they squeeze narrow walks shut.
- **`--report-cut=1`** lists walkable floor left out of play. Before you decide a room is cut off, put the player there: most patches are ceiling tops and roofs (he falls through them).
- **Prove it three ways, with the glass broken** (drop `glassCol` meshes from `player.collider.surroundingMeshes`):
  - Walk every nav link with W held, re-aiming every frame, for `(d / 2.8 + 1) s` (walking speed is about 3 m/s; a shorter budget reports false blocks). Under 1 % blocked is normal (doors, crates); anything at an invisible wall needs a look.
  - Run and jump at the nearest clip from every node within 2 m of one.
  - Run and jump at every window.
  - "Escaped" means more than 3.2 m on the ground plan from any nav node (ignoring height, or stairs count as escapes), or a drop over 2.5 m.
- **Pick the start with a roof overhead** (`!nav.clear(head, head + 6 m up)`). A "lobby" node can be the walk outside its windows.
- **Give the windows something to look at**: a sky (`env.sky` + `createSkyMaterial`, `SKY_WINTER` etc.), ground, distant blocks (`Office2.buildBackdrop`). `env.indoor()` turns the sky off and leaves a pale clear colour, which reads as "white windows".
- **Test the edges**: run and jump outward from the outermost nav nodes for a few seconds each; nobody should drop below the floor.

## Missions and dormant soldiers

`Mission.ts`-style classes drive phases. Soldiers of later phases spawn **dormant**: parked at y −500, disabled, `e.dormant = true`, woken by `enemies.wakeGroup(group)` when the mission reaches them (`WAKE` table and `go(phase)`, which also wakes skipped phases). Anything that lists soldiers must skip `dormant` ones: the radar and full map do (`Minimap`: `!e.alive || e.dormant`), and so do counts (`awakeCount`). The bug where Sandstorm's map showed soldiers who weren't there was exactly a missing `dormant` check.

## Navigation and spawns

`NavGraph` (nodes with cover flags + links from the voxel JSON; `floorAt`, `embedded`, `rayLevel`). `startSafety.secureStart` keeps posts and patrols from overlooking the insertion point. `level/Spots.wallSpots` + `Pickups.populate(walls, start, seed, fits)` place supply caches against room walls. A stage with no room walls, like the Heroes Playground, gets no caches; that's by design, not a bug.

## Physics

- `physics/PhysicsService.ts` (Havok, WASM): `init()`, `buildLevelMeshes(colliders, physicsOnly)` for voxel stages, `buildLevel(colliders)` for built ones, `step(dt)`. Collision groups in `CollisionGroups.ts`.
- What uses it: ragdolls (`EnemyRagdoll`: `activate`, `applyImpulse`, `blast`, `freeze`), dropped guns, bodies. Player and soldier movement use Babylon's `moveWithCollisions` against `colliders`, not Havok.
- Bullets, knives, melee and line-of-sight use `scene.pickWithRay` with a predicate on `metadata.kind` (`HitKind.Level` + `isPickable`, `HitKind.EnemyPart` + `enemy.alive`). New projectiles must **sweep** (a ray from the last position to the next) so they can't skip through thin walls at 30 m/s.
- `physicsOnly` meshes: drops only bodies and guns land on (the player is kept out).
- **Falling out of the level** (below `killY` = lowest floor − 4 m): back to the last grounded spot; a second fall within 3 s uses `player.rescueFloor` (the nearest nav node), so a bad spot can't loop.

## Verify

Every stage loads (`?quick=` each id), the objective text advances through the phases, the radar matches what's on the ground, no falling through floors at the spawn and at the caches.
