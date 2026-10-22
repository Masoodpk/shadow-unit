import { FreeCamera } from "@babylonjs/core/Cameras/freeCamera";
import { Vector3 } from "@babylonjs/core/Maths/math.vector";
import { AudioEngine } from "../audio/AudioEngine";
import { Enemy } from "../enemies/Enemy";
import { EnemyManager } from "../enemies/EnemyManager";
import { NavGraph } from "../level/NavGraph";
import { METRO } from "../level/Metro";
import { MissionHud } from "../ui/MissionHud";
import { Shot, ShotPlayer } from "./Shots";

/**
 * OPERATION UNDERGROUND — after Frostline: the tape named the man behind the convoy ambush, the
 * Winter Soldier, and he's gone to ground in a closed metro station (Roscoe Street).
 *   INSERTION → down the platforms from the west end, the deep corridor where he waits, then your eyes
 *               on the mezzanine over the east end.
 *   PLATFORMS → clear the platform level (its soldiers are up from the start).
 *   CONCOURSE → the rooms south of the platforms (they wake as you reach them).
 *   DEEP      → down to the deep platform (it wakes, and his guard in the service corridor with it).
 *   BOSS      → near his post at the corridor's dead end: a reveal — and the Winter Soldier comes for
 *               you like any of his men, with a health bar of his own. He goes down: MISSION COMPLETE.
 */

export interface MetroHost {
  scene: import("@babylonjs/core/scene").Scene;
  camera: FreeCamera;
  player: { feet: Vector3; yaw: number; alive: boolean };
  enemies: EnemyManager;
  nav: NavGraph;
  audio: AudioEngine;
  showHud(on: boolean): void;
  showWeapon(on: boolean): void;
  setObjective(text: string): void;
  setTimeScale(k: number): void;
  flash(text: string): void;
  finish(won: boolean, title: string, kicker: string): void;
}

type Phase = "platforms" | "concourse" | "deep" | "boss" | "ending" | "done";

const V = (x: number, y: number, z: number) => new Vector3(x, y, z);

export class MetroMission {
  readonly hud = new MissionHud();
  /** no USE prompts on this one */
  prompt: string | null = null;
  /** no checkpoints on this one */
  readonly save = null;
  readonly knowsWhere = true;
  phase: Phase = "platforms";
  private started = false;
  private shots: ShotPlayer;
  private later: { t: number; fn: () => void }[] = [];
  private after(t: number, fn: () => void) {
    this.later.push({ t, fn });
  }

  constructor(private host: MetroHost) {
    this.shots = new ShotPlayer(host.camera, {
      begin: () => {
        host.showHud(false);
        host.showWeapon(false);
        this.hud.letterbox(true, false);
      },
      end: () => {
        this.hud.letterbox(false, false);
        if (this.phase !== "done") {
          host.showHud(true);
          host.showWeapon(true);
        }
      },
      say: (who, text, dur) => this.hud.say(who, text, dur),
    });
    // (the boss's moods, as his health goes: the bar's tint and a line from him)
    host.enemies.onBossPhase = (_e, phase) => {
      this.hud.bossMood(phase === 1 ? "PRESSED" : "ENRAGED", phase);
      this.hud.say("WINTER SOLDIER", phase === 1 ? "You're good. They told me you would be." : "Enough. I end this now.", 3);
    };
  }

  get cinematic() {
    return this.shots.active;
  }
  get freezeHostiles() {
    return this.cinematic || this.phase === "done";
  }
  private get boss() {
    return this.host.enemies.boss;
  }

  /** where the HUD and the radar point */
  get marker(): { pos: Vector3; label: string } | null {
    switch (this.phase) {
      case "platforms": {
        const left = this.stragglers("platforms");
        if (left) return left;
        return { pos: METRO.concourse.add(V(0, 1.5, 0)), label: "CONCOURSE" };
      }
      case "concourse":
        return this.stragglers("concourse") ?? { pos: METRO.boss.add(V(0, 1.8, 0)), label: "DEEP LEVEL" };
      case "deep":
        return { pos: METRO.boss.add(V(0, 1.8, 0)), label: "WINTER SOLDIER'S POST" };
      case "boss": {
        const b = this.boss;
        return b && b.alive ? { pos: b.position.add(V(0, 1.4, 0)), label: "WINTER SOLDIER" } : null;
      }
      default:
        return null;
    }
  }

  /** the last one or two of a group, marked (one holed up somewhere can't hold you up) */
  private stragglers(group: string) {
    const h = this.host;
    const left = h.enemies.enemies.filter((e) => e.alive && !e.dormant && e.spawn.group === group);
    if (!left.length || left.length > 2) return null;
    const me = h.player.feet;
    const e = left.reduce((a, b) => (Vector3.DistanceSquared(a.collider.position, me) < Vector3.DistanceSquared(b.collider.position, me) ? a : b));
    return { pos: e.collider.position.add(V(0, 1.2, 0)), label: "HOSTILE" };
  }

