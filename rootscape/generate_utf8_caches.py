import subprocess
import os

def run_and_save(cmd, filename):
    print(f"Running: {' '.join(cmd)}")
    # Force UTF-8 environment for subprocess
    env = os.environ.copy()
    env['PYTHONIOENCODING'] = 'utf-8'
    
    # Capture raw bytes
    result = subprocess.run(cmd, capture_output=True, env=env, shell=True)
    if result.returncode != 0:
        print(f"Error running {cmd[0]}: {result.stderr.decode('utf-8', 'ignore')}")
        return
    
    # Decode as UTF-8 and strip BOM if exists
    try:
        content = result.stdout.decode('utf-8-sig') # strips BOM automatically
    except:
        # Fallback for weird system encoding
        content = result.stdout.decode('utf-16', 'ignore')
        
    with open(filename, "w", encoding="utf-8", newline='\n') as f:
        f.write(content)
    print(f"Saved {filename} ({len(content)} chars)")

os.makedirs("public", exist_ok=True)

# Use the exact commands but captured via Python to enforce UTF-8 encoding
base_cmd = ["python"]

run_and_save(base_cmd + ["dtm_fetch.py", "--lat", "48.1995", "--lon", "16.3695", "--half_m", "350"], "public/dtm_vienna_cache.json")
run_and_save(base_cmd + ["trees_fetch.py", "--lat", "48.1995", "--lon", "16.3695", "--half_m", "350"], "public/trees_vienna_cache.json")
run_and_save(base_cmd + ["underground_fetch.py", "--lat", "48.1995", "--lon", "16.3695", "--half_m", "350"], "public/underground_vienna_cache.json")
run_and_save(base_cmd + ["pavement_fetch.py", "--lat", "48.1995", "--lon", "16.3695", "--half_m", "350"], "public/pavements_vienna_cache.json")
run_and_save(base_cmd + ["soil_fetch.py", "--lat", "48.1995", "--lon", "16.3695"], "public/soil_vienna_cache.json")

print("\nAll demo caches generated with UTF-8 encoding.")
