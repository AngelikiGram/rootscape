import { SPECIES_NORMS, CONSTRAINT_WEIGHTS } from '../data/speciesNorms.js';

const EARTH_RADIUS = 6378137;
function latLonToWebMerc(lat, lon) {
  const x = lon * (Math.PI / 180) * EARTH_RADIUS;
  const y = Math.log(Math.tan((90 + lat) * (Math.PI / 360))) * EARTH_RADIUS;
  return [x, y];
}

// ── Geometry helpers ─────────────────────────────────────────────────────────

function ptSegDist2D(px, py, ax, ay, bx, by) {
  const dx = bx - ax, dy = by - ay;
  const len2 = dx * dx + dy * dy;
  if (len2 === 0) return Math.hypot(px - ax, py - ay);
  const t = Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / len2));
  return Math.hypot(px - (ax + t * dx), py - (ay + t * dy));
}

function ptInRing(px, py, ring) {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const xi = ring[i][0], yi = ring[i][1];
    const xj = ring[j][0], yj = ring[j][1];
    if (((yi > py) !== (yj > py)) && px < ((xj - xi) * (py - yi)) / (yj - yi) + xi)
      inside = !inside;
  }
  return inside;
}

function ptPolyDist(px, py, ring) {
  if (ptInRing(px, py, ring)) return 0;
  let minD = Infinity;
  for (let i = 0; i < ring.length - 1; i++) {
    const d = ptSegDist2D(px, py, ring[i][0], ring[i][1], ring[i + 1][0], ring[i + 1][1]);
    if (d < minD) minD = d;
  }
  return minD;
}

// ── Distance computations ────────────────────────────────────────────────────

function nearestBuildingDist(px, py, buildings) {
  let minD = Infinity;
  for (const b of buildings) {
    const rings = b.geometry?.type === 'Polygon' ? b.geometry.coordinates
      : b.geometry?.type === 'MultiPolygon' ? b.geometry.coordinates.flat(1) : null;
    if (!rings) continue;
    for (const ring of rings) {
      const d = ptPolyDist(px, py, ring);
      if (d < minD) minD = d;
    }
  }
  return minD === Infinity ? 999 : minD;
}

function nearestUbahnDist(px, py, undergroundData) {
  let minD = Infinity;
  for (const f of (undergroundData?.ubahn_lines?.features || [])) {
    const lines = f.geometry?.type === 'LineString' ? [f.geometry.coordinates]
      : f.geometry?.type === 'MultiLineString' ? f.geometry.coordinates : [];
    for (const line of lines)
      for (let i = 0; i < line.length - 1; i++) {
        const d = ptSegDist2D(px, py, line[i][0], line[i][1], line[i+1][0], line[i+1][1]);
        if (d < minD) minD = d;
      }
  }
  for (const f of (undergroundData?.ubahn_stats?.features || [])) {
    const c = f.geometry?.coordinates;
    if (c) { const d = Math.hypot(px - c[0], py - c[1]); if (d < minD) minD = d; }
  }
  return minD === Infinity ? 999 : minD;
}

function nearestTreeDist(pt, trees, urbanTrees, origin3857) {
  let minD2 = Infinity, nearestRadius = 4;
  for (const t of (trees || [])) {
    if (!t.position) continue;
    const d2 = (pt.x - t.position[0]) ** 2 + (pt.z - t.position[1]) ** 2;
    if (d2 < minD2) { minD2 = d2; nearestRadius = SPECIES_NORMS[t.species]?.canopyRadius || 4; }
  }
  if (urbanTrees && origin3857) {
    const [ox, oy] = origin3857;
    for (const ut of urbanTrees) {
      if (!ut.geometry?.coordinates) continue;
      const [lon, lat] = ut.geometry.coordinates;
      const [wx, wy] = latLonToWebMerc(lat, lon);
      const lx = wx - ox, lz = -(wy - oy);
      const dx = pt.x - lx, dz = pt.z - lz;
      if (Math.abs(dx) > 40 || Math.abs(dz) > 40) continue;
      const d2 = dx * dx + dz * dz;
      if (d2 < minD2) {
        minD2 = d2;
        nearestRadius = (ut.properties?.KRONENDURCHMESSER || ut.properties?.BAUMHOEHE || 8) / 2;
      }
    }
  }
  return { dist: minD2 === Infinity ? 999 : Math.sqrt(minD2), radius: nearestRadius };
}