  start() {
    if (!this.started) this.reset();
  }

  reset() {
    const h = this.host;
    this.started = true;
    this.shots.stop();
    this.later = [];
    this.prompt = null;
    this.hud.reset();
    this.hud.bossHide();
    h.setTimeScale(1);
    h.showHud(true);
    h.showWeapon(true);
    this.phase = "platforms";
    this.objective();
    this.intro();
  }

  resume() {
    this.reset();
  }

  // ------------------------------------------------------------------ insertion
  /** the station: down the platforms, the deep corridor where he waits — and into your eyes */
  private intro() {
    const h = this.host;
    const me = h.player.feet;
    const eye = me.add(V(0, 1.62, 0));
    const ahead = V(Math.sin(h.player.yaw), 0, Math.cos(h.player.yaw));
    const shots: Shot[] = [
      {
        // along the platforms from the west end: the boarded tunnels, the tiles, nobody about
        dur: 6.5,
        from: V(-24, 1.2, -9),
        to: V(-8, 0.9, -9),
        look: () => V(20, -0.5, -8),
        fov: 0.95,
        sub: ["COMMAND", "Operator, listen up. The Ambassador's tape names the leak: the Winter Soldier. He sold our nuclear secrets — and he's hiding here, in Roscoe Street station."],
      },
      {
        // the deep service corridor: his post at its dead end
        dur: 5,
        from: V(40, -6.6, -39.7),
        to: V(50, -6.8, -39.7),
        look: () => METRO.boss.add(V(0, 1.2, 0)),
        fov: 0.8,
        // (there he is, at his post — asleep again once the shot's over: he wakes when you get there)
        enter: () => this.boss?.wake(),
        sub: ["COMMAND", "Deep level, end of the service corridor. That's him. Every floor between you and him is held by his men."],
      },
      {
        // into your eyes on the mezzanine
        dur: 5,
        from: eye.add(ahead.scale(-1.5)).addInPlaceFromFloats(0, 0.6, 0),
        to: eye,
        look: () => eye.add(ahead.scale(10)).addInPlaceFromFloats(0, -1.5, 0),
        fov: 0.85,
        enter: () => this.boss?.sleep(),
        sub: ["COMMAND", "Your orders: kill the Winter Soldier. No arrest, no deal — the leak ends with him. Platforms first."],
      },
    ];
    this.shots.play(shots, () => {
      this.hud.card("OPERATION UNDERGROUND", "Target: the Winter Soldier · nuclear secrets leak<br>Orders: find him and kill him", 6);
      this.host.audio.play("radioChirp", { volume: 0.6 });
    });
  }

  private objective() {
    const h = this.host;
    const n = h.enemies.enemies.filter((e) => e.alive && !e.dormant && e.spawn.group === "platforms").length;
    h.setObjective(
      this.phase === "platforms"
        ? n > 0 ? `CLEAR THE PLATFORMS · ${n} LEFT` : "HEAD FOR THE CONCOURSE"
        : this.phase === "concourse"
          ? "FIGHT THROUGH THE CONCOURSE — THEN DOWN"
          : this.phase === "deep"
            ? "FIND AND KILL THE WINTER SOLDIER"
            : this.phase === "boss"
              ? "KILL THE WINTER SOLDIER"
              : "WINTER SOLDIER DOWN",
    );
  }

  onKilled(e: Enemy) {
    if (e.boss && this.phase === "boss") return this.ending(e);
    this.objective();
  }

  update(_dt: number, rawDt: number) {
    const h = this.host;
    if (!this.cinematic)
      for (let i = this.later.length - 1; i >= 0; i--) {
        const l = this.later[i];
        l.t -= rawDt;
        if (l.t <= 0) {
          this.later.splice(i, 1);
          l.fn();
        }
      }
    this.shots.update(rawDt);
    if (!this.cinematic && h.player.alive) this.progress();
    const b = this.boss;
    if (this.phase === "boss" && b) this.hud.bossBar(Math.max(0, b.health / b.maxHealth));
    this.hud.update(rawDt, this.cinematic ? null : this.marker, h.camera, h.scene);
  }

  /** where you've got to: each part of the station wakes as you reach it */
  private progress() {
    const h = this.host;
    const me = h.player.feet;
    const flat = (a: Vector3, b: Vector3) => Math.hypot(a.x - b.x, a.z - b.z);
    const deep = me.y < METRO.deepY;
    if (this.phase === "platforms" && ((flat(me, METRO.concourse) < 12 && Math.abs(me.y - METRO.concourse.y) < 2) || deep)) {
      this.phase = "concourse";
      h.enemies.wakeGroup("concourse");
      this.objective();
      h.audio.play("radioChirp", { volume: 0.5 });
      this.hud.say("COMMAND", "Concourse. Ticket hall, offices, plenty of corners — clear them as you go, then find the way down.", 5);
    }
    if (this.phase === "concourse" && deep) {
      this.phase = "deep";
      h.enemies.wakeGroup("deep");
      h.enemies.wakeGroup("guard");
      this.objective();
      h.audio.play("radioChirp", { volume: 0.5 });
      this.hud.say("COMMAND", "Deep level. His post is at the far end of the service corridor — marked. His guard's between you and him.", 5);
    }
    if (this.phase === "deep" && deep && flat(me, METRO.boss) < METRO.bossRange) this.reveal();
  }

