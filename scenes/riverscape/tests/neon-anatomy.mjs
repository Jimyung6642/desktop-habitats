import { register } from 'node:module';
import assert from 'node:assert/strict';
register('./three-loader.mjs', import.meta.url);
const THREE = await import('three');
const { createFishSchool } = await import('../src/fish.js');

const scene = new THREE.Scene();
const school = createFishSchool(scene);
const body = scene.getObjectByName('Neon tetra school');
const fins = scene.getObjectByName('Attached translucent fish fins');
assert.equal(school.getTelemetry().species, 'Paracheirodon innesi');
for (const mesh of [body, fins]) {
  const geometry = mesh.geometry;
  for (const name of ['position', 'normal', 'uv', 'aPart', 'aFinProgress']) {
    assert([...geometry.getAttribute(name).array].every(Number.isFinite), `${name} must be finite`);
  }
  const normals = geometry.getAttribute('normal');
  for (let i = 0; i < normals.count; i++) {
    const length = Math.hypot(normals.getX(i), normals.getY(i), normals.getZ(i));
    assert(length > 0.99 && length < 1.01, 'Head and fin deformation need usable unit normals');
  }
  assert([...geometry.index.array].every(index => index < geometry.attributes.position.count));
}
const life = body.geometry.getAttribute('aLife');
const appearance = body.geometry.getAttribute('aAppearance');
assert.equal(life, fins.geometry.getAttribute('aLife'), 'The body and attached fins share one animation clock');
assert.equal(appearance, fins.geometry.getAttribute('aAppearance'));
const initialAppearance = [...appearance.array];
const initialLife = [...life.array];
assert(new Set(school.fish.map(fish => fish.breathPhase)).size > 20, 'Ventilation must not synchronize across the school');
for (let step = 1; step <= 180; step++) school.update(1 / 60, step / 60, null);
assert.notDeepEqual([...life.array], initialLife, 'Ventilation advances with simulation time');
assert.deepEqual([...appearance.array], initialAppearance, 'Colour variations must not flicker over time');
assert(school.fish.every(fish => Number.isFinite(fish.gape) && fish.gape >= 0 && fish.gape <= 1));
const pausedLife = [...life.array], pausedMatrices = [...body.instanceMatrix.array];
school.update(0, 1000, null);
assert.deepEqual([...life.array], pausedLife, 'Pause must freeze breathing and jaw animation');
assert.deepEqual([...body.instanceMatrix.array], pausedMatrices);
school.dispose();
assert.equal(scene.children.length, 0);
console.log('PASS: neon tetra geometry/normals, stable individual appearance, independent ventilation and fully frozen pause');
