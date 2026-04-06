/**
 * urbanRootSim.js — Rhizomorph-paper root simulation (optimised)
 *
 * Performance design:
 *   - Each tree is simulated in its own isolated loop (no global tip array)
 *   - Hard per-tree segment budget prevents runaway growth
 *   - Obstacle map uses coarse spatial grid for O(1) proximity queries
 *   - Competition uses a shared spatial hash (2 m cells) written per-tree
 *   - No O(n) array scans in the inner loop
 */

import { SPECIES } from './species.js';
import { generateSCA } from './spaceColonization.js';

const EARTH_RADIUS = 6378137;
export function latLonToWebMerc(lat, lon) {
  const x = lon * (Math.PI / 180) * EARTH_RADIUS;
  const y = Math.log(Math.tan((90 + lat) * (Math.PI / 360))) * EARTH_RADIUS;
  return [x, y];
}

function rhash(a, b = 0) {
  const x = Math.sin(a * 127.1 + b * 311.7) * 43758.5453;
  return x - Math.floor(x);
}

// ============================================================================
// SPECIES PARAMETERS
// ============================================================================
export const GENUS_ROOT_PARAMS = {
  quercus:     { g: 0.70, bp: 0.07, nt: 4, la: 0.60, mbd: 3, ss: 0.10, vigor: 28, col: 'tap'     },
  ginkgo:      { g: 0.55, bp: 0.07, nt: 4, la: 0.65, mbd: 2, ss: 0.09, vigor: 24, col: 'tap'     },
  abies:       { g: 0.48, bp: 0.09, nt: 5, la: 0.75, mbd: 3, ss: 0.10, vigor: 26, col: 'tap'     },
  juglans:     { g: 0.65, bp: 0.06, nt: 4, la: 0.60, mbd: 3, ss: 0.11, vigor: 27, col: 'tap'     },

  tilia:       { g: 0.38, bp: 0.09, nt: 6, la: 0.90, mbd: 3, ss: 0.10, vigor: 22, col: 'heart'   },
  acer:        { g: 0.40, bp: 0.10, nt: 6, la: 0.90, mbd: 3, ss: 0.10, vigor: 23, col: 'heart'   },
  fraxinus:    { g: 0.35, bp: 0.08, nt: 5, la: 0.85, mbd: 3, ss: 0.10, vigor: 22, col: 'heart'   },
  carpinus:    { g: 0.42, bp: 0.09, nt: 6, la: 0.80, mbd: 3, ss: 0.09, vigor: 20, col: 'heart'   },
  prunus:      { g: 0.45, bp: 0.10, nt: 5, la: 0.90, mbd: 3, ss: 0.10, vigor: 20, col: 'heart'   },
  sophora:     { g: 0.38, bp: 0.09, nt: 6, la: 0.95, mbd: 3, ss: 0.10, vigor: 22, col: 'heart'   },
  ulmus:       { g: 0.40, bp: 0.10, nt: 6, la: 0.85, mbd: 3, ss: 0.09, vigor: 23, col: 'heart'   },
  celtis:      { g: 0.38, bp: 0.09, nt: 5, la: 0.85, mbd: 3, ss: 0.09, vigor: 19, col: 'heart'   },
  aesculus:    { g: 0.39, bp: 0.09, nt: 6, la: 0.92, mbd: 3, ss: 0.10, vigor: 23, col: 'heart'   },
  corylus:     { g: 0.35, bp: 0.12, nt: 5, la: 0.95, mbd: 3, ss: 0.09, vigor: 18, col: 'heart'   },

  platanus:    { g: 0.16, bp: 0.11, nt: 7, la: 1.35, mbd: 3, ss: 0.12, vigor: 25, col: 'plate'   },
  populus:     { g: 0.20, bp: 0.15, nt: 6, la: 1.20, mbd: 3, ss: 0.11, vigor: 27, col: 'plate'   },
  robinia:     { g: 0.22, bp: 0.12, nt: 6, la: 1.25, mbd: 3, ss: 0.11, vigor: 22, col: 'plate'   },
  gleditsia:   { g: 0.24, bp: 0.11, nt: 6, la: 1.20, mbd: 3, ss: 0.11, vigor: 22, col: 'plate'   },
  salix:       { g: 0.20, bp: 0.16, nt: 6, la: 1.15, mbd: 3, ss: 0.10, vigor: 24, col: 'plate'   },
  alnus:       { g: 0.22, bp: 0.14, nt: 6, la: 1.10, mbd: 3, ss: 0.10, vigor: 23, col: 'plate'   },
  fagus:       { g: 0.14, bp: 0.11, nt: 7, la: 1.40, mbd: 3, ss: 0.10, vigor: 25, col: 'plate'   },
  pinus:       { g: 0.18, bp: 0.13, nt: 6, la: 1.20, mbd: 3, ss: 0.12, vigor: 24, col: 'plate'   },
  picea:       { g: 0.12, bp: 0.13, nt: 7, la: 1.45, mbd: 3, ss: 0.11, vigor: 28, col: 'plate'   },
  betula:      { g: 0.18, bp: 0.20, nt: 8, la: 1.15, mbd: 4, ss: 0.08, vigor: 26, col: 'heart'   },

  larix:       { g: 0.45, bp: 0.09, nt: 5, la: 0.80, mbd: 3, ss: 0.11, vigor: 23, col: 'oblique' },
  pseudotsuga: { g: 0.48, bp: 0.08, nt: 5, la: 0.75, mbd: 3, ss: 0.10, vigor: 24, col: 'oblique' },
};
export const DEFAULT_ROOT_P = { g: 0.40, bp: 0.09, nt: 5, la: 0.85, mbd: 3, ss: 0.10, vigor: 22, col: 'heart' };

