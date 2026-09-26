import * as THREE from "three";
import { TRUNKS, ROCKS } from "./layout.js";
import { createSurfaceSupport } from "./surface-support.js";
import { createWoodSurface } from "./shrimp-habitat.js";
import { distanceMaterial } from "./depth-backdrop.js";
import { projectStoneMaterial } from "./stone-material.js";
export { ROCKS };
import {
  channel,
  groundHeight,
  noise,
  random,
  randomGenerator,
  range,
  smoothstep,
  vec,
} from "./math.js";
import {
  SURFACE_Y,
  currentGLSL,
  surfaceLightGLSL,
  waterLitShader,
  waterTime,
  CURRENT_SPEED,
} from "./water.js";

const TAU = Math.PI * 2;

// Moss gathers around the damp wood bases and on the shoulders of the path stones.
// The upper, peeled trunks stay mostly bare so their grain and old knots remain visible.
const MOSS_COLONIES = TRUNKS.map(trunk => ({
  center: vec(trunk.x, groundHeight(trunk.x, trunk.z) + 0.18, trunk.z),
  radius: trunk.radius * 1.7, strength: 0.56,
}));
// A stone is buried to a little under half its height, and deeper the more it leans, so
// the raised side of a leaning stone still meets the sand.
export function rockCenterY(rock) {
  return (
    groundHeight(rock.x, rock.z) +
    rock.ry * 0.57 -
    Math.abs(rock.lean) * rock.rx * 0.55
  );
}
// Upright cut driftwood with an irregular waist, a slight lean and small weathered
// branch stubs. Roots flare into the carpet rather than reaching across the sand path.
const BRANCHES = TRUNKS.flatMap((trunk, i) => {
  const { x, z, radius: r, top, lean, bend } = trunk;
  const base = groundHeight(x, z) - 0.14;
  const h = top - base;
  const trunkPoints = [
    [x, base, z],
    [x + bend, base + h * 0.16, z - bend * 0.5],
    [x - bend * 0.6 + lean * 0.5, base + h * 0.55, z + bend],
    [x + lean, top, z - bend * 0.4],
  ];
  const branches = [{ p: trunkPoints, r, t: r * (0.74 + (i % 3) * 0.055),
    trunk: true, obstacle: true, landmarks: i < 8 }];
  if (i < 8) {
    const side = i % 2 ? -1 : 1;
    const y = base + h * (0.29 + (i % 4) * 0.115);
    branches.push({
      p: [[x, y - r * 0.4, z], [x + side * r * 0.75, y, z + r * 0.42],
        [x + side * r * 1.38, y + r * 0.45, z + r * 0.58]],
      r: r * 0.46, t: r * 0.21, obstacle: true,
    });
    for (const side of [-1, 1]) {
      const rx = x + side * r * 1.9, rz = z - r * 0.7;
      branches.push({ p: [[x, base + r, z], [x + side * r * 0.8, base + r * 0.2, z - r * 0.3],
        [rx, groundHeight(rx, rz) - 0.10, rz]], r: r * 0.5, t: r * 0.07 });
    }
  }
  const tone = [1.12, 0.60, 1.14, 0.94, 0.85, 1.06, 0.72, 0.80][i % 8];
  for (const branch of branches) { branch.tone = tone; branch.trunkIndex = i; }
  return branches;
});

function mossCoverage(p, n, shelter, bias = 0) {
  let colony = 0;
  for (const c of MOSS_COLONIES) {
    const d = p.distanceToSquared(c.center) / (c.radius * c.radius);
    colony = Math.max(colony, c.strength * Math.exp(-d * 1.6));
  }
  const patch =
    noise(p.x * 1.15 + 5.2, p.y * 1.15, p.z * 1.15) * 0.55 +
    noise(p.x * 3.4 + 1.7, p.y * 3.4, p.z * 3.4 + 8.4) * 0.45;
  const age = noise(p.x * 0.4 + 21.3, p.y * 0.4, p.z * 0.4 + 4.6);
  const exposure = 0.4 + 0.6 * Math.max(0, n.y);
  const value = patch * exposure + shelter * 0.25 + colony + bias;
  const threshold = 0.7 - age * 0.3;
  return smoothstep(threshold, threshold + 0.25, value);
}

// Writes per-vertex coverage into `geometry` (in world space through `matrix`) and returns
// the vertices that could carry fronds.
function growMoss(geometry, matrix, shelterAt, bias = 0) {
  const positions = geometry.attributes.position;
  const normals = geometry.attributes.normal;
  const normalMatrix = new THREE.Matrix3().getNormalMatrix(matrix);
  const coverage = new Float32Array(positions.count);
  const samples = [];
  const p = new THREE.Vector3(),
    n = new THREE.Vector3();
  for (let i = 0; i < positions.count; i++) {
    p.fromBufferAttribute(positions, i).applyMatrix4(matrix);
    n.fromBufferAttribute(normals, i).applyMatrix3(normalMatrix).normalize();
    const c = mossCoverage(p, n, shelterAt(p, i), bias);
    coverage[i] = c;
    if (c > 0.3)
      samples.push({ position: p.clone(), normal: n.clone(), coverage: c });
  }
  geometry.setAttribute("moss", new THREE.BufferAttribute(coverage, 1));
  return samples;
}

