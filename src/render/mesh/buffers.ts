import { maybeVisualModelDef, type VisualModelId } from '../../data/visual_models';
import { getMeshTemplate } from './model_cache';
import type { MeshTemplate } from './primitives';
import type { VoxelChunkMesh } from './voxel/types';

export const MESH_VERTEX_STRIDE = 9;

export type MeshModelKind =
  | 'column_concrete_square'
  | 'table_slab'
  | 'chair_simple'
  | 'bed_frame'
  | 'shelf_block'
  | 'machine_box'
  | 'lamp_stand'
  | 'candle_stub'
  | 'debug_column';

export interface MeshInstance {
  kind: MeshModelKind | string;
  x: number;
  y: number;
  z: number;
  yaw: number;
  scaleX: number;
  scaleY: number;
  scaleZ: number;
  color: readonly [number, number, number];
  seed: number;
}

export interface MeshBuildResult {
  vertices: Float32Array;
  vertexCount: number;
  triangleCount: number;
  submittedInstances: number;
  submittedChunks: number;
  skippedInstances: number;
  truncated: boolean;
}

interface BuildCursor {
  data: Float32Array;
  offset: number;
  triangleCount: number;
  maxTriangles: number;
  truncated: boolean;
}

const FACE_TRIANGLES = 2;
const BOX_TRIANGLES = 6 * FACE_TRIANGLES;

const BOX_FACES = [
  { n: [1, 0, 0], c: [[0.5, -0.5, -0.5], [0.5, 0.5, -0.5], [0.5, 0.5, 0.5], [0.5, -0.5, 0.5]] },
  { n: [-1, 0, 0], c: [[-0.5, 0.5, -0.5], [-0.5, -0.5, -0.5], [-0.5, -0.5, 0.5], [-0.5, 0.5, 0.5]] },
  { n: [0, 1, 0], c: [[-0.5, 0.5, -0.5], [0.5, 0.5, -0.5], [0.5, 0.5, 0.5], [-0.5, 0.5, 0.5]] },
  { n: [0, -1, 0], c: [[0.5, -0.5, -0.5], [-0.5, -0.5, -0.5], [-0.5, -0.5, 0.5], [0.5, -0.5, 0.5]] },
  { n: [0, 0, 1], c: [[-0.5, -0.5, 0.5], [0.5, -0.5, 0.5], [0.5, 0.5, 0.5], [-0.5, 0.5, 0.5]] },
  { n: [0, 0, -1], c: [[-0.5, 0.5, -0.5], [0.5, 0.5, -0.5], [0.5, -0.5, -0.5], [-0.5, -0.5, -0.5]] },
] as const;

function color01(value: number): number {
  return Math.max(0, Math.min(1, value / 255));
}

function ensureCapacity(instances: readonly MeshInstance[], maxTriangles: number, out?: Float32Array): Float32Array {
  const maxVertices = Math.max(0, maxTriangles * 3);
  const needed = maxVertices * MESH_VERTEX_STRIDE;
  if (out && out.length >= needed) return out;
  const estimate = Math.max(needed, instances.length * 96 * MESH_VERTEX_STRIDE);
  return new Float32Array(estimate);
}

function reserve(cursor: BuildCursor, triangles: number): boolean {
  if (cursor.triangleCount + triangles > cursor.maxTriangles) {
    cursor.truncated = true;
    return false;
  }
  return true;
}

function pushVertex(
  cursor: BuildCursor,
  x: number,
  y: number,
  z: number,
  nx: number,
  ny: number,
  nz: number,
  color: readonly [number, number, number],
): void {
  const i = cursor.offset;
  cursor.data[i] = x;
  cursor.data[i + 1] = y;
  cursor.data[i + 2] = z;
  cursor.data[i + 3] = nx;
  cursor.data[i + 4] = ny;
  cursor.data[i + 5] = nz;
  cursor.data[i + 6] = color01(color[0]);
  cursor.data[i + 7] = color01(color[1]);
  cursor.data[i + 8] = color01(color[2]);
  cursor.offset = i + MESH_VERTEX_STRIDE;
}

