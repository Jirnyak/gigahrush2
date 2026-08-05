/* ── Side quest content registry ──────────────────────────────── */
/* Importing a content module triggers its registerSideQuest()     */
/* call, registering NPC packages + SIDE_QUESTS in data/plot.ts.   */
/*                                                                 */
/* To add a new side quest:                                        */
/*   1. Create content module: gen/living/my_quest.ts              */
/*   2. Import its spawn function here                             */
/*   3. Call it inside spawnSideQuestNpcs()                        */

import { type Entity } from '../../core/types';
import { World } from '../../core/world';

// ── Side quest content modules ──────────────────────────────────
// ↓ Import triggers NPC + quest registration into SIDE_QUESTS
import { spawnViktor } from './viktor';
import { spawnVeteran } from './veteran';
import { spawnBabkaZina } from './babka_zina';
import { spawnStalkerMecheny } from './stalker_mecheny';
import { spawnSovietHousingPackNpcs } from './soviet_housing_pack';
import { spawnDomkomLaundryPackNpcs } from './domkom_laundry_pack';

type SideQuestSpawner = (world: World, entities: Entity[], nextId: { v: number }) => void;

const SIDE_QUEST_SPAWNERS: readonly SideQuestSpawner[] = [
  spawnViktor,
  spawnVeteran,
  spawnBabkaZina,
  spawnStalkerMecheny,
  spawnSovietHousingPackNpcs,
  spawnDomkomLaundryPackNpcs,
];

/* ── Spawn all side quest NPCs (called from orchestrator) ─────── */
export function spawnSideQuestNpcs(
  world: World, entities: Entity[], nextId: { v: number },
): void {
  for (const spawn of SIDE_QUEST_SPAWNERS) spawn(world, entities, nextId);
}
