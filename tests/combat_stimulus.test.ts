import { test } from 'node:test';
import * as assert from 'node:assert/strict';

import { EntityType, Faction } from '../src/core/types';
import { World } from '../src/core/world';
import {
  notifyActorDamaged,
  getRecentCombatThreat,
  isRecentCombatThreat,
  resetCombatStimulus
} from '../src/systems/combat_stimulus';
import { rebuildEntityIndex } from '../src/systems/entity_index';
import { setNpcPlayerRelation } from '../src/systems/npc_relations';
import { makeGameState, makeTestEntity, makeTestPlayer, makeTestNpc } from './helpers';

test('combat_stimulus: player attacks hostile MONSTER', () => {
  resetCombatStimulus();
  const world = new World();
  const state = makeGameState();

  const victim = makeTestEntity({
    id: 100,
    type: EntityType.MONSTER,
    faction: Faction.WILD,
    hp: 50,
    maxHp: 50
  });
  victim.ai = { goal: 0, path: [], pi: 0, timer: 0 };
  const attacker = makeTestPlayer({ id: 200, faction: Faction.PLAYER, hp: 100 });

  victim.alive = true;
  attacker.alive = true;

  rebuildEntityIndex([victim, attacker]);

  const time = 100.0;

  assert.equal(getRecentCombatThreat(victim, time), undefined);
  assert.equal(isRecentCombatThreat(victim, attacker, time), false);

  notifyActorDamaged(world, victim, attacker, 10, 'player_melee', time, state);

  const threat = getRecentCombatThreat(victim, time);
  assert.ok(threat, 'Threat memory should be created');
  assert.equal(threat.attackerId, attacker.id);
  assert.equal(threat.damagePressure, 10);
  assert.equal(threat.source, 'player_melee');
  assert.equal(threat.reaction, 'fight');

  assert.equal(isRecentCombatThreat(victim, attacker, time), true);
  assert.equal(isRecentCombatThreat(victim, attacker, time + 10.0), false, 'Threat should expire');
});

test('combat_stimulus: monster attacks monster is ignored', () => {
  resetCombatStimulus();
  const world = new World();
  const state = makeGameState();

  const victim = makeTestEntity({ id: 100, type: EntityType.MONSTER, hp: 50, alive: true });
  const attacker = makeTestEntity({ id: 200, type: EntityType.MONSTER, hp: 100, alive: true });

  rebuildEntityIndex([victim, attacker]);

  const time = 100.0;
  notifyActorDamaged(world, victim, attacker, 10, 'monster_melee', time, state);

  // Monster vs monster should not generate threat
  assert.equal(getRecentCombatThreat(victim, time), undefined);
  assert.equal(isRecentCombatThreat(victim, attacker, time), false);
});

test('combat_stimulus: NPC ignores STARTLED threat', () => {
  resetCombatStimulus();
  const world = new World();
  const state = makeGameState();

  // Two NPCs of the same faction (CITIZEN), so they are not inherently hostile
  const victim = makeTestNpc({ id: 100, type: EntityType.NPC, faction: Faction.CITIZEN, hp: 50, alive: true });
  victim.ai = { goal: 0, path: [], pi: 0, timer: 0 };
  const attacker = makeTestNpc({ id: 200, type: EntityType.NPC, faction: Faction.CITIZEN, hp: 100, alive: true });

  rebuildEntityIndex([victim, attacker]);

  const time = 100.0;
  // Doing damage between friendly NPCs
  notifyActorDamaged(world, victim, attacker, 10, 'explosion', time, state);

  const threat = getRecentCombatThreat(victim, time);
  assert.ok(threat, 'Threat should be recorded');
  assert.equal(threat.reaction, 'startled');

  // A startled reaction means it is not a recent combat threat to fight against
  assert.equal(isRecentCombatThreat(victim, attacker, time), false);
});

test('combat_stimulus: threat pressure caps correctly', () => {
  resetCombatStimulus();
  const world = new World();
  const state = makeGameState();

  const victim = makeTestEntity({
    id: 100,
    type: EntityType.MONSTER,
    faction: Faction.WILD,
    hp: 50,
    maxHp: 50,
    alive: true
  });
  victim.ai = { goal: 0, path: [], pi: 0, timer: 0 };
  const attacker = makeTestPlayer({ id: 200, faction: Faction.PLAYER, hp: 100, alive: true });

  rebuildEntityIndex([victim, attacker]);

  const time = 100.0;

  // Do multiple hits of damage
  notifyActorDamaged(world, victim, attacker, 50, 'player_melee', time, state);
  notifyActorDamaged(world, victim, attacker, 50, 'player_melee', time, state);
  notifyActorDamaged(world, victim, attacker, 50, 'player_melee', time, state);

  const threat = getRecentCombatThreat(victim, time);
  assert.ok(threat);
  assert.equal(threat.damagePressure, 120, 'Threat pressure should cap at COMBAT_THREAT_PRESSURE_CAP (120)');
});

test('combat_stimulus: NPC flees when outmatched', () => {
  resetCombatStimulus();
  const world = new World();
  const state = makeGameState();

  // Create a weak NPC (low hp, un-armed)
  const victim = makeTestNpc({
    id: 100,
    type: EntityType.NPC,
    faction: Faction.CITIZEN,
    hp: 1,
    maxHp: 20,
    alive: true,
    weapon: ''
  });
  // NOT brave so they flee. We use setNpcPlayerRelation to make them hostile without making them brave via psiMadness or faction.
  setNpcPlayerRelation(victim, -100);
  victim.ai = { goal: 0, path: [], pi: 0, timer: 0 };

  // Strong player
  const attacker = makeTestPlayer({
    id: 200,
    faction: Faction.PLAYER,
    hp: 100,
    alive: true,
    rpg: { level: 10, exp: 0, maxExp: 100 }
  });

  rebuildEntityIndex([victim, attacker]);

  const time = 100.0;

  notifyActorDamaged(world, victim, attacker, 10, 'player_melee', time, state);

  const threat = getRecentCombatThreat(victim, time);
  assert.ok(threat);
  assert.equal(threat.reaction, 'flee', 'Weak NPC should flee when outmatched');
});
