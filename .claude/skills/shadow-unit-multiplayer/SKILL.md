---
name: shadow-unit-multiplayer
description: The Shadow Unit online deathmatch (free-for-all and team deathmatch, medals, gun melee up close) — server/server.mjs (Node + ws rooms, 20 Hz snapshots, health/kills/respawns/match clock, hit-claim checks) and src/net (MpClient: remote players as soldier skins with snapshot interpolation, client-side hits claimed to the server; MpHud). Use it for anything multiplayer: joining/rooms, lag or jitter, players not seeing each other, hits not counting, respawn/scoreboard/match timer, adding game modes (teams, bots), deploying the server, or making grenades/pickups networked.
---

# Online deathmatch

Read README.md "Online deathmatch, phase 1" first: it has the how-to-play steps and the design.

## Rules that keep it working

- **Single player must not change.** Every multiplayer hook is behind `settings.mp` / `this.mp` in Game, `events.onFire?` in WeaponManager, and `player.rescueFloor`-style optional hooks. New hooks follow the same pattern.
- **The server owns the score.** Health, kills, deaths, respawn positions and the clock come from the server. Clients never call `player.takeDamage` for network damage: use `netDamage`, and route deaths through `mp.localDeath()`. A death the server doesn't know about (a fall) must send `{t:"died"}`, or the player stays dead.
- **Remote players are soldier skins.** `buildSoldier(scene, mats, owner, 200 + idx)` + `skins.create(kind, parts, idx)`, positioned at the interpolated feet and driven by `skin.animate(AnimInput)`. Their hitboxes carry `metadata.enemy = RemotePlayer`, so every weapon's hit path (bullets, knife, throwing knives) calls `RemotePlayer.applyHit`, which claims the hit. Anything that damages "enemies" through `EnemyManager` (grenade blasts, fire) doesn't reach remote players yet.
- **Message shapes** live in two places (server.mjs and MpClient.onMessage): change both together. Snapshot rows are positional arrays: `[id, x, y, z, yaw, pitch, vx, vz, stance, weapon, alive, reload, hp]`. Stance: 0 standing, 1 crouched, 2 prone, 3 sliding (`player.sliding`). A remote on stance 3 plays the slide from his first sliding sample (`RemotePlayer.slideT` → `AnimInput.slide`), aims from a 0.78 m eye, and fades back out when the samples stop saying 3.

## Hosting (free)

- The server runs on Render's free plan from `render.yaml` (service `shadow-unit-mp`, rootDir `server/`, health check `/health`). It sleeps after 15 min idle and takes up to a minute to wake: the MULTIPLAYER screen polls `/health` (wakes it, shows players online) and `MpClient.connect()` retries every 3 s, up to 40 times, before the welcome; after a welcome a drop rejoins the same room.
- Where the game connects: `src/config/net.ts` `mpServerUrl()` — `VITE_MP_URL` if set at build time, `ws://<host>:8787` on localhost / LAN, else `MP_PUBLIC_SERVER` (`wss://shadow-unit-mp.onrender.com`). If Render gives the service a different URL, set `VITE_MP_URL` in Vercel and redeploy (or change the constant).
- The Vercel site is static: it can't host the WebSocket server. A page on https must use `wss://`.
- Invite links: `/?room=CODE` opens the MULTIPLAYER screen with the room filled in; the pause menu has COPY INVITE LINK.

## Room life (host-started matches)

