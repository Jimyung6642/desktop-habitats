import * as THREE from 'three';
import { GeometryBatch, randomGenerator, vec } from './math.js';
import { foliageMaterial } from './foliage.js';
import { waterTime, SURFACE_Y } from './water.js';

// Distance is expressed by placement, finer silhouettes and a gradual loss of
// contrast. No flat background photograph or full-screen blur is involved.
export function distanceMaterial(material,key) {
  const original=material.onBeforeCompile;
  material.onBeforeCompile=shader=>{
    original.call(material,shader);
    shader.fragmentShader=shader.fragmentShader.replace('#include <opaque_fragment>',`
      float rearDepth=smoothstep(7.0,16.5,-vWaterPosition.z);
      outgoingLight=mix(outgoingLight,vec3(.15,.23,.18),.12+rearDepth*.28);
      #include <opaque_fragment>
    `);
  };
  material.customProgramCacheKey=()=>key;
  return material;
}

export function createDistantPlanting(scene) {
  const batch=new GeometryBatch(),random=randomGenerator(96021),range=(a,b)=>a+(b-a)*random();
  const color=new THREE.Color(),root=vec(0,0,0);
  function ribbon(x,z,height,width,lean) {
    root.set(x,.8,z);
    const base=batch.positions.length/3,rows=18;
    const direction=vec(.8,.03,.3).normalize();
    const shade=range(.065,.13);
    color.setHSL(range(.24,.31),range(.28,.50),shade);
    for(let row=0;row<=rows;row++) {
      const t=row/rows,angle=lean+Math.sin(t*2.7+x)*.22;
      const center=vec(x+Math.sin(angle)*height*t*t*.20,
        .8+height*t,z+Math.cos(angle)*height*t*t*.055);
      const leafWidth=width*Math.sin(Math.PI*Math.pow(t,.72))**.5;
      for(let side=0;side<3;side++) {
        const s=side-1;
        batch.vertex(center.clone().add(vec(s*leafWidth,.0,Math.abs(s)*leafWidth*.26)),
          [side/2,t],color,root,{direction,tangent:vec(0,1,0),distance:height*t,compliance:.40},.68);
      }
      if(row<rows){const i=base+row*3;batch.quad(i,i+1,i+3,i+4);batch.quad(i+1,i+2,i+4,i+5);}
    }
  }
  function leaf(center,length,angle,root,color) {
    const along=vec(Math.cos(angle),.46,Math.sin(angle)).normalize();
    const across=vec(-Math.sin(angle),0,Math.cos(angle));
    const strand={direction:vec(.7,0,.2),tangent:vec(0,1,0),distance:center.y,compliance:.27};
    const i=batch.positions.length/3;
    for(let row=0;row<4;row++) {
      const t=row/3,half=Math.sin(Math.PI*t)*length*.18;
      const p=center.clone().addScaledVector(along,length*t);
      for(const side of [-1,0,1])batch.vertex(p.clone().addScaledVector(across,side*half)
        .add(vec(0,(1-Math.abs(side))*half*.35,0)),[(side+1)/2,t],color,root,strand,.65);
      if(row<3){const j=i+row*3;batch.quad(j,j+1,j+3,j+4);batch.quad(j+1,j+2,j+4,j+5);}
    }
  }
  for(let layer=0;layer<3;layer++) {
    const z=-8.8-layer*3.0;
    for(let clump=0;clump<42;clump++) {
      const x=-16+clump*.78+range(-.3,.3),depth=z+range(-.5,.5);
      const height=range(8.0,10.6)*(1-.025*layer);
      for(let blade=0;blade<6;blade++)ribbon(x+range(-.25,.25),depth+range(-.3,.3),
        height*range(.78,1.0),range(.034,.074),range(-1.1,1.1));
      // Fine side shoots at three depths interrupt the uniform ribbon outline.
      if(clump%2===0)for(let shoot=0;shoot<3;shoot++) {
        const stemX=x+range(-.3,.3),stemZ=depth+range(-.2,.2),h=range(7.8,10.1);
        const stemRoot=vec(stemX,.8,stemZ);
        color.setHSL(range(.25,.32),range(.27,.47),range(.065,.13));
        for(let node=0;node<22;node++) {
          const t=node/22;
          const center=vec(stemX+Math.sin(t*3+clump)*t*.35,.8+h*t,stemZ);
          const angle=node*2.39996;
          for(const side of [0,Math.PI])leaf(center,range(.20,.37),angle+side,stemRoot,color);
        }
      }
    }
  }
  const geometry=batch.geometry();
  const material=distanceMaterial(foliageMaterial(),'distant-aquatic-leaves-v1');
  const mesh=new THREE.Mesh(geometry,material);
  mesh.name='Three layers of distant grass and small leaves';
  // Rear planting is deliberately soft and outside the foreground shadow budget.
  mesh.castShadow=false;mesh.receiveShadow=false;scene.add(mesh);
  return {layers:3,triangles:geometry.index.count/3};
}

