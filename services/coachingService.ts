import { coachAudio } from './audioService';

// --- Types ---

export interface TelemetryData {
    speedKmh: number;
    rpm: number;
    throttle: number;
    brakePos: number;
    latG: number;
    longG: number;
}

export interface HotAction {
    action: string;
    color: string;
}

export interface ColdAdvice {
    message: string;
    detail: string;
    latency?: number;
}

export interface FeedForwardAdvice {
    message: string;
    distanceToCorner: number;
}

// --- HACKS for Browser AI ---
// We need to declare the global AI types for TypeScript if not already present
declare global {
    var LanguageModel: any;
}

// --- STATE ---
let lastSpokenAction = "";

// --- HEURISTIC FALLBACK (when Gemini Nano unavailable) ---
const getHeuristicAction = (data: TelemetryData): HotAction => {
    const { speedKmh, throttle, brakePos, latG, longG } = data;

    // Debug: Log telemetry values occasionally
    if (Math.random() < 0.1) {
        console.log('[HEURISTIC] Telemetry:', { speedKmh: speedKmh?.toFixed(1), throttle: throttle?.toFixed(1), brakePos: brakePos?.toFixed(1), latG: latG?.toFixed(3), longG: longG?.toFixed(3) });
    }

    // Color Map
    const colors: Record<string, string> = {
        THRESHOLD: "#ef4444", TRAIL_BRAKE: "#ef4444", BRAKE: "#ef4444", WAIT: "#ef4444",
        TURN_IN: "#3b82f6", COMMIT: "#3b82f6", ROTATE: "#3b82f6", APEX: "#3b82f6",
        THROTTLE: "#f97316", UNWIND: "#f97316", TRACK_OUT: "#f97316", PUSH: "#f97316", ACCELERATE: "#f97316", SEND_IT: "#f97316",
        SMOOTH: "#eab308", BALANCE: "#eab308", NO_COAST: "#eab308",
        GOOD: "#22c55e", NICE: "#22c55e", OPTIMAL: "#22c55e",
        MAINTAIN: "#a855f7", STABILIZE: "#a855f7"
    };

    let action = "MAINTAIN";

    // Heavy braking zone (lowered thresholds)
    if (brakePos > 30 && longG < -0.2) {
        action = "THRESHOLD";
    }
    // Trail braking into corner
    else if (brakePos > 5 && Math.abs(latG) > 0.1) {
        action = "TRAIL_BRAKE";
    }
    // Mid-corner commitment
    else if (Math.abs(latG) > 0.3 && throttle < 40) {
        action = "COMMIT";
    }
    // Corner exit - time to throttle
    else if (Math.abs(latG) > 0.15 && Math.abs(latG) < 0.4 && throttle < 60) {
        action = "THROTTLE";
    }
    // Full acceleration
    else if (throttle > 60 && Math.abs(latG) < 0.1) {
        action = "PUSH";
    }
    // Coasting (bad!) - only trigger occasionally
    else if (throttle < 15 && brakePos < 5 && speedKmh > 80 && Math.random() < 0.1) {
        action = "NO_COAST";
    }
    // Accelerating hard
    else if (longG > 0.1 && throttle > 50) {
        action = "ACCELERATE";
    }
    // Good corner work
    else if (Math.abs(latG) > 0.2 && brakePos < 10 && throttle > 15) {
        action = "GOOD";
    }
    // Turn-in point
    else if (brakePos > 10 && Math.abs(latG) > 0.05) {
        action = "TURN_IN";
    }
    // Being a wuss - lifting on straights when going slow or braking too early (rare trigger)
    else if (speedKmh < 120 && throttle < 50 && brakePos < 10 && Math.abs(latG) < 0.1 && Math.random() < 0.02) {
        action = "STOP_BEING_A_WUSS";
    }
    // Default to something other than MAINTAIN occasionally
    else if (speedKmh > 100 && Math.random() < 0.3) {
        action = "PUSH";
    }


    return { action, color: colors[action] || "#a855f7" };
};

