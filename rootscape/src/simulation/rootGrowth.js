// Root growth simulation — tip-based L-system growth

import { SPECIES } from './species.js';

let _nextSegId = 0;
let _nextTipId = 0;

// ── Math helpers ─────────────────────────────────────────────────

function normalize(v) {
  const len = Math.sqrt(v[0]*v[0] + v[1]*v[1] + v[2]*v[2]);
  if (len < 1e-8) return [0, -1, 0];
  return [v[0]/len, v[1]/len, v[2]/len];
}

function lerp3(a, b, t) {
  return [a[0]+(b[0]-a[0])*t, a[1]+(b[1]-a[1])*t, a[2]+(b[2]-a[2])*t];
}

// Deterministic noise in [0,1) from a seed value
function hash(n) {
  const x = Math.sin(n) * 43758.5453;
  return x - Math.floor(x);
}

// Rotate vector v around axis by angle radians
function rotateAroundAxis(v, axis, angle) {
  const c = Math.cos(angle), s = Math.sin(angle);
  const dot = v[0]*axis[0] + v[1]*axis[1] + v[2]*axis[2];
  const cross = [
    axis[1]*v[2] - axis[2]*v[1],
    axis[2]*v[0] - axis[0]*v[2],
    axis[0]*v[1] - axis[1]*v[0],
  ];
  return [
    v[0]*c + cross[0]*s + axis[0]*dot*(1-c),
    v[1]*c + cross[1]*s + axis[1]*dot*(1-c),
    v[2]*c + cross[2]*s + axis[2]*dot*(1-c),
  ];
}

// Create a random perpendicular vector to v
function perpendicular(v) {
  const ref = Math.abs(v[1]) < 0.9 ? [0,1,0] : [1,0,0];
  return normalize([
    v[1]*ref[2] - v[2]*ref[1],
    v[2]*ref[0] - v[0]*ref[2],
    v[0]*ref[1] - v[1]*ref[0],
  ]);
}

// Create a branch direction diverging from parent by angleRange
function branchDir(parentDir, angleRange, seed) {
  const perp = perpendicular(parentDir);
  const azimuth = hash(seed * 7.3) * Math.PI * 2;
  const rotAxis = rotateAroundAxis(perp, parentDir, azimuth);
  const angle = (0.3 + hash(seed * 13.1) * 0.7) * angleRange;
  return normalize(rotateAroundAxis(parentDir, rotAxis, angle));
}

// ── Tree initialization ─────────────────────────────────────────

export function createTree(species, position, id, idBit = 1, initialAge = 0, soilGrid = null) {
  const sp = SPECIES[species];
  const [wx, wz] = position;
  const initialY = soilGrid ? soilGrid.getSurfaceHeight(wx, wz) : 0;
  
  const tips = [];
  const initialSegments = [];
  const nTips = sp.nt ?? sp.initialTips ?? 6;
  const angleStep = (Math.PI * 2) / nTips;

  // Create symbolic initial roots
  for (let i = 0; i < nTips; i++) {
    const gStrength = sp.g ?? sp.gravityStrength ?? 0.40;
    const azimuth = i * angleStep + hash(i * 97.3) * 0.4;
    const polar = Math.PI * 0.5 + gStrength * 0.85 + (hash(i * 37.1) - 0.5) * 0.25;
    
    const dir = normalize([
      Math.sin(polar) * Math.cos(azimuth),
      Math.cos(polar),
      Math.sin(polar) * Math.sin(azimuth),
    ]);

    const step = (sp.ss ?? sp.stepSize ?? 0.13) * 0.8;
    const endPos = [
      wx + dir[0] * step,
      dir[1] * step, 
      wz + dir[2] * step,
    ];

    const seg = {
      id: _nextSegId++,
      start: [wx, initialY, wz],
      end: endPos,
      radius: sp.rootRadiusBase ?? 0.022,
      depth: 0,
      treeId: id,
      time: 0,
      competitive: false,
      suppressed: false,
      order: 0,
    };
    initialSegments.push(seg);

    tips.push({
      id: _nextTipId++,
      pos: endPos,
      dir,
      depth: 0,
      age: 0,
      active: true,
      seed: hash(id.charCodeAt ? id.charCodeAt(0)*31+i*17 : i*97+id*17) * 1000 + i,
    });
  }

  let tree = {
    id,
    idBit,
    species,
    position: [wx, wz],
    tips,
    segments: initialSegments,
    vigor: 1.0,
    stress: false,
    competitionPressure: 0,
    totalConsumed: 0,
    events: [],
    age: initialAge, // store current biological age
  };

  return tree;
}

// ── Growth step ─────────────────────────────────────────────────

