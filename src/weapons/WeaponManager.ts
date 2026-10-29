import { PickingInfo } from "@babylonjs/core/Collisions/pickingInfo";
import { Ray } from "@babylonjs/core/Culling/ray";
import { Scene } from "@babylonjs/core/scene";
import { TransformNode } from "@babylonjs/core/Meshes/transformNode";
import { Vector3 } from "@babylonjs/core/Maths/math.vector";
import { BodyZone, HitKind, SurfaceType } from "../config/game";
import { GRENADE, GRENADE_ORDER, GRENADE_TYPES, THROWING_KNIFE, GrenadeType, LoadoutSlot, ProjectileConfig, SLOT_ORDER, WEAPONS, WEAPON_ORDER, WeaponConfig, WeaponId, slotOf } from "../config/weapons";
import type { SwingKind } from "./KnifeRigFP";
import { AudioEngine } from "../audio/AudioEngine";
import { Input } from "../core/Input";
import type { Action } from "../core/Bindings";
import { DEG, clamp, damp, rand } from "../core/math";
import { Effects } from "../fx/Effects";
import { PlayerController, PlayerModifiers } from "../player/PlayerController";
import { Materials } from "../render/Materials";
import { Viewmodel } from "./Viewmodel";
import { Weapon } from "./Weapon";
import { WeaponRig, buildRig, optimizeRig } from "./WeaponModels";

export interface EnemyHitTarget {
  applyHit(damage: number, zone: BodyZone, dir: Vector3, point: Vector3, info?: { kind: "bullet" | "melee"; force?: number }): boolean; // returns true if killed
  readonly alive: boolean;
  readonly heading: number;
  readonly position: Vector3;
}

/** melee (V / middle mouse): rifle butt-stroke or pistol whip */
const MELEE = {
  duration: 0.6,
  /** fraction of the swing when the blow lands */
  strikeAt: 0.38,
  range: 2.25,
  cooldown: 0.25,
  rifle: { damage: 55, force: 1.0 },
  pistol: { damage: 45, force: 0.8 },
  /** from behind: a takedown */
  behindDamage: 150,
};

export interface ShotEvents {
  onHit(kind: "body" | "head", killed: boolean): void;
  onShot(origin: Vector3, noise: number): void;
  /** a round left the muzzle (online: everyone else hears and sees it) */
  onFire?(muzzle: Vector3, dir: Vector3, weapon: string): void;
  onNoAmmo(): void;
  /** a grenade left the hand */
  onThrow(type: GrenadeType, origin: Vector3, velocity: Vector3): void;
  /** a rocket left the tube */
  onRocket?(origin: Vector3, dir: Vector3, cfg: ProjectileConfig): void;
  /** launch backblast behind the tube (smoke / dust) */
  onBackblast?(at: Vector3, dir: Vector3, muzzle?: Vector3): void;
  /** a shot hit this level mesh: if it's a window pane, shatter it and return true (the shot goes on) */
  onGlass?(mesh: unknown, point: Vector3, dir: Vector3): boolean;
  onNoGrenades?(): void;
}

/**
 * Owns both weapons, switching, ADS, and shot resolution (hitscan).
 * Order per frame: input → state machine → shots resolved immediately →
 * effects/sound/recoil in the same frame, so the first rendered frame after a
 * click already shows the flash and the impact.
 */
/** knife lunge: how far off it reaches for him (m, flat), the arm's length it stops at, the cone (cos) */
const LUNGE = { range: 3.6, reach: 1.25, cone: Math.cos((22 * Math.PI) / 180) };

export class WeaponManager {
  readonly weapons: Weapon[] = [];
  readonly viewmodel: Viewmodel;
  current = 0;
  /**
   * What the player is carrying, one weapon per slot (index into `weapons`, -1 = empty): a primary
   * gun, a pistol, at most one rocket launcher, the knife and the grenade belt. Everything else
   * is found in the stage and swapped for.
   */
  readonly carried: Record<LoadoutSlot, number> = { primary: -1, smg: -1, sniper: -1, secondary: -1, launcher: -1, melee: -1, grenade: -1 };
  /** last weapon used (Q quick-switch) */
  previous = -1;
  private pending = -1;
  /** grenades: switch back to this slot after the throw (quick throw / out of grenades) */
  private returnTo = -1;
  private quickThrow = false;
  /** grenade belt: count per type and the type in hand */
  readonly inventory = { frag: 0, flame: 0, plasma: 0, flash: 0, knife: 0 } as Record<GrenadeType, number>;
  /** a quick knife throw (its own key): the belt type to go back to once it's thrown (null: none) */
  private knifeThrow: { restore: GrenadeType } | null = null;
  nadeType: GrenadeType = "frag";
  private thrown = false;
  adsT = 0;
  sprintT = 0;
  shotsFired = 0;
  shotsHit = 0;
  /** degrees, for the HUD crosshair */
  currentSpread = 0;
  private ray = new Ray(Vector3.Zero(), Vector3.Forward(), 100);
  private dir = new Vector3();
  private fwd = new Vector3();
  private right = new Vector3();
  private up = new Vector3();
  private tmp = new Vector3();
  private muzzleWorld = new Vector3();
  private endPoint = new Vector3();
  private readonly bulletPredicate = (m: { metadata?: { kind?: number; enemy?: EnemyHitTarget }; isPickable: boolean }) => {
    const md = m.metadata;
    if (!md) return false;
    if (md.kind === HitKind.Level) return m.isPickable;
    if (md.kind === HitKind.EnemyPart) return !!md.enemy?.alive;
    return false;
  };

  constructor(
    private scene: Scene,
    private input: Input,
    private player: PlayerController,
    private fx: Effects,
    private audio: AudioEngine,
    mats: Materials,
    private events: ShotEvents,
    prebuilt: Partial<Record<WeaponId, WeaponRig>> = {},
  ) {
    const rigs = WEAPON_ORDER.map((id) => {
      const pre = prebuilt[id];
      if (pre) return pre;
      const rig = buildRig(id, scene, mats);
      optimizeRig(rig);
      return rig;
    });
    this.viewmodel = new Viewmodel(scene, player.camera, mats, rigs);
    WEAPON_ORDER.forEach((id, i) => {
      const cfg = WEAPONS[id];
      const rig = rigs[i];
      const f = cfg.muzzleFlash;
      const flash = fx.createFlash(rig.muzzle, f.tint, f.scale, f.length, f.duration);
      const w = new Weapon(
        cfg,
        rig,
        flash,
        {
          playSound: (name, vol) => this.audio.play(name, { volume: vol ?? 0.8, pitchVar: 0.03 }),
          onCycleEject: () => this.eject(w),
          onAutoReloadBlocked: () => this.events.onNoAmmo(),
        },
        cfg.sounds.cycle
            ? { soundAt: 0.42, ejectAt: Number.POSITIVE_INFINITY } // bolt-action style cycle sound
            : null,
      );
      this.weapons.push(w);
    });
  }

