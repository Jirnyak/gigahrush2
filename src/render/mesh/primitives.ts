import { hashSeed, xorshift32 } from '../../core/rand';
import type {
  MeshVec2,
  MeshVec3,
  VisualModelDef,
  VisualModelId,
  VisualModelPart,
} from '../../data/visual_models';
import { meshMaterialColor } from './materials';

export interface MeshTemplate {
  modelId: VisualModelId;
  vertices: Float32Array;
  normals: Float32Array;
  colors: Uint8Array;
  indices: Uint16Array | Uint32Array;
  boundsRadius: number;
  triangleCount: number;
}

interface MeshDraft {
  vertices: number[];
  normals: number[];
  colors: number[];
  indices: number[];
}

type Rgba = readonly [number, number, number, number];

const DEFAULT_CYLINDER_SEGMENTS = 8;

function finitePositive(value: number): boolean {
  return Number.isFinite(value) && value > 0;
}

function emptyDraft(): MeshDraft {
  return { vertices: [], normals: [], colors: [], indices: [] };
}

function pushVertex(draft: MeshDraft, position: MeshVec3, normal: MeshVec3, color: Rgba): number {
  const index = draft.vertices.length / 3;
  draft.vertices.push(position[0], position[1], position[2]);
  draft.normals.push(normal[0], normal[1], normal[2]);
  draft.colors.push(color[0], color[1], color[2], color[3]);
  return index;
}

function pushTri(draft: MeshDraft, a: MeshVec3, b: MeshVec3, c: MeshVec3, normal: MeshVec3, color: Rgba): void {
  const base = draft.vertices.length / 3;
  pushVertex(draft, a, normal, color);
  pushVertex(draft, b, normal, color);
  pushVertex(draft, c, normal, color);
  draft.indices.push(base, base + 1, base + 2);
}

function pushQuad(draft: MeshDraft, a: MeshVec3, b: MeshVec3, c: MeshVec3, d: MeshVec3, normal: MeshVec3, color: Rgba): void {
  const base = draft.vertices.length / 3;
  pushVertex(draft, a, normal, color);
  pushVertex(draft, b, normal, color);
  pushVertex(draft, c, normal, color);
  pushVertex(draft, d, normal, color);
  draft.indices.push(base, base + 1, base + 2, base, base + 2, base + 3);
}

