---
name: shadow-unit-safe-change
description: The regression-safe way to change the Shadow Unit browser FPS (Babylon.js + TypeScript + Vite) — use it for ANY edit to this game, whether a new feature, a new stage, soldier, gun, knife, UI change, optimisation, physics or animation tweak, or a bug fix. It maps what a change touches, keeps new behaviour opt-in so existing stages/missions/weapons keep working, and ends with the regression checklist. Use it even when the user only says "add X" or "fix Y" in this game, and especially when they say "don't break anything".
---

# Changing Shadow Unit without breaking it

The game is ~45k lines with many features tangled through a few hubs (`core/Game.ts`, `weapons/WeaponManager.ts`, `enemies/Enemy.ts`, `enemies/SoldierSkin.ts`). Most regressions in this project came from a change made for one stage or one character leaking into shared code. The rules below exist to stop that.

Load the topic skill as well when it applies: `shadow-unit-assets` (models), `shadow-unit-characters` (soldiers, animation, ragdoll), `shadow-unit-weapons`, `shadow-unit-world` (stages, missions, physics), `shadow-unit-ui`, `shadow-unit-perf`, `shadow-unit-verify` (testing). For finding code cheaply, use `shadow-unit-codemap`.

## 1. Before editing: map the impact (cheaply)

1. Find the hub the change enters through, with `grep -n` on names, never by reading whole hub files (Game.ts is 2.7k lines).
2. List every consumer of what you'll change: `grep -rn "<symbol>" src --include='*.ts'`. A union type (`WeaponId`, `GrenadeType`, `SkinKind`, `StageId`, `Action`) is the classic trap. `Record<Union, …>` literals must get an entry, and `npx tsc --noEmit` finds those; but an `as Record<…>` cast hides a missing key until runtime (it happened with `projectiles` and `holders` in `GrenadeRig`). Grep for `as Record<` on the union too.
3. Check for a per-stage branch: `grep -n "settings.stage ===\|info.id ===\|heroStage" src/core/Game.ts`. New behaviour for one stage goes behind such a branch, not into the shared path.

## 2. While editing: keep it opt-in

- **New behaviour behind a flag, hint or new id**, so old callers take the old path unchanged. Examples that worked: `autoSkin(c, keep, hints)` with the defaults identical to before; `Weapon.noPin` set only for the knife; new `SkinKind` entries instead of editing `fsb`/`mark`.
- **Don't change a default** (starting weapon, stage order, default stage, key bindings, difficulty numbers) unless the user asked for that change. When the user said "don't put the new gun as the first gun", the M4 had to be restored as the starting weapon.
- **New keys:** developer mode already uses almost every free key (`devHotkeys()` in Game.ts: I/Y/U, digits, `- = [ ] ; ' , . / \ P`, Shift+K/L). Read it before picking defaults, and say in your report which dev hotkey (if any) a new default shares. Bump `VERSION` in `core/Bindings.ts` only with a migration; its `load()` keeps players' custom keys, and new actions get defaults automatically.
- **Removing something** (a stage, a model): grep every reference, including `index.html` credits, `README.md`, `main.ts` thumbnails and `screenshots/`. Keep shared types: `level/KestrelPoint.ts` still holds `LevelData`/`EnemySpawn` after Red Dune went.
- **Changing a shared helper** (`autoSkin`, `SoldierRetarget`, `Viewmodel`, `Pickups.populate`): prove the old callers get identical results. Either the new code runs only when the new option is passed, or you compare before and after on an existing user of the helper.
- **Revert instead of patching around**: if an experiment fails (the CS2 T soldier), `git checkout <file>` and delete its assets rather than leaving dead options behind.

## 3. After editing: the regression checklist

Run what applies, and report each result honestly (what passed, what you didn't test):

1. `npx tsc --noEmit`, always.
2. `npm run build` before you call the work finished.
3. Load **every stage** with `?quick=<id>` (`dust2`, `office`, `metro`, `nightshift`, `whiteout`): `state === "playing"`, no console errors, soldiers spawned (see `shadow-unit-verify` for the one-liner).
4. Things in the change's blast radius:
   - **Weapons:** the starting kit (M4, Glock, knife, grenades); fire, reload and switch; pickup swap; frag grenade pin and throw; quick knife.
   - **Soldiers:** the line-up page `dev/soldierview.html?kinds=…` with the old characters next to the new one.
   - **Missions:** objective advances (Sandstorm market → tunnels → west → rescue), the radar shows only the soldiers in play, checkpoints.
   - **Input:** the bindings screen still lists every action, and touch labels exist for new actions (`TOUCH_LABELS` in `ui/TouchControls.ts`).
5. Update `README.md` with a short dated section (the project's changelog lives there) and the `index.html` credits for any new asset (author, licence).

## Report template

End with: what changed (by feature, not by file), what you verified and how, what you couldn't verify, and anything that changed behaviour for existing content (even if intended). Don't commit unless asked.
