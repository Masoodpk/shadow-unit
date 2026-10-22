/**
 * Data-driven weapon definitions. Nothing about a specific gun lives in the
 * player or the weapon state machine — tune feel here.
 */

export type WeaponId = "rifle" | "ak47" | "m5" | "vssk" | "glock" | "vector" | "flashbang" | "knife" | "m72" | "dzj08";
/**
 * auto = hold to fire; semi = one shot per click; pump = one shot per click + pump cycle;
 * throw = grenade (press = pin, release = throw); melee = knife (click = slash, aim button = heavy stab).
 */
export type FireMode = "auto" | "semi" | "pump" | "throw" | "melee";

/** A fired projectile instead of a hitscan ray (rocket launchers). */
export interface ProjectileConfig {
  /** launch speed (m/s) and the slight drop it has in flight (m/s²) */
  speed: number;
  gravity: number;
  /** blast radius (m), damage at the centre, extra damage to whoever it hits directly */
  radius: number;
  damage: number;
  direct: number;
  /** seconds before it self-destructs in the air */
  life: number;
  /** looping sound while it flies (a burning motor, or just air for a burnt-out one) */
  flightSound: string;
}

/** Knife attacks (fireMode "melee"). */
export interface KnifeConfig {
  /** quick slash (fire) and heavy stab (aim button) */
  light: { damage: number; time: number; hitAt: number; range: number };
  heavy: { damage: number; time: number; hitAt: number; range: number };
  /** any hit from behind is a takedown */
  backstab: number;
}

/** Events a reload phase can emit at a normalised time (0..1) inside the phase. */
export type ReloadEventType =
  | "transferMag" // atomically fill magazine from reserve
  | "transferOne" // move one round from reserve into magazine
  | "sound";

export interface ReloadEvent {
  t: number;
  type: ReloadEventType;
  sound?: string;
}

export interface ReloadPhase {
  /** Identifier the viewmodel rig uses to pick its animation curve. */
  id: string;
  duration: number;
  events: ReloadEvent[];
  /** Only run this phase when the reload started from an empty magazine. */
  onlyIfEmpty?: boolean;
  /** Only run this phase when the magazine still has rounds (tactical reload). */
  onlyIfNotEmpty?: boolean;
  /** Repeat while the magazine is not full and reserve > 0 (shell-by-shell). */
  loop?: boolean;
  /** Authored animation clip range [start, end] (seconds) this phase plays. */
  clip?: [number, number];
  /** Name of the authored clip (rigs with one clip per animation); omitted = the M4 pack's single timeline. */
  clipName?: string;
  /** After this normalised time the remaining (cosmetic) tail can be cut short by firing. */
  cancelAfter?: number;
}

export interface RecoilConfig {
  /** Camera pitch kick per shot, degrees. */
  pitch: number;
  pitchJitter: number;
  /** Max horizontal kick per shot, degrees (random sign, biased). */
  yaw: number;
  yawBias: number;
  /** How fast accumulated camera recoil recovers (deg/s when not firing). */
  recovery: number;
  /** Fraction of the kick that recovers automatically (0..1). */
  recoveryFraction: number;
  /** Viewmodel kick back (m) and up-rotation (rad). */
  kickBack: number;
  kickRot: number;
  /** ADS multiplier on all recoil. */
  adsScale: number;
}

export interface SpreadConfig {
  /** Degrees (cone half-angle) */
  hip: number;
  ads: number;
  moving: number;
  air: number;
  crouchScale: number;
  perShot: number;
  maxBloom: number;
  bloomRecovery: number;
  /** Pellet cone for shotguns (degrees), independent from aim spread. */
  pelletCone?: number;
}

export interface DamageConfig {
  base: number;
  pellets: number;
  headMultiplier: number;
  limbMultiplier: number;
  falloffStart: number;
  falloffEnd: number;
  minDamageScale: number;
  range: number;
}

