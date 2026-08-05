/* ── Standalone monster armor hooks ───────────────────────────── */

import { EntityType, MonsterKind, ProjType, msg, type Entity, type GameState } from '../core/types';
import type { World } from '../core/world';
import { entityDisplayName } from '../entities/monster';
import { publishEvent } from './events';
import {
  PANELNIK_WALL_BRACE_DAMAGE_MULT,
  applyMonsterIncomingDamage,
  chervieNetPowered,
  panelnikWallBraceActive,
} from './monster_traits';
import { isPlayerEntity } from './player_actor';

export const ZAKALENNAYA_ARMATURA_ARMOR_STACKS = 3;

const STRIP_COOLDOWN_S = 0.18;
const WEAK_DAMAGE_MULT = 0.28;
const HEAVY_DAMAGE_MULT = 0.68;
const FINAL_STRIP_DAMAGE_MULT = 0.92;
const WEAK_CHIP_THRESHOLD = 24;
const WEAK_CHIP_MULT = 0.07;
const WEAK_MESSAGE_COOLDOWN_S = 0.75;

const ARMOR_STRIP_WEAPONS = new Set([
  'shotgun',
  'toz_shotgun',
  'grenade',
  'gauss',
  'bfg',
  'gravity_beam_emitter',
  'harpoon_gun',
  'losyash_rifle',
  'ptrs_liquidator',
  'sledgehammer',
  'axe',
  'liquidator_axe',
  'chainsaw',
  'crowbar',
  'metal_chair',
]);

const ARMOR_TOOL_WEAPONS = new Set([
  'jackhammer',
  'fire_hook',
  'rebar',
]);

const CHERVIE_ENERGY_WEAPONS = new Set([
  'gauss',
  'plasma',
  'bfg',
  'gravity_beam_emitter',
  'uv_spotlight',
]);

export type MonsterArmorHitKind = 'weak' | 'heavy' | 'tool';

export interface MonsterArmorHitInput {
  damage: number;
  attacker?: Entity;
  weaponId?: string;
  projectileType?: ProjType;
  aoe?: boolean;
}

export interface MonsterArmorHitResult {
  damage: number;
  armorActive: boolean;
  armorStacks: number;
  stripped: boolean;
  hitKind: MonsterArmorHitKind;
}

function hitKind(input: MonsterArmorHitInput): MonsterArmorHitKind {
  const weaponId = input.weaponId ?? '';
  if (ARMOR_TOOL_WEAPONS.has(weaponId)) return 'tool';
  if (
    input.aoe ||
    input.projectileType === ProjType.GRENADE ||
    input.projectileType === ProjType.BFG ||
    input.projectileType === ProjType.BEAM ||
    ARMOR_STRIP_WEAPONS.has(weaponId)
  ) return 'heavy';
  return 'weak';
}

function isChervieEnergyHit(input: MonsterArmorHitInput): boolean {
  return input.projectileType === ProjType.BEAM ||
    input.projectileType === ProjType.BFG ||
    CHERVIE_ENERGY_WEAPONS.has(input.weaponId ?? '');
}

function zoneIdAt(world: World, e: Entity): number | undefined {
  const zoneId = world.zoneMap[world.idx(Math.floor(e.x), Math.floor(e.y))];
  return zoneId >= 0 ? zoneId : undefined;
}

function roomIdAt(world: World, e: Entity): number | undefined {
  const roomId = world.roomMap[world.idx(Math.floor(e.x), Math.floor(e.y))];
  return roomId >= 0 ? roomId : undefined;
}

function publishArmorStripEvent(
  world: World,
  state: GameState,
  monster: Entity,
  input: MonsterArmorHitInput,
  result: MonsterArmorHitResult,
  rawDamage: number,
): void {
  publishEvent(state, {
    type: 'monster_armor_cut',
    zoneId: zoneIdAt(world, monster),
    roomId: roomIdAt(world, monster),
    x: monster.x,
    y: monster.y,
    actorId: input.attacker?.id,
    actorName: input.attacker ? entityDisplayName(input.attacker) : undefined,
    actorFaction: input.attacker?.faction,
    targetId: monster.id,
    targetName: entityDisplayName(monster),
    targetFaction: monster.faction,
    monsterKind: monster.monsterKind,
    itemId: input.weaponId,
    severity: result.armorStacks <= 0 ? 4 : 3,
    privacy: isPlayerEntity(input.attacker) ? 'local' : 'witnessed',
    tags: ['monster', 'zakalennaya_armatura', 'armor_strip', result.hitKind],
    data: {
      armorStacks: result.armorStacks,
      armorMaxStacks: ZAKALENNAYA_ARMATURA_ARMOR_STACKS,
      rawDamage,
      damage: result.damage,
      weaponId: input.weaponId,
      projectileType: input.projectileType,
      finalStrip: result.armorStacks <= 0,
    },
  });
}

function pushArmorMessage(state: GameState, monster: Entity, text: string, color: string, force = false): void {
  if (!force && state.time - (monster.monsterArmorLastMsgAt ?? -Infinity) < WEAK_MESSAGE_COOLDOWN_S) return;
  monster.monsterArmorLastMsgAt = state.time;
  state.msgs.push(msg(text, state.time, color));
}

