/* ── Тётя Клава — side quest (kvartiry floor) ─────────────────── */
/* Хозяйка-самогонщица. Скупает сахар, варит самогон.              */

import {
  W, Cell,
  type Entity, Faction, Occupation, QuestType,
} from '../../core/types';
import { World } from '../../core/world';
import { type PlotNpcDef, registerSideQuest } from '../../data/plot';
import { requireSpawnedPlotNpcFromPackage } from '../plot_npc_spawn';

const NPC_DEF: PlotNpcDef = {
  name: 'Тётя Клава',
  isFemale: true,
  faction: Faction.CITIZEN,
  occupation: Occupation.HOUSEWIFE,
  sprite: Occupation.HOUSEWIFE,
  hp: 90, maxHp: 90, money: 60, speed: 0.8,
  inventory: [
    { defId: 'kompot', count: 4 },
    { defId: 'kasha', count: 3 },
    { defId: 'cigs', count: 2 },
  ],
  talkLines: [
    'Заходи, только дверь не хлопай. У соседей слух лучше, чем у ликвидаторского рапорта.',
    'На кухне опять делят плиту. Я свою кастрюлю держу под кроватью, целее будет.',
    'Сахара нет, дрожжи злые, хлеб ещё терпит. Восемь буханок принесёшь - брага поднимется.',
    'Компот у меня не для праздника. Им руки греют после очереди и язык развязывают перед сделкой.',
    'Горланов шумит про рейды, а Серыгин нюхает бутылки. Поэтому говорим вполголоса.',
    'Если сирена пойдёт, самогон не спасёт. Но до гермы добежать с ним теплее.',
    'Дети сюда не заходят. Им сладкий запах вреднее правды.',
    'Хлеб не кради у Верыных потеряшек. У них и так угол вместо дома.',
  ],
  talkLinesPost: [
    'Хлеб пошёл в бочку. До следующей сирены кухня будет пахнуть не только страхом.',
    'Ликвидаторам про меня не шепчи. Они сначала опечатают, потом попробуют.',
    'Если голова трещит после коридора, спроси тихо. Таблетки у меня не на витрине.',
    'Компот бери и не греми бутылкой в очереди. Сухое стекло слышно далеко.',
  ],
};

registerSideQuest('tyotya_klava', NPC_DEF, [
  {
    id: 'klava_bread',
    giverNpcId: 'tyotya_klava',
    type: QuestType.FETCH,
    desc: 'Тётя Клава: «Восемь буханок хлеба в бочку. За это налью компота и не спрошу, откуда хлеб.»',
    targetItem: 'bread', targetCount: 8,
    rewardItem: 'kompot', rewardCount: 6,
    extraRewards: [
      { defId: 'pills', count: 3 },
      { defId: 'cigs', count: 3 },
    ],
    relationDelta: 15, xpReward: 40, moneyReward: 50,
  },
]);

export function spawnTyotyaKlava(
  world: World, entities: Entity[], nextId: { v: number },
): void {
  for (let i = 0; i < 3000; i++) {
    const x = Math.floor(Math.random() * W);
    const y = Math.floor(Math.random() * W);
    if (world.cells[world.idx(x, y)] !== Cell.FLOOR) continue;
    requireSpawnedPlotNpcFromPackage(entities, nextId, 'tyotya_klava', x + 0.5, y + 0.5, {
      angle: Math.random() * Math.PI * 2,
      canGiveQuest: true,
      isTraveler: true,
    });
    return;
  }
}
