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
import {
  createAimedShardCast,
  stepAimedShardCast,
  type AimedShardCastState,
  type ShardCollision,
  type ShardCollisionSweep,
} from './game/combat/aimedShardCast';
import {
  createCrystalImpactPool,
  type CrystalImpact,
} from './game/world/crystalImpact';
import {
  createChaserState,
  stepChaserState,
  type ChaserConfig,
  type ChaserState,
} from './game/enemy/chaserState';
import {
  applyChaserShardHit,
  createChaserVitality,
  type ChaserVitalityState,
} from './game/enemy/chaserVitality';
import { createSparkArena } from './game/world/sparkArena';
import { clampSparkArenaCircleToBounds } from './game/world/sparkArenaCollision';
import { createSparkSpawnCandidates } from './game/world/sparkSpawnPoints';
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
const SHARD_POOL_CAPACITY = 4;
const SHARD_SPEED = 13;
const SHARD_MAX_RANGE = 9;
const SHARD_MAX_LIFETIME_SECONDS = 0.75;
const SHARD_LAUNCH_INTERVAL_SECONDS = 0.3;
const SHARD_RADIUS = 0.12;
const SHARD_COLLISION_MARGIN = 0.2;
const CRYSTAL_IMPACT_POOL_CAPACITY = 4;
const CRYSTAL_IMPACT_LIFETIME_STEPS = 11;
// Conservative bounded enemy slice: three preallocated chasers, with no
// respawn, randomness, health, damage, or additional enemy types.
const CHASER_CAPACITY = 3;
const CHASER_RADIUS = 0.38;
const CHASER_HIT_RADIUS = CHASER_RADIUS + SHARD_RADIUS;
const CHASER_MAX_HEALTH = 1;
const CHASER_STEP_CONFIG: ChaserConfig = Object.freeze({
  chaseSpeed: 1.35,
  attackRange: 1.2,
  windupDurationSeconds: 0.28,
  strikeDurationSeconds: 0.12,
  recoveryDurationSeconds: 0.42,
});
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

type ChaserSlot = {
  state: ChaserState;
  vitality: ChaserVitalityState;
  readonly mesh: THREE.Mesh;
};

const chaserGeometry = new THREE.OctahedronGeometry(0.42, 0);
const chaserMaterial = new THREE.MeshBasicMaterial({ color: '#ff7185' });
const chaserSpawnCandidates = createSparkSpawnCandidates(sparkArena.metadata, CHASER_CAPACITY);
const chaserSlots: ChaserSlot[] = chaserSpawnCandidates.candidates.map((candidate, index) => {
  const mesh = new THREE.Mesh(chaserGeometry, chaserMaterial);
  mesh.name = `spark-chaser-${index}`;
  mesh.position.set(candidate.x, CHASER_RADIUS, candidate.z);
  scene.add(mesh);
  return {
    state: createChaserState({ x: candidate.x, z: candidate.z }),
    vitality: createChaserVitality({ maxHealth: CHASER_MAX_HEALTH }),
    mesh,
  };
});

// Arena renderables and player are always active; chasers remain preallocated
// but defeated slots leave the active render count and simulation.
const baselineStaticEntityCount = sparkArena.group.children.length + playerVisual.children.length;

type ShardSlot = {
  state: AimedShardCastState | null;
  readonly mesh: THREE.Mesh;
};

type ActiveImpact = {
  readonly effect: CrystalImpact;
  expiresAtStep: number;
};

const shardGeometry = new THREE.SphereGeometry(SHARD_RADIUS, 6, 4);
const shardMaterial = new THREE.MeshBasicMaterial({ color: '#fff0a6' });
const shardSlots: ShardSlot[] = Array.from({ length: SHARD_POOL_CAPACITY }, (_, index) => {
  const mesh = new THREE.Mesh(shardGeometry, shardMaterial);
  mesh.name = `spark-shard-${index}`;
  mesh.visible = false;
  scene.add(mesh);
  return { state: null, mesh };
});
const crystalImpactPool = createCrystalImpactPool(CRYSTAL_IMPACT_POOL_CAPACITY);
const activeImpacts: ActiveImpact[] = [];

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
  readonly combat: {
    readonly castsLaunched: number;
    readonly impactsEmitted: number;
    readonly activeProjectiles: number;
    readonly activeImpacts: number;
    readonly impactPoolCapacity: number;
    readonly lastImpactCause: string;
  };
  readonly enemy: {
    readonly activeChasers: number;
    readonly chaserCap: number;
    readonly spawnFingerprint: string;
    readonly strikeEvents: number;
    readonly hitEvents: number;
    readonly defeatEvents: number;
    readonly chaserClamps: number;
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
  activeEntities: baselineStaticEntityCount + chaserSlots.length,
  sceneResetCount: 0,
};

