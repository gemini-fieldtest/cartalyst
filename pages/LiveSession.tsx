import React, { useState, useEffect, useRef, useMemo } from 'react';
import { GoogleMapsTrack } from '../components/GoogleMapsTrack';
import { Play, Square, Mic, MicOff, Radio, LocateFixed, MapPin, AlertTriangle, Settings, Key } from 'lucide-react';
import { MOCK_TRACK, MOCK_SESSION } from '../constants';
import { GoogleGenAI, LiveServerMessage, Modality } from "@google/genai";
import { Lap, TelemetryPoint, Track, SSEConnectionStatus } from '../types';
import { GpsSSEService } from '../services/gpsService';

const GPS_SSE_URL = '/mock_gps.txt'; // Using local mock file

// --- Audio Helpers ---

function encode(bytes: Uint8Array) {
  let binary = '';
  const len = bytes.byteLength;
  for (let i = 0; i < len; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary);
}

function decode(base64: string) {
  const binaryString = atob(base64);
  const len = binaryString.length;
  const bytes = new Uint8Array(len);
  for (let i = 0; i < len; i++) {
    bytes[i] = binaryString.charCodeAt(i);
  }
  return bytes;
}

function createBlob(data: Float32Array): { data: string; mimeType: string } {
  const l = data.length;
  const int16 = new Int16Array(l);
  for (let i = 0; i < l; i++) {
    // PCM 16-bit conversion
    int16[i] = Math.max(-1, Math.min(1, data[i])) * 32768;
  }
  return {
    data: encode(new Uint8Array(int16.buffer)),
    mimeType: 'audio/pcm;rate=16000',
  };
}

async function decodeAudioData(
  data: Uint8Array,
  ctx: AudioContext,
  sampleRate: number,
  numChannels: number,
): Promise<AudioBuffer> {
  const dataInt16 = new Int16Array(data.buffer);
  const frameCount = dataInt16.length / numChannels;
  const buffer = ctx.createBuffer(numChannels, frameCount, sampleRate);

  for (let channel = 0; channel < numChannels; channel++) {
    const channelData = buffer.getChannelData(channel);
    for (let i = 0; i < frameCount; i++) {
      channelData[i] = dataInt16[i * numChannels + channel] / 32768.0;
    }
  }
  return buffer;
}

// Synthesize a brief "thump" sound for G-force feedback
function playGForceCue(ctx: AudioContext, type: 'corner' | 'brake') {
  const osc = ctx.createOscillator();
  const gain = ctx.createGain();

  osc.connect(gain);
  gain.connect(ctx.destination);

  const now = ctx.currentTime;

  if (type === 'corner') {
    // Low frequency thud for cornering load
    osc.frequency.setValueAtTime(60, now);
    osc.frequency.exponentialRampToValueAtTime(10, now + 0.15);

    gain.gain.setValueAtTime(0.2, now);
    gain.gain.exponentialRampToValueAtTime(0.001, now + 0.15);

    osc.start(now);
    osc.stop(now + 0.15);
  } else {
    // Slightly higher/sharper thud for heavy braking
    osc.frequency.setValueAtTime(80, now);
    osc.frequency.exponentialRampToValueAtTime(20, now + 0.1);

    gain.gain.setValueAtTime(0.15, now);
    gain.gain.exponentialRampToValueAtTime(0.001, now + 0.1);

    osc.start(now);
    osc.stop(now + 0.1);
  }
}

// --- Components ---

const VoiceClue: React.FC = () => {
  const clues = [
    "Radio: 'Gap to Target'",
    "Radio: 'Check Tires'",
    "Radio: 'Sector Status'",
    "Radio: 'Box Box'"
  ];
  const [index, setIndex] = useState(0);

  useEffect(() => {
    const i = setInterval(() => {
      setIndex(prev => (prev + 1) % clues.length);
    }, 8000);
    return () => clearInterval(i);
  }, []);

  return (
    <div className="animate-fade-in-up text-center">
      <p className="text-[10px] text-sky-400 font-bold uppercase tracking-widest opacity-80 mb-1">Radio Comm</p>
      <p className="text-sm font-mono text-white bg-slate-900/50 px-3 py-1 rounded-full border border-sky-500/20 shadow-lg backdrop-blur">
        {clues[index]}
      </p>
    </div>
  );
};

