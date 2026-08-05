/* ── NPC and item spawning for the living floor ──────────────── */

import {
  W, Cell,
  type Entity,
  EntityType, AIGoal, Faction, Occupation, RoomType,
} from '../../core/types';
import { World } from '../../core/world';
import { ITEMS, randomName, freshNeeds, NOTES } from '../../data/catalog';
import { spawnCount } from '../../data/items';
import { randomFaction, randomOccupation } from '../../data/relations';
import { rng, pick, weightedPick } from '../shared';
import { gaussianLevel, randomRPG, getMaxHp } from '../../systems/rpg';
import { Spr } from '../../render/sprite_index';
import type { AptPlan } from './apartments';

/* ── Weapon loadout by occupation ─────────────────────────────── */
function npcWeaponLoadout(faction: Faction, occupation: Occupation): { weapon: string; inv: { defId: string; count: number }[] } {
  // Liquidators and hunters get better gear
  if (faction === Faction.LIQUIDATOR || occupation === Occupation.HUNTER) {
    const roll = Math.random();
    if (roll < 0.20) return { weapon: 'makarov', inv: [{ defId: 'makarov', count: 1 }, { defId: 'ammo_9mm', count: rng(6, 16) }] };
    if (roll < 0.32) return { weapon: 'shotgun', inv: [{ defId: 'shotgun', count: 1 }, { defId: 'ammo_shells', count: rng(4, 8) }] };
    if (roll < 0.40) return { weapon: 'ppsh', inv: [{ defId: 'ppsh', count: 1 }, { defId: 'ammo_9mm', count: rng(20, 40) }] };
    if (roll < 0.55) return { weapon: 'axe', inv: [{ defId: 'axe', count: 1 }] };
    if (roll < 0.75) return { weapon: 'pipe', inv: [{ defId: 'pipe', count: 1 }] };
    return { weapon: 'knife', inv: [{ defId: 'knife', count: 1 }] };
  }
  // Wild faction: always armed
  if (faction === Faction.WILD) {
    const roll = Math.random();
    if (roll < 0.15) return { weapon: 'makarov', inv: [{ defId: 'makarov', count: 1 }, { defId: 'ammo_9mm', count: rng(4, 10) }] };
    if (roll < 0.35) return { weapon: 'rebar', inv: [{ defId: 'rebar', count: 1 }] };
    if (roll < 0.55) return { weapon: 'pipe', inv: [{ defId: 'pipe', count: 1 }] };
    if (roll < 0.75) return { weapon: 'wrench', inv: [{ defId: 'wrench', count: 1 }] };
    return { weapon: 'knife', inv: [{ defId: 'knife', count: 1 }] };
  }
  // Workers with tools
  if (occupation === Occupation.LOCKSMITH || occupation === Occupation.MECHANIC) {
    return Math.random() < 0.6 ? { weapon: 'wrench', inv: [{ defId: 'wrench', count: 1 }] } : { weapon: 'pipe', inv: [{ defId: 'pipe', count: 1 }] };
  }
  if (occupation === Occupation.ELECTRICIAN || occupation === Occupation.TURNER) {
    return Math.random() < 0.5 ? { weapon: 'pipe', inv: [{ defId: 'pipe', count: 1 }] } : { weapon: '', inv: [] };
  }
  if (occupation === Occupation.COOK) {
    return Math.random() < 0.5 ? { weapon: 'knife', inv: [{ defId: 'knife', count: 1 }] } : { weapon: '', inv: [] };
  }
  // Citizens: small chance of having a knife or nothing
  if (faction === Faction.CITIZEN) {
    if (Math.random() < 0.15) return { weapon: 'knife', inv: [{ defId: 'knife', count: 1 }] };
  }
  return { weapon: '', inv: [] };
}

