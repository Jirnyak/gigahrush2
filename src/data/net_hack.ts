export type NetHackTerminalDefId = 'service_gate' | 'archive_gate';

export interface NetHackTerminalDef {
  id: NetHackTerminalDefId;
  label: string;
  prompt: string;
  baseDifficulty: number;
  randomDifficultyMax: number;
  rewardRubles: number;
  failPsiDamage: number;
  failHpDamage: number;
}

export const NET_HACK_TERMINALS: Record<NetHackTerminalDefId, NetHackTerminalDef> = {
  service_gate: {
    id: 'service_gate',
    label: 'НЕТ-шлюз ЖЭК',
    prompt: 'НЕТ-взлом',
    baseDifficulty: 13,
    randomDifficultyMax: 5,
    rewardRubles: 55,
    failPsiDamage: 8,
    failHpDamage: 4,
  },
  archive_gate: {
    id: 'archive_gate',
    label: 'Архивный НЕТ-шлюз',
    prompt: 'НЕТ-архив',
    baseDifficulty: 17,
    randomDifficultyMax: 7,
    rewardRubles: 85,
    failPsiDamage: 12,
    failHpDamage: 6,
  },
};

export function getNetHackTerminalDef(id: string): NetHackTerminalDef | undefined {
  return NET_HACK_TERMINALS[id as NetHackTerminalDefId];
}
