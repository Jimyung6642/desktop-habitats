import * as THREE from 'three';
import { ROCKS, TRUNKS } from './layout.js';
import { groundHeight } from './math.js';
import { resolveHardscapeContact } from './interaction.js';

const V = (x=0,y=0,z=0) => new THREE.Vector3(x,y,z);
const TAU = Math.PI*2;
const clamp = THREE.MathUtils.clamp;
export const contactSample = () => ({ point: V(), normal: V(0,1,0) });

// The same rings and vertices that are drawn as bark. Sampling and foot placement
// retain the trunk's lean, knots and root flare instead of using a smooth cylinder.
export function createWoodSurface(geometry, id) {
  const { rows, cols } = geometry.userData.rings;
  const positions = geometry.attributes.position, normals = geometry.attributes.normal;
  const centers = Array.from({ length: rows+1 }, () => V());
  const starts = [], orientations = [];
  const a=V(),b=V(),p0=V(),p1=V(),n0=V(),n1=V();
  for(let row=0;row<=rows;row++) {
    const center=centers[row];
    for(let col=0;col<cols;col++) center.add(a.fromBufferAttribute(positions,row*(cols+1)+col));
    center.divideScalar(cols);
    a.fromBufferAttribute(positions,row*(cols+1)).sub(center);
    b.fromBufferAttribute(positions,row*(cols+1)+1).sub(center);
    starts.push(Math.atan2(a.x,a.z));
    orientations.push(Math.sign(a.z*b.x-a.x*b.z));
  }
  function ring(row, angle, point, normal) {
    const turn=((angle-starts[row])*orientations[row]/TAU%1+1)%1;
    const at=turn*cols, col=Math.floor(at), t=at-col;
    const i=row*(cols+1)+col;
    point.fromBufferAttribute(positions,i).lerp(a.fromBufferAttribute(positions,i+1),t);
    normal.fromBufferAttribute(normals,i).lerp(a.fromBufferAttribute(normals,i+1),t).normalize();
    if(normal.dot(b.copy(point).sub(centers[row]))<0) normal.negate();
  }
  return {
    id, minHeight: centers[0].y, maxHeight: Math.min(6.0,centers[rows].y-.4),
    sample(angle,height,out) {
      let lo=0,hi=rows;
      while(hi-lo>1) { const m=(lo+hi)>>1; if(centers[m].y<height)lo=m;else hi=m; }
      const t=clamp((height-centers[lo].y)/(centers[hi].y-centers[lo].y),0,1);
      ring(lo,angle,p0,n0);ring(hi,angle,p1,n1);
      out.point.copy(p0).lerp(p1,t);
      out.normal.copy(n0).lerp(n1,t).normalize();
      return out;
    },
  };
}

