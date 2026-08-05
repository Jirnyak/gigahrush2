import { FloorLevel, RoomType, Tex } from '../core/types';
import { hashSeed } from '../core/rand';
import type { FloorThemeProfile } from './floor_theme_profiles';

export type VisualSurfaceFloorPattern = 'plain' | 'checker' | 'smallTile' | 'lino' | 'wetConcrete' | 'metalGrid';
export type VisualSurfaceWallBand = 'none' | 'tileWainscot' | 'panelLower' | 'concreteBlocks' | 'serviceStrip';
export type VisualSurfaceCeilingPattern = 'plain' | 'panelGrid' | 'servicePanels' | 'lowConcrete' | 'organicRibs';
export type VisualSurfaceTrim = 'none' | 'baseboard' | 'concretePlinth' | 'metalRail';
export type VisualSurfaceGeometryMode = 'off' | 'low' | 'medium' | 'high';

export interface VisualSurfaceProfile {
  id: string;
  floorPattern: VisualSurfaceFloorPattern;
  wallBand: VisualSurfaceWallBand;
  ceilingPattern: VisualSurfaceCeilingPattern;
  trim: VisualSurfaceTrim;
  grime: number;
  seamStrength: number;
  lightPanelChance: number;
  ventChance: number;
}

export interface VisualSurfaceProfileRow {
  id: string;
  profileId: string;
  priority: number;
  kinds?: readonly FloorThemeProfile['kind'][];
  baseFloors?: readonly FloorLevel[];
  routeIds?: readonly string[];
  roomTypes?: readonly RoomType[];
  wallTex?: readonly Tex[];
  floorTex?: readonly Tex[];
  requiredTags?: readonly string[];
  blockedTags?: readonly string[];
  minDanger?: number;
  maxDanger?: number;
  minAbsZ?: number;
  maxAbsZ?: number;
}

export interface ResolvedVisualSurfaceProfile extends VisualSurfaceProfile {
  seed: number;
  floorPatternCode: number;
  wallBandCode: number;
  ceilingPatternCode: number;
  trimCode: number;
  surfaceMaterialsEnabled: boolean;
  protrudingDressing: boolean;
}

export const VISUAL_SURFACE_GEOMETRY_MODES: readonly VisualSurfaceGeometryMode[] = ['off', 'low', 'medium', 'high'];

export const VISUAL_SURFACE_FLOOR_PATTERN_CODES: Readonly<Record<VisualSurfaceFloorPattern, number>> = {
  plain: 0,
  checker: 1,
  smallTile: 2,
  lino: 3,
  wetConcrete: 4,
  metalGrid: 5,
};

export const VISUAL_SURFACE_WALL_BAND_CODES: Readonly<Record<VisualSurfaceWallBand, number>> = {
  none: 0,
  tileWainscot: 1,
  panelLower: 2,
  concreteBlocks: 3,
  serviceStrip: 4,
};

export const VISUAL_SURFACE_CEILING_PATTERN_CODES: Readonly<Record<VisualSurfaceCeilingPattern, number>> = {
  plain: 0,
  panelGrid: 1,
  servicePanels: 2,
  lowConcrete: 3,
  organicRibs: 4,
};

export const VISUAL_SURFACE_TRIM_CODES: Readonly<Record<VisualSurfaceTrim, number>> = {
  none: 0,
  baseboard: 1,
  concretePlinth: 2,
  metalRail: 3,
};

