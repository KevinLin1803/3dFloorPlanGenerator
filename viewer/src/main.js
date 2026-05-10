import * as THREE from 'three';
import { buildGeometry } from './geometry.js';
import { buildFurniture } from './furniture.js';
import { createMaterials, applyStyle } from './materials.js';
import { setupControls } from './controls.js';
import { createOverlay, toggleOverlay } from './overlay.js';

// --- State ---
let scene, camera, renderer, controls, clock;
let overlayGroup;
let currentPlan;
let currentPlanUrl = '/data/sanctuary-quarter-1.01.json';
const raycaster = new THREE.Raycaster();
const mouse = new THREE.Vector2();

// --- Init ---
async function init() {
  // Scene
  scene = new THREE.Scene();
  scene.background = new THREE.Color(0x87ceeb); // sky blue fallback

  // Camera
  camera = new THREE.PerspectiveCamera(70, window.innerWidth / window.innerHeight, 0.05, 100);
  camera.position.set(6, 14, 10);

  // Renderer
  renderer = new THREE.WebGLRenderer({ antialias: true });
  renderer.setSize(window.innerWidth, window.innerHeight);
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFShadowMap;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.0;
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  document.getElementById('canvas-container').appendChild(renderer.domElement);

  // Clock
  clock = new THREE.Clock();

  // Lighting
  setupLighting();

  // Load default plan
  await loadPlan('/data/sanctuary-quarter-1.01.json');

  // Plan selector
  document.getElementById('select-plan').addEventListener('change', async (e) => {
    await loadPlan(e.target.value);
    document.getElementById('select-style').value = 'default';
  });

  // Load style presets
  await loadStylePresets();

  // Resize handler
  window.addEventListener('resize', onResize);

  // Keyboard shortcuts
  document.addEventListener('keydown', onGlobalKey);

  // Room hover tooltip
  renderer.domElement.addEventListener('mousemove', onMouseMove);

  // Start render loop
  animate();
}

function setupLighting() {
  // Hemisphere light for ambient
  const hemi = new THREE.HemisphereLight(0xddeeff, 0x8a7060, 0.6);
  scene.add(hemi);

  // Directional light (sun) with shadows
  const sun = new THREE.DirectionalLight(0xfff4e5, 1.2);
  sun.position.set(8, 15, 5);
  sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048);
  sun.shadow.camera.left = -15;
  sun.shadow.camera.right = 15;
  sun.shadow.camera.top = 15;
  sun.shadow.camera.bottom = -15;
  sun.shadow.camera.near = 0.5;
  sun.shadow.camera.far = 40;
  sun.shadow.bias = -0.0002;
  scene.add(sun);

  // Fill light from opposite side
  const fill = new THREE.DirectionalLight(0xc4d4ff, 0.3);
  fill.position.set(-5, 8, -5);
  scene.add(fill);

  // Interior point lights (placed after plan load)
}

async function loadPlan(url, styleConfig) {
  currentPlanUrl = url;
  const res = await fetch(url);
  currentPlan = await res.json();

  // Clear existing scene objects (keep lights)
  const toRemove = [];
  scene.traverse(child => {
    if (child.userData._primax) toRemove.push(child);
  });
  toRemove.forEach(obj => {
    obj.parent.remove(obj);
    if (obj.geometry) obj.geometry.dispose();
  });

  // Materials
  const materials = styleConfig ? applyStyle(styleConfig) : createMaterials();

  // Build architecture
  const { group: archGroup, wallAABBs, ceilingGroup } = buildGeometry(currentPlan, materials);
  archGroup.userData._primax = true;
  scene.add(archGroup);

  // Build furniture
  const furnitureGroup = buildFurniture(currentPlan, materials);
  furnitureGroup.userData._primax = true;
  scene.add(furnitureGroup);

  // Plan overlay
  overlayGroup = createOverlay(currentPlan);
  overlayGroup.userData._primax = true;
  scene.add(overlayGroup);

  // Add interior point lights per room
  addRoomLights(currentPlan);

  // Compute plan center for camera/controls
  const planCenterX = (currentPlan.metadata.planWidth / 1000) / 2;
  const planCenterZ = (currentPlan.metadata.planHeight / 1000) / 2;
  const planCenter = new THREE.Vector3(planCenterX, 0, planCenterZ);

  // Setup controls
  if (controls) controls.dispose();
  controls = setupControls(camera, renderer, wallAABBs, planCenter, ceilingGroup);
  controls.setMode('orbit');

  // Wire up UI
  setupUI(planCenter);

  updateHUD();
}

function addRoomLights(plan) {
  const ceilingH = (plan.metadata.ceilingHeight || 2700) / 1000;
  for (const room of (plan.rooms || [])) {
    // Compute room centroid
    let cx = 0, cy = 0;
    for (const pt of room.polygon) {
      cx += pt[0]; cy += pt[1];
    }
    cx = (cx / room.polygon.length) / 1000;
    cy = (cy / room.polygon.length) / 1000;

    const light = new THREE.PointLight(0xfff0dd, 0.5, 8, 1.5);
    light.position.set(cx, ceilingH - 0.1, cy);
    light.userData._primax = true;
    scene.add(light);
  }
}

