import React, { useState } from 'react';
import { useSimStore } from '../store/simulationStore';
import PlannerPanel from './PlannerPanel.jsx';

const OverlayControls = () => {
  const {
    showBuildings, showTexturedBuildings, showUrbanTrees, showUnderground, showUbahn, showPipes, showXRay,
    showStressViz, showGreenViz, showGroundMask, showWaterBodies, showRoads, showPavements,
    showUrbanRoots, showDSMOverlay,
    candidatePlantMode, setCandidatePlantMode,
    language,
  } = useSimStore();

  const isDE = language === 'de';

  const [isMenuOpen, setIsMenuOpen] = useState(true);
  const [showPlannerPanel, setShowPlannerPanel] = useState(false);

  const toggle = (key, val) => useSimStore.setState({ [key]: val });

  const togglePlanner = () => {
    const next = !showPlannerPanel;
    setShowPlannerPanel(next);
    if (!next) setCandidatePlantMode(false);
  };

  const GlyphButton = ({ active, onClick, glyph, label, accent, isSub }) => (
    <button
      onClick={onClick}
      style={{
        background: active ? (accent || 'rgba(0, 151, 230, 0.45)') : 'rgba(21, 23, 26, 0.92)',
        border: '1px solid',
        borderColor: isSub ? 'rgba(255,255,255,0.04)' : (active ? 'rgba(255,255,255,0.2)' : 'rgba(255,255,255,0.08)'),
        color: active ? '#fff' : 'rgba(255,255,255,0.5)',
        padding: isSub ? '4px 10px' : '5px 10px',
        borderRadius: '8px',
        fontSize: isSub ? '8px' : '8.5px',
        fontWeight: isSub ? 600 : 700,
        display: 'flex',
        alignItems: 'center',
        gap: '8px',
        cursor: 'pointer',
        transition: 'all 0.2s cubic-bezier(0.1, 0.7, 0.1, 1)',
        backdropFilter: 'blur(10px)',
        minWidth: isSub ? 'calc(100% - 14px)' : '100%',
        marginLeft: isSub ? '14px' : '0',
        textTransform: 'uppercase',
        letterSpacing: '0.4px',
        opacity: isSub && !active ? 0.7 : 1
      }}
    >
      <span style={{ 
        fontSize: isSub ? '9px' : '11px', width: '12px', textAlign: 'center', 
        color: active ? '#fff' : (accent || '#0097e6'), opacity: active ? 1 : 0.6
      }}>{glyph}</span>
      <span style={{ 
        flex: 1, textAlign: 'left', color: isSub ? '#fff' : undefined,
        whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis'
      }}>{label}</span>
    </button>
  );

  return (
    <>
    <div style={{
      position: 'absolute', top: '16px', right: '16px',
      display: 'flex', flexDirection: 'column', gap: '6px',
      alignItems: 'flex-end', zIndex: 1000, pointerEvents: 'none'
    }}>
      {/* Menu Header Button */}
      <button 
        onClick={() => setIsMenuOpen(!isMenuOpen)}
        style={{
          background: 'rgba(21, 23, 26, 0.95)', border: '1px solid rgba(255,255,255,0.15)',
          color: '#fff', padding: '8px 14px', borderRadius: '12px', fontSize: '10px', fontWeight: 800,
          cursor: 'pointer', pointerEvents: 'auto', backdropFilter: 'blur(12px)',
          display: 'flex', alignItems: 'center', gap: '8px', boxShadow: '0 4px 16px rgba(0,0,0,0.4)',
          textTransform: 'uppercase', letterSpacing: '0.6px'
        }}
      >
        {isMenuOpen ? (
          <span style={{ fontSize: '13px', lineHeight: 1 }}>✕</span>
        ) : (
          <svg width="15" height="15" viewBox="0 0 15 15" fill="currentColor" style={{ display: 'block', opacity: 0.95 }}>
            <path d="M7.5 1 L14 4.5 L7.5 8 L1 4.5 Z" />
            <path d="M1 7.25 L7.5 10.75 L14 7.25" stroke="currentColor" strokeWidth="1.4" fill="none" strokeLinecap="round"/>
            <path d="M1 10 L7.5 13.5 L14 10" stroke="currentColor" strokeWidth="1.4" fill="none" strokeLinecap="round"/>
          </svg>
        )}
        {isMenuOpen ? (isDE ? 'Schließen' : 'Close') : (isDE ? 'Kartenebenen' : 'Map Layers')}
      </button>

      {isMenuOpen && (
        <div style={{ 
          display: 'flex', flexDirection: 'column', gap: '4px', pointerEvents: 'auto', 
          width: '165px', padding: '4px', background: 'rgba(21, 23, 26, 0.4)', borderRadius: '12px',
          animation: 'fadeIn 0.2s ease-out'
        }}>
          <div style={{ fontSize: '7px', color: 'rgba(255,255,255,0.3)', fontWeight: 800, letterSpacing: '1px', padding: '4px 8px' }}>{isDE ? 'STÄDTISCHE STRUKTUR' : 'URBAN FABRIC'}</div>
          <GlyphButton active={showBuildings} onClick={() => toggle('showBuildings', !showBuildings)} glyph="■" label={isDE ? 'Gebäude' : 'Buildings'} />
          {showBuildings && (
            <GlyphButton active={showTexturedBuildings} onClick={() => toggle('showTexturedBuildings', !showTexturedBuildings)} glyph="▦" label={isDE ? 'Texturierte Ansicht' : 'Textured Overlay'} accent="rgba(211, 166, 15, 0.35)" isSub={true} />
          )}
          <GlyphButton active={showUrbanTrees} onClick={() => toggle('showUrbanTrees', !showUrbanTrees)} glyph="●" label={isDE ? 'Städtisches Blätterdach' : 'City Canopy'} />
          <GlyphButton active={showWaterBodies} onClick={() => toggle('showWaterBodies', !showWaterBodies)} glyph="≋" label={isDE ? 'Gewässer' : 'Water Bodies'} />
          
          <div style={{ height: '4px' }} />
          <div style={{ fontSize: '7px', color: 'rgba(255,255,255,0.3)', fontWeight: 800, letterSpacing: '1px', padding: '4px 8px' }}>{isDE ? 'ANALYSE' : 'ANALYTICS'}</div>
          <GlyphButton active={showStressViz} onClick={() => toggle('showStressViz', !showStressViz)} glyph="≈" label={isDE ? 'Bio-Stress' : 'Bio Stress'} accent="rgba(231, 76, 60, 0.6)" />
          <GlyphButton active={showGreenViz} onClick={() => toggle('showGreenViz', !showGreenViz)} glyph="❖" label={isDE ? 'Gründichte' : 'Green Density'} accent="rgba(46, 204, 113, 0.4)" />
          <GlyphButton active={showGroundMask} onClick={() => toggle('showGroundMask', !showGroundMask)} glyph="▣" label={isDE ? 'Bodenkategorisierung' : 'Ground Categorization'} />
          <GlyphButton active={showPlannerPanel} onClick={togglePlanner} glyph="🌱" label={isDE ? 'Anbau-Planer' : 'Viability Planner'} accent="rgba(46, 204, 113, 0.35)" />

          <div style={{ height: '4px' }} />
          <div style={{ fontSize: '7px', color: 'rgba(255,255,255,0.3)', fontWeight: 800, letterSpacing: '1px', padding: '4px 8px' }}>{isDE ? 'INFRASTRUKTUR' : 'INFRASTRUCTURE'}</div>
          <GlyphButton active={showRoads} onClick={() => toggle('showRoads', !showRoads)} glyph="＝" label={isDE ? 'Straßen' : 'Roads'} />
          <GlyphButton active={showPavements} onClick={() => toggle('showPavements', !showPavements)} glyph="—" label={isDE ? 'Fußwege' : 'Pedestrian'} />
          <GlyphButton active={showUbahn} onClick={() => toggle('showUbahn', !showUbahn)} glyph="[T]" label={isDE ? 'U-Bahn Netz' : 'Metronet'} />
          <GlyphButton active={showPipes} onClick={() => toggle('showPipes', !showPipes)} glyph="○" label={isDE ? 'Untergrund' : 'Sub Surface'} />

          <GlyphButton active={showUrbanRoots} onClick={() => toggle('showUrbanRoots', !showUrbanRoots)} glyph="⌇" label={isDE ? 'Wurzelsystem' : 'Root Systems'} accent="rgba(139, 90, 43, 0.55)" />
          {showUrbanRoots && (
            <GlyphButton active={showDSMOverlay} onClick={() => toggle('showDSMOverlay', !showDSMOverlay)} glyph="▦" label={isDE ? 'LiDAR DSM-Modell' : 'LiDAR DSM Points'} accent="rgba(231, 76, 60, 0.45)" isSub={true} />
          )}

          <div style={{ height: '4px' }} />
          <GlyphButton active={showXRay} onClick={() => toggle('showXRay', !showXRay)} glyph="👁" label={isDE ? 'Röntgenmodus' : 'X-Ray Mode'} accent="rgba(155, 89, 182, 0.5)" />
        </div>
      )}

      <style>{`
        @keyframes fadeIn { from { opacity: 0; transform: scale(0.95); } to { opacity: 1; transform: scale(1); } }
      `}</style>
    </div>
    {showPlannerPanel && <PlannerPanel />}
    </>
  );
};

export default OverlayControls;