  // ------------------------------------------------------------------ the Winter Soldier
  /** at his post: a look at him, and he comes for you */
  private reveal() {
    const h = this.host;
    const b = this.boss;
    this.phase = "boss";
    this.objective();
    h.enemies.wakeGroup("guard");
    if (!b) return;
    b.wake();
    const at = b.position.clone();
    const me = h.player.feet;
    const toMe = V(me.x - at.x, 0, me.z - at.z).normalize();
    // (his position is his body's middle, ~0.9 m up: his face is 0.65 m above it)
    const head = () => b.position.add(V(0, 0.65, 0));
    // (his post is tucked in among the sheds: each camera's spot is searched for, round him, nearest
    // the angle wanted, with nothing between it and his face — and room to stand in)
    const spot = (ang: number, dist: number, up: number) => {
      const H = head();
      for (let k = 0; k < 16; k++) {
        const a = ang + (k % 2 ? 1 : -1) * Math.ceil(k / 2) * 0.35;
        for (const d of [dist, dist * 0.75, dist * 0.55]) {
          const dir = V(toMe.x * Math.cos(a) - toMe.z * Math.sin(a), 0, toMe.x * Math.sin(a) + toMe.z * Math.cos(a));
          const p = at.add(dir.scale(d)).addInPlaceFromFloats(0, up, 0);
          if (!h.nav.embedded(p.x, p.y, p.z) && h.nav.clear(p, H)) return p;
        }
      }
      return at.add(toMe.scale(dist)).addInPlaceFromFloats(0, up + 2, 0);
    };
    const a1 = spot(0.3, 4.2, -0.35), a2 = spot(-0.9, 2.6, 0.45);
    const shots: Shot[] = [
      {
        // low, from in front of him: he looks up
        dur: 2.6,
        from: a1,
        to: Vector3.Lerp(a1, head(), 0.15),
        look: head,
        fov: 0.62,
        sub: ["WINTER SOLDIER", "You came all this way for me."],
      },
      {
        // closer, off his metal arm
        dur: 2.2,
        from: a2,
        to: Vector3.Lerp(a2, head(), 0.12),
        look: () => b.position.add(V(0, 0.35, 0)),
        fov: 0.6,
        sub: ["WINTER SOLDIER", "Then you can die here."],
      },
    ];
    h.audio.play("radioChirp", { volume: 0.7, rate: 0.7 });
    this.shots.play(shots, () => {
      b.engage();
      this.hud.bossShow("THE WINTER SOLDIER");
      this.hud.bossMood("CALM", 0);
      this.hud.card("THE WINTER SOLDIER", "Kill him", 3);
    });
  }

  /** he's down: slow time, a last look, and it's over */
  private ending(b: Enemy) {
    const h = this.host;
    this.phase = "ending";
    this.objective();
    this.hud.bossMood("DOWN", 0);
    h.setTimeScale(0.35);
    const at = b.position.clone();
    const me = h.player.feet;
    const toMe = V(me.x - at.x, 0, me.z - at.z).normalize();
    this.after(1.2, () => {
      h.setTimeScale(1);
      this.hud.bossHide();
      const shots: Shot[] = [
        {
          // (along your own line of sight to him — you just shot him, so nothing's in the way)
          dur: 3.2,
          from: Vector3.Lerp(me.add(V(0, 1.6, 0)), at, 0.3).addInPlaceFromFloats(0, 1.2, 0),
          to: Vector3.Lerp(me.add(V(0, 1.6, 0)), at, 0.55).addInPlaceFromFloats(0, 0.8, 0),
          look: () => at.add(V(0, -0.6, 0)),
          fov: 0.75,
          sub: ["COMMAND", "That's him. The Winter Soldier is down. Good work, soldier — get topside, we're bringing you home."],
        },
        {
          // (underground: no pull-up into the sky — a slow drift back from you, at head height)
          dur: 3.4,
          from: me.add(V(0, 1.9, 0)),
          to: me.add(V(0, 2.1, 0)).add(toMe.scale(-1.2)),
          look: () => at.add(V(0, -0.4, 0)),
          fov: 0.8,
        },
      ];
      this.shots.play(shots, () => this.complete());
    });
  }

  private complete() {
    if (this.phase === "done") return;
    this.phase = "done";
    this.hud.reset();
    this.host.finish(true, "MISSION COMPLETE", "OPERATION UNDERGROUND // THE WINTER SOLDIER IS DOWN");
  }
}