// The moss layer on rock, wood and sand: a thin algal film where growth is young, a dark
// velvety turf where it is established. Turf is rough, its fibres scatter light at grazing
// angles, and its fringe is broken up by fine noise.
const mossGLSL = /* glsl */ `
  varying float vMoss;
  uniform vec3 mossFilm;
  uniform vec3 mossTurf;
  float gMoss = 0.0;
  vec3 gMossColor = vec3(0.0);
  float mossHash(vec3 p) { return fract(sin(dot(p, vec3(127.1, 311.7, 74.7))) * 43758.5453); }
  float mossNoise(vec3 p) {
    vec3 i = floor(p), f = fract(p);
    f = f * f * (3.0 - 2.0 * f);
    return mix(
      mix(mix(mossHash(i), mossHash(i + vec3(1, 0, 0)), f.x), mix(mossHash(i + vec3(0, 1, 0)), mossHash(i + vec3(1, 1, 0)), f.x), f.y),
      mix(mix(mossHash(i + vec3(0, 0, 1)), mossHash(i + vec3(1, 0, 1)), f.x), mix(mossHash(i + vec3(0, 1, 1)), mossHash(i + vec3(1, 1, 1)), f.x), f.y),
      f.z);
  }
`;
function mossLayer(material, film, turf, preserveSurface = false) {
  material.onBeforeCompile = (shader) => {
    shader.uniforms.mossFilm = { value: new THREE.Color(film) };
    shader.uniforms.mossTurf = { value: new THREE.Color(turf) };
    shader.vertexShader = shader.vertexShader
      .replace(
        "#include <common>",
        "#include <common>\nattribute float moss; varying float vMoss;",
      )
      .replace("#include <begin_vertex>", "#include <begin_vertex>\nvMoss = moss;");
    shader.fragmentShader = shader.fragmentShader
      .replace("#include <common>", `#include <common>\n${mossGLSL}`)
      .replace(
        "#include <color_fragment>",
        /* glsl */ `
        #include <color_fragment>
        vec3 mossFuzz = vec3(0.0);
        if (vMoss > 0.02) {
          float mossFine = mossNoise(vWaterPosition * ${preserveSurface ? "18.0" : "9.0"}) * 0.6
                         + mossNoise(vWaterPosition * ${preserveSurface ? "62.0" : "27.0"}) * 0.4;
          gMoss = smoothstep(0.07, 0.5, vMoss + (mossFine - 0.5) * 0.45);
          gMossColor = mix(mossFilm, mossTurf, smoothstep(0.15, 0.85, vMoss)) * (0.6 + 0.8 * mossFine);
          // Growth lies in the same shade as the surface it grows on: the pit of a stone,
          // a split in the bark, the sand under the canopy.
          #ifdef USE_COLOR
            gMossColor *= vColor;
          #endif
          ${preserveSurface ? `
          // A thin, broken film stains the underlying grain instead of painting
          // it over. Actual fronds supply the thicker moss above this surface.
          vec3 filmedSurface = diffuseColor.rgb * vec3(0.54, 0.74, 0.29) + gMossColor * 0.45;
          diffuseColor.rgb = mix(diffuseColor.rgb, filmedSurface, gMoss * 0.86);
          ` : "diffuseColor.rgb = mix(diffuseColor.rgb, gMossColor, gMoss);"}
          mossFuzz = vec3(mossFine - 0.5, mossNoise(vWaterPosition * 31.0 + 7.0) - 0.5, fract(mossFine * 7.0) - 0.5);
        }
      `,
      )
      .replace(
        "#include <roughnessmap_fragment>",
        `#include <roughnessmap_fragment>
        ${preserveSurface ? "roughnessFactor = clamp(0.28 + roughnessFactor * 0.68, 0.48, 0.95);" : ""}
        roughnessFactor = mix(roughnessFactor, ${preserveSurface ? "0.96" : "1.0"}, gMoss);`,
      )
      .replace(
        "#include <normal_fragment_maps>",
        /* glsl */ `
        #include <normal_fragment_maps>
        normal = normalize(normal + gMoss * ${preserveSurface ? "0.14" : "0.5"} * mossFuzz);
      `,
      )
      .replace(
        "#include <lights_fragment_end>",
        /* glsl */ `
        #include <lights_fragment_end>
        float grazing = pow(1.0 - saturate(dot(normal, geometryViewDir)), 3.0);
        reflectedLight.indirectDiffuse += gMoss * grazing * gMossColor * ${preserveSurface ? "0.3" : "0.6"};
      `,
      );
    waterLitShader(shader);
  };
  material.customProgramCacheKey = () => `mossy-surface-v4-${preserveSurface}`;
  return material;
}

// A young film of algae is olive and thin; established turf is dark green. The film on
// sand is browner (diatoms) than on stone and wood.
async function surface(loader, name, repeat, color, film, turf = "#0b1e08") {
  const hardscape = name !== "sand_01";
  // Keep colour detail at 4K, and use lossless 2K normals plus a shared AO /
  // roughness texture. Only colour is sRGB; all surface measurements are linear.
  const [map, normalMap, arm] = await Promise.all([
    loader.loadAsync(`assets/${name}_diff${hardscape ? "_4k" : ""}.jpg`),
    loader.loadAsync(`assets/${name}_nor_gl${hardscape ? "_2k.png" : ".jpg"}`),
    hardscape ? loader.loadAsync(`assets/${name}_arm_2k.jpg`) : null,
  ]);
  map.colorSpace = THREE.SRGBColorSpace;
  for (const texture of [map, normalMap, arm].filter(Boolean)) {
    texture.wrapS = texture.wrapT = THREE.RepeatWrapping;
    texture.repeat.set(...repeat);
    texture.anisotropy = 8;
  }
  return mossLayer(
    new THREE.MeshStandardMaterial({
      map,
      normalMap,
      roughnessMap: arm,
      aoMap: arm,
      aoMapIntensity: 0.45,
      color,
      roughness: 0.92,
      normalScale: new THREE.Vector2(0.65, 0.65),
      vertexColors: true,
    }),
    film,
    turf,
    hardscape,
  );
}

