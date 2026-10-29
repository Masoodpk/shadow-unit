---
name: shadow-unit-codemap
description: Where everything lives in the Shadow Unit browser FPS (Babylon.js + TypeScript + Vite) and how to explore it without burning tokens. Use it at the start of any task in this game, including "where is X handled", adding a feature, debugging, reading a .glb model, or when a session is getting long and you need to find code fast. It has a file map, grep recipes, a rule against reading big files and binary models, and scripts that summarise .glb files and their animation timelines.
---

# Shadow Unit code map and token economy

The repo is big (≈45k lines of TS, ≈300 MB of assets) and a careless session can spend most of its budget reading. Read the least that answers the question.

## Token rules

- **Never `Read` a .glb or a big .json asset.** Run `node .claude/skills/shadow-unit-codemap/scripts/glb-info.mjs <file>` (add `--nodes` or `--filter=<regex>`) for structure. For a packed animation timeline, run `glb-anim-activity.mjs <file> --nodes=a,b`.
- **Grep first, then read a window.** `grep -n "name" file` → `Read` with `offset`/`limit` around the hit (40–120 lines). Files over 1k lines (Game, Enemy, SoldierSkin, WeaponManager, the hero files) are never read whole.
- **One exploratory command with several greps** beats many tool calls: combine with `;`, cap with `| head -40`.
- **Screenshots cost the most:** use `scale: 0.5–0.6`, and use `javascript_tool` to return numbers (positions, states, counts) instead of eyeballing. Take a screenshot only to judge something visual.
- **Don't spawn subagents** for searches in this repo; the map below plus grep is faster.
- **Don't re-derive what's written down**: README.md sections per round, header comments at the top of each file (they're thorough, so read the first 30 lines of a file before its body).

## Map (src/)

| Area | Files | Notes |
|---|---|---|
| Boot / menu / settings | `main.ts` | menu, stage cards (`THUMBS`), `?quick=<stage>` dev boot, `window.T` dev toolbox (`installDevHelpers`) |
| Game loop hub | `core/Game.ts` | `load()` builds a stage (per-stage branches on `settings.stage`/`info.id`), `loadWeaponRigs`, `frame()/step()`, `devHotkeys()`, HUD updates, `onDetonate`, `blast` |
| Missions | `core/Mission.ts` (Sandstorm), `core/TapeMission.ts` (Frostline), `core/MetroMission.ts` (Underground) | phases, wake groups (`WAKE`), checkpoints |
| Input | `core/Input.ts`, `core/Bindings.ts` | `ACTIONS` list, `VERSION` + migrations in `load()`; `inp.hit/held(action)` |
| Dev mode | `core/DevMode.ts` | ammo/AI/time-scale cheats; hotkeys in `Game.devHotkeys` |
| Stages | `config/stages.ts`, `level/Dust2.ts`, `Office.ts`, `Office2.ts` (Black Ledger, id nightshift), `Metro.ts`, `Whiteout.ts` | `LevelData` type in `level/KestrelPoint.ts`; voxel collision + nav from `assets/maps/*-data.json` |
| Level parts | `level/NavGraph.ts`, `Doors.ts`, `Glass.ts`, `Pickups.ts`, `Props.ts`, `Spots.ts`, `Lockers.ts`, `Hostage.ts`, `PlaybackStation.ts`, `startSafety.ts` | supply caches: `Pickups.populate` |
| Soldiers | `enemies/Enemy.ts` (AI), `EnemyManager.ts`, `EnemyModel.ts` (hitbox drivers), `SoldierSkin.ts` (skinned body, `RIGS`, `RETARGET`), `SoldierAnim.ts`, `SoldierRetarget.ts`, `EnemyAnimationController.ts`, `EnemyRagdoll.ts`, `EnemyConfig.ts` | |
| Big foes / heroes | `enemies/Hulk.ts`, `Wolverine.ts`, `Batman.ts`, `Air.ts`, `RosterVillain.ts`; `allies/*` | Heroes Playground only (`heroStage`) |
| Characters (generic) | `characters/autoSkin.ts`, `roster.ts`, `factions.ts` | autoSkin rigs rigless meshes |
| Weapons | `config/weapons.ts` (stats, reload phases, grenade types, `THROWING_KNIFE`), `config/guns.ts` (static guns on shared arms) | |
| Weapon code | `weapons/Weapon.ts` (state machine), `WeaponManager.ts` (switching, ADS, shots, melee, throws), `Viewmodel.ts` (bob/sway/recoil/melee pose), rigs: `ArmsRig.ts`, `VectorRig.ts`, `CarbineRig.ts`, `KnifeRigFP.ts`, `GrenadeRig.ts` | |
| Projectiles / FX | `fx/Grenades.ts`, `Rockets.ts`, `ThrowingKnives.ts`, `Effects.ts` (impacts, blood, flashes), `Explosions.ts` | |
| Physics | `physics/PhysicsService.ts` (Havok), `CollisionGroups.ts` | |
| Render | `render/Environment.ts`, `Materials.ts`, `Sky.ts`, `TextureGen.ts` | |
| UI | `ui/Hud.ts`, `Minimap.ts`, `MissionHud.ts`, `TouchControls.ts`, `icons.ts`, `BloodScreen.ts`, `DebugOverlay.ts`; markup in `index.html` | |
| Audio | `audio/SoundBank.ts` (procedural sounds by name), `AudioEngine.ts`, `Music.ts` | `audio.play("<name>")` |

Outside src: `scripts/assets/*.mjs` (offline asset prep, see its README), `dev/*.html` (viewers: `viewer`, `gunview`, `soldierview`), `public/` (music, sfx).

## Grep recipes

```bash
grep -n "settings.stage ===\|info.id ===" src/core/Game.ts          # per-stage branches
grep -rn "Record<WeaponId\|Record<GrenadeType\|Record<SkinKind" src  # unions needing entries
grep -n "audio.play(\"" src -r | grep -o 'play("[a-zA-Z]*' | sort -u  # sound names in use
grep -n "^  [a-zA-Z]*(.*{$" src/<file>.ts                            # a class's methods with line numbers
```

## Model facts that bit us (check them with glb-info)

- Sketchfab files often carry a scale or axis swap in a **node matrix** (`--nodes` shows `m`); don't bake it twice.
- Vertex buffers are often **interleaved** (`byteStride` 32/64); read them with the stride.
- Loose meshes parented to **no bone** (patches, the model's own rifle) float when the body moves; drop them in prep.
