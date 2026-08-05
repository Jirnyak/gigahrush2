import test from 'node:test';
import assert from 'node:assert/strict';
import { EntityType, Faction, FloorLevel, Occupation } from '../src/core/types';
import { registerNpcPackage } from '../src/data/npc_packages';
import {
  createPrefilledAlifeState,
  recordAlifeNpcDeath,
  setAlifeState,
} from '../src/systems/alife';
import {
  buildDemosProfileFeedView,
  buildDemosSocialLinksView,
  canOpenDemosProfileForNpc,
  demosCursorForNpcProfile,
  demosTraitContextTags,
  getDemosProfileDetails,
  getDemosProfileForNpcEntity,
  getDemosTraitViews,
  type DemosSocialLinkSeed,
} from '../src/systems/demos_profiles';
import {
  clearDemosNpcSocialEdges,
  setDemosSocialEdge,
} from '../src/systems/demos_social';
import {
  DEMOS_EDGE_ENEMY,
  DEMOS_EDGE_FRIEND,
  DemosSocialRoleId,
} from '../src/data/demos_social';
import { NPC_VISUAL_FLOOR69_FEMALE } from '../src/entities/npc_visuals';
import { createWorldEventState, publishEvent } from '../src/systems/events';
import { floorKeyForStory } from '../src/systems/floor_keys';
import { makeGameState, makeTestNpc } from './helpers';

function makeProfileState() {
  const state = makeGameState({
    currentFloor: FloorLevel.LIVING,
    worldEvents: createWorldEventState(),
  });
  createPrefilledAlifeState(state, 2468, 4, {
    buckets: [{
      floorKey: floorKeyForStory(FloorLevel.LIVING),
      floor: FloorLevel.LIVING,
      targetCount: 4,
      reserved: [
        {
          name: 'Миша Ребёнок',
          female: false,
          faction: Faction.CITIZEN,
          occupation: Occupation.CHILD,
          familyId: 77,
          level: 1,
        },
        {
          name: 'Нина Родитель',
          female: true,
          faction: Faction.CITIZEN,
          occupation: Occupation.COOK,
          familyId: 77,
          level: 3,
        },
        {
          name: 'Роман Смена',
          female: false,
          faction: Faction.CITIZEN,
          occupation: Occupation.COOK,
          familyId: 88,
          age: 25,
          sex: 'male',
          accountRubles: 1234,
          level: 4,
          canGiveQuest: true,
        },
        {
          name: 'Глеб Недруг',
          female: false,
          faction: Faction.CULTIST,
          occupation: Occupation.PILGRIM,
          familyId: 99,
          level: 5,
        },
      ],
    }],
  });
  return state;
}

function setEdges(state: ReturnType<typeof makeGameState>, alifeId: number, edges: readonly DemosSocialLinkSeed[]): void {
  const host = state as ReturnType<typeof makeGameState> & {
    demosProfileSocialEdges?: Record<number, readonly DemosSocialLinkSeed[]>;
  };
  host.demosProfileSocialEdges = {
    ...(host.demosProfileSocialEdges ?? {}),
    [alifeId]: edges,
  };
}

test('Demos profile traits are deterministic and capped to four slots', () => {
  const state = makeProfileState();
  const first = getDemosTraitViews(state, 3).map(trait => trait.id);
  const second = getDemosTraitViews(state, 3).map(trait => trait.id);
  const contextTags = demosTraitContextTags(state, 3);

  assert.deepEqual(second, first);
  assert.equal(first.length <= 4, true);
  assert.equal(new Set(first).size, first.length);
  assert.ok(contextTags.includes('age.young_adult'));
  assert.ok(contextTags.includes('sex.male'));
  assert.ok(contextTags.some(tag => tag.startsWith('trait.')));
});