  get weapon() {
    return this.weapons[this.current];
  }
  get grenadeSlot() {
    return this.weapons.findIndex((w) => w.isGrenade);
  }
  /** total grenades carried */
  get grenades() {
    let n = 0;
    for (const t of GRENADE_ORDER) n += this.inventory[t];
    return n;
  }
  private get grenadeWeapon() {
    return this.weapons[this.grenadeSlot] ?? null;
  }
  /** pick the grenade type (B cycles); the hand model follows */
  setGrenadeType(t: GrenadeType) {
    this.nadeType = t;
    const gw = this.grenadeWeapon;
    if (!gw) return;
    (gw.rig as WeaponRig & { setType?(t: GrenadeType): void }).setType?.(t);
    gw.mag = this.inventory[t];
  }
  cycleGrenade(dir = 1) {
    const i0 = GRENADE_ORDER.indexOf(this.nadeType);
    for (let k = 1; k <= GRENADE_ORDER.length; k++) {
      const t = GRENADE_ORDER[(i0 + dir * k + GRENADE_ORDER.length * 4) % GRENADE_ORDER.length];
      if (this.inventory[t] > 0) {
        if (t === this.nadeType) return false;
        this.setGrenadeType(t);
        return true;
      }
    }
    return false;
  }
  /** the belt's count changed outside a throw (a knife taken back): the hand shows it */
  syncBelt() {
    const gw = this.grenadeWeapon;
    if (gw && gw.throwPhase === "idle") gw.mag = this.inventory[this.nadeType];
  }
  refillGrenades() {
    for (const t of GRENADE_ORDER) this.inventory[t] = GRENADE_TYPES[t].count;
    const gw = this.grenadeWeapon;
    if (gw && gw.throwPhase === "idle") gw.mag = this.inventory[this.nadeType];
  }

  /**
   * The throwing knife's own key, from whatever's in your hands: the belt turns to the knives, the gun
   * goes down and the knife comes up — held back, ready, for as long as the key is held; let go and
   * it's thrown — then back to the gun and the belt's grenade type.
   */
  private startKnifeThrow() {
    const gi = this.grenadeSlot;
    if (gi < 0 || this.knifeThrow) return;
    if (this.inventory.knife <= 0) {
      this.events.onNoGrenades?.();
      return;
    }
    const gw = this.weapons[gi];
    if (this.current === gi && gw.throwPhase !== "idle") return;
    this.knifeThrow = { restore: this.nadeType };
    this.setGrenadeType("knife");
    if (this.current === gi) {
      if (gw.state === "ready") gw.autoThrow = true;
      return;
    }
    this.returnTo = this.pending >= 0 ? this.pending : this.current;
    this.quickThrow = true;
    this.requestSwitch(gi);
  }

  /** slot of a weapon */
  slotOf(i: number): LoadoutSlot {
    return slotOf(this.weapons[i].cfg);
  }
  /** index of a weapon by id */
  indexOf(id: WeaponId) {
    return this.weapons.findIndex((w) => w.cfg.id === id);
  }
  isCarried(i: number) {
    if (i >= 0 && i < this.weapons.length && this.arsenal) return true;
    return i >= 0 && this.carried[this.slotOf(i)] === i;
  }

  // ------------------------------------------------------------------ the whole arsenal (a toggle)
  /** every weapon in the game carried at once, full ammo — a slot key pressed again steps through that slot's guns */
  arsenal = false;
  /** what you had before it was switched on (given back when it's switched off) */
  private beforeArsenal: { carried: Record<LoadoutSlot, number>; ammo: [number, number][]; nades: Record<GrenadeType, number> } | null = null;
  setArsenal(on: boolean) {
    if (on === this.arsenal) return;
    if (on) {
      this.beforeArsenal = { carried: { ...this.carried }, ammo: this.weapons.map((w) => [w.mag, w.reserve]), nades: { ...this.inventory } };
      this.arsenal = true;
      this.refillArsenal();
      this.audio.play("magIn", { volume: 0.55 });
      return;
    }
    this.arsenal = false;
    const b = this.beforeArsenal;
    this.beforeArsenal = null;
    if (b) {
      Object.assign(this.carried, b.carried);
      this.weapons.forEach((w, i) => {
        if (w.state === "reloading") w.abortReload();
        [w.mag, w.reserve] = b.ammo[i];
      });
      Object.assign(this.inventory, b.nades);
      this.syncGrenadeMag();
    }
    // a gun you only had from the arsenal goes back: your own primary (or what's left) comes up
    if (!this.isCarried(this.current) || (this.pending >= 0 && !this.isCarried(this.pending))) {
      const back = (["primary", "smg", "sniper", "secondary", "melee"] as LoadoutSlot[]).map((s) => this.carried[s]).find((i) => i >= 0) ?? -1;
      this.pending = -1;
      if (back >= 0) {
        this.current = back;
        this.weapon.equip();
      }
    }
    if (!this.isCarried(this.previous)) this.previous = -1;
  }
  /** every gun's magazine and reserve full, rockets and the grenade belt too */
  private refillArsenal() {
    for (const w of this.weapons) {
      if (w.isGrenade) continue;
      w.mag = w.cfg.magSize;
      w.reserve = w.cfg.reserveMax;
    }
    this.refillGrenades();
  }
  private syncGrenadeMag() {
    const gw = this.grenadeWeapon;
    if (gw && gw.throwPhase === "idle") gw.mag = this.inventory[this.nadeType];
  }
  /** a slot key: that slot's weapon — with the arsenal, pressed again, the next gun in the slot */
  private slotKey(slot: LoadoutSlot) {
    if (!this.arsenal) {
      if (this.carried[slot] >= 0) this.requestSwitch(this.carried[slot]);
      return;
    }
    const list = this.weapons.map((_, i) => i).filter((i) => this.slotOf(i) === slot);
    if (!list.length) return;
    const at = this.pending >= 0 ? this.pending : this.current;
    const k = list.indexOf(at);
    const next = k >= 0 ? list[(k + 1) % list.length] : this.carried[slot] >= 0 && list.includes(this.carried[slot]) ? this.carried[slot] : list[0];
    this.carried[slot] = next;
    this.requestSwitch(next);
  }

