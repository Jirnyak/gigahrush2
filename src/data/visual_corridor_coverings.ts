export type VisualCorridorVolumeStyle = 'concrete' | 'service' | 'organic' | 'void';

export type VisualCorridorCoveringId =
  | 'concrete'
  | 'residential'
  | 'ministry'
  | 'technical'
  | 'collector'
  | 'cave'
  | 'meat'
  | 'void';

export type FloorScatterPackage = 'collector' | 'linoleum' | 'organic';
export type WallReliefSet = 'concrete' | 'technical' | 'organic' | 'pipe';

export interface VisualCorridorCoveringWeights {
  relief: number;
  ledge: number;
  threshold: number;
  pipe: number;
  cable: number;
  gutter: number;
  stalactite: number;
  bulge: number;
  fold: number;
}

export interface VisualCorridorCoveringDef {
  id: VisualCorridorCoveringId;
  style: VisualCorridorVolumeStyle;
  detailMul: number;
  organicMul: number;
  smoothness: number;
  floorScatter?: FloorScatterPackage;
  wallReliefSet?: WallReliefSet;
  weights: VisualCorridorCoveringWeights;
}

export interface VisualCorridorCoveringRule {
  id: string;
  coveringId: VisualCorridorCoveringId;
  priority: number;
  floorKeys?: readonly string[];
  requiredTags?: readonly string[];
  blockedTags?: readonly string[];
}

export const VISUAL_CORRIDOR_COVERINGS: readonly VisualCorridorCoveringDef[] = [
  {
    id: 'concrete',
    style: 'concrete',
    detailMul: 1,
    organicMul: 0.25,
    smoothness: 0.22,
    wallReliefSet: 'concrete',
    weights: {
      relief: 0.46,
      ledge: 0.22,
      threshold: 0.24,
      pipe: 0.04,
      cable: 0.04,
      gutter: 0,
      stalactite: 0,
      bulge: 0,
      fold: 0,
    },
  },
  {
    id: 'residential',
    style: 'concrete',
    detailMul: 1,
    organicMul: 0.15,
    smoothness: 0.28,
    floorScatter: 'linoleum',
    wallReliefSet: 'concrete',
    weights: {
      relief: 0.46,
      ledge: 0.26,
      threshold: 0.24,
      pipe: 0.06,
      cable: 0.04,
      gutter: 0,
      stalactite: 0,
      bulge: 0,
      fold: 0,
    },
  },
  {
    id: 'ministry',
    style: 'concrete',
    detailMul: 1,
    organicMul: 0.15,
    smoothness: 0.32,
    wallReliefSet: 'concrete',
    weights: {
      relief: 0.46,
      ledge: 0.22,
      threshold: 0.24,
      pipe: 0,
      cable: 0,
      gutter: 0,
      stalactite: 0,
      bulge: 0,
      fold: 0,
    },
  },
  {
    id: 'technical',
    style: 'service',
    detailMul: 1.18,
    organicMul: 0.12,
    smoothness: 0.16,
    wallReliefSet: 'technical',
    weights: {
      relief: 0.25,
      ledge: 0.14,
      threshold: 0.16,
      pipe: 0.26,
      cable: 0.19,
      gutter: 0,
      stalactite: 0,
      bulge: 0,
      fold: 0,
    },
  },
  {
    id: 'collector',
    style: 'service',
    detailMul: 1.42,
    organicMul: 0.08,
    smoothness: 0.12,
    floorScatter: 'collector',
    wallReliefSet: 'pipe',
    weights: {
      relief: 0,
      ledge: 0.1,
      threshold: 0.1,
      pipe: 0.44,
      cable: 0.1,
      gutter: 0.34,
      stalactite: 0,
      bulge: 0,
      fold: 0,
    },
  },
  {
    id: 'cave',
    style: 'organic',
    detailMul: 1.22,
    organicMul: 1.1,
    smoothness: 0.38,
    floorScatter: 'organic',
    wallReliefSet: 'organic',
    weights: {
      relief: 0,
      ledge: 0,
      threshold: 0.08,
      pipe: 0,
      cable: 0,
      gutter: 0,
      stalactite: 0.4,
      bulge: 0.52,
      fold: 0,
    },
  },
  {
    id: 'meat',
    style: 'organic',
    detailMul: 1.24,
    organicMul: 2,
    smoothness: 0.78,
    floorScatter: 'organic',
    wallReliefSet: 'organic',
    weights: {
      relief: 0,
      ledge: 0,
      threshold: 0.05,
      pipe: 0,
      cable: 0,
      gutter: 0,
      stalactite: 0.18,
      bulge: 0.2,
      fold: 0.82,
    },
  },
  {
    id: 'void',
    style: 'void',
    detailMul: 0.65,
    organicMul: 0.18,
    smoothness: 0.52,
    wallReliefSet: 'concrete',
    weights: {
      relief: 0.38,
      ledge: 0.12,
      threshold: 0.1,
      pipe: 0.04,
      cable: 0.18,
      gutter: 0,
      stalactite: 0,
      bulge: 0.18,
      fold: 0,
    },
  },
] as const;