export const VISUAL_SURFACE_PROFILES: readonly VisualSurfaceProfile[] = [
  {
    id: 'plain_concrete',
    floorPattern: 'plain',
    wallBand: 'concreteBlocks',
    ceilingPattern: 'lowConcrete',
    trim: 'concretePlinth',
    grime: 0.24,
    seamStrength: 0.52,
    lightPanelChance: 0.025,
    ventChance: 0.035,
  },
  {
    id: 'residential_lino',
    floorPattern: 'lino',
    wallBand: 'panelLower',
    ceilingPattern: 'panelGrid',
    trim: 'baseboard',
    grime: 0.18,
    seamStrength: 0.45,
    lightPanelChance: 0.035,
    ventChance: 0.025,
  },
  {
    id: 'residential_tile',
    floorPattern: 'smallTile',
    wallBand: 'tileWainscot',
    ceilingPattern: 'panelGrid',
    trim: 'baseboard',
    grime: 0.22,
    seamStrength: 0.62,
    lightPanelChance: 0.045,
    ventChance: 0.035,
  },
  {
    id: 'ministry_checker',
    floorPattern: 'checker',
    wallBand: 'panelLower',
    ceilingPattern: 'panelGrid',
    trim: 'concretePlinth',
    grime: 0.14,
    seamStrength: 0.64,
    lightPanelChance: 0.055,
    ventChance: 0.025,
  },
  {
    id: 'maintenance_service',
    floorPattern: 'metalGrid',
    wallBand: 'serviceStrip',
    ceilingPattern: 'servicePanels',
    trim: 'metalRail',
    grime: 0.36,
    seamStrength: 0.78,
    lightPanelChance: 0.075,
    ventChance: 0.16,
  },
  {
    id: 'wet_utility',
    floorPattern: 'wetConcrete',
    wallBand: 'tileWainscot',
    ceilingPattern: 'servicePanels',
    trim: 'concretePlinth',
    grime: 0.34,
    seamStrength: 0.68,
    lightPanelChance: 0.04,
    ventChance: 0.08,
  },
  {
    id: 'hell_organic_surface',
    floorPattern: 'wetConcrete',
    wallBand: 'none',
    ceilingPattern: 'organicRibs',
    trim: 'none',
    grime: 0.42,
    seamStrength: 0.38,
    lightPanelChance: 0,
    ventChance: 0.015,
  },
  {
    id: 'void_proof_surface',
    floorPattern: 'plain',
    wallBand: 'none',
    ceilingPattern: 'plain',
    trim: 'none',
    grime: 0.1,
    seamStrength: 0.32,
    lightPanelChance: 0.015,
    ventChance: 0,
  },
];

export const VISUAL_SURFACE_PROFILE_ROWS: readonly VisualSurfaceProfileRow[] = [
  { id: 'global_plain_concrete', profileId: 'plain_concrete', priority: 0 },
  { id: 'story_living_residential', profileId: 'residential_lino', priority: 20, baseFloors: [FloorLevel.LIVING] },
  { id: 'story_kvartiry_residential', profileId: 'residential_lino', priority: 20, baseFloors: [FloorLevel.KVARTIRY] },
  { id: 'story_ministry_checker', profileId: 'ministry_checker', priority: 22, baseFloors: [FloorLevel.MINISTRY] },
  { id: 'story_maintenance_service', profileId: 'maintenance_service', priority: 22, baseFloors: [FloorLevel.MAINTENANCE] },
  { id: 'story_hell_organic', profileId: 'hell_organic_surface', priority: 24, baseFloors: [FloorLevel.HELL] },
  { id: 'story_void_proof', profileId: 'void_proof_surface', priority: 24, baseFloors: [FloorLevel.VOID] },

  { id: 'room_bathroom_tile', profileId: 'residential_tile', priority: 40, roomTypes: [RoomType.BATHROOM], blockedTags: ['meat', 'void'] },
  { id: 'room_kitchen_tile', profileId: 'residential_tile', priority: 38, roomTypes: [RoomType.KITCHEN], blockedTags: ['meat', 'void'] },
  { id: 'room_production_service', profileId: 'maintenance_service', priority: 42, roomTypes: [RoomType.PRODUCTION], blockedTags: ['meat', 'void'] },
  { id: 'room_medical_wet_utility', profileId: 'wet_utility', priority: 36, roomTypes: [RoomType.MEDICAL], blockedTags: ['void'] },
  { id: 'tag_industrial_service', profileId: 'maintenance_service', priority: 32, requiredTags: ['industrial'], blockedTags: ['meat', 'void'] },
  { id: 'tag_water_wet_utility', profileId: 'wet_utility', priority: 34, requiredTags: ['water'], blockedTags: ['void'] },
  { id: 'tag_documents_ministry', profileId: 'ministry_checker', priority: 28, requiredTags: ['documents'], blockedTags: ['meat', 'void'] },
  { id: 'tag_meat_organic', profileId: 'hell_organic_surface', priority: 46, requiredTags: ['meat'] },
  { id: 'tag_void_proof', profileId: 'void_proof_surface', priority: 46, requiredTags: ['void'] },

  { id: 'tex_floor_tile', profileId: 'residential_tile', priority: 50, floorTex: [Tex.F_TILE, Tex.F_MARBLE_TILE], blockedTags: ['meat', 'void'] },
  { id: 'tex_wall_tile', profileId: 'residential_tile', priority: 48, wallTex: [Tex.TILE_W], blockedTags: ['meat', 'void'] },
  { id: 'tex_pipe_service', profileId: 'maintenance_service', priority: 50, wallTex: [Tex.PIPE, Tex.METAL], blockedTags: ['meat', 'void'] },
  { id: 'tex_water_wet', profileId: 'wet_utility', priority: 52, floorTex: [Tex.F_WATER], blockedTags: ['void'] },
  { id: 'tex_meat_organic', profileId: 'hell_organic_surface', priority: 56, wallTex: [Tex.MEAT, Tex.GUT, Tex.LARVA_BODY], floorTex: [Tex.F_MEAT, Tex.F_GUT] },
  { id: 'tex_void_proof', profileId: 'void_proof_surface', priority: 56, wallTex: [Tex.VOID_WALL, Tex.DARK], floorTex: [Tex.F_VOID, Tex.F_ABYSS] },

  { id: 'danger_deep_concrete', profileId: 'plain_concrete', priority: 12, minDanger: 4 },
  { id: 'deep_route_service', profileId: 'maintenance_service', priority: 18, minAbsZ: 30, requiredTags: ['industrial'], blockedTags: ['meat', 'void'] },
];

