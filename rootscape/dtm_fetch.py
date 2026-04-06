import sys, os, json, argparse, math, base64, requests, concurrent.futures
from io import BytesIO

def log_debug(msg):
    sys.stderr.write(f"[dtm-debug] {msg}\n")
    sys.stderr.flush()

# Bootstrap GIS libs
try:
    import numpy as np
    from PIL import Image
    _ = np.finfo(np.float32)
except Exception as e:
    print(json.dumps({"error": f"Import failed: {str(e)}"}))
    sys.exit(1)

import rasterio
from rasterio.io import MemoryFile
from rasterio.transform import from_bounds as rio_from_bounds
from rasterio.windows import from_bounds as rio_window_from_bounds
from rasterio.warp import calculate_default_transform, reproject, Resampling, transform_bounds as warp_transform_bounds

# TU Wien 1m GT (Austria)
DTM_PATH_DEFAULT = 'https://gataki.cg.tuwien.ac.at/raw/Oe_2020/OeRect_01m_gt_31287.img'

# Terrain RGB Sources
SOURCES = {
    "alpine": "https://alpinemaps.cg.tuwien.ac.at/tiles/at_dtm_mapbox_terrain_rgb/{z}/{x}/{y}.png",
    "generic": "https://alpinemaps.cg.tuwien.ac.at/tiles/mapbox_terrain_rgb/{z}/{x}/{y}.png"
}

GRID_RES = 256
ORTHO_RES = 1024

# Manual Web Mercator Projection (EPSG:3857)
# R = 6378137
def transform_coords(lat, lon):
    x = lon * (math.pi / 180.0) * 6378137.0
    y = math.log(math.tan((90.0 + lat) * (math.pi / 360.0))) * 6378137.0
    return x, y

def inv_transform_coords(x, y):
    lon = (x / 6378137.0) * (180.0 / math.pi)
    lat = (math.atan(math.exp(y / 6378137.0)) * 2.0 - (math.pi / 2.0)) * (180.0 / math.pi)
    return lat, lon

def deg2num(lat_deg, lon_deg, zoom):
    lat_rad = math.radians(lat_deg)
    n = 2.0 ** zoom
    xtile = int((lon_deg + 180.0) / 360.0 * n)
    ytile = int((1.0 - math.log(math.tan(lat_rad) + (1.0 / math.cos(lat_rad))) / math.pi) / 2.0 * n)
    return xtile, ytile

def tile_to_lonlat_bounds(xt, yt, z):
    n = 2.0 ** z
    def x2lon(x, n): return x / n * 360.0 - 180.0
    def y2lat(y, n):
        lat_rad = math.atan(math.sinh(math.pi * (1 - 2 * y / n)))
        return math.degrees(lat_rad)
    w = x2lon(xt, n)
    e = x2lon(xt + 1, n)
    n_lat = y2lat(yt, n)
    s_lat = y2lat(yt + 1, n)
    return w, s_lat, e, n_lat

def get_terrain_rgb_stitched_source(lat, lon, half_m, source_key="generic"):
    # Zoom level logic: Use lower zoom for massive areas to prevent thousands of tile requests
    zoom = 15
    if half_m < 500: zoom = 16
    elif half_m > 1500: zoom = 14
    
    # Calculate tile size at this latitude (~4.77m * 256 * cos(lat) at Z15)
    meters_per_px = 156543.03 / (2 ** zoom)
    tile_m = meters_per_px * 256 * math.cos(math.radians(lat))
    
    # Determine how many tiles we need to cover the radius (radius * 2 / tile_m)
    # Adding +1 buffer on each side for safety
    tile_radius = int(math.ceil(half_m / tile_m)) + 1
    grid_size = tile_radius * 2 + 1
    canvas_px = grid_size * 256
    
    cx, cy = deg2num(lat, lon, zoom)
    base_url = SOURCES.get(source_key, SOURCES["generic"])
    
    items = []
    for dy in range(-tile_radius, tile_radius + 1):
        for dx in range(-tile_radius, tile_radius + 1):
            items.append(((dx, dy), base_url.format(z=zoom, x=cx+dx, y=cy+dy)))
            
    def _f(item):
        coords, url = item
        try:
            r = requests.get(url, timeout=4)
            if r.status_code == 200:
                img = Image.open(BytesIO(r.content)).convert('RGB').resize((256, 256), Image.NEAREST)
                return (coords, np.array(img))
        except: return None
        return None

    tiles = []
    with concurrent.futures.ThreadPoolExecutor(max_workers=10) as ex:
        for res in ex.map(_f, items):
            if res: tiles.append(res)
            
    if not tiles: return None

    full_img = np.zeros((canvas_px, canvas_px, 3), dtype=np.uint8)
    for (dx, dy), data in tiles:
        full_img[(dy+tile_radius)*256:(dy+tile_radius+1)*256, (dx+tile_radius)*256:(dx+tile_radius+1)*256] = data
        
    r, g, b = full_img[:,:,0].astype(np.float32), full_img[:,:,1].astype(np.float32), full_img[:,:,2].astype(np.float32)
    h_data = -10000.0 + ((r * 65536.0 + g * 256.0 + b) * 0.1)
    
    # New BBox logic mapping the full extent of the fetched grid
    w1, s1, e1, n1 = tile_to_lonlat_bounds(cx - tile_radius, cy - tile_radius, zoom)
    w2, s2, e2, n2 = tile_to_lonlat_bounds(cx + tile_radius, cy + tile_radius, zoom)
    
    # Bound corners in Web Mercator
    min_x, min_y = transform_coords_wm(s2, w1)
    max_x, max_y = transform_coords_wm(n1, e2) 
    
    transform = rio_from_bounds(min_x, min_y, max_x, max_y, canvas_px, canvas_px)
    bounds = {"minX": min_x, "minY": min_y, "maxX": max_x, "maxY": max_y}
    return h_data, transform, bounds

