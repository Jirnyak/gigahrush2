import { FloorLevel } from '../core/types';

export interface RouteObjectiveFallbackDef {
  id: string;
  z?: number;
  storyFloor?: FloorLevel;
  title: string;
  target: string;
  lift: string;
  risk: string;
  color: string;
}

export const ROUTE_OBJECTIVE_FALLBACKS: readonly RouteObjectiveFallbackDef[] = [
  {
    id: 'living_tutorial_intro',
    z: 0,
    storyFloor: FloorLevel.LIVING,
    title: 'ЦЕЛЬ: Ольга → сержант Баринов → Яков',
    target: 'Жилая зона: вводная, оружейная, лаборатория',
    lift: 'Лифт: после цели, не вслепую',
    risk: 'Маршрут: без активной цели',
    color: '#8cf',
  },
];
