import { test } from 'node:test';
import assert from 'node:assert/strict';

import { Cell, DoorState, EntityType, Feature, Occupation, RoomType, W, ZoneFaction } from '../src/core/types';
import { auditReachability } from '../src/core/world';
import { DESIGN_FLOOR_ROUTES } from '../src/data/design_floors';
import { designFloorPopulationProfile } from '../src/data/design_floor_population';
import { generateDesignFloor } from '../src/gen/design_floors/manifest';
import { countTerritoryCells, territoryHqAnchors } from '../src/systems/territory';

function countReachableCells(reachable: Uint8Array): number {
  let count = 0;
  for (const value of reachable) count += value;
  return count;
}

test('pioneer camp ships macro courts, micro rooms and cell-first faction control', () => {
  const route = DESIGN_FLOOR_ROUTES.find(def => def.id === 'pioneer_camp');
  assert.ok(route);
  const profile = designFloorPopulationProfile(route);
  const gen = generateDesignFloor('pioneer_camp', 61061);
  const npcs = gen.entities.filter(entity => entity.type === EntityType.NPC);
  const monsters = gen.entities.filter(entity => entity.type === EntityType.MONSTER);
  const childNpcs = npcs.filter(entity => entity.occupation === Occupation.CHILD);
  const centerNpcs = npcs.filter(entity => gen.world.dist(entity.x, entity.y, W / 2, W / 2) < 180);
  const centerMonsters = monsters.filter(entity => gen.world.dist(entity.x, entity.y, W / 2, W / 2) < 180);
  const edgeMonsters = monsters.filter(entity => gen.world.dist(entity.x, entity.y, W / 2, W / 2) > 250);
  const reachable = auditReachability(gen.world, gen.world.idx(Math.floor(gen.spawnX), Math.floor(gen.spawnY))).reachable;

  const territoryRows = countTerritoryCells(gen.world);
  const territoryTotal = territoryRows.reduce((sum, row) => sum + row.cells, 0);
  const territoryShare = (owner: ZoneFaction): number => (territoryRows.find(row => row.owner === owner)?.cells ?? 0) / territoryTotal;
  const hqOwners = new Set(territoryHqAnchors(gen.world).map(anchor => anchor.owner));
  const hermeticHqs = gen.world.rooms.filter(room =>
    room.type === RoomType.HQ &&
    room.sealed &&
    room.doors.some(doorIdx => {
      const door = gen.world.doors.get(doorIdx);
      return door?.state === DoorState.HERMETIC_OPEN || door?.state === DoorState.HERMETIC_CLOSED;
    })
  );
  const campMicroRooms = gen.world.rooms.filter(room =>
    room.name.includes(': малая спальня') ||
    room.name.includes(': кладовая инвентаря') ||
    room.name.includes(': умывальная будка') ||
    room.name.includes(': чайная комната') ||
    room.name.includes(': комната совета отряда') ||
    room.name.includes(': шкафы формы')
  );
  const landscapeCourts = gen.world.rooms.filter(room =>
    room.name === 'Большой парк бетонных берёз' ||
    room.name === 'Двор утренней зарядки' ||
    room.name === 'Поляна костровой сирены' ||
    room.name === 'Парк мокрых качелей'
  );
  const forestTrailPoints = gen.world.features.reduce((count, feature, cell) => {
    if (feature !== Feature.SLIDE) return count;
    if (gen.world.cells[cell] !== Cell.FLOOR || gen.world.roomMap[cell] >= 0) return count;
    const x = cell % W;
    const y = (cell / W) | 0;
    const d = gen.world.dist(x + 0.5, y + 0.5, W / 2, W / 2);
    return d >= 180 && d <= 470 ? count + 1 : count;
  }, 0);

  assert.equal(profile.npcTarget, 1100);
  assert.equal(profile.monsterTarget, 900);
  assert.equal(gen.world.rooms.length >= 110, true, `rooms ${gen.world.rooms.length}`);
  assert.equal(gen.world.doors.size >= 80, true, `doors ${gen.world.doors.size}`);
  assert.equal(countReachableCells(reachable) >= 130_000, true, `reachable ${countReachableCells(reachable)}`);
  assert.equal(landscapeCourts.length, 4);
  assert.equal(campMicroRooms.length >= 48, true, `micro rooms ${campMicroRooms.length}`);
  assert.equal(hermeticHqs.length >= 5, true, `hermetic HQs ${hermeticHqs.length}`);
  assert.equal(npcs.length >= 700 && npcs.length <= 1400, true);
  assert.equal(monsters.length >= 500 && monsters.length <= 1200, true);
  assert.equal(childNpcs.length >= Math.floor(npcs.length * 0.6), true);
  assert.equal(centerNpcs.length > centerMonsters.length, true);
  assert.equal(edgeMonsters.length > centerMonsters.length, true);
  assert.equal(forestTrailPoints >= 36, true, `forest trail points ${forestTrailPoints}`);

  for (const owner of [ZoneFaction.CITIZEN, ZoneFaction.LIQUIDATOR, ZoneFaction.CULTIST, ZoneFaction.SCIENTIST, ZoneFaction.WILD] as const) {
    assert.equal(hqOwners.has(owner), true, `HQ owner ${owner}`);
    assert.equal(territoryShare(owner) > 0, true, `owned cells ${owner}`);
  }
  assert.equal(territoryShare(ZoneFaction.CITIZEN) >= 0.53 && territoryShare(ZoneFaction.CITIZEN) <= 0.63, true, `citizen share ${territoryShare(ZoneFaction.CITIZEN)}`);
  assert.equal(territoryShare(ZoneFaction.LIQUIDATOR) >= 0.09 && territoryShare(ZoneFaction.LIQUIDATOR) <= 0.15, true, `liquidator share ${territoryShare(ZoneFaction.LIQUIDATOR)}`);
  assert.equal(territoryShare(ZoneFaction.CULTIST) >= 0.045 && territoryShare(ZoneFaction.CULTIST) <= 0.095, true, `cultist share ${territoryShare(ZoneFaction.CULTIST)}`);
  assert.equal(territoryShare(ZoneFaction.SCIENTIST) >= 0.065 && territoryShare(ZoneFaction.SCIENTIST) <= 0.12, true, `scientist share ${territoryShare(ZoneFaction.SCIENTIST)}`);
  assert.equal(territoryShare(ZoneFaction.WILD) >= 0.11 && territoryShare(ZoneFaction.WILD) <= 0.18, true, `wild share ${territoryShare(ZoneFaction.WILD)}`);
  assert.equal(gen.world.factionControl[gen.world.idx(W / 2, W / 2)], ZoneFaction.CITIZEN);
  assert.equal(gen.world.factionControl[gen.world.idx(W / 2, W / 2 - 150)], ZoneFaction.SCIENTIST);
});
