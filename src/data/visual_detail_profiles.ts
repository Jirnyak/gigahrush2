import { FloorLevel, RoomType, Tex } from '../core/types';
import { hashSeed } from '../core/rand';
import type { FloorThemeProfile } from './floor_theme_profiles';

export const VISUAL_DETAIL_MAX_ACTIVE_FAMILIES = 8;
export const VISUAL_DETAIL_MAX_FLOOR_FAMILIES = 2;
export const VISUAL_DETAIL_MAX_WALL_FAMILIES = 2;
export const VISUAL_DETAIL_LIGHT_DUST_DENSITY_CAP = 24;

export type VisualDetailSurface = 'floor' | 'wall' | 'ceiling' | 'light_volume';

export type VisualDetailFamilyId =
  | 'paper_scraps'
  | 'newspaper_bits'
  | 'crumbs'
  | 'floor_dust'
  | 'wall_cracks'
  | 'chipped_concrete'
  | 'cobweb_corner'
  | 'rust_grit'
  | 'wet_dirt'
  | 'bone_crumbs'
  | 'gut_threads'
  | 'proof_specks'
  | 'light_dust';

export type VisualDetailId = VisualDetailFamilyId;

export interface VisualDetailRule {
  id: VisualDetailId;
  family: VisualDetailFamilyId;
  surfaces: readonly VisualDetailSurface[];
  density: number;
  scale: readonly [number, number];
  colorBand: readonly [number, number, number];
  roomTypeWeights?: Partial<Record<RoomType, number>>;
  texWeights?: Partial<Record<Tex, number>>;
  requiredTags?: readonly string[];
  blockedTags?: readonly string[];
  lightRange?: readonly [number, number];
  seedSalt: number;
}

export interface VisualDetailProfileRow {
  id: string;
  detailId: VisualDetailId;
  density: number;
  kinds?: readonly FloorThemeProfile['kind'][];
  baseFloors?: readonly FloorLevel[];
  routeIds?: readonly string[];
  requiredTags?: readonly string[];
  blockedTags?: readonly string[];
  minDanger?: number;
  maxDanger?: number;
  minAbsZ?: number;
  maxAbsZ?: number;
}

export interface ResolvedVisualDetailFamily {
  id: VisualDetailId;
  family: VisualDetailFamilyId;
  familyCode: number;
  surfaces: readonly VisualDetailSurface[];
  density: number;
  scale: number;
  color: readonly [number, number, number];
  seed: number;
}

export interface ResolvedVisualDetailProfile {
  key: string;
  seed: number;
  activeFamilies: readonly ResolvedVisualDetailFamily[];
  floorFamilies: readonly ResolvedVisualDetailFamily[];
  wallFamilies: readonly ResolvedVisualDetailFamily[];
  lightDust?: ResolvedVisualDetailFamily;
}

export const VISUAL_DETAIL_FAMILY_CODES: Readonly<Record<VisualDetailFamilyId, number>> = {
  paper_scraps: 1,
  newspaper_bits: 2,
  crumbs: 3,
  floor_dust: 4,
  wall_cracks: 5,
  chipped_concrete: 6,
  cobweb_corner: 7,
  rust_grit: 8,
  wet_dirt: 9,
  bone_crumbs: 10,
  gut_threads: 11,
  proof_specks: 12,
  light_dust: 13,
};

export const EMPTY_RESOLVED_VISUAL_DETAIL_PROFILE: ResolvedVisualDetailProfile = {
  key: 'empty',
  seed: 0,
  activeFamilies: [],
  floorFamilies: [],
  wallFamilies: [],
};