  // ------------------------------------------------------------------ quick knife (a key of its own)
  /**
   * Out with the knife whatever's in your hands — mid-reload too: the gun goes down, one slash, and
   * it comes back up (and carries on reloading if that's what it was doing).
   */
  private quickKnife = { on: false, slashed: false, back: -1, reload: false };
  private startQuickKnife() {
    const ki = this.carried.melee >= 0 ? this.carried.melee : this.indexOf("knife");
    if (ki < 0 || this.quickKnife.on) return;
    const w = this.weapon;
    if (w.cfg.knife) {
      this.startKnife(false);
      return;
    }
    if (w.isGrenade && w.throwPhase !== "idle") return;
    this.quickKnife = { on: true, slashed: false, back: this.pending >= 0 ? this.pending : this.current, reload: w.state === "reloading" || (w.mag === 0 && w.reserve > 0) };
    this.meleeT = -1;
    this.requestSwitch(ki);
    // (a quick draw: the gun's lowered half way already, the knife comes up fast)
    if (this.weapon.state === "holstering") this.weapon.stateTime = Math.max(this.weapon.stateTime, this.weapon.cfg.holsterTime * 0.6);
  }
  private updateQuickKnife() {
    const q = this.quickKnife;
    if (!q.on) return;
    const w = this.weapon;
    if (!w.cfg.knife) {
      // not there yet (or something else took over the switch)
      if (this.pending < 0 && w.state !== "holstering") q.on = false;
      return;
    }
    if (w.state === "equipping" && w.stateTime < w.cfg.equipTime * 0.55) w.stateTime = w.cfg.equipTime * 0.55;
    if (!q.slashed) {
      if (w.state === "ready" && this.knifeT < 0) {
        this.startKnife(false);
        q.slashed = this.knifeT >= 0;
      }
      return;
    }
    if (this.knifeT >= 0) return;
    q.on = false;
    if (this.isCarried(q.back)) {
      this.requestSwitch(q.back);
      this.resumeReload = q.reload ? q.back : -1;
    }
  }
  /** the gun put down mid-reload for the knife: reload it again once it's back up */
  private resumeReload = -1;

  /**
   * Take a weapon from the world. The same gun: its ammo goes into your reserve. Otherwise it
   * replaces whatever is in that slot (returned so the game can drop it where you stand) and comes
   * straight up into your hands.
   */
  pickUp(id: WeaponId, mag: number, reserve: number): { took: boolean; dropped: { id: WeaponId; mag: number; reserve: number } | null } {
    const i = this.indexOf(id);
    if (i < 0) return { took: false, dropped: null };
    const w = this.weapons[i];
    const slot = this.slotOf(i);
    const held = this.carried[slot];
    if (this.arsenal) {
      // (everything's carried already: it's ammo)
      const before = w.reserve;
      w.reserve = Math.min(w.cfg.reserveMax, w.reserve + mag + reserve);
      return { took: w.reserve !== before, dropped: null };
    }
    if (held === i) {
      const before = w.reserve;
      w.reserve = Math.min(w.cfg.reserveMax, w.reserve + mag + reserve);
      if (w.reserve !== before) this.audio.play("magIn", { volume: 0.5 });
      return { took: w.reserve !== before, dropped: null };
    }
    let dropped: { id: WeaponId; mag: number; reserve: number } | null = null;
    if (held >= 0) {
      const old = this.weapons[held];
      dropped = { id: old.cfg.id, mag: old.mag, reserve: old.reserve };
    }
    w.resetAmmo();
    w.mag = Math.min(w.cfg.magSize, mag);
    w.reserve = Math.min(w.cfg.reserveMax, reserve);
    this.carried[slot] = i;
    this.audio.play("weaponSwitch", { volume: 0.6 });
    if (held >= 0 && held === this.current) {
      // the gun in your hands goes on the ground; the new one comes up
      this.current = i;
      this.pending = -1;
      this.weapon.equip();
    } else this.requestSwitch(i);
    if (this.previous === held) this.previous = -1;
    return { took: true, dropped };
  }

  /** an ammo box: five magazines for each carried gun (true if anything was taken) */
  takeAmmo() {
    let took = false;
    for (const slot of ["primary", "smg", "sniper", "secondary"] as LoadoutSlot[]) {
      const i = this.carried[slot];
      if (i < 0) continue;
      const w = this.weapons[i];
      const r = Math.min(w.cfg.reserveMax, w.reserve + w.cfg.magSize * 5);
      if (r > w.reserve) took = true;
      w.reserve = r;
    }
    if (took) this.audio.play("magIn", { volume: 0.55 });
    return took;
  }
  /** a rocket crate: three more rockets for the launcher you carry */
  takeRockets() {
    const i = this.carried.launcher;
    if (i < 0) return false;
    const w = this.weapons[i];
    const r = Math.min(w.cfg.reserveMax, w.reserve + 3);
    if (r === w.reserve) return false;
    w.reserve = r;
    this.audio.play("rocketLoad", { volume: 0.5 });
    return true;
  }
  /** a grenade crate: the belt filled up again */
  takeGrenades() {
    let took = false;
    for (const t of GRENADE_ORDER) if (this.inventory[t] < GRENADE_TYPES[t].count) took = true;
    if (!took) return false;
    this.refillGrenades();
    this.audio.play("foley", { volume: 0.5 });
    return true;
  }

  reset() {
    for (const w of this.weapons) w.resetAmmo();
    this.refillGrenades();
    this.setGrenadeType("frag");
    // starting kit: carbine, pistol, knife, grenades — no launcher (find one)
    this.carried.primary = this.indexOf("rifle");
    this.carried.smg = -1;
    this.carried.sniper = -1;
    this.carried.secondary = this.indexOf("glock");
    this.carried.launcher = -1;
    this.carried.melee = this.indexOf("knife");
    this.carried.grenade = this.grenadeSlot;
    this.current = this.carried.primary;
    this.previous = -1;
    this.pending = -1;
    this.returnTo = -1;
    this.quickThrow = false;
    this.knifeThrow = null;
    this.thrown = false;
    this.adsT = 0;
    this.sprintT = 0;
    this.shotsFired = 0;
    this.shotsHit = 0;
    this.quickKnife = { on: false, slashed: false, back: -1, reload: false };
    this.resumeReload = -1;
    // (the arsenal stays on through a restart: the starting kit is what it gives back)
    if (this.arsenal) {
      this.beforeArsenal = { carried: { ...this.carried }, ammo: this.weapons.map((w) => [w.mag, w.reserve]), nades: { ...this.inventory } };
      this.refillArsenal();
    }
    this.viewmodel.reset();
    this.weapon.equip();
    this.weapon.stateTime = this.weapon.cfg.equipTime * 0.4;
  }

  requestSwitch(i: number) {
    if (i < 0 || i >= this.weapons.length || !this.isCarried(i)) return;
    if (this.weapons[i].isGrenade && this.grenades <= 0 && i !== this.current) {
      this.events.onNoGrenades?.();
      return;
    }
    this.input.cancelAim();
    if (i === this.current && this.pending < 0) return;
    if (this.pending === i) return;
    if (i === this.current && this.pending >= 0) {
      // switched back mid-holster → re-raise current
      this.pending = -1;
      this.weapon.equip();
      return;
    }
    this.pending = i;
    this.weapon.holster();
    this.audio.play("weaponSwitch", { volume: 0.5 });
  }

