import React, { useState } from 'react';
import { Navbar } from './components/Navbar';
import { Dashboard } from './pages/Dashboard';
import LiveSession from './pages/LiveSession';
import { Analysis } from './pages/Analysis';
import { VideoAnalysis } from './pages/VideoAnalysis';
import { ViewState } from './types';

const App: React.FC = () => {
  const [currentView, setCurrentView] = useState<ViewState>(ViewState.DASHBOARD);

  const renderContent = () => {
    switch (currentView) {
      case ViewState.LIVE:
        return <LiveSession />;
      case ViewState.ANALYSIS:
        return <Analysis />;
      case ViewState.VIDEO:
        return <VideoAnalysis />;
      case ViewState.DASHBOARD:
      default:
        return (
          <Dashboard
            onGoToLive={() => setCurrentView(ViewState.LIVE)}
            onGoToAnalysis={() => setCurrentView(ViewState.ANALYSIS)}
          />
        );
    }
  };

  return (
    <div className="flex flex-col h-[100dvh] bg-[#0B0F19] text-slate-100 overflow-hidden font-sans selection:bg-sky-500/30">
      <Navbar currentView={currentView} onNavigate={setCurrentView} />
      <main className="flex-1 relative w-full overflow-hidden">
        {renderContent()}
      </main>
    </div>
  );
};

export default App;