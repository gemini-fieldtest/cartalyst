/**
 * ShadowLineEngine - Optimal lap synthesis and real-time comparison
 *
 * Unlike traditional "ghost car" implementations that use time-based sync,
 * Shadow Line uses DISTANCE-BASED synchronization for more intuitive
 * driver feedback. The shadow shows where you SHOULD be at this point
 * on track, not where you were N seconds ago.
 *
 * Key Concepts:
 * - Apex-weighted micro-sectors: Corners are subdivided more finely
 * - Velocity vectors: Shows momentum, not just position
 * - Echo trail: Your recent path vs optimal path overlay
 * - Cumulative delta: Rolling time gain/loss through sectors
 */

import { type CoachingFrame } from './TelemetryStreamService';

// === TYPES ===

export interface ShadowPoint {
  distance: number;       // Meters from start/finish
  lat: number;
  lon: number;
  speedKmh: number;
  heading: number;
  gLateral: number;
  elapsedTime: number;    // Time from lap start
  sectorIndex: number;    // Which sector (0-based)
}

export interface LapRecord {
  id: string;
  lapNumber: number;
  startTime: number;
  endTime: number;
  totalDistance: number;
  lapTime: number;        // Seconds
  isComplete: boolean;
  points: ShadowPoint[];
  sectorTimes: number[];  // Time for each sector
}

export interface ShadowState {
  currentLapId: string | null;
  shadowLapId: string | null;     // The optimal/"shadow" lap
  distanceInLap: number;          // Current distance traveled this lap
  currentDelta: number;           // +/- seconds vs shadow
  sectorDeltas: number[];         // Delta per sector
  shadowPosition: ShadowPoint | null;
  echoTrail: { user: ShadowPoint[]; shadow: ShadowPoint[] };
}

export interface SectorBoundary {
  id: number;
  name: string;
  startDistance: number;
  endDistance: number;
}

type ShadowListener = (state: ShadowState) => void;
type LapCompleteListener = (lap: LapRecord) => void;

// === HAVERSINE DISTANCE ===

function haversineDistance(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const R = 6371e3; // Earth radius in meters
  const phi1 = lat1 * Math.PI / 180;
  const phi2 = lat2 * Math.PI / 180;
  const dPhi = (lat2 - lat1) * Math.PI / 180;
  const dLambda = (lon2 - lon1) * Math.PI / 180;

  const a = Math.sin(dPhi / 2) ** 2 +
            Math.cos(phi1) * Math.cos(phi2) * Math.sin(dLambda / 2) ** 2;
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));

  return R * c;
}

// === SHADOW LINE ENGINE ===

class ShadowLineEngineCore {
  private static instance: ShadowLineEngineCore | null = null;

  // Configuration
  private startFinishLine: { lat: number; lon: number } | null = null;
  private startFinishRadius = 25; // meters
  private minLapTime = 30; // seconds
  private sectorBoundaries: SectorBoundary[] = [];
  private trackLength = 0;

  // Lap storage
  private completedLaps: LapRecord[] = [];
  private currentLap: {
    id: string;
    lapNumber: number;
    startTime: number;
    points: ShadowPoint[];
    accumulatedDistance: number;
  } | null = null;

  // Shadow (optimal) lap - synthesized from best sectors
  private shadowLap: LapRecord | null = null;

  // Live state
  private state: ShadowState = {
    currentLapId: null,
    shadowLapId: null,
    distanceInLap: 0,
    currentDelta: 0,
    sectorDeltas: [],
    shadowPosition: null,
    echoTrail: { user: [], shadow: [] }
  };

  // Listeners
  private shadowListeners = new Set<ShadowListener>();
  private lapCompleteListeners = new Set<LapCompleteListener>();

  // Previous frame for distance calculation
  private lastFrame: CoachingFrame | null = null;
  private crossingCooldown = 0;

  private constructor() {}

  static getInstance(): ShadowLineEngineCore {
    if (!ShadowLineEngineCore.instance) {
      ShadowLineEngineCore.instance = new ShadowLineEngineCore();
    }
    return ShadowLineEngineCore.instance;
  }

