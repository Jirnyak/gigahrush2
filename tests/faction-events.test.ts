import { test } from 'node:test';
import * as assert from 'node:assert/strict';

import {
  Cell,
  EntityType,
  Faction,
  FloorLevel,
  Occupation,
  ZoneFaction,
  type Entity,
  type Item,
} from '../src/core/types';
import { World } from '../src/core/world';
import { FACTION_EVENT_DEFS } from '../src/data/faction_events';
import { ITEMS, WEAPON_STATS } from '../src/data/catalog';
import { initFactionRelations } from '../src/data/relations';
import { RESOURCES } from '../src/data/resources';
import { createWorldEventState, getRecentEvents } from '../src/systems/events';
import {
  forceFactionEvent,
  getActiveCultProcessionSnapshots,
  getCultProcessionPrompt,
  MAX_PROCESSION_PILGRIMS,
  recordFactionClashPlayerHit,
  resetFactionEventsForTests,
  tryInteractCultProcession,
  updateCultProcessionCompulsion,
  updateFactionEvents,
} from '../src/systems/faction_events';
import { makeGameState } from './helpers';

function cultWorld(): World {
  const world = new World();
  world.cells.fill(Cell.FLOOR);
  world.zoneMap.fill(0);
  world.factionControl.fill(ZoneFaction.CULTIST);
  world.zones.push({
    id: 0,
    cx: 64,
    cy: 64,
    faction: ZoneFaction.CULTIST,
    hasLift: false,
    fogged: false,
    level: 3,
    hqRoomId: -1,
  });
  return world;
}

function player(overrides: Partial<Entity> = {}): Entity {
  return {
    id: 1,
    type: EntityType.NPC, persistentNpcId: 'player',
    x: 64.5,
    y: 64.5,
    angle: 0,
    pitch: 0,
    alive: true,
    speed: 3,
    sprite: 0,
    hp: 40,
    maxHp: 40,
    name: 'Вы',
    faction: Faction.PLAYER,
    ...overrides,
  };
}

function cultPilgrims(entities: Entity[]): Entity[] {
  return entities.filter(e =>
    e.type === EntityType.NPC
    && e.faction === Faction.CULTIST
    && e.occupation === Occupation.PILGRIM
  );
}

function expectAction(state: ReturnType<typeof makeGameState>, action: string): void {
  const event = getRecentEvents(state, { tags: ['cult_procession', action], limit: 1 })[0];
  assert.equal(event?.data?.processionAction, action);
}

function itemRefs(items: readonly Item[] | undefined, context: string): void {
  for (const item of items ?? []) {
    assert.ok(ITEMS[item.defId], `${context} references missing item ${item.defId}`);
  }
}

test('faction events reference existing items, weapons and economy resources', () => {
  const resourceIds = new Set(RESOURCES.map(r => r.id));

  for (const def of FACTION_EVENT_DEFS) {
    if (def.itemId) assert.ok(ITEMS[def.itemId], `${def.id} itemId is missing: ${def.itemId}`);
    itemRefs(def.npcInventory, `${def.id}.npcInventory`);
    itemRefs(def.drops, `${def.id}.drops`);
    itemRefs(def.containerDrops, `${def.id}.containerDrops`);
    for (const weapon of def.weapons ?? []) {
      assert.ok(WEAPON_STATS[weapon], `${def.id} references missing weapon ${weapon}`);
    }
    for (const delta of def.economyDeltas ?? []) {
      assert.ok(resourceIds.has(delta.resourceId), `${def.id} references missing resource ${delta.resourceId}`);
    }
    for (const side of def.clash?.sides ?? []) {
      itemRefs(side.npcInventory, `${def.id}.${side.label}.npcInventory`);
      for (const weapon of side.weapons ?? []) {
        assert.ok(WEAPON_STATS[weapon], `${def.id}.${side.label} references missing weapon ${weapon}`);
      }
    }
    for (const outcome of def.clash?.outcomes ?? []) {
      itemRefs(outcome.items, `${def.id}.${outcome.outcome}.items`);
    }
  }

  const procession = FACTION_EVENT_DEFS.find(def => def.id === 'cult_procession');
  assert.ok(procession?.procession);
  assert.ok(procession.maxGroup <= MAX_PROCESSION_PILGRIMS);
  assert.ok(procession.procession.actionRadius < procession.procession.fearRadius);
  assert.ok(procession.procession.controlRadius <= procession.procession.actionRadius);
});

