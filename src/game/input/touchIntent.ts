import {
  normalizePlayerIntent,
  type PlayerIntent,
  type PlayerVector,
} from '../player/playerState';

/**
 * A DOM-free touch reducer for the two gameplay controls. The input adapter
 * assigns a pointer to a region and forwards its coordinates in one consistent
 * surface coordinate space; this module never reads browser events directly.
 */
export type TouchIntentRegion = 'move' | 'aim';

export interface TouchIntentPoint {
  readonly x: number;
  readonly y: number;
}

export interface ActiveTouchIntent {
  readonly pointerId: number;
  readonly origin: TouchIntentPoint;
  readonly current: TouchIntentPoint;
}

export interface TouchIntentState {
  readonly moveTouch: ActiveTouchIntent | null;
  readonly aimTouch: ActiveTouchIntent | null;
  /** Queued by a touch affordance and consumed by exactly one fixed step. */
  readonly dashPending: boolean;
}

export type TouchIntentAction =
  | {
      readonly type: 'start';
      readonly region: TouchIntentRegion;
      readonly pointerId: number;
      readonly point: TouchIntentPoint;
    }
  | {
      readonly type: 'move';
      readonly pointerId: number;
      readonly point: TouchIntentPoint;
    }
  | {
      readonly type: 'end' | 'cancel';
      readonly pointerId: number;
    }
  | { readonly type: 'dash' };

export interface TouchIntentConfig {
  /** Drag distance in adapter coordinate units that reaches full intent. */
  readonly maxDragDistance: number;
}

/**
 * A reusable target for the fixed-step loop. It is structurally compatible
 * with PlayerIntent, so it can be passed directly to player simulation.
 */
export interface WritablePlayerIntent {
  movement: { x: number; z: number };
  aim: { x: number; z: number };
  dashRequested: boolean;
}

export const DEFAULT_TOUCH_INTENT_CONFIG: TouchIntentConfig = Object.freeze({
  maxDragDistance: 96,
});

export const INITIAL_TOUCH_INTENT_STATE: TouchIntentState = Object.freeze({
  moveTouch: null,
  aimTouch: null,
  dashPending: false,
});

const MIN_DRAG_DISTANCE = 0.000001;

/**
 * Deterministically applies a single touch action. A pointer may claim one
 * region only; later/duplicate starts and stale moves or releases are ignored.
 */
export function reduceTouchIntent(
  state: TouchIntentState,
  action: TouchIntentAction,
): TouchIntentState {
  if (!action || typeof action !== 'object' || !('type' in action)) {
    return state;
  }

  switch (action.type) {
    case 'start':
      return startTouch(state, action);
    case 'move':
      return moveTouch(state, action);
    case 'end':
    case 'cancel':
      return releaseTouch(state, action.pointerId);
    case 'dash':
      return state.dashPending ? state : { ...state, dashPending: true };
    default:
      return state;
  }
}

/**
 * Convenience allocation for tooling. Fixed-step gameplay should prefer
 * stepTouchIntent() with a reusable WritablePlayerIntent buffer.
 */
export function toPlayerIntent(
  state: TouchIntentState,
  config: TouchIntentConfig = DEFAULT_TOUCH_INTENT_CONFIG,
): PlayerIntent {
  return normalizePlayerIntent({
    movement: touchToVector(state.moveTouch, config),
    aim: touchToVector(state.aimTouch, config),
    dashRequested: state.dashPending,
  });
}

/**
 * Writes normalized intent into a caller-reused buffer, avoiding per-step
 * vector/output allocation. The returned state consumes one queued dash edge,
 * so the caller must retain it for the next fixed step.
 */
export function stepTouchIntent(
  state: TouchIntentState,
  target: WritablePlayerIntent,
  config: TouchIntentConfig = DEFAULT_TOUCH_INTENT_CONFIG,
): TouchIntentState {
  writeTouchVector(target.movement, state.moveTouch, config);
  writeTouchVector(target.aim, state.aimTouch, config);
  target.dashRequested = state.dashPending;

  return state.dashPending ? { ...state, dashPending: false } : state;
}

