import { GoogleGenAI, Type } from "@google/genai";
import { Lap, Track } from '../types';

// Safely initialize the AI client
// Safely initialize the AI client
const getAiClient = () => {
  // Vite exposes env variables via import.meta.env
  const apiKey = import.meta.env.VITE_GEMINI_API_KEY;
  if (!apiKey) {
    console.error("API Key not found. Ensure VITE_GEMINI_API_KEY is set in .env");
    return null;
  }
  return new GoogleGenAI({ apiKey });
};


export interface AnalysisResult {
  tips: string[];
}

export const analyzeLap = async (
  targetLap: Lap,
  idealLap: Lap,
  track: Track
): Promise<AnalysisResult | null> => {
  const ai = getAiClient();
  if (!ai) return { tips: ["API Key missing. Unable to generate analysis."] };

  const summary = {
    track: track.name,
    lapTime: targetLap.time.toFixed(2),
    idealTime: idealLap.time.toFixed(2),
    gap: (targetLap.time - idealLap.time).toFixed(2),
    sectors: targetLap.sectors.map((s, i) => ({
      sector: i + 1,
      time: s.toFixed(2),
      diff: (s - idealLap.sectors[i]).toFixed(2)
    })),
    // Updated for MPH typical speeds
    corners: [
      { name: "Turn 1", userMinSpeed: 55, idealMinSpeed: 62 },
      { name: "Hairpin", userMinSpeed: 28, idealMinSpeed: 34 },
      { name: "Back Straight", userTopSpeed: 145, idealTopSpeed: 149 }
    ]
  };

  const prompt = `
    You are an expert F1-style Race Engineer analyzing GPS-Only telemetry data.
    
    CRITICAL: 
    1. We do NOT have brake pressure or steering angle sensors.
    2. Ignore any CAN_Brake or CAN_Steer columns if referenced in training data.
    
    VIRTUAL SENSOR LOGIC (Strictly Enforced):
    1. Braking is inferred from Longitudinal G-Force (Decel < -0.5g).
    2. Steering is calculated via Lateral G-Force (Speed * Yaw Rate).
    3. The model must infer driver inputs strictly from Velocity and Heading.
    
    Data for ${summary.track}:
    Current Lap: ${summary.lapTime}s
    Optimal Lap: ${summary.idealTime}s
    Gap: +${summary.gap}s

    Sector Analysis:
    ${JSON.stringify(summary.sectors)}

    Corner Analysis (Speed in MPH):
    ${JSON.stringify(summary.corners)}

    Start each tip with a specific reference to the corner or sector (e.g., "T3: ...").
    
    GOAL: The driver wants to break the 2:00 barrier.
    - If Lap Time > 2:00: Identify the HUGE mistakes costing seconds. Be direct.
    - If Lap Time < 2:00: focus on refinement to reach 1:55.
    
    Provide 3 distinct, actionable, and technical coaching tips.
    Adopt a Race Engineer persona (e.g., "Gap is +0.3 in Sector 2", "Braking point Turn 1 needs adjustment").
    Focus on driving lines, braking points (inferred from decel), and corner speeds.
  `;

  try {
    const response = await ai.models.generateContent({
      model: 'fiercefalcon',
      contents: prompt,
      config: {
        responseMimeType: "application/json",
        responseSchema: {
          type: Type.OBJECT,
          properties: {
            tips: {
              type: Type.ARRAY,
              items: { type: Type.STRING }
            }
          }
        }
      }
    });

    const text = response.text;
    if (!text) return { tips: ["No analysis generated."] };
    return JSON.parse(text) as AnalysisResult;
  } catch (error) {
    console.error("Gemini Analysis Error:", error);
    return { tips: ["Error analyzing lap data."] };
  }
};

export const getLiveCoachingTip = async (context: string): Promise<string> => {
  const ai = getAiClient();
  if (!ai) return "Drive smooth.";

  try {
    const response = await ai.models.generateContent({
      model: 'fiercefalcon',
      contents: `You are a F1 Race Engineer. The driver is currently ${context}. Give a VERY SHORT, coded radio command (max 5 words).`,
    });
    return response.text?.trim() || "Push harder.";
  } catch (e) {
    return "Focus forward.";
  }
}

// Convert File to Base64 helper
const fileToGenerativePart = async (file: File): Promise<{ inlineData: { data: string; mimeType: string } }> => {
  const base64EncodedDataPromise = new Promise<string>((resolve) => {
    const reader = new FileReader();
    reader.onloadend = () => {
      if (typeof reader.result === 'string') {
        resolve(reader.result.split(',')[1]);
      }
    };
    reader.readAsDataURL(file);
  });
  return {
    inlineData: { data: await base64EncodedDataPromise, mimeType: file.type },
  };
}

export const analyzeVideo = async (file: File): Promise<string> => {
  const ai = getAiClient();
  if (!ai) return "API Key missing.";

  try {
    const filePart = await fileToGenerativePart(file);

    const response = await ai.models.generateContent({
      model: 'fiercefalcon', // Using fiercefalcon for video analysis
      contents: [
        {
          role: 'user', parts: [
            filePart,
            { text: "Analyze this race track footage. Identify the cornering technique, lines, and any mistakes. Provide 3 bullet points of advice as a Professional Race Coach." }
          ]
        }
      ]
    });

    return response.text?.trim() || "No analysis generated.";

  } catch (error) {
    console.error("Video Analysis Error:", error);
    if (error instanceof Error) {
      return `Error: ${error.message}`;
    }
    return "Error analyzing video. Ensure the file is a valid video format.";
  }
}