export interface WeaponConfig {
  id: WeaponId;
  slot: number;
  displayName: string;
  fireMode: FireMode;
  rpm: number;
  magSize: number;
  reserveStart: number;
  reserveMax: number;
  damage: DamageConfig;
  spread: SpreadConfig;
  recoil: RecoilConfig;
  /** After a shot, a pump/bolt cycle that must finish before the next shot (s). */
  cycleTime: number;
  equipTime: number;
  holsterTime: number;
  adsTime: number;
  adsFovScale: number;
  /** Mouse sensitivity multiplier while fully aimed (applied on top of FOV compensation). */
  adsSensitivity: number;
  moveSpeedScale: number;
  adsMoveScale: number;
  sway: { amount: number; adsScale: number; smoothing: number };
  muzzleFlash: { scale: number; length: number; duration: number; tint: [number, number, number] };
  sounds: { fire: string; dry: string; tail?: string; cycle?: string; fireRate?: number; fireVolume?: number; /** follow-up rounds of a string (recorded auto slices) */ auto?: string; /** played once when a string of 2+ rounds ends */ release?: string };
  /** Magnified optic: at full ADS the viewmodel is hidden and a scope overlay is shown. */
  scoped?: boolean;
  /** Multiplier on how far enemies hear the shot (suppressed < 1). */
  noise?: number;
  /** Eject a casing on fire (rifle) or on the pump stroke (shotgun). */
  ejectOn: "fire" | "cycle";
  tracerEvery: number;
  reload: ReloadPhase[];
  /** Input buffering: a click this many seconds before the weapon is ready still fires. */
  inputBuffer: number;
  /** rocket launchers: what leaves the tube */
  projectile?: ProjectileConfig;
  /** knife: attack timings and damage */
  knife?: KnifeConfig;
}

/**
 * Timeline of the authored "M4 – FPS Weapon Animations Pack" (BarcodeGames, CC BY 4.0).
 * All clips live on one timeline; values are seconds.
 */
export const M4_CLIPS = {
  reload: [0.033, 3.667] as [number, number],
  reloadEmpty: [3.7, 7.5] as [number, number],
  /** Fire clip, started at the trigger-break frame. */
  fire: [7.56, 8.333] as [number, number],
  holster: [8.367, 8.933] as [number, number],
  draw: [8.967, 10.0] as [number, number],
  idle: 10.0,
  /** Left hand on the magazine as it leaves the well / as it seats (normal reload). */
  reloadMagOut: 0.87,
  reloadSeat: 2.03,
  /** Bolt locked back (first frame of the empty reload). */
  idleEmpty: 3.7,
  reloadSpeed: 1.2,
};

function clipPhase(
  id: string,
  clip: [number, number],
  speed: number,
  o: { onlyIfEmpty?: boolean; onlyIfNotEmpty?: boolean; cancelAt?: number; events: { at: number; type: ReloadEventType; sound?: string }[] },
): ReloadPhase {
  const len = clip[1] - clip[0];
  const norm = (sec: number) => (sec - clip[0]) / len;
  return {
    id,
    clip,
    duration: len / speed,
    onlyIfEmpty: o.onlyIfEmpty,
    onlyIfNotEmpty: o.onlyIfNotEmpty,
    cancelAfter: o.cancelAt !== undefined ? norm(o.cancelAt) : undefined,
    events: o.events.map((e) => ({ t: norm(e.at), type: e.type, sound: e.sound })),
  };
}

/**
 * Reload phases that follow the authored M4 arm clips (used by every weapon held
 * by the skinned arms). Events sit on the measured frames: mag out 0.87 s,
 * mag seated 2.03 s, bolt dropped 6.31 s.
 */
export interface ReloadSounds {
  out: string;
  in: string;
  bolt: string;
}
const M4_SOUNDS: ReloadSounds = { out: "m4MagOut", in: "m4MagIn", bolt: "m4Bolt" };

