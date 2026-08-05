import { World } from '../core/world';
import { W, Cell, DoorState } from '../core/types';

const FADE_RATE = 2; // Amount to decrease per update
const DIFFUSION = 0.25; // 25% of cell value spreads to neighbors

let tickCounter = 0;
const DIRS = [
  { dx: 1, dy: 0 },
  { dx: -1, dy: 0 },
  { dx: 0, dy: 1 },
  { dx: 0, dy: -1 },
];

let nextField: Uint8Array | null = null;
let activeMinX = 0;
let activeMinY = 0;
let activeMaxX = W - 1;
let activeMaxY = W - 1;
let isFullScan = true;

export function updateDangerField(world: World, dt: number): void {
  // Update ~2 times a second to save CPU
  tickCounter += dt;
  if (tickCounter < 0.5) return;
  tickCounter -= 0.5;

  const field = world.dangerField;
  const wSq = W * W;
  
  if (!nextField) {
    nextField = new Uint8Array(wSq);
  } else {
    // Only clear the active bounding box from last frame
    if (isFullScan) {
      nextField.fill(0);
    } else {
      for (let cy = activeMinY; cy <= activeMaxY; cy++) {
        const row = cy * W;
        for (let cx = activeMinX; cx <= activeMaxX; cx++) {
          nextField[row + cx] = 0;
        }
      }
    }
  }

  let nextMinX = W;
  let nextMinY = W;
  let nextMaxX = -1;
  let nextMaxY = -1;
  let activeCells = 0;

  const startY = isFullScan ? 0 : activeMinY;
  const endY = isFullScan ? W - 1 : activeMaxY;
  const startX = isFullScan ? 0 : activeMinX;
  const endX = isFullScan ? W - 1 : activeMaxX;

  for (let cy = startY; cy <= endY; cy++) {
    const rowBase = cy * W;
    for (let cx = startX; cx <= endX; cx++) {
      const i = rowBase + cx;
      const val = field[i];
      if (val === 0) continue;

      activeCells++;

      // Decay the original value
      const decayed = Math.max(0, val - FADE_RATE);
      if (decayed === 0) continue;
      
      // Update new bounding box
      if (cx < nextMinX) nextMinX = cx;
      if (cx > nextMaxX) nextMaxX = cx;
      if (cy < nextMinY) nextMinY = cy;
      if (cy > nextMaxY) nextMaxY = cy;
      
      // Check if cell is permeable to fluid
      const cellId = world.cells[i];
      const isSolid = cellId === Cell.WALL || cellId === Cell.ABYSS || cellId === Cell.LIFT;
      let isClosedDoor = false;
      if (cellId === Cell.DOOR) {
        const door = world.doors.get(i);
        isClosedDoor = !!door && (door.state === DoorState.CLOSED || door.state === DoorState.LOCKED || door.state === DoorState.HERMETIC_CLOSED);
      }
      
      // If solid or closed door, it just fades quickly without spreading
      if (isSolid || isClosedDoor) {
        nextField[i] = Math.max(nextField[i], decayed);
        continue;
      }

      const spreadAmount = Math.floor(decayed * DIFFUSION);
      const retainAmount = decayed - spreadAmount * 4;

      nextField[i] = Math.min(255, nextField[i] + retainAmount);

      if (spreadAmount > 0) {
        for (const dir of DIRS) {
          const nx = world.wrap(cx + dir.dx);
          const ny = world.wrap(cy + dir.dy);
          const ni = ny * W + nx;
          nextField[ni] = Math.min(255, nextField[ni] + spreadAmount);
          // Expand new bounding box for spread
          if (nx < nextMinX) nextMinX = nx;
          if (nx > nextMaxX) nextMaxX = nx;
          if (ny < nextMinY) nextMinY = ny;
          if (ny > nextMaxY) nextMaxY = ny;
        }
      }
    }
  }

  // Handle torus wrap expansion for bounding box
  if (nextMinX < 0) nextMinX = 0;
  if (nextMaxX >= W) nextMaxX = W - 1;
  if (nextMinY < 0) nextMinY = 0;
  if (nextMaxY >= W) nextMaxY = W - 1;

  if (activeCells === 0) {
    nextMinX = W; nextMinY = W; nextMaxX = -1; nextMaxY = -1;
  } else {
    // Add margin for next frame's spread
    nextMinX = Math.max(0, nextMinX - 1);
    nextMaxX = Math.min(W - 1, nextMaxX + 1);
    nextMinY = Math.max(0, nextMinY - 1);
    nextMaxY = Math.min(W - 1, nextMaxY + 1);
  }

  activeMinX = nextMinX;
  activeMaxX = nextMaxX;
  activeMinY = nextMinY;
  activeMaxY = nextMaxY;
  isFullScan = (activeCells > 0 && (activeMaxX - activeMinX >= W - 2 || activeMaxY - activeMinY >= W - 2));

  // Swap fields efficiently
  if (isFullScan) {
    field.set(nextField);
  } else if (activeCells > 0) {
    // Only copy the active bounding box
    for (let cy = activeMinY; cy <= activeMaxY; cy++) {
      const row = cy * W;
      for (let cx = activeMinX; cx <= activeMaxX; cx++) {
        field[row + cx] = nextField[row + cx];
      }
    }
  }
}