test('cult procession exposes follow, report, disguise, avoid and violent disrupt paths', () => {
  resetFactionEventsForTests();
  initFactionRelations();
  const world = cultWorld();
  const state = makeGameState({ currentFloor: FloorLevel.HELL, worldEvents: createWorldEventState() });
  const actor = player();
  const entities: Entity[] = [actor];
  const nextId = { v: 10 };

  const result = forceFactionEvent(state, world, actor, entities, nextId, 'cult_procession');
  assert.match(result, /Культовая процессия/);

  const pilgrims = cultPilgrims(entities);
  assert.ok(pilgrims.length >= 3);
  assert.ok(pilgrims.length <= MAX_PROCESSION_PILGRIMS);
  assert.equal(getActiveCultProcessionSnapshots(state).length, 1);

  assert.equal(getCultProcessionPrompt(world, state, actor), ' удерживать: сопротивляться ходу');
  assert.equal(tryInteractCultProcession(state, world, actor, entities), true);
  expectAction(state, 'avoid');

  state.time += 2;
  actor.x = 68.5;
  const pull = updateCultProcessionCompulsion(state, world, actor, false);
  assert.ok(pull && pull.strength > 0);
  expectAction(state, 'follow');
  assert.ok((actor.hp ?? 0) < 40 || actor.inventory?.some(item => item.defId === 'meat_rune'));

  actor.tool = 'radio';
  assert.equal(getCultProcessionPrompt(world, state, actor), ' доложить');
  assert.equal(tryInteractCultProcession(state, world, actor, entities), true);
  expectAction(state, 'report');

  actor.tool = undefined;
  actor.inventory = [{ defId: 'meat_rune', count: 1 }];
  assert.equal(getCultProcessionPrompt(world, state, actor), ' удерживать: не идти за знаком');
  assert.equal(tryInteractCultProcession(state, world, actor, entities), true);
  expectAction(state, 'disguise');

  actor.x = 76.5;
  actor.inventory = [];
  assert.equal(getCultProcessionPrompt(world, state, actor), ' удерживать: сопротивляться');
  assert.equal(tryInteractCultProcession(state, world, actor, entities), true);
  expectAction(state, 'avoid');

  const snapshot = getActiveCultProcessionSnapshots(state)[0];
  assert.equal(snapshot.followed, true);
  assert.equal(snapshot.reported, true);
  assert.equal(snapshot.disguised, true);
  assert.equal(snapshot.avoided, true);

  const downed = Math.ceil(pilgrims.length / 2);
  for (let i = 0; i < downed; i++) {
    recordFactionClashPlayerHit(state, world, actor, pilgrims[i], 12);
    pilgrims[i].alive = false;
  }
  state.time += 1;
  updateFactionEvents(state, world, actor, entities, nextId, 1, false);

  expectAction(state, 'disrupt');
  const aftermath = getRecentEvents(state, { tags: ['cult_procession', 'aftermath'], limit: 1 })[0];
  assert.equal(aftermath?.data?.processionOutcome, 'сорвана');
  assert.equal(getActiveCultProcessionSnapshots(state).length, 0);
});

test('active cult procession publishes aftermath and clears when samosbor cycle starts', () => {
  resetFactionEventsForTests();
  initFactionRelations();
  const world = cultWorld();
  const state = makeGameState({ currentFloor: FloorLevel.HELL, worldEvents: createWorldEventState() });
  const actor = player();
  const entities: Entity[] = [actor];
  const nextId = { v: 50 };

  assert.match(forceFactionEvent(state, world, actor, entities, nextId, 'cult_procession'), /Культовая процессия/);
  assert.equal(getActiveCultProcessionSnapshots(state).length, 1);

  state.samosborCount++;
  state.time += 1;
  updateFactionEvents(state, world, actor, entities, nextId, 1, false);

  const aftermath = getRecentEvents(state, { tags: ['cult_procession', 'aftermath'], limit: 1 })[0];
  assert.equal(aftermath?.data?.processionOutcome, 'смыта самосбором');
  assert.equal(getActiveCultProcessionSnapshots(state).length, 0);
});
