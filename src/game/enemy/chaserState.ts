import type { PlayerVector } from '../player/playerState';

/**
 * Renderer-free fixed-step state machine for a close-range chaser. The caller
 * supplies only the target position; movement, telegraph timing, and strike
 * events are deterministic plain-data transitions.
 */

export type ChaserPhase = 'chase' | 'windup' | 'strike' | 'recovery';

export interface ChaserState {
  readonly position: PlayerVector;
  /** Locked while attacking so a windup remains readable. */
  readonly facing: PlayerVector;
  readonly phase: ChaserPhase;
  readonly phaseRemainingSeconds: number;
}

export interface ChaserStepInput {
  readonly targetPosition: PlayerVector | null;
}

export interface ChaserConfig {
  readonly chaseSpeed: number;
  readonly attackRange: number;
  readonly windupDurationSeconds: number;
  readonly strikeDurationSeconds: number;
  readonly recoveryDurationSeconds: number;
}

export interface ChaserStrikeEvent {
  readonly type: 'chaser-strike';
  readonly position: PlayerVector;
  readonly direction: PlayerVector;
}

export interface ChaserStep {
  readonly state: ChaserState;
  readonly event: ChaserStrikeEvent | null;
}

const EPSILON = 0.000001;
const MAX_STEP_SECONDS = 0.1;
const MAX_PHASE_TRANSITIONS = 16;
const DEFAULT_FACING: PlayerVector = Object.freeze({ x: 0, z: 1 });

/** Creates a chaser in its chase phase with a finite position and facing. */
export function createChaserState(
  position: PlayerVector,
  facing: PlayerVector = DEFAULT_FACING,
): ChaserState {
  return {
    position: finiteVector(position),
    facing: unitOrFallback(facing, DEFAULT_FACING),
    phase: 'chase',
    phaseRemainingSeconds: 0,
  };
}

/**
 * Advances the chaser by one bounded fixed step. A strike event is emitted
 * exactly when windup enters strike; later strike/recovery steps emit none.
 */
export function stepChaserState(
  state: ChaserState,
  input: ChaserStepInput,
  config: ChaserConfig,
  deltaSeconds: number,
): ChaserStep {
  const safeConfig = normalizeConfig(config);
  const target = readTarget(input);
  let next = sanitizeState(state);
  let remainingSeconds = clamp(finiteOrZero(deltaSeconds), 0, MAX_STEP_SECONDS);
  let event: ChaserStrikeEvent | null = null;
  let transitions = 0;

  while (remainingSeconds > EPSILON && transitions < MAX_PHASE_TRANSITIONS) {
    switch (next.phase) {
      case 'chase': {
        if (!target || safeConfig.chaseSpeed <= EPSILON) {
          return { state: next, event };
        }

        const offset = subtract(target, next.position);
        const distance = Math.hypot(offset.x, offset.z);
        if (distance <= safeConfig.attackRange + EPSILON) {
          next = enterPhase(next, 'windup', safeConfig.windupDurationSeconds);
          transitions += 1;
          continue;
        }

        const direction = unitOrFallback(offset, next.facing);
        const requiredDistance = distance - safeConfig.attackRange;
        const travelDistance = Math.min(safeConfig.chaseSpeed * remainingSeconds, requiredDistance);
        const travelSeconds = travelDistance / safeConfig.chaseSpeed;
        next = {
          ...next,
          position: addScaled(next.position, direction, travelDistance),
          facing: direction,
        };
        remainingSeconds -= travelSeconds;

        if (requiredDistance - travelDistance <= EPSILON) {
          next = enterPhase(next, 'windup', safeConfig.windupDurationSeconds);
          transitions += 1;
          continue;
        }

        return { state: next, event };
      }

      case 'windup': {
        const consumed = consumePhaseTime(next, remainingSeconds);
        next = consumed.state;
        remainingSeconds -= consumed.seconds;
        if (next.phaseRemainingSeconds > EPSILON) {
          return { state: next, event };
        }

        // One output event per fixed step prevents degenerate zero-duration
        // configurations from producing an unbounded event burst.
        if (event) {
          return { state: next, event };
        }

        next = enterPhase(next, 'strike', safeConfig.strikeDurationSeconds);
        event = createStrikeEvent(next);
        transitions += 1;
        continue;
      }

      case 'strike': {
        const consumed = consumePhaseTime(next, remainingSeconds);
        next = consumed.state;
        remainingSeconds -= consumed.seconds;
        if (next.phaseRemainingSeconds > EPSILON) {
          return { state: next, event };
        }

        next = enterPhase(next, 'recovery', safeConfig.recoveryDurationSeconds);
        transitions += 1;
        continue;
      }

      case 'recovery': {
        const consumed = consumePhaseTime(next, remainingSeconds);
        next = consumed.state;
        remainingSeconds -= consumed.seconds;
        if (next.phaseRemainingSeconds > EPSILON) {
          return { state: next, event };
        }

        next = enterPhase(next, 'chase', 0);
        transitions += 1;
        continue;
      }
    }
  }

  return { state: next, event };
}

