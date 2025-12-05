import React, { useMemo, useState, useRef, useEffect } from 'react';
import { Track } from '../types';

interface TrackVisualizerProps {
  track: Track;
  className?: string;
  activeSegment?: number; // 0-1 percentage for User
  ghostSegment?: number;  // 0-1 percentage for Shadow Driver
}

// 3D Math Helper
const projectPoint = (x: number, y: number, yaw: number, pitch: number, width: number, height: number) => {
    // 1. Center the track (assuming 700x500 original coordinates)
    const cx = 350;
    const cy = 250;
    let x0 = x - cx;
    let y0 = y - cy;
    
    // 2. Scale it slightly
    const scale = 1.0;
    x0 *= scale;
    y0 *= scale;

    // 3. Rotate (Yaw) around Y axis (which is Z in screen space, technically)
    const cosYaw = Math.cos(yaw);
    const sinYaw = Math.sin(yaw);
    const x1 = x0 * cosYaw - y0 * sinYaw;
    const y1 = x0 * sinYaw + y0 * cosYaw;

    // 4. Map 2D Y to 3D Z (flat ground plane)
    // World coordinates: X_w = x1, Y_w = 0 (height), Z_w = y1
    
    // 5. Apply Pitch (Camera Tilt)
    // Camera is looking down. 
    // New Y_c = Y_w * cos(pitch) - Z_w * sin(pitch)
    // New Z_c = Y_w * sin(pitch) + Z_w * cos(pitch)
    
    // Since Y_w is 0 (flat track):
    // Y_c = -y1 * sin(pitch)
    // Z_c = y1 * cos(pitch)
    
    // Offset camera distance
    const camDist = 600;
    const zFinal = y1 * Math.cos(pitch) + camDist;

    // 6. Perspective Projection
    // x_screen = x1 * (focalLength / zFinal)
    const focalLength = 500;
    const pScale = focalLength / zFinal;
    
    const xScreen = x1 * pScale + width / 2;
    // We add a vertical offset to simulate camera height
    const yScreen = (y1 * Math.sin(pitch)) * pScale + height / 2 + 50;

    return { x: xScreen, y: yScreen, scale: pScale };
};

