import { test } from 'node:test';
import * as assert from 'node:assert/strict';

import { Faction, Occupation, type Item } from '../src/core/types';
import { DemosSocialRoleId } from '../src/data/demos_social';
import {
  getNpcPackage,
  compileNpcPackageForEditor,
  npcPackageFromPlotNpc,
  npcPackageDisplayName,
  registerCommunityNpcPackageFolders,
  registerNpcPackage,
  validateNpcPackages,
  type NpcPackageDef,
  clearNpcPackagesForTests,
  allNpcPackages,
} from '../src/data/npc_packages';
import {
  NPC_SPRITE_RLE_MAX_BYTES,
  NPC_PACKAGE_SOCIAL_LINK_CAP,
  validateCommunityNpcPackageFolder,
  validateNpcPackage,
  npcPackageLookupHints,
  type NpcCommunityPackageFolder,
  type NpcSpriteRlePayload,
} from '../src/data/npc_package_schema';
import { NPC_VISUAL_FLOOR69_FEMALE } from '../src/entities/npc_visuals';

function minimalNpcPackage(id: string): NpcPackageDef {
  return {
    version: 1,
    id,
    kind: 'procedural',
    identity: { displayName: 'Тестовый жилец' },
    bio: { publicLine: 'Житель для проверки пакета.' },
    demographics: { sex: 'male', age: 33 },
    affiliation: { faction: Faction.CITIZEN, occupation: Occupation.LOCKSMITH },
    rpg: { level: 1 },
    wealth: {},
    loadout: {},
    social: {},
    visual: {},
    placement: { homeFloorKey: 'story:living', presence: 'population' },
    speech: {},
  };
}

function packageWithInventory(id: string, inventory: readonly Item[]): NpcPackageDef {
  return {
    ...minimalNpcPackage(id),
    loadout: {
      weapon: 'makarov',
      tool: 'flashlight',
      inventory,
    },
  };
}

test('minimal NPC package validates against the canonical schema', () => {
  const result = validateNpcPackage(minimalNpcPackage('minimal_schema_npc'));
  assert.deepEqual(result.errors, []);
  assert.equal(result.valid, true);
});

test('NPC package displayName is the canonical authoring identity field', () => {
  const displayOnly = {
    ...minimalNpcPackage('display_name_only_npc'),
    identity: { displayName: 'Доктор Сима' },
  };
  const legacyFio = {
    ...minimalNpcPackage('legacy_fio_npc'),
    identity: { firstName: 'Анна', patronymic: 'Петровна', lastName: 'Ключница' },
  };

  const displayResult = validateNpcPackage(displayOnly);
  const legacyResult = validateNpcPackage(legacyFio);

  assert.equal(displayResult.valid, true);
  assert.deepEqual(displayResult.warnings, []);
  assert.equal(npcPackageDisplayName(displayOnly), 'Доктор Сима');
  assert.equal(legacyResult.valid, true);
  assert.ok(legacyResult.warnings.some(warning => warning.includes('displayName is canonical')));
  assert.equal(npcPackageDisplayName(legacyFio), 'Анна Петровна Ключница');
});

test('NPC package normalization does not invent legacy FIO fields', () => {
  const displayOnly = minimalNpcPackage('normalized_display_name_npc');
  registerNpcPackage(displayOnly);
  const registered = getNpcPackage(displayOnly.id);

  assert.ok(registered);
  assert.equal(registered.identity.displayName, 'Тестовый жилец');
  assert.equal(registered.identity.firstName, undefined);
  assert.equal(registered.identity.lastName, undefined);
  assert.equal(registered.identity.patronymic, undefined);
});

test('NPC package kind rejects internal reservation categories', () => {
  for (const kind of ['authored', 'ordinary_named', 'event_reserved']) {
    const pack = {
      ...minimalNpcPackage(`bad_kind_${kind}`),
      kind,
    };
    const result = validateNpcPackage(pack);
    assert.equal(result.valid, false, kind);
    assert.ok(result.errors.some(error => error.includes('kind must be plot, design or procedural')), kind);
  }
});

