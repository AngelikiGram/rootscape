import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { execSync } from 'child_process';
import url from 'url';

export default defineConfig({
  plugins: [react()],
  server: {
    proxy: {
      '/api': {
        target: 'http://localhost:5173', // dummy, handled by bypass
        bypass: (req, res) => {
          if (req.url.startsWith('/api/')) {
            const parsedUrl = url.parse(req.url, true);
            const endpoint = parsedUrl.pathname.replace('/api/', '');
            const query = parsedUrl.query;
            
            let script = '';
            let args = '';
            
            if (endpoint === 'dtm') {
              script = 'dtm_fetch.py';
              args = `--lat ${query.lat} --lon ${query.lon} --half_m ${query.half_m} --use_alpine ${query.use_alpine || 'false'}`;
            } else if (endpoint === 'trees') {
              script = 'trees_fetch.py';
              args = `--lat ${query.lat} --lon ${query.lon} --half_m ${query.half_m}`;
            } else if (endpoint === 'underground') {
              script = 'underground_fetch.py';
              args = `--lat ${query.lat} --lon ${query.lon} --half_m ${query.half_m}`;
            } else if (endpoint === 'soil') {
              script = 'soil_fetch.py';
              args = `--lat ${query.lat} --lon ${query.lon}`;
            } else if (endpoint === 'pavements') {
              script = 'pavement_fetch.py';
              args = `--lat ${query.lat} --lon ${query.lon} --half_m ${query.half_m}`;
            } else if (endpoint === 'facades') {
              script = 'fetch_buildings.py';
              args = `--lat ${query.lat} --lon ${query.lon}`;
            }
            
            if (script) {
              try {
                console.log(`[Vite-Bridge] Executing ${script} ${args}`);
                const output = execSync(`python ${script} ${args}`, { cwd: './', encoding: 'utf8', maxBuffer: 50 * 1024 * 1024 });
                res.setHeader('Content-Type', 'application/json');
                res.end(output);
                return false; // bypass handled
              } catch (e) {
                console.error(`[Vite-Bridge] Script failed: ${script}`, e.stderr || e.message);
                res.statusCode = 500;
                res.end(JSON.stringify({ error: e.message, stderr: e.stderr }));
                return false;
              }
            }
          }
        }
      }
    }
  }
});
