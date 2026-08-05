import * as THREE from 'three';
import {
  INITIAL_TOUCH_INTENT_STATE,
  reduceTouchIntent,
  stepTouchIntent,
  type TouchIntentPoint,
  type TouchIntentRegion,
  type TouchIntentState,
  type WritablePlayerIntent,
} from './game/input/touchIntent';
import {
  MobileRunMetricsRecorder,
  type MobileRenderObjectCounters,
  type MobileRunMetricsSnapshot,
} from './game/debug/mobileRunMetrics';
import {
  stepPlayerState,
  type PlayerState,
  type PlayerStepConfig,
} from './game/player/playerState';
import { createSparkArena } from './game/world/sparkArena';
import { clampSparkArenaCircleToBounds } from './game/world/sparkArenaCollision';
import './styles.css';

const root = document.querySelector<HTMLElement>('#game-root');
const canvas = document.querySelector<HTMLCanvasElement>('#game-canvas');
const rotateGate = document.querySelector<HTMLElement>('#rotate-gate');
const metricsElement = document.querySelector<HTMLElement>('#dev-metrics');
const moveControl = document.querySelector<HTMLElement>('.touch-control--move');
const aimControl = document.querySelector<HTMLElement>('.touch-control--aim');
const dashControl = document.querySelector<HTMLElement>('.touch-dash');

if (!root || !canvas || !rotateGate || !metricsElement || !moveControl || !aimControl || !dashControl) {
  throw new Error('Vireglass Spark loop markup is incomplete.');
}

const gameRoot = root;
const gameMetrics = metricsElement;
const moveTouchControl = moveControl;
const aimTouchControl = aimControl;
const dashTouchControl = dashControl;

const QUALITY = Object.freeze({
  tier: 'default',
  maxDevicePixelRatio: 1.5,
});

const SPARK_ARENA_SEED = 'spark-001';
const FIXED_STEP_SECONDS = 1 / 60;
const MAX_FRAME_DELTA_SECONDS = 0.1;
const MAX_FIXED_STEPS_PER_FRAME = 6;
const PLAYER_RADIUS = 0.45;
const DEV_METRICS_INTERVAL_MS = 250;
const PLAYER_STEP_CONFIG: PlayerStepConfig = Object.freeze({
  moveSpeed: 4.2,
  dashSpeed: 10.5,
  dashDurationSeconds: 0.12,
  dashCooldownSeconds: 0.55,
});

const scene = new THREE.Scene();
scene.background = new THREE.Color('#090d18');

const sparkArena = createSparkArena({ seed: SPARK_ARENA_SEED });
scene.add(sparkArena.group);

const arenaBounds = sparkArena.metadata.bounds;
const arenaCenterX = (arenaBounds.minX + arenaBounds.maxX) * 0.5;
const arenaCenterZ = (arenaBounds.minZ + arenaBounds.maxZ) * 0.5;
const arenaWidth = arenaBounds.maxX - arenaBounds.minX;
const arenaDepth = arenaBounds.maxZ - arenaBounds.minZ;

const camera = new THREE.PerspectiveCamera(42, 1, 0.1, 100);
camera.position.set(
  arenaCenterX,
  Math.max(11, arenaDepth * 0.9),
  arenaCenterZ + Math.max(13, arenaWidth * 0.75),
);
camera.lookAt(arenaCenterX, 0, arenaCenterZ);

const renderer = new THREE.WebGLRenderer({
  canvas,
  antialias: true,
  alpha: false,
  powerPreference: 'default',
});
renderer.setPixelRatio(cappedDevicePixelRatio());
renderer.outputColorSpace = THREE.SRGBColorSpace;

const ambient = new THREE.HemisphereLight('#b9d4ff', '#19213b', 1.8);
scene.add(ambient);

// The player is a single opaque mesh that points along the group's +Z axis.
const playerGeometry = new THREE.ConeGeometry(0.46, 0.9, 5);
const playerMaterial = new THREE.MeshBasicMaterial({ color: '#ffd27a' });
const playerMesh = new THREE.Mesh(playerGeometry, playerMaterial);
playerMesh.rotation.x = Math.PI * 0.5;
playerMesh.position.y = PLAYER_RADIUS;

const playerVisual = new THREE.Group();
playerVisual.name = 'spark-player';
playerVisual.add(playerMesh);
playerVisual.position.set(
  sparkArena.metadata.playerSpawn.x,
  sparkArena.metadata.playerSpawn.y,
  sparkArena.metadata.playerSpawn.z,
);
scene.add(playerVisual);

