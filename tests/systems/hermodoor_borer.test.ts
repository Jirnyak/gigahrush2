import test from 'node:test';
import assert from 'node:assert';
import { World } from '../../src/core/world';
import { DoorState, FloorLevel, Cell, RoomType } from '../../src/core/types';
import { blocksHermodoorBorerSeal, updateHermodoorBorer, debugForceHermodoorBorer } from '../../src/systems/hermodoor_borer';
import { makeGameState, makeTestPlayer, addTestRoom } from '../helpers';

test('blocksHermodoorBorerSeal handles untracked door', () => {
    const world = new World();
    const doorIdx = world.idx(5, 7);
    const state = makeGameState({ currentFloor: FloorLevel.LIVING });

    assert.equal(blocksHermodoorBorerSeal(world, state, doorIdx, 1), false);
});

test('blocksHermodoorBorerSeal allows sealing during warning phase', () => {
    const world = new World();
    const doorIdx = world.idx(5, 7);
    addTestRoom(world, { id: 1, x: 5, y: 5, w: 5, h: 5, type: RoomType.LIVING, doors: [doorIdx] });
    world.cells[doorIdx] = Cell.DOOR;
    world.roomMap[doorIdx] = 1;
    world.doors.set(doorIdx, { idx: doorIdx, state: DoorState.HERMETIC_CLOSED, roomA: 1, roomB: -1, keyId: '', timer: 0 });

    const player = makeTestPlayer({ id: 1, x: 15, y: 15 });
    const state = makeGameState({ currentFloor: FloorLevel.LIVING });

    debugForceHermodoorBorer(world, player, [player], state, { v: 10 });

    assert.equal(blocksHermodoorBorerSeal(world, state, doorIdx, 1), false);
});

test('blocksHermodoorBorerSeal handles wrong floor or room', () => {
    const world = new World();
    const doorIdx = world.idx(5, 7);
    addTestRoom(world, { id: 1, x: 5, y: 5, w: 5, h: 5, type: RoomType.LIVING, doors: [doorIdx] });
    world.cells[doorIdx] = Cell.DOOR;
    world.roomMap[doorIdx] = 1;
    world.doors.set(doorIdx, { idx: doorIdx, state: DoorState.HERMETIC_CLOSED, roomA: 1, roomB: -1, keyId: '', timer: 0 });

    const player = makeTestPlayer({ id: 1, x: 15, y: 15 });
    const state = makeGameState({ currentFloor: FloorLevel.LIVING });

    debugForceHermodoorBorer(world, player, [player], state, { v: 10 });

    assert.equal(blocksHermodoorBorerSeal(world, state, doorIdx, 2), false);

    state.currentFloor = FloorLevel.ROOF;
    assert.equal(blocksHermodoorBorerSeal(world, state, doorIdx, 1), false);
});

test('blocksHermodoorBorerSeal blocks sealing and forces open when damaged', () => {
    const world = new World();
    const doorIdx = world.idx(5, 7);
    addTestRoom(world, { id: 1, x: 5, y: 5, w: 5, h: 5, type: RoomType.LIVING, doors: [doorIdx] });
    world.cells[doorIdx] = Cell.DOOR;
    world.roomMap[doorIdx] = 1;
    const door = { idx: doorIdx, state: DoorState.HERMETIC_CLOSED, roomA: 1, roomB: -1, keyId: '', timer: 0 };
    world.doors.set(doorIdx, door);

    const player = makeTestPlayer({ id: 1, x: 15, y: 15 });
    const entities = [player];
    const state = makeGameState({ currentFloor: FloorLevel.LIVING });

    debugForceHermodoorBorer(world, player, entities, state, { v: 10 });

    // Fast forward to damaged phase
    state.time += 600; // wait out warning delay
    updateHermodoorBorer(world, entities, state, 0, { v: 10 });

    const isBlocked = blocksHermodoorBorerSeal(world, state, doorIdx, 1);

    assert.equal(isBlocked, true);
    assert.equal(door.state, DoorState.HERMETIC_OPEN);
    assert.ok(state.msgs.some(msg => msg.text.includes('Укрытие скомпрометировано')));
});