  /** Modifiers fed to the player controller (speed, ADS FOV, etc.) */
  modifiers(): PlayerModifiers {
    const c = this.weapon.cfg;
    return {
      speedScale: c.moveSpeedScale * (1 - (1 - c.adsMoveScale) * this.adsT),
      canSprint: !(this.input.adsHeld && !this.input.aimToggle) && !(this.input.fireHeld && this.weapon.state === "ready" && !this.weapon.isGrenade),
      adsT: this.adsT,
      adsFovScale: c.adsFovScale,
      adsSensitivity: c.adsSensitivity,
    };
  }

  private lastShotAt = -1;
  private streak = 0;
  private streakCfg: WeaponConfig | null = null;
  /** end of a string of recorded rounds → release tail */
  private updateShotStreak() {
    const c = this.streakCfg;
    if (!c || this.streak === 0) return;
    if (this.audio.ctx.currentTime - this.lastShotAt > (60 / c.rpm) * 1.7) {
      if (this.streak >= 2 && c.sounds.release) this.audio.play(c.sounds.release, { volume: (c.sounds.fireVolume ?? 0.8) * 0.9, pitchVar: 0.02, reverb: 0.5 });
      this.streak = 0;
    }
  }

  /** melee swing progress (-1 = none) */
  meleeT = -1;
  private meleeStyle: "rifle" | "pistol" = "rifle";
  private meleeHitDone = false;
  private meleeCd = 0;

  // ------------------------------------------------------------------ knife
  /** knife attack progress 0..1 (-1 = none) */
  knifeT = -1;
  private knifeKind: SwingKind = "slashA";
  private knifeHitDone = false;
  private knifeAlt = 0;
  private knifePress = -1;

  private startKnife(heavy: boolean) {
    const w = this.weapon;
    if (!w.cfg.knife || w.state !== "ready" || this.knifeT >= 0) return;
    // the three authored slashes in turn; the aim button is the heavy strike
    this.knifeKind = heavy ? "stab" : (["slashA", "slashB", "slashC"] as const)[this.knifeAlt % 3];
    if (!heavy) this.knifeAlt++;
    this.knifeT = 0;
    this.knifeHitDone = false;
    this.lunge = this.findLunge();
    this.audio.play("knifeSlash", { volume: heavy ? 0.7 : 0.55, pitchVar: 0.08, delay: heavy ? 0.22 : 0.03 });
  }

  private updateKnife(dt: number) {
    const w = this.weapon;
    const k = w.cfg.knife;
    if (!k) {
      this.knifeT = -1;
      return;
    }
    if (this.knifeT < 0) return;
    const a = this.knifeKind === "stab" ? k.heavy : k.light;
    // the lunge: in toward him through the wind-up, to arm's length by the moment the blade lands
    const L = this.lunge;
    if (L && !this.knifeHitDone && this.player.alive) {
      const c = this.player.collider.position;
      const dx = L.x - c.x, dz = L.z - c.z;
      const d = Math.hypot(dx, dz);
      const left = Math.max(0.02, a.hitAt - this.knifeT * a.time);
      const step = Math.min(Math.max(0, d - LUNGE.reach), (Math.max(0, d - LUNGE.reach) / left) * dt * 1.15);
      if (step > 0.001) this.player.collider.moveWithCollisions(this.tmp.set((dx / d) * step, 0, (dz / d) * step));
    }
    this.knifeT += dt / a.time;
    if (!this.knifeHitDone && this.knifeT >= a.hitAt / a.time) {
      this.knifeHitDone = true;
      this.strike({ range: a.range, damage: a.damage, behind: k.backstab, force: this.knifeKind === "stab" ? 0.9 : 0.6, knife: true, headMul: w.cfg.damage.headMultiplier });
    }
    if (this.knifeT >= 1) this.knifeT = -1;
  }

  /** enemies' positions (set by the game): what the knife can lunge at */
  lungeTargets: (() => Vector3[]) | null = null;
  private lunge: Vector3 | null = null;
  /**
   * A knife swing at someone a few metres off in front of you lunges: you're carried in to arm's
   * length and the blade lands (the way shooters do it) — swung at thin air, it was a wasted swing
   * against anyone who keeps his distance. Nobody close enough to hit already, the nearest within
   * LUNGE.range, inside a narrow cone ahead, a clear line to him.
   */
  private findLunge(): Vector3 | null {
    const list = this.lungeTargets?.();
    if (!list?.length) return null;
    this.viewBasis();
    const eye = this.player.camera.position;
    const fl = Math.hypot(this.fwd.x, this.fwd.z) || 1;
    const fx = this.fwd.x / fl, fz = this.fwd.z / fl;
    let best: Vector3 | null = null;
    let bd = LUNGE.range;
    for (const p of list) {
      const dx = p.x - eye.x, dz = p.z - eye.z;
      const d = Math.hypot(dx, dz);
      if (Math.abs(p.y + 0.4 - eye.y) > 1.6) continue;
      if (d <= LUNGE.reach) return null; // in reach already: a plain swing
      if (d > bd || (dx * fx + dz * fz) / d < LUNGE.cone) continue;
      // nothing of the level between you
      this.ray.origin.copyFrom(eye);
      this.ray.direction.set(dx / d, (p.y + 0.4 - eye.y) / d, dz / d).normalize();
      this.ray.length = d;
      const h = this.scene.pickWithRay(this.ray, (m) => (m.metadata as { kind?: number } | undefined)?.kind === HitKind.Level && m.isPickable, false);
      if (h?.hit && h.distance < d - 0.5) continue;
      best = p;
      bd = d;
    }
    return best ? best.clone() : null;
  }

  private startMelee() {
    const w = this.weapon;
    if (w.cfg.knife) {
      this.startKnife(false);
      return;
    }
    if (this.meleeT >= 0 || this.meleeCd > 0 || w.isGrenade || w.state !== "ready") return;
    this.meleeStyle = w.cfg.id === "glock" ? "pistol" : "rifle";
    this.meleeT = 0;
    this.meleeHitDone = false;
    this.input.cancelAim();
    this.audio.play("meleeSwing", { volume: 0.6, pitchVar: 0.08 });
  }

  /** gun inspect (the carbine's authored check): progress 0..1, -1 = none; any action cuts it short */
  inspectT = -1;
  private startInspect() {
    const w = this.weapon;
    if (w.cfg.id !== "carbine" || w.state !== "ready" || this.inspectT >= 0 || this.meleeT >= 0 || this.player.sprinting || this.adsT > 0.05) return;
    this.inspectT = 0;
  }
  private updateInspect(dt: number) {
    if (this.inspectT < 0) return;
    const w = this.weapon;
    const inp = this.input;
    if (w.cfg.id !== "carbine" || w.state !== "ready" || this.meleeT >= 0 || this.player.sprinting || inp.fireHeld || inp.adsHeld || !this.player.alive) {
      this.inspectT = -1;
      return;
    }
    this.inspectT += dt / (1.6 / 1.0);
    if (this.inspectT >= 1) this.inspectT = -1;
  }

