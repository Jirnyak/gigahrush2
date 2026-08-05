import type { AlifeMigrationReason } from './alife_migration';

export type DemosSocialVisitReason =
  | 'social_visit'
  | 'family_visit'
  | 'debt_visit'
  | 'conflict_visit'
  | 'quest_meeting'
  | 'shelter_rejoin'
  | 'caravan_social_join';

export interface DemosSocialVisitIntentDef {
  id: DemosSocialVisitReason;
  migrationReason: AlifeMigrationReason;
  intentId: string;
  minTravelSeconds: number;
  maxTravelSeconds: number;
  allowDuringSamosbor: boolean;
  tags: readonly string[];
}

export const DEMOS_SOCIAL_VISIT_INTENTS: readonly DemosSocialVisitIntentDef[] = [
  {
    id: 'social_visit',
    migrationReason: 'routine',
    intentId: 'demos_social_visit',
    minTravelSeconds: 90,
    maxTravelSeconds: 360,
    allowDuringSamosbor: false,
    tags: ['demos_social', 'social_visit'],
  },
  {
    id: 'family_visit',
    migrationReason: 'rest',
    intentId: 'demos_family_visit',
    minTravelSeconds: 75,
    maxTravelSeconds: 300,
    allowDuringSamosbor: false,
    tags: ['demos_social', 'family_visit', 'family'],
  },
  {
    id: 'debt_visit',
    migrationReason: 'market',
    intentId: 'demos_debt_visit',
    minTravelSeconds: 120,
    maxTravelSeconds: 420,
    allowDuringSamosbor: false,
    tags: ['demos_social', 'debt_visit', 'debt'],
  },
  {
    id: 'conflict_visit',
    migrationReason: 'faction',
    intentId: 'demos_conflict_visit',
    minTravelSeconds: 120,
    maxTravelSeconds: 480,
    allowDuringSamosbor: false,
    tags: ['demos_social', 'conflict_visit', 'enemy'],
  },
  {
    id: 'quest_meeting',
    migrationReason: 'quest',
    intentId: 'demos_quest_meeting',
    minTravelSeconds: 60,
    maxTravelSeconds: 240,
    allowDuringSamosbor: false,
    tags: ['demos_social', 'quest_meeting', 'quest'],
  },
  {
    id: 'shelter_rejoin',
    migrationReason: 'refugee',
    intentId: 'demos_shelter_rejoin',
    minTravelSeconds: 45,
    maxTravelSeconds: 180,
    allowDuringSamosbor: true,
    tags: ['demos_social', 'shelter_rejoin', 'shelter'],
  },
  {
    id: 'caravan_social_join',
    migrationReason: 'caravan',
    intentId: 'demos_caravan_social_join',
    minTravelSeconds: 180,
    maxTravelSeconds: 600,
    allowDuringSamosbor: false,
    tags: ['demos_social', 'caravan_social_join', 'caravan'],
  },
] as const;

export function demosSocialVisitIntent(reason: DemosSocialVisitReason): DemosSocialVisitIntentDef {
  return DEMOS_SOCIAL_VISIT_INTENTS.find(intent => intent.id === reason) ?? DEMOS_SOCIAL_VISIT_INTENTS[0];
}
