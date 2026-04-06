import sys, json, argparse, math, sqlite3, os

DB_PATH = "vienna_gis.sqlite"

# Heat sensitivity by genus (0 = very tolerant, 1 = very sensitive)
HEAT_SENSITIVITY = {
    'ailanthus': 0.10, 'robinia': 0.15, 'gleditsia': 0.20,
    'platanus': 0.25, 'sophora': 0.25, 'catalpa': 0.30,
    'quercus': 0.30, 'celtis': 0.30, 'koelreuteria': 0.30,
    'tilia': 0.40, 'ginkgo': 0.35, 'ulmus': 0.40,
    'acer': 0.50, 'fraxinus': 0.55, 'carpinus': 0.55,
    'prunus': 0.60, 'betula': 0.65, 'populus': 0.60,
    'salix': 0.55, 'alnus': 0.60,
    'fagus': 0.90, 'picea': 0.85, 'abies': 0.85,
    'larix': 0.70, 'pinus': 0.45, 'pseudotsuga': 0.75,
}

def _genus_sensitivity(gattung_art):
    if not gattung_art:
        return 0.5
    genus = str(gattung_art).split()[0].lower()
    return HEAT_SENSITIVITY.get(genus, 0.5)

def _age_stress(pflanzjahr):
    if not pflanzjahr:
        return 0.5
    try:
        age = 2026 - int(pflanzjahr)
    except (ValueError, TypeError):
        return 0.5
    if age < 0: return 0.5
    if age < 8: return 0.85
    if age < 25: return 0.20
    if age < 55: return 0.35
    return 0.65

def _size_health(stammumfang, kronendurchmesser):
    score = 0.5
    try:
        s = float(stammumfang)
        if s < 15: score += 0.30
        elif s > 80: score -= 0.25
    except: pass
    try:
        k = float(kronendurchmesser)
        if k < 3: score += 0.20
        elif k > 10: score -= 0.15
    except: pass
    return max(0.0, min(1.0, score))

def _district_heat(bezirk):
    try:
        d = int(bezirk)
        if d <= 9: return 0.80
        if d <= 15: return 0.55
        return 0.25
    except: return 0.50

def compute_stress_score(props):
    age   = _age_stress(props.get('PFLANZJAHR'))
    size  = _size_health(props.get('STAMMUMFANG'), props.get('KRONENDURCHMESSER'))
    spec  = _genus_sensitivity(props.get('GATTUNG_ART'))
    dist  = _district_heat(props.get('BEZIRK'))
    return round(max(0.0, min(1.0, 0.3*age + 0.3*size + 0.25*spec + 0.15*dist)), 3)

# Manual Web Mercator Projection (EPSG:3857)
def transform_coords_local(lat, lon):
    x = lon * (math.pi / 180.0) * 6378137.0
    y = math.log(math.tan((90.0 + lat) * (math.pi / 360.0))) * 6378137.0
    return x, y

def fetch_trees_sql(lat, lon, half_m=150.0):
    tx, ty = transform_coords_local(lat, lon)
    
    # Approx radius in lon/lat
    dlat = (half_m + 50) / 111320.0
    dlon = (half_m + 50) / (111320.0 * math.cos(math.radians(lat)))
    
    res = []
    if not os.path.exists(DB_PATH):
        return {"type": "FeatureCollection", "features": []}

    conn = sqlite3.connect(DB_PATH)
    cur = conn.cursor()
    # Fast BBox query using indexes on lat/lon
    query = "SELECT id, lat, lon, properties FROM trees WHERE lat BETWEEN ? AND ? AND lon BETWEEN ? AND ?"
    cur.execute(query, (lat - dlat, lat + dlat, lon - dlon, lon + dlon))
    
    for tid, flat, flon, prop_json in cur.fetchall():
        wx, wy = transform_coords_local(flat, flon)
        # Precise filter in 3857
        if abs(wx - tx) <= half_m and abs(wy - ty) <= half_m:
            data = json.loads(prop_json)
            # The database contains a GeoJSON feature string in the properties column
            inner_props = data.get('properties', data) 
            
            # Ensure tid and other top-level metadata are included if nested
            inner_props['katasterId'] = tid
            inner_props['stress_score'] = compute_stress_score(inner_props)
            inner_props['x_3857'] = round(wx, 2)
            inner_props['y_3857'] = round(wy, 2)
            
            res.append({
                "type": "Feature",
                "id": tid,
                "geometry": {"type": "Point", "coordinates": [flon, flat]},
                "properties": inner_props
            })
    conn.close()
    return {"type": "FeatureCollection", "features": res}

if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--lat", type=float, required=True)
    parser.add_argument("--lon", type=float, required=True)
    parser.add_argument("--half_m", type=float, default=150.0)
    args = parser.parse_args()
    print(json.dumps(fetch_trees_sql(args.lat, args.lon, args.half_m)))
