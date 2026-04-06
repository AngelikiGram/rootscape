import React, { useState } from 'react';
import { useSimStore } from '../store/simulationStore.js';

const SPEEDS = [0.25, 0.5, 1, 2, 4];

export default function Header() {
  const {
    activeView, setView, speed, setSpeed, language, setLanguage,
    location, setLocation, fetchRadius, setFetchRadius, fetchRealDTM, loadingGIS,
    showMapillarySequences, setShowMapillarySequences,
    rootSimStartYear, setRootSimStartYear, rootSimEndYear, setRootSimEndYear
  } = useSimStore();

  const [showHelp, setShowHelp] = useState(false);
  const isDE = language === 'de';

  const scenarios = [
    { id: 'competitive', en: 'Competitive Pair', de: 'Konkurrierendes Paar' },
    { id: 'forestStand', en: 'Forest Stand', de: 'Wald-Bestand' },
    { id: 'droughtStudy', en: 'Drought Study', de: 'Trockenheits-Studie' }
  ];

  const handleFetch = () => {
    fetchRealDTM();
  };

  return (
    <header className="header" style={{ height: '56px', padding: '0 12px', background: 'rgba(10,12,16,0.95)', backdropFilter: 'blur(20px)', borderBottom: '1px solid rgba(255,255,255,0.08)', display: 'flex', alignItems: 'center' }}>
      <div className="header-logo" style={{ display: 'flex', alignItems: 'center', gap: '8px', marginLeft: '4px', marginRight: '16px' }}>
        <div style={{ position: 'relative', width: '32px', height: '32px', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          <img src={`${import.meta.env.BASE_URL}logo.png`} alt="ROOTSCAPE" style={{ width: '100%', height: '100%', objectFit: 'contain' }} />
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', lineHeight: 1.0 }}>
          <div style={{ display: 'flex', alignItems: 'baseline', gap: '2px' }}>
            <span style={{ fontSize: '20px', fontWeight: 950, letterSpacing: '-1px', color: '#fff' }}>ROOTSCAPE</span>
          </div>
          <span style={{ fontSize: '6px', letterSpacing: '2px', color: 'rgba(255,255,255,0.4)', fontWeight: 800, textTransform: 'uppercase' }}>Urban Tree Analytics</span>
        </div>
      </div>

      {/* View Switcher */}
      <div className="view-pills" style={{ display: 'flex', gap: '3px', background: 'rgba(255,255,255,0.04)', padding: '4px', borderRadius: '10px', border: '1px solid rgba(255,255,255,0.05)' }}>
        {[
          ['3d', '3D MAPPING'], 
          ['section', isDE ? 'QUERSCHNITT' : 'CROSS-SECTION'], 
          ['overview', isDE ? 'ANALYSE' : 'ANALYTICS'],
          ['validation', isDE ? 'VALIDIERUNG' : 'VALIDATION']
        ].map(([v, label]) => (
          <button
            key={v}
            className={`pill-btn ${activeView === v ? 'active' : ''}`}
            onClick={() => setView(v)}
            style={{
              background: activeView === v ? 'var(--accent)' : 'transparent',
              border: 'none', color: activeView === v ? '#000' : 'rgba(255,255,255,0.4)',
              padding: '6px 12px', fontSize: '9px', fontWeight: 900, borderRadius: '7px', cursor: 'pointer',
              transition: 'all 0.2s', letterSpacing: '0.4px', whiteSpace: 'nowrap'
            }}
          >
            {label}
          </button>
        ))}
      </div>

      <div className="header-sep" style={{ margin: '0 12px' }} />

      {/* GIS Controls - Compact & Unified */}
      <div className="gis-group" style={{ display: 'flex', alignItems: 'center', background: 'rgba(255,255,255,0.03)', borderRadius: '14px', border: '1px solid rgba(255,255,255,0.08)', overflow: 'hidden' }}>
        <style>{`
          input::-webkit-outer-spin-button, input::-webkit-inner-spin-button { -webkit-appearance: none; margin: 0; }
          input[type=number] { -moz-appearance: textfield; }
        `}</style>
        <div style={{ display: 'flex', padding: '10px 10px', gap: '6px' }}>
          <div style={{ display: 'flex', flexDirection: 'column' }}>
            <label style={{ fontSize: '7px', color: 'rgba(255,255,255,0.4)', fontWeight: 900, marginBottom: '1px' }}>GIS COORDS</label>
            <div style={{ display: 'flex', gap: '4px', alignItems: 'center' }}>
              <span style={{ fontSize: '7px', color: 'rgba(255,255,255,0.2)', fontWeight: 900 }}>LAT</span>
              <input type="number" step="0.0001" value={location.lat} 
                onChange={e => setLocation({ ...location, lat: parseFloat(e.target.value) })}
                onKeyDown={e => e.key === 'Enter' && fetchRealDTM()}
                onBlur={() => fetchRealDTM()}
                style={{ width: '70px', background: 'transparent', border: 'none', color: '#fff', fontSize: '11px', fontWeight: 620, outline: 'none' }} />
              <span style={{ fontSize: '7px', color: 'rgba(255,255,255,0.2)', fontWeight: 900 }}>LON</span>
              <input type="number" step="0.0001" value={location.lon} 
                onChange={e => setLocation({ ...location, lon: parseFloat(e.target.value) })}
                onKeyDown={e => e.key === 'Enter' && fetchRealDTM()}
                onBlur={() => fetchRealDTM()}
                style={{ width: '70px', background: 'transparent', border: 'none', color: '#fff', fontSize: '11px', fontWeight: 620, outline: 'none' }} />
            </div>
          </div>
          <div style={{ width: '1px', background: 'rgba(255,255,255,0.1)', height: '20px', alignSelf: 'center', margin: '0 4px' }} />
          <div style={{ display: 'flex', flexDirection: 'column' }}>
            <label style={{ fontSize: '7px', color: 'rgba(255,255,255,0.4)', fontWeight: 900, marginBottom: '1px' }}>RADIUS</label>
            <div style={{ display: 'flex', alignItems: 'center' }}>
              <input type="number" value={fetchRadius} 
                onChange={e => setFetchRadius(parseInt(e.target.value))}
                onKeyDown={e => e.key === 'Enter' && fetchRealDTM()}
                onBlur={() => fetchRealDTM()}
                style={{ width: '50px', background: 'transparent', border: 'none', color: '#fff', fontSize: '11px', fontWeight: 620, outline: 'none' }} />
              <span style={{ fontSize: '9px', opacity: 0.3, marginLeft: '-4px' }}>m</span>
            </div>
          </div>
        </div>
         <button 
          onClick={fetchRealDTM} 
          disabled={loadingGIS}
          style={{ 
            background: loadingGIS ? 'rgba(88,166,255,0.1)' : 'var(--accent)', 
            color: loadingGIS ? 'rgba(88,166,255,0.5)' : '#000', 
            border: 'none', 
            padding: '0 18px', 
            fontSize: '10px', 
            alignSelf: 'stretch', 
            fontWeight: 900, 
            cursor: loadingGIS ? 'default' : 'pointer', 
            letterSpacing: '1px',
            transition: 'all 0.3s ease'
          }}
        >
          {loadingGIS ? (language === 'de' ? 'LÄDT...' : 'FETCHING...') : 'FETCH'}
        </button>
      </div>

      <div style={{ width: '1px', background: 'rgba(255,255,255,0.05)', height: '32px', margin: '0 6px' }} />

      {/* Temporal Span - Analysis Window */}
      <div className="time-group" style={{ display: 'flex', alignItems: 'center', background: 'rgba(255,255,255,0.03)', borderRadius: '14px', border: '1px solid rgba(255,255,255,0.08)', padding: '6px 12px', gap: '8px' }}>
        <div style={{ display: 'flex', flexDirection: 'column' }}>
          <label style={{ fontSize: '6px', color: 'rgba(255,255,255,0.3)', fontWeight: 900, marginBottom: '1px', textTransform: 'uppercase' }}>Time Window</label>
          <div style={{ display: 'flex', alignItems: 'center', gap: '2px' }}>
            <input type="number" value={rootSimStartYear} onChange={e => setRootSimStartYear(parseInt(e.target.value))}
              style={{ width: '48px', background: 'transparent', border: 'none', color: 'var(--accent)', fontSize: '10px', fontWeight: 900, outline: 'none' }} />
            <span style={{ color: 'rgba(255,255,255,0.2)', fontSize: '9px' }}>/</span>
            <input type="number" value={rootSimEndYear} onChange={e => setRootSimEndYear(parseInt(e.target.value))}
              style={{ width: '48px', background: 'transparent', border: 'none', color: 'var(--accent)', fontSize: '10px', fontWeight: 900, outline: 'none' }} />
          </div>
        </div>
      </div>

      <div style={{ flex: 1, minWidth: '10px' }} />

      {/* View-Specific Controls: Transect Axis */}
      {activeView === 'section' && (
        <div className="transect-toggle" style={{ display: 'flex', background: 'rgba(255,255,255,0.04)', borderRadius: '10px', padding: '3px', border: '1px solid rgba(255,255,255,0.08)', marginRight: '10px' }}>
          {['X', 'Z'].map(axis => (
            <button key={axis} onClick={() => useSimStore.setState({ transectAxis: axis })}
              style={{ background: useSimStore.getState().transectAxis === axis ? 'rgba(88,166,255,0.12)' : 'transparent', border: 'none', color: useSimStore.getState().transectAxis === axis ? 'var(--accent)' : 'rgba(255,255,255,0.25)', padding: '4px 8px', borderRadius: '7px', fontSize: '9px', fontWeight: 900, cursor: 'pointer' }}>
              {axis}
            </button>
          ))}
        </div>
      )}

      {/* Speed + Lang + Help */}
      <div style={{ display: 'flex', alignItems: 'center', gap: '5px', paddingRight: '4px' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '6px', background: 'rgba(255,255,255,0.03)', padding: '5px 8px', borderRadius: '12px', border: '1px solid rgba(255,255,255,0.05)' }}>
          <span style={{ fontSize: '8px', color: 'rgba(255,255,255,0.3)', fontWeight: 900 }}>SPD</span>
          <input type="range" min={0} max={SPEEDS.length - 1} value={SPEEDS.indexOf(speed)} onChange={e => setSpeed(SPEEDS[parseInt(e.target.value)])}
            style={{ width: '36px', accentColor: 'var(--accent)' }} />
          <span style={{ fontSize: '9px', fontWeight: 900, color: 'var(--accent)', minWidth: '14px' }}>{speed}x</span>
        </div>

        <div className="lang-pills" style={{ display: 'flex', background: 'rgba(255,255,255,0.04)', borderRadius: '10px', padding: '2px', border: '1px solid rgba(255,255,255,0.05)' }}>
          <button onClick={() => setLanguage('en')} style={{ background: language === 'en' ? 'rgba(255,255,255,0.1)' : 'transparent', border: 'none', color: language === 'en' ? '#fff' : 'rgba(255,255,255,0.3)', padding: '4px 6px', borderRadius: '7px', fontSize: '8px', fontWeight: 900, cursor: 'pointer' }}>EN</button>
          <button onClick={() => setLanguage('de')} style={{ background: language === 'de' ? 'rgba(255,255,255,0.1)' : 'transparent', border: 'none', color: language === 'de' ? '#fff' : 'rgba(255,255,255,0.3)', padding: '4px 6px', borderRadius: '7px', fontSize: '8px', fontWeight: 900, cursor: 'pointer' }}>DE</button>
        </div>

        <button onClick={() => setShowHelp(true)} style={{ width: '28px', height: '28px', borderRadius: '10px', background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.08)', color: 'var(--accent)', fontSize: '11px', fontWeight: 900, cursor: 'pointer' }}>?</button>
      </div>

      {/* ── Help Modal ── */}
      {showHelp && (
        <div style={{
          position: 'fixed', top: 0, left: 0, width: '100vw', height: '100vh',
          background: 'rgba(0,0,0,0.85)', backdropFilter: 'blur(12px)', zIndex: 10000,
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          padding: '40px'
        }} onClick={() => setShowHelp(false)}>
          <div style={{
            width: '800px', maxHeight: '85vh', background: '#0d1117', borderRadius: '24px',
            border: '1px solid rgba(255,255,255,0.12)', overflowY: 'auto',
            boxShadow: '0 32px 128px rgba(0,0,0,0.9)', animation: 'popIn 0.3s cubic-bezier(0.16, 1, 0.3, 1)',
            position: 'relative', display: 'flex', flexDirection: 'column'
          }} onClick={e => e.stopPropagation()}>
            {/* Modal Header */}
            <div style={{ padding: '32px 40px', background: 'linear-gradient(to bottom, rgba(88,166,255,0.05), transparent)', borderBottom: '1px solid rgba(255,255,255,0.05)' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '14px', marginBottom: '8px' }}>
                <span style={{ width: '12px', height: '12px', background: 'var(--accent)', borderRadius: '50%', boxShadow: '0 0 15px var(--accent)' }}></span>
                <h1 style={{ margin: 0, fontSize: '26px', fontWeight: 950, letterSpacing: '-0.8px' }}>ROOTSCAPE <span style={{ color: 'rgba(255,255,255,0.35)', fontSize: '15px', fontWeight: 400, marginLeft: '8px' }}>Advanced Project Manual</span></h1>
              </div>
              <p style={{ color: 'rgba(255,255,255,0.5)', fontSize: '14px', fontWeight: 500 }}>Integrated Spatio-Temporal Analytic Dashboard v2.4</p>
            </div>

            <div style={{ padding: '40px', display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '40px' }}>
              
              {/* Column 1: Core Navigation */}
              <div style={{ display: 'flex', flexDirection: 'column', gap: '32px' }}>
                <section>
                  <h3 style={{ fontSize: '11px', color: 'var(--accent)', letterSpacing: '1.5px', marginBottom: '14px', textTransform: 'uppercase', borderBottom: '1px solid rgba(88,166,255,0.2)', paddingBottom: '6px' }}>01. Primary Navigation</h3>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
                    <div>
                      <strong style={{ display: 'block', fontSize: '10px', color: '#fff', marginBottom: '2px' }}>3D MAPPING</strong>
                      <span style={{ fontSize: '11px', color: 'rgba(255,255,255,0.6)', lineHeight: 1.5 }}>High-fidelity district twin. Rotational camera with integrated L-System botanical growth models.</span>
                    </div>
                    <div>
                      <strong style={{ display: 'block', fontSize: '10px', color: '#fff', marginBottom: '2px' }}>CROSS-SECTION</strong>
                      <span style={{ fontSize: '11px', color: 'rgba(255,255,255,0.6)', lineHeight: 1.5 }}>Axial scan of subsurface topography. Displays roots, metro lines, and pipes at exact relative depths.</span>
                    </div>
                    <div>
                      <strong style={{ display: 'block', fontSize: '10px', color: '#fff', marginBottom: '2px' }}>ANALYTICS & VALIDATION</strong>
                      <span style={{ fontSize: '11px', color: 'rgba(255,255,255,0.6)', lineHeight: 1.5 }}>Comparative viability matrices and correlation reports between predictive stress and NDVI health.</span>
                    </div>
                  </div>
                </section>

                <section>
                  <h3 style={{ fontSize: '11px', color: 'var(--accent)', letterSpacing: '1.5px', marginBottom: '14px', textTransform: 'uppercase', borderBottom: '1px solid rgba(88,166,255,0.2)', paddingBottom: '6px' }}>02. Top Control Bar</h3>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
                    <div style={{ fontSize: '11px', color: 'rgba(255,255,255,0.7)' }}><strong>GIS COORDS:</strong> Vertical stack for Latitude/Longitude/Radius. Input values to define study area.</div>
                    <div style={{ fontSize: '11px', color: 'rgba(255,255,255,0.7)' }}><strong>[FETCH] Button:</strong> Executes the GIS pipeline to download terrain and Baumkataster data.</div>
                    <div style={{ fontSize: '11px', color: 'rgba(255,255,255,0.7)' }}><strong>TIME WINDOW:</strong> Start/End year inputs (e.g. 1960 / 2092) to define the longitudinal span.</div>
                    <div style={{ fontSize: '11px', color: 'rgba(255,255,255,0.7)' }}><strong>[SPD] Slider:</strong> Adjusts simulation playback speed from 0.25x to 4.0x.</div>
                    <div style={{ fontSize: '11px', color: 'rgba(255,255,255,0.7)' }}><strong>[EN / DE]:</strong> Real-time toggle for interface localization.</div>
                  </div>
                </section>
              </div>

              {/* Column 2: Specific Modality Controls */}
              <div style={{ display: 'flex', flexDirection: 'column', gap: '32px' }}>
                <section>
                  <h3 style={{ fontSize: '11px', color: 'var(--accent)', letterSpacing: '1.5px', marginBottom: '14px', textTransform: 'uppercase', borderBottom: '1px solid rgba(88,166,255,0.2)', paddingBottom: '6px' }}>03. Map Layers Menu</h3>
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr', gap: '8px' }}>
                    <div style={{ fontSize: '11px', color: 'rgba(255,255,255,0.7)' }}><strong>[■] BUILDINGS:</strong> Toggle architectural massing / [▦] Texture Overlay.</div>
                    <div style={{ fontSize: '11px', color: 'rgba(255,255,255,0.7)' }}><strong>[●] CITY CANOPY:</strong> Toggle the visibility of the official Vienna tree catalog.</div>
                    <div style={{ fontSize: '11px', color: 'rgba(255,255,255,0.7)' }}><strong>[≈] ANALYTICS:</strong> Bio-Stress (Red/Green), Green Density, and categorical Ground Masks.</div>
                    <div style={{ fontSize: '11px', color: 'rgba(255,255,255,0.7)' }}><strong>[🌱] VIABILITY:</strong> Enables Pin-Drop mode to compute suitability scores for any location.</div>
                    <div style={{ fontSize: '11px', color: 'rgba(255,255,255,0.7)' }}><strong>[T] METRONET / [○] SUB-SURFACE:</strong> High-visibility infrastructure line-work and utility pipes.</div>
                    <div style={{ fontSize: '11px', color: 'rgba(255,255,255,0.7)' }}><strong>[👁] X-RAY:</strong> Applies transparency to the top soil layer for conflict inspection.</div>
                  </div>
                </section>

                <section>
                  <h3 style={{ fontSize: '11px', color: 'var(--accent)', letterSpacing: '1.5px', marginBottom: '14px', textTransform: 'uppercase', borderBottom: '1px solid rgba(88,166,255,0.2)', paddingBottom: '6px' }}>04. Simulation Timeline</h3>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
                    <div style={{ fontSize: '11px', color: 'rgba(255,255,255,0.7)' }}><strong>Playback [⏮ ▶ ⏭]:</strong> Controls for Jump-to-Start, Play/Pause, and Step-Year-Forward.</div>
                    <div style={{ fontSize: '11px', color: 'rgba(255,255,255,0.7)' }}><strong>Year Display & Scrubber:</strong> Shows current T+ offset. Drag the slider to scrub through decades.</div>
                    <div style={{ fontSize: '11px', color: 'rgba(255,255,255,0.7)' }}><strong>[Space] Key:</strong> Global shortcut to toggle Play/Pause.</div>
                  </div>
                </section>
              </div>
            </div>

            {/* Modal Footer / Interaction Tips */}
            <div style={{ padding: '0 40px 40px', borderTop: '1px solid rgba(255,255,255,0.05)', paddingTop: '24px', textAlign: 'center' }}>
               <p style={{ fontSize: '10px', color: 'rgba(255,255,255,0.3)', marginBottom: '20px', letterSpacing: '0.5px' }}>
                 PRO TIP: Use <strong>Ctrl + Click</strong> in the 3D map to select multiple trees for comparative Cross-Section probes.
               </p>
               <button
                onClick={() => setShowHelp(false)}
                style={{ alignSelf: 'center', border: '1px solid var(--accent)', background: 'rgba(88,166,255,0.1)', color: 'var(--accent)', padding: '12px 64px', borderRadius: '12px', fontWeight: 950, fontSize: '12px', cursor: 'pointer', transition: 'all 0.2s' }}
                onMouseOver={e => e.target.style.background = 'var(--accent)'}
                onMouseOut={e => e.target.style.background = 'rgba(88,166,255,0.1)'}
              >
                DISMISS MANUAL
              </button>
            </div>
          </div>
        </div>
      )}
    </header>
  );
}
