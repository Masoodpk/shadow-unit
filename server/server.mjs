// SHADOW UNIT — online deathmatch server (phase 1).
//
// One Node process, many rooms of up to 8. Two modes: free-for-all (everyone against everyone) and team
// deathmatch (two teams; no friendly fire; the team with the most kills wins). In a friends' room the
// host makes the teams: everyone comes in without one, and the host puts each player on a side and names
// the sides. Quick play (strangers, no host) balances them by itself. The room's creator (the host) starts the match
// when everyone's in, at the length he picked (5–15 minutes), so everyone gets the same time; respawn 3 s
// after a death at the spawn point farthest from everyone else; kills / deaths; the results stay up until
// the host plays again. Quick-play rooms (strangers) start and restart by themselves.
//
// Who decides what:
//   - movement: each client moves itself (instant, predicted); the server relays it to the others
//     20 times a second (snapshots) and refuses teleports;
//   - hits: the shooter's game tests its shot against what it sees (its own hitboxes, its own damage
//     numbers — "what you see is what you hit") and claims the hit; the server checks the claim (both
//     alive, range, damage cap, rate) and applies it. Kills, deaths and health are the server's.
//
//   npm run server            (PORT, default 8787; MP_MATCH_S=<seconds> overrides every match length — tests)
import { createServer } from "node:http";
import { WebSocketServer } from "ws";

const PORT = Number(process.env.PORT ?? 8787);
const TICK_HZ = 20;
/** match lengths the host can pick (minutes); MP_MATCH_S=<seconds> overrides them all (tests) */
const LENGTHS = [5, 8, 10, 12, 15];
const matchMs = (mins) => (Number(process.env.MP_MATCH_S) || mins * 60) * 1000;
/** the countdown between START and the clock running (everyone spawned apart, no damage yet) */
const COUNTDOWN_MS = 4000;
/** quick play (strangers, no host to wait for): starts this long after a second player comes in, and again after the results */
const AUTO_START_MS = 15 * 1000;
const RESULTS_MS = 12 * 1000;
/** back in after a death (the body lies where it fell until then) */
const RESPAWN_MS = 4000;
const MAX_PLAYERS = 8;
const MAX_HP = 100;
/** the biggest single hit any weapon can do (a rocket's direct hit, a knife in the head); claims above are refused */
const MAX_HIT = 420;
/** hit claims per second per shooter (a shotgun's pellets come as one claim per target) */
const MAX_HITS_PER_S = 30;
/** furthest a hit may be claimed from (m) */
const MAX_RANGE = 260;
const KINDS = ["swat", "fsb", "mark"];
/** the maps a room can be on (every stage but the Heroes Playground); a room keeps the one it was made with */
const STAGES = ["nightshift", "dust2", "office", "metro"];
const asStage = (s) => (STAGES.includes(s) ? s : STAGES[0]);
/** "ffa": everyone against everyone; "tdm": two teams */
const MODES = ["ffa", "tdm"];
const asMode = (m) => (MODES.includes(m) ? m : "ffa");
/** team deathmatch: each team wears its own uniform, so a glance tells friend from foe */
const TEAM_KINDS = ["swat", "fsb"];
/** kills this close together are a multi-kill (double, triple…) */
const MULTI_MS = 4500;
/** damage dealt this recently to someone who then dies by another hand is an assist */
const ASSIST_MS = 8000;
/** a kill from this far (m) is a long shot */
const LONGSHOT_M = 35;
/** the rewards' points (the pop-up's "+150"); kills still decide the winner */
const POINTS = { kill: 100, HEADSHOT: 50, "FIRST BLOOD": 50, "DOUBLE KILL": 50, "TRIPLE KILL": 100, "QUAD KILL": 150, "MEGA KILL": 200, "KILLING SPREE": 100, RAMPAGE: 150, DOMINATING: 200, UNSTOPPABLE: 250, GODLIKE: 300, REVENGE: 50, SHUTDOWN: 100, LONGSHOT: 50, "MELEE KILL": 50, "POINT BLANK": 25, ASSIST: 50 };
const STREAKS = { 3: "KILLING SPREE", 5: "RAMPAGE", 7: "DOMINATING", 10: "UNSTOPPABLE", 15: "GODLIKE" };
const MULTIS = ["", "", "DOUBLE KILL", "TRIPLE KILL", "QUAD KILL"];
/** health comes back as in single player: after 5 s without a hit, 4 a second */
const REGEN_DELAY_MS = 5000, REGEN_PER_S = 4;