function rockGeometry(seed, detail = 112) {
  const geometry = new THREE.SphereGeometry(
    1,
    detail,
    Math.floor(detail * 0.7),
  );
  const positions = geometry.attributes.position;
  const color = new THREE.Color();
  const colors = [];
  const planes = [];
  const sample = randomGenerator(Math.round(seed * 1000) + 27461);
  const pits = [];
  if (detail > 20)
    for (let i = 0; i < 115; i++) {
      const y = sample() * 2 - 1,
        a = sample() * Math.PI * 2,
        r = Math.sqrt(1 - y * y);
      const radius = 0.022 + sample() ** 2 * 0.18;
      pits.push({
        x: Math.cos(a) * r,
        y,
        z: Math.sin(a) * r,
        radius,
        depth: radius * (0.3 + sample() * 0.8),
      });
    }
  for (let i = 0; i < 15; i++) {
    const a = i * 2.399963 + seed,
      y = 1 - (2 * (i + 0.5)) / 15,
      r = Math.sqrt(1 - y * y);
    planes.push({
      normal: vec(Math.cos(a) * r, y, Math.sin(a) * r),
      distance: 0.76 + noise(i, seed, 4) * 0.35,
    });
  }
  for (let i = 0; i < positions.count; i++) {
    const x = positions.getX(i),
      y = positions.getY(i),
      z = positions.getZ(i);
    const a = noise(x * 2.5 + seed, y * 2.5, z * 2.5);
    const b = noise(x * 7 + seed, y * 7, z * 7);
    const c = noise(x * 22 + seed, y * 22, z * 22);
    const strata = Math.pow(
      Math.abs(Math.sin(x * 3.2 + y * 9 + z * 2.7 + a * 6)),
      18,
    );
    let radius = 1.28;
    for (const plane of planes) {
      const dot = x * plane.normal.x + y * plane.normal.y + z * plane.normal.z;
      if (dot > 0) radius = Math.min(radius, plane.distance / dot);
    }
    radius +=
      (a - 0.5) * 0.1 + (b - 0.5) * 0.055 + (c - 0.5) * 0.023 - strata * 0.017;
    let depression = 0;
    let rim = 0;
    for (const pit of pits) {
      const d =
        Math.sqrt(
          (x - pit.x) ** 2 + ((y - pit.y) * 1.17) ** 2 + (z - pit.z) ** 2,
        ) / pit.radius;
      if (d < 1) depression += pit.depth * (1 - d * d) ** 0.65;
      else if (d < 1.2) rim += (1.2 - d) * 0.1;
    }
    radius -= Math.min(0.25, depression);
    positions.setXYZ(i, x * radius, y * radius, z * radius);
    color
      .setRGB(1, 0.985, 0.945)
      .multiplyScalar(
        (0.8 + 0.2 * a + rim) * (1 - Math.min(0.52, depression * 2.1)),
      );
    colors.push(color.r, color.g, color.b);
  }
  geometry.setAttribute("color", new THREE.Float32BufferAttribute(colors, 3));
  geometry.computeVertexNormals();
  return geometry;
}

