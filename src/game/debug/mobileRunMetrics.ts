/**
 * Fixed-capacity recorder for the values required by Vireglass's mobile
 * performance contract. It records supplied measurements only; it does not
 * certify a device, a frame-rate target, or a reset/leak result.
 *
 * Callers should create one mutable counters object outside their render loop,
 * update it from renderer.info/object state, and pass that same object to
 * recordFrame(). The hot record paths write only scalar fields and typed-array
 * slots, so they create no arrays or objects per frame.
 */

export const MOBILE_SLOW_FRAME_THRESHOLD_MS = 33.3;

const DEFAULT_FRAME_CAPACITY = 1200;
const DEFAULT_RESET_CAPACITY = 16;
const MAX_FRAME_CAPACITY = 4096;
const MAX_RESET_CAPACITY = 128;

export interface MobileRunViewport {
  readonly width: number;
  readonly height: number;
  readonly effectiveDpr: number;
}

/** Device fields are caller-observed metadata; this module never infers them. */
export interface MobileObservedDevice {
  readonly model?: string;
  readonly operatingSystem?: string;
  readonly safariVersion?: string;
}

export interface MobileRunMetadata {
  readonly runId: string;
  readonly buildRevision: string;
  readonly scenario: string;
  readonly scenarioSeed: string;
  readonly startedAtMs: number;
  readonly qualityTier: string;
  readonly viewport: MobileRunViewport;
  readonly observedDevice?: MobileObservedDevice;
}

/**
 * A reusable input shape for renderer.info and application-owned object counts.
 * sceneResetCount is recorded, but deliberately excluded from equality checks:
 * a real reset count should advance while resource/object counts remain stable.
 */
export interface MobileRenderObjectCounters {
  readonly calls: number;
  readonly triangles: number;
  readonly points: number;
  readonly lines: number;
  readonly geometries: number;
  readonly textures: number;
  readonly activeEntities: number;
  readonly sceneResetCount: number;
}

export interface MobileRunMetricsConfig {
  readonly frameCapacity?: number;
  readonly resetCapacity?: number;
  readonly slowFrameThresholdMs?: number;
}

export interface MobileFrameTimeSummary {
  readonly retainedSamples: number;
  readonly totalSamples: number;
  readonly medianMs: number;
  readonly p95Ms: number;
  readonly minMs: number;
  readonly maxMs: number;
  readonly slowFrameThresholdMs: number;
  readonly consecutiveSlowFrames: number;
  readonly longestSlowFrameStreak: number;
}

export interface MobileResetObservationSnapshot {
  readonly elapsedMs: number;
  readonly counters: MobileRenderObjectCounters;
  readonly stableAgainstBaseline: boolean;
}

export type MobileResetStabilityStatus = 'insufficient' | 'stable' | 'unstable';

export interface MobileResetStabilitySummary {
  readonly status: MobileResetStabilityStatus;
  readonly totalObservations: number;
  readonly retainedObservations: ReadonlyArray<MobileResetObservationSnapshot>;
  readonly baseline?: MobileRenderObjectCounters;
}

export interface MobileRunMetricsSnapshot {
  readonly metadata: MobileRunMetadata;
  readonly qualityTier: string;
  readonly frameTimes: MobileFrameTimeSummary;
  readonly latestCounters: MobileRenderObjectCounters;
  readonly resetStability: MobileResetStabilitySummary;
}

/**
 * Captures a fixed rolling window. snapshot() and toJSON() allocate a
 * serializable report on demand; recordFrame() and recordReset() do not.
 */
export class MobileRunMetricsRecorder {
  private readonly metadata: MobileRunMetadata;
  private readonly frameTimes: Float64Array;
  private readonly sortedFrameTimes: Float64Array;
  private readonly resetElapsedMs: Float64Array;
  private readonly resetCalls: Float64Array;
  private readonly resetTriangles: Float64Array;
  private readonly resetPoints: Float64Array;
  private readonly resetLines: Float64Array;
  private readonly resetGeometries: Float64Array;
  private readonly resetTextures: Float64Array;
  private readonly resetActiveEntities: Float64Array;
  private readonly resetSceneResetCounts: Float64Array;
  private readonly slowFrameThresholdMs: number;

