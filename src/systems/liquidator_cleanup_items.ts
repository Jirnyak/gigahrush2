import type { CellHazardCleanReason } from './cell_hazards';

export const SLIME_SCRAPER_ID = 'slime_scraper';

export interface CleanupToolProfile {
  surfaceRadius: number;
  hazardRadius: number;
  wear: number;
  cooldown: number;
  hazardReason: CellHazardCleanReason;
  relationEvery: number;
}

export function cleanupToolProfile(toolId: string): CleanupToolProfile | null {
  if (toolId === 'cleaning_kit') {
    return {
      surfaceRadius: 1.0,
      hazardRadius: 1.15,
      wear: 1,
      cooldown: 0.08,
      hazardReason: 'solvent',
      relationEvery: 5,
    };
  }

  if (toolId === SLIME_SCRAPER_ID) {
    return {
      surfaceRadius: 0.55,
      hazardRadius: 0.65,
      wear: 1,
      cooldown: 0.16,
      hazardReason: 'tool',
      relationEvery: 0,
    };
  }

  return null;
}
