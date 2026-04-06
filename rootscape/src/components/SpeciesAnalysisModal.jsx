import React from 'react';
import { useSimStore } from '../store/simulationStore';

const SpeciesAnalysisModal = () => {
  const isOpen = useSimStore(s => s.speciesModalOpen);
  const trees = useSimStore(s => s.urbanTrees);
  
  if (!isOpen || !trees || trees.length === 0) return null;

  // Process data
  const stats = {};
  trees.forEach(t => {
    const sp = (t.properties.GATTUNG_ART || "Unknown").split(' ')[0];
    stats[sp] = (stats[sp] || 0) + 1;
  });

  const sorted = Object.entries(stats)
    .sort((a, b) => b[1] - a[1]);
  
  const total = trees.length;
  const top5 = sorted.slice(0, 5);

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
              Urban Forest Inventory
            </h2>
            <p style={{ margin: '4px 0 0', fontSize: 12, color: 'var(--text-dim)', fontWeight: 500 }}>
              Vienna City Baumkataster Analysis
            </p>
          </div>
          <button 
            onClick={() => useSimStore.setState({ speciesModalOpen: false })}
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

        {/* Total Badge */}
        <div style={{ 
          background: 'rgba(var(--accent-rgb), 0.1)', 
          border: '1px solid rgba(var(--accent-rgb), 0.3)',
          padding: '16px 20px',
          borderRadius: 12,
          marginBottom: 32,
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center'
        }}>
          <div>
            <div style={{ fontSize: 10, fontWeight: 800, color: 'var(--accent)', textTransform: 'uppercase', letterSpacing: '0.1em', marginBottom: 2 }}>
              Sampled Area (150m radius)
            </div>
            <div style={{ fontSize: 24, fontWeight: 800, color: '#fff' }}>
              {total} <span style={{ fontSize: 13, color: 'var(--text-dim)', fontWeight: 500 }}>Trees Total</span>
            </div>
          </div>
          <div style={{ textAlign: 'right' }}>
             <div style={{ fontSize: 10, fontWeight: 800, color: 'var(--text-dim)', textTransform: 'uppercase', letterSpacing: '0.1em' }}>
              Diversity
            </div>
            <div style={{ fontSize: 18, fontWeight: 700, color: '#fff' }}>
              {sorted.length} <span style={{ fontSize: 11, color: 'var(--text-dim)', fontWeight: 500 }}>Species</span>
            </div>
          </div>
        </div>

        {/* Species List */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--text-dim)', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: 4 }}>
            Dominant Species Breakdown
          </div>
          
          {top5.map(([name, count], i) => (
            <div key={name} style={{ position: 'relative' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6, position: 'relative', zIndex: 1 }}>
                <span style={{ fontSize: 13, fontWeight: 600 }}>{name}</span>
                <span style={{ fontSize: 13, fontWeight: 700, color: 'var(--accent)' }}>
                  {count} <span style={{ fontSize: 10, color: 'var(--text-dim)', opacity: 0.7 }}>({Math.round(count/total*100)}%)</span>
                </span>
              </div>
              {/* Progress Bar Background */}
              <div style={{ height: 4, background: 'rgba(255,255,255,0.05)', borderRadius: 2 }}>
                {/* Progress Bar Fill */}
                <div style={{ 
                  height: '100%', 
                  width: `${(count/top5[0][1]) * 100}%`, 
                  background: 'var(--accent)',
                  borderRadius: 2,
                  opacity: 0.8 - (i * 0.12)
                }} />
              </div>
            </div>
          ))}
          
          {sorted.length > 5 && (
            <div style={{ 
              marginTop: 12, 
              paddingTop: 12, 
              borderTop: '1px dashed rgba(255,255,255,0.1)',
              fontSize: 11,
              color: 'var(--text-dim)',
              fontStyle: 'italic',
              textAlign: 'center'
            }}>
              + {sorted.length - 5} other architectural species in this sector
            </div>
          )}
        </div>

        <div style={{ marginTop: 40, fontSize: 9, color: 'rgba(255,255,255,0.2)', textAlign: 'center', textTransform: 'uppercase', letterSpacing: '0.1em' }}>
          Data Source: Vienna Open Data (Baumkataster WFS)
        </div>
      </div>
    </div>
  );
};

export default SpeciesAnalysisModal;
