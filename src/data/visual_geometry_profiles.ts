import { hashSeed } from '../core/rand';
import { FloorLevel } from '../core/types';
import type { FloorThemeProfile } from './floor_theme_profiles';
import {
  selectVisualCorridorCovering,
  type VisualCorridorCoveringId,
  type VisualCorridorVolumeStyle,
} from './visual_corridor_coverings';

export const VISUAL_GEOMETRY_MODES = [
  { id: 'off', label: 'Выкл' },
  { id: 'low', label: 'Низкая' },
  { id: 'medium', label: 'Средняя' },
  { id: 'high', label: 'Высокая' },
] as const;

export type VisualGeometryMode = typeof VISUAL_GEOMETRY_MODES[number]['id'];

export const VISUAL_GEOMETRY_DEFAULT_MODE: VisualGeometryMode = 'high';

export interface VisualGeometryModeBudget {
  radius: number;
  proceduralFieldRadius: number;
  instanceCap: number;
  proceduralFieldInstanceCap: number;
  triangleCap: number;
}

export const VISUAL_GEOMETRY_MODE_BUDGETS: Readonly<Record<VisualGeometryMode, VisualGeometryModeBudget>> = {
  off: { radius: 0, proceduralFieldRadius: 0, instanceCap: 0, proceduralFieldInstanceCap: 0, triangleCap: 0 },
  low: { radius: 4, proceduralFieldRadius: 2, instanceCap: 128, proceduralFieldInstanceCap: 16, triangleCap: 24_000 },
  medium: { radius: 8, proceduralFieldRadius: 4, instanceCap: 256, proceduralFieldInstanceCap: 32, triangleCap: 48_000 },
  high: { radius: 16, proceduralFieldRadius: 8, instanceCap: 512, proceduralFieldInstanceCap: 64, triangleCap: 96_000 },
} as const;

export interface ResolvedVisualGeometryProfile {
  key: string;
  seed: number;
  mode: VisualGeometryMode;
  enabled: boolean;
  radius: number;
  radiusCells: number;
  proceduralFieldRadius: number;
  proceduralFieldInstanceCap: number;
  chunkSize: number;
  maxChunksPerFrame: number;
  visualSlotScanCap: number;
  visualSlotInstanceCap: number;
  visualSlotMergeCap: number;
  instanceCap: number;
  triangleCap: number;
  drawCallCap: number;
  voxelEnabled: boolean;
  voxelRadius: number;
  ceilingDetail: number;
  furnitureDetail: number;
  emissiveDetail: number;
  corridorVolumeDetail: number;
  organicVolumeDetail: number;
  corridorVolumeStyle: VisualCorridorVolumeStyle;
  corridorCoveringId: VisualCorridorCoveringId;
  includeVisualSlots: boolean;
  includeFeatures: boolean;
  includeContainers: boolean;
  includeEntities: boolean;
  includeCorridorVolumes: boolean;
  modulationIds?: readonly string[];
}

export type VisualGeometryProfile = Omit<ResolvedVisualGeometryProfile, 'key' | 'seed' | 'modulationIds'>;