  private updateMelee(dt: number) {
    this.meleeCd -= dt;
    if (this.meleeT < 0) return;
    this.meleeT += dt / MELEE.duration;
    if (!this.meleeHitDone && this.meleeT >= MELEE.strikeAt) {
      this.meleeHitDone = true;
      const c = MELEE[this.meleeStyle];
      this.strike({ range: MELEE.range, damage: c.damage, behind: MELEE.behindDamage, force: c.force, knife: false, headMul: 1 });
    }
    if (this.meleeT >= 1) {
      this.meleeT = -1;
      this.meleeCd = MELEE.cooldown;
    }
  }

  /** a short fan of rays from the eye — the first soldier it finds takes the blow */
  private strike(o: { range: number; damage: number; behind: number; force: number; knife: boolean; headMul: number }) {
    this.viewBasis();
    const eye = this.player.camera.position;
    const yaws = [0, -0.2, 0.2, -0.42, 0.42];
    const pitches = [0, 0.18, -0.15];
    for (const pv of pitches) {
      for (const yv of yaws) {
        const d = this.dir.copyFrom(this.fwd).addInPlace(this.tmp.copyFrom(this.right).scaleInPlace(Math.tan(yv))).addInPlace(this.tmp.copyFrom(this.up).scaleInPlace(Math.tan(pv))).normalize();
        this.ray.origin.copyFrom(eye);
        this.ray.direction.copyFrom(d);
        this.ray.length = o.range;
        const hit = this.scene.pickWithRay(this.ray, this.bulletPredicate as never, false);
        if (!hit?.hit || !hit.pickedMesh || !hit.pickedPoint) continue;
        const md = hit.pickedMesh.metadata as { kind: number; enemy?: EnemyHitTarget; zone?: BodyZone };
        if (md.kind !== HitKind.EnemyPart || !md.enemy) return this.meleeWall(hit.pickedPoint, d, o.knife); // hit a wall first
        const e = md.enemy;
        // from behind (he's facing away): takedown
        const ex = Math.sin(e.heading), ez = Math.cos(e.heading);
        const behind = ex * d.x + ez * d.z > 0.45;
        const head = md.zone === "head";
        const dmg = behind ? o.behind : o.damage * (head ? o.headMul : 1);
        const dir = d.clone();
        dir.y = 0.1;
        dir.normalize();
        const killed = e.applyHit(dmg, head ? "head" : "torso", dir, hit.pickedPoint, { kind: "melee", force: o.force * (behind ? 0.7 : 1) });
        if (o.knife) this.audio.play("knifeStab", { volume: 0.95, pitchVar: 0.07 });
        else this.audio.play("meleeHit", { volume: 0.95, pitchVar: 0.06 });
        this.events.onHit(head ? "head" : "body", killed);
        this.viewmodel.kick(0.02, 0.05, 1);
        this.player.shake(o.knife ? 0.2 : 0.35);
        this.fx.bloodHit(hit.pickedPoint, dir, o.knife);
        this.events.onShot(eye, 0.4);
        return;
      }
    }
  }
  private meleeWall(p: Vector3, d: Vector3, knife = false) {
    if (knife) this.audio.play("knifeWall", { volume: 0.6, pitchVar: 0.1 });
    else this.audio.play("meleeHit", { volume: 0.5, pitchVar: 0.1, rate: 1.25 });
    this.viewmodel.kick(0.03, 0.08, 1);
    this.player.shake(0.25);
    this.fx.impact(p, d.scale(-1), "concrete", true);
  }