test('Demos profile details expose live A-Life page fields and recent feed hints', () => {
  const state = makeProfileState();
  publishEvent(state, {
    type: 'quest_created',
    severity: 2,
    privacy: 'public',
    tags: ['quest', 'demos_profile_test'],
    actorName: 'Роман Смена',
    targetName: 'доска заявок',
    data: { actorAlifeId: 3 },
  });

  const npc = makeTestNpc({ id: 55, alifeId: 3, persistentNpcId: 'alife:3', name: 'Роман Смена' });
  const details = getDemosProfileForNpcEntity(state, npc);
  const feed = buildDemosProfileFeedView(state, 3);

  assert.equal(canOpenDemosProfileForNpc(npc), true);
  assert.equal(demosCursorForNpcProfile(state, npc), 2);
  assert.equal(details?.alifeId, 3);
  assert.equal(details?.dead, false);
  assert.equal(details?.age, 25);
  assert.equal(details?.sexLabel, 'мужской');
  assert.equal(details?.accountRubles, 1234);
  assert.equal(details?.accountLabel, '1234₽');
  assert.equal(details?.favoriteWorkLabel, 'держит кухню');
  assert.equal(details?.lastPostId, 1);
  assert.equal(details?.mentionsRecent, 1);
  assert.equal(feed[0]?.postId, 1);
});

test('Demos profile details expose package bio capital and perk tags', () => {
  registerNpcPackage({
    version: 1,
    id: 'demos_profile_pack',
    kind: 'design',
    identity: { firstName: 'Пакетный', displayName: 'Пакетный Профиль' },
    bio: {
      publicLine: 'держит чужие анкеты под батареей',
      short: 'Записывает людей так, будто стены тоже умеют читать.',
      origin: 'верхняя коммунальная петля',
      work: 'сводит должников и свидетелей',
      markovTags: ['demos_clerk'],
    },
    demographics: { sex: 'male', age: 44 },
    affiliation: { faction: Faction.CITIZEN, occupation: Occupation.SECRETARY },
    placement: { homeFloorKey: floorKeyForStory(FloorLevel.LIVING), presence: 'population' },
    rpg: {
      level: 6,
      perks: [{ id: 'tool_hands', tags: ['paper_memory'] }],
    },
    wealth: {
      debtRubles: 55,
      assetTags: ['ledger'],
    },
    loadout: {},
    social: {},
    visual: {
      npcVisualId: NPC_VISUAL_FLOOR69_FEMALE,
      spriteSeed: 4242,
      portraitHint: 'тонкие очки',
    },
    speech: {},
    tags: ['package_profile'],
  });
  const state = makeGameState({ currentFloor: FloorLevel.LIVING });
  createPrefilledAlifeState(state, 9753, 2, {
    buckets: [{
      floorKey: floorKeyForStory(FloorLevel.LIVING),
      floor: FloorLevel.LIVING,
      targetCount: 2,
      reserved: [{
        id: 'npc:demos_profile_pack',
        kind: 'authored',
        name: 'Пакетный Профиль',
        faction: Faction.CITIZEN,
        occupation: Occupation.SECRETARY,
        money: 125,
        accountRubles: 875,
        level: 6,
      }],
    }],
  });

  const details = getDemosProfileDetails(state, 1);
  assert.equal(details?.packageId, 'demos_profile_pack');
  assert.equal(details?.packageDisplayName, 'Пакетный Профиль');
  assert.equal(details?.packagePublicLine, 'держит чужие анкеты под батареей');
  assert.equal(details?.packageBioLine, 'Записывает людей так, будто стены тоже умеют читать.');
  assert.equal(details?.capitalRubles, 1000);
  assert.equal(details?.capitalLabel.includes('долг 55₽'), true);
  assert.equal(details?.packagePortraitHint, 'тонкие очки');
  assert.ok(details?.packageFlavorTags.includes('perk:tool_hands'));
  assert.ok(details?.packageFlavorTags.includes('paper_memory'));
  assert.ok(details?.packageFlavorTags.includes('package_profile'));
});

test('Demos profile interests do not repeat visible perk labels', () => {
  const state = makeProfileState();
  const details = getDemosProfileDetails(state, 3);
  assert.ok(details);

  const perkLabels = new Set(details.traits.map(trait => trait.label));
  assert.equal(details.interests.some(interest => perkLabels.has(interest)), false);
});

test('Demos social counts use outgoing links only', () => {
  const state = makeProfileState();
  setEdges(state, 1, [
    { targetAlifeId: 3, relation: 90, role: 'friend' },
    { targetAlifeId: 4, relation: -100, role: 'enemy' },
  ]);
  setEdges(state, 2, [
    { targetAlifeId: 1, relation: 90, role: 'parent' },
  ]);

  const details = getDemosProfileDetails(state, 1);
  assert.equal(details?.friendsCount, 1);
  assert.equal(details?.enemiesCount, 1);
  assert.equal(details?.familyCount, 0);
});

