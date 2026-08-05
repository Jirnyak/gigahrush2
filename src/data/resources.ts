import { ItemType, RoomType } from '../core/types';
import { ITEMS, SILVER_SLIME_OPENED_ID, SILVER_SLIME_SEALED_ID } from './items';
import { ECONOMY_PSI_WEAPON_IDS, ECONOMY_RARE_ENERGY_WEAPON_IDS } from './economics';
import {
  DOCUMENT_ACCESS_AMMO_RESOURCE_ITEM_IDS,
  DOCUMENT_ACCESS_CONTRABAND_ITEM_IDS,
  DOCUMENT_ACCESS_DOCUMENT_RESOURCE_ITEM_IDS,
  DOCUMENT_ACCESS_FUEL_RESOURCE_ITEM_IDS,
  DOCUMENT_ACCESS_PAPER_ITEM_IDS,
  DOCUMENT_ACCESS_SAMPLE_RESOURCE_ITEM_IDS,
} from './documents_access';

export interface ResourceDef {
  id: string;
  name: string;
  baseStock: number;
  lowStock: number;
  scarcityMax?: number;
  pricePressureMax?: number;
  rewardPressureMax?: number;
  roomTypes: RoomType[];
  itemIds: string[];
}

export const RESOURCES: ResourceDef[] = [
  { id: 'drink_water', name: 'Питьевая вода', baseStock: 120, lowStock: 35, scarcityMax: 2.7, pricePressureMax: 3.2, rewardPressureMax: 2.3, roomTypes: [RoomType.KITCHEN, RoomType.STORAGE, RoomType.MEDICAL], itemIds: ['water', 'tea', 'kompot', 'filtered_water', 'boiler_water', 'metal_water', 'instant_coffee', 'siren_energy', 'calm_brew', 'water_reservoir_sample', 'water_reservoir_quota'] },
  { id: 'food', name: 'Еда', baseStock: 140, lowStock: 40, scarcityMax: 2.6, pricePressureMax: 3.1, rewardPressureMax: 2.2, roomTypes: [RoomType.KITCHEN, RoomType.STORAGE], itemIds: ['bread', 'canned', 'kasha', 'rawmeat', 'mushroom_mass', 'infected_mushroom', 'grey_briquette', 'green_briquette', 'liquidator_ration', 'red_concentrate', 'experimental_concentrate', 'protein_mold_cake', 'pearl_barley', 'soup_cube', 'pressed_sugar', 'yeast_bread'] },
  { id: 'medicine', name: 'Медицина', baseStock: 70, lowStock: 20, scarcityMax: 2.9, pricePressureMax: 3.6, rewardPressureMax: 2.4, roomTypes: [RoomType.MEDICAL, RoomType.STORAGE], itemIds: ['bandage', 'pills', 'antidep', 'tourniquet', 'iodine', 'antibiotic', 'morphine_ampoule', 'psi_stabilizer', 'sanitary_kit', 'antifungal_ointment', 'anti_spore_inhaler', 'burn_gel', 'painkiller_pack', 'sleeping_pills', 'antiemetic', 'sterile_bandage', 'permanganate_vial', 'syringe_empty', 'cotton_wool', 'soap_72', 'lice_shampoo', 'body_bag_roll'] },
  { id: 'metal', name: 'Металл', baseStock: 95, lowStock: 25, roomTypes: [RoomType.PRODUCTION, RoomType.STORAGE], itemIds: ['pipe', 'wrench', 'rebar', 'hammer', 'crowbar', 'sledgehammer', 'rusty_rake', 'bayonet', 'rake_bayonet', 'liquidator_axe', 'conscripts_doublebarrel', 'tracked_zhernov', 'valve_tag', 'metal_sheet', 'gear', 'spring', 'barrel_part', 'magazine_part'] },
  { id: 'ammo', name: 'Боеприпасы', baseStock: 80, lowStock: 18, scarcityMax: 2.8, pricePressureMax: 3.5, rewardPressureMax: 2.3, roomTypes: [RoomType.STORAGE, RoomType.PRODUCTION, RoomType.HQ], itemIds: ['ammo_9mm', 'ammo_shells', 'ammo_12g_slug', 'ammo_12g_chemical', 'ammo_12g_incendiary', 'ammo_nails', 'ammo_762', 'ammo_belt', 'ammo_762tt', 'ammo_nagant', 'ammo_harpoon', 'rifle_bolt_pack', 'ammo_issue_order', 'black_market_shells', 'losyash_rifle', 'moskvin_rifle', 'ptrs_liquidator', 'granit4u_belt_shotgun', 'pushkin_shotgun', 'p41_heavy_mg', 'g41_grenade_launcher', 'foam_grenade_6p10', 'brt2_foam_projector', 'pbrog1_foam_launcher', ...DOCUMENT_ACCESS_AMMO_RESOURCE_ITEM_IDS] },
  { id: 'tools', name: 'Инструменты', baseStock: 55, lowStock: 12, roomTypes: [RoomType.PRODUCTION, RoomType.STORAGE], itemIds: ['flashlight', 'uv_spotlight', 'smoke_candle_check', 'door_kit', 'block_kit', 'cleaning_kit', 'slime_scraper', 'vacuum', 'chalk', 'radio', 'radio_headset_liquidator', 'fog_detector', 'unpeople_detector', 'duct_tape', 'fuse', 'manometer', 'valve_tag', 'inspection_mirror', 'sealant_tube', 'hermetic_tape', 'asbestos_cord', 'gasmask_filter', 'ozk_patch', 'ip4_gasmask', 'protective_apron', 'hermo_gasket', 'rubber_door_wedge', 'wire_coil', 'filter_layer', 'alkali_powder', 'lime_bucket', 'liquidator_rake', 'rubber_club', 'cleanup_tongs', 'filter_canister', 'wet_rag_bundle', 'decon_fluid', 'portable_siren_key'] },
  { id: 'paper', name: 'Бумага', baseStock: 65, lowStock: 15, roomTypes: [RoomType.OFFICE, RoomType.STORAGE], itemIds: ['note', 'book', 'ballot', 'toiletpaper', 'blank_form', 'water_coupon', 'concentrate_coupon', 'ration_registry_extract', 'forged_ration_card', 'ration_stamp_pad', 'sealed_complaint', 'samosbor_tally', ...DOCUMENT_ACCESS_PAPER_ITEM_IDS] },
  { id: 'fuel', name: 'Топливо', baseStock: 45, lowStock: 10, roomTypes: [RoomType.PRODUCTION, RoomType.STORAGE], itemIds: ['ammo_fuel', 'napalm_mix', 'empty_roks_tank', 'shmk_disposable', 'ato41_atomic_flamer', 'o15_multijet_flamer', ...DOCUMENT_ACCESS_FUEL_RESOURCE_ITEM_IDS] },
  { id: 'electronics', name: 'Электроника', baseStock: 35, lowStock: 8, roomTypes: [RoomType.PRODUCTION, RoomType.STORAGE, RoomType.OFFICE], itemIds: ['ammo_energy', 'flashlight', 'uv_spotlight', 'radio', 'radio_headset_liquidator', 'field_radio_battery', 'fog_detector', 'unpeople_detector', 'circuit_board', 'fuse', 'relay_diagram', 'lamp_bulb', ...ECONOMY_RARE_ENERGY_WEAPON_IDS] },
  { id: 'psi', name: 'ПСИ-сгустки', baseStock: 20, lowStock: 5, roomTypes: [RoomType.MEDICAL, RoomType.OFFICE], itemIds: [...ECONOMY_PSI_WEAPON_IDS, 'strange_clot', 'psi_dust', 'meat_rune', 'bottled_voice', 'siren_shard', 'void_spike'] },
  { id: 'slime_samples', name: 'Образцы слизи', baseStock: 12, lowStock: 3, roomTypes: [RoomType.MEDICAL, RoomType.PRODUCTION, RoomType.STORAGE], itemIds: ['slime_sample_brown', 'slime_sample_green', 'slime_sample_white', 'slime_sample_red', 'slime_sample_black', 'slime_sample_blue', 'blue_glow_sample_sealed', 'blue_glow_sample_open', SILVER_SLIME_SEALED_ID, SILVER_SLIME_OPENED_ID, 'slime_sample_seroburmaline', 'nii_sample_container', 'empty_sample_jar', 'cracked_sample_jar', 'sterile_swab', 'contaminated_swab', 'sample_cork_seal', 'glass_ampoule_empty', 'gas_sample_ampoule', 'sample_chain_form', 'nii_sample_label', 'slime_age_label_brown', 'slime_age_label_orange', 'slime_age_label_violet', 'slime_calcified_chip', 'slime_motor_node', 'slime_sense_node', 'frozen_slime_core', 'boiled_slime_residue', 'mutant_tissue_sample', 'fibrous_capsule_cut', 'frozen_item_shard', 'post_samosbor_probe_kit', 'zinc_slime_bucket', 'red_mold_sample', 'slime_sample_fake', 'slime_sample_contaminated', 'deactivated_residue', ...DOCUMENT_ACCESS_SAMPLE_RESOURCE_ITEM_IDS] },
  { id: 'contraband', name: 'Контрабанда', baseStock: 24, lowStock: 6, roomTypes: [RoomType.SMOKING, RoomType.STORAGE, RoomType.COMMON], itemIds: ['govnyak_roll', 'govnyak_brick', 'govnyak_sample', 'govnyak_bad_batch', 'cigs', 'sleeping_pills', 'forged_ration_card', 'fake_pass', 'forged_permit_slip', 'weapon_permit_forged', 'forged_quarantine_clearance', 'nii_market_receipt', 'nii_forged_audit', 'maronary_shaving', 'shark_scale', 'shock_baton', 'rb91_auto_shotgun', 'chest_failsafe_charge', 'pistol_grenade_launcher', 'contaminated_gloves', 'scrubbed_serial_plate', 'stolen_filter_pack', 'contraband_shocker_parts', 'confiscation_tag', ...DOCUMENT_ACCESS_CONTRABAND_ITEM_IDS] },
  { id: 'documents', name: 'Документы', baseStock: 60, lowStock: 15, roomTypes: [RoomType.OFFICE, RoomType.STORAGE], itemIds: ['ballot', 'note', 'key', 'fake_pass', 'zhek_seal', 'hermodoor_journal', 'pump_passport', 'temp_pass', 'permanent_pass', 'caravan_route', 'lift_scheme', 'blank_form', 'water_coupon', 'concentrate_coupon', 'ration_registry_extract', 'forged_ration_card', 'neighbor_complaint', 'denunciation', 'unsigned_order', 'siren_instruction', 'voluntary_receipt', 'clean_health_cert', 'psychiatrist_referral', 'samosbor_tally', 'sealed_complaint', 'elevator_override_form', 'pressure_logbook', 'ration_stamp_pad', 'container_key_label', 'corpse_number_tag', 'seal_wax', 'emergency_roster', 'filter_receipt', 'p14_gasmask_receipt', 'nii_contraband_manifest', 'nii_market_receipt', 'nii_forged_audit', 'nii_sample_container', 'archive_access_permit', 'forged_stamp_sheet', 'forged_shelter_tally', 'stolen_archive_card', 'missing_record_file', 'record_exposure_notice', 'passport_stub', 'personal_file_copy', 'official_permit_slip', 'forged_permit_slip', 'cleanup_order_stub', 'weapon_permit_signed', 'weapon_permit_forged', 'ammo_issue_order', 'official_quarantine_clearance', 'forged_quarantine_clearance', 'elevator_access_order', 'void_archive_warrant', 'quarantine_medcard', 'pneumomail_capsule', 'liquidator_issue_card', 'weapon_checkout_tag', 'sample_chain_form', 'confiscation_tag', 'nii_sample_label', ...DOCUMENT_ACCESS_DOCUMENT_RESOURCE_ITEM_IDS] },
  { id: 'industrial_slurry', name: 'Промышленная масса', baseStock: 70, lowStock: 18, roomTypes: [RoomType.PRODUCTION, RoomType.STORAGE], itemIds: ['rawmeat', 'metal_water', 'filter_layer', 'acid_bottle', 'rubber_strip', 'alcohol_bottle', 'glass_shard'] },
  { id: 'fungal_inputs', name: 'Грибной субстрат', baseStock: 45, lowStock: 12, roomTypes: [RoomType.STORAGE, RoomType.PRODUCTION, RoomType.BATHROOM], itemIds: ['spore_print', 'substrate_sack'] },
  { id: 'zhelemish', name: 'Желемыш', baseStock: 18, lowStock: 4, roomTypes: [RoomType.STORAGE, RoomType.KITCHEN, RoomType.MEDICAL, RoomType.BATHROOM], itemIds: ['zhelemish_raw', 'zhelemish_dried', 'zhelemish_boiled'] },
  { id: 'labor', name: 'Трудочасы', baseStock: 180, lowStock: 45, roomTypes: [RoomType.PRODUCTION, RoomType.KITCHEN, RoomType.MEDICAL, RoomType.OFFICE], itemIds: [] },
];

