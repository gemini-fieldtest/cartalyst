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
            // Expected format: time,lat,lon,alt,speed,climb,track,mode
            if (!rawData) return;
            // Handle SSE format "data: ..." if present from file? 
            // The file provided looks like raw CSV lines.
            const cleanData = rawData.replace(/^data:\s?/, '');

            const parts = cleanData.split(',');
            if (parts.length < 8) {
                console.warn('[GpsSSEService] Invalid data format:', rawData);
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
