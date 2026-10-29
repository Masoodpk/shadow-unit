---
name: shadow-unit-assets
description: Bringing 3D models into the Shadow Unit browser FPS — Sketchfab .glb maps (new stages), soldier characters (rigged or rigless), first-person guns (static or with their own animated arms), props, textures, credits. Use it whenever the user hands over a .glb / Sketchfab model or says "add this map / soldier / gun / prop", "implement this as a stage", or asks why an imported model looks wrong (wrong size, lying down, floating parts, too big a download).
---

# Importing assets into Shadow Unit

Every asset goes through an offline prep script in `scripts/assets/` (their README lists them, with commands), then gets a small loader entry. Never ship the raw Sketchfab file: they're 10–45 MB of PNGs.

## 0. Inspect first (cheap)

```bash
node .claude/skills/shadow-unit-codemap/scripts/glb-info.mjs ~/Downloads/model.glb            # credit, meshes, skins, anims, image sizes
node .claude/skills/shadow-unit-codemap/scripts/glb-info.mjs ~/Downloads/model.glb --nodes     # transforms / matrices
```

From the result, decide:
- **Licence**: CC BY (fine, credit it); CC BY-NC or Sketchfab Standard (tell the user it's non-commercial or restricted). Credits go in `index.html` (the credits list) and `README.md`.
- **Skinned?** `SKINNED` meshes plus a skin with Mixamo-like names means retarget-ready. All-static means it needs a skeleton made at load (`autoSkin`), which only works well for a T- or A-pose. A posed static figure (rifle stance) won't look good; tell the user and ask for a rigged one, as with the CS2 T, which was replaced by the rigged SWAT operator.
- **Is it a duplicate?** Sandstorm (`level/Dust2.ts`) and Frostline (`level/Office.ts`) are already de_dust2 and cs_office. Check `config/stages.ts` and `src/assets/maps/` before building a stage twice.

Tools for the prep scripts (install outside the game's deps, in a scratch folder):
`npm i --no-save @gltf-transform/core@4 @gltf-transform/extensions@4 @gltf-transform/functions@4 sharp meshoptimizer`

## Soldier characters

1. Prep: copy `scripts/assets/prep-swat.mjs`. It drops the model's own weapon and any mesh on no bone (`part_2_low`, patches), drops its animations and turns textures into WebP at 1024. After `prune()`, re-run glb-info and check the **skin joint count is unchanged**.
2. Code: in `enemies/SoldierSkin.ts`, add to `SkinKind`, `RIGS` (bone names; `findIn` tolerates `_NN` and `#N` suffixes) and `RETARGET` (height and the bone names table). Leave `curl` unset when the fingers are already closed in the rest pose.
3. Which stages use him: the `SoldierSkins.load(scene, undefined, [...kinds])` call in `Game.load()`. `EnemyManager.attachSkins` rotates through every loaded kind except `winter` (the boss).
4. Verify on `dev/soldierview.html?kinds=mark,fsb,<new>` (see `shadow-unit-characters`).

## First-person guns

- **Static gun model** (most Sketchfab guns): a `GunSpec` in `config/guns.ts` (grip, support, magwell, muzzle and sight points in the gun frame, measured with `dev/viewer.html`). It's held by the shared M4-pack arms in `weapons/ArmsRig.ts`.
- **Gun with its own animated arms** (an "FPS animated …" pack): a rig like `weapons/CarbineRig.ts` or `VectorRig.ts`. The actions usually sit on **one timeline**: run `glb-anim-activity.mjs <file> --nodes=bolt,clip,<gunRoot>`. Quiet columns separate the clips; the magazine node's big drop is "mag out", its return is "mag in", a bolt jump is the charge. Write the ranges into a `*_CLIPS` constant with comments, as `CARBINE_CLIPS` does. Anything the file lacks (fire, melee, walk) is procedural: the bolt cycle in the rig, and melee, bob and sprint from `Viewmodel`.
- Scale: the file's own root scale is read at load (`own = |world row 0|`), and the anchor scales to metres from that.
- Then follow `shadow-unit-weapons` for the config, pickups and starting-kit rules.

## Stages (maps)

Visuals are drawn as-is (lighting baked in, unlit). Everything the game touches comes from an offline voxelisation:

```bash
node prep-map.mjs <in.glb> ../../src/assets/maps/<id>.glb ...          # or prep-dust2 / prep-metro variants
node --max-old-space-size=8192 voxel-map.mjs --in=<in.glb> --out=../../src/assets/maps/<id>-data.json --png=floor.png [--u=<unit> --mode=all|indoor ...]
```

The JSON holds solid/soft/clip boxes, nav nodes with cover flags, links, and doors. A builder like `level/Office.ts` (`build<Stage>()` → `LevelData`) loads both. Then add it to `config/stages.ts` (`StageId`, `STAGES` in play order), the thumbnail in `main.ts` (`THUMBS`) and the branch in `Game.load()`. See `shadow-unit-world` for spawns, missions and pickups.

**Unlit backdrop or prop materials:** a `StandardMaterial` with `disableLighting` still adds its white `diffuseColor`, and it **adds** `emissiveTexture` to `emissiveColor`. For a textured unlit look, set `diffuseColor` and `specularColor` to black and `emissiveColor` to black, and let the texture be the colour. Getting this wrong renders pure white.

## Props

`scripts/assets/prep-props.mjs` (simplify + WebP), placed through `level/Props.ts` placements or `Pickups`.

## Size budget

Aim for under ~8 MB per character, ~2–8 MB per gun and ~15–25 MB per map. WebP 1024 for characters and props, 2048 for map atlases. Report the before/after size.