  update(dt: number) {
    this.updateShotStreak();
    const inp = this.input;
    const alive = this.player.alive;
    if (alive && inp.hit("melee")) this.startMelee();
    if (alive && inp.hit("inspect")) this.startInspect();
    this.updateInspect(dt);
    if (alive && inp.hit("knife")) this.startQuickKnife();
    this.updateMelee(dt);
    // knife: fire = slash (alternating), aim button = heavy stab; a click just before it's ready still counts
    const kw = this.weapon;
    if (alive && kw.cfg.knife && kw.state === "ready" && this.knifeT < 0) {
      const fresh = this.knifePress !== inp.firePressTime;
      const pressAge = (performance.now() - inp.firePressTime) / 1000;
      if (inp.hit("aim")) this.startKnife(true);
      else if (fresh && (inp.firePressed || pressAge <= kw.cfg.inputBuffer)) {
        this.knifePress = inp.firePressTime;
        this.startKnife(false);
      }
    }
    this.updateKnife(dt);
    this.updateQuickKnife();

    if (alive) {
      SLOT_ORDER.forEach((slot, k) => {
        if (inp.hit(("weapon" + (k + 1)) as Action)) this.slotKey(slot);
      });
      if (inp.hit("lastWeapon") && this.isCarried(this.previous)) this.requestSwitch(this.previous);
      if (inp.wheel !== 0) {
        // through the carried slots in order, skipping an empty belt
        const list = (this.arsenal ? SLOT_ORDER.flatMap((s) => this.weapons.map((_, i) => i).filter((i) => this.slotOf(i) === s)) : SLOT_ORDER.map((s) => this.carried[s])).filter((i) => i >= 0 && !(this.weapons[i].isGrenade && this.grenades <= 0));
        const at = Math.max(0, list.indexOf(this.current));
        if (list.length) this.requestSwitch(list[(at + (inp.wheel > 0 ? 1 : list.length - 1)) % list.length]);
      }
      // quick throw: out comes the grenade, it's thrown, the gun comes back
      // B: next grenade type (re-draws it if it's in your hand)
      if (inp.hit("grenadeType")) {
        const gw = this.grenadeWeapon;
        if (gw && gw.throwPhase === "idle" && this.cycleGrenade()) {
          this.audio.play("weaponSwitch", { volume: 0.35 });
          if (this.weapon === gw && gw.state !== "holstering") gw.equip();
        }
      }
      if (inp.hit("grenade")) {
        const gi = this.grenadeSlot;
        if (gi >= 0 && this.inventory[this.nadeType] <= 0) this.cycleGrenade();
        if (gi >= 0 && this.inventory[this.nadeType] > 0) {
          if (this.current === gi) {
            if (this.weapon.state === "ready" && this.weapon.throwPhase === "idle") this.weapon.autoThrow = true;
          } else {
            this.returnTo = this.pending >= 0 ? this.pending : this.current;
            this.quickThrow = true;
            this.requestSwitch(gi);
          }
        } else this.events.onNoGrenades?.();
      }
      if (inp.hit("throwKnife")) this.startKnifeThrow();
      if (inp.hit("sprint")) inp.cancelAim();
    }

    // complete a pending switch once holstered
    if (this.pending >= 0 && this.weapon.state === "holstered") {
      this.previous = this.current;
      this.current = this.pending;
      this.pending = -1;
      this.weapon.equip();
      if (this.arsenal) this.carried[this.slotOf(this.current)] = this.current;
    }
    // back from the quick knife: the interrupted reload carries on
    if (this.resumeReload >= 0 && this.current === this.resumeReload && this.weapon.state === "ready") {
      this.resumeReload = -1;
      this.weapon.tryReload();
    } else if (this.resumeReload >= 0 && this.current !== this.resumeReload && this.pending !== this.resumeReload) this.resumeReload = -1;

    const w = this.weapon;
    if (w.isGrenade && w.throwPhase === "idle") {
      if (this.inventory[this.nadeType] <= 0) this.cycleGrenade();
      w.mag = this.inventory[this.nadeType];
    }
    if (w.isGrenade && this.quickThrow && w.state === "ready" && w.throwPhase === "idle") {
      w.autoThrow = true;
      this.quickThrow = false;
    }
    const pressAge = (performance.now() - inp.firePressTime) / 1000;
    // a quick knife throw whose switch never happened (refused, or another weapon picked meanwhile):
    // dropped, or it would hold the key off for good
    const gs = this.grenadeSlot;
    if (this.knifeThrow && this.current !== gs && this.pending !== gs && !this.thrown) {
      const t = this.knifeThrow.restore;
      this.knifeThrow = null;
      this.quickThrow = false;
      if (t !== "knife" && this.inventory[t] > 0) this.setGrenadeType(t);
    }
    w.noPin = w.isGrenade && this.nadeType === "knife";
    w.throwRate = w.noPin ? THROWING_KNIFE.throwRate : 1;
    // (a quick knife throw is held ready by its own key)
    const knifeHeld = !!this.knifeThrow && w.isGrenade && inp.held("throwKnife");
    const shots = w.update(dt, {
      triggerHeld: alive && this.meleeT < 0 && (inp.fireHeld || knifeHeld) && !(this.player.sprinting && !w.isGrenade),
      triggerPressed: alive && this.meleeT < 0 && inp.firePressed,
      pressAge: alive ? pressAge : 99,
      pressId: inp.firePressTime,
      reloadPressed: alive && inp.hit("reload"),
      altHeld: inp.rmbDown,
    });
    for (let i = 0; i < shots; i++) this.fire(w);
    if (w.isGrenade) this.inventory[this.nadeType] = w.mag;
    // launchers load the next rocket on their own once the shot has cleared the tube
    if (w.cfg.projectile && w.state === "ready" && w.mag === 0 && w.reserve > 0 && w.sinceShot > 0.55) w.tryReload();
    // after a throw: quick throw returns to the gun; the last grenade always does
    if (w.isGrenade && this.thrown && w.throwPhase === "idle" && this.pending < 0) {
      this.thrown = false;
      // that type is spent: the next type comes up from the belt
      if (w.mag <= 0 && this.returnTo < 0 && this.cycleGrenade()) w.equip();
      if (this.returnTo >= 0 || this.grenades <= 0) {
        const back = this.isCarried(this.returnTo) ? this.returnTo : this.isCarried(this.previous) && !this.weapons[this.previous].isGrenade ? this.previous : (["primary", "smg", "sniper", "secondary"] as LoadoutSlot[]).map((s) => this.carried[s]).find((i) => i >= 0) ?? this.carried.melee;
        this.returnTo = -1;
        this.requestSwitch(back);
      }
      if (this.knifeThrow) {
        const t = this.knifeThrow.restore;
        this.knifeThrow = null;
        if (t !== "knife" && this.inventory[t] > 0) this.setGrenadeType(t);
      }
    }

    // ADS + sprint blends
    if (!alive || this.player.sprinting) inp.cancelAim();
    const adsWanted = alive && inp.adsHeld && w.canAds && !this.player.sprinting && this.meleeT < 0;
    const adsRate = 1 / w.cfg.adsTime;
    this.adsT = clamp(this.adsT + (adsWanted ? adsRate : -adsRate * 1.25) * dt, 0, 1);
    const adsEase = this.adsT * this.adsT * (3 - 2 * this.adsT);
    this.sprintT += ((this.player.sprinting && w.state !== "holstering" ? 1 : 0) - this.sprintT) * damp(this.player.sprinting ? 9 : 16, dt);

    this.currentSpread = w.spread(adsEase, this.player.moveAmount, !this.player.grounded, this.player.stance);

    // rig parts + viewmodel pose
    const ph = w.reloadPhase;
    w.rig.animate({
      phase: ph?.id ?? null,
      t: Math.min(1, w.reloadT),
      sinceShot: w.sinceShot,
      emptyReload: w.reloadEmpty,
      weaponState: w.state,
      raised: w.raised,
      mag: w.mag,
      clip: ph?.clip ?? null,
      clipName: ph?.clipName ?? null,
      throwPhase: w.throwPhase,
      throwT: w.throwT,
      lob: w.lob,
      swing: w.cfg.knife ? this.knifeT : null,
      swingKind: w.cfg.knife ? this.knifeKind : null,
      inspect: this.inspectT,
      rpm: w.cfg.rpm,
      dt,
    });
    const v = this.player.velocity;
    const yaw = this.player.yaw;
    const lateral = v.x * Math.cos(yaw) - v.z * Math.sin(yaw);
    this.viewmodel.update(dt, {
      rig: w.rig,
      adsT: adsEase,
      sprintT: this.sprintT,
      raised: w.raised,
      reloadPhase: ph?.id ?? null,
      reloadT: Math.min(1, w.reloadT),
      moveAmount: this.player.moveAmount,
      grounded: this.player.grounded,
      verticalVel: 0,
      lateralVel: lateral,
      crouched: this.player.crouched,
      prone: this.player.prone,
      mouseDX: inp.mouseDX,
      mouseDY: inp.mouseDY,
      swayAmount: w.cfg.sway.amount,
      swayAdsScale: w.cfg.sway.adsScale,
      swaySmoothing: w.cfg.sway.smoothing,
      gaitPhase: this.player.gaitPhase,
      gaitAmt: this.player.bobAmt,
      melee: this.meleeT,
      meleeStyle: this.meleeStyle,
    });
  }

  // ------------------------------------------------------------------ shooting
  private viewBasis() {
    const p = this.player;
    const cy = Math.cos(p.yaw);
    const sy = Math.sin(p.yaw);
    const cp = Math.cos(p.pitch);
    const sp = Math.sin(p.pitch);
    this.fwd.set(sy * cp, -sp, cy * cp);
    this.right.set(cy, 0, -sy);
    Vector3.CrossToRef(this.fwd, this.right, this.up); // LH: fwd × right = up
  }

