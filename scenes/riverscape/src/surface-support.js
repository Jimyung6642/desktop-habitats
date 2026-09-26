// Index the actual world-space rock triangles once. Queries are exact vertical
// intersections in one small spatial bin, not raycasts through the entire scene.
// This avoids floating feet caused by fitting an ideal ellipsoid to rough rock.
export function createSurfaceSupport(geometries, floorHeight, cellSize = 0.24) {
  const cells = new Map();
  let triangleCount = 0;
  const key = (x, z) => `${x},${z}`;
  for (const geometry of geometries) {
    const p = geometry.attributes.position, indices = geometry.index;
    const count = indices ? indices.count : p.count;
    for (let i = 0; i < count; i += 3) {
      const a = indices ? indices.getX(i) : i;
      const b = indices ? indices.getX(i + 1) : i + 1;
      const c = indices ? indices.getX(i + 2) : i + 2;
      const x = p.getX(a), z = p.getZ(a), y = p.getY(a);
      const ux = p.getX(b) - x, uz = p.getZ(b) - z;
      const vx = p.getX(c) - x, vz = p.getZ(c) - z;
      const determinant = ux * vz - uz * vx;
      if (Math.abs(determinant) < 1e-10) continue;
      const face = [x, z, y, ux, uz, vx, vz, 1 / determinant,
        p.getY(b) - y, p.getY(c) - y];
      const minX = Math.floor(Math.min(x, x + ux, x + vx) / cellSize);
      const maxX = Math.floor(Math.max(x, x + ux, x + vx) / cellSize);
      const minZ = Math.floor(Math.min(z, z + uz, z + vz) / cellSize);
      const maxZ = Math.floor(Math.max(z, z + uz, z + vz) / cellSize);
      for (let bx = minX; bx <= maxX; bx++) for (let bz = minZ; bz <= maxZ; bz++) {
        const id = key(bx, bz);
        if (!cells.has(id)) cells.set(id, []);
        cells.get(id).push(face);
      }
      triangleCount++;
    }
  }
  return {
    triangleCount,
    heightAt(x, z) {
      let top = floorHeight(x, z);
      const faces = cells.get(key(Math.floor(x / cellSize), Math.floor(z / cellSize)));
      if (faces) for (const f of faces) {
        const dx = x - f[0], dz = z - f[1];
        const u = (dx * f[6] - dz * f[5]) * f[7];
        const v = (f[3] * dz - f[4] * dx) * f[7];
        if (u >= -1e-7 && v >= -1e-7 && u + v <= 1.0000001)
          top = Math.max(top, f[2] + u * f[8] + v * f[9]);
      }
      return top;
    },
  };
}
