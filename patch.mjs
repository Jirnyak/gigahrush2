import fs from 'node:fs';
let content = fs.readFileSync('src/data/occupation_profiles.ts', 'utf8');

// Replace trade items for ENGINEER
content = content.replace(
  "'ip4_gasmask', 'gasmask_filter', 'liquidator_armor', 'liquidator_helmet', 'geiger_counter'",
  "'ip4_gasmask', 'gasmask_filter', 'armor_liquidator', 'armor_medium', 'fog_detector'"
);

// Replace questRewardItems for ENGINEER
content = content.replace(
  "'gasmask_filter', 'liquidator_armor'",
  "'gasmask_filter', 'armor_liquidator'"
);

// Replace FACTION_TRADE_OFFERS
content = content.replace(
  "{ faction: Faction.LIQUIDATOR, occupation: Occupation.DOCTOR, minRank: 3, defId: 'medkit', count: 1 },",
  "{ faction: Faction.LIQUIDATOR, occupation: Occupation.DOCTOR, minRank: 3, defId: 'bandage', count: 5 },"
);
content = content.replace(
  "{ faction: Faction.LIQUIDATOR, occupation: Occupation.DOCTOR, minRank: 4, defId: 'medkit', count: 2 },",
  "{ faction: Faction.LIQUIDATOR, occupation: Occupation.DOCTOR, minRank: 4, defId: 'pills', count: 2 },"
);
content = content.replace(
  "{ faction: Faction.LIQUIDATOR, occupation: Occupation.ENGINEER, minRank: 3, defId: 'liquidator_armor', count: 1 },",
  "{ faction: Faction.LIQUIDATOR, occupation: Occupation.ENGINEER, minRank: 3, defId: 'armor_liquidator', count: 1 },"
);
content = content.replace(
  "{ faction: Faction.LIQUIDATOR, occupation: Occupation.ENGINEER, minRank: 3, defId: 'liquidator_helmet', count: 1 },",
  "{ faction: Faction.LIQUIDATOR, occupation: Occupation.ENGINEER, minRank: 3, defId: 'armor_medium', count: 1 },"
);
content = content.replace(
  "{ faction: Faction.LIQUIDATOR, occupation: Occupation.ENGINEER, minRank: 4, defId: 'geiger_counter', count: 1 },",
  "{ faction: Faction.LIQUIDATOR, occupation: Occupation.ENGINEER, minRank: 4, defId: 'fog_detector', count: 1 },"
);

fs.writeFileSync('src/data/occupation_profiles.ts', content);
