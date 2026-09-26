// Forest aquascape, in tank coordinates. The path, hardscape and planting share this
// layout so the opening stays clear as it winds between the trunks.
export const pathCenter = (z) => 0.2 + 0.85 * Math.sin((z + 3.5) * 0.86);
export const pathWidth = (z) => Math.max(0.32, Math.min(1.15, 0.28 + (z + 6) * 0.075));

// Seven substantial trunks leave broad openings through the forest. Their tops extend
// beyond the camera's upper edge, so each trunk spans the full height of the view.
// `top` is an absolute height; small variations in lean and girth keep the wood irregular.
export const TRUNKS = [
  { x: -7.2, z: 1.2, radius: 0.92, top: 12.1, lean: 0.22, bend: -0.12 },
  { x: -3.9, z: 0.35, radius: 0.82, top: 12.4, lean: -0.18, bend: 0.14 },
  { x: 7.1, z: 1.2, radius: 1.03, top: 12.3, lean: -0.24, bend: 0.09 },
  { x: 4.05, z: 0.35, radius: 0.86, top: 12.6, lean: -0.12, bend: -0.18 },
  { x: -5.55, z: -3.7, radius: 0.60, top: 13.0, lean: 0.17, bend: 0.11 },
  { x: -1.35, z: -2.7, radius: 0.65, top: 12.7, lean: 0.16, bend: -0.08 },
  { x: 2.6, z: -4.05, radius: 0.63, top: 13.2, lean: -0.14, bend: 0.12 },
];

// Low, irregular stones retain the planted banks. Alternating offsets and sizes keep
// the sand edge broken, with progressively smaller stones toward the distant opening.
export const ROCKS = [];
for (let row = 0; row < 10; row++) {
  for (const side of [-1, 1]) {
    const z = 3.55 - row * 0.88 + side * (0.13 + 0.11 * Math.sin(row * 2.4));
    const size = 0.37 + 0.23 * (1 - row / 10) + 0.13 * Math.sin(row * 3.1 + side) ** 2;
    ROCKS.push({
      x: pathCenter(z) + side * (pathWidth(z) * 1.24 + size * 0.64), z,
      rx: size, ry: size * (0.61 + 0.14 * Math.cos(row * 1.7 + side)),
      rz: size * (0.77 + 0.20 * Math.sin(row + side) ** 2), lean: side * 0.13,
    });
  }
}
ROCKS.push(
  { x: -6.8, z: 2.1, rx: 0.87, ry: 0.55, rz: 0.73, lean: -0.14 },
  { x: -3.5, z: 2.6, rx: 0.80, ry: 0.51, rz: 0.66, lean: 0.17 },
  { x: 5.7, z: 2.2, rx: 0.98, ry: 0.62, rz: 0.81, lean: 0.09 },
  { x: 8.7, z: -0.1, rx: 0.79, ry: 0.57, rz: 0.72, lean: -0.10 },
  { x: -8.7, z: -0.7, rx: 0.70, ry: 0.51, rz: 0.62, lean: 0.10 },
);

export function inHardscape(x, z, margin = 0) {
  return TRUNKS.some(t => Math.hypot(x - t.x, z - t.z) < t.radius * 1.1 + margin) ||
    ROCKS.some(r => ((x - r.x) / (r.rx + margin)) ** 2 +
      ((z - r.z) / (r.rz + margin)) ** 2 < 1);
}
