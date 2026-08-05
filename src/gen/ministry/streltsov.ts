/* ── Полковник Стрельцов — side quest (ministry floor) ────────── */
/* Заместитель министра по безопасности. Спецоперации по духам.    */

import {
  W, Cell,
  type Entity, Faction, FloorLevel, Occupation, QuestType, MonsterKind,
} from '../../core/types';
import { World } from '../../core/world';
import { type PlotNpcDef, registerAuthoredNpc, storyNpcFloorKey } from '../../data/plot';
import { requireSpawnedPlotNpcFromPackage } from '../plot_npc_spawn';

const NPC_ID = 'polkovnik_streltsov';

const NPC_DEF: PlotNpcDef = {
  name: 'Полковник Стрельцов',
  isFemale: false,
  faction: Faction.LIQUIDATOR,
  occupation: Occupation.HUNTER,
  sprite: Occupation.HUNTER,
  hp: 800, maxHp: 800, money: 500, speed: 1.3,
  inventory: [
    { defId: 'ppsh', count: 1 },
    { defId: 'ammo_9mm', count: 50 },
    { defId: 'grenade', count: 2 },
    { defId: 'bandage', count: 3 },
  ],
  talkLines: [
    'Полковник Стрельцов. Заместитель министра по особым операциям. Слушаю.',
    'У нас проблема. Духи. Не привидения — настоящие, проходящие сквозь мрамор.',
    'Их записали за портретной галереей, но в зачёт идут любые четыре подтвержденных духа.',
    'Уничтожь четырёх. Это спецзадание. Я лично прослежу за наградой.',
  ],
  talkLinesPost: [
    'Спецоперация выполнена на «отлично». Министр доволен.',
    'Если снова увидите духов, держите дистанцию и докладывайте живым.',
    'Ты теперь в личном резерве. Это привилегия.',
  ],
};

registerAuthoredNpc({
  id: NPC_ID,
  npc: NPC_DEF,
  homeFloorKey: storyNpcFloorKey(FloorLevel.MINISTRY),
  tags: ['ministry', 'liquidator'],
  quests: [
    {
      id: 'streltsov_spirits',
      giverNpcId: NPC_ID,
      type: QuestType.KILL,
      desc: 'Стрельцов: «Четыре духа. Где встретите - там и уничтожить.»',
      targetMonsterKind: MonsterKind.SPIRIT,
      killNeeded: 4,
      rewardItem: 'gauss', rewardCount: 1,
      extraRewards: [
        { defId: 'ammo_energy', count: 4 },
        { defId: 'grenade', count: 3 },
        { defId: 'bandage', count: 4 },
      ],
      relationDelta: 25, xpReward: 150, moneyReward: 800,
    },
  ],
});

export function spawnPolkovnikStreltsov(
  world: World, entities: Entity[], nextId: { v: number },
): void {
  for (let i = 0; i < 3000; i++) {
    const x = Math.floor(Math.random() * W);
    const y = Math.floor(Math.random() * W);
    if (world.cells[world.idx(x, y)] !== Cell.FLOOR) continue;
    if (world.roomMap[world.idx(x, y)] < 0 && i < 2000) continue;
    requireSpawnedPlotNpcFromPackage(entities, nextId, NPC_ID, x + 0.5, y + 0.5, {
      angle: Math.random() * Math.PI * 2,
      weapon: 'ppsh',
      canGiveQuest: true,
    });
    return;
  }
}
