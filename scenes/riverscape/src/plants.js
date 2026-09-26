import * as THREE from "three";
import {
  GeometryBatch,
  groundHeight,
  range,
  random,
  randomGenerator,
  channel,
  vec,
} from "./math.js";
import { FLOW_DIRECTION } from "./water.js";
import { TAU, blade, foliageDepth, foliageMaterial } from "./foliage.js";
import { plantStems } from "./stemplants.js";
import { inHardscape } from "./layout.js";

const FLOW_ANGLE = Math.atan2(FLOW_DIRECTION.z, FLOW_DIRECTION.x);

// Rivergrass: a rosette of long, very thin ribbon leaves. Older outer leaves are longer,
// paler and lean further; most leaves grow out along the current that has shaped them,
// and the oldest tips have begun to brown.
function ribbonRosette(batch, x, z, height, count, background = null) {
  const root = vec(x, groundHeight(x, z) - 0.025, z);
  for (let i = 0; i < count; i++) {
    const age = random();
    const theta =
      random() < 0.72 ? FLOW_ANGLE + range(-0.95, 0.95) : range(0, TAU);
    const h = height * (0.5 + 0.65 * age) * range(0.92, 1.08);
    const sweep = range(0.7, 3.0) * (0.6 + 0.6 * age);
    const direction = vec(Math.cos(theta), 0, Math.sin(theta));
    const base = root.clone().addScaledVector(direction, range(0, 0.08));
    const points = [
      base,
      base.clone().add(vec(direction.x * 0.08, h * 0.7, direction.z * 0.08)),
      base
        .clone()
        .add(
          vec(direction.x * sweep * 0.3, h * 1.2, direction.z * sweep * 0.3),
        ),
      base
        .clone()
        .add(vec(direction.x * sweep, h * range(0.87, 1), direction.z * sweep)),
    ];
    const color = new THREE.Color().setHSL(
      0.235 + 0.055 * (1 - age) + range(-0.012, 0.012),
      range(0.68, 0.84),
      0.15 + 0.12 * age,
    );
    blade(batch, points, range(0.044, 0.115), color, root, range(0.85, 1.15), {
      rows: background ? background.rows : 30,
      cols: background ? background.cols : 6,
      emit: background ? background.keep() : true,
      twist: theta + Math.PI / 2,
      ribbon: true,
      thin: 1,
      browning: age > 0.82 ? range(0.08, 0.2) : 0,
    });
  }
}

// A dead leaf on the sand: a blade that let go, browned and curling, and drifted until it
// caught on a bank. `heading` is the way the midrib points.
function fallenLeaf(batch, x, z, length, heading) {
  const direction = vec(Math.cos(heading), 0, Math.sin(heading));
  const root = vec(x, groundHeight(x, z) + 0.012, z);
  const points = [
    root,
    root.clone().addScaledVector(direction, length * 0.5).add(vec(0, 0.035, 0)),
    root.clone().addScaledVector(direction, length).add(vec(0, 0.07, 0)),
  ];
  const color = new THREE.Color().setHSL(
    range(0.08, 0.12),
    range(0.35, 0.5),
    range(0.2, 0.3),
  );
  blade(batch, points, 0.11, color, root, 0.04, {
    rows: 14,
    cols: 6,
    twist: heading + Math.PI / 2,
    thin: 0.2,
    browning: 0.7,
  });
}

