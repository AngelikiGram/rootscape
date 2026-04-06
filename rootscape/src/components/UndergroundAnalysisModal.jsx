import React from 'react';
import { useSimStore } from '../store/simulationStore';

const UndergroundAnalysisModal = () => {
  const isOpen = useSimStore(s => s.undergroundModalOpen);
  const data = useSimStore(s => s.undergroundData);
  
  if (!isOpen || !data) return null;

  const stats = [
    { 
      label: 'U-Bahn Segments', 
      count: data.ubahn_lines?.features?.length || 0,
      color: '#ec407a',
      icon: '🚇'
    },
    { 
      label: 'Station Nodes', 
      count: data.ubahn_stations?.features?.length || 0, 
      color: '#ffeb3b',
      icon: '🚉'
    },
    { 
      label: 'Sewer Trunk Lines', 
      count: data.sewer_heat?.features?.length || 0,
      color: '#42a5f5',
      icon: '💧'
    },
    { 
      label: 'Soil Sealing Cells', 
      count: data.soil_sealing?.features?.length || 0,
      color: '#7a4f2e',
      icon: '🧱'
    },
    { 
      label: 'OSM Utility Pipes', 
      count: data.osm_underground?.elements?.filter(e => e.type === 'way').length || 0,
      color: '#ffa726',
      icon: '⚡'
    }
  ].filter(s => s.count > 0);

  return (
    <div style={{
      position: 'fixed',
      top: 0, left: 0, right: 0, bottom: 0,
      background: 'rgba(0,0,0,0.85)',
      backdropFilter: 'blur(12px)',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      zIndex: 100000,
      padding: 40,
      animation: 'fadeIn 0.3s ease-out'
    }}>
      <style>{`
        @keyframes fadeIn { from { opacity: 0; } to { opacity: 1; } }
        @keyframes slideUp { from { transform: translateY(20px); opacity: 0; } to { transform: translateY(0); opacity: 1; } }
      `}</style>

      <div style={{
        width: '100%',
        maxWidth: 500,
        background: '#1a1a1a',
        border: '1px solid rgba(255,255,255,0.1)',
        borderRadius: 16,
        padding: 32,
        boxShadow: '0 32px 64px rgba(0,0,0,0.5)',
        animation: 'slideUp 0.4s cubic-bezier(0.16, 1, 0.3, 1)',
        position: 'relative',
        color: '#eee',
        fontFamily: "'Inter', system-ui, sans-serif"
      }}>
        {/* Header */}
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 24 }}>
          <div>
            <h2 style={{ margin: 0, fontSize: 18, fontWeight: 700, color: '#fff', letterSpacing: '-0.02em' }}>
              Subterranean Inventory
            </h2>
            <p style={{ margin: '4px 0 0', fontSize: 12, color: 'var(--text-dim)', fontWeight: 500 }}>
              Vienna Underground GIS Analysis
            </p>
          </div>
          <button 
            onClick={() => useSimStore.setState({ undergroundModalOpen: false })}
            style={{
              background: 'rgba(255,255,255,0.05)',
              border: 'none',
              color: '#fff',
              padding: '8px 12px',
              borderRadius: 8,
              cursor: 'pointer',
              fontSize: 11,
              fontWeight: 700,
              transition: 'all 0.2s'
            }}
            onMouseOver={e => e.currentTarget.style.background = 'rgba(255,255,255,0.15)'}
            onMouseOut={e => e.currentTarget.style.background = 'rgba(255,255,255,0.05)'}
          >
            CLOSE
          </button>
        </div>

        {/* Status indicator */}
        <div style={{ 
          background: 'rgba(255,255,255,0.02)', 
          border: '1px solid rgba(255,255,255,0.05)',
          padding: '20px',
          borderRadius: 12,
          marginBottom: 32,
          textAlign: 'center'
        }}>
          <div style={{ fontSize: 10, fontWeight: 800, color: 'var(--text-dim)', textTransform: 'uppercase', letterSpacing: '0.1em', marginBottom: 8 }}>
             Active Structural Barriers
          </div>
          <div style={{ fontSize: 24, fontWeight: 800, color: '#fff' }}>
             {stats.reduce((acc, s) => acc + s.count, 0)} <span style={{ fontSize: 14, color: 'var(--text-dim)', fontWeight: 500 }}>Elements</span>
          </div>
        </div>

        {/* List */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
          {stats.length > 0 ? stats.map((s) => (
            <div key={s.label} style={{ 
              display: 'flex', 
              alignItems: 'center', 
              gap: 16,
              padding: '12px 16px',
              background: 'rgba(255,255,255,0.03)',
              borderRadius: 12,
              border: '1px solid rgba(255,255,255,0.05)'
            }}>
              <div style={{ fontSize: 20 }}>{s.icon}</div>
              <div style={{ flex: 1 }}>
                <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--text-dim)', textTransform: 'uppercase', marginBottom: 2 }}>{s.label}</div>
                <div style={{ fontSize: 16, fontWeight: 700, color: '#fff' }}>{s.count} <span style={{ fontSize: 11, color: s.color, fontWeight: 800 }}>OBJECTS</span></div>
              </div>
              <div style={{ width: 4, height: 32, background: s.color, borderRadius: 2 }} />
            </div>
          )) : (
            <div style={{ textAlign: 'center', padding: 20, color: 'var(--text-dim)', fontStyle: 'italic' }}>
              No subterranean data mapped for this sector.
            </div>
          )}
        </div>

        <div style={{ marginTop: 40, fontSize: 9, color: 'rgba(255,255,255,0.2)', textAlign: 'center', textTransform: 'uppercase', letterSpacing: '0.1em' }}>
          Depth Range: -2.0m to -8.0m BMSL
        </div>
      </div>
    </div>
  );
};

export default UndergroundAnalysisModal;
