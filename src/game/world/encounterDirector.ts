/**
 * Renderer-free deterministic encounter cadence. The integration layer owns
 * the spawned entities; this module owns only bounded plain-data transitions.
 */

export interface EncounterDirectorConfig {
  /** Seconds between spawn opportunities. Zero means every fixed step. */
  readonly spawnIntervalSeconds: number;
  /** Maximum number of encounters the integration layer may keep active. */
  readonly maxActiveEncounters: number;
  /** Maximum spawn events emitted by one fixed step. */
  readonly maxEventsPerStep: number;
}

export interface EncounterDirectorState {
  readonly seed: number;
  readonly elapsedSeconds: number;
  readonly nextSpawnInSeconds: number;
  readonly activeCount: number;
  readonly spawnCount: number;
}

export interface EncounterSpawnEvent {
  readonly type: 'encounter-spawn';
  readonly ordinal: number;
  readonly seed: number;
}

export interface EncounterDirectorStep {
  readonly state: EncounterDirectorState;
  readonly events: readonly EncounterSpawnEvent[];
}

export const DEFAULT_ENCOUNTER_DIRECTOR_CONFIG: EncounterDirectorConfig = Object.freeze({
  spawnIntervalSeconds: 1,
  maxActiveEncounters: 8,
  maxEventsPerStep: 1,
});

export const DEFAULT_ENCOUNTER_SEED = 0x6d2b79f5;
export const MAX_FIXED_STEP_SECONDS = 0.1;
export const MAX_ACTIVE_ENCOUNTERS = 64;
export const MAX_EVENTS_PER_STEP = 8;

const EPSILON = 0.000001;

/** Creates a fresh deterministic director state from any finite seed value. */
export function createEncounterDirectorState(seed = DEFAULT_ENCOUNTER_SEED): EncounterDirectorState {
  return Object.freeze({
    seed: normalizeSeed(seed),
    elapsedSeconds: 0,
    nextSpawnInSeconds: 0,
    activeCount: 0,
    spawnCount: 0,
  });
}

/** Repairs malformed configuration into a bounded, deterministic config. */
export function normalizeEncounterDirectorConfig(
  config: EncounterDirectorConfig,
): EncounterDirectorConfig {
  const source: Record<string, unknown> = isRecord(config) ? config : {};
  return Object.freeze({
    spawnIntervalSeconds: Math.max(0, finiteOrZero(source.spawnIntervalSeconds)),
    maxActiveEncounters: clampInteger(source.maxActiveEncounters, 0, MAX_ACTIVE_ENCOUNTERS),
    maxEventsPerStep: clampInteger(source.maxEventsPerStep, 0, MAX_EVENTS_PER_STEP),
  });
}

/**
 * Releases active encounters without creating events. The returned state is
 * clamped, so a stale or malformed count cannot make the cap negative.
 */
export function releaseEncounterDirectorActive(
  state: EncounterDirectorState,
  count = 1,
): EncounterDirectorState {
  const safeState = sanitizeState(state);
  const releaseCount = clampInteger(count, 0, safeState.activeCount);
  return Object.freeze({
    ...safeState,
    activeCount: safeState.activeCount - releaseCount,
  });
}

/**
 * Advances one bounded fixed step. It uses no wall clock, random source,
 * renderer, input device, or unbounded loop. A spawn seed is derived solely
 * from the initial seed and its stable ordinal.
 */
export function stepEncounterDirector(
  state: EncounterDirectorState,
  config: EncounterDirectorConfig,
  deltaSeconds: number,
): EncounterDirectorStep {
  const safeState = sanitizeState(state);
  const safeConfig = normalizeEncounterDirectorConfig(config);
  const stepSeconds = clamp(finiteOrZero(deltaSeconds), 0, MAX_FIXED_STEP_SECONDS);
  let nextSpawnInSeconds = Math.max(0, safeState.nextSpawnInSeconds - stepSeconds);
  let activeCount = safeState.activeCount;
  let spawnCount = safeState.spawnCount;
  const events: EncounterSpawnEvent[] = [];

  while (
    nextSpawnInSeconds <= EPSILON &&
    activeCount < safeConfig.maxActiveEncounters &&
    events.length < safeConfig.maxEventsPerStep
  ) {
    const ordinal = spawnCount;
    events.push(Object.freeze({
      type: 'encounter-spawn',
      ordinal,
      seed: deriveEncounterSeed(safeState.seed, ordinal),
    }));
    activeCount += 1;
    spawnCount += 1;
    nextSpawnInSeconds = safeConfig.spawnIntervalSeconds;
    if (safeConfig.spawnIntervalSeconds > EPSILON) break;
  }

  return Object.freeze({
    state: Object.freeze({
      seed: safeState.seed,
      elapsedSeconds: safeState.elapsedSeconds + stepSeconds,
      nextSpawnInSeconds,
      activeCount,
      spawnCount,
    }),
    events: Object.freeze(events),
  });
}

/** Stable integer seed for one spawn ordinal; no global mutable RNG state. */
export function deriveEncounterSeed(seed: number, ordinal: number): number {
  let value = normalizeSeed(seed) ^ Math.imul(normalizeOrdinal(ordinal), 0x9e3779b9);
  value ^= value >>> 16;
  value = Math.imul(value, 0x85ebca6b);
  value ^= value >>> 13;
  value = Math.imul(value, 0xc2b2ae35);
  value ^= value >>> 16;
  return value >>> 0;
}

function sanitizeState(state: EncounterDirectorState): EncounterDirectorState {
  const source: Record<string, unknown> = isRecord(state) ? state : {};
  return {
    seed: normalizeSeed(source.seed),
    elapsedSeconds: Math.max(0, finiteOrZero(source.elapsedSeconds)),
    nextSpawnInSeconds: Math.max(0, finiteOrZero(source.nextSpawnInSeconds)),
    activeCount: clampInteger(source.activeCount, 0, MAX_ACTIVE_ENCOUNTERS),
    spawnCount: normalizeOrdinal(source.spawnCount),
  };
}

function normalizeSeed(value: unknown): number {
  return (Number.isFinite(value) ? Number(value) : DEFAULT_ENCOUNTER_SEED) >>> 0;
}

function normalizeOrdinal(value: unknown): number {
  return clampInteger(value, 0, 0x1fffffff);
}

function clampInteger(value: unknown, min: number, max: number): number {
  const numeric = Number.isFinite(value) ? Number(value) : min;
  return Math.min(max, Math.max(min, Math.floor(numeric)));
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
