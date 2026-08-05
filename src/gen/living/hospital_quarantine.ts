/* ── Больничный блок карантина (AG17) ─────────────────────────── */
/* Finite quarantine slice: triage desk, sealed ward, med archive, */
/* locked/secret medical containers, triage choices and outcomes.  */

import { stampSurfaceSplat } from '../../systems/surface_marks';
import {
  AIGoal, Cell, ContainerKind, DoorState, EntityType, Faction, Feature,
  FloorLevel, MonsterKind, Occupation, QuestType, RoomType, Tex,
  type Entity, type Room, type WorldContainer, type WorldEvent,
} from '../../core/types';
import { World } from '../../core/world';
import { type PlotNpcDef, registerSideQuest } from '../../data/plot';
import { MONSTERS } from '../../entities/monster';
import { HEAD_SLUG_HOSTED_STAGE } from '../../entities/head_slug';
import { monsterSpr, Spr } from '../../render/sprite_index';
import { publishEvent, registerWorldEventObserver } from '../../systems/events';
import { genLog } from '../log';
import { requireSpawnedPlotNpcFromPackage } from '../plot_npc_spawn';
import { registerZoneContent } from './zone_content';

const HOSPITAL_W = 19;
const HOSPITAL_H = 15;
const QUARANTINE_WALL_DX = 12;
const CONTENT_TAG = 'hospital_quarantine';
const OUTCOME_TAG = 'ag17_triage_outcome';

const QUEST_MIRA_MESSAGE = 'ag17_mira_message_olga';
const QUEST_MIRA_SANITARY = 'ag17_mira_spend_sanitary_kit';
const QUEST_LIDA_ANTIBIOTIC = 'ag17_lida_antibiotic';
const QUEST_YURA_ANTIBIOTIC = 'ag17_yura_antibiotic';
const QUEST_TARAS_OUTBREAK = 'ag17_taras_outbreak';
const QUEST_TARAS_SEAL_WARD = 'ag17_taras_seal_ward';

const TRIAGE_MEDICINE = new Set([
  'antibiotic',
  'bandage',
  'iodine',
  'morphine_ampoule',
  'pills',
  'sanitary_kit',
  'tourniquet',
]);

