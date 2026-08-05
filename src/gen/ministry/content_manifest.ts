/* ── Ministry content manifest ──────────────────────────────────
 * Administrative POIs and floor NPC packs are isolated here.
 */

import { type Entity } from '../../core/types';
import { World } from '../../core/world';
import { syncNextEntityId, withPoiGenerationMetadata } from '../content_manifest_utils';
import { spawnMinistryNpcs } from './npcs';
import { generateSecretSmokingRoom } from './secret_smoking';
import { generatePermitOffice } from './permit_office';
import { generateStampRoom } from './stamp_room';
import { generateWeaponPermitBureau } from './weapon_permit_bureau';
import { generateInterrogationCloset } from './interrogation';
import { generateQueueHall } from './queue_hall';
import { generateInspectionArchive } from './inspection_archive';
import { generateLiquidatorArchive } from './liquidator_archive';
import { generateRaionsovetArchive } from './raionsovet_archive';
import { generateRefusalClauseOffice } from './refusal_clause';
import { generateDocumentGate } from './document_gate';
import { generateLampoglazLine } from './lampoglaz_line';
import { generateKantselyarskiyIdolLine } from './kantselyarskiy_idol_line';
import { generateMukhozhukAudit } from './mukhozhuk_audit';
import { generateNiiContrabandAudit } from './nii_contraband_audit';
import { generateKartotechnikArchive } from './kartotechnik';
import { generateMatkaDokumentovRoom } from './matka_dokumentov';
import { runMinistryDesignFloorContent } from '../design_floors/ministry';

export function runMinistryContent(
  world: World,
  entities: Entity[],
  nextRoomId: number,
  nextId: number,
  spawnX: number,
  spawnY: number,
): { nextRoomId: number; nextId: number } {
  const smoking = generateSecretSmokingRoom(world, nextRoomId, entities, { v: nextId }, spawnX, spawnY);
  nextRoomId = smoking.nextRoomId;
  nextId = syncNextEntityId(entities, nextId);

  const idRef = { v: nextId };
  const permit = withPoiGenerationMetadata(world, entities, {
    id: 'ministry_permit_office',
    floor: 'ministry',
    debugLabel: 'Министерство: Пропускное бюро',
    decisionHooks: [
      { kind: 'quest', id: 'permit_ballot_blanks', label: 'получить пропуск через бюллетени' },
      { kind: 'quest', id: 'permit_wait_queue', label: 'выстоять законную очередь' },
      { kind: 'quest', id: 'permit_pay_accelerator', label: 'заплатить ускорительный сбор' },
      { kind: 'quest', id: 'permit_forge_slip', label: 'подделать корешок' },
      { kind: 'quest', id: 'permit_threaten_window', label: 'надавить на окно приказом' },
      { kind: 'steal', id: 'permit_issue_tray', label: 'украсть готовые корешки' },
    ],
  }, () => generatePermitOffice(world, nextRoomId, entities, idRef, spawnX, spawnY));
  nextRoomId = permit.nextRoomId;

  for (const generate of [
    generateStampRoom,
    generateWeaponPermitBureau,
    generateInterrogationCloset,
    generateQueueHall,
    generateInspectionArchive,
    generateLiquidatorArchive,
    generateRaionsovetArchive,
    generateRefusalClauseOffice,
    generateLampoglazLine,
    generateKantselyarskiyIdolLine,
    generateMukhozhukAudit,
    generateDocumentGate,
  ]) {
    const r = generate(world, nextRoomId, entities, idRef, spawnX, spawnY);
    nextRoomId = r.nextRoomId;
  }

  const nii = withPoiGenerationMetadata(world, entities, {
    id: 'ministry_nii_contraband_audit',
    floor: 'ministry',
    debugLabel: 'Министерство: ревизионная НИИ',
    decisionHooks: [
      { kind: 'quest', id: 'nii_audit_find_room', label: 'найти ревизионную НИИ' },
      { kind: 'quest', id: 'nii_audit_expose_chain', label: 'передать ведомость ликвидаторам' },
      { kind: 'quest', id: 'nii_audit_sell_sample', label: 'продать серебристую пробу' },
      { kind: 'quest', id: 'nii_audit_conceal_forgery', label: 'закрыть утечку подложным актом' },
      { kind: 'steal', id: 'nii_sample_cage', label: 'вскрыть клетку проб НИИ' },
    ],
  }, () => generateNiiContrabandAudit(world, nextRoomId, entities, idRef, spawnX, spawnY));
  nextRoomId = nii.nextRoomId;

  for (const generate of [
    generateKartotechnikArchive,
    generateMatkaDokumentovRoom,
  ]) {
    const r = generate(world, nextRoomId, entities, idRef, spawnX, spawnY);
    nextRoomId = r.nextRoomId;
  }

  const designFloor = runMinistryDesignFloorContent(world, entities, nextRoomId, idRef, spawnX, spawnY);
  nextRoomId = designFloor.nextRoomId;

  nextId = idRef.v;
  world.bakeLights();

  spawnMinistryNpcs(world, entities, { v: nextId });
  nextId = syncNextEntityId(entities, nextId);

  return { nextRoomId, nextId };
}
