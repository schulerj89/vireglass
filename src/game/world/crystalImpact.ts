import * as THREE from 'three';

/** Seed input for a reproducible short shard-impact pose. */
export type CrystalImpactInput = {
  seed: string | number;
};

export type CrystalImpactMetadata = {
  /** Versioned identifier suitable for deterministic replay/debug records. */
  readonly fingerprint: string;
  readonly seed: string;
  readonly shardCount: number;
  /** The intended opaque on-screen lifetime before the integrator hides it. */
  readonly lifetimeMs: number;
};

export type CrystalImpact = {
  readonly group: THREE.Group;
  readonly metadata: CrystalImpactMetadata;
  /** Reconfigures a pooled instance without creating render resources. */
  reset(input: CrystalImpactInput): void;
  /** Places and displays the prebuilt impact group. */
  activate(x: number, y: number, z: number): void;
  /** Hides the group so its owner may return it to a pool. */
  deactivate(): void;
};

export type CrystalImpactPool = {
  readonly capacity: number;
  readonly activeCount: number;
  /** Returns null when all preallocated impact groups are in use. */
  acquire(input: CrystalImpactInput): CrystalImpact | null;
  /** Returns false when the impact is not currently owned by this pool. */
  release(impact: CrystalImpact): boolean;
};

const SHARD_COUNT = 6;
const IMPACT_LIFETIME_MS = 180;

// Module-owned resources shared by every factory result and pool slot. Keep
// them alive while any impact can be rendered; dispose only at final app or
// renderer teardown through disposeCrystalImpactResources().
const shardGeometry = new THREE.ConeGeometry(0.11, 0.54, 4, 1);
const coreGeometry = new THREE.OctahedronGeometry(0.18, 0);
const shardMaterial = new THREE.MeshBasicMaterial({ color: 0x76d9ff });
const coreMaterial = new THREE.MeshBasicMaterial({ color: 0xd1f7ff });

/**
 * Creates one ready-to-place, opaque shard impact. The group contains one core
 * and six shards with deterministic transforms for the supplied seed.
 */
export function createCrystalImpact(input: CrystalImpactInput): CrystalImpact {
  return new CrystalImpactInstance(input);
}

/**
 * Preallocates a fixed number of reusable impacts. After construction,
 * acquire/release never create a Group, Mesh, geometry, or material.
 */
export function createCrystalImpactPool(capacity: number): CrystalImpactPool {
  if (!Number.isSafeInteger(capacity) || capacity < 1) {
    throw new RangeError('Crystal impact pool capacity must be a positive safe integer.');
  }

  return new CrystalImpactPoolInstance(capacity);
}

/** Final-teardown hook for the module-owned shared GPU resources. */
export function disposeCrystalImpactResources(): void {
  shardGeometry.dispose();
  coreGeometry.dispose();
  shardMaterial.dispose();
  coreMaterial.dispose();
}

class CrystalImpactInstance implements CrystalImpact {
  readonly group = new THREE.Group();
  readonly #shards: THREE.Mesh[];
  readonly #core: THREE.Mesh;
  #metadata: CrystalImpactMetadata;

  constructor(input: CrystalImpactInput) {
    this.group.name = 'crystal-impact';
    this.#core = createOpaqueMesh(coreGeometry, coreMaterial, 'crystal-impact-core');
    this.group.add(this.#core);
    this.#shards = Array.from({ length: SHARD_COUNT }, (_, index) => {
      const shard = createOpaqueMesh(shardGeometry, shardMaterial, `crystal-impact-shard-${index}`);
      this.group.add(shard);
      return shard;
    });
    this.#metadata = createMetadata(input);
    this.applyMetadata();
  }

  get metadata(): CrystalImpactMetadata {
    return this.#metadata;
  }

  reset(input: CrystalImpactInput): void {
    this.#metadata = createMetadata(input);
    this.group.position.set(0, 0, 0);
    this.group.visible = true;
    this.applyMetadata();
  }

  activate(x: number, y: number, z: number): void {
    this.group.position.set(x, y, z);
    this.group.visible = true;
  }

  deactivate(): void {
    this.group.visible = false;
  }

  private applyMetadata(): void {
    const random = createDeterministicRandom(hashSeed(this.#metadata.seed));
    this.#core.rotation.set(0, random() * Math.PI * 2, 0);
    this.#core.scale.setScalar(0.85 + random() * 0.3);

    for (let index = 0; index < this.#shards.length; index += 1) {
      const shard = this.#shards[index];
      const angle = (index / SHARD_COUNT) * Math.PI * 2 + (random() - 0.5) * 0.34;
      const distance = 0.2 + random() * 0.27;
      const height = 0.1 + random() * 0.16;
      const length = 0.68 + random() * 0.48;

      shard.position.set(Math.cos(angle) * distance, height, Math.sin(angle) * distance);
      shard.rotation.set((random() - 0.5) * 0.4, angle, (random() - 0.5) * 0.32);
      shard.scale.set(0.7 + random() * 0.35, length, 0.7 + random() * 0.35);
    }
  }
}

class CrystalImpactPoolInstance implements CrystalImpactPool {
  readonly capacity: number;
  readonly #available: CrystalImpactInstance[];
  readonly #active = new Set<CrystalImpactInstance>();

  constructor(capacity: number) {
    this.capacity = capacity;
    this.#available = Array.from({ length: capacity }, (_, index) => {
      const impact = new CrystalImpactInstance({ seed: `pool-slot:${index}` });
      impact.deactivate();
      return impact;
    });
  }

  get activeCount(): number {
    return this.#active.size;
  }

  acquire(input: CrystalImpactInput): CrystalImpact | null {
    const impact = this.#available.pop();
    if (!impact) return null;

    impact.reset(input);
    this.#active.add(impact);
    return impact;
  }

  release(impact: CrystalImpact): boolean {
    if (!(impact instanceof CrystalImpactInstance) || !this.#active.delete(impact)) return false;

    impact.deactivate();
    this.#available.push(impact);
    return true;
  }
}

function createOpaqueMesh(geometry: THREE.BufferGeometry, material: THREE.Material, name: string): THREE.Mesh {
  const mesh = new THREE.Mesh(geometry, material);
  mesh.name = name;
  mesh.castShadow = false;
  mesh.receiveShadow = false;
  return mesh;
}

function createMetadata(input: CrystalImpactInput): CrystalImpactMetadata {
  const seed = normalizeSeed(input.seed);
  return Object.freeze({
    fingerprint: `crystal-impact-v1-${hashSeed(`crystal-impact-v1|${seed}`).toString(16).padStart(8, '0')}`,
    seed,
    shardCount: SHARD_COUNT,
    lifetimeMs: IMPACT_LIFETIME_MS,
  });
}

function normalizeSeed(seed: CrystalImpactInput['seed']): string {
  return typeof seed === 'number' ? `n:${Number.isFinite(seed) ? seed : 0}` : `s:${seed}`;
}

function createDeterministicRandom(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let result = state;
    result = Math.imul(result ^ (result >>> 15), result | 1);
    result ^= result + Math.imul(result ^ (result >>> 7), result | 61);
    return ((result ^ (result >>> 14)) >>> 0) / 0x1_0000_0000;
  };
}

function hashSeed(value: string): number {
  let hash = 0x811c9dc5;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return hash >>> 0;
}