// Sheltered stem-plant volumes behind the trunks, also used by the fish and current.
export const THICKETS = [
  { minX: -9.2, maxX: -3.2, minZ: -5.7, maxZ: -2.0, minY: 1.2, maxY: 6.5 },
  { minX: 4.4, maxX: 9.0, minZ: -5.7, maxZ: -2.0, minY: 1.2, maxY: 6.5 },
];
// Overlapping rear beds fill the spaces between the trunks. Shorter planting behind
// the channel preserves its opening, while taller side beds create a layered backdrop.
const BEDS = [
  { minX: -11.1, maxX: -7.6, minZ: -6.7, maxZ: -4.8, clumps: 5, height: 1.05 },
  { minX: -7.4, maxX: -2.0, minZ: -6.8, maxZ: -4.7, clumps: 8, height: 1.10 },
  { minX: 1.7, maxX: 6.6, minZ: -6.8, maxZ: -4.7, clumps: 8, height: 1.08 },
  { minX: 6.5, maxX: 10.9, minZ: -6.6, maxZ: -4.4, clumps: 6, height: 1.10 },
  { minX: -1.8, maxX: 1.8, minZ: -6.8, maxZ: -5.9, clumps: 6, height: 0.72 },
];
const grassHeight = (x) => 4.2 + 0.8 * Math.sin(x * 1.5) ** 2;

const CUSHIONS = [
  [-6.7, -0.1, 1.5, 0.78], [-4.6, -2.7, 1.5, 1.30], [-3.1, 0.0, 1.1, 0.66],
  [-8.3, -3.5, 1.6, 1.2], [-2.2, -3.2, 1.0, 0.64],
  [3.1, -2.6, 1.3, 1.05], [5.4, -0.1, 1.7, 1.10], [8.1, -2.9, 1.8, 1.40],
  [-5.5, 2.2, 1.1, 0.20], [4.4, 2.0, 1.3, 0.27],
];
function carpetHeight(x, z) {
  let cushion = 0;
  for (const [cx, cz, radius, height] of CUSHIONS)
    cushion = Math.max(cushion, height * Math.exp(-1.8 * ((x - cx) ** 2 + (z - cz) ** 2) / radius ** 2));
  return groundHeight(x, z) + 0.06 + cushion * (1 - channel(x, z));
}

// Small cupped, rounded leaves make the Monte Carlo-like carpet. An eight-segment fan
// retains its silhouette at 4K without the much denser mesh used for long ribbon leaves.
function carpetLeaf(batch, center, length, angle, rise, color, root) {
  const along = vec(Math.cos(angle), rise, Math.sin(angle)).normalize();
  const across = vec(-Math.sin(angle), 0, Math.cos(angle));
  const normal = new THREE.Vector3().crossVectors(along, across).normalize().negate();
  const strand = { direction: normal, tangent: along, distance: length, compliance: 0.18 };
  const middle = batch.vertex(center.clone().addScaledVector(normal, length * 0.06),
    [0.5, 0.5], color, root, strand, 0.45);
  const edgeColor = color.clone().multiplyScalar(0.86);
  for (let k = 0; k < 8; k++) {
    const a = k / 8 * TAU;
    const u = Math.cos(a), v = Math.sin(a);
    const p = center.clone().addScaledVector(across, u * length * 0.37)
      .addScaledVector(along, v * length * 0.5);
    batch.vertex(p, [0.5 + u * 0.5, 0.5 + v * 0.5], edgeColor, root, strand, 0.45);
    batch.indices.push(middle, middle + 1 + k, middle + 1 + (k + 1) % 8);
  }
}

function plantCarpet(batch) {
  const sample = randomGenerator(78123);
  const between = (a, b) => a + (b - a) * sample();
  // Jittered runners overlap, but skip the exposed sand and buried hardscape. The
  // separate random stream keeps the foreground stable across quality settings.
  for (let x0 = -12.4; x0 < 12.4; x0 += 0.16) {
    for (let z0 = -7.2; z0 < 5.5; z0 += 0.155) {
      const x = x0 + between(-0.08, 0.08), z = z0 + between(-0.077, 0.077);
      if (channel(x, z) > between(0.23, 0.42) || inHardscape(x, z, -0.04)) continue;
      const y = carpetHeight(x, z), root = vec(x, groundHeight(x, z), z);
      const shade = between(0.04, 0.085) * (0.87 + 0.13 * Math.sin(x * 2.8 + z));
      const hue = between(0.255, 0.305);
      const leaves = 5 + Math.floor(sample() * 3);
      for (let leaf = 0; leaf < leaves; leaf++) {
        const angle = leaf / leaves * TAU + between(-0.5, 0.5);
        const distance = between(0.025, 0.12), length = between(0.12, 0.19);
        const center = vec(x + Math.cos(angle) * distance, y + between(0.05, 0.18),
          z + Math.sin(angle) * distance);
        const color = new THREE.Color().setHSL(hue, between(0.60, 0.82), shade * between(0.8, 1.2));
        carpetLeaf(batch, center, length, angle, between(-0.1, 0.85), color, root);
      }
    }
  }
}