export const EMPTY_RESOLVED_VISUAL_SURFACE_PROFILE: ResolvedVisualSurfaceProfile = {
  ...VISUAL_SURFACE_PROFILES[0],
  seed: 0,
  floorPatternCode: VISUAL_SURFACE_FLOOR_PATTERN_CODES[VISUAL_SURFACE_PROFILES[0].floorPattern],
  wallBandCode: VISUAL_SURFACE_WALL_BAND_CODES[VISUAL_SURFACE_PROFILES[0].wallBand],
  ceilingPatternCode: VISUAL_SURFACE_CEILING_PATTERN_CODES[VISUAL_SURFACE_PROFILES[0].ceilingPattern],
  trimCode: VISUAL_SURFACE_TRIM_CODES[VISUAL_SURFACE_PROFILES[0].trim],
  surfaceMaterialsEnabled: true,
  protrudingDressing: false,
};

const PROFILES_BY_ID = new Map<string, VisualSurfaceProfile>(VISUAL_SURFACE_PROFILES.map(profile => [profile.id, profile]));

function clamp01(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.max(0, Math.min(1, value));
}

function floorTag(floor: FloorLevel): string {
  return (FloorLevel[floor] ?? 'floor').toLowerCase();
}

function themeTags(theme: FloorThemeProfile): Set<string> {
  const tags = new Set<string>();
  tags.add(theme.kind);
  tags.add(`kind_${theme.kind}`);
  tags.add(floorTag(theme.themeClass));
  tags.add(`floor_${floorTag(theme.themeClass)}`);
  tags.add(`danger_${theme.danger}`);
  if (theme.routeId) tags.add(String(theme.routeId));
  if (theme.routeZ !== undefined) {
    const depth = Math.abs(theme.routeZ);
    if (depth >= 30) tags.add('deep_route');
    else if (depth >= 12) tags.add('mid_route');
    else tags.add('near_route');
  }
  for (const tag of theme.objectProfileTags) tags.add(tag);
  for (const tag of theme.monsterPressureTags) tags.add(tag);
  for (const tag of theme.economyTags) tags.add(tag);
  for (const tag of theme.specialContentTags) tags.add(tag);
  if (theme.themeClass === FloorLevel.HELL) tags.add('meat');
  if (theme.themeClass === FloorLevel.MINISTRY) tags.add('documents');
  if (theme.themeClass === FloorLevel.VOID) tags.add('void');
  if (theme.themeClass === FloorLevel.MAINTENANCE) {
    tags.add('industrial');
    tags.add('water');
  }
  return tags;
}

function hasAllTags(tags: ReadonlySet<string>, required: readonly string[] | undefined): boolean {
  if (!required || required.length === 0) return true;
  for (const tag of required) {
    if (!tags.has(tag)) return false;
  }
  return true;
}