const playerIntent: WritablePlayerIntent = {
  movement: { x: 0, z: 0 },
  aim: { x: 0, z: 0 },
  dashRequested: false,
};
const clampedPlayerPosition = { x: sparkArena.metadata.playerSpawn.x, z: sparkArena.metadata.playerSpawn.z };
const clampedChaserPosition = { x: 0, z: 0 };

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
let castsLaunched = 0;
let impactsEmitted = 0;
let lastImpactCause = 'none';
let shardLaunchCooldownSeconds = 0;
let strikeEvents = 0;
let chaserClamps = 0;
let chaserHitEvents = 0;
let chaserDefeatEvents = 0;
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
  shardLaunchCooldownSeconds = Math.max(0, shardLaunchCooldownSeconds - FIXED_STEP_SECONDS);
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
  stepChasers();
  stepCombat();
  totalFixedSteps += 1;
}

function stepChasers(): void {
  for (const slot of chaserSlots) {
    if (slot.vitality.defeated) continue;
    const stepped = stepChaserState(
      slot.state,
      { targetPosition: playerState.position },
      CHASER_STEP_CONFIG,
      FIXED_STEP_SECONDS,
    );
    const clamped = clampSparkArenaCircleToBounds(
      sparkArena.metadata,
      stepped.state.position,
      CHASER_RADIUS,
      clampedChaserPosition,
    );
    slot.state = clamped
      ? { ...stepped.state, position: { x: clampedChaserPosition.x, z: clampedChaserPosition.z } }
      : stepped.state;
    if (clamped) chaserClamps += 1;
    if (stepped.event) strikeEvents += 1;

    slot.mesh.position.set(slot.state.position.x, CHASER_RADIUS, slot.state.position.z);
    slot.mesh.scale.setScalar(slot.state.phase === 'windup' ? 1.15 : slot.state.phase === 'strike' ? 1.3 : 1);
  }
}

function stepCombat(): void {
  if (Math.hypot(playerIntent.aim.x, playerIntent.aim.z) > 0 && shardLaunchCooldownSeconds <= 0) {
    const slot = shardSlots.find((candidate) => candidate.state === null);
    if (slot) {
      slot.state = createAimedShardCast(
        playerState.position,
        playerIntent.aim,
        { speed: SHARD_SPEED, maxRange: SHARD_MAX_RANGE, maxLifetimeSeconds: SHARD_MAX_LIFETIME_SECONDS },
      );
      slot.mesh.visible = slot.state.active;
      shardLaunchCooldownSeconds = SHARD_LAUNCH_INTERVAL_SECONDS;
      if (slot.state.active) castsLaunched += 1;
    }
  }

  for (const slot of shardSlots) {
    if (!slot.state) continue;
    const stepped = stepAimedShardCast(slot.state, FIXED_STEP_SECONDS, queryArenaCollision);
    slot.state = stepped.state.active ? stepped.state : null;
    slot.mesh.position.set(stepped.state.position.x, PLAYER_RADIUS * 0.8, stepped.state.position.z);
    slot.mesh.visible = stepped.state.active;
    if (stepped.impact) {
      consumeImpact(
        stepped.impact.position.x,
        stepped.impact.position.z,
        stepped.impact.cause,
        stepped.impact.targetId,
      );
    }
  }

  for (let index = activeImpacts.length - 1; index >= 0; index -= 1) {
    if (totalFixedSteps + 1 < activeImpacts[index].expiresAtStep) continue;
    const [expired] = activeImpacts.splice(index, 1);
    crystalImpactPool.release(expired.effect);
  }
}

function consumeImpact(x: number, z: number, cause: string, targetId?: string | number): void {
  impactsEmitted += 1;
  lastImpactCause = cause;
  if (cause === 'collision' && typeof targetId === 'string' && targetId.startsWith('chaser:')) {
    const chaserIndex = Number(targetId.slice('chaser:'.length));
    const slot = Number.isInteger(chaserIndex) ? chaserSlots[chaserIndex] : undefined;
    if (slot && !slot.vitality.defeated) {
      const transition = applyChaserShardHit(slot.vitality, { damage: 1 });
      slot.vitality = transition.state;
      if (transition.event?.type === 'chaser-hit') chaserHitEvents += 1;
      if (transition.event?.type === 'chaser-defeat') {
        chaserDefeatEvents += 1;
        slot.mesh.visible = false;
        slot.mesh.scale.setScalar(1);
      }
    }
  }
  if (activeImpacts.length >= CRYSTAL_IMPACT_POOL_CAPACITY) {
    const oldest = activeImpacts.shift();
    if (oldest) crystalImpactPool.release(oldest.effect);
  }
  const effect = crystalImpactPool.acquire({ seed: `impact:${impactsEmitted}` });
  if (!effect) return;
  effect.activate(x, PLAYER_RADIUS * 0.55, z);
  activeImpacts.push({ effect, expiresAtStep: totalFixedSteps + CRYSTAL_IMPACT_LIFETIME_STEPS });
}

