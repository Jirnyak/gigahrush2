/* ── Monster shared types & registry ──────────────────────────── */

import { FloorLevel, MonsterKind, type ProjType } from '../core/types';

export type MonsterAIFlag =
  | 'wallBias'
  | 'weakWallBreach'
  | 'debrisLurker'
  | 'lampPowered'
  | 'lightLock'
  | 'documentHunter'
  | 'documentScent'
  | 'waterStrider'
  | 'drainArmor'
  | 'waterPressureLine'
  | 'rangedClause'
  | 'closeReveal'
  | 'foodBait'
  | 'wallBrace'
  | 'fogOffset'
  | 'scentOvercommit'
  | 'garbageSurround'
  | 'sourceSwarm'
  | 'slimeScavenger'
  | 'slimeStrider'
  | 'meatGrowth'
  | 'blackWaterWake'
  | 'rootedPlant'
  | 'roomBoundAberration'
  | 'lastSoundBeam'
  | 'meatWorm'
  | 'scrapWake'
  | 'baitLine'
  | 'secondBeat'
  | 'officeField'
  | 'hostParasite'
  | 'protocolPressure'
  | 'crowdShove'
  | 'netPossessor'
  | 'deadEcho'
  | 'falsePatrol'
  | 'defensiveNeutral'
  | 'webSpitter'
  | 'falsePhase'
  | 'flying'
  | 'noclip'
  | 'wetLineShot'
  | 'packHowl'
  | 'noiseFear'
  | 'fogSwimmer'
  | 'parasiteLeader'
  | 'rootHive'
  | 'fractureSprint'
  | 'lurkingFurniture'
  | 'weepingAngel'
  | 'lightFollower';

export interface MonsterDef {
  radius?: number;
  kind: MonsterKind;
  name: string;
  hp: number;
  speed: number;
  dmg: number;
  attackRate: number;
  sprite: number;
  isRanged?: boolean;       // shoots projectiles instead of melee
  projSpeed?: number;       // projectile speed (cells/sec)
  projSprite?: number;      // projectile sprite index
  projType?: ProjType;      // projectile behavior tag
  aiFlags?: readonly MonsterAIFlag[];
  floors?: readonly FloorLevel[];
  counterplay?: string;
  lootHint?: string;
  boss?: MonsterBossReadability;
}

export interface MonsterBossPhaseCue {
  hpPct: number;
  tag: string;
  line: string;
}

export interface MonsterBossReadability {
  warningLine: string;
  windupLine: string;
  interruptLine: string;
  deathCause: string;
  counterplay: string;
  windupSec: number;
  range: number;
  minRange: number;
  phases: readonly MonsterBossPhaseCue[];
}

