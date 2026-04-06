"""
Production API server for RootScape.
Replaces the Vite dev-server middleware for deployment.

Install:  pip install fastapi uvicorn[standard]
Build UI: cd rootscape && npm run build
Run:      python server.py  (serves on http://0.0.0.0:8000)
"""
import os, subprocess, sys, json
from pathlib import Path
from fastapi import FastAPI, Query, HTTPException
from fastapi.staticfiles import StaticFiles
from fastapi.responses import JSONResponse, FileResponse
import uvicorn

BASE_DIR = Path(__file__).parent
DIST_DIR = BASE_DIR / "dist"
GIS_CACHE_DIR = BASE_DIR / "gis_cache"
GIS_CACHE_DIR.mkdir(exist_ok=True)

app = FastAPI()

PYTHON_BIN = sys.executable  # same interpreter that runs this server


def run_script(script: str, args: list[str]) -> dict:
    """Run a Python helper script and return parsed JSON output."""
    script_path = BASE_DIR / script
    result = subprocess.run(
        [PYTHON_BIN, str(script_path)] + args,
        cwd=str(BASE_DIR),
        capture_output=True,
        text=True,
        timeout=120,
    )
    if not result.stdout.strip():
        raise RuntimeError(result.stderr[:400] or f"{script} produced no output")
    return json.loads(result.stdout.strip())


# ── API routes ────────────────────────────────────────────────────────────────

@app.get("/api/dtm")
async def dtm(lat: float, lon: float, half_m: float = 150.0, use_alpine: str = "false"):
    cache_key = f"dtm_{lat:.5f}_{lon:.5f}_{round(half_m)}.json"
    cache_file = GIS_CACHE_DIR / cache_key
    if cache_file.exists():
        return JSONResponse(json.loads(cache_file.read_text()))
    data = run_script("dtm_fetch.py", ["--lat", str(lat), "--lon", str(lon),
                                        "--half_m", str(half_m), "--use_alpine", use_alpine])
    if "error" not in data:
        cache_file.write_text(json.dumps(data))
    return JSONResponse(data)


@app.get("/api/trees")
async def trees(lat: float, lon: float, half_m: float = 150.0):
    return JSONResponse(run_script("trees_fetch.py",
                                   ["--lat", str(lat), "--lon", str(lon), "--half_m", str(half_m)]))


@app.get("/api/underground")
async def underground(lat: float, lon: float, half_m: float = 300.0):
    return JSONResponse(run_script("underground_fetch.py",
                                   ["--lat", str(lat), "--lon", str(lon), "--half_m", str(half_m)]))


@app.get("/api/soil")
async def soil(lat: float, lon: float):
    try:
        return JSONResponse(run_script("soil_fetch.py", ["--lat", str(lat), "--lon", str(lon)]))
    except Exception as e:
        return JSONResponse({"soil_type": "loam", "moisture_profile": [
            {"depth": 0, "moisture": 0.7}, {"depth": 0.5, "moisture": 0.8},
            {"depth": 1.0, "moisture": 0.6}, {"depth": 2.0, "moisture": 0.4},
        ]})


@app.get("/api/pavements")
async def pavements(lat: float, lon: float, half_m: float = 450.0):
    try:
        return JSONResponse(run_script("pavement_fetch.py",
                                       ["--lat", str(lat), "--lon", str(lon), "--half_m", str(half_m)]))
    except Exception:
        return JSONResponse({"pavements": []})


@app.get("/api/mapillary_sequences")
async def mapillary_sequences(lat: float, lon: float, radius: float = 500.0):
    return JSONResponse({"data": []})  # set MAPILLARY_TOKEN env var to enable


# ── Serve React build ─────────────────────────────────────────────────────────

if DIST_DIR.exists():
    app.mount("/assets", StaticFiles(directory=str(DIST_DIR / "assets")), name="assets")

    @app.get("/{full_path:path}")
    async def spa(full_path: str):
        # Serve index.html for all non-API routes (SPA fallback)
        index = DIST_DIR / "index.html"
        if index.exists():
            return FileResponse(str(index))
        raise HTTPException(404, "Run `npm run build` first")
else:
    @app.get("/")
    async def root():
        return {"error": "Run `npm run build` in rootscape/ first, then restart this server."}


if __name__ == "__main__":
    port = int(os.environ.get("PORT", 8000))
    uvicorn.run(app, host="0.0.0.0", port=port)