export const ROOT_ARCHETYPE_COLORS = {
  tap:     [0.52, 0.32, 0.16],
  heart:   [0.68, 0.47, 0.28],
  plate:   [0.76, 0.58, 0.38],
  oblique: [0.58, 0.38, 0.20],
};
export const DEEP_SOIL_COL  = [0.26, 0.14, 0.07];
export const COMPETITION_COL = [0.90, 0.20, 0.10];
export const GRAFT_COL       = [0.92, 0.72, 0.10];

// ============================================================================
// OBSTACLE MAP — coarse 4 m grid, built once per simulation
// ============================================================================
class ObstacleMap {
  constructor(undergroundData, ox, oy, fetchRadius, soilGrid, terrainScale) {
    this.grid = new Map();
    this.cellSize = 8.0; // 8m grid cells
    this.stations = [];
    if (!undergroundData) return;

    const EX = 1.35;
    const addSeg = (coords, depth, r, latLon) => {
      for (let i = 0; i < coords.length - 1; i++) {
        let lx1, lz1, lx2, lz2;
        if (latLon) {
          let [mx1, my1] = latLonToWebMerc(coords[i][1], coords[i][0]);
          let [mx2, my2] = latLonToWebMerc(coords[i+1][1], coords[i+1][0]);
          lx1 = mx1 - ox; lz1 = -(my1 - oy);
          lx2 = mx2 - ox; lz2 = -(my2 - oy);
        } else {
          lx1 = coords[i][0] - ox; lz1 = -(coords[i][1] - oy);
          lx2 = coords[i+1][0] - ox; lz2 = -(coords[i+1][1] - oy);
        }
        if (Math.abs(lx1) > fetchRadius + r && Math.abs(lx2) > fetchRadius + r) continue;
        const gy1 = (soilGrid ? soilGrid.getSurfaceHeight(lx1, lz1) : 0);
        const gy2 = (soilGrid ? soilGrid.getSurfaceHeight(lx2, lz2) : 0);
        const s = { x1:lx1, y1:gy1+depth*EX, z1:lz1, x2:lx2, y2:gy2+depth*EX, z2:lz2, r2:r*r };
        
        // Add to spatial grid
        const xMin = Math.min(lx1, lx2) - r, xMax = Math.max(lx1, lx2) + r;
        const zMin = Math.min(lz1, lz2) - r, zMax = Math.max(lz1, lz2) + r;
        for (let gx = Math.floor(xMin/this.cellSize); gx <= Math.floor(xMax/this.cellSize); gx++) {
          for (let gz = Math.floor(zMin/this.cellSize); gz <= Math.floor(zMax/this.cellSize); gz++) {
            const key = `${gx},${gz}`;
            if (!this.grid.has(key)) this.grid.set(key, []);
            this.grid.get(key).push(s);
          }
        }
      }
    };

    const processFeatureCollection = (fc, depth, r) => {
      if (!fc?.features) return;
      fc.features.forEach(f => {
        if (!f.geometry) return;
        const t = f.geometry.type;
        if (t === 'LineString') addSeg(f.geometry.coordinates, depth, r, true);
        else if (t === 'MultiLineString') f.geometry.coordinates.forEach(c => addSeg(c, depth, r, true));
      });
    };

    processFeatureCollection(undergroundData.ubahn_lines, -28.0, 3.5);
    processFeatureCollection(undergroundData.sewer_heat,  -18.0, 1.5);

    if (undergroundData.ubahn_stats?.features) {
      undergroundData.ubahn_stats.features.forEach(f => {
        if (!f.geometry || f.geometry.type !== 'Point') return;
        const [wx, wy] = f.geometry.coordinates;
        const lx = wx - ox, lz = -(wy - oy);
        if (Math.abs(lx) > fetchRadius) return;
        const gy = (soilGrid ? soilGrid.getSurfaceHeight(lx, lz) : 0);
        this.stations.push({ x:lx, y:gy - 15*EX, z:lz, r2:144 });
      });
    }
  }

