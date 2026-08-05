/* ── Буфетчица Глафира — side quest (ministry floor) ──────────── */
/* Работает в министерском буфете. Вечно не хватает компота.       */

import {
  W, Cell,
  type Entity, Faction, Occupation, QuestType,
} from '../../core/types';
import { World } from '../../core/world';
import { type PlotNpcDef, registerSideQuest } from '../../data/plot';
import { requireSpawnedPlotNpcFromPackage } from '../plot_npc_spawn';

const NPC_DEF: PlotNpcDef = {
  name: 'Буфетчица Глафира',
  isFemale: true,
  faction: Faction.CITIZEN,
  occupation: Occupation.COOK,
  sprite: Occupation.COOK,
  hp: 120, maxHp: 120, money: 80, speed: 0.9,
  inventory: [
    { defId: 'kompot', count: 3 },
    { defId: 'kasha', count: 2 },
    { defId: 'bread', count: 4 },
    { defId: 'knife', count: 1 },
  ],
  talkLines: [
    'Здравствуйте, мужчина! Вы по обеду или с жалобой? У нас всё по талонам.',
    'Я Глафира. Тридцать лет на буфете. Всех министров застала. И всех тварей.',
    'Беда у нас. Компот кончается. Кладовщик исчез — третий день нет привоза.',
    'Принесите шесть компотов. Где найдёте — там и берите. Министр без компота — зверь.',
    'А я вам котлет накину. И, может, секретик расскажу про директора.',
  ],
  talkLinesPost: [
    'Кушайте, голубчик. Котлеты сегодня свежие. Почти.',
    'Директор-то? Он, говорят, в архиве с привидением гуляет. Но молчок.',
    'Вы заходите. Всегда чаю налью.',
  ],
};

registerSideQuest('bufetchitsa_glafira', NPC_DEF, [
  {
    id: 'glafira_kompot',
    giverNpcId: 'bufetchitsa_glafira',
    type: QuestType.FETCH,
    desc: 'Глафира: «Шесть компотов в буфет. Министр без компота — зверь.»',
    targetItem: 'kompot', targetCount: 6,
    rewardItem: 'canned', rewardCount: 5,
    extraRewards: [
      { defId: 'kasha', count: 4 },
      { defId: 'tea', count: 3 },
      { defId: 'antidep', count: 1 },
    ],
    relationDelta: 14, xpReward: 60, moneyReward: 180,
  },
]);

export function spawnBufetchitsaGlafira(
  world: World, entities: Entity[], nextId: { v: number },
): void {
  for (let i = 0; i < 3000; i++) {
    const x = Math.floor(Math.random() * W);
    const y = Math.floor(Math.random() * W);
    if (world.cells[world.idx(x, y)] !== Cell.FLOOR) continue;
    if (world.roomMap[world.idx(x, y)] < 0 && i < 2000) continue;
    requireSpawnedPlotNpcFromPackage(entities, nextId, 'bufetchitsa_glafira', x + 0.5, y + 0.5, {
      angle: Math.random() * Math.PI * 2,
      canGiveQuest: true,
    });
    return;
  }
}