export const VISUAL_CORRIDOR_COVERING_RULES: readonly VisualCorridorCoveringRule[] = [
  { id: 'story_void', coveringId: 'void', priority: 100, requiredTags: ['void'] },
  { id: 'finale_void', coveringId: 'void', priority: 98, requiredTags: ['finale'] },
  { id: 'story_meat', coveringId: 'meat', priority: 92, requiredTags: ['meat'] },
  { id: 'samosbor_meat', coveringId: 'meat', priority: 90, requiredTags: ['samosbor'] },
  { id: 'hell_meat', coveringId: 'meat', priority: 88, requiredTags: ['hell'] },
  { id: 'underhell_meat', coveringId: 'meat', priority: 84, requiredTags: ['underhell'] },
  { id: 'meat_low_meat', coveringId: 'meat', priority: 82, requiredTags: ['meat_low'] },
  { id: 'living_tunnel_cave', coveringId: 'cave', priority: 86, requiredTags: ['living_tunnels'] },
  { id: 'mycelium_cave', coveringId: 'cave', priority: 78, requiredTags: ['mushroom'] },
  { id: 'collector_geometry', coveringId: 'collector', priority: 74, requiredTags: ['collectors'] },
  { id: 'sump_collector', coveringId: 'collector', priority: 72, requiredTags: ['sump'] },
  { id: 'blackwater_collector', coveringId: 'collector', priority: 70, requiredTags: ['blackwater'] },
  { id: 'service_spines_technical', coveringId: 'technical', priority: 66, requiredTags: ['service'] },
  { id: 'power_technical', coveringId: 'technical', priority: 64, requiredTags: ['power'] },
  { id: 'workshop_technical', coveringId: 'technical', priority: 62, requiredTags: ['workshop'] },
  { id: 'industrial_technical', coveringId: 'technical', priority: 58, requiredTags: ['industrial'], blockedTags: ['collectors', 'sump', 'blackwater'] },
  { id: 'residential', coveringId: 'residential', priority: 50, requiredTags: ['residential'] },
  { id: 'ministry', coveringId: 'ministry', priority: 48, requiredTags: ['ministry'] },
] as const;

const VISUAL_CORRIDOR_COVERING_BY_ID = new Map<VisualCorridorCoveringId, VisualCorridorCoveringDef>(
  VISUAL_CORRIDOR_COVERINGS.map(def => [def.id, def]),
);

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

export function visualCorridorCoveringById(id: VisualCorridorCoveringId | string | undefined): VisualCorridorCoveringDef {
  return VISUAL_CORRIDOR_COVERING_BY_ID.get((id ?? 'concrete') as VisualCorridorCoveringId) ?? VISUAL_CORRIDOR_COVERING_BY_ID.get('concrete')!;
}

export function selectVisualCorridorCovering(
  floorKey: string,
  tagsInput: readonly string[],
): { def: VisualCorridorCoveringDef; ruleId: string } {
  const tags = new Set(tagsInput);
  let best: VisualCorridorCoveringRule | undefined;
  for (const rule of VISUAL_CORRIDOR_COVERING_RULES) {
    if (rule.floorKeys && !rule.floorKeys.includes(floorKey)) continue;
    if (!hasAllTags(tags, rule.requiredTags) || hasBlockedTag(tags, rule.blockedTags)) continue;
    if (!best || rule.priority > best.priority) best = rule;
  }
  const coveringId = best?.coveringId ?? 'concrete';
  return { def: visualCorridorCoveringById(coveringId), ruleId: best?.id ?? 'default_concrete' };
}
