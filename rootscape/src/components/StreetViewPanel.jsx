import React, { useState, useEffect } from 'react';
import { useSimStore } from '../store/simulationStore.js';

const C = {
  bg: 'rgba(14, 16, 19, 0.95)',
  border: 'rgba(255, 255, 255, 0.12)',
  text: 'rgba(255, 255, 255, 0.9)',
  muted: 'rgba(255, 255, 255, 0.5)',
  accent: '#00d2ff',
};

export default function StreetViewPanel() {
  const { selectedFeature, setSelectedFeature, language } = useSimStore();
  const [images, setImages] = useState([]);
  const [loading, setLoading] = useState(false);
  const isDE = language === 'de';

  useEffect(() => {
    if (!selectedFeature || !selectedFeature.lat || !selectedFeature.lon) {
      setImages([]);
      return;
    }

    setLoading(true);
    fetch(`/api/facades?lat=${selectedFeature.lat}&lon=${selectedFeature.lon}`)
      .then(r => r.json())
      .then(data => {
        if (data.data) {
          setImages(data.data.map(img => ({
            id: img.id,
            url: img.thumb_2048_url,
            angle: img.compass_angle
          })));
        } else {
          setImages([]);
        }
      })
      .catch(e => console.error("Mapillary fetch fail", e))
      .finally(() => setLoading(false));
  }, [selectedFeature]);

  if (!selectedFeature) return null;

  return (
    <div style={{
      position: 'absolute', top: 80, right: 16, width: 300,
      background: C.bg, borderRadius: 16, border: `1px solid ${C.border}`,
      boxShadow: '0 8px 32px rgba(0,0,0,0.6)', zIndex: 1000,
      padding: '16px', display: 'flex', flexDirection: 'column', gap: '12px',
      maxHeight: '70vh', overflowY: 'auto', backdropFilter: 'blur(10px)'
    }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <div>
          <div style={{ fontSize: '10px', color: C.accent, fontWeight: 800, letterSpacing: '1px', textTransform: 'uppercase' }}>
            {isDE ? 'STRASSENANSICHT' : 'STREET CONTEXT'}
          </div>
          <div style={{ fontSize: '12px', fontWeight: 700, color: '#fff' }}>
            {selectedFeature.type === 'building' ? (isDE ? 'Gebäude-Fassade' : 'Building Facade') : (isDE ? 'Baumbereich' : 'Tree Pit Context')}
          </div>
        </div>
        <button onClick={() => setSelectedFeature(null)} style={{ background: 'none', border: 'none', color: C.muted, cursor: 'pointer', fontSize: '18px' }}>✕</button>
      </div>

      {loading ? (
        <div style={{ height: 150, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '10px', color: C.muted }}>
          Scanning Mapillary Graph...
        </div>
      ) : images.length > 0 ? (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
          {images.map(img => (
            <div key={img.id} style={{ borderRadius: '8px', overflow: 'hidden', border: `1px solid ${C.border}`, position: 'relative' }}>
               <img src={img.url} alt="Street view" style={{ width: '100%', display: 'block' }} />
               <div style={{ position: 'absolute', bottom: 4, right: 8, fontSize: '8px', color: '#fff', background: 'rgba(0,0,0,0.4)', padding: '2px 4px', borderRadius: '4px' }}>
                 {Math.round(img.angle)}°
               </div>
            </div>
          ))}
          <div style={{ fontSize: '8px', color: C.muted, textAlign: 'center', marginTop: '4px' }}>
             Imagery via Mapillary Graph API v4
          </div>
        </div>
      ) : (
        <div style={{ height: 100, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '10px', color: C.muted, textAlign: 'center', padding: '0 20px' }}>
          {isDE ? 'Keine Strassenbilder in diesem Bereich gefunden.' : 'No street-level imagery found for this exact coordinate.'}
        </div>
      )}
    </div>
  );
}
