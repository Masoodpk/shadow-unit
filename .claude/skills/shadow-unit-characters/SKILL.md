---
name: shadow-unit-characters
description: Soldier bodies in the Shadow Unit FPS — skinned characters, mocap retargeting, procedural layers (aim, IK hands, lean, crouch, flinch), the AI's moves, death falls and ragdoll, hitboxes vs drawn bones. Use it when a soldier looks wrong (twisted, hunched, floating gun, stretched mesh, wrong hand on the rifle), when adding a soldier or a new movement/animation, when something must attach to a body (a knife, a decal, an effect), or when the user asks what movements the soldiers have or are missing.
---

# Soldiers: animation, retargeting, ragdoll

## How a soldier is built

- **Two bodies.** `EnemyModel.buildSoldier` makes invisible **driver** nodes with box hitboxes (`parts.hitboxes`, metadata `HitKind.EnemyPart`, `zone`). `SoldierSkin` is the **drawn** skinned character. Alive, the drawn body plays mocap and the hitboxes follow its bones (`syncHitboxes`). Dead, the body goes to a driver fall and then Havok ragdoll (`EnemyRagdoll`), and the hitbox drivers stay behind. Anything that must stay **on the body** after death (a stuck knife, blood) is parented to a skin bone, via `SoldierSkin.nearestBone(point)`, never to a hitbox or driver node.
- **Mocap** was recorded on the FSB operator (`assets/anims/soldier_anims.json`; Mark has his own). Other rigs get it through `SoldierRetarget.retargetSoldierAnims`, once at load. It matches **segment directions**, with the twist measured against "forward" in each rig's rest pose. So a target rig whose rest pose isn't standing and facing forward (+Z, left hand on −X in the scene) comes out twisted. Fix the rest pose, not the retargeter.
- **Procedural layers** in `SoldierSkin.animate`: lean, aim (the spine turns the muzzle onto the target), hit flinch and recoil, flash-blind, head look, then the rifle placed in the right hand and two-bone IK for the left hand onto the handguard (`G` frame constants).
- **Clip selection**: `EnemyAnimationController` (a locomotion blend by speed and direction, standing ↔ aim ↔ kneel, upper-body reload layer, one-shot actions `ActionKey`).
- **AI** (`Enemy.ts`, its tunables in `EnemyConfig.ts`): states IDLE / PATROL / ALERT / SEARCH / ATTACK; the moves it triggers are `ctrl.play("roll"|"stepL"|"stepR"|"stop"|"whip"|"stab")`, `throwGrenade()`, `flinch()`, lean and peek, the pistol for the boss, reloads.

## What they can do, and what's missing

They have: low-ready idle; aim stance; walking in eight directions; run; sprint (forward and back); backpedal; strafe; crouched moves; kneel; reload; hit flinch; side-steps; a grenade-dodge roll; stop; rifle-butt and stab melee; grenade throw; lean/peek from cover; covering their eyes from flashbangs; the boss's sidearm; three death clips plus ragdoll; burning and freezing reactions.

Not yet (these need new clips; ask the user before adding): vault/climb, wounded/downed crawl or limp, per-limb hit reactions, staggering from blasts while alive, idle variety, turning on the spot with steps, prone, blind-fire, surrender, throwing a grenade back.

A new clip needs adding to `ClipKey`, `soldier_anims.json` (from FBX via `scripts/assets/fbx-anim.mjs`) and the controller. Retargeting picks it up for the other rigs automatically.

## Debugging a body: the line-up page

`/dev/soldierview.html?kinds=mark,fsb,swat` stands the characters side by side under one input:

```js
S.set({ speed: 1.6, vz: 1.6 })            // walk  (4.2 run)
S.set({ aim: 1, aimZ: 10 })               // shooting stance at a target 10 m ahead
S.set({ crouch: 1 })                       // kneel / crouch-aim
S.inp.reload = 0.4                         // reload pose at 40 %
S.run = false                              // freeze the frame for a screenshot
S.cam.alpha = 0 /* side */; S.cam.alpha = Math.PI / 2 /* front */
S.skins.restNodes("swat")                  // rest-pose nodes for measuring
```

Compare the new character against `fsb` (the mocap's own rig) in each pose; a difference is a rig problem.

## Lessons from this project (posed or rigless models)

- `autoSkin` (makes a Mixamo-named skeleton for a static mesh) assumes a T- or A-pose. For a posed figure the slice-centre spine is pulled toward the arms, the hands cross the body's midline (its "other side" rule binds them to the wrong arm), and a vest touching the arms gets bound to them. These were patched for the CS2 T and it still looked poor. **Prefer asking for a rigged model**; the Mixamo-rigged SWAT operator worked first time with no special handling.
- Check facing with numbers, not screenshots: rest positions of `LeftArm`/`RightArm`/`LeftToeBase` in the scene must have left at −X and toes at +Z, like `fsb`.
- Finger curl (`RigMap.curl`) only applies to rigs whose fingers are modelled straight.
