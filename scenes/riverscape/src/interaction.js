import * as THREE from 'three';

// Browser and wallpaper pointer events arrive at different rates. Keep motion in world
// units/second, discard re-entry jumps, and let an unattended hand become still.
export function createPointerTracker() {
  let pointer = null, sampledAt = 0;
  const velocity = new THREE.Vector3();
  return {
    move(position, now) {
      const seconds = (now - sampledAt) / 1000;
      const distance = pointer ? pointer.position.distanceTo(position) : 0;
      if (!pointer || seconds <= 0 || seconds > 0.25 || distance > 4) {
        pointer = { position: position.clone(), velocity: new THREE.Vector3(), stillFor: 0 };
      } else {
        velocity.subVectors(position, pointer.position).divideScalar(seconds).clampLength(0, 12);
        pointer.velocity.lerp(velocity, 1 - Math.exp(-seconds / 0.06));
        pointer.position.copy(position);
        if (distance > 0.015) pointer.stillFor = 0;
      }
      sampledAt = now;
    },
    update(dt, now) {
      if (!pointer) return null;
      if (now - sampledAt > 60) pointer.velocity.multiplyScalar(Math.exp(-dt * 12));
      if (pointer.velocity.lengthSq() < 0.025) pointer.stillFor += dt;
      else pointer.stillFor = 0;
      return pointer;
    },
    clear() { pointer = null; },
    get state() { return pointer; },
  };
}

// The hardscape's collision spheres also block sight. No allocations in this query:
// it is used for nearby food and the hand at the glass, not for every rendered object.
export function visibleBetween(from, to, obstacles) {
  const dx = to.x - from.x, dy = to.y - from.y, dz = to.z - from.z;
  const lengthSq = dx * dx + dy * dy + dz * dz;
  if (lengthSq < 1e-8) return true;
  for (const { center, radius } of obstacles) {
    const t = THREE.MathUtils.clamp(
      ((center.x - from.x) * dx + (center.y - from.y) * dy + (center.z - from.z) * dz) / lengthSq,
      0, 1,
    );
    const x = from.x + dx * t - center.x;
    const y = from.y + dy * t - center.y;
    const z = from.z + dz * t - center.z;
    if (x * x + y * y + z * z < radius * radius) return false;
  }
  return true;
}

// Steering normally keeps fish away from wood. A fast food strike can still carry
// one across a surface in a single step. Resolve that contact without bouncing it:
// retain tangential velocity and remove only the component going into the surface.
// Repeated passes handle the overlapping spheres along a curved trunk.
export function resolveHardscapeContact(position, velocity, obstacles, clearance) {
  let contacted = false;
  for (let pass = 0; pass < 4; pass++) {
    let moved = false;
    for (const { center, radius } of obstacles) {
      let dx = position.x - center.x, dy = position.y - center.y, dz = position.z - center.z;
      const distanceSq = dx * dx + dy * dy + dz * dz;
      const separation = radius + clearance;
      if (distanceSq >= separation * separation) continue;
      const distance = Math.sqrt(distanceSq);
      if (distance > 1e-8) { dx /= distance; dy /= distance; dz /= distance; }
      else { dx = 1; dy = 0; dz = 0; }
      const correction = separation - distance + 1e-5;
      position.x += dx * correction;
      position.y += dy * correction;
      position.z += dz * correction;
      const inward = Math.min(0, velocity.x * dx + velocity.y * dy + velocity.z * dz);
      velocity.x -= inward * dx;
      velocity.y -= inward * dy;
      velocity.z -= inward * dz;
      moved = contacted = true;
    }
    if (!moved) break;
  }
  return contacted;
}