const NPC_DEFS: Record<string, PlotNpcDef> = {
  ag17_mira_triage: {
    name: 'Мира Сортировочная',
    isFemale: true,
    faction: Faction.SCIENTIST,
    occupation: Occupation.DOCTOR,
    sprite: Occupation.DOCTOR,
    hp: 160, maxHp: 160, money: 70, speed: 0.75,
    inventory: [
      { defId: 'bandage', count: 3 },
      { defId: 'iodine', count: 1 },
      { defId: 'clean_health_cert', count: 1 },
    ],
    talkLines: [
      'Приемный покой работает по видимым признакам: кровь, кашель, печать.',
      'За гермодверью двое. Антибиотик один. Решать придется руками, не инструкцией.',
      'Карантин не лечит. Он делает риск понятным для журнала.',
      'Можно потратить санитарный набор, украсть лекарство, закрыть палату или донести Ольге Дмитриевне. Она скажет, что важнее для медпункта: справка, доза или гермодверь.',
      'Если полезете в шкафы без допуска, журнал назовет это нарушением режима.',
      'ОВС после фиолетового тумана начинается не с кашля, а с бессонницы и чужих решений.',
      'Фильтр покажите до лица. Кто трогал лицо после тумана, идет в конец сортировки.',
    ],
    talkLinesPost: [
      'Справка сухая. Это уже половина диагноза.',
      'Не открывайте карантин во время сирены. Даже из сочувствия.',
      'Бинты закончились не сегодня. Сегодня это стало заметно.',
      'Если пациент молчит о сне, я спрашиваю санитарку. Санитарка злее, но точнее.',
    ],
  },

  ag17_klava_nurse: {
    name: 'Клава Санитарка',
    isFemale: true,
    faction: Faction.CITIZEN,
    occupation: Occupation.DOCTOR,
    sprite: Occupation.DOCTOR,
    hp: 115, maxHp: 115, money: 18, speed: 0.8,
    inventory: [
      { defId: 'bandage', count: 1 },
      { defId: 'filter_layer', count: 1 },
    ],
    talkLines: [
      'Не стойте в проходе. Носилки не умеют просить вежливо.',
      'Я злая не от характера. Я третью смену считаю, кто ещё тёплый.',
      'Температуру под мышку, справку на стол, руки от лица.',
      'Фиолетовый туман не легкие ест, а сон. Потом человек сам открывает дверь.',
      'Если фильтр грязный, меняйте. Если фильтр поёт, зовите ликвидатора.',
    ],
    talkLinesPost: [
      'Очередь двигайте глазами, не локтями.',
      'Карантинная справка чистая, пока пациент молчит.',
    ],
  },

  ag17_lida_patient: {
    name: 'Лида Температурная',
    isFemale: true,
    faction: Faction.CITIZEN,
    occupation: Occupation.HOUSEWIFE,
    sprite: Occupation.HOUSEWIFE,
    hp: 55, maxHp: 80, money: 8, speed: 0.45,
    inventory: [{ defId: 'note', count: 1 }],
    talkLines: [
      'Меня записали в карантин карандашом. Карандаш потом сломали.',
      'Нужен антибиотик. Я отдам направление, если доживу до подписи.',
      'За ширмой кашляет Юра. Он тоже просил лекарство. Я слышала.',
      'Если дверь закрыта, значит я еще официально внутри.',
      'После ОВС спать не могу. Лежу и слышу, как фильтр сохнет.',
    ],
    talkLinesPost: [
      'Жар отпустил. Или просто стало холоднее.',
      'Не говорите Юре, что я первая попросила. Он и так все слышит.',
      'Направление у вас. Психиатр любит такие следы.',
    ],
  },

  ag17_yura_patient: {
    name: 'Юра Плесневой',
    isFemale: false,
    faction: Faction.CITIZEN,
    occupation: Occupation.LOCKSMITH,
    sprite: Occupation.LOCKSMITH,
    hp: 65, maxHp: 90, money: 11, speed: 0.5,
    inventory: [{ defId: 'filter_layer', count: 1 }],
    talkLines: [
      'Плесень не болезнь, говорят. Тогда зачем дверь снаружи?',
      'Найдете антибиотик - я отдам медкарту. Мне она уже не помогает.',
      'Лида справа кашляет тише. Значит, ей хуже или она умнее.',
      'Санитар считает нас по койкам. Если койка пустая, он зовет Тараса.',
      'Если справку заберете, скажите, что я не трогал лицо. Я правда старался.',
    ],
    talkLinesPost: [
      'Медкарта у вас. Если она начнет теплеть, не кладите к хлебу.',
      'Дышать стало легче. Бумага, наверное, тяжелее.',
      'Когда выйду, первым делом починю замок с внутренней стороны.',
    ],
  },

  ag17_taras_sanitar: {
    name: 'Тарас Санпропуск',
    isFemale: false,
    faction: Faction.LIQUIDATOR,
    occupation: Occupation.HUNTER,
    sprite: Occupation.HUNTER,
    hp: 220, maxHp: 220, money: 55, speed: 0.95,
    inventory: [
      { defId: 'pipe', count: 1 },
      { defId: 'bandage', count: 1 },
    ],
    talkLines: [
      'Карантинный пост держит дверь, пока петля не просела и никто не сорвал пломбу.',
      'Внутри ходит бывший пациент. Уже без очереди.',
      'Уберите мертвяка - выдам санитарный набор. Не геройствуйте без выхода.',
      'Открыли створку - закрывайте за собой. Через щель туман идет быстрее человека.',
      'Скрывать зараженного можно только до обхода. Потом его скрывает уже дверь.',
    ],
    talkLinesPost: [
      'Минус один пациент без карты. Так проще считать.',
      'Санитарный набор ваш. Не тратьте на царапины гордости.',
      'Если журнал спросит, вы просто помогали двери оставаться дверью.',
    ],
  },

  ag17_varvara_morgue: {
    name: 'Варвара Морговая',
    isFemale: true,
    faction: Faction.SCIENTIST,
    occupation: Occupation.SECRETARY,
    sprite: Occupation.SECRETARY,
    hp: 95, maxHp: 95, money: 45, speed: 0.65,
    inventory: [
      { defId: 'antidep', count: 1 },
      { defId: 'psychiatrist_referral', count: 1 },
    ],
    talkLines: [
      'Морг сейчас без тел, зато с картами. Так даже хуже.',
      'Нужна карантинная медкарта. Не копия, не слух, не бирка.',
      'В картотеке шкаф заперт для честных людей. Остальные справляются быстрее.',
      'Если принесете карту, я выдам то, что в журнале называется благодарностью.',
      'Журнал гермодверей не читайте вслух. Там фамилии тех, кого еще надо искать.',
    ],
    talkLinesPost: [
      'Карта вернулась. Пациент пока нет. Это обычный порядок.',
      'Возьмите антидепрессант. Морг щедр только на бумаге.',
      'Оборот карты не читайте в очереди. Там адреса и время вскрытия палаты.',
    ],
  },
};

