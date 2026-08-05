import { test } from 'node:test';
import * as assert from 'node:assert/strict';

import { FloorLevel } from '../src/core/types';
import { World } from '../src/core/world';
import { isMapCellExplored, resetMapExploration, updateMapExploration } from '../src/systems/map_exploration';
import { registerRouteCue, tryUseRouteCue } from '../src/systems/route_cues';
import { addTestRoom, makeGameState, makeTestPlayer } from './helpers';

function makePaidRouteAdviceWorld(): { world: World; hiddenIdx: number } {
  const world = new World();
  addTestRoom(world, { id: 0, x: 10, y: 10, w: 6, h: 6, zoneId: 0, name: 'Комната живой карты' });
  addTestRoom(world, { id: 1, x: 80, y: 80, w: 8, h: 8, zoneId: 1, zoneLevel: 4, name: 'Дальняя кладовая' });
  return { world, hiddenIdx: world.idx(84, 84) };
}

function registerPaidRouteAdviceCue(world: World): void {
  registerRouteCue(world, {
    id: 'test_paid_route_advice',
    x: 12.5,
    y: 12.5,
    targetX: 12.5,
    targetY: 12.5,
    floor: FloorLevel.LIVING,
    roomId: 0,
    targetRoomId: 0,
    label: 'живая карта',
    hint: '100р за маршрутную сводку',
    targetName: 'платная маршрутная сводка',
    color: '#8fd',
    tags: ['test', 'paid_route_advice'],
    toneSeed: 42,
    paidRouteAdvice: { priceRubles: 100, sellerName: 'Сева' },
  });
}

test('paid route cue spends money without revealing hidden map cells', () => {
  const { world, hiddenIdx } = makePaidRouteAdviceWorld();
  resetMapExploration(world);
  const player = makeTestPlayer({ x: 12.5, y: 12.5, money: 150 });
  const state = makeGameState({ currentFloor: FloorLevel.LIVING });
  updateMapExploration(world, player, state);
  assert.equal(isMapCellExplored(world, hiddenIdx), false);

  registerPaidRouteAdviceCue(world);
  assert.equal(tryUseRouteCue(world, player, state, 12, 12), true);

  assert.equal(player.money, 50);
  assert.equal(isMapCellExplored(world, hiddenIdx), false);
  assert.equal(state.msgs.some(entry => /даёт маршрут/.test(entry.text)), true);
});

test('paid route cue does not charge without enough money', () => {
  const { world, hiddenIdx } = makePaidRouteAdviceWorld();
  resetMapExploration(world);
  const player = makeTestPlayer({ x: 12.5, y: 12.5, money: 10 });
  const state = makeGameState({ currentFloor: FloorLevel.LIVING });
  updateMapExploration(world, player, state);
  registerPaidRouteAdviceCue(world);

  assert.equal(tryUseRouteCue(world, player, state, 12, 12), true);

  assert.equal(player.money, 10);
  assert.equal(isMapCellExplored(world, hiddenIdx), false);
  assert.match(state.msgs[state.msgs.length - 1]?.text ?? '', /нужно 100₽/);
});
