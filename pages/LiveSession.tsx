import React, { useState, useEffect, useRef, useMemo } from 'react';
import { TrackVisualizer } from '../components/TrackVisualizer';
import { Play, Square, Mic, MicOff, Radio, LocateFixed, MapPin, AlertTriangle } from 'lucide-react';
import { MOCK_TRACK, MOCK_SESSION } from '../constants';
import { GoogleGenAI, LiveServerMessage, Modality } from "@google/genai";
import { Lap, TelemetryPoint, Track, SSEConnectionStatus } from '../types';
import { GpsSSEService } from '../services/gpsService';
import { getHotAction, getColdAdvice, type HotAction, type ColdAdvice, type CoachPersona } from '../services/coachingService';

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
    osc.frequency.setValueAtTime(60, now);
    osc.frequency.exponentialRampToValueAtTime(10, now + 0.15);
    gain.gain.setValueAtTime(0.2, now);
    gain.gain.exponentialRampToValueAtTime(0.001, now + 0.15);
    osc.start(now);
    osc.stop(now + 0.15);
  } else {
    osc.frequency.setValueAtTime(80, now);
    osc.frequency.exponentialRampToValueAtTime(20, now + 0.1);
    gain.gain.setValueAtTime(0.15, now);
    gain.gain.exponentialRampToValueAtTime(0.001, now + 0.1);
    osc.start(now);
    osc.stop(now + 0.1);
  }
}

type TelemetrySource = 'csv-replay' | 'vbox-stream';