test('Demos profile social links read the shared outgoing graph when no override exists', () => {
  const state = makeProfileState();
  clearDemosNpcSocialEdges(state, 1);
  setDemosSocialEdge(state, 1, 3, 90, DEMOS_EDGE_FRIEND);
  setDemosSocialEdge(state, 1, 4, -100, DEMOS_EDGE_ENEMY);

  const details = getDemosProfileDetails(state, 1);
  const links = buildDemosSocialLinksView(state, 1);

  assert.equal(details?.friendsCount, 1);
  assert.equal(details?.enemiesCount, 1);
  assert.equal(links[0]?.targetKind, 'player');
  assert.equal(links.some(link => link.targetAlifeId === 3 && link.role === DemosSocialRoleId.FRIEND), true);
  assert.equal(links.some(link => link.targetAlifeId === 4 && link.role === DemosSocialRoleId.ENEMY), true);
});

test('Demos child profile family label comes from outgoing parent edge', () => {
  const state = makeProfileState();
  setEdges(state, 1, [
    { targetAlifeId: 2, relation: 96, role: 'parent', tags: ['family'] },
  ]);

  const details = getDemosProfileDetails(state, 1);
  const links = buildDemosSocialLinksView(state, 1);

  assert.equal(details?.familyStatusLabel, 'семейное: ребёнок, родитель alife:2');
  assert.equal(details?.familyCount, 1);
  assert.equal(links[0]?.role, DemosSocialRoleId.PARENT);
});

test('Demos dead profiles keep traits and outgoing social summary', () => {
  const state = makeProfileState();
  const dead = makeTestNpc({ id: 71, alifeId: 1, persistentNpcId: 'alife:1', hp: 0, alive: false });
  recordAlifeNpcDeath(state, dead);
  setEdges(state, 1, [
    { targetAlifeId: 2, relation: 92, role: 'parent', tags: ['family'] },
    { targetAlifeId: 4, relation: -90, role: 'enemy' },
  ]);
  setEdges(state, 2, [
    { targetAlifeId: 1, relation: 92, role: 'child', tags: ['family'] },
  ]);

  const details = getDemosProfileDetails(state, 1);
  assert.equal(details?.dead, true);
  assert.equal((details?.traits.length ?? 0) > 0, true);
  assert.equal(details?.familyCount, 1);
  assert.equal(details?.enemiesCount, 1);
  assert.equal(buildDemosSocialLinksView(state, 1).some(link => link.dead && link.targetLabel.startsWith('мертв:')), false);
  assert.equal(buildDemosSocialLinksView(state, 2).some(link => link.dead && link.targetLabel.startsWith('мертв: alife:1')), true);
});

test('Demos face-to-face helper rejects NPCs without stable A-Life identity', () => {
  const state = makeProfileState();
  const transient = makeTestNpc({ id: 12, persistentNpcId: undefined });
  const monsterLike = { ...transient, type: EntityType.MONSTER };

  assert.equal(canOpenDemosProfileForNpc(transient), false);
  assert.equal(canOpenDemosProfileForNpc(monsterLike), false);
  assert.equal(getDemosProfileForNpcEntity(state, transient), undefined);
});

test('Demos one-profile view uses compact trait cache instead of profile-list allocation', () => {
  const state = makeGameState({ currentFloor: FloorLevel.LIVING });
  setAlifeState(state, { seed: 13579, total: 100_000 });

  const details = getDemosProfileDetails(state, 1);
  const cache = (state as typeof state & {
    demosProfileTraitCache?: { traitIds: unknown; ready: unknown; total: number };
  }).demosProfileTraitCache;

  assert.equal(details?.traits.length, 4);
  assert.equal((details?.interests.length ?? 0) <= 5, true);
  assert.equal(cache?.total, 100_000);
  assert.equal(cache?.traitIds instanceof Uint16Array, true);
  assert.equal(cache?.ready instanceof Uint8Array, true);
});