export function createShrimpHabitat(support, obstacles=[]) {
  const woods=support.woods || [], scratch=contactSample(), next=contactSample();
  const u=V(),v=V(),difference=V(),velocity=V();
  const sample=(ref,out=contactSample()) => {
    if(ref.kind==='wood') return woods.find(w=>w.id===ref.wood).sample(ref.angle,ref.height,out);
    out.point.set(ref.x,support.heightAt(ref.x,ref.z),ref.z);
    const e=.075;
    out.normal.set(support.heightAt(ref.x-e,ref.z)-support.heightAt(ref.x+e,ref.z),2*e,
      support.heightAt(ref.x,ref.z-e)-support.heightAt(ref.x,ref.z+e)).normalize();
    return out;
  };
  function floorAllowed(x,z) {
    if(x<=-8.6||x>=8.6||z<=-4.4||z>=4.15||
      TRUNKS.some(t=>Math.hypot(x-t.x,z-t.z)<=t.radius*1.26+.24))return false;
    // Feet cannot span a sheer boulder edge. Leave that edge by swimming and
    // land on a patch large enough for the body and all three pairs of legs.
    const height=support.heightAt(x,z),e=.075;
    const dx=(support.heightAt(x+e,z)-support.heightAt(x-e,z))/(2*e);
    const dz=(support.heightAt(x,z+e)-support.heightAt(x,z-e))/(2*e);
    if(Math.hypot(dx,dz)>.85)return false;
    // Check the tail's reach as well as the feet: a boulder under the abdomen
    // would otherwise lift the entire animal beyond its legs' reach.
    for(const radius of [.30,.48])for(let i=0;i<8;i++) {
      const a=i*TAU/8,u=Math.cos(a)*radius,v=Math.sin(a)*radius;
      if(Math.abs(support.heightAt(x+u,z+v)-height-dx*u-dz*v)>.10)return false;
    }
    return true;
  }
  function woodAllowed(ref) {
    sample(ref,scratch);
    return scratch.point.y>groundHeight(scratch.point.x,scratch.point.z)+.4 &&
      !obstacles.some(o=>o.branch&&scratch.point.distanceTo(o.center)<o.radius+.20);
  }
  function floorAt(x,z) {
    return {kind:'floor',x:clamp(x,-8.55,8.55),z:clamp(z,-4.35,4.1)};
  }
  function randomSpot(random,position,preferred) {
    for(let attempt=0;attempt<48;attempt++) {
      const wood=woods.length&&(preferred==='wood'||(!preferred&&random()<.48));
      let ref;
      if(wood) {
        const tree=woods[Math.floor(random()*woods.length)];
        ref={kind:'wood',wood:tree.id,angle:(random()-.5)*Math.PI*1.45,
          height:Math.max(tree.minHeight+.65,1.1)+random()*3.6};
        if(!woodAllowed(ref))continue;
      } else {
        ref=floorAt(-8.2+random()*16.4,-3.9+random()*7.7);
        if(!floorAllowed(ref.x,ref.z))continue;
      }
      sample(ref,scratch);
      const distance=position.distanceTo(scratch.point);
      if(distance>.65&&(distance<5.5||attempt>28))return ref;
    }
    return floorAt(0,2.5);
  }
  function nearby(ref,random,distance=.65) {
    for(let attempt=0;attempt<16;attempt++) {
      const result={...ref};
      if(ref.kind==='wood') {
        const tree=woods.find(w=>w.id===ref.wood);
        result.angle+=(random()-.5)*distance*1.8;
        result.height=clamp(ref.height+(random()-.35)*distance*1.7,tree.minHeight+.6,tree.maxHeight);
        if(woodAllowed(result))return result;
      } else {
        const angle=random()*TAU;
        result.x+=Math.cos(angle)*distance*(.6+random()*.4);
        result.z+=Math.sin(angle)*distance*(.6+random()*.4);
        if(floorAllowed(result.x,result.z))return result;
      }
    }
    return {...ref};
  }
  // Nearest point on the animal's own bark patch, solved in its two surface
  // coordinates. Four small iterations suffice for a foot less than 0.2 away.
  function footOffset(ref,point,axis) {
    if(ref.kind==='floor') return support.heightAt(point.x,point.z)-point.y;
    const candidate={...ref};
    for(let i=0;i<4;i++) {
      sample(candidate,scratch);
      const angle=candidate.angle,height=candidate.height;
      candidate.angle=angle+.002;sample(candidate,next);u.subVectors(next.point,scratch.point).multiplyScalar(500);
      candidate.angle=angle;candidate.height=height+.002;sample(candidate,next);v.subVectors(next.point,scratch.point).multiplyScalar(500);
      candidate.height=height;
      difference.subVectors(point,scratch.point);
      const uu=u.lengthSq(),vv=v.lengthSq(),uv=u.dot(v),det=uu*vv-uv*uv;
      if(det<1e-8)break;
      candidate.angle+=clamp((difference.dot(u)*vv-difference.dot(v)*uv)/det,-.25,.25);
      candidate.height+=clamp((difference.dot(v)*uu-difference.dot(u)*uv)/det,-.25,.25);
    }
    sample(candidate,scratch);
    return difference.subVectors(scratch.point,point).dot(axis);
  }
  function owner(ref,obstacle) {
    if(ref.kind==='wood')return obstacle.kind==='wood'&&obstacle.surfaceId===ref.wood;
    const rock=ROCKS[obstacle.surfaceId];
    return obstacle.kind==='rock'&&rock&&Math.hypot(ref.x-rock.x,ref.z-rock.z)<Math.max(rock.rx,rock.rz)*1.3;
  }
  const navigator=createSwimNavigator(obstacles,support.heightAt);
  function approach(ref) {
    sample(ref,scratch);
    const p=scratch.point.clone().addScaledVector(scratch.normal,.52);
    resolveHardscapeContact(p,velocity.set(0,0,0),obstacles,.29);
    p.y=Math.max(p.y,support.heightAt(p.x,p.z)+.32);
    return p;
  }
  function landingNear(point) {
    let best=null,score=Infinity;
    for(let i=0;i<32;i++) {
      const angle=i*2.399963,r=.2+Math.floor(i/8)*.4;
      const ref=floorAt(point.x+Math.cos(angle)*r,point.z+Math.sin(angle)*r);
      if(!floorAllowed(ref.x,ref.z))continue;
      sample(ref,scratch);
      const distance=point.distanceToSquared(scratch.point);
      if(distance<score){score=distance;best=ref;}
    }
    for(const wood of woods) {
      const trunk=TRUNKS[wood.id];
      const ref={kind:'wood',wood:wood.id,angle:Math.atan2(point.x-trunk.x,point.z-trunk.z),
        height:clamp(point.y,wood.minHeight+.6,wood.maxHeight)};
      if(!woodAllowed(ref))continue;
      sample(ref,scratch);const distance=point.distanceToSquared(scratch.point);
      if(distance<score){score=distance;best=ref;}
    }
    return best||floorAt(0,2.5);
  }
  return {sample,nearby,randomSpot,footOffset,owner,approach,landingNear,navigator,woods,floorAllowed,woodAllowed,
    initial: [floorAt(ROCKS[0].x,ROCKS[0].z),woods.length?
      {kind:'wood',wood:woods.find(w=>w.id===3)?.id??woods[0].id,angle:.12,height:1.8}:
      floorAt(ROCKS[2].x,ROCKS[2].z),
      floorAt(ROCKS[1].x,ROCKS[1].z),
      woods.some(w=>w.id===1)?{kind:'wood',wood:1,angle:-.18,height:2.6}:
        floorAt(ROCKS[4].x,ROCKS[4].z),
      floorAt(ROCKS[22].x,ROCKS[22].z)],
  };
}

