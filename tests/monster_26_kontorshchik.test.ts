import { test } from 'node:test';
import * as assert from 'node:assert/strict';

import { EntityType, FloorLevel, MonsterKind, type Entity, type Item } from '../src/core/types';
import {
  BAIT_ATTRACTED_MONSTER_KINDS,
  getMonsterEcology,
} from '../src/data/monster_ecology';
import { MONSTERS } from '../src/entities/monster';
import { DEF, generateSprite } from '../src/entities/kontorshchik';
import {
  consumeNoisyDocumentDelay,
  documentScentStrength,
  isDocumentScentItem,
  markNoisyDocument,
} from '../src/systems/document_scent';
import { baitKindForItem, monsterBaitPreviewForItem } from '../src/systems/monster_bait';
import { mapEditorEntityBrushes } from '../src/systems/map_editor_catalog';
import { S } from '../src/render/pixutil';

function sortedFloors(floors: readonly FloorLevel[] | undefined): FloorLevel[] {
  return [...(floors ?? [])].sort((a, b) => a - b);
}

function carrierWith(items: Item[]): Entity {
  return {
    id: 1,
    type: EntityType.NPC, persistentNpcId: 'player',
    x: 0,
    y: 0,
    angle: 0,
    pitch: 0,
    alive: true,
    speed: 1,
    sprite: 0,
    inventory: items,
  };
}

test('kontorshchik is a standalone document-scent monster', () => {
  const ecology = getMonsterEcology(MonsterKind.KONTORSHCHIK);

  assert.ok(ecology, 'KONTORSHCHIK ecology must exist');
  assert.equal(DEF.kind, MonsterKind.KONTORSHCHIK);
  assert.equal(MONSTERS[MonsterKind.KONTORSHCHIK], DEF);
  assert.deepEqual(DEF.aiFlags, ['documentScent']);
  assert.deepEqual(sortedFloors(DEF.floors), [FloorLevel.MINISTRY, FloorLevel.LIVING]);
  assert.deepEqual(sortedFloors(ecology.floors), sortedFloors(DEF.floors));
  assert.equal(ecology.rumorIds.includes('ecology_kontorshchik_forms'), true);
  assert.match(DEF.counterplay ?? '', /бланк|бумаг|печат/);
  assert.match(ecology.counterplay, /контейнер|бланк|шкаф|стол/);
});

test('kontorshchik replaces the obsolete office zombie variant', () => {
  const ecology = getMonsterEcology(MonsterKind.KONTORSHCHIK);

  assert.equal(DEF.name, 'Конторщик');
  assert.equal(DEF.name.includes('Мертвячина'), false);
  assert.equal(ecology?.rumorIds.some(id => id.includes('office_zombie')), false);
  assert.equal(ecology?.rumorIds.some(id => id.includes('variant')), false);
});

test('kontorshchik sprite reads as suit, paper and stamp', () => {
  const sprite = generateSprite();
  let opaque = 0;
  let paperPixels = 0;
  let stampPixels = 0;

  for (const pixel of sprite) {
    if ((pixel >>> 24) === 0) continue;
    opaque++;
    const r = pixel & 0xff;
    const g = (pixel >>> 8) & 0xff;
    const b = (pixel >>> 16) & 0xff;
    if (r > 145 && g > 110 && b > 70 && b < 170) paperPixels++;
    if (r > 105 && g < 55 && b < 70) stampPixels++;
  }

  assert.equal(sprite.length, S * S);
  assert.ok(opaque > 450, 'sprite should not be visually thin or blank');
  assert.ok(paperPixels > 90, 'yellowed paper strips and folder must be readable');
  assert.ok(stampPixels > 12, 'red stamp bruises must be readable');
});

test('document scent uses document-like tags and ids for aggro and lures', () => {
  assert.equal(isDocumentScentItem('blank_form'), true);
  assert.equal(isDocumentScentItem('official_permit_slip'), true);
  assert.equal(isDocumentScentItem('bread'), false);

  assert.equal(documentScentStrength(carrierWith([{ defId: 'blank_form', count: 2 }])) > 0, true);
  assert.equal(documentScentStrength(carrierWith([{ defId: 'bread', count: 2 }])), 0);

  assert.equal(baitKindForItem('blank_form', 'drop'), 'document');
  assert.equal(baitKindForItem('blank_form', 'use'), null);
  const preview = monsterBaitPreviewForItem('blank_form', 'drop', 1);
  assert.equal(preview?.kind, 'document');
  assert.equal(preview?.baitTags.includes('bait_document'), true);
  assert.equal(BAIT_ATTRACTED_MONSTER_KINDS.includes(MonsterKind.KONTORSHCHIK), true);
});

test('kontorshchik grab marks a document as noisy until the timer expires', () => {
  const slot: Item = { defId: 'blank_form', count: 1 };
  const carrier = carrierWith([slot]);
  const mark = markNoisyDocument(carrier, 10, 42);

  assert.equal(mark?.itemId, 'blank_form');
  assert.equal(consumeNoisyDocumentDelay(slot, 12)?.itemId, 'blank_form');
  assert.ok(slot.data, 'noisy document mark should remain active before expiry');
  assert.equal(consumeNoisyDocumentDelay(slot, 15), undefined);
  assert.equal(slot.data, undefined);
});

test('kontorshchik is available to the map editor monster brush catalog', () => {
  assert.equal(
    mapEditorEntityBrushes().some(brush => brush.kind === 'monster' && brush.monsterKind === MonsterKind.KONTORSHCHIK),
    true,
  );
});