// Import all monsters
import { DEF as SBORKA_DEF, generateSprite as genSborka } from './sborka';
import { DEF as TVAR_DEF, generateSprite as genTvar } from './tvar';
import { DEF as POLZUN_DEF, generateSprite as genPolzun } from './polzun';
import { DEF as BETONNIK_DEF, generateSprite as genBetonnik } from './betonnik';
import { DEF as BETONOED_DEF, generateSprite as genBetonoed } from './betonoed';
import { DEF as ZOMBIE_DEF, generateSprite as genZombie } from './zombie';
import { DEF as EYE_DEF, generateSprite as genEye, generateBoltSprite as genEyeBolt } from './eye';
import { DEF as NIGHTMARE_DEF, generateSprite as genNightmare } from './nightmare';
import { DEF as SHADOW_DEF, generateSprite as genShadow } from './shadow';
import { DEF as TONKAYA_TEN_DEF, generateSprite as genTonkayaTen } from './tonkaya_ten';
import { DEF as GLUBINNAYA_TEN_DEF, generateSprite as genGlubinnayaTen } from './glubinnaya_ten';
import { DEF as REBAR_DEF, generateSprite as genRebar } from './rebar';
import { DEF as MATKA_DEF, generateSprite as genMatka } from './matka';
import { DEF as KHOROVAYA_MATKA_DEF, generateSprite as genKhorovayaMatka } from './khorovaya_matka';
import { DEF as IDOL_DEF, generateSprite as genIdol } from './idol';
import { DEF as KANTSELYARSKIY_IDOL_DEF, generateSprite as genKantselyarskiyIdol } from './kantselyarskiy_idol';
import { DEF as MANCOBUS_DEF, generateSprite as genMancobus } from './mancobus';
import { DEF as HERALD_DEF, generateSprite as genHerald } from './herald';
import { DEF as CREATOR_DEF, generateSprite as genCreator } from './creator';
import { DEF as SPIRIT_DEF, generateSprite as genSpirit } from './spirit';
import { DEF as ROBOT_DEF, generateSprite as genRobot } from './robot';
import { DEF as SHOVNIK_DEF, generateSprite as genShovnik } from './shovnik';
import { DEF as LAMPOVY_DEF, generateSprite as genLampovy } from './lampovy';
import { DEF as LAMPOGLAZ_DEF, generateSprite as genLampoglaz } from './lampoglaz';
import { DEF as PECHATEED_DEF, generateSprite as genPechateed } from './pechateed';
import { DEF as KONTORSHCHIK_DEF, generateSprite as genKontorshchik } from './kontorshchik';
import { DEF as TUBE_EEL_DEF, generateSprite as genTubeEel } from './tube_eel';
import { DEF as LOTOCHNIK_DEF, generateSprite as genLotochnik } from './lotochnik';
import { DEF as PARAGRAPH_DEF, generateSprite as genParagraph } from './paragraph';
import { DEF as NELYUD_DEF, generateSprite as genNelyud } from './nelyud';
import { DEF as KRYSNOZHKA_DEF, generateSprite as genKrysnozhka } from './krysnozhka';
import { DEF as POMOYNY_ROY_DEF, generateSprite as genPomoynyRoy } from './pomoynyy_roy';
import { DEF as KOSTOREZ_DEF, generateSprite as genKostorez } from './kostorez';
import { DEF as SAFEGUARD_DEF, generateSprite as genSafeguard } from './safeguard';
import { DEF as BLACK_LIQUIDATOR_DEF, generateSprite as genBlackLiquidator } from './black_liquidator';
import { DEF as PANELNIK_DEF, generateSprite as genPanelnik } from './panelnik';
import { DEF as SLIMEVIK_DEF, generateSprite as genSlimevik } from './slimevik';
import { DEF as SOBRANNYY_DEF, generateSprite as genSobrannyy } from './sobrannyy';
import { DEF as CHERNOSLIZ_DEF, generateSprite as genChernosliz } from './chernosliz';
import { DEF as BORSHCHEVIK_DEF, generateSprite as genBorshchevik } from './borshchevik';
import { DEF as ZHORNAYA_TVAR_DEF, generateSprite as genZhornayaTvar } from './zhornaya_tvar';
import { DEF as TUMANNIK_DEF, generateSprite as genTumannik } from './tumannik';
import { DEF as SLEPOGLAZ_DEF, generateSprite as genSlepoglaz } from './slepoglaz';
import { DEF as PSEUDOLIFT_DEF, generateSprite as genPseudolift } from './pseudolift';
import { DEF as OLGOY_DEF, generateSprite as genOlgoy } from './olgoy';
import { DEF as VODYANOY_KOSHMAR_DEF, generateSprite as genVodyanoyKoshmar } from './vodyanoy_koshmar';
import { DEF as DIKIY_MERTVYAK_DEF, generateSprite as genDikiyMertvyak } from './dikiy_mertvyak';
import { DEF as OBZHIVALSHCHIK_DEF, generateSprite as genObzhivalshchik } from './obzhivalshchik';
import { DEF as RZHAVNIK_DEF, generateSprite as genRzhavnik } from './rzhavnik';
import { DEF as ZAKALENNAYA_ARMATURA_DEF, generateSprite as genZakalennayaArmatura } from './zakalennaya_armatura';
import { DEF as PROTOKOLNIK_DEF, generateSprite as genProtokolnik } from './protokolnik';
import { DEF as BEZEKHIY_DEF, generateSprite as genBezekhiy } from './bezekhiy';
import { DEF as TRUBNYY_AVTOMAT_DEF, generateSprite as genTrubnyyAvtomat } from './trubnyy_avtomat';
import { DEF as LOZHNYY_DUKH_DEF, generateSprite as genLozhnyyDukh } from './lozhnyy_dukh';
import { DEF as TRESKOTNIK_DEF, generateSprite as genTreskotnik } from './treskotnik';
import { DEF as GREEN_DOG_DEF, generateSprite as genGreenDog } from './green_dog';
import { DEF as SLIME_WOMAN_DEF, generateSprite as genSlimeWoman } from './slime_woman';
import { DEF as GNILUSHKA_DEF, generateSprite as genGnilushka } from './gnilushka';
import { DEF as PAUPSINA_DEF, generateSprite as genPaupsina } from './paupsina';
import { DEF as HEAD_SLUG_DEF, generateSprite as genHeadSlug } from './head_slug';
import { DEF as CHERVIE_AVATAR_DEF, generateSprite as genChervieAvatar } from './chervie_avatar';
import { DEF as MUKHOZHUK_HOST_DEF, generateSprite as genMukhozhukHost } from './mukhozhuk';
import { DEF as FOG_SHARK_DEF, generateSprite as genFogShark } from './fog_shark';
import { DEF as BLOOD_PLANT_DEF, generateSprite as genBloodPlant } from './blood_plant';
import { DEF as SPORE_CARPET_DEF, generateSprite as genSporeCarpet } from './spore_carpet';
import { DEF as SWARM_DEF, generateSprite as genSwarm } from './swarm_mass';
import { DEF as LISHENNYY_DEF, generateSprite as genLishennyy } from './lishennyy';
import { DEF as SCULPTURE_DEF, generateSprite as genSculpture } from './sculpture';
import { DEF as GNOME_DEF, generateSprite as genGnome } from './gnome';