  query(px, py, pz) {
    for (const s of this.stations) {
      const dx=px-s.x, dy=py-s.y, dz=pz-s.z;
      const d2=dx*dx+dy*dy+dz*dz;
      if (d2 < s.r2) { const d=Math.sqrt(d2)||0.001; return { hit:true, rx:dx/d, ry:dy/d, rz:dz/d }; }
    }
    const gx = Math.floor(px/this.cellSize), gz = Math.floor(pz/this.cellSize);
    const cell = this.grid.get(`${gx},${gz}`);
    if (!cell) return { hit:false };

    for (const t of cell) {
      const vx=t.x2-t.x1, vy=t.y2-t.y1, vz=t.z2-t.z1;
      const wx=px-t.x1, wy=py-t.y1, wz=pz-t.z1;
      const c2=vx*vx+vy*vy+vz*vz; 
      if (c2 < 0.0001) continue;
      const b=Math.max(0,Math.min(1,(wx*vx+wy*vy+wz*vz)/c2));
      const dx=px-(t.x1+b*vx), dy=py-(t.y1+b*vy), dz=pz-(t.z1+b*vz);
      const d2=dx*dx+dy*dy+dz*dz;
      if (d2 < t.r2) { const d=Math.sqrt(d2)||0.001; return { hit:true, rx:dx/d, ry:dy/d, rz:dz/d }; }
    }
    return { hit:false };
  }
}

// ============================================================================
// PER-TREE SIMULATION
// ============================================================================
const MAX_SEGS_PER_TREE = 3500; // hard budget — increased for shoot + root combo
const MAX_TIPS_PER_TREE = 45;
const N_STEPS_PER_YEAR  = 2;
const VIGOR_DEPTH_PENALTY = 0.6; // extra vigor cost per branch depth level

