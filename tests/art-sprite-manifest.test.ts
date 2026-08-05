import { createHash } from 'node:crypto';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { test } from 'node:test';
import * as assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { EntityType, Faction, MonsterKind, Occupation, type Entity } from '../src/core/types';
import {
  ART_SPRITE_MANIFEST,
  NPC_VISUAL_CITIZEN_MALE,
  NPC_VISUAL_CULTIST_FEMALE,
  NPC_VISUAL_CULTIST_MALE,
  NPC_VISUAL_LIQUIDATOR_MALE,
  NPC_VISUAL_OLGA_DMITRIEVNA,
  NPC_VISUAL_SCIENTIST_FEMALE,
  NPC_VISUAL_SCIENTIST_MALE,
  NPC_VISUAL_WILD_MALE,
} from '../src/data/art_sprite_manifest';
import { MAIN_PLOT_NPC_PACKAGES } from '../src/data/npc_plot_packages';
import {
  generateNpcProfileSprite,
  entityWorldSpriteScale,
  generateProceduralEntitySprite,
  generateProceduralMonsterSprite,
  proceduralEntitySpriteKey,
} from '../src/entities/procedural_visuals';
import {
  FIRST_PARTY_NPC_ART_WORLD_SPRITE_SCALE,
  NPC_VISUAL_FAMILIES,
  npcVisualFamily,
  npcVisualTextureKey,
} from '../src/entities/npc_visuals';
import {
  GENERATED_ART_SPRITE_IDS,
  getGeneratedArtSprite,
} from '../src/render/generated_art_sprites';
import { S } from '../src/render/pixutil';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

function resolveSourcePath(sourcePath: string): string {
  const direct = path.join(ROOT, sourcePath);
  if (existsSync(direct)) return direct;
  const dir = path.join(ROOT, path.dirname(sourcePath));
  const wanted = path.basename(sourcePath).normalize('NFC');
  for (const name of readdirSync(dir)) {
    if (name.normalize('NFC') === wanted) return path.join(dir, name);
  }
  throw new Error(`missing source path ${sourcePath}`);
}

function spriteHash(sprite: Uint32Array): number {
  let h = 2166136261;
  for (let i = 0; i < sprite.length; i++) {
    h ^= sprite[i];
    h = Math.imul(h, 16777619) >>> 0;
  }
  return h >>> 0;
}

function opaquePixels(sprite: Uint32Array): number {
  let count = 0;
  for (const px of sprite) if ((px >>> 24) !== 0) count++;
  return count;
}

function rowHasOpaquePixel(sprite: Uint32Array, y: number): boolean {
  for (let x = 0; x < S; x++) {
    if ((sprite[y * S + x] >>> 24) !== 0) return true;
  }
  return false;
}

function pngHeaderSize(file: Buffer, sourcePath: string): { width: number; height: number } {
  assert.equal(file.toString('hex', 0, 8), '89504e470d0a1a0a', `${sourcePath} must be PNG`);
  assert.equal(file.readUInt32BE(8), 13, `${sourcePath} must start with IHDR`);
  assert.equal(file.toString('ascii', 12, 16), 'IHDR', `${sourcePath} must start with IHDR`);
  assert.equal(file[24], 8, `${sourcePath} bit depth`);
  assert.equal(file[25], 6, `${sourcePath} color type`);
  assert.equal(file[28], 0, `${sourcePath} interlace`);
  return { width: file.readUInt32BE(16), height: file.readUInt32BE(20) };
}

function makeNpc(id: number, visualId: string, spriteSeed: number): Entity {
  return {
    id,
    type: EntityType.NPC,
    x: 10 + id,
    y: 12,
    angle: 0,
    pitch: 0,
    alive: true,
    speed: 1,
    sprite: Occupation.DOCTOR,
    spriteSeed,
    npcVisualId: visualId,
    occupation: Occupation.DOCTOR,
    faction: Faction.SCIENTIST,
    isFemale: true,
  };
}

