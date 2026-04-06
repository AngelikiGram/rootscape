const fs = require('fs');
const https = require('https');
const path = require('path');

const barks = {
  oak: 'https://upload.wikimedia.org/wikipedia/commons/thumb/c/cf/Quercus_robur_bark.jpg/512px-Quercus_robur_bark.jpg',
  birch: 'https://upload.wikimedia.org/wikipedia/commons/thumb/1/14/Betula_pendula_bark.jpg/512px-Betula_pendula_bark.jpg',
  pine: 'https://upload.wikimedia.org/wikipedia/commons/thumb/f/f6/Pinus_sylvestris_bark.jpg/512px-Pinus_sylvestris_bark.jpg',
  spruce: 'https://upload.wikimedia.org/wikipedia/commons/thumb/6/6c/Picea_abies_bark.jpg/512px-Picea_abies_bark.jpg',
  beech: 'https://upload.wikimedia.org/wikipedia/commons/thumb/7/7b/Fagus_sylvatica_bark_1.jpg/512px-Fagus_sylvatica_bark_1.jpg',
  cherry: 'https://upload.wikimedia.org/wikipedia/commons/thumb/f/fa/Cherry_bark.jpg/512px-Cherry_bark.jpg',
  default: 'https://upload.wikimedia.org/wikipedia/commons/thumb/c/cf/Quercus_robur_bark.jpg/512px-Quercus_robur_bark.jpg'
};

const leaves = {
  oak: 'https://upload.wikimedia.org/wikipedia/commons/thumb/8/86/Quercus_robur_leaf.svg/512px-Quercus_robur_leaf.svg.png',
  pine: 'https://upload.wikimedia.org/wikipedia/commons/thumb/6/61/Pine_needles.svg/512px-Pine_needles.svg.png',
  birch: 'https://upload.wikimedia.org/wikipedia/commons/thumb/4/45/Betula_pendula_leaf.svg/512px-Betula_pendula_leaf.svg.png',
  spruce: 'https://upload.wikimedia.org/wikipedia/commons/thumb/6/61/Pine_needles.svg/512px-Pine_needles.svg.png', // Conifer
  beech: 'https://upload.wikimedia.org/wikipedia/commons/thumb/8/8d/Fagus_sylvatica_leaf.svg/512px-Fagus_sylvatica_leaf.svg.png',
  cherry: 'https://upload.wikimedia.org/wikipedia/commons/thumb/6/68/Prunus_avium_leaf.svg/512px-Prunus_avium_leaf.svg.png',
  default: 'https://upload.wikimedia.org/wikipedia/commons/thumb/8/86/Quercus_robur_leaf.svg/512px-Quercus_robur_leaf.svg.png'
};

function download(url, filePath) {
  return new Promise((resolve, reject) => {
    https.get(url, { headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)' } }, (res) => {
      // Handle redirects if encountered
      if ([301, 302, 307, 308].includes(res.statusCode)) {
         return download(res.headers.location, filePath).then(resolve).catch(reject);
      }
      if (res.statusCode !== 200) {
        // Fallback transparent green pixel if 404
        if (filePath.includes('leaves')) {
           const emptyPx = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QzwACqAGQJp+N3wAAAABJRU5ErkJggg==', 'base64');
           fs.writeFileSync(filePath, emptyPx);
        } else {
           const brownPx = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mO8/uP1fwAG9gMm6lI88AAAAABJRU5ErkJggg==', 'base64');
           fs.writeFileSync(filePath, brownPx);
        }
        resolve();
        return;
      }
      const stream = fs.createWriteStream(filePath);
      res.pipe(stream);
      stream.on('finish', () => { stream.close(); resolve(); });
    }).on('error', reject);
  });
}

async function run() {
  const baseL = path.join(__dirname, 'rootscape', 'public', 'textures', 'species', 'leaves');
  const baseB = path.join(__dirname, 'rootscape', 'public', 'textures', 'species', 'barks');
  
  fs.mkdirSync(baseL, { recursive: true });
  fs.mkdirSync(baseB, { recursive: true });

  const tasks = [];
  for (const [species, url] of Object.entries(leaves)) {
    tasks.push(download(url, path.join(baseL, `${species}.png`)));
  }
  for (const [species, url] of Object.entries(barks)) {
    tasks.push(download(url, path.join(baseB, `${species}.jpg`)));
  }
  
  await Promise.all(tasks);
  console.log("Downloads complete!");
}

run();
