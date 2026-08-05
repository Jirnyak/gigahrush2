/* ── Pneumomail interaction: capsules become rumors/contracts ─── */

import {
  Feature,
  FloorLevel,
  type Entity,
  type GameState,
  type Room,
  msg,
} from '../core/types';
import { type World } from '../core/world';
import { ITEMS } from '../data/items';
import {
  PNEUMOMAIL_CAPSULES,
  PNEUMOMAIL_HISTORY_CAPACITY,
  PNEUMOMAIL_CAPSULE_ITEM_ID,
  PNEUMOMAIL_CONTRACT_ID,
  PNEUMOMAIL_REQUIRED_KINDS,
  PNEUMOMAIL_ROOM_PREFIX,
  type PneumomailCapsuleDef,
  type PneumomailCapsuleKind,
} from '../data/pneumomail';
import { addItem, hasItem, removeItem } from './inventory';
import { spawnContractById } from './contracts';
import { publishEvent } from './events';

type PneumomailRole = 'intake' | 'intercept' | 'jam' | 'report';
type PneumomailEventType = 'received' | 'sent' | 'jammed' | 'intercepted' | 'reported' | 'contraband';

interface PneumomailHistoryEntry {
  id: string;
  kind: PneumomailCapsuleKind;
  time: number;
}

interface PneumomailTarget {
  room: Room;
  role: PneumomailRole;
  x: number;
  y: number;
}

interface PneumomailRuntime {
  nextReceiveAt: number;
  nextInterceptAt: number;
  jammedUntil: number;
  uses: number;
  history: PneumomailHistoryEntry[];
}

const RECEIVE_COOLDOWN_S = 180;
const INTERCEPT_COOLDOWN_S = 300;
const JAM_DURATION_S = 600;
const runtimeByState = new WeakMap<GameState, PneumomailRuntime>();
const EVIDENCE_ITEMS = ['denunciation', 'sealed_complaint', 'nii_contraband_manifest', 'record_exposure_notice'] as const;

let forcedCapsuleId = '';

function runtimeFor(state: GameState): PneumomailRuntime {
  let runtime = runtimeByState.get(state);
  if (!runtime) {
    runtime = { nextReceiveAt: 0, nextInterceptAt: 0, jammedUntil: 0, uses: 0, history: [] };
    runtimeByState.set(state, runtime);
  }
  return runtime;
}

function itemName(defId: string): string {
  return ITEMS[defId]?.name ?? defId;
}

function isPneumomailRoom(room: Room | undefined): room is Room {
  return room !== undefined && room.name.includes(PNEUMOMAIL_ROOM_PREFIX);
}

function roleForFeature(feature: Feature): PneumomailRole | undefined {
  switch (feature) {
    case Feature.APPARATUS: return 'intake';
    case Feature.MACHINE: return 'intercept';
    case Feature.DESK: return 'jam';
    case Feature.SCREEN: return 'report';
    default: return undefined;
  }
}

function targetAt(world: World, lookX: number, lookY: number): PneumomailTarget | null {
  const x = world.wrap(Math.floor(lookX));
  const y = world.wrap(Math.floor(lookY));
  const ci = world.idx(x, y);
  const role = roleForFeature(world.features[ci] as Feature);
  if (!role) return null;
  const roomId = world.roomMap[ci];
  if (roomId < 0) return null;
  const room = world.rooms[roomId];
  if (!isPneumomailRoom(room)) return null;
  return { room, role, x, y };
}

function zoneAt(world: World, player: Entity): number | undefined {
  const zid = world.zoneMap[world.idx(Math.floor(player.x), Math.floor(player.y))];
  return zid >= 0 ? zid : undefined;
}

