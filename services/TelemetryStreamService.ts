/**
 * TelemetryStreamService - Event-driven telemetry ingestion engine
 *
 * A singleton service that manages real-time telemetry streams with:
 * - Automatic reconnection with Fibonacci backoff
 * - GPS-derived dynamics when hardware sensors unavailable
 * - Protocol-agnostic message parsing (GPSD, custom JSON, raw CSV)
 * - Observable pattern for React integration
 */

// Telemetry data model optimized for AI coaching
export interface CoachingFrame {
  seq: number;
  timestamp: number;

  // Spatial
  lat: number;
  lon: number;
  altitude: number;
  heading: number;

  // Dynamics (core for AI coaching)
  speedKmh: number;
  gLateral: number;
  gLongitudinal: number;

  // Driver inputs
  throttlePct: number;
  brakePct: number;
  steeringDeg: number;

  // Powertrain
  rpm: number;
  gear: number;

  // Flags
  isGpsDerived: boolean; // True if G-forces were calculated from GPS
}

export type ConnectionState =
  | 'idle'
  | 'connecting'
  | 'live'
  | 'paused'
  | 'recovering'
  | 'dead';

type FrameListener = (frame: CoachingFrame) => void;
type StateListener = (state: ConnectionState, info?: string) => void;

// Fibonacci sequence generator for backoff delays
function* fibonacciMs(cap: number): Generator<number> {
  let a = 1000, b = 1000;
  while (true) {
    yield Math.min(a, cap);
    [a, b] = [b, a + b];
  }
}

class TelemetryStreamEngine {
  private static instance: TelemetryStreamEngine | null = null;

  private state: ConnectionState = 'idle';
  private endpoint: string | null = null;
  private eventSource: EventSource | null = null;

  private frameListeners = new Set<FrameListener>();
  private stateListeners = new Set<StateListener>();

  private recoveryTimer: ReturnType<typeof setTimeout> | null = null;
  private backoffGenerator = fibonacciMs(30000);
  private recoveryAttempts = 0;

  // Rolling window for GPS-based dynamics calculation
  private positionHistory: Array<{ t: number; lat: number; lon: number; speed: number; heading: number }> = [];
  private frameSequence = 0;

  private constructor() { }

  static getInstance(): TelemetryStreamEngine {
    if (!TelemetryStreamEngine.instance) {
      TelemetryStreamEngine.instance = new TelemetryStreamEngine();
    }
    return TelemetryStreamEngine.instance;
  }

  // Public API

  getState(): ConnectionState {
    return this.state;
  }

  subscribe(onFrame: FrameListener): () => void {
    this.frameListeners.add(onFrame);
    return () => this.frameListeners.delete(onFrame);
  }

  onStateChange(listener: StateListener): () => void {
    this.stateListeners.add(listener);
    listener(this.state); // Emit current state immediately
    return () => this.stateListeners.delete(listener);
  }

  connect(url: string): void {
    if (this.endpoint === url && this.state === 'live') {
      return; // Already connected to same endpoint
    }

    this.teardown();
    this.endpoint = url;
    this.frameSequence = 0;
    this.positionHistory = [];
    this.backoffGenerator = fibonacciMs(30000);
    this.recoveryAttempts = 0;

    this.establish();
  }

  disconnect(): void {
    this.teardown();
    this.transition('idle');
  }

  pause(): void {
    if (this.state === 'live') {
      this.transition('paused');
    }
  }

  resume(): void {
    if (this.state === 'paused') {
      this.transition('live');
    }
  }

  // Connection management

  private establish(): void {
    if (!this.endpoint) return;

    this.transition('connecting');

    try {
      this.eventSource = new EventSource(this.endpoint);

      this.eventSource.onopen = () => {
        this.recoveryAttempts = 0;
        this.backoffGenerator = fibonacciMs(30000);
        this.transition('live');
      };

      this.eventSource.onmessage = (event) => {
        console.log('[TelemetryStream] Raw SSE data:', event.data);
        if (this.state === 'paused') return;
        this.ingest(event.data);
      };

      this.eventSource.onerror = () => {
        this.eventSource?.close();
        this.eventSource = null;
        this.scheduleRecovery();
      };

    } catch (err) {
      this.scheduleRecovery();
    }
  }

  private scheduleRecovery(): void {
    if (this.recoveryAttempts >= 10) {
      this.transition('dead', 'Max recovery attempts exceeded');
      return;
    }

    this.transition('recovering');
    this.recoveryAttempts++;

    const delay = this.backoffGenerator.next().value;

    this.recoveryTimer = setTimeout(() => {
      this.establish();
    }, delay);
  }

