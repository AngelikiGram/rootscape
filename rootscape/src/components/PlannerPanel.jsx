import React, { useMemo, useState, useEffect } from 'react';
import { useSimStore } from '../store/simulationStore.js';
import { computeAllViabilities } from '../utils/viabilityScore.js';
import { SPECIES_NORMS, CONSTRAINT_LABELS, UI_TRANSLATIONS } from '../data/speciesNorms.js';
import ComparisonModal from './ComparisonModal.jsx';

// ── Palette ───────────────────────────────────────────────────────────────────
const C = {
  bg:     'rgba(14, 16, 19, 0.97)',
  panel:  'rgba(22, 25, 30, 0.95)',
  row:    'rgba(255,255,255,0.04)',
  border: 'rgba(255,255,255,0.08)',
  green:  '#2ecc71',
  yellow: '#f1c40f',
  red:    '#e74c3c',
  blue:   '#3498db',
  muted:  'rgba(255,255,255,0.4)',
  text:   'rgba(255,255,255,0.88)',
};

// ── Score colour ──────────────────────────────────────────────────────────────
function scoreColor(s) {
  if (s >= 0.75) return C.green;
  if (s >= 0.45) return C.yellow;
  return C.red;
}

// ── ScoreBar ──────────────────────────────────────────────────────────────────
const ScoreBar = ({ score, width = 80, height = 5 }) => (
  <div style={{ width, height, background: 'rgba(255,255,255,0.1)', borderRadius: 3, overflow: 'hidden' }}>
    <div style={{ width: `${Math.round(score * 100)}%`, height: '100%', background: scoreColor(score), borderRadius: 3, transition: 'width 0.4s' }} />
  </div>
);

// ── ConstraintRow ─────────────────────────────────────────────────────────────
const ConstraintRow = ({ label, score, valueLabel }) => (
  <div style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '3px 0' }}>
    <span style={{ width: 76, fontSize: 9, color: C.muted, flexShrink: 0 }}>{label}</span>
    <ScoreBar score={score} width={60} />
    <span style={{ fontSize: 9, color: scoreColor(score), minWidth: 26, textAlign: 'right' }}>{Math.round(score * 100)}%</span>
    {valueLabel && <span style={{ fontSize: 8, color: C.muted, marginLeft: 2 }}>{valueLabel}</span>}
  </div>
);

