import { DoorState, type Door } from '../core/types';
import type { World } from '../core/world';

function blocksNavigation(state: DoorState): boolean {
  // Ordinary closed doors are actor/interaction state, not navigation topology.
  return state === DoorState.LOCKED || state === DoorState.HERMETIC_CLOSED;
}

export function setDoorState(world: World, door: Door | undefined, state: DoorState): boolean {
  if (!door || door.state === state) return false;
  const oldBlocks = blocksNavigation(door.state);
  door.state = state;
  if (oldBlocks !== blocksNavigation(state)) world.markCellsDirty();
  return true;
}

export function damageDoor(world: World, door: Door, amount: number): boolean {
  if (door.state === DoorState.OPEN || door.state === DoorState.HERMETIC_OPEN) {
    return false; // Cannot damage open doors
  }

  if (door.maxHp === undefined || door.hp === undefined) {
    if (door.state === DoorState.HERMETIC_CLOSED) {
      door.maxHp = 500;
    } else if (door.state === DoorState.LOCKED) {
      door.maxHp = 150;
    } else {
      door.maxHp = 50;
    }
    door.hp = door.maxHp;
  }

  door.hp -= amount;

  if (door.hp <= 0) {
    setDoorState(world, door, DoorState.OPEN);
    world.cellVersion++; // force nav tree rebuild
    return true; // Door was broken
  }
  return false; // Door damaged but not broken
}