test('first-party art sprite manifest validates source files and generated pixels', () => {
  const ids = new Set<string>();
  const generatedIds = new Set(GENERATED_ART_SPRITE_IDS);
  assert.equal(ART_SPRITE_MANIFEST.length, 30);

  for (const row of ART_SPRITE_MANIFEST) {
    assert.match(row.id, /^[a-z][a-z0-9]*(?:_[a-z0-9]+)*$/);
    assert.equal(ids.has(row.id), false, `duplicate art sprite id ${row.id}`);
    ids.add(row.id);
    assert.equal(row.anchorFeet.x >= 0 && row.anchorFeet.x < 64, true, `${row.id} feet x in bounds`);
    assert.equal(row.anchorFeet.y >= 0 && row.anchorFeet.y < 64, true, `${row.id} feet y in bounds`);
    assert.equal(generatedIds.has(row.id), true, `${row.id} must have generated pixels`);

    const file = readFileSync(resolveSourcePath(row.sourcePath));
    const sha = createHash('sha256').update(file).digest('hex');
    assert.equal(sha, row.sha256, `${row.id} source SHA`);
    const header = pngHeaderSize(file, row.sourcePath);
    assert.equal(row.width, header.width, `${row.id} source width`);
    assert.equal(row.height, header.height, `${row.id} source height`);

    const generated = getGeneratedArtSprite(row.id);
    assert.ok(generated, `${row.id} generated sprite`);
    assert.equal(generated.length, 128 * 128);
    assert.equal(opaquePixels(generated) > 64, true, `${row.id} should not be blank`);
    assert.equal(rowHasOpaquePixel(generated, 127), true, `${row.id} should be bottom-trimmed before runtime fitting`);
  }
});

test('first-party NPC art resolves through visual ids while unknown ids fall back procedurally', () => {
  const expectedVisualIds = [
    NPC_VISUAL_OLGA_DMITRIEVNA,
    NPC_VISUAL_CITIZEN_MALE,
    NPC_VISUAL_WILD_MALE,
    NPC_VISUAL_CULTIST_MALE,
    NPC_VISUAL_LIQUIDATOR_MALE,
    NPC_VISUAL_SCIENTIST_MALE,
    NPC_VISUAL_SCIENTIST_FEMALE,
  ];
  for (const visualId of expectedVisualIds) {
    const family = npcVisualFamily(visualId);
    assert.ok(family, `${visualId} should be a registered NPC visual family`);
    assert.equal(family.source, 'first_party_art');
    assert.equal(family.usesDynamicTexture, true);
    assert.equal(family.worldSpriteScale, FIRST_PARTY_NPC_ART_WORLD_SPRITE_SCALE);
  }
  assert.equal(npcVisualFamily('ulyana'), undefined, 'ambiguous Ulyana art stays manifest-only until bound');

  const olgaPackage = MAIN_PLOT_NPC_PACKAGES.find(pack => pack.id === 'olga');
  assert.equal(olgaPackage?.visual.npcVisualId, NPC_VISUAL_OLGA_DMITRIEVNA);
  assert.equal(olgaPackage?.visual.spriteScale, undefined);

  const olgaArt = getGeneratedArtSprite('olga_dmitrievna')!;
  const olgaProfile = generateNpcProfileSprite(
    123,
    Occupation.DOCTOR,
    Faction.SCIENTIST,
    true,
    Occupation.DOCTOR,
    NPC_VISUAL_OLGA_DMITRIEVNA,
  );
  const unknownProfile = generateNpcProfileSprite(
    123,
    Occupation.DOCTOR,
    Faction.CITIZEN,
    true,
    Occupation.DOCTOR,
    'missing_first_party_art',
  );

  assert.equal(spriteHash(olgaProfile), spriteHash(olgaArt), 'Olga visual id should use exact manual art');
  assert.notEqual(spriteHash(unknownProfile), spriteHash(olgaArt), 'unknown art id should fall back procedurally');
  assert.ok(NPC_VISUAL_FAMILIES.some(family => family.id === NPC_VISUAL_OLGA_DMITRIEVNA));
});