  private frameWriteIndex = 0;
  private retainedFrameCount = 0;
  private totalFrameCount = 0;
  private consecutiveSlowFrames = 0;
  private longestSlowFrameStreak = 0;

  private resetWriteIndex = 0;
  private retainedResetCount = 0;
  private totalResetCount = 0;
  private hasResetBaseline = false;
  private resetMismatchObserved = false;

  private latestCalls = 0;
  private latestTriangles = 0;
  private latestPoints = 0;
  private latestLines = 0;
  private latestGeometries = 0;
  private latestTextures = 0;
  private latestActiveEntities = 0;
  private latestSceneResetCount = 0;

  private baselineCalls = 0;
  private baselineTriangles = 0;
  private baselinePoints = 0;
  private baselineLines = 0;
  private baselineGeometries = 0;
  private baselineTextures = 0;
  private baselineActiveEntities = 0;
  private baselineSceneResetCount = 0;

  public constructor(metadata: MobileRunMetadata, config: MobileRunMetricsConfig = {}) {
    this.metadata = copyRunMetadata(metadata);
    const frameCapacity = boundedCapacity(config.frameCapacity, DEFAULT_FRAME_CAPACITY, MAX_FRAME_CAPACITY);
    const resetCapacity = boundedCapacity(config.resetCapacity, DEFAULT_RESET_CAPACITY, MAX_RESET_CAPACITY);

    this.frameTimes = new Float64Array(frameCapacity);
    this.sortedFrameTimes = new Float64Array(frameCapacity);
    this.resetElapsedMs = new Float64Array(resetCapacity);
    this.resetCalls = new Float64Array(resetCapacity);
    this.resetTriangles = new Float64Array(resetCapacity);
    this.resetPoints = new Float64Array(resetCapacity);
    this.resetLines = new Float64Array(resetCapacity);
    this.resetGeometries = new Float64Array(resetCapacity);
    this.resetTextures = new Float64Array(resetCapacity);
    this.resetActiveEntities = new Float64Array(resetCapacity);
    this.resetSceneResetCounts = new Float64Array(resetCapacity);
    this.slowFrameThresholdMs = positiveFiniteOrDefault(
      config.slowFrameThresholdMs,
      MOBILE_SLOW_FRAME_THRESHOLD_MS,
    );
  }

  /** Records one frame and the latest reusable renderer/object-counter input. */
  public recordFrame(frameTimeMs: number, counters: MobileRenderObjectCounters): void {
    const safeFrameTime = nonNegativeFiniteOrZero(frameTimeMs);
    this.frameTimes[this.frameWriteIndex] = safeFrameTime;
    this.frameWriteIndex = (this.frameWriteIndex + 1) % this.frameTimes.length;
    this.retainedFrameCount = Math.min(this.retainedFrameCount + 1, this.frameTimes.length);
    this.totalFrameCount += 1;

    if (safeFrameTime > this.slowFrameThresholdMs) {
      this.consecutiveSlowFrames += 1;
      this.longestSlowFrameStreak = Math.max(this.longestSlowFrameStreak, this.consecutiveSlowFrames);
    } else {
      this.consecutiveSlowFrames = 0;
    }

    this.copyLatestCounters(counters);
  }

  /**
   * Records counters observed after an actual reset/restart. The first
   * observation becomes the baseline. Later observations compare renderer and
   * active-entity counts to it; sceneResetCount is retained but not compared.
   */
  public recordReset(elapsedMs: number, counters: MobileRenderObjectCounters): void {
    this.copyLatestCounters(counters);

    const index = this.resetWriteIndex;
    this.resetElapsedMs[index] = nonNegativeFiniteOrZero(elapsedMs);
    this.resetCalls[index] = this.latestCalls;
    this.resetTriangles[index] = this.latestTriangles;
    this.resetPoints[index] = this.latestPoints;
    this.resetLines[index] = this.latestLines;
    this.resetGeometries[index] = this.latestGeometries;
    this.resetTextures[index] = this.latestTextures;
    this.resetActiveEntities[index] = this.latestActiveEntities;
    this.resetSceneResetCounts[index] = this.latestSceneResetCount;

    this.resetWriteIndex = (this.resetWriteIndex + 1) % this.resetElapsedMs.length;
    this.retainedResetCount = Math.min(this.retainedResetCount + 1, this.resetElapsedMs.length);
    this.totalResetCount += 1;

    if (!this.hasResetBaseline) {
      this.copyResetBaseline();
      this.hasResetBaseline = true;
    } else if (!this.latestCountersMatchBaseline()) {
      this.resetMismatchObserved = true;
    }
  }