function applyPanelnikWallBraceHit(
  world: World,
  state: GameState,
  monster: Entity,
  input: MonsterArmorHitInput,
  rawDamage: number,
  kind: MonsterArmorHitKind,
): MonsterArmorHitResult | undefined {
  if (!panelnikWallBraceActive(world, monster)) return undefined;
  const result: MonsterArmorHitResult = {
    damage: Math.max(1, Math.round(rawDamage * PANELNIK_WALL_BRACE_DAMAGE_MULT)),
    armorActive: true,
    armorStacks: 1,
    stripped: false,
    hitKind: kind,
  };

  if (state.time - (monster.monsterArmorLastMsgAt ?? -Infinity) >= 1.2) {
    monster.monsterArmorLastMsgAt = state.time;
    if (monster.ai) monster.ai.wallBraceCueAt = Math.max(monster.ai.wallBraceCueAt ?? 0, state.time + 2.4);
    state.msgs.push(msg('Пыльная рука Панельника уперлась в стену: броня держит удар, выманивайте в центр.', state.time, '#cca'));
    publishEvent(state, {
      type: 'monster_sighted',
      zoneId: zoneIdAt(world, monster),
      roomId: roomIdAt(world, monster),
      x: monster.x,
      y: monster.y,
      actorId: input.attacker?.id,
      actorName: input.attacker ? entityDisplayName(input.attacker) : undefined,
      actorFaction: input.attacker?.faction,
      targetId: monster.id,
      targetName: entityDisplayName(monster),
      targetFaction: monster.faction,
      monsterKind: MonsterKind.PANELNIK,
      itemId: input.weaponId,
      severity: 3,
      privacy: isPlayerEntity(input.attacker) ? 'local' : 'witnessed',
      tags: ['monster', 'panelnik', 'wall_brace', 'armor'],
      data: {
        rawDamage,
        damage: result.damage,
        damageMult: PANELNIK_WALL_BRACE_DAMAGE_MULT,
        counterplay: 'bait_to_open_floor',
        rumorIds: ['ecology_panelnik_wall'],
      },
    });
  }

  return result;
}

export function applyMonsterArmorHit(
  world: World,
  state: GameState,
  monster: Entity,
  input: MonsterArmorHitInput,
): MonsterArmorHitResult {
  const rawDamage = Math.max(0, input.damage);
  const kind = hitKind(input);
  const panelnikBrace = applyPanelnikWallBraceHit(world, state, monster, input, rawDamage, kind);
  if (panelnikBrace) return panelnikBrace;
  if (monster.type === EntityType.MONSTER && monster.monsterKind === MonsterKind.CHERVIE_AVATAR) {
    const powered = chervieNetPowered(world, monster);
    const energy = isChervieEnergyHit(input);
    const mult = powered
      ? energy ? 1.08 : 0.56
      : energy ? 1.34 : 1;
    return {
      damage: Math.max(1, Math.round(rawDamage * mult)),
      armorActive: powered && !energy,
      armorStacks: powered && !energy ? 1 : 0,
      stripped: false,
      hitKind: kind,
    };
  }
  const incomingDamage = applyMonsterIncomingDamage(world, monster, rawDamage);

  if (monster.type !== EntityType.MONSTER || monster.monsterKind !== MonsterKind.ZAKALENNAYA_ARMATURA) {
    return { damage: incomingDamage, armorActive: false, armorStacks: 0, stripped: false, hitKind: kind };
  }

  let stacks = monster.monsterArmorStacks ?? ZAKALENNAYA_ARMATURA_ARMOR_STACKS;
  if (stacks <= 0) {
    monster.monsterArmorStacks = 0;
    return { damage: incomingDamage, armorActive: false, armorStacks: 0, stripped: false, hitKind: kind };
  }

  const heavy = kind !== 'weak';
  const canStrip = state.time - (monster.monsterArmorLastStripAt ?? -Infinity) >= STRIP_COOLDOWN_S;
  let stripped = false;

  if (heavy && canStrip) {
    stacks--;
    stripped = true;
    monster.monsterArmorChip = 0;
    monster.monsterArmorLastStripAt = state.time;
  } else if (!heavy) {
    const chip = (monster.monsterArmorChip ?? 0) + rawDamage * WEAK_CHIP_MULT;
    if (chip >= WEAK_CHIP_THRESHOLD && canStrip) {
      stacks--;
      stripped = true;
      monster.monsterArmorChip = 0;
      monster.monsterArmorLastStripAt = state.time;
    } else {
      monster.monsterArmorChip = Math.min(WEAK_CHIP_THRESHOLD, chip);
    }
  }

  monster.monsterArmorStacks = Math.max(0, stacks);
  if (stripped && monster.ai) {
    const stagger = heavy ? 0.85 : 0.35;
    monster.ai.staggerTimer = Math.max(monster.ai.staggerTimer ?? 0, stagger);
    monster.attackCd = Math.max(monster.attackCd ?? 0, heavy ? 0.75 : 0.35);
    monster.spriteScale = monster.monsterArmorStacks <= 0 ? 0.88 : 0.94;
  }

  const mult = stripped && monster.monsterArmorStacks <= 0
    ? FINAL_STRIP_DAMAGE_MULT
    : heavy
    ? HEAVY_DAMAGE_MULT
    : WEAK_DAMAGE_MULT;
  const result: MonsterArmorHitResult = {
    damage: Math.max(1, Math.round(rawDamage * mult)),
    armorActive: true,
    armorStacks: monster.monsterArmorStacks,
    stripped,
    hitKind: kind,
  };

  if (stripped) {
    publishArmorStripEvent(world, state, monster, input, result, rawDamage);
    pushArmorMessage(
      state,
      monster,
      monster.monsterArmorStacks <= 0
        ? 'Броня Закаленной Арматуры сорвана. Теперь это медленная цель.'
        : 'С Закаленной Арматуры осыпалась бронеплита.',
      '#fc4',
      true,
    );
  } else if (!heavy) {
    pushArmorMessage(state, monster, 'Слабый удар звякнул по закаленной броне.', '#aaa');
  }

  return result;
}