  private chain: TransformNode[] = [];
  private worldOf(node: TransformNode, out: Vector3) {
    // force the whole parent chain so the result reflects this frame's pose
    this.chain.length = 0;
    for (let n: TransformNode | null = node; n; n = n.parent as TransformNode | null) this.chain.push(n);
    for (let i = this.chain.length - 1; i >= 0; i--) this.chain[i].computeWorldMatrix(true);
    out.copyFrom(node.getAbsolutePosition());
    return out;
  }

  private throwVel = new Vector3();
  private throwGrenade(w: Weapon) {
    this.viewBasis();
    this.worldOf(w.rig.muzzle, this.muzzleWorld);
    // never spawn inside a wall: start from the eye if the hand is on the other side of one
    const eye = this.player.camera.position;
    this.ray.origin.copyFrom(eye);
    this.tmp.copyFrom(this.muzzleWorld).subtractInPlace(eye);
    const len = this.tmp.length();
    this.ray.direction.copyFrom(this.tmp).scaleInPlace(1 / Math.max(1e-4, len));
    this.ray.length = len + 0.05;
    const block = this.scene.pickWithRay(this.ray, this.bulletPredicate as never, false);
    const origin = block?.hit ? eye.add(this.fwd.scale(0.05)) : this.muzzleWorld.clone();
    const lob = w.lob;
    if (GRENADE_TYPES[this.nadeType].knife) {
      // a knife flies where you look: from the eye line (so it meets the crosshair), fast and nearly flat
      this.throwVel.copyFrom(this.fwd).scaleInPlace(THROWING_KNIFE.speed);
      this.throwVel.y += THROWING_KNIFE.lift;
      this.throwVel.addInPlace(this.tmp.copyFrom(this.player.velocity).scaleInPlace(0.5));
      const from = block?.hit ? origin : eye.add(this.fwd.scale(0.35)).addInPlace(this.right.scale(0.12)).addInPlace(this.up.scale(-0.04));
      this.events.onThrow(this.nadeType, from, this.throwVel.clone());
      this.thrown = true;
      return;
    }
    const speed = (lob ? GRENADE.lobSpeed : GRENADE.throwSpeed) * GRENADE_TYPES[this.nadeType].speed;
    this.throwVel.copyFrom(this.fwd).scaleInPlace(speed);
    this.throwVel.y += lob ? 1.8 : GRENADE.upBoost;
    this.throwVel.addInPlace(this.tmp.copyFrom(this.player.velocity).scaleInPlace(0.6));
    this.events.onThrow(this.nadeType, origin, this.throwVel.clone());
    this.audio.play("grenadeThrow", { volume: 0.55, pitchVar: 0.06 });
    this.thrown = true;
    this.shotsFired += 0; // grenades don't count towards accuracy
  }

  private fire(w: Weapon) {
    if (w.isGrenade) {
      this.throwGrenade(w);
      return;
    }
    const cfg = w.cfg;
    this.viewBasis();
    const origin = this.player.camera.position; // world (camera has no parent)
    const adsEase = this.adsT * this.adsT * (3 - 2 * this.adsT);
    const spreadDeg = w.spread(adsEase, this.player.moveAmount, !this.player.grounded, this.player.stance);

    this.worldOf(w.rig.muzzle, this.muzzleWorld);

    // aim direction for the whole shot (aim spread), pellets add their own cone
    const aim = this.coneDir(this.fwd, spreadDeg * DEG, new Vector3());
    const pellets = cfg.damage.pellets;
    let anyHit = false;
    let headHit = false;
    let killed = false;
    let firstImpact = true;
    if (cfg.projectile) {
      this.launch(w, cfg.projectile, aim, adsEase);
      return;
    }
    for (let i = 0; i < pellets; i++) {
      const d = pellets > 1 ? this.coneDir(aim, (cfg.spread.pelletCone ?? 0) * DEG, this.dir) : this.dir.copyFrom(aim);
      const hit = this.pickThroughGlass(origin, d, cfg.damage.range);
      const res = this.resolveHit(cfg, hit, d, firstImpact);
      if (res === "level") firstImpact = false;
      if (res === "head" || res === "headKill") headHit = true;
      if (res === "kill" || res === "headKill") killed = true;
      if (res !== "miss" && res !== "level") anyHit = true;
      // tracer (rifle every Nth round, from the muzzle)
      if (cfg.tracerEvery > 0 && w.shotCount % cfg.tracerEvery === 0 && i === 0) {
        if (hit?.hit && hit.pickedPoint) this.endPoint.copyFrom(hit.pickedPoint);
        else this.endPoint.copyFrom(origin).addInPlace(this.tmp.copyFrom(d).scaleInPlace(cfg.damage.range));
        this.fx.tracer(this.muzzleWorld, this.endPoint);
      }
    }
    this.shotsFired++;
    if (anyHit) {
      this.shotsHit++;
      this.events.onHit(headHit ? "head" : "body", killed);
    }

    // presentation — all in the same frame as the hit test
    this.fx.fireFlash(w.flash);
    // recorded guns: the first round of a string gets the full shot (with its room tail),
    // follow-up rounds get auto slices that carry the continuous echo, the release tail ends it
    const now = this.audio.ctx.currentTime;
    const cont = !!cfg.sounds.auto && now - this.lastShotAt < (60 / cfg.rpm) * 1.7;
    this.streak = cont ? this.streak + 1 : 1;
    this.lastShotAt = now;
    this.streakCfg = cfg;
    this.audio.play(cont ? cfg.sounds.auto! : cfg.sounds.fire, {
      volume: cfg.sounds.fireVolume ?? (cfg.fireMode === "pump" ? 0.95 : 0.78),
      rate: cfg.sounds.fireRate ?? 1,
      pitchVar: cfg.sounds.auto ? 0.015 : 0.035,
      reverb: cfg.sounds.auto ? 0.12 : cfg.noise !== undefined && cfg.noise < 0.5 ? 0.2 : 0.5,
    });
    if (cfg.sounds.tail && this.audio.canPlay("tail" + cfg.id, cfg.fireMode === "pump" ? 0 : 0.09)) {
      this.audio.play(cfg.sounds.tail, { volume: cfg.fireMode === "pump" ? 0.5 : 0.32, pitchVar: 0.05, delay: 0.015, reverb: 0.9 });
    }
    if (cfg.ejectOn === "fire") this.eject(w);
    if (cfg.fireMode !== "auto" || w.shotCount % 4 === 0) this.fx.muzzleSmoke(this.muzzleWorld, this.fwd, cfg.fireMode === "pump" ? 8 : 2);

    const r = cfg.recoil;
    const adsScale = 1 - (1 - r.adsScale) * adsEase;
    const pitch = (r.pitch + rand(-r.pitchJitter, r.pitchJitter)) * adsScale * (this.player.prone ? 0.62 : this.player.crouched ? 0.85 : 1);
    const yaw = (rand(-r.yaw, r.yaw) + r.yawBias) * adsScale;
    this.player.addRecoil(pitch, yaw, r.recoveryFraction, r.recovery, r.kickRot * 6);
    this.viewmodel.kick(r.kickBack, r.kickRot, adsScale);
    this.events.onShot(origin, cfg.noise ?? 1);
    this.events.onFire?.(this.muzzleWorld, aim, cfg.id);
  }