test('plot NPC projection keeps main plot explicit and side/design NPCs non-plot by default', () => {
  const npc = {
    name: 'Доктор Сима',
    isFemale: true,
    sex: 'female' as const,
    age: 29,
    faction: Faction.SCIENTIST,
    occupation: Occupation.DOCTOR,
    sprite: Occupation.DOCTOR,
    homeFloorKey: 'design:floor_69',
    hp: 100,
    maxHp: 100,
    money: 10,
    speed: 1,
    inventory: [],
    talkLines: ['Дышите ровно.'],
    talkLinesPost: [],
  };

  const designPack = npcPackageFromPlotNpc({ id: 'doctor_sima_projection', npc });
  const plotPack = npcPackageFromPlotNpc({ id: 'doctor_sima_plot_projection', npc, kind: 'plot' });
  const proceduralPack = npcPackageFromPlotNpc({
    id: 'doctor_sima_procedural_projection',
    npc: { ...npc, homeFloorKey: 'procedural:z17' },
  });

  assert.equal(designPack.kind, 'design');
  assert.equal(plotPack.kind, 'plot');
  assert.equal(proceduralPack.kind, 'procedural');
  assert.equal(designPack.identity.displayName, 'Доктор Сима');
  assert.equal(designPack.identity.firstName, undefined);
});

test('full NPC package covers bio, speech, social, RPG, visual and loadout fields', () => {
  const pack: NpcPackageDef = {
    ...packageWithInventory('full_schema_npc', [
      { defId: 'bandage', count: 2 },
      { defId: 'water', count: 3 },
    ]),
    kind: 'design',
    identity: {
      firstName: 'Анна',
      lastName: 'Ключница',
      patronymic: 'Петровна',
      nickname: 'Скоба',
      aliases: ['ключница'],
    },
    bio: {
      publicLine: 'Держит ключи от сменного шкафа и не любит сирену.',
      short: 'Смотрит на двери так, будто они ей должны.',
      origin: 'Жилая зона',
      work: 'дежурит у шкафов',
      wants: ['сухие фильтры'],
      fears: ['самосбор'],
      habits: ['считает петли'],
      secrets: ['знает, кто меняет замки без журнала'],
      markovTags: ['bio.fear.samosbor', 'work.keys'],
    },
    rpg: {
      level: 7,
      str: 2,
      agi: 3,
      int: 4,
      perks: [{ id: 'tool_hands', rank: 2, tags: ['work.repair'] }],
    },
    wealth: {
      cashRubles: 70,
      accountRubles: 220,
      debtRubles: 15,
      assetTags: ['keys', 'repair'],
    },
    social: {
      playerRelation: 12,
      karma: 7,
      links: [{
        targetNpcId: 'full_schema_friend',
        relation: 80,
        role: DemosSocialRoleId.FRIEND,
        flags: ['friend', 'work'],
        bidirectional: true,
      }],
    },
    visual: {
      sprite: Occupation.LOCKSMITH,
      spriteScale: 0.74,
      npcVisualId: NPC_VISUAL_FLOOR69_FEMALE,
      spriteSeed: 12345,
      portraitHint: 'ключи и рабочая куртка',
    },
    placement: {
      homeFloorKey: 'story:living',
      presence: 'anchor',
      mobility: 'fixed_home',
      roomId: 'locker_post',
      roomTags: ['storage', 'keys'],
      anchorId: 'locker_post_anchor',
      spawnTags: ['authored'],
    },
    speech: {
      voiceTags: ['terse', 'work'],
      markovDomains: ['relationships'],
      catchphrases: ['Дверь сначала слушают.'],
      forbiddenTopics: ['чужие ключи'],
      talkLines: ['Ключ есть, но причина нужна.'],
      talkLinesPost: ['Журнал видел? Тогда говори.'],
      talkQuestResponse: ['Шкаф открою, но подпись оставишь.'],
      ambientCorpus: ['У петли звук другой.'],
      barkCorpus: ['Кто трогал замок?'],
      demosPostHints: ['ключи', 'сирена'],
    },
    runtime: {
      hp: 160,
      maxHp: 160,
      speed: 1.1,
      isTraveler: false,
      canGiveQuest: true,
      specialRoutineId: 'tutorial_lock_one_hour',
      assignedRoomId: 1,
      initialKills: 0,
    },
    content: {
      plotNpcId: 'full_schema_npc',
      dialogueId: 'full_schema_dialogue',
      questIds: ['full_schema_key_check'],
      roomContentId: 'locker_post',
      documentIds: ['key_log'],
      tradeProfileId: 'resident_tools',
      debugPath: 'debug:npc/full_schema_npc',
    },
    editor: {
      title: 'Анна Ключница',
      source: 'game',
      reviewStatus: 'draft',
      notes: 'Проверочный полный пакет.',
    },
    tags: ['authored', 'test'],
  };

  const result = validateNpcPackage(pack, { packageIds: [pack.id, 'full_schema_friend'] });
  assert.deepEqual(result.errors, []);
  assert.equal(result.valid, true);
});