function publishPneumomail(
  world: World,
  player: Entity,
  state: GameState,
  target: PneumomailTarget | undefined,
  eventType: PneumomailEventType,
  severity: 1 | 2 | 3 | 4,
  itemId?: string,
  rumorId?: string,
  data: Record<string, unknown> = {},
): void {
  const type = eventType === 'sent' || eventType === 'reported'
    ? 'item_deposited'
    : eventType === 'jammed'
      ? 'player_use_item'
      : eventType === 'intercepted'
        ? 'item_stolen'
        : 'rumor_observed';
  const actionTag = eventType === 'intercepted'
    ? 'pneumomail_intercept'
    : eventType === 'jammed'
      ? 'pneumomail_jam'
      : eventType === 'reported'
        ? 'pneumomail_report'
        : eventType === 'contraband'
          ? 'pneumomail_contraband'
          : `pneumomail_${eventType}`;
  publishEvent(state, {
    type,
    zoneId: zoneAt(world, player),
    roomId: target?.room.id,
    x: player.x,
    y: player.y,
    actorId: player.id,
    actorName: player.name ?? 'Вы',
    actorFaction: player.faction,
    itemId,
    itemName: itemId ? itemName(itemId) : undefined,
    itemCount: itemId ? 1 : undefined,
    itemValue: itemId ? ITEMS[itemId]?.value ?? 0 : undefined,
    severity,
    privacy: eventType === 'intercepted' ? 'witnessed' : 'local',
    tags: ['pneumomail', actionTag, `capsule_${eventType}`, itemId ? 'item' : 'rumor'],
    data: {
      system: 'pneumomail',
      capsuleEvent: `capsule_${eventType}`,
      roomName: target?.room.name,
      rumorIds: rumorId ? [rumorId] : undefined,
      ...data,
    },
  });
}

function findEvidenceItem(player: Entity): string | undefined {
  for (const defId of EVIDENCE_ITEMS) if (hasItem(player, defId)) return defId;
  return undefined;
}

function grantCapsuleItems(player: Entity, capsule: PneumomailCapsuleDef): string[] {
  const granted: string[] = [];
  for (const item of capsule.items ?? []) {
    if (addItem(player, item.defId, item.count)) granted.push(`${itemName(item.defId)} x${item.count}`);
  }
  return granted;
}

function contractAlreadyIssued(state: GameState, capsule: PneumomailCapsuleDef): boolean {
  if (capsule.kind !== 'contract') return false;
  const contractId = capsule.contractId ?? PNEUMOMAIL_CONTRACT_ID;
  return state.quests.some(q => q.contractId === contractId);
}

function rememberCapsule(runtime: PneumomailRuntime, capsule: PneumomailCapsuleDef, time: number): void {
  runtime.history.push({ id: capsule.id, kind: capsule.kind, time });
  if (runtime.history.length > PNEUMOMAIL_HISTORY_CAPACITY) {
    runtime.history.splice(0, runtime.history.length - PNEUMOMAIL_HISTORY_CAPACITY);
  }
}

function weightedCapsule(capsules: readonly PneumomailCapsuleDef[], fallbackIndex: number): PneumomailCapsuleDef {
  let total = 0;
  for (const capsule of capsules) total += Math.max(0, capsule.weight);
  if (total <= 0) return capsules[Math.max(0, fallbackIndex) % capsules.length];

  let roll = Math.random() * total;
  for (const capsule of capsules) {
    roll -= Math.max(0, capsule.weight);
    if (roll <= 0) return capsule;
  }
  return capsules[Math.max(0, fallbackIndex) % capsules.length];
}

function missingRequiredKind(runtime: PneumomailRuntime, state: GameState): PneumomailCapsuleKind | undefined {
  const seen = new Set(runtime.history.map(entry => entry.kind));
  for (const kind of PNEUMOMAIL_REQUIRED_KINDS) {
    if (seen.has(kind)) continue;
    if (kind === 'contract' && state.quests.some(q => q.contractId === PNEUMOMAIL_CONTRACT_ID)) continue;
    return kind;
  }
  return undefined;
}

function pickCapsule(runtime: PneumomailRuntime, state: GameState): PneumomailCapsuleDef {
  if (forcedCapsuleId) {
    const forced = PNEUMOMAIL_CAPSULES.find(c => c.id === forcedCapsuleId);
    forcedCapsuleId = '';
    if (forced && !contractAlreadyIssued(state, forced)) return forced;
  }

  const available = PNEUMOMAIL_CAPSULES.filter(c => !contractAlreadyIssued(state, c));
  const requiredKind = missingRequiredKind(runtime, state);
  if (requiredKind) {
    const required = available.filter(c => c.kind === requiredKind);
    if (required.length > 0) return weightedCapsule(required, runtime.uses);
  }
  return weightedCapsule(available.length > 0 ? available : PNEUMOMAIL_CAPSULES, runtime.uses);
}

