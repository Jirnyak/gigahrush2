/* ── Комната чужой очереди — Kvartiry close-reveal encounter ─── */

import { stampSurfaceSplat } from '../../systems/surface_marks';
import {
  AIGoal, Cell, ContainerKind, EntityType, Faction, FloorLevel, MonsterKind, Occupation, QuestType,
  RoomType, Tex, Feature, type Entity, type WorldContainer,
} from '../../core/types';
import { World } from '../../core/world';
import { type PlotNpcDef, registerSideQuest } from '../../data/plot';
import { MONSTERS } from '../../entities/monster';
import { monsterSpr } from '../../render/sprite_index';
import { randomRPG, scaleMonsterHp, scaleMonsterSpeed } from '../../systems/rpg';
import {
  createSocialPoiRoom, placeDropNear, roomCell, setFeatureIfFloor, spawnAmbientNpc, spawnSocialNpc,
  type SocialPoiRoom,
} from './social_helpers';

const FALSE_NEIGHBOR_ROOM_NAME = 'Комната чужой очереди';
export const FALSE_NEIGHBOR_TAG = 'false_neighbor';
export const FALSE_NEIGHBOR_QUEST_ID = 'kv_false_neighbor_nelyud';
const FALSE_NEIGHBOR_RUMOR_IDS = ['ecology_nelyud_close', 'lead_kvartiry_false_neighbor_nelyud'] as const;

const RAYA: PlotNpcDef = {
  name: 'Рая Подозрительная',
  isFemale: true,
  faction: Faction.CITIZEN,
  occupation: Occupation.HOUSEWIFE,
  sprite: Occupation.HOUSEWIFE,
  hp: 85, maxHp: 85, money: 12, speed: 0.85,
  inventory: [{ defId: 'note', count: 1 }, { defId: 'fake_pass', count: 1 }],
  talkLines: [
    'В очереди лишний сосед. Он стоит молча, пока к нему не подходят за солью.',
    'Экран у двери показывает очередь, но не показывает его плечи. Так даже старый телевизор не врет.',
    'Я повесила лампу и оставила проход свободным. Если он дернется - бегите к двери, не к стене.',
    'Фальшивый пропуск у него в кармане как кожа: вроде свой, а шрифт чужой.',
  ],
  talkLinesPost: [
    'Теперь очередь хотя бы человеческая. Это ненадолго, но слышно сразу.',
    'Не смейтесь над моей коробкой. Детектор пищал раньше, чем люди.',
  ],
};

registerSideQuest('kv_raya_podozritelnaya', RAYA, [{
  id: FALSE_NEIGHBOR_QUEST_ID,
  giverNpcId: 'kv_raya_podozritelnaya',
  type: QuestType.KILL,
  desc: 'Рая Подозрительная: «Убейте тихого соседа в комнате чужой очереди. Близко не подходите, пока не готовы бежать.»',
  targetMonsterKind: MonsterKind.NELYUD,
  killNeeded: 1,
  rewardItem: 'unpeople_detector',
  rewardCount: 1,
  extraRewards: [{ defId: 'fake_pass', count: 1 }],
  relationDelta: 14, xpReward: 85, moneyReward: 45,
  targetFloor: FloorLevel.KVARTIRY,
  targetRoomType: RoomType.LIVING,
  targetZoneTag: FALSE_NEIGHBOR_TAG,
  targetRoomName: FALSE_NEIGHBOR_ROOM_NAME,
  targetHint: 'Квартиры: комната чужой очереди, экран без отражения и коробка доноса у входа; держите выход свободным.',
  eventSeverity: 4,
  eventPrivacy: 'witnessed',
  eventTargetName: 'Тихого соседа из чужой очереди раскрыли и убили.',
  eventTags: ['monster', 'false_neighbor', 'witness', 'infected', 'fight_choice', 'denunciation'],
  eventData: {
    monsterId: 'kv_false_neighbor_nelyud',
    ruName: 'Тихий сосед',
    clue: 'missing_screen_reflection_at_queue_door',
    counterplay: 'keep_exit_open_before_close_reveal',
    localTrace: 'false_neighbor_denunciation_box',
    rumorIds: [...FALSE_NEIGHBOR_RUMOR_IDS],
  },
}]);

function spawnNelyud(world: World, entities: Entity[], nextId: { v: number }, x: number, y: number): void {
  const def = MONSTERS[MonsterKind.NELYUD];
  const ci = world.idx(x, y);
  const zid = world.zoneMap[ci];
  const zoneLevel = (zid >= 0 && world.zones[zid]) ? (world.zones[zid].level ?? 2) : 2;
  const hp = scaleMonsterHp(def.hp, zoneLevel);
  const monster: Entity = {
    id: nextId.v++, type: EntityType.MONSTER,
    x: x + 0.5, y: y + 0.5,
    angle: Math.PI, pitch: 0,
    alive: true,
    speed: scaleMonsterSpeed(def.speed, zoneLevel),
    sprite: monsterSpr(MonsterKind.NELYUD),
    name: 'Тихий сосед',
    hp, maxHp: hp,
    monsterKind: MonsterKind.NELYUD,
    attackCd: 0,
    ai: { goal: AIGoal.WANDER, tx: x, ty: y, path: [], pi: 0, stuck: 0, timer: 0 },
    rpg: randomRPG(zoneLevel),
  };
  entities.push(monster);
}

