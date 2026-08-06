/**
 * Renderer- and input-agnostic player vitality simulation.
 *
 * The integration layer supplies at most one hit candidate per fixed step.
 * This module owns only finite-value sanitization, damage acceptance,
 * invulnerability timing, and the one-shot terminal event.
 */

export interface PlayerVitalityState {
  readonly vitality: number;
  readonly invulnerabilityRemainingSeconds: number;
  readonly terminal: boolean;
}

export interface PlayerVitalityConfig {
  readonly maxVitality: number;
  readonly invulnerabilitySeconds: number;
  readonly fixedStepSeconds: number;
}

export interface PlayerVitalityStepInput {
  /** A non-positive, non-finite, or missing damage value is ignored. */
  readonly damage?: number;
}

export interface PlayerHitEvent {
  readonly type: 'player-hit';
  readonly damage: number;
  readonly vitality: number;
}

export interface PlayerTerminalEvent {
  readonly type: 'player-terminal';
  readonly damage: number;
  readonly vitality: 0;
}

export type PlayerVitalityEvent = PlayerHitEvent | PlayerTerminalEvent;

export interface PlayerVitalityStep {
  readonly state: PlayerVitalityState;
  readonly event: PlayerVitalityEvent | null;
}

export const DEFAULT_PLAYER_VITALITY_CONFIG: PlayerVitalityConfig = Object.freeze({
  maxVitality: 100,
  invulnerabilitySeconds: 0.5,
  fixedStepSeconds: 1 / 60,
});

export function createPlayerVitalityState(
  config: PlayerVitalityConfig = DEFAULT_PLAYER_VITALITY_CONFIG,
): PlayerVitalityState {
  const safeConfig = normalizeConfig(config);
  return {
    vitality: safeConfig.maxVitality,
    invulnerabilityRemainingSeconds: 0,
    terminal: false,
  };
}

/**
 * Advances exactly one configured fixed step.
 *
 * An active invulnerability window is tested at the start of the step. Its
 * timer then advances toward exact zero. Consequently a timer at exactly zero
 * is inactive and accepts a hit; a timer that reaches zero during this step
 * does not accept a hit until the next step. Terminal state is latched and
 * emits no further events.
 */
export function stepPlayerVitality(
  state: PlayerVitalityState,
  input: PlayerVitalityStepInput | null | undefined,
  config: PlayerVitalityConfig,
): PlayerVitalityStep {
  const safeConfig = normalizeConfig(config);
  const safeState = sanitizeState(state, safeConfig);
  const timerWasActive = safeState.invulnerabilityRemainingSeconds > 0;
  const elapsedTimer = timerWasActive
    ? Math.max(0, safeState.invulnerabilityRemainingSeconds - safeConfig.fixedStepSeconds)
    : 0;

  if (safeState.terminal || timerWasActive) {
    return {
      state: {
        ...safeState,
        invulnerabilityRemainingSeconds: elapsedTimer,
      },
      event: null,
    };
  }

  const damage = readDamage(input);
  if (damage <= 0) {
    return {
      state: { ...safeState, invulnerabilityRemainingSeconds: 0 },
      event: null,
    };
  }

  const vitality = Math.max(0, safeState.vitality - damage);
  if (vitality === 0) {
    return {
      state: {
        vitality: 0,
        invulnerabilityRemainingSeconds: 0,
        terminal: true,
      },
      event: { type: 'player-terminal', damage, vitality: 0 },
    };
  }

  return {
    state: {
      vitality,
      invulnerabilityRemainingSeconds: safeConfig.invulnerabilitySeconds,
      terminal: false,
    },
    event: { type: 'player-hit', damage, vitality },
  };
}

function sanitizeState(
  state: PlayerVitalityState,
  config: PlayerVitalityConfig,
): PlayerVitalityState {
  const source: Record<string, unknown> = isRecord(state) ? state : {};
  const vitality = clamp(finiteOrZero(source.vitality), 0, config.maxVitality);
  const terminal = source.terminal === true || vitality === 0;
  return {
    vitality: terminal ? 0 : vitality,
    invulnerabilityRemainingSeconds: terminal
      ? 0
      : clamp(finiteOrZero(source.invulnerabilityRemainingSeconds), 0, config.invulnerabilitySeconds),
    terminal,
  };
}

function normalizeConfig(config: PlayerVitalityConfig | null | undefined): PlayerVitalityConfig {
  const source: Record<string, unknown> = isRecord(config) ? config : {};
  return {
    maxVitality: Math.max(0, finiteOrFallback(source.maxVitality, DEFAULT_PLAYER_VITALITY_CONFIG.maxVitality)),
    invulnerabilitySeconds: Math.max(
      0,
      finiteOrFallback(source.invulnerabilitySeconds, DEFAULT_PLAYER_VITALITY_CONFIG.invulnerabilitySeconds),
    ),
    fixedStepSeconds: Math.max(
      0,
      finiteOrFallback(source.fixedStepSeconds, DEFAULT_PLAYER_VITALITY_CONFIG.fixedStepSeconds),
    ),
  };
}

function readDamage(input: PlayerVitalityStepInput | null | undefined): number {
  return isRecord(input) ? Math.max(0, finiteOrZero(input.damage)) : 0;
}

function finiteOrFallback(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

function finiteOrZero(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : 0;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}