function appendResourceItems(packs: Record<string, readonly string[]>): void {
  for (const [resourceId, itemIds] of Object.entries(packs)) {
    const resource = RESOURCES.find(r => r.id === resourceId);
    if (!resource) continue;
    for (const itemId of itemIds) {
      if (!resource.itemIds.includes(itemId)) resource.itemIds.push(itemId);
    }
  }
}

const TECHNICAL_SPIRIT_RESOURCE_ITEMS: Record<string, readonly string[]> = {
  medicine: ['technical_spirit'],
  fuel: ['technical_spirit'],
  contraband: ['technical_spirit'],
};

appendResourceItems(TECHNICAL_SPIRIT_RESOURCE_ITEMS);

const SAMPLE_EVIDENCE_DOCUMENT_RESOURCE_ITEMS: Record<string, readonly string[]> = {
  documents: [
    'slime_age_label_brown', 'slime_age_label_orange', 'slime_age_label_violet',
    'water_reservoir_sample',
  ],
};

appendResourceItems(SAMPLE_EVIDENCE_DOCUMENT_RESOURCE_ITEMS);

const UTILITY_SCRAP_RESOURCE_ITEMS: Record<string, readonly string[]> = {
  food: ['sugar_pack'],
  metal: ['scrubbed_serial_plate', 'electrode_pack', 'pump_impeller', 'rail_switch_handle', 'rail_spike_pack'],
  ammo: ['black_market_shells', 'rpl23_lmg'],
  tools: [
    'sound_emitter', 'keyboard_unit', 'krona_battery',
    'heating_element', 'electrode_pack', 'water_filter_regulator', 'pump_impeller',
    'vent_damper_plate', 'rail_switch_handle', 'rail_spike_pack',
    'plastic_sheet',
    'roller_brush', 'cloth_roll', 'rubber_tube', 'market_weight_scale',
  ],
  paper: [
    'blueprint_t1_folder', 'blueprint_t2_folder', 'blueprint_t3_folder',
    'weapon_blueprint_t2', 'homemade_ammo_instruction', 'track_diagram_scrap',
    'cardboard_stack', 'import_toiletpaper',
  ],
  electronics: [
    'junior_tech_case', 'sound_emitter', 'keyboard_unit', 'screen_unit',
    'krona_battery', 'heating_element', 'wire_coil', 'rail_signal_lamp',
    'plastic_sheet',
    'contraband_shocker_parts', 'stolen_terminal_stamp',
  ],
  contraband: [
    'scrubbed_serial_plate', 'stolen_filter_pack', 'black_market_shells',
    'contraband_shocker_parts', 'weapon_blueprint_t2', 'homemade_ammo_instruction',
    'aerosol_paint_maiden', 'braga_bucket', 'moonshine_still_part',
    'stolen_terminal_stamp',
  ],
  documents: [
    'blueprint_t1_folder', 'blueprint_t2_folder', 'blueprint_t3_folder',
    'weapon_blueprint_t2', 'homemade_ammo_instruction', 'track_diagram_scrap',
    'stolen_terminal_stamp', 'party_portrait_pin',
  ],
  industrial_slurry: [
    'plastic_sheet', 'ceramic_shards_pack', 'cardboard_stack', 'cloth_roll',
    'rubber_tube', 'bottle_empty', 'moonshine_still_part',
  ],
};