export const MONSTERS: Record<MonsterKind, MonsterDef> = {
  [MonsterKind.SBORKA]:    SBORKA_DEF,
  [MonsterKind.TVAR]:      TVAR_DEF,
  [MonsterKind.POLZUN]:    POLZUN_DEF,
  [MonsterKind.BETONNIK]:  BETONNIK_DEF,
  [MonsterKind.BETONOED]:  BETONOED_DEF,
  [MonsterKind.ZOMBIE]:    ZOMBIE_DEF,
  [MonsterKind.EYE]:       EYE_DEF,
  [MonsterKind.NIGHTMARE]: NIGHTMARE_DEF,
  [MonsterKind.SHADOW]:    SHADOW_DEF,
  [MonsterKind.TONKAYA_TEN]: TONKAYA_TEN_DEF,
  [MonsterKind.GLUBINNAYA_TEN]: GLUBINNAYA_TEN_DEF,
  [MonsterKind.REBAR]:     REBAR_DEF,
  [MonsterKind.MATKA]:     MATKA_DEF,
  [MonsterKind.KHOROVAYA_MATKA]: KHOROVAYA_MATKA_DEF,
  [MonsterKind.IDOL]:      IDOL_DEF,
  [MonsterKind.KANTSELYARSKIY_IDOL]: KANTSELYARSKIY_IDOL_DEF,
  [MonsterKind.MANCOBUS]:  MANCOBUS_DEF,
  [MonsterKind.HERALD]:    HERALD_DEF,
  [MonsterKind.CREATOR]:   CREATOR_DEF,
  [MonsterKind.SPIRIT]:    SPIRIT_DEF,
  [MonsterKind.ROBOT]:     ROBOT_DEF,
  [MonsterKind.SHOVNIK]:   SHOVNIK_DEF,
  [MonsterKind.LAMPOVY]:   LAMPOVY_DEF,
  [MonsterKind.LAMPOGLAZ]: LAMPOGLAZ_DEF,
  [MonsterKind.PECHATEED]: PECHATEED_DEF,
  [MonsterKind.KONTORSHCHIK]: KONTORSHCHIK_DEF,
  [MonsterKind.TUBE_EEL]:  TUBE_EEL_DEF,
  [MonsterKind.LOTOCHNIK]: LOTOCHNIK_DEF,
  [MonsterKind.PARAGRAPH]: PARAGRAPH_DEF,
  [MonsterKind.NELYUD]:    NELYUD_DEF,
  [MonsterKind.KRYSNOZHKA]: KRYSNOZHKA_DEF,
  [MonsterKind.POMOYNY_ROY]: POMOYNY_ROY_DEF,
  [MonsterKind.KOSTOREZ]:  KOSTOREZ_DEF,
  [MonsterKind.SAFEGUARD]: SAFEGUARD_DEF,
  [MonsterKind.BLACK_LIQUIDATOR]: BLACK_LIQUIDATOR_DEF,
  [MonsterKind.PANELNIK]:  PANELNIK_DEF,
  [MonsterKind.PAUPSINA]:  PAUPSINA_DEF,
  [MonsterKind.SLIMEVIK]:  SLIMEVIK_DEF,
  [MonsterKind.SOBRANNYY]: SOBRANNYY_DEF,
  [MonsterKind.BORSHCHEVIK]: BORSHCHEVIK_DEF,
  [MonsterKind.ZHORNAYA_TVAR]: ZHORNAYA_TVAR_DEF,
  [MonsterKind.TUMANNIK]:  TUMANNIK_DEF,
  [MonsterKind.SLEPOGLAZ]: SLEPOGLAZ_DEF,
  [MonsterKind.OBZHIVALSHCHIK]: OBZHIVALSHCHIK_DEF,
  [MonsterKind.HEAD_SLUG]: HEAD_SLUG_DEF,
  [MonsterKind.PSEUDOLIFT]: PSEUDOLIFT_DEF,
  [MonsterKind.CHERNOSLIZ]: CHERNOSLIZ_DEF,
  [MonsterKind.OLGOY]:     OLGOY_DEF,
  [MonsterKind.VODYANOY_KOSHMAR]: VODYANOY_KOSHMAR_DEF,
  [MonsterKind.ZAKALENNAYA_ARMATURA]: ZAKALENNAYA_ARMATURA_DEF,
  [MonsterKind.RZHAVNIK]:  RZHAVNIK_DEF,
  [MonsterKind.DIKIY_MERTVYAK]: DIKIY_MERTVYAK_DEF,
  [MonsterKind.PROTOKOLNIK]: PROTOKOLNIK_DEF,
  [MonsterKind.TRUBNYY_AVTOMAT]: TRUBNYY_AVTOMAT_DEF,
  [MonsterKind.BEZEKHIY]:  BEZEKHIY_DEF,
  [MonsterKind.LOZHNYY_DUKH]: LOZHNYY_DUKH_DEF,
  [MonsterKind.CHERVIE_AVATAR]: CHERVIE_AVATAR_DEF,
  [MonsterKind.TRESKOTNIK]: TRESKOTNIK_DEF,
  [MonsterKind.GREEN_DOG]: GREEN_DOG_DEF,
  [MonsterKind.SLIME_WOMAN]: SLIME_WOMAN_DEF,
  [MonsterKind.GNILUSHKA]: GNILUSHKA_DEF,
  [MonsterKind.MUKHOZHUK_HOST]: MUKHOZHUK_HOST_DEF,
  [MonsterKind.FOG_SHARK]: FOG_SHARK_DEF,
  [MonsterKind.BLOOD_PLANT]: BLOOD_PLANT_DEF,
  [MonsterKind.SWARM]: SWARM_DEF,
  [MonsterKind.SPORE_CARPET]: SPORE_CARPET_DEF,
  [MonsterKind.LISHENNYY]: LISHENNYY_DEF,
  [MonsterKind.SCULPTURE]: SCULPTURE_DEF,
  [MonsterKind.GNOME]:     GNOME_DEF,
};