test('NPC package registry rejects duplicate ids', () => {
  const pack = minimalNpcPackage('registry_duplicate_npc');
  registerNpcPackage(pack);
  assert.throws(() => registerNpcPackage({ ...pack }), /duplicate id/);

  // Clean up global state if `validateNpcPackages` isn't tested here for global errors
  // Actually validateNpcPackages on valid registered packages should return []
  assert.deepEqual(validateNpcPackages(), []);
});

test('validateNpcPackages catches invalid packages and duplicates bypassing registry', () => {
  clearNpcPackagesForTests();
  const packs = allNpcPackages() as any[];

  const validPack = minimalNpcPackage('bulk_valid_npc');

  const invalidPack = {
    ...minimalNpcPackage('bulk_invalid_npc'),
    placement: { homeFloorKey: 'story:not_a_floor', presence: 'population' as const },
  };

  packs.push(validPack);
  packs.push(validPack); // Push exact same package to trigger duplicate error
  packs.push(invalidPack);

  const errors = validateNpcPackages();
  assert.equal(errors.length, 2);
  assert.ok(errors.includes('bulk_valid_npc:duplicate'));
  assert.ok(errors.some(e => e.includes('bulk_invalid_npc:placement.homeFloorKey')));

  clearNpcPackagesForTests();
});

test('NPC package validator rejects bad floor keys', () => {
  const pack = {
    ...minimalNpcPackage('bad_floor_npc'),
    placement: { homeFloorKey: 'story:not_a_floor', presence: 'population' as const },
  };
  const result = validateNpcPackage(pack);
  assert.equal(result.valid, false);
  assert.ok(result.errors.some(error => error.includes('placement.homeFloorKey')));
});

test('NPC package validator rejects invalid item ids and stack overflow', () => {
  const missing = validateNpcPackage(packageWithInventory('bad_item_npc', [{ defId: 'missing_item', count: 1 }]));
  assert.ok(missing.errors.some(error => error.includes('unknown item "missing_item"')));

  const tooMany = validateNpcPackage(packageWithInventory('bad_stack_npc', [{ defId: 'bandage', count: 999 }]));
  assert.ok(tooMany.errors.some(error => error.includes('loadout.inventory[0].count')));
});

test('NPC package validator rejects invalid perks unless caller marks them extension-only', () => {
  const pack = {
    ...minimalNpcPackage('bad_perk_npc'),
    rpg: { level: 3, perks: [{ id: 'not_a_real_perk' }] },
  };
  const strict = validateNpcPackage(pack);
  assert.ok(strict.errors.some(error => error.includes('unknown perk "not_a_real_perk"')));

  const extension = validateNpcPackage(pack, { allowUnknownPerks: true });
  assert.deepEqual(extension.errors, []);
  assert.ok(extension.warnings.some(warning => warning.includes('extension-only')));
});

test('NPC package validator enforces nine NPC social links plus separate player relation', () => {
  const links = Array.from({ length: NPC_PACKAGE_SOCIAL_LINK_CAP + 1 }, (_, index) => ({
    targetNpcId: `social_target_${index}`,
    relation: 1,
    role: DemosSocialRoleId.ACQUAINTANCE,
  }));
  const pack = {
    ...minimalNpcPackage('too_social_npc'),
    social: { playerRelation: 0, links },
  };
  const result = validateNpcPackage(pack, {
    packageIds: [pack.id, ...links.map(link => link.targetNpcId)],
  });
  assert.ok(result.errors.some(error => error.includes('social.links must have at most 9 NPC links')));
});

test('NPC package validator rejects out-of-range relation and karma values', () => {
  const pack = {
    ...minimalNpcPackage('bad_relation_npc'),
    social: {
      playerRelation: 101,
      karma: -128,
      links: [{
        targetNpcId: 'relation_target_npc',
        relation: 128,
        role: DemosSocialRoleId.RIVAL,
      }],
    },
  };
  const result = validateNpcPackage(pack, { packageIds: [pack.id, 'relation_target_npc'] });
  assert.ok(result.errors.some(error => error.includes('social.playerRelation')));
  assert.ok(result.errors.some(error => error.includes('social.karma')));
  assert.ok(result.errors.some(error => error.includes('social.links[0].relation')));
});