// Five arena renderables plus the player mesh are the active scene renderables.
const activeEntityCount = sparkArena.group.children.length + playerVisual.children.length;

type MutableRenderCounters = {
  -readonly [Key in keyof MobileRenderObjectCounters]: MobileRenderObjectCounters[Key];
};

type DevMetrics = MobileRunMetricsSnapshot & {
  readonly sampleMs: number;
  readonly viewport: { readonly width: number; readonly height: number; readonly effectiveDpr: number };
  readonly player: {
    readonly x: number;
    readonly z: number;
    readonly facingX: number;
    readonly facingZ: number;
    readonly dashRemainingSeconds: number;
    readonly dashCooldownRemainingSeconds: number;
  };
  readonly simulation: {
    readonly fixedStepSeconds: number;
    readonly fixedSteps: number;
    readonly dashExecutions: number;
    readonly collisionClamps: number;
  };
  readonly arena: {
    readonly requestedSeed: string;
    readonly normalizedSeed: string;
    readonly fingerprint: string;
  };
};

const initialViewport = viewportSize();
const runStartedAt = performance.now();
const runMetrics = new MobileRunMetricsRecorder({
  runId: `spark-loop-${Math.round(Date.now())}`,
  buildRevision: import.meta.env.DEV ? 'development' : 'production',
  scenario: 'interactive touch loop preflight',
  scenarioSeed: SPARK_ARENA_SEED,
  startedAtMs: Date.now(),
  qualityTier: QUALITY.tier,
  viewport: {
    width: initialViewport.width,
    height: initialViewport.height,
    effectiveDpr: renderer.getPixelRatio(),
  },
});

const renderCounters: MutableRenderCounters = {
  calls: 0,
  triangles: 0,
  points: 0,
  lines: 0,
  geometries: 0,
  textures: 0,
  activeEntities: activeEntityCount,
  sceneResetCount: 0,
};

const playerIntent: WritablePlayerIntent = {
  movement: { x: 0, z: 0 },
  aim: { x: 0, z: 0 },
  dashRequested: false,
};
const clampedPlayerPosition = { x: sparkArena.metadata.playerSpawn.x, z: sparkArena.metadata.playerSpawn.z };

let playerState: PlayerState = {
  position: { x: sparkArena.metadata.playerSpawn.x, z: sparkArena.metadata.playerSpawn.z },
  facing: { x: 0, z: 1 },
  dashDirection: { x: 0, z: 1 },
  dashRemainingSeconds: 0,
  dashCooldownRemainingSeconds: 0,
};
let touchIntentState: TouchIntentState = INITIAL_TOUCH_INTENT_STATE;
let simulationAccumulator = 0;
let totalFixedSteps = 0;
let dashExecutions = 0;
let collisionClamps = 0;
let lastFrameAt = runStartedAt;
let nextDevMetricsAt = runStartedAt;
let latestMetrics: DevMetrics | undefined;

function viewportSize(): { width: number; height: number } {
  const viewport = window.visualViewport;
  return {
    width: Math.max(1, Math.round(viewport?.width ?? window.innerWidth)),
    height: Math.max(1, Math.round(viewport?.height ?? window.innerHeight)),
  };
}

function cappedDevicePixelRatio(): number {
  return Math.min(window.devicePixelRatio || 1, QUALITY.maxDevicePixelRatio);
}

function resize(): void {
  const { width, height } = viewportSize();
  gameRoot.style.setProperty('--visual-width', `${width}px`);
  gameRoot.style.setProperty('--visual-height', `${height}px`);

  const rotateRequired = width < 640 || width / height < 1.35;
  gameRoot.classList.toggle('is-rotate-required', rotateRequired);
  if (rotateRequired) {
    touchIntentState = INITIAL_TOUCH_INTENT_STATE;
    simulationAccumulator = 0;
  }

  renderer.setPixelRatio(cappedDevicePixelRatio());
  camera.aspect = width / height;
  camera.updateProjectionMatrix();
  renderer.setSize(width, height, false);
}

function isPlaySurfaceReady(): boolean {
  return !gameRoot.classList.contains('is-rotate-required');
}

function pointInControl(control: HTMLElement, clientX: number, clientY: number): boolean {
  const bounds = control.getBoundingClientRect();
  const radius = Math.min(bounds.width, bounds.height) * 0.5;
  const deltaX = clientX - (bounds.left + bounds.width * 0.5);
  const deltaY = clientY - (bounds.top + bounds.height * 0.5);
  return deltaX * deltaX + deltaY * deltaY <= radius * radius;
}