appendResourceItems(UTILITY_SCRAP_RESOURCE_ITEMS);

const HOMEMADE_AMMO_RESOURCE_ITEMS: Record<string, readonly string[]> = {
  ammo: ['homemade_9mm'],
  contraband: ['homemade_9mm'],
};

appendResourceItems(HOMEMADE_AMMO_RESOURCE_ITEMS);

const BREACH_CHARGE_RESOURCE_ITEMS: Record<string, readonly string[]> = {
  ammo: ['breach_charge'],
};

appendResourceItems(BREACH_CHARGE_RESOURCE_ITEMS);

const CONCRETE_BREAKER_RESOURCE_ITEMS: Record<string, readonly string[]> = {
  ammo: ['concrete_breaker_grenade'],
};

appendResourceItems(CONCRETE_BREAKER_RESOURCE_ITEMS);

for (const resourceId of ['tools', 'electronics']) {
  const resource = RESOURCES.find(r => r.id === resourceId);
  if (resource && !resource.itemIds.includes('liquidator_flashlamp')) {
    resource.itemIds.push('liquidator_flashlamp');
  }
}

export const RESOURCE_BY_ID: Record<string, ResourceDef> = Object.fromEntries(RESOURCES.map(r => [r.id, r]));

export function resourceForItem(defId: string): ResourceDef | undefined {
  return RESOURCES.find(r => r.itemIds.includes(defId));
}

export function resourceForItemType(type: ItemType): ResourceDef | undefined {
  if (type === ItemType.FOOD) return RESOURCE_BY_ID.food;
  if (type === ItemType.DRINK) return RESOURCE_BY_ID.drink_water;
  if (type === ItemType.MEDICINE) return RESOURCE_BY_ID.medicine;
  if (type === ItemType.AMMO) return RESOURCE_BY_ID.ammo;
  if (type === ItemType.TOOL) return RESOURCE_BY_ID.tools;
  return undefined;
}

export function validateResourceItems(): string[] {
  const missing: string[] = [];
  for (const r of RESOURCES) {
    for (const id of r.itemIds) if (!ITEMS[id]) missing.push(`${r.id}:${id}`);
  }
  return missing;
}