function m4Reload(speed: number, snd: ReloadSounds = M4_SOUNDS): ReloadPhase[] {
  return [
    clipPhase("reload", M4_CLIPS.reload, speed, {
      onlyIfNotEmpty: true,
      cancelAt: 2.4,
      events: [
        { at: 0.25, type: "sound", sound: "foley" },
        { at: 0.87, type: "sound", sound: snd.out },
        { at: 2.03, type: "sound", sound: snd.in },
        { at: 2.03, type: "transferMag" },
        { at: 2.55, type: "sound", sound: "foley" },
      ],
    }),
    clipPhase("reloadEmpty", M4_CLIPS.reloadEmpty, speed, {
      onlyIfEmpty: true,
      cancelAt: 6.65,
      events: [
        { at: 3.95, type: "sound", sound: "foley" },
        { at: 4.57, type: "sound", sound: snd.out },
        { at: 5.73, type: "sound", sound: snd.in },
        { at: 5.73, type: "transferMag" },
        { at: 6.31, type: "sound", sound: snd.bolt },
      ],
    }),
  ];
}

/**
 * KRISS Vector viewmodel (MW2019 "Fennec" rig) — one clip per animation, seconds,
 * measured from the magazine / hand joint curves.
 */
export const VECTOR_CLIPS = {
  draw: [0, 1.62] as [number, number],
  holster: [0, 0.58] as [number, number],
  fire: [0, 0.75] as [number, number],
  reload: [0, 3.8] as [number, number],
  reloadMagOut: 1.08,
  reloadSeat: 2.88,
  reloadEmpty: [0, 4.3] as [number, number],
  reloadEmptyMagOut: 0.7,
  reloadEmptySeat: 2.38,
  reloadEmptyBolt: 3.02,
  idle: 1.74,
};

function vectorReload(speed: number): ReloadPhase[] {
  const C = VECTOR_CLIPS;
  const r = clipPhase("reload", C.reload, speed, {
    onlyIfNotEmpty: true,
    cancelAt: 3.15,
    events: [
      { at: 0.2, type: "sound", sound: "foley" },
      { at: C.reloadMagOut, type: "sound", sound: "vectorMagOut" },
      { at: C.reloadSeat, type: "sound", sound: "vectorMagIn" },
      { at: C.reloadSeat, type: "transferMag" },
      { at: 3.3, type: "sound", sound: "foley" },
    ],
  });
  const e = clipPhase("reloadEmpty", C.reloadEmpty, speed, {
    onlyIfEmpty: true,
    cancelAt: 3.5,
    events: [
      { at: 0.2, type: "sound", sound: "foley" },
      { at: C.reloadEmptyMagOut, type: "sound", sound: "vectorMagOut" },
      { at: C.reloadEmptySeat, type: "sound", sound: "vectorMagIn" },
      { at: C.reloadEmptySeat, type: "transferMag" },
      { at: C.reloadEmptyBolt, type: "sound", sound: "vectorBolt" },
    ],
  });
  r.clipName = "reload";
  e.clipName = "reload_empty";
  return [r, e];
}

/**
 * Launchers have no magazine clip in the arms pack: the reload lowers the launcher out of
 * view (holster clip), a fresh rocket goes in, and it comes back up (draw clip).
 */
function launcherReload(duration: number): ReloadPhase[] {
  return [
    {
      id: "launcherReload",
      clipName: "holsterDraw",
      duration,
      cancelAfter: 0.8,
      events: [
        { t: 0.05, type: "sound", sound: "foley" },
        { t: 0.42, type: "sound", sound: "rocketLoad" },
        { t: 0.5, type: "transferMag" },
        { t: 0.75, type: "sound", sound: "foley" },
      ],
    },
  ];
}

const NO_RECOIL: RecoilConfig = { pitch: 0, pitchJitter: 0, yaw: 0, yawBias: 0, recovery: 10, recoveryFraction: 1, kickBack: 0, kickRot: 0, adsScale: 1 };

