/* ── Затопленная лаборатория — permanent room (maintenance) ───── */
/* Hand-crafted scientific lab built into the maintenance maze.    */
/* NPC: Профессор Тесла — gives FETCH quest for energy cells.      */

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

const PROFESSOR_ID = 'prof_tesla';
const ASSISTANT_KLIM_ID = 'flooded_lab_assistant_klim';
const ASSISTANT_SONYA_ID = 'flooded_lab_assistant_sonya';

/* ── NPC definition ──────────────────────────────────────────── */
const NPC_DEF: PlotNpcDef = {
  name: 'Профессор Тесла',
  isFemale: false,
  faction: Faction.SCIENTIST,
  occupation: Occupation.SCIENTIST,
  sprite: Occupation.SCIENTIST,
  hp: 160, maxHp: 160, money: 150, speed: 0.7,
  inventory: [
    { defId: 'psi_strike', count: 1 },
    { defId: 'antidep', count: 2 },
    { defId: 'pills', count: 3 },
    { defId: 'note', count: 3 },
  ],
  talkLines: [
    'А-а, гость. Заходите, только не в лужу: генератор опять пробивает на пол.',
    'Я профессор Тесла. Не тот, разумеется. Но фамилия обязывает.',
    'Я собираю ПСИ-излучатель из шкафов, катушек и чужих актов списания. Пока он только гудит и сушит плесень.',
    'Нужны энергоячейки. Пять штук. Принесите - отдам прототип ПСИ-луча. Держать как резак, не как сувенир.',
  ],
  talkLinesPost: [
    'Излучатель работает. Тише. Слышите гул? Это не победа, это катушка наконец попала в частоту.',
    'Возьмите ещё ячейку. В журнале она всё равно числится утонувшей.',
    'Если найдёте странные сгустки - несите в банке. Без банки это уже не наука, а уборка.',
  ],
};

registerSideQuest(PROFESSOR_ID, NPC_DEF, [
  {
    id: 'tesla_energy',
    giverNpcId: PROFESSOR_ID,
    type: QuestType.FETCH,
    desc: 'Тесла: «Пять энергоячеек. Без них ПСИ-излучатель останется мокрой кучей проводов.»',
    targetItem: 'ammo_energy', targetCount: 5,
    rewardItem: 'psi_beam', rewardCount: 1,
    extraRewards: [
      { defId: 'antidep', count: 3 },
      { defId: 'pills', count: 4 },
      { defId: 'bandage', count: 4 },
    ],
    relationDelta: 25, xpReward: 120, moneyReward: 200,
  },
]);

const ASSISTANT_DEFS: readonly { id: string; npc: PlotNpcDef }[] = [
  {
    id: ASSISTANT_KLIM_ID,
    npc: {
      name: 'Лаборант Клим',
      isFemale: false,
      sex: 'male',
      faction: Faction.SCIENTIST,
      occupation: Occupation.SCIENTIST,
      sprite: Occupation.SCIENTIST,
      hp: 80, maxHp: 80, money: 20, speed: 1.0,
      inventory: [{ defId: 'note', count: 1 }, { defId: 'antidep', count: 1 }],
      talkLines: ['Клим держит блокнот выше воды и делает вид, что генератор не бьет током.'],
      talkLinesPost: ['Клим сушит записи над лампой и не доверяет отражениям в луже.'],
    },
  },
  {
    id: ASSISTANT_SONYA_ID,
    npc: {
      name: 'Лаборант Соня',
      isFemale: true,
      sex: 'female',
      faction: Faction.SCIENTIST,
      occupation: Occupation.SCIENTIST,
      sprite: Occupation.SCIENTIST,
      hp: 80, maxHp: 80, money: 20, speed: 1.0,
      inventory: [{ defId: 'note', count: 1 }, { defId: 'antidep', count: 1 }],
      talkLines: ['Соня отмечает уровень воды и просит не трогать катушки мокрыми руками.'],
      talkLinesPost: ['Соня уже подписала ячейки как утонувшие, чтобы лаборатория могла работать дальше.'],
    },
  },
];

for (const assistant of ASSISTANT_DEFS) {
  registerAuthoredNpc({
    id: assistant.id,
    npc: assistant.npc,
    homeFloorKey: storyNpcFloorKey(FloorLevel.MAINTENANCE),
    tags: ['maintenance', 'flooded_lab', 'assistant'],
  });
}

/* ── Generate Затопленная лаборатория ─────────────────────────── */
const LAB_W = 11;
const LAB_H = 9;

