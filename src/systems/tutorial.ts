import { type Entity, type GameState, msg } from '../core/types';

export enum TutorialStep {
  DRINK = 0,
  TOILET = 1,
  EAT = 2,
  WORK = 3,
  SAMOSBOR = 4,
  ESCAPE = 5,
  DONE = 6,
}

export function logTutorialMsg(state: GameState, text: string, time: number): void {
  const m = msg(text, time, '#fff');
  m.hour = state.clock?.hour ?? 8;
  m.minute = state.clock?.minute ?? 0;
  state.msgs.push(m);
  if (state.msgLog) state.msgLog.push(m);
}

export function startTutorial(state: GameState, player: Entity): void {
  state.tutorialMode = true;
  state.tutorialStep = TutorialStep.DRINK;
  if (player.needs) {
    player.needs.water = 20;
    player.needs.pee = 50;
    player.needs.poo = 50;
  }
  logTutorialMsg(state, '-где я?', state.time + 15);
  logTutorialMsg(state, '-я хочу пить', state.time + 15);
}



export function completeTutorial(state: GameState): void {
  if (!state.tutorialMode) return;
  state.tutorialMode = false;
  state.tutorialStep = TutorialStep.DONE;
  state.msgs.push(msg('Обучение завершено. Вы предоставлены сами себе.', state.time, '#8fc'));
}
