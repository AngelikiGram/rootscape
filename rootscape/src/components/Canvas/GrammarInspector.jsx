import React, { useRef, useEffect } from 'react';
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { useSimStore } from '../../store/simulationStore.js';
import { SPECIES } from '../../simulation/species.js';
import { formatLStringForDisplay, simulateGroveGrowth } from '../../simulation/lsystem.js';
import { makeCanopy } from '../../simulation/treeModels.js';

// ── Mini 3D Scene (Corrected Coordinate Mapping) ─────────────────
function MiniScene({ containerRef, trees, selectedTreeId }) {
  const sceneRef = useRef(null);
  const animRef   = useRef(null);

  useEffect(() => {
    const container = containerRef.current;
    if (!container || sceneRef.current) return;

    const renderer = new THREE.WebGLRenderer({ antialias: true });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.setSize(container.clientWidth, container.clientHeight);
    renderer.setClearColor(0x0a0e14);
    container.appendChild(renderer.domElement);

    const scene = new THREE.Scene();
    scene.fog = new THREE.FogExp2(0x0a0e14, 0.04);

    const camera = new THREE.PerspectiveCamera(60, container.clientWidth / container.clientHeight, 0.1, 100);
    camera.position.set(0, 8, 12);
    camera.lookAt(0, -2, 0);

    const controls = new OrbitControls(camera, renderer.domElement);
    controls.target.set(0, -2, 0);
    controls.enableDamping = true;
    controls.dampingFactor = 0.08;
    controls.update();

    scene.add(new THREE.AmbientLight(0xffffff, 0.4));
    const dir = new THREE.DirectionalLight(0xffffff, 1.0);
    dir.position.set(5, 12, 8);
    scene.add(dir);

    // Grid at surface
    scene.add(new THREE.GridHelper(20, 20, 0x1e2630, 0x14181f));

    sceneRef.current = { renderer, scene, camera, controls };

    const ro = new ResizeObserver(() => {
      const w = container.clientWidth, h = container.clientHeight;
      if (w === 0 || h === 0) return;
      renderer.setSize(w, h);
      camera.aspect = w / h;
      camera.updateProjectionMatrix();
    });
    ro.observe(container);

    const animate = () => {
      animRef.current = requestAnimationFrame(animate);
      controls.update();
      renderer.render(scene, camera);
    };
    animate();

    return () => {
      cancelAnimationFrame(animRef.current);
      ro.disconnect();
      renderer.dispose();
      if (container.contains(renderer.domElement)) container.removeChild(renderer.domElement);
      sceneRef.current = null;
    };
  }, []);

  useEffect(() => {
    const sc = sceneRef.current;
    if (!sc) return;
    const { scene } = sc;

    // Clear previous
    const toRemove = [];
    scene.traverse(o => { if (o.userData.isMiniTree) toRemove.push(o); });
    toRemove.forEach(o => scene.remove(o));

    for (const tree of trees) {
      const sp = SPECIES[tree.species];
      const isSelected = tree.id === selectedTreeId;
      
      const group = new THREE.Group();
      group.userData.isMiniTree = true;

      // Canopy (The Grove simulation approach)
      const canopy = makeCanopy(tree, tree.age);
      canopy.position.set(tree.position[0], 0, tree.position[1]);
      canopy.scale.multiplyScalar(Math.min(1.0, 0.5 + tree.age / 120));
      if (!isSelected) {
        canopy.traverse(m => { if(m.isMesh) m.material.opacity = 0.2; });
      }
      group.add(canopy);

      // Roots (absolute space)
      if (tree.segments.length > 0) {
        const segCount = Math.min(tree.segments.length, 1200);
        const segs = tree.segments.slice(-segCount);
        const positions = new Float32Array(segs.length * 6);
        const colors    = new Float32Array(segs.length * 6);
        
        let k = 0;
        for (const seg of segs) {
          const highlight = isSelected ? 1.0 : 0.4;
          const rc = (seg.competitive ? new THREE.Color(0xd29922) : new THREE.Color(sp.color)).multiplyScalar(highlight);
          
          positions[k*6] = seg.start[0]; positions[k*6+1] = seg.start[1]; positions[k*6+2] = seg.start[2];
          positions[k*6+3] = seg.end[0];   positions[k*6+4] = seg.end[1];   positions[k*6+5] = seg.end[2];
          
          colors[k*6] = rc.r; colors[k*6+1] = rc.g; colors[k*6+2] = rc.b;
          colors[k*6+3] = rc.r; colors[k*6+4] = rc.g; colors[k*6+5] = rc.b;
          k++;
        }
        
        const geo = new THREE.BufferGeometry();
        geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
        geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
        const line = new THREE.LineSegments(geo, new THREE.LineBasicMaterial({
          vertexColors: true, transparent: true, opacity: isSelected ? 1.0 : 0.25
        }));
        group.add(line);
      }
      scene.add(group);
    }
  }, [trees, selectedTreeId]);

  return null;
}