export const WEAPONS: Record<WeaponId, WeaponConfig> = {
  rifle: {
    id: "rifle",
    slot: 0,
    displayName: "M4 CARBINE",
    fireMode: "auto",
    rpm: 720,
    magSize: 30,
    reserveStart: 240,
    reserveMax: 360,
    damage: {
      base: 26,
      pellets: 1,
      headMultiplier: 2.6,
      limbMultiplier: 0.75,
      falloffStart: 35,
      falloffEnd: 90,
      minDamageScale: 0.6,
      range: 180,
    },
    spread: { hip: 1.6, ads: 0.12, moving: 1.4, air: 3.5, crouchScale: 0.75, perShot: 0.22, maxBloom: 2.2, bloomRecovery: 6 },
    recoil: {
      pitch: 0.62,
      pitchJitter: 0.14,
      yaw: 0.28,
      yawBias: 0.12,
      recovery: 9,
      recoveryFraction: 0.7,
      kickBack: 0.012,
      kickRot: 0.018,
      adsScale: 0.65,
    },
    cycleTime: 0,
    // authored Draw (1.03 s) / Holster (0.57 s) clips played ~1.75x
    equipTime: 0.59,
    holsterTime: 0.32,
    adsTime: 0.17,
    adsFovScale: 0.78,
    adsSensitivity: 0.9,
    moveSpeedScale: 1.0,
    adsMoveScale: 0.62,
    sway: { amount: 1.0, adsScale: 0.18, smoothing: 14 },
    muzzleFlash: { scale: 0.17, length: 0.3, duration: 0.045, tint: [1.0, 0.8, 0.5] },
    sounds: { fire: "m4Shot", dry: "dryFire", tail: "rifleTail" },
    ejectOn: "fire",
    tracerEvery: 3,
    inputBuffer: 0.0,
    // Phases mirror the authored M4 clips; events fire at the frame the mag
    // actually seats / the bolt actually drops (measured from the animation curves).
    reload: m4Reload(M4_CLIPS.reloadSpeed),
  },

  ak47: {
    id: "ak47",
    slot: 0,
    displayName: "AK-47",
    fireMode: "auto",
    rpm: 600,
    magSize: 30,
    reserveStart: 210,
    reserveMax: 360,
    damage: { base: 34, pellets: 1, headMultiplier: 2.4, limbMultiplier: 0.75, falloffStart: 30, falloffEnd: 85, minDamageScale: 0.6, range: 180 },
    spread: { hip: 2.0, ads: 0.2, moving: 1.6, air: 3.8, crouchScale: 0.75, perShot: 0.32, maxBloom: 2.8, bloomRecovery: 5 },
    recoil: { pitch: 0.95, pitchJitter: 0.22, yaw: 0.42, yawBias: 0.18, recovery: 8, recoveryFraction: 0.62, kickBack: 0.016, kickRot: 0.024, adsScale: 0.7 },
    cycleTime: 0,
    equipTime: 0.62,
    holsterTime: 0.34,
    adsTime: 0.2,
    adsFovScale: 0.8,
    adsSensitivity: 0.9,
    moveSpeedScale: 0.96,
    adsMoveScale: 0.6,
    sway: { amount: 1.15, adsScale: 0.2, smoothing: 13 },
    muzzleFlash: { scale: 0.2, length: 0.36, duration: 0.05, tint: [1.0, 0.72, 0.42] },
    sounds: { fire: "akShot", auto: "akAuto", release: "akTail", dry: "dryFire", fireVolume: 0.95 },
    ejectOn: "fire",
    tracerEvery: 3,
    inputBuffer: 0,
    reload: m4Reload(1.05, { out: "akMagOut", in: "akMagIn", bolt: "akBolt" }),
  },

  m5: {
    id: "m5",
    slot: 0,
    displayName: "COLT M5 SCW",
    fireMode: "auto",
    rpm: 800,
    magSize: 30,
    reserveStart: 240,
    reserveMax: 360,
    damage: { base: 24, pellets: 1, headMultiplier: 2.5, limbMultiplier: 0.75, falloffStart: 25, falloffEnd: 70, minDamageScale: 0.55, range: 150 },
    spread: { hip: 1.4, ads: 0.15, moving: 1.1, air: 3.2, crouchScale: 0.75, perShot: 0.18, maxBloom: 1.9, bloomRecovery: 7 },
    recoil: { pitch: 0.5, pitchJitter: 0.12, yaw: 0.24, yawBias: 0.08, recovery: 10, recoveryFraction: 0.72, kickBack: 0.01, kickRot: 0.015, adsScale: 0.62 },
    cycleTime: 0,
    equipTime: 0.5,
    holsterTime: 0.28,
    adsTime: 0.14,
    adsFovScale: 0.8,
    adsSensitivity: 0.92,
    moveSpeedScale: 1.03,
    adsMoveScale: 0.68,
    sway: { amount: 0.9, adsScale: 0.16, smoothing: 15 },
    muzzleFlash: { scale: 0.18, length: 0.32, duration: 0.04, tint: [1.0, 0.82, 0.55] },
    sounds: { fire: "m5Shot", dry: "dryFire", tail: "m5Tail", fireVolume: 0.8 },
    ejectOn: "fire",
    tracerEvery: 3,
    inputBuffer: 0,
    reload: m4Reload(1.35, { out: "polyMagOut", in: "polyMagIn", bolt: "m5Bolt" }),
  },

  vssk: {
    id: "vssk",
    slot: 0,
    displayName: "VSSK VYKHLOP",
    fireMode: "semi",
    rpm: 50,
    magSize: 5,
    reserveStart: 35,
    reserveMax: 60,
    damage: { base: 120, pellets: 1, headMultiplier: 2.5, limbMultiplier: 0.8, falloffStart: 120, falloffEnd: 250, minDamageScale: 0.85, range: 300 },
    spread: { hip: 4.0, ads: 0.0, moving: 2.5, air: 6, crouchScale: 0.7, perShot: 0, maxBloom: 0, bloomRecovery: 5 },
    recoil: { pitch: 3.2, pitchJitter: 0.4, yaw: 0.6, yawBias: 0, recovery: 9, recoveryFraction: 0.8, kickBack: 0.05, kickRot: 0.09, adsScale: 0.55 },
    cycleTime: 1.15,
    equipTime: 0.7,
    holsterTime: 0.36,
    adsTime: 0.26,
    adsFovScale: 0.24,
    adsSensitivity: 0.85,
    moveSpeedScale: 0.9,
    adsMoveScale: 0.45,
    sway: { amount: 1.3, adsScale: 0.35, smoothing: 10 },
    muzzleFlash: { scale: 0.09, length: 0.14, duration: 0.03, tint: [1.0, 0.75, 0.5] },
    sounds: { fire: "suppressedShot", dry: "dryFire", cycle: "vsskCycle", fireVolume: 0.9 },
    ejectOn: "fire",
    tracerEvery: 0,
    inputBuffer: 0.15,
    scoped: true,
    noise: 0.35,
    reload: m4Reload(1.05, { out: "vsskMagOut", in: "vsskMagIn", bolt: "vsskBolt" }),
  },

  glock: {
    id: "glock",
    slot: 0,
    displayName: "GLOCK 17",
    fireMode: "semi",
    rpm: 420,
    magSize: 17,
    reserveStart: 119,
    reserveMax: 187,
    damage: { base: 22, pellets: 1, headMultiplier: 2.4, limbMultiplier: 0.8, falloffStart: 15, falloffEnd: 45, minDamageScale: 0.5, range: 90 },
    spread: { hip: 1.2, ads: 0.25, moving: 1.0, air: 3, crouchScale: 0.8, perShot: 0.35, maxBloom: 1.6, bloomRecovery: 8 },
    recoil: { pitch: 1.5, pitchJitter: 0.3, yaw: 0.45, yawBias: 0, recovery: 12, recoveryFraction: 0.85, kickBack: 0.02, kickRot: 0.06, adsScale: 0.75 },
    cycleTime: 0,
    equipTime: 0.38,
    holsterTime: 0.22,
    adsTime: 0.13,
    adsFovScale: 0.86,
    adsSensitivity: 0.95,
    moveSpeedScale: 1.06,
    adsMoveScale: 0.75,
    sway: { amount: 0.8, adsScale: 0.25, smoothing: 16 },
    muzzleFlash: { scale: 0.12, length: 0.16, duration: 0.035, tint: [1.0, 0.8, 0.5] },
    sounds: { fire: "pistolShot", dry: "dryFire", tail: "pistolTail", fireVolume: 0.8 },
    ejectOn: "fire",
    tracerEvery: 0,
    inputBuffer: 0.12,
    reload: m4Reload(1.55, { out: "pistolMagOut", in: "pistolMagIn", bolt: "slideRelease" }),
  },

  vector: {
    id: "vector",
    slot: 0,
    displayName: "KRISS VECTOR",
    fireMode: "auto",
    rpm: 1000,
    magSize: 25,
    reserveStart: 200,
    reserveMax: 350,
    damage: { base: 21, pellets: 1, headMultiplier: 2.2, limbMultiplier: 0.8, falloffStart: 14, falloffEnd: 40, minDamageScale: 0.5, range: 120 },
    spread: { hip: 1.2, ads: 0.2, moving: 0.9, air: 2.6, crouchScale: 0.8, perShot: 0.14, maxBloom: 1.6, bloomRecovery: 8 },
    // the Super V system pushes the recoil down: very little muzzle climb, a fast buzz
    recoil: { pitch: 0.34, pitchJitter: 0.12, yaw: 0.26, yawBias: 0.04, recovery: 12, recoveryFraction: 0.78, kickBack: 0.008, kickRot: 0.01, adsScale: 0.7 },
    cycleTime: 0,
    equipTime: 0.95,
    holsterTime: 0.32,
    adsTime: 0.13,
    adsFovScale: 0.82,
    adsSensitivity: 0.92,
    moveSpeedScale: 1.05,
    adsMoveScale: 0.72,
    sway: { amount: 0.85, adsScale: 0.16, smoothing: 15 },
    muzzleFlash: { scale: 0.15, length: 0.24, duration: 0.035, tint: [1.0, 0.78, 0.48] },
    sounds: { fire: "vectorShot", dry: "dryFire", tail: "smgTail", fireVolume: 0.74 },
    ejectOn: "fire",
    tracerEvery: 4,
    inputBuffer: 0,
    reload: vectorReload(1.18),
  },

  flashbang: {
    id: "flashbang",
    slot: 0,
    displayName: "M84 FLASHBANG",
    fireMode: "throw",
    rpm: 60,
    magSize: 2,
    reserveStart: 0,
    reserveMax: 0,
    damage: { base: 0, pellets: 1, headMultiplier: 1, limbMultiplier: 1, falloffStart: 1, falloffEnd: 2, minDamageScale: 0, range: 1 },
    spread: { hip: 0, ads: 0, moving: 0, air: 0, crouchScale: 1, perShot: 0, maxBloom: 0, bloomRecovery: 1 },
    recoil: { pitch: 0, pitchJitter: 0, yaw: 0, yawBias: 0, recovery: 10, recoveryFraction: 1, kickBack: 0, kickRot: 0, adsScale: 1 },
    cycleTime: 0,
    equipTime: 0.42,
    holsterTime: 0.26,
    adsTime: 0.2,
    adsFovScale: 1,
    adsSensitivity: 1,
    moveSpeedScale: 1.05,
    adsMoveScale: 1,
    sway: { amount: 1.0, adsScale: 1, smoothing: 13 },
    muzzleFlash: { scale: 0.001, length: 0.001, duration: 0.001, tint: [0, 0, 0] },
    sounds: { fire: "grenadeThrow", dry: "dryFire" },
    ejectOn: "cycle",
    tracerEvery: 0,
    inputBuffer: 0.2,
    reload: [],
  },

  knife: {
    id: "knife",
    slot: 0,
    displayName: "COMBAT KNIFE",
    fireMode: "melee",
    rpm: 120,
    magSize: 0,
    reserveStart: 0,
    reserveMax: 0,
    damage: { base: 0, pellets: 1, headMultiplier: 1.5, limbMultiplier: 0.8, falloffStart: 1, falloffEnd: 2, minDamageScale: 1, range: 2.2 },
    spread: { hip: 0, ads: 0, moving: 0, air: 0, crouchScale: 1, perShot: 0, maxBloom: 0, bloomRecovery: 1 },
    recoil: NO_RECOIL,
    cycleTime: 0,
    equipTime: 0.35,
    holsterTime: 0.2,
    adsTime: 0.2,
    adsFovScale: 1,
    adsSensitivity: 1,
    // knife out: you move faster
    moveSpeedScale: 1.12,
    adsMoveScale: 1,
    sway: { amount: 1.0, adsScale: 1, smoothing: 14 },
    muzzleFlash: { scale: 0.001, length: 0.001, duration: 0.001, tint: [0, 0, 0] },
    sounds: { fire: "knifeSlash", dry: "knifeSlash" },
    ejectOn: "cycle",
    tracerEvery: 0,
    inputBuffer: 0.25,
    reload: [],
    knife: {
      // timings follow the authored clips (~0.7 s slashes, 0.9 s strike, played a little fast)
      light: { damage: 55, time: 0.5, hitAt: 0.2, range: 2.0 },
      heavy: { damage: 110, time: 0.75, hitAt: 0.36, range: 2.2 },
      backstab: 220,
    },
  },

  m72: {
    id: "m72",
    slot: 0,
    displayName: "M72 LAW",
    fireMode: "semi",
    // one rocket per tube: the rate only spaces the reload after the shot
    rpm: 100,
    magSize: 1,
    reserveStart: 4,
    reserveMax: 6,
    damage: { base: 0, pellets: 1, headMultiplier: 1, limbMultiplier: 1, falloffStart: 1, falloffEnd: 2, minDamageScale: 1, range: 400 },
    spread: { hip: 2.2, ads: 0.15, moving: 1.6, air: 4, crouchScale: 0.8, perShot: 0, maxBloom: 0, bloomRecovery: 1 },
    recoil: { pitch: 3.6, pitchJitter: 0.6, yaw: 0.8, yawBias: 0, recovery: 7, recoveryFraction: 0.85, kickBack: 0.07, kickRot: 0.08, adsScale: 0.7 },
    cycleTime: 0,
    equipTime: 0.75,
    holsterTime: 0.38,
    adsTime: 0.28,
    adsFovScale: 0.7,
    adsSensitivity: 0.85,
    moveSpeedScale: 0.9,
    adsMoveScale: 0.55,
    sway: { amount: 1.3, adsScale: 0.4, smoothing: 10 },
    muzzleFlash: { scale: 0.5, length: 0.55, duration: 0.09, tint: [1.0, 0.7, 0.35] },
    sounds: { fire: "m72Launch", dry: "dryFire", fireVolume: 1.0 },
    ejectOn: "cycle",
    tracerEvery: 0,
    inputBuffer: 0.1,
    noise: 1.8,
    reload: launcherReload(2.3),
    // the LAW's motor burns out inside the tube: in flight there's only the whoosh of air
    projectile: { speed: 62, gravity: 2.2, radius: 7.5, damage: 230, direct: 320, life: 6, flightSound: "rocketWhoosh" },
  },

  dzj08: {
    id: "dzj08",
    slot: 0,
    displayName: "DZJ-08 ROCKET",
    fireMode: "semi",
    rpm: 100,
    magSize: 1,
    reserveStart: 4,
    reserveMax: 6,
    damage: { base: 0, pellets: 1, headMultiplier: 1, limbMultiplier: 1, falloffStart: 1, falloffEnd: 2, minDamageScale: 1, range: 400 },
    spread: { hip: 2.4, ads: 0.1, moving: 1.8, air: 4, crouchScale: 0.8, perShot: 0, maxBloom: 0, bloomRecovery: 1 },
    recoil: { pitch: 4.2, pitchJitter: 0.7, yaw: 0.9, yawBias: 0, recovery: 6.5, recoveryFraction: 0.85, kickBack: 0.08, kickRot: 0.09, adsScale: 0.7 },
    cycleTime: 0,
    equipTime: 0.85,
    holsterTime: 0.42,
    adsTime: 0.32,
    adsFovScale: 0.6,
    adsSensitivity: 0.8,
    moveSpeedScale: 0.86,
    adsMoveScale: 0.5,
    sway: { amount: 1.4, adsScale: 0.4, smoothing: 9 },
    muzzleFlash: { scale: 0.6, length: 0.7, duration: 0.1, tint: [1.0, 0.68, 0.32] },
    sounds: { fire: "dzjLaunch", dry: "dryFire", fireVolume: 1.0 },
    ejectOn: "cycle",
    tracerEvery: 0,
    inputBuffer: 0.1,
    noise: 2.0,
    reload: launcherReload(2.6),
    projectile: { speed: 70, gravity: 1.8, radius: 8.5, damage: 260, direct: 360, life: 6, flightSound: "rocketMotor" },
  },
};