export default function LiveSession() {
  const [isActive, setIsActive] = useState(false);
  const [telemetrySource, setTelemetrySource] = useState<TelemetrySource>('csv-replay');
  const [streamConnected, setStreamConnected] = useState(false);

  const csvDataRef = useRef<any[]>([]);
  const csvIndexRef = useRef(0);

  const [currentData, setCurrentData] = useState({
    speed: 0,
    gear: 1,
    rpm: 1000,
    throttle: 0,
    brake: 0,
    lat: 38.2589, // Default fallback
    lon: -122.4578,
    heading: 0,
    gLat: 0,
    gLong: 0
  });

  // Coaching State
  const [hotAction, setHotAction] = useState<HotAction>({ action: 'WAITING', color: '#666' });
  const [coldAdvice, setColdAdvice] = useState<ColdAdvice>({ message: "Analyzing telemetry...", detail: "Waiting for sufficient data..." });
  const [activeCoach, setActiveCoach] = useState<CoachPersona>('SUPER_AJ');
  const lastColdAdviceTime = useRef(0);
  const lastHotActionTime = useRef(0);

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

  // Visualizer Ref
  const visualizerRef = useRef<any>(null);

  // --- Track Logic ---
  // Use state for track so we can update it with CSV geometry
  const [activeTrack, setActiveTrack] = useState<Track>(MOCK_TRACK);

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

  // --- Helper: Coordinate Parsing for VBOX ---
  const parseCoord = (str: string) => {
    // Basic parsing for "38°9.631176 N" or standard float strings
    if (!str) return 0;
    // Check if it's already a simple float string
    if (!str.includes('°')) {
      const f = parseFloat(str);
      return isNaN(f) ? 0 : f;
    }
    const match = str.match(/(\d+)°([\d\.]+)\s+([NSEW])/);
    if (!match) return 0;
    let val = parseInt(match[1]) + parseFloat(match[2]) / 60;
    if (match[3] === 'S' || match[3] === 'W') val = -val;
    return val;
  };

  // --- Helper: VBOX Time Parsing ---
  const vboxTimeToSeconds = (str: string): number => {
    // VBOX Time format: HHMMSS.sss (e.g., 212159.900)
    const s = str.trim();
    // Basic validation
    if (s.length < 4) return 0;

    // If it doesn't look like HHMMSS (e.g. just seconds), try float
    if (!s.includes('.') && s.length < 6) return parseFloat(s);

    // Parse HH, MM, SS.sss
    // We assume at least HHMMSS structure if length is sufficient
    // But sometimes it might be just MMSS? VBOX mock is usually HHMMSS.

    // Safe parsing:
    // Extract parts based on fixed width for standard VBOX CSV
    const hh = parseInt(s.substring(0, 2), 10) || 0;
    const mm = parseInt(s.substring(2, 4), 10) || 0;
    const ss = parseFloat(s.substring(4)) || 0;

    return (hh * 3600) + (mm * 60) + ss;
  };

  // --- DATA INGESTION ENGINE ---
  useEffect(() => {
    // Always load the CSV map data on mount so both modes use the real track geometry.
    fetch('/VBOX0240.csv')
      .then(r => r.text())
      .then(text => {
        const lines = text.split('\n');
        if (lines.length < 2) return;

        // Simple CSV parsing assuming specific VBOX format
        const rows = lines.slice(1).map(line => {
          const cols = line.split(',');
          if (cols.length < 6) return null;
          return {
            'Time': vboxTimeToSeconds(cols[0]), // Parse HHMMSS.sss to seconds
            'Speed (km/h)': cols[2],
            'Heading (Degrees)': cols[3],
            'Latitude': cols[4],
            'Longitude': cols[5],
            'Lateral acceleration (g)': cols[16],
            'Longitudinal acceleration (g)': cols[17]
          };
        }).filter(r => r);

        // Project CSV points to Track Map (Sampled)
        // Use same projection logic as TrackVisualizer
        const SCALE_X = 80000;
        const SCALE_Y = 100000;
        const cx = 350;
        const cy = 250;
        const trackCenter = MOCK_TRACK.center;

        const sampledPoints = [];
        const sampleRate = Math.max(1, Math.floor(rows.length / 1000)); // Target ~1000 points for smoother curves

        for (let i = 0; i < rows.length; i += sampleRate) {
          const r = rows[i];
          const lat = parseCoord(r['Latitude']);
          const lon = parseCoord(r['Longitude']);

          const dx = (lon - trackCenter.lng) * SCALE_X;
          const dy = (trackCenter.lat - lat) * SCALE_Y;

          sampledPoints.push({ x: cx + dx, y: cy + dy });
        }

        csvDataRef.current = rows;

        // Calculate actual duration from CSV time (first vs last)
        let durationSeconds = 108.5; // Default fallback
        if (rows.length > 1) {
          const startTime = rows[0]['Time'];
          const endTime = rows[rows.length - 1]['Time'];
          if (typeof startTime === 'number' && typeof endTime === 'number') {
            durationSeconds = (endTime - startTime) / 1000; // Assuming time is in milliseconds
          }
        }

        // Overwrite track mapPoints with actual driven path for ALL modes
        setActiveTrack(prev => ({
          ...prev,
          mapPoints: sampledPoints,
          recordLap: durationSeconds // Update recordLap with calculated duration
        }));
      })
      .catch(err => console.error("Failed to load CSV", err));
  }, []); // Run once on mount

  useEffect(() => {
    let intervalId: any;
    let eventSource: EventSource | null = null;

    const handleUpdate = (data: any) => {
      let speed = 0;
      let lat = 0;
      let lon = 0;
      let heading = 0;
      let gLat = 0; // Derived if possible
      let gLong = 0;

      if (telemetrySource === 'csv-replay') {
        // data is CSV row object
        speed = parseFloat(data['Speed (km/h)'] || '0');

        lat = parseCoord(data['Latitude']);
        lon = parseCoord(data['Longitude']);
        heading = parseFloat(data['Heading (Degrees)'] || '0');
        gLat = parseFloat(data['Lateral acceleration (g)'] || '0');
        gLong = parseFloat(data['Longitudinal acceleration (g)'] || '0');

      } else {
        // VBOX Stream (TPV JSON from ingest.py)
        // {"class":"TPV","time":"...","lat":...,"lon":...,"speed":... (m/s),"track":...}
        if (data.class === 'TPV') {
          speed = (data.speed || 0) * 3.6; // m/s to km/h
          lat = data.lat;
          lon = data.lon;
          heading = data.track;
          // VBOX stream might not send Gs in TPV, ignore for now or calc derivative
        } else {
          return; // Ignore non-TPV
        }
      }

      setCurrentData({
        speed: Math.round(speed),
        gear: Math.min(6, Math.max(1, Math.floor(speed / 30))), // Mock logic for gear
        rpm: 3000 + (speed * 50) % 4000,
        throttle: speed > 10 ? 80 : 0,
        brake: speed < 5 ? 50 : 0,
        lat,
        lon,
        heading,
        gLat,
        gLong
      });

      if (visualizerRef.current) {
        visualizerRef.current.updatePosition({ lat, lon, heading });
        // Ghost runs at record lap pace (using actual CSV duration now)
        const recordTimeMs = activeTrack.recordLap * 1000;
        // Simple loop based on elapsed session time
        const elapsed = performance.now() - startTimeRef.current;
        const ghostProgress = (elapsed % recordTimeMs) / recordTimeMs;
        visualizerRef.current.updateProgress(0, ghostProgress);
      }

      // Update refs
      speedRef.current = speed;
      gLatRef.current = gLat;
      gLongRef.current = gLong;

      // Coaching Calls
      handleAudioCues(gLat, gLong);

      // --- LAP TIMING AND DELTA LOGIC ---
      const now = performance.now();

      // Simple Start/Finish Line Detection (Crossing the "first point" of the track)
      // MOCK_TRACK is roughly centered. Let's assume start/finish is near index 0 of the map points?
      // Or better, let's just track "distance traveled" if we had it, but we only have Lat/Lon.
      // We'll use a proximity check to the track start point (MOCK_TRACK.mapPoints[0] is visual, not geo).
      // Let's use MOCK_TRACK.center as a reference? No.
      // For now, let's just use a simple time-based "lap" for demo purposes or CSV loop detection
      if (telemetrySource === 'csv-replay') {
        // Detect loop in CSV index
        if (csvIndexRef.current === 0 && csvDataRef.current.length > 0 && currentLapRef.current > 0) {
          // Lap completed
          currentLapRef.current += 1;
          // Mock lap time based on CSV duration or just timestamp?
          // If we assume 10Hz, length / 10 is lap time
          const lapTime = csvDataRef.current.length / 10;
          lapTimeRef.current = lapTime;
          deltaRef.current = (Math.random() - 0.5) * 2.0; // Mock delta
        }
      }

      // ... Coaching logic ... (keep existing)
      if (now - lastHotActionTime.current > 100) {
        getHotAction({
          speedKmh: speed,
          rpm: 0,
          throttle: 0,
          brakePos: 0,
          latG: gLat,
          longG: gLong
        }, activeCoach).then(action => setHotAction(action));
        lastHotActionTime.current = now;
      }

      if (now - lastColdAdviceTime.current > 5000) {
        getColdAdvice({
          speedKmh: speed,
          rpm: 0,
          throttle: 0,
          brakePos: 0,
          latG: gLat,
          longG: gLong
        }, activeCoach).then(advice => {
          if (advice.message !== "No advice available.") {
            setColdAdvice(advice);
          }
        });
        lastColdAdviceTime.current = now;
      }
    };

    if (isActive) {
      if (startTimeRef.current === 0) startTimeRef.current = performance.now();

      if (telemetrySource === 'csv-replay') {
        // Data is already loaded in the mount useEffect
        intervalId = setInterval(() => {
          if (csvDataRef.current.length > 0) {
            const pt = csvDataRef.current[csvIndexRef.current];
            if (pt) handleUpdate(pt);
            csvIndexRef.current = (csvIndexRef.current + 1) % csvDataRef.current.length;
          }
        }, 100); // 10Hz
      } else {
        // VBOX Stream
        setStreamConnected(false);
        eventSource = new EventSource('http://localhost:8000/events');

        eventSource.onopen = () => {
          console.log("VBOX Stream Connected");
          setStreamConnected(true);
        };
        eventSource.onmessage = (e) => {
          try {
            const json = JSON.parse(e.data);
            handleUpdate(json);
          } catch (err) {
            console.error("Stream parse error", err);
          }
        };
        eventSource.onerror = (e) => {
          console.error("Stream error", e);
          setStreamConnected(false);
          if (eventSource) eventSource.close();
        };
      }
    }

    return () => {
      if (intervalId) clearInterval(intervalId);
      if (eventSource) {
        eventSource.close();
        setStreamConnected(false);
      }
    };
  }, [isActive, telemetrySource]); // Re-run when source/active changes

  // --- Voice Connection Logic ---
  const connectToVoiceCoach = async () => {
    if (isVoiceConnectedRef.current || voiceStatus === 'connecting') return;

    try {
      setVoiceStatus('connecting');
      const apiKey = process.env.API_KEY || localStorage.getItem('GEMINI_API_KEY');
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
        model: 'gemini-2.0-flash-exp', // Updated model
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

            sessionPromise.then(session => {
              const s = session as any;
              if (typeof s.send === 'function') {
                s.send({ parts: [{ text: "Radio check." }] });
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
              sourcesRef.current.forEach(node => { try { node.stop(); } catch (e) { } });
              sourcesRef.current.clear();
              nextStartTimeRef.current = outputContextRef.current ? outputContextRef.current.currentTime : 0;
            }
          },
          onclose: () => {
            setVoiceStatus('disconnected');
            isVoiceConnectedRef.current = false;
          },
          onerror: (err) => {
            setVoiceStatus('error');
            isVoiceConnectedRef.current = false;
            disconnectVoiceCoach();
          }
        }
      });

      sessionPromiseRef.current = sessionPromise;

    } catch (error) {
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

  return (
    <div className="flex-1 relative flex flex-col h-full bg-slate-900 overflow-hidden">

      {/* 3D Track Background */}
      <div className="absolute inset-0 z-0">
        <TrackVisualizer ref={visualizerRef} track={activeTrack} />


      </div>

      {/* --- HUD --- */}
      <div className="relative z-10 p-4 md:p-8 flex flex-col justify-between h-full pointer-events-none">

        {/* Telemetry Source Selector (Moved for Visibility) */}
        <div className="absolute top-4 left-4 z-50 flex flex-col gap-2 pointer-events-auto">
          <div className="flex gap-2">
            <button
              onClick={() => setTelemetrySource('csv-replay')}
              className={`px-3 py-1.5 text-xs font-bold rounded-lg border transition-all ${telemetrySource === 'csv-replay' ? 'bg-blue-600/80 border-blue-400 text-white shadow-[0_0_10px_rgba(37,99,235,0.5)]' : 'bg-black/40 border-slate-700 text-slate-400 backdrop-blur hover:bg-black/60'}`}
            >
              CSV REPLAY
            </button>
            <button
              onClick={() => setTelemetrySource('vbox-stream')}
              className={`px-3 py-1.5 text-xs font-bold rounded-lg border flex items-center gap-2 transition-all ${telemetrySource === 'vbox-stream' ? 'bg-purple-600/80 border-purple-400 text-white shadow-[0_0_10px_rgba(147,51,234,0.5)]' : 'bg-black/40 border-slate-700 text-slate-400 backdrop-blur hover:bg-black/60'}`}
            >
              VBOX LIVE
              <div className={`w-2 h-2 rounded-full ${streamConnected ? 'bg-emerald-400 shadow-[0_0_5px_#34d399]' : 'bg-slate-500'}`} />
            </button>
          </div>
          {telemetrySource === 'vbox-stream' && !streamConnected && isActive && (
            <div className="text-[10px] text-amber-400 bg-black/60 px-2 py-1 rounded border border-amber-500/30">
              Waiting for stream on localhost:8000...
            </div>
          )}
        </div>

        {/* Top Bar */}
        <div className="flex justify-between items-start pointer-events-auto">
          <div className="glass-panel p-3 md:p-4 rounded-xl flex gap-6 md:gap-8 backdrop-blur-xl bg-slate-900/50 border border-white/10">
            <div>
              <p className="text-[10px] text-slate-400 font-bold uppercase tracking-widest">Lap Time</p>
              <p className="text-2xl md:text-4xl font-mono font-black text-white tabular-nums">
                {lapTimeRef.current.toFixed(2)}<span className="text-sm md:text-lg text-slate-500">s</span>
              </p>
            </div>
            <div>
              <p className="text-[10px] text-slate-400 font-bold uppercase tracking-widest">Delta</p>
              <p className={`text-2xl md:text-4xl font-mono font-black tabular-nums ${deltaRef.current > 0 ? 'text-rose-500' : 'text-emerald-500'}`}>
                {deltaRef.current > 0 ? '+' : ''}{deltaRef.current.toFixed(2)}
              </p>
            </div>
            <div className="hidden md:block">
              <p className="text-[10px] text-slate-400 font-bold uppercase tracking-widest">Speed</p>
              <p className="text-2xl md:text-4xl font-mono font-black text-white">
                {currentData.speed}<span className="text-lg text-slate-500">KM/H</span>
              </p>
            </div>
          </div>

          {/* AI Info & Controls */}
          <div className="flex flex-col gap-2 items-end">
            {/* Voice Status / AI Mode */}
            <div className={`px-3 py-1.5 rounded-full flex items-center gap-2 border transition-colors backdrop-blur ${voiceStatus === 'connected' ? 'border-emerald-500/50 bg-emerald-950/30' :
              isActive ? 'border-amber-500/50 bg-amber-950/30' :
                'border-slate-700 bg-slate-900/50'
              }`}>
              {voiceStatus === 'connecting' && <div className="w-2 h-2 rounded-full bg-amber-500 animate-ping" />}
              {voiceStatus === 'connected' && <div className="w-2 h-2 rounded-full bg-emerald-500 shadow-[0_0_8px_#10b981]" />}
              {voiceStatus === 'disconnected' && isActive && <div className="w-2 h-2 rounded-full bg-amber-500 shadow-[0_0_8px_#f59e0b]" />}
              {voiceStatus === 'disconnected' && !isActive && <div className="w-2 h-2 rounded-full bg-slate-500" />}

              <span className="text-[10px] font-bold uppercase tracking-wider text-slate-300">
                {voiceStatus === 'connected' ? 'AI RACE ENGINEER' : isActive ? 'AI COACH ACTIVE' : 'AI STANDBY'}
              </span>
            </div>
          </div>
        </div>

        {/* --- COACHING LAYER --- */}
        <div className="absolute top-32 left-0 right-0 z-30 pointer-events-none p-4 flex flex-col gap-4">
          {/* HOT ADVICE (Nano) */}
          <div className="flex justify-center">
            <div className="flex flex-col items-center gap-1 transition-all duration-200" style={{ transform: hotAction.action !== 'WAITING' ? 'scale(1.1)' : 'scale(1)', opacity: hotAction.action !== 'WAITING' ? 1 : 0.5 }}>
              <div className="px-6 py-2 bg-black/80 backdrop-blur border-2 rounded-full shadow-2xl flex items-center gap-3" style={{ borderColor: hotAction.color }}>
                <span className="w-3 h-3 rounded-full animate-pulse" style={{ backgroundColor: hotAction.color }}></span>
                <span className="text-2xl md:text-4xl font-black italic tracking-tighter text-white uppercase" style={{ textShadow: `0 0 20px ${hotAction.color}` }}>
                  {hotAction.action}
                </span>
              </div>
            </div>
          </div>

          {/* COLD ADVICE (Cloud) */}
          <div className="flex justify-end px-4">
            {coldAdvice.message !== "Analyzing telemetry..." && (
              <div className="max-w-sm w-full bg-[#111]/90 backdrop-blur-md border border-[#333] rounded-xl overflow-hidden shadow-2xl transition-all animate-fade-in-up">
                <div className="px-4 py-2 bg-[#1a1a1a] border-b border-[#333] flex justify-between items-center">
                  <div className="flex items-center gap-2">
                    <span className="text-[10px] font-bold text-purple-400 uppercase tracking-wider">Coach Analysis</span>
                  </div>
                  <span className="text-[10px] font-mono text-[#666]">{coldAdvice.latency ? `${coldAdvice.latency} ms` : ''}</span>
                </div>
                <div className="p-4">
                  <div className="text-lg font-bold text-white leading-tight mb-2">"{coldAdvice.message}"</div>
                  <div className="text-xs text-gray-400 leading-relaxed font-mono">{coldAdvice.detail}</div>
                </div>
              </div>
            )}
          </div>
        </div>

        {/* --- COACH SELECTION --- */}
        <div className="absolute top-20 right-4 md:right-8 z-30 pointer-events-auto flex flex-col items-end gap-2">
          <div className="bg-black/80 backdrop-blur border border-white/20 rounded-lg p-2 flex flex-col gap-2">
            <span className="text-[10px] text-zinc-400 font-bold uppercase tracking-wider text-right">Active Coach</span>
            <div className="flex gap-1">
              {(['SUPER_AJ', 'AJ', 'TONY', 'RACHEL', 'GARMIN'] as CoachPersona[]).map(coach => (
                <button
                  key={coach}
                  onClick={() => setActiveCoach(coach)}
                  className={`px-3 py-1.5 rounded text-[10px] font-bold uppercase tracking-wider transition-all
                               ${activeCoach === coach
                      ? 'bg-white text-black shadow-lg scale-105'
                      : 'bg-zinc-800 text-zinc-500 hover:bg-zinc-700 hover:text-zinc-300'}`}
                >
                  {coach === 'SUPER_AJ' ? 'SUPER' : coach}
                </button>
              ))}
            </div>
          </div>
        </div>

        {/* --- CONTROLS FOOTER --- */}
        <div className="flex justify-center gap-4 pointer-events-auto pb-8">

          {/* Start/Stop Session */}
          <button
            onClick={() => setIsActive(!isActive)}
            className={`h-12 px-8 rounded-full font-black uppercase tracking-widest text-sm flex items-center justify-center gap-2 transition-all shadow-lg ${isActive
              ? 'bg-rose-600 hover:bg-rose-500 text-white border border-rose-400'
              : 'bg-[#00ffa3] hover:bg-[#00dd8c] text-black border border-[#4dffc0]'
              }`}
          >
            {isActive ? (
              <> <Square size={16} fill="currentColor" /> STOP SESSION </>
            ) : (
              <> <Play size={20} fill="currentColor" /> START {telemetrySource === 'vbox-stream' ? 'STREAM' : 'REPLAY'} </>
            )}
          </button>

          {/* Voice Toggle */}
          <button
            onClick={toggleVoice}
            className={`h-12 w-12 rounded-full flex items-center justify-center transition-all border shadow-lg ${isVoiceConnectedRef.current
              ? 'bg-sky-500/20 border-sky-500 text-sky-400'
              : 'bg-slate-800 border-white/10 text-slate-300 hover:bg-slate-700'
              }`}
          >
            {voiceStatus === 'connecting' ? <Radio className="animate-pulse" size={20} /> : isVoiceConnectedRef.current ? <Mic size={20} /> : <MicOff size={20} />}
          </button>

        </div>

      </div>
    </div>
  );
}