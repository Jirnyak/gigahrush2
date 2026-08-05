import { test } from 'node:test';
import * as assert from 'node:assert/strict';

import { EntityType, type Entity } from '../src/core/types';
import { World } from '../src/core/world';
import {
  MATKA_DOKUMENTOV_ID,
  MATKA_DOKUMENTOV_ROOM,
  MATKA_DOKUMENTOV_THREAT_CAP,
  generateMatkaDokumentovRoom,
} from '../src/gen/ministry/matka_dokumentov';

test('Matka Dokumentov room owns a bounded document-boss puzzle', () => {
  const world = new World();
  const entities: Entity[] = [];
  const nextId = { v: 1 };

  const result = generateMatkaDokumentovRoom(world, 0, entities, nextId, 512, 512);
  const room = world.rooms.find(r => r.name === MATKA_DOKUMENTOV_ROOM);
  const containers = world.containers.filter(c => c.tags.includes(MATKA_DOKUMENTOV_ID));
  const tags = new Set(containers.flatMap(c => c.tags));

  assert.equal(result.nextRoomId, 1);
  assert.ok(room, 'room should be generated');
  assert.equal(containers.length, 6, 'puzzle should expose core, form, stack, decoy, and two cabinets');
  assert.equal(MATKA_DOKUMENTOV_THREAT_CAP, 5, 'active paper threat cap must stay at five');

  for (const tag of ['paper_anchor', 'cancellation_form', 'burn_stack', 'decoy_forms', 'cabinet']) {
    assert.equal(tags.has(tag), true, `missing puzzle tag ${tag}`);
  }

  const core = containers.find(c => c.tags.includes('paper_anchor'));
  const cancel = containers.find(c => c.tags.includes('cancellation_form'));
  assert.ok(core?.inventory.some(i => i.defId === 'unsigned_order'), 'core should hold the unsigned order objective');
  assert.ok(cancel?.inventory.some(i => i.defId === 'official_permit_slip'), 'cancellation form should be document-based');
  assert.ok(entities.some(e => e.type === EntityType.ITEM_DROP && e.inventory?.some(i => i.defId === 'blank_form')));
});
