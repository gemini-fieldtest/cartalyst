import { GpsSSEPoint, SSEConnectionStatus } from '../types';

type GpsDataCallback = (point: GpsSSEPoint) => void;
type StatusCallback = (status: SSEConnectionStatus) => void;
type ErrorCallback = (error: string) => void;

export class GpsSSEService {
    private url: string;
    private eventSource: EventSource | null = null;
    private onData: GpsDataCallback | null = null;
    private onStatus: StatusCallback | null = null;
    private onError: ErrorCallback | null = null;
    private reconnectTimeout: ReturnType<typeof setTimeout> | null = null;
    private isExplicitlyClosed = false;

    constructor(url: string) {
        this.url = url;
    }

    public connect(
        onData: GpsDataCallback,
        onStatus?: StatusCallback,
        onError?: ErrorCallback
    ) {
        this.onData = onData;
        this.onStatus = onStatus || null;
        this.onError = onError || null;
        this.isExplicitlyClosed = false;

        this.establishConnection();
    }

    private establishConnection() {
        if (this.eventSource) {
            this.eventSource.close();
            this.eventSource = null;
        }

        // Handle Mock File Replay
        if (this.url.endsWith('.txt')) {
            this.startMockReplay();
            return;
        }

        try {
            this.updateStatus('connecting');
            console.log(`[GpsSSEService] Connecting to ${this.url}`);

            this.eventSource = new EventSource(this.url);

            this.eventSource.onopen = () => {
                console.log('[GpsSSEService] Connected');
                this.updateStatus('connected');
            };

            this.eventSource.onmessage = (event) => {
                this.processDataLine(event.data);
                console.log(event.data)
            };

            this.eventSource.onerror = (err) => {
                console.error('[GpsSSEService] Connection error:', err);
                this.updateStatus('error');
                if (this.onError) this.onError('Connection lost');

                // EventSource automatically reconnects, but sometimes we want custom logic
                // For now, let generic browser reconnection handle it, but update status
                // If the browser closes it (readyState 2), we might need to re-init
                if (this.eventSource?.readyState === EventSource.CLOSED) {
                    this.scheduleReconnect();
                }
            };

        } catch (e) {
            console.error('[GpsSSEService] Setup error:', e);
            this.updateStatus('error');
            if (this.onError) this.onError(e instanceof Error ? e.message : 'Setup error');
            this.scheduleReconnect();
        }
    }

    private async startMockReplay() {
        try {
            this.updateStatus('connecting');
            const response = await fetch(this.url);
            if (!response.ok) throw new Error(`Failed to load mock data: ${response.statusText}`);

            const text = await response.text();
            const lines = text.split('\n').filter(l => l.trim().length > 0);

            this.updateStatus('connected');
            console.log(`[GpsSSEService] Replaying ${lines.length} mock points`);

            let currentIndex = 0;
            const playback = () => {
                if (this.isExplicitlyClosed) return;
                if (currentIndex >= lines.length) {
                    // Loop or stop? Let's loop for continuous testing
                    currentIndex = 0;
                }

                const line = lines[currentIndex];
                this.processDataLine(line);

                // Calculate delay to next point
                let delay = 100; // default 10Hz
                if (currentIndex < lines.length - 1) {
                    const currentLine = lines[currentIndex];
                    const nextLine = lines[currentIndex + 1];
                    try {
                        // Extract times: 2025-12-09T02:42:40.600Z (first token)
                        const t1 = new Date(currentLine.split(',')[0]).getTime();
                        const t2 = new Date(nextLine.split(',')[0]).getTime();
                        if (!isNaN(t1) && !isNaN(t2)) {
                            delay = t2 - t1;
                            // If delay is huge (gap in data), cap it? Or just play it.
                            // If delay is <= 0 (duplicates), use minimal delay
                            if (delay <= 0) delay = 10;
                        }
                    } catch (e) { }
                }

                currentIndex++;
                this.reconnectTimeout = setTimeout(playback, delay);
            };

            playback();

        } catch (e) {
            console.error('[GpsSSEService] Mock replay error:', e);
            this.updateStatus('error');
            if (this.onError) this.onError(e instanceof Error ? e.message : 'Mock load failed');
        }
    }

