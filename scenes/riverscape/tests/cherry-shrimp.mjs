import { register } from 'node:module';
import assert from 'node:assert/strict';
register('./three-loader.mjs', import.meta.url);
const THREE=await import('three');
const {createSurfaceSupport}=await import('../src/surface-support.js');
const {createCherryShrimp}=await import('../src/cherry-shrimp.js');
const {createWoodSurface,createSwimNavigator,createShrimpHabitat}=await import('../src/shrimp-habitat.js');
const {walkingFoot}=await import('../src/shrimp-anatomy.js');
const V=(x=0,y=0,z=0)=>new THREE.Vector3(x,y,z);

// Actual mesh support, including overlapping triangles and negative bins.
const rock=new THREE.BufferGeometry();
rock.setAttribute('position',new THREE.Float32BufferAttribute([
  -1,1,-1,1,2,-1,-1,1,1,-1,.2,-1,1,.2,-1,-1,.2,1,0,0,0,0,1,0,0,2,0,
],3));
const support=createSurfaceSupport([rock],()=>-.3);
assert.equal(support.heightAt(-.5,-.5),1.25);
assert.equal(support.heightAt(-1,-1),1);
assert.equal(support.heightAt(3,3),-.3);
assert.equal(support.heightAt(0,0),1.5);
rock.setIndex([0,1,2]);
assert.equal(createSurfaceSupport([rock],()=>-.3).heightAt(-.5,-.5),1.25);

// A trunk with the same ring layout as the rendered bark. Stand vertically,
// sideways and underneath its curvature instead of pretending its surface is y(x,z).
const curve=new THREE.CatmullRomCurve3([V(4.05,.1,.35),V(4.05,3.5,.35),V(4.05,7,.35)]);
const trunk=new THREE.TubeGeometry(curve,48,.7,32,false);
trunk.userData.rings={rows:48,cols:32};
const wood=createWoodSurface(trunk,3);
const contact={point:V(),normal:V()};
for(const angle of [-Math.PI,-1.2,0,.8,2.4]) {
  wood.sample(angle,2.5,contact);
  assert(Math.abs(Math.hypot(contact.point.x-4.05,contact.point.z-.35)-.7)<.006);
  assert(contact.normal.dot(V(contact.point.x-4.05,0,contact.point.z-.35))>.69);
}
const obstacles=[];
for(let y=.1;y<7;y+=.45)obstacles.push({center:V(4.05,y,.35),radius:.7,kind:'wood',surfaceId:3});
const floor=(x,z)=>.35+.018*x-.012*z;
const ledge=createShrimpHabitat({heightAt:x=>x<0?.8:.2});
assert.equal(ledge.floorAllowed(.01,2.5),false,'Do not land with feet spanning a sheer rock edge');
assert.equal(ledge.floorAllowed(.4,2.5),false,'Keep the tail clear even when all feet fit on the lower surface');
assert.equal(ledge.floorAllowed(1,2.5),true,'The adjacent flat sand remains walkable');
const scene=new THREE.Scene();
const shrimp=createCherryShrimp(scene,{support:{heightAt:floor,woods:[wood]},obstacles});
assert.equal(shrimp.getTelemetry().count,5);
const geometries=new Set();
scene.traverse(mesh=>{if(mesh.isMesh)geometries.add(mesh.geometry);});
for(const geometry of geometries) {
  for(const key of ['position','normal','uv','color','aTissue'])
    assert([...geometry.attributes[key].array].every(Number.isFinite),key);
  const n=geometry.attributes.normal;
  for(let i=0;i<n.count;i++)assert(Math.abs(Math.hypot(n.getX(i),n.getY(i),n.getZ(i))-1)<.012);
  assert([...geometry.index.array].every(i=>i<geometry.attributes.position.count));
}
scene.traverse(o=>{o.updateMatrix();o.matrixAutoUpdate=false;});
const states=shrimp.animals.map(()=>new Set()),point=V(),worldAxis=V();
let maxContactError=0;
for(let frame=0;frame<60*420;frame++) {
  shrimp.update(1/60);
  if(frame%12!==0)continue;
  for(const a of shrimp.animals) {
    states[a.id].add(a.state);
    assert(a.root.matrix.toArray().every(Number.isFinite));
    assert(a.position.x>=-8.7&&a.position.x<=8.7&&a.position.y<7.3);
    assert.equal(a.root.matrix.elements[12],a.root.position.x);
    if(a.state!=='graze'&&a.state!=='crawl')continue;
    worldAxis.copy(a.localUp.value).applyQuaternion(a.root.quaternion);
    for(let i=0;i<6;i++) {
      const lift=walkingFoot(i,a.phase,a.walk,point);
      point.addScaledVector(a.localUp.value,a.feet.value[i]);
      point.multiplyScalar(a.scale).applyQuaternion(a.root.quaternion).add(a.root.position);
      const offset=shrimp.habitat.footOffset(a.surface,point,worldAxis)+.005+lift*a.scale;
      maxContactError=Math.max(maxContactError,Math.abs(offset));
    }
  }
}
for(const a of shrimp.animals) {
  assert(a.distance>8,'Every shrimp must leave its original grazing spot');
  assert(a.max.distanceTo(a.min)>3,'Roaming must cover more than one stone');
  assert(a.landings>=2,'Transfers must finish with an attached landing');
  assert(a.visited.has('wood')&&a.visited.has('floor'),'Both habitats must be reachable');
  assert(states[a.id].has('crawl')&&states[a.id].has('swim')&&states[a.id].has('graze'));
}
assert(maxContactError<.035,'Feet should stay close to the curved support');

