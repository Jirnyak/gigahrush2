import { Feature, RoomType } from '../core/types';

export type RoomAffordanceId =
  | 'sleep'
  | 'hide'
  | 'eat'
  | 'drink'
  | 'toilet'
  | 'work'
  | 'heal'
  | 'store'
  | 'social'
  | 'patrol'
  | 'shelter'
  | 'wander';

export interface RoomAffordanceDef {
  roomType: RoomType;
  affordances: Partial<Record<RoomAffordanceId, number>>;
  expectedFeatures?: readonly Feature[];
  tags: readonly string[];
}

export const ROOM_AFFORDANCES: Readonly<Record<RoomType, RoomAffordanceDef>> = {
  [RoomType.LIVING]: {
    roomType: RoomType.LIVING,
    affordances: { sleep: 34, hide: 24, shelter: 24 },
    expectedFeatures: [Feature.BED, Feature.TABLE, Feature.CHAIR],
    tags: ['residential', 'home', 'rest', 'private'],
  },
  [RoomType.KITCHEN]: {
    roomType: RoomType.KITCHEN,
    affordances: { eat: 34, drink: 28, social: 17 },
    expectedFeatures: [Feature.STOVE, Feature.SINK, Feature.TABLE],
    tags: ['food', 'water', 'household', 'queue'],
  },
  [RoomType.BATHROOM]: {
    roomType: RoomType.BATHROOM,
    affordances: { toilet: 38, drink: 14 },
    expectedFeatures: [Feature.TOILET, Feature.SINK],
    tags: ['sanitary', 'water', 'relief'],
  },
  [RoomType.STORAGE]: {
    roomType: RoomType.STORAGE,
    affordances: { store: 34, work: 12, shelter: 7 },
    expectedFeatures: [Feature.SHELF],
    tags: ['storage', 'loot', 'supplies'],
  },
  [RoomType.MEDICAL]: {
    roomType: RoomType.MEDICAL,
    affordances: { heal: 40, work: 26, shelter: 8 },
    expectedFeatures: [Feature.APPARATUS, Feature.SINK],
    tags: ['medical', 'heal', 'lab'],
  },
  [RoomType.COMMON]: {
    roomType: RoomType.COMMON,
    affordances: { social: 24, patrol: 12, shelter: 8, wander: 9, eat: 8 },
    expectedFeatures: [Feature.TABLE, Feature.CHAIR],
    tags: ['social', 'public', 'hall', 'shelter'],
  },
  [RoomType.CLASSROOM]: {
    roomType: RoomType.CLASSROOM,
    affordances: { social: 24, work: 24, shelter: 8 },
    expectedFeatures: [Feature.TABLE, Feature.CHAIR, Feature.SHELF],
    tags: ['education', 'social', 'school'],
  },
  [RoomType.PRODUCTION]: {
    roomType: RoomType.PRODUCTION,
    affordances: { work: 35, store: 8 },
    expectedFeatures: [Feature.MACHINE, Feature.APPARATUS],
    tags: ['work', 'machine', 'industrial'],
  },
  [RoomType.CORRIDOR]: {
    roomType: RoomType.CORRIDOR,
    affordances: { patrol: 24, wander: 9 },
    expectedFeatures: [Feature.LAMP],
    tags: ['passage', 'patrol', 'route'],
  },
  [RoomType.SMOKING]: {
    roomType: RoomType.SMOKING,
    affordances: { social: 17, shelter: -4 },
    expectedFeatures: [Feature.CHAIR, Feature.TABLE],
    tags: ['social', 'smoking', 'idle'],
  },
  [RoomType.OFFICE]: {
    roomType: RoomType.OFFICE,
    affordances: { work: 34, shelter: 5, sleep: 12 },
    expectedFeatures: [Feature.DESK, Feature.SCREEN, Feature.CHAIR],
    tags: ['office', 'paperwork', 'admin'],
  },
  [RoomType.HQ]: {
    roomType: RoomType.HQ,
    affordances: { patrol: 20, shelter: 18, social: 10, hide: 18 },
    expectedFeatures: [Feature.SCREEN, Feature.DESK, Feature.CHAIR],
    tags: ['hq', 'faction', 'guard', 'shelter'],
  },
};

export function roomAffordanceDef(type: RoomType): RoomAffordanceDef {
  return ROOM_AFFORDANCES[type];
}

export function roomAffordanceWeight(type: RoomType | undefined, affordance: RoomAffordanceId): number {
  if (type === undefined) return 0;
  return ROOM_AFFORDANCES[type]?.affordances[affordance] ?? 0;
}

export function roomSupports(type: RoomType | undefined, affordance: RoomAffordanceId): boolean {
  return roomAffordanceWeight(type, affordance) > 0;
}

export function roomAffordanceTags(type: RoomType | undefined): readonly string[] {
  if (type === undefined) return [];
  return ROOM_AFFORDANCES[type]?.tags ?? [];
}

export function roomExpectedFeatures(type: RoomType | undefined): readonly Feature[] {
  if (type === undefined) return [];
  return ROOM_AFFORDANCES[type]?.expectedFeatures ?? [];
}