registerSideQuest('ag17_mira_triage', NPC_DEFS.ag17_mira_triage, [
  {
    id: QUEST_MIRA_MESSAGE,
    giverNpcId: 'ag17_mira_triage',
    type: QuestType.TALK,
    desc: 'Мира Сортировочная: «Передайте Ольге Дмитриевне: в карантине одна доза, одна справка и плохая гермодверь. Пусть медпункт решит порядок, пока мы не начали спорить у койки.»',
    targetNpcId: 'olga',
    rewardItem: 'clean_health_cert', rewardCount: 1,
    relationDelta: 10, xpReward: 35, moneyReward: 20,
    targetFloor: FloorLevel.LIVING,
    targetRoomType: RoomType.MEDICAL,
    targetZoneTag: CONTENT_TAG,
    targetHint: 'Жилая зона: от карантинного блока вернитесь в актовый зал к Ольге Дмитриевне.',
    eventTargetName: 'Ольге передано карантинное сообщение о нехватке дозы и гермодвери.',
    eventTags: [CONTENT_TAG, 'triage', 'message', 'olga', 'social'],
    eventData: { outcome: 'message_olga', rumorIds: ['room_quarantine_medcard'] },
  },
  {
    id: QUEST_MIRA_SANITARY,
    giverNpcId: 'ag17_mira_triage',
    type: QuestType.FETCH,
    desc: 'Мира Сортировочная: «Потратьте санитарный набор на сортировку: обработаем ширму, койку и руки. Себе он уже не вернется.»',
    targetItem: 'sanitary_kit', targetCount: 1,
    rewardItem: 'official_quarantine_clearance', rewardCount: 1,
    extraRewards: [{ defId: 'bandage', count: 1 }],
    relationDelta: 16, xpReward: 55, moneyReward: 35,
    requiresSideQuestDone: QUEST_MIRA_MESSAGE,
    targetFloor: FloorLevel.LIVING,
    targetRoomType: RoomType.MEDICAL,
    targetZoneTag: CONTENT_TAG,
    targetHint: 'Жилая зона: приемный стол больничного карантина.',
    eventTargetName: 'Санитарный набор потрачен на сортировку карантинного блока.',
    eventTags: [CONTENT_TAG, 'triage', 'supply_spent', 'medicine', 'quarantine'],
    eventData: { outcome: 'sanitary_kit_spent', supplyItem: 'sanitary_kit', rumorIds: ['rare_quarantine_clearance'] },
  },
]);
registerSideQuest('ag17_klava_nurse', NPC_DEFS.ag17_klava_nurse, []);

registerSideQuest('ag17_lida_patient', NPC_DEFS.ag17_lida_patient, [
  {
    id: QUEST_LIDA_ANTIBIOTIC,
    giverNpcId: 'ag17_lida_patient',
    type: QuestType.FETCH,
    desc: 'Лида Температурная: «Принесите антибиотик. Если я первая получу дозу, отдам направление к психиатру.»',
    targetItem: 'antibiotic', targetCount: 1,
    rewardItem: 'psychiatrist_referral', rewardCount: 1,
    relationDelta: 14, xpReward: 45, moneyReward: 20,
    blockedBySideQuestIds: [QUEST_YURA_ANTIBIOTIC],
    abandonsSideQuestIds: [QUEST_YURA_ANTIBIOTIC],
    targetFloor: FloorLevel.LIVING,
    targetRoomType: RoomType.MEDICAL,
    targetZoneTag: CONTENT_TAG,
    targetHint: 'Жилая зона: правая карантинная койка больничного блока.',
    eventTargetName: 'Единственную дозу антибиотика отдали Лиде Температурной.',
    eventTags: [CONTENT_TAG, 'triage', 'antibiotic', 'patient_choice', 'lida'],
    eventData: { outcome: 'lida_treated', skippedPatient: 'ag17_yura_patient', rumorIds: ['room_quarantine_medcard'] },
  },
]);

