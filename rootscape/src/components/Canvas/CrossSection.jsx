import React, { useMemo, useRef, useState, useEffect } from 'react';
import { toPng } from 'html-to-image';
import { useSimStore } from '../../store/simulationStore.js';
import { SPECIES } from '../../simulation/species.js';
import { ROOT_ARCHETYPE_COLORS } from '../../simulation/urbanRootSim.js';

const EARTH_RADIUS = 6378137;
function latLonToWebMerc(lat, lon) {
  const x = lon * (Math.PI / 180) * EARTH_RADIUS;
  const y = Math.log(Math.tan((90 + lat) * (Math.PI / 360))) * EARTH_RADIUS;
  return [x, y];
}

// SVG layout
const SVG_W = 1100, SVG_H = 560;
// Reserve right area for index map with padding
const PAD = { top: 64, right: 300, bottom: 52, left: 68 };
const PW = SVG_W - PAD.left - PAD.right;   // plot width
const PH = SVG_H - PAD.top  - PAD.bottom;  // plot height

function xSc(wx, fr, center = 0) {
  const rel = wx - center;
  return ((rel + fr) / (fr * 2)) * PW;
}
function ySc(wy, yMax, yMin) { return ((yMax - wy) / (yMax - yMin)) * PH; }

// Index map panel
const MAP_W = 260, MAP_H = 260;
const MAP_PAD = 15;

const UBAHN_DEPTHS  = { 1: -22, 2: -17, 3: -13, 4: -8, 6: -7 };
const UBAHN_COLORS  = { 1: '#e3000b', 2: '#a05a9a', 3: '#eb6a10', 4: '#23a944', 6: '#8c5e24' };

