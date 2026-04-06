// 3D soil resource grid
// Stores moisture and nutrients per voxel
// Grid: nx × nz × ny  (x=east-west, z=north-south, y=depth index, 0=surface)

import { SOIL_TYPES } from './species.js';

// Fixed internal grid resolution for performance stability
export const GRID_NX = 256;
export const GRID_NZ = 256;
export const GRID_NY = 160;

export class SoilGrid {
  constructor(worldHalf = 10) {
    this.worldHalf = worldHalf; // half-width in meters (e.g. 150m)
    this.resolution = GRID_NX / (this.worldHalf * 2); // voxels per meter
    
    const size = GRID_NX * GRID_NZ * GRID_NY;
    this.moisture = new Float32Array(size);
    this.nutrients = new Float32Array(size);
    this.occupancy = new Int8Array(size);   // bitmask of tree IDs (up to 8 trees)
    this.heightMap = new Float32Array(GRID_NX * GRID_NZ); 
    this.dsmMap = new Float32Array(GRID_NX * GRID_NZ); // Stores actual topographical surface including flora
    this.diffusion = 0.15;
    this.soilType = 'loam';
  }

  idx(xi, zi, yi) {
    return xi * GRID_NZ * GRID_NY + zi * GRID_NY + yi;
  }

  initialize(soilType = 'loam', moistureProfile = null) {
    this.soilType = soilType;
    const st = SOIL_TYPES[soilType];
    this.diffusion = st.waterDiffusion;

    for (let xi = 0; xi < GRID_NX; xi++) {
      for (let zi = 0; zi < GRID_NZ; zi++) {
        this.heightMap[xi * GRID_NZ + zi] = 0;
        this.dsmMap[xi * GRID_NZ + zi] = 0;

        for (let yi = 0; yi < GRID_NY; yi++) {
          const i = this.idx(xi, zi, yi);
          const depthFrac = yi / GRID_NY; 

          let baseMoisture = st.baselineMoisture * (1 - depthFrac * 0.4);
          if (moistureProfile) {
            baseMoisture = this._sampleProfile(moistureProfile, depthFrac) * st.baselineMoisture;
          }

          const noise = this._pseudoRng(xi, zi, yi) * 0.2 - 0.1;
          this.moisture[i] = Math.max(0, Math.min(1, baseMoisture + noise));

          const nutNoise = this._pseudoRng(xi * 3.7, zi * 2.1, yi + 100) * 0.4;
          const nutBase = st.baselineNutrients * (1 - depthFrac * 0.3);
          this.nutrients[i] = Math.max(0, Math.min(1, nutBase + nutNoise - 0.15));

          this.occupancy[i] = 0;
        }
      }
    }
  }

  _pseudoRng(x, z, y) {
    const n = Math.sin(x * 127.1 + z * 311.7 + y * 74.3) * 43758.5453;
    return n - Math.floor(n);
  }

  setHeight(wx, wz, height, radius) {
    const [cxi, czi] = this.worldToGrid(wx, wz, 0);
    const rVox = Math.ceil(radius * this.resolution);
    for (let xi = Math.max(0, cxi - rVox); xi < Math.min(GRID_NX, cxi + rVox); xi++) {
      for (let zi = Math.max(0, czi - rVox); zi < Math.min(GRID_NZ, czi + rVox); zi++) {
        const dx = (xi - cxi) / Math.max(1, rVox);
        const dz = (zi - czi) / Math.max(1, rVox);
        const d = Math.sqrt(dx * dx + dz * dz);
        if (d > 1) continue;
        const falloff = 1.0 - d * d * (3.0 - 2.0 * d); 
        this.heightMap[xi * GRID_NZ + zi] += height * falloff;
      }
    }
  }

  getSurfaceHeight(wx, wz) {
    const res = this.resolution;
    const wh = this.worldHalf;
    
    // Map world to continuous grid coordinates
    const gx = (wx + wh) * res;
    const gz = (wz + wh) * res;

    if (isNaN(gx) || isNaN(gz)) return 0;
    
    const x0 = Math.floor(gx);
    const z0 = Math.floor(gz);
    const fx = gx - x0;
    const fz = gz - z0;
    
    // Clamp grid indices to safe range [0, GRID-1]
    const ix0 = Math.max(0, Math.min(GRID_NX - 1, x0));
    const iz0 = Math.max(0, Math.min(GRID_NZ - 1, z0));
    const ix1 = Math.max(0, Math.min(GRID_NX - 1, x0 + 1));
    const iz1 = Math.max(0, Math.min(GRID_NZ - 1, z0 + 1));
    
    const h00 = this.heightMap[ix0 * GRID_NZ + iz0];
    const h10 = this.heightMap[ix1 * GRID_NZ + iz0];
    const h01 = this.heightMap[ix0 * GRID_NZ + iz1];
    const h11 = this.heightMap[ix1 * GRID_NZ + iz1];
    
    // Bilinear interpolation for smooth snapping
    const h0 = h00 * (1 - fx) + h10 * fx;
    const h1 = h01 * (1 - fx) + h11 * fx;
    return h0 * (1 - fz) + h1 * fz;
  }

