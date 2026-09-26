import * as THREE from 'three';

const V = (x, y, z) => new THREE.Vector3(x, y, z);
const RED = new THREE.Color('#71050e');
const LIGHT = new THREE.Color('#a81420');
const PALE = new THREE.Color('#b5b8b1');

// Appendage codes: 0–1 picking claws, 2–4 walking legs, 5 mouthparts,
// 6–10 swimmerets, 11 antennae, 12–13 antennules. uv.y is distance from root.
export const WALKING_FEET = [V(.055, 0, .175), V(-.09, 0, .185), V(-.235, 0, .18)];
export const STRIDE = .11;

function colorize(g, color, code = -1, tissue = 1) {
  const p = g.attributes.position, colors = new Float32Array(p.count * 3);
  const uv = g.attributes.uv;
  for (let i = 0; i < p.count; i++) {
    const c = typeof color === 'function' ? color(p.getX(i), p.getY(i), p.getZ(i)) : color;
    c.toArray(colors, i * 3);
    if (code >= 0) uv.setX(i, code);
  }
  g.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  g.setAttribute('aTissue', new THREE.Float32BufferAttribute(new Float32Array(p.count).fill(tissue),1));
  return g;
}

function ellipsoid(position, scale, color) {
  const g = new THREE.SphereGeometry(1, 32, 20);
  g.scale(...scale).translate(...position);
  return colorize(g, color);
}

// Rounded joints with a thin taper: unlike line primitives these catch the tank
// light and retain their silhouette at high resolution and oblique angles.
function tube(points, radii, code, color = PALE, rows = 16) {
  const curve = new THREE.CatmullRomCurve3(points.map(p => V(...p)), false, 'centripetal');
  const g = new THREE.TubeGeometry(curve, rows, 1, 6, false);
  const p = g.attributes.position, uv = g.attributes.uv;
  const center = V(0, 0, 0), vertex = V(0, 0, 0);
  for (let i = 0; i < p.count; i++) {
    const t = uv.getX(i), r = t * (radii.length - 1);
    const j = Math.min(radii.length - 2, Math.floor(r));
    const radius = THREE.MathUtils.lerp(radii[j], radii[j + 1], r - j) * (code >= 0 ? .65 : 1);
    curve.getPointAt(t, center);
    vertex.fromBufferAttribute(p, i).sub(center).multiplyScalar(radius).add(center);
    p.setXYZ(i, vertex.x, vertex.y, vertex.z);
    uv.setXY(i, code, t);
  }
  g.computeVertexNormals();
  return colorize(g, color);
}

function merge(parts) {
  const merged = new THREE.BufferGeometry(), index = [];
  let offset = 0;
  for (const name of ['position', 'normal', 'uv', 'color', 'aTissue']) {
    const size = name === 'aTissue' ? 1 : name === 'uv' ? 2 : 3;
    const data = new Float32Array(parts.reduce((n, p) => n + p.attributes[name].array.length, 0));
    let at = 0;
    for (const part of parts) { data.set(part.attributes[name].array, at); at += part.attributes[name].array.length; }
    merged.setAttribute(name, new THREE.BufferAttribute(data, size));
  }
  for (const part of parts) {
    for (const i of part.index.array) index.push(i + offset);
    offset += part.attributes.position.count;
    part.dispose();
  }
  merged.setIndex(index);
  merged.computeBoundingSphere();
  merged.boundingSphere.radius += .30;
  return merged;
}

