/* ── Православный храм — Easter content module ──────────────── */
/* Self-contained: NPC definition + quest + spawn + death curse.   */
/* Registered automatically via registerSideQuest() at import.     */

import {
  W, Cell, Tex, Feature, RoomType,
  type Room, type Entity, EntityType, AIGoal, Faction, Occupation, QuestType, MonsterKind,
  FloorLevel, msg,
} from '../../core/types';
import { World } from '../../core/world';
import { type PlotNpcDef, registerAuthoredNpc, storyNpcFloorKey } from '../../data/plot';
import { registerZoneContent } from './zone_content';
import { MONSTERS } from '../../entities/monster';
import { monsterSpr } from '../../render/sprite_index';
import { registerContentEntityDeathHook } from '../../systems/content_hooks';
import { randomRPG, scaleMonsterHp, scaleMonsterSpeed } from '../../systems/rpg';
import { genLog } from '../log';
import { requireSpawnedPlotNpcFromPackage } from '../plot_npc_spawn';

/* ── NPC definition ──────────────────────────────────────────── */
const NPC_DEF: PlotNpcDef = {
  name: 'Батюшка',
  isFemale: false,
  faction: Faction.CITIZEN,
  occupation: Occupation.PRIEST,
  sprite: Occupation.PRIEST,
  hp: 80, maxHp: 80, money: 100, speed: 0.5,
  inventory: [
    { defId: 'holy_water', count: 5 },
    { defId: 'kulich', count: 3 },
    { defId: 'easter_egg', count: 10 },
  ],
  talkLines: [
    'Господи Иисусе Христе, Сыне Божий, помилуй мя грешного.',
    'Хлеб наш насущный даждь нам днесь. В хруще это и молитва, и очередь за пайком.',
    'Христос Воскресе! Воистину Воскресе! Тише, за стеной обход, не мешайте людям считать.',
    'Свечи горят ровно — значит, коридор ещё держится. Если пламя легло на бок, уходи.',
    'Святую воду держим закрытой. После самосбора любую бутылку сначала смотрит санитар.',
    'Не бейся лбом в герму, чадо. Сначала помолись, потом ищи запасной вентиль.',
  ],
  talkLinesPost: [
    'Да хранит тебя Господь, а герму всё равно проверь перед сиреной.',
    'Вера — щит, но бинт держи ближе к руке.',
    'Зайдёшь ещё — поставим свечу за тех, кого списали в утиль.',
  ],
};

/* ── Register NPC + quest into global data ───────────────────── */
registerAuthoredNpc({
  id: 'batushka',
  npc: NPC_DEF,
  homeFloorKey: storyNpcFloorKey(FloorLevel.KVARTIRY),
  tags: ['kvartiry', 'temple'],
  quests: [
    {
      id: 'batushka_eggs',
      giverNpcId: 'batushka',
      type: QuestType.FETCH,
      desc: 'Батюшка: «Принеси три пасхальных яйца, чадо. Одним похристосуемся, второе отдадим детям, третье оставим дежурному у гермы.»',
      targetItem: 'easter_egg', targetCount: 3,
      rewardItem: 'holy_water', rewardCount: 3,
      relationDelta: 20, xpReward: 25, moneyReward: 50,
    },
  ],
});

/* ── Cross-shaped temple layout ────────────────────────────────
 *   Nave (central vertical):  NAVE_W × NAVE_H  (7 × 17)
 *   Transept (horizontal arms): ARM_W × ARM_H  (5 × 5) on each side
 *
 *   North = altar (apse), South = entrance
 *
 *        ┌───────┐
 *        │ APSE  │
 *        │       │
 *   ┌────┤       ├────┐
 *   │ARM │ NAVE  │ ARM│  ← transept row
 *   └────┤       ├────┘
 *        │       │
 *        │       │
 *        │  [D]  │  ← entrance door
 *        └───────┘
 * ─────────────────────────────────────────────────────────────── */
const NAVE_W = 7;     // interior width of central nave
const NAVE_H = 17;    // interior height of central nave
const ARM_W  = 5;     // interior width of each transept arm
const ARM_H  = 5;     // interior height of each transept arm
const ARM_Y_OFF = 4;  // arm starts this many cells from top of nave