export const TrackVisualizer: React.FC<TrackVisualizerProps> = ({ track, className, activeSegment, ghostSegment }) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const [yaw, setYaw] = useState(0);
  const [pitch, setPitch] = useState(0.8); // Initial tilt
  const [dims, setDims] = useState({ w: 700, h: 500 });
  const [hoverProgress, setHoverProgress] = useState<number | null>(null);

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

  // Interaction handlers
  const handlePointerMove = (e: React.PointerEvent) => {
    if (e.buttons === 1) { // Drag to rotate
        setYaw(y => y + e.movementX * 0.005);
        setPitch(p => Math.max(0.1, Math.min(1.5, p + e.movementY * 0.005)));
    } else {
        // Raycast logic: Find closest point on projected track to mouse
        // Simplified: Loop through all points and find min dist
        const rect = containerRef.current?.getBoundingClientRect();
        if (!rect) return;
        const mx = e.clientX - rect.left;
        const my = e.clientY - rect.top;

        let minDist = 30; // Snap radius
        let bestIdx = -1;

        track.mapPoints.forEach((p, i) => {
            const proj = projectPoint(p.x, p.y, yaw, pitch, dims.w, dims.h);
            const dist = Math.sqrt((proj.x - mx)**2 + (proj.y - my)**2);
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
        const proj = projectPoint(p.x, p.y, yaw, pitch, dims.w, dims.h);
        return `${i === 0 ? 'M' : 'L'} ${proj.x.toFixed(1)} ${proj.y.toFixed(1)}`;
    }).join(' ');
  }, [track, yaw, pitch, dims]);

  // Helper to get 3D pos for cars
  const get3DPos = (prog: number) => {
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
     
     return projectPoint(x2d, y2d, yaw, pitch, dims.w, dims.h);
  };

  const user3D = useMemo(() => get3DPos(activeSegment!), [activeSegment, yaw, pitch, dims]);
  const ghost3D = useMemo(() => get3DPos(ghostSegment!), [ghostSegment, yaw, pitch, dims]);
  const hover3D = useMemo(() => get3DPos(hoverProgress!), [hoverProgress, yaw, pitch, dims]);

  return (
    <div 
        ref={containerRef}
        className={`relative overflow-hidden cursor-crosshair touch-none ${className}`}
        onPointerMove={handlePointerMove}
    >
      {/* 3D Scene SVG */}
      <svg width="100%" height="100%" className="block">
         <defs>
             <linearGradient id="neonGradient" x1="0%" y1="0%" x2="100%" y2="0%">
                <stop offset="0%" stopColor="#0ea5e9" />
                <stop offset="100%" stopColor="#10b981" />
             </linearGradient>
             <filter id="neonGlow" x="-50%" y="-50%" width="200%" height="200%">
                <feGaussianBlur stdDeviation="4" result="coloredBlur" />
                <feMerge>
                    <feMergeNode in="coloredBlur" />
                    <feMergeNode in="SourceGraphic" />
                </feMerge>
             </filter>
         </defs>

         {/* Perspective Grid Floor */}
         {Array.from({ length: 20 }).map((_, i) => {
             // Horizontal grid lines (simulated)
             const yRaw = i * 40; // 0 to 800
             const p1 = projectPoint(0, yRaw, yaw, pitch, dims.w, dims.h);
             const p2 = projectPoint(800, yRaw, yaw, pitch, dims.w, dims.h);
             if (p1.y > dims.h || p2.y > dims.h) return null; // Clip
             return (
                 <line key={`h-${i}`} x1={p1.x} y1={p1.y} x2={p2.x} y2={p2.y} stroke="#1e293b" strokeWidth="1" opacity="0.3" />
             )
         })}
         
         {/* Track Path (Glow Layer) */}
         <path d={pathData} stroke="rgba(16, 185, 129, 0.4)" strokeWidth="16" fill="none" strokeLinecap="round" strokeLinejoin="round" />
         
         {/* Track Path (Core) */}
         <path d={pathData} stroke="url(#neonGradient)" strokeWidth="4" fill="none" strokeLinecap="round" strokeLinejoin="round" filter="url(#neonGlow)" />

         {/* Start Line */}
         {(() => {
             const startP1 = projectPoint(track.mapPoints[0].x - 20, track.mapPoints[0].y, yaw, pitch, dims.w, dims.h);
             const startP2 = projectPoint(track.mapPoints[0].x + 20, track.mapPoints[0].y, yaw, pitch, dims.w, dims.h);
             return <line x1={startP1.x} y1={startP1.y} x2={startP2.x} y2={startP2.y} stroke="#ef4444" strokeWidth="3" />;
         })()}

         {/* Ghost Car */}
         {ghost3D && (
             <g transform={`translate(${ghost3D.x}, ${ghost3D.y})`}>
                 <circle r={6 * ghost3D.scale} fill="#fbbf24" filter="url(#neonGlow)" />
                 <text y={-10} textAnchor="middle" fill="#fbbf24" fontSize="10" opacity="0.8" style={{ fontSize: `${10*ghost3D.scale}px` }}>TARGET</text>
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
                 <text y={-15} textAnchor="middle" fill="white" fontWeight="bold" style={{ fontSize: `${12*hover3D.scale}px` }}>
                    {Math.round(hoverProgress! * 100)}%
                 </text>
             </g>
         )}

      </svg>
      
      {/* HUD Info */}
      <div className="absolute bottom-8 left-4 pointer-events-none">
          <div className="flex flex-col gap-1">
              <div className="flex items-center gap-2">
                 <div className="w-3 h-3 rounded-full bg-sky-400 shadow-[0_0_10px_#38bdf8]"></div>
                 <span className="text-[10px] text-sky-400 font-mono">YOU</span>
              </div>
              <div className="flex items-center gap-2">
                 <div className="w-3 h-3 rounded-full bg-amber-400 shadow-[0_0_10px_#fbbf24]"></div>
                 <span className="text-[10px] text-amber-400 font-mono">TARGET</span>
              </div>
          </div>
      </div>
      
      <div className="absolute top-4 right-4 pointer-events-none text-right">
          <p className="text-[10px] text-slate-500 font-mono uppercase">View Control</p>
          <p className="text-xs text-slate-400">Drag to Rotate</p>
      </div>
    </div>
  );
};