  /** Builds a serializable report. This is intentionally outside the hot path. */
  public snapshot(): MobileRunMetricsSnapshot {
    return {
      metadata: this.metadata,
      qualityTier: this.metadata.qualityTier,
      frameTimes: this.frameTimeSummary(),
      latestCounters: this.latestCountersSnapshot(),
      resetStability: this.resetStabilitySummary(),
    };
  }

  public toJSON(): MobileRunMetricsSnapshot {
    return this.snapshot();
  }

  private copyLatestCounters(counters: MobileRenderObjectCounters): void {
    this.latestCalls = nonNegativeFiniteOrZero(counters.calls);
    this.latestTriangles = nonNegativeFiniteOrZero(counters.triangles);
    this.latestPoints = nonNegativeFiniteOrZero(counters.points);
    this.latestLines = nonNegativeFiniteOrZero(counters.lines);
    this.latestGeometries = nonNegativeFiniteOrZero(counters.geometries);
    this.latestTextures = nonNegativeFiniteOrZero(counters.textures);
    this.latestActiveEntities = nonNegativeFiniteOrZero(counters.activeEntities);
    this.latestSceneResetCount = nonNegativeFiniteOrZero(counters.sceneResetCount);
  }

  private copyResetBaseline(): void {
    this.baselineCalls = this.latestCalls;
    this.baselineTriangles = this.latestTriangles;
    this.baselinePoints = this.latestPoints;
    this.baselineLines = this.latestLines;
    this.baselineGeometries = this.latestGeometries;
    this.baselineTextures = this.latestTextures;
    this.baselineActiveEntities = this.latestActiveEntities;
    this.baselineSceneResetCount = this.latestSceneResetCount;
  }

  private latestCountersMatchBaseline(): boolean {
    return this.latestCalls === this.baselineCalls
      && this.latestTriangles === this.baselineTriangles
      && this.latestPoints === this.baselinePoints
      && this.latestLines === this.baselineLines
      && this.latestGeometries === this.baselineGeometries
      && this.latestTextures === this.baselineTextures
      && this.latestActiveEntities === this.baselineActiveEntities;
  }

  private frameTimeSummary(): MobileFrameTimeSummary {
    const count = this.retainedFrameCount;
    if (count === 0) {
      return {
        retainedSamples: 0,
        totalSamples: 0,
        medianMs: 0,
        p95Ms: 0,
        minMs: 0,
        maxMs: 0,
        slowFrameThresholdMs: this.slowFrameThresholdMs,
        consecutiveSlowFrames: this.consecutiveSlowFrames,
        longestSlowFrameStreak: this.longestSlowFrameStreak,
      };
    }

    const start = this.totalFrameCount > this.frameTimes.length ? this.frameWriteIndex : 0;
    for (let sampleIndex = 0; sampleIndex < count; sampleIndex += 1) {
      this.sortedFrameTimes[sampleIndex] = this.frameTimes[(start + sampleIndex) % this.frameTimes.length];
    }

    const sorted = this.sortedFrameTimes.subarray(0, count);
    sorted.sort();
    const middle = Math.floor(count / 2);
    const medianMs = count % 2 === 0
      ? (sorted[middle - 1] + sorted[middle]) * 0.5
      : sorted[middle];
    const p95Index = Math.max(0, Math.ceil(count * 0.95) - 1);

    return {
      retainedSamples: count,
      totalSamples: this.totalFrameCount,
      medianMs,
      p95Ms: sorted[p95Index],
      minMs: sorted[0],
      maxMs: sorted[count - 1],
      slowFrameThresholdMs: this.slowFrameThresholdMs,
      consecutiveSlowFrames: this.consecutiveSlowFrames,
      longestSlowFrameStreak: this.longestSlowFrameStreak,
    };
  }