function queryArenaCollision(sweep: ShardCollisionSweep): ShardCollision | null {
  const minX = arenaBounds.minX + SHARD_COLLISION_MARGIN;
  const maxX = arenaBounds.maxX - SHARD_COLLISION_MARGIN;
  const minZ = arenaBounds.minZ + SHARD_COLLISION_MARGIN;
  const maxZ = arenaBounds.maxZ - SHARD_COLLISION_MARGIN;
  let bestFraction = Infinity;

  if (sweep.end.x < minX && sweep.end.x !== sweep.start.x) {
    bestFraction = Math.min(bestFraction, (minX - sweep.start.x) / (sweep.end.x - sweep.start.x));
  } else if (sweep.end.x > maxX && sweep.end.x !== sweep.start.x) {
    bestFraction = Math.min(bestFraction, (maxX - sweep.start.x) / (sweep.end.x - sweep.start.x));
  }
  if (sweep.end.z < minZ && sweep.end.z !== sweep.start.z) {
    bestFraction = Math.min(bestFraction, (minZ - sweep.start.z) / (sweep.end.z - sweep.start.z));
  } else if (sweep.end.z > maxZ && sweep.end.z !== sweep.start.z) {
    bestFraction = Math.min(bestFraction, (maxZ - sweep.start.z) / (sweep.end.z - sweep.start.z));
  }

  let bestTargetId: string | undefined = 'arena-boundary';
  for (let index = 0; index < chaserSlots.length; index += 1) {
    const slot = chaserSlots[index];
    if (slot.vitality.defeated) continue;
    const fraction = segmentCircleFraction(
      sweep.start.x,
      sweep.start.z,
      sweep.end.x,
      sweep.end.z,
      slot.state.position.x,
      slot.state.position.z,
      CHASER_HIT_RADIUS,
    );
    if (fraction !== null && fraction < bestFraction) {
      bestFraction = fraction;
      bestTargetId = `chaser:${index}`;
    }
  }

  return Number.isFinite(bestFraction) && bestFraction >= 0 && bestFraction <= 1
    ? { fraction: bestFraction, targetId: bestTargetId }
    : null;
}

function segmentCircleFraction(
  startX: number,
  startZ: number,
  endX: number,
  endZ: number,
  centerX: number,
  centerZ: number,
  radius: number,
): number | null {
  const deltaX = endX - startX;
  const deltaZ = endZ - startZ;
  const offsetX = startX - centerX;
  const offsetZ = startZ - centerZ;
  const radiusSquared = radius * radius;
  const startDistanceSquared = offsetX * offsetX + offsetZ * offsetZ;
  if (startDistanceSquared <= radiusSquared) return 0;

  const coefficientA = deltaX * deltaX + deltaZ * deltaZ;
  if (coefficientA <= 0) return null;
  const coefficientB = 2 * (offsetX * deltaX + offsetZ * deltaZ);
  const coefficientC = startDistanceSquared - radiusSquared;
  const discriminant = coefficientB * coefficientB - 4 * coefficientA * coefficientC;
  if (discriminant < 0) return null;

  const root = (-coefficientB - Math.sqrt(discriminant)) / (2 * coefficientA);
  return root >= 0 && root <= 1 ? root : null;
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
  renderCounters.activeEntities = baselineStaticEntityCount
    + chaserSlots.reduce((count, slot) => count + (slot.vitality.defeated ? 0 : 1), 0)
    + shardSlots.reduce((count, slot) => count + (slot.state ? 1 : 0), 0)
    + activeImpacts.length;
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
    combat: {
      castsLaunched,
      impactsEmitted,
      activeProjectiles: shardSlots.reduce((count, slot) => count + (slot.state ? 1 : 0), 0),
      activeImpacts: activeImpacts.length,
      impactPoolCapacity: CRYSTAL_IMPACT_POOL_CAPACITY,
      lastImpactCause,
    },
    enemy: {
      activeChasers: chaserSlots.reduce((count, slot) => count + (slot.vitality.defeated ? 0 : 1), 0),
      chaserCap: CHASER_CAPACITY,
      spawnFingerprint: chaserSpawnCandidates.fingerprint,
      strikeEvents,
      hitEvents: chaserHitEvents,
      defeatEvents: chaserDefeatEvents,
      chaserClamps,
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
    `shards ${metrics.combat.activeProjectiles} active / ${metrics.combat.castsLaunched} launched | impacts ${metrics.combat.impactsEmitted} emitted, ${metrics.combat.activeImpacts}/${metrics.combat.impactPoolCapacity} active (${metrics.combat.lastImpactCause})`,
    `chasers ${metrics.enemy.activeChasers}/${metrics.enemy.chaserCap} | hits ${metrics.enemy.hitEvents}, defeats ${metrics.enemy.defeatEvents} | strikes ${metrics.enemy.strikeEvents} | clamps ${metrics.enemy.chaserClamps} | ${metrics.enemy.spawnFingerprint}`,
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