function carapace(pigment) {
  // The reference's cephalothorax occupies about a third of the animal. Its
  // dorsal ridge rises toward the eyes; it is not a domed, blunt-ended head.
  const profile = [
    [-.060,.205,.065,.069], [-.025,.205,.072,.083], [.045,.222,.076,.088],
    [.115,.239,.073,.080], [.19,.254,.066,.059], [.255,.276,.051,.033],
    [.303,.298,.026,.014], [.324,.310,.009,.004],
  ];
  const positions = [], uvs = [], indices = [];
  const rows = 42, cols = 40;
  for (let i = 0; i <= rows; i++) {
    const t = i / rows * (profile.length-1), j = Math.min(profile.length-2,Math.floor(t));
    const f = t-j;
    const row = profile[j].map((v,k) => {
      const a=profile[Math.max(0,j-1)][k], b=v, c=profile[j+1][k];
      const d=profile[Math.min(profile.length-1,j+2)][k];
      return .5*((2*b)+(-a+c)*f+(2*a-5*b+4*c-d)*f*f+(-a+3*b-3*c+d)*f*f*f);
    });
    for (let k = 0; k <= cols; k++) {
      const a = k/cols*Math.PI*2, vertical = Math.cos(a);
      positions.push(row[0],row[1]+vertical*row[2]*(vertical<0?.84:1),
        Math.sin(a)*row[3]*(vertical<0?.86:1));
      uvs.push(i/rows,k/cols);
      if (i < rows && k < cols) {
        const p = i*(cols+1)+k;
        indices.push(p,p+1,p+cols+1,p+1,p+cols+2,p+cols+1);
      }
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position',new THREE.Float32BufferAttribute(positions,3));
  g.setAttribute('uv',new THREE.Float32BufferAttribute(uvs,2));
  g.setIndex(indices);
  g.computeVertexNormals();
  // Weld the seam's lighting while keeping UVs continuous around the shell.
  const n = g.attributes.normal;
  for (let i=0;i<=rows;i++) {
    const a=i*(cols+1), b=a+cols;
    const normal=V().fromBufferAttribute(n,a).add(V().fromBufferAttribute(n,b)).normalize();
    n.setXYZ(a,...normal.toArray()); n.setXYZ(b,...normal.toArray());
  }
  return colorize(g,pigment);
}

function abdominalPlate(segment, pigment) {
  const positions=[],uvs=[],indices=[];
  const rows=10,cols=36;
  for(let i=0;i<=rows;i++) {
    const s=i/rows;
    const xs=[-.040,-.135,-.245,-.355,-.455,-.55,-.635];
    const tops=[.273,.268,.255,.238,.219,.180,.135];
    const bottoms=[.120,.064,.047,.071,.087,.101,.104];
    const widths=[.081,.090,.086,.073,.052,.037,.020];
    const mix=values=>THREE.MathUtils.lerp(values[segment],values[segment+1],s);
    const lip=Math.exp(-(((s-.91)/.06)**2));
    const x=mix(xs),top=mix(tops)+.003*lip,bottom=mix(bottoms)-.025*Math.sin(s*Math.PI);
    const y=(top+bottom)*.5,height=(top-bottom)*.5;
    const width=mix(widths)+.0035*lip;
    for(let k=0;k<=cols;k++) {
      const a=k/cols*Math.PI*2, vertical=Math.cos(a);
      positions.push(x,y+vertical*height,Math.sin(a)*width*(vertical<0?1.04:1));
      uvs.push(s,k/cols);
      if(i<rows&&k<cols) {
        const p=i*(cols+1)+k;
        indices.push(p,p+cols+1,p+1,p+1,p+cols+1,p+cols+2);
      }
    }
  }
  const g=new THREE.BufferGeometry();
  g.setAttribute('position',new THREE.Float32BufferAttribute(positions,3));
  g.setAttribute('uv',new THREE.Float32BufferAttribute(uvs,2));
  g.setIndex(indices);g.computeVertexNormals();
  const n=g.attributes.normal;
  for(let i=0;i<=rows;i++) {
    const a=i*(cols+1),b=a+cols;
    const normal=V().fromBufferAttribute(n,a).add(V().fromBufferAttribute(n,b)).normalize();
    n.setXYZ(a,...normal.toArray());n.setXYZ(b,...normal.toArray());
  }
  colorize(g,pigment);
  const colors=g.attributes.color,tissue=g.attributes.aTissue;
  for(let i=0;i<colors.count;i++) {
    const along=g.attributes.uv.getX(i);
    const seam=Math.exp(-((along/.033)**2));
    colors.setXYZ(i,colors.getX(i)*(1-seam*.24),colors.getY(i)*(1-seam*.24),colors.getZ(i)*(1-seam*.24));
    tissue.setX(i,1-seam*.17);
  }
  return g;
}

export function createCherryAnatomy() {
  const shell = [], limbs = [], eyes = [];
  const pigment = (x, y, z) => {
    const dorsal = Math.exp(-z*z/.00019)*THREE.MathUtils.smoothstep(y,.23,.29);
    return RED.clone().lerp(LIGHT,.12+.10*dorsal);
  };
  shell.push(carapace(pigment));
  // Six overlapping abdominal somites, with a deep second pleuron and a
  // narrowing, down-curved abdomen. Fine seams remain between the shell plates.
  for (let i = 0; i < 6; i++) shell.push(abdominalPlate(i,pigment));
  // Telson and two pairs of uropods form a fan, rather than a fish tail.
  shell.push(colorize(ellipsoid([-.673,.109,0],[.067,.006,.018],RED),RED,-1,.60));
  for (const side of [-1, 1]) {
    for (let i = 0; i < 2; i++) {
      const fan = ellipsoid([0,0,0],[.071-i*.008,.0035,.012],RED);
      colorize(fan,(x)=>RED.clone().lerp(PALE,THREE.MathUtils.smoothstep(-x,.048,.071)),-1,.60);
      fan.rotateY(side*(.12+i*.14)).translate(-.664,.108+i*.003,side*(.007+i*.010));
      shell.push(fan);
      for(let k=0;k<12;k++) {
        const z=side*(.004+i*.009+k*.0015),x=-.722+(k/12)*.025;
        const hair=tube([[x,.111,z],[x-.022,.110,z+side*.008]], [.0007,.00013], -1, PALE, 3);
        colorize(hair,PALE,-1,.3);shell.push(hair);
      }
    }
    // Eye stalks support small glossy black eyes. There are no painted white eyes.
    shell.push(tube([[.227,.29,side*.028],[.249,.315,side*.041]], [.009,.007], -1, RED, 6));
    eyes.push(ellipsoid([.255,.320,side*.043],[.0125,.014,.012],new THREE.Color('#1b1312')));
    // A short serrated rostrum points forward between the stalked eyes.
    for (let i = 0; side === -1 && i < 5; i++) {
      const x=.285+i*.028,y=.331+i*.004;
      shell.push(tube([[x,y,0],[x+.004,y+.010-i*.001,0]], [.0035,.0005], -1, RED, 3));
    }
    for (let pair = 0; pair < 2; pair++) {
      const x=.195-pair*.070;
      limbs.push(tube([[x,.176,side*.035],[x+.012,.110,side*.080],
        [.255+pair*.045,.064,side*.105],[.285+pair*.045,.012,side*.072]],
      [.010,.007,.004,.002],pair,RED));
      // Two tiny fingers on each grazing chela, carried with the same pick cycle.
      for (const finger of [-1, 1]) {
        const claw = tube([
          [.285+pair*.045,.012,side*.072],[.308+pair*.045,.003,side*(.072+finger*.006)]],
        [.0028,.0005],pair,RED,4);
        const uv = claw.attributes.uv;
        for (let k = 0; k < uv.count; k++) uv.setY(k, .98 + .02*uv.getY(k));
        limbs.push(claw);
      }
    }
    for (let pair = 0; pair < 3; pair++) {
      const foot = WALKING_FEET[pair];
      limbs.push(tube([[.075-pair*.068,.155,side*.051],
        [.025-pair*.095,.105,side*.128],[foot.x,.014,side*foot.z],
        [foot.x+.012,0,side*foot.z]], [.010,.008,.004,.0008],pair+2,RED,18));
    }
    limbs.push(tube([[.225,.192,side*.020],[.268,.129,side*.045],[.29,.158,side*.020]],
      [.007,.004,.001],5,RED,8));
    for (let pair = 0; pair < 5; pair++) {
      const x=-.105-pair*.101,y=.085+(pair>2?(pair-2)*.012:0);
      limbs.push(tube([[x,y,side*.035],[x-.025,y-.026,side*.042],[x-.055,y-.021,side*.052]],
        [.006,.005,.0006],pair+6,RED,8));
    }
    // Long antennae and bifurcated shorter antennules: clear amber-red filaments.
    for (let pair = 0; pair < 3; pair++) {
      const length=pair===0?.80:.43-(pair-1)*.065;
      const spread=pair===0?.25:.055+(pair-1)*.07;
      limbs.push(tube([[.285,.305,side*.026],[.405,.332,side*.037],
        [.38+length*.55,.35+(pair===1?.20:.03),side*(.04+spread*.6)],
        [.38+length,.33+(pair===1?.36:.02),side*(.04+spread)]],
      [.0038,.0022,.0009,.0002],pair+11,PALE,28));
    }
  }
  shell.push(tube([[.23,.319,0],[.354,.344,0],[.465,.356,0]], [.011,.006,.0004],-1,RED,18));
  for(const limb of limbs) {
    const p=limb.attributes.position,uv=limb.attributes.uv,c=limb.attributes.color,tissue=limb.attributes.aTissue;
    for(let i=0;i<p.count;i++) {
      const code=uv.getX(i),t=uv.getY(i);
      const clear=code>10.5?1:Math.max(Math.exp(-(((t-.36)/.055)**2)),Math.exp(-(((t-.74)/.055)**2)));
      const color=new THREE.Color().fromBufferAttribute(c,i).lerp(PALE,clear*.82);
      c.setXYZ(i,color.r,color.g,color.b);tissue.setX(i,1-clear*.64);
    }
  }
  return {shell:merge(shell),limbs:merge(limbs),eyes:merge(eyes)};
}

export function walkingFoot(index, phase, walk, out) {
  const pair = Math.floor(index / 2), side = index % 2 ? 1 : -1;
  const cycle = ((phase + pair * .29 + (side > 0 ? .5 : 0)) % 1 + 1) % 1;
  const stance = cycle < .70;
  const u = stance ? cycle / .70 : (cycle - .70) / .30;
  const stride = (stance ? 1 - 2 * u : 2 * u - 1) * STRIDE * .5 * walk;
  const lift = stance ? 0 : Math.sin(Math.PI * u) * .040 * walk;
  out.copy(WALKING_FEET[pair]);
  out.x += .012 + stride;
  out.y += lift;
  out.z *= side;
  return lift;
}

export const appendageMotion = /* glsl */ `
  float code=uv.x,along=uv.y,side=sign(position.z);
  float tip=along*along*(3.-2.*along);
  if(code>1.5&&code<4.5) {
    float cycle=fract(shrimpGait.x+(code-2.)*.29+(side>0.?.5:0.));
    bool stance=cycle<.70;
    float u=stance?cycle/.70:(cycle-.70)/.30;
    transformed.x+=(stance?1.-2.*u:2.*u-1.)*.055*shrimpGait.y*tip;
    transformed.y+=(stance?0.:sin(3.14159265*u))*.040*shrimpGait.y*tip;
    transformed+=shrimpUp*shrimpFeet[(int(code+.5)-2)*2+(side>0.?1:0)]*tip;
  } else if(code<1.5) {
    float pick=(.5+.5*sin(shrimpGait.z*10.+side*2.5+code*1.3))*shrimpGait.w;
    transformed.x-=.065*pick*tip;
    transformed.y+=.125*pick*tip;
    transformed.z*=1.-.28*pick*tip;
  } else if(code<5.5) {
    transformed.xy+=vec2(.009,.006)*sin(shrimpGait.z*27.+side)*tip;
  } else if(code<10.5) {
    float beat=sin(shrimpGait.z*13.-code*1.3);
    transformed.x+=beat*(.008+.035*shrimpPose.y)*tip;
    transformed.y+=abs(beat)*(.003+.012*shrimpPose.y)*tip;
  } else {
    float flick=sin(shrimpGait.z*(code<11.5?1.8:3.6)+side*1.7+code);
    transformed.y+=(flick*.021+sin(shrimpGait.z*.7+side)*.012)*tip;
    transformed.z+=side*sin(shrimpGait.z*1.3+side+code)*.041*tip;
  }
  if(code<5.5)transformed+=vec3(-.025,.072,0.)*shrimpPose.y*tip;
`;

export const shrimpDeformation = /* glsl */ `
  uniform vec4 shrimpPose;
  vec3 shrimpFlex(vec3 p) {
    float bend=shrimpPose.x*1.85*(1.-smoothstep(-.66,-.015,p.x));
    vec2 arm=p.xy-vec2(-.015,.22);
    p.xy=vec2(-.015,.22)+mat2(cos(bend),sin(bend),-sin(bend),cos(bend))*arm;
    return p;
  }
`;
