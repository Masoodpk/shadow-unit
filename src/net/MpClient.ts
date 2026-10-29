import { Vector3 } from "@babylonjs/core/Maths/math.vector";
import { Scene } from "@babylonjs/core/scene";
import { Engine } from "@babylonjs/core/Engines/engine";
import { BodyZone } from "../config/game";
import { WEAPONS, WeaponId } from "../config/weapons";
import { Materials } from "../render/Materials";
import { buildSoldier, SoldierParts } from "../enemies/EnemyModel";
import { AnimInput, SkinKind, SoldierSkin, SoldierSkins } from "../enemies/SoldierSkin";
import type { PlayerController } from "../player/PlayerController";
import type { WeaponManager } from "../weapons/WeaponManager";
import type { Effects } from "../fx/Effects";
import type { AudioEngine } from "../audio/AudioEngine";
import type { NavGraph } from "../level/NavGraph";
import { MpHud, ScoreRow } from "./MpHud";

/**
 * Online deathmatch, the client side (the server is server/server.mjs).
 *
 *   - You move yourself, instantly, as in single player; your state goes to the server 20 times a second.
 *   - Everyone else is drawn with the game's own soldiers (the S.W.A.T. operator, the FSB operator,
 *     Mark), animated by the same mocap from their speed, direction, stance and aim, and shown ~120 ms in
 *     the past, smoothly in between the server's snapshots (snapshot interpolation).
 *   - Your shots hit what you see: your game tests them against the other players' bodies exactly as
 *     it does against soldiers (their hitboxes, your weapon's damage) and tells the server; the server
 *     checks the claim and decides health, kills and deaths.
 *   - Death: the view drops, KILLED BY …, and the server puts you back 3 s later at the spawn point
 *     farthest from everyone.
 */

export interface MpSettings {
  /** ws:// or wss:// address of the server */
  url: string;
  /** room code to join; empty: quick play (any open room) */
  room: string;
  name: string;
}

export interface MpHost {
  scene: Scene;
  engine: Engine;
  mats: Materials;
  skins: SoldierSkins;
  player: PlayerController;
  weapons: WeaponManager;
  fx: Effects;
  audio: AudioEngine;
  nav: NavGraph;
  playerSpawn: Vector3;
}

/** how far in the past other players are drawn (ms): two snapshots' worth, so there's always a pair to blend */
const INTERP_MS = 120;
const SEND_HZ = 20;

interface Sample {
  t: number;
  x: number;
  y: number;
  z: number;
  yaw: number;
  pitch: number;
  vx: number;
  vz: number;
  stance: number;
  alive: boolean;
  weapon: string;
  reload: number;
}

const wrap = (a: number) => Math.atan2(Math.sin(a), Math.cos(a));

/** another player in the room: a soldier body that takes your hits and passes them to the server */
class RemotePlayer {
  readonly parts: SoldierParts;
  readonly skin: SoldierSkin;
  readonly buf: Sample[] = [];
  alive = false;
  heading = 0;
  readonly position = new Vector3();
  private inp: AnimInput = { dt: 0, speed: 0, vx: 0, vz: 0, aim: 1, crouch: 0, crouchMove: false, reload: -1, blind: 0, aimAt: null, aimW: 0, hitPitch: 0, hitYaw: 0, recoil: 0 };
  private aimAt = new Vector3();
  private shown = true;
  private reloadT = -1;

  constructor(
    readonly id: number,
    public name: string,
    kind: SkinKind,
    host: MpHost,
    idx: number,
    private claim: (to: number, dmg: number, head: boolean) => void,
  ) {
    this.parts = buildSoldier(host.scene, host.mats, this, 200 + idx);
    this.skin = host.skins.create(kind, this.parts, 200 + idx);
    this.show(false);
  }

  /** your shot hit this body: the server decides what it does (no kill here — returns false) */
  applyHit(damage: number, zone: BodyZone) {
    if (!this.alive) return false;
    this.claim(this.id, damage, zone === "head");
    this.inp.hitPitch = -0.18;
    return false;
  }

  private show(on: boolean) {
    if (on === this.shown) return;
    this.shown = on;
    this.parts.root.setEnabled(on);
    this.skin.root.setEnabled(on);
    for (const h of this.parts.hitboxes) h.isPickable = on;
  }