  // === PUBLIC API ===

  configure(config: {
    startFinishLine: { lat: number; lon: number };
    startFinishRadius?: number;
    minLapTime?: number;
    sectors: SectorBoundary[];
    trackLength: number;
  }): void {
    this.startFinishLine = config.startFinishLine;
    this.startFinishRadius = config.startFinishRadius ?? 25;
    this.minLapTime = config.minLapTime ?? 30;
    this.sectorBoundaries = config.sectors;
    this.trackLength = config.trackLength;

    // Initialize sector deltas
    this.state.sectorDeltas = new Array(config.sectors.length).fill(0);
  }

  subscribe(listener: ShadowListener): () => void {
    this.shadowListeners.add(listener);
    listener(this.state); // Emit current state
    return () => this.shadowListeners.delete(listener);
  }

  onLapComplete(listener: LapCompleteListener): () => void {
    this.lapCompleteListeners.add(listener);
    return () => this.lapCompleteListeners.delete(listener);
  }

  getState(): ShadowState {
    return { ...this.state };
  }

  getShadowLap(): LapRecord | null {
    return this.shadowLap;
  }

  getCompletedLaps(): LapRecord[] {
    return [...this.completedLaps];
  }

  /**
   * Feed a new telemetry frame into the engine.
   * This is the main entry point called for every GPS update.
   */
  ingest(frame: CoachingFrame): void {
    if (!this.startFinishLine) return;

    // Calculate distance traveled since last frame
    const distanceDelta = this.lastFrame
      ? haversineDistance(this.lastFrame.lat, this.lastFrame.lon, frame.lat, frame.lon)
      : 0;

    // Check for start/finish line crossing
    const distToStart = haversineDistance(
      frame.lat, frame.lon,
      this.startFinishLine.lat, this.startFinishLine.lon
    );

    if (this.crossingCooldown > 0) {
      this.crossingCooldown--;
    }

    const isCrossing = distToStart < this.startFinishRadius && this.crossingCooldown === 0;

    if (isCrossing) {
      this.handleStartFinishCrossing(frame);
      this.crossingCooldown = 50; // ~5 seconds at 10Hz
    }

    // Update current lap
    if (this.currentLap) {
      this.currentLap.accumulatedDistance += distanceDelta;

      const currentSector = this.getCurrentSector(this.currentLap.accumulatedDistance);
      const elapsedTime = (frame.timestamp - this.currentLap.startTime) / 1000;

      const point: ShadowPoint = {
        distance: this.currentLap.accumulatedDistance,
        lat: frame.lat,
        lon: frame.lon,
        speedKmh: frame.speedKmh,
        heading: frame.heading,
        gLateral: frame.gLateral,
        elapsedTime,
        sectorIndex: currentSector
      };

      this.currentLap.points.push(point);

      // Update state
      this.state.currentLapId = this.currentLap.id;
      this.state.distanceInLap = this.currentLap.accumulatedDistance;

      // Find shadow position at same distance
      if (this.shadowLap) {
        const shadowPoint = this.findShadowPointAtDistance(this.currentLap.accumulatedDistance);
        this.state.shadowPosition = shadowPoint;

        if (shadowPoint) {
          // Delta = current elapsed time - shadow elapsed time at same distance
          // Negative = ahead (faster), Positive = behind (slower)
          this.state.currentDelta = elapsedTime - shadowPoint.elapsedTime;

          // Update sector delta
          if (currentSector >= 0 && currentSector < this.state.sectorDeltas.length) {
            this.state.sectorDeltas[currentSector] = this.state.currentDelta;
          }
        }

        // Update echo trails (last 100 points)
        this.state.echoTrail.user.push(point);
        if (this.state.echoTrail.user.length > 100) {
          this.state.echoTrail.user.shift();
        }

        if (shadowPoint) {
          this.state.echoTrail.shadow.push(shadowPoint);
          if (this.state.echoTrail.shadow.length > 100) {
            this.state.echoTrail.shadow.shift();
          }
        }
      }

      this.emitState();
    }

    this.lastFrame = frame;
  }