export default function CrossSection() {
  const {
    urbanTrees, acceptedPins, soilGrid, selectedTreeIds, selectTree,
    language, undergroundData, fetchRadius, terrainScale, buildings,
    buildingOrigin3857, transectAxis, rootSimYear, urbanRootSimResult,
    sectionZoom, setSectionZoom,
  } = useSimStore();
  
  const [zoom, setZoom] = useState(sectionZoom || 1);
  const containerRef = useRef(null);

  const handleExport = () => {
    if (!containerRef.current) return;
    toPng(containerRef.current, { backgroundColor: '#0a0e14', skipFonts: true })
      .then(url => {
        const a = document.createElement('a');
        a.download = `cross-section-${new Date().getTime()}.png`;
        a.href = url;
        a.click();
      }).catch(err => {
        console.error("[Export] CrossSection failed:", err);
      });
  };
  
  const [hoveredTree, setHoveredTree] = React.useState(null);
  const [mousePos, setMousePos] = React.useState({ x: 0, y: 0 });

  const isDE = language === 'de';

  const SPECIES_TRANSLATIONS = {
    'Acer': 'Maple', 'Ahorn': 'Maple', 'Tilia': 'Linden', 'Linde': 'Linden',
    'Quercus': 'Oak', 'Eiche': 'Oak', 'Fagus': 'Beech', 'Buche': 'Beech',
    'Fraxinus': 'Ash', 'Esche': 'Ash', 'Betula': 'Birch', 'Birke': 'Birch',
    'Pinus': 'Pine', 'Kiefer': 'Pine', 'Picea': 'Spruce', 'Fichte': 'Spruce',
    'Platanus': 'Plane', 'Platane': 'Plane', 'Aesculus': 'Chestnut', 'Kastanie': 'Chestnut',
    'Populus': 'Poplar', 'Pappel': 'Poplar', 'Robinia': 'Robinia', 'Akazie': 'Robinia',
    'Prunus': 'Cherry', 'Kirsche': 'Cherry', 'Carpinus': 'Hornbeam', 'Hainbuche': 'Hornbeam',
    'Ulmus': 'Elm', 'Ulme': 'Elm', 'Gleditsia': 'Honey Locust', 'Celtis': 'Hackberry'
  };

  const translate = (val) => {
    if (!val || isDE) return val;
    const base = val.split(' ')[0];
    return SPECIES_TRANSLATIONS[base] || val;
  };
  const rawFr = fetchRadius || 200;
  const fr    = rawFr / zoom; 
  const axis  = transectAxis || 'X';

  const selectedTrees = useMemo(() => {
    const all = [...(urbanTrees || []), ...(acceptedPins || [])];
    const ids = selectedTreeIds || [];
    const found = all.filter(t => ids.includes(t.id));
    return found.length > 0 ? found : (all[0] ? [all[0]] : []);
  }, [urbanTrees, acceptedPins, selectedTreeIds]);

  const primaryTree = selectedTrees[0];

  const refPos = useMemo(() => {
    if (!primaryTree || !buildingOrigin3857) return { x: 0, z: 0 };
    if (primaryTree.x !== undefined) return { x: primaryTree.x, z: primaryTree.z };
    const [lon, lat] = primaryTree.geometry.coordinates;
    const [wx, wy]   = latLonToWebMerc(lat, lon);
    const [ox, oy]   = buildingOrigin3857;
    return { x: wx - ox, z: -(wy - oy) };
  }, [primaryTree, buildingOrigin3857]);

  const getH  = (x, z) => (axis === 'X' ? x : z);
  const getF  = (x, z) => (axis === 'X' ? z : x);
  const centerH = getH(refPos.x, refPos.z);

  const terrainPts = useMemo(() => {
    if (!soilGrid) return [];
    const N = 120;
    const fixed   = getF(refPos.x, refPos.z);
    return Array.from({ length: N + 1 }, (_, i) => {
      const wH = (centerH - fr) + (i / N) * fr * 2;
      const h  = axis === 'X'
        ? soilGrid.getSurfaceHeight(wH, fixed) * terrainScale
        : soilGrid.getSurfaceHeight(fixed, wH) * terrainScale;
      return { wH, h };
    });
  }, [soilGrid, refPos, fr, terrainScale, axis]);

  const groundLevel = useMemo(() => {
    if (!terrainPts.length) return 0;
    return terrainPts.reduce((s, p) => s + p.h, 0) / terrainPts.length;
  }, [terrainPts]);

  const profileData = useMemo(() => {
    if (!buildingOrigin3857) return null;
    const [ox, oy] = buildingOrigin3857;
    const fixedRef = getF(refPos.x, refPos.z);

    const Y_MAX = groundLevel + 35 * terrainScale;
    const Y_MIN = groundLevel - 25 * terrainScale;

    const terrainPolyline = terrainPts.map(p =>
      `${xSc(p.wH, fr, centerH).toFixed(1)},${ySc(p.h, Y_MAX, Y_MIN).toFixed(1)}`).join(' ');

    const terrainFill = terrainPts.length > 0
      ? `M ${xSc(centerH - fr, fr, centerH)},${PH} ` +
        terrainPts.map(p => `L ${xSc(p.wH, fr, centerH).toFixed(1)},${ySc(p.h, Y_MAX, Y_MIN).toFixed(1)}`).join(' ') +
        ` L ${xSc(centerH + fr, fr, centerH)},${PH} Z`
      : '';

    const mappedTrees = [...(urbanTrees || []), ...(acceptedPins || [])].map(t => {
      let lx = 0, lz = 0;
      if (t.geometry) {
        const [lon, lat] = t.geometry.coordinates;
        const [wx, wy]   = latLonToWebMerc(lat, lon);
        lx = wx - ox; lz = -(wy - oy);
      } else { lx = t.x || 0; lz = t.z || 0; }

      const horizontalPos = getH(lx, lz);
      const fixed         = getF(lx, lz);
      const distToPlane   = Math.abs(fixed - fixedRef);
      const isSelected    = (selectedTreeIds || []).includes(t.id);
      
      const BUFFER = 12;
      if (distToPlane > BUFFER && !isSelected) return null;

      const gattungArt = t.properties?.GATTUNG_ART || t.properties?.GATTUNG_LAT || t.properties?.gattung_art || null;
      const genusRaw   = (t.properties?.GATTUNG || t.properties?.gattung || (gattungArt ? gattungArt.split(' ')[0] : 'Tree'));
      const displayGenus = genusRaw.charAt(0).toUpperCase() + genusRaw.slice(1).toLowerCase();
      const displaySpec  = t.properties?.ART_DEUTSCH || t.properties?.SPEZIES || gattungArt || 'Unknown';
      
      const genus      = genusRaw.toLowerCase();
      const specStyle   = SPECIES[genus] || SPECIES['acer'] || Object.values(SPECIES)[0];
      const h          = (t.properties?.BAUMHOEHE || t.height || 10) * terrainScale;
      const d          = (t.properties?.KRONENDURCHMESSER || t.crown || 6) * terrainScale;
      
      const horizontalPosVal = getH(lx, lz);
      const surfH = (t.surfaceY || (soilGrid ? soilGrid.getSurfaceHeight(lx, lz) : 0)) * terrainScale;
      const cleanId = t.properties?.BAUMNUMMER || (t.id || '').toString().split('.').pop();

      return {
        id: t.id, 
        tx: xSc(horizontalPosVal, fr, centerH),
        displayId: cleanId, 
        species: displaySpec, 
        genus: displayGenus,
        horiz: horizontalPosVal, 
        surfH, h, d,
        color: specStyle.color || '#2ecc71',
        isSelected, distToPlane,
        opacity: isSelected ? 1 : Math.max(0.1, 1 - distToPlane / BUFFER),
        stress: t.properties?.stress_score ?? 0.15,
      };
    }).filter(Boolean);

    const rootSegs = [];
    if (urbanRootSimResult) {
      (urbanRootSimResult.treeData || []).forEach(st => {
        const treeInList = urbanTrees.find(ut => ut.id === st.id) || acceptedPins.find(p => p.id === st.id);
        if (!treeInList) return;

        const horiz = getH(st.x, st.z);
        const fixed = getF(st.x, st.z);
        const isSelected = (selectedTreeIds || []).includes(st.id);
        
        if (!isSelected) return;
        if (Math.abs(horiz - centerH) > fr) return;

        const trSurfaceY = st.surfaceY ?? (soilGrid ? soilGrid.getSurfaceHeight(st.x, st.z) : 0);

        const getGrowthScale = (t) => {
          const age = Math.max(0, rootSimYear - (t.plantYear || 2000));
          const progress = age / 65;
          let pwr = 0.45;
          const gen = (t.genus || '').toLowerCase();
          if (gen === 'quercus' || gen === 'oak' || gen === 'fagus') pwr = 0.70; 
          if (gen === 'populus' || gen === 'betula' || gen === 'robinia') pwr = 0.32; 
          return 0.15 + 0.85 * Math.min(1.0, Math.pow(progress, pwr));
        };
        const gs = getGrowthScale(st);

        (st.segments || []).forEach(seg => {
          if (!seg || !seg.start || !seg.end) return;
          if (seg.year > rootSimYear) return;
          
          const localY1 = (seg.start[1] - trSurfaceY) * gs;
          const localY2 = (seg.end[1] - trSurfaceY) * gs;

          if (localY1 > 0.1) return; 
          
          const sy1 = localY1 + (trSurfaceY * terrainScale);
          const sy2 = localY2 + (trSurfaceY * terrainScale);

          const sx1 = (seg.start[0] - st.x) * gs + st.x;
          const sz1 = (seg.start[2] - st.z) * gs + st.z;
          const sx2 = (seg.end[0] - st.x) * gs + st.x;
          const sz2 = (seg.end[2] - st.z) * gs + st.z;

          const segFixed = getF(sx1, sz1);
          if (!isSelected && Math.abs(segFixed - fixedRef) > 4) return;

          const age = rootSimYear - seg.year;
          rootSegs.push({
            x1: xSc(getH(sx1, sz1), fr, centerH),
            y1: ySc(sy1, Y_MAX, Y_MIN),
            x2: xSc(getH(sx2, sz2), fr, centerH),
            y2: ySc(sy2, Y_MAX, Y_MIN),
            age,
            col: seg.col || 'heart',
            type: seg.type,
            competitive: seg.competitive
          });
        });
      });
    }

    return { terrainPolyline, terrainFill, mappedTrees, rootSegs, Y_MAX, Y_MIN };
  }, [urbanTrees, acceptedPins, buildingOrigin3857, refPos, axis, fr, terrainScale, soilGrid, selectedTreeIds, terrainPts, groundLevel, urbanRootSimResult, selectedTrees, rootSimYear, centerH]);

  const { terrainPolyline, terrainFill, mappedTrees, rootSegs, Y_MAX, Y_MIN } = profileData || {};
  const hasRoots = rootSegs?.length > 0;

  const { ubahnLines, pipeLines } = useMemo(() => {
    if (!buildingOrigin3857) return { ubahnLines: [], pipeLines: [] };
    
    const ubahnLines = [];
    const seenU = new Set();
    if (undergroundData?.ubahn_lines?.features) {
      undergroundData.ubahn_lines.features.forEach(f => {
        const lineId = f.properties?.LINFO;
        if (lineId && !seenU.has(lineId)) {
          seenU.add(lineId);
          const depthVal = UBAHN_DEPTHS[lineId] ?? -20;
          const depth = groundLevel + depthVal * terrainScale; 
          ubahnLines.push({ lineId, depth, color: UBAHN_COLORS[lineId] || '#888' });
        }
      });
    }

    const pipeDepths = new Set();
    if (undergroundData?.sewer_heat?.features) {
      pipeDepths.add(groundLevel + (-18.0 * 1.35));
    }
    if (undergroundData?.osm_underground?.elements) {
      pipeDepths.add(groundLevel + (-10.0 * 1.35));
      undergroundData.osm_underground.elements.forEach(el => {
        if (el.type === 'way' && el.tags?.layer) {
          const depth = groundLevel + (parseInt(el.tags.layer) * 5.0 * 1.35);
          if (depth < groundLevel - 0.5) pipeDepths.add(depth);
        }
      });
    }
    const pipeLines = Array.from(pipeDepths)
      .filter(d => d < groundLevel - 0.5 * terrainScale)
      .map(d => ({ depth: groundLevel + (d - groundLevel) * terrainScale, color: '#c08457' }));

    return { ubahnLines, pipeLines };
  }, [undergroundData, buildingOrigin3857, groundLevel, terrainScale]);

  const mapTrees = useMemo(() => {
    if (!buildingOrigin3857) return [];
    const [ox, oy] = buildingOrigin3857;
    return [...(urbanTrees || []), ...(acceptedPins || [])].map(t => {
      let lx = 0, lz = 0;
      if (t.geometry) {
        const [lon, lat] = t.geometry.coordinates;
        const [wx, wy]   = latLonToWebMerc(lat, lon);
        lx = wx - ox; lz = -(wy - oy);
      } else { lx = t.x || 0; lz = t.z || 0; }
      const px = ((lx / (rawFr) + 1) * 0.5) * (MAP_W - MAP_PAD * 2) + MAP_PAD;
      const pz = ((lz / (rawFr) + 1) * 0.5) * (MAP_H - MAP_PAD * 2) + MAP_PAD;
      if (px < 0 || px > MAP_W || pz < 0 || pz > MAP_H) return null;
      const isActive = (selectedTreeIds || []).includes(t.id);
      return { id: t.id, px, pz, isActive };
    }).filter(Boolean);
  }, [urbanTrees, acceptedPins, buildingOrigin3857, rawFr, selectedTreeIds]);

  const txLineOffset = axis === 'X'
    ? ((refPos.z / rawFr + 1) * 0.5) * (MAP_H - MAP_PAD * 2) + MAP_PAD
    : ((refPos.x / rawFr + 1) * 0.5) * (MAP_W - MAP_PAD * 2) + MAP_PAD;

  const elevTicks = [];
  if (Y_MAX !== undefined && Y_MIN !== undefined) {
    const step = 20 * terrainScale;
    for (let v = Math.ceil(Y_MIN / step) * step; v <= Y_MAX; v += step) {
      elevTicks.push(v);
    }
  }

  return (
    <div className="cross-section-container" ref={containerRef} style={{ width: '100%', height: '100%', background: '#0a0d14', position: 'relative', fontFamily: '"Outfit", sans-serif', overflow: 'hidden' }}>
      {/* ── Header ── */}
      <div style={{ position: 'absolute', top: 18, left: 24, zIndex: 10 }}>
        <div style={{ fontSize: 9, fontWeight: 950, color: 'var(--accent)', letterSpacing: '3px', textTransform: 'uppercase' }}>
          {isDE ? 'Vertikaler Querschnitt' : 'Vertical Cross-Section'} · {axis}-AXIS
        </div>
        <div style={{ fontSize: 22, fontWeight: 950, color: '#fff', letterSpacing: '-1px', marginTop: 2 }}>
          {selectedTreeIds.length > 0
            ? `${selectedTreeIds.length} ${isDE ? 'SONDEN AKTIV' : 'PROBES ACTIVE'}`
            : (primaryTree?.properties?.GATTUNG || 'SELECT A TREE').toUpperCase()}
        </div>
      </div>

      {/* ── Main SVG ── */}
      <svg viewBox={`0 0 ${SVG_W} ${SVG_H}`} style={{ width: '100%', height: '100%', overflow: 'visible' }}>
        <defs>
          <linearGradient id="soilGrad" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%"   stopColor="#3d2010" />
            <stop offset="60%"  stopColor="#1a0c06" />
            <stop offset="100%" stopColor="#050202" />
          </linearGradient>
          <linearGradient id="skyGrad" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%"   stopColor="#0a1220" />
            <stop offset="100%" stopColor="#080c12" />
          </linearGradient>
          <clipPath id="plotClip">
            <rect x={0} y={0} width={PW} height={PH} />
          </clipPath>
        </defs>

        <g transform={`translate(${PAD.left},${PAD.top})`}>
          <rect x={0} y={0} width={PW} height={PH} fill="url(#skyGrad)" clipPath="url(#plotClip)" />
          {terrainFill && <path d={terrainFill} fill="url(#soilGrad)" clipPath="url(#plotClip)" />}
          <line x1={0} x2={PW} y1={ySc(0, Y_MAX, Y_MIN)} y2={ySc(0, Y_MAX, Y_MIN)}
            stroke="rgba(255,255,255,0.08)" strokeWidth="1" strokeDasharray="6 4" clipPath="url(#plotClip)" />

          {rootSegs && rootSegs.map((s, i) => {
            const isConflict = s.type === 'competition' || s.competitive;
            const isGraft = s.type === 'graft';
            
            let rgbArr = ROOT_ARCHETYPE_COLORS[s.col] || ROOT_ARCHETYPE_COLORS.heart || [0.6, 0.4, 0.2];
            let r = Math.round(rgbArr[0]*255), g = Math.round(rgbArr[1]*255), b = Math.round(rgbArr[2]*255);
            
            const baseCol = isConflict ? '#ff6600' : isGraft ? '#ffc832' : `rgba(${r}, ${g}, ${b}, ${Math.max(0.5, 1 - s.age / 50)})`;
            const sWidth = (isConflict || isGraft) ? 2.5 : (s.age < 5 ? 1.5 : 0.8);
            
            return (
              <line key={i} x1={s.x1} y1={s.y1} x2={s.x2} y2={s.y2}
                stroke={baseCol} strokeWidth={sWidth} clipPath="url(#plotClip)" opacity="0.85" />
            );
          })}
          {ubahnLines && ubahnLines.map((u, i) => {
            const cy = ySc(u.depth, Y_MAX, Y_MIN);
            return (
              <g key={`ub-${i}`} clipPath="url(#plotClip)">
                <line x1={0} x2={PW} y1={cy} y2={cy} stroke={u.color} strokeWidth="6" opacity="0.12" />
                <line x1={0} x2={PW} y1={cy} y2={cy} stroke={u.color} strokeWidth="2.5" opacity="0.85" />
                <line x1={0} x2={PW} y1={cy} y2={cy} stroke="#fff" strokeWidth="0.5" opacity="0.6" strokeDasharray="12 12" />
                <rect x={24} y={cy - 9} width={34} height={18} fill="#141a24" stroke={u.color} strokeWidth="1.5" rx="4" />
                <text x={41} y={cy + 4} fill={u.color} fontSize="11" textAnchor="middle" fontWeight="950">U{u.lineId}</text>
              </g>
            );
          })}
          {pipeLines && pipeLines.map((p, i) => {
            const cy = ySc(p.depth, Y_MAX, Y_MIN);
            return (
              <g key={`pipe-${i}`} clipPath="url(#plotClip)">
                <line x1={0} x2={PW} y1={cy} y2={cy} stroke={p.color} strokeWidth="1.5" strokeDasharray="8 6" opacity="0.65" />
                <circle cx={41} cy={cy} r="3.5" fill="#141a24" stroke={p.color} strokeWidth="1.5" opacity="0.95" />
              </g>
            );
          })}
          {!hasRoots && (
            <text x={PW / 2} y={ySc(groundLevel - 15 * terrainScale, Y_MAX, Y_MIN)} fill="rgba(255,255,255,0.08)"
              fontSize="11" textAnchor="middle" fontWeight="700"> {isDE ? 'Wurzelsimulation nicht aktiv' : 'Root simulation not active'} </text>
          )}

          {mappedTrees && mappedTrees.map(t => {
            const tx  = xSc(t.horiz, fr, centerH);
            const tby = ySc(t.surfH, Y_MAX, Y_MIN);
            const tty = ySc(t.surfH + t.h, Y_MAX, Y_MIN);
            const crownRx = Math.max(3, (t.d / 2 / (fr * 2)) * PW);
            const crownRy = (t.h * 0.4 / (Y_MAX - Y_MIN)) * PH;
            return (
              <g 
                key={t.id} 
                opacity={t.opacity} 
                clipPath="url(#plotClip)" 
                onClick={(e) => { e.stopPropagation(); selectTree(t.id, e.ctrlKey || e.metaKey); }} 
                onMouseEnter={() => setHoveredTree(t)}
                onMouseLeave={() => setHoveredTree(null)}
                onMouseMove={(e) => setMousePos({ x: e.clientX, y: e.clientY })}
                style={{ cursor: 'pointer' }}
              >
                {t.isSelected && <ellipse cx={tx} cy={ySc(t.surfH + t.h * 0.75, Y_MAX, Y_MIN)} rx={crownRx + 6} ry={crownRy + 6} fill="var(--accent)" opacity="0.12" />}
                <line x1={tx} y1={tby} x2={tx} y2={tty} stroke={t.isSelected ? 'rgba(255,255,255,0.9)' : 'rgba(255,255,255,0.3)'} strokeWidth={t.isSelected ? 2 : 1} />
                <ellipse cx={tx} cy={ySc(t.surfH + t.h * 0.75, Y_MAX, Y_MIN)} rx={crownRx} ry={crownRy} fill={t.color} opacity={t.isSelected ? 0.75 : 0.4} stroke={t.color} strokeWidth={t.isSelected ? 1.5 : 0.5} />
                {t.isSelected && <circle cx={tx} cy={tby} r="4.5" fill="var(--accent)" />}
              </g>
            );
          })}
          {terrainPolyline && <polyline points={terrainPolyline} fill="none" stroke="#9a7450" strokeWidth="2.5" clipPath="url(#plotClip)" />}
          <g>
            {elevTicks && elevTicks.map(v => (
              <g key={v} transform={`translate(0, ${ySc(v, Y_MAX, Y_MIN)})`}>
                <line x1={-5} x2={0} y1={0} y2={0} stroke="rgba(255,255,255,0.2)" />
                <text x={-8} y={4} fill="rgba(255,255,255,0.3)" fontSize="7.5" textAnchor="end" fontWeight="700">
                  {Math.round((v - groundLevel) / terrainScale)}m
                </text>
                {v !== Y_MAX && <line x1={0} x2={PW} y1={0} y2={0} stroke="rgba(255,255,255,0.03)" strokeWidth="1" />}
              </g>
            ))}
            <text x={-40} y={PH / 2} fill="rgba(255,255,255,0.2)" fontSize="7.5" fontWeight="900" textAnchor="middle" letterSpacing="1px" transform={`rotate(-90, -40, ${PH / 2})`}> {isDE ? 'RELATIVE TIEFE (m)' : 'RELATIVE DEPTH (m)'} </text>
          </g>
          <g transform={`translate(0, ${PH})`}>
            {[-fr, -fr / 2, 0, fr / 2, fr].map(v => (
              <g key={v} transform={`translate(${xSc(centerH + v, fr, centerH)}, 0)`}>
                <line x1={0} x2={0} y1={0} y2={5} stroke="rgba(255,255,255,0.2)" />
                <text x={0} y={16} fill="rgba(255,255,255,0.3)" fontSize="7.5" textAnchor="middle" fontWeight="700">{v.toFixed(1)}m</text>
              </g>
            ))}
          </g>
          <rect x={0} y={0} width={PW} height={PH} fill="none" stroke="rgba(255,255,255,0.08)" />
        </g>

        <g transform={`translate(${PAD.left + PW + 20}, ${PAD.top})`}>
          <rect width={MAP_W} height={MAP_H} rx="12" fill="rgba(255,255,255,0.03)" stroke="rgba(255,255,255,0.1)" />
          <text x={MAP_W / 2} y={-12} fill="rgba(255,255,255,0.7)" fontSize="9" fontWeight="950" textAnchor="middle" letterSpacing="1.5px"> {isDE ? 'BAUMKARTE' : 'TREE INDEX MAP'} </text>
          {axis === 'X' ? <line x1={MAP_PAD} x2={MAP_W - MAP_PAD} y1={txLineOffset} y2={txLineOffset} stroke="var(--accent)" strokeWidth="1.5" strokeDasharray="5 3" opacity="0.6" />
                        : <line x1={txLineOffset} x2={txLineOffset} y1={MAP_PAD} y2={MAP_H - MAP_PAD} stroke="var(--accent)" strokeWidth="1.5" strokeDasharray="5 3" opacity="0.6" />}
          {mapTrees.map(t => (
            <circle key={t.id} cx={t.px} cy={t.pz} r={t.isActive ? 5 : 3} fill={t.isActive ? 'var(--accent)' : 'rgba(255,255,255,0.25)'} stroke={t.isActive ? 'rgba(255,255,255,0.8)' : 'none'} strokeWidth="1" style={{ cursor: 'pointer' }} onClick={e => selectTree(t.id, e.ctrlKey || e.metaKey)} />
          ))}
          <text x={MAP_W / 2} y={MAP_H - 6} fill="rgba(255,255,255,0.2)" fontSize="7" textAnchor="middle" fontWeight="700"> {isDE ? 'Klicken zum Auswählen' : 'Click to select · Ctrl+click multi'} </text>
        </g>

        <g transform={`translate(${PAD.left}, ${PAD.top + PH + 28})`}>
          {[ ['#3d2010', isDE ? 'Boden' : 'Soil'], ['rgba(180,100,40,0.8)', isDE ? 'Wurzeln' : 'Roots'], ['#ff6600', isDE ? 'Wurzelkampf' : 'Root Clash'], ['#2ecc71', isDE ? 'Krone' : 'Crown'], ['#c08457', isDE ? 'Rohr' : 'Pipe'], ['#e3000b', isDE ? 'U-Bahn' : 'Metro']
          ].map(([col, lbl], i) => (
            <g key={i} transform={`translate(${i * 85}, 0)`}>
              <rect width="10" height="7" fill={col} rx="2" />
              <text x="14" y="7" fill="rgba(255,255,255,0.35)" fontSize="8" fontWeight="600">{lbl}</text>
            </g>
          ))}
        </g>

        {/* Zoom footer */}
        <foreignObject x={SVG_W - 280} y={SVG_H - 52} width={260} height={40}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'flex-end', gap: 10, background: 'rgba(255,255,255,0.03)', padding: '6px 12px', borderRadius: '10px', border: '1px solid rgba(255,255,255,0.08)', backdropFilter: 'blur(10px)' }}>
            <span style={{ fontSize: 8, fontWeight: 900, color: 'rgba(255,255,255,0.4)', letterSpacing: '1px' }}>SPAN ZOOM</span>
            <input type="range" min={0.5} max={5} step={0.1} value={zoom} onChange={e => setZoom(parseFloat(e.target.value))} style={{ width: 100, accentColor: 'var(--accent)', cursor: 'pointer' }} />
            <span style={{ fontSize: 9, fontWeight: 900, color: 'var(--accent)', minWidth: 34 }}>{Math.round(zoom * 100)}%</span>
          </div>
        </foreignObject>

        {/* PNG Button moved out of SVG */}

      </svg>

      <div style={{ position: 'absolute', bottom: 24, right: 24, zIndex: 100 }}>
        <button 
          onClick={handleExport}
          style={{ 
            background: 'rgba(255,255,255,0.08)', border: '1px solid rgba(255,255,255,0.15)', 
            color: '#fff', padding: '6px 14px', borderRadius: '10px', fontSize: 8, fontWeight: 900, 
            cursor: 'pointer', letterSpacing: '1px', backdropFilter: 'blur(10px)'
          }}
        >
          EXPORT PNG
        </button>
      </div>

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
              {(hoveredTree.genus || 'Tree').toUpperCase()} TREE
            </span>
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
            <div className="tooltip-row"><span className="tooltip-label">ID REF</span><span className="tooltip-val">#{hoveredTree.displayId}</span></div>
            <div className="tooltip-row"><span className="tooltip-label">{isDE ? 'GATTUNG' : 'GENUS'}</span><span className="tooltip-val">{hoveredTree.genus}</span></div>
            <div className="tooltip-row"><span className="tooltip-label">{isDE ? 'SPEZIES' : 'SPECIES'}</span><span className="tooltip-val" style={{ fontSize: '7px', opacity: 0.8, lineHeight: 1.2 }}>{hoveredTree.species}</span></div>
            <div className="tooltip-row"><span className="tooltip-label">{isDE ? 'MAX HÖHE' : 'MAX HEIGHT'}</span><span className="tooltip-val">{(hoveredTree.h / terrainScale).toFixed(1)}m</span></div>
            <div className="tooltip-row"><span className="tooltip-label">{isDE ? 'KRONE' : 'CANOPY'}</span><span className="tooltip-val">ø {(hoveredTree.d / terrainScale).toFixed(1)}m</span></div>
            
            <div style={{ marginTop: '14px', paddingTop: '10px', borderTop: '1px solid rgba(255,255,255,0.06)' }}>
              <div className="tooltip-row">
                <span className="tooltip-label" style={{ fontSize: '7px' }}>{isDE ? 'BIOLOGISCHER STRESS' : 'BOTANICAL STRESS'}</span>
                <span className="tooltip-val" style={{ color: hoveredTree.stress > 0.65 ? '#e74c3c' : hoveredTree.stress > 0.35 ? '#f1c40f' : '#2ecc71' }}>
                  {Math.round(hoveredTree.stress * 100)}%
                </span>
              </div>
              <div style={{ height: '4px', background: 'rgba(255,255,255,0.1)', borderRadius: '2px', marginTop: '6px', overflow: 'hidden' }}>
                <div style={{ 
                  height: '100%', width: `${hoveredTree.stress * 100}%`, 
                  background: hoveredTree.stress > 0.65 ? '#e74c3c' : hoveredTree.stress > 0.35 ? '#f1c40f' : '#2ecc71' 
                }} />
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