const GForceGauge: React.FC<{ lat: number; long: number }> = ({ lat, long }) => {
  const MAX_G = 2.0;
  const clampedLat = Math.max(-MAX_G, Math.min(MAX_G, lat));
  const clampedLong = Math.max(-MAX_G, Math.min(MAX_G, long));

  // Determine virtual sensor states
  // Braking = significant negative longitudinal G
  const isBraking = long < -0.5;
  const isAccel = long > 0.1;

  const xPos = 50 + (clampedLat / MAX_G) * 50;
  const yPos = 50 - (clampedLong / MAX_G) * 50;

  return (
    <div className="w-20 h-20 md:w-32 md:h-32 relative group cursor-default pointer-events-none select-none transition-all">
      {/* Background/Dial */}
      <div className={`absolute inset-0 backdrop-blur-md rounded-full border shadow-xl overflow-hidden transition-colors duration-200 ${isBraking ? 'bg-rose-900/40 border-rose-500/50' : 'bg-slate-900/80 border-slate-700'}`}>
        {/* Grid Circles */}
        <div className="absolute inset-0 m-[15%] border border-slate-700/50 rounded-full" />
        <div className="absolute inset-0 m-[48%] bg-slate-800/50 rounded-full" />

        {/* Axes */}
        <div className="absolute top-0 bottom-0 left-1/2 w-px bg-slate-700/50" />
        <div className="absolute left-0 right-0 top-1/2 h-px bg-slate-700/50" />

        {/* Labels */}
        <div className="hidden md:block absolute top-2 left-1/2 -translate-x-1/2 text-[8px] font-bold text-slate-500 tracking-wider">ACCEL</div>
        <div className={`hidden md:block absolute bottom-2 left-1/2 -translate-x-1/2 text-[8px] font-bold tracking-wider ${isBraking ? 'text-rose-500 animate-pulse' : 'text-slate-500'}`}>BRAKE</div>

        {/* The Puck */}
        <div
          className={`absolute w-3 h-3 md:w-4 md:h-4 rounded-full border-2 border-white shadow-[0_0_15px] transition-transform duration-100 ease-linear will-change-transform z-10 ${isBraking ? 'bg-rose-500 shadow-rose-500' : 'bg-sky-500 shadow-sky-500'
            }`}
          style={{
            left: `${xPos}%`,
            top: `${yPos}%`,
            transform: 'translate(-50%, -50%)'
          }}
        />
      </div>
    </div>
  );
};

