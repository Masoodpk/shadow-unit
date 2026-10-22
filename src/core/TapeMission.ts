import { FreeCamera } from "@babylonjs/core/Cameras/freeCamera";
import { Vector3 } from "@babylonjs/core/Maths/math.vector";
import { AudioEngine } from "../audio/AudioEngine";
import { Enemy } from "../enemies/Enemy";
import { EnemyManager } from "../enemies/EnemyManager";
import { NavGraph } from "../level/NavGraph";
import { PlaybackStation } from "../level/PlaybackStation";
import { MissionHud } from "../ui/MissionHud";
import { bindings } from "./Bindings";
import { Shot, ShotPlayer } from "./Shots";

/**
 * OPERATION FROSTLINE — after Sandstorm: the Ambassador's tape is Betamax, and the one deck that
 * can play it is in the cell's old offices, wired to a Commodore monitor.
 *   PLAY    → get to the desk (whenever you like — the soldiers needn't be dead) and press USE to
 *             put the tape in. A cinematic: the tape into the slot, the deck's display, the monitor
 *             coming on, and the tape playing on it. The soldiers hold still till it's over.
 *   HUNT    → back in your own hands: kill every hostile left in the building (the last one or two
 *             are marked). The last one down: MISSION COMPLETE (straight away if none are left).
 */

export interface TapeHost {
  scene: import("@babylonjs/core/scene").Scene;
  camera: FreeCamera;
  player: { feet: Vector3; yaw: number; alive: boolean };
  enemies: EnemyManager;
  nav: NavGraph;
  audio: AudioEngine;
  input: { hit(a: "use"): boolean };
  station: PlaybackStation;
  showHud(on: boolean): void;
  showWeapon(on: boolean): void;
  setObjective(text: string): void;
  flash(text: string): void;
  finish(won: boolean, title: string, kicker: string): void;
}

type Phase = "play" | "watching" | "hunt" | "done";

/** how near the desk's front edge you have to be to reach the deck */
const REACH = 1.5;

export class TapeMission {
  readonly hud = new MissionHud();
  /** the USE prompt for the game HUD (null when none) */
  prompt: string | null = null;
  /** no checkpoints on this one */
  readonly save = null;
  readonly knowsWhere = true;
  private phase: Phase = "play";
  private started = false;
  private shots: ShotPlayer;
  /** delayed beats (real seconds), cleared on restart */
  private later: { t: number; fn: () => void }[] = [];
  private after(t: number, fn: () => void) {
    this.later.push({ t, fn });
  }

  constructor(private host: TapeHost) {
    this.shots = new ShotPlayer(host.camera, {
      begin: () => {
        host.showHud(false);
        host.showWeapon(false);
        this.hud.letterbox(true, false);
      },
      end: () => {
        this.hud.letterbox(false, false);
        if (this.phase !== "watching" && this.phase !== "done") {
          host.showHud(true);
          host.showWeapon(true);
        }
      },
      say: (who, text, dur) => this.hud.say(who, text, dur),
    });
  }

  get cinematic() {
    return this.shots.active;
  }
  get freezeHostiles() {
    return this.cinematic || this.phase === "watching" || this.phase === "done";
  }
  /** the soldiers stand stock still (not just blind) while the tape plays: nobody wanders into the shot */
  get holdStill() {
    return this.cinematic;
  }

  /** where the HUD and the radar point */
  get marker(): { pos: Vector3; label: string } | null {
    if (this.phase === "play") return { pos: this.host.station.deskFront.add(new Vector3(0, 0.9, 0)), label: "BETAMAX DECK" };
    if (this.phase === "hunt") return this.straggler();
    return null;
  }

  /** the last one or two in the building, marked so one holed up somewhere can't hold you up */
  private straggler() {
    const h = this.host;
    const left = h.enemies.enemies.filter((e) => e.alive && !e.dormant);
    if (!left.length || left.length > 2) return null;
    const me = h.player.feet;
    const e = left.reduce((a, b) => (Vector3.DistanceSquared(a.collider.position, me) < Vector3.DistanceSquared(b.collider.position, me) ? a : b));
    return { pos: e.collider.position.add(new Vector3(0, 1.2, 0)), label: "HOSTILE" };
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
    h.showHud(true);
    h.showWeapon(true);
    h.station.reset();
    this.phase = "play";
    this.objective();
    this.hud.card("OPERATION FROSTLINE", "Play the Ambassador's tape", 3.5);
    this.after(1.2, () => this.hud.say("COMMAND", "The Ambassador's tape is Betamax. Nobody's made a deck in thirty years — but the cell ran their books from these offices, on old kit nobody could hack.", 7));
    this.after(8.6, () => this.hud.say("COMMAND", "There's a working Betamax deck in there, wired to an old Commodore monitor. It's marked. Get to it and play that tape — the building's crawling with them, so watch yourself.", 7));
  }

  resume() {
    this.reset();
  }

  /** the game paused (or went back to play): the tape too */
  setPaused(on: boolean) {
    this.host.station.setPaused(on);
  }

