import React, { useMemo, useState, useRef, useEffect, forwardRef, useImperativeHandle } from 'react';
import { Track } from '../types';
import { type ShadowState, type ShadowPoint } from '../services/ShadowLineEngine';

interface TrackVisualizerProps {
    track: Track;
    className?: string;
    activeSegment?: number | null;
    ghostSegment?: number | null;
    shadowState?: ShadowState | null;
}

// 3D Math Helper with Dynamic Scaling
const projectPoint = (
    x: number,
    y: number,
    yaw: number,
    pitch: number,
    width: number,
    height: number,
    scaleFactor: number,
    trackCx: number,
    trackCy: number
) => {
    // 1. Center the track relative to its own bounding box center
    let x0 = x - trackCx;
    let y0 = y - trackCy;

    // 2. Apply Dynamic Scale (Fit to Container)
    x0 *= scaleFactor;
    y0 *= scaleFactor;

    // 3. Rotate (Yaw) around Y axis
    const cosYaw = Math.cos(yaw);
    const sinYaw = Math.sin(yaw);
    const x1 = x0 * cosYaw - y0 * sinYaw;
    const y1 = x0 * sinYaw + y0 * cosYaw;

    // 4. Map 2D Y to 3D Z (flat ground plane)
    // 5. Apply Pitch (Camera Tilt)
    // Y_c = -y1 * sin(pitch)
    // Z_c = y1 * cos(pitch)

    // Offset camera distance (scaled relative to container size to maintain perspective)
    const camDist = 600 * scaleFactor;
    const zFinal = y1 * Math.cos(pitch) + camDist;

    // 6. Perspective Projection
    const focalLength = 500 * scaleFactor;
    const pScale = focalLength / Math.max(0.1, zFinal); // Avoid divide by zero

    const xScreen = x1 * pScale + width / 2;
    // We add a vertical offset to simulate camera height
    const yScreen = (y1 * Math.sin(pitch)) * pScale + height / 2 + (50 * scaleFactor);

    return { x: xScreen, y: yScreen, scale: pScale };
};

