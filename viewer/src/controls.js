import * as THREE from 'three';
import { PointerLockControls } from 'three/addons/controls/PointerLockControls.js';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';

const MOVE_SPEED = 3.0; // m/s
const EYE_HEIGHT = 1.6; // meters
const PLAYER_RADIUS = 0.2; // meters (half-width of player AABB)

/**
 * Set up FPS and Orbit controls with collision detection.
 * Returns a controller object with update(), setMode(), etc.
 */
export function setupControls(camera, renderer, wallAABBs, planCenter, ceilingGroup) {
  // FPS controls
  const fpsControls = new PointerLockControls(camera, renderer.domElement);

  // Orbit controls
  const orbitControls = new OrbitControls(camera, renderer.domElement);
  orbitControls.target.copy(planCenter);
  orbitControls.enableDamping = true;
  orbitControls.dampingFactor = 0.1;
  orbitControls.maxPolarAngle = Math.PI / 2 - 0.05;

  // Movement state
  const keys = { forward: false, backward: false, left: false, right: false };
  let mode = 'orbit'; // 'orbit' | 'fps'
  const velocity = new THREE.Vector3();

  // Key handlers
  function onKeyDown(e) {
    switch (e.code) {
      case 'KeyW': keys.forward = true; break;
      case 'KeyS': keys.backward = true; break;
      case 'KeyA': keys.left = true; break;
      case 'KeyD': keys.right = true; break;
    }
  }
  function onKeyUp(e) {
    switch (e.code) {
      case 'KeyW': keys.forward = false; break;
      case 'KeyS': keys.backward = false; break;
      case 'KeyA': keys.left = false; break;
      case 'KeyD': keys.right = false; break;
    }
  }
  document.addEventListener('keydown', onKeyDown);
  document.addEventListener('keyup', onKeyUp);

  // Pointer lock events
  fpsControls.addEventListener('lock', () => {
    document.getElementById('overlay')?.classList.add('hidden');
    document.getElementById('crosshair')?.classList.remove('hidden');
  });
  fpsControls.addEventListener('unlock', () => {
    if (mode === 'fps') {
      document.getElementById('overlay')?.classList.remove('hidden');
      document.getElementById('crosshair')?.classList.add('hidden');
    }
  });

  /**
   * Test if a player AABB at position collides with any wall.
   */
  function collides(pos) {
    const playerBox = new THREE.Box3(
      new THREE.Vector3(pos.x - PLAYER_RADIUS, 0, pos.z - PLAYER_RADIUS),
      new THREE.Vector3(pos.x + PLAYER_RADIUS, EYE_HEIGHT, pos.z + PLAYER_RADIUS)
    );
    for (const aabb of wallAABBs) {
      if (playerBox.intersectsBox(aabb)) return true;
    }
    return false;
  }

  const controller = {
    mode,

    setMode(newMode) {
      mode = newMode;
      if (mode === 'fps') {
        orbitControls.enabled = false;
        if (ceilingGroup) ceilingGroup.visible = true;
        fpsControls.lock();
        camera.position.y = EYE_HEIGHT;
      } else {
        fpsControls.unlock();
        orbitControls.enabled = true;
        if (ceilingGroup) ceilingGroup.visible = false;
        // Position camera at a dollhouse angle looking down into the rooms
        camera.position.set(planCenter.x, 14, planCenter.z + 10);
        orbitControls.target.set(planCenter.x, 1, planCenter.z);
        orbitControls.update();
        document.getElementById('crosshair')?.classList.add('hidden');
        document.getElementById('overlay')?.classList.add('hidden');
      }
      controller.mode = mode;
    },

    update(deltaTime) {
      if (mode === 'orbit') {
        orbitControls.update();
        return;
      }

      if (!fpsControls.isLocked) return;

      // Compute movement direction in world space
      const forward = new THREE.Vector3();
      camera.getWorldDirection(forward);
      forward.y = 0;
      forward.normalize();

      const right = new THREE.Vector3();
      right.crossVectors(forward, new THREE.Vector3(0, 1, 0)).normalize();

      velocity.set(0, 0, 0);
      if (keys.forward) velocity.add(forward);
      if (keys.backward) velocity.sub(forward);
      if (keys.right) velocity.add(right);
      if (keys.left) velocity.sub(right);

      if (velocity.lengthSq() > 0) {
        velocity.normalize().multiplyScalar(MOVE_SPEED * deltaTime);

        const currentPos = camera.position.clone();

        // Try full movement
        const candidate = currentPos.clone().add(velocity);
        candidate.y = EYE_HEIGHT;

        if (!collides(candidate)) {
          camera.position.copy(candidate);
        } else {
          // Sliding response: try X-only
          const xOnly = currentPos.clone();
          xOnly.x += velocity.x;
          xOnly.y = EYE_HEIGHT;
          if (!collides(xOnly)) {
            camera.position.copy(xOnly);
          } else {
            // Try Z-only
            const zOnly = currentPos.clone();
            zOnly.z += velocity.z;
            zOnly.y = EYE_HEIGHT;
            if (!collides(zOnly)) {
              camera.position.copy(zOnly);
            }
            // else: fully blocked, no movement
          }
        }
      }
    },

    /**
     * Enter FPS mode via click
     */
    lock() {
      if (mode === 'fps') {
        fpsControls.lock();
      }
    },

    dispose() {
      document.removeEventListener('keydown', onKeyDown);
      document.removeEventListener('keyup', onKeyUp);
      fpsControls.dispose();
      orbitControls.dispose();
    }
  };

  return controller;
}
