import { GameState, LiftDirection, msg } from '../core/types';
import { NpcInteractionContext } from './npc_interaction_options';

export interface ArenaOverlaySnapshot {
  open: boolean;
  selection: number; // 0 for bet, 1 for fight
}

export const arenaRuntime = {
  open: false,
  selection: 0,
  npcName: '',
};

export function isArenaOverlayOpen(): boolean {
  return arenaRuntime.open;
}

export function openArena(ctx: NpcInteractionContext): void {
  arenaRuntime.open = true;
  arenaRuntime.npcName = ctx.npc.name ?? '';
  arenaRuntime.selection = arenaRuntime.npcName === 'Марко Лоло' ? 1 : 0;
  ctx.state.showNpcMenu = false;
  ctx.state.paused = true;
}

export function closeArena(): void {
  arenaRuntime.open = false;
}

export function moveArenaSelection(delta: number): void {
  arenaRuntime.selection += delta;
  if (arenaRuntime.selection < 0) arenaRuntime.selection = 0;
  if (arenaRuntime.selection > 1) arenaRuntime.selection = 1;
}

export function activateArenaSelection(ctx: { state: GameState; player?: { x: number; y: number }; switchFloor?: (direction: LiftDirection, message?: string, color?: string, allowElevatorAnomaly?: boolean, targetZ?: number) => void }): void {
  if (arenaRuntime.npcName === 'Марко Лоло' || arenaRuntime.selection === 1) {
    if (ctx.player) {
      ctx.player.x = 100;
      ctx.player.y = 63;
      ctx.state.msgs.push(msg('Марко Лоло отправляет вас на поле локальной арены ликвидаторов.', ctx.state.time, '#f66'));
    }
  } else {
    ctx.state.msgs.push(msg('Мастер Арены принял вашу ставку на исход поединка.', ctx.state.time, '#4cf'));
  }
  closeArena();
}

export function getArenaOverlaySnapshot(): ArenaOverlaySnapshot {
  return {
    open: arenaRuntime.open,
    selection: arenaRuntime.selection,
  };
}
