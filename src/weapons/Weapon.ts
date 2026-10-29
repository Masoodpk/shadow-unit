import { GRENADE, RELOAD_SPEED, WeaponConfig } from "../config/weapons";
import { MuzzleFlash } from "../fx/Effects";
import { WeaponRig } from "./WeaponModels";

export type WeaponState = "holstered" | "equipping" | "ready" | "reloading" | "holstering";

export interface WeaponInput {
  triggerHeld: boolean;
  triggerPressed: boolean;
  /** seconds since the last trigger press */
  pressAge: number;
  /** unique id (timestamp) of the last trigger press */
  pressId: number;
  reloadPressed: boolean;
  /** secondary button (RMB) — grenades: underhand lob */
  altHeld?: boolean;
}

export interface WeaponHooks {
  playSound(name: string, volume?: number): void;
  onCycleEject(): void;
  onAutoReloadBlocked(): void;
}

/**
 * Deterministic weapon state machine. Ammunition changes only at explicit
 * reload events that are timed to the animation, so an interrupted reload can
 * never duplicate or lose rounds — whatever had been transferred stays
 * transferred, nothing else changes.
 */
export class Weapon {
  mag: number;
  reserve: number;
  state: WeaponState = "holstered";
  stateTime = 0;
  /** seconds until another shot is allowed (fire interval or pump cycle) */
  cooldown = 0;
  sinceShot = 99;
  bloom = 0;
  shotCount = 0;

  reloadIdx = -1;
  reloadT = 0;
  reloadEmpty = false;
  private reloadCancel = false;
  private cycleSoundDone = true;
  private cycleEjectDone = true;
  private lastPressHandled = -1;

  // ---- grenades (fireMode "throw"): press = pull pin, hold = cooked, release = throw
  throwPhase: "idle" | "pin" | "cooked" | "throw" = "idle";
  throwT = 0;
  /** set by quick-throw (G): pull the pin and throw as soon as possible */
  autoThrow = false;
  /** last throw was an underhand lob */
  lob = false;
  /** a throwing knife in the hand: no pin to pull, a quicker throw */
  noPin = false;
  throwRate = 1;

  constructor(
    readonly cfg: WeaponConfig,
    readonly rig: WeaponRig,
    readonly flash: MuzzleFlash,
    private hooks: WeaponHooks,
    private cycle: { soundAt: number; ejectAt: number } | null,
  ) {
    this.mag = cfg.magSize;
    this.reserve = cfg.reserveStart;
  }

  get interval() {
    return 60 / this.cfg.rpm;
  }
  get reloadPhase() {
    return this.reloadIdx >= 0 ? this.cfg.reload[this.reloadIdx] : null;
  }
  get canAds() {
    return this.state === "ready" && this.cfg.fireMode !== "throw" && this.cfg.fireMode !== "melee";
  }
  get isGrenade() {
    return this.cfg.fireMode === "throw";
  }
  /** 0..1 progress of the equip animation (1 = fully up) */
  get raised() {
    if (this.state === "equipping") return Math.min(1, this.stateTime / this.cfg.equipTime);
    if (this.state === "holstering") return 1 - Math.min(1, this.stateTime / this.cfg.holsterTime);
    if (this.state === "holstered") return 0;
    return 1;
  }

  resetAmmo() {
    this.mag = this.cfg.magSize;
    this.reserve = this.cfg.reserveStart;
    this.state = "holstered";
    this.stateTime = 0;
    this.cooldown = 0;
    this.sinceShot = 99;
    this.bloom = 0;
    this.shotCount = 0;
    this.reloadIdx = -1;
    this.reloadT = 0;
    this.reloadCancel = false;
    this.cycleSoundDone = this.cycleEjectDone = true;
    this.throwPhase = "idle";
    this.throwT = 0;
    this.autoThrow = false;
    this.rig.reset();
  }

  equip() {
    this.state = "equipping";
    this.stateTime = 0;
    // A pump/bolt cycle interrupted by holstering is completed off-screen.
    this.cooldown = 0;
    this.sinceShot = 99;
    this.cycleSoundDone = this.cycleEjectDone = true;
    this.throwPhase = "idle";
    this.throwT = 0;
    this.rig.reset();
  }

  holster() {
    if (this.state === "holstered" || this.state === "holstering") return;
    // a pulled pin goes back in when you switch away (no accidental self-flash)
    this.throwPhase = "idle";
    this.throwT = 0;
    this.autoThrow = false;
    const raised = this.raised;
    this.abortReload();
    this.state = "holstering";
    // start from current height if we were still equipping
    this.stateTime = (1 - raised) * this.cfg.holsterTime;
  }