function setupUI(planCenter) {
  const btnView = document.getElementById('btn-view');
  const btnOverlay = document.getElementById('btn-overlay');
  const overlay = document.getElementById('overlay');

  btnView.onclick = () => {
    const newMode = controls.mode === 'orbit' ? 'fps' : 'orbit';
    controls.setMode(newMode);
    btnView.textContent = newMode === 'orbit' ? 'Orbit View' : 'FPS View';
    btnView.classList.toggle('active', newMode === 'fps');
  };

  btnOverlay.onclick = () => {
    const visible = toggleOverlay(overlayGroup);
    btnOverlay.textContent = visible ? 'Plan: ON' : 'Plan: OFF';
    btnOverlay.classList.toggle('active', visible);
  };

  // Click canvas to enter FPS mode
  renderer.domElement.addEventListener('click', () => {
    controls.lock();
  });

  // Overlay click to start
  overlay.addEventListener('click', () => {
    if (controls.mode === 'orbit') {
      controls.setMode('fps');
      btnView.textContent = 'FPS View';
      btnView.classList.add('active');
    } else {
      controls.lock();
    }
  });
}

async function loadStylePresets() {
  const select = document.getElementById('select-style');
  try {
    // Try loading available style configs
    for (const name of ['warm-timber', 'cool-concrete']) {
      try {
        const res = await fetch(`/styles/${name}.json`);
        if (res.ok) {
          const opt = document.createElement('option');
          opt.value = name;
          opt.textContent = name.replace(/-/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
          select.appendChild(opt);
        }
      } catch { /* style not found, skip */ }
    }
  } catch { /* no styles available */ }

  select.addEventListener('change', async () => {
    const val = select.value;
    if (val === 'default') {
      await loadPlan(currentPlanUrl);
    } else {
      try {
        const res = await fetch(`/styles/${val}.json`);
        const style = await res.json();
        await loadPlan(currentPlanUrl, style);
      } catch (e) {
        console.error('Failed to load style:', e);
      }
    }
  });
}

function onGlobalKey(e) {
  if (e.code === 'KeyP') {
    const visible = toggleOverlay(overlayGroup);
    const btn = document.getElementById('btn-overlay');
    btn.textContent = visible ? 'Plan: ON' : 'Plan: OFF';
    btn.classList.toggle('active', visible);
  }
  if (e.code === 'KeyV') {
    const btnView = document.getElementById('btn-view');
    const newMode = controls.mode === 'orbit' ? 'fps' : 'orbit';
    controls.setMode(newMode);
    btnView.textContent = newMode === 'orbit' ? 'Orbit View' : 'FPS View';
    btnView.classList.toggle('active', newMode === 'fps');
  }
}

function updateHUD() {
  const hud = document.getElementById('hud');
  if (!currentPlan) return;
  const meta = currentPlan.metadata;
  hud.innerHTML = [
    `<strong>PRiMAX</strong>`,
    `${(meta.planWidth / 1000).toFixed(1)}m × ${(meta.planHeight / 1000).toFixed(1)}m`,
    `${currentPlan.walls.length} walls · ${(currentPlan.openings || []).length} openings · ${(currentPlan.furniture || []).length} items`,
    `Ceiling: ${(meta.ceilingHeight / 1000).toFixed(1)}m`
  ].join('<br>');
}

function onMouseMove(event) {
  const tooltip = document.getElementById('room-tooltip');

  mouse.x = (event.clientX / window.innerWidth) * 2 - 1;
  mouse.y = -(event.clientY / window.innerHeight) * 2 + 1;

  raycaster.setFromCamera(mouse, camera);
  const intersects = raycaster.intersectObjects(scene.children, true);

  let hit = null;
  for (const i of intersects) {
    if (i.object.userData._roomFloor) {
      hit = i.object.userData._room;
      break;
    }
  }

  if (hit) {
    const name = hit.name || hit.id;
    const dims = hit.dimensionsMm;
    let text = name;
    if (dims) {
      text += ` — ${(dims[0] / 1000).toFixed(1)}m \u00d7 ${(dims[1] / 1000).toFixed(1)}m`;
    } else if (hit.polygon) {
      // Compute bounding dimensions from polygon
      let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
      for (const pt of hit.polygon) {
        minX = Math.min(minX, pt[0]); maxX = Math.max(maxX, pt[0]);
        minY = Math.min(minY, pt[1]); maxY = Math.max(maxY, pt[1]);
      }
      const w = (maxX - minX) / 1000;
      const d = (maxY - minY) / 1000;
      text += ` — ${w.toFixed(1)}m \u00d7 ${d.toFixed(1)}m`;
    }
    tooltip.textContent = text;
    tooltip.style.display = 'block';
    tooltip.style.left = (event.clientX + 14) + 'px';
    tooltip.style.top = (event.clientY + 14) + 'px';
  } else {
    tooltip.style.display = 'none';
  }
}

function onResize() {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
}

function animate() {
  requestAnimationFrame(animate);
  const dt = clock.getDelta();
  if (controls) controls.update(dt);
  renderer.render(scene, camera);
}

// Expose for debugging
window.__primax = { get scene() { return scene; }, get camera() { return camera; } };

// Go
init().catch(console.error);
