import { ContainerKind, Feature } from '../core/types';

export type PathBlockerShape =
  | { kind: 'rect'; cx: number; cy: number; w: number; h: number }
  | { kind: 'circle'; cx: number; cy: number; r: number }
  | { kind: 'line'; x0: number; y0: number; x1: number; y1: number; width: number };

export interface PathBlockerDef {
  id: string;
  tags: readonly string[];
  shapes: readonly PathBlockerShape[];
  inflateForHuman?: boolean;
  blocksProjectiles?: boolean;
  fullCellWhenClosed?: boolean;
}

export const PATH_BLOCKER_DEFS: readonly PathBlockerDef[] = [
  {
    id: 'table_slab_blocker',
    tags: ['furniture', 'table', 'flat_surface'],
    shapes: [{ kind: 'rect', cx: 0.5, cy: 0.5, w: 0.72, h: 0.5 }],
  },
  {
    id: 'desk_blocker',
    tags: ['furniture', 'desk', 'office'],
    shapes: [{ kind: 'rect', cx: 0.5, cy: 0.56, w: 0.78, h: 0.44 }],
  },
  {
    id: 'bed_blocker',
    tags: ['furniture', 'bed', 'sleep'],
    shapes: [{ kind: 'rect', cx: 0.5, cy: 0.5, w: 0.82, h: 0.62 }],
  },
  {
    id: 'shelf_blocker',
    tags: ['furniture', 'shelf', 'storage'],
    shapes: [{ kind: 'rect', cx: 0.5, cy: 0.5, w: 0.82, h: 0.28 }],
  },
  {
    id: 'machine_blocker',
    tags: ['industrial', 'machine', 'stove', 'bulk'],
    shapes: [{ kind: 'rect', cx: 0.5, cy: 0.5, w: 0.72, h: 0.72 }],
  },
  {
    id: 'apparatus_blocker',
    tags: ['industrial', 'apparatus', 'lab', 'bulk'],
    shapes: [
      { kind: 'rect', cx: 0.5, cy: 0.5, w: 0.58, h: 0.58 },
      { kind: 'circle', cx: 0.5, cy: 0.5, r: 0.24 },
    ],
  },
  {
    id: 'sink_blocker',
    tags: ['fixture', 'sink', 'water'],
    shapes: [{ kind: 'rect', cx: 0.5, cy: 0.48, w: 0.56, h: 0.36 }],
  },
  {
    id: 'toilet_blocker',
    tags: ['fixture', 'toilet', 'sanitary'],
    shapes: [
      { kind: 'circle', cx: 0.5, cy: 0.56, r: 0.24 },
      { kind: 'rect', cx: 0.5, cy: 0.32, w: 0.34, h: 0.22 },
    ],
  },
  {
    id: 'crate_blocker',
    tags: ['container', 'crate', 'chest'],
    shapes: [{ kind: 'rect', cx: 0.5, cy: 0.5, w: 0.58, h: 0.58 }],
  },
  {
    id: 'cabinet_blocker',
    tags: ['container', 'cabinet', 'locker', 'safe'],
    shapes: [{ kind: 'rect', cx: 0.5, cy: 0.5, w: 0.7, h: 0.34 }],
  },
];

export const PATH_BLOCKER_DEF_BY_ID: ReadonlyMap<string, PathBlockerDef> = new Map(
  PATH_BLOCKER_DEFS.map(def => [def.id, def]),
);

export const FEATURE_PATH_BLOCKER_IDS: readonly (readonly [Feature, string])[] = [
  [Feature.TABLE, 'table_slab_blocker'],
  [Feature.DESK, 'desk_blocker'],
  [Feature.BED, 'bed_blocker'],
  [Feature.SHELF, 'shelf_blocker'],
  [Feature.MACHINE, 'machine_blocker'],
  [Feature.APPARATUS, 'apparatus_blocker'],
  [Feature.SINK, 'sink_blocker'],
  [Feature.TOILET, 'toilet_blocker'],
  [Feature.STOVE, 'machine_blocker'],
];

export const CONTAINER_PATH_BLOCKER_IDS: readonly (readonly [ContainerKind, string])[] = [
  [ContainerKind.WOODEN_CHEST, 'crate_blocker'],
  [ContainerKind.WEAPON_CRATE, 'crate_blocker'],
  [ContainerKind.METAL_CABINET, 'cabinet_blocker'],
  [ContainerKind.MEDICAL_CABINET, 'cabinet_blocker'],
  [ContainerKind.FILING_CABINET, 'cabinet_blocker'],
  [ContainerKind.TOOL_LOCKER, 'cabinet_blocker'],
  [ContainerKind.FRIDGE, 'cabinet_blocker'],
  [ContainerKind.SAFE, 'cabinet_blocker'],
];

export function pathBlockerDefById(id: string): PathBlockerDef | undefined {
  return PATH_BLOCKER_DEF_BY_ID.get(id);
}

export function pathBlockerIdForFeature(feature: Feature): string | undefined {
  for (const [candidate, id] of FEATURE_PATH_BLOCKER_IDS) {
    if (candidate === feature) return id;
  }
  return undefined;
}

export function pathBlockerIdForContainerKind(kind: ContainerKind): string | undefined {
  for (const [candidate, id] of CONTAINER_PATH_BLOCKER_IDS) {
    if (candidate === kind) return id;
  }
  return undefined;
}