export function createPlants(scene, {
  backgroundDensity = 0.7, backgroundRows = 20, backgroundCols = 2, animatedShadows = true,
} = {}) {
  const batch = new GeometryBatch();
  const density = Number.isFinite(backgroundDensity) ? Math.max(0, Math.min(1, backgroundDensity)) : 0.7;
  const stats = { backgroundCandidates: 0, backgroundKept: 0 };
  const background = {
    rows: Math.max(4, Math.round(backgroundRows)),
    cols: Math.max(2, Math.round(backgroundCols)),
    keep() {
      const i = stats.backgroundCandidates++;
      // Distributed, deterministic thinning, not clump removal. No extra random draws:
      // the retained leaves, rocks, foreground plants and fish keep their old seeds.
      const keep = Math.floor((i + 1) * density + 1e-9) > Math.floor(i * density + 1e-9);
      if (keep) stats.backgroundKept++;
      return keep;
    },
  };
  for (const bed of BEDS) {
    const scale = bed.height ?? 1;
    for (let c = 0; c < bed.clumps; c++) {
      // Distribute crowns across each bed, with irregular offsets within each strip.
      // Purely random placement can leave a large bare gap between two trunks.
      const cx = bed.minX + (c + range(0.15, 0.85)) / bed.clumps * (bed.maxX - bed.minX),
        cz = range(bed.minZ, bed.maxZ),
        spread = range(0.5, 1.1);
      const rosettes = Math.floor(range(4, 7));
      for (let i = 0; i < rosettes; i++) {
        const a = range(0, TAU),
          d = spread * Math.sqrt(random());
        const x = cx + Math.cos(a) * d,
          z = Math.max(-6.9, cz + Math.sin(a) * d * 0.7);
        if (channel(x, z) > 0.24 || inHardscape(x, z, 0.12)) continue;
        ribbonRosette(
          batch,
          x,
          z,
          grassHeight(x) * scale * range(0.85, 1.1),
          Math.floor(range(10, 16)),
          background,
        );
      }
    }
    // Runners have set a few young plants out on their own between the clumps.
    for (let i = 0; i < 4; i++) {
      const x = range(bed.minX, bed.maxX), z = range(bed.minZ, bed.maxZ);
      if (channel(x, z) > 0.24 || inHardscape(x, z, 0.12)) continue;
      ribbonRosette(
        batch,
        x,
        z,
        grassHeight(x) * scale * range(0.55, 0.8),
        Math.floor(range(5, 8)),
        background,
      );
    }
  }
  stats.backgroundVertices = batch.positions.length / 3;
  stats.backgroundTriangles = batch.indices.length / 3;
  plantStems(batch);
  plantCarpet(batch);
  for (const [x, z, length, heading] of [
    [-1.6, 2.8, 0.32, 0.4], [1.9, -0.9, 0.25, 2.6], [-3.2, 1.7, 0.28, 1.2],
  ]) fallenLeaf(batch, x, z, length, heading);
  const mesh = new THREE.Mesh(batch.geometry(), foliageMaterial());
  mesh.name = 'Aquatic planting';
  mesh.customDepthMaterial = foliageDepth({ animated: animatedShadows });
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  scene.add(mesh);
  stats.vertices = mesh.geometry.attributes.position.count;
  stats.triangles = mesh.geometry.index.count / 3;
  return { mesh, thickets: THICKETS, stats };
}
