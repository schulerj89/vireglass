import type { PlayerVector } from '../player/playerState';

/**
 * Renderer-free fixed-step lifecycle for Spark's aimed shard-cast. A caller
 * supplies a pure collision sweep; this module owns travel bounds and emits at
 * most one terminal impact for each valid fired shard.
 */

export interface AimedShardCastConfig {
  readonly speed: number;
  readonly maxRange: number;
  readonly maxLifetimeSeconds: number;
}

export interface AimedShardCastState {
  readonly active: boolean;
  readonly impactEmitted: boolean;
  readonly position: PlayerVector;
  /** Always unit length for a valid active shard. */
  readonly direction: PlayerVector;
  readonly speed: number;
  readonly maxRange: number;
  readonly maxLifetimeSeconds: number;
  readonly travelled: number;
  readonly elapsedSeconds: number;
}

export interface ShardCollisionSweep {
  readonly start: PlayerVector;
  readonly end: PlayerVector;
  readonly direction: PlayerVector;
}

/** The hit fraction is measured along the supplied sweep, inclusively [0, 1]. */
export interface ShardCollision {
  readonly fraction: number;
  readonly targetId?: string | number;
}

export type ShardCollisionQuery = (sweep: ShardCollisionSweep) => ShardCollision | null;

export type ShardImpactCause = 'collision' | 'range' | 'lifetime';

export interface ShardImpactEvent {
  readonly type: 'shard-impact';
  readonly cause: ShardImpactCause;
  readonly position: PlayerVector;
  readonly travelled: number;
  readonly elapsedSeconds: number;
  readonly targetId?: string | number;
}

export interface AimedShardCastStep {
  readonly state: AimedShardCastState;
  readonly impact: ShardImpactEvent | null;
}

const EPSILON = 0.000001;
const MAX_STEP_SECONDS = 0.1;

/**
 * Creates a cast from its origin and aim. A neutral or invalid aim does not
 * fire a shard; a valid aim is converted to a unit travel direction.
 */
export function createAimedShardCast(
  origin: PlayerVector,
  aim: PlayerVector,
  config: AimedShardCastConfig,
): AimedShardCastState {
  const direction = unitDirection(aim);
  const safeConfig = normalizeConfig(config);

  return {
    active: hasDirection(direction),
    impactEmitted: false,
    position: finiteVector(origin),
    direction,
    speed: safeConfig.speed,
    maxRange: safeConfig.maxRange,
    maxLifetimeSeconds: safeConfig.maxLifetimeSeconds,
    travelled: 0,
    elapsedSeconds: 0,
  };
}

/**
 * Advances one bounded fixed simulation step. The collision query must be a
 * deterministic, side-effect-free sweep over the exact segment it receives.
 */
export function stepAimedShardCast(
  state: AimedShardCastState,
  deltaSeconds: number,
  collisionQuery: ShardCollisionQuery | null = null,
): AimedShardCastStep {
  if (!state.active || state.impactEmitted) {
    return { state, impact: null };
  }

  const current = sanitizeState(state);
  if (!hasDirection(current.direction)) {
    return {
      state: { ...current, active: false },
      impact: null,
    };
  }

  const remainingRange = Math.max(0, current.maxRange - current.travelled);
  const remainingLifetime = Math.max(0, current.maxLifetimeSeconds - current.elapsedSeconds);
  if (remainingRange <= EPSILON) {
    return finishCast(current, 'range');
  }
  if (remainingLifetime <= EPSILON) {
    return finishCast(current, 'lifetime');
  }

  const requestedSeconds = clamp(finiteOrZero(deltaSeconds), 0, MAX_STEP_SECONDS);
  if (requestedSeconds <= 0) {
    return { state: current, impact: null };
  }

  const rangeLimitedSeconds = current.speed > 0 ? remainingRange / current.speed : Infinity;
  const stepSeconds = Math.min(requestedSeconds, remainingLifetime, rangeLimitedSeconds);
  const stepDistance = current.speed * stepSeconds;
  const end = addScaled(current.position, current.direction, stepDistance);
  const collision = stepDistance > 0 ? queryCollision(collisionQuery, current.position, end, current.direction) : null;

  if (collision) {
    const fraction = collision.fraction;
    const hitState: AimedShardCastState = {
      ...current,
      position: lerp(current.position, end, fraction),
      travelled: current.travelled + stepDistance * fraction,
      elapsedSeconds: current.elapsedSeconds + stepSeconds * fraction,
    };
    return finishCast(hitState, 'collision', collision.targetId);
  }

  const next: AimedShardCastState = {
    ...current,
    position: end,
    travelled: current.travelled + stepDistance,
    elapsedSeconds: current.elapsedSeconds + stepSeconds,
  };

  if (next.maxRange - next.travelled <= EPSILON) {
    return finishCast(next, 'range');
  }
  if (next.maxLifetimeSeconds - next.elapsedSeconds <= EPSILON) {
    return finishCast(next, 'lifetime');
  }

  return { state: next, impact: null };
}

