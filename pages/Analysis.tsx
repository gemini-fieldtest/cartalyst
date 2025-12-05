import React, { useState } from 'react';
import { TelemetryCharts } from '../components/TelemetryCharts';
import { TrackVisualizer } from '../components/TrackVisualizer';
import { MOCK_SESSION, MOCK_TRACK } from '../constants';
import { analyzeLap, AnalysisResult } from '../services/geminiService';
import { Lap } from '../types';
import { Brain, ChevronRight, AlertCircle, CheckCircle2, Flag } from 'lucide-react';

export const Analysis: React.FC = () => {
  const [selectedLapId, setSelectedLapId] = useState<string>(MOCK_SESSION.bestLapId);
  const [aiAnalysis, setAiAnalysis] = useState<AnalysisResult | null>(null);
  const [isAnalyzing, setIsAnalyzing] = useState(false);

  // Find the selected lap and the "ideal" lap for comparison
  const selectedLap = MOCK_SESSION.laps.find(l => l.id === selectedLapId) || MOCK_SESSION.laps[0];
  const idealLap = MOCK_SESSION.laps.find(l => l.id === 'lap_ideal') || MOCK_SESSION.laps[0];

  const handleRunAnalysis = async () => {
    setIsAnalyzing(true);
    setAiAnalysis(null);
    const result = await analyzeLap(selectedLap, idealLap, MOCK_TRACK);
    setAiAnalysis(result);
    setIsAnalyzing(false);
  };

  return (
    <div className="flex h-full overflow-hidden bg-[#0B0F19]">
      {/* Sidebar: Session Laps */}
      <div className="w-64 md:w-80 bg-slate-900/50 border-r border-white/5 flex flex-col h-full overflow-hidden shrink-0">
        <div className="p-6 border-b border-white/5">
            <h2 className="text-xs font-bold text-slate-500 uppercase tracking-widest mb-1">Data Source</h2>
            <p className="text-sm font-bold text-white">{MOCK_SESSION.date}</p>
            <p className="text-xs text-slate-400">{MOCK_SESSION.trackName}</p>
        </div>
        <div className="flex-1 overflow-y-auto p-4 space-y-2">
            {MOCK_SESSION.laps.filter(l => l.id !== 'lap_ideal').map(lap => (
                <button
                    key={lap.id}
                    onClick={() => { setSelectedLapId(lap.id); setAiAnalysis(null); }}
                    className={`w-full flex items-center justify-between p-3 rounded-lg transition-all border ${
                        selectedLapId === lap.id 
                        ? 'bg-sky-500/10 border-sky-500/50 text-white' 
                        : 'bg-transparent border-transparent text-slate-400 hover:bg-slate-800 hover:text-slate-200'
                    }`}
                >
                    <div className="flex items-center gap-3">
                        <span className={`text-[10px] font-mono px-1.5 py-0.5 rounded ${lap.id === MOCK_SESSION.bestLapId ? 'bg-amber-500/20 text-amber-500' : 'bg-slate-800 text-slate-500'}`}>
                            L{lap.lapNumber}
                        </span>
                        <span className="font-mono font-bold text-base">{lap.time.toFixed(2)}s</span>
                    </div>
                    {selectedLapId === lap.id && <ChevronRight size={14} className="text-sky-500" />}
                </button>
            ))}
        </div>
      </div>

      {/* Main Content */}
      <div className="flex-1 flex flex-col overflow-y-auto p-6 md:p-8 gap-8">
        
        {/* Header Section */}
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
            <div>
                <h1 className="text-2xl font-bold text-white mb-1">Lap {selectedLap.lapNumber} Analysis</h1>
                <p className="text-slate-400 text-sm">Comparing against <span className="text-amber-500 font-semibold">True Optimal Lap ({idealLap.time.toFixed(2)}s)</span></p>
            </div>
            
            <button 
                onClick={handleRunAnalysis}
                disabled={isAnalyzing}
                className={`flex items-center gap-2 px-6 py-2.5 rounded font-bold transition-all shadow-lg text-sm ${
                    isAnalyzing 
                    ? 'bg-slate-800 cursor-not-allowed text-slate-500'
                    : 'bg-sky-600 hover:bg-sky-500 text-white shadow-sky-500/20'
                }`}
            >
                {isAnalyzing ? (
                    <>
                        <Brain className="animate-pulse" size={16} /> Analyzing...
                    </>
                ) : (
                    <>
                        <Brain size={16} /> Ask AI Coach
                    </>
                )}
            </button>
        </div>

        {/* AI Analysis Result */}
        {(aiAnalysis || isAnalyzing) && (
            <div className="bg-gradient-to-br from-indigo-900/20 to-slate-900/40 border border-indigo-500/30 p-6 rounded-xl animate-in fade-in duration-500">
                <div className="flex items-start gap-4">
                    <div className="p-2 bg-indigo-500/20 rounded-lg shrink-0">
                        <Brain size={20} className="text-indigo-400" />
                    </div>
                    <div className="flex-1">
                        <h3 className="text-base font-bold text-white mb-4">Coach's Opportunities</h3>
                        {isAnalyzing ? (
                             <div className="space-y-3 animate-pulse">
                                <div className="h-3 bg-slate-700/50 rounded w-3/4"></div>
                                <div className="h-3 bg-slate-700/50 rounded w-1/2"></div>
                                <div className="h-3 bg-slate-700/50 rounded w-2/3"></div>
                             </div>
                        ) : (
                           <div className="grid gap-3">
                              {aiAnalysis?.tips.map((tip, index) => (
                                <div key={index} className="flex items-start gap-3 bg-slate-900/50 p-3 rounded border border-white/5">
                                    <Flag className="text-sky-500 shrink-0 mt-0.5" size={14} />
                                    <p className="text-slate-300 text-sm leading-relaxed">{tip}</p>
                                </div>
                              ))}
                           </div>
                        )}
                    </div>
                </div>
            </div>
        )}

        {/* Visualization Grid */}
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-8 min-h-[400px]">
            {/* Charts Column */}
            <div className="lg:col-span-2 space-y-6">
                <TelemetryCharts currentLap={selectedLap} referenceLap={idealLap} />
                
                <div className="grid grid-cols-2 gap-4">
                     <div className="bg-slate-900/30 border border-white/5 p-4 rounded-xl flex items-center gap-3">
                        <AlertCircle className="text-rose-500" size={24} />
                        <div>
                            <p className="text-[10px] text-slate-500 uppercase font-bold">Biggest Loss</p>
                            <p className="font-bold text-white text-sm">Sector 2 Entry</p>
                            <p className="text-xs text-rose-500 font-mono font-bold">+0.32s</p>
                        </div>
                     </div>
                     <div className="bg-slate-900/30 border border-white/5 p-4 rounded-xl flex items-center gap-3">
                        <CheckCircle2 className="text-emerald-500" size={24} />
                        <div>
                            <p className="text-[10px] text-slate-500 uppercase font-bold">Best Sector</p>
                            <p className="font-bold text-white text-sm">Sector 3</p>
                            <p className="text-xs text-emerald-500 font-mono font-bold">-0.05s</p>
                        </div>
                     </div>
                </div>
            </div>

            {/* Map Column */}
            <div className="bg-slate-900/30 border border-white/5 rounded-xl p-6 flex flex-col">
                <h3 className="text-xs font-bold text-slate-500 uppercase tracking-widest mb-4">True Track Positioning™</h3>
                <div className="flex-1 bg-slate-900/50 rounded-lg">
                    <TrackVisualizer track={MOCK_TRACK} className="h-full" />
                </div>
                <div className="mt-4 p-3 bg-slate-800/30 rounded border border-white/5 text-[10px] text-slate-400">
                    <p className="mb-1 flex items-center"><span className="w-1.5 h-1.5 inline-block rounded-full bg-sky-400 mr-2"></span>Your Line</p>
                    <p className="flex items-center"><span className="w-1.5 h-1.5 inline-block rounded-full bg-emerald-500 mr-2"></span>Optimal Line (AI)</p>
                </div>
            </div>
        </div>

      </div>
    </div>
  );
};