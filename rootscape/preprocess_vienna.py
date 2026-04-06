import sys, json, os, requests, math

# Vienna Open Data (WFS) endpoints
WFS_BASE = "https://data.wien.gv.at/daten/geo?service=WFS&request=GetFeature&version=1.1.0&srsName=EPSG:4326&outputFormat=json"

LAYERS = {
    "trees":       "ogdwien:BAUMKATOGD",
    "ubahn_lines": "ogdwien:UBAHNOGD",
    "ubahn_stats": "ogdwien:UBAHNHALTOGD",
    "sewer_heat":  "ogdwien:ABWASSERWAERMEOGD",
    "soil_sealing":"ogdwien:VERSIEGELUNGOGD",
    "soil_map":    "ogdwien:BODENKARTEOGD",
    "water_bodies":"ogdwien:GEWAESSEROGD",
}

def log(msg):
    print(f"[vienna-pre] {msg}", file=sys.stderr)

def download_wfs(typename, filename):
    if os.path.exists(filename):
        try:
            with open(filename, 'r', encoding='utf-8') as f:
                data = json.load(f)
            if data.get('features') is not None:
                log(f"Skipping {typename}, {filename} already exists.")
                return
            log(f"Invalid cache for {typename} (missing features), re-downloading...")
        except Exception:
            log(f"Corrupt cache for {typename}, re-downloading...")
    log(f"Downloading {typename}...")
    url = f"{WFS_BASE}&typeName={typename}"
    try:
        r = requests.get(url, timeout=120)
        r.raise_for_status()
        if not r.text.strip():
            log(f"WARNING: Empty response for {typename}, skipping.")
            return
        data = r.json()
        with open(filename, 'w', encoding='utf-8') as f:
            json.dump(data, f)
        log(f"Saved {filename}")
    except Exception as e:
        log(f"WARNING: Failed to download {typename}: {e} — skipping.")

def download_osm_buildings():
    filename = "buildings_vienna_cache.json"
    if os.path.exists(filename):
        try:
            with open(filename, 'r', encoding='utf-8') as f:
                data = json.load(f)
            if data.get('elements') is not None:
                log("Skipping OSM Buildings, cache exists.")
                return
            log("Invalid buildings cache (missing elements), re-downloading...")
        except Exception:
            log("Corrupt buildings cache, re-downloading...")

    log("Downloading OSM Buildings for Vienna (approx 30MB)...")
    # BBox for Vienna roughly
    s, w, n, e = 48.11, 16.18, 48.33, 16.58
    query = f"""
    [out:json][timeout:90];
    (
      way["building"]({s},{w},{n},{e});
      relation["building"]({s},{w},{n},{e});
    );
    out body; >; out skel qt;
    """
    r = requests.post("https://overpass-api.de/api/interpreter", data=query, timeout=120)
    r.raise_for_status()
    with open(filename, 'w', encoding='utf-8') as f:
        json.dump(r.json(), f)
    log(f"Saved {filename}")

if __name__ == "__main__":
    try:
        # 1. WFS Layers
        for key, typename in LAYERS.items():
            download_wfs(typename, f"{key}_vienna_cache.json")

        # 2. OSM Buildings
        download_osm_buildings()

        log("Preprocessing complete. Your fetch scripts will now use these local caches.")
    except Exception as e:
        log(f"CRITICAL ERROR: {e}")
        sys.exit(1)
