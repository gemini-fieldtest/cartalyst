
import fs from 'fs';
import path from 'path';

const inputFile = 'thunderhill_data.json';
const outputFile = 'public/mock_gps.txt';

// Basic Physics
const TARGET_SPEED_MPS = 45; // ~100mph avg
const FPS = 10; // 10Hz GPS

function haversineDistance(lat1, lon1, lat2, lon2) {
    const R = 6371e3;
    const φ1 = lat1 * Math.PI / 180;
    const φ2 = lat2 * Math.PI / 180;
    const Δφ = (lat2 - lat1) * Math.PI / 180;
    const Δλ = (lon2 - lon1) * Math.PI / 180;

    const a = Math.sin(Δφ / 2) * Math.sin(Δφ / 2) +
        Math.cos(φ1) * Math.cos(φ2) *
        Math.sin(Δλ / 2) * Math.sin(Δλ / 2);
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));

    return R * c;
}

// Project Lat/Lon to X/Y relative to center
// Scale is arbitrary but must match visualizer expectations
// Center of Thunderhill from constants.ts: 39.536912, -122.321038
// Wait, new data might have a better center. Let's calculate it.
function projectPoints(trackPath) {
    let minLat = 90, maxLat = -90, minLon = 180, maxLon = -180;
    trackPath.forEach(p => {
        const [lat, lon] = p;
        if (lat < minLat) minLat = lat;
        if (lat > maxLat) maxLat = lat;
        if (lon < minLon) minLon = lon;
        if (lon > maxLon) maxLon = lon;
    });

    const centLat = (minLat + maxLat) / 2;
    const centLon = (minLon + maxLon) / 2;

    const points = trackPath.map(p => {
        const [lat, lon] = p;
        // Simple Equirectangular projection
        // x = (lon - centLon) * cos(centLat)
        // y = (lat - centLat)
        // Scale to approx pixels (meters approx)
        const x = (lon - centLon) * 111320 * Math.cos(centLat * Math.PI / 180);
        const y = (lat - centLat) * 110574;

        // Invert Y for screen coords? Visualizers usually have +Y down.
        // Map: +Y is North usually in plotting, but screen is +Y down.
        // Let's stick to Cartesian for now: +Y North.
        return { x: x, y: y };
    });

    return { points, center: { lat: centLat, lon: centLon } };
}

try {
    if (!fs.existsSync(inputFile)) {
        console.error(`Error: ${inputFile} not found. Please create it with the full JSON content.`);
        process.exit(1);
    }

    const rawData = fs.readFileSync(inputFile, 'utf-8');
    const trackData = JSON.parse(rawData);

    // 1. Generate Mock GPS (playback)
    // We assume trackPath is ordered
    // We'll interpolate or step through it
    const trackPath = trackData.configurations[0].trackPath;
    const gpsLines = [];

    let currentTime = Date.now();
    let totalDist = 0;

    for (let i = 0; i < trackPath.length; i++) {
        const p1 = trackPath[i];
        const p2 = trackPath[(i + 1) % trackPath.length];

        const dist = haversineDistance(p1[0], p1[1], p2[0], p2[1]);
        totalDist += dist;

        // Time to cover this segment at constant speed
        const timeSec = dist / TARGET_SPEED_MPS;
        const steps = Math.max(1, Math.ceil(timeSec * FPS));

        for (let s = 0; s < steps; s++) {
            const t = s / steps;
            const lat = p1[0] + (p2[0] - p1[0]) * t;
            const lon = p1[1] + (p2[1] - p1[1]) * t;

            currentTime += (1000 / FPS);
            const iso = new Date(currentTime).toISOString();

            // csv format: time,lat,lon,alt,speed,climb,track,mode
            gpsLines.push(`${iso},${lat.toFixed(8)},${lon.toFixed(8)},100,${TARGET_SPEED_MPS},0,0,3`);
        }
    }

    fs.writeFileSync(outputFile, gpsLines.join('\n'));
    console.log(`Successfully generated ${gpsLines.length} GPS points to ${outputFile}`);

    // 2. Generate Map Points for Constants
    const { points, center } = projectPoints(trackPath);
    console.log('\n--- CONSTANTS.TS SNIPPET ---\n');
    console.log(`center: { lat: ${center.lat.toFixed(6)}, lng: ${center.lon.toFixed(6)} },`);
    console.log('mapPoints: [');
    // Isolate approx 50 points for visualizer to keep it light
    const step = Math.ceil(points.length / 100);
    points.forEach((p, i) => {
        if (i % step === 0) {
            // Shift to positive coords for easy SVG viewing if needed, 
            // but standard TrackVisualizer centers it anyway.
            console.log(`  { x: ${p.x.toFixed(1)}, y: ${-p.y.toFixed(1)} },`); // Invert Y for screen
        }
    });
    console.log('],');
    console.log(`length: ${Math.round(totalDist)},`);

} catch (err) {
    console.error("Processing failed:", err.message);
}