test('fixed art visual families reuse texture keys by visual id and variant', () => {
  const olgaA = makeNpc(1, NPC_VISUAL_OLGA_DMITRIEVNA, 101);
  const olgaB = makeNpc(2, NPC_VISUAL_OLGA_DMITRIEVNA, 202);
  assert.equal(proceduralEntitySpriteKey(olgaA), proceduralEntitySpriteKey(olgaB));
  assert.equal(spriteHash(generateProceduralEntitySprite(olgaA)!), spriteHash(getGeneratedArtSprite('olga_dmitrievna')!));

  const variantKeys = new Set<string>();
  for (let seed = 1; seed <= 64; seed++) {
    const key = npcVisualTextureKey(NPC_VISUAL_LIQUIDATOR_MALE, { seed });
    assert.ok(key);
    variantKeys.add(key);
  }
  assert.deepEqual([...variantKeys].sort(), [
    'first_party_art:liquidator_m_1',
    'first_party_art:liquidator_m_3',
    'first_party_art:liquidator_m_5',
    'first_party_art:liquidator_m_6',
  ]);

  const liquidator = makeNpc(3, NPC_VISUAL_LIQUIDATOR_MALE, 303);
  liquidator.faction = Faction.LIQUIDATOR;
  const liquidatorSprite = generateProceduralEntitySprite(liquidator);
  assert.ok(liquidatorSprite);
  assert.equal(entityWorldSpriteScale(liquidator), FIRST_PARTY_NPC_ART_WORLD_SPRITE_SCALE);
  liquidator.spriteScale = 0.66;
  assert.equal(entityWorldSpriteScale(liquidator), 0.66 * FIRST_PARTY_NPC_ART_WORLD_SPRITE_SCALE);
  const liquidatorHashes = new Set([
    spriteHash(getGeneratedArtSprite('liquidator_m_1')!),
    spriteHash(getGeneratedArtSprite('liquidator_m_3')!),
    spriteHash(getGeneratedArtSprite('liquidator_m_5')!),
    spriteHash(getGeneratedArtSprite('liquidator_m_6')!),
  ]);
  assert.equal(liquidatorHashes.has(spriteHash(liquidatorSprite)), true);
});

test('ordinary NPC art auto-selects occupation before faction and preserves sexed scientist art', () => {
  const citizen = makeNpc(4, '', 404);
  citizen.npcVisualId = undefined;
  citizen.faction = Faction.CITIZEN;
  citizen.occupation = Occupation.TURNER;
  citizen.sprite = Occupation.TURNER;
  citizen.isFemale = false;
  assert.equal(spriteHash(generateProceduralEntitySprite(citizen)!), spriteHash(getGeneratedArtSprite('citizen_m_1')!));
  assert.equal(entityWorldSpriteScale(citizen), FIRST_PARTY_NPC_ART_WORLD_SPRITE_SCALE);
  citizen.spriteScale = 1;
  assert.equal(entityWorldSpriteScale(citizen), FIRST_PARTY_NPC_ART_WORLD_SPRITE_SCALE);

  const scientist = makeNpc(5, '', 505);
  scientist.npcVisualId = undefined;
  scientist.faction = Faction.SCIENTIST;
  scientist.occupation = Occupation.SCIENTIST;
  scientist.sprite = Occupation.SCIENTIST;
  scientist.isFemale = true;
  const scientistSprite = generateProceduralEntitySprite(scientist)!;
  const expectedScientistHashes = new Set([
    spriteHash(getGeneratedArtSprite('scientist_f_1')!),
    spriteHash(getGeneratedArtSprite('scientist_f_2')!),
  ]);
  assert.ok(expectedScientistHashes.has(spriteHash(scientistSprite)), 'Should generate valid scientist female art');
});

test('monster art remains a visual future path and procedural monsters still generate', () => {
  assert.equal(ART_SPRITE_MANIFEST.some(row => row.kind === 'monster'), false);
  const sprite = generateProceduralMonsterSprite(MonsterKind.DIKIY_MERTVYAK, 404);
  assert.equal(sprite.length, S * S);
  assert.equal(opaquePixels(sprite) > 64, true);
});