const gentle=createCherryShrimp(new THREE.Scene(),{support:{heightAt:floor,woods:[wood]},obstacles});
const hover={position:gentle.animals[0].root.position.clone().add(V(.45,.06,0)),velocity:V()};
for(let i=0;i<20;i++)gentle.update(1/60,hover);
assert.equal(gentle.animals[0].retreats,1,'A slow nearby hand should cause a short scuttle');
assert.equal(gentle.animals[0].escapes,0,'A gentle approach should not cause a tail-flip');

// A retreat must still work when walking would cross an unreachable ledge.
const perch=gentle.habitat.initial[0];
const cliff=createCherryShrimp(new THREE.Scene(),{support:{heightAt:(x,z)=>
  Math.hypot(x-perch.x,z-perch.z)<.43?1.0:.35}});
const cliffHover={position:cliff.animals[0].root.position.clone().add(V(.45,.06,0)),velocity:V()};
for(let i=0;i<20;i++)cliff.update(1/60,cliffHover);
assert.equal(cliff.animals[0].retreats,1,'A blocked walking retreat should become a short swim');
assert.equal(cliff.animals[0].state,'swim');
assert.equal(cliff.animals[0].escapes,0);

// A fast nearby hand provokes one escape; a remote hand cannot startle a shrimp.
const a=shrimp.animals[0];
const remote={position:V(30,30,30),velocity:V(10,0,0),stillFor:0};
const count=a.escapes;
for(let i=0;i<60;i++)shrimp.update(1/60,remote);
assert.equal(a.escapes,count);
a.cooldown=0;a.alarmed=false;
const nearby={position:a.root.position.clone().add(V(.12,.06,.05)),velocity:V(-4,0,0),stillFor:0};
shrimp.update(1/60,nearby);
assert.equal(a.escapes,count+1);
assert.equal(a.state,'escape');
const escapeStart=a.position.clone();
for(let i=0;i<28;i++)shrimp.update(1/60,nearby);
assert(a.position.distanceTo(escapeStart)>.25,'Tail flick must displace the whole animal');
assert.equal(a.escapes,count+1,'A stationary hand must not retrigger every frame');
for(let i=0;i<60*35;i++)shrimp.update(1/60);
assert.notEqual(a.state,'escape','An escape must recover into normal movement');

// Cursor rays reach animals at any aquarium depth, as real browser mouse events do.
a.cooldown=0;a.alarmed=false;
const camera=V(0,6.4,24.6),aim=a.root.position.clone().addScaledVector(a.normal,.18*a.scale);
const ray=new THREE.Ray(camera,aim.clone().sub(camera).normalize());
const before=a.escapes;
shrimp.update(1/60,{position:V(20,20,20),ray,velocity:V(4,0,0),stillFor:0});
assert.equal(a.escapes,before+1);
const snapshot=()=>JSON.stringify({stats:shrimp.getTelemetry(),
  poses:shrimp.animals.map(a=>[a.root.matrix.toArray(),a.gait.value.toArray(),a.pose.value.toArray()])});
const paused=snapshot();
for(const dt of [0,0,-1,NaN,Infinity])shrimp.update(dt,nearby);
assert.equal(snapshot(),paused);

// A direct line through a trunk is rejected and a routed detour remains clear.
const navigator=createSwimNavigator(obstacles,floor),start=V(2,2,.35),end=V(6,2,.35);
assert.equal(navigator.clear(start,end),false);
const route=navigator.route(start,end);
assert(route&&route.length>1);
let previous=start;
for(const waypoint of route){assert(navigator.clear(previous,waypoint));previous=waypoint;}
console.log('PASS: reference shrimp geometry, exact bark sampling, 7-minute floor/wood roaming, landing, cursor tail-flips, cooldown, recovery, pause and collision-free swim routes');
console.log(JSON.stringify({maxContactError,shrimp:shrimp.getTelemetry()}));