function nearestPavementDist(px, py, pavements) {
  let minD = Infinity;
  for (const pave of (pavements || [])) {
    const pts = pave.nodes || [];
    for (let i = 0; i < pts.length - 1; i++) {
      const d = ptSegDist2D(px, py, pts[i][0], pts[i][1], pts[i+1][0], pts[i+1][1]);
      if (d < minD) minD = d;
    }
  }
  return minD === Infinity ? 999 : minD;
}

function estimateSealing(px, py, pavements, buildings) {
  for (const b of (buildings || [])) {
    const rings = b.geometry?.type === 'Polygon' ? b.geometry.coordinates
      : b.geometry?.type === 'MultiPolygon' ? b.geometry.coordinates.flat(1) : [];
    for (const ring of rings) if (ptInRing(px, py, ring)) return 100;
  }
  const RADIUS = 8;
  let nearbyLength = 0;
  for (const pave of (pavements || [])) {
    const pts = pave.nodes || [];
    for (let i = 0; i < pts.length - 1; i++) {
      if (ptSegDist2D(px, py, pts[i][0], pts[i][1], pts[i+1][0], pts[i+1][1]) < RADIUS)
        nearbyLength += Math.hypot(pts[i+1][0] - pts[i][0], pts[i+1][1] - pts[i][1]);
    }
  }
  return Math.min(100, nearbyLength * 1.6);
}

// Approximate shade fraction from building heights + proximity
function estimateShadeFraction(px, py, buildings) {
  let maxShade = 0;
  for (const b of (buildings || [])) {
    const h = b.properties?.GEBAEUDEH || b.properties?.gebaeudeh || b.properties?.height || 10;
    const rings = b.geometry?.type === 'Polygon' ? b.geometry.coordinates
      : b.geometry?.type === 'MultiPolygon' ? b.geometry.coordinates.flat(1) : [];
    for (const ring of rings) {
      const d = ptPolyDist(px, py, ring);
      if (d < 30) {
        const shade = Math.min(0.9, (Number(h) / (d + 3)) * 0.28);
        if (shade > maxShade) maxShade = shade;
      }
    }
  }
  return maxShade;
}

// ── Score helpers ────────────────────────────────────────────────────────────

const ceilingScore = (val, maxOk, tol) => val <= maxOk ? 1 : Math.max(0, 1 - (val - maxOk) / tol);
const bellScore    = (val, opt, tol)   => Math.max(0, 1 - Math.abs(val - opt) / tol);
const floorScore   = (dist, minOk, tol) =>
  dist >= minOk + tol ? 1 : dist <= minOk ? 0 : (dist - minOk) / tol;

// ── Intervention generation ──────────────────────────────────────────────────

