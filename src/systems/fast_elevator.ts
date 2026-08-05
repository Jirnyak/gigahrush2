import { Entity, GameState, LiftDirection } from '../core/types';
import { World } from '../core/world';
import {
  ensureFloorRunState,
  floorRunEntryForZ,
  isFloorZUnlocked,
  unlockFloorZ,
  unlockedFloorZs,
} from './procedural_floors';

export interface FastElevatorOverlaySnapshot {
  open: boolean;
  selectedIndex: number;
  availableFloors: number[];
  floorLabels: string[];
  message: string;
}

const runtime = {
  open: false,
  selectedIndex: 0,
  availableFloors: [] as number[],
  floorLabels: [] as string[],
  message: ''};

// Fast travel network: visiting a fast elevator unlocks the current floor, and the
// menu only offers floors the player has already unlocked by reaching them on foot.
export function openFastElevator(state: GameState, __player: Entity): void {
  const run = ensureFloorRunState(state);
  unlockFloorZ(state, run.currentZ);

  runtime.open = true;
  runtime.availableFloors = [...unlockedFloorZs(state)]; // sorted high -> low (+50..-50)
  runtime.floorLabels = runtime.availableFloors.map(z => floorRunEntryForZ(state, z)?.label ?? `Этаж ${z}`);

  const currentIndex = runtime.availableFloors.indexOf(run.currentZ);
  runtime.selectedIndex = currentIndex >= 0 ? currentIndex : 0;
  runtime.message = runtime.availableFloors.length <= 1
    ? 'Сеть пуста. Доберитесь до других этажей, чтобы открыть их.'
    : '';
  state.paused = true;
}

export function closeFastElevator(): void {
  runtime.open = false;
  runtime.message = '';
}

export function isFastElevatorOverlayOpen(): boolean {
  return runtime.open;
}

export function moveFastElevatorSelection(delta: number): void {
  if (runtime.availableFloors.length === 0) return;
  runtime.selectedIndex = (runtime.selectedIndex + delta + runtime.availableFloors.length) % runtime.availableFloors.length;
  runtime.message = '';
}

export function activateFastElevator(_world: World, state: GameState, _player: Entity, switchFloor: (dir: LiftDirection, msg?: string, color?: string, allow?: boolean, targetZ?: number) => void): boolean {
  const targetZ = runtime.availableFloors[runtime.selectedIndex];
  if (targetZ === undefined) return false;

  const currentZ = ensureFloorRunState(state).currentZ;
  if (targetZ === currentZ) {
    runtime.message = 'Вы уже на этом этаже.';
    return false;
  }

  if (!isFloorZUnlocked(state, targetZ)) {
    runtime.message = '[НЕДОСТУПНО] Этаж ещё не открыт.';
    return false;
  }

  const direction = targetZ < currentZ ? LiftDirection.DOWN : LiftDirection.UP;
  const label = floorRunEntryForZ(state, targetZ)?.label ?? `Этаж ${targetZ}`;
  switchFloor(direction, `Скоростной лифт: ${label}`, '#4cf', false, targetZ);
  closeFastElevator();
  return true;
}

export function getFastElevatorOverlaySnapshot(__player: Entity): FastElevatorOverlaySnapshot {
  return {
    open: runtime.open,
    selectedIndex: runtime.selectedIndex,
    availableFloors: runtime.availableFloors,
    floorLabels: runtime.floorLabels,
    message: runtime.message};
}
