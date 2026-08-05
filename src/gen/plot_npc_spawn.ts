import {
  AIGoal,
  EntityType,
  Occupation,
  type Entity,
  type Item,
  type Needs,
} from '../core/types';
import { freshNeeds } from '../data/catalog';
import { getNpcPackageByPlotNpcId, npcPackageDisplayName, type NpcPackageDef } from '../data/npc_packages';
import { freshRPG } from '../systems/rpg';

export interface PlotNpcSpawnOptions {
  angle?: number;
  pitch?: number;
  canGiveQuest?: boolean;
  isTraveler?: boolean;
  spriteSeed?: number;
  weapon?: string;
  tool?: string;
  aiTarget?: { x: number; y: number };
  needs?: Needs;
  extra?: Partial<Entity>;
}

function packageItems(items: readonly Item[] | undefined): Item[] {
  return (items ?? []).map(item => ({ ...item }));
}

function packageMaxHp(pack: NpcPackageDef): number {
  return Math.max(1, pack.runtime?.maxHp ?? pack.runtime?.hp ?? 100);
}

function packageHp(pack: NpcPackageDef): number {
  return Math.max(1, Math.min(pack.runtime?.hp ?? packageMaxHp(pack), packageMaxHp(pack)));
}

function packageSpeed(pack: NpcPackageDef): number {
  return Math.max(0.1, Math.min(20, pack.runtime?.speed ?? 1.2));
}

export function plotNpcEntityFromPackage(
  id: number,
  plotNpcId: string,
  x: number,
  y: number,
  options: PlotNpcSpawnOptions = {},
): (Entity & { npcPackageId: string }) | undefined {
  const pack = getNpcPackageByPlotNpcId(plotNpcId);
  if (!pack || pack.content?.plotNpcId !== plotNpcId) return undefined;
  const target = options.aiTarget ?? { x: 0, y: 0 };
  const visualSpriteScale = pack.visual.spriteScale
    ?? (pack.affiliation.occupation === Occupation.CHILD ? 0.6 : undefined);
  return {
    id,
    type: EntityType.NPC,
    x,
    y,
    angle: options.angle ?? 0,
    pitch: options.pitch ?? 0,
    alive: true,
    speed: packageSpeed(pack),
    sprite: pack.visual.sprite ?? pack.affiliation.occupation,
    ...(visualSpriteScale !== undefined ? { spriteScale: visualSpriteScale } : {}),
    spriteSeed: options.spriteSeed ?? pack.visual.spriteSeed,
    npcVisualId: pack.visual.npcVisualId,
    name: npcPackageDisplayName(pack),
    isFemale: pack.demographics.sex === 'female',
    age: pack.demographics.age,
    sex: pack.demographics.sex,
    needs: options.needs ? { ...options.needs } : freshNeeds(),
    hp: packageHp(pack),
    maxHp: packageMaxHp(pack),
    money: pack.wealth.cashRubles ?? 0,
    accountRubles: pack.wealth.accountRubles,
    rpg: freshRPG(pack.rpg.level),
    ai: { goal: AIGoal.IDLE, tx: target.x, ty: target.y, path: [], pi: 0, stuck: 0, timer: 0 },
    inventory: packageItems(pack.loadout.inventory),
    weapon: options.weapon ?? pack.loadout.weapon,
    tool: options.tool ?? pack.loadout.tool,
    faction: pack.affiliation.faction,
    occupation: pack.affiliation.occupation,
    plotNpcId,
    npcPackageId: pack.id,
    canGiveQuest: options.canGiveQuest ?? pack.runtime?.canGiveQuest ?? true,
    questId: -1,
    isTraveler: options.isTraveler,
    ...options.extra,
  };
}

export function spawnPlotNpcFromPackage(
  entities: Entity[],
  nextId: { v: number },
  plotNpcId: string,
  x: number,
  y: number,
  options: PlotNpcSpawnOptions = {},
): Entity | undefined {
  const entity = plotNpcEntityFromPackage(nextId.v, plotNpcId, x, y, options);
  if (!entity) return undefined;
  nextId.v++;
  entities.push(entity);
  return entity;
}

export function requireSpawnedPlotNpcFromPackage(
  entities: Entity[],
  nextId: { v: number },
  plotNpcId: string,
  x: number,
  y: number,
  options: PlotNpcSpawnOptions = {},
): Entity & { npcPackageId: string } {
  const entity = spawnPlotNpcFromPackage(entities, nextId, plotNpcId, x, y, options);
  if (!entity) throw new Error(`[PLOT_NPC_SPAWN] missing NPC package for "${plotNpcId}"`);
  return entity as Entity & { npcPackageId: string };
}
