/* ── Информаторий — библиотека (zone 7 content module) ────────── */
/* Большая читальня с полками, лампой и библиотекаршей.            */
/* Self-contained: NPC + FETCH quest + room generator.             */

import {
  Cell, Tex, Feature, RoomType, ContainerKind, FloorLevel,
  type Room, type Entity, EntityType, Faction, Occupation, QuestType,
  type Item, type WorldContainer,
} from '../../core/types';
import { World } from '../../core/world';
import { type PlotNpcDef, registerSideQuest } from '../../data/plot';
import { genLog } from '../log';
import { requireSpawnedPlotNpcFromPackage } from '../plot_npc_spawn';
import { registerZoneContent } from './zone_content';
import { Spr } from '../../render/sprite_index';

const NPC_DEF: PlotNpcDef = {
  name: 'Маргарита Павловна',
  isFemale: true,
  faction: Faction.SCIENTIST,
  occupation: Occupation.SECRETARY,
  sprite: Occupation.SECRETARY,
  hp: 90, maxHp: 90, money: 40, speed: 0.6,
  inventory: [
    { defId: 'book', count: 8 },
    { defId: 'tea', count: 2 },
  ],
  talkLines: [
    'Тс-с-с. В Информатории не шумят: за соседним столом сверяют маршруты и ругаются шёпотом.',
    'Я - Маргарита Павловна. Тридцать лет каталогизирую книги, карточки лифтов и записки с чужих дверей.',
    'Книги пропадают после каждого самосбора: кто топит ими печку, кто прикрывает щель. Верните хотя бы пять томов.',
    'Взамен я отдам вам одну из моих записей. А ходовой указатель маршрутов можно купить. Или украсть, если любите свидетелей.',
  ],
  talkLinesPost: [
    'Спасибо, читатель. На полках снова есть что выдавать, кроме оправданий.',
    'Если найдёте редкое издание — несите. За хорошие книги я сверяю маршрутные карточки быстрее.',
    'Тише. За третьим шкафом человек спит после ночной смены.',
  ],
};

registerSideQuest('margarita_librarian', NPC_DEF, [
  {
    id: 'margarita_books',
    giverNpcId: 'margarita_librarian',
    type: QuestType.FETCH,
    desc: 'Маргарита Павловна: «Принесите мне пять книг. Любых. Полки пустые, а людям нужны карты, рецепты и хоть что-то читать в очереди.»',
    targetItem: 'book', targetCount: 5,
    rewardItem: 'psi_strike', rewardCount: 1,
    extraRewards: [
      { defId: 'note', count: 3 },
      { defId: 'antidep', count: 1 },
      { defId: 'tea', count: 2 },
    ],
    relationDelta: 20, xpReward: 50, moneyReward: 80,
    eventTags: ['living_library', 'rumor_index', 'favor'],
    eventData: { rumorIds: ['library_index_quarantine_medcard'] },
  },
]);

/* Library: large reading hall (15 wide × 11 tall). */
const LIB_W = 15;
const LIB_H = 11;
const LIBRARY_INDEX_TAG = 'living_library_rumor_index';

const LIBRARY_INDEX_NOTES: readonly string[] = [
  'Указатель Информатория / Карантин: Жилая зона -> Больничный блок карантина. Цель: карантинная медкарта. Риск: мертвяк у медкоридора. Входи с бинтом, выходи до ревизии.',
  'Указатель Информатория / Ноль: Коллекторы -> Теплотрасса Ноль, вентильная. Цель: бирка вентиля. Проверь манометр, иди через душевой обход, не спорь с паром.',
  'Указатель Информатория / Л-47: Министерство -> Архив ликвидаторских дел. Цель: жетон или запечатанный рапорт. Риск: параграф и запертая картотека.',
  'Указатель Информатория / Пепел: Нижний мясной этаж -> Пепельная плита готовности. Контракт: зачистить крупную тварь у плиты. Нужны патроны или ПСИ, выход тем же коридором.',
];

function libraryIndexInventory(): Item[] {
  return LIBRARY_INDEX_NOTES.map(data => ({ defId: 'note', count: 1, data }));
}

function nextContainerId(world: World): number {
  let id = world.containers.length + 1;
  while (world.containerById.has(id) || world.containers.some(c => c.id === id)) id++;
  return id;
}

function addRumorIndexContainer(world: World, room: Room, owner: Entity): void {
  const x = world.wrap(room.x + room.w - 2);
  const y = world.wrap(room.y + Math.floor(room.h / 2));
  const container: WorldContainer = {
    id: nextContainerId(world),
    x,
    y,
    floor: FloorLevel.LIVING,
    roomId: room.id,
    zoneId: world.zoneMap[world.idx(x, y)],
    kind: ContainerKind.FILING_CABINET,
    name: 'Картотека ходовых слухов',
    inventory: libraryIndexInventory(),
    capacitySlots: LIBRARY_INDEX_NOTES.length,
    ownerNpcId: owner.id,
    ownerName: owner.name,
    faction: Faction.SCIENTIST,
    access: 'owner',
    discovered: true,
    tags: [LIBRARY_INDEX_TAG, 'route_lead', 'rumor', 'paper', 'theft'],
  };
  world.addContainer(container);
}

