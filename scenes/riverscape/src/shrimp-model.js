import * as THREE from 'three';
import { waterLitShader } from './water.js';
import { appendageMotion, shrimpDeformation } from './shrimp-anatomy.js';

export function createCherryModel(scene, geometry, id) {
  const root=new THREE.Group();root.name=`Cherry shrimp ${id+1}`;
  const scale=[.63,.58,.61,.56,.60][id%5];root.scale.setScalar(scale);
  const gait={value:new THREE.Vector4()},pose={value:new THREE.Vector4()};
  const feet={value:new Float32Array(6)},localUp={value:new THREE.Vector3(0,1,0)};
  const shellMaterial=new THREE.MeshPhysicalMaterial({
    vertexColors:true,roughness:.43,metalness:0,ior:1.38,specularIntensity:.30,
    clearcoat:.025,clearcoatRoughness:.38,envMapIntensity:.40,
    transparent:true,depthWrite:true,
    color:id===0?0xffffff:0xe7c5c6,
  });
  function deform(shader,limbs=false) {
    Object.assign(shader.uniforms,{shrimpGait:gait,shrimpPose:pose,shrimpFeet:feet,shrimpUp:localUp});
    shader.vertexShader=shader.vertexShader.replace('#include <common>',`
      #include <common>
      ${shrimpDeformation}
      uniform vec4 shrimpGait;
      uniform float shrimpFeet[6];
      uniform vec3 shrimpUp;
    `).replace('#include <begin_vertex>',`
      #include <begin_vertex>
      ${limbs?appendageMotion:''}
      transformed=shrimpFlex(transformed);
    `).replace('#include <beginnormal_vertex>',`
      #include <beginnormal_vertex>
      float flex=shrimpPose.x*1.85*(1.-smoothstep(-.66,-.015,position.x));
      objectNormal.xy=mat2(cos(flex),sin(flex),-sin(flex),cos(flex))*objectNormal.xy;
    `);
  }
  function tissue(shader) {
    shader.vertexShader=shader.vertexShader.replace('#include <common>',`
      #include <common>
      attribute float aTissue;varying float shrimpTissue;varying vec3 shrimpLocal;
    `).replace('#include <begin_vertex>',`
      #include <begin_vertex>
      shrimpTissue=aTissue;shrimpLocal=position;
    `);
    shader.fragmentShader=shader.fragmentShader.replace('#include <common>',`
      #include <common>
      varying float shrimpTissue;varying vec3 shrimpLocal;
      float shrimpHash(vec3 p){return fract(sin(dot(p,vec3(127.1,311.7,74.7)))*43758.5453);}
      float shrimpNoise(vec3 p){
        vec3 b=floor(p),f=fract(p);f=f*f*(3.-2.*f);
        return mix(mix(mix(shrimpHash(b),shrimpHash(b+vec3(1,0,0)),f.x),
          mix(shrimpHash(b+vec3(0,1,0)),shrimpHash(b+vec3(1,1,0)),f.x),f.y),
          mix(mix(shrimpHash(b+vec3(0,0,1)),shrimpHash(b+vec3(1,0,1)),f.x),
          mix(shrimpHash(b+vec3(0,1,1)),shrimpHash(b+vec3(1,1,1)),f.x),f.y),f.z);
      }
    `);
  }
  shellMaterial.onBeforeCompile=shader=>{
    deform(shader);tissue(shader);
    shader.fragmentShader=shader.fragmentShader.replace('#include <color_fragment>',`
      #include <color_fragment>
      float pigmentPatch=shrimpNoise(shrimpLocal*vec3(29.,42.,35.));
      float detail=1.-smoothstep(.25,1.,length(fwidth(shrimpLocal))*240.);
      float pigment=shrimpNoise(shrimpLocal*240.);
      diffuseColor.rgb*=.62+.60*pigmentPatch-detail*.22*smoothstep(.40,.74,pigment);
      // A faint translucent gill-chamber contour inside the smaller head shield.
      vec2 gill=(shrimpLocal.xy-vec2(.14,.246))/vec2(.050,.043);
      float edge=exp(-pow((length(gill)-1.)/.10,2.));
      diffuseColor.rgb*=1.-edge*.18*smoothstep(.02,.05,abs(shrimpLocal.z));
      diffuseColor.a*=mix(.18,.985,shrimpTissue);
    `);
    waterLitShader(shader,{perLight:`
      reflectedLight.directDiffuse+=lit.color*material.diffuseColor*max(0.,dot(-geometryNormal,lit.direction))*.10;
    `});
  };
  shellMaterial.customProgramCacheKey=()=> 'cherry-reference-shell-v2';
  const shell=new THREE.Mesh(geometry.shell,shellMaterial);
  shell.renderOrder=1;
  shell.name='Red chitin and overlapping pleura';shell.castShadow=shell.receiveShadow=true;
  const depth=new THREE.MeshDepthMaterial({depthPacking:THREE.RGBADepthPacking});
  depth.onBeforeCompile=shader=>deform(shader);
  depth.customProgramCacheKey=()=> 'cherry-tail-shadow-v2';shell.customDepthMaterial=depth;
  root.add(shell);

  const limbMaterial=new THREE.MeshStandardMaterial({
    vertexColors:true,roughness:.37,transparent:true,depthWrite:false,envMapIntensity:.40,
  });
  limbMaterial.onBeforeCompile=shader=>{
    deform(shader,true);tissue(shader);
    shader.fragmentShader=shader.fragmentShader.replace('#include <color_fragment>',`
      #include <color_fragment>
      diffuseColor.a*=mix(.18,.92,shrimpTissue);
    `);
    waterLitShader(shader,{perLight:`
      reflectedLight.directDiffuse+=lit.color*material.diffuseColor*max(0.,dot(-geometryNormal,lit.direction))*.12;
    `});
  };
  limbMaterial.customProgramCacheKey=()=> 'cherry-reference-appendages-v2';
  const limbs=new THREE.Mesh(geometry.limbs,limbMaterial);
  limbs.renderOrder=2;
  limbs.name='Red walking legs, clear joints and fine antennae';limbs.receiveShadow=true;
  root.add(limbs);
  const eyes=new THREE.Mesh(geometry.eyes,new THREE.MeshPhysicalMaterial({
    vertexColors:true,roughness:.16,ior:1.4,clearcoat:.2,clearcoatRoughness:.2,
  }));
  eyes.name='Small stalked cherry shrimp eyes';root.add(eyes);
  scene.add(root);
  return {root,scale,gait,pose,feet,localUp};
}