function receiveCapsule(
  world: World,
  player: Entity,
  state: GameState,
  target: PneumomailTarget | undefined,
  debug = false,
): boolean {
  const runtime = runtimeFor(state);
  if (!debug && state.time < runtime.jammedUntil) {
    state.msgs.push(msg('Пневмотруба глухо уперлась в зажим. Письма копятся за стеной.', state.time, '#888'));
    publishPneumomail(world, player, state, target, 'jammed', 2, undefined, undefined, { blocked: true });
    return true;
  }
  if (!debug && state.time < runtime.nextReceiveAt) {
    const left = Math.max(1, Math.ceil(runtime.nextReceiveAt - state.time));
    state.msgs.push(msg(`Пневмопочта набирает давление: ${left}с.`, state.time, '#888'));
    return true;
  }

  const capsule = pickCapsule(runtime, state);
  runtime.uses++;
  rememberCapsule(runtime, capsule, state.time);
  runtime.nextReceiveAt = state.time + RECEIVE_COOLDOWN_S + (capsule.kind === 'contract' ? 120 : 0);

  if (capsule.kind === 'contract') {
    const created = spawnContractById(
      state,
      capsule.contractId ?? PNEUMOMAIL_CONTRACT_ID,
      ['pneumomail', 'capsule_contract'],
      capsule.rumorId ? [capsule.rumorId] : undefined,
    );
    state.msgs.push(msg(capsule.text, state.time, created ? '#6cf' : '#888'));
    publishPneumomail(world, player, state, target, 'received', capsule.severity, undefined, capsule.rumorId, {
      capsuleId: capsule.id,
      capsuleKind: capsule.kind,
      contractCreated: created,
      historyCount: runtime.history.length,
    });
    return true;
  }

  const granted = grantCapsuleItems(player, capsule);
  const suffix = granted.length > 0 ? ` Получено: ${granted.join(', ')}.` : '';
  state.msgs.push(msg(`${capsule.text}${suffix}`, state.time, capsule.kind === 'false_lead' ? '#fa4' : '#8cf'));
  publishPneumomail(
    world,
    player,
    state,
    target,
    capsule.kind === 'contraband' ? 'contraband' : 'received',
    capsule.severity,
    capsule.items?.[0]?.defId,
    capsule.rumorId,
    {
      capsuleId: capsule.id,
      capsuleKind: capsule.kind,
      falseLead: capsule.kind === 'false_lead',
      grantedItems: granted,
      historyCount: runtime.history.length,
    },
  );
  return true;
}

function sendEvidence(world: World, player: Entity, state: GameState, target: PneumomailTarget): boolean {
  const evidence = findEvidenceItem(player);
  if (!evidence) return false;
  if (!removeItem(player, evidence, 1)) return false;
  player.money = (player.money ?? 0) + 25;
  state.msgs.push(msg(`Пневмопочта приняла улику: ${itemName(evidence)}. Ответный жетон: +25₽.`, state.time, '#6cf'));
  publishPneumomail(world, player, state, target, 'sent', 3, evidence, 'pneumomail_contraband_note', {
    action: 'send_evidence',
    moneyReward: 25,
  });
  return true;
}

function interceptMail(world: World, player: Entity, state: GameState, target: PneumomailTarget): boolean {
  const runtime = runtimeFor(state);
  if (state.time < runtime.jammedUntil) {
    state.msgs.push(msg('Люк перехвата закушен вашей же пробкой.', state.time, '#888'));
    return true;
  }
  if (state.time < runtime.nextInterceptAt) {
    state.msgs.push(msg('Люк еще звенит после прошлого вскрытия.', state.time, '#888'));
    return true;
  }
  if (!hasItem(player, 'key') && !hasItem(player, 'crowbar') && !hasItem(player, 'wrench')) {
    state.msgs.push(msg('Люк перехвата просит ключ, лом или гаечный ключ.', state.time, '#fa4'));
    return true;
  }
  if (!addItem(player, PNEUMOMAIL_CAPSULE_ITEM_ID, 1)) {
    state.msgs.push(msg('Капсула не помещается в инвентарь.', state.time, '#f84'));
    return true;
  }
  runtime.nextInterceptAt = state.time + INTERCEPT_COOLDOWN_S;
  state.msgs.push(msg('Перехвачена опечатанная пневмокапсула. Ее можно продать или сдать как тамперинг.', state.time, '#fa4'));
  publishPneumomail(world, player, state, target, 'intercepted', 4, PNEUMOMAIL_CAPSULE_ITEM_ID, 'pneumomail_contraband_note', {
    action: 'intercept_mail',
    theft: true,
  });
  return true;
}