test('NPC package validator rejects function fields and runtime-only live entity ids', () => {
  const pack = minimalNpcPackage('function_field_npc') as unknown as Record<string, unknown>;
  (pack.identity as Record<string, unknown>).computed = () => 'bad';
  pack.runtime = { id: 42, hp: 10, maxHp: 10 };
  pack.content = { entityId: 42, plotNpcId: 'function_field_npc' };

  const result = validateNpcPackage(pack);
  assert.ok(result.errors.some(error => error.includes('function values')));
  assert.ok(result.errors.some(error => error.includes('runtime.id')));
  assert.ok(result.errors.some(error => error.includes('content.entityId')));
});

test('NPC package validator rejects remote image URLs and public geometry leaks', () => {
  const pack = {
    ...minimalNpcPackage('unsafe_text_npc'),
    bio: {
      publicLine: 'Знает про 1024x1024 toroidal map.',
    },
    visual: {
      portraitHint: 'https://example.com/portrait.png',
    },
  };
  const result = validateNpcPackage(pack);
  assert.ok(result.errors.some(error => error.includes('remote URLs')));
  assert.ok(result.errors.some(error => error.includes('implementation geometry')));
});


test('NPC package validator catches errors in visual configuration', () => {
  const pack = {
    ...minimalNpcPackage('bad_visual_npc'),
    visual: {
      sprite: -1,
      spriteScale: 2.0,
      spriteSeed: -1,
      npcVisualId: 'unknown_visual_family_123',
      portraitHint: 'a'.repeat(121),
    },
  };
  const result = validateNpcPackage(pack);

  assert.ok(result.errors.some(error => error.includes('visual.sprite must be 0..8191')));
  assert.ok(result.errors.some(error => error.includes('visual.spriteScale must be 0.25..1.6')));
  assert.ok(result.errors.some(error => error.includes('visual.spriteSeed must be 0..4294967295')));
  assert.ok(result.errors.some(error => error.includes('visual.npcVisualId references unknown visual family "unknown_visual_family_123"')));
  assert.ok(result.errors.some(error => error.includes('visual.portraitHint exceeds 120 chars')));
});

test('editor document exposes validation state and registry-derived lookup hints', () => {
  const pack = minimalNpcPackage('editor_lookup_npc');
  registerNpcPackage(pack);
  const doc = compileNpcPackageForEditor(pack.id);
  assert.ok(doc);
  assert.equal(doc.schema, 'gigahrush.npc-package');
  assert.deepEqual(doc.validation.errors, []);
  assert.ok(doc.lookupHints.factions.includes('CITIZEN'));
  assert.ok(doc.lookupHints.occupations.includes('DOCTOR'));
  assert.ok(doc.lookupHints.itemIds.includes('bandage'));
  assert.ok(doc.lookupHints.floorKeys.includes('story:living'));
  assert.ok(doc.lookupHints.visualIds.includes(NPC_VISUAL_FLOOR69_FEMALE));
  assert.ok(doc.lookupHints.perkIds.includes('tool_hands'));
  assert.ok(doc.lookupHints.demosRelationRoles.includes('FRIEND'));
  assert.ok(doc.lookupHints.demosEdgeFlags.includes('friend'));
});

function spriteRlePayload(): NpcSpriteRlePayload {
  return {
    format: 'gigahrush_sprite_rle_v1',
    width: 16,
    height: 16,
    palette: ['#00000000', '#ffffffff'],
    rle: [8, 0, 8, 1],
    anchor: { feetX: 8, feetY: 15 },
    portraitCrop: { x: 0, y: 0, w: 16, h: 12 },
  };
}

function communityFolder(id: string): NpcCommunityPackageFolder {
  return {
    folderName: id,
    npc: minimalNpcPackage(id),
    spriteRle: spriteRlePayload(),
    readme: 'Reviewed runtime package. Original source image is not required.',
    consent: { author: 'fixture', permission: true },
    files: ['npc.json', 'sprite.rle.json', 'README.md', 'consent.json'],
  };
}