export const VISUAL_DETAIL_RULES: readonly VisualDetailRule[] = [
  {
    id: 'paper_scraps',
    family: 'paper_scraps',
    surfaces: ['floor'],
    density: 0,
    scale: [0.75, 1.35],
    colorBand: [158, 149, 120],
    roomTypeWeights: {
      [RoomType.CORRIDOR]: 1.15,
      [RoomType.OFFICE]: 1.35,
      [RoomType.STORAGE]: 1.2,
      [RoomType.COMMON]: 0.9,
    },
    texWeights: {
      [Tex.F_LINO]: 1.25,
      [Tex.F_PARQUET]: 1.15,
      [Tex.F_CONCRETE]: 0.8,
    },
    blockedTags: ['meat', 'void'],
    seedSalt: 101,
  },
  {
    id: 'newspaper_bits',
    family: 'newspaper_bits',
    surfaces: ['floor'],
    density: 0,
    scale: [0.65, 1.1],
    colorBand: [116, 119, 104],
    roomTypeWeights: {
      [RoomType.OFFICE]: 1.45,
      [RoomType.STORAGE]: 1.25,
      [RoomType.SMOKING]: 1.1,
    },
    texWeights: {
      [Tex.F_PARQUET]: 1.3,
      [Tex.F_LINO]: 1.1,
    },
    blockedTags: ['meat'],
    seedSalt: 137,
  },
  {
    id: 'crumbs',
    family: 'crumbs',
    surfaces: ['floor'],
    density: 0,
    scale: [0.45, 0.95],
    colorBand: [134, 118, 77],
    roomTypeWeights: {
      [RoomType.KITCHEN]: 1.5,
      [RoomType.LIVING]: 1.1,
      [RoomType.COMMON]: 1.0,
    },
    texWeights: {
      [Tex.F_LINO]: 1.2,
      [Tex.F_TILE]: 1.0,
      [Tex.F_WOOD]: 0.9,
    },
    blockedTags: ['void', 'meat'],
    seedSalt: 163,
  },
  {
    id: 'floor_dust',
    family: 'floor_dust',
    surfaces: ['floor'],
    density: 4,
    scale: [0.9, 1.8],
    colorBand: [104, 101, 90],
    texWeights: {
      [Tex.F_CONCRETE]: 1.25,
      [Tex.F_LINO]: 0.95,
      [Tex.F_PARQUET]: 0.85,
    },
    seedSalt: 191,
  },
  {
    id: 'wall_cracks',
    family: 'wall_cracks',
    surfaces: ['wall'],
    density: 5,
    scale: [0.8, 1.65],
    colorBand: [50, 49, 45],
    texWeights: {
      [Tex.CONCRETE]: 1.3,
      [Tex.PANEL]: 1.0,
      [Tex.BRICK]: 0.9,
      [Tex.MARBLE]: 0.65,
    },
    seedSalt: 223,
  },
  {
    id: 'chipped_concrete',
    family: 'chipped_concrete',
    surfaces: ['floor', 'wall'],
    density: 4,
    scale: [0.7, 1.45],
    colorBand: [127, 125, 111],
    texWeights: {
      [Tex.CONCRETE]: 1.35,
      [Tex.PANEL]: 0.95,
      [Tex.F_CONCRETE]: 1.25,
      [Tex.METAL]: 0.6,
    },
    seedSalt: 251,
  },
  {
    id: 'cobweb_corner',
    family: 'cobweb_corner',
    surfaces: ['wall', 'ceiling'],
    density: 0,
    scale: [0.65, 1.2],
    colorBand: [171, 177, 158],
    roomTypeWeights: {
      [RoomType.STORAGE]: 1.45,
      [RoomType.CORRIDOR]: 1.1,
      [RoomType.SMOKING]: 1.0,
    },
    blockedTags: ['water', 'meat', 'void'],
    seedSalt: 283,
  },
  {
    id: 'rust_grit',
    family: 'rust_grit',
    surfaces: ['floor', 'wall'],
    density: 0,
    scale: [0.55, 1.25],
    colorBand: [126, 77, 42],
    texWeights: {
      [Tex.METAL]: 1.45,
      [Tex.PIPE]: 1.45,
      [Tex.F_CONCRETE]: 0.9,
    },
    requiredTags: ['industrial'],
    blockedTags: ['void'],
    seedSalt: 317,
  },
  {
    id: 'wet_dirt',
    family: 'wet_dirt',
    surfaces: ['floor'],
    density: 0,
    scale: [0.75, 1.55],
    colorBand: [48, 54, 45],
    roomTypeWeights: {
      [RoomType.BATHROOM]: 1.4,
      [RoomType.PRODUCTION]: 1.15,
      [RoomType.CORRIDOR]: 1.0,
    },
    texWeights: {
      [Tex.F_CONCRETE]: 1.3,
      [Tex.F_TILE]: 1.1,
      [Tex.F_WATER]: 1.2,
    },
    requiredTags: ['water'],
    blockedTags: ['void'],
    seedSalt: 349,
  },
  {
    id: 'bone_crumbs',
    family: 'bone_crumbs',
    surfaces: ['floor'],
    density: 0,
    scale: [0.45, 0.95],
    colorBand: [171, 156, 121],
    texWeights: {
      [Tex.F_MEAT]: 1.15,
      [Tex.F_GUT]: 1.05,
      [Tex.F_CONCRETE]: 0.85,
    },
    requiredTags: ['meat'],
    blockedTags: ['proof'],
    seedSalt: 383,
  },
  {
    id: 'gut_threads',
    family: 'gut_threads',
    surfaces: ['floor', 'wall'],
    density: 0,
    scale: [0.65, 1.3],
    colorBand: [121, 40, 39],
    texWeights: {
      [Tex.MEAT]: 1.35,
      [Tex.GUT]: 1.45,
      [Tex.F_MEAT]: 1.2,
      [Tex.F_GUT]: 1.35,
    },
    requiredTags: ['meat'],
    blockedTags: ['proof'],
    seedSalt: 419,
  },
  {
    id: 'proof_specks',
    family: 'proof_specks',
    surfaces: ['floor', 'wall'],
    density: 0,
    scale: [0.45, 1.0],
    colorBand: [88, 197, 143],
    texWeights: {
      [Tex.VOID_WALL]: 1.45,
      [Tex.F_VOID]: 1.45,
      [Tex.DARK]: 1.1,
    },
    requiredTags: ['proof'],
    blockedTags: ['meat'],
    seedSalt: 443,
  },
  {
    id: 'light_dust',
    family: 'light_dust',
    surfaces: ['light_volume'],
    density: 3,
    scale: [0.45, 0.9],
    colorBand: [177, 185, 148],
    lightRange: [0.35, 1.0],
    seedSalt: 467,
  },
];