registerSideQuest('ag17_yura_patient', NPC_DEFS.ag17_yura_patient, [
  {
    id: QUEST_YURA_ANTIBIOTIC,
    giverNpcId: 'ag17_yura_patient',
    type: QuestType.FETCH,
    desc: 'Юра Плесневой: «Принеси антибиотик. Медкарту отдам тебе - мне она уже хуже бинта.»',
    targetItem: 'antibiotic', targetCount: 1,
    rewardItem: 'quarantine_medcard', rewardCount: 1,
    relationDelta: 14, xpReward: 45, moneyReward: 20,
    blockedBySideQuestIds: [QUEST_LIDA_ANTIBIOTIC],
    abandonsSideQuestIds: [QUEST_LIDA_ANTIBIOTIC],
    targetFloor: FloorLevel.LIVING,
    targetRoomType: RoomType.MEDICAL,
    targetZoneTag: CONTENT_TAG,
    targetHint: 'Жилая зона: дальняя карантинная койка больничного блока.',
    eventTargetName: 'Единственную дозу антибиотика отдали Юре Плесневому.',
    eventTags: [CONTENT_TAG, 'triage', 'antibiotic', 'patient_choice', 'yura'],
    eventData: { outcome: 'yura_treated', skippedPatient: 'ag17_lida_patient', rumorIds: ['lead_living_quarantine_medcard'] },
  },
]);

registerSideQuest('ag17_taras_sanitar', NPC_DEFS.ag17_taras_sanitar, [
  {
    id: QUEST_TARAS_OUTBREAK,
    giverNpcId: 'ag17_taras_sanitar',
    type: QuestType.KILL,
    desc: 'Тарас Санпропуск: «В карантинной палате ходит мертвяк. Уберите его, пока он не дошел до журнала.»',
    targetMonsterKind: MonsterKind.ZOMBIE,
    killNeeded: 1,
    rewardItem: 'sanitary_kit', rewardCount: 1,
    extraRewards: [{ defId: 'bandage', count: 2 }],
    relationDelta: 18, xpReward: 65, moneyReward: 50,
    targetFloor: FloorLevel.LIVING,
    targetRoomType: RoomType.MEDICAL,
    targetZoneTag: CONTENT_TAG,
    targetHint: 'Жилая зона: палата за гермодверью больничного карантина.',
    eventTargetName: 'Карантинный мертвяк зачищен до выхода из палаты.',
    eventTags: [CONTENT_TAG, 'triage', 'outbreak', 'monster', 'hazard_cleaned'],
    eventData: { outcome: 'outbreak_cleaned', rumorIds: ['room_quarantine_medcard'] },
  },
  {
    id: QUEST_TARAS_SEAL_WARD,
    giverNpcId: 'ag17_taras_sanitar',
    type: QuestType.FETCH,
    desc: 'Тарас Санпропуск: «Есть тюбик герметика? Закроем палату как карантин, а не как просьбу. Потом туда только по журналу.»',
    targetItem: 'sealant_tube', targetCount: 1,
    rewardItem: 'official_quarantine_clearance', rewardCount: 1,
    extraRewards: [{ defId: 'iodine', count: 1 }],
    relationDelta: 12, xpReward: 50, moneyReward: 35,
    requiresSideQuestDone: QUEST_TARAS_OUTBREAK,
    targetFloor: FloorLevel.LIVING,
    targetRoomType: RoomType.MEDICAL,
    targetZoneTag: CONTENT_TAG,
    targetHint: 'Жилая зона: гермодверь карантинной палаты после зачистки.',
    eventTargetName: 'Карантинная палата запечатана герметиком после зачистки.',
    eventTags: [CONTENT_TAG, 'triage', 'quarantine_room', 'door_sealed', 'anomaly_risk'],
    eventData: { outcome: 'ward_sealed', sealItem: 'sealant_tube', rumorIds: ['room_quarantine_medcard'] },
  },
]);

registerSideQuest('ag17_varvara_morgue', NPC_DEFS.ag17_varvara_morgue, [
  {
    id: 'ag17_varvara_medcard',
    giverNpcId: 'ag17_varvara_morgue',
    type: QuestType.FETCH,
    desc: 'Варвара Морговая: «Достаньте карантинную медкарту из картотеки. Без нее пациент числится дважды.»',
    targetItem: 'quarantine_medcard', targetCount: 1,
    rewardItem: 'antidep', rewardCount: 1,
    extraRewards: [{ defId: 'clean_health_cert', count: 1 }],
    relationDelta: 16, xpReward: 55, moneyReward: 45,
  },
]);

function sourceSideQuestId(event: WorldEvent): string {
  const id = event.data?.sideQuestId;
  return typeof id === 'string' ? id : '';
}

