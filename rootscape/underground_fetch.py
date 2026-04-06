import os, json, argparse, math, requests

CACHES = {
    "ubahn_lines":   "ubahn_lines_vienna_cache.json",
    "ubahn_stations":"ubahn_stats_vienna_cache.json",
    "sewer_heat":    "sewer_heat_vienna_cache.json",
    "soil_sealing":  "soil_sealing_vienna_cache.json",
    "soil_map":      "soil_map_vienna_cache.json",
    "water_bodies":  "water_bodies_vienna_cache.json",
}

# Manual Mercator (EPSG:3857)
def transform_coords_local(lat, lon):
    x = lon * (math.pi / 180.0) * 6378137.0
    y = math.log(math.tan((90.0 + lat) * (math.pi / 360.0))) * 6378137.0
    return x, y

def convert_ring_to_3857(ring):
    return [list(transform_coords_local(c[1], c[0])) for c in ring]

def feature_intersects(feat, tx, ty, half_m):
    """Return True if any vertex of the feature is within the area."""
    buf = half_m + 100
    c = feat['geometry']['coordinates']
    # Flatten nested lists to get individual [lon, lat] pairs
    def iter_coords(c):
        if not c: return
        if isinstance(c[0], (int, float)):
            yield c
        else:
            for item in c:
                yield from iter_coords(item)
    for coord in iter_coords(c):
        wx, wy = transform_coords_local(coord[1], coord[0])
        if abs(wx - tx) <= buf and abs(wy - ty) <= buf:
            return True
    return False

def fetch_local(filename, tx, ty, half_m):
    if not os.path.exists(filename): return {"type": "FeatureCollection", "features": []}
    try:
        with open(filename, 'r', encoding='utf-8') as f:
            data = json.load(f)
    except Exception:
        return {"type": "FeatureCollection", "features": []}

    filtered = []
    for feat in data.get('features', []):
        if not feat.get('geometry') or not feat['geometry'].get('coordinates'): continue
        if not feature_intersects(feat, tx, ty, half_m): continue

        # Convert coordinates to EPSG:3857 for the renderer
        geom = feat['geometry']
        gtype = geom['type']
        if gtype == 'LineString':
            geom = dict(geom, coordinates=convert_ring_to_3857(geom['coordinates']))
        elif gtype == 'MultiLineString':
            geom = dict(geom, coordinates=[convert_ring_to_3857(r) for r in geom['coordinates']])
        elif gtype == 'Point':
            px, py = transform_coords_local(geom['coordinates'][1], geom['coordinates'][0])
            geom = dict(geom, coordinates=[px, py])
        filtered.append(dict(feat, geometry=geom))

    return {"type": "FeatureCollection", "features": filtered}

if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--lat", type=float, required=True)
    parser.add_argument("--lon", type=float, required=True)
    parser.add_argument("--half_m", type=float, default=300.0)
    args = parser.parse_args()

    tx, ty = transform_coords_local(args.lat, args.lon)
    half_m = args.half_m

    result = {}
    for key, filename in CACHES.items():
        result[key] = fetch_local(filename, tx, ty, half_m)

    # For OSM parts skip if we have buildings? No, tunnels are unique
    # Live fetch OSM tunnels/pipelines as they are small
    try:
        query = f"""
        [out:json][timeout:25];
        (
          way["railway"="subway"]({args.lat-0.005},{args.lon-0.007},{args.lat+0.005},{args.lon+0.007});
          way["man_made"="pipeline"]({args.lat-0.005},{args.lon-0.007},{args.lat+0.005},{args.lon+0.007});
        );
        out body; >; out skel qt;
        """
        r = requests.post("https://overpass-api.de/api/interpreter", data=query, timeout=15)
        result["osm_underground"] = r.json()
    except:
        result["osm_underground"] = {"elements": []}

    print(json.dumps(result))