export const LiveSession: React.FC = () => {
  const [useRealGps, setUseRealGps] = useState(false);
  const [isActive, setIsActive] = useState(false);
  const [gpsError, setGpsError] = useState<string | null>(null);
  const [sseStatus, setSseStatus] = useState<SSEConnectionStatus>('disconnected');
  const gpsServiceRef = useRef<GpsSSEService | null>(null);

  // Google Maps State
  const [mapsKey, setMapsKey] = useState(() => localStorage.getItem('GOOGLE_MAPS_KEY') || '');
  const [showKeyModal, setShowKeyModal] = useState(false);
  const [currentPos, setCurrentPos] = useState<{ lat: number; lng: number } | null>(null);

  // Telemetry State
  const [speed, setSpeed] = useState(0);
  const [lapTime, setLapTime] = useState(0);
  const [progress, setProgress] = useState(0);
  const [ghostProgress, setGhostProgress] = useState(0);
  const [currentLap, setCurrentLap] = useState(1);
  const [delta, setDelta] = useState(0);
  const [gLat, setGLat] = useState(0);
  const [gLong, setGLong] = useState(0);

  // Real GPS Data Buffer
  const [gpsPoints, setGpsPoints] = useState<{ x: number, y: number }[]>([]);
  const lastGpsUpdateRef = useRef<number>(0);
  const lastGpsSpeedRef = useRef<number>(0);

  const lastGpsHeadingRef = useRef<number>(0);
  const gpsOffsetRef = useRef<{ lat: number, lon: number } | null>(null);

  // Audio & AI Refs
  const isVoiceConnectedRef = useRef(false);
  const [voiceStatus, setVoiceStatus] = useState<'disconnected' | 'connecting' | 'connected' | 'error'>('disconnected');

  // Animation Refs
  const requestRef = useRef<number>(0);
  const startTimeRef = useRef<number>(0);
  const speedRef = useRef<number>(0);
  const deltaRef = useRef<number>(0);
  const gLatRef = useRef<number>(0);
  const gLongRef = useRef<number>(0);
  const currentLapRef = useRef<number>(1);
  const currentSectorRef = useRef<number>(1);
  const currentDistRef = useRef<number>(0);
  const lapTimeRef = useRef<number>(0);

  // Audio Context Refs
  const inputContextRef = useRef<AudioContext | null>(null);
  const outputContextRef = useRef<AudioContext | null>(null);
  const outputNodeRef = useRef<GainNode | null>(null);
  const audioStreamRef = useRef<MediaStream | null>(null);
  const processorRef = useRef<ScriptProcessorNode | null>(null);
  const nextStartTimeRef = useRef<number>(0);
  const sessionPromiseRef = useRef<Promise<any> | null>(null);
  const sourcesRef = useRef<Set<AudioBufferSourceNode>>(new Set());
  const lastAudioCueTime = useRef<number>(0);
  const watchIdRef = useRef<number | null>(null);

  // --- Track Logic ---
  // In Simulation: Use Mock Track.
  // In Real GPS: Use the breadcrumbs collected so far.
  const activeTrack: Track = useMemo(() => {
    if (!useRealGps) return MOCK_TRACK;

    // Convert GPS points to a simplified track structure on the fly
    if (gpsPoints.length < 2) return MOCK_TRACK; // Fallback until we have data

    return {
      ...MOCK_TRACK,
      mapPoints: gpsPoints,
      length: gpsPoints.length * 10 // Approximate scale
    };
  }, [useRealGps, gpsPoints]);


  // --- Simulation Mode ---
  const userLap = MOCK_SESSION.laps.find(l => l.id === 'lap_1') || MOCK_SESSION.laps[0];
  const idealLap = MOCK_SESSION.laps.find(l => l.id === 'lap_ideal') || MOCK_SESSION.laps[0];

  const getTelemetryAtTime = (lap: Lap, t: number) => {
    const data = lap.telemetry;
    let idx = data.findIndex(p => p.time > t);

    if (idx === -1) idx = data.length - 1;
    if (idx === 0) return data[0];

    const p1 = data[idx - 1];
    const p2 = data[idx];
    const range = p2.time - p1.time;
    const ratio = range > 0 ? (t - p1.time) / range : 0;

    return {
      distance: p1.distance + (p2.distance - p1.distance) * ratio,
      speed: p1.speed + (p2.speed - p1.speed) * ratio,
      gLat: p1.gLat + (p2.gLat - p1.gLat) * ratio,
      gLong: p1.gLong + (p2.gLong - p1.gLong) * ratio,
      lat: p1.lat + (p2.lat - p1.lat) * ratio,
      lng: p1.lng + (p2.lng - p1.lng) * ratio,
      time: t
    };
  };

  const getSector = (dist: number) => {
    return MOCK_TRACK.sectors.find(s => dist >= s.startDist && dist < s.endDist)?.id || 1;
  };

  // --- Main Animation Loop ---
  const animate = (timestamp: number) => {
    // If using Real GPS, we don't use the simulation loop for physics.
    // We only use this loop to update the Timer and UI interpolation if needed.
    if (useRealGps) {
      if (isActive && startTimeRef.current === 0) startTimeRef.current = timestamp;

      const elapsedTotal = isActive ? (timestamp - startTimeRef.current) : 0;
      const currentLapTimeSec = elapsedTotal / 1000;
      setLapTime(currentLapTimeSec);
      lapTimeRef.current = currentLapTimeSec;

      // In Real Mode, physics update happens in the Geolocation Callback.
      // We just ensure the Refs are up to date for the UI
      requestRef.current = requestAnimationFrame(animate);
      return;
    }

    // --- Simulation Mode ---
    if (!startTimeRef.current) startTimeRef.current = timestamp;
    const elapsedTotal = (timestamp - startTimeRef.current);

    const lapDurationMs = userLap.time * 1000;
    const currentLapTimeMs = elapsedTotal % lapDurationMs;
    const currentLapTimeSec = currentLapTimeMs / 1000;

    const userState = getTelemetryAtTime(userLap, currentLapTimeSec);
    const userProgress = userState.distance / MOCK_TRACK.length;

    // Ghost (Ideal Lap) logic - NOW PHYSICS BASED
    // We get the actual position of the Ideal Lap at this timestamp
    const ghostState = getTelemetryAtTime(idealLap, currentLapTimeSec);
    const ghostProgress = ghostState.distance / MOCK_TRACK.length;

    // Calc Delta
    // Compare where I am vs where I should be at this time
    // If I'm at 100m, and at this time the Ideal Lap was at 120m, I am behind.
    // Delta ~ Distance Diff / Speed
    const distDiff = userState.distance - ghostState.distance;
    const currentSpeedMs = Math.max(10, userState.speed) * 0.44704; // mph to m/s
    const calcDelta = distDiff / currentSpeedMs;

    setProgress(Math.min(1, Math.max(0, userProgress)));
    setGhostProgress(Math.min(1, Math.max(0, ghostProgress)));
    setCurrentPos({ lat: userState.lat, lng: userState.lng });

    // Update State
    setSpeed(Math.round(userState.speed));
    setGLat(userState.gLat);
    setGLong(userState.gLong);
    setLapTime(currentLapTimeSec);
    setDelta(calcDelta);

    // Update Refs for Audio/AI
    speedRef.current = Math.round(userState.speed);
    gLatRef.current = userState.gLat;
    gLongRef.current = userState.gLong;
    deltaRef.current = calcDelta;
    currentSectorRef.current = getSector(userState.distance);
    currentDistRef.current = Math.round(userState.distance);
    lapTimeRef.current = currentLapTimeSec;

    handleAudioCues(userState.gLat, userState.gLong);

    const newLap = Math.floor(elapsedTotal / lapDurationMs) + 1;
    if (newLap !== currentLapRef.current) {
      currentLapRef.current = newLap;
      setCurrentLap(newLap);
    }

    requestRef.current = requestAnimationFrame(animate);
  };

  const handleAudioCues = (lat: number, long: number) => {
    if (isVoiceConnectedRef.current && outputContextRef.current) {
      const now = performance.now();
      if (now - lastAudioCueTime.current > 3000) {
        if (Math.abs(lat) > 1.35) {
          playGForceCue(outputContextRef.current, 'corner');
          lastAudioCueTime.current = now;
        } else if (long < -0.8) {
          playGForceCue(outputContextRef.current, 'brake');
          lastAudioCueTime.current = now;
        }
      }
    }
  };

  // --- GPS Physics Engine (SSE Implementation) ---
  useEffect(() => {
    if (useRealGps && isActive) {
      setGpsError(null);

      const service = new GpsSSEService(GPS_SSE_URL);
      gpsServiceRef.current = service;

      service.connect(
        (point) => {
          const now = new Date(point.time).getTime(); // Use packet time for sync if possible
          const arrivalTime = Date.now();

          // AUTO-TRANSPOSE LOGIC: 
          // If this is the first point (or offset is null) AND we have a track center,
          // check if we are far away (>10km). If so, calculate offset to move car to track.
          if (!gpsOffsetRef.current && activeTrack.center) {
            const dist = Math.sqrt(Math.pow(point.lat - activeTrack.center.lat, 2) + Math.pow(point.lon - activeTrack.center.lng, 2));
            // Simple deg distance check. 0.1 deg ~ 11km.
            if (dist > 0.1) {
              console.log("GPS mismatch detected. Auto-transposing to Track Center.");
              gpsOffsetRef.current = {
                lat: activeTrack.center.lat - point.lat,
                lon: activeTrack.center.lng - point.lon
              };
            } else {
              gpsOffsetRef.current = { lat: 0, lon: 0 };
            }
          }

          const offset = gpsOffsetRef.current || { lat: 0, lon: 0 };
          const effectiveLat = point.lat + offset.lat;
          const effectiveLon = point.lon + offset.lon;

          // 1. Calculate Time Delta (dt)
          // Use packet timestamp if available and reliable, otherwise use arrival time?
          // For smooth physics, using arrival time (performance.now) might be better if packets are real-time.
          // But let's use the packet time to handle out-of-order slightly better if needed.
          // Actually, let's stick to arrival time delta for simplicity unless we buffer.
          const dt = (arrivalTime - lastGpsUpdateRef.current) / 1000;

          // 2. Speed
          // SSE gives speed in m/s
          const speedMs = point.speed;
          const speedMph = speedMs * 2.23694;

          // 3. Longitudinal G (Acceleration/Braking)
          // a = dv / dt
          // Note: point.climb is vertical speed, not accel. 
          // We can calculate accel from speed change.
          const dv = speedMs - lastGpsSpeedRef.current;
          // Avoid division by zero or huge jumps on first packet
          const accelMs2 = (dt > 0 && dt < 1) ? dv / dt : 0;
          const longG = accelMs2 / 9.81;

          // 4. Lateral G (Cornering)
          // a = v * omega (Yaw Rate)
          // Yaw Rate = dHeading / dt
          let dHeading = point.track - lastGpsHeadingRef.current;
          // Handle 359->1 degree wrap
          if (dHeading > 180) dHeading -= 360;
          if (dHeading < -180) dHeading += 360;

          const yawRateRadS = (dt > 0 && dt < 1) ? (dHeading * (Math.PI / 180)) / dt : 0;
          const latAccelMs2 = speedMs * yawRateRadS;
          const latG = latAccelMs2 / 9.81;

          // 5. Update State &
          setSpeed(Math.round(speedMph));

          // EMA Filter
          const alpha = 0.3;
          const smoothLongG = (longG * alpha) + (gLongRef.current * (1 - alpha));
          const smoothLatG = (latG * alpha) + (gLatRef.current * (1 - alpha));

          setGLat(smoothLatG);
          setGLong(smoothLongG);
          setCurrentPos({ lat: effectiveLat, lng: effectiveLon });

          speedRef.current = Math.round(speedMph);
          gLatRef.current = smoothLatG;
          gLongRef.current = smoothLongG;

          // Visualizer Update (Legacy points array - optional now)
          setGpsPoints(prev => {
            // Simple scaling for demo - in real app use map projection
            const newP = { x: (point.lon + 180) * 50, y: (point.lat + 90) * 50 };
            const next = [...prev, newP];
            if (next.length > 200) return next.slice(next.length - 200);
            return next;
          });

          // Update history
          lastGpsUpdateRef.current = arrivalTime;
          lastGpsSpeedRef.current = speedMs;
          lastGpsHeadingRef.current = point.track;

          handleAudioCues(smoothLatG, smoothLongG);
        },
        (status) => {
          setSseStatus(status);
          if (status === 'connected') setGpsError(null);
        },
        (err) => {
          setGpsError(err);
        }
      );

    } else {
      // Cleanup
      if (gpsServiceRef.current) {
        gpsServiceRef.current.disconnect();
        gpsServiceRef.current = null;
      }
      if (!isActive) {
        setGpsError(null);
        setSseStatus('disconnected');
      }
    }

    return () => {
      if (gpsServiceRef.current) {
        gpsServiceRef.current.disconnect();
      }
    };
  }, [useRealGps, isActive]);

  useEffect(() => {
    if (isActive) {
      startTimeRef.current = 0; // Reset timer on start
      requestRef.current = requestAnimationFrame(animate);
    } else {
      cancelAnimationFrame(requestRef.current);
      // Reset Telemetry display
      setGLat(0);
      setGLong(0);
      setSpeed(0);
    }
    return () => cancelAnimationFrame(requestRef.current);
  }, [isActive, useRealGps]);

  // --- Voice Connection Logic (Same as before) ---
  const connectToVoiceCoach = async () => {
    if (isVoiceConnectedRef.current || voiceStatus === 'connecting') return;

    try {
      setVoiceStatus('connecting');
      const apiKey = process.env.API_KEY;
      if (!apiKey) throw new Error("API Key missing");

      const ai = new GoogleGenAI({ apiKey });

      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      audioStreamRef.current = stream;

      const inputContext = new (window.AudioContext || (window as any).webkitAudioContext)({ sampleRate: 16000 });
      if (inputContext.state === 'suspended') {
        await inputContext.resume();
      }
      inputContextRef.current = inputContext;

      const source = inputContext.createMediaStreamSource(stream);
      const processor = inputContext.createScriptProcessor(4096, 1, 1);
      processorRef.current = processor;

      const outputContext = new (window.AudioContext || (window as any).webkitAudioContext)({ sampleRate: 24000 });
      if (outputContext.state === 'suspended') {
        await outputContext.resume();
      }
      outputContextRef.current = outputContext;

      const outputNode = outputContext.createGain();
      outputNode.connect(outputContext.destination);
      outputNodeRef.current = outputNode;

      nextStartTimeRef.current = outputContext.currentTime;

      const sessionPromise = ai.live.connect({
        model: 'gemini-2.5-flash-native-audio-preview-09-2025',
        config: {
          responseModalities: [Modality.AUDIO],
          speechConfig: {
            voiceConfig: { prebuiltVoiceConfig: { voiceName: 'Kore' } }
          },
          systemInstruction: {
            parts: [{
              text: "You are an elite F1 Race Engineer (like Peter Bonnington or GP). Your driver is on track. I will stream you live GPS telemetry including: Lap Time, Current Speed, Time Delta to optimal lap, and G-Forces. \n\nPERSONA GUIDELINES:\n- Be calm, precise, technical, and slightly cold.\n- Use F1 radio jargon: 'Copy', 'Box box', 'Mode Push', 'Purple Sector'.\n- Focus primarily on DELTA, LAP TIME, and SPEED maintenance.\n- If Delta is negative (e.g., -0.2), say 'Two tenths up', 'Purple sector', or 'Good pace'.\n- If Delta is positive (e.g., +0.5), say 'Gap is +0.5', 'Time to find in Sector 2', or 'Check lines'.\n- Only speak when there is a significant change or advice needed. Keep messages concise (under 8 words)."
            }]
          }
        },
        callbacks: {
          onopen: () => {
            console.log("Gemini Live Session Opened");
            setVoiceStatus('connected');
            isVoiceConnectedRef.current = true;

            source.connect(processor);
            processor.connect(inputContext.destination);

            processor.onaudioprocess = (e) => {
              const inputData = e.inputBuffer.getChannelData(0);
              const pcmBlob = createBlob(inputData);
              sessionPromise.then(session => {
                session.sendRealtimeInput({ media: pcmBlob });
              });
            };

            // IMMEDIATE RADIO CHECK: Force the model to speak as soon as connection opens
            sessionPromise.then(session => {
              const s = session as any;
              if (typeof s.send === 'function') {
                s.send({ parts: [{ text: "The driver has just connected the radio. Give a short, professional F1 radio check immediately. e.g. 'Radio check. Loud and clear.'" }] });
              }
            });
          },
          onmessage: async (msg: LiveServerMessage) => {
            const serverContent = msg.serverContent;

            const base64Audio = serverContent?.modelTurn?.parts?.[0]?.inlineData?.data;
            if (base64Audio && outputContextRef.current && outputNodeRef.current) {
              const ctx = outputContextRef.current;
              nextStartTimeRef.current = Math.max(nextStartTimeRef.current, ctx.currentTime);
              const audioBuffer = await decodeAudioData(decode(base64Audio), ctx, 24000, 1);
              const sourceNode = ctx.createBufferSource();
              sourceNode.buffer = audioBuffer;
              sourceNode.connect(outputNodeRef.current);
              sourceNode.addEventListener('ended', () => sourcesRef.current.delete(sourceNode));
              sourceNode.start(nextStartTimeRef.current);
              nextStartTimeRef.current += audioBuffer.duration;
              sourcesRef.current.add(sourceNode);
            }

            if (serverContent?.interrupted) {
              console.log("Model interrupted");
              sourcesRef.current.forEach(node => { try { node.stop(); } catch (e) { } });
              sourcesRef.current.clear();
              nextStartTimeRef.current = outputContextRef.current ? outputContextRef.current.currentTime : 0;
            }
          },
          onclose: () => {
            console.log("Gemini Live Session Closed");
            setVoiceStatus('disconnected');
            isVoiceConnectedRef.current = false;
          },
          onerror: (err) => {
            console.error("Gemini Live Error:", err);
            setVoiceStatus('error');
            isVoiceConnectedRef.current = false;
            disconnectVoiceCoach();
          }
        }
      });

      sessionPromiseRef.current = sessionPromise;

    } catch (error) {
      console.error("Failed to connect voice:", error);
      setVoiceStatus('error');
      isVoiceConnectedRef.current = false;
    }
  };

  const disconnectVoiceCoach = () => {
    if (audioStreamRef.current) {
      audioStreamRef.current.getTracks().forEach(t => t.stop());
      audioStreamRef.current = null;
    }
    if (processorRef.current) {
      processorRef.current.disconnect();
      processorRef.current = null;
    }
    if (inputContextRef.current) {
      inputContextRef.current.close();
      inputContextRef.current = null;
    }
    sourcesRef.current.forEach(node => { try { node.stop(); } catch (e) { } });
    sourcesRef.current.clear();
    if (outputContextRef.current) {
      outputContextRef.current.close();
      outputContextRef.current = null;
    }
    if (sessionPromiseRef.current) {
      sessionPromiseRef.current.then(session => session.close()).catch(console.error);
      sessionPromiseRef.current = null;
    }
    isVoiceConnectedRef.current = false;
    setVoiceStatus('disconnected');
  };

  const toggleVoice = () => {
    if (isVoiceConnectedRef.current) {
      disconnectVoiceCoach();
    } else {
      connectToVoiceCoach();
    }
  };

  useEffect(() => {
    return () => {
      disconnectVoiceCoach();
    };
  }, []);

  useEffect(() => {
    let interval: ReturnType<typeof setInterval>;

    if (isVoiceConnectedRef.current && isActive) {
      interval = setInterval(() => {
        if (sessionPromiseRef.current) {
          // Send rich telemetry
          const telemetryMsg = `[TELEMETRY] LapTime: ${lapTimeRef.current.toFixed(2)}s. Sector: ${currentSectorRef.current}. Dist: ${currentDistRef.current}m. Speed: ${speedRef.current}mph. Delta: ${deltaRef.current > 0 ? '+' : ''}${deltaRef.current.toFixed(2)}s. G-Lat: ${gLatRef.current.toFixed(2)}. G-Long: ${gLongRef.current.toFixed(2)}.`;
          sessionPromiseRef.current.then(session => {
            const s = session as any;
            if (typeof s.send === 'function') {
              s.send({ parts: [{ text: telemetryMsg }] });
            }
          }).catch(() => { });
        }
      }, 3500);
    }

    return () => clearInterval(interval);
  }, [voiceStatus, isActive]); // Depend on voiceStatus to trigger re-effect

  const formatTime = (seconds: number) => {
    const mins = Math.floor(seconds / 60);
    const secs = Math.floor(seconds % 60);
    const ms = Math.floor((seconds % 1) * 100);
    return `${mins}:${secs.toString().padStart(2, '0')}.${ms.toString().padStart(2, '0')}`;
  };

  return (
    <div className="h-full w-full relative bg-[#0B0F19] overflow-hidden">

      {/* --- SIMPLIFIED RACE HUD --- */}
      <div className="absolute top-0 left-0 right-0 z-20 flex h-24 md:h-32 border-b border-white/10 shadow-2xl">

        {/* BIG DELTA (Primary Driver Metric) */}
        <div className={`flex-1 flex flex-col items-center justify-center transition-colors duration-200 ${delta > 0 ? 'bg-rose-900/80 text-rose-500' : 'bg-emerald-900/80 text-emerald-400'}`}>
          <span className="text-xs md:text-sm font-black uppercase tracking-[0.2em] opacity-80">Time Delta</span>
          <span className="text-6xl md:text-8xl font-black font-mono tracking-tighter leading-none">
            {delta > 0 ? '+' : ''}{Math.abs(delta).toFixed(2)}
          </span>
        </div>

        {/* SECONDARY INFO (Speed & Lap) */}
        <div className="flex-1 bg-[#0B0F19]/95 backdrop-blur flex flex-col">
          {/* Speed */}
          <div className="flex-1 flex items-center justify-center border-b border-white/10 relative">
            <div className="flex items-baseline gap-2">
              <span className="text-5xl md:text-7xl font-bold font-mono text-white tracking-tighter">{speed}</span>
              <span className="text-sm md:text-xl font-bold text-slate-500">MPH</span>
            </div>
            {/* Source Indicator */}
            <div className="absolute top-2 right-2 flex items-center gap-1.5 px-2 py-1 rounded bg-white/5 border border-white/10">
              <MapPin size={10} className={useRealGps ? (sseStatus === 'connected' ? "text-emerald-500" : "text-amber-500 animate-pulse") : "text-amber-500"} />
              <span className="text-[10px] font-mono text-slate-400">
                {useRealGps ? `GPS SSE (${sseStatus.toUpperCase()})` : 'SIMULATION'}
              </span>
            </div>
          </div>
          {/* Lap Time */}
          <div className="h-10 md:h-12 flex items-center justify-between px-6 bg-slate-900/50">
            <span className="text-xs font-bold text-slate-500 uppercase tracking-widest">Lap {currentLap}</span>
            <span className="text-lg md:text-xl font-mono font-bold text-white">{formatTime(lapTime)}</span>
          </div>
        </div>
      </div>

      {/* --- World: Map --- */}
      <div className="absolute inset-0 z-0 bg-[#0B0F19] pt-[96px] md:pt-[128px] pb-[100px] md:pb-[100px] flex items-center justify-center">
        <div className="w-full h-full max-w-7xl p-4">
          <GoogleMapsTrack
            track={activeTrack}
            carPosition={currentPos}
            apiKey={mapsKey}
            className="w-full h-full shadow-2xl"
          />
        </div>

        {/* API Key Modal/Input Overlay */}
        {(!mapsKey || showKeyModal) && (
          <div className="absolute inset-0 z-[60] bg-black/80 backdrop-blur-sm flex items-center justify-center p-4">
            <div className="bg-slate-900 border border-slate-700 p-6 rounded-2xl max-w-md w-full shadow-2xl">
              <h3 className="text-xl font-bold text-white mb-4 flex items-center gap-2">
                <Key className="text-amber-500" /> Configure Maps API
              </h3>
              <p className="text-slate-400 text-sm mb-4">
                Enter your Google Maps API Key to enable the satellite track visualizer.
                This key is stored locally in your browser.
              </p>
              <input
                type="text"
                value={mapsKey}
                onChange={(e) => setMapsKey(e.target.value)}
                placeholder="AIzaSy..."
                className="w-full bg-slate-950 border border-slate-700 rounded-lg px-4 py-3 text-white font-mono text-sm mb-4 focus:border-sky-500 focus:outline-none"
              />
              <div className="flex justify-end gap-3">
                {mapsKey && (
                  <button
                    onClick={() => {
                      localStorage.setItem('GOOGLE_MAPS_KEY', mapsKey);
                      setShowKeyModal(false);
                    }}
                    className="bg-sky-500 hover:bg-sky-400 text-white font-bold py-2 px-6 rounded-lg transition-colors"
                  >
                    Save & Continue
                  </button>
                )}
                <button
                  onClick={() => setShowKeyModal(false)}
                  className="text-slate-500 hover:text-slate-300 font-bold py-2 px-4"
                >
                  Close
                </button>
              </div>
            </div>
          </div>
        )}

        {/* Settings/Key Button (Top Right) */}
        <button
          onClick={() => setShowKeyModal(true)}
          className="absolute top-28 right-4 z-40 p-2 bg-slate-900/50 hover:bg-slate-800 text-slate-400 hover:text-white rounded-lg border border-white/10 transition-colors"
        >
          <Settings size={20} />
        </button>

        {/* GPS Error Toast */}
        {useRealGps && gpsError && (
          <div className="absolute top-28 left-0 right-0 flex justify-center z-50 pointer-events-none">
            <div className="bg-rose-500 text-white px-4 py-2 rounded-full shadow-lg flex items-center gap-2 animate-pulse">
              <AlertTriangle size={16} />
              <span className="text-xs font-bold uppercase tracking-wide">{gpsError}</span>
            </div>
          </div>
        )}

        {/* G-Force Gauge (GPS Inferred) */}
        <div className="absolute bottom-32 right-4 md:bottom-28 md:right-8 pointer-events-none z-10">
          <GForceGauge lat={gLat} long={gLong} />
        </div>

        {/* Voice Clues */}
        {isVoiceConnectedRef.current && (
          <div className="absolute bottom-32 left-4 md:bottom-28 md:left-8 z-10">
            <VoiceClue />
          </div>
        )}
      </div>

      {/* --- HUD: Fixed Footer --- */}
      <div className="fixed bottom-0 left-0 right-0 z-[100] w-full p-4 pb-12 md:p-6 bg-[#0B0F19]/95 backdrop-blur-xl border-t border-white/10 flex gap-3 items-center shadow-[0_-10px_40px_rgba(0,0,0,0.5)]">

        {/* GPS Source Toggle */}
        <button
          onClick={() => setUseRealGps(!useRealGps)}
          className={`shrink-0 h-14 w-14 rounded-xl flex items-center justify-center transition-all border shadow-lg active:scale-95 ${useRealGps
            ? 'bg-emerald-500/20 border-emerald-500 text-emerald-400 shadow-emerald-900/20'
            : 'bg-slate-800 border-white/10 text-slate-500 hover:text-slate-300'
            }`}
          title={useRealGps ? "Switch to Simulation" : "Switch to Real GPS"}
        >
          <LocateFixed size={24} className={useRealGps ? "animate-pulse" : ""} />
        </button>

        {/* Voice Toggle */}
        <button
          onClick={toggleVoice}
          className={`shrink-0 h-14 w-14 rounded-xl flex items-center justify-center transition-all border shadow-lg active:scale-95 ${isVoiceConnectedRef.current
            ? 'bg-sky-500/20 border-sky-500 text-sky-400 shadow-sky-900/20'
            : 'bg-slate-800 border-white/10 text-slate-300 hover:bg-slate-700'
            }`}
        >
          {voiceStatus === 'connecting' ? (
            <Radio className="animate-pulse" size={24} />
          ) : isVoiceConnectedRef.current ? (
            <Mic size={24} />
          ) : (
            <MicOff size={24} />
          )}
        </button>

        {/* Start/Stop Button */}
        <button
          onClick={() => setIsActive(!isActive)}
          className={`flex-1 h-14 rounded-xl font-black uppercase tracking-widest text-base flex items-center justify-center gap-3 transition-all shadow-[0_0_20px_rgba(0,0,0,0.3)] active:scale-95 ${isActive
            ? 'bg-rose-600 hover:bg-rose-500 text-white border border-rose-400 shadow-rose-900/30'
            : 'bg-[#00ffa3] hover:bg-[#00dd8c] text-black border border-[#4dffc0] shadow-[0_0_20px_rgba(0,255,163,0.3)]'
            }`}
        >
          {isActive ? (
            <>
              <Square size={20} fill="currentColor" /> <span>STOP</span>
            </>
          ) : (
            <>
              <Play size={24} fill="currentColor" /> <span>START {useRealGps ? 'GPS' : 'SESSION'}</span>
            </>
          )}
        </button>
      </div>
    </div>
  );
}