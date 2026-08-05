import { type Entity, type GameState } from '../core/types';
import { type World } from '../core/world';
import { type ActiveSamosborVariant } from '../data/samosbor_variants';

export interface SamosborLocalShelterPrepareContext {
  world: World;
  entities: Entity[];
  state: GameState;
  variant: ActiveSamosborVariant;
  zoneId: number;
  zoneX: number;
  zoneY: number;
}

export interface SamosborLocalShelterInteractionContext {
  world: World;
  entities: Entity[];
  player: Entity;
  state: GameState;
  nextId: { v: number };
  variant: ActiveSamosborVariant;
  lookX: number;
  lookY: number;
}

export interface SamosborLocalShelterEndContext {
  world: World;
  entities: Entity[];
  state: GameState;
  nextId: { v: number };
  variant: ActiveSamosborVariant | null;
}

export interface SamosborLocalShelterDef {
  id: string;
  prepare?: (ctx: SamosborLocalShelterPrepareContext) => readonly number[];
  getRoomIds?: (state?: GameState) => readonly number[];
  tryInteract?: (ctx: SamosborLocalShelterInteractionContext) => boolean;
  onEnd?: (ctx: SamosborLocalShelterEndContext) => void;
  clear?: (state?: GameState) => void;
  debugLine?: () => string;
}

const localShelters: SamosborLocalShelterDef[] = [];

export function registerSamosborLocalShelter(def: SamosborLocalShelterDef): void {
  if (localShelters.some(shelter => shelter.id === def.id)) {
    console.warn(`[samosbor_hooks] duplicate local shelter id: ${def.id}`);
    return;
  }
  localShelters.push(def);
}

export function getSamosborLocalShelters(): readonly SamosborLocalShelterDef[] {
  return localShelters;
}