export type GrenadeType = "frag" | "flame" | "plasma" | "flash";

export interface GrenadeSpec {
  name: string;
  /** HUD short label */
  short: string;
  /** carried at the start of a round */
  count: number;
  /** seconds after the throw (plasma: after it sticks) */
  fuse: number;
  /** detonates on the first solid impact (after a short arming delay) */
  impact?: boolean;
  /** sticks to whatever it touches */
  sticky?: boolean;
  /** blast radius (m) and damage at the centre */
  radius: number;
  damage: number;
  /** throw speed multiplier (heavier canisters fly shorter) */
  speed: number;
}

/** The grenade belt: lethal AP frag, incendiary, plasma, and the tactical flashbang. */
export const GRENADE_TYPES: Record<GrenadeType, GrenadeSpec> = {
  frag: { name: "AP FRAG", short: "FRAG", count: 2, fuse: 2.6, radius: 9, damage: 190, speed: 1 },
  flame: { name: "INCENDIARY", short: "FIRE", count: 2, fuse: 3.5, impact: true, radius: 3.8, damage: 34, speed: 0.92 },
  plasma: { name: "PLASMA", short: "PLSM", count: 1, fuse: 1.15, sticky: true, radius: 6.5, damage: 260, speed: 0.95 },
  flash: { name: "M84 FLASHBANG", short: "FLASH", count: 2, fuse: 1.6, radius: 22, damage: 0, speed: 1 },
};
export const GRENADE_ORDER: GrenadeType[] = ["frag", "flame", "plasma", "flash"];

