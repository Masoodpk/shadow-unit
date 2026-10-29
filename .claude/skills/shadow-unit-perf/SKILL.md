---
name: shadow-unit-perf
description: Performance and optimisation for the Shadow Unit browser FPS (Babylon.js 9, WebGL2) — frame rate, draw calls, download size, texture memory, load time, mobile/low quality. Use it whenever the user says the game is slow, laggy, stutters, takes long to load, is too big, or asks to optimise, and before adding anything heavy (a new map, many characters, particles, lights, shadows).
---

# Performance

## Measure before changing

- **F3** perf overlay (dev builds, or with developer mode on, toggled by the backquote key).
- In a `?quick=` session: `await T.instr(120)` returns the average frame, render, active-mesh evaluation, render-target and camera times plus draw calls over 120 frames. Run it before and after, at the same spot (use `T.go(x, z, yaw)`), and report both numbers.
- Download: `ls -la src/assets/**` and the `npm run build` chunk list (`Game-*.js` is ~1.5 MB; models are fetched separately via `?url` imports).

## Levers already in the engine (use them, don't reinvent)

- **Instancing**: hitboxes and the shared enemy rifle are `InstancedMesh`es of one source (`EnemyModel`, `SoldierSkins.gun`). New repeated objects should be instances or `clone(…, true)` sharing geometry.
- **Merging per material**: `SoldierSkin` merges a character's skinned meshes by material (one draw each) and static props on the same bone.
- **Map chunks**: voxel collision boxes become 8 m chunk meshes with sub-meshes and an octree (`Office.chunkMeshes`), so picks only test nearby triangles.
- **Culling / LOD on the Heroes Playground**: `Game.setupCulling` plus `enemies.lodOf` (animation update rate drops with distance and off-screen; small parts hidden past 30 m).
- **Frozen materials**: `freezeCharacterMaterials()` and `mats.freezeStatic()` after load; unfreeze before changing a frozen material at runtime.
- **Shadows**: `refreshRate` by stage (`info.lit`); baked stages (Sandstorm, Frostline) have none, and the sun shadow follows the player on lit stages.
- **Quality setting** `low` (default on touch): smaller generated textures (`Materials.create(scene, low)`), fewer effects. Gate any new heavy feature on `low`.
- **Textures**: WebP, 1024 for characters and props, 2048 for map atlases (the full 4096 Dust 2 set needed ~1 GB of video memory and froze the browser).
- **Viewmodel meshes** are `alwaysSelectAsActiveMesh`, so keep their triangle counts reasonable.

## Rules for new work

- Allocate nothing per frame in hot paths (AI, animate, projectiles): reuse `Vector3`/`Quaternion` scratch fields like the existing code does (`tmp`, `tv[]`).
- Raycasts are the usual hidden cost: one swept ray per projectile per frame; for line-of-sight, reuse `losClear`/`nav.rayLevel`.
- Big downloads load in parallel with progress (`Promise.all` in `Game.load`/`loadWeaponRigs`); add new ones there with a progress slot, and `.catch` so a failed optional asset doesn't stop the stage (the heroes pattern).
- After an optimisation, run the regression checklist (`shadow-unit-safe-change`): optimisations are where silent visual regressions happen.