function sourceOutcome(event: WorldEvent): string {
  const outcome = event.data?.outcome;
  return typeof outcome === 'string' ? outcome : '';
}

function isTriageMedicine(itemId: string | undefined): boolean {
  return itemId !== undefined && TRIAGE_MEDICINE.has(itemId);
}

registerWorldEventObserver((state, event) => {
  if (event.tags.includes(OUTCOME_TAG)) return;

  if (event.type === 'quest_completed') {
    const sideQuestId = sourceSideQuestId(event);
    if (sideQuestId === QUEST_MIRA_MESSAGE) {
      publishEvent(state, {
        type: 'faction_relation_changed',
        floor: FloorLevel.LIVING,
        zoneId: event.zoneId,
        roomId: event.roomId,
        actorId: event.actorId,
        actorName: event.actorName,
        actorFaction: event.actorFaction,
        targetName: 'Ольга получила карантинное сообщение; медпункт взял решение по дозе, справке и гермодвери.',
        severity: 4,
        privacy: 'local',
        tags: [CONTENT_TAG, OUTCOME_TAG, 'triage', 'message', 'olga', 'social'],
        data: { sourceEventId: event.id, sideQuestId, outcome: 'message_olga', rumorIds: ['room_quarantine_medcard'] },
      });
      return;
    }

    if (sideQuestId === QUEST_MIRA_SANITARY) {
      publishEvent(state, {
        type: 'hazard_cleaned',
        floor: FloorLevel.LIVING,
        zoneId: event.zoneId,
        roomId: event.roomId,
        actorId: event.actorId,
        actorName: event.actorName,
        actorFaction: event.actorFaction,
        itemId: 'sanitary_kit',
        itemName: 'Санитарный набор',
        itemCount: 1,
        severity: 4,
        privacy: 'local',
        tags: [CONTENT_TAG, OUTCOME_TAG, 'triage', 'supply_spent', 'quarantine', 'medicine'],
        data: { sourceEventId: event.id, sideQuestId, outcome: 'sanitary_kit_spent', rumorIds: ['rare_quarantine_clearance'] },
      });
      return;
    }

    if (sideQuestId === QUEST_LIDA_ANTIBIOTIC || sideQuestId === QUEST_YURA_ANTIBIOTIC) {
      const lida = sideQuestId === QUEST_LIDA_ANTIBIOTIC;
      publishEvent(state, {
        type: 'faction_relation_changed',
        floor: FloorLevel.LIVING,
        zoneId: event.zoneId,
        roomId: event.roomId,
        actorId: event.actorId,
        actorName: event.actorName,
        actorFaction: event.actorFaction,
        itemId: 'antibiotic',
        itemName: 'Антибиотик',
        itemCount: 1,
        targetName: lida
          ? 'Доза ушла Лиде; Юра остался в карантинной очереди.'
          : 'Доза ушла Юре; Лида осталась в карантинной очереди.',
        severity: 4,
        privacy: 'local',
        tags: [CONTENT_TAG, OUTCOME_TAG, 'triage', 'patient_choice', 'antibiotic', lida ? 'lida' : 'yura'],
        data: {
          sourceEventId: event.id,
          sideQuestId,
          outcome: lida ? 'lida_treated' : 'yura_treated',
          skippedPatient: lida ? 'ag17_yura_patient' : 'ag17_lida_patient',
          rumorIds: [lida ? 'room_quarantine_medcard' : 'lead_living_quarantine_medcard'],
        },
      });
      return;
    }

    if (sideQuestId === QUEST_TARAS_SEAL_WARD) {
      publishEvent(state, {
        type: 'door_sealed',
        floor: FloorLevel.LIVING,
        zoneId: event.zoneId,
        roomId: event.roomId,
        actorId: event.actorId,
        actorName: event.actorName,
        actorFaction: event.actorFaction,
        targetName: 'Карантинная палата',
        itemId: 'sealant_tube',
        itemName: 'Герметик',
        itemCount: 1,
        severity: 4,
        privacy: 'local',
        tags: [CONTENT_TAG, OUTCOME_TAG, 'triage', 'quarantine_room', 'door_sealed', 'anomaly_risk'],
        data: { sourceEventId: event.id, sideQuestId, outcome: 'ward_sealed', rumorIds: ['room_quarantine_medcard'] },
      });
      return;
    }

    if (event.tags.includes('medical_fraud') && sourceOutcome(event) === 'fraud_exposed') {
      publishEvent(state, {
        type: 'faction_relation_changed',
        floor: FloorLevel.LIVING,
        zoneId: event.zoneId,
        roomId: event.roomId,
        actorId: event.actorId,
        actorName: event.actorName,
        actorFaction: event.actorFaction,
        targetName: 'Карантинный стол вычеркнул липовый медугол из очереди лечения.',
        severity: 4,
        privacy: 'public',
        tags: [CONTENT_TAG, OUTCOME_TAG, 'triage', 'medical_fraud', 'fraud_exposed', 'social'],
        data: { sourceEventId: event.id, outcome: 'fake_medpost_exposed', rumorIds: ['economy_zhelemish_bad_medicine'] },
      });
    }
    return;
  }

  if (
    event.type === 'item_stolen'
    && isTriageMedicine(event.itemId)
    && (event.tags.includes(CONTENT_TAG) || event.tags.includes('quarantine'))
  ) {
    publishEvent(state, {
      type: 'faction_relation_changed',
      floor: FloorLevel.LIVING,
      zoneId: event.zoneId,
      roomId: event.roomId,
      actorId: event.actorId,
      actorName: event.actorName,
      actorFaction: event.actorFaction,
      targetId: event.targetId,
      targetName: event.targetName ?? 'карантинная очередь',
      targetFaction: event.targetFaction,
      itemId: event.itemId,
      itemName: event.itemName,
      itemCount: event.itemCount,
      containerId: event.containerId,
      severity: 5,
      privacy: event.privacy === 'private' ? 'local' : event.privacy,
      tags: [CONTENT_TAG, OUTCOME_TAG, 'triage', 'medicine_stolen', 'quarantine', 'social'],
      data: {
        sourceEventId: event.id,
        outcome: 'medicine_stolen',
        anomalyRisk: event.tags.includes('quarantine'),
        rumorIds: ['room_quarantine_medcard'],
      },
    });
  }
});

