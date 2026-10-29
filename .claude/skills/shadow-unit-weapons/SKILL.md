---
name: shadow-unit-weapons
description: Player weapons in the Shadow Unit FPS — adding or changing a gun, reload clips and events, recoil/spread tuning, the first-person viewmodel (bob, sway, ADS, sprint, melee butt-strike), the grenade belt and throws (grenades, throwing knives), the knife, pickups/weapon crates and loadout slots. Use it for "add a gun", "make it reload/fire/inspect", "put the gun in a box to pick up", "throw a knife/grenade", "the gun looks wrong on screen", or any change in config/weapons.ts, WeaponManager or a rig.
---

# Weapons

## Pieces and where they live

- `config/weapons.ts`: `WeaponId` union, `WEAPONS` (all stats), reload phases (`clipPhase(...)` with events at clip seconds: `sound`, `transferMag`), `WEAPON_ORDER` (rig index; **append** new ids so existing indices and slots don't move), `slotOf` (loadout slot), `GRENADE_TYPES` and `GRENADE_ORDER` (the belt), `THROWING_KNIFE`.
- `weapons/Weapon.ts`: state machine (holstered → equipping → ready ⇄ reloading → holstering; throw phases idle → pin → cooked → throw; `noPin` and `throwRate` for knives).
- `weapons/WeaponManager.ts`: `carried` slots, `reset()` = **starting kit** (M4 `rifle`, `glock`, `knife`, grenades; don't change it unless asked), switching, ADS, sprint, `fire()` (hitscan), melee (`MELEE`, the butt-strike for any gun), quick knife, quick throws (`quickThrow`, `startKnifeThrow`), `throwGrenade` (the knife branch flies flat and fast).
- `weapons/Viewmodel.ts`: everything procedural on top of a rig: hip ⇄ ADS (from `rig.sight` or `adsPose`), sprint pose, reload pose, `meleePose`, procedural drop-in equip (unless `authoredEquip`), gait bob, breathing, mouse sway, strafe lean, landing, recoil springs.
- Rigs implement `WeaponRig` (`WeaponModels.ts`): `animate(RigState)` samples clips; `muzzle`, `eject`, `sight` nodes; `hasArms` for rigs with their own arms. See `CarbineRig` (one timeline, cross-fade between actions, procedural bolt) and `GrenadeRig` (procedural IK arms, the held object per belt type in `holders`).

## Adding a gun, end to end

1. Model → rig (see `shadow-unit-assets`).
2. `WeaponId` + `WEAPONS.<id>` (copy the closest gun's numbers, then tune) + **append** to `WEAPON_ORDER` + `slotOf` if not primary.
3. Load and build the rig in `Game.loadWeaponRigs` (add to the `Promise.all` and to the `parts` progress count).
4. `ui/icons.ts` `WEAPON_ICONS`, `level/Pickups.ts` `LENGTH` (world-model length, which enables pickup models).
5. **Availability**: as a pickup, add a cache `[{ kind: "weapon", id }, { kind: "ammo" }]` to `Pickups.populate`'s list. Players take it with the use key, and it swaps for the gun in the same slot. Only make it the starting weapon if the user asks.
6. Give the new gun a name the swap prompt can tell apart ("SWAP M4 CARBINE FOR CARBINE" was confusing, so it became "TACTICAL CARBINE").

## Throwables

- A new throwable is a `GrenadeType` + `GRENADE_TYPES` entry (`count` = how many you carry and get from crates) + `GRENADE_ORDER`, a held mesh in `GrenadeRig.holders` and a projectile template (`projectiles.<type>`). Check every `as Record<GrenadeType` cast, because tsc won't flag those.
- Grenades go through `fx/Grenades.ts` (`onDetonate` → `Game.onDetonate`). Knives go through `fx/ThrowingKnives.ts`, chosen in `onThrow` by type.
- Quick-throw flags must always clear. A quick throw whose weapon switch never happened left `knifeThrow` set and blocked the key forever; the guard is at the top of `WeaponManager.update`'s weapon section.

## Feel checklist

Recoil `pitch`/`yaw`/`kickBack`, spread `hip`/`ads`/`perShot`, `adsTime`, `equipTime`, reload `speed` (clip seconds ÷ speed ÷ `RELOAD_SPEED`), sounds by name from `SoundBank` (`m4MagOut`, `m4MagIn`, `m4Bolt`, `knifeSlash`, `knifeStab`, `knifeWall`, …).

## Verify

Fire (mag count drops), reload both phases (tactical and empty), switch away and back, melee, ADS, sprint, the pickup swap prompt plus taking it, a frag grenade (pin seen, thrown, returns to the gun). Recipes are in `shadow-unit-verify`.