  getDSMHeight(wx, wz) {
    const res = this.resolution;
    const wh = this.worldHalf;
    
    const gx = (wx + wh) * res;
    const gz = (wz + wh) * res;

    if (isNaN(gx) || isNaN(gz)) return 0;
    
    const x0 = Math.floor(gx);
    const z0 = Math.floor(gz);
    const fx = gx - x0;
    const fz = gz - z0;
    
    const ix0 = Math.max(0, Math.min(GRID_NX - 1, x0));
    const iz0 = Math.max(0, Math.min(GRID_NZ - 1, z0));
    const ix1 = Math.max(0, Math.min(GRID_NX - 1, x0 + 1));
    const iz1 = Math.max(0, Math.min(GRID_NZ - 1, z0 + 1));
    
    const h00 = this.dsmMap[ix0 * GRID_NZ + iz0];
    const h10 = this.dsmMap[ix1 * GRID_NZ + iz0];
    const h01 = this.dsmMap[ix0 * GRID_NZ + iz1];
    const h11 = this.dsmMap[ix1 * GRID_NZ + iz1];
    
    const h0 = h00 * (1 - fx) + h10 * fx;
    const h1 = h01 * (1 - fx) + h11 * fx;
    return h0 * (1 - fz) + h1 * fz;
  }

  _sampleProfile(profile, depthFrac) {
    for (let i = 0; i < profile.length - 1; i++) {
      if (depthFrac >= profile[i].depth && depthFrac <= profile[i + 1].depth) {
        const t = (depthFrac - profile[i].depth) / (profile[i + 1].depth - profile[i].depth);
        return profile[i].moisture + t * (profile[i + 1].moisture - profile[i].moisture);
      }
    }
    return profile[profile.length - 1].moisture;
  }

  worldToGrid(wx, wz, wy) {
    const xi = Math.floor((wx + this.worldHalf) * this.resolution);
    const zi = Math.floor((wz + this.worldHalf) * this.resolution);
    
    const safeXi = Math.max(0, Math.min(GRID_NX - 1, xi));
    const safeZi = Math.max(0, Math.min(GRID_NZ - 1, zi));
    
    const surfaceY = this.heightMap[safeXi * GRID_NZ + safeZi];
    const yi = Math.floor((surfaceY - wy) * 4.0); // Constant 4 voxels per meter for depth
    
    return [
      safeXi,
      safeZi,
      Math.max(0, Math.min(GRID_NY - 1, yi)),
    ];
  }

  getCompetitorsAt(wx, wz, wy, allTrees = []) {
    const [xi, zi, yi] = this.worldToGrid(wx, wz, wy);
    const bits = this.occupancy[this.idx(xi, zi, yi)];
    if (bits === 0) return [];

    const rivals = [];
    for (const tree of allTrees) {
      if ((bits & tree.idBit)) {
        rivals.push(tree.species);
      }
    }
    return rivals;
  }

  getMoisture(wx, wz, wy) {
    const [xi, zi, yi] = this.worldToGrid(wx, wz, wy);
    return this.moisture[this.idx(xi, zi, yi)];
  }

  getNutrients(wx, wz, wy) {
    const [xi, zi, yi] = this.worldToGrid(wx, wz, wy);
    return this.nutrients[this.idx(xi, zi, yi)];
  }

  deplete(wx, wz, wy, moistureAmt, nutrientAmt, treeIdBit = 0) {
    const [xi, zi, yi] = this.worldToGrid(wx, wz, wy);
    const i = this.idx(xi, zi, yi);
    this.moisture[i] = Math.max(0, this.moisture[i] - moistureAmt);
    this.nutrients[i] = Math.max(0, this.nutrients[i] - nutrientAmt);
    if (treeIdBit) this.occupancy[i] |= treeIdBit;
    return this.occupancy[i];
  }

  checkCompetition(wx, wz, wy, treeIdBit) {
    const [xi, zi, yi] = this.worldToGrid(wx, wz, wy);
    const current = this.occupancy[this.idx(xi, zi, yi)];
    return (current & ~treeIdBit) !== 0;
  }

  diffuseStep() {
    const rate = this.diffusion * 0.02;
    // Swap pre-allocated buffers — avoids a 42 MB allocation + GC on every step
    if (!this._diffBuf) this._diffBuf = new Float32Array(this.moisture.length);
    const next = this._diffBuf;
    next.set(this.moisture);

    const NZ = GRID_NZ, NY = GRID_NY;
    const NZNY = NZ * NY; // xi stride
    const m = this.moisture;

    for (let xi = 1; xi < GRID_NX - 1; xi++) {
      const baseX = xi * NZNY;
      for (let zi = 1; zi < GRID_NZ - 1; zi++) {
        const baseXZ = baseX + zi * NY;
        for (let yi = 0; yi < GRID_NY - 1; yi++) {
          const i = baseXZ + yi;
          // Inline neighbour average (5 neighbours, /5 = *0.2) — no array alloc
          const avg = (m[i + NZNY] + m[i - NZNY] + m[i + NY] + m[i - NY] + m[i + 1]) * 0.2;
          next[i] = m[i] + (avg - m[i]) * rate;
        }
      }
    }
    // Swap: old moisture buffer becomes next call's scratch
    this._diffBuf = m;
    this.moisture = next;
  }