/* Bounding box: x ∈ [rx-ARM_W-2, rx+NAVE_W+ARM_W+2), y ∈ [ry-2, ry+NAVE_H+2) */

/* Helper: is cell (dx,dy) relative to (rx,ry) inside the cross interior? */
function insideCross(dx: number, dy: number): boolean {
  // Nave interior: 0..NAVE_W-1, 0..NAVE_H-1
  if (dx >= 0 && dx < NAVE_W && dy >= 0 && dy < NAVE_H) return true;
  // Left arm interior
  if (dx >= -ARM_W && dx < 0 && dy >= ARM_Y_OFF && dy < ARM_Y_OFF + ARM_H) return true;
  // Right arm interior
  if (dx >= NAVE_W && dx < NAVE_W + ARM_W && dy >= ARM_Y_OFF && dy < ARM_Y_OFF + ARM_H) return true;
  return false;
}

/* Helper: is cell (dx,dy) on the cross border wall (1-cell ring around interior)? */
function onCrossBorder(dx: number, dy: number): boolean {
  if (insideCross(dx, dy)) return false;
  // Check if any of 4 neighbours is inside
  return insideCross(dx + 1, dy) || insideCross(dx - 1, dy)
      || insideCross(dx, dy + 1) || insideCross(dx, dy - 1);
}

