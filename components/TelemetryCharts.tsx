import React from 'react';
import {
  AreaChart,
  Area,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  ReferenceLine
} from 'recharts';
import { Lap } from '../types';

interface TelemetryChartsProps {
  currentLap: Lap;
  referenceLap: Lap;
}

export const TelemetryCharts: React.FC<TelemetryChartsProps> = ({ currentLap, referenceLap }) => {
  // Combine data for the chart
  const data = currentLap.telemetry.map((point, index) => {
    // Map reference lap data by approximate distance index (simplification)
    const refPoint = referenceLap.telemetry[index];
    return {
      distance: point.distance,
      speedCurrent: point.speed,
      speedRef: refPoint?.speed ?? 0,
      delta: (point.time - (refPoint?.time ?? 0)).toFixed(2), // Time delta
      throttle: point.throttle
    };
  });

  return (
    <div className="flex flex-col gap-6 w-full">
      {/* Speed Trace */}
      <div className="h-64 glass-panel p-4 rounded-xl">
        <h3 className="text-sm font-semibold text-slate-400 mb-2">Speed Trace (mph)</h3>
        <ResponsiveContainer width="100%" height="100%">
          <AreaChart data={data} margin={{ top: 10, right: 0, left: -20, bottom: 0 }}>
            <defs>
              <linearGradient id="colorSpeed" x1="0" y1="0" x2="0" y2="1">
                <stop offset="5%" stopColor="#38bdf8" stopOpacity={0.3}/>
                <stop offset="95%" stopColor="#38bdf8" stopOpacity={0}/>
              </linearGradient>
            </defs>
            <CartesianGrid strokeDasharray="3 3" stroke="#334155" opacity={0.5} />
            <XAxis dataKey="distance" stroke="#64748b" tick={false} />
            <YAxis stroke="#64748b" domain={[0, 'auto']} />
            <Tooltip 
              contentStyle={{ backgroundColor: '#0f172a', borderColor: '#334155', color: '#f1f5f9' }} 
              itemStyle={{ fontSize: '12px' }}
            />
            <Area 
                type="monotone" 
                dataKey="speedCurrent" 
                stroke="#38bdf8" 
                fillOpacity={1} 
                fill="url(#colorSpeed)" 
                strokeWidth={2}
                name="You"
            />
            <Area 
                type="monotone" 
                dataKey="speedRef" 
                stroke="#f59e0b" 
                fillOpacity={0} 
                strokeDasharray="4 4" 
                strokeWidth={2}
                name="Optimal"
            />
          </AreaChart>
        </ResponsiveContainer>
      </div>

      {/* Time Delta */}
      <div className="h-48 glass-panel p-4 rounded-xl">
        <h3 className="text-sm font-semibold text-slate-400 mb-2">Time Delta (s)</h3>
        <ResponsiveContainer width="100%" height="100%">
          <AreaChart data={data} margin={{ top: 10, right: 0, left: -20, bottom: 0 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="#334155" opacity={0.5} />
            <XAxis dataKey="distance" stroke="#64748b" tick={false} />
            <YAxis stroke="#64748b" />
            <ReferenceLine y={0} stroke="#94a3b8" strokeDasharray="3 3" />
            <Tooltip 
              contentStyle={{ backgroundColor: '#0f172a', borderColor: '#334155', color: '#f1f5f9' }} 
            />
            <Area 
                type="monotone" 
                dataKey="delta" 
                stroke="#ef4444" 
                fill="#ef4444" 
                fillOpacity={0.1} 
                strokeWidth={2}
                name="Time Loss/Gain"
            />
          </AreaChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
};