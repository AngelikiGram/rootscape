import React from 'react';
import { useSimStore } from '../store/simulationStore';
import { SPECIES_NORMS, CONSTRAINT_LABELS } from '../data/speciesNorms.js';

const C = {
  bg:     '#0d0f12',
  panel:  '#161b22',
  row:    'rgba(255,255,255,0.03)',
  border: 'rgba(255,255,255,0.08)',
  green:  '#2ecc71',
  yellow: '#f1c40f',
  red:    '#e74c3c',
  blue:   '#3498db',
  muted:  'rgba(255,255,255,0.4)',
  text:   'rgba(255,255,255,0.9)',
};

const scoreColor = (s) => (s >= 0.75 ? C.green : s >= 0.45 ? C.yellow : C.red);

const ScoreBar = ({ score, height = 4 }) => (
  <div style={{ width: '100%', height, background: 'rgba(255,255,255,0.07)', borderRadius: 2, overflow: 'hidden' }}>
    <div style={{ width: `${Math.round(score * 100)}%`, height: '100%', background: scoreColor(score), borderRadius: 2 }} />
  </div>
);

const PinComparisonModal = () => {
  const isOpen = useSimStore(s => s.comparisonModalOpen);
  const { acceptedPins, comparingPinIds } = useSimStore();
  const comparePins = acceptedPins.filter(p => comparingPinIds.includes(p.id));

  if (!isOpen || comparePins.length === 0) return null;

  return (
    <div style={{
      position: 'fixed', top: 0, left: 0, right: 0, bottom: 0,
      background: 'rgba(5, 7, 10, 0.9)', backdropFilter: 'blur(16px)',
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      zIndex: 100001, padding: '40px 20px',
      animation: 'fadeIn 0.3s ease-out'
    }}>
      <style>{`
        @keyframes fadeIn { from { opacity: 0; } to { opacity: 1; } }
        @keyframes slideIn { from { transform: translateY(30px) scale(0.98); opacity: 0; } to { transform: translateY(0) scale(1); opacity: 1; } }
        .comp-grid { display: grid; grid-template-columns: repeat(${comparePins.length}, 1fr); gap: 20px; overflow-x: auto; width: 100%; padding: 4px; }
      `}</style>

      <div style={{
        width: '100%', maxWidth: Math.min(1200, 200 + comparePins.length * 300),
        maxHeight: '90vh', background: C.bg, border: `1px solid ${C.border}`,
        borderRadius: 20, padding: 32, boxShadow: '0 40px 100px rgba(0,0,0,0.8)',
        animation: 'slideIn 0.4s cubic-bezier(0.16, 1, 0.3, 1)',
        display: 'flex', flexDirection: 'column', position: 'relative'
      }}>
        {/* Header */}
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 32 }}>
          <div>
            <h2 style={{ margin: 0, fontSize: 22, fontWeight: 800, color: '#fff', letterSpacing: '-0.02em' }}>
              Viability Comparison Analysis
            </h2>
            <p style={{ margin: '6px 0 0', fontSize: 13, color: C.muted, fontWeight: 500 }}>
              Benchmarking {comparePins.length} planting locations against local environmental constraints
            </p>
          </div>
          <button 
            onClick={() => useSimStore.setState({ comparisonModalOpen: false })}
            style={{ padding: '10px 18px', background: C.panel, border: `1px solid ${C.border}`, color: '#fff', borderRadius: 10, cursor: 'pointer', fontWeight: 700, fontSize: 11 }}
          >EXIT REPORT</button>
        </div>

        {/* The Grid */}
        <div className="comp-grid">
          {comparePins.map(pin => {
            const norm = SPECIES_NORMS[pin.speciesKey];
            const r = pin.result;
            return (
              <div key={pin.id} style={{ display: 'flex', flexDirection: 'column', gap: 24, minWidth: 260 }}>
                {/* Pin Head */}
                <div style={{ padding: 20, background: C.panel, borderRadius: 16, border: `1px solid ${scoreColor(pin.overall)}33` }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
                    <span style={{ fontSize: 32 }}>{norm?.emoji || '📍'}</span>
                    <div style={{ textAlign: 'right' }}>
                      <div style={{ fontSize: 24, fontWeight: 900, color: scoreColor(pin.overall) }}>{Math.round(pin.overall * 100)}%</div>
                      <div style={{ fontSize: 9, fontWeight: 800, color: C.muted, textTransform: 'uppercase' }}>Overall Score</div>
                    </div>
                  </div>
                  <div style={{ fontSize: 14, fontWeight: 800, color: '#fff' }}>{norm?.nameDE || 'Unknown Species'}</div>
                  <div style={{ fontSize: 11, color: C.muted, marginBottom: 12 }}>{pin.label}</div>
                  <ScoreBar score={pin.overall} height={6} />
                </div>

                {/* Constraint Breakdown */}
                <div style={{ fontSize: 11, fontWeight: 800, color: C.muted, textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: -16 }}>Constraints</div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 10, padding: '0 4px' }}>
                  {Object.entries(pin.constraints).map(([k, c]) => (
                    <div key={k}>
                      <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 4 }}>
                        <span style={{ color: C.text, fontSize: 11 }}>{CONSTRAINT_LABELS[k]}</span>
                        <span style={{ color: scoreColor(c.score), fontWeight: 800 }}>{Math.round(c.score * 100)}%</span>
                      </div>
                      <ScoreBar score={c.score} height={3} />
                      <div style={{ fontSize: 9, color: C.muted, marginTop: 4 }}>{c.label}</div>
                    </div>
                  ))}
                </div>

                {/* Growth Strategy */}
                <div style={{ marginTop: 8, padding: 16, background: 'rgba(255,255,255,0.02)', borderRadius: 12, border: `1px solid ${C.border}` }}>
                   <div style={{ fontSize: 10, fontWeight: 800, color: C.muted, marginBottom: 8 }}>GROWTH STRATEGY</div>
                   <div style={{ display: 'flex', gap: 12 }}>
                      <div style={{ flex: 1 }}>
                        <div style={{ fontSize: 9, color: C.muted }}>Growth Speed</div>
                        <div style={{ fontSize: 12, fontWeight: 700, color: '#fff' }}>{norm?.growthSpeedLabel || 'Medium'}</div>
                      </div>
                      <div style={{ flex: 1 }}>
                        <div style={{ fontSize: 9, color: C.muted }}>Mature Height</div>
                        <div style={{ fontSize: 12, fontWeight: 700, color: '#fff' }}>~{norm?.annualGrowthCm * 0.4 || 15}m</div>
                      </div>
                   </div>
                </div>

                {/* Suggestions */}
                {r.intervention?.suggestion && (
                  <div style={{ padding: 12, background: 'rgba(241,196,15,0.06)', borderLeft: `3px solid ${C.yellow}`, borderRadius: 4 }}>
                     <div style={{ fontSize: 9, color: C.yellow, fontWeight: 800, marginBottom: 4 }}>SITE INTERVENTION</div>
                     <div style={{ fontSize: 10, lineHeight: 1.4, color: C.text }}>⚡ {r.intervention.suggestion}</div>
                  </div>
                )}
              </div>
            );
          })}
        </div>

        {/* Footer Summary */}
        <div style={{ marginTop: 'auto', paddingTop: 24, borderTop: `1px solid ${C.border}`, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <div style={{ fontSize: 11, color: C.muted }}>
            Scientific comparison based on <span style={{ color: C.blue }}>RootScape Allometry 2.0</span>
          </div>
          <div style={{ display: 'flex', gap: 16 }}>
             {/* Recommendation badge */}
             {(() => {
                const best = [...comparePins].sort((a,b) => b.overall - a.overall)[0];
                return (
                  <div style={{ background: `${C.green}11`, border: `1px solid ${C.green}33`, padding: '8px 16px', borderRadius: 8, color: C.green, fontSize: 12, fontWeight: 800 }}>
                    BEST SITE: {best.label} ({Math.round(best.overall*100)}%)
                  </div>
                );
             })()}
          </div>
        </div>
      </div>
    </div>
  );
};

export default PinComparisonModal;