const MODE_PROFILES: Readonly<Record<VisualGeometryMode, Omit<ResolvedVisualGeometryProfile, 'key' | 'seed' | 'mode'>>> = {
  off: {
    enabled: false,
    radius: VISUAL_GEOMETRY_MODE_BUDGETS.off.radius,
    radiusCells: 0,
    proceduralFieldRadius: VISUAL_GEOMETRY_MODE_BUDGETS.off.proceduralFieldRadius,
    proceduralFieldInstanceCap: VISUAL_GEOMETRY_MODE_BUDGETS.off.proceduralFieldInstanceCap,
    chunkSize: 0,
    maxChunksPerFrame: 0,
    visualSlotScanCap: 0,
    visualSlotInstanceCap: 0,
    visualSlotMergeCap: 0,
    instanceCap: VISUAL_GEOMETRY_MODE_BUDGETS.off.instanceCap,
    triangleCap: VISUAL_GEOMETRY_MODE_BUDGETS.off.triangleCap,
    drawCallCap: 0,
    voxelEnabled: false,
    voxelRadius: 0,
    ceilingDetail: 0,
    furnitureDetail: 0,
    emissiveDetail: 0,
    corridorVolumeDetail: 0,
    organicVolumeDetail: 0,
    corridorVolumeStyle: 'concrete',
    corridorCoveringId: 'concrete',
    includeVisualSlots: false,
    includeFeatures: false,
    includeContainers: false,
    includeEntities: false,
    includeCorridorVolumes: false,
  },
  low: {
    enabled: true,
    radius: VISUAL_GEOMETRY_MODE_BUDGETS.low.radius,
    radiusCells: VISUAL_GEOMETRY_MODE_BUDGETS.low.radius,
    proceduralFieldRadius: VISUAL_GEOMETRY_MODE_BUDGETS.low.proceduralFieldRadius,
    proceduralFieldInstanceCap: VISUAL_GEOMETRY_MODE_BUDGETS.low.proceduralFieldInstanceCap,
    chunkSize: 8,
    maxChunksPerFrame: 4,
    visualSlotScanCap: 5000,
    visualSlotInstanceCap: 64,
    visualSlotMergeCap: 96,
    instanceCap: VISUAL_GEOMETRY_MODE_BUDGETS.low.instanceCap,
    triangleCap: VISUAL_GEOMETRY_MODE_BUDGETS.low.triangleCap,
    drawCallCap: 1,
    voxelEnabled: false,
    voxelRadius: 0,
    ceilingDetail: 0.35,
    furnitureDetail: 0.45,
    emissiveDetail: 0.4,
    corridorVolumeDetail: 0.28,
    organicVolumeDetail: 0.12,
    corridorVolumeStyle: 'concrete',
    corridorCoveringId: 'concrete',
    includeVisualSlots: true,
    includeFeatures: true,
    includeContainers: true,
    includeEntities: false,
    includeCorridorVolumes: true,
  },
  medium: {
    enabled: true,
    radius: VISUAL_GEOMETRY_MODE_BUDGETS.medium.radius,
    radiusCells: VISUAL_GEOMETRY_MODE_BUDGETS.medium.radius,
    proceduralFieldRadius: VISUAL_GEOMETRY_MODE_BUDGETS.medium.proceduralFieldRadius,
    proceduralFieldInstanceCap: VISUAL_GEOMETRY_MODE_BUDGETS.medium.proceduralFieldInstanceCap,
    chunkSize: 8,
    maxChunksPerFrame: 6,
    visualSlotScanCap: 11_000,
    visualSlotInstanceCap: 128,
    visualSlotMergeCap: 180,
    instanceCap: VISUAL_GEOMETRY_MODE_BUDGETS.medium.instanceCap,
    triangleCap: VISUAL_GEOMETRY_MODE_BUDGETS.medium.triangleCap,
    drawCallCap: 1,
    voxelEnabled: false,
    voxelRadius: 0,
    ceilingDetail: 0.55,
    furnitureDetail: 0.65,
    emissiveDetail: 0.65,
    corridorVolumeDetail: 0.48,
    organicVolumeDetail: 0.24,
    corridorVolumeStyle: 'concrete',
    corridorCoveringId: 'concrete',
    includeVisualSlots: true,
    includeFeatures: true,
    includeContainers: true,
    includeEntities: false,
    includeCorridorVolumes: true,
  },
  high: {
    enabled: true,
    radius: VISUAL_GEOMETRY_MODE_BUDGETS.high.radius,
    radiusCells: VISUAL_GEOMETRY_MODE_BUDGETS.high.radius,
    proceduralFieldRadius: VISUAL_GEOMETRY_MODE_BUDGETS.high.proceduralFieldRadius,
    proceduralFieldInstanceCap: VISUAL_GEOMETRY_MODE_BUDGETS.high.proceduralFieldInstanceCap,
    chunkSize: 8,
    maxChunksPerFrame: 8,
    visualSlotScanCap: 24_000,
    visualSlotInstanceCap: 220,
    visualSlotMergeCap: 320,
    instanceCap: VISUAL_GEOMETRY_MODE_BUDGETS.high.instanceCap,
    triangleCap: VISUAL_GEOMETRY_MODE_BUDGETS.high.triangleCap,
    drawCallCap: 1,
    voxelEnabled: true,
    voxelRadius: 12,
    ceilingDetail: 0.8,
    furnitureDetail: 0.9,
    emissiveDetail: 0.9,
    corridorVolumeDetail: 0.78,
    organicVolumeDetail: 0.48,
    corridorVolumeStyle: 'concrete',
    corridorCoveringId: 'concrete',
    includeVisualSlots: true,
    includeFeatures: true,
    includeContainers: true,
    includeEntities: true,
    includeCorridorVolumes: true,
  },
};

