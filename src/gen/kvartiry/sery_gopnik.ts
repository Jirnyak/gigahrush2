/* ── Серый Гопник — side quest (kvartiry floor) ───────────────── */
/* Дикий с района. «Слышь, есть закурить?»                        */

import {
  W, Cell,
  type Entity, Faction, Occupation, QuestType,
} from '../../core/types';
import { World } from '../../core/world';
import { type PlotNpcDef, registerSideQuest } from '../../data/plot';
import { requireSpawnedPlotNpcFromPackage } from '../plot_npc_spawn';

const NPC_DEF: PlotNpcDef = {
  name: 'Серый Гопник',
  isFemale: false,
  faction: Faction.WILD,
  occupation: Occupation.TRAVELER,
  sprite: Occupation.TRAVELER,
  hp: 130, maxHp: 130, money: 5, speed: 1.4,
  inventory: [
    { defId: 'knife', count: 1 },
    { defId: 'cigs', count: 1 },
  ],
  talkLines: [
    'Слышь, ты с какого пролёта? Тут чужих по скрипу двери считают.',
    'Это наш кусок коридора, пока пацаны у лифта и нижняя герма не заклинила.',
    'Закурить есть? Десять пачек неси - будешь проходить без лишних вопросов.',
    'Горланов орёт, Листовой бумагу сушит, а воду держит тот, кто держит проход.',
    'У нас порядок простой: сначала коридор, потом канистра, потом разговор.',
    'У кухни сегодня тесно. Не лезь с пустыми руками, там табурет быстрее слов.',
    'Ликвидатору я не друг. Но если он смотрит сюда, нож лучше держать в кармане.',
    'Соседи всё слышат. Поэтому улыбайся тихо и не звени бутылками.',
  ],
  talkLinesPost: [
    'Пачки на месте. Теперь тебя у лифта не тронут, если сам не начнёшь.',
    'Если прижмут у водораздачи, скажи: Серый видел. Иногда этого хватает.',
    'Сигареты сухие, значит сделка честная. Для этого этажа почти праздник.',
  ],
};

registerSideQuest('sery_gopnik', NPC_DEF, [
  {
    id: 'sery_cigs',
    giverNpcId: 'sery_gopnik',
    type: QuestType.FETCH,
    desc: 'Серый: «Десять пачек сигарет. Заплачу проходом у лифта и тишиной у водораздачи.»',
    targetItem: 'cigs', targetCount: 10,
    rewardItem: 'rebar', rewardCount: 1,
    extraRewards: [
      { defId: 'knife', count: 1 },
      { defId: 'kompot', count: 2 },
    ],
    relationDelta: 10, xpReward: 35, moneyReward: 30,
  },
]);

export function spawnSeryGopnik(
  world: World, entities: Entity[], nextId: { v: number },
): void {
  for (let i = 0; i < 3000; i++) {
    const x = Math.floor(Math.random() * W);
    const y = Math.floor(Math.random() * W);
    if (world.cells[world.idx(x, y)] !== Cell.FLOOR) continue;
    requireSpawnedPlotNpcFromPackage(entities, nextId, 'sery_gopnik', x + 0.5, y + 0.5, {
      angle: Math.random() * Math.PI * 2,
      weapon: 'knife',
      canGiveQuest: true,
      isTraveler: true,
    });
    return;
  }
}
