# SHADOW UNIT 101 (formerly Saltline)

*Operation // Kestrel Point.* A browser FPS prototype: one location, two guns, nine hostiles.
Babylon.js 9 + TypeScript + Vite. No game-engine framework, no React/Vue.

```bash
npm install
npm run dev            # http://localhost:5173  (F3 perf overlay enabled in dev)
npm run build          # production build → dist/ (code-split, overlay stripped)
npm run build:single   # one self-contained HTML → dist-single/ (used for the hosted preview)
```

Controls: see the October update below (and the in-game CONTROLS screen, where every key can be changed).
**`** developer mode · **F3** perf overlay (dev builds, or any build with developer mode on).

**Laptop / trackpad:** *Aim toggle* is on by default (menu switch): one secondary click (two-finger click,
or ctrl+click on a Mac) aims, the next one stops. While aimed, a normal click fires. Keyboard alternatives:
**F** = fire (hold for auto), **E** = aim. Sprinting or switching weapons drops the aim.

> Crouch is on **C**, not Ctrl: Ctrl+W closes the browser tab and can't be intercepted.

---

## Glass fix and full screen (October 30)

- **Glass broke when you shot a wall:** each window's collider was its bounding box. For a diagonal or L-shaped window (Black Ledger's lobby, 10 m on the slant), that box filled the room behind it, so a shot at the wall broke the window and the box blocked your way before it did. The collider is now the pane's own triangles, and shards fall from points on the glass itself (`level/Glass.ts`). Frostline's 131 straight panes still break when shot.
- **Full screen on a computer:** a **FULL SCREEN** button in the main menu and the pause menu (in and out), and a setting, *FULL SCREEN WHILE PLAYING* (on by default), that goes full screen on deploy and resume as phones already did. ESC leaves full screen and pauses, as before; RESUME goes back in.

## New stage: BLACK LEDGER (October 29)

- **BLACK LEDGER** (renamed from Night Shift; `level/Office2.ts`, stage id `nightshift`, `?quick=nightshift`): "Cs_office with real light" by Neo_minigan (CC BY 4.0), the classic low-poly cs_office with its light baked into one atlas per section. It's a different model from Frostline's CS:GO remake, though it's the same building.
  - **It plays like the other stages:** 16 soldiers (the operators and the S.W.A.T. operator) spread through the offices, patrolling or holding cover, none in sight of the insertion point. You start in the front lobby. The supply caches (all seven guns, ammo, rockets, grenades) stand against the room walls, the windows break, and the doors open. There's no scripted mission: clear the building ("CLEAR THE OFFICES"), and the round is won on the last soldier.
  - **Built the Frostline way:** the model is drawn as-is, and collision, bullets, sight and the AI's paths come from `voxel-map.mjs --u=1.016 --mode=all --skip=glass` (3,860 m² of floor, 702 nav nodes, 7,077 boxes). `--skip=` is new: this export calls its windows `glass` (lower case), and the default skip list still covers the other maps unchanged.
  - Assets: `scripts/assets/prep-office2.mjs` (textures → WebP: the map is 2.3 MB), `src/assets/maps/office2-data.json`, the menu card `thumbs/nightshift.webp` (the lobby through its window).
- **Fix for stages without a mission:** they now show their own objective. Red Dune used to rely on the HUD's placeholder text.
- **Black Ledger fixes (same day):** the export is the building alone, with no skybox, no player-clip walls and nothing outside.
  - **Edges and windows:** voxelised with `--skip=glass --wall=glass --edges=void`.
    - `--wall=<regex>` (new) counts the glass as solid when working out where you can walk, but gives it no collision (the game's breakable panes handle that). So the narrow walk outside the lobby and south windows, which you could only reach by climbing through a window, is out of play, and the windows onto it are closed for good, broken or not. Windows between rooms stay breakable and passable.
    - `--edges=void` (new): a thin invisible slab only where the playable floor ends over nothing (no playable floor within 4 m out; 4 m so desks and counters don't count as drops), with posts at outside corners.
    - Checked three ways. Walking every nav link with the glass broken: 9 of 2,973 blocked (0.3 %), by doors, a supply crate and a garage platform edge. Running and jumping at the edge from all 445 nav nodes near an invisible wall, windows broken: 1,335 runs, no falls, nobody more than 2.8 m from playable floor. Running and jumping at all 13 windows, broken: nobody got out.
  - **Start:** moved from the walk outside the lobby windows to inside the lobby (the start must have a roof overhead).
  - **Backdrop:** a winter sky, snow-covered ground and a ring of office blocks with lit windows (`buildBackdrop`), instead of white.
  - **No falling loop, every stage:** a fall out of the level returns you to where you last stood, as before. If that drops you straight out again within 3 s, `PlayerController.rescueFloor` puts you on the nearest nav node instead, which is always real floor.
  - `voxel-map.mjs` has two new opt-in options: `--skip=<regex>` and `--soft=<regex>`.

## Two stages, a mixed garrison and a new carbine (October 28)

- **Red Dune is gone.** The stage list is now Sandstorm (Dust 2), Frostline (the office), the Underground and the Heroes Playground; the game opens on the first. (`level/KestrelPoint.ts` keeps only the shared level types.)
  - Sandstorm and Frostline were already built from the same two maps you sent (Neo_minigan's "real light" versions, with their baked light, collision and nav data), so they stay as they are.
- **The S.W.A.T. operator** ("S.W.A.T. Operator" by Mateusz Woliński, CC BY 4.0) joins the garrison on Sandstorm and Frostline, in turn with the two operators. He's a real Mixamo rig with his own skin weights, so the mocap is retargeted onto him like the Underground's soldiers (`RIGS.swat`, `RETARGET.swat`). `scripts/assets/prep-swat.mjs` drops his own rifle, his two loose patches (meshes on no bone) and his idle clip, and turns his 45 maps into WebP (30 MB → 7.7 MB). He replaces the Counter-Strike T, which was a posed mesh with no rig and never moved well.
  - `dev/soldierview.html?kinds=mark,fsb,swat` lines the characters up side by side under one animation input (`S.set({ speed, vz, aim, crouch, reload, aimZ })`), for checking a new soldier against the others.
- **Throwing knives** (`fx/ThrowingKnives.ts`, `THROWING_KNIFE`), done the way Call of Duty does its lethal knife. You carry 3, on the grenade belt (**B** cycles to them).
  - **Throw knife** (**P** or mouse side button) quick-throws from whatever you hold. Hold the key and the knife comes up blade-first in the throwing hand, ready; let go and it's thrown overhand. There's no pin, and the throw is quicker than a grenade's.
  - It flies fast (31 m/s) and nearly flat with a little drop, end over end, swept every frame so it never passes through a thin wall.
  - It goes in tip first and stays: in a wall or crate, or in a soldier. In a soldier it rides the bone it hit (his skin's nearest bone, not the hitbox, so it falls with him).
  - It's silent. A hit kills an ordinary soldier anywhere on the body; the boss survives one in the body.
  - Walk over a stuck knife, or the body it's in, and it's yours again. Grenade crates refill them.
- **The tactical carbine** ("fps animated carbine" by DJMaesen, CC BY 4.0, `weapons/CarbineRig.ts`, `WEAPONS.carbine`) is a pickup: it lies on a crate with an ammo can beside it on every stage that has supply caches. Taking it (use key) swaps it for the rifle you carry; the M4 stays the starting rifle. Its one 7.4 s timeline is read in `CARBINE_CLIPS`: empty reload (mag out, in, bolt released), tactical reload (with the charging handle racked) and an inspect (**.** period). The rig supplies what the file has no clip for: the bolt cycling on every shot and staying back on an empty magazine. Butt-strike (**V** / middle mouse), walking, sprint, aim, crouch and landing come from the shared viewmodel.
- **Radar fix:** soldiers a mission holds back for a later part of it (Sandstorm's west site and yard, the Underground's later halls) are no longer drawn on the radar and the full map until they're in play. Before, the map showed them at their posts while they were still waiting under the world, so you found nobody there.

## The air war, Whiteout, Superman's grab and jet takedown, tougher villains (October 20, round 6)

- **New stage: WHITEOUT** (`level/Whiteout.ts`, stage id `whiteout`, `?quick=whiteout`).
  - **Ground:** a forward outpost on a flat, frozen plateau, about 180 × 180 m of packed snow. It has a concrete command bunker, fuel tanks, container stacks (Spider-Man's and Wolverine's perches, and Deadpool's container), barriers, trucks, snow-capped boulders and drifts.
  - **Mountains:** on every side, foothills and ridged peaks up to about 400 m. They're one generated terrain mesh (no download): rock on the steep faces, snow on the rest, aerial haze baked into the colours.
  - **Trees:** frosted pines in stands just off the plateau.
  - **Weather:** a cold bright sky (`Environment.winter()`, `SKY_WINTER`) and falling snow (`fx/Snowfall.ts`).
  - The whole hero fight plays there, the same as on Red Dune.
- **The air war (`enemies/Air.ts`)** starts once the Hulk lands.
  - **Gunships:** two of them ("Helicopter Gunship"; "Mil Mi-28NM Havoc", which is CC BY-NC-SA) circle 35–50 m out, firing chain-gun bursts and pairs of rockets. If both are shot down, they come back once a minute later.
  - **Jets:** a strafing run every 25–35 s (F-15, YF-23, F-50 in turn): two homing missiles and the cannon, then round again, three passes each.
  - **Bomber:** the B-2 makes one high run at 90 s, walking a stick of bombs across the fight.
  - **Shooting them down:** they take your bullets and rockets. Gunships spin down burning; jets fall trailing smoke and hit the ground in a fireball.
  - **Iron Man** fires homing repulsor bolts at them between his own moves.
  - **Superman** goes up after them and tears them apart; jets split in two.
  - When the last villain's down, the gunships fly off.
- **Superman:**
  - **Jet takedown cinematic (4.2 s, at most one a minute):** he rockets up head-on at a jet with a sonic boom, catches its nose and holds it shuddering, rips it in two in a string of fireballs, then flies out of the blast toward the camera.
  - **Grab and slam:** he grabs Wolverine, Batman or a soldier, flies 22 m up, lands three blows, then hurls them down. Soldiers die; Wolverine and Batman take 160 when they hit the ground.
  - **Freeze breath:** no longer straight after he arrives. He waits 24 s and at least four heat-vision or punch moves first.
- **Batman:** throws the real batarang model (12 damage to you, 26 to a hero) and carries a pistol, five quick shots from range. On Whiteout and Red Dune he goes for Superman first.
- **Rivalries:** Deadpool goes for Wolverine and Wolverine for Deadpool; Superman goes for Batman.
- **Tougher villains:** Hulk 3400 HP (was 1700), Wolverine 2300, Batman 2500. In a full simulated Whiteout run the villains went down at 267, 318 and 321 s, and the stage was won at 351 s.
- **Reinforcements:** each hero's arrival brings four more soldiers, one every 2.6 s. They wake out of your sight 26–60 m away, up to 18 in all.
- **Radar and map:** the heroes (SP, IM, DP, S), the big foes (HULK, W, B) and the aircraft are marked with labelled arrows.
- **Fixes:**
  - The Hulk knocked out mid-leap now falls and hits the ground; he used to die in the air.
  - Heroes' feet no longer sink into the floor on landings and kneels. A pose that puts a toe, foot or knee below the ground lifts the body (`plantFeet`).
  - Wolverine's claws no longer appear at his feet. His model has four fingers, so the claws were placed against a missing fifth one.
- **Assets:** `scripts/assets/prep-air.mjs` prepares the aircraft (with the Mi-28 and F-50 simplified) and the batarang.

## Batman and the Batmobile, Superman, a new Deadpool, and Wolverine's top shot (October 20, round 5)

- **Arrival order (Red Dune):** Hulk → Spider-Man → Wolverine (enemy) → Iron Man → Deadpool → **Batman (enemy, 30 s after Deadpool)** → **Superman (ally, 25 s after Batman lands)**. In a full simulated run they arrived at 0 / 51 / 97 / 136 / 172 / 213 / 247 s and the stage was won at 312 s.
- **New dev keys:** **[** Batman · **]** Superman (with 8 Hulk · 9 Spider-Man · 0 Iron Man · − Wolverine · = Deadpool).
- **Batman (`enemies/Batman.ts`)** — "Batman Rigged (HatchXR)" by nitwit.friends; his car is "Arkham Knight Batmobile (ADVANCED RIG)" by northsideanimation (simplified from 300k to 107k triangles by `prep-heroes3.mjs`).
  - **Entrance (8.4 s, skippable):** the Batmobile comes down 55 m of open ground at you, afterburner lit, its wheels rolling with its speed. It power-slides broadside on, with a skid and dust. The canopy opens (the model's own morph), he rises out of the seat, flips over the bonnet and lands in front of you. The car stays parked, and you can't walk through it.
  - **Fighting:**
    - Combos with his own punch and the mocap hooks, elbows and kicks; between them he circles you in his guard.
    - A flying kick.
    - A fan of three batarangs, which stagger the heroes.
    - A smoke pellet: he vanishes and reappears behind his target with a takedown.
    - Rolls out of heavy fire.
    - His armour cuts bullet damage to a third.
  - He's a `Foe` like the Hulk and Wolverine: the heroes split between all three (`Game.foeFor`).
- **Superman (`allies/Superman.ts`)** — "Superman (Textured) (Rigged)" by CAPTAAINR. His "Base_" bones are renamed to Mixamo's, the missing Spine2, head-top and hand-middle are added as bone-less nodes, and his cape bones and eye sockets are kept.
  - **Entrance (6 s):** a sonic boom high overhead, a white contrail streaking down, and a landing that cracks the ground and shakes your view. He rises hands on hips with the cape moving, says his line, and goes straight up into the fight.
  - **Flight:** banked and flat along the line of flight, one fist forward. Past about 24 m/s there's a shock ring, a boom, a vapour cone and a contrail.
  - **Power punch:**
    - A soldier dies in one blow and the body flies; a test punch sent one 36 m.
    - Wolverine and Batman are thrown far.
    - Even the Hulk is driven back across the ground and staggers.
  - **Heat vision:** two red beams from his eye sockets, burning (scorch marks). Soldiers die in it.
  - **Freeze breath:** a cone of frost. Anyone on the enemy side who stays in it freezes inside a shell of ice crystals (`fx/SuperFx.ts`).
    - Soldiers never come out of it: after 3.2 s the ice shatters and they die.
    - Wolverine and Batman break out after about 3.6 s.
    - The Hulk smashes out after 2.2 s with a roar.
    - It never freezes you or the heroes.
  - **Cape:** three simulated strands of five bones each. They react to gravity and to the air of his own movement, flutter, stay tied to each other and stay off his back, so the cape streams in flight and falls round him when he stands.
- **Deadpool:**
  - **Model:** now "Deadpool MMD PORT FBX" by Izann2842_o, driven by its own MMD skeleton. `prep-heroes3.mjs` renames its bones by their place in the skin and re-hangs the upper body under the pelvis. The swords on his back and the guns on his hips are part of the suit; the sci-fi blasters are still in his hands, and his fingers close round them.
  - **New moves:** a knee-slide firing both guns, and a gun-kata spin with each gun firing as it sweeps past the target.
- **Wolverine:**
  - **Entrance:** now opens with a drone shot straight down on him crouched on the container, and adds a high orbit round him after the landing, so he's seen whole both times.
  - **New moves:**
    - A lunge that dashes through his target.
    - A spinning claw slash that hits everyone round him.
    - A rising slash that throws you up.
  - **Visuals:** pale slash trails behind the claws.
- **Sound:** synthesised effects for heat vision, freeze breath, the sonic boom, ice forming and shattering, the super-punch, the Batmobile's engine and skid, batarangs and the smoke pellet.
- **Assets:** `scripts/assets/prep-heroes3.mjs` prepares `deadpool2.glb`, `batman.glb`, `superman.glb` and `batmobile.glb`.

## Wolverine, a rigged Spider-Man, Deadpool's blasters, and dev summon keys (October 19, round 4)

- **Arrival order (Red Dune):** the Hulk → Spider-Man 45 s after the Hulk lands → **Wolverine (against you)** 40 s after Spider-Man → Iron Man 30 s after Wolverine lands → Deadpool 30 s after Iron Man. In a full simulated run they arrived at 0 / 51 / 97 / 136 / 172 s.
- **Developer mode summon keys** (dev mode on with **`**): **8** Hulk · **9** Spider-Man · **0** Iron Man · **−** Wolverine · **=** Deadpool. Each one plays its entrance now; a hero who's already in, or a key pressed during another cinematic, just shows a toast. (F-keys were avoided: on a Mac they're brightness/media keys.)
- **Wolverine (`enemies/Wolverine.ts`):** "Wolverine | Rigged | Deadpool And Wolverine" by K Animator (CC BY 4.0), a 3ds Max Biped skeleton.
  - `HeroRig.ts` now takes a bone-name map (`BIPED`: Pelvis → Hips, Clavicle → Shoulder, UpperArm → Arm, Finger2 → HandMiddle1 …). Its twist bones (upper arm, forearm, thigh) are kept fixed to the bones they twist with, so the skin follows.
  - **Claws:** three adamantium blades per fist, made in-game, out from between the knuckles. They extend with a "snikt".
  - **Entrance (9 s, skippable):** crouched on a container you can see, a growl. Then close on his fists as the claws come out, one at a time. He rises and roars, flips down off the box, and lands in front of you hard enough to shake the ground. The last cut is from beside you.
  - **Fighting:**
    - Claw flurries in close (the mocap combos, every blow checked for reach). Between flurries he circles you, low, waiting.
    - A pounce from 5–13 m that knocks you down.
    - A roll out of heavy fire.
    - A one-time berserker rage below 42%: faster and harder.
    - Healing factor: 7 hp/s after 3.2 s unhurt. Bullets do half damage.
    - He goes for whoever is close and hurting him most: you, or any of the heroes.
  - He's a `Foe` like the Hulk: the heroes read his wind-ups, Spider-Man can web him (but not ride him), and he has a health bar under the Hulk's. The Hulk ignores him. The win needs him down too.
  - **Heroes split between the two:** each hero fights whichever of the Hulk and Wolverine is after them, or else the nearer one, and sticks with that choice for 2.5 s (`Game.foeFor`).
- **Spider-Man:** now "Spiderman Rigged" by nitwit.friends (CC BY 4.0), with a real Mixamo skeleton and fingers.
  - His own clips are read off the skeleton at load: his run (arms down and pumping), his idle stand, jump up and down, swing start and end, and his dances (silly, hip hop, moonwalk) after a win.
  - His fingers make fists for punches.
- **Deadpool:**
  - **Body:** he's re-rigged on his own artist's skin weights. His model's skeleton can't be posed as it comes (limbs hung off the root, the torso chain running head-down), so its joints now place ours and its weights are moved over onto our bones (`ArtistSkin` in `SpiderRig.ts`). His knees and hips bend where the artist painted them; the old distance-weighted auto-rig stretched his legs. His skin is kept by `scripts/assets/prep-heroes2.mjs`.
  - **Weapons:** the katanas are gone, and he carries a "Scifi Gun" (by Max, CC BY 4.0) in each fist, firing red plasma bolts that fly at about 80 m/s.
  - **Gun-kata:**
    - Strafing runs round the target with both arms out.
    - A kick-and-elbow combo finished point-blank with both guns.
    - A firing back-flip out of trouble.
    - A leap over the target, shooting down, with a stomp on landing.
    - A charged twin blast (both muzzles glow) when the team's heavy hit is free.
    - The guns overheat and he vents them.
  - He has lines for Wolverine, and Wolverine has one for him.
- **Iron Man up close:** a dive that got interrupted used to leave his steering switched off, so he coasted away at maximum height. That's fixed. His firing positions are also nearer (5–8.5 m out, 1.6–3.4 m up) and he goes in with his fists more often. Over 60 s of fighting the Hulk, his median distance went from 30 m to 5 m, and his median height above the Hulk from 12.7 m to 2.9 m.
- **Asset prep:** `scripts/assets/prep-heroes2.mjs` (Spider-Man, Wolverine, the sci-fi gun, and Deadpool with his skin kept). `spiderman.glb`, `deagle.glb` and `katanas.glb` are no longer loaded.

## Deadpool, the arena, and the heroes after the Hulk (October 19)