export const VISUAL_GEOMETRY_BASE_PROFILES = MODE_PROFILES;

export interface VisualGeometryThemeModulation {
  id: string;
  floorKeys?: readonly string[];
  requiredTags?: readonly string[];
  blockedTags?: readonly string[];
  instanceMul?: number;
  triangleMul?: number;
  ceilingDetailMul?: number;
  furnitureDetailMul?: number;
  emissiveDetailMul?: number;
  corridorVolumeDetailMul?: number;
  organicVolumeDetailMul?: number;
}

export const VISUAL_GEOMETRY_THEME_MODULATIONS: readonly VisualGeometryThemeModulation[] = [
  {
    id: 'maintenance_pipes_cables',
    floorKeys: ['story:maintenance'],
    requiredTags: ['maintenance'],
    instanceMul: 1.1,
    triangleMul: 1.08,
    ceilingDetailMul: 1.25,
    furnitureDetailMul: 0.8,
    emissiveDetailMul: 1.1,
    corridorVolumeDetailMul: 1.22,
  },
  {
    id: 'industrial_hard_detail',
    requiredTags: ['industrial'],
    instanceMul: 1.15,
    triangleMul: 1.12,
    ceilingDetailMul: 1.18,
    furnitureDetailMul: 0.82,
    emissiveDetailMul: 1.05,
    corridorVolumeDetailMul: 1.16,
  },
  {
    id: 'collector_render_field',
    requiredTags: ['collectors'],
    instanceMul: 1.24,
    triangleMul: 1.16,
    ceilingDetailMul: 1.12,
    corridorVolumeDetailMul: 1.18,
  },
  {
    id: 'residential_furniture',
    requiredTags: ['residential'],
    instanceMul: 1.08,
    triangleMul: 1.06,
    ceilingDetailMul: 0.9,
    furnitureDetailMul: 1.25,
  },
  {
    id: 'documents_wall_detail',
    requiredTags: ['documents'],
    instanceMul: 1.05,
    ceilingDetailMul: 1.05,
    furnitureDetailMul: 1.1,
  },
  {
    id: 'meat_sparse_volume',
    requiredTags: ['meat'],
    blockedTags: ['void'],
    instanceMul: 0.9,
    triangleMul: 0.92,
    ceilingDetailMul: 1.15,
    furnitureDetailMul: 0.55,
    emissiveDetailMul: 0.9,
    corridorVolumeDetailMul: 1.25,
    organicVolumeDetailMul: 1.85,
  },
  {
    id: 'void_sparse_silhouette',
    requiredTags: ['void'],
    instanceMul: 0.55,
    triangleMul: 0.62,
    ceilingDetailMul: 0.45,
    furnitureDetailMul: 0.35,
    emissiveDetailMul: 0.75,
    corridorVolumeDetailMul: 0.85,
    organicVolumeDetailMul: 0.45,
  },
];

export const EMPTY_RESOLVED_VISUAL_GEOMETRY_PROFILE: ResolvedVisualGeometryProfile = {
  key: 'geometry:off',
  seed: 0,
  mode: 'off',
  ...MODE_PROFILES.off,
};

export function normalizeVisualGeometryMode(value: unknown): VisualGeometryMode {
  if (typeof value === 'string' && VISUAL_GEOMETRY_MODES.some(mode => mode.id === value)) return value as VisualGeometryMode;
  return VISUAL_GEOMETRY_DEFAULT_MODE;
}

