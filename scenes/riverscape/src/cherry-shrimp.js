import * as THREE from 'three';
import { groundHeight, randomGenerator } from './math.js';
import { createCherryAnatomy, walkingFoot, STRIDE } from './shrimp-anatomy.js';
import { createCherryModel } from './shrimp-model.js';
import { createShrimpHabitat, contactSample } from './shrimp-habitat.js';
import { resolveHardscapeContact } from './interaction.js';

const V=(x=0,y=0,z=0)=>new THREE.Vector3(x,y,z);
const UP=V(0,1,0),TAU=Math.PI*2;
const clamp=THREE.MathUtils.clamp;
const angleDifference=(a,b)=>Math.atan2(Math.sin(a-b),Math.cos(a-b));

export function createCherryShrimp(scene,{support={heightAt:groundHeight},obstacles=[]}={}) {
  const geometry=createCherryAnatomy(),habitat=createShrimpHabitat(support,obstacles);
  const point=V(),axis=V(),across=V(),forward=V(),direction=V(),delta=V();
  const matrix=new THREE.Matrix4(),rotation=new THREE.Quaternion(),inverse=new THREE.Quaternion();
  const sample=contactSample(),goalSample=contactSample();
  const underside=[],buckets=new Map(),p=geometry.shell.attributes.position;
  for(let i=0;i<p.count;i++) {
    const vertex=V().fromBufferAttribute(p,i);
    if(vertex.x>.31||Math.abs(vertex.z)>.105)continue;
    const key=`${Math.round(vertex.x*13)},${Math.round(vertex.z*10)}`;
    if(!buckets.has(key)||vertex.y<buckets.get(key).y)buckets.set(key,vertex);
  }
  underside.push(...buckets.values());
  const animals=habitat.initial.map((ref,id)=>{
    habitat.sample(ref,sample);
    const model=createCherryModel(scene,geometry,id);
    return {...model,id,pace:[0,1,.4,.75,.2][id%5],random:randomGenerator(71021+id*893),surface:{...ref},target:null,
      position:sample.point.clone(),normal:sample.normal.clone(),
      forward:ref.kind==='wood'?V(.30,1,0).projectOnPlane(sample.normal).normalize():V(1,0,.12).normalize(),
      velocity:V(),state:'graze',remaining:4.5+id*2.6,phase:id*.41,rhythm:id*1.71,
      walk:0,pick:1,curl:0,swim:0,distance:0,cooldown:0,nearTime:0,alarmed:false,
      scuttle:0,moves:0,escapes:0,retreats:0,landings:0,woodVisits:ref.kind==='wood'?1:0,
      visited:new Set([ref.kind]),route:[],routeIndex:0,departure:null,landing:null,
      min:sample.point.clone(),max:sample.point.clone()};
  });

  function orient(a,dt) {
    forward.copy(a.forward).projectOnPlane(a.normal);
    if(forward.lengthSq()<1e-6)forward.copy(Math.abs(a.normal.y)>.8?V(1,0,0):UP).projectOnPlane(a.normal);
    forward.normalize();a.forward.copy(forward);
    across.crossVectors(forward,a.normal).normalize();
    axis.crossVectors(across,forward).normalize();
    rotation.setFromRotationMatrix(matrix.makeBasis(forward,axis,across));
    if(dt===0)a.root.quaternion.copy(rotation);
    else a.root.quaternion.slerp(rotation,1-Math.exp(-dt*13));
  }

  function pose(a,dt) {
    const attached=a.state==='graze'||a.state==='crawl';
    if(attached) {
      habitat.sample(a.surface,sample);
      a.position.copy(sample.point);
      a.normal.lerp(sample.normal,dt===0?1:1-Math.exp(-dt*16)).normalize();
    }
    orient(a,dt);
    a.root.position.copy(a.position);
    if(attached) {
      axis.copy(a.surface.kind==='floor'?UP:a.normal);
      a.root.position.addScaledVector(axis,.005);
      let lift=0;
      for(const belly of underside) {
        point.copy(belly).multiplyScalar(a.scale).applyQuaternion(a.root.quaternion).add(a.root.position);
        lift=Math.max(lift,habitat.footOffset(a.surface,point,axis)+.005);
      }
      a.root.position.addScaledVector(axis,lift);
      inverse.copy(a.root.quaternion).invert();
      a.localUp.value.copy(axis).applyQuaternion(inverse);
      for(let i=0;i<6;i++) {
        const swing=walkingFoot(i,a.phase,a.walk,point);
        point.multiplyScalar(a.scale).applyQuaternion(a.root.quaternion).add(a.root.position);
        a.feet.value[i]=clamp((habitat.footOffset(a.surface,point,axis)+.005+swing*a.scale)/a.scale,-.30,.30);
      }
    } else a.feet.value.fill(0);
    a.gait.value.set(a.phase,a.walk,a.rhythm,a.pick);
    a.pose.value.set(a.curl,a.swim,a.scuttle,0);
    a.root.updateMatrix();
  }

  function beginSwim(a,target,fromAir=false) {
    const lift=fromAir?a.position.clone():habitat.approach(a.surface);
    if(fromAir) {
      resolveHardscapeContact(lift,delta.set(0,0,0),obstacles,.29);
      lift.y=Math.max(lift.y,support.heightAt(lift.x,lift.z)+.32);
    }
    const approach=habitat.approach(target),route=habitat.navigator.route(lift,approach);
    if(!route) {
      if(!fromAir){a.state='graze';a.remaining=1.5;a.moves=2;}
      return false;
    }
    habitat.sample(target,goalSample);
    a.departure={...a.surface};a.landing={...target};
    a.route=[lift,...route,goalSample.point.clone()];
    a.routeIndex=0;a.state='swim';a.target=null;a.moves=0;
    return true;
  }

  function chooseNext(a) {
    if(a.moves>=2||a.random()<.42) {
      const preferred=a.surface.kind==='wood'?'floor':a.woodVisits===0?'wood':null;
      if(beginSwim(a,habitat.randomSpot(a.random,a.position,preferred)))return;
    }
    a.target=habitat.nearby(a.surface,a.random,.48+a.random()*.45);
    a.state='crawl';a.moves++;
  }

  function crawl(a,dt) {
    habitat.sample(a.target,goalSample);
    delta.subVectors(goalSample.point,a.position);
    if(delta.length()<.025) {
      a.surface={...a.target};a.target=null;a.state='graze';a.remaining=3.5+a.random()*8;
      return 0;
    }
    const speed=a.scuttle>0?.70:.115+a.pace*.02;
    const next={...a.surface};
    if(next.kind==='wood') {
      const amount=Math.min(1,speed*dt/Math.max(.01,delta.length()));
      next.angle+=angleDifference(a.target.angle,next.angle)*amount;
      next.height+=(a.target.height-next.height)*amount;
    } else {
      direction.copy(delta).projectOnPlane(a.normal).normalize().multiplyScalar(speed*dt);
      next.x+=direction.x;next.z+=direction.z;
      if(!habitat.floorAllowed(next.x,next.z)) {
        beginSwim(a,a.target);return 0;
      }
    }
    habitat.sample(next,sample);
    const moved=sample.point.distanceTo(a.position);
    // A sheer stone edge is crossed by swimming, not a vertical teleport.
    if(moved>.045) {beginSwim(a,a.target);return 0;}
    direction.subVectors(sample.point,a.position);
    if(direction.lengthSq()>1e-10)a.forward.lerp(direction.normalize(),1-Math.exp(-dt*9)).normalize();
    a.surface=next;a.position.copy(sample.point);a.distance+=moved;
    return moved/dt;
  }

  function swim(a,dt) {
    const target=a.route[a.routeIndex];
    if(!target)return 0;
    direction.subVectors(target,a.position);
    const distance=direction.length(),landing=a.routeIndex===a.route.length-1;
    const speed=landing?.45:.46+a.pace*.06;
    const moved=Math.min(distance,speed*dt);
    if(distance>1e-8) {
      direction.divideScalar(distance);
      a.position.addScaledVector(direction,moved);
      if(landing) {
        habitat.sample(a.landing,goalSample);
        a.normal.lerp(goalSample.normal,1-Math.exp(-dt*8)).normalize();
        forward.copy(a.landing.kind==='wood'?UP:direction).projectOnPlane(a.normal);
        if(forward.lengthSq()>.001)a.forward.lerp(forward.normalize(),1-Math.exp(-dt*8)).normalize();
      } else {
        // The body is level while swimming; its head follows the route while
        // pleopods row. The final approach rotates feet toward the landing.
        a.normal.lerp(UP,1-Math.exp(-dt*5)).normalize();
        a.forward.lerp(direction,1-Math.exp(-dt*7)).normalize();
        a.normal.addScaledVector(a.forward,-a.normal.dot(a.forward)).normalize();
      }
    }
    a.distance+=moved;
    if(distance<.009||moved===distance) {
      a.routeIndex++;
      if(a.routeIndex===a.route.length) {
        a.surface={...a.landing};a.state='graze';a.remaining=4+a.random()*7;
        a.landings++;a.visited.add(a.surface.kind);if(a.surface.kind==='wood')a.woodVisits++;
        a.route=[];a.departure=null;
      }
    }
    return moved/dt;
  }

  function startEscape(a,away) {
    a.departure={...a.surface};a.state='escape';a.escapeTime=0;
    a.velocity.copy(a.forward).multiplyScalar(-2.8).addScaledVector(a.normal,1.45).addScaledVector(away,.90);
    a.velocity.clampLength(1.9,3.9);
    a.cooldown=5+a.random()*2;a.alarmed=true;a.escapes++;
    a.route=[];a.target=null;a.scuttle=0;
  }

  function react(a,pointer,dt) {
    if(!pointer){a.alarmed=false;a.nearTime=0;return;}
    point.copy(a.root.position).addScaledVector(a.normal,.18*a.scale);
    if(pointer.ray)pointer.ray.closestPointToPoint(point,delta);
    else delta.copy(pointer.position);
    direction.subVectors(point,delta);
    const distance=direction.length();
    if(distance>1.3){a.alarmed=false;a.nearTime=0;return;}
    // A shrimp behind a trunk cannot see a hand on the front glass.
    if(pointer.ray&&(a.state==='graze'||a.state==='crawl')&&a.surface.kind==='wood'&&
      a.normal.dot(delta.subVectors(pointer.ray.origin,point))<0)return;
    a.nearTime+=dt;
    if(a.alarmed||a.cooldown>0||a.state==='escape')return;
    if(distance<.02)direction.copy(a.normal);else direction.divideScalar(distance);
    const speed=pointer.velocity?.length()||0;
    if((distance<.85&&speed>1.15)||(distance<.25&&a.nearTime>.20)) {
      startEscape(a,direction);return;
    }
    if(distance<.68&&(a.state==='graze'||a.state==='crawl')&&a.nearTime>.18) {
      const target={...a.surface};
      let walkable=true;
      if(target.kind==='floor') {
        const length=Math.hypot(direction.x,direction.z)||1;
        target.x+=direction.x/length*.68;target.z+=direction.z/length*.68;
        walkable=habitat.floorAllowed(target.x,target.z);
      } else {
        target.angle+=Math.sign(direction.x*Math.cos(target.angle)-direction.z*Math.sin(target.angle)||1)*.6;
        target.height=clamp(target.height+direction.y*.45,1.0,5.4);
        walkable=habitat.woodAllowed(target);
      }
      if(walkable) {a.target=target;a.state='crawl';}
      else if(!beginSwim(a,habitat.landingNear(a.position.clone().addScaledVector(direction,.9))))return;
      a.scuttle=1.5;a.cooldown=2.8;a.alarmed=true;a.retreats++;
    }
  }

  function escape(a,dt) {
    a.escapeTime+=dt;
    const previous=a.position.clone();
    a.position.addScaledVector(a.velocity,dt);
    // Leave the surface before its conservative navigation spheres become solid.
    const blockers=a.escapeTime<.32?obstacles.filter(o=>!habitat.owner(a.departure,o)):obstacles;
    resolveHardscapeContact(a.position,a.velocity,blockers,.12);
    a.position.x=clamp(a.position.x,-8.55,8.55);
    a.position.z=clamp(a.position.z,-4.3,4.10);
    a.position.y=clamp(a.position.y,support.heightAt(a.position.x,a.position.z)+.13,6.4);
    a.velocity.multiplyScalar(Math.exp(-dt*1.6));
    a.distance+=previous.distanceTo(a.position);
    a.curl=Math.max(0,Math.sin(a.escapeTime*22))*Math.exp(-a.escapeTime*1.8);
    a.normal.lerp(UP,1-Math.exp(-dt*3)).normalize();
    if(a.escapeTime>.70) {
      if(!beginSwim(a,habitat.landingNear(a.position),true)) {
        // Retry from the already clear water; never teleport back to a home stone.
        a.escapeTime=.62;
      }
    }
    return a.velocity.length();
  }

  for(const a of animals)pose(a,0);
  return {animals,habitat,update(dt,pointer=null) {
    if(!(dt>0)||!Number.isFinite(dt))return;
    const step=Math.min(.1,dt);
    for(const a of animals) {
      a.rhythm=(a.rhythm+step)%(TAU*10);a.cooldown=Math.max(0,a.cooldown-step);
      a.scuttle=Math.max(0,a.scuttle-step);
      react(a,pointer,step);
      let speed=0;
      if(a.state==='graze') {a.remaining-=step;if(a.remaining<=0)chooseNext(a);}
      else if(a.state==='crawl')speed=crawl(a,step);
      else if(a.state==='swim')speed=swim(a,step);
      else if(a.state==='escape')speed=escape(a,step);
      const attached=a.state==='graze'||a.state==='crawl';
      a.walk+=((a.state==='crawl'&&speed>.001?1:0)-a.walk)*(1-Math.exp(-step*8));
      a.pick+=((a.state==='graze'?1:0)-a.pick)*(1-Math.exp(-step*6));
      a.swim+=((attached?0:1)-a.swim)*(1-Math.exp(-step*10));
      if(a.state!=='escape')a.curl*=Math.exp(-step*12);
      if(attached)a.phase=(a.phase+speed*step/(STRIDE*a.scale))%1;
      pose(a,step);
      a.min.min(a.position);a.max.max(a.position);
    }
  },getTelemetry:()=>({species:'Neocaridina davidi',count:animals.length,
    animals:animals.map(a=>({id:a.id,state:a.state,surface:a.surface.kind,
      position:a.root.position.toArray(),distance:a.distance,phase:a.phase,
      escapes:a.escapes,retreats:a.retreats,landings:a.landings,woodVisits:a.woodVisits,
      exploration:a.max.clone().sub(a.min).toArray()}))})};
}