  private teardown(): void {
    if (this.recoveryTimer) {
      clearTimeout(this.recoveryTimer);
      this.recoveryTimer = null;
    }

    if (this.eventSource) {
      this.eventSource.close();
      this.eventSource = null;
    }
  }

  private transition(newState: ConnectionState, info?: string): void {
    if (this.state === newState) return;
    this.state = newState;
    this.stateListeners.forEach(fn => fn(newState, info));
  }

  // Message parsing - protocol agnostic

  private ingest(raw: string): void {
    try {
      const msg = JSON.parse(raw);
      console.log('[TelemetryStream] Parsed JSON:', msg.class || 'direct');
      const frame = this.parseMessage(msg);

      if (frame) {
        console.log('[TelemetryStream] Frame created:', { lat: frame.lat, lon: frame.lon, speed: frame.speedKmh });
        this.frameListeners.forEach(fn => fn(frame));
      } else {
        console.log('[TelemetryStream] No frame created from message');
      }
    } catch {
      // Try CSV format as fallback
      const frame = this.parseCSV(raw);
      if (frame) {
        this.frameListeners.forEach(fn => fn(frame));
      }
    }
  }

  private parseMessage(msg: Record<string, unknown>): CoachingFrame | null {
    // GPSD TPV format
    if (msg.class === 'TPV') {
      return this.fromGPSD(msg);
    }

    // Direct telemetry format (custom server)
    if (typeof msg.lat === 'number' && typeof msg.lon === 'number') {
      return this.fromDirectJSON(msg);
    }

    // VBOX-style with nested structure
    if (msg.gps && typeof msg.gps === 'object') {
      return this.fromVBOXJSON(msg);
    }

    return null;
  }

  private fromGPSD(msg: Record<string, unknown>): CoachingFrame | null {
    const mode = msg.mode as number;
    if (mode < 2) return null; // No GPS fix

    const lat = msg.lat as number;
    const lon = msg.lon as number;
    const alt = (msg.alt as number) || 0;
    const speedMs = (msg.speed as number) || 0;
    const heading = (msg.track as number) || 0;

    const timestamp = typeof msg.time === 'string'
      ? new Date(msg.time as string).getTime()
      : Date.now();

    const speedKmh = speedMs * 3.6;

    // Derive G-forces from GPS trajectory
    const { gLat, gLong } = this.deriveGForces(timestamp, lat, lon, speedKmh, heading);

    return this.buildFrame({
      timestamp,
      lat,
      lon,
      altitude: alt,
      heading,
      speedKmh,
      gLateral: gLat,
      gLongitudinal: gLong,
      throttlePct: speedKmh > 10 && gLong > 0.05 ? Math.min(100, gLong * 150) : 0,
      brakePct: gLong < -0.3 ? Math.min(100, Math.abs(gLong) * 100) : 0,
      steeringDeg: 0,
      rpm: 0,
      gear: Math.min(6, Math.max(1, Math.floor(speedKmh / 40) + 1)),
      isGpsDerived: true
    });
  }

  private fromDirectJSON(msg: Record<string, unknown>): CoachingFrame | null {
    const lat = (msg.lat ?? msg.latitude) as number;
    const lon = (msg.lon ?? msg.longitude) as number;

    if (isNaN(lat) || isNaN(lon)) return null;

    const timestamp = typeof msg.time === 'number'
      ? msg.time as number
      : Date.now();

    const speedKmh = ((msg.speed ?? msg.speedKmh ?? 0) as number);
    const heading = ((msg.track ?? msg.heading ?? 0) as number);

    // Check if G-forces provided directly
    const hasGForces = typeof msg.gLat === 'number' || typeof msg.latG === 'number';

    let gLat = ((msg.gLat ?? msg.latG ?? msg.gForceLat ?? 0) as number);
    let gLong = ((msg.gLong ?? msg.longG ?? msg.gForceLong ?? 0) as number);

    if (!hasGForces) {
      const derived = this.deriveGForces(timestamp, lat, lon, speedKmh, heading);
      gLat = derived.gLat;
      gLong = derived.gLong;
    }

    return this.buildFrame({
      timestamp,
      lat,
      lon,
      altitude: (msg.alt ?? msg.altitude ?? 0) as number,
      heading,
      speedKmh,
      gLateral: gLat,
      gLongitudinal: gLong,
      throttlePct: (msg.throttle ?? msg.throttlePct ?? 0) as number,
      brakePct: (msg.brake ?? msg.brakePct ?? msg.brakePos ?? 0) as number,
      steeringDeg: (msg.steering ?? msg.steeringDeg ?? 0) as number,
      rpm: (msg.rpm ?? 0) as number,
      gear: (msg.gear ?? 0) as number,
      isGpsDerived: !hasGForces
    });
  }

