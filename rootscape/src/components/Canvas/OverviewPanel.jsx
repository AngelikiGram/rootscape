import React, { useMemo, useRef, useState, useEffect } from 'react';
import * as d3 from 'd3';
import { useSimStore } from '../../store/simulationStore.js';
import { toPng } from 'html-to-image';

const EARTH_RADIUS = 6378137;
function toMerc(lat, lon) {
  const x = lon * (Math.PI / 180) * EARTH_RADIUS;
  const y = Math.log(Math.tan((90 + lat) * (Math.PI / 360))) * EARTH_RADIUS;
  return [x, y];
}

// Synthetic stress evolution curve for a tree.
// treeIndex introduces per-tree variation so different trees turn critical at different times.
function stressCurveAt(baseStress, year, startYear, endYear, treeIndex = 0) {
  const t = (year - startYear) / Math.max(1, endYear - startYear); // 0..1
  // Spread the sigmoid inflection point across ±0.2 based on tree index
  const variation = ((treeIndex * 2654435761) >>> 0) % 1000 / 1000 * 0.4 - 0.2;
  const inflection = Math.max(0.15, Math.min(0.85, 0.45 + variation));
  const aging    = 0.15 * t * t;
  const conflict = baseStress * (0.4 + 0.6 * (1 / (1 + Math.exp(-8 * (t - inflection)))));
  return Math.min(1, conflict + aging);
}

