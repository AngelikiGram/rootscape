import React, { useRef, useEffect, useState } from 'react';
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { CSS2DRenderer, CSS2DObject } from 'three/addons/renderers/CSS2DRenderer.js';
import { useSimStore } from '../../store/simulationStore.js';
import { SPECIES } from '../../simulation/species.js';
import { makeCanopy } from '../../simulation/treeModels.js';
import { renderLSystem, simulateGroveGrowth } from '../../simulation/lsystem.js';
import { GRID_NX } from '../../simulation/soilGrid.js';
import { computeViability } from '../../utils/viabilityScore.js';
import { CONSTRAINT_LABELS } from '../../data/speciesNorms.js';
import { buildUrbanRootSimulation, filterSegsByYear, ROOT_ARCHETYPE_COLORS, DEEP_SOIL_COL, COMPETITION_COL, GRAFT_COL } from '../../simulation/urbanRootSim.js';
import * as d3 from 'd3';


const EARTH_RADIUS = 6378137;
function latLonToWebMerc(lat, lon) {
  const x = lon * (Math.PI / 180) * EARTH_RADIUS;
  const y = Math.log(Math.tan((90 + lat) * (Math.PI / 360))) * EARTH_RADIUS;
  return [x, y];
}

function webMercToLatLon(x, y) {
  const lon = (x / EARTH_RADIUS) * (180 / Math.PI);
  const lat = (Math.atan(Math.exp(y / EARTH_RADIUS)) * 360 / Math.PI) - 90;
  return { lat, lon };
}

/**
 * Creates high-performance root geometry from segments
 */
function createRootGeometry(segs, soilGrid, terrainScale) {
  const n = segs.length;
  const positions = new Float32Array(n * 6);
  const colors = new Float32Array(n * 6);
  const c1 = new THREE.Color(), c2 = new THREE.Color();
  const deepCol = new THREE.Color(...DEEP_SOIL_COL);

  for (let i = 0; i < n; i++) {
    const s = segs[i];
    const [x1, y1, z1] = s.start;
    const [x2, y2, z2] = s.end;
    const idx = i * 6;
    positions[idx] = x1; positions[idx + 1] = y1; positions[idx + 2] = z1;
    positions[idx + 3] = x2; positions[idx + 4] = y2; positions[idx + 5] = z2;

    const baseCol = new THREE.Color(...(ROOT_ARCHETYPE_COLORS[s.col] || ROOT_ARCHETYPE_COLORS.heart));
    if (s.type === 'competition') baseCol.setRGB(...COMPETITION_COL);
    if (s.type === 'graft') baseCol.setRGB(...GRAFT_COL);

    // Depth gradient relative to surface
    const sY1 = (soilGrid ? soilGrid.getSurfaceHeight(x1, z1) : 0) * terrainScale;
    const sY2 = (soilGrid ? soilGrid.getSurfaceHeight(x2, z2) : 0) * terrainScale;
    const d1 = Math.max(0, Math.min(1, (sY1 - y1) / 3.0));
    const d2 = Math.max(0, Math.min(1, (sY2 - y2) / 3.0));
    
    c1.copy(baseCol).lerp(deepCol, d1);
    c2.copy(baseCol).lerp(deepCol, d2);

    colors[idx] = c1.r; colors[idx + 1] = c1.g; colors[idx + 2] = c1.b;
    colors[idx + 3] = c2.r; colors[idx + 4] = c2.g; colors[idx + 5] = c2.b;
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  return geo;
}

function buildRootGeometry(segments, color, treePos, soilGrid, terrainScale) {
  if (!segments || segments.length === 0) {
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute([], 3));
    geo.setAttribute('color', new THREE.Float32BufferAttribute([], 3));
    return geo;
  }
  const [tx, tz] = treePos;
  const surfaceY = soilGrid ? soilGrid.getSurfaceHeight(tx, tz) : 0;
  const filtered = segments.filter(seg => seg && (seg.depth <= 1 || seg.competitive));
  const positions = new Float32Array(filtered.length * 6);
  const colors = new Float32Array(filtered.length * 6);
  const grayColor = new THREE.Color(0x333333);
  let k = 0;
  for (const seg of filtered) {
    if (!seg.start || !seg.end) continue;
    const idx = k * 6;
    positions[idx] = seg.start[0] - tx;
    positions[idx + 1] = (seg.start[1] - surfaceY) * terrainScale;
    positions[idx + 2] = seg.start[2] - tz;
    positions[idx + 3] = seg.end[0] - tx;
    positions[idx + 4] = (seg.end[1] - surfaceY) * terrainScale;
    positions[idx + 5] = seg.end[2] - tz;
    const rc = new THREE.Color();
    if (seg.competitive && seg.depth > 0) {
      rc.set(0xff6600);
    } else {
      const df = seg.depth === 0 ? 0.35 : 0.15;
      rc.copy(grayColor).multiplyScalar(df);
    }
    colors[idx] = rc.r; colors[idx + 1] = rc.g; colors[idx + 2] = rc.b;
    colors[idx + 3] = rc.r; colors[idx + 4] = rc.g; colors[idx + 5] = rc.b;
    k++;
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(positions.slice(0, k * 6), 3));
  geo.setAttribute('color', new THREE.Float32BufferAttribute(colors.slice(0, k * 6), 3));
  return geo;
}

