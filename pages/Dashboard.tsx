import React from 'react';
import { Play, TrendingUp, Flag } from 'lucide-react';

interface DashboardProps {
    onGoToLive: () => void;
    onGoToAnalysis: () => void;
}

export const Dashboard: React.FC<DashboardProps> = ({ onGoToLive, onGoToAnalysis }) => {
  return (
    <div className="flex flex-col md:flex-row h-full w-full bg-[#0B0F19]">
      
      {/* Primary Action: Drive / Live Session */}
      <button 
        onClick={onGoToLive}
        className="flex-1 relative group overflow-hidden border-b md:border-b-0 md:border-r border-white/10 hover:border-emerald-500/50 transition-all duration-500 focus:outline-none"
      >
        {/* Dynamic Background */}
        <div className="absolute inset-0 bg-gradient-to-br from-slate-900 via-slate-950 to-emerald-950/30 group-hover:to-emerald-900/50 transition-colors duration-500" />
        <div className="absolute inset-0 bg-[radial-gradient(circle_at_center,_var(--tw-gradient-stops))] from-emerald-500/5 via-transparent to-transparent opacity-0 group-hover:opacity-100 transition-opacity duration-500" />
        
        {/* Content */}
        <div className="absolute inset-0 flex flex-col items-center justify-center z-10 p-6 md:p-12">
            <div className="relative mb-8 md:mb-12">
                <div className="absolute inset-0 bg-emerald-500/20 blur-3xl rounded-full opacity-0 group-hover:opacity-100 transition-opacity duration-500" />
                <div className="w-32 h-32 md:w-56 md:h-56 rounded-full border-4 border-emerald-500/20 bg-emerald-500/5 flex items-center justify-center group-hover:scale-105 group-hover:border-emerald-400 group-hover:bg-emerald-500/10 transition-all duration-300 shadow-2xl shadow-black">
                    <Play className="w-16 h-16 md:w-28 md:h-28 text-emerald-500 ml-3 fill-emerald-500/20 group-hover:fill-emerald-500/40 transition-all" />
                </div>
            </div>
            
            <h2 className="text-5xl md:text-8xl font-black italic tracking-tighter text-white uppercase group-hover:text-emerald-400 transition-colors drop-shadow-2xl">
                RACE
            </h2>
            <p className="mt-4 md:mt-6 text-slate-400 font-mono text-xs md:text-sm uppercase tracking-[0.3em] group-hover:text-emerald-200/80 group-hover:tracking-[0.4em] transition-all">
                Start Live Session
            </p>
        </div>
      </button>

      {/* Secondary Action: Analysis */}
      <button 
        onClick={onGoToAnalysis}
        className="flex-1 relative group overflow-hidden border-t md:border-t-0 md:border-l border-white/10 hover:border-indigo-500/50 transition-all duration-500 focus:outline-none"
      >
        {/* Dynamic Background */}
        <div className="absolute inset-0 bg-gradient-to-bl from-slate-900 via-slate-950 to-indigo-950/30 group-hover:to-indigo-900/50 transition-colors duration-500" />
        <div className="absolute inset-0 bg-[radial-gradient(circle_at_center,_var(--tw-gradient-stops))] from-indigo-500/5 via-transparent to-transparent opacity-0 group-hover:opacity-100 transition-opacity duration-500" />

        {/* Content */}
        <div className="absolute inset-0 flex flex-col items-center justify-center z-10 p-6 md:p-12">
             <div className="relative mb-8 md:mb-12">
                <div className="absolute inset-0 bg-indigo-500/20 blur-3xl rounded-full opacity-0 group-hover:opacity-100 transition-opacity duration-500" />
                <div className="w-24 h-24 md:w-40 md:h-40 rounded-full border-4 border-indigo-500/20 bg-indigo-500/5 flex items-center justify-center group-hover:scale-105 group-hover:border-indigo-400 group-hover:bg-indigo-500/10 transition-all duration-300 shadow-2xl shadow-black">
                    <TrendingUp className="w-10 h-10 md:w-20 md:h-20 text-indigo-500" />
                </div>
            </div>

            <h2 className="text-4xl md:text-6xl font-black italic tracking-tighter text-slate-200 uppercase group-hover:text-indigo-400 transition-colors drop-shadow-2xl">
                ANALYZE
            </h2>
             <p className="mt-4 md:mt-6 text-slate-500 font-mono text-xs md:text-sm uppercase tracking-[0.3em] group-hover:text-indigo-200/80 group-hover:tracking-[0.4em] transition-all">
                Review Telemetry
            </p>
        </div>
      </button>

    </div>
  );
};