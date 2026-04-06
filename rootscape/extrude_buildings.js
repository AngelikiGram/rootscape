import * as THREE from 'three';
import { Shape, ExtrudeGeometry } from 'three';

function buildingsToMesh(geojson, originX, originY) {
  const group = new THREE.Group();

  for (const feature of geojson.features) {
    const coords = feature.geometry.coordinates[0];
    const height = feature.properties.height;

    // Build a THREE.Shape from the polygon ring
    const shape = new THREE.Shape();
    coords.forEach(([x, y], i) => {
      // Offset relative to scene origin (your map center in EPSG:3857)
      const lx = x - originX;
      const ly = y - originY;
      i === 0 ? shape.moveTo(lx, ly) : shape.lineTo(lx, ly);
    });

    const geometry = new THREE.ExtrudeGeometry(shape, {
      depth: height,
      bevelEnabled: false,
    });

    const mesh = new THREE.Mesh(
      geometry,
      new THREE.MeshLambertMaterial({ color: 0xcccccc, opacity: 0.85, transparent: true })
    );

    // ExtrudeGeometry extrudes along Z — rotate so it stands upright
    mesh.rotation.x = -Math.PI / 2;
    group.add(mesh);
  }

  return group;
}