  abortReload() {
    if (this.reloadIdx >= 0) {
      this.reloadIdx = -1;
      this.reloadT = 0;
      this.reloadCancel = false;
      this.rig.reset();
    }
    if (this.state === "reloading") this.state = "ready";
  }

  tryReload() {
    if (this.state !== "ready" || this.mag >= this.cfg.magSize || this.reserve <= 0) return false;
    if (this.cfg.fireMode !== "auto" && this.cooldown > 0.05) return false;
    this.state = "reloading";
    this.reloadEmpty = this.mag === 0;
    this.reloadCancel = false;
    this.reloadIdx = -1;
    this.nextPhase(true);
    return true;
  }

  /** Advance state; returns number of shots to resolve this frame. */
  update(dt: number, inp: WeaponInput): number {
    this.stateTime += dt;
    this.sinceShot += dt;
    this.bloom = Math.max(0, this.bloom - this.cfg.spread.bloomRecovery * dt);
    let shots = 0;

    // pump cycle side-effects keyed to the animation timeline
    if (this.cycle) {
      if (!this.cycleSoundDone && this.sinceShot >= this.cycle.soundAt) {
        this.cycleSoundDone = true;
        this.hooks.playSound(this.cfg.sounds.cycle ?? "pump", 0.8);
      }
      if (!this.cycleEjectDone && this.sinceShot >= this.cycle.ejectAt) {
        this.cycleEjectDone = true;
        this.hooks.onCycleEject();
      }
    }

    switch (this.state) {
      case "equipping":
        if (this.stateTime >= this.cfg.equipTime) {
          this.state = "ready";
          this.stateTime = 0;
        }
        break;
      case "holstering":
        if (this.stateTime >= this.cfg.holsterTime) {
          this.state = "holstered";
          this.stateTime = 0;
        }
        break;
      case "reloading": {
        // Pump guns: firing during a shell-by-shell reload stops after the current shell.
        if (this.cfg.fireMode === "pump" && inp.triggerPressed && this.mag > 0) this.reloadCancel = true;
        // Authored clips: once the mag is seated, the cosmetic tail can be cut short by firing.
        const ph = this.reloadPhase;
        if (ph?.cancelAfter !== undefined && this.reloadT >= ph.cancelAfter && inp.triggerHeld && this.mag > 0) {
          this.reloadIdx = -1;
          this.reloadT = 0;
          this.state = "ready";
          this.stateTime = 0;
          this.cooldown = 0;
          break;
        }
        this.advanceReload(dt);
        break;
      }
      case "ready": {
        if (this.cfg.fireMode === "throw") {
          shots = this.updateThrow(dt, inp);
          break;
        }
        // the knife's attacks are timed by the weapon manager (no ammo, no reload)
        if (this.cfg.fireMode === "melee") break;
        this.cooldown -= dt;
        if (inp.reloadPressed && this.tryReload()) break;
        if (this.cfg.fireMode === "auto") {
          if (!inp.triggerHeld) this.cooldown = Math.max(this.cooldown, 0);
          while (inp.triggerHeld && this.cooldown <= 0 && this.mag > 0 && shots < 2) {
            shots++;
            this.consumeShot();
            this.cooldown += this.interval;
          }
          if (inp.triggerPressed && this.mag === 0) this.dryFire();
        } else {
          const fresh = this.lastPressHandled !== inp.pressId;
          const wants = fresh && (inp.triggerPressed || inp.pressAge <= this.cfg.inputBuffer);
          if (wants && this.cooldown <= 0) {
            if (this.mag > 0) {
              shots = 1;
              this.consumeShot();
              this.cooldown = Math.max(this.cfg.cycleTime, 60 / this.cfg.rpm);
              this.lastPressHandled = inp.pressId;
              if (this.cycle) {
                this.cycleSoundDone = false;
                this.cycleEjectDone = false;
              }
            } else if (inp.triggerPressed) {
              this.lastPressHandled = inp.pressId;
              this.dryFire();
            }
          }
          this.cooldown = Math.max(this.cooldown, -1);
        }
        break;
      }
    }
    return shots;
  }