function hasBlockedTag(tags: ReadonlySet<string>, blocked: readonly string[] | undefined): boolean {
  if (!blocked || blocked.length === 0) return false;
  for (const tag of blocked) {
    if (tags.has(tag)) return true;
  }
  return false;
}

function texMatches(rowTex: readonly Tex[] | undefined, tex: Tex | undefined): boolean {
  if (!rowTex) return true;
  return tex !== undefined && rowTex.includes(tex);
}

function rowMatches(
  row: VisualSurfaceProfileRow,
  theme: FloorThemeProfile,
  tags: ReadonlySet<string>,
  options: ResolveVisualSurfaceProfileOptions,
): boolean {
  if (row.kinds && !row.kinds.includes(theme.kind)) return false;
  if (row.baseFloors && !row.baseFloors.includes(theme.themeClass)) return false;
  if (row.routeIds && (!theme.routeId || !row.routeIds.includes(String(theme.routeId)))) return false;
  if (row.roomTypes && (options.roomType === undefined || !row.roomTypes.includes(options.roomType))) return false;
  if (!texMatches(row.wallTex, options.wallTex)) return false;
  if (!texMatches(row.floorTex, options.floorTex)) return false;
  if (row.minDanger !== undefined && theme.danger < row.minDanger) return false;
  if (row.maxDanger !== undefined && theme.danger > row.maxDanger) return false;
  const absZ = Math.abs(theme.routeZ ?? 0);
  if (row.minAbsZ !== undefined && absZ < row.minAbsZ) return false;
  if (row.maxAbsZ !== undefined && absZ > row.maxAbsZ) return false;
  return hasAllTags(tags, row.requiredTags) && !hasBlockedTag(tags, row.blockedTags);
}

export interface ResolveVisualSurfaceProfileOptions {
  seed?: number;
  roomId?: number;
  roomType?: RoomType;
  wallTex?: Tex;
  floorTex?: Tex;
  geometryMode?: VisualSurfaceGeometryMode;
}

function modeDetailScalar(mode: VisualSurfaceGeometryMode): number {
  switch (mode) {
    case 'off': return 0;
    case 'low': return 0.35;
    case 'medium': return 0.75;
    case 'high': return 1;
    default: return 0.75;
  }
}

export function visualSurfaceProfileById(id: string): VisualSurfaceProfile | undefined {
  return PROFILES_BY_ID.get(id);
}

export function resolveVisualSurfaceProfile(
  theme: FloorThemeProfile,
  options: ResolveVisualSurfaceProfileOptions = {},
): ResolvedVisualSurfaceProfile {
  const tags = themeTags(theme);
  let bestRow = VISUAL_SURFACE_PROFILE_ROWS[0];
  for (const row of VISUAL_SURFACE_PROFILE_ROWS) {
    if (!rowMatches(row, theme, tags, options)) continue;
    if (row.priority > bestRow.priority || (row.priority === bestRow.priority && row.id < bestRow.id)) bestRow = row;
  }
  const base = PROFILES_BY_ID.get(bestRow.profileId) ?? VISUAL_SURFACE_PROFILES[0];
  const seed = hashSeed(
    `visual-surface:${theme.floorKey}:${theme.routeZ ?? 0}:${base.id}:${options.roomId ?? -1}:${options.wallTex ?? -1}:${options.floorTex ?? -1}`,
    options.seed ?? 0,
  ) & 0xffff;
  const mode = options.geometryMode ?? 'medium';
  const detail = modeDetailScalar(mode);
  return {
    ...base,
    seed,
    grime: clamp01(base.grime),
    seamStrength: clamp01(base.seamStrength),
    lightPanelChance: clamp01(base.lightPanelChance * (0.45 + detail * 0.55)),
    ventChance: clamp01(base.ventChance * (0.35 + detail * 0.65)),
    floorPatternCode: VISUAL_SURFACE_FLOOR_PATTERN_CODES[base.floorPattern],
    wallBandCode: VISUAL_SURFACE_WALL_BAND_CODES[base.wallBand],
    ceilingPatternCode: VISUAL_SURFACE_CEILING_PATTERN_CODES[base.ceilingPattern],
    trimCode: VISUAL_SURFACE_TRIM_CODES[base.trim],
    surfaceMaterialsEnabled: true,
    protrudingDressing: mode === 'medium' || mode === 'high',
  };
}