export const VISUAL_DETAIL_PROFILE_ROWS: readonly VisualDetailProfileRow[] = [
  { id: 'global_floor_dust', detailId: 'floor_dust', density: 6 },
  { id: 'global_wall_cracks', detailId: 'wall_cracks', density: 4 },
  { id: 'global_chipped_concrete', detailId: 'chipped_concrete', density: 3 },
  { id: 'global_light_dust', detailId: 'light_dust', density: 3 },

  { id: 'story_living_papers', detailId: 'paper_scraps', density: 12, baseFloors: [FloorLevel.LIVING] },
  { id: 'story_living_crumbs', detailId: 'crumbs', density: 10, baseFloors: [FloorLevel.LIVING] },
  { id: 'story_living_cobweb', detailId: 'cobweb_corner', density: 5, baseFloors: [FloorLevel.LIVING] },

  { id: 'story_kvartiry_papers', detailId: 'paper_scraps', density: 12, baseFloors: [FloorLevel.KVARTIRY] },
  { id: 'story_kvartiry_crumbs', detailId: 'crumbs', density: 11, baseFloors: [FloorLevel.KVARTIRY] },
  { id: 'story_kvartiry_cobweb', detailId: 'cobweb_corner', density: 6, baseFloors: [FloorLevel.KVARTIRY] },

  { id: 'story_ministry_papers', detailId: 'paper_scraps', density: 14, baseFloors: [FloorLevel.MINISTRY] },
  { id: 'story_ministry_newsprint', detailId: 'newspaper_bits', density: 10, baseFloors: [FloorLevel.MINISTRY], requiredTags: ['documents'] },
  { id: 'story_ministry_cracks', detailId: 'wall_cracks', density: 7, baseFloors: [FloorLevel.MINISTRY] },

  { id: 'story_maintenance_rust', detailId: 'rust_grit', density: 15, baseFloors: [FloorLevel.MAINTENANCE], requiredTags: ['industrial'] },
  { id: 'story_maintenance_wet', detailId: 'wet_dirt', density: 12, baseFloors: [FloorLevel.MAINTENANCE], requiredTags: ['water'] },
  { id: 'story_maintenance_light_dust', detailId: 'light_dust', density: 5, baseFloors: [FloorLevel.MAINTENANCE] },

  { id: 'story_hell_bone', detailId: 'bone_crumbs', density: 15, baseFloors: [FloorLevel.HELL], requiredTags: ['meat'] },
  { id: 'story_hell_gut', detailId: 'gut_threads', density: 12, baseFloors: [FloorLevel.HELL], requiredTags: ['meat'] },
  { id: 'story_hell_wet', detailId: 'wet_dirt', density: 5, baseFloors: [FloorLevel.HELL], blockedTags: ['void'] },

  { id: 'story_void_proof', detailId: 'proof_specks', density: 17, baseFloors: [FloorLevel.VOID], requiredTags: ['void'] },
  { id: 'story_void_light_dust', detailId: 'light_dust', density: 6, baseFloors: [FloorLevel.VOID] },

  { id: 'tag_residential_papers', detailId: 'paper_scraps', density: 6, requiredTags: ['residential'] },
  { id: 'tag_civil_crumbs', detailId: 'crumbs', density: 5, requiredTags: ['civil'] },
  { id: 'tag_documents_newsprint', detailId: 'newspaper_bits', density: 7, requiredTags: ['documents'] },
  { id: 'tag_archive_paper_dust', detailId: 'floor_dust', density: 5, requiredTags: ['archive'] },
  { id: 'tag_admin_cracks', detailId: 'wall_cracks', density: 4, requiredTags: ['admin'] },
  { id: 'tag_industrial_rust', detailId: 'rust_grit', density: 12, requiredTags: ['industrial'] },
  { id: 'tag_water_wet_dirt', detailId: 'wet_dirt', density: 10, requiredTags: ['water'] },
  { id: 'tag_sump_wet_dirt', detailId: 'wet_dirt', density: 8, requiredTags: ['sump'] },
  { id: 'tag_samosbor_bone', detailId: 'bone_crumbs', density: 8, requiredTags: ['samosbor'] },
  { id: 'tag_meat_gut', detailId: 'gut_threads', density: 9, requiredTags: ['meat'] },
  { id: 'tag_cult_bone', detailId: 'bone_crumbs', density: 5, requiredTags: ['cult'], blockedTags: ['void'] },
  { id: 'tag_void_proof', detailId: 'proof_specks', density: 14, requiredTags: ['void'] },
  { id: 'tag_lab_proof', detailId: 'proof_specks', density: 4, requiredTags: ['lab'], blockedTags: ['meat'] },
  { id: 'tag_quarantine_wet', detailId: 'wet_dirt', density: 4, requiredTags: ['quarantine'], blockedTags: ['void'] },

  { id: 'danger_four_chips', detailId: 'chipped_concrete', density: 5, minDanger: 4 },
  { id: 'danger_five_cracks', detailId: 'wall_cracks', density: 5, minDanger: 5 },
  { id: 'deep_route_light_dust', detailId: 'light_dust', density: 4, minAbsZ: 30 },

  { id: 'route_silicon_net_well_proof', detailId: 'proof_specks', density: 8, routeIds: ['silicon_net_well'] },
  { id: 'route_bolnichny_korpus_wet', detailId: 'wet_dirt', density: 6, routeIds: ['bolnichny_korpus'] },
  { id: 'route_black_market_88_crumbs', detailId: 'crumbs', density: 7, routeIds: ['black_market_88'] },
  { id: 'route_production_belt_rust', detailId: 'rust_grit', density: 8, routeIds: ['production_belt'] },
  { id: 'route_underhell_bone', detailId: 'bone_crumbs', density: 7, routeIds: ['underhell', 'podad'] },
  { id: 'route_cantor_pustoty_proof', detailId: 'proof_specks', density: 8, routeIds: ['cantor_pustoty', 'darkness'] },
];