/** Grenade timing (seconds). */
export const GRENADE = {
  pinTime: 0.42,
  throwTime: 0.62,
  /** normalised time in the throw at which the grenade leaves the hand */
  releaseAt: 0.3,
  fuse: 1.6,
  throwSpeed: 15.5,
  lobSpeed: 7,
  upBoost: 2.6,
};

/**
 * Global reload speed-up on top of each weapon's own clip speed. Reload phases are
 * normalised (0..1) and the rigs sample their clips from that, so animation,
 * sound and the ammo transfer all stay in sync at any speed.
 */
export const RELOAD_SPEED = 1.45;

/** Slot order (keys 1–9, 0). Add a weapon here and it gets the next slot automatically. */
/** Loadout slots (number keys 1–5): one weapon each. */
/**
 * Seven carry slots, one per kind of weapon (keys 1–7): an assault rifle, an SMG, a sniper rifle,
 * a pistol, one launcher, the knife and the grenade belt. A gun picked up replaces the one in its
 * own slot only.
 */
export type LoadoutSlot = "primary" | "smg" | "sniper" | "secondary" | "launcher" | "melee" | "grenade";
export const SLOT_ORDER: LoadoutSlot[] = ["primary", "smg", "sniper", "secondary", "launcher", "melee", "grenade"];
export const SLOT_LABEL: Record<LoadoutSlot, string> = { primary: "ASSAULT RIFLE", smg: "SMG", sniper: "SNIPER RIFLE", secondary: "PISTOL", launcher: "LAUNCHER", melee: "KNIFE", grenade: "GRENADES" };
export function slotOf(cfg: WeaponConfig): LoadoutSlot {
  if (cfg.knife) return "melee";
  if (cfg.fireMode === "throw") return "grenade";
  if (cfg.projectile) return "launcher";
  if (cfg.id === "glock") return "secondary";
  if (cfg.id === "vector") return "smg";
  if (cfg.id === "vssk") return "sniper";
  return "primary";
}

export const WEAPON_ORDER: WeaponId[] = ["rifle", "ak47", "m5", "vssk", "glock", "vector", "flashbang", "knife", "m72", "dzj08"];
WEAPON_ORDER.forEach((id, i) => (WEAPONS[id].slot = i));