// ── GrowthChart ───────────────────────────────────────────────────────────────
const GrowthChart = ({ norm, constraints }) => {
  if (!norm?.annualGrowthCm) return null;

  const W = 220, H = 100, PAD = { l: 32, r: 10, t: 20, b: 24 };
  const plotW = W - PAD.l - PAD.r;
  const plotH = H - PAD.t - PAD.b;
  const YEARS = 20;

  // DBH growth -> crown radius (r_crown ≈ DBH_cm * 0.14)
  const ALLOM = 0.14;
  const initialDBH = 8;
  const points = Array.from({ length: YEARS + 1 }, (_, yr) => {
    const dbh = initialDBH + norm.annualGrowthCm * yr;
    return dbh * ALLOM;
  });

  const bDist = constraints?.buildingDist?.value ?? 99;
  const tDist = constraints?.treeDist?.value ?? 99;
  // Conflict threshold is the SMALLEST distance to any structure
  const conflictR = Math.min(bDist, tDist / 2, norm.canopyRadius);
  
  const maxR = Math.max(...points, conflictR * 1.2, 5);
  const xt = yr => PAD.l + (yr / YEARS) * plotW;
  const yt = r  => PAD.t + plotH - (r / maxR) * plotH;

  const conflictYr = points.findIndex(r => r >= conflictR);
  const hasConflict = conflictYr >= 0 && conflictYr <= YEARS;
  const polyline = points.map((r, i) => `${xt(i).toFixed(1)},${yt(r).toFixed(1)}`).join(' ');

  return (
    <div style={{ marginTop: 12, padding: '10px', background: 'rgba(255,255,255,0.03)', borderRadius: '8px', border: '1px solid rgba(255,255,255,0.05)' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 8 }}>
        <div style={{ fontSize: 8, color: 'rgba(255,255,255,0.4)', letterSpacing: '0.8px', textTransform: 'uppercase' }}>20-Year Development</div>
        {hasConflict && (
          <div style={{ fontSize: 8, color: '#e74c3c', fontWeight: 900 }}>⚠ CONFLICT YR {conflictYr}</div>
        )}
      </div>
      
      <svg width={W} height={H} style={{ overflow: 'visible' }}>
        {/* Y-Axis Label */}
        <text x={8} y={PAD.t + plotH / 2} fontSize={7} fill="rgba(255,255,255,0.3)" textAnchor="middle" transform={`rotate(-90, 8, ${PAD.t + plotH / 2})`}>radius (m)</text>
        
        {/* Conflict line */}
        <line x1={PAD.l} y1={yt(conflictR)} x2={PAD.l + plotW} y2={yt(conflictR)} stroke="#e74c3c" strokeWidth={1} strokeDasharray="4 2" opacity={0.6} />
        <text x={PAD.l + 5} y={yt(conflictR) - 4} fontSize={7} fill="#e74c3c" fontWeight="bold">
          {bDist < tDist/2 ? `CONFLICT THRESHOLD (NEAREST BUILDING ${bDist}m)` : `CONFLICT THRESHOLD (NEAREST TREE ${tDist}m)`}
        </text>

        {/* Growth Curve */}
        <polyline points={polyline} fill="none" stroke="#2ecc71" strokeWidth={2} strokeLinecap="round" />
        
        {/* Markers */}
        <line x1={PAD.l} y1={PAD.t + plotH} x2={PAD.l + plotW} y2={PAD.t + plotH} stroke="rgba(255,255,255,0.1)" />
        <line x1={PAD.l} y1={PAD.t} x2={PAD.l} y2={PAD.t + plotH} stroke="rgba(255,255,255,0.1)" />

        {[0, 10, 20].map(yr => (
          <text key={yr} x={xt(yr)} y={H - 4} fontSize={7} fill="rgba(255,255,255,0.4)" textAnchor="middle">{yr}y</text>
        ))}

        {hasConflict && (
          <circle cx={xt(conflictYr)} cy={yt(points[conflictYr])} r={3} fill="#e74c3c" />
        )}
      </svg>

      <div style={{ fontSize: 7, color: 'rgba(255,255,255,0.3)', marginTop: 8, lineHeight: 1.4 }}>
        {hasConflict 
          ? `Species crown will exceed the ${bDist < tDist/2 ? 'building' : 'tree'} setback threshold in approx. ${conflictYr} years.`
          : `No structural conflicts predicted within the 20-year urban growth horizon.`}
      </div>
    </div>
  );
};

