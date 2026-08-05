/* ── Архивариус Кафкин — side quest (ministry floor) ──────────── */
/* Старый архивариус. Ищет потерянные дела (записки).              */

import {
  W, Cell,
  type Entity, Faction, Occupation, QuestType,
} from '../../core/types';
import { World } from '../../core/world';
import { type PlotNpcDef, registerSideQuest } from '../../data/plot';
import { requireSpawnedPlotNpcFromPackage } from '../plot_npc_spawn';

const NPC_DEF: PlotNpcDef = {
  name: 'Архивариус Кафкин',
  isFemale: false,
  faction: Faction.CITIZEN,
  occupation: Occupation.SECRETARY,
  sprite: Occupation.SECRETARY,
  hp: 80, maxHp: 80, money: 200, speed: 0.6,
  inventory: [
    { defId: 'note', count: 6 },
    { defId: 'book', count: 3 },
    { defId: 'tea', count: 2 },
  ],
  talkLines: [
    'А-а, посетитель… Простите, у вас допуск формы 7-Б? Без него — никак.',
    'Я Кафкин. Архивариус. Каталогизирую дела с... да, с конца сорок девятого.',
    'Дела пропадают. Шкаф №14 вчера был. Сегодня его нет. И стена на его месте.',
    'Десять записок. Принесите. Любых. Я подошью в дело — так положено.',
    'Иначе формуляр не закроется. Иначе — БЕССОННИЦА. А я и так не сплю.',
  ],
  talkLinesPost: [
    'Дело подшито. Формуляр закрыт. Спасибо.',
    'Если найдёте странные документы — несите. Любые.',
    'Тише в коридоре. Министр Ротенбергов не любит шума.',
  ],
};

registerSideQuest('arkhivarius_kafkin', NPC_DEF, [
  {
    id: 'kafkin_notes',
    giverNpcId: 'arkhivarius_kafkin',
    type: QuestType.FETCH,
    desc: 'Кафкин: «Десять записок. Подошью в дело. Иначе формуляр не закроется.»',
    targetItem: 'note', targetCount: 10,
    rewardItem: 'psi_mark', rewardCount: 1,
    extraRewards: [
      { defId: 'psi_recall', count: 1 },
      { defId: 'book', count: 3 },
      { defId: 'antidep', count: 2 },
    ],
    relationDelta: 18, xpReward: 90, moneyReward: 250,
  },
]);

export function spawnArkhivariusKafkin(
  world: World, entities: Entity[], nextId: { v: number },
): void {
  for (let i = 0; i < 3000; i++) {
    const x = Math.floor(Math.random() * W);
    const y = Math.floor(Math.random() * W);
    if (world.cells[world.idx(x, y)] !== Cell.FLOOR) continue;
    if (world.roomMap[world.idx(x, y)] < 0 && i < 2000) continue; // prefer rooms
    requireSpawnedPlotNpcFromPackage(entities, nextId, 'arkhivarius_kafkin', x + 0.5, y + 0.5, {
      angle: Math.random() * Math.PI * 2,
      canGiveQuest: true,
    });
    return;
  }
}
