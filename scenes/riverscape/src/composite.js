import { createPostprocessing } from '../../shared/postprocessing.js';

export function createComposite(camera, settings) {
  return createPostprocessing(camera, { samples: settings.samples,
    uniforms: {
      inverseProjection: { value: camera.projectionMatrixInverse },
      projection: { value: camera.projectionMatrix },
      aoSamples: { value: settings.aoSamples },
      clarity: { value: settings.clarity },
    },
    fragmentShader: /* glsl */ `
      uniform sampler2D beauty, depth;
      uniform vec2 size;
      uniform mat4 inverseProjection, projection;
      uniform int aoSamples;
      uniform float clarity;
      varying vec2 vUv;
      vec3 viewPosition(vec2 uv) {
        vec4 p=inverseProjection*vec4(uv*2.-1.,texture2D(depth,uv).x*2.-1.,1.);
        return p.xyz/p.w;
      }
      void main() {
        vec3 color=texture2D(beauty,vUv).rgb;
        vec3 p=viewPosition(vUv);
        vec3 n=normalize(cross(dFdx(p),dFdy(p)));
        n*=dot(n,-p)<0.?-1.:1.;
        // World-space contact radius: distant silhouettes do not darken the
        // backing, and a tilted flat surface does not occlude itself.
        const float radius=.34;
        vec2 footprint=vec2(projection[0][0],projection[1][1])*.5*radius/max(.2,-p.z);
        float occlusion=0.;
        for(int i=0;i<12;i++) {
          if(i>=aoSamples) break;
          float a=float(i)*2.399963;
          float r=sqrt((float(i)+.5)/float(aoSamples));
          vec2 uv=vUv+vec2(cos(a),sin(a))*footprint*r;
          vec3 delta=viewPosition(clamp(uv,vec2(0.),vec2(1.)))-p;
          float distance=length(delta);
          float horizon=max(0.,dot(n,delta)/max(.001,distance)-.16);
          occlusion+=horizon*(1.-smoothstep(.035,radius,distance));
        }
        // Subtle contrast bounded by the actual neighbouring colours, without
        // bright ringing, glow or temporal jitter on fine leaves and antennae.
        if(clarity>0.) {
          vec2 px=1./size;
          vec3 a=texture2D(beauty,vUv+vec2(px.x,0.)).rgb;
          vec3 b=texture2D(beauty,vUv-vec2(px.x,0.)).rgb;
          vec3 c=texture2D(beauty,vUv+vec2(0.,px.y)).rgb;
          vec3 d=texture2D(beauty,vUv-vec2(0.,px.y)).rgb;
          vec3 low=min(color,min(min(a,b),min(c,d)));
          vec3 high=max(color,max(max(a,b),max(c,d)));
          color=clamp(color+(color-(a+b+c+d)*.25)*clarity,low,high);
        }
        color*=1.-min(.28,occlusion*1.7/float(aoSamples));
        vec2 vignette=(vUv-.5)*vec2(1.,.85);
        color*=1.-dot(vignette,vignette)*.15;
        gl_FragColor=vec4(color,1.);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
      }`,
  });
}
