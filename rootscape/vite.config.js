import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { spawn, execFileSync } from 'child_process';
import { readdirSync, existsSync } from 'fs';
import { fileURLToPath } from 'url';
import path from 'path';
import os from 'os';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const pyExe = os.platform() === 'win32' ? 'python.exe' : 'python';

function detectPython() {
  if (process.env.PYTHON_BIN) {
    console.log(`[dtm-api] Using PYTHON_BIN: ${process.env.PYTHON_BIN}`);
    return process.env.PYTHON_BIN;
  }

  const candidates = ['python', 'python3'];

  const condaRoots = [
    path.join(os.homedir(), 'miniconda3'),
    path.join(os.homedir(), 'anaconda3'),
    path.join(os.homedir(), 'miniforge3'),
    path.join(os.homedir(), 'mambaforge'),
    'C:/ProgramData/miniconda3',
    'C:/ProgramData/anaconda3',
  ];

  for (const root of condaRoots) {
    candidates.push(path.join(root, pyExe));
    const envsDir = path.join(root, 'envs');
    if (existsSync(envsDir)) {
      try {
        for (const env of readdirSync(envsDir)) {
          candidates.push(path.join(envsDir, env, pyExe));
        }
      } catch {}
    }
  }

  for (const bin of candidates) {
    try {
      execFileSync(bin, ['-c', 'import rasterio'], { stdio: 'pipe', timeout: 5000 });
      console.log(`[dtm-api] Found Python with rasterio: ${bin}`);
      return bin;
    } catch {}
  }

  console.warn('[dtm-api] No Python with rasterio found. Set PYTHON_BIN env var to your Python path.');
  return 'python';
}

const PYTHON_BIN = detectPython();

function runPython(bin, scriptPath, args, cwd) {
  return new Promise((resolve, reject) => {
    const proc = spawn(bin, [scriptPath, ...args], { cwd });
    let stdout = '';
    let stderr = '';
    proc.stdout.on('data', d => { stdout += d; });
    proc.stderr.on('data', d => {
      stderr += d;
      process.stdout.write(`[py] ${d}`);
    });
    proc.on('close', code => {
      if (!stdout.trim()) {
        reject(new Error(`Python exited ${code} with no output. stderr: ${stderr.slice(0, 400)}`));
      } else {
        resolve(stdout.trim());
      }
    });
    proc.on('error', reject);
  });
}

