import { test } from 'node:test';
import * as assert from 'node:assert/strict';

import { ItemType } from '../src/core/types';
import { ITEM_TAGS, ITEMS } from '../src/data/items';
import { RESOURCE_BY_ID, resourceForItem } from '../src/data/resources';
import { generateSlimeNiiDesignFloor } from '../src/gen/design_floors/slime_nii';

const SAMPLEWARE_ID = 'nii_sample_container';

test('sealed_sample_jar is deduped into the official NII sample container', () => {
  assert.equal(ITEMS.sealed_sample_jar, undefined);

  const def = ITEMS[SAMPLEWARE_ID];
  assert.equal(def.id, SAMPLEWARE_ID);
  assert.equal(def.name, 'Тара НИИ для пробы');
  assert.equal(def.type, ItemType.MISC);
  assert.deepEqual(def.spawnRooms, []);
  assert.equal(def.spawnW, 0);
  assert.equal(resourceForItem(def.id)?.id, 'slime_samples');
  assert.ok(RESOURCE_BY_ID.documents.itemIds.includes(def.id));

  for (const tag of ['sampleware', 'container', 'official', 'document', 'audit', 'science', 'trade', 'sealed', 'legal_handoff']) {
    assert.ok(ITEM_TAGS[SAMPLEWARE_ID]?.includes(tag), `NII sample container must publish ${tag}`);
    assert.ok(def.tags?.includes(tag), `NII sample container item must carry ${tag}`);
  }
});

test('slime NII exposes official sealed sampleware as reachable stock', () => {
  const generated = generateSlimeNiiDesignFloor();
  const source = generated.world.containers.find(container =>
    container.inventory.some(item => item.defId === SAMPLEWARE_ID)
  );

  assert.ok(source, 'slime NII should expose NII sample containers');
  assert.ok(source.tags.includes('slime_nii'));
});
