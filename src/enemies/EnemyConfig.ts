/**
 * Tunables for the hostile soldiers' combat behaviour, animation and death
 * physics — kept out of the AI code so they can be balanced in one place.
 * (Perception / burst / damage numbers live in config/game.ts → ENEMY.)
 */

/** Movement & tactics */
export const TACTICS = {
  /**
   * Preferred engagement band (m): closer → give a step, farther → push in. (Play-test, Oct 21: they
   * kept backing away from you — "running away". Now they hold their ground and close in: only
   * right on top of you do they give a step, and past 15 m they come at you.)
   */
  minRange: 3.5,
  maxRange: 15,
  /** too close: a step back (inside a rifle-butt's reach they strike instead) */
  panicRange: 2.2,
  strafeSpeed: 1.6,
  strafeSwitch: [1.0, 2.8] as [number, number],
  strafeProbe: 2.2,
  advanceSpeed: 1.9,
  retreatSpeed: 0.9,
  /** too close: back away facing the target (a fast back-pedal looks like a moonwalk) */
  backpedalSpeed: 1.2,
  /**
   * On the move with you in sight (to cover, round you): a tactical jog, rifle on you — never a run
   * with his back to you (Oct 21 play-test: "they run away from me"). Moving away from you he
   * backsteps at `combatBackSpeed`, chest still to you.
   */
  combatMoveSpeed: 2.1,
  combatBackSpeed: 1.2,
  /** the rifleman (and the boss) push in past this range; the others hold their band */
  assaultPushRange: 8,
  /** lost sight of you: the rifleman (and the boss) come looking after this long (s), still fighting */
  huntAfter: 1,
  runSpeed: 3.9,
  sprintSpeed: 5.6,
  /** sprint when the destination is at least this far */
  sprintDistance: 11,
  /** faster than this the soldier faces where he runs (no shooting) */
  faceMoveAbove: 2.2,
  /** body turn rate (rad/s) and smoothing */
  turnRate: 6.5,
  turnSmooth: 9,
  /** acceleration / deceleration (m/s²) */
  accel: 9,
  decel: 12,
  /** neighbours closer than this push apart */
  separation: 1.1,
  separationStrength: 2.4,
  /** shuffle along cover while crouched */
  coverShuffleChance: 0.35,
  coverShuffleSpeed: 1.1,
  /** leaning out round cover: sideways head offset at full lean (m) */
  leanReach: 0.3,
} as const;

/** Reflexes */
export const REFLEX = {
  /** important hits only: damage threshold for a flinch, and min time between flinches */
  flinchDamage: 18,
  flinchCooldown: 1.1,
  /** chance of a side step after a hit while standing in the open */
  sideStepChance: 0.35,
  /** grenade dodge: radius, probability, roll clearance */
  dodgeRadius: 5.5,
  dodgeChance: 0.75,
  dodgeClear: 4.6,
  /** melee: trigger range, hit range, damage, cooldown */
  meleeRange: 1.7,
  meleeHitRange: 2.1,
  meleeDamage: 28,
  meleeCooldown: 2.2,
  /** grenades: one each; team-wide cooldown (s); target range (m); only after the player hid for a while */
  grenades: 1,
  grenadeTeamCooldown: 14,
  grenadeRange: [8, 24] as [number, number],
  grenadeHiddenFor: 2.5,
  grenadeChance: 0.35,
} as const;