function appendBox(
  cursor: BuildCursor,
  cx: number,
  cy: number,
  cz: number,
  sx: number,
  sy: number,
  sz: number,
  yaw: number,
  color: readonly [number, number, number],
): boolean {
  if (!reserve(cursor, BOX_TRIANGLES)) return false;
  const cos = Math.cos(yaw);
  const sin = Math.sin(yaw);
  const indices = [0, 1, 2, 0, 2, 3] as const;

  for (const face of BOX_FACES) {
    const nx = face.n[0] * cos - face.n[1] * sin;
    const ny = face.n[0] * sin + face.n[1] * cos;
    const nz = face.n[2];
    for (const index of indices) {
      const corner = face.c[index];
      const lx = corner[0] * sx;
      const ly = corner[1] * sy;
      const wx = cx + lx * cos - ly * sin;
      const wy = cy + lx * sin + ly * cos;
      pushVertex(cursor, wx, wy, cz + corner[2] * sz, nx, ny, nz, color);
    }
  }
  cursor.triangleCount += BOX_TRIANGLES;
  return true;
}

function appendTemplateInstance(cursor: BuildCursor, instance: MeshInstance, template: MeshTemplate): boolean {
  if (!reserve(cursor, template.triangleCount)) return false;
  const cos = Math.cos(instance.yaw);
  const sin = Math.sin(instance.yaw);
  const vertices = template.vertices;
  const normals = template.normals;
  const colors = template.colors;

  for (let i = 0; i < template.indices.length; i++) {
    const index = template.indices[i];
    const vi = index * 3;
    const lx = vertices[vi] * instance.scaleX;
    const ly = vertices[vi + 1] * instance.scaleY;
    const lz = vertices[vi + 2] * instance.scaleZ;
    const nx = normals[vi];
    const ny = normals[vi + 1];
    const nz = normals[vi + 2];
    const ci = index * 4;
    pushVertex(
      cursor,
      instance.x + lx * cos - ly * sin,
      instance.y + lx * sin + ly * cos,
      instance.z + lz,
      nx * cos - ny * sin,
      nx * sin + ny * cos,
      nz,
      [colors[ci], colors[ci + 1], colors[ci + 2]],
    );
  }
  cursor.triangleCount += template.triangleCount;
  return true;
}

function tint(color: readonly [number, number, number], factor: number): readonly [number, number, number] {
  return [
    Math.max(0, Math.min(255, Math.round(color[0] * factor))),
    Math.max(0, Math.min(255, Math.round(color[1] * factor))),
    Math.max(0, Math.min(255, Math.round(color[2] * factor))),
  ];
}

function appendInstance(cursor: BuildCursor, instance: MeshInstance): boolean {
  if (maybeVisualModelDef(instance.kind)) {
    return appendTemplateInstance(cursor, instance, getMeshTemplate(instance.kind as VisualModelId, instance.seed));
  }

  const x = instance.x;
  const y = instance.y;
  const z = instance.z;
  const yaw = instance.yaw;
  const sx = instance.scaleX;
  const sy = instance.scaleY;
  const sz = instance.scaleZ;
  const c = instance.color;
  const cDark = tint(c, 0.76);
  const cLight = tint(c, 1.12);

  switch (instance.kind) {
    case 'column_concrete_square':
    case 'debug_column':
      return appendBox(cursor, x, y, z + 0.08 * sz, 0.48 * sx, 0.48 * sy, 0.16 * sz, yaw, cDark)
        && appendBox(cursor, x, y, z + 0.52 * sz, 0.28 * sx, 0.28 * sy, 0.86 * sz, yaw, c)
        && appendBox(cursor, x, y, z + 0.96 * sz, 0.44 * sx, 0.44 * sy, 0.16 * sz, yaw, cLight);
    case 'table_slab':
      return appendBox(cursor, x, y, z + 0.54 * sz, 0.72 * sx, 0.54 * sy, 0.09 * sz, yaw, c)
        && appendBox(cursor, x - 0.24 * sx, y - 0.17 * sy, z + 0.27 * sz, 0.08 * sx, 0.08 * sy, 0.52 * sz, yaw, cDark)
        && appendBox(cursor, x + 0.24 * sx, y - 0.17 * sy, z + 0.27 * sz, 0.08 * sx, 0.08 * sy, 0.52 * sz, yaw, cDark)
        && appendBox(cursor, x - 0.24 * sx, y + 0.17 * sy, z + 0.27 * sz, 0.08 * sx, 0.08 * sy, 0.52 * sz, yaw, cDark)
        && appendBox(cursor, x + 0.24 * sx, y + 0.17 * sy, z + 0.27 * sz, 0.08 * sx, 0.08 * sy, 0.52 * sz, yaw, cDark);
    case 'chair_simple':
      return appendBox(cursor, x, y, z + 0.34 * sz, 0.38 * sx, 0.34 * sy, 0.08 * sz, yaw, c)
        && appendBox(cursor, x, y + 0.15 * sy, z + 0.58 * sz, 0.38 * sx, 0.08 * sy, 0.48 * sz, yaw, cDark)
        && appendBox(cursor, x - 0.13 * sx, y - 0.1 * sy, z + 0.18 * sz, 0.06 * sx, 0.06 * sy, 0.34 * sz, yaw, cDark)
        && appendBox(cursor, x + 0.13 * sx, y - 0.1 * sy, z + 0.18 * sz, 0.06 * sx, 0.06 * sy, 0.34 * sz, yaw, cDark);
    case 'bed_frame':
      return appendBox(cursor, x, y, z + 0.28 * sz, 0.82 * sx, 0.54 * sy, 0.18 * sz, yaw, c)
        && appendBox(cursor, x - 0.32 * sx, y, z + 0.45 * sz, 0.10 * sx, 0.56 * sy, 0.34 * sz, yaw, cDark);
    case 'shelf_block':
      return appendBox(cursor, x, y, z + 0.46 * sz, 0.62 * sx, 0.20 * sy, 0.84 * sz, yaw, cDark)
        && appendBox(cursor, x, y - 0.02 * sy, z + 0.46 * sz, 0.52 * sx, 0.12 * sy, 0.72 * sz, yaw, c);
    case 'machine_box':
      return appendBox(cursor, x, y, z + 0.42 * sz, 0.62 * sx, 0.54 * sy, 0.78 * sz, yaw, cDark)
        && appendBox(cursor, x, y - 0.29 * sy, z + 0.58 * sz, 0.34 * sx, 0.04 * sy, 0.22 * sz, yaw, cLight);
    case 'lamp_stand':
      return appendBox(cursor, x, y, z + 0.40 * sz, 0.07 * sx, 0.07 * sy, 0.80 * sz, yaw, cDark)
        && appendBox(cursor, x, y, z + 0.86 * sz, 0.24 * sx, 0.24 * sy, 0.12 * sz, yaw, cLight);
    case 'candle_stub':
      return appendBox(cursor, x, y, z + 0.15 * sz, 0.11 * sx, 0.11 * sy, 0.28 * sz, yaw, c)
        && appendBox(cursor, x, y, z + 0.33 * sz, 0.16 * sx, 0.16 * sy, 0.07 * sz, yaw, cLight);
    default:
      return false;
  }
}

