/**
 * Renderer-free vitality transition for a chaser. The caller maps an aimed
 * shard collision to a finite positive damage value; this module owns only
 * health and hit/defeat event semantics.
 */

export interface ChaserVitalityConfig {
  readonly maxHealth: number;
}

export interface ChaserVitalityState {
  readonly maxHealth: number;
  readonly health: number;
  readonly defeated: boolean;
}

export interface ChaserShardHitInput {
  readonly damage: number;
}

export interface ChaserHitEvent {
  readonly type: 'chaser-hit';
  readonly damage: number;
  readonly healthRemaining: number;
}

export interface ChaserDefeatEvent {
  readonly type: 'chaser-defeat';
  readonly damage: number;
  readonly healthRemaining: 0;
}

export type ChaserVitalityEvent = ChaserHitEvent | ChaserDefeatEvent;

export interface ChaserVitalityTransition {
  readonly state: ChaserVitalityState;
  readonly event: ChaserVitalityEvent | null;
}

const DEFAULT_MAX_HEALTH = 1;

/** Creates a finite, strictly positive health pool for one chaser. */
export function createChaserVitality(config: ChaserVitalityConfig): ChaserVitalityState {
  const maxHealth = positiveFiniteOrDefault(config?.maxHealth, DEFAULT_MAX_HEALTH);
  return {
    maxHealth,
    health: maxHealth,
    defeated: false,
  };
}

/**
 * Applies one valid shard hit. Defeated chasers and invalid hit inputs are
 * stable no-ops, so a terminal defeat event can only be emitted once.
 */
export function applyChaserShardHit(
  state: ChaserVitalityState,
  input: ChaserShardHitInput,
): ChaserVitalityTransition {
  const current = sanitizeState(state);
  const damage = finitePositive(input?.damage);

  if (current.defeated || damage === null) {
    return { state: current, event: null };
  }

  const health = Math.max(0, current.health - damage);
  if (health <= 0) {
    const defeated: ChaserVitalityState = {
      ...current,
      health: 0,
      defeated: true,
    };
    return {
      state: defeated,
      event: {
        type: 'chaser-defeat',
        damage,
        healthRemaining: 0,
      },
    };
  }

  const next: ChaserVitalityState = {
    ...current,
    health,
  };
  return {
    state: next,
    event: {
      type: 'chaser-hit',
      damage,
      healthRemaining: health,
    },
  };
}

function sanitizeState(state: ChaserVitalityState): ChaserVitalityState {
  const maxHealth = positiveFiniteOrDefault(state?.maxHealth, DEFAULT_MAX_HEALTH);
  const health = clamp(finiteOrZero(state?.health), 0, maxHealth);
  return {
    maxHealth,
    health,
    defeated: state?.defeated === true || health <= 0,
  };
}

function positiveFiniteOrDefault(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : fallback;
}

function finitePositive(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : null;
}

function finiteOrZero(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : 0;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}