/** Ragdoll physics */
export const RAGDOLL = {
  maxActive: 8,
  mass: { pelvis: 13, torso: 27, head: 5, upperArm: 2.6, foreArm: 1.8, thigh: 9.5, calf: 5 },
  friction: 0.85,
  restitution: 0.04,
  linearDamping: 0.06,
  angularDamping: 0.6,
  /** asleep when every part is slower than this (m/s) for sleepTime (s); hard limit maxTime */
  sleepSpeed: 0.08,
  sleepTime: 0.8,
  maxTime: 7,
  /** joint limits (degrees). y = bend about the joint's perpendicular axis, z = sideways, tw = twist */
  joints: {
    spine: { tw: 25, y: [-35, 35], z: [-20, 20] },
    neck: { tw: 40, y: [-40, 40], z: [-25, 25] },
    shoulder: { tw: 45, y: [-100, 100], z: [-90, 90] },
    elbow: { tw: 5, y: [-150, 3], z: [-4, 4] },
    hip: { tw: 25, y: [-95, 95], z: [-35, 35] },
    knee: { tw: 4, y: [-150, 3], z: [-4, 4] },
  } as Record<string, { tw: number; y: [number, number]; z: [number, number] }>,
  /** impulses (N·s): per point of weapon damage, headshot and melee multipliers, explosions */
  bulletPerDamage: 1.1,
  headshotScale: 1.35,
  /** cap on the speed change a single impulse can give one limb (m/s) — keeps heads from whipping off */
  maxPartDV: 4.5,
  meleeImpulse: 150,
  blastImpulse: 520,
  /** how long the scripted death stagger plays before the ragdoll takes over (s) */
  leadIn: 0.32,
} as const;

/** the stage boss (Blackridge's commander) */
export const BOSS = {
  health: 1100,
  /** damage taken from body / head hits (a soldier dies to ~100) */
  bodyScale: 0.7,
  headScale: 0.55,
  /** no single hit does more than this (knife backstab, rocket, plasma) */
  maxHit: 140,
};

type Widen<T> = { -readonly [K in keyof T]: T[K] extends readonly [number, number] ? [number, number] : T[K] extends number ? number : T[K] };
/** a soldier's movement & tactics tunables (TACTICS, or TACTICS with an elite's overrides) */
export type Tactics = Widen<typeof TACTICS>;
/** a soldier's reflex tunables (REFLEX, or REFLEX with an elite's overrides) */
export type Reflex = Widen<typeof REFLEX>;

/**
 * Sandstorm's elite (SREEJITH, the Indian SF soldier: Akash's lieutenant in the hostage yard). Not a boss —
 * no plates, no sidearm — but quicker at everything: he runs and strafes faster, keeps the rifle on you
 * at a fast tactical run where the others drop to a jog, jinks more often, turns and gets up to speed
 * sooner, dives into a combat roll when he's hit in the open, slides into cover at a sprint, carries
 * two grenades and shrugs off the lighter hits.
 */
export const ELITE = {
  tactics: {
    minRange: 3,
    maxRange: 20,
    strafeSpeed: 2.4,
    strafeSwitch: [0.55, 1.5],
    advanceSpeed: 2.8,
    retreatSpeed: 1.4,
    backpedalSpeed: 1.7,
    combatMoveSpeed: 3.0,
    combatBackSpeed: 1.8,
    assaultPushRange: 12,
    huntAfter: 0.4,
    runSpeed: 4.6,
    sprintSpeed: 6.2,
    sprintDistance: 7,
    faceMoveAbove: 3.4,
    turnRate: 10,
    turnSmooth: 14,
    accel: 15,
    decel: 17,
    coverShuffleChance: 0.6,
    coverShuffleSpeed: 1.6,
  } satisfies Partial<Tactics>,
  reflex: {
    flinchDamage: 32,
    flinchCooldown: 1.8,
    sideStepChance: 0.8,
    dodgeChance: 1,
    meleeDamage: 40,
    meleeCooldown: 1.4,
    grenades: 2,
    grenadeHiddenFor: 1.5,
    grenadeChance: 0.6,
  } satisfies Partial<Reflex>,
  /** how often he moves to new cover (× the soldiers' reposition time) */
  reposition: 0.5,
  /** the dash he prefers from cover to cover (m) */
  bound: 8,
  /** a combat roll when hit in the open: chance, and the least time between two */
  rollChance: 0.65,
  rollCooldown: 3.2,
  /** the slide into cover: its length (s) — the slide clip's drop, hip slide and rise */
  slideTime: 0.85,
  /** at least this fast (m/s) for a slide (a sprint or a run) */
  slideSpeed: 3.8,
};
