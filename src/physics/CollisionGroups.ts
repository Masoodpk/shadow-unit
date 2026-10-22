/**
 * Havok collision filter bits. A shape collides with another when
 * (a.membership & b.collideWith) && (b.membership & a.collideWith).
 *
 * Only dead things are simulated: the level is static, ragdoll limbs and
 * dropped rifles are dynamic. Living soldiers and the player keep Babylon's
 * swept-ellipsoid movement (cheap, already tuned to the level), so they never
 * fight the physics solver.
 */
export const CollisionGroups = {
  LEVEL: 1 << 0,
  RAGDOLL: 1 << 1,
  DEBRIS: 1 << 2,
} as const;

export const COLLIDE = {
  level: { membership: CollisionGroups.LEVEL, collideWith: CollisionGroups.RAGDOLL | CollisionGroups.DEBRIS },
  ragdoll: { membership: CollisionGroups.RAGDOLL, collideWith: CollisionGroups.LEVEL | CollisionGroups.RAGDOLL | CollisionGroups.DEBRIS },
  debris: { membership: CollisionGroups.DEBRIS, collideWith: CollisionGroups.LEVEL | CollisionGroups.RAGDOLL | CollisionGroups.DEBRIS },
};