export const MONSTER_SPRITES: Record<MonsterKind, () => Uint32Array> = {
  [MonsterKind.SBORKA]:    genSborka,
  [MonsterKind.TVAR]:      genTvar,
  [MonsterKind.POLZUN]:    genPolzun,
  [MonsterKind.BETONNIK]:  genBetonnik,
  [MonsterKind.BETONOED]:  genBetonoed,
  [MonsterKind.ZOMBIE]:    genZombie,
  [MonsterKind.EYE]:       genEye,
  [MonsterKind.NIGHTMARE]: genNightmare,
  [MonsterKind.SHADOW]:    genShadow,
  [MonsterKind.TONKAYA_TEN]: genTonkayaTen,
  [MonsterKind.GLUBINNAYA_TEN]: genGlubinnayaTen,
  [MonsterKind.REBAR]:     genRebar,
  [MonsterKind.MATKA]:     genMatka,
  [MonsterKind.KHOROVAYA_MATKA]: genKhorovayaMatka,
  [MonsterKind.IDOL]:      genIdol,
  [MonsterKind.KANTSELYARSKIY_IDOL]: genKantselyarskiyIdol,
  [MonsterKind.MANCOBUS]:  genMancobus,
  [MonsterKind.HERALD]:    genHerald,
  [MonsterKind.CREATOR]:   genCreator,
  [MonsterKind.SPIRIT]:    genSpirit,
  [MonsterKind.ROBOT]:     genRobot,
  [MonsterKind.SHOVNIK]:   genShovnik,
  [MonsterKind.LAMPOVY]:   genLampovy,
  [MonsterKind.LAMPOGLAZ]: genLampoglaz,
  [MonsterKind.PECHATEED]: genPechateed,
  [MonsterKind.KONTORSHCHIK]: genKontorshchik,
  [MonsterKind.TUBE_EEL]:  genTubeEel,
  [MonsterKind.LOTOCHNIK]: genLotochnik,
  [MonsterKind.PARAGRAPH]: genParagraph,
  [MonsterKind.NELYUD]:    genNelyud,
  [MonsterKind.KRYSNOZHKA]: genKrysnozhka,
  [MonsterKind.POMOYNY_ROY]: genPomoynyRoy,
  [MonsterKind.KOSTOREZ]:  genKostorez,
  [MonsterKind.SAFEGUARD]: genSafeguard,
  [MonsterKind.BLACK_LIQUIDATOR]: genBlackLiquidator,
  [MonsterKind.PANELNIK]:  genPanelnik,
  [MonsterKind.PAUPSINA]:  genPaupsina,
  [MonsterKind.SLIMEVIK]:  genSlimevik,
  [MonsterKind.SOBRANNYY]: genSobrannyy,
  [MonsterKind.BORSHCHEVIK]: genBorshchevik,
  [MonsterKind.ZHORNAYA_TVAR]: genZhornayaTvar,
  [MonsterKind.TUMANNIK]:  genTumannik,
  [MonsterKind.SLEPOGLAZ]: genSlepoglaz,
  [MonsterKind.CHERNOSLIZ]: genChernosliz,
  [MonsterKind.OBZHIVALSHCHIK]: genObzhivalshchik,
  [MonsterKind.HEAD_SLUG]: genHeadSlug,
  [MonsterKind.OLGOY]:     genOlgoy,
  [MonsterKind.VODYANOY_KOSHMAR]: genVodyanoyKoshmar,
  [MonsterKind.PSEUDOLIFT]: genPseudolift,
  [MonsterKind.ZAKALENNAYA_ARMATURA]: genZakalennayaArmatura,
  [MonsterKind.RZHAVNIK]:  genRzhavnik,
  [MonsterKind.DIKIY_MERTVYAK]: genDikiyMertvyak,
  [MonsterKind.PROTOKOLNIK]: genProtokolnik,
  [MonsterKind.TRUBNYY_AVTOMAT]: genTrubnyyAvtomat,
  [MonsterKind.BEZEKHIY]:  genBezekhiy,
  [MonsterKind.LOZHNYY_DUKH]: genLozhnyyDukh,
  [MonsterKind.CHERVIE_AVATAR]: genChervieAvatar,
  [MonsterKind.TRESKOTNIK]: genTreskotnik,
  [MonsterKind.GREEN_DOG]: genGreenDog,
  [MonsterKind.SLIME_WOMAN]: genSlimeWoman,
  [MonsterKind.GNILUSHKA]: genGnilushka,
  [MonsterKind.MUKHOZHUK_HOST]: genMukhozhukHost,
  [MonsterKind.FOG_SHARK]: genFogShark,
  [MonsterKind.BLOOD_PLANT]: genBloodPlant,
  [MonsterKind.SWARM]: genSwarm,
  [MonsterKind.SPORE_CARPET]: genSporeCarpet,
  [MonsterKind.LISHENNYY]: genLishennyy,
  [MonsterKind.SCULPTURE]: genSculpture,
  [MonsterKind.GNOME]:     genGnome,
};

