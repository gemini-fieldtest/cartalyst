/**
 * useLiveTelemetry - React hook for consuming real-time telemetry
 *
 * Provides a clean React interface to the TelemetryStreamService with:
 * - Automatic lifecycle management
 * - Frame buffering with configurable history
 * - Derived metrics (lap timing, sector analysis)
 * - Memoized selectors for performance
 */

import { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import {
  TelemetryStream,
  type CoachingFrame,
  type ConnectionState
} from '../services/TelemetryStreamService';

export interface LapBoundary {
  lapNumber: number;
  startSeq: number;
  startTime: number;
  endSeq?: number;
  duration?: number;
}

export interface LiveTelemetryState {
  // Connection
  connectionState: ConnectionState;
  isLive: boolean;

  // Current data
  frame: CoachingFrame | null;
  frameRate: number;

  // History
  history: CoachingFrame[];
  lapBoundaries: LapBoundary[];
  currentLap: number;

  // Actions
  connect: (url: string) => void;
  disconnect: () => void;
  togglePause: () => void;
  clearHistory: () => void;
}

interface UseLiveTelemetryOptions {
  historyLimit?: number;
  startFinishZone?: { lat: number; lon: number; radiusM: number };
}

export function useLiveTelemetry(options: UseLiveTelemetryOptions = {}): LiveTelemetryState {
  const {
    historyLimit = 3000, // ~5 minutes at 10Hz
    startFinishZone
  } = options;

  const [connectionState, setConnectionState] = useState<ConnectionState>('idle');
  const [frame, setFrame] = useState<CoachingFrame | null>(null);
  const [history, setHistory] = useState<CoachingFrame[]>([]);
  const [lapBoundaries, setLapBoundaries] = useState<LapBoundary[]>([]);
  const [frameRate, setFrameRate] = useState(0);
  const [isPaused, setIsPaused] = useState(false);

  // Refs for tracking without re-renders
  const frameCountRef = useRef(0);
  const lastFrameTimeRef = useRef(Date.now());
  const lastPositionRef = useRef<{ lat: number; lon: number } | null>(null);
  const currentLapRef = useRef(0);

  // Frame rate calculation
  useEffect(() => {
    const interval = setInterval(() => {
      const now = Date.now();
      const elapsed = (now - lastFrameTimeRef.current) / 1000;
      if (elapsed > 0) {
        setFrameRate(Math.round(frameCountRef.current / elapsed));
      }
      frameCountRef.current = 0;
      lastFrameTimeRef.current = now;
    }, 1000);

    return () => clearInterval(interval);
  }, []);

  // Haversine distance for lap detection
  const haversineDistance = useCallback((lat1: number, lon1: number, lat2: number, lon2: number): number => {
    const R = 6371000; // Earth radius in meters
    const dLat = (lat2 - lat1) * Math.PI / 180;
    const dLon = (lon2 - lon1) * Math.PI / 180;
    const a =
      Math.sin(dLat / 2) * Math.sin(dLat / 2) +
      Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
      Math.sin(dLon / 2) * Math.sin(dLon / 2);
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
    return R * c;
  }, []);

  // Lap boundary detection
  const detectLapCrossing = useCallback((currentFrame: CoachingFrame): boolean => {
    if (!startFinishZone) return false;

    const prev = lastPositionRef.current;
    lastPositionRef.current = { lat: currentFrame.lat, lon: currentFrame.lon };

    if (!prev) return false;

    const prevDist = haversineDistance(
      prev.lat, prev.lon,
      startFinishZone.lat, startFinishZone.lon
    );
    const currDist = haversineDistance(
      currentFrame.lat, currentFrame.lon,
      startFinishZone.lat, startFinishZone.lon
    );

    // Crossed into the zone from outside
    const crossed = prevDist > startFinishZone.radiusM && currDist <= startFinishZone.radiusM;

    // Minimum speed to count as valid crossing (not just parking)
    return crossed && currentFrame.speedKmh > 30;
  }, [startFinishZone, haversineDistance]);

  // Subscribe to telemetry stream
  useEffect(() => {
    const unsubFrame = TelemetryStream.subscribe((newFrame) => {
      if (isPaused) return;

      frameCountRef.current++;
      setFrame(newFrame);

      // Update history with limit
      setHistory(prev => {
        const updated = [...prev, newFrame];
        return updated.length > historyLimit
          ? updated.slice(-historyLimit)
          : updated;
      });

      // Check for lap crossing
      if (detectLapCrossing(newFrame)) {
        currentLapRef.current++;

        setLapBoundaries(prev => {
          // Close previous lap
          const updated = prev.map((lap, idx) =>
            idx === prev.length - 1 && !lap.endSeq
              ? { ...lap, endSeq: newFrame.seq - 1, duration: newFrame.timestamp - lap.startTime }
              : lap
          );

          // Start new lap
          return [
            ...updated,
            {
              lapNumber: currentLapRef.current,
              startSeq: newFrame.seq,
              startTime: newFrame.timestamp
            }
          ];
        });
      }
    });

    const unsubState = TelemetryStream.onStateChange((state) => {
      setConnectionState(state);
    });

    return () => {
      unsubFrame();
      unsubState();
    };
  }, [isPaused, historyLimit, detectLapCrossing]);

  // Actions
  const connect = useCallback((url: string) => {
    setHistory([]);
    setLapBoundaries([]);
    setFrame(null);
    currentLapRef.current = 0;
    lastPositionRef.current = null;
    TelemetryStream.connect(url);
  }, []);

  const disconnect = useCallback(() => {
    TelemetryStream.disconnect();
  }, []);

  const togglePause = useCallback(() => {
    if (isPaused) {
      TelemetryStream.resume();
      setIsPaused(false);
    } else {
      TelemetryStream.pause();
      setIsPaused(true);
    }
  }, [isPaused]);

  const clearHistory = useCallback(() => {
    setHistory([]);
    setLapBoundaries([]);
  }, []);

  // Derived state
  const isLive = connectionState === 'live' && !isPaused;
  const currentLap = currentLapRef.current;

  return useMemo(() => ({
    connectionState,
    isLive,
    frame,
    frameRate,
    history,
    lapBoundaries,
    currentLap,
    connect,
    disconnect,
    togglePause,
    clearHistory
  }), [
    connectionState,
    isLive,
    frame,
    frameRate,
    history,
    lapBoundaries,
    currentLap,
    connect,
    disconnect,
    togglePause,
    clearHistory
  ]);
}

/**
 * Selector hooks for optimized subscriptions
 */

export function useCurrentSpeed(): number {
  const [speed, setSpeed] = useState(0);

  useEffect(() => {
    return TelemetryStream.subscribe((frame) => {
      setSpeed(frame.speedKmh);
    });
  }, []);

  return speed;
}

export function useGForces(): { lateral: number; longitudinal: number } {
  const [gForces, setGForces] = useState({ lateral: 0, longitudinal: 0 });

  useEffect(() => {
    return TelemetryStream.subscribe((frame) => {
      setGForces({
        lateral: frame.gLateral,
        longitudinal: frame.gLongitudinal
      });
    });
  }, []);

  return gForces;
}

export function useDriverInputs(): { throttle: number; brake: number; steering: number } {
  const [inputs, setInputs] = useState({ throttle: 0, brake: 0, steering: 0 });

  useEffect(() => {
    return TelemetryStream.subscribe((frame) => {
      setInputs({
        throttle: frame.throttlePct,
        brake: frame.brakePct,
        steering: frame.steeringDeg
      });
    });
  }, []);

  return inputs;
}