function buildIntervention(worstKey, constraints, norm, allResults, currentKey) {
  const c = constraints[worstKey];
  let suggestion = null;

  switch (worstKey) {
    case 'treeDist': {
      const dist = c.value;
      const needed = norm.treeDist.min_ok;
      suggestion = dist < needed
        ? `Relocate pin ${Math.ceil(needed - dist + 2)}m to increase tree spacing`
        : `${dist}m is borderline — consider species with smaller canopy`;
      break;
    }
    case 'sealing':
      suggestion = 'Install tree grate or structural soil pit to reduce effective sealing';
      break;
    case 'buildingDist': {
      const gap = norm.buildingDist.min_ok - (c.value || 0);
      suggestion = gap > 0
        ? `Move pin ${Math.ceil(gap + 2)}m from building facade`
        : 'Check root barrier requirements near building';
      break;
    }
    case 'ubahnDist':
      suggestion = 'Check utility exclusion zone — coordinate with Wiener Linien';
      break;
    case 'shade':
      suggestion = 'Limited solar radiation — prefer shade-tolerant species';
      break;
    case 'groundwater':
      suggestion = 'Match species to water table — check eHYD seasonal data';
      break;
    case 'moisture':
      suggestion = 'Soil moisture mismatch — consider irrigation or drainage';
      break;
    case 'rootSpace':
      suggestion = 'High rock fragment volume — use structural soil mix';
      break;
    default:
      suggestion = null;
  }

  const alt = allResults?.find(r => r.key !== currentKey && r.result?.overall > 0);
  const altText = alt ? `${alt.norm.nameDE} (${Math.round(alt.result.overall * 100)}%)` : null;

  return { suggestion, alternative: altText };
}

// ── Main export ──────────────────────────────────────────────────────────────

