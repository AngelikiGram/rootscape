import urllib.request
import os
import json

leaves_dir = 'public/textures/species/leaves/'
os.makedirs(leaves_dir, exist_ok=True)

url_base = 'https://img.icons8.com/color/256/'
urls = {
    'oak': 'oak-leaf.png',
    'pine': 'pine-needle.png',
    'spruce': 'pine-needle.png',
    'birch': 'birch-leaf.png',
    'default': 'leaf.png',
    'beech': 'green-leaf.png',
    'cherry': 'cherry-blossom.png'
}

for name, filename in urls.items():
    path = os.path.join(leaves_dir, f"{name}.png")
    try:
        urllib.request.urlretrieve(url_base + filename, path)
        print(f"Downloaded {name}.png to {path}")
    except Exception as e:
        print(f"Failed {name}: {e}")