/** @type {Map<string, Room>} */
const rooms = new Map();
/** one player per browser (its own id, kept by the game): a second join from it replaces the first */
const byCid = new Map();
let nextId = 1;

const now = () => Date.now();
const send = (ws, msg) => ws.readyState === 1 && ws.send(JSON.stringify(msg));
const clean = (s, n) => String(s ?? "").replace(/[^\p{L}\p{N} _\-.]/gu, "").trim().slice(0, n);
const code = () => Array.from({ length: 4 }, () => "ABCDEFGHJKLMNPQRSTUVWXYZ"[(Math.random() * 24) | 0]).join("");

// A room's life: "lobby" (players come in and walk about; no damage, no clock) → the host presses START
// → "countdown" (everyone respawned apart, 4 s) → "playing" (the clock runs: the length the host picked)
// → "results" (scores stay up until the host starts again, or people leave). Quick-play rooms have
// no host to wait for: they start by themselves.
class Room {
  constructor(id, open, stage, mins, mode) {
    this.id = id;
    this.stage = stage;
    this.mode = asMode(mode);
    /** the two sides' names (the host's to change in a friends' room) */
    this.teamNames = ["ALPHA", "BRAVO"];
    /** nobody has scored yet this match (the first kill is FIRST BLOOD) */
    this.blooded = false;
    /** strangers can be put here by quick play */
    this.open = open;
    this.mins = LENGTHS.includes(mins) ? mins : 5;
    /** @type {Map<number, any>} */
    this.players = new Map();
    /** spawn points [x, y, z, yaw] — the map's, sent by the first client in (every client computes the same list) */
    this.spawns = [];
    /** the player who starts matches (the room's creator; the next one in if he leaves) */
    this.host = 0;
    this.phase = "lobby";
    this.startsAt = this.endsAt = this.autoAt = 0;
  }
  info() {
    const t = now();
    return {
      t: "room",
      host: this.host,
      phase: this.phase,
      mins: this.mins,
      mode: this.mode,
      teamNames: this.teamNames,
      open: this.open,
      startsIn: this.phase === "countdown" ? this.startsAt - t : 0,
      endsIn: this.phase === "playing" ? this.endsAt - t : 0,
      autoIn: this.autoAt ? Math.max(0, this.autoAt - t) : 0,
    };
  }
  /** START (the host, or quick play's timer): scores to zero, everyone respawned apart, the countdown */
  start() {
    if (this.phase !== "lobby" && this.phase !== "results") return;
    // (a friends' team match: the host must have put everyone on a side first)
    const loose = this.mode === "tdm" ? [...this.players.values()].filter((o) => o.team < 0) : [];
    if (loose.length && !this.open) {
      const h = this.players.get(this.host);
      if (h) send(h.ws, { t: "noStart", names: loose.map((o) => o.name) });
      return;
    }
    this.phase = "countdown";
    this.startsAt = now() + COUNTDOWN_MS;
    this.autoAt = 0;
    // (quick play: strangers' teams evened out; friends keep the sides they picked)
    if (this.mode === "tdm" && this.open) this.balance();
    this.blooded = false;
    for (const p of this.players.values()) {
      p.k = p.d = p.pts = p.streak = p.multi = 0;
      p.lastKiller = 0;
      p.alive = false;
    }
    for (const p of this.players.values()) this.spawn(p);
    this.broadcast({ t: "start", scores: this.scores() });
    this.broadcast(this.info());
  }
  broadcast(msg, except) {
    const s = JSON.stringify(msg);
    for (const p of this.players.values()) if (p !== except && p.ws.readyState === 1) p.ws.send(s);
  }
  /** are these two on the same side (team deathmatch only — in free-for-all everyone's a foe) */
  mates(a, b) {
    return this.mode === "tdm" && a.team >= 0 && a.team === b.team;
  }
  /** the team with fewer players (the lower score on a tie) */
  smallerTeam(except) {
    const n = [0, 0];
    for (const o of this.players.values()) if (o !== except && o.team >= 0) n[o.team]++;
    if (n[0] !== n[1]) return n[0] < n[1] ? 0 : 1;
    const [a, b] = this.teamKills();
    return a <= b ? 0 : 1;
  }
  teamKills() {
    const t = [0, 0];
    for (const o of this.players.values()) if (o.team >= 0) t[o.team] += o.k;
    return t;
  }
  /** a player onto a side (team deathmatch), in that side's uniform; -1 / free-for-all: no side, his own uniform */
  setTeam(p, team) {
    p.team = this.mode === "tdm" && (team === 0 || team === 1) ? team : -1;
    p.kind = p.team >= 0 ? TEAM_KINDS[p.team] : p.ffaKind;
  }
  /**
   * The side a player gets on coming in. Quick play: the smaller one. A friends' team room between
   * matches: none — the host puts him on one; mid-match (no host to wait for): the smaller one.
   */
  joinTeam(p, old) {
    if (this.mode !== "tdm") return -1;
    if (old && old.room === this && old.team >= 0) return old.team;
    if (!this.open && (this.phase === "lobby" || this.phase === "results")) return -1;
    return this.smallerTeam(p);
  }
  /** teams evened to within one (the newest in move first) */
  balance() {
    const list = [...this.players.values()];
    for (;;) {
      const n = [0, 1].map((t) => list.filter((o) => o.team === t).length);
      if (Math.abs(n[0] - n[1]) <= 1) break;
      const big = n[0] > n[1] ? 0 : 1;
      const mover = list.filter((o) => o.team === big).pop();
      this.setTeam(mover, 1 - big);
    }
  }
  /** the mode changed (the host, between matches): off the sides — the host deals them out again */
  setMode(mode) {
    this.mode = asMode(mode);
    let i = 0;
    for (const p of this.players.values()) this.setTeam(p, this.open ? i++ % 2 : -1);
    this.broadcast(this.roster());
    this.broadcast(this.info());
  }
  /** who's who: names, uniforms, sides (on joining and whenever a side or the mode changes) */
  roster() {
    return { t: "roster", mode: this.mode, players: [...this.players.values()].map((o) => ({ id: o.id, name: o.name, kind: o.kind, team: o.team, k: o.k, d: o.d })) };
  }
  /** the spawn point farthest from the living foes (team deathmatch: and not far from your own side) */
  spawn(p) {
    let best = this.spawns[0] ?? [0, 0, 0, 0], bd = -Infinity;
    for (const s of this.spawns) {
      let d = Infinity, mate = Infinity;
      for (const o of this.players.values()) {
        if (o === p || !o.alive) continue;
        const r = Math.hypot(o.x - s[0], o.z - s[2]);
        if (this.mates(p, o)) mate = Math.min(mate, r);
        else d = Math.min(d, r);
      }
      // (nobody to keep away from: anywhere will do)
      if (d === Infinity) d = 100;
      if (mate !== Infinity) d -= 0.3 * Math.min(mate, 40);
      d *= 0.85 + Math.random() * 0.3;
      if (d > bd) (bd = d), (best = s);
    }
    Object.assign(p, { x: best[0], y: best[1], z: best[2], yaw: best[3], alive: true, hp: MAX_HP, respawnAt: 0, spawnedAt: now() });
    send(p.ws, { t: "spawn", p: [best[0], best[1], best[2]], yaw: best[3] });
  }
  scores() {
    return [...this.players.values()].map((p) => ({ id: p.id, name: p.name, k: p.k, d: p.d, team: p.team, pts: p.pts })).sort((a, b) => b.k - a.k || a.d - b.d);
  }
  tick() {
    const t = now();
    if (this.phase === "countdown" && t >= this.startsAt) {
      this.phase = "playing";
      this.endsAt = t + matchMs(this.mins);
      this.broadcast(this.info());
    } else if (this.phase === "playing" && t >= this.endsAt) {
      this.phase = "results";
      // (quick play goes again by itself; a friends' room waits for its host)
      this.autoAt = this.open ? t + RESULTS_MS : 0;
      this.broadcast({ t: "end", scores: this.scores(), mode: this.mode, teams: this.mode === "tdm" ? this.teamKills() : null });
      this.broadcast(this.info());
    } else if (this.autoAt && t >= this.autoAt) this.start();
    if (this.phase !== "results")
      for (const p of this.players.values()) {
        if (!p.alive && p.respawnAt && t >= p.respawnAt) this.spawn(p);
        else if (p.alive && p.hp < MAX_HP && t - (p.hurtAt ?? 0) > REGEN_DELAY_MS) p.hp = Math.min(MAX_HP, p.hp + REGEN_PER_S / TICK_HZ);
      }
    const players = [...this.players.values()].map((p) => [p.id, +p.x.toFixed(2), +p.y.toFixed(2), +p.z.toFixed(2), +p.yaw.toFixed(3), +p.pitch.toFixed(3), +p.vx.toFixed(2), +p.vz.toFixed(2), p.stance, p.weapon, p.alive ? 1 : 0, p.reload, Math.round(p.hp)]);
    this.broadcast({ t: "snap", st: t, endsIn: this.phase === "playing" ? this.endsAt - t : 0, players });
  }
}

