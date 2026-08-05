export type GamblingDefId = 'roulette' | 'slots';

export interface GamblingMachineDef {
  id: GamblingDefId;
  label: string;
  prompt: string;
  minBet: number;
  maxBet: number;
  presets: readonly number[];
  winChance: number;
  payoutMultiplier: number;
  houseEdge: number;
}

export const GAMBLING_MACHINES: Record<GamblingDefId, GamblingMachineDef> = {
  roulette: {
    id: 'roulette',
    label: 'Рулетка ЖЭК-37',
    prompt: 'рулетка',
    minBet: 10,
    maxBet: 250,
    presets: [10, 25, 50, 100],
    winChance: 18 / 37,
    payoutMultiplier: 2,
    houseEdge: 1 / 37,
  },
  slots: {
    id: 'slots',
    label: 'Однорукий бухгалтер',
    prompt: 'слоты',
    minBet: 5,
    maxBet: 150,
    presets: [5, 10, 25, 50],
    winChance: 0.28,
    payoutMultiplier: 3,
    houseEdge: 0.16,
  },
};

export function getGamblingMachineDef(id: string): GamblingMachineDef | undefined {
  return GAMBLING_MACHINES[id as GamblingDefId];
}