function TokenDisplay({ depthGroups, selectedTree, hoveredToken, setHoveredToken }) {
  if (!selectedTree || depthGroups.length === 0) {
    return (
      <div style={{ color: 'var(--text-dim)', fontSize: 11, padding: '40px 0', textAlign: 'center' }}>
        {selectedTree ? 'Simulating growth history...' : 'Select a tree to view bio-grammar'}
      </div>
    );
  }

  return (
    <div className="grammar-scroll">
      {depthGroups.map(({ depth, tokens }) => (
        <div key={depth} className="grammar-depth">
          <div className="grammar-depth-header">
            <span className="depth-badge">D{depth}</span>
            <span className="depth-title">
              {depth === 0 ? 'Primary Stem/Taproot' : depth === 1 ? 'Primary Lateral' : depth === 2 ? 'Secondary Branching' : 'Fine Capillaries'}
            </span>
          </div>
          <div className="grammar-tokens">
            {depth > 0 && <span className="token-bracket">[</span>}
            {tokens.map((tok, i) => (
              <span
                key={i}
                className={`token d${depth} ${tok.competitive ? 'comp' : ''} ${tok.segId === hoveredToken ? 'hover' : ''}`}
                onMouseEnter={() => setHoveredToken(tok.segId)}
                onMouseLeave={() => setHoveredToken(null)}
                title={`Order: ${depth} | Pos: ${tok.text}`}
              >
                {tok.text.replace('S', depth < 1 ? 'ROOT' : 'BR')}
              </span>
            ))}
            {depth > 0 && <span className="token-bracket">]</span>}
          </div>
        </div>
      ))}
    </div>
  );
}

export default function GrammarInspector() {
  const containerRef = useRef();
  const { trees, selectedTreeId, time, hoveredToken, setHoveredToken, setHoveredSegId } = useSimStore();

  const selectedTree = trees.find(t => t.id === selectedTreeId) || null;
  const rootDepthGroups = selectedTree
    ? formatLStringForDisplay(selectedTree.segments.slice(-250), selectedTree.id)
    : [];
  
  // Also show shoot tokens from simulation logic
  const shootGrammarGroups = selectedTree 
    ? [{ 
        depth: 'Shoot', 
        tokens: simulateGroveGrowth(selectedTree.species, selectedTree.age)
                .split(' ').filter(t => t.length > 0).map(t => ({ text: t }))
      }] 
    : [];
  
  const depthGroups = [...shootGrammarGroups, ...rootDepthGroups];

  useEffect(() => {
    setHoveredSegId(hoveredToken);
  }, [hoveredToken]);

  return (
    <div className="grammar-view">
      <div className="grammar-3d-container" ref={containerRef}>
        <MiniScene containerRef={containerRef} trees={trees} selectedTreeId={selectedTreeId} />
        {!selectedTree && <div className="grammar-overlay">🌲 Select a tree from the forest</div>}
      </div>

      <div className="grammar-sidebar">
        <div className="grammar-header">
          <h2>Bio-Grammar Analysis</h2>
          <div className="time-pill">T = {time}</div>
        </div>
        
        <div className="grammar-info-box">
          <p>This panel shows the <b>stochastic L-system syntax</b> generated by the root expansion algorithm.</p>
          <div className="grammar-legend">
             <div><span className="dot dot-0"></span> Taproot</div>
             <div><span className="dot dot-1"></span> Lateral</div>
             <div><span className="dot dot-comp"></span> Competition</div>
          </div>
        </div>

        <div className="grammar-body">
          <TokenDisplay
            depthGroups={depthGroups}
            selectedTree={selectedTree}
            hoveredToken={hoveredToken}
            setHoveredToken={setHoveredToken}
          />
        </div>

        {selectedTree && (
          <div className="grammar-footer">
            <div className="stat-grid">
               <div className="stat-item">
                 <label>Species</label>
                 <span>{SPECIES[selectedTree.species].name}</span>
               </div>
               <div className="stat-item">
                 <label>Complexity</label>
                 <span>{selectedTree.segments.length} pts</span>
               </div>
               <div className="stat-item">
                 <label>Root Strategy</label>
                 <span>{SPECIES[selectedTree.species].rootTypeLabel}</span>
               </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