  private objective() {
    const n = this.host.enemies.awakeCount;
    this.host.setObjective(
      this.phase === "play" ? "PLAY THE TAPE ON THE BETAMAX DECK" : this.phase === "hunt" ? `KILL ALL REMAINING HOSTILES · ${n} LEFT` : this.phase === "watching" ? "WATCH THE TAPE" : "BUILDING CLEAR",
    );
  }

  onKilled(_e: Enemy) {
    // (the tape's played and that was the last of them)
    if (this.phase === "hunt" && this.host.enemies.awakeCount === 0) return this.complete();
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
    h.station.update(rawDt);
    if (!this.cinematic && this.phase === "play") this.atDesk();
    this.hud.update(rawDt, this.cinematic ? null : this.marker, h.camera, h.scene);
  }

  /** at the desk: the prompt (with the reason when it's not yet), and the key */
  private atDesk() {
    const h = this.host;
    const s = h.station;
    const f = h.player.feet, d = s.deskFront;
    const eye = h.camera.position;
    const near =
      h.player.alive &&
      Math.hypot(d.x - f.x, d.z - f.z) < REACH &&
      Math.abs(f.y - s.position.y) < 1 &&
      // (on the deck's side of the desk, and nothing between)
      Vector3.Dot(f.subtract(s.position), s.front) > 0.2 &&
      h.nav.clear(eye, d.add(new Vector3(0, 0.15, 0)));
    if (!near) {
      this.prompt = null;
      return;
    }
    this.prompt = `<b>${bindings.label("use")}</b> INSERT THE TAPE`;
    if (h.input.hit("use")) this.insert();
  }

  // ------------------------------------------------------------------ the tape goes in
  private insert() {
    const h = this.host;
    const s = h.station;
    this.prompt = null;
    this.phase = "watching";
    this.objective();

    const slot = s.slot, screen = s.screenCentre;
    const F = s.front, R = s.right;
    const at = (base: Vector3, f: number, r: number, y: number) => base.add(F.scale(f)).addInPlace(R.scale(r)).addInPlaceFromFloats(0, y, 0);
    // your eyes, squared up to the desk
    const eye = at(s.deskFront, 0.62, 0.05, 0.84);
    // the tape comes out of your kit low in front of you
    const kit = at(s.deskFront, 0.35, 0.12, 0.42);
    const shots: Shot[] = [
      {
        // your eyes: the tape out of your kit and into the slot
        dur: 2.3,
        from: eye,
        to: at(s.deskFront, 0.45, 0.02, 0.62),
        look: () => slot.add(new Vector3(0, 0.05, 0)),
        fov: 0.8,
        enter: () => {
          s.insert(kit);
          h.audio.play("foley", { volume: 0.8 });
        },
      },
      {
        // low at the deck's side: the door shuts behind it, the display lights
        dur: 1.8,
        from: at(slot, 0.34, -0.3, 0.09),
        to: at(slot, 0.29, -0.22, 0.08),
        look: () => slot,
        fov: 0.7,
        cue: [0.2, () => h.audio.play("doorShut", { volume: 0.45, rate: 1.7 })],
      },
      {
        // up to the monitor: on it comes
        dur: 2.2,
        from: at(slot, 0.4, 0.15, 0.12),
        to: at(screen, 0.55, 0.05, 0),
        look: () => Vector3.Lerp(slot, screen, Math.min(1, this.shots.t / 1.2)),
        fov: 0.75,
        cue: [0.9, () => {
          s.powerOn();
          h.audio.play("terminalBeep", { volume: 0.5, rate: 0.6 });
        }],
        sub: ["COMMAND", "Rolling. Let's see what they killed for."],
      },
      {
        // the picture, nearly filling the frame — for as long as the tape runs
        dur: 1e6,
        from: at(screen, 0.36 + s.screenHeight * 0.9, 0, 0),
        to: at(screen, 0.3 + s.screenHeight * 0.9, 0, 0),
        look: () => screen,
        fov: 0.62,
        enter: () => {
          s.onEnded = () => this.shots.next();
          s.play();
        },
      },
    ];
    this.shots.play(shots, () => this.watched());
  }

  /** the tape's over: back to you — and whoever's left in the building */
  private watched() {
    const h = this.host;
    h.station.stop();
    const n = h.enemies.awakeCount;
    if (n === 0) return this.complete();
    this.phase = "hunt";
    this.objective();
    h.showHud(true);
    h.showWeapon(true);
    this.hud.card("KILL ALL REMAINING HOSTILES", `${n} LEFT IN THE BUILDING`, 4);
    h.audio.play("radioChirp", { volume: 0.6 });
    this.after(1.5, () => this.hud.say("COMMAND", "We've seen it. Now finish this — nobody who knows what's on that tape walks out of this building.", 6));
  }

  private complete() {
    if (this.phase === "done") return;
    this.phase = "done";
    this.hud.reset();
    this.host.finish(true, "MISSION COMPLETE", "OPERATION FROSTLINE // TAPE PLAYED · BUILDING CLEAR");
  }
}
