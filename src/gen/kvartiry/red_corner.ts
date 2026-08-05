/* ── Красный уголок — permanent room (kvartiry floor) ─────────── */
/* Bolshie Stalin'ist common room with portraits, lamps, desk and  */
/* a teacher NPC. Hand-crafted, protected with aptMask.            */

import {
  Cell, Tex, Feature, FloorLevel, RoomType,
  type Room, type Entity,
  EntityType, Faction, Occupation, QuestType,
} from '../../core/types';
import { World } from '../../core/world';
import { type PlotNpcDef, registerAuthoredNpc, registerSideQuest, storyNpcFloorKey } from '../../data/plot';
import { stampRoom, protectRoom, connectProtectedRoom, findClearArea } from '../shared';
import { Spr } from '../../render/sprite_index';
import { genLog } from '../log';
import { requireSpawnedPlotNpcFromPackage } from '../plot_npc_spawn';

const ZOYA_ID = 'uchitelnitsa_zoya';
const STUDENT_PETYA_ID = 'red_corner_student_petya';
const STUDENT_MASHA_ID = 'red_corner_student_masha';

const NPC_DEF: PlotNpcDef = {
  name: 'Учительница Зоя',
  isFemale: true,
  faction: Faction.SCIENTIST,
  occupation: Occupation.SCIENTIST,
  sprite: Occupation.SCIENTIST,
  hp: 100, maxHp: 100, money: 50, speed: 0.8,
  inventory: [
    { defId: 'book', count: 6 },
    { defId: 'note', count: 4 },
    { defId: 'tea', count: 2 },
    { defId: 'antidep', count: 1 },
  ],
  talkLines: [
    'Здравствуйте. Зоя Аркадьевна. Красный уголок теперь класс, склад и тихая очередь одновременно.',
    'Дети сюда заходят редко: после сирены они сначала смотрят на дверь, потом на доску.',
    'Нужно двадцать пять бюллетеней. Не для выборов, для упражнения: фамилия, дата, кто видел.',
    'Листовой сушит подписи, Горланов считает тени. Я учу детей не терять строку в списке.',
    'Если в тетради пустая клетка, туда быстро вписывают чужое решение.',
    'На перемене не бегают. На перемене слушают, не идёт ли обход по коридору.',
    'Учебники отсырели, но буквы ещё держатся. Люди хуже держатся без букв.',
    'Кто умеет читать ведомость, тот хотя бы понимает, когда его уже продали.',
  ],
  talkLinesPost: [
    'Спасибо. Теперь класс проведёт диктант по бюллетеням, без крика из коридора.',
    'Возьмите чая. Холодный, зато не из стояка.',
    'Если найдёте старые учебники, несите сухими. Мокрые я уже спасаю по листу.',
    'Дети увидят, что бумагу можно заполнять, а не только бояться.',
  ],
};

registerSideQuest(ZOYA_ID, NPC_DEF, [
  {
    id: 'zoya_ballots',
    giverNpcId: ZOYA_ID,
    type: QuestType.FETCH,
    desc: 'Зоя Аркадьевна: «Принесите 25 бюллетеней. Дети будут учиться считать людей, а не только талоны.»',
    targetItem: 'ballot', targetCount: 25,
    rewardItem: 'psi_strike', rewardCount: 1,
    extraRewards: [
      { defId: 'book', count: 4 },
      { defId: 'note', count: 5 },
      { defId: 'antidep', count: 2 },
    ],
    relationDelta: 22, xpReward: 70, moneyReward: 120,
  },
]);

const STUDENT_DEFS: readonly { id: string; npc: PlotNpcDef }[] = [
  {
    id: STUDENT_PETYA_ID,
    npc: {
      name: 'Ученик Петя',
      isFemale: false,
      age: 10,
      sex: 'male',
      faction: Faction.CITIZEN,
      occupation: Occupation.CHILD,
      sprite: Occupation.CHILD,
      hp: 30, maxHp: 30, money: 5, speed: 0.8,
      inventory: [{ defId: 'note', count: 1 }, { defId: 'bread', count: 1 }],
      talkLines: ['Петя держит тетрадь двумя руками и смотрит на дверь.'],
      talkLinesPost: ['Петя переписывает бюллетень медленно, чтобы бумага не рвалась.'],
    },
  },
  {
    id: STUDENT_MASHA_ID,
    npc: {
      name: 'Ученица Маша',
      isFemale: true,
      age: 10,
      sex: 'female',
      faction: Faction.CITIZEN,
      occupation: Occupation.CHILD,
      sprite: Occupation.CHILD,
      hp: 30, maxHp: 30, money: 5, speed: 0.8,
      inventory: [{ defId: 'note', count: 1 }, { defId: 'bread', count: 1 }],
      talkLines: ['Маша закрывает строку ладонью, когда в коридоре шумят сапоги.'],
      talkLinesPost: ['Маша уже умеет писать фамилии ровно, даже когда стена гудит.'],
    },
  },
];

