import { FreeCamera } from "@babylonjs/core/Cameras/freeCamera";
import { Vector3 } from "@babylonjs/core/Maths/math.vector";

/** one camera move: from → to (eased), turned to `look` each frame */
export interface Shot {
  dur: number;
  from: Vector3;
  to: Vector3;
  look: () => Vector3;
  fov?: number;
  /** a subtitle for the length of the shot (who, what) */
  sub?: [string, string];
  enter?: () => void;
  /** something that happens `t` seconds into the shot */
  cue?: [number, () => void];
}

/**
 * Plays a list of shots on the player's camera (in real seconds), then puts the camera back where it
 * was. `begin`/`end` hide and bring back the game's HUD and gun; `say` puts up a subtitle.
 */
export class ShotPlayer {
  /** seconds into the current shot */
  t = 0;
  private shots: Shot[] = [];
  private i = 0;
  private cued = false;
  private after: (() => void) | null = null;
  private saved = { fov: 1, x: 0, y: 0, z: 0, rx: 0, ry: 0 };

  constructor(private camera: FreeCamera, private hooks: { begin(): void; end(): void; say(who: string, text: string, dur: number): void }) {}

  get active() {
    return this.shots.length > 0;
  }
  /** which shot is on */
  get index() {
    return this.i;
  }

  play(shots: Shot[], after: () => void) {
    const c = this.camera;
    this.saved = { fov: c.fov, x: c.position.x, y: c.position.y, z: c.position.z, rx: c.rotation.x, ry: c.rotation.y };
    this.shots = shots;
    this.i = 0;
    this.after = after;
    this.hooks.begin();
    this.start();
  }

  /** cut to the next shot now (a shot of open length ends this way) */
  next() {
    if (!this.active) return;
    this.i++;
    if (this.i >= this.shots.length) this.finish();
    else this.start();
  }

  /** stop without its ending (a restart): the camera goes back */
  stop() {
    if (!this.active) return;
    this.after = null;
    this.finish();
  }

  update(rawDt: number) {
    if (!this.active) return;
    const s = this.shots[this.i];
    this.t += rawDt;
    if (s.cue && !this.cued && this.t >= s.cue[0]) {
      this.cued = true;
      s.cue[1]();
      // (the cue may have ended it)
      if (!this.active || this.shots[this.i] !== s) return;
    }
    const k = Math.min(1, this.t / s.dur);
    const e = k * k * (3 - 2 * k);
    const c = this.camera;
    Vector3.LerpToRef(s.from, s.to, e, c.position);
    const look = s.look().subtract(c.position);
    c.rotation.y = Math.atan2(look.x, look.z);
    c.rotation.x = -Math.atan2(look.y, Math.hypot(look.x, look.z));
    c.rotation.z = 0;
    c.fov = s.fov ?? 0.9;
    if (this.t >= s.dur) this.next();
  }

  private start() {
    const s = this.shots[this.i];
    this.t = 0;
    this.cued = false;
    s.enter?.();
    if (s.sub) this.hooks.say(s.sub[0], s.sub[1], Math.min(s.dur, 30));
  }

  private finish() {
    const c = this.camera;
    const s = this.saved;
    c.position.set(s.x, s.y, s.z);
    c.rotation.set(s.rx, s.ry, 0);
    c.fov = s.fov;
    this.shots = [];
    this.hooks.end();
    const a = this.after;
    this.after = null;
    a?.();
  }
}