function simulateOneTree(info, obstacles, compMap, interactions, soilGrid) {
  const { x, y, z, d, genus, seed, treeId, genus: tGenus } = info;
  const rp   = GENUS_ROOT_PARAMS[genus] || DEFAULT_ROOT_P;
  const stepSz = Math.max(0.05, (d / 2) * rp.ss * 0.28);

  // ── Initialise tips ───────────────────────────────────────────────────────
  const tips = [];
  const nInit = Math.min(MAX_TIPS_PER_TREE, rp.nt + Math.floor(d * 0.15));
  
  // -- Root collar baseline --
  for (let i = 0; i < nInit; i++) {
    const ang = (i / nInit) * Math.PI * 2 + (rhash(seed, i) - 0.5) * 0.4;
    const el  = -(rp.la * (0.15 + rhash(seed+1, i) * 0.55));
    tips.push({
      x, y: y - 0.2, z,
      dx: Math.cos(ang)*Math.cos(el), dy: Math.sin(el), dz: Math.sin(ang)*Math.cos(el),
      bd: 0, age: 0, vigor: rp.vigor * (0.3 + rhash(seed, i) * 1.5)
    });
  }
  if (rp.col === 'tap') {
    tips.push({ x, y: y-0.2, z, dx:0, dy:-1, dz:0, bd:0, age:0, vigor:rp.vigor*(1.5 + rhash(seed, 99)) });
  }

  const segs = [];
  let year = info.plantYear;
  let stepsDone = 0;
  let activeTips = tips.length;

  // ── Growth loop ───────────────────────────────────────────────────────────
  while (activeTips > 0 && segs.length < MAX_SEGS_PER_TREE) {
    const snap = tips.length; // only process tips that existed at start of step
    activeTips = 0;

    for (let ti = 0; ti < snap; ti++) {
      const tip = tips[ti];
      if (tip.vigor <= 0) continue;

      // Vigor decay driven by depth, distance AND soil quality
      const moist = soilGrid ? soilGrid.getMoisture(tip.x, tip.z, tip.y) : 0.8;
      const decayBase = stepSz * (1.0 + tip.bd * VIGOR_DEPTH_PENALTY);
      tip.vigor -= decayBase * (2.0 - moist * 1.5); // bad soil kills roots faster
      if (tip.vigor <= 0) continue;

      // Tropism
      let tX = 0, tZ = 0;
      let mN = soilGrid ? soilGrid.getMoisture(tip.x, tip.z-0.5, tip.y) : 0.5;
      let mS = soilGrid ? soilGrid.getMoisture(tip.x, tip.z+0.5, tip.y) : 0.5;
      let mE = soilGrid ? soilGrid.getMoisture(tip.x+0.5, tip.z, tip.y) : 0.5;
      let mW = soilGrid ? soilGrid.getMoisture(tip.x-0.5, tip.z, tip.y) : 0.5;
      tX = (mE - mW) * 0.3;
      tZ = (mS - mN) * 0.3;

      const gB = rp.g * 0.09;
      let nx = tip.dx * (1-gB) * 0.82 + tX;
      let ny = tip.dy * (1-gB) * 0.82 - gB;
      let nz = tip.dz * (1-gB) * 0.82 + tZ;

      // Noise (Stochastic perturbation)
      const na = rhash(seed + stepsDone*13 + ti*7, ti) * Math.PI * 2;
      const nm = 0.25 * (0.5 + rhash(seed + stepsDone*17, ti*3) * 0.5); 
      nx += Math.cos(na) * nm * (rhash(seed+stepsDone+ti,5) - 0.5);
      nz += Math.sin(na) * nm * (rhash(seed+stepsDone+ti,7) - 0.5);

      let mag = Math.sqrt(nx*nx+ny*ny+nz*nz);
      if (mag < 0.0001) { tip.vigor = 0; continue; }
      nx/=mag; ny/=mag; nz/=mag;

      const ex = tip.x + nx*stepSz;
      const ey = tip.y + ny*stepSz;
      const ez = tip.z + nz*stepSz;

      // Obstacle check
      let sType = 'normal';
      const obs = obstacles.query(ex, ey, ez);
      if (obs.hit) {
        // High stress penalty for structural collision
        const vigorLoss = stepSz * 12;
        tip.vigor -= vigorLoss;
        info.stressAccum += vigorLoss; 
        nx += obs.rx*0.55; ny += obs.ry*0.55; nz += obs.rz*0.55;
        mag = Math.sqrt(nx*nx+ny*ny+nz*nz);
        if (mag > 0.0001) { nx/=mag; ny/=mag; nz/=mag; }
      }

      // Competition / grafting via shared map
      const ck = `${Math.floor(ex/2)},${Math.floor(ey/2)},${Math.floor(ez/2)}`;
      const other = compMap.get(ck);
      if (other && other.treeId !== treeId) {
        if (other.genus === genus) {
          sType = 'graft';
          tip.vigor = 0; // fuse — beneficial, no stress
          interactions.push({ type:'graft', position:[ex,ey,ez], treeIds:[treeId,other.treeId], year,
            description:`Root fusion (${genus}) between ${treeId} & ${other.treeId}` });
        } else {
          sType = 'competition';
          const compLoss = stepSz * 4;
          tip.vigor -= compLoss;
          info.stressAccum += compLoss; // Biological stress from resource competition
          interactions.push({ type:'competition', position:[ex,ey,ez], treeIds:[treeId,other.treeId], year,
            description:`Root competition: ${genus} vs ${other.genus}` });
        }
      } else if (!other) {
        compMap.set(ck, { treeId, genus });
      }

      // Segment thickness taper: shoots need slightly thicker structural bases
      const thickness = Math.max(0.015, 0.08 * Math.exp(-tip.bd * 0.35));
      segs.push({ start:[tip.x,tip.y,tip.z], end:[ex,ey,ez], year, depth:tip.bd,
                  treeId, type:sType, col:rp.col, thickness });

      if (tip.vigor > 0) {
        tip.x=ex; tip.y=ey; tip.z=ez;
        tip.dx=nx; tip.dy=ny; tip.dz=nz;
        tip.age++;
        activeTips++;

        // Branching
        if (tip.bd < rp.mbd && tips.length < MAX_TIPS_PER_TREE) {
          const apical = Math.exp(-Math.max(0, 4 - tip.age) * 0.5);
          if (rhash(seed+stepsDone*19+ti, tip.age*23) < rp.bp * apical) {
            const hLen = Math.sqrt(nx*nx+nz*nz);
            const px2 = hLen>0.01 ? -nz/hLen : 1;
            const pz2 = hLen>0.01 ?  nx/hLen : 0;
            const bAng = (0.45 + rhash(seed+stepsDone*21,ti*27)*0.55) * Math.PI*0.5;
            const bSgn = rhash(seed+stepsDone*23,ti*29)>0.5 ? 1 : -1;
            let bdx=nx*Math.cos(bAng)+px2*bSgn*Math.sin(bAng);
            let bdy=ny*Math.cos(bAng)-0.07;
            let bdz=nz*Math.cos(bAng)+pz2*bSgn*Math.sin(bAng);
            const bm=Math.sqrt(bdx*bdx+bdy*bdy+bdz*bdz);
            tips.push({ x:ex,y:ey,z:ez, dx:bdx/bm,dy:bdy/bm,dz:bdz/bm,
                         bd:tip.bd+1, age:0, vigor:tip.vigor*0.75 });
            tip.vigor *= 0.72; // conserve energy on branch
          }
        }
      }
    }

    stepsDone++;
    if (stepsDone % N_STEPS_PER_YEAR === 0) year++;
  }

  return segs;
}

