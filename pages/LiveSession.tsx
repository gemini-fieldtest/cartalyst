import React, { useState, useEffect, useRef, useCallback } from 'react';
import { TrackVisualizer } from '../components/TrackVisualizer';
import { Play, Square, Mic, MicOff, Radio, Wifi, WifiOff, Zap, RefreshCw, Ghost } from 'lucide-react';
import { MOCK_TRACK } from '../constants';
import { GoogleGenAI, LiveServerMessage, Modality } from "@google/genai";
import { Track } from '../types';
import { TelemetryStream, type CoachingFrame, type ConnectionState } from '../services/TelemetryStreamService';
import { getHotAction, getColdAdvice, type HotAction, type ColdAdvice, type CoachPersona, type ShadowContext } from '../services/coachingService';
import { ShadowLineEngine, type ShadowState, type LapRecord } from '../services/ShadowLineEngine';

// === Audio Utilities ===

const encodeAudioBytes = (bytes: Uint8Array): string => {
  let binary = '';
  for (let i = 0; i < bytes.byteLength; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary);
};

const decodeAudioBytes = (base64: string): Uint8Array => {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
};

const floatToPCM = (data: Float32Array): { data: string; mimeType: string } => {
  const int16 = new Int16Array(data.length);
  for (let i = 0; i < data.length; i++) {
    int16[i] = Math.max(-1, Math.min(1, data[i])) * 32768;
  }
  return {
    data: encodeAudioBytes(new Uint8Array(int16.buffer)),
    mimeType: 'audio/pcm;rate=16000',
  };
};

const pcmToAudioBuffer = async (
  data: Uint8Array,
  ctx: AudioContext,
  sampleRate: number
): Promise<AudioBuffer> => {
  const int16 = new Int16Array(data.buffer);
  const buffer = ctx.createBuffer(1, int16.length, sampleRate);
  const channelData = buffer.getChannelData(0);
  for (let i = 0; i < int16.length; i++) {
    channelData[i] = int16[i] / 32768.0;
  }
  return buffer;
};

// G-force audio cue synthesizer
const synthesizeGForceCue = (ctx: AudioContext, intensity: 'corner' | 'brake') => {
  const osc = ctx.createOscillator();
  const gain = ctx.createGain();
  osc.connect(gain);
  gain.connect(ctx.destination);

  const now = ctx.currentTime;
  const [freq, dur, vol] = intensity === 'corner' ? [60, 0.15, 0.2] : [80, 0.1, 0.15];

  osc.frequency.setValueAtTime(freq, now);
  osc.frequency.exponentialRampToValueAtTime(10, now + dur);
  gain.gain.setValueAtTime(vol, now);
  gain.gain.exponentialRampToValueAtTime(0.001, now + dur);
  osc.start(now);
  osc.stop(now + dur);
};

// === Types ===

type DataSource = 'file-replay' | 'live-stream';

const CONNECTION_STATE_LABELS: Record<ConnectionState, string> = {
  idle: 'IDLE',
  connecting: 'CONNECTING',
  live: 'LIVE',
  paused: 'PAUSED',
  recovering: 'RECONNECTING',
  dead: 'DISCONNECTED'
};

// === Component ===

