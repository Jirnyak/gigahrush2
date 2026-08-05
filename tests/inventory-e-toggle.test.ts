import { test } from 'node:test';
import * as assert from 'node:assert/strict';

import type { Msg } from '../src/core/types';
import { addItem, getInventorySlotActionInfo, useItem } from '../src/systems/inventory';
import { makeTestPlayer } from './helpers';

test('inventory Enter unequips an already equipped weapon without consuming its slot', () => {
  const player = makeTestPlayer();
  const msgs: Msg[] = [];

  assert.equal(addItem(player, 'knife', 1), true);
  assert.equal(getInventorySlotActionInfo(player, 0)?.useLabel, 'Enter экипировать');

  useItem(player, 0, msgs, 1);
  assert.equal(player.weapon, 'knife');
  assert.equal(getInventorySlotActionInfo(player, 0)?.useLabel, 'Enter снять');

  useItem(player, 0, msgs, 2);
  assert.equal(player.weapon, '');
  assert.equal(player.inventory?.[0]?.defId, 'knife');
  assert.equal(player.inventory?.[0]?.count, 1);
  assert.equal(player.inventory?.length, 1);
  assert.ok(msgs.some(entry => entry.text.includes('Оружие снято')));
});

test('inventory Enter unequips an already active tool without consuming its slot', () => {
  const player = makeTestPlayer();
  const msgs: Msg[] = [];

  assert.equal(addItem(player, 'flashlight', 1), true);
  assert.equal(getInventorySlotActionInfo(player, 0)?.useLabel, 'Enter в инструмент');

  useItem(player, 0, msgs, 1);
  assert.equal(player.tool, 'flashlight');
  assert.equal(getInventorySlotActionInfo(player, 0)?.useLabel, 'Enter снять');

  useItem(player, 0, msgs, 2);
  assert.equal(player.tool, '');
  assert.equal(player.inventory?.[0]?.defId, 'flashlight');
  assert.equal(player.inventory?.[0]?.count, 1);
  assert.equal(player.inventory?.length, 1);
  assert.ok(msgs.some(entry => entry.text.includes('Инструмент снят')));
});

test('inventory Enter still consumes ordinary stack-use items', () => {
  const player = makeTestPlayer({
    needs: { food: 0, water: 50, sleep: 50, pee: 0, poo: 0 },
  });
  const msgs: Msg[] = [];

  assert.equal(addItem(player, 'bread', 2), true);
  assert.equal(getInventorySlotActionInfo(player, 0)?.useLabel, 'Enter применить');

  useItem(player, 0, msgs, 1);
  assert.equal(player.weapon ?? '', '');
  assert.equal(player.tool ?? '', '');
  assert.deepEqual(player.inventory, [{ defId: 'bread', count: 1, data: undefined }]);
  assert.ok((player.needs?.food ?? 0) > 0);
  assert.ok(msgs.some(entry => entry.text.length > 0));
});
