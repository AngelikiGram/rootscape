import os, requests, math

barks = {
  "oak": "https://upload.wikimedia.org/wikipedia/commons/thumb/c/cf/Quercus_robur_bark.jpg/512px-Quercus_robur_bark.jpg",
  "birch": "https://upload.wikimedia.org/wikipedia/commons/thumb/1/14/Betula_pendula_bark.jpg/512px-Betula_pendula_bark.jpg",
  "pine": "https://upload.wikimedia.org/wikipedia/commons/thumb/f/f6/Pinus_sylvestris_bark.jpg/512px-Pinus_sylvestris_bark.jpg",
  "spruce": "https://upload.wikimedia.org/wikipedia/commons/thumb/6/6c/Picea_abies_bark.jpg/512px-Picea_abies_bark.jpg",
  "beech": "https://upload.wikimedia.org/wikipedia/commons/thumb/7/7b/Fagus_sylvatica_bark_1.jpg/512px-Fagus_sylvatica_bark_1.jpg",
  "cherry": "https://upload.wikimedia.org/wikipedia/commons/thumb/f/fa/Cherry_bark.jpg/512px-Cherry_bark.jpg",
  "default": "https://upload.wikimedia.org/wikipedia/commons/thumb/c/cf/Quercus_robur_bark.jpg/512px-Quercus_robur_bark.jpg"
}

leaves = {
  "oak": "https://upload.wikimedia.org/wikipedia/commons/thumb/8/86/Quercus_robur_leaf.svg/512px-Quercus_robur_leaf.svg.png",
  "pine": "https://upload.wikimedia.org/wikipedia/commons/thumb/6/61/Pine_needles.svg/512px-Pine_needles.svg.png",
  "birch": "https://upload.wikimedia.org/wikipedia/commons/thumb/4/45/Betula_pendula_leaf.svg/512px-Betula_pendula_leaf.svg.png",
  "spruce": "https://upload.wikimedia.org/wikipedia/commons/thumb/6/61/Pine_needles.svg/512px-Pine_needles.svg.png", 
  "beech": "https://upload.wikimedia.org/wikipedia/commons/thumb/8/8d/Fagus_sylvatica_leaf.svg/512px-Fagus_sylvatica_leaf.svg.png",
  "cherry": "https://upload.wikimedia.org/wikipedia/commons/thumb/6/68/Prunus_avium_leaf.svg/512px-Prunus_avium_leaf.svg.png",
  "default": "https://upload.wikimedia.org/wikipedia/commons/thumb/8/86/Quercus_robur_leaf.svg/512px-Quercus_robur_leaf.svg.png"
}

os.makedirs('rootscape/public/textures/species/leaves', exist_ok=True)
os.makedirs('rootscape/public/textures/species/barks', exist_ok=True)

headers = {'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/114.0.0.0 Safari/537.36'}

for name, url in leaves.items():
    res = requests.get(url, headers=headers)
    if res.status_code == 200:
        with open(f"rootscape/public/textures/species/leaves/{name}.png", "wb") as f:
            f.write(res.content)
            
for name, url in barks.items():
    res = requests.get(url, headers=headers)
    if res.status_code == 200:
        with open(f"rootscape/public/textures/species/barks/{name}.jpg", "wb") as f:
            f.write(res.content)

print("Downloaded textures!")
