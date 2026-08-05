import { test } from 'node:test';
import * as assert from 'node:assert/strict';

import { AIGoal, Faction, type Msg } from '../src/core/types';
import { World } from '../src/core/world';
import {
  absorbPsiShieldDamage,
  castInstantSpell,
  endPsiPossession,
  getPsiPossessionTarget,
  isPsiShieldActive,
  resetPsiState,
  updatePsiEffects,
} from '../src/systems/psi';
import { makeTestNpc, makeTestPlayer } from './helpers';

test('PSI shield restores HP loss and spends 10 percent of blocked damage from PSI', () => {
  resetPsiState();
  const world = new World();
  const msgs: Msg[] = [];
  const player = makeTestPlayer({
    id: 1,
    hp: 20,
    maxHp: 20,
    rpg: { level: 1, xp: 0, attrPoints: 0, str: 0, agi: 0, int: 0, psi: 5, maxPsi: 10 },
  });

  castInstantSpell('shield', player, [player], world, msgs, 1, () => {});
  assert.equal(isPsiShieldActive(), true);

  player.hp = 12;
  assert.equal(absorbPsiShieldDamage(player, 20, msgs, 2), 8);
  assert.equal(player.hp, 20);
  assert.equal(player.rpg?.psi, 4.2);

  player.rpg!.psi = 0.1;
  player.hp = 15;
  absorbPsiShieldDamage(player, 20, msgs, 3);
  assert.equal(player.hp, 20);
  assert.equal(player.rpg?.psi, 0);
  assert.equal(isPsiShieldActive(), false);
});

test('PSI possession requires higher player intelligence and expires into backlash madness', () => {
  resetPsiState();
  const world = new World();
  const msgs: Msg[] = [];
  const player = makeTestPlayer({
    id: 1,
    x: 10,
    y: 10,
    angle: 0,
    rpg: { level: 3, xp: 0, attrPoints: 0, str: 0, agi: 0, int: 4, psi: 30, maxPsi: 30 },
  });
  const target = makeTestNpc({
    id: 2,
    x: 16,
    y: 10,
    faction: Faction.WILD,
    rpg: { level: 1, xp: 0, attrPoints: 0, str: 0, agi: 0, int: 1, psi: 0, maxPsi: 0 },
    ai: { goal: AIGoal.HUNT, tx: 0, ty: 0, path: [1], pi: 0, stuck: 0, timer: 1, combatTargetId: 1 },
  });
  const entities = [player, target];

  let activePlayer = castInstantSpell('possession', player, entities, world, msgs, 1, () => {}).player ?? player;
  assert.equal(target.psiControlledBy, player.id);
  assert.equal(activePlayer, target);
  target.alive = false;
  assert.equal(getPsiPossessionTarget(entities), null);
  target.alive = true;
  assert.equal(target.ai?.combatTargetId, undefined);
  assert.equal(getPsiPossessionTarget(entities), target);

  activePlayer = updatePsiEffects(entities, 19.1, activePlayer, msgs, 17).player ?? activePlayer;
  assert.equal(target.psiControlledBy, undefined);
  assert.equal(activePlayer, player);
  assert.ok((target.psiMadness ?? 0) > 0);
  assert.equal(getPsiPossessionTarget(entities), null);
});

test('PSI possession fails closed when target intelligence is not lower', () => {
  resetPsiState();
  const world = new World();
  const msgs: Msg[] = [];
  const player = makeTestPlayer({
    id: 1,
    x: 10,
    y: 10,
    angle: 0,
    rpg: { level: 2, xp: 0, attrPoints: 0, str: 0, agi: 0, int: 1, psi: 30, maxPsi: 30 },
  });
  const target = makeTestNpc({
    id: 2,
    x: 16,
    y: 10,
    rpg: { level: 2, xp: 0, attrPoints: 0, str: 0, agi: 0, int: 1, psi: 0, maxPsi: 0 },
  });
  const entities = [player, target];

  castInstantSpell('possession', player, entities, world, msgs, 1, () => {});

  assert.equal(target.psiControlledBy, undefined);
  assert.equal(getPsiPossessionTarget(entities), null);
  endPsiPossession(entities, player, msgs, 2, 'reset');
});

test('PSI shield can protect whichever entity is the current player', () => {
  resetPsiState();
  const world = new World();
  const msgs: Msg[] = [];
  const player = makeTestPlayer({
    id: 1,
    x: 10,
    y: 10,
    angle: 0,
    rpg: { level: 3, xp: 0, attrPoints: 0, str: 0, agi: 0, int: 4, psi: 30, maxPsi: 30 },
  });
  const target = makeTestNpc({
    id: 2,
    x: 16,
    y: 10,
    hp: 20,
    maxHp: 20,
    rpg: { level: 1, xp: 0, attrPoints: 0, str: 0, agi: 0, int: 1, psi: 10, maxPsi: 10 },
  });
  const entities = [player, target];

  castInstantSpell('shield', player, entities, world, msgs, 1, () => {});
  const activePlayer = castInstantSpell('possession', player, entities, world, msgs, 2, () => {}).player ?? player;
  activePlayer.hp = 6;

  assert.equal(absorbPsiShieldDamage(activePlayer, 20, msgs, 3), 14);
  assert.equal(activePlayer.hp, 20);
  assert.equal(activePlayer.rpg?.psi, 8.6);
});