// Cache the actual static aquascape in a reflected camera. Ripples distort that
// image every frame; fish and shrimp are excluded so no animal leaves a frozen
// reflection. Only a camera/aspect change rebakes it, with no recurring extra pass.
export function createWaterSurface(scene) {
  const reflectedObjects=new Set(scene.children);
  const reflection=new THREE.WebGLRenderTarget(1024,576,{
    type:THREE.HalfFloatType,minFilter:THREE.LinearFilter,magFilter:THREE.LinearFilter,
  });
  const reflectionCamera=new THREE.PerspectiveCamera();
  const textureMatrix=new THREE.Matrix4();
  const previousView=new THREE.Matrix4(),previousProjection=new THREE.Matrix4();
  const direction=vec(0,0,0),target=vec(0,0,0);
  const clipPlane=new THREE.Plane(vec(0,-1,0),SURFACE_Y);
  let baked=false;

  const geometry=new THREE.PlaneGeometry(58,32,112,64);
  geometry.rotateX(-Math.PI/2);geometry.translate(0,SURFACE_Y,-2.4);
  const material=new THREE.ShaderMaterial({
    uniforms:{
      surfaceTime:waterTime,reflectionMap:{value:reflection.texture},
      reflectionMatrix:{value:textureMatrix},
    },
    vertexShader:`
      uniform float surfaceTime;
      uniform mat4 reflectionMatrix;
      varying vec4 reflectedCoord;
      varying vec3 waterPosition;
      void main() {
        vec3 p=position;
        p.y+=.014*sin(p.x*2.3+p.z*1.6-surfaceTime*1.5)
          +.007*sin(p.x*4.7-p.z*3.1+surfaceTime*1.1);
        waterPosition=(modelMatrix*vec4(p,1.)).xyz;
        reflectedCoord=reflectionMatrix*vec4(waterPosition,1.);
        gl_Position=projectionMatrix*viewMatrix*vec4(waterPosition,1.);
      }`,
    fragmentShader:`
      uniform float surfaceTime;
      uniform sampler2D reflectionMap;
      varying vec4 reflectedCoord;
      varying vec3 waterPosition;
      void main() {
        vec2 p=waterPosition.xz;
        float a=p.x*2.3+p.y*1.6-surfaceTime*1.5;
        float b=p.x*4.7-p.y*3.1+surfaceTime*1.1;
        float c=p.x*9.3+p.y*5.2-surfaceTime*2.2;
        vec2 slope=vec2(.0322*cos(a)+.0329*cos(b),.0224*cos(a)-.0217*cos(b));
        vec2 uv=reflectedCoord.xy/reflectedCoord.w;
        uv+=slope*vec2(.075,.20)+vec2(.0006*sin(c),.0012*cos(c));
        vec3 reflected=texture2D(reflectionMap,clamp(uv,vec2(.002),vec2(.998))).rgb;
        vec3 view=normalize(cameraPosition-waterPosition);
        // The grazing underwater angle produces almost total internal reflection.
        float mirror=1.-smoothstep(.60,.78,abs(view.y));
        vec3 color=mix(vec3(.32,.43,.36),reflected*.86+vec3(.018,.027,.022),.88*mirror+.10);
        float glint=pow(max(0.,sin(a*.7+b*.2)),26.)*.035;
        float waterline=(1.-smoothstep(0.,.12,p.y+18.4))*.18;
        color+=vec3(.64,.76,.69)*(glint+waterline);
        gl_FragColor=vec4(color,.97);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
      }`,
    transparent:true,depthWrite:false,side:THREE.DoubleSide,
  });
  const mesh=new THREE.Mesh(geometry,material);mesh.name='Visible rippling water surface';
  mesh.renderOrder=2;scene.add(mesh);

  function updateReflection(renderer,camera) {
    camera.updateMatrixWorld();
    if(baked&&previousView.equals(camera.matrixWorld)&&previousProjection.equals(camera.projectionMatrix))return;
    previousView.copy(camera.matrixWorld);previousProjection.copy(camera.projectionMatrix);
    const height=Math.min(1024,Math.round(1024/camera.aspect));
    reflection.setSize(1024,height);
    reflectionCamera.copy(camera);
    reflectionCamera.position.copy(camera.position);
    reflectionCamera.position.y=2*SURFACE_Y-camera.position.y;
    camera.getWorldDirection(direction);direction.y*=-1;
    reflectionCamera.up.copy(camera.up);reflectionCamera.up.y*=-1;
    target.copy(reflectionCamera.position).add(direction);
    reflectionCamera.lookAt(target);reflectionCamera.updateMatrixWorld(true);
    textureMatrix.set(.5,0,0,.5,0,.5,0,.5,0,0,.5,.5,0,0,0,1)
      .multiply(reflectionCamera.projectionMatrix).multiply(reflectionCamera.matrixWorldInverse);
    const hidden=scene.children.filter(object=>!reflectedObjects.has(object)&&object.visible);
    const oldTarget=renderer.getRenderTarget(),oldPlanes=renderer.clippingPlanes;
    const oldShadowUpdate=renderer.shadowMap.needsUpdate;
    try {
      hidden.forEach(object=>{object.visible=false;});
      renderer.clippingPlanes=[clipPlane];
      renderer.shadowMap.needsUpdate=true;
      renderer.setRenderTarget(reflection);
      renderer.render(scene,reflectionCamera);
      baked=true;
    } finally {
      renderer.setRenderTarget(oldTarget);
      renderer.clippingPlanes=oldPlanes;
      renderer.shadowMap.needsUpdate=oldShadowUpdate;
      hidden.forEach(object=>{object.visible=true;});
    }
  }
  return {mesh,updateReflection};
}