export function computeViability(candidatePt, soilMeta, buildings, origin3857, undergroundData, pavements, existingTrees, urbanTrees, speciesKey, allResults) {
  const norm = SPECIES_NORMS[speciesKey];
  if (!norm) return null;

  const [ox, oy] = origin3857 || [0, 0];
  const px = ox + candidatePt.x;
  const py = oy - candidatePt.z;

  const bldgs = buildings || [];
  const paves = pavements  || [];

  // ── 10 Constraint Scores ─────────────────────────────────────────────────
  const sealingPct   = origin3857 ? estimateSealing(px, py, paves, bldgs) : 35;
  const sealingScore = ceilingScore(sealingPct, norm.sealing.max_ok, norm.sealing.tolerance);

  const clay = soilMeta?.clay_pct ?? 25;
  const clayScore = bellScore(clay, norm.clay.optimal, norm.clay.tolerance);

  const fc = soilMeta?.field_capacity ?? 0.55;
  const moistureScore = bellScore(fc, norm.moisture.optimal, norm.moisture.tolerance);

  const bDist = origin3857 && bldgs.length ? nearestBuildingDist(px, py, bldgs) : 15;
  const buildingScore = floorScore(bDist, norm.buildingDist.min_ok, norm.buildingDist.tolerance);

  const uDist = origin3857 ? nearestUbahnDist(px, py, undergroundData) : 25;
  const ubahnScore = floorScore(uDist, norm.ubahnDist.min_ok, norm.ubahnDist.tolerance);

  // Use species min_ok directly — Vienna street trees are 6–10m apart by design
  const { dist: tDist, radius: neighborRadius } = nearestTreeDist(candidatePt, existingTrees, urbanTrees, origin3857);
  const treeDistScore = floorScore(tDist, norm.treeDist.min_ok, norm.treeDist.tolerance);

  const ph = soilMeta?.ph ?? 7.0;
  const phScore = bellScore(ph, norm.ph.optimal, norm.ph.tolerance);

  const shadeFrac = origin3857 ? estimateShadeFraction(px, py, bldgs) : 0.2;
  const shadeScore = bellScore(shadeFrac, norm.shade.optimal, norm.shade.tolerance);

  const gwDepth = soilMeta?.groundwater_depth_m ?? (0.5 + (1 - fc) * 3.5);
  const groundwaterScore = bellScore(gwDepth, norm.groundwater.optimal, norm.groundwater.tolerance);

  const cfvo = soilMeta?.cfvo_pct ?? 12;
  const rootSpaceScore = ceilingScore(cfvo, norm.rootSpace.min_ok, norm.rootSpace.tolerance);

  // ── Structural checks ─────────────────────────────────────────────────────
  const isBuilding     = bDist < 0.25;
  const pavDist        = origin3857 ? nearestPavementDist(px, py, paves) : 999;
  const isOnPavement   = pavDist < 2.5;
  const isHighSealing  = sealingPct > 92;
  const isTreeConflict = tDist < neighborRadius * 0.8;

  // ── Weighted total ────────────────────────────────────────────────────────
  const W = CONSTRAINT_WEIGHTS;
  let overall =
    W.sealing      * sealingScore +
    W.clay         * clayScore +
    W.moisture     * moistureScore +
    W.buildingDist * buildingScore +
    W.ubahnDist    * ubahnScore +
    W.treeDist     * treeDistScore +
    W.ph           * phScore +
    W.shade        * shadeScore +
    W.groundwater  * groundwaterScore +
    W.rootSpace    * rootSpaceScore;

  const isRoad = isOnPavement || isHighSealing;
  if (isBuilding || isRoad || isTreeConflict) overall = 0;

  const constraints = {
    sealing:      { score: sealingScore,     value: Math.round(sealingPct), label: isOnPavement ? `Road surface (${pavDist.toFixed(1)}m from centre)` : isHighSealing ? 'Sealed >92%' : `${Math.round(sealingPct)}% sealed` },
    clay:         { score: clayScore,        value: clay,                   label: `${Math.round(clay)}% clay` },
    moisture:     { score: moistureScore,    value: fc,                     label: `FC ${fc.toFixed(2)}` },
    buildingDist: { score: buildingScore,    value: Math.round(bDist),      label: isBuilding ? 'Inside building' : `${bDist.toFixed(0)}m to building` },
    ubahnDist:    { score: ubahnScore,       value: Math.round(uDist),      label: `${uDist.toFixed(0)}m to U-Bahn` },
    treeDist:     { score: treeDistScore,    value: Math.round(tDist),      label: isTreeConflict ? `Canopy overlap (${tDist.toFixed(1)}m < ${(neighborRadius*0.8).toFixed(1)}m)` : `${tDist.toFixed(0)}m to nearest tree` },
    ph:           { score: phScore,          value: ph,                     label: `pH ${ph.toFixed(1)}` },
    shade:        { score: shadeScore,       value: shadeFrac,              label: `${Math.round(shadeFrac * 100)}% shade fraction` },
    groundwater:  { score: groundwaterScore, value: gwDepth,                label: `${gwDepth.toFixed(1)}m GW depth` },
    rootSpace:    { score: rootSpaceScore,   value: cfvo,                   label: `cfvo ${Math.round(cfvo)}%` },
  };

  let worstKey = Object.entries(constraints).sort((a, b) => a[1].score - b[1].score)[0][0];
  if (isBuilding)      worstKey = 'buildingDist';
  else if (isRoad)     worstKey = 'sealing';
  else if (isTreeConflict) worstKey = 'treeDist';

  const fatalType = isBuilding ? 'building' : isRoad ? 'road' : isTreeConflict ? 'tree' : null;
  const intervention = buildIntervention(worstKey, constraints, norm, allResults, speciesKey);

  return { overall, constraints, worstKey, isFatal: fatalType !== null, fatalType, intervention, shadeFrac };
}

export function computeAllViabilities(candidatePt, soilMeta, buildings, origin3857, undergroundData, pavements, existingTrees, urbanTrees) {
  const first = Object.keys(SPECIES_NORMS)
    .map(key => ({ key, norm: SPECIES_NORMS[key], result: computeViability(candidatePt, soilMeta, buildings, origin3857, undergroundData, pavements, existingTrees, urbanTrees, key, null) }))
    .filter(r => r.result !== null)
    .sort((a, b) => b.result.overall - a.result.overall);

  // Re-run with ranked list available for alternative suggestions
  return first
    .map(r => ({ ...r, result: computeViability(candidatePt, soilMeta, buildings, origin3857, undergroundData, pavements, existingTrees, urbanTrees, r.key, first) }))
    .sort((a, b) => b.result.overall - a.result.overall);
}
