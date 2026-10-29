// SHADOW UNIT — online deathmatch server (phase 1).
//
// One Node process, many rooms of up to 8. Free-for-all: 5-minute matches, respawn 3 s after a death
// at the spawn point farthest from everyone else, kills / deaths scoreboard, results, then a new match.
//
// Who decides what:
//   - movement: each client moves itself (instant, predicted); the server relays it to the others
//     20 times a second (snapshots) and refuses teleports;
//   - hits: the shooter's game tests its shot against what it sees (its own hitboxes, its own damage
//     numbers — "what you see is what you hit") and claims the hit; the server checks the claim (both
//     alive, range, damage cap, rate) and applies it. Kills, deaths and health are the server's.
//
//   npm run server            (PORT, default 8787; MP_MATCH_S match length in seconds, default 300)
import { createServer } from "node:http";
import { WebSocketServer } from "ws";

const PORT = Number(process.env.PORT ?? 8787);
const TICK_HZ = 20;
/** match length: 5 minutes (MP_MATCH_S=<seconds> to change it) */
const MATCH_MS = (Number(process.env.MP_MATCH_S) || 5 * 60) * 1000;
const RESULTS_MS = 12 * 1000;
const RESPAWN_MS = 3000;
const MAX_PLAYERS = 8;
const MAX_HP = 100;
/** the biggest single hit any weapon can do (a rocket's direct hit, a knife in the head); claims above are refused */
const MAX_HIT = 420;
/** hit claims per second per shooter (a shotgun's pellets come as one claim per target) */
const MAX_HITS_PER_S = 30;
/** furthest a hit may be claimed from (m) */
const MAX_RANGE = 260;
const KINDS = ["swat", "fsb", "mark"];
/** health comes back as in single player: after 5 s without a hit, 4 a second */
const REGEN_DELAY_MS = 5000, REGEN_PER_S = 4;

/** @type {Map<string, Room>} */
const rooms = new Map();
let nextId = 1;

const now = () => Date.now();
const send = (ws, msg) => ws.readyState === 1 && ws.send(JSON.stringify(msg));
const clean = (s, n) => String(s ?? "").replace(/[^\p{L}\p{N} _\-.]/gu, "").trim().slice(0, n);
const code = () => Array.from({ length: 4 }, () => "ABCDEFGHJKLMNPQRSTUVWXYZ"[(Math.random() * 24) | 0]).join("");

class Room {
  constructor(id, open) {
    this.id = id;
    /** strangers can be put here by quick play */
    this.open = open;
    /** @type {Map<number, any>} */
    this.players = new Map();
    /** spawn points [x, y, z, yaw] — the map's, sent by the first client in (every client computes the same list) */
    this.spawns = [];
    this.newMatch();
  }
  newMatch() {
    this.phase = "playing";
    this.endsAt = now() + MATCH_MS;
    for (const p of this.players.values()) {
      p.k = p.d = 0;
      this.spawn(p);
    }
    this.broadcast({ t: "start", endsIn: MATCH_MS });
  }
  broadcast(msg, except) {
    const s = JSON.stringify(msg);
    for (const p of this.players.values()) if (p !== except && p.ws.readyState === 1) p.ws.send(s);
  }
  /** the spawn point farthest from the living */
  spawn(p) {
    let best = this.spawns[0] ?? [0, 0, 0, 0], bd = -1;
    for (const s of this.spawns) {
      let d = Infinity;
      for (const o of this.players.values()) if (o !== p && o.alive) d = Math.min(d, Math.hypot(o.x - s[0], o.z - s[2]));
      d *= 0.85 + Math.random() * 0.3;
      if (d > bd) (bd = d), (best = s);
    }
    Object.assign(p, { x: best[0], y: best[1], z: best[2], yaw: best[3], alive: true, hp: MAX_HP, respawnAt: 0, spawnedAt: now() });
    send(p.ws, { t: "spawn", p: [best[0], best[1], best[2]], yaw: best[3] });
  }
  scores() {
    return [...this.players.values()].map((p) => ({ id: p.id, name: p.name, k: p.k, d: p.d })).sort((a, b) => b.k - a.k || a.d - b.d);
  }
  tick() {
    const t = now();
    if (this.phase === "playing" && t >= this.endsAt) {
      this.phase = "results";
      this.resultsUntil = t + RESULTS_MS;
      this.broadcast({ t: "end", scores: this.scores(), next: RESULTS_MS });
    } else if (this.phase === "results" && t >= this.resultsUntil) this.newMatch();
    if (this.phase === "playing")
      for (const p of this.players.values()) {
        if (!p.alive && p.respawnAt && t >= p.respawnAt) this.spawn(p);
        else if (p.alive && p.hp < MAX_HP && t - (p.hurtAt ?? 0) > REGEN_DELAY_MS) p.hp = Math.min(MAX_HP, p.hp + REGEN_PER_S / TICK_HZ);
      }
    const players = [...this.players.values()].map((p) => [p.id, +p.x.toFixed(2), +p.y.toFixed(2), +p.z.toFixed(2), +p.yaw.toFixed(3), +p.pitch.toFixed(3), +p.vx.toFixed(2), +p.vz.toFixed(2), p.stance, p.weapon, p.alive ? 1 : 0, p.reload, Math.round(p.hp)]);
    this.broadcast({ t: "snap", st: t, endsIn: this.phase === "playing" ? this.endsAt - t : 0, players });
  }
}