def transform_coords_wm(lat, lon):
    # Standard Web Mercator (EPSG:3857)
    x = lon * (math.pi / 180.0) * 6378137.0
    y = math.log(math.tan((90.0 + lat) * math.pi / 360.0)) * 6378137.0
    return x, y

def fetch_osm_buildings(lat, lon, half_m):
    tx, ty = transform_coords(lat, lon)
    cache_path = "buildings_vienna_cache.json"
    source_data = None
    
    if os.path.exists(cache_path):
        log_debug("Using local buildings cache...")
        try:
            with open(cache_path, 'r', encoding='utf-8') as f:
                source_data = json.load(f)
        except Exception as e:
            log_debug(f"Cache read fail: {e}")

    if not source_data:
        log_debug(f"Fetching live OSM buildings for {lat},{lon}...")
        s, w = inv_transform_coords(tx - half_m, ty - half_m)
        n, e = inv_transform_coords(tx + half_m, ty + half_m)
        query = f"""
        [out:json][timeout:25];
        (
          way["building"]({s},{w},{n},{e});
          relation["building"]["type"="multipolygon"]({s},{w},{n},{e});
        );
        out body; >; out skel qt;
        """
        try:
            r = requests.post("https://overpass-api.de/api/interpreter", data=query, timeout=20)
            r.raise_for_status()
            source_data = r.json()
        except:
            return {"type": "FeatureCollection", "features": []}

    nodes = {n["id"]: (n["lon"], n["lat"]) for n in source_data.get("elements", []) if n["type"] == "node"}
    ways = {w["id"]: w["nodes"] for w in source_data.get("elements", []) if w["type"] == "way"}
    features = []
    
    for el in source_data.get("elements", []):
        tags = el.get("tags", {})
        if "building" not in tags: continue
        
        coords_3857_outer = []
        
        if el["type"] == "way":
            coords_pts = [nodes[nid] for nid in el.get("nodes", []) if nid in nodes]
            if len(coords_pts) < 3: continue
            coords_3857_outer = [transform_coords(lat, lon) for lon, lat in coords_pts]
            
        elif el["type"] == "relation":
            # Just take the first 'outer' way member for simplicity
            for member in el.get("members", []):
                if member["type"] == "way" and member.get("role") == "outer":
                    wid = member["ref"]
                    if wid in ways:
                        coords_pts = [nodes[nid] for nid in ways[wid] if nid in nodes]
                        if len(coords_pts) >= 3:
                            coords_3857_outer = [transform_coords(lat, lon) for lon, lat in coords_pts]
                            break

        if not coords_3857_outer: continue

        # Centroid check for culling
        avg_x = sum(p[0] for p in coords_3857_outer) / len(coords_3857_outer)
        avg_y = sum(p[1] for p in coords_3857_outer) / len(coords_3857_outer)
        
        if abs(avg_x - tx) <= half_m * 1.2 and abs(avg_y - ty) <= half_m * 1.2:
            h = 10.0
            if "height" in tags:
                try: h = float(tags["height"].replace("m","").strip())
                except: pass
            elif "building:levels" in tags:
                try: h = float(tags["building:levels"]) * 3.5
                except: pass

            features.append({
                "type": "Feature",
                "id": el["id"],
                "properties": {"height": h, "name": tags.get("name", ""), "building": tags.get("building", "yes")},
                "geometry": {"type": "Polygon", "coordinates": [coords_3857_outer]}
            })
    return {"type": "FeatureCollection", "features": features}