/* ── Generate cross-shaped temple ──────────────────────────────── */
function generateTemple(
  world: World, nextRoomId: number, entities: Entity[], nextId: { v: number },
  zcx: number, zcy: number,
): { nextRoomId: number } {
  // rx,ry = top-left of nave interior
  const rx = world.wrap(zcx + Math.floor(Math.random() * 20) - 10);
  const ry = world.wrap(zcy + Math.floor(Math.random() * 20) - 10);

  // Phase 1: Bulldoze bounding box — overwrite non-apartment cells with WALL
  for (let dy = -2; dy < NAVE_H + 2; dy++) {
    for (let dx = -ARM_W - 2; dx < NAVE_W + ARM_W + 2; dx++) {
      const ci = world.idx(rx + dx, ry + dy);
      if (!world.aptMask[ci]) {
        world.cells[ci] = Cell.WALL;
        world.wallTex[ci] = Tex.PANEL;
        world.floorTex[ci] = Tex.F_TILE;
        world.roomMap[ci] = -1;
        world.features[ci] = 0;
      }
    }
  }

  // Phase 2: Carve cross-shaped floor + set walls on border
  const roomId = nextRoomId++;
  const room: Room = {
    id: roomId, type: RoomType.MEDICAL,
    x: rx - ARM_W, y: ry,
    w: NAVE_W + 2 * ARM_W, h: NAVE_H,
    name: 'Православный храм',
    wallTex: Tex.PANEL, floorTex: Tex.F_TILE,
    doors: [], sealed: false, apartmentId: -1,
  };
  world.rooms[roomId] = room;

  for (let dy = -1; dy < NAVE_H + 1; dy++) {
    for (let dx = -ARM_W - 1; dx < NAVE_W + ARM_W + 1; dx++) {
      const ci = world.idx(rx + dx, ry + dy);
      if (world.aptMask[ci]) continue;
      if (insideCross(dx, dy)) {
        world.cells[ci] = Cell.FLOOR;
        world.floorTex[ci] = Tex.F_TILE;
        world.roomMap[ci] = roomId;
      } else if (onCrossBorder(dx, dy)) {
        world.cells[ci] = Cell.WALL;
        world.wallTex[ci] = Tex.PANEL;
      }
    }
  }

  // Phase 3: Protect with aptMask (survives samosbor)
  for (let dy = -1; dy < NAVE_H + 1; dy++) {
    for (let dx = -ARM_W - 1; dx < NAVE_W + ARM_W + 1; dx++) {
      if (insideCross(dx, dy) || onCrossBorder(dx, dy)) {
        world.aptMask[world.idx(rx + dx, ry + dy)] = 1;
      }
    }
  }

  genLog(`[TEMPLE] cross-shaped at (${rx}, ${ry}) room #${roomId}`);

  // Phase 4: Entrance at south wall center — door + crosses flanking
  const doorX = rx + Math.floor(NAVE_W / 2);
  const doorY = ry + NAVE_H; // south wall row
  const doorI = world.idx(doorX, doorY);
  world.cells[doorI] = Cell.DOOR;
  world.aptMask[doorI] = 1;
  // Crosses flanking the entrance (left and right of door)
  const crossL = world.idx(doorX - 1, doorY);
  const crossR = world.idx(doorX + 1, doorY);
  if (world.cells[crossL] === Cell.WALL) world.wallTex[crossL] = Tex.CROSS;
  if (world.cells[crossR] === Cell.WALL) world.wallTex[crossR] = Tex.CROSS;

  // Phase 5: Icons on north (altar/apse) wall + side walls of nave
  // North wall — icons in center
  for (let dx = 1; dx < NAVE_W - 1; dx++) {
    const wi = world.idx(rx + dx, ry - 1);
    if (world.cells[wi] === Cell.WALL) world.wallTex[wi] = Tex.ICON;
  }
  // Nave side walls — alternating icon
  for (let dy = 0; dy < NAVE_H; dy += 2) {
    const wl = world.idx(rx - 1, ry + dy);
    const wr = world.idx(rx + NAVE_W, ry + dy);
    if (world.cells[wl] === Cell.WALL) world.wallTex[wl] = Tex.ICON;
    if (world.cells[wr] === Cell.WALL) world.wallTex[wr] = Tex.ICON;
  }
  // Transept arm outer walls — crosses
  for (let dy = ARM_Y_OFF; dy < ARM_Y_OFF + ARM_H; dy += 2) {
    const wl = world.idx(rx - ARM_W - 1, ry + dy);
    const wr = world.idx(rx + NAVE_W + ARM_W, ry + dy);
    if (world.cells[wl] === Cell.WALL) world.wallTex[wl] = Tex.CROSS;
    if (world.cells[wr] === Cell.WALL) world.wallTex[wr] = Tex.CROSS;
  }

  // Phase 6: Connect to maze — carve explicit corridor south from door
  {
    let cx = doorX, cy = world.wrap(doorY + 1);
    for (let s = 0; s < 60; s++) {
      const ci = world.idx(cx, cy);
      if (world.cells[ci] === Cell.FLOOR && !world.aptMask[ci]) break; // reached maze
      if (!world.aptMask[ci]) {
        world.cells[ci] = Cell.FLOOR;
        world.floorTex[ci] = Tex.F_TILE;
        world.roomMap[ci] = -1;
      }
      cy = world.wrap(cy + 1);
    }
  }

  // Phase 7: Interior — lamps + candles
  const midX = Math.floor(NAVE_W / 2);
  world.features[world.idx(rx + midX, ry + 1)] = Feature.LAMP;                          // apse lamp
  world.features[world.idx(rx + midX, ry + Math.floor(NAVE_H / 2))] = Feature.LAMP;     // nave center
  world.features[world.idx(rx + midX, ry + NAVE_H - 2)] = Feature.LAMP;                 // near entrance
  // Candles at transept arm ends
  world.features[world.idx(rx - ARM_W + 1, ry + ARM_Y_OFF + 1)] = Feature.CANDLE;       // left arm NW
  world.features[world.idx(rx - ARM_W + 1, ry + ARM_Y_OFF + ARM_H - 2)] = Feature.CANDLE;
  world.features[world.idx(rx + NAVE_W + ARM_W - 2, ry + ARM_Y_OFF + 1)] = Feature.CANDLE; // right arm NE
  world.features[world.idx(rx + NAVE_W + ARM_W - 2, ry + ARM_Y_OFF + ARM_H - 2)] = Feature.CANDLE;
  // Candles at apse corners
  world.features[world.idx(rx + 1, ry + 1)] = Feature.CANDLE;
  world.features[world.idx(rx + NAVE_W - 2, ry + 1)] = Feature.CANDLE;

  // Phase 8: NPC — Батюшка at altar (apse, north-center)
  const priestX = rx + midX + 0.5;
  const priestY = ry + 2 + 0.5;
  requireSpawnedPlotNpcFromPackage(entities, nextId, 'batushka', priestX, priestY, {
    angle: Math.PI,
    canGiveQuest: true,
  });

  return { nextRoomId };
}