// ── CompareColumn ─────────────────────────────────────────────────────────────
const CompareColumn = ({ pin, onRemove }) => {
  const result = pin.result;
  if (!result) return null;
  const norm = SPECIES_NORMS[pin.speciesKey];
  const overall = result.overall;

  return (
    <div style={{
      width: 128, flexShrink: 0, background: C.panel, borderRadius: 10,
      border: `1px solid ${result.isFatal ? C.red : overall >= 0.6 ? C.green : C.yellow}33`,
      padding: '10px 10px 12px',
    }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 6 }}>
        <div>
          <div style={{ fontSize: 9, fontWeight: 800, color: C.text, letterSpacing: '0.3px' }}>{norm?.nameDE || pin.speciesKey}</div>
          <div style={{ fontSize: 8, color: C.muted }}>{pin.label || `Pin ${pin.id}`}</div>
        </div>
        <button onClick={onRemove} style={{ background: 'none', border: 'none', color: C.muted, cursor: 'pointer', fontSize: 11, lineHeight: 1, padding: 0 }}>✕</button>
      </div>

      <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 6 }}>
        <div style={{ fontSize: 20, fontWeight: 900, color: result.isFatal ? C.red : scoreColor(overall) }}>
          {result.isFatal ? '✕' : `${Math.round(overall * 100)}%`}
        </div>
        {!result.isFatal && <ScoreBar score={overall} width={50} height={6} />}
      </div>

      {Object.entries(result.constraints).map(([key, c]) => (
        <div key={key} style={{ display: 'flex', justifyContent: 'space-between', padding: '2px 0', borderBottom: `1px solid ${C.border}` }}>
          <span style={{ fontSize: 8, color: C.muted }}>{CONSTRAINT_LABELS[key]}</span>
          <span style={{ fontSize: 8, color: scoreColor(c.score), fontWeight: 700 }}>{Math.round(c.score * 100)}%</span>
        </div>
      ))}

      {result.intervention?.suggestion && (
        <div style={{ marginTop: 6, fontSize: 8, color: C.yellow, lineHeight: 1.4 }}>
          ⚡ {result.intervention.suggestion}
        </div>
      )}
    </div>
  );
};

