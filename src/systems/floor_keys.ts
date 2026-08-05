/* ── Canonical runtime keys for route stops and floor instances ─ */

import { FloorLevel } from '../core/types';
import type { DesignFloorId } from '../data/floor_keys';
import {
  floorKeyForDesign,
  floorKeyForProcedural,
  floorKeyForStory,
  floorKeyForZ,
} from '../data/floor_keys';

export {
  cleanFloorKey,
  floorKeyAllowsNpcs,
  floorKeyBaseFloor,
  floorKeyForDesign,
  floorKeyForFloorInstance,
  floorKeyForProcedural,
  floorKeyForStory,
  floorKeyForZ,
  floorKeyKind,
  floorKeyKnown,
  floorKeyRouteId,
  floorKeyZ,
  type FloorKeyKind,
  type FloorKeyResolveContext,
} from '../data/floor_keys';

export interface FloorKeyEntryLike {
  z?: number;
  baseFloor: FloorLevel;
  storyFloor?: FloorLevel;
  designFloorId?: DesignFloorId | string;
  spec?: { key: string };
}

export function floorKeyForEntry(entry: FloorKeyEntryLike): string {
  if (entry.storyFloor !== undefined) return floorKeyForStory(entry.storyFloor);
  if (entry.designFloorId) return floorKeyForDesign(entry.designFloorId);
  if (entry.spec) return floorKeyForProcedural(entry.spec.key);
  if (typeof entry.z === 'number' && Number.isFinite(entry.z)) return floorKeyForZ(Math.trunc(entry.z));
  return floorKeyForStory(entry.baseFloor);
}