  /**
   * Manually set a specific lap as the shadow/target.
   */
  setShadowLap(lapId: string): boolean {
    const lap = this.completedLaps.find(l => l.id === lapId);
    if (lap) {
      this.shadowLap = lap;
      this.state.shadowLapId = lap.id;
      this.emitState();
      return true;
    }
    return false;
  }

  /**
   * Reset all lap data and state.
   */
  reset(): void {
    this.completedLaps = [];
    this.currentLap = null;
    this.shadowLap = null;
    this.lastFrame = null;
    this.crossingCooldown = 0;

    this.state = {
      currentLapId: null,
      shadowLapId: null,
      distanceInLap: 0,
      currentDelta: 0,
      sectorDeltas: new Array(this.sectorBoundaries.length).fill(0),
      shadowPosition: null,
      echoTrail: { user: [], shadow: [] }
    };

    this.emitState();
  }

  // === PRIVATE METHODS ===

  private handleStartFinishCrossing(frame: CoachingFrame): void {
    const now = frame.timestamp;

    // Complete current lap if valid
    if (this.currentLap && this.currentLap.points.length > 0) {
      const lapTime = (now - this.currentLap.startTime) / 1000;

      if (lapTime >= this.minLapTime) {
        const completedLap: LapRecord = {
          id: this.currentLap.id,
          lapNumber: this.currentLap.lapNumber,
          startTime: this.currentLap.startTime,
          endTime: now,
          totalDistance: this.currentLap.accumulatedDistance,
          lapTime,
          isComplete: true,
          points: this.currentLap.points,
          sectorTimes: this.calculateSectorTimes(this.currentLap.points)
        };

        this.completedLaps.push(completedLap);
        this.lapCompleteListeners.forEach(fn => fn(completedLap));

        // Synthesize new optimal lap from best sectors
        this.synthesizeShadowLap();
      }
    }

    // Start new lap
    const lapNumber = this.completedLaps.length + 1;
    this.currentLap = {
      id: `lap_${Date.now()}_${lapNumber}`,
      lapNumber,
      startTime: now,
      points: [],
      accumulatedDistance: 0
    };

    // Reset state for new lap
    this.state.distanceInLap = 0;
    this.state.currentDelta = 0;
    this.state.sectorDeltas = new Array(this.sectorBoundaries.length).fill(0);
    this.state.echoTrail = { user: [], shadow: [] };
  }

  private getCurrentSector(distance: number): number {
    for (let i = 0; i < this.sectorBoundaries.length; i++) {
      const sector = this.sectorBoundaries[i];
      if (distance >= sector.startDistance && distance < sector.endDistance) {
        return i;
      }
    }
    return this.sectorBoundaries.length - 1; // Default to last sector
  }

  private calculateSectorTimes(points: ShadowPoint[]): number[] {
    const sectorTimes: number[] = new Array(this.sectorBoundaries.length).fill(0);

    let lastSectorEndTime = 0;
    for (let i = 0; i < this.sectorBoundaries.length; i++) {
      const sector = this.sectorBoundaries[i];

      // Find the point closest to sector end
      const sectorEndPoint = points.find(p => p.distance >= sector.endDistance);
      if (sectorEndPoint) {
        sectorTimes[i] = sectorEndPoint.elapsedTime - lastSectorEndTime;
        lastSectorEndTime = sectorEndPoint.elapsedTime;
      }
    }

    return sectorTimes;
  }

