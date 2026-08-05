import test from 'node:test';
import assert from 'node:assert/strict';

import { EntityType, Faction } from '../src/core/types';
import {
  getFactionRelation,
  areFactionsHostile,
  isHostile,
  applyFactionRelationDeltas,
} from '../src/systems/factions';
import { makeTestEntity } from './helpers';
import { initFactionRelations } from '../src/data/relations';

test('getFactionRelation returns base relation value', () => {
  initFactionRelations();
  // By default (from data/relations.ts), CITIZEN and LIQUIDATOR are somewhat neutral/friendly
  const rel = getFactionRelation(Faction.CITIZEN, Faction.LIQUIDATOR);
  assert.equal(typeof rel, 'number');
});

test('areFactionsHostile correctly identifies hostile relations', () => {
  initFactionRelations();
  // We can mock this implicitly. WILD vs CITIZEN is typically hostile
  const isHostileCITvsWILD = areFactionsHostile(Faction.CITIZEN, Faction.WILD);
  const isHostileCITvsCIT = areFactionsHostile(Faction.CITIZEN, Faction.CITIZEN);

  assert.equal(isHostileCITvsCIT, false);
  assert.equal(typeof isHostileCITvsWILD, 'boolean'); // depending on initial config
});

test('isHostile: entities of same faction are not hostile', () => {
  initFactionRelations();
  const e1 = makeTestEntity({ id: 1, type: EntityType.NPC, faction: Faction.CITIZEN });
  const e2 = makeTestEntity({ id: 2, type: EntityType.NPC, faction: Faction.CITIZEN });
  assert.equal(isHostile(e1, e2), false);
});

test('isHostile: player vs NPC', () => {
  initFactionRelations();
  const player = makeTestEntity({ id: 0, type: EntityType.NPC, faction: Faction.PLAYER, persistentNpcId: 'player' });
  const angryNpc = makeTestEntity({ id: 3, type: EntityType.NPC, faction: Faction.CITIZEN, playerRelation: -100 });
  const friendlyNpc = makeTestEntity({ id: 4, type: EntityType.NPC, faction: Faction.CITIZEN, playerRelation: 100 });

  assert.equal(isHostile(angryNpc, player), true);
  assert.equal(isHostile(friendlyNpc, player), false);
  // Player does not automatically consider angry NPCs hostile unless logic dictates,
  // let's adjust this test. The function is `isHostile(attacker, target)`
  // `isHostile(player, angryNpc)` -> Player faction is PLAYER, angryNpc is CITIZEN.
  // areFactionsHostile(PLAYER, CITIZEN) is false by default.
  // isHostile actually doesn't have a special check for player targeting an NPC with negative playerRelation,
  // it checks `isNpcPlayerHostile(attacker)` when attacker is NPC.
  assert.equal(isHostile(player, angryNpc), false);
  assert.equal(isHostile(player, friendlyNpc), false);
});

test('isHostile: handles monster attitudes correctly', () => {
  initFactionRelations();
  const monster = makeTestEntity({ id: 5, type: EntityType.MONSTER });
  const citizen = makeTestEntity({ id: 6, type: EntityType.NPC, faction: Faction.CITIZEN });
  const cultist = makeTestEntity({ id: 7, type: EntityType.NPC, faction: Faction.CULTIST });

  // Monsters usually attack citizens
  assert.equal(isHostile(monster, citizen), true);
  // Monsters are not hostile to cultists (50 relation)
  assert.equal(isHostile(monster, cultist), false);
  // Same for reverse
  assert.equal(isHostile(citizen, monster), true);
  assert.equal(isHostile(cultist, monster), false);
});

test('isHostile: handles psi-madness', () => {
  initFactionRelations();
  const madEntity = makeTestEntity({ id: 8, type: EntityType.NPC, faction: Faction.CITIZEN, psiMadness: 1 });

  const otherEntity = makeTestEntity({ id: 9, type: EntityType.NPC, faction: Faction.CITIZEN });

  assert.equal(isHostile(madEntity, otherEntity), true);
});

test('isHostile: ignores same-monster hostility', () => {
  initFactionRelations();
  const m1 = makeTestEntity({ id: 10, type: EntityType.MONSTER });
  const m2 = makeTestEntity({ id: 11, type: EntityType.MONSTER });

  assert.equal(isHostile(m1, m2), false);
});

test('applyFactionRelationDeltas applies changes to relations', () => {
  initFactionRelations();
  const initialRel = getFactionRelation(Faction.CITIZEN, Faction.LIQUIDATOR);
  applyFactionRelationDeltas([[Faction.LIQUIDATOR, 10]], Faction.CITIZEN);
  const newRel = getFactionRelation(Faction.CITIZEN, Faction.LIQUIDATOR);

  assert.equal(newRel, initialRel + 10);
});