- **Deadpool (`allies/Deadpool.ts`)** arrives 45 s after Iron Man has landed.
  - **Model and weapons:** his model's own skeleton is unusable (every joint at his feet), so `scripts/assets/prep-deadpool.mjs` drops it and he's rigged at load like Spider-Man (`SpiderRig`, now multi-mesh). His katanas sit crossed on his back and his Desert Eagles are in his fists.
  - **Entrance (about 10 s, cinema camera, skippable with F or Space):** a container in the arena shakes and bangs, and he complains from inside. He kicks the doors open on their hinges (the model's own door parts are re-hinged at its corners, closed at the start), with a crash and a dust ring. He steps out, points at the Hulk with his line, and raises both guns. The cuts go: on the container, low into it, on him, then over his shoulder at the Hulk.
  - **Fighting:**
    - Fast zig-zag approaches from the flank.
    - Katana combos (your Punch To Elbow Combo and three MMA kicks, plus the punches), with the swords drawn into his fists and every blow checked for reach.
    - A leaping Smash.
    - Dual Desert Eagles: hit-scan, seven rounds each, reloads, tracers and muzzle flashes.
    - Rolls and back-flips out of the Hulk's attacks.
    - Taunts, the occasional look at the camera, and lines for everything.
  - **Healing factor:** 7 hp/s after 3 s unhurt; after a knockout he's back up in 6 s at 80%.
- **The arena:** Red Dune is extended north (x −20…115, z 44…95) with open sand, a few boulders, barriers, a truck and a container stack. The north fence between base and arena is gone.
  - **Shadows:** the sun's shadow box now follows the player. It used to be fixed over the old map, and past its edge the arena rendered black.
  - **Brighter evening:** more sun and sky light, thinner haze, higher exposure (Red Dune only).
- **After the Hulk goes down:**
  - Spider-Man, Iron Man and Deadpool go after the remaining soldiers. Each gives up on one they can't reach for a while and takes the next; Deadpool looks for a spot with a view.
  - When every enemy is dead, Iron Man says his line and flies up into the sky and away.
- **Other fixes:**
  - Spider-Man's arms swing low like a runner's, with the elbows bending as he speeds up.
  - Spider-Man has a fuller back and chest (`Bulk` at rig time).
  - Iron Man's flying arms both sit back along his sides.
  - The heroes' blows hurt the Hulk more (×1.5) and flash him red.
  - The Hulk's thrown rock uses the level's rock material.
  - The soldiers' aim point is their body centre, so the allies' shots land.

## Iron Man, cinematic entrances, and a Hulk who fights everyone (October 19)

**Third pass:**
- **Iron Man's model:** now "Iron man Flying animation" by 19503 (CC BY 4.0). It has a real Mixamo skeleton with fingers, the armour's own textures, and Mixamo's flying clip. `scripts/assets/prep-ironman-rigged.mjs` simplifies it from 142k to 49k triangles, keeping the skin, with WebP textures (4.8 MB).
  - `allies/HeroRig.ts` (`SkinnedModel`/`SkinnedRig`) poses the model's own bones with the same bone-direction poses as Spider-Man, and reads the flying clip off the skeleton at load so it blends with everything else.
  - Fingers curl into fists for punches, the dive and the brace, and open for repulsors and flight.
  - The other file, "Iron Man Flying (rigged) Animated", has no skeleton, animations or textures, so it isn't used.
- **Thruster fire (`allies/IronFx.ts`):** each boot and palm has a flare (an orange halo, a hot core, a white centre) and a plume of fire sprites. The plume runs from white-yellow through orange to a smoky red, inherits his motion so it trails behind him, and throws shock-diamond sparks at full thrust. Everything is camera-facing quads in one additive mesh drawn in one call; the size and rate follow the thrust.
- **Cinematics (a cinema camera with the game's post-processing, plus a spring arm so it never ends up inside geometry):**
  - **Spider-Man:** stands on the container looking down at the Hulk. A drone shot from straight above comes down and round, then follows him from behind as he leaps.
  - **Iron Man:**
    1. A low shot from near the landing spot looks up as he dives in out of the sky.
    2. A low close angle as he drops the last metres on blazing boots.
    3. A push-in on the landing (one knee, fist down, shockwave ring and dust).
    4. Over his shoulder as he turns and raises a charging palm at the Hulk.
- **The Hulk fights Iron Man too:**
  - **Throwing:** he tears up a chunk of ground and throws it at anyone in the air out of his reach, leading the throw. The allies see the rock coming in `threat()` and dodge.
  - **Turns:** the longer he's left someone alone, the more they're on his mind, so everyone gets a turn.
  - **Lower hover:** Iron Man holds his firing position lower (2.8–5 m), where claps, throws and leaps reach him.
  - **Measured over 100 s with you firing:** you 47%, Spider-Man 32%, Iron Man 21%, with 15 target switches.

- **Order of arrival:** the Hulk lands first. 45 s later Spider-Man has a **cinematic**: letterboxed, your view turns and zooms to frame him lounging on the container while he delivers his line, then follows his leap into the fight. Another 45 s later, **Iron Man** arrives the same way:
  - You hear his thrusters first, then he dives in out of the sky from 60 m out and 38 m up, braking on his boots.
  - He drops the last 5 m upright, lands on one knee with a clank, dust and a camera shake, rises, turns to the Hulk, and raises a charging palm with a line.
  - The Hulk holds back during both entrances (`HulkHost.holdFight`). The soldiers go passive and your controls are off until the cinematic ends.
- **Hulk targeting (`pickTarget`):**
  - Threat counts, but only up to a cap.
  - Recent close-range hits, being in his face, line of sight and reachability all count.
  - Someone hovering out of reach counts for less.
  - He sticks with a target about 7 s, then gets restless.
  - **Measured over 90 s with you firing:** 56% on you, 44% on Spider-Man, 12 switches. He goes for Iron Man when Iron Man comes in low.
  - Mid-leap he swats anyone in the air in his path, and he leaps up at someone hovering just overhead.
- **Iron Man (`allies/IronMan.ts`).** "Iron Man" by Grant Riley (CC BY-NC) is a static mesh. `scripts/assets/prep-ironman.mjs` joins it into one mesh and simplifies it from 142k to 49k triangles with 2048² WebP textures (30 MB → 5 MB). `SpiderRig` rigs it at load, with landmarks measured from his own proportions (`auto`) and a scale from millimetres to 1.95 m.
  - **Flight:** a thrust model. He accelerates toward a goal, arrives and brakes, with a dash mode, and gravity takes over when he's thrown.
    - **Safety:** a look-ahead for walls (push off and up), an altitude band of 1.2–22 m, and the map bounds.
    - **Body:** pitched into the flight by speed (prone at full speed), banked by dodges.
  - **Thrusters:** flames from both boots and both palms (palms off while aiming). Their intensity follows acceleration, with one light (warm, or blue-white for the beam) and a roaring loop whose volume and pitch follow the thrust.
  - **Repulsors:**
    - Single shots alternate hands. Bursts are 3 shots. A charged blast takes 0.9 s with glowing palms.
    - The arm aims at the Hulk with the hand bent back so the palm faces him, and bolts leave the palm toward the target (never backwards).
    - Hits are tested against the Hulk's body line (pelvis to head) or the level, with a cyan energy flare, ring and sparks (`Explosions.energy`).
  - **Unibeam:** settles, faces the Hulk and charges the chest for 1.2 s (the glow is the warning). Then a beam lasts about 1.5 s, tracking him with a lag, cut by walls, ticking damage. The last tick can stagger him once (the existing 8 s stagger cooldown). It has a 22–28 s cooldown.
  - **Melee:**
    - **Dive:** he rises above and behind the Hulk, dives fist first, and the punch lands only on real contact. Then he recoils back into the air.
    - **Close punches:** thruster-assisted hook and punch, checked for reach, with a second strike if the Hulk is still close.
  - **Defence:** he dodges the Hulk's telegraphed attacks in the air. When it's too late to dodge a punch he braces (armour takes 18% instead of 42%). He tumbles when thrown and his thrusters catch him after 0.75 s, or he lands hard and gets up. A knockout lasts 9 s, then he comes back at 55%.
  - **Teamwork (`allies/Team.ts`):** a shared board, so heavy hits (dive, unibeam, Spider-Man's flying kick and ride) don't stack.
    - Combo A: the Hulk turns on Spider-Man → Iron Man fires a burst from a clear firing position.
    - Combo B: the Hulk is busy (on Spider-Man, webbed, bucking a rider, staggered) → Iron Man dives in.
    - Combo C: the Hulk is on you → a burst to draw him off, and Spider-Man webs him.
    - **Firing position:** he holds a spot off your line of fire and away from Spider-Man, in sight of the Hulk, and keeps up single shots.
  - **Balance:** in testing over 90 s with you firing, the damage split was you 60%, Spider-Man 20%, Iron Man 20%.
- **Limitations:** Iron Man's model has no finger bones (palms are aimed by the wrist) and no moving armour plates. Mixamo flying and hovering clips could replace the hand-keyed flight poses.

## Spider-Man joins the fight on Red Dune (October 19)

**Second pass (October 19):**
- **Entrance:** he isn't there at the start. 45 s after the Hulk has landed and roared, he's found lying on his side on top of a container you can see (8–24 m off, clear of the Hulk), head propped on his hand, one knee up. He calls out a line to the Hulk (shown as a subtitle), flips off the container and joins the fight.
- **Riding the Hulk:** like the films, he leaps onto the Hulk's back and pounds his head every 0.45 s. The Hulk (new `buck` state, `Hulk.mount()`) thrashes and roars, then after 2.4–3.8 s reaches back and hurls him off (`Combatant.thrown`).
- **Soldiers:** he also takes soldiers out mid-fight when the Hulk is busy with someone else. His kills count like yours.
- **Quips:** a few lines at the entrance, on a web hit, on the Hulk's back, when thrown, and at the Hulk's knockout, on a cooldown.
- **Walking:** a natural walk (the soldiers' walk legs) at 1.7 m/s, with arms hanging and swinging against the opposite leg. The arms bend more as he runs and sprints. When there's no fight he stands relaxed with his arms down.
- **Poses from the reference images:**
  - Wall crawl: one arm reaching high, the other low by his ribs, knees out like a frog.
  - Cling: when he holds still on a wall.
  - Rooftop crouch: hands planted wide.
  - Reclining pose for the entrance, and riding poses on the Hulk.
- **Body physics:** he leans into speed and acceleration and banks into turns. Light landings give at the knees; hard ones go to the three-point landing.
- **Webs (`WebFx`):** each strand is a braided ribbon, a soft streaked core with two thin fibres twisting round it. It's camera-facing per segment, tapered at the ends, sags while slack and goes taut under his weight, and wobbles for a moment when fired. A splat of short strands marks where it sticks.

**Spider-Man (`src/allies/`)** is your ally on Red Dune. He follows you, takes down a soldier now and then, and when the Hulk lands he fights him with you.

- **Model:** "The Amazing Spiderman" by iqbalmulyawan is a *static* mesh in an A-pose, with no skeleton and no animation. `SpiderRig.ts` rigs it at load time:
  - It measures the mesh (crotch, the line of each arm, the feet) and builds a Mixamo-named skeleton of 29 bones.
  - It weights each vertex to up to four bones by distance, fenced by side and region, with a rigid head.
  - It links the bones to transform nodes, so the hostage's direction posing (`alignDir`) drives him.
  - The texture and proportions are the model's own. The material is switched from unlit to lit, with a little self-illumination so he reads against the low sun.
- **Moves (`SpiderPoses.ts`):** every move is stored as bone directions.
  - **Baked:** the soldiers' run, sprint, roll, side-steps and fall (`scripts/assets/bake-soldier-dirs.mjs`), plus Mixamo Punching, Combo Punch, Right Hook and Kicking (`fbx-anim.mjs`). They live in `src/assets/anims/spidey-clips.json`, with the strike frames measured.
  - **Hand-keyed:** fighting stance, rooftop crouch, three-point landing, swing, flip tuck, flying kick, hit flinch, the two-phase wall crawl, and the web-shot arm (aimed live).
  - **Running:** the arms are re-posed into a sprinter's swing over the rifle-carrying clips.
  - **Blending:** poses are blended by smoothing toward the target, so moves blend rather than snap.
- **Getting about (`SpiderMan.ts`):** his own kinematic body against the level's collision boxes, using NavGraph rays.
  - **Ground:** the nav graph, with vaults over low obstacles.
  - **Jumps:** ballistic.
  - **Swinging:** a rope constraint with gravity and a pump, the line reeled in so the arc clears the ground, released at the top of the arc, then chained onto the next anchor. Anchors are about 400 points on the top edges of tall boxes, each checked to really be on a box, with a line-of-sight check before attaching.
  - **Walls:** wall crawling, sideways round overhangs, and a mantle over the top edge onto roofs.
- **Fighting:** behaviour states are follow, explore (perch up high), search, approach, swing, climb, dodge, web, melee, air, assist, reposition, recover and victory.
  - **Flanking:** he goes in from the side away from your line of fire.
  - **Combos:** he never repeats the same move twice running, and usually flips or dashes out after a combo.
  - **Flying kick:** from range, off a perch, or off a wall.
  - **Dodging:** he reads `Hulk.threat()` (attack kind, reach, cone, time to impact). After a 0.05–0.2 s reaction he flips back from fists, jumps sideways out of the clap's cone, and clears leap or slam circles. Late reactions get hit.
  - **Web restraint:** a web shot holds the Hulk for about 1.5 s, less each time in quick succession, then he's immune for 6 s, so there's no stun-lock. Strands pin his limbs to the ground.
  - **Helping you:** if you're down or low on health he webs the Hulk, or hits him hard enough to turn him.
  - **Taking hits:** he can be punched, thrown and knocked out. He gets up after 9 s at 55% health.
  - **No interference:** he has no collider and no hitboxes. Your bullets and blasts don't touch him, he keeps out of your way, and he never touches your camera.
- **Hulk changes (`enemies/Hulk.ts`):**
  - **Targets:** he fights a list of combatants (you plus allies). He picks a target by threat (who's hurt him lately), distance, sight and reachability, and sticks with it for 3.5 s.
  - **Area attacks:** punches, the clap and landings hit whoever's in range.
  - **New interface:** he exposes `threat()`, `web()`, `bonePos()` and `size` to allies. `applyHit` takes an optional `source`.
  - **Open ground only:** he never goes inside rooms or sheds. "Inside" means roofed *and* walled in on at least 5 of 8 directions, so he still runs under catwalks. He paths only over open nodes and links. If you're inside, he waits at the nearest reachable open spot that can see you and roars at the doorway. Leaps only land on open ground.
  - **Thunderclap timing:** never straight after a landing (entrance, leap, ground-pound). It needs 2.5 s, plus a punch or 1.5 s of running since he came down.
  - **Footfalls:** heavy thuds synced to his feet (each foot's lowest point in the stride). Four steps cut from "Heavy Walking Footsteps" (`public/sfx/hulkStep-1..4.wav`) are layered over the synth sub-thump, with camera tremble when you're close.
  - **Movement fix:** he steps up 0.65 m at most. He used to ratchet up onto tall boxes and get stuck there.
- **Limitations:**
  - Soldiers don't target Spider-Man.
  - The rig has no finger bones, so there's no "thwip" hand sign.
  - Swings are short on a low-rise map.
  - Wall crawling sticks to box faces; corners are left by dropping off.
  - Mixamo has proper web-swing and wall-crawl clips; with a Mixamo account they could replace the hand-keyed poses through `fbx-anim.mjs`.

## Round 3 — Shadow Unit 101

- **Names**: the game is *Shadow Unit 101*. The stages are **Red Dune** (formerly Kestrel Point) and **Frostline** (the Office). Each stage card shows a rendered thumbnail (`src/assets/thumbs/`). DEPLOY is now **LAUNCH MISSION**.
- **HUD** (`ui/Hud.ts`, `ui/icons.ts`): a shooter-style weapon panel. Bottom right shows the weapon silhouette, a large magazine count over the reserve, and tactical and lethal grenade icons with their counts and key chips. The weapon list only appears for about 2 s after a switch.
- **Blood**: hits on the player paint screen blood on the side the shot came from (`ui/BloodScreen.ts`), heavier at low health. Hits on enemies leave splatter decals on the wall behind them and on the floor (`fx/Effects.ts`, a pool of 48).
- **Glass** (`level/Glass.ts`): a broken pane throws 34 triangular shards. They fall under gravity, spin, bounce with a tinkle, come to rest flat, and fade after 14 s.
- **Music** (`audio/Music.ts`): two procedurally composed tracks. The menu theme is 66 BPM in A minor; the Frostline combat theme is 92 BPM in D minor, with a snare backbeat, braams and a distorted bass. Adjust them with the MUSIC slider in Settings. To use licensed tracks instead, see `public/music/README.md`.
- **Red Dune**: a new container depot (x 47–115) and 6 more enemies, for 15 in total. Props are instanced (`level/Props.ts`): shipping containers stacked up to three high, a Ural army truck and a tank transporter, which replace the old box trucks. Colliders stay simple boxes.
- **Knife**: `knife_animated.glb` with its own arms (`weapons/KnifeRigFP.ts`). Left click cycles three slashes; the heavy attack stabs.
- **Fixes**: Babylon 9's `Quaternion.FromLookDirectionLH` points +Z away from the look direction. The new `lookRotation()` in `core/math.ts` replaces it, so bullet holes, blood and scorch decals face the camera and rockets fly nose first. Two false doorways are gone: one in the Red Dune breach hole and one in the Frostline yard.
- **Licences**: Knife animated (DJMaesen), Shipping Containers (Arsen Ismailov), Psx Cargo Containers (Brainsick Games), Army Truck (foxyvfx7867) and Transformers Universe: Army Truck (Primus03) are all CC BY 4.0 and credited in-game.

## October update — menus, rebinding, prone, lean, knife, rockets, Office stage

All of the following is in and verified in the browser (`npm run build` passes):

| Area | What changed | Where |
|---|---|---|
| Start flow | Title screen (engine downloads behind it) → main menu (Play / Settings / Controls / Credits) → stage select → stage loading → click to engage. "Main menu" in pause / results returns here. | `index.html`, `src/main.ts` |
| Settings | Sensitivity, field of view, master volume, ambience (wind) volume, graphics, aim toggle, sound, developer mode — saved per browser | `src/main.ts` |
| Controls | Every action rebindable, two keys each, mouse buttons too. Click a key, press the new one; Esc cancels, right-click clears; a key moves off the action that had it. Saved in `localStorage` (`saltline.binds`). In-game prompts show the bound key. | `src/core/Bindings.ts`, `src/core/Input.ts` |
| Prone | **Z**: lie down / crawl (1.15 m/s), eyes 40 cm up, steadier aim (spread ×0.65 of crouch), less recoil. Jump or crouch gets up. Enemies spot and hit a prone player less. | `PlayerController`, `Enemy.perceive/shoot` |
| Lean / peek | Hold **Q / E**: the head moves 42 cm sideways (34 crouched, 18 prone) with a roll; the offset is ray-clamped so the eye — and every shot — never enters a wall. If only your head shows past cover, enemy hit chance drops to 45 %. | `PlayerController.updateCamera` |
| Enemy peek | In cover, if rising doesn't clear the cover the soldier leans out of the open side (spine roll, eye offset that matches the visible head), and cover spots on corners count as peek spots. | `Enemy.pickLean`, `SoldierSkin` lean |
| Health | 100 HP shown, incoming damage ×0.53 (as tough as 150 HP), regenerates 4 HP/s after 5 s without a hit | `config/game.ts` |
| Reloads | 1.45× faster for every gun (animation, sound and ammo stay in sync) | `RELOAD_SPEED` in `config/weapons.ts` |
| Ambience | Wind 0.22 → 0.10 (and a settings slider); the Office plays a faint indoor wind only | `AudioEngine.startAmbience` |
| Cursor | Hidden in game, also when pointer lock isn't available | `styles.css` (`body.ingame`) |
| Knife (8) | M9 bayonet in the shared arms (procedural IK): fire = alternating slashes (55), aim button = heavy stab (110), any hit from behind = takedown (220). Faster movement with the knife out. | `weapons/KnifeRig.ts`, `WeaponManager.startKnife` |
| M72 LAW (9), DZJ-08 (0) | Shouldered launchers on the M4-pack arms; the rocket flies to the crosshair (62 / 70 m/s, slight drop) with flame, smoke trail and motor sound, swept-ray collision, blast 7.5 / 8.5 m (+direct-hit damage), backblast smoke, auto-reload (lower → load → raise). | `fx/Rockets.ts`, `config/guns.ts`, `Game.blast` |
| Office stage | CS Office, 10 hostiles, you insert in the snowy yard by the truck | `level/Office.ts` |

Keys (defaults, all rebindable): **WASD** move · **Shift** sprint · **Space** jump / stand up · **C** crouch · **Z** prone ·
**Q / E** peek · **F** open door · **LMB** fire · **RMB / T** aim (knife: heavy stab) · **R** reload · **V / MMB** melee · **G / B** grenade / type ·
**X** last weapon · **1–9, 0** weapons · **M** sound · **Esc** pause. Developer time-scale moved from T to **U**.

### Second pass (feedback round)
| Request | Change |
|---|---|
| Office loading looked stuck | Load went from **41 s → ~3.5 s**: the ragdoll physics no longer builds a 30k-box compound (37 s) but one triangle-mesh shape per collision chunk. The loading screen shows a percentage and the map download in MB. |
| Wind always on | Ambience plays only while you're in a stage (silent in menus, pause and results). Kestrel Point: low surf + light wind. The Office: none. |
| Rocket blast | A dedicated warhead explosion: a big rolling fireball, a light flash that lights the room, sparks, debris thrown along the hit surface, a shock ring, a smoke column, burning scraps, a bigger scorch, more shake. The launch flashes the room too. |
| Trees and plants | Foliage / fence materials draw as alpha-tested cut-outs with blended edges (depth pre-pass) instead of washed-out alpha blending; their textures kept at full resolution. |
| View stuck after switching windows | Leaving the window pauses and clears held keys; if the browser refuses the re-lock right after you come back, the game stays paused and asks for one more click instead of falling into the cursor-bound mode that couldn't turn 360°. The canvas re-sizes on return. |
| Music | A procedural military-thriller score for the Office (`audio/Music.ts`, 84 BPM, D minor, ~46 s seamless loop), ducked in pause. MUSIC volume in Settings. |
| Doors | Hinged wooden doors in doorways — 14 detected in the Office's voxel data, 11 declared at Kestrel Point. **F** (rebindable "use") opens/closes the one under the crosshair; it swings away from you. Shut doors block movement, bullets, blasts and the soldiers' sight; soldiers open doors they walk into; explosions throw them open. (`level/Doors.ts`) |
| Health | Shown as **100**, with incoming damage scaled (×0.53) so it lasts as long as the previous 150; regenerates after 5 s. |
| Glass | The map's windows (near-invisible before) are visible tinted panes, split into 131 breakable pieces. Bullets — yours and the soldiers' — and blasts shatter them and carry on. The Babylon sub-mesh octree pick was also turned off for collision chunks: it ignored ray length and reported phantom hits that could stop bullets. (`level/Glass.ts`) |

Not done: loading only the area you're in (map streaming). With the fixes above the whole Office loads in ~3.5 s once
downloaded (the 20 MB file is cached by the browser after the first visit), so splitting it into tiles was left out —
it would add pop-in at the long sight lines of the yard.

### Office stage pipeline (offline — `scripts/assets/`)
1. **Visuals** — `glTF-Transform`: drop the 327k-triangle snowfall meshes and the sky dome, weld, simplify (meshopt, ratio 0.6),
   textures to WebP (1024 for big shared surfaces, 512 for props): 109 MB / 985k tris → `src/assets/maps/office.glb` 18.9 MB / 415k.
   Materials stay unlit (the "real light" version has its lighting baked into the textures). Source inches → metres (×0.0254).
2. **Collision + navigation** — the original triangles are rasterised into 12.5 cm voxels. Walkable floor = a top surface with
   1.75 m of head room and body clearance. The playable area = the largest indoor (roofed) floor area grown outdoors inside the
   building's yard box (the hills beyond are out of bounds: CS's own player clips aren't in the visual model, so clip walls are
   generated where the playable floor ends). Voxels within 1.5 m of that floor are greedy-merged into boxes
   (30k solid, 9k soft = glass / fences / foliage that block movement only), plus 733 nav nodes (cover flagged) and 4.2k
   line-of-sight links → `src/assets/maps/office-data.json`.
3. **Runtime** — the boxes become ~230 invisible 8 m chunk meshes, each split into small sub-meshes with an octree, so
   movement and bullet picks only test what's next to them. AI rays use the same boxes through a 2 m uniform grid
   (`NavGraph.setBoxes`), ragdolls a Havok compound of them, the radar draws them.
   Stairs are box steps, so the player and the soldiers get a step-up (≤ 0.42 m).

Measured in the Office: game logic ≈ 0.3 ms per frame, render CPU ≈ 2.6 ms.

### Asset prep for the new weapons
The knife and launchers were baked with glTF-Transform: the DZJ-08's skin baked into a static mesh and its display plane
removed, both launchers re-oriented to +Z muzzle / +Y up and scaled to metres, the M72's spec/gloss converted to metal/rough,
its duplicate (collapsed) tube removed, triangle winding auto-corrected, textures WebP.

### Dev helpers
- `?quick=kestrel` / `?quick=office` (dev server only) skips the menus, deploys without pointer lock and installs `window.T`
  (`T.freeze()`, `T.step(n)`, `T.tap(code)`, `T.click()`), so a frame can be stepped and inspected exactly.
- `dev/viewer.html?m=<asset url>&view=side|front|top` — orthographic model inspector used to measure grips, sights and muzzles.

### Licences for the new assets
- “M9 Bayonet knife” by Michael Karel — CC BY 4.0. “LAW Light Anti-Tank weapon M72” by Vziuh — CC BY 4.0.
- **“DZJ-08 Rocket Launcher” by Martini-SF — CC BY-NC 4.0: non-commercial only.** Replace it before selling the game.
- **“CS_OFFICE (CS:GO Real Light version)” by Neo_minigan — CC BY 4.0 on Sketchfab, but it is a conversion of Valve's
  cs_office.** Like the Fennec viewmodel, treat it as fine for a private prototype and replace it before publishing.
- All credits are on the menu's CREDITS screen.

---

## Foundation decision (boilerplate review)

| Candidate | What it gives | Verdict |
|---|---|---|
| Babylon.js 9 + Vite 8 + TS 6 template (forum, Havok + GLB + GUI + React/Vue/Svelte variants) | Scene bootstrap, Havok init, GLB loading | Generic scene starter — no FPS controller, weapons, AI. Pulls Havok/GUI we don't need. |
| `ranuzz/babylonjs-vite-ts-template` | Minimal Vite + TS + Babylon scaffold | Equivalent to our ~30 lines of Vite config. |
| `knutsoned/FUN-2024` | Game-jam project | A finished game, not a reusable FPS base. |

No maintained Babylon/TS starter covers the FPS-specific systems (controller, weapon state machine,
hitscan, AI). So the foundation is our own lightweight one, using the same Vite + TS + Babylon ES-module
layout as those templates, with nothing copied from them. Babylon.js is Apache-2.0.

**Havok is not used in Phase 1, on purpose.** Nothing here needs rigid-body dynamics:
- Player and enemies use a kinematic ellipsoid controller (Babylon collisions with sliding, ramps,
  and ray ground-snap for stairs). Input reaches motion in the same frame, with no physics-step latency.
- Weapons are hitscan rays; shotgun pellets are N rays.
- Shell casings and dropped rifles use a few lines of pooled ballistic math (one floor ray at spawn).

Havok is worth adding when something truly physical arrives: ragdolls, grenades, destructible props.

---

## Architecture

```
src/
  main.ts                 DOM menu (instant), lazy-loads the engine on DEPLOY, pointer-lock flow
  core/   Game.ts         composition root, frame loop, round state, restart-in-place
          Input.ts        event → per-frame snapshot (pointer lock, raw mouse where supported)
          babylon.ts      explicit Babylon side-effect imports (tree-shaken bundle)
          math.ts         springs, damping, seeded RNG
  config/ weapons.ts      ALL weapon behaviour as data (fire, recoil, spread, ADS, reload phases…)
          game.ts         player / enemy / render tuning
  player/ PlayerController.ts   kinematic controller, crouch/sprint/jump, camera, recoil recovery
  weapons/Weapon.ts       deterministic state machine (equip/ready/reload/holster), ammo events
          WeaponManager.ts switching, ADS, hitscan resolution, presentation in the same frame
          Viewmodel.ts    procedural first-person animation (springs: kick, sway, bob, landing)
          WeaponModels.ts rig interface + procedural fallback carbine
  enemies/Enemy.ts        AI state machine IDLE/PATROL/ALERT/SEARCH/ATTACK/DEAD, combat, death
          EnemyManager.ts staggered 8 Hz thinking, hearing, ally alerts, reset
          EnemyModel.ts   "Breakwater" contractor rig built from InstancedMesh parts (= hitboxes)
  level/  KestrelPoint.ts the location, nav nodes and spawns
          LevelBuilder.ts primitives → merged-per-material-per-zone meshes + invisible box colliders
          NavGraph.ts     waypoint graph, auto-linked by line-of-sight + floor-continuity rays, A*
  fx/     Effects.ts      pooled muzzle flashes, casings, impacts, decals, tracers, smoke, blood
  audio/  AudioEngine.ts  Web Audio bus, compressor, convolution reverb, 3D panners
          SoundBank.ts    every sound synthesised at load time (variants per sound)
  render/ Environment.ts  sun, sky fill, shadows, fog, post-processing grade
          Sky.ts          custom sky shader; Materials.ts / TextureGen.ts procedural PBR surfaces
  ui/     Hud.ts          DOM HUD (writes only on change); DebugOverlay.ts (F3)
  core/   DevMode.ts      developer mode switches + live status panel
```

### The shot, step by step (same frame)
Click → `Input` records the press → `Weapon.update` consumes the round (fire-rate accumulator, input
buffer for the pump) → `WeaponManager.fire` raycasts against pickable level boxes and enemy part
instances → damage and hit marker → muzzle flash, sound, casing, recoil (camera and viewmodel springs)
→ the frame renders. Flash, sound, impact and damage all land on the same rendered frame.

### Reload determinism
Reload is a list of timed phases in `config/weapons.ts`. Ammo moves **only** at explicit events
(`transferMag` when the rifle mag seats, `transferOne` per shotgun shell), and those events are timed
to the animation and the sound. Interrupting a reload by switching weapons drops the remaining phases.
Whatever was transferred stays transferred, so you can't duplicate a mag, lose rounds or go negative.
Firing during a shotgun reload stops it after the current shell. All of this is covered by the
automated checks below.

### AI
Each enemy decides at 8 Hz, staggered across enemies; movement and animation run every frame.
- Vision: FOV cone plus line-of-sight rays, with detection building up over time.
- Hearing: gunfire within 38 m. Allies within 22 m are alerted over the radio (you hear a helmet-radio chirp).
- In combat an enemy picks a cover node: blocked from you at crouch height, clear for a standing peek.
  It then cycles crouch/peek with burst fire. The first burst after spotting you is deliberately
  inaccurate (reaction time). Enemies reposition every 5–9 s and strafe when no cover exists.
- When an enemy dies: collider off, rifle tossed, fall animation. The body is fully disabled after 10.5 s.

---

## Performance notes (measured)
- Static level: about 30k vertices merged into 29 meshes (per material per 28 m zone, so still frustum-culled).
- About 95 draw calls per frame, including the shadow pass, post-processing and viewmodel.
  Nine soldiers render as roughly one instanced draw per body-part type.
- Game logic (AI + player + weapons + FX) costs about 1–1.3 ms per frame with every enemy in combat
  (headless measurement).
- Nothing is allocated on the GPU after loading. Particles, flashes, casings (max 36), decals (max 90)
  and tracers are pooled, and every effect and both weapons are rendered once during loading so shaders compile up front.
- Shadows: one 2048 PCF directional map with fixed bounds. The ground doesn't cast. Practical lights don't cast shadows.
- Bundle: the engine is tree-shaken via deep imports (about 1.6 MB main chunk plus lazily-loaded shaders,
  about 660 KB gzipped in total). The menu shows before Babylon is even downloaded.
- The F3 overlay shows FPS, frame time (avg/worst), CPU/render time, draw calls, active meshes,
  particles, lights, enemy/AI states, audio voices and JS heap.

## First-person rifle (glTF)
The rifle slot uses an authored, skinned **M4 + arms** model with five baked clips
(Draw, Holster, Fire, Reload, Reload_Empty):
"M4 – FPS Weapon Animations Pack v1" by **BarcodeGames**, CC BY 4.0
(https://sketchfab.com/3d-models/m4-fps-weapon-animations-pack-v1-662fc74dda2646cfb48fc610705768ef).
The credit is shown on the main menu, as the licence requires.

- **Asset pipeline:** `gltf-transform` converts spec/gloss to metal/rough, dedups and prunes,
  and compresses textures to WebP: 11.5 MB → 2.3 MB (`src/assets/m4.glb`).
  `@babylonjs/loaders` loads it, with the `EXT_texture_webp` extension.
- **The state machine drives the clips** (`weapons/GltfRifleRig.ts`). Clips are never left to play
  on their own: every frame the rig samples the clip at the time the weapon state machine
  dictates (`goToFrame` on paused groups). Ammo, sound and animation therefore can't drift apart.
  Reload events sit at the measured frames: mag out 0.87 s, mag seated 2.03 s, bolt release 6.31 s.
- **Cross-fades:** a pose snapshot is blended out over 0.14 s whenever the clip changes,
  so interrupted reloads and draws don't pop.
- **Camera framing:** the pack's own `FPS_Camera` node is mapped onto the player camera,
  so the arms sit exactly where the animator framed them.
- **Iron sights:** ADS is solved from the rear-aperture and front-post positions, so the post
  lands exactly inside the ring on the screen centre.
- **Cutting reloads short:** once the mag is seated, firing cuts the cosmetic tail of the reload.
- **Empty magazine:** the bolt locks back on empty (first frame of the empty-reload clip).

## Arsenal (slots 1–7, Q = last weapon)
| Slot | Weapon | Model | Behaviour |
|---|---|---|---|
| 1 | M4 Carbine | pack M4 + arms (authored clips) | 720 rpm, iron sights |
| 2 | AK-47 | MaX3Dd (Sketchfab Standard) | 600 rpm, 34 dmg, heavier recoil |
| 3 | Colt M5 SCW | D_U (CC BY 4.0) | 800 rpm, light recoil, fast handling |
| 4 | VSSK Vykhlop | Diamonddogkz (Sketchfab Standard) | semi, 5 rds, 120 dmg, suppressed (enemies hear it at 35 % range), 4× scope overlay |
| 5 | Glock 17 | PSICOPATO (CC BY 4.0) | semi, 17 rds, fast draw |
| 6 | KRISS Vector | MW2019 "Fennec" viewmodel with its own arms + authored clips | 1000 rpm .45, very low climb, 25 rds |
| 7 | Grenades: AP frag, incendiary, plasma, M84 flashbang | shared arms (procedural IK) | press = pin, hold = cook, release = throw, RMB = underhand, **G** = quick throw, **B** = next type |

**Shared arms (`weapons/ArmsRig.ts`, specs in `config/guns.ts`).** Each glTF gun gets its own
copy of the pack's skinned arms and clips. The gun is attached to the animated receiver joint, with
its pistol grip aligned to the M4 grip. The left hand is corrected per frame, the same way it holds the M4:
five anchors record where the pack's wrist sits on the M4 (handguard at idle, plus the magazine and the
magwell at mag-out and at seat). Each anchor stores the M4 → new-gun offset in the frame of the part
being held: the receiver joint, or the magazine joint. Every frame, the offsets are blended by
distance from the wrist and added to the left arm. So the hand stays on the handguard through fire,
draw and holster, and follows the magazine through both reloads. The magazine meshes are re-parented to the pack's magazine joint, so the
mag leaves and returns with the hand. Muzzle, ejection port and the exact ADS sight line come from
measured points per gun. Adding a gun means adding one `GunSpec`, one `WeaponConfig` and one entry in `WEAPON_ORDER`.

**Asset pipeline:**
- **Glock:** a 1.17M-triangle photogrammetry scan simplified to 28k triangles (62 MB → 2.3 MB).
- **VSSK:** 24 MB → 3.9 MB.
- **All textures:** WebP at up to 1024 px.
- **Merging:** static parts are merged per material at load (the M5 goes from 27 draw calls to a few).

`npm run build:artifact` builds one JS bundle and converts the `.glb` files to embedded glTF `.json`,
for hosts that only serve web file types.

**Licence check needed.** The Fennec / Vector viewmodel ("mw_2019_fennec_vipers_gmod_mw_base") looks like
an asset extracted from *Call of Duty: Modern Warfare (2019)* and ported to Garry's Mod. That would make
it Activision's IP. It's fine in a private prototype, but replace it before publishing or selling the game.
Check the Sketchfab licences of the flashbang, the grenade set and the two soldier models too.
Mixamo animations are free to use in games (Adobe Mixamo terms). The AK-47 recording ("sovetsky_rastov72 – AK-47 sound effect") looks like a Pixabay download; Pixabay's content licence allows use in games, but confirm it on the download page.

Licences: AK-47 and VSSK are under the Sketchfab Standard licence: use inside the game is allowed,
redistributing the raw model files isn't. The M4 pack, the M5 and the Glock are CC BY 4.0, and their
credit is shown on the menu.

## KRISS Vector (`weapons/VectorRig.ts`)
Unlike the other guns, the Vector ships with its own skinned arms and authored draw / fire / reload /
empty reload / holster clips. The rig converts inches to metres, puts the authored eye (`tag_view`) on
the viewmodel origin, and drives the clips from the weapon state machine with the same cross-fade as
the M4 pack. Muzzle and ejection follow `tag_flash` / `tag_brass`. Reload events sit on the measured
frames:
- normal reload: mag out at 1.08 s, seated at 2.88 s
- empty reload: mag out at 0.70 s, seated at 2.38 s, charging handle at 3.02 s

The model was cut from 25.5 MB to about 7 MB: textures became WebP at 1024 px, tangents were dropped,
geometry was quantised and the unused clips (melee, inspect, fire-select) were removed.

## Grenades (`weapons/GrenadeRig.ts`, `weapons/GrenadeModels.ts`, `fx/Grenades.ts`, `fx/Explosions.ts`)
Four types on one belt. **B** picks the type, **G** quick-throws it, and slot 7 holds it in your hand.

| Type | Carried | How it goes off | Effect |
|---|---|---|---|
| **AP frag** (green egg) | 2 | 2.6 s fuse after the throw, bounces and rolls | 9 m blast with damage falloff (it can hurt you too); cover blocks it |
| **Incendiary** | 2 | bursts on the first solid impact | 3.8 m fire area burns for 7.5 s, damaging soldiers inside (and you, if you walk in) |
| **Plasma** | 1 | sticky: latches onto a wall, the floor or a soldier, hums, then blows 1.15 s later | 6.5 m blue blast; whoever it's stuck to always dies |
| **M84 flashbang** | 2 | 1.6 s fuse | blinds (see below) |

The three lethal models come from one Sketchfab file that holds every grenade twice, merged per
material. `GrenadeModels.ts` cuts each grenade out by region and material, finds its long axis and
which end is the fuze, and rebuilds it centred, in metres and upright.

**Blast effects**, all pooled:
- **Frag:** a white-hot core flash, a rolling orange fireball, white-hot fragments, dirt debris, a
  ground dust ring, a dusty shock ring, a black smoke column, and a scorch mark that fades over 40 s.
- **Frame flash:** the whole frame's exposure kicks, scaled by how much of the blast you can see.
- **Camera shake** is noise driven by trauma² and falls off with distance.
- **Audio:** within 7 m your ears dull. The frag bang is a supersonic crack, a sub-bass drop, a fat
  blast body, debris pattering down and a long rolling rumble, modelled on big arcade-military
  explosions.
- **Plasma:** a blue-white core, electric arcs and a cyan shock ring; the sound is a crackling
  electric snap over a deep thump.
- **Incendiary:** a fuel "whump", then rolling flames, embers and oily smoke with a looping
  crackle-and-roar.

### Flashbang
- **Hold and throw.** The M84 sits in the right hand of the shared M4-pack arms. There is no authored
  grenade animation, so both arms are posed with analytic two-bone IK every frame. The left hand comes
  in and pulls the ring (the ring is re-parented to the left hand), the arm winds back while you hold
  the button, then throws over-arm. The grenade leaves the hand at 30 % of the throw.
  - RMB during the release throws underhand.
  - **G** throws from any gun: equip, throw, then switch back automatically.
- **Flight.** Gravity and drag, swept ray collision against the level with restitution and friction,
  rolling to rest, and a clank on each bounce. The fuse is 1.6 s after the throw.
- **Bang.** A bright flare, sparks, a lingering white smoke cloud, and a 3D bang with a long tail.
- **Effect on you:** exposure = distance × facing × line of sight (a wall still leaks a little light
  within 6 m). It gives a white-out with blur that holds and then fades. Audio goes dull (master
  low-pass) under a tinnitus whine, and the view jolts.
- **Effect on enemies:** the same test from each enemy's eyes. A blinded enemy stops, can't see or shoot,
  covers his eyes and staggers for 1.4–5.6 s, then searches where the grenade came from. Everyone in
  range hears the bang.
- **Count.** You carry 2. Developer-mode ammo cheats refill every grenade type.

## Radar (`ui/Minimap.ts`)
The radar is a rotating minimap in the top-left corner, with your view direction always up, like Call
of Duty.
- **Map.** The level footprint is rasterised once from the collision boxes: walls are bright, cover is
  mid-tone and raised floors are faint. It has 10 / 20 / 30 m range rings, a north marker and your
  view cone.
- **Enemies** are red arrows (the same shape as yours) pointing where they face.
  - A ring pulses around an enemy who is firing.
  - Blinded enemies turn yellow.
  - Enemies outside the 34 m range stick to the rim, so you still get their bearing.
- **Grenades** in flight blink in their type's colour.

## Enemy soldiers (`enemies/SoldierSkin.ts`, `enemies/SoldierAnim.ts`, `core/pose.ts`)
The hostiles are two skinned characters, alternating: the **FSB operator** (Mixamo rig) and
**"Mark"** in full tactical gear (Character Creator rig). Both carry the FSB operator's AKS-74U.

### Motion capture
Nine Mixamo rifle clips drive the bodies: *Rifle Idle*, *Firing Rifle* (aimed walk), *Run Forward*,
*Stepping Backward*, *Strafe Right*, *Strafing* (left), *Gunplay* / *Gunplay 1* (shooting stance) and
*Reloading*.
- **Offline retarget** (FBX → glTF → `assets/anims/soldier_anims.json`). It works from geometry, not
  bone axes: for every frame each bone is turned so its direction and roll reference (bend plane, palm,
  foot) match the source joints. That is why it works on both rigs despite their different rest poses.
  Root motion is removed and kept as the clip's ground speed. Data is 30 fps int16 quaternions.
- **Blend space.** Speed and body-relative direction pick between idle / walk / run / back / strafe
  left / strafe right. The clips share one synchronised gait cycle whose playback rate matches the
  AI's real speed, so the feet don't skate. Standing still blends low-ready idle into the shooting
  stance as the soldier raises his rifle.
- **Upper-body layers.** Low ready while patrolling (legs walk, rifle down), and the reload clip over
  any locomotion.

### More clips (second batch)
- **Movement:** *Sprint Forward / Backward*, *Walk Left / Right*, *Walk Forward Left* (mirrored for forward-right),
  *Walk Crouching Right* (mirrored for left), *Crouch Walking Backwards*.
- **Cover and reactions:** *Rifle Crouch Walk To Kneel* (the kneeling pose in cover), *Hit Reaction*.
- **One-shot moves:** *Rifle Side Step* (both sides), *Running Dive Roll*, *Running To Stop*,
  *Pistol Whip* and *Stabbing* (rifle-butt strikes), *Throw Grenade* (mirrored, left arm).
- **Death stagger:** *Death From The Front / Right* and *Dying*.
- **Unused:** *Jump Away* ends lying on the ground with no get-up clip, and *Strafing 1* barely moves.
- **Backwards set (third batch):**
  - *Run Backwards 1*: aimed back-jog.
  - *Walk Backward Right* (mirrored for back-left): aimed walk.
  - *Run Backward Left / Right*: aimed run.
  - *Backwards Rifle Walk*: rifle low, used when not aiming.
  - Not used: *Run Backwards* ends crouching, *Stepping Backward 1* and *Sprint Backward 1* duplicate
    clips already in the game, and *Start Walking Backwards* is a one-off start.
- **Why backing up looked wrong before:** with no back-diagonal clips, a sideways strafe was blended
  with a back step. The two have different hip and shoulder orientations and different foot timing, so
  the torso twisted and the legs scissored. Now:
  - There are real back-left and back-right clips.
  - Every loop is sampled relative to its own left-heel strike (measured in the retarget), so blended
    clips step together.
  - The head looks where the rifle looks, or where the body faces.

Mirrored clips are made in the retarget by swapping left/right joints. One-shot moves keep their root
motion as a separate track, which moves the soldier (with collisions) while the move plays.

### Animation controller (`enemies/EnemyAnimationController.ts`)
- **Locomotion blend space.** Six directions (forward, both diagonals, both sides, back) × speed tiers:
  - forward: walk → run → sprint
  - sideways: aimed strafe → side walk
  - back: back-step → crouched retreat → back-pedal

  All moving clips share one gait cycle whose rate follows the real ground speed.
- **Standing:** low-ready idle ↔ shooting stance (aim) ↔ kneel (crouch).
- **Layers:**
  - upper body: low ready while walking unalerted, reload, hit flinch (big hits only, with a cooldown)
  - left arm: grenade throw (the rifle stays in the right hand; a frag sits in the left hand)
- **One-shot actions:** fade in and out over the blend, can hand an event to the AI (strike, release) and
  reduce how much the procedural aim may turn the spine.

### Procedural layers on top
- **Aiming:** the spine turns (yaw and pitch spread over the spine bones) until the muzzle points at
  you, so shots leave the real barrel.
- Hit flinches and per-shot recoil.
- **Flashbanged:** the off hand goes over the eyes and the head turns away.
- **Rifle:** it rides the right hand. With both hands on it, it lies along the clip's grip→handguard
  line, and the left hand is IK'd onto the handguard. During a reload or a throw the left hand is free
  and the rifle holds its last grip.

### Tactics (`enemies/Enemy.ts`, tunables in `enemies/EnemyConfig.ts`)
- **State machine:** IDLE → PATROL → ALERT → ATTACK → SEARCH, decisions at 8 Hz, staggered across the
  squad.
- **Cover:** pick a covered spot nobody else holds; sprint there if it's far, run otherwise. A run ends
  with the run-to-stop clip. In cover: kneel, rise to shoot, and now and then shuffle sideways crouched.
- **In the open:** never stand still. Keep 7–20 m:
  - you're close: back off; you're very close: back-pedal
  - you're far: push in
  - otherwise strafe, switching sides every 1–3 s or when blocked. Every move is probed (line of sight
    and floor) before it's taken.
- **Movement:** acceleration and deceleration, separation from squad mates, smooth turning. The body
  turns separately from the aim; the spine tracks you. A sprint to cover faces the run (no shooting).
- **Shooting:** bursts with a reaction delay. Accuracy falls with distance, your movement, and their
  movement (strafing −35 %, running −55 %). No line of sight, no shots.
- **Reflexes:**
  - **Grenades:** a frag or stuck plasma about to blow within 5.5 m → dive-roll away if there's room,
    else sprint off. They sometimes freeze.
  - **You within 1.7 m:** rifle-butt strike (28 damage).
  - **You've hidden for 2.5 s or more:** someone lobs a frag at your last known spot. One per soldier,
    one per squad every 14 s, never near a squad mate. You get a "GRENADE — MOVE!" warning.
  - **Hit standing in the open:** sometimes a side step.
  - **Magazine:** each soldier carries 30 rounds and reloads when it runs dry (2.9 s, can't shoot
    meanwhile), or tops up when out of your sight. Mag-out / mag-in / bolt sounds play on the clip's
    own frames.
- **Hitboxes** are the old invisible blocks. They now ride the animated bones and are scaled to the
  real limb lengths, so what you see is what you hit.

### Ragdoll deaths (`enemies/EnemyRagdoll.ts`, `physics/PhysicsService.ts`)
- **Engine:** Havok (Babylon Physics V2). The level's 233 box colliders become one static compound body.
  The engine is stepped from the game's own simulation step, so it pauses, slows and stays in sync.
- **Body:** built at death from the current pose.
  - 11 parts: pelvis, torso box, head, upper and lower arms, thighs, shins.
  - 6-DoF joints with anatomical limits: knees and elbows only bend one way; hips, shoulders, spine and
    neck are limited cones with twist.
  - Each part keeps its own velocity from the last animated frames, so a running man tumbles forward.
- **Death sequence:** body shots play a short stagger clip first (fall back / to the side / forward,
  from the shot direction), then physics takes over. Headshots, blasts and melee go straight to
  physics.
- **Impulses:**
  - **Bullets:** scale with weapon damage, ×1.35 on headshots, applied at the hit point. Capped per limb
    so heads never whip off.
  - **Explosions:** throw bodies radially with lift, including ones already lying there.
  - **Melee:** a heavy shove.
- **The rifle** becomes its own physics body and clatters away.
- **Cleanup:**
  - A body sleeps once every part is slower than 8 cm/s for 0.8 s (7 s max). Then all bodies,
    shapes and joints are disposed and the pose is frozen.
  - At most 6 ragdolls simulate at once (the oldest freezes early).
  - Living soldiers never have physics bodies.
- **Why the ragdoll is custom-built:** Babylon's experimental `Ragdoll` helper drives `Bone` objects
  directly. glTF skeletons are driven by linked transform nodes under a mirrored root, so that helper's
  writes don't stick. The custom version drives the same nodes through the pose solver.
- **Fallback:** if Havok can't load, deaths fall back to the procedural fall.

### Design choices against the spec
- **Living movement stays on Babylon's swept-ellipsoid collisions, not Havok capsules.** It's already
  tuned to the level, the player uses the same system, and only the dead need a solver. Both are now
  restricted to level solids and squad colliders instead of every mesh in the scene.
- **AI line-of-sight and floor rays use an analytic ray-vs-box test** against the colliders: no
  scene-wide picking. A frame of AI went from about 4.7 ms to 2.5 ms (headless).
- **Clips use a custom sampler rather than `AnimationGroup`s.** Directional blend spaces, synced gait
  cycles, masked layers and root-motion events are simpler and cheaper this way, and the clip set is
  data (`EnemyAnimationController`), so a different character only needs a new retarget.

### Cost
`PoseRig` solves on a private copy of the bone chain with its own world-matrix cache, then writes the
local rotations once. A soldier costs about 0.1–0.5 ms. Soldiers far away or behind you re-pose every
2–4 frames, and their rifle and hitboxes ride the root so they never lag.

### Assets
- **Mark:** 100k → 31k triangles; meshes merged per material (one draw call per material); textures are
  WebP at 512 px.
- **FSB:** 52k triangles, same treatment. Its pouches, spare magazines and patches were static props, so
  they are re-parented to the chest bone.
- **Rifle:** baked once in a rifle frame. Its skeleton stock is straightened, and every soldier draws an
  instance of it.

## Ground and z-fighting
- **The problem:** several surfaces shared a plane or sat millimetres apart, which flickers at range
  with a 3 cm near plane:
  - the courtyard and north-alley pads overlapped at the same height
  - the container yard sat 5 mm under the alley
  - the cliff top was coplanar with the sand along the whole coastline
  - stain decals sat 3 mm from the pads
- **The fix — fixed layers, no overlapping pads:**
  - sand 0.00
  - paved pads 0.04 (edge to edge)
  - building floors 0.09
  - decals 2.5 cm above the pad they lie on
  - cliff top 4 cm under the sand
- **Sea:** slightly rougher with a softer normal map, so it doesn't sparkle and shimmer at distance.

## Melee (V or middle mouse)
- **Rifles:** butt-stroke. The rifle swings so the stock leads, then drives forward.
- **Glock:** pistol whip. The frame comes up, then chops down and forward.
- **Hit test:** a short fan of rays from the eye (2.25 m). Walls block it.
- **Damage:** rifle 55, pistol 45, and an instant takedown from behind (150).
- **On hit:** a heavy thud, blood, camera jolt, and a knock-back and flinch on the soldier. A killing
  blow throws the ragdoll.

## Movement feel
The head bob and the gun bob share one gait phase driven by the distance walked: π per footstep, and
the footstep sound fires on it. The vertical motion is a smooth cos 2φ dip with no |sin| cusps (those
read as shaking when running). The gun traces a gentle figure-eight that lags the head slightly. When
sprinting, the rifle swings one slow arc per stride instead of jittering.

## Gun audio
**AK-47: real recording** (`assets/audio/ak47.mp3`, sliced by `audio/samples.ts`).
- **Single shot:** three recorded shots, each with its own room tail.
- **Full auto:** the recorded auto string is cut into 29 per-round slices that carry the continuous echo
  bed. The first round of a string plays a full shot, follow-ups play slices, and when you let go of the
  trigger the recorded release tail plays.
- **Reload:** the recorded mag out, mag in and bolt.
- **Enemies:** their AKS-74Us use the same recording, positioned in 3D.

Every other weapon has its own synthesised voice: shot, tail, mag out, mag in and bolt / charging
handle.

| Weapon | Shot | Tail | Reload |
|---|---|---|---|
| M4 | crisp 5.56 crack | rifle tail | bolt-catch slap |
| AK | *recorded (see above)* | recorded | recorded |
| M5 | short-barrel blast with a polymer snap | brighter tail | polymer PMAG |
| VSSK | suppressed thump | none | heavy bolt and cycle clack |
| Glock | sharp pistol report | short tail | polymer mag, slide release |
| Vector | subsonic .45 "thup" with the Super V mechanism clack | short SMG tail | polymer mag, charging handle |

Each sound has two to four variants so repeated shots never sound identical.

## Sound and developer mode
**Sound** has an on/off switch in the main and pause menus, and on **M** in game. The setting is
remembered, and the master bus ramps over 15 ms so toggling never clicks.

**Developer mode** has a switch in the menus, or press **`** in game. It shows a live panel with
weapon state and reload phase, ammo, player movement state, position, and AI state counts. Hotkeys
while it is on:

| Key | Action |
|---|---|
| **G** | god mode (default on) |
| **I** | ammo: off → infinite reserve (default) → no reload |
| **Y** | enemy AI: active → passive (blind and deaf, never shoots) → frozen |
| **T** | time scale 1× → 0.5× → 0.25× (inspect animations) |
| **H** | heal |
| **K** | kill all hostiles |
| **L** | respawn hostiles |
| **F3** | perf overlay |

## Assets
Everything else is generated at load time, with no downloads and no third-party art:
- surfaces: tileable albedo plus normal maps from noise
- weapons, soldiers and architecture: built from primitives
- sky: a custom shader
- audio: synthesised with layered noise, tones and filters

The game's look (sodium dusk, teal shade, signal-orange livery, red-visor contractors, helmet-radio
chirps) is set in `render/`, `audio/SoundBank.ts` and `enemies/EnemyModel.ts`.

The next art step is to replace primitives with authored **GLB + KTX2** assets. Rig nodes such as
`muzzle`, `eject`, `sight`, `mag` and `pump` are named anchors, so a GLB weapon can drop into the same
`WeaponRig` interface.

## Round 4 (October 17)

- **Flow:** stages start as soon as loading ends (no "click to engage"; browsers still need one click to capture the mouse — a small hint shows until then, and that click never fires). Clearing a stage shows **NEXT STAGE** (reloads straight into the next one).
- **Hearing** (`config/game.ts` → `ENEMY`): gunfire carries `hearingRange` 60 m × weapon noise, halved through walls; inside `certainRange` 12 m they engage, farther out they run in to a fanned-out point ~9 m short of the noise and advance carefully. Sprinting is heard at 14 m, walking at 6 m, crouch/prone are silent.
- **Blasts:** soot crater decal (noise-painted, lifted off the surface — the old big `zOffset` drew the starburst through walls), corners checked so it never hangs off ledges, wall marks for rockets, rubble that settles and stays ~50 s, a smouldering smoke column.
- **Glass:** every shard measures its own floor (and again after it flies on), so pieces thrown past the sill land outside instead of floating.
- **Blood:** ballistic droplets, mist, clots on big hits, three splatter variants (the spray one points along the shot), drips along the floor, pools spreading under bodies; the player gets droplet spray on screen and leaves a drip trail below 45 % health.
- **Rockets:** separate M72 (motor burns out in the tube: crack, boom, backblast, whoosh) and DZJ-08 (booster + sustainer roar with crackle) launches, Doppler on the flight loop, a dedicated warhead blast. Drop real recordings into `public/sfx/<name>.mp3` (`m72Launch`, `dzjLaunch`, `rocketBlast`, `rocketMotor`, `rocketWhoosh`) to replace the synthesis.
- **Frostline:** 16 hostiles; the map's 22 trees are cut out of the TRANS4 foliage mesh at load and replaced by “Tree low poly lowpoly” (00amza, CC BY 4.0, `src/assets/props/tree_lowpoly.glb`); boot prints in the snow (outdoors only, player and soldiers, fade after ~16–20 s, sprinting kicks snow).
- **Full map:** N (rebindable) toggles a north-up tactical map.

## Round 5 (October 17)

- Enemy rounds are traced from the muzzle: a door, wall or crate on the line stops the bullet (impact on it) even if the soldier "saw" you a moment before.
- Bodies stay where they fell for 4 minutes (`ENEMY.corpseTime`).
- Prone key again = stand up (crouch only if there's no headroom).
- Blood on walls: fine dark speckle, a few short flung drops and runs dripping down (walls keep the decal upright); mist is a speckle cloud, not a disc; matte.
- Frostline: no soldier spawns or patrols within 28 m of, or in sight of, the insertion point.
- Footprints only on snow: the ground texture under the boot is sampled (bright, colourless = snow) and nothing may be overhead.
- Incendiary flames are dimmer and fewer, so a fire close by no longer turns the whole view orange.

## Round 6 (October 17)

- **Loadout:** one weapon per slot — 1 primary, 2 pistol, 3 rocket launcher (only one, none at the start), 4 knife, 5 grenades. Guns lie on crates around each stage (AK-47, Colt M5, VSSK, Vector, M72, DZJ-08); **F** picks one up / swaps it for the one in that slot (yours is dropped where you stand) / takes its ammo if it's the same gun. Ammo cans, rocket crates and grenade crates are taken by walking over them (only when you need them). Every dead soldier's AK stays where he fell. All supplies show on the full map (N). (`level/Pickups.ts`, `WeaponManager.pickUp`)
- **Base alarm:** the first soldier to engage you sets off a siren; everyone not fighting is radioed your rough position (every 12 s) and comes searching. Two quiet minutes (nobody fighting you, you not firing) switch it off.
- **Soldier movement:** the body turns into the direction of travel; sidestepping / back-stepping with the chest on you only at walking pace while engaged; the spine and head no longer track a target behind the shoulder, and a running soldier carries the rifle low. Back-pedal capped at 1.8 m/s. Ragdolls: up to 8 active, less angular damping (per the ragdoll guide: limits, mass on pelvis/torso, velocity hand-off from the animation, cap + freeze oldest).
- **Footprints:** unlit darkening decals (visible on sunlit and blue-shaded snow); snow detection also accepts the blue baked shadows.
- **Blood:** no faint square around splats, decals darker (never brighter than the wall), pools shrink to fit the surface they're on.

## Automated checks used during development
Headless Chromium drove the game through `?autotest`, which exposes `window.__saltline.debugApi.simulate()`.
Checks covered:
- rifle and shotgun headshot/body kills
- ammo totals across interrupted reloads
- shotgun shell-by-shell, cancel and empty-pump sequences
- climbing every staircase onto the roof, tower and mezzanine
- jump and crouch heights
- a 60 s AI soak test (no NaNs, no falling through floors)
- death → MISSION FAILED → restart, with mesh, node and particle counts identical before and after
- clearing all nine → SECTOR CLEARED

## Next (not in Phase 1)
- Authored GLB/KTX2 art, skeletal soldiers and an arms rig
- Havok ragdolls
- Baked lightmaps / AO
- Settings (FOV, keybinds)
- More weapons, using the same `WeaponConfig` and `WeaponRig` contracts

## Round 7 (October 17)

- **Base alarm:** now sounds only once you attack (your first hit, or a soldier who spotted you staying in the fight ~3 s to radio it); a quieter PA klaxon (synthesised) instead of the wail; switches itself off after 45 s and stays off for a minute. A red **alarm switch** is mounted on a wall in a room near the middle of each base (red diamond on the full map): press the use key there to silence the alarm or set it off. Same rules on Red Dune and Frostline.
- **Quiet start:** `level/startSafety.ts` moves any guard post or patrol leg (sampled every 3 m along its walked path) that is within 28 m of the insertion point or can see it (≤ 52 m); and for the first 8 s, and as long as you stay within 12 m of the insertion point, nobody farther than 6 m builds up detection — until you fire.
- **Enemy voices:** `audio/Barks.ts` — contact, grenade, reloading, man down, flanking, searching, suppressing, hit, and a radio call with the alarm; a caption shows the line. Uses the browser's speech voice; recorded lines override it: `public/sfx/vo/manifest.json` (`{"contact": 3, …}`) + `public/sfx/vo/contact_1.mp3` ….
- **Enemy grenades:** the real Frostline bug — grenades below y = −5 counted as "fallen out of the world" and blew up in the thrower's hand (most of Frostline is below −5); the limit is now the stage's lowest floor. Soldiers only throw along an arc that's clear (same collision test as the grenade: walls, doors, glass), land it ≥ 7 m from themselves, aim short so it rolls to you, and pick a spot by the corner you're behind if there's no arc onto you. Grenades no longer bounce off the thrower or his squad mates, and they go through windows.
- **Squad tactics:** roles per soldier — rifleman pushes in, two flankers swing ~80° round either side, support hangs back in cover; destinations are claimed so nobody heads for a spot a mate already took; staggered departures; wider spacing while moving in.
- **Stuck in walls:** a per-soldier wall watchdog undoes any move that crosses solid geometry and puts an embedded body back on the nearest clear nav point.
- **Pause:** the whole game mix (effects, alarm, fires, wind, score) is silenced while paused; the menu music plays instead. New setting **MENU MUSIC** on/off.
- **Ammo:** reserves raised (M4 / M5 240 → max 360, AK 210 → 360, Vector 200 → 350, VSSK 35 → 60, Glock 119 → 187, launchers 4 → 6); a gun from a cache comes with its full starting reserve, a dead soldier's AK with 2–3 spare mags; ammo cans give 5 mags, rocket crates 3 rockets.
- **Supply caches:** guns, ammo and rockets now stand in caches against the walls of rooms (not windows, not by doors): a gun on an ammunition crate with ammo or grenades beside it. Models: “Ammo Box” (nghiakua06), “Ammo Crate PBR” (avhatar), “AMMO” (FrodaJan), all CC BY 4.0 — `src/assets/props/ammo_can.glb`, `ammo_crate.glb`, `ammo_pack.glb` (textures not re-compressed: ~9 MB together).
- **Frostline explosions:** placed on the drawn ground (scorch was buried under the snow), the blast's light is painted on the ground (the map is unlit, so the point light lit nothing), a bigger flash, powder snow thrown up on snow. Rockets too.
- **Fall damage:** from ~3 m (4 m ≈ −11, 6 m ≈ −33, 9 m ≈ −72, ~13 m fatal), red closes in from every edge (in developer god mode you get the red flash and jolt but keep your health).
- **Doors to nowhere:** a door whose far side can't be walked into (taped off, ladder, wall) stays shut with no OPEN prompt; soldiers and blasts don't open it either.


## Round 8 (October 17)

- **Removed:** the base alarm (siren, radio sweeps, wall switch, HUD tag) and the enemy voice lines. Soldiers are back to fighting where they are: one who spots you only calls mates within 30 m. `audio/Barks.ts` stays in the project, unwired, for recorded voices later.
- **Seven carry slots** (keys 1–7, Bindings v5): assault rifle (M4 / AK-47 / Colt M5), SMG (Vector), sniper rifle (VSSK), pistol, launcher, knife, grenades. A gun replaces only the one in its own slot.
- **Knife idle:** the idle loop ran into the first frame of the slash (the right hand jumped 16 cm every 1.45 s); it now breathes forward and back over 0–1.3 s.
- **Red Dune decals:** blood and bullet holes on a lit stage use the same physically based material as the walls and receive shadows, so they are never brighter than the wall (they were ~3× brighter under Red Dune's sun and ignored the dark inside buildings).
- **Stage 3 — BLACKRIDGE (Operation Iron Veil), work in progress:** built on the "Residential buildings, ancient villages" photogrammetry scan (Metazeon, CC BY 4.0, `src/assets/maps/village.glb`, ~45 MB). The scan is drawn as-is; you and the soldiers collide with an invisible copy of it, split into small pieces. The AI data comes from `scripts/assets/voxel-village.mjs` (0.5 m voxels, nav nodes, clip walls, exact ground heights). Added structures are in `level/BlackridgeSet.ts`: hill observation post, checkpoint, comms station with terminal, lane gate, barracks, depot with the key card, bunker portal with blast door and lift, the underground complex and the command chamber. The mountain range and sky are new too. Mission: `core/Mission.ts` with 8 objectives, a waypoint, subtitles, area-by-area soldier wake-up, opening/boss/ending cutscenes (Space skips), checkpoint restarts below ground, the boss health bar, and 3 boss phases. The boss is a placeholder soldier until the villain model arrives. Verified in the browser: the whole mission from the opening cutscene through all 8 objectives, the lift, the bunker lighting (lamps follow you or the cutscene camera), the boss door-kick entrance, three boss phases, the ending cutscene, "MISSION COMPLETE", saved completion (✓ CLEARED on the stage card) and the checkpoint restart at the chamber door. The stage card uses a render from the hill (`thumbs/blackridge.jpg`).

### Blackridge rebuilt inside the village (October 17)

- **Played inside the village only** (no hill): `voxel-village.mjs --maxy=3 --band=1 --vs=0.25` keeps the walkable area to the village floor (≈7,100 m²: the square, the lanes, the lane-side square).
- **Movement:** the scan is scenery only. You walk on a smoothed ground mesh built from the survey's exact heights (bumps ironed out, terrace steps kept, every walkable cell covered so there's nothing to fall through), and you slide along invisible wall boxes (everything from knee to 3 m beside the floor). Invisible clip walls close the edges.
- **The way through:** a paved flagstone road follows the route: start in the square → checkpoint gate (north-west corner of the square) → comms hut (south-west corner) → lane gate → up the lane → barracks and depot on the little square beside the lane → bunker portal at the lane's east end. The square's east road is closed by a wall of containers, so there's one clear route. Nav nodes every 2.5 m along the road and a re-link pass keep the soldiers' paths connected round every prop.
- **Lane detail:** lanterns, a power line with sagging cables, barrels, crates, hand carts, firewood, camouflage nets, sandbag nests — all against the walls, none on the road.
- Verified: an automated walk of the whole route with real player collision (no snags, no sinking), every objective and interaction, soldiers detecting and attacking on the new ground.


### Blackridge removed; Stage 3 — GREYWATER (October 18)

- **Blackridge is gone** (with its mission system, HUD, set dressing and the 45 MB scan). The sections above are history.
- **GREYWATER** (`level/Greywater.ts`): a hillside farming village held by a militia, 16 hostiles, Frostline-style: clear them all. Layout from the "Residential buildings, villages, country house" photogrammetry scan (Metazeon, CC BY 4.0), used **only as a blueprint** — nothing of the scan is drawn.
  - `scripts/assets/blueprint-scan.mjs` (no dependencies: its own GLB reader and PNG decoder) reads the scan from above on a 0.5 m grid and writes `src/assets/maps/greywater.json` (~0.5 MB): the bare ground's heights (measured in the open, filled in smoothly under houses and trees), the surface (cobbles / earth / grass), ~740 house footprints with orientation, eave and ridge heights and roof colour, and the trees. Re-run: `node scripts/assets/blueprint-scan.mjs --in=<scan.glb> --out=src/assets/maps/greywater.json --png=debug.png`.
  - The village is clean game geometry (`level/Geo.ts` batches every box into one mesh per material per 60 m zone): plastered houses in four tints with a window in every 3 m storey (shutters on some), stone sills, lintels and skirting, plank doors, gable roofs in clay tile / slate / tin with ridge caps, flat roofs with parapets. Houses on slopes are dug into the hill. New procedural textures: plaster, facade-with-window, clay tiles, slate, cobbles, grass, earth, plank door.
  - **Enterable houses** in the fight: real walls with window openings, a doorway on the street side (with steps where the floor sits above the lane), a floor, ceiling, partition and furniture; their nav nodes are linked through the doorway.
  - Ground: earth everywhere with cobbled lanes and grass fields blended over it (soft vertex-alpha edges). You walk on an invisible copy of the same heights; Havok gets it as a mesh shape. Hills all round, late-morning sun, light haze.
  - Navigation: nodes every 2.5 m on the open ground of the fight (≈1,700), linked along slopes up to ~30°; pockets not connected to the main network are dropped, so every soldier can be reached.
- Download cost of the stage: ~0.5 MB (the blueprint) + code; the textures are generated at load.

### Greywater removed (October 18)

- The user found Greywater too low in detail and too limited to explore, so it was removed (`level/Greywater.ts`, `level/Geo.ts`, the blueprint JSON, its thumbnail and credit). The game is back to two stages: Red Dune and Frostline. The village textures (`addVillageKit`) and `scripts/assets/blueprint-scan.mjs` are still in the project, unused.

## Stage 3 — SANDSTORM: Operation Sandstorm (October 18–19)

A hostage-rescue mission on **"De_Dust 2 with real light"** by Neo_minigan (CC BY 4.0, after Valve's de_dust2). It started as a bomb defusal with a boss (the Viper), then a rescue with the Viper waiting at the hostage; since October 19 there is **no villain character** — the Viper is only the name behind the cell — and the mission takes you round the whole town.

**The map** (`level/Dust2.ts`) is built the Frostline way: the model is drawn as-is (unlit, the artist's baked noon light) and everything the game touches comes from the voxel tool. Assets:
- `node scripts/assets/prep-dust2.mjs ~/Downloads/de_dust_2_with_real_light.glb src/assets/maps/dust2.glb 2048` — the eleven 4096² baked atlases → 2048² WebP (12.5 MB). It also paints out the original 1.6 map's advertising banner for a real website (part3 atlas). The full 4096² set needs ~1 GB of video memory: it ran at 60 fps for a while, then sank to 3 fps and froze the browser, so it isn't shipped.
- `node --max-old-space-size=8192 scripts/assets/voxel-map.mjs --in=… --u=1.4773 --mode=all --ceil=4 --out=src/assets/maps/dust2-data.json` — collision boxes (9,717), nav nodes (799) with cover flags, links, doorways. New options: `--u` (node units → metres: the Sketchfab export is pre-scaled) and `--mode=all` (an outdoor map: the largest connected walkable area, no indoor seed).
- A fine sandstone grain (Babylon detail map, tiled every ~0.6 m at the atlases' measured 46 m per UV unit) keeps walls crisp at arm's length. Desert sun and sky match the baked light; sand, dunes and mesas surround the town (seen from the rooftops and in the briefing).

**The route** — the cell has walled off the streets with piles of supply crates (`BARRICADES` / `crateWall` in `level/Dust2.ts`), wall to wall, about 2.3 m high:
- two rows of big wooden crates ("military wooden box" by ForevereQ);
- a row of the game's green ammunition crates;
- another row of wooden crates;
- a loose top of ration boxes ("Ration cardboard box" by Sousinho), small wooden crates and ammo cans.

The wooden-box file is a heap of six crates. `prep-props.mjs` splits it into six upright crates, which become variants in `Props`. Each pile has one collision box that blocks movement, bullets and sight, and the AI's nav links through it are cut. That leaves one way round the whole map:

1. **Market** (south-east) — start in the south square; its west doorway and mid are blocked. Clear the market. When only one or two soldiers are left, they're marked.
2. **Tunnels** — go down into the dark tunnel hall. Against its south wall are four steel lockers (`level/Lockers.ts`, "Locker Room - 1MB" by Mehdi Shahsavan), lit dimmer to sit in the dark. Hold F at a locker for 1.2 s and its door swings open. One holds a folder with a key ring, a different locker each run. The **transfer order** shows on screen: Dr. Cole is in the south-west yard behind the west gate. The yard is marked on the full map. ▸ **Checkpoint 1**
3. **North to the west site** — out of the tunnels, through the depot (north-east site) and their HQ to the west site. ▸ **Checkpoint 2** when you reach it.
4. **West gate** — down the long road to a locked steel double gate (`level/Gate.ts`). Hold F for 2 s at the padlock to open it. ▸ **Checkpoint 3**
5. **Rescue** — the yard: kill his two guards (until then the chair prompt reads "KILL HIS GUARDS FIRST · N LEFT"), then hold F for 3 s to unlock the cuffs. He gets up (Sit To Stand) → MISSION COMPLETE · HOSTAGE RESCUED.

**Soldiers:** two in each part of town (`ZONES`), 18 in all. Market and tunnels are awake from the start; the rest wake when you find the orders, and the yard when the gate opens.

**Checkpoints** (auto-saved every two areas, "CHECKPOINT SAVED" on the HUD):
- **What's saved:** where you stand, the stage, which soldiers are in play and which are already dead, the gate, and the open lockers.
- **When you die** (or the hostage is killed) after a checkpoint, the results screen offers **RETRY FROM CHECKPOINT N**. It also offers **RESTART MISSION**.
- **On a retry:** you're back at the checkpoint with full health. Everyone you'd killed by then stays dead, and the rest are back at their posts. Restarting from the pause menu starts the mission over.
- **Code:** `Mission.checkpoint/resume`, `Game.restart(fromCheckpoint)`.

Fail: you die, or your bullet or blast kills the hostage.

**The hostage** (`level/Hostage.ts`): "Prisoner Hostage Low Poly Character" by 00amza (CC BY 4.0), seated on a wooden chair. He wears "Handcuffs" by polarb (CC BY 4.0): 308k triangles / 12 MB, cut to 4.6k triangles / 88 KB by `scripts/assets/prep-props.mjs`. The rigid cuffs are fitted to his wrists each frame, rings facing along the forearms. When he's freed they drop to the ground. The pose and the stand-up are bone directions in his body frame: Sit To Stand is baked from the FBX by `scripts/assets/fbx-anim.mjs`. He has hitboxes, so your fire can kill him; enemy fire can't.

**Why the F prompt didn't show before:** the old mission only offered "free him" after the Viper was dead. If you reached the chair first (or the Viper never got to his mark), nothing appeared. Now the prompt is always there by the chair, and it says what's still in the way.

Assets: `node scripts/assets/prep-props.mjs ~/Downloads/handcuffs.glb "~/Downloads/locker_room_-_1mb (1).glb" src/assets/props` (handcuffs simplified, locker textures to 1024² WebP). `Props.load` fetches only the kinds a stage places (Sandstorm: the three crate models).

Dev helpers (`?quick=dust2`):
- `T.fly(x,y,z, tx,ty,tz, fov)` is a free camera; `T.back()` returns.
- `T.go(x, z, yaw)` teleports to the nearest nav node.
- `T.g.mission` exposes the mission; `T.g.mission.go("depot")` and the like jump to a stage.

Verified in the browser:
- **Interactions, with real key presses:** locker search (empty lockers, then the dossier, the paper and the objective change), the gate unlock, the guard prompt by the chair, freeing him, the stand-up cinematic, MISSION COMPLETE, and a restart that re-locks everything.
- **Barricades:** each one stops a sprinting player.
- **Nav graph:** there is no path from the start to the hostage while the gate is locked; there is one once it's open.
- **Performance:** 60 fps.
- **Crate walls and underground lockers (Oct 19, later):**
  - Each crate wall stops a sprinting player.
  - There's still no path to the hostage while the gate is locked.
  - The locker search works in the tunnel hall.
  - Checkpoints 1, 2 and 3 all save. Dying and choosing RETRY put me back at the right spot with full health and the right objective, and the 14 soldiers killed before checkpoint 2 stayed dead.
- **Oct 19, last fixes:**
  - **Restart:** after you'd finished the mission, the ending cinematic left the game HUD hidden, so every F prompt (guns, lockers) was invisible after RESTART. `Game.restart` and the mission's reset now show the HUD and the weapon again; checked with a real restart after MISSION COMPLETE.
  - **Stand-up cinematic:** the cameras are picked in front of Dr. Cole, facing the open yard. Each end of each camera move must be clear of walls by 35 cm and see his head, both seated and standing. Checked in the browser.

## Red Dune — the Hulk (October 19)

Halfway through Red Dune (once 40 % of the soldiers are down) **the Hulk** comes in: `enemies/Hulk.ts`, using the model "Hulk | Marvel Rivals" by King_45 (Sketchfab, CC BY 4.0).

**Licence caveat:** this is a Marvel Rivals character model of a Marvel character. Keep the game personal and non-commercial while it's in; a public or commercial release needs it replaced.

- **Entrance (cinematic):**
  - He comes out of the sky in one huge leap from about 55 m away and lands 12–20 m in front of you, on open ground in your view.
  - The air time is the middle of your "Jumping Down" clip, stretched over the 2.3 s flight.
  - The landing leaves a dust wave, rubble and a crater.
  - He roars (the model's own flex emote) and the title card reads "HULK · The strongest one there is". Your view follows him in.
  - The soldiers hold until he's down.
- **Fighting:**
  - He runs you down: straight at you when the way is clear, otherwise along the nav graph. Heavy footsteps shake the ground near him.
  - From 9–28 m, with a clear arc, he **leaps** at you using the model's jump-attack clips and lands just short of you. The shockwave does 40+ damage and throws you.
  - Up close he throws your **Punching, Right Hook, Kicking and Combo Punch** clips. Each blow damages you, knocks you back (`PlayerController.knock`) and shakes the camera.
- **Anger** (the madder he gets, the stronger he gets):
  - The bar reads ANGRY → ANGRIER → HULK SMASH!
  - At ⅔ and ⅓ health he roars and pounds the ground (a shockwave). Each time he also grows (+7 % / +14 %), glows (green eyes, a sheen on his skin), runs faster (5 → 6 → 7.2 m/s) and hits harder (×1.3 / ×1.65). His heavy hits come more often.
- **Health:**
  - 1700. Bullets do 60 % (head ×1.3); grenades and rockets do full damage and can stagger him.
  - Beaten, he falls and stays down (`Dead_F`), which counts as a kill. SECTOR CLEARED needs every soldier and the Hulk.
- **Assets:**
  - `node scripts/assets/fbx-anim.mjs` turns each FBX into bone directions.
  - `node scripts/assets/prep-hulk.mjs ~/Downloads/hulk__marvel_rivals.glb <clips dir> src/assets/characters/hulk.glb` brings the model from 92 MB down to 10.5 MB:
    - 25 of its ~200 clips;
    - no extra UV sets or tangents;
    - 1024² WebP textures;
    - the Mixamo clips **retargeted** onto its Unreal-style skeleton as real glTF animations (`mx_*`): bone directions in the body frame, parents first, fists from the model's own punch.
- **Sounds** (synthesized in `SoundBank.ts`): `hulkRoar`, `hulkSlam`, `hulkPunch`, `hulkStep`.
- **Verified in the browser:**
  - the trigger after 6 kills;
  - the entrance with soldiers frozen;
  - chase, kick and punch hits on the player;
  - the leap sequence;
  - rage stages 1 and 2 (growth, glow, bar colour);
  - real rifle bullets (7 hits = 109 damage);
  - the knockout and SECTOR CLEARED with 16 kills;
  - 60 fps with him fighting.

### Oct 19 (later): Hulk moves, thunderclap, Red Dune fixes, Sandstorm story, soldier aim
- **Sandstorm story:**
  - The hostage is now **Ambassador Adrian Cole**, the UN Special Envoy carrying the signed ceasefire accords ("if he dies, the ceasefire dies with him").
  - The place is an **old walled desert kasbah**, not a town; Command's lines, the letter and the stage card are rewritten to match.
- **Red Dune floating pipes:** `LevelBuilder.cylinder` lifted every cylinder by half its *length*. That's right for upright tanks, but pipes laid on their side (`rotZ`/`rotX`) floated metres up: the pump-house outfall pipe at 5.7 m, the pipe under the warehouse sign at 9 m. A tipped cylinder now rests on its base height.
- **Hulk sounds:**
  - His entrance is the rush of something falling out of the sky (`hulkIncoming`), then the landing impact.
  - His roar is `public/sfx/hulkRoar.mp3` (the user's Voicy_Roar), loaded through `loadOverrides`.
  - Leaps get a short rush of air (`hulkLeap`).
- **Hulk moves:**
  - **Melee** is the model's own Marvel Rivals punches (`101211_Punch_01–04`, hits measured at ~25 % of each clip), thrown in flurries (more when angrier). The retargeted Mixamo punch/kick clips are no longer used: the kick's foot never actually moved.
  - **Entrance:** the "Jumping Down" clip now plays through the flight. Scrubbing with `goToFrame` didn't update the pose in this Babylon version, so it's played with its speed stretched instead.
- **THUNDERCLAP** (`mx_Thunderclap`, keyed by hand in `prep-hulk.mjs`: arms flung wide, then slammed together in front of his chest):
  - From 5–16 m with you in front of him, now and then (more when angrier; 11 / 8 / 5.5 s cooldown).
  - The blast is a shock ring and a wall of dust rolling forward (`Explosions.clapBlast`) plus a huge crack-boom (`hulkClap`).
  - In a 20 m cone it throws you back (about 12 m from 9 m away), lifts you off your feet and **knocks you down**: `PlayerController.knockDown`. While down, the view drops to the ground and tips, you can't move, jump or shoot, and you get up after 1.3–2.3 s.
- **Soldiers no longer fire when they aren't facing you.** "Aimed" used to mean "finished turning to the heading I want", which while backing off or running for cover is the way they're going. Now their body must be turned onto you (within ~30°; the spine twists the rifle the rest).

## Round 9 (October 20): fixes + Phase 1 of the roster plan

### Fixes
- **Stage select** is a carousel (◂ ▸ buttons, ← → keys, dots), so LAUNCH stays on screen.
- **Whiteout is renamed HEROES PLAYGROUND.** All the heroes, foes and the air war now live there. **Red Dune** is back to the plain 15-soldier depot, at its original size (the arena extension was removed).
- **Bodies hanging in the air:**
  - Ragdolls are no longer frozen in flight when the 8-ragdoll limit is reached; only settled bodies are frozen, with up to 16 while bodies are still flying.
  - Wolverine, Batman and the Hulk fall under gravity from any height when they go down.
  - Superman lets go of anyone he's carrying when his move is cut short.
- **Iron Man's repulsor bolts** keep moving and expire even after he's gone.
- **Landings differ:** Wolverine lands feral on all fours, Batman in a cape-spread crouch, Superman upright.
- **Superman's jet takedown:** he holds his flying pose, both fists forward.
- **Developer mode** (Settings → Developer mode): the panel shows only on the pause screen, at the right. In play only short toasts appear.

### Phase 1 — shared foundation (no new characters in gameplay yet)
- `src/characters/factions.ts`: hero / villain / independent sides, with relations ally, neutral or hostile. The Doom–Thanos relation is set with `setRelation`.
- `src/characters/abilities.ts`: `AbilityDef` and `AbilityBook` (cooldowns, range, damage, stagger, size limits, energy, and a pick of the usable ones).
- `src/characters/brain.ts`: the AI state machine (idle … bossPhase, cinematic, defeated) with a watchdog that pulls a stuck state back to `select`.
- `src/characters/cinematics.ts`: `CineDirector`. Game registers every entrance in one priority list instead of the hand-written chain.
- `src/characters/roster.ts`: the registry of all 20 characters (the 17 in the plan plus Superman, Wolverine and Batman), with side, role, tier, status, model, height, stats, weapons, abilities, entrance and boss phases.
- `HeroRig.AUTO`: one bone-name mapper for Mixamo, 3ds Max Biped (all spellings) and Rigify. It makes the joints a rig lacks, and twist bones ride along automatically.
- `scripts/assets/prep-roster.mjs`: the 13 new models go to `src/assets/roster/` (textures 1024² WebP; Star-Lord and Doom simplified).
- **Roster audit** (dev, `?quick=…` then `await T.roster(x, y, z)`): loads every roster model through the hero rig and reports joint height, skinned-mesh height and clips. All 13 pass; skeleton and mesh heights agree to within about 0.1 m.
- **Found by the audit:**
  - The weapons in Thor's, Captain America's, Star-Lord's and Ronan's models are separate pieces left at their rest spots. They must be attached to the hands.
  - Rocket has no gun.
  - Ultron and Darkseid render very dark; their materials need tuning.
  - Fixed: the synthesized head-top joint was sized in absolute metres, so Ultron rendered about 0.3 m tall.

## Phase 2 (October 20): the Hulk on your side, and seven new heroes

### The Hulk is a permanent ally
- Set by the roster (`faction: "hero"` → `HulkHost.ally`).
- He goes for Wolverine, Batman and the soldiers (wrapped as `Combatant`s in `Game.asCombatant`). He never targets you or the heroes.
- Your bullets, knife and grenades pass him by.
- The foes, the jets and the air strikes can hurt him: he's in `Game.heroesUp()`, the one list everything reads.
- With nobody to fight he walks with you, leaping in if he falls far behind.
- Knocked out, he falls to the ground, stays down for 14 s, then rises with half his health and a roar. Nothing ends because of it.
- He has a heroes'-panel bar instead of a boss bar, a green mark on the map, and isn't counted in the hostiles.

### The new heroes: `allies/RosterHero.ts` + `allies/kits.ts`
- **One shared fighter** composes the Phase-1 parts (Brain with watchdog, AbilityBook, CineActor, the AUTO rig) with ground movement (sub-stepped, so the Flash can't pass through walls), flight (Captain Marvel), dodging foe wind-ups, knockback, knockout, falling from any height, and getting back up.
- **Each kit** brings its own poses, moves, landing, entrance and lines:

| Hero | Moves | Entrance |
|---|---|---|
| Thor | hammer combos with a lightning crackle, lightning strike from the sky (also at aircraft), Mjolnir thrown and caught, God of Thunder storm (rises up, bolts on everyone round him) | lightning strike, kneeling landing |
| Captain America | shield bash combos, shield throw with one ricochet and return, block (his dodge), rally that powers up nearby roster heroes | drop from 38 m, three-point landing behind the shield |
| Captain Marvel | flies all the time; photon volleys, charged photon beam, fist-first ram (also at aircraft), Binary mode | slow golden descent, hovering |
| Star-Lord | dual element-gun bursts, gravity mine, jet-boot hop (his dodge) | jet-boot flight in, crouching skid landing |
| Drax | knife-hand combos, shoulder charge, overhead finisher | walks out of a smoke wall, roars |
| Rocket | rapid fire, explosive rounds, bomb toss | gallops in on all fours, racks the cannon |
| The Flash | dash strike, 14-blow speed flurry, lightning throw, blink dodge | streak round you, skid stop |

- **Arrival order** (`Game.SQUAD_PLAN`), each after someone else is in:

| Hero | Arrives |
|---|---|
| Cap | 20 s after the Hulk |
| Thor | 20 s after Wolverine |
| Star-Lord | 15 s after Iron Man |
| Rocket | 12 s after Star-Lord |
| Drax | 15 s after Deadpool |
| Flash | 12 s after Batman |
| Captain Marvel | 15 s after Superman |

- **Dev keys:** `;` Thor · `'` Cap · `,` Marvel · `.` Star-Lord · `/` Drax · `\` Rocket · `P` Flash.

### Props
None of these models came with animations, so each prop is placed by its own geometry.
- **Thor:** the hammer bone sat 1.3 m off his hand. It's now seated in his fist (`seat`), handle across the palm, head down.
- **Cap:** the shield sits on the outside of his left forearm. The loose spare copy is folded away.
- **Star-Lord:** the guns are re-hung from the Rigify FK controls onto the deform hands, turned along the forearms.
- **Rocket:** has no gun in his model, so he carries Deadpool's sci-fi blaster at 1.4× scale.

### Rig work: `HeroRig`, AUTO rigs only
- Whatever hangs off bones nothing moves (Rigify's face bones, hair and teeth) rides with the nearest posed bone. Only bones that carry skin count, and each branch is held once at its top.
- Pose world positions are recomputed from the pelvis down, not from the scene root.
- Heroes more than 35 m (or 70 m) from the camera are posed at 30 Hz (or 15 Hz).

### Balance
- With the Hulk on your side, Wolverine's and Batman's health scales with the heroes up when they arrive: +12% each (`scaleFoe`).
- Reinforcements: 3 soldiers per hero arrival, from 32 slots.
- The Playground ends only when every foe has come and gone down and every hero is in. While the field is empty, the arrival clocks run 5× faster.
- The ending waits for any entrance still playing.

### Tested (simulated in the browser)
- **Hulk:**
  - Your bullets and blasts do 0 damage to him, and none of his blows hit you.
  - He killed 8 soldiers in 40 s.
  - He and Wolverine fight each other.
  - He's not counted as a hostile.
  - He gets back up after a knockout.
- **Each new hero:** comes in, fights with all their moves, the watchdog never had to step in, and they stand on the floor after their entrance (0 m gap).
- **Full Playground run:** WON at 255 s with the Hulk alive and all 11 heroes in.

| Character | Arrived |
|---|---|
| Hulk | 3 s |
| Cap | 28 s |
| Spider-Man | 53 s |
| Wolverine | 99 s |
| Thor | 128 s |
| Iron Man | 145 s |
| Star-Lord | 166 s |
| Rocket | 184 s |
| Deadpool | 189 s |
| Batman | 200 s |
| Drax | 220 s |
| Flash | 226 s |
| Superman | 238 s |
| Captain Marvel | 252 s |

### Known / not done
- **Frame rate:** about 37 fps on this machine with the Hulk, Spider-Man, Wolverine and the seven new heroes on screen.
  - Posing costs about 0.8 ms a hero (Star-Lord about 2.2 ms with his 1,053-bone rig); Superman's cape costs about 3.8 ms.
- **Foes:** the only foes are still Wolverine, Batman, the soldiers and the aircraft. The villains are Phase 3.
- **Not watched:** the full entrance timings of every hero.
- **Rigs:** Star-Lord's shoulders bunch when his arms go high (a Rigify limitation here).
- **Lines:** subtitles only; no voice files are used.

## Phase 3 (October 20): the villains

`enemies/RosterVillain.ts` + `enemies/villainKits.ts`. The same fighter as the heroes (RosterHero, now side-aware through the roster's faction), plus what makes him a Foe:
- **Hit boxes and solid body:** hit boxes along his bones (your bullets and knife), a blast test (grenades, rockets, the heroes' explosions), and a body you can't walk through.
- **The Foe interface the heroes already use:**
  - every damaging move announces its wind-up (`threat`), so the heroes dodge it;
  - Spider-Man can web him, Superman can freeze him (bosses break free sooner) or carry and slam him, and any big blow can shove him.
- **Boss bar and phases:** his health bar sits in a new column at the top (with Wolverine's and Batman's). At the roster's phase thresholds he stops, does his kit's phase move (ENRAGED, then FINAL PHASE), and hits 20% harder after each one.
- **Defeat:** beaten, he's down for good and counts toward the win. Villains don't regenerate.
- **Health:** scaled to the team he walks into (+12% per hero up).
- **Targets:** whom he fights is the Game's: you and the heroes, and his rival first. Doom, an independent, also fights the villains if `setRelation("independent", "villain", "hostile")`.

| Villain | Moves | Phase move | Entrance | Rival | Arrives |
|---|---|---|---|---|---|
| Joker | pistol, laughing-gas canister (a gas cloud that hurts), smoke escape (vanishes and reappears 9–15 m away), joy-buzzer shock | — | pops out of green smoke mid-bow | — | 25 s after Cap |
| Ronan | Universal Weapon swings, ground strike (8 m ring), staff-head beam | a bigger slam | marches in, raises the staff, splits the ground | Drax | 22 s after Thor |
| Ultron | flies; dual energy bolts, chest-level beam, armour shield, three orbiting drones that fire for 9 s | an overclock blast | red sparks pulled to a point, then he's there | Iron Man | 20 s after Iron Man |
| Darkseid | his model's own attack clips (ATTACK001_1/002/003), Omega beams from his eyes, cosmic slam (SKILL004, 10 m) | TAGSKILL001 slam | a Boom Tube ring of light; he walks out of it | Superman | 20 s after Superman |
| Doctor Doom | green blasts, force field, mystic bolt beam, mystic seal (a ring that bursts at the target) | green lightning on everyone near | descends in a column of green fire | Thor | 20 s after Captain Marvel |

**Dev keys:** Shift + 1 Joker · 2 Ronan · 3 Ultron · 4 Darkseid · 5 Doom.

**Props and models:**
- Ronan's staff hangs off the Biped root, so it's held to his right hand each frame (`SkinnedRig.pin`). Re-parenting a bone's node doesn't move its skin in Babylon.
- Ultron, Darkseid and Doom have their materials brightened.
- Darkseid's own clips can carry root motion, so pelvis offsets from clips are clamped.

### Tested (in the browser, simulated)
- **Each villain:** comes in, uses every move, damages you and the heroes, takes damage from them, and the watchdog never broke one.
- **Phases and defeat:** forcing Darkseid's health down showed ENRAGED at 60%, FINAL PHASE at 30%, then DEFEATED, down on the floor, and out of the foe list.
- **Full Playground run:** every arrival in order, all 18 characters. You were invulnerable and only the first 6 soldiers were killed by script.

| Villain | Arrived | Defeated |
|---|---|---|
| Joker | 65 s | 121 s |
| Ronan | 168 s | 293 s |
| Ultron | 187 s | 319 s |
| Darkseid | 329 s | 505 s |
| Doom | 350 s | 536 s |

- **The ending:** the stage didn't end in that run because Iron Man had flown off. That's fixed ("arrived" now means "came at some point"), and a scripted re-check reached WON.

### Known
- **Frame rate:** each villain costs 1.0–1.7 ms of simulation, on top of Phase 2's cost. With everyone in, frame rate is below Phase 2's 37 fps (not measured with the pane visible).
- **Pacing:** the late boss fights are long: Darkseid lasted 3 minutes, Doom 3 minutes.
- **No summons:** Ultron's drones and the Joker's gas are effects, not characters. There are no Doombots or decoy models.
- **Lines:** subtitles only.

## Phase 4 (October 21): Thanos, the final boss

The THANOS kit in `enemies/villainKits.ts`, on the villain framework, is three fights in one:

| Phase | Health | Thanos fights with | Phase move |
|---|---|---|---|
| 1, the brawler | 100–66% | heavy combos, a grab (squeezed three times, then thrown 18 m), a stomp shockwave (9 m), a block | — |
| 2, the stones | 66–33% | the Power Stone beam from the Gauntlet; Space Stone portals (gone in a ring of blue light, out behind his target with a blow) | he raises the Gauntlet, the stones crackle, a shock ring throws everyone near |
| 3, the moon-fall | under 33% | rocks rain on all of you, each with a burning warning ring first, which the heroes read and dodge | "I will shatter this world to the last stone." |

- **The finale:** he arrives only when every other foe (Wolverine, Batman, the five villains) is down and every hero has come.
- **Entrance:** a Space Stone gate opens; he walks out with the Gauntlet up.
- **During the fight:** the objective reads DEFEAT THANOS. His bar leads the column and is bigger. The Gauntlet (his left hand, from the model's skin weights) glows with the stones. His rival is the Hulk.
- **Defeat (`Kit.outro`, filmed by the director):** he goes down on one knee, the Gauntlet sparking ("…Impossible."), then the camera cranes up over the field.
  - The win comes only after the outro.
  - The result reads THANOS DEFEATED, and the objective THANOS IS DOWN.
- **Health:** 9,000 base, scaled by the heroes up (+12% each). About 21,000 with the whole team.
- **Dev key:** Shift + 6.

### Tested (in the browser, simulated)
- **Phases:**
  - Forced to 60% health, the phase move played.
  - In phase 2 he used portal ×6 and power beam ×11, alongside combo, grab, shockwave and block.
  - Forced to 30%, the moon-fall came in. The bar read ENRAGED, then FINAL PHASE.
  - Fixed: the Power beam had fired in phase 1, and the stone powers needed more distance than a crowded fight leaves.
- **Arrival:** with all 11 heroes in and all seven other foes down, he arrived by himself.
- **Defeat:** the outro played for 6 s, filmed, then WON.
- **Also fixed:**
  - Entrance cameras now also avoid a hero standing right at the lens.
  - The ally Hulk no longer flashes orange under a long beating.

### Not done / limits
- **No full timeline run** with Thanos at the end: the finale was triggered by script, though every arrival before it was checked in Phase 3's run.
- **Frame rate** is unchanged from Phase 3: heavy with the whole cast.
- **The stones** are effects (glow, beam, portals, meteors). Reality, Time, Mind and Soul have no powers of their own.
- **Lines:** subtitles only.

## Phase 5 (October 21): polish — frame rate, and a full playthrough to Thanos

### Frame rate
The worst case: every hero (12) and every foe but Thanos (7) up at once, plus the soldiers and the air war. Before, about 26 fps (25.6 ms simulation + 13 ms render). After, **40–43 fps** on this machine. Normal play has two or three foes up at a time, so it runs above that.

- **Posing (the main cost):**
  - `SkinnedRig.pose` keeps each joint's world matrix until a bone above it turns. It used to recompute whole chains.
  - Bodies far from the active camera pose less often: every frame within 10 m, every 2nd to 25 m, 3rd to 50 m, 5th beyond. This is measured from the cinematic camera too, so a filmed character is never throttled.
  - Rigs with more than 800 nodes (Star-Lord's Rigify) pose at most every other frame.
- **Superman's cape:** the constraint loop recomputed the cape root from the scene root 72 times a frame. It's computed once now: 2.8 → about 1 ms.
- **Hit boxes and hands:** villains' hit boxes and kits' hand and muzzle points read the joint matrix the last render already computed, a frame old at most. They no longer recompute it.
- **Culling (`Game.setupCulling`):**
  - Every character is culled as a whole: a sphere round him against the camera, and nothing past 160 m. Off-view, his meshes are left out by layer mask.
  - Soldiers skip their small parts (under 2,500 triangles) past 30 m.
  - Characters cast shadows only within 32 m of you.
  - On the Playground, shadows are redrawn at 30 Hz.
- **Trees and lightning:**
  - The pines are thin instances (2 draws for 209 trees, where there had been 418 instances).
  - Lightning crackles under 2 m are two segments, and only big bolts get a white core.

### The full playthrough (simulated: you invulnerable, the first 6 soldiers taken by script, then hands off)
**WON at 632 s.** The Hulk was never knocked out, one hero (Cap) was knocked out once and got up again, the watchdog stepped in once in the whole run, and there were no console errors. The result read THANOS DEFEATED / THE PLAYGROUND HOLDS.

| Character | Side | Arrived | Down |
|---|---|---|---|
| Hulk | hero | 17 s | — |
| Cap | hero | 42 s | — |
| Spider-Man | hero | 67 s | — |
| Joker | villain | 79 s | 136 s |
| Wolverine | foe | 118 s | 188 s |
| Thor | hero | 147 s | — |
| Iron Man | hero | 163 s | — |
| Ronan | villain | 181 s | 287 s |
| Star-Lord | hero | 190 s | — |
| Ultron | villain | 201 s | 338 s |
| Rocket | hero | 213 s | — |
| Deadpool | hero | 221 s | — |
| Drax | hero | 247 s | — |
| Batman | foe | 268 s | 316 s |
| Flash | hero | 289 s | — |
| Superman | hero | 306 s | — |
| Captain Marvel | hero | 327 s | — |
| Darkseid | villain | 338 s | 515 s |
| Doom | villain | 360 s | 489 s |
| Thanos | final boss | 518 s | 626 s |

**Found and fixed in the playthrough:**
- The Joker's smoke escape could put him on a nav node outside the fight's bounds, where nobody could reach him. He threw gas from there for minutes.
- Escapes now pick in-bounds spots with a floor, and every roster character is kept inside the bounds each frame (knocks, throws, teleports).

### Still open
- **Not 60 fps:** about 40 with everyone at once. The rest is mostly draw calls (characters with many parts: Star-Lord 55, soldiers 18) and the 8 post-process passes.
- **Balance:** with 11 heroes the side rarely loses anyone, so the difficulty sits on you. The foes target you first only sometimes.
- **The playthrough was simulated**, not played with a mouse and keyboard.

### Frame rate, round 2 (October 21): 60 with the whole cast
**Measured:** step + render + `gl.finish()` per frame (`window.FT` in the dev test harness, so GPU time is included; the GPU wait was 0, so the frame is CPU-bound). The worst case is all 12 heroes and 7 foes at once with the soldiers and aircraft: **14.5 ms a frame, 66–69 fps** (step 6.7 ms, render 7.8 ms). It was about 19.5 ms before this round, and about 39 ms before Phase 5.

- **Sprite streams** (the glow, smoke, trails, frost, heat glow): an empty stream no longer re-zeroes and re-uploads its whole buffer every frame. Only the quads written last frame are cleared, and free slots are found round-robin. This was the biggest single saving: step 10.4 → 6.7 ms.
- **Update-rate LOD (`Game.lodStep`, `EnemyManager.lodOf`):** characters on screen within 15 m (or filmed) update every frame, on screen 15–50 m at 30 Hz, and further or off screen at 15 Hz. They're handed the time they skipped, so nothing runs slow.
- **Props:**
  - A prop whose materials differ only in colour (the sci-fi blaster: 30 materials, one texture) is drawn with one material, colours baked into the vertices. Deadpool's and Rocket's guns went from 30 draws each to 1.
  - Rigid static props sharing a material merge under the bone they ride on: a soldier's pouches and patches, and Star-Lord's gun parts.
- **Cheaper joint lookups:** `SkinnedRig.at` recomputes only from the pelvis down, refreshing the chain above it when the anchor has moved.
- **Character shadows** within 15 m. Character meshes skip bounding-box sync (they're culled by the Game, not by Babylon).
- **Character materials** are frozen after warm-up.

**Re-checked:**
- A full simulated playthrough with all of this on: WON at 616 s, Thanos 506 → 610 s, the Hulk alive, no hero knocked out.
- The soldiers, the blasters and the effects were checked by screenshot.

**Caveats:**
- The numbers are this machine's, measured headless. A slower CPU will see less.
- With the browser pane hidden, the frame loop doesn't run, so these are step-by-step timings, not a counted on-screen fps.
- Off-screen characters at 15 Hz turn a little coarser if you spin round fast.

### Thanos arrival fix (play-test)
- Thanos is the final entry on the Heroes Playground. He still comes once every other big foe is down and every hero has arrived, but now also comes **9 minutes after the Hulk lands** (6 before round 10) the moment nobody else is fighting; anyone not yet arrived is skipped, and no new villain comes once he's in.
- The objective line tracks him: `FINAL BOSS: THANOS · n FOES TO GO · m:ss`, then `THANOS ARRIVES IN Ns`, `DEFEAT THANOS`, `THANOS IS DOWN`.
- Beating Thanos ends the fight even if some foes never arrived; the soldiers still have to be cleared to win.

### Thanos's final-boss entrance (12 s, skippable with F / Space)
1. **0–3.4 s:** the sky goes dark purple and lightning strikes the ground where he'll land (wide shot).
2. **2 s:** a Space Stone gate tears open.
3. **3.4–6.4 s:** he walks out of it, silhouetted (low shot looking up).
4. **6.4 s:** his last step shakes the ground and throws out a shockwave.
5. **7–9 s:** close on the Gauntlet as the six stones light one by one.
6. **9.4 s:** the fist closes, with a burst of light and a roar.
7. **9.7 s:** title card "THANOS · THE MAD TITAN", then his line.

The sky stays a darker storm light while he's up and clears when he's beaten or on restart (`Game.applySky`).

## Round 10 (October 21): the second wave — 12 new characters, 29 in all

### The sides
Decided in one place, `characters/factions.ts`, so the combat code never has to know:
- A new **monster** faction (Godzilla) is hostile to everyone.
- **Venom** is independent. `sideOf("venom")` decides which side he's built on, the squad (`RosterHero`) or against you (`RosterVillain`), from the same kit:
  - by default he's against you;
  - `setSide("venom", "hero")` puts him on your side for a mission;
  - `?venom=ally` in the URL tries it.
- A villain's targets are now checked against each target's own faction. Before, the code only tested "is he hostile to villains", so the villains ignored Godzilla.
- All kits are in one table, `characters/allKits.ts`.

| On your side | Against you |
|---|---|
| Hulk, Spider-Man, Iron Man, Deadpool, Superman, Thor, Captain America, Captain Marvel, Star-Lord, Drax, Rocket, the Flash, **Doctor Strange, Ant-Man, Ironhide, Toothless, Silver Surfer, Human Torch, Mister Fantastic** | Wolverine, Batman, Ultron, Ronan, the Joker, Darkseid, Doctor Doom (independent), **Hela, Red Skull, Megatron, Venom** (independent, can be turned), **Godzilla** (monster), and Thanos last |

### The models (all 12 loaded from `src/assets/roster/`, copied from the files supplied)

| Character | Rig as supplied | What was done |
|---|---|---|
| Doctor Strange, Red Skull, Silver Surfer, Human Torch, Mister Fantastic | 3ds Max Biped | Read by the existing mapper. |
| Hela | Mixamo-style names | Read as is. Her spear and halberd are hidden; the two Necroswords stay in her hands. |
| Venom | Unreal mannequin (`pelvis`, `spine_01`, `upperarm_l`) | New name mapping. |
| Megatron | Valve biped (`ValveBiped.Bip01_*`) | New name mapping. He has no neck bone, so one is made. His mace has its own skeleton with the same bone names; the body's bones are the ones taken. |
| Ironhide | His own scheme (`L_Arm02_Shoulder_XB`), plus his vehicle as a second skeleton | New name mapping. The file's clip is an idle with the truck parked beside him, not a transformation. The truck is hidden. |
| Godzilla | His own scheme (`l_legJA_JNT`), one 10 s clip, CC BY-SA | Clip cut into idle / roar / stomp / lunge. The file sets metal to 1 with no metal map, which made him black, so metal is set to 0. |
| Toothless | Blender dragon control rig, only small clips | Mapped onto the pose skeleton (front legs as arms). Wings, legs, tail, head and jaw are turned procedurally every frame. His black colour with no texture didn't draw, so it's now a hair off black. |
| Ant-Man | **No skeleton**: four static meshes, Z-up | `characters/autoSkin.ts` builds a skeleton from his proportions when the file loads and weights each vertex to its two nearest bones. Checked in stance, run and punch: no tearing at the shoulders or hips. |

- **Rig mapper check:** the new mapping changes were re-checked against the 13 earlier rigs (`rosterAudit.duplicateJoints`). Every joint maps to the same node as before.
- **Credits:** all 12 are credited in `index.html`. Godzilla is CC BY-SA 4.0 (share-alike), not CC BY.

### Checklist (Verified = loads, rigs, entrance plays and ends, every move fires in a fight, beaten or knocked out without errors; all simulated in the browser)

| Character | Weapons | Movement | Powers (each one fired in a test fight) | Entrance | Status | Remaining |
|---|---|---|---|---|---|---|
| Doctor Strange | magic | ground | Eldritch bolts, Shield of the Seraphim (on himself and heroes within 7 m), Crimson Bands (holds a foe; shorter on big ones), sling-ring portal (only to a checked spot: on the floor, in bounds, in sight of the target; otherwise he stays), mandala blast | Portal opens, he steps through, a mandala under him | Verified | Cloak isn't simulated. |
| Ironhide | arm cannons | ground, heavy | Cannons (explosive), 10-shot barrage (hits aircraft too), steel-fist combo | A heavy march filmed low on his feet (the ground jumps at each step); he stops square on; the cannons come up, spin and glow | Verified | No transformation (none in the file). His truck is a second skeleton standing on end at rest; the file's clip only parks it, so it stays hidden. |
| Silver Surfer | board, Power Cosmic | flies on the board | Cosmic bolts, Power Cosmic beam, board ram, cosmic nova | Silver streak arcs down, he pulls up level | Verified | His texture is blue, so his body is plain chrome over its normal map. |
| Human Torch | fire | flies | Fireballs (explosive), flame stream, ring of fire (8 patches burning for 5 s, damage every 0.5 s, never every frame), Supernova (power ×1.6 for 12 s) | Comet across the sky, "Flame on!" | Verified | Fire is sprites on the body, not a full flame shader. |
| Mister Fantastic | stretch | ground | Long punch (arm up to 4× its length), stretch grab (pulls them in), whip sweep | Slingshots in on a stretched arm | Verified | The stretch scales the forearm along its own length. The rig's own stretch chains aren't driven. |
| Toothless | plasma | flies; walks on four legs when landed | Plasma blast (explosive), dive bomb, tail swipe | Spirals down, lands beside you, wings fold, looks round, screech | Verified | Folded wings are approximate. No riding. |
| Ant-Man | Pym Particles | ground, three sizes | Combo, shrink strike (×0.1: hard to hit, runs in, grows back into the blow), Giant-Man (×3.2 for 14 s: power ×1.8, damage taken ×0.6), giant stomp | A beetle-sized figure by your boot grows to full size | Verified | Skeleton made by the game. Giant-Man's footsteps slide a little. |
| Hela | Necroswords | ground, fast | Combo, thrown blades, blade eruption under the target (warned), counter-guard; a phase at 50% | Black-green smoke, she rises out of it, the swords form, title card | Verified | — |
| Red Skull | Tesseract pistol, grenades | ground, keeps range | Pistol, grenade (lands, blinks red for 1.1 s, then goes off), "Hydra! To me!" wakes up to 3 reserve soldiers round him, combo | Alarm, his guards come out first, he walks through them | Verified | No real cover-seeking: he keeps 14 m off. |
| Megatron | fusion cannon, flail | ground, heavy | Cannon (explosive), flail combo, ground slam; a phase at 50% (8-shot barrage, power ×1.3) | Ground shaking, he marches out of the haze dragging sparks, raises his fists, title card | Verified | No transformation (none in the file). Ironhide is his rival. |
| Venom | symbiote | ground | Combo, tendril lash (pulls them in, warned), pounce, regrowth (25% over 4 s, below 70% health) | A writhing black knot grows into him, title card per side | Verified, both sides | As an ally in a short test he only used his combo. |
| Godzilla | — | giant: walks over props, the ground under them | Stomp (his own clip), tail sweep (13 m, the tail actually swings), roar (throws small ones back), atomic breath (charges with the dorsal glow) | Distant roar, the ground jumping, he comes out of the haze at the field's edge, roar from below, title card | Verified | Webs and binds can't hold him. No destructible buildings (none are set up). His tread is the shared walk's legs under his own body. |

### Engine changes
- **Rig mapper:** Unreal, Valve, Transformers and Godzilla names. Where two skeletons share names, the body's bones are taken. Missing necks are made.
  - `RigNames.turn` and `RigNames.prep` (the latter runs on the loaded file, e.g. auto-skinning).
- **Kits:**
  - `Kit.rig`: the kit's own rig names.
  - `Kit.gait`: the kit's own walk.
  - `Kit.giant`: walks over props, the ground under them, and webs don't hold him.
- **`RosterHero.side`** comes from `sideOf`.
- **Big characters are measured by their size:**
  - the camera's "someone in the shot" check;
  - shadows (13.5 m plus their size).
- **Foe health scale:** now ×(1 + 0.1 per hero, up to 8), so at most ×1.8. It was uncapped ×(1 + 0.12 per hero): with 19 heroes that was ×3.3, and Godzilla had 50,560 HP.
- **Dev keys (Developer mode):**
  - **Alt + 1–7:** Strange, Ant-Man, Ironhide, Toothless, Surfer, Torch, Fantastic.
  - **Shift + 7 / 8 / 9 / 0 / −:** Hela, Red Skull, Megatron, Venom, Godzilla.
- **Arrivals:** the second wave arrives on the stage clock in a lane of its own, alongside the first, still one entrance at a time. Godzilla comes last before Thanos. A lull runs the clock fast. Thanos's fallback is now 9 minutes after the Hulk lands.
- **The objective line** says "THANOS IS COMING" only once he can actually come. Until then it shows how many foes are still to beat.
- **Doctor Strange's shields** now wear off on every hero, however far they've gone from him.

### Tested (simulated in the browser: you invulnerable, the first 6 soldiers taken by script, then hands off)
- **Full playthrough, re-run with the health cap in the code: WON at 714 s.**
  - All 29 arrived, one entrance at a time: the Hulk at 3 s, Strange 85 s, Hela 127 s, Ironhide 158 s, Red Skull 216 s, Surfer 255 s, Megatron 282 s, Torch 344 s, Venom 385 s, Fantastic 416 s, Toothless 457 s, Ant-Man 498 s, Godzilla 527 s.
  - Thanos came by the normal rule (every other foe down), not the 9-minute fallback, at 634 s. He was down at 708 s.
  - An earlier run under the old uncapped scale had stalled the middle of the fight and won at 933 s.
- **Every new move was seen to fire in a fight.** The Joker and Red Skull were beaten in those tests.
- **Every one of the 12 entrances was snapshotted frame by frame.** Skipping one ends it cleanly. Mister Fantastic's arm was also checked stretched to 3.5×: a long arm with a normal-sized hand.
- **Venom on your side (`?venom=ally`):** built into the squad and fought Hela.
- **The other stages** (Red Dune, Sandstorm, Office) load and play with no console errors.
- **Frame rate with everyone on the field** (19 heroes, 10 foes, 22 soldiers, the air war): 18.1 ms, about **55 fps** (step 8.0 ms, render 10.2 ms). Each new character costs about 0.5 ms. Before this round, 12 heroes and 7 foes ran at 66–69 fps.

### Not done / limits
- Not 60 fps with all 29 at once (55).
- No transformations for Ironhide or Megatron (the files don't have them).
- No destructible buildings for Godzilla.
- No cover-seeking for Red Skull.
- No riding Toothless.
- Balance with 19 heroes is still easy on the foes' side.
- Loading the stage now takes about 14 s here; the 12 models add about 50 MB.

### Play-test round (October 21): a clearer screen
- **Superman's jet takedown** (the filmed one) plays twice a fight at most. After that he still goes after jets, but off camera, without interrupting play.
- **Godzilla's atomic breath:**
  - He can now use it at any range (0–70 m, every 14 s). Before, it needed 10 m+, so with heroes round his feet it rarely came.
  - The beam is wider, glows along its length, and blasts where it lands.
  - His first two breaths are filmed: close on his plates lighting up, then wide down the beam (`RosterHero.film`, a short director shot for a moment in the fight).
- **Heroes' health isn't shown.** They still have it and can still be knocked out; only the bars are hidden.
- **The foes' bars** are a narrow column (210 px) in the top-right corner, with small type and thin bars. They used to be a wide stack across the top middle.

### Everyone in at once (October 21)
- On the Heroes Playground, anyone can press **J** to bring every hero still to come onto the field at once, or **O** to bring every villain at once. The villains include Wolverine, Batman and Thanos. Developer mode isn't needed.
- Their entrances are skipped, apart from the Hulk's landing and Wolverine's and Batman's, which have no skip.
- Both keys are rebindable under Controls ("Heroes Playground: every hero / villain in now").
- **Tested:** J brought in 19 heroes and O brought in 13 villains, through the real key input.

## Stage order and the Sandstorm tape (October 21)
- **Stage order:** Red Dune → Sandstorm → Frostline → Heroes Playground. The playground is always last (`STAGES` in `config/stages.ts`; the menu, the dots and NEXT STAGE all follow that list). The stage ids are unchanged, so saved progress and `?quick=` still work.
- **Sandstorm ending extended (a cinematic, no keys):** once the cuffs are off, every soldier still about is taken out of the scene. Before this, the "lane" pair woke at the west gate and kept walking their patrol into the ending, which showed as a soldier frozen mid-stride in the yard. Ambassador Cole gets up, then turns to face the camera (your eye line) and looks at it. He tells you they took him for a Betamax tape from the back room of the talks: evidence and a national secret. He takes it out of his coat lining and holds it out with "Take it. Keep it safe — get it to your commander." The tape comes into your hands, and the moment it does it's MISSION COMPLETE ("HOSTAGE RESCUED · TAPE SECURED"). The shots are: stand-up, your eyes, a low side angle on the tape, your eyes, then the hand-over. The lines are in `SANDSTORM.tape` (`level/Dust2.ts`), the shots in `Mission.freed`, and shot timing cues in `Shot.cue`.
- **Asset:** "Sony Betamax Video Tape" by Tomek Suchodolski (https://sketchfab.com/3d-models/sony-betamax-video-tape-046133af17fd49fa8ec410f8a7caa43a), **CC BY 4.0**. It is prepared by `scripts/assets/prep-props.mjs` (8th argument): 6.7 MB down to 3.5 MB, 1024² WebP textures, tangents dropped, real size 15.6 × 9.6 × 2.6 cm. Output: `src/assets/props/betamax.glb`.
- **Tested in the browser:** checked each shot frame by frame with the render loop stopped. The mission ended as won straight after the tape reached the camera. Restart brought the soldiers back, with him seated and cuffed and the tape hidden.

## Frostline mission: play the tape (October 21)
- **Story:** after Sandstorm, the Ambassador's tape turns out to be Betamax. The only working deck is in the cell's old offices on Frostline, wired to a Commodore monitor. COMMAND sets it up in two lines at the start.
- **Objectives:**
  1. **CLEAR THE OFFICES · N LEFT.** The tape won't play with the cell still inside. The deck shows on the HUD, radar and map from the start, and the last one or two soldiers are marked.
  2. **PLAY THE TAPE ON THE BETAMAX DECK.** At the desk, the prompt is `F INSERT THE TAPE`: one press of the use key, so rebinding still works. It only shows within reach, on the deck's side, with line of sight. While soldiers are left it reads `CLEAR THE OFFICES FIRST · N LEFT`.
- **The cinematic (no more input):** your eye line as the tape comes out of your kit and into the slot (the door flaps in) → a low side shot as the door shuts and the display reads LOAD → up to the monitor as it comes on (a flash, then snow) → the picture, nearly filling the frame, for as long as the tape runs → MISSION COMPLETE ("THE TAPE IS PLAYED"). Anyone still about is taken out of the scene first; a restart brings them back.
- **The station** (`level/PlaybackStation.ts`): a desk of its own in the middle of the office west of the corridor, at `OFFICE_STATION` in `level/Office.ts` (−39.2, −4, −8.4), facing the room's door. The room's desks were all cluttered. The desk has a back panel, blocks movement (player and soldiers), and its nav links are cut (`NavGraph.cutLinks`, now shared with Sandstorm's barricades). A small lamp and the screen's glow light only the set, since the office's own light is baked in.
- **On the desk:** "Commodore 64 || Computer (Full Pack)" by dark_igorek (https://sketchfab.com/3d-models/commodore-64-computer-full-pack-1f43612fa2d54041bbe2bdff8164c2cd), **CC BY 4.0**: the C64, 1541 drive, joystick and 1702 monitor. The cables, connectors, monitor plug and power brick were removed by `scripts/assets/prep-props.mjs` (9th argument), so nothing lies loose. Textures are 1024² WebP, the set is real size (C64 40.4 cm wide), output `src/assets/props/c64.glb` (7 MB, loaded only on Frostline).
- **Why a Betamax deck:** a Betamax cassette can't go into a C64, which takes floppies through the 1541 and audio cassettes through a Datasette. So the 1702 monitor stands on a Sony-style Betamax deck, built in code, and shows the deck's picture through its composite input. Send a Betamax VCR model and it can replace the built one.
- **The video:** `video4.mp4` (1280×720, 10 s) is installed as `src/assets/video/tape.mp4`. To change it, replace `src/assets/video/tape.mp4` (or `.webm`). It's picked up by `import.meta.glob` at build time, with no code change. It plays on the monitor with its sound and follows the game's mute and volume. It pauses with the game and rewinds on restart, and the mission completes when it ends. Without a file a 7-second stand-in plays: the deck's PLAY readout and counter over tracking noise.
- **Tested in the browser:**
  - Prompt blocked, then open after clearing.
  - Desk collision.
  - Every shot checked frame by frame.
  - The stand-in, leading to MISSION COMPLETE.
  - A real test clip: right way up after one fix, pausing and resuming with the game, ending the mission when it ends. Deleted afterwards.
  - Restart: soldiers back, deck reset, video rewound.
- **Gotchas:**
  - Babylon's video upload is a side-effect import (`@babylonjs/core/Engines/Extensions/engine.videoTexture`). Without it a VideoTexture never gets a frame.
  - A material only pulls a video's frames while it's drawn, and it isn't drawn until it has one, so the station pushes frames itself (`updateTexture(true)`).
  - With `autoPlay: false` Babylon plays and pauses the clip itself on `canplay`, so the station passes its own `<video>` as an independent source.
  - In this left-handed scene, a model's local +x is on your *left* as you face its front.

### Frostline: the deck any time (October 21, later)
- The deck works whenever you reach it: there's no need to clear the building first. The objective starts as **PLAY THE TAPE ON THE BETAMAX DECK**, with the deck marked.
- While the tape plays, the soldiers stand completely still, not just blind (Game sets `aiMode` FROZEN via `TapeMission.holdStill`). That way nobody wanders into the shot, and they carry on afterwards.
- After the tape, you're back in control. The deck reads STOP and the monitor goes dark. The screen shows **KILL ALL REMAINING HOSTILES · N LEFT IN THE BUILDING** and COMMAND gives the order. The objective counts down, and the last one or two soldiers are marked.
- The last kill gives MISSION COMPLETE ("TAPE PLAYED · BUILDING CLEAR"). If the building was already clear when you played the tape, it completes as soon as the tape ends.
- **Tested in the browser:**
  - Tape played with all 16 alive: nobody moved during the cinematic, and they moved again afterwards.
  - Objective and straggler marker with 2 left, then a win on the last kill.
  - Everyone killed first, then the tape: a win as soon as it ended.

### Loading video (October 21)
- The supplied clip (`public/video/loading.mp4`: 20 s, 1280×720, H.264) plays muted behind the title screen while the engine downloads, and behind the mission loading screen while a stage loads.
- It starts from the beginning each time, loops if loading runs longer than 20 s, and stops and fades out the moment loading is done.
- It's dimmed so the titles, the bar and the tips read over it.

## Stage 5 (October 21): WINTERPORT — the city, and the Winter Soldier (REMOVED October 22 — replaced by the Underground, below)
A story mission like Sandstorm, following Frostline: the tape named the man behind the convoy ambush.

**The map.** "City" by golukumar (Sketchfab Standard licence) is the whole skyline, a port city about 340 × 550 m.
- `scripts/assets/prep-city.mjs city` turns its 2,455 meshes into one per material (103) and its textures into WebP (17 MB).
- The fight takes up three blocks of it, about 120 × 145 m: the south road, the rail yard between the blocks, and the north road.
- Collision and navigation come from `voxel-map.mjs --u=23 --mode=all --crop=-182,-218,-58,-82 --edges=1`. It writes 9,600 m² of floor, 1,411 nav nodes and 34 doorways.
- `--crop` and `--edges` are new options:
  - `--crop` keeps only the triangles over the play area.
  - `--edges` puts an invisible wall wherever the walkable ground stops, so there's no walking off into the harbour or out of the play area.
- Lighting is a cold winter dusk (`level/City.ts`).

**The mission** (`core/CityMission.ts`):
1. **Opening cinematic:** over the harbour, low along the north road to his post, then down into your eyes, with COMMAND on the radio.
2. **Clear the south road.** Its 5 soldiers are up from the start; the last two get a marker.
3. **Push through the rail yard.** Its 7 soldiers wake as you reach its mouth.
4. **Find the Winter Soldier.** Out onto the north road (3 more), with his guard of 3 at the east end.
5. **The boss.** Within 34 m of his post there's a short reveal. The cameras search round him for a clear line to his face, because his post is tucked among sheds.
   - He then fights like his men (the soldier AI, his rifle) as the stage's **boss**, with a health bar of his own (THE WINTER SOLDIER · calm / pressed / enraged).
   - He has boss armour: body shots count for less and no single hit takes more than a slice. He speaks as he crosses each phase.
6. **He goes down:** slow motion, a last look at him, the camera up and away, then **MISSION COMPLETE · OPERATION WINTERPORT // THE WINTER SOLDIER IS DOWN**.

**The soldiers.** Only this stage uses the new models. Movements and actions are the same mocap and AI as every other stage's soldiers.
- **Polish soldier** ("Polish soldier" by buh, CC BY 4.0): a Blender rig with numbered bones, mapped by its hierarchy. It ends at the ankles, so a toe joint is made on each foot. His own rifle and magazines are hidden.
- **Soldier girl** ("Soldier Girl" by rafa durand, **CC BY-NC 4.0, non-commercial**): her file has no skeleton, so one is made at load (`autoSkin`, body meshes only) with finger markers for the grip. Her rifle, pistol and torch are hidden.
  - She came at 407k triangles; she's simplified to 64k.
- **Winter Soldier** ("Winter Soldier (FREE)(Textured)(Rigged)" by CAPTAAINR, CC BY 4.0): a 3ds Max Biped. His own guns are skinned to three prop bones, which are squashed to nothing.
- The two soldier types alternate across the stage; the boss is always the Winter Soldier.
- **Retargeting** (`enemies/SoldierRetarget.ts`): the FSB operator's 35 mocap clips are turned into each rig's own bone rotations when the stage loads.
  - Limbs and spine follow the FSB bones' directions, with their twist carried over; the hips and head follow its rotation.
  - Everything is measured under each file's own root: the loader's root mirrors Z, and rotations taken from mirrored matrices come out conjugated, which had turned the Winter Soldier upside down.
  - Loading and retargeting all three takes about 2.7 s here.

**Also this round:** the objective line ("KILL ALL REMAINING HOSTILES · N LEFT" and the rest) is smaller (10 px).

**Tested (in the browser, by script):**
- The stage loads in about 8 s here.
- The opening cinematic plays.
- Each stage of the mission triggers as you reach it: the objective text changes and its groups wake (5 → 12 → 18 awake).
- The reveal frames him with the rifle.
- His boss bar shows and goes down as he's hit.
- Killing him plays the ending and the result reads MISSION COMPLETE.
- The Polish soldier and the soldier girl were checked by screenshot standing, walking and holding the rifle.
- About 5.9 ms a frame with 12 awake (headless timing on this machine).

**Not done / limits:**
- No checkpoints: dying restarts the operation.
- Not played through by hand.
- The city's materials are plain lit textures (no baked light); a few far buildings show seams.

## Soldiers, the Winter Soldier and the soldier girl: play-test fixes (October 21)
- **No more running away** (all stages; measured in the browser with the player standing in the open):
  - While a soldier can see you, moving along a path is capped at a tactical jog (`TACTICS.combatMoveSpeed` 2.1 m/s) with his chest and rifle on you. If the way leads away from you, it's a 1.2 m/s backstep, still facing you. Full runs and sprints, where the body turns to the travel direction, happen only out of sight.
  - The 3.5 m "minimum range" retreat is gone. Only right on top of you (under 2.2 m) is there a backstep, and inside rifle-butt reach they strike.
  - The rifleman (and the boss) push in past 8 m (`assaultPushRange`).
  - Lost sight of you: after 1 s the rifleman and the boss come after you (`huntAfter`), still in the fight, instead of standing 3 s and then wandering off to search.
  - Cover, peeking over or round it, and flanking are unchanged.
  - Before: the nearest soldier spent 3.5 s of 14 s in a fight moving away from you, 4.3 s with his back turned. After: what's left is a short facing backstep at 2–3.7 m.
- **The Winter Soldier:**
  - Closes from 22 m to arm's length, hunts you round cover, and fires his rifle.
  - Draws the **pistol** at close range (7 m, 10 m pressed, 13 m enraged) and when the rifle runs dry. Goes back to the rifle once you're 15 m off.
  - At least 3 s on a weapon before he swaps again. An empty pistol no longer flips holster/draw in the same instant.
  - The pistol was invisible: it was a copy of the ground pickup, which lies rolled on its side, so it showed edge-on in his hand. It's upright now.
  - His fingers (3ds Max Biped, modelled straight) are curled round the grip at load (`RigMap.curl`).
- **Ragdolls and walls:** the level's physics here is thin triangle surfaces, so a body shot against a wall could fold into it. Now a hit that would drive the body into a wall right behind it is mostly cancelled, so he crumples where he stands. Any limb that still ends up inside solid geometry (checked against the nav's voxel boxes) is pulled back out toward the pelvis (`EnemyRagdoll.embedded`, `outOfWalls`).
- **The soldier girl's body:** her file has no skeleton and her arms hang close to her sides, so the generated one weighted the vest and pouches to the arms, and they tore when she raised her rifle. `characters/autoSkin` now:
  - measures to each bone's surface rather than its centre line (the torso is far thicker than the arm beside it);
  - moves each small loose piece (pouch, magazine, plate) rigidly with the bone at its middle;
  - includes her chest plate, which was left out of the skin entirely and floated in place.
- **Tested in the browser (Winterport):** the boss fight from the reveal (approach, hunt, pistol, swaps); close-ups of the boss holding the rifle and the pistol; his death and ragdoll; the girl running and firing; a body shot into a wall; then 20 s of fighting on Red Dune as a regression check (8 engaged and firing, no errors).

### Menu: no more "wind" (October 22)
- In-game ambience was already silent in every menu (pause, results, title). The wind heard over the title and stage select was the procedural **menu theme** itself: it ended each loop with a ~7 s filtered-noise swell, and its timpani hits had a noise burst. Both are gone. The swell is now the chord rising in the strings, the timpani is a tuned drum, and the pad and arpeggio are a little louder. Measured offline, the whole loop is tonal (spectral flatness ≤ 0.0005 throughout).
- To use your own menu track instead, drop `public/music/menu.mp3` in (see `public/music/README.md`).


## October 22: pause audio, the soldier bugs, and the Underground replaces Winterport

### Menus are silent (game-wise)
Every screen that isn't the fight (pause, mission complete or failed, loading) mutes the whole game bus: wind, score, effects. The menu music plays on the result screens too, not only in pause. Before this, the results kept the stage's score at 30%. Measured: game bus gain 1 while playing, 0 paused, 0.007 on the result screen, back to 1 on resume and restart.

### Soldier bugs, measured and fixed
How shooters handle each of these, and what was done here:
- **Floating magazines** (screenshot: two magazines hanging in the air over a corpse). Games socket every attachment to a bone. The Polish soldier's two spare magazines (`WZ96 Beryl mag 2/3`, instances of one mesh) were on no bone at all, so they rode the soldier's root: off his chest while he moved, at chest height after he fell. Any prop left on no bone is now parented, at load, to the nearest body bone (hips, spine, thighs) where it stands. Measured: the magazine's distance from the chest is a constant 0.328 m while walking and through the whole ragdoll fall (it was 0.27–0.37 m and drifting).
- **Shivering while walking or running.** Games interpolate animation LOD, or throttle only characters that are off screen. Two throttles were stacked here: soldiers past 15 m moved at 30 Hz, and their pose was updated every 2nd, 3rd or 4th frame. Now anyone you can see is updated and posed every frame up to 90 m (40 m on the Playground, which shares the frame with the whole cast: 55–62 fps with everyone summoned); only off-screen soldiers or specks beyond 90 m are throttled. The head's frame-to-frame acceleration for a walking soldier at 45 m went from 0.012 to 0.0017, a natural head bob. Frame time is unchanged (7 ms with 18 awake).
- **Shaking upper body and rifle in a fight** (all soldiers, worst on the Polish soldier). Games compute aim offsets on the upper body from a stable base pose. Here the rifle's orientation came from the right hand's twist, and two faults made it jump:
  - The grip remembered from the previous frame was fed back in every frame, an unstable loop: the rifle's forward axis cycled through ~40° every 5 frames with fixed inputs.
  - The Polish rig's index and pinky knuckles sit on the same point, so its hand had no "across" axis at all.
  
  Now, with both hands on the rifle, the roll comes from the calibrated grip (the remembered grip is kept only for when the left hand lets go). A rig with no usable knuckle axis falls back to the hand's forward direction. The aim solve is now deterministic, identical output for identical input. Head acceleration in combat went from 0.057–0.09 to 0.001–0.002.

### The Underground (stage id `metro`, after Frostline; the Playground stays last)
- **Map:** "Roscoe Street - Underground" by Neo_minigan (CC BY 4.0).
  - `scripts/assets/prep-metro.mjs`: the Sketchfab root's 0.64° tilt removed (it put the floors 1.4 m out of level over the station's length), meshes merged per material, 156 textures → WebP ≤ 1024 px. 105 MB → 27.6 MB (`src/assets/maps/metro.glb`).
  - Voxelised with `voxel-map.mjs --u=0.01 --box=-130,-110,130,30 --outdoor=0 --edges=1` (indoor mode; "all floors" mode had picked the roof slab). The result is 2,570 m² over three levels: a mezzanine passage, the platform level and concourse, and a deep platform with a service corridor. There are 482 nav nodes (196 cover) from the voxeliser, and invisible walls along every drop, so the platforms can't be left for the tracks.
- **Nothing outside is visible.** A leak test casts 24–48 rays from every nav node at eye height. Every opening found is boarded: hoarding at all four tunnel mouths and the deep corridor's dead end, four doors from the top corridor onto the station's roofs (which open onto bare roof slabs and blackness), the two ticket-office windows onto an unbuilt room, the control room's back door, and two staff doors. The boarding (`level/Hoarding.ts`) is plywood sheets with posts, rails, hazard tape and DANGER / TUNNEL CLOSED notices, set just inside each opening so the walls hide its edges, with concrete barriers and crates at the foot of the big ones. Rays that see nothing at all went from 236 to 2 of 27,792, both grazing a wall-to-ceiling seam. Picking gotcha: Babylon's `pickWithRay(..., fastCheck = true)` returns the first hit found, not the nearest.
- **Mission** (`core/MetroMission.ts`):
  1. **Intro:** down the platforms (his men on them), the deep corridor with the Winter Soldier at his post, then into your eyes at the south end of the mezzanine passage.
  2. **Platforms:** clear the platform level (6, awake).
  3. **Concourse:** reaching it wakes 5 more.
  4. **Deep level:** going down wakes 4 on the deep platform and 3 guards in the service corridor.
  5. **Boss:** within 26 m of his post, the reveal; he fights like his men, with his own health bar.
  6. **Ending:** he goes down, a slow-motion ending (no camera into the sky underground), MISSION COMPLETE.
  
  Tested end to end in the browser (god mode, scripted moves). With all 19 awake: 9.2 ms a frame median.
- **Removed:** Winterport (`level/City.ts`, `core/CityMission.ts`, `city.glb`, `city-data.json`, its thumbnail). The Polish soldier, soldier girl and Winter Soldier skins stay (the Underground uses them). `prep-city.mjs` is now `prep-soldiers.mjs` (its city step is gone).
- The menu card thumbnail is rendered in game (`thumbs/metro.webp`).

### Getting around the Underground (navigation fixes)
A walk bot drives the player controller along the nav graph from the start through every zone: concourse, both ends of it, the top corridor, the deep platform's two ends, and the boss corridor. It now reaches all of them. Fixes on the way, all done at load in `level/Metro.ts`:
- `bridgeIslands`: the voxeliser left the graph in 7 pieces; nearest nodes of separate pieces are linked where the line between them is clear and has floor under it.
- `centreNodes`: nodes on a narrow doorway's jamb are eased up to 0.3 m off the wall (the nearer the wall, the harder the push).
- `centreLinks`: a link that grazes a jamb part-way along it gets a node in the doorway's middle (579 nodes after this).
- `openDoorways`: invisible clip walls that pinched doorways are cut back where a link passes.
- `edgeGuards`: invisible walls along every drop the voxeliser left open (the deep platform's edge). `voxel-map.mjs --edges` also tested the wrong condition for a drop; fixed.
- No generated doors: a station's openings stand open, and a door swung open lay across the deep platform's only walkway.

### The Winter Soldier and the falling guns
- **Behaviour, measured** (20 s against a standing target, from 7 m):
  - He presses in, draws the pistol at about 4 m, and works his corridor between 3 and 8 m, moving 98–100% of the time. He fired 44–47 rounds, with the pistol out 50–70% of the time.
  - Before the fix he stood still for 9 s in every 10. The corridor is too narrow to strafe, and the fallback for "both sides blocked" was to hold.
  - Now with no room either side he works along the corridor: the boss and the rifleman push in to pistol range, anyone too close steps back, the rest step in or out. The chosen way is kept until the strafe timer runs out (it flipped every few frames at the range line), and never straight back into what just stopped him.
- **Body pops, found by logging every frame where the hips or head jump.** The fixes apply to every soldier:
  - **Cover shuffle ending mid-stride:** the crouched-gait flag dropped in one frame while he still moved at 0.9 m/s, a 13–23 cm pop. Crouched and upright gaits now cross-fade over 0.25 s.
  - **Stairs:** the collider climbs voxel steps 0.25–0.36 m at a time, one a frame at a run. The drawn body now eases over each step (collision unchanged), as shooters smooth a root over steps.
  - **Walking into a wall:** the velocity is cut to 30% in a frame, and the legs followed it. The gait's velocity is now limited to his own deceleration, 12 m/s², so normal movement is unaffected.
  - **Turning to walk the other way:** the leg direction is eased (up to 5 rad/s while really moving, at once when nearly stopped) instead of jumping from ahead to behind as the velocity passes zero.
  - **Head look target:** the head switched from his heading to the target at an aim weight of 0.05. It now blends by aim weight. The spine's aim also eases down when a reload starts, instead of dropping to a quarter in one frame.
  - **Result, the boss in his corridor:** hips max 0.45 → 0.10 m/frame², head median 0.006 → 0.0014, p95 0.076 → 0.037. Regular soldiers in a fight: 12 visible pops over 0.12 in 11 s → 0. Two head twitches over 0.25 in 30 s remain on the boss, as he turns onto you and his aim weight climbs fast; not yet fixed.
- **Pistol hanging off his hand.** It was placed in world space while the rifle rides the soldier's root, and it was converted with the previous frame's root. It drifted up to 0.2 m from the palm as he moved and turned. It now rides the root like the rifle, with this frame's transform: a constant 0.087 m from the palm, posed or throttled. Its muzzle is read from the gun itself.
- **Pistol frozen in mid-air when he died with it out.** The ragdoll threw the hidden rifle and left the visible pistol where it was. Now the gun in his hands is the one that falls (`RagdollGun`: a mesh's box for the rifle, a box of its own for the pistol), and it sinks and hides with the body.
- **Dropped guns skidding 10 m down a corridor** (every soldier). The gun got 60% of the killing bullet's push as velocity: 12 m/s, or 28 m/s from a melee kill. Shooters let the weapon fall from the hand at about the body's speed, so it now gets the chest's kick, capped at 3 m/s, plus the body's own throw on a superhuman blow. Measured: rifles land 0.75–2 m from the body, the pistol 0.44 m, and a launched soldier's rifle 0.9 m from where he lands.
- **Guns and bodies falling out of the world off the platforms.** Off the platforms the voxels have no floor: the track beds were never voxelised. The track mesh is now a physics-only shape (`LevelData.physicsOnly`, baked to world space), so a body or gun that goes over the edge lands on the track. Player movement doesn't test it, because the edge guards keep players out.

### Still needs your input
The girl soldier is still auto-rigged, and every soldier's movement is procedural: IK plus the baked clips already in the game. Mixamo clips would give the Winter Soldier real motion capture. Mixamo needs your own Adobe login, so the files have to come from you:
- **Where:** `scripts/assets/mixamo/` (not shipped with the game).
- **Settings:** FBX, **Without Skin**, 30 fps, and **In Place** ticked for anything that walks or runs.
- **Clips:** rifle idle, rifle walk forward/back/left/right, rifle run, pistol idle, pistol walk, rifle-to-pistol swap (or "draw pistol"), hit reactions (front, back), deaths (front, back), a rifle-butt strike.

Each one bakes with `node scripts/assets/fbx-anim.mjs <file.fbx> <out.json>`. Making the soldiers play those baked clips is the next piece of work.

### No wind anywhere but Red Dune (October 22, again)
- **The menu's "wind" was the menu theme's pad.** Last time the noise layers were removed, but the background pad was still nine detuned sawtooth voices through a low-pass filter sweeping open and shut every two bars. That beating, breathing whoosh sounds like wind with no noise in it. The pad is now pure tones (a sine and two soft overtones per chord note, two voices 0.1% apart, no filter sweep). Rendered and measured: 0.4% of its energy is above 3 kHz.
- **Wind ambience is Red Dune's alone** (surf and wind). Sandstorm and the Heroes Playground had wind as their whole ambience; they're now `ambience: "none"`, like Frostline and the Underground.
- The game's own sound can't reach the main menu: going to the main menu reloads the page, and pause, results and loading mute the whole game bus. Your own menu track can go in `public/music/menu.mp3`, which replaces the composed theme.

### The Underground's briefing, and smaller mission text (October 22)
- **The story is told at the start:** the Ambassador's tape names the leak. The Winter Soldier sold the nuclear secrets, and your orders are to kill him (no arrest, no deal). The intro's three radio lines say it, then an order slip: `// OPERATION UNDERGROUND`, "Target: the Winter Soldier · nuclear secrets leak / Orders: find him and kill him". The stage card and the objective now read "KILL THE WINTER SOLDIER".
- **Mission text is small and military everywhere:** chapter cards are a framed mono order slip (14 px title, 11 px lines) instead of a 42–92 px headline, and radio lines are a 13 px mono comms readout on a dark strip.

### Three toggle keys: god mode, quick knife, all weapons (October 22)
All rebindable in CONTROLS, and none needs developer mode:
- **H: god mode on / off.** G is only the grenade now. Turning it on also refills your health. A small `GOD MODE` tag sits under the objective while it's on.
- **K: quick knife**, any time and mid-reload too. The gun goes down, one slash, and it comes back (about 1 s); an interrupted reload carries on. V is still the rifle-butt / pistol-whip strike.
- **L: all weapons on / off.** Every weapon is carried with full magazines and reserves, launchers and the grenade belt included. Press a slot key again to step through that slot's guns: 1 carbine → AK → M5, 5 M72 → DZJ-08. Pickups only add ammo while it's on. Off gives back exactly the kit and ammo you had. An `ALL WEAPONS` tag shows while it's on.
- Developer mode moved out of the way: kill all is Shift+K, respawn is Shift+L, and the old G (god) and H (heal) dev keys are gone.

### Developer mode: off by default, and off means off (October 22)
- **Off on every fresh launch.** It's kept only between the stages of the same session (each stage reloads the page). It's switched on in SETTINGS or CONTROLS, or with the ` key in play.
- **Switching it off resets every developer option:** god mode, all weapons (your own kit and ammo come back), the ammo cheat, enemy AI and time scale. Before this, god mode switched on with H survived developer mode being turned off.
- **God mode (H) and all weapons (L) are developer options.** The keys do nothing while developer mode is off (a line says how to turn it on). They have ON / OFF switches in a DEVELOPER box at the top of CONTROLS: Developer mode, God mode, All weapons. The last two are greyed out while developer mode is off, and they follow the keys. Developer options now all start OFF (god mode and the ammo cheat used to default on).
- The quick knife (K) is a normal gameplay key and works for everyone.

### Difficulty: EASY / MEDIUM / HARD (October 22)
- **Where:** a DIFFICULTY dropdown at the right end of the stage screen's LAUNCH MISSION / BACK row (what the level does shows on hover). It was a segmented switch above LAUNCH, but that added a line and pushed the buttons off the screen. The same setting is in SETTINGS, so it can be changed mid-mission from the pause menu, where it applies at once (soldiers already up keep their share of health at the new scale). It's remembered between launches, and shown on the loading screen and the result stats. Default MEDIUM, which is the game as tuned.
- **What it scales** (`src/config/difficulty.ts`, one table):

  | | enemy health | your damage taken | enemy hit chance | reaction before firing | your regen |
  |---|---|---|---|---|---|
  | EASY | ×0.55 | ×0.5 | ×0.65 | ×1.6 slower | ×1.6 sooner and faster |
  | MEDIUM | ×1 | ×1 | ×1 | ×1 | ×1 |
  | HARD | ×1.25 | ×1.5 | ×1.3 (max 95%) | ×0.7 quicker | ×0.65 |

  Enemy health covers the soldiers and the Winter Soldier. Damage taken covers every source (bullets, strikes, blasts, fire).
- **Measured** (carbine, Red Dune): a soldier takes 3 / 4 / 5 body shots or 1 / 2 / 2 headshots. Standing in the open against 6–8 attacking soldiers: EASY lost 29–42 health in 15 s and lived; MEDIUM died at 11–12 s; HARD died at about 7 s.
- Not scaled: the hero villains on the Playground (their own balance is the hero fight's).

### Knife lunge, the Underground's barrier gates, the stage carousel (October 22)
- **Knife on the Winter Soldier did nothing:** the knife reaches 2 m, and he keeps 3.5–4.5 m away, so the swing (mid-reload or not) hit thin air. The knife now **lunges**, as in other shooters: swing at a soldier up to 3.6 m off, within 22° of where you're looking and with no wall between, and you're carried in to arm's length as the blade lands. This works for every soldier and every swing (K, fire with the knife out, the heavy stab). Measured on him, mid-reload: hits at 1.4 / 2.2 / 3.0 / 3.5 m (lunging 0.15–2.25 m); misses at 4.5 m or aimed 46° off.
- **Gates that looked open but weren't:**
  - The mezzanine's ticket gates by the start lead to a 1 m dead end, and past it the station isn't built. They're now boarded just behind (NO EXIT · Station closed): the open gates are still seen, and the way is plainly shut.
  - The concourse ticket barriers: all three lanes are 0.9 m between the cabinets, but the voxeliser's half-metre invisible clip cells round each cabinet left two of them 0.5 m wide (the player is 0.68). That clip is cleared there (`CLIP_CLEAR` in `level/Metro.ts`); the cabinets keep their collision. Walked through all three lanes.
- **Stage carousel cut the end cards:** it centred the chosen card, so the cards at the edges were part-hidden, and each card's 1 px border made it 2 px wider than laid out. It now shows only whole cards (as many as fit, sized to fill the window exactly, border included) and slides a whole card at a time. Checked with each of the five stages selected: no card cut.

### Open edges you can jump from (October 22)
An edge in the top corridor over a stairwell had nothing drawn on it, yet you couldn't step off. Two invisible walls stood there: the voxeliser's edge clip (`--edges`) and the edge guards added later. Both were meant to keep you off the track beds and out of the void, but they also covered drops onto perfectly good floor. Now both (`openDrops` and `edgeGuards` in `level/Metro.ts`) stay only where the drop lands on the tracks or on nothing. Where it lands on floor that's part of the level (a nav node at that height within 3.2 m), the edge is open, and it's a jump you may take. Measured: off that edge, 4.4 m down to the stair hall (−13 health), walking on. All eight platform and deep-level edges over the tracks still stop you, as before.