export const TrackVisualizer = forwardRef<any, TrackVisualizerProps>(({ track, className, activeSegment, ghostSegment, shadowState }, ref) => {
    const containerRef = useRef<HTMLDivElement>(null);
    const [yaw, setYaw] = useState(0);
    const [pitch, setPitch] = useState(0.8);
    const [dims, setDims] = useState({ w: 700, h: 500 });
    const [hoverProgress, setHoverProgress] = useState<number | null>(null);

    // Internal state for imperative updates
    const [internalUserPos, setInternalUserPos] = useState<{ x: number, y: number } | null>(null);
    const [internalUserPath, setInternalUserPath] = useState<{ x: number, y: number }[]>([]);
    const [internalGhostProg, setInternalGhostProg] = useState<number | null>(null);
    const [internalGhostPos, setInternalGhostPos] = useState<{ x: number, y: number } | null>(null);

    useImperativeHandle(ref, () => ({
        updatePosition: (data: { lat: number; lon: number; heading: number }) => {
            // Simple Equirectangular projection for demo
            // Center is roughly track.center
            // Scale factor derived from trial/error or constants
            const SCALE_X = 80000;
            const SCALE_Y = 100000; // Latitude degrees are taller approx

            if (!track || !track.center) return;

            const dx = (data.lon - track.center.lng) * SCALE_X;
            const dy = (track.center.lat - data.lat) * SCALE_Y; // Invert Y for screen coords

            // Offset to map center (350, 250 default)
            // But we want to map it to the track's visual bbox?
            // MOCK_TRACK bbox is around (50,150) to (600,450). Center approx 325, 300.

            // Dynamic centering if we assume 0,0 is track center
            const cx = 350;
            const cy = 250;

            setInternalUserPos({ x: cx + dx, y: cy + dy });
            setInternalUserPath(prev => {
                const newPt = { x: cx + dx, y: cy + dy };
                // Keep last 1000 points to avoid memory issues
                return [...prev, newPt].slice(-1000);
            });
        },
        updateProgress: (userProg: number, ghostProg: number) => {
            setInternalGhostProg(ghostProg);
        }
    }), [track]); // Depend on track to update projection context


    // Resize observer to keep 3D center correct
    useEffect(() => {
        if (!containerRef.current) return;
        const observer = new ResizeObserver((entries) => {
            const { width, height } = entries[0].contentRect;
            setDims({ w: width, h: height });
        });
        observer.observe(containerRef.current);
        return () => observer.disconnect();
    }, []);

    // Calculate Dynamic Bounds and Auto-Fit Scale
    const { fitScale, trackCx, trackCy } = useMemo(() => {
        if (!track || track.mapPoints.length === 0) {
            return { fitScale: 1, trackCx: 0, trackCy: 0 };
        }

        let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
        track.mapPoints.forEach(p => {
            if (p.x < minX) minX = p.x;
            if (p.x > maxX) maxX = p.x;
            if (p.y < minY) minY = p.y;
            if (p.y > maxY) maxY = p.y;
        });

        const trackW = maxX - minX;
        const trackH = maxY - minY;
        const cx = (minX + maxX) / 2;
        const cy = (minY + maxY) / 2;

        // Margins
        const scaleX = (dims.w * 0.8) / trackW;
        const scaleY = (dims.h * 0.8) / trackH;

        // Use the smaller scale to fit whole track
        // Clamp scale to reasonable limits if track is tiny/huge
        const scale = Math.min(scaleX, scaleY);

        return { fitScale: scale, trackCx: cx, trackCy: cy };
    }, [dims, track]);

    // Interaction handlers
    const handlePointerMove = (e: React.PointerEvent) => {
        if (e.buttons === 1) { // Drag to rotate
            setYaw(y => y + e.movementX * 0.005);
            setPitch(p => Math.max(0.1, Math.min(1.5, p + e.movementY * 0.005)));
        } else {
            // Raycast logic: Find closest point on projected track to mouse
            const rect = containerRef.current?.getBoundingClientRect();
            if (!rect) return;
            const mx = e.clientX - rect.left;
            const my = e.clientY - rect.top;

            let minDist = 30; // Snap radius
            let bestIdx = -1;

            track.mapPoints.forEach((p, i) => {
                const proj = projectPoint(p.x, p.y, yaw, pitch, dims.w, dims.h, fitScale, trackCx, trackCy);
                const dist = Math.sqrt((proj.x - mx) ** 2 + (proj.y - my) ** 2);
                if (dist < minDist) {
                    minDist = dist;
                    bestIdx = i;
                }
            });

            if (bestIdx !== -1) {
                setHoverProgress(bestIdx / (track.mapPoints.length - 1));
            } else {
                setHoverProgress(null);
            }
        }
    };

    // Pre-calculate projected path string
    const pathData = useMemo(() => {
        return track.mapPoints.map((p, i) => {
            const proj = projectPoint(p.x, p.y, yaw, pitch, dims.w, dims.h, fitScale, trackCx, trackCy);
            return `${i === 0 ? 'M' : 'L'} ${proj.x.toFixed(1)} ${proj.y.toFixed(1)}`;
        }).join(' ');
    }, [track, yaw, pitch, dims, fitScale, trackCx, trackCy]);

    // Live User Path (Trail)
    const userPathData = useMemo(() => {
        return internalUserPath.map((p, i) => {
            const proj = projectPoint(p.x, p.y, yaw, pitch, dims.w, dims.h, fitScale, trackCx, trackCy);
            return `${i === 0 ? 'M' : 'L'} ${proj.x.toFixed(1)} ${proj.y.toFixed(1)}`;
        }).join(' ');
    }, [internalUserPath, yaw, pitch, dims, fitScale, trackCx, trackCy]);

    // Helper to get 3D pos for cars
    const get3DPos = (prog: number | null | undefined) => {
        if (prog == null) return null;
        const safeProg = Math.max(0, Math.min(1, prog));
        const totalPoints = track.mapPoints.length;
        const idx = Math.floor(safeProg * (totalPoints - 1));
        const nextIdx = Math.min(idx + 1, totalPoints - 1);
        const sub = (safeProg * (totalPoints - 1)) - idx;

        const p1 = track.mapPoints[idx];
        const p2 = track.mapPoints[nextIdx];

        // Interpolate 2D first
        const x2d = p1.x + (p2.x - p1.x) * sub;
        const y2d = p1.y + (p2.y - p1.y) * sub;

        return projectPoint(x2d, y2d, yaw, pitch, dims.w, dims.h, fitScale, trackCx, trackCy);
    };

    const user3D = useMemo(() => {
        if (internalUserPos) {
            return projectPoint(internalUserPos.x, internalUserPos.y, yaw, pitch, dims.w, dims.h, fitScale, trackCx, trackCy);
        }
        return get3DPos(activeSegment);
    }, [activeSegment, internalUserPos, yaw, pitch, dims, fitScale, trackCx, trackCy]);
    const ghost3D = useMemo(() => {
        const prog = internalGhostProg ?? ghostSegment;
        if (prog !== undefined) return get3DPos(prog);
        return null;
    }, [internalGhostProg, ghostSegment, yaw, pitch, dims, fitScale, get3DPos, trackCx, trackCy]);
    const hover3D = useMemo(() => get3DPos(hoverProgress!), [hoverProgress, yaw, pitch, dims, fitScale, trackCx, trackCy]);

    // Shadow Line position (from shadowState)
    const shadow3D = useMemo(() => {
        if (!shadowState?.shadowPosition || !track.center) return null;

        const SCALE_X = 80000;
        const SCALE_Y = 100000;
        const cx = 350;
        const cy = 250;

        const sp = shadowState.shadowPosition;
        const dx = (sp.lon - track.center.lng) * SCALE_X;
        const dy = (track.center.lat - sp.lat) * SCALE_Y;

        return projectPoint(cx + dx, cy + dy, yaw, pitch, dims.w, dims.h, fitScale, trackCx, trackCy);
    }, [shadowState?.shadowPosition, track.center, yaw, pitch, dims, fitScale, trackCx, trackCy]);

    // Shadow echo trail path
    const shadowEchoPath = useMemo(() => {
        if (!shadowState?.echoTrail.shadow || shadowState.echoTrail.shadow.length < 2 || !track.center) return '';

        const SCALE_X = 80000;
        const SCALE_Y = 100000;
        const cx = 350;
        const cy = 250;

        return shadowState.echoTrail.shadow.map((p, i) => {
            const dx = (p.lon - track.center!.lng) * SCALE_X;
            const dy = (track.center!.lat - p.lat) * SCALE_Y;
            const proj = projectPoint(cx + dx, cy + dy, yaw, pitch, dims.w, dims.h, fitScale, trackCx, trackCy);
            return `${i === 0 ? 'M' : 'L'} ${proj.x.toFixed(1)} ${proj.y.toFixed(1)}`;
        }).join(' ');
    }, [shadowState?.echoTrail.shadow, track.center, yaw, pitch, dims, fitScale, trackCx, trackCy]);

    // Calculate delta color
    const deltaColor = useMemo(() => {
        if (!shadowState) return '#ffffff';
        const delta = shadowState.currentDelta;
        if (delta < -0.1) return '#22c55e'; // Ahead - green
        if (delta > 0.1) return '#ef4444';  // Behind - red
        return '#eab308'; // Even - yellow
    }, [shadowState?.currentDelta]);

    return (
        <div
            ref={containerRef}
            className={`relative overflow-hidden cursor-crosshair touch-none w-full h-full ${className}`}
            onPointerMove={handlePointerMove}
        >
            {/* 3D Scene SVG */}
            <svg width="100%" height="100%" className="block">
                <defs>
                    <linearGradient id="neonGradient" x1="0%" y1="0%" x2="100%" y2="0%">
                        <stop offset="0%" stopColor="#0ea5e9" />
                        <stop offset="100%" stopColor="#10b981" />
                    </linearGradient>
                    {/* Shadow Line Gradient - Ethereal purple/magenta */}
                    <linearGradient id="shadowLineGradient" x1="0%" y1="0%" x2="100%" y2="0%">
                        <stop offset="0%" stopColor="#a855f7" stopOpacity="0.2" />
                        <stop offset="50%" stopColor="#ec4899" stopOpacity="0.8" />
                        <stop offset="100%" stopColor="#a855f7" stopOpacity="0.2" />
                    </linearGradient>
                    {/* User Echo Trail Gradient */}
                    <linearGradient id="userEchoGradient" x1="0%" y1="0%" x2="100%" y2="0%">
                        <stop offset="0%" stopColor="#38bdf8" stopOpacity="0" />
                        <stop offset="100%" stopColor="#38bdf8" stopOpacity="0.8" />
                    </linearGradient>
                    {/* Shadow Echo Trail Gradient */}
                    <linearGradient id="shadowEchoGradient" x1="0%" y1="0%" x2="100%" y2="0%">
                        <stop offset="0%" stopColor="#a855f7" stopOpacity="0" />
                        <stop offset="100%" stopColor="#a855f7" stopOpacity="0.6" />
                    </linearGradient>
                    <filter id="neonGlow" x="-50%" y="-50%" width="200%" height="200%">
                        <feGaussianBlur stdDeviation="4" result="coloredBlur" />
                        <feMerge>
                            <feMergeNode in="coloredBlur" />
                            <feMergeNode in="SourceGraphic" />
                        </feMerge>
                    </filter>
                    {/* Shadow Line Glow - Softer, more ethereal */}
                    <filter id="shadowGlow" x="-100%" y="-100%" width="300%" height="300%">
                        <feGaussianBlur stdDeviation="6" result="blur" />
                        <feFlood floodColor="#a855f7" floodOpacity="0.5" />
                        <feComposite in2="blur" operator="in" />
                        <feMerge>
                            <feMergeNode />
                            <feMergeNode in="SourceGraphic" />
                        </feMerge>
                    </filter>
                    {/* Delta indicator glow */}
                    <filter id="deltaGlow" x="-50%" y="-50%" width="200%" height="200%">
                        <feGaussianBlur stdDeviation="2" result="blur" />
                        <feMerge>
                            <feMergeNode in="blur" />
                            <feMergeNode in="SourceGraphic" />
                        </feMerge>
                    </filter>
                </defs>

                {/* Perspective Grid Floor */}
                {Array.from({ length: 20 }).map((_, i) => {
                    // Horizontal grid lines (simulated)
                    const yRaw = i * 40; // 0 to 800
                    const p1 = projectPoint(0, yRaw, yaw, pitch, dims.w, dims.h, fitScale, trackCx, trackCy);
                    const p2 = projectPoint(800, yRaw, yaw, pitch, dims.w, dims.h, fitScale, trackCx, trackCy);
                    if (p1.y > dims.h || p2.y > dims.h) return null; // Clip
                    return (
                        <line key={`h-${i}`} x1={p1.x} y1={p1.y} x2={p2.x} y2={p2.y} stroke="#1e293b" strokeWidth="1" opacity="0.3" />
                    )
                })}

                {/* Track Line */}
                <path d={pathData} stroke="rgba(255,255,255,0.4)" strokeWidth="4" fill="none" />

                {/* User Trail (Racing Line) */}
                <path d={userPathData} stroke="#00FFFF" strokeWidth="3" fill="none" strokeOpacity="0.6" />

                {/* Track Path (Glow Layer) */}
                <path d={pathData} stroke="rgba(16, 185, 129, 0.4)" strokeWidth={16 * fitScale} fill="none" strokeLinecap="round" strokeLinejoin="round" />

                {/* Track Path (Core) */}
                <path d={pathData} stroke="url(#neonGradient)" strokeWidth={4 * fitScale} fill="none" strokeLinecap="round" strokeLinejoin="round" filter="url(#neonGlow)" />

                {/* Start Line */}
                {(() => {
                    const startP1 = projectPoint(track.mapPoints[0].x - 20, track.mapPoints[0].y, yaw, pitch, dims.w, dims.h, fitScale, trackCx, trackCy);
                    const startP2 = projectPoint(track.mapPoints[0].x + 20, track.mapPoints[0].y, yaw, pitch, dims.w, dims.h, fitScale, trackCx, trackCy);
                    return <line x1={startP1.x} y1={startP1.y} x2={startP2.x} y2={startP2.y} stroke="#ef4444" strokeWidth={3 * fitScale} />;
                })()}

                {/* Shadow Echo Trail - Your optimal path shown as fading trail */}
                {shadowEchoPath && (
                    <path
                        d={shadowEchoPath}
                        stroke="url(#shadowEchoGradient)"
                        strokeWidth={3 * fitScale}
                        fill="none"
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        strokeDasharray="8 4"
                        opacity="0.7"
                    />
                )}

                {/* Legacy Ghost Car (fallback when no shadowState) */}
                {ghost3D && !shadow3D && (
                    <g transform={`translate(${ghost3D.x}, ${ghost3D.y})`}>
                        <circle r={6 * ghost3D.scale} fill="#fbbf24" filter="url(#neonGlow)" />
                        <text y={-10} textAnchor="middle" fill="#fbbf24" fontSize="10" opacity="0.8" style={{ fontSize: `${10 * ghost3D.scale}px` }}>TARGET</text>
                    </g>
                )}

                {/* Shadow Line Phantom - Ethereal representation of your optimal self */}
                {shadow3D && (
                    <g transform={`translate(${shadow3D.x}, ${shadow3D.y})`}>
                        {/* Outer ethereal ring - pulsing */}
                        <circle r={18 * shadow3D.scale} fill="none" stroke="#a855f7" strokeWidth="1" opacity="0.3">
                            <animate attributeName="r" values={`${14 * shadow3D.scale};${22 * shadow3D.scale};${14 * shadow3D.scale}`} dur="2s" repeatCount="indefinite" />
                            <animate attributeName="opacity" values="0.4;0.1;0.4" dur="2s" repeatCount="indefinite" />
                        </circle>
                        {/* Middle ring */}
                        <circle r={10 * shadow3D.scale} fill="none" stroke="#ec4899" strokeWidth="2" opacity="0.5" filter="url(#shadowGlow)" />
                        {/* Core phantom - diamond shape for distinct silhouette */}
                        <path
                            d={`M 0 ${-8 * shadow3D.scale} L ${5 * shadow3D.scale} 0 L 0 ${8 * shadow3D.scale} L ${-5 * shadow3D.scale} 0 Z`}
                            fill="#a855f7"
                            stroke="#ec4899"
                            strokeWidth="1.5"
                            filter="url(#shadowGlow)"
                            opacity="0.9"
                        />
                        {/* Inner core glow */}
                        <circle r={3 * shadow3D.scale} fill="#ffffff" opacity="0.8" />
                        {/* Label */}
                        <text
                            y={-14 * shadow3D.scale}
                            textAnchor="middle"
                            fill="#a855f7"
                            fontWeight="bold"
                            letterSpacing="0.1em"
                            style={{ fontSize: `${9 * shadow3D.scale}px` }}
                        >
                            SHADOW
                        </text>
                        {/* Delta indicator line connecting to user */}
                        {user3D && (
                            <line
                                x1="0"
                                y1="0"
                                x2={user3D.x - shadow3D.x}
                                y2={user3D.y - shadow3D.y}
                                stroke={deltaColor}
                                strokeWidth="1"
                                strokeDasharray="4 4"
                                opacity="0.6"
                                filter="url(#deltaGlow)"
                            />
                        )}
                    </g>
                )}

                {/* User Car */}
                {user3D && (
                    <g transform={`translate(${user3D.x}, ${user3D.y})`}>
                        <circle r={8 * user3D.scale} fill="#38bdf8" stroke="white" strokeWidth="2" filter="url(#neonGlow)" />
                        <circle r={15 * user3D.scale} fill="none" stroke="#38bdf8" strokeWidth="1" opacity="0.5">
                            <animate attributeName="r" values={`${12 * user3D.scale};${18 * user3D.scale};${12 * user3D.scale}`} dur="1.5s" repeatCount="indefinite" />
                            <animate attributeName="opacity" values="0.8;0;0.8" dur="1.5s" repeatCount="indefinite" />
                        </circle>
                    </g>
                )}

                {/* Hover Highlight */}
                {hover3D && (
                    <g transform={`translate(${hover3D.x}, ${hover3D.y})`}>
                        <circle r={4 * hover3D.scale} fill="white" />
                        <text y={-15} textAnchor="middle" fill="white" fontWeight="bold" style={{ fontSize: `${12 * hover3D.scale}px` }}>
                            {Math.round(hoverProgress! * 100)}%
                        </text>
                    </g>
                )}

            </svg>

            {/* HUD Info */}
            <div className="absolute bottom-4 left-4 pointer-events-none">
                <div className="flex flex-col gap-1.5">
                    <div className="flex items-center gap-2">
                        <div className="w-2 h-2 rounded-full bg-sky-400 shadow-[0_0_10px_#38bdf8]"></div>
                        <span className="text-[10px] text-sky-400 font-mono">YOU</span>
                    </div>
                    <div className="flex items-center gap-2">
                        <div className="w-2 h-2 rotate-45 bg-purple-500 shadow-[0_0_10px_#a855f7]"></div>
                        <span className="text-[10px] text-purple-400 font-mono">SHADOW</span>
                    </div>
                    {shadowState && (
                        <div className="flex items-center gap-2 mt-1 px-2 py-1 rounded bg-black/50 backdrop-blur">
                            <span className="text-[10px] text-slate-400 font-mono">DELTA</span>
                            <span
                                className="text-[12px] font-mono font-bold tabular-nums"
                                style={{ color: deltaColor }}
                            >
                                {shadowState.currentDelta > 0 ? '+' : ''}{shadowState.currentDelta.toFixed(2)}s
                            </span>
                        </div>
                    )}
                </div>
            </div>
        </div>
    );
});