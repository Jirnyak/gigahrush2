/* ── Допросная — Ministry admin POI with ambush ───────────────── */

import {
  Tex,
  Feature,
  RoomType,
  Faction,
  Occupation,
  QuestType,
  MonsterKind,
  FloorLevel,
  type Entity,
} from '../../core/types';
import { World } from '../../core/world';
import { type PlotNpcDef, registerAuthoredNpc, registerSideQuest, storyNpcFloorKey } from '../../data/plot';
import {
  type NextId, createAdminRoom, setFeature, addItemDrop, spawnAdminNpc,
  spawnAdminMonster,
} from '../admin_common';
import { genLog } from '../log';

const HOME_FLOOR_KEY = storyNpcFloorKey(FloorLevel.MINISTRY);
const WITNESS_RIMMA_ID = 'interrogation_witness_rimma';

const LIDIYA_DEF: PlotNpcDef = {
  name: 'Лидия Протокольная',
  isFemale: true,
  faction: Faction.LIQUIDATOR,
  occupation: Occupation.HUNTER,
  sprite: Occupation.HUNTER,
  hp: 420, maxHp: 420, money: 260, speed: 1.05,
  inventory: [
    { defId: 'makarov', count: 1 },
    { defId: 'ammo_9mm', count: 18 },
    { defId: 'note', count: 2 },
  ],
  talkLines: [
    'Садитесь. Стул не обязан быть вашим, но он уже дал показания.',
    'Я Лидия Протокольная. Вопросы задаю я. Ответы иногда приходят из стены.',
    'Каждый протокол имеет тень. Если тень длиннее текста, мы зовем ликвидаторов.',
    'В шкафу сидит не подозреваемый. Там сидит версия событий, которую никто не подписал.',
    'Нужны бинты. Последний свидетель доказал, что бумага режет глубже стекла.',
    'Если услышите стук из портрета, не отвечайте фамилией.',
    'Я не повышаю голос. Комната сама усиливает нужные слова.',
    'Дверь открывается наружу только для тех, кто не изменил показания.',
  ],
  talkLinesPost: [
    'Бинты приняты. Допрос можно продолжать без лишних пятен.',
    'Вы отвечали быстро. Это подозрительно, но удобно.',
    'Когда протокол захочет выйти, стреляйте в петлю.',
  ],
};

const WITNESS_RIMMA_DEF: PlotNpcDef = {
  name: 'Понятая Римма Нулевая',
  isFemale: true,
  faction: Faction.CITIZEN,
  occupation: Occupation.SECRETARY,
  sprite: Occupation.SECRETARY,
  hp: 70, maxHp: 70, money: 15, speed: 0.8,
  inventory: [{ defId: 'note', count: 1 }],
  talkLines: [
    'Я понятая. Нулевая, потому что меня не было до протокола.',
    'В допросной каждый стул уже что-то подписал.',
  ],
  talkLinesPost: [
    'Если шкаф откроется снова, я этого не видела.',
  ],
};

registerSideQuest('lidiya_protokolnaya', LIDIYA_DEF, [
  {
    id: 'interrogation_bandages',
    giverNpcId: 'lidiya_protokolnaya',
    type: QuestType.FETCH,
    desc: 'Лидия Протокольная: «Три бинта в допросную. Бумага сегодня режет свидетелей.»',
    targetItem: 'bandage', targetCount: 3,
    rewardItem: 'ammo_9mm', rewardCount: 18,
    extraRewards: [{ defId: 'makarov', count: 1 }],
    relationDelta: 18, xpReward: 90, moneyReward: 160,
  },
  {
    id: 'interrogation_shadow_protocol',
    giverNpcId: 'lidiya_protokolnaya',
    type: QuestType.KILL,
    desc: 'Лидия Протокольная: «В допросной сорвался теневик. Убейте его, пока он не подписал нас.»',
    targetMonsterKind: MonsterKind.SHADOW,
    killNeeded: 1,
    rewardItem: 'psi_recall', rewardCount: 1,
    relationDelta: 22, xpReward: 120, moneyReward: 220,
  },
]);

registerAuthoredNpc({
  id: WITNESS_RIMMA_ID,
  npc: WITNESS_RIMMA_DEF,
  homeFloorKey: HOME_FLOOR_KEY,
  tags: ['ministry', 'interrogation', 'witness'],
});

export function generateInterrogationCloset(
  world: World, nextRoomId: number, entities: Entity[], nextId: NextId, spawnX: number, spawnY: number,
): { nextRoomId: number } {
  const room = createAdminRoom(world, nextRoomId, spawnX, spawnY, {
    type: RoomType.OFFICE,
    name: 'Допросная',
    w: 7, h: 6,
    minDist: 55, maxDist: 145,
    wallTex: Tex.MARBLE,
    floorTex: Tex.F_MARBLE_TILE,
  });
  if (!room) return { nextRoomId };

  const cx = room.x + Math.floor(room.w / 2);
  const cy = room.y + Math.floor(room.h / 2);
  setFeature(world, cx, cy, Feature.TABLE);
  setFeature(world, cx - 1, cy, Feature.CHAIR);
  setFeature(world, cx + 1, cy, Feature.CHAIR);
  setFeature(world, room.x + 1, room.y + 1, Feature.DESK);
  setFeature(world, room.x + room.w - 2, room.y + 1, Feature.LAMP);
  setFeature(world, room.x + room.w - 2, room.y + room.h - 2, Feature.SHELF);
  world.wallTex[world.idx(cx, room.y - 1)] = Tex.PORTRAIT_BASE + 7;

  addItemDrop(entities, nextId, room.x + 1, room.y + room.h - 2, 'note', 1);
  addItemDrop(entities, nextId, room.x + room.w - 2, room.y + 2, 'bandage', 1);
  spawnAdminNpc(entities, nextId, LIDIYA_DEF, 'lidiya_protokolnaya', cx + 1, cy - 1, true, 'makarov');
  spawnAdminNpc(entities, nextId, WITNESS_RIMMA_DEF, WITNESS_RIMMA_ID, cx - 1, cy + 1, false);

  // Static ambush: already active on floor generation, no quest-engine hook needed.
  spawnAdminMonster(world, entities, nextId, room.x + room.w - 2, room.y + room.h - 2, MonsterKind.SHADOW);
  spawnAdminMonster(world, entities, nextId, room.x + 1, room.y + room.h - 2, MonsterKind.ZOMBIE);

  genLog(`[MINISTRY_ADMIN] ${room.name} at (${room.x}, ${room.y}) room #${room.id}`);
  return { nextRoomId: room.id + 1 };
}