function jamTube(world: World, player: Entity, state: GameState, target: PneumomailTarget): boolean {
  const runtime = runtimeFor(state);
  if (state.time < runtime.jammedUntil) {
    state.msgs.push(msg('Труба уже забита. Новая капсула сейчас только застрянет рядом с клином.', state.time, '#888'));
    return true;
  }
  const jamItem = hasItem(player, 'wire_coil') ? 'wire_coil' : hasItem(player, 'duct_tape') ? 'duct_tape' : '';
  if (!jamItem) {
    state.msgs.push(msg('Для клина нужна проволока или изолента.', state.time, '#fa4'));
    return true;
  }
  removeItem(player, jamItem, 1);
  runtime.jammedUntil = state.time + JAM_DURATION_S;
  state.msgs.push(msg('Труба зажата. Десять минут капсулы будут искать другой путь.', state.time, '#f84'));
  publishPneumomail(world, player, state, target, 'jammed', 4, jamItem, 'pneumomail_warning_samosbor', {
    action: 'jam_tube',
    jammedUntil: runtime.jammedUntil,
  });
  return true;
}

function reportTampering(world: World, player: Entity, state: GameState, target: PneumomailTarget): boolean {
  if (!hasItem(player, PNEUMOMAIL_CAPSULE_ITEM_ID)) {
    state.msgs.push(msg('Экран мигает: НЕТ КАПСУЛЫ ДЛЯ АКТА.', state.time, '#888'));
    return true;
  }
  removeItem(player, PNEUMOMAIL_CAPSULE_ITEM_ID, 1);
  player.money = (player.money ?? 0) + 35;
  addItem(player, 'water_coupon', 1);
  state.msgs.push(msg('Капсула сдана в контроль. +35₽, талон на воду. Теперь это официальный шум.', state.time, '#6cf'));
  publishPneumomail(world, player, state, target, 'reported', 4, PNEUMOMAIL_CAPSULE_ITEM_ID, 'pneumomail_contraband_note', {
    action: 'report_tampering',
    moneyReward: 35,
  });
  return true;
}

export function tryUsePneumomailTube(
  world: World,
  player: Entity,
  state: GameState,
  lookX: number,
  lookY: number,
): boolean {
  const target = targetAt(world, lookX, lookY);
  if (!target) return false;

  if (state.currentFloor !== FloorLevel.MAINTENANCE) {
    state.msgs.push(msg('Пневмопочта здесь числится, но не дышит.', state.time, '#888'));
    return true;
  }

  switch (target.role) {
    case 'intake':
      if (sendEvidence(world, player, state, target)) return true;
      return receiveCapsule(world, player, state, target);
    case 'intercept':
      return interceptMail(world, player, state, target);
    case 'jam':
      return jamTube(world, player, state, target);
    case 'report':
      return reportTampering(world, player, state, target);
  }
  return true;
}

export function debugForcePneumomailCapsule(world: World, player: Entity, state: GameState): string[] {
  const runtime = runtimeFor(state);
  const capsule = PNEUMOMAIL_CAPSULES[runtime.uses % PNEUMOMAIL_CAPSULES.length];
  forcedCapsuleId = capsule.id;
  receiveCapsule(world, player, state, undefined, true);
  const actual = runtime.history[runtime.history.length - 1]?.id ?? capsule.id;
  return [
    `forced=${capsule.id}`,
    `actual=${actual}`,
    `history=${runtime.history.length}/${PNEUMOMAIL_HISTORY_CAPACITY}`,
    `cooldown=${Math.max(0, Math.ceil(runtime.nextReceiveAt - state.time))}s`,
  ];
}
