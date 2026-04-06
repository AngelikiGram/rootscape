import * as THREE from 'three';
import { SPECIES } from './species';
import { renderLSystem, simulateGroveGrowth } from './lsystem';

// Cylinder orientation helper: align cylinder Y-axis to direction p1→p2
const _up  = new THREE.Vector3(0, 1, 0);
const _alt = new THREE.Vector3(1, 0, 0);
function orientCylinder(mesh, p1, p2) {
  const dir = new THREE.Vector3().subVectors(p2, p1).normalize();
  const quat = new THREE.Quaternion();
  // Avoid degenerate setFromUnitVectors when dir ≈ ±up
  if (Math.abs(dir.y) > 0.9999) {
    quat.setFromAxisAngle(_alt, dir.y > 0 ? 0 : Math.PI);
  } else {
    quat.setFromUnitVectors(_up, dir);
  }
  mesh.quaternion.copy(quat);
}

// Branch radii by nesting depth (metres)
// depth 0 = main trunk axis, 1 = primary scaffold branches, 2 = secondary, 3+ = twigs
const DEPTH_RADII = [0.18, 0.07, 0.028, 0.010];
function branchRadius(depth, trunkRadius) {
  const scale = trunkRadius / 0.30; // normalise to oak trunk
  const r = (DEPTH_RADII[Math.min(depth, 3)] || 0.010) * scale;
  return Math.max(0.006, r);
}

// Shared geometry cache keyed by "rBottom_rTop_length" (rounded to mm)
const GEO_CACHE = new Map();
function getCylGeo(rBottom, rTop, length) {
  const k = `${rBottom.toFixed(3)}_${rTop.toFixed(3)}_${length.toFixed(3)}`;
  if (!GEO_CACHE.has(k)) {
    GEO_CACHE.set(k, new THREE.CylinderGeometry(rTop, rBottom, length, 5, 1));
  }
  return GEO_CACHE.get(k);
}

/**
 * Build a 3-D canopy for a tree.
 *
 * @param {object|string} tree   Tree object (needs .species, .age, .id, .position) or species string
 * @param {number}        age    Override age (optional)
 * @param {number}        vigor  0–1 health (controls bark→leaf color blend)
 * @returns {THREE.Group}
 */
export function makeCanopy(tree, age, vigor = 1.0, showLeaves = true) {
  const species  = typeof tree === 'string' ? tree : (tree.species || 'oak');
  const treeAge  = age !== undefined ? age : (tree ? tree.age : 0);
  const treeId   = (tree && tree.id) != null ? tree.id : 0;
  const treePos  = tree && tree.position ? tree.position : [0, 0];

  const sp = SPECIES[species];
  if (!sp) return new THREE.Group();

  // Deterministic seed: mix tree id with quantised position
  const seed = ((treeId * 2654435761) ^ (Math.round(treePos[0] * 10) * 805459861) ^ (Math.round(treePos[1] * 10) * 1234567891)) >>> 0;

  const group = new THREE.Group();
  const storyString = simulateGroveGrowth(species, treeAge, seed);
  const segments    = renderLSystem(storyString, 2.2);

  const barkColor = new THREE.Color(0x5c4530);
  const leafColor = new THREE.Color(sp.canopyColor || '#2d5a1b');
  const stressCol = new THREE.Color(0x8a7d2a);

  // Shared material (one per canopy, depth blending done via color)
  const mat = new THREE.MeshStandardMaterial({ roughness: 0.88, metalness: 0 });

  const trunkRadius = sp.trunkRadius || 0.30;

  for (const seg of segments) {
    if (seg.type === 'leaf') continue; // handled separately below

    const p1 = new THREE.Vector3(...seg.start);
    const p2 = new THREE.Vector3(...seg.end);
    const length = p1.distanceTo(p2);
    if (length < 0.02) continue;

    const depth = seg.depth || 0;
    const rBottom = branchRadius(depth, trunkRadius);
    const rTop    = branchRadius(depth + 1, trunkRadius); // slight taper along each segment

    const geo  = getCylGeo(rBottom, rTop, length);
    const mesh = new THREE.Mesh(geo, mat.clone());

    // Position at midpoint, then orient
    mesh.position.copy(p1).add(p2).multiplyScalar(0.5);
    orientCylinder(mesh, p1, p2);
    mesh.castShadow    = true;
    mesh.receiveShadow = true;

    // Color: bark at low depth/height → leaf at high depth/height
    // Then modulate by vigor (stressed → yellowish)
    const depthMix  = Math.min(1, depth / 3.5);
    const heightMix = Math.min(1, p2.y / ((sp.canopyHeight || 18) + (sp.trunkHeight || 3)));
    const freshCol  = new THREE.Color().copy(barkColor).lerp(leafColor, Math.max(depthMix, heightMix * 0.5));
    mesh.material.color.copy(stressCol).lerp(freshCol, Math.max(0, Math.min(1, vigor)));

    group.add(mesh);
  }

  // Leaf cloud for older trees
  if (showLeaves && treeAge > 6) {
    const isConifer = ['pine', 'spruce', 'larch'].includes(species);
    // Leaf billboard size proportional to actual canopy spread, NOT trunk radius
    const canopyR = sp.canopyRadius || 5;
    const leafSize = isConifer
      ? Math.min(0.15, 0.04 + canopyR * 0.008)
      : Math.min(0.28, 0.06 + canopyR * 0.018);
    const leafCount = Math.min(200, Math.floor(treeAge * 4 + canopyR * 6));
    const tipSegs = segments.filter(s => !s.type && s.depth >= 2).slice(-leafCount);
    if (tipSegs.length > 0) {
      const pos = [];
      for (const s of tipSegs) pos.push(s.end[0], s.end[1], s.end[2]);
      const geo = new THREE.BufferGeometry();
      geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
      const pts = new THREE.Points(geo, new THREE.PointsMaterial({
        color: sp.canopyColor || '#2d5a1b',
        size: leafSize,
        transparent: true,
        opacity: 0.65,
        depthWrite: false,
      }));
      group.add(pts);
    }
  }

  return group;
}