for (const student of STUDENT_DEFS) {
  registerAuthoredNpc({
    id: student.id,
    npc: student.npc,
    homeFloorKey: storyNpcFloorKey(FloorLevel.KVARTIRY),
    tags: ['kvartiry', 'red_corner', 'student'],
  });
}

const ROOM_W = 13;
const ROOM_H = 9;

export function generateRedCorner(
  world: World, nextRoomId: number, entities: Entity[], nextId: { v: number },
  spawnX: number, spawnY: number,
): { nextRoomId: number } {
  const cx = Math.floor(spawnX);
  const cy = Math.floor(spawnY);
  const pos = findClearArea(world, cx, cy, ROOM_W, ROOM_H, 25, 90);
  const rx = pos ? pos.x : world.wrap(cx + 40);
  const ry = pos ? pos.y : world.wrap(cy + 40);

  const room: Room = stampRoom(world, nextRoomId, RoomType.COMMON, rx, ry, ROOM_W, ROOM_H, -1);
  room.name = 'Красный уголок';
  room.wallTex = Tex.PANEL;
  room.floorTex = Tex.F_CARPET;
  protectRoom(world, rx, ry, ROOM_W, ROOM_H, Tex.PANEL, Tex.F_CARPET);
  connectProtectedRoom(world, rx, ry, ROOM_W, ROOM_H);

  // Pure red carpet floor
  for (let dy = 0; dy < ROOM_H; dy++) {
    for (let dx = 0; dx < ROOM_W; dx++) {
      world.floorTex[world.idx(rx + dx, ry + dy)] = Tex.F_CARPET;
    }
  }

  // Lamps in corners + center
  world.features[world.idx(rx + 1, ry + 1)] = Feature.LAMP;
  world.features[world.idx(rx + ROOM_W - 2, ry + 1)] = Feature.LAMP;
  world.features[world.idx(rx + 1, ry + ROOM_H - 2)] = Feature.LAMP;
  world.features[world.idx(rx + ROOM_W - 2, ry + ROOM_H - 2)] = Feature.LAMP;

  // Lectern (DESK + CHAIR) at the front
  const fcx = rx + Math.floor(ROOM_W / 2);
  world.features[world.idx(fcx, ry + 1)] = Feature.DESK;
  world.features[world.idx(fcx, ry + 2)] = Feature.CHAIR;

  // Two rows of student "chairs" (3 per row)
  for (let row = 0; row < 2; row++) {
    const cy2 = ry + 4 + row * 2;
    for (let col = 0; col < 3; col++) {
      const cx2 = rx + 3 + col * 3;
      const ci = world.idx(cx2, cy2);
      if (world.cells[ci] === Cell.FLOOR && world.features[ci] === 0) {
        world.features[ci] = Feature.CHAIR;
      }
    }
  }

  // Bookshelves along the back wall
  for (let dx = 1; dx < ROOM_W - 1; dx++) {
    if (dx === Math.floor(ROOM_W / 2)) continue;
    const ci = world.idx(rx + dx, ry + ROOM_H - 2);
    if (world.cells[ci] === Cell.FLOOR && world.features[ci] === 0) {
      world.features[ci] = Feature.SHELF;
    }
  }

  // Loot scattered: ballots, books, notes — thematically rich
  const lootPool = [
    'ballot', 'ballot', 'ballot', 'ballot',
    'book', 'book', 'note', 'note', 'tea', 'antidep',
  ];
  for (const defId of lootPool) {
    for (let attempt = 0; attempt < 30; attempt++) {
      const lx = rx + 1 + Math.floor(Math.random() * (ROOM_W - 2));
      const ly = ry + 1 + Math.floor(Math.random() * (ROOM_H - 2));
      const ci = world.idx(lx, ly);
      if (world.cells[ci] !== Cell.FLOOR || world.features[ci]) continue;
      entities.push({
        id: nextId.v++, type: EntityType.ITEM_DROP,
        x: lx + 0.5, y: ly + 0.5, angle: 0, pitch: 0, alive: true, speed: 0, sprite: Spr.ITEM_DROP,
        inventory: [{ defId, count: 1 }],
      });
      break;
    }
  }

  // Teacher NPC at the lectern
  requireSpawnedPlotNpcFromPackage(entities, nextId, ZOYA_ID, fcx + 0.5, ry + 2 + 0.5, {
    angle: Math.PI / 2,
    canGiveQuest: true,
  });

  // Two student NPCs (children)
  const studentPositions = [
    { x: rx + 3, y: ry + 4, id: STUDENT_PETYA_ID },
    { x: rx + 9, y: ry + 4, id: STUDENT_MASHA_ID },
  ];
  for (const s of studentPositions) {
    requireSpawnedPlotNpcFromPackage(entities, nextId, s.id, s.x + 0.5, s.y + 0.5, {
      angle: -Math.PI / 2,
      canGiveQuest: false,
      extra: { spriteScale: 0.6 },
    });
  }

  genLog(`[RED_CORNER] at (${rx}, ${ry}) room #${room.id}`);
  return { nextRoomId: Math.max(nextRoomId, room.id + 1) };
}