function join(ws, msg) {
  const name = clean(msg.name, 16) || "OPERATOR";
  let room;
  const want = clean(msg.room, 8).toUpperCase();
  if (want) room = rooms.get(want) ?? new Room(want, false);
  else {
    // quick play: an open room with space, in a match, else a new one
    room = [...rooms.values()].find((r) => r.open && r.players.size < MAX_PLAYERS && r.phase === "playing") ?? new Room(code(), true);
  }
  if (room.players.size >= MAX_PLAYERS) return send(ws, { t: "full", room: room.id });
  rooms.set(room.id, room);
  if (!room.spawns.length && Array.isArray(msg.spawns)) room.spawns = msg.spawns.filter((s) => Array.isArray(s) && s.length === 4 && s.every(Number.isFinite)).slice(0, 64);
  const used = new Set([...room.players.values()].map((p) => p.kind));
  const p = { id: nextId++, ws, name, room, kind: KINDS.find((k) => !used.has(k)) ?? KINDS[room.players.size % KINDS.length], x: 0, y: 0, z: 0, yaw: 0, pitch: 0, vx: 0, vz: 0, stance: 0, weapon: "rifle", reload: 0, alive: false, hp: MAX_HP, k: 0, d: 0, respawnAt: 0, spawnedAt: 0, hits: [] };
  room.players.set(p.id, p);
  ws.player = p;
  send(ws, {
    t: "welcome",
    id: p.id,
    room: room.id,
    endsIn: room.phase === "playing" ? room.endsAt - now() : 0,
    players: [...room.players.values()].map((o) => ({ id: o.id, name: o.name, kind: o.kind, k: o.k, d: o.d })),
  });
  room.broadcast({ t: "join", id: p.id, name: p.name, kind: p.kind }, p);
  if (room.phase === "playing") room.spawn(p);
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
  if (Math.hypot(target.x - p.x, target.y - p.y, target.z - p.z) > MAX_RANGE) return;
  const t = now();
  p.hits = p.hits.filter((h) => t - h < 1000);
  if (p.hits.length >= MAX_HITS_PER_S) return;
  p.hits.push(t);
  target.hp = Math.max(0, target.hp - dmg);
  target.hurtAt = t;
  const head = !!m.head;
  room.broadcast({ t: "hit", by: p.id, to: target.id, dmg: Math.round(dmg), head, hp: Math.round(target.hp), from: [p.x, p.y + 1.5, p.z] });
  if (target.hp <= 0) {
    target.alive = false;
    target.d++;
    p.k++;
    target.respawnAt = t + RESPAWN_MS;
    room.broadcast({ t: "kill", by: p.id, to: target.id, head, w: clean(m.w, 12), scores: room.scores() });
  }
}

// /health: what the game's MULTIPLAYER screen polls (it wakes a sleeping free host, and shows who's on)
const http = createServer((req, res) => {
  const players = [...rooms.values()].reduce((n, r) => n + r.players.size, 0);
  const open = [...rooms.values()].filter((r) => r.open && r.players.size < MAX_PLAYERS).length;
  res.writeHead(200, { "content-type": "application/json", "access-control-allow-origin": "*", "cache-control": "no-store" });
  res.end(JSON.stringify({ ok: true, rooms: rooms.size, players, openRooms: open, version: 1 }));
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
    else if (m.t === "died" && p.alive && p.room.phase === "playing") {
      // (a fall, a grenade of your own: a death, no one's kill)
      p.alive = false;
      p.d++;
      p.respawnAt = now() + RESPAWN_MS;
      p.room.broadcast({ t: "kill", by: p.id, to: p.id, head: false, w: "fall", scores: p.room.scores() });
    }
  });
  ws.on("close", () => {
    const p = ws.player;
    if (!p) return;
    const room = p.room;
    room.players.delete(p.id);
    room.broadcast({ t: "leave", id: p.id, scores: room.scores() });
    if (!room.players.size) rooms.delete(room.id);
    console.log(`[${room.id}] ${p.name} left (${room.players.size})`);
  });
});
setInterval(() => {
  for (const r of rooms.values()) r.tick();
}, 1000 / TICK_HZ);
http.listen(PORT, () => console.log(`shadow-unit mp server on :${PORT}`));
