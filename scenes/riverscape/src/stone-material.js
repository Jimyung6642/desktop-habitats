import * as THREE from "three";

// World-space projection keeps mineral grain at the same scale on every face,
// including the tops of stones where spherical UVs collapse into a point.
const stoneGLSL = /* glsl */ `
  varying vec3 vStoneNormal;
  vec4 stoneTexel(sampler2D tex, vec3 p, vec3 n, vec3 weights) {
    vec3 direction = mix(vec3(-1.0), vec3(1.0), step(vec3(0.0), n));
    return texture2D(tex, vec2(-p.z * direction.x, p.y)) * weights.x
         + texture2D(tex, vec2(p.x, -p.z * direction.y)) * weights.y
         + texture2D(tex, vec2(p.x * direction.z, p.y)) * weights.z;
  }
  vec3 stoneNormal(sampler2D tex, vec3 p, vec3 n, vec3 weights, vec2 strength) {
    vec3 direction = mix(vec3(-1.0), vec3(1.0), step(vec3(0.0), n));
    vec3 nx = texture2D(tex, vec2(-p.z * direction.x, p.y)).xyz * 2.0 - 1.0;
    vec3 ny = texture2D(tex, vec2(p.x, -p.z * direction.y)).xyz * 2.0 - 1.0;
    vec3 nz = texture2D(tex, vec2(p.x * direction.z, p.y)).xyz * 2.0 - 1.0;
    vec2 sx = nx.xy * strength / max(nx.z, 0.25);
    vec2 sy = ny.xy * strength / max(ny.z, 0.25);
    vec2 sz = nz.xy * strength / max(nz.z, 0.25);
    vec3 slope = vec3(0.0, sx.y, -sx.x * direction.x) * weights.x
               + vec3(sy.x, 0.0, -sy.y * direction.y) * weights.y
               + vec3(sz.x * direction.z, sz.y, 0.0) * weights.z;
    // Project the blended slopes onto the actual surface tangent plane. A flat
    // normal map returns n exactly, avoiding lighting seams between projections.
    return normalize(n + slope - n * dot(n, slope));
  }
`;

export function projectStoneMaterial(material) {
  const original = material.onBeforeCompile;
  const originalKey = material.customProgramCacheKey();
  material.onBeforeCompile = shader => {
    original(shader);
    shader.vertexShader = shader.vertexShader
      .replace("#include <common>", "#include <common>\nvarying vec3 vStoneNormal;")
      .replace("#include <defaultnormal_vertex>", /* glsl */ `
        #include <defaultnormal_vertex>
        vStoneNormal = inverseTransformDirection(transformedNormal, viewMatrix);
      `);
    shader.fragmentShader = shader.fragmentShader
      .replace("#include <common>", `#include <common>\n${stoneGLSL}`)
      .replace("#include <map_fragment>", /* glsl */ `
        vec3 stoneN = normalize(vStoneNormal);
        vec3 stoneP = vWaterPosition * 0.72;
        vec3 stoneWeights = pow(abs(stoneN), vec3(6.0));
        stoneWeights /= dot(stoneWeights, vec3(1.0));
        ${THREE.ShaderChunk.map_fragment.replace(
          "texture2D( map, vMapUv )", "stoneTexel(map, stoneP, stoneN, stoneWeights)")}
      `)
      .replace("#include <normal_fragment_maps>", /* glsl */ `
        normal = normalize(mat3(viewMatrix) * stoneNormal(
          normalMap, stoneP, stoneN, stoneWeights, normalScale));
      `)
      .replace("#include <roughnessmap_fragment>", THREE.ShaderChunk.roughnessmap_fragment.replace(
        "texture2D( roughnessMap, vRoughnessMapUv )",
        "stoneTexel(roughnessMap, stoneP, stoneN, stoneWeights)"))
      .replace("#include <aomap_fragment>", THREE.ShaderChunk.aomap_fragment.replace(
        "texture2D( aoMap, vAoMapUv )", "stoneTexel(aoMap, stoneP, stoneN, stoneWeights)"));
  };
  material.customProgramCacheKey = () => `${originalKey}-stone-projection-v1`;
  return material;
}