function branchGeometry(points, baseRadius, tipRadius, seed, trunk = false, tone = 1, detail = 1) {
  const curve = new THREE.CatmullRomCurve3(points);
  const length = curve.getLength();
  const rows = Math.max(8, Math.ceil(length * (trunk ? 18 : 15) * detail)),
    cols = Math.max(10, Math.round((trunk ? 56 : 24) * detail));
  const positions = [],
    uv = [],
    indices = [],
    colors = [];
  const frames = curve.computeFrenetFrames(rows, false);
  const splitRandom = randomGenerator(Math.round(seed * 1000) + 51781);
  const splits = Array.from({ length: trunk ? 9 : 5 }, () => ({
    a: splitRandom() * Math.PI * 2,
    t: splitRandom(),
    width: 0.025 + splitRandom() * 0.09,
    length: 0.025 + splitRandom() * 0.15,
    depth: 0.035 + splitRandom() * 0.12,
  }));
  const knots = Array.from({ length: trunk ? 3 : 0 }, (_, i) => ({
    a: Math.PI + (splitRandom() - 0.5) * 2.4, t: 0.18 + i * 0.28 + splitRandom() * 0.08,
    width: 0.28 + splitRandom() * 0.18, length: 0.035 + splitRandom() * 0.018,
  }));
  for (let i = 0; i <= rows; i++) {
    const t = i / rows,
      p = curve.getPointAt(t);
    const radius = THREE.MathUtils.lerp(
      baseRadius,
      tipRadius,
      Math.pow(t, 0.8),
    );
    for (let j = 0; j <= cols; j++) {
      const a = (j / cols) * Math.PI * 2;
      const ridges =
        0.029 * Math.sin(a * 7 + t * 3 + seed) +
        0.016 * Math.sin(a * 17 - t * 7) +
        0.009 * Math.sin(a * 31 + t * 17);
      const weather = noise(Math.cos(a) * 5 + seed, t * 30, Math.sin(a) * 5);
      const channel =
        Math.pow(0.5 + 0.5 * Math.sin(a * 13 + Math.sin(t * 15) * 0.25), 10) *
        0.026;
      let hollow = 0, rim = 0;
      for (const knot of knots) {
        const angle = Math.atan2(Math.sin(a - knot.a), Math.cos(a - knot.a));
        const d = Math.hypot(angle / knot.width, (t - knot.t) / knot.length);
        hollow += 0.25 * Math.exp(-d * d * 3.2);
        rim += 0.11 * Math.exp(-(((d - 0.92) / 0.28) ** 2));
      }
      const flare = trunk ? 1 + 0.18 * Math.exp(-t * 22) : 1;
      let splitDepth = 0;
      for (const split of splits) {
        const angle = a - split.a - 0.07 * Math.sin(t * 37 + seed);
        const around =
          Math.atan2(Math.sin(angle), Math.cos(angle)) / split.width;
        const along = (t - split.t) / split.length;
        const distance = around * around + along * along;
        if (distance < 1)
          splitDepth += split.depth * Math.pow(1 - distance, 0.6);
      }
      const r =
        radius *
        flare *
        (1 +
          ridges +
          (weather - 0.5) * 0.08 + rim - hollow -
          channel -
          Math.min(0.25, splitDepth));
      const radial = frames.normals[i]
        .clone()
        .multiplyScalar(Math.cos(a))
        .addScaledVector(frames.binormals[i], Math.sin(a));
      const v = p.clone().addScaledVector(radial, r);
      positions.push(v.x, v.y, v.z);
      // Grain has a consistent size on thick trunks and narrow branch stubs.
      uv.push(j / cols * TAU * baseRadius * 0.24 + seed * 0.137,
        length * t * 0.22 + seed * 0.0719);
      const weathered = noise(Math.cos(a) * 2.7 + seed, t * 4.2, Math.sin(a) * 2.7);
      const darkBark = smoothstep(0.38, 0.65, weathered);
      const tint = tone * (0.94 + weather * 0.10 - darkBark * 0.19 + rim * 0.35) *
        (1 - Math.min(0.52, splitDepth * 1.2 + hollow * 1.35));
      const warmth = 0.025 * Math.sin(seed * 1.7);
      colors.push(tint, tint * (0.92 + warmth), tint * (0.82 + warmth));
      if (i < rows && j < cols) {
        const k = i * (cols + 1) + j;
        indices.push(k, k + 1, k + cols + 1, k + 1, k + cols + 2, k + cols + 1);
      }
    }
  }
  // Close the weathered tips; the narrower branches intersect inside their parent.
  for (const i of [0, rows]) {
    const p = curve.getPointAt(i / rows),
      k = positions.length / 3;
    positions.push(p.x, p.y, p.z);
    uv.push(0.5, 0.5);
    colors.push(0.38, 0.32, 0.23);
    for (let j = 0; j < cols; j++) {
      if (i === 0) indices.push(k, j + 1, j);
      else indices.push(k, i * (cols + 1) + j, i * (cols + 1) + j + 1);
    }
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute(
    "position",
    new THREE.Float32BufferAttribute(positions, 3),
  );
  geometry.setAttribute("uv", new THREE.Float32BufferAttribute(uv, 2));
  geometry.setAttribute("color", new THREE.Float32BufferAttribute(colors, 3));
  geometry.setIndex(indices);
  geometry.computeVertexNormals();
  geometry.userData.rings = { rows, cols };
  return geometry;
}

// Static pieces share a material and one draw call. Their world-space positions,
// normals and moss coverage are retained, including the distinct grain of each trunk.
function addSurfaceBatch(scene, geometries, material, name) {
  const merged = new THREE.BufferGeometry();
  const vertices = geometries.reduce((sum, g) => sum + g.attributes.position.count, 0);
  for (const [key, attribute] of Object.entries(geometries[0].attributes)) {
    const array = new Float32Array(vertices * attribute.itemSize);
    let offset = 0;
    for (const geometry of geometries) {
      array.set(geometry.attributes[key].array, offset);
      offset += geometry.attributes[key].array.length;
    }
    merged.setAttribute(key, new THREE.BufferAttribute(array, attribute.itemSize));
  }
  const indices = new Uint32Array(geometries.reduce((sum, g) => sum + g.index.count, 0));
  let indexOffset = 0, vertexOffset = 0;
  for (const geometry of geometries) {
    for (const index of geometry.index.array) indices[indexOffset++] = index + vertexOffset;
    vertexOffset += geometry.attributes.position.count;
    geometry.dispose();
  }
  merged.setIndex(new THREE.BufferAttribute(indices, 1));
  merged.computeBoundingSphere();
  const mesh = new THREE.Mesh(merged, material);
  mesh.name = name;
  mesh.castShadow = mesh.receiveShadow = true;
  scene.add(mesh);
  return mesh;
}

function createContactShadows(scene, rocks) {
  const canvas = document.createElement("canvas");
  canvas.width = canvas.height = 128;
  const context = canvas.getContext("2d");
  const gradient = context.createRadialGradient(64, 64, 5, 64, 64, 64);
  gradient.addColorStop(0, "rgba(0,0,0,.85)");
  gradient.addColorStop(0.42, "rgba(0,0,0,.48)");
  gradient.addColorStop(1, "rgba(0,0,0,0)");
  context.fillStyle = gradient;
  context.fillRect(0, 0, 128, 128);
  const map = new THREE.CanvasTexture(canvas);
  const material = new THREE.MeshBasicMaterial({
    map,
    transparent: true,
    depthWrite: false,
    opacity: 0.67,
    polygonOffset: true,
    polygonOffsetFactor: -1,
  });
  const shadows = new THREE.InstancedMesh(new THREE.PlaneGeometry(1, 1), material, rocks.length);
  shadows.name = "Stone contact shadows";
  const transform = new THREE.Object3D();
  rocks.forEach((rock, i) => {
    transform.rotation.x = -Math.PI / 2;
    transform.scale.set(rock.rx * 3.5, rock.rz * 3.5, 1);
    transform.position.set(rock.x, groundHeight(rock.x, rock.z) + 0.008, rock.z);
    transform.updateMatrix();
    shadows.setMatrixAt(i, transform.matrix);
  });
  scene.add(shadows);
}

// One moss frond: a short curved stem carrying pairs of tiny leaflets. Instances differ in
// size, lean and colour with the coverage where they grow.
function frondGeometry() {
  const positions = [],
    colors = [],
    indices = [];
  const stem = new THREE.QuadraticBezierCurve3(
    vec(0, 0, 0),
    vec(0.02, 0.11, 0.01),
    vec(0.07, 0.2, 0.03),
  );
  const push = (p, color) => {
    positions.push(p.x, p.y, p.z);
    colors.push(color.r, color.g, color.b);
    return positions.length / 3 - 1;
  };
  const stemColor = new THREE.Color("#3a5a1e");
  const segments = 4;
  for (let i = 0; i <= segments; i++) {
    const t = i / segments,
      p = stem.getPoint(t),
      radius = 0.0035 * (1 - 0.6 * t);
    for (let j = 0; j < 3; j++) {
      const a = (j / 3) * TAU;
      push(p.clone().add(vec(Math.cos(a) * radius, 0, Math.sin(a) * radius)), stemColor);
      if (i < segments) {
        const k = i * 3 + j,
          next = i * 3 + ((j + 1) % 3);
        indices.push(k, k + 3, next, next, k + 3, next + 3);
      }
    }
  }
  for (let i = 0; i < 6; i++) {
    const t = 0.2 + i * 0.15,
      base = stem.getPoint(t),
      tangent = stem.getTangent(t);
    for (const side of [-1, 1]) {
      const out = vec(side, 0.55 + 0.1 * (i % 2), 0.45 * side * (i % 2 ? 1 : -1)).normalize();
      out.addScaledVector(tangent, -out.dot(tangent) * 0.4).normalize();
      const across = new THREE.Vector3().crossVectors(out, tangent).normalize();
      const length = 0.042 * (1 - 0.08 * i),
        width = 0.017;
      const shade = new THREE.Color().setHSL(0.245 + 0.015 * side, 0.65, 0.22 + 0.05 * t);
      const a = push(base, shade);
      const b = push(base.clone().addScaledVector(out, length * 0.5).addScaledVector(across, width * 0.5), shade);
      const c = push(base.clone().addScaledVector(out, length), shade.clone().multiplyScalar(1.15));
      const d = push(base.clone().addScaledVector(out, length * 0.5).addScaledVector(across, -width * 0.5), shade);
      indices.push(a, b, c, a, c, d);
    }
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
  geometry.setAttribute("color", new THREE.Float32BufferAttribute(colors, 3));
  geometry.setIndex(indices);
  geometry.computeVertexNormals();
  return geometry;
}

// Fronds stand where the turf is dense. They grow up toward the light more than straight
// off the surface, lean at random, and are picked by weighted sampling so the count is fixed.
function plantFronds(scene, groups) {
  groups = groups.filter(group => group.samples.length > 0);
  const total = groups.reduce((sum, group) => sum + group.count, 0);
  const material = new THREE.MeshStandardMaterial({
    vertexColors: true,
    roughness: 0.95,
    side: THREE.DoubleSide,
  });
  material.onBeforeCompile = (shader) => waterLitShader(shader);
  material.customProgramCacheKey = () => "moss-frond-v1";
  const fronds = new THREE.InstancedMesh(frondGeometry(), material, total);
  const object = new THREE.Object3D(),
    up = new THREE.Vector3(),
    color = new THREE.Color();
  let index = 0;
  for (const { samples, count, scale = 1 } of groups) {
    const weights = samples.map((s) => Math.max(0, s.coverage - 0.3) ** 2.2);
    const sum = weights.reduce((a, b) => a + b, 0);
    for (let i = 0; i < count; i++) {
      let pick = random() * sum,
        j = 0;
      while (j < weights.length - 1 && pick > weights[j]) pick -= weights[j++];
      const { position, normal, coverage } = samples[j];
      up.copy(normal).lerp(vec(0, 1, 0), 0.4).normalize();
      up.add(vec(range(-0.3, 0.3), range(-0.15, 0.15), range(-0.3, 0.3))).normalize();
      object.position.copy(position).addScaledVector(normal, -0.01);
      object.position.add(vec(range(-0.03, 0.03), 0, range(-0.03, 0.03)));
      object.quaternion.setFromUnitVectors(vec(0, 1, 0), up);
      object.rotateY(range(0, TAU));
      const size = (0.4 + coverage * 0.8) * range(0.5, 1.6) * scale;
      object.scale.set(size * range(0.8, 1.2), size, size * range(0.8, 1.2));
      object.updateMatrix();
      fronds.setMatrixAt(index, object.matrix);
      color.setHSL(0.25 + range(-0.02, 0.02), 0.55, 0.42 - coverage * 0.2 + range(-0.05, 0.05));
      fronds.setColorAt(index, color);
      index++;
    }
  }
  fronds.receiveShadow = true;
  scene.add(fronds);
}

export async function createEnvironment(scene, { anisotropy = 8 } = {}) {
  const loader = new THREE.TextureLoader();
  const [rockMaterial, woodMaterial, sandMaterial] = await Promise.all([
    surface(loader, "rock_boulder_dry", [1, 1], 0x62665b, "#2e4315"),
    surface(loader, "rough_wood", [1, 1], 0xc9b49b, "#334a16"),
    surface(loader, "sand_01", [12, 8], 0xe6c98a, "#5a5a26", "#23401a"),
  ]);
  for (const material of [rockMaterial, woodMaterial, sandMaterial]) {
    material.map.anisotropy = anisotropy;
    material.normalMap.anisotropy = anisotropy;
    if (material.roughnessMap) material.roughnessMap.anisotropy = anisotropy;
  }
  projectStoneMaterial(rockMaterial);
  rockMaterial.normalScale.set(0.7, 0.7);
  woodMaterial.roughness = 0.94;
  woodMaterial.normalScale.set(0.72, 0.72);
  sandMaterial.normalScale.set(0.32, 0.32);

  const rocks = ROCKS;
  // How sheltered the sand is from the flow: against the stones and the foot of the wood,
  // and under the back planting.
  const shelterAt = (x, z) => {
    let shelter = 0;
    for (const r of rocks) {
      const size = Math.max(r.rx, r.rz);
      const gap = Math.hypot(x - r.x, z - r.z) - size;
      shelter = Math.max(shelter, smoothstep(0.6 + 0.8 * size, 0.1, gap));
    }
    for (const trunk of TRUNKS)
      shelter = Math.max(shelter, smoothstep(trunk.radius + 0.9, trunk.radius,
        Math.hypot(x - trunk.x, z - trunk.z)));
    return Math.max(shelter, 0.55 * smoothstep(-1.4, -3.2, z));
  };
  // Algae films the sheltered sand; the open channel is swept nearly clean.
  const sandShelter = (p) => shelterAt(p.x, p.z) * (1 - 0.85 * channel(p.x, p.z));
  // Relative sediment density: grit and pebbles gather where the sand is sheltered and
  // along the banks of the channel, where the flow leaving it slackens.
  const sediment = (x, z) => {
    const open = channel(x, z);
    const bank = smoothstep(0.55, 0.2, open) * smoothstep(0.02, 0.1, open);
    return (0.06 + 1.3 * shelterAt(x, z) + 0.6 * bank) * (1 - 0.85 * open);
  };
  // A spot on the sand drawn with probability rising with the sediment there; `floor` is
  // the share that falls everywhere regardless.
  const sedimentSpot = (minX, maxX, minZ, maxZ, floor = 0) => {
    for (;;) {
      const x = range(minX, maxX),
        z = range(minZ, maxZ);
      if (random() * 2 < floor + (1 - floor) * sediment(x, z)) return [x, z];
    }
  };

  const ground = new THREE.PlaneGeometry(30, 18, 220, 140);
  ground.rotateX(-Math.PI / 2);
  const position = ground.attributes.position;
  const groundColors = [];
  for (let i = 0; i < position.count; i++) {
    const x = position.getX(i),
      z = position.getZ(i);
    position.setY(i, groundHeight(x, z) + 0.008 * noise(x * 40, 0, z * 40));
    // Warm fine gravel in the path, dark planted soil on the banks. The distinction
    // follows the same continuous mask as the carpet, including its distant bends.
    const open = smoothstep(0.15, 0.68, channel(x, z));
    const shade = 0.70 + 0.30 * smoothstep(-6, 3, z);
    groundColors.push(shade * (0.075 + 0.925 * open),
      shade * (0.080 + 0.920 * open), shade * (0.044 + 0.956 * open));
  }
  ground.setAttribute(
    "color",
    new THREE.Float32BufferAttribute(groundColors, 3),
  );
  ground.computeVertexNormals();
  const sand = new THREE.Mesh(ground, sandMaterial);
  sand.receiveShadow = true;
  scene.add(sand);
  // Only the most sheltered sand films over; a healthy riverbed is mostly clean.
  const sandSamples = growMoss(
    ground,
    sand.matrix,
    (p) => 0.4 * sandShelter(p),
    -0.26,
  ).filter((s) => s.position.z > -3.6 && Math.abs(s.position.x) < 9.5);

  const obstacles = [];
  const landmarks = [];
  const rockSamples = [];
  const rockSurfaces = [];
  rocks.forEach((r, i) => {
    const geometry = rockGeometry(i * 2.63, r.rx > 0.8 ? 72 : 48);
    // The material projects all its maps in world space after this transform.
    const mesh = new THREE.Mesh(geometry, rockMaterial);
    mesh.scale.set(r.rx, r.ry, r.rz);
    mesh.position.set(r.x, rockCenterY(r), r.z);
    // The lean is applied after the stone's turn, about the tank's front axis, so the
    // stones share a direction however each one is turned.
    mesh.rotation.set(range(-0.1, 0.1), range(-3, 3), r.lean, "ZYX");
    mesh.updateMatrix();
    // Crevices shelter spores: the darker the stone (its pits), the more growth.
    const tints = mesh.geometry.attributes.color;
    rockSamples.push(
      ...growMoss(
        mesh.geometry,
        mesh.matrix,
        (p, index) =>
          0.6 * (1 - tints.getX(index)) +
          0.3 * smoothstep(0.9, 0.2, p.y - groundHeight(p.x, p.z)),
        0.1,
      ),
    );
    rockSurfaces.push(geometry.applyMatrix4(mesh.matrix));
    const radius = Math.max(r.rx, r.ry, r.rz) * 0.82;
    obstacles.push({ center: mesh.position.clone(), radius, kind: 'rock', surfaceId: i });
    if (radius > 0.5)
      landmarks.push({
        kind: "rock",
        point: mesh.position.clone().add(vec(0, r.ry * 0.85, r.rz * 0.55)),
        obstacle: obstacles.length - 1,
      });
  });
  const stones = addSurfaceBatch(scene, rockSurfaces, rockMaterial, "Path stones");
  const support = createSurfaceSupport([stones.geometry], groundHeight);
  support.woods = [];
  createContactShadows(scene, rocks);

  const smallRockGeometry = rockGeometry(37, 12);
  smallRockGeometry.setAttribute(
    "moss",
    new THREE.BufferAttribute(new Float32Array(smallRockGeometry.attributes.position.count), 1),
  );
  const gravel = new THREE.InstancedMesh(smallRockGeometry, rockMaterial, 340);
  const matrix = new THREE.Object3D(),
    color = new THREE.Color();
  for (let i = 0; i < gravel.count; i++) {
    const [x, z] = sedimentSpot(-8.7, 8.7, -3.2, 3.1);
    // Mostly small, a few large, and the large ones lie where the flow dropped them, by
    // the stones; only fine grains stay in the swept channel. Pebbles lie flat, part sunk
    // in the sand. They are the same rock as the stones.
    const s =
      (0.02 + 0.1 * random() ** 2.4) *
      (0.7 + 0.8 * Math.min(1, sediment(x, z))) *
      (1 - 0.45 * channel(x, z));
    matrix.position.set(x, groundHeight(x, z) + s * 0.3, z);
    matrix.scale.set(s * range(0.8, 1.35), s * range(0.45, 0.8), s);
    matrix.rotation.set(range(-0.4, 0.4), range(0, 3), range(-0.4, 0.4));
    matrix.updateMatrix();
    gravel.setMatrixAt(i, matrix.matrix);
    gravel.setColorAt(i, color.setHSL(0.1, 0.1, range(0.5, 0.95)));
  }
  gravel.castShadow = gravel.receiveShadow = true;
  scene.add(gravel);

  const gritMaterial = new THREE.MeshStandardMaterial({
    color: 0xb6a07a,
    roughness: 1,
  });
  const grit = new THREE.InstancedMesh(
    new THREE.IcosahedronGeometry(1, 0),
    gritMaterial,
    4200,
  );
  for (let i = 0; i < grit.count; i++) {
    const [x, z] = sedimentSpot(-9, 9, -4, 4, 0.35);
    const s = range(0.006, 0.022);
    matrix.position.set(x, groundHeight(x, z) + s * 0.3, z);
    matrix.scale.set(s, s * 0.55, s);
    matrix.rotation.set(range(0, 3), range(0, 3), range(0, 3));
    matrix.updateMatrix();
    grit.setMatrixAt(i, matrix.matrix);
    grit.setColorAt(
      i,
      color.setHSL(range(0.08, 0.16), range(0.12, 0.34), range(0.15, 0.66)),
    );
  }
  grit.receiveShadow = true;
  scene.add(grit);

  const woodSamples = [];
  const woodSurfaces = [];
  BRANCHES.forEach((branch, i) => {
    const points = branch.p.map((p) => vec(...p));
    const geometry = branchGeometry(points, branch.r, branch.t, i * 5.7, branch.trunk, branch.tone);
    if (branch.trunk) support.woods.push(createWoodSurface(geometry, branch.trunkIndex));
    const mesh = new THREE.Mesh(geometry, woodMaterial);
    woodSurfaces.push(geometry);
    // Splits and channels in the bark hold moss; the bark tint records them.
    const tints = geometry.attributes.color;
    woodSamples.push(
      ...growMoss(geometry, mesh.matrix, (p, index) =>
        0.7 * (1 - tints.getX(index)) * smoothstep(2.2, 0.4, p.y - groundHeight(p.x, p.z)), -0.04)
        .filter(sample => sample.position.y - groundHeight(sample.position.x, sample.position.z) < 1.6),
    );
    if (branch.obstacle) {
      const curve = new THREE.CatmullRomCurve3(points);
      const steps = Math.ceil(curve.getLength() / Math.min(0.48, branch.t * 1.25));
      for (let k = 0; k <= steps; k++) {
        const t = k / steps;
        const radius =
          THREE.MathUtils.lerp(branch.r, branch.t, t) * 0.87 + 0.12;
        obstacles.push({ center: curve.getPoint(t), radius, kind: 'wood',
          surfaceId: branch.trunkIndex, branch: !branch.trunk });
        if (branch.landmarks && t > 0.1 && t < 0.8 && k % 3 === 0)
          landmarks.push({
            kind: "wood",
            point: curve.getPoint(t).add(vec(0, radius * 0.6, radius * 0.9)),
            obstacle: obstacles.length - 1,
          });
      }
    }
  });
  addSurfaceBatch(scene, woodSurfaces, woodMaterial, "Forest driftwood");
  const farWood=[],rearRandom=randomGenerator(29019);
  for(let layer=0;layer<3;layer++)for(let i=0;i<12;i++) {
    const x=-16+i*2.9+(rearRandom()-.5)*1.6, z=-8.8-layer*3.0;
    const radius=(.25+rearRandom()*.23)*(1-layer*.12),lean=(rearRandom()-.5)*1.6;
    const points=[vec(x,.6,z),vec(x+lean*.25,4.2,z+.15),vec(x+lean,12.2,z-.2)];
    farWood.push(branchGeometry(points,radius,radius*.57,901+layer*47+i*8.7,true,.68+rearRandom()*.2,.32));
  }
  const rearMaterial=woodMaterial.clone();
  rearMaterial.onBeforeCompile=woodMaterial.onBeforeCompile;
  for(const g of farWood)g.setAttribute('moss',new THREE.Float32BufferAttribute(new Float32Array(g.attributes.position.count),1));
  const rearTrees=addSurfaceBatch(scene,farWood,distanceMaterial(rearMaterial,'distant-driftwood-v1'),'Three layers of distant slender trunks');
  rearTrees.castShadow=rearTrees.receiveShadow=false;
  plantFronds(scene, [
    { samples: woodSamples, count: 900, scale: 0.65 },
    { samples: rockSamples, count: 1400, scale: 0.55 },
    { samples: sandSamples, count: 80, scale: 0.6 },
  ]);
  return { obstacles, landmarks, support };
}

// Suspended matter that reveals the water: flecks of detritus carried by the current, and
// oxygen bubbles pearling off the plants. Both are lit only where the key light reaches
// them, so they sparkle in the light and vanish in shade.
export function createParticles(scene, { thickets }) {
  const debris = 780,
    bubbles = 120,
    count = debris + bubbles;
  const positions = new Float32Array(count * 3),
    seeds = new Float32Array(count),
    kinds = new Float32Array(count),
    sizes = new Float32Array(count);
  for (let i = 0; i < count; i++) {
    const bubble = i >= debris;
    if (bubble) {
      const bed = thickets.length ? thickets[i % thickets.length] : null;
      if (bed && i % 3 !== 0)
        positions.set(
          [range(bed.minX, bed.maxX), range(1.5, 6.5), range(bed.minZ, bed.maxZ)],
          i * 3,
        );
      else {
        const x = range(-7, 7),
          z = range(-1.5, 2.6);
        positions.set([x, groundHeight(x, z) + 0.1, z], i * 3);
      }
      sizes[i] = range(0.03, 0.075);
    } else {
      positions.set([range(-9, 9), range(0.4, 9.6), range(-5.4, 3.4)], i * 3);
      // Mostly fine suspended matter, with an occasional larger fragment catching light.
      sizes[i] = 0.005 + 0.038 * random() ** 2.4;
    }
    seeds[i] = random();
    kinds[i] = bubble ? 1 : 0;
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.BufferAttribute(positions, 3));
  geometry.setAttribute("seed", new THREE.BufferAttribute(seeds, 1));
  geometry.setAttribute("kind", new THREE.BufferAttribute(kinds, 1));
  geometry.setAttribute("size", new THREE.BufferAttribute(sizes, 1));
  const uniforms = THREE.UniformsUtils.merge([
    THREE.UniformsLib.lights,
    THREE.UniformsLib.fog,
    { pixelScale: { value: 1000 } },
  ]);
  uniforms.waterTime = waterTime;
  const material = new THREE.ShaderMaterial({
    uniforms,
    lights: true,
    fog: true,
    transparent: true,
    depthWrite: false,
    vertexShader: /* glsl */ `
      #include <common>
      #include <packing>
      #include <fog_pars_vertex>
      uniform float pixelScale;
      attribute float seed;
      attribute float kind;
      attribute float size;
      varying float vKind;
      varying float vFade;
      varying float vLight;
      varying vec2 vGlint;
      ${currentGLSL}
      ${surfaceLightGLSL}
      #if NUM_DIR_LIGHT_SHADOWS > 0
        uniform mat4 directionalShadowMatrix[NUM_DIR_LIGHT_SHADOWS];
        uniform sampler2D directionalShadowMap[NUM_DIR_LIGHT_SHADOWS];
      #endif
      void main() {
        float t = waterTime;
        vec3 p = position;
        vKind = kind;
        float tumble = 1.0;
        if (kind > 0.5) {
          // Buoyancy carries a bubble up at a speed set by its size; it wobbles as it rises
          // and is released again at its origin once it reaches the surface.
          float speed = 1.2 + size * 30.0;
          float travel = ${SURFACE_Y.toFixed(1)} - position.y;
          float period = travel / speed + 2.0 + seed * 9.0;
          float age = mod(t + seed * period, period);
          float risen = age * speed;
          p.y += min(risen, travel);
          p.x += sin(age * 6.0 + seed * 20.0) * 0.035;
          p.z += cos(age * 5.1 + seed * 17.0) * 0.03;
          vFade = smoothstep(0.0, 0.15, age) * (1.0 - step(travel, risen));
        } else {
          // Neutrally buoyant flecks ride the current, sinking a little, tumbling as they go.
          p += FLOW_DIRECTION * currentTravel(position, t) * ${CURRENT_SPEED.toFixed(3)} * (0.75 + seed * 0.5);
          p.x = mod(p.x + 9.5, 19.0) - 9.5;
          p.z = mod(p.z + 5.6, 9.2) - 5.6;
          p.y = mod(position.y - t * (0.012 + seed * 0.02) - 0.3, 9.4) + 0.3;
          tumble = 0.35 + 0.65 * abs(sin(t * (1.1 + seed * 2.5) + seed * 40.0));
          vFade = smoothstep(9.5, 8.6, abs(p.x)) * smoothstep(0.3, 0.9, p.y) * (0.45 + 0.55 * fract(seed * 7.31));
        }
        float lit = 1.0;
        #if NUM_DIR_LIGHT_SHADOWS > 0
          vec4 shadowCoord = directionalShadowMatrix[0] * vec4(p, 1.0);
          shadowCoord.xyz /= shadowCoord.w;
          if (all(greaterThan(shadowCoord.xy, vec2(0.0))) && all(lessThan(shadowCoord.xy, vec2(1.0)))) {
            float occluder = unpackRGBAToDepth(texture2D(directionalShadowMap[0], shadowCoord.xy));
            lit = shadowCoord.z - 0.0015 <= occluder ? 1.0 : 0.0;
          }
        #endif
        vec3 water = waterLight(p, t) * waterLightDrift(p, t);
        vLight = (0.08 + 0.92 * lit) * water.g * tumble;
        vGlint = vec2(-0.16, 0.2);
        vec4 mvPosition = modelViewMatrix * vec4(p, 1.0);
        gl_Position = projectionMatrix * mvPosition;
        gl_PointSize = max(1.3, size * pixelScale / -mvPosition.z);
        #include <fog_vertex>
      }`,
    fragmentShader: /* glsl */ `
      #include <common>
      #include <fog_pars_fragment>
      varying float vKind;
      varying float vFade;
      varying float vLight;
      varying vec2 vGlint;
      void main() {
        vec2 c = gl_PointCoord - 0.5;
        float r = length(c) * 2.0;
        if (r > 1.0 || vFade <= 0.0) discard;
        vec3 color;
        float alpha;
        if (vKind > 0.5) {
          // An air sphere: light refracts around a dark rim, and a bright glint faces the lamp.
          float rim = smoothstep(0.5, 1.0, r);
          float glint = exp(-dot(c - vGlint, c - vGlint) * 55.0);
          color = mix(vec3(0.22, 0.27, 0.22), vec3(0.02, 0.03, 0.02), rim) * (0.4 + 0.6 * vLight) + glint * 3.2 * vLight;
          alpha = (0.3 + 0.6 * rim) * vFade;
        } else {
          // A matte fleck: bright in the beam, invisible in shade; some are darker plant
          // fragments, some pale mulm.
          color = vec3(0.62, 0.64, 0.5) * vLight * (1.2 + 2.4 * vFade);
          alpha = (1.0 - smoothstep(0.15, 1.0, r)) * vFade * 0.72;
        }
        gl_FragColor = vec4(color, alpha);
        #include <fog_fragment>
      }`,
  });
  const particles = new THREE.Points(geometry, material);
  particles.frustumCulled = false;
  scene.add(particles);
  return {
    // pixelScale converts a world-space size at unit distance into rendered pixels.
    update(pixelScale) {
      uniforms.pixelScale.value = pixelScale;
    },
  };
}
