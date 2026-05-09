import * as THREE from 'three';

/**
 * Create a floor overlay showing the original 2D plan image.
 * The plane sits just above Y=0 and is scaled to match the plan dimensions.
 */
export function createOverlay(plan) {
  const planW = plan.metadata.planWidth / 1000; // meters
  const planH = plan.metadata.planHeight / 1000;
  const sourceImage = plan.metadata.sourceImage;

  const group = new THREE.Group();
  group.visible = false; // starts hidden

  if (!sourceImage) {
    // No source image — create a wireframe grid overlay instead
    createGridOverlay(plan, group, planW, planH);
  } else {
    // Load plan image as texture
    const loader = new THREE.TextureLoader();
    loader.load(`/plans/${sourceImage}`, (texture) => {
      texture.colorSpace = THREE.SRGBColorSpace;
      const geo = new THREE.PlaneGeometry(planW, planH);
      const mat = new THREE.MeshBasicMaterial({
        map: texture,
        transparent: true,
        opacity: 0.6,
        depthWrite: false,
        side: THREE.DoubleSide
      });
      const mesh = new THREE.Mesh(geo, mat);
      mesh.rotation.x = -Math.PI / 2;
      // Position at center of plan, slightly above floor
      mesh.position.set(planW / 2, 0.01, -planH / 2);
      group.add(mesh);
    });
  }

  // Always add a wireframe overlay showing parsed walls
  createWallWireframe(plan, group);

  return group;
}

/**
 * Draw parsed walls as colored lines on the floor for verification.
 */
function createWallWireframe(plan, group) {
  const material = new THREE.LineBasicMaterial({ color: 0x00ff88, linewidth: 2 });

  for (const wall of plan.walls) {
    const points = [
      new THREE.Vector3(wall.start[0] / 1000, 0.02, -wall.start[1] / 1000),
      new THREE.Vector3(wall.end[0] / 1000, 0.02, -wall.end[1] / 1000)
    ];
    const geo = new THREE.BufferGeometry().setFromPoints(points);
    const line = new THREE.Line(geo, material);
    group.add(line);
  }

  // Draw openings as red markers
  const openingMat = new THREE.LineBasicMaterial({ color: 0xff4444 });
  for (const opening of (plan.openings || [])) {
    const wall = plan.walls.find(w => w.id === opening.wallId);
    if (!wall) continue;

    const sx = wall.start[0] / 1000, sz = -wall.start[1] / 1000;
    const ex = wall.end[0] / 1000, ez = -wall.end[1] / 1000;
    const dx = ex - sx, dz = ez - sz;
    const len = Math.sqrt(dx * dx + dz * dz);
    const dirX = dx / len, dirZ = dz / len;

    const halfW = (opening.width / 1000) / 2;
    const center = opening.position * len;

    const p1 = new THREE.Vector3(
      sx + dirX * (center - halfW), 0.02,
      sz + dirZ * (center - halfW)
    );
    const p2 = new THREE.Vector3(
      sx + dirX * (center + halfW), 0.02,
      sz + dirZ * (center + halfW)
    );

    const geo = new THREE.BufferGeometry().setFromPoints([p1, p2]);
    const line = new THREE.Line(geo, openingMat);
    group.add(line);
  }
}

/**
 * Fallback grid overlay when no source image is available.
 */
function createGridOverlay(plan, group, planW, planH) {
  const gridHelper = new THREE.GridHelper(
    Math.max(planW, planH),
    Math.max(planW, planH), // 1m grid
    0x444444,
    0x222222
  );
  gridHelper.position.set(planW / 2, 0.005, -planH / 2);
  group.add(gridHelper);
}

/**
 * Toggle overlay visibility.
 */
export function toggleOverlay(overlayGroup) {
  overlayGroup.visible = !overlayGroup.visible;
  return overlayGroup.visible;
}