  /** bullet ray that shatters any window it meets and carries on behind it */
  private pickThroughGlass(origin: Vector3, d: Vector3, range: number) {
    this.ray.origin.copyFrom(origin);
    this.ray.direction.copyFrom(d);
    this.ray.length = range;
    let hit = this.scene.pickWithRay(this.ray, this.bulletPredicate as never, false);
    for (let k = 0; k < 4 && hit?.hit && hit.pickedPoint && this.events.onGlass?.(hit.pickedMesh, hit.pickedPoint, d); k++) {
      const used = hit.distance + 0.03;
      this.ray.origin.copyFrom(origin).addInPlace(this.tmp.copyFrom(d).scaleInPlace(used));
      this.ray.length = range - used;
      const next = this.scene.pickWithRay(this.ray, this.bulletPredicate as never, false);
      if (next?.hit) next.distance += used;
      hit = next;
    }
    return hit;
  }

  /** rocket launchers: the rocket leaves the muzzle towards whatever the crosshair is on */
  private launch(w: Weapon, p: ProjectileConfig, aim: Vector3, adsEase: number) {
    const cfg = w.cfg;
    const eye = this.player.camera.position;
    // aim point: what the (spread) view ray hits, so the rocket converges on the crosshair
    this.ray.origin.copyFrom(eye);
    this.ray.direction.copyFrom(aim);
    this.ray.length = 400;
    const hit = this.scene.pickWithRay(this.ray, this.bulletPredicate as never, false);
    const target = hit?.hit && hit.pickedPoint && hit.distance > 2.5 ? hit.pickedPoint : eye.add(aim.scale(400));
    // never launch from inside a wall: start at the eye if the muzzle is past one
    this.tmp.copyFrom(this.muzzleWorld).subtractInPlace(eye);
    const len = this.tmp.length();
    this.ray.direction.copyFrom(this.tmp).scaleInPlace(1 / Math.max(1e-4, len));
    this.ray.length = len + 0.1;
    const block = this.scene.pickWithRay(this.ray, this.bulletPredicate as never, false);
    const origin = block?.hit ? eye.add(aim.scale(0.1)) : this.muzzleWorld.clone();
    const dir = target.subtract(origin).normalize();
    this.events.onRocket?.(origin, dir, p);
    this.shotsFired++;

    this.fx.fireFlash(w.flash);
    this.audio.play(cfg.sounds.fire, { volume: cfg.sounds.fireVolume ?? 1, rate: cfg.sounds.fireRate ?? 1, pitchVar: 0.03, reverb: 0.9 });
    this.fx.muzzleSmoke(this.muzzleWorld, this.fwd, 10);
    // backblast out of the rear of the tube
    this.worldOf(w.rig.eject, this.tmp);
    this.events.onBackblast?.(this.tmp.clone(), this.fwd.scale(-1), this.muzzleWorld.clone());
    const r = cfg.recoil;
    const adsScale = 1 - (1 - r.adsScale) * adsEase;
    const pr = this.player.prone ? 0.62 : this.player.crouched ? 0.85 : 1;
    this.player.addRecoil((r.pitch + rand(-r.pitchJitter, r.pitchJitter)) * adsScale * pr, rand(-r.yaw, r.yaw) * adsScale, r.recoveryFraction, r.recovery, r.kickRot * 6);
    this.player.shake(0.32);
    this.viewmodel.kick(r.kickBack, r.kickRot, adsScale);
    this.events.onShot(eye, cfg.noise ?? 1.5);
  }

  private eject(w: Weapon) {
    this.viewBasis();
    this.worldOf(w.rig.eject, this.tmp);
    this.fx.ejectCasing(this.tmp, this.right, this.up, this.fwd, this.player.velocity, w.cfg.fireMode === "pump");
  }

  private resolveHit(cfg: WeaponConfig, hit: PickingInfo | null, dir: Vector3, loudImpact: boolean): "miss" | "level" | "body" | "head" | "kill" | "headKill" {
    if (!hit?.hit || !hit.pickedMesh || !hit.pickedPoint) return "miss";
    const md = hit.pickedMesh.metadata as { kind: number; surface?: SurfaceType; enemy?: EnemyHitTarget; zone?: BodyZone };
    if (md.kind === HitKind.EnemyPart && md.enemy) {
      const dmgCfg = cfg.damage;
      const dist = hit.distance;
      const fall = clamp((dist - dmgCfg.falloffStart) / (dmgCfg.falloffEnd - dmgCfg.falloffStart), 0, 1);
      const scale = 1 - fall * (1 - dmgCfg.minDamageScale);
      const zone = md.zone ?? "torso";
      const zm = zone === "head" ? dmgCfg.headMultiplier : zone === "limb" ? dmgCfg.limbMultiplier : 1;
      const killed = md.enemy.applyHit(dmgCfg.base * scale * zm, zone, dir, hit.pickedPoint);
      this.fx.bloodHit(hit.pickedPoint, dir, zone === "head");
      if (this.audio.canPlay("flesh", 0.03)) this.audio.play("fleshHit", { x: hit.pickedPoint.x, y: hit.pickedPoint.y, z: hit.pickedPoint.z, volume: 0.55 });
      if (zone === "head") return killed ? "headKill" : "head";
      return killed ? "kill" : "body";
    }
    const n = hit.getNormal(true, false) ?? this.tmp.copyFrom(dir).scaleInPlace(-1);
    this.fx.impact(hit.pickedPoint, n, md.surface ?? "concrete", loudImpact);
    return "level";
  }

  /** Random direction inside a cone (uniform over the disc). */
  private coneDir(axis: Vector3, halfAngle: number, out: Vector3) {
    if (halfAngle <= 0) return out.copyFrom(axis);
    const r = Math.sqrt(Math.random()) * Math.tan(halfAngle);
    const a = Math.random() * Math.PI * 2;
    // basis around axis
    const helper = Math.abs(axis.y) < 0.95 ? Vector3.UpReadOnly : Vector3.RightReadOnly;
    const u = Vector3.Cross(helper, axis).normalize();
    const v = Vector3.Cross(axis, u);
    out.copyFrom(axis)
      .addInPlace(u.scaleInPlace(Math.cos(a) * r))
      .addInPlace(v.scaleInPlace(Math.sin(a) * r))
      .normalize();
    return out;
  }

  /** Infinite ammo refill used by nothing in Phase 1 except debug. */
  refill() {
    for (const w of this.weapons) w.reserve = w.cfg.reserveMax;
  }
}