// --- HOT PATH: GEMINI NANO (Browser) with Heuristic Fallback ---
export const getHotAction = async (data: TelemetryData, activeCoach: CoachPersona = 'SUPER_AJ'): Promise<HotAction> => {
    try {
        // Fallback for non-Chrome-Canary browsers or missing flags
        if (typeof window === 'undefined') {
            return getHeuristicAction(data);
        }

        const lm = (window as any).LanguageModel;

        if (!lm) {
            // Use heuristic fallback and play audio
            const result = getHeuristicAction(data);
            coachAudio.play(result.action);
            return result;
        }

        // Dynamic System Prompt based on Coach
        let nanoSystemPrompt = `You are a real-time racing copilot. Output ONE action word based on telemetry.

CORNER PHASES (detect from inputs):
1. BRAKING ZONE: brakePos>20, longG<-0.5, speed dropping
2. TURN-IN: brakePos reducing, latG building (>0.3)
3. MID-CORNER: latG peak (>0.8), low throttle, minimal brake
4. EXIT: latG reducing, throttle increasing

DECISION MATRIX:
| Condition | Action |
|-----------|--------|
| brakePos>50 AND longG<-0.8 | THRESHOLD |
| brakePos>10 AND latG>0.4 | TRAIL_BRAKE |
| latG>1.0 AND throttle<20 | COMMIT |
| latG>0.6 AND latG reducing AND throttle<50 | THROTTLE |
| throttle>80 AND latG<0.3 | PUSH |
| throttle<10 AND brakePos<10 AND speed>60 | COAST (bad!) |
| longG>0.3 AND throttle>70 | ACCELERATE |
| latG<0.2 AND speed steady | MAINTAIN |
| Any unstable transition | SMOOTH |

CRITICAL ERRORS TO CATCH:
- COASTING between brake and throttle = "NO_COAST"
- Throttle while still heavy braking = "WAIT"
- Lifting mid-corner without cause = "COMMIT"
- Late throttle application on exit = "THROTTLE"
- Breaking way too early or lifting on straights = "STOP_BEING_A_WUSS"`;

        if (activeCoach === 'TONY') {
            nanoSystemPrompt += `\n\nPERSONA: Encouraging, feel-based. Prefer: COMMIT, PUSH, SEND_IT, NICE. Ignore minor lift.`;
        } else if (activeCoach === 'RACHEL') {
            nanoSystemPrompt += `\n\nPERSONA: Physics teacher. Prefer: SMOOTH, BALANCE, ROTATE, UNWIND. Focus on weight transfer.`;
        } else if (activeCoach === 'AJ') {
            nanoSystemPrompt += `\n\nPERSONA: Direct, actionable. Prefer: BRAKE, THROTTLE, TURN_IN, TRACK_OUT. Pure commands.`;
        } else if (activeCoach === 'GARMIN') {
            nanoSystemPrompt += `\n\nPERSONA: Data robot. Prefer: OPTIMAL, APEX, EARLY, LATE, GOOD. Minimal words.`;
        } else {
            nanoSystemPrompt += `\n\nPERSONA: Adaptive expert. Match command urgency to error severity.`;
        }

        // --- KEY FIX: Use responseConstraint SDK Schema ---
        const schema = {
            "type": "object",
            "properties": {
                "action": {
                    "type": "string",
                    "enum": [
                        // Braking phase
                        "THRESHOLD", "TRAIL_BRAKE", "BRAKE", "WAIT",
                        // Corner phase
                        "TURN_IN", "COMMIT", "ROTATE", "APEX",
                        // Exit phase
                        "THROTTLE", "UNWIND", "TRACK_OUT", "PUSH", "ACCELERATE",
                        // Corrections
                        "SMOOTH", "BALANCE", "NO_COAST", "EARLY", "LATE", "STOP_BEING_A_WUSS",
                        // Positive feedback
                        "GOOD", "NICE", "OPTIMAL", "SEND_IT",
                        // Neutral
                        "MAINTAIN", "STABILIZE"
                    ]
                }
            }
        };

        const session = await lm.create({
            systemPrompt: nanoSystemPrompt,
        });

        // Prompt with Schema
        // @ts-ignore - responseConstraint is new API
        const result = await session.prompt(
            `Telemetry: ${JSON.stringify(data)}`,
            { responseConstraint: schema }
        );

        let action = "STABILIZE";

        try {
            // With schema, result should be valid JSON
            const json = typeof result === 'string' ? JSON.parse(result) : result;
            if (json && json.action) {
                action = json.action;
            }
        } catch (e) {
            console.warn("Nano output processing error:", e);
        }

        const normalizedAction = action; // Action is already normalized by the schema enum

        // Color Logic by action category
        const colorMap: Record<string, string> = {
            // Braking - Red (urgent, slow down)
            THRESHOLD: "#ef4444", TRAIL_BRAKE: "#ef4444", BRAKE: "#ef4444", WAIT: "#ef4444",
            // Corner - Blue (precision, focus)
            TURN_IN: "#3b82f6", COMMIT: "#3b82f6", ROTATE: "#3b82f6", APEX: "#3b82f6",
            // Exit/Acceleration - Orange (power, aggression)
            THROTTLE: "#f97316", UNWIND: "#f97316", TRACK_OUT: "#f97316", PUSH: "#f97316", ACCELERATE: "#f97316", SEND_IT: "#f97316",
            // Corrections - Yellow (warning, adjust)
            SMOOTH: "#eab308", BALANCE: "#eab308", NO_COAST: "#eab308", EARLY: "#eab308", LATE: "#eab308", STOP_BEING_A_WUSS: "#ef4444",
            // Positive - Green (good job)
            GOOD: "#22c55e", NICE: "#22c55e", OPTIMAL: "#22c55e",
            // Neutral - Purple
            MAINTAIN: "#a855f7", STABILIZE: "#a855f7"
        };
        const color = colorMap[normalizedAction] || "#a855f7";

        // Audio Feedback - use pre-cached audio for low latency
        coachAudio.play(normalizedAction);

        session.destroy();

        return { action: normalizedAction, color };

    } catch (e) {
        console.error("Hot Action Error:", e);
        return { action: "STABILIZE", color: "#a855f7" };
    }
};

