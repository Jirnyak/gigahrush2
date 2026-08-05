/* ── Authored quest/event arrivals executed by systems ───────── */

import {
  Faction,
  FloorLevel,
  LiftDirection,
  Occupation,
  type Item,
  type WorldEventSeverity,
} from '../core/types';
import { floorKeyForStory } from './floor_keys';

export interface ScriptedArrivalAmmoDef {
  defId: string;
  count: number;
}

export interface ScriptedArrivalEscortDef {
  count: number;
  faction: Faction;
  occupation: Occupation;
  level: number;
  hpMultiplier: number;
  speedBase: number;
  speedSpread: number;
  weapons: readonly string[];
  ammoByWeapon: Readonly<Record<string, ScriptedArrivalAmmoDef>>;
  defaultAmmo: ScriptedArrivalAmmoDef;
  inventory: readonly Item[];
  traveler?: boolean;
}

export interface ScriptedArrivalDef {
  id: string;
  triggerPlotEventTag: string;
  currentFloor: FloorLevel;
  currentStoryFloor?: FloorLevel;
  leaderPlotNpcId: string;
  leaderWeapon?: string;
  leaderTraveler?: boolean;
  sourceFloorKey: string;
  preferredLiftDirection?: LiftDirection;
  escort?: ScriptedArrivalEscortDef;
  eventTags: readonly string[];
  eventSeverity: WorldEventSeverity;
  message: string;
}

export const SCRIPTED_ARRIVALS: readonly ScriptedArrivalDef[] = [
  {
    id: 'hell_holdout_major_grom_group',
    triggerPlotEventTag: 'hell_holdout',
    currentFloor: FloorLevel.HELL,
    currentStoryFloor: FloorLevel.HELL,
    leaderPlotNpcId: 'major_grom',
    leaderWeapon: 'ak47',
    leaderTraveler: true,
    sourceFloorKey: floorKeyForStory(FloorLevel.MINISTRY),
    preferredLiftDirection: LiftDirection.UP,
    escort: {
      count: 5,
      faction: Faction.LIQUIDATOR,
      occupation: Occupation.HUNTER,
      level: 8,
      hpMultiplier: 1.5,
      speedBase: 1.35,
      speedSpread: 0.25,
      weapons: ['ak47', 'ppsh', 'shotgun', 'makarov'],
      ammoByWeapon: {
        shotgun: { defId: 'ammo_shells', count: 8 },
        ak47: { defId: 'ammo_762', count: 24 },
      },
      defaultAmmo: { defId: 'ammo_9mm', count: 24 },
      inventory: [{ defId: 'bandage', count: 1 }],
      traveler: true,
    },
    eventTags: ['scripted_arrival', 'alife_migration', 'hell_holdout', 'liquidator', 'quest', 'faction'],
    eventSeverity: 4,
    message: 'Лифт выплюнул группу Громного. Они идут к зоне закрепления, оружие уже на руках.',
  },
] as const;
