import { test } from 'node:test';
import * as assert from 'node:assert/strict';

import { EntityType, MonsterKind, Occupation, type Entity } from '../src/core/types';
import { MONSTER_ECOLOGY } from '../src/data/monster_ecology';
import {
  MONSTER_VISUALS,
  monsterProjectileFamily,
  type MonsterProjectileFamily,
} from '../src/data/monster_visuals';
import { MONSTERS } from '../src/entities/monster';
import { generateNpcProfileSprite, proceduralEntitySpriteKey } from '../src/entities/procedural_visuals';
import { NPC_READABILITY_VISUAL_IDS, NPC_VISUAL_FAMILIES } from '../src/entities/npc_visuals';
import { Spr } from '../src/render/sprite_index';
import { generateSprites } from '../src/render/sprites';

function spriteHash(sprite: Uint32Array): number {
  let h = 2166136261;
  for (let i = 0; i < sprite.length; i++) {
    h ^= sprite[i];
    h = Math.imul(h, 16777619) >>> 0;
  }
  return h >>> 0;
}

function opaquePixels(sprite: Uint32Array): number {
  let opaque = 0;
  for (const px of sprite) if ((px >>> 24) !== 0) opaque++;
  return opaque;
}

function projectileSpriteForFamily(family: MonsterProjectileFamily | undefined): number {
  switch (family) {
    case 'eye_bolt': return Spr.EYE_BOLT;
    case 'protocol_clause': return Spr.PARAGRAPH_BOLT;
    case 'web_lash': return Spr.WEB_BOLT;
    case 'wet_line_shot': return Spr.WET_LINE_BOLT;
    case 'flame_bloom': return Spr.HOSTILE_FLAME_BOLT;
    case 'plasma_core': return Spr.HOSTILE_PLASMA_BOLT;
    case 'psi_pulse':
    default: return Spr.HOSTILE_PSI_BOLT;
  }
}

function monsterEntity(overrides: Partial<Entity>): Entity {
  return {
    id: 7,
    type: EntityType.MONSTER,
    x: 12.5,
    y: 18.5,
    angle: 0,
    pitch: 0,
    alive: true,
    hp: 10,
    speed: 0,
    sprite: 0,
    ...overrides,
  };
}

test('monster visual registry covers ecology, evidence, and ranged projectile families', () => {
  const ecologyByKind = new Map(MONSTER_ECOLOGY.map(def => [def.kind, def]));
  const visualFamilies = new Set<string>();
  const evidenceFamilies = new Set<string>();

  for (const kind of Object.keys(MONSTERS).map(Number) as MonsterKind[]) {
    const visual = MONSTER_VISUALS[kind];
    const ecology = ecologyByKind.get(kind);
    assert.ok(visual, `${MonsterKind[kind]} needs a visual family`);
    assert.ok(ecology?.cue?.trim(), `${MonsterKind[kind]} needs an ecology cue`);
    assert.ok(ecology?.counterplay?.trim(), `${MonsterKind[kind]} needs counterplay`);
    visualFamilies.add(visual.family);
    evidenceFamilies.add(visual.evidence);
    if (MONSTERS[kind].isRanged) assert.ok(visual.projectile, `${MonsterKind[kind]} needs projectile family`);
  }

  assert.equal(visualFamilies.size, 8, 'all reusable monster visual families should be represented');
  assert.equal(evidenceFamilies.size >= 8, true, 'evidence families should not collapse into one mark language');
});

test('ranged monster projectile families assign distinct atlas silhouettes', () => {
  const sprites = generateSprites();
  const seenFamilyHashes = new Map<string, number>();

  for (const kind of Object.keys(MONSTERS).map(Number) as MonsterKind[]) {
    const def = MONSTERS[kind];
    if (!def.isRanged) continue;
    const family = monsterProjectileFamily(kind);
    const expected = projectileSpriteForFamily(family);
    assert.equal(def.projSprite, expected, `${MonsterKind[kind]} projectile sprite should follow visual family`);
    assert.ok(opaquePixels(sprites[expected]) > 20, `${MonsterKind[kind]} projectile sprite should not be blank`);
    seenFamilyHashes.set(family ?? 'psi_pulse', spriteHash(sprites[expected]));
  }

  assert.notEqual(seenFamilyHashes.get('web_lash'), seenFamilyHashes.get('wet_line_shot'));
  assert.notEqual(seenFamilyHashes.get('wet_line_shot'), seenFamilyHashes.get('plasma_core'));
  assert.notEqual(seenFamilyHashes.get('protocol_clause'), seenFamilyHashes.get('psi_pulse'));
});

test('monster procedural sprite keys stay quantized to readable state tiers', () => {
  const base = monsterEntity({ monsterKind: MonsterKind.PROTOKOLNIK, protocolPressureTier: 1 });
  const sameTier = monsterEntity({ monsterKind: MonsterKind.PROTOKOLNIK, protocolPressureTier: 1, spriteScale: 1.28, spriteZ: 0.3 });
  const nextTier = monsterEntity({ monsterKind: MonsterKind.PROTOKOLNIK, protocolPressureTier: 2 });
  assert.equal(proceduralEntitySpriteKey(base), proceduralEntitySpriteKey(sameTier));
  assert.notEqual(proceduralEntitySpriteKey(base), proceduralEntitySpriteKey(nextTier));
});

test('NPC readability visual ids are registered and produce distinct silhouettes', () => {
  const registered = new Set(NPC_VISUAL_FAMILIES.map(family => family.id));
  const hashes = new Set<number>();

  for (const id of NPC_READABILITY_VISUAL_IDS) {
    assert.equal(registered.has(id), true, `${id} should be a registered npcVisualId family`);
    const sprite = generateNpcProfileSprite(88_000 + id.length, Occupation.TRAVELER, undefined, false, undefined, id);
    assert.ok(opaquePixels(sprite) > 160, `${id} should generate a readable NPC silhouette`);
    hashes.add(spriteHash(sprite));
  }

  assert.equal(hashes.size, NPC_READABILITY_VISUAL_IDS.length, 'NPC role silhouettes should not collapse into one sprite');
});