  /**
   * Synthesize optimal lap from best sector performances.
   * This is the core "Shadow Line" algorithm.
   *
   * Unlike Replay's micro-sector approach (50m), we use apex-weighted
   * variable-size sectors for more meaningful corner optimization.
   */
  private synthesizeShadowLap(): void {
    if (this.completedLaps.length === 0) {
      this.shadowLap = null;
      return;
    }

    if (this.completedLaps.length === 1) {
      // Only one lap - it's the shadow by default
      this.shadowLap = this.completedLaps[0];
      this.state.shadowLapId = this.shadowLap.id;
      return;
    }

    // Find best lap for each sector
    const bestSectorLaps: (LapRecord | null)[] = [];

    for (let s = 0; s < this.sectorBoundaries.length; s++) {
      let bestTime = Infinity;
      let bestLap: LapRecord | null = null;

      for (const lap of this.completedLaps) {
        if (lap.sectorTimes[s] < bestTime && lap.sectorTimes[s] > 0) {
          bestTime = lap.sectorTimes[s];
          bestLap = lap;
        }
      }

      bestSectorLaps.push(bestLap);
    }

    // Stitch together optimal lap from best sectors
    const optimalPoints: ShadowPoint[] = [];
    let accumulatedTime = 0;

    for (let s = 0; s < this.sectorBoundaries.length; s++) {
      const sector = this.sectorBoundaries[s];
      const sourceLap = bestSectorLaps[s];

      if (!sourceLap) continue;

      // Get points from this lap within the sector
      const sectorPoints = sourceLap.points.filter(
        p => p.distance >= sector.startDistance && p.distance < sector.endDistance
      );

      if (sectorPoints.length === 0) continue;

      // Adjust timestamps to be continuous
      const sectorStartTime = sectorPoints[0].elapsedTime;

      for (const p of sectorPoints) {
        optimalPoints.push({
          ...p,
          elapsedTime: accumulatedTime + (p.elapsedTime - sectorStartTime)
        });
      }

      // Update accumulated time
      const sectorDuration = sectorPoints[sectorPoints.length - 1].elapsedTime - sectorStartTime;
      accumulatedTime += sectorDuration;
    }

    // Create the synthetic optimal lap
    const theoreticalBestTime = bestSectorLaps.reduce((sum, lap, idx) => {
      if (lap) {
        return sum + lap.sectorTimes[idx];
      }
      return sum;
    }, 0);

    this.shadowLap = {
      id: 'shadow_optimal',
      lapNumber: -1, // Indicates synthetic
      startTime: 0,
      endTime: theoreticalBestTime * 1000,
      totalDistance: this.trackLength,
      lapTime: theoreticalBestTime,
      isComplete: true,
      points: optimalPoints,
      sectorTimes: bestSectorLaps.map((lap, idx) => lap?.sectorTimes[idx] ?? 0)
    };

    this.state.shadowLapId = this.shadowLap.id;
  }

  /**
   * Find the shadow point at a given distance using binary search.
   */
  private findShadowPointAtDistance(distance: number): ShadowPoint | null {
    if (!this.shadowLap || this.shadowLap.points.length === 0) {
      return null;
    }

    const points = this.shadowLap.points;

    // Binary search for closest point
    let low = 0;
    let high = points.length - 1;

    while (low < high) {
      const mid = Math.floor((low + high) / 2);
      if (points[mid].distance < distance) {
        low = mid + 1;
      } else {
        high = mid;
      }
    }

    const idx = low;

    // Interpolate between adjacent points for smoother result
    if (idx > 0 && idx < points.length) {
      const p1 = points[idx - 1];
      const p2 = points[idx];

      if (p2.distance === p1.distance) return p1;

      const ratio = (distance - p1.distance) / (p2.distance - p1.distance);

      return {
        distance,
        lat: p1.lat + (p2.lat - p1.lat) * ratio,
        lon: p1.lon + (p2.lon - p1.lon) * ratio,
        speedKmh: p1.speedKmh + (p2.speedKmh - p1.speedKmh) * ratio,
        heading: p1.heading + (p2.heading - p1.heading) * ratio,
        gLateral: p1.gLateral + (p2.gLateral - p1.gLateral) * ratio,
        elapsedTime: p1.elapsedTime + (p2.elapsedTime - p1.elapsedTime) * ratio,
        sectorIndex: p1.sectorIndex
      };
    }

    return points[Math.min(idx, points.length - 1)];
  }

  private emitState(): void {
    this.shadowListeners.forEach(fn => fn(this.state));
  }
}

// Export singleton
export const ShadowLineEngine = ShadowLineEngineCore.getInstance();

// Export types for external use
export type { ShadowListener, LapCompleteListener };