export function visualGeometryThemeTags(theme: FloorThemeProfile): readonly string[] {
  const tags = new Set<string>();
  tags.add(theme.kind);
  tags.add(`kind_${theme.kind}`);
  const floorName = (FloorLevel[theme.themeClass] ?? 'floor').toLowerCase();
  tags.add(floorName);
  tags.add(`floor_${floorName}`);
  tags.add(`danger_${theme.danger}`);
  for (const tag of theme.objectProfileTags) tags.add(tag);
  for (const tag of theme.monsterPressureTags) tags.add(tag);
  for (const tag of theme.economyTags) tags.add(tag);
  for (const tag of theme.specialContentTags) tags.add(tag);
  if (theme.routeId) tags.add(String(theme.routeId));
  if (theme.routeZ !== undefined) {
    const depth = Math.abs(theme.routeZ);
    if (depth >= 30) tags.add('deep_route');
    else if (depth >= 12) tags.add('mid_route');
    else tags.add('near_route');
  }
  if (theme.themeClass === FloorLevel.LIVING || theme.themeClass === FloorLevel.KVARTIRY) tags.add('residential');
  if (theme.themeClass === FloorLevel.MINISTRY) tags.add('documents');
  if (theme.themeClass === FloorLevel.MAINTENANCE) {
    tags.add('maintenance');
    tags.add('industrial');
    tags.add('water');
  }
  if (theme.themeClass === FloorLevel.HELL) tags.add('meat');
  if (theme.themeClass === FloorLevel.VOID) tags.add('void');
  return [...tags].sort();
}

function hasAllTags(tags: ReadonlySet<string>, required: readonly string[] | undefined): boolean {
  if (!required || required.length <= 0) return true;
  for (const tag of required) {
    if (!tags.has(tag)) return false;
  }
  return true;
}

function hasBlockedTag(tags: ReadonlySet<string>, blocked: readonly string[] | undefined): boolean {
  if (!blocked || blocked.length <= 0) return false;
  for (const tag of blocked) {
    if (tags.has(tag)) return true;
  }
  return false;
}

function modulationMatches(row: VisualGeometryThemeModulation, floorKey: string, tags: ReadonlySet<string>): boolean {
  if (row.floorKeys && !row.floorKeys.includes(floorKey)) return false;
  return hasAllTags(tags, row.requiredTags) && !hasBlockedTag(tags, row.blockedTags);
}

function clamp01(value: number): number {
  return Math.max(0, Math.min(1, value));
}

function floorKeyAndTags(
  themeOrFloorKey: FloorThemeProfile | string,
  tagsOrOptions: readonly string[] | { seed?: number } = [],
): { floorKey: string; tags: readonly string[]; seedSalt: number } {
  if (typeof themeOrFloorKey === 'string') {
    const options: { seed?: number } | undefined = Array.isArray(tagsOrOptions)
      ? undefined
      : (tagsOrOptions as { seed?: number });
    return {
      floorKey: themeOrFloorKey,
      tags: Array.isArray(tagsOrOptions) ? tagsOrOptions : [],
      seedSalt: options?.seed ?? 0,
    };
  }
  const options: { seed?: number } | undefined = Array.isArray(tagsOrOptions)
    ? undefined
    : (tagsOrOptions as { seed?: number });
  return {
    floorKey: themeOrFloorKey.floorKey,
    tags: visualGeometryThemeTags(themeOrFloorKey),
    seedSalt: options?.seed ?? 0,
  };
}

