import sys, json, math, argparse, requests
from osgeo import osr

def transform_coords(lat, lon, src_epsg=4326, dst_epsg=3857):
    src = osr.SpatialReference(); src.ImportFromEPSG(src_epsg)
    src.SetAxisMappingStrategy(osr.OAMS_TRADITIONAL_GIS_ORDER)
    dst = osr.SpatialReference(); dst.ImportFromEPSG(dst_epsg)
    dst.SetAxisMappingStrategy(osr.OAMS_TRADITIONAL_GIS_ORDER)
    t = osr.CoordinateTransformation(src, dst)
    x, y, _ = t.TransformPoint(lon, lat)
    return x, y

def fetch_buildings(lat, lon, half_m=150.0):
    # Convert center + half_m to lat/lon bbox for Overpass
    # Approximate: 1 deg lat ≈ 111320m, 1 deg lon ≈ 111320*cos(lat)
    dlat = half_m / 111320.0
    dlon = half_m / (111320.0 * math.cos(math.radians(lat)))
    
    south, north = lat - dlat, lat + dlat
    west,  east  = lon - dlon, lon + dlon

    query = f"""
    [out:json][timeout:25];
    (
      way["building"]({south},{west},{north},{east});
      relation["building"]({south},{west},{north},{east});
    );
    out body; >; out skel qt;
    """
    r = requests.post("https://overpass-api.de/api/interpreter", data=query, timeout=30)
    r.raise_for_status()
    return r.json(), (south, west, north, east)

def osm_to_geojson(osm_data):
    # Build node lookup
    nodes = {n["id"]: (n["lon"], n["lat"]) 
             for n in osm_data["elements"] if n["type"] == "node"}
    
    features = []
    for el in osm_data["elements"]:
        if el["type"] != "way": continue
        if "nodes" not in el: continue
        
        coords_latlon = [nodes[nid] for nid in el["nodes"] if nid in nodes]
        if len(coords_latlon) < 3: continue
        
        # Convert each vertex to EPSG:3857
        coords_3857 = [transform_coords(lat, lon) for lon, lat in coords_latlon]
        
        tags = el.get("tags", {})
        # Height: prefer height tag, fallback to building:levels * 3.5, fallback 10m
        height = 10.0
        if "height" in tags:
            try: height = float(tags["height"].replace("m","").strip())
            except: pass
        elif "building:levels" in tags:
            try: height = float(tags["building:levels"]) * 3.5
            except: pass
        
        features.append({
            "type": "Feature",
            "properties": {
                "height": height,
                "name": tags.get("name", ""),
                "type": tags.get("building", "yes")
            },
            "geometry": {
                "type": "Polygon",
                "coordinates": [coords_3857]
            }
        })
    
    return {"type": "FeatureCollection", "features": features}

if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--lat",    type=float, required=True)
    parser.add_argument("--lon",    type=float, required=True)
    parser.add_argument("--half_m", type=float, default=150.0)
    args = parser.parse_args()
    
    osm_raw, bbox = fetch_buildings(args.lat, args.lon, args.half_m)
    geojson = osm_to_geojson(osm_raw)
    
    print(json.dumps({"geojson": geojson, "bbox": bbox}))