function touchRegionAt(clientX: number, clientY: number): TouchIntentRegion | 'dash' | null {
  if (pointInControl(dashTouchControl, clientX, clientY)) return 'dash';
  if (pointInControl(moveTouchControl, clientX, clientY)) return 'move';
  if (pointInControl(aimTouchControl, clientX, clientY)) return 'aim';
  return null;
}

function touchPointFromEvent(event: PointerEvent): TouchIntentPoint {
  const bounds = gameRoot.getBoundingClientRect();
  return {
    x: event.clientX - bounds.left,
    y: event.clientY - bounds.top,
  };
}

function handlePointerDown(event: PointerEvent): void {
  if (event.pointerType !== 'touch' || !isPlaySurfaceReady()) return;

  const region = touchRegionAt(event.clientX, event.clientY);
  if (!region) return;

  event.preventDefault();
  if (region === 'dash') {
    touchIntentState = reduceTouchIntent(touchIntentState, { type: 'dash' });
    return;
  }

  touchIntentState = reduceTouchIntent(touchIntentState, {
    type: 'start',
    region,
    pointerId: event.pointerId,
    point: touchPointFromEvent(event),
  });

  if (event.isTrusted) {
    try {
      gameRoot.setPointerCapture(event.pointerId);
    } catch {
      // Safari may release a pointer before capture when the browser takes over.
    }
  }
}

function handlePointerMove(event: PointerEvent): void {
  if (event.pointerType !== 'touch') return;

  const nextState = reduceTouchIntent(touchIntentState, {
    type: 'move',
    pointerId: event.pointerId,
    point: touchPointFromEvent(event),
  });
  if (nextState !== touchIntentState) event.preventDefault();
  touchIntentState = nextState;
}

function handlePointerEnd(event: PointerEvent): void {
  if (event.pointerType !== 'touch') return;

  const nextState = reduceTouchIntent(touchIntentState, {
    type: event.type === 'pointercancel' ? 'cancel' : 'end',
    pointerId: event.pointerId,
  });
  if (nextState !== touchIntentState) event.preventDefault();
  touchIntentState = nextState;

  if (event.isTrusted && gameRoot.hasPointerCapture(event.pointerId)) {
    gameRoot.releasePointerCapture(event.pointerId);
  }
}

function advanceSimulation(): void {
  touchIntentState = stepTouchIntent(touchIntentState, playerIntent);
  const dashCouldStart = playerIntent.dashRequested
    && playerState.dashRemainingSeconds <= 0
    && playerState.dashCooldownRemainingSeconds <= 0;
  const steppedPlayerState = stepPlayerState(
    playerState,
    playerIntent,
    arenaBounds,
    PLAYER_STEP_CONFIG,
    FIXED_STEP_SECONDS,
  );
  const clamped = clampSparkArenaCircleToBounds(
    sparkArena.metadata,
    steppedPlayerState.position,
    PLAYER_RADIUS,
    clampedPlayerPosition,
  );
  playerState = clamped
    ? {
      ...steppedPlayerState,
      position: { x: clampedPlayerPosition.x, z: clampedPlayerPosition.z },
    }
    : steppedPlayerState;

  if (dashCouldStart && playerState.dashRemainingSeconds > 0) dashExecutions += 1;
  if (clamped) collisionClamps += 1;
  totalFixedSteps += 1;
}

function syncPlayerVisual(): void {
  playerVisual.position.x = playerState.position.x;
  playerVisual.position.z = playerState.position.z;
  playerVisual.rotation.y = Math.atan2(playerState.facing.x, playerState.facing.z);
}

function updateRenderCounters(): void {
  renderCounters.calls = renderer.info.render.calls;
  renderCounters.triangles = renderer.info.render.triangles;
  renderCounters.points = renderer.info.render.points;
  renderCounters.lines = renderer.info.render.lines;
  renderCounters.geometries = renderer.info.memory.geometries;
  renderCounters.textures = renderer.info.memory.textures;
}