    private processDataLine(rawData: string) {
        try {
            // Expected format options:
            // 1. JSON: { lat, lon, speed, heading, ... }
            // 2. CSV: time,lat,lon,alt,speed,climb,track,mode

            if (!rawData) return;
            const cleanData = rawData.replace(/^data:\s?/, '');

            // Try JSON parsing first (User's new format)
            if (cleanData.trim().startsWith('{')) {
                try {
                    const data = JSON.parse(cleanData);

                    // Robust coordinate extraction
                    const lat = typeof data.lat === 'number' ? data.lat : (parseFloat(data.latitude) || 0);
                    const lon = typeof data.lon === 'number' ? data.lon : (parseFloat(data.longitude) || 0);

                    if (lat === 0 && lon === 0 && !data.lat) {
                        // Fallback check if 0,0 is valid or if extraction failed
                        // But for now, if completely missing, ignore
                    }

                    const point: GpsSSEPoint = {
                        time: data.time ?? 0,
                        lat: lat,
                        lon: lon,
                        speed: data.speed ?? 0,
                        track: data.heading ?? data.track ?? 0,
                        alt: data.alt ?? 0,

                        // Extended Telemetry
                        brake: data.brake,
                        throttle: data.throttle,
                        rpm: data.rpm,
                        gear: data.gear,
                        steering: data.steering,
                        gLat: data.gLat,
                        gLong: data.gLong
                    };

                    // Basic validation for JSON path
                    if (isNaN(point.lat) || isNaN(point.lon)) {
                        console.warn('[GpsSSEService] Invalid JSON lat/lon:', data);
                        return;
                    }

                    if (this.onData) {
                        this.onData(point);
                    }
                    return;
                } catch (e) {
                    console.warn('[GpsSSEService] JSON parse failed', e);
                    return;
                }
            }

            const parts = cleanData.split(',');
            if (parts.length < 8) {
                // If it wasn't JSON and doesn't have 8 parts, it's invalid
                // But avoid logging spam if it's just an empty line or something
                if (cleanData.length > 5) console.warn('[GpsSSEService] Invalid data format:', rawData);
                return;
            }

            const point: GpsSSEPoint = {
                time: parts[0],
                lat: parseFloat(parts[1]),
                lon: parseFloat(parts[2]),
                alt: parseFloat(parts[3]),
                speed: parseFloat(parts[4]), // m/s
                climb: parseFloat(parts[5]),
                track: parseFloat(parts[6]),
                mode: parseInt(parts[7], 10)
            };

            // Basic validation
            if (isNaN(point.lat) || isNaN(point.lon)) {
                return;
            }

            if (this.onData) {
                this.onData(point);
            }

        } catch (e) {
            console.error('[GpsSSEService] Parse error:', e);
            if (this.onError) this.onError(e instanceof Error ? e.message : 'Parse error');
        }
    }

    private scheduleReconnect() {
        if (this.isExplicitlyClosed) return;

        if (this.reconnectTimeout) clearTimeout(this.reconnectTimeout);
        this.reconnectTimeout = setTimeout(() => {
            this.establishConnection();
        }, 3000);
    }

    private updateStatus(status: SSEConnectionStatus) {
        if (this.onStatus) {
            this.onStatus(status);
        }
    }

    public disconnect() {
        this.isExplicitlyClosed = true;
        if (this.reconnectTimeout) {
            clearTimeout(this.reconnectTimeout);
            this.reconnectTimeout = null;
        }
        if (this.eventSource) {
            this.eventSource.close();
            this.eventSource = null;
        }
        this.updateStatus('disconnected');
        console.log('[GpsSSEService] Disconnected');
    }
}
