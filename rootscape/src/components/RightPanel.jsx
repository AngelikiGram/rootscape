import React, { useRef, useEffect } from 'react';
import { useSimStore } from '../store/simulationStore.js';

// ── Interaction Event Log ────────────────────────────────────────
function EventLog() {
  const { events, language } = useSimStore();
  const logRef = useRef();

  useEffect(() => {
    if (logRef.current) logRef.current.scrollTop = logRef.current.scrollHeight;
  }, [events]);

  const displayEvents = events.slice(-50).filter(ev => ev.description);
  const isDE = language === 'de';

  return (
    <div className="event-log" ref={logRef}>
      {displayEvents.length === 0 ? (
        <div style={{ color: 'var(--text-dim)', fontSize: 10, padding: '4px 0' }}>{isDE ? 'Warten auf Aktivität...' : 'Waiting for activity…'}</div>
      ) : (
        displayEvents.map((ev, i) => (
          <div key={i} className={`event-entry ${ev.type === 'stress' || ev.type === 'drought' || ev.type === 'error' ? 'warn' : ''}`}>
            {ev.time != null && <span className="ev-time">t={ev.time}</span>}
            <span className="ev-msg" style={{ color: ev.type === 'error' ? '#ff6b6b' : 'inherit' }}>{ev.description}</span>
          </div>
        ))
      )}
    </div>
  );
}