test('community drop-in folder validates and registers through explicit index path', () => {
  const folder = communityFolder('community_loader_npc');
  const validation = validateCommunityNpcPackageFolder(folder);
  assert.equal(validation.valid, true, validation.errors.join('; '));

  const errors = registerCommunityNpcPackageFolders([folder]);
  assert.deepEqual(errors, []);
  assert.equal(getNpcPackage('community_loader_npc')?.id, 'community_loader_npc');
});

test('community folder id must match npc json package id', () => {
  const folder = communityFolder('community_folder_id');
  folder.npc = minimalNpcPackage('community_npc_id');

  const validation = validateCommunityNpcPackageFolder(folder);
  assert.equal(validation.valid, false);
  assert.ok(validation.errors.some(error => error.includes('must equal npc.json id')), validation.errors.join('; '));
});

test('community folder requires consent json', () => {
  const folder = communityFolder('community_missing_consent');
  folder.consent = undefined;

  const validation = validateCommunityNpcPackageFolder(folder);
  assert.equal(validation.valid, false);
  assert.ok(validation.errors.some(error => error.includes('consent.json is required')), validation.errors.join('; '));
});

test('community sprite payload rejects oversized RLE data', () => {
  const folder = communityFolder('community_oversized_sprite');
  folder.spriteRle = {
    ...spriteRlePayload(),
    rle: new Array(NPC_SPRITE_RLE_MAX_BYTES + 1).fill(0),
  };

  const validation = validateCommunityNpcPackageFolder(folder);
  assert.equal(validation.valid, false);
  assert.ok(validation.errors.some(error => error.includes('sprite.rle byte length')), validation.errors.join('; '));
});

test('community sprite payload rejects invalid palette and byte values', () => {
  const folder = communityFolder('community_bad_sprite');
  folder.spriteRle = {
    ...spriteRlePayload(),
    palette: ['not-a-color'],
    rle: [1, -1, 256],
  };

  const validation = validateCommunityNpcPackageFolder(folder);
  assert.equal(validation.valid, false);
  assert.ok(validation.errors.some(error => error.includes('sprite.palette[0]')), validation.errors.join('; '));
  assert.ok(validation.errors.some(error => error.includes('sprite.rle[1]')), validation.errors.join('; '));
  assert.ok(validation.errors.some(error => error.includes('sprite.rle[2]')), validation.errors.join('; '));
});

test('community folder rejects invalid npc package data', () => {
  const folder = communityFolder('community_bad_npc');
  folder.npc = packageWithInventory('community_bad_npc', [{ defId: 'missing_item', count: 1 }]);

  const validation = validateCommunityNpcPackageFolder(folder);
  assert.equal(validation.valid, false);
  assert.ok(validation.errors.some(error => error.includes('npc.json')), validation.errors.join('; '));
  assert.ok(validation.errors.some(error => error.includes('unknown item')), validation.errors.join('; '));
});

test('community validation does not load original source image fields', () => {
  let sourceImageRead = false;
  const folder = communityFolder('community_source_image_ignored') as NpcCommunityPackageFolder & { sourcePng?: unknown };
  Object.defineProperty(folder, 'sourcePng', {
    enumerable: true,
    get() {
      sourceImageRead = true;
      throw new Error('source image should not be read by runtime validation');
    },
  });

  const validation = validateCommunityNpcPackageFolder(folder);
  assert.equal(validation.valid, true, validation.errors.join('; '));
  assert.equal(sourceImageRead, false);
});

