/* ── Map editor brush catalog from live game registries ───────── */

import { ContainerKind, Faction, MonsterKind } from '../core/types';
import { ITEMS } from '../data/catalog';
import { CONTAINER_DEFS } from '../data/container_defs';
import { FACTION_NAMES } from '../data/relations';
import { MONSTERS } from '../entities/monster';

export type MapEditorEntityBrush =
  | { kind: 'npc'; faction: Faction; label: string; color: string }
  | { kind: 'monster'; monsterKind: MonsterKind; label: string; color: string }
  | { kind: 'item'; itemId: string; label: string; color: string }
  | { kind: 'delete'; label: string; color: string };

export type MapEditorContainerBrush =
  | { kind: ContainerKind; label: string; color: string }
  | { kind: 'delete'; label: string; color: string };

function enumNumbers<T extends number>(source: Record<string, string | number>): T[] {
  return Object.values(source)
    .filter((value): value is T => typeof value === 'number')
    .sort((a, b) => a - b);
}

function factionBrushes(): MapEditorEntityBrush[] {
  return enumNumbers<Faction>(Faction)
    .filter(faction => faction !== Faction.PLAYER)
    .map(faction => ({
      kind: 'npc',
      faction,
      label: `NPC ${FACTION_NAMES[faction] ?? Faction[faction] ?? faction}`,
      color: '#59d46b',
    }));
}

function monsterBrushes(): MapEditorEntityBrush[] {
  return enumNumbers<MonsterKind>(MonsterKind)
    .filter(kind => MONSTERS[kind] !== undefined)
    .map(kind => ({
      kind: 'monster',
      monsterKind: kind,
      label: `MON ${MONSTERS[kind].name}`,
      color: '#e66',
    }));
}

function itemBrushes(): MapEditorEntityBrush[] {
  return Object.values(ITEMS)
    .sort((a, b) => a.name.localeCompare(b.name, 'ru'))
    .map(def => ({
      kind: 'item',
      itemId: def.id,
      label: `ITEM ${def.name}`,
      color: '#dd4',
    }));
}

export function mapEditorEntityBrushes(): MapEditorEntityBrush[] {
  return [
    ...factionBrushes(),
    ...monsterBrushes(),
    ...itemBrushes(),
    { kind: 'delete', label: 'DELETE ENTITY', color: '#ff5868' },
  ];
}

export function mapEditorContainerBrushes(): MapEditorContainerBrush[] {
  return [
    ...Object.values(CONTAINER_DEFS)
      .sort((a, b) => a.name.localeCompare(b.name, 'ru'))
      .map(def => ({
        kind: def.kind,
        label: def.name,
        color: '#db6',
      })),
    { kind: 'delete', label: 'DELETE CONTAINER', color: '#ff5868' },
  ];
}
