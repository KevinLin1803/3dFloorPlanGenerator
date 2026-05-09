import * as THREE from 'three';

/**
 * Build all furniture from the plan JSON using procedural geometry.
 * Each furniture type is a function that returns a Group of meshes.
 */
export function buildFurniture(plan, materials) {
  const group = new THREE.Group();

  for (const item of (plan.furniture || [])) {
    const builder = FURNITURE_BUILDERS[item.type];
    if (!builder) {
      console.warn(`Unknown furniture type: ${item.type}`);
      continue;
    }

    const w = item.width / 1000; // meters
    const d = item.depth / 1000;
    const furnitureGroup = builder(w, d, materials);

    // Position: JSON [x,y] in mm → Three.js (x, 0, -y) in meters
    furnitureGroup.position.set(
      item.position[0] / 1000,
      0,
      -item.position[1] / 1000
    );

    // Rotation: JSON degrees clockwise → Three.js radians around Y (counter-clockwise)
    furnitureGroup.rotation.y = -item.rotation * (Math.PI / 180);

    furnitureGroup.userData = { furnitureType: item.type, id: item.id };
    group.add(furnitureGroup);
  }

  return group;
}

// --- Furniture builder functions ---
// Each receives (width, depth, materials) and returns a THREE.Group
// Origin at center-bottom of the bounding box

const FURNITURE_BUILDERS = {
  bed_single: buildBed,
  bed_double: buildBed,

  sofa(w, d, mats) {
    const g = new THREE.Group();
    const seatH = 0.4, backH = 0.3, armW = 0.1;

    // Seat
    addBox(g, w - armW * 2, seatH, d * 0.7, 0, seatH / 2, -d * 0.15, mats.furnitureFabric);
    // Back
    addBox(g, w - armW * 2, backH, d * 0.2, 0, seatH + backH / 2, d / 2 - d * 0.1, mats.furnitureFabric);
    // Arms
    addBox(g, armW, seatH + 0.1, d, -w / 2 + armW / 2, (seatH + 0.1) / 2, 0, mats.furnitureFabric);
    addBox(g, armW, seatH + 0.1, d, w / 2 - armW / 2, (seatH + 0.1) / 2, 0, mats.furnitureFabric);

    return g;
  },

  dining_table(w, d, mats) {
    const g = new THREE.Group();
    const topH = 0.04, legH = 0.72, legW = 0.05;

    // Table top
    addBox(g, w, topH, d, 0, legH + topH / 2, 0, mats.furnitureWood);
    // Legs
    const inset = 0.08;
    for (const [sx, sz] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) {
      addBox(g, legW, legH, legW,
        sx * (w / 2 - inset), legH / 2,
        sz * (d / 2 - inset), mats.furnitureWood);
    }

    return g;
  },

  chair(w, d, mats) {
    const g = new THREE.Group();
    const seatH = 0.45, seatThick = 0.04, backH = 0.4, legW = 0.035;

    // Seat
    addBox(g, w * 0.85, seatThick, d * 0.85, 0, seatH, 0, mats.furnitureWood);
    // Back
    addBox(g, w * 0.85, backH, 0.03, 0, seatH + backH / 2, d * 0.4, mats.furnitureWood);
    // Legs
    const inset = 0.05;
    for (const [sx, sz] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) {
      addBox(g, legW, seatH, legW,
        sx * (w / 2 - inset), seatH / 2,
        sz * (d / 2 - inset), mats.furnitureMetal);
    }

    return g;
  },

  toilet(w, d, mats) {
    const g = new THREE.Group();

    // Bowl (cylinder)
    const bowlGeo = new THREE.CylinderGeometry(w / 2 * 0.8, w / 2, 0.35, 16);
    const bowl = new THREE.Mesh(bowlGeo, mats.furnitureCeramic);
    bowl.position.set(0, 0.175, -d * 0.1);
    bowl.castShadow = true;
    g.add(bowl);

    // Tank
    addBox(g, w * 0.7, 0.35, d * 0.25, 0, 0.35 / 2 + 0.15, d / 2 - d * 0.125, mats.furnitureCeramic);
    // Seat ring (torus-like, simplified as flat box)
    addBox(g, w * 0.7, 0.03, d * 0.5, 0, 0.37, -d * 0.1, mats.furnitureCeramic);

    return g;
  },

  sink(w, d, mats) {
    const g = new THREE.Group();
    const counterH = 0.85;

    // Counter/vanity
    addBox(g, w, counterH, d, 0, counterH / 2, 0, mats.counterTop);
    // Basin depression (darker inset)
    addBox(g, w * 0.6, 0.02, d * 0.5, 0, counterH + 0.01, -d * 0.1, mats.furnitureMetal);
    // Faucet
    addBox(g, 0.04, 0.2, 0.04, 0, counterH + 0.1, d * 0.2, mats.furnitureMetal);

    return g;
  },

  bathtub(w, d, mats) {
    const g = new THREE.Group();
    const h = 0.55, wallThick = 0.06;

    // Outer shell
    addBox(g, w, h, d, 0, h / 2, 0, mats.furnitureCeramic);
    // Inner cavity (slightly darker)
    addBox(g, w - wallThick * 2, 0.02, d - wallThick * 2, 0, h - 0.05, 0, mats.furnitureMetal);

    return g;
  },

  shower(w, d, mats) {
    const g = new THREE.Group();

    // Base tray
    addBox(g, w, 0.05, d, 0, 0.025, 0, mats.furnitureCeramic);
    // Glass panels (thin, semi-transparent)
    const glassMat = new THREE.MeshStandardMaterial({
      color: 0xaaddff,
      transparent: true,
      opacity: 0.3,
      roughness: 0.1,
      metalness: 0.0
    });
    // Two glass walls (L-shape, assumes corner shower)
    addBox(g, w, 2.0, 0.01, 0, 1.0, -d / 2, glassMat);
    addBox(g, 0.01, 2.0, d, -w / 2, 1.0, 0, glassMat);
    // Shower head
    addBox(g, 0.1, 0.05, 0.1, 0, 1.95, d * 0.3, mats.furnitureMetal);

    return g;
  },

  kitchen_counter(w, d, mats) {
    const g = new THREE.Group();
    const h = 0.9;

    // Base cabinet
    addBox(g, w, h - 0.04, d, 0, (h - 0.04) / 2, 0, mats.furnitureWood);
    // Counter top
    addBox(g, w + 0.02, 0.04, d + 0.02, 0, h - 0.02, 0, mats.counterTop);
    // Sink inset
    addBox(g, 0.45, 0.01, 0.35, w * 0.2, h, 0, mats.furnitureMetal);

    return g;
  },

  wardrobe(w, d, mats) {
    const g = new THREE.Group();
    const h = 2.1;

    // Main body
    addBox(g, w, h, d, 0, h / 2, 0, mats.furnitureWood);
    // Door line (thin dark strip to suggest doors)
    addBox(g, 0.01, h * 0.9, 0.01, 0, h * 0.45 + h * 0.05, -d / 2 - 0.005, mats.furnitureMetal);
    // Handles
    addBox(g, 0.02, 0.15, 0.03, -0.03, h * 0.5, -d / 2 - 0.015, mats.furnitureMetal);
    addBox(g, 0.02, 0.15, 0.03, 0.03, h * 0.5, -d / 2 - 0.015, mats.furnitureMetal);

    return g;
  },

  desk(w, d, mats) {
    const g = new THREE.Group();
    const topH = 0.03, legH = 0.72, legW = 0.04;

    // Desktop
    addBox(g, w, topH, d, 0, legH + topH / 2, 0, mats.furnitureWood);
    // Legs
    for (const [sx, sz] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) {
      addBox(g, legW, legH, legW,
        sx * (w / 2 - 0.05), legH / 2,
        sz * (d / 2 - 0.05), mats.furnitureMetal);
    }

    return g;
  },

  washing_machine(w, d, mats) {
    const g = new THREE.Group();
    const h = 0.85;

    // Body
    addBox(g, w, h, d, 0, h / 2, 0, mats.furnitureCeramic);
    // Door circle (cylinder)
    const doorGeo = new THREE.CylinderGeometry(w * 0.3, w * 0.3, 0.02, 24);
    doorGeo.rotateX(Math.PI / 2);
    const door = new THREE.Mesh(doorGeo, mats.furnitureMetal);
    door.position.set(0, h * 0.45, -d / 2 - 0.01);
    door.castShadow = true;
    g.add(door);

    return g;
  },

  fridge(w, d, mats) {
    const g = new THREE.Group();
    const h = 1.8;

    // Main body
    addBox(g, w, h, d, 0, h / 2, 0, mats.furnitureCeramic);
    // Door line
    addBox(g, w * 0.9, 0.005, 0.01, 0, h * 0.6, -d / 2 - 0.005, mats.furnitureMetal);
    // Handle
    addBox(g, 0.03, 0.3, 0.03, w / 2 - 0.06, h * 0.75, -d / 2 - 0.02, mats.furnitureMetal);
    addBox(g, 0.03, 0.3, 0.03, w / 2 - 0.06, h * 0.35, -d / 2 - 0.02, mats.furnitureMetal);

    return g;
  }
};

