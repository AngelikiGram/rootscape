/**
 * Space Colonization Algorithm (SCA) for Shoot Generation
 * Based on Runions et al. (2007) "Modeling Trees with a Space Colonization Algorithm"
 *
 * Key design goals:
 *  - Every tree guaranteed to reach branch depth ≥ 3 (trunk=0 → scaffold=1 → secondary=2 → twig=3)
 *  - Conifer: pre-built monopodial trunk with whorled primaries, SCA fills sub-branch detail
 *  - Deciduous: oblate/columnar attractor cloud sized to species, SCA builds full structure
 *  - Seeded PRNG per tree (deterministic, no flicker)
 *  - Leaf size proportional to crown diameter and species type
 */

import { SPECIES } from './species';

// -- Seeded PRNG --------------------------------------------------─
function mulberry32(seed) {
  let s = (seed ^ 0xdeadbeef) >>> 0;
  return function () {
    s = (s + 0x6D2B79F5) | 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// -- Species profile lookup ----------------------------------------
// form:        'conifer' | 'columnar' | 'wide'
// killRatio:   killDist = height * killRatio  (how close before attractor is consumed)
// branchRatio: branchStep = height * branchRatio (inter-node distance)
// pull:        weight of current direction vs attractor direction (0=pure SCA, 1=straight)
// maxIters:    SCA loop cap
// tipR:        leaf-node branch radius (m)
// leafRatio:   leaf billboard size = crownD * leafRatio
const SCA_PROFILES = {
  // Narrow conifers - strong monopodial trunk, tight conical crown
  conifer: {
    form: 'conifer', killRatio: 0.055, branchRatio: 0.038, pull: 0.55,
    maxIters: 400, tipR: 0.018, leafRatio: 0.018,
    jitterH: 0.12, jitterV: 0.08,   
  },
  pine: {
    form: 'pine', killRatio: 0.050, branchRatio: 0.038, pull: 0.38,
    maxIters: 500, tipR: 0.020, leafRatio: 0.052,
    jitterH: 0.18, jitterV: 0.12,
  },
  columnar: {
    form: 'columnar', killRatio: 0.065, branchRatio: 0.042, pull: 0.36,
    maxIters: 450, tipR: 0.022, leafRatio: 0.030,
    jitterH: 0.28, jitterV: 0.14,
  },
  wide: {
    form: 'wide', killRatio: 0.070, branchRatio: 0.046, pull: 0.30,
    maxIters: 500, tipR: 0.028, leafRatio: 0.038,
    jitterH: 0.32, jitterV: 0.18,
  },
  irregular: {
    form: 'wide', killRatio: 0.075, branchRatio: 0.050, pull: 0.22,
    maxIters: 550, tipR: 0.026, leafRatio: 0.038,
    jitterH: 0.55, jitterV: 0.40, // high jitter for crooked Robinia branches
  },
  dense_wide: {
    form: 'wide', killRatio: 0.065, branchRatio: 0.040, pull: 0.28,
    maxIters: 600, tipR: 0.022, leafRatio: 0.035,
    jitterH: 0.35, jitterV: 0.20,
  },
  ash: {
    form: 'wide', killRatio: 0.075, branchRatio: 0.050, pull: 0.40,
    maxIters: 450, tipR: 0.035, leafRatio: 0.060, 
    jitterH: 0.15, jitterV: 0.08, 
  },
  heart: {
    form: 'heart', killRatio: 0.048, branchRatio: 0.035, pull: 0.35,
    maxIters: 750, tipR: 0.020, leafRatio: 0.065,
    jitterH: 0.40, jitterV: 0.25,
  },
  weeping: {
    form: 'wide', killRatio: 0.068, branchRatio: 0.045, pull: 0.28,
    maxIters: 500, tipR: 0.026, leafRatio: 0.038,
    jitterH: 0.35, jitterV: 0.25,
  },
};

const GENUS_TO_PROFILE = {
  pinus: 'pine', picea: 'conifer', abies: 'conifer', larix: 'conifer',
  betula: 'columnar', populus: 'columnar', robinia: 'irregular',
  prunus: 'columnar', fraxinus: 'ash', acer: 'dense_wide',
  tilia: 'heart', celtis: 'dense_wide',
  salix: 'weeping',
};
// everything else → 'wide'

// -- Attractor generation ------------------------------------------
function generateAttractors(rng, n, ox, oy, oz, crownR, height, form) {
  const pts = [];

  if (form === 'conifer') {
    // Tiered conical envelope: N tiers, each a disk shrinking toward the top
    const tiers = Math.max(4, Math.floor(height / 1.8));
    const perTier = Math.ceil(n / tiers);
    for (let t = 0; t < tiers; t++) {
      const hFrac = (t + 0.5) / tiers;
      const tierY = oy + hFrac * height;
      // Conical taper - radius shrinks from bottom (where branches are widest) to top
      const tierR = crownR * Math.pow(1.0 - hFrac * 0.85, 0.6);
      for (let i = 0; i < perTier && pts.length < n; i++) {
        const a = rng() * Math.PI * 2;
        const r = Math.sqrt(rng()) * tierR;
        pts.push([ox + Math.cos(a) * r, tierY + (rng() - 0.5) * 0.4, oz + Math.sin(a) * r]);
      }
    }
  } else if (form === 'pine') {
    // Umbrella / flat-top distribution common in mature pines
    for (let i = 0; i < n; i++) {
      const hFrac = Math.pow(rng(), 0.75) * 0.9 + 0.1; // bias toward upper 
      const h = hFrac * height;
      const a = rng() * Math.PI * 2;
      // Stays wide at the top, narrower at the bottom
      const rScale = hFrac > 0.6 ? 1.0 : (hFrac * 1.4 + 0.1);
      const r = Math.sqrt(rng()) * crownR * rScale;
      pts.push([ox + Math.cos(a) * r, oy + h, oz + Math.sin(a) * r]);
    }
  } else if (form === 'heart') {
    // Tilia-specific heart-shaped crown
    for (let i = 0; i < n; i++) {
       const hFrac = rng() * 0.9 + 0.1;
       const h = hFrac * height;
       // Heart shape: wide near middle-bottom, tapering sharply at top
       const widthScale = hFrac < 0.4 
          ? (hFrac * 2.0 + 0.2) 
          : (1.0 - (hFrac - 0.4) * 1.5);
       const a = rng() * Math.PI * 2;
       const r = Math.sqrt(rng()) * crownR * Math.max(0.1, widthScale);
       pts.push([ox + Math.cos(a) * r, oy + h, oz + Math.sin(a) * r]);
    }
  } else if (form === 'columnar') {
    // Narrow vertical ellipsoid (tall, narrow)
    for (let i = 0; i < n; i++) {
      const h = rng() * height * 0.92 + height * 0.10;
      const a = rng() * Math.PI * 2;
      const r = Math.sqrt(rng()) * crownR * 0.40;
      pts.push([ox + Math.cos(a) * r, oy + h, oz + Math.sin(a) * r]);
    }
  } else if (form === 'weeping') {
    // Wide oblate sphere, with additional downward-pointing cluster in lower half
    for (let i = 0; i < n; i++) {
      const h = rng() * height * 0.85 + height * 0.12;
      const hFrac = h / height;
      const widthScale = Math.sin(hFrac * Math.PI) * 1.1 + 0.2;
      const a = rng() * Math.PI * 2;
      const r = Math.sqrt(rng()) * crownR * widthScale;
      pts.push([ox + Math.cos(a) * r, oy + h, oz + Math.sin(a) * r]);
    }
  } else {
    // Wide spreading: oblate spheroid - wide in the middle, concentrated above 35% height
    for (let i = 0; i < n; i++) {
      // Bias height toward upper 2/3 of crown
      const h = Math.pow(rng(), 0.6) * height * 0.90 + height * 0.10;
      const hFrac = h / height;
      const widthScale = Math.sin(hFrac * Math.PI) * 0.9 + 0.35;
      const a = rng() * Math.PI * 2;
      const r = Math.sqrt(rng()) * crownR * widthScale * 1.2;
      pts.push([ox + Math.cos(a) * r, oy + h, oz + Math.sin(a) * r]);
    }
  }
  return pts;
}

// -- Helpers ------------------------------------------------------─
function norm3(v) {
  const m = Math.sqrt(v[0]*v[0] + v[1]*v[1] + v[2]*v[2]) || 1;
  return [v[0]/m, v[1]/m, v[2]/m];
}
function dist2(a, b) {
  const dx=a[0]-b[0], dy=a[1]-b[1], dz=a[2]-b[2];
  return dx*dx + dy*dy + dz*dz;
}

class Node {
  constructor(parent, pos, dir, depth) {
    this.parent   = parent;
    this.pos      = pos;
    this.dir      = dir;
    this.depth    = depth;
    this.children = [];
    this.nextDir  = [0, 0, 0];
    this.numTips  = 0;
    this.r        = 0;
    this.isLeaf   = false;
  }
}

// -- Pre-build conifer trunk with whorls --------------------------─
// Returns nodes[] already containing trunk + primary whorl nodes
function buildConiferSkeleton(rng, rootNode, ox, oy, oz, crownR, height, branchStep) {
  const nodes = [rootNode];
  const trunkSegs = Math.max(4, Math.floor(height / (branchStep * 2.2)));
  const whorlEvery = Math.max(1, Math.floor(trunkSegs / 6)); // 6 tier groups
  let prev = rootNode;

  for (let i = 1; i <= trunkSegs; i++) {
    const frac = i / trunkSegs;
    const ny = oy + frac * height;
    const lean = (rng() - 0.5) * 0.04;
    const tnode = new Node(prev, [ox + lean, ny, oz + lean], [0, 1, 0], 0);
    prev.children.push(tnode);
    nodes.push(tnode);
    prev = tnode;

    // Emit whorl at this tier
    if (i % whorlEvery === 0 && frac < 0.95) {
      const tierR = crownR * Math.pow(1.0 - frac * 0.88, 0.6);
      // Whorl initial step: reach out to ~30% of this tier's crown radius
      const whorlStep = Math.min(branchStep * 1.4, tierR * 0.30);
      const count = 3 + Math.floor(rng() * 3); // 3-5 branches per whorl
      for (let w = 0; w < count; w++) {
        const phi = (w / count) * Math.PI * 2 + rng() * 0.4;
        const downTilt = 0.2 + frac * 0.5; // lower whorls are more horizontal
        const dir = norm3([Math.cos(phi), -downTilt, Math.sin(phi)]);
        const wp = [tnode.pos[0] + dir[0] * whorlStep, tnode.pos[1] + dir[1] * whorlStep, tnode.pos[2] + dir[2] * whorlStep];
        const wn = new Node(tnode, wp, dir, 1); // depth 1 = primary branch
        tnode.children.push(wn);
        nodes.push(wn);
      }
    }
  }
  return nodes;
}


// -- Pre-build deciduous trunk + scaffold branches at crown base --─
// Avoids wasting SCA iterations on a bare trunk, gives branches
// good starting positions distributed around the crown base.
function buildDeciduousTrunk(rng, rootNode, ox, oy, oz, crownR, height, branchStep) {
  const nodes = [rootNode];
  const crownBaseH = height * 0.35; // trunk takes ~35% of total height
  const trunkSegs  = Math.max(2, Math.round(crownBaseH / branchStep));
  let prev = rootNode;

  for (let i = 1; i <= trunkSegs; i++) {
    const frac = i / trunkSegs;
    const lean = (rng() - 0.5) * 0.06;
    const tn   = new Node(prev, [ox + lean, oy + frac * crownBaseH, oz + lean], [0, 1, 0], 0);
    prev.children.push(tn);
    nodes.push(tn);
    prev = tn;
  }

  // 3–5 primary scaffold branches at crown base, spread outward
  const scaffolds = 3 + Math.floor(rng() * 3);
  for (let w = 0; w < scaffolds; w++) {
    const phi   = (w / scaffolds) * Math.PI * 2 + rng() * 0.5;
    const outR  = crownR * (0.25 + rng() * 0.20); // reach 25–45% of crownR initially
    const upFrac = 0.30 + rng() * 0.30;            // upward component
    const dir   = norm3([Math.cos(phi) * (1 - upFrac), upFrac, Math.sin(phi) * (1 - upFrac)]);
    const wp    = [prev.pos[0] + dir[0] * outR, prev.pos[1] + dir[1] * outR, prev.pos[2] + dir[2] * outR];
    const wn    = new Node(prev, wp, dir, 1);
    prev.children.push(wn);
    nodes.push(wn);
  }
  return nodes;
}

// -- Main SCA export ----------------------------------------------─
export function generateSCA(info, soilGrid) {
  const { x, z, d, genus = 'tilia', plantYear, seed = 123, trunkCirc } = info;
  const y = info.y ?? info.surfaceY ?? 0;

  const rng = mulberry32((seed ^ 0x9e3779b9) >>> 0);

  const profileKey  = GENUS_TO_PROFILE[genus] || 'wide';
  const profile     = SCA_PROFILES[profileKey];
  const crownR      = Math.max(2, d / 2);

  // Use LiDAR-derived height when available, else GIS height with small jitter
  let height = info.height ?? (d * 1.45);
  if (soilGrid?.dsmMap) {
    const rVox = Math.ceil(crownR * soilGrid.resolution + 1);
    let maxDH = 0;
    for (let xi = -rVox; xi <= rVox; xi++) {
      for (let zi = -rVox; zi <= rVox; zi++) {
        if ((xi*xi + zi*zi) > rVox*rVox*1.2) continue;
        const dh = (soilGrid.getDSMHeight?.(x + xi/soilGrid.resolution, z + zi/soilGrid.resolution) ?? 0)
                 - (soilGrid.getSurfaceHeight?.(x + xi/soilGrid.resolution, z + zi/soilGrid.resolution) ?? 0);
        if (dh > maxDH) maxDH = dh;
      }
    }
    if (maxDH > 3.0) height = maxDH * 1.02;
  }
  height = Math.max(4, height) * (0.90 + rng() * 0.20); // ±10% jitter

  const branchStep    = Math.max(0.35, Math.min(0.70, height * profile.branchRatio));
  const killDist      = Math.max(0.55, Math.min(1.80, height * profile.killRatio));
  const killDistSq    = killDist * killDist;
  const influenceDist = Math.min(35, height * 3.0);
  const influenceDstSq = influenceDist * influenceDist;

  const finalAge = Math.max(1, (info.maxTime ?? (plantYear + 60)) - plantYear);

  // -- Build initial node tree ----------------------------------─
  const rootNode = new Node(null, [x, y, z], [0, 1, 0], 0);
  const nodes    = profile.form === 'conifer'
    ? buildConiferSkeleton(rng, rootNode, x, y, z, crownR, height, branchStep)
    : buildDeciduousTrunk(rng, rootNode, x, y, z, crownR, height, branchStep);

  // -- Generate attractor cloud ----------------------------------
  const vol   = Math.PI * crownR * crownR * height;
  const nAttr = Math.max(800, Math.min(6000, Math.floor(vol * 24)));
  let pts = generateAttractors(rng, nAttr, x, y, z, crownR, height, profile.form);

  // Attempt LiDAR points overlay (supplement generated attractors)
  if (soilGrid?.dsmMap && pts.length < 800) {
    const rVox = Math.ceil(crownR * soilGrid.resolution + 1);
    for (let xi = -rVox; xi <= rVox; xi++) {
      for (let zi = -rVox; zi <= rVox; zi++) {
        if ((xi*xi + zi*zi) > rVox*rVox*1.2) continue;
        const px = x + xi/soilGrid.resolution, pz = z + zi/soilGrid.resolution;
        const dh = (soilGrid.getDSMHeight?.(px, pz) ?? 0) - (soilGrid.getSurfaceHeight?.(px, pz) ?? 0);
        if (dh > 2.5) pts.push([px, y + dh * (0.5 + rng() * 0.45), pz]);
      }
    }
  }

  // -- SCA main loop --------------------------------------------─
  // Wrap attractors in tracking objects
  let leaves = pts.map(pos => ({ pos, closest: rootNode, recordSq: dist2(pos, rootNode.pos) }));

  let maxIters   = profile.maxIters;
  let addedNodes = [...nodes]; // all conifer skeleton nodes are "new" for first proximity pass

  while (leaves.length > 0 && maxIters-- > 0) {
    // Update closest-node for each attractor
    if (addedNodes.length > 0) {
      for (const l of leaves) {
        for (const n of addedNodes) {
          const d2 = dist2(l.pos, n.pos);
          if (d2 < l.recordSq) { l.recordSq = d2; l.closest = n; }
        }
      }
      addedNodes = [];
    }

    // Accumulate attraction vectors
    let anyInfluenced = false;
    for (const l of leaves) {
      if (l.recordSq > influenceDstSq) continue;
      const cn = l.closest;
      const dx = l.pos[0] - cn.pos[0], dy = l.pos[1] - cn.pos[1], dz = l.pos[2] - cn.pos[2];
      const mag = Math.sqrt(dx*dx + dy*dy + dz*dz) || 1;
      cn.nextDir[0] += dx/mag; cn.nextDir[1] += dy/mag; cn.nextDir[2] += dz/mag;
      cn.numTips++;
      anyInfluenced = true;
    }

    // No attractors reachable → extend trunk upward to find more
    if (!anyInfluenced) {
      let top = null, topY = -Infinity;
      for (const n of nodes) { if (n.pos[1] > topY) { topY = n.pos[1]; top = n; } }
      if (!top || top.pos[1] >= y + height) break;
      const newPos = [top.pos[0], top.pos[1] + branchStep, top.pos[2]];
      const ext = new Node(top, newPos, [0, 1, 0], top.depth);
      top.children.push(ext);
      nodes.push(ext);
      addedNodes.push(ext);
      continue;
    }

    // Grow new nodes toward attraction
    for (const node of nodes) {
      if (node.numTips === 0) continue;
      const aDir = norm3(node.nextDir);
      const pull = profile.pull;
      let nd = norm3([
        node.dir[0] * pull + aDir[0] * (1 - pull) + (rng() - 0.5) * profile.jitterH,
        node.dir[1] * pull + aDir[1] * (1 - pull) + (rng() - 0.5) * profile.jitterV + (profile.form === 'conifer' ? 0.14 : 0.04),
        node.dir[2] * pull + aDir[2] * (1 - pull) + (rng() - 0.5) * profile.jitterH,
      ]);
      // Conifers: keep growth mostly upward/lateral, not downward
      if (profile.form === 'conifer') nd[1] = Math.max(nd[1], -0.05);

      const newPos = [
        node.pos[0] + nd[0] * branchStep,
        node.pos[1] + nd[1] * branchStep,
        node.pos[2] + nd[2] * branchStep,
      ];
      // Depth = parent.depth + 1 if this node already has children (branching event)
      const newDepth = node.depth + (node.children.length > 0 ? 1 : 0);
      const child = new Node(node, newPos, nd, newDepth);
      node.children.push(child);
      nodes.push(child);
      addedNodes.push(child);
      node.nextDir = [0, 0, 0];
      node.numTips = 0;
    }

    // Kill attractors that have been reached
    for (let i = leaves.length - 1; i >= 0; i--) {
      if (leaves[i].recordSq < killDistSq) {
        const killed = leaves[i].closest;
        if (killed.children.length === 0) killed.isLeaf = true;
        leaves.splice(i, 1);
      }
    }
  }

  // -- Guarantee min branch depth 4 ----------------------------─
  // BFS from root to assign proper branching-order depth
  // (overwrite SCA incremental depth with correct hierarchical depth)
  {
    const queue = [rootNode];
    rootNode._bd = 0; // branching order depth
    while (queue.length) {
      const n = queue.shift();
      const isBranch = n.children.length > 1;
      for (const c of n.children) {
        c._bd = n._bd + (isBranch ? 1 : 0);
        queue.push(c);
      }
    }
    // If max depth < 4, force-extend the deepest leaf tips
    let maxBD = 0;
    for (const n of nodes) if ((n._bd || 0) > maxBD) maxBD = n._bd;

    if (maxBD < 4) {
      // Collect all current leaf-tip nodes and split each into 2 children to add depth
      const tips = nodes.filter(n => n.children.length === 0 && n !== rootNode);
      for (const tip of tips) {
        const curDepth = tip._bd || 0;
        const extraDepth = 4 - curDepth;
        let cur = tip;
        for (let ed = 0; ed < extraDepth; ed++) {
          const numBranches = 2 + Math.floor(rng() * 2); // 2-3 child branches
          for (let b = 0; b < numBranches; b++) {
            const phi = (b / numBranches) * Math.PI * 2 + rng() * 0.4;
            const thetaSpread = 0.4 + rng() * 0.3;
            const dir2 = norm3([
              cur.dir[0] + Math.cos(phi) * thetaSpread,
              cur.dir[1] * 0.65 + 0.18,
              cur.dir[2] + Math.sin(phi) * thetaSpread,
            ]);
            const childPos = [cur.pos[0] + dir2[0] * branchStep * 0.65, cur.pos[1] + dir2[1] * branchStep * 0.65, cur.pos[2] + dir2[2] * branchStep * 0.65];
            const fc = new Node(cur, childPos, dir2, (cur._bd || 0) + 1);
            fc._bd = fc.depth;
            fc.isLeaf = true;
            cur.children.push(fc);
            nodes.push(fc);
          }
          cur = cur.children[0]; // walk down first child for next extra level
          if (!cur) break;
        }
      }
    }

    // Apply _bd as canonical depth
    for (const n of nodes) n.depth = n._bd || 0;
  }

  // -- Pipe-model radius computation ----------------------------─
  const nExp = (SPECIES[genus]?.taperExponent) || 2.5;
  for (let i = nodes.length - 1; i >= 0; i--) {
    const n = nodes[i];
    if (n.children.length === 0) {
      n.r = profile.tipR;
    } else {
      let sum = 0;
      for (const c of n.children) sum += Math.pow(c.r, nExp);
      n.r = Math.pow(sum, 1 / nExp);
    }
  }

  // Scale root radius to target trunk circumference
  const targetRad = trunkCirc ? (trunkCirc * 0.01) / (2 * Math.PI) : 0.12;
  const maxR = rootNode.r || 0.01;
  const taperScale = Math.min(4.0, targetRad / maxR);

  // -- Convert nodes → segment array ----------------------------─
  const segments   = [];
  const validNodes = nodes.filter(n => n.parent !== null);
  const segsPerYr  = Math.max(1, validNodes.length / Math.max(1, finalAge));

  // Leaf size: proportional to crown, species-dependent
  const leafSize = Math.min(0.38, crownR * profile.leafRatio * 2);

  for (let i = 0; i < validNodes.length; i++) {
    const n   = validNodes[i];
    const yr  = plantYear + Math.floor(i / segsPerYr);
    const rad = Math.max(0.006, n.parent.r * taperScale);

    if (n.isLeaf) {
      // Leaf billboard at node position
      segments.push({ type: 'leaf', start: [...n.pos], depth: n.depth, year: yr, treeId: info.treeId });
    } else {
      // Branch segment
      segments.push({
        type: 'shoot', start: [...n.parent.pos], end: [...n.pos],
        depth: n.depth, thickness: rad, year: yr, treeId: info.treeId,
      });
    }

    // Generate leaf cluster at terminal / tip nodes (depth >= 1)
    if (n.depth >= 1 && (n.children.length === 0 || (n.depth >= 2 && rng() > 0.35))) {
      const count = n.children.length === 0 ? 12 : 6;
      for (let l = 0; l < count; l++) {
        const spread = leafSize * (0.6 + rng() * 0.8);
        const offX = (rng() - 0.5) * spread * 2.0;
        const offY = (rng() - 0.1) * spread * 1.6;
        const offZ = (rng() - 0.5) * spread * 2.0;
        segments.push({
          type: 'leaf',
          start: [n.pos[0] + offX, n.pos[1] + offY, n.pos[2] + offZ],
          depth: n.depth + 1, year: yr, treeId: info.treeId,
        });
      }
    }
  }

  return { segments, height, d: crownR * 2 };
}