// ============================================================================
// MAIN ENTRY
// ============================================================================
const MAX_SIM_TREES = 2000;

export function buildUrbanRootSimulation({
  urbanTrees   = [],
  plannerTrees = [],
  buildingOrigin3857,
  soilGrid,
  terrainScale  = 1,
  fetchRadius   = 200,
  undergroundData = {},
}) {
  if (!buildingOrigin3857) return null;
  const [ox, oy] = buildingOrigin3857;
  const CURRENT_YEAR = new Date().getFullYear();

  const obstacles = new ObstacleMap(undergroundData, ox, oy, fetchRadius, soilGrid, terrainScale);
  const compMap   = new Map(); // shared spatial competition grid
  const interactions = [];

  // ── Collect tree definitions ──────────────────────────────────────────────
  const treeDefs = [];

  let simCount = 0;
  for (const tree of (urbanTrees || [])) {
    if (simCount >= MAX_SIM_TREES) break;
    if (!tree.geometry?.coordinates) continue;
    const [lon, lat] = tree.geometry.coordinates;
    const [wx, wy]   = latLonToWebMerc(lat, lon);
    const lx = wx - ox, lz = -(wy - oy);
    if (Math.abs(lx) > fetchRadius || Math.abs(lz) > fetchRadius) continue;
    simCount++;
    const gattungArt = tree.properties.GATTUNG_ART || null;
    const genus = (tree.properties.GATTUNG_DEUTSCH || tree.properties.GATTUNG
                   || (gattungArt ? gattungArt.split(' ')[0] : null) || '').toLowerCase();
    const age      = tree.properties.STANDALTER || (tree.properties.PFLANZJAHR ? CURRENT_YEAR - tree.properties.PFLANZJAHR : 25);
    const plantYear = tree.properties.PFLANZJAHR || (CURRENT_YEAR - Math.min(age, 80));
    const surfaceY = (soilGrid ? soilGrid.getSurfaceHeight(lx, lz) : 0);
    const d        = Math.max(1, tree.properties.KRONENDURCHMESSER || 8);
    // Use tree.id first so low-poly proxy ID matching works (low-poly uses tree.id as primary key)
    const treeId = tree.id || `u_${tree.properties.BAUMNUMMER || treeDefs.length}`;
    treeDefs.push({
      treeId,
      treeLabel: tree.properties.BAUMNUMMER || (tree.id || '').toString().split('.').pop() || `#${treeDefs.length}`,
      x: lx, y: surfaceY, z: lz, surfaceY, d, genus, plantYear,
      height: tree.properties.BAUMHOEHE || d * 1.45,
      trunkCirc: tree.properties.STAMMUMFANG || d * 20,
      seed: Math.round(lx*373.71 + lz*617.29),
      isUrban: true,
      stressAccum: 0
    });
  }

  for (const pt of (plannerTrees || [])) {
    const lx = pt.x ?? pt.position?.[0];
    const lz = pt.z ?? pt.position?.[1];
    if (lx == null || lz == null) continue;
    const genus    = (pt.species || 'tilia').toLowerCase();
    const surfaceY = (soilGrid ? soilGrid.getSurfaceHeight(lx, lz) : 0);
    const d        = Math.max(8, (SPECIES[genus]?.canopyRadius || 4) * 2.5);
    treeDefs.push({
      treeId:    `p_${pt.id || treeDefs.length}`,
      treeLabel: pt.label || `Planner #${pt.id || treeDefs.length}`,
      x: lx, y: surfaceY, z: lz, surfaceY, d, genus,
      height: Math.max(14, (SPECIES[genus]?.canopyHeight || d * 1.5) * 1.5),
      trunkCirc: d * 22,
      plantYear: CURRENT_YEAR,
      seed: Math.round(lx*373.71 + lz*617.29) + (pt.id || 0)*999,
      isPlanner: true,
      stressPoints: 0.1
    });
  }

  if (treeDefs.length === 0) return null;

  // ── Simulate each tree independently ────────────────────────────────────
  const treeData = [];
  let minYear = Infinity, maxYear = -Infinity;

  for (const info of treeDefs) {
    const CURRENT_YEAR = new Date().getFullYear();
    const rp       = GENUS_ROOT_PARAMS[info.genus] || DEFAULT_ROOT_P;
    const finalAge = Math.min((info.maxYear || CURRENT_YEAR + 60) - info.plantYear, 300);

    // 1. Grow Roots via vigor decay
    const segments = simulateOneTree(info, obstacles, compMap, interactions, soilGrid);
    
    // 2. Grow Shoots & Leaves via Space Colonization Algorithm (SCA)
    info.maxYear = CURRENT_YEAR + 60;
    const { segments: scaSegs, height: finalH, d: finalD } = generateSCA(info, soilGrid);
    
    // Update info with final generated dimensions (LIDAR + Jitter)
    info.height = finalH;
    info.d = finalD;

    for (let i = 0; i < scaSegs.length; i++) {
       const ls = scaSegs[i];
       segments.push(ls);
    }

    const latReach = (info.d/2) * (rp.col==='plate' ? 1.65 : rp.col==='tap' ? 0.88 : 1.15);

    for (const s of segments) {
      if (s.year < minYear) minYear = s.year;
      if (s.year > maxYear) maxYear = s.year;
    }
    
    // Determine biological stress mapping (0.0 to 1.0) based on accumulated vigor deficit!
    const totalPotentialVigor = rp.vigor * 20; // heuristic base
    const bioStress = Math.min(1.0, info.stressAccum / Math.max(1, totalPotentialVigor));

    treeData.push({
      id: info.treeId, treeLabel: info.treeLabel,
      x: info.x, z: info.z, surfaceY: info.surfaceY,
      genus: info.genus, col: rp.col, plantYear: info.plantYear,
      latReach, segments,
      d: info.d, height: info.height, trunkCirc: info.trunkCirc, stress: bioStress,
      isUrban:   info.isUrban   || false,
      isPlanner: info.isPlanner || false,
    });
  }

  // Deduplicate interaction records
  const seen       = new Set();
  const uniqueActs = [];
  for (const act of interactions) {
    const key = act.type + (act.treeIds[0] < act.treeIds[1]
      ? act.treeIds[0]+':'+act.treeIds[1]
      : act.treeIds[1]+':'+act.treeIds[0]);
    if (!seen.has(key)) { seen.add(key); uniqueActs.push(act); }
  }

  // Group results by genus for faster rendering
  const genusGroups = {};
  for (const t of treeData) {
    if (!genusGroups[t.genus]) genusGroups[t.genus] = [];
    genusGroups[t.genus].push(...t.segments);
  }

  return {
    allSegs: treeData.flatMap(t => t.segments),
    genusGroups,
    interactions: uniqueActs,
    yearRange: [minYear===Infinity ? 1990 : minYear,
                maxYear===-Infinity ? CURRENT_YEAR : maxYear],
    treeData,
  };
}

export function filterSegsByYear(allSegs, targetYear) {
  return allSegs.filter(s => s.year <= targetYear);
}
