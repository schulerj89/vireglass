import type { SparkArenaMetadata } from './sparkArena';

/** A renderer-free world-space spawn candidate. */
export type SparkSpawnCandidate = {
  readonly x: number;
  readonly y: number;
  readonly z: number;
};

export type SparkSpawnCandidates = {
  /** Versioned, stable identifier for this exact candidate result. */
  readonly fingerprint: string;
  readonly arenaFingerprint: string;
  readonly requestedCount: number;
  readonly candidates: readonly SparkSpawnCandidate[];
};

export const DEFAULT_SPARK_SPAWN_CANDIDATE_COUNT = 6;
export const MAX_SPARK_SPAWN_CANDIDATE_COUNT = 8;

type NormalizedAnchor = {
  readonly x: number;
  readonly z: number;
};

// Fixed perimeter anchors keep candidate work bounded and place spawn attempts
// away from the arena center, where Spark's player starts by default.
const PERIMETER_ANCHORS: readonly NormalizedAnchor[] = Object.freeze([
  Object.freeze({ x: 0.16, z: 0.16 }),
  Object.freeze({ x: 0.5, z: 0.12 }),
  Object.freeze({ x: 0.84, z: 0.16 }),
  Object.freeze({ x: 0.88, z: 0.5 }),
  Object.freeze({ x: 0.84, z: 0.84 }),
  Object.freeze({ x: 0.5, z: 0.88 }),
  Object.freeze({ x: 0.16, z: 0.84 }),
  Object.freeze({ x: 0.12, z: 0.5 }),
]);

/**
 * Builds a bounded, deterministic set of spawn candidates from arena metadata.
 *
 * Candidate ordering is hash-derived from `metadata.fingerprint`; it never uses
 * Math.random, clock state, mesh traversal, a renderer, or a scene. This is
 * O(MAX_SPARK_SPAWN_CANDIDATE_COUNT) work and allocates only the returned
 * immutable result/candidates—no render or gameplay resources.
 */
export function createSparkSpawnCandidates(
  metadata: SparkArenaMetadata,
  requestedCount = DEFAULT_SPARK_SPAWN_CANDIDATE_COUNT,
): SparkSpawnCandidates {
  validateMetadata(metadata);
  validateRequestedCount(requestedCount);

  const { bounds, playerSpawn } = metadata;
  const width = bounds.maxX - bounds.minX;
  const depth = bounds.maxZ - bounds.minZ;
  const orderHash = hashString(metadata.fingerprint);
  const startingIndex = orderHash % PERIMETER_ANCHORS.length;
  const direction = (orderHash & 1) === 0 ? 1 : -1;
  const candidates: SparkSpawnCandidate[] = [];

  for (let offset = 0; offset < PERIMETER_ANCHORS.length && candidates.length < requestedCount; offset += 1) {
    const index = (startingIndex + direction * offset + PERIMETER_ANCHORS.length) % PERIMETER_ANCHORS.length;
    const anchor = PERIMETER_ANCHORS[index];
    const candidate = Object.freeze({
      x: bounds.minX + width * anchor.x,
      y: playerSpawn.y,
      z: bounds.minZ + depth * anchor.z,
    });

    if (isSparkSpawnCandidateOutsideSafeRadius(metadata, candidate)) {
      candidates.push(candidate);
    }
  }

  const frozenCandidates = Object.freeze(candidates);
  return Object.freeze({
    fingerprint: createCandidateFingerprint(metadata, requestedCount, frozenCandidates),
    arenaFingerprint: metadata.fingerprint,
    requestedCount,
    candidates: frozenCandidates,
  });
}

/**
 * Returns true only when a candidate is strictly outside the player spawn's
 * protected disk. Points on its edge are excluded to avoid ambiguous spawns.
 */
export function isSparkSpawnCandidateOutsideSafeRadius(
  metadata: SparkArenaMetadata,
  candidate: Pick<SparkSpawnCandidate, 'x' | 'z'>,
): boolean {
  validateMetadata(metadata);
  if (!Number.isFinite(candidate.x) || !Number.isFinite(candidate.z)) return false;

  const deltaX = candidate.x - metadata.playerSpawn.x;
  const deltaZ = candidate.z - metadata.playerSpawn.z;
  return deltaX * deltaX + deltaZ * deltaZ > metadata.spawnSafeRadius * metadata.spawnSafeRadius;
}

function validateMetadata(metadata: unknown): asserts metadata is SparkArenaMetadata {
  if (!isRecord(metadata)) throwInvalidMetadata();

  const { bounds, playerSpawn, spawnSafeRadius, fingerprint } = metadata;
  if (!isRecord(bounds) || !isRecord(playerSpawn) || typeof fingerprint !== 'string' || fingerprint.length === 0) {
    throwInvalidMetadata();
  }

  const { minX, maxX, minZ, maxZ } = bounds;
  const { x: spawnX, y: spawnY, z: spawnZ } = playerSpawn;
  if (
    !isFiniteNumber(minX) ||
    !isFiniteNumber(maxX) ||
    !isFiniteNumber(minZ) ||
    !isFiniteNumber(maxZ) ||
    !isFiniteNumber(spawnX) ||
    !isFiniteNumber(spawnY) ||
    !isFiniteNumber(spawnZ) ||
    !isFiniteNumber(spawnSafeRadius)
  ) {
    throwInvalidMetadata();
  }

  if (
    minX >= maxX ||
    minZ >= maxZ ||
    spawnX < minX ||
    spawnX > maxX ||
    spawnZ < minZ ||
    spawnZ > maxZ ||
    spawnSafeRadius < 0
  ) {
    throwInvalidMetadata();
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

function throwInvalidMetadata(): never {
  throw new RangeError('Spark spawn candidates require finite, non-empty arena metadata with valid bounds and safe radius.');
}

function validateRequestedCount(requestedCount: number): void {
  if (
    !Number.isSafeInteger(requestedCount) ||
    requestedCount < 0 ||
    requestedCount > MAX_SPARK_SPAWN_CANDIDATE_COUNT
  ) {
    throw new RangeError(`Spark spawn candidate count must be a safe integer from 0 to ${MAX_SPARK_SPAWN_CANDIDATE_COUNT}.`);
  }
}

function createCandidateFingerprint(
  metadata: SparkArenaMetadata,
  requestedCount: number,
  candidates: readonly SparkSpawnCandidate[],
): string {
  const candidatePayload = candidates.map((candidate) => `${candidate.x},${candidate.y},${candidate.z}`).join(';');
  const payload = [
    'spark-spawn-points-v1',
    metadata.fingerprint,
    metadata.bounds.minX,
    metadata.bounds.maxX,
    metadata.bounds.minZ,
    metadata.bounds.maxZ,
    metadata.playerSpawn.x,
    metadata.playerSpawn.y,
    metadata.playerSpawn.z,
    metadata.spawnSafeRadius,
    requestedCount,
    candidatePayload,
  ].join('|');
  return `spark-spawn-points-v1-${hashString(payload).toString(16).padStart(8, '0')}`;
}

/** FNV-1a is compact and stable across JavaScript runtimes. */
function hashString(value: string): number {
  let hash = 0x811c9dc5;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return hash >>> 0;
}