function addDoor(world: World, room: Room, x: number, y: number, state: DoorState): void {
  const ci = world.idx(x, y);
  world.cells[ci] = Cell.DOOR;
  world.aptMask[ci] = 1;
  world.roomMap[ci] = room.id;
  world.doors.set(ci, { idx: ci, state, roomA: room.id, roomB: room.id, keyId: '', timer: 0 });
  room.doors.push(ci);
}

function addDrop(entities: Entity[], nextId: { v: number }, x: number, y: number, defId: string, count = 1): void {
  entities.push({
    id: nextId.v++, type: EntityType.ITEM_DROP,
    x: x + 0.5, y: y + 0.5,
    angle: 0, pitch: 0, alive: true, speed: 0, sprite: Spr.ITEM_DROP,
    inventory: [{ defId, count }],
  });
}

function pushNpc(
  entities: Entity[], nextId: { v: number }, plotNpcId: string,
  x: number, y: number, canGiveQuest: boolean, weapon?: string,
): void {
  requireSpawnedPlotNpcFromPackage(entities, nextId, plotNpcId, x + 0.5, y + 0.5, {
    angle: Math.random() * Math.PI * 2,
    weapon,
    canGiveQuest,
    extra: { isTraveler: false },
  });
}

function pushOutbreakMonster(world: World, entities: Entity[], nextId: { v: number }, x: number, y: number): void {
  const def = MONSTERS[MonsterKind.ZOMBIE];
  entities.push({
    id: nextId.v++, type: EntityType.MONSTER,
    x: x + 0.5, y: y + 0.5,
    angle: Math.random() * Math.PI * 2, pitch: 0,
    alive: true, speed: def.speed * 0.9, sprite: monsterSpr(MonsterKind.ZOMBIE),
    name: 'Карантинный мертвяк',
    hp: Math.round(def.hp * 1.5), maxHp: Math.round(def.hp * 1.5),
    monsterKind: MonsterKind.ZOMBIE, attackCd: 0,
    ai: { goal: AIGoal.WANDER, tx: x, ty: y, path: [], pi: 0, stuck: 0, timer: 0 },
  });
  stampSurfaceSplat(world, x, y, 0.5, 0.5, 6, 0.45, 17017, 72, 90, 68, false);
}