export function growTree(tree, soilGrid, time, interactionMode = 'competition', allTrees = []) {
  const sp = SPECIES[tree.species];
  // Map Rhizomorph parameter names (g, bp, ss, etc.) to descriptive internal ones if needed, 
  // or just use them directly if available in the species object.
  const gStrength = sp.g ?? sp.gravityStrength ?? 0.40;
  const bProb     = sp.bp ?? sp.branchProbability ?? 0.09;
  const lateralRange = sp.la ?? sp.lateralAngleRange ?? 0.85;
  const maxDepth  = sp.maxDepth ?? 3.0; // fallback to 3m if not set
  const stepSize  = sp.ss ?? sp.stepSize ?? 0.13;
  const maxBD     = sp.mbd ?? sp.maxBranchDepth ?? 3;

  const newTips = [];
  const newSegments = [];
  let totalMoisture = 0;
  let consumed = 0;

  const gravity = [0, -1, 0];

  for (const tip of tree.tips) {
    if (!tip.active) {
      newTips.push(tip);
      continue;
    }

    // ── Resource check ──────────────────────────────────────────
    const moisture  = soilGrid.getMoisture(tip.pos[0], tip.pos[2], tip.pos[1]);
    const nutrients = soilGrid.getNutrients(tip.pos[0], tip.pos[2], tip.pos[1]);
    const waterSens = sp.waterSensitivity ?? 0.70;
    const nutrientSens = sp.nutrientSensitivity ?? 0.50;
    const resource = moisture * waterSens + nutrients * nutrientSens;

    if (resource < 0.05 || moisture < 0.03) {
      newTips.push({ ...tip, active: false });
      continue;
    }

    // ── Rhizomorph Tropisms (Gravitropism + Noise) ───────────────
    let dir = [...tip.dir];

    // Gravitropism: blend current direction toward (0,-1,0)
    // Blend weight per step tuned for Rhizomorph archetypes
    const gB = gStrength * 0.09;
    dir = normalize(lerp3(dir, gravity, gB));

    // Stochastic noise (reproducible)
    const noiseAz  = hash(tip.seed + time * 3.7 + tip.age * 0.3) * Math.PI * 2;
    const noiseAmp = 0.18 * (0.5 + hash(tip.seed + time * 11.3) * 0.5);
    const perp = perpendicular(dir);
    const perturbAxis = rotateAroundAxis(perp, dir, noiseAz);
    dir = normalize(rotateAroundAxis(dir, perturbAxis, noiseAmp * (1 - gStrength * 0.4)));

    // ── Compute new position ────────────────────────────────────
    const vigor = Math.max(0.4, tree.vigor);
    
    // Allelopathy Effect: Certain species inhibit others 
    let allelopathyFactor = 1.0;
    const competitors = soilGrid.getCompetitorsAt(tip.pos[0], tip.pos[2], tip.pos[1], allTrees);
    if (competitors.length > 0) {
      if (tree.species === 'birch' && competitors.includes('spruce')) allelopathyFactor = 0.65;
      if (tree.species === 'oak' && competitors.includes('beech')) allelopathyFactor = 0.75;
    }

    const step = stepSize * vigor * allelopathyFactor;
    let newPos = [
      tip.pos[0] + dir[0] * step,
      tip.pos[1] + dir[1] * step,
      tip.pos[2] + dir[2] * step,
    ];

    // Surface collision: If root tries to exit soil, deflect it horizontally
    const surfaceY = soilGrid ? soilGrid.getSurfaceHeight(newPos[0], newPos[2]) : 0;
    if (newPos[1] > surfaceY - 0.02) {
      newPos[1] = surfaceY - 0.02;
      dir[1] = Math.min(-0.1, -Math.abs(dir[1]));
    }

    // ── Depth and reach limits ───────────────────────────────────
    const depthM = surfaceY - newPos[1];
    if (depthM > maxDepth) {
      newTips.push({ ...tip, active: false });
      continue;
    }
    const lateralReachLimit = sp.lateralReach ?? 6.0;
    const lateralDist = Math.sqrt(
      (newPos[0] - tree.position[0])**2 + (newPos[2] - tree.position[1])**2
    );
    if (lateralDist > lateralReachLimit) {
      newTips.push({ ...tip, active: false });
      continue;
    }

    // ── Competition check ────────────────────────────────────────
    const isCompeting = soilGrid.checkCompetition(newPos[0], newPos[2], newPos[1], tree.idBit);
    
    if (isCompeting && interactionMode === 'competition') {
      // Growth suppressed by competing roots
      if (hash(tip.seed + time * 23.7) < 0.45) {
        newTips.push({ ...tip, active: false });
        continue;
      }
    }

    // ── Create segment ───────────────────────────────────────────
    const baseRad = sp.rootRadiusBase ?? 0.02;
    const segRadius = baseRad * Math.pow(0.72, tip.depth);
    const seg = {
      id: _nextSegId++,
      start: [...tip.pos],
      end: [...newPos],
      radius: segRadius,
      depth: tip.depth,
      treeId: tree.id,
      time,
      competitive: isCompeting,
      suppressed: false,
      order: tip.depth, 
    };
    newSegments.push(seg);

    // ── Consume resources ─────────────────────────────────────────
    const consumed_m = 0.04 * waterSens;
    const consumed_n = 0.03 * nutrientSens;
    soilGrid.deplete(newPos[0], newPos[2], newPos[1], consumed_m, consumed_n, tree.idBit);
    totalMoisture += moisture;
    consumed++;

    // ── Rhizomorph Branching with Apical Dominance Ramp ───────────
    // Probability peaks after initial elongation steps
    const apicalRamp = Math.exp(-Math.max(0, 4 - tip.age) * 0.5);
    const branchSeed = hash(tip.seed + time * 5.3 + tip.age);
    
    if (
      tip.depth < maxBD &&
      branchSeed < bProb * apicalRamp &&
      resource > 0.25
    ) {
      const bd = branchDir(dir, lateralRange * 0.75, tip.seed + time * 19.1);
      newTips.push({
        id: _nextTipId++,
        pos: [...newPos],
        dir: bd,
        depth: tip.depth + 1,
        age: 0,
        active: true,
        seed: hash(tip.seed + time * 31.7 + tip.depth) * 1000,
      });
    }

    newTips.push({ ...tip, pos: newPos, dir, age: tip.age + 1 });
  }

  // ── Vigor update ─────────────────────────────────────────────────
  const avgMoisture = consumed > 0 ? totalMoisture / consumed : 0;
  const vigor = Math.max(0.05, tree.vigor * 0.85 + avgMoisture * 0.15);

  return {
    ...tree,
    tips: newTips,
    segments: [...tree.segments, ...newSegments],
    vigor,
    stress: vigor < 0.35,
    competitionPressure: newSegments.filter(s => s.competitive).length / Math.max(1, newSegments.length),
    totalConsumed: tree.totalConsumed + consumed,
    age: tree.age + 1,
  };
}

