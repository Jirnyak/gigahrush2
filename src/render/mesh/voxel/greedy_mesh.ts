import {
  VOXEL_DEFAULT_TRIANGLE_CAP,
  VoxelMaterial,
  emptyVoxelMesh,
  voxelAt,
  type VoxelField,
  type VoxelMeshBuildOptions,
  type VoxelMeshData,
} from './types';

const MATERIAL_COLORS: Readonly<Record<VoxelMaterial, readonly [number, number, number, number]>> = {
  [VoxelMaterial.EMPTY]: [0, 0, 0, 0],
  [VoxelMaterial.CONCRETE]: [112, 111, 101, 255],
  [VoxelMaterial.METAL]: [91, 92, 88, 255],
  [VoxelMaterial.ORGANIC]: [117, 38, 32, 255],
  [VoxelMaterial.RUBBLE]: [93, 88, 76, 255],
  [VoxelMaterial.PIPE]: [72, 79, 75, 255],
  [VoxelMaterial.CEILING]: [84, 83, 76, 255],
};

interface MeshAccumulator {
  vertices: number[];
  normals: number[];
  colors: number[];
  indices: number[];
  triangleCap: number;
  triangleCount: number;
  truncated: boolean;
}

function makeAccumulator(options: VoxelMeshBuildOptions | undefined): MeshAccumulator {
  const rawCap = options?.triangleCap ?? VOXEL_DEFAULT_TRIANGLE_CAP;
  return {
    vertices: [],
    normals: [],
    colors: [],
    indices: [],
    triangleCap: Number.isFinite(rawCap) && rawCap > 0 ? Math.min(VOXEL_DEFAULT_TRIANGLE_CAP, Math.floor(rawCap)) : 0,
    triangleCount: 0,
    truncated: false,
  };
}

function toMesh(acc: MeshAccumulator): VoxelMeshData {
  if (acc.triangleCount <= 0) return emptyVoxelMesh(acc.truncated ? 'triangle_cap' : 'empty_voxel_mesh');
  return {
    vertices: new Float32Array(acc.vertices),
    normals: new Float32Array(acc.normals),
    colors: new Uint8Array(acc.colors),
    indices: new Uint32Array(acc.indices),
    triangleCount: acc.triangleCount,
    truncated: acc.truncated,
    skippedReason: acc.truncated ? 'triangle_cap' : '',
  };
}

function pushQuad(
  acc: MeshAccumulator,
  a: readonly [number, number, number],
  b: readonly [number, number, number],
  c: readonly [number, number, number],
  d: readonly [number, number, number],
  normal: readonly [number, number, number],
  material: VoxelMaterial,
): boolean {
  if (acc.triangleCount + 2 > acc.triangleCap) {
    acc.truncated = true;
    return false;
  }
  const base = acc.vertices.length / 3;
  acc.vertices.push(...a, ...b, ...c, ...d);
  for (let i = 0; i < 4; i++) acc.normals.push(...normal);
  const color = MATERIAL_COLORS[material] ?? MATERIAL_COLORS[VoxelMaterial.CONCRETE];
  for (let i = 0; i < 4; i++) acc.colors.push(...color);
  acc.indices.push(base, base + 1, base + 2, base, base + 2, base + 3);
  acc.triangleCount += 2;
  return true;
}

export function buildExposedVoxelMesh(field: VoxelField, options?: VoxelMeshBuildOptions): VoxelMeshData {
  if (field.solidCount <= 0 || field.width <= 0 || field.height <= 0 || field.depth <= 0) return emptyVoxelMesh('empty_voxel_field');
  const acc = makeAccumulator(options);
  const dirs = [
    [1, 0, 0],
    [-1, 0, 0],
    [0, 1, 0],
    [0, -1, 0],
    [0, 0, 1],
    [0, 0, -1],
  ] as const;

  for (let z = 0; z < field.depth; z++) {
    for (let y = 0; y < field.height; y++) {
      for (let x = 0; x < field.width; x++) {
        const material = voxelAt(field, x, y, z) as VoxelMaterial;
        if (material === VoxelMaterial.EMPTY) continue;
        for (const dir of dirs) {
          if (voxelAt(field, x + dir[0], y + dir[1], z + dir[2]) !== VoxelMaterial.EMPTY) continue;
          if (!pushUnitFace(acc, x, y, z, dir, material)) return toMesh(acc);
        }
      }
    }
  }

  return toMesh(acc);
}

function pushUnitFace(
  acc: MeshAccumulator,
  x: number,
  y: number,
  z: number,
  normal: readonly [number, number, number],
  material: VoxelMaterial,
): boolean {
  const x0 = x;
  const x1 = x + 1;
  const y0 = y;
  const y1 = y + 1;
  const z0 = z;
  const z1 = z + 1;
  if (normal[0] > 0) return pushQuad(acc, [x1, y0, z0], [x1, y1, z0], [x1, y1, z1], [x1, y0, z1], normal, material);
  if (normal[0] < 0) return pushQuad(acc, [x0, y0, z0], [x0, y0, z1], [x0, y1, z1], [x0, y1, z0], normal, material);
  if (normal[1] > 0) return pushQuad(acc, [x0, y1, z0], [x0, y1, z1], [x1, y1, z1], [x1, y1, z0], normal, material);
  if (normal[1] < 0) return pushQuad(acc, [x0, y0, z0], [x1, y0, z0], [x1, y0, z1], [x0, y0, z1], normal, material);
  if (normal[2] > 0) return pushQuad(acc, [x0, y0, z1], [x1, y0, z1], [x1, y1, z1], [x0, y1, z1], normal, material);
  return pushQuad(acc, [x0, y0, z0], [x0, y1, z0], [x1, y1, z0], [x1, y0, z0], normal, material);
}