/* ── Spawn items in every room (zone-level dependent) ────────── */
export function spawnRoomItems(
  world: World, entities: Entity[], nextIdStart: number,
): number {
  let nextId = nextIdStart;
  for (const room of world.rooms) {
    if (!room || room.w < 3 || room.h < 3) continue;
    // Get zone level for this room
    const ci = world.idx(room.x + Math.floor(room.w / 2), room.y + Math.floor(room.h / 2));
    const zid = world.zoneMap[ci];
    const zoneLevel = (zid >= 0 && world.zones[zid]) ? (world.zones[zid].level ?? 1) : 1;
    // Filter items by room type, then adjust weights by zone level (expensive items rarer in low-level zones)
    const valueThreshold = zoneLevel * 15 + 10;
    const adjusted = Object.values(ITEMS)
      .filter(it => it.spawnRooms.includes(room.type))
      .map(it => ({ ...it, spawnW: (1000 / (it.value + 10)) * Math.min(1, (valueThreshold + 5) / Math.max(1, it.value)) }))
      .filter(it => it.spawnW >= 0.01);
    const numItems = rng(0, 2);  // slightly rarer (was 0-3)
    for (let n = 0; n < numItems; n++) {
      const def = weightedPick(adjusted);
      if (!def) continue;
      const ix = room.x + rng(1, Math.max(1, room.w - 2));
      const iy = room.y + rng(1, Math.max(1, room.h - 2));
      entities.push({
        id: nextId++, type: EntityType.ITEM_DROP,
        x: ix + 0.5, y: iy + 0.5, angle: 0, pitch: 0, alive: true, speed: 0, sprite: Spr.ITEM_DROP,
        inventory: [{ defId: def.id, count: rng(1, spawnCount(def)), data: def.id === 'note' ? pick(NOTES) : undefined }],
      });
    }
  }

  // ── Story items: 128 idol_chernobog scattered across the world ──
  const eligibleRooms = world.rooms.filter(r => r && r.w >= 3 && r.h >= 3 &&
    [RoomType.COMMON, RoomType.STORAGE, RoomType.OFFICE, RoomType.SMOKING].includes(r.type));
  for (let i = 0; i < 128 && eligibleRooms.length > 0; i++) {
    const room = eligibleRooms[Math.floor(Math.random() * eligibleRooms.length)];
    const ix = room.x + rng(1, Math.max(1, room.w - 2));
    const iy = room.y + rng(1, Math.max(1, room.h - 2));
    entities.push({
      id: nextId++, type: EntityType.ITEM_DROP,
      x: ix + 0.5, y: iy + 0.5, angle: 0, pitch: 0, alive: true, speed: 0, sprite: Spr.ITEM_DROP,
      inventory: [{ defId: 'idol_chernobog', count: 1 }],
    });
  }

  return nextId;
}

/* ── Spawn NPC families — one per apartment ──────────────────── */
export function spawnFamilies(
  world: World, apartments: AptPlan[], entities: Entity[], nextIdStart: number,
): number {
  let nextId = nextIdStart;

  for (let a = 0; a < apartments.length; a++) {
    const apt = apartments[a];
    const familySize = 8;
    const familyFaction = randomFaction();
    let familyLastName = '';
    for (let f = 0; f < familySize; f++) {
      const room = apt.living;
      const faction = f === 0 ? familyFaction : (Math.random() < 0.8 ? familyFaction : randomFaction());
      const occupation = randomOccupation(faction);
      // NPC level based on zone level (Gaussian)
      const ci = world.idx(room.x + Math.floor(room.w / 2), room.y + Math.floor(room.h / 2));
      const zoneId = world.zoneMap[ci];
      const zoneLevel = world.zones[zoneId]?.level ?? 1;
      const npcLevel = gaussianLevel(zoneLevel, 2);
      const rpg = randomRPG(npcLevel);
      const maxHp = getMaxHp(rpg);
      const nm = randomName(faction);
      const lastName = f === 0 ? (familyLastName = nm.lastName, nm.lastName) : familyLastName;
      const name = f === 0 ? nm.name : `${nm.firstName} ${lastName}`;
      entities.push({
        id: nextId++, type: EntityType.NPC,
        x: room.x + rng(1, Math.max(1, room.w - 2)) + 0.5,
        y: room.y + rng(1, Math.max(1, room.h - 2)) + 0.5,
        angle: Math.random() * Math.PI * 2,
        pitch: 0,
        alive: true,
        speed: occupation === Occupation.CHILD ? 0.8 : occupation === Occupation.ALCOHOLIC ? 0.9 : 1.2,
        sprite: occupation,
        spriteScale: occupation === Occupation.CHILD ? 0.6 : 1.0,
        name, firstName: nm.firstName, lastName, isFemale: nm.female, needs: freshNeeds(),
        hp: maxHp, maxHp,
        money: occupation === Occupation.DIRECTOR ? rng(200, 500) : occupation === Occupation.CHILD ? rng(0, 10) : rng(20, 100),
        ai: { goal: AIGoal.IDLE, tx: 0, ty: 0, path: [], pi: 0, stuck: 0, timer: 0 },
        ...(() => { const l = npcWeaponLoadout(faction, occupation); return { inventory: l.inv, weapon: l.weapon || undefined }; })(),
        familyId: a, faction, occupation, questId: -1,
        rpg,
      });
    }
  }

  return nextId;
}