function finishCast(
  state: AimedShardCastState,
  cause: ShardImpactCause,
  targetId?: string | number,
): AimedShardCastStep {
  const finished = { ...state, active: false, impactEmitted: true };
  const impact: ShardImpactEvent = {
    type: 'shard-impact',
    cause,
    position: finished.position,
    travelled: finished.travelled,
    elapsedSeconds: finished.elapsedSeconds,
  };

  if (targetId !== undefined) {
    return { state: finished, impact: { ...impact, targetId } };
  }

  return { state: finished, impact };
}

function queryCollision(
  query: ShardCollisionQuery | null,
  start: PlayerVector,
  end: PlayerVector,
  direction: PlayerVector,
): ShardCollision | null {
  if (typeof query !== 'function') {
    return null;
  }

  const collision = query({ start, end, direction });
  if (!collision || !Number.isFinite(collision.fraction)) {
    return null;
  }

  if (collision.fraction < 0 || collision.fraction > 1) {
    return null;
  }

  return {
    fraction: collision.fraction,
    targetId: isTargetId(collision.targetId) ? collision.targetId : undefined,
  };
}

function sanitizeState(state: AimedShardCastState): AimedShardCastState {
  return {
    ...state,
    position: finiteVector(state.position),
    direction: unitDirection(state.direction),
    speed: Math.max(0, finiteOrZero(state.speed)),
    maxRange: Math.max(0, finiteOrZero(state.maxRange)),
    maxLifetimeSeconds: Math.max(0, finiteOrZero(state.maxLifetimeSeconds)),
    travelled: Math.max(0, finiteOrZero(state.travelled)),
    elapsedSeconds: Math.max(0, finiteOrZero(state.elapsedSeconds)),
  };
}

function normalizeConfig(config: AimedShardCastConfig): AimedShardCastConfig {
  return {
    speed: Math.max(0, finiteOrZero(config.speed)),
    maxRange: Math.max(0, finiteOrZero(config.maxRange)),
    maxLifetimeSeconds: Math.max(0, finiteOrZero(config.maxLifetimeSeconds)),
  };
}

function unitDirection(vector: PlayerVector): PlayerVector {
  const x = finiteOrZero(vector.x);
  const z = finiteOrZero(vector.z);
  const length = Math.hypot(x, z);
  return length >= EPSILON ? { x: x / length, z: z / length } : { x: 0, z: 0 };
}

function finiteVector(vector: PlayerVector): PlayerVector {
  return { x: finiteOrZero(vector.x), z: finiteOrZero(vector.z) };
}

function hasDirection(vector: PlayerVector): boolean {
  return Math.hypot(vector.x, vector.z) >= EPSILON;
}

function addScaled(position: PlayerVector, direction: PlayerVector, distance: number): PlayerVector {
  return {
    x: position.x + direction.x * distance,
    z: position.z + direction.z * distance,
  };
}

function lerp(start: PlayerVector, end: PlayerVector, fraction: number): PlayerVector {
  return {
    x: start.x + (end.x - start.x) * fraction,
    z: start.z + (end.z - start.z) * fraction,
  };
}

function isTargetId(value: unknown): value is string | number {
  return typeof value === 'string' || (typeof value === 'number' && Number.isFinite(value));
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function finiteOrZero(value: number): number {
  return Number.isFinite(value) ? value : 0;
}
