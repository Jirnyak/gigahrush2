/* ── Numbered elevator floor metadata ─────────────────────────── */

import { FloorLevel } from '../core/types';

export type FloorInstanceGeneratorId = 'story_pocket';
export type FloorInstanceExitRuleId = 'next_lift_returns';
export type FloorInstanceNpcPolicyId = 'none' | 'generator';
export type FloorInstanceMonsterPolicyId = 'generator' | 'none';
export type FloorInstanceSamosborPolicyId = 'normal' | 'exempt';

export interface FloorInstanceFollowupDef {
  id: string;
  title: string;
  message: string;
  suppressSeconds: number;
  tags: readonly string[];
}

export interface FloorInstanceDef {
  id: string;
  displayNumber: string;
  title: string;
  baseFloor: FloorLevel;
  seedTag: string;
  generatorId: FloorInstanceGeneratorId;
  exitRule: FloorInstanceExitRuleId;
  npcPolicy: FloorInstanceNpcPolicyId;
  monsterPolicy: FloorInstanceMonsterPolicyId;
  samosborPolicy: FloorInstanceSamosborPolicyId;
  debugCommandId: string;
  lore: string;
  tags: readonly string[];
  risk: 1 | 2 | 3 | 4 | 5;
  weight: number;
  discovered: boolean;
  rumorId: string;
  followup?: FloorInstanceFollowupDef;
}