const _PSI_IDS = ['psi_strike','psi_rupture','psi_madness','psi_storm','psi_brainburn'];
function _pickPsi(): string { return _PSI_IDS[Math.floor(Math.random() * _PSI_IDS.length)]; }

/* ── Spawn traveler NPCs — путники, паломники, охотники ──────── */
export function spawnTravelers(
  world: World, entities: Entity[], nextIdStart: number,
): number {
  let nextId = nextIdStart;

  const TRAVELER_DEFS: { faction: Faction; occupation: Occupation; count: number }[] = [
    { faction: Faction.CITIZEN,    occupation: Occupation.TRAVELER, count: 128 },
    { faction: Faction.CULTIST,    occupation: Occupation.PILGRIM,  count: 64 },
    { faction: Faction.LIQUIDATOR, occupation: Occupation.HUNTER,   count: 32 },
  ];

  const corridorSpawns: number[] = [];
  for (let i = 0; i < 10000; i++) {
    const ci = Math.floor(Math.random() * W * W);
    if (world.cells[ci] === Cell.FLOOR) corridorSpawns.push(ci);
    if (corridorSpawns.length >= 500) break;
  }

  for (const def of TRAVELER_DEFS) {
    for (let i = 0; i < def.count && corridorSpawns.length > 0; i++) {
      const randIdx = Math.floor(Math.random() * corridorSpawns.length);
      const ci = corridorSpawns[randIdx];
      corridorSpawns[randIdx] = corridorSpawns[corridorSpawns.length - 1];
      corridorSpawns.pop();
      const sx = (ci % W) + 0.5;
      const sy = Math.floor(ci / W) + 0.5;
      const zoneId = world.zoneMap[ci];
      const zoneLevel = world.zones[zoneId]?.level ?? 1;
      const npcLevel = gaussianLevel(zoneLevel, 2);
      const rpg = randomRPG(npcLevel);
      const maxHp = Math.round(getMaxHp(rpg) * 1.2);
      const nm = randomName(def.faction);
      entities.push({
        id: nextId++, type: EntityType.NPC,
        x: sx, y: sy,
        angle: Math.random() * Math.PI * 2,
        pitch: 0,
        alive: true, speed: 1.4, sprite: def.occupation,
        name: nm.name, firstName: nm.firstName, lastName: nm.lastName, isFemale: nm.female, needs: freshNeeds(),
        hp: maxHp, maxHp,
        money: rng(10, 80),
        ai: { goal: AIGoal.IDLE, tx: 0, ty: 0, path: [], pi: 0, stuck: 0, timer: 0 },
        ...(() => {
          if (def.faction === Faction.CULTIST && Math.random() < 0.3) {
            const psi = _pickPsi();
            return { inventory: [{ defId: 'knife', count: 1 }, { defId: psi, count: 1 }], weapon: 'knife', tool: psi };
          }
          const l = npcWeaponLoadout(def.faction, def.occupation);
          return { inventory: l.inv, weapon: l.weapon || undefined };
        })(),
        faction: def.faction, occupation: def.occupation,
        isTraveler: true, questId: -1,
        rpg,
      });
    }
  }

  return nextId;
}
