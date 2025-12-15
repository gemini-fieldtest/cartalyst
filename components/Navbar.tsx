import React from 'react';
import { ViewState } from '../types';
import {
  LayoutDashboard,
  Settings,
  Zap,
  Wifi,
  Battery,
  Satellite
} from 'lucide-react';

interface NavbarProps {
  currentView: ViewState;
  onNavigate: (view: ViewState) => void;
}

export const Navbar: React.FC<NavbarProps> = ({ currentView, onNavigate }) => {

  const NavTab = ({ view, label }: { view: ViewState; label: string }) => (
    <button
      onClick={() => onNavigate(view)}
      className={`relative px-6 py-4 text-sm font-medium transition-all duration-200 group ${currentView === view
          ? 'text-white'
          : 'text-slate-500 hover:text-slate-300'
        }`}
    >
      {label}
      {/* Active Indicator */}
      <span className={`absolute bottom-0 left-0 w-full h-0.5 bg-sky-500 transform transition-transform duration-300 ${currentView === view ? 'scale-x-100' : 'scale-x-0'}`} />

      {/* Hover Glow */}
      <span className={`absolute inset-0 bg-sky-500/5 rounded-t-lg opacity-0 group-hover:opacity-100 transition-opacity duration-200 ${currentView === view ? 'opacity-0' : ''}`} />
    </button>
  );

  return (
    <header className="h-14 bg-[#0B0F19]/90 backdrop-blur-md border-b border-white/5 flex items-center justify-between px-6 z-50 shrink-0">

      {/* Brand */}
      <div className="flex items-center gap-3 w-48">
        <div className="w-8 h-8 bg-gradient-to-br from-sky-500 to-indigo-600 rounded flex items-center justify-center shadow-lg shadow-sky-500/20">
          <Zap size={18} className="text-white fill-white" />
        </div>
        <div>
          <h1 className="text-sm font-black tracking-widest text-white uppercase leading-none">CARTALYST</h1>
          <p className="text-[10px] text-sky-500 font-bold tracking-[0.2em] leading-none">GPS TELEMETRY</p>
        </div>
      </div>

      {/* Center Navigation */}
      <nav className="flex h-full items-end gap-2">
        <NavTab view={ViewState.DASHBOARD} label="COCKPIT" />
        <NavTab view={ViewState.LIVE} label="TELEMETRY" />
        <NavTab view={ViewState.ANALYSIS} label="ANALYSIS" />
        <NavTab view={ViewState.VIDEO} label="VIDEO COACH" />
      </nav>

      {/* Right Status Area */}
      <div className="flex items-center justify-end gap-6 w-48">
        <div className="flex items-center gap-4 text-xs font-mono text-slate-500">
          <div className="flex items-center gap-1.5" title="GPS Status">
            <Satellite size={14} className="text-emerald-500" />
            <span>ACTIVE</span>
          </div>
          <div className="flex items-center gap-1.5" title="Signal Strength">
            <Wifi size={14} className="text-emerald-500" />
            <span>5G</span>
          </div>
          <div className="flex items-center gap-1.5" title="Battery Level">
            <Battery size={14} className="text-emerald-500" />
            <span>98%</span>
          </div>
        </div>
        <div className="w-px h-6 bg-white/10" />
        <button className="text-slate-400 hover:text-white transition-colors">
          <Settings size={18} />
        </button>
      </div>

    </header>
  );
};