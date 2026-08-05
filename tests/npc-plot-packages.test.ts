import test from 'node:test';
import assert from 'node:assert/strict';

import { QuestType } from '../src/core/types';
import { World } from '../src/core/world';
import { buildAlifePopulationPlan } from '../src/data/alife_population_plan';
import { MAIN_PLOT_NPC_PACKAGES } from '../src/data/npc_plot_packages';
import {
  allNpcPackages,
  getNpcPackage,
  getNpcPackageByPlotNpcId,
  npcPackageDisplayName,
  plotNpcIdFromPackage,
  validateNpcPackages,
  type NpcPackageDef,
} from '../src/data/npc_packages';
import { getPlotNpcDef } from '../src/data/plot';
import { generateTalkText } from '../src/systems/dialogue';
import { isPlotNpcDead, recordAlifeNpcDeath } from '../src/systems/alife';
import { checkTalkQuest } from '../src/systems/quests';
import { makeGameState, makeTestNpc, makeTestPlayer } from './helpers';

const MAIN_PLOT_IDS = [
  'marko_lolo',
  'liquidator_armorer',
  'liquidator_medic',
  'liquidator_quartermaster',
  'olga',
  'barni',
  'yakov',
  'vanka',
  'major_grom',
  'hell_contact',
  'herald_clue',
  'void_warning',
  'voice',
] as const;

function requiredPlotPackage(plotNpcId: string): NpcPackageDef {
  const pack = getNpcPackageByPlotNpcId(plotNpcId);
  assert.ok(pack, `missing package for plot NPC ${plotNpcId}`);
  return pack;
}

function plotNpcName(plotNpcId: string): string {
  return npcPackageDisplayName(requiredPlotPackage(plotNpcId));
}

test('main plot NPCs are registered as packages and expose package-derived plot defs', () => {
  assert.deepEqual(MAIN_PLOT_NPC_PACKAGES.map(pack => pack.id), [...MAIN_PLOT_IDS]);
  assert.deepEqual(validateNpcPackages(), []);

  const registeredIds = new Set(allNpcPackages().map(pack => pack.id));
  for (const id of MAIN_PLOT_IDS) {
    assert.equal(registeredIds.has(id), true, `${id} package must be registered`);
    const pack = getNpcPackage(id);
    assert.ok(pack, `${id} package is missing`);
    assert.equal(pack.kind, 'plot');
    assert.equal(plotNpcIdFromPackage(pack), id);
    assert.equal(pack.identity.firstName, undefined);
    assert.equal(pack.identity.lastName, undefined);
    assert.equal(pack.identity.patronymic, undefined);

    const def = getPlotNpcDef(id);
    assert.ok(def, `${id} package-derived def is missing`);
    assert.equal(def.name, pack.identity.displayName);
    assert.equal(def.sex, pack.demographics.sex);
    assert.equal(def.isFemale, pack.demographics.sex === 'female');
    assert.equal(def.age, pack.demographics.age);
    assert.equal(def.faction, pack.affiliation.faction);
    assert.equal(def.occupation, pack.affiliation.occupation);
    assert.equal(def.homeFloorKey, pack.placement.homeFloorKey);
    assert.equal(def.specialRoutineId, pack.runtime?.specialRoutineId);
    assert.deepEqual(def.talkLines, [...(pack.speech.talkLines ?? [])]);
    assert.deepEqual(def.talkLinesPost, [...(pack.speech.talkLinesPost ?? [])]);
    assert.deepEqual(def.talkQuestResponse, pack.speech.talkQuestResponse);
  }
});

test('package-derived A-Life reserved identities keep package and plot identity linked', () => {
  const plan = buildAlifePopulationPlan({
    runSeed: 5,
    routeKeys: ['story:living', 'story:maintenance', 'story:hell', 'story:void', 'design:podad', 'design:liquidatorbase'],
    total: MAIN_PLOT_IDS.length,
  });
  const byPlotId = new Map(plan.reserved.map(identity => [identity.plotNpcId, identity]));

  for (const pack of MAIN_PLOT_NPC_PACKAGES) {
    const plotNpcId = plotNpcIdFromPackage(pack);
    assert.ok(plotNpcId);
    const reserved = byPlotId.get(plotNpcId);
    assert.ok(reserved, `${plotNpcId} must have a reserved identity`);
    assert.equal(reserved.id, `npc:${pack.id}`);
    assert.equal(reserved.kind, 'plot');
    assert.equal(reserved.floorKey, pack.placement.homeFloorKey);
    assert.equal(reserved.name, pack.identity.displayName);
    assert.equal(reserved.sex, pack.demographics.sex);
    assert.equal(reserved.faction, pack.affiliation.faction);
    assert.equal(reserved.occupation, pack.affiliation.occupation);
  }
});

test('main plot first-contact and post dialogue still use exact authored order', () => {
  const state = makeGameState();
  const barniPack = requiredPlotPackage('barni');
  const talkLines = barniPack.speech.talkLines ?? [];
  const talkLinesPost = barniPack.speech.talkLinesPost ?? [];
  const barni = makeTestNpc({ plotNpcId: 'barni', name: npcPackageDisplayName(barniPack) });

  assert.equal(generateTalkText(barni, { state }), talkLines[0]);
  assert.equal(generateTalkText(barni, { state }), talkLines[1]);

  const originalRandom = Math.random;
  Math.random = () => 0;
  try {
    barni.plotDone = true;
    const postLine = generateTalkText(barni, { state });
    assert.equal(talkLinesPost.includes(postLine), true);
  } finally {
    Math.random = originalRandom;
  }
});

test('plot TALK quest response remains exact locked authored text', () => {
  const world = new World();
  const player = makeTestPlayer({ id: 1, x: 10, y: 10 });
  const barniPack = requiredPlotPackage('barni');
  const barni = makeTestNpc({
    id: 2,
    x: 10.5,
    y: 10,
    plotNpcId: 'barni',
    name: npcPackageDisplayName(barniPack),
  });
  const state = makeGameState({
    quests: [{
      id: 1,
      type: QuestType.TALK,
      giverId: player.id,
      giverName: 'Ольга Дмитриевна',
      desc: 'Поговорить с Бариновым.',
      targetPlotNpcId: 'barni',
      done: false,
    }],
    nextQuestId: 2,
  });

  checkTalkQuest(barni, player, world, [player, barni], state, state.msgs);

  assert.equal(state.quests[0].done, true);
  const authoredResponse = state.msgs.find(msg => /Макаров и восемь патронов/.test(msg.text))?.text ?? '';
  const expectedResponse = barniPack.speech.talkQuestResponse;
  assert.equal(typeof expectedResponse, 'string');
  assert.equal(authoredResponse, `${npcPackageDisplayName(barniPack)}: «${expectedResponse}»`);
});

test('killing a package-backed plot NPC still records durable plot death', () => {
  const state = makeGameState();
  const olga = makeTestNpc({ id: 3, plotNpcId: 'olga', name: plotNpcName('olga') });

  recordAlifeNpcDeath(state, olga);

  assert.equal(isPlotNpcDead(state, 'olga'), true);
});