function generateLibrary(
  world: World, nextRoomId: number, entities: Entity[], nextId: { v: number },
  zcx: number, zcy: number,
): { nextRoomId: number } {
  // top-left interior corner
  const rx = world.wrap(zcx - Math.floor(LIB_W / 2));
  const ry = world.wrap(zcy - Math.floor(LIB_H / 2));

  // Phase 1: bulldoze bounding box (ring +1)
  for (let dy = -1; dy <= LIB_H; dy++) {
    for (let dx = -1; dx <= LIB_W; dx++) {
      const ci = world.idx(rx + dx, ry + dy);
      if (world.aptMask[ci]) continue;
      world.cells[ci] = Cell.WALL;
      world.wallTex[ci] = Tex.PANEL;
      world.floorTex[ci] = Tex.F_PARQUET;
      world.roomMap[ci] = -1;
      world.features[ci] = 0;
    }
  }

  // Phase 2: carve room
  const roomId = nextRoomId++;
  const room: Room = {
    id: roomId, type: RoomType.COMMON,
    x: rx, y: ry, w: LIB_W, h: LIB_H,
    name: 'Информаторий',
    wallTex: Tex.PANEL, floorTex: Tex.F_PARQUET,
    doors: [], sealed: false, apartmentId: -1,
  };
  world.rooms[roomId] = room;

  for (let dy = 0; dy < LIB_H; dy++) {
    for (let dx = 0; dx < LIB_W; dx++) {
      const ci = world.idx(rx + dx, ry + dy);
      if (world.aptMask[ci]) continue;
      world.cells[ci] = Cell.FLOOR;
      world.floorTex[ci] = Tex.F_PARQUET;
      world.roomMap[ci] = roomId;
    }
  }

  // Phase 3: protect with aptMask (room interior + 1-cell wall ring)
  for (let dy = -1; dy <= LIB_H; dy++) {
    for (let dx = -1; dx <= LIB_W; dx++) {
      world.aptMask[world.idx(rx + dx, ry + dy)] = 1;
    }
  }

  // Phase 4: features — bookshelves along long walls + reading tables/chairs in center
  // Bookshelves: every cell next to north & south walls except middle entrance gap
  for (let dx = 1; dx < LIB_W - 1; dx++) {
    if (dx === Math.floor(LIB_W / 2)) continue; // entrance row gap
    world.features[world.idx(rx + dx, ry + 1)]        = Feature.SHELF;
    world.features[world.idx(rx + dx, ry + LIB_H - 2)] = Feature.SHELF;
  }
  // Reading tables (3 across the middle row), chairs around them
  const midY = ry + Math.floor(LIB_H / 2);
  for (let i = 0; i < 3; i++) {
    const tx = rx + 3 + i * 4;
    world.features[world.idx(tx, midY)]     = Feature.TABLE;
    world.features[world.idx(tx, midY - 1)] = Feature.CHAIR;
    world.features[world.idx(tx, midY + 1)] = Feature.CHAIR;
  }
  // Lamps in 4 corners of interior + center
  world.features[world.idx(rx + 1, ry + 1)]                = Feature.LAMP;
  world.features[world.idx(rx + LIB_W - 2, ry + 1)]        = Feature.LAMP;
  world.features[world.idx(rx + 1, ry + LIB_H - 2)]        = Feature.LAMP;
  world.features[world.idx(rx + LIB_W - 2, ry + LIB_H - 2)] = Feature.LAMP;
  world.features[world.idx(rx + Math.floor(LIB_W / 2), midY)] = Feature.LAMP;

  // Phase 5: door at south wall middle
  const doorX = rx + Math.floor(LIB_W / 2);
  const doorY = ry + LIB_H;
  const doorI = world.idx(doorX, doorY);
  world.cells[doorI] = Cell.DOOR;
  world.aptMask[doorI] = 1;

  // Phase 6: connect to maze — short southward corridor
  let cx = doorX, cy = world.wrap(doorY + 1);
  for (let s = 0; s < 60; s++) {
    const ci = world.idx(cx, cy);
    if (world.cells[ci] === Cell.FLOOR && !world.aptMask[ci]) break;
    if (!world.aptMask[ci]) {
      world.cells[ci] = Cell.FLOOR;
      world.floorTex[ci] = Tex.F_LINO;
      world.roomMap[ci] = -1;
    }
    cy = world.wrap(cy + 1);
  }

  // Phase 7: scatter a few books on floor (loot)
  for (let i = 0; i < 6; i++) {
    const bx = rx + 1 + Math.floor(Math.random() * (LIB_W - 2));
    const by = ry + 1 + Math.floor(Math.random() * (LIB_H - 2));
    if (world.features[world.idx(bx, by)]) continue;
    entities.push({
      id: nextId.v++, type: EntityType.ITEM_DROP,
      x: bx + 0.5, y: by + 0.5, angle: 0, pitch: 0, alive: true, speed: 0, sprite: Spr.ITEM_DROP,
      inventory: [{ defId: Math.random() < 0.3 ? 'note' : 'book', count: 1 }],
    });
  }

  // Phase 8: NPC — librarian behind central reading row
  const npcX = rx + Math.floor(LIB_W / 2) + 0.5;
  const npcY = ry + 1 + 0.5;
  const librarian = requireSpawnedPlotNpcFromPackage(
    entities,
    nextId,
    'margarita_librarian',
    npcX,
    npcY,
    {
      angle: Math.PI / 2,
      canGiveQuest: true,
      extra: {
        inventory: [...NPC_DEF.inventory.map(i => ({ ...i })), ...libraryIndexInventory()],
      },
    },
  );
  addRumorIndexContainer(world, room, librarian);

  genLog(`[LIBRARY] Информаторий at (${rx}, ${ry}) room #${roomId}`);
  return { nextRoomId };
}

registerZoneContent(7, 'Информаторий (библиотека)', generateLibrary);