const RULES_BY_ID = new Map<VisualDetailId, VisualDetailRule>(VISUAL_DETAIL_RULES.map(rule => [rule.id, rule]));

function clampByte(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.max(0, Math.min(255, Math.round(value)));
}

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
  if (theme.themeClass === FloorLevel.VOID) {
    tags.add('void');
    tags.add('proof');
  }
  if (theme.themeClass === FloorLevel.MAINTENANCE) {
    tags.add('industrial');
    tags.add('water');
  }
  if (tags.has('silicon_net_well') || tags.has('net')) tags.add('proof');
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

function rowMatches(row: VisualDetailProfileRow, theme: FloorThemeProfile, tags: ReadonlySet<string>): boolean {
  if (row.kinds && !row.kinds.includes(theme.kind)) return false;
  if (row.baseFloors && !row.baseFloors.includes(theme.themeClass)) return false;
  if (row.routeIds && (!theme.routeId || !row.routeIds.includes(String(theme.routeId)))) return false;
  if (row.minDanger !== undefined && theme.danger < row.minDanger) return false;
  if (row.maxDanger !== undefined && theme.danger > row.maxDanger) return false;
  const absZ = Math.abs(theme.routeZ ?? 0);
  if (row.minAbsZ !== undefined && absZ < row.minAbsZ) return false;
  if (row.maxAbsZ !== undefined && absZ > row.maxAbsZ) return false;
  return hasAllTags(tags, row.requiredTags) && !hasBlockedTag(tags, row.blockedTags);
}

