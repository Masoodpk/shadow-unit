---
name: shadow-unit-verify
description: How to test changes to the Shadow Unit FPS in the browser quickly and cheaply — starting the dev server, booting straight into a stage, the window.T dev toolbox, freezing the AI or time, aiming and throwing from scripts, line-of-sight checks, the dev viewers (soldier line-up, gun animation viewer), and reading results as numbers instead of screenshots. Use it after any change to this game that's visible in play, and whenever you need to prove a feature works.
---

# Verifying in the browser

## Start

- Dev server: preview config `saltline-dev` in `.claude/launch.json` (port 5173). If pages 504 with "Outdated Optimize Dep", stop the server, `rm -rf node_modules/.vite`, start again. Don't start a second vite by hand.
- Boot into a stage: `http://localhost:5173/?quick=dust2|office|metro|nightshift|whiteout` (skips the menus, installs `window.T`).
- Wait for it: `for(let i=0;i<150&&!(window.T&&T.g.state==='playing');i++) await new Promise(r=>setTimeout(r,1000))`.
- **A hidden browser pane stops the game clock** (the browser stops animation frames): soldiers look "stuck idle" and `T.g.stats.time` stays at 0. Check `T.g.enemies.ctx.time` first; if it isn't advancing, drive the game with `T.step(60)` per simulated second, which works regardless, and call `T.g.scene.render()` before a screenshot (stepping doesn't draw).
- **Cut-scenes skip `player.update`** (the Underground's opening descent moves the camera itself): a test of player physics during one measures nothing. Check that it ran, for example with a counter the update advances.
- **The opening card holds input and weapon switches for a few seconds.** Wait about 6 s, or retry a key press in a loop until its effect shows, before deciding a key "doesn't work".

## The T toolbox (`main.ts` installDevHelpers)

```js
T.g                          // the Game: T.g.enemies.enemies, T.g.weapons, T.g.player, T.g.pickups, T.g.knives, T.g.level
T.key("KeyR", true/false)    // hold / release a key;  T.tap(code);  T.click(button)
T.go(x, z, yaw)              // stand on the nav node nearest (x, z) (turns god mode on)
T.fly(x,y,z, tx,ty,tz, fov)  // free camera; T.back() returns to the eyes
T.freeze() / T.run() / T.step(n)   // stop time, resume, step 60 Hz frames
await T.instr(120)           // perf counters (shadow-unit-perf)
T.g.dev.god = true
```

- **Freeze the AI** to inspect without being shot: `Object.defineProperty(T.g.enemies,'aiMode',{get:()=>'FROZEN',set:()=>{},configurable:true})`.
- **Aim at something**: set `T.g.player.yaw = atan2(dx, dz)` and `pitch = -atan2(dy, hypot(dx, dz))` from the camera to the target, every frame with `setInterval(aim, 16)` while you act.
- **Find a clear shot**: loop over `T.g.level.nav.nodes` 4–8 m from the target and keep the first where `scene.pickWithRay(new Ray(eye, dir, len), m => m.metadata?.kind === 1 && m.isPickable)` hits nothing. A "miss" is often your test standing behind a wall, so check this before blaming the code.
- `import('/node_modules/@babylonjs/core/Culling/ray.js')` gets `Ray` inside `javascript_tool`.

## Dev pages

- `/dev/soldierview.html?kinds=mark,fsb,swat`: character line-up (see `shadow-unit-characters`).
- `/dev/gunview.html?m=<asset url>`: orbit view of a model; `V.seek(seconds)` scrubs its first animation.
- `/dev/viewer.html?m=<url>&view=side|top|front`: orthographic measuring view with a grid.

## Cheap evidence

- Prefer one `javascript_tool` call that returns a JSON of what matters (`weapon id/state/phase`, inventory counts, `alive`, positions, `isVisible`/`isEnabled`, parent names) over screenshots.
- Screenshot at `scale: 0.6` and only to judge looks; textures and shaders can take a few seconds after load (a blank frame isn't necessarily a bug, so take it again).
- When something "isn't there", check `isVisible`, `isEnabled(true)`, its world bounds and whether it's in `scene.getActiveMeshes()` before theorising (the invisible knife was a template's hidden flag copied by `clone`).
- Finish with the all-stages load check from `shadow-unit-safe-change`, then `npm run build`.
