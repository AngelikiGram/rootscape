import sys, json, argparse, requests

DEPTHS = ["0-5cm", "5-15cm", "15-30cm", "30-60cm"]
# Map SoilGrids depth labels to simulation moisture profile depths (meters)
DEPTH_MAP = {"0-5cm": 0.0, "5-15cm": 0.5, "15-30cm": 1.0, "30-60cm": 2.0}

def fetch_soil(lat, lon):
    url = "https://rest.isric.org/soilgrids/v2.0/properties/query"
    params = {
        "lon": lon, "lat": lat,
        "property": ["clay", "sand", "silt", "phh2o", "soc", "bdod"],
        "depth": DEPTHS,
        "value": ["mean"]
    }
    r = requests.get(url, params=params, timeout=20)
    r.raise_for_status()
    data = r.json()

    # Parse scaled integers into per-depth dicts
    raw = {}
    for layer in data["properties"]["layers"]:
        name = layer["name"]
        raw[name] = {}
        for depth in layer["depths"]:
            d = depth["label"]
            v = depth["values"].get("mean")
            raw[name][d] = v  # may be None if no data

    # Conversion factors (SoilGrids v2.0 integer encoding)
    # clay/sand/silt: stored as g/kg * 10 → divide by 100 to get %
    # phh2o: stored as pH * 10 → divide by 10
    # soc: stored as dg/kg → divide by 10 → g/kg
    # bdod: stored as cg/cm³ → divide by 100 → g/cm³

    def pct(name, depth):
        v = raw.get(name, {}).get(depth)
        return (v / 100.0) if v is not None else None

    clay_0 = pct("clay", "0-5cm") or 20.0
    sand_0 = pct("sand", "0-5cm") or 40.0
    silt_0 = pct("silt", "0-5cm") or 40.0
    ph_raw = raw.get("phh2o", {}).get("0-5cm")
    ph = (ph_raw / 10.0) if ph_raw is not None else 7.0
    soc_raw = raw.get("soc", {}).get("0-5cm")
    soc = (soc_raw / 10.0) if soc_raw is not None else 10.0  # g/kg

    # ── Derive soil type from texture triangle ────────────────────
    if sand_0 > 70 and clay_0 < 8:
        soil_type = "sandy"
    elif clay_0 > 35:
        soil_type = "clay"
    elif soc > 40:
        soil_type = "humus"
    else:
        soil_type = "loam"

    # ── Build moisture profile + texture profile per depth ───────
    # Saxton & Rawls (2006): FC = 0.299 - 0.251*S + 0.195*C  (volumetric)
    # Normalise to 0-1 range: sandy FC ~0.10, clay FC ~0.42
    moisture_profile = []
    texture_profile = []
    surface_fc = None
    for d in DEPTHS:
        c = pct("clay", d)
        s = pct("sand", d)
        si = pct("silt", d)
        if c is None: c = clay_0
        if s is None: s = sand_0
        if si is None: si = silt_0
        fc = 0.299 - 0.251 * (s / 100.0) + 0.195 * (c / 100.0)
        fc = max(0.05, min(0.45, fc))
        if surface_fc is None:
            surface_fc = fc
        moisture = round((fc - 0.05) / 0.40, 3)  # normalise 0.05-0.45 → 0-1
        moisture_profile.append({"depth": DEPTH_MAP[d], "moisture": moisture})
        texture_profile.append({
            "depth_label": d,
            "clay": round(c, 1),
            "sand": round(s, 1),
            "silt": round(si, 1),
        })

    return {
        "soil_type": soil_type,
        "clay_pct": round(clay_0, 1),
        "sand_pct": round(sand_0, 1),
        "silt_pct": round(silt_0, 1),
        "ph": round(ph, 1),
        "soc_gkg": round(soc, 1),
        "field_capacity": round(surface_fc, 3) if surface_fc else 0.3,
        "moisture_profile": moisture_profile,
        "texture_profile": texture_profile,
    }

if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--lat", type=float, required=True)
    parser.add_argument("--lon", type=float, required=True)
    args = parser.parse_args()
    try:
        print(json.dumps(fetch_soil(args.lat, args.lon)))
    except Exception as e:
        print(json.dumps({"error": str(e)}))
        sys.exit(1)
