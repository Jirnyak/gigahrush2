import test from 'node:test';
import assert from 'node:assert/strict';

import { EntityType, Faction, FloorLevel, Occupation, RoomType, type Entity } from '../src/core/types';
import { getNpcPackageByPlotNpcId } from '../src/data/npc_packages';
import type { ContextSnapshot } from '../src/systems/context';
import type { AlifeNpcSnapshot } from '../src/systems/alife';
import {
  buildDemosFeedView,
  createDemosPostQueue,
  demosPostAuthorFactFromSnapshot,
  enqueueDemosPostFromEvent,
  renderDemosReactionsForPost,
  type DemosMarkovPost,
} from '../src/systems/demos_posts';
import { generateTalkText } from '../src/systems/dialogue';
import { renderMarkovDialogueTalk } from '../src/systems/markov_dialogue';
import {
  clearNpcSpeechPackages,
  lowerNpcPackageSpeechContext,
  npcPackageSpeechContextTags,
  registerNpcSpeechPackage,
  resolveNpcPackageForEntity,
  selectNpcCuratedFallback,
  selectNpcLockedQuestResponse,
  type NpcSpeechPackageView,
} from '../src/systems/npc_package_speech';
import { makeTestNpc } from './helpers';

const TEST_PACK: NpcSpeechPackageView = {
  id: 'npc_speech_test',
  tags: ['authored_test'],
  bio: {
    publicLine: 'дежурит у мокрого медпункта',
    markovTags: ['medpunkt', 'dry_humor'],
    secrets: ['тайный долг за патроны'],
  },
  speech: {
    talkLines: ['Точная первая пакетная реплика.'],
    talkLinesPost: ['Точная пост-реплика пакета.'],
    talkQuestResponse: ['Точный пакетный ответ на TALK.'],
    voiceTags: ['short_orders'],
    ambientCorpus: ['Пакетный бытовой fallback.'],
    barkCorpus: ['Пакетный bark fallback.'],
    demosPostHints: ['inventory_note'],
  },
  rpg: {
    perks: [{ id: 'field_medic', tags: ['triage'] }],
  },
  social: {
    traits: ['careful', { id: 'shift_gossip', tags: ['kitchen'] }],
  },
};

test.afterEach(() => clearNpcSpeechPackages());

function packagedNpc(overrides: Partial<Entity> = {}): Entity & { npcPackageId: string } {
  const npc = makeTestNpc({
    id: 501,
    name: 'Пакетная Нина',
    faction: Faction.SCIENTIST,
    occupation: Occupation.DOCTOR,
    ...overrides,
  }) as Entity & { npcPackageId: string };
  npc.npcPackageId = TEST_PACK.id;
  return npc;
}

function snapshot(overrides: Partial<ContextSnapshot> = {}): ContextSnapshot {
  return {
    hasActiveContract: false,
    hasRecentPlayerTheft: false,
    hasRecentSamosborWarning: false,
    hasRecentMetroEvent: false,
    hasRecentLiftAnomaly: false,
    hasRecentFactionClash: false,
    hasRecentMonsterKill: false,
    hasRecentContainerOpen: false,
    roomMemoryBits: 0,
    roomMemorySeverity: 0,
    hasRoomMemoryTheft: false,
    hasRoomMemoryHelp: false,
    hasRoomMemoryInform: false,
    hasRoomMemoryCombat: false,
    hasRoomMemoryRepair: false,
    hasRoomMemorySamosbor: false,
    hasRecentSamosborAftermath: false,
    hasRecentProductionOutput: false,
    hasRecentProductionShortage: false,
    nearbyContainer: false,
    nearbyScreenRumorIds: [],
    nearbyProduction: false,
    isDangerousZone: false,
    isSafeOwnZone: false,
    isHungry: false,
    isThirsty: false,
    isTired: false,
    isWounded: false,
    isCritical: false,
    ...overrides,
  };
}

function alifeSnapshot(overrides: Partial<AlifeNpcSnapshot> = {}): AlifeNpcSnapshot {
  return {
    id: 1,
    floorKey: 'story:living',
    floor: FloorLevel.LIVING,
    faction: Faction.SCIENTIST,
    occupation: Occupation.DOCTOR,
    name: 'Пакетная Нина',
    female: true,
    age: 31,
    sex: 'female',
    level: 3,
    hp: 80,
    maxHp: 100,
    money: 15,
    accountRubles: 0,
    familyId: 1,
    canGiveQuest: false,
    karma: 0,
    dead: false,
    reservedIdentityId: TEST_PACK.id,
    ...overrides,
  };
}

test('package talk lines route as locked author text', () => {
  registerNpcSpeechPackage(TEST_PACK);
  const npc = packagedNpc();

  assert.equal(generateTalkText(npc, { time: 1 }), 'Точная первая пакетная реплика.');
  const pack = resolveNpcPackageForEntity(npc);
  assert.ok(pack);
  const response = selectNpcLockedQuestResponse(pack, 1);
  assert.equal(response?.source, 'locked_author_text');
  assert.equal(response?.text, 'Точный пакетный ответ на TALK.');
});