export const FLOOR_INSTANCES: readonly FloorInstanceDef[] = [
  {
    id: 'loop_404',
    displayNumber: '404',
    title: 'Не найден',
    baseFloor: FloorLevel.LIVING,
    seedTag: 'not_found',
    generatorId: 'story_pocket',
    exitRule: 'next_lift_returns',
    npcPolicy: 'none',
    monsterPolicy: 'generator',
    samosborPolicy: 'normal',
    debugCommandId: 'arm_floor_instance',
    lore: 'Лифт открывает копию жилого этажа без жильцов: двери помнят людей, но сами люди не входят в эту петлю.',
    tags: ['horror_labyrinth', 'empty_residential', 'numbered_lift'],
    risk: 4,
    weight: 18,
    discovered: false,
    rumorId: 'floor_pocket_rooms',
  },
  {
    id: 'loop_556',
    displayNumber: '556',
    title: 'П-46',
    baseFloor: FloorLevel.KVARTIRY,
    seedTag: 'p46_protocol',
    generatorId: 'story_pocket',
    exitRule: 'next_lift_returns',
    npcPolicy: 'none',
    monsterPolicy: 'generator',
    samosborPolicy: 'normal',
    debugCommandId: 'arm_floor_instance',
    lore: 'Очередной протокол квартирного этажа, вынесенный из нормальной вертикали в отдельный номерной цикл.',
    tags: ['residential_protocol', 'queue_loop', 'numbered_lift'],
    risk: 3,
    weight: 12,
    discovered: false,
    rumorId: 'samosbor_doors_lie',
  },
  {
    id: 'loop_777',
    displayNumber: '777',
    title: 'Счастливый',
    baseFloor: FloorLevel.LIVING,
    seedTag: 'lucky_shelter',
    generatorId: 'story_pocket',
    exitRule: 'next_lift_returns',
    npcPolicy: 'none',
    monsterPolicy: 'generator',
    samosborPolicy: 'normal',
    debugCommandId: 'arm_floor_instance',
    lore: 'Тихий номерной карман с привычными стенами и неправильным ощущением безопасности.',
    tags: ['false_shelter', 'quiet_loop', 'numbered_lift'],
    risk: 2,
    weight: 10,
    discovered: false,
    rumorId: 'floor_safe_not_safe',
  },
  {
    id: 'loop_1337',
    displayNumber: '1337',
    title: 'Элитный',
    baseFloor: FloorLevel.MAINTENANCE,
    seedTag: 'radio_code',
    generatorId: 'story_pocket',
    exitRule: 'next_lift_returns',
    npcPolicy: 'none',
    monsterPolicy: 'generator',
    samosborPolicy: 'normal',
    debugCommandId: 'arm_floor_instance',
    lore: 'Техническая шахта с радиокодом вместо этажа: маршрутная колода ее не видит.',
    tags: ['radio_code', 'maintenance_loop', 'numbered_lift'],
    risk: 4,
    weight: 8,
    discovered: false,
    rumorId: 'samosbor_electric_variant',
  },
  {
    id: 'loop_013',
    displayNumber: '013',
    title: 'Служебный',
    baseFloor: FloorLevel.MINISTRY,
    seedTag: 'service_order',
    generatorId: 'story_pocket',
    exitRule: 'next_lift_returns',
    npcPolicy: 'none',
    monsterPolicy: 'generator',
    samosborPolicy: 'normal',
    debugCommandId: 'arm_floor_instance',
    lore: 'Приказной карман Министерства: бумага есть, адреса в обычной вертикали нет.',
    tags: ['ministry_order', 'service_loop', 'numbered_lift'],
    risk: 3,
    weight: 8,
    discovered: false,
    rumorId: 'faction_ministry_papers',
  },
  {
    id: 'loop_089',
    displayNumber: '089',
    title: 'Теплый лифт',
    baseFloor: FloorLevel.MAINTENANCE,
    seedTag: 'warm_shaft',
    generatorId: 'story_pocket',
    exitRule: 'next_lift_returns',
    npcPolicy: 'none',
    monsterPolicy: 'generator',
    samosborPolicy: 'normal',
    debugCommandId: 'arm_floor_instance',
    lore: 'Теплая шахта сбивает вертикаль, но после выхода временно стабилизирует обычный маршрут.',
    tags: ['warm_shaft', 'route_guard', 'numbered_lift'],
    risk: 3,
    weight: 7,
    discovered: false,
    rumorId: 'floor_lift_smell',
    followup: {
      id: 'warm_shaft_stabilized',
      title: 'Теплая шахта стабилизирована',
      message: 'Бирка N-089 согрела шахту: следующий лифтовый рывок держит обычный маршрут.',
      suppressSeconds: 180,
      tags: ['warm_shaft', 'route_guard', 'lift_repair_shaft'],
    },
  },
  {
    id: 'loop_000',
    displayNumber: '000',
    title: 'Нулевой список',
    baseFloor: FloorLevel.VOID,
    seedTag: 'zero_register',
    generatorId: 'story_pocket',
    exitRule: 'next_lift_returns',
    npcPolicy: 'none',
    monsterPolicy: 'generator',
    samosborPolicy: 'normal',
    debugCommandId: 'arm_floor_instance',
    lore: 'Пустотный номер, где список этажей начинается с нуля и не входит в обычный маршрут.',
    tags: ['void_register', 'zero_loop', 'numbered_lift'],
    risk: 5,
    weight: 3,
    discovered: false,
    rumorId: 'floor_void_listens',
  },
  {
    id: 'loop_912',
    displayNumber: '912',
    title: 'Чужая очередь',
    baseFloor: FloorLevel.KVARTIRY,
    seedTag: 'wrong_queue',
    generatorId: 'story_pocket',
    exitRule: 'next_lift_returns',
    npcPolicy: 'none',
    monsterPolicy: 'generator',
    samosborPolicy: 'normal',
    debugCommandId: 'arm_floor_instance',
    lore: 'Квартирный номер, в котором очередь уже ушла, но ее маршрутная ошибка осталась.',
    tags: ['wrong_queue', 'residential_loop', 'numbered_lift'],
    risk: 2,
    weight: 9,
    discovered: false,
    rumorId: 'room_lift_wrong',
  },
];

const FLOOR_INSTANCE_BY_ID = new Map(FLOOR_INSTANCES.map(def => [def.id, def]));

export function floorInstanceById(id: string): FloorInstanceDef | undefined {
  return FLOOR_INSTANCE_BY_ID.get(id);
}

export function floorInstanceAllowsNpcs(instance: FloorInstanceDef | string): boolean {
  const def = typeof instance === 'string' ? floorInstanceById(instance) : instance;
  return !!def && def.npcPolicy !== 'none';
}

export function floorInstanceAllowsSamosbor(instance: FloorInstanceDef | string): boolean {
  const def = typeof instance === 'string' ? floorInstanceById(instance) : instance;
  return !!def && def.samosborPolicy !== 'exempt';
}