  private fromVBOXJSON(msg: Record<string, unknown>): CoachingFrame | null {
    const gps = msg.gps as Record<string, unknown>;
    const dynamics = (msg.dynamics ?? {}) as Record<string, unknown>;
    const inputs = (msg.inputs ?? {}) as Record<string, unknown>;
    const engine = (msg.engine ?? {}) as Record<string, unknown>;

    return this.buildFrame({
      timestamp: (msg.timestamp as number) ?? Date.now(),
      lat: gps.lat as number,
      lon: gps.lon as number,
      altitude: (gps.alt as number) ?? 0,
      heading: (gps.heading as number) ?? 0,
      speedKmh: (dynamics.speed as number) ?? 0,
      gLateral: (dynamics.gLat as number) ?? 0,
      gLongitudinal: (dynamics.gLong as number) ?? 0,
      throttlePct: (inputs.throttle as number) ?? 0,
      brakePct: (inputs.brake as number) ?? 0,
      steeringDeg: (inputs.steering as number) ?? 0,
      rpm: (engine.rpm as number) ?? 0,
      gear: (engine.gear as number) ?? 0,
      isGpsDerived: false
    });
  }

  private parseCSV(line: string): CoachingFrame | null {
    const parts = line.split(',');
    if (parts.length < 8) return null;

    // Expected: time,lat,lon,alt,speed,climb,track,mode
    const timestamp = new Date(parts[0]).getTime();
    if (isNaN(timestamp)) return null;

    const lat = parseFloat(parts[1]);
    const lon = parseFloat(parts[2]);
    const alt = parseFloat(parts[3]);
    const speedMs = parseFloat(parts[4]);
    const heading = parseFloat(parts[6]);

    if (isNaN(lat) || isNaN(lon)) return null;

    const speedKmh = speedMs * 3.6;
    const { gLat, gLong } = this.deriveGForces(timestamp, lat, lon, speedKmh, heading);

    return this.buildFrame({
      timestamp,
      lat,
      lon,
      altitude: alt,
      heading,
      speedKmh,
      gLateral: gLat,
      gLongitudinal: gLong,
      throttlePct: 0,
      brakePct: 0,
      steeringDeg: 0,
      rpm: 0,
      gear: 0,
      isGpsDerived: true
    });
  }

  // GPS-derived dynamics using kinematic equations

  private deriveGForces(
    t: number,
    lat: number,
    lon: number,
    speed: number,
    heading: number
  ): { gLat: number; gLong: number } {
    const G = 9.81;

    // Add to rolling window
    this.positionHistory.push({ t, lat, lon, speed, heading });

    // Keep last 10 samples (1 second at 10Hz)
    if (this.positionHistory.length > 10) {
      this.positionHistory.shift();
    }

    if (this.positionHistory.length < 3) {
      return { gLat: 0, gLong: 0 };
    }

    const curr = this.positionHistory[this.positionHistory.length - 1];
    const prev = this.positionHistory[this.positionHistory.length - 3]; // 2 samples back for smoothing

    const dt = (curr.t - prev.t) / 1000; // Convert to seconds
    if (dt <= 0 || dt > 2) {
      return { gLat: 0, gLong: 0 };
    }

    // Longitudinal G: rate of speed change
    const speedDelta = (curr.speed - prev.speed) / 3.6; // Convert to m/s
    const gLong = speedDelta / dt / G;

    // Lateral G: centripetal acceleration from heading change
    const headingDelta = this.normalizeAngle(curr.heading - prev.heading);
    const headingRate = (headingDelta * Math.PI / 180) / dt; // rad/s
    const speedMs = curr.speed / 3.6;
    const gLat = (speedMs * headingRate) / G;

    // Clamp to reasonable values
    return {
      gLat: Math.max(-3, Math.min(3, gLat)),
      gLong: Math.max(-3, Math.min(3, gLong))
    };
  }

  private normalizeAngle(angle: number): number {
    while (angle > 180) angle -= 360;
    while (angle < -180) angle += 360;
    return angle;
  }

  private buildFrame(data: Omit<CoachingFrame, 'seq'>): CoachingFrame {
    return {
      seq: ++this.frameSequence,
      ...data
    };
  }
}

// Export singleton instance
export const TelemetryStream = TelemetryStreamEngine.getInstance();
