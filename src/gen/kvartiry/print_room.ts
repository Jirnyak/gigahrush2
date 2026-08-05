/* ── Нелегальная типография — Kvartiry social pressure POI ───── */

import {
  Tex,
  Feature,
  RoomType,
  Faction,
  Occupation,
  QuestType,
} from '../../core/types';
import { World } from '../../core/world';
import { type Entity } from '../../core/types';
import { type PlotNpcDef, registerSideQuest } from '../../data/plot';
import { createSocialPoiRoom, placeDropNear, setFeatureIfFloor, spawnAmbientNpc, spawnSocialNpc } from './social_helpers';

const DIMA: PlotNpcDef = {
  name: 'Дима Печатник',
  isFemale: false,
  faction: Faction.WILD,
  occupation: Occupation.SECRETARY,
  sprite: Occupation.SECRETARY,
  hp: 80, maxHp: 80, money: 18, speed: 1.0,
  inventory: [{ defId: 'note', count: 6 }, { defId: 'book', count: 2 }, { defId: 'ministry_audit_forgery', count: 1 }, { defId: 'knife', count: 1 }],
  talkLines: [
    'Тише. Машинка громче самосбора, но ликвидаторы слышат только бумагу.',
    'Мы печатаем пропуска, жалобы, некрологи и меню столовой. Разница в шрифте.',
    'Мне нужны записки с настоящими печатями. Десять штук, не меньше.',
    'Фальшивый документ работает ровно до первого человека, который умеет читать.',
    'Если бумага пахнет сыростью, её приняли в райсовете без вопросов.',
    'За два чистых бланка сделаю аудиторское предписание. Не размахивай им при ликвидаторах.',
  ],
  talkLinesPost: [
    'Печати подошли. Теперь у нас есть документы на отсутствие документов.',
    'Забирай книгу или предписание. В них пустые страницы, зато официальный переплёт.',
  ],
};

registerSideQuest('kv_dima_pechatnik', DIMA, [{
  id: 'kv_print_notes',
  giverNpcId: 'kv_dima_pechatnik',
  type: QuestType.FETCH,
    desc: 'Дима Печатник: «Неси десять чужих записок. Сделаем бумагу, после которой охрана задает меньше вопросов.»',
  targetItem: 'note', targetCount: 10,
  rewardItem: 'book', rewardCount: 3,
  extraRewards: [{ defId: 'ballot', count: 12 }, { defId: 'cigs', count: 2 }],
  relationDelta: 14, xpReward: 45, moneyReward: 40,
}, {
  id: 'kv_print_ministry_audit_forgery',
  giverNpcId: 'kv_dima_pechatnik',
  type: QuestType.FETCH,
  desc: 'Дима Печатник: «Два пустых бланка - и напечатаю аудиторское предписание. Работает тихо, пока печать не сравнили с настоящей.»',
  targetItem: 'blank_form', targetCount: 2,
  rewardItem: 'ministry_audit_forgery', rewardCount: 1,
  extraRewards: [{ defId: 'ink_bottle', count: 1 }],
  relationDelta: 8, xpReward: 55, moneyReward: 15,
  eventPrivacy: 'secret',
  eventSeverity: 4,
  eventTags: ['print_room', 'forgery', 'ministry', 'audit', 'access', 'material_cost', 'stealth'],
  eventTargetName: 'Дима Печатник выдал липовое аудиторское предписание',
  eventData: { materialCost: 'blank_form:2', risk: 'ministry_audit', route: 'forgery' },
}]);

export function generatePrintRoom(
  world: World, nextRoomId: number, entities: Entity[], nextId: { v: number }, spawnX: number, spawnY: number,
): number {
  const poi = createSocialPoiRoom(world, nextRoomId, spawnX, spawnY, 'Нелегальная типография', RoomType.OFFICE, 11, 8, Tex.CONCRETE, Tex.F_CONCRETE, 45, 150, 1.5);
  if (!poi) return nextRoomId;

  for (let y = 2; y < poi.h - 1; y += 2) {
    setFeatureIfFloor(world, poi.x + 2, poi.y + y, Feature.DESK);
    setFeatureIfFloor(world, poi.x + 3, poi.y + y, Feature.CHAIR);
  }
  setFeatureIfFloor(world, poi.x + poi.w - 2, poi.y + 1, Feature.SHELF);
  setFeatureIfFloor(world, poi.x + 1, poi.y + 1, Feature.LAMP);

  spawnSocialNpc(entities, nextId, DIMA, 'kv_dima_pechatnik', poi.x + 2, poi.y + 2, { weapon: 'knife' });
  spawnAmbientNpc(entities, nextId, 'Ира Свидетель', Faction.CITIZEN, Occupation.SECRETARY, poi.x + 6, poi.y + 3, [{ defId: 'note', count: 2 }]);
  spawnAmbientNpc(entities, nextId, 'Курьер с мокрой печатью', Faction.CITIZEN, Occupation.TRAVELER, poi.x + 8, poi.y + 5, [{ defId: 'ballot', count: 3 }]);

  for (const defId of ['note', 'note', 'note', 'note', 'book', 'book', 'ballot', 'cigs', 'ink_bottle', 'seal_wax']) {
    placeDropNear(world, entities, nextId, poi, defId, 1);
  }

  return poi.room.id + 1;
}
