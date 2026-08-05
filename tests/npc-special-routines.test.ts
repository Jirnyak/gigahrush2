import test from 'node:test';
import assert from 'node:assert/strict';

import { AIGoal, NpcState } from '../src/core/types';
import { getNpcPackageByPlotNpcId, npcPackageDisplayName } from '../src/data/npc_packages';
import { tickNpcSpecialRoutine } from '../src/systems/npc_special_routines';
import { getNpcSpecialRoutine } from '../src/data/npc_special_routines';
import { makeTestNpc } from './helpers';

function plotNpcName(plotNpcId: string): string {
  const pack = getNpcPackageByPlotNpcId(plotNpcId);
  assert.ok(pack, `missing NPC package for plot NPC ${plotNpcId}`);
  return npcPackageDisplayName(pack);
}

test('Olga tutorial lock is selected from package data and expires to ordinary AI', () => {
  const pack = getNpcPackageByPlotNpcId('olga');
  assert.equal(pack?.runtime?.specialRoutineId, 'tutorial_lock_one_hour');

  const olga = makeTestNpc({
    plotNpcId: 'olga',
    name: plotNpcName('olga'),
    ai: { goal: AIGoal.WANDER, tx: 0, ty: 0, path: [1, 2], pi: 1, stuck: 0, timer: 0 },
    plotDone: false,
  });

  const held = tickNpcSpecialRoutine(olga, { hour: 8, minute: 30, totalMinutes: 30 });
  assert.deepEqual(held, {
    routineId: 'tutorial_lock_one_hour',
    held: true,
    expired: false,
    clearUtility: false,
  });
  assert.equal(olga.ai?.goal, AIGoal.IDLE);
  assert.equal(olga.ai?.npcState, NpcState.FREE_TIME);
  assert.deepEqual(olga.ai?.path, []);
  assert.equal(olga.plotDone, false);

  const expired = tickNpcSpecialRoutine(olga, { hour: 12, minute: 0, totalMinutes: 240 });
  assert.deepEqual(expired, {
    routineId: 'tutorial_lock_one_hour',
    held: false,
    expired: true,
    clearUtility: true,
  });
  assert.equal(olga.plotDone, true);

  const fallback = tickNpcSpecialRoutine(olga, { hour: 12, minute: 1, totalMinutes: 241 });
  assert.deepEqual(fallback, {
    routineId: 'tutorial_lock_one_hour',
    held: false,
    expired: false,
    clearUtility: false,
  });
});

test('getNpcSpecialRoutine returns the correct routine or undefined', () => {
  const routine = getNpcSpecialRoutine('tutorial_lock_one_hour');
  assert.ok(routine);
  assert.equal(routine.id, 'tutorial_lock_one_hour');
  assert.equal(routine.holdGoal, AIGoal.IDLE);

  assert.equal(getNpcSpecialRoutine(undefined), undefined);
  assert.equal(getNpcSpecialRoutine('unknown_id'), undefined);
});

test('Barinov uses the starter range lock from package data', () => {
  const barni = makeTestNpc({
    plotNpcId: 'barni',
    name: plotNpcName('barni'),
    ai: { goal: AIGoal.WANDER, tx: 0, ty: 0, path: [4, 5], pi: 1, stuck: 0, timer: 0 },
  });

  assert.equal(getNpcPackageByPlotNpcId('barni')?.runtime?.specialRoutineId, 'tutorial_lock_one_hour');
  assert.deepEqual(tickNpcSpecialRoutine(barni, { hour: 8, minute: 0, totalMinutes: 0 }), {
    routineId: 'tutorial_lock_one_hour',
    held: true,
    expired: false,
    clearUtility: false,
  });
  assert.equal(barni.ai?.goal, AIGoal.IDLE);
  assert.equal(barni.ai?.npcState, NpcState.FREE_TIME);
  assert.deepEqual(barni.ai?.path, []);
});

test('NPCs without package special routine fall through to occupation AI', () => {
  const yakov = makeTestNpc({
    plotNpcId: 'yakov',
    name: plotNpcName('yakov'),
    ai: { goal: AIGoal.WANDER, tx: 0, ty: 0, path: [], pi: 0, stuck: 0, timer: 0 },
  });

  assert.deepEqual(tickNpcSpecialRoutine(yakov, { hour: 8, minute: 0, totalMinutes: 0 }), {
    held: false,
    expired: false,
    clearUtility: false,
  });
});
