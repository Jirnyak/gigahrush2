/* ── Maintenance content manifest ───────────────────────────────
 * Additive rooms/NPCs live behind this seam to keep index.ts stable.
 */

import { type Entity } from '../../core/types';
import { World } from '../../core/world';
import { syncNextEntityId, withPoiGenerationMetadata } from '../content_manifest_utils';
import { generateForpost } from './forpost';
import { generateMancobusRoom } from './mancobus_room';
import { spawnMakhno } from './makhno';
import { spawnIvanych } from './sant_ivanych';
import { spawnRadistGleb } from './radist_gleb';
import { spawnDiverKot } from './diver_kot';
import { spawnGordonFreeman } from './gordon';
import { generateFloodedLab } from './flooded_lab';
import { generatePressureStation } from './pressure_station';
import { generateSteamValves } from './steam_valves';
import { generateDiverCache } from './diver_cache';
import { generateWatermeterPost } from './watermeter_post';
import { generateOverflowSluice } from './overflow_sluice';
import { generateHeatlineZero } from './heatline_zero';
import { generateMetroErrorLine } from './metro_error_line';
import { generateConcentratePress } from './concentrate_press';
import { generatePressovik } from './pressovik';
import { generateWaterBridge } from './water_bridge';
import { generateOlgoyMeatCache } from './olgoy_meat_cache';
import { generateVodyanoyKoshmarLine } from './vodyanoy_koshmar_line';
import { generateTrubnyyAvtomatLine } from './trubnyy_avtomat_line';
import { generateNasosnayaMatka } from './nasosnaya_matka';
import { generateLiftRepairShaft } from './lift_repair_shaft';
import { generateRemontnikBezSmeny } from './remontnik_bez_smeny';
import { generateChargeCage } from './charge_cage';
import { generateAutomationCage } from './automation_cage';
import { generateHladonets } from './hladonets';
import { generateKabelnik } from './kabelnik';
import { generateCollectorsPressureReroute } from './collectors_pressure_reroute';
import { generateDefectorLiquidator } from './defector_liquidator';
import { generateParitelSteamBridge } from './paritel_steam_bridge';
import { generateCultHeldWorkshop } from './cult_held_workshop';
import { generateSlimeSamplePost } from './slime_sample_post';
import { generateLiquidatorBaseArena } from './liquidatorbase';
import { generateBlueGlowSample } from './blue_glow_sample';
import { generateGreenAcidRoom } from './green_acid_room';
import { generateBrownSlimeCleanup } from './brown_slime_cleanup';
import { generateSafeSlimevikDen } from './safe_slimevik_den';
import { generateSlimeWomanSump } from './slime_woman_sump';
import { generateSlimeDeactivationFurnace } from './slime_deactivation_furnace';
import { generateSlimeSingingVents } from './slime_singing_vents';
import { generateVentshun } from './ventshun';
import { generateRedAdhesiveTrap } from './red_adhesive_trap';
import { generateBlackSlimeEyes } from './black_slime_eyes';
import { generateChernayaLichinka } from './chernaya_lichinka';
import { generateSeroburmalineNoLook } from './seroburmaline_no_look';
import { generatePneumomailStation } from './pneumomail_station';
import { generateBetonoedShortcut } from './betonoed_shortcut';
import { generateKostorezLocker } from './kostorez_locker';
import { generateSlepoglazLine } from './slepoglaz_line';
import { generateOstavshiysyaLikvidator } from './ostavshiysya_likvidator';
import { generateFiltronos } from './filtronos';
import { generateRzhavnikShelf } from './rzhavnik_shelf';
import { generateBorshchevikBlockade } from './borshchevik_blockade';
import { generateSwarmNest } from './swarm_nest';

