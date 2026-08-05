/* ── Hell content manifest ────────────────────────────────────── */

import { type Entity } from '../../core/types';
import { World } from '../../core/world';
import { syncNextEntityId } from '../content_manifest_utils';
import { generateHellPlotChain } from './plot_chain';
import { generatePsiMeatCache } from './psi_meat_cache';
import { spawnMedukaMeguku } from './madoka';
import { generateThinWallChapel } from './thin_wall_chapel';
import { spawnHellAltarArena } from './altar_arena';
import { generateHell18ChoirTax } from './choir_tax';
import { generateMyasomer } from './myasomer';

export function runHellContent(world: World, entities: Entity[], nextId: number): number {
  generateHellPlotChain(world, entities, { v: nextId });
  nextId = syncNextEntityId(entities, nextId);

  generatePsiMeatCache(world, entities, { v: nextId });
  nextId = syncNextEntityId(entities, nextId);

  spawnMedukaMeguku(world, entities, { v: nextId });
  nextId = syncNextEntityId(entities, nextId);

  generateThinWallChapel(world, entities, { v: nextId });
  nextId = syncNextEntityId(entities, nextId);

  spawnHellAltarArena(world, entities, { v: nextId });
  nextId = syncNextEntityId(entities, nextId);

  generateHell18ChoirTax(world, entities, { v: nextId });
  nextId = syncNextEntityId(entities, nextId);

  generateMyasomer(world, entities, { v: nextId });
  return syncNextEntityId(entities, nextId);
}