/* ── Auto-register in zone 3 (HUD) ───────────────────────────── */
registerZoneContent(3, 'Православный храм', generateTemple);

/* ── Death curse: spawn 666 monsters in pentagram pattern ────── */
export function priestDeathCurse(
  world: World, entities: Entity[], nextId: { v: number },
  cx: number, cy: number,
): void {
  const CURSE_COUNT = 666;
  const R = 40; // radius of pentagram

  // Pentagram vertices (5 points, rotated -90° so top point is up)
  const pts: [number, number][] = [];
  for (let i = 0; i < 5; i++) {
    const angle = -Math.PI / 2 + (i * 2 * Math.PI) / 5;
    pts.push([cx + Math.cos(angle) * R, cy + Math.sin(angle) * R]);
  }

  // Pentagram lines: connect every other vertex (0→2, 2→4, 4→1, 1→3, 3→0)
  const lines: [number, number, number, number][] = [];
  const order = [0, 2, 4, 1, 3, 0];
  for (let i = 0; i < order.length - 1; i++) {
    const a = pts[order[i]], b = pts[order[i + 1]];
    lines.push([a[0], a[1], b[0], b[1]]);
  }

  // Distribute monsters along pentagram lines
  const monstersPerLine = Math.ceil(CURSE_COUNT / lines.length);
  const kinds = Object.values(MonsterKind).filter(v => typeof v === 'number') as MonsterKind[];
  let spawned = 0;

  for (const [x1, y1, x2, y2] of lines) {
    for (let j = 0; j < monstersPerLine && spawned < CURSE_COUNT; j++) {
      const t = j / monstersPerLine;
      const mx = x1 + (x2 - x1) * t + (Math.random() - 0.5) * 2;
      const my = y1 + (y2 - y1) * t + (Math.random() - 0.5) * 2;
      const wx = ((Math.floor(mx) % W) + W) % W;
      const wy = ((Math.floor(my) % W) + W) % W;
      const ci = wy * W + wx;
      // Skip walls
      if (world.cells[ci] !== Cell.FLOOR) {
        // Force floor if wall
        world.cells[ci] = Cell.FLOOR;
      }

      const kind = kinds[spawned % kinds.length] as MonsterKind;
      const def = MONSTERS[kind];
      const zid = world.zoneMap[ci];
      const zoneLevel = (zid >= 0 && world.zones[zid]) ? (world.zones[zid].level ?? 1) : 1;
      const level = Math.max(zoneLevel, 5); // curse monsters are at least level 5
      const rpg = randomRPG(level);
      const hp = Math.round(scaleMonsterHp(def.hp, level) * (1 + 0.1 * rpg.str));

      entities.push({
        id: nextId.v++,
        type: EntityType.MONSTER,
        x: wx + 0.5, y: wy + 0.5,
        angle: Math.random() * Math.PI * 2,
        pitch: 0,
        alive: true,
        speed: scaleMonsterSpeed(def.speed, level),
        sprite: monsterSpr(kind),
        hp, maxHp: hp,
        monsterKind: kind,
        attackCd: def.attackRate,
        ai: { goal: AIGoal.HUNT, tx: 0, ty: 0, path: [], pi: 0, stuck: 0, timer: 0 },
        rpg,
        phasing: kind === MonsterKind.SPIRIT,
      });
      spawned++;
    }
  }
}

registerContentEntityDeathHook({
  id: 'living_temple_priest_death_curse',
  onDeath(ctx) {
    if (!ctx.killerIsPlayer || ctx.killed.plotNpcId !== 'batushka') return;
    priestDeathCurse(ctx.world, ctx.entities, ctx.nextEntityId, ctx.killed.x, ctx.killed.y);
    ctx.state.msgs.push(msg('☠ ПРОКЛЯТИЕ БАТЮШКИ! 666 тварей вырвались из ада!', ctx.state.time, '#f00'));
    ctx.state.msgs.push(msg('На миникарте проступает пентаграмма...', ctx.state.time, '#a00'));
    return { worldChanged: true };
  },
});
