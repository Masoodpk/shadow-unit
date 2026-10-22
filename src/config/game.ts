/** Global tuning values. Keep magic numbers here, not in systems. */

export const PLAYER = {
  maxHealth: 100,
  /** after this long without taking damage, health slowly comes back */
  regenDelay: 5,
  regenRate: 4, // hp / s
  /**
   * incoming damage is scaled by this: 100 HP that takes as long to lose as the old 150 HP × 0.8
   * (about three times tougher than the original operator)
   */
  damageTaken: 0.53,
  radius: 0.34,
  standHalfHeight: 0.9,
  crouchHalfHeight: 0.6,
  /** prone: the capsule shrinks to a low lump, eyes ~40 cm off the floor */
  proneHalfHeight: 0.32,
  standEye: 1.64,
  crouchEye: 1.08,
  proneEye: 0.4,
  proneSpeed: 1.15,
  /** prone ↔ crouch takes a moment (getting down / up) */
  proneLerp: 6,
  /** prone: how far the view may look down / up (radians, + = down) */
  proneLookDown: 0.5,
  proneLookUp: 1.0,
  /** lean / peek: sideways head offset (m) per stance and the camera roll at full lean */
  leanStand: 0.42,
  leanCrouch: 0.34,
  leanProne: 0.18,
  leanRoll: 0.2,
  leanLerp: 11,
  walkSpeed: 4.4,
  sprintSpeed: 6.9,
  crouchSpeed: 2.3,
  groundAccel: 13,
  groundDecel: 11,
  airAccel: 2.2,
  jumpVelocity: 5.0,
  gravity: 19,
  maxFall: 30,
  /** landing speeds (m/s): no harm below ~3 m of fall, lethal from ~13 m */
  fallSafeSpeed: 10.7,
  fallLethalSpeed: 22.3,
  stepDown: 0.42,
  coyoteTime: 0.1,
  crouchLerp: 12,
  baseFovDeg: 70, // vertical
  sensitivity: 0.0021, // rad per pixel at 1.0
  pitchLimit: 1.5,
  sprintFovBoost: 4,
  /** head bob vertical amplitude (m); frequency follows footsteps */
  bobWalk: { freq: 1.9, amp: 0.022 },
  bobSprint: { freq: 2.7, amp: 0.034 },
  footstepStride: 2.1,
  hurtFlashTime: 0.45,
};

export const ENEMY = {
  count: 9,
  maxHealth: 100,
  walkSpeed: 1.7,
  runSpeed: 3.9,
  radius: 0.36,
  halfHeight: 0.9,
  eyeHeight: 1.6,
  crouchEyeHeight: 1.05,
  thinkRate: 8, // Hz (staggered)
  visionRange: 48,
  /** the first seconds of a stage: the base hasn't noticed you yet (ends early if you fire) */
  startGrace: 8,
  /** …and while you're still within this radius of the insertion point (m) */
  startZone: 12,
  visionFovDeg: 125,
  closeSenseRange: 4.5,
  /**
   * Hearing. Gunfire carries `hearingRange` m (× the weapon's noise: suppressed ≈ 0.35, rockets ≈ 2);
   * with a wall in between it is muffled to `wallMuffle` of that. Inside `certainRange` they know
   * exactly where it came from and engage; farther out they move in to investigate.
   */
  hearingRange: 60,
  wallMuffle: 0.5,
  certainRange: 12,
  /** player footsteps carry this far (m): sprinting / walking (crouched and prone are silent) */
  footstepSprint: 14,
  footstepWalk: 6,
  /** investigating a noise: run in to about this far from it, then advance carefully */
  approachStop: 9,
  /** give up investigating and start searching after this long (s) */
  investigateTime: 30,
  allyAlertRange: 30,
  detectRate: 1.6, // detection units per second at mid range
  reactionTime: 0.55,
  burstMin: 3,
  burstMax: 6,
  burstInterval: 0.11,
  burstCooldownMin: 0.7,
  burstCooldownMax: 1.5,
  damageMin: 5,
  damageMax: 9,
  baseHitChance: 0.33,
  coverSearchRadius: 16,
  repositionMin: 5,
  repositionMax: 9,
  loseTargetTime: 3.0,
  searchTime: 11,
  /** bodies stay where they fell this long (s) before sinking away */
  corpseTime: 240,
  sinkTime: 1.5,
};

/** Metadata tags used for ray filtering instead of name lookups. */
export const HitKind = {
  Level: 1,
  EnemyPart: 2,
  EnemyBody: 3, // movement collider – never hit by bullets
} as const;

export type SurfaceType = "concrete" | "metal" | "dirt" | "wood";

export type BodyZone = "head" | "torso" | "limb";

export const RENDER = {
  viewmodelGroup: 1,
  shadowMapHigh: 2048,
  shadowMapLow: 1024,
};