  update(dt: number, renderT: number) {
    const b = this.buf;
    if (!b.length) return;
    // the pair of snapshots either side of the render time
    while (b.length > 2 && b[1].t <= renderT) b.shift();
    const a = b[0], c = b[1] ?? b[0];
    const k = c.t > a.t ? Math.max(0, Math.min(1, (renderT - a.t) / (c.t - a.t))) : 1;
    const s = k < 1 && a.alive === c.alive ? a : c;
    this.alive = s.alive;
    this.show(s.alive);
    if (!s.alive) return;
    const x = a.x + (c.x - a.x) * k, y = a.y + (c.y - a.y) * k, z = a.z + (c.z - a.z) * k;
    const yaw = a.yaw + wrap(c.yaw - a.yaw) * k;
    const pitch = a.pitch + (c.pitch - a.pitch) * k;
    this.heading = yaw;
    this.position.set(x, y + 0.9, z);
    const root = this.parts.root;
    root.position.set(x, y, z);
    root.rotation.y = yaw;
    root.computeWorldMatrix(true);
    // the body plays the mocap from the network state: speed and direction (body-local), stance, aim
    const vx = a.vx + (c.vx - a.vx) * k, vz = a.vz + (c.vz - a.vz) * k;
    const cy = Math.cos(yaw), sy = Math.sin(yaw);
    const i = this.inp;
    i.dt = dt;
    i.speed = Math.hypot(vx, vz);
    i.vz = vx * sy + vz * cy;
    i.vx = vx * cy - vz * sy;
    i.crouch = s.stance >= 1 ? 1 : 0;
    i.crouchMove = s.stance >= 1 && i.speed > 0.2;
    // (a reload: the clip's progress, kept running while the network says he's reloading)
    if (s.reload) this.reloadT = this.reloadT < 0 ? 0 : Math.min(0.99, this.reloadT + dt / 2.4);
    else this.reloadT = -1;
    i.reload = this.reloadT;
    i.aim = i.speed > 4 ? 0.3 : 1;
    this.aimAt.set(x + sy * Math.cos(pitch) * 10, y + 1.45 - Math.sin(pitch) * 10, z + cy * Math.cos(pitch) * 10);
    i.aimAt = this.aimAt;
    i.aimW = i.aim;
    this.skin.animate(i);
    i.hitPitch *= Math.max(0, 1 - dt * 8);
  }

  dispose() {
    this.show(false);
    this.parts.root.dispose();
    this.skin.root.dispose();
  }
}

export class MpClient {
  private ws: WebSocket | null = null;
  private me = 0;
  private remotes = new Map<number, RemotePlayer>();
  private names = new Map<number, string>();
  private kinds = new Map<number, SkinKind>();
  private scores: ScoreRow[] = [];
  /** server clock − performance.now() (ms), from the snapshots */
  private offset: number | null = null;
  private sendAcc = 0;
  private endsAt = 0;
  private results = false;
  private deadSince = -1;
  private killedBy = "";
  readonly hud: MpHud;
  private spawns: [number, number, number, number][];
  private idx = 0;

  constructor(
    private cfg: MpSettings,
    private h: MpHost,
  ) {
    this.hud = new MpHud();
    this.spawns = spawnPoints(h.nav, h.playerSpawn);
    this.connect();
  }

  get roomCode() {
    return this.hud.room;
  }

  /** attempts since the last good connection (a sleeping free host takes up to a minute to answer) */
  private tries = 0;
  private welcomed = false;
  private t0 = performance.now();

  private connect() {
    let ws: WebSocket;
    try {
      ws = new WebSocket(this.cfg.url);
    } catch {
      this.hud.status("COULD NOT REACH THE SERVER — CHECK THE ADDRESS");
      return;
    }
    this.ws = ws;
    this.hud.status(this.tries === 0 ? "CONNECTING…" : `WAKING UP THE SERVER… ${Math.round((performance.now() - this.t0) / 1000)} S (IT CAN TAKE A MINUTE AFTER A QUIET SPELL)`);
    ws.onopen = () => ws.send(JSON.stringify({ t: "join", room: this.cfg.room, name: this.cfg.name, spawns: this.spawns }));
    ws.onmessage = (e) => this.onMessage(JSON.parse(String(e.data)));
    // (closed before it ever answered: the host is waking — try again; dropped mid-match: rejoin the room)
    ws.onclose = () => {
      if (this.ws !== ws) return;
      const was = this.welcomed;
      this.welcomed = false;
      if (was) {
        this.tries = 0;
        this.t0 = performance.now();
        this.hud.feed("CONNECTION LOST — REJOINING");
        for (const r of this.remotes.values()) r.dispose();
        this.remotes.clear();
      }
      if (++this.tries > 40) return this.hud.status("THE SERVER ISN'T ANSWERING — TRY AGAIN IN A FEW MINUTES");
      setTimeout(() => this.connect(), was ? 500 : 3000);
    };
  }

