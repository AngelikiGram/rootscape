import React from 'react';
import { useSimStore } from '../store/simulationStore.js';

export default function LoadingScreen() {
  const { language } = useSimStore();
  const isDE = language === 'de';

  return (
    <div style={{
      position: 'absolute',
      top: 0,
      left: 0,
      width: '100%',
      height: '100%',
      background: 'rgba(10, 13, 18, 0.98)',
      display: 'flex',
      flexDirection: 'column',
      alignItems: 'center',
      justifyContent: 'center',
      zIndex: 1000,
      fontFamily: '"Outfit", sans-serif',
      backdropFilter: 'blur(10px)',
    }}>
      <div style={{ position: 'relative', width: '120px', height: '120px', display: 'flex', alignItems: 'center', justifyContent: 'center', marginBottom: '32px' }}>
        {/* Core pulse */}
        <div style={{
          width: '60px',
          height: '60px',
          background: 'var(--accent)',
          borderRadius: '50%',
          boxShadow: '0 0 40px var(--accent)',
          animation: 'pulseCore 2.5s infinite ease-in-out',
        }} />
        {/* Outer rings */}
        <div style={{
          position: 'absolute',
          width: '100%',
          height: '100%',
          border: '2px solid var(--accent)',
          borderRadius: '50%',
          opacity: 0.1,
          animation: 'pulseRing 4s infinite linear',
        }} />
        <div style={{
          position: 'absolute',
          width: '80%',
          height: '80%',
          border: '1px solid var(--accent)',
          borderRadius: '50%',
          opacity: 0.05,
          animation: 'pulseRing 3s infinite linear reverse',
        }} />
      </div>

      <div style={{
        fontSize: '11px',
        fontWeight: 900,
        color: 'var(--accent)',
        letterSpacing: '5px',
        textAlign: 'center',
        textTransform: 'uppercase',
        marginBottom: '8px',
        animation: 'textReveal 1.5s ease-out forwards'
      }}>
        {isDE ? 'ABFRAGE DER GIS-DATEN...' : 'FETCHING GIS DATA...'}
      </div>
      
      <div style={{
        fontSize: '8px',
        fontWeight: 600,
        color: 'rgba(255,255,255,0.3)',
        letterSpacing: '2px',
        textAlign: 'center',
        textTransform: 'uppercase',
        animation: 'textPulse 2s infinite'
      }}>
        {isDE ? 'SYNC DER URBANEN BIO-DYNAMIK-KNOTEN...' : 'SYNCING URBAN BIO-DYNAMICS NODES...'}
      </div>

      <style>{`
        @keyframes pulseCore {
          0%, 100% { transform: scale(0.9); opacity: 0.8; filter: blur(5px); }
          50% { transform: scale(1.1); opacity: 1; filter: blur(2px); }
        }
        @keyframes pulseRing {
          0% { transform: scale(0.5); opacity: 0.3; }
          100% { transform: scale(1.5); opacity: 0; }
        }
        @keyframes textReveal {
          from { opacity: 0; transform: translateY(10px); filter: blur(5px); }
          to { opacity: 1; transform: translateY(0); filter: blur(0); }
        }
        @keyframes textPulse {
          0%, 100% { opacity: 0.3; }
          50% { opacity: 0.6; }
        }
        :root {
          --accent: #58a6ff;
          --accent-green: #3fb950;
        }
      `}</style>
    </div>
  );
}
