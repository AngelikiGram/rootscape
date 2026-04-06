import React, { useCallback, useEffect } from 'react';
import { useSimStore } from '../store/simulationStore.js';

export default function Timeline() {
  const {
    rootSimYear, isPlaying, 
    rootSimStartYear, rootSimEndYear,
    play, pause,
    events, jumpToEvent,
  } = useSimStore();

  const currentYear = new Date().getFullYear();

  // Spacebar toggle
  useEffect(() => {
    const handler = (e) => {
      if (e.code === 'Space' && e.target.tagName !== 'INPUT') {
        e.preventDefault();
        isPlaying ? pause() : play();
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [isPlaying, pause, play]);

  const handleScrub = useCallback((e) => {
    const y = parseInt(e.target.value);
    useSimStore.setState({ rootSimYear: y });
  }, []);

  const markerEvents = events.filter(ev => ev.time != null && ev.type !== 'plant');
  const relativeYear = rootSimYear - currentYear;
  const tSign = relativeYear >= 0 ? '+' : '';

  // Calculate percentage for 'NOW' line
  const nowPercent = ((currentYear - rootSimStartYear) / (rootSimEndYear - rootSimStartYear)) * 100;

  return (
    <div className="timeline">
      <div className="tl-controls">
        <button className="tl-btn" onClick={() => useSimStore.setState({ rootSimYear: rootSimStartYear })} title="Rewind to start">⏮</button>
        <button
          className={`tl-btn ${isPlaying ? 'play-active' : ''}`}
          onClick={() => isPlaying ? pause() : play()}
        >
          {isPlaying ? '⏸' : '▶'}
        </button>
        <button className="tl-btn" onClick={() => useSimStore.setState({ rootSimYear: Math.min(rootSimEndYear, rootSimYear + 1) })} title="Step forward">⏭</button>
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', minWidth: '100px' }}>
        <span className="tl-time" style={{ color: relativeYear === 0 ? 'var(--accent-green)' : 'var(--accent)' }}>
          {rootSimYear}
        </span>
        <span style={{ fontSize: '9px', fontWeight: 800, color: 'var(--text-dim)', letterSpacing: '0.05em' }}>
          T={tSign}{relativeYear} {relativeYear === 0 ? '(NOW)' : ''}
        </span>
      </div>

      <div className="tl-track" style={{ position: 'relative' }}>
        {/* Start / End year labels */}
        <div style={{ position: 'absolute', top: '50%', left: 0, transform: 'translate(-28px, -50%)', fontSize: '8px', fontWeight: 900, color: 'var(--text-dim)', letterSpacing: '0.3px', pointerEvents: 'none', whiteSpace: 'nowrap' }}>{rootSimStartYear}</div>
        <div style={{ position: 'absolute', top: '50%', right: 0, transform: 'translate(28px, -50%)', fontSize: '8px', fontWeight: 900, color: 'var(--text-dim)', letterSpacing: '0.3px', pointerEvents: 'none', whiteSpace: 'nowrap' }}>{rootSimEndYear}</div>
        {nowPercent >= 0 && nowPercent <= 100 && (
          <div style={{ 
            position: 'absolute', left: `${nowPercent}%`, height: '100%', width: '1px', 
            background: 'rgba(63, 185, 80, 0.5)', zIndex: 0, pointerEvents: 'none' 
          }} />
        )}

        <input
          type="range"
          className="tl-scrubber"
          min={rootSimStartYear}
          max={rootSimEndYear}
          value={rootSimYear}
          onChange={handleScrub}
          style={{ position: 'relative', zIndex: 1 }}
        />

        <div className="tl-events" style={{ pointerEvents: 'none' }}>
          {markerEvents.map((ev, i) => {
            const pct = ((ev.time - rootSimStartYear) / (rootSimEndYear - rootSimStartYear)) * 100;
            if (pct < 0 || pct > 100) return null;
            return (
              <div
                key={i}
                className={`tl-event-marker ${ev.type}`}
                style={{ left: `${pct}%`, pointerEvents: 'all', cursor: 'pointer' }}
                title={ev.description}
                onClick={() => jumpToEvent(ev)}
              />
            );
          })}
        </div>
      </div>
      <div style={{ width: '40px' }} />
    </div>
  );
}