function startTouch(
  state: TouchIntentState,
  action: Extract<TouchIntentAction, { type: 'start' }>,
): TouchIntentState {
  if (!isTouchIntentRegion(action.region) || !isValidPointerId(action.pointerId) || !isValidPoint(action.point)) {
    return state;
  }

  if (isPointerClaimed(state, action.pointerId)) {
    return state;
  }

  const touch = createActiveTouch(action.pointerId, action.point);
  if (action.region === 'move') {
    return state.moveTouch ? state : { ...state, moveTouch: touch };
  }

  return state.aimTouch ? state : { ...state, aimTouch: touch };
}

function moveTouch(
  state: TouchIntentState,
  action: Extract<TouchIntentAction, { type: 'move' }>,
): TouchIntentState {
  if (!isValidPointerId(action.pointerId) || !isValidPoint(action.point)) {
    return state;
  }

  if (state.moveTouch?.pointerId === action.pointerId) {
    return { ...state, moveTouch: { ...state.moveTouch, current: copyPoint(action.point) } };
  }

  if (state.aimTouch?.pointerId === action.pointerId) {
    return { ...state, aimTouch: { ...state.aimTouch, current: copyPoint(action.point) } };
  }

  return state;
}

function releaseTouch(state: TouchIntentState, pointerId: number): TouchIntentState {
  if (!isValidPointerId(pointerId)) {
    return state;
  }

  const releasesMove = state.moveTouch?.pointerId === pointerId;
  const releasesAim = state.aimTouch?.pointerId === pointerId;
  if (!releasesMove && !releasesAim) {
    return state;
  }

  return {
    ...state,
    moveTouch: releasesMove ? null : state.moveTouch,
    aimTouch: releasesAim ? null : state.aimTouch,
  };
}

function touchToVector(
  touch: ActiveTouchIntent | null,
  config: TouchIntentConfig,
): PlayerVector {
  const vector = { x: 0, z: 0 };
  writeTouchVector(vector, touch, config);
  return vector;
}

function writeTouchVector(
  target: { x: number; z: number },
  touch: ActiveTouchIntent | null,
  config: TouchIntentConfig,
): void {
  if (!touch) {
    target.x = 0;
    target.z = 0;
    return;
  }

  const maxDragDistance = validDragDistance(config.maxDragDistance);
  const x = finiteOrZero(touch.current.x) - finiteOrZero(touch.origin.x);
  // Screen-up input maps to positive arena-z by convention.
  const z = finiteOrZero(touch.origin.y) - finiteOrZero(touch.current.y);
  const length = Math.hypot(x, z);
  if (length < MIN_DRAG_DISTANCE) {
    target.x = 0;
    target.z = 0;
    return;
  }

  const scale = length > maxDragDistance ? 1 / length : 1 / maxDragDistance;
  target.x = x * scale;
  target.z = z * scale;
}

function createActiveTouch(pointerId: number, point: TouchIntentPoint): ActiveTouchIntent {
  const copiedPoint = copyPoint(point);
  return { pointerId, origin: copiedPoint, current: { ...copiedPoint } };
}

function copyPoint(point: TouchIntentPoint): TouchIntentPoint {
  return { x: point.x, y: point.y };
}

function isPointerClaimed(state: TouchIntentState, pointerId: number): boolean {
  return state.moveTouch?.pointerId === pointerId || state.aimTouch?.pointerId === pointerId;
}

function isTouchIntentRegion(region: unknown): region is TouchIntentRegion {
  return region === 'move' || region === 'aim';
}

function isValidPointerId(pointerId: unknown): pointerId is number {
  return typeof pointerId === 'number' && Number.isSafeInteger(pointerId) && pointerId >= 0;
}

function isValidPoint(point: unknown): point is TouchIntentPoint {
  return typeof point === 'object'
    && point !== null
    && 'x' in point
    && 'y' in point
    && typeof point.x === 'number'
    && typeof point.y === 'number'
    && Number.isFinite(point.x)
    && Number.isFinite(point.y);
}

function validDragDistance(value: number): number {
  return Number.isFinite(value) && value >= MIN_DRAG_DISTANCE
    ? value
    : DEFAULT_TOUCH_INTENT_CONFIG.maxDragDistance;
}

function finiteOrZero(value: number): number {
  return Number.isFinite(value) ? value : 0;
}
