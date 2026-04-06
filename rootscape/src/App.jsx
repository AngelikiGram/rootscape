import React, { useEffect } from 'react';
import { useSimStore } from './store/simulationStore.js';
import Header from './components/Header.jsx';
import Timeline from './components/Timeline.jsx';
import MainCanvas from './components/Canvas/MainCanvas.jsx';
import CrossSection from './components/Canvas/CrossSection.jsx';
import OverviewPanel from './components/Canvas/OverviewPanel.jsx';
import ValidationDashboard from './components/ValidationDashboard.jsx';

import SpeciesAnalysisModal from './components/SpeciesAnalysisModal.jsx';
import UndergroundAnalysisModal from './components/UndergroundAnalysisModal.jsx';
import PinComparisonModal from './components/PinComparisonModal.jsx';
import ComparisonModal from './components/ComparisonModal.jsx';
import OverlayControls from './components/OverlayControls.jsx';
import LoadingScreen from './components/LoadingScreen.jsx';

export default function App() {
  const { init, activeView, showComparisonModal, loadingGIS } = useSimStore();

  // Initialize simulation and fetch default GIS on mount
  useEffect(() => {
    init();
  }, [init]);

  if (showComparisonModal) {
    return (
      <div id="app-root" style={{ background: '#000' }}>
        <main className="canvas-area">
           <MainCanvas />
           <ComparisonModal onClose={() => useSimStore.setState({ showComparisonModal: false })} />
        </main>
      </div>
    );
  }

  return (
    <div id="app-root">
      <Header />
      
      <main className="canvas-area">
        <div style={{ display: activeView === '3d' ? 'block' : 'none', width: '100%', height: '100%' }}>
          <MainCanvas />
        </div>
        <div style={{ display: activeView === 'section' ? 'block' : 'none', width: '100%', height: '100%' }}>
          <CrossSection />
        </div>
        <div style={{ display: activeView === 'overview' ? 'block' : 'none', width: '100%', height: '100%' }}>
          <OverviewPanel />
        </div>
        <div style={{ display: activeView === 'validation' ? 'block' : 'none', width: '100%', height: '100%' }}>
          <ValidationDashboard />
        </div>
        
        {/* Floating Overlays — 3D only */}
        <div style={{ display: activeView === '3d' ? 'block' : 'none' }}>
           <OverlayControls />
        </div>

        {/* Full-view Loading Screen overlay */}
        {loadingGIS && <LoadingScreen />}
      </main>

      <Timeline />
      
      <SpeciesAnalysisModal />
      <UndergroundAnalysisModal />
    </div>
  );
}