  applyDrought(depthRangeMeters, moisture) {
    const [y0, y1] = depthRangeMeters;
    const yi0 = Math.floor(y0 * 4.0);
    const yi1 = Math.ceil(y1 * 4.0);
    for (let xi = 0; xi < GRID_NX; xi++) {
      for (let zi = 0; zi < GRID_NZ; zi++) {
        for (let yi = yi0; yi <= Math.min(yi1, GRID_NY - 1); yi++) {
          this.moisture[this.idx(xi, zi, yi)] = moisture;
        }
      }
    }
  }

  paintNutrients(wx, wz, radius, value) {
    const [cxi, czi] = this.worldToGrid(wx, wz, 0);
    const rVox = Math.ceil(radius * this.resolution);
    for (let xi = Math.max(0, cxi - rVox); xi < Math.min(GRID_NX, cxi + rVox); xi++) {
      for (let zi = Math.max(0, czi - rVox); zi < Math.min(GRID_NZ, czi + rVox); zi++) {
        const d = Math.sqrt((xi - cxi) ** 2 + (zi - czi) ** 2) / Math.max(1, rVox);
        if (d > 1) continue;
        for (let yi = 0; yi < GRID_NY; yi++) {
          const i = this.idx(xi, zi, yi);
          this.nutrients[i] = Math.max(0, Math.min(1, this.nutrients[i] + value * (1 - d)));
        }
      }
    }
  }

  paintMoisture(wx, wz, radius, value) {
    const [cxi, czi] = this.worldToGrid(wx, wz, 0);
    const rVox = Math.ceil(radius * this.resolution);
    for (let xi = Math.max(0, cxi - rVox); xi < Math.min(GRID_NX, cxi + rVox); xi++) {
      for (let zi = Math.max(0, czi - rVox); zi < Math.min(GRID_NZ, czi + rVox); zi++) {
        const d = Math.sqrt((xi - cxi) ** 2 + (zi - czi) ** 2) / Math.max(1, rVox);
        if (d > 1) continue;
        for (let yi = 0; yi < 10; yi++) { 
          const i = this.idx(xi, zi, yi);
          this.moisture[i] = Math.max(0, Math.min(1, this.moisture[i] + value * (1 - d)));
        }
      }
    }
  }

  getSurfaceData() {
    const moisture = new Float32Array(GRID_NX * GRID_NZ);
    const nutrients = new Float32Array(GRID_NX * GRID_NZ);
    const heights = new Float32Array(GRID_NX * GRID_NZ);
    const dsmDiff = new Float32Array(GRID_NX * GRID_NZ);
    // Iterate zi-outer (= PlaneGeometry row = N→S), xi-inner (= PlaneGeometry col = W→E)
    // so sIdx = zi * GRID_NX + xi matches vertex index iy * GRID_NX + ix
    for (let zi = 0; zi < GRID_NZ; zi++) {
      for (let xi = 0; xi < GRID_NX; xi++) {
        let m = 0, n = 0;
        for (let yi = 0; yi < 3; yi++) {
          m += this.moisture[this.idx(xi, zi, yi)];
          n += this.nutrients[this.idx(xi, zi, yi)];
        }
        const sIdx = zi * GRID_NX + xi;
        moisture[sIdx] = m / 3;
        nutrients[sIdx] = n / 3;
        
        const dtm = this.heightMap[xi * GRID_NZ + zi];
        const dsm = this.dsmMap[xi * GRID_NZ + zi] || dtm;
        heights[sIdx] = dtm;
        dsmDiff[sIdx] = Math.max(0, dsm - dtm);
      }
    }
    return { moisture, nutrients, heights, dsmDiff };
  }

  getXSlice(wx) {
    const xi = Math.max(0, Math.min(GRID_NX - 1, Math.floor((wx + this.worldHalf) * this.resolution)));
    const result = [];
    for (let zi = 0; zi < GRID_NZ; zi++) {
      for (let yi = 0; yi < GRID_NY; yi++) {
        const i = this.idx(xi, zi, yi);
        result.push({ zi, yi, moisture: this.moisture[i], nutrients: this.nutrients[i] });
      }
    }
    return result;
  }
  morphTerrain(wx, wz, value, radius) {
    const [cxi, czi] = this.worldToGrid(wx, wz, 0);
    const rVox = Math.ceil(radius * this.resolution);
    for (let xi = Math.max(0, cxi - rVox); xi < Math.min(GRID_NX, cxi + rVox); xi++) {
      for (let zi = Math.max(0, czi - rVox); zi < Math.min(GRID_NZ, czi + rVox); zi++) {
        const d = Math.sqrt((xi - cxi) ** 2 + (zi - czi) ** 2) / Math.max(1, rVox);
        if (d > 1) continue;
        const i = xi * GRID_NZ + zi;
        this.heightMap[i] += value * (1 - d) * 2.0;
      }
    }
  }
}