test('npcPackageLookupHints provides expected arrays and merges context extras', () => {
  const defaultHints = npcPackageLookupHints();

  // Basic validation that properties exist and contain expected values
  assert.ok(defaultHints.factions.includes('CITIZEN'));
  assert.ok(defaultHints.occupations.includes('DOCTOR'));
  assert.ok(defaultHints.itemIds.includes('bandage'));
  assert.ok(defaultHints.floorKeys.includes('story:living'));
  assert.ok(defaultHints.visualIds.includes(NPC_VISUAL_FLOOR69_FEMALE));
  assert.ok(defaultHints.perkIds.includes('tool_hands'));
  assert.ok(defaultHints.demosRelationRoles.includes('FRIEND'));
  assert.ok(defaultHints.demosEdgeFlags.includes('friend'));

  // Arrays without context should not have duplicate entries or unexpected undefined entries
  assert.equal(new Set(defaultHints.floorKeys).size, defaultHints.floorKeys.length);
  assert.equal(new Set(defaultHints.visualIds).size, defaultHints.visualIds.length);
  assert.equal(new Set(defaultHints.perkIds).size, defaultHints.perkIds.length);

  const hintsWithContext = npcPackageLookupHints({
    extraKnownKeys: ['extra_floor_1', 'extra_floor_2', 'story:living'], // includes duplicate
    extraVisualIds: ['custom_visual_1', NPC_VISUAL_FLOOR69_FEMALE], // includes duplicate
    extraPerkIds: ['custom_perk_1', 'tool_hands'], // includes duplicate
  });

  // Verify that extras are added
  assert.ok(hintsWithContext.floorKeys.includes('extra_floor_1'));
  assert.ok(hintsWithContext.visualIds.includes('custom_visual_1'));
  assert.ok(hintsWithContext.perkIds.includes('custom_perk_1'));

  // Verify that uniqueness/deduplication works
  assert.equal(hintsWithContext.floorKeys.filter(k => k === 'story:living').length, 1);
  assert.equal(hintsWithContext.visualIds.filter(v => v === NPC_VISUAL_FLOOR69_FEMALE).length, 1);
  assert.equal(hintsWithContext.perkIds.filter(p => p === 'tool_hands').length, 1);

  // Verify that the lengths match deduplicated logic
  assert.equal(hintsWithContext.floorKeys.length, defaultHints.floorKeys.length + 2);
  assert.equal(hintsWithContext.visualIds.length, defaultHints.visualIds.length + 1);
  assert.equal(hintsWithContext.perkIds.length, defaultHints.perkIds.length + 1);
});

test('NPC package validator rejects invalid bio fields', () => {
  const pack = minimalNpcPackage('bio_test_npc');

  // Helper to test specific bio issues
  const testBio = (bioPatch, expectedErrorFragment) => {
    const result = validateNpcPackage({ ...pack, bio: bioPatch });
    assert.ok(
      result.errors.some(e => e.includes(expectedErrorFragment)),
      `Expected error containing "${expectedErrorFragment}", got: ${result.errors.join(', ')}`
    );
  };

  testBio({}, 'bio.publicLine must be a string');
  testBio({ publicLine: 'x'.repeat(221) }, 'bio.publicLine exceeds 220 chars');

  testBio({ publicLine: 'valid', short: 'x'.repeat(481) }, 'bio.short exceeds 480 chars');
  testBio({ publicLine: 'valid', origin: 'x'.repeat(161) }, 'bio.origin exceeds 160 chars');
  testBio({ publicLine: 'valid', work: 'x'.repeat(161) }, 'bio.work exceeds 160 chars');

  testBio({ publicLine: 'valid', wants: 'not_an_array' }, 'bio.wants must be an array');
  testBio({ publicLine: 'valid', wants: Array(9).fill('a') }, 'bio.wants must have at most 8 entries');
  testBio({ publicLine: 'valid', wants: ['x'.repeat(121)] }, 'bio.wants[0] exceeds 120 chars');

  testBio({ publicLine: 'valid', fears: 'not_an_array' }, 'bio.fears must be an array');
  testBio({ publicLine: 'valid', fears: Array(9).fill('a') }, 'bio.fears must have at most 8 entries');
  testBio({ publicLine: 'valid', fears: ['x'.repeat(121)] }, 'bio.fears[0] exceeds 120 chars');

  testBio({ publicLine: 'valid', habits: 'not_an_array' }, 'bio.habits must be an array');
  testBio({ publicLine: 'valid', habits: Array(9).fill('a') }, 'bio.habits must have at most 8 entries');
  testBio({ publicLine: 'valid', habits: ['x'.repeat(121)] }, 'bio.habits[0] exceeds 120 chars');

  testBio({ publicLine: 'valid', secrets: 'not_an_array' }, 'bio.secrets must be an array');
  testBio({ publicLine: 'valid', secrets: Array(9).fill('a') }, 'bio.secrets must have at most 8 entries');
  testBio({ publicLine: 'valid', secrets: ['x'.repeat(161)] }, 'bio.secrets[0] exceeds 160 chars');

  testBio({ publicLine: 'valid', markovTags: 'not_an_array' }, 'bio.markovTags must be an array');
  testBio({ publicLine: 'valid', markovTags: Array(17).fill('a.b') }, 'bio.markovTags must have at most 16 entries');
  testBio({ publicLine: 'valid', markovTags: ['invalid tag'] }, 'bio.markovTags[0] has invalid id');
});
