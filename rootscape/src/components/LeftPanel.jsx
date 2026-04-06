import React from 'react';
import { useSimStore } from '../store/simulationStore.js';
import { SPECIES, SPECIES_ORDER } from '../simulation/species.js';

function StressBar({ stress }) {
  const sPct = Math.round(stress * 100);
  const color = stress < 0.35 ? '#3fb950' : stress < 0.65 ? '#d29922' : '#f85149';
  return (
    <div style={{ marginTop: 6 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 7, color: 'rgba(255,255,255,0.4)', marginBottom: 2, textTransform: 'uppercase', letterSpacing: '0.4px' }}>
         <span>STRESS</span>
         <span>{sPct}%</span>
      </div>
      <div style={{ height: 4, width: '100%', background: 'rgba(255,255,255,0.1)', borderRadius: 2, overflow: 'hidden' }}>
        <div style={{ height: '100%', width: `${sPct}%`, background: color, borderRadius: 2, transition: 'width 0.3s ease' }} />
      </div>
    </div>
  );
}

export default function LeftPanel() {
  const {
    trees, selectedTreeId,
    selectedSpecies, setSelectedSpecies, placingTree, setPlacingTree,
    selectTree, removeTree,
    loadPreset,
    language,
  } = useSimStore();

  const isDE = language === 'de';

  return (
    <aside className="panel left-panel">
      {/* ── Species Palette ─────────────────────────────────────── */}
      <div className="panel-section">
        <div className="panel-header">{isDE ? 'Arten' : 'Species'}</div>
        <div className="species-grid">
          {SPECIES_ORDER.map(key => {
            const sp = SPECIES[key];
            const name = isDE ? (sp.nameDE || sp.name) : (sp.nameEN || sp.name);
            return (
              <button
                key={key}
                className={`species-card ${selectedSpecies === key && placingTree ? 'active' : ''}`}
                onClick={() => setSelectedSpecies(key)}
                title={`${name} — ${sp.rootTypeLabel}`}
              >
                <span className="sp-emoji">{sp.emoji}</span>
                <span className="sp-name" style={{ fontSize: 9 }}>{name.toUpperCase()}</span>
                <span className="sp-root-type">{sp.rootTypeLabel}</span>
              </button>
            );
          })}
        </div>

        {/* Initial Age Control */}
        <div style={{ marginTop: 12, padding: '0 4px' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 4 }}>
             <span style={{ fontSize: 9, fontWeight: 600, color: 'var(--text-dim)' }}>{isDE ? 'STARTALTER' : 'INITIAL AGE'}</span>
             <span style={{ fontSize: 9, color: 'var(--accent)', fontFamily: 'var(--font-mono)' }}>t = {useSimStore.getState().initialAge}</span>
          </div>
          <input 
            type="range" 
            min="0" max="80" 
            value={useSimStore(s => s.initialAge)} 
            onChange={(e) => useSimStore.setState({ initialAge: parseInt(e.target.value) })}
            style={{ width: '100%', cursor: 'pointer' }}
          />
        </div>

        {placingTree && (
          <div
            className="placing-indicator"
            style={{ marginTop: 12 }}
            onClick={() => setPlacingTree(false)}
            title={isDE ? 'Platzierung abbrechen' : 'Cancel placement'}
          >
            <span>{isDE ? `Klicke zum Setzen von ${SPECIES[selectedSpecies].nameDE || selectedSpecies}` : `Click canvas to place ${SPECIES[selectedSpecies].nameEN || SPECIES[selectedSpecies].name}`}</span>
            <span>✕</span>
          </div>
        )}
      </div>

      {/* ── Tree List ─────────────────────────────────────────────── */}
      <div className="panel-section" style={{ flex: 1 }}>
        <div className="panel-header">{isDE ? 'Gepflanzte Bäume' : 'Planted Trees'} ({trees.length})</div>
        {trees.length === 0 ? (
          <div className="empty-list">{isDE ? 'Noch keine Bäume gesetzt' : 'No trees placed yet'}</div>
        ) : (
          <div className="tree-list">
            {trees.map((tree, i) => {
              const sp = SPECIES[tree.species];
              const name = isDE ? (sp.nameDE || sp.name) : (sp.nameEN || sp.name);
              return (
                <div
                  key={tree.id}
                  className={`tree-row ${selectedTreeId === tree.id ? 'selected' : ''}`}
                  onClick={() => selectTree(tree.id)}
                  style={{ height: 'auto', padding: '10px 8px' }}
                >
                  <span className="tr-emoji">{sp.emoji}</span>
                  <div className="tr-info">
                    <div className="tr-name">
                      {name} #{tree.id}
                    </div>
                    <div className="tr-pos">
                      ({tree.position[0].toFixed(1)}, {tree.position[1].toFixed(1)})
                    </div>
                    <StressBar stress={1 - tree.vigor} />
                  </div>
                  {tree.stress && <span className="tr-warn" title={isDE ? 'Stress erkannt' : 'Stress detected'} style={{ marginLeft: 6 }}>⚠</span>}
                  <button
                    className="tr-remove"
                    title={isDE ? 'Baum entfernen' : 'Remove tree'}
                    onClick={e => { e.stopPropagation(); removeTree(tree.id); }}
                  >
                    ✕
                  </button>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* ── Presets ──────────────────────────────────────────────── */}
      <div className="panel-section">
        <div className="panel-header">{isDE ? 'Szenarien' : 'Scenarios'}</div>
        <div className="preset-btns">
          <button className="preset-btn" onClick={() => loadPreset('competitive')}>
            {isDE ? 'Konkurrierendes Paar' : 'Competitive Pair'}
            <div style={{ fontSize: 9, color: 'var(--text-dim)', marginTop: 2 }}>{isDE ? 'Eiche + Kiefer, 3m Abstand' : 'Oak + Pine, 3m apart'}</div>
          </button>
          <button className="preset-btn" onClick={() => loadPreset('forestStand')}>
            {isDE ? 'Wald-Bestand' : 'Forest Stand'}
            <div style={{ fontSize: 9, color: 'var(--text-dim)', marginTop: 2 }}>{isDE ? '5 gemischte Arten' : '5 mixed species'}</div>
          </button>
          <button className="preset-btn" onClick={() => loadPreset('droughtStudy')}>
            {isDE ? 'Trockenheits-Studie' : 'Drought Study'}
            <div style={{ fontSize: 9, color: 'var(--text-dim)', marginTop: 2 }}>{isDE ? '2 Buchen, Trockenheit bei t=30' : '2 Beeches, drought at t=30'}</div>
          </button>
        </div>
      </div>
    </aside>
  );
}
