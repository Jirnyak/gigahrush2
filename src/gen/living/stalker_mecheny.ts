/* ── Сталкер Меченый — side quest content module ──────────────── */
/* Артефактоискатель скупает идолов Чернобога за пси-сгустки.      */

import {
  W, Cell,
  type Entity, Faction, Occupation, QuestType,
} from '../../core/types';
import { World } from '../../core/world';
import { type PlotNpcDef, designNpcFloorKey, registerAuthoredNpc } from '../../data/plot';
import { requireSpawnedPlotNpcFromPackage } from '../plot_npc_spawn';

const NPC_ID = 'stalker_mecheny';

const NPC_DEF: PlotNpcDef = {
  name: 'Сталкер Меченый',
  isFemale: false,
  faction: Faction.CITIZEN,
  occupation: Occupation.TRAVELER,
  sprite: Occupation.TRAVELER,
  hp: 180, maxHp: 180, money: 200, speed: 1.3,
  inventory: [
    { defId: 'makarov', count: 1 },
    { defId: 'ammo_9mm', count: 12 },
    { defId: 'psi_strike', count: 1 },
    { defId: 'antidep', count: 1 },
  ],
  talkLines: [
    'Тише. Не ори. Меня тут не было.',
    'Зовут Меченым. Хожу глубоко: лифт, коллектор, два мокрых коридора и лестница без таблички.',
    'Идолы Чернобога — настоящая валюта. Не эти бумажки.',
    'Принесёшь три штуки — отдам пси-сгусток. Хороший. Из лаборатории.',
    'Только не из храма таскай. Батюшка проклянёт. Я знаю — у меня шрам на спине.',
  ],
  talkLinesPost: [
    'Хорошая сделка. Идолы я в схрон сложу.',
    'Если опять найдёшь — приходи. Цену не сбавлю.',
    'Меня тут не было. Запомни.',
  ],
};

registerAuthoredNpc({
  id: NPC_ID,
  npc: NPC_DEF,
  homeFloorKey: designNpcFloorKey('black_market_88'),
  tags: ['black_market_88', 'artifact'],
  quests: [
    {
      id: 'mecheny_idols',
      giverNpcId: NPC_ID,
      type: QuestType.FETCH,
      desc: 'Меченый: «Три идола Чернобога. Цена — пси-сгусток и патроны. Без вопросов.»',
      targetItem: 'idol_chernobog', targetCount: 3,
      rewardItem: 'psi_madness', rewardCount: 1,
      extraRewards: [{ defId: 'ammo_9mm', count: 16 }, { defId: 'antidep', count: 1 }],
      relationDelta: 10, xpReward: 80, moneyReward: 150,
    },
  ],
});

export function spawnStalkerMecheny(
  world: World, entities: Entity[], nextId: { v: number },
): void {
  for (let i = 0; i < 2000; i++) {
    const x = Math.floor(Math.random() * W);
    const y = Math.floor(Math.random() * W);
    if (world.cells[world.idx(x, y)] !== Cell.FLOOR) continue;
    requireSpawnedPlotNpcFromPackage(entities, nextId, NPC_ID, x + 0.5, y + 0.5, {
      angle: Math.random() * Math.PI * 2,
      weapon: 'makarov',
      canGiveQuest: true,
      isTraveler: true,
    });
    return;
  }
}
