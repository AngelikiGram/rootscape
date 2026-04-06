import React from 'react';
import { useSimStore } from '../store/simulationStore.js';
import { SPECIES_NORMS, CONSTRAINT_LABELS, UI_TRANSLATIONS } from '../data/speciesNorms.js';

const C = {
  bg: 'rgba(10, 12, 15, 0.98)',
  panel: 'rgba(21, 24, 28, 0.95)',
  border: 'rgba(255, 255, 255, 0.12)',
  green: '#2ecc71',
  yellow: '#f1c40f',
  red: '#e74c3c',
  blue: '#00d2ff',
  text: 'rgba(255,255,255,0.9)',
  muted: 'rgba(255,255,255,0.5)',
};

const scoreColor = (s) => (s >= 0.75 ? C.green : s >= 0.45 ? C.yellow : C.red);

export default function ComparisonModal({ onClose }) {
  const { acceptedPins, comparingPinIds, language } = useSimStore();
  const t = UI_TRANSLATIONS[language];
  const constraintsLabels = CONSTRAINT_LABELS[language];
  const comparePins = acceptedPins.filter(p => comparingPinIds.includes(p.id));

  if (comparePins.length === 0) return null;

  const allConstraintKeys = Object.keys(comparePins[0].constraints);

  return (
    <div style={{
      position: 'fixed', top: 0, left: 0, width: '100vw', height: '100vh',
      background: 'rgba(0,0,0,0.85)', backdropFilter: 'blur(10px)',
      display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 5000,
      padding: '40px'
    }}>
      <div style={{
        background: C.bg, border: `1px solid ${C.border}`, borderRadius: '24px',
        width: '100%', maxWidth: '1100px', maxHeight: '90vh', display: 'flex', flexDirection: 'column',
        boxShadow: '0 24px 64px rgba(0,0,0,0.8)', overflow: 'hidden'
      }}>
        {/* Header */}
        <div style={{ padding: '24px 32px', borderBottom: `1px solid ${C.border}`, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <div>
            <div style={{ fontSize: '10px', fontWeight: 800, color: C.blue, letterSpacing: '2px', textTransform: 'uppercase', marginBottom: '4px' }}>Analytical Review</div>
            <div style={{ fontSize: '24px', fontWeight: 900, color: '#fff', letterSpacing: '-0.5px' }}>Species Comparison Matrix</div>
          </div>
          <button onClick={onClose} style={{ background: 'rgba(255,255,255,0.05)', border: `1px solid ${C.border}`, color: '#fff', padding: '8px 16px', borderRadius: '12px', cursor: 'pointer', fontWeight: 800, fontSize: '12px' }}>CLOSE</button>
        </div>

        {/* Content Table */}
        <div style={{ flex: 1, overflowX: 'auto', padding: '32px' }}>
          <table style={{ width: '100%', borderCollapse: 'separate', borderSpacing: '12px 0' }}>
            <thead>
              <tr>
                <th style={{ textAlign: 'left', minWidth: '180px' }}></th>
                {comparePins.map(pin => {
                  const norm = SPECIES_NORMS[pin.speciesKey];
                  return (
                    <th key={pin.id} style={{ minWidth: '220px', paddingBottom: '24px', verticalAlign: 'top' }}>
                      <div style={{ background: 'rgba(255,255,255,0.03)', border: `1px solid ${C.border}`, borderRadius: '16px', padding: '16px' }}>
                        <div style={{ fontSize: '32px', marginBottom: '8px' }}>{norm?.emoji || '🌳'}</div>
                        <div style={{ fontSize: '14px', fontWeight: 800, color: '#fff' }}>{pin.label}</div>
                        <div style={{ fontSize: '10px', color: C.muted, marginBottom: '12px' }}>{pin.species}</div>
                        <div style={{ fontSize: '24px', fontWeight: 900, color: scoreColor(pin.overall) }}>{Math.round(pin.overall * 100)}%</div>
                        <div style={{ height: '4px', width: '100%', background: 'rgba(255,255,255,0.1)', borderRadius: '2px', marginTop: '6px' }}>
                          <div style={{ height: '100%', width: `${pin.overall * 100}%`, background: scoreColor(pin.overall), borderRadius: '2px' }} />
                        </div>
                      </div>
                      {pin.result.intervention?.suggestion && (
                        <div style={{ fontSize: '9px', color: C.yellow, background: 'rgba(241,196,15,0.05)', padding: '10px', borderRadius: '12px', border: '1px solid rgba(241,196,15,0.12)', marginTop: '8px', textAlign: 'left', fontWeight: 500, lineHeight: 1.4 }}>
                          {pin.result.intervention.suggestion}
                        </div>
                      )}
                    </th>
                  );
                })}
              </tr>
            </thead>
            <tbody>
              {allConstraintKeys.map(ckey => (
                <tr key={ckey}>
                  <td style={{ padding: '16px 0', borderBottom: `1px solid ${C.border}` }}>
                    <div style={{ fontSize: '11px', fontWeight: 700, color: '#fff', textTransform: 'uppercase', letterSpacing: '0.5px' }}>{constraintsLabels[ckey]}</div>
                    <div style={{ fontSize: '9px', color: C.muted }}>Primary site constraint</div>
                  </td>
                  {comparePins.map(pin => {
                    const c = pin.constraints[ckey];
                    return (
                      <td key={pin.id} style={{ padding: '16px 0', borderBottom: `1px solid ${C.border}` }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                          <div style={{ fontSize: '14px', fontWeight: 800, color: scoreColor(c.score), minWidth: '45px' }}>{Math.round(c.score * 100)}%</div>
                          <div style={{ flex: 1, height: '4px', background: 'rgba(255,255,255,0.05)', borderRadius: '2px' }}>
                            <div style={{ height: '100%', width: `${c.score * 100}%`, background: scoreColor(c.score), borderRadius: '2px' }} />
                          </div>
                        </div>
                        <div style={{ fontSize: '9px', color: C.muted, marginTop: '4px' }}>{c.label}</div>
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
