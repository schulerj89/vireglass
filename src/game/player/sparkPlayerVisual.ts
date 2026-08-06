import * as THREE from 'three';

/** Stable identity for the code-first Spark player visual. */
export const SPARK_PLAYER_VISUAL_VERSION = 'spark-player-visual-v1';

export type SparkPlayerVisualSeed = string | number;

export type SparkPlayerVisualProxyBounds = Readonly<{
  minX: number;
  maxX: number;
  minY: number;
  maxY: number;
  minZ: number;
  maxZ: number;
  radius: number;
  height: number;
}>;

export type SparkPlayerVisualMetadata = Readonly<{
  fingerprint: string;
  seed: string;
  opaque: true;
  childCount: number;
  drawCalls: number;
  triangles: number;
  sharedGeometryCount: number;
  sharedMaterialCount: number;
}>;

export type SparkPlayerVisual = Readonly<{
  group: THREE.Group;
  metadata: SparkPlayerVisualMetadata;
  proxyBounds: SparkPlayerVisualProxyBounds;
}>;

export type SparkPlayerVisualOptions = Readonly<{
  seed?: SparkPlayerVisualSeed;
}>;

const BODY_RADIUS = 0.48;
const BODY_HEIGHT = 0.72;
const TOTAL_HEIGHT = 1.5;
// The fins are rotated by the seeded group yaw. The measured seed 0..63
// envelope is ±0.884834 on each horizontal axis and 1.25 corner-radius;
// retain a small margin so the proxy remains stable if a primitive boundary
// is evaluated with a different floating-point rounding path.
const PROXY_HALF_EXTENT = 0.9;
const PROXY_RADIUS = 1.28;

// These resources are module-owned and shared by every acquired player visual.
// Factories only create Groups and Meshes; they never create GPU resources per
// acquire. Dispose them once, during final application teardown, after all
// Spark player groups have been removed from the scene.
const bodyGeometry = new THREE.CylinderGeometry(0.9, 1, 1, 8);
const capGeometry = new THREE.CylinderGeometry(0.82, 0.9, 1, 8);
const finGeometry = new THREE.ConeGeometry(1, 1, 4);
const noseGeometry = new THREE.BoxGeometry(1, 1, 1);
const coreGeometry = new THREE.CylinderGeometry(0.55, 0.55, 1, 8);

const bodyMaterial = new THREE.MeshBasicMaterial({ color: 0x5c7da8 });
const capMaterial = new THREE.MeshBasicMaterial({ color: 0x9db9d8 });
const finMaterial = new THREE.MeshBasicMaterial({ color: 0x35557f });
const noseMaterial = new THREE.MeshBasicMaterial({ color: 0xd7ecff });
const coreMaterial = new THREE.MeshBasicMaterial({ color: 0xf4b84a });

const sharedGeometries = Object.freeze([
  bodyGeometry,
  capGeometry,
  finGeometry,
  noseGeometry,
  coreGeometry,
]);
const sharedMaterials = Object.freeze([
  bodyMaterial,
  capMaterial,
  finMaterial,
  noseMaterial,
  coreMaterial,
]);

/**
 * Builds a deterministic, opaque, high-angle-readable player silhouette.
 *
 * The returned Group owns its object graph, while geometry and materials are
 * intentionally shared across every factory call. The proxy is metadata only:
 * gameplay collision should use it rather than traversing render meshes.
 */
export function createSparkPlayerVisual(options: SparkPlayerVisualOptions = {}): SparkPlayerVisual {
  const seed = normalizeSeed(options.seed ?? 0);
  const yaw = ((hashSeed(seed) % 8) * Math.PI) / 16;
  const group = new THREE.Group();
  group.name = `${SPARK_PLAYER_VISUAL_VERSION}:${seed}`;
  group.rotation.y = yaw;

  const body = new THREE.Mesh(bodyGeometry, bodyMaterial);
  body.name = 'spark-player-body';
  body.scale.set(BODY_RADIUS, BODY_HEIGHT, BODY_RADIUS);
  body.position.y = 0.45;

  const cap = new THREE.Mesh(capGeometry, capMaterial);
  cap.name = 'spark-player-cap';
  cap.scale.set(0.43, 0.16, 0.43);
  cap.position.y = 0.86;

  const core = new THREE.Mesh(coreGeometry, coreMaterial);
  core.name = 'spark-player-core';
  core.scale.set(0.2, 0.08, 0.2);
  core.position.set(0, 0.98, -0.02);

  const nose = new THREE.Mesh(noseGeometry, noseMaterial);
  nose.name = 'spark-player-forward-mark';
  nose.scale.set(0.16, 0.12, 0.3);
  nose.position.set(0, 0.64, -0.43);

  const leftFin = createFin('spark-player-fin-left', -1);
  const rightFin = createFin('spark-player-fin-right', 1);

  group.add(body, cap, core, nose, leftFin, rightFin);

  const proxyBounds = Object.freeze({
    minX: -PROXY_HALF_EXTENT,
    maxX: PROXY_HALF_EXTENT,
    minY: 0,
    maxY: TOTAL_HEIGHT,
    minZ: -PROXY_HALF_EXTENT,
    maxZ: PROXY_HALF_EXTENT,
    radius: PROXY_RADIUS,
    height: TOTAL_HEIGHT,
  });
  const metadata = Object.freeze({
    fingerprint: `${SPARK_PLAYER_VISUAL_VERSION}-${hashSeed(seed).toString(16).padStart(8, '0')}`,
    seed,
    opaque: true as const,
    childCount: group.children.length,
    drawCalls: group.children.length,
    triangles: countTriangles(sharedGeometries),
    sharedGeometryCount: sharedGeometries.length,
    sharedMaterialCount: sharedMaterials.length,
  });

  return { group, metadata, proxyBounds };
}

/** Final-teardown hook for the module-owned shared render resources. */
export function disposeSparkPlayerVisualResources(): void {
  for (const geometry of sharedGeometries) geometry.dispose();
  for (const material of sharedMaterials) material.dispose();
}

/** Read-only budget facts for deterministic probes and debug reporting. */
export function getSparkPlayerVisualResourceStats(): Readonly<{
  geometryCount: number;
  materialCount: number;
  triangles: number;
  textures: number;
}> {
  return Object.freeze({
    geometryCount: sharedGeometries.length,
    materialCount: sharedMaterials.length,
    triangles: countTriangles(sharedGeometries),
    textures: 0,
  });
}

function createFin(name: string, side: -1 | 1): THREE.Mesh {
  const fin = new THREE.Mesh(finGeometry, finMaterial);
  fin.name = name;
  fin.scale.set(0.28, 0.42, 0.5);
  fin.position.set(side * 0.48, 0.31, 0.06);
  fin.rotation.z = side * Math.PI * 0.5;
  return fin;
}

function countTriangles(geometries: readonly THREE.BufferGeometry[]): number {
  return geometries.reduce((total, geometry) => {
    const index = geometry.getIndex();
    return total + (index ? index.count : geometry.getAttribute('position').count) / 3;
  }, 0);
}

function normalizeSeed(seed: SparkPlayerVisualSeed): string {
  return typeof seed === 'number' ? `n:${Number.isFinite(seed) ? seed : 0}` : `s:${seed}`;
}

/** FNV-1a provides a small, platform-stable deterministic seed hash. */
function hashSeed(value: string): number {
  let hash = 0x811c9dc5;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return hash >>> 0;
}
