/**
 * Renderer- and input-agnostic player simulation for the horizontal arena
 * plane. The integration layer converts touch samples into PlayerIntent and
 * advances this module with its fixed simulation timestep.
 */

export interface PlayerVector {
  readonly x: number;
  readonly z: number;
}

/**
 * Touch-derived movement and aim directions. Both vectors are finite and have
 * a maximum length of one after normalizePlayerIntent(). dashRequested is an
 * edge: callers set it for one fixed step, not while a control is held.
 */
export interface PlayerIntent {
  readonly movement: PlayerVector;
  readonly aim: PlayerVector;
  readonly dashRequested: boolean;
}

export interface ArenaBounds {
  readonly minX: number;
  readonly maxX: number;
  readonly minZ: number;
  readonly maxZ: number;
}

/** Mutable simulation data is represented by plain values so replay is exact. */
export interface PlayerState {
  readonly position: PlayerVector;
  readonly facing: PlayerVector;
  readonly dashDirection: PlayerVector;
  readonly dashRemainingSeconds: number;
  readonly dashCooldownRemainingSeconds: number;
}

export interface PlayerStepConfig {
  readonly moveSpeed: number;
  readonly dashSpeed: number;
  readonly dashDurationSeconds: number;
  readonly dashCooldownSeconds: number;
}

export const NEUTRAL_PLAYER_VECTOR: PlayerVector = Object.freeze({ x: 0, z: 0 });
export const DEFAULT_PLAYER_INTENT: PlayerIntent = Object.freeze({
  movement: NEUTRAL_PLAYER_VECTOR,
  aim: NEUTRAL_PLAYER_VECTOR,
  dashRequested: false,
});

export const DEFAULT_PLAYER_STATE: PlayerState = Object.freeze({
  position: NEUTRAL_PLAYER_VECTOR,
  facing: Object.freeze({ x: 0, z: 1 }),
  dashDirection: Object.freeze({ x: 0, z: 1 }),
  dashRemainingSeconds: 0,
  dashCooldownRemainingSeconds: 0,
});

const MAX_STEP_SECONDS = 0.1;
const EPSILON = 0.000001;

/** Returns a finite unit-or-shorter vector; invalid values resolve to neutral. */
export function normalizePlayerVector(vector: PlayerVector): PlayerVector {
  const x = finiteOrZero(vector.x);
  const z = finiteOrZero(vector.z);
  const length = Math.hypot(x, z);

  if (length <= 1 || length < EPSILON) {
    return { x, z };
  }

  return { x: x / length, z: z / length };
}

export function normalizePlayerIntent(intent: PlayerIntent): PlayerIntent {
  return {
    movement: normalizePlayerVector(intent.movement),
    aim: normalizePlayerVector(intent.aim),
    dashRequested: intent.dashRequested === true,
  };
}

/**
 * Pure, fixed-step state transition. deltaSeconds is deliberately capped as a
 * safeguard; normal gameplay should always pass one constant fixed timestep.
 */
export function stepPlayerState(
  state: PlayerState,
  rawIntent: PlayerIntent,
  bounds: ArenaBounds,
  config: PlayerStepConfig,
  deltaSeconds: number,
): PlayerState {
  const intent = normalizePlayerIntent(rawIntent);
  const stepSeconds = clamp(finiteOrZero(deltaSeconds), 0, MAX_STEP_SECONDS);
  const safeConfig = normalizeConfig(config);
  const safeBounds = normalizeBounds(bounds);
  const position = clampToArena(state.position, safeBounds);
  const aim = intent.aim;
  const movement = intent.movement;
  const priorFacing = normalizedOrDefault(state.facing, { x: 0, z: 1 });
  const facing = hasDirection(aim)
    ? normalizedOrDefault(aim, priorFacing)
    : hasDirection(movement)
      ? normalizedOrDefault(movement, priorFacing)
      : priorFacing;

  let dashRemaining = Math.max(0, finiteOrZero(state.dashRemainingSeconds));
  let dashCooldown = Math.max(0, finiteOrZero(state.dashCooldownRemainingSeconds));
  let dashDirection = normalizedOrDefault(state.dashDirection, facing);

  // A request is accepted only when no dash or cooldown is active.
  if (intent.dashRequested && dashRemaining <= 0 && dashCooldown <= 0) {
    dashRemaining = safeConfig.dashDurationSeconds;
    dashCooldown = safeConfig.dashCooldownSeconds;
    dashDirection = hasDirection(aim) ? normalizedOrDefault(aim, facing) : facing;
  }

  const velocity = dashRemaining > 0
    ? scale(dashDirection, safeConfig.dashSpeed)
    : scale(movement, safeConfig.moveSpeed);
  const nextPosition = clampToArena(addScaled(position, velocity, stepSeconds), safeBounds);

  return {
    position: nextPosition,
    facing,
    dashDirection,
    dashRemainingSeconds: Math.max(0, dashRemaining - stepSeconds),
    dashCooldownRemainingSeconds: Math.max(0, dashCooldown - stepSeconds),
  };
}

function normalizeConfig(config: PlayerStepConfig): PlayerStepConfig {
  return {
    moveSpeed: Math.max(0, finiteOrZero(config.moveSpeed)),
    dashSpeed: Math.max(0, finiteOrZero(config.dashSpeed)),
    dashDurationSeconds: Math.max(0, finiteOrZero(config.dashDurationSeconds)),
    dashCooldownSeconds: Math.max(0, finiteOrZero(config.dashCooldownSeconds)),
  };
}

function normalizeBounds(bounds: ArenaBounds): ArenaBounds {
  const minX = finiteOrZero(bounds.minX);
  const maxX = finiteOrZero(bounds.maxX);
  const minZ = finiteOrZero(bounds.minZ);
  const maxZ = finiteOrZero(bounds.maxZ);
  return {
    minX: Math.min(minX, maxX),
    maxX: Math.max(minX, maxX),
    minZ: Math.min(minZ, maxZ),
    maxZ: Math.max(minZ, maxZ),
  };
}

function clampToArena(position: PlayerVector, bounds: ArenaBounds): PlayerVector {
  return {
    x: clamp(finiteOrZero(position.x), bounds.minX, bounds.maxX),
    z: clamp(finiteOrZero(position.z), bounds.minZ, bounds.maxZ),
  };
}

function normalizedOrDefault(vector: PlayerVector, fallback: PlayerVector): PlayerVector {
  const normalized = normalizePlayerVector(vector);
  return hasDirection(normalized) ? normalized : fallback;
}

function hasDirection(vector: PlayerVector): boolean {
  return Math.hypot(vector.x, vector.z) >= EPSILON;
}

function addScaled(position: PlayerVector, velocity: PlayerVector, seconds: number): PlayerVector {
  return { x: position.x + velocity.x * seconds, z: position.z + velocity.z * seconds };
}

function scale(vector: PlayerVector, amount: number): PlayerVector {
  return { x: vector.x * amount, z: vector.z * amount };
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function finiteOrZero(value: number): number {
  return Number.isFinite(value) ? value : 0;
}