function collectDevMetrics(now: number): DevMetrics {
  const snapshot = runMetrics.snapshot();
  const { width, height } = viewportSize();
  return {
    ...snapshot,
    sampleMs: Math.max(0, Math.round(now - runStartedAt)),
    viewport: { width, height, effectiveDpr: renderer.getPixelRatio() },
    player: {
      x: playerState.position.x,
      z: playerState.position.z,
      facingX: playerState.facing.x,
      facingZ: playerState.facing.z,
      dashRemainingSeconds: playerState.dashRemainingSeconds,
      dashCooldownRemainingSeconds: playerState.dashCooldownRemainingSeconds,
    },
    simulation: {
      fixedStepSeconds: FIXED_STEP_SECONDS,
      fixedSteps: totalFixedSteps,
      dashExecutions,
      collisionClamps,
    },
    arena: {
      requestedSeed: SPARK_ARENA_SEED,
      normalizedSeed: sparkArena.metadata.seed,
      fingerprint: sparkArena.metadata.fingerprint,
    },
  };
}

function drawDevMetrics(metrics: DevMetrics): void {
  if (!import.meta.env.DEV) return;

  gameMetrics.textContent = [
    'DEV INTERACTIVE PREFLIGHT',
    `player ${metrics.player.x.toFixed(2)}, ${metrics.player.z.toFixed(2)} | dash ${metrics.simulation.dashExecutions}`,
    `${metrics.viewport.width}x${metrics.viewport.height} @ ${metrics.viewport.effectiveDpr.toFixed(2)}x`,
    `frame median ${metrics.frameTimes.medianMs.toFixed(1)}ms / p95 ${metrics.frameTimes.p95Ms.toFixed(1)}ms`,
    `slow streak ${metrics.frameTimes.consecutiveSlowFrames} / max ${metrics.frameTimes.longestSlowFrameStreak}`,
    `calls ${metrics.latestCounters.calls} | tris ${metrics.latestCounters.triangles} | geo ${metrics.latestCounters.geometries} | tex ${metrics.latestCounters.textures}`,
    `entities ${metrics.latestCounters.activeEntities} | resets ${metrics.latestCounters.sceneResetCount} (${metrics.resetStability.status})`,
    `sample ${(metrics.sampleMs / 1000).toFixed(0)}s | tier ${metrics.qualityTier}`,
    `arena ${metrics.arena.requestedSeed} | ${metrics.arena.fingerprint}`,
  ].join('\n');
}

function frame(now: number): void {
  const frameDeltaSeconds = Math.min(
    Math.max(0, (now - lastFrameAt) * 0.001),
    MAX_FRAME_DELTA_SECONDS,
  );
  lastFrameAt = now;

  if (isPlaySurfaceReady()) {
    simulationAccumulator += frameDeltaSeconds;
    let stepsThisFrame = 0;
    while (simulationAccumulator >= FIXED_STEP_SECONDS && stepsThisFrame < MAX_FIXED_STEPS_PER_FRAME) {
      advanceSimulation();
      simulationAccumulator -= FIXED_STEP_SECONDS;
      stepsThisFrame += 1;
    }
    if (stepsThisFrame === MAX_FIXED_STEPS_PER_FRAME) simulationAccumulator = 0;
  } else {
    simulationAccumulator = 0;
  }

  syncPlayerVisual();
  renderer.render(scene, camera);
  updateRenderCounters();
  runMetrics.recordFrame(frameDeltaSeconds * 1000, renderCounters);

  if (import.meta.env.DEV && now >= nextDevMetricsAt) {
    latestMetrics = collectDevMetrics(now);
    drawDevMetrics(latestMetrics);
    nextDevMetricsAt = now + DEV_METRICS_INTERVAL_MS;
  }

  requestAnimationFrame(frame);
}

// This is inspectable only in development; it exposes measured state, not approval.
if (import.meta.env.DEV) {
  (window as Window & { __vireglassMetrics?: () => DevMetrics }).__vireglassMetrics = () => {
    latestMetrics = collectDevMetrics(performance.now());
    return latestMetrics;
  };
}

gameRoot.addEventListener('pointerdown', handlePointerDown, { passive: false });
gameRoot.addEventListener('pointermove', handlePointerMove, { passive: false });
gameRoot.addEventListener('pointerup', handlePointerEnd, { passive: false });
gameRoot.addEventListener('pointercancel', handlePointerEnd, { passive: false });
gameRoot.addEventListener('touchmove', (event) => event.preventDefault(), { passive: false });
gameRoot.addEventListener('gesturestart', (event) => event.preventDefault());
gameRoot.addEventListener('gesturechange', (event) => event.preventDefault());
gameRoot.addEventListener('gestureend', (event) => event.preventDefault());
window.addEventListener('resize', resize, { passive: true });
window.visualViewport?.addEventListener('resize', resize, { passive: true });
window.visualViewport?.addEventListener('scroll', resize, { passive: true });

resize();
syncPlayerVisual();
requestAnimationFrame(frame);
