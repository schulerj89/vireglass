import * as THREE from 'three';
import { createSparkArena } from './game/world/sparkArena';
import './styles.css';

const root = document.querySelector<HTMLElement>('#game-root');
const canvas = document.querySelector<HTMLCanvasElement>('#game-canvas');
const rotateGate = document.querySelector<HTMLElement>('#rotate-gate');
const metricsElement = document.querySelector<HTMLElement>('#dev-metrics');

if (!root || !canvas || !rotateGate || !metricsElement) {
  throw new Error('Vireglass shell markup is incomplete.');
}

const gameRoot = root;
const gameMetrics = metricsElement;

const QUALITY = {
  tier: 'default',
  maxDevicePixelRatio: 1.5,
};

const scene = new THREE.Scene();
scene.background = new THREE.Color('#090d18');

const SPARK_ARENA_SEED = 'spark-001';
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
renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, QUALITY.maxDevicePixelRatio));
renderer.outputColorSpace = THREE.SRGBColorSpace;

const ambient = new THREE.HemisphereLight('#b9d4ff', '#19213b', 1.8);
scene.add(ambient);

const crystalMaterial = new THREE.MeshBasicMaterial({ color: '#65e6d2' });
const crystal = new THREE.Mesh(new THREE.OctahedronGeometry(0.7, 0), crystalMaterial);
crystal.position.set(
  sparkArena.metadata.playerSpawn.x,
  sparkArena.metadata.playerSpawn.y + 0.8,
  sparkArena.metadata.playerSpawn.z,
);
scene.add(crystal);

// The integrated scene has the arena's five direct renderables plus its focal crystal.
const activeEntityCount = sparkArena.group.children.length + 1;

type Metrics = {
  sampleMs: number;
  frameTimeMs: { median: number; p95: number; min: number; max: number };
  viewport: { width: number; height: number; effectiveDpr: number };
  renderer: { calls: number; triangles: number; points: number; lines: number; geometries: number; textures: number };
  qualityTier: string;
  activeEntities: number;
  sceneResetCount: number;
  arena: {
    requestedSeed: string;
    normalizedSeed: string;
    fingerprint: string;
  };
};

const frameTimes: number[] = [];
let lastFrame = performance.now();
let sampleStarted = lastFrame;
let latestMetrics: Metrics;

function viewportSize() {
  const viewport = window.visualViewport;
  return {
    width: Math.max(1, Math.round(viewport?.width ?? window.innerWidth)),
    height: Math.max(1, Math.round(viewport?.height ?? window.innerHeight)),
  };
}

function resize() {
  const { width, height } = viewportSize();
  gameRoot.style.setProperty('--visual-width', `${width}px`);
  gameRoot.style.setProperty('--visual-height', `${height}px`);
  const narrow = width < 640 || width / height < 1.35;
  gameRoot.classList.toggle('is-rotate-required', narrow);
  camera.aspect = width / height;
  camera.updateProjectionMatrix();
  renderer.setSize(width, height, false);
}

function percentile(sorted: number[], fraction: number) {
  return sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * fraction))] ?? 0;
}

function collectMetrics(now: number): Metrics {
  const sorted = [...frameTimes].sort((a, b) => a - b);
  const { width, height } = viewportSize();
  return {
    sampleMs: Math.round(now - sampleStarted),
    frameTimeMs: {
      median: percentile(sorted, 0.5),
      p95: percentile(sorted, 0.95),
      min: sorted[0] ?? 0,
      max: sorted[sorted.length - 1] ?? 0,
    },
    viewport: { width, height, effectiveDpr: renderer.getPixelRatio() },
    renderer: {
      calls: renderer.info.render.calls,
      triangles: renderer.info.render.triangles,
      points: renderer.info.render.points,
      lines: renderer.info.render.lines,
      geometries: renderer.info.memory.geometries,
      textures: renderer.info.memory.textures,
    },
    qualityTier: QUALITY.tier,
    activeEntities: activeEntityCount,
    sceneResetCount: 0,
    arena: {
      requestedSeed: SPARK_ARENA_SEED,
      normalizedSeed: sparkArena.metadata.seed,
      fingerprint: sparkArena.metadata.fingerprint,
    },
  };
}

function drawDevMetrics() {
  if (!import.meta.env.DEV || !latestMetrics) return;
  const m = latestMetrics;
  gameMetrics.textContent = [
    'DEV PREFLIGHT',
    `entities ${m.activeEntities} · resets ${m.sceneResetCount}`,
    `${m.viewport.width}×${m.viewport.height} @ ${m.viewport.effectiveDpr.toFixed(2)}x`,
    `frame median ${m.frameTimeMs.median.toFixed(1)}ms / p95 ${m.frameTimeMs.p95.toFixed(1)}ms`,
    `calls ${m.renderer.calls} · tris ${m.renderer.triangles} · geo ${m.renderer.geometries} · tex ${m.renderer.textures}`,
    `sample ${(m.sampleMs / 1000).toFixed(0)}s · tier ${m.qualityTier}`,
    `arena ${m.arena.requestedSeed} · ${m.arena.fingerprint}`,
  ].join('\n');
}

function frame(now: number) {
  const delta = Math.min(now - lastFrame, 100);
  lastFrame = now;
  frameTimes.push(delta);
  if (frameTimes.length > 600) frameTimes.shift();
  crystal.rotation.y += delta * 0.00025;
  renderer.render(scene, camera);
  latestMetrics = collectMetrics(now);
  drawDevMetrics();
  requestAnimationFrame(frame);
}

// This hook is intentionally dev-only and inspectable without adding a debug UI.
if (import.meta.env.DEV) {
  (window as Window & { __vireglassMetrics?: () => Metrics }).__vireglassMetrics = () => latestMetrics;
}

gameRoot.addEventListener('touchmove', (event) => event.preventDefault(), { passive: false });
gameRoot.addEventListener('gesturestart', (event) => event.preventDefault());
gameRoot.addEventListener('gesturechange', (event) => event.preventDefault());
gameRoot.addEventListener('gestureend', (event) => event.preventDefault());
window.addEventListener('resize', resize, { passive: true });
window.visualViewport?.addEventListener('resize', resize, { passive: true });
window.visualViewport?.addEventListener('scroll', resize, { passive: true });

resize();
requestAnimationFrame(frame);
