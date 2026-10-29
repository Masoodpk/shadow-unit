---
name: shadow-unit-ui
description: Interface of the Shadow Unit FPS — HUD (ammo, weapon slots, crosshair, hit markers, prompts), radar/minimap and full map, mission text and cards, menus and stage cards, controls/key bindings screen, touch-screen controls, icons, credits. Use it for any on-screen change, a new action that needs a key or touch button, a prompt or label, "the map shows X", menu or settings work, or mobile layout.
---

# UI

## Where things are

- **Markup and styles**: `index.html` (menu, panels, HUD skeleton, loading and result screens, credits list) + `src/styles.css`. Text in the markup is a placeholder; the game sets the real stage text at load.
- **Menu and settings**: `main.ts` (stage cards from `STAGES` + `THUMBS`, settings sliders `bindRange`, `store` for persistence, the controls screen that builds rows from `ACTIONS`).
- **HUD**: `ui/Hud.ts`: `setWeapon`, `setAmmo`, `setCarried` (slot strip), `setCrosshair`, `setScope`, `hit(kind, killed)` (hit marker), `setPrompt` / `flashPrompt`, the belt (tactical and lethal counts via `GRENADE_ICONS`). Updated each frame in `Game` (search `hud.setWeapon`), where the per-weapon prompt lines also live (grenade vs knife texts).
- **Mission text**: `ui/MissionHud.ts` (`say(speaker, line)`, `card(title, sub, secs)`, objective markers).
- **Radar / map**: `ui/Minimap.ts`; inputs are `enemies` (skip `!alive || dormant`), `marks()` (heroes, foes), `known()` (dashed objective areas), `supplies()` (pickups), `objective()`.
- **Icons**: `ui/icons.ts` (inline SVG, `currentColor`); add one per new weapon id or grenade type.
- **Touch**: `ui/TouchControls.ts`: `TOUCH_LABELS` (prompts name the on-screen button) and the button defs list; every button calls `Input.actionDown/Up`, the same path as keys.

## Adding an action

1. `core/Bindings.ts`: add to the `Action` union and `ACTIONS` (label, group, defaults). Pick defaults clear of `Game.devHotkeys` (almost every free key is a developer-mode key) and of existing actions; say which dev key it shares, if any.
2. If you change a default that shipped, bump `VERSION` and add a migration in `load()` that only clears the old default (players' own choices stay).
3. `TOUCH_LABELS` entry; a touch button only if the action is core to play.
4. Read it in game code with `input.hit(a)` (pressed this frame) / `input.held(a)`.

## Style

Military HUD: small caps, mono labels, orange accent (`#ff6a2b`), red for hostiles, dark translucent panels. Prompts are verbs in caps with the key in `<b>` (`<b>F</b> SWAP …`). Keep new UI consistent with that, and check it at phone width (touch defaults to low quality and bigger buttons, scale setting `touchScale`).
