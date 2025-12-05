import React, { useState, useEffect, useRef } from 'react';
import { TrackVisualizer } from '../components/TrackVisualizer';
import { Play, Square, Mic, MicOff, Radio } from 'lucide-react';
import { MOCK_TRACK, MOCK_SESSION } from '../constants';
import { GoogleGenAI, LiveServerMessage, Modality } from "@google/genai";
import { Lap } from '../types';

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

const GForceGauge: React.FC<{ lat: number; long: number }> = ({ lat, long }) => {
  const MAX_G = 2.0;
  const clampedLat = Math.max(-MAX_G, Math.min(MAX_G, lat));
  const clampedLong = Math.max(-MAX_G, Math.min(MAX_G, long));

  const xPos = 50 + (clampedLat / MAX_G) * 50;
  const yPos = 50 - (clampedLong / MAX_G) * 50;

  return (
    <div className="w-20 h-20 md:w-32 md:h-32 relative group cursor-default pointer-events-none select-none transition-all">
      {/* Background/Dial */}
      <div className="absolute inset-0 bg-slate-900/80 backdrop-blur-md rounded-full border border-slate-700 shadow-xl overflow-hidden">
        {/* Grid Circles */}
        <div className="absolute inset-0 m-[15%] border border-slate-700/50 rounded-full" />
        <div className="absolute inset-0 m-[48%] bg-slate-800/50 rounded-full" />
        
        {/* Axes */}
        <div className="absolute top-0 bottom-0 left-1/2 w-px bg-slate-700/50" />
        <div className="absolute left-0 right-0 top-1/2 h-px bg-slate-700/50" />
        
        {/* Labels (Hidden on very small screens to reduce clutter) */}
        <div className="hidden md:block absolute top-2 left-1/2 -translate-x-1/2 text-[8px] font-bold text-slate-500 tracking-wider">ACCEL</div>
        <div className="hidden md:block absolute bottom-2 left-1/2 -translate-x-1/2 text-[8px] font-bold text-slate-500 tracking-wider">BRAKE</div>

        {/* The Puck */}
        <div 
            className="absolute w-3 h-3 md:w-4 md:h-4 bg-sky-500 rounded-full border-2 border-white shadow-[0_0_15px_rgba(14,165,233,1)] transition-transform duration-100 ease-linear will-change-transform z-10"
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
  const [isActive, setIsActive] = useState(false);
  const [isVoiceConnected, setIsVoiceConnected] = useState(false);
  const [voiceStatus, setVoiceStatus] = useState<'disconnected' | 'connecting' | 'connected' | 'error'>('disconnected');
  const [speed, setSpeed] = useState(0);
  const [lapTime, setLapTime] = useState(0);
  const [sessionTime, setSessionTime] = useState(0);
  const [progress, setProgress] = useState(0); 
  const [ghostProgress, setGhostProgress] = useState(0);
  const [currentLap, setCurrentLap] = useState(1);
  const [delta, setDelta] = useState(0);
  
  const [gLat, setGLat] = useState(0);
  const [gLong, setGLong] = useState(0);
  
  const requestRef = useRef<number>(0);
  const startTimeRef = useRef<number>(0);
  const speedRef = useRef<number>(0);
  const deltaRef = useRef<number>(0);
  const gLatRef = useRef<number>(0);
  const gLongRef = useRef<number>(0);
  const currentLapRef = useRef<number>(1);
  const sessionOffsetRef = useRef<number>(0);

  const inputContextRef = useRef<AudioContext | null>(null);
  const outputContextRef = useRef<AudioContext | null>(null);
  const outputNodeRef = useRef<GainNode | null>(null);
  const audioStreamRef = useRef<MediaStream | null>(null);
  const processorRef = useRef<ScriptProcessorNode | null>(null);
  const nextStartTimeRef = useRef<number>(0);
  const sessionPromiseRef = useRef<Promise<any> | null>(null);
  const sourcesRef = useRef<Set<AudioBufferSourceNode>>(new Set());

  const lastAudioCueTime = useRef<number>(0);

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
        time: t
    };
  };

  const getIdealTimeAtDistance = (d: number) => {
    const data = idealLap.telemetry;
    let idx = data.findIndex(p => p.distance > d);
    if (idx === -1) return data[data.length - 1].time;
    if (idx === 0) return data[0].time;
    
    const p1 = data[idx - 1];
    const p2 = data[idx];
    const range = p2.distance - p1.distance;
    const ratio = range > 0 ? (d - p1.distance) / range : 0;
    
    return p1.time + (p2.time - p1.time) * ratio;
  };

  const animate = (timestamp: number) => {
    if (!startTimeRef.current) startTimeRef.current = timestamp;
    const elapsedTotal = (timestamp - startTimeRef.current) + sessionOffsetRef.current;
    
    const elapsedSeconds = elapsedTotal / 1000;
    setSessionTime(elapsedSeconds);

    const lapDurationMs = userLap.time * 1000;
    const currentLapTimeMs = elapsedTotal % lapDurationMs;
    const currentLapTimeSec = currentLapTimeMs / 1000;

    const userState = getTelemetryAtTime(userLap, currentLapTimeSec);
    const userProgress = userState.distance / MOCK_TRACK.length;

    const ghostState = getTelemetryAtTime(idealLap, currentLapTimeSec);
    const ghostProg = ghostState.distance / MOCK_TRACK.length;

    const idealTimeAtMyDist = getIdealTimeAtDistance(userState.distance);
    const calcDelta = currentLapTimeSec - idealTimeAtMyDist;

    setProgress(Math.min(1, Math.max(0, userProgress)));
    setGhostProgress(Math.min(1, Math.max(0, ghostProg)));
    setSpeed(Math.round(userState.speed));
    setGLat(userState.gLat);
    setGLong(userState.gLong);
    setLapTime(currentLapTimeSec);
    setDelta(calcDelta);
    
    speedRef.current = Math.round(userState.speed);
    deltaRef.current = calcDelta;
    gLatRef.current = userState.gLat;
    gLongRef.current = userState.gLong;
    
    // Audio Cues Logic
    if (isVoiceConnected && outputContextRef.current) {
      const now = performance.now();
      // Cooldown of 3 seconds to prevent spam
      if (now - lastAudioCueTime.current > 3000) {
        if (Math.abs(userState.gLat) > 1.35) {
           playGForceCue(outputContextRef.current, 'corner');
           lastAudioCueTime.current = now;
        } else if (userState.gLong < -0.8) {
           playGForceCue(outputContextRef.current, 'brake');
           lastAudioCueTime.current = now;
        }
      }
    }

    const newLap = Math.floor(elapsedTotal / lapDurationMs) + 1;
    if (newLap !== currentLapRef.current) {
        currentLapRef.current = newLap;
        setCurrentLap(newLap);
    }

    requestRef.current = requestAnimationFrame(animate);
  };

  useEffect(() => {
    if (isActive) {
      startTimeRef.current = 0;
      requestRef.current = requestAnimationFrame(animate);
    } else {
      cancelAnimationFrame(requestRef.current);
      sessionOffsetRef.current = sessionTime * 1000;
      setGLat(0);
      setGLong(0);
      setSpeed(0);
    }
    return () => cancelAnimationFrame(requestRef.current);
  }, [isActive]);

  const connectToVoiceCoach = async () => {
    if (isVoiceConnected || voiceStatus === 'connecting') return;

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
              text: "You are Apex, an elite racing coach sitting in the passenger seat. You will receive periodic [TELEMETRY UPDATE] text messages with Speed (MPH), Delta (time gap), Lat G (cornering load), and Long G (braking/accel). Use this data to provide IMMEDIATE, PROACTIVE cues. High Lat G (>1.0) means hard cornering. Negative Long G (<-0.5) is heavy braking. Positive Delta means losing time -> yell 'Push!' or 'Focus!'. High speed + low G -> 'Brake Late!'. Keep responses under 5 words. Urgent and intense. Do not read the telemetry text out loud, just react to it." 
            }] 
          }
        },
        callbacks: {
          onopen: () => {
            console.log("Gemini Live Session Opened");
            setVoiceStatus('connected');
            setIsVoiceConnected(true);
            
            source.connect(processor);
            processor.connect(inputContext.destination);

            processor.onaudioprocess = (e) => {
              const inputData = e.inputBuffer.getChannelData(0);
              const pcmBlob = createBlob(inputData);
              sessionPromise.then(session => {
                session.sendRealtimeInput({ media: pcmBlob });
              });
            };
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
                sourcesRef.current.forEach(node => { try { node.stop(); } catch(e) {} });
                sourcesRef.current.clear();
                nextStartTimeRef.current = outputContextRef.current ? outputContextRef.current.currentTime : 0;
            }
          },
          onclose: () => {
            console.log("Gemini Live Session Closed");
            setVoiceStatus('disconnected');
            setIsVoiceConnected(false);
          },
          onerror: (err) => {
            console.error("Gemini Live Error:", err);
            setVoiceStatus('error');
            setIsVoiceConnected(false);
            disconnectVoiceCoach();
          }
        }
      });
      
      sessionPromiseRef.current = sessionPromise;

    } catch (error) {
      console.error("Failed to connect voice:", error);
      setVoiceStatus('error');
      setIsVoiceConnected(false);
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
     sourcesRef.current.forEach(node => { try { node.stop(); } catch(e) {} });
     sourcesRef.current.clear();
     if (outputContextRef.current) {
         outputContextRef.current.close();
         outputContextRef.current = null;
     }
     if (sessionPromiseRef.current) {
         sessionPromiseRef.current.then(session => session.close()).catch(console.error);
         sessionPromiseRef.current = null;
     }
     setIsVoiceConnected(false);
     setVoiceStatus('disconnected');
  };

  const toggleVoice = () => {
    if (isVoiceConnected) {
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

    if (isVoiceConnected && isActive) {
        interval = setInterval(() => {
            if (sessionPromiseRef.current) {
                const telemetryMsg = `[TELEMETRY UPDATE] Speed: ${speedRef.current}mph. Delta: ${deltaRef.current > 0 ? '+' : ''}${deltaRef.current.toFixed(2)}s. G-Lat: ${gLatRef.current.toFixed(2)}. G-Long: ${gLongRef.current.toFixed(2)}.`;
                sessionPromiseRef.current.then(session => {
                    if (typeof session.send === 'function') {
                        session.send({ parts: [{ text: telemetryMsg }] });
                    }
                }).catch(() => {});
            }
        }, 3500);
    }

    return () => clearInterval(interval);
  }, [isVoiceConnected, isActive]);

  const formatTime = (seconds: number) => {
    const mins = Math.floor(seconds / 60);
    const secs = Math.floor(seconds % 60);
    const ms = Math.floor((seconds % 1) * 100); 
    return `${mins}:${secs.toString().padStart(2, '0')}.${ms.toString().padStart(2, '0')}`;
  };

  return (
    <div className="h-full w-full relative bg-[#0B0F19] overflow-hidden">
      
      {/* --- HUD: Top Bar (Pinned Top) --- */}
      <div className="absolute top-0 left-0 right-0 z-20 grid grid-cols-4 md:flex md:h-20 border-b border-white/5 bg-[#0B0F19]/90 backdrop-blur shadow-2xl">
        <div className={`col-span-2 md:flex-1 p-2 md:p-0 flex flex-col items-center justify-center border-r border-b md:border-b-0 border-white/5 transition-colors duration-300 ${delta < 0 ? 'bg-emerald-500/10 text-emerald-500' : 'bg-rose-500/10 text-rose-500'}`}>
           <span className="text-[10px] md:text-xs uppercase font-bold tracking-widest opacity-70">Delta</span>
           <span className="text-2xl md:text-5xl font-mono font-bold tracking-tighter">
             {delta > 0 ? '+' : ''}{Math.abs(delta).toFixed(2)}
           </span>
        </div>
        
        <div className="col-span-2 md:flex-1 p-2 md:p-0 flex flex-col items-center justify-center border-r-0 md:border-r border-b md:border-b-0 border-white/5">
           <span className="text-[10px] md:text-xs text-slate-500 uppercase font-bold tracking-widest">Lap {currentLap}</span>
           <span className="text-2xl md:text-5xl font-mono font-bold text-white tracking-tighter">
             {formatTime(lapTime)}
           </span>
        </div>

        <div className="col-span-2 md:flex-1 p-2 md:p-0 flex flex-col items-center justify-center border-r border-white/5">
           <span className="text-[10px] md:text-xs text-slate-500 uppercase font-bold tracking-widest">Speed</span>
           <div className="flex items-baseline gap-1">
             <span className="text-2xl md:text-5xl font-mono font-bold text-white tracking-tighter">{speed}</span>
             <span className="text-xs md:text-sm text-slate-600 font-bold">MPH</span>
           </div>
        </div>

        <div className="col-span-2 md:flex-1 p-2 md:p-0 flex flex-col items-center justify-center">
            <span className="text-[10px] md:text-xs text-slate-500 uppercase font-bold tracking-widest">Session</span>
            <span className="text-xl md:text-4xl font-mono text-slate-400 tracking-tight">
                {formatTime(sessionTime)}
            </span>
        </div>
      </div>

      {/* --- World: Map (Full Screen Background) --- */}
      <div className="absolute inset-0 z-0 bg-[#0B0F19] pt-[80px] pb-[180px] md:pt-20 md:pb-32 flex items-center justify-center">
        <div className="w-full h-full max-w-6xl p-4">
            <TrackVisualizer 
                track={MOCK_TRACK} 
                activeSegment={progress} 
                ghostSegment={ghostProgress}
                className="w-full h-full"
            />
        </div>

        {/* G-Force Gauge (Overlay on Map) */}
        <div className="absolute bottom-72 right-4 md:bottom-56 md:right-8 pointer-events-none z-10">
            <GForceGauge lat={gLat} long={gLong} />
        </div>
        
        {/* Voice Coach Status (Overlay on Map) */}
        {isVoiceConnected && (
            <div className="absolute top-32 left-4 md:top-24 md:left-8 flex items-center gap-2 px-3 py-1.5 bg-sky-500/10 border border-sky-500/20 rounded-full backdrop-blur z-10">
                <div className="flex space-x-0.5 h-3 items-end">
                    <span className="w-0.5 bg-sky-400 animate-[bounce_1s_infinite] h-2"></span>
                    <span className="w-0.5 bg-sky-400 animate-[bounce_1.2s_infinite] h-3"></span>
                    <span className="w-0.5 bg-sky-400 animate-[bounce_0.8s_infinite] h-1.5"></span>
                </div>
                <span className="text-[10px] font-bold text-sky-400 uppercase tracking-wider">AI Coach Active</span>
            </div>
        )}
      </div>

      {/* --- HUD: Footer Controls (Pinned Bottom) --- */}
      <div className="fixed bottom-0 left-0 right-0 z-[100] w-full p-4 pb-12 md:p-6 bg-[#0B0F19]/95 backdrop-blur-xl border-t border-white/10 flex gap-3 md:justify-center items-center shadow-[0_-10px_40px_rgba(0,0,0,0.5)] border-white/10">
        
        {/* Voice Toggle */}
        <button
          onClick={toggleVoice}
          className={`shrink-0 h-14 w-14 md:h-12 md:w-14 rounded-xl flex items-center justify-center transition-all border shadow-lg active:scale-95 ${
            isVoiceConnected 
              ? 'bg-sky-500/20 border-sky-500 text-sky-400 shadow-sky-900/20' 
              : 'bg-slate-800 border-white/10 text-slate-300 hover:bg-slate-700'
          }`}
        >
          {voiceStatus === 'connecting' ? (
             <Radio className="animate-pulse" size={24} />
          ) : isVoiceConnected ? (
             <Mic size={24} />
          ) : (
             <MicOff size={24} />
          )}
        </button>

        {/* Start/Stop Button */}
        <button
          onClick={() => setIsActive(!isActive)}
          className={`flex-1 md:flex-none md:w-72 h-14 md:h-12 rounded-xl font-black uppercase tracking-widest text-sm md:text-base flex items-center justify-center gap-3 transition-all shadow-[0_0_20px_rgba(0,0,0,0.3)] whitespace-nowrap transform active:scale-95 ${
            isActive
              ? 'bg-rose-600 hover:bg-rose-500 text-white border border-rose-400 shadow-rose-900/30'
              : 'bg-[#00ffa3] hover:bg-[#00dd8c] text-black border border-[#4dffc0] shadow-[0_0_20px_rgba(0,255,163,0.3)]'
          }`}
        >
          {isActive ? (
            <>
              <Square size={20} fill="currentColor" /> <span>STOP SESSION</span>
            </>
          ) : (
            <>
              <Play size={24} fill="currentColor" /> <span>START SESSION</span>
            </>
          )}
        </button>
      </div>
    </div>
  );
};