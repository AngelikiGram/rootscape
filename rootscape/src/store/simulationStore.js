import { create } from 'zustand';
import { subscribeWithSelector } from 'zustand/middleware';
import { GRID_NX, GRID_NZ, SoilGrid } from '../simulation/soilGrid.js';
import { createTree, growTree, detectCompetitionEvents, detectGraftingProximity } from '../simulation/rootGrowth.js';
import { SPECIES } from '../simulation/species.js';
import { simulateGroveGrowth, renderLSystem } from '../simulation/lsystem.js';

let _treeCounter = 1;
let _playInterval = null;

export const useSimStore = create(subscribeWithSelector((set, get) => ({
  // location: { lat: 48.2045, lon: 16.3584 },
  location: { lat: 48.1995, lon: 16.3695 },
  fetchRadius: 350,
  loadingGIS: false,
  language: 'en',

  soilGrid: null,
  trees: [],
  initialAge: 3,
  time: 0,
  speed: 1,
  isPlaying: false,

  competitionZones: [],
  graftZones: [],
  events: [],

  moistureProfile: [
    { depth: 0, moisture: 0.7 },
    { depth: 0.5, moisture: 0.8 },
    { depth: 1.0, moisture: 0.6 },
    { depth: 2.0, moisture: 0.4 },
  ],
  moistureGlobal: 0.5,
  soilType: 'loam',
  soilMeta: {},

  pavements: [],
  urbanTrees: [],
  buildings: [],
  undergroundData: {},
  buildingOrigin3857: [0, 0],

  terrainOrtho: null,
  terrainScale: 1.0,
  terrainFetchedAt: 0,
  terrainMorphedAt: 0,
  showBuildings: true,
  showUrbanTrees: true,
  showUnderground: true,
  showUbahn: true,
  showPipes: true,
  showRoads: true,
  showPavements: true,
  showGroundMask: false,
  showWaterBodies: true,
  showTexturedBuildings: false,
  showXRay: false,
  showDSMOverlay: false,
  useAlpineDTM: false,

  activeView: '3d',
  viewMode: 'realistic',

  selectedTreeIds: [],
  selectedFeature: null,

  rootSimYear: 2026,
  rootSimStartYear: 1960,
  rootSimEndYear: 2092,

  // Analytics / Pins
  acceptedPins: [],
  comparingPinIds: [],
  candidatePlantMode: false,
  candidateLocation: null,
  viabilityResults: null,

  _gisCache: new Map(),

  init: async () => {
    get().resetSim();
    await get().fetchRealDTM();
  },

  async fetchRealDTM() {
    const { location, fetchRadius, soilGrid, loadingGIS } = get();
    if (loadingGIS) return;
    const { lat, lon } = location;

    // 1. Session Cache Check
    const cacheKey = `${lat.toFixed(5)}_${lon.toFixed(5)}_${Math.round(fetchRadius)}`;
    if (get()._gisCache?.has(cacheKey)) {
      console.log('[GIS] Using session cache for', cacheKey);
      const cached = get()._gisCache.get(cacheKey);
      get()._applyGISData(cached);
      return;
    }

    set({ loadingGIS: true, events: [{ type: 'info', description: `Fetching Area GIS Data...`, time: 0 }] });

    try {
      const useAlpine = get().useAlpineDTM;
      const isProd = import.meta.env.PROD;
      
      let dtmResp = null, treesResp = null, underResp = null, soilResp = null, paveResp = null;

      try {
        const useAlpine = get().useAlpineDTM;
        [dtmResp, treesResp, underResp, soilResp, paveResp] = await Promise.all([
          fetch(`/api/dtm?lat=${lat}&lon=${lon}&half_m=${fetchRadius}&use_alpine=${useAlpine}`),
          fetch(`/api/trees?lat=${lat}&lon=${lon}&half_m=${fetchRadius}`),
          fetch(`/api/underground?lat=${lat}&lon=${lon}&half_m=${fetchRadius}`),
          fetch(`/api/soil?lat=${lat}&lon=${lon}`),
          fetch(`/api/pavements?lat=${lat}&lon=${lon}&half_m=${fetchRadius}`)
        ]);
        
        // If we get an HTML response (likely a 404 from GitHub Pages), assume API is unavailable
        if (dtmResp.headers.get('content-type')?.includes('text/html')) {
          console.warn('[SIM] API not found (likely GH Pages), falling back to static caches');
          throw new Error('API_UNAVAILABLE');
        }
      } catch (e) {
        // Fallback to static files in the repository for "Demo Mode" (only works for predefined locations)
        const base = import.meta.env.BASE_URL;
        console.log('[SIM] Using static demo caches from', base);
        [dtmResp, treesResp, underResp, soilResp, paveResp] = await Promise.all([
           fetch(`${base}dtm_vienna_cache.json`).catch(() => ({ json: () => ({ error: 'no dtm' }) })),
           fetch(`${base}trees_vienna_cache.json`).catch(() => ({ json: () => ({ features: [] }) })),
           fetch(`${base}underground_vienna_cache.json`).catch(() => ({ json: () => ({}) })),
           fetch(`${base}soil_vienna_cache.json`).catch(() => ({ json: () => ({}) })),
           fetch(`${base}pavements_vienna_cache.json`).catch(() => ({ json: () => ({ pavements: [] }) }))
        ]);
      }

      const data = await dtmResp.json();
      if (data.error) {
        // If even the static DTM fails, we can't show much
        console.error('[SIM] Could not load terrain data even from caches.');
        throw new Error(data.error);
      }

      let treesData = { features: [] };
      try { treesData = await treesResp.json(); } catch (e) { console.warn("Baumkataster fail"); }

      let underData = {};
      try { underData = await underResp.json(); } catch (e) { console.warn("Underground fail"); }

      // Soil
      try {
        const soilData = await soilResp.json();
        if (!soilData.error && soilData.soil_type && soilData.moisture_profile) {
          set({
            soilType: soilData.soil_type,
            moistureProfile: soilData.moisture_profile,
            soilMeta: {
              clay_pct: soilData.clay_pct,
              sand_pct: soilData.sand_pct,
              silt_pct: soilData.silt_pct,
              ph: soilData.ph,
              soc_gkg: soilData.soc_gkg,
              field_capacity: soilData.field_capacity,
              texture_profile: soilData.texture_profile,
            },
          });
        }
      } catch (e) { console.warn("SoilGrids fail:", e.message); }

      // Pavements
      try {
        const paveData = await paveResp.json();
        if (!paveData.error && paveData.pavements) {
          set({ pavements: paveData.pavements });
        }
      } catch (e) { console.warn("Pavement fail:", e.message); }

      const { heights, dsm, res, ortho, buildings, origin_3857 } = data;

      let autoScale = 1.0;
      // Update terrain in grid
      if (get().soilGrid) {
        const grid = get().soilGrid;
        if (heights) {
          const sourceDim = Math.sqrt(heights.length);
          const stride = sourceDim / GRID_NX;
          const dsmDim = (dsm && dsm.length > 0) ? Math.sqrt(dsm.length) : sourceDim;
          const dsmStride = dsmDim / GRID_NX;
          let maxH = 0;
          for (let zi = 0; zi < GRID_NZ; zi++) {
            for (let xi = 0; xi < GRID_NX; xi++) {
              const idx = Math.floor(zi * stride) * sourceDim + Math.floor(xi * stride);
              const h = heights[idx];
              grid.heightMap[xi * GRID_NZ + zi] = h;
              if (dsm) {
                const didx = Math.floor(zi * dsmStride) * dsmDim + Math.floor(xi * dsmStride);
                grid.dsmMap[xi * GRID_NZ + zi] = dsm[didx] ?? h;
              } else {
                grid.dsmMap[xi * GRID_NZ + zi] = h;
              }
              if (isFinite(h) && h > maxH) maxH = h;
            }
          }
          if (maxH > 0.1) autoScale = Math.max(1.0, Math.min((fetchRadius * 0.25) / maxH, 3.5));
        }
      }

      set({
        terrainOrtho: ortho,
        terrainScale: autoScale,
        buildings: buildings?.features || [],
        urbanTrees: treesData.features || [],
        undergroundData: underData,
        buildingOrigin3857: origin_3857,
        terrainFetchedAt: Date.now(),
        terrainMorphedAt: Date.now(),
        loadingGIS: false
      });

      get()._gisCache.set(cacheKey, data);

    } catch (err) {
      console.error('[SIM] Fetch failed', err);
      set({ events: [{ type: 'error', description: `Fetch failed: ${err.message}`, time: 0 }] });
    } finally {
      set({ loadingGIS: false });
    }
  },

  fetchMapillarySequences: async () => {
    const { location, fetchRadius } = get();
    if (!location) return;
    try {
      const r = await fetch(`/api/mapillary_sequences?lat=${location.lat}&lon=${location.lon}&radius=${fetchRadius}`);
      const data = await r.json();
      set({ mapillarySequences: data.data || [] });
    } catch (e) {
      console.error('Failed to fetch Mapillary sequences', e);
    }
  },


  _applyGISData(data) {
    // Helper to apply cached/already-fetched data
    const { heights, dsm, res, ortho, buildings, origin_3857 } = data;
    if (get().soilGrid && heights) {
      const grid = get().soilGrid;
      const sourceDim = Math.sqrt(heights.length);
      const stride = sourceDim / GRID_NX;
      for (let zi = 0; zi < GRID_NZ; zi++) {
        for (let xi = 0; xi < GRID_NX; xi++) {
          const idx = Math.floor(zi * stride) * sourceDim + Math.floor(xi * stride);
          grid.heightMap[xi * GRID_NZ + zi] = heights[idx];
        }
      }
    }
    set({
      terrainOrtho: ortho,
      buildings: buildings?.features || [],
      buildingOrigin3857: origin_3857,
      terrainFetchedAt: Date.now(),
      terrainMorphedAt: Date.now(),
    });
  },

  addTree(species, pos) {
    const { soilGrid, trees, initialAge } = get();
    const id = _treeCounter++;
    const idBit = 1 << (id % 30);
    const newTree = createTree(species, pos, id, idBit, initialAge, soilGrid);
    set({ trees: [...trees, newTree] });
  },

  removeTree(id) {
    set(s => ({
      trees: s.trees.filter(t => t.id !== id),
      selectedTreeIds: s.selectedTreeIds.filter(tid => tid !== id)
    }));
  },

  setFetchRadius(val) {
    const { soilGrid } = get();
    if (soilGrid) {
      soilGrid.worldHalf = val;
      soilGrid.resolution = GRID_NX / (val * 2);
    }
    set({ fetchRadius: val });
  },

  resetSim() {
    if (_playInterval) {
      clearInterval(_playInterval);
      _playInterval = null;
    }
    const { fetchRadius, soilType, moistureProfile } = get();
    const grid = new SoilGrid(fetchRadius);
    grid.initialize(soilType, moistureProfile);
    _treeCounter = 1;
    set({
      soilGrid: grid,
      trees: [],
      time: 0,
      isPlaying: false,
      events: [],
      competitionZones: [],
      graftZones: [],
      selectedTreeIds: [],
      terrainMorphedAt: Date.now()
    });
  },

  addEvent: (ev) => {
    set(state => ({ events: [...state.events.slice(-99), { ...ev, time: state.time }] }));
  },

  // Brushes
  morphTerrain(wx, wz, strength, radius) {
    const { soilGrid } = get();
    if (soilGrid) {
      soilGrid.morphTerrain(wx, wz, strength, radius);
      set({ terrainMorphedAt: Date.now() });
    }
  },
  paintMoisture(wx, wz, strength, radius) {
    const { soilGrid } = get();
    if (soilGrid) {
      soilGrid.paintMoisture(wx, wz, strength, radius);
      set({ time: get().time }); // force update signal
    }
  },
  paintNutrients(wx, wz, strength, radius) {
    const { soilGrid } = get();
    if (soilGrid) {
      soilGrid.paintNutrients(wx, wz, strength, radius);
      set({ time: get().time });
    }
  },

  play() {
    if (get().isPlaying) return;
    set({ isPlaying: true });
    _playInterval = setInterval(() => {
      const s = get();
      if (s.rootSimYear >= s.rootSimEndYear) {
        get().pause();
      } else {
        set({ rootSimYear: s.rootSimYear + 1 });
      }
    }, Math.max(50, Math.round(500 / (get().speed || 1))));
  },

  pause() {
    if (_playInterval) {
      clearInterval(_playInterval);
      _playInterval = null;
    }
    set({ isPlaying: false });
  },

  setSpeed: (s) => set({ speed: s }),
  setView: (v) => set({ activeView: v }),
  setLanguage: (l) => set({ language: l }),
  setLocation: (loc) => set({ location: loc }),

  selectTree(id, multi = false) {
    set(s => {
      if (!multi) return { selectedTreeIds: [id] };
      const ids = s.selectedTreeIds;
      return { selectedTreeIds: ids.includes(id) ? ids.filter(v => v !== id) : [id, ...ids] };
    });
  },

  setSelectedFeature(f) { set({ selectedFeature: f }); },
  setInteractionMode(m) { set({ interactionMode: m }); },
  setViewMode(m) { set({ viewMode: m }); },
  setShowBuildings(val) { set({ showBuildings: val }); },
  setShowUrbanTrees(val) { set({ showUrbanTrees: val }); },

  setRootSimYear(year) { set({ rootSimYear: year }); },
  setRootSimStartYear(year) { set({ rootSimStartYear: year, rootSimYear: Math.max(year, get().rootSimYear) }); },
  setRootSimEndYear(year) { set({ rootSimEndYear: year }); },

  acceptPin(pin) {
    set(s => ({ acceptedPins: [...s.acceptedPins, { ...pin, id: Date.now() }] }));
  },
  removePin(id) {
    set(s => ({
      acceptedPins: s.acceptedPins.filter(p => p.id !== id),
      comparingPinIds: s.comparingPinIds.filter(pid => pid !== id),
    }));
  },
  toggleComparePin(id) {
    set(s => {
      const has = s.comparingPinIds.includes(id);
      return { comparingPinIds: has ? s.comparingPinIds.filter(pid => pid !== id) : [...s.comparingPinIds, id] };
    });
  },
  clearComparePins() { set({ comparingPinIds: [] }); },
  setCandidatePlantMode(val) { set({ candidatePlantMode: val }); },
  setCandidateLocation(loc) { set({ candidateLocation: loc }); },
  setViabilityResults(res) { set({ viabilityResults: res }); },

})));