function buildBed(w, d, mats) {
  const g = new THREE.Group();
  const frameH = 0.3, mattressH = 0.2, pillowH = 0.08;

  // Frame
  addBox(g, w, frameH, d, 0, frameH / 2, 0, mats.furnitureWood);
  // Mattress
  addBox(g, w - 0.04, mattressH, d - 0.04, 0, frameH + mattressH / 2, 0, mats.furnitureFabric);
  // Headboard
  addBox(g, w, 0.5, 0.05, 0, frameH + 0.25, d / 2 - 0.025, mats.furnitureWood);
  // Pillows
  const pillowW = (w - 0.1) / 2 - 0.05;
  addBox(g, pillowW, pillowH, 0.3, -pillowW / 2 - 0.025, frameH + mattressH + pillowH / 2, d / 2 - 0.2, mats.furnitureCeramic);
  addBox(g, pillowW, pillowH, 0.3, pillowW / 2 + 0.025, frameH + mattressH + pillowH / 2, d / 2 - 0.2, mats.furnitureCeramic);

  return g;
}

/**
 * Helper: add a box mesh to a group.
 */
function addBox(group, w, h, d, x, y, z, material) {
  const geo = new THREE.BoxGeometry(w, h, d);
  const mesh = new THREE.Mesh(geo, material);
  mesh.position.set(x, y, z);
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  group.add(mesh);
}
