import { MonsterKind } from '../core/types';

export type MonsterVisualFamily =
  | 'low_swarm_garbage'
  | 'wall_concrete_metal'
  | 'wet_slime_waterline'
  | 'light_eye_line'
  | 'paper_protocol_net'
  | 'dark_fog_phase'
  | 'host_mimic_social'
  | 'source_hive_static';

export type MonsterProjectileFamily =
  | 'eye_bolt'
  | 'protocol_clause'
  | 'web_lash'
  | 'wet_line_shot'
  | 'flame_bloom'
  | 'plasma_core'
  | 'psi_pulse';

export type MonsterEvidenceFamily =
  | 'garbage_wake'
  | 'scrape_dust_crack'
  | 'wet_slime_residue'
  | 'light_line_lock'
  | 'paper_clause_scorch'
  | 'fog_psi_afterimage'
  | 'parasite_quarantine'
  | 'source_spore_thread';

export interface MonsterVisualDef {
  family: MonsterVisualFamily;
  evidence: MonsterEvidenceFamily;
  projectile?: MonsterProjectileFamily;
}

export const MONSTER_VISUALS: Record<MonsterKind, MonsterVisualDef> = {
  [MonsterKind.SBORKA]: { family: 'low_swarm_garbage', evidence: 'garbage_wake' },
  [MonsterKind.TVAR]: { family: 'wall_concrete_metal', evidence: 'scrape_dust_crack' },
  [MonsterKind.POLZUN]: { family: 'wet_slime_waterline', evidence: 'wet_slime_residue' },
  [MonsterKind.BETONNIK]: { family: 'wall_concrete_metal', evidence: 'scrape_dust_crack' },
  [MonsterKind.ZOMBIE]: { family: 'host_mimic_social', evidence: 'parasite_quarantine' },
  [MonsterKind.EYE]: { family: 'light_eye_line', evidence: 'light_line_lock', projectile: 'eye_bolt' },
  [MonsterKind.NIGHTMARE]: { family: 'dark_fog_phase', evidence: 'fog_psi_afterimage' },
  [MonsterKind.SHADOW]: { family: 'dark_fog_phase', evidence: 'fog_psi_afterimage' },
  [MonsterKind.REBAR]: { family: 'wall_concrete_metal', evidence: 'scrape_dust_crack' },
  [MonsterKind.MATKA]: { family: 'source_hive_static', evidence: 'source_spore_thread' },
  [MonsterKind.IDOL]: { family: 'paper_protocol_net', evidence: 'paper_clause_scorch', projectile: 'psi_pulse' },
  [MonsterKind.MANCOBUS]: { family: 'source_hive_static', evidence: 'source_spore_thread', projectile: 'flame_bloom' },
  [MonsterKind.HERALD]: { family: 'light_eye_line', evidence: 'light_line_lock', projectile: 'psi_pulse' },
  [MonsterKind.CREATOR]: { family: 'light_eye_line', evidence: 'light_line_lock', projectile: 'psi_pulse' },
  [MonsterKind.SPIRIT]: { family: 'dark_fog_phase', evidence: 'fog_psi_afterimage' },
  [MonsterKind.ROBOT]: { family: 'wall_concrete_metal', evidence: 'scrape_dust_crack', projectile: 'plasma_core' },
  [MonsterKind.SHOVNIK]: { family: 'wall_concrete_metal', evidence: 'scrape_dust_crack' },
  [MonsterKind.LAMPOVY]: { family: 'light_eye_line', evidence: 'light_line_lock' },
  [MonsterKind.PECHATEED]: { family: 'paper_protocol_net', evidence: 'paper_clause_scorch' },
  [MonsterKind.TUBE_EEL]: { family: 'wet_slime_waterline', evidence: 'wet_slime_residue' },
  [MonsterKind.PARAGRAPH]: { family: 'paper_protocol_net', evidence: 'paper_clause_scorch', projectile: 'protocol_clause' },
  [MonsterKind.NELYUD]: { family: 'host_mimic_social', evidence: 'parasite_quarantine' },
  [MonsterKind.KRYSNOZHKA]: { family: 'low_swarm_garbage', evidence: 'garbage_wake' },
  [MonsterKind.KOSTOREZ]: { family: 'wall_concrete_metal', evidence: 'scrape_dust_crack' },
  [MonsterKind.SAFEGUARD]: { family: 'wall_concrete_metal', evidence: 'scrape_dust_crack' },
  [MonsterKind.BLACK_LIQUIDATOR]: { family: 'host_mimic_social', evidence: 'parasite_quarantine' },
  [MonsterKind.KHOROVAYA_MATKA]: { family: 'source_hive_static', evidence: 'source_spore_thread' },
  [MonsterKind.SLIMEVIK]: { family: 'wet_slime_waterline', evidence: 'wet_slime_residue' },
  [MonsterKind.SOBRANNYY]: { family: 'host_mimic_social', evidence: 'parasite_quarantine' },
  [MonsterKind.ZHORNAYA_TVAR]: { family: 'host_mimic_social', evidence: 'garbage_wake' },
  [MonsterKind.BEZEKHIY]: { family: 'dark_fog_phase', evidence: 'fog_psi_afterimage' },
  [MonsterKind.PSEUDOLIFT]: { family: 'host_mimic_social', evidence: 'parasite_quarantine' },
  [MonsterKind.SLEPOGLAZ]: { family: 'light_eye_line', evidence: 'light_line_lock' },
  [MonsterKind.OLGOY]: { family: 'wet_slime_waterline', evidence: 'wet_slime_residue' },
  [MonsterKind.VODYANOY_KOSHMAR]: { family: 'wet_slime_waterline', evidence: 'wet_slime_residue' },
  [MonsterKind.LAMPOGLAZ]: { family: 'light_eye_line', evidence: 'light_line_lock', projectile: 'eye_bolt' },
  [MonsterKind.TUMANNIK]: { family: 'dark_fog_phase', evidence: 'fog_psi_afterimage' },
  [MonsterKind.CHERNOSLIZ]: { family: 'wet_slime_waterline', evidence: 'wet_slime_residue', projectile: 'wet_line_shot' },
  [MonsterKind.RZHAVNIK]: { family: 'wall_concrete_metal', evidence: 'scrape_dust_crack' },
  [MonsterKind.BETONOED]: { family: 'wall_concrete_metal', evidence: 'scrape_dust_crack' },
  [MonsterKind.PANELNIK]: { family: 'wall_concrete_metal', evidence: 'scrape_dust_crack' },
  [MonsterKind.PAUPSINA]: { family: 'source_hive_static', evidence: 'source_spore_thread', projectile: 'web_lash' },
  [MonsterKind.BORSHCHEVIK]: { family: 'source_hive_static', evidence: 'source_spore_thread' },
  [MonsterKind.OBZHIVALSHCHIK]: { family: 'source_hive_static', evidence: 'source_spore_thread' },
  [MonsterKind.HEAD_SLUG]: { family: 'host_mimic_social', evidence: 'parasite_quarantine' },
  [MonsterKind.PROTOKOLNIK]: { family: 'paper_protocol_net', evidence: 'paper_clause_scorch' },
  [MonsterKind.DIKIY_MERTVYAK]: { family: 'host_mimic_social', evidence: 'parasite_quarantine' },
  [MonsterKind.KONTORSHCHIK]: { family: 'paper_protocol_net', evidence: 'paper_clause_scorch' },
  [MonsterKind.TONKAYA_TEN]: { family: 'dark_fog_phase', evidence: 'fog_psi_afterimage' },
  [MonsterKind.KANTSELYARSKIY_IDOL]: { family: 'paper_protocol_net', evidence: 'paper_clause_scorch', projectile: 'psi_pulse' },
  [MonsterKind.LOZHNYY_DUKH]: { family: 'dark_fog_phase', evidence: 'fog_psi_afterimage' },
  [MonsterKind.CHERVIE_AVATAR]: { family: 'paper_protocol_net', evidence: 'paper_clause_scorch', projectile: 'psi_pulse' },
  [MonsterKind.POMOYNY_ROY]: { family: 'low_swarm_garbage', evidence: 'garbage_wake' },
  [MonsterKind.TRUBNYY_AVTOMAT]: { family: 'wet_slime_waterline', evidence: 'wet_slime_residue', projectile: 'wet_line_shot' },
  [MonsterKind.LOTOCHNIK]: { family: 'wet_slime_waterline', evidence: 'wet_slime_residue' },
  [MonsterKind.TRESKOTNIK]: { family: 'wall_concrete_metal', evidence: 'scrape_dust_crack' },
  [MonsterKind.ZAKALENNAYA_ARMATURA]: { family: 'wall_concrete_metal', evidence: 'scrape_dust_crack' },
  [MonsterKind.GLUBINNAYA_TEN]: { family: 'dark_fog_phase', evidence: 'fog_psi_afterimage' },
  [MonsterKind.GREEN_DOG]: { family: 'low_swarm_garbage', evidence: 'garbage_wake' },
  [MonsterKind.SLIME_WOMAN]: { family: 'wet_slime_waterline', evidence: 'wet_slime_residue' },
  [MonsterKind.GNILUSHKA]: { family: 'wet_slime_waterline', evidence: 'parasite_quarantine' },
  [MonsterKind.MUKHOZHUK_HOST]: { family: 'host_mimic_social', evidence: 'parasite_quarantine' },
  [MonsterKind.FOG_SHARK]: { family: 'dark_fog_phase', evidence: 'fog_psi_afterimage' },
  [MonsterKind.BLOOD_PLANT]: { family: 'source_hive_static', evidence: 'source_spore_thread' },
  [MonsterKind.SWARM]: { family: 'low_swarm_garbage', evidence: 'source_spore_thread' },
  [MonsterKind.SPORE_CARPET]: { family: 'source_hive_static', evidence: 'source_spore_thread' },
  [MonsterKind.LISHENNYY]: { family: 'dark_fog_phase', evidence: 'light_line_lock' },
  [MonsterKind.SCULPTURE]: { family: 'wall_concrete_metal', evidence: 'scrape_dust_crack' },
  [MonsterKind.GNOME]: { family: 'low_swarm_garbage', evidence: 'garbage_wake' },
};

export function monsterVisual(kind: MonsterKind | undefined): MonsterVisualDef | undefined {
  return kind === undefined ? undefined : MONSTER_VISUALS[kind];
}

export function monsterProjectileFamily(kind: MonsterKind | undefined): MonsterProjectileFamily | undefined {
  return monsterVisual(kind)?.projectile;
}