function pushHeadSlugHost(world: World, entities: Entity[], nextId: { v: number }, x: number, y: number): void {
  const def = MONSTERS[MonsterKind.HEAD_SLUG];
  entities.push({
    id: nextId.v++, type: EntityType.MONSTER,
    x: x + 0.5, y: y + 0.5,
    angle: Math.random() * Math.PI * 2, pitch: 0,
    alive: true, speed: def.speed * 0.9, sprite: monsterSpr(MonsterKind.HEAD_SLUG),
    name: 'Карантинный носитель слизня',
    hp: def.hp, maxHp: def.hp,
    monsterKind: MonsterKind.HEAD_SLUG,
    monsterStage: HEAD_SLUG_HOSTED_STAGE,
    parasiteHostSkill: 0.9,
    attackCd: 0,
    ai: { goal: AIGoal.WANDER, tx: x, ty: y, path: [], pi: 0, stuck: 0, timer: 0 },
  });
  stampSurfaceSplat(world, x, y, 0.5, 0.5, 4, 0.35, 17019, 112, 62, 76, false);
}

function addHospitalContainer(
  world: World,
  room: Room,
  kind: ContainerKind,
  name: string,
  x: number,
  y: number,
  access: WorldContainer['access'],
  inventory: WorldContainer['inventory'],
  tags: string[],
  faction = Faction.SCIENTIST,
): void {
  const ci = world.idx(x, y);
  const container: WorldContainer = {
    id: world.containers.length + 1,
    x,
    y,
    floor: FloorLevel.LIVING,
    roomId: room.id,
    zoneId: world.zoneMap[ci],
    kind,
    name,
    inventory,
    capacitySlots: Math.max(6, inventory.length + 2),
    faction,
    access,
    lockDifficulty: access === 'locked' ? 3 : undefined,
    discovered: true,
    tags: [CONTENT_TAG, 'hospital', 'quarantine', ...tags],
  };
  world.addContainer(container);
}

