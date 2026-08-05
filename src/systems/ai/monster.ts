/* ── Monster behavior: hunt player + hostile NPCs ─────────────── */

import {
  W,
  type Entity, type GameState, type MonsterBaitLineState, type Msg, type Room, type WorldContainer,
  Cell, DoorState, Faction, Feature, ItemType, ProjType, RoomType, Tex, ZoneFaction,
  EntityType, AIGoal, MonsterKind,
  msg,
} from '../../core/types';
import { World } from '../../core/world';
import { calculateDamage, applyHitStaggerAndKnockback } from '../combat';
import { DamageType } from '../../core/types';
import { MONSTERS, entityDisplayName, type MonsterAIFlag, type MonsterDef } from '../../entities/monster';
import { ITEMS, ITEM_TAGS, getStack } from '../../data/items';
import { occupationHasProfileTag } from '../../data/occupation_profiles';
import { droppedToolLightScore, equippedToolLightScore } from '../../data/tool_lights';
import {
  playGrowl,
  playFogSharkBite,
  playFogSharkHiss,
  playHostileEnergyShot,
  playHostileEyeShot,
  playHostileFlame,
  playHostileParagraphShot,
  playHostilePsiCast,
  playSoundAt,
} from '../audio';
import { isHostile } from '../factions';
import { scaleMonsterDmg, strMeleeDmgMult } from '../rpg';
import { applySporeHaze, hasSporeHazeProtection, zhelemishIncomingMeleeDamage } from '../status';
import { spawnBloodHit, spawnDeathPool } from '../blood_fx';
import { MarkType, stampMark } from '../surface_marks';
import { followPath, tryAssignPathToCell, wanderNearby } from './pathfinding';
import { evaluateMicroStimuli, tickMicroGoal } from './micro_goals';
import { Spr } from '../../render/sprite_index';
import { getRecentEvents, publishEvent } from '../events';
import { recordPlayerDamage } from '../damage';
import { setDoorState } from '../door_state';
import { findNoiseForActor, findNoiseInvestigationTarget, type NoiseRecord } from '../noise';
import { ROOM_MEMORY_BITS, getRoomMemory, roomMemoryHas } from '../room_memory';
import {
  MONSTER_BAIT_COMBAT_LOCK_SQ,
  MONSTER_BAIT_CONSUME_RADIUS_SQ,
  clearDeadBaitDrop,
  consumeMonsterBait,
  getActiveMonsterBaits,
  findMonsterBaitTarget,
  type MonsterBaitMarker,
} from '../monster_bait';
import { entityInActiveCellHazard, registerCellHazardSite } from '../cell_hazards';
import { isDebugOnePunchManEnabled, keepDebugOnePunchManAlive } from '../debug_cheats';
import { ENTITY_MASK_ACTOR, ENTITY_MASK_ITEM_DROP, ENTITY_MASK_NPC, ensureEntityIndex, getEntityIndex } from '../entity_index';
import { notifyActorDamaged } from '../combat_stimulus';
import { applyDemosRelationDelta } from '../demos_social';
import { updateSlimevikMonster } from '../slimevik';
import { updateGnilushkaMonster } from '../gnilushka';
import { territoryOwnerAtIndex } from '../territory';
import { HEAD_SLUG_DETACHED_STAGE, HEAD_SLUG_HOSTED_STAGE } from '../../entities/head_slug';
import { updateKhorovayaMatka } from './khorovaya_matka';
import {
  findZombieApocalypseTarget,
  isZombieApocalypseActive,
  tryZombieApocalypseInfection,
} from '../procedural_anomalies/zombie_apocalypse';
import { entitySpawnSlots } from '../entity_limits';
import { documentScentStrength, hasDocumentScent, markNoisyDocument } from '../document_scent';
import { drainLineCell, getBoundedWetConnection, wetTerrainAtEntity, wetTerrainCell, wetWaterCell } from '../monster_terrain';
import { isPlayerEntity } from '../player_actor';
import { damageBorshchevikRootSite, releaseBorshchevikSeedPuff } from '../borshchevik';
import {
  BLOOD_PLANT_HEAL_SCAN_SEC,
  BLOOD_PLANT_TENDRIL_MAX_CELLS,
  BLOOD_PLANT_TENDRIL_RANGE,
  healBloodPlantFromRedMold,
  traceBloodPlantTendrilCells,
} from '../blood_plant';
import { updateMatkaSource } from '../matka_source';
import {
  CHERVIE_NET_SOURCE_RADIUS,
  PANELNIK_OPEN_SLOW_MULT,
  PANELNIK_OPEN_SLOW_SEC,
  findChervieNetSource,
  monsterWallContext,
  panelnikOpenFloor,
  panelnikWallBraceActive,
} from '../monster_traits';
import { shareLocalTarget } from './monster_pack';
import { selectMeleeTarget } from '../melee_targeting';
import { findMeatChunkCell, removeVisualSlotCode } from '../../gen/visual_cell_slots';
import { isCarnivoreMonster } from '../../data/monster_ecology';

/* ── Shared combat target finder ──────────────────────────────── */
const MONSTER_DETECT = 20;
const MONSTER_MELEE_DETECT = 30;
const MONSTER_DETECT_SQ = MONSTER_DETECT * MONSTER_DETECT;
const MONSTER_MELEE_DETECT_SQ = MONSTER_MELEE_DETECT * MONSTER_MELEE_DETECT;
const IMMEDIATE_THREAT_RADIUS = 10;
const IMMEDIATE_THREAT_RADIUS_SQ = IMMEDIATE_THREAT_RADIUS * IMMEDIATE_THREAT_RADIUS;
const COMBAT_TARGET_SCAN_CAP = 80;
const IMMEDIATE_THREAT_SCAN_CAP = 40;

const OLGOY_SCENT_SCAN_CAP = 64;
const LISHENNYY_LIGHT_SCAN_CAP = 72;
const CHERNOSLIZ_SCAN_CAP = 64;
const DOCUMENT_HUNTER_SCAN_CAP = 72;
const SLEPOGLAZ_BEAM_SCAN_CAP = 96;
const PREFER_PLAYER = 15;
const PREFER_SQ = PREFER_PLAYER * PREFER_PLAYER;
const PECHATEED_DETECT_SQ = 24 * 24;
const PECHATEED_FALLBACK_SQ = 10 * 10;
const KONTORSHCHIK_DETECT_SQ = 28 * 28;
const KONTORSHCHIK_FALLBACK_SQ = 7 * 7;
const PROTOKOLNIK_DETECT_SQ = 26 * 26;
const PROTOKOLNIK_FALLBACK_SQ = 8 * 8;
const PROTOKOLNIK_PRESSURE_RANGE = 18;
const PROTOKOLNIK_PRESSURE_RANGE_SQ = PROTOKOLNIK_PRESSURE_RANGE * PROTOKOLNIK_PRESSURE_RANGE;
export const PROTOKOLNIK_PRESSURE_MAX = 100;
export const PROTOKOLNIK_PRESSURE_SAFE_CAP = 42;
const PROTOKOLNIK_PRESSURE_WARN_STEP = 25;
const PROTOKOLNIK_PRESSURE_PULSE_THRESHOLD = 35;
const PROTOKOLNIK_PRESSURE_PULSE_CD = 2.2;
const PROTOKOLNIK_PRESSURE_DECAY = 18;
const PROTOKOLNIK_CAP_DECAY = 13;
const PROTOKOLNIK_PRESSURE_PULSE_MAX = 4;
const DEBRIS_LURKER_COVER_DETECT_SQ = 22 * 22;
const DEBRIS_LURKER_EXPOSED_DETECT_SQ = 12 * 12;
const NELYUD_REVEAL_SQ = 6 * 6;
const BEZEKHIY_DETECT_SQ = 7.5 * 7.5;
const BEZEKHIY_CLOSE_REVEAL_SQ = 2.7 * 2.7;
const BEZEKHIY_LOOK_HOLD_SEC = 0.42;
const BEZEKHIY_LOOK_DOT = 0.9;
const BEZEKHIY_BACK_DOT = -0.18;
const BEZEKHIY_THRESHOLD_RADIUS_SQ = 3.2 * 3.2;
const BEZEKHIY_DOOR_SCAN_RADIUS = 3;
const BEZEKHIY_LUNGE_STEP = 2.8;
const BEZEKHIY_LUNGE_HIT_SQ = 1.55 * 1.55;
const BEZEKHIY_LUNGE_DAMAGE_MULT = 2.35;
const BLACK_LIQUIDATOR_CLOSE_REVEAL_SQ = 5.2 * 5.2;
const BLACK_LIQUIDATOR_SAMPLE_REVEAL_SQ = 14 * 14;
const BLACK_LIQUIDATOR_DOOR_REVEAL_SQ = 16 * 16;
const BLACK_LIQUIDATOR_DOOR_SCAN_RADIUS = 9;
const BLACK_LIQUIDATOR_KNOCK_RANGE_SQ = 2.15 * 2.15;
const BLACK_LIQUIDATOR_KNOCK_COOLDOWN_SEC = 9;
export const TRESKOTNIK_WINDUP_SEC = 0.35;
export const TRESKOTNIK_STAGGER_SEC = 1.35;
const TRESKOTNIK_DETECT_SQ = 18 * 18;
const TRESKOTNIK_WINDUP_RANGE = 7.5;
const TRESKOTNIK_SPRINT_SEC = 0.62;
const TRESKOTNIK_SPRINT_SPEED_MULT = 3.25;
const TRESKOTNIK_HIT_SQ = 1.35 * 1.35;
const TRESKOTNIK_BURST_DMG_MULT = 1.45;
const FALSE_PHASE_DETECT_SQ = 24 * 24;
const FALSE_PHASE_DOOR_SCAN_RADIUS = 3;
const FALSE_PHASE_DOOR_RANGE_SQ = 2.85 * 2.85;
const FALSE_PHASE_WINDUP_SEC = 0.78;
const FALSE_PHASE_ACTIVE_SEC = 0.8;
const FALSE_PHASE_COOLDOWN_SEC = 11.5;
const FALSE_PHASE_INTERRUPT_STAGGER_SEC = 1.1;
const FALSE_PHASE_INTERRUPT_WEAK_SEC = 2.4;
const FALSE_PHASE_WEAK_DAMAGE_MULT = 0.62;
const FALSE_PHASE_WEAK_MOVE_MULT = 0.72;
const DIKIY_SHOVE_RADIUS = 2.65;
const DIKIY_SHOVE_SCAN_CAP = 12;
const DIKIY_SHOVE_TRIGGER = 1.0;
const DIKIY_SHOVE_COOLDOWN_SEC = 2.4;
const DIKIY_SHOVE_STAGGER_SEC = 0.55;
const DIKIY_SHOVE_FLEE_SEC = 0.9;
const ZOMBIE_CROWD_PRESSURE_RADIUS = 2.35;
const ZOMBIE_CROWD_PRESSURE_SCAN_CAP = 10;
const ZOMBIE_CROWD_DAMAGE_BONUS = 0.12;
const ZOMBIE_DOOR_DAMAGE_BONUS = 0.2;
const ZOMBIE_CROWD_DAMAGE_CAP = 1.32;
const GREEN_DOG_PACK_RADIUS = 11;
export const GREEN_DOG_PACK_CAP = 8;
const GREEN_DOG_HOWL_COOLDOWN_SEC = 8;
const GREEN_DOG_SHARE_COOLDOWN_SEC = 0.75;
const GREEN_DOG_FEAR_SEC = 4.6;
const GREEN_DOG_FEAR_RADIUS = 18;
const GREEN_DOG_FLEE_DIST = 8;
const FOG_SHARK_FOG_THRESHOLD = 55;
export const FOG_SHARK_DRY_SPEED_MULT = 0.34;
export const FOG_SHARK_FOG_SPEED_MULT = 1.08;
const FOG_SHARK_DRY_DAMAGE_MULT = 0.55;
const FOG_SHARK_FOG_DAMAGE_MULT = 1.18;
const FOG_SHARK_DETECT_SQ = 28 * 28;
const FOG_SHARK_DRY_DETECT_SQ = 8 * 8;
const FOG_SHARK_PACK_RADIUS = 10;
export const FOG_SHARK_PACK_CAP = 6;
const FOG_SHARK_SHARE_COOLDOWN_SEC = 0.65;
const FOG_SHARK_SIGHT_COOLDOWN_SEC = 8;
const FOG_SHARK_FOG_TURN_RATE = 5.6;
const FOG_SHARK_DRY_TURN_RATE = 1.05;
export const HEAD_SLUG_REHOST_RADIUS = 5.5;
export const HEAD_SLUG_REHOST_SCAN_CAP = 16;
export const HEAD_SLUG_CORPSE_SCAN_CAP = 32;
const HEAD_SLUG_ATTACH_RANGE_SQ = 1.15 * 1.15;
const HEAD_SLUG_DETACH_HP_RATIO = 0.38;
const HEAD_SLUG_DETACHED_HP = 18;
const HEAD_SLUG_DETACHED_SPEED = 1.92;
const HEAD_SLUG_REHOST_COOLDOWN_SEC = 1.2;
const HEAD_SLUG_QUARANTINE_EVENT_COOLDOWN_SEC = 24;
export const MUKHOZHUK_COMMAND_RADIUS = 11;
export const MUKHOZHUK_COMMAND_SCAN_CAP = 16;
const MUKHOZHUK_COMMAND_COOLDOWN_SEC = 4.2;
const MUKHOZHUK_COMMAND_MAX_NPCS = 4;
const MUKHOZHUK_FOOD_SCAN_RADIUS = 26;
const MUKHOZHUK_FOOD_SCAN_CAP = 24;
const MUKHOZHUK_FOOD_SCAN_COOLDOWN_SEC = 2.6;
const MUKHOZHUK_FOOD_EAT_RANGE_SQ = 1.75 * 1.75;
const POMOYNY_ROY_BASE_DETECT_SQ = 13 * 13;
const POMOYNY_ROY_MAX_SCENT_DETECT = 34;
const POMOYNY_ROY_SLOT_RADIUS = 1.65;
const POMOYNY_ROY_SLOT_ANGLES = [Math.PI / 2, -Math.PI / 2, Math.PI * 0.78, -Math.PI * 0.78, Math.PI, Math.PI * 0.35, -Math.PI * 0.35, 0] as const;
const SWARM_DETECT_SQ = 20 * 20;
const NIGHTMARE_PRESSURE_RANGE = 7.5;
const NIGHTMARE_PRESSURE_MAX = 4;
const NIGHTMARE_PRESSURE_GAIN = 0.74;
const NIGHTMARE_PRESSURE_DECAY = 2.1;
const NIGHTMARE_HEAVY_DAMAGE_BREAK = 34;
const NIGHTMARE_HEAVY_DAMAGE_RATIO = 0.12;
const KOSTOREZ_DETECT_SQ = MONSTER_MELEE_DETECT_SQ;
const KOSTOREZ_WINDUP_RANGE = 2.25;
const KOSTOREZ_BURST_RANGE = 2.85;
const KOSTOREZ_WINDUP_SEC = 1.35;
const KOSTOREZ_STAGGER_SEC = 1.15;
const KOSTOREZ_ESCAPE_DIST = 4.0;
const SAFEGUARD_DETECT_SQ = MONSTER_MELEE_DETECT_SQ;
const SAFEGUARD_WINDUP_RANGE = 2.1;
const SAFEGUARD_BURST_RANGE = 2.6;
const SAFEGUARD_WINDUP_SEC = 0.85;
const SAFEGUARD_STAGGER_SEC = 0.9;
const SAFEGUARD_ESCAPE_DIST = 4.4;
const SOBRANNYY_WAKE_RADIUS_SQ = 5.75 * 5.75;
const SOBRANNYY_DAMAGE_WINDOW_SEC = 4.2;
const SOBRANNYY_STACK_SEC = 20;
const SOBRANNYY_MAX_STACKS = 3;
const SOBRANNYY_IDLE_CHIP_IGNORE = 8;
const SOBRANNYY_DOOR_BREAK_RANGE_SQ = 2.4 * 2.4;
const SOBRANNYY_ACTIVITY_WAKE_SEC = 2.5;
const BORSHCHEVIK_DETECT_SQ = 7.5 * 7.5;
const BORSHCHEVIK_SEED_SQ = 4.8 * 4.8;
const BORSHCHEVIK_SAP_RANGE_SQ = 1.55 * 1.55;
const BORSHCHEVIK_SEED_COOLDOWN_SEC = 5.6;
const BORSHCHEVIK_ROOT_COOLDOWN_SEC = 8.5;
const BLOOD_PLANT_TENDRIL_RANGE_SQ = BLOOD_PLANT_TENDRIL_RANGE * BLOOD_PLANT_TENDRIL_RANGE;
const OBZHIVALSHCHIK_BREACH_ANGER = 70;
const OBZHIVALSHCHIK_MAX_ANGER = 100;
const OBZHIVALSHCHIK_GROWTH_CAP = 6;
const OBZHIVALSHCHIK_GROWTH_CD = 10;
const OBZHIVALSHCHIK_SCRATCH_CD = 7;
const OBZHIVALSHCHIK_RETURN_CD = 1.2;
const ZHORNAYA_SCENT_RADIUS = 18;
const ZHORNAYA_SCENT_RADIUS_SQ = ZHORNAYA_SCENT_RADIUS * ZHORNAYA_SCENT_RADIUS;
const ZHORNAYA_DROP_SCAN_RADIUS = 15;
const ZHORNAYA_DROP_SCAN_CAP = 8;
const ZHORNAYA_CARRIER_SCAN_RADIUS = 18;
const ZHORNAYA_CARRIER_SCAN_CAP = 10;
const ZHORNAYA_LUNGE_RANGE = 6.8;
const ZHORNAYA_LUNGE_RANGE_SQ = ZHORNAYA_LUNGE_RANGE * ZHORNAYA_LUNGE_RANGE;
const ZHORNAYA_LUNGE_STEP = 4.35;
const ZHORNAYA_HIT_RANGE_SQ = 1.45 * 1.45;
const ZHORNAYA_MISS_RECOVERY_SEC = 1.45;
const ZHORNAYA_HIT_RECOVERY_SEC = 0.72;
const ZHORNAYA_MISS_COOLDOWN_SEC = 3.1;
const ZHORNAYA_SCENT_SCAN_SEC = 0.14;
const OLGOY_DETECT_RADIUS = 24;
const OLGOY_BLOOD_RADIUS = 30;
const OLGOY_CORPSE_RADIUS = 26;
const OLGOY_COMBAT_LOCK_SQ = 2.35 * 2.35;
const OLGOY_AMBUSH_RADIUS = 2;
const OLGOY_DRAG_STEP = 0.82;
const CHERNOSLIZ_REVEAL_CLOSE_SQ = 6 * 6;
const CHERNOSLIZ_LIGHT_REVEAL = 0.28;
const CHERNOSLIZ_LIGHT_RANGE = 12;
const CHERNOSLIZ_LIGHT_RANGE_SQ = CHERNOSLIZ_LIGHT_RANGE * CHERNOSLIZ_LIGHT_RANGE;
const CHERNOSLIZ_WATER_DETECT_SQ = 18 * 18;
const CHERNOSLIZ_DRY_DETECT_SQ = 10 * 10;
const CHERNOSLIZ_WINDUP_SEC = 0.55;
const WATER_STRIDER_RIPPLE_SEC = 0.75;
const LOTOCHNIK_WET_REGEN_PER_SEC = 1.35;
const EYE_MIN_RANGE = 1.5;
const EYE_WINDUP_SEC = 0.85;
const RANGED_SHOT_RANGE = 15;
const RANGED_LOS_BREAK_COOLDOWN = 0.75;
const PAUPSINA_WEB_SHOT_RANGE = 11.5;
const PAUPSINA_WEB_MIN_RANGE = 3.4;
const PAUPSINA_WEB_WINDUP_SEC = 0.48;
const PAUPSINA_WEB_STRAFE_RANGE = 7.25;
const KANTSELYARSKIY_IDOL_DETECT_SQ = 23 * 23;
const KANTSELYARSKIY_IDOL_BASE_RANGE = 14.5;
const KANTSELYARSKIY_IDOL_MIN_RANGE = 2.35;
const KANTSELYARSKIY_IDOL_WINDUP_SEC = 1.12;
const SLEPOGLAZ_SHOT_RANGE = 18;
const SLEPOGLAZ_MIN_RANGE = 2.0;
const SLEPOGLAZ_WINDUP_SEC = 1.15;
const SLEPOGLAZ_BEAM_WIDTH = 0.68;
const SLEPOGLAZ_RECOVERY_SEC = 1.55;
const SLEPOGLAZ_NOISE_HEARING_MULT = 1.45;
const SLEPOGLAZ_MELEE_DMG = 7;
const SLEPOGLAZ_MELEE_RATE = 1.25;
const LAMPOGLAZ_SHOT_RANGE = 17;
const LAMPOGLAZ_MIN_RANGE = 0.9;
const LAMPOGLAZ_LIGHT_LOCK = 0.24;
const LAMPOGLAZ_HARD_LOCK = 0.52;
const LAMPOGLAZ_WINDUP_SEC = 0.95;
const LAMPOGLAZ_HARD_WINDUP_SEC = 0.58;
const LAMPOGLAZ_LOCK_DMG_MULT = 1.28;
const LAMPOGLAZ_HARD_LOCK_DMG_MULT = 1.72;
const PARAGRAPH_WINDUP_SEC = 0.8;
const IDOL_WINDUP_SEC = 1.05;
const ROBOT_WINDUP_SEC = 0.62;
export const TRUBNYY_WET_LINE_MAX_CELLS = 18;
export const TRUBNYY_WET_LINE_WINDUP_SEC = 1.05;
export const TRUBNYY_WET_LINE_RECOVERY_SEC = 2.75;
const TRUBNYY_WET_LINE_MIN_RANGE = 2.25;
const TRUBNYY_WET_LINE_ALIGN_EPS = 0.68;
export const VODYANOY_WET_LINE_MAX_CELLS = 160;
export const VODYANOY_WET_LINE_MAX_DIST = 28;
export const VODYANOY_WET_LINE_SCAN_SEC = 0.35;
export const VODYANOY_WET_LINE_DRY_BREAK_SEC = 0.7;
export const VODYANOY_WET_LINE_PRESSURE_MAX = 6;
const VODYANOY_WET_LINE_PULSE_SEC = 0.65;
const HEAVY_RANGED_WINDUP_SEC = 0.95;
const GENERIC_RANGED_WINDUP_SEC = 0.7;
const SHADOW_WARNING_RANGE_SQ = 5.5 * 5.5;
const SHADOW_WINDUP_SEC = 0.55;
const SHADOW_STRIKE_BREAK_RANGE = 1.65;
const SHADOW_LIGHT_SAFE = 0.34;
const SHADOW_DARK_LIGHT = 0.18;
const SHADOW_CANCEL_COOLDOWN = 0.65;
const LISHENNYY_DETECT_RADIUS = 30;
const LISHENNYY_DETECT_SQ = LISHENNYY_DETECT_RADIUS * LISHENNYY_DETECT_RADIUS;
const LISHENNYY_FEATURE_SCAN_RADIUS = 12;
const LISHENNYY_LIGHT_MIN = 0.2;
const LISHENNYY_BRIGHT_AVOID = 0.56;
const LISHENNYY_SCAN_SEC = 0.62;
const LISHENNYY_CONTACT_DRAIN = 4;
const TUMANNIK_FOG_MIN = 44;
const TUMANNIK_FOG_TARGET_MIN = 24;
const TUMANNIK_LIGHT_REVEAL = 0.28;
const TUMANNIK_OFFSET_DIST = 1.85;
const TUMANNIK_OFFSET_REFRESH_SEC = 2.8;
const TUMANNIK_COLLAPSE_SEC = 2.4;
const TUMANNIK_STRIKE_RANGE_SQ = 1.55 * 1.55;
const TUMANNIK_STRIKE_DMG_MULT = 1.35;
const TUMANNIK_OFFSET_CUE_COOLDOWN = 5.5;
const GLUB_SECOND_BEAT_ARM_RANGE_SQ = 4.6 * 4.6;
const GLUB_SECOND_BEAT_TRIGGER_SQ = 1.85 * 1.85;
const GLUB_SECOND_BEAT_HOLD_SQ = 0.58 * 0.58;
const GLUB_SECOND_BEAT_HOLD_SEC = 0.72;
const GLUB_SECOND_BEAT_ARM_SEC = 2.2;
const GLUB_SECOND_BEAT_DODGE = 2.6;
const GLUB_SECOND_BEAT_LIGHT_SAFE = 0.32;
const GLUB_SECOND_BEAT_DMG_MULT = 1.75;
const GLUB_SECOND_BEAT_COOLDOWN = 2.25;
const TONKAYA_BAIT_SCAN_RADIUS = 10;
const TONKAYA_BAIT_SCAN_RADIUS_SQ = TONKAYA_BAIT_SCAN_RADIUS * TONKAYA_BAIT_SCAN_RADIUS;
const TONKAYA_BAIT_MAX_VISIBLE = 15;
const TONKAYA_BAIT_MIN_TARGET_SQ = 3.2 * 3.2;
const TONKAYA_BAIT_MAX_TARGET_SQ = 13 * 13;
const TONKAYA_LINE_HALF_LEN = 5.5;
const TONKAYA_LINE_PERP = 0.72;
const TONKAYA_NERVE_SEC = 5.6;
const TONKAYA_REPOSITION_CD = 0.8;
const TONKAYA_FLANK_RANGE = 7.5;
const TONKAYA_FLANK_MULT = 2.9;
const RZHAVNIK_CLOSE_WAKE_SQ = 2.45 * 2.45;
const RZHAVNIK_LEAP_WINDUP_SEC = 0.28;
const RZHAVNIK_LEAP_STEP = 4.6;
const RZHAVNIK_LEAP_HIT_SQ = 1.42 * 1.42;
const RZHAVNIK_LEAP_DAMAGE_MULT = 1.85;
const RZHAVNIK_FRAGILE_HP_MULT = 0.58;
const RZHAVNIK_FRAGILE_DMG_MULT = 0.72;
const PANELNIK_BRACE_REACH = 1.75;
const PANELNIK_OPEN_REACH = 1.16;
const PANELNIK_BRACE_CUE_COOLDOWN_SEC = 4.2;
const WALL_BIAS_CUE_COOLDOWN_SEC = 5.2;
const SLIME_WOMAN_RESIDUE_COOLDOWN_SEC = 2.4;
const SLIME_WOMAN_RESIDUE_DURATION_SEC = 18;
const SLIME_WOMAN_DRY_EVENT_COOLDOWN_SEC = 7;
const KOSTOREZ_RUMOR_IDS = [
  'monster_kostorez_cuts',
  'ecology_kostorez_windup',
  'ecology_kostorez_shotgun',
  'lead_maintenance_kostorez_locker',
] as const;
const SAFEGUARD_RUMOR_IDS = [
  'monster_safeguard_access_denied',
  'ecology_safeguard_windup',
  'ecology_safeguard_shotgun',
] as const;
const EYE_RUMOR_IDS = ['monster_eye_lamps', 'ecology_eye_line'] as const;
const CHERNOSLIZ_RUMOR_IDS = ['ecology_chernosliz_wake'] as const;
const VODYANOY_KOSHMAR_RUMOR_IDS = ['ecology_vodyanoy_koshmar_line'] as const;
const TVAR_RUMOR_IDS = ['monster_tvar_walls', 'ecology_tvar_wall'] as const;
const SHOVNIK_RUMOR_IDS = ['ecology_shovnik_seams'] as const;
const REBAR_RUMOR_IDS = ['monster_rebar_metal', 'ecology_rebar_still'] as const;
const BETONOED_RUMOR_IDS = ['monster_betonoed_weak_wall', 'ecology_betonoed_shortcut'] as const;
const PANELNIK_RUMOR_IDS = ['ecology_panelnik_wall'] as const;
const SLEPOGLAZ_RUMOR_IDS = ['ecology_slepoglaz_last_sound'] as const;
const LAMPOGLAZ_RUMOR_IDS = ['monster_lampoglaz_hum', 'ecology_lampoglaz_light_lock'] as const;
const GREEN_DOG_RUMOR_IDS = ['monster_green_dog_door', 'ecology_green_dog_noise'] as const;
const FOG_SHARK_RUMOR_IDS = ['monster_fog_shark_fog', 'ecology_fog_shark_fire'] as const;
const SBORKA_RUMOR_IDS = ['monster_sborka_fast', 'ecology_sborka_swarm'] as const;
const ZOMBIE_RUMOR_IDS = ['monster_zombie_human', 'ecology_zombie_neighbor'] as const;
const DIKIY_MERTVYAK_RUMOR_IDS = ['monster_dikiy_mertvyak_shove'] as const;
const POMOYNY_ROY_RUMOR_IDS = ['monster_pomoyny_roy'] as const;
const SWARM_RUMOR_IDS = ['monster_swarm_source'] as const;
const NIGHTMARE_RUMOR_IDS = ['ecology_nightmare_pressure'] as const;
const MANCOBUS_RUMOR_IDS = ['ecology_mancobus_orders'] as const;
const HERALD_RUMOR_IDS = ['ecology_herald_ceiling'] as const;
const CREATOR_RUMOR_IDS = ['ecology_creator_white'] as const;
const PARAGRAPH_RUMOR_IDS = ['ecology_paragraph_clause'] as const;
const PROTOKOLNIK_RUMOR_IDS = ['ecology_protokolnik_protocol'] as const;
const IDOL_RUMOR_IDS = ['monster_idol_static', 'ecology_idol_stares'] as const;
const KANTSELYARSKIY_IDOL_RUMOR_IDS = ['monster_kantselyarskiy_idol_line', 'ecology_kantselyarskiy_idol_office_field'] as const;
const ROBOT_RUMOR_IDS = ['ecology_robot_plasma'] as const;
const TRUBNYY_AVTOMAT_RUMOR_IDS = ['ecology_trubnyy_avtomat_wet_line'] as const;
const SHADOW_RUMOR_IDS = ['monster_shadow_silence', 'ecology_shadow_afterimage'] as const;
const TONKAYA_TEN_RUMOR_IDS = ['monster_tonkaya_ten_follow'] as const;
const GLUBINNAYA_TEN_RUMOR_IDS = ['monster_glubinnaya_ten_second_beat', 'ecology_glubinnaya_ten_afterimage'] as const;
const LISHENNYY_RUMOR_IDS = ['monster_lishennyy_light_lure', 'ecology_lishennyy_contact_decay'] as const;
const TUMANNIK_RUMOR_IDS = ['monster_tumannik_side_sound', 'ecology_tumannik_light_commit'] as const;
const LOZHNYY_DUKH_RUMOR_IDS = ['ecology_lozhnyy_dukh_door'] as const;
const RZHAVNIK_RUMOR_IDS = ['monster_rzhavnik_scrap', 'ecology_rzhavnik_first_leap'] as const;
const TRESKOTNIK_RUMOR_IDS = ['monster_treskotnik_crack_pulse', 'ecology_treskotnik_corner'] as const;
const NELYUD_RUMOR_IDS = ['ecology_nelyud_close'] as const;
const BLACK_LIQUIDATOR_RUMOR_IDS = ['monster_black_liquidator_wrong_count', 'ecology_black_liquidator_masks', 'samosbor_false_cleanup_patrol'] as const;
const MUKHOZHUK_RUMOR_IDS = ['monster_mukhozhuk_host_command', 'ecology_mukhozhuk_quarantine'] as const;
const CHERVIE_RUMOR_IDS = ['monster_chervie_avatar_screen', 'ecology_chervie_avatar_disconnect'] as const;
const SPORE_CARPET_RUMOR_IDS = ['monster_spore_carpet_lifted_corner', 'ecology_spore_carpet_fire_salt'] as const;
export const SPORE_CARPET_WAKE_RADIUS = 2.15;
export const SPORE_CARPET_PUFF_RADIUS = 3.2;
export const SPORE_CARPET_PUFF_COOLDOWN_SEC = 5.8;
export const SPORE_CARPET_FIRE_RECOIL_SEC = 2.35;
const SPORE_CARPET_WAKE_RADIUS_SQ = SPORE_CARPET_WAKE_RADIUS * SPORE_CARPET_WAKE_RADIUS;
const SPORE_CARPET_PUFF_RADIUS_SQ = SPORE_CARPET_PUFF_RADIUS * SPORE_CARPET_PUFF_RADIUS;
const SPORE_CARPET_DETECT_SQ = 17 * 17;
const SPORE_CARPET_DOOR_SCAN_RADIUS = 4;
const SPORE_CARPET_CONTAINER_WAKE_RADIUS_SQ = 4.2 * 4.2;
const SPORE_CARPET_CONTAINER_SCAN_SEC = 0.35;
const SPORE_CARPET_PUFF_TARGET_CAP = 6;
const SPORE_CARPET_FOG_CELL_CAP = 42;
export const CHERVIE_MIND_PULSE_RADIUS = 7.5;
export const CHERVIE_MIND_PULSE_CAP = 4;
export const CHERVIE_MIND_PULSE_COOLDOWN_SEC = 8.5;
const CHERVIE_MIND_PULSE_CONFUSION_SEC = 4.2;
const CHERVIE_POWERED_MOVE_MULT = 1.2;
const CHERVIE_CUT_MOVE_MULT = 0.62;
const CHERVIE_POWERED_DMG_MULT = 1.22;
const CHERVIE_CUT_DMG_MULT = 0.68;
interface BladeEliteTuning {
  kind: MonsterKind.KOSTOREZ | MonsterKind.SAFEGUARD;
  tag: string;
  rumorIds: readonly string[];
  windupRange: number;
  burstRange: number;
  windupSec: number;
  staggerSec: number;
  escapeDist: number;
  coverBlocks: boolean;
  sightMsg: string;
  windupMsg: string;
  staggerMsg: string;
  strikeVerb: string;
  counterplay: string;
}

/** Entity lookup map — set by updateAI each frame */
let _entityById = new Map<number, Entity>();
export function setEntityMap(m: Map<number, Entity>): void { _entityById = m; }

const combatQuery: Entity[] = [];
const monsterMeleeHitQuery: Entity[] = [];
const immediateTopCandidates: Entity[] = [];
const documentHunterQuery: Entity[] = [];
const chernoslizTargetQuery: Entity[] = [];
const zhornayaCarrierQuery: Entity[] = [];
const zhornayaDropQuery: Entity[] = [];
const slepoglazBeamQuery: Entity[] = [];
const dikiyCrowdQuery: Entity[] = [];
const zombieCrowdQuery: Entity[] = [];
const greenDogPackQuery: Entity[] = [];
const fogSharkPackQuery: Entity[] = [];
const headSlugHostQuery: Entity[] = [];
const mukhozhukCommandQuery: Entity[] = [];
const cherviePulseQuery: Entity[] = [];
const sporeCarpetPuffQuery: Entity[] = [];
const lishennyyLightQuery: Entity[] = [];

const lampPoweredRuntime = new WeakMap<Entity, boolean>();



interface ZhornayaScentRuntime {
  nextScanAt: number;
  scent: ZhornayaScentTarget | null;
}

const zhornayaScentRuntime = new WeakMap<Entity, ZhornayaScentRuntime>();

interface SobrannyyRuntime {
  lastHp: number;
  baseSpeed: number;
  dormant: boolean;
  hitCount: number;
  hitWindowUntil: number;
  stacks: number;
  stackUntil: number;
  isolatedUntil: number;
}

const sobrannyyRuntime = new WeakMap<Entity, SobrannyyRuntime>();
const SOBRANNYY_SLIME_TAGS = ['slime', 'toxic', 'acid', 'red_slime', 'black_slime', 'brown_slime'] as const;

interface NightmareRuntime {
  lastHp: number;
  pressure: number;
  lastBreakAt: number;
}

const nightmareRuntime = new WeakMap<Entity, NightmareRuntime>();

interface SlimeWomanRuntime {
  lastHp: number;
  lastResidueAt: number;
  lastDryEventAt: number;
}

const slimeWomanRuntime = new WeakMap<Entity, SlimeWomanRuntime>();
const SLIME_WOMAN_HAZARD_TAGS = ['slime', 'toxic', 'black_slime', 'green_slime', 'slime_woman'] as const;

interface GreenDogRuntime {
  nextHowlAt: number;
  lastHowlTargetId: number;
  nextShareAt: number;
  fearUntil: number;
  fearX: number;
  fearY: number;
  lastScaryNoiseId: number;
}

const greenDogRuntime = new WeakMap<Entity, GreenDogRuntime>();

interface FogSharkRuntime {
  nextShareAt: number;
  nextSightAt: number;
}

const fogSharkRuntime = new WeakMap<Entity, FogSharkRuntime>();

function zoneIdAt(world: World, x: number, y: number): number | undefined {
  const zid = world.zoneMap[world.idx(Math.floor(x), Math.floor(y))];
  return zid >= 0 ? zid : undefined;
}

function greenDogState(e: Entity): GreenDogRuntime {
  let state = greenDogRuntime.get(e);
  if (!state) {
    state = {
      nextHowlAt: -Infinity,
      lastHowlTargetId: -1,
      nextShareAt: -Infinity,
      fearUntil: -Infinity,
      fearX: e.x,
      fearY: e.y,
      lastScaryNoiseId: 0,
    };
    greenDogRuntime.set(e, state);
  }
  return state;
}

function fogSharkState(e: Entity): FogSharkRuntime {
  let state = fogSharkRuntime.get(e);
  if (!state) {
    state = {
      nextShareAt: -Infinity,
      nextSightAt: -Infinity,
    };
    fogSharkRuntime.set(e, state);
  }
  return state;
}

function fogSharkHasFogPressure(world: World, e: Entity): boolean {
  const x = Math.floor(e.x);
  const y = Math.floor(e.y);
  const idx = world.idx(x, y);
  if (world.fog[idx] >= FOG_SHARK_FOG_THRESHOLD) return true;
  const zid = world.zoneMap[idx];
  const zone = zid >= 0 ? world.zones[zid] : undefined;
  return zone?.fogged === true || territoryOwnerAtIndex(world, idx) === ZoneFaction.SAMOSBOR;
}

export function fogSharkMoveMultiplierForTests(world: World, e: Entity): number {
  if (e.monsterKind !== MonsterKind.FOG_SHARK || !hasAIFlag(e, 'fogSwimmer')) return 1;
  return fogSharkHasFogPressure(world, e) ? FOG_SHARK_FOG_SPEED_MULT : FOG_SHARK_DRY_SPEED_MULT;
}

function angleDelta(to: number, from: number): number {
  let d = (to - from) % (Math.PI * 2);
  if (d > Math.PI) d -= Math.PI * 2;
  if (d < -Math.PI) d += Math.PI * 2;
  return d;
}

function updateFogSharkTurn(world: World, e: Entity, target: Entity, dt: number): void {
  if (e.monsterKind !== MonsterKind.FOG_SHARK) return;
  const desired = Math.atan2(world.delta(e.y, target.y), world.delta(e.x, target.x));
  const rate = fogSharkHasFogPressure(world, e) ? FOG_SHARK_FOG_TURN_RATE : FOG_SHARK_DRY_TURN_RATE;
  const delta = angleDelta(desired, e.angle);
  const step = Math.max(-rate * dt, Math.min(rate * dt, delta));
  e.angle += step;
}

function fogSharkChaseCell(world: World, e: Entity, target: Entity): { x: number; y: number } {
  if (e.monsterKind !== MonsterKind.FOG_SHARK || !hasAIFlag(e, 'fogSwimmer')) return greenDogChaseCell(world, e, target);
  const dx = world.delta(target.x, e.x);
  const dy = world.delta(target.y, e.y);
  const dist = Math.max(0.001, Math.sqrt(dx * dx + dy * dy));
  const side = (e.id & 1) === 0 ? 1 : -1;
  const px = -dy / dist * side;
  const py = dx / dist * side;
  const back = (e.id % 3) - 1;
  const candidates = [
    { x: target.x + px * 1.45 - dx / dist * back * 0.6, y: target.y + py * 1.45 - dy / dist * back * 0.6 },
    { x: target.x - px * 1.2, y: target.y - py * 1.2 },
    { x: target.x, y: target.y },
  ];
  for (const c of candidates) {
    const x = world.wrap(Math.floor(c.x));
    const y = world.wrap(Math.floor(c.y));
    if (!world.solid(x, y)) return { x, y };
  }
  return { x: Math.floor(target.x), y: Math.floor(target.y) };
}

function fogSharkPackMember(candidate: Entity): boolean {
  return candidate.monsterKind === MonsterKind.FOG_SHARK;
}

function updateFogSharkPack(
  world: World,
  e: Entity,
  target: Entity | null,
  time: number,
  msgs: Msg[],
  playerId: number,
  state?: GameState,
): void {
  if (!target || e.monsterKind !== MonsterKind.FOG_SHARK || !hasAIFlag(e, 'fogSwimmer')) return;
  const runtime = fogSharkState(e);
  let shared = 0;
  if (runtime.nextShareAt <= time) {
    runtime.nextShareAt = time + FOG_SHARK_SHARE_COOLDOWN_SEC;
    shared = shareLocalTarget(e, target, {
      radius: FOG_SHARK_PACK_RADIUS,
      cap: FOG_SHARK_PACK_CAP,
      scratch: fogSharkPackQuery,
      context: undefined,
      predicate: fogSharkPackMember,
    });
  }

  if (runtime.nextSightAt > time) return;
  runtime.nextSightAt = time + FOG_SHARK_SIGHT_COOLDOWN_SEC;
  if (target.id === playerId) msgs.push(msg('В тумане хлопнули газовые жабры. Туманные акулы взяли стаю.', time, '#b9f'));
  playSoundAt(playFogSharkHiss, e.x, e.y);
  if (!state) return;
  publishEvent(state, {
    type: 'fog_shark_pack_sighted',
    zoneId: zoneIdAt(world, e.x, e.y),
    roomId: world.roomAt(e.x, e.y)?.id,
    x: e.x,
    y: e.y,
    actorId: e.id,
    actorName: entityDisplayName(e),
    actorFaction: e.faction,
    targetId: target.id,
    targetName: entityDisplayName(target),
    targetFaction: target.faction,
    monsterKind: MonsterKind.FOG_SHARK,
    severity: target.id === playerId ? 4 : 3,
    privacy: target.id === playerId ? 'local' : 'witnessed',
    tags: ['monster', 'fog_shark', 'pack', 'fog', 'samosbor'],
    data: {
      shared,
      radius: FOG_SHARK_PACK_RADIUS,
      fogActive: fogSharkHasFogPressure(world, e),
      counterplay: 'leave fog, close doors/corners, fire only at range',
      rumorIds: FOG_SHARK_RUMOR_IDS,
    },
  });
}

function scaryGreenDogNoise(noise: NoiseRecord): boolean {
  if (noise.source === 'explosion') return true;
  if (noise.itemId === 'shotgun' || noise.itemId === 'toz_shotgun' || noise.itemId === 'noise_can') return true;
  if (noise.tags.includes('metal') || noise.tags.includes('valve') || noise.tags.includes('pipe')) return true;
  if (noise.tags.includes('can') || noise.tags.includes('counterplay')) return true;
  return noise.source === 'weapon_fire' && noise.severity >= 4;
}

function pickGreenDogFleeCell(world: World, e: Entity, noise: NoiseRecord): { x: number; y: number } {
  const dx = world.delta(noise.x, e.x);
  const dy = world.delta(noise.y, e.y);
  const dist = Math.max(0.001, Math.sqrt(dx * dx + dy * dy));
  const base = Math.atan2(dy, dx);
  const offsets = [0, 0.45, -0.45, 0.9, -0.9, Math.PI * 0.5, -Math.PI * 0.5] as const;
  for (const offset of offsets) {
    const a = base + offset;
    for (let d = GREEN_DOG_FLEE_DIST; d >= 3; d -= 1.5) {
      const x = world.wrap(Math.floor(e.x + Math.cos(a) * d));
      const y = world.wrap(Math.floor(e.y + Math.sin(a) * d));
      if (!world.solid(x, y)) return { x, y };
    }
  }
  return {
    x: world.wrap(Math.floor(e.x + dx / dist * 3)),
    y: world.wrap(Math.floor(e.y + dy / dist * 3)),
  };
}

function publishGreenDogScared(
  state: GameState | undefined,
  world: World,
  e: Entity,
  noise: NoiseRecord,
): void {
  if (!state) return;
  publishEvent(state, {
    type: 'green_dog_scared',
    zoneId: zoneIdAt(world, e.x, e.y),
    roomId: world.roomAt(e.x, e.y)?.id,
    x: e.x,
    y: e.y,
    actorId: e.id,
    actorName: entityDisplayName(e),
    actorFaction: e.faction,
    itemId: noise.itemId,
    monsterKind: MonsterKind.GREEN_DOG,
    severity: 3,
    privacy: 'local',
    tags: ['monster', 'green_dog', 'noise_fear', noise.source, ...noise.tags.slice(0, 3)],
    data: {
      noiseId: noise.id,
      noiseSource: noise.source,
      fearSeconds: GREEN_DOG_FEAR_SEC,
      counterplay: 'loud metal, valve, noise can, shotgun',
      rumorIds: GREEN_DOG_RUMOR_IDS,
    },
  });
}

function updateGreenDogNoiseFear(
  world: World,
  e: Entity,
  dt: number,
  time: number,
  msgs: Msg[],
  state?: GameState,
): boolean {
  if (e.monsterKind !== MonsterKind.GREEN_DOG || !hasAIFlag(e, 'noiseFear')) return false;
  const runtime = greenDogState(e);
  const ai = e.ai!;
  const noise = findNoiseForActor(world, state, e, time, {
    minSeverity: 2,
    scanInterval: 0.35,
    hearingMult: 1.25,
  });
  if (
    noise &&
    noise.id !== runtime.lastScaryNoiseId &&
    scaryGreenDogNoise(noise) &&
    world.dist2(e.x, e.y, noise.x, noise.y) <= GREEN_DOG_FEAR_RADIUS * GREEN_DOG_FEAR_RADIUS
  ) {
    const flee = pickGreenDogFleeCell(world, e, noise);
    runtime.lastScaryNoiseId = noise.id;
    runtime.fearUntil = time + GREEN_DOG_FEAR_SEC + Math.min(1.2, noise.severity * 0.2);
    runtime.fearX = flee.x;
    runtime.fearY = flee.y;
    ai.combatTargetId = undefined;
    ai.path = [];
    ai.pi = 0;
    ai.timer = 0;
    e.spriteScale = 0.82;
    msgs.push(msg('Зеленая собака взвизгнула от громкого металла и рвет стаю.', time, '#9f6'));
    publishGreenDogScared(state, world, e, noise);
    playSoundAt(playGrowl, e.x, e.y);
  }

  if (runtime.fearUntil <= time) {
    if (e.spriteScale === 0.82) e.spriteScale = undefined;
    return false;
  }

  ai.goal = AIGoal.WANDER;
  ai.combatTargetId = undefined;
  ai.timer -= dt;
  if (ai.path.length === 0 || ai.timer <= 0 || ai.tx !== runtime.fearX || ai.ty !== runtime.fearY) {
    tryAssignPathToCell(world, e, runtime.fearX, runtime.fearY);
    ai.timer = 0.9;
  }
  if (ai.path.length > 0) followMonsterPath(world, e, dt);
  return true;
}

function shareGreenDogTarget(e: Entity, target: Entity, time: number): number {
  const runtime = greenDogState(e);
  if (runtime.nextShareAt > time) return 0;
  runtime.nextShareAt = time + GREEN_DOG_SHARE_COOLDOWN_SEC;
  return shareLocalTarget(e, target, {
    radius: GREEN_DOG_PACK_RADIUS,
    cap: GREEN_DOG_PACK_CAP,
    scratch: greenDogPackQuery,
    context: time,
    predicate: greenDogPackMember,
  });
}

function greenDogPackMember(dog: Entity, _actor: Entity, _target: Entity, time: number): boolean {
  return dog.monsterKind === MonsterKind.GREEN_DOG && greenDogState(dog).fearUntil <= time;
}

function publishGreenDogHowl(
  state: GameState | undefined,
  world: World,
  e: Entity,
  target: Entity,
  shared: number,
): void {
  if (!state) return;
  publishEvent(state, {
    type: 'green_dog_howl',
    zoneId: zoneIdAt(world, e.x, e.y),
    roomId: world.roomAt(e.x, e.y)?.id,
    x: e.x,
    y: e.y,
    actorId: e.id,
    actorName: entityDisplayName(e),
    actorFaction: e.faction,
    targetId: target.id,
    targetName: entityDisplayName(target),
    targetFaction: target.faction,
    monsterKind: MonsterKind.GREEN_DOG,
    severity: isPlayerEntity(target) ? 3 : 2,
    privacy: isPlayerEntity(target) ? 'local' : 'witnessed',
    tags: ['monster', 'green_dog', 'pack_howl', 'door_pressure'],
    data: {
      shared,
      radius: GREEN_DOG_PACK_RADIUS,
      counterplay: 'do not open sad door sounds; use loud metal or shotgun',
      rumorIds: GREEN_DOG_RUMOR_IDS,
    },
  });
}

function updateGreenDogPackHowl(
  world: World,
  e: Entity,
  target: Entity | null,
  time: number,
  msgs: Msg[],
  playerId: number,
  state?: GameState,
): void {
  if (!target || e.monsterKind !== MonsterKind.GREEN_DOG || !hasAIFlag(e, 'packHowl')) return;
  const runtime = greenDogState(e);
  const shared = shareGreenDogTarget(e, target, time);
  if (runtime.nextHowlAt > time && runtime.lastHowlTargetId === target.id) return;
  runtime.nextHowlAt = time + GREEN_DOG_HOWL_COOLDOWN_SEC;
  runtime.lastHowlTargetId = target.id;
  if (target.id === playerId) msgs.push(msg('За дверями и в коридоре отвечает собачий вой. Стая взяла общий запах.', time, '#9f6'));
  publishGreenDogHowl(state, world, e, target, shared);
  playSoundAt(playGrowl, e.x, e.y);
}

function greenDogChaseCell(world: World, e: Entity, target: Entity): { x: number; y: number } {
  if (hasAIFlag(e, 'garbageSurround')) return pomoynyRoyChaseCell(world, e, target);
  if (e.monsterKind !== MonsterKind.GREEN_DOG || !hasAIFlag(e, 'packHowl')) return { x: Math.floor(target.x), y: Math.floor(target.y) };
  const dx = world.delta(target.x, e.x);
  const dy = world.delta(target.y, e.y);
  const dist = Math.max(0.001, Math.sqrt(dx * dx + dy * dy));
  const side = (e.id & 1) === 0 ? 1 : -1;
  const px = -dy / dist * side;
  const py = dx / dist * side;
  const behind = ((e.id * 17) & 3) === 0 ? -1.2 : 0.35;
  const candidates = [
    { x: target.x + px * 1.7 + dx / dist * behind, y: target.y + py * 1.7 + dy / dist * behind },
    { x: target.x - px * 1.3, y: target.y - py * 1.3 },
    { x: target.x, y: target.y },
  ];
  for (const c of candidates) {
    const x = world.wrap(Math.floor(c.x));
    const y = world.wrap(Math.floor(c.y));
    if (!world.solid(x, y)) return { x, y };
  }
  return { x: Math.floor(target.x), y: Math.floor(target.y) };
}

function pomoynyRoyChaseCell(world: World, e: Entity, target: Entity): { x: number; y: number } {
  const dx = world.delta(e.x, target.x);
  const dy = world.delta(e.y, target.y);
  const base = Math.atan2(dy, dx);
  const slot = (Math.imul(e.id, 1103515245) ^ target.id) & 7;
  const angle = base + POMOYNY_ROY_SLOT_ANGLES[slot];
  const ax = Math.cos(angle);
  const ay = Math.sin(angle);
  let x = world.wrap(Math.floor(target.x + ax * POMOYNY_ROY_SLOT_RADIUS));
  let y = world.wrap(Math.floor(target.y + ay * POMOYNY_ROY_SLOT_RADIUS));
  if (!world.solid(x, y)) return { x, y };
  x = world.wrap(Math.floor(target.x - ax * 1.15));
  y = world.wrap(Math.floor(target.y - ay * 1.15));
  if (!world.solid(x, y)) return { x, y };
  return { x: Math.floor(target.x), y: Math.floor(target.y) };
}

function mukhozhukChaseCell(world: World, e: Entity, target: Entity): { x: number; y: number } {
  if (e.monsterKind !== MonsterKind.MUKHOZHUK_HOST || !hasAIFlag(e, 'parasiteLeader')) return greenDogChaseCell(world, e, target);
  const dx = world.delta(target.x, e.x);
  const dy = world.delta(target.y, e.y);
  const dist = Math.max(0.001, Math.sqrt(dx * dx + dy * dy));
  const side = ((e.id + Math.floor((e.ai?.parasiteCommandCd ?? 0) * 10)) & 1) === 0 ? 1 : -1;
  const px = -dy / dist * side;
  const py = dx / dist * side;
  const wobble = 0.8 + ((e.id >> 1) & 3) * 0.25;
  const candidates = [
    { x: target.x + px * wobble, y: target.y + py * wobble },
    { x: target.x - px * 0.8, y: target.y - py * 0.8 },
    { x: target.x, y: target.y },
  ];
  for (const c of candidates) {
    const x = world.wrap(Math.floor(c.x));
    const y = world.wrap(Math.floor(c.y));
    if (!world.solid(x, y)) return { x, y };
  }
  return { x: Math.floor(target.x), y: Math.floor(target.y) };
}

function isHeadSlugDetached(e: Entity): boolean {
  return e.monsterKind === MonsterKind.HEAD_SLUG && e.monsterStage === HEAD_SLUG_DETACHED_STAGE;
}

function headSlugHostSkill(host: Entity): number {
  const level = host.rpg?.level ?? 1;
  const speed = host.speed > 0 ? host.speed : 0.75;
  return Math.max(0.82, Math.min(1.38, 0.74 + speed * 0.34 + level * 0.025));
}

function publishHeadSlugEvent(
  state: GameState | undefined,
  world: World,
  slug: Entity,
  target: Entity | undefined,
  type: 'head_slug_detached' | 'head_slug_rehosted' | 'head_slug_quarantined',
  severity: 3 | 4 | 5,
  tags: string[],
  data?: Record<string, unknown>,
): void {
  if (!state) return;
  publishEvent(state, {
    type,
    zoneId: zoneIdAt(world, slug.x, slug.y),
    roomId: world.roomAt(slug.x, slug.y)?.id,
    x: slug.x,
    y: slug.y,
    actorId: slug.id,
    actorName: entityDisplayName(slug),
    actorFaction: slug.faction,
    targetId: target?.id,
    targetName: target ? entityDisplayName(target) : undefined,
    targetFaction: target?.faction,
    monsterKind: MonsterKind.HEAD_SLUG,
    severity,
    privacy: 'local',
    tags: ['monster', 'head_slug', 'parasite', ...tags],
    data: {
      counterplay: MONSTERS[MonsterKind.HEAD_SLUG]?.counterplay,
      rumorIds: ['monster_head_slug_host', 'ecology_head_slug_rehost'],
      ...data,
    },
  });
}

function detachHeadSlug(
  world: World,
  slug: Entity,
  time: number,
  msgs: Msg[],
  state?: GameState,
  reason = 'host_body_failed',
): void {
  const ai = slug.ai!;
  slug.monsterStage = HEAD_SLUG_DETACHED_STAGE;
  slug.name = undefined;
  slug.maxHp = HEAD_SLUG_DETACHED_HP;
  slug.hp = Math.max(6, Math.min(HEAD_SLUG_DETACHED_HP, slug.hp ?? HEAD_SLUG_DETACHED_HP));
  slug.speed = HEAD_SLUG_DETACHED_SPEED;
  slug.spriteScale = 0.58;
  slug.spriteZ = 0.08;
  slug.parasiteHostSkill = undefined;
  slug.attackCd = Math.max(slug.attackCd ?? 0, 0.65);
  ai.combatTargetId = undefined;
  ai.path = [];
  ai.pi = 0;
  ai.timer = 0;
  ai.parasiteRehostCd = 0;
  stampMark(world, Math.floor(slug.x), Math.floor(slug.y), 0.5, 0.5, 0.35, MarkType.SPLAT, slug.id ^ 0x51a6, 112, 62, 76, 125);
  msgs.push(msg('Головной слизень сорвался с шеи и ищет новое тело. Добейте его до переползания.', time, '#f8b'));
  publishHeadSlugEvent(state, world, slug, undefined, 'head_slug_detached', 4, ['detached', reason], {
    reason,
    rehostRadius: HEAD_SLUG_REHOST_RADIUS,
    scanCap: HEAD_SLUG_REHOST_SCAN_CAP,
  });
}

function canHeadSlugUseLiveHost(host: Entity): boolean {
  if (!host.alive || host.type !== EntityType.NPC) return false;
  return (host.ai?.staggerTimer ?? 0) > 0.15;
}

function canHeadSlugUseCorpse(host: Entity): boolean {
  return !host.alive && host.type === EntityType.NPC;
}

function findHeadSlugLiveHost(world: World, slug: Entity): Entity | null {
  let best: Entity | null = null;
  let bestD2 = HEAD_SLUG_REHOST_RADIUS * HEAD_SLUG_REHOST_RADIUS;
  getEntityIndex().queryRadiusCapped(
    slug.x,
    slug.y,
    HEAD_SLUG_REHOST_RADIUS,
    headSlugHostQuery,
    ENTITY_MASK_ACTOR,
    HEAD_SLUG_REHOST_SCAN_CAP,
  );
  for (const host of headSlugHostQuery) {
    if (host.id === slug.id || !canHeadSlugUseLiveHost(host)) continue;
    const d2 = world.dist2(slug.x, slug.y, host.x, host.y);
    if (d2 >= bestD2) continue;
    best = host;
    bestD2 = d2;
  }
  return best;
}

function findHeadSlugCorpseHost(world: World, entities: readonly Entity[], slug: Entity): Entity | null {
  if (entities.length === 0) return null;
  const ai = slug.ai!;
  const start = Math.max(0, Math.min(entities.length - 1, ai.parasiteScanOffset ?? (slug.id % entities.length)));
  let best: Entity | null = null;
  let bestD2 = HEAD_SLUG_REHOST_RADIUS * HEAD_SLUG_REHOST_RADIUS;
  let scanned = 0;
  for (let i = 0; i < entities.length && scanned < HEAD_SLUG_CORPSE_SCAN_CAP; i++) {
    const host = entities[(start + i) % entities.length];
    scanned++;
    if (host.id === slug.id || !canHeadSlugUseCorpse(host)) continue;
    const d2 = world.dist2(slug.x, slug.y, host.x, host.y);
    if (d2 >= bestD2) continue;
    best = host;
    bestD2 = d2;
  }
  ai.parasiteScanOffset = (start + scanned) % entities.length;
  return best;
}

export function findHeadSlugRehostTarget(world: World, entities: readonly Entity[], slug: Entity): Entity | null {
  if (!isHeadSlugDetached(slug)) return null;
  return findHeadSlugLiveHost(world, slug) ?? findHeadSlugCorpseHost(world, entities, slug);
}

function rehostHeadSlug(
  world: World,
  entities: Entity[],
  slug: Entity,
  host: Entity,
  time: number,
  msgs: Msg[],
  nextId: { v: number },
  state?: GameState,
): void {
  const def = MONSTERS[MonsterKind.HEAD_SLUG];
  const skill = headSlugHostSkill(host);
  const hostWasAlive = host.alive;
  if (host.alive) {
    host.alive = false;
    host.hp = 0;
    spawnDeathPool(world, host.x, host.y, false);
    dropNpcInventory(host, entities, nextId);
  }

  slug.monsterStage = HEAD_SLUG_HOSTED_STAGE;
  slug.x = host.x;
  slug.y = host.y;
  slug.angle = host.angle;
  slug.name = `${host.name ?? 'Носитель'}: головной слизень`;
  slug.faction = host.faction;
  slug.occupation = host.occupation;
  slug.isFemale = host.isFemale;
  slug.parasiteHostSkill = skill;
  slug.speed = def.speed * skill;
  slug.maxHp = Math.max(32, Math.round(def.hp * (0.7 + skill * 0.22)));
  slug.hp = Math.max(slug.hp ?? 1, Math.round(slug.maxHp * 0.58));
  slug.spriteScale = undefined;
  slug.spriteZ = undefined;
  slug.attackCd = Math.max(slug.attackCd ?? 0, 0.8);
  if (slug.ai) {
    slug.ai.combatTargetId = undefined;
    slug.ai.path = [];
    slug.ai.pi = 0;
    slug.ai.timer = 0;
    slug.ai.parasiteRehostCd = HEAD_SLUG_REHOST_COOLDOWN_SEC;
  }
  msgs.push(msg(`Головной слизень переполз в ${host.name ?? 'тело'}.`, time, '#f8b'));
  publishHeadSlugEvent(state, world, slug, host, 'head_slug_rehosted', 5, ['rehosted', hostWasAlive ? 'stunned_host' : 'corpse_host'], {
    hostSkill: Math.round(skill * 100) / 100,
    hostWasAlive,
    rehostCooldown: HEAD_SLUG_REHOST_COOLDOWN_SEC,
  });
}

function headSlugQuarantineCell(world: World, slug: Entity): boolean {
  const room = world.roomAt(slug.x, slug.y);
  if (room?.sealed) return true;
  const sx = Math.floor(slug.x);
  const sy = Math.floor(slug.y);
  for (let dy = -3; dy <= 3; dy++) {
    for (let dx = -3; dx <= 3; dx++) {
      const ci = world.idx(sx + dx, sy + dy);
      const door = world.doors.get(ci);
      if (!door) continue;
      if (door.state === DoorState.HERMETIC_CLOSED || door.state === DoorState.LOCKED) return true;
    }
  }
  return room?.type === RoomType.MEDICAL;
}

function updateHeadSlugParasite(
  world: World,
  entities: Entity[],
  slug: Entity,
  dt: number,
  time: number,
  msgs: Msg[],
  nextId: { v: number },
  state?: GameState,
): boolean {
  if (slug.monsterKind !== MonsterKind.HEAD_SLUG || !slug.ai) return false;
  const ai = slug.ai;
  if (slug.monsterStage === undefined) slug.monsterStage = HEAD_SLUG_HOSTED_STAGE;
  ai.parasiteRehostCd = Math.max(0, (ai.parasiteRehostCd ?? 0) - dt);
  ai.parasiteQuarantineCd = Math.max(0, (ai.parasiteQuarantineCd ?? 0) - dt);

  if (slug.monsterStage === HEAD_SLUG_HOSTED_STAGE) {
    const maxHp = Math.max(1, slug.maxHp ?? MONSTERS[MonsterKind.HEAD_SLUG].hp);
    if ((slug.hp ?? maxHp) > 0 && (slug.hp ?? maxHp) <= maxHp * HEAD_SLUG_DETACH_HP_RATIO) {
      detachHeadSlug(world, slug, time, msgs, state);
      return true;
    }
    if (slug.parasiteHostSkill !== undefined) slug.speed = MONSTERS[MonsterKind.HEAD_SLUG].speed * slug.parasiteHostSkill;
    return false;
  }

  slug.speed = HEAD_SLUG_DETACHED_SPEED;
  slug.spriteScale = 0.58;
  slug.spriteZ = 0.08;
  if (ai.parasiteRehostCd <= 0) {
    ai.parasiteRehostCd = HEAD_SLUG_REHOST_COOLDOWN_SEC;
    const host = findHeadSlugRehostTarget(world, entities, slug);
    if (host) {
      if (world.dist2(slug.x, slug.y, host.x, host.y) <= HEAD_SLUG_ATTACH_RANGE_SQ) {
        rehostHeadSlug(world, entities, slug, host, time, msgs, nextId, state);
        return true;
      }
      ai.goal = AIGoal.HUNT;
      ai.combatTargetId = undefined;
      ai.timer -= dt;
      if (ai.path.length === 0 || ai.pi >= ai.path.length || ai.timer <= 0) {
        tryAssignPathToCell(world, slug, Math.floor(host.x), Math.floor(host.y));
        ai.timer = 0.35;
      }
      followMonsterPath(world, slug, dt);
      return true;
    }
    if (ai.parasiteQuarantineCd <= 0 && headSlugQuarantineCell(world, slug)) {
      ai.parasiteQuarantineCd = HEAD_SLUG_QUARANTINE_EVENT_COOLDOWN_SEC;
      publishHeadSlugEvent(state, world, slug, undefined, 'head_slug_quarantined', 3, ['quarantine', 'sealed_room'], {
        rehostRadius: HEAD_SLUG_REHOST_RADIUS,
      });
    }
  }
  return false;
}

function publishMukhozhukEvent(
  state: GameState | undefined,
  world: World,
  e: Entity,
  target: Entity | undefined,
  type: 'mukhozhuk_exposed' | 'mukhozhuk_food_spoiled',
  severity: 3 | 4 | 5,
  tags: string[],
  data?: Record<string, unknown>,
): void {
  if (!state) return;
  publishEvent(state, {
    type,
    zoneId: zoneIdAt(world, e.x, e.y),
    roomId: world.roomAt(e.x, e.y)?.id,
    x: e.x,
    y: e.y,
    actorId: e.id,
    actorName: entityDisplayName(e),
    actorFaction: e.faction,
    targetId: target?.id,
    targetName: target ? entityDisplayName(target) : undefined,
    targetFaction: target?.faction,
    containerId: typeof data?.containerId === 'number' ? data.containerId : undefined,
    monsterKind: MonsterKind.MUKHOZHUK_HOST,
    severity,
    privacy: isPlayerEntity(target) ? 'local' : 'witnessed',
    tags: ['monster', 'mukhozhuk', 'parasite_leader', ...tags],
    data: {
      counterplay: MONSTERS[MonsterKind.MUKHOZHUK_HOST]?.counterplay,
      rumorIds: MUKHOZHUK_RUMOR_IDS,
      commandRadius: MUKHOZHUK_COMMAND_RADIUS,
      commandScanCap: MUKHOZHUK_COMMAND_SCAN_CAP,
      ...data,
    },
  });
}

function ensureMukhozhukExposed(
  world: World,
  e: Entity,
  time: number,
  msgs: Msg[],
  player: Entity | undefined,
  state?: GameState,
): void {
  if (e.monsterKind !== MonsterKind.MUKHOZHUK_HOST || !hasAIFlag(e, 'parasiteLeader') || !e.ai) return;
  if (e.ai.parasiteExposed) return;
  e.ai.parasiteExposed = true;
  const seenByPlayer = !!player?.alive && world.dist2(e.x, e.y, player.x, player.y) <= 22 * 22;
  if (seenByPlayer) {
    msgs.push(msg('Под воротником начальника шевельнулся хитин. Это уже не приказ, а носитель.', time, '#ce8'));
  }
  publishMukhozhukEvent(state, world, e, seenByPlayer ? player : undefined, 'mukhozhuk_exposed', 4, ['exposed'], {
    counterplayDecision: 'expose_quarantine_assassinate_or_flee',
  });
}

function mukhozhukCommandableNpc(npc: Entity, target: Entity): boolean {
  if (!npc.alive || npc.type !== EntityType.NPC || !npc.ai || npc.id === target.id) return false;
  if ((npc.maxHp ?? npc.hp ?? 60) > 130 || (npc.rpg?.level ?? 1) > 6) return false;
  if (npc.plotNpcId !== undefined) return false;
  const guard = npc.faction === Faction.LIQUIDATOR ||
    npc.faction === Faction.WILD ||
    occupationHasProfileTag(npc.occupation, 'combat');
  const cult = npc.faction === Faction.CULTIST || occupationHasProfileTag(npc.occupation, 'cult');
  return guard || cult || isHostile(npc, target);
}

export function commandMukhozhukNearby(
  world: World,
  e: Entity,
  target: Entity,
  time: number,
  msgs: Msg[],
  state?: GameState,
): number {
  if (e.monsterKind !== MonsterKind.MUKHOZHUK_HOST || !hasAIFlag(e, 'parasiteLeader') || !target.alive || !canBeMonsterTarget(target)) return 0;
  getEntityIndex().queryRadiusCapped(e.x, e.y, MUKHOZHUK_COMMAND_RADIUS, mukhozhukCommandQuery, ENTITY_MASK_NPC, MUKHOZHUK_COMMAND_SCAN_CAP);
  let commanded = 0;
  for (const npc of mukhozhukCommandQuery) {
    if (commanded >= MUKHOZHUK_COMMAND_MAX_NPCS) break;
    if (!mukhozhukCommandableNpc(npc, target)) continue;
    npc.ai!.goal = AIGoal.HUNT;
    npc.ai!.combatTargetId = target.id;
    npc.ai!.timer = 0;
    npc.ai!.path.length = 0;
    npc.ai!.pi = 0;
    if (isPlayerEntity(target)) {
      const previous = npc.playerRelation ?? 0;
      const next = Math.min(previous, -70);
      npc.playerRelation = next;
      if (state && npc.alifeId !== undefined && next !== previous) {
        applyDemosRelationDelta(state, npc.alifeId, { targetKind: 'player' }, next - previous, {
          reasonTag: 'mukhozhuk_command',
        });
      }
    }
    commanded++;
  }
  if (commanded <= 0) return 0;
  msgs.push(msg(`Мухожук выкрикнул чужой приказ. Подчинились: ${commanded}.`, time, '#ce8'));
  publishMukhozhukEvent(state, world, e, target, 'mukhozhuk_exposed', 4, ['command_pulse'], {
    commandedCount: commanded,
    capped: mukhozhukCommandQuery.length >= MUKHOZHUK_COMMAND_SCAN_CAP,
    target: entityDisplayName(target),
  });
  return commanded;
}

function updateMukhozhukLeader(
  world: World,
  e: Entity,
  target: Entity | null,
  dt: number,
  time: number,
  msgs: Msg[],
  state?: GameState,
): void {
  if (e.monsterKind !== MonsterKind.MUKHOZHUK_HOST || !hasAIFlag(e, 'parasiteLeader') || !e.ai) return;
  const ai = e.ai;
  ai.parasiteCommandCd = Math.max(0, (ai.parasiteCommandCd ?? 0) - dt);
  if (!target?.alive || ai.parasiteCommandCd > 0) return;
  ai.parasiteCommandCd = MUKHOZHUK_COMMAND_COOLDOWN_SEC + ((e.id & 3) * 0.35);
  commandMukhozhukNearby(world, e, target, time, msgs, state);
}

function mukhozhukFoodItem(defId: string): boolean {
  if (defId === 'sand_spoiled_ration') return false;
  if (defId === 'alcohol_bottle') return true;
  const def = ITEMS[defId];
  if (!def) return false;
  if (def.type === ItemType.FOOD || def.type === ItemType.DRINK) return true;
  const tags = ITEM_TAGS[defId] ?? def.tags ?? [];
  return tags.includes('bait') || tags.includes('ration') || tags.includes('drink') || tags.includes('food');
}

function containerHasMukhozhukFood(container: WorldContainer): boolean {
  return container.inventory.some(item => item.count > 0 && mukhozhukFoodItem(item.defId));
}

function addSpoiledRation(container: WorldContainer): void {
  const def = ITEMS.sand_spoiled_ration;
  if (!def) return;
  const stackMax = getStack(def);
  const existing = container.inventory.find(item => item.defId === 'sand_spoiled_ration' && item.data === undefined && item.count < stackMax);
  if (existing) {
    existing.count++;
  } else if (container.inventory.length < container.capacitySlots) {
    container.inventory.push({ defId: 'sand_spoiled_ration', count: 1 });
  }
  if (!container.tags.includes('mukhozhuk_spoiled')) container.tags.push('mukhozhuk_spoiled');
}

function spoilMukhozhukFood(container: WorldContainer): string | undefined {
  for (let i = 0; i < container.inventory.length; i++) {
    const item = container.inventory[i];
    if (item.count <= 0 || !mukhozhukFoodItem(item.defId)) continue;
    const spoiledFrom = item.defId;
    item.count--;
    if (item.count <= 0) container.inventory.splice(i, 1);
    addSpoiledRation(container);
    return spoiledFrom;
  }
  return undefined;
}

function validMukhozhukFoodContainer(
  world: World,
  e: Entity,
  container: WorldContainer | undefined,
  state?: GameState,
): container is WorldContainer {
  if (!container) return false;
  if (state && container.floor !== state.currentFloor) return false;
  if (!containerHasMukhozhukFood(container)) return false;
  return world.dist2(e.x, e.y, container.x + 0.5, container.y + 0.5) <= MUKHOZHUK_FOOD_SCAN_RADIUS * MUKHOZHUK_FOOD_SCAN_RADIUS;
}

function findMukhozhukFoodContainer(world: World, e: Entity, dt: number, state?: GameState): WorldContainer | null {
  const ai = e.ai!;
  const cached = ai.parasiteFoodTargetContainerId !== undefined
    ? world.containerById.get(ai.parasiteFoodTargetContainerId)
    : undefined;
  if (validMukhozhukFoodContainer(world, e, cached, state)) return cached;
  ai.parasiteFoodTargetContainerId = undefined;

  ai.parasiteFoodScanCd = Math.max(0, (ai.parasiteFoodScanCd ?? 0) - dt);
  const total = world.containers.length;
  if (total === 0 || (ai.parasiteFoodScanCd ?? 0) > 0) return null;
  ai.parasiteFoodScanCd = MUKHOZHUK_FOOD_SCAN_COOLDOWN_SEC;

  const start = Math.max(0, Math.min(total - 1, ai.parasiteFoodScanOffset ?? (e.id % total)));
  const limit = Math.min(total, MUKHOZHUK_FOOD_SCAN_CAP);
  ai.parasiteFoodScanOffset = (start + limit) % total;
  let best: WorldContainer | null = null;
  let bestD2 = MUKHOZHUK_FOOD_SCAN_RADIUS * MUKHOZHUK_FOOD_SCAN_RADIUS;
  for (let i = 0; i < limit; i++) {
    const container = world.containers[(start + i) % total];
    if (state && container.floor !== state.currentFloor) continue;
    if (!containerHasMukhozhukFood(container)) continue;
    const d2 = world.dist2(e.x, e.y, container.x + 0.5, container.y + 0.5);
    if (d2 >= bestD2) continue;
    best = container;
    bestD2 = d2;
  }
  if (best) ai.parasiteFoodTargetContainerId = best.id;
  return best;
}

function tryMukhozhukFoodAppetite(
  world: World,
  e: Entity,
  dt: number,
  time: number,
  msgs: Msg[],
  state?: GameState,
): boolean {
  if (e.monsterKind !== MonsterKind.MUKHOZHUK_HOST || !hasAIFlag(e, 'parasiteLeader') || !e.ai) return false;
  const ai = e.ai;
  const container = findMukhozhukFoodContainer(world, e, dt, state);
  if (!container) return false;

  ai.goal = AIGoal.EAT;
  ai.combatTargetId = undefined;
  const tx = container.x + 0.5;
  const ty = container.y + 0.5;
  if (world.dist2(e.x, e.y, tx, ty) <= MUKHOZHUK_FOOD_EAT_RANGE_SQ) {
    const spoiledFrom = spoilMukhozhukFood(container);
    ai.parasiteFoodTargetContainerId = containerHasMukhozhukFood(container) ? container.id : undefined;
    ai.parasiteFoodScanCd = MUKHOZHUK_FOOD_SCAN_COOLDOWN_SEC;
    e.attackCd = Math.max(e.attackCd ?? 0, 0.8);
    if (spoiledFrom) {
      const itemName = ITEMS[spoiledFrom]?.name ?? spoiledFrom;
      msgs.push(msg(`Мухожук испортил запас: ${itemName}.`, time, '#d9a'));
      publishMukhozhukEvent(state, world, e, undefined, 'mukhozhuk_food_spoiled', 3, ['food_spoiled', 'container'], {
        containerId: container.id,
        containerName: container.name,
        spoiledItemId: spoiledFrom,
        spoiledItemName: itemName,
      });
    }
    return true;
  }

  ai.timer -= dt;
  if (ai.path.length === 0 || ai.pi >= ai.path.length || ai.timer <= 0 || ai.tx !== container.x || ai.ty !== container.y) {
    tryAssignPathToCell(world, e, container.x, container.y);
    ai.timer = 1.1;
  }
  const oldSpeed = e.speed;
  e.speed = oldSpeed * 0.72;
  if (ai.path.length > 0) followMonsterPath(world, e, dt);
  e.speed = oldSpeed;
  return true;
}

function sobrannyyState(e: Entity): SobrannyyRuntime {
  const hp = Math.max(1, e.hp ?? e.maxHp ?? 1);
  let state = sobrannyyRuntime.get(e);
  if (!state) {
    state = {
      lastHp: hp,
      baseSpeed: e.speed,
      dormant: true,
      hitCount: 0,
      hitWindowUntil: 0,
      stacks: 0,
      stackUntil: 0,
      isolatedUntil: 0,
    };
    sobrannyyRuntime.set(e, state);
  }
  return state;
}

function publishSobrannyyEvent(
  state: GameState | undefined,
  world: World,
  e: Entity,
  target: Entity | undefined,
  type: 'composite_woke' | 'composite_growth' | 'composite_isolated',
  severity: 3 | 4 | 5,
  tags: string[],
  data?: Record<string, unknown>,
): void {
  if (!state) return;
  publishEvent(state, {
    type,
    zoneId: zoneIdAt(world, e.x, e.y),
    roomId: world.roomAt(e.x, e.y)?.id,
    x: e.x,
    y: e.y,
    actorId: e.id,
    actorName: entityDisplayName(e),
    actorFaction: e.faction,
    targetId: target?.id,
    targetName: target ? entityDisplayName(target) : undefined,
    targetFaction: target?.faction,
    monsterKind: MonsterKind.SOBRANNYY,
    severity,
    privacy: isPlayerEntity(target) ? 'local' : 'witnessed',
    tags: ['monster', 'sobrannyy', 'composite', ...tags],
    data: {
      rumorIds: ['ecology_sobrannyy_shelter'],
      counterplay: MONSTERS[MonsterKind.SOBRANNYY]?.counterplay,
      ...data,
    },
  });
}

function wakeSobrannyy(
  world: World,
  e: Entity,
  target: Entity | undefined,
  time: number,
  msgs: Msg[],
  state: GameState | undefined,
  reason: string,
): void {
  const runtime = sobrannyyState(e);
  if (!runtime.dormant) return;
  runtime.dormant = false;
  e.spriteScale = Math.max(e.spriteScale ?? 1, 1.08);
  msgs.push(msg('Собранный человек повернул сразу несколько голов. Отходи к слизи или гермопорогу.', time, '#fa4'));
  publishSobrannyyEvent(state, world, e, target, 'composite_woke', 4, ['woke', reason], { reason });
  playSoundAt(playGrowl, e.x, e.y);
}

function sobrannyyRecentRoomActivityWake(world: World, e: Entity, time: number, state: GameState | undefined): string | undefined {
  if (!state) return undefined;
  const room = world.roomAt(e.x, e.y);
  if (!room) return undefined;
  for (const event of getRecentEvents(state, { limit: 16 })) {
    const age = time - event.time;
    if (age < 0 || age > SOBRANNYY_ACTIVITY_WAKE_SEC) continue;
    if (event.actorId === e.id || event.roomId !== room.id) continue;
    if (event.type === 'container_opened' || event.type === 'item_stolen') return 'container';
    if (event.type === 'door_opened') return 'door';
  }
  return undefined;
}

function growSobrannyy(
  world: World,
  e: Entity,
  target: Entity | undefined,
  time: number,
  msgs: Msg[],
  state: GameState | undefined,
  reason: string,
): void {
  const runtime = sobrannyyState(e);
  if (runtime.stacks >= SOBRANNYY_MAX_STACKS) {
    runtime.stackUntil = Math.max(runtime.stackUntil, time + SOBRANNYY_STACK_SEC * 0.5);
    return;
  }
  runtime.stacks++;
  runtime.stackUntil = time + SOBRANNYY_STACK_SEC;
  e.monsterDmgMult = 1 + runtime.stacks * 0.2;
  e.speed = runtime.baseSpeed * (1 + runtime.stacks * 0.08);
  e.spriteScale = 1 + runtime.stacks * 0.1;
  msgs.push(msg(`Собранный человек прибавил массу: рост ${runtime.stacks}/${SOBRANNYY_MAX_STACKS}.`, time, '#f84'));
  publishSobrannyyEvent(state, world, e, target, 'composite_growth', 5, ['growth', reason], {
    reason,
    stacks: runtime.stacks,
    maxStacks: SOBRANNYY_MAX_STACKS,
    stackSeconds: SOBRANNYY_STACK_SEC,
  });
}

function updateSobrannyyGrowthState(
  world: World,
  e: Entity,
  time: number,
  msgs: Msg[],
  state: GameState | undefined,
): void {
  if (e.monsterKind !== MonsterKind.SOBRANNYY) return;
  if (!e.alive || (e.hp ?? 1) <= 0) {
    sobrannyyRuntime.delete(e);
    return;
  }
  const runtime = sobrannyyState(e);
  if (runtime.stacks > 0 && time >= runtime.stackUntil) {
    runtime.stacks = 0;
    runtime.hitCount = 0;
    e.monsterDmgMult = undefined;
    e.speed = runtime.baseSpeed;
    e.spriteScale = undefined;
  } else if (runtime.stacks > 0) {
    e.monsterDmgMult = 1 + runtime.stacks * 0.2;
    e.speed = runtime.baseSpeed * (1 + runtime.stacks * 0.08);
    e.spriteScale = Math.max(e.spriteScale ?? 1, 1 + runtime.stacks * 0.1);
  }

  const hp = e.hp ?? runtime.lastHp;
  if (hp < runtime.lastHp) {
    const loss = runtime.lastHp - hp;
    if (runtime.dormant && loss <= SOBRANNYY_IDLE_CHIP_IGNORE && e.hp !== undefined) {
      e.hp = Math.min(e.maxHp ?? runtime.lastHp, e.hp + loss);
    }
    wakeSobrannyy(world, e, undefined, time, msgs, state, 'damage');
    if (time <= runtime.hitWindowUntil) runtime.hitCount++;
    else runtime.hitCount = 1;
    runtime.hitWindowUntil = time + SOBRANNYY_DAMAGE_WINDOW_SEC;
    if (runtime.hitCount >= 3) {
      runtime.hitCount = 0;
      growSobrannyy(world, e, undefined, time, msgs, state, 'sustained_hits');
    }
  }
  runtime.lastHp = e.hp ?? hp;
}

function closedHermeticDoorBetween(world: World, e: Entity, target: Entity): boolean {
  const a = world.roomAt(e.x, e.y);
  const b = world.roomAt(target.x, target.y);
  if (!a || !b || a.id === b.id) return false;
  for (const idx of a.doors) {
    const door = world.doors.get(idx);
    if (!door || door.state !== DoorState.HERMETIC_CLOSED) continue;
    if (door.roomA === b.id || door.roomB === b.id) return true;
  }
  return false;
}

function sobrannyyIsolationReason(world: World, e: Entity, target: Entity): string | undefined {
  if (entityInActiveCellHazard(world, target, SOBRANNYY_SLIME_TAGS)) return 'slime';
  if (closedHermeticDoorBetween(world, e, target)) return 'hermetic_door';
  return undefined;
}

function weakDoorBetweenRooms(world: World, e: Entity, target: Entity): number | undefined {
  const a = world.roomAt(e.x, e.y);
  const b = world.roomAt(target.x, target.y);
  if (!a || !b || a.id === b.id) return undefined;
  for (const idx of a.doors) {
    const door = world.doors.get(idx);
    if (!door || (door.roomA !== b.id && door.roomB !== b.id)) continue;
    if (door.state === DoorState.CLOSED || door.state === DoorState.LOCKED) return idx;
  }
  return undefined;
}

function trySobrannyyBreakWeakDoor(
  world: World,
  e: Entity,
  target: Entity,
  time: number,
  msgs: Msg[],
  state: GameState | undefined,
): boolean {
  if ((e.attackCd ?? 0) > 0) return false;
  const doorIdx = weakDoorBetweenRooms(world, e, target);
  if (doorIdx === undefined) return false;
  const dx = doorIdx % W + 0.5;
  const dy = ((doorIdx / W) | 0) + 0.5;
  if (world.dist2(e.x, e.y, dx, dy) > SOBRANNYY_DOOR_BREAK_RANGE_SQ) return false;
  const door = world.doors.get(doorIdx);
  if (!door) return false;
  setDoorState(world, door, DoorState.OPEN);
  door.timer = Math.max(door.timer, 4);
  e.attackCd = 1.8;
  msgs.push(msg('Собранный человек выбил слабую дверь, но гермопорог не тронул.', time, '#f84'));
  if (state) {
    publishEvent(state, {
      type: 'door_opened',
      zoneId: zoneIdAt(world, dx, dy),
      roomId: world.roomMap[doorIdx] >= 0 ? world.roomMap[doorIdx] : undefined,
      x: dx,
      y: dy,
      actorId: e.id,
      actorName: entityDisplayName(e),
      actorFaction: e.faction,
      targetId: target.id,
      targetName: entityDisplayName(target),
      targetFaction: target.faction,
      monsterKind: MonsterKind.SOBRANNYY,
      severity: 3,
      privacy: isPlayerEntity(target) ? 'local' : 'witnessed',
      tags: ['monster', 'sobrannyy', 'door', 'weak_door'],
      data: { doorIdx, counterplay: 'closed_hermetic_door_still_blocks_composite' },
    });
  }
  playSoundAt(playGrowl, e.x, e.y);
  return true;
}

function updateSobrannyyTarget(
  world: World,
  e: Entity,
  target: Entity | null,
  time: number,
  msgs: Msg[],
  state: GameState | undefined,
): Entity | null {
  if (e.monsterKind !== MonsterKind.SOBRANNYY) return target;
  const runtime = sobrannyyState(e);
  if (runtime.dormant) {
    const noise = findNoiseInvestigationTarget(world, state, e, time);
    if (noise) wakeSobrannyy(world, e, undefined, time, msgs, state, 'noise');
  }
  if (runtime.dormant) {
    const activity = sobrannyyRecentRoomActivityWake(world, e, time, state);
    if (activity) wakeSobrannyy(world, e, target ?? undefined, time, msgs, state, activity);
  }
  if (target && runtime.dormant && world.dist2(e.x, e.y, target.x, target.y) <= SOBRANNYY_WAKE_RADIUS_SQ) {
    wakeSobrannyy(world, e, target, time, msgs, state, 'approach');
  }
  if (runtime.dormant) {
    e.ai!.combatTargetId = undefined;
    e.ai!.path = [];
    e.ai!.goal = AIGoal.IDLE;
    return null;
  }
  if (!target) return null;
  const isolated = sobrannyyIsolationReason(world, e, target);
  if (isolated) {
    e.ai!.combatTargetId = undefined;
    e.ai!.path = [];
    e.ai!.goal = AIGoal.IDLE;
    runtime.hitCount = 0;
    if (time >= runtime.isolatedUntil) {
      runtime.isolatedUntil = time + 8;
      msgs.push(msg(
        isolated === 'slime'
          ? 'Собранный человек потерял цель у слизи. Это окно для отхода или доклада.'
          : 'Гермодверь отрезала Собранного человека. Не открывай обратно.',
        time,
        '#9cf',
      ));
      publishSobrannyyEvent(state, world, e, target, 'composite_isolated', 4, ['isolated', isolated], { reason: isolated });
    }
    return null;
  }
  return target;
}

function clampObzhivalshchikAnger(e: Entity, value: number): number {
  const anger = Math.max(0, Math.min(OBZHIVALSHCHIK_MAX_ANGER, value));
  e.ai!.anger = anger;
  return anger;
}

function obzhivalshchikHomeRoom(world: World, e: Entity): Room | undefined {
  const ai = e.ai!;
  if (ai.homeRoomId === undefined) {
    const room = world.roomAt(e.x, e.y);
    if (room) ai.homeRoomId = room.id;
  }
  return ai.homeRoomId !== undefined ? world.rooms[ai.homeRoomId] : undefined;
}

function obzhivalshchikEntityInHome(world: World, room: Room, entity: Entity): boolean {
  return world.roomMap[world.idx(Math.floor(entity.x), Math.floor(entity.y))] === room.id;
}

function obzhivalshchikCanBreach(e: Entity, state: GameState | undefined): boolean {
  return e.ai!.breached === true
    || (e.ai!.anger ?? 0) >= OBZHIVALSHCHIK_BREACH_ANGER
    || state?.samosborActive === true;
}

function publishObzhivalshchikEvent(
  state: GameState | undefined,
  world: World,
  e: Entity,
  target: Entity | undefined,
  type: 'obzhivalshchik_scratched' | 'obzhivalshchik_calmed' | 'obzhivalshchik_breached',
  severity: 2 | 3 | 4 | 5,
  tags: string[],
  data?: Record<string, unknown>,
): void {
  if (!state) return;
  publishEvent(state, {
    type,
    zoneId: zoneIdAt(world, e.x, e.y),
    roomId: e.ai?.homeRoomId ?? world.roomAt(e.x, e.y)?.id,
    x: e.x,
    y: e.y,
    actorId: e.id,
    actorName: entityDisplayName(e),
    actorFaction: e.faction,
    targetId: target?.id,
    targetName: target ? entityDisplayName(target) : undefined,
    targetFaction: target?.faction,
    monsterKind: MonsterKind.OBZHIVALSHCHIK,
    severity,
    privacy: isPlayerEntity(target) ? 'local' : 'witnessed',
    tags: ['monster', 'obzhivalshchik', 'room_bound', ...tags],
    data: {
      rumorIds: ['monster_obzhivalshchik_room', 'ecology_obzhivalshchik_growth'],
      counterplay: MONSTERS[MonsterKind.OBZHIVALSHCHIK]?.counterplay,
      anger: Math.round(e.ai?.anger ?? 0),
      growthCount: e.ai?.growthCount ?? 0,
      ...data,
    },
  });
}

function obzhivalshchikLowLight(world: World, e: Entity, state: GameState | undefined): boolean {
  const ci = world.idx(Math.floor(e.x), Math.floor(e.y));
  const hour = state?.clock.hour ?? 0;
  return world.light[ci] < 0.16 || hour >= 22 || hour < 5;
}

function processObzhivalshchikNoise(world: World, e: Entity, time: number, state: GameState | undefined): void {
  const ai = e.ai!;
  const noise = findNoiseForActor(world, state, e, time, { minSeverity: 1, scanInterval: 0.85, hearingMult: 1.35 });
  if (!noise || noise.id === ai.lastNoiseId) return;
  const home = ai.homeRoomId !== undefined ? world.rooms[ai.homeRoomId] : undefined;
  if (home) {
    const noiseRoom = world.roomAt(noise.x, noise.y);
    const nearHome = noiseRoom?.id === home.id || world.dist2(e.x, e.y, noise.x, noise.y) <= 14 * 14;
    if (!nearHome) return;
  }
  ai.lastNoiseId = noise.id;
  const base = noise.source === 'door' ? 14 : noise.source === 'footstep' ? 4 : 8;
  clampObzhivalshchikAnger(e, (ai.anger ?? 0) + base + noise.severity * 3);
}

function processObzhivalshchikRoomMemory(
  world: World,
  e: Entity,
  time: number,
  msgs: Msg[],
  state: GameState | undefined,
): void {
  const ai = e.ai!;
  const memory = getRoomMemory(state?.currentFloor, ai.homeRoomId);
  if (!memory || memory.lastEventId === ai.lastRoomMemoryEventId) return;
  ai.lastRoomMemoryEventId = memory.lastEventId;

  if (roomMemoryHas(memory, ROOM_MEMORY_BITS.THEFT | ROOM_MEMORY_BITS.COMBAT)) {
    clampObzhivalshchikAnger(e, (ai.anger ?? 0) + 18 + memory.severity * 5);
  }

  if (roomMemoryHas(memory, ROOM_MEMORY_BITS.HELP | ROOM_MEMORY_BITS.INFORM | ROOM_MEMORY_BITS.REPAIR)) {
    const before = ai.anger ?? 0;
    const after = clampObzhivalshchikAnger(e, before - (24 + memory.severity * 8));
    if (after < before) {
      msgs.push(msg('За дверью перестали скрести: доклад или помощь сбили комнатную злость.', time, '#9cf'));
      publishObzhivalshchikEvent(state, world, e, undefined, 'obzhivalshchik_calmed', 3, ['calm', 'report'], {
        roomMemoryBits: memory.bits,
        roomMemorySeverity: memory.severity,
      });
    }
  }
}

function obzhivalshchikGrowthCell(world: World, room: Room, seed: number): { x: number; y: number } | undefined {
  const spanX = Math.max(1, room.w - 2);
  const spanY = Math.max(1, room.h - 2);
  for (let attempt = 0; attempt < 64; attempt++) {
    const side = (seed + attempt) & 3;
    const t = Math.abs(Math.imul(seed + attempt * 37, 1103515245)) >>> 0;
    let x = room.x;
    let y = room.y;
    if (side === 0) {
      x = room.x + 1 + (t % spanX);
      y = room.y - 1;
    } else if (side === 1) {
      x = room.x + 1 + (t % spanX);
      y = room.y + room.h;
    } else if (side === 2) {
      x = room.x - 1;
      y = room.y + 1 + (t % spanY);
    } else {
      x = room.x + room.w;
      y = room.y + 1 + (t % spanY);
    }
    x = world.wrap(x);
    y = world.wrap(y);
    const ci = world.idx(x, y);
    if (world.cells[ci] === Cell.WALL || world.cells[ci] === Cell.DOOR) return { x, y };
  }
  return undefined;
}

function growObzhivalshchikWallMatter(
  world: World,
  e: Entity,
  room: Room,
  time: number,
  msgs: Msg[],
  state: GameState | undefined,
): void {
  const ai = e.ai!;
  if ((ai.growthCount ?? 0) >= OBZHIVALSHCHIK_GROWTH_CAP) return;
  if ((ai.growthCd ?? 0) > 0) return;

  const growthCount = ai.growthCount ?? 0;
  const seed = 19019 + e.id * 97 + room.id * 31 + growthCount * 53;
  const cell = obzhivalshchikGrowthCell(world, room, seed);
  ai.growthCd = Math.max(4, OBZHIVALSHCHIK_GROWTH_CD - Math.min(4, (ai.anger ?? 0) / 25));
  if (!cell) return;

  stampMark(world, cell.x, cell.y, 0.5, 0.5, 0.42, MarkType.SPLAT, seed, 176, 166, 132, 160, true);
  ai.growthCount = growthCount + 1;
  if (ai.growthCount === 1 || ai.growthCount === OBZHIVALSHCHIK_GROWTH_CAP) {
    msgs.push(msg(`Комнатная слизь расползлась по стене: ${ai.growthCount}/${OBZHIVALSHCHIK_GROWTH_CAP}.`, time, '#db9'));
  }
  publishObzhivalshchikEvent(state, world, e, undefined, 'obzhivalshchik_scratched', 3, ['growth'], {
    growthCap: OBZHIVALSHCHIK_GROWTH_CAP,
  });
}

function tickObzhivalshchikPressure(
  world: World,
  e: Entity,
  room: Room,
  dt: number,
  time: number,
  msgs: Msg[],
  state: GameState | undefined,
): void {
  const ai = e.ai!;
  processObzhivalshchikNoise(world, e, time, state);
  processObzhivalshchikRoomMemory(world, e, time, msgs, state);

  const lowLight = obzhivalshchikLowLight(world, e, state);
  clampObzhivalshchikAnger(e, (ai.anger ?? 0) + (lowLight ? dt * 0.05 : -dt * 0.02));
  ai.growthCd = (ai.growthCd ?? 1.5) - dt;
  if (lowLight || (ai.anger ?? 0) >= 35) growObzhivalshchikWallMatter(world, e, room, time, msgs, state);

  ai.scratchCd = (ai.scratchCd ?? 0.8) - dt;
  if ((lowLight || (ai.anger ?? 0) >= 25) && ai.scratchCd <= 0) {
    ai.scratchCd = OBZHIVALSHCHIK_SCRATCH_CD;
    msgs.push(msg('За квартирной стеной скребут длинные пальцы. Не бей дверь без плана.', time, '#db9'));
    publishObzhivalshchikEvent(state, world, e, undefined, 'obzhivalshchik_scratched', 2, ['scratch'], { lowLight });
    playSoundAt(playGrowl, e.x, e.y);
  }
}

function obzhivalshchikRoomCell(world: World, room: Room, seed: number): { x: number; y: number } | undefined {
  const spanX = Math.max(1, room.w - 2);
  const spanY = Math.max(1, room.h - 2);
  for (let attempt = 0; attempt < 32; attempt++) {
    const x = world.wrap(room.x + 1 + Math.abs(seed + attempt * 7) % spanX);
    const y = world.wrap(room.y + 1 + Math.abs(seed * 3 + attempt * 11) % spanY);
    const ci = world.idx(x, y);
    if (world.roomMap[ci] === room.id && !world.solid(x, y)) return { x, y };
  }
  return undefined;
}

function idleObzhivalshchikInRoom(world: World, e: Entity, room: Room, dt: number, time: number): boolean {
  const ai = e.ai!;
  ai.goal = AIGoal.WANDER;
  ai.combatTargetId = undefined;
  ai.timer -= dt;

  const inside = obzhivalshchikEntityInHome(world, room, e);
  if (!inside || ai.path.length === 0 || ai.pi >= ai.path.length || ai.timer <= 0) {
    const target = obzhivalshchikRoomCell(world, room, e.id * 17 + Math.floor(time * 3));
    if (!target) return true;
    tryAssignPathToCell(world, e, target.x, target.y);
    ai.timer = inside ? 1.5 + ((e.id + Math.floor(time)) % 3) * 0.35 : OBZHIVALSHCHIK_RETURN_CD;
  }
  followMonsterPath(world, e, dt);
  return true;
}

function updateObzhivalshchikTarget(
  world: World,
  e: Entity,
  target: Entity | null,
  dt: number,
  time: number,
  msgs: Msg[],
  state: GameState | undefined,
): Entity | null {
  if (e.monsterKind !== MonsterKind.OBZHIVALSHCHIK) return target;
  const room = obzhivalshchikHomeRoom(world, e);
  if (!room) return target;

  tickObzhivalshchikPressure(world, e, room, dt, time, msgs, state);
  const inside = obzhivalshchikEntityInHome(world, room, e);
  const mayBreach = obzhivalshchikCanBreach(e, state);
  if (!inside && !mayBreach) return null;
  if (!target) return null;
  if (obzhivalshchikEntityInHome(world, room, target)) return target;
  if (!mayBreach) return null;

  if (!e.ai!.breached) {
    e.ai!.breached = true;
    msgs.push(msg('Комнатный обживальщик вышел из квартиры. Теперь коридор тоже его.', time, '#f84'));
    publishObzhivalshchikEvent(state, world, e, target, 'obzhivalshchik_breached', 4, ['breach'], {
      reason: state?.samosborActive ? 'samosbor' : 'anger',
    });
  }
  return target;
}

function bladeEliteTuning(kind: MonsterKind | undefined): BladeEliteTuning | undefined {
  switch (kind) {
    case MonsterKind.KOSTOREZ:
      return {
        kind,
        tag: 'kostorez',
        rumorIds: KOSTOREZ_RUMOR_IDS,
        windupRange: KOSTOREZ_WINDUP_RANGE,
        burstRange: KOSTOREZ_BURST_RANGE,
        windupSec: KOSTOREZ_WINDUP_SEC,
        staggerSec: KOSTOREZ_STAGGER_SEC,
        escapeDist: KOSTOREZ_ESCAPE_DIST,
        coverBlocks: false,
        sightMsg: 'Косторез увидел тебя. Держи дистанцию: замах читается.',
        windupMsg: 'Косторез заносит пилы. Отходи за угол или бей дробью!',
        staggerMsg: 'Дробь сбила замах Костореза.',
        strikeVerb: 'режет',
        counterplay: 'distance, obstacle, shotgun stagger, metal_sheet armor',
      };
    case MonsterKind.SAFEGUARD:
      return {
        kind,
        tag: 'safeguard',
        rumorIds: SAFEGUARD_RUMOR_IDS,
        windupRange: SAFEGUARD_WINDUP_RANGE,
        burstRange: SAFEGUARD_BURST_RANGE,
        windupSec: SAFEGUARD_WINDUP_SEC,
        staggerSec: SAFEGUARD_STAGGER_SEC,
        escapeDist: SAFEGUARD_ESCAPE_DIST,
        coverBlocks: true,
        sightMsg: 'Сейфгард взял тебя в отказ. Ломай линию: белый замах короткий.',
        windupMsg: 'Сейфгард разводит клинки. За дверь, аппарат или дробью!',
        staggerMsg: 'Дробь сбила белый замах Сейфгарда.',
        strikeVerb: 'режет',
        counterplay: 'line break by wall, door, machine, apparatus; shotgun stagger',
      };
    default:
      return undefined;
  }
}

function bladeEliteEventData(tuning: BladeEliteTuning, extra?: Record<string, unknown>): Record<string, unknown> {
  return { rumorIds: [...tuning.rumorIds], ...extra };
}

function monsterReadabilityRumorIds(kind: MonsterKind | undefined): readonly string[] {
  switch (kind) {
    case MonsterKind.EYE: return EYE_RUMOR_IDS;
    case MonsterKind.CHERNOSLIZ: return CHERNOSLIZ_RUMOR_IDS;
    case MonsterKind.VODYANOY_KOSHMAR: return VODYANOY_KOSHMAR_RUMOR_IDS;
    case MonsterKind.TVAR: return TVAR_RUMOR_IDS;
    case MonsterKind.SHOVNIK: return SHOVNIK_RUMOR_IDS;
    case MonsterKind.REBAR: return REBAR_RUMOR_IDS;
    case MonsterKind.BETONOED: return BETONOED_RUMOR_IDS;
    case MonsterKind.PANELNIK: return PANELNIK_RUMOR_IDS;
    case MonsterKind.SLEPOGLAZ: return SLEPOGLAZ_RUMOR_IDS;
    case MonsterKind.LAMPOGLAZ: return LAMPOGLAZ_RUMOR_IDS;
    case MonsterKind.PARAGRAPH: return PARAGRAPH_RUMOR_IDS;
    case MonsterKind.PROTOKOLNIK: return PROTOKOLNIK_RUMOR_IDS;
    case MonsterKind.IDOL: return IDOL_RUMOR_IDS;
    case MonsterKind.KANTSELYARSKIY_IDOL: return KANTSELYARSKIY_IDOL_RUMOR_IDS;
    case MonsterKind.ROBOT: return ROBOT_RUMOR_IDS;
    case MonsterKind.TRUBNYY_AVTOMAT: return TRUBNYY_AVTOMAT_RUMOR_IDS;
    case MonsterKind.GREEN_DOG: return GREEN_DOG_RUMOR_IDS;
    case MonsterKind.SBORKA: return SBORKA_RUMOR_IDS;
    case MonsterKind.ZOMBIE: return ZOMBIE_RUMOR_IDS;
    case MonsterKind.DIKIY_MERTVYAK: return DIKIY_MERTVYAK_RUMOR_IDS;
    case MonsterKind.POMOYNY_ROY: return POMOYNY_ROY_RUMOR_IDS;
    case MonsterKind.SWARM: return SWARM_RUMOR_IDS;
    case MonsterKind.NIGHTMARE: return NIGHTMARE_RUMOR_IDS;
    case MonsterKind.MANCOBUS: return MANCOBUS_RUMOR_IDS;
    case MonsterKind.HERALD: return HERALD_RUMOR_IDS;
    case MonsterKind.CREATOR: return CREATOR_RUMOR_IDS;
    case MonsterKind.SHADOW: return SHADOW_RUMOR_IDS;
    case MonsterKind.TONKAYA_TEN: return TONKAYA_TEN_RUMOR_IDS;
    case MonsterKind.GLUBINNAYA_TEN: return GLUBINNAYA_TEN_RUMOR_IDS;
    case MonsterKind.LISHENNYY: return LISHENNYY_RUMOR_IDS;
    case MonsterKind.TUMANNIK: return TUMANNIK_RUMOR_IDS;
    case MonsterKind.LOZHNYY_DUKH: return LOZHNYY_DUKH_RUMOR_IDS;
    case MonsterKind.RZHAVNIK: return RZHAVNIK_RUMOR_IDS;
    case MonsterKind.TRESKOTNIK: return TRESKOTNIK_RUMOR_IDS;
    case MonsterKind.NELYUD: return NELYUD_RUMOR_IDS;
    case MonsterKind.CHERVIE_AVATAR: return CHERVIE_RUMOR_IDS;
    case MonsterKind.SPORE_CARPET: return SPORE_CARPET_RUMOR_IDS;
    default: return [];
  }
}

function monsterReadabilityEventData(
  kind: MonsterKind | undefined,
  extra?: Record<string, unknown>,
): Record<string, unknown> {
  const rumorIds = monsterReadabilityRumorIds(kind);
  return rumorIds.length > 0 ? { rumorIds: [...rumorIds], ...extra } : { ...extra };
}

function publishMonsterReadabilityEvent(
  state: GameState | undefined,
  world: World,
  e: Entity,
  target: Entity | undefined,
  type: 'monster_sighted' | 'monster_windup_interrupted',
  severity: 3 | 4,
  tags: string[],
  data?: Record<string, unknown>,
): void {
  if (!state) return;
  publishEvent(state, {
    type,
    zoneId: zoneIdAt(world, e.x, e.y),
    x: e.x,
    y: e.y,
    actorId: e.id,
    actorName: entityDisplayName(e),
    actorFaction: e.faction,
    targetId: target?.id,
    targetName: target ? entityDisplayName(target) : undefined,
    targetFaction: target?.faction,
    monsterKind: e.monsterKind,
    severity,
    privacy: isPlayerEntity(target) ? 'local' : 'witnessed',
    tags: ['monster', ...tags],
    data: monsterReadabilityEventData(e.monsterKind, data),
  });
}

function nightmareState(e: Entity): NightmareRuntime {
  const hp = Math.max(1, e.hp ?? e.maxHp ?? 1);
  let state = nightmareRuntime.get(e);
  if (!state) {
    state = { lastHp: hp, pressure: 0, lastBreakAt: -Infinity };
    nightmareRuntime.set(e, state);
  }
  return state;
}

function nightmareSamePressureSpace(world: World, e: Entity, target: Entity): boolean {
  const a = world.roomAt(e.x, e.y)?.id;
  const b = world.roomAt(target.x, target.y)?.id;
  return a === b;
}

function publishNightmarePressureBreak(
  world: World,
  e: Entity,
  target: Entity | undefined,
  time: number,
  msgs: Msg[],
  playerId: number,
  state: GameState | undefined,
  reason: string,
): void {
  const runtime = nightmareState(e);
  if (runtime.lastBreakAt > time - 1.2) return;
  runtime.lastBreakAt = time;
  if (target?.id === playerId) {
    msgs.push(msg(
      reason === 'burst_damage'
        ? 'Кошмарище потеряло темп от тяжелого урона. Сейчас решай: добивать или выйти.'
        : 'Дверь, угол или дистанция разорвали давление Кошмарища.',
      time,
      '#9cf',
    ));
  }
  publishMonsterReadabilityEvent(state, world, e, target, 'monster_windup_interrupted', 4, ['nightmare', 'pressure', reason], {
    reason,
    pressure: Math.round(runtime.pressure * 100) / 100,
    pressureCap: NIGHTMARE_PRESSURE_MAX,
    counterplay: 'burst_damage_or_leave_room_before_pressure_caps',
  });
}

function updateNightmarePressure(
  world: World,
  e: Entity,
  target: Entity | null,
  dt: number,
  time: number,
  msgs: Msg[],
  playerId: number,
  state?: GameState,
): void {
  if (e.monsterKind !== MonsterKind.NIGHTMARE) return;
  if (!e.alive || (e.hp ?? 1) <= 0) {
    nightmareRuntime.delete(e);
    return;
  }

  const runtime = nightmareState(e);
  const hp = e.hp ?? runtime.lastHp;
  const hpLoss = Math.max(0, runtime.lastHp - hp);
  const heavyDamage = hpLoss >= Math.max(NIGHTMARE_HEAVY_DAMAGE_BREAK, (e.maxHp ?? hp) * NIGHTMARE_HEAVY_DAMAGE_RATIO);
  if (heavyDamage && runtime.pressure > 0) {
    runtime.pressure = Math.max(0, runtime.pressure - 2.5);
    e.attackCd = Math.max(e.attackCd ?? 0, 0.55);
    e.spriteScale = 0.92;
    publishNightmarePressureBreak(world, e, target ?? undefined, time, msgs, playerId, state, 'burst_damage');
  }
  runtime.lastHp = hp;

  const closeTarget = !!target?.alive &&
    world.dist2(e.x, e.y, target.x, target.y) <= NIGHTMARE_PRESSURE_RANGE * NIGHTMARE_PRESSURE_RANGE &&
    nightmareSamePressureSpace(world, e, target);

  const before = runtime.pressure;
  if (closeTarget) {
    runtime.pressure = Math.min(NIGHTMARE_PRESSURE_MAX, runtime.pressure + dt * NIGHTMARE_PRESSURE_GAIN);
    if (target?.id === playerId && e.ai?.lastSeenTargetId !== playerId) {
      e.ai!.lastSeenTargetId = playerId;
      msgs.push(msg('Кошмарище давит комнату. Длинный бой кормит его: тяжелый урон или выход.', time, '#fa4'));
      publishMonsterReadabilityEvent(state, world, e, target, 'monster_sighted', 4, ['nightmare', 'pressure', 'warning'], {
        pressureCap: NIGHTMARE_PRESSURE_MAX,
        counterplay: 'burst_damage_or_leave_room',
      });
    }
  } else {
    runtime.pressure = Math.max(0, runtime.pressure - dt * NIGHTMARE_PRESSURE_DECAY);
    if (before >= 1 && runtime.pressure <= 0.2) {
      publishNightmarePressureBreak(world, e, target ?? undefined, time, msgs, playerId, state, 'left_room_or_range');
    }
    if (target?.id !== playerId) e.ai!.lastSeenTargetId = undefined;
  }

  if (runtime.pressure > 0) {
    e.monsterDmgMult = 1 + runtime.pressure * 0.1;
    e.spriteScale = 1 + runtime.pressure * 0.035;
  } else {
    e.monsterDmgMult = undefined;
    if (e.spriteScale !== 0.92) e.spriteScale = undefined;
  }
}

function publishBladeEliteEvent(
  tuning: BladeEliteTuning,
  state: GameState | undefined,
  world: World,
  e: Entity,
  target: Entity | undefined,
  type: 'monster_sighted' | 'monster_windup_interrupted' | 'monster_armor_cut' | 'monster_escaped',
  severity: 3 | 4 | 5,
  tags: string[],
  data?: Record<string, unknown>,
): void {
  if (!state) return;
  publishEvent(state, {
    type,
    zoneId: zoneIdAt(world, e.x, e.y),
    x: e.x,
    y: e.y,
    actorId: e.id,
    actorName: entityDisplayName(e),
    actorFaction: e.faction,
    targetId: target?.id,
    targetName: target ? entityDisplayName(target) : undefined,
    targetFaction: target?.faction,
    monsterKind: tuning.kind,
    severity,
    privacy: isPlayerEntity(target) ? 'local' : 'witnessed',
    tags: ['monster', tuning.tag, ...tags],
    data: bladeEliteEventData(tuning, data),
  });
}

function isLineOfFireCover(feature: Feature): boolean {
  return feature === Feature.SHELF ||
    feature === Feature.MACHINE ||
    feature === Feature.APPARATUS ||
    feature === Feature.DESK ||
    feature === Feature.TABLE;
}

function traceClearLine(world: World, e: Entity, target: Entity, maxDist: number, coverBlocks: boolean): boolean {
  const dx = world.delta(e.x, target.x);
  const dy = world.delta(e.y, target.y);
  const dist = Math.sqrt(dx * dx + dy * dy);
  if (dist > maxDist) return false;
  const steps = Math.max(2, Math.ceil(dist * 2));
  for (let i = 1; i < steps; i++) {
    const t = i / steps;
    const x = Math.floor(world.wrap(e.x + dx * t));
    const y = Math.floor(world.wrap(e.y + dy * t));
    if (world.solid(x, y)) return false;
    if (coverBlocks && isLineOfFireCover(world.features[world.idx(x, y)] as Feature)) return false;
  }
  return true;
}

function hasClearLine(world: World, e: Entity, target: Entity, maxDist: number): boolean {
  return traceClearLine(world, e, target, maxDist, false);
}

export function hasClearLineOfFire(world: World, e: Entity, target: Entity, maxDist: number): boolean {
  return traceClearLine(world, e, target, maxDist, true);
}

export interface LineThreatContext {
  distance: number;
  inRange: boolean;
  los: boolean;
  coverBroken: boolean;
  targetLight: number;
  litTarget: boolean;
}

export function lineThreatContext(
  world: World,
  e: Entity,
  target: Entity,
  maxRange: number,
  minRange = 0,
): LineThreatContext {
  const dx = world.delta(e.x, target.x);
  const dy = world.delta(e.y, target.y);
  const distance = Math.sqrt(dx * dx + dy * dy);
  const inRange = distance <= maxRange && distance > minRange;
  const los = inRange && hasClearLineOfFire(world, e, target, maxRange);
  let targetLight = entityLight(world, target);
  if (nearFeature(world, target, Feature.LAMP, 1)) targetLight = Math.max(targetLight, 0.62);
  if (nearFeature(world, target, Feature.CANDLE, 1)) targetLight = Math.max(targetLight, 0.48);
  return {
    distance,
    inRange,
    los,
    coverBroken: inRange && !los,
    targetLight,
    litTarget: targetLight >= LAMPOGLAZ_LIGHT_LOCK,
  };
}

function isDocumentPressureHunter(e: Entity): boolean {
  return hasAIFlag(e, 'documentHunter') || hasAIFlag(e, 'documentScent') || hasAIFlag(e, 'protocolPressure');
}

export function protokolnikDocumentPressure(target: Entity | undefined): number {
  return documentScentStrength(target);
}

export function protokolnikPressureCap(documentPressure: number): number {
  return Math.min(PROTOKOLNIK_PRESSURE_MAX, PROTOKOLNIK_PRESSURE_SAFE_CAP + Math.max(0, documentPressure) * 5.8);
}

function protokolnikPressureTier(pressure: number): number {
  return Math.max(0, Math.min(4, Math.floor(pressure / PROTOKOLNIK_PRESSURE_WARN_STEP)));
}

function protokolnikHasProtocolLine(world: World, e: Entity, target: Entity): boolean {
  if (world.dist2(e.x, e.y, target.x, target.y) > PROTOKOLNIK_PRESSURE_RANGE_SQ) return false;
  return hasClearLineOfFire(world, e, target, PROTOKOLNIK_PRESSURE_RANGE);
}

function protokolnikPressureMessage(pressure: number, documentPressure: number): string {
  if (pressure >= 75) return 'Протокольник почти закрыл протокол. Бумаги в кармане давят как чужая подпись.';
  if (pressure >= 50) return documentPressure > 0
    ? 'Протокольник ускорил страницы вокруг вас. Спрячьте документы или уходите за дверь.'
    : 'Протокольник держит пустой протокол. Долгий бой все равно кормит ПСИ-давление.';
  return documentPressure > 0
    ? 'Протокольник нашел ваши бумаги. Чем дольше бой, тем тяжелее протокол.'
    : 'Протокольник начал сверку без бумаг. Короткий бой или выход пока безопаснее.';
}

function publishProtokolnikEscaped(
  state: GameState | undefined,
  world: World,
  e: Entity,
  target: Entity | undefined,
  pressure: number,
  documentPressure: number,
): void {
  if (!state) return;
  publishEvent(state, {
    type: 'monster_escaped',
    zoneId: zoneIdAt(world, e.x, e.y),
    roomId: world.roomAt(e.x, e.y)?.id,
    x: e.x,
    y: e.y,
    actorId: e.id,
    actorName: entityDisplayName(e),
    actorFaction: e.faction,
    targetId: target?.id,
    targetName: target ? entityDisplayName(target) : undefined,
    targetFaction: target?.faction,
    monsterKind: MonsterKind.PROTOKOLNIK,
    severity: 4,
    privacy: 'local',
    tags: ['monster', 'protokolnik', 'protocol_pressure', 'escaped'],
    data: monsterReadabilityEventData(MonsterKind.PROTOKOLNIK, {
      protocolPressure: Math.round(pressure),
      documentPressure: Math.round(documentPressure * 10) / 10,
      counterplay: 'left_room_or_broke_line_before_protocol_closed',
    }),
  });
}

function publishProtokolnikPressure(
  state: GameState | undefined,
  world: World,
  e: Entity,
  target: Entity,
  pressure: number,
  exposure: number,
  documentPressure: number,
): void {
  publishMonsterReadabilityEvent(state, world, e, target, 'monster_sighted', 4, ['protokolnik', 'protocol_pressure', 'documents'], {
    protocolPressure: Math.round(pressure),
    protocolExposure: Math.round(exposure * 10) / 10,
    documentPressure: Math.round(documentPressure * 10) / 10,
    pressureCap: Math.round(protokolnikPressureCap(documentPressure)),
    counterplay: 'drop_or_stash_documents_burst_or_leave_room',
  });
}

function applyProtokolnikPulse(
  state: GameState | undefined,
  e: Entity,
  target: Entity,
  pressure: number,
  documentPressure: number,
  time: number,
  msgs: Msg[],
  playerId: number,
): void {
  if (target.id !== playerId || target.hp === undefined) return;
  const dmg = Math.round(Math.min(
    PROTOKOLNIK_PRESSURE_PULSE_MAX,
    0.65 + pressure * 0.024 + documentPressure * 0.08,
  ) * 10) / 10;
  if (dmg <= 0) return;

  if (isDebugOnePunchManEnabled()) {
    keepDebugOnePunchManAlive(target);
  } else {
    { const _dmg = calculateDamage(dmg, DamageType.KINETIC, target); target.hp -= _dmg; applyHitStaggerAndKnockback(target, e.x, e.y, _dmg); }
    if (target.hp <= 0) {
      target.alive = false;
      target.hp = 0;
    }
  }
  recordPlayerDamage(state, e, dmg, `Протокол сжал виски: -${dmg}`);
  msgs.push(msg(`Протокол давит: -${dmg}. Бумаги усиливают сверку.`, time, '#d8a4ff'));
  playSoundAt(playHostilePsiCast, e.x, e.y);
}

export function updateProtokolnikProtocolPressure(
  world: World,
  e: Entity,
  target: Entity | null,
  dt: number,
  time: number,
  msgs: Msg[],
  playerId: number,
  state?: GameState,
): void {
  if (!hasAIFlag(e, 'protocolPressure') || !e.ai || dt <= 0) return;
  const ai = e.ai;
  const pressureBefore = ai.protocolPressure ?? 0;
  const exposureBefore = ai.protocolExposure ?? 0;
  const active = !!target && target.alive && protokolnikHasProtocolLine(world, e, target);
  const documentPressure = protokolnikDocumentPressure(active ? target ?? undefined : _entityById.get(playerId));

  if (!active) {
    if (ai.lastSeenTargetId === playerId && pressureBefore >= 18) {
      const player = _entityById.get(playerId);
      msgs.push(msg('Протокольник потерял строку протокола: дверь, шкаф или дистанция дали окно.', time, '#9cf'));
      publishProtokolnikEscaped(state, world, e, player, pressureBefore, documentPressure);
    }
    ai.lastSeenTargetId = undefined;
    ai.protocolExposure = Math.max(0, exposureBefore - dt * 1.6);
    ai.protocolPressure = Math.max(0, pressureBefore - PROTOKOLNIK_PRESSURE_DECAY * dt);
    if (ai.protocolPressure <= 0.05) {
      ai.protocolPressure = undefined;
      ai.protocolExposure = undefined;
      ai.protocolPressurePulseCd = undefined;
      ai.protocolPressureWarnAt = undefined;
      e.protocolPressureTier = 0;
    } else {
      e.protocolPressureTier = protokolnikPressureTier(ai.protocolPressure);
      if (ai.protocolPressure < PROTOKOLNIK_PRESSURE_WARN_STEP * 0.55) ai.protocolPressureWarnAt = PROTOKOLNIK_PRESSURE_WARN_STEP;
    }
    return;
  }

  const pressureCap = protokolnikPressureCap(documentPressure);
  const exposure = Math.min(90, exposureBefore + dt);
  let pressure = pressureBefore;
  if (pressure > pressureCap) {
    pressure = Math.max(pressureCap, pressure - PROTOKOLNIK_CAP_DECAY * dt);
  } else {
    const growth = 0.85 + documentPressure * 0.72 + Math.min(3.4, exposure * 0.045);
    pressure = Math.min(pressureCap, pressure + growth * dt);
  }
  pressure = Math.min(PROTOKOLNIK_PRESSURE_MAX, pressure);

  ai.protocolExposure = exposure;
  ai.protocolPressure = pressure;
  e.protocolPressureTier = protokolnikPressureTier(pressure);
  if (target.id === playerId) ai.lastSeenTargetId = playerId;

  const warnAt = ai.protocolPressureWarnAt ?? PROTOKOLNIK_PRESSURE_WARN_STEP;
  if (target.id === playerId && pressure >= warnAt) {
    msgs.push(msg(protokolnikPressureMessage(pressure, documentPressure), time, '#d8a4ff'));
    publishProtokolnikPressure(state, world, e, target, pressure, exposure, documentPressure);
    ai.protocolPressureWarnAt = warnAt + PROTOKOLNIK_PRESSURE_WARN_STEP;
  } else if (pressure < PROTOKOLNIK_PRESSURE_WARN_STEP * 0.55) {
    ai.protocolPressureWarnAt = PROTOKOLNIK_PRESSURE_WARN_STEP;
  }

  ai.protocolPressurePulseCd = (ai.protocolPressurePulseCd ?? 0) - dt;
  if (pressure >= PROTOKOLNIK_PRESSURE_PULSE_THRESHOLD && ai.protocolPressurePulseCd <= 0) {
    ai.protocolPressurePulseCd = PROTOKOLNIK_PRESSURE_PULSE_CD;
    applyProtokolnikPulse(state, e, target, pressure, documentPressure, time, msgs, playerId);
  }
}

function forbiddenCleanupSample(e: Entity | undefined): boolean {
  if (!e?.inventory) return false;
  for (const item of e.inventory) {
    if (item.count <= 0) continue;
    const tags = ITEM_TAGS[item.defId] ?? ITEMS[item.defId]?.tags ?? [];
    if (tags.includes('sample') && (tags.includes('contraband') || tags.includes('science') || tags.includes('slime'))) return true;
    if (tags.includes('govnyak') && tags.includes('contraband')) return true;
    if (tags.includes('evidence') && tags.includes('science')) return true;
  }
  return false;
}

function nearOpenHermeticDoor(world: World, x: number, y: number, radius: number): boolean {
  const cx = Math.floor(x);
  const cy = Math.floor(y);
  for (let dy = -radius; dy <= radius; dy++) {
    for (let dx = -radius; dx <= radius; dx++) {
      if (dx * dx + dy * dy > radius * radius) continue;
      const idx = world.idx(cx + dx, cy + dy);
      if (world.cells[idx] !== Cell.DOOR) continue;
      const door = world.doors.get(idx);
      if (door?.state === DoorState.HERMETIC_OPEN) return true;
    }
  }
  return false;
}

function falsePatrolDoorPassable(world: World, x: number, y: number): boolean {
  const idx = world.idx(x, y);
  return (world.cells[idx] === Cell.FLOOR || world.cells[idx] === Cell.WATER) && !world.solid(x, y);
}

function falsePatrolDoorStandCell(world: World, doorIdx: number, e: Entity): { x: number; y: number } | null {
  const x = doorIdx % W;
  const y = (doorIdx / W) | 0;
  const dirs = [
    [1, 0],
    [-1, 0],
    [0, 1],
    [0, -1],
  ] as const;
  let best: { x: number; y: number } | null = null;
  let bestD2 = Infinity;
  for (const [dx, dy] of dirs) {
    const sx = world.wrap(x + dx);
    const sy = world.wrap(y + dy);
    if (!falsePatrolDoorPassable(world, sx, sy)) continue;
    const d2 = world.dist2(e.x, e.y, sx + 0.5, sy + 0.5);
    if (d2 < bestD2) {
      bestD2 = d2;
      best = { x: sx, y: sy };
    }
  }
  return best;
}

function falsePatrolDoorValid(world: World, doorIdx: number): boolean {
  if (world.cells[doorIdx] !== Cell.DOOR) return false;
  const door = world.doors.get(doorIdx);
  return !!door && door.state !== DoorState.LOCKED;
}

function findFalsePatrolDoor(world: World, e: Entity): number | undefined {
  const ai = e.ai!;
  const cached = ai.falsePatrolDoorIdx;
  if (cached !== undefined && falsePatrolDoorValid(world, cached)) {
    const x = cached % W;
    const y = (cached / W) | 0;
    if (world.dist2(e.x, e.y, x + 0.5, y + 0.5) <= (BLACK_LIQUIDATOR_DOOR_SCAN_RADIUS + 2) ** 2) return cached;
  }

  const ex = Math.floor(e.x);
  const ey = Math.floor(e.y);
  let best: number | undefined;
  let bestScore = Infinity;
  for (let dy = -BLACK_LIQUIDATOR_DOOR_SCAN_RADIUS; dy <= BLACK_LIQUIDATOR_DOOR_SCAN_RADIUS; dy++) {
    for (let dx = -BLACK_LIQUIDATOR_DOOR_SCAN_RADIUS; dx <= BLACK_LIQUIDATOR_DOOR_SCAN_RADIUS; dx++) {
      const x = world.wrap(ex + dx);
      const y = world.wrap(ey + dy);
      const idx = world.idx(x, y);
      if (!falsePatrolDoorValid(world, idx)) continue;
      if (!falsePatrolDoorStandCell(world, idx, e)) continue;
      const d2 = world.dist2(e.x, e.y, x + 0.5, y + 0.5);
      const score = d2 + (((idx ^ e.id) & 15) * 0.05);
      if (score < bestScore) {
        bestScore = score;
        best = idx;
      }
    }
  }
  return best;
}

function publishFalseLiquidatorKnock(
  state: GameState | undefined,
  world: World,
  e: Entity,
  doorIdx: number,
): void {
  if (!state) return;
  const x = doorIdx % W;
  const y = (doorIdx / W) | 0;
  publishEvent(state, {
    type: 'false_liquidator_knock',
    zoneId: zoneIdAt(world, x, y),
    roomId: world.roomAt(x + 0.5, y + 0.5)?.id,
    x: x + 0.5,
    y: y + 0.5,
    actorId: e.id,
    actorName: entityDisplayName(e),
    actorFaction: e.faction,
    monsterKind: MonsterKind.BLACK_LIQUIDATOR,
    severity: 3,
    privacy: 'local',
    tags: ['monster', 'black_liquidator', 'false_cleanup', 'knock'],
    data: {
      doorIdx,
      rumorIds: BLACK_LIQUIDATOR_RUMOR_IDS,
      counterplay: 'verify mask number, keep door closed, hide samples',
    },
  });
}

function publishFalseLiquidatorRevealed(
  state: GameState | undefined,
  world: World,
  e: Entity,
  player: Entity | undefined,
  reason: string,
): void {
  if (!state) return;
  publishEvent(state, {
    type: 'false_liquidator_revealed',
    zoneId: zoneIdAt(world, e.x, e.y),
    roomId: world.roomAt(e.x, e.y)?.id,
    x: e.x,
    y: e.y,
    actorId: e.id,
    actorName: entityDisplayName(e),
    actorFaction: e.faction,
    targetId: player?.id,
    targetName: player ? entityDisplayName(player) : undefined,
    targetFaction: player?.faction,
    monsterKind: MonsterKind.BLACK_LIQUIDATOR,
    severity: 4,
    privacy: 'local',
    tags: ['monster', 'black_liquidator', 'false_cleanup', 'revealed', reason],
    data: {
      reason,
      rumorIds: BLACK_LIQUIDATOR_RUMOR_IDS,
      counterplay: 'break distance, close doors, drop or hide forbidden samples',
    },
  });
}

function revealFalseLiquidator(
  world: World,
  e: Entity,
  player: Entity | undefined,
  reason: string,
  time: number,
  msgs: Msg[],
  state?: GameState,
): void {
  const ai = e.ai!;
  if (ai.falsePatrolRevealed || e.monsterStage === 1) return;
  ai.falsePatrolRevealed = true;
  e.monsterStage = 1;
  ai.path = [];
  ai.pi = 0;
  ai.timer = 0;
  if (player) ai.combatTargetId = player.id;
  const line = reason === 'forbidden_sample'
    ? 'Черный ликвидатор наклонил маску к пробе. Номер на ней стерся: это не зачистка.'
    : reason === 'hermetic_door'
      ? 'Черный ликвидатор замер у открытой гермы. Красные линзы вспыхнули не по уставу.'
      : 'Черный ликвидатор подошел слишком ровно. Под маской нет живого дыхания.';
  msgs.push(msg(line, time, '#f84'));
  publishFalseLiquidatorRevealed(state, world, e, player, reason);
}

function updateNelyudCloseReveal(
  world: World,
  e: Entity,
  target: Entity,
  time: number,
  msgs: Msg[],
  state?: GameState,
): void {
  if (!hasAIFlag(e, 'closeReveal') || e.monsterKind !== MonsterKind.NELYUD || !e.ai) return;
  if (e.ai.lastSeenTargetId === target.id) return;
  if (world.dist2(e.x, e.y, target.x, target.y) > NELYUD_REVEAL_SQ) return;

  e.ai.lastSeenTargetId = target.id;
  if (isPlayerEntity(target)) {
    msgs.push(msg('Сосед перестал моргать. Нелюдь раскрылась слишком близко; держите свет, свидетеля и выход.', time, '#f84'));
  }
  publishMonsterReadabilityEvent(state, world, e, target, 'monster_sighted', isPlayerEntity(target) ? 4 : 3, ['nelyud', 'close_reveal', 'mimic_threshold'], {
    reason: 'close_distance_reveal',
    light: Math.round(Math.max(entityLight(world, e), entityLight(world, target)) * 100) / 100,
    counterplay: 'distance_light_witness_exit',
  });
}

function updateFalseLiquidatorPatrol(
  world: World,
  e: Entity,
  dt: number,
  time: number,
  msgs: Msg[],
  player: Entity | undefined,
  state?: GameState,
): boolean {
  if (e.monsterKind !== MonsterKind.BLACK_LIQUIDATOR || !hasAIFlag(e, 'falsePatrol')) return false;
  const ai = e.ai!;
  if (ai.falsePatrolRevealed || e.monsterStage === 1) return false;

  if (player?.alive) {
    const pd2 = world.dist2(e.x, e.y, player.x, player.y);
    if (pd2 <= BLACK_LIQUIDATOR_CLOSE_REVEAL_SQ) {
      revealFalseLiquidator(world, e, player, 'too_close', time, msgs, state);
      return false;
    }
    if (pd2 <= BLACK_LIQUIDATOR_SAMPLE_REVEAL_SQ && forbiddenCleanupSample(player)) {
      revealFalseLiquidator(world, e, player, 'forbidden_sample', time, msgs, state);
      return false;
    }
    if (pd2 <= BLACK_LIQUIDATOR_DOOR_REVEAL_SQ && nearOpenHermeticDoor(world, player.x, player.y, 4)) {
      revealFalseLiquidator(world, e, player, 'hermetic_door', time, msgs, state);
      return false;
    }
  }

  ai.goal = AIGoal.WANDER;
  ai.combatTargetId = undefined;
  ai.falsePatrolScanCd = (ai.falsePatrolScanCd ?? 0) - dt;
  ai.falsePatrolKnockCd = (ai.falsePatrolKnockCd ?? 0) - dt;
  ai.timer -= dt;

  if (ai.falsePatrolScanCd <= 0 || ai.path.length === 0 || ai.pi >= ai.path.length || ai.timer <= 0) {
    const doorIdx = findFalsePatrolDoor(world, e);
    ai.falsePatrolDoorIdx = doorIdx;
    ai.falsePatrolScanCd = 2.5 + ((e.id & 3) * 0.35);
    ai.timer = 2.2;
    if (doorIdx !== undefined) {
      const stand = falsePatrolDoorStandCell(world, doorIdx, e);
      if (stand) tryAssignPathToCell(world, e, stand.x, stand.y);
    } else {
      wanderNearby(world, e);
    }
  }

  const doorIdx = ai.falsePatrolDoorIdx;
  if (doorIdx !== undefined && falsePatrolDoorValid(world, doorIdx)) {
    const x = doorIdx % W;
    const y = (doorIdx / W) | 0;
    if (world.dist2(e.x, e.y, x + 0.5, y + 0.5) <= BLACK_LIQUIDATOR_KNOCK_RANGE_SQ && ai.falsePatrolKnockCd <= 0) {
      ai.falsePatrolKnockCd = BLACK_LIQUIDATOR_KNOCK_COOLDOWN_SEC + ((e.id & 3) * 1.1);
      msgs.push(msg('За дверью три сухих удара: "Зачистка. Откройте для сверки".', time, '#aaa'));
      publishFalseLiquidatorKnock(state, world, e, doorIdx);
    }
  }

  const oldSpeed = e.speed;
  e.speed = oldSpeed * 0.62;
  followMonsterPath(world, e, dt);
  e.speed = oldSpeed;
  return true;
}

function cutMetalSheet(target: Entity): boolean {
  if (!target.inventory) return false;
  for (let i = 0; i < target.inventory.length; i++) {
    const slot = target.inventory[i];
    if (slot.defId !== 'metal_sheet' || slot.count <= 0) continue;
    slot.count--;
    if (slot.count <= 0) target.inventory.splice(i, 1);
    return true;
  }
  return false;
}

export function findCombatTarget(
  world: World, entities: Entity[], e: Entity, dt: number,
  rangeSq: number, scanCd: number,
  typeFilter: (other: Entity) => boolean,
): Entity | null {
  const ai = e.ai!;
  let target: Entity | null = null;

  ai.combatScanCd = (ai.combatScanCd ?? 0) - dt;
  if (ai.combatTargetId !== undefined) {
    const cached = _entityById.get(ai.combatTargetId);
    if (cached && cached.alive && typeFilter(cached)) {
      const d2 = world.dist2(e.x, e.y, cached.x, cached.y);
      if (d2 < rangeSq && isHostile(e, cached)) { target = cached; }
    }
    if (!target) ai.combatTargetId = undefined;
  }

  if (!target && ai.combatScanCd! > 0) {
    target = findImmediateCombatTarget(world, e, Math.min(rangeSq, IMMEDIATE_THREAT_RADIUS_SQ), typeFilter);
    if (target) {
      ai.combatTargetId = target.id;
      ai.goal = AIGoal.HUNT;
      ai.combatScanCd = Math.min(ai.combatScanCd!, 0.15);
      return target;
    }
  }

  // Always rescan periodically to switch to closer targets
  if (ai.combatScanCd! <= 0) {
    ai.combatScanCd = scanCd;
    let newTarget: Entity | null = null;
    let newBest = rangeSq;
    const queryMask = combatTargetQueryMask(typeFilter);
    ensureEntityIndex(entities).queryRadiusCapped(e.x, e.y, Math.sqrt(rangeSq), combatQuery, queryMask, COMBAT_TARGET_SCAN_CAP);
    for (const other of combatQuery) {
      if (!other.alive || other.id === e.id) continue;
      if (!typeFilter(other)) continue;
      const d2 = world.dist2(e.x, e.y, other.x, other.y);
      if (d2 >= newBest) continue;
      if (!isHostile(e, other)) continue;
      newBest = d2;
      newTarget = other;
    }
    if (newTarget && (!target || newBest < world.dist2(e.x, e.y, target.x, target.y) * 0.72)) {
      target = newTarget;
      ai.combatTargetId = newTarget.id;
    }
  }

  return target;
}

function findImmediateCombatTarget(
  world: World,
  e: Entity,
  rangeSq: number,
  typeFilter: (other: Entity) => boolean,
): Entity | null {
  let target: Entity | null = null;
  let best = rangeSq;
  const queryMask = combatTargetQueryMask(typeFilter);
  const count = getEntityIndex().queryRadiusCapped(
    e.x, e.y, Math.sqrt(rangeSq), immediateTopCandidates, queryMask, IMMEDIATE_THREAT_SCAN_CAP
  );
  for (let i = 0; i < count; i++) {
    const other = immediateTopCandidates[i];
    if (!other.alive || other.id === e.id) continue;
    if (!typeFilter(other)) continue;
    if (!isHostile(e, other)) continue;
    const d2 = world.dist2(e.x, e.y, other.x, other.y);
    if (d2 >= best) continue;
    best = d2;
    target = other;
  }
  return target;
}



function canBeMonsterTarget(other: Entity): boolean {
  return isPlayerEntity(other) || other.type === EntityType.NPC;
}

function combatTargetQueryMask(typeFilter: (other: Entity) => boolean): number {
  return typeFilter === canBeMonsterTarget ? ENTITY_MASK_NPC : ENTITY_MASK_ACTOR;
}

function hasAIFlag(e: Entity, flag: MonsterAIFlag): boolean {
  return e.monsterKind !== undefined && MONSTERS[e.monsterKind]?.aiFlags?.includes(flag) === true;
}

function fixedScanCd(e: Entity): number | undefined {
	  switch (e.monsterKind) {
    case MonsterKind.SBORKA: return 0.55;
    case MonsterKind.TVAR: return 0.85;
    case MonsterKind.POLZUN: return 1.35;
    case MonsterKind.DIKIY_MERTVYAK: return 0.5;
    case MonsterKind.GREEN_DOG: return 0.65;
    case MonsterKind.POMOYNY_ROY: return 0.55;
    case MonsterKind.SWARM: return 0.35;
    case MonsterKind.BORSHCHEVIK: return 1.15;
    case MonsterKind.BLOOD_PLANT: return 1.05;
    default: break;
  }
  if (hasAIFlag(e, 'wallBias')) return 1.1;
  if (hasAIFlag(e, 'lampPowered')) return 1.2;
  if (hasAIFlag(e, 'lightLock')) return 0.85;
  if (hasAIFlag(e, 'blackWaterWake')) return 0.75;
  if (hasAIFlag(e, 'waterPressureLine')) return 0.8;
  if (hasAIFlag(e, 'waterStrider')) return 1.3;
  if (hasAIFlag(e, 'slimeStrider')) return 1.15;
  if (hasAIFlag(e, 'rangedClause')) return 1.4;
  if (hasAIFlag(e, 'officeField')) return 1.1;
  if (hasAIFlag(e, 'debrisLurker')) return 1.25;
  if (hasAIFlag(e, 'lastSoundBeam')) return 0.85;
  if (hasAIFlag(e, 'baitLine')) return 0.75;
  if (hasAIFlag(e, 'fogOffset')) return 0.75;
  if (hasAIFlag(e, 'meatWorm')) return 0.95;
  if (hasAIFlag(e, 'lightFollower')) return LISHENNYY_SCAN_SEC;
  return undefined;
}

export function deterministicScanCd(id: number, base: number, spread: number): number {
  const h = Math.imul(id ^ 0x9E3779B9, 0x85EBCA6B) >>> 0;
  return base + ((h & 1023) / 1023) * spread;
}

function hasDocumentLikeItem(e: Entity): boolean {
  return hasDocumentScent(e);
}

function documentDetectSq(e: Entity): number {
  if (hasAIFlag(e, 'protocolPressure')) return PROTOKOLNIK_DETECT_SQ;
  return hasAIFlag(e, 'documentScent') ? KONTORSHCHIK_DETECT_SQ : PECHATEED_DETECT_SQ;
}

function documentFallbackSq(e: Entity): number {
  if (hasAIFlag(e, 'protocolPressure')) return PROTOKOLNIK_FALLBACK_SQ;
  return hasAIFlag(e, 'documentScent') ? KONTORSHCHIK_FALLBACK_SQ : PECHATEED_FALLBACK_SQ;
}

function isOfficeFieldFeature(feature: Feature): boolean {
  return feature === Feature.DESK || feature === Feature.SHELF || feature === Feature.TABLE;
}

function officeFieldRoomWeight(roomType: RoomType | undefined): number {
  switch (roomType) {
    case RoomType.OFFICE: return 0.9;
    case RoomType.STORAGE:
    case RoomType.HQ: return 0.65;
    case RoomType.COMMON:
    case RoomType.CORRIDOR: return 0.35;
    default: return 0;
  }
}

function officeFieldZoneScore(world: World, e: Entity, radius: number): number {
  const ex = Math.floor(e.x);
  const ey = Math.floor(e.y);
  let score = officeFieldRoomWeight(world.roomAt(e.x, e.y)?.type);
  for (let dy = -radius; dy <= radius; dy++) {
    for (let dx = -radius; dx <= radius; dx++) {
      if (dx * dx + dy * dy > radius * radius) continue;
      const feature = world.features[world.idx(ex + dx, ey + dy)] as Feature;
      if (!isOfficeFieldFeature(feature)) continue;
      if (feature === Feature.DESK) score += 0.34;
      else if (feature === Feature.SHELF) score += 0.28;
      else if (feature === Feature.TABLE) score += 0.2;
    }
  }
  return Math.min(3.2, score);
}

function officeFieldPressure(world: World, e: Entity, target?: Entity): number {
  if (!hasAIFlag(e, 'officeField')) return 1;
  let score = officeFieldZoneScore(world, e, 2);
  if (target) {
    score += officeFieldZoneScore(world, target, 1) * 0.55;
    if (hasDocumentLikeItem(target)) score += 1.1;
    if (world.dist2(e.x, e.y, target.x, target.y) <= KANTSELYARSKIY_IDOL_MIN_RANGE * KANTSELYARSKIY_IDOL_MIN_RANGE) score -= 1.2;
  }
  return Math.max(0.72, Math.min(1.55, 0.84 + score * 0.16));
}

function officeFieldShotRange(world: World, e: Entity, target: Entity): number {
  if (!hasAIFlag(e, 'officeField')) return RANGED_SHOT_RANGE;
  return Math.min(19, KANTSELYARSKIY_IDOL_BASE_RANGE + (officeFieldPressure(world, e, target) - 1) * 8);
}

function officeFieldEventData(world: World, e: Entity, target: Entity): Record<string, unknown> {
  if (!hasAIFlag(e, 'officeField')) return {};
  return {
    systemTag: 'office_field',
    officeFieldPressure: Math.round(officeFieldPressure(world, e, target) * 100) / 100,
    targetCarriesPaper: hasDocumentLikeItem(target),
    counterplay: 'cabinet_wall_close_or_drop_papers',
  };
}

function chervieSourceLabel(feature: Feature): string {
  return feature === Feature.APPARATUS ? 'серверный аппарат' : 'экран';
}

function chervieSignalEventData(source: ReturnType<typeof findChervieNetSource> | undefined, extra?: Record<string, unknown>): Record<string, unknown> {
  return {
    rumorIds: [...CHERVIE_RUMOR_IDS],
    sourceX: source?.x,
    sourceY: source?.y,
    sourceFeature: source?.feature,
    sourceRadius: CHERVIE_NET_SOURCE_RADIUS,
    pulseRadius: CHERVIE_MIND_PULSE_RADIUS,
    counterplay: 'break_screen_line_or_destroy_apparatus_then_use_energy',
    ...extra,
  };
}

function updateChervieNetPowerState(
  world: World,
  e: Entity,
  time: number,
  msgs: Msg[],
  player: Entity | undefined,
  state?: GameState,
): void {
  if (!hasAIFlag(e, 'netPossessor') || !e.ai) return;
  const ai = e.ai;
  const previous = ai.netPowered;
  const previousSourceX = ai.netAnchorX;
  const previousSourceY = ai.netAnchorY;
  const source = findChervieNetSource(world, e);
  const powered = source !== undefined;
  ai.netPowered = powered;
  if (source) {
    ai.netAnchorX = source.x;
    ai.netAnchorY = source.y;
  } else {
    ai.netAnchorX = undefined;
    ai.netAnchorY = undefined;
  }
  e.spriteScale = powered ? 1.13 : 0.82;

  if (powered && previous !== true) {
    if (player && world.dist2(e.x, e.y, player.x, player.y) <= MONSTER_DETECT_SQ) {
      msgs.push(msg(`Червие поймало ${chervieSourceLabel(source.feature)}: зеленая линия снова держит тело.`, time, '#6f8'));
    }
    if (state) {
      publishEvent(state, {
        type: 'chervie_signal',
        zoneId: zoneIdAt(world, e.x, e.y),
        roomId: world.roomAt(e.x, e.y)?.id,
        x: e.x,
        y: e.y,
        actorId: e.id,
        actorName: entityDisplayName(e),
        actorFaction: e.faction,
        monsterKind: MonsterKind.CHERVIE_AVATAR,
        severity: 3,
        privacy: 'local',
        tags: ['monster', 'chervie', 'net', 'powered', source.feature === Feature.APPARATUS ? 'apparatus' : 'screen'],
        data: chervieSignalEventData(source),
      });
    }
  } else if (!powered && previous === true) {
    msgs.push(msg('Зеленый свет Червие оборвался. Без экрана и аппарата кабели стали медленнее.', time, '#9cf'));
    if (state) {
      publishEvent(state, {
        type: 'chervie_server_cut',
        zoneId: zoneIdAt(world, e.x, e.y),
        roomId: world.roomAt(e.x, e.y)?.id,
        x: e.x,
        y: e.y,
        actorId: e.id,
        actorName: entityDisplayName(e),
        actorFaction: e.faction,
        monsterKind: MonsterKind.CHERVIE_AVATAR,
        severity: 4,
        privacy: 'local',
        tags: ['monster', 'chervie', 'net', 'server_cut', 'counterplay'],
        data: chervieSignalEventData(undefined, {
          previousSourceX,
          previousSourceY,
        }),
      });
    }
  }
}

function stampCherviePulseCue(world: World, e: Entity, time: number): void {
  const x = Math.floor(e.x);
  const y = Math.floor(e.y);
  const fx = ((e.x % 1) + 1) % 1;
  const fy = ((e.y % 1) + 1) % 1;
  const seed = Math.imul(e.id, 18_018) ^ Math.floor(time * 9);
  stampMark(world, x, y, fx, fy, 0.55, MarkType.PSI, seed, 58, 255, 116, 128);
  if (e.ai?.netAnchorX !== undefined && e.ai.netAnchorY !== undefined) {
    stampMark(world, e.ai.netAnchorX, e.ai.netAnchorY, 0.5, 0.5, 0.42, MarkType.PSI, seed ^ 0x715, 20, 220, 80, 105);
  }
}

export function updateChervieNetPossessor(
  world: World,
  entities: Entity[],
  e: Entity,
  dt: number,
  time: number,
  msgs: Msg[],
  playerId: number,
  state?: GameState,
): void {
  if (!hasAIFlag(e, 'netPossessor') || !e.ai || dt <= 0) return;
  const player = _entityById.get(playerId) ?? entities.find(other => other.id === playerId);
  updateChervieNetPowerState(world, e, time, msgs, player, state);
  const ai = e.ai;
  ai.netPulseCd = Math.max(0, (ai.netPulseCd ?? 0) - dt);
  if (!ai.netPowered || ai.netPulseCd > 0) return;

  getEntityIndex().queryRadiusCapped(
    e.x,
    e.y,
    CHERVIE_MIND_PULSE_RADIUS,
    cherviePulseQuery,
    ENTITY_MASK_ACTOR,
    CHERVIE_MIND_PULSE_CAP + 8,
  );

  const pulseRadiusSq = CHERVIE_MIND_PULSE_RADIUS * CHERVIE_MIND_PULSE_RADIUS;
  let affectedNpcs = 0;
  const falseOrder = !!player?.alive && world.dist2(e.x, e.y, player.x, player.y) <= pulseRadiusSq;
  if (falseOrder && player?.rpg) player.rpg.psi = Math.max(0, player.rpg.psi - 1);
  for (const other of cherviePulseQuery) {
    if (!other.alive || other.id === e.id) continue;
    if (world.dist2(e.x, e.y, other.x, other.y) > pulseRadiusSq) continue;
    if (other.id === playerId || isPlayerEntity(other)) continue;
    if (other.type !== EntityType.NPC || affectedNpcs >= CHERVIE_MIND_PULSE_CAP) continue;
    other.psiMadness = Math.max(other.psiMadness ?? 0, CHERVIE_MIND_PULSE_CONFUSION_SEC);
    if (other.ai) {
      other.ai.goal = AIGoal.HUNT;
      other.ai.combatTargetId = falseOrder ? playerId : e.id;
      other.ai.timer = 0;
      other.ai.path = [];
      other.ai.pi = 0;
    }
    affectedNpcs++;
  }

  if (!falseOrder && affectedNpcs <= 0) return;
  ai.netPulseCd = CHERVIE_MIND_PULSE_COOLDOWN_SEC;
  stampCherviePulseCue(world, e, time);
  if (falseOrder) {
    msgs.push(msg('НЕТ-экран печатает свежий приказ от твоего имени. Не выполняй его: это Червие.', time, '#6f8'));
  } else {
    msgs.push(msg('Червие дернуло локальную сеть. Люди рядом слышат чужой приказ.', time, '#6f8'));
  }
  if (!state) return;
  publishEvent(state, {
    type: falseOrder ? 'chervie_false_order' : 'chervie_signal',
    zoneId: zoneIdAt(world, e.x, e.y),
    roomId: world.roomAt(e.x, e.y)?.id,
    x: e.x,
    y: e.y,
    actorId: e.id,
    actorName: entityDisplayName(e),
    actorFaction: e.faction,
    targetId: falseOrder ? playerId : undefined,
    targetName: falseOrder ? player?.name ?? 'Вы' : undefined,
    targetFaction: falseOrder ? player?.faction : undefined,
    monsterKind: MonsterKind.CHERVIE_AVATAR,
    severity: falseOrder ? 5 : 4,
    privacy: falseOrder ? 'private' : 'local',
    tags: ['monster', 'chervie', 'net', 'mind_pulse', falseOrder ? 'false_order' : 'npc_confusion'],
    data: chervieSignalEventData(findChervieNetSource(world, e), {
      affectedNpcs,
      pulseCap: CHERVIE_MIND_PULSE_CAP,
      cooldownSec: CHERVIE_MIND_PULSE_COOLDOWN_SEC,
      confusionSec: CHERVIE_MIND_PULSE_CONFUSION_SEC,
      playerPsiLoss: falseOrder ? 1 : 0,
    }),
  });
}

interface ZhornayaScentTarget {
  x: number;
  y: number;
  entity?: Entity;
  bait?: MonsterBaitMarker;
  source: 'bait' | 'drop' | 'carrier' | 'target';
  score: number;
}

function itemScentScore(defId: string): number {
  const def = ITEMS[defId];
  if (!def) return 0;
  const tags = ITEM_TAGS[defId] ?? def.tags ?? [];
  let score = def.type === ItemType.FOOD ? 1.1 : 0;
  if (tags.includes('bait_meat')) score += 1.55;
  if (tags.includes('bait_food')) score += 0.55;
  if (tags.includes('bait_stale')) score += 0.24;
  if (tags.includes('bait_risky') || tags.includes('bait_trap')) score += 0.45;
  if (tags.includes('bait_fungal')) score += 0.35;
  if (tags.includes('bait_sealed')) score *= 0.2;
  if (defId === 'meat_rune' || defId === 'psi_meat_hook') score = Math.max(score, 1.45);
  return score;
}

function inventoryScentScore(e: Entity): number {
  let score = 0;
  for (const item of e.inventory ?? []) {
    if (item.count <= 0) continue;
    score += itemScentScore(item.defId) * Math.min(3, item.count);
  }
  return score;
}

function pomoynyRoyScentScore(e: Entity): number {
  let score = 0;
  for (const item of e.inventory ?? []) {
    if (item.count <= 0) continue;
    const def = ITEMS[item.defId];
    if (!def) continue;
    const tags = ITEM_TAGS[item.defId] ?? def.tags ?? [];
    let itemScore = itemScentScore(item.defId);
    if (tags.includes('govnyak') || tags.includes('bait_govnyak')) itemScore += 1.35;
    if (tags.includes('bait_food')) itemScore += 0.35;
    if (itemScore <= 0) continue;
    score += itemScore * Math.min(3, item.count);
  }
  return score;
}

function pomoynyRoyDetectSq(e: Entity, player: Entity | undefined, fallback: number): number {
  if (!hasAIFlag(e, 'garbageSurround') || !player?.alive) return fallback;
  const scent = pomoynyRoyScentScore(player);
  if (scent <= 0.2) return fallback;
  const radius = Math.min(POMOYNY_ROY_MAX_SCENT_DETECT, Math.sqrt(fallback) + 3.5 + Math.min(5, scent) * 2.4);
  return Math.max(fallback, radius * radius);
}

function droppedScentScore(e: Entity): number {
  if (e.type !== EntityType.ITEM_DROP || !e.alive) return 0;
  return inventoryScentScore(e);
}

function pointOffPlayerPath(world: World, monster: Entity, target: Entity | null, x: number, y: number): boolean {
  if (!target) return true;
  const px = world.delta(monster.x, target.x);
  const py = world.delta(monster.y, target.y);
  const bx = world.delta(monster.x, x);
  const by = world.delta(monster.y, y);
  const len2 = px * px + py * py;
  if (len2 <= 0.01) return true;
  const t = (bx * px + by * py) / len2;
  if (t < 0.08 || t > 1.15) return true;
  const lx = px * t;
  const ly = py * t;
  const off2 = (bx - lx) * (bx - lx) + (by - ly) * (by - ly);
  return off2 > 1.15 * 1.15;
}

function traceClearPoint(world: World, e: Entity, x: number, y: number, maxDist: number): boolean {
  const dx = world.delta(e.x, x);
  const dy = world.delta(e.y, y);
  const dist = Math.sqrt(dx * dx + dy * dy);
  if (dist > maxDist) return false;
  const steps = Math.max(2, Math.ceil(dist * 2));
  for (let i = 1; i < steps; i++) {
    const t = i / steps;
    if (world.solid(Math.floor(world.wrap(e.x + dx * t)), Math.floor(world.wrap(e.y + dy * t)))) return false;
  }
  return true;
}

function findZhornayaCarrierTarget(world: World, e: Entity): ZhornayaScentTarget | null {
  let best: ZhornayaScentTarget | null = null;
  let bestAdjusted = Infinity;
  getEntityIndex().queryRadiusCapped(
    e.x,
    e.y,
    ZHORNAYA_CARRIER_SCAN_RADIUS,
    zhornayaCarrierQuery,
    ENTITY_MASK_ACTOR,
    ZHORNAYA_CARRIER_SCAN_CAP,
  );
  for (const other of zhornayaCarrierQuery) {
    if (!other.alive || other.id === e.id || !canBeMonsterTarget(other)) continue;
    if (!isHostile(e, other)) continue;
    const score = inventoryScentScore(other);
    if (score <= 0.6) continue;
    const d2 = world.dist2(e.x, e.y, other.x, other.y);
    if (d2 > ZHORNAYA_SCENT_RADIUS_SQ) continue;
    const adjusted = d2 / (score * score);
    if (adjusted >= bestAdjusted) continue;
    bestAdjusted = adjusted;
    best = { x: other.x, y: other.y, entity: other, source: 'carrier', score };
  }
  return best;
}

function findZhornayaDropTarget(world: World, e: Entity, target: Entity | null): ZhornayaScentTarget | null {
  let best: ZhornayaScentTarget | null = null;
  let bestAdjusted = Infinity;
  getEntityIndex().queryRadiusCapped(
    e.x,
    e.y,
    ZHORNAYA_DROP_SCAN_RADIUS,
    zhornayaDropQuery,
    ENTITY_MASK_ITEM_DROP,
    ZHORNAYA_DROP_SCAN_CAP,
  );
  for (const drop of zhornayaDropQuery) {
    const score = droppedScentScore(drop);
    if (score <= 0.4) continue;
    if (!pointOffPlayerPath(world, e, target, drop.x, drop.y)) continue;
    const d2 = world.dist2(e.x, e.y, drop.x, drop.y);
    const adjusted = d2 / (score * score);
    if (adjusted >= bestAdjusted) continue;
    bestAdjusted = adjusted;
    best = { x: drop.x, y: drop.y, entity: drop, source: 'drop', score };
  }
  return best;
}

function zhornayaScentScanInterval(e: Entity): number {
  return ZHORNAYA_SCENT_SCAN_SEC + (e.id & 3) * 0.018;
}

function zhornayaTargetFallback(target: Entity | null): ZhornayaScentTarget | null {
  return target ? { x: target.x, y: target.y, entity: target, source: 'target', score: 0.35 } : null;
}

function validCachedZhornayaScent(
  world: World,
  e: Entity,
  target: Entity | null,
  scent: ZhornayaScentTarget | null,
  time: number,
): ZhornayaScentTarget | null {
  if (!scent) return null;
  if (scent.bait) {
    if (!getActiveMonsterBaits().includes(scent.bait)) return null;
    if (scent.bait.expiresAt <= time || scent.bait.attractedCount >= scent.bait.maxAttractions) return null;
    if (!pointOffPlayerPath(world, e, target, scent.bait.x, scent.bait.y)) return null;
    scent.x = scent.bait.x;
    scent.y = scent.bait.y;
    scent.score = scent.bait.strength + scent.bait.risk * 0.2;
    return scent;
  }
  const entity = scent.entity;
  if (!entity?.alive) return null;
  if (scent.source === 'drop') {
    if (entity.type !== EntityType.ITEM_DROP) return null;
    const score = droppedScentScore(entity);
    if (score <= 0.4 || !pointOffPlayerPath(world, e, target, entity.x, entity.y)) return null;
    if (world.dist2(e.x, e.y, entity.x, entity.y) > ZHORNAYA_DROP_SCAN_RADIUS * ZHORNAYA_DROP_SCAN_RADIUS) return null;
    scent.x = entity.x;
    scent.y = entity.y;
    scent.score = score;
    return scent;
  }
  if (scent.source === 'carrier') {
    if (!canBeMonsterTarget(entity) || !isHostile(e, entity)) return null;
    const score = inventoryScentScore(entity);
    if (score <= 0.6 || world.dist2(e.x, e.y, entity.x, entity.y) > ZHORNAYA_SCENT_RADIUS_SQ) return null;
    scent.x = entity.x;
    scent.y = entity.y;
    scent.score = score;
    return scent;
  }
  if (scent.source === 'target') {
    if (target?.id !== entity.id || !isHostile(e, entity)) return null;
    scent.x = entity.x;
    scent.y = entity.y;
    return scent;
  }
  return null;
}

function findZhornayaCadencedScentTarget(
  world: World,
  e: Entity,
  target: Entity | null,
  time: number,
): ZhornayaScentTarget | null {
  let runtime = zhornayaScentRuntime.get(e);
  if (runtime && time < runtime.nextScanAt) {
    const cached = validCachedZhornayaScent(world, e, target, runtime.scent, time);
    if (cached) return cached;
    return zhornayaTargetFallback(target);
  }

  if (!runtime) {
    runtime = { nextScanAt: 0, scent: null };
    zhornayaScentRuntime.set(e, runtime);
  }
  runtime.nextScanAt = time + zhornayaScentScanInterval(e);
  runtime.scent = findZhornayaDropTarget(world, e, target) ?? findZhornayaCarrierTarget(world, e) ?? zhornayaTargetFallback(target);
  return runtime.scent;
}

function findZhornayaScentTarget(
  world: World,
  e: Entity,
  target: Entity | null,
  dt: number,
  time: number,
  state?: GameState,
): ZhornayaScentTarget | null {
  const bait = findMonsterBaitTarget(
    world,
    e,
    dt,
    time,
    state,
    undefined,
    marker => pointOffPlayerPath(world, e, target, marker.x, marker.y),
  );
  if (bait) {
    return { x: bait.x, y: bait.y, bait, source: 'bait', score: bait.strength + bait.risk * 0.2 };
  }

  return findZhornayaCadencedScentTarget(world, e, target, time);
}

function hasRawMeatItem(e: Entity): boolean {
  for (const item of e.inventory ?? []) {
    if (item.count > 0 && item.defId === 'rawmeat') return true;
  }
  return false;
}

function isHeavyBleedingTarget(e: Entity): boolean {
  if (e.hp === undefined || e.maxHp === undefined || e.maxHp <= 0) return false;
  return e.hp > 0 && e.hp / e.maxHp <= 0.42;
}

function isOlgoyScentedTarget(e: Entity): boolean {
  return hasRawMeatItem(e) || isHeavyBleedingTarget(e);
}

function canOlgoyTarget(world: World, e: Entity, target: Entity): boolean {
  const limit = isOlgoyScentedTarget(target) ? OLGOY_BLOOD_RADIUS : OLGOY_DETECT_RADIUS;
  return world.dist2(e.x, e.y, target.x, target.y) <= limit * limit;
}

export function olgoyAmbushCell(world: World, x: number, y: number): boolean {
  const ci = world.idx(x, y);
  const cell = world.cells[ci];
  return cell === Cell.WATER ||
    cell === Cell.ABYSS ||
    world.floorTex[ci] === Tex.F_WATER ||
    world.wallTex[ci] === Tex.PIPE ||
    world.features[ci] === Feature.SINK ||
    world.features[ci] === Feature.TOILET;
}

export function olgoyNearAmbushTerrain(world: World, e: Entity, radius = OLGOY_AMBUSH_RADIUS): boolean {
  const ex = Math.floor(e.x);
  const ey = Math.floor(e.y);
  for (let dy = -radius; dy <= radius; dy++) {
    for (let dx = -radius; dx <= radius; dx++) {
      if (dx * dx + dy * dy > radius * radius) continue;
      if (olgoyAmbushCell(world, ex + dx, ey + dy)) return true;
    }
  }
  return false;
}

export function olgoyTerrainMoveMult(world: World, e: Entity): number {
  return olgoyNearAmbushTerrain(world, e) ? 1.12 : 0.55;
}

export function olgoyTerrainDmgMult(world: World, e: Entity, target?: Entity): number {
  if (olgoyNearAmbushTerrain(world, e)) return 1.44;
  if (target && olgoyNearAmbushTerrain(world, target, 1)) return 1.22;
  return 0.82;
}

function publishOlgoyFed(
  state: GameState | undefined,
  world: World,
  e: Entity,
  target: Entity | undefined,
  time: number,
  source: 'bait' | 'corpse',
  data?: Record<string, unknown>,
): void {
  if (!state) return;
  publishEvent(state, {
    type: 'olgoy_fed',
    time,
    zoneId: zoneIdAt(world, e.x, e.y),
    x: e.x,
    y: e.y,
    actorId: e.id,
    actorName: entityDisplayName(e),
    actorFaction: e.faction,
    targetId: target?.id,
    targetName: target ? entityDisplayName(target) : undefined,
    targetFaction: target?.faction,
    monsterKind: MonsterKind.OLGOY,
    severity: source === 'corpse' ? 3 : 2,
    privacy: 'local',
    tags: ['monster', 'olgoy', 'meat_worm', 'fed', source],
    data: { source, ...data },
  });
}

function tryConsumeMeatChunk(
  world: World,
  entities: readonly Entity[],
  e: Entity,
  target: Entity | null,
  dt: number,
  time: number,
  msgs: Msg[],
  state?: GameState,
): boolean {
  if (target && world.dist2(e.x, e.y, target.x, target.y) <= 12) return false;
  
  const ai = e.ai!;
  const isOlgoy = hasAIFlag(e, 'meatWorm');
  const maxRadius = isOlgoy ? OLGOY_CORPSE_RADIUS : 16;
  
  if (!isOlgoy && !isCarnivoreMonster(e.monsterKind)) return false;
  if (!isOlgoy && (e.hp ?? 0) >= (e.maxHp ?? 100)) return false;

  if (isOlgoy) {
    const corpse = entities.find(other => 
      other.id !== e.id && 
      !other.alive && 
      world.dist2(e.x, e.y, other.x, other.y) <= maxRadius * maxRadius
    );
    if (corpse) {
      if (world.dist2(e.x, e.y, corpse.x, corpse.y) <= 2.0 * 2.0) {
        msgs.push(msg(`${entityDisplayName(e)} утянул труп ${entityDisplayName(corpse)} в коллектор`, time, '#c86'));
        if (state) publishOlgoyFed(state, world, e, corpse, time, 'corpse', { corpseType: 'npc' });
        return true;
      } else {
        ai.goal = AIGoal.HUNT;
        ai.combatTargetId = undefined;
        ai.timer -= dt;
        if (ai.path.length === 0 || ai.timer <= 0 || ai.tx !== Math.floor(corpse.x) || ai.ty !== Math.floor(corpse.y)) {
          tryAssignPathToCell(world, e, Math.floor(corpse.x), Math.floor(corpse.y));
          ai.timer = 1.5;
        }
        followMonsterPath(world, e, dt);
        return true;
      }
    }
  }

  ai.meatScanCd = (ai.meatScanCd ?? 0) - dt;
  if (ai.meatScanCd <= 0) {
    ai.meatScanCd = deterministicScanCd(e.id, 2.5, 0.5);
    const chunkCell = findMeatChunkCell(world, e.x, e.y, maxRadius);
    if (chunkCell) {
      ai.meatTargetId = chunkCell.x * 10000 + chunkCell.y;
    } else {
      ai.meatTargetId = undefined;
    }
  }

  if (ai.meatTargetId === undefined) return false;
  
  const chunkX = Math.floor(ai.meatTargetId / 10000);
  const chunkY = ai.meatTargetId % 10000;

  ai.goal = AIGoal.HUNT;
  ai.combatTargetId = undefined;
  
  if (world.dist2(e.x, e.y, chunkX, chunkY) <= 1.35 * 1.35) {
    removeVisualSlotCode(world, world.idx(chunkX, chunkY), 34);
    
    if (isOlgoy) {
      msgs.push(msg(`${entityDisplayName(e)} утянул кусок мяса в коллектор`, time, '#c86'));
      if (state) publishOlgoyFed(state, world, e, e, time, 'corpse', { corpseType: 'chunk' });
    } else {
      msgs.push(msg(`${entityDisplayName(e)} сожрал кусок мяса`, time, '#c44'));
      e.hp = Math.min(e.maxHp ?? 100, (e.hp ?? 0) + 25);
    }
    ai.meatTargetId = undefined;
    ai.path = [];
    ai.pi = 0;
    return true;
  }

  ai.timer -= dt;
  if (ai.path.length === 0 || ai.timer <= 0 || ai.tx !== chunkX || ai.ty !== chunkY) {
    tryAssignPathToCell(world, e, chunkX, chunkY);
    ai.timer = 1.5;
  }
  followMonsterPath(world, e, dt);
  return true;
}

function findMeatWormTarget(world: World, e: Entity, dt: number): Entity | null {
  const ai = e.ai!;
  let target: Entity | null = null;
  const normalSq = OLGOY_DETECT_RADIUS * OLGOY_DETECT_RADIUS;
  const bloodSq = OLGOY_BLOOD_RADIUS * OLGOY_BLOOD_RADIUS;

  ai.combatScanCd = (ai.combatScanCd ?? 0) - dt;
  if (ai.combatTargetId !== undefined) {
    const cached = _entityById.get(ai.combatTargetId);
    if (cached?.alive && canBeMonsterTarget(cached) && isHostile(e, cached)) {
      const scented = isOlgoyScentedTarget(cached);
      const d2 = world.dist2(e.x, e.y, cached.x, cached.y);
      if (d2 <= (scented ? bloodSq : normalSq)) target = cached;
    }
    if (!target) ai.combatTargetId = undefined;
  }
  if (target || ai.combatScanCd > 0) return target;
  ai.combatScanCd = deterministicScanCd(e.id, 0.95, 0.45);

  let bestScore = bloodSq;
  getEntityIndex().queryRadiusCapped(e.x, e.y, OLGOY_BLOOD_RADIUS, combatQuery, ENTITY_MASK_ACTOR, OLGOY_SCENT_SCAN_CAP);
  for (const other of combatQuery) {
    if (!other.alive || other.id === e.id || !canBeMonsterTarget(other)) continue;
    if (!isHostile(e, other)) continue;
    const d2 = world.dist2(e.x, e.y, other.x, other.y);
    const meat = hasRawMeatItem(other);
    const bleeding = isHeavyBleedingTarget(other);
    if (!meat && !bleeding && d2 > normalSq) continue;
    let score = d2;
    if (meat) score *= 0.34;
    if (bleeding) score *= 0.52;
    if (isPlayerEntity(other)) score *= 0.86;
    if (score >= bestScore) continue;
    bestScore = score;
    target = other;
  }
  if (target) ai.combatTargetId = target.id;
  return target;
}




function updateOlgoyReadability(world: World, e: Entity, target: Entity, time: number, msgs: Msg[], playerId: number, state?: GameState): void {
  if (e.monsterKind !== MonsterKind.OLGOY || target.id !== playerId || e.ai?.lastSeenTargetId === playerId) return;
  if (!olgoyNearAmbushTerrain(world, e)) return;
  e.ai!.lastSeenTargetId = playerId;
  msgs.push(msg('Олгой-Хорхой поднялся из трубы. Сухой пол и мясная приманка сейчас важнее геройства.', time, '#fa6'));
  if (!state) return;
  publishEvent(state, {
    type: 'olgoy_burrowed',
    time,
    zoneId: zoneIdAt(world, e.x, e.y),
    x: e.x,
    y: e.y,
    actorId: e.id,
    actorName: entityDisplayName(e),
    actorFaction: e.faction,
    targetId: target.id,
    targetName: entityDisplayName(target),
    targetFaction: target.faction,
    monsterKind: MonsterKind.OLGOY,
    severity: 4,
    privacy: 'local',
    tags: ['monster', 'olgoy', 'meat_worm', 'burrowed', 'ambush'],
    data: { counterplay: 'dry_floor_or_rawmeat_bait', terrain: 'water_pipe_abyss' },
  });
}

function tryOlgoyDragTarget(world: World, e: Entity, target: Entity, time: number, msgs: Msg[], state?: GameState): void {
  if (e.monsterKind !== MonsterKind.OLGOY || !target.alive || !olgoyNearAmbushTerrain(world, e)) return;
  const dx = world.delta(target.x, e.x);
  const dy = world.delta(target.y, e.y);
  const dist = Math.sqrt(dx * dx + dy * dy);
  if (dist <= 0.2) return;
  const step = Math.min(OLGOY_DRAG_STEP, Math.max(0, dist - 0.55));
  if (step <= 0) return;
  const nx = world.wrap(target.x + (dx / dist) * step);
  const ny = world.wrap(target.y + (dy / dist) * step);
  if (world.solid(Math.floor(nx), Math.floor(ny))) return;
  target.x = nx;
  target.y = ny;
  msgs.push(msg(`${entityDisplayName(e)} подтянул ${isPlayerEntity(target) ? 'тебя' : entityDisplayName(target)} к трубе`, time, '#f86'));
  if (!state) return;
  publishEvent(state, {
    type: 'olgoy_dragged_target',
    time,
    zoneId: zoneIdAt(world, e.x, e.y),
    x: e.x,
    y: e.y,
    actorId: e.id,
    actorName: entityDisplayName(e),
    actorFaction: e.faction,
    targetId: target.id,
    targetName: entityDisplayName(target),
    targetFaction: target.faction,
    monsterKind: MonsterKind.OLGOY,
    severity: isPlayerEntity(target) ? 4 : 3,
    privacy: isPlayerEntity(target) ? 'local' : 'witnessed',
    tags: ['monster', 'olgoy', 'meat_worm', 'dragged'],
    data: { dragStep: step, counterplay: 'fight_away_from_pipe_water_or_abyss' },
  });
}

function nearFeature(world: World, e: Entity, feature: Feature, radius: number): boolean {
  const ex = Math.floor(e.x);
  const ey = Math.floor(e.y);
  for (let dy = -radius; dy <= radius; dy++) {
    for (let dx = -radius; dx <= radius; dx++) {
      if (dx * dx + dy * dy > radius * radius) continue;
      const ci = world.idx(ex + dx, ey + dy);
      if (world.features[ci] === feature) return true;
    }
  }
  return false;
}

function nearDebrisFeature(world: World, e: Entity, radius: number): boolean {
  const ex = Math.floor(e.x);
  const ey = Math.floor(e.y);
  for (let dy = -radius; dy <= radius; dy++) {
    for (let dx = -radius; dx <= radius; dx++) {
      if (dx * dx + dy * dy > radius * radius) continue;
      const feature = world.features[world.idx(ex + dx, ey + dy)];
      if (feature === Feature.SHELF || feature === Feature.MACHINE || feature === Feature.APPARATUS) return true;
    }
  }
  return false;
}

function inDebrisCover(world: World, e: Entity): boolean {
  const ctx = monsterWallContext(world, e);
  return ctx.adjacentWall || ctx.narrowDoorOrCorner || ctx.debrisNearby;
}

function wallTerrainPressureActive(world: World, e: Entity, target?: Entity): boolean {
  const actorCtx = monsterWallContext(world, e);
  if (hasAIFlag(e, 'debrisLurker') && (actorCtx.debrisNearby || actorCtx.adjacentWall || actorCtx.narrowDoorOrCorner)) return true;
  if (!hasAIFlag(e, 'wallBias')) return false;
  if (actorCtx.adjacentWall || actorCtx.narrowDoorOrCorner) return true;
  if (!target) return false;
  const targetCtx = monsterWallContext(world, target);
  return targetCtx.adjacentWall || targetCtx.narrowDoorOrCorner;
}

function wallTerrainOpenBreak(world: World, e: Entity, target?: Entity): boolean {
  const actorCtx = monsterWallContext(world, e);
  if (actorCtx.openFloorScore < 0.98) return false;
  if (hasAIFlag(e, 'debrisLurker') && actorCtx.debrisNearby) return false;
  if (!target) return true;
  const targetCtx = monsterWallContext(world, target);
  if (targetCtx.openFloorScore < 0.98) return false;
  return !hasAIFlag(e, 'debrisLurker') || !targetCtx.debrisNearby;
}

function wallTerrainTag(kind: MonsterKind | undefined): string {
  switch (kind) {
    case MonsterKind.TVAR: return 'tvar';
    case MonsterKind.SHOVNIK: return 'shovnik';
    case MonsterKind.REBAR: return 'rebar';
    case MonsterKind.BETONOED: return 'betonoed';
    default: return 'wall_terrain';
  }
}

function wallTerrainCueText(kind: MonsterKind | undefined, debris: boolean): string {
  switch (kind) {
    case MonsterKind.TVAR:
      return 'Тварь царапает панель: у стены лапа достает дальше. Центр комнаты режет давление.';
    case MonsterKind.SHOVNIK:
      return 'Шовник скользит по шву. У стены он быстрее и больнее; выводите в центр.';
    case MonsterKind.REBAR:
      return debris
        ? 'Арматура звенит в складском мусоре. Держите открытый бетон и дистанцию.'
        : 'Арматура цепляет стену прутьями. Уводите ее от кромки.';
    case MonsterKind.BETONOED:
      return 'Бетоноед ведет челюсть вдоль бетонного шва. Шум, огонь или герметик решают темп.';
    default:
      return 'Монстр получил упор от стены. Открытый пол ломает преимущество.';
  }
}

function wallTerrainOpenText(kind: MonsterKind | undefined): string {
  switch (kind) {
    case MonsterKind.TVAR: return 'Тварь потеряла панель. В центре комнаты ее хват стал честнее.';
    case MonsterKind.SHOVNIK: return 'Шовник вышел с шва на открытый пол и потерял ход.';
    case MonsterKind.REBAR: return 'Арматура вышла из железного мусора: прутья читаются, темп просел.';
    case MonsterKind.BETONOED: return 'Бетоноед потерял бетонный шов и сбился с короткого выхода.';
    default: return 'Открытый пол снял стенное преимущество.';
  }
}

function updateWallTerrainReadability(
  world: World,
  e: Entity,
  target: Entity | null,
  time: number,
  msgs: Msg[],
  state: GameState | undefined,
): void {
  if (!e.ai || (!hasAIFlag(e, 'wallBias') && !hasAIFlag(e, 'debrisLurker'))) return;
  const localTarget = target?.alive && world.dist2(e.x, e.y, target.x, target.y) <= 16 * 16 ? target : undefined;
  const active = wallTerrainPressureActive(world, e, localTarget);
  const openBreak = !active && e.ai.wallBiasWasActive === true && wallTerrainOpenBreak(world, e, localTarget);
  if (!active && !openBreak) return;

  const canCue = time >= (e.ai.wallBiasCueAt ?? -Infinity);
  if (active) {
    e.ai.wallBiasWasActive = true;
    e.spriteScale = Math.max(e.spriteScale ?? 1, e.monsterKind === MonsterKind.REBAR ? 1.05 : 1.03);
    if (!localTarget || !canCue) return;
    e.ai.wallBiasCueAt = time + WALL_BIAS_CUE_COOLDOWN_SEC;
    const actorCtx = monsterWallContext(world, e);
    if (isPlayerEntity(localTarget)) msgs.push(msg(wallTerrainCueText(e.monsterKind, actorCtx.debrisNearby), time, '#ca6'));
    publishMonsterReadabilityEvent(state, world, e, localTarget, 'monster_sighted', isPlayerEntity(localTarget) ? 4 : 3, [
      wallTerrainTag(e.monsterKind),
      hasAIFlag(e, 'debrisLurker') ? 'debris_lurker' : 'wall_bias',
      actorCtx.debrisNearby ? 'debris' : 'wall_edge',
    ], monsterReadabilityEventData(e.monsterKind, {
      actorAdjacentWall: actorCtx.adjacentWall,
      actorNarrowDoorOrCorner: actorCtx.narrowDoorOrCorner,
      actorOpenFloorScore: Math.round(actorCtx.openFloorScore * 100) / 100,
      counterplay: 'open_floor_center_room_distance',
    }));
    return;
  }

  e.ai.wallBiasWasActive = false;
  if (!localTarget || !canCue) return;
  e.ai.wallBiasCueAt = time + WALL_BIAS_CUE_COOLDOWN_SEC;
  e.spriteScale = e.monsterKind === MonsterKind.REBAR ? 0.94 : 0.96;
  if (isPlayerEntity(localTarget)) msgs.push(msg(wallTerrainOpenText(e.monsterKind), time, '#9cf'));
  publishMonsterReadabilityEvent(state, world, e, localTarget, 'monster_windup_interrupted', 3, [
    wallTerrainTag(e.monsterKind),
    'open_floor',
    'wall_advantage_broken',
  ], monsterReadabilityEventData(e.monsterKind, {
    counterplay: 'open_floor',
  }));
}

function wallNeighborCount(world: World, x: number, y: number): number {
  let n = 0;
  if (world.solid(x - 1, y)) n++;
  if (world.solid(x + 1, y)) n++;
  if (world.solid(x, y - 1)) n++;
  if (world.solid(x, y + 1)) n++;
  return n;
}

interface CheapCrowdPressure {
  crowd: number;
  capped: boolean;
  choke: boolean;
}

function cheapCrowdPressure(
  world: World,
  e: Entity,
  target: Entity,
  radius: number,
  cap: number,
  out: Entity[],
): CheapCrowdPressure {
  const found = getEntityIndex().queryRadiusCapped(e.x, e.y, radius, out, ENTITY_MASK_ACTOR, cap);
  let crowd = 0;
  for (const other of out) {
    if (!other.alive || other.id === e.id || other.id === target.id) continue;
    crowd++;
  }
  const ex = Math.floor(e.x);
  const ey = Math.floor(e.y);
  const tx = Math.floor(target.x);
  const ty = Math.floor(target.y);
  const choke = wallNeighborCount(world, ex, ey) >= 2 ||
    wallNeighborCount(world, tx, ty) >= 2 ||
    world.cells[world.idx(ex, ey)] === Cell.DOOR ||
    world.cells[world.idx(tx, ty)] === Cell.DOOR;
  return { crowd, capped: found >= cap, choke };
}

function inPolzunKillCell(world: World, e: Entity): boolean {
  const x = Math.floor(e.x);
  const y = Math.floor(e.y);
  const ci = world.idx(x, y);
  return world.cells[ci] === Cell.WATER ||
    wallNeighborCount(world, x, y) >= 2 ||
    world.features[ci] === Feature.SINK ||
    world.features[ci] === Feature.TOILET;
}

function monsterMeleeRange(world: World, e: Entity): number {
  switch (e.monsterKind) {
    case MonsterKind.TVAR: return 1.55;
    case MonsterKind.POLZUN: return 1.35;
    case MonsterKind.SLIME_WOMAN: return 1.38;
    case MonsterKind.OLGOY: return 1.48;
    case MonsterKind.PANELNIK: return panelnikWallBraceActive(world, e) ? PANELNIK_BRACE_REACH : PANELNIK_OPEN_REACH;
    case MonsterKind.BLACK_LIQUIDATOR: return 1.35;
    case MonsterKind.HEAD_SLUG: return isHeadSlugDetached(e) ? 0.95 : 1.2;
    case MonsterKind.SWARM: return 1.05;
    default: return 1.2;
  }
}

function facingDotTo(world: World, from: Entity, to: Entity): number {
  const dx = world.delta(from.x, to.x);
  const dy = world.delta(from.y, to.y);
  const len = Math.sqrt(dx * dx + dy * dy);
  if (len <= 0.001) return 1;
  return (Math.cos(from.angle) * dx + Math.sin(from.angle) * dy) / len;
}

function targetBackTurned(world: World, monster: Entity, target: Entity): boolean {
  return facingDotTo(world, target, monster) <= BEZEKHIY_BACK_DOT;
}

function bezekhiyDoorOpenForLunge(world: World, doorIdx: number): boolean {
  const door = world.doors.get(doorIdx);
  return door?.state === DoorState.OPEN || door?.state === DoorState.HERMETIC_OPEN;
}

function bezekhiyDoorSide(world: World, doorIdx: number, e: Entity): number {
  const x = doorIdx % W;
  const y = (doorIdx / W) | 0;
  const fx = !world.solid(x - 1, y) || !world.solid(x + 1, y);
  const fy = !world.solid(x, y - 1) || !world.solid(x, y + 1);
  const dx = world.delta(x + 0.5, e.x);
  const dy = world.delta(y + 0.5, e.y);
  const v = fx && !fy ? dx : fy && !fx ? dy : Math.abs(dx) >= Math.abs(dy) ? dx : dy;
  return Math.abs(v) < 0.15 ? 0 : v < 0 ? -1 : 1;
}

function nearestBezekhiyDoor(world: World, e: Entity): number | undefined {
  const cached = e.ai?.deadEchoDoorIdx;
  if (cached !== undefined) {
    const x = cached % W;
    const y = (cached / W) | 0;
    if (world.cells[cached] === Cell.DOOR && world.dist2(e.x, e.y, x + 0.5, y + 0.5) <= BEZEKHIY_THRESHOLD_RADIUS_SQ) return cached;
  }

  const ex = Math.floor(e.x);
  const ey = Math.floor(e.y);
  let best: number | undefined;
  let bestD2 = (BEZEKHIY_DOOR_SCAN_RADIUS + 0.75) * (BEZEKHIY_DOOR_SCAN_RADIUS + 0.75);
  for (let dy = -BEZEKHIY_DOOR_SCAN_RADIUS; dy <= BEZEKHIY_DOOR_SCAN_RADIUS; dy++) {
    for (let dx = -BEZEKHIY_DOOR_SCAN_RADIUS; dx <= BEZEKHIY_DOOR_SCAN_RADIUS; dx++) {
      const x = world.wrap(ex + dx);
      const y = world.wrap(ey + dy);
      const idx = world.idx(x, y);
      if (world.cells[idx] !== Cell.DOOR || !world.doors.has(idx)) continue;
      const d2 = world.dist2(e.x, e.y, x + 0.5, y + 0.5);
      if (d2 < bestD2) {
        bestD2 = d2;
        best = idx;
      }
    }
  }
  return best;
}

function publishBezekhiyEvent(
  state: GameState | undefined,
  world: World,
  e: Entity,
  target: Entity,
  type: 'bezekhiy_revealed' | 'bezekhiy_lunge',
  reason: string,
  damage?: number,
): void {
  if (!state) return;
  publishEvent(state, {
    type,
    zoneId: zoneIdAt(world, e.x, e.y),
    x: e.x,
    y: e.y,
    actorId: e.id,
    actorName: entityDisplayName(e),
    actorFaction: e.faction,
    targetId: target.id,
    targetName: entityDisplayName(target),
    targetFaction: target.faction,
    monsterKind: MonsterKind.BEZEKHIY,
    severity: type === 'bezekhiy_lunge' ? 4 : 3,
    privacy: isPlayerEntity(target) ? 'local' : 'witnessed',
    tags: ['monster', 'bezekhiy', 'dead_echo', reason],
    data: { reason, damage, rumorIds: ['monster_bezekhiy_dead_echo'] },
  });
}

function revealBezekhiy(
  world: World,
  e: Entity,
  player: Entity,
  time: number,
  msgs: Msg[],
  state: GameState | undefined,
  reason: string,
): void {
  const ai = e.ai!;
  if (ai.deadEchoRevealed) return;
  ai.deadEchoRevealed = true;
  ai.deadEchoSpent = true;
  ai.deadEchoHold = 0;
  msgs.push(msg('У порога пропало эхо: Безэхий уже виден, но рывок сорван.', time, '#ccc'));
  publishBezekhiyEvent(state, world, e, player, 'bezekhiy_revealed', reason);
}

function finishBezekhiyLunge(
  world: World,
  e: Entity,
  player: Entity,
  time: number,
  msgs: Msg[],
  state: GameState | undefined,
): void {
  const ai = e.ai!;
  ai.deadEchoRevealed = true;
  ai.deadEchoSpent = true;
  ai.combatTargetId = player.id;
  ai.goal = AIGoal.HUNT;

  const dx = world.delta(e.x, player.x);
  const dy = world.delta(e.y, player.y);
  const dist = Math.max(0.001, Math.sqrt(dx * dx + dy * dy));
  const step = Math.min(BEZEKHIY_LUNGE_STEP, Math.max(0, dist - 0.72));
  const nx = world.wrap(e.x + (dx / dist) * step);
  const ny = world.wrap(e.y + (dy / dist) * step);
  if (!world.solid(Math.floor(nx), Math.floor(ny)) && traceClearPoint(world, e, nx, ny, BEZEKHIY_LUNGE_STEP + 0.4)) {
    e.x = nx;
    e.y = ny;
  }
  e.angle = Math.atan2(dy, dx);
  e.spriteScale = 1.14;

  let damage = 0;
  if (player.hp !== undefined && world.dist2(e.x, e.y, player.x, player.y) <= BEZEKHIY_LUNGE_HIT_SQ) {
    const def = MONSTERS[MonsterKind.BEZEKHIY];
    const level = e.rpg?.level ?? 1;
    const strMult = e.rpg ? strMeleeDmgMult(e.rpg) : 1;
    damage = zhelemishIncomingMeleeDamage(player, time, Math.round(scaleMonsterDmg(def.dmg, level) * strMult * BEZEKHIY_LUNGE_DAMAGE_MULT));
    if (isDebugOnePunchManEnabled()) keepDebugOnePunchManAlive(player);
    else {
      { const _dmg = calculateDamage(damage, DamageType.KINETIC, player); player.hp -= _dmg; applyHitStaggerAndKnockback(player, e.x, e.y, _dmg); }
      recordPlayerDamage(state, e, damage, `${entityDisplayName(e)} ударил из мертвого эха: -${damage}`);
      if (player.hp <= 0) {
        player.alive = false;
        player.hp = 0;
      }
    }
    spawnBloodHit(world, player.x, player.y, Math.atan2(player.y - e.y, player.x - e.x), damage, false);
  }

  e.attackCd = MONSTERS[MonsterKind.BEZEKHIY].attackRate;
  msgs.push(msg(damage > 0 ? `Безэхий сорвался с косяка за спиной: -${damage}` : 'Безэхий сорвался с косяка, но не достал.', time, damage > 0 ? '#f66' : '#fc4'));
  publishBezekhiyEvent(state, world, e, player, 'bezekhiy_lunge', 'back_threshold_crossing', damage || undefined);
  playSoundAt(playGrowl, e.x, e.y);
}

function updateBezekhiyDeadEcho(
  world: World,
  e: Entity,
  player: Entity,
  dt: number,
  time: number,
  msgs: Msg[],
  state: GameState | undefined,
): boolean {
  if (e.monsterKind !== MonsterKind.BEZEKHIY) return false;
  const ai = e.ai!;
  if (ai.deadEchoSpent) {
    ai.deadEchoRevealed = true;
    return false;
  }

  const d2 = world.dist2(e.x, e.y, player.x, player.y);
  const lookedAt = d2 <= BEZEKHIY_DETECT_SQ &&
    facingDotTo(world, player, e) >= BEZEKHIY_LOOK_DOT &&
    hasClearLine(world, player, e, Math.sqrt(BEZEKHIY_DETECT_SQ));
  ai.deadEchoHold = lookedAt ? (ai.deadEchoHold ?? 0) + dt : Math.max(0, (ai.deadEchoHold ?? 0) - dt * 1.5);
  if ((ai.deadEchoHold ?? 0) >= BEZEKHIY_LOOK_HOLD_SEC) {
    revealBezekhiy(world, e, player, time, msgs, state, 'direct_look');
    return false;
  }

  const doorIdx = nearestBezekhiyDoor(world, e);
  if (doorIdx !== undefined) {
    const doorX = doorIdx % W;
    const doorY = (doorIdx / W) | 0;
    const side = bezekhiyDoorSide(world, doorIdx, player);
    const previousSide = ai.deadEchoDoorIdx === doorIdx ? ai.deadEchoDoorSide : undefined;
    ai.deadEchoDoorIdx = doorIdx;
    if (side !== 0) ai.deadEchoDoorSide = side;
    if (previousSide !== undefined &&
        previousSide !== 0 &&
        side !== 0 &&
        previousSide !== side &&
        world.dist2(player.x, player.y, doorX + 0.5, doorY + 0.5) <= BEZEKHIY_THRESHOLD_RADIUS_SQ &&
        bezekhiyDoorOpenForLunge(world, doorIdx) &&
        targetBackTurned(world, e, player)) {
      finishBezekhiyLunge(world, e, player, time, msgs, state);
      return true;
    }
  }

  if (d2 <= BEZEKHIY_CLOSE_REVEAL_SQ) revealBezekhiy(world, e, player, time, msgs, state, 'close_radius');
  return false;
}

export interface LozhnyyDukhPhaseMove {
  doorIdx: number;
  sourceX: number;
  sourceY: number;
  landingX: number;
  landingY: number;
}

function lozhnyyDukhCanPhaseDoor(state: DoorState | undefined): boolean {
  return state === DoorState.CLOSED || state === DoorState.LOCKED;
}

function lozhnyyDukhDoorStillLocal(world: World, ai: NonNullable<Entity['ai']>): boolean {
  if (ai.falsePhaseDoorIdx === undefined || ai.falsePhaseX === undefined || ai.falsePhaseY === undefined) return false;
  const door = world.doors.get(ai.falsePhaseDoorIdx);
  if (!door || world.cells[ai.falsePhaseDoorIdx] !== Cell.DOOR || door.state === DoorState.HERMETIC_CLOSED) return false;
  return !world.solid(Math.floor(ai.falsePhaseX), Math.floor(ai.falsePhaseY));
}

function lozhnyyDukhAxisSide(world: World, doorX: number, doorY: number, e: Entity, axisX: number, _axisY: number): number {
  const v = axisX !== 0
    ? world.delta(doorX + 0.5, e.x)
    : world.delta(doorY + 0.5, e.y);
  return Math.abs(v) < 0.18 ? 0 : v < 0 ? -1 : 1;
}

function lozhnyyDukhPhaseAxisMove(
  world: World,
  e: Entity,
  target: Entity,
  doorIdx: number,
  axisX: number,
  axisY: number,
): LozhnyyDukhPhaseMove | undefined {
  const doorX = doorIdx % W;
  const doorY = (doorIdx / W) | 0;
  const monsterSide = lozhnyyDukhAxisSide(world, doorX, doorY, e, axisX, axisY);
  const targetSide = lozhnyyDukhAxisSide(world, doorX, doorY, target, axisX, axisY);
  if (monsterSide === 0 || targetSide === 0 || monsterSide === targetSide) return undefined;

  const sourceX = world.wrap(doorX + axisX * monsterSide);
  const sourceY = world.wrap(doorY + axisY * monsterSide);
  const landingCellX = world.wrap(doorX + axisX * targetSide);
  const landingCellY = world.wrap(doorY + axisY * targetSide);
  if (world.solid(sourceX, sourceY) || world.solid(landingCellX, landingCellY)) return undefined;
  if (world.dist2(e.x, e.y, sourceX + 0.5, sourceY + 0.5) > FALSE_PHASE_DOOR_RANGE_SQ) return undefined;
  if (!traceClearPoint(world, e, sourceX + 0.5, sourceY + 0.5, FALSE_PHASE_DOOR_SCAN_RADIUS + 0.75)) return undefined;

  return {
    doorIdx,
    sourceX,
    sourceY,
    landingX: landingCellX + 0.5,
    landingY: landingCellY + 0.5,
  };
}

export function getLozhnyyDukhFalsePhaseMove(world: World, e: Entity, target: Entity): LozhnyyDukhPhaseMove | undefined {
  const ex = Math.floor(e.x);
  const ey = Math.floor(e.y);
  let best: LozhnyyDukhPhaseMove | undefined;
  let bestScore = Infinity;

  for (let dy = -FALSE_PHASE_DOOR_SCAN_RADIUS; dy <= FALSE_PHASE_DOOR_SCAN_RADIUS; dy++) {
    for (let dx = -FALSE_PHASE_DOOR_SCAN_RADIUS; dx <= FALSE_PHASE_DOOR_SCAN_RADIUS; dx++) {
      const x = world.wrap(ex + dx);
      const y = world.wrap(ey + dy);
      const doorIdx = world.idx(x, y);
      const door = world.doors.get(doorIdx);
      if (world.cells[doorIdx] !== Cell.DOOR || !lozhnyyDukhCanPhaseDoor(door?.state)) continue;

      const horizontal = !world.solid(x - 1, y) && !world.solid(x + 1, y);
      const vertical = !world.solid(x, y - 1) && !world.solid(x, y + 1);
      const moves = [
        horizontal ? lozhnyyDukhPhaseAxisMove(world, e, target, doorIdx, 1, 0) : undefined,
        vertical ? lozhnyyDukhPhaseAxisMove(world, e, target, doorIdx, 0, 1) : undefined,
      ];
      for (const move of moves) {
        if (!move) continue;
        const score = world.dist2(target.x, target.y, move.landingX, move.landingY) +
          world.dist2(e.x, e.y, move.sourceX + 0.5, move.sourceY + 0.5) * 0.2;
        if (score >= bestScore) continue;
        bestScore = score;
        best = move;
      }
    }
  }

  return best;
}

function tickLozhnyyDukhFalsePhase(e: Entity, dt: number): void {
  if (e.monsterKind !== MonsterKind.LOZHNYY_DUKH || !e.ai) return;
  const ai = e.ai;
  if ((ai.falsePhaseCd ?? 0) > 0) ai.falsePhaseCd = Math.max(0, (ai.falsePhaseCd ?? 0) - dt);
  if ((ai.falsePhaseActive ?? 0) > 0) {
    ai.falsePhaseActive = Math.max(0, (ai.falsePhaseActive ?? 0) - dt);
    if (ai.falsePhaseActive <= 0 && e.spriteScale !== undefined && e.spriteScale < 1) e.spriteScale = undefined;
  }
}

function cancelLozhnyyDukhFalsePhase(e: Entity): void {
  if (e.monsterKind !== MonsterKind.LOZHNYY_DUKH || !e.ai) return;
  if (e.ai.falsePhaseDoorIdx === undefined) return;
  e.ai.windupTimer = undefined;
  e.ai.windupTargetId = undefined;
  e.ai.falsePhaseDoorIdx = undefined;
  e.ai.falsePhaseX = undefined;
  e.ai.falsePhaseY = undefined;
  if (e.spriteScale !== undefined && e.spriteScale > 1) e.spriteScale = undefined;
}

function finishLozhnyyDukhPhase(
  world: World,
  e: Entity,
  target: Entity,
  time: number,
  msgs: Msg[],
  playerId: number,
  state: GameState | undefined,
): boolean {
  const ai = e.ai!;
  if (!lozhnyyDukhDoorStillLocal(world, ai)) {
    cancelLozhnyyDukhFalsePhase(e);
    ai.falsePhaseCd = Math.max(ai.falsePhaseCd ?? 0, 1.4);
    return true;
  }

  const oldX = e.x;
  const oldY = e.y;
  e.x = world.wrap(ai.falsePhaseX!);
  e.y = world.wrap(ai.falsePhaseY!);
  e.angle = Math.atan2(world.delta(oldY, e.y), world.delta(oldX, e.x));
  e.spriteScale = 0.86;
  ai.path = [];
  ai.pi = 0;
  ai.timer = 0.4;
  ai.windupTimer = undefined;
  ai.windupTargetId = undefined;
  ai.falsePhaseActive = FALSE_PHASE_ACTIVE_SEC;
  ai.falsePhaseCd = FALSE_PHASE_COOLDOWN_SEC;
  const doorIdx = ai.falsePhaseDoorIdx;
  ai.falsePhaseDoorIdx = undefined;
  ai.falsePhaseX = undefined;
  ai.falsePhaseY = undefined;
  e.attackCd = Math.max(e.attackCd ?? 0, 0.45);

  const markX = doorIdx !== undefined ? doorIdx % W : Math.floor(e.x);
  const markY = doorIdx !== undefined ? (doorIdx / W) | 0 : Math.floor(e.y);
  stampMark(world, markX, markY, 0.5, 0.5, 0.72, MarkType.PSI, 40_040 + e.id * 13, 120, 190, 230, 95);

  if (target.id === playerId) {
    msgs.push(msg('Ложный Дух прошел через закрытую дверь и на миг стал тоньше. Добивайте или уходите в открытый проход.', time, '#9cf'));
  }
  publishMonsterReadabilityEvent(state, world, e, target, 'monster_sighted', 4, ['lozhnyy_dukh', 'false_phase', 'door_crossing'], {
    doorIdx,
    activeSeconds: FALSE_PHASE_ACTIVE_SEC,
    cooldownSeconds: FALSE_PHASE_COOLDOWN_SEC,
    counterplay: 'do_not_turtle_behind_one_closed_door',
  });
  playSoundAt(playGrowl, e.x, e.y);
  return true;
}

function updateLozhnyyDukhFalsePhase(
  world: World,
  e: Entity,
  target: Entity,
  dt: number,
  time: number,
  msgs: Msg[],
  playerId: number,
  state?: GameState,
): boolean {
  if (e.monsterKind !== MonsterKind.LOZHNYY_DUKH || !hasAIFlag(e, 'falsePhase')) return false;
  const ai = e.ai!;

  if ((ai.staggerTimer ?? 0) > 0) {
    ai.staggerTimer = Math.max(0, (ai.staggerTimer ?? 0) - dt);
    e.spriteScale = 0.82;
    return true;
  }

  if ((ai.windupTimer ?? 0) > 0 && ai.falsePhaseDoorIdx !== undefined) {
    ai.windupTimer = Math.max(0, (ai.windupTimer ?? 0) - dt);
    e.spriteScale = 1.08 + Math.max(0, ai.windupTimer / FALSE_PHASE_WINDUP_SEC) * 0.13;
    if (ai.windupTargetId !== target.id || !target.alive) {
      cancelLozhnyyDukhFalsePhase(e);
      ai.falsePhaseCd = Math.max(ai.falsePhaseCd ?? 0, 1.2);
      return true;
    }
    if (ai.windupTimer <= 0) return finishLozhnyyDukhPhase(world, e, target, time, msgs, playerId, state);
    return true;
  }

  if ((ai.falsePhaseCd ?? 0) > 0) return false;
  if (world.dist2(e.x, e.y, target.x, target.y) > FALSE_PHASE_DETECT_SQ) return false;

  const move = getLozhnyyDukhFalsePhaseMove(world, e, target);
  if (!move) return false;

  ai.windupTimer = FALSE_PHASE_WINDUP_SEC;
  ai.windupTargetId = target.id;
  ai.falsePhaseDoorIdx = move.doorIdx;
  ai.falsePhaseX = move.landingX;
  ai.falsePhaseY = move.landingY;
  ai.path = [];
  ai.pi = 0;
  e.angle = Math.atan2(world.delta(e.y, move.sourceY + 0.5), world.delta(e.x, move.sourceX + 0.5));
  e.spriteScale = 1.18;

  if (target.id === playerId) {
    msgs.push(msg('Из закрытой двери потянуло холодным сквозняком. Ложный Дух сейчас пройдет косяк: уходите в открытое место или бейте точно.', time, '#9cf'));
  }
  publishMonsterReadabilityEvent(state, world, e, target, 'monster_sighted', 4, ['lozhnyy_dukh', 'false_phase', 'cold_draft'], {
    doorIdx: move.doorIdx,
    windupSeconds: FALSE_PHASE_WINDUP_SEC,
    counterplay: 'move_to_open_space_or_interrupt_with_precise_ranged_or_uv',
  });
  playSoundAt(playGrowl, e.x, e.y);
  return true;
}

export function lozhnyyDukhFalsePhaseVulnerable(monster: Entity): boolean {
  if (monster.monsterKind !== MonsterKind.LOZHNYY_DUKH || !monster.ai) return false;
  const ai = monster.ai;
  return (ai.falsePhaseActive ?? 0) > 0 ||
    ((ai.windupTimer ?? 0) > 0 && ai.falsePhaseDoorIdx !== undefined);
}

export function interruptLozhnyyDukhFalsePhase(
  world: World,
  state: GameState | undefined,
  monster: Entity,
  source: Entity | undefined,
  reason: 'projectile' | 'uv_spotlight',
): boolean {
  if (!lozhnyyDukhFalsePhaseVulnerable(monster) || !monster.ai || (monster.hp ?? 1) <= 0) return false;
  const ai = monster.ai;
  ai.windupTimer = undefined;
  ai.windupTargetId = undefined;
  ai.falsePhaseDoorIdx = undefined;
  ai.falsePhaseX = undefined;
  ai.falsePhaseY = undefined;
  ai.falsePhaseActive = Math.max(ai.falsePhaseActive ?? 0, FALSE_PHASE_INTERRUPT_WEAK_SEC);
  ai.falsePhaseCd = Math.max(ai.falsePhaseCd ?? 0, FALSE_PHASE_COOLDOWN_SEC);
  ai.staggerTimer = Math.max(ai.staggerTimer ?? 0, FALSE_PHASE_INTERRUPT_STAGGER_SEC);
  monster.attackCd = Math.max(monster.attackCd ?? 0, 1.6);
  monster.spriteScale = 0.82;
  if (monster.hp !== undefined) {
    const chip = Math.max(2, Math.round((monster.maxHp ?? monster.hp) * 0.08));
    monster.hp = Math.max(1, monster.hp - chip);
  }
  publishMonsterReadabilityEvent(state, world, monster, source, 'monster_windup_interrupted', 4, ['lozhnyy_dukh', 'false_phase', 'interrupted', reason], {
    reason,
    weakSeconds: FALSE_PHASE_INTERRUPT_WEAK_SEC,
    counterplay: 'precise_ranged_or_uv_during_false_phase',
  });
  return true;
}

function entityLight(world: World, e: Entity): number {
  return world.light[world.idx(Math.floor(e.x), Math.floor(e.y))] ?? 0;
}

function entityHasEquippedLight(e: Entity): boolean {
  return equippedToolLightScore(e.tool) > 0;
}

interface LishennyyLightTarget {
  x: number;
  y: number;
  score: number;
  source: 'actor' | 'drop' | 'feature';
  entity?: Entity;
  itemId?: string;
}

function lishennyyActorLightScore(world: World, e: Entity): number {
  if (!canBeMonsterTarget(e)) return 0;
  let score = entityLight(world, e);
  score = Math.max(score, equippedToolLightScore(e.tool));
  if (nearFeature(world, e, Feature.LAMP, 1)) score = Math.max(score, 0.62);
  if (nearFeature(world, e, Feature.CANDLE, 1)) score = Math.max(score, 0.48);
  return score;
}

function lishennyyDropLight(drop: Entity): { score: number; itemId: string } | null {
  if (drop.type !== EntityType.ITEM_DROP || !drop.alive) return null;
  let bestScore = 0;
  let bestItem = '';
  for (const item of drop.inventory ?? []) {
    if (item.count <= 0) continue;
    let score = droppedToolLightScore(item.defId);
    if (item.defId === 'istotit_candle') score = 0.64;
    else if (item.defId === 'lamp_bulb') score = 0.32;
    else if (score <= 0) continue;
    if (score > bestScore) {
      bestScore = score;
      bestItem = item.defId;
    }
  }
  return bestScore > 0 ? { score: bestScore, itemId: bestItem } : null;
}

function lishennyyFeatureScore(feature: Feature, light: number): number {
  if (feature === Feature.LAMP) return Math.max(0.68, light);
  if (feature === Feature.CANDLE) return Math.max(0.46, light * 0.85);
  return 0;
}

function lishennyyWeightedScore(world: World, e: Entity, x: number, y: number, score: number, source: LishennyyLightTarget['source']): number {
  const dist = Math.sqrt(world.dist2(e.x, e.y, x, y));
  const sourceBonus = source === 'actor' ? 12 : source === 'drop' ? 18 : 4;
  return score * 100 + sourceBonus - dist * 2.2;
}

function lishennyyCandidateAllowed(e: Entity, score: number): boolean {
  return (e.ai?.lightAvoidTimer ?? 0) <= 0 || score < LISHENNYY_BRIGHT_AVOID;
}

function lishennyyCachedTarget(world: World, e: Entity): LishennyyLightTarget | null {
  const ai = e.ai;
  if (!ai || ai.lightTargetX === undefined || ai.lightTargetY === undefined || ai.lightTargetKind === undefined) return null;
  if (ai.lightTargetKind !== 'feature' && ai.lightTargetId !== undefined) {
    const entity = _entityById.get(ai.lightTargetId);
    if (!entity?.alive) return null;
    if (ai.lightTargetKind === 'actor') {
      const score = lishennyyActorLightScore(world, entity);
      if (score < LISHENNYY_LIGHT_MIN || !lishennyyCandidateAllowed(e, score)) return null;
      return { x: entity.x, y: entity.y, score, source: 'actor', entity };
    }
    const light = lishennyyDropLight(entity);
    if (!light || !lishennyyCandidateAllowed(e, light.score)) return null;
    return { x: entity.x, y: entity.y, score: light.score, source: 'drop', entity, itemId: light.itemId };
  }
  const score = pointLight(world, ai.lightTargetX, ai.lightTargetY);
  if (score < LISHENNYY_LIGHT_MIN || !lishennyyCandidateAllowed(e, score)) return null;
  return { x: ai.lightTargetX, y: ai.lightTargetY, score, source: 'feature' };
}

function publishLishennyyLured(
  state: GameState | undefined,
  world: World,
  e: Entity,
  target: LishennyyLightTarget,
  time: number,
): void {
  if (!state) return;
  const itemName = target.itemId ? ITEMS[target.itemId]?.name ?? target.itemId : undefined;
  publishEvent(state, {
    type: 'lishennyy_lured',
    time,
    zoneId: zoneIdAt(world, e.x, e.y),
    roomId: world.roomAt(e.x, e.y)?.id,
    x: e.x,
    y: e.y,
    actorId: e.id,
    actorName: entityDisplayName(e),
    actorFaction: e.faction,
    targetId: target.entity?.id,
    targetName: target.entity
      ? target.source === 'drop' ? itemName ?? 'брошенный свет' : entityDisplayName(target.entity)
      : 'лампа',
    targetFaction: target.entity?.faction,
    monsterKind: MonsterKind.LISHENNYY,
    itemId: target.itemId,
    itemName,
    severity: 3,
    privacy: isPlayerEntity(target.entity) ? 'local' : 'witnessed',
    tags: ['monster', 'lishennyy', 'light_follower', 'lured', target.source],
    data: {
      source: target.source,
      lightScore: target.score,
      rumorIds: [...LISHENNYY_RUMOR_IDS],
      counterplay: 'drop_light_decoy_or_break_contact',
    },
  });
}

function findLishennyyFeatureTarget(world: World, e: Entity): LishennyyLightTarget | null {
  const ex = Math.floor(e.x);
  const ey = Math.floor(e.y);
  let best: LishennyyLightTarget | null = null;
  let bestWeight = -Infinity;
  for (let dy = -LISHENNYY_FEATURE_SCAN_RADIUS; dy <= LISHENNYY_FEATURE_SCAN_RADIUS; dy++) {
    for (let dx = -LISHENNYY_FEATURE_SCAN_RADIUS; dx <= LISHENNYY_FEATURE_SCAN_RADIUS; dx++) {
      const d2 = dx * dx + dy * dy;
      if (d2 > LISHENNYY_FEATURE_SCAN_RADIUS * LISHENNYY_FEATURE_SCAN_RADIUS) continue;
      const x = world.wrap(ex + dx);
      const y = world.wrap(ey + dy);
      const ci = world.idx(x, y);
      const score = lishennyyFeatureScore(world.features[ci] as Feature, world.light[ci] ?? 0);
      if (score < LISHENNYY_LIGHT_MIN || !lishennyyCandidateAllowed(e, score)) continue;
      const weight = lishennyyWeightedScore(world, e, x + 0.5, y + 0.5, score, 'feature');
      if (weight <= bestWeight) continue;
      bestWeight = weight;
      best = { x: x + 0.5, y: y + 0.5, score, source: 'feature' };
    }
  }
  return best;
}

function findLishennyyLightTarget(
  world: World,
  e: Entity,
  dt: number,
  time: number,
  state: GameState | undefined,
): LishennyyLightTarget | null {
  const ai = e.ai!;
  ai.lightScanCd = (ai.lightScanCd ?? 0) - dt;
  if (ai.lightScanCd > 0) return lishennyyCachedTarget(world, e);

  ai.lightScanCd = LISHENNYY_SCAN_SEC + (e.id & 3) * 0.07;
  let best = findLishennyyFeatureTarget(world, e);
  let bestWeight = best ? lishennyyWeightedScore(world, e, best.x, best.y, best.score, best.source) : -Infinity;

  getEntityIndex().queryRadiusCapped(e.x, e.y, LISHENNYY_DETECT_RADIUS, lishennyyLightQuery, ENTITY_MASK_ACTOR | ENTITY_MASK_ITEM_DROP, LISHENNYY_LIGHT_SCAN_CAP);
  for (const other of lishennyyLightQuery) {
    if (!other.alive || other.id === e.id) continue;
    if (other.type === EntityType.ITEM_DROP) {
      const light = lishennyyDropLight(other);
      if (!light || !lishennyyCandidateAllowed(e, light.score)) continue;
      const weight = lishennyyWeightedScore(world, e, other.x, other.y, light.score, 'drop');
      if (weight <= bestWeight) continue;
      bestWeight = weight;
      best = { x: other.x, y: other.y, score: light.score, source: 'drop', entity: other, itemId: light.itemId };
      continue;
    }
    if (!isHostile(e, other)) continue;
    const score = lishennyyActorLightScore(world, other);
    if (score < LISHENNYY_LIGHT_MIN || !lishennyyCandidateAllowed(e, score)) continue;
    const weight = lishennyyWeightedScore(world, e, other.x, other.y, score, 'actor');
    if (weight <= bestWeight) continue;
    bestWeight = weight;
    best = { x: other.x, y: other.y, score, source: 'actor', entity: other };
  }

  if (!best) {
    ai.lightTargetX = undefined;
    ai.lightTargetY = undefined;
    ai.lightTargetId = undefined;
    ai.lightTargetKind = undefined;
    return null;
  }

  const changed = ai.lightTargetKind !== best.source ||
    ai.lightTargetId !== best.entity?.id ||
    Math.floor(ai.lightTargetX ?? -999) !== Math.floor(best.x) ||
    Math.floor(ai.lightTargetY ?? -999) !== Math.floor(best.y);
  ai.lightTargetX = best.x;
  ai.lightTargetY = best.y;
  ai.lightTargetId = best.entity?.id;
  ai.lightTargetKind = best.source;
  if (changed && time >= (ai.lightCueAt ?? -Infinity)) {
    ai.lightCueAt = time + 5.5;
    publishLishennyyLured(state, world, e, best, time);
  }
  return best;
}

function lishennyyDimRetreatCell(world: World, e: Entity): { x: number; y: number } | null {
  const ex = Math.floor(e.x);
  const ey = Math.floor(e.y);
  let best: { x: number; y: number } | null = null;
  let bestLight = pointLight(world, e.x, e.y);
  for (let dy = -4; dy <= 4; dy++) {
    for (let dx = -4; dx <= 4; dx++) {
      if (dx === 0 && dy === 0) continue;
      const x = world.wrap(ex + dx);
      const y = world.wrap(ey + dy);
      if (world.solid(x, y)) continue;
      const light = world.light[world.idx(x, y)] ?? 0;
      if (light >= bestLight) continue;
      bestLight = light;
      best = { x, y };
    }
  }
  return best;
}

function updateLishennyyBrightAvoidance(
  world: World,
  e: Entity,
  dt: number,
): boolean {
  if (e.monsterKind !== MonsterKind.LISHENNYY || !e.ai) return false;
  const ai = e.ai;
  ai.lightAvoidTimer = Math.max(0, (ai.lightAvoidTimer ?? 0) - dt);
  if ((ai.staggerTimer ?? 0) > 0) {
    ai.staggerTimer = Math.max(0, (ai.staggerTimer ?? 0) - dt);
    ai.combatTargetId = undefined;
    ai.path = [];
    e.attackCd = Math.max(e.attackCd ?? 0, 0.35);
    e.spriteScale = 0.84;
    return true;
  }
  if (ai.lightAvoidTimer <= 0 || pointLight(world, e.x, e.y) < LISHENNYY_BRIGHT_AVOID) return false;
  ai.combatTargetId = undefined;
  ai.goal = AIGoal.WANDER;
  ai.timer -= dt;
  if (ai.path.length === 0 || ai.pi >= ai.path.length || ai.timer <= 0) {
    const dim = lishennyyDimRetreatCell(world, e);
    if (dim) tryAssignPathToCell(world, e, dim.x, dim.y);
    else wanderNearby(world, e);
    ai.timer = 0.9;
  }
  const oldSpeed = e.speed;
  e.speed = oldSpeed * 0.72;
  followMonsterPath(world, e, dt);
  e.speed = oldSpeed;
  e.spriteScale = 0.88;
  return true;
}

function followLishennyyLightTarget(world: World, e: Entity, target: LishennyyLightTarget, dt: number): boolean {
  if (e.monsterKind !== MonsterKind.LISHENNYY || target.source === 'actor' || !e.ai) return false;
  const ai = e.ai;
  ai.goal = AIGoal.HUNT;
  ai.combatTargetId = undefined;
  ai.timer -= dt;
  if (ai.path.length === 0 || ai.pi >= ai.path.length || ai.timer <= 0) {
    tryAssignPathToCell(world, e, Math.floor(target.x), Math.floor(target.y));
    ai.timer = 1.35;
  }
  const oldSpeed = e.speed;
  e.speed = oldSpeed * (target.source === 'drop' ? 1.1 : 0.92);
  followMonsterPath(world, e, dt);
  e.speed = oldSpeed;
  e.spriteScale = world.dist2(e.x, e.y, target.x, target.y) < 1.7 * 1.7 ? 1.08 : undefined;
  return true;
}

function applyLishennyyContactDecay(
  state: GameState | undefined,
  world: World,
  e: Entity,
  target: Entity,
  dmg: number,
  time: number,
  msgs: Msg[],
  playerId: number,
): void {
  if (e.monsterKind !== MonsterKind.LISHENNYY) return;
  let needDrain = 0;
  if (target.needs) {
    const before = target.needs.food + target.needs.water + target.needs.sleep;
    target.needs.food = Math.max(0, target.needs.food - LISHENNYY_CONTACT_DRAIN);
    target.needs.water = Math.max(0, target.needs.water - LISHENNYY_CONTACT_DRAIN);
    target.needs.sleep = Math.max(0, target.needs.sleep - Math.ceil(LISHENNYY_CONTACT_DRAIN * 0.5));
    needDrain = before - target.needs.food - target.needs.water - target.needs.sleep;
  }
  if (target.rpg) target.rpg.psi = Math.max(0, target.rpg.psi - 2);
  if (target.id === playerId) msgs.push(msg('Лишенный коснулся света в тебе: горло пересохло, ноги стали ватными.', time, '#99a'));
  if (!state) return;
  publishEvent(state, {
    type: 'lishennyy_contact_decay',
    time,
    zoneId: zoneIdAt(world, e.x, e.y),
    roomId: world.roomAt(e.x, e.y)?.id,
    x: e.x,
    y: e.y,
    actorId: e.id,
    actorName: entityDisplayName(e),
    actorFaction: e.faction,
    targetId: target.id,
    targetName: entityDisplayName(target),
    targetFaction: target.faction,
    monsterKind: MonsterKind.LISHENNYY,
    severity: isPlayerEntity(target) ? 4 : 3,
    privacy: isPlayerEntity(target) ? 'local' : 'witnessed',
    tags: ['monster', 'lishennyy', 'contact_decay', 'decay'],
    data: {
      damage: dmg,
      needDrain,
      psiDrain: target.rpg ? 2 : 0,
      rumorIds: [...LISHENNYY_RUMOR_IDS],
      counterplay: 'break_contact_and_move_light_away',
    },
  });
}

function isSlimeWomanWetCell(world: World, e: Entity): boolean {
  return wetTerrainAtEntity(world, e) ||
    entityInActiveCellHazard(world, e, SLIME_WOMAN_HAZARD_TAGS);
}

function isSlimeWomanDryCounterCell(world: World, e: Entity): boolean {
  if (isSlimeWomanWetCell(world, e)) return false;
  const ci = world.idx(Math.floor(e.x), Math.floor(e.y));
  if (world.cells[ci] !== Cell.FLOOR) return false;
  return world.light[ci] >= 0.24 || nearFeature(world, e, Feature.LAMP, 3);
}

function slimeWomanRuntimeState(e: Entity): SlimeWomanRuntime {
  const hp = Math.max(1, e.hp ?? e.maxHp ?? 1);
  let runtime = slimeWomanRuntime.get(e);
  if (!runtime) {
    runtime = { lastHp: hp, lastResidueAt: -Infinity, lastDryEventAt: -Infinity };
    slimeWomanRuntime.set(e, runtime);
  }
  return runtime;
}

function publishSlimeWomanDriedEvent(
  state: GameState | undefined,
  world: World,
  e: Entity,
  time: number,
  reason: string,
): void {
  if (!state) return;
  publishEvent(state, {
    type: 'slime_humanoid_dried',
    time,
    zoneId: zoneIdAt(world, e.x, e.y),
    roomId: world.roomAt(e.x, e.y)?.id,
    x: e.x,
    y: e.y,
    actorId: e.id,
    actorName: entityDisplayName(e),
    actorFaction: e.faction,
    monsterKind: MonsterKind.SLIME_WOMAN,
    severity: 3,
    privacy: 'local',
    tags: ['monster', 'slime_woman', 'slime', 'dry', 'counterplay'],
    data: {
      reason,
      counterplay: MONSTERS[MonsterKind.SLIME_WOMAN]?.counterplay,
      rumorIds: ['ecology_slime_woman_dry_edge', 'lead_maint_slime_woman_sump'],
    },
  });
}

function slimeWomanResidueCells(world: World, e: Entity, target: Entity | undefined): number[] {
  const cells: number[] = [];
  const push = (x: number, y: number): void => {
    const ci = world.idx(x, y);
    if (world.cells[ci] !== Cell.FLOOR && world.cells[ci] !== Cell.WATER) return;
    if (!cells.includes(ci)) cells.push(ci);
  };
  const ex = Math.floor(e.x);
  const ey = Math.floor(e.y);
  push(ex, ey);
  if (target) push(Math.floor(target.x), Math.floor(target.y));
  for (let i = 0; i < 4; i++) {
    const dx = i === 0 ? 1 : i === 1 ? -1 : 0;
    const dy = i === 2 ? 1 : i === 3 ? -1 : 0;
    push(ex + dx, ey + dy);
  }
  return cells;
}

function dropSlimeWomanResidue(
  world: World,
  e: Entity,
  target: Entity | undefined,
  time: number,
  state: GameState | undefined,
  reason: string,
): void {
  if (e.monsterKind !== MonsterKind.SLIME_WOMAN) return;
  const runtime = slimeWomanRuntimeState(e);
  if (time - runtime.lastResidueAt < SLIME_WOMAN_RESIDUE_COOLDOWN_SEC) return;
  const cells = slimeWomanResidueCells(world, e, target);
  if (cells.length === 0) return;
  runtime.lastResidueAt = time;
  const x = Math.floor(e.x);
  const y = Math.floor(e.y);
  stampMark(world, x, y, 0.5, 0.5, 1.25, MarkType.DRIP, 50_500 + e.id * 17 + Math.floor(time * 10), 18, 150, 98, 175);
  registerCellHazardSite(world, {
    id: `slime_woman_residue_${e.id}_${Math.floor(time * 10)}`,
    kind: 'slime_woman_residue',
    displayName: 'Жижевая токсичная пленка',
    cells,
    tags: ['slime', 'toxic', 'slime_woman', 'green_slime'],
    sticky: false,
    cleanable: true,
    slowMult: 0.72,
    playerDamagePerSecond: 1.25,
    messageCooldownSeconds: 2.8,
    expiresAt: time + SLIME_WOMAN_RESIDUE_DURATION_SEC,
    roomId: world.roomAt(e.x, e.y)?.id,
    zoneId: zoneIdAt(world, e.x, e.y),
    centerX: e.x,
    centerY: e.y,
    warning: 'Жижевая пленка ест подошву. Чистящий комплект, огонь или сухой обход держат проход.',
    warningColor: '#4f8',
  });
  if (state && target && isPlayerEntity(target)) {
    publishEvent(state, {
      type: 'monster_sighted',
      time,
      zoneId: zoneIdAt(world, e.x, e.y),
      roomId: world.roomAt(e.x, e.y)?.id,
      x: e.x,
      y: e.y,
      actorId: e.id,
      actorName: entityDisplayName(e),
      actorFaction: e.faction,
      targetId: target.id,
      targetName: entityDisplayName(target),
      targetFaction: target.faction,
      monsterKind: MonsterKind.SLIME_WOMAN,
      severity: 3,
      privacy: 'local',
      tags: ['monster', 'slime_woman', 'slime', 'residue', reason],
      data: {
        residueCells: cells.length,
        residueSeconds: SLIME_WOMAN_RESIDUE_DURATION_SEC,
        counterplay: 'cleaning_kit_fire_or_dry_edge',
      },
    });
  }
}

function updateSlimeWomanState(
  world: World,
  e: Entity,
  time: number,
  msgs: Msg[],
  state: GameState | undefined,
): void {
  if (e.monsterKind !== MonsterKind.SLIME_WOMAN) return;
  if (!e.alive || (e.hp ?? 1) <= 0) {
    slimeWomanRuntime.delete(e);
    return;
  }
  const runtime = slimeWomanRuntimeState(e);
  const hp = e.hp ?? runtime.lastHp;
  if (hp < runtime.lastHp) dropSlimeWomanResidue(world, e, undefined, time, state, 'damaged');
  runtime.lastHp = hp;

  if (isSlimeWomanDryCounterCell(world, e)) {
    e.spriteScale = 0.88;
    if (time - runtime.lastDryEventAt >= SLIME_WOMAN_DRY_EVENT_COOLDOWN_SEC) {
      runtime.lastDryEventAt = time;
      msgs.push(msg('Жижевая женщина подсыхает на светлом сухом бетоне. Сейчас её можно держать темпом.', time, '#8cf'));
      publishSlimeWomanDriedEvent(state, world, e, time, 'dry_lit_concrete');
    }
  } else if (isSlimeWomanWetCell(world, e)) {
    e.spriteScale = Math.max(e.spriteScale ?? 1, 1.06);
  } else if (e.spriteScale !== undefined && (e.spriteScale < 1 || e.spriteScale > 1.04)) {
    e.spriteScale = undefined;
  }
}

function panelnikAdjacentWallCell(world: World, e: Entity): { x: number; y: number } | undefined {
  const x = Math.floor(e.x);
  const y = Math.floor(e.y);
  const dirs = [[-1, 0], [1, 0], [0, -1], [0, 1]] as const;
  for (const [dx, dy] of dirs) {
    const wx = world.wrap(x + dx);
    const wy = world.wrap(y + dy);
    if (world.cells[world.idx(wx, wy)] === Cell.WALL) return { x: wx, y: wy };
  }
  return undefined;
}

function stampPanelnikWallScrape(world: World, e: Entity, time: number): void {
  const wall = panelnikAdjacentWallCell(world, e);
  if (!wall) return;
  const seed = Math.imul(e.id, 1201) ^ Math.floor(time * 8);
  stampMark(world, wall.x, wall.y, 0.5, 0.5, 0.24, MarkType.BULLET, seed, 206, 194, 158, 135, true);
}

function updatePanelnikWallBrace(
  world: World,
  e: Entity,
  dt: number,
  time: number,
  msgs: Msg[],
  target: Entity | undefined,
  state: GameState | undefined,
): void {
  if (e.monsterKind !== MonsterKind.PANELNIK || !e.ai) return;
  const ai = e.ai;
  ai.wallBraceSlowTimer = Math.max(0, (ai.wallBraceSlowTimer ?? 0) - dt);

  const localTarget = target?.alive && world.dist2(e.x, e.y, target.x, target.y) <= 16 * 16 ? target : undefined;
  if (panelnikWallBraceActive(world, e)) {
    ai.wallBraceWasActive = true;
    ai.wallBraceSlowTimer = 0;
    e.spriteScale = Math.max(e.spriteScale ?? 1, 1.07);
    if (localTarget && time >= (ai.wallBraceCueAt ?? -Infinity)) {
      ai.wallBraceCueAt = time + PANELNIK_BRACE_CUE_COOLDOWN_SEC;
      stampPanelnikWallScrape(world, e, time);
      msgs.push(msg('Панельник скребет плитной рукой по стене: у панели броня и длинный удар.', time, '#cca'));
      publishMonsterReadabilityEvent(state, world, e, localTarget, 'monster_sighted', 3, ['panelnik', 'wall_brace', 'scrape'], {
        braceReach: PANELNIK_BRACE_REACH,
        counterplay: 'door_corner_or_open_floor',
      });
    }
    return;
  }

  if (panelnikOpenFloor(world, e) && ai.wallBraceWasActive) {
    ai.wallBraceWasActive = false;
    ai.wallBraceSlowTimer = Math.max(ai.wallBraceSlowTimer ?? 0, PANELNIK_OPEN_SLOW_SEC);
    e.spriteScale = 0.92;
    if (localTarget) {
      msgs.push(msg('Панельник потерял стену. Пыль осела: броня пропала, темп просел.', time, '#9cf'));
      publishMonsterReadabilityEvent(state, world, e, localTarget, 'monster_windup_interrupted', 3, ['panelnik', 'wall_brace', 'broken', 'open_floor'], {
        slowSec: PANELNIK_OPEN_SLOW_SEC,
        counterplay: 'open_floor',
      });
    }
    return;
  }

  if ((ai.wallBraceSlowTimer ?? 0) > 0) {
    e.spriteScale = 0.92;
  } else if (e.spriteScale !== undefined && (e.spriteScale < 0.96 || e.spriteScale > 1.04)) {
    e.spriteScale = undefined;
  }
}

function shadowHasLightCounter(world: World, shadow: Entity, target: Entity): boolean {
  return entityHasEquippedLight(target) ||
    entityLight(world, target) >= SHADOW_LIGHT_SAFE ||
    entityLight(world, shadow) >= SHADOW_LIGHT_SAFE;
}

function shadowCanDarkAmbush(world: World, shadow: Entity, target: Entity): boolean {
  return !entityHasEquippedLight(target) &&
    entityLight(world, shadow) <= SHADOW_DARK_LIGHT &&
    entityLight(world, target) < SHADOW_LIGHT_SAFE;
}

function isBlackWaterWakeCell(world: World, e: Entity): boolean {
  return wetWaterCell(world, Math.floor(e.x), Math.floor(e.y));
}

export function isChernoSlizHidden(world: World, e: Entity, target?: Entity): boolean {
  if (e.monsterKind !== MonsterKind.CHERNOSLIZ) return false;
  if (e.monsterStage === 1) return false;
  if (!isBlackWaterWakeCell(world, e)) return false;
  const maxHp = e.maxHp ?? e.hp ?? 1;
  if ((e.hp ?? maxHp) < maxHp) return false;
  if (entityLight(world, e) >= CHERNOSLIZ_LIGHT_REVEAL) return false;
  if (!target?.alive) return true;
  const d2 = world.dist2(e.x, e.y, target.x, target.y);
  if (d2 <= CHERNOSLIZ_REVEAL_CLOSE_SQ) return false;
  if (entityHasEquippedLight(target) && d2 <= CHERNOSLIZ_LIGHT_RANGE_SQ && hasClearLine(world, e, target, CHERNOSLIZ_LIGHT_RANGE)) return false;
  return true;
}

function chernoslizDetectSq(world: World, e: Entity): number {
  return isBlackWaterWakeCell(world, e) ? CHERNOSLIZ_WATER_DETECT_SQ : CHERNOSLIZ_DRY_DETECT_SQ;
}

function chernoslizCanTarget(world: World, e: Entity, target: Entity): boolean {
  if (!target.alive || !canBeMonsterTarget(target) || !isHostile(e, target)) return false;
  if (isChernoSlizHidden(world, e, target)) return false;
  return world.dist2(e.x, e.y, target.x, target.y) < chernoslizDetectSq(world, e);
}

function chernoslizRevealNoise(noise: NoiseRecord): boolean {
  if (noise.source === 'decoy' || noise.source === 'explosion') return true;
  if (noise.source === 'weapon_fire' && noise.severity >= 2) return true;
  if (noise.source === 'melee' && (noise.tags.includes('metal') || noise.tags.includes('pipe'))) return true;
  return noise.itemId === 'noise_can' || noise.tags.includes('counterplay') || noise.tags.includes('probe');
}

function revealChernoSlizByNoise(
  world: World,
  e: Entity,
  noise: NoiseRecord,
  time: number,
  msgs: Msg[],
  state?: GameState,
): void {
  if (e.monsterStage === 1) return;
  e.monsterStage = 1;
  e.spriteScale = undefined;
  stampChernoSlizWake(world, e, time);
  const target = noise.actorId !== undefined ? _entityById.get(noise.actorId) : undefined;
  msgs.push(msg('Шум вскрыл черную воду: чернослиз дернулся и потерял первый скрытый залп.', time, '#7f9'));
  publishMonsterReadabilityEvent(state, world, e, target, 'monster_sighted', 3, ['chernosliz', 'black_water', 'noise_reveal', 'counterplay'], {
    noiseId: noise.id,
    noiseSource: noise.source,
    itemId: noise.itemId,
    counterplay: 'light_noise_probe_or_dry_edge',
  });
}

function tryRevealChernoSlizByNoise(
  world: World,
  e: Entity,
  time: number,
  msgs: Msg[],
  state?: GameState,
): boolean {
  if (e.monsterKind !== MonsterKind.CHERNOSLIZ || e.monsterStage === 1) return false;
  if (!isChernoSlizHidden(world, e)) return false;
  const ai = e.ai!;
  const noise = findNoiseForActor(world, state, e, time, { minSeverity: 2, scanInterval: 0.65, hearingMult: 1.24 });
  if (!noise || noise.id === ai.lastNoiseId || !chernoslizRevealNoise(noise)) return false;
  ai.lastNoiseId = noise.id;
  revealChernoSlizByNoise(world, e, noise, time, msgs, state);
  return true;
}

function findChernoSlizTarget(world: World, e: Entity, dt: number): Entity | null {
  const ai = e.ai!;
  ai.combatScanCd = (ai.combatScanCd ?? 0) - dt;
  if (ai.combatTargetId !== undefined) {
    const cached = _entityById.get(ai.combatTargetId);
    if (cached && chernoslizCanTarget(world, e, cached)) return cached;
    ai.combatTargetId = undefined;
  }
  if (ai.combatScanCd > 0) return null;

  ai.combatScanCd = fixedScanCd(e) ?? 0.75;
  let target: Entity | null = null;
  let best = chernoslizDetectSq(world, e);
  getEntityIndex().queryRadiusCapped(e.x, e.y, Math.sqrt(best), chernoslizTargetQuery, ENTITY_MASK_ACTOR, CHERNOSLIZ_SCAN_CAP);
  for (const other of chernoslizTargetQuery) {
    if (!chernoslizCanTarget(world, e, other)) continue;
    const d2 = world.dist2(e.x, e.y, other.x, other.y);
    if (d2 >= best) continue;
    best = d2;
    target = other;
  }
  if (target) ai.combatTargetId = target.id;
  return target;
}

function stampChernoSlizWake(world: World, e: Entity, time: number): void {
  const x = Math.floor(e.x);
  const y = Math.floor(e.y);
  const fx = ((e.x % 1) + 1) % 1;
  const fy = ((e.y % 1) + 1) % 1;
  const seed = Math.imul(e.id, 977) ^ Math.floor(time * 10);
  stampMark(world, x, y, fx, fy, 0.44, MarkType.SPLAT, seed, 36, 42, 62, 130);
  stampMark(world, x, y, fx, fy, 0.18, MarkType.PSI, seed ^ 0x5a17, 58, 210, 82, 95);
}

function stampWetStriderRipple(world: World, e: Entity, time: number): void {
  const x = Math.floor(e.x);
  const y = Math.floor(e.y);
  const fx = ((e.x % 1) + 1) % 1;
  const fy = ((e.y % 1) + 1) % 1;
  const seed = Math.imul(e.id, 1229) ^ Math.floor(time * 8);
  stampMark(world, x, y, fx, fy, e.monsterKind === MonsterKind.TUBE_EEL ? 0.36 : 0.42, MarkType.SPLAT, seed, 42, 120, 138, 110);
}

function updateWaterStriderState(world: World, e: Entity, dt: number, time: number): void {
  if (!hasAIFlag(e, 'waterStrider')) return;
  const wet = wetTerrainAtEntity(world, e);
  if (wet && time - (e.monsterArmorLastMsgAt ?? -Infinity) >= WATER_STRIDER_RIPPLE_SEC) {
    e.monsterArmorLastMsgAt = time;
    stampWetStriderRipple(world, e, time);
  }
  if (e.monsterKind !== MonsterKind.LOTOCHNIK) return;
  const maxHp = e.maxHp ?? e.hp ?? MONSTERS[MonsterKind.LOTOCHNIK].hp;
  if (wet) {
    if ((e.hp ?? maxHp) < maxHp) e.hp = Math.min(maxHp, (e.hp ?? maxHp) + dt * LOTOCHNIK_WET_REGEN_PER_SEC);
    e.spriteScale = Math.max(e.spriteScale ?? 1, 1.04);
  } else if (e.spriteScale !== undefined && e.spriteScale > 1.02 && e.spriteScale < 1.08) {
    e.spriteScale = undefined;
  }
}

function monsterMoveMult(world: World, e: Entity, target?: Entity): number {
  if (e.monsterKind === MonsterKind.LOZHNYY_DUKH && (e.ai?.falsePhaseActive ?? 0) > 0) return FALSE_PHASE_WEAK_MOVE_MULT;
  if (hasAIFlag(e, 'netPossessor')) return e.ai?.netPowered ? CHERVIE_POWERED_MOVE_MULT : CHERVIE_CUT_MOVE_MULT;
  if (hasAIFlag(e, 'debrisLurker')) return inDebrisCover(world, e) ? 1.22 : 0.68;
  if (hasAIFlag(e, 'documentScent')) {
    const strength = documentScentStrength(target);
    return strength > 0 ? Math.min(1.78, 1.2 + strength * 0.08) : 0.68;
  }
  if (hasAIFlag(e, 'fogSwimmer')) return fogSharkMoveMultiplierForTests(world, e);
  if (e.monsterKind === MonsterKind.DIKIY_MERTVYAK) {
    if (dikiyMertvyakDamagedEarly(e)) return 0.96;
    return 1 + Math.min(1.2, e.ai?.shoveCharge ?? 0) * 0.18;
  }
  switch (e.monsterKind) {
    case MonsterKind.SHADOW: {
      const light = entityLight(world, e);
      if (light >= SHADOW_LIGHT_SAFE) return 0.78;
      if (light <= SHADOW_DARK_LIGHT) return 1.08;
      return 1;
    }
    case MonsterKind.TVAR:
      return monsterWallContext(world, e).adjacentWall ? 1.12 : 0.96;
    case MonsterKind.CHERNOSLIZ:
      return isBlackWaterWakeCell(world, e) ? 1.0 : 0.46;
    case MonsterKind.HEAD_SLUG:
      return isHeadSlugDetached(e) ? 1.14 : 1;
	    case MonsterKind.OLGOY:
	      return olgoyTerrainMoveMult(world, e);
	    case MonsterKind.PANELNIK:
	      if ((e.ai?.wallBraceSlowTimer ?? 0) > 0) return PANELNIK_OPEN_SLOW_MULT;
	      return panelnikWallBraceActive(world, e) ? 1.02 : 0.9;
	    default:
	      break;
	  }
  if (hasAIFlag(e, 'wallBias')) {
    const ctx = monsterWallContext(world, e);
    return ctx.adjacentWall || ctx.narrowDoorOrCorner ? 1.18 : 0.92;
  }
  if (hasAIFlag(e, 'waterPressureLine')) {
    return isVodyanoyWetLineCell(world, Math.floor(e.x), Math.floor(e.y)) ? 1.16 : 0.86;
  }
  if (hasAIFlag(e, 'waterStrider')) {
    return wetTerrainAtEntity(world, e) ? 1.45 : 0.72;
  }
  if (hasAIFlag(e, 'slimeStrider')) {
    if (isSlimeWomanWetCell(world, e)) return 1.48;
    return isSlimeWomanDryCounterCell(world, e) ? 0.58 : 0.86;
  }
  return 1;
}

function monsterDmgMult(world: World, e: Entity, target?: Entity): number {
  if (e.monsterKind === MonsterKind.LOZHNYY_DUKH && (e.ai?.falsePhaseActive ?? 0) > 0) return FALSE_PHASE_WEAK_DAMAGE_MULT;
  if (hasAIFlag(e, 'netPossessor')) return e.ai?.netPowered ? CHERVIE_POWERED_DMG_MULT : CHERVIE_CUT_DMG_MULT;
  if (hasAIFlag(e, 'debrisLurker')) return inDebrisCover(world, e) ? 1.25 : 0.75;
  switch (e.monsterKind) {
    case MonsterKind.SHADOW: {
      const light = entityLight(world, e);
      if (light >= SHADOW_LIGHT_SAFE) return 0.72;
      if (light <= SHADOW_DARK_LIGHT) return 1.1;
      return 1;
    }
    case MonsterKind.TVAR:
      return wallTerrainPressureActive(world, e, target) ? 1.22 : 1;
    case MonsterKind.ZOMBIE: {
      if (!target) return 1;
      const pressure = cheapCrowdPressure(world, e, target, ZOMBIE_CROWD_PRESSURE_RADIUS, ZOMBIE_CROWD_PRESSURE_SCAN_CAP, zombieCrowdQuery);
      const bonus = Math.min(
        ZOMBIE_CROWD_DAMAGE_CAP - 1,
        pressure.crowd * ZOMBIE_CROWD_DAMAGE_BONUS + (pressure.choke ? ZOMBIE_DOOR_DAMAGE_BONUS : 0),
      );
      return 1 + Math.max(0, bonus);
    }
    case MonsterKind.POLZUN:
      return inPolzunKillCell(world, e) || (target !== undefined && inPolzunKillCell(world, target)) ? 1.35 : 1;
    case MonsterKind.CHERNOSLIZ:
      return isBlackWaterWakeCell(world, e) ? 1.28 : 0.62;
    case MonsterKind.BEZEKHIY:
      return target !== undefined && targetBackTurned(world, e, target) ? 1.55 : 0.72;
    case MonsterKind.HEAD_SLUG:
      return isHeadSlugDetached(e) ? 0.55 : 1;
    case MonsterKind.OLGOY:
      return olgoyTerrainDmgMult(world, e, target);
    case MonsterKind.ROBOT:
      return robotPlasmaWetRiskMult(world, e, target);
    default:
      break;
  }
  if (hasAIFlag(e, 'wallBias')) return wallTerrainPressureActive(world, e, target) ? 1.2 : 1;
  if (hasAIFlag(e, 'lampPowered')) return nearFeature(world, e, Feature.LAMP, 3) ? 1.35 : 0.9;
  if (hasAIFlag(e, 'documentScent')) return documentScentStrength(target) > 0 ? 1.14 : 0.82;
  if (hasAIFlag(e, 'fogSwimmer')) return fogSharkHasFogPressure(world, e) ? FOG_SHARK_FOG_DAMAGE_MULT : FOG_SHARK_DRY_DAMAGE_MULT;
  if (hasAIFlag(e, 'officeField')) return officeFieldPressure(world, e, target);
  if (hasAIFlag(e, 'waterStrider')) return wetTerrainAtEntity(world, e) ? 1.18 : 0.78;
  if (hasAIFlag(e, 'slimeStrider')) {
    if (isSlimeWomanWetCell(world, e)) return 1.12;
    return isSlimeWomanDryCounterCell(world, e) ? 0.7 : 0.9;
  }
  return 1;
}

function robotPlasmaWetRiskMult(world: World, e: Entity, target?: Entity): number {
  if (!target) return 1;
  const ex = Math.floor(e.x);
  const ey = Math.floor(e.y);
  const tx = Math.floor(target.x);
  const ty = Math.floor(target.y);
  return isDrainLineCell(world, ex, ey) || isDrainLineCell(world, tx, ty) ? 1.16 : 1;
}

function updateLampPoweredReadability(
  world: World,
  e: Entity,
  target: Entity | null,
  time: number,
  msgs: Msg[],
  playerId: number,
  state?: GameState,
): void {
  if (!hasAIFlag(e, 'lampPowered')) return;
  const powered = target?.alive === true && nearFeature(world, e, Feature.LAMP, 3);
  const wasPowered = lampPoweredRuntime.get(e) === true;
  lampPoweredRuntime.set(e, powered);
  if (!powered || wasPowered || !target) return;

  if (target.id === playerId) {
    msgs.push(msg('Ламповый зазвенел под лампой: свет усилил удар. Отводите его на три клетки или за угол.', time, '#fd6'));
  }
  publishMonsterReadabilityEvent(state, world, e, target, 'monster_sighted', isPlayerEntity(target) ? 4 : 3, ['lampovy', 'lamp_powered', 'light', 'warning'], {
    lampRadius: 3,
    damageMult: 1.35,
    counterplay: 'leave_lamp_cluster_or_break_line',
  });
}

function monsterDetectSq(world: World, e: Entity, fallback: number): number {
  if (hasAIFlag(e, 'rootedPlant')) return BORSHCHEVIK_DETECT_SQ;
  if (hasAIFlag(e, 'rootHive')) return BLOOD_PLANT_TENDRIL_RANGE_SQ;
  if (hasAIFlag(e, 'protocolPressure')) return PROTOKOLNIK_DETECT_SQ;
  if (hasAIFlag(e, 'documentHunter')) return PECHATEED_DETECT_SQ;
  if (hasAIFlag(e, 'documentScent')) return KONTORSHCHIK_DETECT_SQ;
  if (hasAIFlag(e, 'officeField')) return KANTSELYARSKIY_IDOL_DETECT_SQ;
  if (hasAIFlag(e, 'netPossessor')) return e.ai?.netPowered ? 24 * 24 : 12 * 12;
  if (hasAIFlag(e, 'fogSwimmer')) return fogSharkHasFogPressure(world, e) ? FOG_SHARK_DETECT_SQ : FOG_SHARK_DRY_DETECT_SQ;
  if (hasAIFlag(e, 'blackWaterWake')) return chernoslizDetectSq(world, e);
  if (hasAIFlag(e, 'deadEcho') && e.ai?.deadEchoRevealed !== true) return BEZEKHIY_DETECT_SQ;
  if (hasAIFlag(e, 'closeReveal')) return NELYUD_REVEAL_SQ;
  if (hasAIFlag(e, 'garbageSurround')) return POMOYNY_ROY_BASE_DETECT_SQ;
  if (hasAIFlag(e, 'sourceSwarm')) return SWARM_DETECT_SQ;
  if (hasAIFlag(e, 'lightFollower')) return LISHENNYY_DETECT_SQ;
  if (hasAIFlag(e, 'debrisLurker')) {
    return inDebrisCover(world, e) ? DEBRIS_LURKER_COVER_DETECT_SQ : DEBRIS_LURKER_EXPOSED_DETECT_SQ;
  }
  return fallback;
}

function dikiyMertvyakDamagedEarly(e: Entity): boolean {
  const ai = e.ai;
  if (!ai) return false;
  const fullHp = e.maxHp ?? e.hp ?? MONSTERS[MonsterKind.DIKIY_MERTVYAK].hp;
  if (ai.shoveStartHp === undefined) ai.shoveStartHp = fullHp;
  return e.hp !== undefined && e.hp < Math.min(ai.shoveStartHp, fullHp) - 0.5;
}

function dikiyMertvyakCrowdPressure(world: World, e: Entity, target: Entity): { crowd: number; choke: boolean } {
  const pressure = cheapCrowdPressure(world, e, target, DIKIY_SHOVE_RADIUS, DIKIY_SHOVE_SCAN_CAP, dikiyCrowdQuery);
  return { crowd: pressure.crowd, choke: pressure.choke };
}

function updateDikiyMertvyakCrowdShove(
  world: World,
  e: Entity,
  target: Entity,
  dt: number,
  time: number,
  msgs: Msg[],
  playerId: number,
  state?: GameState,
): boolean {
  if (e.monsterKind !== MonsterKind.DIKIY_MERTVYAK) return false;
  const ai = e.ai!;

  if (dikiyMertvyakDamagedEarly(e)) {
    ai.shoveCharge = Math.max(0, (ai.shoveCharge ?? 0) - dt * 2.5);
    ai.shoveCooldown = Math.max(ai.shoveCooldown ?? 0, 0.8);
    return false;
  }

  ai.shoveCooldown = Math.max(0, (ai.shoveCooldown ?? 0) - dt);
  const pressure = dikiyMertvyakCrowdPressure(world, e, target);
  if (pressure.choke || pressure.crowd >= 2) {
    ai.shoveCharge = Math.min(1.35, (ai.shoveCharge ?? 0) + dt * (pressure.choke ? 1.45 : 1.0) + Math.max(0, pressure.crowd - 1) * 0.12);
  } else {
    ai.shoveCharge = Math.max(0, (ai.shoveCharge ?? 0) - dt * 0.9);
  }

  if ((ai.shoveCharge ?? 0) < DIKIY_SHOVE_TRIGGER || (ai.shoveCooldown ?? 0) > 0 || pressure.crowd < 2) return false;

  let shoved = 0;
  let shovedPlayer = false;
  for (const other of dikiyCrowdQuery) {
    if (!other.alive || other.id === e.id || other.type === EntityType.MONSTER) continue;
    if (world.dist2(e.x, e.y, other.x, other.y) > DIKIY_SHOVE_RADIUS * DIKIY_SHOVE_RADIUS) continue;
    if (isPlayerEntity(other)) {
      shovedPlayer = other.id === playerId;
    } else if (other.type === EntityType.NPC && other.ai) {
      other.ai.staggerTimer = Math.max(other.ai.staggerTimer ?? 0, DIKIY_SHOVE_STAGGER_SEC);
      other.ai.goal = AIGoal.FLEE;
      other.ai.combatTargetId = e.id;
      other.ai.timer = Math.max(other.ai.timer ?? 0, DIKIY_SHOVE_FLEE_SEC);
      other.ai.path.length = 0;
      other.ai.pi = 0;
    }
    shoved++;
  }
  if (shoved <= 0) return false;

  ai.shoveCharge = 0;
  ai.shoveCooldown = DIKIY_SHOVE_COOLDOWN_SEC;
  e.attackCd = Math.max(e.attackCd ?? 0, 0.35);
  if (shovedPlayer) {
    msgs.push(msg('Дикий мертвяк продавил толпу. Открытый пол и ранний удар сбивают его рывок.', time, '#f87'));
  }
  publishMonsterReadabilityEvent(state, world, e, target, 'monster_sighted', 4, ['dikiy_mertvyak', 'crowd_shove', 'panic'], {
    crowd: shoved,
    choke: pressure.choke,
    counterplay: 'open_floor_or_early_damage_before_crowd_contact',
  });
  return true;
}

function updateBloodPlantRootHive(
  world: World,
  e: Entity,
  target: Entity | null,
  dt: number,
  time: number,
  msgs: Msg[],
  playerId: number,
  state?: GameState,
): boolean {
  if (e.monsterKind !== MonsterKind.BLOOD_PLANT || !hasAIFlag(e, 'rootHive')) return false;
  const ai = e.ai!;
  ai.path = [];
  ai.pi = 0;

  ai.plantRootCd = Math.max(0, (ai.plantRootCd ?? 0) - dt);
  if (ai.plantRootCd <= 0) {
    const heal = healBloodPlantFromRedMold(world, e);
    if (heal.healed > 0 && target?.id === playerId && world.dist2(e.x, e.y, target.x, target.y) <= BLOOD_PLANT_TENDRIL_RANGE_SQ) {
      msgs.push(msg('Красная плесень в ящиках кормит ствол. Уберите пробу или жгите быстрее.', time, '#d66'));
    }
    ai.plantRootCd = BLOOD_PLANT_HEAL_SCAN_SEC + ((e.id % 3) * 0.13);
  }

  if (!target?.alive || !canBeMonsterTarget(target) || !isHostile(e, target)) {
    ai.goal = AIGoal.IDLE;
    ai.combatTargetId = undefined;
    return true;
  }

  const d2 = world.dist2(e.x, e.y, target.x, target.y);
  if (d2 > BLOOD_PLANT_TENDRIL_RANGE_SQ) {
    ai.goal = AIGoal.IDLE;
    ai.combatTargetId = undefined;
    return true;
  }

  ai.goal = AIGoal.HUNT;
  ai.combatTargetId = target.id;
  e.angle = Math.atan2(world.delta(e.y, target.y), world.delta(e.x, target.x));
  e.attackCd = Math.max(0, (e.attackCd ?? 0) - dt);
  if ((e.attackCd ?? 0) > 0) return true;

  const cells = traceBloodPlantTendrilCells(world, e.x, e.y, target.x, target.y, BLOOD_PLANT_TENDRIL_MAX_CELLS);
  const targetCell = world.idx(Math.floor(target.x), Math.floor(target.y));
  let hit = false;
  for (let i = 0; i < cells.length; i++) {
    const cell = cells[i];
    const x = cell % W;
    const y = (cell / W) | 0;
    stampMark(world, x, y, 0.5, 0.5, 0.32, MarkType.SPLAT, 15015 + e.id * 17 + i, 130, 12, 24, 185);
    if (cell === targetCell) hit = true;
  }

  if (hit && target.hp !== undefined) {
    const def = MONSTERS[MonsterKind.BLOOD_PLANT];
    const level = e.rpg?.level ?? 1;
    const strMult = e.rpg ? strMeleeDmgMult(e.rpg) : 1;
    const dmg = zhelemishIncomingMeleeDamage(target, time, Math.round(scaleMonsterDmg(def.dmg, level) * strMult * (e.monsterDmgMult ?? 1)));
    if (target.id === playerId && isDebugOnePunchManEnabled()) {
      keepDebugOnePunchManAlive(target);
    } else {
      { const _dmg = calculateDamage(dmg, DamageType.KINETIC, target); target.hp -= _dmg; applyHitStaggerAndKnockback(target, e.x, e.y, _dmg); }
      notifyActorDamaged(world, target, e, dmg, 'monster_special', time, state);
      if (target.id === playerId) recordPlayerDamage(state, e, dmg, `${entityDisplayName(e)} ударило корнем: -${dmg}`);
      if (target.hp <= 0) {
        target.alive = false;
        target.hp = 0;
      }
    }
    spawnBloodHit(world, target.x, target.y, Math.atan2(target.y - e.y, target.x - e.x), Math.max(1, dmg), target.type === EntityType.MONSTER);
    if (target.id === playerId) msgs.push(msg(`Корень кровавого растения ударил из пола: -${dmg}`, time, '#f77'));
    playSoundAt(playGrowl, e.x, e.y);
  }

  e.attackCd = MONSTERS[MonsterKind.BLOOD_PLANT].attackRate;
  return true;
}

function updateBorshchevikRootedPlant(
  world: World,
  e: Entity,
  target: Entity | null,
  dt: number,
  time: number,
  msgs: Msg[],
  playerId: number,
  state?: GameState,
): boolean {
  if (e.monsterKind !== MonsterKind.BORSHCHEVIK || !hasAIFlag(e, 'rootedPlant')) return false;
  const ai = e.ai!;
  ai.path = [];
  ai.pi = 0;

  if (!target?.alive || !canBeMonsterTarget(target) || !isHostile(e, target)) {
    ai.goal = AIGoal.IDLE;
    ai.combatTargetId = undefined;
    return true;
  }

  const d2 = world.dist2(e.x, e.y, target.x, target.y);
  if (d2 > BORSHCHEVIK_DETECT_SQ) {
    ai.goal = AIGoal.IDLE;
    ai.combatTargetId = undefined;
    return true;
  }

  ai.goal = AIGoal.HUNT;
  ai.combatTargetId = target.id;
  e.angle = Math.atan2(world.delta(e.y, target.y), world.delta(e.x, target.x));
  e.attackCd = Math.max(0, (e.attackCd ?? 0) - dt);
  ai.plantPuffCd = Math.max(0, (ai.plantPuffCd ?? 0) - dt);
  ai.plantRootCd = Math.max(0, (ai.plantRootCd ?? 1.4) - dt);

  if (d2 <= BORSHCHEVIK_SEED_SQ && (ai.plantPuffCd ?? 0) <= 0) {
    if (state) releaseBorshchevikSeedPuff(world, state, e, target, 'seed');
    ai.plantPuffCd = BORSHCHEVIK_SEED_COOLDOWN_SEC + ((e.id % 5) * 0.23);
  }

  if ((ai.plantRootCd ?? 0) <= 0 && state && damageBorshchevikRootSite(world, state, e)) {
    ai.plantRootCd = BORSHCHEVIK_ROOT_COOLDOWN_SEC;
    if (target.id === playerId) msgs.push(msg('Корни борщевика хрустнули в слабой стене. Обход меняется.', time, '#cf8'));
  } else if ((ai.plantRootCd ?? 0) <= 0) {
    ai.plantRootCd = BORSHCHEVIK_ROOT_COOLDOWN_SEC;
  }

  if (d2 <= BORSHCHEVIK_SAP_RANGE_SQ && (e.attackCd ?? 0) <= 0) {
    const def = MONSTERS[MonsterKind.BORSHCHEVIK];
    const level = e.rpg?.level ?? 1;
    const strMult = e.rpg ? strMeleeDmgMult(e.rpg) : 1;
    const dmg = zhelemishIncomingMeleeDamage(target, time, Math.round(scaleMonsterDmg(def.dmg, level) * strMult * (e.monsterDmgMult ?? 1)));
    if (target.hp !== undefined) {
      if (target.id === playerId && isDebugOnePunchManEnabled()) {
        keepDebugOnePunchManAlive(target);
      } else {
        { const _dmg = calculateDamage(dmg, DamageType.KINETIC, target); target.hp -= _dmg; applyHitStaggerAndKnockback(target, e.x, e.y, _dmg); }
        notifyActorDamaged(world, target, e, dmg, 'monster_special', time, state);
        if (target.id === playerId) recordPlayerDamage(state, e, dmg, `${entityDisplayName(e)} обжег кожу соком: -${dmg}`);
        if (target.hp <= 0) {
          target.alive = false;
          target.hp = 0;
        }
      }
      spawnBloodHit(world, target.x, target.y, Math.atan2(target.y - e.y, target.x - e.x), Math.max(1, dmg), target.type === EntityType.MONSTER);
    }
    if (target.id === playerId) msgs.push(msg(`Сок борщевика жжет кожу: -${dmg}`, time, '#df6'));
    playSoundAt(playGrowl, e.x, e.y);
    e.attackCd = def.attackRate;
  }

  return true;
}

function followMonsterPath(world: World, e: Entity, dt: number, target?: Entity): void {
  const mult = monsterMoveMult(world, e, target);
  if (mult === 1) {
    followPath(world, e, dt);
    return;
  }
  const baseSpeed = e.speed;
  e.speed = baseSpeed * mult;
  followPath(world, e, dt);
  e.speed = baseSpeed;
}

function tryFollowMonsterBait(
  world: World,
  e: Entity,
  target: Entity | null,
  dt: number,
  time: number,
  msgs: Msg[],
  state?: GameState,
): boolean {
  const combatLockSq = e.monsterKind === MonsterKind.OLGOY ? OLGOY_COMBAT_LOCK_SQ : MONSTER_BAIT_COMBAT_LOCK_SQ;
  if (target && !hasAIFlag(e, 'garbageSurround') && !hasAIFlag(e, 'sourceSwarm') && world.dist2(e.x, e.y, target.x, target.y) <= combatLockSq) {
    if (!isDocumentPressureHunter(e) || hasDocumentLikeItem(target)) return false;
  }
  const bait = findMonsterBaitTarget(world, e, dt, time, state);
  if (!bait) return false;

  const ai = e.ai!;
  ai.goal = AIGoal.HUNT;
  ai.combatTargetId = undefined;
  const baitD2 = world.dist2(e.x, e.y, bait.x, bait.y);
  if (baitD2 <= MONSTER_BAIT_CONSUME_RADIUS_SQ) {
    const dropId = consumeMonsterBait(state, bait, e, time);
    if (dropId !== undefined) {
      const drop = _entityById.get(dropId);
      if (drop) clearDeadBaitDrop(drop);
    }
    ai.path = [];
    ai.pi = 0;
    if (e.monsterKind === MonsterKind.OLGOY) {
      publishOlgoyFed(state, world, e, undefined, time, 'bait', {
        baitId: bait.id,
        itemId: bait.itemId,
        itemName: bait.itemName,
        risk: bait.risk,
        strength: bait.strength,
      });
    }
    msgs.push(msg(
      e.monsterKind === MonsterKind.OLGOY
        ? `${entityDisplayName(e)} ушел на мясную приманку`
        : `${entityDisplayName(e)} сожрал приманку`,
      time,
      '#ca6',
    ));
    return true;
  }

  const tx = Math.floor(bait.x);
  const ty = Math.floor(bait.y);
  ai.timer -= dt;
  if (ai.path.length === 0 || ai.timer <= 0 || ai.tx !== tx || ai.ty !== ty) {
    tryAssignPathToCell(world, e, tx, ty);
    ai.timer = 1.4;
  }
  if (ai.path.length === 0) return false;
  followMonsterPath(world, e, dt);
  return true;
}

function tryFollowNoise(
  world: World,
  e: Entity,
  dt: number,
  time: number,
  state?: GameState,
): boolean {
  if (hasAIFlag(e, 'deadEcho') && e.ai?.deadEchoRevealed !== true) return false;
  const noise = findNoiseInvestigationTarget(world, state, e, time);
  if (!noise) return false;

  const ai = e.ai!;
  ai.goal = AIGoal.HUNT;
  ai.combatTargetId = undefined;
  const tx = Math.floor(noise.x);
  const ty = Math.floor(noise.y);
  ai.timer -= dt;
  if (ai.path.length === 0 || ai.timer <= 0 || ai.tx !== world.wrap(tx) || ai.ty !== world.wrap(ty)) {
    tryAssignPathToCell(world, e, tx, ty);
    ai.timer = 1.25;
  }
  if (ai.path.length === 0) return false;
  followMonsterPath(world, e, dt);
  return true;
}

function updateSborkaReadability(
  world: World,
  e: Entity,
  target: Entity | null,
  time: number,
  msgs: Msg[],
  playerId: number,
  state?: GameState,
): void {
  if (e.monsterKind !== MonsterKind.SBORKA || !target || e.ai?.lastSeenTargetId === target.id) return;
  e.ai!.lastSeenTargetId = target.id;
  if (target.id === playerId) {
    msgs.push(msg('Сборка щелкнула проволокой и пошла первой. Широкий проход и дешевый выстрел решают до касания.', time, '#f86'));
  }
  publishMonsterReadabilityEvent(state, world, e, target, 'monster_sighted', target.id === playerId ? 4 : 3, ['sborka', 'cheap_chaser', 'first_sight'], {
    counterplay: 'wide_floor_early_shot_or_bait_before_combat_lock',
  });
}

function updateZombieCrowdReadability(
  world: World,
  e: Entity,
  target: Entity,
  time: number,
  msgs: Msg[],
  playerId: number,
  state?: GameState,
): void {
  if (e.monsterKind !== MonsterKind.ZOMBIE || e.ai?.lastSeenTargetId === target.id) return;
  const pressure = cheapCrowdPressure(world, e, target, ZOMBIE_CROWD_PRESSURE_RADIUS, ZOMBIE_CROWD_PRESSURE_SCAN_CAP, zombieCrowdQuery);
  if (!pressure.choke && pressure.crowd <= 0) return;
  e.ai!.lastSeenTargetId = target.id;
  if (target.id === playerId) {
    msgs.push(msg('Мертвяк хватил из дверной толпы. Выводи его на пустой проход до первого касания.', time, '#f87'));
  }
  publishMonsterReadabilityEvent(state, world, e, target, 'monster_sighted', target.id === playerId ? 4 : 3, ['zombie', 'crowd_chaser', 'door_pressure'], {
    crowd: pressure.crowd,
    capped: pressure.capped,
    choke: pressure.choke,
    damageCap: ZOMBIE_CROWD_DAMAGE_CAP,
    counterplay: 'wide_floor_early_hits_before_door_or_crowd_contact',
  });
}

function updatePomoynyRoyReadability(
  world: World,
  e: Entity,
  target: Entity | null,
  time: number,
  msgs: Msg[],
  playerId: number,
  state?: GameState,
): void {
  if (!hasAIFlag(e, 'garbageSurround') || target?.id !== playerId || e.ai?.lastSeenTargetId === playerId) return;
  const scent = pomoynyRoyScentScore(target);
  if (scent <= 0.2) return;
  e.ai!.lastSeenTargetId = playerId;
  msgs.push(msg('Помойный рой развернул край на запах еды. Закройте запас или бросайте приманку в сторону.', time, '#ca6'));
  publishMonsterReadabilityEvent(state, world, e, target, 'monster_sighted', 4, ['pomoyny_roy', 'garbage_surround', 'food_scent'], {
    scent: Math.round(scent * 100) / 100,
    counterplay: 'sealed_food_side_bait_fire_lane',
    slotRadius: POMOYNY_ROY_SLOT_RADIUS,
  });
}

function rzhavnikDormantAnchor(world: World, e: Entity): boolean {
  const roomType = world.roomAt(e.x, e.y)?.type;
  if (roomType === RoomType.STORAGE) return true;
  if (roomType === RoomType.PRODUCTION && nearDebrisFeature(world, e, 2)) return true;
  return nearDebrisFeature(world, e, 1);
}

function rzhavnikWakeNoise(noise: NoiseRecord): boolean {
  if (noise.source === 'explosion') return true;
  if (noise.source === 'weapon_fire' && noise.severity >= 3) return true;
  if (noise.source === 'melee' && (noise.tags.includes('metal') || noise.itemId === 'rebar')) return true;
  return noise.tags.includes('metal') || noise.tags.includes('pipe') || noise.tags.includes('valve');
}

function stampRzhavnikScrape(world: World, e: Entity, time: number): void {
  const x = Math.floor(e.x);
  const y = Math.floor(e.y);
  const seed = Math.imul(e.id, 11_231) ^ Math.floor(time * 20);
  stampMark(world, x, y, 0.5, 0.5, 0.46, MarkType.BULLET, seed, 165, 86, 36, 135);
  stampMark(world, x, y, 0.5, 0.58, 0.28, MarkType.DRIP, seed ^ 0x7a4, 20, 16, 12, 120);
}

function publishRzhavnikWake(
  state: GameState | undefined,
  world: World,
  e: Entity,
  target: Entity | undefined,
  reason: string,
): void {
  publishMonsterReadabilityEvent(state, world, e, target, 'monster_sighted', 4, ['rzhavnik', 'scrap_wake', reason], {
    reason,
    windupSec: RZHAVNIK_LEAP_WINDUP_SEC,
    leapStep: RZHAVNIK_LEAP_STEP,
    counterplay: 'poke_straight_scrap_from_range_then_dodge_first_leap',
  });
}

function wakeRzhavnik(
  world: World,
  e: Entity,
  target: Entity | undefined,
  x: number,
  y: number,
  time: number,
  msgs: Msg[],
  state: GameState | undefined,
  reason: string,
): void {
  const ai = e.ai!;
  ai.scrapWake = 1;
  ai.scrapWakeTimer = RZHAVNIK_LEAP_WINDUP_SEC;
  ai.combatTargetId = target?.id;
  ai.goal = AIGoal.HUNT;
  ai.tx = world.wrap(Math.floor(x));
  ai.ty = world.wrap(Math.floor(y));
  ai.path = [];
  ai.pi = 0;
  e.spriteScale = 1.16;
  stampRzhavnikScrape(world, e, time);
  if (isPlayerEntity(target)) {
    msgs.push(msg('Ровная стопка ржавых прутьев разложилась в ноги. Уклоняйтесь от первого рывка.', time, '#d86'));
  }
  publishRzhavnikWake(state, world, e, target, reason);
  playSoundAt(playGrowl, e.x, e.y);
}

function applyRzhavnikFragileState(e: Entity): void {
  const maxHp = e.maxHp ?? e.hp ?? MONSTERS[MonsterKind.RZHAVNIK].hp;
  const fragileMax = Math.max(18, Math.round(maxHp * RZHAVNIK_FRAGILE_HP_MULT));
  if (e.maxHp === undefined || e.maxHp > fragileMax) e.maxHp = fragileMax;
  if (e.hp !== undefined && e.hp > fragileMax) e.hp = fragileMax;
  e.monsterDmgMult = Math.min(e.monsterDmgMult ?? 1, RZHAVNIK_FRAGILE_DMG_MULT);
  e.spriteScale = 0.88;
}

function finishRzhavnikLeap(
  world: World,
  entities: Entity[],
  e: Entity,
  target: Entity | undefined,
  time: number,
  msgs: Msg[],
  playerId: number,
  nextId: { v: number },
  state?: GameState,
): void {
  const ai = e.ai!;
  const tx = target?.alive ? target.x : ai.tx + 0.5;
  const ty = target?.alive ? target.y : ai.ty + 0.5;
  const dx = world.delta(e.x, tx);
  const dy = world.delta(e.y, ty);
  const dist = Math.max(0.001, Math.sqrt(dx * dx + dy * dy));
  const step = Math.min(RZHAVNIK_LEAP_STEP, Math.max(0, dist - 0.65));
  const nx = world.wrap(e.x + (dx / dist) * step);
  const ny = world.wrap(e.y + (dy / dist) * step);
  if (!world.solid(Math.floor(nx), Math.floor(ny)) && traceClearPoint(world, e, nx, ny, RZHAVNIK_LEAP_STEP + 0.35)) {
    e.x = nx;
    e.y = ny;
  }
  e.angle = Math.atan2(dy, dx);

  let damage = 0;
  if (target?.alive && target.hp !== undefined && world.dist2(e.x, e.y, target.x, target.y) <= RZHAVNIK_LEAP_HIT_SQ) {
    const def = MONSTERS[MonsterKind.RZHAVNIK];
    const level = e.rpg?.level ?? 1;
    const strMult = e.rpg ? strMeleeDmgMult(e.rpg) : 1;
    damage = zhelemishIncomingMeleeDamage(
      target,
      time,
      Math.round(scaleMonsterDmg(def.dmg, level) * strMult * RZHAVNIK_LEAP_DAMAGE_MULT),
    );
    if (target.id === playerId && isDebugOnePunchManEnabled()) {
      keepDebugOnePunchManAlive(target);
    } else {
      { const _dmg = calculateDamage(damage, DamageType.KINETIC, target); target.hp -= _dmg; applyHitStaggerAndKnockback(target, e.x, e.y, _dmg); }
      notifyActorDamaged(world, target, e, damage, 'monster_special', time, state);
      if (target.id === playerId) recordPlayerDamage(state, e, damage, `Ржавник ударил первым рывком: -${damage}`);
      if (target.hp <= 0) {
        target.alive = false;
        target.hp = 0;
      }
      spawnBloodHit(world, target.x, target.y, Math.atan2(target.y - e.y, target.x - e.x), damage, target.type === EntityType.MONSTER);
      if (target.hp <= 0) {
        spawnDeathPool(world, target.x, target.y, target.type === EntityType.MONSTER);
        if (target.type === EntityType.NPC) dropNpcInventory(target, entities, nextId);
        msgs.push(msg(`${entityDisplayName(e)} убил ${entityDisplayName(target)} первым металлическим рывком`, time, '#f44'));
      }
    }
  }

  ai.scrapWake = 2;
  ai.scrapWakeTimer = undefined;
  ai.staggerTimer = Math.max(ai.staggerTimer ?? 0, 0.42);
  e.attackCd = Math.max(e.attackCd ?? 0, MONSTERS[MonsterKind.RZHAVNIK].attackRate * 0.85);
  applyRzhavnikFragileState(e);
  stampRzhavnikScrape(world, e, time);
  if (isPlayerEntity(target)) {
    msgs.push(msg(
      damage > 0
        ? `Ржавник попал первым рывком: -${damage}. Теперь корпус хрупкий.`
        : 'Ржавник промахнулся первым рывком и рассыпался в хрупкую походку.',
      time,
      damage > 0 ? '#f86' : '#fc4',
    ));
  }
}

function updateRzhavnikScrapWake(
  world: World,
  entities: Entity[],
  e: Entity,
  dt: number,
  time: number,
  msgs: Msg[],
  playerId: number,
  nextId: { v: number },
  state?: GameState,
): boolean {
  if (e.monsterKind !== MonsterKind.RZHAVNIK || !hasAIFlag(e, 'scrapWake')) return false;
  const ai = e.ai!;
  if (ai.scrapWake === undefined) ai.scrapWake = rzhavnikDormantAnchor(world, e) ? 0 : 2;

  if (ai.scrapWake === 2) {
    e.monsterDmgMult = Math.min(e.monsterDmgMult ?? 1, RZHAVNIK_FRAGILE_DMG_MULT);
    return false;
  }

  if (ai.scrapWake === 1) {
    ai.scrapWakeTimer = Math.max(0, (ai.scrapWakeTimer ?? 0) - dt);
    e.spriteScale = 1.12 + ai.scrapWakeTimer * 0.18;
    if (ai.scrapWakeTimer > 0) return true;
    const cached = ai.combatTargetId !== undefined ? _entityById.get(ai.combatTargetId) : undefined;
    const player = _entityById.get(playerId);
    const target = cached?.alive ? cached : player?.alive ? player : undefined;
    finishRzhavnikLeap(world, entities, e, target, time, msgs, playerId, nextId, state);
    return true;
  }

  const maxHp = e.maxHp ?? e.hp ?? MONSTERS[MonsterKind.RZHAVNIK].hp;
  const damaged = e.hp !== undefined && e.hp < maxHp;
  const closeTarget = findImmediateCombatTarget(world, e, RZHAVNIK_CLOSE_WAKE_SQ, canBeMonsterTarget);
  const noise = findNoiseForActor(world, state, e, time, {
    minSeverity: 2,
    scanInterval: 0.25,
    hearingMult: 1.2,
  });

  if (damaged) {
    const player = _entityById.get(playerId);
    wakeRzhavnik(world, e, player?.alive ? player : closeTarget ?? undefined, e.x, e.y, time, msgs, state, 'ranged_poke');
    return true;
  }
  if (closeTarget) {
    wakeRzhavnik(world, e, closeTarget, closeTarget.x, closeTarget.y, time, msgs, state, 'close_approach');
    return true;
  }
  if (noise && rzhavnikWakeNoise(noise)) {
    const player = noise.actorId === playerId ? _entityById.get(playerId) : undefined;
    wakeRzhavnik(world, e, player?.alive ? player : undefined, noise.x, noise.y, time, msgs, state, 'loud_metal');
    return true;
  }

  ai.goal = AIGoal.IDLE;
  ai.combatTargetId = undefined;
  ai.path = [];
  ai.pi = 0;
  e.spriteScale = 0.62;
  return true;
}

function publishZhornayaScentEvent(
  state: GameState | undefined,
  world: World,
  e: Entity,
  scent: ZhornayaScentTarget,
  playerId: number,
  reason: string,
): void {
  if (!state) return;
  const target = scent.entity?.id === playerId ? scent.entity : undefined;
  publishEvent(state, {
    type: 'monster_sighted',
    zoneId: zoneIdAt(world, e.x, e.y),
    x: e.x,
    y: e.y,
    actorId: e.id,
    actorName: entityDisplayName(e),
    actorFaction: e.faction,
    targetId: target?.id,
    targetName: target ? entityDisplayName(target) : undefined,
    targetFaction: target?.faction,
    itemId: scent.bait?.itemId ?? (scent.entity?.type === EntityType.ITEM_DROP ? scent.entity.inventory?.[0]?.defId : undefined),
    itemName: scent.bait?.itemName,
    monsterKind: e.monsterKind,
    severity: 3,
    privacy: target ? 'local' : 'witnessed',
    tags: ['monster', 'scent', 'lunge', scent.source, reason],
    data: {
      counterplay: 'sealed food, side bait, punish recovery',
      scentScore: scent.score,
      source: scent.source,
      baitId: scent.bait?.id,
      rumorIds: ['ecology_zhornaya_tvar_scent'],
    },
  });
}

function damageZhornayaTarget(
  world: World,
  entities: Entity[],
  e: Entity,
  target: Entity,
  time: number,
  msgs: Msg[],
  playerId: number,
  nextId: { v: number },
  state?: GameState,
): boolean {
  const def = MONSTERS[MonsterKind.ZHORNAYA_TVAR];
  const level = e.rpg?.level ?? 1;
  const strMult = e.rpg ? strMeleeDmgMult(e.rpg) : 1;
  const rawDmg = Math.round(scaleMonsterDmg(def.dmg, level) * strMult * 1.18 * (e.monsterDmgMult ?? 1));
  const dmg = zhelemishIncomingMeleeDamage(target, time, rawDmg);
  if (target.hp === undefined) return false;

  const debugImmortalPlayerHit = target.id === playerId && isDebugOnePunchManEnabled();
  if (debugImmortalPlayerHit) {
    keepDebugOnePunchManAlive(target);
  } else {
    { const _dmg = calculateDamage(dmg, DamageType.KINETIC, target); target.hp -= _dmg; applyHitStaggerAndKnockback(target, e.x, e.y, _dmg); }
    notifyActorDamaged(world, target, e, dmg, 'monster_special', time, state);
    if (target.id === playerId) recordPlayerDamage(state, e, dmg, `${entityDisplayName(e)} врезалась в тебя на запах: -${dmg}`);
    if (target.hp <= 0) { target.alive = false; target.hp = 0; }
    const hitAng = Math.atan2(target.y - e.y, target.x - e.x);
    spawnBloodHit(world, target.x, target.y, hitAng, dmg, target.type === EntityType.MONSTER);
    if (target.hp <= 0) {
      spawnDeathPool(world, target.x, target.y, target.type === EntityType.MONSTER);
      if (target.type === EntityType.NPC) dropNpcInventory(target, entities, nextId);
      msgs.push(msg(`${entityDisplayName(e)} убила ${entityDisplayName(target)}`, time, '#f44'));
    }
  }

  const label = isPlayerEntity(target) ? 'тебя' : entityDisplayName(target);
  msgs.push(msg(`${entityDisplayName(e)} сорвалась на запах и ударила ${label}: -${dmg}`, time, '#f44'));
  return true;
}

function finishZhornayaLunge(
  world: World,
  entities: Entity[],
  e: Entity,
  scent: ZhornayaScentTarget,
  time: number,
  msgs: Msg[],
  playerId: number,
  nextId: { v: number },
  state?: GameState,
): void {
  const ai = e.ai!;
  const dx = world.delta(e.x, scent.x);
  const dy = world.delta(e.y, scent.y);
  const dist = Math.max(0.001, Math.sqrt(dx * dx + dy * dy));
  const step = Math.min(dist, ZHORNAYA_LUNGE_STEP);
  e.x = world.wrap(e.x + (dx / dist) * step);
  e.y = world.wrap(e.y + (dy / dist) * step);
  e.angle = Math.atan2(dy, dx);

  let connected = false;
  if (scent.bait && world.dist2(e.x, e.y, scent.bait.x, scent.bait.y) <= MONSTER_BAIT_CONSUME_RADIUS_SQ) {
    const dropId = consumeMonsterBait(state, scent.bait, e, time);
    if (dropId !== undefined) {
      const drop = _entityById.get(dropId);
      if (drop) clearDeadBaitDrop(drop);
    }
    msgs.push(msg(`${entityDisplayName(e)} перелетела на приманку и жует`, time, '#ca6'));
    connected = true;
  } else if (scent.entity?.type === EntityType.ITEM_DROP && world.dist2(e.x, e.y, scent.entity.x, scent.entity.y) <= MONSTER_BAIT_CONSUME_RADIUS_SQ) {
    clearDeadBaitDrop(scent.entity);
    msgs.push(msg(`${entityDisplayName(e)} сорвалась на пищевой запах`, time, '#ca6'));
    connected = true;
  } else if (scent.entity && scent.entity.alive && world.dist2(e.x, e.y, scent.entity.x, scent.entity.y) <= ZHORNAYA_HIT_RANGE_SQ) {
    connected = damageZhornayaTarget(world, entities, e, scent.entity, time, msgs, playerId, nextId, state);
  }

  if (!connected) {
    msgs.push(msg(`${entityDisplayName(e)} промахнулась рывком и тяжело собирает брюхо`, time, '#fc4'));
    publishZhornayaScentEvent(state, world, e, scent, playerId, 'missed');
  }

  ai.path = [];
  ai.pi = 0;
  ai.timer = 0.8;
  ai.staggerTimer = connected ? ZHORNAYA_HIT_RECOVERY_SEC : ZHORNAYA_MISS_RECOVERY_SEC;
  e.attackCd = connected ? MONSTERS[MonsterKind.ZHORNAYA_TVAR].attackRate : ZHORNAYA_MISS_COOLDOWN_SEC;
  e.spriteScale = connected ? 1.04 : 0.88;
  zhornayaScentRuntime.delete(e);
  playSoundAt(playGrowl, e.x, e.y);
}

function updateZhornayaTvar(
  world: World,
  entities: Entity[],
  e: Entity,
  target: Entity | null,
  dt: number,
  time: number,
  msgs: Msg[],
  playerId: number,
  nextId: { v: number },
  state?: GameState,
): boolean {
  if (!hasAIFlag(e, 'scentOvercommit')) return false;
  const ai = e.ai!;
  e.attackCd = Math.max(0, (e.attackCd ?? 0) - dt);

  if ((ai.staggerTimer ?? 0) > 0) {
    ai.staggerTimer = Math.max(0, (ai.staggerTimer ?? 0) - dt);
    e.spriteScale = 0.88 + (ai.staggerTimer > 0 ? 0 : 0.12);
    return true;
  }
  e.spriteScale = undefined;

  const scent = findZhornayaScentTarget(world, e, target, dt, time, state);
  if (!scent) return false;
  ai.goal = AIGoal.HUNT;
  ai.combatTargetId = scent.entity && scent.entity.type !== EntityType.ITEM_DROP ? scent.entity.id : undefined;

  const d2 = world.dist2(e.x, e.y, scent.x, scent.y);
  if (scent.bait && d2 <= MONSTER_BAIT_CONSUME_RADIUS_SQ) {
    const dropId = consumeMonsterBait(state, scent.bait, e, time);
    if (dropId !== undefined) {
      const drop = _entityById.get(dropId);
      if (drop) clearDeadBaitDrop(drop);
    }
    msgs.push(msg(`${entityDisplayName(e)} сожрала приманку`, time, '#ca6'));
    ai.baitMarkerId = undefined;
    zhornayaScentRuntime.delete(e);
    return true;
  }
  if (scent.entity?.type === EntityType.ITEM_DROP && d2 <= MONSTER_BAIT_CONSUME_RADIUS_SQ) {
    clearDeadBaitDrop(scent.entity);
    msgs.push(msg(`${entityDisplayName(e)} сожрала пахнущий сброс`, time, '#ca6'));
    zhornayaScentRuntime.delete(e);
    return true;
  }

  if (d2 <= ZHORNAYA_LUNGE_RANGE_SQ && (e.attackCd ?? 0) <= 0 && traceClearPoint(world, e, scent.x, scent.y, ZHORNAYA_LUNGE_RANGE)) {
    e.spriteScale = 1.18;
    publishZhornayaScentEvent(state, world, e, scent, playerId, 'locked');
    finishZhornayaLunge(world, entities, e, scent, time, msgs, playerId, nextId, state);
    return true;
  }

  e.spriteScale = 1.08;
  const tx = Math.floor(scent.x);
  const ty = Math.floor(scent.y);
  ai.timer -= dt;
  if (ai.path.length === 0 || ai.timer <= 0 || ai.tx !== world.wrap(tx) || ai.ty !== world.wrap(ty)) {
    tryAssignPathToCell(world, e, tx, ty);
    ai.timer = 1.0;
  }
  if (ai.path.length > 0) followMonsterPath(world, e, dt);
  return true;
}

function findDocumentHunterTarget(world: World, _entities: Entity[], e: Entity, dt: number): Entity | null {
  const ai = e.ai!;
  let target: Entity | null = null;
  const docRangeSq = documentDetectSq(e);
  const fallbackRangeSq = documentFallbackSq(e);

  ai.combatScanCd = (ai.combatScanCd ?? 0) - dt;
  if (ai.combatTargetId !== undefined) {
    const cached = _entityById.get(ai.combatTargetId);
    if (cached && cached.alive && canBeMonsterTarget(cached)) {
      const d2 = world.dist2(e.x, e.y, cached.x, cached.y);
      const documentRange = hasDocumentLikeItem(cached) && d2 < docRangeSq;
      const fallbackRange = d2 < fallbackRangeSq;
      if ((documentRange || fallbackRange) && isHostile(e, cached)) target = cached;
    }
    if (!target) ai.combatTargetId = undefined;
  }

  if (ai.combatScanCd! <= 0) {
    ai.combatScanCd = hasAIFlag(e, 'documentScent') ? 1.1 : 1.5;
    let docTarget: Entity | null = null;
    let docBest = docRangeSq;
    let fallbackTarget: Entity | null = null;
    let fallbackBest = fallbackRangeSq;
    getEntityIndex().queryRadiusCapped(e.x, e.y, Math.sqrt(docRangeSq), documentHunterQuery, ENTITY_MASK_ACTOR, DOCUMENT_HUNTER_SCAN_CAP);
    for (const other of documentHunterQuery) {
      if (!other.alive || other.id === e.id || !canBeMonsterTarget(other)) continue;
      if (!isHostile(e, other)) continue;
      const d2 = world.dist2(e.x, e.y, other.x, other.y);
      if (hasDocumentLikeItem(other) && d2 < docBest) {
        docBest = d2;
        docTarget = other;
      } else if (d2 < fallbackBest) {
        fallbackBest = d2;
        fallbackTarget = other;
      }
    }
    target = docTarget ?? fallbackTarget;
    if (target) ai.combatTargetId = target.id;
  }

  return target;
}

function applyKontorshchikGrab(
  state: GameState | undefined,
  world: World,
  e: Entity,
  target: Entity,
  time: number,
  msgs: Msg[],
): void {
  if (e.monsterKind !== MonsterKind.KONTORSHCHIK || documentScentStrength(target) <= 0) return;
  const mark = markNoisyDocument(target, time, e.id);
  if (!mark) return;
  const targetIsPlayer = isPlayerEntity(target);
  msgs.push(msg(
    mark.marked
      ? `Конторщик проштамповал ${mark.itemName}: бумага шумит и тянет хват.`
      : `Конторщик дернул ${mark.itemName}, но бумага уже помечена иначе.`,
    time,
    targetIsPlayer ? '#d9b36a' : '#b98',
  ));
  if (!state) return;
  publishEvent(state, {
    type: 'monster_sighted',
    zoneId: zoneIdAt(world, e.x, e.y),
    x: e.x,
    y: e.y,
    actorId: e.id,
    actorName: entityDisplayName(e),
    actorFaction: e.faction,
    targetId: target.id,
    targetName: entityDisplayName(target),
    targetFaction: target.faction,
    monsterKind: e.monsterKind,
    itemId: mark.itemId,
    itemName: mark.itemName,
    severity: targetIsPlayer ? 4 : 3,
    privacy: targetIsPlayer ? 'local' : 'witnessed',
    tags: ['monster', 'kontorshchik', 'document_scent', 'noisy_document'],
    data: {
      noisyUntil: mark.until,
      noisyMarked: mark.marked,
      counterplay: 'drop_or_stash_documents',
      rumorIds: ['ecology_kontorshchik_forms'],
    },
  });
}

function bladeEliteHasLine(world: World, e: Entity, target: Entity, tuning: BladeEliteTuning): boolean {
  return tuning.coverBlocks
    ? hasClearLineOfFire(world, e, target, tuning.burstRange)
    : hasClearLine(world, e, target, tuning.burstRange);
}

function publishBladeEliteEscape(
  tuning: BladeEliteTuning,
  world: World,
  e: Entity,
  target: Entity | undefined,
  playerId: number,
  state: GameState | undefined,
  reason: string,
): void {
  const ai = e.ai!;
  if (target?.id !== playerId && ai.lastSeenTargetId !== playerId) return;
  publishBladeEliteEvent(tuning, state, world, e, target, 'monster_escaped', 4, ['escaped'], { reason });
  ai.lastSeenTargetId = undefined;
}

function finishBladeEliteWindup(
  tuning: BladeEliteTuning,
  world: World,
  entities: Entity[],
  e: Entity,
  target: Entity,
  time: number,
  msgs: Msg[],
  nextId: { v: number },
  state: GameState | undefined,
  playerId: number,
): void {
  const def = MONSTERS[tuning.kind];
  const level = e.rpg?.level ?? 1;
  const strMult = e.rpg ? strMeleeDmgMult(e.rpg) : 1;
  let dmg = Math.round(scaleMonsterDmg(def.dmg, level) * strMult * (e.monsterDmgMult ?? 1));
  const armorCut = cutMetalSheet(target);
  if (armorCut) dmg = Math.max(7, Math.round(dmg * 0.55));

  if (target.hp !== undefined) {
    const debugImmortalPlayerHit = target.id === playerId && isDebugOnePunchManEnabled();
    if (debugImmortalPlayerHit) {
      keepDebugOnePunchManAlive(target);
    } else {
      { const _dmg = calculateDamage(dmg, DamageType.KINETIC, target); target.hp -= _dmg; applyHitStaggerAndKnockback(target, e.x, e.y, _dmg); }
      notifyActorDamaged(world, target, e, dmg, 'monster_special', time, state);
      if (target.id === playerId) recordPlayerDamage(state, e, dmg, `${entityDisplayName(e)} ${tuning.strikeVerb} тебя: -${dmg}`);
      if (target.hp <= 0) {
        target.alive = false;
        target.hp = 0;
      }
      const hitAng = Math.atan2(target.y - e.y, target.x - e.x);
      spawnBloodHit(world, target.x, target.y, hitAng, dmg, target.type === EntityType.MONSTER);
      const targetLabel = isPlayerEntity(target) ? 'тебя' : entityDisplayName(target);
      msgs.push(msg(
        armorCut
          ? `${entityDisplayName(e)} срезал бронелист и задел ${targetLabel}: -${dmg}`
          : `${entityDisplayName(e)} ${tuning.strikeVerb} ${targetLabel}: -${dmg}`,
        time,
        armorCut ? '#fc4' : '#f44',
      ));
      publishBladeEliteEvent(tuning, state, world, e, target, 'monster_armor_cut', armorCut ? 5 : 4, ['hit', armorCut ? 'armor_cut' : 'burst'], {
        damage: dmg,
        armorCut,
        itemId: armorCut ? 'metal_sheet' : undefined,
        itemName: armorCut ? ITEMS.metal_sheet?.name : undefined,
      });
      if (target.hp <= 0) {
        spawnDeathPool(world, target.x, target.y, target.type === EntityType.MONSTER);
        if (target.type === EntityType.NPC) dropNpcInventory(target, entities, nextId);
        msgs.push(msg(`${entityDisplayName(e)} убил ${entityDisplayName(target)}`, time, '#f44'));
      }
    }
  }

  e.attackCd = def.attackRate;
  e.spriteScale = undefined;
  e.ai!.windupTimer = undefined;
  e.ai!.windupTargetId = undefined;
  if (target.id === playerId) e.ai!.lastSeenTargetId = playerId;
  playSoundAt(playGrowl, e.x, e.y);
}

function updateBladeElite(
  world: World,
  entities: Entity[],
  e: Entity,
  target: Entity,
  dt: number,
  time: number,
  msgs: Msg[],
  playerId: number,
  nextId: { v: number },
  state?: GameState,
): boolean {
  const tuning = bladeEliteTuning(e.monsterKind);
  if (!tuning) return false;
  const ai = e.ai!;
  const dist = Math.sqrt(world.dist2(e.x, e.y, target.x, target.y));

  if (target.id === playerId && ai.lastSeenTargetId !== playerId) {
    ai.lastSeenTargetId = playerId;
    publishBladeEliteEvent(tuning, state, world, e, target, 'monster_sighted', 4, ['sighted', 'warning'], {
      counterplay: tuning.counterplay,
    });
    msgs.push(msg(tuning.sightMsg, time, '#fa4'));
    playSoundAt(playGrowl, e.x, e.y);
  }

  if ((ai.staggerTimer ?? 0) > 0) {
    ai.staggerTimer = Math.max(0, (ai.staggerTimer ?? 0) - dt);
    e.spriteScale = 0.95;
    e.attackCd = Math.max(e.attackCd ?? 0, 0.35);
    return true;
  }

  e.spriteScale = undefined;
  e.attackCd = Math.max(0, (e.attackCd ?? 0) - dt);

  if ((ai.windupTimer ?? 0) > 0) {
    ai.windupTimer = Math.max(0, (ai.windupTimer ?? 0) - dt);
    e.angle = Math.atan2(world.delta(e.y, target.y), world.delta(e.x, target.x));
    e.spriteScale = 1.1 + Math.max(0, ai.windupTimer) * 0.08;

    if (!target.alive || dist > tuning.burstRange || !bladeEliteHasLine(world, e, target, tuning)) {
      publishBladeEliteEscape(tuning, world, e, target, playerId, state, dist > tuning.burstRange ? 'distance' : 'obstacle');
      msgs.push(msg(`${entityDisplayName(e)} промахнулся: цель вышла из замаха.`, time, '#fc4'));
      ai.windupTimer = undefined;
      ai.windupTargetId = undefined;
      e.spriteScale = undefined;
      e.attackCd = 0.75;
      return true;
    }

    if (ai.windupTimer <= 0) finishBladeEliteWindup(tuning, world, entities, e, target, time, msgs, nextId, state, playerId);
    return true;
  }

  if (dist <= tuning.windupRange && e.attackCd <= 0 && bladeEliteHasLine(world, e, target, tuning)) {
    ai.windupTimer = tuning.windupSec;
    ai.windupTargetId = target.id;
    e.spriteScale = 1.18;
    msgs.push(msg(tuning.windupMsg, time, '#fa4'));
    playSoundAt(playGrowl, e.x, e.y);
    return true;
  }

  if (dist > tuning.escapeDist) ai.windupTargetId = undefined;
  if (ai.path.length === 0 || ai.timer <= 0) {
    tryAssignPathToCell(world, e, Math.floor(target.x), Math.floor(target.y));
    ai.timer = 1.4;
  }
  ai.timer -= dt;
  followMonsterPath(world, e, dt);
  return true;
}

function sporeCarpetRoomId(world: World, e: Entity): number | undefined {
  const rid = world.roomMap[world.idx(Math.floor(e.x), Math.floor(e.y))];
  return rid >= 0 ? rid : undefined;
}

function sporeCarpetEventName(e: Entity | undefined): string | undefined {
  if (!e) return undefined;
  if (isPlayerEntity(e)) return 'Вы';
  return entityDisplayName(e);
}

function publishSporeCarpetEvent(
  state: GameState | undefined,
  world: World,
  e: Entity,
  target: Entity | undefined,
  type: 'spore_carpet_woke' | 'spore_carpet_burned' | 'spore_carpet_puff',
  severity: 3 | 4,
  tags: string[],
  data?: Record<string, unknown>,
): void {
  if (!state) return;
  publishEvent(state, {
    type,
    zoneId: zoneIdAt(world, e.x, e.y),
    roomId: sporeCarpetRoomId(world, e),
    x: e.x,
    y: e.y,
    actorId: e.id,
    actorName: entityDisplayName(e),
    actorFaction: e.faction,
    targetId: target?.id,
    targetName: sporeCarpetEventName(target),
    targetFaction: target?.faction,
    monsterKind: MonsterKind.SPORE_CARPET,
    severity,
    privacy: isPlayerEntity(target) ? 'local' : 'witnessed',
    tags: ['monster', 'spore_carpet', 'lurking_furniture', ...tags],
    data: {
      rumorIds: [...SPORE_CARPET_RUMOR_IDS],
      counterplay: MONSTERS[MonsterKind.SPORE_CARPET]?.counterplay,
      ...data,
    },
  });
}

function wakeSporeCarpet(
  state: GameState | undefined,
  world: World,
  e: Entity,
  target: Entity | undefined,
  time: number,
  msgs: Msg[],
  reason: 'near' | 'damage' | 'container' | 'fire',
): void {
  if (e.monsterStage === 1) return;
  e.monsterStage = 1;
  const ai = e.ai!;
  ai.sporePuffCd = Math.min(ai.sporePuffCd ?? 0.8, 0.8);
  e.spriteScale = 1.06;
  if (isPlayerEntity(target)) {
    msgs.push(msg('Ковер поднял угол и повис в проходе. Жилы на ткани шевелятся.', time, '#bf8'));
  }
  publishSporeCarpetEvent(state, world, e, target, 'spore_carpet_woke', 4, ['woke', reason], {
    reason,
    puffCooldown: SPORE_CARPET_PUFF_COOLDOWN_SEC,
  });
}

function sporeCarpetContainerWakeTarget(
  state: GameState | undefined,
  world: World,
  e: Entity,
  dt: number,
  time: number,
): Entity | null {
  const ai = e.ai!;
  ai.sporeContainerScanCd = (ai.sporeContainerScanCd ?? 0) - dt;
  if (ai.sporeContainerScanCd > 0 || !state) return null;
  ai.sporeContainerScanCd = SPORE_CARPET_CONTAINER_SCAN_SEC;

  const sinceId = ai.sporeLastContainerEventId ?? 0;
  const events = getRecentEvents(state, { type: 'container_opened', sinceId, limit: 6 });
  let maxId = sinceId;
  let target: Entity | null = null;
  for (const event of events) {
    if (event.id > maxId) maxId = event.id;
    if (event.x === undefined || event.y === undefined) continue;
    if (event.time < time - 1.8) continue;
    if (world.dist2(e.x, e.y, event.x + 0.5, event.y + 0.5) > SPORE_CARPET_CONTAINER_WAKE_RADIUS_SQ) continue;
    const actor = event.actorId !== undefined ? _entityById.get(event.actorId) : undefined;
    if (actor?.alive && canBeMonsterTarget(actor) && isHostile(e, actor)) {
      target = actor;
      break;
    }
  }
  if (events.length === 0 && state.worldEvents) {
    maxId = Math.max(maxId, state.worldEvents.nextId - 1);
  }
  ai.sporeLastContainerEventId = maxId;
  return target;
}

function sporeCarpetDoorBlockCell(world: World, e: Entity, target: Entity): { x: number; y: number } {
  const tx = Math.floor(target.x);
  const ty = Math.floor(target.y);
  let best: { x: number; y: number } | null = null;
  let bestScore = Infinity;
  const dirs = [[1, 0], [-1, 0], [0, 1], [0, -1]] as const;
  for (let dy = -SPORE_CARPET_DOOR_SCAN_RADIUS; dy <= SPORE_CARPET_DOOR_SCAN_RADIUS; dy++) {
    for (let dx = -SPORE_CARPET_DOOR_SCAN_RADIUS; dx <= SPORE_CARPET_DOOR_SCAN_RADIUS; dx++) {
      const x = world.wrap(tx + dx);
      const y = world.wrap(ty + dy);
      if (world.cells[world.idx(x, y)] !== Cell.DOOR) continue;
      const candidates: { x: number; y: number }[] = world.solid(x, y) ? [] : [{ x, y }];
      for (const [ox, oy] of dirs) {
        const ax = world.wrap(x + ox);
        const ay = world.wrap(y + oy);
        if (!world.solid(ax, ay)) candidates.push({ x: ax, y: ay });
      }
      for (const cell of candidates) {
        const targetD2 = world.dist2(target.x, target.y, cell.x + 0.5, cell.y + 0.5);
        const selfD2 = world.dist2(e.x, e.y, cell.x + 0.5, cell.y + 0.5);
        const score = targetD2 * 0.72 + selfD2 * 0.18;
        if (score >= bestScore) continue;
        bestScore = score;
        best = cell;
      }
    }
  }
  return best ?? { x: Math.floor(target.x), y: Math.floor(target.y) };
}

function puffSporeFog(world: World, x: number, y: number): number {
  const cx = Math.floor(x);
  const cy = Math.floor(y);
  let changed = 0;
  for (let dy = -4; dy <= 4; dy++) {
    for (let dx = -4; dx <= 4; dx++) {
      if (changed >= SPORE_CARPET_FOG_CELL_CAP) break;
      const px = world.wrap(cx + dx);
      const py = world.wrap(cy + dy);
      if (world.solid(px, py)) continue;
      if (world.dist2(x, y, px + 0.5, py + 0.5) > SPORE_CARPET_PUFF_RADIUS_SQ) continue;
      const ci = world.idx(px, py);
      const nextFog = Math.max(world.fog[ci], 58);
      if (nextFog === world.fog[ci]) continue;
      world.fog[ci] = nextFog;
      changed++;
    }
  }
  if (changed > 0) world.markFogDirty();
  return changed;
}

function applySporeCarpetPuff(
  world: World,
  e: Entity,
  time: number,
  msgs: Msg[],
  playerId: number,
  state?: GameState,
): number {
  const fogCells = puffSporeFog(world, e.x, e.y);
  stampMark(world, Math.floor(e.x), Math.floor(e.y), 0.5, 0.5, 0.72, MarkType.SPLAT, e.id ^ Math.floor(time * 60), 92, 128, 72, 130);
  getEntityIndex().queryRadiusCapped(
    e.x,
    e.y,
    SPORE_CARPET_PUFF_RADIUS,
    sporeCarpetPuffQuery,
    ENTITY_MASK_ACTOR,
    SPORE_CARPET_PUFF_TARGET_CAP + 1,
  );

  let hits = 0;
  let playerHit = false;
  for (const target of sporeCarpetPuffQuery) {
    if (!target.alive || target.id === e.id || !canBeMonsterTarget(target)) continue;
    if (!isHostile(e, target)) continue;
    if (world.dist2(e.x, e.y, target.x, target.y) > SPORE_CARPET_PUFF_RADIUS_SQ) continue;
    const protectedByGear = hasSporeHazeProtection(target);
    const dmg = protectedByGear ? 1 : 3;
    if (target.hp !== undefined) {
      if (target.id === playerId && isDebugOnePunchManEnabled()) {
        keepDebugOnePunchManAlive(target);
      } else {
        { const _dmg = calculateDamage(dmg, DamageType.KINETIC, target); target.hp -= _dmg; applyHitStaggerAndKnockback(target, e.x, e.y, _dmg); }
        notifyActorDamaged(world, target, e, dmg, 'monster_special', time, state);
        if (target.hp <= 0) {
          target.hp = 0;
          target.alive = false;
        }
      }
    }
    applySporeHaze(target, time, msgs, state, e);
    hits++;
    if (target.id === playerId) {
      playerHit = true;
      state!.dmgFlash = Math.max(state!.dmgFlash, protectedByGear ? 0.08 : 0.16);
      state!.dmgSeed = (state!.dmgSeed + 29) | 0;
      recordPlayerDamage(state, e, dmg, `Споры ковра режут глаза: -${dmg}`, 'hazard');
    }
  }

  if (hits > 0) {
    msgs.push(msg(playerHit ? 'Ковер выплюнул споры в лицо.' : `Ковер выплюнул споры: целей ${hits}.`, time, '#bf8'));
  }
  publishSporeCarpetEvent(state, world, e, playerHit ? _entityById.get(playerId) : undefined, 'spore_carpet_puff', playerHit ? 4 : 3, ['spores', 'cooldown_capped'], {
    hits,
    fogCells,
    radius: SPORE_CARPET_PUFF_RADIUS,
    cooldown: SPORE_CARPET_PUFF_COOLDOWN_SEC,
  });
  return hits;
}

function isSporeCarpetFireProjectile(projectile: Entity): boolean {
  return (projectile.projType ?? ProjType.NORMAL) === ProjType.FLAME ||
    projectile.sprite === Spr.FLAME_BOLT ||
    projectile.sprite === Spr.HOSTILE_FLAME_BOLT;
}

function recoilSporeCarpetFromFire(
  world: World,
  state: GameState,
  monster: Entity,
  projectile: Entity,
  playerId: number,
): boolean {
  if (monster.monsterKind !== MonsterKind.SPORE_CARPET || !monster.ai || !isSporeCarpetFireProjectile(projectile)) return false;
  const actor = _entityById.get(projectile.ownerId ?? -1);
  const target = actor?.alive ? actor : _entityById.get(playerId);
  wakeSporeCarpet(state, world, monster, target, state.time, state.msgs, 'fire');
  monster.ai.sporeRecoilTimer = SPORE_CARPET_FIRE_RECOIL_SEC;
  monster.ai.sporePuffCd = Math.max(monster.ai.sporePuffCd ?? 0, SPORE_CARPET_FIRE_RECOIL_SEC + 1.0);
  monster.attackCd = Math.max(monster.attackCd ?? 0, SPORE_CARPET_FIRE_RECOIL_SEC);
  monster.spriteScale = 0.82;
  stampMark(world, Math.floor(monster.x), Math.floor(monster.y), 0.5, 0.5, 0.58, MarkType.BURN, monster.id ^ 0x5f09, 36, 22, 12, 170);
  if ((monster.ai.sporeBurnedAt ?? -999) <= state.time - 1.4) {
    monster.ai.sporeBurnedAt = state.time;
    state.msgs.push(msg('Огонь сжал Ковер: споровые жилы втянулись на пару секунд.', state.time, '#fa4'));
    publishSporeCarpetEvent(state, world, monster, target, 'spore_carpet_burned', 4, ['fire', 'recoil', 'counterplay'], {
      recoilSec: SPORE_CARPET_FIRE_RECOIL_SEC,
      puffDelay: monster.ai.sporePuffCd,
    });
  }
  return true;
}

function updateSporeCarpetLurkingFurniture(
  world: World,
  entities: Entity[],
  e: Entity,
  dt: number,
  time: number,
  msgs: Msg[],
  playerId: number,
  state?: GameState,
): boolean {
  if (e.monsterKind !== MonsterKind.SPORE_CARPET || !hasAIFlag(e, 'lurkingFurniture')) return false;
  const ai = e.ai!;
  const awake = e.monsterStage === 1;
  ai.sporePuffCd = Math.max(0, (ai.sporePuffCd ?? (awake ? 1.0 : SPORE_CARPET_PUFF_COOLDOWN_SEC)) - dt);

  const damaged = (e.hp ?? 0) < (e.maxHp ?? MONSTERS[MonsterKind.SPORE_CARPET].hp);
  let target = findCombatTarget(
    world,
    entities,
    e,
    dt,
    awake ? SPORE_CARPET_DETECT_SQ : SPORE_CARPET_WAKE_RADIUS_SQ,
    awake ? 0.7 : 0.35,
    canBeMonsterTarget,
  );
  const containerTarget = sporeCarpetContainerWakeTarget(state, world, e, dt, time);
  if (containerTarget) target = containerTarget;

  if (!awake) {
    if (damaged) wakeSporeCarpet(state, world, e, target ?? _entityById.get(playerId), time, msgs, 'damage');
    else if (containerTarget) wakeSporeCarpet(state, world, e, containerTarget, time, msgs, 'container');
    else if (target) wakeSporeCarpet(state, world, e, target, time, msgs, 'near');
    else {
      ai.goal = AIGoal.IDLE;
      ai.combatTargetId = undefined;
      ai.path.length = 0;
      e.spriteScale = 0.72 + Math.sin(time * 1.7 + e.id) * 0.025;
      return true;
    }
  }

  if ((ai.sporeRecoilTimer ?? 0) > 0) {
    ai.sporeRecoilTimer = Math.max(0, (ai.sporeRecoilTimer ?? 0) - dt);
    ai.sporePuffCd = Math.max(ai.sporePuffCd ?? 0, ai.sporeRecoilTimer + 0.8);
    e.spriteScale = 0.82;
    ai.goal = AIGoal.FLEE;
    return true;
  }

  if (!target || !target.alive) {
    target = findCombatTarget(world, entities, e, dt, SPORE_CARPET_DETECT_SQ, 0.9, canBeMonsterTarget);
  }
  if (!target) {
    ai.goal = AIGoal.WANDER;
    ai.combatTargetId = undefined;
    ai.timer -= dt;
    if (ai.path.length === 0 || ai.pi >= ai.path.length || ai.timer <= 0) {
      wanderNearby(world, e);
      ai.timer = 2.2 + ((e.id & 3) * 0.35);
    }
    e.spriteScale = 0.92;
    followMonsterPath(world, e, dt);
    return true;
  }

  ai.goal = AIGoal.HUNT;
  ai.combatTargetId = target.id;
  e.angle = Math.atan2(world.delta(e.y, target.y), world.delta(e.x, target.x));
  if (target.id === playerId && ai.lastSeenTargetId !== playerId) {
    ai.lastSeenTargetId = playerId;
    msgs.push(msg('Ковер плывет к выходу, как домашняя тряпка с чужим дыханием.', time, '#bf8'));
  }

  const d2 = world.dist2(e.x, e.y, target.x, target.y);
  if (d2 <= SPORE_CARPET_PUFF_RADIUS_SQ && ai.sporePuffCd <= 0) {
    applySporeCarpetPuff(world, e, time, msgs, playerId, state);
    ai.sporePuffCd = SPORE_CARPET_PUFF_COOLDOWN_SEC + ((e.id & 3) * 0.35);
    e.attackCd = ai.sporePuffCd;
    return true;
  }

  ai.timer -= dt;
  if (ai.path.length === 0 || ai.pi >= ai.path.length || ai.timer <= 0) {
    const chase = sporeCarpetDoorBlockCell(world, e, target);
    tryAssignPathToCell(world, e, chase.x, chase.y);
    ai.timer = 1.15 + ((e.id & 1) * 0.3);
  }
  e.spriteScale = 1.0 + Math.max(0, Math.sin(time * 3.1 + e.id)) * 0.05;
  followMonsterPath(world, e, dt, target);
  return true;
}

export function tryMonsterProjectileStagger(
  world: World,
  state: GameState,
  monster: Entity,
  projectile: Entity,
  playerId: number,
): boolean {
  if (monster.type !== EntityType.MONSTER || !monster.ai) return false;
  if (recoilSporeCarpetFromFire(world, state, monster, projectile, playerId)) return true;
  if (projectile.ownerId === playerId && interruptLozhnyyDukhFalsePhase(world, state, monster, _entityById.get(playerId), 'projectile')) return true;
  if (monster.monsterKind === MonsterKind.SOBRANNYY &&
      projectile.ownerId === playerId &&
      (projectile.sprite === Spr.PELLET || projectile.projType === ProjType.FLAME)) {
    const runtime = sobrannyyState(monster);
    runtime.hitCount = Math.max(0, runtime.hitCount - (projectile.projType === ProjType.FLAME ? 2 : 1));
    if (runtime.stacks > 0) runtime.stackUntil = Math.min(runtime.stackUntil, state.time + 6);
    wakeSobrannyy(world, monster, undefined, state.time, state.msgs, state, projectile.projType === ProjType.FLAME ? 'fire' : 'shotgun');
    monster.attackCd = Math.max(monster.attackCd ?? 0, projectile.projType === ProjType.FLAME ? 0.65 : 0.45);
    monster.spriteScale = Math.max(monster.spriteScale ?? 1, 1.03);
    state.msgs.push(msg(
      projectile.projType === ProjType.FLAME
        ? 'Огонь подсушил швы Собранного человека: рост выгорит быстрее.'
        : 'Дробь сбила мясной темп Собранного человека.',
      state.time,
      '#fc6',
    ));
    return true;
  }
  if (monster.monsterKind === MonsterKind.TRESKOTNIK &&
      projectile.ownerId !== monster.id &&
      (monster.hp ?? 1) > 0 &&
      (monster.ai.windupTimer ?? 0) > 0) {
    const target = monster.ai.combatTargetId !== undefined ? _entityById.get(monster.ai.combatTargetId) : undefined;
    interruptTreskotnikWindup(world, monster, target, state.time, state.msgs, 'hit', state);
    return true;
  }
  if (monster.monsterKind === MonsterKind.TUMANNIK &&
      projectile.ownerId === playerId &&
      projectile.projType === ProjType.FLAME) {
    const target = _entityById.get(playerId);
    collapseTumannikFogOffset(world, monster, target, state.time, state.msgs, 'fire', state);
    monster.spriteScale = Math.max(monster.spriteScale ?? 1, 1.04);
    return true;
  }
  const tuning = bladeEliteTuning(monster.monsterKind);
  if (!tuning) return false;
  if ((monster.hp ?? 1) <= 0) return false;
  if (projectile.ownerId !== playerId || projectile.sprite !== Spr.PELLET) return false;

  const ai = monster.ai;
  const wasWindup = (ai.windupTimer ?? 0) > 0;
  ai.staggerTimer = Math.max(ai.staggerTimer ?? 0, tuning.staggerSec);
  ai.windupTimer = undefined;
  ai.windupTargetId = undefined;
  monster.attackCd = Math.max(monster.attackCd ?? 0, 0.95);
  monster.spriteScale = 0.95;

  if (wasWindup) {
    const target = ai.combatTargetId !== undefined ? _entityById.get(ai.combatTargetId) : undefined;
    publishBladeEliteEvent(tuning, state, world, monster, target, 'monster_windup_interrupted', 4, ['windup', 'interrupted', 'shotgun'], {
      reason: 'shotgun_stagger',
    });
    state.msgs.push(msg(tuning.staggerMsg, state.time, '#4f4'));
  }
  return true;
}

function fireMonsterProjectile(
  world: World,
  entities: Entity[],
  e: Entity,
  target: Entity,
  def: MonsterDef,
  nextId: { v: number },
  damageMult = 1,
): void {
  const baseDmg = def.dmg ?? 10;
  const level = e.rpg?.level ?? 1;
  const strMult = e.rpg ? strMeleeDmgMult(e.rpg) : 1;
  const dmg = Math.round(scaleMonsterDmg(baseDmg, level) * strMult * monsterDmgMult(world, e, target) * (e.monsterDmgMult ?? 1) * damageMult);
  const dx = world.delta(e.x, target.x);
  const dy = world.delta(e.y, target.y);
  const ang = Math.atan2(dy, dx);
  const spd = def.projSpeed ?? 8;
  const cos = Math.cos(ang);
  const sin = Math.sin(ang);
  const sprite = def.projSprite || Spr.EYE_BOLT;
  entities.push({
    id: nextId.v++,
    type: EntityType.PROJECTILE,
    x: world.wrap(e.x + cos * 0.85),
    y: world.wrap(e.y + sin * 0.85),
    angle: ang,
    pitch: 0,
    alive: true,
    speed: 0,
    sprite,
    vx: cos * spd,
    vy: sin * spd,
    projDmg: dmg,
    projLife: def.projType === ProjType.WEB ? 1.45 : 3.0,
    ownerId: e.id,
    spriteScale: monsterProjectileScale(e.monsterKind, sprite),
    spriteZ: 0.5,
    projType: def.projType,
    projGore: def.projType === ProjType.WEB || sprite === Spr.PARAGRAPH_BOLT ? 1 : 2,
  });
  playSoundAt(monsterProjectileSound(e.monsterKind, sprite), e.x, e.y);
  e.attackCd = def.attackRate ?? 2;
}

function monsterProjectileScale(kind: MonsterKind | undefined, sprite: number): number {
  if (sprite === Spr.WEB_BOLT || kind === MonsterKind.PAUPSINA) return 0.42;
  if (sprite === Spr.WET_LINE_BOLT) return 0.5;
  if (sprite === Spr.PARAGRAPH_BOLT) return 0.34;
  if (sprite === Spr.HOSTILE_FLAME_BOLT) return 0.52;
  if (sprite === Spr.HOSTILE_PLASMA_BOLT) return 0.34;
  if (kind === MonsterKind.IDOL) return 0.4;
  return 0.3;
}

function monsterProjectileSound(kind: MonsterKind | undefined, sprite: number): () => void {
  if (sprite === Spr.WEB_BOLT || kind === MonsterKind.PAUPSINA) return playGrowl;
  if (sprite === Spr.WET_LINE_BOLT) return playHostileEnergyShot;
  if (kind === MonsterKind.EYE || kind === MonsterKind.CHERNOSLIZ || sprite === Spr.EYE_BOLT) return playHostileEyeShot;
  if (kind === MonsterKind.PARAGRAPH || sprite === Spr.PARAGRAPH_BOLT) return playHostileParagraphShot;
  if (sprite === Spr.HOSTILE_FLAME_BOLT) return playHostileFlame;
  if (sprite === Spr.HOSTILE_PLASMA_BOLT) return playHostileEnergyShot;
  if (sprite === Spr.HOSTILE_PSI_BOLT) return playHostilePsiCast;
  return playGrowl;
}

function rangedMonsterWindupSec(kind: MonsterKind | undefined): number {
  const boss = kind === undefined ? undefined : MONSTERS[kind]?.boss;
  if (boss) return boss.windupSec;
  switch (kind) {
    case MonsterKind.PAUPSINA: return PAUPSINA_WEB_WINDUP_SEC;
    case MonsterKind.EYE: return EYE_WINDUP_SEC;
    case MonsterKind.CHERNOSLIZ: return CHERNOSLIZ_WINDUP_SEC;
    case MonsterKind.PARAGRAPH: return PARAGRAPH_WINDUP_SEC;
    case MonsterKind.IDOL: return IDOL_WINDUP_SEC;
    case MonsterKind.KANTSELYARSKIY_IDOL: return KANTSELYARSKIY_IDOL_WINDUP_SEC;
    case MonsterKind.ROBOT: return ROBOT_WINDUP_SEC;
    case MonsterKind.MANCOBUS:
    case MonsterKind.HERALD:
    case MonsterKind.CREATOR:
      return HEAVY_RANGED_WINDUP_SEC;
    default: return GENERIC_RANGED_WINDUP_SEC;
  }
}

function rangedMonsterMinRange(kind: MonsterKind | undefined): number {
  const boss = kind === undefined ? undefined : MONSTERS[kind]?.boss;
  if (boss) return boss.minRange;
  if (kind === MonsterKind.PAUPSINA) return PAUPSINA_WEB_MIN_RANGE;
  if (kind === MonsterKind.CHERNOSLIZ) return 0.75;
  if (kind === MonsterKind.IDOL) return 1.25;
  if (kind === MonsterKind.KANTSELYARSKIY_IDOL) return KANTSELYARSKIY_IDOL_MIN_RANGE;
  return EYE_MIN_RANGE;
}

function rangedMonsterShotRange(kind: MonsterKind | undefined): number {
  const boss = kind === undefined ? undefined : MONSTERS[kind]?.boss;
  if (boss) return boss.range;
  return kind === MonsterKind.PAUPSINA ? PAUPSINA_WEB_SHOT_RANGE : RANGED_SHOT_RANGE;
}

function tryPaupsinaRangeStep(world: World, e: Entity, target: Entity, bestDist: number, dt: number): boolean {
  if (e.monsterKind !== MonsterKind.PAUPSINA || bestDist > PAUPSINA_WEB_STRAFE_RANGE) return false;
  const dx = world.delta(target.x, e.x);
  const dy = world.delta(target.y, e.y);
  const len = Math.max(0.001, Math.sqrt(dx * dx + dy * dy));
  const awayX = dx / len;
  const awayY = dy / len;
  const side = e.id % 2 === 0 ? 1 : -1;
  const stepAway = bestDist < PAUPSINA_WEB_MIN_RANGE ? 4.2 : 1.2;
  const stepSide = bestDist < PAUPSINA_WEB_MIN_RANGE ? 1.2 : 3.5;
  const tx = Math.floor(world.wrap(e.x + awayX * stepAway - awayY * side * stepSide));
  const ty = Math.floor(world.wrap(e.y + awayY * stepAway + awayX * side * stepSide));
  if (world.solid(tx, ty)) return false;
  const ai = e.ai!;
  ai.timer -= dt;
  if (ai.path.length === 0 || ai.timer <= 0 || ai.tx !== tx || ai.ty !== ty) {
    tryAssignPathToCell(world, e, tx, ty);
    ai.timer = 0.75;
  }
  if (ai.path.length === 0) return false;
  followMonsterPath(world, e, dt);
  e.spriteScale = 0.96;
  return true;
}

function rangedMonsterColor(kind: MonsterKind | undefined): string {
  switch (kind) {
    case MonsterKind.PAUPSINA: return '#ddd';
    case MonsterKind.EYE: return '#cf6';
    case MonsterKind.CHERNOSLIZ: return '#7f9';
    case MonsterKind.PARAGRAPH: return '#f6c';
    case MonsterKind.IDOL: return '#c8f';
    case MonsterKind.KANTSELYARSKIY_IDOL: return '#fd6';
    case MonsterKind.ROBOT: return '#6cf';
    case MonsterKind.MANCOBUS: return '#fa4';
    case MonsterKind.HERALD: return '#c8f';
    case MonsterKind.CREATOR: return '#9f8';
    default: return '#fc6';
  }
}

function rangedMonsterTag(kind: MonsterKind | undefined): string {
  return kind === undefined ? 'ranged' : MonsterKind[kind].toLowerCase();
}

function rangedMonsterTags(kind: MonsterKind | undefined, ...tags: string[]): string[] {
  const base = rangedMonsterTag(kind);
  if (kind !== undefined && MONSTERS[kind]?.boss) return [base, 'boss_line_controller', ...tags];
  return kind === MonsterKind.KANTSELYARSKIY_IDOL ? [base, 'office_field', ...tags] : [base, ...tags];
}

function rangedMonsterWindupMessage(kind: MonsterKind | undefined, name: string): string {
  const boss = kind === undefined ? undefined : MONSTERS[kind]?.boss;
  if (boss) return boss.windupLine;
  switch (kind) {
    case MonsterKind.PAUPSINA: return 'Паупсина присела на передние лапы: сейчас плюнет сетью. Шкаф, дверь или ближний напор срывают плевок.';
    case MonsterKind.EYE: return 'Глаз разогревает зелёную линию огня. Угол, дверь или шкаф сорвут выстрел.';
    case MonsterKind.CHERNOSLIZ: return 'Чернослиз раскрывает зеленую щель в воде. Угол, сухая кромка или свет срывают первый залп.';
    case MonsterKind.PARAGRAPH: return 'Параграф дописывает прямую строку. Ломайте видимость или врывайтесь после залпа.';
    case MonsterKind.IDOL: return 'Идол собирает ПСИ-луч. Стена, дверь или упорный заход гасят источник.';
    case MonsterKind.KANTSELYARSKIY_IDOL: return 'Бумаги вокруг Канцелярского Идола выстроились в линию. Шкаф, стена или рывок в упор сорвут выстрел.';
    case MonsterKind.ROBOT: return 'Робот раскручивает плазму. Сойдите с линии и бейте после вспышки.';
    default: return `${name} целится по прямой. Укрытие или угол ломают линию огня.`;
  }
}

function rangedMonsterSightMessage(kind: MonsterKind | undefined, name: string): string {
  const boss = kind === undefined ? undefined : MONSTERS[kind]?.boss;
  if (boss) return boss.warningLine;
  switch (kind) {
    case MonsterKind.PAUPSINA: return 'Паупсина держит липкую прямую. Сеть не убивает, но ловит ноги на несколько секунд.';
    case MonsterKind.EYE: return 'Глаз держит прямую линию. Зеленый разогрев читается до выстрела.';
    case MonsterKind.CHERNOSLIZ: return 'В черной воде рябь пошла против течения: чернослиз держит грязную линию.';
    case MonsterKind.PARAGRAPH: return 'Параграф заметил вас: его пункт летит только по видимой прямой.';
    case MonsterKind.IDOL: return 'Идол не двигается: режьте угол и входите в упор между ПСИ-залпами.';
    case MonsterKind.KANTSELYARSKIY_IDOL: return 'Канцелярский Идол держит офисную линию: шкафы гасят поле, бумаги в кармане усиливают залп.';
    case MonsterKind.ROBOT: return 'Робот взял линию плазмы. После залпа у него есть пауза.';
    default: return `${name} держит линию огня. Выстрел будет с разогревом.`;
  }
}

function rangedMonsterInterruptedMessage(kind: MonsterKind | undefined, reason: string): string {
  const boss = kind === undefined ? undefined : MONSTERS[kind]?.boss;
  if (boss) return boss.interruptLine;
  if (reason === 'range') return 'Дистанция сломала выстрел: источник потерял линию.';
  switch (kind) {
    case MonsterKind.PAUPSINA: return 'Плевок Паупсины сорвался о бетон или мебель. Давите дистанцию, пока она переставляет лапы.';
    case MonsterKind.EYE: return 'Выстрел Глаза сорвался о стену или укрытие. Держите угол до вспышки.';
    case MonsterKind.CHERNOSLIZ: return 'Рябь чернослиза погасла за углом или сухой кромкой. Сейчас можно сближаться.';
    case MonsterKind.PARAGRAPH: return 'Пункт Параграфа уперся в укрытие. Сейчас можно сближаться.';
    case MonsterKind.IDOL: return 'ПСИ-луч Идола погас за геометрией. Источник открыт для захода.';
    case MonsterKind.KANTSELYARSKIY_IDOL: return 'Офисное поле Идола уперлось в шкаф или стену. После срыва есть окно.';
    case MonsterKind.ROBOT: return 'Плазменная линия Робота сорвалась. Пауза короткая, сближайтесь.';
    default: return 'Линия огня сорвана укрытием или углом.';
  }
}

function rangedMonsterCounterplay(kind: MonsterKind | undefined, fallback: string): string {
  return kind === undefined ? fallback : MONSTERS[kind]?.boss?.counterplay ?? fallback;
}

function updateRangedBossPhaseCue(
  world: World,
  e: Entity,
  target: Entity,
  def: MonsterDef,
  time: number,
  msgs: Msg[],
  playerId: number,
  state?: GameState,
): void {
  const boss = def.boss;
  if (!boss || boss.phases.length === 0 || !e.ai) return;
  const maxHp = Math.max(1, e.maxHp ?? def.hp);
  const hpPct = Math.max(0, Math.min(1, (e.hp ?? maxHp) / maxHp));
  const nextIndex = (e.ai.bossPhaseIndex ?? -1) + 1;
  const phase = boss.phases[nextIndex];
  if (!phase || hpPct > phase.hpPct) return;

  e.ai.bossPhaseIndex = nextIndex;
  if (target.id === playerId) msgs.push(msg(phase.line, time, rangedMonsterColor(e.monsterKind)));
  publishMonsterReadabilityEvent(state, world, e, target, 'monster_sighted', target.id === playerId ? 4 : 3, rangedMonsterTags(e.monsterKind, 'boss_phase', phase.tag), {
    phaseIndex: nextIndex,
    phaseTag: phase.tag,
    hpPct: Math.round(hpPct * 100) / 100,
    thresholdHpPct: phase.hpPct,
    counterplay: boss.counterplay,
  });
}

export interface TrubnyyWetLineShot {
  stepX: number;
  stepY: number;
  cells: number;
  waterCells: number;
  wetScore: number;
}

function isDrainLineCell(world: World, x: number, y: number): boolean {
  return drainLineCell(world, x, y);
}

export interface VodyanoyWaterPressureLine {
  cells: number;
  waterCells: number;
  distance: number;
}

function isVodyanoyWetLineCell(world: World, x: number, y: number): boolean {
  return wetTerrainCell(world, x, y);
}

export function getVodyanoyWaterPressureLine(world: World, e: Entity, target: Entity): VodyanoyWaterPressureLine | undefined {
  return getBoundedWetConnection(world, e, target, VODYANOY_WET_LINE_MAX_CELLS, VODYANOY_WET_LINE_MAX_DIST);
}

function stampVodyanoyWetLineCue(world: World, e: Entity, target: Entity, time: number, pressure: number): void {
  const dx = world.delta(e.x, target.x);
  const dy = world.delta(e.y, target.y);
  const dist = Math.max(0.1, Math.sqrt(dx * dx + dy * dy));
  const steps = Math.min(7, Math.max(2, Math.floor(dist)));
  for (let i = 1; i <= steps; i++) {
    const t = i / (steps + 1);
    const x = world.wrap(Math.floor(e.x + dx * t));
    const y = world.wrap(Math.floor(e.y + dy * t));
    if (!isVodyanoyWetLineCell(world, x, y)) continue;
    const intensity = Math.min(210, 95 + Math.floor(pressure * 18));
    stampMark(world, x, y, 0.5, 0.5, 0.18 + t * 0.12, MarkType.PSI, 170_000 + e.id * 43 + i * 19 + Math.floor(time * 3), 62, 128, 138, intensity);
  }
}

function vodyanoyChaseCell(world: World, e: Entity, target: Entity): { x: number; y: number } {
  const tx = Math.floor(target.x);
  const ty = Math.floor(target.y);
  if (isVodyanoyWetLineCell(world, tx, ty)) return { x: tx, y: ty };

  let bestX = tx;
  let bestY = ty;
  let best = Infinity;
  for (let r = 1; r <= 5; r++) {
    for (let dy = -r; dy <= r; dy++) {
      for (let dx = -r; dx <= r; dx++) {
        if (Math.abs(dx) !== r && Math.abs(dy) !== r) continue;
        const x = world.wrap(tx + dx);
        const y = world.wrap(ty + dy);
        if (!isVodyanoyWetLineCell(world, x, y) || world.solid(x, y)) continue;
        const score = world.dist2(e.x, e.y, x + 0.5, y + 0.5) + world.dist2(target.x, target.y, x + 0.5, y + 0.5) * 2;
        if (score >= best) continue;
        best = score;
        bestX = x;
        bestY = y;
      }
    }
    if (best < Infinity) break;
  }
  return { x: bestX, y: bestY };
}

export function updateVodyanoyWaterPressureLine(
  world: World,
  e: Entity,
  target: Entity,
  dt: number,
  time: number,
  msgs: Msg[],
  playerId: number,
  state?: GameState,
): boolean {
  if (e.monsterKind !== MonsterKind.VODYANOY_KOSHMAR) return false;
  const ai = e.ai!;
  if (ai.waterLineTargetId !== undefined && ai.waterLineTargetId !== target.id) {
    ai.waterLineConnected = false;
    ai.waterLineBreakTimer = 0;
    ai.waterLinePulseCd = 0;
  }
  ai.waterLineTargetId = target.id;
  ai.waterLineScanCd = Math.max(0, (ai.waterLineScanCd ?? 0) - dt);
  ai.waterLinePulseCd = Math.max(0, (ai.waterLinePulseCd ?? 0) - dt);
  ai.waterLineCueCd = Math.max(0, (ai.waterLineCueCd ?? 0) - dt);

  let line: VodyanoyWaterPressureLine | undefined;
  if (ai.waterLineScanCd <= 0) {
    ai.waterLineScanCd = VODYANOY_WET_LINE_SCAN_SEC;
    line = getVodyanoyWaterPressureLine(world, e, target);
    if (line) {
      ai.waterLineConnected = true;
      ai.waterLineBreakTimer = VODYANOY_WET_LINE_DRY_BREAK_SEC;
      if (target.id === playerId && ai.lastSeenTargetId !== playerId) {
        ai.lastSeenTargetId = playerId;
        msgs.push(msg('Водяной кошмар держит мокрую линию. Рябь идет к вам, давление растет.', time, '#7dd'));
        publishMonsterReadabilityEvent(state, world, e, target, 'monster_sighted', 4, ['vodyanoy_koshmar', 'water_pressure', 'wet_line', 'warning'], {
          cells: line.cells,
          waterCells: line.waterCells,
          maxCells: VODYANOY_WET_LINE_MAX_CELLS,
          counterplay: 'step_to_dry_concrete_or_burst_during_interruption',
        });
      }
    } else {
      ai.waterLineConnected = false;
    }
  }

  if (!line && ai.waterLineConnected !== true) {
    const hadPressure = (ai.waterPressure ?? 0) > 0.35;
    ai.waterLineBreakTimer = Math.max(0, (ai.waterLineBreakTimer ?? 0) - dt);
    ai.waterPressure = Math.max(0, (ai.waterPressure ?? 0) - dt * (ai.waterLineBreakTimer > 0 ? 0.7 : 1.85));
    e.spriteScale = ai.waterPressure > 0.2 ? 0.96 + ai.waterPressure * 0.025 : undefined;
    if (hadPressure && ai.waterPressure <= 0.35 && target.id === playerId) {
      ai.lastSeenTargetId = undefined;
      msgs.push(msg('Сухой бетон сбил мокрую ПСИ-линию. Короткое окно для рывка или отхода.', time, '#9cf'));
      publishMonsterReadabilityEvent(state, world, e, target, 'monster_windup_interrupted', 3, ['vodyanoy_koshmar', 'water_pressure', 'dry_break'], {
        reason: 'dry_concrete',
        counterplay: 'burst_or_leave_wet_path',
      });
    }
    return false;
  }

  ai.waterPressure = Math.min(VODYANOY_WET_LINE_PRESSURE_MAX, (ai.waterPressure ?? 0) + dt * 1.15);
  e.spriteScale = 1.02 + ai.waterPressure * 0.035;

  if (ai.waterLineCueCd <= 0) {
    ai.waterLineCueCd = 0.7;
    stampVodyanoyWetLineCue(world, e, target, time, ai.waterPressure);
  }

  if (ai.waterLinePulseCd <= 0 && target.hp !== undefined) {
    ai.waterLinePulseCd = VODYANOY_WET_LINE_PULSE_SEC;
    const dmg = Math.max(1, Math.round(1 + ai.waterPressure * 0.62));
    { const _dmg = calculateDamage(dmg, DamageType.KINETIC, target); target.hp -= _dmg; applyHitStaggerAndKnockback(target, e.x, e.y, _dmg); }
    notifyActorDamaged(world, target, e, dmg, 'monster_special', time, state);
    if (target.rpg) target.rpg.psi = Math.max(0, target.rpg.psi - Math.max(1, Math.round(2 + ai.waterPressure)));
    if (target.hp <= 0) {
      target.alive = false;
      spawnDeathPool(world, target.x, target.y, target.type === EntityType.MONSTER);
      msgs.push(msg(`${entityDisplayName(e)} задавил ${entityDisplayName(target)} мокрой ПСИ-линией`, time, '#7dd'));
    } else if (target.id === playerId) {
      recordPlayerDamage(state, e, dmg, `${entityDisplayName(e)} давит по мокрой линии: -${dmg}`);
      if (ai.waterPressure > 3.2) msgs.push(msg('Давление в воде набирает силу. Сходите на сухой бетон сейчас.', time, '#7dd'));
    }
  }

  return false;
}

export function getTrubnyyWetLineShot(world: World, e: Entity, target: Entity): TrubnyyWetLineShot | undefined {
  const dx = world.delta(e.x, target.x);
  const dy = world.delta(e.y, target.y);
  const dist = Math.sqrt(dx * dx + dy * dy);
  if (dist <= TRUBNYY_WET_LINE_MIN_RANGE || dist > TRUBNYY_WET_LINE_MAX_CELLS) return undefined;

  const adx = Math.abs(dx);
  const ady = Math.abs(dy);
  let stepX = 0;
  let stepY = 0;
  let cells = 0;
  if (adx >= ady) {
    if (ady > TRUBNYY_WET_LINE_ALIGN_EPS) return undefined;
    stepX = dx >= 0 ? 1 : -1;
    cells = Math.round(adx);
  } else {
    if (adx > TRUBNYY_WET_LINE_ALIGN_EPS) return undefined;
    stepY = dy >= 0 ? 1 : -1;
    cells = Math.round(ady);
  }
  if (cells <= 0 || cells > TRUBNYY_WET_LINE_MAX_CELLS) return undefined;

  const ox = Math.floor(e.x);
  const oy = Math.floor(e.y);
  let waterCells = 0;
  let wetScore = 0;
  for (let i = 1; i <= cells; i++) {
    const x = world.wrap(ox + stepX * i);
    const y = world.wrap(oy + stepY * i);
    const ci = world.idx(x, y);
    if (world.solid(x, y) || isLineOfFireCover(world.features[ci] as Feature)) return undefined;
    if (world.cells[ci] === Cell.WATER) {
      waterCells++;
      wetScore += 2;
    } else if (isDrainLineCell(world, x, y)) {
      wetScore++;
    }
  }

  const required = Math.max(4, Math.ceil(cells * 0.45));
  if (waterCells <= 0 || wetScore < required) return undefined;
  return { stepX, stepY, cells, waterCells, wetScore };
}

export function updateTrubnyyWetLineShot(
  world: World,
  entities: Entity[],
  e: Entity,
  target: Entity,
  def: MonsterDef,
  dt: number,
  time: number,
  msgs: Msg[],
  playerId: number,
  nextId: { v: number },
  state?: GameState,
): boolean {
  if (e.monsterKind !== MonsterKind.TRUBNYY_AVTOMAT) return false;
  const ai = e.ai!;

  if ((ai.windupTimer ?? 0) > 0) {
    ai.windupTimer = Math.max(0, (ai.windupTimer ?? 0) - dt);
    const line = ai.windupTargetId === target.id && target.alive
      ? getTrubnyyWetLineShot(world, e, target)
      : undefined;
    if (!line) {
      ai.windupTimer = undefined;
      ai.windupTargetId = undefined;
      e.spriteScale = undefined;
      e.attackCd = Math.max(e.attackCd ?? 0, RANGED_LOS_BREAK_COOLDOWN);
      if (target.id === playerId) {
        msgs.push(msg('Трубный Автомат потерял мокрую прямую. Фланг или сухая клетка сорвали заряд.', time, '#9cf'));
        publishMonsterReadabilityEvent(state, world, e, target, 'monster_windup_interrupted', 3, ['trubnyy_avtomat', 'wet_line', 'interrupted'], {
          reason: 'left_wet_line',
          counterplay: 'step_off_wet_line_before_charge',
        });
      }
      return true;
    }

    const dx = world.delta(e.x, target.x);
    const dy = world.delta(e.y, target.y);
    e.angle = Math.atan2(dy, dx);
    e.spriteScale = 1.08 + Math.max(0, ai.windupTimer / TRUBNYY_WET_LINE_WINDUP_SEC) * 0.16;
    if (ai.windupTimer <= 0) {
      fireMonsterProjectile(world, entities, e, target, def, nextId, 1.08);
      e.attackCd = TRUBNYY_WET_LINE_RECOVERY_SEC;
      ai.windupTimer = undefined;
      ai.windupTargetId = undefined;
      e.spriteScale = 0.9;
      if (target.id === playerId) {
        msgs.push(msg('Трубный Автомат прожег мокрую линию и ушел в остывание. Сейчас окно для упора или фланга.', time, '#6cf'));
      }
    }
    return true;
  }

  if ((e.attackCd ?? 0) > 0) {
    e.attackCd = Math.max(0, (e.attackCd ?? 0) - dt);
    e.spriteScale = 0.93;
    return true;
  }
  e.spriteScale = undefined;

  const line = getTrubnyyWetLineShot(world, e, target);
  if (!line) return false;

  if (target.id === playerId && ai.lastSeenTargetId !== playerId) {
    ai.lastSeenTargetId = playerId;
    msgs.push(msg('Трубный Автомат нашел мокрую прямую. Синяя зарядка читается до выстрела.', time, '#6cf'));
    publishMonsterReadabilityEvent(state, world, e, target, 'monster_sighted', 4, ['trubnyy_avtomat', 'ranged', 'wet_line', 'warning'], {
      wetCells: line.waterCells,
      wetScore: line.wetScore,
      maxCells: TRUBNYY_WET_LINE_MAX_CELLS,
      recoverySec: TRUBNYY_WET_LINE_RECOVERY_SEC,
      counterplay: 'step_off_wet_line_or_attack_recovery',
    });
  }

  ai.windupTimer = TRUBNYY_WET_LINE_WINDUP_SEC;
  ai.windupTargetId = target.id;
  e.spriteScale = 1.18;
  if (target.id === playerId) {
    msgs.push(msg('Синие кольца Трубного Автомата ярчают по воде. Сойдите с линии до вспышки.', time, '#6cf'));
    playSoundAt(playGrowl, e.x, e.y);
  }
  return true;
}

function lampoglazTargetLight(world: World, target: Entity): number {
  const light = entityLight(world, target);
  return nearFeature(world, target, Feature.LAMP, 1) ? Math.max(light, LAMPOGLAZ_HARD_LOCK) : light;
}

function lampoglazWindupSec(light: number): number {
  return light >= LAMPOGLAZ_HARD_LOCK ? LAMPOGLAZ_HARD_WINDUP_SEC : LAMPOGLAZ_WINDUP_SEC;
}

function lampoglazDamageMult(light: number): number {
  return light >= LAMPOGLAZ_HARD_LOCK ? LAMPOGLAZ_HARD_LOCK_DMG_MULT : LAMPOGLAZ_LOCK_DMG_MULT;
}

function updateLampoglazLightLock(
  world: World,
  entities: Entity[],
  e: Entity,
  target: Entity,
  def: MonsterDef,
  bestDist: number,
  dt: number,
  time: number,
  msgs: Msg[],
  playerId: number,
  nextId: { v: number },
  state?: GameState,
): boolean {
  const ai = e.ai!;
  const targetLight = lampoglazTargetLight(world, target);
  const hasLock = targetLight >= LAMPOGLAZ_LIGHT_LOCK;
  const hardLock = targetLight >= LAMPOGLAZ_HARD_LOCK;
  const line = lineThreatContext(world, e, target, LAMPOGLAZ_SHOT_RANGE, LAMPOGLAZ_MIN_RANGE);
  const lineClear = target.alive && line.los;
  const currentTarget = ai.windupTargetId === undefined || ai.windupTargetId === target.id;

  if ((ai.windupTimer ?? 0) > 0) {
    ai.windupTimer = Math.max(0, (ai.windupTimer ?? 0) - dt);
    if (!currentTarget || !lineClear || !hasLock) {
      ai.windupTimer = undefined;
      ai.windupTargetId = undefined;
      e.spriteScale = undefined;
      e.attackCd = Math.max(e.attackCd ?? 0, RANGED_LOS_BREAK_COOLDOWN);
      if (target.id === playerId) {
        const reason = !hasLock ? 'darkness' : !line.inRange ? 'range' : 'line_of_sight';
        msgs.push(msg(
          reason === 'darkness'
            ? 'Лампоглаз потерял световой захват. Темный угол держит паузу.'
            : 'Зеленый захват Лампоглаза сорвался о геометрию.',
          time,
          '#9cf',
        ));
        publishMonsterReadabilityEvent(state, world, e, target, 'monster_windup_interrupted', 3, ['lampoglaz', 'light_lock', 'interrupted'], {
          reason,
          targetLight,
          counterplay: 'darkness_or_line_break',
        });
      }
      return true;
    }

    const dx = world.delta(e.x, target.x);
    const dy = world.delta(e.y, target.y);
    e.angle = Math.atan2(dy, dx);
    e.spriteScale = hardLock ? 1.22 : 1.12;
    if (ai.windupTimer <= 0) {
      fireMonsterProjectile(world, entities, e, target, def, nextId, lampoglazDamageMult(targetLight));
      e.attackCd = (def.attackRate ?? 2) * (hardLock ? 0.72 : 1);
      ai.windupTimer = undefined;
      ai.windupTargetId = undefined;
      e.spriteScale = undefined;
    }
    return true;
  }

  e.attackCd = Math.max(0, (e.attackCd ?? 0) - dt);
  if (hasLock && lineClear) {
    if (target.id === playerId && ai.lastSeenTargetId !== playerId) {
      ai.lastSeenTargetId = playerId;
      msgs.push(msg('Лампоглаз держит световую линию. Желтый гул кончится зеленым выстрелом.', time, '#fd6'));
      publishMonsterReadabilityEvent(state, world, e, target, 'monster_sighted', 4, ['lampoglaz', 'ranged', 'light_lock', hardLock ? 'hard_lock' : 'lit_target'], {
        targetLight,
        windupSec: lampoglazWindupSec(targetLight),
        counterplay: 'leave_light_or_break_line',
      });
    }
    if (e.attackCd <= 0) {
      ai.windupTimer = lampoglazWindupSec(targetLight);
      ai.windupTargetId = target.id;
      e.spriteScale = hardLock ? 1.24 : 1.15;
      if (target.id === playerId) {
        msgs.push(msg(
          hardLock
            ? 'Лампы вокруг щелкнули резко: Лампоглаз взял точный захват. В темноту или за шкаф!'
            : 'Лампоглаз собирает зеленую точку по светлой полосе. Срывайте линию.',
          time,
          '#fd6',
        ));
        playSoundAt(playGrowl, e.x, e.y);
      }
    }
    return true;
  }

  e.spriteScale = hasLock ? 1.04 : undefined;
  if (def.speed > 0 && bestDist > 9) {
    ai.timer -= dt;
    if (ai.path.length === 0 || ai.timer <= 0) {
      tryAssignPathToCell(world, e, Math.floor(target.x), Math.floor(target.y));
      ai.timer = 2.3;
    }
    followMonsterPath(world, e, dt);
  }
  return true;
}

function updateReadableMonsterRanged(
  world: World,
  entities: Entity[],
  e: Entity,
  target: Entity,
  def: MonsterDef,
  bestDist: number,
  dt: number,
  time: number,
  msgs: Msg[],
  playerId: number,
  nextId: { v: number },
  state?: GameState,
): boolean {
  const ai = e.ai!;
  const shotRange = hasAIFlag(e, 'officeField') ? officeFieldShotRange(world, e, target) : rangedMonsterShotRange(e.monsterKind);
  const minRange = rangedMonsterMinRange(e.monsterKind);
  const windupSec = rangedMonsterWindupSec(e.monsterKind);
  const line = lineThreatContext(world, e, target, shotRange, minRange);
  const currentTarget = ai.windupTargetId === undefined || ai.windupTargetId === target.id;
  updateRangedBossPhaseCue(world, e, target, def, time, msgs, playerId, state);

  if ((ai.windupTimer ?? 0) > 0) {
    ai.windupTimer = Math.max(0, (ai.windupTimer ?? 0) - dt);
    const lineClear = currentTarget && target.alive && line.los;
    if (!lineClear) {
      ai.windupTimer = undefined;
      ai.windupTargetId = undefined;
      e.spriteScale = undefined;
      e.attackCd = Math.max(e.attackCd ?? 0, RANGED_LOS_BREAK_COOLDOWN);
      if (target.id === playerId) {
        const reason = !line.inRange ? 'range' : 'line_of_sight';
        msgs.push(msg(rangedMonsterInterruptedMessage(e.monsterKind, reason), time, '#9cf'));
        publishMonsterReadabilityEvent(state, world, e, target, 'monster_windup_interrupted', 3, rangedMonsterTags(e.monsterKind, 'windup', 'line_of_sight', 'interrupted'), {
          reason,
          counterplay: rangedMonsterCounterplay(e.monsterKind, 'break_line_before_bolt'),
          ...officeFieldEventData(world, e, target),
        });
      }
      return true;
    }

    const dx = world.delta(e.x, target.x);
    const dy = world.delta(e.y, target.y);
    e.angle = Math.atan2(dy, dx);
    e.spriteScale = 1.05 + Math.max(0, ai.windupTimer / windupSec) * 0.12;
    if (ai.windupTimer <= 0) {
      fireMonsterProjectile(world, entities, e, target, def, nextId);
      ai.windupTimer = undefined;
      ai.windupTargetId = undefined;
      e.spriteScale = undefined;
    }
    return true;
  }

  if (!line.inRange) {
    if (bestDist <= minRange && tryPaupsinaRangeStep(world, e, target, bestDist, dt)) return true;
    return false;
  }
  if (!line.los) return false;

  if (target.id === playerId && ai.lastSeenTargetId !== playerId) {
    ai.lastSeenTargetId = playerId;
    msgs.push(msg(rangedMonsterSightMessage(e.monsterKind, entityDisplayName(e)), time, rangedMonsterColor(e.monsterKind)));
    publishMonsterReadabilityEvent(state, world, e, target, 'monster_sighted', 4, rangedMonsterTags(e.monsterKind, 'ranged', 'line_of_sight', 'warning'), {
      windupSec,
      shotRange: Math.round(shotRange * 10) / 10,
      minRange: Math.round(minRange * 10) / 10,
      counterplay: rangedMonsterCounterplay(e.monsterKind, 'corner_or_door_breaks_line'),
      ...officeFieldEventData(world, e, target),
    });
  }

  e.attackCd = (e.attackCd ?? 0) - dt;
  if (e.attackCd <= 0) {
    ai.windupTimer = windupSec;
    ai.windupTargetId = target.id;
    e.spriteScale = 1.14;
    if (e.monsterKind === MonsterKind.CHERNOSLIZ) stampChernoSlizWake(world, e, time);
    if (target.id === playerId) {
      msgs.push(msg(rangedMonsterWindupMessage(e.monsterKind, entityDisplayName(e)), time, rangedMonsterColor(e.monsterKind)));
      playSoundAt(playGrowl, e.x, e.y);
    }
  } else if (tryPaupsinaRangeStep(world, e, target, bestDist, dt)) {
    return true;
  }
  return true;
}

interface SlepoglazAim {
  x: number;
  y: number;
  target?: Entity;
  source: 'sound' | 'sight';
}

function slepoglazAimAngle(world: World, e: Entity, tx: number, ty: number): number {
  const dx = world.delta(e.x, tx);
  const dy = world.delta(e.y, ty);
  if (dx * dx + dy * dy < 0.01) return e.angle;
  return Math.atan2(dy, dx);
}

function traceSlepoglazBeamLen(world: World, e: Entity, dirX: number, dirY: number): number {
  let len = SLEPOGLAZ_SHOT_RANGE;
  for (let d = 0.45; d <= SLEPOGLAZ_SHOT_RANGE; d += 0.25) {
    const x = world.wrap(Math.floor(e.x + dirX * d));
    const y = world.wrap(Math.floor(e.y + dirY * d));
    if (world.solid(x, y)) {
      len = Math.max(0.5, d - 0.25);
      break;
    }
  }
  return len;
}

function stampSlepoglazBeam(world: World, e: Entity, dirX: number, dirY: number, len: number): void {
  for (let d = 0.5; d < len; d += 0.55) {
    const sx = e.x + dirX * d;
    const sy = e.y + dirY * d;
    const x = world.wrap(Math.floor(sx));
    const y = world.wrap(Math.floor(sy));
    if (world.solid(x, y)) continue;
    const fx = ((sx % 1) + 1) % 1;
    const fy = ((sy % 1) + 1) % 1;
    stampMark(
      world, x, y, fx, fy,
      0.28, MarkType.PSI, e.id * 917 + Math.floor(d * 41),
      80, 205, 70, 170,
    );
  }
}

function fireSlepoglazBeam(
  world: World,
  entities: Entity[],
  e: Entity,
  def: MonsterDef,
  tx: number,
  ty: number,
  time: number,
  msgs: Msg[],
  playerId: number,
  nextId: { v: number },
  state?: GameState,
): void {
  const angle = slepoglazAimAngle(world, e, tx, ty);
  const dirX = Math.cos(angle);
  const dirY = Math.sin(angle);
  const len = traceSlepoglazBeamLen(world, e, dirX, dirY);
  const level = e.rpg?.level ?? 1;
  const strMult = e.rpg ? strMeleeDmgMult(e.rpg) : 1;
  const dmg = Math.round(scaleMonsterDmg(def.dmg, level) * strMult * (e.monsterDmgMult ?? 1));
  let hitCount = 0;
  let hitPlayer = false;

  e.angle = angle;
  stampSlepoglazBeam(world, e, dirX, dirY, len);
  getEntityIndex().queryRadiusCapped(e.x, e.y, len + SLEPOGLAZ_BEAM_WIDTH + 1, slepoglazBeamQuery, ENTITY_MASK_ACTOR, SLEPOGLAZ_BEAM_SCAN_CAP);
  for (const target of slepoglazBeamQuery) {
    if (!target.alive || target.id === e.id) continue;
    if (!isPlayerEntity(target) && target.type !== EntityType.NPC) continue;
    const dx = world.delta(e.x, target.x);
    const dy = world.delta(e.y, target.y);
    const along = dx * dirX + dy * dirY;
    if (along < 0.45 || along > len + 0.35) continue;
    const perp = Math.abs(dx * -dirY + dy * dirX);
    if (perp > SLEPOGLAZ_BEAM_WIDTH) continue;
    if (target.hp === undefined) continue;

    const debugImmortalPlayerHit = target.id === playerId && isDebugOnePunchManEnabled();
    if (debugImmortalPlayerHit) {
      keepDebugOnePunchManAlive(target);
    } else {
      { const _dmg = calculateDamage(dmg, DamageType.KINETIC, target); target.hp -= _dmg; applyHitStaggerAndKnockback(target, e.x, e.y, _dmg); }
      notifyActorDamaged(world, target, e, dmg, 'monster_special', time, state);
      if (target.id === playerId) {
        hitPlayer = true;
        recordPlayerDamage(state, e, dmg, `${entityDisplayName(e)} прожег старую позицию: -${dmg}`);
      }
      if (target.hp <= 0) {
        target.alive = false;
        target.hp = 0;
      }
      spawnBloodHit(world, target.x, target.y, angle, dmg, false);
      if (target.hp <= 0) {
        spawnDeathPool(world, target.x, target.y, false);
        if (target.type === EntityType.NPC) dropNpcInventory(target, entities, nextId);
        msgs.push(msg(`${entityDisplayName(e)} прожег ${entityDisplayName(target)}`, time, '#9f4'));
      }
    }
    hitCount++;
  }

  if (hitPlayer) {
    msgs.push(msg('Слепоглаз попал в старую шумную точку. Следующий луч пережидайте только шагом в сторону.', time, '#9f4'));
  } else if (hitCount === 0) {
    msgs.push(msg('Слепоглаз прожег пустое место и просел после луча. Сближайтесь сейчас.', time, '#9f4'));
  }
  playSoundAt(playHostileEyeShot, e.x, e.y);
}

function acquireSlepoglazAim(
  world: World,
  e: Entity,
  target: Entity | null,
  time: number,
  playerId: number,
  state?: GameState,
): SlepoglazAim | undefined {
  const player = _entityById.get(playerId);
  const noise = findNoiseForActor(world, state, e, time, {
    minSeverity: 2,
    scanInterval: 0.55,
    hearingMult: SLEPOGLAZ_NOISE_HEARING_MULT,
  });
  if (noise && world.dist2(e.x, e.y, noise.x, noise.y) <= SLEPOGLAZ_SHOT_RANGE * SLEPOGLAZ_SHOT_RANGE) {
    const d = Math.sqrt(world.dist2(e.x, e.y, noise.x, noise.y));
    if (d > SLEPOGLAZ_MIN_RANGE) {
      return {
        x: noise.x,
        y: noise.y,
        target: noise.actorId === playerId ? player : undefined,
        source: 'sound',
      };
    }
  }

  if (!target || !target.alive) return undefined;
  const line = lineThreatContext(world, e, target, SLEPOGLAZ_SHOT_RANGE, SLEPOGLAZ_MIN_RANGE);
  if (!line.los) return undefined;
  return { x: target.x, y: target.y, target, source: 'sight' };
}

function updateSlepoglazCloseDefense(
  world: World,
  entities: Entity[],
  e: Entity,
  target: Entity | null,
  dt: number,
  time: number,
  msgs: Msg[],
  playerId: number,
  nextId: { v: number },
  state?: GameState,
): boolean {
  if (!target || !target.alive || target.hp === undefined) return false;
  const meleeRange = monsterMeleeRange(world, e);
  if (world.dist2(e.x, e.y, target.x, target.y) > meleeRange * meleeRange) return false;

  e.attackCd = Math.max(0, (e.attackCd ?? 0) - dt);
  if (e.attackCd > 0) return true;

  const level = e.rpg?.level ?? 1;
  const strMult = e.rpg ? strMeleeDmgMult(e.rpg) : 1;
  const rawDmg = Math.round(scaleMonsterDmg(SLEPOGLAZ_MELEE_DMG, level) * strMult * (e.monsterDmgMult ?? 1));
  const dmg = zhelemishIncomingMeleeDamage(target, time, rawDmg);
  const debugImmortalPlayerHit = target.id === playerId && isDebugOnePunchManEnabled();
  if (debugImmortalPlayerHit) {
    keepDebugOnePunchManAlive(target);
  } else {
    { const _dmg = calculateDamage(dmg, DamageType.KINETIC, target); target.hp -= _dmg; applyHitStaggerAndKnockback(target, e.x, e.y, _dmg); }
    notifyActorDamaged(world, target, e, dmg, 'monster_special', time, state);
    if (target.id === playerId) recordPlayerDamage(state, e, dmg, `${entityDisplayName(e)} слепо дернул нервом: -${dmg}`);
    if (target.hp <= 0) {
      target.alive = false;
      target.hp = 0;
    }
    const hitAng = Math.atan2(target.y - e.y, target.x - e.x);
    spawnBloodHit(world, target.x, target.y, hitAng, dmg, target.type === EntityType.MONSTER);
    if (target.hp <= 0) {
      spawnDeathPool(world, target.x, target.y, target.type === EntityType.MONSTER);
      if (target.type === EntityType.NPC) dropNpcInventory(target, entities, nextId);
      msgs.push(msg(`${entityDisplayName(e)} добил ${entityDisplayName(target)} нервным ударом`, time, '#9f4'));
    }
  }
  playSoundAt(playGrowl, e.x, e.y);
  e.attackCd = SLEPOGLAZ_MELEE_RATE;
  return true;
}

function updateSlepoglaz(
  world: World,
  entities: Entity[],
  e: Entity,
  target: Entity | null,
  dt: number,
  time: number,
  msgs: Msg[],
  playerId: number,
  nextId: { v: number },
  state?: GameState,
): boolean {
  if (e.monsterKind !== MonsterKind.SLEPOGLAZ) return false;
  const ai = e.ai!;
  const def = MONSTERS[MonsterKind.SLEPOGLAZ];

  if ((ai.windupTimer ?? 0) > 0) {
    ai.windupTimer = Math.max(0, (ai.windupTimer ?? 0) - dt);
    e.angle = slepoglazAimAngle(world, e, ai.tx, ai.ty);
    e.spriteScale = 1.08 + Math.max(0, ai.windupTimer / SLEPOGLAZ_WINDUP_SEC) * 0.16;
    if (ai.windupTimer <= 0) {
      fireSlepoglazBeam(world, entities, e, def, ai.tx, ai.ty, time, msgs, playerId, nextId, state);
      ai.windupTimer = undefined;
      ai.windupTargetId = undefined;
      ai.staggerTimer = SLEPOGLAZ_RECOVERY_SEC;
      e.attackCd = def.attackRate;
      e.spriteScale = 0.9;
    }
    return true;
  }

  if ((ai.staggerTimer ?? 0) > 0) {
    ai.staggerTimer = Math.max(0, (ai.staggerTimer ?? 0) - dt);
    e.attackCd = Math.max(e.attackCd ?? 0, 0.25);
    e.spriteScale = 0.9;
    if (updateSlepoglazCloseDefense(world, entities, e, target, dt, time, msgs, playerId, nextId, state)) return true;
    return true;
  }

  e.spriteScale = undefined;
  e.attackCd = Math.max(0, (e.attackCd ?? 0) - dt);
  if (e.attackCd > 0) {
    if (updateSlepoglazCloseDefense(world, entities, e, target, dt, time, msgs, playerId, nextId, state)) return true;
    return true;
  }

  const aim = acquireSlepoglazAim(world, e, target, time, playerId, state);
  if (!aim) {
    if (updateSlepoglazCloseDefense(world, entities, e, target, dt, time, msgs, playerId, nextId, state)) return true;
    ai.goal = AIGoal.WANDER;
    ai.combatTargetId = undefined;
    ai.path = [];
    return true;
  }

  ai.tx = world.wrap(aim.x);
  ai.ty = world.wrap(aim.y);
  ai.windupTimer = SLEPOGLAZ_WINDUP_SEC;
  ai.windupTargetId = aim.target?.id;
  e.angle = slepoglazAimAngle(world, e, ai.tx, ai.ty);
  e.spriteScale = 1.22;
  if (aim.target?.id === playerId) {
    const sourceText = aim.source === 'sound' ? 'последний шум' : 'старую позицию';
    msgs.push(msg(`Слепоглаз зарядил зеленый луч в ${sourceText}. Шагните в сторону до вспышки.`, time, '#9f4'));
  }
  publishMonsterReadabilityEvent(state, world, e, aim.target, 'monster_sighted', 4, ['slepoglaz', 'last_sound', 'beam', 'warning'], {
    windupSec: SLEPOGLAZ_WINDUP_SEC,
    source: aim.source,
    counterplay: 'bait_sound_sidestepping_then_rush_after_beam',
  });
  playSoundAt(playGrowl, e.x, e.y);
  return true;
}

function updateShadowAmbushReadability(
  world: World,
  e: Entity,
  target: Entity,
  bestDist: number,
  dt: number,
  time: number,
  msgs: Msg[],
  playerId: number,
  state?: GameState,
): boolean {
  const ai = e.ai!;

  if (target.id === playerId &&
      ai.lastSeenTargetId !== playerId &&
      world.dist2(e.x, e.y, target.x, target.y) <= SHADOW_WARNING_RANGE_SQ &&
      shadowCanDarkAmbush(world, e, target)) {
    ai.lastSeenTargetId = playerId;
    msgs.push(msg('Теневик вышел из темного угла. Свет, шаг назад или широкий проход ломают рывок.', time, '#c8f'));
    publishMonsterReadabilityEvent(state, world, e, target, 'monster_sighted', 4, ['shadow', 'ambush', 'dark', 'warning'], {
      windupSec: SHADOW_WINDUP_SEC,
      counterplay: 'light_distance_or_open_space',
    });
  }

  if ((ai.windupTimer ?? 0) > 0) {
    ai.windupTimer = Math.max(0, (ai.windupTimer ?? 0) - dt);
    const interrupted = !target.alive ||
      bestDist > SHADOW_STRIKE_BREAK_RANGE ||
      ai.windupTargetId !== target.id ||
      shadowHasLightCounter(world, e, target);
    if (interrupted) {
      ai.windupTimer = undefined;
      ai.windupTargetId = undefined;
      e.attackCd = Math.max(e.attackCd ?? 0, SHADOW_CANCEL_COOLDOWN);
      if (target.id === playerId) {
        msgs.push(msg('Теневик потерял рывок в свете или на дистанции.', time, '#ccf'));
        publishMonsterReadabilityEvent(state, world, e, target, 'monster_windup_interrupted', 3, ['shadow', 'ambush', 'interrupted', 'light'], {
          reason: shadowHasLightCounter(world, e, target) ? 'light' : 'distance',
          counterplay: 'keep_light_or_distance',
        });
      }
      return true;
    }
    if (ai.windupTimer > 0) return true;

    ai.windupTimer = undefined;
    ai.windupTargetId = undefined;
    return false;
  }

  if (bestDist < 1.2 && (e.attackCd ?? 0) <= 0 && shadowCanDarkAmbush(world, e, target)) {
    ai.windupTimer = SHADOW_WINDUP_SEC;
    ai.windupTargetId = target.id;
    if (target.id === playerId) {
      msgs.push(msg('Теневик готовит рывок из тени. Отступите в свет или за дистанцию.', time, '#c8f'));
    }
    return true;
  }

  return false;
}

function pointLight(world: World, x: number, y: number): number {
  return world.light[world.idx(Math.floor(x), Math.floor(y))] ?? 0;
}

function fogAt(world: World, x: number, y: number): number {
  return world.fog[world.idx(Math.floor(x), Math.floor(y))] ?? 0;
}

function clearTumannikFogOffset(e: Entity): void {
  const ai = e.ai;
  if (!ai) return;
  ai.fogOffsetX = undefined;
  ai.fogOffsetY = undefined;
  ai.fogOffsetUntil = undefined;
  ai.fogOffsetNoiseId = undefined;
  if (e.monsterKind === MonsterKind.TUMANNIK) e.spriteScale = undefined;
}

function tumannikHasOffset(e: Entity, time: number): boolean {
  const ai = e.ai;
  if (!ai) return false;
  return (ai.fogOffsetUntil ?? -Infinity) > time &&
    (Math.abs(ai.fogOffsetX ?? 0) > 0.05 || Math.abs(ai.fogOffsetY ?? 0) > 0.05);
}

function tumannikLightCounter(world: World, e: Entity, target: Entity): boolean {
  const ai = e.ai!;
  const fx = e.x + (ai.fogOffsetX ?? 0);
  const fy = e.y + (ai.fogOffsetY ?? 0);
  return entityHasEquippedLight(target) ||
    entityLight(world, target) >= TUMANNIK_LIGHT_REVEAL ||
    entityLight(world, e) >= TUMANNIK_LIGHT_REVEAL ||
    pointLight(world, fx, fy) >= TUMANNIK_LIGHT_REVEAL;
}

function tumannikFogReady(world: World, e: Entity, target: Entity, time: number): boolean {
  const ai = e.ai!;
  if ((ai.fogOffsetCollapsedUntil ?? -Infinity) > time) return false;
  return fogAt(world, e.x, e.y) >= TUMANNIK_FOG_MIN &&
    fogAt(world, target.x, target.y) >= TUMANNIK_FOG_TARGET_MIN;
}

function collapseTumannikFogOffset(
  world: World,
  e: Entity,
  target: Entity | undefined,
  time: number,
  msgs: Msg[],
  reason: string,
  state?: GameState,
): void {
  const ai = e.ai;
  if (!ai) return;
  const hadOffset = tumannikHasOffset(e, time);
  clearTumannikFogOffset(e);
  ai.fogOffsetCollapsedUntil = time + TUMANNIK_COLLAPSE_SEC;
  e.attackCd = Math.max(e.attackCd ?? 0, 0.45);
  if (!hadOffset) return;
  if (isPlayerEntity(target) && hadOffset && reason !== 'strike') {
    msgs.push(msg(reason === 'fire'
      ? 'Огонь сложил ложный бок Туманника.'
      : reason === 'light'
        ? 'Свет вытащил настоящий сустав Туманника из тумана.'
        : 'Туманник потерял ложный силуэт вне плотного тумана.', time, '#9cf'));
  }
  if (reason !== 'strike') {
    publishMonsterReadabilityEvent(state, world, e, target, 'monster_windup_interrupted', 3, ['tumannik', 'fog_offset', 'collapsed', reason], {
      reason,
      counterplay: 'light_fire_or_leave_fog',
    });
  }
}

function tumannikOffsetCellOpen(world: World, x: number, y: number): boolean {
  return !world.solid(Math.floor(x), Math.floor(y));
}

function setTumannikOffsetVector(world: World, e: Entity, ux: number, uy: number, time: number, noiseId: number): void {
  const ai = e.ai!;
  for (let step = 0; step < 4; step++) {
    const mult = step === 0 ? 1 : step === 1 ? 0.72 : step === 2 ? -0.72 : 0.48;
    const ox = ux * TUMANNIK_OFFSET_DIST * mult;
    const oy = uy * TUMANNIK_OFFSET_DIST * mult;
    const fx = world.wrap(Math.floor(e.x + ox)) + 0.5;
    const fy = world.wrap(Math.floor(e.y + oy)) + 0.5;
    if (!tumannikOffsetCellOpen(world, fx, fy)) continue;
    ai.fogOffsetX = ox;
    ai.fogOffsetY = oy;
    ai.fogOffsetUntil = time + TUMANNIK_OFFSET_REFRESH_SEC;
    ai.fogOffsetNoiseId = noiseId;
    e.spriteScale = 0.92;
    return;
  }
  clearTumannikFogOffset(e);
}

function refreshTumannikFogOffset(
  world: World,
  e: Entity,
  target: Entity,
  time: number,
  state?: GameState,
): void {
  const ai = e.ai!;
  const noise = findNoiseForActor(world, state, e, time, { minSeverity: 1, scanInterval: 0.35, hearingMult: 1.55 });
  const useNoise = noise &&
    noise.actorId === target.id &&
    (noise.source === 'footstep' || noise.tags.includes('movement'));
  if (tumannikHasOffset(e, time) && (!useNoise || ai.fogOffsetNoiseId === noise.id)) return;

  let dx = useNoise ? world.delta(e.x, noise.x) : world.delta(e.x, target.x);
  let dy = useNoise ? world.delta(e.y, noise.y) : world.delta(e.y, target.y);
  if (!useNoise) {
    const sign = (e.id & 1) === 0 ? 1 : -1;
    const sx = -dy * 0.45 * sign;
    const sy = dx * 0.45 * sign;
    dx += sx;
    dy += sy;
  }
  const len = Math.max(0.001, Math.sqrt(dx * dx + dy * dy));
  setTumannikOffsetVector(world, e, dx / len, dy / len, time, useNoise ? noise.id : 0);
}

function stampTumannikFogCue(world: World, e: Entity, time: number): void {
  const ai = e.ai!;
  if (!tumannikHasOffset(e, time)) return;
  const rx = Math.floor(e.x);
  const ry = Math.floor(e.y);
  const fx = Math.floor(world.wrap(e.x + (ai.fogOffsetX ?? 0)));
  const fy = Math.floor(world.wrap(e.y + (ai.fogOffsetY ?? 0)));
  const seed = Math.imul(e.id, 72_019) ^ Math.floor(time * 7);
  stampMark(world, fx, fy, 0.5, 0.5, 0.34, MarkType.PSI, seed, 92, 118, 132, 76);
  stampMark(world, rx, ry, 0.5, 0.5, 0.16, MarkType.SPLAT, seed + 17, 42, 8, 12, 118);
}

function damageTumannikOffsetStrike(
  world: World,
  entities: Entity[],
  e: Entity,
  target: Entity,
  time: number,
  msgs: Msg[],
  playerId: number,
  nextId: { v: number },
  state?: GameState,
): void {
  const def = MONSTERS[MonsterKind.TUMANNIK];
  const ai = e.ai!;
  const ax = world.wrap(e.x + (ai.fogOffsetX ?? 0));
  const ay = world.wrap(e.y + (ai.fogOffsetY ?? 0));
  const level = e.rpg?.level ?? 1;
  const strMult = e.rpg ? strMeleeDmgMult(e.rpg) : 1;
  const rawDmg = Math.round(scaleMonsterDmg(def.dmg, level) * strMult * TUMANNIK_STRIKE_DMG_MULT * (e.monsterDmgMult ?? 1));
  const dmg = zhelemishIncomingMeleeDamage(target, time, rawDmg);
  if (target.hp === undefined) return;

  const debugImmortalPlayerHit = target.id === playerId && isDebugOnePunchManEnabled();
  if (debugImmortalPlayerHit) {
    keepDebugOnePunchManAlive(target);
  } else {
    { const _dmg = calculateDamage(dmg, DamageType.KINETIC, target); target.hp -= _dmg; applyHitStaggerAndKnockback(target, e.x, e.y, _dmg); }
    notifyActorDamaged(world, target, e, dmg, 'monster_special', time, state);
    if (target.id === playerId) recordPlayerDamage(state, e, dmg, `${entityDisplayName(e)} ударил сбоку из тумана: -${dmg}`);
    if (target.hp <= 0) { target.alive = false; target.hp = 0; }
    const hitAng = Math.atan2(world.delta(ay, target.y), world.delta(ax, target.x));
    spawnBloodHit(world, target.x, target.y, hitAng, dmg, target.type === EntityType.MONSTER);
    if (target.hp <= 0) {
      spawnDeathPool(world, target.x, target.y, target.type === EntityType.MONSTER);
      if (target.type === EntityType.NPC) dropNpcInventory(target, entities, nextId);
    }
  }

  const label = isPlayerEntity(target) ? 'тебя' : entityDisplayName(target);
  msgs.push(msg(`${entityDisplayName(e)} бьет ${label} не из центра силуэта: -${dmg}`, time, '#9cf'));
  if (state) {
    publishEvent(state, {
      type: 'monster_sighted',
      zoneId: zoneIdAt(world, e.x, e.y),
      roomId: world.roomAt(e.x, e.y)?.id,
      x: e.x,
      y: e.y,
      actorId: e.id,
      actorName: entityDisplayName(e),
      actorFaction: e.faction,
      targetId: target.id,
      targetName: entityDisplayName(target),
      targetFaction: target.faction,
      monsterKind: MonsterKind.TUMANNIK,
      severity: target.id === playerId ? 5 : 4,
      privacy: target.id === playerId ? 'local' : 'witnessed',
      tags: ['monster', 'tumannik', 'fog_offset', 'side_hit'],
      data: {
        rumorIds: [...TUMANNIK_RUMOR_IDS],
        attackX: ax,
        attackY: ay,
        damage: dmg,
        counterplay: 'aim_by_side_sound_or_collapse_with_light_fire_exit',
      },
    });
  }
  playSoundAt(playGrowl, ax, ay);
  collapseTumannikFogOffset(world, e, target, time, msgs, 'strike', state);
  e.attackCd = def.attackRate;
}

function updateTumannikFogOffset(
  world: World,
  entities: Entity[],
  e: Entity,
  target: Entity,
  dt: number,
  time: number,
  msgs: Msg[],
  playerId: number,
  nextId: { v: number },
  state?: GameState,
): boolean {
  if (e.monsterKind !== MonsterKind.TUMANNIK || !hasAIFlag(e, 'fogOffset')) return false;
  e.attackCd = Math.max(0, (e.attackCd ?? 0) - dt);

  if (tumannikLightCounter(world, e, target)) {
    collapseTumannikFogOffset(world, e, target, time, msgs, 'light', state);
    return false;
  }
  if (!tumannikFogReady(world, e, target, time)) {
    if ((e.ai!.fogOffsetCollapsedUntil ?? -Infinity) <= time) {
      collapseTumannikFogOffset(world, e, target, time, msgs, 'left_fog', state);
    } else {
      clearTumannikFogOffset(e);
    }
    return false;
  }

  refreshTumannikFogOffset(world, e, target, time, state);
  if (!tumannikHasOffset(e, time)) return false;

  const ai = e.ai!;
  if (target.id === playerId && (ai.fogOffsetCueAt ?? -Infinity) <= time) {
    ai.fogOffsetCueAt = time + TUMANNIK_OFFSET_CUE_COOLDOWN;
    msgs.push(msg('Туманник звучит сбоку от силуэта. Свет, огонь или сухой шаг сложат обман.', time, '#9cf'));
    publishMonsterReadabilityEvent(state, world, e, target, 'monster_sighted', 4, ['tumannik', 'fog_offset', 'side_sound'], {
      counterplay: 'hold_corner_listen_light_or_leave_fog',
    });
    stampTumannikFogCue(world, e, time);
  }

  const ax = world.wrap(e.x + (ai.fogOffsetX ?? 0));
  const ay = world.wrap(e.y + (ai.fogOffsetY ?? 0));
  if ((e.attackCd ?? 0) <= 0 && world.dist2(ax, ay, target.x, target.y) <= TUMANNIK_STRIKE_RANGE_SQ) {
    damageTumannikOffsetStrike(world, entities, e, target, time, msgs, playerId, nextId, state);
    return true;
  }
  return false;
}

function glubinnayaHasLightCounter(world: World, e: Entity, target: Entity): boolean {
  return entityHasEquippedLight(target) ||
    entityLight(world, target) >= GLUB_SECOND_BEAT_LIGHT_SAFE ||
    entityLight(world, e) >= GLUB_SECOND_BEAT_LIGHT_SAFE ||
    pointLight(world, e.ai?.secondBeatX ?? e.x, e.ai?.secondBeatY ?? e.y) >= GLUB_SECOND_BEAT_LIGHT_SAFE;
}

function glubinnayaCanArm(world: World, e: Entity, target: Entity): boolean {
  return !entityHasEquippedLight(target) &&
    entityLight(world, target) < GLUB_SECOND_BEAT_LIGHT_SAFE &&
    entityLight(world, e) <= SHADOW_DARK_LIGHT;
}

function clearGlubinnayaSecondBeat(e: Entity): void {
  const ai = e.ai!;
  ai.secondBeatX = undefined;
  ai.secondBeatY = undefined;
  ai.secondBeatTargetX = undefined;
  ai.secondBeatTargetY = undefined;
  ai.secondBeatDx = undefined;
  ai.secondBeatDy = undefined;
  ai.secondBeatTimer = undefined;
  ai.secondBeatHold = undefined;
  ai.windupTargetId = undefined;
  e.spriteScale = undefined;
}

function stampGlubinnayaAfterimage(world: World, e: Entity, time: number): void {
  const ai = e.ai!;
  if (ai.secondBeatX === undefined || ai.secondBeatY === undefined) return;
  const x = world.wrap(Math.floor(ai.secondBeatX));
  const y = world.wrap(Math.floor(ai.secondBeatY));
  const fx = ((ai.secondBeatX % 1) + 1) % 1;
  const fy = ((ai.secondBeatY % 1) + 1) % 1;
  const seed = Math.imul(e.id, 33_331) ^ Math.floor(time * 12);
  stampMark(world, x, y, fx, fy, 0.36, MarkType.PSI, seed, 32, 44, 62, 118);
}

function tryMoveGlubinnayaDodge(world: World, e: Entity, ux: number, uy: number, sx: number, sy: number): void {
  const candidates = [
    { side: 1, back: 1 },
    { side: -1, back: 1 },
    { side: 1, back: 0.55 },
    { side: -1, back: 0.55 },
    { side: 0, back: 1.15 },
  ] as const;
  for (const c of candidates) {
    const nx = world.wrap(e.x - ux * GLUB_SECOND_BEAT_DODGE * c.back + sx * GLUB_SECOND_BEAT_DODGE * 0.72 * c.side);
    const ny = world.wrap(e.y - uy * GLUB_SECOND_BEAT_DODGE * c.back + sy * GLUB_SECOND_BEAT_DODGE * 0.72 * c.side);
    if (world.solid(Math.floor(nx), Math.floor(ny))) continue;
    e.x = nx;
    e.y = ny;
    return;
  }
}

function armGlubinnayaSecondBeat(
  world: World,
  e: Entity,
  target: Entity,
  time: number,
  msgs: Msg[],
  playerId: number,
  state?: GameState,
): void {
  const ai = e.ai!;
  const dx = world.delta(e.x, target.x);
  const dy = world.delta(e.y, target.y);
  const len = Math.max(0.001, Math.sqrt(dx * dx + dy * dy));
  const ux = dx / len;
  const uy = dy / len;
  const sign = (e.id & 1) === 0 ? 1 : -1;
  const sx = -uy * sign;
  const sy = ux * sign;

  ai.secondBeatX = e.x;
  ai.secondBeatY = e.y;
  ai.secondBeatTargetX = target.x;
  ai.secondBeatTargetY = target.y;
  ai.secondBeatDx = sx;
  ai.secondBeatDy = sy;
  ai.secondBeatTimer = GLUB_SECOND_BEAT_ARM_SEC;
  ai.secondBeatHold = 0;
  ai.windupTargetId = target.id;
  e.attackCd = Math.max(e.attackCd ?? 0, 0.45);
  e.spriteScale = 0.78;
  stampGlubinnayaAfterimage(world, e, time);
  tryMoveGlubinnayaDodge(world, e, ux, uy, sx, sy);

  if (target.id === playerId) {
    msgs.push(msg('Глубинная Тень оставила второй силуэт. Не догоняйте темный след: держите светлый выход.', time, '#9bd'));
  }
  publishMonsterReadabilityEvent(state, world, e, target, 'monster_sighted', 4, ['glubinnaya_ten', 'second_beat', 'afterimage', 'warning'], {
    windupSec: GLUB_SECOND_BEAT_ARM_SEC,
    counterplay: 'hold_position_light_exit_or_flashlight_reveal',
  });
  playSoundAt(playGrowl, e.x, e.y);
}

function damageGlubinnayaSecondBeat(
  world: World,
  entities: Entity[],
  e: Entity,
  target: Entity,
  time: number,
  msgs: Msg[],
  playerId: number,
  nextId: { v: number },
  state?: GameState,
): void {
  const def = MONSTERS[MonsterKind.GLUBINNAYA_TEN];
  const level = e.rpg?.level ?? 1;
  const strMult = e.rpg ? strMeleeDmgMult(e.rpg) : 1;
  const rawDmg = Math.round(scaleMonsterDmg(def.dmg, level) * strMult * GLUB_SECOND_BEAT_DMG_MULT * (e.monsterDmgMult ?? 1));
  const dmg = zhelemishIncomingMeleeDamage(target, time, rawDmg);
  if (target.hp === undefined) return;

  const debugImmortalPlayerHit = target.id === playerId && isDebugOnePunchManEnabled();
  if (debugImmortalPlayerHit) {
    keepDebugOnePunchManAlive(target);
  } else {
    { const _dmg = calculateDamage(dmg, DamageType.KINETIC, target); target.hp -= _dmg; applyHitStaggerAndKnockback(target, e.x, e.y, _dmg); }
    notifyActorDamaged(world, target, e, dmg, 'monster_special', time, state);
    if (target.id === playerId) recordPlayerDamage(state, e, dmg, 'Глубинная Тень ударила вторым телом: -' + dmg);
    if (target.hp <= 0) {
      target.alive = false;
      target.hp = 0;
    }
    const hitAng = Math.atan2(target.y - e.y, target.x - e.x);
    spawnBloodHit(world, target.x, target.y, hitAng, dmg, target.type === EntityType.MONSTER);
    if (target.hp <= 0) {
      spawnDeathPool(world, target.x, target.y, target.type === EntityType.MONSTER);
      if (target.type === EntityType.NPC) dropNpcInventory(target, entities, nextId);
      msgs.push(msg(`${entityDisplayName(e)} убила ${entityDisplayName(target)} вторым силуэтом`, time, '#f44'));
    }
  }

  const label = isPlayerEntity(target) ? 'тебя' : entityDisplayName(target);
  msgs.push(msg(`${entityDisplayName(e)} ударила ${label} вторым телом: -${dmg}`, time, '#f44'));
  if (state) {
    publishEvent(state, {
      type: 'monster_sighted',
      zoneId: zoneIdAt(world, e.x, e.y),
      roomId: world.roomAt(e.x, e.y)?.id,
      x: e.x,
      y: e.y,
      actorId: e.id,
      actorName: entityDisplayName(e),
      actorFaction: e.faction,
      targetId: target.id,
      targetName: entityDisplayName(target),
      targetFaction: target.faction,
      monsterKind: MonsterKind.GLUBINNAYA_TEN,
      severity: target.id === playerId ? 5 : 4,
      privacy: target.id === playerId ? 'local' : 'witnessed',
      tags: ['monster', 'glubinnaya_ten', 'second_beat', 'hit'],
      data: {
        rumorIds: [...GLUBINNAYA_TEN_RUMOR_IDS],
        damage: dmg,
        counterplay: 'do_not_chase_afterimage_in_darkness',
      },
    });
  }
  playSoundAt(playGrowl, e.x, e.y);
}

function updateGlubinnayaTenSecondBeat(
  world: World,
  entities: Entity[],
  e: Entity,
  target: Entity,
  bestDist: number,
  dt: number,
  time: number,
  msgs: Msg[],
  playerId: number,
  nextId: { v: number },
  state?: GameState,
): boolean {
  if (e.monsterKind !== MonsterKind.GLUBINNAYA_TEN) return false;
  const ai = e.ai!;
  e.attackCd = Math.max(0, (e.attackCd ?? 0) - dt);

  if (ai.secondBeatTimer !== undefined) {
    ai.secondBeatTimer = Math.max(0, ai.secondBeatTimer - dt);
    const movedSq = world.dist2(target.x, target.y, ai.secondBeatTargetX ?? target.x, ai.secondBeatTargetY ?? target.y);
    ai.secondBeatHold = movedSq <= GLUB_SECOND_BEAT_HOLD_SQ ? (ai.secondBeatHold ?? 0) + dt : 0;
    const lightCounter = glubinnayaHasLightCounter(world, e, target);
    const targetAtAfterimage = ai.secondBeatX !== undefined &&
      ai.secondBeatY !== undefined &&
      world.dist2(target.x, target.y, ai.secondBeatX, ai.secondBeatY) <= GLUB_SECOND_BEAT_TRIGGER_SQ;
    const afterimageDark = ai.secondBeatX !== undefined &&
      ai.secondBeatY !== undefined &&
      pointLight(world, ai.secondBeatX, ai.secondBeatY) <= SHADOW_DARK_LIGHT;

    if (targetAtAfterimage && movedSq > GLUB_SECOND_BEAT_HOLD_SQ && afterimageDark && !lightCounter && target.alive) {
      const sx = ai.secondBeatDx ?? 0;
      const sy = ai.secondBeatDy ?? 0;
      const nx = world.wrap(target.x + sx * 1.05);
      const ny = world.wrap(target.y + sy * 1.05);
      if (!world.solid(Math.floor(nx), Math.floor(ny))) {
        e.x = nx;
        e.y = ny;
      }
      e.angle = Math.atan2(world.delta(e.y, target.y), world.delta(e.x, target.x));
      damageGlubinnayaSecondBeat(world, entities, e, target, time, msgs, playerId, nextId, state);
      clearGlubinnayaSecondBeat(e);
      e.attackCd = GLUB_SECOND_BEAT_COOLDOWN;
      return true;
    }

    if (lightCounter || (ai.secondBeatHold ?? 0) >= GLUB_SECOND_BEAT_HOLD_SEC || ai.secondBeatTimer <= 0 || ai.windupTargetId !== target.id) {
      const reason = lightCounter ? 'light' : (ai.secondBeatHold ?? 0) >= GLUB_SECOND_BEAT_HOLD_SEC ? 'held_position' : 'expired';
      clearGlubinnayaSecondBeat(e);
      e.attackCd = Math.max(e.attackCd ?? 0, 0.75);
      if (target.id === playerId) {
        msgs.push(msg(
          reason === 'light'
            ? 'Свет сложил второй силуэт Глубинной Тени.'
            : 'Глубинная Тень потеряла второй темп, пока вы не гнались за следом.',
          time,
          '#9cf',
        ));
      }
      publishMonsterReadabilityEvent(state, world, e, target, 'monster_windup_interrupted', 3, ['glubinnaya_ten', 'second_beat', 'interrupted', reason], {
        reason,
        counterplay: 'light_or_hold_position',
      });
      return true;
    }

    e.spriteScale = 0.86 + Math.max(0, ai.secondBeatTimer) * 0.05;
    return true;
  }

  if (bestDist * bestDist <= GLUB_SECOND_BEAT_ARM_RANGE_SQ &&
      (e.attackCd ?? 0) <= 0 &&
      glubinnayaCanArm(world, e, target)) {
    armGlubinnayaSecondBeat(world, e, target, time, msgs, playerId, state);
    return true;
  }

  return false;
}

function tonkayaLineCell(world: World, x: number, y: number): boolean {
  const ci = world.idx(x, y);
  const cell = world.cells[ci];
  return (cell === Cell.FLOOR || cell === Cell.DOOR) && !world.solid(x, y);
}

function tonkayaOpenRun(world: World, x: number, y: number, dx: number, dy: number): number {
  let run = 0;
  for (let step = 1; step <= 6; step++) {
    const tx = world.wrap(x + dx * step);
    const ty = world.wrap(y + dy * step);
    if (!tonkayaLineCell(world, tx, ty)) break;
    run++;
  }
  return run;
}

function tonkayaAxisAt(world: World, x: number, y: number): { dx: number; dy: number; score: number } | null {
  const ci = world.idx(x, y);
  const doorBonus = world.cells[ci] === Cell.DOOR ? 2.4 : 0;
  const horizontal = tonkayaOpenRun(world, x, y, 1, 0) + tonkayaOpenRun(world, x, y, -1, 0);
  const vertical = tonkayaOpenRun(world, x, y, 0, 1) + tonkayaOpenRun(world, x, y, 0, -1);
  const horizontalWalls = (world.solid(x, y - 1) ? 1 : 0) + (world.solid(x, y + 1) ? 1 : 0);
  const verticalWalls = (world.solid(x - 1, y) ? 1 : 0) + (world.solid(x + 1, y) ? 1 : 0);
  const horizontalScore = horizontal + horizontalWalls * 1.35 + doorBonus;
  const verticalScore = vertical + verticalWalls * 1.35 + doorBonus;
  const axis = horizontalScore >= verticalScore
    ? { dx: 1, dy: 0, score: horizontalScore }
    : { dx: 0, dy: 1, score: verticalScore };
  return axis.score >= 5.4 ? axis : null;
}

function tonkayaClearSight(world: World, x: number, y: number, target: Entity): boolean {
  const sx = x + 0.5;
  const sy = y + 0.5;
  const dx = world.delta(sx, target.x);
  const dy = world.delta(sy, target.y);
  const dist = Math.sqrt(dx * dx + dy * dy);
  if (dist > TONKAYA_BAIT_MAX_VISIBLE) return false;
  const steps = Math.max(2, Math.ceil(dist * 2));
  for (let i = 1; i < steps; i++) {
    const t = i / steps;
    const tx = Math.floor(world.wrap(sx + dx * t));
    const ty = Math.floor(world.wrap(sy + dy * t));
    if (world.solid(tx, ty)) return false;
  }
  return true;
}

function chooseTonkayaBaitLine(world: World, e: Entity, target: Entity): MonsterBaitLineState | undefined {
  const ex = Math.floor(e.x);
  const ey = Math.floor(e.y);
  let bestScore = -Infinity;
  let best: MonsterBaitLineState | undefined;

  for (let oy = -TONKAYA_BAIT_SCAN_RADIUS; oy <= TONKAYA_BAIT_SCAN_RADIUS; oy++) {
    for (let ox = -TONKAYA_BAIT_SCAN_RADIUS; ox <= TONKAYA_BAIT_SCAN_RADIUS; ox++) {
      if (ox * ox + oy * oy > TONKAYA_BAIT_SCAN_RADIUS_SQ) continue;
      const x = world.wrap(ex + ox);
      const y = world.wrap(ey + oy);
      if (!tonkayaLineCell(world, x, y)) continue;

      const dTarget = world.dist2(x + 0.5, y + 0.5, target.x, target.y);
      if (dTarget < TONKAYA_BAIT_MIN_TARGET_SQ || dTarget > TONKAYA_BAIT_MAX_TARGET_SQ) continue;
      const light = world.light[world.idx(x, y)] ?? 0;
      if (light > 0.3 && world.cells[world.idx(x, y)] !== Cell.DOOR) continue;

      const axis = tonkayaAxisAt(world, x, y);
      if (!axis || !tonkayaClearSight(world, x, y, target)) continue;

      const lineDist = Math.sqrt(dTarget);
      const score = axis.score * 3 + (0.32 - light) * 8 - Math.abs(lineDist - 7.2) * 0.45 - world.dist2(e.x, e.y, x + 0.5, y + 0.5) * 0.018;
      if (score <= bestScore) continue;
      bestScore = score;
      best = { x, y, dx: axis.dx, dy: axis.dy, nerve: TONKAYA_NERVE_SEC, armed: false, spent: false };
    }
  }

  return best;
}

function targetInsideTonkayaLine(world: World, line: MonsterBaitLineState, target: Entity): boolean {
  const ax = line.x + 0.5;
  const ay = line.y + 0.5;
  const dx = world.delta(ax, target.x);
  const dy = world.delta(ay, target.y);
  const proj = dx * line.dx + dy * line.dy;
  const perp = Math.abs(dx * line.dy - dy * line.dx);
  return Math.abs(proj) <= TONKAYA_LINE_HALF_LEN && perp <= TONKAYA_LINE_PERP;
}

function tonkayaMoveToFlank(world: World, e: Entity, target: Entity, line: MonsterBaitLineState): void {
  const px = -line.dy;
  const py = line.dx;
  const side = world.dist2(e.x, e.y, target.x + px, target.y + py) < world.dist2(e.x, e.y, target.x - px, target.y - py) ? 1 : -1;
  for (const mult of [1.05, -1.05, 0.0]) {
    const fx = world.wrap(Math.floor(target.x + px * side * mult));
    const fy = world.wrap(Math.floor(target.y + py * side * mult));
    if (!tonkayaLineCell(world, fx, fy)) continue;
    e.x = fx + 0.5;
    e.y = fy + 0.5;
    break;
  }
}

function damageTonkayaTenStrike(
  world: World,
  entities: Entity[],
  e: Entity,
  target: Entity,
  time: number,
  msgs: Msg[],
  playerId: number,
  nextId: { v: number },
  state?: GameState,
): void {
  const def = MONSTERS[MonsterKind.TONKAYA_TEN];
  const level = e.rpg?.level ?? 1;
  const strMult = e.rpg ? strMeleeDmgMult(e.rpg) : 1;
  const rawDmg = Math.round(scaleMonsterDmg(def.dmg, level) * strMult * TONKAYA_FLANK_MULT * (e.monsterDmgMult ?? 1));
  const dmg = zhelemishIncomingMeleeDamage(target, time, rawDmg);
  if (target.hp === undefined) return;

  const debugImmortalPlayerHit = target.id === playerId && isDebugOnePunchManEnabled();
  if (debugImmortalPlayerHit) {
    keepDebugOnePunchManAlive(target);
  } else {
    { const _dmg = calculateDamage(dmg, DamageType.KINETIC, target); target.hp -= _dmg; applyHitStaggerAndKnockback(target, e.x, e.y, _dmg); }
    notifyActorDamaged(world, target, e, dmg, 'monster_special', time, state);
    if (target.id === playerId) recordPlayerDamage(state, e, dmg, `${entityDisplayName(e)} ударила с темной линии: -${dmg}`);
    if (target.hp <= 0) { target.alive = false; target.hp = 0; }
    const hitAng = Math.atan2(world.delta(e.y, target.y), world.delta(e.x, target.x));
    spawnBloodHit(world, target.x, target.y, hitAng, dmg, target.type === EntityType.MONSTER);
    if (target.hp <= 0) {
      spawnDeathPool(world, target.x, target.y, target.type === EntityType.MONSTER);
      if (target.type === EntityType.NPC) dropNpcInventory(target, entities, nextId);
      msgs.push(msg(`${entityDisplayName(e)} увела и убила ${entityDisplayName(target)}`, time, '#f44'));
    }
  }

  const label = isPlayerEntity(target) ? 'тебя' : entityDisplayName(target);
  msgs.push(msg(`${entityDisplayName(e)} бьет ${label} сбоку из подготовленной линии: -${dmg}`, time, '#c8f'));
  publishMonsterReadabilityEvent(state, world, e, target, 'monster_sighted', 4, ['tonkaya_ten', 'bait_line', 'flank', 'line_crossed'], {
    damage: dmg,
    counterplay: 'hold_ground_light_or_noise',
  });
}

function collapseTonkayaLine(
  world: World,
  e: Entity,
  target: Entity,
  time: number,
  msgs: Msg[],
  reason: string,
  state?: GameState,
): void {
  e.ai!.baitLine = undefined;
  e.ai!.baitScanCd = TONKAYA_REPOSITION_CD;
  e.attackCd = Math.max(e.attackCd ?? 0, 0.65);
  e.spriteScale = undefined;
  if (isPlayerEntity(target)) {
    msgs.push(msg(
      reason === 'wait'
        ? 'Тонкая Тень не выдержала ожидания и вернулась без фланговой линии.'
        : 'Свет или шум сорвали темную линию Тонкой Тени.',
      time,
      '#ccf',
    ));
  }
  publishMonsterReadabilityEvent(state, world, e, target, 'monster_windup_interrupted', 3, ['tonkaya_ten', 'bait_line', 'interrupted', reason], {
    reason,
    counterplay: 'hold_ground_light_or_noise',
  });
}

function updateTonkayaTenBaitLine(
  world: World,
  entities: Entity[],
  e: Entity,
  target: Entity,
  dt: number,
  time: number,
  msgs: Msg[],
  playerId: number,
  nextId: { v: number },
  state?: GameState,
): boolean {
  const ai = e.ai!;
  if (shadowHasLightCounter(world, e, target)) {
    if (ai.baitLine) collapseTonkayaLine(world, e, target, time, msgs, 'light', state);
    return false;
  }

  const noise = findNoiseInvestigationTarget(world, state, e, time);
  if (noise && ai.baitLine && world.dist2(noise.x, noise.y, ai.baitLine.x + 0.5, ai.baitLine.y + 0.5) > 4) {
    collapseTonkayaLine(world, e, target, time, msgs, 'noise', state);
    return false;
  }

  ai.baitScanCd = (ai.baitScanCd ?? 0) - dt;
  if (!ai.baitLine && ai.baitScanCd <= 0) {
    ai.baitLine = chooseTonkayaBaitLine(world, e, target);
    ai.baitScanCd = TONKAYA_REPOSITION_CD;
    if (ai.baitLine && target.id === playerId && ai.lastSeenTargetId !== playerId) {
      ai.lastSeenTargetId = playerId;
      msgs.push(msg('Тонкая Тень пятится к темной линии. Не входите за ней в коридор.', time, '#bce'));
      publishMonsterReadabilityEvent(state, world, e, target, 'monster_sighted', 4, ['tonkaya_ten', 'bait_line', 'warning'], {
        counterplay: 'hold_ground_light_or_noise',
        lineX: ai.baitLine.x,
        lineY: ai.baitLine.y,
      });
    }
  }

  const line = ai.baitLine;
  if (!line) return false;
  const lineCenterX = line.x + 0.5;
  const lineCenterY = line.y + 0.5;
  if (!tonkayaLineCell(world, line.x, line.y) || !tonkayaClearSight(world, line.x, line.y, target)) {
    collapseTonkayaLine(world, e, target, time, msgs, 'blocked', state);
    return false;
  }

  if (!line.spent && line.armed && targetInsideTonkayaLine(world, line, target) && world.dist2(e.x, e.y, target.x, target.y) <= TONKAYA_FLANK_RANGE * TONKAYA_FLANK_RANGE) {
    line.spent = true;
    tonkayaMoveToFlank(world, e, target, line);
    damageTonkayaTenStrike(world, entities, e, target, time, msgs, playerId, nextId, state);
    ai.baitLine = undefined;
    e.spriteScale = undefined;
    e.attackCd = MONSTERS[MonsterKind.TONKAYA_TEN].attackRate;
    return true;
  }

  const targetDistToLine = world.dist2(target.x, target.y, lineCenterX, lineCenterY);
  line.nerve -= dt * (targetDistToLine > 5.5 * 5.5 ? 1.35 : 0.65);
  if (line.nerve <= 0) {
    collapseTonkayaLine(world, e, target, time, msgs, 'wait', state);
    return false;
  }

  const dx = world.delta(target.x, e.x);
  const dy = world.delta(target.y, e.y);
  e.angle = Math.atan2(dy, dx);
  ai.goal = AIGoal.HUNT;
  ai.combatTargetId = target.id;

  if (world.dist2(e.x, e.y, lineCenterX, lineCenterY) > 0.55) {
    if (ai.path.length === 0 || ai.timer <= 0 || ai.tx !== line.x || ai.ty !== line.y) {
      tryAssignPathToCell(world, e, line.x, line.y);
      ai.timer = 0.9;
    }
    ai.timer -= dt;
    followMonsterPath(world, e, dt);
    return true;
  }

  line.armed = true;
  e.spriteScale = 0.92;
  return true;
}

function clearTreskotnikBurst(e: Entity): void {
  const ai = e.ai!;
  ai.windupTimer = undefined;
  ai.windupTargetId = undefined;
  ai.windupStartHp = undefined;
  ai.sprintTimer = undefined;
  ai.sprintDx = undefined;
  ai.sprintDy = undefined;
  e.spriteScale = undefined;
}

function treskotnikSprintBlocked(world: World, x: number, y: number): boolean {
  const ix = Math.floor(x);
  const iy = Math.floor(y);
  if (world.solid(ix, iy)) return true;
  return isLineOfFireCover(world.features[world.idx(ix, iy)] as Feature);
}

function interruptTreskotnikWindup(
  world: World,
  e: Entity,
  target: Entity | undefined,
  time: number,
  msgs: Msg[],
  reason: 'hit' | 'line',
  state?: GameState,
): void {
  const ai = e.ai!;
  const wasWindup = (ai.windupTimer ?? 0) > 0;
  clearTreskotnikBurst(e);
  if (reason === 'hit') {
    ai.staggerTimer = Math.max(ai.staggerTimer ?? 0, TRESKOTNIK_STAGGER_SEC);
    e.attackCd = Math.max(e.attackCd ?? 0, 1.0);
    e.spriteScale = 0.82;
    msgs.push(msg('Попадание раскрошило красный рывок Трескотника. Он долго собирает плиты обратно.', time, '#f66'));
  } else {
    e.attackCd = Math.max(e.attackCd ?? 0, 0.55);
    msgs.push(msg('Трескотник потерял прямую и рассыпал рывок об угол.', time, '#f86'));
  }
  if (!wasWindup) return;
  publishMonsterReadabilityEvent(state, world, e, target, 'monster_windup_interrupted', reason === 'hit' ? 4 : 3, ['treskotnik', 'fracture_sprint', 'interrupted', reason], {
    reason,
    staggerSec: reason === 'hit' ? TRESKOTNIK_STAGGER_SEC : 0,
    counterplay: reason === 'hit' ? 'shoot_red_crack_pulse' : 'break_straight_line_before_sprint',
  });
}

function damageTreskotnikTarget(
  world: World,
  entities: Entity[],
  e: Entity,
  target: Entity,
  time: number,
  msgs: Msg[],
  playerId: number,
  nextId: { v: number },
  state?: GameState,
): void {
  const def = MONSTERS[MonsterKind.TRESKOTNIK];
  const level = e.rpg?.level ?? 1;
  const strMult = e.rpg ? strMeleeDmgMult(e.rpg) : 1;
  const rawDmg = Math.round(scaleMonsterDmg(def.dmg, level) * strMult * TRESKOTNIK_BURST_DMG_MULT * (e.monsterDmgMult ?? 1));
  const dmg = zhelemishIncomingMeleeDamage(target, time, rawDmg);
  if (target.hp !== undefined) {
    const debugImmortalPlayerHit = target.id === playerId && isDebugOnePunchManEnabled();
    if (debugImmortalPlayerHit) {
      keepDebugOnePunchManAlive(target);
    } else {
      { const _dmg = calculateDamage(dmg, DamageType.KINETIC, target); target.hp -= _dmg; applyHitStaggerAndKnockback(target, e.x, e.y, _dmg); }
      notifyActorDamaged(world, target, e, dmg, 'monster_special', time, state);
      if (target.id === playerId) recordPlayerDamage(state, e, dmg, `${entityDisplayName(e)} влетел в тебя по красной трещине: -${dmg}`);
      if (target.hp <= 0) {
        target.alive = false;
        target.hp = 0;
      }
      const hitAng = Math.atan2(target.y - e.y, target.x - e.x);
      spawnBloodHit(world, target.x, target.y, hitAng, dmg, target.type === EntityType.MONSTER);
      if (target.hp <= 0) {
        spawnDeathPool(world, target.x, target.y, target.type === EntityType.MONSTER);
        if (target.type === EntityType.NPC) dropNpcInventory(target, entities, nextId);
        msgs.push(msg(`${entityDisplayName(e)} разбил ${entityDisplayName(target)} рывком`, time, '#f44'));
      }
    }
  }

  const selfDamage = Math.max(4, Math.round((e.maxHp ?? def.hp) * 0.28));
  if (e.hp !== undefined) {
    e.hp = Math.max(0, e.hp - selfDamage);
    if (e.hp <= 0) {
      e.alive = false;
      spawnDeathPool(world, e.x, e.y, true);
    }
  }
  msgs.push(msg(`Трескотник ударил и осыпался сам: -${selfDamage}`, time, '#f86'));
  publishMonsterReadabilityEvent(state, world, e, target, 'monster_sighted', isPlayerEntity(target) ? 4 : 3, ['treskotnik', 'fracture_sprint', 'hit'], {
    damage: dmg,
    selfDamage,
    counterplay: 'shoot_windup_or_break_line_before_contact',
  });
  playSoundAt(playGrowl, e.x, e.y);
}

function updateTreskotnikFractureSprint(
  world: World,
  entities: Entity[],
  e: Entity,
  target: Entity | null,
  dt: number,
  time: number,
  msgs: Msg[],
  playerId: number,
  nextId: { v: number },
  state?: GameState,
): boolean {
  if (e.monsterKind !== MonsterKind.TRESKOTNIK) return false;
  const ai = e.ai!;
  const def = MONSTERS[MonsterKind.TRESKOTNIK];

  if ((ai.staggerTimer ?? 0) > 0) {
    ai.staggerTimer = Math.max(0, (ai.staggerTimer ?? 0) - dt);
    e.attackCd = Math.max(e.attackCd ?? 0, 0.25);
    e.spriteScale = 0.82 + Math.max(0, ai.staggerTimer / TRESKOTNIK_STAGGER_SEC) * 0.08;
    return true;
  }

  if ((ai.sprintTimer ?? 0) > 0) {
    const dx = ai.sprintDx ?? Math.cos(e.angle);
    const dy = ai.sprintDy ?? Math.sin(e.angle);
    const speed = Math.max(e.speed * TRESKOTNIK_SPRINT_SPEED_MULT, 7.5);
    let remain = speed * dt;
    while (remain > 0) {
      const step = Math.min(0.22, remain);
      const nx = world.wrap(e.x + dx * step);
      const ny = world.wrap(e.y + dy * step);
      if (treskotnikSprintBlocked(world, nx, ny)) {
        const selfDamage = Math.max(3, Math.round((e.maxHp ?? def.hp) * 0.22));
        if (e.hp !== undefined) {
          e.hp = Math.max(0, e.hp - selfDamage);
          if (e.hp <= 0) {
            e.alive = false;
            spawnDeathPool(world, e.x, e.y, true);
          }
        }
        clearTreskotnikBurst(e);
        ai.staggerTimer = Math.max(ai.staggerTimer ?? 0, 0.75);
        e.attackCd = def.attackRate;
        msgs.push(msg(`Трескотник врезался в препятствие и осыпался: -${selfDamage}`, time, '#f86'));
        publishMonsterReadabilityEvent(state, world, e, target ?? undefined, 'monster_windup_interrupted', 3, ['treskotnik', 'fracture_sprint', 'obstacle'], {
          reason: 'obstacle',
          selfDamage,
          counterplay: 'door_table_or_corner_absorbs_sprint',
        });
        return true;
      }
      e.x = nx;
      e.y = ny;
      remain -= step;
      if (target?.alive && world.dist2(e.x, e.y, target.x, target.y) <= TRESKOTNIK_HIT_SQ) {
        damageTreskotnikTarget(world, entities, e, target, time, msgs, playerId, nextId, state);
        clearTreskotnikBurst(e);
        ai.staggerTimer = Math.max(ai.staggerTimer ?? 0, 0.5);
        e.attackCd = def.attackRate;
        return true;
      }
    }
    ai.sprintTimer = Math.max(0, (ai.sprintTimer ?? 0) - dt);
    e.spriteScale = 1.14;
    if (ai.sprintTimer <= 0) {
      clearTreskotnikBurst(e);
      e.attackCd = Math.max(e.attackCd ?? 0, 0.65);
    }
    return true;
  }

  e.attackCd = Math.max(0, (e.attackCd ?? 0) - dt);

  if ((ai.windupTimer ?? 0) > 0) {
    if (e.hp !== undefined && ai.windupStartHp !== undefined && e.hp < ai.windupStartHp - 0.001) {
      interruptTreskotnikWindup(world, e, target ?? undefined, time, msgs, 'hit', state);
      return true;
    }
    if (!target?.alive || ai.windupTargetId !== target.id || !hasClearLine(world, e, target, TRESKOTNIK_WINDUP_RANGE + 1.5)) {
      interruptTreskotnikWindup(world, e, target ?? undefined, time, msgs, 'line', state);
      return true;
    }

    const dx = world.delta(e.x, target.x);
    const dy = world.delta(e.y, target.y);
    const dist = Math.max(0.001, Math.sqrt(dx * dx + dy * dy));
    e.angle = Math.atan2(dy, dx);
    const windupTimer = ai.windupTimer ?? 0;
    e.spriteScale = 1.18 + Math.max(0, windupTimer / TRESKOTNIK_WINDUP_SEC) * 0.16;
    ai.windupTimer = Math.max(0, windupTimer - dt);
    if (ai.windupTimer <= 0) {
      ai.sprintDx = dx / dist;
      ai.sprintDy = dy / dist;
      ai.sprintTimer = TRESKOTNIK_SPRINT_SEC;
      ai.windupTimer = undefined;
      ai.windupStartHp = undefined;
      e.spriteScale = 1.2;
    }
    return true;
  }

  if (!target || !target.alive) {
    e.spriteScale = undefined;
    return false;
  }

  const distSq = world.dist2(e.x, e.y, target.x, target.y);
  if (distSq <= TRESKOTNIK_WINDUP_RANGE * TRESKOTNIK_WINDUP_RANGE && e.attackCd <= 0 && hasClearLine(world, e, target, TRESKOTNIK_WINDUP_RANGE)) {
    const dx = world.delta(e.x, target.x);
    const dy = world.delta(e.y, target.y);
    ai.windupTimer = TRESKOTNIK_WINDUP_SEC;
    ai.windupTargetId = target.id;
    ai.windupStartHp = e.hp;
    ai.path = [];
    ai.pi = 0;
    e.angle = Math.atan2(dy, dx);
    e.spriteScale = 1.32;
    if (target.id === playerId) {
      msgs.push(msg('Трескотник замер: красные трещины вспыхнули перед прямым рывком.', time, '#f66'));
      playSoundAt(playGrowl, e.x, e.y);
    }
    publishMonsterReadabilityEvent(state, world, e, target, 'monster_sighted', target.id === playerId ? 4 : 3, ['treskotnik', 'fracture_sprint', 'warning'], {
      windupSec: TRESKOTNIK_WINDUP_SEC,
      counterplay: 'shoot_red_crack_pulse_or_break_line',
    });
    return true;
  }

  e.spriteScale = undefined;
  return false;
}

function updateZakalennayaArmorStagger(e: Entity, dt: number): boolean {
  if (e.monsterKind !== MonsterKind.ZAKALENNAYA_ARMATURA || !e.ai) return false;
  if ((e.ai.staggerTimer ?? 0) <= 0) {
    if (e.spriteScale !== undefined) e.spriteScale = undefined;
    return false;
  }
  e.ai.staggerTimer = Math.max(0, (e.ai.staggerTimer ?? 0) - dt);
  e.attackCd = Math.max(e.attackCd ?? 0, 0.35);
  e.spriteScale = (e.monsterArmorStacks ?? 0) <= 0 ? 0.88 : 0.94;
  return true;
}

/* ── Drop NPC inventory as ITEM_DROP entities ─────────────────── */
export function dropNpcInventory(e: Entity, entities: Entity[], nextId: { v: number }): void {
  if (!e.inventory || e.inventory.length === 0) return;
  const slots = entitySpawnSlots(entities, EntityType.ITEM_DROP, e.inventory.length);
  let dropped = 0;
  for (const item of e.inventory) {
    if (dropped >= slots) break;
    if (!item || item.count <= 0) continue;
    entities.push({
      id: nextId.v++, type: EntityType.ITEM_DROP,
      x: e.x + (Math.random() - 0.5) * 0.5,
      y: e.y + (Math.random() - 0.5) * 0.5,
      angle: 0, pitch: 0, alive: true, speed: 0, sprite: Spr.ITEM_DROP,
      inventory: [{ defId: item.defId, count: item.count, data: item.data }],
    });
    dropped++;
  }
  e.inventory = [];
}

function isWeepingAngelFrozen(world: World, e: Entity): boolean {
  if (!hasAIFlag(e, 'weepingAngel')) return false;

  const index = getEntityIndex();
  const radius = 25;
  const out: Entity[] = [];
  index.queryRadius(e.x, e.y, radius, out, ENTITY_MASK_ACTOR);

  for (let i = 0; i < out.length; i++) {
    const actor = out[i];
    if (actor.id === e.id || !actor.alive) continue;
    if (!hasClearLine(world, actor, e, radius)) continue;

    const dx = e.x - actor.x;
    const dy = e.y - actor.y;
    const angleToSculpture = Math.atan2(dy, dx);

    let diff = Math.abs(angleToSculpture - actor.angle);
    while (diff > Math.PI) diff -= Math.PI * 2;
    diff = Math.abs(diff);

    // 45 degrees field of view
    if (diff <= Math.PI / 4) {
      return true;
    }
  }
  return false;
}

export function tryPerformMonsterMeleeAttack(
  world: World,
  entities: Entity[],
  e: Entity,
  target: Entity,
  def: MonsterDef | null,
  dt: number,
  time: number,
  msgs: Msg[],
  playerId: number,
  nextId: { v: number },
  bestDist: number,
  state?: GameState
): boolean {
  if (e.reloading) {
    e.reloadTimer = Math.max(0, (e.reloadTimer ?? 0) - dt);
    if (e.reloadTimer <= 0) {
      e.currentMag = 1; // Melee attacks are treated as mag=1
      e.reloading = false;
    }
    return true; // Block attack while reloading
  }
  if ((e.currentMag ?? 0) <= 0) {
    e.reloading = true;
    e.reloadTimer = (def?.attackRate ?? 1) / (e.rpg ? (1 + e.rpg.agi * 0.05) : 1); // fallback if reloadTime not available directly here
    return true;
  }
  const mRange = monsterMeleeRange(world, e);
  if (bestDist < mRange) {
    e.attackCd = (e.attackCd ?? 0) - dt;
    if (e.attackCd! <= 0) {
      const dx = world.delta(e.x, target.x);
      const dy = world.delta(e.y, target.y);
      e.angle = Math.atan2(dy, dx);

      const ax = e.x + Math.cos(e.angle) * mRange;
      const ay = e.y + Math.sin(e.angle) * mRange;
      getEntityIndex().queryRadius(ax, ay, 1.2, monsterMeleeHitQuery, ENTITY_MASK_ACTOR);
      const hitTarget = selectMeleeTarget(world, e, monsterMeleeHitQuery, mRange);

      if (hitTarget) {
        updateZombieCrowdReadability(world, e, hitTarget, time, msgs, playerId, state);
        const baseDmg = def?.dmg ?? 10;
        const level = e.rpg?.level ?? 1;
        const strMult = e.rpg ? strMeleeDmgMult(e.rpg) : 1;
        const rawDmg = Math.round(scaleMonsterDmg(baseDmg, level) * strMult * monsterDmgMult(world, e, hitTarget) * (e.monsterDmgMult ?? 1));
        const dmg = zhelemishIncomingMeleeDamage(hitTarget, time, rawDmg);
        if (tryZombieApocalypseInfection(world, e, hitTarget, state, msgs, time)) {
          const hitAng = Math.atan2(hitTarget.y - e.y, hitTarget.x - e.x);
          spawnBloodHit(world, hitTarget.x, hitTarget.y, hitAng, Math.max(2, Math.round(dmg * 0.35)), false);
          playSoundAt(e.monsterKind === MonsterKind.FOG_SHARK ? playFogSharkBite : playGrowl, e.x, e.y);
          e.currentMag = 0;
          e.attackCd = def?.attackRate ?? 1;
          return true;
        }
        if (hitTarget.hp !== undefined) {
          const debugImmortalPlayerHit = hitTarget.id === playerId && isDebugOnePunchManEnabled();
          if (debugImmortalPlayerHit) {
            keepDebugOnePunchManAlive(hitTarget);
          } else {
            { const _dmg = calculateDamage(dmg, DamageType.KINETIC, hitTarget); hitTarget.hp -= _dmg; applyHitStaggerAndKnockback(hitTarget, e.x, e.y, _dmg); }
            notifyActorDamaged(world, hitTarget, e, dmg, 'monster_melee', time, state);
            applyLishennyyContactDecay(state, world, e, hitTarget, dmg, time, msgs, playerId);
            applyKontorshchikGrab(state, world, e, hitTarget, time, msgs);
            dropSlimeWomanResidue(world, e, hitTarget, time, state, 'grab');
            if (hitTarget.id === playerId) {
              const verb = e.monsterKind === MonsterKind.KONTORSHCHIK
                ? 'схватил за бумаги'
                : e.monsterKind === MonsterKind.SLIME_WOMAN
                  ? 'схватила жижевой рукой'
                  : e.monsterKind === MonsterKind.LISHENNYY
                    ? 'коснулся распадом'
                    : 'задел';
              recordPlayerDamage(state, e, dmg, `${entityDisplayName(e)} ${verb} тебя: -${dmg}`);
            }
            if (hitTarget.hp <= 0) { hitTarget.alive = false; hitTarget.hp = 0; }
            const hitAng = Math.atan2(hitTarget.y - e.y, hitTarget.x - e.x);
            spawnBloodHit(world, hitTarget.x, hitTarget.y, hitAng, dmg, hitTarget.type === EntityType.MONSTER);
            if (hitTarget.hp <= 0) {
              spawnDeathPool(world, hitTarget.x, hitTarget.y, hitTarget.type === EntityType.MONSTER);
              if (hitTarget.type === EntityType.NPC) dropNpcInventory(hitTarget, entities, nextId);
              msgs.push(msg(`${entityDisplayName(e)} убил ${entityDisplayName(hitTarget)}`, time, '#f44'));
              if (e.monsterKind === MonsterKind.SOBRANNYY) growSobrannyy(world, e, hitTarget, time, msgs, state, 'kill');
            }
          }
        }
        playSoundAt(e.monsterKind === MonsterKind.FOG_SHARK ? playFogSharkBite : playGrowl, e.x, e.y);
        tryOlgoyDragTarget(world, e, hitTarget, time, msgs, state);
        e.attackCd = def?.attackRate ?? 1;
      }
    }
    return true;
  }
  return false;
}

/* ── Monster AI update ────────────────────────────────────────── */
export function updateMonster(world: World, entities: Entity[], e: Entity, dt: number, time: number, msgs: Msg[], playerId: number, nextId: { v: number }, state?: GameState): void {
  const ai = e.ai!;
  if (isWeepingAngelFrozen(world, e)) {
    return;
  }

  if (updateZakalennayaArmorStagger(e, dt)) return;

  evaluateMicroStimuli(world, e, time, msgs);
  if (tickMicroGoal(world, entities, e, dt, time, msgs)) return;

  if (e.monsterKind === MonsterKind.KHOROVAYA_MATKA) {
    updateKhorovayaMatka(world, entities, e, dt, time, msgs, playerId, nextId, _entityById, state);
  }

  if (e.monsterKind === MonsterKind.MATKA) {
    if (!e.alive) return;
    updateMatkaSource(world, entities, e, dt, time, msgs, nextId, _entityById, state);
  }

  const player = _entityById.get(playerId);
  if (updateLishennyyBrightAvoidance(world, e, dt)) return;
  updateChervieNetPossessor(world, entities, e, dt, time, msgs, playerId, state);
  ensureMukhozhukExposed(world, e, time, msgs, player, state);
  if (updateFalseLiquidatorPatrol(world, e, dt, time, msgs, player, state)) return;
  if (updateSlimevikMonster(world, entities, e, dt, time, msgs, player, state)) return;
  if (updateGnilushkaMonster(world, entities, e, dt, time, msgs, playerId, state)) return;
  if (updateHeadSlugParasite(world, entities, e, dt, time, msgs, nextId, state)) return;
  updateSobrannyyGrowthState(world, e, time, msgs, state);
  tickLozhnyyDukhFalsePhase(e, dt);
  if (updateGreenDogNoiseFear(world, e, dt, time, msgs, state)) return;
  updateSlimeWomanState(world, e, time, msgs, state);
  updateWaterStriderState(world, e, dt, time);
  updatePanelnikWallBrace(world, e, dt, time, msgs, player, state);
  if (updateSporeCarpetLurkingFurniture(world, entities, e, dt, time, msgs, playerId, state)) return;

  const def = e.monsterKind !== undefined ? MONSTERS[e.monsterKind] : null;
  if (updateRzhavnikScrapWake(world, entities, e, dt, time, msgs, playerId, nextId, state)) return;
  if (player?.alive && updateBezekhiyDeadEcho(world, e, player, dt, time, msgs, state)) return;
  const baseDetectSq = def && !def.isRanged && def.speed > 0 ? MONSTER_MELEE_DETECT_SQ : MONSTER_DETECT_SQ;
  let detectSq = monsterDetectSq(world, e, baseDetectSq);
  detectSq = pomoynyRoyDetectSq(e, player, detectSq);
  let target: Entity | null;
  let lishennyyLightTarget: LishennyyLightTarget | null = null;
  const zombieApocalypse = e.monsterKind === MonsterKind.ZOMBIE && isZombieApocalypseActive(state);
  if (zombieApocalypse) {
    target = findZombieApocalypseTarget(world, entities, e, dt, detectSq);
  } else if (e.monsterKind === MonsterKind.LISHENNYY) {
    detectSq = LISHENNYY_DETECT_SQ;
    lishennyyLightTarget = findLishennyyLightTarget(world, e, dt, time, state);
    target = lishennyyLightTarget?.source === 'actor' && lishennyyLightTarget.entity
      ? lishennyyLightTarget.entity
      : null;
  } else if (e.monsterKind === MonsterKind.CHERNOSLIZ) {
    target = findChernoSlizTarget(world, e, dt);
  } else if (hasAIFlag(e, 'meatWorm')) {
    target = findMeatWormTarget(world, e, dt);
  } else if (isDocumentPressureHunter(e)) {
    target = findDocumentHunterTarget(world, entities, e, dt);
  } else if (hasAIFlag(e, 'closeReveal')) {
    target = findCombatTarget(world, entities, e, dt, detectSq, 1.25, canBeMonsterTarget);
  } else if (e.monsterKind === MonsterKind.KOSTOREZ || e.monsterKind === MonsterKind.SAFEGUARD) {
    detectSq = e.monsterKind === MonsterKind.SAFEGUARD ? SAFEGUARD_DETECT_SQ : KOSTOREZ_DETECT_SQ;
    target = findCombatTarget(world, entities, e, dt, detectSq, deterministicScanCd(e.id, 0.7, 0.3), canBeMonsterTarget);
  } else if (e.monsterKind === MonsterKind.TRESKOTNIK) {
    detectSq = TRESKOTNIK_DETECT_SQ;
    target = findCombatTarget(world, entities, e, dt, detectSq, 0.45, canBeMonsterTarget);
  } else {
    const scanCd = fixedScanCd(e) ?? deterministicScanCd(e.id, 1.0, 0.5);
    target = findCombatTarget(
      world, entities, e, dt,
      detectSq, scanCd,
      canBeMonsterTarget,
    );
  }

  // Prefer player only if player is closer than current target
  if (player?.alive && !hasAIFlag(e, 'lightFollower') && !(zombieApocalypse && target?.type === EntityType.NPC)) {
    const pd2 = world.dist2(e.x, e.y, player.x, player.y);
    const documentPressure = isDocumentPressureHunter(e);
    const fallbackRangeSq = documentPressure ? documentFallbackSq(e) : PECHATEED_FALLBACK_SQ;
    const playerHasDocs = documentPressure && hasDocumentLikeItem(player);
    const targetHasDocs = documentPressure && target !== null ? hasDocumentLikeItem(target) : false;
    const meatWormAllowed = !hasAIFlag(e, 'meatWorm') || canOlgoyTarget(world, e, player);
    const garbageFoodPressure = hasAIFlag(e, 'garbageSurround') && pomoynyRoyScentScore(player) > 0.2;
    const playerAllowed = (!documentPressure ||
      playerHasDocs ||
      (!targetHasDocs && pd2 < fallbackRangeSq)) &&
      meatWormAllowed &&
      (e.monsterKind !== MonsterKind.CHERNOSLIZ || chernoslizCanTarget(world, e, player));
    if (playerAllowed && garbageFoodPressure && pd2 < detectSq) {
      target = player;
      ai.combatTargetId = player.id;
      ai.goal = AIGoal.HUNT;
    } else if (playerAllowed && target && target.id !== playerId) {
      const td2 = world.dist2(e.x, e.y, target.x, target.y);
      if (pd2 < td2 && pd2 < Math.min(PREFER_SQ, detectSq)) { target = player; ai.combatTargetId = player.id; ai.goal = AIGoal.HUNT; }
    } else if (playerAllowed && !target) {
      if (pd2 < detectSq) { target = player; ai.combatTargetId = player.id; ai.goal = AIGoal.HUNT; }
    }
  }

  updateGreenDogPackHowl(world, e, target, time, msgs, playerId, state);
  if (lishennyyLightTarget && followLishennyyLightTarget(world, e, lishennyyLightTarget, dt)) return;
  target = updateSobrannyyTarget(world, e, target, time, msgs, state);
  target = updateObzhivalshchikTarget(world, e, target, dt, time, msgs, state);
  updateNightmarePressure(world, e, target, dt, time, msgs, playerId, state);
  updateMukhozhukLeader(world, e, target, dt, time, msgs, state);
  if (updateBloodPlantRootHive(world, e, target, dt, time, msgs, playerId, state)) return;
  if (updateBorshchevikRootedPlant(world, e, target, dt, time, msgs, playerId, state)) return;
  updateProtokolnikProtocolPressure(world, e, target, dt, time, msgs, playerId, state);
  if (target && !target.alive) return;
  updateWallTerrainReadability(world, e, target, time, msgs, state);
  if (updateZhornayaTvar(world, entities, e, target, dt, time, msgs, playerId, nextId, state)) return;
  if (updateSlepoglaz(world, entities, e, target, dt, time, msgs, playerId, nextId, state)) return;
  if (updateTreskotnikFractureSprint(world, entities, e, target, dt, time, msgs, playerId, nextId, state)) return;
  if (target) updateVodyanoyWaterPressureLine(world, e, target, dt, time, msgs, playerId, state);
  updatePomoynyRoyReadability(world, e, target, time, msgs, playerId, state);

  if (!hasAIFlag(e, 'scentOvercommit') && tryFollowMonsterBait(world, e, target, dt, time, msgs, state)) return;
  if (tryConsumeMeatChunk(world, entities, e, target, dt, time, msgs, state)) return;

  if (!target) {
    cancelLozhnyyDukhFalsePhase(e);
    if (e.monsterKind === MonsterKind.TUMANNIK) clearTumannikFogOffset(e);
    if (e.monsterKind === MonsterKind.OBZHIVALSHCHIK) {
      const room = obzhivalshchikHomeRoom(world, e);
      if (room && idleObzhivalshchikInRoom(world, e, room, dt, time)) return;
    }
    if (e.monsterKind === MonsterKind.SOBRANNYY) {
      const runtime = sobrannyyState(e);
      if (runtime.dormant || runtime.isolatedUntil > time) return;
    }
    if (tryMukhozhukFoodAppetite(world, e, dt, time, msgs, state)) return;
    if (e.monsterKind === MonsterKind.CHERNOSLIZ && isChernoSlizHidden(world, e, player)) {
      const revealedByNoise = tryRevealChernoSlizByNoise(world, e, time, msgs, state);
      if (revealedByNoise) {
        if (tryFollowNoise(world, e, dt, time, state)) return;
      } else if (tryFollowNoise(world, e, dt, time, state)) {
        return;
      }
      if (isChernoSlizHidden(world, e, player)) {
        e.spriteScale = 0.58;
        return;
      }
    }
    if (tryFollowNoise(world, e, dt, time, state)) return;
    const tuning = bladeEliteTuning(e.monsterKind);
    if (tuning && ai.lastSeenTargetId === playerId) {
      publishBladeEliteEscape(tuning, world, e, player, playerId, state, 'lost_target');
    }
    // Immobile monsters (Idol) just idle — no wandering
    if (def?.speed === 0) return;
    ai.goal = AIGoal.WANDER;
    ai.combatTargetId = undefined;
    ai.timer -= dt;
    if (ai.path.length === 0 || ai.pi >= ai.path.length || ai.timer <= 0) {
      // Phasing monsters: random direction wander
      if (e.phasing) {
        ai.timer = 2 + Math.random() * 3;
        ai.wanderAngle = Math.random() * Math.PI * 2;
      } else {
        wanderNearby(world, e);
      }
      ai.timer = 1.5 + Math.random() * 2.5;
    }
    if (e.phasing) {
      const a = ai.wanderAngle ?? 0;
      const spd = e.speed * 0.4 * dt;
      e.x = ((e.x + Math.cos(a) * spd) % W + W) % W;
      e.y = ((e.y + Math.sin(a) * spd) % W + W) % W;
    } else {
      followMonsterPath(world, e, dt);
    }
    return;
  }
  ai.combatTargetId = target.id;
  ai.goal = AIGoal.HUNT;

  const bestDist = Math.sqrt(world.dist2(e.x, e.y, target.x, target.y));
  updateNelyudCloseReveal(world, e, target, time, msgs, state);
  updateSborkaReadability(world, e, target, time, msgs, playerId, state);
  updateLampPoweredReadability(world, e, target, time, msgs, playerId, state);
  updateOlgoyReadability(world, e, target, time, msgs, playerId, state);
  updateDikiyMertvyakCrowdShove(world, e, target, dt, time, msgs, playerId, state);
  if (updateLozhnyyDukhFalsePhase(world, e, target, dt, time, msgs, playerId, state)) return;

  if (e.monsterKind === MonsterKind.SOBRANNYY && trySobrannyyBreakWeakDoor(world, e, target, time, msgs, state)) return;

  if (bladeEliteTuning(e.monsterKind)) {
    updateBladeElite(world, entities, e, target, dt, time, msgs, playerId, nextId, state);
    return;
  }

  if (e.monsterKind === MonsterKind.GLUBINNAYA_TEN &&
      updateGlubinnayaTenSecondBeat(world, entities, e, target, bestDist, dt, time, msgs, playerId, nextId, state)) {
    return;
  }

  if (e.monsterKind === MonsterKind.TONKAYA_TEN &&
      updateTonkayaTenBaitLine(world, entities, e, target, dt, time, msgs, playerId, nextId, state)) {
    return;
  }

  if (e.monsterKind === MonsterKind.SHADOW &&
      updateShadowAmbushReadability(world, e, target, bestDist, dt, time, msgs, playerId, state)) {
    return;
  }

  if (updateTumannikFogOffset(world, entities, e, target, dt, time, msgs, playerId, nextId, state)) {
    return;
  }

  if (e.monsterKind === MonsterKind.FOG_SHARK) {
    updateFogSharkTurn(world, e, target, dt);
    updateFogSharkPack(world, e, target, time, msgs, playerId, state);
  }

  if (e.monsterKind === MonsterKind.LAMPOGLAZ && def) {
    updateLampoglazLightLock(world, entities, e, target, def, bestDist, dt, time, msgs, playerId, nextId, state);
    return;
  }

  // Ranged monsters telegraph, require a clear toroidal line of fire, and can be denied by cover.
  if (e.monsterKind === MonsterKind.TRUBNYY_AVTOMAT && def) {
    if (updateTrubnyyWetLineShot(world, entities, e, target, def, dt, time, msgs, playerId, nextId, state)) return;
  } else if (def?.isRanged && updateReadableMonsterRanged(world, entities, e, target, def, bestDist, dt, time, msgs, playerId, nextId, state)) return;

  // Immobile monsters don't pathfind or melee: once their line/source is denied, they are disabled until it opens again.
  if (def?.speed === 0) return;

  // Melee attack if close enough
  if (tryPerformMonsterMeleeAttack(world, entities, e, target, def, dt, time, msgs, playerId, nextId, bestDist, state)) {
    return;
  }

  // Hunt: pathfind to target
  ai.timer -= dt;
  if (ai.path.length === 0 || ai.timer <= 0) {
    const chase = e.monsterKind === MonsterKind.VODYANOY_KOSHMAR
      ? vodyanoyChaseCell(world, e, target)
      : e.monsterKind === MonsterKind.FOG_SHARK
        ? fogSharkChaseCell(world, e, target)
        : e.monsterKind === MonsterKind.MUKHOZHUK_HOST
          ? mukhozhukChaseCell(world, e, target)
          : greenDogChaseCell(world, e, target);
    tryAssignPathToCell(world, e, chase.x, chase.y);
    ai.timer = 2;
  }

  // Phasing monsters (Spirit) move directly through walls
  if (e.phasing) {
    const ddx = world.delta(e.x, target.x);
    const ddy = world.delta(e.y, target.y);
    const dd = Math.sqrt(ddx * ddx + ddy * ddy);
    if (dd > 0.1) {
      const spd = e.speed * dt;
      e.x = ((e.x + (ddx / dd) * spd) % W + W) % W;
      e.y = ((e.y + (ddy / dd) * spd) % W + W) % W;
    }
    return;
  }

  followMonsterPath(world, e, dt, target);
}
