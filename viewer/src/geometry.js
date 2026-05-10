import * as THREE from 'three';

/**
 * Convert JSON mm coordinates to Three.js meters.
 * JSON: X right, Y down (image coords)
 * Three.js: X right, Y up, Z away from camera
 * Mapping: jsonX → X, jsonY → +Z, height → Y
 */
function toWorld(x, y) {
  return new THREE.Vector3(x / 1000, 0, y / 1000);
}

/**
 * Build all architectural geometry from a parsed floor plan JSON.
 * Returns { group, wallAABBs } where wallAABBs is used for collision.
 */
export function buildGeometry(plan, materials) {
  const group = new THREE.Group();
  const wallAABBs = [];
  const ceilingH = (plan.metadata.ceilingHeight || 2700) / 1000; // meters

  // Index walls by id for opening lookup
  const wallMap = new Map();
  for (const wall of plan.walls) {
    wallMap.set(wall.id, wall);
  }

  // Group openings by wall id
  const openingsByWall = new Map();
  for (const opening of (plan.openings || [])) {
    if (!openingsByWall.has(opening.wallId)) {
      openingsByWall.set(opening.wallId, []);
    }
    openingsByWall.get(opening.wallId).push(opening);
  }

  // --- FLOOR ---
  buildFloor(plan, materials, group, ceilingH);

  // --- CEILING (separate group for toggling) ---
  const ceilingGroup = new THREE.Group();
  ceilingGroup.name = 'ceiling';
  buildCeiling(plan, materials, ceilingGroup, ceilingH);
  group.add(ceilingGroup);

  // --- WALLS ---
  for (const wall of plan.walls) {
    const openings = openingsByWall.get(wall.id) || [];
    buildWall(wall, openings, ceilingH, materials, group, wallAABBs);
  }


  // --- ROOM LABELS ---
  for (const room of (plan.rooms || [])) {
    addRoomLabel(room, group);
  }

  return { group, wallAABBs, ceilingGroup };
}

function buildFloor(plan, materials, group, ceilingH) {
  // Build floor from room polygons if available, otherwise from plan extents
  // Base floor covering full plan extent (fills corridors and gaps)
  const w = plan.metadata.planWidth / 1000;
  const h = plan.metadata.planHeight / 1000;
  const baseGeo = new THREE.PlaneGeometry(w, h);
  baseGeo.rotateX(-Math.PI / 2);
  const baseMesh = new THREE.Mesh(baseGeo, materials.floor);
  baseMesh.position.set(w / 2, -0.005, h / 2);
  baseMesh.receiveShadow = true;
  group.add(baseMesh);

  // Room-specific floors sit slightly above the base
  if (plan.rooms && plan.rooms.length > 0) {
    for (const room of plan.rooms) {
      const shape = new THREE.Shape();
      const pts = room.polygon;
      // Shape in XY, then rotateX(-PI/2) maps (x, y, 0) → (x, 0, -y)
      // We want world Z = +jsonY/1000 (matching walls), so shape Y = -jsonY/1000
      shape.moveTo(pts[0][0] / 1000, -pts[0][1] / 1000);
      for (let i = 1; i < pts.length; i++) {
        shape.lineTo(pts[i][0] / 1000, -pts[i][1] / 1000);
      }
      shape.lineTo(pts[0][0] / 1000, -pts[0][1] / 1000);

      const geo = new THREE.ShapeGeometry(shape);
      geo.rotateX(-Math.PI / 2);
      const floorMat = room.type === 'external_area' ? materials.terraceFloor : materials.roomFloor;
      const mesh = new THREE.Mesh(geo, floorMat);
      mesh.receiveShadow = true;
      mesh.position.y = 0;
      mesh.userData._roomFloor = true;
      mesh.userData._room = room;
      group.add(mesh);
    }
  }
}

function buildCeiling(plan, materials, group, ceilingH) {
  if (plan.rooms && plan.rooms.length > 0) {
    for (const room of plan.rooms) {
      const shape = new THREE.Shape();
      const pts = room.polygon;
      // Ceiling rotateX(PI/2) maps (x, y, 0) → (x, 0, y), so shape Y = jsonY/1000
      shape.moveTo(pts[0][0] / 1000, pts[0][1] / 1000);
      for (let i = 1; i < pts.length; i++) {
        shape.lineTo(pts[i][0] / 1000, pts[i][1] / 1000);
      }
      shape.lineTo(pts[0][0] / 1000, pts[0][1] / 1000);

      const geo = new THREE.ShapeGeometry(shape);
      geo.rotateX(Math.PI / 2); // flip for ceiling (face down)
      const mesh = new THREE.Mesh(geo, materials.ceiling);
      mesh.position.y = ceilingH;
      group.add(mesh);
    }
  }
}

/**
 * Build a wall with openings using segment decomposition.
 *
 * Strategy: split the wall into vertical strips. Solid strips are full-height boxes.
 * Opening strips are decomposed into sub-boxes (above door, below/above window).
 * Walls are extended by half-thickness at each end for miter corners.
 */
