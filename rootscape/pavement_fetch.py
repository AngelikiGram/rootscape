import os, json, argparse, math, requests

# Manual Mercator (EPSG:3857)
def transform_coords_local(lat, lon):
    x = lon * (math.pi / 180.0) * 6378137.0
    y = math.log(math.tan((90.0 + lat) * (math.pi / 360.0))) * 6378137.0
    return x, y

SURFACE_IMPERMEABILITY = {
    "asphalt":        1.0,
    "concrete":       1.0,
    "paving_stones":  0.9,
    "cobblestone":    0.8,
    "sett":           0.8,
    "compacted":      0.5,
    "fine_gravel":    0.4,
    "gravel":         0.3,
    "pebblestone":    0.3,
    "grass":          0.05,
    "dirt":           0.05,
    "ground":         0.05,
    "unpaved":        0.1,
    "unknown":        0.5,
}

def fetch_pavements(lat, lon, half_m=450.0):
    dlat = half_m / 111320.0
    dlon = half_m / (111320.0 * math.cos(math.radians(lat)))
    s, n = lat - dlat, lat + dlat
    w, e = lon - dlon, lon + dlon

    query = f"""
    [out:json][timeout:30];
    (
      way["highway"]({s},{w},{n},{e});
    );
    out body; >; out skel qt;
    """
    try:
        r = requests.post("https://overpass-api.de/api/interpreter", data=query, timeout=30)
        r.raise_for_status()
        data = r.json()
    except Exception as e:
        return {"error": str(e)}

    # Process into simple line segments with impermeability
    nodes = {n['id']: (n['lon'], n['lat']) for n in data.get('elements', []) if n['type'] == 'node'}
    pavements = []

    for el in data.get('elements', []):
        if el['type'] == 'way' and 'nodes' in el:
            tags = el.get('tags', {})
            surface = tags.get('surface', 'unknown')
            imp = SURFACE_IMPERMEABILITY.get(surface, 0.5)
            
            # Map way nodes to 3857
            pts = []
            for nid in el['nodes']:
                if nid in nodes:
                    lon, lat = nodes[nid]
                    wx, wy = transform_coords_local(lat, lon)
                    pts.append([wx, wy])
            
            if len(pts) > 1:
                pavements.append({
                    "id": el['id'],
                    "type": tags.get('highway', 'pedestrian'),
                    "surface": surface,
                    "impermeability": imp,
                    "width": tags.get('width'),
                    "lanes": tags.get('lanes'),
                    "nodes": pts
                })

    return {"pavements": pavements}

if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--lat", type=float, required=True)
    parser.add_argument("--lon", type=float, required=True)
    parser.add_argument("--half_m", type=float, default=450.0)
    args = parser.parse_args()
    
    print(json.dumps(fetch_pavements(args.lat, args.lon, args.half_m)))