function dtmApiPlugin() {
  return {
    name: 'dtm-api',
    configureServer(server) {

      server.middlewares.use('/api/dtm', async (req, res) => {
        const url = new URL(req.url, 'http://localhost');
        const lat = url.searchParams.get('lat');
        const lon = url.searchParams.get('lon');
        const half_m = url.searchParams.get('half_m') || '150';
        const use_alpine = url.searchParams.get('use_alpine') || 'false';
        if (!lat || !lon) {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'lat and lon required' }));
          return;
        }
        console.log(`[dtm-api] Fetching DTM lat=${lat} lon=${lon} r=${half_m}m alpine=${use_alpine}`);
        try {
          const json = await runPython(
            PYTHON_BIN,
            path.join(__dirname, 'dtm_fetch.py'),
            ['--lat', lat, '--lon', lon, '--half_m', half_m, '--use_alpine', use_alpine],
            __dirname
          );
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(json);
        } catch (err) {
          console.error('[dtm-api] DTM fetch error:', err.message);
          res.writeHead(500, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: err.message }));
        }
      });

      server.middlewares.use('/api/trees', async (req, res) => {
        const url = new URL(req.url, 'http://localhost');
        const lat = url.searchParams.get('lat');
        const lon = url.searchParams.get('lon');
        const half_m = url.searchParams.get('half_m') || '150';
        if (!lat || !lon) {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'lat and lon required' }));
          return;
        }
        try {
          const json = await runPython(
            PYTHON_BIN,
            path.join(__dirname, 'trees_fetch.py'),
            ['--lat', lat, '--lon', lon, '--half_m', half_m],
            __dirname
          );
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(json);
        } catch (err) {
          console.warn('[dtm-api] Trees fetch error:', err.message);
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ features: [] }));
        }
      });

      server.middlewares.use('/api/underground', async (req, res) => {
        const url = new URL(req.url, 'http://localhost');
        const lat = url.searchParams.get('lat');
        const lon = url.searchParams.get('lon');
        const half_m = url.searchParams.get('half_m') || '300';
        if (!lat || !lon) {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'lat and lon required' }));
          return;
        }
        try {
          const json = await runPython(
            PYTHON_BIN,
            path.join(__dirname, 'underground_fetch.py'),
            ['--lat', lat, '--lon', lon, '--half_m', half_m],
            __dirname
          );
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(json);
        } catch (err) {
          console.warn('[dtm-api] Underground fetch error:', err.message);
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({}));
        }
      });

      server.middlewares.use('/api/soil', async (req, res) => {
        const url = new URL(req.url, 'http://localhost');
        const lat = url.searchParams.get('lat');
        const lon = url.searchParams.get('lon');
        if (!lat || !lon) {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'lat and lon required' }));
          return;
        }
        try {
          const json = await runPython(
            PYTHON_BIN,
            path.join(__dirname, 'soil_fetch.py'),
            ['--lat', lat, '--lon', lon],
            __dirname
          );
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(json);
        } catch (err) {
          console.warn('[dtm-api] Soil fetch error:', err.message);
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({
            soil_type: 'loam',
            moisture_profile: [
              { depth: 0, moisture: 0.7 },
              { depth: 0.5, moisture: 0.8 },
              { depth: 1.0, moisture: 0.6 },
              { depth: 2.0, moisture: 0.4 }
            ]
          }));
        }
      });

      server.middlewares.use('/api/pavements', async (req, res) => {
        const url = new URL(req.url, 'http://localhost');
        const lat = url.searchParams.get('lat');
        const lon = url.searchParams.get('lon');
        const half_m = url.searchParams.get('half_m') || '450';
        if (!lat || !lon) {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'lat and lon required' }));
          return;
        }
        try {
          const json = await runPython(
            PYTHON_BIN,
            path.join(__dirname, 'pavement_fetch.py'),
            ['--lat', lat, '--lon', lon, '--half_m', half_m],
            __dirname
          );
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(json);
        } catch (err) {
          console.warn('[dtm-api] Pavements fetch error:', err.message);
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ pavements: [] }));
        }
      });

      server.middlewares.use('/api/mapillary_sequences', async (req, res) => {
        const url = new URL(req.url, 'http://localhost');
        const lat = parseFloat(url.searchParams.get('lat'));
        const lon = parseFloat(url.searchParams.get('lon'));
        const radius_m = parseFloat(url.searchParams.get('radius')) || 500;
        if (!lat || !lon) {
          res.writeHead(400); res.end(JSON.stringify({ error: 'lat and lon required' }));
          return;
        }
        const TOKEN = process.env.MAPILLARY_TOKEN || '';
        if (!TOKEN) { res.writeHead(200); res.end(JSON.stringify({ error: 'No token', data: [] })); return; }

        const deg = radius_m / 111320;
        const bbox = `${(lon - deg).toFixed(5)},${(lat - deg).toFixed(5)},${(lon + deg).toFixed(5)},${(lat + deg).toFixed(5)}`;
        const mUrl = `https://graph.mapillary.com/map_features?access_token=${TOKEN}&fields=id,geometry,layer&bbox=${bbox}&layers=trajectories&limit=1000`;

        try {
          const mResp = await fetch(mUrl);
          const data = await mResp.json();
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify(data));
        } catch (e) {
          res.writeHead(500); res.end(JSON.stringify({ error: 'Mapillary sequences fail' }));
        }
      });

      server.middlewares.use('/api/facades', async (req, res) => {
        const url = new URL(req.url, 'http://localhost');
        const lat = parseFloat(url.searchParams.get('lat'));
        const lon = parseFloat(url.searchParams.get('lon'));
        if (!lat || !lon) {
          res.writeHead(400); res.end(JSON.stringify({ error: 'lat and lon required' }));
          return;
        }
        const TOKEN = process.env.MAPILLARY_TOKEN || '';
        if (!TOKEN) {
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'MAPILLARY_TOKEN not set in .env', data: [] }));
          return;
        }
        const range = 0.005;
        const blon = (lon - range).toFixed(5);
        const blat = (lat - range).toFixed(5);
        const mlon = (lon + range).toFixed(5);
        const mlat = (lat + range).toFixed(5);
        const bbox = `${blon},${blat},${mlon},${mlat}`;
        const mUrl = `https://graph.mapillary.com/images?access_token=${TOKEN}&fields=id,thumb_2048_url,thumb_1024_url,geometry,compass_angle&bbox=${bbox}&limit=10`;

        console.log(`[Mapillary] Requesting BBOX: ${bbox}`);
        try {
          const mResp = await fetch(mUrl);
          const data = await mResp.json();
          if (data.error) {
            console.error(`[Mapillary] API Error: ${data.error.message}`);
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ error: data.error.message, data: [] }));
            return;
          }
          console.log(`[Mapillary] Status: ${mResp.status}, Found: ${data.data?.length || 0} imgs`);
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify(data));
        } catch (e) {
          console.error(`[Mapillary] Fetch Error: ${e.message}`);
          res.writeHead(500); res.end(JSON.stringify({ error: 'Mapillary fetch failed' }));
        }
      });
    },
  };
}

export default defineConfig({
  base: '/rootscape/',
  plugins: [react(), dtmApiPlugin()],
  optimizeDeps: {
    include: ['three', 'd3', 'zustand'],
  },
});