def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--lat', type=float, required=True)
    parser.add_argument('--lon', type=float, required=True)
    parser.add_argument('--half_m', type=float, default=150.0)
    parser.add_argument('--use_alpine', type=str, default='false')
    args = parser.parse_args()

    tx, ty = transform_coords(args.lat, args.lon)
    half = args.half_m
    dst_bounds = [tx - half, ty - half, tx + half, ty + half]
    dst_crs = 'EPSG:3857'

    source_key = "alpine" if args.use_alpine.lower() == 'true' else "generic"

    try:
        # 1. DTM
        h_out = np.zeros((GRID_RES, GRID_RES), np.float32)
        rgb_result = get_terrain_rgb_stitched_source(args.lat, args.lon, half, "alpine")
        actual_bounds = None
        
        if rgb_result:
            h_in, transform_in, actual_bounds = rgb_result
            # Use dynamic dimensions from stitched image
            ih, iw = h_in.shape
            with MemoryFile().open(driver='GTiff', count=1, dtype='float32', width=iw, height=ih, transform=transform_in, crs=dst_crs) as mem:
                mem.write(h_in, 1)
                reproject(rasterio.band(mem, 1), h_out, src_transform=mem.transform, src_crs=mem.crs, 
                          dst_transform=rio_from_bounds(*dst_bounds, GRID_RES, GRID_RES), dst_crs=dst_crs, resampling=Resampling.bilinear)
        else:
            with rasterio.open(DTM_PATH_DEFAULT) as src:
                reproject(rasterio.band(src, 1), h_out, src_transform=src.transform, src_crs=src.crs, 
                          dst_transform=rio_from_bounds(*dst_bounds, GRID_RES, GRID_RES), dst_crs=dst_crs, resampling=Resampling.bilinear)

        min_elev = float(np.nanmin(h_out)) if not np.all(np.isnan(h_out)) else 0.0
        if min_elev < -9999: min_elev = 0.0
        heights_list = [round(float(v - min_elev), 3) if not np.isnan(v) else 0.0 for v in h_out.flatten()]

        # 1.5 DSM (Digital Surface Model containing Trees/Buildings)
        dsm_out = np.zeros((GRID_RES, GRID_RES), np.float32)
        rgb_dsm = get_terrain_rgb_stitched_source(args.lat, args.lon, half, "generic")
        
        if rgb_dsm:
            d_in, transform_d, _ = rgb_dsm
            ih, iw = d_in.shape
            with MemoryFile().open(driver='GTiff', count=1, dtype='float32', width=iw, height=ih, transform=transform_d, crs=dst_crs) as mem:
                mem.write(d_in, 1)
                reproject(rasterio.band(mem, 1), dsm_out, src_transform=mem.transform, src_crs=mem.crs, 
                          dst_transform=rio_from_bounds(*dst_bounds, GRID_RES, GRID_RES), dst_crs=dst_crs, resampling=Resampling.bilinear)
        else:
            dsm_out = np.copy(h_out)
            
        dsm_list = [round(float(v - min_elev), 3) if not np.isnan(v) else 0.0 for v in dsm_out.flatten()]

        # 2. Orthophoto
        ortho_base64 = None
        try:
            wmts_url = "WMTS:https://mapsneu.wien.gv.at/basemapneu/1.0.0/WMTSCapabilities.xml,layer=bmaporthofoto30cm"
            with rasterio.open(wmts_url) as src:
                ortho_bounds = warp_transform_bounds("EPSG:3857", src.crs, *dst_bounds)
                window = rio_window_from_bounds(*ortho_bounds, transform=src.transform)
                img_data = src.read([1, 2, 3], window=window, out_shape=(3, ORTHO_RES, ORTHO_RES), resampling=Resampling.bilinear)
                if img_data.any():
                    pil_img = Image.fromarray(np.transpose(img_data, (1, 2, 0)))
                    buf = BytesIO()
                    pil_img.save(buf, format="JPEG", quality=85)
                    ortho_base64 = base64.b64encode(buf.getvalue()).decode('utf-8')
        except: pass

        # 3. Buildings
        buildings_geojson = fetch_osm_buildings(args.lat, args.lon, half)

        print(json.dumps({
            "heights": heights_list, 
            "dsm": dsm_list,
            "res": GRID_RES, 
            "ortho": ortho_base64, 
            "buildings": buildings_geojson,
            "origin_3857": [tx, ty],
            "lat": args.lat, "lon": args.lon, "min_elev": round(min_elev, 2)
        }))

    except Exception as err:
        print(json.dumps({"error": str(err)}))
        sys.exit(1)

if __name__ == "__main__":
    main()