export default function MainCanvas() {
  const containerRef = useRef();
  const sceneRef = useRef(null);
  const treeGroupsRef = useRef(new Map());
  const clockRef = useRef(new THREE.Clock());
  const [isLegendOpen, setIsLegendOpen] = useState(false);
  const urbanRootSimRef = useRef(null);   // cached Rhizomorph simulation result
  const [rootSimVersion, setRootSimVersion] = useState(0); // bumped when sim re-runs

  const {
    isPlaying,
    showMapillarySequences, mapillarySequences, setShowMapillarySequences, fetchMapillarySequences,
    time, trees, competitionZones, graftZones,
    placingTree, selectedSpecies, soilGrid, location, viewMode, terrainScale, terrainFetchedAt, terrainMorphedAt,
    fetchRadius, terrainOrtho, buildings, pavements, urbanTrees, showUrbanTrees, buildingOrigin3857, buildingModelUrl, buildingOrigin, showBuildings, showTexturedBuildings, showRoads, showPavements, showGroundMask, showWaterBodies, undergroundData, showUnderground, showUbahn, showPipes, showXRay, showStressViz, showGreenViz,
    showUrbanRoots, rootSimYear, setRootSimYear, showDSMOverlay,
    terrainSubTab, soilType,
    candidatePlantMode,
    addTree, selectTree, setPlacingTree, setCandidateLocation, setCandidatePlantMode,
    language,
    acceptedPins,
    showComparisonModal,
    loadingGIS,
    sectionX, sectionY, sectionZ, sectionXActive, sectionYActive, sectionZActive,
  } = useSimStore();

  const heatmapLookup = useRef({
    stress: null,
    greenery: null,
    groundPixels: null,
    radius: 450
  });

  // Global Sectioning Logic
  const clipPlanes = React.useMemo(() => {
    const base = [
      new THREE.Plane(new THREE.Vector3(1, 0, 0), fetchRadius),
      new THREE.Plane(new THREE.Vector3(-1, 0, 0), fetchRadius),
      new THREE.Plane(new THREE.Vector3(0, 0, 1), fetchRadius),
      new THREE.Plane(new THREE.Vector3(0, 0, -1), fetchRadius),
    ];
    if (sectionXActive) base.push(new THREE.Plane(new THREE.Vector3(-1, 0, 0), sectionX));
    if (sectionYActive) base.push(new THREE.Plane(new THREE.Vector3(0, -1, 0), sectionY));
    if (sectionZActive) base.push(new THREE.Plane(new THREE.Vector3(0, 0, -1), sectionZ));
    return base;
  }, [fetchRadius, sectionX, sectionY, sectionZ, sectionXActive, sectionYActive, sectionZActive]);


  // -- Underground Layer ----------------------------------------------
  useEffect(() => {
    const sc = sceneRef.current;
    if (!sc) return;
    const { scene } = sc;
    const old = scene.getObjectByName('underground_layer');
    if (old) scene.remove(old);
    if (!undergroundData || Object.keys(undergroundData).length === 0 || !buildingOrigin3857) return;

    const group = new THREE.Group();
    group.name = 'underground_layer';
    scene.add(group);

    const UBAHN_COLORS = { 1: 0xe3000b, 2: 0xa05a9a, 3: 0xeb6a10, 4: 0x23a944, 6: 0x8c5e24 };
    const PIPE_COLOR = 0x7a4f2e;
    const DEPTHS = { ubahn_lines: -28.0, sewer_heat: -18.0, osm_underground: -10.0 };
    const SUBSURFACE_EXAGGERATION = 1.35;

    const VIENNA_STATION_DEPTHS = {
      "Stephansplatz": { 1: -27.3, 3: -12.0 },
      "Karlsplatz":    { 1: -24.5, 4: -7.2, 2: -15.0 },
      "Schwedenplatz": { 1: -14.0, 4: -6.5 },
      "Landstraße":    { 3: -15.5, 4: -7.0 },
      "Westbahnhof":   { 3: -22.0, 6: -6.0 },
      "Volkstheater":  { 2: -17.0, 3: -10.5 },
      "Landstraße (U4) Wien Mitte": { 4: -7.0, 3: -15.5 }
    };

    const [ox, oy] = buildingOrigin3857;
    const uLogoTex = new THREE.TextureLoader().load('/vienna_ubahn_logo.png');
    const STATION_LOOKUP = {};
    if (undergroundData.ubahn_stats?.features) {
      undergroundData.ubahn_stats.features.forEach(f => {
        const line = f.properties?.LINFO;
        const sName = f.properties?.HTXT;
        if (!line || !sName) return;
        const [wx, wy] = f.geometry.coordinates;
        const depth = VIENNA_STATION_DEPTHS[sName]?.[line] ?? DEPTHS.ubahn_lines;
        if (!STATION_LOOKUP[line]) STATION_LOOKUP[line] = [];
        STATION_LOOKUP[line].push({ x: wx, y: wy, depth });
      });
    }

    const addTube = (ptsRaw, radius, color, customOrder = 60, userData = {}) => {
      const pts = ptsRaw?.filter(p => p && Number.isFinite(p.x) && Number.isFinite(p.y) && Number.isFinite(p.z));
      if (!pts || pts.length < 2) return;
      const curve = new THREE.CatmullRomCurve3(pts);
      const samples = Math.min(pts.length * 4, 128);
      const geo = new THREE.TubeGeometry(curve, samples, radius, 12, false);
      const mat = new THREE.MeshStandardMaterial({
        color, transparent: true, opacity: 0.85,
        metalness: 0.7, roughness: 0.3,
        depthTest: true, depthWrite: true, side: THREE.DoubleSide,
        clippingPlanes: clipPlanes,
      });
      const mesh = new THREE.Mesh(geo, mat);
      mesh.name = 'ug_tube';
      mesh.renderOrder = customOrder;
      mesh.userData = { ...userData };
      group.add(mesh);
    };

    Object.entries(undergroundData).forEach(([key, coll]) => {
      const depth = DEPTHS[key] ?? -5.0;
      if (key.includes('ubahn') && !showUbahn) return;
      if (!key.includes('ubahn') && !showPipes) return;
      if (!coll || (!coll.features && !coll.elements)) return;

      if (key === 'osm_underground' && coll?.elements) {
        const nodes = {};
        coll.elements.forEach(el => { if (el.type === 'node') nodes[el.id] = [el.lon, el.lat]; });
        coll.elements.forEach(el => {
          if (el.type !== 'way' || !el.nodes) return;
          const pipeType = el.tags?.tunnel || el.tags?.service || el.tags?.name || 'Underground Pipe';
          const pts = el.nodes.map(nid => nodes[nid]).filter(Boolean).map(([lon, lat]) => {
            const [wx, wy] = latLonToWebMerc(lat, lon);
            const lx = wx - ox, lz = -(wy - oy);
            const groundY = soilGrid ? soilGrid.getSurfaceHeight(lx, lz) : 0;
            const finalDepth = (el.tags?.layer ? parseInt(el.tags.layer) * 5.0 : depth) * SUBSURFACE_EXAGGERATION;
            return new THREE.Vector3(lx, groundY * terrainScale + finalDepth, lz);
          });
          const avgDepth = Math.abs(depth) * SUBSURFACE_EXAGGERATION;
          addTube(pts, 0.45, PIPE_COLOR, 60, { isPipe: true, pipeType, depthM: avgDepth.toFixed(1) });
        });
      } else if (key === 'ubahn_stats' && coll.features) {
        coll.features.forEach(f => {
          if (!f.geometry || f.geometry.type !== 'Point') return;
          const [wx, wy] = f.geometry.coordinates;
          const lx = wx - ox, lz = -(wy - oy);
          if (Math.abs(lx) > fetchRadius || Math.abs(lz) > fetchRadius) return;
          const groundY = soilGrid ? soilGrid.getSurfaceHeight(lx, lz) : 0;
          const sName = f.properties?.HTXT, sLine = f.properties?.LINFO;
          let sDepth = VIENNA_STATION_DEPTHS[sName]?.[sLine] ?? depth;
          const hubGeo = new THREE.CylinderGeometry(8, 8, 1.5, 32);
          const blueMat = new THREE.MeshStandardMaterial({ color: 0x00458a });
          const logoMat = new THREE.MeshStandardMaterial({ map: uLogoTex, transparent: true });
          const hubMesh = new THREE.Mesh(hubGeo, [blueMat, logoMat, blueMat]);
          hubMesh.position.set(lx, groundY * terrainScale + 6, lz);
          hubMesh.renderOrder = 70;
          hubMesh.userData = { sName, sLine, isStation: true };
          group.add(hubMesh);
          const platMesh = new THREE.Mesh(new THREE.SphereGeometry(3.5, 16, 12), new THREE.MeshPhongMaterial({ 
            color: UBAHN_COLORS[sLine] || 0xffeb3b, emissive: UBAHN_COLORS[sLine] || 0xffeb3b, emissiveIntensity: 0.3,
            clippingPlanes: clipPlanes
          }));
          platMesh.position.set(lx, groundY * terrainScale + sDepth * SUBSURFACE_EXAGGERATION, lz);
          platMesh.renderOrder = 65;
          platMesh.userData = { sName, sLine, isStation: true, depthM: Math.abs(sDepth).toFixed(1) };
          group.add(platMesh);
        });
      } else if (coll.features) {
        coll.features.forEach(f => {
          if (!f.geometry) return;
          const { type, coordinates } = f.geometry;
          const lineNum = f.properties?.LINFO;
          const color = key === 'ubahn_lines' ? (UBAHN_COLORS[lineNum] ?? 0xffffff) : PIPE_COLOR;
          let radius = key === 'ubahn_lines' ? 2.45 : 0.95;
          const pipeType = key === 'sewer_heat' ? 'District Heating' : key === 'ubahn_lines' ? null : 'Utility Pipe';
          const toVec = ([wx_lon, wy_lat]) => {
            let lx, lz;
            if (Math.abs(wx_lon) < 180) {
              const [mx, my] = latLonToWebMerc(wy_lat, wx_lon);
              lx = mx - ox; lz = -(my - oy);
            } else {
              lx = wx_lon - ox; lz = -(wy_lat - oy);
            }
            let tunnelDepth = depth;
            const sList = STATION_LOOKUP[lineNum];
            if (sList?.length >= 1) {
              let totalW = 0, weightedD = 0;
              sList.forEach(s => {
                const dist = Math.sqrt((wx_lon - s.x)**2 + (wy_lat - s.y)**2);
                if (dist < 800) { const w = 1.0 / (dist + 1); totalW += w; weightedD += s.depth * w; }
              });
              if (totalW > 0) tunnelDepth = weightedD / totalW;
            }
            const groundY = soilGrid ? soilGrid.getSurfaceHeight(lx, lz) : 0;
            return new THREE.Vector3(lx, groundY * terrainScale + tunnelDepth * SUBSURFACE_EXAGGERATION, lz);
          };
          const uData = key === 'ubahn_lines'
            ? { isUbahn: true, lineNum, depthM: Math.abs(depth * SUBSURFACE_EXAGGERATION).toFixed(1) }
            : { isPipe: true, pipeType, depthM: Math.abs(depth * SUBSURFACE_EXAGGERATION).toFixed(1) };
          if (type === 'LineString') addTube(coordinates.map(toVec), radius, color, 60, uData);
          else if (type === 'MultiLineString') coordinates.forEach(ls => addTube(ls.map(toVec), radius, color, 60, uData));
        });
      }
    });
  }, [undergroundData, showUbahn, showPipes, buildingOrigin3857, fetchRadius, terrainScale, soilGrid, clipPlanes]);

  // -- Infrastructure Lines (Roads & Pavements) ----------------------
  useEffect(() => {
    const sc = sceneRef.current;
    if (!sc) return;
    const { scene } = sc;
    const old = scene.getObjectByName('infra_layer');
    if (old) { old.traverse(o => { if (o.geometry) o.geometry.dispose(); if (o.material) o.material.dispose(); }); scene.remove(old); }
    if ((!showRoads && !showPavements) || !pavements || !buildingOrigin3857 || !soilGrid) return;
    const group = new THREE.Group();
    group.name = 'infra_layer';
    const [ox, oy] = buildingOrigin3857;
    const PEDESTRIAN_TYPES = ['footway', 'pedestrian', 'path', 'cycleway'];
    pavements.forEach(p => {
      const isPed = PEDESTRIAN_TYPES.includes(p.type);
      if (isPed && !showPavements) return;
      if (!isPed && !showRoads) return;
      let currentPath = [];
      const finishPath = () => {
        if (currentPath.length >= 2) {
          const geo = new THREE.BufferGeometry().setFromPoints(currentPath);
          const mat = new THREE.LineBasicMaterial({ 
            color: isPed ? 0xf8f9fa : 0x5c5c5c, linewidth: 3.5, 
            transparent: true, opacity: 0.95, depthTest: true,
            clippingPlanes: clipPlanes
          });
          const line = new THREE.Line(geo, mat);
          line.renderOrder = 80;
          group.add(line);
        }
        currentPath = [];
      };
      for (let i = 0; i < p.nodes.length; i++) {
        const [bx, by] = p.nodes[i];
        const lx = bx - ox, lz = -(by - oy);
        if (Math.abs(lx) > fetchRadius - 0.1 || Math.abs(lz) > fetchRadius - 0.1) { finishPath(); continue; }

        if (currentPath.length > 0) {
          const prev = currentPath[currentPath.length - 1];
          const dist = Math.sqrt((lx - prev.x) ** 2 + (lz - prev.z) ** 2);
          const steps = Math.ceil(dist / 0.5); 
          if (steps > 1) {
            for (let s = 1; s < steps; s++) {
              const t = s / steps;
              const ix = prev.x + (lx - prev.x) * t;
              const iz = prev.z + (lz - prev.z) * t;
              const igy = (soilGrid ? soilGrid.getSurfaceHeight(ix, iz) : 0) * terrainScale;
              currentPath.push(new THREE.Vector3(ix, igy + 1.25, iz));
            }
          }
        }
        const gy = (soilGrid ? soilGrid.getSurfaceHeight(lx, lz) : 0) * terrainScale;
        currentPath.push(new THREE.Vector3(lx, gy + 1.25, lz));
      }
      finishPath();
    });
    scene.add(group);
  }, [pavements, showRoads, showPavements, buildingOrigin3857, soilGrid, terrainScale, fetchRadius]);

  // -- X-Ray rendering for underground ------------------------------â”€
  useEffect(() => {
    const sc = sceneRef.current;
    if (!sc) return;
    const { scene } = sc;
    const ug = scene.getObjectByName('underground_layer');
    if (ug) {
      ug.traverse(o => {
        if (o.isMesh && o.name === 'ug_tube') {
          o.material.depthTest = !showXRay;
          o.material.depthWrite = true;
          o.material.transparent = true;
          o.material.opacity = showXRay ? 1.0 : 0.85;
          o.material.needsUpdate = true;
          o.renderOrder = 60;
        }
      });
    }
    const infra = scene.getObjectByName('infra_layer');
    if (infra) {
      infra.traverse(o => {
        if (o.isLine) { o.material.depthTest = !showXRay; o.material.needsUpdate = true; }
      });
    }
  }, [showXRay]);

  // -- Urban Trees Layer --------------------------------------------â”€
  useEffect(() => {
    const sc = sceneRef.current;
    if (!sc) return;
    const { scene } = sc;
    const old = scene.getObjectByName('urban_trees_layer');
    if (old) scene.remove(old);
    const group = new THREE.Group();
    group.name = 'urban_trees_layer';
    scene.add(group);
    if (!buildingOrigin3857) return;
    if ((!urbanTrees || urbanTrees.length === 0) && !showStressViz && !showGreenViz) return;
    const [ox, oy] = buildingOrigin3857;
    // Genus → crown colour + shape parameters (for poster-quality species differentiation)
    const GENUS_STYLE = {
      tilia:      { r: 0.22, g: 0.62, b: 0.22, sy: 1.00, sxz: 1.00 },
      platanus:   { r: 0.14, g: 0.48, b: 0.16, sy: 1.00, sxz: 1.15 },
      quercus:    { r: 0.20, g: 0.50, b: 0.12, sy: 0.95, sxz: 1.10 },
      fraxinus:   { r: 0.22, g: 0.62, b: 0.25, sy: 1.15, sxz: 0.85 },
      acer:       { r: 0.26, g: 0.65, b: 0.28, sy: 1.00, sxz: 1.00 },
      prunus:     { r: 0.40, g: 0.73, b: 0.42, sy: 0.95, sxz: 0.95 },
      betula:     { r: 0.51, g: 0.78, b: 0.52, sy: 1.25, sxz: 0.75 },
      pinus:      { r: 0.11, g: 0.40, b: 0.15, sy: 1.18, sxz: 0.70 },
      picea:      { r: 0.07, g: 0.35, b: 0.12, sy: 1.20, sxz: 0.65 },
      populus:    { r: 0.25, g: 0.60, b: 0.20, sy: 1.25, sxz: 0.80 },
      robinia:    { r: 0.35, g: 0.68, b: 0.30, sy: 1.05, sxz: 0.90 },
    };
    const DEFAULT_STYLE = { r: 0.18, g: 0.55, b: 0.20, sy: 1.00, sxz: 1.00 };

    const trunkMat = new THREE.MeshPhongMaterial({ color: 0x6d4c41, shininess: 4, clippingPlanes: clipPlanes });
    const crownMat = new THREE.MeshPhongMaterial({
      color: 0xffffff, transparent: true, opacity: 0.88, shininess: 12, clippingPlanes: clipPlanes,
    });

    if (showUrbanTrees && urbanTrees.length > 0) {
      const n = Math.min(urbanTrees.length, 30000);
      const simulatedTreeMap = new Map((urbanRootSimRef.current?.treeData || []).map(t => [t.id, t]));
      // Higher-poly geometry for poster quality
      const trunkIM = new THREE.InstancedMesh(new THREE.CylinderGeometry(0.10, 0.22, 1, 8), trunkMat, n);
      const crownIM = new THREE.InstancedMesh(new THREE.SphereGeometry(0.5, 10, 7), crownMat, n);
      const barGeo = new THREE.BoxGeometry(1, 1, 1); // dummy box, will scale
      const barMat = new THREE.MeshBasicMaterial({ vertexColors: true, depthTest: true });
      const barIM = new THREE.InstancedMesh(barGeo, barMat, n);

      trunkIM.name = 'urban_trunks';
      crownIM.name = 'urban_crowns';
      // Per-instance crown colours
      const crownColors = new Float32Array(n * 3);
      const dummy = new THREE.Object3D();
      const instanceMap = [];

      let count = 0;

      for (const tree of urbanTrees) {
        if (count >= n) break;
        if (!tree.geometry?.coordinates) continue;
        const [lon, lat] = tree.geometry.coordinates;
        const [wx, wy] = latLonToWebMerc(lat, lon);
        const lx = wx - ox, lz = -(wy - oy);
        if (Math.abs(lx) > fetchRadius || Math.abs(lz) > fetchRadius) continue;
        const surfaceY = (soilGrid ? soilGrid.getSurfaceHeight(lx, lz) : 0) * terrainScale;
        // Dimension logic: use simulated dimensions if available, else match sim's default logic
        const treeId = tree.id || `u_${tree.properties.BAUMNUMMER || count}`;
        const simTree = simulatedTreeMap.get(treeId);
        
        let h = tree.properties.BAUMHOEHE;
        let d = tree.properties.KRONENDURCHMESSER;

        if (simTree) {
          h = simTree.height;
          d = simTree.d;
        } else {
          // Simulation defaults: d=8 if missing, h=d*1.45 if missing.
          if (!d) d = 8;
          if (!h) h = d * 1.45;
          // Apply LiDAR height if possible (duplicate sim logic for consistency)
          if (soilGrid?.dsmMap) {
            const rVox = Math.ceil((d/2) * soilGrid.resolution + 1);
            let maxDH = 0;
            for (let xi = -rVox; xi <= rVox; xi++) {
              for (let zi = -rVox; zi <= rVox; zi++) {
                if ((xi*xi + zi*zi) > rVox*rVox*1.2) continue;
                const dh = (soilGrid.getDSMHeight?.(lx + xi/soilGrid.resolution, lz + zi/soilGrid.resolution) ?? 0)
                         - (soilGrid.getSurfaceHeight?.(lx + xi/soilGrid.resolution, lz + zi/soilGrid.resolution) ?? 0);
                if (dh > maxDH) maxDH = dh;
              }
            }
            if (maxDH > 3.0) h = maxDH * 1.02;
          }
          // Note: we avoid adding new random jitter here to stay stable unless it's simulated
        }

        const trunkH = h * 0.32;

        // If simulating this ID, hide the low-poly proxy (scale down) to avoid Z-fighting
        const isSimulated = showUrbanRoots && !!simTree;
        const proxyScale = isSimulated ? 0.001 : 1.0;

        // -- Trunk --
        dummy.position.set(lx, surfaceY + (trunkH / 2) * proxyScale, lz);
        dummy.scale.set(proxyScale, trunkH * proxyScale, proxyScale);
        dummy.updateMatrix();
        trunkIM.setMatrixAt(count, dummy.matrix);

        // -- Crown - genus-specific shape --
        const gattungArt = tree.properties.GATTUNG_ART || tree.properties.GATTUNG_LAT || tree.properties.gattung_art || null;
        const genusText  = tree.properties.GATTUNG || tree.properties.gattung || (gattungArt ? gattungArt.split(' ')[0] : 'Tree');
        const st = GENUS_STYLE[genusText.toLowerCase()] || DEFAULT_STYLE;
        
        dummy.position.set(lx, surfaceY + (trunkH + (h * 0.68 * 0.42)) * proxyScale, lz);
        dummy.scale.set(d * st.sxz * proxyScale, h * 0.68 * st.sy * proxyScale, d * st.sxz * proxyScale);
        dummy.updateMatrix();
        crownIM.setMatrixAt(count, dummy.matrix);
        crownColors[count * 3]     = st.r;
        crownColors[count * 3 + 1] = st.g;
        crownColors[count * 3 + 2] = st.b;

        const baumNr      = tree.properties.BAUMNUMMER || tree.properties.ID || tree.properties.id || (count + 1);
        const crownVal    = tree.properties.KRONENDURCHMESSER || tree.properties.crown || d;
        const heightVal   = tree.properties.BAUMHOEHE || tree.properties.height || (h / terrainScale);
        const displayGenus = genusText.charAt(0).toUpperCase() + genusText.slice(1).toLowerCase();
        const displaySpec  = tree.properties.ART_DEUTSCH || tree.properties.SPEZIES || gattungArt || tree.properties.ART_LAT || 'Unknown';

        const rawId = (tree.id || '').toString();
        const numericId = rawId.split('.').pop();
        const finalBaumNr = tree.properties.BAUMNUMMER || numericId || (count + 1);

        instanceMap.push({
          species: displayGenus,
          details: displaySpec,
          standort: tree.properties.STANDORT || tree.properties.ADRESSE || null,
          baumNr: finalBaumNr,
          katasterId: tree.properties.katasterId || tree.id || null,
          stress: (tree.properties.stress_score !== undefined) ? tree.properties.stress_score : 0.15,
          height: heightVal,
          crown: crownVal,
          age: tree.properties.STANDALTER || (tree.properties.PFLANZJAHR ? (new Date().getFullYear() - tree.properties.PFLANZJAHR) : null),
          trunkCirc: tree.properties.STAMMUMFANG || null,
          lx: lx, 
          lz: lz
        });
        count++;
      }

      // Apply per-instance crown colours via Three.js native API
      const _col = new THREE.Color();
      for (let ci = 0; ci < count; ci++) {
        _col.setRGB(crownColors[ci * 3], crownColors[ci * 3 + 1], crownColors[ci * 3 + 2]);
        crownIM.setColorAt(ci, _col);
      }
      if (crownIM.instanceColor) crownIM.instanceColor.needsUpdate = true;

      group.userData.instanceMap = instanceMap;
      trunkIM.count = count;
      crownIM.count = count;
      group.add(trunkIM);
      group.add(crownIM);

    }

    // -- Stress heatmap -------------------------------------------------------------
    if (showStressViz) {
      const HM = 512;
      const accumStress = new Float32Array(HM * HM);
      const accumWeight = new Float32Array(HM * HM);
      const rasterCanvas = document.createElement('canvas');
      rasterCanvas.width = HM; rasterCanvas.height = HM;
      const rctx = rasterCanvas.getContext('2d');
      rctx.fillStyle = 'black';
      rctx.fillRect(0, 0, HM, HM);
      const sealingPolys = undergroundData?.soil_sealing?.features;
      if (sealingPolys) {
        for (const f of sealingPolys) {
          if (!f.geometry || f.geometry.type !== 'Polygon') continue;
          const pct = Math.round((f.properties?.VERSIEGELUNG_PROZENT || 50) * 2.55);
          rctx.fillStyle = `rgb(${pct}, ${pct}, ${pct})`;
          for (const ring of f.geometry.coordinates) {
            rctx.beginPath(); let first = true;
            for (const [bx, by] of ring) {
              const lx = bx - ox, lz = -(by - oy);
              const px = ((lx / fetchRadius + 1) * 0.5) * HM, py = ((lz / fetchRadius + 1) * 0.5) * HM;
              if (first) { rctx.moveTo(px, py); first = false; } else rctx.lineTo(px, py);
            }
            rctx.closePath(); rctx.fill();
          }
        }
      }
      rctx.fillStyle = 'rgb(255, 255, 255)';
      for (const b of buildings) {
        if (!b.geometry?.coordinates) continue;
        for (const ring of b.geometry.coordinates) {
          rctx.beginPath(); let first = true;
          for (const [bx, by] of ring) {
            const lx = bx - ox, lz = -(by - oy);
            const px = ((lx / fetchRadius + 1) * 0.5) * HM, py = ((lz / fetchRadius + 1) * 0.5) * HM;
            if (first) { rctx.moveTo(px, py); first = false; } else rctx.lineTo(px, py);
          }
          rctx.closePath(); rctx.fill();
        }
      }
      rctx.strokeStyle = 'rgb(255, 255, 255)';
      if (pavements) {
        for (const p of pavements) {
          if (!p.nodes || p.nodes.length < 2) continue;
          rctx.beginPath();
          rctx.lineWidth = Math.max(4.5, (15 / (fetchRadius * 2)) * HM);
          let first = true;
          for (const [bx, by] of p.nodes) {
            const lx = bx - ox, lz = -(by - oy);
            const px = ((lx / fetchRadius + 1) * 0.5) * HM, py = ((lz / fetchRadius + 1) * 0.5) * HM;
            if (first) { rctx.moveTo(px, py); first = false; } else rctx.lineTo(px, py);
          }
          rctx.stroke();
        }
      }
      const rData = rctx.getImageData(0, 0, HM, HM).data;
      for (let i = 0; i < HM * HM; i++) {
        const val = rData[i * 4] / 255;
        if (val > 0.05) { accumStress[i] = val; accumWeight[i] = 1.0; }
      }
      const R = 8; const sigma2 = (R * 0.5) ** 2;
      for (const tree of urbanTrees) {
        if (!tree.geometry?.coordinates) continue;
        const [lon, lat] = tree.geometry.coordinates;
        const [wx, wy] = latLonToWebMerc(lat, lon);
        const lx = wx - ox, lz = -(wy - oy);
        if (Math.abs(lx) > fetchRadius || Math.abs(lz) > fetchRadius) continue;
        const gx = Math.round((lx / fetchRadius + 1) * 0.5 * (HM - 1));
        const gz = Math.round((lz / fetchRadius + 1) * 0.5 * (HM - 1));
        const s = tree.properties.stress_score ?? 0.5;
        for (let dz = -R; dz <= R; dz++) {
          for (let dx = -R; dx <= R; dx++) {
            const nx = gx + dx, nz = gz + dz;
            if (nx < 0 || nx >= HM || nz < 0 || nz >= HM) continue;
            const d2 = dx * dx + dz * dz;
            if (d2 > R * R) continue;
            const w = Math.exp(-d2 / sigma2);
            accumStress[nz * HM + nx] += s * w;
            accumWeight[nz * HM + nx] += w;
          }
        }
      }
      const hmCanvas = document.createElement('canvas');
      hmCanvas.width = HM; hmCanvas.height = HM;
      const ctx = hmCanvas.getContext('2d');
      const img = ctx.createImageData(HM, HM);
      for (let i = 0; i < HM * HM; i++) {
        const w = accumWeight[i];
        if (w < 0.01) { img.data[i * 4 + 3] = 0; continue; }
        const s = Math.min(1, accumStress[i] / w);
        if (s < 0.30) { img.data[i * 4 + 3] = 0; continue; }
        const t = (s - 0.30) / 0.70;
        let r, g, b;
        if (t < 0.35) { const u = t / 0.35; r = Math.round(232 + u * 8); g = Math.round(160 - u * 160); b = 0; }
        else if (t < 0.65) { const u = (t - 0.35) / 0.30; r = Math.round(240 - u * 48); g = 0; b = 0; }
        else { const u = (t - 0.65) / 0.35; r = Math.round(192 - u * 92); g = 0; b = 0; }
        img.data[i * 4] = r; img.data[i * 4 + 1] = g; img.data[i * 4 + 2] = b; img.data[i * 4 + 3] = 220;
      }
      ctx.putImageData(img, 0, 0);
      heatmapLookup.current.stress = accumStress;
      heatmapLookup.current.radius = fetchRadius;
      const compCanvas = document.createElement('canvas');
      compCanvas.width = HM; compCanvas.height = HM;
      const cctx = compCanvas.getContext('2d');
      cctx.filter = 'blur(10px)'; cctx.drawImage(hmCanvas, 0, 0);
      cctx.filter = 'none'; cctx.drawImage(hmCanvas, 0, 0);
      const hmGeo = new THREE.PlaneGeometry(fetchRadius * 2, fetchRadius * 2, HM - 1, HM - 1);
      hmGeo.rotateX(-Math.PI / 2);
      const pos = hmGeo.attributes.position;
      for (let i = 0; i < pos.count; i++) {
        const eps = 0.5;
        const sx = Math.max(-fetchRadius + eps, Math.min(fetchRadius - eps, pos.getX(i)));
        const sz = Math.max(-fetchRadius + eps, Math.min(fetchRadius - eps, pos.getZ(i)));
        pos.setY(i, (soilGrid ? soilGrid.getSurfaceHeight(sx, sz) : 0) * terrainScale + 0.25);
      }
      pos.needsUpdate = true; hmGeo.computeVertexNormals();
      const hmMesh = new THREE.Mesh(hmGeo, new THREE.MeshBasicMaterial({ 
        map: new THREE.CanvasTexture(compCanvas), transparent: true, 
        depthTest: false, depthWrite: false, clippingPlanes: clipPlanes 
      }));
      hmMesh.name = 'stress_heatmap'; hmMesh.renderOrder = 24;
      group.add(hmMesh);
    }

    // -- Canopy heatmap ----------------------------------------------â”€
    if (showGreenViz) {
      const HM = 256;
      const accumCrown = new Float32Array(HM * HM);
      const cellSize = (fetchRadius * 2) / HM;
      for (const tree of (urbanTrees || [])) {
        if (!tree.geometry?.coordinates) continue;
        const [lon, lat] = tree.geometry.coordinates;
        const [wx, wy] = latLonToWebMerc(lat, lon);
        const lx = wx - ox, lz = -(wy - oy);
        if (Math.abs(lx) > fetchRadius || Math.abs(lz) > fetchRadius) continue;
        const gx = Math.round((lx / fetchRadius + 1) * 0.5 * (HM - 1));
        const gz = Math.round((lz / fetchRadius + 1) * 0.5 * (HM - 1));
        const crownR = Math.max(1, (tree.properties.KRONENDURCHMESSER || 4) / 2);
        const R = Math.max(3, Math.round(crownR / cellSize * 1.5));
        const sigma2 = (R * 0.5) ** 2;
        const weight = Math.min(2.5, (crownR * crownR) / 25);
        for (let dz = -R; dz <= R; dz++) {
          for (let dx = -R; dx <= R; dx++) {
            const nx = gx + dx, nz = gz + dz;
            if (nx < 0 || nx >= HM || nz < 0 || nz >= HM) continue;
            if (dx * dx + dz * dz > R * R) continue;
            accumCrown[nz * HM + nx] += weight * Math.exp(-(dx * dx + dz * dz) / sigma2);
          }
        }
      }
      const sorted = Float32Array.from(accumCrown).sort();
      const p95 = sorted[Math.floor(sorted.length * 0.95)] || 1;
      const gmCanvas = document.createElement('canvas');
      gmCanvas.width = HM; gmCanvas.height = HM;
      const gctx = gmCanvas.getContext('2d');
      const gimg = gctx.createImageData(HM, HM);
      for (let i = 0; i < HM * HM; i++) {
        const v = Math.min(1, accumCrown[i] / p95);
        let r, g, b;
        if (v < 0.05) { r = 205; g = 185; b = 130; }
        else if (v < 0.4) { const t = (v - 0.05) / 0.35; r = Math.round(205 - t * 155); g = Math.round(185 + t * 45); b = Math.round(130 - t * 90); }
        else { const t = (v - 0.4) / 0.6; r = Math.round(50 - t * 30); g = Math.round(230 - t * 110); b = Math.round(40 - t * 30); }
        const a = v < 0.05 ? 0 : 150;
        gimg.data[i * 4] = r; gimg.data[i * 4 + 1] = g; gimg.data[i * 4 + 2] = b; gimg.data[i * 4 + 3] = a;
      }
      gctx.putImageData(gimg, 0, 0);
      heatmapLookup.current.greenery = accumCrown;
      const gmGeo = new THREE.PlaneGeometry(fetchRadius * 2, fetchRadius * 2, HM - 1, HM - 1);
      gmGeo.rotateX(-Math.PI / 2);
      const gpos = gmGeo.attributes.position;
      for (let i = 0; i < gpos.count; i++) {
        const eps = 0.5;
        const sx = Math.max(-fetchRadius + eps, Math.min(fetchRadius - eps, gpos.getX(i)));
        const sz = Math.max(-fetchRadius + eps, Math.min(fetchRadius - eps, gpos.getZ(i)));
        gpos.setY(i, (soilGrid ? soilGrid.getSurfaceHeight(sx, sz) : 0) * terrainScale + 0.22);
      }
      gpos.needsUpdate = true; gmGeo.computeVertexNormals();
      const gmMesh = new THREE.Mesh(gmGeo, new THREE.MeshBasicMaterial({ 
        map: new THREE.CanvasTexture(gmCanvas), transparent: true, 
        depthTest: false, depthWrite: false, clippingPlanes: clipPlanes 
      }));
      gmMesh.name = 'green_heatmap'; gmMesh.renderOrder = 22;
      group.add(gmMesh);
    }
  }, [urbanTrees, buildings, pavements, undergroundData, buildingOrigin3857, soilGrid, terrainScale, showUrbanTrees, showStressViz, showGreenViz, rootSimVersion]);

  // -- Urban Root Simulation (Rhizomorph) - run once when trees change ------─
  // Caches result in urbanRootSimRef; bumps rootSimVersion to trigger re-render.
  useEffect(() => {
    if (!buildingOrigin3857) return;
    const tid = setTimeout(() => {
      const result = buildUrbanRootSimulation({
        urbanTrees,
        plannerTrees: acceptedPins,
        buildingOrigin3857,
        soilGrid,
        terrainScale,
        fetchRadius,
        undergroundData,
      });
      useSimStore.setState({ urbanRootSimResult: result });
      urbanRootSimRef.current = result;
      setRootSimVersion(v => v + 1);
    }, 100); 
    return () => clearTimeout(tid);
  }, [urbanTrees, acceptedPins, buildingOrigin3857, soilGrid, terrainScale, fetchRadius, undergroundData]); // removed showUrbanRoots to avoid unnecessary runs

  // -- Urban Root Rendering - rebuild geometry when toggle or year changes ----
  useEffect(() => {
    const sc = sceneRef.current;
    if (!sc) return;
    const { scene } = sc;

    const old = scene.getObjectByName('urban_roots_layer');
    if (old) { old.traverse(o => { if (o.geometry) o.geometry.dispose(); }); scene.remove(old); }

    if (!showUrbanRoots || !urbanRootSimRef.current) return;

    const { allSegs, treeData, genusGroups } = urbanRootSimRef.current;

    // Build treeId → data lookup for O(1) access
    const treeLookup = new Map(treeData.map(t => [t.id, t]));
    const treeBaseYs = new Map();
    const currentSoil = useSimStore.getState().soilGrid;
    treeData.forEach(t => {
      treeBaseYs.set(t.id, (currentSoil ? currentSoil.getSurfaceHeight(t.x, t.z) : t.surfaceY) * terrainScale);
    });

    const treeColMap = {};
    for (const td of treeData) {
      treeColMap[td.id] = ROOT_ARCHETYPE_COLORS[td.col] || ROOT_ARCHETYPE_COLORS.heart;
    }

    const geometry = new THREE.CylinderGeometry(1, 1, 1, 5, 1, true);
    geometry.translate(0, 0.5, 0); 
    
    const dummy = new THREE.Object3D();
    const upVec = new THREE.Vector3(0, 1, 0);
    const dirVec = new THREE.Vector3();
    const colorObj = new THREE.Color();
    const tl = new THREE.TextureLoader();

    const rootsGroup = new THREE.Group();
    rootsGroup.name = 'urban_roots_layer';

    // -- Generate Point Cloud DSM Overlay ------------------------─
    // Removed red voxel debug logic as physical terrain vertex modeling has overridden this request via showDSMOverlay.

    // -- Generate Textured Branches & Roots ------------------─
    // -- Pre-filter by year once to reduce loop work ----------─
    const visSegs = allSegs.filter(s => s.year <= rootSimYear);
    if (visSegs.length === 0) return;

    const BARK_MAP = {
      oak: 'Oak.jpg', quercus: 'Oak.jpg', pine: 'Pine.jpg', pinus: 'Pine.jpg',
      spruce: 'Spruce.jpg', picea: 'Spruce.jpg', birch: 'Birch.jpg', betula: 'Birch.jpg',
      beech: 'Beech.jpg', fagus: 'Beech.jpg', cherry: 'BirdCherry.jpg', prunus: 'JapaneseCherry.jpg',
      acer: 'Maple.jpg', ahorn: 'Maple.jpg', platanus: 'Plane.jpg', aesculus: 'HorseChestnut.jpg',
      fraxinus: 'Ash.jpg', tilia: 'Linden.jpg', populus: 'GreyPoplar.jpg', robinia: 'Ash.jpg', default: 'Oak.jpg'
    };

    const LEAF_MAP = {
      oak: 'oak.png', quercus: 'oak.png', pine: 'pine.png', pinus: 'pine.png',
      spruce: 'spruce.png', picea: 'spruce.png', birch: 'birch.png', betula: 'birch.png',
      beech: 'beech.png', fagus: 'beech.png', cherry: 'cherry.png', prunus: 'cherry.png',
      acer: 'maple.png', ahorn: 'maple.png', platanus: 'plane.png', aesculus: 'chestnut.png',
      fraxinus: 'ash.png', tilia: 'linden.png', populus: 'poplar.png', robinia: 'ash.png', default: 'oak.png'
    };

    // -- Generate everything grouped by Genus ------------------─
    for (const [gen, genusAllSegs] of Object.entries(genusGroups)) {
      const gVis = genusAllSegs.filter(s => s.year <= rootSimYear);
      if (gVis.length === 0) continue;

      const gShoots = gVis.filter(s => s.type !== 'leaf');
      const gLeaves = gVis.filter(s => s.type === 'leaf');

      // 1. Branches/Roots
      if (gShoots.length > 0) {
        const tex = tl.load(`/textures/species/barks/${BARK_MAP[gen] || BARK_MAP.default}`);
        tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
        tex.colorSpace = THREE.SRGBColorSpace;
        const bMat = new THREE.MeshStandardMaterial({ 
          map: tex, color: 0x5d4037, roughness: 0.9, flatShading: true, side: THREE.DoubleSide,
          clippingPlanes: clipPlanes
        });
        const bMesh = new THREE.InstancedMesh(geometry, bMat, gShoots.length);
        const bMap = new Array(gShoots.length);

        // Common Dynamic Growth Scaling Model (Solver)
        const getGrowthScale = (t) => {
          const age = Math.max(0, rootSimYear - t.plantYear);
          const totalAgeAtMaturity = 65; 
          const progress = age / totalAgeAtMaturity;
          let pwr = 0.45; // default: rapid start (maple, ash etc)
          if (t.genus === 'quercus' || t.genus === 'oak' || t.genus === 'fagus') pwr = 0.70; 
          if (t.genus === 'populus' || t.genus === 'betula' || t.genus === 'robinia') pwr = 0.32; // pioniers
          return 0.15 + 0.85 * Math.min(1.0, Math.pow(progress, pwr));
        };

        for (let i = 0; i < gShoots.length; i++) {
          const s = gShoots[i];
          const tData = treeLookup.get(s.treeId);
          if (!tData) continue;
          const tBaseAbs = treeBaseYs.get(s.treeId) || 0;
          const tBase = tBaseAbs / terrainScale;
          const gs = getGrowthScale(tData);

          const sY = (s.start[1] - tBase) + tBaseAbs;
          const eY = (s.end[1]   - tBase) + tBaseAbs;
          
          const scX = (s.start[0] - tData.x) * gs + tData.x;
          const scY = (sY - tBaseAbs) * gs + tBaseAbs;
          const scZ = (s.start[2] - tData.z) * gs + tData.z;

          const ecX = (s.end[0] - tData.x) * gs + tData.x;
          const ecY = (eY - tBaseAbs) * gs + tBaseAbs;
          const ecZ = (s.end[2] - tData.z) * gs + tData.z;

          const dx = ecX - scX, dy = ecY - scY, dz = ecZ - scZ;
          const len = Math.sqrt(dx*dx + dy*dy + dz*dz) || 0.001;
          const rad = Math.max(0.015, s.thickness * gs);

          dummy.position.set(scX - (dx/len)*(len*0.05), scY - (dy/len)*(len*0.05), scZ - (dz/len)*(len*0.05));
          dirVec.set(dx/len, dy/len, dz/len);
          dummy.quaternion.setFromUnitVectors(upVec, dirVec);
          dummy.scale.set(rad, len * 1.15, rad);
          dummy.updateMatrix();
          bMesh.setMatrixAt(i, dummy.matrix);

          let c1 = (s.type === 'competition') ? COMPETITION_COL : (s.type === 'graft') ? GRAFT_COL : null;
          if (!c1) {
            const t1 = Math.min(1, s.depth / 3.5);
            if (s.type === 'shoot') {
              c1 = [0.36 - t1*0.22, 0.26 + t1*0.28, 0.16 + t1*0.08];
            } else {
              const bc = treeColMap[s.treeId] || ROOT_ARCHETYPE_COLORS.heart;
              c1 = [bc[0] + (DEEP_SOIL_COL[0]-bc[0])*t1, bc[1] + (DEEP_SOIL_COL[1]-bc[1])*t1, bc[2] + (DEEP_SOIL_COL[2]-bc[2])*t1];
            }
          }
          colorObj.setRGB(c1[0], c1[1], c1[2]);
          bMesh.setColorAt(i, colorObj);
          bMap[i] = s.treeId;
        }
        bMesh.instanceMatrix.needsUpdate = true;
        if (bMesh.instanceColor) bMesh.instanceColor.needsUpdate = true;
        bMesh.userData.rootSimMap = bMap;
        rootsGroup.add(bMesh);
      }

      // 2. Leaves - Hide when simulating (Play button)
      if (!isPlaying && gLeaves.length > 0) {
        const tex = tl.load(`/textures/species/leaves/${LEAF_MAP[gen] || LEAF_MAP.default}`);
        tex.colorSpace = THREE.SRGBColorSpace;
        const leafGeo = new THREE.PlaneGeometry(1, 1);
        const leafMat = new THREE.MeshPhongMaterial({ 
          map: tex, side: THREE.DoubleSide, transparent: true, alphaTest: 0.4, depthTest: true, shininess: 5,
          clippingPlanes: clipPlanes
        });
        const leafMesh = new THREE.InstancedMesh(leafGeo, leafMat, gLeaves.length);
        const leafMap = new Array(gLeaves.length);

        const getGrowthScale = (t) => {
          const age = Math.max(0, rootSimYear - t.plantYear);
          const totalAgeAtMaturity = 65; 
          const progress = age / totalAgeAtMaturity;
          let pwr = 0.45; // default: rapid start (maple, ash etc)
          if (t.genus === 'quercus' || t.genus === 'oak' || t.genus === 'fagus') pwr = 0.70; 
          if (t.genus === 'populus' || t.genus === 'betula' || t.genus === 'robinia') pwr = 0.32; // pioniers
          return 0.15 + 0.85 * Math.min(1.0, Math.pow(progress, pwr));
        };

        for (let i = 0; i < gLeaves.length; i++) {
          const lf = gLeaves[i];
          const tData = treeLookup.get(lf.treeId);
          if (!tData) continue;
          const tBaseAbs = treeBaseYs.get(lf.treeId) || 0;
          const tBase = tBaseAbs / terrainScale;
          const gs = getGrowthScale(tData);

          const sY = (lf.start[1] - tBase) + tBaseAbs;
          const scX = (lf.start[0] - tData.x) * gs + tData.x;
          const scY = (sY - tBaseAbs) * gs + tBaseAbs;
          const scZ = (lf.start[2] - tData.z) * gs + tData.z;

          dummy.position.set(scX, scY, scZ);
          const isConifer = ['pine','pinus','spruce','picea','abies','larix'].includes(gen);
          const crownD = tData.d || 5;
          const baseSize = isConifer ? Math.min(0.7, 0.15 + crownD * 0.04) : Math.min(1.5, 0.35 + crownD * 0.10);
          const spread = (0.6 + Math.random() * 0.8) * baseSize * (0.8 + gs * 0.2);

          dummy.scale.set(spread, spread, spread);
          dummy.rotation.set((Math.random()-0.5)*1.4, Math.random()*Math.PI*2, (Math.random()-0.5)*1.4);
          dummy.updateMatrix();

          const c = Math.random() * 0.2 + 0.8;
          colorObj.setRGB(c, c, c);
          leafMesh.setMatrixAt(i, dummy.matrix);
          leafMesh.setColorAt(i, colorObj);
          leafMap[i] = lf.treeId;
        }
        leafMesh.instanceMatrix.needsUpdate = true;
        if (leafMesh.instanceColor) leafMesh.instanceColor.needsUpdate = true;
        leafMesh.userData.rootSimMap = leafMap;
        rootsGroup.add(leafMesh);
      }
    }
    
    rootsGroup.renderOrder = 52;
    scene.add(rootsGroup);
  }, [showUrbanRoots, rootSimYear, rootSimVersion, terrainScale, soilGrid, isPlaying]);

  // -- Ground Cover Mask --------------------------------------------â”€
  useEffect(() => {
    const sc = sceneRef.current;
    if (!sc) return;
    const { scene } = sc;
    const old = scene.getObjectByName('ground_mask_layer');
    if (old) { old.traverse(o => { if (o.geometry) o.geometry.dispose(); if (o.material) o.material.dispose(); }); scene.remove(old); }
    if (!showGroundMask || !buildingOrigin3857 || !soilGrid) return;
    const HM = 256, worldHalf = fetchRadius;
    const [ox, oy] = buildingOrigin3857;
    const rasterCanvas = document.createElement('canvas');
    rasterCanvas.width = HM; rasterCanvas.height = HM;
    const ctx = rasterCanvas.getContext('2d');
    ctx.fillStyle = '#5d4037'; ctx.fillRect(0, 0, HM, HM);
    if (pavements) {
      for (const p of pavements) {
        if (!p.nodes || p.nodes.length < 2) continue;
        ctx.strokeStyle = '#ffffff'; // White for high contrast GIS mask (pavements & roads)
        ctx.beginPath();
        const rw = { motorway: 20, trunk: 16, primary: 12, secondary: 8, tertiary: 7, residential: 6, footway: 4.5 };
        ctx.lineWidth = Math.max(3.5, ((rw[p.type] || 6) / (worldHalf * 2)) * HM);
        let first = true;
        for (const [bx, by] of p.nodes) {
          const lx = bx - ox, lz = -(by - oy);
          const px = ((lx / worldHalf + 1) * 0.5) * HM, py = ((lz / worldHalf + 1) * 0.5) * HM;
          if (first) { ctx.moveTo(px, py); first = false; } else ctx.lineTo(px, py);
        }
        ctx.stroke();
      }
    }
    const waterPolys = undergroundData?.water_bodies?.features;
    if (waterPolys) {
      ctx.fillStyle = '#0097e6';
      for (const f of waterPolys) {
        if (!f.geometry || f.geometry.type !== 'Polygon') continue;
        for (const ring of f.geometry.coordinates) {
          ctx.beginPath(); let first = true;
          for (const [lon, lat] of ring) {
            const [wx, wy] = latLonToWebMerc(lat, lon);
            const lx = wx - ox, lz = -(wy - oy);
            const px = ((lx / worldHalf + 1) * 0.5) * HM, py = ((lz / worldHalf + 1) * 0.5) * HM;
            if (first) { ctx.moveTo(px, py); first = false; } else ctx.lineTo(px, py);
          }
          ctx.closePath(); ctx.fill();
        }
      }
    }
    ctx.fillStyle = '#2c3e50';
    for (const b of buildings) {
      if (!b.geometry?.coordinates) continue;
      for (const ring of b.geometry.coordinates) {
        ctx.beginPath(); let first = true;
        for (const [bx, by] of ring) {
          const lx = bx - ox, lz = -(by - oy);
          const px = ((lx / worldHalf + 1) * 0.5) * HM, py = ((lz / worldHalf + 1) * 0.5) * HM;
          if (first) { ctx.moveTo(px, py); first = false; } else ctx.lineTo(px, py);
        }
        ctx.closePath(); ctx.fill();
      }
    }
    heatmapLookup.current.groundPixels = ctx.getImageData(0, 0, HM, HM).data;
    const res = 255;
    const hmGeo = new THREE.PlaneGeometry(worldHalf * 2, worldHalf * 2, res, res);
    hmGeo.rotateX(-Math.PI / 2);
    const pos = hmGeo.attributes.position;
    for (let i = 0; i < pos.count; i++) {
      const eps = 0.5;
      const sx = Math.max(-worldHalf + eps, Math.min(worldHalf - eps, pos.getX(i)));
      const sz = Math.max(-worldHalf + eps, Math.min(worldHalf - eps, pos.getZ(i)));
      pos.setY(i, (soilGrid.getSurfaceHeight(sx, sz) || 0) * terrainScale + 0.1);
    }
    pos.needsUpdate = true; hmGeo.computeVertexNormals();
    const hmMesh = new THREE.Mesh(hmGeo, new THREE.MeshBasicMaterial({ 
      map: new THREE.CanvasTexture(rasterCanvas), transparent: true, opacity: 0.9, 
      depthTest: false, depthWrite: false, clippingPlanes: clipPlanes 
    }));
    hmMesh.renderOrder = 25;
    const group = new THREE.Group(); group.name = 'ground_mask_layer'; group.add(hmMesh); scene.add(group);
  }, [buildings, pavements, undergroundData, buildingOrigin3857, soilGrid, terrainScale, fetchRadius, showGroundMask]);

  // -- Water Bodies Layer --------------------------------------------
  useEffect(() => {
    const sc = sceneRef.current;
    if (!sc) return;
    const { scene } = sc;
    const old = scene.getObjectByName('water_bodies_layer');
    if (old) { old.traverse(o => { if (o.geometry) o.geometry.dispose(); if (o.material) o.material.dispose(); }); scene.remove(old); }
    if (!showWaterBodies || !undergroundData?.water_bodies?.features || !buildingOrigin3857 || !soilGrid) return;
    const [ox, oy] = buildingOrigin3857;
    const group = new THREE.Group(); group.name = 'water_bodies_layer';
    const waterMat = new THREE.MeshBasicMaterial({ 
      color: 0x0097e6, transparent: true, opacity: 0.7, depthTest: true, depthWrite: false, 
      polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -1,
      clippingPlanes: clipPlanes
    });
    undergroundData.water_bodies.features.forEach(f => {
      if (!f.geometry || f.geometry.type !== 'Polygon') return;
      f.geometry.coordinates.forEach(ring => {
        const shape = new THREE.Shape();
        ring.forEach((c, idx) => {
          const [wx, wy] = latLonToWebMerc(c[1], c[0]);
          const lx = wx - ox, lz = -(wy - oy);
          if (idx === 0) shape.moveTo(lx, lz); else shape.lineTo(lx, lz);
        });
        const geo = new THREE.ShapeGeometry(shape);
        geo.rotateX(-Math.PI / 2);
        const pos = geo.attributes.position;
        for (let i = 0; i < pos.count; i++) {
          pos.setY(i, (soilGrid.getSurfaceHeight(pos.getX(i), pos.getZ(i)) || 0) * terrainScale + 0.05);
        }
        pos.needsUpdate = true;
        const wm = new THREE.Mesh(geo, waterMat); wm.renderOrder = 3; group.add(wm);
      });
    });
    scene.add(group);
  }, [undergroundData, buildingOrigin3857, soilGrid, terrainScale, showWaterBodies]);

  // -- Terrain Loading Visibility Sync -----------------------------
  useEffect(() => {
    const sc = sceneRef.current;
    if (!sc) return;
    sc.terrainMesh.visible = !loadingGIS;
    sc.soilBoxMesh.visible = !loadingGIS;
    sc.soilBoxFillMesh.visible = !loadingGIS;
    if (sc.brushMesh) sc.brushMesh.visible = !loadingGIS && sc.brushMesh.visible;
  }, [loadingGIS]);

  // -- Scene setup --------------------------------------------------
  useEffect(() => {
    const container = containerRef.current;
    if (!container || sceneRef.current) return;

    const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false, logarithmicDepthBuffer: true });
    renderer.localClippingEnabled = true;
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.setSize(container.clientWidth, container.clientHeight);
    renderer.shadowMap.enabled = true;
    renderer.setClearColor(0xcbe6fd);
    container.appendChild(renderer.domElement);

    const labelRenderer = new CSS2DRenderer();
    labelRenderer.setSize(container.clientWidth, container.clientHeight);
    labelRenderer.domElement.style.position = 'absolute';
    labelRenderer.domElement.style.top = '0px';
    labelRenderer.domElement.style.pointerEvents = 'none';
    container.appendChild(labelRenderer.domElement);

    const scene = new THREE.Scene();
    const initialWh = useSimStore.getState().fetchRadius || 200;
    scene.background = new THREE.Color(0xcbe6fd);
    scene.fog = new THREE.Fog(0xcbe6fd, initialWh * 2.0, initialWh * 6.0);
    const camera = new THREE.PerspectiveCamera(55, container.clientWidth / container.clientHeight, 0.1, 50000);
    camera.position.set(0, initialWh * 0.25, initialWh * 2.2);

    const controls = new OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true;
    controls.dampingFactor = 0.06;
    controls.maxPolarAngle = Math.PI * 0.88;

    scene.add(new THREE.HemisphereLight(0xffffff, 0x444444, 1.2));
    const sun = new THREE.DirectionalLight(0xfff8e7, 1.8);
    sun.position.set(5, 12, 8); sun.castShadow = true; sun.shadow.mapSize.set(2048, 2048);
    scene.add(sun);

    const terrainRes = GRID_NX - 1;
    const initialWorldHalf = useSimStore.getState().soilGrid?.worldHalf || 10;
    const terrainGeo = new THREE.PlaneGeometry(initialWorldHalf * 2, initialWorldHalf * 2, terrainRes, terrainRes);
    terrainGeo.rotateX(-Math.PI / 2);
    terrainGeo.setAttribute('color', new THREE.BufferAttribute(new Float32Array(terrainGeo.attributes.position.count * 3).fill(0.5), 3));
    const terrainMat = new THREE.MeshStandardMaterial({
       vertexColors: true, roughness: 0.9, side: THREE.FrontSide,
       polygonOffset: true, polygonOffsetFactor: 2, polygonOffsetUnits: 2,
       transparent: true, opacity: 0.95,
       clippingPlanes: clipPlanes,
    });
    const terrainMesh = new THREE.Mesh(terrainGeo, terrainMat);
    terrainMesh.receiveShadow = true;
    terrainMesh.renderOrder = 10;
    terrainMesh.visible = false; // hidden until real DTM data arrives
    scene.add(terrainMesh);

    // Underground solid volume — terrain-following top face, flat bottom at -60.
    // DoubleSide so inner faces show when section planes cut through.
    // polygonOffset pushes it behind the terrain to prevent Z-fighting.
    const soilBoxMat = new THREE.MeshStandardMaterial({
      color: 0x4a3728, // More technical neutral brown
      transparent: true,
      opacity: 0.12,    // High transparency for infrastructure visibility
      side: THREE.FrontSide,
      roughness: 1.0,
      metalness: 0.0,
      clippingPlanes: clipPlanes,
      depthWrite: false, // Critical: let infrastructure show through
      polygonOffset: true,
      polygonOffsetFactor: 1,
      polygonOffsetUnits: 1,
    });
    const soilBoxMesh = new THREE.Mesh(new THREE.BufferGeometry(), soilBoxMat);
    soilBoxMesh.name = 'soil_volume';
    soilBoxMesh.renderOrder = 31; // After terrain, before infra
    scene.add(soilBoxMesh);

    // Dedicated BackSide mesh for volume interior (solid brown when clipped)

    const soilBoxFillMat = new THREE.MeshStandardMaterial({
      color: 0x3d2112,
      side: THREE.BackSide,
      clippingPlanes: clipPlanes,
      transparent: true,
      opacity: 0.08,    // Extremely subtle backface fill
      depthWrite: false,
      polygonOffset: true,
      polygonOffsetFactor: 2,
      polygonOffsetUnits: 2,
    });
    const soilBoxFillMesh = new THREE.Mesh(new THREE.BufferGeometry(), soilBoxFillMat);
    soilBoxFillMesh.name = 'soil_volume_fill';
    soilBoxFillMesh.renderOrder = 30; // Before frontside
    scene.add(soilBoxFillMesh);

    const brushGeo = new THREE.RingGeometry(0.5, 0.55, 32);
    brushGeo.rotateX(-Math.PI / 2);
    const brushMesh = new THREE.Mesh(brushGeo, new THREE.MeshBasicMaterial({ color: 0x00ffcc, transparent: true, opacity: 0.5 }));
    brushMesh.visible = false;
    scene.add(brushMesh);

    const tooltip = document.createElement('div');
    tooltip.className = 'canvas-tooltip';
    tooltip.style.display = 'none';
    document.body.appendChild(tooltip);

    sceneRef.current = { renderer, labelRenderer, scene, camera, controls, terrainMesh, soilBoxMesh, soilBoxFillMesh, brushMesh, tooltip };

    // -- Start: Loading Visibility Logic --
    const updateVisibility = () => {
      const isL = useSimStore.getState().loadingGIS;
      if (terrainMesh) terrainMesh.visible = !isL;
      if (soilBoxMesh) soilBoxMesh.visible = !isL;
      if (soilBoxFillMesh) soilBoxFillMesh.visible = !isL;
    };
    updateVisibility();
    // -- End: Loading Visibility Logic --

    const raycaster = new THREE.Raycaster();
    const mouse = new THREE.Vector2();
    let isMouseDown = false;

    const onPointerMove = (e) => {
      const state = useSimStore.getState();
      const sc = sceneRef.current;
      if (!sc) return;
      const isDE = language === 'de';
      const rect = container.getBoundingClientRect();
      mouse.x = ((e.clientX - rect.left) / rect.width) * 2 - 1;
      mouse.y = -((e.clientY - rect.top) / rect.height) * 2 + 1;
      raycaster.setFromCamera(mouse, camera);

      const terrainHits = raycaster.intersectObject(sc.terrainMesh);
      let treeHit = null;
      // 1. Urban Kataster trees (Instanced)
      const urbanLayer = sc.scene.getObjectByName('urban_trees_layer');
      if (urbanLayer) {
        const uHits = raycaster.intersectObjects(urbanLayer.children, true);
        if (uHits.length > 0) {
          const hit = uHits[0], iMap = urbanLayer.userData.instanceMap;
          if (hit.instanceId !== undefined && iMap?.[hit.instanceId]) {
            treeHit = { userData: { ...iMap[hit.instanceId], isUrban: true } };
          }
        }
      }
      // 2. Simulated biological structures (Roots, Trunks, Leaves)
      if (!treeHit) {
        const rootL = sc.scene.getObjectByName('urban_roots_layer');
        if (rootL) {
          const rHits = raycaster.intersectObjects(rootL.children, true);
          if (rHits.length > 0) {
            const hit = rHits[0];
            const tId = hit.object.userData.rootSimMap?.[hit.instanceId];
            if (tId) {
              const katasterTree = state.urbanTrees.find(ut => (ut.properties?.katasterId || ut.id) === tId);
              if (katasterTree) {
                const gattungArt = katasterTree.properties.GATTUNG_ART || katasterTree.properties.GATTUNG_LAT || null;
                const genusRaw   = (katasterTree.properties.GATTUNG || (gattungArt ? gattungArt.split(' ')[0] : 'Tree'));
                const displayGenus = genusRaw.charAt(0).toUpperCase() + genusRaw.slice(1).toLowerCase();
                const displaySpec  = katasterTree.properties.ART_DEUTSCH || katasterTree.properties.SPEZIES || gattungArt || 'Unknown';
                const baumNr       = katasterTree.properties.BAUMNUMMER || tId.toString().split('.').pop();
                
                treeHit = {
                  userData: {
                    species: displayGenus,
                    details: displaySpec,
                    baumNr: baumNr,
                    height: katasterTree.properties.BAUMHOEHE || katasterTree.height,
                    crown: katasterTree.properties.KRONENDURCHMESSER || katasterTree.crown,
                    stress: katasterTree.properties.stress_score ?? 0.15,
                    isSimulated: true
                  }
                };
              } else if (urbanRootSimRef.current?.treeData) {
                const matchedTr = urbanRootSimRef.current.treeData.find(td => td.id === tId);
                if (matchedTr) {
                  const sp = SPECIES[matchedTr.genus] || {};
                  treeHit = {
                    userData: {
                      species: (sp.nameEN || matchedTr.genus),
                      details: isDE ? sp.nameDE : sp.nameEN,
                      baumNr: matchedTr.treeLabel || matchedTr.id,
                      height: matchedTr.height,
                      crown: matchedTr.crown,
                      stress: 1 - matchedTr.vigor,
                      isSimulated: true
                    }
                  };
                }
              }
            }
          }
        }
      }

      // 3. Simulated trees (Individual Groups)
      if (!treeHit) {
        const simGroups = [];
        sc.scene.traverse(o => { if (o.userData.treeId) simGroups.push(o); });
        const sHits = raycaster.intersectObjects(simGroups, true);
        if (sHits.length > 0) {
          const hit = sHits[0], trId = hit.object.userData.treeId;
          const trData = state.trees.find(t => t.id === trId);
          if (trData) {
            const sp = SPECIES[trData.species] || { name: trData.species };
            treeHit = { 
              userData: { 
                species: isDE ? (sp.nameDE || sp.name) : (sp.nameEN || sp.name), 
                details: isDE ? (sp.nameDE || sp.name) : (sp.nameEN || sp.name), 
                baumNr: trData.id, 
                height: trData.height || 10,
                crown: trData.crown || 6,
                stress: 1 - (trData.vigor || 0.85),
                isSimulated: true
              } 
            };
          }
        }
      }

      // -- Underground Hover ----------------------------------------
      const ugLayer = scene.getObjectByName('underground_layer');
      if (ugLayer && state.showUnderground) {
        const ugHits = raycaster.intersectObjects(ugLayer.children, true);
        const isBeneathOpaqueGround = !state.showXRay && terrainHits.length > 0 && (ugHits.length > 0 && terrainHits[0].distance < ugHits[0].distance);

        if (ugHits.length > 0 && !isBeneathOpaqueGround) {
          const h = ugHits[0];
          const ud = h.object.userData;
          const lx = h.point.x, lz = h.point.z;
          const gY = state.soilGrid ? state.soilGrid.getSurfaceHeight(lx, lz) : 0;
          const dM = Math.abs((gY * terrainScale) - h.point.y);
          let html = '';
          if (ud.isStation) {
            html = `<div class="tooltip-title">■ ${isDE ? 'INFRASTRUKTUR' : 'INFRASTRUCTURE'}</div>` +
              `<div class="tooltip-row"><span class="tooltip-label">${isDE ? 'Typ' : 'Type'}</span><span class="tooltip-val">U-Bahn Station</span></div>` +
              `<div class="tooltip-row"><span class="tooltip-label">Name</span><span class="tooltip-val">${ud.sName || '-'}</span></div>` +
              `<div class="tooltip-row"><span class="tooltip-label">${isDE ? 'Linie' : 'Line'}</span><span class="tooltip-val" style="color:#58a6ff">U${ud.sLine || '?'}</span></div>` +
              `<div class="tooltip-row"><span class="tooltip-label">${isDE ? 'Tiefe' : 'Depth'}</span><span class="tooltip-val">-${ud.depthM || dM.toFixed(1)}m</span></div>`;
          } else if (ud.isUbahn) {
            html = `<div class="tooltip-title">▲ ${isDE ? 'INFRASTRUKTUR' : 'INFRASTRUCTURE'}</div>` +
              `<div class="tooltip-row"><span class="tooltip-label">${isDE ? 'Typ' : 'Type'}</span><span class="tooltip-val">U-Bahn Tunnel</span></div>` +
              `<div class="tooltip-row"><span class="tooltip-label">${isDE ? 'Linie' : 'Line'}</span><span class="tooltip-val" style="color:#58a6ff">U${ud.lineNum || '?'}</span></div>` +
              `<div class="tooltip-row"><span class="tooltip-label">${isDE ? 'Tiefe' : 'Depth'}</span><span class="tooltip-val">-${ud.depthM || dM.toFixed(1)}m</span></div>`;
          } else if (ud.isPipe) {
            html = `<div class="tooltip-title">▲ ${isDE ? 'INFRASTRUKTUR' : 'INFRASTRUCTURE'}</div>` +
              `<div class="tooltip-row"><span class="tooltip-label">${isDE ? 'Typ' : 'Type'}</span><span class="tooltip-val">${ud.pipeType || 'Utility Pipe'}</span></div>` +
              `<div class="tooltip-row"><span class="tooltip-label">${isDE ? 'Tiefe' : 'Depth'}</span><span class="tooltip-val">-${ud.depthM || dM.toFixed(1)}m</span></div>`;
          } else {
            html = `<div class="tooltip-title">▲ ${isDE ? 'INFRASTRUKTUR' : 'INFRASTRUCTURE'}</div>` +
              `<div class="tooltip-row"><span class="tooltip-label">${isDE ? 'Tiefe' : 'Depth'}</span><span class="tooltip-val">-${dM.toFixed(1)}m</span></div>`;
          }
            sc.tooltip.innerHTML = html;
            sc.tooltip.style.display = 'block';
            sc.tooltip.style.left = `${e.clientX + 15}px`;
            sc.tooltip.style.top = `${e.clientY + 15}px`;
            sc.brushMesh.visible = false;
            return;
          }
        }

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
        if (!val) return val;
        if (language === 'de') return val;
        const base = val.split(' ')[0];
        return SPECIES_TRANSLATIONS[base] || val;
      };

      // -- Tree Hover ------------------------------------------------
      if (treeHit) {
        const data = treeHit.userData;
        if (!data || Object.keys(data).length === 0) {
          sc.tooltip.style.display = 'none';
          return;
        }
        const { showStressViz: sv } = state;
        const genus  = data.species || 'Tree';
        const species = data.details || 'Unknown';
        const title = `<span style="color:var(--accent)">●</span> ${genus.toUpperCase()} TREE`;
        const rows = [`<div class="tooltip-title">${title}</div>`];
        
        rows.push(`<div class="tooltip-row"><span class="tooltip-label">ID REF</span><span class="tooltip-val">#${data.baumNr || ''}</span></div>`);
        rows.push(`<div class="tooltip-row"><span class="tooltip-label">${isDE ? 'GATTUNG' : 'GENUS'}</span><span class="tooltip-val">${genus}</span></div>`);
        rows.push(`<div class="tooltip-row"><span class="tooltip-label">${isDE ? 'SPEZIES' : 'SPECIES'}</span><span class="tooltip-val" style="font-size:7px; opacity:0.8; line-height:1.2">${species}</span></div>`);
        rows.push(`<div class="tooltip-row"><span class="tooltip-label">${isDE ? 'MAX HÖHE' : 'MAX HEIGHT'}</span><span class="tooltip-val">${Number(data.height).toFixed(1)}m</span></div>`);
        rows.push(`<div class="tooltip-row"><span class="tooltip-label">${isDE ? 'KRONE' : 'CANOPY'}</span><span class="tooltip-val">ø ${Number(data.crown).toFixed(1)}m</span></div>`);
        
        if (data.stress !== undefined) {
          const s = data.stress ?? 0.15;
          const sPct = Math.round(s * 100);
          const color = s < 0.35 ? '#2ecc71' : s < 0.65 ? '#f1c40f' : '#e74c3c';
          rows.push(`<div style="margin-top:14px; border-top: 1px solid rgba(255,255,255,0.06); padding-top: 10px;">` +
            `<div class="tooltip-row"><span class="tooltip-label">${isDE ? 'BIOLOGISCHER STRESS' : 'BOTANICAL STRESS'}</span><span class="tooltip-val" style="color:${color}">${sPct}%</span></div>` +
            `<div class="tooltip-stat-bar" style="background:rgba(255,255,255,0.1)"><div class="tooltip-stat-fill" style="width:${sPct}%;background:${color}"></div></div></div>`);
        }
        sc.tooltip.innerHTML = rows.join('');
        sc.tooltip.style.display = 'block';
        sc.tooltip.style.left = `${e.clientX + 15}px`;
        sc.tooltip.style.top = `${e.clientY + 15}px`;
        sc.brushMesh.visible = false;
        return;
      }      // -- Terrain Hover ----------------------------------------------
      if (terrainHits.length > 0) {
        const hit = terrainHits[0];
        sc.brushMesh.position.copy(hit.point); sc.brushMesh.position.y += 0.05;
        sc.brushMesh.scale.set(state.brushSize, state.brushSize, state.brushSize);
        sc.brushMesh.visible = (terrainSubTab === 'Edit' && !state.placingTree);

        if (state.soilGrid && !state.placingTree) {
          // -- Perform Terraforming if Mouse is Down --
          if (isMouseDown && terrainSubTab === 'Edit') {
            const { currentBrushType, brushStrength, brushSize } = state;
            const strength = (e.shiftKey || e.button === 2) ? -brushStrength : brushStrength;
            if (currentBrushType === 'height') {
              state.morphTerrain(hit.point.x, hit.point.z, strength * 0.1, brushSize);
            } else if (currentBrushType === 'moisture') {
              state.paintMoisture(hit.point.x, hit.point.z, strength, brushSize);
            } else if (currentBrushType === 'nutrients') {
              state.paintNutrients(hit.point.x, hit.point.z, strength, brushSize);
            }
          }

          const m = state.soilGrid.getMoisture(hit.point.x, hit.point.z, hit.point.y);
          const n = state.soilGrid.getNutrients(hit.point.x, hit.point.z, hit.point.y);
          let rows = [];
          if (terrainSubTab === 'Edit') {
            rows.push(`<div class="tooltip-title">Terramorph Brush</div>`);
            rows.push(`<div class="tooltip-row"><span class="tooltip-label">Active Channel</span><span class="tooltip-val">${state.currentBrushType.toUpperCase()}</span></div>`);
            rows.push(`<div class="tooltip-row"><span class="tooltip-label">Local Moisture</span><span class="tooltip-val">${Math.round(m * 100)}%</span></div>`);
            rows.push(`<div class="tooltip-row"><span class="tooltip-label">Nutrient Index</span><span class="tooltip-val">${Math.round(n * 100)}%</span></div>`);
          } else {
            const { buildingOrigin3857: bo, buildings: bdgs, pavements: pvts, undergroundData: ugd, soilGrid: sg, selectedSpecies: sp } = state;
            const vRes = computeViability(hit.point.x, hit.point.z, bo, sp, urbanTrees, trees, bdgs, pvts, ugd, sg);
            if (!vRes) {
              sc.tooltip.style.display = 'none';
              return;
            }
            const vColor = vRes.overall > 0.65 ? '#2ecc71' : vRes.overall > 0.35 ? '#f1c40f' : '#e74c3c';
            rows.push(`<div class="tooltip-title"><span style="color:${vColor}">◆</span> ${isDE ? 'Lebensfähigkeit' : 'Viability Probe'} <span style="margin-left:auto;color:${vColor}">${Math.round(vRes.overall * 100)}%</span></div>`);
            if (vRes.isFatal) {
              const fatalMsg = vRes.fatalType === 'building' ? (isDE ? 'Gebäude-Grundriss' : 'Building Footprint') : vRes.fatalType === 'road' ? (isDE ? 'Straßenbelag' : 'Road Surface') : (isDE ? 'Kronen-Konflikt' : 'Canopy overlap');
              rows.push(`<div class="tooltip-row" style="color:#e74c3c;font-weight:900"><span class="tooltip-label" style="color:#e74c3c">${isDE ? 'NICHT MÖGLICH' : 'NON-VIABLE'}</span><span class="tooltip-val">${fatalMsg}</span></div>`);
            } else {
              rows.push(`<div class="tooltip-row"><span class="tooltip-label">${isDE ? 'Einschränkung' : 'Limiting Factor'}</span><span class="tooltip-val" style="color:#f39c12">${CONSTRAINT_LABELS[language][vRes.worstKey] || vRes.worstKey}</span></div>`);
            }
            rows.push(`<div style="height:4px;border-top:1px solid rgba(255,255,255,0.05);margin:4px 0"></div>`);
            const radius = heatmapLookup.current.radius || fetchRadius;
            const gx = (hit.point.x / radius + 1) * 0.5;
            const gz = (hit.point.z / radius + 1) * 0.5;
            if (state.showStressViz && heatmapLookup.current.stress) {
              const HM = 512, ix = Math.floor(gx * HM), iz = Math.floor(gz * HM);
              const val = heatmapLookup.current.stress[Math.min(HM*HM-1, Math.max(0, iz * HM + ix))];
              rows.push(`<div class="tooltip-row"><span class="tooltip-label">${isDE ? 'Umweltstress' : 'Environ. Stress'}</span><span class="tooltip-val">${Math.round(val * 100)}%</span></div>`);
            }
            if (state.showGreenViz && heatmapLookup.current.greenery) {
              const HM = 256, ix = Math.floor(gx * HM), iz = Math.floor(gz * HM);
              const val = heatmapLookup.current.greenery[Math.min(HM*HM-1, Math.max(0, iz * HM + ix))];
              rows.push(`<div class="tooltip-row"><span class="tooltip-label">${isDE ? 'Kronendichte' : 'Canopy Coverage'}</span><span class="tooltip-val">${Math.round(val * 100)}%</span></div>`);
            }
            const bDist = vRes.constraints?.buildingDist?.value ?? 999;
            const uDist = vRes.constraints?.ubahnDist?.value ?? 999;
            rows.push(`<div class="tooltip-row"><span class="tooltip-label">${isDE ? 'Infrastruktur' : 'Infrastructure'}</span><span class="tooltip-val">${bDist.toFixed(0)}m ${isDE ? 'Geb' : 'Bld'} / ${uDist.toFixed(0)}m ${isDE ? 'Bahn' : 'Metro'}</span></div>`);
            rows.push(`<div class="tooltip-row"><span class="tooltip-label">${isDE ? 'Bodenfeuchte' : 'Soil Moisture'}</span><span class="tooltip-val">${Math.round(m*100)}%</span></div>`);
          }
          if (rows.length > 0) {
            sc.tooltip.innerHTML = rows.join('');
            sc.tooltip.style.display = 'block';
            sc.tooltip.style.left = `${e.clientX + 15}px`;
            sc.tooltip.style.top = `${e.clientY + 15}px`;
          }
        }
      } else {
        sc.tooltip.style.display = 'none';
        sc.brushMesh.visible = false;
      }
    };

     const onPointerDown = (e) => {
       isMouseDown = true;
       const state = useSimStore.getState();
       const sc = sceneRef.current;
       if (!sc) return;
       const rect = container.getBoundingClientRect();
       mouse.x = ((e.clientX - rect.left) / rect.width) * 2 - 1;
       mouse.y = -((e.clientY - rect.top) / rect.height) * 2 + 1;
       raycaster.setFromCamera(mouse, camera);

       if (state.candidatePlantMode) {
         const hits = raycaster.intersectObject(sceneRef.current.terrainMesh);
         if (hits.length > 0) {
           state.setCandidateLocation({ x: hits[0].point.x, z: hits[0].point.z });
           state.setCandidatePlantMode(false);
         }
         return;
       }

       const infraArr = [];
       scene.traverse(o => { 
         if (o.userData.treeId || o.userData.isBuilding || o.userData.isTextureBuilding || o.isInstancedMesh) {
           infraArr.push(o); 
         }
       });
       const hits = raycaster.intersectObjects(infraArr);
       if (hits.length > 0) {
         const hit = hits[0].object;
         if (hit.userData.treeId) {
            state.selectTree(hit.userData.treeId, e.ctrlKey || e.metaKey);
            const [ox, oy] = state.buildingOrigin3857;
            const { lat, lon } = webMercToLatLon(ox + hit.position.x, oy - hit.position.z);
            state.setSelectedFeature({ type: 'tree', id: hit.userData.treeId, lat, lon });
         } else if (hit.isInstancedMesh && hit.parent?.name === 'urban_trees_layer') {
            const instId = hits[0].instanceId;
            const iMap = hit.parent.userData.instanceMap;
            if (instId !== undefined && iMap?.[instId]) {
              const treeData = iMap[instId];
              const [ox, oy] = state.buildingOrigin3857;
              const { lat, lon } = webMercToLatLon(ox + treeData.lx, oy - treeData.lz);
              state.setSelectedFeature({ type: 'urban_tree', id: treeData.baumNr, lat, lon });
            }
         } else if (hit.isInstancedMesh && hit.parent?.name === 'urban_roots_layer') {
            const instId = hits[0].instanceId;
            const simMap = hit.userData.rootSimMap;
            if (instId !== undefined && simMap?.[instId]) {
              const tId = simMap[instId];
              const matchedTr = urbanRootSimRef.current?.treeData.find(td => td.id === tId);
              if (matchedTr) {
                const [ox, oy] = state.buildingOrigin3857;
                const { lat, lon } = webMercToLatLon(ox + matchedTr.x, oy - matchedTr.z);
                state.setSelectedFeature({ type: 'urban_tree', id: matchedTr.id, lat, lon });
              }
            }
         } else if (hit.userData.isMapillaryPoint) {
             const { lat, lon } = hit.userData;
             state.setSelectedFeature({ type: 'mapillary', id: 'm_' + Date.now(), lat, lon });
         } else if (hit.userData.isBuilding || hit.userData.isTextureBuilding) {
            const [ox, oy] = state.buildingOrigin3857;
            const hp = hits[0].point;
            const { lat, lon } = webMercToLatLon(ox + hp.x, oy - hp.z);
            console.log(`[Selection] Selected feature at Lat: ${lat}, Lon: ${lon} (WorldMerc: ${ox + hp.x}, ${oy - hp.z})`);
            state.setSelectedFeature({ type: 'building', id: hit.userData.id, lat, lon });
         }
       }
     };

     const onPointerUp = () => isMouseDown = false;
     const onContextMenu = (e) => { e.preventDefault(); };

    container.addEventListener('pointermove', onPointerMove);
    container.addEventListener('pointerdown', onPointerDown);
    container.addEventListener('pointerup', onPointerUp);
    window.addEventListener('pointerup', onPointerUp);
    container.addEventListener('contextmenu', onContextMenu);

    const ro = new ResizeObserver(() => {
      const w = container.clientWidth, h = container.clientHeight;
      if (w === 0 || h === 0) return;
      renderer.setSize(w, h); labelRenderer.setSize(w, h);
      camera.aspect = w / h; camera.updateProjectionMatrix();
    });
    ro.observe(container);

    const animate = () => {
      sceneRef.current.animId = requestAnimationFrame(animate);
      controls.update();
      const elapsed = clockRef.current.getElapsedTime();
      scene.traverse(obj => {
        if (obj.userData.isCompetitionZone) obj.material.opacity = 0.2 + 0.15 * Math.sin(elapsed * 5);
        if (obj.userData.isGraftSpark) obj.material.opacity = 0.4 + 0.3 * Math.sin(elapsed * 10);
        if (obj.userData.isCandidatePin) {
          const pulse = 0.5 + 0.4 * Math.sin(elapsed * 3);
          obj.material.opacity = obj.material.userData?.isPinCore ? 0.7 + 0.3 * pulse : 0.2 + 0.2 * pulse;
        }
      });
      const camPos = camera.position;
      const tr = useSimStore.getState().fetchRadius || 10;
      treeGroupsRef.current.forEach(entry => {
        if (!entry.label?.element) return;
        const dist = camPos.distanceTo(entry.treeGroup.position);
        const isVisible = dist < tr * 3.5 && dist > 1.5;
        entry.label.element.style.opacity = isVisible ? '1' : '0';
        entry.label.element.style.pointerEvents = isVisible ? 'auto' : 'none';
      });
      renderer.render(scene, camera);
      labelRenderer.render(scene, camera);
    };
    animate();

    return () => {
      cancelAnimationFrame(sceneRef.current.animId);
      ro.disconnect();
      container.removeEventListener('pointermove', onPointerMove);
      container.removeEventListener('pointerdown', onPointerDown);
      container.removeEventListener('pointerup', onPointerUp);
      window.removeEventListener('pointerup', onPointerUp);
      container.removeEventListener('contextmenu', onContextMenu);
      renderer.dispose();
      if (container.contains(renderer.domElement)) container.removeChild(renderer.domElement);
      if (tooltip.parentNode) tooltip.parentNode.removeChild(tooltip);
      sceneRef.current = null;
    };
  }, []);

  // -- Camera reset on DTM fetch ------------------------------------â”€
  useEffect(() => {
    if (!sceneRef.current) return;
    const { camera, controls } = sceneRef.current;
    const wh = fetchRadius || 10;
    const surfaceY = soilGrid ? (soilGrid.getSurfaceHeight(0, 0) || 0) * terrainScale : 0;
    
    camera.position.set(0, surfaceY + wh * 0.8, wh * 1.2);
    controls.target.set(0, surfaceY, 0);
    controls.update();
  }, [terrainFetchedAt]);

  // -- Mapillary Sequences Fetch ------------------------------
  useEffect(() => {
    if (showMapillarySequences) fetchMapillarySequences();
  }, [showMapillarySequences, location, fetchRadius]);

  // -- Mapillary Sequences Rendering --------------------------
  useEffect(() => {
    const sc = sceneRef.current;
    if (!sc) return;
    const { scene } = sc;
    const old = scene.getObjectByName('mapillary_sequences_layer');
    if (old) { 
      old.traverse(o => { if (o.geometry) o.geometry.dispose(); if (o.material) o.material.dispose(); }); 
      scene.remove(old); 
    }
    if (!showMapillarySequences || !mapillarySequences || !buildingOrigin3857 || !soilGrid) return;
    const group = new THREE.Group();
    group.name = 'mapillary_sequences_layer';
    const [ox, oy] = buildingOrigin3857;
    const ptGeo = new THREE.SphereGeometry(0.8, 8, 8);
    const ptMat = new THREE.MeshBasicMaterial({ 
      color: 0x00d2ff, transparent: true, opacity: 0.8,
      clippingPlanes: clipPlanes
    });
    mapillarySequences.forEach(seq => {
      if (!seq.geometry || seq.geometry.type !== 'LineString') return;
      seq.geometry.coordinates.forEach(([slon, slat]) => {
        const [wx, wy] = latLonToWebMerc(slat, slon);
        const lx = wx - ox, lz = -(wy - oy);
        if (Math.abs(lx) > fetchRadius || Math.abs(lz) > fetchRadius) return;
        const gy = soilGrid.getSurfaceHeight(lx, lz) * terrainScale;
        const mesh = new THREE.Mesh(ptGeo, ptMat);
        mesh.position.set(lx, gy + 1.2, lz);
        mesh.userData = { isMapillaryPoint: true, lat: slat, lon: slon };
        group.add(mesh);
      });
    });
    scene.add(group);
  }, [mapillarySequences, showMapillarySequences, buildingOrigin3857, soilGrid, terrainScale, fetchRadius]);

  // -- Sync Store â†’ Scene --------------------------------------------
  useEffect(() => {
    const sc = sceneRef.current;
    if (!sc) return;
    const { scene, terrainMesh, soilBoxMesh } = sc;
    const tr = fetchRadius;
    // Show terrain only after real DTM data has been fetched
    terrainMesh.visible = terrainFetchedAt > 0;
    if (soilGrid) {
      // Keep terrain opaque normally (renders in opaque pass → no Z-fight with soil box).
      // Only go transparent in XRay mode so underground is visible through the surface.
      terrainMesh.material.transparent = showXRay;
      terrainMesh.material.opacity = showXRay ? 0.30 : 1.0;
      terrainMesh.material.needsUpdate = true;
      if (soilBoxMesh) {
        soilBoxMesh.material.opacity = showXRay ? 0.25 : 0.55;
        soilBoxMesh.material.needsUpdate = true;
      }
      if (sc.soilBoxFillMesh) {
        sc.soilBoxFillMesh.material.needsUpdate = true;
      }
      const currentWidth = terrainMesh.geometry.userData.wh ? terrainMesh.geometry.userData.wh * 2 : 20;
      if (Math.abs(currentWidth - tr * 2) > 0.1) {
        terrainMesh.geometry.dispose();
        terrainMesh.geometry = new THREE.PlaneGeometry(tr * 2, tr * 2, GRID_NX - 1, GRID_NX - 1);
        terrainMesh.geometry.rotateX(-Math.PI / 2);
        terrainMesh.geometry.setAttribute('color', new THREE.BufferAttribute(new Float32Array(terrainMesh.geometry.attributes.position.count * 3).fill(0.1), 3));
        terrainMesh.geometry.userData.wh = tr;
      }
      const { moisture, nutrients, heights, dsmDiff } = soilGrid.getSurfaceData();
      const posAttr = terrainMesh.geometry.attributes.position;
      const colAttr = terrainMesh.geometry.attributes.color;
      const loam = new THREE.Color(0x6e5038), wet = new THREE.Color(0x3a4d5c), rich = new THREE.Color(0x2a5c3a);
      let maxHValue = 0;
      for (let i = 0; i < heights.length; i++) {
        let h = heights[i] * terrainScale;
        const canopyScale = 2.3; 
        if (showDSMOverlay && dsmDiff) h += dsmDiff[i] * canopyScale; 
        
        posAttr.setY(i, h);
        if (h > maxHValue) maxHValue = h;
        
        let c = loam.clone();
        if (soilType === 'clay') c.lerp(new THREE.Color(0x8d5c3a), 0.5);
        if (soilType === 'sand') c.lerp(new THREE.Color(0xc2b280), 0.5);

        if (viewMode === 'moisture') c.lerp(wet, moisture[i]);
        else if (viewMode === 'nutrients') c.lerp(rich, nutrients[i]);
        else {
          // Slight moisture coloring in normal mode for context
          c.lerp(wet, moisture[i] * 0.15);
        }
        colAttr.setXYZ(i, c.r, c.g, c.b);
      }
      posAttr.needsUpdate = true; colAttr.needsUpdate = true;
      terrainMesh.geometry.computeVertexNormals();

      // Rebuild terrain-following underground volume each time heights change.
      // Top vertices match terrain surface exactly (no Z-fight offset needed beyond
      // polygonOffset on the material). Bottom vertices sit at -SOIL_DEPTH.
      if (soilBoxMesh) {
         const SOIL_DEPTH = 60;
         const res = GRID_NX;
         const totalVerts = res * res * 2;
         const vertices = new Float32Array(totalVerts * 3);
         for (let i = 0; i < res * res; i++) {
           const col = i % res, row = Math.floor(i / res);
           const x = (col / (res - 1) - 0.5) * tr * 2;
           const z = (row / (res - 1) - 0.5) * tr * 2;
           const h = (heights[i] * terrainScale) - 0.05; // Slightly below terrain surface
           // top ring
           vertices[i * 3]     = x * 0.99; // Slightly inward to avoid edge fight
           vertices[i * 3 + 1] = h;
           vertices[i * 3 + 2] = z * 0.99;
           // bottom layer
           const b = (res * res + i) * 3;
           vertices[b]     = x * 0.99;
           vertices[b + 1] = -SOIL_DEPTH;
           vertices[b + 2] = z * 0.99;
         }
         const indices = [];
         const off = res * res;
         // curtain walls
         for (let r = 0; r < res - 1; r++) {
           for (let c = 0; c < res - 1; c++) {
             // bottom face only
             const iB = off + r * res + c;
             indices.push(iB, iB + res, iB + 1);
             indices.push(iB + 1, iB + res, iB + res + 1);
           }
         }
         // four curtain sides
         for (let c = 0; c < res - 1; c++) {
           const iT = c, iB = off + c;
           indices.push(iT, iT + 1, iB); indices.push(iT + 1, iB + 1, iB);
         }
         for (let c = 0; c < res - 1; c++) {
           const iT = (res - 1) * res + c, iB = off + iT;
           indices.push(iT, iB, iT + 1); indices.push(iT + 1, iB, iB + 1);
         }
         for (let r = 0; r < res - 1; r++) {
           const iT = r * res, iB = off + iT;
           indices.push(iT, iB, iT + res); indices.push(iT + res, iB, iB + res);
         }
         for (let r = 0; r < res - 1; r++) {
           const iT = r * res + (res - 1), iB = off + iT;
           indices.push(iT, iT + res, iB); indices.push(iT + res, iB + res, iB);
         }
         
         const geo = new THREE.BufferGeometry();
         geo.setAttribute('position', new THREE.BufferAttribute(vertices, 3));
         geo.setIndex(indices);
         geo.computeVertexNormals();
         
         soilBoxMesh.geometry.dispose();
         soilBoxMesh.geometry = geo;
         soilBoxMesh.position.set(0,0,0);
         soilBoxMesh.scale.set(1,1,1);
         
         if (sc.soilBoxFillMesh) {
           sc.soilBoxFillMesh.geometry = geo; // Share geom
           sc.soilBoxFillMesh.position.set(0,0,0);
           sc.soilBoxFillMesh.scale.set(1,1,1);
         }
      }

      if (terrainOrtho && (viewMode === 'realistic' || viewMode === 'normal')) {
        const texLoader = new THREE.TextureLoader();
        texLoader.load(`data:image/jpeg;base64,${terrainOrtho}`, (tex) => {
          tex.colorSpace = THREE.SRGBColorSpace;
          terrainMesh.material.map = tex;
          terrainMesh.material.vertexColors = false;
          terrainMesh.material.color.set(0xffffff);
          terrainMesh.material.needsUpdate = true;
        });
      } else {
        terrainMesh.material.map = null;
        terrainMesh.material.vertexColors = true;
        terrainMesh.material.needsUpdate = true;
      }

      const currentIds = new Set(trees.map(t => t.id));
      for (const [id, entry] of treeGroupsRef.current) {
        if (!currentIds.has(id)) {
          scene.remove(entry.treeGroup);
          if (entry.label?.element) entry.label.element.remove();
          treeGroupsRef.current.delete(id);
        }
      }
      for (const tree of trees) {
        const sp = SPECIES[tree.species];
        if (!sp) continue;
        let entry = treeGroupsRef.current.get(tree.id);
        if (!entry) {
          const isDE = language === 'de';
          const treeGroup = new THREE.Group();
          treeGroup.position.set(tree.position[0], 0, tree.position[1]);
          const canopy = makeCanopy(tree, tree.age, tree.vigor, !isPlaying);
          canopy.traverse(m => { if (m.isMesh) { m.castShadow = true; m.userData.treeId = tree.id; } });
          treeGroup.add(canopy);
          const div = document.createElement('div');
          div.className = 'tree-label-3d';
          const name = isDE ? (sp.nameDE || sp.name) : (sp.nameEN || sp.name);
          div.innerHTML = `<div style="font-weight:800">${name} #${tree.id}</div>`;
          div.style.color = sp.color;
          div.style.opacity = '0'; div.style.transition = 'opacity 0.4s';
          const label = new CSS2DObject(div);
          treeGroup.add(label);
          const rootLines = new THREE.LineSegments(
            buildRootGeometry([], sp.color, tree.position, soilGrid), 
            new THREE.LineBasicMaterial({ vertexColors: true, clippingPlanes: clipPlanes })
          );
          treeGroup.add(rootLines);
          scene.add(treeGroup);
          entry = { treeGroup, canopy, rootLines, label, segCount: 0 };
          treeGroupsRef.current.set(tree.id, entry);
        }
        const ty = soilGrid.getSurfaceHeight(tree.position[0], tree.position[1]);
        entry.treeGroup.position.y = ty * terrainScale;
        if (tree.segments.length !== entry.segCount) {
          entry.rootLines.geometry.dispose();
          entry.rootLines.geometry = buildRootGeometry(tree.segments, sp.color, tree.position, soilGrid, terrainScale);
          entry.segCount = tree.segments.length;
        }
        const ageScale = Math.min(1.0, 0.2 + tree.age * 0.015);
        entry.canopy.scale.set(ageScale, ageScale, ageScale);
        entry.canopy.traverse(m => {
          if (m.isMesh && m.material.color) m.material.color.lerpColors(new THREE.Color(0x8a7d2a), new THREE.Color(sp.canopyColor), tree.vigor);
        });
        const story = simulateGroveGrowth(tree.species, tree.age);
        const segs = renderLSystem(story, 2.2);
        const maxH = Math.max(0.6, ...segs.flatMap(s => [s.start[1], s.end[1]]));
        entry.label.position.set(0, maxH + 0.6, 0);
      }
    }
  }, [trees, time, soilGrid, soilType, location, viewMode, terrainScale, fetchRadius, terrainOrtho, terrainMorphedAt, terrainFetchedAt, showXRay, showDSMOverlay, isPlaying]);

  // -- Buildings Overlay (GLB) --------------------------------------â”€
  useEffect(() => {
    const sc = sceneRef.current;
    if (!sc) return;
    const { scene } = sc;
    const old = scene.getObjectByName('glb_buildings_overlay');
    if (old) scene.remove(old);
    if (!buildingModelUrl) return;
    const group = new THREE.Group(); group.name = 'glb_buildings_overlay'; scene.add(group);
    const loader = new GLTFLoader();
    loader.load(buildingModelUrl, (gltf) => {
      const model = gltf.scene;
      if (buildingOrigin3857 && location) {
        const [targetX, targetY] = latLonToWebMerc(location.lat, location.lon);
        const [originX, originY] = buildingOrigin3857;
        model.position.set(originX - targetX, 0, -(originY - targetY));
      }
      model.traverse(node => {
        if (node.isMesh) {
          node.castShadow = true; node.receiveShadow = true;
          node.material = new THREE.MeshStandardMaterial({ color: 0xeeeeee, roughness: 0.8, metalness: 0.1, clippingPlanes: clipPlanes });
          node.userData.isBuilding = true;
        }
      });
      group.add(model); group.visible = showBuildings; model.renderOrder = 20;
    });
  }, [buildingModelUrl, buildingOrigin, location, fetchRadius]);

  // -- Buildings (Footprints) ----------------------------------------
  useEffect(() => {
    const sc = sceneRef.current;
    if (!sc || !buildings || buildings.length === 0 || !buildingOrigin3857) return;
    const { scene } = sc;
    const old = scene.getObjectByName('buildings_overlay');
    if (old) { old.traverse(o => { if (o.geometry) o.geometry.dispose(); if (o.material) o.material.dispose(); }); scene.remove(old); }
    const group = new THREE.Group(); group.name = 'buildings_overlay';
    const [ox, oy] = buildingOrigin3857;
    buildings.forEach(feature => {
      if (!feature.geometry || feature.geometry.type !== 'Polygon') return;
      const coords = feature.geometry.coordinates[0];
      const height = feature.properties.height || 10;
      const shape = new THREE.Shape();
      // Ensure Counter-Clockwise winding for ExtrudeGeometry to be solid
      const area = d3.polygonArea(coords.map(c => [c[0], c[1]]));
      const finalizedCoords = [...coords];
      if (area < 0) finalizedCoords.reverse(); // Standardize to CCW

      let minLX = Infinity, maxLX = -Infinity, minLY = Infinity, maxLY = -Infinity, maxSurf = -Infinity;
      finalizedCoords.forEach(([x, y], i) => {
        const lx = x - ox, ly = y - oy;
        if (i === 0) shape.moveTo(lx, ly); else shape.lineTo(lx, ly);
        if (lx < minLX) minLX = lx; if (lx > maxLX) maxLX = lx;
        if (ly < minLY) minLY = ly; if (ly > maxLY) maxLY = ly;
        if (soilGrid) { const sY = soilGrid.getSurfaceHeight(lx, -ly) || 0; if (sY > maxSurf) maxSurf = sY; }
      });
      if (maxSurf === -Infinity) maxSurf = 0;
      
      const foundation = 25, bH = feature.properties.GEBAEUDEH || feature.properties.gebaeudeh || feature.properties.height || 10;
      const geo = new THREE.ExtrudeGeometry(shape, { depth: bH + foundation, bevelEnabled: false });
      const pos = geo.attributes.position, uvs = geo.attributes.uv, wh = fetchRadius;
      for (let i = 0; i < pos.count; i++) {
        uvs.setXY(i, (pos.getX(i) / wh + 1) * 0.5, (pos.getY(i) / wh + 1) * 0.5);
      }
      uvs.needsUpdate = true;
      const initialMap = (showTexturedBuildings && terrainOrtho && viewMode === 'normal') ? sc.terrainMesh?.material?.map : null;
      const mesh = new THREE.Mesh(geo, new THREE.MeshStandardMaterial({ 
        color: 0xcccccc, roughness: 0.8, map: initialMap, clippingPlanes: clipPlanes,
        side: THREE.FrontSide, // Use FrontSide for solid appearance
        depthWrite: true,
        transparent: false 
      }));
      // Add a separate backface mesh or just use DoubleSide with proper caps
      // The user wants them NOT open - so we must ensure they are truly capped.
      // We will add a bottom and top cap explicitly if needed, but ExtrudeGeometry should have them.
      // THE FIX for "open from one side" is often Z-fighting or winding. 
      // We'll set depthWrite and Ensure they are in the correct render order.
      const centerX = (minLX + maxLX) / 2, centerZ = -(minLY + maxLY) / 2;
      if (Math.abs(centerX) > fetchRadius || Math.abs(centerZ) > fetchRadius) { geo.dispose(); return; }
      mesh.rotation.x = -Math.PI / 2;
      mesh.position.y = maxSurf * terrainScale - foundation;
      mesh.castShadow = true; mesh.receiveShadow = true; mesh.renderOrder = 20;
      mesh.userData = { isBuilding: true, id: feature.id || feature.properties?.OBJECTID };
      group.add(mesh);
    });
    scene.add(group);
  }, [buildings, buildingOrigin3857, terrainScale, terrainFetchedAt, soilGrid, fetchRadius, showBuildings]);

  useEffect(() => {
    const sc = sceneRef.current;
    if (!sc) return;
    const group = sc.scene.getObjectByName('buildings_overlay');
    if (!group) return;
    group.visible = showBuildings;
    if (!showBuildings) return;
    const orthoMap = (showTexturedBuildings && terrainOrtho && (viewMode === 'realistic' || viewMode === 'normal')) ? sc.terrainMesh.material.map : null;
    group.traverse(o => { if (o.isMesh && o.material) { o.material.map = orthoMap; o.material.needsUpdate = true; } });
  }, [showBuildings, showTexturedBuildings, terrainOrtho, viewMode]);

  // -- Interaction Zones --------------------------------------------â”€
  useEffect(() => {
    const sc = sceneRef.current;
    if (!sc) return;
    const { scene } = sc;
    const toRemove = [];
    scene.traverse(o => { if (o.userData.isZone) toRemove.push(o); });
    toRemove.forEach(o => scene.remove(o));
    competitionZones.forEach(z => {
      const mesh = new THREE.Mesh(new THREE.SphereGeometry(0.5, 16, 12), new THREE.MeshBasicMaterial({ color: 0xff4400, transparent: true, opacity: 0.3 }));
      mesh.position.set(z.position[0], z.position[1], z.position[2]);
      mesh.userData = { isZone: true, isCompetitionZone: true };
      scene.add(mesh);
    });
    graftZones.forEach(z => {
      const mesh = new THREE.Mesh(new THREE.IcosahedronGeometry(0.15, 0), new THREE.MeshBasicMaterial({ color: 0xffd700 }));
      mesh.position.set(z.position[0], z.position[1], z.position[2]);
      mesh.userData = { isZone: true, isGraftSpark: true };
      scene.add(mesh);
    });
  }, [competitionZones, graftZones]);

  const renderLegend = () => {
    if (!showStressViz && !showGreenViz && !showGroundMask) return null;
    if (!isLegendOpen) {
      return (
        <button 
          onClick={() => setIsLegendOpen(true)} 
          style={{ position: 'absolute', bottom: '24px', right: '16px', backgroundColor: 'rgba(21,23,26,0.92)', color: 'white', width: '30px', height: '30px', borderRadius: '10px', border: '1px solid rgba(255,255,255,0.12)', fontSize: '14px', backdropFilter: 'blur(10px)', cursor: 'pointer', pointerEvents: 'auto', zIndex: 1000, display: 'flex', alignItems: 'center', justifyContent: 'center' }}
          title="Map Legend"
        >
          ●
        </button>
      );
    }
    const isDE = language === 'de';
    return (
      <div onClick={() => setIsLegendOpen(false)} style={{ position: 'absolute', bottom: '24px', right: '16px', backgroundColor: 'rgba(15,17,20,0.95)', color: 'white', padding: '10px', borderRadius: '12px', border: '1px solid rgba(255,255,255,0.12)', fontSize: '8px', fontFamily: '"Outfit", sans-serif', backdropFilter: 'blur(12px)', boxShadow: '0 8px 32px rgba(0,0,0,0.6)', pointerEvents: 'auto', display: 'flex', flexDirection: 'column', gap: '10px', minWidth: '140px', zIndex: 1000, cursor: 'pointer' }}>
        {showStressViz && (<div style={{ display: 'flex', flexDirection: 'column', gap: '3px' }}><div style={{ fontWeight: 700, color: '#f1c40f', textTransform: 'uppercase', letterSpacing: '0.5px', fontSize: '8px', opacity: 0.9 }}>{isDE ? 'Umweltstress' : 'Env Stress'}</div><div style={{ height: '5px', width: '100%', background: 'linear-gradient(to right, #1b8c2e, #f1c40f, #e74c3c)', borderRadius: '2px' }} /><div style={{ display: 'flex', justifyContent: 'space-between', opacity: 0.6, fontSize: '7px' }}><span>{isDE ? 'Gering' : 'Low'}</span><span>{isDE ? 'Kritisch' : 'Crit'}</span></div></div>)}
        {showGreenViz && (<div style={{ display: 'flex', flexDirection: 'column', gap: '3px' }}><div style={{ fontWeight: 700, color: '#2ecc71', textTransform: 'uppercase', letterSpacing: '0.5px', fontSize: '8px', opacity: 0.9 }}>{isDE ? 'Kronendichte' : 'Canopy Coverage'}</div><div style={{ height: '5px', width: '100%', background: 'linear-gradient(to right, #cdb982, #2ecc71, #1e8449)', borderRadius: '2px' }} /><div style={{ display: 'flex', justifyContent: 'space-between', opacity: 0.6, fontSize: '7px' }}><span>{isDE ? 'Licht' : 'Sparse'}</span><span>{isDE ? 'Dicht' : 'Dense'}</span></div></div>)}
        {showGroundMask && (<div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}><div style={{ fontWeight: 700, color: '#bdc3c7', textTransform: 'uppercase', letterSpacing: '0.5px', fontSize: '8px', opacity: 0.9 }}>{isDE ? 'Oberfläche' : 'Surface'}</div><div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '3px' }}><div style={{ display: 'flex', alignItems: 'center', gap: '4px' }}><div style={{ width: '6px', height: '6px', backgroundColor: '#130f40', borderRadius: '1.5px' }}/> {isDE ? 'Geb' : 'Bldg'}</div><div style={{ display: 'flex', alignItems: 'center', gap: '4px' }}><div style={{ width: '6px', height: '6px', backgroundColor: '#1c1c1c', borderRadius: '1.5px' }}/> {isDE ? 'Str' : 'Road'}</div><div style={{ display: 'flex', alignItems: 'center', gap: '4px' }}><div style={{ width: '6px', height: '6px', backgroundColor: '#0097e6', borderRadius: '1.5px' }}/> {isDE ? 'Wasser' : 'Water'}</div><div style={{ display: 'flex', alignItems: 'center', gap: '4px' }}><div style={{ width: '6px', height: '6px', backgroundColor: '#5d4037', borderRadius: '1.5px' }}/> {isDE ? 'Boden' : 'Soil'}</div></div></div>)}
      </div>
    );
  };

  // -- Candidate Pin ------------------------------------------------
  const candidateLocation = useSimStore(s => s.candidateLocation);
  useEffect(() => {
    const sc = sceneRef.current;
    if (!sc) return;
    const { scene } = sc;
    const old = scene.getObjectByName('candidate_pin');
    if (old) scene.remove(old);
    if (!candidateLocation) return;
    const { soilGrid: sg, terrainScale: ts } = useSimStore.getState();
    const surfY = sg ? sg.getSurfaceHeight(candidateLocation.x, candidateLocation.z) * ts : 0;
    const group = new THREE.Group(); group.name = 'candidate_pin';
    group.position.set(candidateLocation.x, surfY + 0.3, candidateLocation.z);
    const sphereGeo = new THREE.SphereGeometry(0.4, 16, 16);
    const sphereMat = new THREE.MeshBasicMaterial({ color: 0x2ecc71, transparent: true, opacity: 0.9, depthTest: false });
    sphereMat.userData = { isPinCore: true };
    const sphere = new THREE.Mesh(sphereGeo, sphereMat); sphere.userData.isCandidatePin = true; group.add(sphere);
    const haloGeo = new THREE.RingGeometry(0.6, 1.0, 32);
    const haloMat = new THREE.MeshBasicMaterial({ color: 0x2ecc71, transparent: true, opacity: 0.35, side: THREE.DoubleSide, depthTest: false });
    const halo = new THREE.Mesh(haloGeo, haloMat); halo.rotation.x = -Math.PI / 2; halo.userData.isCandidatePin = true; group.add(halo);
    const pts = [new THREE.Vector3(0, 0, 0), new THREE.Vector3(0, -surfY - 0.3, 0)];
    const stem = new THREE.Line(new THREE.BufferGeometry().setFromPoints(pts), new THREE.LineBasicMaterial({ color: 0x2ecc71, transparent: true, opacity: 0.4, depthTest: false }));
    stem.userData.isCandidatePin = true; group.add(stem);
    group.renderOrder = 30; scene.add(group);
  }, [candidateLocation, terrainScale]);

  // -- Accepted Pins Overlay ------------------------------------------
  useEffect(() => {
    const sc = sceneRef.current;
    if (!sc) return;
    const { scene } = sc;
    const old = scene.getObjectByName('accepted_pins_layer');
    if (old) {
      old.traverse(o => { 
        if (o.geometry) o.geometry.dispose(); 
        if (o.material) {
          if (Array.isArray(o.material)) o.material.forEach(m => m.dispose());
          else o.material.dispose();
        }
        if (o.isCSS2DObject) o.element.remove();
      });
      scene.remove(old);
    }
    if (!acceptedPins || acceptedPins.length === 0) return;

    const group = new THREE.Group();
    group.name = 'accepted_pins_layer';
    scene.add(group);

    acceptedPins.forEach(pin => {
      const pinGeo = new THREE.OctahedronGeometry(1.2, 0);
      const pinMat = new THREE.MeshStandardMaterial({ 
        color: 0x00d2ff, emissive: 0x00d2ff, emissiveIntensity: 2.0, 
        transparent: true, opacity: 0.9,
        depthTest: false,
        clippingPlanes: clipPlanes
      });
      const pinMesh = new THREE.Mesh(pinGeo, pinMat);
      
      const gy = (soilGrid ? soilGrid.getSurfaceHeight(pin.x, pin.z) : 0) * terrainScale;
      
      // Calculate dynamic height relative to growth:
      const simResults = urbanRootSimRef.current;
      const tData = simResults?.treeData?.find(t => Math.abs(t.x - pin.x) < 0.2 && Math.abs(t.z - pin.z) < 0.2);
      
      let pOffset = 12; // default high offset
      if (tData) {
        const age = Math.max(0, rootSimYear - tData.plantYear);
        const progress = Math.min(1.0, age / 65);
        const gs = 0.15 + 0.85 * Math.pow(progress, 0.45);
        const treeH = (tData.height || 10) * gs;
        pOffset = Math.max(12, treeH + 4);
      }

      pinMesh.position.set(pin.x, gy + pOffset, pin.z);
      pinMesh.renderOrder = 100;
      pinMesh.userData = { isAcceptedPin: true, ...pin };
      group.add(pinMesh);

      // Label - avoid redundant species name if pin.label is generic enough
      const div = document.createElement('div');
      div.className = 'accepted-pin-label';
      div.style.background = 'rgba(21,23,26,0.92)';
      div.style.padding = '4px 10px';
      div.style.borderRadius = '8px';
      div.style.border = '1px solid #00d2ff';
      div.style.color = '#fff';
      div.style.fontSize = '9px';
      div.style.whiteSpace = 'nowrap';
      div.style.backdropFilter = 'blur(10px)';
      div.innerHTML = `<div style="font-weight:900;color:#00d2ff">📍 ${pin.label}</div><div style="font-size:7px;opacity:0.8">${pin.species} (${Math.round(pin.overall*100)}%)</div>`;
      const label = new CSS2DObject(div);
      label.position.set(0, 3, 0);
      pinMesh.add(label);

      // Shaft - variable length to ground
      const shaftGeo = new THREE.CylinderGeometry(0.08, 0.08, pOffset);
      const shaftMat = new THREE.MeshBasicMaterial({ color: 0x00d2ff, transparent: true, opacity: 0.4, depthTest: false });
      const shaft = new THREE.Mesh(shaftGeo, shaftMat);
      shaft.position.y = -pOffset / 2;
      pinMesh.add(shaft);
    });
  }, [acceptedPins, soilGrid, terrainScale, rootSimYear, rootSimVersion]);


  return (
    <div style={{ width: '100%', height: '100%', position: 'relative', overflow: 'hidden' }}>
      <div ref={containerRef} style={{ width: '100%', height: '100%', cursor: (placingTree || candidatePlantMode) ? 'crosshair' : 'default' }} />
      {placingTree && <div className="canvas-placing-hint">Placing {SPECIES[selectedSpecies]?.name}</div>}
      {candidatePlantMode && <div className="canvas-placing-hint" style={{ background: '#217346', color: '#ffffff', border: '1px solid #2ecc71', boxShadow: '0 4px 20px rgba(0,0,0,0.5)' }}>Click terrain to place viability pin</div>}
      
      {loadingGIS && (
        <div className="neural-loading-overlay" style={{
          position: 'absolute', top: 0, left: 0, width: '100%', height: '100%',
          display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
          background: 'radial-gradient(circle at center, #1b212c 0%, #0d1117 100%)',
          zIndex: 5000, pointerEvents: 'auto', backdropFilter: 'blur(20px)'
        }}>
          <div className="neural-node-pulse" />
          <div style={{ color: 'var(--accent)', fontSize: '11px', fontWeight: 850, letterSpacing: '2px', textTransform: 'uppercase', marginTop: '30px' }}>
            {language === 'en' ? 'FETCHING GIS DATA...' : 'GIS-DATEN WERDEN ABGEFRAGT...'}
          </div>
          <div style={{ color: 'var(--text-dim)', fontSize: '8px', fontWeight: 600, letterSpacing: '1px', textTransform: 'uppercase', marginTop: '8px', opacity: 0.7 }}>
            {language === 'en' ? 'SYNCING URBAN BIO-DYNAMICS NODES...' : 'KNOTENPUNKTE DER STADT-BIO-DYNAMIK WERDEN SYNCED'}
          </div>
          
          <style>{`
            .neural-node-pulse {
              width: 60px; height: 60px; border-radius: 50%;
              background: var(--accent);
              box-shadow: 0 0 40px var(--accent);
              animation: neuralPulse 1.5s infinite ease-in-out;
            }
            @keyframes neuralPulse {
              0% { transform: scale(0.85); opacity: 0.4; }
              50% { transform: scale(1.1); opacity: 0.8; box-shadow: 0 0 60px var(--accent); }
              100% { transform: scale(0.85); opacity: 0.4; }
            }
          `}</style>
        </div>
      )}

      {renderLegend()}
    </div>
  );
}