  private latestCountersSnapshot(): MobileRenderObjectCounters {
    return {
      calls: this.latestCalls,
      triangles: this.latestTriangles,
      points: this.latestPoints,
      lines: this.latestLines,
      geometries: this.latestGeometries,
      textures: this.latestTextures,
      activeEntities: this.latestActiveEntities,
      sceneResetCount: this.latestSceneResetCount,
    };
  }

  private baselineCountersSnapshot(): MobileRenderObjectCounters {
    return {
      calls: this.baselineCalls,
      triangles: this.baselineTriangles,
      points: this.baselinePoints,
      lines: this.baselineLines,
      geometries: this.baselineGeometries,
      textures: this.baselineTextures,
      activeEntities: this.baselineActiveEntities,
      sceneResetCount: this.baselineSceneResetCount,
    };
  }

  private resetStabilitySummary(): MobileResetStabilitySummary {
    const observations: MobileResetObservationSnapshot[] = [];
    const start = this.totalResetCount > this.resetElapsedMs.length ? this.resetWriteIndex : 0;

    for (let observationIndex = 0; observationIndex < this.retainedResetCount; observationIndex += 1) {
      const index = (start + observationIndex) % this.resetElapsedMs.length;
      const counters = {
        calls: this.resetCalls[index],
        triangles: this.resetTriangles[index],
        points: this.resetPoints[index],
        lines: this.resetLines[index],
        geometries: this.resetGeometries[index],
        textures: this.resetTextures[index],
        activeEntities: this.resetActiveEntities[index],
        sceneResetCount: this.resetSceneResetCounts[index],
      };
      observations.push({
        elapsedMs: this.resetElapsedMs[index],
        counters,
        stableAgainstBaseline: this.countersMatchBaseline(counters),
      });
    }

    return {
      status: this.totalResetCount < 2
        ? 'insufficient'
        : this.resetMismatchObserved
          ? 'unstable'
          : 'stable',
      totalObservations: this.totalResetCount,
      retainedObservations: observations,
      baseline: this.hasResetBaseline ? this.baselineCountersSnapshot() : undefined,
    };
  }

  private countersMatchBaseline(counters: MobileRenderObjectCounters): boolean {
    return counters.calls === this.baselineCalls
      && counters.triangles === this.baselineTriangles
      && counters.points === this.baselinePoints
      && counters.lines === this.baselineLines
      && counters.geometries === this.baselineGeometries
      && counters.textures === this.baselineTextures
      && counters.activeEntities === this.baselineActiveEntities;
  }
}

export interface MobileRunMetricsProbeResult {
  readonly thresholdPassCase: boolean;
  readonly thresholdFailCase: boolean;
  readonly resetStableCase: boolean;
  readonly resetUnstableCase: boolean;
  readonly fixedCapacityCase: boolean;
  readonly passed: boolean;
}

/**
 * Deterministic injected-sample probe for build/CI smoke use. It tests the
 * recorder mechanics only and is not a mobile-performance verdict.
 */
