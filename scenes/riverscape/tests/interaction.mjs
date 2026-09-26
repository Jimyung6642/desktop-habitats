import { register } from 'node:module';
import assert from 'node:assert/strict';
register('./three-loader.mjs', import.meta.url);
const THREE = await import('three');
const { createPointerTracker, resolveHardscapeContact, visibleBetween } = await import('../src/interaction.js');
const { createFishSchool, BOUNDS } = await import('../src/fish.js');
const point = (x, y = 3.5, z = 2.6) => new THREE.Vector3(x, y, z);

// The same real movement must produce the same signal at browser and host event rates.
const sampled = [];
for (const hz of [30, 60, 120]) {
  const tracker = createPointerTracker();
  tracker.move(point(0), 0);
  for (let i = 1; i <= hz; i++) {
    tracker.move(point(i / hz), i * 1000 / hz);
    tracker.update(1 / hz, i * 1000 / hz);
  }
  sampled.push(tracker.state.velocity.x);
  for (let i = 1; i <= 180; i++) tracker.update(1 / 60, 1000 + i * 1000 / 60);
  assert(tracker.state.velocity.length() < 0.001, 'A stopped hand must lose its threat velocity');
  assert(tracker.state.stillFor > 2, 'A stationary hand must become available for inspection');
  tracker.move(point(7), 5000);
  assert.equal(tracker.state.velocity.length(), 0, 'Re-entering after an event gap must not create a lunge');
  tracker.clear();
  assert.equal(tracker.state, null, 'Leaving or pausing must clear the interaction');
}
assert(Math.max(...sampled) - Math.min(...sampled) < 0.02, 'Pointer response must not depend on event frequency');

const stone = [{ center: point(0, 3, 0), radius: 0.7 }];
assert(!visibleBetween(point(-2, 3, 0), point(2, 3, 0), stone), 'A rock must block sight of a pellet or hand');
assert(visibleBetween(point(-2, 4, 0), point(2, 4, 0), stone), 'Objects above a rock must remain visible');
assert(!visibleBetween(point(2, 3, 0), point(-2, 3, 0), stone), 'Occlusion must work in either direction');

// A feeding strike must slide past solid wood without tunnelling, gaining energy or
// stopping the motion parallel to the surface. Starting exactly at a centre is finite.
const contact = point(0.65, 3, 0), velocity = point(-2, 0.4, 0);
assert(resolveHardscapeContact(contact, velocity, stone, 0.2));
assert(contact.distanceTo(stone[0].center) >= 0.9);
assert.equal(velocity.x, 0);
assert.equal(velocity.y, 0.4);
assert(velocity.length() <= Math.hypot(2, 0.4));
const centered = stone[0].center.clone();
resolveHardscapeContact(centered, point(0, 0, 0), stone, 0.2);
assert(centered.toArray().every(Number.isFinite));
assert(centered.distanceTo(stone[0].center) >= 0.9);
const outside = point(2, 3, 0), unchanged = outside.clone();
assert.equal(resolveHardscapeContact(outside, velocity, stone, 0.2), false);
assert(outside.equals(unchanged), 'Contact handling must not move fish in open water');
const trunk = Array.from({ length: 12 }, (_, i) => ({ center: point(0, 1 + i * 0.35, 0), radius: 0.5 }));
const betweenSegments = point(0.42, 2.925, 0), sliding = point(-2, 1, 0.3);
const enteringSpeed = sliding.length();
resolveHardscapeContact(betweenSegments, sliding, trunk, 0.2);
assert(trunk.every(part => betweenSegments.distanceTo(part.center) >= part.radius + 0.199),
  'Contact with overlapping trunk segments must leave the fish outside every segment');
assert(sliding.length() <= enteringSpeed, 'Overlapping contacts must not add energy');

// Exercise the whole behavior with the same tracker used by the browser and wallpaper.
const school = createFishSchool(new THREE.Scene());
const tracker = createPointerTracker();
const dt = 1 / 60;
for (let i = 0; i < 480; i++) school.update(dt, i * dt, null);
tracker.move(point(-2), 8000);
let maximumObservers = 0, approached = 0;
const visits = new Map();
for (let i = 1; i <= 1800; i++) {
  const pointer = tracker.update(dt, 8000 + i * 1000 / 60);
  school.update(dt, 8 + i * dt, pointer);
  const observers = school.fish.filter(f => f.mode === 'observe');
  maximumObservers = Math.max(maximumObservers, observers.length);
  for (const fish of observers) {
    const distance = fish.position.distanceTo(pointer.position);
    if (!visits.has(fish.id)) visits.set(fish.id, { start: distance, nearest: distance });
    const visit = visits.get(fish.id);
    visit.nearest = Math.min(visit.nearest, distance);
    assert(fish.position.x >= BOUNDS.minX && fish.position.x <= BOUNDS.maxX);
    assert(fish.position.y >= BOUNDS.minY && fish.position.y <= BOUNDS.maxY);
    assert(fish.position.z >= BOUNDS.minZ && fish.position.z <= BOUNDS.maxZ);
  }
}
for (const { start, nearest } of visits.values()) if (nearest < start - 0.25) approached++;
assert(maximumObservers > 0 && maximumObservers <= 3, `A still hand should draw a few individuals, got ${maximumObservers}`);
assert(approached > 0, 'Curious fish must actually approach the glass');
assert.equal(school.getTelemetry().escapes, 0, 'A still cursor must never generate an alarm');
tracker.clear();
for (let i = 0; i < 120; i++) school.update(dt, 38 + i * dt, null);
assert(school.fish.every(f => f.mode !== 'observe'), 'Inspection must end when the hand leaves');
const before = school.fish.map(f => f.position.clone());
for (let i = 0; i < 120; i++) school.update(0, 40, null);
assert(school.fish.every((f, i) => f.position.equals(before[i])), 'Paused simulation must not advance behavior');
school.dispose();
console.log(`PASS: pointer sampling at 30/60/120 Hz, entry/exit, hardscape occlusion, ${visits.size} curious fish (${maximumObservers} at once), approach and calm recovery`);
