import type { MeshColor, MeshMaterialId } from '../../data/visual_models';

export type { MeshMaterialId };

export interface MeshMaterialDef {
  id: MeshMaterialId;
  baseRgb: MeshColor;
  roughness: number;
  emissive: number;
  variation: number;
  alphaMode?: 'opaque' | 'blend';
}

export const MESH_MATERIALS: Readonly<Record<MeshMaterialId, MeshMaterialDef>> = {
  concrete: {
    id: 'concrete',
    baseRgb: [118, 118, 112],
    roughness: 0.92,
    emissive: 0,
    variation: 14,
  },
  dark_concrete: {
    id: 'dark_concrete',
    baseRgb: [66, 66, 62],
    roughness: 0.96,
    emissive: 0,
    variation: 10,
  },
  rust_metal: {
    id: 'rust_metal',
    baseRgb: [112, 72, 42],
    roughness: 0.74,
    emissive: 0,
    variation: 18,
  },
  painted_metal: {
    id: 'painted_metal',
    baseRgb: [78, 88, 88],
    roughness: 0.65,
    emissive: 0,
    variation: 12,
  },
  wood: {
    id: 'wood',
    baseRgb: [105, 74, 43],
    roughness: 0.8,
    emissive: 0,
    variation: 16,
  },
  plastic: {
    id: 'plastic',
    baseRgb: [38, 40, 42],
    roughness: 0.58,
    emissive: 0,
    variation: 8,
  },
  cloth: {
    id: 'cloth',
    baseRgb: [122, 119, 105],
    roughness: 0.98,
    emissive: 0,
    variation: 13,
  },
  glass_dim: {
    id: 'glass_dim',
    baseRgb: [86, 126, 128],
    roughness: 0.22,
    emissive: 0.06,
    variation: 7,
    alphaMode: 'blend',
  },
  emissive_lamp: {
    id: 'emissive_lamp',
    baseRgb: [255, 208, 108],
    roughness: 0.35,
    emissive: 1,
    variation: 5,
  },
  emissive_screen: {
    id: 'emissive_screen',
    baseRgb: [74, 202, 142],
    roughness: 0.18,
    emissive: 0.85,
    variation: 8,
  },
  meat: {
    id: 'meat',
    baseRgb: [136, 46, 52],
    roughness: 0.82,
    emissive: 0,
    variation: 22,
  },
  bone: {
    id: 'bone',
    baseRgb: [204, 198, 172],
    roughness: 0.68,
    emissive: 0,
    variation: 12,
  },
};

function clampByte(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.max(0, Math.min(255, Math.round(value)));
}

function signedByteNoise(seed: number): number {
  let h = (seed | 0) || 1;
  h ^= h << 13;
  h ^= h >>> 17;
  h ^= h << 5;
  return ((h >>> 24) / 255) * 2 - 1;
}

export function meshMaterial(id: MeshMaterialId): MeshMaterialDef {
  return MESH_MATERIALS[id];
}

export function meshMaterialColor(id: MeshMaterialId, seed = 0, override?: MeshColor): readonly [number, number, number, number] {
  const material = meshMaterial(id);
  const base = override ?? material.baseRgb;
  const variance = override ? 0 : signedByteNoise(seed) * material.variation;
  const glow = material.emissive * 16;
  const alpha = material.alphaMode === 'blend' ? 188 : 255;
  return [
    clampByte(base[0] + variance + glow),
    clampByte(base[1] + variance + glow),
    clampByte(base[2] + variance + glow),
    alpha,
  ];
}
