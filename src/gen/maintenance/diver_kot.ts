/* ── Дайвер Кот — side quest (maintenance floor) ──────────────── */
/* Дикий ныряльщик из водяных каналов. Жрёт сырое мясо.           */

import {
  W, Cell, FloorLevel, RoomType,
  type Entity, Faction, Occupation, QuestType,
} from '../../core/types';
import { World } from '../../core/world';
import { type PlotNpcDef, registerSideQuest } from '../../data/plot';
import { requireSpawnedPlotNpcFromPackage } from '../plot_npc_spawn';

const NPC_DEF: PlotNpcDef = {
  name: 'Дайвер Кот',
  isFemale: false,
  faction: Faction.WILD,
  occupation: Occupation.TRAVELER,
  sprite: Occupation.TRAVELER,
  hp: 200, maxHp: 200, money: 15, speed: 1.5,
  inventory: [
    { defId: 'knife', count: 1 },
    { defId: 'rawmeat', count: 4 },
    { defId: 'flashlight', count: 1 },
  ],
  talkLines: [
    'Хы-хы… Кот меня зовут. Я в воду ныряю. Под полом всё лежит — старое, вкусное.',
    'Канализация - это не канал. Это мокрый коридор под давлением. Слушай трубу, а не карту.',
    'Принеси мне сырого мяса. Шесть кусков. Тварей на нижних ярусах кормить надо.',
    'Зачем кормить? Чтоб пускали. Если не кормишь — жрут самого. Логика, ага.',
  ],
  talkLinesPost: [
    'Хы-хы! Сытно. Твари сегодня меня не тронут.',
    'Если плыть надо — иди от водолазного тайника к сухому мосту. В ящике на дальнем краю должна быть маршрутная бирка.',
    'Хороший ты. Кот таких не ест.',
  ],
};

registerSideQuest('diver_kot', NPC_DEF, [
  {
    id: 'kot_meat',
    giverNpcId: 'diver_kot',
    type: QuestType.FETCH,
    desc: 'Кот: «Шесть кусков сырого мяса. Тварей кормить. Иначе — меня сожрут.»',
    targetItem: 'rawmeat', targetCount: 6,
    rewardItem: 'flashlight', rewardCount: 1,
    extraRewards: [
      { defId: 'psi_phase', count: 1 },
      { defId: 'ammo_shells', count: 4 },
    ],
    relationDelta: 12, xpReward: 60, moneyReward: 30,
  },
  {
    id: 'kot_water_bridge_tag',
    giverNpcId: 'diver_kot',
    type: QuestType.FETCH,
    desc: 'Кот: «На сухом мосту есть бирка водолазного маршрута. Принесёшь — скажу, где угорь воздух не любит.»',
    targetItem: 'diver_route_tag', targetCount: 1,
    targetFloor: FloorLevel.MAINTENANCE,
    targetRoomType: RoomType.CORRIDOR,
    targetZoneTag: 'water_bridge',
    targetHint: 'Коллекторы: сухой мост над угревым лотком; дальний маршрутный ящик стоит на сухой кромке за водой.',
    rewardItem: 'ammo_harpoon', rewardCount: 3,
    extraRewards: [
      { defId: 'filtered_water', count: 1 },
      { defId: 'rawmeat', count: 2 },
    ],
    relationDelta: 10, xpReward: 55, moneyReward: 20,
    requiresSideQuestDone: 'kot_meat',
    eventTargetName: 'Коту вернули бирку водолазного маршрута с сухого моста.',
    eventSeverity: 4,
    eventPrivacy: 'local',
    eventTags: ['maintenance', 'diver', 'water_bridge', 'route_tag', 'eel_counterplay'],
    eventData: {
      routeItem: 'diver_route_tag',
      shortcut: 'dry_bridge_ledge',
      rumorIds: ['maint_water_bridge_dry_path', 'lead_maintenance_diver_cache_flashlight'],
    },
  },
]);

export function spawnDiverKot(
  world: World, entities: Entity[], nextId: { v: number },
): void {
  for (let i = 0; i < 3000; i++) {
    const x = Math.floor(Math.random() * W);
    const y = Math.floor(Math.random() * W);
    if (world.cells[world.idx(x, y)] !== Cell.FLOOR) continue;
    requireSpawnedPlotNpcFromPackage(entities, nextId, 'diver_kot', x + 0.5, y + 0.5, {
      angle: Math.random() * Math.PI * 2,
      weapon: 'knife',
      canGiveQuest: true,
      isTraveler: true,
    });
    return;
  }
}
