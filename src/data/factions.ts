import { Faction, ZoneFaction, type TerritoryOwner } from '../core/types';

export interface TerritoryOwnerDef {
  owner: TerritoryOwner;
  id: string;
  name: string;
  shortName: string;
  color: string;
  faction: Faction | null;
}

export const TERRITORY_OWNER_DEFS: readonly TerritoryOwnerDef[] = [
  { owner: ZoneFaction.CITIZEN, id: 'citizen', name: 'Граждане', shortName: 'ГРЖ', color: '#4abe91', faction: Faction.CITIZEN },
  { owner: ZoneFaction.LIQUIDATOR, id: 'liquidator', name: 'Ликвидаторы', shortName: 'ЛИК', color: '#5b9eee', faction: Faction.LIQUIDATOR },
  { owner: ZoneFaction.CULTIST, id: 'cultist', name: 'Культисты', shortName: 'КУЛ', color: '#bc59ff', faction: Faction.CULTIST },
  { owner: ZoneFaction.SAMOSBOR, id: 'samosbor', name: 'Самосбор', shortName: 'САМ', color: '#e64e5c', faction: null },
  { owner: ZoneFaction.WILD, id: 'wild', name: 'Дикие', shortName: 'ДИК', color: '#e0a745', faction: Faction.WILD },
  { owner: ZoneFaction.SCIENTIST, id: 'scientist', name: 'Учёные', shortName: 'НИИ', color: '#67d8e8', faction: Faction.SCIENTIST },
] as const;

export const TERRITORY_OWNERS = TERRITORY_OWNER_DEFS.map(def => def.owner) as readonly TerritoryOwner[];
export const HUMAN_TERRITORY_OWNERS = TERRITORY_OWNER_DEFS
  .filter(def => def.faction !== null)
  .map(def => def.owner) as readonly TerritoryOwner[];

export function isTerritoryOwner(value: number): value is TerritoryOwner {
  return TERRITORY_OWNERS.includes(value as TerritoryOwner);
}

export function territoryOwnerDef(owner: TerritoryOwner): TerritoryOwnerDef {
  return TERRITORY_OWNER_DEFS.find(def => def.owner === owner) ?? TERRITORY_OWNER_DEFS[0];
}

export function territoryOwnerName(owner: TerritoryOwner): string {
  return territoryOwnerDef(owner).name;
}

export function territoryOwnerColor(owner: TerritoryOwner): string {
  return territoryOwnerDef(owner).color;
}

export function territoryOwnerToFaction(owner: TerritoryOwner): Faction | null {
  return territoryOwnerDef(owner).faction;
}

export function factionToTerritoryOwner(faction: Faction): TerritoryOwner {
  switch (faction) {
    case Faction.CITIZEN: return ZoneFaction.CITIZEN;
    case Faction.LIQUIDATOR: return ZoneFaction.LIQUIDATOR;
    case Faction.CULTIST: return ZoneFaction.CULTIST;
    case Faction.SCIENTIST: return ZoneFaction.SCIENTIST;
    case Faction.WILD: return ZoneFaction.WILD;
    case Faction.PLAYER: return ZoneFaction.CITIZEN;
  }
}

