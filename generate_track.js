
import fs from 'fs';

// Thunderhill Raceway Park (East Loop Approx)
// Lat/Lon waypoints
const waypoints = [
    // Thunderhill East Loop (Approximate High-Fidelity Path)
    [39.536912, -122.321038], // Start/Finish (Front Straight)
    [39.538500, -122.321000], // Front Straight Braking
    [39.540100, -122.321200], // Turn 1 Entry
    [39.540800, -122.322500], // Turn 1 Apex (The long left)
    [39.540700, -122.324500], // Turn 2
    [39.539800, -122.325800], // Turn 3 (Off-camber right)
    [39.539200, -122.326500], // Turn 4 
    [39.538800, -122.327500], // Turn 5 (Cyclone Entry)
    [39.538200, -122.328200], // Turn 5w (Cyclone Top)
    [39.537500, -122.327800], // Turn 5 Exit (Downhill)
    [39.536800, -122.327000], // Turn 6
    [39.536200, -122.326200], // Turn 7
    [39.535500, -122.325500], // Turn 8 (Fast left)
    [39.534800, -122.324000], // Turn 9 (Uphill left)
    [39.535200, -122.322500], // Turn 10
    [39.535800, -122.321800], // Turns 11-13 Complex
    [39.536200, -122.321200], // Turn 14/15 Exit
    [39.536912, -122.321038]  // Close Loop
];

// Catmull-Rom Spline Interpolation function
function getSplinePoint(p0, p1, p2, p3, t) {
    const tt = t * t;
    const ttt = tt * t;

    const q0 = -ttt + 2 * tt - t;
    const q1 = 3 * ttt - 5 * tt + 2;
    const q2 = -3 * ttt + 4 * tt + t;
    const q3 = ttt - tt;

    const lat = 0.5 * (p0[0] * q0 + p1[0] * q1 + p2[0] * q2 + p3[0] * q3);
    const lon = 0.5 * (p0[1] * q0 + p1[1] * q1 + p2[1] * q2 + p3[1] * q3);

    return [lat, lon];
}

const points = [];
const STEPS_PER_SEGMENT = 50;
// Simulate 2-minute lap (120000ms)
// Total segments = waypoints.length - 1 (closed loop handled by duplication logic or just closing it)

// Extend array for spline (wrap around)
const w = [...waypoints];
// Add start/end padding for algo
const fullWaypoints = [w[w.length - 2], ...w, w[1]];

let startTime = Date.now();
let timeOffset = 0;

for (let i = 1; i < fullWaypoints.length - 2; i++) {
    for (let t = 0; t < 1; t += 1 / STEPS_PER_SEGMENT) {
        const p = getSplinePoint(
            fullWaypoints[i - 1],
            fullWaypoints[i],
            fullWaypoints[i + 1],
            fullWaypoints[i + 2],
            t
        );

        // Calculate fake data
        const nextP = getSplinePoint(fullWaypoints[i - 1], fullWaypoints[i], fullWaypoints[i + 1], fullWaypoints[i + 2], t + 0.01);
        // Dist for speed? 
        // Approx speed 40m/s (144kmh)
        const dt = 100; // 100ms

        timeOffset += dt;
        const isoTime = new Date(startTime + timeOffset).toISOString();

        // Format: time,lat,lon,alt,speed,climb,track,mode
        // speed, alt etc are junk defaults for now
        const line = `${isoTime},${p[0].toFixed(8)},${p[1].toFixed(8)},100,40.0,0,0,3`;
        points.push(line);
    }
}

fs.writeFileSync('public/mock_gps.txt', points.join('\n'));
console.log(`Generated ${points.length} points for Thunderhill to public/mock_gps.txt`);