export function resolveVisualGeometryProfile(
  modeInput: VisualGeometryMode | string,
  theme: FloorThemeProfile,
  options?: { seed?: number },
): ResolvedVisualGeometryProfile;
export function resolveVisualGeometryProfile(
  modeInput: VisualGeometryMode | string,
  floorKey: string,
  themeTags?: readonly string[],
): ResolvedVisualGeometryProfile;
export function resolveVisualGeometryProfile(
  modeInput: VisualGeometryMode | string,
  themeOrFloorKey: FloorThemeProfile | string,
  tagsOrOptions: readonly string[] | { seed?: number } = [],
): ResolvedVisualGeometryProfile {
  const mode = normalizeVisualGeometryMode(modeInput);
  const base = MODE_PROFILES[mode];
  const resolvedInput = floorKeyAndTags(themeOrFloorKey, tagsOrOptions);
  const sortedTags = [...new Set(resolvedInput.tags)].sort();
  const key = `geometry:${mode}:${resolvedInput.floorKey}`;
  const seed = hashSeed(`visual-geometry:${resolvedInput.floorKey}:${sortedTags.join('|')}`, hashSeed(mode, resolvedInput.seedSalt));
  if (!base.enabled) {
    return {
      ...base,
      key,
      seed,
      mode,
      modulationIds: [],
    };
  }
  const tags = new Set(sortedTags);
  const industrial = tags.has('industrial') || tags.has('repair') || tags.has('collectors');
  const organic = tags.has('meat') || tags.has('samosbor') || tags.has('cult');
  const voidish = tags.has('void') || tags.has('finale');
  const residential = tags.has('residential') || tags.has('hub');
  const corridorCovering = selectVisualCorridorCovering(resolvedInput.floorKey, sortedTags);
  let instanceMul = 1;
  let triangleMul = 1;
  let ceilingDetailMul = 1;
  let furnitureDetailMul = 1;
  let emissiveDetailMul = 1;
  let corridorVolumeDetailMul = 1;
  let organicVolumeDetailMul = 1;
  const modulationIds: string[] = [];
  for (const row of VISUAL_GEOMETRY_THEME_MODULATIONS) {
    if (!modulationMatches(row, resolvedInput.floorKey, tags)) continue;
    modulationIds.push(row.id);
    instanceMul *= row.instanceMul ?? 1;
    triangleMul *= row.triangleMul ?? 1;
    ceilingDetailMul *= row.ceilingDetailMul ?? 1;
    furnitureDetailMul *= row.furnitureDetailMul ?? 1;
    emissiveDetailMul *= row.emissiveDetailMul ?? 1;
    corridorVolumeDetailMul *= row.corridorVolumeDetailMul ?? 1;
    organicVolumeDetailMul *= row.organicVolumeDetailMul ?? 1;
  }
  const radius = Math.max(0, base.radius);
  const instanceCap = Math.max(0, base.instanceCap);
  const triangleCap = Math.max(0, Math.round(base.triangleCap * triangleMul));
  const furnitureDetail = clamp01((base.furnitureDetail + (residential ? 0.1 : 0) - (voidish ? 0.2 : 0)) * furnitureDetailMul);
  const ceilingDetail = clamp01((base.ceilingDetail + (industrial ? 0.15 : 0) + (organic ? 0.1 : 0)) * ceilingDetailMul);
  const corridorVolumeStyle = corridorCovering.def.style;
  const routeRoughness = resolvedInput.floorKey.startsWith('procedural:') ? 0.08 : 0;
  const corridorVolumeDetail = clamp01((base.corridorVolumeDetail + routeRoughness + (industrial ? 0.08 : 0) + (organic ? 0.1 : 0)) * corridorVolumeDetailMul * corridorCovering.def.detailMul);
  const organicVolumeDetail = clamp01((base.organicVolumeDetail + (organic ? 0.28 : 0) + (tags.has('mushroom_mycelium') ? 0.18 : 0)) * organicVolumeDetailMul * corridorCovering.def.organicMul);
  return {
    ...base,
    key,
    seed,
    mode,
    radius,
    radiusCells: Math.ceil(radius),
    proceduralFieldRadius: base.proceduralFieldRadius,
    proceduralFieldInstanceCap: base.proceduralFieldInstanceCap,
    visualSlotScanCap: Math.max(0, Math.round(base.visualSlotScanCap * instanceMul)),
    visualSlotInstanceCap: Math.min(instanceCap, Math.max(0, Math.round(base.visualSlotInstanceCap * instanceMul))),
    visualSlotMergeCap: Math.max(0, Math.round(base.visualSlotMergeCap * instanceMul)),
    instanceCap,
    triangleCap,
    furnitureDetail,
    ceilingDetail,
    emissiveDetail: clamp01((base.emissiveDetail + (voidish ? 0.1 : 0)) * emissiveDetailMul),
    corridorVolumeDetail,
    organicVolumeDetail,
    corridorVolumeStyle,
    corridorCoveringId: corridorCovering.def.id,
    modulationIds: [...modulationIds, `corridor_${corridorCovering.ruleId}`],
  };
}
