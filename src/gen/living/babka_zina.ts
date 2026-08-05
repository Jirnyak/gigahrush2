/* ── Бабка Зина — side quest content module ───────────────────── */
/* Старушка раздаёт пирожки в обмен на бинты для соседей.          */

import {
  W, Cell,
  type Entity, Faction, Occupation, QuestType,
} from '../../core/types';
import { World } from '../../core/world';
import { type PlotNpcDef, registerSideQuest } from '../../data/plot';
import { requireSpawnedPlotNpcFromPackage } from '../plot_npc_spawn';

const NPC_DEF: PlotNpcDef = {
  name: 'Бабка Зина',
  isFemale: true,
  faction: Faction.CITIZEN,
  occupation: Occupation.HOUSEWIFE,
  sprite: Occupation.HOUSEWIFE,
  hp: 60, maxHp: 60, money: 25, speed: 0.7,
  inventory: [
    { defId: 'kasha', count: 4 },
    { defId: 'bread', count: 3 },
    { defId: 'tea', count: 2 },
  ],
  talkLines: [
    'Ох, милок, как же тут страшно стало… При Брежневе такого не было.',
    'Я тут пирожки раздаю. С капустой, с картошкой. Бери, не стесняйся.',
    'Соседушки болеют. Кашляют. Кровь у Митрофановны опять пошла.',
    'Ты бы бинтов мне принёс, а? Я тебе кашки дам, хлебушка свежего.',
  ],
  talkLinesPost: [
    'Спасибо, родной! Митрофановна теперь до самосбора дотянет.',
    'Заходи на чай. Чайник я грею на свечке — газ давно отключили.',
    'Ты добрый. Не как эти ликвидаторы. Те только орут.',
  ],
};

registerSideQuest('babka_zina', NPC_DEF, [
  {
    id: 'zina_bandages',
    giverNpcId: 'babka_zina',
    type: QuestType.FETCH,
    desc: 'Бабка Зина: «Принеси три бинтика, голубчик. Соседушкам надо.»',
    targetItem: 'bandage', targetCount: 3,
    rewardItem: 'kasha', rewardCount: 5,
    extraRewards: [{ defId: 'bread', count: 3 }, { defId: 'cigs', count: 1 }],
    relationDelta: 15, xpReward: 25, moneyReward: 20,
  },
]);

export function spawnBabkaZina(
  world: World, entities: Entity[], nextId: { v: number },
): void {
  for (let i = 0; i < 2000; i++) {
    const x = Math.floor(Math.random() * W);
    const y = Math.floor(Math.random() * W);
    if (world.cells[world.idx(x, y)] !== Cell.FLOOR) continue;
    requireSpawnedPlotNpcFromPackage(entities, nextId, 'babka_zina', x + 0.5, y + 0.5, {
      angle: Math.random() * Math.PI * 2,
      canGiveQuest: true,
      isTraveler: true,
    });
    return;
  }
}