function placeQueueTell(world: World, poi: SocialPoiRoom): void {
  const screen = world.idx(poi.x + 1, poi.y - 1);
  world.wallTex[screen] = (Tex.SCREEN_BASE + 6) as Tex;
  if (!world.screenCells.includes(screen)) world.screenCells.push(screen);
  setFeatureIfFloor(world, poi.x + 1, poi.y + 1, Feature.SCREEN);
  stampSurfaceSplat(world, poi.x + poi.w - 3, poi.y + poi.h - 3, 0.5, 0.5, 1.4, 0.42, 44016, 4, 5, 5, false);
}

function nextContainerId(world: World): number {
  let id = world.containers.length + 1;
  while (world.containerById.has(id) || world.containers.some(c => c.id === id)) id++;
  return id;
}

function findEvidenceCell(world: World, poi: SocialPoiRoom, dx: number, dy: number): { x: number; y: number } | null {
  const preferred = roomCell(poi, dx, dy);
  if (world.cells[world.idx(preferred.x, preferred.y)] === Cell.FLOOR) return preferred;
  for (let y = 1; y < poi.h - 1; y++) {
    for (let x = 1; x < poi.w - 1; x++) {
      const wx = world.wrap(poi.x + x);
      const wy = world.wrap(poi.y + y);
      const ci = world.idx(wx, wy);
      if (world.roomMap[ci] === poi.room.id && world.cells[ci] === Cell.FLOOR) return { x: wx, y: wy };
    }
  }
  return null;
}

function addFalseNeighborEvidenceBox(world: World, poi: SocialPoiRoom, ownerId: number): void {
  const pos = findEvidenceCell(world, poi, 2, 1);
  if (!pos) return;
  const inventory: WorldContainer['inventory'] = [
    { defId: 'fake_pass', count: 1 },
    { defId: 'denunciation', count: 1 },
    { defId: 'inspection_mirror', count: 1 },
    { defId: 'note', count: 1 },
  ];
  world.addContainer({
    id: nextContainerId(world),
    x: pos.x,
    y: pos.y,
    floor: FloorLevel.KVARTIRY,
    roomId: poi.room.id,
    zoneId: world.zoneMap[world.idx(pos.x, pos.y)],
    kind: ContainerKind.FILING_CABINET,
    name: 'Коробка доноса на тихого соседа',
    inventory,
    capacitySlots: 8,
    ownerNpcId: ownerId,
    ownerName: RAYA.name,
    faction: Faction.CITIZEN,
    access: 'owner',
    discovered: true,
    tags: [FALSE_NEIGHBOR_TAG, 'denunciation', 'paper', 'witness', 'theft'],
  });
}

export function generateFalseNeighborRoom(
  world: World, nextRoomId: number, entities: Entity[], nextId: { v: number }, spawnX: number, spawnY: number,
): number {
  const poi = createSocialPoiRoom(
    world, nextRoomId, spawnX, spawnY,
    FALSE_NEIGHBOR_ROOM_NAME,
    RoomType.LIVING,
    13, 8,
    Tex.PANEL, Tex.F_LINO,
    70, 190,
    1.8,
  );
  if (!poi) return nextRoomId;

  for (let dx = 2; dx < poi.w - 2; dx += 3) {
    setFeatureIfFloor(world, poi.x + dx, poi.y + 2, Feature.CHAIR);
    setFeatureIfFloor(world, poi.x + dx, poi.y + 5, Feature.TABLE);
  }
  setFeatureIfFloor(world, poi.x + 1, poi.y + 1, Feature.LAMP);
  setFeatureIfFloor(world, poi.x + poi.w - 2, poi.y + 1, Feature.SHELF);
  setFeatureIfFloor(world, poi.x + poi.w - 2, poi.y + poi.h - 2, Feature.BED);
  world.wallTex[world.idx(poi.x + Math.floor(poi.w / 2), poi.y - 1)] = Tex.POSTER_BASE + 28;
  placeQueueTell(world, poi);

  const rayaId = nextId.v;
  spawnSocialNpc(entities, nextId, RAYA, 'kv_raya_podozritelnaya', poi.x + 2, poi.y + 2);
  spawnAmbientNpc(entities, nextId, 'Леня Очередной', Faction.CITIZEN, Occupation.LOCKSMITH, poi.x + 4, poi.y + 5, [{ defId: 'bread', count: 1 }]);
  spawnNelyud(world, entities, nextId, poi.x + poi.w - 3, poi.y + poi.h - 3);
  addFalseNeighborEvidenceBox(world, poi, rayaId);

  for (const defId of ['note', 'fake_pass', 'inspection_mirror', 'denunciation', 'unpeople_detector', 'bread']) {
    placeDropNear(world, entities, nextId, poi, defId, 1);
  }

  return poi.room.id + 1;
}
