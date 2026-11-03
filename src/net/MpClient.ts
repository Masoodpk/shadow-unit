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
import { Spring } from "../core/math";
import { RAGDOLL } from "../enemies/EnemyConfig";

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
 *   - Team deathmatch: your side is always BLUE to you and the other RED (as in Call of Duty); teammates
 *     wear one uniform, the foes the other, have a blue name and chevron over them (through walls) and
 *     an arrow on your radar; foes are on neither — a red name only while you can see them. Your shots
 *     pass through teammates (no friendly fire).
 *   - Rewards: the server names each kill's medals (HEADSHOT, DOUBLE KILL, KILLING SPREE, LONGSHOT…) and
 *     the killer's screen shows them as animated badges with their points.
 */

export type MpMode = "ffa" | "tdm";

export interface MpSettings {
  /** ws:// or wss:// address of the server */
  url: string;
  /** room code to join; empty: quick play (any open room) */
  room: string;
  name: string;
  /** the map this game loaded (a room is on one map: the server says if it's another) */
  stage: string;
  /** the room is on another map: load that one and join again */
  onOtherStage?(room: string, stage: string): void;
  /** match length (minutes) for a room this join creates */
  mins?: number;
  /** free-for-all or team deathmatch, for a room this join creates (and what quick play looks for) */
  mode?: MpMode;
  /** the room changed (host, phase, length): the pause menu shows the host's controls */
  onRoom?(r: RoomState): void;
}

/** what the room is doing, for the menus */
export interface RoomState {
  phase: "lobby" | "countdown" | "playing" | "results";
  /** you start matches here */
  host: boolean;
  hostName: string;
  mins: number;
  /** quick play: starts by itself */
  open: boolean;
  players: number;
  mode: MpMode;
  /** team deathmatch: your side (0 or 1); -1 in free-for-all or not on one yet */
  team: number;
  /** the two sides' names (the host names them in a friends' room) */
  teamNames: string[];
  /** everyone in the room, in the order they came in, with their side (-1: none yet) */
  list: { id: number; name: string; team: number; host: boolean; me: boolean }[];
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
  /** in play (the server's word, at the render time) */
  live = false;
  /** on your side (team deathmatch): drawn and tagged, but never a target */
  friendly = false;
  /** what the weapons ask before a hit: a live foe (teammates let your shots and blows through) */
  get alive() {
    return this.live && !this.friendly;
  }
  heading = 0;
  readonly position = new Vector3();
  private inp: AnimInput = { dt: 0, speed: 0, vx: 0, vz: 0, aim: 1, crouch: 0, crouchMove: false, reload: -1, blind: 0, aimAt: null, aimW: 0, hitPitch: 0, hitYaw: 0, recoil: 0, slide: -1 };
  private aimAt = new Vector3();
  private shown = true;
  private reloadT = -1;
  /** sliding (stance 3): seconds since he went down, or -1 */
  private slideT = -1;
  /** dead: the body falls (the soldiers' Havok ragdoll) and lies there until he's back */
  private dying = false;
  /** where the killing shot came from (the body falls away from it) */
  killFrom: Vector3 | null = null;
  private lastVel = new Vector3();
  /** his shots: the muzzle flash on his gun, the kick through his arms */
  private flashT = 0;
  private kick = new Spring(300, 22);

  constructor(
    readonly id: number,
    public name: string,
    host: MpHost,
    idx: number,
    private claim: (to: number, dmg: number, head: boolean, melee: boolean) => void,
    readonly kind: SkinKind,
  ) {
    this.parts = buildSoldier(host.scene, host.mats, this, 200 + idx);
    this.skin = host.skins.create(this.kind, this.parts, 200 + idx);
    this.slot = 1000 + idx;
    this.show(false);
  }
  private slot: number;

  /** he fired: a flash at his muzzle and a kick (returns the muzzle, for the tracer) */
  fired(): Vector3 | null {
    if (!this.live || !this.shown) return null;
    const f = this.parts.flash;
    f.setEnabled(true);
    f.rotation.z = Math.random() * 6.28;
    this.flashT = 0.05;
    this.kick.impulse(-3);
    this.parts.muzzle.computeWorldMatrix(true);
    return this.parts.muzzle.getAbsolutePosition().clone();
  }