/** a player out of his room (he left, dropped, or joined again from the same browser) */
function leave(p) {
  const room = p.room;
  if (!room.players.has(p.id)) return;
  room.players.delete(p.id);
  if (byCid.get(p.cid) === p) byCid.delete(p.cid);
  room.broadcast({ t: "leave", id: p.id, scores: room.scores() });
  if (!room.players.size) rooms.delete(room.id);
  else {
    // the host left: the one who has been here longest takes over
    if (room.host === p.id) room.host = room.players.keys().next().value;
    if (room.open && room.players.size < 2 && room.phase === "lobby") room.autoAt = 0;
    room.broadcast(room.info());
  }
  console.log(`[${room.id}] ${p.name} left (${room.players.size})`);
}

function join(ws, msg) {
  const name = clean(msg.name, 16) || "OPERATOR";
  const cid = clean(msg.cid, 40);
  let room;
  const want = clean(msg.room, 8).toUpperCase();
  const stage = asStage(msg.stage);
  const mins = Number(msg.mins) | 0;
  const mode = asMode(msg.mode);
  if (want) room = rooms.get(want) ?? new Room(want, false, stage, mins, mode);
  else {
    // quick play: an open room on the same map and mode with space, in a match, else a new one
    room = [...rooms.values()].find((r) => r.open && r.stage === stage && r.mode === mode && r.players.size < MAX_PLAYERS && r.phase !== "results") ?? new Room(code(), true, stage, 5, mode);
  }
  // (the room is on another map than the one this player loaded: he reloads onto it and joins again)
  if (room.stage !== stage) return send(ws, { t: "stage", room: room.id, stage: room.stage });
  // the same browser again (a reload, a second tab, a rejoin after a drop): the old one goes, its score comes along
  const old = cid ? byCid.get(cid) : null;
  let carry = null;
  if (old) {
    if (old.room.id === clean(msg.room, 8).toUpperCase() || !msg.room) carry = { k: old.k, d: old.d };
    send(old.ws, { t: "replaced" });
    leave(old);
    old.ws.close();
  }
  if (room.players.size >= MAX_PLAYERS) return send(ws, { t: "full", room: room.id });
  rooms.set(room.id, room);
  if (!room.spawns.length && Array.isArray(msg.spawns)) room.spawns = msg.spawns.filter((s) => Array.isArray(s) && s.length === 4 && s.every(Number.isFinite)).slice(0, 64);
  const used = new Set([...room.players.values()].map((p) => p.ffaKind));
  const ffaKind = KINDS.find((k) => !used.has(k)) ?? KINDS[room.players.size % KINDS.length];
  const p = { id: nextId++, ws, name, room, ffaKind, kind: ffaKind, team: -1, pts: 0, streak: 0, multi: 0, lastKillAt: 0, lastKiller: 0, dmgBy: new Map(), x: 0, y: 0, z: 0, yaw: 0, pitch: 0, vx: 0, vz: 0, stance: 0, weapon: "rifle", reload: 0, alive: false, hp: MAX_HP, k: 0, d: 0, respawnAt: 0, spawnedAt: 0, hits: [] };
  p.cid = cid;
  if (carry && room.phase !== "results") Object.assign(p, carry);
  // (a rejoin keeps his side if it still has room for him; anyone else goes to the smaller team)
  room.setTeam(p, room.joinTeam(p, old));
  room.players.set(p.id, p);
  if (cid) byCid.set(cid, p);
  ws.player = p;
  if (!room.host || !room.players.has(room.host)) room.host = p.id;
  // (quick play: a second player in the lobby starts the clock to the match)
  if (room.open && room.phase === "lobby" && room.players.size >= 2 && !room.autoAt) room.autoAt = now() + AUTO_START_MS;
  send(ws, {
    t: "welcome",
    id: p.id,
    room: room.id,
    stage: room.stage,
    mode: room.mode,
    players: room.roster().players,
  });
  send(ws, room.info());
  room.broadcast({ t: "join", id: p.id, name: p.name, kind: p.kind, team: p.team }, p);
  room.broadcast(room.info(), p);
  room.spawn(p);
  console.log(`[${room.id}] ${name} joined (${room.players.size})`);
}

