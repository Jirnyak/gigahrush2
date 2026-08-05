import { test } from 'node:test';
import * as assert from 'node:assert/strict';

import { FloorLevel, ItemType } from '../src/core/types';
import { ITEM_TAGS, ITEMS } from '../src/data/items';
import { resourceForItem } from '../src/data/resources';
import { SAMOSBOR_AFTERMATH_BEATS, getSamosborAftermathBeats } from '../src/data/samosbor_variants';

test('slime sense node is a rare NII slime organ sample', () => {
  const def = ITEMS.slime_sense_node;

  assert.equal(def.type, ItemType.MISC);
  assert.equal(def.name, 'Чувствительный узел слизи');
  assert.deepEqual(def.spawnRooms, []);
  assert.equal(def.spawnW, 0);
  assert.equal(def.stack, 3);
  assert.equal(resourceForItem(def.id)?.id, 'slime_samples');

  for (const tag of ['slime', 'sample', 'organ', 'sense', 'echolocation', 'nii', 'aftermath', 'evidence']) {
    assert.ok(def.tags?.includes(tag), `slime_sense_node item must carry ${tag} tag`);
    assert.ok(ITEM_TAGS.slime_sense_node?.includes(tag), `slime_sense_node tags must publish ${tag} tag`);
  }
});

test('slime sense node is reachable through rare Maintenance slime aftermath', () => {
  const beat = SAMOSBOR_AFTERMATH_BEATS.find(def => def.id === 'aftermath_slime_sense_node');

  assert.ok(beat);
  assert.equal(beat.itemId, 'slime_sense_node');
  assert.equal(beat.effect, 'item_residue');
  assert.equal(beat.floors.includes(FloorLevel.MAINTENANCE), true);
  assert.equal(beat.variants.includes('wet'), true);
  assert.equal(beat.variants.includes('classic'), true);
  assert.equal(beat.maxRuns, 2);
  assert.ok(beat.weight < 10, 'sense node aftermath should stay rare');
  for (const tag of ['slime', 'sample', 'sense', 'nii', 'aftermath']) {
    assert.ok(beat.tags.includes(tag), `aftermath beat must publish ${tag} tag`);
  }

  assert.equal(
    getSamosborAftermathBeats('wet', FloorLevel.MAINTENANCE).some(def => def.id === 'aftermath_slime_sense_node'),
    true,
  );
});
