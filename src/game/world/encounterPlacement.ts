/** Renderer-free deterministic selection of one eligible encounter placement. */

export interface EncounterPlacementCandidate {
  readonly x: number;
  readonly y: number;
  readonly z: number;
}

export interface EncounterPlacementBounds {
  readonly minX: number;
  readonly maxX: number;
  readonly minZ: number;
  readonly maxZ: number;
}

export interface EncounterPlacementWorld {
  readonly bounds: EncounterPlacementBounds;
  readonly playerSpawn: Pick<EncounterPlacementCandidate, 'x' | 'y' | 'z'>;
  readonly playerSafeRadius: number;
}

export interface EncounterPlacementRequest {
  readonly candidates: readonly EncounterPlacementCandidate[];
  readonly world: EncounterPlacementWorld;
  /** Non-negative safe integer used as the ordered probing offset. */
  readonly encounterOrdinal: number;
}

export type EncounterPlacementNoneReason =
  | 'invalid-input'
  | 'empty-candidates'
  | 'no-eligible-candidate';

export type EncounterPlacementResult =
  | {
      readonly kind: 'placement';
      readonly encounterOrdinal: number;
      readonly candidateIndex: number;
      readonly position: EncounterPlacementCandidate;
    }
  | {
      readonly kind: 'none';
      readonly encounterOrdinal: number | null;
      readonly reason: EncounterPlacementNoneReason;
    };

/**
 * Selects the first eligible candidate while probing in supplied order from
 * `encounterOrdinal % candidates.length`, wrapping once. Candidate order is
 * never sorted or randomized; exact safe-radius boundary points are excluded.
 * Invalid world/request data returns an explicit none result.
 */
export function resolveEncounterPlacement(
  request: EncounterPlacementRequest,
): EncounterPlacementResult {
  if (!isValidRequest(request)) {
    return noneResult(null, 'invalid-input');
  }

  const { candidates, encounterOrdinal, world } = request;
  if (candidates.length === 0) {
    return noneResult(encounterOrdinal, 'empty-candidates');
  }

  const startIndex = encounterOrdinal % candidates.length;
  for (let offset = 0; offset < candidates.length; offset += 1) {
    const candidateIndex = (startIndex + offset) % candidates.length;
    const candidate = candidates[candidateIndex];
    if (!isEligibleCandidate(candidate, world)) continue;

    return Object.freeze({
      kind: 'placement',
      encounterOrdinal,
      candidateIndex,
      position: Object.freeze({ x: candidate.x, y: candidate.y, z: candidate.z }),
    });
  }

  return noneResult(encounterOrdinal, 'no-eligible-candidate');
}

function isValidRequest(value: unknown): value is EncounterPlacementRequest {
  if (!isRecord(value) || !Array.isArray(value.candidates) || !isValidWorld(value.world)) return false;
  return isNonNegativeSafeInteger(value.encounterOrdinal);
}

function isValidWorld(value: unknown): value is EncounterPlacementWorld {
  if (!isRecord(value) || !isRecord(value.bounds) || !isRecord(value.playerSpawn)) return false;

  const bounds = value.bounds;
  const playerSpawn = value.playerSpawn;
  if (
    !isFiniteNumber(bounds.minX) ||
    !isFiniteNumber(bounds.maxX) ||
    !isFiniteNumber(bounds.minZ) ||
    !isFiniteNumber(bounds.maxZ) ||
    !isFiniteNumber(playerSpawn.x) ||
    !isFiniteNumber(playerSpawn.y) ||
    !isFiniteNumber(playerSpawn.z) ||
    !isFiniteNumber(value.playerSafeRadius)
  ) {
    return false;
  }

  return (
    bounds.minX <= bounds.maxX &&
    bounds.minZ <= bounds.maxZ &&
    playerSpawn.x >= bounds.minX &&
    playerSpawn.x <= bounds.maxX &&
    playerSpawn.z >= bounds.minZ &&
    playerSpawn.z <= bounds.maxZ &&
    value.playerSafeRadius >= 0
  );
}

function isEligibleCandidate(
  candidate: unknown,
  world: EncounterPlacementWorld,
): candidate is EncounterPlacementCandidate {
  if (!isRecord(candidate)) return false;
  if (!isFiniteNumber(candidate.x) || !isFiniteNumber(candidate.y) || !isFiniteNumber(candidate.z)) return false;

  const { bounds, playerSpawn, playerSafeRadius } = world;
  if (
    candidate.x < bounds.minX ||
    candidate.x > bounds.maxX ||
    candidate.z < bounds.minZ ||
    candidate.z > bounds.maxZ
  ) {
    return false;
  }

  const deltaX = candidate.x - playerSpawn.x;
  const deltaZ = candidate.z - playerSpawn.z;
  return deltaX * deltaX + deltaZ * deltaZ > playerSafeRadius * playerSafeRadius;
}

function noneResult(
  encounterOrdinal: number | null,
  reason: EncounterPlacementNoneReason,
): EncounterPlacementResult {
  return Object.freeze({ kind: 'none', encounterOrdinal, reason });
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

function isNonNegativeSafeInteger(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}
