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

// Thunderhill (East Loop) - Precise Data
export const MOCK_TRACK: Track = {
  name: "Thunderhill Raceway",
  length: 4612, // From ingestion: 2.866 miles = ~4612m
  zoom: 16,
  center: { lat: 39.540473, lng: -122.331475 },
  sectors: [
    { id: 1, name: 'Sector 1', startDist: 0, endDist: 1500 },
    { id: 2, name: 'Sector 2', startDist: 1500, endDist: 3000 },
    { id: 3, name: 'Sector 3', startDist: 3000, endDist: 4612 },
  ],
  corners: [
    { id: 1, name: 'Turn 1', entryDist: 200, apexDist: 350, exitDist: 500, lat: 39.539283, lon: -122.331360, advice: "Brake early, long left" },
    { id: 2, name: 'Turn 2', entryDist: 850, apexDist: 1000, exitDist: 1150, lat: 39.535989, lon: -122.327133, advice: "Patient throttle, open up" },
    { id: 3, name: 'Turn 3', entryDist: 1400, apexDist: 1550, exitDist: 1700, lat: 39.539355, lon: -122.328895, advice: "Off-camber, stay tight" },
    { id: 4, name: 'The Cyclone', entryDist: 2200, apexDist: 2350, exitDist: 2500, lat: 39.544945, lon: -122.330655, advice: "Blind crest, aim left" },
    { id: 5, name: 'Turn 10', entryDist: 3500, apexDist: 3650, exitDist: 3800, lat: 39.538279, lon: -122.333442, advice: "Fast exit, use track" }
  ],
  // High-Fidelity Map Points (Projected from Lat/Lon)
  mapPoints: [
    { x: -31.9, y: -34.5 },
    { x: 8.1, y: 72.7 },
    { x: 20.3, y: 380.7 },
    { x: 308.4, y: 511.7 },
    { x: 283.2, y: 306.3 },
    { x: 239.8, y: 82 },
    { x: 127.5, y: -131.7 },
    { x: 193.1, y: -408.1 },
    { x: -230.2, y: -452.2 },
    { x: -373.9, y: -122 },
    { x: -283.3, y: 274.8 },
    { x: -113.3, y: 77.2 },
    { x: -115.3, y: -372.4 },
    { x: 21.7, y: -140.4 },
    { x: 25.8, y: 379.5 },
    { x: 394.4, y: 476.8 },
    { x: 174.3, y: 243.4 },
    { x: 197.8, y: -47.8 },
    { x: 231.6, y: -263 },
    { x: -27.1, y: -510 },
    { x: -406.8, y: -262 },
    { x: -348.1, y: 180.2 },
    { x: -161.7, y: 205.3 },
    { x: -117.8, y: -268.7 },
    { x: 26.0, y: -275.7 },
    { x: 17.5, y: 253.5 },
    { x: 250.2, y: 499.4 },
    { x: 302.8, y: 311.1 },
    { x: 241.4, y: 72.6 },
    { x: 137.1, y: -172.8 },
    { x: 136.7, y: -459.9 },
    { x: -305.4, y: -373.9 },
    { x: -355.9, y: -9.6 },
    { x: -197.4, y: 279.9 },
    { x: -114.1, y: -94.9 },
    { x: -19.7, y: -375.5 },
    { x: 22.6, y: 75.5 },
    { x: 174.7, y: 478.3 },
    { x: 372.2, y: 342 },
    { x: 222.3, y: 124.9 },
    { x: 127.7, y: -128.1 },
    { x: 179.9, y: -421 },
    { x: -231.0, y: -441.4 },
    { x: -374.1, y: -120.2 },
    { x: -283.8, y: 275.3 },
    { x: -109.0, y: 60.3 },
    { x: -102.1, y: -386.8 },
    { x: 22.3, y: -88.9 },
    { x: 53.6, y: 421.4 },
    { x: 411.7, y: 439.6 },
    { x: 169.2, y: 208.6 },
    { x: 189.9, y: -63.2 },
    { x: 248.0, y: -285.6 },
    { x: -49.6, y: -509.5 },
    { x: -408.2, y: -255.2 },
    { x: -348.3, y: 184 },
    { x: -155.5, y: 193.2 },
    { x: -119.0, y: -289.5 },
    { x: 25.9, y: -258.2 },
    { x: 17.5, y: 275.4 },
    { x: 315.6, y: 511.2 },
    { x: 238.9, y: 292.9 },
    { x: 232.2, y: 30.8 },
    { x: 160.4, y: -204.5 },
    { x: 101.6, y: -482.7 },
    { x: -335.0, y: -341 },
    { x: -357.6, y: 47.4 },
    { x: -179.8, y: 272.7 },
    { x: -116.1, y: -133.2 },
    { x: 0.1, y: -354 },
    { x: 22.0, y: 122.1 },
    { x: 210.4, y: 486.2 },
    { x: 346.0, y: 325.2 },
    { x: 234.4, y: 110.3 },
    { x: 128.1, y: -135.5 },
    { x: 169.6, y: -429.2 },
    { x: -268.8, y: -407.8 },
    { x: -359.4, y: -47.2 },
    { x: -214.4, y: 281.9 },
    { x: -113.9, y: -56.5 },
    { x: -40.0, y: -388.9 },
  ],
  recordLap: 118.5
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