export const EYE_BOLT_SPRITE: () => Uint32Array = genEyeBolt;

export const NEW_MONSTER_KINDS: readonly MonsterKind[] = [
  MonsterKind.SHOVNIK,
  MonsterKind.LAMPOVY,
  MonsterKind.LAMPOGLAZ,
  MonsterKind.PECHATEED,
  MonsterKind.KONTORSHCHIK,
  MonsterKind.TUBE_EEL,
  MonsterKind.LOTOCHNIK,
  MonsterKind.PARAGRAPH,
  MonsterKind.NELYUD,
  MonsterKind.KRYSNOZHKA,
  MonsterKind.POMOYNY_ROY,
  MonsterKind.KOSTOREZ,
  MonsterKind.SAFEGUARD,
  MonsterKind.BLACK_LIQUIDATOR,
  MonsterKind.PANELNIK,
  MonsterKind.PAUPSINA,
  MonsterKind.KHOROVAYA_MATKA,
  MonsterKind.SLIMEVIK,
  MonsterKind.SOBRANNYY,
  MonsterKind.BORSHCHEVIK,
  MonsterKind.TONKAYA_TEN,
  MonsterKind.GLUBINNAYA_TEN,
  MonsterKind.ZHORNAYA_TVAR,
  MonsterKind.TUMANNIK,
  MonsterKind.SLEPOGLAZ,
  MonsterKind.BETONOED,
  MonsterKind.CHERNOSLIZ,
  MonsterKind.OBZHIVALSHCHIK,
  MonsterKind.HEAD_SLUG,
  MonsterKind.OLGOY,
  MonsterKind.KANTSELYARSKIY_IDOL,
  MonsterKind.VODYANOY_KOSHMAR,
  MonsterKind.PSEUDOLIFT,
  MonsterKind.ZAKALENNAYA_ARMATURA,
  MonsterKind.RZHAVNIK,
  MonsterKind.DIKIY_MERTVYAK,
  MonsterKind.PROTOKOLNIK,
  MonsterKind.TRUBNYY_AVTOMAT,
  MonsterKind.BEZEKHIY,
  MonsterKind.LOZHNYY_DUKH,
  MonsterKind.CHERVIE_AVATAR,
  MonsterKind.TRESKOTNIK,
  MonsterKind.GREEN_DOG,
  MonsterKind.SLIME_WOMAN,
  MonsterKind.GNILUSHKA,
  MonsterKind.MUKHOZHUK_HOST,
  MonsterKind.FOG_SHARK,
  MonsterKind.BLOOD_PLANT,
  MonsterKind.SWARM,
  MonsterKind.SPORE_CARPET,
  MonsterKind.LISHENNYY,
  MonsterKind.GNOME,
];

