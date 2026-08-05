import { FloorLevel, type TerritoryOwner } from '../core/types';
import { floorObjectProfileForDesignFloor, floorObjectProfileForProceduralFloor, floorObjectProfileForStoryFloor } from './floor_object_placement';
import { designFloorPopulationProfile } from './design_floor_population';
import {
  DESIGN_FLOOR_ROUTES,
  designFloorThemeClass,
  type DesignFloorId,
  type DesignFloorRouteDef,
} from './design_floors';
import {
  anomalyById,
  floorRunZAllowsNpcs,
  majorityById,
  proceduralFloorMonsterBiasTags,
  zForStoryFloor,
  type ProceduralFloorSpec,
} from './procedural_floors';
import {
  proceduralPopulationProfileId,
} from './population_profiles';
import {
  territorySharesForDesignFloor,
  territorySharesForProceduralSpec,
  territorySharesForStoryFloor,
  type FloorTerritoryShare,
} from './floor_territory';

export interface FloorThemeProfile {
  floorKey: string;
  baseFloor: FloorLevel;
  /**
   * Content/visual/population class. Equals `baseFloor` for story/procedural
   * floors and for design floors that do not override it, but a design floor
   * can declare a different `themeClass` to own its look and population mix
   * independently of the engine save bucket (`baseFloor`).
   */
  themeClass: FloorLevel;
  routeId?: DesignFloorId | string;
  routeZ?: number;
  kind: 'story' | 'design' | 'procedural' | 'floor_instance';
  danger: 1 | 2 | 3 | 4 | 5;
  npcAllowed: boolean;
  territoryShares: readonly FloorTerritoryShare[];
  populationProfileId?: string;
  majorityOwner?: TerritoryOwner;
  objectProfileTags: readonly string[];
  monsterPressureTags: readonly string[];
  economyTags: readonly string[];
  specialContentTags: readonly string[];
}

const STORY_KEY_IDS: Readonly<Record<FloorLevel, string>> = {
  [FloorLevel.MINISTRY]: 'ministry',
  [FloorLevel.KVARTIRY]: 'kvartiry',
  [FloorLevel.LIVING]: 'living',
  [FloorLevel.MAINTENANCE]: 'maintenance',
  [FloorLevel.HELL]: 'hell',
  [FloorLevel.VOID]: 'void',
};

const STORY_DANGER: Readonly<Record<FloorLevel, 1 | 2 | 3 | 4 | 5>> = {
  [FloorLevel.MINISTRY]: 3,
  [FloorLevel.KVARTIRY]: 3,
  [FloorLevel.LIVING]: 1,
  [FloorLevel.MAINTENANCE]: 4,
  [FloorLevel.HELL]: 5,
  [FloorLevel.VOID]: 5,
};

const STORY_POPULATION_PROFILE_IDS: Partial<Record<FloorLevel, string>> = {
  [FloorLevel.KVARTIRY]: 'kvartiry_lively',
  [FloorLevel.HELL]: 'hell_lively',
  [FloorLevel.VOID]: 'void_lively',
};

const STORY_SPECIAL_TAGS: Readonly<Record<FloorLevel, readonly string[]>> = {
  [FloorLevel.MINISTRY]: ['story_floor', 'bureaucracy', 'permits'],
  [FloorLevel.KVARTIRY]: ['story_floor', 'residential', 'uprising'],
  [FloorLevel.LIVING]: ['story_floor', 'hub', 'expedition_prep'],
  [FloorLevel.MAINTENANCE]: ['story_floor', 'repair', 'collectors'],
  [FloorLevel.HELL]: ['story_floor', 'samosbor', 'cult'],
  [FloorLevel.VOID]: ['story_floor', 'finale', 'void'],
};

function storyFloorKey(floor: FloorLevel): string {
  return `story:${STORY_KEY_IDS[floor] ?? String(floor)}`;
}

function designFloorKey(id: DesignFloorId | string): string {
  return `design:${id}`;
}

function proceduralFloorKey(key: string): string {
  return `procedural:${key}`;
}

function uniqueTags(values: readonly string[]): readonly string[] {
  const out: string[] = [];
  for (const value of values) {
    if (value && !out.includes(value)) out.push(value);
  }
  return out;
}

function nonEmptyTags(values: readonly string[] | undefined): readonly string[] {
  return values && values.length > 0 ? values : [];
}

