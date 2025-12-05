export interface TelemetryPoint {
  distance: number; // Distance from start in meters
  speed: number; // Speed in km/h
  lat: number;
  lng: number;
  gLat: number; // Lateral G
  gLong: number; // Longitudinal G
  throttle: number; // 0-100
  brake: number; // 0-100
  time: number; // Time in seconds from start of lap
}

export interface Sector {
  id: number;
  name: string;
  startDist: number;
  endDist: number;
}

export interface Lap {
  id: string;
  lapNumber: number;
  time: number; // Total time in seconds
  valid: boolean;
  telemetry: TelemetryPoint[];
  date: string;
  sectors: number[]; // Time for each sector
}

export interface Session {
  id: string;
  trackName: string;
  date: string;
  laps: Lap[];
  bestLapId: string;
  weather: 'Sunny' | 'Cloudy' | 'Rain';
  trackTemp: number;
}

export interface Track {
  name: string;
  length: number; // meters
  sectors: Sector[];
  mapPoints: { x: number; y: number }[]; // Simplified polygon for rendering
  recordLap: number;
}

export enum ViewState {
  DASHBOARD = 'DASHBOARD',
  LIVE = 'LIVE',
  ANALYSIS = 'ANALYSIS',
}