// ── Right Panel ──────────────────────────────────────────────────
export default function RightPanel() {
  // Destructure ALL needed state at the top to avoid Hook violation on early return
  const {
    interactionMode, setInteractionMode,
    terrainSubTab, showRightPanel,
    location, fetchRadius, buildings, urbanTrees, loadingGIS,
    currentBrushType, viewMode, undergroundData,
    setLocation, setFetchRadius, fetchRealDTM,
    setCurrentBrushType, setViewMode,
    language,
  } = useSimStore();

  const isDE = language === 'de';

  if (!showRightPanel) return null;

  const setSubTab = (t) => useSimStore.setState({ terrainSubTab: t });

  const ugCount = (undergroundData.ubahn_lines?.features?.length || 0) + (undergroundData.sewer_heat?.features?.length || 0);

  return (
    <aside className="panel right-panel" style={{ overflowY: 'auto' }}>
      {/* 1. Tabbed Site/Brush Setup */}
      <div className="panel-tab-group" style={{ display: 'flex', borderBottom: '1px solid var(--panel-border)', marginBottom: 0 }}>
        {['World','Edit'].map(t => {
          const label = t === 'World' ? (isDE ? 'WELT' : 'WORLD') : (isDE ? 'EDITIEREN' : 'EDIT');
          return (
            <button 
              key={t}
              className={`tab-btn ${terrainSubTab === t ? 'active' : ''}`}
              style={{ 
                flex: 1, border: 'none', background: 'none', 
                borderBottom: terrainSubTab === t ? '2px solid var(--accent)' : '2px solid transparent', 
                padding: '14px 0', fontSize: 10, fontWeight: 700, color: terrainSubTab === t ? 'var(--text)' : 'var(--text-dim)',
                cursor: 'pointer', transition: 'all 0.2s', letterSpacing: '0.05em'
              }}
              onClick={() => setSubTab(t)}
            >
              {label}
            </button>
          );
        })}
      </div>

      <div style={{ padding: '0 4px' }}>
        {terrainSubTab === 'World' ? (
          <>
            <div className="panel-section">
              <div className="panel-header" style={{ marginBottom: 12, letterSpacing: '0.05em' }}>{isDE ? 'STANDORTWAHL' : 'SITE SELECTION'}</div>
              
              <div className="param-row">
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 80px', gap: 10, alignItems: 'end' }}>
                  <div>
                    <div className="param-label" style={{ fontSize: 9, marginBottom: 5, fontWeight: 700, color: 'var(--text-dim)' }}>LAT</div>
                    <input 
                      type="number" step="0.0001" className="interaction-select"
                      value={location.lat}
                      onChange={e => setLocation({ ...location, lat: parseFloat(e.target.value) })}
                    />
                  </div>
                  <div>
                    <div className="param-label" style={{ fontSize: 9, marginBottom: 5, fontWeight: 700, color: 'var(--text-dim)' }}>LON</div>
                    <input 
                      type="number" step="0.0001" className="interaction-select"
                      value={location.lon}
                      onChange={e => setLocation({ ...location, lon: parseFloat(e.target.value) })}
                    />
                  </div>
                  <div>
                    <div className="param-label" style={{ fontSize: 9, marginBottom: 5, fontWeight: 700, color: 'var(--text-dim)' }}>Radius</div>
                    <input
                      type="number" min="10" max="5000" step="10" className="interaction-select"
                      value={fetchRadius}
                      onChange={e => setFetchRadius(parseFloat(e.target.value))}
                    />
                  </div>
                </div>
              </div>


              <button
                disabled={loadingGIS}
                style={{
                  backgroundColor: loadingGIS ? '#34495e' : 'var(--accent)',
                  color: '#fff', border: 'none',
                  marginTop: 16, width: '100%', padding: '12px 0', fontWeight: 800, borderRadius: 10, fontSize: 11,
                  cursor: 'pointer', transition: 'all 0.2s', boxShadow: '0 4px 12px rgba(0,0,0,0.2)'
                }}
                onClick={() => fetchRealDTM()}
              >
                {loadingGIS ? (isDE ? 'LÄDT...' : 'FETCHING...') : (isDE ? 'STANDORT-GELÄNDE ABFRAGEN' : 'FETCH AREA TERRAIN')}
              </button>
            </div>
          </>
        ) : (
          /* Edit Tools */
          <div className="panel-section">
            <div className="panel-header" style={{ marginBottom: 16 }}>{isDE ? 'TERRAFORM-PINSEL' : 'TERRAFORM BRUSH'}</div>
            <div className="brush-selector" style={{ display: 'flex', gap: 4, marginBottom: 12 }}>
              {['height', 'moisture', 'nutrients'].map(b => (
                <button 
                  key={b}
                  className={`brush-btn ${currentBrushType === b ? 'active' : ''}`}
                  onClick={() => setCurrentBrushType(b)}
                  style={{ flex: 1, padding: '8px 0', fontSize: 9, borderRadius: 6 }}
                >
                  {{ height: isDE ? 'HÖHE' : 'HEIGHT', moisture: isDE ? 'FEUCHTE' : 'MOISTURE', nutrients: isDE ? 'NÄHRSTOFFE' : 'NUTRIENTS' }[b]}
                </button>
              ))}
            </div>

            <div style={{ padding: '4px', background: 'rgba(255,255,255,0.03)', borderRadius: 8, marginBottom: 20 }}>
               <button 
                 onClick={() => { useSimStore.getState().resetSim(); }}
                 style={{ width: '100%', padding: '8px', background: 'rgba(231, 76, 60, 0.15)', border: '1px solid rgba(231, 76, 60, 0.3)', color: '#e74c3c', borderRadius: 6, fontSize: 9, fontWeight: 800, cursor: 'pointer' }}
               >
                 {isDE ? 'ZURÜCK ZUR EBENE (RESET)' : 'RESET TO FLAT PLANE'}
               </button>
            </div>
            {/* Overlay View Modes */}
            <div className="panel-header" style={{ marginBottom: 12 }}>{isDE ? 'OVERLAY-VISUALISIERUNG' : 'OVERLAY VISUALS'}</div>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 4 }}>
              {['normal', 'moisture', 'nutrients'].map(m => (
                <button 
                  key={m}
                  className={`view-mode-btn ${viewMode === m ? 'active' : ''}`}
                  onClick={() => setViewMode(m)}
                  style={{ fontSize: 9, padding: '8px 2px', borderRadius: 6 }}
                >
                  {m === 'normal' ? 'ORTHO' : { moisture: isDE ? 'FEUCHTE' : 'MOISTURE', nutrients: isDE ? 'NÄHRSTOFFE' : 'NUTRIENTS' }[m]}
                </button>
              ))}
            </div>
          </div>
        )}
      </div>

      <div style={{ height: '8px' }} />

      {/* 2. Simulation Logic Settings */}
      <div className="panel-section">
        <div className="panel-header">{isDE ? 'WURZEL-INTERAKTIONS-LOGIK' : 'ROOT INTERACTION LOGIC'}</div>
        <select
          className="interaction-select"
          value={interactionMode}
          onChange={e => setInteractionMode(e.target.value)}
          style={{ width: '100%', padding: '8px', background: 'rgba(0,0,0,0.2)', border: '1px solid var(--panel-border)', color: '#fff', borderRadius: 8, outline: 'none' }}
        >
          <option value="competition">{isDE ? 'Nur Konkurrenz' : 'Competition only'}</option>
          <option value="facilitation">{isDE ? 'Konkurrenz + Unterstützung' : 'Competition + Facilitation'}</option>
          <option value="allelopathy">{isDE ? 'Allelopathie' : 'Allelopathy'}</option>
          <option value="mycorrhizal">{isDE ? 'Mykorrhiza (Pilznetzwerk)' : 'Mycorrhizal (Fungal)'}</option>
        </select>
        <div style={{ fontSize: 9, color: 'var(--text-dim)', marginTop: 10, lineHeight: 1.6 }}>
          • <b>{interactionMode.toUpperCase()}:</b> {isDE ? {
            competition: 'Wurzeln konkurrieren um Ressourcen. Überlappung verursacht Stress bei Nachbarn.',
            facilitation: 'Große Pfahlwurzeln versorgen kleinere Setzlinge durch hydraulischen Lift.',
            allelopathy: 'Bestimmte Bäume hemmen Nachbarn chemisch.',
            mycorrhizal: 'Pilznetzwerke ermöglichen Nährstoffaustausch und Signalübertragung.',
          }[interactionMode] : {
            competition: 'Roots compete for resources. Overlap causes neighbor stress.',
            facilitation: 'Large taproots supply hydraulic lift to smaller saplings.',
            allelopathy: 'Certain trees chemically inhibit neighbors.',
            mycorrhizal: 'Fungal network allows nutrient exchange and signaling.',
          }[interactionMode]}
        </div>
      </div>

      {/* 3. Event History */}
      <div className="panel-section" style={{ borderBottom: 'none' }}>
        <div className="panel-header">{isDE ? 'SIMULATIONS-EREIGNISPROTOKOLL' : 'SIMULATION EVENT LOG'}</div>
        <EventLog />
      </div>

      <style dangerouslySetInnerHTML={{ __html: `
        .right-panel { padding: 0 10px !important; }
        .panel-section { border-bottom: 1px solid rgba(255,255,255,0.05); padding: 20px 0; }
        .panel-header { font-size: 10px; font-weight: 800; color: #fff; opacity: 0.9; margin-bottom: 15px; letter-spacing: 0.1em; text-transform: uppercase; }
        .event-log { max-height: 180px; overflow-y: auto; background: transparent; padding: 0; }
        .ev-time { font-family: var(--font-mono); color: var(--accent); margin-right: 10px; font-weight: 700; font-size: 9px; }
        .ev-msg { color: #eee; font-size: 10px; font-weight: 500; }
        .interaction-select { width: 100%; border: 1px solid var(--panel-border); background: #0c0e12; color: #fff; padding: 10px; border-radius: 8px; font-size: 11px; }
      `}} />
    </aside>
  );
}
