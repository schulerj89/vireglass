import * as THREE from 'three';

/**
 * Input for Spark's deliberately small, reproducible combat space.
 *
 * `seed` may be persisted with a run. Equal seed values always produce equal
 * layout metadata and an equal fingerprint, independent of call order.
 */
export type SparkArenaLayoutInput = {
  seed: string | number;
};

export type SparkArenaBounds = {
  readonly minX: number;
  readonly maxX: number;
  readonly minZ: number;
  readonly maxZ: number;
};

export type SparkArenaPoint = {
  readonly x: number;
  readonly y: number;
  readonly z: number;
};

export type SparkArenaMetadata = {
  /** Versioned, stable identifier for replay/debug reports. */
  readonly fingerprint: string;
  readonly seed: string;
  readonly bounds: SparkArenaBounds;
  readonly playerSpawn: SparkArenaPoint;
  readonly spawnSafeRadius: number;
};

export type SparkArena = {
  readonly group: THREE.Group;
  readonly metadata: SparkArenaMetadata;
};

const FLOOR_THICKNESS = 0.15;
const BOUNDARY_HEIGHT = 0.65;
const BOUNDARY_THICKNESS = 0.28;

// These resources are intentionally module-owned and shared by every arena.
// A scene integrator must remove an arena group when resetting a run, but must
// not dispose the meshes' geometry/material individually. Call
// disposeSparkArenaResources() only during final renderer/application teardown,
// after every Spark arena has been removed.
const floorGeometry = new THREE.BoxGeometry(1, FLOOR_THICKNESS, 1);
const boundaryGeometry = new THREE.BoxGeometry(1, 1, 1);
const floorMaterial = new THREE.MeshBasicMaterial({ color: 0x17233b });
const boundaryMaterial = new THREE.MeshBasicMaterial({ color: 0x496589 });

/**
 * Produces the primitive Spark arena. It owns only the returned group; its
 * shared render resources remain module-owned for low-allocation reuse.
 */
export function createSparkArena(input: SparkArenaLayoutInput): SparkArena {
  const metadata = createSparkArenaMetadata(input);
  const group = new THREE.Group();
  group.name = `spark-arena:${metadata.fingerprint}`;

  const width = metadata.bounds.maxX - metadata.bounds.minX;
  const depth = metadata.bounds.maxZ - metadata.bounds.minZ;
  const centerX = (metadata.bounds.minX + metadata.bounds.maxX) * 0.5;
  const centerZ = (metadata.bounds.minZ + metadata.bounds.maxZ) * 0.5;

  const floor = new THREE.Mesh(floorGeometry, floorMaterial);
  floor.name = 'spark-arena-floor';
  floor.position.set(centerX, -FLOOR_THICKNESS * 0.5, centerZ);
  floor.scale.set(width, 1, depth);
  group.add(floor);

  group.add(
    createBoundary('spark-arena-boundary-north', centerX, metadata.bounds.minZ, width, BOUNDARY_THICKNESS),
    createBoundary('spark-arena-boundary-south', centerX, metadata.bounds.maxZ, width, BOUNDARY_THICKNESS),
    createBoundary('spark-arena-boundary-west', metadata.bounds.minX, centerZ, BOUNDARY_THICKNESS, depth),
    createBoundary('spark-arena-boundary-east', metadata.bounds.maxX, centerZ, BOUNDARY_THICKNESS, depth),
  );

  return { group, metadata };
}

/** Creates deterministic, renderer-independent layout data for gameplay systems. */
export function createSparkArenaMetadata(input: SparkArenaLayoutInput): SparkArenaMetadata {
  const seed = normalizeSeed(input.seed);
  const state = hashSeed(seed);
  const width = 18 + ((state >>> 1) % 3) * 2;
  const depth = 12 + ((state >>> 4) % 3) * 2;
  const bounds: SparkArenaBounds = Object.freeze({
    minX: -width * 0.5,
    maxX: width * 0.5,
    minZ: -depth * 0.5,
    maxZ: depth * 0.5,
  });
  const playerSpawn: SparkArenaPoint = Object.freeze({ x: 0, y: 0, z: 0 });
  const spawnSafeRadius = 2.25;
  const fingerprintPayload = `spark-arena-v1|${seed}|${width}|${depth}|${spawnSafeRadius}`;

  return Object.freeze({
    fingerprint: `spark-arena-v1-${hashSeed(fingerprintPayload).toString(16).padStart(8, '0')}`,
    seed,
    bounds,
    playerSpawn,
    spawnSafeRadius,
  });
}

/** Final-teardown hook for the module-owned shared GPU resources. */
export function disposeSparkArenaResources(): void {
  floorGeometry.dispose();
  boundaryGeometry.dispose();
  floorMaterial.dispose();
  boundaryMaterial.dispose();
}

function createBoundary(name: string, x: number, z: number, width: number, depth: number): THREE.Mesh {
  const boundary = new THREE.Mesh(boundaryGeometry, boundaryMaterial);
  boundary.name = name;
  boundary.position.set(x, BOUNDARY_HEIGHT * 0.5, z);
  boundary.scale.set(width, BOUNDARY_HEIGHT, depth);
  return boundary;
}

function normalizeSeed(seed: SparkArenaLayoutInput['seed']): string {
  return typeof seed === 'number' ? `n:${Number.isFinite(seed) ? seed : 0}` : `s:${seed}`;
}

/** FNV-1a gives a compact, platform-stable unsigned 32-bit seed hash. */
function hashSeed(value: string): number {
  let hash = 0x811c9dc5;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return hash >>> 0;
}
