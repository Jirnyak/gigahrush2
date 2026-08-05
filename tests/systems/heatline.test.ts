import test from 'node:test';
import assert from 'node:assert';
import { World } from '../../src/core/world';
import { summarizeHeatline } from '../../src/systems/heatline';
import { RoomType } from '../../src/core/types';
import { addTestRoom } from '../helpers';

test('heatline: summarizeHeatline', async (t) => {
  await t.test('returns no rooms found message when empty', () => {
    const world = new World();
    const result = summarizeHeatline(world);
    assert.deepStrictEqual(result, ['[HEATLINE] узлы не найдены на этом этаже']);
  });

  await t.test('summarizes one normal room (safe)', () => {
    const world = new World();
    addTestRoom(world, {
      id: 0,
      name: 'Теплотрасса Ноль: обходной узел',
      type: RoomType.PRODUCTION,
      x: 10,
      y: 10,
      w: 10,
      h: 10,
      zoneId: 5,
    });

    // Setting zoneMap to match the zone
    world.zoneMap[world.idx(15, 15)] = 5;

    const result = summarizeHeatline(world);
    assert.strictEqual(result.length, 2);
    assert.strictEqual(result[0], '[HEATLINE] rooms=1 hazard=0 safe=1 repair=0 resolved=0 partial=- vented=0 zones=6');
    assert.strictEqual(result[1], '[HEATLINE] #0 safe prod Теплотрасса Ноль: обходной узел');
  });

  await t.test('summarizes hazard, repair, and static rooms', () => {
    const world = new World();
    addTestRoom(world, { id: 0, name: 'Теплотрасса Ноль: обваренный коридор', type: RoomType.CORRIDOR, x: 0, y: 0, w: 4, h: 4, zoneId: 0 }); // hazard
    addTestRoom(world, { id: 1, name: 'Теплотрасса Ноль: ремонтная зона', type: RoomType.BATHROOM, x: 10, y: 0, w: 4, h: 4, zoneId: 1 }); // repair
    addTestRoom(world, { id: 2, name: 'Теплотрасса Ноль: обычная комната', type: RoomType.STORAGE, x: 20, y: 0, w: 4, h: 4, zoneId: 2 }); // static

    world.zoneMap[world.idx(2, 2)] = 0;
    world.zoneMap[world.idx(12, 2)] = 1;
    world.zoneMap[world.idx(22, 2)] = 2;

    const result = summarizeHeatline(world);
    assert.strictEqual(result.length, 4);
    assert.strictEqual(result[0], '[HEATLINE] rooms=3 hazard=1 safe=0 repair=1 resolved=0 partial=- vented=0 zones=1,2,3');
    assert.strictEqual(result[1], '[HEATLINE] #0 hazard corridor Теплотрасса Ноль: обваренный коридор');
    assert.strictEqual(result[2], '[HEATLINE] #1 repair bath Теплотрасса Ноль: ремонтная зона');
    assert.strictEqual(result[3], '[HEATLINE] #2 static store Теплотрасса Ноль: обычная комната');
  });

  await t.test('summarizes venting, partials, and resolved', () => {
    const world = new World();
    addTestRoom(world, { id: 0, name: 'Теплотрасса Ноль: аварийный выброс', type: RoomType.PRODUCTION, x: 0, y: 0, w: 4, h: 4, zoneId: 0 });
    addTestRoom(world, { id: 1, name: 'Теплотрасса Ноль: сброс открыт', type: RoomType.PRODUCTION, x: 10, y: 0, w: 4, h: 4, zoneId: 0 });
    addTestRoom(world, { id: 2, name: 'Теплотрасса Ноль: частичный шнур', type: RoomType.PRODUCTION, x: 20, y: 0, w: 4, h: 4, zoneId: 0 });

    world.zoneMap[world.idx(2, 2)] = 0;
    world.zoneMap[world.idx(12, 2)] = 0;
    world.zoneMap[world.idx(22, 2)] = 0;

    const result = summarizeHeatline(world);
    assert.ok(result[0].includes('resolved=1'));
    assert.ok(result[0].includes('partial=cord'));
    assert.ok(result[0].includes('vented=1'));
  });

  await t.test('summarizes partial sealant', () => {
    const world = new World();
    addTestRoom(world, { id: 0, name: 'Теплотрасса Ноль: частичный герметик', type: RoomType.PRODUCTION, x: 0, y: 0, w: 4, h: 4, zoneId: 0 });
    world.zoneMap[world.idx(2, 2)] = 0;

    const result = summarizeHeatline(world);
    assert.ok(result[0].includes('partial=sealant'));
  });

  await t.test('respects limit parameter', () => {
    const world = new World();
    for (let i = 0; i < 5; i++) {
      addTestRoom(world, { id: i, name: `Теплотрасса Ноль: комната ${i}`, type: RoomType.PRODUCTION, x: i*10, y: 0, w: 4, h: 4, zoneId: 0 });
      world.zoneMap[world.idx(i*10 + 2, 2)] = 0;
    }

    const result = summarizeHeatline(world, 2);
    // 1 header + 2 limited rooms
    assert.strictEqual(result.length, 3);
  });
});