export function generateHospitalQuarantine(
  world: World, nextRoomId: number, entities: Entity[], nextId: { v: number },
  zcx: number, zcy: number,
): { nextRoomId: number } {
  const rx = world.wrap(zcx - Math.floor(HOSPITAL_W / 2));
  const ry = world.wrap(zcy - Math.floor(HOSPITAL_H / 2));

  for (let dy = -1; dy <= HOSPITAL_H; dy++) {
    for (let dx = -1; dx <= HOSPITAL_W; dx++) {
      const ci = world.idx(rx + dx, ry + dy);
      if (world.aptMask[ci]) continue;
      world.cells[ci] = Cell.WALL;
      world.wallTex[ci] = Tex.TILE_W;
      world.floorTex[ci] = Tex.F_TILE;
      world.roomMap[ci] = -1;
      world.features[ci] = Feature.NONE;
    }
  }

  const roomId = nextRoomId++;
  const room: Room = {
    id: roomId,
    type: RoomType.MEDICAL,
    x: rx, y: ry, w: HOSPITAL_W, h: HOSPITAL_H,
    name: 'Больничный блок карантина',
    wallTex: Tex.TILE_W,
    floorTex: Tex.F_TILE,
    doors: [],
    sealed: false,
    apartmentId: -1,
  };
  world.rooms[roomId] = room;

  for (let dy = 0; dy < HOSPITAL_H; dy++) {
    for (let dx = 0; dx < HOSPITAL_W; dx++) {
      const ci = world.idx(rx + dx, ry + dy);
      if (world.aptMask[ci]) continue;
      world.cells[ci] = Cell.FLOOR;
      world.floorTex[ci] = Tex.F_TILE;
      world.roomMap[ci] = roomId;
    }
  }

  for (let dy = -1; dy <= HOSPITAL_H; dy++) {
    for (let dx = -1; dx <= HOSPITAL_W; dx++) {
      const ci = world.idx(rx + dx, ry + dy);
      world.aptMask[ci] = 1;
      if (world.cells[ci] === Cell.WALL) world.wallTex[ci] = Tex.TILE_W;
    }
  }

  const wallX = rx + QUARANTINE_WALL_DX;
  const wardDoorY = ry + Math.floor(HOSPITAL_H / 2);
  for (let dy = 1; dy < HOSPITAL_H - 1; dy++) {
    const ci = world.idx(wallX, ry + dy);
    world.cells[ci] = Cell.WALL;
    world.wallTex[ci] = Tex.HERMO_WALL;
    world.roomMap[ci] = -1;
    world.features[ci] = Feature.NONE;
  }

  addDoor(world, room, rx + 5, ry + HOSPITAL_H, DoorState.CLOSED);
  addDoor(world, room, wallX, wardDoorY, DoorState.HERMETIC_CLOSED);

  let cx = rx + 5;
  let cy = world.wrap(ry + HOSPITAL_H + 1);
  for (let s = 0; s < 70; s++) {
    const ci = world.idx(cx, cy);
    if (world.cells[ci] === Cell.FLOOR && !world.aptMask[ci]) break;
    if (!world.aptMask[ci]) {
      world.cells[ci] = Cell.FLOOR;
      world.floorTex[ci] = Tex.F_LINO;
      world.roomMap[ci] = -1;
    }
    cy = world.wrap(cy + 1);
  }

  for (const [fx, fy, feature] of [
    [2, 1, Feature.LAMP], [9, 1, Feature.LAMP], [15, 1, Feature.LAMP],
    [2, 3, Feature.DESK], [3, 3, Feature.DESK], [4, 3, Feature.DESK],
    [2, 4, Feature.CHAIR], [3, 4, Feature.CHAIR], [4, 4, Feature.CHAIR],
    [3, 11, Feature.SHELF], [6, 11, Feature.SHELF], [8, 11, Feature.APPARATUS],
    [10, 6, Feature.SINK], [11, 6, Feature.APPARATUS],
    [14, 3, Feature.BED], [16, 3, Feature.BED], [14, 8, Feature.BED], [16, 8, Feature.BED],
    [15, 12, Feature.SINK], [17, 12, Feature.SHELF],
  ] as const) {
    world.features[world.idx(rx + fx, ry + fy)] = feature;
  }

  addDrop(entities, nextId, rx + 2, ry + 6, 'filter_receipt');
  addDrop(entities, nextId, rx + 10, ry + 8, 'siren_instruction');

  addHospitalContainer(
    world, room, ContainerKind.MEDICAL_CABINET, 'Карантинный шкаф N17',
    rx + 3, ry + 11, 'locked',
    [
      { defId: 'bandage', count: 3 },
      { defId: 'antibiotic', count: 1 },
      { defId: 'iodine', count: 1 },
      { defId: 'morphine_ampoule', count: 1 },
    ],
    ['medical', 'supplies', 'locked', 'violation'],
    Faction.PLAYER,
  );
  addHospitalContainer(
    world, room, ContainerKind.MEDICAL_CABINET, 'Чужой ящик санпропуска',
    rx + 8, ry + 11, 'faction',
    [
      { defId: 'bandage', count: 2 },
      { defId: 'antibiotic', count: 1 },
      { defId: 'tourniquet', count: 1 },
    ],
    ['medical', 'supplies', 'locked', 'violation'],
  );
  addHospitalContainer(
    world, room, ContainerKind.FILING_CABINET, 'Картотека зараженных',
    rx + 6, ry + 11, 'faction',
    [
      { defId: 'quarantine_medcard', count: 1 },
      { defId: 'quarantine_breach_notice', count: 1 },
      { defId: 'clean_health_cert', count: 1 },
      { defId: 'hermodoor_journal', count: 1 },
      { defId: 'psychiatrist_referral', count: 1 },
    ],
    ['documents', 'locked', 'violation'],
  );
  addHospitalContainer(
    world, room, ContainerKind.SECRET_STASH, 'Тайник санитаров за ширмой',
    rx + 17, ry + 12, 'secret',
    [
      { defId: 'antifungal_ointment', count: 1 },
      { defId: 'pills', count: 2 },
      { defId: 'alcohol_bottle', count: 1 },
    ],
    ['medical', 'supplies', 'secret', 'opened'],
  );

  pushNpc(entities, nextId, 'ag17_mira_triage', rx + 4, ry + 2, true);
  pushNpc(entities, nextId, 'ag17_klava_nurse', rx + 3, ry + 6, false);
  pushNpc(entities, nextId, 'ag17_taras_sanitar', rx + 10, wardDoorY, true, 'pipe');
  pushNpc(entities, nextId, 'ag17_lida_patient', rx + 14, ry + 4, true);
  pushNpc(entities, nextId, 'ag17_yura_patient', rx + 16, ry + 9, true);
  pushNpc(entities, nextId, 'ag17_varvara_morgue', rx + 6, ry + 13, true);
  pushOutbreakMonster(world, entities, nextId, rx + 17, ry + 5);
  pushHeadSlugHost(world, entities, nextId, rx + 15, ry + 7);

  genLog(`[AG17] Больничный блок карантина at (${rx}, ${ry}) room #${roomId}`);
  return { nextRoomId };
}

registerZoneContent(38, 'Больничный блок карантина', generateHospitalQuarantine);