function buildWall(wall, openings, ceilingH, materials, group, wallAABBs) {
  const startX = wall.start[0] / 1000;
  const startZ = wall.start[1] / 1000;
  const endX = wall.end[0] / 1000;
  const endZ = wall.end[1] / 1000;
  const thickness = (wall.thickness || 150) / 1000;

  const dx = endX - startX;
  const dz = endZ - startZ;
  const wallLength = Math.sqrt(dx * dx + dz * dz);
  if (wallLength < 0.001) return;

  // Wall direction and normal
  const dirX = dx / wallLength;
  const dirZ = dz / wallLength;

  // Wall angle for rotation
  const angle = Math.atan2(dz, dx);

  // Extend wall by half-thickness at each end (miter)
  const extStartX = startX - dirX * thickness / 2;
  const extStartZ = startZ - dirZ * thickness / 2;
  const extLength = wallLength + thickness;

  // Sort openings by position
  const sorted = [...openings].sort((a, b) => a.position - b.position);

  // Convert opening positions to absolute distances along the ORIGINAL wall
  // (position is relative to original wall, not extended wall)
  const openingSpecs = sorted.map(o => {
    const centerDist = o.position * wallLength;
    const halfW = (o.width / 1000) / 2;
    return {
      leftDist: centerDist - halfW,
      rightDist: centerDist + halfW,
      type: o.type,
      height: (o.height || 2100) / 1000,
      sillHeight: (o.sillHeight || 0) / 1000
    };
  });

  // Offset for the extension: opening distances are relative to original start,
  // but our strips start at extStart which is thickness/2 before original start
  const extOffset = thickness / 2;

  // Build strips along the extended wall
  // Strip boundaries (distances from extStart)
  const strips = [];
  let cursor = 0; // distance from extStart

  for (const spec of openingSpecs) {
    const oLeft = spec.leftDist + extOffset;
    const oRight = spec.rightDist + extOffset;

    // Solid strip before this opening
    if (oLeft > cursor + 0.001) {
      strips.push({ from: cursor, to: oLeft, type: 'solid' });
    }
    // Opening strip
    strips.push({ from: oLeft, to: oRight, type: 'opening', spec });
    cursor = oRight;
  }
  // Final solid strip
  if (cursor < extLength - 0.001) {
    strips.push({ from: cursor, to: extLength, type: 'solid' });
  }

  // If no openings, single solid strip
  if (strips.length === 0) {
    strips.push({ from: 0, to: extLength, type: 'solid' });
  }

  for (const strip of strips) {
    const stripLen = strip.to - strip.from;
    if (stripLen < 0.001) continue;

    const stripCenterDist = (strip.from + strip.to) / 2;
    const cx = extStartX + dirX * stripCenterDist;
    const cz = extStartZ + dirZ * stripCenterDist;

    if (strip.type === 'solid') {
      // Full-height wall box
      addWallBox(cx, cz, stripLen, ceilingH, thickness, angle, 0, materials.wall, group, wallAABBs);
    } else {
      // Opening strip — decompose
      const { spec } = strip;

      // Above opening
      const aboveH = ceilingH - (spec.sillHeight + spec.height);
      if (aboveH > 0.01) {
        const aboveY = spec.sillHeight + spec.height;
        addWallBox(cx, cz, stripLen, aboveH, thickness, angle, aboveY, materials.wall, group, wallAABBs);
      }

      // Below opening (windows only)
      if (spec.sillHeight > 0.01) {
        addWallBox(cx, cz, stripLen, spec.sillHeight, thickness, angle, 0, materials.wall, group, wallAABBs);
      }
    }
  }
}

/**
 * Add a text label sprite at the midpoint of a wall.
 */
function addWallLabel(wall, ceilingH, group) {
  const midX = (wall.start[0] + wall.end[0]) / 2 / 1000;
  const midZ = (wall.start[1] + wall.end[1]) / 2 / 1000;

  const canvas = document.createElement('canvas');
  canvas.width = 128;
  canvas.height = 64;
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = 'rgba(0,0,0,0.7)';
  ctx.fillRect(4, 4, 120, 56);
  ctx.fillStyle = '#fff';
  ctx.font = 'bold 32px monospace';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(wall.id, 64, 32);

  const texture = new THREE.CanvasTexture(canvas);
  const mat = new THREE.SpriteMaterial({ map: texture, depthTest: false });
  const sprite = new THREE.Sprite(mat);
  sprite.position.set(midX, ceilingH * 0.6, midZ);
  sprite.scale.set(0.6, 0.3, 1);
  sprite.userData._primax = true;
  sprite.userData._wallLabel = true;
  group.add(sprite);
}

/**
 * Add a text label sprite at the center of a room floor.
 */
function addRoomLabel(room, group) {
  const lp = room.labelPosition;
  if (!lp) return;
  const cx = lp[0] / 1000;
  const cz = lp[1] / 1000;

  const name = room.name || room.id;
  const canvas = document.createElement('canvas');
  canvas.width = 256;
  canvas.height = 64;
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = '#555';
  ctx.font = 'bold 28px system-ui, sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(name, 128, 32);

  const texture = new THREE.CanvasTexture(canvas);
  const mat = new THREE.SpriteMaterial({ map: texture, depthTest: false, transparent: true });
  const sprite = new THREE.Sprite(mat);
  sprite.position.set(cx, 0.05, cz);
  sprite.scale.set(1.2, 0.3, 1);
  sprite.userData._primax = true;
  sprite.userData._roomLabel = true;
  group.add(sprite);
}

/**
 * Add a single wall box segment.
 */
function addWallBox(cx, cz, length, height, thickness, angle, baseY, material, group, wallAABBs) {
  const geo = new THREE.BoxGeometry(length, height, thickness);
  const mesh = new THREE.Mesh(geo, material);

  // Position: center of the box
  mesh.position.set(cx, baseY + height / 2, cz);
  mesh.rotation.y = -angle;

  mesh.castShadow = true;
  mesh.receiveShadow = true;
  group.add(mesh);

  // Compute AABB for collision
  mesh.updateMatrixWorld(true);
  const aabb = new THREE.Box3().setFromObject(mesh);
  wallAABBs.push(aabb);
}
