import os

# Essential cache files
targets = [
    "public/dtm_vienna_cache.json",
    "public/trees_vienna_cache.json",
    "public/underground_vienna_cache.json",
    "public/soil_vienna_cache.json",
    "public/pavements_vienna_cache.json"
]

for t in targets:
    path = f"rootscape/{t}"
    if os.path.exists(path):
        print(f"Sanitizing {path}...")
        # Read raw bytes
        with open(path, "rb") as f:
            raw = f.read()
        
        # Try to decode as UTF-16
        try:
            # We check if it looks like UTF-16le (common in Windows redirection)
            # or just decode it and re-encode it
            content = raw.decode('utf-16')
            print(f"  Detected UTF-16 (len={len(raw)} bytes)")
            # Re-save as pure UTF-8 (No BOM)
            with open(path, "w", encoding="utf-8", newline="\n") as f:
                f.write(content)
            print(f"  Saved as UTF-8 (len={os.path.getsize(path)} bytes)")
        except Exception as e:
            print(f"  Already UTF-8 or failed to decode: {e}")
    else:
        print(f"Missing {path}")