function onState(p, m) {
  if (!p.alive || !Array.isArray(m.p)) return;
  const [x, y, z] = m.p.map(Number);
  if (![x, y, z].every(Number.isFinite)) return;
  // no teleporting: more than a sprint-and-jump allows since the last update is refused (fresh spawns aside)
  const jump = Math.hypot(x - p.x, z - p.z);
  // (MP_DEV=1: allowed — automated tests put players where they need them)
  if (jump > 6 && now() - p.spawnedAt > 1500 && !process.env.MP_DEV) return send(p.ws, { t: "spawn", p: [p.x, p.y, p.z], yaw: p.yaw });
  Object.assign(p, { x, y, z, yaw: +m.yaw || 0, pitch: +m.pitch || 0, vx: +m.vx || 0, vz: +m.vz || 0, stance: m.stance | 0, weapon: clean(m.w, 12) || p.weapon, reload: m.r ? 1 : 0 });
}

function onHit(p, m) {
  const room = p.room;
  if (room.phase !== "playing" || !p.alive) return;
  const target = room.players.get(m.to | 0);
  const dmg = Number(m.dmg);
  if (!target || target === p || !target.alive || !(dmg > 0) || dmg > MAX_HIT) return;
  // (no friendly fire)
  if (room.mates(p, target)) return;
  if (Math.hypot(target.x - p.x, target.y - p.y, target.z - p.z) > MAX_RANGE) return;
  const t = now();
  p.hits = p.hits.filter((h) => t - h < 1000);
  if (p.hits.length >= MAX_HITS_PER_S) return;
  p.hits.push(t);
  target.hp = Math.max(0, target.hp - dmg);
  target.hurtAt = t;
  target.dmgBy.set(p.id, t);
  const head = !!m.head;
  room.broadcast({ t: "hit", by: p.id, to: target.id, dmg: Math.round(dmg), head, hp: Math.round(target.hp), from: [p.x, p.y + 1.5, p.z] });
  if (target.hp <= 0) kill(room, p, target, { head, melee: !!m.mel, w: clean(m.w, 12) });
}