  private updateThrow(dt: number, inp: WeaponInput): number {
    let shots = 0;
    switch (this.throwPhase) {
      case "idle": {
        const fresh = this.lastPressHandled !== inp.pressId;
        const wants = this.autoThrow || (fresh && (inp.triggerPressed || inp.pressAge <= this.cfg.inputBuffer));
        if (wants && this.mag > 0 && this.noPin) {
          // (a knife: straight up into the hand — held back, ready, while the button is down)
          this.lastPressHandled = inp.pressId;
          this.throwPhase = inp.triggerHeld ? "cooked" : "throw";
          this.throwT = 0;
        } else if (wants && this.mag > 0) {
          this.lastPressHandled = inp.pressId;
          this.throwPhase = "pin";
          this.throwT = 0;
          this.hooks.playSound("pinPull", 0.8);
        } else if (wants && inp.triggerPressed) this.lastPressHandled = inp.pressId;
        break;
      }
      case "pin":
        this.throwT += dt / GRENADE.pinTime;
        if (this.throwT >= 1) {
          this.throwT = 0;
          this.throwPhase = !this.autoThrow && inp.triggerHeld ? "cooked" : "throw";
        }
        break;
      case "cooked":
        this.throwT += dt;
        if (!inp.triggerHeld) {
          this.throwPhase = "throw";
          this.throwT = 0;
        }
        break;
      case "throw": {
        const prev = this.throwT;
        if (prev === 0) this.lob = !!inp.altHeld;
        this.throwT += (dt / GRENADE.throwTime) * this.throwRate;
        if (prev < GRENADE.releaseAt && this.throwT >= GRENADE.releaseAt) {
          shots = 1;
          this.mag--;
          this.sinceShot = 0;
          this.shotCount++;
        }
        if (this.throwT >= 1) {
          this.throwPhase = "idle";
          this.throwT = 0;
          this.autoThrow = false;
          // next grenade comes up from the vest
          if (this.mag > 0) {
            this.state = "equipping";
            this.stateTime = 0;
          }
        }
        break;
      }
    }
    return shots;
  }

  private consumeShot() {
    this.mag--;
    this.sinceShot = 0;
    this.shotCount++;
    this.bloom = Math.min(this.cfg.spread.maxBloom, this.bloom + this.cfg.spread.perShot);
  }

  private dryFire() {
    this.hooks.playSound(this.cfg.sounds.dry, 0.6);
    if (this.reserve > 0) this.tryReload();
    else this.hooks.onAutoReloadBlocked();
  }

  private advanceReload(dt: number) {
    const ph = this.reloadPhase;
    if (!ph) {
      this.state = "ready";
      return;
    }
    const prev = this.reloadT;
    this.reloadT += (dt * RELOAD_SPEED) / ph.duration;
    for (const ev of ph.events) {
      if (prev < ev.t && this.reloadT >= ev.t) this.fireEvent(ev.type, ev.sound);
    }
    if (this.reloadT >= 1) this.nextPhase(false);
  }

  private fireEvent(type: string, sound?: string) {
    const c = this.cfg;
    if (type === "transferMag") {
      const n = Math.min(c.magSize - this.mag, this.reserve);
      this.mag += n;
      this.reserve -= n;
    } else if (type === "transferOne") {
      if (this.reserve > 0 && this.mag < c.magSize) {
        this.mag++;
        this.reserve--;
      }
    } else if (type === "sound" && sound) this.hooks.playSound(sound, 0.75);
  }

  private nextPhase(starting: boolean) {
    const phases = this.cfg.reload;
    const cur = this.reloadPhase;
    if (!starting && cur?.loop && !this.reloadCancel && this.mag < this.cfg.magSize && this.reserve > 0) {
      this.reloadT = 0; // next shell
      return;
    }
    let i = this.reloadIdx + 1;
    while (i < phases.length) {
      const p = phases[i];
      if ((p.onlyIfEmpty && !this.reloadEmpty) || (p.onlyIfNotEmpty && this.reloadEmpty)) {
        i++;
        continue;
      }
      if (p.loop && (this.mag >= this.cfg.magSize || this.reserve <= 0)) {
        i++;
        continue;
      }
      break;
    }
    if (i >= phases.length) {
      this.reloadIdx = -1;
      this.reloadT = 0;
      this.state = "ready";
      this.stateTime = 0;
      this.cooldown = 0;
      return;
    }
    this.reloadIdx = i;
    this.reloadT = 0;
  }

  /** Current aim cone half-angle in degrees. */
  spread(adsT: number, moveAmount: number, airborne: boolean, stance: "stand" | "crouch" | "prone") {
    const s = this.cfg.spread;
    let v = s.hip + (s.ads - s.hip) * adsT;
    v += s.moving * Math.min(1, moveAmount) * (1 - adsT * 0.7);
    if (airborne) v += s.air;
    v += this.bloom * (1 - adsT * 0.5);
    // prone: braced on the floor — steadier than crouching
    if (stance === "crouch") v *= s.crouchScale;
    else if (stance === "prone") v *= s.crouchScale * 0.65;
    return v;
  }
}
