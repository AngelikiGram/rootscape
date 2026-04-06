// L-system parser and renderer
// Token format: S{theta_bin}_{phi_bin}_{len_bin}

const NUM_BINS_THETA = 36;
const NUM_BINS_PHI   = 36;
const NUM_BINS_F     = 10;

// ── Seeded PRNG (mulberry32) ─────────────────────────────────────
function mulberry32(seed) {
  let s = (seed ^ 0xdeadbeef) >>> 0;
  return function () {
    s = (s + 0x6D2B79F5) | 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// ── Per-species growth parameters ────────────────────────────────
// form: 'monopodial' = strong central leader with whorls (conifers)
//       'sympodial'  = branching main axis (broadleaf)
// thetaApical  = theta bin for main axis (0=up, 18=horizontal)
// thetaLat     = theta bin for lateral branches
// branchP      = probability of lateral branching at each step
// dichotomous  = true → both phi offsets used (oak-style forking)
// pendulous    = true → sub-branches droop (birch)
// whorlCount   = branches per whorl tier (monopodial)
// whorlAngle   = initial branch angle bin from vertical
// whorlStep    = grow a whorl every N iterations
const GROWTH_PARAMS = {
  oak:      { form: 'sympodial',   thetaApical: 2,  thetaLat: 8,  branchP: 0.72, dichotomous: true,  pendulous: false },
  beech:    { form: 'sympodial',   thetaApical: 1,  thetaLat: 15, branchP: 0.60, dichotomous: false, pendulous: false },
  cherry:   { form: 'sympodial',   thetaApical: 2,  thetaLat: 8,  branchP: 0.80, dichotomous: false, pendulous: false },
  birch:    { form: 'sympodial',   thetaApical: 1,  thetaLat: 5,  branchP: 0.90, dichotomous: false, pendulous: true  },
  acer:     { form: 'sympodial',   thetaApical: 2,  thetaLat: 10, branchP: 0.70, dichotomous: false, pendulous: false },
  platanus: { form: 'sympodial',   thetaApical: 1,  thetaLat: 13, branchP: 0.65, dichotomous: true,  pendulous: false },
  aesculus: { form: 'sympodial',   thetaApical: 2,  thetaLat: 9,  branchP: 0.68, dichotomous: false, pendulous: false },
  tilia:    { form: 'sympodial',   thetaApical: 1,  thetaLat: 12, branchP: 0.75, dichotomous: false, pendulous: false },
  pine:     { form: 'monopodial',  whorlCount: 5,   whorlAngle: 10, whorlStep: 2, sag: true  },
  spruce:   { form: 'monopodial',  whorlCount: 4,   whorlAngle: 7,  whorlStep: 1, sag: true  },
  larch:    { form: 'monopodial',  whorlCount: 5,   whorlAngle: 12, whorlStep: 2, sag: true  },
};

/**
 * Simulate bud growth → L-string.
 * @param {string} species
 * @param {number} internalAge   calendar years the tree has grown
 * @param {number} seed          integer seed for reproducible per-tree variation
 */
export function simulateGroveGrowth(species, internalAge, seed = 0) {
  const iterations = Math.min(10, Math.floor(internalAge / 2) + 1);
  const rng = mulberry32(seed + species.charCodeAt(0) * 997);

  const gp = GROWTH_PARAMS[species];

  // ── Monopodial (conifer) ──────────────────────────────────────
  if (!gp || gp.form === 'monopodial') {
    const p = gp || { whorlCount: 5, whorlAngle: 10, whorlStep: 2, sag: true };
    let result = '';
    for (let i = 0; i < iterations; i++) {
      // Trunk segment — slight lean via rng
      const trunkLen = 6 + Math.floor(rng() * 2);
      result += ` S0_${Math.floor(rng() * 3)}_${trunkLen}`;

      if (i % p.whorlStep === 0) {
        const count = p.whorlCount;
        const baseAngle = p.whorlAngle + Math.floor((rng() - 0.5) * 3);
        for (let w = 0; w < count; w++) {
          const phi = Math.floor((w / count) * 36 + rng() * 2) % 36;
          let branchStr = ` S${baseAngle}_${phi}_${4 + Math.floor(rng() * 2)}`;
          const subIters = Math.max(0, iterations - i - 1);
          for (let s = 1; s <= subIters; s++) {
            const sag = p.sag ? Math.min(30, baseAngle + s * 3 + Math.floor(rng() * 2)) : baseAngle;
            const bLen = 2.5 + Math.floor(rng() * 2);
            branchStr += ` S${sag}_${phi}_${bLen}`;
            // Force secondary twigs (depth 3) at regular intervals
            if (s % 2 === 0) {
              const subPhi = (phi + (rng() > 0.5 ? 10 : 26)) % 36;
              const subTheta = Math.min(35, sag + 10);
              branchStr += ` [ S${subTheta}_${subPhi}_2 ]`;
            }
          }
          result += ` [ ${branchStr} ]`;
        }
      }
    }
    return result;
  }

  // ── Sympodial (broadleaf) ─────────────────────────────────────
  function buildStructure(type, depth, itersLeft, currentPhi) {
    if (itersLeft <= 0) return '';
    let str = '';

    // Per-node jitter (gives each tree its own shape)
    const thetaJitter = Math.floor((rng() - 0.5) * 3); // ±1-2 bins
    const phiJitter   = Math.floor((rng() - 0.5) * 4); // ±2 bins

    const theta = type === 'apical'
      ? Math.max(0, gp.thetaApical + thetaJitter)
      : Math.max(0, gp.thetaLat + thetaJitter);
    const len = type === 'apical' ? 6 + Math.floor(rng() * 2) : 4 + Math.floor(rng() * 2);

    str += ` S${theta}_${Math.floor(currentPhi) % 36}_${len}`;

    // Drooping sub-branch for pendulous species (birch)
    if (gp.pendulous && type === 'lateral' && depth > 0 && rng() < 0.5) {
      const dropPhi = (Math.floor(currentPhi) + 18) % 36;
      str += ` [ S${Math.min(35, theta + 12)}_${dropPhi}_3 ]`;
    }

    const maxBranchDepth = Math.max(3, Math.min(6, Math.floor(internalAge / 12) + 3));
    // Force branching if we haven't reached depth 3 yet and have iterations
    const lateralP = depth < 3 ? 1.0 : (type === 'apical' ? gp.branchP : (gp.branchP * 0.4 / (depth - 2)));

    if (itersLeft > 1 && depth < maxBranchDepth && rng() < lateralP) {
      const phi1 = (Math.floor(currentPhi) + 14 + phiJitter) % 36;
      str += ` [ ${buildStructure('lateral', depth + 1, itersLeft - 1, phi1)} ]`;

      if (gp.dichotomous || rng() > 0.65) {
        const phi2 = (Math.floor(currentPhi) + 28 + phiJitter) % 36;
        str += ` [ ${buildStructure('lateral', depth + 1, itersLeft - 1, phi2)} ]`;
      }
    }

    str += buildStructure(type, depth, itersLeft - 1, (currentPhi + 2) % 36);
    return str;
  }

  // Starting phi: use seed so each tree fans out differently
  const startPhi = Math.floor(rng() * 36);
  return buildStructure('apical', 0, iterations, startPhi);
}


/**
 * Iteratively grow an L-string based on species rules
 */
export const SPECIES_RULES = {
  oak:    { shoot: { seed: 'A', rules: { 'A': ['S2_0_7 [ S8_14_5 L ] [ S8_32_5 L ] A', 'S4_18_6 [ S7_2_4 L ] [ S7_20_4 L ] A'], 'L': ['S8_5_4 S10_19_3 L', 'S8_23_4 S10_1_3 L', 'S9_0_3'] } }, root: { seed: 'A', rules: { 'A': ['S35_0_6 [ S22_14_4 L ] [ S22_32_4 L ] A'], 'L': ['S32_18_3 L'] } } },
  pine:   { shoot: { seed: 'A', rules: { 'A': ['S0_0_8 [ S9_0_5 L ] [ S9_7_5 L ] [ S9_14_5 L ] [ S9_21_5 L ] [ S9_28_5 L ] A'], 'L': ['S10_0_4 S11_0_3 L'] } }, root: { seed: 'A', rules: { 'A': ['S27_0_6 [ S28_14_5 L ] [ S28_32_5 L ] A'], 'L': ['S27_18_4 L'] } } },
  cherry: { shoot: { seed: 'A', rules: { 'A': ['S2_0_6 [ S7_0_4 L ] [ S7_12_4 L ] [ S7_24_4 L ] A'], 'L': ['S6_0_3 [ S5_6_2 L ] [ S5_30_2 L ]'] } }, root: { seed: 'A', rules: { 'A': ['S30_0_5 [ S24_18_4 L ] A'], 'L': ['S28_0_3 L'] } } },
  spruce: { shoot: { seed: 'A', rules: { 'A': ['S0_0_7 [ S6_0_5 L ] [ S6_12_5 L ] [ S6_24_5 L ] A'], 'L': ['S6_0_4 [ S22_0_3 ] [ S22_18_3 ] L'] } }, root: { seed: 'A', rules: { 'A': ['S32_0_6 [ S28_0_4 L ] A'], 'L': ['S30_18_3 L'] } } },
  birch:  { shoot: { seed: 'A', rules: { 'A': ['S1_0_7 [ S5_0_6 L ] S1_14_7 [ S5_14_6 L ] A'], 'L': ['S4_0_4 [ S32_0_3 L ]', 'S4_18_4 [ S32_18_3 L ]'] } }, root: { seed: 'A', rules: { 'A': ['S34_0_6 [ S26_14_4 L ] A'], 'L': ['S31_18_3 L'] } } },
  beech:  { shoot: { seed: 'A', rules: { 'A': ['S1_0_8 [ S14_0_6 L ] [ S14_18_6 L ] A'], 'L': ['S16_0_5 S17_18_4 L', 'S16_9_5 S17_27_4 L'] } }, root: { seed: 'A', rules: { 'A': ['S27_0_6 [ S24_14_5 L ] [ S24_32_5 L ] A'], 'L': ['S26_18_4 L'] } } },
};

export function growLString(lstring, species, type = 'shoot') {
  const grammar = SPECIES_RULES[species] || SPECIES_RULES.oak;
  const rules = grammar[type]?.rules;
  if (!rules) return lstring;
  const tokens = lstring.match(/\S+/g) || [];
  const result = [];
  for (const tok of tokens) {
    result.push(rules[tok] ? rules[tok][Math.floor(Math.random() * rules[tok].length)] : tok);
  }
  return result.join(' ');
}

export function generateSpeciesLString(species, iterations = 3, type = 'shoot') {
  const grammar = SPECIES_RULES[species] || SPECIES_RULES.oak;
  let current = grammar[type].seed;
  for (let i = 0; i < iterations; i++) current = growLString(current, species, type);
  return current;
}


// ── Parser ───────────────────────────────────────────────────────
const RE_TOKEN = /(?:[BSbs]\d+_\d+[F_]?\d+|\[|\]|\S+)/g;
const RE_SEG   = /([BSbs])(\d+)_(\d+)[F_]?(\d+)/;

export function parseLString(lstring) {
  const seq = [];
  const parts = lstring.match(RE_TOKEN) || [];
  let depth = 0;
  for (const tok of parts) {
    const m = RE_SEG.exec(tok);
    if (m) {
      seq.push({ type: 'SEGMENT', theta: parseInt(m[2]), phi: parseInt(m[3]), length: parseInt(m[4]), depth });
    } else if (tok === '[') {
      seq.push({ type: 'PUSH' });
      depth++;
    } else if (tok === ']') {
      seq.push({ type: 'POP' });
      depth = Math.max(0, depth - 1);
    } else if (tok === 'L') {
      seq.push({ type: 'LEAF', depth });
    }
  }
  return seq;
}

function directionFromBins(thetaBin, phiBin) {
  const theta = (thetaBin + 0.5) / NUM_BINS_THETA * Math.PI;
  const phi   = (phiBin  + 0.5) / NUM_BINS_PHI   * 2 * Math.PI;
  return [
    Math.sin(theta) * Math.cos(phi),
    Math.sin(theta) * Math.sin(phi),
    Math.cos(theta),
  ];
}

export function renderLSystem(lstring, stepScale = 1.0, isRoot = false) {
  const seq = typeof lstring === 'string' ? parseLString(lstring) : lstring;
  let pos = [0, 0, 0];
  const segments = [];
  const stack = [];

  for (const tok of seq) {
    if (tok.type === 'SEGMENT') {
      const dir = directionFromBins(tok.theta, tok.phi);
      const length = (tok.length + 0.5) / NUM_BINS_F * stepScale;
      const dx = dir[0] * length;
      const dy = dir[2] * length; // L-sys Z → Three.js Y (up)
      const dz = dir[1] * length; // L-sys Y → Three.js Z
      const nextPos = [pos[0] + dx, pos[1] + (isRoot ? -Math.abs(dy) : dy), pos[2] + dz];
      segments.push({ start: [...pos], end: [...nextPos], depth: tok.depth, theta: tok.theta });
      pos = nextPos;
    } else if (tok.type === 'LEAF') {
      segments.push({ type: 'leaf', start: [...pos], depth: tok.depth });
    } else if (tok.type === 'PUSH') {
      stack.push([...pos]);
    } else if (tok.type === 'POP') {
      if (stack.length) pos = stack.pop();
    }
  }
  return segments;
}


// ── Legacy helpers ───────────────────────────────────────────────
function cartToSpherical(dx, dy, dz) {
  const lx = dx, ly = dz, lz = dy;
  const r = Math.sqrt(lx*lx + ly*ly + lz*lz);
  if (r < 1e-6) return [2, 0, 0];
  const theta = Math.acos(Math.max(-1, Math.min(1, lz / r)));
  const phi   = Math.atan2(ly, lx);
  const thetaBin = Math.max(0, Math.min(NUM_BINS_THETA - 1, Math.round(theta / Math.PI * NUM_BINS_THETA - 0.5)));
  const phiBin   = Math.max(0, Math.min(NUM_BINS_PHI - 1, Math.round(((phi + Math.PI * 2) % (Math.PI * 2)) / (Math.PI * 2) * NUM_BINS_PHI - 0.5)));
  return [thetaBin, phiBin];
}

function lengthToBin(length) {
  return Math.max(0, Math.min(NUM_BINS_F - 1, Math.round(length / 0.2 * (NUM_BINS_F - 1))));
}

export function segmentsToLString(segments, treeId) {
  const byDepth = new Map();
  for (const seg of segments) {
    if (seg.treeId !== treeId) continue;
    const d = seg.depth;
    if (!byDepth.has(d)) byDepth.set(d, []);
    byDepth.get(d).push(seg);
  }
  const depths = [...byDepth.keys()].sort((a, b) => a - b);
  let parts = [];
  for (const depth of depths) {
    const segs = byDepth.get(depth).slice(0, 80);
    if (depth > 0) parts.push('[');
    for (const seg of segs) {
      const dx = seg.end[0] - seg.start[0], dy = seg.end[1] - seg.start[1], dz = seg.end[2] - seg.start[2];
      const length = Math.sqrt(dx*dx + dy*dy + dz*dz);
      const [tb, pb] = cartToSpherical(dx, dy, dz);
      parts.push(`S${tb}_${pb}_${lengthToBin(length)}`);
    }
    if (depth > 0) parts.push(']');
  }
  return parts.join(' ');
}

export function formatLStringForDisplay(segments, treeId) {
  const byDepth = new Map();
  for (const seg of segments) {
    if (seg.treeId !== treeId) continue;
    const d = seg.depth;
    if (!byDepth.has(d)) byDepth.set(d, []);
    byDepth.get(d).push(seg);
  }
  const depths = [...byDepth.keys()].sort((a, b) => a - b);
  const result = [];
  for (const depth of depths) {
    const tokens = byDepth.get(depth).slice(0, 60).map(seg => {
      const dx = seg.end[0] - seg.start[0], dy = seg.end[1] - seg.start[1], dz = seg.end[2] - seg.start[2];
      const length = Math.sqrt(dx*dx + dy*dy + dz*dz);
      const [tb, pb] = cartToSpherical(dx, dy, dz);
      return { text: `S${tb}_${pb}_${lengthToBin(length)}`, depth, segId: seg.id };
    });
    result.push({ depth, tokens });
  }
  return result;
}
