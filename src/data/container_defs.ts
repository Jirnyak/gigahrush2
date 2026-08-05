import { ContainerKind, type ContainerAccess, RoomType } from '../core/types';
import { ITEMS } from './items';

export interface ContainerDef {
  kind: ContainerKind;
  name: string;
  capacitySlots: number;
  proceduralValueCap?: number;
  defaultAccess: ContainerAccess;
  roomTypes: RoomType[];
  tags: string[];
  itemPool?: { defId: string; weight: number }[];
}

export const CONTAINER_DEFS: Record<ContainerKind, ContainerDef> = {
  [ContainerKind.WOODEN_CHEST]: {
    kind: ContainerKind.WOODEN_CHEST, name: 'Деревянный сундук', capacitySlots: 10, proceduralValueCap: 75, defaultAccess: 'owner',
    roomTypes: [RoomType.LIVING, RoomType.STORAGE], tags: ['home', 'food', 'paper'],
  },
  [ContainerKind.METAL_CABINET]: {
    kind: ContainerKind.METAL_CABINET, name: 'Железный шкаф', capacitySlots: 12, proceduralValueCap: 120, defaultAccess: 'room',
    roomTypes: [RoomType.STORAGE, RoomType.PRODUCTION], tags: ['tools', 'scrap'],
  },
  [ContainerKind.MEDICAL_CABINET]: {
    kind: ContainerKind.MEDICAL_CABINET, name: 'Медицинский шкаф', capacitySlots: 10, proceduralValueCap: 150, defaultAccess: 'room',
    roomTypes: [RoomType.MEDICAL], tags: ['medical'],
  },
  [ContainerKind.WEAPON_CRATE]: {
    kind: ContainerKind.WEAPON_CRATE, name: 'Оружейный ящик', capacitySlots: 8, proceduralValueCap: 260, defaultAccess: 'faction',
    roomTypes: [RoomType.HQ, RoomType.STORAGE, RoomType.PRODUCTION], tags: ['weapon', 'locked', 'ammo'],
  },
  [ContainerKind.FRIDGE]: {
    kind: ContainerKind.FRIDGE, name: 'Холодильник', capacitySlots: 8, proceduralValueCap: 60, defaultAccess: 'room',
    roomTypes: [RoomType.KITCHEN], tags: ['food'],
  },
  [ContainerKind.SAFE]: {
    kind: ContainerKind.SAFE, name: 'Сейф', capacitySlots: 10, proceduralValueCap: 260, defaultAccess: 'locked',
    roomTypes: [RoomType.OFFICE, RoomType.HQ], tags: ['valuable', 'locked', 'paper', 'tier2'],
  },
  [ContainerKind.FILING_CABINET]: {
    kind: ContainerKind.FILING_CABINET, name: 'Картотека', capacitySlots: 10, proceduralValueCap: 125, defaultAccess: 'room',
    roomTypes: [RoomType.OFFICE, RoomType.STORAGE], tags: ['paper', 'tier1'],
  },
  [ContainerKind.CASHBOX]: {
    kind: ContainerKind.CASHBOX, name: 'Касса', capacitySlots: 5, proceduralValueCap: 110, defaultAccess: 'owner',
    roomTypes: [RoomType.OFFICE, RoomType.KITCHEN], tags: ['trade', 'valuable'],
  },
  [ContainerKind.SECRET_STASH]: {
    kind: ContainerKind.SECRET_STASH, name: 'Тайник', capacitySlots: 8, proceduralValueCap: 220, defaultAccess: 'secret',
    roomTypes: [RoomType.CORRIDOR, RoomType.SMOKING, RoomType.LIVING], tags: ['secret', 'paper', 'forged', 'contraband'],
  },
  [ContainerKind.EMERGENCY_BOX]: {
    kind: ContainerKind.EMERGENCY_BOX, name: 'Аварийный ящик', capacitySlots: 8, proceduralValueCap: 85, defaultAccess: 'public',
    roomTypes: [RoomType.COMMON, RoomType.CORRIDOR], tags: ['public', 'samosbor', 'medical'],
  },
  [ContainerKind.TRASH_BIN]: {
    kind: ContainerKind.TRASH_BIN, name: 'Мусорный бак', capacitySlots: 6, proceduralValueCap: 40, defaultAccess: 'public',
    roomTypes: [RoomType.KITCHEN, RoomType.CORRIDOR], tags: ['trash', 'public'],
  },
  [ContainerKind.TOOL_LOCKER]: {
    kind: ContainerKind.TOOL_LOCKER, name: 'Инструментальный шкаф', capacitySlots: 10, proceduralValueCap: 160, defaultAccess: 'room',
    roomTypes: [RoomType.PRODUCTION, RoomType.STORAGE], tags: ['tools', 'scrap'],
  },
};

for (const def of Object.values(CONTAINER_DEFS)) {
  Object.defineProperty(def, 'itemPool', {
    get() {
      return Object.values(ITEMS).map(item => ({ defId: item.id, weight: 1, min: 1, max: item.id === 'ammo_12g_slug' ? 2 : 1, chance: 0.02 }));
    },
    enumerable: true,
  });
}

export function containerKindsForRoom(type: RoomType): ContainerKind[] {
  const kinds = Object.values(CONTAINER_DEFS)
    .filter(d => d.roomTypes.includes(type))
    .map(d => d.kind);
  return kinds.length > 0 ? kinds : [ContainerKind.WOODEN_CHEST];
}