export default function LiveSession() {
  // Data source configuration
  const [dataSource, setDataSource] = useState<DataSource>('file-replay');
  const [streamEndpoint, setStreamEndpoint] = useState('http://localhost:8000/events');

  // Connection state from TelemetryStream service
  const [connectionState, setConnectionState] = useState<ConnectionState>('idle');

  // Session state
  const [isSessionActive, setIsSessionActive] = useState(false);

  // Current telemetry frame
  const [liveFrame, setLiveFrame] = useState<CoachingFrame | null>(null);

  // Coaching state
  const [hotAction, setHotAction] = useState<HotAction>({ action: 'STANDBY', color: '#666' });
  const [coldAdvice, setColdAdvice] = useState<ColdAdvice>({ message: "Ready for data...", detail: "Start a session to begin analysis" });
  const [activeCoach, setActiveCoach] = useState<CoachPersona>('SUPER_AJ');

  // Timing refs for throttling AI calls
  const lastHotCallRef = useRef(0);
  const lastColdCallRef = useRef(0);

  // Session timing
  const sessionStartRef = useRef(0);
  const [lapTime, setLapTime] = useState(0);
  const [delta, setDelta] = useState(0);
  const [currentLap, setCurrentLap] = useState(1);

  // Shadow Line state
  const [shadowState, setShadowState] = useState<ShadowState | null>(null);
  const [shadowEnabled, setShadowEnabled] = useState(true);
  const [completedLaps, setCompletedLaps] = useState<LapRecord[]>([]);

  // File replay state
  const replayDataRef = useRef<any[]>([]);
  const replayIndexRef = useRef(0);
  const replayIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // Track visualization
  const [activeTrack, setActiveTrack] = useState<Track>(MOCK_TRACK);
  const visualizerRef = useRef<any>(null);

  // Voice coach state
  const [voiceStatus, setVoiceStatus] = useState<'off' | 'connecting' | 'active' | 'error'>('off');
  const voiceSessionRef = useRef<Promise<any> | null>(null);
  const audioContextRefs = useRef<{
    input: AudioContext | null;
    output: AudioContext | null;
    stream: MediaStream | null;
    processor: ScriptProcessorNode | null;
    gain: GainNode | null;
    sources: Set<AudioBufferSourceNode>;
    nextPlayTime: number;
  }>({
    input: null,
    output: null,
    stream: null,
    processor: null,
    gain: null,
    sources: new Set(),
    nextPlayTime: 0
  });

  // G-force audio cue timing
  const lastGForceCueRef = useRef(0);

  // === VBOX CSV Parsing Helpers ===

  const parseVBOXCoord = (str: string): number => {
    if (!str) return 0;
    if (!str.includes('°')) return parseFloat(str) || 0;

    const match = str.match(/(\d+)°([\d.]+)\s*([NSEW])/);
    if (!match) return 0;

    let val = parseInt(match[1]) + parseFloat(match[2]) / 60;
    if (match[3] === 'S' || match[3] === 'W') val = -val;
    return val;
  };

  const parseVBOXTime = (str: string): number => {
    const s = str.trim();
    if (s.length < 6) return parseFloat(s) || 0;

    const hh = parseInt(s.substring(0, 2), 10) || 0;
    const mm = parseInt(s.substring(2, 4), 10) || 0;
    const ss = parseFloat(s.substring(4)) || 0;
    return hh * 3600 + mm * 60 + ss;
  };

  // === Load CSV for file replay mode ===

  useEffect(() => {
    fetch('/VBOX0240.csv')
      .then(r => r.text())
      .then(text => {
        const lines = text.split('\n');
        if (lines.length < 2) return;

        const rows = lines.slice(1).map(line => {
          const cols = line.split(',');
          if (cols.length < 18) return null;

          return {
            time: parseVBOXTime(cols[0]),
            speed: parseFloat(cols[2]) || 0,
            heading: parseFloat(cols[3]) || 0,
            lat: parseVBOXCoord(cols[4]),
            lon: parseVBOXCoord(cols[5]),
            gLat: parseFloat(cols[16]) || 0,
            gLong: parseFloat(cols[17]) || 0,
            throttle: parseFloat(cols[40]) || 0,
            brake: parseFloat(cols[25]) || 0,
            rpm: parseFloat(cols[29]) || 0,
            gear: parseInt(cols[32]) || 0,
            steering: parseFloat(cols[39]) || 0
          };
        }).filter(Boolean);

        replayDataRef.current = rows;

        // Build track visualization from GPS points
        const SCALE_X = 80000, SCALE_Y = 100000;
        const cx = 350, cy = 250;
        const center = MOCK_TRACK.center;
        const sampleRate = Math.max(1, Math.floor(rows.length / 1000));

        const mapPoints = [];
        for (let i = 0; i < rows.length; i += sampleRate) {
          const r = rows[i] as any;
          const dx = (r.lon - center.lng) * SCALE_X;
          const dy = (center.lat - r.lat) * SCALE_Y;
          mapPoints.push({ x: cx + dx, y: cy + dy });
        }

        const duration = rows.length > 1
          ? ((rows[rows.length - 1] as any).time - (rows[0] as any).time)
          : 108.5;

        setActiveTrack(prev => ({ ...prev, mapPoints, recordLap: duration }));
      })
      .catch(console.error);
  }, []);

  // === Configure Shadow Line Engine ===

  useEffect(() => {
    // Configure based on current track
    if (activeTrack.center) {
      ShadowLineEngine.configure({
        startFinishLine: { lat: activeTrack.center.lat, lon: activeTrack.center.lng },
        startFinishRadius: 30,
        minLapTime: 30,
        sectors: activeTrack.sectors.map(s => ({
          id: s.id,
          name: s.name,
          startDistance: s.startDist,
          endDistance: s.endDist
        })),
        trackLength: activeTrack.length
      });
    }
  }, [activeTrack]);

  // === Subscribe to Shadow Line Engine ===

  useEffect(() => {
    const unsubShadow = ShadowLineEngine.subscribe((state) => {
      setShadowState(state);
      // Update delta from shadow state
      if (state.currentDelta !== undefined) {
        setDelta(state.currentDelta);
      }
    });

    const unsubLap = ShadowLineEngine.onLapComplete((lap) => {
      setCompletedLaps(ShadowLineEngine.getCompletedLaps());
      setCurrentLap(lap.lapNumber + 1);
      setLapTime(lap.lapTime);
    });

    return () => {
      unsubShadow();
      unsubLap();
    };
  }, []);

  // === Subscribe to TelemetryStream service ===

  useEffect(() => {
    const unsubState = TelemetryStream.onStateChange(setConnectionState);
    const unsubFrame = TelemetryStream.subscribe(handleIncomingFrame);

    return () => {
      unsubState();
      unsubFrame();
    };
  }, [activeCoach]); // Re-subscribe when coach changes to capture in closure

  // === Handle incoming telemetry frame ===

  const handleIncomingFrame = useCallback((frame: CoachingFrame) => {
    setLiveFrame(frame);

    // Feed frame to Shadow Line Engine for lap detection and delta calculation
    if (shadowEnabled) {
      ShadowLineEngine.ingest(frame);
    }

    // Update visualizer
    if (visualizerRef.current) {
      visualizerRef.current.updatePosition({
        lat: frame.lat,
        lon: frame.lon,
        heading: frame.heading
      });

      const elapsed = performance.now() - sessionStartRef.current;
      const ghostProgress = (elapsed % (activeTrack.recordLap * 1000)) / (activeTrack.recordLap * 1000);
      visualizerRef.current.updateProgress(0, ghostProgress);
    }

    // G-force audio feedback
    triggerGForceCue(frame.gLateral, frame.gLongitudinal);

    // AI Coaching - Hot Path (throttled to 10Hz)
    const now = performance.now();
    if (now - lastHotCallRef.current > 100) {
      lastHotCallRef.current = now;

      getHotAction({
        speedKmh: frame.speedKmh,
        rpm: frame.rpm,
        throttle: frame.throttlePct,
        brakePos: frame.brakePct,
        latG: frame.gLateral,
        longG: frame.gLongitudinal
      }, activeCoach).then(setHotAction);
    }

    // AI Coaching - Cold Path (throttled to every 5s)
    if (now - lastColdCallRef.current > 5000) {
      lastColdCallRef.current = now;

      // Build shadow context for AI coaching
      const currentShadowState = ShadowLineEngine.getState();
      let shadowCtx: ShadowContext | undefined;

      if (shadowEnabled && currentShadowState.shadowLapId) {
        const currentSector = currentShadowState.sectorDeltas.findIndex((_, idx) => {
          const sector = activeTrack.sectors[idx];
          return sector && currentShadowState.distanceInLap >= sector.startDist && currentShadowState.distanceInLap < sector.endDist;
        });

        shadowCtx = {
          delta: currentShadowState.currentDelta,
          sectorIndex: currentSector >= 0 ? currentSector : 0,
          sectorDeltas: currentShadowState.sectorDeltas,
          distanceInLap: currentShadowState.distanceInLap,
          shadowSpeedKmh: currentShadowState.shadowPosition?.speedKmh
        };
      }

      getColdAdvice({
        speedKmh: frame.speedKmh,
        rpm: frame.rpm,
        throttle: frame.throttlePct,
        brakePos: frame.brakePct,
        latG: frame.gLateral,
        longG: frame.gLongitudinal
      }, activeCoach, shadowCtx).then(advice => {
        if (advice.message) setColdAdvice(advice);
      });
    }
  }, [activeCoach, activeTrack.recordLap, activeTrack.sectors, shadowEnabled]);

  // === G-Force Audio Cues ===

  const triggerGForceCue = (gLat: number, gLong: number) => {
    if (voiceStatus !== 'active') return;

    const ctx = audioContextRefs.current.output;
    if (!ctx) return;

    const now = performance.now();
    if (now - lastGForceCueRef.current < 3000) return;

    if (Math.abs(gLat) > 1.35) {
      synthesizeGForceCue(ctx, 'corner');
      lastGForceCueRef.current = now;
    } else if (gLong < -0.8) {
      synthesizeGForceCue(ctx, 'brake');
      lastGForceCueRef.current = now;
    }
  };

  // === Session Control ===

  const startSession = () => {
    sessionStartRef.current = performance.now();
    setIsSessionActive(true);
    setHotAction({ action: 'READY', color: '#22c55e' });
    setCurrentLap(1);
    setLapTime(0);
    setDelta(0);

    // Reset Shadow Line Engine for new session
    ShadowLineEngine.reset();
    setCompletedLaps([]);
    setShadowState(null);

    if (dataSource === 'file-replay') {
      startFileReplay();
    } else {
      TelemetryStream.connect(streamEndpoint);
    }
  };

  const stopSession = () => {
    setIsSessionActive(false);
    setHotAction({ action: 'STANDBY', color: '#666' });

    if (dataSource === 'file-replay') {
      stopFileReplay();
    } else {
      TelemetryStream.disconnect();
    }
  };

  // === File Replay Engine ===

  const startFileReplay = () => {
    if (replayDataRef.current.length === 0) return;

    replayIndexRef.current = 0;

    replayIntervalRef.current = setInterval(() => {
      const data = replayDataRef.current;
      if (data.length === 0) return;

      const row = data[replayIndexRef.current];

      // Convert to CoachingFrame format
      const frame: CoachingFrame = {
        seq: replayIndexRef.current,
        timestamp: Date.now(),
        lat: row.lat,
        lon: row.lon,
        altitude: 0,
        heading: row.heading,
        speedKmh: row.speed,
        gLateral: row.gLat,
        gLongitudinal: row.gLong,
        throttlePct: row.throttle,
        brakePct: row.brake,
        steeringDeg: row.steering,
        rpm: row.rpm,
        gear: row.gear,
        isGpsDerived: false
      };

      handleIncomingFrame(frame);

      // Lap detection on index wrap
      const prevIndex = replayIndexRef.current;
      replayIndexRef.current = (replayIndexRef.current + 1) % data.length;

      if (replayIndexRef.current === 0 && prevIndex > 0) {
        setCurrentLap(prev => prev + 1);
        setLapTime(data.length / 10); // Assume 10Hz
        setDelta((Math.random() - 0.5) * 2);
      }
    }, 100); // 10Hz playback
  };

  const stopFileReplay = () => {
    if (replayIntervalRef.current) {
      clearInterval(replayIntervalRef.current);
      replayIntervalRef.current = null;
    }
  };

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      stopFileReplay();
      TelemetryStream.disconnect();
      cleanupVoiceCoach();
    };
  }, []);

  // === Voice Coach ===

  const initVoiceCoach = async () => {
    if (voiceStatus === 'connecting' || voiceStatus === 'active') return;

    try {
      setVoiceStatus('connecting');

      const apiKey = (import.meta as any).env?.VITE_GEMINI_API_KEY || localStorage.getItem('GEMINI_API_KEY');
      if (!apiKey) throw new Error("Gemini API Key not found");

      const ai = new GoogleGenAI({ apiKey });

      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });

      const inputCtx = new AudioContext({ sampleRate: 16000 });
      const outputCtx = new AudioContext({ sampleRate: 24000 });

      if (inputCtx.state === 'suspended') await inputCtx.resume();
      if (outputCtx.state === 'suspended') await outputCtx.resume();

      const source = inputCtx.createMediaStreamSource(stream);
      const processor = inputCtx.createScriptProcessor(4096, 1, 1);
      const gain = outputCtx.createGain();
      gain.connect(outputCtx.destination);

      audioContextRefs.current = {
        input: inputCtx,
        output: outputCtx,
        stream,
        processor,
        gain,
        sources: new Set(),
        nextPlayTime: outputCtx.currentTime
      };

      const session = ai.live.connect({
        model: 'gemini-2.0-flash-exp',
        config: {
          responseModalities: [Modality.AUDIO],
          speechConfig: {
            voiceConfig: { prebuiltVoiceConfig: { voiceName: 'Kore' } }
          },
          systemInstruction: {
            parts: [{
              text: `You are an elite F1 Race Engineer. Provide calm, precise radio communications.
Use jargon: 'Copy', 'Box box', 'Mode Push', 'Purple sector', 'Delta plus/minus'.
Keep messages under 8 words. Focus on lap times, deltas, and sector performance.
Only speak when there's significant change or advice needed.`
            }]
          }
        },
        callbacks: {
          onopen: () => {
            setVoiceStatus('active');

            source.connect(processor);
            processor.connect(inputCtx.destination);

            processor.onaudioprocess = (e) => {
              const pcm = floatToPCM(e.inputBuffer.getChannelData(0));
              voiceSessionRef.current?.then(s => s.sendRealtimeInput({ media: pcm }));
            };

            // Initial radio check
            session.then(s => (s as any).send?.({ parts: [{ text: "Radio check." }] }));
          },
          onmessage: async (msg: LiveServerMessage) => {
            const audio = msg.serverContent?.modelTurn?.parts?.[0]?.inlineData?.data;
            if (audio && audioContextRefs.current.output && audioContextRefs.current.gain) {
              const ctx = audioContextRefs.current.output;
              const refs = audioContextRefs.current;

              refs.nextPlayTime = Math.max(refs.nextPlayTime, ctx.currentTime);
              const buffer = await pcmToAudioBuffer(decodeAudioBytes(audio), ctx, 24000);
              const src = ctx.createBufferSource();
              src.buffer = buffer;
              src.connect(refs.gain!);
              src.addEventListener('ended', () => refs.sources.delete(src));
              src.start(refs.nextPlayTime);
              refs.nextPlayTime += buffer.duration;
              refs.sources.add(src);
            }

            if (msg.serverContent?.interrupted) {
              audioContextRefs.current.sources.forEach(s => { try { s.stop(); } catch {} });
              audioContextRefs.current.sources.clear();
              audioContextRefs.current.nextPlayTime = audioContextRefs.current.output?.currentTime || 0;
            }
          },
          onclose: () => setVoiceStatus('off'),
          onerror: () => {
            setVoiceStatus('error');
            cleanupVoiceCoach();
          }
        }
      });

      voiceSessionRef.current = session;

    } catch (err) {
      console.error('Voice coach init failed:', err);
      setVoiceStatus('error');
    }
  };

  const cleanupVoiceCoach = () => {
    const refs = audioContextRefs.current;

    refs.stream?.getTracks().forEach(t => t.stop());
    refs.processor?.disconnect();
    refs.sources.forEach(s => { try { s.stop(); } catch {} });
    refs.input?.close();
    refs.output?.close();

    voiceSessionRef.current?.then(s => s.close()).catch(() => {});
    voiceSessionRef.current = null;

    audioContextRefs.current = {
      input: null, output: null, stream: null,
      processor: null, gain: null, sources: new Set(), nextPlayTime: 0
    };

    setVoiceStatus('off');
  };

  const toggleVoice = () => {
    if (voiceStatus === 'active') {
      cleanupVoiceCoach();
    } else {
      initVoiceCoach();
    }
  };

  // === Render ===

  const isConnected = connectionState === 'live' || (dataSource === 'file-replay' && isSessionActive);
  const displaySpeed = liveFrame?.speedKmh ?? 0;
  const displayGLat = liveFrame?.gLateral ?? 0;
  const displayGLong = liveFrame?.gLongitudinal ?? 0;

  return (
    <div className="flex-1 relative flex flex-col h-full bg-slate-900 overflow-hidden">

      {/* Track Visualization Background */}
      <div className="absolute inset-0 z-0">
        <TrackVisualizer ref={visualizerRef} track={activeTrack} shadowState={shadowEnabled ? shadowState : null} />
      </div>

      {/* HUD Overlay */}
      <div className="relative z-10 p-4 md:p-8 flex flex-col justify-between h-full pointer-events-none">

        {/* Data Source Selector */}
        <div className="absolute top-4 left-4 z-50 flex flex-col gap-2 pointer-events-auto">
          <div className="flex gap-2">
            <button
              onClick={() => { setDataSource('file-replay'); stopSession(); }}
              className={`px-3 py-1.5 text-xs font-bold rounded-lg border transition-all ${
                dataSource === 'file-replay'
                  ? 'bg-blue-600/80 border-blue-400 text-white shadow-[0_0_10px_rgba(37,99,235,0.5)]'
                  : 'bg-black/40 border-slate-700 text-slate-400 backdrop-blur hover:bg-black/60'
              }`}
            >
              FILE REPLAY
            </button>
            <button
              onClick={() => { setDataSource('live-stream'); stopSession(); }}
              className={`px-3 py-1.5 text-xs font-bold rounded-lg border flex items-center gap-2 transition-all ${
                dataSource === 'live-stream'
                  ? 'bg-purple-600/80 border-purple-400 text-white shadow-[0_0_10px_rgba(147,51,234,0.5)]'
                  : 'bg-black/40 border-slate-700 text-slate-400 backdrop-blur hover:bg-black/60'
              }`}
            >
              LIVE STREAM
              <div className={`w-2 h-2 rounded-full transition-colors ${
                connectionState === 'live' ? 'bg-emerald-400 shadow-[0_0_5px_#34d399]' :
                connectionState === 'recovering' ? 'bg-amber-400 animate-pulse' :
                'bg-slate-500'
              }`} />
            </button>
          </div>

          {/* Connection status badge for live mode */}
          {dataSource === 'live-stream' && (
            <div className={`text-[10px] px-2 py-1 rounded border flex items-center gap-2 ${
              connectionState === 'live' ? 'bg-emerald-900/50 border-emerald-500/30 text-emerald-300' :
              connectionState === 'recovering' ? 'bg-amber-900/50 border-amber-500/30 text-amber-300' :
              connectionState === 'dead' ? 'bg-red-900/50 border-red-500/30 text-red-300' :
              'bg-black/60 border-slate-700 text-slate-400'
            }`}>
              {connectionState === 'recovering' && <RefreshCw size={10} className="animate-spin" />}
              {connectionState === 'live' && <Wifi size={10} />}
              {connectionState === 'dead' && <WifiOff size={10} />}
              <span>{CONNECTION_STATE_LABELS[connectionState]}</span>
            </div>
          )}
        </div>

        {/* Telemetry Header */}
        <div className="flex justify-between items-start pointer-events-auto">
          <div className="glass-panel p-3 md:p-4 rounded-xl flex gap-6 md:gap-8 backdrop-blur-xl bg-slate-900/50 border border-white/10">
            <div>
              <p className="text-[10px] text-slate-400 font-bold uppercase tracking-widest">Lap</p>
              <p className="text-2xl md:text-4xl font-mono font-black text-white tabular-nums">
                {currentLap}
              </p>
            </div>
            <div>
              <p className="text-[10px] text-slate-400 font-bold uppercase tracking-widest">Delta</p>
              <p className={`text-2xl md:text-4xl font-mono font-black tabular-nums ${
                delta > 0 ? 'text-rose-500' : 'text-emerald-500'
              }`}>
                {delta > 0 ? '+' : ''}{delta.toFixed(2)}
              </p>
            </div>
            <div className="hidden md:block">
              <p className="text-[10px] text-slate-400 font-bold uppercase tracking-widest">Speed</p>
              <p className="text-2xl md:text-4xl font-mono font-black text-white">
                {Math.round(displaySpeed)}<span className="text-lg text-slate-500">km/h</span>
              </p>
            </div>
            <div className="hidden lg:block">
              <p className="text-[10px] text-slate-400 font-bold uppercase tracking-widest">G-Force</p>
              <p className="text-lg font-mono text-white">
                <span className={displayGLat > 0.5 ? 'text-blue-400' : displayGLat < -0.5 ? 'text-orange-400' : ''}>
                  L:{displayGLat.toFixed(1)}
                </span>
                {' / '}
                <span className={displayGLong < -0.5 ? 'text-red-400' : displayGLong > 0.3 ? 'text-green-400' : ''}>
                  A:{displayGLong.toFixed(1)}
                </span>
              </p>
            </div>
          </div>

          {/* AI Status + Shadow Line */}
          <div className="flex flex-col gap-2 items-end">
            {/* Shadow Line Toggle & Status */}
            <button
              onClick={() => setShadowEnabled(!shadowEnabled)}
              className={`px-3 py-1.5 rounded-full flex items-center gap-2 border transition-all backdrop-blur ${
                shadowEnabled
                  ? 'border-purple-500/50 bg-purple-950/30 shadow-[0_0_15px_rgba(168,85,247,0.3)]'
                  : 'border-slate-700 bg-slate-900/50 opacity-60'
              }`}
            >
              <Ghost size={12} className={shadowEnabled ? 'text-purple-400' : 'text-slate-500'} />
              <span className="text-[10px] font-bold uppercase tracking-wider text-slate-300">
                SHADOW {shadowEnabled ? 'ON' : 'OFF'}
              </span>
              {shadowEnabled && shadowState?.shadowLapId && (
                <span className="text-[9px] text-purple-400/70 font-mono">
                  L{completedLaps.length}
                </span>
              )}
            </button>

            {/* Sector Deltas */}
            {shadowEnabled && shadowState && shadowState.sectorDeltas.length > 0 && (
              <div className="flex gap-1">
                {shadowState.sectorDeltas.map((delta, idx) => (
                  <div
                    key={idx}
                    className={`px-2 py-1 rounded text-[9px] font-mono font-bold tabular-nums border backdrop-blur ${
                      delta < -0.1 ? 'bg-emerald-950/50 border-emerald-500/30 text-emerald-400' :
                      delta > 0.1 ? 'bg-rose-950/50 border-rose-500/30 text-rose-400' :
                      'bg-slate-800/50 border-slate-600/30 text-slate-400'
                    }`}
                  >
                    S{idx + 1}: {delta > 0 ? '+' : ''}{delta.toFixed(2)}
                  </div>
                ))}
              </div>
            )}

            {/* AI Status */}
            <div className={`px-3 py-1.5 rounded-full flex items-center gap-2 border transition-colors backdrop-blur ${
              voiceStatus === 'active' ? 'border-emerald-500/50 bg-emerald-950/30' :
              isSessionActive ? 'border-amber-500/50 bg-amber-950/30' :
              'border-slate-700 bg-slate-900/50'
            }`}>
              {voiceStatus === 'connecting' && <div className="w-2 h-2 rounded-full bg-amber-500 animate-ping" />}
              {voiceStatus === 'active' && <Zap size={12} className="text-emerald-400" />}
              {voiceStatus === 'off' && isSessionActive && <div className="w-2 h-2 rounded-full bg-amber-500" />}
              {voiceStatus === 'off' && !isSessionActive && <div className="w-2 h-2 rounded-full bg-slate-500" />}

              <span className="text-[10px] font-bold uppercase tracking-wider text-slate-300">
                {voiceStatus === 'active' ? 'VOICE ACTIVE' : isSessionActive ? 'AI COACHING' : 'STANDBY'}
              </span>
            </div>
          </div>
        </div>

        {/* Hot Action Display */}
        <div className="absolute top-32 left-0 right-0 z-30 pointer-events-none p-4 flex flex-col gap-4">
          <div className="flex justify-center">
            <div
              className="flex flex-col items-center gap-1 transition-all duration-200"
              style={{
                transform: hotAction.action !== 'STANDBY' ? 'scale(1.1)' : 'scale(1)',
                opacity: hotAction.action !== 'STANDBY' ? 1 : 0.5
              }}
            >
              <div
                className="px-6 py-2 bg-black/80 backdrop-blur border-2 rounded-full shadow-2xl flex items-center gap-3"
                style={{ borderColor: hotAction.color }}
              >
                <span
                  className="w-3 h-3 rounded-full animate-pulse"
                  style={{ backgroundColor: hotAction.color }}
                />
                <span
                  className="text-2xl md:text-4xl font-black italic tracking-tighter text-white uppercase"
                  style={{ textShadow: `0 0 20px ${hotAction.color}` }}
                >
                  {hotAction.action}
                </span>
              </div>
            </div>
          </div>

          {/* Cold Advice Panel */}
          <div className="flex justify-end px-4">
            {coldAdvice.message !== "Ready for data..." && (
              <div className="max-w-sm w-full bg-[#111]/90 backdrop-blur-md border border-[#333] rounded-xl overflow-hidden shadow-2xl">
                <div className="px-4 py-2 bg-[#1a1a1a] border-b border-[#333] flex justify-between items-center">
                  <span className="text-[10px] font-bold text-purple-400 uppercase tracking-wider">
                    {activeCoach === 'SUPER_AJ' ? 'SUPER COACH' : activeCoach}
                  </span>
                  {coldAdvice.latency && (
                    <span className="text-[10px] font-mono text-[#666]">{Math.round(coldAdvice.latency)}ms</span>
                  )}
                </div>
                <div className="p-4">
                  <div className="text-lg font-bold text-white leading-tight mb-2">"{coldAdvice.message}"</div>
                  <div className="text-xs text-gray-400 leading-relaxed font-mono">{coldAdvice.detail}</div>
                </div>
              </div>
            )}
          </div>
        </div>

        {/* Coach Selector */}
        <div className="absolute top-20 right-4 md:right-8 z-30 pointer-events-auto flex flex-col items-end gap-2">
          <div className="bg-black/80 backdrop-blur border border-white/20 rounded-lg p-2 flex flex-col gap-2">
            <span className="text-[10px] text-zinc-400 font-bold uppercase tracking-wider text-right">Coach</span>
            <div className="flex gap-1">
              {(['SUPER_AJ', 'AJ', 'TONY', 'RACHEL', 'GARMIN'] as CoachPersona[]).map(coach => (
                <button
                  key={coach}
                  onClick={() => setActiveCoach(coach)}
                  className={`px-2 py-1 rounded text-[9px] font-bold uppercase tracking-wider transition-all ${
                    activeCoach === coach
                      ? 'bg-white text-black shadow-lg scale-105'
                      : 'bg-zinc-800 text-zinc-500 hover:bg-zinc-700 hover:text-zinc-300'
                  }`}
                >
                  {coach === 'SUPER_AJ' ? 'S' : coach[0]}
                </button>
              ))}
            </div>
          </div>
        </div>

        {/* Footer Controls */}
        <div className="flex justify-center gap-4 pointer-events-auto pb-8">
          <button
            onClick={isSessionActive ? stopSession : startSession}
            className={`h-12 px-8 rounded-full font-black uppercase tracking-widest text-sm flex items-center justify-center gap-2 transition-all shadow-lg ${
              isSessionActive
                ? 'bg-rose-600 hover:bg-rose-500 text-white border border-rose-400'
                : 'bg-[#00ffa3] hover:bg-[#00dd8c] text-black border border-[#4dffc0]'
            }`}
          >
            {isSessionActive ? (
              <><Square size={16} fill="currentColor" /> STOP</>
            ) : (
              <><Play size={20} fill="currentColor" /> START {dataSource === 'live-stream' ? 'STREAM' : 'REPLAY'}</>
            )}
          </button>

          <button
            onClick={toggleVoice}
            className={`h-12 w-12 rounded-full flex items-center justify-center transition-all border shadow-lg ${
              voiceStatus === 'active'
                ? 'bg-sky-500/20 border-sky-500 text-sky-400'
                : 'bg-slate-800 border-white/10 text-slate-300 hover:bg-slate-700'
            }`}
          >
            {voiceStatus === 'connecting' ? (
              <Radio className="animate-pulse" size={20} />
            ) : voiceStatus === 'active' ? (
              <Mic size={20} />
            ) : (
              <MicOff size={20} />
            )}
          </button>
        </div>
      </div>
    </div>
  );
}
