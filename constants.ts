import { Session, Track, TelemetryPoint, Lap } from './types';

// Helper to generate a sine-wave based track telemetry for demo purposes
// UPDATED: Now strictly implements "Virtual Sensor" logic for GPS-only architecture
const generateTelemetry = (length: number, intensity: number): TelemetryPoint[] => {
  const points: TelemetryPoint[] = [];
  const step = 10; // every 10 meters
  let accumulatedTime = 0;

  // Calculate track shape (approximate oval/circuit for demo)
  // Map 'd' to a position on a loop.
  // Sonoma Raceway Approx Center
  const cx = -122.4540;
  const cy = 38.1615;
  const radiusX = 0.005; // approx 500m in deg
  const radiusY = 0.003;

  for (let d = 0; d <= length; d += step) {
    // Simulate speed based on track position (slowing for "corners")
    const progress = d / length;
    const angle = progress * Math.PI * 2;

    // Simple track shape: Figure 8-ish or Oval to match map points
    // Let's do a squashed oval that matches the "MapPoints" visually roughly
    const xOffset = Math.cos(angle) * 400; // meters
    const yOffset = Math.sin(angle) * 300; // meters

    // Convert meters to Lat/Lon (rough approx)
    // 1 deg Lat = 111000m
    // 1 deg Lon = 111000m * cos(lat)
    const dLat = yOffset / 111000;
    const dLon = xOffset / (111000 * Math.cos(cy * Math.PI / 180));

    const cornerFactor = Math.sin(d / 200) * Math.cos(d / 150);
    // Base calculation in KM/H for physics simulation feel
    const speedKmh = 100 + (cornerFactor * 80) * intensity + (Math.random() * 5);

    // Convert to MPH for display and storage
    const speedMph = speedKmh * 0.621371;

    // Simulate G-forces
    const gLat = Math.sin(d / 100) * 1.5 * intensity;
    const gLong = (cornerFactor < 0 ? -0.8 : 0.4) * intensity; // Braking when corner factor negative

    // VIRTUAL SENSOR LOGIC (GPS-ONLY):
    // Braking is inferred ONLY if Long G < -0.5g (Significant Deceleration)
    const isBraking = gLong < -0.5;
    // Throttle is inferred from positive longitudinal acceleration
    const isThrottle = gLong > 0.1;

    points.push({
      distance: d,
      speed: Math.max(20, speedMph), // Min speed 20 mph
      lat: cy + dLat,
      lng: cx + dLon,
      gLat,
      gLong,
      // Derived strictly from G-Force (GPS derivative)
      throttle: isThrottle ? Math.min(100, gLong * 200) : 0,
      brake: isBraking ? Math.min(100, Math.abs(gLong) * 120) : 0,
      time: accumulatedTime
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

// Sonoma (Demo Track) Approximation from CSV
export const MOCK_TRACK: Track = {
  name: "Sonoma Raceway",
  length: 4000, // Approximate length for Sonoma
  zoom: 15,
  center: { lat: 38.1615, lng: -122.4540 },
  sectors: [
    { id: 1, name: 'Sector 1', startDist: 0, endDist: 1300 },
    { id: 2, name: 'Sector 2', startDist: 1300, endDist: 2700 },
    { id: 3, name: 'Sector 3', startDist: 2700, endDist: 4000 },
  ],
  // Projected X/Y points (approximate loop centered at 350, 250)
  mapPoints: [
    { x: 366, y: 350 },
    { x: 382, y: 330 },
    { x: 398, y: 300 },
    { x: 400, y: 250 },
    { x: 390, y: 200 },
    { x: 370, y: 150 },
    { x: 350, y: 120 },
    { x: 330, y: 150 },
    { x: 310, y: 200 },
    { x: 300, y: 250 },
    { x: 310, y: 300 },
    { x: 330, y: 330 },
    { x: 350, y: 350 },
    { x: 366, y: 350 }
  ],
  recordLap: 108.5
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
      time: amateurTelemetry[amateurTelemetry.length - 1].time,
      valid: true,
      telemetry: amateurTelemetry, // Cold tires
      date: '2023-10-27T10:00:00Z',
      sectors: [24.50, 25.20, 24.50]
    },
    {
      id: 'lap_2',
      lapNumber: 2,
      time: midTelemetry[midTelemetry.length - 1].time,
      valid: true,
      telemetry: midTelemetry,
      date: '2023-10-27T10:01:14Z',
      sectors: [23.80, 24.90, 23.80]
    },
    {
      id: 'lap_3',
      lapNumber: 3,
      time: fastTelemetry[fastTelemetry.length - 1].time, // Personal Best
      valid: true,
      telemetry: fastTelemetry,
      date: '2023-10-27T10:02:26Z',
      sectors: [23.50, 24.10, 23.50]
    },
    {
      id: 'lap_ideal', // Hidden ideal lap for comparison
      lapNumber: 99,
      time: idealTelemetry[idealTelemetry.length - 1].time,
      valid: true,
      telemetry: idealTelemetry,
      date: '2023-10-27T10:00:00Z',
      sectors: [22.00, 23.00, 23.50]
    }
  ]
};