export function runMobileRunMetricsDeterministicProbe(): MobileRunMetricsProbeResult {
  const stableCounters: MobileRenderObjectCounters = {
    calls: 6,
    triangles: 68,
    points: 0,
    lines: 0,
    geometries: 3,
    textures: 0,
    activeEntities: 6,
    sceneResetCount: 0,
  };

  const metadata: MobileRunMetadata = {
    runId: 'mobile-run-metrics-probe',
    buildRevision: 'probe',
    scenario: 'injected samples',
    scenarioSeed: 'probe-seed',
    startedAtMs: 0,
    qualityTier: 'default',
    viewport: { width: 844, height: 390, effectiveDpr: 1.5 },
  };

  const thresholdPassRecorder = new MobileRunMetricsRecorder(metadata, { frameCapacity: 4, resetCapacity: 2 });
  thresholdPassRecorder.recordFrame(16, stableCounters);
  thresholdPassRecorder.recordFrame(MOBILE_SLOW_FRAME_THRESHOLD_MS, stableCounters);
  thresholdPassRecorder.recordFrame(16.7, stableCounters);
  const thresholdPassCase = thresholdPassRecorder.snapshot().frameTimes.longestSlowFrameStreak === 0;

  const thresholdFailRecorder = new MobileRunMetricsRecorder(metadata, { frameCapacity: 5, resetCapacity: 2 });
  thresholdFailRecorder.recordFrame(16, stableCounters);
  thresholdFailRecorder.recordFrame(34, stableCounters);
  thresholdFailRecorder.recordFrame(35, stableCounters);
  thresholdFailRecorder.recordFrame(36, stableCounters);
  thresholdFailRecorder.recordFrame(16, stableCounters);
  const thresholdFailSummary = thresholdFailRecorder.snapshot().frameTimes;
  const thresholdFailCase = thresholdFailSummary.longestSlowFrameStreak === 3
    && thresholdFailSummary.consecutiveSlowFrames === 0;

  const stableResetRecorder = new MobileRunMetricsRecorder(metadata, { resetCapacity: 2 });
  stableResetRecorder.recordReset(1000, stableCounters);
  stableResetRecorder.recordReset(2000, { ...stableCounters, sceneResetCount: 1 });
  const resetStableCase = stableResetRecorder.snapshot().resetStability.status === 'stable';

  const unstableResetRecorder = new MobileRunMetricsRecorder(metadata, { resetCapacity: 2 });
  unstableResetRecorder.recordReset(1000, stableCounters);
  unstableResetRecorder.recordReset(2000, { ...stableCounters, geometries: 4, sceneResetCount: 1 });
  const resetUnstableCase = unstableResetRecorder.snapshot().resetStability.status === 'unstable';

  const capacityRecorder = new MobileRunMetricsRecorder(metadata, { frameCapacity: 3, resetCapacity: 2 });
  capacityRecorder.recordFrame(10, stableCounters);
  capacityRecorder.recordFrame(20, stableCounters);
  capacityRecorder.recordFrame(30, stableCounters);
  capacityRecorder.recordFrame(40, stableCounters);
  const capacitySummary = capacityRecorder.snapshot().frameTimes;
  const fixedCapacityCase = capacitySummary.retainedSamples === 3
    && capacitySummary.totalSamples === 4
    && capacitySummary.medianMs === 30
    && capacitySummary.p95Ms === 40;

  return {
    thresholdPassCase,
    thresholdFailCase,
    resetStableCase,
    resetUnstableCase,
    fixedCapacityCase,
    passed: thresholdPassCase
      && thresholdFailCase
      && resetStableCase
      && resetUnstableCase
      && fixedCapacityCase,
  };
}

function copyRunMetadata(metadata: MobileRunMetadata): MobileRunMetadata {
  const observedDevice = metadata.observedDevice === undefined
    ? undefined
    : Object.freeze({
      model: metadata.observedDevice.model,
      operatingSystem: metadata.observedDevice.operatingSystem,
      safariVersion: metadata.observedDevice.safariVersion,
    });

  return Object.freeze({
    runId: metadata.runId,
    buildRevision: metadata.buildRevision,
    scenario: metadata.scenario,
    scenarioSeed: metadata.scenarioSeed,
    startedAtMs: nonNegativeFiniteOrZero(metadata.startedAtMs),
    qualityTier: metadata.qualityTier,
    viewport: Object.freeze({
      width: nonNegativeFiniteOrZero(metadata.viewport.width),
      height: nonNegativeFiniteOrZero(metadata.viewport.height),
      effectiveDpr: nonNegativeFiniteOrZero(metadata.viewport.effectiveDpr),
    }),
    observedDevice,
  });
}

function boundedCapacity(value: number | undefined, fallback: number, maximum: number): number {
  if (!Number.isFinite(value) || value === undefined) return fallback;
  return Math.min(maximum, Math.max(1, Math.floor(value)));
}

function positiveFiniteOrDefault(value: number | undefined, fallback: number): number {
  return Number.isFinite(value) && value !== undefined && value > 0 ? value : fallback;
}

function nonNegativeFiniteOrZero(value: number): number {
  return Number.isFinite(value) && value >= 0 ? value : 0;
}
