import type { SparkArenaMetadata } from './sparkArena';

/** A renderer-free world-space position on Spark's horizontal X/Z plane. */
export type SparkArenaQueryPosition = {
  readonly x: number;
  readonly z: number;
};

/** Caller-owned output for allocation-free clamp queries. */
export type MutableSparkArenaQueryPosition = {
  x: number;
  z: number;
};

/**
 * Returns whether a circle is entirely inside the authored arena bounds.
 *
 * The arena factory's boundary meshes are deliberately not consulted: gameplay
 * collision derives only from `SparkArenaMetadata`, so it remains deterministic
 * before a renderer or scene exists.
 */
export function isSparkArenaCircleWithinBounds(
  metadata: SparkArenaMetadata,
  position: SparkArenaQueryPosition,
  radius: number,
): boolean {
  assertValidRadius(radius);
  const { minX, maxX, minZ, maxZ } = metadata.bounds;

  return (
    position.x - radius >= minX &&
    position.x + radius <= maxX &&
    position.z - radius >= minZ &&
    position.z + radius <= maxZ
  );
}

/**
 * Writes the closest valid circle center into `out` and returns whether it was
 * changed. If the supplied circle cannot fit in an arena dimension, its center
 * is deterministically placed on that dimension's midpoint.
 *
 * This is O(1) scalar work and allocates no objects, arrays, meshes, or
 * renderer resources. Callers should reuse `out` in movement/update loops.
 */
export function clampSparkArenaCircleToBounds(
  metadata: SparkArenaMetadata,
  position: SparkArenaQueryPosition,
  radius: number,
  out: MutableSparkArenaQueryPosition,
): boolean {
  assertValidRadius(radius);
  const { minX, maxX, minZ, maxZ } = metadata.bounds;
  const clampedX = clampToCircleBounds(position.x, minX, maxX, radius);
  const clampedZ = clampToCircleBounds(position.z, minZ, maxZ, radius);

  out.x = clampedX;
  out.z = clampedZ;
  return clampedX !== position.x || clampedZ !== position.z;
}

/**
 * Returns whether a circle is wholly inside the spawn-safe disk centered at
 * `metadata.playerSpawn`. This lets enemy/director systems keep a clearance
 * zone around the player's initial location without scene traversal.
 */
export function isSparkArenaCircleSpawnSafe(
  metadata: SparkArenaMetadata,
  position: SparkArenaQueryPosition,
  radius: number,
): boolean {
  assertValidRadius(radius);
  const allowedRadius = metadata.spawnSafeRadius - radius;
  if (allowedRadius < 0) return false;

  const deltaX = position.x - metadata.playerSpawn.x;
  const deltaZ = position.z - metadata.playerSpawn.z;
  return deltaX * deltaX + deltaZ * deltaZ <= allowedRadius * allowedRadius;
}

/**
 * Writes the nearest point in the spawn-safe disk to `out` and returns whether
 * it was changed. A circle larger than the safe disk deterministically clamps
 * to the spawn point; `isSparkArenaCircleSpawnSafe` will still report false.
 *
 * This is O(1) scalar work with no allocations when `out` is caller-owned.
 */
export function clampSparkArenaCircleToSpawnSafe(
  metadata: SparkArenaMetadata,
  position: SparkArenaQueryPosition,
  radius: number,
  out: MutableSparkArenaQueryPosition,
): boolean {
  assertValidRadius(radius);
  const allowedRadius = Math.max(0, metadata.spawnSafeRadius - radius);
  const deltaX = position.x - metadata.playerSpawn.x;
  const deltaZ = position.z - metadata.playerSpawn.z;
  const distanceSquared = deltaX * deltaX + deltaZ * deltaZ;
  const allowedRadiusSquared = allowedRadius * allowedRadius;

  if (distanceSquared <= allowedRadiusSquared) {
    out.x = position.x;
    out.z = position.z;
    return false;
  }

  const scale = allowedRadius / Math.sqrt(distanceSquared);
  out.x = metadata.playerSpawn.x + deltaX * scale;
  out.z = metadata.playerSpawn.z + deltaZ * scale;
  return true;
}

function clampToCircleBounds(value: number, minimum: number, maximum: number, radius: number): number {
  const circleMinimum = minimum + radius;
  const circleMaximum = maximum - radius;
  if (circleMinimum > circleMaximum) return (minimum + maximum) * 0.5;
  return Math.min(Math.max(value, circleMinimum), circleMaximum);
}

function assertValidRadius(radius: number): void {
  if (!Number.isFinite(radius) || radius < 0) {
    throw new RangeError('Spark arena circle radius must be a finite value greater than or equal to zero.');
  }
}