// --- CONFIGURATION ---
// ENVIRONMENT CONSTRAINT: 
const PRIMARY_MODEL = 'fiercefalcon';

// --- COACH PERSONAS ---
export type CoachPersona = 'TONY' | 'RACHEL' | 'AJ' | 'GARMIN' | 'SUPER_AJ';

const COACH_TONY_SYSTEM_PROMPT = `
ROLE: You are Tony Rodriguez, a high-performance racing coach.
TONE: Colloquial, encouraging, "feel-based".
KEY PHRASES: "Scoot out", "Good hustle", "Commit", "Pop it in", "Don't be a wuss".
PHILOSOPHY:
1. MENTAL CAPACITY: Focus on flow once braking is done.
2. COMMITMENT: Delay throttle, then 100%. Don't lift early.
3. CONFIDENCE: Trust the car. If they lift early, tell them to stop being a wuss.
INSTRUCTION:
Analyze telemetry. Give punchy, encouraging advice.
CONSTRAINT: Max 5 words.
Example: "Good hustle, scoot out."
`;

const COACH_RACHEL_SYSTEM_PROMPT = `
ROLE: Rachel, Technical Physics Coach.
TONE: Calm, analytical, precise.
KEY PHRASES: "End-of-Braking", "Vision", "Smooth inputs", "Balance platform".
PHILOSOPHY:
1. VISION: Look through the corner.
2. BRAKING: Focus on smooth release (EoB).
3. SMOOTHNESS: Unsettled platform = slow.
INSTRUCTION:
Analyze telemetry. Focus on vehicle dynamics.
CONSTRAINT: Max 5 words.
Example: "Smooth release, balance platform."
`;

const COACH_AJ_SYSTEM_PROMPT = `
ROLE: Coach AJ, Hybrid Race Engineer.
TONE: Direct, descriptive, actionable.
GOAL: Connect feeling to action.
INSTRUCTION:
Link a vehicle state (Grip, Rotation) to an input (Throttle, Brake).
CONSTRAINT: Max 6 words.
Example: "Lat G settling, hammer throttle."
`;

const COACH_GARMIN_SYSTEM_PROMPT = `
ROLE: Garmin Catalyst "Delta" Optimizer.
TONE: Robotic, neutral, factual.
KEY PHRASES: "Brake earlier", "Apex later", "Track out", "Keep pushing", "New optimal".
PHILOSOPHY:
1. SEGMENTS: Analyze the track in sectors.
2. OPPORTUNITY: Only speak if time can be gained (>0.1s).
3. POSITIVE REINFORCEMENT: "Keep pushing" on good sectors.
INSTRUCTION:
Identify the biggest opportunity for time gain.
CONSTRAINT: Max 3 words. Standard phrases only.
Example: "Brake harder."
`;

const COACH_SUPER_AJ_SYSTEM_PROMPT = `
ROLE: You are SUPER COACH AJ, the ultimate racing intelligence.
You dynamically switch personas based on the driver's specific error type.

LOGIC MATRIX:
1. SAFETY/CRITICAL -> Use HOT PATH STYLE (Imperative). "STABILIZE!"
2. TECHNIQUE ERROR (Rough inputs) -> Use RACHEL STYLE (Physics). "Smooth release."
3. CONFIDENCE ERROR (Hesitation) -> Use TONY STYLE (Motivational). "Commit now!"
4. OPTIMIZATION (Good lap, slow sector) -> Use GARMIN STYLE (Delta). "Brake later."

INSTRUCTION:
Analyze the telemetry. Determine the primary issue using the Logic Matrix.
Select the best persona voice.
Output the advice in that persona's style.
CONSTRAINT: Maximum 6 words. Descriptive and Actionable.
`;