export default function OverviewPanel() {
  const {
    urbanTrees, acceptedPins, fetchRadius, loadingGIS, language,
    pavements,
    rootSimYear, rootSimStartYear, rootSimEndYear,
  } = useSimStore();

  const isDE = language === 'de';

  const [stressThreshold, setStressThreshold] = React.useState(0.6);
  const [minViability,    setMinViability]    = React.useState(0.0);
  const [hoveredTree,     setHoveredTree]     = React.useState(null);
  const [mousePos,        setMousePos]        = React.useState({ x: 0, y: 0 });

  const containerRef = useRef(null);
  const handleExport = () => {
    if (!containerRef.current) return;
    toPng(containerRef.current, { backgroundColor: '#0a1018', skipFonts: true })
      .then(url => {
        const a = document.createElement('a');
        a.download = `analysis-overview-${rootSimYear}.png`;
        a.href = url;
        a.click();
      }).catch(err => {
        console.error("[Export] Analysis tab failed:", err);
      });
  };

  // ── Pre-compute per-tree screen positions once (only when trees/origin change) ──
  const treeScreenPositions = useMemo(() => {
    const [ox, oy] = useSimStore.getState().buildingOrigin3857 || [0, 0];
    return urbanTrees.map(t => {
      const [lon, lat] = t.geometry.coordinates;
      const [wx, wy] = toMerc(lat, lon);
      return { lx: wx - ox, lz: -(wy - oy) };
    });
  }, [urbanTrees]);

  // ── Stress at the current scrubbed year ──────────────────────────────
  const treesAtYear = useMemo(() => urbanTrees.map((t, i) => ({
    ...t,
    stressNow: stressCurveAt(
      t.properties?.stress_score ?? 0.45,
      rootSimYear, rootSimStartYear, rootSimEndYear, i,
    ),
  })), [urbanTrees, rootSimYear, rootSimStartYear, rootSimEndYear]);

  // ── Summary metrics ──────────────────────────────────────────────────
  const summary = useMemo(() => {
    const total   = treesAtYear.length || 1;
    const healthy = treesAtYear.filter(t => t.stressNow < stressThreshold).length;
    const totalP  = acceptedPins.length || 1;
    const validP  = acceptedPins.filter(p => (p.overall || 0) >= minViability).length;
    return {
      districtHealth:    Math.round((healthy / total) * 100),
      healthyCount:      healthy,
      totalTrees:        treesAtYear.length,
      viabilityRate:     Math.round((validP / totalP) * 100),
      recommendedCount:  validP,
      totalPins:         acceptedPins.length,
    };
  }, [treesAtYear, acceptedPins, stressThreshold, minViability]);

  // ── Stress histogram over time (10 buckets across sim period) ────────
  const stressHistory = useMemo(() => {
    const STEPS = 30;
    return Array.from({ length: STEPS }, (_, i) => {
      const yr   = rootSimStartYear + (i / (STEPS - 1)) * (rootSimEndYear - rootSimStartYear);
      const vals = urbanTrees.map((t, i) =>
        stressCurveAt(t.properties?.stress_score ?? 0.45, yr, rootSimStartYear, rootSimEndYear, i));
      const critical = vals.filter(v => v >= stressThreshold).length;
      const avgStress = vals.length ? vals.reduce((s, v) => s + v, 0) / vals.length : 0;
      return { yr, critical, avgStress, pct: critical / Math.max(1, vals.length) };
    });
  }, [urbanTrees, rootSimStartYear, rootSimEndYear, stressThreshold]);

  const W = 740, H = 500;
  const mapSize = Math.min(W, H) - 40;
  const mmScale = d3.scaleLinear().domain([-fetchRadius, fetchRadius]).range([0, mapSize]);
  const offset  = { x: (W - mapSize) / 2, y: (H - mapSize) / 2 };

  // ── Pre-compute road polyline strings (only when pavements/fetchRadius change) ──
  const roadPolylines = useMemo(() => {
    const [ox, oy] = useSimStore.getState().buildingOrigin3857 || [0, 0];
    const sc = d3.scaleLinear().domain([-fetchRadius, fetchRadius]).range([0, Math.min(W, H) - 40]);
    return (pavements || []).map((p, i) => {
      const isRoad = ['primary', 'secondary', 'tertiary', 'residential'].includes(p.type);
      const isPed  = ['footway', 'pedestrian', 'path'].includes(p.type);
      const points = p.nodes.map(n => `${sc(n[0] - ox)},${sc(-(n[1] - oy))}`).join(' ');
      return { i, points, isRoad, isPed };
    });
  }, [pavements, fetchRadius]);

  if (loadingGIS) {
    return (
      <div style={{ width: '100%', height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', background: '#0a0e14', color: 'rgba(255,255,255,0.4)', fontFamily: '"Outfit",sans-serif', fontSize: 14, fontWeight: 700, letterSpacing: '2px' }}>
        LOADING SPATIAL DATA…
      </div>
    );
  }



  // Chart layout
  const CH = 70, CW = 540;
  const maxPct = Math.max(...stressHistory.map(d => d.pct), 0.01);
  const cursorPct = (rootSimYear - rootSimStartYear) / Math.max(1, rootSimEndYear - rootSimStartYear);

  return (
    <div ref={containerRef} style={{
      width: '100%', height: '100%', background: '#0a0e14', color: '#fff',
      display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
      position: 'relative', overflow: 'hidden', fontFamily: '"Outfit", sans-serif',
    }}>
      {/* ── Header ── */}
      <div style={{ position: 'absolute', top: 28, left: 28, zIndex: 100, display: 'flex', justifyContent: 'space-between', width: 'calc(100% - 56px)' }}>
        <div>
          <div style={{ fontSize: 9, color: 'var(--accent)', fontWeight: 900, letterSpacing: '3px', textTransform: 'uppercase', marginBottom: 4 }}>
            {isDE ? 'GEBIETSWEITE ANALYSE' : 'DISTRICT-WIDE ANALYSIS'}
          </div>
          <h1 style={{ margin: 0, fontSize: 26, fontWeight: 950, letterSpacing: '-0.8px' }}>
            {isDE ? 'RISIKO-ÜBERSICHT' : 'RISK OVERVIEW'}
          </h1>
          <p style={{ margin: '5px 0 0', fontSize: 11, color: 'rgba(255,255,255,0.32)', maxWidth: 440 }}>
            {isDE ? 'Filtert Bäume nach Stresstoleranz und Viabilität. Scrubben Sie die Zeitachse, um die Auswirkung des Wurzelwachstums zu sehen.' 
                  : 'Filter trees by stress tolerance and viability. Scrub the timeline to see root growth impact.'}
          </p>
        </div>
      </div>

      <div style={{ position: 'absolute', bottom: 28, right: 28, zIndex: 100 }}>
        <button onClick={handleExport}
            style={{ background: 'var(--accent)', border: 'none', color: '#000', padding: '6px 14px', borderRadius: 10, fontSize: 8, fontWeight: 900, cursor: 'pointer', letterSpacing: '1px' }}>
            EXPORT PNG
        </button>
      </div>

      {/* ── Left panel: metrics ── */}
      <div style={{ position: 'absolute', top: 140, left: 28, zIndex: 100 }}>
        <div style={{
          background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.09)',
          padding: '20px', borderRadius: '18px', display: 'flex', flexDirection: 'column',
          gap: '16px', minWidth: '240px',
        }}>
          <div style={{ fontSize: 9, color: 'var(--accent)', fontWeight: 800, letterSpacing: '1.5px' }}>
            {isDE ? 'SCHWELLENWERT-TUNING' : 'THRESHOLD TUNING'}
          </div>

          {/* Canopy health */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <span style={{ fontSize: 12, color: 'rgba(255,255,255,0.7)', fontWeight: 600 }}>
                {isDE ? 'Kronenvitalität' : 'Canopy Health'}
              </span>
              <span style={{ fontSize: 18, fontWeight: 950, color: summary.districtHealth > 50 ? 'var(--accent-green)' : '#e74c3c' }}>
                {summary.districtHealth}%
              </span>
            </div>
            <div style={{ height: '3px', background: 'rgba(255,255,255,0.05)', borderRadius: 2, overflow: 'hidden' }}>
              <div style={{ width: `${summary.districtHealth}%`, height: '100%', background: summary.districtHealth > 50 ? 'var(--accent-green)' : '#e74c3c', transition: 'width 0.6s ease' }} />
            </div>
            <div style={{ fontSize: 9, color: 'rgba(255,255,255,0.3)' }}>
              {summary.healthyCount} / {summary.totalTrees} {isDE ? 'Bäume unter Schwellenwert' : 'trees below threshold'}
            </div>
          </div>

          {/* Stress threshold slider */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: '5px', borderTop: '1px solid rgba(255,255,255,0.05)', paddingTop: '12px' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between' }}>
              <span style={{ fontSize: 11, color: '#e74c3c', fontWeight: 700 }}>
                {isDE ? 'Stresslimit' : 'Critical Stress Limit'}
              </span>
              <span style={{ fontSize: 14, fontWeight: 950, color: '#e74c3c' }}>
                &lt; {Math.round(stressThreshold * 100)}%
              </span>
            </div>
            <input type="range" min="0" max="1" step="0.05"
              value={stressThreshold}
              onChange={e => setStressThreshold(parseFloat(e.target.value))}
              style={{ accentColor: '#e74c3c' }} />
          </div>

          {/* Pin viability */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: '6px', borderTop: '1px solid rgba(255,255,255,0.05)', paddingTop: '12px' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <span style={{ fontSize: 12, color: 'var(--accent)', fontWeight: 700 }}>
                {isDE ? 'Standort-Viabilität' : 'Site Viability'}
              </span>
              <span style={{ fontSize: 18, fontWeight: 950, color: 'var(--accent)' }}>
                {summary.viabilityRate}%
              </span>
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
              <input type="range" min="0" max="1" step="0.05"
                value={minViability}
                onChange={e => setMinViability(parseFloat(e.target.value))}
                style={{ flex: 1, accentColor: 'var(--accent)' }} />
              <span style={{ fontSize: 9, color: 'var(--accent)', fontWeight: 900, minWidth: 30 }}>
                &gt;{Math.round(minViability * 100)}%
              </span>
            </div>
          </div>
        </div>
      </div>

      {/* ── Spatial map ── */}
      <svg width={W} height={H} style={{ filter: 'drop-shadow(0 0 40px rgba(0,0,0,0.5))' }}>
        <g transform={`translate(${offset.x}, ${offset.y})`}>
          <defs>
            <pattern id="grid2" width="40" height="40" patternUnits="userSpaceOnUse">
              <path d="M 40 0 L 0 0 0 40" fill="none" stroke="rgba(255,255,255,0.03)" strokeWidth="1" />
            </pattern>
          </defs>
          <rect width={mmScale.range()[1]} height={mmScale.range()[1]} fill="url(#grid2)" rx="20" />
          <rect width={mmScale.range()[1]} height={mmScale.range()[1]} fill="none" rx="20" stroke="rgba(255,255,255,0.09)" strokeWidth="2" />

          {/* Roads */}
          {roadPolylines.map(({ i, points, isRoad, isPed }) => (
            <polyline key={i} points={points} fill="none"
              stroke={isRoad ? 'rgba(255,255,255,0.22)' : isPed ? 'rgba(255,255,255,0.3)' : 'rgba(255,255,255,0.1)'}
              strokeWidth={isRoad ? '4.5' : isPed ? '1.8' : '1.2'}
              strokeLinecap="round" strokeDasharray={isPed ? '3 3' : 'none'} />
          ))}

          {/* Trees coloured by stress at current year */}
          {treesAtYear.map((t, i) => {
            const { lx, lz } = treeScreenPositions[i] || {};
            if (!treeScreenPositions[i]) return null;
            if (Math.abs(lx) > fetchRadius * 1.5 || Math.abs(lz) > fetchRadius * 1.5) return null;
            const s    = t.stressNow;
            const crit = s >= stressThreshold;
            const col  = crit ? '#e74c3c' : s > 0.35 ? '#f1c40f' : '#2ecc71';
            return (
              <g key={i}>
                {crit && (
                  <circle cx={mmScale(lx)} cy={mmScale(lz)} r={7} fill="#e74c3c" opacity="0.13">
                    <animate attributeName="r" values="3;10;3" dur="2.2s" repeatCount="indefinite" />
                  </circle>
                )}
                <circle cx={mmScale(lx)} cy={mmScale(lz)} r={crit ? 3.5 : 2.5}
                  fill={col} opacity={crit ? 1.0 : 0.5}
                  stroke={crit ? '#fff' : 'none'} strokeWidth="0.5" 
                  onMouseEnter={(e) => {
                    const props = t.properties || {};
                    const cleanId = props.BAUMNUMMER || (t.id || '').toString().split('.').pop();
                    const gart = props.GATTUNG_ART || props.GATTUNG_LAT || null;
                    const gRaw = props.GATTUNG || (gart ? gart.split(' ')[0] : 'Tree');
                    const gen = gRaw.charAt(0).toUpperCase() + gRaw.slice(1).toLowerCase();
                    const spec = props.ART_DEUTSCH || props.SPEZIES || gart || 'Unknown';
                    
                    setHoveredTree({
                      ...t,
                      displayId: cleanId,
                      genus: gen,
                      species: spec,
                      height: props.BAUMHOEHE || 10,
                      crown: props.KRONENDURCHMESSER || 6,
                    });
                  }}
                  onMouseLeave={() => setHoveredTree(null)}
                  onMouseMove={(e) => setMousePos({ x: e.clientX, y: e.clientY })}
                  style={{ cursor: 'pointer' }}
                />
              </g>
            );
          })}

          {/* Planner pins */}
          {acceptedPins.filter(p => (p.overall || 0) >= minViability).map(pin => (
            <g key={pin.id} transform={`translate(${mmScale(pin.x)}, ${mmScale(pin.z)})`}>
              <circle r="12" fill="#00d2ff" opacity="0.08">
                <animate attributeName="r" values="8;16;8" dur="4s" repeatCount="indefinite" />
              </circle>
              <circle r="3" fill="#00d2ff" stroke="#fff" strokeWidth="1.5" />
              <text y="-14" textAnchor="middle" fill="#00d2ff" fontSize="8" fontWeight="900">{pin.label}</text>
            </g>
          ))}
        </g>
      </svg>

      {/* ── Stress-over-time chart + year slider ── */}
      <div style={{
        position: 'absolute', bottom: 20, left: '50%', transform: 'translateX(-50%)',
        width: CW + 80, background: 'rgba(10,14,20,0.92)', border: '1px solid rgba(255,255,255,0.09)',
        borderRadius: '16px', padding: '14px 24px', backdropFilter: 'blur(20px)',
      }}>
        <div style={{ fontSize: 8, fontWeight: 900, color: 'var(--accent)', letterSpacing: '2px', marginBottom: 8 }}>
          {isDE ? 'STRESS-ENTWICKLUNG ÜBER ZEIT' : 'STRESS EVOLUTION OVER TIME'}
        </div>

        {/* Bar chart */}
        <div style={{ position: 'relative', height: CH, marginBottom: 6 }}>
          <svg width="100%" height={CH} viewBox={`0 0 ${CW} ${CH}`} preserveAspectRatio="none">
            {stressHistory.map((d, i) => {
              const barH = (d.pct / maxPct) * (CH - 8);
              const barW = CW / stressHistory.length - 1;
              const x    = i * (CW / stressHistory.length);
              return (
                <rect key={i} x={x} y={CH - barH} width={barW} height={barH}
                  fill={d.pct > 0.5 ? '#e74c3c' : d.pct > 0.25 ? '#f1c40f' : 'var(--accent-green)'}
                  opacity={d.yr <= rootSimYear ? 0.9 : 0.22}
                  rx="1"
                />
              );
            })}
            {/* Current year cursor */}
            <line
              x1={cursorPct * CW} x2={cursorPct * CW}
              y1={0} y2={CH}
              stroke="var(--accent)" strokeWidth="1.5" strokeDasharray="3 2"
            />
          </svg>
        </div>

        {/* Current Year display */}
        <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 4 }}>
          <span style={{ fontSize: 11, fontWeight: 950, color: 'var(--accent)' }}>
            {isDE ? 'Aktuelles Jahr: ' : 'Current Year: '} {rootSimYear}
          </span>
        </div>

        {/* Chart legend */}
        <div style={{ display: 'flex', gap: 16, marginTop: 6 }}>
          {[['#2ecc71', isDE ? 'Gering' : 'Low stress'], ['#f1c40f', isDE ? 'Mittel' : 'Moderate'], ['#e74c3c', isDE ? 'Kritisch' : 'Critical']].map(([col, lbl]) => (
            <div key={lbl} style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
              <div style={{ width: 8, height: 8, borderRadius: 2, background: col }} />
              <span style={{ fontSize: 8, color: 'rgba(255,255,255,0.4)', fontWeight: 600 }}>{lbl}</span>
            </div>
          ))}
          <div style={{ marginLeft: 'auto', fontSize: 8, color: 'rgba(255,255,255,0.25)' }}>
            {isDE ? `${urbanTrees.length} Bäume analysiert` : `${urbanTrees.length} trees analysed`}
          </div>
        </div>
      </div>

      {/* ── Legend top-right ── */}
      <div style={{ position: 'absolute', top: 140, right: 28, display: 'flex', flexDirection: 'column', gap: '8px', background: 'rgba(0,0,0,0.6)', padding: '12px 14px', borderRadius: '14px', border: '1px solid rgba(255,255,255,0.08)', backdropFilter: 'blur(20px)' }}>
        {[
          ['#e74c3c', isDE ? 'Kritischer Stress' : 'Critical Stress'],
          ['rgba(255,255,255,0.3)', isDE ? 'Straßen' : 'Streets'],
          ['#00d2ff', isDE ? 'Planungspunkte' : 'Planner Pins'],
        ].map(([col, lbl]) => (
          <div key={lbl} style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <div style={{ width: 8, height: 8, borderRadius: '50%', background: col }} />
            <span style={{ fontSize: 9, fontWeight: 900, color: 'rgba(255,255,255,0.6)', letterSpacing: '0.4px', textTransform: 'uppercase' }}>{lbl}</span>
          </div>
        ))}
      </div>
      {/* ── Floating Tooltip ── */}
      {hoveredTree && (
        <div className="canvas-tooltip" style={{
          position: 'fixed', left: mousePos.x + 15, top: mousePos.y + 15,
          display: 'block', pointerEvents: 'none', zIndex: 9999,
          background: 'rgba(15, 18, 22, 0.95)', border: '1px solid rgba(255,255,255,0.1)',
          borderRadius: '16px', padding: '16px', backdropFilter: 'blur(12px)',
          boxShadow: '0 8px 32px rgba(0,0,0,0.5)', width: '220px'
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '12px' }}>
            <span style={{ color: 'var(--accent)', fontSize: '12px' }}>●</span>
            <span style={{ fontSize: '11px', fontWeight: 950, letterSpacing: '1px', color: '#fff' }}>
              {hoveredTree.genus.toUpperCase()} TREE
            </span>
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
            <div className="tooltip-row"><span className="tooltip-label">ID REF</span><span className="tooltip-val">#{hoveredTree.displayId}</span></div>
            <div className="tooltip-row"><span className="tooltip-label">{isDE ? 'GATTUNG' : 'GENUS'}</span><span className="tooltip-val">{hoveredTree.genus}</span></div>
            <div className="tooltip-row"><span className="tooltip-label">{isDE ? 'SPEZIES' : 'SPECIES'}</span><span className="tooltip-val" style={{ fontSize: '7px', opacity: 0.8, lineHeight: 1.2 }}>{hoveredTree.species}</span></div>
            <div className="tooltip-row"><span className="tooltip-label">{isDE ? 'MAX HÖHE' : 'MAX HEIGHT'}</span><span className="tooltip-val">{hoveredTree.height?.toFixed(1) || hoveredTree.properties?.BAUMHOEHE?.toFixed(1) || '0.0'}m</span></div>
            <div className="tooltip-row"><span className="tooltip-label">{isDE ? 'KRONE' : 'CANOPY'}</span><span className="tooltip-val">ø {hoveredTree.crown?.toFixed(1) || hoveredTree.properties?.KRONENDURCHMESSER?.toFixed(1) || '0.0'}m</span></div>
            
            <div style={{ marginTop: '14px', paddingTop: '10px', borderTop: '1px solid rgba(255,255,255,0.06)' }}>
              <div className="tooltip-row">
                <span className="tooltip-label" style={{ fontSize: '7px' }}>{isDE ? 'BIOLOGISCHER STRESS' : 'BOTANICAL STRESS'}</span>
                <span className="tooltip-val" style={{ color: hoveredTree.stressNow > 0.65 ? '#e74c3c' : hoveredTree.stressNow > 0.35 ? '#f1c40f' : '#2ecc71' }}>
                  {Math.round(hoveredTree.stressNow * 100)}%
                </span>
              </div>
              <div style={{ height: '4px', background: 'rgba(255,255,255,0.1)', borderRadius: '2px', marginTop: '6px', overflow: 'hidden' }}>
                <div style={{ 
                  height: '100%', width: `${hoveredTree.stressNow * 100}%`, 
                  background: hoveredTree.stressNow > 0.65 ? '#e74c3c' : hoveredTree.stressNow > 0.35 ? '#f1c40f' : '#2ecc71' 
                }} />
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