function enterPhase(state: ChaserState, phase: ChaserPhase, durationSeconds: number): ChaserState {
  return {
    ...state,
    phase,
    phaseRemainingSeconds: Math.max(0, durationSeconds),
  };
}

function consumePhaseTime(
  state: ChaserState,
  availableSeconds: number,
): { readonly state: ChaserState; readonly seconds: number } {
  const seconds = Math.min(availableSeconds, state.phaseRemainingSeconds);
  return {
    state: {
      ...state,
      phaseRemainingSeconds: Math.max(0, state.phaseRemainingSeconds - seconds),
    },
    seconds,
  };
}

function createStrikeEvent(state: ChaserState): ChaserStrikeEvent {
  return {
    type: 'chaser-strike',
    position: { ...state.position },
    direction: { ...state.facing },
  };
}

function readTarget(input: ChaserStepInput): PlayerVector | null {
  if (!isRecord(input) || !isFiniteVector(input.targetPosition)) {
    return null;
  }

  return finiteVector(input.targetPosition);
}

function sanitizeState(state: ChaserState): ChaserState {
  const source: Record<string, unknown> = isRecord(state) ? state : {};
  return {
    position: finiteVector(source.position),
    facing: unitOrFallback(source.facing, DEFAULT_FACING),
    phase: isChaserPhase(source.phase) ? source.phase : 'chase',
    phaseRemainingSeconds: Math.max(0, finiteOrZero(source.phaseRemainingSeconds)),
  };
}

function normalizeConfig(config: ChaserConfig): ChaserConfig {
  const source: Record<string, unknown> = isRecord(config) ? config : {};
  return {
    chaseSpeed: Math.max(0, finiteOrZero(source.chaseSpeed)),
    attackRange: Math.max(0, finiteOrZero(source.attackRange)),
    windupDurationSeconds: Math.max(0, finiteOrZero(source.windupDurationSeconds)),
    strikeDurationSeconds: Math.max(0, finiteOrZero(source.strikeDurationSeconds)),
    recoveryDurationSeconds: Math.max(0, finiteOrZero(source.recoveryDurationSeconds)),
  };
}

function subtract(target: PlayerVector, position: PlayerVector): PlayerVector {
  return { x: target.x - position.x, z: target.z - position.z };
}

function addScaled(position: PlayerVector, direction: PlayerVector, distance: number): PlayerVector {
  return {
    x: position.x + direction.x * distance,
    z: position.z + direction.z * distance,
  };
}

function finiteVector(value: unknown): PlayerVector {
  if (!isRecord(value)) {
    return { x: 0, z: 0 };
  }

  return { x: finiteOrZero(value.x), z: finiteOrZero(value.z) };
}

function unitOrFallback(value: unknown, fallback: PlayerVector): PlayerVector {
  const vector = finiteVector(value);
  const length = Math.hypot(vector.x, vector.z);
  return length >= EPSILON
    ? { x: vector.x / length, z: vector.z / length }
    : { x: fallback.x, z: fallback.z };
}

function isFiniteVector(value: unknown): value is PlayerVector {
  return isRecord(value)
    && typeof value.x === 'number'
    && typeof value.z === 'number'
    && Number.isFinite(value.x)
    && Number.isFinite(value.z);
}

function isChaserPhase(value: unknown): value is ChaserPhase {
  return value === 'chase' || value === 'windup' || value === 'strike' || value === 'recovery';
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function finiteOrZero(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : 0;
}