test('package ambient corpus becomes curated fallback when routed generation is unavailable', () => {
  registerNpcSpeechPackage(TEST_PACK);
  const npc = packagedNpc();

  const result = renderMarkovDialogueTalk(npc, snapshot(), {
    seed: 2,
    repeatIndex: 0,
    routeSpeech: () => undefined,
  });

  assert.equal(result.source, 'curated_pool');
  assert.equal(result.text, 'Пакетный бытовой fallback.');
  assert.equal(selectNpcCuratedFallback(TEST_PACK, 'bark_ambient', 2), 'Пакетный bark fallback.');
});

test('package voice bio perk and trait tags enter Markov context without hidden secrets', () => {
  registerNpcSpeechPackage(TEST_PACK);
  const npc = packagedNpc();
  const ctx = lowerNpcPackageSpeechContext(TEST_PACK, npc, 'dialogue');

  assert.ok(ctx.tags.includes('voice.short_orders'));
  assert.ok(ctx.tags.includes('bio.medpunkt'));
  assert.ok(ctx.tags.includes('perk.field_medic'));
  assert.ok(ctx.tags.includes('perk_tag.triage'));
  assert.ok(ctx.tags.includes('trait.careful'));
  assert.ok(ctx.tags.includes('trait.shift_gossip'));
  assert.equal(ctx.tags.some(tag => tag.includes('тайный') || tag.includes('dolg')), false);
  assert.equal(ctx.tags.some(tag => tag.includes('secret')), false);
});

test('Demos posts and reactions can receive package bio tags from supplied facts', () => {
  registerNpcSpeechPackage(TEST_PACK);
  const queue = createDemosPostQueue();
  const author = alifeSnapshot();
  const post = enqueueDemosPostFromEvent(queue, {
    id: 91,
    type: 'samosbor_warning',
    time: 10,
    day: 0,
    hour: 8,
    minute: 10,
    floor: FloorLevel.LIVING,
    severity: 3,
    privacy: 'public',
    truth: 'fact',
    tags: [],
    data: { actorAlifeId: author.id },
  }, {
    snapshotForAlifeId: id => id === author.id ? demosPostAuthorFactFromSnapshot(author) : undefined,
  });
  assert.ok(post);
  assert.ok(post.tags.includes('bio.medpunkt'));
  assert.ok(post.tags.includes('demos_hint.inventory_note'));

  let reactionTags: readonly string[] = [];
  const reactionPackTags = npcPackageSpeechContextTags(TEST_PACK, author, 'demos_reaction');
  const reactionPost: DemosMarkovPost = {
    id: 7,
    authorAlifeId: 99,
    createdAt: 1,
    templateId: 'test',
    seed: 17,
    args: [],
    tags: ['shortage'],
  };
  const reactions = renderDemosReactionsForPost(reactionPost, [{
    targetAlifeId: author.id,
    relation: 80,
    tags: reactionPackTags,
  }], {
    routeSpeech: request => {
      reactionTags = request.context.tags;
      return {
        text: 'Проверю по списку.',
        source: 'generated_markov',
        intent: request.intent,
        tags: request.context.tags,
        fallbackUsed: false,
      };
    },
  });

  assert.equal(reactions.length, 1);
  assert.ok(reactionTags.includes('bio.medpunkt'));
  assert.ok(reactionTags.includes('demos_hint.inventory_note'));

  const feed = buildDemosFeedView(queue, {
    routeSpeech: request => ({
      text: request.context.tags.join('|'),
      source: 'generated_markov',
      intent: request.intent,
      tags: request.context.tags,
      fallbackUsed: false,
    }),
  });
  assert.match(feed.posts[0].text, /bio\.medpunkt/);
});

test('plot safety-critical lines remain exact and ordinary NPC talk works without package', () => {
  const barniCanonicalPack = getNpcPackageByPlotNpcId('barni');
  assert.ok(barniCanonicalPack, 'missing package for barni');
  const barni = makeTestNpc({
    id: 77,
    name: barniCanonicalPack.identity.displayName,
    plotNpcId: 'barni',
  });
  const barniPack = resolveNpcPackageForEntity(barni);
  assert.ok(barniPack);
  const expectedResponse = barniCanonicalPack.speech.talkQuestResponse;
  assert.equal(typeof expectedResponse, 'string');
  assert.equal(selectNpcLockedQuestResponse(barniPack, 1)?.text, expectedResponse);

  const ordinary = renderMarkovDialogueTalk(
    {
      id: 7,
      type: EntityType.NPC,
      x: 10,
      y: 10,
      angle: 0,
      pitch: 0,
      alive: true,
      speed: 1,
      sprite: 0,
      name: 'Сосед',
      faction: Faction.CITIZEN,
      occupation: Occupation.HOUSEWIFE,
    },
    snapshot({
      floor: FloorLevel.LIVING,
      roomType: RoomType.KITCHEN,
      roomName: 'Кухня у гермы',
      npcFaction: Faction.CITIZEN,
      npcOccupation: Occupation.HOUSEWIFE,
    }),
    { seed: 12, repeatIndex: 0 },
  );

  assert.equal(ordinary.source, 'generated_markov');
  assert.match(ordinary.text, /герм/i);
});

test('unknown plot NPC ids do not synthesize speech packages', () => {
  const legacyId = 'package_less_speech_fixture';
  const npc = makeTestNpc({ id: 78, name: 'Голос без пакета', plotNpcId: legacyId });
  const pack = resolveNpcPackageForEntity(npc);

  assert.equal(pack, undefined);
  assert.notEqual(generateTalkText(npc, { time: 1 }), 'Эта реплика не должна попасть в speech package.');
});