  private send(m: unknown) {
    if (this.ws?.readyState === 1) this.ws.send(JSON.stringify(m));
  }

  private serverNow() {
    return performance.now() + (this.offset ?? 0);
  }

  private remote(id: number) {
    let r = this.remotes.get(id);
    if (!r && id !== this.me) {
      r = new RemotePlayer(id, this.names.get(id) ?? "?", this.kinds.get(id) ?? "fsb", this.h, this.idx++, (to, dmg, head) => this.send({ t: "hit", to, dmg, head, w: this.h.weapons.weapon.cfg.id }));
      this.remotes.set(id, r);
    }
    return r;
  }

  private onMessage(m: any) {
    switch (m.t) {
      case "welcome": {
        this.welcomed = true;
        this.tries = 0;
        // (a rejoin keeps the room the first join landed in — quick play too)
        this.cfg.room = m.room;
        this.me = m.id;
        this.hud.room = m.room;
        for (const p of m.players) {
          this.names.set(p.id, p.name);
          this.kinds.set(p.id, p.kind);
        }
        this.scores = m.players.map((p: any) => ({ id: p.id, name: p.name, k: p.k, d: p.d }));
        this.endsAt = performance.now() + m.endsIn;
        this.hud.status("");
        this.hud.feed(`JOINED ROOM ${m.room} — SHARE THE CODE WITH YOUR FRIENDS`);
        break;
      }
      case "full":
        this.hud.status(`ROOM ${m.room} IS FULL (8 PLAYERS)`);
        break;
      case "join":
        this.names.set(m.id, m.name);
        this.kinds.set(m.id, m.kind);
        this.scores.push({ id: m.id, name: m.name, k: 0, d: 0 });
        this.hud.feed(`${m.name} JOINED`);
        break;
      case "leave": {
        this.remotes.get(m.id)?.dispose();
        this.remotes.delete(m.id);
        this.hud.feed(`${this.names.get(m.id) ?? "?"} LEFT`);
        this.scores = m.scores;
        break;
      }
      case "snap": {
        const off = m.st - performance.now();
        // (the smallest delay seen is the truest: later snapshots that came slowly don't drag the clock)
        this.offset = this.offset === null ? off : Math.max(this.offset - 0.5, off);
        this.endsAt = m.endsIn > 0 ? performance.now() + m.endsIn : this.endsAt;
        for (const q of m.players) {
          const [id, x, y, z, yaw, pitch, vx, vz, stance, weapon, alive, reload, hp] = q;
          // (your own health is the server's: what it regenerates, what it took)
          if (id === this.me) {
            if (alive && this.h.player.alive) this.h.player.health = Math.max(1, hp);
            continue;
          }
          const r = this.remote(id);
          if (!r) continue;
          r.buf.push({ t: m.st, x, y, z, yaw, pitch, vx, vz, stance, alive: !!alive, weapon, reload });
          if (r.buf.length > 30) r.buf.shift();
        }
        break;
      }
      case "spawn": {
        const P = this.h.player;
        P.reset(new Vector3(m.p[0], m.p[1], m.p[2]), m.yaw);
        P.health = 100;
        this.h.weapons.reset();
        this.deadSince = -1;
        this.hud.dead(null);
        break;
      }
      case "hit": {
        if (m.to === this.me) {
          const P = this.h.player;
          P.netDamage(Math.max(0, P.health - m.hp), new Vector3(m.from[0], m.from[1], m.from[2]));
        }
        break;
      }
      case "kill": {
        this.scores = m.scores;
        const by = m.by === this.me ? "YOU" : this.names.get(m.by) ?? "?";
        const to = m.to === this.me ? "YOU" : this.names.get(m.to) ?? "?";
        const w = (WEAPONS as Record<string, { displayName: string }>)[m.w]?.displayName ?? m.w;
        this.hud.feed(`${by}  [${w}${m.head ? " · HEADSHOT" : ""}]  ${to}`, m.by === this.me ? "mine" : m.to === this.me ? "me" : "");
        if (m.to === this.me) {
          this.killedBy = m.by === this.me ? "YOURSELF" : this.names.get(m.by) ?? "?";
          this.localDeath(true);
        }
        if (m.by === this.me) this.h.audio.play("killConfirm", { volume: 0.4 });
        break;
      }
      case "fire": {
        // someone else's shot: the sound where he is, a tracer along it
        const o = new Vector3(m.o[0], m.o[1], m.o[2]);
        const d = new Vector3(m.d[0], m.d[1], m.d[2]);
        const cfg = (WEAPONS as Record<string, (typeof WEAPONS)[WeaponId]>)[m.w];
        if (cfg) this.h.audio.play(cfg.sounds.fire, { x: o.x, y: o.y, z: o.z, volume: 0.85, pitchVar: 0.03, reverb: 0.4 });
        if (Math.random() < 0.5) this.h.fx.tracer(o, o.add(d.scale(cfg?.damage.range ?? 80)));
        break;
      }
      case "end":
        this.results = true;
        this.scores = m.scores;
        this.hud.results(m.scores, this.me, m.next);
        break;
      case "start":
        this.results = false;
        this.endsAt = performance.now() + m.endsIn;
        this.scores = this.scores.map((s) => ({ ...s, k: 0, d: 0 }));
        this.hud.results(null, this.me, 0);
        this.hud.feed("NEW MATCH — GO");
        break;
    }
  }