// ── Competition detection (post-step) ────────────────────────────

export function detectCompetitionEvents(trees, time) {
  const events = [];
  for (let i = 0; i < trees.length; i++) {
    for (let j = i + 1; j < trees.length; j++) {
      const a = trees[i], b = trees[j];
      const dx = a.position[0] - b.position[0];
      const dz = a.position[1] - b.position[1];
      const dist2 = dx*dx + dz*dz;

      const combinedReach = SPECIES[a.species].lateralReach + SPECIES[b.species].lateralReach;
      if (dist2 < combinedReach * combinedReach) {
        const dist = Math.sqrt(dist2); // only compute when needed for the graft threshold
        const midX = (a.position[0] + b.position[0]) / 2;
        const midZ = (a.position[1] + b.position[1]) / 2;
        const overlapDepth = -(Math.min(SPECIES[a.species].maxDepth, SPECIES[b.species].maxDepth) * 0.3);

        // Interaction Logic: Competition vs Grafting
        if (a.species === b.species && dist < 1.0) {
          events.push({
            type: 'graft',
            treeIds: [a.id, b.id],
            position: [midX, overlapDepth, midZ],
            time,
            description: `Inter-tree root graft detected between ${a.species} #${a.id} and #${b.id}`,
          });
        } else {
          events.push({
            type: 'competition',
            treeIds: [a.id, b.id],
            position: [midX, overlapDepth, midZ],
            time,
            description: `Root competition zone: ${a.species} vs ${b.species} at depth ${(-overlapDepth).toFixed(1)}m`,
          });
        }
      }
    }
  }
  return events;
}

// ── Grafting proximity ───────────────────────────────────────────

export function detectGraftingProximity(trees, threshold = 0.2) {
  const grafts = [];
  // Only same-species trees can graft
  const grouped = {};
  for (const tree of trees) {
    if (!grouped[tree.species]) grouped[tree.species] = [];
    grouped[tree.species].push(tree);
  }
  for (const species in grouped) {
    const group = grouped[species];
    const thresh2 = threshold * threshold;
    for (let i = 0; i < group.length; i++) {
      for (let j = i + 1; j < group.length; j++) {
        // Sample segment endpoints to find proximity
        const a = group[i].segments.slice(-50);
        const b = group[j].segments.slice(-50);
        let found = false;
        for (const sa of a) {
          if (found) break;
          for (const sb of b) {
            const dx = sa.end[0]-sb.end[0], dy = sa.end[1]-sb.end[1], dz = sa.end[2]-sb.end[2];
            if (dx*dx + dy*dy + dz*dz < thresh2) {
              grafts.push({
                type: 'graft',
                treeIds: [group[i].id, group[j].id],
                position: [(sa.end[0]+sb.end[0])/2, (sa.end[1]+sb.end[1])/2, (sa.end[2]+sb.end[2])/2],
              });
              found = true;
              break;
            }
          }
        }
      }
    }
  }
  return grafts;
}