function appendVoxelChunk(cursor: BuildCursor, chunk: VoxelChunkMesh): boolean {
  const vertices = chunk.vertices;
  const normals = chunk.normals;
  const colors = chunk.colors;
  const indices = chunk.indices;
  const depthScale = 1 / Math.max(1, chunk.fieldDepth);
  let submitted = false;

  for (let i = 0; i + 2 < indices.length; i += 3) {
    if (!reserve(cursor, 1)) return submitted;
    for (let k = 0; k < 3; k++) {
      const index = indices[i + k];
      const vi = index * 3;
      const ci = index * 4;
      const x = chunk.originX + vertices[vi];
      const y = chunk.originY + vertices[vi + 1];
      const z = vertices[vi + 2] * depthScale;
      pushVertex(
        cursor,
        x,
        y,
        z,
        normals[vi] || 0,
        normals[vi + 1] || 0,
        normals[vi + 2] || 0,
        [colors[ci] ?? 128, colors[ci + 1] ?? 128, colors[ci + 2] ?? 128],
      );
    }
    cursor.triangleCount++;
    submitted = true;
  }

  return submitted;
}

export function buildMeshVertexBatch(
  instances: readonly MeshInstance[],
  maxTriangles: number,
  out?: Float32Array,
  voxelChunks: readonly VoxelChunkMesh[] = [],
): MeshBuildResult {
  const data = ensureCapacity(instances, maxTriangles, out);
  const cursor: BuildCursor = {
    data,
    offset: 0,
    triangleCount: 0,
    maxTriangles: Math.max(0, Math.floor(maxTriangles)),
    truncated: false,
  };
  let submittedInstances = 0;
  let skippedInstances = 0;
  let submittedChunks = 0;
  for (const instance of instances) {
    if (appendInstance(cursor, instance)) submittedInstances++;
    else skippedInstances++;
    if (cursor.truncated) break;
  }
  if (!cursor.truncated) {
    for (const chunk of voxelChunks) {
      if (appendVoxelChunk(cursor, chunk)) submittedChunks++;
      if (cursor.truncated) break;
    }
  }
  return {
    vertices: data,
    vertexCount: Math.floor(cursor.offset / MESH_VERTEX_STRIDE),
    triangleCount: cursor.triangleCount,
    submittedInstances,
    submittedChunks,
    skippedInstances,
    truncated: cursor.truncated,
  };
}