export function themeForStoryFloor(floor: FloorLevel): FloorThemeProfile {
  const z = zForStoryFloor(floor);
  const objectProfile = floorObjectProfileForStoryFloor(floor);
  const territoryShares = territorySharesForStoryFloor(floor);
  return {
    floorKey: storyFloorKey(floor),
    baseFloor: floor,
    themeClass: floor,
    routeZ: z,
    kind: 'story',
    danger: STORY_DANGER[floor],
    npcAllowed: floorRunZAllowsNpcs(z),
    territoryShares,
    populationProfileId: STORY_POPULATION_PROFILE_IDS[floor],
    majorityOwner: dominantTerritoryShareOwner(territoryShares),
    objectProfileTags: nonEmptyTags(objectProfile?.tags),
    monsterPressureTags: floor === FloorLevel.HELL || floor === FloorLevel.VOID ? ['samosbor', 'void', 'route_pressure'] : [],
    economyTags: uniqueTags([FloorLevel[floor]?.toLowerCase() ?? 'story', ...(objectProfile?.tags ?? [])]),
    specialContentTags: STORY_SPECIAL_TAGS[floor],
  };
}

export function themeForDesignFloor(id: DesignFloorId, route = DESIGN_FLOOR_ROUTES.find(def => def.id === id)): FloorThemeProfile {
  if (!route) throw new Error(`Unknown design floor route: ${id}`);
  return themeForDesignRoute(route);
}

export function themeForDesignRoute(route: DesignFloorRouteDef): FloorThemeProfile {
  const population = designFloorPopulationProfile(route);
  const objectProfile = floorObjectProfileForDesignFloor(route);
  const territoryShares = territorySharesForDesignFloor(route.id);
  const themeClass = designFloorThemeClass(route);
  return {
    floorKey: designFloorKey(route.id),
    baseFloor: route.baseFloor,
    themeClass,
    routeId: route.id,
    routeZ: route.z,
    kind: 'design',
    danger: route.danger,
    npcAllowed: floorRunZAllowsNpcs(route.z),
    territoryShares,
    populationProfileId: `design:${population.routeId}`,
    majorityOwner: dominantTerritoryShareOwner(territoryShares),
    objectProfileTags: nonEmptyTags(objectProfile?.tags),
    monsterPressureTags: uniqueTags(population.monsterTags),
    economyTags: uniqueTags([route.id, FloorLevel[themeClass]?.toLowerCase() ?? 'design', ...(objectProfile?.tags ?? [])]),
    specialContentTags: uniqueTags([route.id, `danger_${route.danger}`]),
  };
}

export function themeForProceduralSpec(spec: ProceduralFloorSpec): FloorThemeProfile {
  const majority = majorityById(spec.majorityId);
  const anomaly = anomalyById(spec.anomalyId);
  const objectProfile = floorObjectProfileForProceduralFloor(spec);
  const populationProfile = proceduralPopulationProfileId(spec.anomalyId);
  const territoryShares = territorySharesForProceduralSpec(spec);
  return {
    floorKey: proceduralFloorKey(spec.key),
    baseFloor: spec.baseFloor,
    themeClass: spec.baseFloor,
    routeId: spec.key,
    routeZ: spec.z,
    kind: 'procedural',
    danger: spec.danger,
    npcAllowed: floorRunZAllowsNpcs(spec.z),
    territoryShares,
    populationProfileId: `procedural:${populationProfile}`,
    majorityOwner: majority.zoneFaction,
    objectProfileTags: nonEmptyTags(objectProfile?.tags),
    monsterPressureTags: uniqueTags([...spec.monsterBiasTags, ...proceduralFloorMonsterBiasTags(spec)]),
    economyTags: uniqueTags([spec.geometryId, spec.majorityId, spec.anomalyId, ...anomaly.tags, ...(objectProfile?.tags ?? [])]),
    specialContentTags: uniqueTags([spec.geometryId, spec.majorityId, spec.anomalyId, ...majority.tags, ...anomaly.tags]),
  };
}

export function dominantTerritoryShareOwner(shares: readonly FloorTerritoryShare[]): TerritoryOwner | undefined {
  let best: FloorTerritoryShare | undefined;
  for (const row of shares) {
    if (!best || row.share > best.share) best = row;
  }
  return best?.owner;
}
