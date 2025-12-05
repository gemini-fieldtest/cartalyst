import { Session, Track, TelemetryPoint, Lap } from './types';

// Helper to generate a sine-wave based track telemetry for demo purposes
const generateTelemetry = (length: number, intensity: number): TelemetryPoint[] => {
  const points: TelemetryPoint[] = [];
  const step = 10; // every 10 meters
  let accumulatedTime = 0;

  for (let d = 0; d <= length; d += step) {
    // Simulate speed based on track position (slowing for "corners")
    const cornerFactor = Math.sin(d / 200) * Math.cos(d / 150);
    // Base calculation in KM/H for physics simulation feel
    const speedKmh = 100 + (cornerFactor * 80) * intensity + (Math.random() * 5);
    
    // Convert to MPH for display and storage
    const speedMph = speedKmh * 0.621371;
    
    // Simulate G-forces
    const gLat = Math.sin(d / 100) * 1.5 * intensity;
    const gLong = (cornerFactor < 0 ? -0.8 : 0.4) * intensity; // Braking when corner factor negative
    
    points.push({
      distance: d,
      speed: Math.max(20, speedMph), // Min speed 20 mph
      lat: 0, // Placeholder
      lng: 0, // Placeholder
      gLat,
      gLong,
      throttle: gLong > 0 ? gLong * 100 : 0,
      brake: gLong < 0 ? Math.abs(gLong) * 100 : 0,
      time: accumulatedTime // Store accumulated time
    });

    // Calculate time for this segment (distance / speed)
    // We need speed in m/s for physics time calculation
    // speedKmh / 3.6 = m/s
    const speedMs = Math.max(10, speedKmh) / 3.6;
    const segmentTime = step / speedMs;
    accumulatedTime += segmentTime;
  }
  return points;
};

export const MOCK_TRACK: Track = {
  name: 'Silverstone International',
  length: 2900,
  sectors: [
    { id: 1, name: 'Sector 1', startDist: 0, endDist: 900 },
    { id: 2, name: 'Sector 2', startDist: 900, endDist: 1900 },
    { id: 3, name: 'Sector 3', startDist: 1900, endDist: 2900 },
  ],
  mapPoints: [
    { x: 50, y: 350 }, { x: 200, y: 350 }, { x: 300, y: 200 }, 
    { x: 400, y: 150 }, { x: 550, y: 150 }, { x: 600, y: 250 },
    { x: 500, y: 400 }, { x: 300, y: 450 }, { x: 100, y: 400 }
  ],
  recordLap: 68.5
};

const idealTelemetry = generateTelemetry(MOCK_TRACK.length, 1.1);
const amateurTelemetry = generateTelemetry(MOCK_TRACK.length, 0.9);
const midTelemetry = generateTelemetry(MOCK_TRACK.length, 0.95);
const fastTelemetry = generateTelemetry(MOCK_TRACK.length, 1.0);

export const MOCK_SESSION: Session = {
  id: 'sess_001',
  trackName: MOCK_TRACK.name,
  date: '2023-10-27',
  weather: 'Sunny',
  trackTemp: 82, // Fahrenheit
  bestLapId: 'lap_3',
  laps: [
    {
      id: 'lap_1',
      lapNumber: 1,
      time: amateurTelemetry[amateurTelemetry.length-1].time,
      valid: true,
      telemetry: amateurTelemetry, // Cold tires
      date: '2023-10-27T10:00:00Z',
      sectors: [24.50, 25.20, 24.50]
    },
    {
      id: 'lap_2',
      lapNumber: 2,
      time: midTelemetry[midTelemetry.length-1].time,
      valid: true,
      telemetry: midTelemetry,
      date: '2023-10-27T10:01:14Z',
      sectors: [23.80, 24.90, 23.80]
    },
    {
      id: 'lap_3',
      lapNumber: 3,
      time: fastTelemetry[fastTelemetry.length-1].time, // Personal Best
      valid: true,
      telemetry: fastTelemetry,
      date: '2023-10-27T10:02:26Z',
      sectors: [23.50, 24.10, 23.50]
    },
    {
      id: 'lap_ideal', // Hidden ideal lap for comparison
      lapNumber: 99,
      time: idealTelemetry[idealTelemetry.length-1].time,
      valid: true,
      telemetry: idealTelemetry,
      date: '2023-10-27T10:00:00Z',
      sectors: [22.00, 23.00, 23.50]
    }
  ]
};