function ruleAllowed(rule: VisualDetailRule, tags: ReadonlySet<string>): boolean {
  return hasAllTags(tags, rule.requiredTags) && !hasBlockedTag(tags, rule.blockedTags);
}

function scaleMid(scale: readonly [number, number]): number {
  return Math.max(0.1, Math.min(4, (scale[0] + scale[1]) * 0.5));
}

function resolvedSeed(theme: FloorThemeProfile, rule: VisualDetailRule, seed: number): number {
  return hashSeed(`${theme.floorKey}:${theme.routeZ ?? 0}:${rule.id}:${rule.seedSalt}`, seed) & 0xffff;
}

export function visualDetailRuleById(id: VisualDetailId): VisualDetailRule | undefined {
  return RULES_BY_ID.get(id);
}

export function resolveVisualDetailProfile(
  theme: FloorThemeProfile,
  options: { seed?: number } = {},
): ResolvedVisualDetailProfile {
  const tags = themeTags(theme);
  const seed = hashSeed(`visual-detail:${theme.floorKey}:${theme.routeZ ?? 0}`, options.seed ?? 0);
  const densities = new Map<VisualDetailId, number>();

  for (const rule of VISUAL_DETAIL_RULES) {
    if (!ruleAllowed(rule, tags)) continue;
    const density = clampByte(rule.id === 'light_dust'
      ? Math.min(rule.density, VISUAL_DETAIL_LIGHT_DUST_DENSITY_CAP)
      : rule.density);
    if (density > 0) densities.set(rule.id, density);
  }

  for (const row of VISUAL_DETAIL_PROFILE_ROWS) {
    const rule = RULES_BY_ID.get(row.detailId);
    if (!rule || !rowMatches(row, theme, tags) || !ruleAllowed(rule, tags)) continue;
    const current = densities.get(row.detailId) ?? 0;
    const next = row.detailId === 'light_dust'
      ? Math.min(current + row.density, VISUAL_DETAIL_LIGHT_DUST_DENSITY_CAP)
      : current + row.density;
    densities.set(row.detailId, clampByte(next));
  }

  const active = [...densities.entries()]
    .map(([id, density]): ResolvedVisualDetailFamily | undefined => {
      const rule = RULES_BY_ID.get(id);
      if (!rule || density <= 0) return undefined;
      return {
        id,
        family: rule.family,
        familyCode: VISUAL_DETAIL_FAMILY_CODES[rule.family],
        surfaces: rule.surfaces,
        density: clampByte(density),
        scale: scaleMid(rule.scale),
        color: [
          clampByte(rule.colorBand[0]),
          clampByte(rule.colorBand[1]),
          clampByte(rule.colorBand[2]),
        ],
        seed: resolvedSeed(theme, rule, seed),
      };
    })
    .filter((family): family is ResolvedVisualDetailFamily => !!family)
    .sort((a, b) => b.density - a.density || a.id.localeCompare(b.id))
    .slice(0, VISUAL_DETAIL_MAX_ACTIVE_FAMILIES);

  return {
    key: theme.floorKey,
    seed,
    activeFamilies: active,
    floorFamilies: active
      .filter(row => row.surfaces.includes('floor'))
      .slice(0, VISUAL_DETAIL_MAX_FLOOR_FAMILIES),
    wallFamilies: active
      .filter(row => row.surfaces.includes('wall') || row.surfaces.includes('ceiling'))
      .slice(0, VISUAL_DETAIL_MAX_WALL_FAMILIES),
    lightDust: active.find(row => row.id === 'light_dust' && row.surfaces.includes('light_volume')),
  };
}

export function visualDetailDensity01(row: ResolvedVisualDetailFamily | undefined): number {
  if (!row) return 0;
  return clamp01(row.density / 255);
}
