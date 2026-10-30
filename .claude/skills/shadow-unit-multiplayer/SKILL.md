---
name: shadow-unit-multiplayer
description: The Shadow Unit online deathmatch — server/server.mjs (Node + ws rooms, 20 Hz snapshots, health/kills/respawns/match clock, hit-claim checks) and src/net (MpClient: remote players as soldier skins with snapshot interpolation, client-side hits claimed to the server; MpHud). Use it for anything multiplayer: joining/rooms, lag or jitter, players not seeing each other, hits not counting, respawn/scoreboard/match timer, adding game modes (teams, bots), deploying the server, or making grenades/pickups networked.
---

# Online deathmatch

Read README.md "Online deathmatch, phase 1" first: it has the how-to-play steps and the design.

## Rules that keep it working

- **Single player must not change.** Every multiplayer hook is behind `settings.mp` / `this.mp` in Game, `events.onFire?` in WeaponManager, and `player.rescueFloor`-style optional hooks. New hooks follow the same pattern.
- **The server owns the score.** Health, kills, deaths, respawn positions and the clock come from the server. Clients never call `player.takeDamage` for network damage: use `netDamage`, and route deaths through `mp.localDeath()`. A death the server doesn't know about (a fall) must send `{t:"died"}`, or the player stays dead.
- **Remote players are soldier skins.** `buildSoldier(scene, mats, owner, 200 + idx)` + `skins.create(kind, parts, idx)`, positioned at the interpolated feet and driven by `skin.animate(AnimInput)`. Their hitboxes carry `metadata.enemy = RemotePlayer`, so every weapon's hit path (bullets, knife, throwing knives) calls `RemotePlayer.applyHit`, which claims the hit. Anything that damages "enemies" through `EnemyManager` (grenade blasts, fire) doesn't reach remote players yet.
- **Message shapes** live in two places (server.mjs and MpClient.onMessage): change both together. Snapshot rows are positional arrays: `[id, x, y, z, yaw, pitch, vx, vz, stance, weapon, alive, reload, hp]`.

## Hosting (free)

- The server runs on Render's free plan from `render.yaml` (service `shadow-unit-mp`, rootDir `server/`, health check `/health`). It sleeps after 15 min idle and takes up to a minute to wake: the MULTIPLAYER screen polls `/health` (wakes it, shows players online) and `MpClient.connect()` retries every 3 s, up to 40 times, before the welcome; after a welcome a drop rejoins the same room.
- Where the game connects: `src/config/net.ts` `mpServerUrl()` — `VITE_MP_URL` if set at build time, `ws://<host>:8787` on localhost / LAN, else `MP_PUBLIC_SERVER` (`wss://shadow-unit-mp.onrender.com`). If Render gives the service a different URL, set `VITE_MP_URL` in Vercel and redeploy (or change the constant).
- The Vercel site is static: it can't host the WebSocket server. A page on https must use `wss://`.
- Invite links: `/?room=CODE` opens the MULTIPLAYER screen with the room filled in; the pause menu has COPY INVITE LINK.

## Maps and lockdown

- A room is on one map (`Room.stage`, server `STAGES`: nightshift, dust2, office, metro — never the Heroes Playground). The creator's pick (MULTIPLAYER screen, `mpStage`) goes in the join; JOIN asks `/health?room=` for the room's map first. If a join still arrives on the wrong map, the server answers `{t:"stage"}` and the client reloads onto it (`session.mpAuto` → `startMp`). Quick play only matches rooms on the same map.
- Online, every map: no garrison (`enemySpawns = []`), no mission (no hostage / lockers / gate on Sandstorm, no tape deck on Frostline, no MetroMission), and the operators' skins (mark / fsb / swat) whatever the stage's own.
- Online, no developer mode: `Game.setDevMode` forces it off when `settings.mp`, Backquote is ignored, H / L say "NOT AVAILABLE ONLINE", and `body.mp-on` hides the switches in SETTINGS and CONTROLS.

## No ghosts, no duplicates

- Each browser has its own id (`clientId()` in MpClient, localStorage `su.mpcid`; `?cid=` overrides it, which two-tab tests on one machine need). A join with an id already on the server replaces that player (the old tab gets `{t:"replaced"}` and stops reconnecting); the score carries over within the same room.
- The server pings every 5 s and terminates a connection that missed a pong (gone within 10 s). The client closes its socket on `pagehide`.
- `/health?room=CODE` lists who's in a room (the invite screen shows it). The scoreboard (`MpHud.board`) shows on Tab, on the death screen, beside the pause menu (`Game.setState` → `mp.setPaused`) and at the results.

## Testing (two players, one machine)

1. `MP_DEV=1 MP_MATCH_S=20 node server/server.mjs`, in the background (MP_DEV allows teleports for tests; a short match tests the end and the results).
2. Two browser tabs: `/?quick=nightshift&mp=TEST&name=ALPHA` and `...&name=BRAVO`. Hidden tabs don't run frames: drive each with `T.step(n)`. WebSocket messages still arrive.
3. Check: `T.g.mp.remotes` (does each see the other, at the right position), then a shot (place BRAVO 6–9 m away with line of sight, aim at `remote.position + 0.35 m`, hold fire, read `T.g.mp.scores`), then ALPHA's death screen and respawn, then the match end (`#mp-hud .mp-board h3` shows "MATCH OVER — …").
4. Load a single-player stage after (`?quick=dust2`): `T.g.mp` must be null, with soldiers and the mission as before.

## Phase 2 ideas, in order of value

Grenade and rocket damage to remote players (server-side blast: send the detonation, the server applies falloff to the players in radius); server-side hit validation with a position history (rewind by the shooter's RTT + 120 ms); bots filling empty slots with the existing Enemy AI; team deathmatch; more maps (any stage with voxel nav works: spawn points come from `spawnPoints(nav, start)`).
