import * as THREE from 'three';

// Default material palette — overridden by brand config
const DEFAULT_PALETTE = {
  floorColor: '#ffffff',
  roomFloorColor: '#c4a882',
  wallColor: '#f5f0eb',
  ceilingColor: '#ffffff',
  furnitureWood: '#b08968',
  furnitureFabric: '#8b9dc3',
  furnitureMetal: '#c0c0c0',
  furnitureCeramic: '#f0f0f0',
  terraceFloor: '#a8c5a0',
  counterTop: '#e8e0d8',
  lightingTemp: 4500
};

let activePalette = { ...DEFAULT_PALETTE };

/**
 * Create materials from the active palette.
 * Returns an object of named MeshStandardMaterials.
 */
export function createMaterials() {
  return {
    floor: new THREE.MeshStandardMaterial({
      color: activePalette.floorColor,
      roughness: 0.8,
      metalness: 0.0,
      side: THREE.DoubleSide
    }),
    wall: new THREE.MeshStandardMaterial({
      color: activePalette.wallColor,
      roughness: 0.9,
      metalness: 0.0,
      side: THREE.DoubleSide
    }),
    wallExterior: new THREE.MeshStandardMaterial({
      color: '#d0ccc7',
      roughness: 0.95,
      metalness: 0.0,
      side: THREE.DoubleSide
    }),
    ceiling: new THREE.MeshStandardMaterial({
      color: activePalette.ceilingColor,
      roughness: 1.0,
      metalness: 0.0,
      side: THREE.DoubleSide
    }),
    furnitureWood: new THREE.MeshStandardMaterial({
      color: activePalette.furnitureWood,
      roughness: 0.6,
      metalness: 0.0
    }),
    furnitureFabric: new THREE.MeshStandardMaterial({
      color: activePalette.furnitureFabric,
      roughness: 0.95,
      metalness: 0.0
    }),
    furnitureMetal: new THREE.MeshStandardMaterial({
      color: activePalette.furnitureMetal,
      roughness: 0.3,
      metalness: 0.8
    }),
    furnitureCeramic: new THREE.MeshStandardMaterial({
      color: activePalette.furnitureCeramic,
      roughness: 0.4,
      metalness: 0.1
    }),
    roomFloor: new THREE.MeshStandardMaterial({
      color: activePalette.roomFloorColor,
      roughness: 0.8,
      metalness: 0.0,
      side: THREE.DoubleSide
    }),
    terraceFloor: new THREE.MeshStandardMaterial({
      color: activePalette.terraceFloor,
      roughness: 0.9,
      metalness: 0.0,
      side: THREE.DoubleSide
    }),
    counterTop: new THREE.MeshStandardMaterial({
      color: activePalette.counterTop,
      roughness: 0.3,
      metalness: 0.05
    })
  };
}

/**
 * Apply a brand style config, then recreate materials.
 * @param {object} styleConfig - palette overrides
 * @returns {object} fresh materials
 */
export function applyStyle(styleConfig) {
  activePalette = { ...DEFAULT_PALETTE, ...styleConfig };
  return createMaterials();
}

export function getPalette() {
  return { ...activePalette };
}