function add3(a: MeshVec3, b: MeshVec3): MeshVec3 {
  return [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
}

function scale3(v: MeshVec3, s: number): MeshVec3 {
  return [v[0] * s, v[1] * s, v[2] * s];
}

function addScaled3(a: MeshVec3, b: MeshVec3, sb: number, c: MeshVec3, sc: number): MeshVec3 {
  return [a[0] + b[0] * sb + c[0] * sc, a[1] + b[1] * sb + c[1] * sc, a[2] + b[2] * sb + c[2] * sc];
}

function partColor(part: VisualModelPart, modelId: VisualModelId, partIndex: number, variantSeed: number): Rgba {
  return meshMaterialColor(
    part.material,
    hashSeed(`${modelId}:${partIndex}:${part.kind}`, variantSeed),
    part.color,
  );
}

function addBox(draft: MeshDraft, position: MeshVec3, size: MeshVec3, color: Rgba): void {
  if (!finitePositive(size[0]) || !finitePositive(size[1]) || !finitePositive(size[2])) return;
  const hx = size[0] * 0.5;
  const hy = size[1] * 0.5;
  const hz = size[2] * 0.5;
  const x0 = position[0] - hx;
  const x1 = position[0] + hx;
  const y0 = position[1] - hy;
  const y1 = position[1] + hy;
  const z0 = position[2] - hz;
  const z1 = position[2] + hz;

  pushQuad(draft, [x1, y0, z0], [x1, y1, z0], [x1, y1, z1], [x1, y0, z1], [1, 0, 0], color);
  pushQuad(draft, [x0, y1, z0], [x0, y0, z0], [x0, y0, z1], [x0, y1, z1], [-1, 0, 0], color);
  pushQuad(draft, [x0, y1, z0], [x1, y1, z0], [x1, y1, z1], [x0, y1, z1], [0, 1, 0], color);
  pushQuad(draft, [x1, y0, z0], [x0, y0, z0], [x0, y0, z1], [x1, y0, z1], [0, -1, 0], color);
  pushQuad(draft, [x0, y0, z1], [x1, y0, z1], [x1, y1, z1], [x0, y1, z1], [0, 0, 1], color);
  pushQuad(draft, [x0, y1, z0], [x1, y1, z0], [x1, y0, z0], [x0, y0, z0], [0, 0, -1], color);
}

function cylinderPoint(axis: 'x' | 'y' | 'z', center: MeshVec3, u: number, v: number, t: number): MeshVec3 {
  if (axis === 'x') return [center[0] + t, center[1] + u, center[2] + v];
  if (axis === 'y') return [center[0] + u, center[1] + t, center[2] + v];
  return [center[0] + u, center[1] + v, center[2] + t];
}

function cylinderNormal(axis: 'x' | 'y' | 'z', u: number, v: number): MeshVec3 {
  if (axis === 'x') return [0, u, v];
  if (axis === 'y') return [u, 0, v];
  return [u, v, 0];
}

function axisNormal(axis: 'x' | 'y' | 'z', sign: 1 | -1): MeshVec3 {
  if (axis === 'x') return [sign, 0, 0];
  if (axis === 'y') return [0, sign, 0];
  return [0, 0, sign];
}

function addCylinder(
  draft: MeshDraft,
  position: MeshVec3,
  radius: number,
  height: number,
  axis: 'x' | 'y' | 'z',
  segments: number,
  capped: boolean,
  color: Rgba,
): void {
  if (!finitePositive(radius) || !finitePositive(height)) return;
  const sides = Math.max(3, Math.min(16, Math.floor(segments || DEFAULT_CYLINDER_SEGMENTS)));
  const half = height * 0.5;
  for (let i = 0; i < sides; i++) {
    const a0 = (i / sides) * Math.PI * 2;
    const a1 = ((i + 1) / sides) * Math.PI * 2;
    const u0 = Math.cos(a0);
    const v0 = Math.sin(a0);
    const u1 = Math.cos(a1);
    const v1 = Math.sin(a1);
    const p0 = cylinderPoint(axis, position, u0 * radius, v0 * radius, -half);
    const p1 = cylinderPoint(axis, position, u1 * radius, v1 * radius, -half);
    const p2 = cylinderPoint(axis, position, u1 * radius, v1 * radius, half);
    const p3 = cylinderPoint(axis, position, u0 * radius, v0 * radius, half);
    const n0 = cylinderNormal(axis, u0, v0);
    const n1 = cylinderNormal(axis, u1, v1);
    const base = draft.vertices.length / 3;
    pushVertex(draft, p0, n0, color);
    pushVertex(draft, p1, n1, color);
    pushVertex(draft, p2, n1, color);
    pushVertex(draft, p3, n0, color);
    draft.indices.push(base, base + 1, base + 2, base, base + 2, base + 3);
    if (capped) {
      const c0 = cylinderPoint(axis, position, 0, 0, -half);
      const c1 = cylinderPoint(axis, position, 0, 0, half);
      pushTri(draft, c0, p1, p0, axisNormal(axis, -1), color);
      pushTri(draft, c1, p3, p2, axisNormal(axis, 1), color);
    }
  }
}

function planeBasis(orientation: 'xy' | 'xz' | 'yz', normalSign: 1 | -1): { u: MeshVec3; v: MeshVec3; n: MeshVec3 } {
  if (orientation === 'xy') return { u: [1, 0, 0], v: [0, 1, 0], n: [0, 0, normalSign] };
  if (orientation === 'xz') return { u: [1, 0, 0], v: [0, 0, 1], n: [0, normalSign, 0] };
  return { u: [0, 1, 0], v: [0, 0, 1], n: [normalSign, 0, 0] };
}

function addPlane(
  draft: MeshDraft,
  position: MeshVec3,
  size: MeshVec2,
  orientation: 'xy' | 'xz' | 'yz',
  normalSign: 1 | -1,
  doubleSided: boolean,
  color: Rgba,
  jitter = 0,
  variantSeed = 0,
): void {
  if (!finitePositive(size[0]) || !finitePositive(size[1])) return;
  const basis = planeBasis(orientation, normalSign);
  const hu = size[0] * 0.5;
  const hv = size[1] * 0.5;

  let a = addScaled3(position, basis.u, -hu, basis.v, -hv);
  let b = addScaled3(position, basis.u, hu, basis.v, -hv);
  let c = addScaled3(position, basis.u, hu, basis.v, hv);
  let d = addScaled3(position, basis.u, -hu, basis.v, hv);

  if (jitter > 0) {
    const r = xorshift32(variantSeed ^ 0xbadc0de);
    const jx = () => (r() / 4294967296 - 0.5) * 2 * jitter;
    const jy = () => (r() / 4294967296 - 0.5) * 2 * jitter;
    a = addScaled3(a, basis.u, jx(), basis.v, jy());
    b = addScaled3(b, basis.u, jx(), basis.v, jy());
    c = addScaled3(c, basis.u, jx(), basis.v, jy());
    d = addScaled3(d, basis.u, jx(), basis.v, jy());
  }

  pushQuad(draft, a, b, c, d, basis.n, color);
  if (doubleSided) pushQuad(draft, d, c, b, a, scale3(basis.n, -1), color);
}

function addCrossPlane(draft: MeshDraft, position: MeshVec3, size: MeshVec2, color: Rgba): void {
  addPlane(draft, position, size, 'xz', 1, true, color);
  addPlane(draft, position, size, 'yz', 1, true, color);
}

function dominantAxis(from: MeshVec3, to: MeshVec3): 'x' | 'y' | 'z' {
  const dx = Math.abs(to[0] - from[0]);
  const dy = Math.abs(to[1] - from[1]);
  const dz = Math.abs(to[2] - from[2]);
  if (dx >= dy && dx >= dz) return 'x';
  if (dy >= dx && dy >= dz) return 'y';
  return 'z';
}

function addRail(draft: MeshDraft, from: MeshVec3, to: MeshVec3, width: number, segments: number, gap: number, color: Rgba): void {
  if (!finitePositive(width)) return;
  const axis = dominantAxis(from, to);
  const axisIndex = axis === 'x' ? 0 : axis === 'y' ? 1 : 2;
  const start = from[axisIndex];
  const end = to[axisIndex];
  const length = Math.abs(end - start);
  if (!finitePositive(length)) {
    addBox(draft, [(from[0] + to[0]) * 0.5, (from[1] + to[1]) * 0.5, (from[2] + to[2]) * 0.5], [width, width, width], color);
    return;
  }
  const count = Math.max(1, Math.min(32, Math.floor(segments || 1)));
  const sign = end >= start ? 1 : -1;
  const segmentLength = Math.max(width, (length - Math.max(0, gap) * (count - 1)) / count);
  for (let i = 0; i < count; i++) {
    const centerAxis = start + sign * (segmentLength * (i + 0.5) + Math.max(0, gap) * i);
    const t = length > 0 ? Math.min(1, Math.max(0, Math.abs(centerAxis - start) / length)) : 0;
    const baseCenter: [number, number, number] = [
      from[0] + (to[0] - from[0]) * t,
      from[1] + (to[1] - from[1]) * t,
      from[2] + (to[2] - from[2]) * t,
    ];
    const center: [number, number, number] = axis === 'x'
      ? [centerAxis, baseCenter[1], baseCenter[2]]
      : axis === 'y'
        ? [baseCenter[0], centerAxis, baseCenter[2]]
        : [baseCenter[0], baseCenter[1], centerAxis];
    const size: [number, number, number] = [width, width, width];
    size[axisIndex] = segmentLength;
    addBox(draft, center, size, color);
  }
}

export function buildVisualModelPart(
  modelId: VisualModelId,
  part: VisualModelPart,
  partIndex: number,
  variantSeed = 0,
): MeshTemplate {
  const draft = emptyDraft();
  addVisualModelPart(draft, modelId, part, partIndex, variantSeed);
  return finishTemplate(modelId, draft);
}

function addVisualModelPart(draft: MeshDraft, modelId: VisualModelId, part: VisualModelPart, partIndex: number, variantSeed: number): void {
  const color = partColor(part, modelId, partIndex, variantSeed);
  switch (part.kind) {
    case 'box':
    case 'slab':
      addBox(draft, part.position, part.size, color);
      break;
    case 'cylinder':
      addCylinder(
        draft,
        part.position,
        part.radius,
        part.height,
        part.axis ?? 'z',
        part.segments ?? DEFAULT_CYLINDER_SEGMENTS,
        part.capped ?? true,
        color,
      );
      break;
    case 'plane':
      addPlane(draft, part.position, part.size, part.orientation, part.normal ?? 1, part.doubleSided ?? false, color, part.jitter ?? 0, variantSeed);
      break;
    case 'crossPlane':
      addCrossPlane(draft, part.position, part.size, color);
      break;
    case 'rail':
      addRail(draft, part.from, part.to, part.width, part.segments ?? 1, part.gap ?? 0, color);
      break;
    default: {
      const exhaustive: never = part;
      throw new Error(`unsupported visual model part ${(exhaustive as { kind?: string }).kind ?? 'unknown'}`);
    }
  }
}

function finishTemplate(modelId: VisualModelId, draft: MeshDraft): MeshTemplate {
  let boundsRadius2 = 0;
  for (let i = 0; i < draft.vertices.length; i += 3) {
    const x = draft.vertices[i];
    const y = draft.vertices[i + 1];
    const z = draft.vertices[i + 2];
    boundsRadius2 = Math.max(boundsRadius2, x * x + y * y + z * z);
  }
  const vertexCount = draft.vertices.length / 3;
  const indices = vertexCount > 65535 ? new Uint32Array(draft.indices) : new Uint16Array(draft.indices);
  return {
    modelId,
    vertices: new Float32Array(draft.vertices),
    normals: new Float32Array(draft.normals),
    colors: new Uint8Array(draft.colors),
    indices,
    boundsRadius: Math.sqrt(boundsRadius2),
    triangleCount: indices.length / 3,
  };
}

export function buildMeshTemplate(def: VisualModelDef, variantSeed = 0): MeshTemplate {
  const draft = emptyDraft();
  const seed = hashSeed(`${def.id}:${def.variantSalt ?? 0}`, variantSeed);
  for (let i = 0; i < def.parts.length; i++) {
    addVisualModelPart(draft, def.id, def.parts[i], i, seed);
  }
  const template = finishTemplate(def.id, draft);
  if (template.boundsRadius > 0) return template;
  const fallbackRadius = Math.sqrt(def.bounds.x * def.bounds.x + def.bounds.y * def.bounds.y + def.bounds.z * def.bounds.z) * 0.5;
  return { ...template, boundsRadius: fallbackRadius };
}

export function transformedPoint(position: MeshVec3, offset: MeshVec3): MeshVec3 {
  return add3(position, offset);
}