export function runMaintenanceContent(
  world: World,
  entities: Entity[],
  nextId: number,
  spawnX: number,
  spawnY: number,
): number {
  generateForpost(world, world.rooms.length, entities, { v: nextId }, spawnX, spawnY);
  nextId = syncNextEntityId(entities, nextId);

  generateMancobusRoom(world, world.rooms.length, entities, { v: nextId }, spawnX, spawnY);
  nextId = syncNextEntityId(entities, nextId);

  spawnMakhno(world, entities, { v: nextId });
  nextId = syncNextEntityId(entities, nextId);

  generateFloodedLab(world, world.rooms.length, entities, { v: nextId }, spawnX, spawnY);
  nextId = syncNextEntityId(entities, nextId);

  spawnIvanych(world, entities, { v: nextId });
  nextId = syncNextEntityId(entities, nextId);

  spawnRadistGleb(world, entities, { v: nextId });
  nextId = syncNextEntityId(entities, nextId);

  spawnDiverKot(world, entities, { v: nextId });
  nextId = syncNextEntityId(entities, nextId);

  spawnGordonFreeman(world, entities, { v: nextId });
  nextId = syncNextEntityId(entities, nextId);

  withPoiGenerationMetadata(world, entities, {
    id: 'maint_pressure_station',
    floor: 'maintenance',
    debugLabel: 'Коллекторы: станция давления',
    decisionHooks: [
      { kind: 'quest', id: 'ag04_pressure_wrenches', label: 'принести ключи диспетчеру давления' },
      { kind: 'quest', id: 'ag04_pressure_rebar', label: 'убрать арматуру у насосов' },
      { kind: 'repair', id: 'pressure_valves_manual', label: 'выйти к коридору ручных вентилей' },
    ],
  }, () => generatePressureStation({ world, entities, nextId: { v: nextId }, spawnX, spawnY }));
  nextId = syncNextEntityId(entities, nextId);

  generateSteamValves({ world, entities, nextId: { v: nextId }, spawnX, spawnY });
  nextId = syncNextEntityId(entities, nextId);

  generateDiverCache({ world, entities, nextId: { v: nextId }, spawnX, spawnY });
  nextId = syncNextEntityId(entities, nextId);

  generateWatermeterPost({ world, entities, nextId: { v: nextId }, spawnX, spawnY });
  nextId = syncNextEntityId(entities, nextId);

  generateOverflowSluice({ world, entities, nextId: { v: nextId }, spawnX, spawnY });
  nextId = syncNextEntityId(entities, nextId);

  generateWaterBridge({ world, entities, nextId: { v: nextId }, spawnX, spawnY });
  nextId = syncNextEntityId(entities, nextId);

  withPoiGenerationMetadata(world, entities, {
    id: 'maint_olgoy_meat_cache',
    floor: 'maintenance',
    debugLabel: 'Коллекторы: мясной сборник Олгой-Хорхоя',
    decisionHooks: [
      { kind: 'flee', id: 'olgoy_dry_floor', label: 'увести Олгой-Хорхоя с воды на сухой пол' },
      { kind: 'steal', id: 'olgoy_meat_cache_loot', label: 'забрать мясной тайник без боя у трубы' },
      { kind: 'kill', id: 'olgoy_collector_worm', label: 'убить Олгой-Хорхоя вдали от лотка' },
    ],
  }, () => generateOlgoyMeatCache({ world, entities, nextId: { v: nextId }, spawnX, spawnY }));
  nextId = syncNextEntityId(entities, nextId);

  withPoiGenerationMetadata(world, entities, {
    id: 'maint_vodyanoy_koshmar_line',
    floor: 'maintenance',
    debugLabel: 'Коллекторы: насосная водяного кошмара',
    decisionHooks: [
      { kind: 'flee', id: 'vodyanoy_koshmar_dry_break', label: 'сойти с мокрой линии на сухой бетон' },
      { kind: 'kill', id: 'vodyanoy_koshmar_pressure_window', label: 'ударить во время спада давления' },
    ],
  }, () => generateVodyanoyKoshmarLine({ world, entities, nextId: { v: nextId }, spawnX, spawnY }));
  nextId = syncNextEntityId(entities, nextId);

  withPoiGenerationMetadata(world, entities, {
    id: 'maint_trubnyy_avtomat_line',
    floor: 'maintenance',
    debugLabel: 'Коллекторы: мокрая линия трубного автомата',
    decisionHooks: [
      { kind: 'kill', id: 'trubnyy_avtomat_wet_line', label: 'сойти с мокрой прямой и ударить на остывании' },
      { kind: 'steal', id: 'trubnyy_avtomat_energy_cell', label: 'забрать энергоячейки после выключения автомата' },
    ],
  }, () => generateTrubnyyAvtomatLine({ world, entities, nextId: { v: nextId }, spawnX, spawnY }));
  nextId = syncNextEntityId(entities, nextId);

  generateNasosnayaMatka({ world, entities, nextId: { v: nextId }, spawnX, spawnY });
  nextId = syncNextEntityId(entities, nextId);

  generateParitelSteamBridge({ world, entities, nextId: { v: nextId }, spawnX, spawnY });
  nextId = syncNextEntityId(entities, nextId);

  generateHeatlineZero({ world, entities, nextId: { v: nextId }, spawnX, spawnY });
  nextId = syncNextEntityId(entities, nextId);

  generateMetroErrorLine({ world, entities, nextId: { v: nextId }, spawnX, spawnY });
  nextId = syncNextEntityId(entities, nextId);

  generateConcentratePress({ world, entities, nextId: { v: nextId }, spawnX, spawnY });
  nextId = syncNextEntityId(entities, nextId);

  generatePressovik({ world, entities, nextId: { v: nextId }, spawnX, spawnY });
  nextId = syncNextEntityId(entities, nextId);

  generateLiftRepairShaft({ world, entities, nextId: { v: nextId }, spawnX, spawnY });
  nextId = syncNextEntityId(entities, nextId);

  generateRemontnikBezSmeny({ world, entities, nextId: { v: nextId }, spawnX, spawnY });
  nextId = syncNextEntityId(entities, nextId);

  generateChargeCage({ world, entities, nextId: { v: nextId }, spawnX, spawnY });
  nextId = syncNextEntityId(entities, nextId);

  generateBlueGlowSample({ world, entities, nextId: { v: nextId }, spawnX, spawnY });
  nextId = syncNextEntityId(entities, nextId);

  generateHladonets({ world, entities, nextId: { v: nextId }, spawnX, spawnY });
  nextId = syncNextEntityId(entities, nextId);

  generateAutomationCage({ world, entities, nextId: { v: nextId }, spawnX, spawnY });
  nextId = syncNextEntityId(entities, nextId);

  generateKabelnik({ world, entities, nextId: { v: nextId }, spawnX, spawnY });
  nextId = syncNextEntityId(entities, nextId);

  generateCollectorsPressureReroute({ world, entities, nextId: { v: nextId }, spawnX, spawnY });
  nextId = syncNextEntityId(entities, nextId);

  generateDefectorLiquidator({ world, entities, nextId: { v: nextId }, spawnX, spawnY });
  nextId = syncNextEntityId(entities, nextId);

  generateOstavshiysyaLikvidator({ world, entities, nextId: { v: nextId }, spawnX, spawnY });
  nextId = syncNextEntityId(entities, nextId);

  generateSlimeSamplePost({ world, entities, nextId: { v: nextId }, spawnX, spawnY });
  nextId = generateLiquidatorBaseArena(world, entities, nextId);
  nextId = syncNextEntityId(entities, nextId);

  generateSlimeSingingVents({ world, entities, nextId: { v: nextId }, spawnX, spawnY });
  nextId = syncNextEntityId(entities, nextId);

  generateVentshun({ world, entities, nextId: { v: nextId }, spawnX, spawnY });
  nextId = syncNextEntityId(entities, nextId);

  withPoiGenerationMetadata(world, entities, {
    id: 'maint_swarm_nest',
    floor: 'maintenance',
    debugLabel: 'Коллекторы: вентиляционная матка роя',
    decisionHooks: [
      { kind: 'repair', id: 'swarm_source_seal', label: 'заклеить источник роя изолентой или герметиком' },
      { kind: 'kill', id: 'swarm_source_burn', label: 'выжечь источник роя огнем' },
      { kind: 'flee', id: 'swarm_bodies_sprint', label: 'пробежать через короткоживущие тела без зачистки источника' },
    ],
  }, () => generateSwarmNest({ world, entities, nextId: { v: nextId }, spawnX, spawnY }));
  nextId = syncNextEntityId(entities, nextId);

  generateBrownSlimeCleanup({ world, entities, nextId: { v: nextId }, spawnX, spawnY });
  nextId = syncNextEntityId(entities, nextId);

  withPoiGenerationMetadata(world, entities, {
    id: 'safe_slimevik_den',
    floor: 'maintenance',
    debugLabel: 'Коллекторы: кормовая ванна слизневика',
    decisionHooks: [
      { kind: 'quest', id: 'exp_maint_safe_slimevik_bargain', label: 'найти безопасного слизневика и обменять корм на пробу' },
      { kind: 'trade', id: 'slimevik_bargain', label: 'дать еду или лекарство вместо убийства' },
      { kind: 'flee', id: 'slimevik_contact', label: 'держать дистанцию без фильтра и тары' },
    ],
  }, () => generateSafeSlimevikDen({ world, entities, nextId: { v: nextId }, spawnX, spawnY }));
  nextId = syncNextEntityId(entities, nextId);

  withPoiGenerationMetadata(world, entities, {
    id: 'slime_woman_sump',
    floor: 'maintenance',
    debugLabel: 'Коллекторы: жижевой отстойник НИИ',
    decisionHooks: [
      { kind: 'flee', id: 'slime_woman_dry_edge', label: 'уйти из воды на сухой освещенный край' },
      { kind: 'repair', id: 'slime_woman_residue_clean', label: 'счистить токсичную пленку после хватки' },
      { kind: 'quest', id: 'slime_woman_sample', label: 'взять зеленую пробу только в тару НИИ' },
    ],
  }, () => generateSlimeWomanSump({ world, entities, nextId: { v: nextId }, spawnX, spawnY }));
  nextId = syncNextEntityId(entities, nextId);

  generateGreenAcidRoom({ world, entities, nextId: { v: nextId }, spawnX, spawnY });
  nextId = syncNextEntityId(entities, nextId);

  generateSlimeDeactivationFurnace({ world, entities, nextId: { v: nextId }, spawnX, spawnY });
  nextId = syncNextEntityId(entities, nextId);

  generateRedAdhesiveTrap({ world, entities, nextId: { v: nextId }, spawnX, spawnY });
  nextId = syncNextEntityId(entities, nextId);

  generateCultHeldWorkshop({ world, entities, nextId: { v: nextId }, spawnX, spawnY });
  nextId = syncNextEntityId(entities, nextId);

  generateSeroburmalineNoLook({ world, entities, nextId: { v: nextId }, spawnX, spawnY });
  nextId = syncNextEntityId(entities, nextId);

  generatePneumomailStation({ world, entities, nextId: { v: nextId }, spawnX, spawnY });
  nextId = syncNextEntityId(entities, nextId);

  generateBlackSlimeEyes({ world, entities, nextId: { v: nextId }, spawnX, spawnY });
  nextId = syncNextEntityId(entities, nextId);

  generateChernayaLichinka({ world, entities, nextId: { v: nextId }, spawnX, spawnY });
  nextId = syncNextEntityId(entities, nextId);

  withPoiGenerationMetadata(world, entities, {
    id: 'maint_betonoed_shortcut',
    floor: 'maintenance',
    debugLabel: 'Коллекторы: слабая стена Бетоноеда',
    decisionHooks: [
      { kind: 'repair', id: 'betonoed_seal_weak_wall', label: 'запечатать шов герметиком или блок-комплектом' },
      { kind: 'flee', id: 'betonoed_noise_lure', label: 'увести Бетоноеда шумом от слабой стены' },
      { kind: 'kill', id: 'betonoed_fire_drive_off', label: 'сорвать прогрыз уроном или огнем' },
      { kind: 'reroute', id: 'betonoed_shortcut_used', label: 'рискнуть коротким ходом после прогрыза' },
    ],
  }, () => generateBetonoedShortcut({ world, entities, nextId: { v: nextId }, spawnX, spawnY }));
  nextId = syncNextEntityId(entities, nextId);

  withPoiGenerationMetadata(world, entities, {
    id: 'maint_borshchevik_blockade',
    floor: 'maintenance',
    debugLabel: 'Коллекторы: борщевик на сервисном обходе',
    decisionHooks: [
      { kind: 'kill', id: 'borshchevik_cut_path', label: 'рубить стебли и чистить сок без дыма' },
      { kind: 'flee', id: 'borshchevik_dry_bypass', label: 'обойти заросший коридор через сухой склад' },
      { kind: 'repair', id: 'borshchevik_fire_burnout', label: 'выжечь быстро и отойти от семенного дыма' },
    ],
  }, () => generateBorshchevikBlockade({ world, entities, nextId: { v: nextId }, spawnX, spawnY }));
  nextId = syncNextEntityId(entities, nextId);

  generateKostorezLocker({ world, entities, nextId: { v: nextId }, spawnX, spawnY });
  nextId = syncNextEntityId(entities, nextId);

  withPoiGenerationMetadata(world, entities, {
    id: 'maint_rzhavnik_shelf',
    floor: 'maintenance',
    debugLabel: 'Коллекторы: стеллаж ровного металла',
    decisionHooks: [
      { kind: 'kill', id: 'rzhavnik_first_leap', label: 'проверить ровные прутья издали и пережить первый рывок' },
      { kind: 'steal', id: 'rzhavnik_scrap_loot', label: 'быстро забрать металл с риском складской засады' },
      { kind: 'flee', id: 'rzhavnik_storage_route', label: 'обойти загроможденный стеллаж' },
    ],
  }, () => generateRzhavnikShelf({ world, entities, nextId: { v: nextId }, spawnX, spawnY }));
  nextId = syncNextEntityId(entities, nextId);

  withPoiGenerationMetadata(world, entities, {
    id: 'maint_slepoglaz_line',
    floor: 'maintenance',
    debugLabel: 'Коллекторы: коридор слепого прострела',
    decisionHooks: [
      { kind: 'flee', id: 'slepoglaz_sidesteps', label: 'шумнуть, уйти с линии и сблизиться после луча' },
      { kind: 'steal', id: 'slepoglaz_psi_dust', label: 'забрать ПСИ-пыль с прострелянной дорожки' },
    ],
  }, () => generateSlepoglazLine({ world, entities, nextId: { v: nextId }, spawnX, spawnY }));
  nextId = syncNextEntityId(entities, nextId);

  generateFiltronos({ world, entities, nextId: { v: nextId }, spawnX, spawnY });
  return syncNextEntityId(entities, nextId);
}