/**
 * A kill, and its rewards — decided here, so everyone sees the same ones: HEADSHOT, FIRST BLOOD, a
 * multi-kill (DOUBLE … MEGA KILL), a streak (KILLING SPREE at 3 … GODLIKE at 15), REVENGE on whoever
 * killed you last, SHUTDOWN of someone on a streak, LONGSHOT, POINT BLANK, MELEE KILL; and an ASSIST for
 * anyone else who hurt him in the last few seconds.
 */
function kill(room, p, target, { head, melee, w }) {
  const t = now();
  const dist = Math.hypot(target.x - p.x, target.y - p.y, target.z - p.z);
  const medals = [];
  if (head) medals.push("HEADSHOT");
  if (!room.blooded) medals.push("FIRST BLOOD");
  room.blooded = true;
  p.multi = t - p.lastKillAt < MULTI_MS ? p.multi + 1 : 1;
  p.lastKillAt = t;
  if (p.multi >= 2) medals.push(MULTIS[p.multi] ?? "MEGA KILL");
  p.streak++;
  if (STREAKS[p.streak]) medals.push(STREAKS[p.streak]);
  if (target.id === p.lastKiller) {
    medals.push("REVENGE");
    p.lastKiller = 0;
  }
  if (target.streak >= 3) medals.push("SHUTDOWN");
  if (melee) medals.push("MELEE KILL");
  else if (dist >= LONGSHOT_M) medals.push("LONGSHOT");
  else if (dist < 2.5) medals.push("POINT BLANK");
  const pts = POINTS.kill + medals.reduce((a, n) => a + (POINTS[n] ?? 0), 0);
  p.pts += pts;
  p.k++;
  const shut = target.streak;
  target.streak = target.multi = 0;
  target.lastKiller = p.id;
  target.alive = false;
  target.d++;
  target.respawnAt = t + RESPAWN_MS;
  // (whoever else hurt him lately, on the killer's side — or anyone, in free-for-all)
  const assists = [];
  for (const [id, at] of target.dmgBy) {
    const a = room.players.get(id);
    if (a && a !== p && t - at < ASSIST_MS && !room.mates(a, target)) {
      a.pts += POINTS.ASSIST;
      assists.push(id);
    }
  }
  target.dmgBy.clear();
  room.broadcast({ t: "kill", by: p.id, to: target.id, head, w: melee ? "melee" : w, medals, pts, assists, streak: p.streak, shut, dist: Math.round(dist), scores: room.scores(), teams: room.mode === "tdm" ? room.teamKills() : null });
}