export function buildGreedyVoxelMesh(field: VoxelField, options?: VoxelMeshBuildOptions): VoxelMeshData {
  if (field.solidCount <= 0 || field.width <= 0 || field.height <= 0 || field.depth <= 0) return emptyVoxelMesh('empty_voxel_field');
  const acc = makeAccumulator(options);
  const dims = [field.width, field.height, field.depth] as const;

  for (let d = 0; d < 3; d++) {
    const u = (d + 1) % 3;
    const v = (d + 2) % 3;
    const mask = new Int16Array(dims[u] * dims[v]);

    for (let q = -1; q < dims[d]; q++) {
      let n = 0;
      for (let j = 0; j < dims[v]; j++) {
        for (let i = 0; i < dims[u]; i++) {
          const aCoord = [0, 0, 0];
          const bCoord = [0, 0, 0];
          aCoord[d] = q;
          bCoord[d] = q + 1;
          aCoord[u] = i;
          bCoord[u] = i;
          aCoord[v] = j;
          bCoord[v] = j;
          const a = q >= 0 ? voxelAt(field, aCoord[0], aCoord[1], aCoord[2]) : VoxelMaterial.EMPTY;
          const b = q + 1 < dims[d] ? voxelAt(field, bCoord[0], bCoord[1], bCoord[2]) : VoxelMaterial.EMPTY;
          mask[n++] = a !== VoxelMaterial.EMPTY && b === VoxelMaterial.EMPTY
            ? a
            : a === VoxelMaterial.EMPTY && b !== VoxelMaterial.EMPTY
              ? -b
              : 0;
        }
      }

      n = 0;
      for (let j = 0; j < dims[v]; j++) {
        for (let i = 0; i < dims[u];) {
          const signedMaterial = mask[n];
          if (signedMaterial === 0) {
            i++;
            n++;
            continue;
          }

          let rectW = 1;
          while (i + rectW < dims[u] && mask[n + rectW] === signedMaterial) rectW++;

          let rectH = 1;
          heightScan:
          while (j + rectH < dims[v]) {
            for (let k = 0; k < rectW; k++) {
              if (mask[n + k + rectH * dims[u]] !== signedMaterial) break heightScan;
            }
            rectH++;
          }

          const ok = pushGreedyFace(acc, d, u, v, q + 1, i, j, rectW, rectH, signedMaterial);
          for (let yy = 0; yy < rectH; yy++) {
            for (let xx = 0; xx < rectW; xx++) mask[n + xx + yy * dims[u]] = 0;
          }
          if (!ok) return toMesh(acc);
          i += rectW;
          n += rectW;
        }
      }
    }
  }

  return toMesh(acc);
}

function pushGreedyFace(
  acc: MeshAccumulator,
  d: number,
  u: number,
  v: number,
  plane: number,
  i: number,
  j: number,
  rectW: number,
  rectH: number,
  signedMaterial: number,
): boolean {
  const material = Math.abs(signedMaterial) as VoxelMaterial;
  const normal = [0, 0, 0] as [number, number, number];
  normal[d] = signedMaterial > 0 ? 1 : -1;

  const p = [0, 0, 0] as [number, number, number];
  const du = [0, 0, 0] as [number, number, number];
  const dv = [0, 0, 0] as [number, number, number];
  p[d] = plane;
  p[u] = i;
  p[v] = j;
  du[u] = rectW;
  dv[v] = rectH;

  const a = p;
  const b = [p[0] + du[0], p[1] + du[1], p[2] + du[2]] as [number, number, number];
  const c = [p[0] + du[0] + dv[0], p[1] + du[1] + dv[1], p[2] + du[2] + dv[2]] as [number, number, number];
  const e = [p[0] + dv[0], p[1] + dv[1], p[2] + dv[2]] as [number, number, number];
  return signedMaterial > 0
    ? pushQuad(acc, a, b, c, e, normal, material)
    : pushQuad(acc, a, e, c, b, normal, material);
}

export function countExposedVoxelTriangles(field: VoxelField, triangleCap = Number.POSITIVE_INFINITY): number {
  let triangles = 0;
  const dirs = [
    [1, 0, 0],
    [-1, 0, 0],
    [0, 1, 0],
    [0, -1, 0],
    [0, 0, 1],
    [0, 0, -1],
  ] as const;
  for (let z = 0; z < field.depth; z++) {
    for (let y = 0; y < field.height; y++) {
      for (let x = 0; x < field.width; x++) {
        if (voxelAt(field, x, y, z) === VoxelMaterial.EMPTY) continue;
        for (const [dx, dy, dz] of dirs) {
          if (voxelAt(field, x + dx, y + dy, z + dz) === VoxelMaterial.EMPTY) {
            triangles += 2;
            if (triangles >= triangleCap) return Math.floor(triangleCap);
          }
        }
      }
    }
  }
  return triangles;
}
