/**
 * Pure fixed-step contact-hit selection for player damage.
 *
 * Candidates are supplied in deterministic contact order. The first valid
 * candidate wins; invalid candidates are skipped. This makes equal contacts
 * deterministic without sorting or mutating the caller's array.
 */

export interface ContactHitCandidate {
  readonly damage: number;
  readonly attackerId?: string | number;
  readonly strikeId?: string | number;
}

export interface PlayerContactEligibility {
  /** Eligibility is explicit; callers can disable contact for other rules. */
  readonly eligible: boolean;
  /** Positive at step start is invulnerable. Exact zero is eligible. */
  readonly invulnerabilityRemainingSeconds: number;
}

export interface PlayerHitEvent {
  readonly type: 'player-hit';
  readonly damage: number;
  readonly attackerId?: string | number;
  readonly strikeId?: string | number;
}

export interface ContactHitResolution {
  readonly event: PlayerHitEvent | null;
}

/**
 * Resolves one fixed step of contact candidates.
 *
 * A positive invulnerability timer suppresses the entire step, including a
 * timer that would reach zero during that step. A timer at exact zero is not
 * invulnerable. The result contains at most one event, and all malformed or
 * non-finite candidates are ignored.
 */
export function resolveContactHit(
  candidates: readonly ContactHitCandidate[] | null | undefined,
  eligibility: PlayerContactEligibility | null | undefined,
): ContactHitResolution {
  if (!isEligible(eligibility)) {
    return { event: null };
  }

  if (!Array.isArray(candidates)) {
    return { event: null };
  }

  for (const candidate of candidates) {
    const valid = readCandidate(candidate);
    if (!valid) {
      continue;
    }

    const event: PlayerHitEvent = {
      type: 'player-hit',
      damage: valid.damage,
      ...(valid.attackerId === undefined ? {} : { attackerId: valid.attackerId }),
      ...(valid.strikeId === undefined ? {} : { strikeId: valid.strikeId }),
    };
    return { event };
  }

  return { event: null };
}

function isEligible(value: PlayerContactEligibility | null | undefined): boolean {
  if (!isRecord(value) || value.eligible !== true) {
    return false;
  }

  // Non-finite timers fail closed. Exact zero is the stable active boundary.
  return typeof value.invulnerabilityRemainingSeconds === 'number'
    && Number.isFinite(value.invulnerabilityRemainingSeconds)
    && value.invulnerabilityRemainingSeconds <= 0;
}

function readCandidate(value: unknown): ContactHitCandidate | null {
  if (!isRecord(value) || typeof value.damage !== 'number' || !Number.isFinite(value.damage) || value.damage <= 0) {
    return null;
  }

  const attackerId = readId(value.attackerId);
  const strikeId = readId(value.strikeId);
  return {
    damage: value.damage,
    ...(attackerId === undefined ? {} : { attackerId }),
    ...(strikeId === undefined ? {} : { strikeId }),
  };
}

function readId(value: unknown): string | number | undefined {
  if (typeof value === 'string') {
    return value;
  }
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}
