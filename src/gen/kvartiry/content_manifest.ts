/* ── Kvartiry content manifest ──────────────────────────────────
 * Social content modules are grouped here so index.ts stays stable.
 */

import { type Entity } from '../../core/types';
import { World } from '../../core/world';
import { syncNextEntityId, withPoiGenerationMetadata } from '../content_manifest_utils';
import { spawnListovoy } from './listovoy';
import { spawnGorlanov } from './gorlanov';
import { spawnTyotyaKlava } from './tyotya_klava';
import { spawnSeryGopnik } from './sery_gopnik';
import { spawnPahomBratishka } from './pakhom';
import { generateRedCorner } from './red_corner';
import { generateRationQueue } from './ration_queue';
import { generateOcherednik } from './ocherednik';
import { generateWaterRiot } from './water_riot';
import { generatePrintRoom } from './print_room';
import { generateBarricade } from './barricade';
import { generateCommunalKitchenFeud } from './communal_kitchen_feud';
import { generateLostChildCorner } from './lost_child_corner';
import { generateMedicineSwap } from './medicine_swap';
import { generateAmmoSmelter } from './ammo_smelter';
import { generateCultSupplyKitchen } from './cult_supply_kitchen';
import { generateChernobozhiySvod } from './chernobozhiy_svod';
import { generateFalseNeighborRoom } from './false_neighbor';
import { generatePustoySosedRoom } from './pustoy_sosed';
import { generateKv08RouteAssembly } from './kv08_route_assembly';
import {
  kvSocialPressurePoiCount,
  publishKvSocialPressureUprising,
  resetKvSocialPressurePois,
  tagKvSocialPressurePoisSince,
  tryKvSocialPressureUprising,
  type KvSocialPressurePoiId,
  type KvSocialPressureUprisingResult,
} from './social_pressure';

export function resetKvartiryContentState(): void {
  resetKvSocialPressurePois();
}

export function tryKvartiryContentUprising(
  world: World,
  entities: Entity[],
  elapsedSeconds: number,
): KvSocialPressureUprisingResult | null {
  return tryKvSocialPressureUprising(world, entities, elapsedSeconds);
}

export function publishKvartiryContentUprising(
  state: Parameters<typeof publishKvSocialPressureUprising>[0],
  result: KvSocialPressureUprisingResult,
): void {
  publishKvSocialPressureUprising(state, result);
}

export function spawnKvartiryNamedNpcs(
  world: World,
  entities: Entity[],
  nextId: number,
): number {
  spawnListovoy(world, entities, { v: nextId });
  nextId = syncNextEntityId(entities, nextId);

  spawnGorlanov(world, entities, { v: nextId });
  nextId = syncNextEntityId(entities, nextId);

  spawnTyotyaKlava(world, entities, { v: nextId });
  nextId = syncNextEntityId(entities, nextId);

  spawnSeryGopnik(world, entities, { v: nextId });
  nextId = syncNextEntityId(entities, nextId);

  spawnPahomBratishka(world, entities, { v: nextId });
  return syncNextEntityId(entities, nextId);
}

export function runKvartiryPermanentContent(
  world: World,
  entities: Entity[],
  nextId: number,
  spawnX: number,
  spawnY: number,
): number {
  const socialNext = { v: nextId };
  let socialRoomId = world.rooms.length;
  const redCorner = generateRedCorner(world, socialRoomId, entities, socialNext, spawnX, spawnY);
  socialRoomId = Math.max(socialRoomId + 1, redCorner.nextRoomId);
  socialRoomId = runTaggedPressurePoi('ration_queue', () => withPoiGenerationMetadata(world, entities, {
    id: 'kvartiry_ration_queue',
    floor: 'kvartiry',
    debugLabel: 'Квартиры: пункт выдачи талонов',
    decisionHooks: [
      { kind: 'quest', id: 'kv_ration_water', label: 'принести воду очереди' },
      { kind: 'quest', id: 'kv_coupon_audit_registry', label: 'добыть выписку пайкового реестра' },
      { kind: 'steal', id: 'kv_ration_ledger_box', label: 'вскрыть кассу талонов' },
    ],
  }, () => generateRationQueue(world, socialRoomId, entities, socialNext, spawnX, spawnY)));
  socialRoomId = generateOcherednik(world, socialRoomId, entities, socialNext, spawnX, spawnY);
  socialRoomId = runTaggedPressurePoi('water_riot', () => generateWaterRiot(world, socialRoomId, entities, socialNext, spawnX, spawnY));
  socialRoomId = runTaggedPressurePoi('print_room', () => generatePrintRoom(world, socialRoomId, entities, socialNext, spawnX, spawnY));
  socialRoomId = runTaggedPressurePoi('barricade', () => generateBarricade(world, socialRoomId, entities, socialNext, spawnX, spawnY));
  socialRoomId = runTaggedPressurePoi('communal_kitchen', () => generateCommunalKitchenFeud(world, socialRoomId, entities, socialNext, spawnX, spawnY));
  socialRoomId = generateLostChildCorner(world, socialRoomId, entities, socialNext, spawnX, spawnY);
  socialRoomId = generateMedicineSwap(world, socialRoomId, entities, socialNext, spawnX, spawnY);
  socialRoomId = generateAmmoSmelter(world, socialRoomId, entities, socialNext, spawnX, spawnY);
  socialRoomId = generateCultSupplyKitchen(world, socialRoomId, entities, socialNext, spawnX, spawnY);
  socialRoomId = generateChernobozhiySvod(world, socialRoomId, entities, socialNext, spawnX, spawnY);
  socialRoomId = generateKv08RouteAssembly(world, socialRoomId, entities, socialNext, spawnX, spawnY);
  generateFalseNeighborRoom(world, socialRoomId, entities, socialNext, spawnX, spawnY);
  socialRoomId = Math.max(socialRoomId + 1, world.rooms.length);
  generatePustoySosedRoom(world, socialRoomId, entities, socialNext, spawnX, spawnY);
  return socialNext.v;
}

function runTaggedPressurePoi(id: KvSocialPressurePoiId, run: () => number): number {
  const before = kvSocialPressurePoiCount();
  const nextRoomId = run();
  tagKvSocialPressurePoisSince(before, id);
  return nextRoomId;
}