// /health: what the game's MULTIPLAYER screen polls (it wakes a sleeping free host, and shows who's on)
const http = createServer((req, res) => {
  // (?room=CODE: who's in it — the invite screen shows it)
  const want = clean(new URL(req.url ?? "/", "http://x").searchParams.get("room"), 8).toUpperCase();
  const r = want ? rooms.get(want) : null;
  const room = want ? (r ? { id: r.id, stage: r.stage, mode: r.mode, phase: r.phase, mins: r.mins, host: r.players.get(r.host)?.name ?? "", players: r.scores().map(({ name, k, d }) => ({ name, k, d })), endsIn: r.phase === "playing" ? r.endsAt - now() : 0, max: MAX_PLAYERS } : null) : undefined;
  const players = [...rooms.values()].reduce((n, r) => n + r.players.size, 0);
  const open = [...rooms.values()].filter((r) => r.open && r.players.size < MAX_PLAYERS).length;
  res.writeHead(200, { "content-type": "application/json", "access-control-allow-origin": "*", "cache-control": "no-store" });
  res.end(JSON.stringify({ ok: true, rooms: rooms.size, players, openRooms: open, room, version: 3 }));
});
const wss = new WebSocketServer({ server: http, maxPayload: 16 * 1024 });
wss.on("connection", (ws) => {
  ws.on("message", (raw) => {
    let m;
    try {
      m = JSON.parse(String(raw));
    } catch {
      return;
    }
    const p = ws.player;
    if (m.t === "join" && !p) return join(ws, m);
    if (!p) return;
    if (m.t === "state") onState(p, m);
    else if (m.t === "hit") onHit(p, m);
    else if (m.t === "fire") p.alive && p.room.broadcast({ t: "fire", id: p.id, o: m.o, d: m.d, w: clean(m.w, 12) }, p);
    else if (m.t === "ping") send(ws, { t: "pong", c: m.c, st: now() });
    else if (m.t === "died" && p.alive) {
      // (a fall, a grenade of your own: a death, no one's kill — counted only while the clock runs)
      p.alive = false;
      if (p.room.phase === "playing") p.d++;
      p.streak = p.multi = 0;
      p.dmgBy.clear();
      p.respawnAt = now() + RESPAWN_MS;
      p.room.broadcast({ t: "kill", by: p.id, to: p.id, head: false, w: "fall", scores: p.room.scores() });
    }
    // the host's controls: START (from the lobby or the results) and the match length
    else if (m.t === "start" && p.room.host === p.id) p.room.start();
    // between matches: the host picks the mode, the teams and their names (quick play: anyone may move to
    // the smaller side — there's no host to ask)
    else if (m.t === "mode" && p.room.host === p.id && (p.room.phase === "lobby" || p.room.phase === "results")) p.room.setMode(m.mode);
    else if (m.t === "team" && p.room.mode === "tdm" && (p.room.phase === "lobby" || p.room.phase === "results")) {
      const room = p.room;
      if (room.open) {
        const other = 1 - p.team;
        if (room.smallerTeam(p) !== other) return send(ws, { t: "teamFull" });
        room.setTeam(p, other);
      } else {
        if (room.host !== p.id) return;
        const who = room.players.get(m.id | 0);
        if (!who) return;
        room.setTeam(who, Number(m.team));
      }
      room.broadcast(room.roster());
    } else if (m.t === "teamName" && !p.room.open && p.room.host === p.id && (m.team === 0 || m.team === 1)) {
      const nm = clean(m.name, 14).toUpperCase();
      if (!nm) return;
      p.room.teamNames[m.team] = nm;
      p.room.broadcast(p.room.info());
    }
    else if (m.t === "mins" && p.room.host === p.id && LENGTHS.includes(m.mins | 0) && (p.room.phase === "lobby" || p.room.phase === "results")) {
      p.room.mins = m.mins | 0;
      p.room.broadcast(p.room.info());
    }
  });
  ws.on("close", () => ws.player && leave(ws.player));
  ws.isAlive = true;
  ws.on("pong", () => (ws.isAlive = true));
});
// a connection that stopped answering (a phone that switched apps, a dropped network) is closed within
// 10 s, so nobody stays in a room as a ghost (browsers answer pings on their own, even in a hidden tab)
setInterval(() => {
  for (const ws of wss.clients) {
    if (!ws.isAlive) {
      ws.terminate();
      continue;
    }
    ws.isAlive = false;
    ws.ping();
  }
}, 5000);
setInterval(() => {
  for (const r of rooms.values()) r.tick();
}, 1000 / TICK_HZ);
http.listen(PORT, () => console.log(`shadow-unit mp server on :${PORT}`));