export function generateFloodedLab(
  world: World, nextRoomId: number, entities: Entity[], nextId: { v: number },
  spawnX: number, spawnY: number,
): { nextRoomId: number } {
  const cx = Math.floor(spawnX);
  const cy = Math.floor(spawnY);

  const pos = findClearArea(world, cx, cy, LAB_W, LAB_H, 30, 80);
  const labX = pos ? pos.x : world.wrap(cx + 50);
  const labY = pos ? pos.y : world.wrap(cy + 50);

  const room: Room = stampRoom(world, nextRoomId, RoomType.MEDICAL, labX, labY, LAB_W, LAB_H, -1);
  room.name = 'Затопленная лаборатория';
  room.wallTex = Tex.METAL;
  room.floorTex = Tex.F_TILE;
  protectRoom(world, labX, labY, LAB_W, LAB_H, Tex.METAL, Tex.F_TILE);
  connectProtectedRoom(world, labX, labY, LAB_W, LAB_H);

  // Floor: tile with water puddles in the corners
  for (let dy = 0; dy < LAB_H; dy++) {
    for (let dx = 0; dx < LAB_W; dx++) {
      const ci = world.idx(labX + dx, labY + dy);
      world.floorTex[ci] = Tex.F_TILE;
    }
  }
  // Two water puddles (passable WATER cells) in opposite corners
  const puddles: [number, number][] = [
    [labX + 1, labY + 1],
    [labX + 1, labY + LAB_H - 2],
    [labX + LAB_W - 2, labY + 1],
    [labX + LAB_W - 2, labY + LAB_H - 2],
  ];
  for (const [px, py] of puddles) {
    const ci = world.idx(px, py);
    world.cells[ci] = Cell.WATER;
    world.floorTex[ci] = Tex.F_WATER;
  }

  // Lamps
  const rcx = labX + Math.floor(LAB_W / 2);
  const rcy = labY + Math.floor(LAB_H / 2);
  world.features[world.idx(rcx, rcy - 1)] = Feature.LAMP;
  world.features[world.idx(labX + 2, labY + Math.floor(LAB_H / 2))] = Feature.LAMP;
  world.features[world.idx(labX + LAB_W - 3, labY + Math.floor(LAB_H / 2))] = Feature.LAMP;

  // Workbenches: row of MACHINE/APPARATUS/SHELF along the back wall
  for (let dx = 2; dx < LAB_W - 2; dx++) {
    const ci = world.idx(labX + dx, labY + 1);
    if (world.cells[ci] !== Cell.FLOOR) continue;
    if (dx % 3 === 0)      world.features[ci] = Feature.MACHINE;
    else if (dx % 3 === 1) world.features[ci] = Feature.APPARATUS;
    else                   world.features[ci] = Feature.SHELF;
  }
  // Front: desk + chair (consultation point)
  world.features[world.idx(rcx, rcy + 1)] = Feature.DESK;
  world.features[world.idx(rcx - 1, rcy + 1)] = Feature.CHAIR;
  world.features[world.idx(rcx + 1, rcy + 1)] = Feature.CHAIR;

  // Loot scattered: a few notes, an antidep, an energy cell
  const lootPool = ['note', 'note', 'antidep', 'pills', 'bandage', 'ammo_energy', 'psi_strike', 'tea'];
  for (const defId of lootPool) {
    for (let attempt = 0; attempt < 30; attempt++) {
      const lx = labX + 1 + Math.floor(Math.random() * (LAB_W - 2));
      const ly = labY + 1 + Math.floor(Math.random() * (LAB_H - 2));
      const ci = world.idx(lx, ly);
      if (world.cells[ci] !== Cell.FLOOR) continue;
      if (world.features[ci]) continue;
      entities.push({
        id: nextId.v++, type: EntityType.ITEM_DROP,
        x: lx + 0.5, y: ly + 0.5, angle: 0, pitch: 0, alive: true, speed: 0, sprite: Spr.ITEM_DROP,
        inventory: [{ defId, count: 1 }],
      });
      break;
    }
  }

  // NPC: Профессор Тесла in the center
  requireSpawnedPlotNpcFromPackage(entities, nextId, PROFESSOR_ID, rcx + 0.5, rcy + 0.5, {
    angle: Math.PI / 2,
    canGiveQuest: true,
  });

  // Two assistant scientist NPCs (named, lower HP, no quests)
  const assistants = [
    { id: ASSISTANT_KLIM_ID, x: labX + 2, y: rcy + 1 },
    { id: ASSISTANT_SONYA_ID, x: labX + LAB_W - 3, y: rcy + 1 },
  ];
  for (const a of assistants) {
    requireSpawnedPlotNpcFromPackage(entities, nextId, a.id, a.x + 0.5, a.y + 0.5, {
      angle: Math.PI / 2,
      canGiveQuest: false,
    });
  }

  genLog(`[FLOODED_LAB] at (${labX}, ${labY}) room #${room.id}`);
  const usedId = Math.max(nextRoomId, room.id + 1);
  return { nextRoomId: usedId };
}