// A small, lazy 3-D waypoint graph. Edges test the complete segment against the
// hardscape, so a swim between two clear endpoints cannot cut through a trunk.
export function createSwimNavigator(obstacles,heightAt) {
  const clearance=.24,nx=25,nz=14,ny=9,spacing=.72;
  let nodes=null;
  const point=V();
  function clear(a,b) {
    const dx=b.x-a.x,dy=b.y-a.y,dz=b.z-a.z,lengthSq=dx*dx+dy*dy+dz*dz;
    for(const o of obstacles) {
      const t=lengthSq?clamp(((o.center.x-a.x)*dx+(o.center.y-a.y)*dy+(o.center.z-a.z)*dz)/lengthSq,0,1):0;
      const x=a.x+dx*t-o.center.x,y=a.y+dy*t-o.center.y,z=a.z+dz*t-o.center.z;
      if(x*x+y*y+z*z<(o.radius+clearance)**2)return false;
    }
    const steps=Math.max(1,Math.ceil(Math.sqrt(lengthSq)/.22));
    for(let i=0;i<=steps;i++) {
      const t=i/steps;
      if(a.y+dy*t<heightAt(a.x+dx*t,a.z+dz*t)+.18)return false;
    }
    return true;
  }
  function initialize() {
    if(nodes)return;
    nodes=new Array(nx*nz*ny);
    for(let y=0;y<ny;y++)for(let z=0;z<nz;z++)for(let x=0;x<nx;x++) {
      point.set(-8.64+x*spacing,.72+y*spacing,-4.68+z*spacing);
      if(clear(point,point))nodes[(y*nz+z)*nx+x]={point:point.clone(),x,y,z,edges:null};
    }
  }
  const index=(x,y,z)=>(y*nz+z)*nx+x;
  function edges(node) {
    if(node.edges)return node.edges;
    node.edges=[];
    for(let y=-1;y<=1;y++)for(let z=-1;z<=1;z++)for(let x=-1;x<=1;x++) {
      if(!x&&!y&&!z)continue;
      const px=node.x+x,py=node.y+y,pz=node.z+z;
      if(px<0||px>=nx||py<0||py>=ny||pz<0||pz>=nz)continue;
      const i=index(px,py,pz),other=nodes[i];
      if(other&&clear(node.point,other.point))node.edges.push(i);
    }
    return node.edges;
  }
  function nearest(p) {
    const candidates=[];
    for(let i=0;i<nodes.length;i++)if(nodes[i])candidates.push([p.distanceToSquared(nodes[i].point),i]);
    candidates.sort((a,b)=>a[0]-b[0]);
    for(const [,i] of candidates.slice(0,80))if(clear(p,nodes[i].point))return i;
    return -1;
  }
  return {clear,route(start,end) {
    if(clear(start,end))return [end.clone()];
    initialize();
    const first=nearest(start),last=nearest(end);
    if(first<0||last<0)return null;
    const g=new Float64Array(nodes.length).fill(Infinity),parent=new Int32Array(nodes.length).fill(-1);
    const closed=new Uint8Array(nodes.length),open=[first];g[first]=0;
    while(open.length) {
      let at=0,best=Infinity;
      for(let i=0;i<open.length;i++) {
        const n=open[i],f=g[n]+nodes[n].point.distanceTo(end);
        if(f<best){best=f;at=i;}
      }
      const current=open.splice(at,1)[0];
      if(current===last) {
        const path=[end.clone()];
        for(let n=last;n>=0;n=parent[n])path.push(nodes[n].point.clone());
        path.reverse();
        const result=[];let origin=start;
        for(let i=0;i<path.length;i++) {
          let j=i;while(j+1<path.length&&clear(origin,path[j+1]))j++;
          result.push(path[j]);origin=path[j];i=j;
        }
        return result;
      }
      closed[current]=1;
      for(const n of edges(nodes[current])) {
        if(closed[n])continue;
        const score=g[current]+nodes[current].point.distanceTo(nodes[n].point);
        if(score>=g[n])continue;
        if(!Number.isFinite(g[n]))open.push(n);
        g[n]=score;parent[n]=current;
      }
    }
    return null;
  }};
}