- Server phases: `lobby` (walk about, no damage, no clock) → host `{t:"start"}` → `countdown` (4 s, everyone respawned apart, scores zeroed) → `playing` (clock = host's `mins`: 5/8/10/12/15, `{t:"mins"}` in lobby/results) → `results` (stays until the host starts again). `{t:"room"}` carries `host, phase, mins, open, startsIn, endsIn, autoIn` on every change. Host = creator; the longest-present player takes over if he leaves. Quick-play rooms (`open`) start 15 s after a second player and restart 12 s after results by themselves.
- Hits only count in `playing`; a death outside it respawns without counting. `MP_MATCH_S` overrides every length (tests).
- Client: ENTER starts for the host (lobby/results); the pause menu (`#mp-pause`, `drawMpPause` via `MpSettings.onRoom`) has START MATCH / PLAY AGAIN and the length chips for the host, the room's state for everyone, and MAIN MENU reads EXIT ROOM. The MULTIPLAYER screen picks map + length for CREATE; JOIN peeks the typed / last room (`/health?room=` → phase, host, players).

## What others see of you

- A remote player killed in view falls as a Havok ragdoll (`RemotePlayer.fall` → `skin.startRagdoll(1000 + idx, …)`, pushed away from the killer via `killFrom` set on the kill message) and lies there until his respawn (server `RESPAWN_MS` 4 s); a live sample brings him back with `skin.enterAnim()`.
- Each `fire` message: `RemotePlayer.fired()` lights his muzzle flash (`parts.flash`, 50 ms) and kicks his arms (`AnimInput.recoil` from a Spring), plus the sound and a tracer from his muzzle to the first wall (`nav.rayLevel`).
- Hits: measured 5/5 aimed shots registered at 12 m (26 body / 20 limb with the M4), victim's health matched exactly; damage online has no difficulty scaling, everyone 100 health and the same regen.

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

## Teams and rewards

- **Modes:** `Room.mode` is `"ffa"` or `"tdm"`, set by the creator's join (`MpSettings.mode`, the MULTIPLAYER screen's MODE chips) and changed by the host between matches (`{t:"mode"}` → `Room.setMode`, which deals everyone onto alternate sides). Quick play matches on map **and** mode.
- **Who picks the sides:** in a friends' room (`!open`) the host does. `Room.joinTeam` gives newcomers -1 (no team) between matches, the smaller team mid-match, and a rejoiner keeps their old team. The host sends `{t:"team", id, team}` (0, 1 or -1) and `{t:"teamName", team, name}` (names in `Room.teamNames`, sent on `{t:"room"}`). `start()` refuses with `{t:"noStart", names}` while anyone has -1. In quick play (`open`), `{t:"team"}` with no id is a self-switch to the smaller team. Client: `MpClient.assignTeam` / `setTeamName`, `RoomState.list` / `teamNames`, and the pause menu's `drawTeamPicker` in main.ts (`#mp-teams-ed`). Player ids change on a rejoin, so look players up by the list, never by a remembered id.
- **Sides:** `player.team` is 0 or 1 (named by the host; ALPHA / BRAVO by default), or -1 for free-for-all or no team yet. `setTeam` also sets the uniform (`TEAM_KINDS`: swat / fsb). `ffaKind` keeps the player's own uniform for free-for-all. Every side change broadcasts `{t:"roster"}` (id, name, kind, team, k, d). The client rebuilds a `RemotePlayer` whose `kind` changed (`MpClient.remote`).
- **Friendly fire is off in two places:** the server refuses `hit` claims between teammates (`Room.mates`), and on the client `RemotePlayer.alive` is `live && !friendly`. Every weapon's predicate asks `enemy.alive`, so shots, blows, thrown knives and lunges pass through teammates. Inside RemotePlayer use `live` for "in play".
- **Colours are relative:** your team is blue (`MATE` #4fa8ff) and the other red, whichever team you're on. Teammates go on the radar through `MpClient.radarMarks()` (Game chains it onto `minimap.marks`). Enemies never go on the radar. Name tags: teammates always (class `mate`); enemies only with `nav.clear(eye, head)`, checked 10 times a second, within 45 m.
- **Medals are the server's:** `kill()` in server.mjs builds `medals`, `pts` and `assists` on the kill message (tunables at the top: `MULTI_MS`, `ASSIST_MS`, `LONGSHOT_M`, `POINTS`, `STREAKS`). The client shows the killer's own medals with `MpHud.medals(list, pts)`, whose look is the `MEDAL` table (tier colour + emblem). A melee kill needs the claim's `mel: 1` (`RemotePlayer.applyHit` reads `info.kind === "melee"`). To add a medal: name it in `kill()`, give it `POINTS`, and add a `MEDAL` entry (otherwise it shows as a small grey line).
- **Gun melee up close:** `WeaponManager.autoMelee` (set only online). While the trigger is held, `foeInReach()` checks the foes from `lungeTargets` and then the strike's ray fan. `meleeLock` blocks the trigger, holding through the swing and its cooldown, so no rounds come out between blows.
- **Layout (nothing may overlap):** in game, the waiting-room / death board sits in the top-right corner (`#mp-board.lobby` / `.dead`, capped above the ammo HUD, scrolls inside), and the kill feed moves to the left under the objective (`#mp-hud.board-tr`; hidden on screens under 600 px tall). Paused online, `body.mp-paused` hides `#hud` and `#mp-hud`, and `MpHud.board` moves the board element into `#mp-pause-board` in the pause screen's second column (`.pause-cols` → `#mp-pause-col`: the room panel and the board, side by side when wide, stacked and scrolling when not). Board styles are on `#mp-board` (not `#mp-hud …`) so they work in either place. Check at 1000×650, 1440×850 and 740×360 with `resize_window`.
- **Testing teams:** add `&mode=tdm` to both tabs' `?quick=nightshift&mp=CODE&name=…&cid=…`. Hidden tabs freeze CSS animations: to look at the badges, set `a.currentTime` on `document.getAnimations()`, or add a style with `animation:none`.

## Phase 2 ideas, in order of value

Grenade and rocket damage to remote players (server-side blast: send the detonation, the server applies falloff to the players in radius); server-side hit validation with a position history (rewind by the shooter's RTT + 120 ms); bots filling empty slots with the existing Enemy AI (on the smaller team in team deathmatch); capture-the-flag / domination on top of `Room.mode`; more maps (any stage with voxel nav works: spawn points come from `spawnPoints(nav, start)`).