// ── PlannerPanel ──────────────────────────────────────────────────────────────
const PlannerPanel = () => {
  const {
    candidateLocation, soilMeta, buildings, buildingOrigin3857, undergroundData,
    pavements, trees, urbanTrees, candidatePlantMode, setCandidatePlantMode,
    setViabilityResults,
    acceptedPins, comparingPinIds,
    acceptPin, removePin, toggleComparePin, clearComparePins,
    language,
  } = useSimStore();

  const t = UI_TRANSLATIONS[language];
  const constraintsLabels = CONSTRAINT_LABELS[language];

  const [expandConstraints, setExpandConstraints] = useState(false);
  const [selectedSpeciesKey, setSelectedSpeciesKey] = useState(null);

  // ── Compute viability whenever candidate location changes ─────────────────
  const results = useMemo(() => {
    if (!candidateLocation) return null;
    return computeAllViabilities(
      candidateLocation, soilMeta, buildings, buildingOrigin3857,
      undergroundData, pavements, trees, urbanTrees
    );
  }, [candidateLocation, soilMeta, buildings, buildingOrigin3857, undergroundData, pavements, trees, urbanTrees]);

  useEffect(() => {
    const handler = setTimeout(() => {
      if (results) {
        setViabilityResults(results);
      }
    }, 100);
    return () => clearTimeout(handler);
  }, [results, setViabilityResults]);

  const topResult = results?.[0];
  const selectedResult = selectedSpeciesKey
    ? results?.find(r => r.key === selectedSpeciesKey)
    : topResult;

  const norm = selectedResult ? SPECIES_NORMS[selectedResult.key] : null;

  // Compare mode
  const comparePins = acceptedPins.filter(p => comparingPinIds.includes(p.id));
  const isComparing = comparePins.length >= 2;

  // ── Accept / Reject pin ───────────────────────────────────────────────────
  const handleAccept = () => {
    if (!candidateLocation || !selectedResult) return;
    acceptPin({
      x: candidateLocation.x,
      z: candidateLocation.z,
      species: (language === 'en' ? norm?.nameEN : norm?.nameDE) || selectedResult.key,
      speciesKey: selectedResult.key,
      label: `Site #${acceptedPins.length + 1}`,
      overall: selectedResult.result.overall,
      result: selectedResult.result,
      constraints: selectedResult.result.constraints,
    });
    setCandidatePlantMode(false);
  };

  // ── Styles ────────────────────────────────────────────────────────────────
  const panelW = isComparing ? Math.min(440, 160 + comparePins.length * 130) : 280;

  return (
    <div style={{
      position: 'absolute', bottom: 'calc(var(--timeline-h) + 20px)', left: 16, width: panelW,
      background: C.bg, borderRadius: 14, border: `1px solid ${C.border}`,
      boxShadow: '0 8px 32px rgba(0,0,0,0.6)', zIndex: 1200,
      fontFamily: 'ui-monospace, monospace', color: C.text,
      maxHeight: 'calc(100vh - 220px)', overflow: 'hidden', 
      display: 'flex', flexDirection: 'column',
      transition: 'width 0.3s ease',
    }}>

      {/* ── Header (Sticky) ── */}
      <div style={{ padding: '12px 14px 10px', borderBottom: `1px solid ${C.border}`, flexShrink: 0, position: 'relative', zIndex: 10, background: 'rgba(255,255,255,0.02)' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <div style={{ fontSize: 10, fontWeight: 800, letterSpacing: '0.8px', textTransform: 'uppercase' }}>
            {t.viabilityPlanner}
          </div>
          <button
            onClick={() => setCandidatePlantMode(!candidatePlantMode)}
            style={{
              background: candidatePlantMode ? 'rgba(46,204,113,0.3)' : 'rgba(255,255,255,0.06)',
              border: `1px solid ${candidatePlantMode ? C.green : C.border}`,
              color: candidatePlantMode ? C.green : C.muted,
              borderRadius: 6, padding: '3px 8px', fontSize: 8, fontWeight: 700,
              cursor: 'pointer', textTransform: 'uppercase', letterSpacing: '0.5px',
            }}
          >
            {candidatePlantMode ? t.dropPin : t.placePin}
          </button>
        </div>
        {candidatePlantMode && !candidateLocation && (
          <div style={{ fontSize: 8, color: C.yellow, marginTop: 5 }}>Click on terrain to place a candidate pin</div>
        )}
      </div>

      {/* ── Scrollable Content ── */}
      <div style={{ overflowY: 'auto', flex: 1, paddingBottom: 12 }}>
        {/* ── No location yet ── */}
        {!candidateLocation && !acceptedPins.length && (
          <div style={{ padding: '20px 14px', textAlign: 'center', color: C.muted, fontSize: 9 }}>
            Enable "Place Pin" and click the terrain to analyse a planting location.
          </div>
        )}


      {/* ── Species ranking list ── */}
      {results && (
        <div style={{ padding: '8px 14px 0' }}>
          <div style={{ fontSize: 8, color: C.muted, letterSpacing: '0.8px', textTransform: 'uppercase', marginBottom: 4 }}>
            {t.rankedSpecies} — {candidateLocation ? `(${candidateLocation.x.toFixed(0)}, ${candidateLocation.z.toFixed(0)})` : ''}
          </div>
          {results.map(({ key, norm: n, result: r }) => {
            const isSel = (selectedSpeciesKey || topResult?.key) === key;
            return (
              <div
                key={key}
                onClick={() => setSelectedSpeciesKey(key)}
                style={{
                  display: 'flex', alignItems: 'center', gap: 8, padding: '5px 8px',
                  borderRadius: 7, cursor: 'pointer', marginBottom: 2,
                  background: isSel ? 'rgba(46,204,113,0.12)' : 'rgba(255,255,255,0.02)',
                  border: `1px solid ${isSel ? 'rgba(46,204,113,0.3)' : 'transparent'}`,
                }}
              >
                <span style={{ fontSize: 12 }}>{n.emoji}</span>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 9, fontWeight: 700, color: C.text, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                    {language === 'en' ? n.nameEN : n.nameDE}
                  </div>
                  <div style={{ fontSize: 8, color: C.muted }}>{n.name}</div>
                </div>
                {r.isFatal ? (
                  <span style={{ fontSize: 9, color: C.red, fontWeight: 800 }}>✕</span>
                ) : (
                  <div style={{ textAlign: 'right' }}>
                    <div style={{ fontSize: 10, fontWeight: 800, color: scoreColor(r.overall) }}>{Math.round(r.overall * 100)}%</div>
                    <ScoreBar score={r.overall} width={40} height={3} />
                    <div style={{ marginTop: 2, display: 'flex', alignItems: 'center', gap: 4, justifyContent: 'flex-end' }}>
                       <div style={{ height: 2, width: 34, background: 'rgba(255,255,255,0.05)', borderRadius: 1 }}>
                          <div style={{ 
                            height: '100%', 
                            width: `${Math.round((1 - r.overall) * 100)}%`, 
                            background: (1 - r.overall) < 0.35 ? C.green : (1 - r.overall) < 0.65 ? C.yellow : C.red, 
                            opacity: 0.6, borderRadius: 1 
                          }} />
                       </div>
                       <span style={{ 
                         fontSize: 6, 
                         color: (1 - r.overall) < 0.35 ? C.green : (1 - r.overall) < 0.65 ? C.yellow : C.red, 
                         opacity: 0.7, fontWeight: 700, minWidth: 12 
                       }}>{Math.round((1 - r.overall) * 100)}%</span>
                    </div>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      {/* ── Selected species detail ── */}
      {selectedResult && norm && (
        <div style={{ padding: '10px 14px', borderTop: `1px solid ${C.border}`, marginTop: 4 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
            <div>
              <div style={{ fontSize: 11, fontWeight: 800, color: C.text }}>{norm.emoji} {language === 'en' ? norm.nameEN : norm.nameDE}</div>
              <div style={{ fontSize: 8, color: C.muted, fontStyle: 'italic' }}>{norm.name}</div>
            </div>
            <div style={{ textAlign: 'right' }}>
              {selectedResult.result.isFatal ? (
                <div style={{ fontSize: 14, fontWeight: 900, color: C.red }}>NOT VIABLE</div>
              ) : (
                <div style={{ fontSize: 18, fontWeight: 900, color: scoreColor(selectedResult.result.overall) }}>
                  {Math.round(selectedResult.result.overall * 100)}%
                </div>
              )}
              {selectedResult.result.isFatal && (
                <div style={{ fontSize: 8, color: C.red }}>
                  {selectedResult.result.fatalType === 'building' ? 'Inside building' :
                   selectedResult.result.fatalType === 'road'     ? 'On road/pavement' :
                                                                    'Canopy conflict'}
                </div>
              )}
            </div>
          </div>

          {/* Constraints */}
          <div
            onClick={() => setExpandConstraints(!expandConstraints)}
            style={{ cursor: 'pointer', userSelect: 'none' }}
          >
            <div style={{ fontSize: 8, color: C.muted, letterSpacing: '0.8px', textTransform: 'uppercase', marginBottom: 4, display: 'flex', justifyContent: 'space-between' }}>
              <span>{t.constraints}</span>
              <span>{expandConstraints ? '▲' : '▼'}</span>
            </div>
            {!expandConstraints && (
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 3 }}>
                {Object.entries(selectedResult.result.constraints).map(([k, c]) => (
                  <div key={k} title={`${constraintsLabels[k]}: ${Math.round(c.score*100)}%\n${c.label}`}
                    style={{ width: 18, height: 18, borderRadius: 3, background: scoreColor(c.score) + '44',
                      border: `1px solid ${scoreColor(c.score)}66`, display: 'flex', alignItems: 'center',
                      justifyContent: 'center', fontSize: 7, color: scoreColor(c.score) }}>
                    {Math.round(c.score * 10)}
                  </div>
                ))}
              </div>
            )}
          </div>

          {expandConstraints && (
            <div style={{ marginTop: 4 }}>
              {Object.entries(selectedResult.result.constraints).map(([k, c]) => (
                <ConstraintRow key={k} label={constraintsLabels[k]} score={c.score} valueLabel={c.label} />
              ))}
            </div>
          )}

          {/* Intervention */}
          {selectedResult.result.intervention?.suggestion && (
            <div style={{ marginTop: 8, padding: '6px 8px', background: 'rgba(241,196,15,0.08)', borderRadius: 6, border: '1px solid rgba(241,196,15,0.2)' }}>
              <div style={{ fontSize: 8, color: C.yellow, lineHeight: 1.5 }}>
                ⚡ {selectedResult.result.intervention.suggestion}
              </div>
              {selectedResult.result.intervention.alternative && (
                <div style={{ fontSize: 8, color: C.muted, marginTop: 3 }}>
                  Alt: {selectedResult.result.intervention.alternative}
                </div>
              )}
            </div>
          )}

          {/* Growth chart */}
          <GrowthChart norm={norm} constraints={selectedResult.result.constraints} />

          {/* Accept / Reject */}
          <div style={{ display: 'flex', gap: 6, marginTop: 10 }}>
            <button onClick={handleAccept} style={{
              flex: 1, background: 'rgba(46,204,113,0.2)', border: `1px solid ${C.green}55`,
              color: C.green, borderRadius: 7, padding: '6px 0', fontSize: 9, fontWeight: 800,
              cursor: 'pointer', textTransform: 'uppercase', letterSpacing: '0.5px',
            }}>{t.accept}</button>
            <button onClick={() => setCandidatePlantMode(false)} style={{
              flex: 1, background: 'rgba(231,76,60,0.15)', border: '1px solid rgba(231,76,60,0.3)',
              color: C.red, borderRadius: 7, padding: '6px 0', fontSize: 9, fontWeight: 800,
              cursor: 'pointer', textTransform: 'uppercase', letterSpacing: '0.5px',
            }}>{t.dismiss}</button>
          </div>
        </div>
      )}

      {/* ── Accepted pins list ── */}
      {acceptedPins.length > 0 && (
        <div style={{ padding: '8px 14px 10px', borderTop: `1px solid ${C.border}` }}>
          <div style={{ fontSize: 8, color: C.muted, letterSpacing: '0.8px', textTransform: 'uppercase', marginBottom: 6 }}>
            {t.acceptedPins} ({acceptedPins.length})
            {comparingPinIds.length > 0 && (
              <button onClick={clearComparePins} style={{ float: 'right', background: 'none', border: 'none', color: C.blue, cursor: 'pointer', fontSize: 8, fontWeight: 700 }}>
                {t.clearCompare}
              </button>
            )}
          </div>
          {acceptedPins.map(pin => {
            const inCompare = comparingPinIds.includes(pin.id);
            const pinNorm = SPECIES_NORMS[pin.speciesKey];
            return (
              <div key={pin.id} style={{
                display: 'flex', alignItems: 'center', gap: 6, padding: '4px 6px',
                borderRadius: 7, marginBottom: 3,
                background: inCompare ? 'rgba(52,152,219,0.12)' : C.row,
                border: `1px solid ${inCompare ? C.blue + '44' : C.border}`,
              }}>
                <span style={{ fontSize: 10 }}>{pinNorm?.emoji || '📍'}</span>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 9, fontWeight: 700, color: C.text, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{pin.label}</div>
                  <div style={{ fontSize: 8, color: pin.overall >= 0.6 ? C.green : C.yellow }}>{Math.round((pin.overall || 0) * 100)}%</div>
                </div>
                <button onClick={() => toggleComparePin(pin.id)} title="Toggle compare" style={{
                  background: inCompare ? C.blue + '33' : 'none', border: `1px solid ${inCompare ? C.blue : C.border}`,
                  color: inCompare ? C.blue : C.muted, borderRadius: 4, width: 20, height: 20,
                  cursor: 'pointer', fontSize: 9, display: 'flex', alignItems: 'center', justifyContent: 'center',
                }}>
                  {inCompare ? '✓' : '☐'}
                </button>
                <button onClick={() => removePin(pin.id)} style={{
                  background: 'none', border: 'none', color: C.muted, cursor: 'pointer', fontSize: 11, padding: 0, lineHeight: 1,
                }}>✕</button>
              </div>
            );
          })}
        </div>
      )}

      {/* ── Compare mode ── */}
      {comparePins.length > 0 && (
        <div style={{ padding: '10px 14px', borderTop: `1px solid ${C.border}` }}>
          <div style={{ fontSize: 8, color: C.blue, letterSpacing: '0.8px', textTransform: 'uppercase', marginBottom: 8, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <span>◆ Review & Comparison — {comparePins.length} pins</span>
            <button 
              onClick={() => useSimStore.setState({ showComparisonModal: true })}
              style={{ background: C.blue, border: 'none', color: '#fff', fontSize: 7, fontWeight: 900, padding: '2px 6px', borderRadius: 4, cursor: 'pointer', boxShadow: '0 0 10px rgba(0,210,255,0.4)' }}>
              {comparePins.length > 1 ? 'COMPARE MATRIX' : 'FULL ANALYSIS'}
            </button>
          </div>
          <div style={{ display: 'flex', gap: 8, overflowX: 'auto' }}>
            {comparePins.map(pin => (
              <CompareColumn key={pin.id} pin={pin} onRemove={() => toggleComparePin(pin.id)} />
            ))}
          </div>

          {/* Recommendation box */}
          {(() => {
            const best = [...comparePins].sort((a, b) => (b.overall || 0) - (a.overall || 0))[0];
            const bestNorm = SPECIES_NORMS[best?.speciesKey];
            if (!best || !bestNorm) return null;
            return (
              <div style={{ marginTop: 10, padding: '8px 10px', background: 'rgba(46,204,113,0.08)', borderRadius: 8, border: `1px solid ${C.green}33` }}>
                <div style={{ fontSize: 8, color: C.green, fontWeight: 800, letterSpacing: '0.6px', textTransform: 'uppercase', marginBottom: 3 }}>
                  {t.recommendation}
                </div>
                <div style={{ fontSize: 9, color: C.text }}>
                  {bestNorm.emoji} <strong>{language === 'en' ? bestNorm.nameEN : bestNorm.nameDE}</strong> scores highest at <span style={{ color: C.green }}>{Math.round((best.overall || 0) * 100)}%</span>.
                </div>
                {best.result?.intervention?.suggestion && (
                  <div style={{ fontSize: 8, color: C.muted, marginTop: 3 }}>{best.result.intervention.suggestion}</div>
                )}
              </div>
            );
          })()}
        </div>
      )}

      {/* ── NDVI validation (scientific, not scored) ── */}
      {soilMeta?.ndvi !== undefined && (
        <div style={{ padding: '8px 14px 12px', borderTop: `1px solid ${C.border}` }}>
          <div style={{ fontSize: 8, color: C.muted, letterSpacing: '0.8px', textTransform: 'uppercase', marginBottom: 5 }}>
            ── {t.ndvi} ──
          </div>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '4px 0' }}>
            <span style={{ fontSize: 9, color: C.muted }}>NDVI Index</span>
            <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
              <ScoreBar score={Math.max(0, Math.min(1, (soilMeta.ndvi + 1) / 2))} width={50} />
              <span style={{ fontSize: 10, fontWeight: 700, color: soilMeta.ndvi > 0.4 ? C.green : soilMeta.ndvi > 0.2 ? C.yellow : C.red }}>
                {soilMeta.ndvi.toFixed(2)}
              </span>
            </div>
          </div>
          <div style={{ fontSize: 8, color: C.muted, lineHeight: 1.5, marginTop: 3 }}>
            {soilMeta.ndvi > 0.5 ? 'Dense vegetation — site supports tree growth.'
             : soilMeta.ndvi > 0.3 ? 'Moderate vegetation cover present.'
             : soilMeta.ndvi > 0.1 ? 'Sparse vegetation — possible soil sealing or stress.'
             : 'Very low NDVI — likely sealed or bare surface.'}
          </div>
        </div>
      )}

      </div>
    </div>
  );
};

export default PlannerPanel;