  /** your shot, for everyone else to hear and see (the hits themselves come through applyHit) */
  sendFire(origin: Vector3, dir: Vector3, weapon: string) {
    this.send({ t: "fire", o: [+origin.x.toFixed(2), +origin.y.toFixed(2), +origin.z.toFixed(2)], d: [+dir.x.toFixed(3), +dir.y.toFixed(3), +dir.z.toFixed(3)], w: weapon });
  }

  /** the server says you're dead — or you died on your own (a fall): it's told, and counts it */
  localDeath(fromServer = false) {
    const P = this.h.player;
    if (this.deadSince >= 0) return;
    if (!fromServer) this.send({ t: "died" });
    this.deadSince = performance.now();
    P.alive = false;
    P.health = 0;
    this.h.weapons.viewmodel.setActive(null);
    this.hud.dead(this.killedBy || "THE FALL");
    this.killedBy = "";
  }

  update(dt: number) {
    const renderT = this.serverNow() - INTERP_MS;
    for (const r of this.remotes.values()) r.update(dt, renderT);
    // your state, 20 times a second
    this.sendAcc += dt;
    const P = this.h.player;
    if (this.sendAcc >= 1 / SEND_HZ && this.me && P.alive) {
      this.sendAcc = 0;
      const f = P.feet, v = P.velocity, w = this.h.weapons.weapon;
      const st = P.stance;
      this.send({ t: "state", p: [+f.x.toFixed(2), +f.y.toFixed(2), +f.z.toFixed(2)], yaw: +P.yaw.toFixed(3), pitch: +P.pitch.toFixed(3), vx: +v.x.toFixed(2), vz: +v.z.toFixed(2), stance: st === "prone" ? 2 : st === "crouch" ? 1 : 0, w: w.cfg.id, r: w.state === "reloading" ? 1 : 0 });
    }
    // HUD: the clock, the scoreboard while Tab is held, name tags
    const left = Math.max(0, this.endsAt - performance.now());
    this.hud.count = this.scores.length;
    this.hud.clock(this.results ? 0 : left);
    this.hud.board(this.scores, this.me, this.results || this.hud.tabHeld);
    this.hud.tags(
      [...this.remotes.values()].filter((r) => r.alive).map((r) => ({ name: this.names.get(r.id) ?? "?", at: r.position.add(new Vector3(0, 1.15, 0)) })),
      this.h.scene,
      this.h.engine,
    );
    if (this.deadSince >= 0) this.hud.deadCountdown(Math.max(0, 3 - (performance.now() - this.deadSince) / 1000));
  }
}

/**
 * Where players come in: 24 nav nodes spread over the map (farthest-point from the stage's own start),
 * the same list on every client; the server picks, each time, the one farthest from the living.
 */
function spawnPoints(nav: NavGraph, from: Vector3): [number, number, number, number][] {
  const nodes = nav.nodes.filter((n) => n.links.length >= 2);
  if (!nodes.length) return [[from.x, from.y, from.z, 0]];
  const centre = nodes.reduce((a, n) => a.addInPlace(n.p), new Vector3()).scaleInPlace(1 / nodes.length);
  const chosen = [nodes.reduce((a, n) => (Vector3.DistanceSquared(n.p, from) < Vector3.DistanceSquared(a.p, from) ? n : a))];
  while (chosen.length < Math.min(24, nodes.length)) {
    let best = nodes[0], bd = -1;
    for (const n of nodes) {
      let d = Infinity;
      for (const c of chosen) d = Math.min(d, Vector3.DistanceSquared(n.p, c.p));
      if (d > bd) (bd = d), (best = n);
    }
    chosen.push(best);
  }
  return chosen.map((n) => [+n.p.x.toFixed(2), +n.p.y.toFixed(2), +n.p.z.toFixed(2), +Math.atan2(centre.x - n.p.x, centre.z - n.p.z).toFixed(3)]);
}