export const NEW_MONSTERS_BY_FLOOR: Record<FloorLevel, readonly MonsterKind[]> = {
  [FloorLevel.MINISTRY]: [MonsterKind.SHOVNIK, MonsterKind.LAMPOVY, MonsterKind.LAMPOGLAZ, MonsterKind.PECHATEED, MonsterKind.KONTORSHCHIK, MonsterKind.PARAGRAPH, MonsterKind.NELYUD, MonsterKind.BLACK_LIQUIDATOR, MonsterKind.KANTSELYARSKIY_IDOL, MonsterKind.TONKAYA_TEN, MonsterKind.PROTOKOLNIK, MonsterKind.HEAD_SLUG, MonsterKind.BEZEKHIY, MonsterKind.LOZHNYY_DUKH, MonsterKind.CHERVIE_AVATAR, MonsterKind.MUKHOZHUK_HOST, MonsterKind.SPORE_CARPET],
  [FloorLevel.KVARTIRY]: [MonsterKind.SHOVNIK, MonsterKind.LAMPOVY, MonsterKind.PECHATEED, MonsterKind.NELYUD, MonsterKind.KRYSNOZHKA, MonsterKind.GNOME, MonsterKind.POMOYNY_ROY, MonsterKind.GREEN_DOG, MonsterKind.BLACK_LIQUIDATOR, MonsterKind.PANELNIK, MonsterKind.PAUPSINA, MonsterKind.ZHORNAYA_TVAR, MonsterKind.DIKIY_MERTVYAK, MonsterKind.OBZHIVALSHCHIK, MonsterKind.HEAD_SLUG, MonsterKind.BEZEKHIY, MonsterKind.TRESKOTNIK, MonsterKind.GNILUSHKA, MonsterKind.SPORE_CARPET],
  [FloorLevel.LIVING]: [MonsterKind.SHOVNIK, MonsterKind.LAMPOVY, MonsterKind.LAMPOGLAZ, MonsterKind.PECHATEED, MonsterKind.KONTORSHCHIK, MonsterKind.LOTOCHNIK, MonsterKind.NELYUD, MonsterKind.KRYSNOZHKA, MonsterKind.GNOME, MonsterKind.POMOYNY_ROY, MonsterKind.GREEN_DOG, MonsterKind.BLACK_LIQUIDATOR, MonsterKind.PANELNIK, MonsterKind.PAUPSINA, MonsterKind.SLIMEVIK, MonsterKind.SLIME_WOMAN, MonsterKind.SOBRANNYY, MonsterKind.BORSHCHEVIK, MonsterKind.TONKAYA_TEN, MonsterKind.RZHAVNIK, MonsterKind.ZHORNAYA_TVAR, MonsterKind.TUMANNIK, MonsterKind.PSEUDOLIFT, MonsterKind.DIKIY_MERTVYAK, MonsterKind.OBZHIVALSHCHIK, MonsterKind.HEAD_SLUG, MonsterKind.BEZEKHIY, MonsterKind.LOZHNYY_DUKH, MonsterKind.TRESKOTNIK, MonsterKind.GNILUSHKA, MonsterKind.FOG_SHARK, MonsterKind.BLOOD_PLANT, MonsterKind.SPORE_CARPET],
  [FloorLevel.MAINTENANCE]: [MonsterKind.LAMPOVY, MonsterKind.TUBE_EEL, MonsterKind.LOTOCHNIK, MonsterKind.KRYSNOZHKA, MonsterKind.GNOME, MonsterKind.POMOYNY_ROY, MonsterKind.GREEN_DOG, MonsterKind.KOSTOREZ, MonsterKind.SAFEGUARD, MonsterKind.BETONOED, MonsterKind.PANELNIK, MonsterKind.PAUPSINA, MonsterKind.SLIMEVIK, MonsterKind.SLIME_WOMAN, MonsterKind.SOBRANNYY, MonsterKind.BORSHCHEVIK, MonsterKind.RZHAVNIK, MonsterKind.SLEPOGLAZ, MonsterKind.OLGOY, MonsterKind.CHERNOSLIZ, MonsterKind.VODYANOY_KOSHMAR, MonsterKind.PSEUDOLIFT, MonsterKind.ZAKALENNAYA_ARMATURA, MonsterKind.HEAD_SLUG, MonsterKind.TRUBNYY_AVTOMAT, MonsterKind.CHERVIE_AVATAR, MonsterKind.MUKHOZHUK_HOST, MonsterKind.FOG_SHARK, MonsterKind.BLOOD_PLANT, MonsterKind.SWARM, MonsterKind.SPORE_CARPET],
  [FloorLevel.HELL]: [MonsterKind.KOSTOREZ, MonsterKind.KHOROVAYA_MATKA, MonsterKind.SOBRANNYY, MonsterKind.ZHORNAYA_TVAR, MonsterKind.TUMANNIK, MonsterKind.SLEPOGLAZ, MonsterKind.OLGOY, MonsterKind.PSEUDOLIFT, MonsterKind.ZAKALENNAYA_ARMATURA, MonsterKind.TRESKOTNIK, MonsterKind.GLUBINNAYA_TEN, MonsterKind.FOG_SHARK, MonsterKind.BLOOD_PLANT, MonsterKind.SWARM, MonsterKind.LISHENNYY],
  [FloorLevel.VOID]: [MonsterKind.PARAGRAPH, MonsterKind.SAFEGUARD, MonsterKind.TONKAYA_TEN, MonsterKind.LOZHNYY_DUKH, MonsterKind.CHERVIE_AVATAR, MonsterKind.GLUBINNAYA_TEN, MonsterKind.LISHENNYY],
};

/** Get generic type name for a monster kind (e.g. "Бетонник", "Тварь") */
export function monsterTypeName(kind: MonsterKind | undefined): string {
  if (kind === undefined) return 'Монстр';
  return MONSTERS[kind]?.name ?? 'Монстр';
}

/** Display name: NPC uses e.name, monsters use generic type name */
export function entityDisplayName(e: { name?: string; monsterKind?: MonsterKind }): string {
  if (e.name) return e.name;
  if (e.monsterKind !== undefined) return monsterTypeName(e.monsterKind);
  return 'Цель';
}