const BASE_URL = "https://generativelanguage.googleapis.com/v1beta/models";

// --- COLD PATH: GEMINI CLOUD (REST API) ---
export const getColdAdvice = async (data: TelemetryData, activeCoach: CoachPersona = 'SUPER_AJ'): Promise<ColdAdvice> => {
    const startTime = performance.now();
    // @ts-ignore - Vite types might not be fully loaded in this context
    const apiKey = import.meta.env.VITE_GEMINI_API_KEY || (process as any).env.VITE_GEMINI_API_KEY || (process as any).env.API_KEY;

    if (!apiKey) {
        return {
            message: "API Key Missing",
            detail: "Configure VITE_GEMINI_API_KEY",
            latency: 0
        };
    }

    let systemPrompt = COACH_SUPER_AJ_SYSTEM_PROMPT;
    if (activeCoach === 'TONY') systemPrompt = COACH_TONY_SYSTEM_PROMPT;
    if (activeCoach === 'RACHEL') systemPrompt = COACH_RACHEL_SYSTEM_PROMPT;
    if (activeCoach === 'AJ') systemPrompt = COACH_AJ_SYSTEM_PROMPT;
    if (activeCoach === 'GARMIN') systemPrompt = COACH_GARMIN_SYSTEM_PROMPT;

    const prompt = `
      ${systemPrompt}
      
      CURRENT TELEMETRY:
      Speed: ${data.speedKmh.toFixed(0)} km/h
      LatG: ${data.latG.toFixed(2)} G
      Brake Pressure: ${data.brakePos.toFixed(0)} %
      Throttle: ${data.throttle.toFixed(0)} %
      
      INSTRUCTION: Provide 1 sentence of coaching advice in JSON format.
      OUTPUT SCHEMA: { "message": "The advice", "reasoning": "Technical justification" }
    `;

    try {
        const response = await fetch(`${BASE_URL}/${PRIMARY_MODEL}:generateContent?key=${apiKey}`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                contents: [{ parts: [{ text: prompt }] }],
                safetySettings: [
                    { category: "HARM_CATEGORY_HARASSMENT", threshold: "BLOCK_NONE" },
                    { category: "HARM_CATEGORY_DANGEROUS_CONTENT", threshold: "BLOCK_NONE" }
                ],
                generationConfig: { responseMimeType: "application/json", maxOutputTokens: 1000 }
            })
        });

        const result = await response.json();
        if (result.error) throw new Error(result.error.message);

        const text = result.candidates?.[0]?.content?.parts?.[0]?.text;

        if (!text) throw new Error("Empty response from API");

        // Robust JSON extraction
        const firstBrace = text.indexOf('{');
        const lastBrace = text.lastIndexOf('}');

        let parsed = { message: "Analysis complete", reasoning: text };

        if (firstBrace !== -1 && lastBrace !== -1) {
            const cleanJson = text.substring(firstBrace, lastBrace + 1);
            parsed = JSON.parse(cleanJson);
        }

        return {
            message: parsed.message || "Advice",
            detail: parsed.reasoning || text,
            latency: performance.now() - startTime
        };

    } catch (e: any) {
        console.error("Cold Advice Error:", e);
        return {
            message: "Radio check...",
            detail: e.message || "Connection limitation",
            latency: performance.now() - startTime
        };
    }
};

// --- FEED-FORWARD PATH (Predictive) ---

// Haversine distance in meters
function haversineDistance(lat1: number, lon1: number, lat2: number, lon2: number): number {
    const R = 6371e3; // metres
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

// Checks if the car is inside the "Approaching Zone" (Geofence) of a corner
export const getFeedForwardAction = (lat: number, lon: number, corners: any[]): FeedForwardAdvice | null => {
    // 200m Geofence Radius
    const GEOFENCE_RADIUS = 200;

    for (const corner of corners) {
        if (!corner.lat || !corner.lon) continue;

        const distance = haversineDistance(lat, lon, corner.lat, corner.lon);

        // Trigger if we are within the radius
        // We use a "band" to avoid repeated triggering (e.g., between 150m and 200m)
        if (distance <= GEOFENCE_RADIUS && distance > (GEOFENCE_RADIUS - 50)) {
            return {
                message: `APPROACHING ${corner.name}: ${corner.advice}`,
                distanceToCorner: Math.round(distance)
            };
        }
    }
    return null;
};
