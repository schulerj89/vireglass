import * as THREE from 'three';

export const CRYSTAL_CLUSTER_VERSION = 'crystal-cluster-v1';
const SHARD_COUNT = 7;
const PROXY_HALF_EXTENT = 1;
const PROXY_RADIUS = 1.42;
const PROXY_HEIGHT = 1.8;

export type CrystalClusterSeed = string | number;

export type CrystalClusterProxyBounds = Readonly<{
  minX: number;
  maxX: number;
  minY: number;
  maxY: number;
  minZ: number;
  maxZ: number;
  radius: number;
  height: number;
}>;

export type CrystalClusterMetadata = Readonly<{
  fingerprint: string;
  seed: string;
  shardCount: number;
  opaque: true;
  childCount: number;
  drawCalls: number;
  triangles: number;
  sharedGeometryCount: number;
  sharedMaterialCount: number;
}>;

export type CrystalCluster = Readonly<{
  group: THREE.Group;
  metadata: CrystalClusterMetadata;
  proxyBounds: CrystalClusterProxyBounds;
}>;

export type CrystalClusterOptions = Readonly<{
  seed?: CrystalClusterSeed;
}>;

// Module-owned resources are reused by every cluster. A caller removes the
// returned group during reset, but only final application teardown should call
// disposeCrystalClusterResources().
const shardGeometry = new THREE.OctahedronGeometry(0.5, 0);
const shardMaterial = new THREE.MeshBasicMaterial({ color: 0x55d9cf });
const sharedGeometries = Object.freeze([shardGeometry]);
const sharedMaterials = Object.freeze([shardMaterial]);

/**
 * Creates one deterministic crystal cluster using a single shared instanced
 * resource. Seed changes layout and orientation without changing the resource
 * budget or the conservative collision proxy.
 */
export function createCrystalCluster(options: CrystalClusterOptions = {}): CrystalCluster {
  const seed = normalizeSeed(options.seed ?? 0);
  const random = createRandom(seed);
  const group = new THREE.Group();
  group.name = `${CRYSTAL_CLUSTER_VERSION}:${seed}`;
  group.rotation.y = random() * Math.PI * 2;

  const shards = new THREE.InstancedMesh(shardGeometry, shardMaterial, SHARD_COUNT);
  shards.name = 'crystal-cluster-shards';
  shards.count = SHARD_COUNT;
  shards.castShadow = false;
  shards.receiveShadow = false;

  const transform = new THREE.Object3D();
  for (let index = 0; index < SHARD_COUNT; index += 1) {
    const height = 0.9 + random() * 0.7;
    const width = 0.42 + random() * 0.16;
    const offsetX = (random() * 2 - 1) * 0.45;
    const offsetZ = (random() * 2 - 1) * 0.45;
    transform.position.set(offsetX, height * 0.5, offsetZ);
    transform.rotation.set(0, random() * Math.PI * 2, 0);
    transform.scale.set(width, height, width);
    transform.updateMatrix();
    shards.setMatrixAt(index, transform.matrix);
  }
  shards.instanceMatrix.needsUpdate = true;
  group.add(shards);

  const proxyBounds = Object.freeze({
    minX: -PROXY_HALF_EXTENT,
    maxX: PROXY_HALF_EXTENT,
    minY: 0,
    maxY: PROXY_HEIGHT,
    minZ: -PROXY_HALF_EXTENT,
    maxZ: PROXY_HALF_EXTENT,
    radius: PROXY_RADIUS,
    height: PROXY_HEIGHT,
  });
  const metadata = Object.freeze({
    fingerprint: `${CRYSTAL_CLUSTER_VERSION}-${hashSeed(seed).toString(16).padStart(8, '0')}`,
    seed,
    shardCount: SHARD_COUNT,
    opaque: true as const,
    childCount: group.children.length,
    drawCalls: 1,
    triangles: countTriangles(shardGeometry) * SHARD_COUNT,
    sharedGeometryCount: sharedGeometries.length,
    sharedMaterialCount: sharedMaterials.length,
  });

  return { group, metadata, proxyBounds };
}

/** Final-teardown hook for module-owned geometry and material resources. */
export function disposeCrystalClusterResources(): void {
  shardGeometry.dispose();
  shardMaterial.dispose();
}

/** Read-only resource facts for deterministic probes and debug reporting. */
export function getCrystalClusterResourceStats(): Readonly<{
  geometryCount: number;
  materialCount: number;
  trianglesPerCluster: number;
  textures: number;
}> {
  return Object.freeze({
    geometryCount: sharedGeometries.length,
    materialCount: sharedMaterials.length,
    trianglesPerCluster: countTriangles(shardGeometry) * SHARD_COUNT,
    textures: 0,
  });
}

function countTriangles(geometry: THREE.BufferGeometry): number {
  const index = geometry.getIndex();
  return (index ? index.count : geometry.getAttribute('position').count) / 3;
}

function createRandom(seed: string): () => number {
  let state = hashSeed(seed) || 0x6d2b79f5;
  return () => {
    state = Math.imul(state ^ (state >>> 15), state | 1);
    state ^= state + Math.imul(state ^ (state >>> 7), state | 61);
    return ((state ^ (state >>> 14)) >>> 0) / 0x100000000;
  };
}

function normalizeSeed(seed: CrystalClusterSeed): string {
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
