# Asset preparation scripts

Offline tools used to bring the Sketchfab models into the game. They need glTF-Transform, which is not a
project dependency; install it next to the scripts (outside `node_modules` of the game is fine):

```bash
npm i --no-save @gltf-transform/core@4 @gltf-transform/extensions@4 @gltf-transform/functions@4 sharp meshoptimizer
```

| Script | Used for | Example |
|---|---|---|
| `prep-weapons.mjs` | knife / launchers: bake skins, drop props (`--drop=`), cull a duplicate (`--cull-x-below=`), re-orient (`--basis=fwd,up`), scale, fix winding, metal/rough, WebP | `node prep-weapons.mjs ~/Desktop/dzj-08_rocket_launcher.glb ../../src/assets/weapons/dzj08.glb --drop=Plane --basis=0.9043,-0.0076,-0.4268,0.397,0.3823,0.8344` |
| `analyze.mjs` | principal axes and a slice profile of a model (finding the tube axis, grip side, muzzle end) | `node analyze.mjs model.glb --slices=24` |
| `prep-map.mjs` | CS Office visuals: drop snowfall + sky dome, weld, simplify, WebP | `node prep-map.mjs ~/Desktop/cs_office_csgo_real_light_version.glb ../../src/assets/maps/office.glb 0.6` |
| `voxel-map.mjs` | CS Office collision boxes, clip walls, nav nodes + links → JSON (and a top-down PNG of the playable floor) | `node --max-old-space-size=8192 voxel-map.mjs --in=~/Desktop/cs_office_csgo_real_light_version.glb --out=../../src/assets/maps/office-data.json --png=office-floor.png` |

The other commands used for the current assets:
`prep-weapons.mjs m9_bayonet_knife.glb m9.glb --scale=0.01` and
`prep-weapons.mjs law_light_anti-tank_weapon_m72.glb m72.glb --metalrough --cull-x-below=-1 --scale=0.1`.
| `prep-dust2.mjs` | De_Dust 2: textures → WebP at a size (never upscaled), the map's ad banner painted out | `node prep-dust2.mjs ~/Downloads/de_dust_2_with_real_light.glb ../../src/assets/maps/dust2.glb 2048` |

`voxel-map.mjs` for Dust 2: `--u=1.4773 --mode=all --ceil=4`.
| `prep-props.mjs` | Sandstorm props: handcuffs (308k → 4.6k triangles), locker (1024² WebP), barricade boxes (the six-crate heap split into upright crates; 512² WebP), Betamax tape (1024² WebP, flat, 15.6 cm), Commodore 64 set (cables/plugs/power brick dropped, 1024² WebP, real size). Pass `-` to skip a model | `node prep-props.mjs <handcuffs.glb or -> <locker.glb or -> ../../src/assets/props ~/Downloads/military_wooden_box.glb "~/Downloads/ration_cardboard_box (1).glb" ~/Downloads/sony_betamax_video_tape.glb ~/Downloads/commodore_64__computer_full_pack.glb` |
| `fbx-anim.mjs` | a Mixamo FBX animation → per-frame bone directions (needs `three@0.169.0`, no-save) | `node fbx-anim.mjs "~/Downloads/Sit To Stand.fbx" ../../src/assets/anims/sit-to-stand.json` |

(Install all the no-save tools in one `npm i --no-save …` command: npm removes earlier no-save packages on every install.)


| `prep-metro.mjs` | The Underground: "Roscoe Street - Underground" (Neo_minigan, CC BY 4.0): root tilt removed, one mesh per material, WebP ≤ 1024 px | `node prep-metro.mjs ~/Downloads/roscoe_street_-_underground.glb ../../src/assets/maps/metro.glb 1024` |
| `prep-soldiers.mjs` | The Underground's soldiers (Polish soldier, Soldier Girl, Winter Soldier): textures → WebP, optional simplify (was `prep-city.mjs`) | `node prep-soldiers.mjs soldier ~/Downloads/polish_soldier.glb ../../src/assets/soldier_polish.glb 1024 0.5` |

`voxel-map.mjs` for the Underground: `--u=0.01 --box=-130,-110,130,30 --outdoor=0 --edges=1` (indoor mode).

| `prep-office2.mjs` | Black Ledger: "Cs_office with real light" (Neo_minigan, CC BY 4.0): textures → WebP, geometry kept | `node prep-office2.mjs ~/Downloads/cs_office_with_real_light.glb ../../src/assets/maps/office2.glb 2048` |

`voxel-map.mjs` for Black Ledger: `--u=1.016 --mode=all --skip=glass --wall=glass --edges=void` (`--report-cut=1` lists walkable floor left out of play, to check nothing real is cut off) (the export's node scale is 0.025 per Source inch; its windows are called `glass`, lower case).
