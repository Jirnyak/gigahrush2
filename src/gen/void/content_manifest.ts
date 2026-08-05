/* ── Void content manifest ───────────────────────────────────── */

import { type Entity } from '../../core/types';
import { World } from '../../core/world';
import { syncNextEntityId } from '../content_manifest_utils';
import { generateBorrowedLightRule } from './borrowed_light_rule';
import { generateEkrannik } from './ekrannik';
import { generateMaronarySignalshchik } from './maronary_signalshchik';
import { generatePerestanovshchik } from './perestanovshchik';
import { generateVoidPlotChain } from './plot_chain';
import { generatePristavPustoty } from './pristav_pustoty';
import { generateProtocolChamber } from './protocol_chamber';
import { generateSeryySmotritel } from './seryy_smotritel';
import { generateTraceSealProtocol } from './trace_seal_protocol';

export function runVoidContent(
  world: World,
  entities: Entity[],
  nextId: number,
  spawnX: number,
  spawnY: number,
): number {
  const idRef = { v: nextId };
  generateVoidPlotChain(world, entities, idRef, spawnX, spawnY);
  generateProtocolChamber(world, entities, idRef, spawnX, spawnY);
  generateBorrowedLightRule(world, entities, idRef, spawnX, spawnY);
  generateTraceSealProtocol(world, entities, idRef, spawnX, spawnY);
  generateMaronarySignalshchik(world, entities, idRef, spawnX, spawnY);
  generatePristavPustoty(world, entities, idRef, spawnX, spawnY);
  generatePerestanovshchik(world, entities, idRef, spawnX, spawnY);
  generateSeryySmotritel(world, entities, idRef, spawnX, spawnY);
  generateEkrannik(world, entities, idRef, spawnX, spawnY);
  return syncNextEntityId(entities, nextId);
}