  /** the body goes down: physics from the pose it's in, pushed away from the shooter */
  private fall() {
    this.dying = true;
    this.parts.flash.setEnabled(false);
    for (const h of this.parts.hitboxes) h.isPickable = false;
    let hit = null;
    if (this.killFrom) {
      const dir = this.position.subtract(this.killFrom);
      dir.y = Math.max(0.02, dir.y);
      dir.normalize();
      hit = { point: this.position.clone(), impulse: dir.scale(30 * RAGDOLL.bulletPerDamage), part: "torso" as const };
    }
    try {
      this.skin.startRagdoll(this.slot, this.lastVel, hit);
    } catch {
      // (no physics: he just goes)
      this.show(false);
    }
    this.killFrom = null;
  }

  /** your shot hit this body: the server decides what it does (no kill here — returns false) */
  applyHit(damage: number, zone: BodyZone, _dir?: Vector3, _point?: Vector3, info?: { kind: string }) {
    if (!this.alive) return false;
    this.claim(this.id, damage, zone === "head", info?.kind === "melee");
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
    const was = this.live;
    this.live = s.alive;
    if (!s.alive) {
      // (killed while you watched: he falls and lies there until he respawns; dead when you came in: unseen)
      if (was && this.shown && !this.dying) this.fall();
      if (this.dying) this.skin.updateRagdoll(dt);
      return;
    }
    if (this.dying) {
      // back from the dead (a respawn, somewhere else): the body is his again
      this.dying = false;
      this.skin.enterAnim();
    }
    this.show(true);
    for (const h of this.parts.hitboxes) h.isPickable = true;
    if (this.flashT > 0 && (this.flashT -= dt) <= 0) this.parts.flash.setEnabled(false);
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
    this.lastVel.set(vx, 0, vz);
    const cy = Math.cos(yaw), sy = Math.sin(yaw);
    const i = this.inp;
    i.dt = dt;
    i.speed = Math.hypot(vx, vz);
    i.vz = vx * sy + vz * cy;
    i.vx = vx * cy - vz * sy;
    // (stance 3: a slide — the slide clip, legs and hips, his arms still on the rifle; it plays on his own
    // clock from the first sample that says so, and fades out when the samples stop saying so)
    const sliding = s.stance === 3;
    this.slideT = sliding ? (this.slideT < 0 ? 0 : this.slideT + dt) : -1;
    i.slide = this.slideT;
    i.crouch = s.stance === 1 || s.stance === 2 ? 1 : 0;
    i.crouchMove = i.crouch > 0 && i.speed > 0.2;
    // (a reload: the clip's progress, kept running while the network says he's reloading)
    if (s.reload) this.reloadT = this.reloadT < 0 ? 0 : Math.min(0.99, this.reloadT + dt / 2.4);
    else this.reloadT = -1;
    i.reload = this.reloadT;
    i.aim = i.speed > 4 && !sliding ? 0.3 : 1;
    // (along his view from his eye — low on a slide, lower still prone — so his muzzle follows his shots)
    const eye = sliding ? 0.78 : s.stance === 1 ? 1.08 : s.stance === 2 ? 0.4 : 1.45;
    this.aimAt.set(x + sy * Math.cos(pitch) * 10, y + eye - Math.sin(pitch) * 10, z + cy * Math.cos(pitch) * 10);
    i.aimAt = this.aimAt;
    i.aimW = i.aim;
    i.recoil = this.kick.update(dt) * 0.02;
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
  /** team deathmatch: each player's side */
  private teams = new Map<number, number>();
  private mode: MpMode = "ffa";
  /** the sides' names (the colours are relative: yours is always blue on your screen) */
  private teamNames = ["ALPHA", "BRAVO"];
  /** the two sides' kills (team deathmatch) */
  private teamKills: [number, number] = [0, 0];
  private scores: ScoreRow[] = [];
  /** server clock − performance.now() (ms), from the snapshots */
  private offset: number | null = null;
  private sendAcc = 0;
  private endsAt = 0;
  private phase: RoomState["phase"] = "lobby";
  private hostId = 0;
  private mins = 5;
  private open = false;
  /** performance.now() when the countdown ends / quick play starts by itself */
  private startsAt = 0;
  private autoAt = 0;
  private deadSince = -1;
  private killedBy = "";
  readonly hud: MpHud;
  private spawns: [number, number, number, number][];
  private idx = 0;
  /** foes in plain sight (re-checked 10 times a second, for their name tags) */
  private seen = new Map<number, boolean>();
  private losAcc = 0;

  constructor(
    private cfg: MpSettings,
    private h: MpHost,
  ) {
    this.hud = new MpHud();
    this.spawns = spawnPoints(h.nav, h.playerSpawn);
    this.connect();
    // (closing the tab or leaving: out of the room at once, not after the server notices)
    addEventListener("pagehide", () => this.ws?.close());
    // the host starts the match with ENTER (in the waiting room, and again after the results)
    addEventListener("keydown", (e) => {
      if (e.code === "Enter" && !this.paused && this.isHost && (this.phase === "lobby" || this.phase === "results")) this.startMatch();
    });
  }

  get roomCode() {
    return this.hud.room;
  }
  get isHost() {
    return !!this.me && this.hostId === this.me;
  }
  get room(): RoomState {
    const list = [...this.scores].sort((a, b) => a.id - b.id).map((r) => ({ id: r.id, name: r.name, team: this.teams.get(r.id) ?? -1, host: r.id === this.hostId, me: r.id === this.me }));
    return { phase: this.phase, host: this.isHost, hostName: this.names.get(this.hostId) ?? "", mins: this.mins, open: this.open, players: this.scores.length, mode: this.mode, team: this.myTeam, teamNames: [...this.teamNames], list };
  }
  /** your side (team deathmatch), -1 in free-for-all */
  get myTeam() {
    return this.mode === "tdm" ? this.teams.get(this.me) ?? -1 : -1;
  }
  /** is this player on your side */
  private mate(id: number) {
    return this.mode === "tdm" && this.myTeam >= 0 && id !== this.me && this.teams.get(id) === this.myTeam;
  }
  /** the host (a friends' room, between matches): put a player on a side (0 / 1), or off them (-1) */
  assignTeam(id: number, team: number) {
    if (this.isHost) this.send({ t: "team", id, team });
  }
  /** the host (a friends' room): a side's name */
  setTeamName(team: number, name: string) {
    if (this.isHost) this.send({ t: "teamName", team, name });
  }
  /** the host, between matches: free-for-all or team deathmatch */
  setMode(mode: MpMode) {
    if (this.isHost) this.send({ t: "mode", mode });
  }
  /** quick play's team match, between matches: over to the other side (if it's the smaller) */
  switchTeam() {
    this.send({ t: "team" });
  }
  /** your teammates for the radar and the map: a blue arrow with the name's first letter */
  radarMarks() {
    const out: { pos: Vector3; heading: number; color: string; label: string }[] = [];
    for (const r of this.remotes.values()) if (r.friendly && r.live) out.push({ pos: r.position, heading: r.heading, color: MATE, label: (this.names.get(r.id) ?? "?").charAt(0) });
    return out;
  }
  /** where the live foes are (the knife lunges at them) */
  foePositions() {
    return [...this.remotes.values()].filter((r) => r.alive).map((r) => r.position);
  }
  /** the host: start the match (from the waiting room or the results) */
  startMatch() {
    if (this.isHost) this.send({ t: "start" });
  }
  /** the host: the match length, in minutes (5, 8, 10, 12 or 15) */
  setMins(mins: number) {
    if (this.isHost) this.send({ t: "mins", mins });
  }

  /** attempts since the last good connection (a sleeping free host takes up to a minute to answer) */
  private tries = 0;
  private welcomed = false;
  private t0 = performance.now();

  /** this browser joined again somewhere else (another tab): this one stays out */
  private replaced = false;
  private paused = false;

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
    ws.onopen = () => ws.send(JSON.stringify({ t: "join", room: this.cfg.room, name: this.cfg.name, stage: this.cfg.stage, mins: this.cfg.mins, cid: clientId(), spawns: this.spawns, mode: this.cfg.mode ?? "ffa" }));
    ws.onmessage = (e) => this.onMessage(JSON.parse(String(e.data)));
    // (closed before it ever answered: the host is waking — try again; dropped mid-match: rejoin the room)
    ws.onclose = () => {
      if (this.ws !== ws || this.replaced) return;
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

  private remote(id: number): RemotePlayer | undefined {
    let r = this.remotes.get(id);
    const kind = this.kinds.get(id) ?? "fsb";
    // (his uniform changed — he went over to the other side: a new body, the old one's samples)
    if (r && r.kind !== kind) {
      const buf = r.buf;
      r.dispose();
      this.remotes.delete(id);
      r = this.remote(id);
      r?.buf.push(...buf);
      return r;
    }
    if (!r && id !== this.me) {
      r = new RemotePlayer(id, this.names.get(id) ?? "?", this.h, this.idx++, (to, dmg, head, mel) => this.send({ t: "hit", to, dmg, head, mel: mel ? 1 : 0, w: this.h.weapons.weapon.cfg.id }), kind);
      this.remotes.set(id, r);
    }
    if (r) r.friendly = this.mate(id);
    return r;
  }

  /** who's who (welcome, roster): names, uniforms, sides */
  private setRoster(mode: MpMode, players: { id: number; name: string; kind: SkinKind; team: number; k: number; d: number }[]) {
    const was = this.myTeam;
    this.mode = mode === "tdm" ? "tdm" : "ffa";
    for (const p of players) {
      this.names.set(p.id, p.name);
      this.kinds.set(p.id, p.kind);
      this.teams.set(p.id, p.team);
    }
    this.scores = players.map((p) => ({ id: p.id, name: p.name, k: p.k, d: p.d, team: p.team }));
    for (const id of [...this.remotes.keys()]) this.remote(id);
    const now = this.myTeam;
    if (now >= 0 && now !== was) this.hud.feed(`YOU'RE ON TEAM ${this.teamNames[now]}`, "mine");
    else if (this.mode === "tdm" && now < 0 && was >= 0) this.hud.feed("YOU'RE OFF YOUR TEAM — THE HOST WILL PUT YOU ON ONE");
    this.updateTeams();
  }

  /** the objective line under the radar: the room's mode */
  private showMode() {
    const o = document.getElementById("obj-text");
    if (o) o.textContent = this.mode !== "tdm" ? "DEATHMATCH · MOST KILLS WINS" : this.myTeam < 0 ? "TEAM DEATHMATCH · WAITING FOR THE HOST TO PUT YOU ON A TEAM" : `TEAM DEATHMATCH · YOU'RE ${this.teamNames[this.myTeam]} · MOST TEAM KILLS WINS`;
    this.hud.tdm = this.mode === "tdm";
    this.hud.teamNames = this.teamNames;
  }

  private updateTeams() {
    this.showMode();
    if (this.mode !== "tdm") return (this.teamKills = [0, 0]);
    const t: [number, number] = [0, 0];
    for (const r of this.scores) if (r.team === 0 || r.team === 1) t[r.team] += r.k;
    this.teamKills = t;
  }

  /** a name in the feed, in its side's colour to you (blue: yours, red: theirs) */
  private who(id: number) {
    return id === this.me ? "YOU" : this.names.get(id) ?? "?";
  }

  private onMessage(m: any) {
    this.handle(m);
    if (this.paused && (m.t === "join" || m.t === "leave" || m.t === "kill" || m.t === "end" || m.t === "start" || m.t === "room" || m.t === "roster")) this.refreshBoard();
    if (m.t === "room" || m.t === "join" || m.t === "leave" || m.t === "welcome" || m.t === "roster") this.cfg.onRoom?.(this.room);
  }

  private handle(m: any) {
    switch (m.t) {
      case "welcome": {
        this.welcomed = true;
        this.tries = 0;
        // (a rejoin keeps the room the first join landed in — quick play too)
        this.cfg.room = m.room;
        this.me = m.id;
        this.hud.room = m.room;
        this.setRoster(m.mode, m.players);
        this.hud.status("");
        this.hud.feed(`JOINED ROOM ${m.room}`);
        break;
      }
      case "room": {
        const was = this.phase;
        this.phase = m.phase;
        this.hostId = m.host;
        this.mins = m.mins;
        this.open = !!m.open;
        if (Array.isArray(m.teamNames) && m.teamNames.join() !== this.teamNames.join()) {
          this.teamNames = m.teamNames.map(String);
          this.updateTeams();
        }
        if (m.mode && m.mode !== this.mode) {
          this.mode = m.mode;
          this.hud.feed(m.mode === "tdm" ? "MODE: TEAM DEATHMATCH" : "MODE: FREE-FOR-ALL", "mine");
          this.updateTeams();
        }
        const t = performance.now();
        if (m.phase === "playing") this.endsAt = t + m.endsIn;
        this.startsAt = m.phase === "countdown" ? t + m.startsIn : 0;
        this.autoAt = m.autoIn > 0 ? t + m.autoIn : 0;
        if (m.phase === "playing" && was === "countdown") {
          const t = this.myTeam;
          this.hud.feed(t >= 0 ? `GO! — TEAM ${this.teamNames[t]}: MOST KILLS WINS` : "GO! — MOST KILLS WINS", "mine");
          this.hud.banner(t >= 0 ? `TEAM ${this.teamNames[t]}` : "FREE-FOR-ALL", t >= 0 ? "ELIMINATE THE RED TEAM" : "EVERYONE IS YOUR ENEMY");
        }
        // (results up only while the room is on them: a rejoin mid-match shows none)
        if (m.phase !== "results") {
          this.hud.results(null);
        }
        break;
      }
      case "stage":
        // (stop here: the page reloads onto the room's map)
        this.replaced = true;
        this.hud.status("THIS ROOM IS ON ANOTHER MAP — LOADING IT…");
        this.cfg.onOtherStage?.(m.room, m.stage);
        break;
      case "replaced":
        this.replaced = true;
        this.hud.status("YOU JOINED FROM ANOTHER TAB OR WINDOW — THIS ONE IS DISCONNECTED");
        break;
      case "roster":
        this.setRoster(m.mode, m.players);
        break;
      case "noStart":
        this.hud.feed(`PUT EVERYONE ON A TEAM FIRST — ${(m.names as string[]).join(", ")} ${m.names.length === 1 ? "HASN'T" : "HAVEN'T"} GOT ONE (ESC → TEAMS)`, "me");
        break;
      case "teamFull":
        this.hud.feed("THE OTHER TEAM IS FULL — QUICK PLAY KEEPS THE TEAMS EVEN", "me");
        break;
      case "full":
        this.hud.status(`ROOM ${m.room} IS FULL (8 PLAYERS)`);
        break;
      case "join":
        this.names.set(m.id, m.name);
        this.kinds.set(m.id, m.kind);
        this.teams.set(m.id, m.team);
        this.scores.push({ id: m.id, name: m.name, k: 0, d: 0, team: m.team });
        this.hud.feed(this.mode !== "tdm" ? `${m.name} JOINED` : m.team < 0 ? `${m.name} JOINED — NO TEAM YET` : `${m.name} JOINED ${this.mate(m.id) ? "YOUR TEAM" : "THE ENEMY"}`, this.mate(m.id) ? "mate" : "");
        break;
      case "leave": {
        this.remotes.get(m.id)?.dispose();
        this.remotes.delete(m.id);
        this.hud.feed(`${this.names.get(m.id) ?? "?"} LEFT`);
        this.scores = m.scores;
        this.updateTeams();
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
        this.updateTeams();
        // (another player down: his body falls away from whoever shot him)
        const victim = this.remotes.get(m.to);
        if (victim && m.by !== m.to) victim.killFrom = m.by === this.me ? this.h.player.camera.globalPosition.clone() : this.remotes.get(m.by)?.position.clone() ?? null;
        const w = m.w === "melee" ? "MELEE" : (WEAPONS as Record<string, { displayName: string }>)[m.w]?.displayName ?? m.w;
        const side = (id: number) => (this.mode !== "tdm" ? "" : id === this.me || this.mate(id) ? "mate" : "foe");
        this.hud.killFeed(this.who(m.by), side(m.by), `${w}${m.head ? " · HEADSHOT" : ""}`, this.who(m.to), side(m.to), m.by === this.me ? "mine" : m.to === this.me ? "me" : "");
        // the rewards: yours as badges in the middle of the screen; anyone's big streak in the feed
        const medals: string[] = m.medals ?? [];
        if (m.by === this.me && m.by !== m.to) {
          this.hud.medals(medals, m.pts ?? 100);
          if (medals.some((n) => n !== "HEADSHOT" && n !== "POINT BLANK")) this.h.audio.play("killConfirm", { volume: 0.55, rate: 1.35 });
        } else if (m.by !== m.to) {
          const big = medals.find((n) => BIG.includes(n));
          if (big) this.hud.feed(`${this.who(m.by)} — ${big}!`, side(m.by) || "");
          if (m.shut >= 3) this.hud.feed(`${this.who(m.by)} ENDED ${this.who(m.to)}'S STREAK`, side(m.by) || "");
        }
        if ((m.assists ?? []).includes(this.me)) this.hud.medals(["ASSIST"], 50);
        if (m.to === this.me) {
          this.killedBy = m.by === this.me ? "YOURSELF" : this.names.get(m.by) ?? "?";
          this.localDeath(true);
        }
        if (m.by === this.me) this.h.audio.play("killConfirm", { volume: 0.4 });
        break;
      }
      case "fire": {
        // someone else's shot: the flash on his gun and a kick through his arms, the sound where he is,
        // and a tracer every round from his muzzle along his aim (to the first wall it meets)
        const o = new Vector3(m.o[0], m.o[1], m.o[2]);
        const d = new Vector3(m.d[0], m.d[1], m.d[2]).normalize();
        const cfg = (WEAPONS as Record<string, (typeof WEAPONS)[WeaponId]>)[m.w];
        const from = this.remotes.get(m.id)?.fired() ?? o;
        if (cfg) this.h.audio.play(cfg.sounds.fire, { x: o.x, y: o.y, z: o.z, volume: 0.9, pitchVar: 0.03, reverb: 0.4 });
        const range = cfg?.damage.range ?? 80;
        const wall = this.h.nav.rayLevel(o, o.add(d.scale(range)));
        this.h.fx.tracer(from, o.add(d.scale(wall != null && wall > 0 ? wall : range)));
        break;
      }
      case "end":
        this.scores = m.scores;
        this.updateTeams();
        this.hud.results(m.scores, m.mode === "tdm" ? this.myTeam : -1);
        break;
      case "start":
        this.scores = m.scores;
        this.updateTeams();
        this.hud.results(null);
        this.hud.feed("MATCH STARTING");
        break;
    }
  }

  /** the scoreboard: at the results, while Tab is held, while you're dead, and beside the pause menu */
  private refreshBoard() {
    this.hud.count = this.scores.length;
    const lobby = this.phase === "lobby";
    const mode = this.paused ? "paused" : this.hud.tabHeld ? "tab" : this.deadSince >= 0 ? "dead" : lobby ? "lobby" : "off";
    this.hud.board(this.scores, this.me, mode, this.nextNote(), lobby || this.phase === "countdown" ? `${this.mins} MIN · ${this.mode === "tdm" ? "TEAMS" : "FREE-FOR-ALL"}` : "", this.myTeam);
  }

  /** what happens next, and who does it (under the board in the waiting room and at the results) */
  private nextNote() {
    if (this.phase !== "lobby" && this.phase !== "results") return "";
    const again = this.phase === "results";
    const auto = this.autoAt ? Math.max(0, Math.ceil((this.autoAt - performance.now()) / 1000)) : 0;
    if (this.open) return auto ? `${again ? "NEXT MATCH" : "MATCH STARTS"} BY ITSELF IN ${auto} S` : "WAITING FOR ANOTHER PLAYER TO JOIN…";
    const touch = matchMedia("(pointer: coarse)").matches;
    const host = this.names.get(this.hostId) ?? "THE HOST";
    if (this.mode === "tdm") {
      const loose = this.scores.filter((r) => (this.teams.get(r.id) ?? -1) < 0).length;
      if (this.isHost)
        return loose
          ? `YOU PICK THE TEAMS · ${touch ? "PAUSE (‖)" : "ESC"} → TEAMS: PUT ${loose === 1 ? "THE 1 PLAYER" : `ALL ${loose} PLAYERS`} WITHOUT A TEAM ON ONE, THEN START`
          : `TEAMS READY · ${touch ? "PAUSE (‖) →" : "PRESS ENTER TO"} ${again ? "PLAY AGAIN" : "START"} · ${touch ? "" : "ESC → "}TEAMS TO CHANGE THEM`;
      return `${host} PICKS THE TEAMS AND STARTS THE MATCH · ${touch ? "PAUSE (‖)" : "ESC"} → EXIT ROOM TO LEAVE`;
    }
    if (this.isHost)
      return touch
        ? `YOU'RE THE HOST · PAUSE (‖) → ${again ? "PLAY AGAIN" : "START MATCH"} WHEN EVERYONE'S IN · OR EXIT ROOM`
        : `YOU'RE THE HOST · PRESS ENTER TO ${again ? "PLAY AGAIN" : "START"} WHEN EVERYONE'S IN · ESC FOR MATCH LENGTH${again ? " OR EXIT ROOM" : ""}`;
    return `WAITING FOR ${host} TO ${again ? "PLAY AGAIN" : "START THE MATCH"} · ${touch ? "PAUSE (‖)" : "ESC"} → EXIT ROOM TO LEAVE`;
  }

  /** the game paused / resumed (frames stop while paused: the board is drawn from here, and on news) */
  setPaused(on: boolean) {
    this.paused = on;
    document.body.classList.toggle("mp-paused", on);
    this.refreshBoard();
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
      this.send({ t: "state", p: [+f.x.toFixed(2), +f.y.toFixed(2), +f.z.toFixed(2)], yaw: +P.yaw.toFixed(3), pitch: +P.pitch.toFixed(3), vx: +v.x.toFixed(2), vz: +v.z.toFixed(2), stance: P.sliding ? 3 : st === "prone" ? 2 : st === "crouch" ? 1 : 0, w: w.cfg.id, r: w.state === "reloading" ? 1 : 0 });
    }
    // HUD: the clock, the scoreboard while Tab is held, name tags
    const now = performance.now();
    const left = Math.max(0, this.endsAt - now);
    this.hud.count = this.scores.length;
    this.hud.clock(left, this.phase === "lobby" ? "WAITING ROOM" : this.phase === "countdown" ? "GET READY" : this.phase === "results" ? "MATCH OVER" : "");
    this.hud.countdown(this.phase === "countdown" ? Math.max(1, Math.ceil((this.startsAt - now) / 1000)) : 0);
    this.hud.teamBar(this.mode === "tdm" && this.myTeam >= 0 ? { mine: this.teamKills[this.myTeam], theirs: this.teamKills[1 - this.myTeam], name: this.teamNames[this.myTeam], other: this.teamNames[1 - this.myTeam] } : null);
    this.refreshBoard();
    // names over heads: teammates' always (blue, with a chevron, through walls); foes' only in plain sight
    this.losAcc -= dt;
    const recheck = this.losAcc <= 0;
    if (recheck) this.losAcc = 0.1;
    const eye = this.h.player.camera.globalPosition;
    const tags: { name: string; at: Vector3; mate: boolean }[] = [];
    for (const r of this.remotes.values()) {
      if (!r.live) continue;
      const at = r.position.add(TAG_UP);
      if (!r.friendly) {
        if (recheck) {
          const d = Vector3.Distance(eye, at);
          this.seen.set(r.id, d < 45 && this.h.nav.clear(eye, at));
        }
        if (!this.seen.get(r.id)) continue;
      }
      tags.push({ name: this.names.get(r.id) ?? "?", at, mate: r.friendly });
    }
    this.hud.tags(tags, this.h.scene, this.h.engine);
    if (this.deadSince >= 0) this.hud.deadCountdown(Math.max(0, 4 - (performance.now() - this.deadSince) / 1000));
  }
}

/** the colour of your side, on the radar and over their heads */
const MATE = "#4fa8ff";
const TAG_UP = new Vector3(0, 1.15, 0);
/** the medals worth telling everyone about (in the kill feed) */
const BIG = ["MEGA KILL", "RAMPAGE", "DOMINATING", "UNSTOPPABLE", "GODLIKE", "QUAD KILL", "TRIPLE KILL"];

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

/** this browser's own id (kept), so a reload or a second tab replaces its player instead of adding one */
function clientId(): string {
  const q = new URLSearchParams(location.search).get("cid");
  if (q) return q;
  try {
    let id = localStorage.getItem("su.mpcid");
    if (!id) {
      id = Math.random().toString(36).slice(2) + Date.now().toString(36);
      localStorage.setItem("su.mpcid", id);
    }
    return id;
  } catch {
    return "";
  }
}
